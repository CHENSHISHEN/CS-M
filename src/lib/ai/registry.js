// Closed command registry. commit/inverse behaviour lives in the handlers,
// not in serializable data; there is deliberately no generic patch/eval
// command. Drawing commands are structurally valid plans but not registered
// here — the drawing domain registers its own executors later.
import {runTableCreate, runFieldAdd, runForeignKeyCreate, runDiagramCreate} from './commands/model.js';
import {runGroupCreate, runRootCreate, runStandardFieldCreate} from './commands/standard.js';
import {runQualityRuleSetCreate} from './commands/quality.js';

const modelingCommand = (name, run, summary) => ({
  name,
  platform: 'modeling',
  mode: 'propose',
  transactionDomain: 'modeling-project',
  run,
  summary,
});

const COMMANDS = [
  modelingCommand('model.table.create', runTableCreate,
    {args: 'localKey, defKey, defName, dbType, fields[], comment?, database?, category?'}),
  modelingCommand('model.field.add', runFieldAdd,
    {args: 'table, fields[]'}),
  modelingCommand('model.foreignKey.create', runForeignKeyCreate,
    {args: 'localKey, name, sourceTable, sourceFields[], targetTable, targetFields[]'}),
  modelingCommand('model.diagram.create', runDiagramCreate,
    {args: 'localKey, defKey, defName, tables[], level=physical'}),
  modelingCommand('standard.group.create', runGroupCreate,
    {args: 'localKey, defKey, defName'}),
  modelingCommand('standard.root.create', runRootCreate,
    {args: 'localKey, defKey, defName, fullName, baseType?'}),
  modelingCommand('standard.field.create', runStandardFieldCreate,
    {args: 'localKey, group, defKey, defName, baseType, wordRoots[], len?, scale?, comment?'}),
  modelingCommand('quality.modelRuleSet.create', runQualityRuleSetCreate,
    {args: 'localKey, name, enabled, targets[], rules[]'}),
];

export const REGISTRY = new Map(COMMANDS.map(command => [command.name, command]));

export const listCommands = () => [...REGISTRY.values()].map(command => ({
  name: command.name,
  platform: command.platform,
  mode: command.mode,
  transactionDomain: command.transactionDomain,
}));

export const describeCommand = (name) => {
  const command = REGISTRY.get(name);
  if (!command) return null;
  return {
    name: command.name,
    platform: command.platform,
    mode: command.mode,
    transactionDomain: command.transactionDomain,
    input: command.summary,
  };
};

export const getCommand = name => REGISTRY.get(name) || null;
