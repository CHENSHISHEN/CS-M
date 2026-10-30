// 保存状态回归合成测试：正常保存退脏、落盘窗口内二次编辑保留且第二次保存
// 可落盘、失败保留、不误删其他页签、异步窗口内直写 redux 的保护不被破坏。
// cache.js 为真实源码（babel 转译后 vm 加载）；保存流程按 main.saveProject
// 与 actions/core.saveProject 的接缝协议搭建（merge 为 updateAllData 的实体
// 子集替身，needSave 为 validateNeedSave 同规则判定）。
const fs=require('fs'), path=require('path'), vm=require('vm'), assert=require('assert');
const babel=require('@babel/core');
const load=rel=>{
  const api={};
  vm.runInNewContext(babel.transformFileSync(path.join(__dirname,'../',rel)).code,
    {exports:api, localStorage:{getItem:()=>null,setItem(){},removeItem(){},clear(){}}});
  return api;
};
const cache=load('src/lib/cache.js');

// —— 环境：redux 数据引用 / memoryCache（真实实现）/ 落盘文件 ——
const state={redux:{name:'合成工程',entities:[{id:'E1',defKey:'e1'},{id:'E2',defKey:'e2'}]}};
const file={saved:null};
const h={updateCalls:0,ticks:0};
const needSave=()=>Object.values(cache.getAllTabData()).some(v=>v&&v.isInit===false)
    ||state.redux!==cache.getMemoryCache('data');
// 与容器生产者一致：每次写入都是新对象字面量（不可变替换）
const mount=(k,type,id)=>cache.setDataByTabId(k,{type,key:id,data:{id,defKey:id},isInit:true});
const edit=(k,type,id,defKey)=>cache.setDataByTabId(k,{type,key:id,data:{id,defKey},isInit:false});
// updateAllData 的实体子集替身：脏缓存按 id 并入，产出新顶层对象；无脏返回原引用
const mergeAll=ds=>{
  const dirty=Object.values(cache.getAllTabData()).filter(v=>v&&v.isInit===false&&v.type==='entity');
  if(!dirty.length) return {dataSource:ds,status:true};
  return {dataSource:{...ds,entities:(ds.entities||[]).map(e=>{
    const d=dirty.filter(v=>v.data.id===e.id)[0];
    return d?{...d.data}:e;
  })},status:true};
};
// actions/core.saveProject 接缝：记录保存开始引用，成功发布 canonical 快照，
// 窗口内 redux 已被直写则跳过发布（保留新变更）；duringSave 模拟异步落盘窗口
const saveAction=(data,{fail,duringSave}={})=>{
  const tempData={...data,updatedTime:'T1',version:'v1'};
  const dataAtSaveStart=state.redux;
  duringSave&&duringSave();
  if(fail) return {err:new Error('io error')};
  file.saved=tempData;
  cache.setMemoryCache('data',tempData);
  if(state.redux===dataAtSaveStart) state.redux=tempData;
  return {err:null};
};
// main.saveProject 成功路径协议（与 src/app/main/index.js 保持一致）
const mainSave=(opts={})=>{
  const dirtySnapshot=cache.snapshotDirtyTabData();
  const newData=mergeAll(state.redux);
  const res=saveAction(newData.dataSource,opts);
  if(res.err) return res;
  const hasPendingEdits=cache.retireSavedTabData(dirtySnapshot);
  if(!opts.saveAs&&hasPendingEdits){
    const fresh=mergeAll(state.redux);
    if(fresh.status){state.redux=fresh.dataSource;h.updateCalls++;}
    else h.ticks++;
  }else{
    h.ticks++;
  }
  return res;
};

// —— 场景1：普通保存退脏，不再次发布新对象，不误删其他页签 ——
mount('tabA','entity','E1'); mount('tabC','entity','E2'); mount('tabD','dict','D1');
edit('tabA','entity','E1','t1'); edit('tabC','entity','E2','c1');
mainSave();
assert.equal(h.updateCalls,0,'普通保存不得再次发布新对象（回归点）');
assert.equal(needSave(),false,'保存成功后脏提示应清除');
assert.equal(cache.getDataByTabId('tabA'),undefined,'已保存且未再编辑的页签应退休');
assert.equal(cache.getDataByTabId('tabC'),undefined,'同批保存的第二个脏页签应退休');
assert.ok(cache.getDataByTabId('tabD')&&cache.getDataByTabId('tabD').isInit===true,'未编辑页签缓存不得误删');
assert.equal(state.redux,cache.getMemoryCache('data'),'redux 应与 memoryCache 同引用');
assert.ok(file.saved.entities.some(e=>e.id==='E1'&&e.defKey==='t1'),'编辑内容应已落盘');
console.log('PASS 普通保存退脏且不再发布新对象/不误删其他页签');

// —— 场景2：落盘窗口内二次编辑保留，第二次保存可落盘 ——
edit('tabA','entity','E1','t2');
mainSave({duringSave:()=>{
  edit('tabA','entity','E1','t3');      // 窗口内再次编辑同一页签（新引用）
  state.redux={...state.redux,entities:[...state.redux.entities,{id:'E3',defKey:'e3'}]}; // 新增实体先入 redux（真实新增流程）
  edit('tabB','entity','E3','b1');      // 窗口内新开页签编辑
}});
assert.equal(h.updateCalls,1,'窗口内有新编辑时应重发待保存状态');
assert.equal(needSave(),true,'窗口内新编辑必须保持脏');
assert.ok(cache.getDataByTabId('tabA')&&cache.getDataByTabId('tabA').isInit===false,'再次编辑的缓存不得被清空丢弃');
assert.ok(cache.getDataByTabId('tabB')&&cache.getDataByTabId('tabB').isInit===false,'窗口内新增编辑不得被丢弃');
mainSave();
assert.equal(file.saved.entities.some(e=>e.id==='E1'&&e.defKey==='t3'),true,'第二次保存应把窗口内编辑落盘');
assert.ok(file.saved.entities.some(e=>e.id==='E3'&&e.defKey==='b1'),'窗口内新页签编辑应随第二次保存落盘');
assert.equal(needSave(),false,'第二次保存后应干净');
assert.equal(h.updateCalls,1,'第二次普通保存不再发布新对象');
console.log('PASS 窗口内二次编辑保留且第二次保存可落盘');

// —— 场景3：保存失败缓存/脏保留 ——
cache.removeDataByTabId('tabA'); cache.removeDataByTabId('tabB'); cache.removeDataByTabId('tabD');
edit('tabA','entity','E1','t4');
const before=cache.getDataByTabId('tabA');
mainSave({fail:true});
assert.equal(cache.getDataByTabId('tabA'),before,'失败时缓存条目原样保留');
assert.equal(needSave(),true,'失败时保持脏');
assert.equal(h.updateCalls,1,'失败不得发布');
assert.equal(h.ticks,2,'失败不新增刷新计数');
console.log('PASS 保存失败缓存与脏状态保留');

// —— 场景4：异步窗口内直写 redux 的保护不被破坏 ——
cache.removeDataByTabId('tabA');
edit('tabA','entity','E1','t5');
const direct={...state.redux,entities:[...(state.redux.entities||[]),{id:'EX',defKey:'x'}]};
mainSave({duringSave:()=>{state.redux=direct;}});
assert.equal(state.redux,direct,'窗口内直写 redux 不得被 canonical 快照覆盖');
assert.equal(needSave(),true,'直写产生的新变更保持脏待下次保存');
console.log('PASS 窗口内直写 redux 的保护未破坏');

// —— 场景5：引用对比核心不变量（真实 helper）——
cache.clearAllTabData();
edit('tabA','entity','E1','same');
const snap=cache.snapshotDirtyTabData();
edit('tabA','entity','E1','same');       // 内容相同但新引用＝新编辑
assert.equal(cache.retireSavedTabData(snap),true,'新引用条目应保留为脏');
assert.ok(cache.getDataByTabId('tabA'),'新引用条目不得被退休');
const snap2=cache.snapshotDirtyTabData();
assert.equal(cache.retireSavedTabData(snap2),false,'引用未变条目应退休');
assert.equal(cache.getDataByTabId('tabA'),undefined,'退休后条目应删除');
console.log('PASS 引用快照对比不变量（不可变替换语义）');

// —— 相关 JS 解析与接线检查 ——
['src/app/main/index.js','src/actions/core/index.js','src/lib/cache.js']
  .forEach(rel=>{babel.transformFileSync(path.join(__dirname,'../',rel));});
console.log('PASS 相关 JS 解析');
