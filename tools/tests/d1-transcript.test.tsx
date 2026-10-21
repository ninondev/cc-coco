// SPEC0.2:933 and SPEC0.3:548 bind helper directions to the reviewed source words.
import {fixtureStoreReader} from './d1-store-read-fixture'
import {test,expect} from 'claude-code/testing'
import type {On} from 'claude-code'
import {world,RECENT,MORNING,settleLegacyStart,SUMMARY} from './world'
import {C3_WORDS_RAW} from './c3-words-fixture'
import {D1_TRANSCRIPT_WORDS_RAW} from './d1-transcript-words-fixture'
import {WINDOWS_ROOTS} from './test-system'
import {planLine} from '../hooks/transcript'
import {presenceWorld,snapshot} from './presence-world'
const START={cwd:WINDOWS_ROOTS?'C:\\Users\\windows\\transcript-source':'/tmp/transcript-source',surface:'vscode' as const,isInteractive:true}
const SOURCE=JSON.parse(D1_TRANSCRIPT_WORDS_RAW),C3=JSON.parse(C3_WORDS_RAW)
const COLLISION=SOURCE['trim.marker'].en.other.replace('{n}','247').replace('{what}','successful test and build progress')
const FULL=Array.from({length:300},(_,i)=>i===259?COLLISION:'PASS suite-'+i).join('\n')+'\n',ERR='FAIL diagnostic remains'
const OK={exitCode:0,stdout:'',stderr:'',isStdoutTruncated:false,isStderrTruncated:false}
const nodes=(n:any,type:string):any[]=>!n||typeof n!=='object'?[]:[...(n.type===type?[n]:[]),...(n.children??[]).flatMap((c:any)=>nodes(c,type))]
const text=(n:any):string=>typeof n==='string'?n:Array.isArray(n)?n.map(text).join(''):n&&typeof n==='object'?text(n.children):''
const toolRow=(id:string,tool='Agent',extra:Record<string,unknown>={})=>({plugin:'coco',component:'ToolUse' as const,requestId:'native-'+id,props:{tool_use_id:id,tool,input:{},isRunning:false,isErrored:false,isInterrupted:false,...extra},viewport:{columns:120,rows:40}})
const scroll=(tree:any)=>nodes(tree,'Svg').filter(n=>n.props.width===9&&n.props.height===18&&n.props.alt==='')
const readText=(path:string)=>path.endsWith('d1-words.json')?D1_TRANSCRIPT_WORDS_RAW:path.endsWith('c3-text.json')?C3_WORDS_RAW:undefined
function trimFixture(on:On){
 let toolId='';const persisted:string[]=[],opened:string[]=[],copied:string[]=[]
 on('tool.call',{tool:'Bash'},($,e)=>{toolId=e.tool_use_id;return {ref:178,result:{stdout:FULL,stderr:ERR,interrupted:false},text:FULL+ERR}})
 on('ui.copy',($,e)=>{copied.push(e.text);return {value:{isCopied:true}}})
 on('process.run',($,e)=>{
  if(e.argv[1]?.endsWith('d1-trim-worker.mjs')){const r=JSON.parse(e.init?.stdin??'{}');if(r.op==='write')persisted.push(r.text);return {value:{...OK,stdout:JSON.stringify({ok:true,path:r.root+'/logs/abcd/1234-bun.log'})}}}
  if(e.argv[1]?.endsWith('algo-worker.mjs')){const r=JSON.parse(e.init?.stdin??'{}'),result=r.op==='recognize'?{kind:'test',tool:'bun',key:'bun test'}:r.op==='finish'?{parsed:{outcome:'fail'},slowness:{slow:false},history:{}}:null;return {value:{...OK,stdout:JSON.stringify({ok:true,result})}}}
  if(['xdg-open','open','cmd'].includes(e.argv[0]??''))opened.push(e.argv.at(-1)!);return {value:OK}
 })
 on('fs.exists',{path:'/System/Library/CoreServices/SystemVersion.plist'},()=>({value:false}))
 const w=world(on,{engineRows:true,sessionRoot:START.cwd,surfaces:['vscode'],store:{...RECENT,marks:'off',bandSettings:{trim:true,marks:'off'}},env:{HOME:'/tmp/d1-transcript-home',LANG:'en_US.UTF-8',TERM:'xterm-256color'},readText})
 return {w,persisted,opened,copied,id:()=>toolId}
}


import {TurnLedger,headEntry,headKey} from '../hooks/turn-ledger'
import {D1Runtime} from '../hooks/d1-runtime'
import {configureD1Transcript} from '../hooks/transcript'
import {loadD1Words,d1Word} from '../hooks/d1-words'
const completed={turnId:'t',answer:'done',reason:'answer' as const,durationMs:1500,isAborted:false}
const reply=(id:string)=>({plugin:'coco',component:'AssistantMessage' as const,requestId:id,props:{text:'native reply',isFirstOfReply:true},viewport:{columns:120,rows:40}})
const row=toolRow
async function words(){await loadD1Words(()=>Promise.resolve(D1_TRANSCRIPT_WORDS_RAW))}
test('D1 ledger freezes ribbon and folder when head is first requested and keeps them through settlement and restore',()=>{
 const ledger=new TurnLedger();ledger.start('t',MORNING);ledger.arm('t');const snapshot={ribbon:4,folder:'private-project'}
 const first=(ledger.request as any)('h','work',snapshot);expect(first.ribbon).toBe(4);expect(first.folder).toBe('private-project');snapshot.ribbon=7;snapshot.folder='next-project'
 expect((ledger.request as any)('h','work',snapshot).ribbon).toBe(4);const settled=ledger.settle(completed,MORNING+1500)!;expect(settled.head.ribbon).toBe(4)
 const restored=new TurnLedger();restored.restore(ledger.entries,MORNING);expect(restored.heads.get('h')?.ribbon).toBe(4);expect(restored.heads.get('h')?.folder).toBe('private-project')
})
test('D1 ledger accepts legacy tuples and rejects invalid ribbon tuples without inventing a later ribbon',()=>{
 expect(headEntry(['old','happy',MORNING,1000])).toBeDefined();expect(headEntry(['new','happy',MORNING,1000,2,'folder'])).toBeDefined()
 for(const bad of [0,15,1.5,'2'])expect(headEntry(['bad','happy',MORNING,1000,bad,'folder'])).toBeUndefined()
 const ledger=new TurnLedger();ledger.start('t',MORNING);ledger.arm('t');ledger.request('alone','work');expect((ledger.request as any)('alone','work',{ribbon:5,folder:'later'}).ribbon).toBeUndefined()
})
test('D1 transcript frozen head ribbon and folder hover survive a later directory or session-count change',async($,on)=>{
 on('classic.CwdChanged',()=>({}));const key=headKey(MORNING,'session','head'),w=world(on,{engineRows:true,sessionId:'session',store:{...RECENT,[key]:['head','happy',MORNING,1500,3,'first-folder']}})
 await $.session.start(START);await settleLegacyStart($,w);await words();await $.classic.CwdChanged({old_cwd:START.cwd,new_cwd:'/tmp/later-folder'})
 const ui=await $.ui.mount({surface:'vscode',...reply('head')});let tree=await ui.drawn();expect(nodes(tree,'Svg').some(n=>n.props.width===8&&n.props.height===28&&n.props.alt===d1Word('en','ribbon.alt',{folder:'first-folder'}))).toBe(true)
 const hover=nodes(tree,'Box').filter(n=>n.props.display==='none');expect(hover.map(text).join('')).toContain('first-folder');expect(text(tree)).not.toContain('later-folder')
 await $.classic.CwdChanged({old_cwd:'/tmp/later-folder',new_cwd:'/tmp/third-folder'});await ui.redraw();tree=await ui.drawn();expect(nodes(tree,'Svg').some(n=>n.props.alt===d1Word('en','ribbon.alt',{folder:'first-folder'}))).toBe(true);await ui.unmount()
})
test('D1 helper completed rows add one silent scroll behind marks and retain the entire host row',async($,on)=>{
 let call='';on('agent.spawn',($,e)=>{call=e.tool_use_id;return {agentId:'native-completed-helper',model:'fixture'}})
 const w=world(on,{engineRows:true,surfaces:['vscode'],store:RECENT,readText});await $.session.start(START);await settleLegacyStart($,w);await $.turn.start({turnId:'native-helper-main',text:'work'});await $.agent.spawn({prompt:'fixture',description:'fixture helper',subagentType:'general-purpose'})
 const notice=await $.ui.mount({surface:'vscode',plugin:'coco',component:'UserMessage',requestId:'native-finish',props:{text:'native completion',origin:{kind:'task-notification'},task:{id:'native-completed-helper',status:'completed',toolUseId:call}},viewport:{columns:120,rows:40}});await notice.drawn();await notice.unmount();await w.clock.advance(0)
 const ui=await $.ui.mount({surface:'vscode',...toolRow(call)}),tree=await ui.drawn();expect(scroll(tree).length).toBe(1);expect(nodes(tree,'engine').length).toBe(1)
 for(const props of [{isRunning:true},{isErrored:true},{isInterrupted:true}]){const veto=await $.ui.mount({surface:'vscode',...toolRow(call,'Agent',props),requestId:'native-veto-'+Object.keys(props)[0]});expect(scroll(await veto.drawn()).length).toBe(0);await veto.unmount()}await ui.unmount()
})

test('D1 compact rows use shed words and icon with one frozen first-ever line', {options:{band:'off'}},async($,on)=>{
 const readStored=fixtureStoreReader(on)
 const w=world(on,{engineRows:true,surfaces:['vscode'],store:{...RECENT,band:'off'},readText});await $.session.start(START);await settleLegacyStart($,w);await $.session.compact({trigger:'manual',messages:[SUMMARY]})
 const props={command:'compact',args:'',text:'native compact',isErrored:false},ui=await $.ui.mount({surface:'vscode',plugin:'coco',component:'CommandOutput',requestId:'native-first-compact',props,viewport:{columns:120,rows:40}}),first=await ui.drawn()
 expect(text(first)).toContain(SOURCE['marks.shed'].en.replace(/\*/g,''));expect(text(first)).toContain(SOURCE['shed.first'].en);expect(nodes(first,'engine').length).toBe(1);expect(nodes(first,'Svg').some(n=>n.props.width===26&&n.props.height===15&&n.props.alt==='')).toBe(true)
 await ui.redraw();expect(text(await ui.drawn())).toContain(SOURCE['shed.first'].en);await w.clock.advance(0);expect((await readStored($,'occasions') as any)?.shedFirst).toBe(true);
 await $.session.compact({trigger:'manual',messages:[SUMMARY]});await ui.redraw();expect(text(await ui.drawn())).toContain(SOURCE['shed.first'].en);await ui.unmount();const later=await $.ui.mount({surface:'mobile',plugin:'coco',component:'CommandOutput',requestId:'native-later-compact',props,viewport:{columns:120,rows:40}});expect(text(await later.drawn())).toContain(SOURCE['marks.shed'].en.replace(/\*/g,''));expect(text(await later.drawn())).not.toContain(SOURCE['shed.first'].en);await later.unmount()
})

test('D1 trimmed failed ToolUse keeps native row and full-log control even with marks Off',async($,on)=>{
 const f=trimFixture(on);await $.session.start(START);await settleLegacyStart($,f.w);await $.turn.start({turnId:'native-trim',text:'run tests'})
 const result=await $.tool.call({tool:'Bash',command:'bun test'}),output=result.result as {stdout:string;stderr:string};expect(result.ref).toBeUndefined();expect(f.persisted).toEqual([FULL+ERR])
 for(const surface of ['desktop','vscode','mobile','terminal'] as const){
  const ui=await $.ui.mount({surface,...toolRow(f.id(),'Bash',{isErrored:true})}),tree=await ui.drawn()
  expect(nodes(tree,'engine').length).toBe(1);expect(text(tree)).toContain(SOURCE['trim.kept'].en.replace('{kept}','54').replace('{total}','301'))
  if(surface==='mobile'){expect(nodes(tree,'Button').length).toBe(0);expect(text(tree)).toContain('/logs/abcd/1234-bun.log')}
  else{const action=surface==='terminal'?'copy':'open';expect(nodes(tree,'Button').some(n=>n.props.key==='coco:trim:'+action+':'+f.id())).toBe(true);await ui.press({key:'coco:trim:'+action+':'+f.id()})}await ui.unmount()
 }
 expect(f.opened.length).toBe(2);expect(f.copied.length).toBe(1)
})
test('D1 ToolResult shows exactly the model text and styles only known inserted markers inactive',async($,on)=>{
 const f=trimFixture(on);await $.session.start(START);await settleLegacyStart($,f.w);await $.turn.start({turnId:'native-trim',text:'run tests'})
 const result=await $.tool.call({tool:'Bash',command:'bun test'}),output=result.result as {stdout:string;stderr:string};expect(result.ref).toBeUndefined();expect(f.persisted).toEqual([FULL+ERR])
 for(const surface of ['desktop','vscode','mobile','terminal'] as const){
  const body=await $.ui.mount({surface,plugin:'coco',component:'ToolResult',requestId:'body-'+surface,props:{tool_use_id:f.id(),tool:'Bash',output,isErrored:false},viewport:{columns:120,rows:40}}),drawn=await body.drawn()
  expect(text(drawn)).toBe(result.text);expect(text(drawn).split(COLLISION).length-1).toBe(2);expect(nodes(drawn,'Text').filter(n=>n.props.color==='inactive'&&text(n).includes(COLLISION)).length).toBe(1);expect(nodes(drawn,'Text').some(n=>n.props.color==='inactive'&&text(n).includes('FAIL'))).toBe(false);await body.unmount()
 }
})
test('D1 folded completed helpers recover native scrolls after detailed metadata exceeds 64 and freeze background notifications',async($,on)=>{
 const w=world(on,{engineRows:true,store:RECENT,readText})
 const actualCalls=new Map<string,string>();let actualSpawns=0
 on('agent.spawn',($,e)=>{actualSpawns++;actualCalls.set(e.description,e.tool_use_id);return {agentId:e.description,model:'fixture'}})
 on('session.end',($,e)=>({sessionId:e.sessionId}))
 let heldList:Promise<any[]>|undefined,enteredList:(()=>void)|undefined
 const engineAgents=[{id:'engine-completed',description:'fixture',type:'general-purpose',status:'completed'},{id:'engine-running',description:'fixture',type:'general-purpose',status:'running'}]
 on('agent.list',async()=>{if(heldList)enteredList?.();return {value:heldList?await heldList:engineAgents}});await $.session.start(START);await settleLegacyStart($,w);await words()
 const runtime=new D1Runtime();runtime.spawn('old-sync','one','general',0);runtime.finish('old-sync',1);runtime.spawn('old-background','two','general',2);runtime.finish('old-background',3)
 for(let i=0;i<65;i++){runtime.spawn('new-'+i,'one','general',10+i);runtime.finish('new-'+i,100+i)}
 expect(runtime.snapshot().helpers.length).toBe(64);expect(runtime.snapshot().helpers.some(h=>h.agentId==='old-sync'||h.agentId==='old-background')).toBe(false)
 await $.turn.start({turnId:'shipping-fold-main',text:'fixture work'})
 for(const agent of ['old-sync','old-background',...Array.from({length:65},(_,i)=>'new-'+i)]){await $.agent.spawn({prompt:'fixture',description:agent,subagentType:'general-purpose'});const notice=await $.ui.mount({surface:'vscode',plugin:'coco',component:'UserMessage',requestId:'fold-completed-'+agent,props:{text:'native completion',origin:{kind:'task-notification'},task:{id:agent,status:'completed',toolUseId:actualCalls.get(agent)!}},viewport:{columns:120,rows:40}});await notice.drawn();await notice.unmount();await w.clock.advance(0)}
 expect(actualSpawns).toBe(67);expect(actualCalls.size).toBe(67)
 for(const tool of ['Agent','Task']){const genuinelyFolded=await $.ui.mount({surface:'vscode',...row(actualCalls.get('old-sync')!,tool,{output:{status:'completed'}})});expect(nodes(await genuinelyFolded.drawn(),'Svg').some(n=>n.props.width===9&&n.props.height===18&&n.props.alt==='')).toBe(true);expect(nodes(await genuinelyFolded.drawn(),'engine').length).toBe(1);await genuinelyFolded.unmount()}
 const sync=await $.ui.mount({surface:'vscode',...row('old-sync','Agent',{output:{status:'completed'}})});expect(nodes(await sync.drawn(),'Svg').some(n=>n.props.width===9&&n.props.height===18&&n.props.alt==='')).toBe(true);await sync.unmount()
 const notification=await $.ui.mount({surface:'vscode',plugin:'coco',component:'UserMessage',requestId:'old-completion',props:{text:'native task completion',origin:{kind:'task-notification'},task:{id:'old-background',status:'completed',toolUseId:'background-call'}},viewport:{columns:120,rows:40}});await notification.drawn();await notification.unmount()
 const background=await $.ui.mount({surface:'vscode',...row('background-call','Agent',{output:{status:'async_launched',agentId:'old-background'}})});expect(nodes(await background.drawn(),'Svg').some(n=>n.props.width===9&&n.props.height===18&&n.props.alt==='')).toBe(true)
 const remoteNotice=await $.ui.mount({surface:'vscode',plugin:'coco',component:'UserMessage',requestId:'old-remote-completion',props:{text:'native remote completion',origin:{kind:'task-notification'},task:{id:'old-remote',status:'completed',type:'remote_agent'}},viewport:{columns:120,rows:40}});await remoteNotice.drawn();await remoteNotice.unmount()
 const remote=await $.ui.mount({surface:'vscode',...row('remote-call','Agent',{output:{status:'remote_launched',taskId:'old-remote'}})});expect(nodes(await remote.drawn(),'Svg').some(n=>n.props.width===9&&n.props.height===18&&n.props.alt==='')).toBe(true);await remote.unmount()
 const recovered=await $.ui.mount({surface:'vscode',...row('engine-call','Agent',{output:{status:'async_launched',agentId:'engine-completed'}})});expect(nodes(await recovered.drawn(),'Svg').some(n=>n.props.width===9&&n.props.height===18&&n.props.alt==='')).toBe(true);await recovered.unmount()
 const running=await $.ui.mount({surface:'vscode',...row('engine-running-call','Agent',{output:{status:'async_launched',agentId:'engine-running'}})});expect(nodes(await running.drawn(),'Svg').some(n=>n.props.width===9&&n.props.height===18&&n.props.alt==='')).toBe(false);await running.unmount()
 runtime.clear();await background.redraw();expect(nodes(await background.drawn(),'Svg').some(n=>n.props.width===9&&n.props.height===18&&n.props.alt==='')).toBe(true);await background.unmount()
 for(const state of [{isRunning:true},{isErrored:true},{isInterrupted:true}]){const failed=await $.ui.mount({surface:'vscode',...row('background-call','Agent',{output:{status:'async_launched',agentId:'old-background'},...state})});expect(nodes(await failed.drawn(),'Svg').some(n=>n.props.width===9&&n.props.height===18&&n.props.alt==='')).toBe(false);await failed.unmount()}
 const commandNotice=await $.ui.mount({surface:'vscode',plugin:'coco',component:'UserMessage',requestId:'completion-command-clear',props:{text:'native completion',origin:{kind:'task-notification'},task:{id:'old-background',status:'completed',toolUseId:'background-call'}},viewport:{columns:120,rows:40}});await commandNotice.drawn();await commandNotice.unmount();const commandRemembered=await $.ui.mount({surface:'vscode',...row('background-call','Agent',{output:{status:'async_launched',agentId:'old-background'}})});expect(nodes(await commandRemembered.drawn(),'Svg').some(n=>n.props.width===9&&n.props.height===18&&n.props.alt==='')).toBe(true);await $.command.run({command:'clear',args:''});await commandRemembered.redraw();expect(nodes(await commandRemembered.drawn(),'Svg').some(n=>n.props.width===9&&n.props.height===18&&n.props.alt==='')).toBe(false);await commandRemembered.unmount();const commandNative=await $.ui.mount({surface:'vscode',...row('sync-command-clear','Agent',{output:{status:'completed'}})});expect(nodes(await commandNative.drawn(),'Svg').some(n=>n.props.width===9&&n.props.height===18&&n.props.alt==='')).toBe(true);await commandNative.unmount()
 for(const reason of ['clear','resume'] as const){const notice=await $.ui.mount({surface:'vscode',plugin:'coco',component:'UserMessage',requestId:'completion-'+reason,props:{text:'native completion',origin:{kind:'task-notification'},task:{id:'old-background',status:'completed',toolUseId:'background-call'}},viewport:{columns:120,rows:40}});await notice.drawn();await notice.unmount();const remembered=await $.ui.mount({surface:'vscode',...row('background-call','Agent',{output:{status:'async_launched',agentId:'old-background'}})});expect(nodes(await remembered.drawn(),'Svg').some(n=>n.props.width===9&&n.props.height===18&&n.props.alt==='')).toBe(true);await $.session.end({reason,sessionId:'session',resume:{id:'session'}});await remembered.redraw();expect(nodes(await remembered.drawn(),'Svg').some(n=>n.props.width===9&&n.props.height===18&&n.props.alt==='')).toBe(false);await remembered.unmount();const nativeAfter=await $.ui.mount({surface:'vscode',...row('sync-'+reason,'Agent',{output:{status:'completed'}})});expect(nodes(await nativeAfter.drawn(),'Svg').some(n=>n.props.width===9&&n.props.height===18&&n.props.alt==='')).toBe(true);await nativeAfter.unmount()}
 let releaseList!:(agents:any[])=>void,queried=false;const listEntered=new Promise<void>(resolve=>{enteredList=()=>{queried=true;resolve()}});heldList=new Promise(resolve=>{releaseList=resolve})
 const pendingMount=$.ui.mount({surface:'vscode',...row('racing-call','Agent',{output:{status:'async_launched',agentId:'racing-agent'}})}),pendingDraw=pendingMount.then(async ui=>({ui,tree:await ui.drawn()}));await Promise.race([listEntered,pendingDraw]);expect(queried).toBe(true);await $.command.run({command:'clear',args:''});releaseList([{id:'racing-agent',description:'fixture',type:'general-purpose',status:'completed'}]);const raced=await pendingDraw;expect(nodes(raced.tree,'Svg').some(n=>n.props.width===9&&n.props.height===18&&n.props.alt==='')).toBe(false);heldList=undefined;enteredList=undefined;await raced.ui.redraw();expect(nodes(await raced.ui.drawn(),'Svg').some(n=>n.props.width===9&&n.props.height===18&&n.props.alt==='')).toBe(false);await raced.ui.unmount()
})

test('D1 completed helper cache cannot draw across clear during a held host render while native completion stays authoritative',async($,on)=>{
 let completed=true,heldHost:Promise<void>|undefined,enteredHost:(()=>void)|undefined,call='',agent=0
 on('agent.spawn',($,e)=>{call=e.tool_use_id;return {agentId:'cached-agent-'+(++agent),model:'fixture'}})
 on('ui.render',{component:'ToolUse'},async($,e)=>{enteredHost?.();await heldHost;return {type:'engine',ref:0} as never});
 const w=world(on,{engineRows:true,store:RECENT,readText:path=>path.endsWith('d1-words.json')?D1_TRANSCRIPT_WORDS_RAW:path.endsWith('c3-text.json')?C3_WORDS_RAW:undefined})
 await $.session.start(START);await settleLegacyStart($,w)
 for(const native of [false,true]){
  await $.turn.start({turnId:'host-main-'+agent,text:'fixture work'});await $.agent.spawn({prompt:'fixture',description:'fixture helper',subagentType:'general-purpose'})
  const notice=await $.ui.mount({surface:'vscode',plugin:'coco',component:'UserMessage',requestId:'host-complete-'+agent,props:{text:'native completion',origin:{kind:'task-notification'},task:{id:'cached-agent-'+agent,status:'completed',toolUseId:call}},viewport:{columns:120,rows:40}});await notice.drawn();await notice.unmount();await w.clock.advance(0)
  let release!:()=>void,entered=false;const began=new Promise<void>(resolve=>{enteredHost=()=>{entered=true;resolve()}});heldHost=new Promise(resolve=>{release=resolve});completed=true
  const id=call,pendingMount=$.ui.mount({surface:'vscode',...row(id,'Agent',{output:native?{status:'completed'}:{status:'async_launched',agentId:'cached-agent-'+agent}})}),pendingDraw=pendingMount.then(async ui=>({ui,tree:await ui.drawn()}))
  await Promise.race([began,pendingDraw]);expect(entered).toBe(true);await $.command.run({command:'clear',args:''});completed=false;release();const drawn=await pendingDraw
  expect(nodes(drawn.tree,'engine').length).toBe(1);expect(nodes(drawn.tree,'Svg').some(n=>n.props.width===9&&n.props.height===18&&n.props.alt==='')).toBe(native)
  heldHost=undefined;enteredHost=undefined;await drawn.ui.redraw();expect(nodes(await drawn.ui.drawn(),'Svg').some(n=>n.props.width===9&&n.props.height===18&&n.props.alt==='')).toBe(native);await drawn.ui.unmount()
 }
})

test('D1 transcript strips approved stage markers at frozen head and compact render boundaries while preserving source words',async($,on)=>{
 for(const lang of ['ja','hi','id','ko']){const original=C3['aside.helper'][lang];expect(original).not.toContain('*');expect(planLine('*'+original+'*',35,lang,200,'vscode')).toBe(original);expect(planLine(original,35,lang,200,'vscode')).toBe(original);expect(C3['aside.helper'][lang]).toBe(original)}
 on('agent.spawn',()=>({agentId:'native-stage-helper',model:'fixture'}));on('classic.CwdChanged',()=>({}))
 on('turn.step',{turnId:'native-stage-main'},async function*($,e){yield {kind:'text',index:0,text:'native main reply'};return {turnId:e.turnId,index:e.index,answer:'native main reply',toolUses:[],stopReason:'end_turn',usage:null}})
 on('ui.render',{component:'AssistantMessage'},()=>({type:'engine',ref:0} as never));on('ui.render',{component:'CommandOutput'},()=>({type:'engine',ref:0} as never))
 const presence=WINDOWS_ROOTS?undefined:presenceWorld(on,snapshot(),{withNativePresence:true,store:{...RECENT,lang:'ja'},readText})
 const w=presence??world(on,{engineRows:true,surfaces:['vscode'],sessionRoot:START.cwd,store:{...RECENT,lang:'ja'},stepText:'native main reply',readText})
 if(presence)expect(presence.insertSession('existing-stage-window',{cwd:'/tmp/existing-stage-window',ribbon:2,ribbonAt:MORNING-1000},MORNING)).toBe(false)
 await $.session.start({...START,cwd:presence?'/tmp/presence-project':START.cwd,surface:presence?'desktop':'vscode'});await $.command.run({command:'coco',args:'lang ja'});await w.clock.advance(0);for(let i=0;i<80;i++)await $.command.run({command:'d1-presence-source-boundary',args:''});await w.clock.advance(0);for(let i=0;i<80;i++)await $.command.run({command:'d1-presence-source-boundary',args:''});if(presence){expect(w.view().ribbon?.visible).toBe(true);expect(w.view().ribbon?.folder).toBe('presence-project');await $.classic.CwdChanged({old_cwd:'/tmp/presence-project',new_cwd:START.cwd});expect(w.view().ribbon?.folder).toBe('transcript-source')}
 await $.turn.start({turnId:'native-stage-main',text:'work'});await $.agent.spawn({prompt:'fixture',description:'fixture helper',subagentType:'general-purpose'});for await(const _ of $.turn.step({turnId:'native-stage-main',index:0,model:'fixture',messageCount:1})){}
 const ui=await $.ui.mount({surface:'vscode',plugin:'coco',component:'AssistantMessage',requestId:'native-stage-head',props:{text:'native reply',isFirstOfReply:true},viewport:{columns:120,rows:40}}),tree=await ui.drawn();expect(C3['aside.helper'].ja).not.toContain('*');expect(text(tree)).toContain(C3['aside.helper'].ja.replace(/\*/g,''));expect(text(tree)).not.toContain('*');if(presence){expect(text(tree)).toContain('transcript-source');expect(nodes(tree,'Svg').some(n=>n.props.width===8&&n.props.height===28&&n.props.alt===SOURCE['ribbon.alt'].ja.replace('{folder}','transcript-source'))).toBe(true)}
 await $.classic.CwdChanged({old_cwd:START.cwd,new_cwd:WINDOWS_ROOTS?'C:\\Users\\windows\\later-folder':'/tmp/later-folder'});await ui.redraw();if(presence)expect(text(await ui.drawn())).toContain('transcript-source');expect(text(await ui.drawn())).not.toContain('later-folder');await $.turn.complete({turnId:'native-stage-main',answer:'done',reason:'answer',durationMs:1500,isAborted:false});await ui.redraw();expect(text(await ui.drawn())).not.toContain('*');await ui.unmount();const compact=await $.ui.mount({surface:'mobile',plugin:'coco',component:'CommandOutput',requestId:'native-ja-compact',props:{command:'compact',args:'',text:'native compact',isErrored:false},viewport:{columns:120,rows:40}});expect(text(await compact.drawn())).toContain(SOURCE['marks.shed'].ja.replace(/\*/g,''));expect(text(await compact.drawn())).not.toContain('*');await compact.unmount();expect(JSON.stringify(C3)).toBe(JSON.stringify(JSON.parse(C3_WORDS_RAW)))
})
