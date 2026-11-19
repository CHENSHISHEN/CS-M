// Declarative model-quality DSL (ARCHITECTURE §8): a closed predicate set
// interpreted by plain functions. First phase predicates: required,
// hasPrimaryKey, nameStyle, standardMatch. No new Function/eval/programCode is
// ever produced here; unknown predicates are rejected/errored, never `true`.
// Check results separate pass / fail / error / notApplicable (Q04).
import {composeAbbreviation} from '../data_standard_library.js';

const text = (value) => {
  if (value === undefined || value === null) return '';
  return String(value);
};
const normalized = value => text(value).normalize('NFKC').trim().toLocaleLowerCase();

export const QUALITY_SCHEMA_VERSION = 1;
export const SUPPORTED_PREDICATES = ['required', 'hasPrimaryKey', 'nameStyle', 'standardMatch'];

export const DEFAULT_QUALITY_BUDGET = {
  maxObjectsPerRuleSet: 500,
  maxTotalEvaluations: 10000,
};

const NAME_STYLES = {
  snake_lower: /^[a-z_][a-z0-9_]*$/,
  snake_upper: /^[A-Z_][A-Z0-9_]*$/,
  camel_lower: /^[a-z][a-zA-Z0-9]*$/,
};

export const readQualityProfile = (dataSource) => {
  const quality = dataSource?.profile?.quality;
  if (!quality || quality.schemaVersion !== QUALITY_SCHEMA_VERSION) {
    return {schemaVersion: QUALITY_SCHEMA_VERSION, modelRuleSets: [], dataRuleSets: []};
  }
  return {
    schemaVersion: QUALITY_SCHEMA_VERSION,
    modelRuleSets: Array.isArray(quality.modelRuleSets) ? quality.modelRuleSets : [],
    dataRuleSets: Array.isArray(quality.dataRuleSets) ? quality.dataRuleSets : [],
  };
};

// Structural validation of one rule (beyond the plan schema): closed predicate
// set with closed parameters. Unknown predicates are `unsupported` — they are
// never silently satisfied.
export const validateQualityRule = (rule) => {
  const problems = [];
  const predicate = rule?.predicate;
  if (!predicate || typeof predicate !== 'object') {
    problems.push({code: 'INVALID_PREDICATE', message: 'rule predicate missing'});
    return problems;
  }
  switch (predicate.op) {
    case 'required':
      if (!['defKey', 'defName', 'comment'].includes(predicate.field)) {
        problems.push({code: 'INVALID_PREDICATE', message: `required.field invalid: ${predicate.field}`});
      }
      break;
    case 'hasPrimaryKey':
      break;
    case 'nameStyle':
      if (!NAME_STYLES[predicate.style]) {
        problems.push({code: 'INVALID_PREDICATE', message: `nameStyle.style invalid: ${predicate.style}`});
      }
      break;
    case 'standardMatch':
      if (!Array.isArray(predicate.standardRefs) || !predicate.standardRefs.length) {
        problems.push({code: 'INVALID_PREDICATE', message: 'standardMatch.standardRefs empty'});
      }
      break;
    default:
      problems.push({code: 'UNSUPPORTED_PREDICATE', message: `unknown predicate: ${predicate.op}`});
  }
  return problems;
};

export const validateQualityRuleSet = (ruleSet) => {
  const problems = [];
  if (!ruleSet || typeof ruleSet !== 'object') {
    return [{code: 'INVALID_RULE_SET', message: 'rule set must be an object'}];
  }
  if (!text(ruleSet.name).trim()) problems.push({code: 'NAME_REQUIRED', message: 'rule set name empty'});
  if (typeof ruleSet.enabled !== 'boolean') {
    problems.push({code: 'ENABLED_REQUIRED', message: 'rule set enabled must be boolean'});
  }
  if (!Array.isArray(ruleSet.rules) || ruleSet.rules.length === 0) {
    problems.push({code: 'RULES_REQUIRED', message: 'rule set needs at least one rule'});
    return problems;
  }
  ruleSet.rules.forEach((rule) => {
    if (!text(rule?.name).trim()) problems.push({code: 'NAME_REQUIRED', message: 'rule name empty'});
    if (!['warning', 'error'].includes(rule?.severity)) {
      problems.push({code: 'SEVERITY_INVALID', message: `rule severity invalid: ${rule?.severity}`});
    }
    if (!['physicalTable', 'logicalEntity', 'field', 'conceptEntity'].includes(rule?.target)) {
      problems.push({code: 'TARGET_INVALID', message: `rule target invalid: ${rule?.target}`});
    }
    validateQualityRule(rule).forEach(problem => problems.push(problem));
  });
  return problems;
};

const collectionForTarget = {
  physicalTable: 'entities',
  logicalEntity: 'logicEntities',
  conceptEntity: 'conceptEntities',
};

// Resolve scope entries ({collection, id}) to concrete objects; field scopes
// resolve to (entity, field) pairs.
const resolveScopeObject = (dataSource, entry, target) => {
  if (!entry || typeof entry !== 'object') return {error: 'INVALID_SCOPE'};
  if (target === 'field') {
    if (entry.collection !== 'fields') return {error: 'FIELD_SCOPE_EXPECTED'};
    const ownerCollection = entry.owner?.collection;
    if (!['entities', 'logicEntities', 'conceptEntities'].includes(ownerCollection)) {
      return {error: 'FIELD_OWNER_INVALID'};
    }
    const owner = (dataSource?.[ownerCollection] || []).find(item => item.id === entry.owner.id);
    if (!owner) return {error: 'OWNER_MISSING'};
    const field = (owner.fields || []).find(item => item.id === entry.id);
    if (!field) return {error: 'FIELD_MISSING'};
    return {owner, field};
  }
  const collection = collectionForTarget[target];
  if (!collection || entry.collection !== collection) {
    return {error: 'SCOPE_COLLECTION_MISMATCH'};
  }
  const object = (dataSource?.[collection] || []).find(item => item.id === entry.id);
  if (!object) return {error: 'SCOPE_OBJECT_MISSING'};
  return {object};
};

const findStandardField = (dataSource, id) => {
  const groups = dataSource?.standardFields || [];
  for (const group of groups) {
    const field = (group.fields || []).find(item => item.id === id);
    if (field) return {field, group};
  }
  return null;
};

const findWordRoot = (dataSource, id) =>
  (dataSource?.profile?.fieldRecommendation?.wordRoots || []).find(item => item.id === id) || null;

// standardMatch: all-roots refs compose one expected abbreviation; standard
// field refs are alternative expected codes. Comparison is normalized
// (NFKC + case-insensitive); expected codes stay in their stored spelling.
const evaluateStandardMatch = (dataSource, predicate, actualValue) => {
  const refs = predicate.standardRefs || [];
  const expectedCodes = [];
  const roots = [];
  for (const ref of refs) {
    if (ref.kind !== 'existing') {
      return {status: 'error', message: 'standardMatch requires existing references'};
    }
    if (ref.collection === 'wordRoots') {
      const root = findWordRoot(dataSource, ref.id);
      if (!root) return {status: 'error', message: `word root missing: ${ref.id}`};
      roots.push(root);
    } else if (ref.collection === 'standardFields') {
      const hit = findStandardField(dataSource, ref.id);
      if (!hit) return {status: 'error', message: `standard field missing: ${ref.id}`};
      expectedCodes.push(hit.field.defKey);
    } else if (ref.collection === 'standardGroups') {
      const group = (dataSource?.standardFields || []).find(item => item.id === ref.id);
      if (!group) return {status: 'error', message: `standard group missing: ${ref.id}`};
      (group.fields || []).forEach(field => expectedCodes.push(field.defKey));
    } else {
      return {status: 'error', message: `unsupported standardMatch collection: ${ref.collection}`};
    }
  }
  if (roots.length) expectedCodes.push(composeAbbreviation(roots));
  if (!expectedCodes.length) return {status: 'error', message: 'no expected code resolved'};
  const actual = normalized(actualValue);
  const hit = expectedCodes.some(code => normalized(code) === actual && actual !== '');
  return {
    status: hit ? 'pass' : 'fail',
    expected: expectedCodes,
    actual: text(actualValue),
  };
};

const result = (rule, objectRef, extra) => ({
  ruleId: rule.id,
  severity: rule.severity,
  objectRef,
  status: extra.status,
  actual: extra.actual,
  expected: extra.expected,
  message: extra.message || '',
  fieldRef: extra.fieldRef,
});

const evaluatePredicateOnObject = (dataSource, rule, scope) => {
  const predicate = rule.predicate;
  const objectRef = {collection: scope.entry.collection, id: scope.entry.id};
  const notApplicable = (message) => result(rule, objectRef, {status: 'notApplicable', message});
  if (rule.target === 'field') {
    const fieldRef = {owner: scope.entry.owner, id: scope.entry.id};
    if (predicate.op === 'required') {
      const value = text(scope.field[predicate.field]).trim();
      return result(rule, objectRef, {
        status: value ? 'pass' : 'fail', actual: value || '(empty)',
        expected: 'non-empty', fieldRef,
      });
    }
    if (predicate.op === 'nameStyle') {
      const pattern = NAME_STYLES[predicate.style];
      const value = text(scope.field.defKey).trim();
      return result(rule, objectRef, {
        status: pattern && pattern.test(value) ? 'pass' : 'fail',
        actual: value, expected: predicate.style, fieldRef,
      });
    }
    if (predicate.op === 'standardMatch') {
      const evaluation = evaluateStandardMatch(dataSource, predicate, scope.field.defKey);
      return result(rule, objectRef, {...evaluation, fieldRef});
    }
    return notApplicable('hasPrimaryKey does not apply to a field target');
  }
  const object = scope.object;
  if (predicate.op === 'required') {
    const value = text(object[predicate.field]).trim();
    return result(rule, objectRef, {
      status: value ? 'pass' : 'fail', actual: value || '(empty)', expected: 'non-empty',
    });
  }
  if (predicate.op === 'hasPrimaryKey') {
    if (rule.target === 'conceptEntity') {
      return notApplicable('concept entities carry attributes, not physical keys');
    }
    const hasKey = (object.fields || []).some(field => field.primaryKey);
    return result(rule, objectRef, {
      status: hasKey ? 'pass' : 'fail',
      actual: hasKey ? 'primaryKey present' : 'no primaryKey field',
      expected: 'at least one primaryKey field',
    });
  }
  if (predicate.op === 'nameStyle') {
    const pattern = NAME_STYLES[predicate.style];
    const value = text(object.defKey).trim();
    return result(rule, objectRef, {
      status: pattern && pattern.test(value) ? 'pass' : 'fail',
      actual: value, expected: predicate.style,
    });
  }
  if (predicate.op === 'standardMatch') {
    return notApplicable('standardMatch applies to field targets');
  }
  return result(rule, objectRef, {status: 'error', message: `unknown predicate: ${predicate.op}`});
};

// Run enabled model rule sets on the current snapshot. Read-only; never
// mutates the dataSource. Budget overruns surface as error results with
// BUDGET_EXCEEDED (Q02), never as passes.
export const runModelQuality = (dataSource, options) => {
  const budget = {...DEFAULT_QUALITY_BUDGET, ...(options?.budget || {})};
  const quality = readQualityProfile(dataSource);
  const output = {ruleSets: [], summary: {pass: 0, fail: 0, error: 0, notApplicable: 0, budgetExceeded: false}};
  let totalEvaluations = 0;
  quality.modelRuleSets.filter(ruleSet => ruleSet.enabled === true).forEach((ruleSet) => {
    const validation = validateQualityRuleSet(ruleSet);
    if (validation.length) {
      output.ruleSets.push({
        id: ruleSet.id, name: ruleSet.name, enabled: true,
        problems: validation,
        rules: validation.map(problem => ({
          ruleId: null,
          results: [result({id: null, severity: 'error'}, null, {
            status: 'error', message: problem.message,
          })],
        })),
      });
      output.summary.error += validation.length;
      return;
    }
    let objectsChecked = 0;
    const ruleReports = [];
    ruleSet.rules.forEach((rule) => {
      const results = [];
      (ruleSet.scope || []).forEach((entry) => {
        if (objectsChecked >= budget.maxObjectsPerRuleSet
          || totalEvaluations >= budget.maxTotalEvaluations) {
          results.push(result(rule, {collection: entry.collection, id: entry.id}, {
            status: 'error', message: 'BUDGET_EXCEEDED',
          }));
          output.budgetExceeded = true;
          return;
        }
        objectsChecked += 1;
        totalEvaluations += 1;
        // A rule only applies to scope entries whose collection matches the
        // rule's target type; other entries are notApplicable, not errors.
        const expectedCollection = rule.target === 'field'
          ? 'fields' : collectionForTarget[rule.target];
        if (entry.collection !== expectedCollection) {
          results.push(result(rule, {collection: entry.collection, id: entry.id}, {
            status: 'notApplicable',
            message: `scope entry is ${entry.collection}, rule targets ${rule.target}`,
          }));
          return;
        }
        const scope = resolveScopeObject(dataSource, entry, rule.target);
        if (scope.error) {
          results.push(result(rule, {collection: entry.collection, id: entry.id}, {
            status: 'error', message: scope.error,
          }));
          return;
        }
        const scoped = rule.target === 'field'
          ? {entry, owner: scope.owner, field: scope.field}
          : {entry, object: scope.object};
        results.push(evaluatePredicateOnObject(dataSource, rule, scoped));
      });
      ruleReports.push({ruleId: rule.id, name: rule.name, results});
    });
    output.ruleSets.push({id: ruleSet.id, name: ruleSet.name, enabled: true, rules: ruleReports});
    ruleReports.forEach(report => report.results.forEach((r) => {
      if (r.status === 'pass') output.summary.pass += 1;
      else if (r.status === 'fail') output.summary.fail += 1;
      else if (r.status === 'error') output.summary.error += 1;
      else output.summary.notApplicable += 1;
    }));
  });
  return output;
};
