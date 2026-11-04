import React from 'react';
import DrawingDocument from '../../../../public/drawing-document';
import {Field, Action, en, t} from './common';
export default ({page, selectedId, readOnly, onEdit}) => {
  const m=page.erModel;const n=DrawingDocument.semantic(page).find(v=>v.id===selectedId);
  const text=(zh,eng)=>en()?eng:zh;
  if(!n)return null;
  const entity=m.entities.includes(n),relationship=m.relationships.includes(n);
  const patch=values=>onEdit(p=>Object.assign(DrawingDocument.semantic(p).find(v=>v.id===n.id),values));
  const rolePatch=(roleId,values)=>onEdit(p=>Object.assign(p.erModel.relationships.find(v=>v.id===n.id).roles.find(v=>v.id===roleId),values));
  return <section className='pv-chen-properties'><h3>{text('陈氏 ER 语义','Chen ER semantics')}</h3>
    <Field label={text('所属图层','Layer')}><select disabled={readOnly} value={page.scene.nodes[n.id].layerId} onChange={e=>onEdit(p=>{p.scene.nodes[n.id].layerId=e.target.value;})}>{page.scene.layers.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
    <Field label={text('语义类型','Semantic kind')}><select disabled={readOnly} value={n.kind} onChange={e=>patch({kind:e.target.value})}>
      {(entity?['strong','weak']:relationship?['ordinary','identifying']:['simple','composite','multivalued','derived']).map(k=><option key={k} value={k}>{!en()&&({strong:'强实体',weak:'弱实体',ordinary:'普通联系',identifying:'标识联系',simple:'简单属性',composite:'复合属性',multivalued:'多值属性',derived:'派生属性'})[k]}{!en()?' / ':''}{k}</option>)}
    </select></Field>
    {!entity&&!relationship&&<><Field label={text('键类型','Key kind')}><select disabled={readOnly} value={n.key} onChange={e=>patch({key:e.target.value})}>{['none','primary','partial'].map(k=><option key={k} value={k} disabled={k!=='none'&&(n.kind!=='simple'||n.owner.type==='relationship')}>{!en()&&({none:'普通',primary:'键属性',partial:'部分键'})[k]}{!en()?' / ':''}{k}</option>)}</select></Field>
      <Field label={text('所属对象','Owner')}><select disabled={readOnly} value={`${n.owner.type}:${n.owner.id}`} onChange={e=>{const [type,id]=e.target.value.split(':');patch({owner:{type,id}});}}>
        {[...m.entities.map(v=>({...v,type:'entity'})),...m.relationships.map(v=>({...v,type:'relationship'})),...m.attributes.filter(v=>v.kind==='composite'&&v.id!==n.id).map(v=>({...v,type:'attribute'}))].map(v=><option value={`${v.type}:${v.id}`} key={v.id}>{v.name || v.id}</option>)}
      </select></Field></>}
    {relationship&&<><h3>{text('参与角色','Participating roles')}</h3>{n.roles.map(role=><div className='pv-role' key={role.id}>
      <Field label={text('实体','Entity')}><select disabled={readOnly} value={role.entityId} onChange={e=>rolePatch(role.id,{entityId:e.target.value})}>{m.entities.map(v=><option key={v.id} value={v.id}>{v.name || v.id}</option>)}</select></Field>
      <Field label={text('角色名称','Role name')}><input disabled={readOnly} value={role.name} onChange={e=>rolePatch(role.id,{name:e.target.value})}/></Field>
      <div className='pv-field-row'><Field label={text('基数','Cardinality')}><select disabled={readOnly} value={role.cardinality==='one'?'1':role.manyLabel} onChange={e=>rolePatch(role.id,{cardinality:e.target.value==='1'?'one':'many',manyLabel:e.target.value==='1'?null:e.target.value})}>{['1','N','M','P'].map(v=><option key={v}>{v}</option>)}</select></Field>
      <Field label={text('参与约束','Participation')}><select disabled={readOnly} value={role.participation} onChange={e=>rolePatch(role.id,{participation:e.target.value})}><option value='partial'>{text('部分','Partial')}</option><option value='total'>{text('完全（双线）','Total (double line)')}</option></select></Field></div>
      <Action disabled={readOnly} onClick={()=>patch({roles:n.roles.filter(v=>v.id!==role.id)})}>{t('delete')}</Action>
    </div>)}<Action disabled={readOnly||!m.entities.length} onClick={()=>onEdit(p=>{p.erModel.relationships.find(v=>v.id===n.id).roles.push({id:DrawingDocument.id('role'),entityId:m.entities[0].id,name:'',cardinality:'many',manyLabel:'N',participation:n.kind==='identifying'&&m.entities[0].kind==='weak'?'total':'partial'});})}>＋ {text('参与角色','Role')}</Action></>}
    <p className='pv-note'>{text('实体—联系连线创建角色。辅助图形不推导外键或数据流向。','Entity–relationship connections define roles. Auxiliary shapes do not define foreign keys or lineage.')}</p>
  </section>;
};
