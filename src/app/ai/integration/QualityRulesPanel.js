// 质量规则薄挂载适配（INTEGRATION A5 / R1）：质量面板本体是 QUALITY-UI 专属组件
// checkrule/AiModelQualityPanel（含规则列表/启停/只读运行/四态/筛选/修复提案，
// 私有双语文案）。本文件只做宿主适配：注入最新 dataSource/getDataSource、
// 经 updateDataSource 的启停写路径、jumpEntity 定位映射、AI 修复提案转发；
// 不复制任何质量 UI/状态机（协调者多次明确分工，见 dispatch 邮箱）。
import React from 'react';
import {FormatMessage} from 'components';
import AiModelQualityPanel from '../../container/checkrule/AiModelQualityPanel';

// 定位映射（R1）：objectRef.collection → 宿主页签类型。概念实体是
// conceptEntity 页签，绝不当物理表 entity；分隔符与 profile.separator（'%'）
// 一致，即 main jumpEntity 的 `${id}%${type}` 页签键。字典/视图等不在
// 检查规则定位范围内的集合返回 null（不猜页签）。
export const TAB_SEPARATOR = '%';
const COLLECTION_TAB_TYPES = {
  entities: 'entity',
  logicEntities: 'logicEntity',
  conceptEntities: 'conceptEntity',
};

export const tabKeyOf = (objectRef) => {
  if (!objectRef || objectRef.id == null) return null;
  const type = COLLECTION_TAB_TYPES[objectRef.collection];
  if (!type) return null;
  return `${objectRef.id}${TAB_SEPARATOR}${type}`;
};

// 修复提案文本（R1）：逐条失败结果携带“规则 + 实际/期望 + 对象/字段引用”，
// 不再只发 ref 列表；fieldRef 保留（定位落在宿主实体页签，字段随提案文本透出）。
export const buildFixRequestText = (proposal) => {
  const lines = ((proposal && proposal.results) || []).map((item) => {
    const object = item && item.objectRef
      ? `${item.objectRef.collection || '?'}/${item.objectRef.id}` : '';
    const field = item && item.fieldRef ? `.${item.fieldRef.id}` : '';
    const actualExpected = [
      item && item.actual !== undefined && item.actual !== null
        ? `实际=${String(item.actual)}` : '',
      item && item.expected !== undefined && item.expected !== null
        ? `期望=${String(item.expected)}` : '',
    ].filter(Boolean).join('，');
    const rule = item && item.ruleId ? `规则 ${item.ruleId}` : '规则未知';
    const message = item && item.message ? `：${item.message}` : '';
    return `- ${rule}：${object}${field}${actualExpected ? `（${actualExpected}）` : ''}${message}`;
  });
  return ['【质量修复候选】以下对象未通过质量规则，请给出修复建议方案：',
    ...lines].join('\n');
};

const QualityRulesPanel = ({dataSource, getDataSource, updateDataSource, readOnly,
                            jumpEntity, onRequestAiFix, locale, labels, onClose}) => {
  return <div className='chiner-ai-quality-mount'>
    {/* UI-R2（msg_2e4d0e0c2eff）：关闭按钮放挂载层独立顶栏（普通文档流），
        不再 absolute 覆盖面板头部右侧的“运行检查”按钮；面板本体不改 */}
    {onClose && <div className='chiner-ai-quality-mountbar'>
      <button type='button' className='chiner-ai-minibtn' onClick={onClose}>
        <FormatMessage id='button.close'/>
      </button>
    </div>}
    <div className='chiner-ai-quality-mountbody'>
      <AiModelQualityPanel
        dataSource={dataSource}
        getDataSource={getDataSource}
        readOnly={readOnly}
        locale={locale}
        labels={labels}
        onUpdate={(nextSource) => {
          // 启停写路径：组件已用最新快照合并 profile.quality，这里只负责落盘
          updateDataSource(nextSource);
        }}
        onLocate={(...args) => {
          // AiModelQualityPanel 传 (objectRef[, fieldRef])：定位到宿主实体页签；
          // 字段定位同样落在其宿主实体页签（字段不是独立页签）
          const objectRef = args[0];
          const tabKey = tabKeyOf(objectRef);
          if (tabKey && jumpEntity) jumpEntity(tabKey);
        }}
        onProposeFix={(proposal) => {
          // 修复只触发 Assistant 候选，不直接改模型（组件契约）；
          // 提案文本带失败规则与实际/期望摘要及对象/字段引用
          if (!onRequestAiFix) return;
          onRequestAiFix(buildFixRequestText(proposal));
        }}
      />
    </div>
  </div>;
};

export default React.memo(QualityRulesPanel);
