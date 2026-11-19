// Structural validation of the sealed OperationPlan contract. This mirrors
// doc/developer/platform-ai-v1/schemas/operation-plan.schema.json by hand: the
// JSON schema stays the design contract, this module is the runtime validator
// used by preview/apply so no eval-based schema engine is needed. Semantic
// checks (references, ownership, uniqueness) live in the executor, not here.
import {findDangerousKey} from './hash.js';

const HEX64 = /^[a-f0-9]{64}$/;
const CODE = (v) => typeof v === 'string' && v.length >= 1 && v.length <= 240;

export const issue = (code, path, message) => ({code, path, message});

const typeOf = (value) => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
};

const checkObject = (problems, value, path, {required = [], optional = [], allowFalse = false} = {}) => {
  if (typeOf(value) !== 'object') {
    problems.push(issue('OUTPUT_SCHEMA_INVALID', path, `${path} must be an object`));
    return false;
  }
  const keys = Object.keys(value);
  const allowed = new Set(required.concat(optional));
  keys.forEach((key) => {
    if (!allowed.has(key)) {
      problems.push(issue('OUTPUT_SCHEMA_INVALID', `${path}.${key}`, `unknown property ${key}`));
    }
  });
  required.forEach((key) => {
    if (!keys.includes(key)) {
      problems.push(issue('OUTPUT_SCHEMA_INVALID', `${path}.${key}`, `missing required property ${key}`));
    }
  });
  if (!allowFalse && keys.length === 0 && required.length > 0) {
    // empty object is fine as long as required keys exist (checked above)
  }
  return true;
};

const checkString = (problems, value, path, {min = 0, max = Infinity, pattern = null} = {}) => {
  if (typeof value !== 'string') {
    problems.push(issue('OUTPUT_SCHEMA_INVALID', path, `${path} must be a string`));
    return false;
  }
  if (value.length < min || value.length > max) {
    problems.push(issue('OUTPUT_SCHEMA_INVALID', path, `${path} length must be ${min}..${max}`));
    return false;
  }
  if (pattern && !pattern.test(value)) {
    problems.push(issue('OUTPUT_SCHEMA_INVALID', path, `${path} pattern mismatch`));
    return false;
  }
  return true;
};

const checkInteger = (problems, value, path, {nullable = false, min = -Infinity} = {}) => {
  if (nullable && value === null) return true;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    problems.push(issue('OUTPUT_SCHEMA_INVALID', path, `${path} must be an integer${min > -Infinity ? ` >= ${min}` : ''}`));
    return false;
  }
  return true;
};

const checkBoolean = (problems, value, path) => {
  if (typeof value !== 'boolean') {
    problems.push(issue('OUTPUT_SCHEMA_INVALID', path, `${path} must be a boolean`));
    return false;
  }
  return true;
};

const checkArray = (problems, value, path, {min = 0, max = Infinity, unique = false} = {}) => {
  if (!Array.isArray(value)) {
    problems.push(issue('OUTPUT_SCHEMA_INVALID', path, `${path} must be an array`));
    return false;
  }
  if (value.length < min || value.length > max) {
    problems.push(issue('OUTPUT_SCHEMA_INVALID', path, `${path} item count must be ${min}..${max}`));
    return false;
  }
  if (unique) {
    const seen = new Set();
    value.forEach((item) => {
      const key = typeof item === 'string' ? item : JSON.stringify(item);
      if (seen.has(key)) problems.push(issue('OUTPUT_SCHEMA_INVALID', path, `${path} items must be unique`));
      seen.add(key);
    });
  }
  return true;
};

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

const COLLECTIONS = ['entities', 'logicEntities', 'conceptEntities', 'wordRoots', 'standardGroups',
  'standardFields', 'dataTypeMappings', 'dataTypeSupports', 'modelDatabases', 'catalogCategories',
  'drawingSemantic', 'drawingPages'];
const OWNER_COLLECTIONS = ['entities', 'logicEntities', 'conceptEntities'];

const validateObjectRef = (problems, value, path) => {
  if (typeOf(value) !== 'object') {
    problems.push(issue('OUTPUT_SCHEMA_INVALID', path, `${path} must be an object`));
    return;
  }
  if (value.kind === 'local') {
    checkObject(problems, value, path, {required: ['kind', 'key'], optional: []});
    checkString(problems, value.key, `${path}.key`, {min: 1, max: 240});
    return;
  }
  if (value.kind === 'existing' && value.collection === 'fields') {
    checkObject(problems, value, path, {required: ['kind', 'collection', 'owner', 'id'], optional: []});
    checkString(problems, value.id, `${path}.id`, {min: 1, max: 240});
    if (typeOf(value.owner) === 'object') {
      checkObject(problems, value.owner, `${path}.owner`, {required: ['collection', 'id'], optional: []});
      if (!OWNER_COLLECTIONS.includes(value.owner.collection)) {
        problems.push(issue('OUTPUT_SCHEMA_INVALID', `${path}.owner.collection`, 'invalid owner collection'));
      }
      checkString(problems, value.owner.id, `${path}.owner.id`, {min: 1, max: 240});
    } else {
      problems.push(issue('OUTPUT_SCHEMA_INVALID', `${path}.owner`, `${path}.owner must be an object`));
    }
    return;
  }
  if (value.kind === 'existing') {
    checkObject(problems, value, path, {required: ['kind', 'collection', 'id'], optional: []});
    if (!COLLECTIONS.includes(value.collection)) {
      problems.push(issue('OUTPUT_SCHEMA_INVALID', `${path}.collection`, 'invalid collection ${value.collection}'));
    }
    checkString(problems, value.id, `${path}.id`, {min: 1, max: 240});
    return;
  }
  problems.push(issue('OUTPUT_SCHEMA_INVALID', `${path}.kind`, 'ObjectRef kind must be local or existing'));
};

const validateFieldDraft = (problems, value, path) => {
  if (!checkObject(problems, value, path, {
    required: ['localKey', 'defKey', 'defName', 'type', 'notNull', 'primaryKey'],
    optional: ['len', 'scale', 'comment', 'defaultValue'],
  })) return;
  checkString(problems, value.localKey, `${path}.localKey`, {min: 1, max: 240});
  checkString(problems, value.defKey, `${path}.defKey`, {min: 1, max: 240});
  checkString(problems, value.defName, `${path}.defName`, {max: 240});
  checkString(problems, value.type, `${path}.type`, {min: 1, max: 240});
  if (value.len !== undefined) checkInteger(problems, value.len, `${path}.len`, {nullable: true, min: 0});
  if (value.scale !== undefined) checkInteger(problems, value.scale, `${path}.scale`, {nullable: true, min: 0});
  checkBoolean(problems, value.notNull, `${path}.notNull`);
  checkBoolean(problems, value.primaryKey, `${path}.primaryKey`);
  if (value.comment !== undefined) checkString(problems, value.comment, `${path}.comment`, {max: 8000});
  if (value.defaultValue !== undefined) checkString(problems, value.defaultValue, `${path}.defaultValue`, {max: 8000});
};

const validateModelPredicate = (problems, value, path) => {
  if (typeOf(value) !== 'object') {
    problems.push(issue('OUTPUT_SCHEMA_INVALID', path, `${path} must be an object`));
    return;
  }
  if (value.op === 'required') {
    checkObject(problems, value, path, {required: ['op', 'field'], optional: []});
    if (!['defKey', 'defName', 'comment'].includes(value.field)) {
      problems.push(issue('OUTPUT_SCHEMA_INVALID', `${path}.field`, 'invalid required field'));
    }
    return;
  }
  if (value.op === 'hasPrimaryKey') {
    checkObject(problems, value, path, {required: ['op'], optional: []});
    return;
  }
  if (value.op === 'nameStyle') {
    checkObject(problems, value, path, {required: ['op', 'style'], optional: []});
    if (!['snake_lower', 'snake_upper', 'camel_lower'].includes(value.style)) {
      problems.push(issue('OUTPUT_SCHEMA_INVALID', `${path}.style`, 'invalid name style'));
    }
    return;
  }
  if (value.op === 'standardMatch') {
    checkObject(problems, value, path, {required: ['op', 'standardRefs'], optional: []});
    if (checkArray(problems, value.standardRefs, `${path}.standardRefs`, {min: 1, max: 100})) {
      value.standardRefs.forEach((ref, i) => validateObjectRef(problems, ref, `${path}.standardRefs[${i}]`));
    }
    return;
  }
  problems.push(issue('OUTPUT_SCHEMA_INVALID', `${path}.op`, 'unknown predicate op'));
};

// ---- Chen structural shapes (drawing platform; semantic compile is the
// drawing integrator's responsibility, here only the closed shape is checked) ----
const validateChenRole = (problems, value, path) => {
  if (!checkObject(problems, value, path, {
    required: ['localKey', 'entityKey', 'cardinality', 'participation'],
    optional: ['name', 'manyLabel'],
  })) return;
  checkString(problems, value.localKey, `${path}.localKey`, {min: 1, max: 240});
  checkString(problems, value.entityKey, `${path}.entityKey`, {min: 1, max: 240});
  if (value.name !== undefined) checkString(problems, value.name, `${path}.name`, {max: 240});
  if (!['one', 'many'].includes(value.cardinality)) {
    problems.push(issue('OUTPUT_SCHEMA_INVALID', `${path}.cardinality`, 'invalid cardinality'));
  }
  if (!['partial', 'total'].includes(value.participation)) {
    problems.push(issue('OUTPUT_SCHEMA_INVALID', `${path}.participation`, 'invalid participation'));
  }
  if (value.manyLabel !== undefined && !['N', 'M', 'P'].includes(value.manyLabel)) {
    problems.push(issue('OUTPUT_SCHEMA_INVALID', `${path}.manyLabel`, 'invalid manyLabel'));
  }
};

const validateChenGraph = (problems, value, path) => {
  if (!checkObject(problems, value, path, {required: ['entities', 'relationships', 'attributes'], optional: []})) return;
  if (checkArray(problems, value.entities, `${path}.entities`, {min: 1, max: 150})) {
    value.entities.forEach((entity, i) => {
      const p = `${path}.entities[${i}]`;
      if (checkObject(problems, entity, p, {required: ['localKey', 'name', 'kind'], optional: []})) {
        checkString(problems, entity.localKey, `${p}.localKey`, {min: 1, max: 240});
        checkString(problems, entity.name, `${p}.name`, {min: 1, max: 240});
        if (!['strong', 'weak'].includes(entity.kind)) {
          problems.push(issue('OUTPUT_SCHEMA_INVALID', `${p}.kind`, 'invalid entity kind'));
        }
      }
    });
  }
  if (checkArray(problems, value.relationships, `${path}.relationships`, {min: 0, max: 100})) {
    value.relationships.forEach((rel, i) => {
      const p = `${path}.relationships[${i}]`;
      if (checkObject(problems, rel, p, {required: ['localKey', 'name', 'kind', 'roles'], optional: []})) {
        checkString(problems, rel.localKey, `${p}.localKey`, {min: 1, max: 240});
        checkString(problems, rel.name, `${p}.name`, {min: 1, max: 240});
        if (!['ordinary', 'identifying'].includes(rel.kind)) {
          problems.push(issue('OUTPUT_SCHEMA_INVALID', `${p}.kind`, 'invalid relationship kind'));
        }
        if (checkArray(problems, rel.roles, `${p}.roles`, {min: 2, max: 12})) {
          rel.roles.forEach((role, j) => validateChenRole(problems, role, `${p}.roles[${j}]`));
        }
      }
    });
  }
  if (checkArray(problems, value.attributes, `${path}.attributes`, {min: 0, max: 150})) {
    value.attributes.forEach((attr, i) => {
      const p = `${path}.attributes[${i}]`;
      if (checkObject(problems, attr, p, {required: ['localKey', 'name', 'kind', 'key', 'owner'], optional: []})) {
        checkString(problems, attr.localKey, `${p}.localKey`, {min: 1, max: 240});
        checkString(problems, attr.name, `${p}.name`, {min: 1, max: 240});
        if (!['simple', 'composite', 'multivalued', 'derived'].includes(attr.kind)) {
          problems.push(issue('OUTPUT_SCHEMA_INVALID', `${p}.kind`, 'invalid attribute kind'));
        }
        if (!['none', 'primary', 'partial'].includes(attr.key)) {
          problems.push(issue('OUTPUT_SCHEMA_INVALID', `${p}.key`, 'invalid attribute key'));
        }
        if (checkObject(problems, attr.owner, `${p}.owner`, {required: ['type', 'key'], optional: []})) {
          if (!['entity', 'relationship', 'attribute'].includes(attr.owner.type)) {
            problems.push(issue('OUTPUT_SCHEMA_INVALID', `${p}.owner.type`, 'invalid owner type'));
          }
          checkString(problems, attr.owner.key, `${p}.owner.key`, {min: 1, max: 240});
        }
      }
    });
  }
};

const validateChenChange = (problems, value, path) => {
  if (typeOf(value) !== 'object' || typeof value.kind !== 'string') {
    problems.push(issue('OUTPUT_SCHEMA_INVALID', path, `${path} must be a chen change object`));
    return;
  }
  switch (value.kind) {
    case 'addEntity':
      if (checkObject(problems, value, path, {required: ['kind', 'localKey', 'name', 'entityKind'], optional: []})) {
        checkString(problems, value.localKey, `${path}.localKey`, {min: 1, max: 240});
        checkString(problems, value.name, `${path}.name`, {min: 1, max: 240});
        if (!['strong', 'weak'].includes(value.entityKind)) {
          problems.push(issue('OUTPUT_SCHEMA_INVALID', `${path}.entityKind`, 'invalid entity kind'));
        }
      }
      return;
    case 'addRelationship':
      if (checkObject(problems, value, path, {required: ['kind', 'localKey', 'name', 'relationshipKind', 'roles'], optional: []})) {
        checkString(problems, value.localKey, `${path}.localKey`, {min: 1, max: 240});
        checkString(problems, value.name, `${path}.name`, {min: 1, max: 240});
        if (!['ordinary', 'identifying'].includes(value.relationshipKind)) {
          problems.push(issue('OUTPUT_SCHEMA_INVALID', `${path}.relationshipKind`, 'invalid relationship kind'));
        }
        if (checkArray(problems, value.roles, `${path}.roles`, {min: 2, max: 12})) {
          value.roles.forEach((role, j) => {
            const p = `${path}.roles[${j}]`;
            if (checkObject(problems, role, p, {required: ['localKey', 'entity', 'cardinality', 'participation'], optional: ['name', 'manyLabel']})) {
              checkString(problems, role.localKey, `${p}.localKey`, {min: 1, max: 240});
              validateObjectRef(problems, role.entity, `${p}.entity`);
              if (role.name !== undefined) checkString(problems, role.name, `${p}.name`, {max: 240});
              if (!['one', 'many'].includes(role.cardinality)) {
                problems.push(issue('OUTPUT_SCHEMA_INVALID', `${p}.cardinality`, 'invalid cardinality'));
              }
              if (!['partial', 'total'].includes(role.participation)) {
                problems.push(issue('OUTPUT_SCHEMA_INVALID', `${p}.participation`, 'invalid participation'));
              }
              if (role.manyLabel !== undefined && !['N', 'M', 'P'].includes(role.manyLabel)) {
                problems.push(issue('OUTPUT_SCHEMA_INVALID', `${p}.manyLabel`, 'invalid manyLabel'));
              }
            }
          });
        }
      }
      return;
    case 'addAttribute':
      if (checkObject(problems, value, path, {required: ['kind', 'localKey', 'name', 'attributeKind', 'key', 'owner'], optional: []})) {
        checkString(problems, value.localKey, `${path}.localKey`, {min: 1, max: 240});
        checkString(problems, value.name, `${path}.name`, {min: 1, max: 240});
        if (!['simple', 'composite', 'multivalued', 'derived'].includes(value.attributeKind)) {
          problems.push(issue('OUTPUT_SCHEMA_INVALID', `${path}.attributeKind`, 'invalid attribute kind'));
        }
        if (!['none', 'primary', 'partial'].includes(value.key)) {
          problems.push(issue('OUTPUT_SCHEMA_INVALID', `${path}.key`, 'invalid attribute key'));
        }
        if (checkObject(problems, value.owner, `${path}.owner`, {required: ['type', 'ref'], optional: []})) {
          if (!['entity', 'relationship', 'attribute'].includes(value.owner.type)) {
            problems.push(issue('OUTPUT_SCHEMA_INVALID', `${path}.owner.type`, 'invalid owner type'));
          }
          validateObjectRef(problems, value.owner.ref, `${path}.owner.ref`);
        }
      }
      return;
    case 'rename':
      if (checkObject(problems, value, path, {required: ['kind', 'target', 'name'], optional: []})) {
        validateObjectRef(problems, value.target, `${path}.target`);
        checkString(problems, value.name, `${path}.name`, {min: 1, max: 240});
      }
      return;
    case 'connectRole':
      if (checkObject(problems, value, path, {required: ['kind', 'relationship', 'role'], optional: []})) {
        validateObjectRef(problems, value.relationship, `${path}.relationship`);
        if (checkObject(problems, value.role, `${path}.role`, {required: ['localKey', 'entity', 'cardinality', 'participation'], optional: ['name', 'manyLabel']})) {
          checkString(problems, value.role.localKey, `${path}.role.localKey`, {min: 1, max: 240});
          validateObjectRef(problems, value.role.entity, `${path}.role.entity`);
          if (!['one', 'many'].includes(value.role.cardinality)) {
            problems.push(issue('OUTPUT_SCHEMA_INVALID', `${path}.role.cardinality`, 'invalid cardinality'));
          }
          if (!['partial', 'total'].includes(value.role.participation)) {
            problems.push(issue('OUTPUT_SCHEMA_INVALID', `${path}.role.participation`, 'invalid participation'));
          }
        }
      }
      return;
    case 'remove':
      if (checkObject(problems, value, path, {required: ['kind', 'target'], optional: []})) {
        validateObjectRef(problems, value.target, `${path}.target`);
      }
      return;
    case 'setAppearance':
      if (checkObject(problems, value, path, {required: ['kind', 'targets', 'themeId', 'styleId'], optional: []})) {
        if (checkArray(problems, value.targets, `${path}.targets`, {min: 1, max: 150})) {
          value.targets.forEach((ref, i) => validateObjectRef(problems, ref, `${path}.targets[${i}]`));
        }
        if (!['default', 'fresh', 'dopamine', 'dusk'].includes(value.themeId)) {
          problems.push(issue('OUTPUT_SCHEMA_INVALID', `${path}.themeId`, 'invalid themeId'));
        }
        if (!['standard', 'sketch', 'oil'].includes(value.styleId)) {
          problems.push(issue('OUTPUT_SCHEMA_INVALID', `${path}.styleId`, 'invalid styleId'));
        }
      }
      return;
    case 'layout':
      if (checkObject(problems, value, path, {required: ['kind', 'targets', 'direction', 'preserveOthers'], optional: []})) {
        if (checkArray(problems, value.targets, `${path}.targets`, {min: 1, max: 150})) {
          value.targets.forEach((ref, i) => validateObjectRef(problems, ref, `${path}.targets[${i}]`));
        }
        if (!['LR', 'TB'].includes(value.direction)) {
          problems.push(issue('OUTPUT_SCHEMA_INVALID', `${path}.direction`, 'invalid direction'));
        }
        if (value.preserveOthers !== true) {
          problems.push(issue('OUTPUT_SCHEMA_INVALID', `${path}.preserveOthers`, 'preserveOthers must be true'));
        }
      }
      return;
    default:
      problems.push(issue('OUTPUT_SCHEMA_INVALID', `${path}.kind`, 'unknown chen change kind'));
  }
};

// ---- Operation args per command (schema oneOf branches) ----
const validateOperationArgs = (problems, command, args, path) => {
  const fieldsOf = (drafts, p) => {
    if (checkArray(problems, drafts, p, {min: 1, max: 300})) {
      drafts.forEach((draft, i) => validateFieldDraft(problems, draft, `${p}[${i}]`));
    }
  };
  switch (command) {
    case 'model.table.create':
      if (!checkObject(problems, args, path, {
        required: ['localKey', 'defKey', 'defName', 'dbType', 'fields'],
        optional: ['comment', 'database', 'category'],
      })) return;
      checkString(problems, args.localKey, `${path}.localKey`, {min: 1, max: 240});
      checkString(problems, args.defKey, `${path}.defKey`, {min: 1, max: 240});
      checkString(problems, args.defName, `${path}.defName`, {min: 1, max: 240});
      if (args.comment !== undefined) checkString(problems, args.comment, `${path}.comment`, {max: 8000});
      validateObjectRef(problems, args.dbType, `${path}.dbType`);
      if (args.database !== undefined) validateObjectRef(problems, args.database, `${path}.database`);
      if (args.category !== undefined) validateObjectRef(problems, args.category, `${path}.category`);
      fieldsOf(args.fields, `${path}.fields`);
      return;
    case 'model.field.add':
      if (!checkObject(problems, args, path, {required: ['table', 'fields'], optional: []})) return;
      validateObjectRef(problems, args.table, `${path}.table`);
      fieldsOf(args.fields, `${path}.fields`);
      return;
    case 'model.foreignKey.create':
      if (!checkObject(problems, args, path, {
        required: ['localKey', 'name', 'sourceTable', 'sourceFields', 'targetTable', 'targetFields'],
        optional: [],
      })) return;
      checkString(problems, args.localKey, `${path}.localKey`, {min: 1, max: 240});
      checkString(problems, args.name, `${path}.name`, {min: 1, max: 240});
      validateObjectRef(problems, args.sourceTable, `${path}.sourceTable`);
      validateObjectRef(problems, args.targetTable, `${path}.targetTable`);
      ['sourceFields', 'targetFields'].forEach((key) => {
        if (checkArray(problems, args[key], `${path}.${key}`, {min: 1, max: 20})) {
          args[key].forEach((ref, i) => validateObjectRef(problems, ref, `${path}.${key}[${i}]`));
        }
      });
      return;
    case 'model.diagram.create':
      if (!checkObject(problems, args, path, {
        required: ['localKey', 'defKey', 'defName', 'tables', 'level'],
        optional: [],
      })) return;
      checkString(problems, args.localKey, `${path}.localKey`, {min: 1, max: 240});
      checkString(problems, args.defKey, `${path}.defKey`, {min: 1, max: 240});
      checkString(problems, args.defName, `${path}.defName`, {min: 1, max: 240});
      if (checkArray(problems, args.tables, `${path}.tables`, {min: 1, max: 100})) {
        args.tables.forEach((ref, i) => validateObjectRef(problems, ref, `${path}.tables[${i}]`));
      }
      if (args.level !== 'physical') {
        problems.push(issue('OUTPUT_SCHEMA_INVALID', `${path}.level`, 'level must be physical'));
      }
      return;
    case 'standard.group.create':
      if (!checkObject(problems, args, path, {required: ['localKey', 'defKey', 'defName'], optional: []})) return;
      checkString(problems, args.localKey, `${path}.localKey`, {min: 1, max: 240});
      checkString(problems, args.defKey, `${path}.defKey`, {min: 1, max: 240});
      checkString(problems, args.defName, `${path}.defName`, {min: 1, max: 240});
      return;
    case 'standard.root.create':
      if (!checkObject(problems, args, path, {
        required: ['localKey', 'defKey', 'defName', 'fullName'], optional: ['baseType'],
      })) return;
      checkString(problems, args.localKey, `${path}.localKey`, {min: 1, max: 240});
      checkString(problems, args.defKey, `${path}.defKey`, {min: 1, max: 240});
      checkString(problems, args.defName, `${path}.defName`, {min: 1, max: 240});
      checkString(problems, args.fullName, `${path}.fullName`, {min: 1, max: 240});
      if (args.baseType !== undefined) validateObjectRef(problems, args.baseType, `${path}.baseType`);
      return;
    case 'standard.field.create':
      if (!checkObject(problems, args, path, {
        required: ['localKey', 'group', 'defKey', 'defName', 'baseType', 'wordRoots'],
        optional: ['len', 'scale', 'comment'],
      })) return;
      checkString(problems, args.localKey, `${path}.localKey`, {min: 1, max: 240});
      validateObjectRef(problems, args.group, `${path}.group`);
      checkString(problems, args.defKey, `${path}.defKey`, {min: 1, max: 240});
      checkString(problems, args.defName, `${path}.defName`, {min: 1, max: 240});
      validateObjectRef(problems, args.baseType, `${path}.baseType`);
      if (args.len !== undefined) checkInteger(problems, args.len, `${path}.len`, {nullable: true, min: 0});
      if (args.scale !== undefined) checkInteger(problems, args.scale, `${path}.scale`, {nullable: true, min: 0});
      if (args.comment !== undefined) checkString(problems, args.comment, `${path}.comment`, {max: 8000});
      if (checkArray(problems, args.wordRoots, `${path}.wordRoots`, {min: 1, max: 20})) {
        args.wordRoots.forEach((ref, i) => validateObjectRef(problems, ref, `${path}.wordRoots[${i}]`));
      }
      return;
    case 'quality.modelRuleSet.create':
      if (!checkObject(problems, args, path, {
        required: ['localKey', 'name', 'enabled', 'targets', 'rules'], optional: [],
      })) return;
      checkString(problems, args.localKey, `${path}.localKey`, {min: 1, max: 240});
      checkString(problems, args.name, `${path}.name`, {min: 1, max: 240});
      checkBoolean(problems, args.enabled, `${path}.enabled`);
      if (checkArray(problems, args.targets, `${path}.targets`, {min: 1, max: 100})) {
        args.targets.forEach((ref, i) => validateObjectRef(problems, ref, `${path}.targets[${i}]`));
      }
      if (checkArray(problems, args.rules, `${path}.rules`, {min: 1, max: 100})) {
        args.rules.forEach((rule, i) => {
          const p = `${path}.rules[${i}]`;
          if (checkObject(problems, rule, p, {
            required: ['localKey', 'name', 'severity', 'target', 'predicate'], optional: [],
          })) {
            checkString(problems, rule.localKey, `${p}.localKey`, {min: 1, max: 240});
            checkString(problems, rule.name, `${p}.name`, {min: 1, max: 240});
            if (!['warning', 'error'].includes(rule.severity)) {
              problems.push(issue('OUTPUT_SCHEMA_INVALID', `${p}.severity`, 'invalid severity'));
            }
            if (!['physicalTable', 'logicalEntity', 'field', 'conceptEntity'].includes(rule.target)) {
              problems.push(issue('OUTPUT_SCHEMA_INVALID', `${p}.target`, 'invalid rule target'));
            }
            validateModelPredicate(problems, rule.predicate, `${p}.predicate`);
          }
        });
      }
      return;
    case 'drawing.chen.createPage':
      if (!checkObject(problems, args, path, {
        required: ['localKey', 'name', 'graph', 'themeId', 'styleId'], optional: [],
      })) return;
      checkString(problems, args.localKey, `${path}.localKey`, {min: 1, max: 240});
      checkString(problems, args.name, `${path}.name`, {min: 1, max: 240});
      validateChenGraph(problems, args.graph, `${path}.graph`);
      if (!['default', 'fresh', 'dopamine', 'dusk'].includes(args.themeId)) {
        problems.push(issue('OUTPUT_SCHEMA_INVALID', `${path}.themeId`, 'invalid themeId'));
      }
      if (!['standard', 'sketch', 'oil'].includes(args.styleId)) {
        problems.push(issue('OUTPUT_SCHEMA_INVALID', `${path}.styleId`, 'invalid styleId'));
      }
      return;
    case 'drawing.chen.createDocument':
      if (!checkObject(problems, args, path, {
        required: ['localKey', 'name', 'pageName', 'graph', 'themeId', 'styleId'], optional: [],
      })) return;
      checkString(problems, args.localKey, `${path}.localKey`, {min: 1, max: 240});
      checkString(problems, args.name, `${path}.name`, {min: 1, max: 240});
      checkString(problems, args.pageName, `${path}.pageName`, {min: 1, max: 240});
      validateChenGraph(problems, args.graph, `${path}.graph`);
      if (!['default', 'fresh', 'dopamine', 'dusk'].includes(args.themeId)) {
        problems.push(issue('OUTPUT_SCHEMA_INVALID', `${path}.themeId`, 'invalid themeId'));
      }
      if (!['standard', 'sketch', 'oil'].includes(args.styleId)) {
        problems.push(issue('OUTPUT_SCHEMA_INVALID', `${path}.styleId`, 'invalid styleId'));
      }
      return;
    case 'drawing.chen.patch':
      if (!checkObject(problems, args, path, {required: ['pageId', 'changes'], optional: []})) return;
      checkString(problems, args.pageId, `${path}.pageId`, {min: 1, max: 240});
      if (checkArray(problems, args.changes, `${path}.changes`, {min: 1, max: 200})) {
        args.changes.forEach((change, i) => validateChenChange(problems, change, `${path}.changes[${i}]`));
      }
      return;
    default:
      problems.push(issue('UNKNOWN_COMMAND', `${path}`, `unknown command ${command}`));
  }
};

const KNOWN_COMMANDS = ['model.table.create', 'model.field.add', 'model.foreignKey.create',
  'model.diagram.create', 'standard.group.create', 'standard.root.create', 'standard.field.create',
  'quality.modelRuleSet.create', 'drawing.chen.createPage', 'drawing.chen.createDocument',
  'drawing.chen.patch'];

// Full structural validation. Returns {ok, problems: Issue[]}.
export const validatePlanStructure = (plan) => {
  const problems = [];
  if (typeOf(plan) !== 'object') {
    return {ok: false, problems: [issue('OUTPUT_SCHEMA_INVALID', 'plan', 'plan must be an object')]};
  }
  const dangerous = findDangerousKey(plan, 'plan');
  if (dangerous) {
    problems.push(issue('OUTPUT_SCHEMA_INVALID', dangerous, 'dangerous property key rejected'));
    return {ok: false, problems};
  }
  checkObject(problems, plan, 'plan', {
    required: ['protocolVersion', 'planId', 'scope', 'baseVersion', 'contextDigest',
      'readSet', 'expiresAt', 'summary', 'assumptions', 'operations', 'planHash'],
    optional: [],
  });
  if (plan.protocolVersion !== '1.0') {
    problems.push(issue('OUTPUT_SCHEMA_INVALID', 'plan.protocolVersion', 'protocolVersion must be 1.0'));
  }
  checkString(problems, plan.planId, 'plan.planId', {min: 1, max: 240});
  if (checkObject(problems, plan.scope, 'plan.scope', {
    required: ['platform', 'projectSessionId'], optional: ['documentId'],
  })) {
    if (!['modeling', 'drawing'].includes(plan.scope.platform)) {
      problems.push(issue('OUTPUT_SCHEMA_INVALID', 'plan.scope.platform', 'invalid platform'));
    }
    checkString(problems, plan.scope.projectSessionId, 'plan.scope.projectSessionId', {min: 1, max: 240});
    if (plan.scope.documentId !== undefined) {
      checkString(problems, plan.scope.documentId, 'plan.scope.documentId', {min: 1, max: 240});
    }
  }
  checkString(problems, plan.baseVersion, 'plan.baseVersion', {min: 1, max: 240});
  checkString(problems, plan.contextDigest, 'plan.contextDigest', {pattern: HEX64});
  if (checkArray(problems, plan.readSet, 'plan.readSet', {min: 1, max: 500})) {
    const resources = new Set();
    plan.readSet.forEach((entry, i) => {
      const p = `plan.readSet[${i}]`;
      if (checkObject(problems, entry, p, {required: ['resource', 'fingerprint'], optional: []})) {
        checkString(problems, entry.resource, `${p}.resource`, {min: 1, max: 240});
        checkString(problems, entry.fingerprint, `${p}.fingerprint`, {pattern: HEX64});
        if (resources.has(entry.resource)) {
          problems.push(issue('OUTPUT_SCHEMA_INVALID', p, 'duplicate readSet resource'));
        }
        resources.add(entry.resource);
      }
    });
  }
  checkString(problems, plan.expiresAt, 'plan.expiresAt', {pattern: ISO_DATETIME});
  checkString(problems, plan.summary, 'plan.summary', {max: 8000});
  if (checkArray(problems, plan.assumptions, 'plan.assumptions', {min: 0, max: 30})) {
    plan.assumptions.forEach((item, i) => checkString(problems, item, `plan.assumptions[${i}]`, {max: 8000}));
  }
  checkString(problems, plan.planHash, 'plan.planHash', {pattern: HEX64});
  if (checkArray(problems, plan.operations, 'plan.operations', {min: 1, max: 200})) {
    const opIds = new Set();
    plan.operations.forEach((operation, i) => {
      const p = `plan.operations[${i}]`;
      if (!checkObject(problems, operation, p, {required: ['opId', 'command', 'dependsOn', 'args'], optional: []})) return;
      checkString(problems, operation.opId, `${p}.opId`, {min: 1, max: 240});
      if (opIds.has(operation.opId)) {
        problems.push(issue('OUTPUT_SCHEMA_INVALID', `${p}.opId`, 'duplicate opId'));
      }
      opIds.add(operation.opId);
      if (!KNOWN_COMMANDS.includes(operation.command)) {
        problems.push(issue('UNKNOWN_COMMAND', `${p}.command`, `unknown command ${operation.command}`));
      }
      if (checkArray(problems, operation.dependsOn, `${p}.dependsOn`, {min: 0, max: 200, unique: true})) {
        operation.dependsOn.forEach((dep, j) => checkString(problems, dep, `${p}.dependsOn[${j}]`, {min: 1, max: 240}));
      }
      validateOperationArgs(problems, operation.command, operation.args, `${p}.args`);
    });
    // Platform/command namespace rule from the schema allOf.
    const drawingPlatform = plan.scope?.platform === 'drawing';
    plan.operations.forEach((operation, i) => {
      if (typeof operation.command !== 'string') return;
      const isDrawing = operation.command.startsWith('drawing.');
      if (drawingPlatform && !isDrawing) {
        problems.push(issue('OUTPUT_SCHEMA_INVALID', `plan.operations[${i}].command`,
          'drawing plan cannot contain modeling commands'));
      }
      if (!drawingPlatform && isDrawing) {
        problems.push(issue('OUTPUT_SCHEMA_INVALID', `plan.operations[${i}].command`,
          'modeling plan cannot contain drawing commands'));
      }
    });
  }
  return {ok: problems.length === 0, problems};
};

// Scan raw JSON text for duplicate keys within the same object. Strings are
// skipped with escape handling so keys containing braces/quotes do not confuse
// the state machine. Returns the first duplicated key or null.
export const findDuplicateJsonKey = (text) => {
  const stack = [{keys: new Set(), isArray: false}];
  let expectKey = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '{') {
      stack.push({keys: new Set(), isArray: false});
      expectKey = true;
      i += 1;
      continue;
    }
    if (ch === '[') {
      stack.push({keys: new Set(), isArray: true});
      expectKey = false;
      i += 1;
      continue;
    }
    if (ch === '}' || ch === ']') {
      stack.pop();
      expectKey = false;
      i += 1;
      continue;
    }
    if (ch === ',') {
      const top = stack[stack.length - 1];
      expectKey = !top.isArray;
      i += 1;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let value = '';
      while (j < text.length) {
        if (text[j] === '\\') {
          value += text[j] + (text[j + 1] === undefined ? '' : text[j + 1]);
          j += 2;
          continue;
        }
        if (text[j] === '"') break;
        value += text[j];
        j += 1;
      }
      const top = stack[stack.length - 1];
      if (expectKey) {
        if (top.keys.has(value)) return value;
        top.keys.add(value);
        expectKey = false;
      }
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return null;
};

// Parse plan JSON text: duplicate JSON keys are rejected (a later key would
// silently overwrite an earlier one); dangerous prototype keys are rejected by
// validatePlanStructure through findDangerousKey.
export const parsePlanText = (text) => {
  if (typeof text !== 'string') {
    return {ok: false, problems: [issue('OUTPUT_SCHEMA_INVALID', 'plan', 'plan text must be a string')]};
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return {ok: false, problems: [issue('OUTPUT_SCHEMA_INVALID', 'plan', `invalid JSON: ${e.message}`)]};
  }
  const duplicate = findDuplicateJsonKey(text);
  if (duplicate) {
    return {ok: false, problems: [issue('OUTPUT_SCHEMA_INVALID', 'plan', `duplicate JSON key: ${duplicate}`)]};
  }
  return validatePlanStructure(parsed);
};
