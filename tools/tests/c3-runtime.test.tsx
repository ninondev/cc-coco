// W1 order Do 3: exact v3 words replace old text pins; all other properties stay.
import { expect, test } from 'claude-code/testing'
import { createC3Runtime, scanStagedSecrets, isThanks } from '../hooks/c3-runtime'
import {sha256} from '../hooks/history-key'
import {bookmarkText,redactSecrets} from '../hooks/c3-secrets'
import {executeC3Algo} from '../hooks/algo-core.mjs'
import {LineSlot} from '../hooks/line-slot'
import type { C3LineRequest, C3Reaction, C3Settings } from '../hooks/c3-runtime'

function harness(seed: Record<string, unknown> = {}, settings: Partial<C3Settings> = {}, controls:{beforeSet?:(key:string,value:unknown)=>Promise<void>;executeAlgo?:(request:Record<string,unknown>)=>Promise<any>}={}) {
  const store: Record<string, unknown> = { ...seed }
  const lines: C3LineRequest[] = [], reactions: C3Reaction[] = [], notices: {id:string,text?:string}[] = []
  const writes: {key:string,value:unknown}[] = [], deleted: string[] = [], processes: unknown[] = []
  let day = '2026-10-05', now = 1_800_000_000_000, shown = false
  let effective: C3Settings = {guard:true,bookmark:true,notes:true,budget:'off',neighbours:false,...settings}
  const runtime = createC3Runtime({
    get: async key => store[key], set: async (key,value) => {await controls.beforeSet?.(key,value);store[key]=value;writes.push({key,value})},
    remove: async key => {delete store[key];deleted.push(key)},
    process: async (argv, options) => {processes.push({argv,options});return {exitCode:0,stdout:'',stderr:''}},
    executeAlgo: async request => {
      if(controls.executeAlgo)return controls.executeAlgo(request)
      if(request.op==='guard')return {hit:String(request.command).includes('rm -rf /')?{kind:'rm',reason:'recursive-delete',target:'/'}:undefined,commitCwd:String(request.command).includes('git commit')?'/work/project':undefined}
      if(request.op==='recognize')return String(request.command).includes('test')?{kind:'test',tool:'jest',key:'npm test'}:String(request.command)==='npm run build'?{kind:'build',tool:'vite',key:'npm run build'}:null
      if(request.op==='finish'){const outcome=request.exitCode===0?'pass':'fail',history=request.history as any,key=request.key as string;return {parsed:{outcome,...(outcome==='fail'?{firstFailing:'src/parser.test.ts › parser › keeps comments'}:{})},slowness:{slow:false},history:{...history,[key]:[...(history[key]??[]),{ms:request.ms,outcome}].slice(-9)}}}
      if(request.op==='pace')return {projections:[],hot:{state:{hot:{}},hot:[]}}
      return null
    },
    now: () => now, lang: () => 'en', settings: () => effective,
    localDay: () => day, windowName: kind => kind === 'five_hour' ? '5-hour window' : '7-day window',
    emit: line => {lines.push(line);if(shown)line.onShown?.();return shown?'shown':'queued'},
    reaction: reaction => {reactions.push(reaction)}, notice:(id,text)=>{notices.push({id,text})},
  })
  return {runtime,store,lines,reactions,writes,deleted,processes,notices,
    show:()=>{shown=true}, clock:(at:number)=>{now=at}, day:(d:string)=>{day=d}, settings:(s:Partial<C3Settings>)=>{effective={...effective,...s}}}
}

test('C3 bookmark stores only the main current todo, bounded and project relative file fallback', async () => {
 const h=harness();await h.runtime.start({cwd:'/work/project',turns:2})
 await h.runtime.toolStart({id:'todo',name:'TodoWrite',input:{todos:[{status:'in_progress',content:'Build the parser'}]}})
 await h.runtime.turnComplete({main:false,reason:'answer',contextPercent:10});expect(h.store.bookmarks).toBeUndefined()
 await h.runtime.turnComplete({main:true,reason:'answer',contextPercent:10});expect((h.store.bookmarks as any)['/work/project'].where).toBe('Build the parser')
 await h.runtime.toolStart({id:'todo2',name:'TodoWrite',input:{todos:[{status:'completed',content:'Build the parser'}]}})
 await h.runtime.toolStart({id:'edit',name:'Edit',input:{file_path:'/work/project/src/parser.ts'}}); await h.runtime.toolResult({id:'edit',output:'',exitCode:0})
 await h.runtime.turnComplete({main:true,reason:'answer',contextPercent:10});expect((h.store.bookmarks as any)['/work/project'].where).toBe('src/parser.ts')
})

for(const [cwd,path,relative] of [
 ['/work/project','/work/sibling/file.ts','../sibling/file.ts'],
 ['/work/project','../sibling/file.ts','../sibling/file.ts'],
 ['C:\\Work\\Project','c:\\Work\\Sibling\\file.ts','..\\Sibling\\file.ts'],
] as const)test(`C3 bookmark changed path ${path} is relative to ${cwd}`,async()=>{
 const h=harness();await h.runtime.start({cwd,turns:2})
 await h.runtime.toolStart({id:'sibling',name:'Edit',input:{file_path:path}});await h.runtime.toolResult({id:'sibling',output:'',exitCode:0})
 await h.runtime.turnComplete({main:true,reason:'answer',contextPercent:10})
 expect((h.store.bookmarks as any)?.[cwd]?.where).toBe(relative)
 if(relative!==undefined&&/^[\\/]|^[A-Za-z]:/.test(path))expect((h.store.bookmarks as any)[cwd].where).not.toBe(path)
 if(cwd.startsWith('C:')){
  const other=harness();await other.runtime.start({cwd,turns:2});await other.runtime.toolStart({id:'other-drive',name:'Edit',input:{file_path:'D:\\Work\\Sibling\\file.ts'}});await other.runtime.toolResult({id:'other-drive',output:'',exitCode:0});await other.runtime.turnComplete({main:true,reason:'answer',contextPercent:10});expect(other.store.bookmarks).toBeUndefined()
 }
})

test('C3 bookmark says once on a genuinely new first start, waits until shown, and expires on first prompt', async () => {
 const h=harness({bookmarks:{'/work/project':{where:'src/a.ts',kind:'file',at:100}}});await h.runtime.start({cwd:'/work/project',turns:0})
 expect(h.lines.length).toBe(1);expect(h.lines[0]!.text).toBe('your bookmark: src/a.ts.');expect(h.lines[0]!.class).toBe(0)
 await h.runtime.start({cwd:'/work/project',turns:0});expect(h.lines.length).toBe(1)
 await h.runtime.prompt({text:'Please inspect the parser carefully today'});expect(h.lines[0]!.valid!()).toBe(false)
})

test('C3 switches remove kept bookmarks and runs, clear once-only note occasions, and stop writes', async () => {
 const h=harness({bookmarks:{'/work/project':{where:'a',kind:'file',at:1}},runs:{old:[{ms:5000,outcome:'pass'}]},occasions:{warned:{'five_hour:1:pace':true,'five_hour:1:budget:80':true}}})
 await h.runtime.start({cwd:'/work/project',turns:3});h.settings({bookmark:false,notes:false,budget:'off'});await h.runtime.settingsChanged()
 expect(h.deleted).toContain('bookmarks');expect(h.deleted).toContain('runs');expect((h.store.occasions as any).warned).toEqual({})
 await h.runtime.toolStart({id:'r',name:'Bash',input:{command:'npm test'}});await h.runtime.toolResult({id:'r',output:'PASS all tests',exitCode:0})
 await h.runtime.turnComplete({main:true,reason:'answer',contextPercent:90});expect(h.store.bookmarks).toBeUndefined();expect(h.store.runs).toBeUndefined();expect(h.lines.length).toBe(0)
})

test('C3 guardian appears only while its exact call asks, resolves without a stale safety line', async () => {
 const h=harness();await h.runtime.start({cwd:'/work/project',turns:1,home:'/home/owner'});await h.runtime.toolStart({id:'rm1',name:'Bash',input:{command:'rm -rf /'}})
 expect(h.lines.length).toBe(0);await h.runtime.permission('rm1','ask');expect(h.lines[0]!.key).toBe('guard.rm');expect(h.lines[0]!.callId).toBe('rm1')
 await h.runtime.permission('rm1','resolved');expect(h.lines[0]!.valid!()).toBe(false)
})

test('C3 first named failure, three reds recovery, unknown outcomes and run caps', async () => {
 const h=harness();await h.runtime.start({cwd:'/work/project',turns:1});h.clock(10_000)
 for(let i=0;i<3;i++){await h.runtime.toolStart({id:'r'+i,name:'Bash',input:{command:'npm test'}});h.clock(20_000+i*10_000);await h.runtime.toolResult({id:'r'+i,output:'FAIL src/parser.test.ts\n  ● parser › keeps comments\n',exitCode:1})}
 expect(h.lines[0]!.key).toBe('first_down')
 await h.runtime.toolStart({id:'green',name:'Bash',input:{command:'npm test'}});h.clock(60_000);await h.runtime.toolResult({id:'green',output:'PASS all',exitCode:0})
 expect(h.lines[h.lines.length-1]!.key).toBe('green_after_reds');expect(h.reactions[h.reactions.length-1]!.kind).toBe('green_after_reds')
 for(let i=0;i<12;i++){await h.runtime.toolStart({id:'x'+i,name:'Bash',input:{command:'npm test'}});h.clock(80_000+i*10_000);await h.runtime.toolResult({id:'x'+i,output:'PASS all',exitCode:0})}
 expect(Object.values(h.store.runs as any).every((x:any)=>x.length<=9)).toBe(true)
})

test('C3 chapter waits until shown, requires answer and final successful test or commit, once per session', async () => {
 const h=harness();await h.runtime.start({cwd:'/work/project',turns:1});await h.runtime.turnComplete({main:true,reason:'answer',contextPercent:90});expect(h.lines.length).toBe(0)
 await h.runtime.toolStart({id:'green',name:'Bash',input:{command:'npm test'}});await h.runtime.toolResult({id:'green',output:'PASS',exitCode:0});await h.runtime.turnComplete({main:true,reason:'answer',contextPercent:80})
 const line=h.lines.find(x=>x.key==='chapter')!;expect(line.class).toBe(2);expect(line.button!.key).toBe('coco:chapter:compact');line.onShown!()
 await h.runtime.turnComplete({main:true,reason:'answer',contextPercent:90});expect(h.lines.filter(x=>x.key==='chapter').length).toBe(1)
})

test('C3 reset during a pace worker cannot restore hot incense, notes, or occasions',async()=>{
 let release!:(result:unknown)=>void,entered!:()=>void
 const began=new Promise<void>(resolve=>{entered=resolve}),held=new Promise(resolve=>{release=resolve})
 const h=harness({}, {},{executeAlgo:async request=>{if(request.op==='pace'){entered();return held}return null}})
 await h.runtime.start({cwd:'/work/project',turns:1});const at=1_800_000_000_000,reset=at+5_000_000
 const pending=h.runtime.measure([{kind:'five_hour',percentUsed:80,resetsAt:reset}],at);await began;h.runtime.reset()
 release({projections:[{kind:'five_hour',runsOutAt:at+100000,resetsAt:reset}],hot:{state:{hot:{five_hour:true}},hot:['five_hour']}});await pending;await h.runtime.flush()
 expect(h.runtime.view().pace).toEqual([]);expect(h.lines).toEqual([]);expect(h.store.occasions).toBeUndefined()
})

for(const key of ['bookmarks','runs'] as const)test(`C3 switching off ${key} serializes deletion after an in-flight store write`,async()=>{
 let release!:()=>void,entered!:()=>void
 const began=new Promise<void>(resolve=>{entered=resolve}),held=new Promise<void>(resolve=>{release=resolve})
 const h=harness({occasions:{warned:{'five_hour:1:pace':true,'five_hour:1:budget:80':true}}},{budget:80},{beforeSet:async writing=>{if(writing===key){entered();await held}}})
 await h.runtime.start({cwd:'/work/project',turns:1});let pending:Promise<void>
 if(key==='bookmarks'){
  await h.runtime.toolStart({id:'edit',name:'Edit',input:{file_path:'/work/project/private.ts'}});await h.runtime.toolResult({id:'edit',output:'',exitCode:0});pending=h.runtime.turnComplete({main:true,reason:'answer',contextPercent:10})
 }else{
  await h.runtime.toolStart({id:'run',name:'Bash',input:{command:'npm test'}});h.clock(1_800_000_002_000);pending=h.runtime.toolResult({id:'run',output:'all passed',exitCode:0})
 }
 await began;h.settings({bookmark:false,notes:false,budget:'off'});const off=h.runtime.settingsChanged()
 for(let i=0;i<8;i++)await Promise.resolve();const deletedBeforeCommit=h.deleted.includes(key)
 release();await Promise.all([pending,off]);await h.runtime.flush()
 expect(deletedBeforeCommit).toBe(false);expect(h.store[key]).toBeUndefined();expect((h.store.occasions as any).warned).toEqual({})
})

test('C3 simultaneous budget crossings show the five-hour line first and queue the seven-day line',async()=>{
 const slot=new LineSlot(),h=harness({}, {notes:false,budget:80})
 const sink=h.lines;await h.runtime.start({cwd:'/work/project',turns:1});const at=1_800_000_000_000,reset=at+5_000_000
 await h.runtime.measure([{kind:'seven_day',percentUsed:70,resetsAt:reset},{kind:'five_hour',percentUsed:70,resetsAt:reset}],at)
 await h.runtime.measure([{kind:'seven_day',percentUsed:85,resetsAt:reset},{kind:'five_hour',percentUsed:85,resetsAt:reset}],at+1000)
 for(const line of sink)slot.offer(line,at+1000)
 expect(slot.visible(at+1000)?.text).toBe('5-hour window used 85% of your budget.');expect(slot.queued()).toBe('seven_day:'+reset+':budget:80')
 slot.markShown(slot.visible(at+1000)!.id,at+1000);slot.advance(at+15000)
 expect(slot.visible(at+15000)?.text).toBe('7-day window used 85% of your budget.')
})

test('C3 budgets need a same-period crossing, use the reading value, commit occasions only when shown', async () => {
 const h=harness({}, {budget:80});await h.runtime.start({cwd:'/work/project',turns:1});const at=1_800_000_000_000,reset=at+10_000_000
 await h.runtime.measure([{kind:'five_hour',percentUsed:83,resetsAt:reset}],at);expect(h.lines.length).toBe(0)
 await h.runtime.measure([{kind:'five_hour',percentUsed:75,resetsAt:reset}],at+1_000)
 await h.runtime.measure([{kind:'five_hour',percentUsed:83,resetsAt:reset}],at+2_000);expect(h.lines[0]!.text).toBe('5-hour window used 83% of your budget.');expect(h.store.occasions).toBeUndefined()
 h.lines[0]!.onShown!();await h.runtime.flush();expect(Object.keys((h.store.occasions as any).warned)).toEqual(['five_hour:'+reset+':budget:80'])
})

test('C3 secret scan retains only relative file and added line, never the matched secret', () => {
 const key='sk-ant-api03-'+'a'.repeat(100);const diff='diff --git a/src/config.ts b/src/config.ts\n+++ b/src/config.ts\n@@ -4,0 +5,1 @@\n+const key = "'+key+'"\n'
 const found=scanStagedSecrets(diff)!;expect(found).toEqual({file:'src/config.ts',line:5});expect(JSON.stringify(found).includes(key)).toBe(false)
 expect(scanStagedSecrets('+++ b/README.md\n@@ -0,0 +1,1 @@\n+password=example')).toBeUndefined()
})

test('C3 thanks are short native words in all supported languages', () => {
 for(const text of ['谢谢','thanks','ありがとう','danke','gracias','merci','धन्यवाद','makasih','grazie','고마워','obrigado'])expect(isThanks(text)).toBe(true)
 expect(isThanks('Thank you for earlier help, now please completely rewrite the parser and all tests.')).toBe(false)
})

test('C3 queued budget survives a sixty-second safety wait while its crossing remains valid',async()=>{
 const h=harness({}, {budget:80}),at=1_800_000_000_000,reset=at+10_000_000,slot=new LineSlot();await h.runtime.start({cwd:'/work/project',turns:1})
 slot.offer({key:'guard.rm',text:'safety',class:3,ttl:0,untilTurn:true},at)
 await h.runtime.measure([{kind:'five_hour',percentUsed:75,resetsAt:reset}],at)
 await h.runtime.measure([{kind:'five_hour',percentUsed:83,resetsAt:reset}],at+1000)
 expect(slot.offer(h.lines[0]!,at+1000)).toBe('queued');slot.clear('turn',at+61000)
 expect(slot.visible(at+61000)?.text).toBe('5-hour window used 83% of your budget.')
})



test('M1 A6 honest execution duration excludes a 30-second permission wait from C3 history',async()=>{
 const h=harness();await h.runtime.start({cwd:'/work/project',turns:2})
 const start=1_800_000_000_000
 await h.runtime.toolStart({id:'honest',name:'Bash',input:{command:'npm test'},at:start})
 await h.runtime.permission('honest','ask')
 h.clock(start+30000);await h.runtime.permission('honest','resolved')
 h.runtime.executionDuration('honest',1000)
 h.clock(start+31000);await h.runtime.toolResult({id:'honest',output:'1 passed',exitCode:0,at:start+31000})
 await h.runtime.flush()
 // Main keys stored run history by the command's hash (merged 10-09).
 expect((h.store.runs as Record<string,{ms:number}[]>)[sha256('npm test')]!.at(-1)!.ms).toBe(1000);expect(JSON.stringify(h.store.runs).includes('npm test')).toBe(false)
 expect(h.runtime.runKind('honest')).toBe('test')
 await h.runtime.toolStart({id:'build',name:'Bash',input:{command:'npm run build'},at:start+32000})
 await h.runtime.toolResult({id:'build',output:'built successfully',exitCode:0,at:start+33000})
 expect(h.runtime.runKind('build')).toBe('build')
})

test('M1 A27 task completion removes a completed in-progress bookmark and follows the next task',async()=>{
 const h=harness();await h.runtime.start({cwd:'/work/project',turns:2})
 await h.runtime.task('first task')
 expect(h.runtime.view().bookmark?.where).toBe('first task')
 await h.runtime.task('next task')
 expect(h.runtime.view().bookmark?.where).toBe('next task')
 await h.runtime.task()
 expect(h.runtime.view().bookmark).toBeUndefined()
 expect((h.store.bookmarks as Record<string,unknown>)['/work/project']).toBeUndefined()
})

test('M1 gaps1 commits use validated successful Bash metadata with notes and guard off',async()=>{
 const h=harness({}, {guard:false,notes:false}, {executeAlgo:async request=>request.op==='guard'?{commitCwd:String(request.command).startsWith('git -C ')?'/work/other':undefined}:null})
 await h.runtime.start({cwd:'/work/project',turns:2})
 for(const [id,command,exitCode,denied,interrupted,expected] of [
  ['commit','git -C /work/other commit -m done',0,false,false,true],
  ['echo','echo git commit',0,false,false,false],
  ['failed','git -C /work/other commit -m done',1,false,false,false],
  ['denied','git -C /work/other commit -m done',0,true,false,false],
  ['interrupted','git -C /work/other commit -m done',0,false,true,false],
 ] as const){
  await h.runtime.toolStart({id,name:'Bash',input:{command}})
  await h.runtime.toolResult({id,output:'',exitCode,denied,interrupted})
  expect(h.runtime.committed(id)).toBe(expected)
 }
 expect(h.processes.length).toBe(0)
 h.runtime.reset();expect(h.runtime.committed('commit')).toBe(false)
})


// P1 part 2: source vectors pin the hash independently of the implementation.
test('B4 SHA-256 UTF-8 vector e3b0c442',()=>{expect(sha256("")).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')})
test('B4 SHA-256 UTF-8 vector ba7816bf',()=>{expect(sha256("abc")).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')})
test('B4 SHA-256 UTF-8 vector ff0c0a11',()=>{expect(sha256("npm test P1_PRIVATE_TOOL_CONTENT_c729a48e")).toBe('ff0c0a11672216e53cd869a4b62189d97a02edbc86643bd3ba86b9dfeaadd22d')})
test('B4 SHA-256 UTF-8 vector 9e968f20',()=>{expect(sha256("任务 😀")).toBe('9e968f209a90db4f671d7269a37842c97dbe2bf9ef40fbc7145c9a1119968cfe')})


test('B4 bookmark redacts every guard secret family before Unicode clipping',()=>{
 const secrets=['AKIA'+'A'.repeat(16),'ASIA'+'B'.repeat(16),'-----BEGIN OPENSSH PRIVATE KEY-----','sk-ant-api03-'+'x'.repeat(40),'sk-'+'y'.repeat(40),'ghp_'+'z'.repeat(40),'github_pat_'+'A'.repeat(40),'xoxb-'+'b'.repeat(40),'AIza'+'c'.repeat(35),'glpat-'+'d'.repeat(40),'hf_'+'e'.repeat(40),'SG.'+'f'.repeat(20)+'.'+'g'.repeat(20)]
 for(const secret of secrets){const diff='+++ b/task.txt\n@@ -0,0 +1 @@\n+'+secret;expect(scanStagedSecrets(diff)).toEqual({file:'task.txt',line:1});expect(redactSecrets('keep '+secret+' then '+secret)).toBe(secret.startsWith('-----BEGIN ')?'keep «…»':'keep «…» then «…»')}
 for(const name of ['password','passwd','pwd','api_key','api-key','access_token','access-token','secret']){
  const secret='aBcDeF1234567890ZyxwVu';expect(scanStagedSecrets('+++ b/task.txt\n@@ -0,0 +1 @@\n+'+name+'="'+secret+'"')).toEqual({file:'task.txt',line:1});expect(redactSecrets(name+'="'+secret+'"')).toBe(name+'="«…»"')
 }
 expect(redactSecrets('password="exampleexampleexample"')).toBe('password="exampleexampleexample"')
})

test('B4 first load scrubs old bookmark secrets and clips after redaction',async()=>{
 const secret='sk-ant-api03-'+'x'.repeat(90),text='😀'.repeat(190)+secret
 const h=harness({bookmarks:{'/work/project':{where:text,kind:'todo',at:1}}});await h.runtime.start({cwd:'/work/project',turns:2});await h.runtime.flush()
 expect((h.store.bookmarks as any)['/work/project'].where).toBe('😀'.repeat(190)+'«…»');expect(JSON.stringify(h.writes)).not.toContain(secret)
 await h.runtime.toolStart({id:'boundary',name:'TodoWrite',input:{todos:[{status:'in_progress',content:'😀'.repeat(199)+secret}]}});await h.runtime.turnComplete({main:true,reason:'answer',contextPercent:10})
 expect((h.store.bookmarks as any)['/work/project'].where).toBe('😀'.repeat(197)+'«…»');expect([...((h.store.bookmarks as any)['/work/project'].where)].length).toBe(200)
})

test('B4 migrated SHA-256 timings still signal twice-as-slow build and never double hash',async()=>{
 const key='npm run build',digest=sha256(key),samples=Array.from({length:3},()=>({ms:5000,outcome:'pass'}))
 const h=harness({runs:{[key]:samples}},{},{executeAlgo:async request=>executeC3Algo(request)});await h.runtime.start({cwd:'/work/project',turns:2});await h.runtime.flush()
 expect(h.store.runs).toEqual({[digest]:samples});expect(h.writes.filter(entry=>entry.key==='runs').length).toBe(1)
 h.clock(10000);await h.runtime.toolStart({id:'build',name:'Bash',input:{command:'npm run build'}});h.clock(20000);await h.runtime.toolResult({id:'build',output:'built successfully',exitCode:0});await h.runtime.flush()
 expect(h.lines.some(line=>line.key==='slow_build')).toBe(true);expect((h.store.runs as any)[digest]).toEqual([...samples,{ms:10000,outcome:'pass'}]);expect(Object.keys(h.store.runs as object)).toEqual([digest])
 const again=harness({runs:h.store.runs});await again.runtime.start({cwd:'/work/project',turns:2});expect(again.writes.filter(entry=>entry.key==='runs')).toEqual([])
})

test('B4 mixed legacy and hashed timing records merge without losing durations',async()=>{
 const key='npm test',digest=sha256(key),a={ms:1200,outcome:'pass'},b={ms:2000,outcome:'fail'}
 const h=harness({runs:{[key]:[a],[digest]:[b]}});await h.runtime.start({cwd:'/work/project',turns:2});expect(h.store.runs).toEqual({[digest]:[a,b]})
})

test('B4 SHA-256 multi-block vector',()=>{expect(sha256('a'.repeat(100))).toBe('2816597888e4a0d3a36b82b83316ab32680eb8f00f8cd3b904d681246d285a0e')})


test('B4 first load migrates timing keys with notes off before explicit clearing',async()=>{
 const key='npm test private-argument',samples=[{ms:1200,outcome:'pass'},{ms:3000,outcome:'fail'}]
 const h=harness({runs:{[key]:samples}},{notes:false});await h.runtime.start({cwd:'/work/project',turns:2});await h.runtime.flush()
 const migration=h.writes.filter(entry=>entry.key==='runs');expect(migration.length).toBe(1);expect(migration[0]!.value).toEqual({[sha256(key)]:samples});expect(JSON.stringify(migration)).not.toContain('private-argument')
 expect(h.deleted).toContain('runs');expect(h.store.runs).toBeUndefined()
})


test('B4 bookmark boundary preserves complete adjacent redaction markers',()=>{
 expect(bookmarkText('😀'.repeat(196)+'«…»«…»')).toBe('😀'.repeat(196)+'«…»')
 expect(bookmarkText('😀'.repeat(198)+'«…»')).toBe('😀'.repeat(197)+'«…»')
 expect(bookmarkText('😀'.repeat(197)+'«…»')).toBe('😀'.repeat(197)+'«…»')
})


test('B4 bookmark removes entire supported PEM key bodies and unterminated remainders',async()=>{
 const body='P1_PRIVATE_PEM_BODY_0123456789abcdef',prefix='keep task words '
 for(const kind of ['','RSA ','EC ','DSA ','OPENSSH ','ENCRYPTED ']){
  const header='-----BEGIN '+kind+'PRIVATE KEY-----',end='-----END '+kind+'PRIVATE KEY-----',complete=prefix+header+'\n'+body+'\n'+end+' then continue',unterminated=prefix+header+'\n'+body+' trailing remainder'
  expect(scanStagedSecrets('+++ b/task.txt\n@@ -0,0 +1 @@\n+'+header)).toEqual({file:'task.txt',line:1})
  expect(redactSecrets(complete)).toBe(prefix+'«…» then continue');expect(redactSecrets(unterminated)).toBe(prefix+'«…»')
  const h=harness();await h.runtime.start({cwd:'/work/project',turns:2});await h.runtime.toolStart({id:'pem',name:'TodoWrite',input:{todos:[{status:'in_progress',content:complete}]}});await h.runtime.turnComplete({main:true,reason:'answer',contextPercent:10})
  expect((h.store.bookmarks as any)['/work/project'].where).toBe(prefix+'«…» then continue');expect(JSON.stringify(h.writes)).not.toContain(body)
 }
})
