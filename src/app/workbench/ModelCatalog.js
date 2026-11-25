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
import {linkDeletionImpact} from '../../lib/concept_logical_links';
// UX-02：root 总菜单与企业概念模型节点菜单共用的纯数据定义（稳定 key）
import {getRootCreateMenu, getConceptModelCreateMenu} from '../../lib/model_catalog_menu';
// M5B-R1：模型对象删除前指标影响（只读窄组件）
import {summarizeMetricDeleteImpact, MetricDeleteImpactBody} from '../metrics/deleteImpact';

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
// DATA-WB-FEAT-001 阶段A：概念模型提升企业全局，分层/数据域下只组织逻辑与物理
const catalogLevels = ['logical', 'physical'];
const entityTypes = {conceptual: 'conceptEntity', logical: 'logicEntity', physical: 'entity'};
// S3：去企业全局虚拟包装——概念模型/概览图直接作为根级节点，概念资产一次可达；
// 旧分类引用数据保持不变，仅在呈现层不再重复包装
const CONCEPT_MODEL_ID = 'concept-model';
const GLOBAL_COLLECTION_IDS = ['global:conceptual:conceptEntity', 'global:conceptual:diagram'];
// S3：企业首页组件拖放 MIME（公共合同 application/x-pdman-enterprise-home，JSON {kind}）
const HOME_COMPONENT_MIME = 'application/x-pdman-enterprise-home';
const HOME_COMPONENT_KINDS = ['rect', 'text', 'group', 'diagram'];
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
      // The legacy rule cannot inspect controls inside the conditional expression.
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

export default forwardRef(({source, getSource, onUpdate, onOpen, onCloseObject, onDrag,
  openForwardEngineering,
  filter = '', readOnly, viewMode = 'directory', onHome, onHomeAdd}, ref) => {
  const [selected, setSelected] = useState({kind: 'root'});
  // S3：概念模型节点与两个概念集合默认展开——概念实体/概念关系图一次可达
  const [expanded, setExpanded] = useState(
    new Set(['pending', CONCEPT_MODEL_ID, ...GLOBAL_COLLECTION_IDS]));
  const [paletteOpen, setPaletteOpen] = useState(false);
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
  // S1 R6：新建物理模型库（模型容器，非真实连接）。类型必须来自有效 DDL 支持；
  // 同一分类允许多个不同名同类型库
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
      // 未归类库（如 root 总菜单新建）落在"待归档 / 未归类"分区，一并展开以便看到新库
      openPath([...(cat == null ? ['pending', 'loose'] : []),
        cat, `${cat}:physical`, `${cat}:physical:dbm:${id}`]);
      return undefined;
    });
  };
  // S1 R6：重命名模型库——仅改名称，id/分类/类型不变（非空库禁止改类型伪转换）
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
  // S1 R6：删除模型库分组——仅撤容器归属，表/图保留类型元数据回兼容分组
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
  // 物理层按数据库类型分组（显式 physicalDbTypeId 归属；缺失=未指定；类型失效=未知回收组）。
  // 分组与真实数据库连接是不同维度：类型节点只继承 categoryId/physical 上下文。
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
          // 叶子对象继承所在分组的数据库类型上下文：在既有物理表/图上新建时
          // 写入同一 physicalDbTypeId；未知回收组不冒充真实库，新建明确归未指定
          .map(o => ({...objectNode(o, kind, categoryId, 'physical'),
            dbTypeId: [UNSPECIFIED_DB, UNKNOWN_DB].includes(group.key)
              ? undefined : group.key})),
      })),
    };
  };
  // 物理模型库容器节点（S1 R6）：显式新建的模型库；owner 分类下按归属展示，
  // 其他分类经对象引用展示同一源容器（保留原库 id/名称，整改 F2）。
  // 是模型中的物理目标容器，与真实数据库连接（dbConn）无关
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
          // 新建继承容器归属：同时写 physicalDatabaseId 与兼容 physicalDbTypeId；
          // 非_owner 引用上下文新建的对象归属当前分类，不改库 owner
          .map(o => ({...objectNode(o, kind, categoryId, 'physical'),
            dbTypeId: database.dbTypeId, databaseId: database.id})),
      })),
    };
  };
  // 概念对象（实体/关系图）投影到独立企业概念模型根节点一次可达；旧分类引用数据
  // 保持不变，仅在呈现层移除。所有概念路径节点均携带 global:true：节点上的“新建”
  // 都保持企业全局上下文，不重新要求选择数据域分类。
  const conceptModelNode = () => {
    return {
      kind: 'conceptModel',
      id: CONCEPT_MODEL_ID,
      name: t('conceptModel'),
      badge: t('globalBadge'),
      global: true,
      children: [
        {
          kind: 'collection', id: GLOBAL_COLLECTION_IDS[0],
          name: label('conceptEntity'), global: true,
          objectType: 'conceptEntity', level: 'conceptual',
          children: (source.conceptEntities || [])
            .map(o => ({...objectNode(o, 'conceptEntity', null, 'conceptual'), global: true})),
        },
        {
          kind: 'collection', id: GLOBAL_COLLECTION_IDS[1],
          name: label('diagram', 'conceptual'), global: true,
          objectType: 'diagram', level: 'conceptual',
          children: conceptDiagrams(source)
            .map(o => ({...objectNode(o, 'diagram', null, 'conceptual'), global: true})),
        },
      ],
    };
  };
  // S3整改：移除全局概览根——它与概念模型根重复投影概念图，且新企业首页已直接
  // 编辑并支持图引用（嵌入图在首页选取）。旧 pin 集/profile/diagrams 数据全部
  // 保留不动（model_catalog 层未改），仅不再在目录呈现；概念图经企业概念模型根
  // 一次可达，物理图继续在自身目录（分类/兼容组/模型库）可达
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
      // S1 R6：物理层按需展示——显式模型库容器 + 有对象的兼容类型组 + 必要回收组；
      // 模板支持列表不再自动变成空库列表，全空时给空态新建入口。
      // 整改 F2：有效库在 owner 分类或本分类有对象引用时显示（partition 保留原库
      // id/名称），归属其他分类的对象随其源容器展示，不再设外类库回收组
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
    // S3：企业概念模型提升为根级节点（去企业全局虚拟包装），概念实体/概念关系图
    // 一次可达；对象类型视图同样保持根级呈现，避免概念对象在分类/对象视图中重复出现。
    // S3整改：全局概览根已移除（与概念根重复投影，嵌入图由企业首页承载）
    const conceptModel = conceptModelNode();
    if (viewMode === 'objects') {
      const objects = Object.fromEntries(Object.entries(collections)
        .map(([type, name]) => [type, source[name] || []]));
      return [conceptModel, ...sections(objects, null)];
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
    // 失效/未归类归属的物理模型库不隐藏：随未归类分区一起回收展示
    const orphanDatabases = readPhysicalDatabases(source)
      .filter(db => db.categoryId == null || !cats.some(c => c.id === db.categoryId));
    if (Object.values(loose).some(a => a.length) || orphanDatabases.length) {
      pending.push({kind: 'loose', id: 'loose', name: t('loose'), children: sections(loose, null)});
    }
    if (pending.length) {
      result.push({kind: 'pending', id: 'pending', name: t('pending'), children: pending});
    }
    return [conceptModel, ...result];
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
    // 企业全局上下文：概念对象不再挂接数据域/分层分类（旧引用数据不受影响）
    const globalContext = !!node.global;
    // 整改 F4：未归类容器上下文（categoryId 为空的分区容器节点）允许保持未归类，
    // 分类选择降为可选；没有任何分类的新空项目也能直接提交（不自动创建域）
    const containerContext = !globalContext && ['level', 'collection', 'dbType',
      'database', 'physicalEmpty', 'other'].includes(node.kind);
    // 数据库类型节点上下文：null=未指定组（不写元数据），字符串=写显式 physicalDbTypeId
    const dbTypeId = node.dbTypeId;
    // 物理模型库容器上下文：新建对象继承容器与类型双重归属
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
      // 仅显式数据库类型上下文写元数据；未指定组/普通上下文不写，不推断。
      // 模型库容器上下文同时写 physicalDatabaseId 与兼容 physicalDbTypeId（S1 R6）
      if (databaseId != null && (type === 'entity' || (type === 'diagram' && modelLevel === 'physical'))) {
        object = {...object, physicalDatabaseId: databaseId, physicalDbTypeId: dbTypeId};
      } else if (dbTypeId != null && (type === 'entity' || (type === 'diagram' && modelLevel === 'physical'))) {
        object = {...object, physicalDbTypeId: dbTypeId};
      }
      const targetCategory = globalContext ? null : (categoryId || values.categoryId || null);
      // 整改 F4：仅给出有效分类时才挂接成员；未归类保持未归类（继承容器 id/类型）
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
            // 物理层目录按模型库/数据库类型分组：按实际归属展开到对象所在集合
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
  // UX-02：按纯数据菜单项（model_catalog_menu）绑定文案与处理函数。
  // 概念对象创建一律使用企业概念模型节点上下文（global:true），root 与概念模型节点同源
  const bindMenuItem = (item, node) => {
    if (item.action === 'createObject') {
      const context = item.level === 'conceptual' ? conceptModelNode() : node;
      return {
        key: item.key,
        name: `${t('create')} ${label(item.type, item.level)}`,
        run: () => createObject(item.type, item.level, context),
      };
    }
    if (item.action === 'newLayer') return {key: item.key, name: t('newLayer'), run: () => mutateForm('layer', {})};
    return {key: item.key, name: t('newDatabase'), run: () => newDatabaseForm(node)};
  };
  const actions = (node) => {
    // UX-02：root 选中时"+"给总菜单（概念实体 / 数仓分层 / 数据库），不再只有新建分层
    if (node.kind === 'root') return getRootCreateMenu().map(item => bindMenuItem(item, node));
    const items = [];
    const add = (key, run, name) => items.push({name: name || t(key), run});
    // 概念对象已提升企业全局：不再提供分类挂接/移动，避免重新引入分层重复
    const isConceptualNode = node.level === 'conceptual' || node.objectType === 'conceptEntity';
    if (node.kind === 'pending') add('newLayer', () => mutateForm('layer', {}));
    // S3：概念模型根节点（去企业全局包装后的一次可达入口）承载概念对象创建
    if (node.kind === 'conceptModel') {
      getConceptModelCreateMenu().forEach(item => items.push(bindMenuItem(item, node)));
    }
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
        // S1 R4：删除前列影响范围（分类数/对象引用数/受影响模型库数），对象全部保留
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
    // S1 R6：物理层节点与空态节点提供“新建数据库”（模型容器）入口
    if ((node.kind === 'level' && node.level === 'physical')
      || node.kind === 'physicalEmpty') {
      add('newDatabase', () => newDatabaseForm(node));
    }
    // S2 R3：逻辑 → 物理正向生成入口——逻辑实体右键预选该实体；
    // 逻辑集合/逻辑模型分区批量预选其下全部逻辑实体（向导内可再调整）；
    // UX-13：与逻辑实体编辑器按钮、顶栏菜单共用宿主 openForwardEngineering（只读时 showMenu 整体不弹出）
    if (openForwardEngineering && node.objectType === 'logicEntity'
      && (node.kind === 'object' || node.kind === 'collection')) {
      add('generatePhysical', () => openForwardEngineering(node.kind === 'object'
        ? [node.objectId]
        : (node.children || []).map((c) => c.objectId).filter((id) => id)));
    } else if (openForwardEngineering && node.kind === 'level' && node.level === 'logical') {
      add('generatePhysical', () => {
        const ids = (node.children || [])
          .filter((c) => c.objectType === 'logicEntity')
          .reduce((all, c) => all.concat((c.children || []).map((o) => o.objectId)), [])
          .filter((id) => id);
        openForwardEngineering(ids);
      });
    }
    if (node.kind === 'database') {
      // 整改 F2：非 owner 分类经对象引用展示的是同一源容器，重命名/删除会直接
      // 作用于源库；该上下文只给"打开所属分类"入口，操作回源分类执行
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
      if (node.kind === 'physicalEmpty') return items; // 空态节点除新建库外不提供对象创建
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
        // 分类/待归档默认新建菜单不再列概念对象（概念在企业全局节点创建）
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
            // 概念实体/概念关系图不再挂接数据域分类（旧引用保留，呈现层不重复显示）
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
        // S1 R4：删除分类列出影响引用数与模型库数；对象/图保留，多归属仍在其他分类
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
      // S3 整改：概览引用节点已随全局概览根移除，目录对象恢复统一删除入口
      add('deleteObject', () => {
        const refs = (source.diagrams || []).filter(d => d.canvasData?.cells
          ?.some(c => c.shape === 'table' && c.originKey === node.objectId));
        if (refs.length) { Message.error({title: t('referenced', {count: refs.length})}); return; }
        // S3 关联合同：概念/逻辑实体删除前统计将失效的概念-逻辑关联（可见失效边保留）
        const linkImpact = node.objectType === 'conceptEntity'
          ? linkDeletionImpact(source, {conceptIds: [node.objectId]})
          : (node.objectType === 'logicEntity'
            ? linkDeletionImpact(source, {logicalIds: [node.objectId]}) : null);
        // M5B-R1：三层模型对象删除前指标影响（只读 getLineageImpact，直接/传递按
        // revisionId 去重，名称+编码+版本展示）；无指标元数据/无影响不增加阻扰，
        // 确认后仍走原删除流程
        const metricImpact = ['entity', 'logicEntity', 'conceptEntity']
          .indexOf(node.objectType) >= 0
          ? summarizeMetricDeleteImpact(source,
            [{collection: collections[node.objectType], objectId: node.objectId}]) : null;
        Modal.confirm({
          title: t('deleteObject'),
          message: <div>
            <div>{node.name}</div>
            {linkImpact?.count > 0 && <div className='chiner-catalog-impact'>
              {t('linkImpact', {count: linkImpact.count})}
            </div>}
            {metricImpact && metricImpact.count > 0
              && <MetricDeleteImpactBody summary={metricImpact}/>}
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
    // UX-02：空项目引导直接调用的创建入口（只读时不执行，与 showMenu 一致）。
    // 按菜单 key 执行 root 总菜单项——与"+"/企业概念模型节点菜单同一处理函数
    runRootCreate: (key) => {
      if (readOnly) return;
      const item = getRootCreateMenu().find(i => i.key === key);
      if (item) bindMenuItem(item, {kind: 'root'}).run();
    },
    // 在未归类逻辑集合上下文新建逻辑实体（等同"待归档/未归类 › 逻辑实体"上的"新建"，分类可选）
    createLogicEntity: () => {
      if (readOnly) return;
      createObject('logicEntity', 'logical', {
        kind: 'collection', categoryId: null, level: 'logical', objectType: 'logicEntity',
      });
    },
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
              // 空态节点点击直达“新建数据库”菜单（只读时 showMenu 内部直接返回，
              // 整改 F6：handler 必须接收点击事件，此前漏声明 e 触发 ReferenceError）
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
    {/* 企业首页：文字按钮打开首页；相邻按钮展开四种基础组件面板（点击添加 /
      MIME application/x-pdman-enterprise-home 拖放，公共合同 onHomeAdd） */}
    <div className='chiner-catalog-home'>
      {!readOnly && onHomeAdd && <button
        type='button'
        className='chiner-catalog-home-toggle'
        onClick={() => setPaletteOpen(pre => !pre)}
        aria-expanded={paletteOpen ? 'true' : 'false'}
        aria-label={t('homeComponents')}
        title={t('homeComponents')}
      >
        <span className={`chiner-catalog-chevron${paletteOpen ? ' open' : ''}`}>{paletteOpen ? '⌄' : '›'}</span>
      </button>}
      <button type='button' className='chiner-catalog-home-open' onClick={onHome}>
        <Icon type='fa-home'/><FormatMessage id='enterpriseHome.title'/>
      </button>
    </div>
    {!readOnly && onHomeAdd && paletteOpen && <div className='chiner-catalog-home-palette'>
      <p className='chiner-catalog-home-palette-hint'>{t('homeComponentHint')}</p>
      <div className='chiner-catalog-home-palette-items'>
        {HOME_COMPONENT_KINDS.map(kind => <button
          key={kind}
          type='button'
          className='chiner-catalog-home-palette-item'
          draggable
          onDragStart={(e) => {
            // 公共合同：MIME + JSON {kind}，由企业首页画布消费
            e.dataTransfer.setData(HOME_COMPONENT_MIME, JSON.stringify({kind}));
            e.dataTransfer.effectAllowed = 'copy';
          }}
          onClick={() => onHomeAdd(kind)}
          title={t(`homeComponent.${kind}`)}
        >
          <Icon type={kind === 'rect' ? 'fa-square-o'
            : (kind === 'text' ? 'fa-font'
              : (kind === 'group' ? 'fa-th-large' : 'icon-guanxitu'))}/>
          <span>{t(`homeComponent.${kind}`)}</span>
        </button>)}
      </div>
    </div>}
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
