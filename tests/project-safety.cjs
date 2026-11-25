// 实际文件写入验证：外部修改与并发写入不能静默覆盖工程。
const fs=require('fs'), path=require('path'), os=require('os'), crypto=require('crypto'), vm=require('vm'), assert=require('assert');
const babel=require('@babel/core');
// guard 依赖的锁协议在 public/write-lock.js(与主进程引擎共用),按 guard 所在目录解析相对路径。
const guardFile=path.join(__dirname,'../src/lib/project_file_guard.js');
const api={};vm.runInNewContext(babel.transformFileSync(guardFile).code,{exports:api,process,require:p=>require(p.startsWith('.')?path.resolve(path.dirname(guardFile),p):p)});
const work=fs.mkdtempSync(path.join(os.tmpdir(),'cs-m-safety-')), file=path.join(work,'project.json');
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
(async()=>{
  const initial={name:'合成工程',revision:1};fs.writeFileSync(file,JSON.stringify(initial));
  const guard=api.createProjectFileGuard({fs,path,hash,message:key=>key,save:async(name,data)=>fs.promises.writeFile(name,JSON.stringify(data))});
  guard.track(file,initial);await guard.commit(file,{...initial,revision:2});assert.equal(JSON.parse(fs.readFileSync(file)).revision,2);
  console.log('PASS 正常保存落盘并释放短锁');
  fs.writeFileSync(file,JSON.stringify({...initial,revision:3}));
  await assert.rejects(()=>guard.commit(file,{...initial,revision:4}),/projectConflict/);
  assert.equal(JSON.parse(fs.readFileSync(file)).revision,3);console.log('PASS 外部修改拒绝静默覆盖');
  let started,finish;const entered=new Promise(r=>{started=r}),held=new Promise(r=>{finish=r});
  const a=api.createProjectFileGuard({fs,path,hash,message:key=>key,save:async()=>{started();await held;}});
  const b=api.createProjectFileGuard({fs,path,hash,message:key=>key,save:async()=>{throw Error('不应获得写权限')}});
  const first=a.commit(file,initial);await entered;await assert.rejects(()=>b.commit(file,initial),/projectBusy/);finish();await first;
  assert.deepStrictEqual(fs.readdirSync(work),['project.json']);console.log('PASS 并发写入拒绝且无遗留锁');
})().catch(e=>{console.error(e.stack);process.exitCode=1}).finally(()=>fs.rmSync(work,{recursive:true,force:true}));
