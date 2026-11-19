// 临时候选 tab 内容（INTEGRATION）：显式隔离的预览页——不注册 allType、
// 不进真实 tab 缓存/dirty、关闭即弃。建模候选用真实字段数据渲染（复用
// 实际字段结构，不画 SVG 示意）；绘图候选用真实 GraphThumbnail 只读投影。
// 常显“预览 · 未应用”标记，与保存状态分离。
// UI-R2（msg_fe0867d7c6bb）：建模候选对 candidate.dataSource 中新增/受影响的
// 物理图复用真实 ER 渲染器只读投影（lib/generatefile/img 的 calcCellData +
// table-img/erdrelation-img 导出渲染路径，含字段/PK/FK/连线），不是硬编码
// SVG，也不是把静态 HTML 复制进产品。方案未建图时对新增表做同约定的表格
// 投影；标准/规则等无图候选保持实际对象卡与差异。
import React, {useEffect, useMemo, useState} from 'react';
import {CandidatePreview, createMessages} from '../index';
import GraphThumbnail from '../../drawing/platform/GraphThumbnail';
import {img as renderErCanvas, html2svg} from '../../../lib/generatefile/img';
import {deriveThumbnailDoc} from './thumbnailDoc';
// 真实导出渲染节点注册（table-img / erdrelation-img 等）——投影复用与导出
// 相同的渲染器注册，不在本文件重复实现任何图形
import '../../../components/ercanvas/components';

const opLabel = (op) => ({
  'model.table.create': '新建表', 'model.field.add': '新增字段',
  'model.foreignKey.create': '新建外键', 'model.diagram.create': '新建关系图',
  'standard.group.create': '新建标准分组', 'standard.root.create': '新建词根',
  'standard.field.create': '新建标准字段', 'quality.modelRuleSet.create': '新建质量规则集',
}[op.command] || op.command);

// 与 lib/ai/commands/model.js runDiagramCreate 相同的确定性网格布局约定
// （4 列 × 280×220、原点 60）：投影只决定临时摆位，节点尺寸/端口/连线
// 全部由真实渲染器按模型快照计算。
const SYNTHETIC_COLUMNS = 4;
const SYNTHETIC_CELL_WIDTH = 280;
const SYNTHETIC_CELL_HEIGHT = 220;
const SYNTHETIC_ORIGIN = 60;

// PREVIEW-FINAL：img 第 5 参 groups 沿用 imgAll 的 hiddenPort 组约定
// （lib/generatefile/img.js）——calcNodeData 仅在 groups 存在时为字段生成
// in/out 端口，filterEdge 按端口保留关系/FK 边；缺省时边被全部滤掉。
const HIDDEN_PORT = {
  attrs: {
    circle: {
      r: 4,
      magnet: true,
      strokeWidth: 1,
      style: {visibility: 'hidden'},
    },
  },
  position: {name: 'absolute'},
  zIndex: 3,
};
const PREVIEW_PORT_GROUPS = {
  in: {...HIDDEN_PORT},
  out: {...HIDDEN_PORT},
  extend: {...HIDDEN_PORT},
};

export const deriveErProjections = ({candidate}) => {
  if (!candidate || !candidate.dataSource) return [];
  const ds = candidate.dataSource;
  const changes = candidate.changes || [];
  // 受影响物理图：方案实际新建/改写 canvasData 的 diagrams（按 change 目标）
  const diagramIds = [];
  changes.forEach((change) => {
    const id = change.target && change.target.collection === 'diagrams' ? change.target.id : null;
    if (id && !diagramIds.includes(id)) diagramIds.push(id);
  });
  const diagrams = diagramIds
    .map(id => (ds.diagrams || []).find(d => d && d.id === id))
    .filter(Boolean)
    .map(d => ({
      id: d.id,
      title: d.defName || d.defKey || d.id,
      cells: (d.canvasData && d.canvasData.cells) || [],
      relationType: d.relationType || 'field',
      synthetic: false,
    }));
  if (diagrams.length) return diagrams;
  // 方案未建图但有新增物理表：用同一真实渲染器做新表投影（字段/PK）；
  // FK 连线只有在关系图中才存在，明确注明而不是画出虚构关系。
  const createdIds = changes
    .filter(change => change.kind === 'create' && change.target && change.target.collection === 'entities')
    .map(change => change.target.id);
  const entities = createdIds
    .map(id => (ds.entities || []).find(e => e && e.id === id))
    .filter(Boolean);
  if (!entities.length) return [];
  return [{
    id: 'synthetic-tables',
    title: null,
    relationType: 'field',
    synthetic: true,
    cells: entities.map((entity, index) => ({
      id: `preview-${entity.id}`,
      shape: 'table',
      originKey: entity.id,
      type: 'P',
      position: {
        x: SYNTHETIC_ORIGIN + (index % SYNTHETIC_COLUMNS) * SYNTHETIC_CELL_WIDTH,
        y: SYNTHETIC_ORIGIN + Math.floor(index / SYNTHETIC_COLUMNS) * SYNTHETIC_CELL_HEIGHT,
      },
    })),
  }];
};

// 单个图的只读投影：离屏真实渲染（img → html2svg）→ data URI 图像；失败/空
// 内容都有明确状态，不静默吞掉。
const ErDiagramPreview = ({t, title, cells, relationType, dataSource, cacheKey, synthetic}) => {
  const [uri, setUri] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setUri('');
    setError('');
    if (!cells.length) return undefined;
    renderErCanvas(cells, relationType, dataSource, true, PREVIEW_PORT_GROUPS).then((dom) => {
      let svg = null;
      let failure = null;
      try {
        svg = html2svg(cells, dom);
      } catch (e) {
        failure = e;
      }
      if (dom.parentNode) dom.parentNode.removeChild(dom);
      if (!live) return;
      if (failure) setError(failure.message || String(failure));
      else setUri(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    }, (e) => {
      if (live) setError((e && e.message) || String(e));
    });
    return () => { live = false; };
    // cells/relationType/dataSource 由 cacheKey 唯一确定：planId+图 id 之外还含
    // planHash——同一 planId 下 updateSelection 重选（planHash/candidate 变化）
    // 必须重跑投影，不显示旧选择的关系图（UI-R2 msg_2c5d3fcafde5）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);
  return <div className='chiner-ai-candidate-er-item'>
    <div className='chiner-ai-candidate-er-head'>
      <span className='chiner-ai-tag'>{t('candidate.erSection')}</span>
      <strong>{synthetic ? t('candidate.erSynthetic') : title}</strong>
    </div>
    {synthetic && <p className='chiner-ai-sql-note'>{t('candidate.erSyntheticNote')}</p>}
    {error && <p className='chiner-ai-sql-error' role='alert'>
      {t('candidate.erRenderError', {message: error})}</p>}
    {!error && !cells.length && <p className='chiner-ai-sql-note'>{t('candidate.erNoCells')}</p>}
    {!error && cells.length > 0 && (uri
      ? <img className='chiner-ai-candidate-er-svg' src={uri} alt={synthetic ? '' : title}/>
      : <div className='chiner-ai-candidate-er-loading' role='status'><span>···</span></div>)}
  </div>;
};

const renderModelingContent = ({candidate, plan, selectedOpIds, projections, t}) => {
  const changes = (candidate && candidate.changes) || [];
  const ops = (plan && plan.operations) || [];
  const selected = new Set(selectedOpIds || []);
  const sections = ops.map((op) => {
    const mine = changes.filter(c => c.opId === op.opId);
    const after = mine.filter(c => c.after).map(c => c.after);
    return {op, after, mine};
  }).filter(s => s.mine.length && selected.has(s.op.opId));
  return <div className='chiner-ai-candidate-body'>
    {projections.length > 0 && <div className='chiner-ai-candidate-er'>
      {projections.map(p => <ErDiagramPreview key={p.id} t={t} title={p.title}
        cells={p.cells} relationType={p.relationType}
        dataSource={candidate.dataSource}
        cacheKey={`${plan ? plan.planId : ''}:${(plan && plan.planHash) || ''}:${p.id}`}
        synthetic={p.synthetic}/>)}
    </div>}
    <div className='chiner-ai-candidate-tables'>
    {sections.map(({op, after}) => <div key={op.opId} className='chiner-ai-candidate-section'>
      <div className='chiner-ai-candidate-section-head'>
        <span className='chiner-ai-tag'>{opLabel(op)}</span>
        <strong>{after[0] ? (after[0].defKey || after[0].defName || op.opId) : opLabel(op)}</strong>
      </div>
      {after.filter(a => Array.isArray(a.fields)).map(a => <table key={a.id || a.defKey}
        className='chiner-ai-candidate-fields'>
        <thead><tr>
          <th>defKey</th><th>defName</th><th>type</th><th>len</th><th>PK</th><th>NOT NULL</th>
        </tr></thead>
        <tbody>
          {(a.fields || []).map((f, i) => <tr key={f.defKey || i}>
            <td className='chiner-ai-mono'>{f.defKey}</td>
            <td>{f.defName}</td>
            <td className='chiner-ai-mono'>{f.type || f.baseType || ''}</td>
            <td>{f.len == null ? '' : String(f.len)}{f.scale != null ? `,${f.scale}` : ''}</td>
            <td>{f.primaryKey ? 'PK' : ''}</td>
            <td>{f.notNull ? '√' : ''}</td>
          </tr>)}
        </tbody>
      </table>)}
      {after.filter(a => !Array.isArray(a.fields) && (a.defKey || a.defName)).map((a, i) =>
        <div key={a.id || i} className='chiner-ai-candidate-line'>
          <span className='chiner-ai-mono'>{a.defKey || ''}</span>
          <span>{a.defName || ''}</span>
        </div>)}
    </div>)}
    </div>
  </div>;
};

const CandidateTab = ({locale = 'zh', labels, candidate, plan, selectedOpIds,
                        variant = 'modeling', onClose}) => {
  const t = useMemo(() => createMessages(locale, labels), [locale, labels]);
  const projections = useMemo(() => deriveErProjections({candidate}), [candidate]);
  if (!candidate) {
    return <div className='chiner-ai-candidate-empty'>
      <p>{t('candidate.empty')}</p>
      {onClose && <button type='button' className='chiner-ai-minibtn' onClick={onClose}>
        {t('candidate.close')}</button>}
    </div>;
  }
  const counts = candidate.counts || {};
  const isDrawing = variant === 'drawing';
  return <div className='chiner-ai-candidate-tab'>
    <div className='chiner-ai-candidate-head'>
      <span className='chiner-ai-candidate-badge'>{t('candidate.badge')}</span>
      <strong title={plan ? plan.summary : ''}>{plan ? plan.summary : ''}</strong>
      <span className='chiner-ai-candidate-hash' title={plan ? plan.planHash : ''}>
        {(plan && plan.planHash ? plan.planHash : '').slice(0, 12)}
      </span>
      {onClose && <button type='button' className='chiner-ai-minibtn' onClick={onClose}>
        {t('candidate.close')}</button>}
    </div>
    <CandidatePreview
      locale={locale}
      labels={labels}
      variant={isDrawing ? 'drawing' : 'modeling'}
      renderContent={() => isDrawing && candidate.document
        // PREVIEW-FINAL：缩略图按 affectedPages 命中页做只读单页投影（与
        // DocumentEditor 同约定），createPage 内容在第二页时不再空缩略图
        ? <GraphThumbnail doc={deriveThumbnailDoc(candidate)} cacheKey={`ai:${plan ? plan.planId : ''}`}
            title={candidate.document.defName}/>
        : renderModelingContent({candidate, plan, selectedOpIds, projections, t})}
      existingCount={0}
      candidateCount={(counts.create || 0) + (counts.update || 0) + (counts.remove || 0)}
      meta={isDrawing
        ? [candidate.document ? candidate.document.defName : '',
          `${(candidate.affectedPages || []).length} ${t('candidate.pages')}`]
        : [`${t('candidate.operations')}: ${plan ? plan.operations.length : 0}`,
          ...(projections.length ? [`${projections.length} ${t('candidate.pages')}`] : [])]}
      footerNote={t('candidate.footer')}
    />
  </div>;
};

export default React.memo(CandidateTab);
