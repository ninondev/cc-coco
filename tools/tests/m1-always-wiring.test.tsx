import { installM1Words } from './m1-more-data-fixture'
import { installModelServiceFixture } from './m1-model-service-fixture'
import {expect,test} from 'claude-code/testing'
import type {On,UiMessageArgument} from 'claude-code'
import touchClient,{TouchPath,dispatchTouchMessage} from '../hooks/touch-client'
import playClient from '../hooks/play-client'
import {wordCount} from '../hooks/m1-always'
import {moreWord,moreFill} from '../hooks/more-words'
import {world,settleLegacyStart,RECENT,MORNING,P,PERSON,band as bandRow} from './world'
import {C3_WORDS_RAW} from './c3-words-fixture'
import {C3_HEAD_MANIFEST} from './c3-head-assets'
import {PLUGIN_SOURCES} from './plugin-sources'


installM1Words()
installModelServiceFixture()

const START={cwd:'/tmp/m1-wiring',surface:'terminal' as const,isInteractive:true}
function fixture(on:On,notes=false,options:{store?:Record<string,unknown>;settings?:Record<string,unknown>;env?:Record<string,string>;messages?:unknown[];process?:(event:any)=>unknown}={}){
 on('fs.exists',{path:'/System/Library/CoreServices/SystemVersion.plist'},()=>({value:true}))
 on('fs.exists',{path:/[\\/]bin[\\/]coco-state(?:-macos-(?:x86_64|aarch64)|-linux-(?:x86_64|aarch64)|-windows-(?:x86_64|aarch64)\.exe)?$/},()=>({value:true}))
 const w=world(on,{store:{...RECENT,firstMet:MORNING,bandSettings:{voice:'off',voiceChosen:true,notes},...options.store},settings:options.settings,env:options.env,readText:path=>path.endsWith('c3-text.json')?C3_WORDS_RAW:path.endsWith('frame-manifest.json')?JSON.stringify(C3_HEAD_MANIFEST):undefined})
 on('agent.list',()=>({value:[]}));on('session.messages',()=>({value:options.messages??[]} as never));on('session.model',()=>({value:'fixture-model'}));on('session.repo',()=>({value:null}));on('session.turns',()=>({value:1}));on('fs.write',()=>({value:undefined}));on('process.run',($,e)=>options.process?options.process(e) as never:({value:{exitCode:0,stdout:'{}',stderr:'',isStdoutTruncated:false,isStderrTruncated:false}}))
 return w
}
async function start($:any,w:any){await $.session.start(START);await settleLegacyStart($,w)}

test('M1 A25 actual compaction keeps only the summary size until clear; the text is never stored and rules make no log',async($,on)=>{
 const logs:string[]=[],writes:unknown[]=[]
 on('classic.PostCompact',()=>({}));on('classic.InstructionsLoaded',()=>({}))
 on('ui.log',($,e)=>{logs.push(e.text);return {value:undefined}})
 on('store.*',($,e,next)=>{if(next.is('store.set',e))writes.push(e.value);return next(e)})
 const w=fixture(on)
 await start($,w)
 const summary='Exact local summary, kept private.\nSecond line with 42 and `code` 栞と本.'
 await $.classic.PostCompact({trigger:'manual',compact_summary:summary})
 expect(JSON.stringify(writes).includes('kept private')).toBe(false)
 await $.classic.InstructionsLoaded({file_path:START.cwd+'/nested/AGENTS.md',load_reason:'nested_traversal',memory_type:'Project'})
 expect(logs).toEqual([])
 await $.command.run({command:'coco',args:'him',origin:PERSON,presentation:P})
 const pane=await $.ui.mount({surface:'terminal',plugin:'coco',component:'Pane',requestId:'coco-book',props:{title:'Coco',isFocused:false,bodyColumns:100,placement:'dock',scroll:{offset:0,bodyRows:100},view:{}},viewport:{columns:100,rows:100}})
 await w.clock.advance(0);await pane.redraw()
 expect(wordCount(summary)).toBe(15);expect(wordCount('保留了摘要')).toBe(5);expect(wordCount(undefined)).toBe(0)
 const size=moreFill(moreWord('shed.summary','en'),{n:15})
 expect(await pane.find({type:'Text',text:size})).toBeDefined();expect(await pane.find({type:'Text',text:summary})).toBeUndefined()
 expect(await pane.find({type:'Button',key:'coco:summary:read'})).toBeUndefined()
 await $.command.run({command:'clear',args:'',origin:PERSON,presentation:P});await w.clock.advance(0);await pane.redraw()
 expect(await pane.find({type:'Text',text:size})).toBeUndefined();await pane.unmount()
})

test('M1 A9 actual elicitation and permission events show waits and denied permission adds no line',async($,on)=>{
 const w=fixture(on)
 for(const event of ['classic.Elicitation','classic.ElicitationResult','classic.PermissionRequest','classic.PermissionDenied'] as const)on(event,()=>({}))
 await start($,w)
 await $.turn.start({turnId:'waiting-events',text:'read the file'})
 await $.classic.Elicitation({mcp_server_name:'fixture',message:'Fixture question.'})
 expect(w.view().mood).toBe('waiting')
 await $.classic.ElicitationResult({mcp_server_name:'fixture',action:'accept'})
 expect(w.view().mood==='waiting').toBe(false)
 await $.classic.PermissionRequest({tool_name:'Read',tool_input:{file_path:START.cwd+'/file.ts'}})
 expect(w.view().mood).toBe('waiting')
 const before=w.view().line
 await $.classic.PermissionDenied({tool_name:'Read',tool_input:{file_path:START.cwd+'/file.ts'},tool_use_id:'fixture-denied',reason:'Controlled refusal.'})
 expect(w.view().mood).toBe('refuse');expect(w.view().line).toEqual(before)
})

// Since the pixel version (DECISIONS 917) her resting loop moves the band itself, frame by frame (o10-lively.test.tsx
// has Off): the old two-second Lively owner never starts, and moving her writes nothing to the view.
test('M1 O10 actual Lively moves her pixel loop without the two-second owner or view writes',async($,on)=>{
 let everyStarts=0,viewWrites=0
 on('clock.*',($,e,next)=>{if(next.is('clock.every',e))everyStarts++;return next(e)})
 on('state.set',{key:'view'},($,e,next)=>{viewWrites++;return next(e)})
 const w=fixture(on,false,{store:{more:{lively:true}}})
 await start($,w)
 const ui=await $.ui.mount({surface:'terminal',...bandRow(100)})
 await ui.drawn()
 await w.clock.advance(60000);await settleLegacyStart($,w)
 const before=viewWrites,faces=new Set<string>()
 for(let t=0;t<8000;t+=50){await w.clock.advance(50);faces.add((await ui.find({type:'Raster',key:'sprite'}))?.props.cells)}
 expect(faces.size).toBeGreaterThan(1);expect(everyStarts).toBe(0);expect(viewWrites).toBe(before)
 await ui.unmount()
})

test('M1 A2 pointer reducer emits poke and pat with at most two posts per second',()=>{
 const path=new TouchPath(),posts:{at:number;kind:string}[]=[]
 const point=(type:'down'|'up'|'move',x:number,at:number)=>{const kind=path.pointer({type,x,y:0,button:'left'},at);if(kind)posts.push({at,kind})}
 point('down',0,0);point('up',0,50)
 point('move',0,100);point('move',6,150)
 expect(posts).toEqual([{at:50,kind:'poke'}])
 point('move',12,650)
 expect(posts).toEqual([{at:50,kind:'poke'},{at:650,kind:'pat'}])
 for(let at=700;at<4000;at+=50){point('down',0,at);point('up',0,at+1)}
 for(const post of posts)expect(posts.filter(row=>row.at>=post.at&&row.at<post.at+1000).length).toBeLessThanOrEqual(2)
})

test('M1 A2 the one pointer client pokes on a still press and never pats while dragging',()=>{
 let pointer:(e:any)=>void=()=>{};const posts:unknown[]=[]
 const surface:any={state:undefined,columns:35,rows:9,elements:{Box:()=>({type:'Box'})},onPointer:(fn:(e:any)=>void)=>{pointer=fn},setState:(state:unknown)=>{surface.state=state},post:(data:unknown)=>{posts.push(data)}}
 playClient({enabled:true},surface)
 pointer({type:'down',x:10,y:1,button:'left'});pointer({type:'up',x:10,y:1,button:'left'})
 expect(posts).toEqual([{t:'poke'}])
 posts.length=0
 pointer({type:'down',x:10,y:1,button:'left'});for(const x of [12,14,16,18,20])pointer({type:'move',x,y:1,button:'left'});pointer({type:'up',x:20,y:1,button:'left'})
 expect(posts.some((post:any)=>post.t==='pat'||post.t==='poke')).toBe(false)
 expect(posts.some((post:any)=>post.t==='drop')).toBe(true)
})

test('M1 A2 client installs one pointer listener and no idle timer',()=>{
 let listens=0,timers=0,posts=0
 const surface:any={state:undefined,elements:{Box:()=>({type:'Box'})},onPointer:()=>{listens++},setState:(state:unknown)=>{surface.state=state},post:()=>{posts++},every:()=>{timers++}}
 touchClient({enabled:false},surface);expect(listens).toBe(0)
 touchClient({enabled:true},surface);touchClient({enabled:true},surface)
 expect({listens,timers,posts}).toEqual({listens:1,timers:0,posts:0})
 // A declared State may exist before its installation flag has been set.
 let notInstalledListens=0,notInstalledTimers=0,notInstalledPosts=0
 const notInstalledSurface:any={state:{installed:false},elements:{Box:()=>({type:'Box'})},onPointer:()=>{notInstalledListens++},setState:(state:unknown)=>{notInstalledSurface.state=state},post:()=>{notInstalledPosts++},every:()=>{notInstalledTimers++}}
 touchClient({enabled:false},notInstalledSurface);expect(notInstalledListens).toBe(0)
 expect(notInstalledSurface.state).toEqual({installed:false})
 touchClient({enabled:true},notInstalledSurface);touchClient({enabled:true},notInstalledSurface)
 expect(notInstalledSurface.state).toEqual({installed:true})
 expect({listens:notInstalledListens,timers:notInstalledTimers,posts:notInstalledPosts}).toEqual({listens:1,timers:0,posts:0})
})


// her pixel version (DECISIONS 917) is 24 cells wide, as half blocks and as kitty's picture alike
for(const [pictures,term,kind,columns] of [['cells','xterm-256color','Raster',24],['kitty','xterm-kitty','Image',24]] as const)test(`M1 A2 actual terminal ${pictures} touch region matches its drawn sprite`,{options:{band:'on'}},async($,on)=>{
 // The one pointer client (play-client.ts, since 10-09) carries pat and poke.
 const w=fixture(on,false,{settings:{mouse:true},env:{LANG:'en_US.UTF-8',TERM:term}})
 await start($,w)
 const shape=bandRow(100),ui=await $.ui.mount({surface:'terminal',...shape,viewport:{...shape.viewport,isFullscreen:true}})
 try{
  expect(w.view().pictures).toBe(pictures)
  const picture=await ui.find({type:kind,key:'sprite'}),client=await ui.find({type:'Client',key:'coco:terminal:play'})
  expect(picture).toBeDefined();expect(client).toBeDefined()
  expect(picture!.props.columns).toBe(columns);expect(picture!.props.rows).toBe(9)
  expect(client!.props.width).toBe(picture!.props.columns);expect(client!.props.height).toBe(picture!.props.rows)
 }finally{await ui.unmount()}
})

test('M1 A2 shared Client dispatcher reaches the touch helper through a supported press',async($,on)=>{
 // Since main's play (10-09) one pointer client, play-client.ts, draws over him and posts pat and poke too; posts from
 // touch-client.ts still reach this dispatcher.
 expect(PLUGIN_SOURCES['hooks/register.tsx']?.includes("   return dispatchTouchMessage(e,terminalTouchFailed,(kind,requestId)=>touch($,kind,requestId),next)")).toBe(true)
 const posts:unknown[]=[],accepted:{kind:string;requestId:string}[]=[],forwarded:UiMessageArgument[]=[];let wakes=0
 on('state.set',{key:'bandWake'},($,e,next)=>{wakes++;return next(e)})
 const w=fixture(on,false,{settings:{mouse:true}});await start($,w)
 const shape=bandRow(100),ui=await $.ui.mount({surface:'terminal',...shape,viewport:{...shape.viewport,isFullscreen:true}})
 const desktop=await $.ui.mount({surface:'desktop',...bandRow(100),requestId:'m1-supported-touch-helper'})
 try{
  const client=await ui.find({type:'Client',key:'coco:terminal:play'});expect(client).toBeDefined()
  let pointer:(e:any)=>void=()=>{};const surface:any={state:{installed:false},columns:client!.props.width,rows:client!.props.height,elements:{Box:(props:unknown)=>({type:'Box',props})},onPointer:(fn:(e:any)=>void)=>{pointer=fn},setState:(state:unknown)=>{surface.state=state},post:(data:unknown)=>{posts.push(data)}}
  touchClient({enabled:true},surface);pointer({type:'down',x:1,y:1,button:'left'});pointer({type:'up',x:1,y:1,button:'left'});expect(posts).toEqual([{t:'poke'}])
  const dto:UiMessageArgument={module:'hooks/touch-client.ts',element:'coco:terminal:touch',surface:'terminal',component:'AbovePrompt',requestId:shape.requestId,data:posts[0]}
  // The SDK does not dispatch Client posts. Exercise the shared shipping host
  // dispatcher explicitly, then the same private touch function via its working press route.
  const apply=async(kind:'poke'|'pat',requestId:string)=>{accepted.push({kind,requestId});const linked=kind==='poke'&&await desktop.find({type:'Markdown',key:'coco:band:poke'});await desktop.press({key:'coco:band:'+kind,...(linked?{link:{href:'file:///coco-poke'}}:{})})}
  const next=async(e:UiMessageArgument)=>{forwarded.push(e);return {}}
  // Coco is drawn from the band data on the first answer, so no picture worker draws the band again: the band takes
  // its wake key when its zero-delay prime runs, which a test's clock runs only when it is told to.
  await desktop.drawn();await w.clock.advance(0);await desktop.drawn();const before=wakes
  for(const rejected of [{...dto,surface:'desktop' as const},{...dto,module:'hooks/another-client.ts'},{...dto,data:{t:'unknown'}}])await dispatchTouchMessage(rejected,false,apply,next)
  await dispatchTouchMessage(dto,true,apply,next)
  expect(accepted).toEqual([]);expect(forwarded.length).toBe(4);expect(wakes).toBe(before)
  expect(await dispatchTouchMessage(dto,false,apply,next)).toEqual({})
  expect(accepted).toEqual([{kind:'poke',requestId:shape.requestId}]);expect(forwarded.length).toBe(4);expect(wakes).toBeGreaterThan(before)
 }finally{await desktop.unmount();await ui.unmount()}
})

test('M1 A10 actual ConfigChange refreshes language and timezone',async($,on)=>{
 const settings:Record<string,unknown>={language:'english',timeZone:'UTC'}
 on('classic.ConfigChange',()=>({}))
 const w=fixture(on,false,{settings})
 await start($,w);expect(w.view().lang).toBe('en');expect(w.view().quotaTimeZone).toBe('UTC')
 settings.language='japanese';settings.timeZone='Asia/Tokyo'
 await $.classic.ConfigChange({source:'user_settings'})
 expect(w.view().lang).toBe('ja');expect(w.view().quotaTimeZone).toBe('Asia/Tokyo')
})

test('M1 A11 actual WorktreeCreate preserves the downstream path',async($,on)=>{
 const result={worktreePath:START.cwd+'/worktrees/topic'}
 on('classic.WorktreeCreate',()=>result)
 const w=fixture(on);await start($,w)
 expect(await $.classic.WorktreeCreate({name:'topic'})).toEqual(result)
})

test('M1 A11 actual repository metadata refreshes the open book and preserves downstream results',async($,on)=>{
 let invalidates=0
 on('ui.invalidate',($,e,next)=>{invalidates++;return next(e)})
 const created={worktreePath:START.cwd+'/worktrees/topic'},changed={watchPaths:[START.cwd+'/other-watch']}
 on('classic.WorktreeCreate',()=>created);on('classic.WorktreeRemove',()=>({}));on('classic.DirectoryAdded',()=>({}));on('classic.CwdChanged',()=>changed)
 const w=fixture(on);await start($,w);await $.command.run({command:'coco',args:'usage',origin:PERSON,presentation:P})
 const pane=await $.ui.mount({surface:'terminal',plugin:'coco',component:'Pane',requestId:'coco-book',props:{title:'Coco',isFocused:false,bodyColumns:100,placement:'dock',scroll:{offset:0,bodyRows:100},view:{}},viewport:{columns:100,rows:100}})
 await w.clock.advance(0);await pane.redraw()
 const worktree=moreFill(moreWord('ribbon.worktree','en'),{name:'topic'}),directory=START.cwd+'/extra',added=moreFill(moreWord('ribbon.added','en'),{folder:directory})
 expect(await pane.find({type:'Text',text:worktree})).toBeUndefined()
 let before=invalidates;expect(await $.classic.WorktreeCreate({name:'topic'})).toEqual(created);expect(invalidates).toBeGreaterThan(before);await pane.redraw();expect(await pane.find({type:'Text',text:worktree})).toBeDefined()
 before=invalidates;expect(await $.classic.WorktreeRemove({worktree_path:created.worktreePath})).toEqual({});expect(invalidates).toBeGreaterThan(before);await pane.redraw();expect(await pane.find({type:'Text',text:worktree})).toBeUndefined()
 before=invalidates;expect(await $.classic.DirectoryAdded({directory,source:'slash_command'})).toEqual({});expect(invalidates).toBeGreaterThan(before);await pane.redraw();expect(await pane.find({type:'Text',text:added})).toBeDefined()
 const cwd=START.cwd+'/next';before=invalidates;expect(await $.classic.CwdChanged({session_id:'fixture-session',old_cwd:START.cwd,new_cwd:cwd})).toEqual(changed);expect(invalidates).toBeGreaterThan(before)
 if(moreWord('model.tell.context','en')==='fixture quota {window} {p} {time}'){
  const snapshot=JSON.parse((await $.command.run({command:'m1-test-model-snapshot',args:'',origin:PERSON,presentation:P})).text??'null')
  expect(snapshot.metadata.repo).toBe(cwd);expect(snapshot.metadata.worktrees).toEqual([]);expect(snapshot.metadata.added).toEqual([directory])
 }
 await pane.unmount()
})

test('M1 A12 actual four-tool batch settles once and interrupt does not flash error', {options:{band:'off'}},async($,on)=>{
 let writes=0
 const calls:{tool_name:string;tool_input:Record<string,unknown>;tool_use_id:string}[]=[]
 on('state.set',{key:'view'},($,e,next)=>{writes++;return next(e)})
 on('tool.*',($,e,next)=>{if(next.is('tool.call',e))calls.push({tool_name:e.tool,tool_input:{},tool_use_id:e.tool_use_id});return next(e)})
 on('classic.PostToolBatch',()=>({}));on('classic.PostToolUseFailure',()=>({}))
 const w=fixture(on);await start($,w);await $.turn.start({turnId:'parallel-batch',text:'read four files'})
 await Promise.all([0,1,2,3].map(i=>$.tool.call({tool:'Read',file_path:START.cwd+'/'+i+'.ts'})))
 await settleLegacyStart($,w);expect(calls.length).toBe(4)
 const before=writes
 await $.classic.PostToolBatch({tool_calls:calls})
 expect(writes-before).toBe(1);expect(w.view().mood).toBe('think');expect(w.view().pose).toBeUndefined()
 await $.classic.PostToolBatch({tool_calls:calls});expect(writes-before).toBe(1)
 const failure={tool_name:'Read',tool_input:{},tool_use_id:'interrupted',error:'Interrupted by fixture',is_interrupt:true}
 await $.classic.PostToolUseFailure(failure);expect(writes-before).toBe(1);expect(w.view().mood).toBe('think')
 await $.classic.PostToolUseFailure({...failure,is_interrupt:false});expect(w.view().mood).toBe('error')
})

test('M1 A12 actual batch settlement preserves a held error', {options:{band:'off'}},async($,on)=>{
 let writes=0
 on('state.set',{key:'view'},($,e,next)=>{writes++;return next(e)})
 on('classic.PostToolBatch',()=>({}));on('classic.PostToolUseFailure',()=>({}))
 const w=fixture(on);await start($,w);await $.turn.start({turnId:'held-error',text:'read a file'})
 await $.tool.call({tool:'Read',file_path:START.cwd+'/held.ts'})
 await $.classic.PostToolUseFailure({tool_name:'Read',tool_input:{},tool_use_id:'held-error-read',error:'Controlled read failure',is_interrupt:false})
 expect(w.view().mood).toBe('error')
 const before=writes
 await $.classic.PostToolBatch({tool_calls:[{tool_name:'Read',tool_input:{},tool_use_id:'held-error-read'}]})
 expect(w.view().mood).toBe('error');expect(writes).toBe(before)
})

// The control harness adds only a read-only command observer for these internal
// event snapshots. This proves metadata retention, not the still-missing UI host.
if(moreWord('model.tell.context','en')==='fixture quota {window} {p} {time}')test('M1 A13 actual PostModelSwitch metadata survives the next prompt',async($,on)=>{
 on('classic.PostModelSwitch',()=>({}))
 const w=fixture(on);await start($,w)
 const snapshot=async()=>{const {model,snapshot}=JSON.parse((await $.command.run({command:'m1-test-model-snapshot',args:'',origin:PERSON,presentation:P})).text??'null');return{model,snapshot}}
 expect((await snapshot()).model).toBe('fixture-model')
 await $.classic.PostModelSwitch({from_model:'fixture-model',to_model:'fixture-next-model',requested_model:'fixture-next-model',source:'command',context_tokens:100,prompt_cache_warm:false,cache_ttl:'5m',estimated_cache_write_usd:0,pricing:'default'})
 expect(await snapshot()).toEqual({model:'fixture-next-model',snapshot:'fixture-next-model'})
 await $.prompt.submit({text:'A new request after switching the model',wait:false,origin:PERSON})
 expect(await snapshot()).toEqual({model:'fixture-next-model',snapshot:'fixture-next-model'})
})
