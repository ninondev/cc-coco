// W1 order Do 3: exact v3 words replace old text pins; all other properties stay.
// C3's actual registered hooks, driven through the pinned engine API. Heavy worker
// semantics have independent Bun coverage; this seam returns controlled envelopes.
import {test,expect} from 'claude-code/testing'
import type {On} from 'claude-code'
import {MORNING,PERSON,P,RECENT,band,desktopPicture,settleLegacyStart,world,SUMMARY} from './world'
import {C3_WORDS_RAW} from './c3-words-fixture'
import {cells} from '../hooks/band'
import {compactChapter} from '../hooks/mod-gaps'
import {WORDS as CORE_WORDS} from '../hooks/words'
import {WINDOWS_ROOTS} from './test-system'
import {C3_HEAD_MANIFEST} from './c3-head-assets'
const WORDS=JSON.parse(C3_WORDS_RAW),START={cwd:WINDOWS_ROOTS?'C:\\Users\\windows\\project':'/tmp/c3-events',surface:'vscode' as const,isInteractive:true}
const OK={exitCode:0,stdout:'',stderr:'',isStdoutTruncated:false,isStderrTruncated:false}
const complete=(turnId='t1',agentId?:string)=>({turnId,answer:'done',reason:'answer' as const,durationMs:900,isAborted:false,...(agentId?{agentId}:{})})
const text=(v:any):string=>typeof v==='string'?v:Array.isArray(v)?v.map(text).join(''):v&&typeof v==='object'?text(v.children):''
function fixture(on:On, options:{surface?:'desktop'|'terminal'|'vscode'|'mobile';store?:Record<string,unknown>;ask?:boolean;turns?:number;percent?:number;secret?:boolean;compactDeny?:boolean;durationMs?:number;namedFailure?:boolean;frames?:boolean;settings?:Record<string,unknown>}={}){
 let outcome:'pass'|'fail'|'unknown'='pass',slow=false
 const notices:{id:string,text?:string}[]=[],toasts:{text:string,timeout?:number}[]=[],writes:{key:string,value:unknown}[]=[],deleted:string[]=[],workers:string[]=[],paceRequests:any[]=[],commands:string[]=[],compacts:{trigger:string;instructions?:string;summarizeInstructions?:string}[]=[],fills:string[]=[],scans:unknown[]=[]
 on('session.turns',()=>({value:options.turns??0}))
 on('store.*',($,e,next)=>{if(next.is('store.set',e))writes.push({key:e.key,value:e.value});if(next.is('store.delete',e))deleted.push(e.key);return next(e)})
 on('ui.*',($,e,next)=>{if(next.is('ui.toast',e))toasts.push({text:e.text,timeout:e.timeoutMs});return next(e)})
 on('ui.notice',($,e)=>{notices.push({id:e.tool_use_id,text:e.text});return {value:undefined}})
 on('prompt.fill',($,e)=>{fills.push(e.text);return {isFilled:true}})
 on('process.run',($,e)=>{
  if(e.argv[0]==='/usr/bin/git'){scans.push({argv:e.argv,cwd:e.init?.cwd});return {value:{...OK,stdout:options.secret?'+++ b/src/config.ts\n@@ -4,0 +5,1 @@\n+api_key="sk-ant-api03-'+ 'x'.repeat(90)+'"\n':''}}}
  if(e.argv[1]?.endsWith('algo-worker.mjs')){
   const request=JSON.parse(e.init?.stdin??'{}');workers.push(request.op);let result:any=null
   if(request.op==='guard')result={hit:request.command==='rm -rf /'?{kind:'rm',reason:'recursive-delete',target:'/'}:undefined,commitCwd:request.command.includes('git commit')?START.cwd:undefined}
   if(request.op==='secrets')result={file:'src/config.ts',line:5}
   if(request.op==='recognize')result=request.command.includes('test')?{kind:'test',tool:'jest',key:'npm test'}:request.command.includes('build')?{kind:'build',tool:'npm',key:'npm build'}:null
   if(request.op==='finish')result={parsed:{outcome,...(outcome==='fail'&&options.namedFailure!==false?{firstFailing:'src/parser.test.ts › parser › keeps comments'}:{})},slowness:{slow,usualMs:5000},history:{...request.history,[request.key]:[...(request.history[request.key]??[]),{ms:request.ms,outcome}].slice(-9)}}
   if(request.op==='pace'){paceRequests.push(request)
    const points=request.readings.filter((r:any)=>r.kind==='five_hour'),current=points[points.length-1]
    result={projections:points.length>=3?[{kind:'five_hour',resetsAt:current.resetsAt,runsOutAt:request.now+3_600_000,early:true}]:[],hot:{state:{hot:{}},hot:points.length>=3?['five_hour']:[]}}
   }
   return {value:{...OK,stdout:JSON.stringify({ok:true,result})}}
  }
  return {value:OK}
 })
 // MOD-GAPS9 uses the native compaction event, so the legacy command observer
 // must stay empty. The kit lacks native transcript metadata on this plugin call;
 // its skipped shipping compact observer is not counted as shed acceptance.
 on('session.*',($,e,next)=>{
  if(!next.is('session.compact',e))return next(e)
  // The SDK exposes the plugin call's arguments, before native trigger/transcript enrichment.
  compacts.push({instructions:e.instructions,summarizeInstructions:(e as any).summarizeInstructions})
  if(options.compactDeny)return {skip:'controlled refusal'}
  return {messages:[SUMMARY],tokensBefore:138000,tokensAfter:20000}
 })
 on('command.run',{command:'compact'},()=>{commands.push('compact');return {text:''}})
 const w=world(on,{sessionTurns:false,store:{...RECENT,firstMet:MORNING,stamps:{met:MORNING},...options.store},surfaces:[options.surface??'vscode'],settings:options.settings,sessionRoot:WINDOWS_ROOTS?START.cwd:undefined,ask:options.ask,percent:options.percent,env:{HOME:'/tmp/c3-home',LANG:'en_US.UTF-8',TERM:'xterm-256color'},readText:path=>path.endsWith('c3-text.json')?C3_WORDS_RAW:options.frames&&path.endsWith('frame-manifest.json')?JSON.stringify(C3_HEAD_MANIFEST):undefined,hold:tool=>tool==='Bash'?w.clock.advance(options.durationMs??1000):undefined})
 return {w,notices,toasts,writes,deleted,workers,paceRequests,commands,compacts,fills,scans,outcome:(value:typeof outcome)=>{outcome=value;w.fails=value==='fail'},slow:(value:boolean)=>{slow=value}}
}
async function begin($:any,f:ReturnType<typeof fixture>,surface:'desktop'|'terminal'|'vscode'|'mobile'='vscode'){
 await $.session.start({...START,surface});await settleLegacyStart($,f.w)
 await $.turn.start({text:'work',turnId:'t1'});await $.tool.call({tool:'Read',file_path:START.cwd+'/seed.ts'})
}

test('C3 actual hook classifies before allowed Bash, but only an asking call receives a guardian notice',async($,on)=>{
 let enter!:(id:string)=>void,finish!:()=>void
 const started=new Promise<string>(resolve=>{enter=resolve}),held=new Promise<void>(resolve=>{finish=resolve})
 on('tool.call',{tool:'Bash'},async($,e,next)=>{if(e.tool==='Bash'){enter(e.tool_use_id);await held}return next(e)})
 const f=fixture(on,{ask:true})
 await begin($,f);const running=$.tool.call({tool:'Bash',command:'rm -rf /'}),id=await started
 expect(f.notices.filter(n=>n.text!==undefined).length).toBe(0)
 await $.tool.check({tool:'Bash',input:{command:'rm -rf /'},tool_use_id:id});expect(f.notices.some(n=>n.id===id&&n.text===WORDS['guard.rm'].en.replace('{target}','/'))).toBe(true)
 finish();await running;expect(f.notices[f.notices.length-1]!.text).toBeUndefined();expect(f.workers).toContain('guard')
})

test('C3 terminal band guardian has one safety line until resolution and no duplicate notice',async($,on)=>{
 let enter!:(id:string)=>void,finish!:()=>void
 const started=new Promise<string>(resolve=>{enter=resolve}),held=new Promise<void>(resolve=>{finish=resolve})
 on('tool.call',{tool:'Bash'},async($,e,next)=>{if(e.tool==='Bash'){enter(e.tool_use_id);await held}return next(e)})
 const f=fixture(on,{surface:'terminal',ask:true})
 await begin($,f,'terminal');const ui=await $.ui.mount({surface:'terminal',...band(100,true)});const running=$.tool.call({tool:'Bash',command:'rm -rf /'}),id=await started
 await $.tool.check({tool:'Bash',input:{command:'rm -rf /'},tool_use_id:id});await ui.redraw();expect(text(await ui.drawn())).toContain(WORDS['guard.rm'].en.replace('{target}','/'));expect(f.notices.some(n=>n.text!==undefined)).toBe(false)
 finish();await running;await ui.redraw();expect(text(await ui.drawn())).not.toContain(WORDS['guard.rm'].en.replace('{target}','/'));await ui.unmount()
})

test('C3 staged secret after an auto-allowed commit names only file and line, scans once, never stores token',async($,on)=>{
 const f=fixture(on,{secret:true});await begin($,f);await $.tool.call({tool:'Bash',command:'git commit -m done'})
 expect(f.scans.length).toBe(1)
 const scan=f.scans[0] as {argv:readonly string[];cwd?:string}
 expect(scan.argv[0]).toBe('/usr/bin/git');expect(scan.cwd).toBe(START.cwd)
 for(const flag of ['--no-pager','--no-lazy-fetch','--no-ext-diff','--no-textconv','--ignore-submodules=all','core.fsmonitor=false','core.hooksPath=/dev/null','core.pager=cat','diff.external='])expect(scan.argv).toContain(flag)
 expect(f.toasts.some(t=>t.text===WORDS['guard.secretAfter'].en.replace('{file}','src/config.ts').replace('{line}','5')&&t.timeout===12000)).toBe(true)
 expect(JSON.stringify(f.writes).includes('sk-ant-api03-')).toBe(false);expect(JSON.stringify(f.notices).includes('sk-ant-api03-')).toBe(false)
})

test('C3 run result uses first failing name, red-to-green burst count, and limits stored history to nine',async($,on)=>{
 const f=fixture(on);await begin($,f)
 for(let i=0;i<3;i++){f.outcome('fail');await $.tool.call({tool:'Bash',command:'npm test'})}
 expect(f.toasts.some(t=>t.text===WORDS.first_down.en.replace('{name}','src/parser.test.ts › parser › keeps comments'))).toBe(true)
 f.outcome('pass');await $.tool.call({tool:'Bash',command:'npm test'});expect(f.toasts.some(t=>WORDS.green_after_reds.en.map((s:string)=>s.replace('{n}','3')).includes(t.text))).toBe(true)
 expect((f.w.view() as any).pose.celebration).toBe(3)
 for(let i=0;i<12;i++){await f.w.clock.advance(1000);await $.tool.call({tool:'Bash',command:'npm test'})}
 const histories=f.writes.filter(w=>w.key==='runs');expect(histories.length).toBeGreaterThan(0);expect(Object.values(histories[histories.length-1]!.value as any).every((x:any)=>x.length<=9)).toBe(true)
})

test('C3 slow build uses approved duration words and loses to a named failure',async($,on)=>{
 const f=fixture(on,{durationMs:10000});f.slow(true);await begin($,f)
 // The history's median is returned by the independently tested worker seam.
 const expected=WORDS.slow_build.en.replace('{now}','10s').replace('{usual}','5s')
 await $.tool.call({tool:'Bash',command:'npm run build'});expect(f.toasts.some(t=>t.text===expected)).toBe(true)
 const before=f.toasts.filter(t=>t.text===expected).length;f.outcome('fail');await $.tool.call({tool:'Bash',command:'npm run build'});expect(f.toasts.filter(t=>t.text===expected).length).toBe(before)
})

test('C3 bookmark survives main completion only, appears on new conversation and excludes resumed startup',async($,on)=>{
 const b={where:'Continue the parser',kind:'todo',at:MORNING-1000},f=fixture(on,{store:{bookmarks:{[START.cwd]:b}},turns:0})
 await $.session.start(START);await settleLegacyStart($,f.w);expect(f.toasts.some(t=>t.text===WORDS.bookmark.en.replace('{where}',b.where))).toBe(true)
 await $.turn.start({text:'work',turnId:'t1'});await $.tool.call({tool:'TodoWrite',todos:[{status:'in_progress',content:'Add parser tests',activeForm:'Adding parser tests'}]})
 await $.turn.complete(complete('child','worker'));expect(f.writes.filter(w=>w.key==='bookmarks').length).toBe(0)
 await $.turn.complete(complete());expect((f.writes.find(w=>w.key==='bookmarks')!.value as any)[START.cwd].where).toBe('Add parser tests')
 await $.session.start(START);await settleLegacyStart($,f.w);expect(f.toasts.filter(t=>t.text===WORDS.bookmark.en.replace('{where}',b.where)).length).toBe(1)
})

test('C3 bookmarks are not greeted on a resumed conversation',async($,on)=>{
 const f=fixture(on,{store:{bookmarks:{[START.cwd]:{where:'Continue the parser',kind:'todo',at:MORNING-1000}}},turns:4})
 await $.session.start(START);await settleLegacyStart($,f.w);expect(f.toasts.some(t=>t.text===WORDS.bookmark.en.replace('{where}','Continue the parser'))).toBe(false)
 await $.turn.start({text:'work',turnId:'t1'});await $.tool.call({tool:'TodoWrite',todos:[{status:'in_progress',content:'Resume parser tests',activeForm:'Resuming parser tests'}]});await $.turn.complete(complete());expect((f.writes.find(w=>w.key==='bookmarks')!.value as any)[START.cwd].where).toBe('Resume parser tests')
})

test('C3 budget needs a true same-period crossing and remembers only the shown reading',async($,on)=>{
 const f=fixture(on,{store:{bandSettings:{budget:80}}});await begin($,f);const reset=new Date(MORNING+6*3_600_000).toISOString()
 // W1 exact budget sentence / C2 number rule: {p} owns the complete localized percentage.
 const expected=WORDS.budget.en.replace('{window}','5-hour window').replace('{p}',new Intl.NumberFormat('en',{style:'percent',maximumFractionDigits:0}).format(.83))
 const measure=async(percentUsed:number)=>{const limits=[{kind:'five_hour',percentUsed,resetsAt:reset}];f.w.limits=limits;await $.session.measure({context:{window:200000,tokens:40000,percent:20},rateLimits:limits,changed:['rateLimits']})}
 await measure(83);expect(f.toasts.some(t=>t.text===expected)).toBe(false)
 await measure(75);await measure(83);expect(f.toasts.some(t=>t.text===expected)).toBe(true)
 await measure(70);await measure(83);expect(f.toasts.filter(t=>t.text===expected).length).toBe(1)
})

for(const deny of [false,true])test(`C3 chapter button ${deny?'dispatches unchanged args; rejected helper fills exact fallback':'dispatches unchanged args'} and appears only after a green answer at >=75%`,async($,on)=>{
 const f=fixture(on,{surface:'terminal',percent:80});await begin($,f,'terminal')
 const ui=await $.ui.mount({surface:'terminal',...band(120,true)})
 await $.tool.call({tool:'Bash',command:'npm test'});await $.turn.complete(complete());await ui.redraw()
 const button=await ui.find({type:'Button',key:'coco:chapter:compact'});expect(button).toBeDefined();expect(button!.props.label).toBe(WORDS['chapter.button'].en)
 await ui.press({key:'coco:chapter:compact'});expect(f.compacts).toEqual([{instructions:undefined,summarizeInstructions:undefined}]);expect(f.commands).toEqual([]);expect(f.fills).toEqual([])
 // The SDK swallows a throwing call observer; refusal is checked at the shared adapter.
 if(deny){await compactChapter(async()=>{throw new Error('controlled refusal')},text=>$.prompt.fill({text}));expect(f.fills).toEqual(['/compact'])}
 await ui.redraw();expect(await ui.find({type:'Button',key:'coco:chapter:compact'})).toBeUndefined();await ui.unmount()
})

test('C3 terminal action reserves the native button and its one-cell gap on the working row',async($,on)=>{
 const f=fixture(on,{surface:'terminal',percent:80});await begin($,f,'terminal')
 await $.tool.call({tool:'Bash',command:'npm test'});await $.turn.complete(complete())
 const descendants=(node:any):any[]=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(descendants):[node,...(node.children??[]).flatMap(descendants)]
 // Measure the entire serialized row independently of the renderer's fitting budget.
 const nativeExtent=(node:any):number=>{
  if(typeof node==='string'||typeof node==='number')return cells(String(node))
  if(!node||typeof node!=='object')return 0
  if(Array.isArray(node))return node.reduce((sum,n)=>sum+nativeExtent(n),0)
  const p=node.props??{}
  if(p.display==='none')return 0
  const margins=Number(p.marginLeft??0)+Number(p.marginRight??0)
  if(node.type==='Text')return margins+cells(text(node))
  if(node.type==='Button')return margins+cells(p.label)+(p.plain?0:4)
  const children=(node.children??[]).filter((n:any)=>n!==null&&n!==undefined&&n!==false&&n?.props?.display!=='none')
  const widths=children.map(nativeExtent),column=String(p.flexDirection??'row').startsWith('column')
  return margins+2*Number(p.paddingX??0)+(column?Math.max(0,...widths):widths.reduce((sum:number,n:number)=>sum+n,0)+Math.max(0,widths.length-1)*Number(p.columnGap??p.gap??0))
 }
 const bareMarker=(node:any)=>descendants(node).some(n=>n.type==='Text'&&text(n).trim()==='…')
 const name=CORE_WORDS.en.name,buttonLabel=WORDS['chapter.button'].en,buttonCells=cells(buttonLabel)+4
 const source=WORDS.chapter.en,firstWord=/[\p{L}\p{N}]+/u.exec(source)![0]
 // The former speech+button calculation misses the name and permits an overflowing 24-cell row. Every name is four
 // cells since Japanese says Coco too (DECISIONS line 954), so the example takes a name one cell too wide.
 const tooWide='W'.repeat(24-(cells(' …')+buttonCells+1)+1)
 const oldOverflow={type:'Box',props:{flexDirection:'row'},children:[{type:'Text',children:[tooWide]},{type:'Box',props:{columnGap:1},children:[{type:'Text',children:[' …']},{type:'Button',props:{label:buttonLabel}}]}]}
 expect(cells(' …')+buttonCells+1<=24).toBe(true)
 expect(nativeExtent(oldOverflow)>24).toBe(true)
 expect(bareMarker({type:'Text',children:[' …']})).toBe(true)
 expect(bareMarker({type:'Text',children:[' nearly…']})).toBe(false)
 for(const columns of [24,32,40]){
  const ui=await $.ui.mount({surface:'terminal',...band(columns,true)})
  const tree=await ui.drawn(),nodes=descendants(tree)
  // SPEC 1.2 / visual review row 6: the working terminal line is one row, including its button.
  const row=nodes.find(n=>n.type==='Box'&&n.props?.flexWrap==='nowrap')
  expect(row).toBeDefined()
  const buttons=descendants(row).filter(n=>n.type==='Button'&&n.props?.key==='coco:chapter:compact')
  const buttonFits=cells(name)+1+buttonCells<=columns
  expect(buttons.length).toBe(buttonFits?1:0)
  if(buttonFits){expect(buttons[0].props.label).toBe(buttonLabel);expect(descendants(row).filter(n=>n.type==='Button').length).toBe(1)}
  else{expect(columns).toBe(24);expect(descendants(row).some(n=>n.type==='Button')).toBe(false)}
  expect(bareMarker(tree)).toBe(false)
  const spoken=descendants(row).find(n=>n.type==='Text'&&!n.props?.bold&&n.props?.wrap),speech=spoken?text(spoken).trim():''
  if(spoken)expect(spoken.props.wrap).toBe('truncate-end')
  // His name gives way before the line is cut (BAND 3.2); at 40 columns it would cost the line its /compact, so it goes.
  expect([columns,nodes.some(n=>n.type==='Text'&&n.props?.bold&&text(n)===name)]).toEqual([columns,columns>=40&&!speech.includes('/compact')])
  const fixedWidth=nativeExtent(tree)-(spoken?cells(text(spoken)):0)
  const usefulWordExtent=fixedWidth+1+cells(firstWord+'…')+(buttons.length&&!spoken?1:0)
  if(!speech)expect(usefulWordExtent<=columns).toBe(false)
  else{
   const kept=speech.endsWith('…')?speech.slice(0,-1):speech
   expect(/[\p{L}\p{N}]/u.test(kept)).toBe(true)
   expect(speech===source||speech.endsWith('…')&&source.startsWith(kept)).toBe(true)
   expect((speech.match(/…/gu)??[]).length).toBeLessThanOrEqual(1)
  }
  const nativeWidth=nativeExtent(tree)
  expect({columns,nativeWidth,fits:nativeWidth<=columns}).toEqual({columns,nativeWidth,fits:true})
  await ui.unmount()
 }
})

for(const surface of ['vscode','mobile'] as const)test(`C3 ${surface} an ordinary prompt row stays whole when Marks are off`,async($,on)=>{
 const w=world(on,{store:{...RECENT,firstMet:MORNING,stamps:{met:MORNING},bandSettings:{marks:'off'}},surfaces:[surface],engineRows:true,readText:path=>path.endsWith('c3-text.json')?C3_WORDS_RAW:undefined})
 await $.session.start({...START,surface});await settleLegacyStart($,w)
 const ui=await $.ui.mount({surface,plugin:'coco',component:'UserMessage',requestId:'ordinary-row',props:{text:'An ordinary first request.',origin:PERSON},viewport:{columns:100,rows:48}})
 expect(JSON.stringify(await ui.drawn())).toContain('"type":"engine"')
 await ui.unmount()
})

test('C3 actual settings clear bookmarks and runs and disable subsequent safety scans, notes and budget storage',async($,on)=>{
 const f=fixture(on,{surface:'terminal',store:{bookmarks:{[START.cwd]:{where:'Continue parser',kind:'todo',at:MORNING-1}},runs:{old:[{ms:5000,outcome:'pass'}]},bandSettings:{budget:80}}});await begin($,f,'terminal')
 await $.command.run({command:'coco',args:'settings',origin:PERSON,presentation:P})
 const ui=await $.ui.mount({surface:'terminal',plugin:'coco',component:'Pane',requestId:'coco-book',props:{title:'Coco',isFocused:true,bodyColumns:80,placement:'dock',scroll:{offset:0,bodyRows:40},view:{}}})
 for(const key of ['bookmark','notes','guard'])await ui.press({key:'coco:set:'+key+':off'})
 expect(f.deleted).toContain('bookmarks');expect(f.deleted).toContain('runs')
 const before={lines:f.toasts.length,writes:f.writes.length,scans:f.scans.length};await $.tool.call({tool:'Bash',command:'git commit -m done'});await $.tool.call({tool:'Bash',command:'npm test'});await $.tool.call({tool:'TodoWrite',todos:[{status:'in_progress',content:'Do not save this',activeForm:'Working'}]});await $.turn.complete(complete())
 expect(f.scans.length).toBe(before.scans);expect(f.writes.slice(before.writes).some(x=>['bookmarks','runs'].includes(x.key))).toBe(false);await ui.unmount()
})

for(const surface of ['desktop','terminal'] as const)for(const reds of [1,3])test(`C3 ${surface} ${reds}-red celebration changes its visible direction at the approved smile boundary`,async($,on)=>{
 // SPEC 2.2; reference tools/g_tests.py105: smile direction begins at end_cheer+33; the absolute recovery end stays 3300/5500ms.
 const f=fixture(on,{surface,frames:true,namedFailure:false,store:{stamps:{met:MORNING,green:MORNING}}});await begin($,f,surface)
 const ui=await $.ui.mount({surface,...band(100,false)})
 f.outcome('fail');for(let i=0;i<reds;i++)await $.tool.call({tool:'Bash',command:'npm test'})
 f.outcome('pass');await $.tool.call({tool:'Bash',command:'npm test'});const at=f.w.clock.now(),smile=reds>=3?2933:1933,end=reds>=3?5500:3300
 // The desktop band names the picture it draws (f3293e02): the whole cheer is the «fixed» picture, so only the terminal shows the turn.
 const seen=(aside:string)=>surface==='desktop'?CORE_WORDS.en.drawn.fixed:aside
 await settleLegacyStart($,f.w);expect((f.w.view() as any).pose.aside).toBe(WORDS['aside.cheer'].en)
 expect(text(await ui.drawn())).toContain(seen(WORDS['aside.cheer'].en))
 await f.w.clock.advance(at+smile-1-f.w.clock.now());await settleLegacyStart($,f.w);expect((f.w.view() as any).pose.aside).toBe(WORDS['aside.cheer'].en)
 await f.w.clock.advance(1);await settleLegacyStart($,f.w);expect((f.w.view() as any).pose.aside).toBe(CORE_WORDS.en.aside.happy)
 expect(text(await ui.drawn())).toContain(seen(CORE_WORDS.en.aside.happy));expect(text(await ui.drawn())).not.toContain(WORDS['aside.cheer'].en)
 await f.w.clock.advance(at+end-1-f.w.clock.now());await settleLegacyStart($,f.w);expect((f.w.view() as any).pose.aside).toBe(CORE_WORDS.en.aside.happy)
 await f.w.clock.advance(1);await settleLegacyStart($,f.w);expect((f.w.view() as any).pose?.name).not.toBe('cheer')
 await ui.unmount()
})

for(const reds of [1,3])for(const initialReduced of [false,true])for(const phase of ['before','after'] as const)test(`C3 desktop ${reds}-red celebration toggles reduced motion ${initialReduced?'on to off':'off to on'} ${phase} its smile without changing its absolute end`,async($,on)=>{
 // SPEC 0.3 / 2.2: reduced motion keeps the first cheer frame; restoring motion uses the current smile phase and original recovery end.
 const settings:Record<string,unknown>={prefersReducedMotion:initialReduced}
 const f=fixture(on,{surface:'desktop',frames:true,namedFailure:false,settings,store:{stamps:{met:MORNING,green:MORNING}}});await begin($,f,'desktop')
 const ui=await $.ui.mount({surface:'desktop',...band(100,false)})
 f.outcome('fail');for(let i=0;i<reds;i++)await $.tool.call({tool:'Bash',command:'npm test'})
 f.outcome('pass');await $.tool.call({tool:'Bash',command:'npm test'});const at=f.w.clock.now(),smile=reds>=3?2933:1933,end=reds>=3?5500:3300
 const expected=(reduced:boolean,elapsed:number)=>reduced||elapsed<smile?WORDS['aside.cheer'].en:CORE_WORDS.en.aside.happy
 const assertPhase=async(reduced:boolean)=>{
  const pose=(f.w.view() as any).pose
  expect(pose?.name).toBe('cheer');expect(pose?.at).toBe(at);expect(pose?.celebration).toBe(reds)
  // the desktop band names the «fixed» picture for the whole cheer (f3293e02)
  expect(pose?.aside).toBe(expected(reduced,f.w.clock.now()-at));expect(text(await ui.drawn())).toContain(CORE_WORDS.en.drawn.fixed)
  if(reduced){const picture=await desktopPicture(ui);expect(String(picture?.props.source)).toContain('data-coco="A fixed"')}
 }
 await f.w.clock.advance(at+smile+(phase==='before'?-100:100)-f.w.clock.now());await settleLegacyStart($,f.w);await assertPhase(initialReduced)
 settings.prefersReducedMotion=!initialReduced;await $.config.set({key:'theme',value:'light'});await settleLegacyStart($,f.w);await assertPhase(!initialReduced)
 if(phase==='before'){await f.w.clock.advance(at+smile+1-f.w.clock.now());await settleLegacyStart($,f.w);await assertPhase(!initialReduced)}
 await f.w.clock.advance(at+end-1-f.w.clock.now());await settleLegacyStart($,f.w);await assertPhase(!initialReduced)
 await f.w.clock.advance(1);await settleLegacyStart($,f.w);expect((f.w.view() as any).pose?.name).not.toBe('cheer')
 await ui.unmount()
})
