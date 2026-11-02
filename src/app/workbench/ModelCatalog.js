import React, {forwardRef, useImperativeHandle, useMemo, useRef, useState, useEffect} from 'react';
import ReactDOM from 'react-dom';
import {Button, FormatMessage, Icon, Message, Modal, openModal} from 'components';
import {
  getEmptyEntity, getEmptyView, emptyDict, getLogicHeaders, getDefaultLogicSys,
  resetHeader, emptyRelation,
} from '../../lib/datasource_util';
import {
  readCatalog, getCatalogCategories, categoryObjects, uncategorizedObjects, inferDiagramLevel,
  createLayer, updateLayer, deleteLayer, moveLayer, createCategory, updateCategory,
  deleteCategory, moveCategory, attachLegacyGroup, addCategoryMembers,
  removeCategoryMembers, moveCategoryMembers,
  groupPhysicalObjects, conceptDiagrams,
  readPhysicalDatabases, createPhysicalDatabase, renamePhysicalDatabase,
  deletePhysicalDatabase, partitionVisibleDatabases, physicalDbSupports,
  UNSPECIFIED_DB, UNKNOWN_DB, appendObjectWithOptionalCategory,
} from '../../lib/model_catalog';

const t = (key, data) => FormatMessage.string({id: `modelCatalog.${key}`, data});
const collections = {
  entity: 'entities',
  logicEntity: 'logicEntities',
  conceptEntity: 'conceptEntities',
  diagram: 'diagrams',
  view: 'views',
  dict: 'dicts',
};
const levels = ['conceptual', 'logical', 'physical'];
const catalogLevels = ['conceptual', 'logical', 'physical'];
const entityTypes = {conceptual: 'conceptEntity', logical: 'logicEntity', physical: 'entity'};
const icons = {
  entity: 'fa-table',
  logicEntity: 'fa-columns',
  conceptEntity: 'fa-cube',
  diagram: 'icon-guanxitu',
  view: 'icon-shitu',
  dict: 'fa-book',
};
const label = (type, level) => t(type === 'diagram' ? `${level || 'unclassified'}Diagram` : type);
const field = (name, options, required = true) => ({name, options, required});

function showForm(title, fields, initial, submit) {
  const draft = {...initial};
  const formId = Math.uuid();
  let modal;
  const save = () => {
    if (fields.some(f => f.required && !String(draft[f.name] || '').trim())) {
      Message.error({title: t('required')}); return;
    }
    try {
      const data = Object.fromEntries(Object.entries(draft)
        .map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]));
      if (submit(data) !== false) modal.close();
    } catch (error) { Message.error({title: error.message}); }
  };
  modal = openModal(<form
    className='chiner-catalog-form'
    ref={element => element?.querySelector('input,select')?.focus()}
    onSubmit={(e) => { e.preventDefault(); save(); }}>
    {fields.map(f => (
      // eslint-disable-next-line jsx-a11y/label-has-for
      <label key={f.name} htmlFor={`${formId}-${f.name}`}>
        <span>{t(f.name)}{f.required && <em> *</em>}</span>
        {f.options ? <select
          id={`${formId}-${f.name}`}
          aria-label={t(f.name)}
          defaultValue={draft[f.name] || ''}
          onChange={(e) => { draft[f.name] = e.target.value; }}>
          <option value=''>{t('choose')}</option>
          {f.options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select> : <input
          id={`${formId}-${f.name}`}
          list={f.suggestions ? `${formId}-${f.name}-options` : undefined}
          aria-label={t(f.name)}
          defaultValue={draft[f.name] || ''}
          onChange={(e) => { draft[f.name] = e.target.value; }}/>}
        {f.suggestions && <datalist id={`${formId}-${f.name}-options`}>
          {f.suggestions.map(value => <option key={value} value={value}/>)}
        </datalist>}
      </label>))}
  </form>, {
    title,
    bodyStyle: {width: 480},
    buttons: [
      <Button key='ok' type='primary' onClick={save}><FormatMessage id='button.ok'/></Button>,
      <Button key='cancel' onClick={() => modal.close()}><FormatMessage id='button.cancel'/></Button>,
    ],
  });
}

export default forwardRef(({source, getSource, onUpdate, onOpen, onCloseObject, onDrag, onGenerate,
  filter = '', readOnly, viewMode = 'directory', onHome}, ref) => {
  const [selected, setSelected] = useState({kind: 'root'});
  const [expanded, setExpanded] = useState(new Set(['pending']));
  const [menu, setMenu] = useState(null);
  const treeRef = useRef(null);
  const menuRef = useRef(null);
  const live = useRef({});
  live.current = {getSource, onUpdate, source};
  const current = () => live.current.getSource();
  const commit = next => live.current.onUpdate(next);
  const cats = getCatalogCategories(source);
  const catalog = readCatalog(source);
  const catOptions = cats.map(c => ({id: c.id, name: `${c.defKey} / ${c.defName || t(c.kind || 'subject')}`}));
  const layerOptions = catalog.layers.map(l => ({id: l.id, name: `${l.defKey} ${l.defName}`}));
  useEffect(() => {
    if (!menu) return undefined;
    const close = (e) => { if (!menuRef.current?.contains(e.target)) setMenu(null); };
    const key = (e) => { if (e.key === 'Escape') { setMenu(null); treeRef.current?.focus(); } };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', key);
    };
  }, [menu]);
  useEffect(() => { if (menu) menuRef.current?.querySelector('button')?.focus(); }, [menu]);
  const openPath = keys => setExpanded(old => new Set([...old, ...keys]));

  const newDatabaseForm = (node) => {
    const options = physicalDbSupports(current())
      .map(s => ({id: s.id, name: s.defName || s.defKey}));
    if (!options.length) { Message.error({title: t('noDdlSupport')}); return; }
    showForm(t('newDatabase'), [
      field('code'), field('name', null, false), field('dbTypeId', options),
    ], {}, (values) => {
      const id = Math.uuid();
      try {
        commit(createPhysicalDatabase(current(), {
          id,
          categoryId: node.categoryId == null ? null : node.categoryId,
          defKey: values.code,
          defName: values.name || '',
          dbTypeId: values.dbTypeId,
        }));
      } catch (error) {
        Message.error({title: /duplicate/i.test(error.message)
          ? t('duplicate') : FormatMessage.string({id: 'optFail'})});
        return false;
      }
      const cat = node.categoryId == null ? null : node.categoryId;
      openPath([cat, `${cat}:physical`, `${cat}:physical:dbm:${id}`]);
      return undefined;
    });
  };

  const renameDatabaseForm = (node) => {
    const database = readPhysicalDatabases(current())
      .find(db => db.id === node.databaseId) || {};
    showForm(t('renameDatabase'), [
      field('code'), field('name', null, false),
    ], {code: database.defKey, name: database.defName}, (values) => {
      try {
        commit(renamePhysicalDatabase(current(), node.databaseId,
          {defKey: values.code, defName: values.name || ''}));
      } catch (error) {
        Message.error({title: /duplicate/i.test(error.message)
          ? t('duplicate') : FormatMessage.string({id: 'optFail'})});
        return false;
      }
      return undefined;
    });
  };

  const deleteDatabaseConfirm = (node) => {
    const src = current();
    const tables = (src.entities || [])
      .filter(e => e.physicalDatabaseId === node.databaseId).length;
    const physicalDiagrams = (src.diagrams || [])
      .filter(d => d.physicalDatabaseId === node.databaseId).length;
    Modal.confirm({
      title: t('deleteDatabase'),
      message: t('deleteDatabaseImpact', {tables, diagrams: physicalDiagrams}),
      onOk: () => {
        commit(deletePhysicalDatabase(current(), node.databaseId));
        setSelected({kind: 'root'});
      },
    });
  };
  const objectNode = (object, type, categoryId, level) => ({
    kind: 'object',
    id: `${categoryId || 'loose'}:${type}:${object.id}`,
    name: `${object.defKey || ''}${object.defName ? ` [${object.defName}]` : ''}`,
    objectId: object.id,
    objectType: type,
    categoryId,
    level,
    object,
  });

  const dbTypeNode = (group, categoryId) => {
    const key = group.key == null ? 'unspecified' : group.key;
    return {
      kind: 'dbType',
      id: `${categoryId}:physical:db:${key}`,
      name: group.key === UNSPECIFIED_DB ? t('unspecifiedDb')
        : (group.key === UNKNOWN_DB ? t('unknownDb') : group.name),
      categoryId,
      level: 'physical',
      dbTypeId: group.key,
      children: ['entity', 'diagram'].map(kind => ({
        kind: 'collection',
        id: `${categoryId}:physical:db:${key}:${kind}`,
        name: label(kind, 'physical'),
        categoryId,
        level: 'physical',
        objectType: kind,
        dbTypeId: group.key,
        children: (kind === 'entity' ? group.entities : group.diagrams)
          .map(o => ({...objectNode(o, kind, categoryId, 'physical'),
            dbTypeId: [UNSPECIFIED_DB, UNKNOWN_DB].includes(group.key)
              ? undefined : group.key})),
      })),
    };
  };

  const databaseNode = (bucket, categoryId) => {
    const {database} = bucket;
    return {
      kind: 'database',
      id: `${categoryId}:physical:dbm:${database.id}`,
      name: `${database.defKey}${database.defName && database.defName !== database.defKey ? ` · ${database.defName}` : ''}`,
      categoryId,
      level: 'physical',
      dbTypeId: database.dbTypeId,
      databaseId: database.id,
      databaseOwnerCategoryId: database.categoryId == null ? null : database.categoryId,
      children: ['entity', 'diagram'].map(kind => ({
        kind: 'collection',
        id: `${categoryId}:physical:dbm:${database.id}:${kind}`,
        name: label(kind, 'physical'),
        categoryId,
        level: 'physical',
        objectType: kind,
        dbTypeId: database.dbTypeId,
        databaseId: database.id,
        children: (kind === 'entity' ? bucket.entities : bucket.diagrams)
          .map(o => ({...objectNode(o, kind, categoryId, 'physical'),
            dbTypeId: database.dbTypeId, databaseId: database.id})),
      })),
    };
  };

  const sections = (objects, categoryId) => {
    const groups = catalogLevels.map((level) => {
      if (level !== 'physical') {
        return {
          kind: 'level',
          id: `${categoryId}:${level}`,
          name: t(level),
          categoryId,
          level,
          children: [entityTypes[level], 'diagram'].map((kind) => {
            const values = kind === 'diagram'
              ? objects.diagram.filter(d => inferDiagramLevel(d, source) === level) : objects[kind];
            return {
              kind: 'collection',
              id: `${categoryId}:${level}:${kind}`,
              name: label(kind, level),
              categoryId,
              level,
              objectType: kind,
              children: values.map(o => objectNode(o, kind, categoryId, level)),
            };
          }),
        };
      }
      const physical = groupPhysicalObjects(source, objects);
      const {visible: visibleDatabases} = partitionVisibleDatabases(
        physical, categoryId, cats.map(c => c.id));
      const physicalChildren = [
        ...visibleDatabases.map(bucket => databaseNode(bucket, categoryId)),
        ...physical.compatGroups.map(g => dbTypeNode(g, categoryId)),
        ...(physical.hasUnspecified ? [dbTypeNode(physical.unspecified, categoryId)] : []),
        ...(physical.hasUnknown ? [dbTypeNode(physical.unknown, categoryId)] : []),
      ];
      return {
        kind: 'level',
        id: `${categoryId}:physical`,
        name: t('physical'),
        categoryId,
        level: 'physical',
        children: physicalChildren.length ? physicalChildren : [{
          kind: 'physicalEmpty',
          id: `${categoryId}:physical:empty`,
          name: t('physicalEmptyHint'),
          categoryId,
          level: 'physical',
        }],
      };
    });
    const other = [
      {
        kind: 'collection',
        id: `${categoryId}:unknown`,
        name: t('unclassifiedDiagram'),
        categoryId,
        objectType: 'diagram',
        children: objects.diagram.filter(d => !inferDiagramLevel(d, source))
          .map(o => objectNode(o, 'diagram', categoryId)),
      },
      ...['view', 'dict'].map(type => ({
        kind: 'collection',
        id: `${categoryId}:${type}`,
        name: label(type),
        categoryId,
        objectType: type,
        children: objects[type].map(o => objectNode(o, type, categoryId)),
      })),
    ].filter(n => n.children.length);
    return groups.concat(other.length ? [{
      kind: 'other', id: `${categoryId}:other`, name: t('other'), categoryId, children: other,
    }] : []);
  };
  const categoryNode = c => ({
    kind: 'category',
    id: c.id,
    categoryId: c.id,
    layerId: c.layerId,
    name: `${c.defKey}${c.defName && c.defName !== c.defKey ? ` · ${c.defName}` : ''}`,
    badge: t(c.kind || 'subject'),
    category: c,
    children: sections(categoryObjects(source, c), c.id),
  });
  const tree = useMemo(() => {
    if (viewMode === 'objects') {
      const objects = Object.fromEntries(Object.entries(collections)
        .map(([type, name]) => [type, source[name] || []]));
      return sections(objects, null);
    }
    const result = catalog.layers.map(l => ({
      kind: 'layer',
      id: l.id,
      layerId: l.id,
      name: `${l.defKey}${l.defName ? ` · ${l.defName}` : ''}`,
      layer: l,
      children: cats.filter(c => c.layerId === l.id).map(categoryNode),
    }));
    const loose = uncategorizedObjects(source);
    const pending = cats.filter(c => !catalog.layers.some(l => l.id === c.layerId))
      .map(categoryNode);
    const orphanDatabases = readPhysicalDatabases(source)
      .filter(db => db.categoryId == null || !cats.some(c => c.id === db.categoryId));
    if (Object.values(loose).some(a => a.length) || orphanDatabases.length) {
      pending.push({kind: 'loose', id: 'loose', name: t('loose'), children: sections(loose, null)});
    }
    if (pending.length) {
      result.push({kind: 'pending', id: 'pending', name: t('pending'), children: pending});
    }
    return result;
  }, [source, viewMode]);
  const visibleTree = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase();
    if (!query) return tree;
    const visit = nodes => nodes.reduce((all, node) => {
      if (`${node.name} ${node.badge || ''}`.toLocaleLowerCase().includes(query)) return all.concat(node);
      const children = node.children && visit(node.children);
      return children?.length ? all.concat({...node, children}) : all;
    }, []);
    return visit(tree);
  }, [tree, filter]);
  const locate = (id, type) => {
    let found;
    const visit = (nodes, path) => nodes.forEach((n) => {
      if (!found && n.objectId === id && (!type || n.objectType === type)) found = {node: n, path};
      if (!found && n.children) visit(n.children, path.concat(n.id));
    });
    visit(tree, []);
    if (found) {
      openPath(found.path); setSelected(found.node);
      requestAnimationFrame(() => treeRef.current
        ?.querySelector(`[data-object-id="${id}"]`)?.scrollIntoView({block: 'nearest'}));
    }
  };
  const createObject = (type, level, node) => {
    const categoryId = node.categoryId;
    const globalContext = !!node.global;
    const containerContext = !globalContext && ['level', 'collection', 'dbType',
      'database', 'physicalEmpty', 'other'].includes(node.kind);
    const dbTypeId = node.dbTypeId;
    const databaseId = node.databaseId;
    const category = cats.find(c => c.id === categoryId);
    const targetName = category ? `${category.defKey} / ${label(type, level)}` : label(type, level);
    showForm(`${t('create')} · ${targetName}`, [
      ...(!categoryId && !globalContext
        ? [field('categoryId', catOptions, !containerContext)] : []),
      ...(type === 'diagram' && !level
        ? [field('modelLevel', levels.map(id => ({id, name: t(id)})))] : []),
      field('code'), field('name', null, false),
    ], {}, (values) => {
      let src = current();
      const collection = collections[type];
      const existing = ['entity', 'view'].includes(type)
        ? (src.entities || []).concat(src.views || []) : (src[collection] || []);
      if (existing.some(o => o.defKey?.toLowerCase() === values.code.toLowerCase())) {
        Message.error({title: t('duplicate')}); return false;
      }
      const modelLevel = level || values.modelLevel;
      let object;
      if (type === 'diagram') {
        object = {
          ...emptyRelation,
          relationType: modelLevel === 'physical' ? 'field' : 'entity',
          modelLevel,
          canvasData: {cells: []},
        };
      } else if (type === 'conceptEntity') object = {type: 'C', fields: [], headers: [], comment: ''};
      else if (type === 'view') object = getEmptyView();
      else if (type === 'dict') object = {...emptyDict, items: []};
      else {
        const initialFields = type === 'entity' ? (src.profile?.default?.entityInitFields || [])
          .map(f => ({...f, id: Math.uuid()})) : [];
        object = {
          ...getEmptyEntity(initialFields,
            type === 'entity' ? src.profile?.default?.entityInitProperties || {} : {}),
          ...(type === 'logicEntity' ? {sysProps: getDefaultLogicSys()} : {}),
          type: type === 'entity' ? 'P' : 'L',
          headers: type === 'entity' ? resetHeader(src, {}) : getLogicHeaders(),
        };
      }
      object = {
        ...object,
        id: Math.uuid(),
        defKey: values.code,
        defName: values.name || '',
        comment: object.comment || '',
      };
      if (databaseId != null && (type === 'entity' || (type === 'diagram' && modelLevel === 'physical'))) {
        object = {...object, physicalDatabaseId: databaseId, physicalDbTypeId: dbTypeId};
      } else if (dbTypeId != null && (type === 'entity' || (type === 'diagram' && modelLevel === 'physical'))) {
        object = {...object, physicalDbTypeId: dbTypeId};
      }
      const targetCategory = globalContext ? null : (categoryId || values.categoryId || null);
      src = appendObjectWithOptionalCategory(src, type, object, targetCategory);
      commit(src);
      if (globalContext) {
        openPath([CONCEPT_MODEL_ID,
          type === 'diagram' ? GLOBAL_COLLECTION_IDS[1] : GLOBAL_COLLECTION_IDS[0]]);
      } else if (targetCategory) {
        const paths = [targetCategory];
        if (modelLevel) {
          paths.push(`${targetCategory}:${modelLevel}`);
          if (modelLevel === 'physical') {
            if (databaseId != null) {
              paths.push(`${targetCategory}:physical:dbm:${databaseId}`,
                `${targetCategory}:physical:dbm:${databaseId}:${type}`);
            } else {
              const key = dbTypeId == null ? 'unspecified' : dbTypeId;
              paths.push(`${targetCategory}:physical:db:${key}`,
                `${targetCategory}:physical:db:${key}:${type}`);
            }
          } else {
            paths.push(`${targetCategory}:${modelLevel}:${type}`);
          }
        } else paths.push(`${targetCategory}:other`, `${targetCategory}:${type}`);
        openPath(paths);
      }
      onOpen(object.id, type, targetCategory, icons[type]);
      return undefined;
    });
  };
  const mutateForm = (kind, node, isEdit = false) => {
    const layer = kind === 'layer';
    const liveNode = isEdit ? (layer ? readCatalog(current()).layers
      : getCatalogCategories(current())).find(item => item.id === node.id)
      : (node.layer || node.category);
    showForm(t(isEdit ? 'edit' : `new${layer ? 'Layer' : 'Category'}`), [
      ...(!layer && !isEdit ? [field('kind', [
        {id: 'domain', name: t('domain')}, {id: 'subject', name: t('subject')},
      ])] : []),
      {...field('code'), suggestions: layer && !isEdit ? ['ODS', 'DWD', 'DWS', 'ADS', 'DIM'] : null},
      field('name', null, false),
    ], {
      code: liveNode?.defKey,
      name: liveNode?.defName,
      kind: 'domain',
    }, (values) => {
      const src = current();
      const data = {defKey: values.code, defName: values.name || ''};
      const old = layer ? readCatalog(src).layers : getCatalogCategories(src);
      const duplicate = old.some(n => n.id !== node.id
        && (layer || n.layerId === node.layerId)
        && n.defKey.toLowerCase() === data.defKey.toLowerCase());
      if (duplicate) {
        Message.error({title: t('duplicate')}); return false;
      }
      if (layer) {
        commit(isEdit ? updateLayer(src, node.id, data)
          : createLayer(src, {...data, id: Math.uuid()}));
      } else {
        commit(isEdit ? updateCategory(src, node.categoryId, data) : createCategory(src, {
          ...data, kind: values.kind, id: Math.uuid(), layerId: node.layerId, members: {},
        }));
      }
      if (node.layerId) openPath([node.layerId]);
      return undefined;
    });
  };
  const actions = (node) => {
    const items = [];
    const add = (key, run, name) => items.push({name: name || t(key), run});
    const isConceptualNode = node.level === 'conceptual' || node.objectType === 'conceptEntity';
    if (node.kind === 'root' || node.kind === 'pending') add('newLayer', () => mutateForm('layer', {}));
    if (node.kind === 'layer') {
      add('newCategory', () => mutateForm('category', node));
      const unmounted = cats.filter(c => c.legacyGroupId && !c.layerId);
      if (unmounted.length) {
        const options = unmounted.map(c => ({id: c.legacyGroupId, name: c.defKey}));
        add('attach', () => showForm(t('attach'), [field('legacyGroupId', options)], {},
          v => commit(attachLegacyGroup(current(), v.legacyGroupId, node.id))));
      }
      add('rename', () => mutateForm('layer', node, true));
      ['up', 'down'].forEach((key, i) => add(key, () => {
        const index = catalog.layers.findIndex(l => l.id === node.id) + (i ? 1 : -1);
        commit(moveLayer(current(), node.id, index));
      }));
      add('deleteDirectory', () => {
        const impactCategories = cats.filter(c => c.layerId === node.id);
        const impactIds = new Set();
        impactCategories.forEach(c => Object.values(categoryObjects(source, c))
          .forEach(arr => arr.forEach(o => impactIds.add(o.id))));
        const dbCount = readPhysicalDatabases(source)
          .filter(d => impactCategories.some(c => c.id === d.categoryId)).length;
        Modal.confirm({
          title: t('deleteDirectory'),
          message: t('deleteLayerImpact', {
            categories: impactCategories.length,
            objects: impactIds.size,
            databases: dbCount,
          }),
          onOk: () => {
            commit(deleteLayer(current(), node.id));
            setSelected({kind: 'root'});
          },
        });
      });
    }
    if ((node.kind === 'level' && node.level === 'physical')
      || node.kind === 'physicalEmpty') {
      add('newDatabase', () => newDatabaseForm(node));
    }
    if (onGenerate && node.objectType === 'logicEntity'
      && (node.kind === 'object' || node.kind === 'collection')) {
      add('generatePhysical', () => onGenerate(node.kind === 'object'
        ? [node.objectId]
        : (node.children || []).map((c) => c.objectId).filter((id) => id)));
    } else if (onGenerate && node.kind === 'level' && node.level === 'logical') {
      add('generatePhysical', () => {
        const ids = (node.children || [])
          .filter((c) => c.objectType === 'logicEntity')
          .reduce((all, c) => all.concat((c.children || []).map((o) => o.objectId)), [])
          .filter((id) => id);
        onGenerate(ids);
      });
    }
    if (node.kind === 'database') {
      const owner = node.databaseOwnerCategoryId == null ? null : node.databaseOwnerCategoryId;
      const here = node.categoryId == null ? null : node.categoryId;
      if (owner !== here) {
        add('openOwnerCategory', () => {
          if (owner && cats.some(c => c.id === owner)) {
            openPath([owner, `${owner}:physical`]);
          } else {
            openPath(['loose']);
          }
        });
      } else {
        add('renameDatabase', () => renameDatabaseForm(node));
        add('deleteDatabase', () => deleteDatabaseConfirm(node));
      }
    }
    if (['category', 'level', 'collection', 'other', 'object', 'dbType',
      'database', 'physicalEmpty'].includes(node.kind)) {
      if (node.kind === 'physicalEmpty') return items;
      let selectedTypes;
      if (node.objectType) {
        selectedTypes = [[node.objectType, node.level]];
        if (node.kind === 'object' && Object.values(entityTypes).includes(node.objectType)) {
          selectedTypes.push(['diagram', node.level]);
        }
      } else if (node.level) {
        selectedTypes = [[entityTypes[node.level], node.level], ['diagram', node.level]];
      } else if (node.kind === 'other') selectedTypes = [['view'], ['dict']];
      else if (node.kind === 'dbType') selectedTypes = [['entity', 'physical'], ['diagram', 'physical']];
      else if (node.kind === 'database') selectedTypes = [['entity', 'physical'], ['diagram', 'physical']];
      else {
        selectedTypes = catalogLevels.flatMap(level => [[entityTypes[level], level], ['diagram', level]])
          .concat([['view'], ['dict']]);
      }
      selectedTypes.forEach(([type, level]) => items.push({
        name: `${t('create')} ${label(type, level)}`,
        run: () => createObject(type, level, node),
      }));
    }
    if (node.categoryId && node.kind !== 'object' && !isConceptualNode) {
      add('linkExisting', () => {
        const options = Object.entries(collections).flatMap(([type, name]) =>
          (source[name] || [])
            .filter(o => type !== 'conceptEntity'
              && !(type === 'diagram' && inferDiagramLevel(o, source) === 'conceptual'))
            .map(o => ({
              id: `${type}:${o.id}`, name: `${label(type)} · ${o.defKey} [${o.defName || ''}]`,
            })));
        showForm(t('linkExisting'), [field('objectId', options)], {}, (v) => {
          const [type, id] = v.objectId.split(':');
          commit(addCategoryMembers(current(), node.categoryId, type, [id]));
        });
      });
    }
    if (node.kind === 'category') {
      add('rename', () => mutateForm('category', node, true));
      add('moveCategory', () => showForm(t('moveCategory'), [field('layerId', layerOptions)],
        {layerId: node.layerId}, (v) => {
          commit(moveCategory(current(), node.id, v.layerId));
          openPath([v.layerId]);
          setSelected({...node, layerId: v.layerId});
        }));
      ['up', 'down'].forEach((key, i) => add(key, () => {
        const index = cats.filter(c => c.layerId === node.layerId)
          .findIndex(c => c.id === node.id) + (i ? 1 : -1);
        commit(moveCategory(current(), node.id, node.layerId, index));
      }));
      add('deleteDirectory', () => {
        const members = categoryObjects(source, node.categoryId);
        const objectCount = Object.values(members).reduce((n, arr) => n + arr.length, 0);
        const dbCount = readPhysicalDatabases(source)
          .filter(d => d.categoryId === node.categoryId).length;
        Modal.confirm({
          title: t('deleteDirectory'),
          message: t('deleteCategoryImpact', {objects: objectCount, databases: dbCount}),
          onOk: () => {
            commit(deleteCategory(current(), node.id));
            setSelected({kind: 'root'});
          },
        });
      });
    }
    if (node.kind === 'object') {
      add('open', () => onOpen(node.objectId, node.objectType, node.categoryId, icons[node.objectType]));
      const options = catOptions.filter(c => c.id !== node.categoryId);
      if (options.length && !isConceptualNode) {
        add('linkToCategory', () => showForm(t('linkToCategory'), [field('categoryId', options)], {},
          v => commit(addCategoryMembers(current(), v.categoryId,
            node.objectType, [node.objectId]))));
        if (node.categoryId) {
          add('moveReference', () => showForm(t('moveReference'), [field('categoryId', options)], {},
            v => commit(moveCategoryMembers(current(), node.categoryId,
              v.categoryId, node.objectType, [node.objectId]))));
        }
      }
      if (node.categoryId && !isConceptualNode) {
        add('removeReference', () => commit(removeCategoryMembers(current(),
          node.categoryId, node.objectType, [node.objectId])));
      }
      if (node.objectType === 'diagram' && !node.object.modelLevel) {
        const modelLevels = levels.map(id => ({id, name: t(id)}));
        add('classifyDiagram', () => showForm(t('classifyDiagram'),
          [field('modelLevel', modelLevels)], {}, (v) => {
            const cells = node.object.canvasData?.cells || [];
            if (cells.some(c => c.shape === 'table')
              && inferDiagramLevel(node.object, source) !== v.modelLevel) {
              Message.error({title: t('mixedDiagram')}); return false;
            }
            commit({
              ...current(),
              diagrams: current().diagrams.map(d =>
                (d.id === node.objectId ? {...d, modelLevel: v.modelLevel} : d)),
            });
            return undefined;
          }));
      }
      add('deleteObject', () => {
        const refs = (source.diagrams || []).filter(d => d.canvasData?.cells
          ?.some(c => c.shape === 'table' && c.originKey === node.objectId));
        if (refs.length) { Message.error({title: t('referenced', {count: refs.length})}); return; }
        Modal.confirm({
          title: t('deleteObject'),
          message: <div>
            <div>{node.name}</div>
          </div>,
          onOk: () => {
            let src = current();
            getCatalogCategories(src).forEach((c) => {
              src = removeCategoryMembers(src, c.id, node.objectType, [node.objectId]);
            });
            const collection = collections[node.objectType];
            commit({
              ...src,
              [collection]: (src[collection] || []).filter(o => o.id !== node.objectId),
            });
            onCloseObject && onCloseObject(node.objectId, node.objectType);
          },
        });
      });
    }
    if (node.kind !== 'root' && node.kind !== 'pending') {
      add('newLayer', () => mutateForm('layer', {}));
    }
    return items;
  };
  const showMenu = (node, anchor) => {
    if (readOnly) return;
    const rect = anchor?.getBoundingClientRect?.()
      || {left: anchor?.clientX || 80, bottom: anchor?.clientY || 80};
    setMenu({
      items: actions(node),
      x: Math.max(8, Math.min(rect.left, window.innerWidth - 255)),
      y: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 300)),
    });
  };
  useImperativeHandle(ref, () => ({
    create: anchor => showMenu(selected, anchor),
    jumpSimplePosition: locate,
    jumpPosition: (d, key) => locate(d.id,
      Object.keys(collections).find(type => collections[type] === key)),
    jumpDetail: (d, key) => onOpen(d.id,
      Object.keys(collections).find(type => collections[type] === key), null, icons[d.type]),
  }));
  const renderNodes = (nodes, depth = 0) => nodes.map((node) => {
    const branch = !!node.children;
    const open = !!filter.trim() || expanded.has(node.id);
    const draggable = !readOnly && !branch && ['entity', 'logicEntity', 'conceptEntity'].includes(node.objectType);
    const iconType = node.kind === 'physicalEmpty' ? 'fa-plus-square-o'
      : (branch && node.kind !== 'collection'
        ? (node.kind === 'dbType' || node.kind === 'database' ? 'fa-database' : 'fa-folder-o') : icons[node.objectType]);
    return <React.Fragment key={node.id}>
      <div
        role='treeitem'
        tabIndex={-1}
        aria-level={depth + 1}
        aria-expanded={branch ? open : undefined}
        aria-selected={selected.id === node.id}
        data-object-id={node.objectId}
        data-catalog-id={node.id}
        data-model-level={node.level}
        data-catalog-kind={node.kind}
        className={`chiner-catalog-row${selected.id === node.id ? ' selected' : ''}${branch ? ' branch' : ''}`}
        style={{paddingLeft: 10 + depth * 12}}
        onContextMenu={(e) => { e.preventDefault(); setSelected(node); showMenu(node, e); }}>
        <button
          type='button'
          title={node.name}
          onClick={(e) => {
            setSelected(node);
            if (branch) {
              setExpanded((old) => {
                const next = new Set(old);
                if (next.has(node.id)) next.delete(node.id);
                else next.add(node.id);
                return next;
              });
            } else if (node.kind === 'physicalEmpty') {
              setSelected(node);
              showMenu(node, e.currentTarget);
            } else onOpen(node.objectId, node.objectType, node.categoryId, icons[node.objectType]);
          }}
          onDragStart={(e) => {
            if (draggable) onDrag(e, node.objectId, node.objectType);
            else e.preventDefault();
          }}
          draggable={draggable}>
          {branch && <span className='chiner-catalog-chevron'>{open ? '⌄' : '›'}</span>}
          <Icon type={iconType}/>
          <span className='chiner-catalog-name'>{node.name}</span>
          {node.kind === 'collection' && <small>{node.children.length}</small>}
          {node.badge && <small className='chiner-catalog-badge'>{node.badge}</small>}
        </button>
        {!readOnly && <button
          type='button'
          className='chiner-catalog-more'
          aria-label={`${t('actions')} ${node.name}`}
          onClick={(e) => { setSelected(node); showMenu(node, e.currentTarget); }}>⋯</button>}
      </div>
      {branch && open && renderNodes(node.children, depth + 1)}
    </React.Fragment>;
  });
  return <div
    className='chiner-model-catalog'
    role='tree'
    tabIndex={-1}
    aria-label={t('treeLabel')}
    ref={treeRef}>
    <div className='chiner-catalog-home'>
      <button type='button' className='chiner-catalog-home-open' onClick={onHome}>
        <Icon type='fa-home'/><FormatMessage id='project.homeCover'/>
      </button>
    </div>
    {visibleTree.length ? renderNodes(visibleTree)
      : <p className='chiner-catalog-empty'>{t(filter ? 'noResults' : 'empty')}</p>}
    {menu && ReactDOM.createPortal(<div
      ref={menuRef}
      className='chiner-catalog-menu'
      role='menu'
      tabIndex={-1}
      style={{left: menu.x, top: menu.y, maxHeight: window.innerHeight - menu.y - 8}}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const buttons = [...menuRef.current.querySelectorAll('button')];
          const index = buttons.indexOf(document.activeElement);
          const step = e.key === 'ArrowDown' ? 1 : buttons.length - 1;
          buttons[(index + step) % buttons.length]?.focus();
        }
      }}>
      {menu.items.map((a, i) => <button
        type='button'
        role='menuitem'
        key={i}
        onClick={() => { setMenu(null); a.run(); }}>{a.name}</button>)}
    </div>, document.body)}
  </div>;
});
