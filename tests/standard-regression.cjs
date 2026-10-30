// 合成数据验证：标准应用不能破坏约束，跨项目交换不能丢失词元引用。
const path=require('path'), fs=require('fs'), vm=require('vm'), assert=require('assert');
const babel=require('@babel/core');
const root=path.resolve(__dirname,'..');
function load(name, overrides={}) {
  const file=path.join(root,'src/lib',name+'.js'), module={exports:{}};
  vm.runInNewContext(babel.transformFileSync(file).code,{module,exports:module.exports,require:id=>overrides[id]||require(id),console},{filename:file});
  return module.exports;
}
const fr=load('field_recommendation');
const dsl=load('data_standard_library',{'./field_recommendation':fr});
const source={profile:{default:{db:'mysql'},fieldRecommendation:{wordRoots:[]}},dataTypeMapping:{mappings:[{id:'text',defKey:'STRING',mysql:'VARCHAR'}]},domains:[],
  entities:[{id:'entity',defKey:'ACCOUNT',fields:[{id:'saved',defKey:'account_name',defName:'客户名称'}]}],
  standardFields:[{id:'group',defKey:'COMMON',fields:[{id:'standard',defKey:'account_code',defName:'客户代码',baseType:'text',len:64,scale:0,defaultValue:0,primaryKey:true,notNull:false,standardMeta:{wordRootRefs:['account','code']}}]}]};
const roots=[{id:'account',defName:'客户',defKey:'acct',fullName:'account'},{id:'code',defName:'代码',defKey:'cd',fullName:'code'}];
source.profile.fieldRecommendation.wordRoots=roots;
const current={id:'edit',defKey:'draft',defName:'草稿',primaryKey:false,notNull:true,autoIncrement:false,extProps:{keep:true}};
let count=0;
function check(name,fn){fn();count++;console.log('PASS',name);}
check('标准推荐不混淆自身字段，特殊字符按字面匹配',()=>{
 const index=fr.createRecommendationIndex(source);assert.equal(fr.searchRecommendations(index,'ACCOUNT_CODE','defKey',current.id).standard[0].field.id,'standard');
 assert.equal(fr.searchRecommendations(index,'.*[','defKey',current.id).standard.length,0);
});
check('采用标准保留字段身份、约束、扩展和数值零',()=>{
 const candidate=fr.createRecommendationIndex(source).standard[0];const result=fr.applyFieldRecommendation(current,candidate,[current],source);
 assert(!result.error);assert.equal(result.field.id,'edit');assert.equal(result.field.primaryKey,false);assert.equal(result.field.notNull,true);
 assert.equal(result.field.defaultValue,0);assert.equal(result.field.scale,0);assert.equal(result.field.type,'VARCHAR');assert.equal(result.field.extProps.keep,true);assert.equal(current.defKey,'draft');
});
check('重复字段代码拒绝覆盖',()=>{
 const c=fr.createRecommendationIndex(source).standard[0];assert.equal(fr.applyFieldRecommendation(current,c,[current,{id:'other',defKey:'ACCOUNT_CODE'}],source).error,'duplicateCode');
});
check('词元缩写/全称组合与引用保护',()=>{
 assert.equal(dsl.composeAbbreviation(roots),'acct_cd');assert.equal(dsl.composeFullName(roots).value,'account_code');assert.equal(dsl.findRootReferences('account',source.standardFields).length,1);
});
check('词元包往返保留全称和类型映射',()=>{
 const pack=fr.exportWordRoots(roots,source).data;let n=0;const back=fr.importWordRoots(pack,[],source,()=>`new-${++n}`);assert(!back.error);assert.equal(back.roots.find(r=>r.defKey==='acct').fullName,'account');
});
check('标准库交换保留词元组合关系',()=>{
 const pack=dsl.exportLibraryPackage(roots,source.standardFields,source);assert(!pack.error);let n=0;
 const target={...source,standardFields:[],profile:{...source.profile,fieldRecommendation:{wordRoots:[]}}};
 const imported=dsl.importLibraryPackage(pack.data,target,()=>`import-${++n}`);assert(!imported.error,JSON.stringify(imported));
 assert(imported.roots.length===2);assert(imported.standardFields[0].fields[0].standardMeta.wordRootRefs.length===2);
});
console.log('RESULT',count,'PASS');
