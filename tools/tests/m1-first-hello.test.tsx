import { installM1Words } from './m1-more-data-fixture'
import {expect,test} from 'claude-code/testing'
import type {On,RenderSurface} from 'claude-code'
import {gapCharacterName} from '../hooks/mod-gaps-words'
import {WORDS} from '../hooks/words'
import {LINES} from '../hooks/lines'
import {world,settleLegacyStart,MORNING,P,PERSON,band} from './world'
import {pathPattern} from './file-paths'
import {C3_WORDS_RAW} from './c3-words-fixture'
import {C3_HEAD_MANIFEST} from './c3-head-assets'


installM1Words()
const anyHello=(shown:string)=>LINES.en.first_meet.some(line=>shown.includes(line))

const START={cwd:'/tmp/m1-first-hello',surface:'terminal' as RenderSurface,isInteractive:true}
const PANE={plugin:'coco',component:'Pane' as const,requestId:'coco-book',props:{title:'Coco',isFocused:false,bodyColumns:100,placement:'dock' as const,scroll:{offset:0,bodyRows:100},view:{}},viewport:{columns:100,rows:100}}
function nodes(tree:any,type:string):any[]{return !tree||typeof tree!=='object'?[]:[...(tree.type===type?[tree]:[]),...(tree.children??[]).flatMap((child:any)=>nodes(child,type))]}
function text(tree:any):string{return typeof tree==='string'?tree:Array.isArray(tree)?tree.map(text).join(''):tree&&typeof tree==='object'?text(tree.children):''}
function fixture(on:On,options:{surface?:RenderSurface;sr?:boolean;store?:Record<string,unknown>;claim?:boolean;guard?:boolean;initialState?:Record<string,unknown>;turns?:number}={}){
 const surface=options.surface??'terminal',claims:string[][]=[],guardRuns:string[][]=[],writes=new Map<string,unknown>(),deletes:string[]=[],calls:string[]=[],idle:string[]=[]
 const headWrites:any[]=[]
 let marker=false,recording=false
 // Positive cases explicitly emulate the retained development helper.
 on('fs.exists',{path:pathPattern('/System/Library/CoreServices/SystemVersion.plist')},()=>({value:true}))
 on('fs.exists',{path:/[\\/]bin[\\/]coco-state(?:-macos-(?:x86_64|aarch64)|-linux-(?:x86_64|aarch64)|-windows-(?:x86_64|aarch64)\.exe)?$/},()=>({value:options.guard!==false}))
 on('agent.list',()=>({value:[]}));on('session.model',()=>({value:'test-model'}));on('session.repo',()=>({value:null}));on('session.turns',()=>({value:options.turns??1}));on('fs.write',()=>({value:undefined}))
 on('model.complete',()=>{calls.push('model');return {deny:'unexpected model'} as never});on('agent.spawn',()=>{calls.push('agent');return {deny:'unexpected agent'} as never});on('tool.register',()=>{calls.push('tool');return {deny:'unexpected tool'} as never});on('http.fetch',()=>{calls.push('network');return {deny:'unexpected network'} as never})
 on('clock.*',async($,e,next)=>{const timer=next.is('clock.after',e)||next.is('clock.every',e);if(recording&&timer)idle.push('timer');const result=await next(e);if(recording&&timer)idle.push('wake');return result})
 on('state.*',($,e,next)=>{if(recording&&next.is('state.get',e))idle.push('state');if(next.is('state.set',e)&&e.key==='head')headWrites.push({id:e.id,value:e.value});return next(e)})
 on('fs.*',($,e,next)=>{if(recording&&next.is('fs.read',e))idle.push('file');return next(e)})
 on('store.*',async($,e,next)=>{if(recording&&next.is('store.get',e))idle.push('store');const result=await next(e);if(!('deny' in result)){if(next.is('store.set',e))writes.set(e.key,e.value);if(next.is('store.delete',e))deletes.push(e.key)}return result})
 on('process.run',($,e)=>{
  if(recording)idle.push('process')
  if(/[\\/]bin[\\/]coco-state(?:-macos-(?:x86_64|aarch64)|-linux-(?:x86_64|aarch64)|-windows-(?:x86_64|aarch64)\.exe)?$/.test(e.argv[0]??'')){guardRuns.push([...e.argv]);if(options.guard===false)throw new Error()}
  let response:any={ok:true,result:{},ensured:true,claimed:true}
  if(e.argv.includes('--claim-welcome')){claims.push([...e.argv]);response={claimed:options.claim!==false&&!marker};marker=true}
  if(e.argv.includes('--read-requests'))response={read:true,text:''}
  if(e.argv.includes('--append-requests'))response={appended:true}
  return{value:{exitCode:0,stdout:JSON.stringify(response),stderr:'',isStdoutTruncated:false,isStderrTruncated:false}}
 })
 const w=world(on,{engineRows:true,surfaces:[surface],initialState:options.initialState,percent:20,stepText:'First reply.',env:{LANG:'en_US.UTF-8',TERM:'xterm-256color',HOME:'/tmp/m1-first-owned',...(options.sr?{CLAUDE_AX_SCREEN_READER:'1'}:{})},store:{bandSettings:{voice:'off',notes:false,guard:false,bookmark:false,...(surface==='desktop'?{band:'off'}:{})},...options.store},readText:path=>path.endsWith('c3-text.json')?C3_WORDS_RAW:path.endsWith('frame-manifest.json')?JSON.stringify(C3_HEAD_MANIFEST):undefined})
 return{w,claims,guardRuns,writes,deletes,calls,idle,headWrites,record:()=>{recording=true},pause:()=>{recording=false}}
}
async function begin($:any,f:ReturnType<typeof fixture>,surface:RenderSurface='terminal'){await $.session.start({...START,surface});await settleLegacyStart($,f.w)}
async function firstReply($:any){await $.turn.start({turnId:'first',text:'hello'});for await(const _ of $.turn.step({turnId:'first',index:0,model:'test',messageCount:1})){} }
function bookHost($:any,on:On){
 let pane:any
 on('ui.*',async(_hook,e,next)=>{
  const result=await next(e)
  if(next.is('ui.open',e)&&e.id==='coco-book'&&(result as {value?:{isPlaced?:boolean}}).value?.isPlaced){
   pane??=await $.ui.mount({surface:'terminal',...PANE,props:{...PANE.props,isFocused:true}})
  }
  return result
 })
 return{pane:()=>pane}
}


// Owner 10-14: the first appearance says a first-meeting line, and the line no longer carries a book button.
for(const sr of [false,true])test('M1 first hello fresh terminal '+(sr?'screen reader':'band')+' greets with a first-meeting line and no book button on the line',async($,on)=>{
 const f=fixture(on,{sr});await begin($,f)
 const row=await $.ui.mount({surface:'terminal',...band(100)});await settleLegacyStart($,f.w);await row.redraw()
 const line=f.w.view().line!;expect(line.key).toBe('first.hello');expect(LINES.en.first_meet).toContain(line.text);expect(line.class).toBe(2);expect(line.expiresAt).toBe(MORNING+300000)
 expect((line as {button?:unknown}).button).toBeUndefined();expect(f.claims.length).toBe(1);expect(f.writes.get('welcome')).toEqual({at:MORNING});expect(f.w.toasts).toEqual([])
 expect(f.calls).toEqual([]);await row.unmount()
})
for(const surface of ['vscode','mobile','desktop'] as const)test('M1 first hello '+surface+' uses one existing head book button and clears its first flag once',{options:{band:surface==='desktop'?'off':'on'}},async($,on)=>{
 const f=fixture(on,{surface}),headWrites=f.headWrites
 await begin($,f,surface);expect(f.claims).toEqual([]);await firstReply($)
 const row=await $.ui.mount({surface,plugin:'coco',component:'AssistantMessage',requestId:'first-head',props:{text:'First reply.',isFirstOfReply:true},viewport:{columns:100,rows:80}});await f.w.clock.advance(0)
 const tree=await row.drawn();expect(text(tree)).toContain(LINES.en.first_meet[0]!);expect(text(tree)).toContain(gapCharacterName('en'));expect(nodes(tree,'Button').filter(node=>node.props.key==='coco:book:open').length).toBe(1);expect(nodes(tree,'Button').filter(node=>node.props.key?.includes('first')).length).toBe(0)
 const pictures=nodes(tree,'Svg');expect(pictures[0]?.props.source).toContain('svg');expect(f.w.cell('head:first-head')?.value.first).toBe(true)
 const note=nodes(tree,'Box').find(box=>box.children?.length===2&&box.children[0]?.props.width===35&&text(box.children[1])===LINES.en.first_meet[0]!);expect(note).toBeDefined();expect(note.children[1].props.marginLeft).toBe(1)
 expect(f.w.toasts).toEqual([])
 await $.turn.complete({turnId:'first',answer:'First reply.',reason:'answer',isAborted:false,durationMs:1000});expect(f.w.toasts).toEqual([]);const before=headWrites.length
 await $.turn.start({turnId:'second',text:'again'});expect(headWrites.slice(before).filter(row=>row.id==='first-head'&&row.value.first===false).length).toBe(1);await row.redraw();expect(anyHello(text(await row.drawn()))).toBe(false)
 expect(f.claims.length).toBe(1);expect(f.w.toasts).toEqual([]);expect(f.calls).toEqual([]);await row.unmount()
})
test('M1 first hello native claim refusal fails closed before greeting content',async($,on)=>{
 const f=fixture(on,{claim:false});await begin($,f);const row=await $.ui.mount({surface:'terminal',...band(100)});await settleLegacyStart($,f.w);await row.redraw();expect(f.claims.length).toBe(1);expect(f.writes.has('welcome')).toBe(false);expect(anyHello(text(await row.drawn()))).toBe(false);expect(f.w.view().line?.key==='first.hello').toBe(false);await row.unmount()
})
test('M1 first hello remote native claim refusal leaves the existing head unchanged',async($,on)=>{
 const f=fixture(on,{surface:'vscode',claim:false});await begin($,f,'vscode');await firstReply($);const row=await $.ui.mount({surface:'vscode',plugin:'coco',component:'AssistantMessage',requestId:'refused-head',props:{text:'First reply.',isFirstOfReply:true},viewport:{columns:100,rows:80}});await f.w.clock.advance(0);expect(f.claims.length).toBe(1);expect(f.writes.has('welcome')).toBe(false);expect(anyHello(text(await row.drawn()))).toBe(false);expect(f.w.cell('head:refused-head')?.value.first===true).toBe(false);await row.unmount()
})
for(const key of ['firstMet','welcome'])test('M1 first hello legacy '+key+' prevents a new lifetime claim',async($,on)=>{
 const f=fixture(on,{store:{[key]:key==='firstMet'?MORNING-100000:{at:MORNING-100000}}});await begin($,f);const row=await $.ui.mount({surface:'terminal',...band(100)});await settleLegacyStart($,f.w);expect(f.claims).toEqual([]);expect(f.w.view().line?.key==='first.hello').toBe(false);expect(f.writes.has('welcome')).toBe(false);await row.unmount()
})
// Main's openings (10-09) read a session with turns and no source as resumed («back»); a new one has none.
test('M1 first hello chosen legacy Light retains its time-of-day greeting',async($,on)=>{
 const f=fixture(on,{turns:0,store:{firstMet:MORNING-100000,bandSettings:{voice:'light',voiceChosen:true}}});await begin($,f);const row=await $.ui.mount({surface:'terminal',...band(100)});await settleLegacyStart($,f.w);expect(LINES.en.greeting.morning).toContain(f.w.view().said);expect(f.claims).toEqual([]);await row.unmount()
})
test('M1 first hello fresh all More off has zero idle work after 60 seconds and expires on the next draw',async($,on)=>{
 const f=fixture(on);await begin($,f);const row=await $.ui.mount({surface:'terminal',...band(100)});await settleLegacyStart($,f.w);expect(f.w.view().line?.key).toBe('first.hello');await f.w.clock.advance(60000);f.record();await f.w.clock.advance(240000);expect(f.idle).toEqual([]);f.pause();await row.redraw();expect(anyHello(text(await row.drawn()))).toBe(false);await f.w.clock.advance(0);expect(f.w.view().line?.key==='first.hello').toBe(false);expect(anyHello(text(await row.drawn()))).toBe(false);expect(f.calls).toEqual([]);await row.unmount()
})
test('M1 first hello updater card consumes voiceAskAgain by deleting the stored key',async($,on)=>{
 const host=bookHost($,on),f=fixture(on,{store:{firstMet:MORNING-100000,voiceAskAgain:true}});await begin($,f);await $.command.run({command:'coco',args:'about',origin:PERSON,presentation:P});const pane=host.pane();expect(pane).toBeDefined();expect(await pane.find({type:'Button',key:'coco:first:voice:keep'})).toBeDefined();await f.w.clock.advance(0);expect(f.deletes.filter(key=>key==='voiceAskAgain').length).toBe(1);expect(f.writes.has('voiceAskAgain')).toBe(false);await pane.unmount()
})
test('M1 first hello resumed recorded head clears its first flag before old-scroll rendering',async($,on)=>{
 const key='heads:v2:'+String(MORNING-10000).padStart(16,'0')+':fixture-session:old-first'
 const f=fixture(on,{surface:'vscode',store:{firstMet:MORNING-20000,welcome:{at:MORNING-20000},[key]:['old-first','happy',MORNING-10000,1000]},initialState:{'head:old-first':{mood:'happy',newest:true,endedAt:MORNING-10000,ms:1000,first:true}}});await begin($,f,'vscode');await $.turn.start({turnId:'after-resume',text:'continue'});expect(f.w.cell('head:old-first')?.value.first).toBe(false)
 const row=await $.ui.mount({surface:'vscode',plugin:'coco',component:'AssistantMessage',requestId:'old-first',props:{text:'Old reply.',isFirstOfReply:true},viewport:{columns:100,rows:80}});expect(anyHello(text(await row.drawn()))).toBe(false);expect(f.claims).toEqual([]);await row.unmount()
})

test('M1 missing deferred guard skips welcome and maintenance without any native exec',async($,on)=>{
 on('classic.Setup',()=>({}))
 const f=fixture(on,{guard:false});await begin($,f)
 expect(f.w.view().line?.key==='first.hello').toBe(false);expect(f.claims).toEqual([])
 await $.classic.Setup({trigger:'maintenance',session_id:'missing-helper',cwd:START.cwd})
 expect(f.guardRuns).toEqual([])
})

for(const surface of ['desktop','vscode','mobile'] as const)test('M1 missing deferred guard '+surface+' first visible text keeps its head without native exec',{options:{band:surface==='desktop'?'off':'on'}},async($,on)=>{
 const f=fixture(on,{surface,guard:false});await begin($,f,surface)
 expect(f.guardRuns).toEqual([])
 await firstReply($)
 const row=await $.ui.mount({surface,plugin:'coco',component:'AssistantMessage',requestId:'missing-helper-head',props:{text:'First reply.',isFirstOfReply:true},viewport:{columns:100,rows:80}})
 try{
  await f.w.clock.advance(0)
  const tree=await row.drawn()
  expect(nodes(tree,'engine')).toEqual([{type:'engine',ref:0}]);expect(text(tree)).toContain(gapCharacterName('en'))
  expect(nodes(tree,'Button').filter(node=>node.props.key==='coco:book:open').length).toBe(1)
  expect(anyHello(text(tree))).toBe(false)
  expect(f.w.cell('head:missing-helper-head')?.value.first===true).toBe(false)
  expect(f.writes.has('welcome')).toBe(false);expect(f.claims).toEqual([]);expect(f.guardRuns).toEqual([])
 }finally{await row.unmount()}
})
