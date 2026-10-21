// One-shot own-log persistence. No shell, network, timers or app-data discovery.
import fs from 'node:fs'
import path from 'node:path'
const MAX_FILES=40,MAX_BYTES=20000000,OWNER='coco-private-trim-logs-v1\n',INDEX='.index.json'
// D1 security review finding 10 (O9): a log keeps no secret it was handed (the shapes more-secrets.ts hides, the first six
// characters left so the line still reads), and a log older than seven days is deleted at the next write or open.
const MAX_AGE=7*24*60*60*1000
const SECRETS=[/\bsk-ant-[A-Za-z0-9][A-Za-z0-9_-]{23,}\b/g,/\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,/\bAKIA[A-Z0-9]{16}\b/g,
 /\b(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,})\b/g,/\bxox[abposr]-[A-Za-z0-9-]{20,}\b/g,/\bAIza[A-Za-z0-9_-]{35}\b/g,/\b[rs]k_live_[A-Za-z0-9]{20,}\b/g,
 /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )?PRIVATE KEY-----|$)/g]
function hideSecrets(text){let out=text;for(const shape of SECRETS)out=out.replace(shape,found=>found.slice(0,6)+'[hidden]');return out}
function safeRoot(root){return typeof root==='string'&&path.isAbsolute(root)&&!/^[/\\]{2}/.test(root)&&!/[\u0000-\u001f\u007f]/.test(root)&&!root.split(/[\\/]/).some(p=>p==='.'||p==='..'||p.toLowerCase()==='.claude')}
function same(a,b){return process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b}
function walk(folder){
 const resolved=path.resolve(folder),prefix=path.parse(resolved).root;let at=prefix
 for(const part of resolved.slice(prefix.length).split(path.sep).filter(Boolean)){at=path.join(at,part);const s=fs.lstatSync(at);if(!s.isDirectory()||s.isSymbolicLink())throw Error('path');if(typeof process.getuid==='function'&&s.uid!==process.getuid()&&at!==prefix&&at===resolved)throw Error('owner')}
 if(!same(fs.realpathSync(folder),resolved))throw Error('path')
 return resolved
}
function privateStat(file,kind){const s=fs.lstatSync(file);if(s.isSymbolicLink()||(kind==='directory'?!s.isDirectory():!s.isFile()))throw Error('kind');if(typeof process.getuid==='function'&&(s.uid!==process.getuid()||(s.mode&0o077)!==0))throw Error('permissions');if(kind==='file'&&s.nlink!==1)throw Error('links');return s}
function ownName(relative){return /^[a-f0-9]{4}[/\\]\d{4}-[a-z0-9_-]{1,32}(?:-\d+)?\.log$/.test(relative)}
function under(logs,relative){if(!ownName(relative))throw Error('name');const target=path.join(logs,relative);if(path.relative(logs,target)!==relative)throw Error('path');walk(path.dirname(target));privateStat(path.dirname(target),'directory');return target}
function writeExclusive(file,text){const flags=fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|(fs.constants.O_NOFOLLOW||0);const fd=fs.openSync(file,flags,0o600);let ok=false,created
 try{created=fs.fstatSync(fd);fs.writeFileSync(fd,text,{encoding:'utf8'});fs.fsyncSync(fd);const result=fs.fstatSync(fd);if(result.size!==Buffer.byteLength(text)||result.nlink!==1)throw Error('short');ok=true;return result}
 finally{fs.closeSync(fd);if(!ok){try{const current=fs.lstatSync(file);if(current.ino===created?.ino&&current.dev===created?.dev&&!current.isSymbolicLink())fs.unlinkSync(file)}catch{}}}
}
function owned(logs,record){try{const target=under(logs,record.relative),s=privateStat(target,'file');return s.dev===record.dev&&s.ino===record.ino&&s.size===record.size&&s.mtimeMs===record.mtimeMs?{target,stat:s}:undefined}catch{return undefined}}
function indexRead(logs){const file=path.join(logs,INDEX);privateStat(file,'file');const raw=JSON.parse(fs.readFileSync(file,'utf8'));if(raw.v!==1||!Array.isArray(raw.files)||raw.files.length>10000||raw.files.some(x=>!x||!ownName(x.relative)||!Number.isFinite(x.size)||x.size<0||!Number.isFinite(x.at)))throw Error('index');return raw.files}
function indexWrite(logs,files){const file=path.join(logs,INDEX),before=privateStat(file,'file');const temporary=path.join(logs,'.index-'+process.pid+'-'+Date.now()+'.tmp');writeExclusive(temporary,JSON.stringify({v:1,files}));try{const current=privateStat(file,'file');if(before.ino!==current.ino||before.dev!==current.dev)throw Error('index changed');fs.renameSync(temporary,file)}finally{try{fs.unlinkSync(temporary)}catch{}}}
function setup(root,writing){walk(root);const logs=path.join(root,'logs');let created=false
 if(!writing&&!fs.existsSync(logs))throw Error('missing')
 try{if(writing){fs.mkdirSync(logs,{mode:0o700});created=true}}catch(error){if(error.code!=='EEXIST')throw error}
 walk(logs);privateStat(logs,'directory');const owner=path.join(logs,'.owner')
 if(created){writeExclusive(owner,OWNER);writeExclusive(path.join(logs,INDEX),JSON.stringify({v:1,files:[]}))}
 else{privateStat(owner,'file');if(fs.readFileSync(owner,'utf8')!==OWNER)throw Error('unowned')}
 return logs
}
async function acquireLock(lock){
 const deadline=process.hrtime.bigint()+3000000000n
 while(true){
  try{fs.mkdirSync(lock,{mode:0o700});return true}catch(error){
   if(error.code!=='EEXIST')return false
   try{privateStat(lock,'directory')}catch{return false}
   if(process.hrtime.bigint()>=deadline)return false
   await new Promise(accept=>setTimeout(accept,25))
  }
 }
}
async function dispatch(request){
 // POSIX verifies privacy with uid/mode. Missing Windows ACL verification is a safe no-trim fallback.
 if(process.platform==='win32'||typeof process.getuid!=='function'||!safeRoot(request.root)||!['write','purge','check'].includes(request.op))return {ok:false}
 if(request.op==='write'&&(!/^[a-f0-9]{4}$/.test(request.session)||!/^[a-z0-9_-]{1,32}$/.test(request.program)||!Number.isFinite(request.at)||Number.isNaN(new Date(request.at).getTime())||typeof request.text!=='string'||Buffer.byteLength(request.text)>MAX_BYTES))return {ok:false}
 // Never create a missing base folder: its owner supplies and owns it already.
 let logs
 try{logs=setup(request.root,request.op==='write')}catch{return {ok:request.op==='purge'&&safeRoot(request.root)&&fs.existsSync(request.root)&&!fs.existsSync(path.join(request.root,'logs'))}}
 const lock=path.join(logs,'.write-lock');if(!await acquireLock(lock))return {ok:false}
 let newlyWritten
 try{
  let records=indexRead(logs).filter(record=>owned(logs,record))
  if(request.op!=='purge'){
   const now=Number.isFinite(request.at)?request.at:Date.now(),fresh=records.filter(record=>!(now-record.at>MAX_AGE))
   if(fresh.length!==records.length){for(const record of records)if(!fresh.includes(record)){const file=owned(logs,record);if(file)fs.unlinkSync(file.target)}records=fresh;indexWrite(logs,records)}
  }
  if(request.op==='check'){
   const relative=typeof request.path==='string'?path.relative(logs,request.path):''
   const record=records.find(record=>record.relative===relative);return {ok:!!record&&!!owned(logs,record)}
  }
  if(request.op==='purge'){for(const record of records){const file=owned(logs,record);if(file)fs.unlinkSync(file.target)}indexWrite(logs,[]);return {ok:true}}
  const sessionDir=path.join(logs,request.session);try{fs.mkdirSync(sessionDir,{mode:0o700})}catch(error){if(error.code!=='EEXIST')throw error}
  walk(sessionDir);privateStat(sessionDir,'directory')
  const d=new Date(request.at),hhmm=String(d.getHours()).padStart(2,'0')+String(d.getMinutes()).padStart(2,'0'),base=hhmm+'-'+request.program
  let file,stat
  const text=hideSecrets(request.text)
  for(let n=0;n<1000;n++){file=path.join(sessionDir,base+(n?'-'+n:'')+'.log');try{stat=writeExclusive(file,text);break}catch(error){if(error.code!=='EEXIST')throw error}}
  if(!stat)throw Error('collision')
  newlyWritten={target:file,stat}
  const record={relative:path.relative(logs,file),ino:stat.ino,dev:stat.dev,size:stat.size,mtimeMs:stat.mtimeMs,at:request.at}
  records.push(record);records.sort((a,b)=>a.at-b.at||a.relative.localeCompare(b.relative))
  let bytes=records.reduce((sum,item)=>sum+item.size,0)
  while(records.length>MAX_FILES||bytes>MAX_BYTES){const oldest=records.shift();if(oldest.relative===record.relative)throw Error('capacity');const existing=owned(logs,oldest);if(existing)fs.unlinkSync(existing.target);bytes-=oldest.size}
  indexWrite(logs,records);newlyWritten=undefined;return {ok:true,path:file}
 }catch{return {ok:false}}
 finally{if(newlyWritten){try{const s=fs.lstatSync(newlyWritten.target);if(s.ino===newlyWritten.stat.ino&&s.dev===newlyWritten.stat.dev&&!s.isSymbolicLink())fs.unlinkSync(newlyWritten.target)}catch{}}try{fs.rmdirSync(lock)}catch{}}
}
let input=''
const args=process.argv.slice(2)
try{
 let request
 if(args.length){if(args.length!==2||args[0]!=='--purge-root')throw Error('arguments');request={op:'purge',root:args[1]}}
 else{process.stdin.setEncoding('utf8');for await(const chunk of process.stdin){input+=chunk;if(Buffer.byteLength(input)>MAX_BYTES*6+65536)throw Error('input')}request=JSON.parse(input)}
 const result=await dispatch(request);process.stdout.write(JSON.stringify(result));if(args.length&&!result.ok)process.exitCode=1
}catch{process.stdout.write(JSON.stringify({ok:false}));if(args.length)process.exitCode=1}
