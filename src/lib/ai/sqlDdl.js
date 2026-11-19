// SQL DDL import for the AI modeling core (A0 decision): parsing is delegated
// entirely to node-sql-parser 5.3.13 dedicated dialect builds (mysql /
// postgresql). This module is a thin adapter from the parser AST to the
// statement DTO consumed by draftTableOpsFromDdl — it contains no hand-written
// SQL grammar. SQL is never executed. Statements and features outside the
// supported subset are reported explicitly with positions, never silently
// dropped or satisfied.
// No `??` operator (webpack4/acorn6 build chain).
import * as mysqlBuildModule from 'node-sql-parser/build/mysql.js';
import * as pgBuildModule from 'node-sql-parser/build/postgresql.js';

// The builds are CommonJS webpack bundles: Node ESM exposes them on
// `.default`, babel/webpack interop exposes named exports. Cover both.
const pickBuild = (mod) => {
  if (mod && mod.Parser) return mod;
  if (mod && mod.default && mod.default.Parser) return mod.default;
  throw new Error('node-sql-parser dialect build unavailable');
};
const MysqlBuild = pickBuild(mysqlBuildModule);
const PgBuild = pickBuild(pgBuildModule);

export const SQL_DIALECTS = ['mysql', 'postgresql'];

// ---- statement splitting (positions only — grammar lives in the parser) ----

// Quote/comment-aware statement splitter. Its ONLY job is to give each
// statement an accurate span in the original text (for error positions);
// parsing itself is done per statement by node-sql-parser.
const splitStatements = (text) => {
  const statements = [];
  const length = text.length;
  let start = -1; // start of current statement content
  let i = 0;
  const flush = (end) => {
    if (start >= 0 && end > start) {
      statements.push({sql: text.slice(start, end), start, end});
    }
    start = -1;
  };
  while (i < length) {
    const ch = text[i];
    if (start < 0 && /\s/.test(ch)) { i += 1; continue; }
    if (ch === '-' && text[i + 1] === '-') {
      if (start < 0) { i += 2; while (i < length && text[i] !== '\n') i += 1; continue; }
      i += 2; while (i < length && text[i] !== '\n') i += 1; continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (start < 0) start = i;
    if (ch === '\'' || ch === '"' || ch === '`') {
      const quote = ch;
      i += 1;
      while (i < length) {
        if (text[i] === '\\' && quote !== '`') { i += 2; continue; }
        if (text[i] === quote) {
          if (text[i + 1] === quote) { i += 2; continue; }
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    // PostgreSQL dollar-quoted bodies ($$ ... $$ / $tag$ ... $tag$).
    if (ch === '$') {
      const match = /^\$[A-Za-z0-9_]*\$/.exec(text.slice(i));
      if (match) {
        const tag = match[0];
        const close = text.indexOf(tag, i + tag.length);
        i = close < 0 ? length : close + tag.length;
        continue;
      }
    }
    if (ch === ';') {
      flush(i);
      i += 1;
      continue;
    }
    i += 1;
  }
  flush(length);
  let line = 1;
  let cursor = 0;
  return statements.map((statement) => {
    while (cursor < statement.start) {
      if (text[cursor] === '\n') line += 1;
      cursor += 1;
    }
    return {...statement, line};
  });
};

const statementTypeOfText = (sql) => {
  const words = sql.trim().split(/\s+/)
    .map(word => word.replace(/[^A-Za-z_]/g, '').toUpperCase()).filter(Boolean);
  if (words[0] === 'CREATE') {
    if (words[1] === 'OR' && words[2] === 'REPLACE') return `CREATE OR REPLACE ${(words[3] || '').toUpperCase()}`.trim();
    return `CREATE ${(words[1] || '').toUpperCase()}`.trim();
  }
  return words[0] || 'UNKNOWN';
};

// ---- AST → statement DTO ----

// Identifiers: mysql gives plain strings; postgresql wraps them
// ({expr: {type: 'double_quote_string'|'default', value}}).
const identValue = (node) => {
  if (node === null || node === undefined) return null;
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (node.expr && typeof node.expr === 'object' && 'value' in node.expr) return node.expr.value;
  if (typeof node.value === 'string') return node.value;
  return null;
};

const tableInfoOf = (tableParts) => {
  const part = Array.isArray(tableParts) ? tableParts[0] : tableParts;
  const table = identValue(part && part.table);
  const db = part && part.db ? identValue(part.db) : null;
  return {
    table: {value: table},
    prefix: db,
    fullName: db ? `${db}.${table}` : table,
  };
};

// Type text without the parenthesized length/scale (len/scale travel as
// separate DTO fields); suffix words (UNSIGNED, WITH TIME ZONE) and array
// markers are preserved.
const typeInfoOf = (definition) => {
  if (!definition || !definition.dataType) return null;
  const suffixText = (definition.suffix || []).map(suffix => ` ${suffix}`).join('');
  const dimension = definition.array ? (definition.array.dimension || 1) : 0;
  const arrayText = '[]'.repeat(dimension);
  return {
    raw: `${definition.dataType}${suffixText}${arrayText}`,
    base: definition.dataType,
    len: definition.length === undefined || definition.length === null ? null : definition.length,
    scale: definition.scale === undefined || definition.scale === null ? null : definition.scale,
  };
};

const defaultRawOf = (parser, defaultNode) => {
  if (!defaultNode || defaultNode.value === undefined || defaultNode.value === null) return null;
  try {
    const sql = parser.exprToSQL(defaultNode.value);
    if (typeof sql === 'string' && sql.length) return sql;
  } catch (e) {
    // fall through to a conservative rendering
  }
  return JSON.stringify(defaultNode.value);
};

const mapForeignKey = (def) => {
  const reference = def.reference_definition || {};
  const refTable = tableInfoOf(reference.table);
  const fk = {
    name: def.constraint || def.index || null,
    columns: (def.definition || []).map(item => identValue(item.column)),
    refTable: {value: refTable.fullName},
    refColumns: (reference.definition || []).map(item => identValue(item.column)),
  };
  (reference.on_action || []).forEach((action) => {
    const value = String((action.value && action.value.value) || '').toUpperCase();
    if (action.type === 'on delete') fk.onDelete = value;
    if (action.type === 'on update') fk.onUpdate = value;
  });
  return fk;
};

const mapColumn = (parser, def) => {
  const column = {
    name: {value: identValue(def.column && def.column.column)},
    type: typeInfoOf(def.definition),
    notNull: !!(def.nullable && def.nullable.type === 'not null'),
    primaryKey: def.primary_key === 'primary key',
    autoIncrement: def.auto_increment === 'auto_increment',
  };
  if (def.comment && def.comment.value && def.comment.value.value !== undefined
    && def.comment.value.value !== null) {
    column.comment = def.comment.value.value;
  }
  const defaultRaw = defaultRawOf(parser, def.default_val);
  if (defaultRaw !== null) column.defaultValue = {raw: defaultRaw};
  return column;
};

const mapCreateTable = (parser, ast, range) => {
  const table = tableInfoOf(ast.table);
  const statement = {
    kind: 'createTable',
    table: {table: table.table, prefix: table.prefix, fullName: table.fullName},
    columns: [],
    foreignKeys: [],
    indexes: [],
    uniques: [],
    primaryKey: null,
    unsupportedFeatures: [],
    otherTableOptions: [],
    range,
  };
  if (ast.query_expr || ast.as) {
    statement.unsupportedFeatures.push({feature: 'createTableAsSelect'});
  }
  (ast.create_definitions || []).forEach((def) => {
    if (def.resource === 'column') {
      if (def.generated) {
        statement.unsupportedFeatures.push({feature: 'generatedColumn'});
        return;
      }
      // Inline column CHECK: both dialect builds surface it as def.check —
      // report it instead of silently dropping the constraint.
      if (def.check) {
        statement.unsupportedFeatures.push({
          feature: 'checkConstraint',
          column: identValue(def.column && def.column.column),
        });
      }
      const column = mapColumn(parser, def);
      statement.columns.push(column);
      if (def.reference_definition) {
        // Inline `col type REFERENCES other (id)` foreign key.
        const inline = mapForeignKey({
          definition: [{column: def.column && def.column.column}],
          reference_definition: def.reference_definition,
        });
        statement.foreignKeys.push(inline);
      }
      return;
    }
    const constraintType = String(def.constraint_type || '').toLowerCase();
    if (constraintType === 'foreign key') {
      statement.foreignKeys.push(mapForeignKey(def));
      return;
    }
    if (constraintType === 'primary key') {
      statement.primaryKey = {
        columns: (def.definition || []).map(item => identValue(item.column)),
      };
      return;
    }
    if (constraintType === 'unique key' || constraintType === 'unique') {
      statement.uniques.push({
        name: def.constraint || def.index || null,
        columns: (def.definition || []).map(item => identValue(item.column)),
      });
      return;
    }
    if (constraintType === 'check') {
      statement.unsupportedFeatures.push({feature: 'checkConstraint'});
      return;
    }
    if (def.resource === 'index' || def.keyword === 'key' || def.keyword === 'index') {
      statement.indexes.push({
        name: def.index || null,
        columns: (def.definition || []).map(item => identValue(item.column)),
      });
      return;
    }
    statement.unsupportedFeatures.push({feature: `createDefinition:${def.resource || constraintType || 'unknown'}`});
  });
  if (!statement.primaryKey) {
    const columnKeys = statement.columns
      .filter(column => column.primaryKey)
      .map(column => column.name.value);
    if (columnKeys.length) statement.primaryKey = {columns: columnKeys};
  }
  (ast.table_options || []).forEach((option) => {
    if (option.keyword === 'comment' && typeof option.value === 'string') {
      const value = option.value.trim();
      statement.tableComment = ((value[0] === '\'' && value[value.length - 1] === '\'')
        || (value[0] === '"' && value[value.length - 1] === '"'))
        ? value.slice(1, -1) : value;
      return;
    }
    // Every other table option (ENGINE, CHARSET, ...) has no target-side
    // representation: record it so the draft layer can report the loss.
    statement.otherTableOptions.push({keyword: option.keyword === undefined ? null : option.keyword});
  });
  return statement;
};

const mapCreateIndex = (ast, range) => {
  const table = tableInfoOf(ast.table);
  const statement = {
    kind: 'createIndex',
    index: {
      name: ast.index || null,
      unique: ast.index_type === 'unique',
      table: table.fullName,
      columns: (ast.index_columns || []).map(item => identValue(item.column)),
    },
    unsupportedFeatures: [],
    range,
  };
  if (ast.where) statement.unsupportedFeatures.push({feature: 'partialIndex'});
  if (ast.include) statement.unsupportedFeatures.push({feature: 'includeIndex'});
  if (ast.index_using) statement.unsupportedFeatures.push({feature: 'indexUsing'});
  return statement;
};

// One ALTER statement can carry several actions; supported actions map to
// statements, anything else makes the whole ALTER unsupported (explicit, no
// partial understanding of a single statement).
const mapAlterTable = (ast, range) => {
  const table = tableInfoOf(ast.table);
  const tableRef = {table: table.table, prefix: table.prefix, fullName: table.fullName};
  const supported = [];
  let unsupported = false;
  (ast.expr || []).forEach((action) => {
    if (action.action !== 'add') { unsupported = true; return; }
    const def = action.create_definitions;
    if (def && def.constraint_type === 'FOREIGN KEY') {
      supported.push({
        kind: 'alterForeignKey',
        table: tableRef,
        foreignKey: mapForeignKey(def),
        range,
      });
      return;
    }
    if (action.resource === 'index') {
      supported.push({
        kind: 'alterIndex',
        table: tableRef,
        index: {
          name: action.index || null,
          unique: action.index_type === 'unique',
          columns: (action.definition || []).map(item => identValue(item.column)),
        },
        range,
      });
      return;
    }
    unsupported = true;
  });
  if (unsupported || !supported.length) {
    return [{
      kind: 'unsupported',
      statementType: 'ALTER TABLE',
      reason: 'unsupported ALTER TABLE action (only ADD FOREIGN KEY / ADD INDEX are supported)',
      range,
    }];
  }
  return supported;
};

const mapStatement = (parser, ast, range) => {
  if (!ast || typeof ast !== 'object') {
    return [{kind: 'unsupported', statementType: 'UNKNOWN', reason: 'empty statement', range}];
  }
  if (ast.type === 'create' && ast.keyword === 'table') return [mapCreateTable(parser, ast, range)];
  if (ast.type === 'create' && ast.keyword === 'index') return [mapCreateIndex(ast, range)];
  if (ast.type === 'alter') return mapAlterTable(ast, range);
  const statementType = ast.type === 'create'
    ? `CREATE ${String(ast.keyword || '').toUpperCase()}`.trim()
    : String(ast.type || 'UNKNOWN').toUpperCase();
  return [{
    kind: 'unsupported',
    statementType,
    reason: 'statement outside the supported DDL subset',
    range,
  }];
};

// ---- conservative blind-spot pre-check ----
// Restricted keyword scan over the statement text, aware of strings, quoted
// identifiers, comments and dollar-quoted bodies. It never parses anything:
// its only job is to flag a statement whose text contains CHECK while the AST
// reported no check constraint at all (a known upstream blind spot), so the
// statement is marked SQL_PARTIAL_PARSE with a position instead of being
// silently imported without the constraint. Exported as a pure helper so the
// guard layer itself stays testable and reusable for host-side diagnostics.
export const findKeywordOutsideQuotes = (sql, keyword) => {
  const length = sql.length;
  const target = keyword.toLowerCase();
  const isWordChar = ch => /[A-Za-z0-9_$]/.test(ch);
  let i = 0;
  while (i < length) {
    const ch = sql[i];
    if (ch === '-' && sql[i + 1] === '-') {
      i += 2; while (i < length && sql[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && sql[i + 1] === '*') {
      i += 2; while (i < length && !(sql[i] === '*' && sql[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') {
      const quote = ch;
      i += 1;
      while (i < length) {
        if (sql[i] === '\\' && quote !== '`') { i += 2; continue; }
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) { i += 2; continue; }
          i += 1; break;
        }
        i += 1;
      }
      continue;
    }
    if (ch === '$') {
      const match = /^\$[A-Za-z0-9_]*\$/.exec(sql.slice(i));
      if (match) {
        const tag = match[0];
        const close = sql.indexOf(tag, i + tag.length);
        i = close < 0 ? length : close + tag.length;
        continue;
      }
    }
    if (ch.toLowerCase() === target[0]
      && !(i > 0 && isWordChar(sql[i - 1]))
      && sql.slice(i, i + target.length).toLowerCase() === target
      && !(i + target.length < length && isWordChar(sql[i + target.length]))) {
      return i;
    }
    i += 1;
  }
  return null;
};

// ---- Entry point ----
export const parseDdlScript = (text, options = {}) => {
  const dialect = options.dialect;
  if (!SQL_DIALECTS.includes(dialect)) {
    return {
      dialect: dialect || null,
      error: 'DIALECT_UNSUPPORTED',
      supportedDialects: SQL_DIALECTS.slice(),
      statements: [],
    };
  }
  const source = String(text || '');
  const parser = dialect === 'mysql' ? new MysqlBuild.Parser() : new PgBuild.Parser();
  const statements = [];
  const errors = [];
  splitStatements(source).forEach(({sql, start, end, line}) => {
    const range = {start, end, line};
    let ast = null;
    try {
      ast = parser.astify(sql);
      if (Array.isArray(ast)) ast = ast[0];
    } catch (error) {
      const message = String((error && error.message) || 'parse error').slice(0, 160);
      errors.push({message, range});
      statements.push({
        kind: 'unsupported',
        statementType: statementTypeOfText(sql),
        reason: `parse failed: ${message}`,
        range,
      });
      return;
    }
    const added = mapStatement(parser, ast, range);
    statements.push(...added);
    // Blind-spot guard: text says CHECK but the AST reported none.
    added.forEach((statement) => {
      if (statement.kind !== 'createTable') return;
      const hasCheck = (statement.unsupportedFeatures || [])
        .some(entry => entry.feature === 'checkConstraint');
      if (hasCheck) return;
      const offset = findKeywordOutsideQuotes(sql, 'check');
      if (offset === null) return;
      const line = range.line + (sql.slice(0, offset).match(/\n/g) || []).length;
      statement.unsupportedFeatures.push({
        feature: 'inlineCheckBlindSpot',
        line,
        start: range.start + offset,
        end: range.start + offset + 5,
      });
    });
  });
  const summary = {createTable: 0, createIndex: 0, alterForeignKey: 0, alterIndex: 0, unsupported: 0};
  statements.forEach((statement) => {
    if (statement.kind === 'createTable') summary.createTable += 1;
    else if (statement.kind === 'createIndex') summary.createIndex += 1;
    else if (statement.kind === 'alterForeignKey') summary.alterForeignKey += 1;
    else if (statement.kind === 'alterIndex') summary.alterIndex += 1;
    else summary.unsupported += 1;
  });
  return {
    dialect,
    statements,
    errors,
    summary,
    unsupportedStatements: statements.filter(statement => statement.kind === 'unsupported'),
  };
};

// ---- DDL → command drafts ----
const sanitizeKey = value => String(value || '')
  .replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+|_+$/g, '') || 'tbl';

// Draft model.table.create / model.foreignKey.create argument shapes from a
// parsed script. Anything the command subset cannot express (indexes, unique
// constraints, auto-increment, CHECK/unsupported features, FK referential
// actions, non-comment table options, standalone CREATE INDEX) is reported as
// a positioned loss; drafts are blocked with SQL_PARTIAL_PARSE until the
// caller acknowledges, then only the expressible subset is drafted. Drafts
// never invent local IDs: dbType/database/category refs stay with the host.
export const draftTableOpsFromDdl = (parseResult, options = {}) => {
  const unsupported = parseResult.unsupportedStatements || [];
  const statements = parseResult.statements || [];
  const tables = statements.filter(statement => statement.kind === 'createTable');

  // Table identity is schema-qualified; the same bare name in two schemas
  // never overwrites silently (Map is keyed by the full name).
  const fullNameOf = statement => statement.table.fullName || statement.table.table.value;
  const slugOf = (statement) => {
    const prefix = statement.table.prefix;
    const table = statement.table.table.value;
    return prefix ? `${sanitizeKey(prefix)}_${sanitizeKey(table)}` : sanitizeKey(table);
  };
  const bareName = statement => String(statement.table.table.value).toLowerCase();
  const bareCounts = new Map();
  tables.forEach((statement) => {
    bareCounts.set(bareName(statement), (bareCounts.get(bareName(statement)) || 0) + 1);
  });
  const hasBareConflict = statement => (bareCounts.get(bareName(statement)) || 0) > 1;

  const byKey = new Map(tables.map(statement => [String(fullNameOf(statement)).toLowerCase(), statement]));
  const bareIndex = new Map();
  tables.forEach((statement) => {
    if (!bareIndex.has(bareName(statement))) bareIndex.set(bareName(statement), []);
    bareIndex.get(bareName(statement)).push(statement);
  });
  // A bare reference resolves only when unambiguous; same name in two
  // schemas stays pending instead of guessing one of them.
  const lookupTable = (refValue) => {
    const key = String(refValue || '').toLowerCase();
    if (byKey.has(key)) return byKey.get(key);
    const candidates = bareIndex.get(key.split('.').pop()) || [];
    return candidates.length === 1 ? candidates[0] : null;
  };

  // ---- positioned feature losses ----
  const losses = [];
  const rangeOf = statement => ({line: statement.range.line, start: statement.range.start, end: statement.range.end});
  tables.forEach((statement) => {
    const tableLabel = fullNameOf(statement);
    const range = rangeOf(statement);
    statement.indexes.forEach(index => losses.push({
      kind: 'index', table: tableLabel, name: index.name, columns: index.columns, ...range,
    }));
    statement.uniques.forEach(unique => losses.push({
      kind: 'unique', table: tableLabel, name: unique.name, columns: unique.columns,
      note: 'uniqueness (and any 1:1 cardinality it implies) is not expressible', ...range,
    }));
    statement.columns.forEach((column) => {
      if (column.autoIncrement) {
        losses.push({kind: 'autoIncrement', table: tableLabel, column: column.name.value, ...range});
      }
    });
    (statement.unsupportedFeatures || []).forEach(entry => losses.push({
      kind: 'unsupportedFeature', table: tableLabel, feature: entry.feature, ...range,
    }));
    (statement.otherTableOptions || []).forEach(option => losses.push({
      kind: 'tableOption', table: tableLabel, option: option.keyword, ...range,
    }));
    statement.foreignKeys.forEach((fk) => {
      ['onDelete', 'onUpdate'].forEach((action) => {
        if (fk[action]) {
          losses.push({kind: 'fkAction', table: tableLabel, foreignKey: fk.name,
            action, value: fk[action], ...range});
        }
      });
    });
    if (hasBareConflict(statement)) {
      losses.push({kind: 'schemaNameConflict', table: tableLabel,
        note: 'same table name in multiple schemas; defKey uses the schema-qualified name', ...range});
    }
  });
  statements
    .filter(statement => statement.kind === 'createIndex' || statement.kind === 'alterIndex')
    .forEach((statement) => {
      losses.push({kind: 'standaloneIndex',
        table: statement.kind === 'createIndex' ? statement.index.table : fullNameOf(statement),
        name: statement.index.name, unique: statement.index.unique === true,
        columns: statement.index.columns, ...rangeOf(statement)});
    });

  if ((unsupported.length || losses.length) && !options.acknowledgeUnsupported) {
    return {
      blocked: 'SQL_PARTIAL_PARSE',
      unsupported: unsupported.map(statement => ({
        statementType: statement.statementType,
        reason: statement.reason,
        line: statement.range.line,
        start: statement.range.start,
        end: statement.range.end,
      })),
      losses,
    };
  }

  // ---- expressible subset: table ops with unique, schema-aware ids ----
  const operations = [];
  const pendingForeignKeys = [];
  const usedOpIds = new Set();
  const usedLocalKeys = new Set();
  const uniqueSuffix = (base, used, sep) => {
    let candidate = base;
    let n = 2;
    while (used.has(candidate)) {
      candidate = `${base}${sep}${n}`;
      n += 1;
    }
    used.add(candidate);
    return candidate;
  };
  const tableOpIds = new Map();
  const tableLocalKeys = new Map();
  tables.forEach((statement) => {
    const slug = slugOf(statement);
    // Conflicting bare names keep their parsed schema-qualified identity;
    // unique names stay exactly as written.
    const defKey = hasBareConflict(statement) ? fullNameOf(statement) : statement.table.table.value;
    const localKey = uniqueSuffix(slug, usedLocalKeys, '_');
    const opId = uniqueSuffix(`op-${slug}`, usedOpIds, '-');
    tableOpIds.set(statement, opId);
    tableLocalKeys.set(statement, localKey);
    const fields = statement.columns.map(column => ({
      localKey: `${localKey}.${sanitizeKey(column.name.value)}`,
      defKey: column.name.value,
      defName: column.comment || column.name.value,
      type: column.type.raw,
      len: column.type.len,
      scale: column.type.scale,
      notNull: column.notNull || column.primaryKey,
      primaryKey: column.primaryKey
        || (statement.primaryKey || {columns: []}).columns.includes(column.name.value),
      ...(column.comment ? {comment: column.comment} : {}),
      ...(column.defaultValue ? {defaultValue: column.defaultValue.raw} : {}),
    }));
    operations.push({
      opId,
      command: 'model.table.create',
      dependsOn: [],
      args: {
        localKey,
        defKey,
        defName: statement.tableComment || defKey,
        ...(statement.tableComment ? {comment: statement.tableComment} : {}),
        // dbType/database/category refs are supplied by the host against the
        // target project; drafts never invent local IDs.
        fields,
      },
    });
  });
  const collectFk = (statement, fk, viaAlter) => {
    const refKey = String(fk.refTable.value || '').toLowerCase();
    const target = lookupTable(fk.refTable.value);
    const srcSlug = slugOf(statement);
    if (!target) {
      const candidates = bareIndex.get(refKey.split('.').pop()) || [];
      pendingForeignKeys.push({
        command: 'model.foreignKey.create',
        table: fullNameOf(statement),
        viaAlter,
        name: fk.name || `fk_${sanitizeKey(statement.table.table.value)}_${sanitizeKey(refKey)}`,
        columns: fk.columns,
        refTable: fk.refTable.value,
        refColumns: fk.refColumns,
        reason: candidates.length > 1
          ? 'ambiguous table reference (same bare name in multiple schemas)'
          : 'external',
      });
      return;
    }
    const targetSlug = slugOf(target);
    // Several FKs between the same two tables get deterministic, distinct
    // opIds/localKeys (constraint name when present, ordinal suffix otherwise).
    const base = `op-fk-${srcSlug}-${targetSlug}` + (fk.name ? `-${sanitizeKey(fk.name)}` : '');
    const opId = uniqueSuffix(base, usedOpIds, '-');
    const localKey = uniqueSuffix(`fk_${srcSlug}_${targetSlug}`, usedLocalKeys, '_');
    const srcKey = tableLocalKeys.get(statement);
    const tgtKey = tableLocalKeys.get(target);
    operations.push({
      opId,
      command: 'model.foreignKey.create',
      dependsOn: [tableOpIds.get(statement), tableOpIds.get(target)],
      args: {
        localKey,
        name: fk.name || `fk_${srcSlug}_${targetSlug}`,
        sourceTable: {kind: 'local', key: srcKey},
        sourceFields: fk.columns.map(column => ({kind: 'local', key: `${srcKey}.${sanitizeKey(column)}`})),
        targetTable: {kind: 'local', key: tgtKey},
        targetFields: (fk.refColumns.length ? fk.refColumns : fk.columns).map(column => ({
          kind: 'local', key: `${tgtKey}.${sanitizeKey(column)}`,
        })),
      },
    });
  };
  tables.forEach(statement => statement.foreignKeys.forEach(fk => collectFk(statement, fk, false)));
  statements
    .filter(statement => statement.kind === 'alterForeignKey')
    .forEach(statement => collectFk(statement, statement.foreignKey, true));
  return {
    blocked: null,
    operations,
    pendingForeignKeys,
    losses,
    acknowledged: unsupported.map(statement => statement.statementType),
  };
};
