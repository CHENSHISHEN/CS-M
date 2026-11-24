/* Electron main-process drawing journal. No renderer or browser dependencies. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const schema = require('./drawing-document');
const writeLock = require('./write-lock');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const bytes = value => JSON.stringify(value, null, 2);
const clone = schema.clone;
const codeError = (code, message=code) => Object.assign(new Error(message), {code});
const forbidden = value => {
  if(!value || typeof value!=='object')return false;
  return Object.keys(value).some(k=>['__proto__','prototype','constructor'].includes(k) || forbidden(value[k]));
};
async function atomic(file, content, beforeRename) {
  await fs.promises.mkdir(path.dirname(file), {recursive:true});
  const tmp=`${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;let h;
  try {h=await fs.promises.open(tmp,'wx');await h.writeFile(content);await h.sync();await h.close();h=null;if(beforeRename)await beforeRename();await fs.promises.rename(tmp,file);
    let dir;try{dir=await fs.promises.open(path.dirname(file),'r');await dir.sync();}catch(e){if(!['EINVAL','ENOTSUP','EPERM','EISDIR'].includes(e.code))throw e;}finally{if(dir)await dir.close();}
  }finally{if(h)await h.close().catch(()=>{});await fs.promises.unlink(tmp).catch(()=>{});}
}
// 工程文件缺失(被删除/移走/卸载)是可恢复状态:统一成带码错误,绝不向上抛原始 ENOENT。
const missingOk = promise => promise.catch(e => {throw e && e.code === 'ENOENT' ? codeError('PROJECT_FILE_MISSING') : e;});
function encode(record) {const text=JSON.stringify(record);return `${Buffer.byteLength(text)}:${hash(text)}:${text}\n`;}
function decode(content) {
  const records=[];const lines=content.toString('utf8').split('\n');let damaged=false;
  for(let i=0;i<lines.length-1;i+=1){const match=/^(\d+):([a-f0-9]{64}):(.*)$/.exec(lines[i]);
    if(!match || Number(match[1])!==Buffer.byteLength(match[3]) || hash(match[3])!==match[2]){damaged=true;break;}
    try{records.push(JSON.parse(match[3]));}catch(e){damaged=true;break;}
  }
  return {records,damaged,truncated:Boolean(lines[lines.length-1]),validText:records.map(encode).join('')};
}
const applyDelta = (drawings, delta) => {
  const map=new Map(drawings.map(d=>[d.id,d]));
  Object.entries(delta.baseRevisions || {}).forEach(([id,revision])=>{if((map.get(id)?.revision ?? null)!==revision)throw codeError('REVISION_CONFLICT');});
  (delta.remove || []).forEach(v=>map.delete(v));
  (delta.upsert || []).forEach(d=>{const errors=schema.errors(d);if(errors.length)throw codeError('INVALID_DOCUMENT',errors.join(', '));map.set(d.id,clone(d));});
  const order=delta.order || [...map.keys()];if(new Set(order).size!==order.length || order.length!==map.size || order.some(v=>!map.has(v)))throw codeError('INVALID_ORDER');
  return order.map(v=>map.get(v));
};
class DrawingPersistence {
  constructor(root, options={}) {this.root=root;this.sessions=new Map();this.notify=options.notify || (()=>{});this.writeRecord=options.writeRecord || ((handle,content)=>handle.writeFile(content));this.beforeSync=options.beforeSync || (async()=>{});this.delay=options.delay == null?750:options.delay;this.maxDelay=options.maxDelay || 3000;
    // onLockStale: test-only interleaving hook awaited after a write lock is judged stale, before reclaiming it.
    this.lockOptions={onStale:options.onLockStale};}
  // 会话键 = 路径的真实路径。工程文件被删除/移走后 realpath 会 ENOENT:此时取“最近的现存祖先目录的真实路径 + 其余路径段”,
  // 与文件存在时得到的键一致(含 macOS /var→/private/var 之类的符号链接目录),会话与日志因此保持可寻址。
  // 局限:文件本身是符号链接且其目标被删除时,键无法还原为链接目标的真实路径。
  canonical(file){if(!file)return '';const full=path.resolve(file);
    try{return fs.realpathSync(full);}catch(e){if(e.code!=='ENOENT')throw e;}
    const tail=[path.basename(full)];let dir=path.dirname(full);
    for(;;){try{return path.join(fs.realpathSync(dir),...tail);}catch(e){if(e.code!=='ENOENT')throw e;}
      const parent=path.dirname(dir);if(parent===dir)return full;tail.unshift(path.basename(dir));dir=parent;}
  }
  enqueue(s, operation){const next=s.queue.catch(()=>{}).then(operation);s.queue=next;return next;}
  async append(s, record){await this.beforeSync(record);const h=await fs.promises.open(s.journal,'a');try{const initial=(await h.stat()).size;try{const content=encode(record);await this.writeRecord(h,content);await h.sync();s.logBytes=initial+Buffer.byteLength(content);}catch(e){try{await h.truncate(initial);await h.sync();}catch(rollbackError){s.corrupt=true;}throw e;}}finally{await h.close();}}
  state(s,includeDrawings=true){return {file:s.file,sessionId:s.sessionId,seq:s.seq,checkpointSeq:s.checkpointSeq,status:s.corrupt?'damaged':s.conflict?'conflict':s.lastError?'error':!s.file||s.seq>s.checkpointSeq?'local':'saved',error:s.lastError || '',...(includeDrawings?{drawings:clone(s.drawings)}:{}),recovered:s.recovered};}
  async open(file, baseline, owner='default') {
    const canonical=this.canonical(file);const key=canonical || `untitled:${owner}`;
    const existing=this.sessions.get(key);if(existing){
      if(existing.owner!==owner)throw codeError('PROJECT_BUSY');await existing.queue.catch(()=>{});
      // 工程文件已不在磁盘:保留现有会话与日志,以 error 状态上报,而不是抛原始 ENOENT。
      let current=null;if(canonical){try{current=await fs.promises.readFile(canonical);}catch(e){if(e.code!=='ENOENT')throw e;
        // 只回报、不写入 lastError:文件回来后不会留下陈旧错误(真正的未落盘失败由 flush 记录)。
        const flag={status:'error',error:'PROJECT_FILE_MISSING'};this.notify({...this.state(existing,false),...flag});return {...this.state(existing),...flag};}}
      const changed=canonical && hash(current)!==existing.expectedHash;
      if(changed && existing.seq===existing.checkpointSeq){clearTimeout(existing.timer);clearTimeout(existing.maxTimer);this.sessions.delete(key);}
      else {if(changed)existing.conflict=true;return this.state(existing);}
    }
    if(!baseline || typeof baseline!=='object' || forbidden(baseline))throw codeError('INVALID_PROJECT');
    const dir=path.join(this.root,hash(key));await fs.promises.mkdir(dir,{recursive:true});
    const anchorFile=path.join(dir,'anchor.json'),journal=path.join(dir,'commands.log');
    const raw=canonical?await fs.promises.readFile(canonical):Buffer.from(bytes(baseline));
    let anchor,previousLog='',anchorRecovered=false,anchorDamaged=false;
    try{anchor=JSON.parse(await fs.promises.readFile(anchorFile,'utf8'));if(anchor.version!==1||!anchor.sessionId||!anchor.baseline||!Number.isInteger(anchor.seq)||forbidden(anchor))throw Error('Invalid recovery anchor');}
    catch(e){if(e.code!=='ENOENT'){anchorDamaged=true;await fs.promises.copyFile(anchorFile,path.join(dir,`anchor.damaged-${Date.now()}.json`)).catch(()=>{});}
      try{const previous=JSON.parse(await fs.promises.readFile(path.join(dir,'anchor.previous.json'),'utf8'));if(previous.anchor?.version!==1||!previous.anchor.sessionId||!previous.anchor.baseline||forbidden(previous))throw Error('Invalid previous recovery anchor');previousLog=typeof previous.journal==='string'?previous.journal:/^previous-[0-9]+\.log$/.test(previous.journalFile)?await fs.promises.readFile(path.join(dir,previous.journalFile),'utf8'):null;if(previousLog===null)throw Error('Missing previous recovery log');anchor=previous.anchor;anchorRecovered=true;anchorDamaged=false;await atomic(anchorFile,bytes(anchor));}catch(previousError){anchor=null;}
    }
    if(!anchor){anchor={version:1,sessionId:schema.id('journal'),baseline:clone(baseline),sourceFileHash:hash(raw),seq:0};await atomic(anchorFile,bytes(anchor));}
    const parsed=await fs.promises.readFile(journal).then(content=>decode(previousLog+content.toString('utf8')),e=>{if(e.code!=='ENOENT')throw e;return previousLog?decode(previousLog):{records:[],validText:'',damaged:false,truncated:false};});
    let drawings=clone(anchor.baseline.drawings || []),seq=anchor.seq || 0;const commands=new Set(anchor.commands || []);let corrupt=parsed.damaged || anchorDamaged;
    const owned=new Set([anchor.sourceFileHash]);const checkpoints=[];
    for(const rec of parsed.records){
      if(rec.sessionId!==anchor.sessionId){corrupt=true;break;}
      if(rec.type==='command') {if(rec.seq<= (anchor.seq || 0)){commands.add(rec.commandId);continue;}if(rec.seq<=seq&&commands.has(rec.commandId))continue;if(rec.seq!==seq+1){corrupt=true;break;}try{drawings=applyDelta(drawings,rec.delta);}catch(e){corrupt=true;break;}seq=rec.seq;commands.add(rec.commandId);}
      if(rec.type==='prepare'){owned.add(rec.targetFileHash);checkpoints.push(rec);}
    }
    const currentHash=hash(raw);const ownCheckpoint=checkpoints.filter(c=>c.targetFileHash===currentHash).pop();
    const pending=seq>(ownCheckpoint?.seq || anchor.seq || 0);
    // Old, fully checkpointed journals do not override an intentionally externally edited file.
    if(!pending && !corrupt && !owned.has(currentHash)) {
      anchor={version:1,sessionId:schema.id('journal'),baseline:clone(baseline),sourceFileHash:currentHash,seq:0};await atomic(anchorFile,bytes(anchor));await atomic(journal,'');drawings=clone(baseline.drawings || []);seq=0;commands.clear();
    } else if((parsed.truncated || anchorRecovered) && !corrupt) await atomic(journal,parsed.validText);
    const s={key,file:canonical,owner,dir,journal,anchorFile,sessionId:anchor.sessionId,baseline:clone(ownCheckpoint?JSON.parse(raw):anchor.baseline),drawings,seq,
      checkpointSeq:ownCheckpoint?.seq || anchor.seq || 0,expectedHash:currentHash,conflict:pending&&!owned.has(currentHash),corrupt,recovered:pending || anchorRecovered,
      queue:Promise.resolve(),logBytes:Buffer.byteLength(parsed.validText),commands,timer:null,maxTimer:null,lastError:''};
    this.sessions.set(key,s);this.notify(this.state(s,false));return this.state(s);
  }
  session(file,owner='default'){const key=file?this.canonical(file):`untitled:${owner}`;const s=this.sessions.get(key);if(!s || s.owner!==owner)throw codeError('SESSION_REQUIRED');return s;}
  async command(file, command, owner='default') {
    const s=this.session(file,owner);return this.enqueue(s,async()=>{
      // Session fence: a command bound to another journal (an older session of this
      // path, or another project) is never applied. Checked inside the queue because
      // repair() swaps s.sessionId. Callers without sessionId keep the old behaviour.
      if(command?.sessionId!=null&&command.sessionId!==s.sessionId)throw codeError('SESSION_STALE');
      if(s.corrupt)throw codeError('DAMAGED_JOURNAL');
      if(!command?.commandId || forbidden(command))throw codeError('INVALID_COMMAND');
      if(s.commands.has(command.commandId))return this.state(s,false);
      const next=applyDelta(s.drawings,command.delta);const rec={type:'command',sessionId:s.sessionId,seq:s.seq+1,commandId:command.commandId,delta:command.delta};
      try{await this.append(s,rec);s.drawings=next;s.seq=rec.seq;s.commands.add(command.commandId);s.lastError='';this.schedule(s);if(s.logBytes>=32*1024*1024&&!s.conflict){try{if(s.file)await this.guardedWrite(s,s.baseline,s.seq);else await this.compact(s,{...s.baseline,drawings:clone(s.drawings)},s.seq);}catch(e){s.lastError=e.message;}}this.notify(this.state(s,false));return this.state(s,false);}
      catch(e){s.lastError=e.message;this.notify(this.state(s,false));throw e;}
    });
  }
  schedule(s){clearTimeout(s.timer);s.timer=setTimeout(()=>this.flush(s.file,s.owner).catch(()=>{}),this.delay);if(!s.maxTimer)s.maxTimer=setTimeout(()=>this.flush(s.file,s.owner).catch(()=>{}),this.maxDelay);}
  async guardedWrite(s, data, seq){
    if(!s.file)return;
    if(s.conflict)throw codeError('PROJECT_CONFLICT');if(s.corrupt)throw codeError('DAMAGED_JOURNAL');
    // Shared lock protocol (write-lock.js): content {pid,startTime,host,createdAt}, stale = dead PID or
    // unparsable and older than 60s, serialized rename-based reclaim; any lost race is PROJECT_BUSY.
    const lock=`${s.file}.pdmaner-write-lock`;let held;
    // 先确认工程文件还在:目录被删时加锁/atomic 的 mkdir 会抛 ENOENT,甚至把已删除的目录重新建出来。
    await missingOk(fs.promises.stat(s.file));
    try{
      held=await writeLock.acquireWriteLock(fs,lock,this.lockOptions);if(!held)throw codeError('PROJECT_BUSY');
      const current=await missingOk(fs.promises.readFile(s.file));if(hash(current)!==s.expectedHash){s.conflict=true;throw codeError('PROJECT_CONFLICT');}
      const target={...clone(data),drawings:clone(s.drawings),profile:{...data.profile,drawingPersistence:{journalId:s.sessionId,lastAppliedSeq:seq}}};
      const content=bytes(target),targetFileHash=hash(content);
      await this.append(s,{type:'prepare',sessionId:s.sessionId,seq,previousFileHash:s.expectedHash,targetFileHash});
      await atomic(s.file,content,async()=>{if(hash(await missingOk(fs.promises.readFile(s.file)))!==s.expectedHash){s.conflict=true;throw codeError('PROJECT_CONFLICT');}});s.expectedHash=targetFileHash;s.baseline=target;s.checkpointSeq=seq;
      await this.append(s,{type:'commit',sessionId:s.sessionId,seq,targetFileHash});
      // A complete snapshot is also a local version and a recovery anchor candidate.
      const versions=path.join(s.dir,'versions');await atomic(path.join(versions,`${Date.now()}-${seq}.json`),content);
      const old=(await fs.promises.readdir(versions)).sort();for(const name of old.slice(0,-20))await fs.promises.unlink(path.join(versions,name));
      await this.compact(s,target,seq);
      s.lastError='';return target;
    }finally{if(held)await writeLock.releaseWriteLock(fs,lock,held);}
  }
  async compact(s,target,seq){
    const previousAnchor=JSON.parse(await fs.promises.readFile(s.anchorFile,'utf8'));
    const journalFile=`previous-${seq}.log`,previousLogFile=path.join(s.dir,journalFile);await fs.promises.copyFile(s.journal,previousLogFile);const handle=await fs.promises.open(previousLogFile,'r');try{await handle.sync();}finally{await handle.close();}
    await atomic(path.join(s.dir,'anchor.previous.json'),bytes({anchor:previousAnchor,journalFile}));
    await atomic(s.anchorFile,bytes({version:1,sessionId:s.sessionId,baseline:target,sourceFileHash:s.expectedHash,seq,commands:[...s.commands].slice(-512)}));
    await atomic(s.journal,'');
    s.logBytes=0;for(const name of await fs.promises.readdir(s.dir)){if(/^previous-[0-9]+\.log$/.test(name)&&name!==journalFile)await fs.promises.unlink(path.join(s.dir,name));}
  }
  async flush(file,owner='default',candidate){
    const s=this.session(file,owner);clearTimeout(s.timer);clearTimeout(s.maxTimer);s.timer=null;s.maxTimer=null;
    return this.enqueue(s,async()=>{
      try{if(candidate || s.seq>s.checkpointSeq){const data=clone(candidate || s.baseline);await this.guardedWrite(s,data,s.seq);}
        // 无待写入:没有任何未落盘内容,之前遗留的 lastError(检查点提交之后的收尾失败、被拒绝的命令等)不再阻断。
        else s.lastError='';
        this.notify(this.state(s,false));return {...this.state(s),project:clone(s.baseline)};}
      catch(e){s.lastError=e.message;this.notify(this.state(s,false));
        // 工程文件缺失不抛:会话与日志原样保留(已 ACK 的编辑都在日志里),以 error 状态返回,恢复副本仍可导出。
        if(e.code==='PROJECT_FILE_MISSING')return this.state(s);throw e;}
    });
  }
  async recovery(file,owner='default'){const s=this.session(file,owner);await s.queue.catch(()=>{});return {...clone(s.baseline),drawings:clone(s.drawings)};}
  // Explicit damaged-journal recovery (CHEN-UAT-009 P0): preserve evidence, then
  // rebuild a valid v1 journal from the caller's complete current snapshot. Never
  // a silent cache clear — the original anchor/log bytes survive in a backup
  // folder, and any failure before the rebuild lands leaves the session exactly
  // as it was (still damaged, draft retained) so a recovery copy stays exportable.
  async repair(file, snapshot, owner='default') {
    const s=this.session(file,owner);
    return this.enqueue(s,async()=>{
      if(!s.corrupt)throw codeError('REPAIR_NOT_REQUIRED');
      // An unresolved external-change conflict must be handled (reopened or
      // exported) first; repair never clears or overwrites it unconditionally.
      if(s.conflict)throw codeError('PROJECT_CONFLICT');
      const invalid=()=>codeError('INVALID_SNAPSHOT');
      if(!snapshot || typeof snapshot!=='object' || Array.isArray(snapshot) || forbidden(snapshot))throw invalid();
      if(!Array.isArray(snapshot.drawings) || new Set(snapshot.drawings.map(d=>d?.id)).size!==snapshot.drawings.length
        || snapshot.drawings.some(d=>schema.errors(d).length))throw invalid();
      // The disk project must still be the acknowledged one: an external edit (or
      // deletion) is a conflict to surface, never something repair overwrites.
      if(s.file){let current;try{current=await fs.promises.readFile(s.file);}catch(e){throw codeError('PROJECT_CONFLICT');}
        if(hash(current)!==s.expectedHash)throw codeError('PROJECT_CONFLICT');}
      // Evidence first: an exclusive backup directory (mkdtemp — same-millisecond
      // retries can never overwrite earlier evidence), holding the live anchor
      // and journal plus the previous anchor and every log it references, copied
      // and fsynced — and the caller's complete current snapshot, so the draft
      // itself stays recoverable even if the rebuild below fails.
      let backupDir;
      try{
        backupDir=await fs.promises.mkdtemp(path.join(s.dir,'repair-backup-'));
        const backup=async name=>{const to=path.join(backupDir,name);let h=null;
          try{await fs.promises.copyFile(path.join(s.dir,name),to);h=await fs.promises.open(to,'r');await h.sync();}
          catch(e){if(e.code!=='ENOENT')throw codeError('BACKUP_FAILED');}
          finally{if(h)await h.close().catch(()=>{});}};
        await backup('anchor.json');await backup('commands.log');await backup('anchor.previous.json');
        for(const name of await fs.promises.readdir(s.dir)){if(/^previous-[0-9]+\.log$/.test(name))await backup(name);}
        await atomic(path.join(backupDir,'current-recovery.pdma.json'),bytes(snapshot));
      }catch(e){throw e.code==='BACKUP_FAILED'?e:codeError('BACKUP_FAILED');}
      // Rebuild as a fresh v1 journal: the hash-verified disk project (the valid
      // baseline for untitled sessions) is the anchor; one command at seq 1 seals
      // the caller's snapshot — seq is never faked as an acknowledged checkpoint.
      // The delta is authoritative: drawings absent from the snapshot are removed.
      const baseline=clone(s.baseline);
      const sessionId=schema.id('journal');const commandId=`repair-${sessionId}`;
      const keep=new Set(snapshot.drawings.map(d=>d.id));
      const delta={upsert:clone(snapshot.drawings),remove:(baseline.drawings || []).filter(d=>!keep.has(d.id)).map(d=>d.id),order:snapshot.drawings.map(d=>d.id),baseRevisions:{}};
      const applied=applyDelta(clone(baseline.drawings || []),delta);
      const journalText=encode({type:'command',sessionId,seq:1,commandId,delta});
      const anchor={version:1,sessionId,baseline,sourceFileHash:s.file?s.expectedHash:hash(bytes(baseline)),seq:0};
      try{await atomic(s.anchorFile,bytes(anchor));await atomic(s.journal,journalText);}
      catch(e){
        // Partial rebuild (anchor landed, journal did not): restore the original
        // anchor bytes from the evidence copy so a retry starts from a consistent
        // damaged state. The restore is best-effort and never masks the failure.
        try{await atomic(s.anchorFile,await fs.promises.readFile(path.join(backupDir,'anchor.json')));}catch(restoreError){}
        throw codeError('REBUILD_FAILED');
      }
      // Only now, with the rebuilt journal durably on disk, is the damaged flag
      // lifted; the original flush chain (lock/hash guard/atomic write/compact)
      // then persists the snapshot to the project file like any normal save.
      s.sessionId=sessionId;s.drawings=applied;s.seq=1;s.checkpointSeq=0;s.commands=new Set([commandId]);
      s.logBytes=Buffer.byteLength(journalText);s.corrupt=false;s.recovered=true;s.lastError='';
      try{
        if(s.file)await this.guardedWrite(s,clone(baseline),1);
        this.notify(this.state(s,false));return this.state(s);
      }catch(e){s.lastError=e.message;this.notify(this.state(s,false));throw e;}
    });
  }
  async versions(file,owner='default'){
    const s=this.session(file,owner);const read=async(folder)=>{try{return await fs.promises.readdir(folder);}catch(e){if(e.code==='ENOENT')return [];throw e;}};
    const ordinary=(await read(path.join(s.dir,'versions'))).sort().reverse().map(name=>({id:name,time:Number(name.split('-')[0])}));
    const named=await Promise.all((await read(path.join(s.dir,'named'))).map(async name=>{const data=JSON.parse(await fs.promises.readFile(path.join(s.dir,'named',name),'utf8'));return {id:name,time:data.createdAt,name:data.name,named:true};}));
    return [...named.sort((a,b)=>b.time-a.time),...ordinary];
  }
  async saveVersion(file,name,owner='default'){
    const s=this.session(file,owner);return this.enqueue(s,async()=>{
      if(typeof name!=='string'||!name.trim()||name.trim().length>80)throw codeError('INVALID_VERSION_NAME');
      const existing=(await this.versions(file,owner)).filter(v=>v.named);if(existing.length>=20)throw codeError('NAMED_VERSION_LIMIT');
      if(existing.some(v=>v.name.toLocaleLowerCase()===name.trim().toLocaleLowerCase()))throw codeError('DUPLICATE_VERSION_NAME');
      const value={name:name.trim(),createdAt:Date.now(),project:{...clone(s.baseline),drawings:clone(s.drawings)}};const versionId=`named-${schema.id('version')}.json`;
      await atomic(path.join(s.dir,'named',versionId),bytes(value));return {id:versionId,time:value.createdAt,name:value.name,named:true};
    });
  }
  async version(file,name,owner='default'){
    const s=this.session(file,owner);const named=/^named-[a-z0-9-]+\.json$/.test(name);
    if(!named&&!/^[0-9]+-[0-9]+\.json$/.test(name))throw codeError('INVALID_VERSION');
    const value=JSON.parse(await fs.promises.readFile(path.join(s.dir,named?'named':'versions',name),'utf8'));return named?value.project:value;
  }
  async deleteVersion(file,name,owner='default'){
    const s=this.session(file,owner);if(!/^named-[a-z0-9-]+\.json$/.test(name))throw codeError('INVALID_VERSION');await fs.promises.unlink(path.join(s.dir,'named',name));
  }
  async close(file,owner='default'){
    const state=await this.flush(file,owner);const s=this.session(file,owner);
    // 仍有未落盘的编辑(如工程文件缺失)时保留会话与日志,以带码错误拒绝关闭,而不是丢弃内存会话。
    if(state.status==='error'&&s.seq>s.checkpointSeq)throw codeError(state.error);
    this.sessions.delete(file?this.canonical(file):`untitled:${owner}`);
  }
}
module.exports={DrawingPersistence,atomic,encode,decode,applyDelta,hash};
