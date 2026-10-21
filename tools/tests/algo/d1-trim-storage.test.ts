import {test,expect} from 'bun:test'
import {mkdtempSync,readFileSync,readdirSync,lstatSync,writeFileSync,mkdirSync,symlinkSync,chmodSync,rmSync,rmdirSync,realpathSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {spawn,spawnSync} from 'node:child_process'
const worker=resolve(process.env.D1_TRIM_TEST_WORKER??resolve(import.meta.dir,'../../../plugin/hooks/d1-trim-worker.mjs'))
const scratch=()=>realpathSync(mkdtempSync(join(tmpdir(),'d1-trim-storage-')))
const call=(root:string,extra:Record<string,unknown>={})=>{const result=spawnSync(process.execPath,[worker],{input:JSON.stringify({op:'write',root,session:'abcd',program:'bun',at:1700000000000,text:'PASS full\nFAIL keep\n',...extra}),encoding:'utf8'});return result.status===0?JSON.parse(result.stdout):{ok:false}}
const logs=(root:string)=>readdirSync(join(root,'logs'),{recursive:true}).filter(x=>String(x).endsWith('.log')).map(x=>join(root,'logs',String(x)))

test('D1 log worker creates private directories and exact complete exclusive files',()=>{const root=scratch();try{const result=call(root);expect(result.ok).toBe(true);expect(readFileSync(result.path,'utf8')).toBe('PASS full\nFAIL keep\n');expect(lstatSync(result.path).mode&0o777).toBe(0o600);expect(lstatSync(join(root,'logs')).mode&0o777).toBe(0o700);expect(lstatSync(join(root,'logs','abcd')).mode&0o777).toBe(0o700);const second=call(root);expect(second.ok).toBe(true);expect(second.path).not.toBe(result.path);expect(readFileSync(result.path,'utf8')).toBe('PASS full\nFAIL keep\n')}finally{rmSync(root,{recursive:true,force:true})}})
test('D1 log worker retention is forty own files with oldest first',()=>{const root=scratch();try{for(let i=0;i<42;i++){const result=call(root,{at:1700000000000+i*60000,text:'log '+i});expect(result.ok).toBe(true)}const paths=logs(root);expect(paths.length).toBe(40);expect(paths.some(path=>readFileSync(path,'utf8')==='log 0')).toBe(false);expect(paths.some(path=>readFileSync(path,'utf8')==='log 1')).toBe(false);expect(paths.some(path=>readFileSync(path,'utf8')==='log 41')).toBe(true)}finally{rmSync(root,{recursive:true,force:true})}})
test('D1 log worker retention caps UTF-8 bytes at twenty million and rejects oversized single logs',()=>{const root=scratch();try{for(let i=0;i<3;i++)expect(call(root,{at:1700000000000+i*60000,text:'数'.repeat(2500000)}).ok).toBe(true);expect(logs(root).map(path=>lstatSync(path).size).reduce((a,b)=>a+b,0)).toBeLessThanOrEqual(20000000);expect(call(root,{text:'x'.repeat(20000001)}).ok).toBe(false)}finally{rmSync(root,{recursive:true,force:true})}})
test('D1 log worker rejects symlinked roots, log folders, session folders and colliding files',()=>{const root=scratch(),outside=scratch();try{const link=join(root,'linked');symlinkSync(outside,link);expect(call(link).ok).toBe(false);symlinkSync(outside,join(root,'logs'));expect(call(root).ok).toBe(false);rmSync(join(root,'logs'));const initial=call(root);expect(initial.ok).toBe(true);rmSync(join(root,'logs','abcd'),{recursive:true});symlinkSync(outside,join(root,'logs','abcd'));expect(call(root).ok).toBe(false);expect(readdirSync(outside).length).toBe(0)}finally{rmSync(root,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true})}})
test('D1 log worker never deletes or modifies foreign entries during retention and purge',()=>{const root=scratch(),outside=scratch();try{expect(call(root).ok).toBe(true);const foreign=join(root,'logs','abcd','user-notes.log'),foreignContent='Owner data';writeFileSync(foreign,foreignContent);const secret=join(outside,'secret.log');writeFileSync(secret,'private');symlinkSync(secret,join(root,'logs','abcd','1215-bun.log'));mkdirSync(join(root,'logs','foreign'));writeFileSync(join(root,'logs','foreign','1215-bun.log'),'foreign folder');expect(call(root,{op:'purge'}).ok).toBe(true);expect(readFileSync(foreign,'utf8')).toBe(foreignContent);expect(readFileSync(secret,'utf8')).toBe('private');expect(readFileSync(join(root,'logs','foreign','1215-bun.log'),'utf8')).toBe('foreign folder');expect(lstatSync(join(root,'logs','abcd','1215-bun.log')).isSymbolicLink()).toBe(true)}finally{rmSync(root,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true})}})
test('D1 log worker fails closed for unowned existing folder and broadly readable own folders',()=>{const root=scratch();try{mkdirSync(join(root,'logs'));writeFileSync(join(root,'logs','owner.txt'),'mine');expect(call(root).ok).toBe(false);expect(readFileSync(join(root,'logs','owner.txt'),'utf8')).toBe('mine');rmSync(join(root,'logs'),{recursive:true});expect(call(root).ok).toBe(true);chmodSync(join(root,'logs'),0o755);expect(call(root).ok).toBe(false)}finally{rmSync(root,{recursive:true,force:true})}})
test('D1 log worker open only accepts an existing owned private log',()=>{const root=scratch();try{const result=call(root);expect(result.ok).toBe(true);expect(call(root,{op:'check',path:result.path}).ok).toBe(true);expect(call(root,{op:'check',path:'/etc/passwd'}).ok).toBe(false);writeFileSync(join(root,'logs','abcd','user.log'),'owner');expect(call(root,{op:'check',path:join(root,'logs','abcd','user.log')}).ok).toBe(false);chmodSync(result.path,0o644);expect(call(root,{op:'check',path:result.path}).ok).toBe(false)}finally{rmSync(root,{recursive:true,force:true})}})
test('D1 log worker refuses session/program traversal and invalid local root spellings',()=>{const root=scratch();try{for(const args of [{session:'../escape'},{program:'../../escape'},{root:'relative'},{root:root+'/../another'},{root:'//network/share'},{at:1e30}])expect(call(root,args).ok).toBe(false);expect(readdirSync(root).length).toBe(0);expect(call(root).ok).toBe(true)}finally{rmSync(root,{recursive:true,force:true})}})
test('D1 log worker purge of absent logs creates no storage',()=>{const root=scratch();try{expect(call(root,{op:'purge'}).ok).toBe(true);expect(readdirSync(root)).toEqual([])}finally{rmSync(root,{recursive:true,force:true})}})

test('D1 log worker serializes two independent contending processes and enforces global retention',async()=>{
 const root=scratch()
 try{
  for(let i=0;i<39;i++)expect(call(root,{at:1700000000000+i*60000,text:'seed '+i}).ok).toBe(true)
  const lock=join(root,'logs','.write-lock');mkdirSync(lock,{mode:0o700})
  const launch=(i:number,text?:string)=>new Promise<{ok:boolean;path?:string}>((accept,reject)=>{
   const child=spawn(process.execPath,[worker],{stdio:['pipe','pipe','pipe']}),chunks:string[]=[]
   child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>chunks.push(chunk))
   child.on('error',reject);child.on('close',code=>{try{accept(code===0?JSON.parse(chunks.join('')):{ok:false})}catch(error){reject(error)}})
   child.stdin.end(JSON.stringify({op:'write',root,session:'abcd',program:'bun',at:1700000000000+(39+i)*60000,text:text??'concurrent '+i+'\n'+('PASS '+i+'\n').repeat(1000)}))
  })
  const pending=[launch(0),launch(1)]
  // An owned barrier makes both fresh processes contend, then releases them within the worker deadline.
  const release=setTimeout(()=>rmdirSync(lock),500)
  let results:{ok:boolean;path?:string}[]
  try{results=await Promise.all(pending)}finally{clearTimeout(release);try{rmdirSync(lock)}catch{}}
  expect(results.every(result=>result.ok)).toBe(true)
  const paths=logs(root);expect(paths.length).toBe(40)
  expect(paths.some(path=>readFileSync(path,'utf8')==='seed 0')).toBe(false)
  for(let i=0;i<2;i++)expect(paths.some(path=>readFileSync(path,'utf8').startsWith('concurrent '+i+'\n'))).toBe(true)
  expect(paths.map(path=>lstatSync(path).size).reduce((a,b)=>a+b,0)).toBeLessThanOrEqual(20000000)
  const large=await Promise.all([launch(2,'A'.repeat(10000001)),launch(3,'B'.repeat(10000001))])
  expect(large[1]!.ok).toBe(true)
  const retained=logs(root);expect(retained.length).toBe(1)
  expect(lstatSync(retained[0]!).size).toBe(10000001)
  expect(readFileSync(retained[0]!,'utf8')).toBe('B'.repeat(10000001))
 }finally{rmSync(root,{recursive:true,force:true})}
})

test('D1 log worker uninstall CLI purges only indexed own logs and reports unsafe roots',()=>{
 const root=scratch()
 try{
  const result=call(root);expect(result.ok).toBe(true)
  const foreign=join(root,'logs','owner.txt');writeFileSync(foreign,'owner')
  const run=(target:string)=>spawnSync(process.execPath,[worker,'--purge-root',target],{encoding:'utf8'})
  const purged=run(root);expect(purged.status).toBe(0);expect(JSON.parse(purged.stdout).ok).toBe(true)
  expect(logs(root)).toEqual([]);expect(readFileSync(foreign,'utf8')).toBe('owner')
  const unsafe=run('relative');expect(unsafe.status).not.toBe(0);expect(JSON.parse(unsafe.stdout).ok).toBe(false)
 }finally{rmSync(root,{recursive:true,force:true})}
})

test('D1 log worker preserves exact UTF-8 when stdin reads split Chinese and emoji byte sequences',async()=>{
 const root=scratch(),text='PASS 中文 🧪🙂\nFAIL exact original bytes\r\n'
 const payload=Buffer.from(JSON.stringify({op:'write',root,session:'abcd',program:'bun',at:1700000000000,text}),'utf8')
 const chineseSplit=payload.indexOf(Buffer.from('中'))+1,emojiSplit=payload.indexOf(Buffer.from('🧪'))+2
 // Observe actual worker reads without consuming or replacing stdin. Each next write waits
 // for the previous read, so OS buffering cannot merge the deliberately split sequences.
 const bootstrap=`process.argv=[process.execPath,${JSON.stringify(worker)}];const read=process.stdin.read.bind(process.stdin);process.stdin.read=(...args)=>{const chunk=read(...args);if(chunk&&chunk.length)process.stderr.write('__D1_TRIM_READ__\\n');return chunk};await import(${JSON.stringify(pathToFileURL(worker).href)});`
 const child=spawn('node',['--input-type=module','--eval',bootstrap],{stdio:['pipe','pipe','pipe']}),output:string[]=[]
 child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>output.push(chunk));child.stderr.setEncoding('utf8')
 let reads=0,stderr='',wake:(()=>void)|undefined
 child.stderr.on('data',chunk=>{stderr+=chunk;reads=(stderr.match(/__D1_TRIM_READ__\n/g)??[]).length;wake?.()})
 const closed=new Promise<number|null>((resolve,reject)=>{child.on('error',reject);child.on('close',resolve)})
 const observed=async(before:number)=>{if(reads>before)return;await Promise.race([new Promise<void>(resolve=>{wake=()=>{if(reads>before)resolve()};wake()}),closed.then(()=>{throw Error('worker ended before consuming split input')})]);expect(reads).toBeGreaterThan(before);wake=undefined}
 try{
  expect(chineseSplit).toBeGreaterThan(0);expect(emojiSplit).toBeGreaterThan(chineseSplit)
  let before=reads;child.stdin.write(payload.subarray(0,chineseSplit));await observed(before);await new Promise(resolve=>setTimeout(resolve,25))
  before=reads;child.stdin.write(payload.subarray(chineseSplit,emojiSplit));await observed(before);await new Promise(resolve=>setTimeout(resolve,25))
  child.stdin.end(payload.subarray(emojiSplit));expect(await closed).toBe(0)
  const result=JSON.parse(output.join(''));expect(result.ok).toBe(true);expect(reads).toBeGreaterThanOrEqual(3)
  const saved=readFileSync(result.path);expect(saved).toEqual(Buffer.from(text,'utf8'));expect(saved.toString('utf8')).toBe(text)
 }finally{child.stdin.end();await closed;rmSync(root,{recursive:true,force:true})}
})
// D1 security review finding 10 (O9, lane C 10-17): no secret reaches a kept log, and a log older than seven days goes.
test('D1 log worker hides secrets in what it keeps, leaving their first six characters',()=>{const root=scratch();try{const key='sk-ant-api03-'+'a'.repeat(40),token='ghp_'+'b'.repeat(36);const result=call(root,{text:`export KEY=${key}\npush with ${token}\nPASS\n`});expect(result.ok).toBe(true);const kept=readFileSync(result.path,'utf8');expect(kept).not.toContain(key);expect(kept).not.toContain(token);expect(kept).toBe('export KEY=sk-ant[hidden]\npush with ghp_bb[hidden]\nPASS\n')}finally{rmSync(root,{recursive:true,force:true})}})
test('D1 log worker deletes logs older than seven days at the next write or open',()=>{const root=scratch();try{const day=86400000,old=call(root,{at:1700000000000});expect(old.ok).toBe(true);const week=call(root,{at:1700000000000+7*day,text:'a week on'});expect(week.ok).toBe(true);expect(call(root,{op:'check',path:old.path,at:1700000000000+7*day}).ok).toBe(true);expect(call(root,{op:'check',path:old.path,at:1700000000000+7*day+1}).ok).toBe(false);expect(logs(root)).toEqual([week.path]);const later=call(root,{at:1700000000000+15*day,text:'later'});expect(later.ok).toBe(true);expect(logs(root)).toEqual([later.path])}finally{rmSync(root,{recursive:true,force:true})}})
