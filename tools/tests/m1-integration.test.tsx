import { installM1Words } from './m1-more-data-fixture'
import { installModelServiceFixture, modelServiceFixtureText } from './m1-model-service-fixture'
import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Plugin } from 'claude-code/testing'
import { focusBook } from '../hooks/mod-gaps'
import { MORE_IDS } from '../hooks/more-state'
import { sleepAfter } from '../hooks/sleep'
import { incenseAlt, quotaBatteryRows, quotaPixelSvg } from '../hooks/quota'
import { gapFill,gapWord,gapPool } from '../hooks/mod-gaps-words'
import { moreWord } from '../hooks/more-words'
import { momentText, durationText } from '../hooks/numbers'
import { PLUGIN_MANIFEST } from './plugin-sources'
import { WORDS, LANGS } from '../hooks/words'
import { world, settleLegacyStart, RECENT, MORNING, P, PERSON, SUMMARY, desktopPicture, band as bandRow } from './world'
import { C3_WORDS_RAW } from './c3-words-fixture'
import { c3Word } from '../hooks/c3-words'
import { C3_HEAD_MANIFEST } from './c3-head-assets'
import { c3NextMotion } from '../hooks/c3-motion'
import { PIXEL_MOMENTS } from '../hooks/coco-pixel'
import { pixelHeld, pixelPng } from '../hooks/coco-pixel-play'
const PIXEL_LOOK={outfit:'A' as const,dark:true,colors:'truecolor' as const}
import { BOOK_FILES } from './book-files'
import { WINDOWS_ROOTS } from './test-system'
import { BAG_TEXT_RAW } from './bag-text-fixture'
// her desktop companion stands on her page once lane B has named its group there (bag step 2), else on the switches page
const COMPANION_PAGE = JSON.parse(BAG_TEXT_RAW).en.himGroups ? 'him' : 'settings'


installM1Words()
installModelServiceFixture()

// O2 observations retain only target-match booleans and public request metadata.
// A failed assertion must never include the private rewrite instruction.
function o2PressObservation(on:On,target:string,hold?:()=>Promise<void>){
 const requests:{model:string;maxTokens:number|undefined;targetMatches:boolean}[]=[],history:{agentId:string|undefined;as:string|undefined}[]=[],late:string[]=[]
 let record=false
 on('model.*',($,e,next)=>{if(next.is('model.complete',e))requests.push({model:e.model,maxTokens:e.maxTokens,targetMatches:e.prompt.endsWith('\n\n'+target)});return next(e)})
 on('session.*',async($,e,next)=>{if(next.is('session.messages',e)){history.push({agentId:e.agentId,as:e.as});await hold?.()}return next(e)})
 on('ui.*',($,e,next)=>{if(record&&(next.is('ui.open',e)||next.is('ui.invalidate',e)))late.push(next.is('ui.open',e)?'open':'invalidate');return next(e)})
 return{requests,history,late,record:()=>{record=true}}
}
const O2_FIXTURE_REPLY={isAnswered:true,text:'Fixture plain rewrite.',usage:{input_tokens:11,output_tokens:2,cache_read_input_tokens:0,cache_creation_input_tokens:0}}
async function o2Enable($:any,f:ReturnType<typeof gapFixture>){
 await $.command.run({command:'coco',args:'more',origin:PERSON,presentation:P})
 const pane=await $.ui.mount({surface:'terminal',...M1_PANE})
 await pane.press({key:'coco:more:explain:on'});await pane.redraw()
 expect(await pane.find({type:'Button',key:'coco:more:explain:ask:yes'})).toBeDefined();expect(f.models).toEqual([])
 await pane.press({key:'coco:more:explain:ask:yes'});await settleLegacyStart($,f.w);await pane.redraw()
 return pane
}

test('M1 O2 actual late activation explains the answer retained while its row was off',async($,on)=>{
 const target='Main answer completed before Explain was enabled.',seen=o2PressObservation(on,target),f=gapFixture(on,{},'terminal',false,async()=>O2_FIXTURE_REPLY)
 await gapBegin($,f.w);await $.turn.start({turnId:'o2-off-answer',text:'a question'});await $.turn.complete({turnId:'o2-off-answer',answer:target,reason:'answer',durationMs:1000,isAborted:false})
 expect(f.models).toEqual([]);expect(seen.history).toEqual([]);const pane=await o2Enable($,f);expect(seen.history).toEqual([])
 const row=await $.ui.mount({surface:'terminal',...bandRow(200)});expect(await row.find({type:'Button',key:'coco:more:explain'})).toBeDefined();await row.press({key:'coco:more:explain'})
 expect(seen.requests).toEqual([{model:'haiku',maxTokens:400,targetMatches:true}]);expect(seen.history).toEqual([]);expect(f.models).toEqual(['model']);await row.unmount();await pane.unmount()
})
test('M1 O2 actual restored transcript reads only current-main history on the explain press',async($,on)=>{
 const target='Latest main assistant answer restored with this session.',seen=o2PressObservation(on,target),f=gapFixture(on,{},'terminal',false,async()=>O2_FIXTURE_REPLY)
 f.messages.push({role:'assistant',text:'Older assistant text.',toolUses:[]},{role:'user',text:'Main user question.',toolUses:[]},{role:'assistant',text:target,toolUses:[]},{role:'assistant',text:'',toolUses:[]})
 await gapBegin($,f.w);expect(seen.history).toEqual([]);expect(f.models).toEqual([]);const pane=await o2Enable($,f);expect(seen.history).toEqual([])
 const row=await $.ui.mount({surface:'terminal',...bandRow(100)});expect(await row.find({type:'Button',key:'coco:more:explain'})).toBeDefined();await row.press({key:'coco:more:explain'})
 expect(seen.history).toEqual([{agentId:undefined,as:undefined}]);expect(seen.requests).toEqual([{model:'haiku',maxTokens:400,targetMatches:true}]);expect(f.models).toEqual(['model']);await row.unmount();await pane.unmount()
})
test('M1 O2 actual selection without a retained answer uses the selected text without history',async($,on)=>{
 const target='Exact selected text from the current visible session.',seen=o2PressObservation(on,target)
 on('ui.selection',()=>({value:{text:target,requestId:'o2-selected-row'}}))
 const f=gapFixture(on,{},'vscode',false,async()=>O2_FIXTURE_REPLY,undefined,'The main answer is still streaming.');await gapBegin($,f.w,'vscode');const pane=await o2Enable($,f)
 await $.turn.start({turnId:'o2-selection',text:'a question'});for await(const _ of $.turn.step({turnId:'o2-selection',index:0,model:'test',messageCount:1})){}
 const row=await $.ui.mount({surface:'vscode',plugin:'coco',component:'AssistantMessage',requestId:'o2-streaming-head',props:{text:'The main answer is still streaming.',isFirstOfReply:true},viewport:{columns:100,rows:50}})
 expect(await row.find({type:'Button',key:'coco:more:explain'})).toBeDefined();await row.press({key:'coco:more:explain'});expect(seen.requests).toEqual([{model:'haiku',maxTokens:400,targetMatches:true}]);expect(seen.history).toEqual([]);expect(f.models).toEqual(['model']);await row.unmount();await pane.unmount()
})
test('M1 O2 actual held history read cannot dispatch or repaint after Explain off then on',async($,on)=>{
 let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(resolve=>{entered=resolve}),held=new Promise<void>(resolve=>{release=resolve})
 const seen=o2PressObservation(on,'Old held main answer.',async()=>{entered();await held}),f=gapFixture(on,{},'terminal',false,async()=>O2_FIXTURE_REPLY);f.messages.push({role:'assistant',text:'Old held main answer.',toolUses:[]})
 await gapBegin($,f.w);const pane=await o2Enable($,f),row=await $.ui.mount({surface:'terminal',...bandRow(100)});expect(seen.history).toEqual([])
 expect(await row.find({type:'Button',key:'coco:more:explain'})).toBeDefined();const pending=row.press({key:'coco:more:explain'});await Promise.race([ready,pending.then(()=>{throw Error('Expected actual current-main history request')})]);await pane.press({key:'coco:more:explain:off'});await pane.redraw();await pane.press({key:'coco:more:explain:on'});await settleLegacyStart($,f.w)
 seen.record();release();await pending;await settleLegacyStart($,f.w);expect(seen.history).toEqual([{agentId:undefined,as:undefined}]);expect(seen.requests).toEqual([]);expect(f.models).toEqual([]);expect(seen.late).toEqual([]);await row.unmount();await pane.unmount()
})

const START={cwd:'/tmp/m1-integration',surface:'terminal' as const,isInteractive:true}
const ASK={model:'test',promptModel:'test',tools:[],outputStyle:null,traits:[],surfaces:['terminal' as const]}
const M1_ENGINE={type:'engine',ref:0}

for(const c of [{name:'first session',seen:0,used:false,tail:true},{name:'fourth session',seen:3,used:false,tail:false},{name:'remembered keyboard discovery',seen:1,used:true,tail:false}])test('M1 MOD10 actual hint '+c.name+' preserves the engine line and bounded store writes',async($,on)=>{
 const renders:any[]=[],writes=gapStoreWrites(on)
 on('ui.*',($,e,next)=>{if(next.is('ui.render',e)&&e.component==='PromptHint')renders.push({...e.props});return next(e)})
 const f=gapFixture(on,{hintSessions:c.seen,bandKeysUsed:c.used,bandSettings:{voice:'off',voiceChosen:true,band:'on',notes:false,guard:false,bookmark:false}})
 await gapBegin($,f.w)
 for(const props of [{isDraft:false,isWorking:false},{isDraft:true,isWorking:false},{isDraft:false,isWorking:true}]){
  const row=await $.ui.mount({surface:'terminal',plugin:'coco',component:'PromptHint',requestId:'hint-'+String(renders.length),props:{...props,hint:'Engine-owned hint'},viewport:{columns:100,rows:50}})
  const received=renders.at(-1);expect(received.hint).toBe('Engine-owned hint');expect(received.tail).toBe(c.tail&&!props.isDraft&&!props.isWorking?', '+gapWord('en','hint.tail'):undefined);await row.unmount()
 }
 if(c.seen<3)expect(writes.get('hintSessions')).toBe(c.seen+1);else expect(writes.has('hintSessions')).toBe(false)
 expect(writes.has('bandKeysUsed')).toBe(false);expect(f.models).toEqual([])
})
const M1_PANE={plugin:'coco',component:'Pane' as const,requestId:'coco-book',props:{title:'Coco',isFocused:false,bodyColumns:100,placement:'dock' as const,scroll:{offset:0,bodyRows:100},view:{}},viewport:{columns:100,rows:100}}
function m1Nodes(tree:any,type:string):any[]{return !tree||typeof tree!=='object'?[]:[...(tree.type===type?[tree]:[]),...(tree.children??[]).flatMap((child:any)=>m1Nodes(child,type))]}
function m1Text(tree:any):string{return typeof tree==='string'?tree:Array.isArray(tree)?tree.map(m1Text).join(''):tree&&typeof tree==='object'?m1Text(tree.children):''}
function gapFixture(on:On,store:Record<string,unknown>={},surface:'terminal'|'desktop'|'vscode'|'mobile'='terminal',watch=false,modelReply?:()=>Promise<any>,environment?:Record<string,string>,stepText?:string){
 const messages:any[]=[],models:string[]=[],tools:any[]=[],registered:string[]=[]
 // This fixture opts into the native helper contract; shipping has no A17 binary.
 on('fs.exists',{path:'/System/Library/CoreServices/SystemVersion.plist'},()=>({value:true}))
 on('fs.exists',{path:/[\\/]bin[\\/]coco-state(?:-macos-(?:x86_64|aarch64)|-linux-(?:x86_64|aarch64)|-windows-(?:x86_64|aarch64)\.exe)?$/},()=>({value:true}))
 on('agent.list',()=>({value:[]}));on('session.model',()=>({value:'test-model'}));on('session.repo',()=>({value:null}));on('session.turns',()=>({value:1}));on('fs.write',()=>({value:undefined}))
 on('session.messages',()=>({value:messages.slice()}))
 on('session.append',($,e,next)=>next(e))
 on('model.complete',()=>{models.push('model');return modelReply?modelReply().then(value=>({value})):{deny:'unexpected model call'} as never})
 on('tool.*',($,e,next)=>{if(next.is('tool.call',e))tools.push(e);return next(e)})
 on('command.*',($,e,next)=>{if(next.is('command.register',e))registered.push(e.name);return next(e)})
 on('process.run',($,e)=>{
  let request:any={};try{request=JSON.parse(e.init?.stdin??'{}')}catch{};let result:any={}
  if(request.op==='recognize')result={kind:'test',tool:'npm',key:'npm test'}
  if(request.op==='finish')result={parsed:{outcome:'pass'},slowness:{slow:false},history:{[request.key]:[{ms:request.ms,outcome:'pass'}]}}
  const response=e.argv.includes('--read-requests')?{read:true,text:''}:e.argv.includes('--append-requests')?{appended:true}:{ok:true,result,ensured:true,claimed:true}
  return {value:{exitCode:0,stdout:JSON.stringify(response),stderr:'',isStdoutTruncated:false,isStderrTruncated:false}}
 })
 const w=world(on,{sessionTurns:false,moreText:modelServiceFixtureText(),engineRows:true,surfaces:[surface],percent:95,...(stepText===undefined?{}:{stepText}),...(watch?{env:{HOME:'/tmp/m1-owned-watch',LANG:'en_US.UTF-8',TERM:'xterm-256color'},sessionRoot:START.cwd}:{}),...(environment?{env:environment}:{}),store:{...RECENT,firstMet:MORNING,bandSettings:{voice:'off',voiceChosen:true,notes:false,bookmark:false,guard:false},...store},readText:path=>watch&&path.endsWith('requests.jsonl')?'':path.endsWith('c3-text.json')?C3_WORDS_RAW:path.endsWith('frame-manifest.json')?JSON.stringify(C3_HEAD_MANIFEST):undefined})
 return {w,messages,models,tools,registered}
}
// Observe successful plugin-store writes through documented events. The test
// engine has no store noun, and mock.store keeps its exact handlers.
function gapStoreWrites(on:On,before?:(e:any,next:any)=>Promise<void>|void,after?:(e:any,next:any)=>void){
 const values=new Map<string,unknown>()
 on('store.*',async($,e,next)=>{
  await before?.(e,next)
  const result=await next(e)
  if(next.is('store.set',e)&&!('deny' in result)){values.set(e.key,e.value);after?.(e,next)}
  return result
 })
 return values
}
async function gapBegin($:any,w:any,surface:string='terminal') {await $.session.start({...START,surface});await settleLegacyStart($,w)}
function setup(on:On,more:Record<string,unknown>={},limits:{kind:string;percentUsed:number;resetsAt?:string}[]=[],band='off') {
 const calls:string[]=[],reads:string[]=[],timers:string[]=[],wakeups:string[]=[]
 let recording=false
 on('agent.list',()=>({value:[]}))
 on('session.model',()=>({value:'test-model'}))
 on('session.repo',()=>({value:null}))
 on('session.turns',()=>({value:1}))
 on('fs.write',()=>({value:undefined}))
 on('classic.StopFailure',()=>({}))
 on('prompt.edit',($,e)=>({text:e.text.slice(0,e.start)+e.inputText+e.text.slice(e.end),cursor:e.start+e.inputText.length}))
 on('model.complete',()=>{calls.push('model.complete');return {deny:'unexpected optional capability call'} as never})
 on('model.fork',()=>{calls.push('model.fork');return {deny:'unexpected optional capability call'} as never})
 on('model.classify',()=>{calls.push('model.classify');return {deny:'unexpected optional capability call'} as never})
 on('agent.register',()=>{calls.push('agent.register');return {deny:'unexpected optional capability call'} as never})
 on('agent.spawn',()=>{calls.push('agent.spawn');return {deny:'unexpected optional capability call'} as never})
 on('tool.register',()=>{calls.push('tool.register');return {deny:'unexpected optional capability call'} as never})
 on('http.fetch',()=>{calls.push('http.fetch');return {deny:'unexpected optional capability call'} as never})
 on('fs.*',async($,e,next)=>{if(recording&&next.is('fs.read',e))reads.push(e.path);return next(e)})
 on('store.*',($,e,next)=>{if(recording&&next.is('store.get',e))reads.push('store:'+e.key);return next(e)})
 on('state.*',($,e,next)=>{if(recording&&next.is('state.get',e))reads.push('state:'+e.key);return next(e)})
 on('session.*',($,e,next)=>{if(recording&&next.is('session.usage',e))reads.push('session.usage');return next(e)})
 on('clock.*',async($,e,next)=>{const waiting=next.is('clock.after',e)||next.is('clock.every',e);if(recording&&waiting)timers.push('timer:'+e.ms);const result=await next(e);if(recording&&waiting)wakeups.push('wake');return result})
 const w=world(on,{sessionTurns:false,moreText:modelServiceFixtureText(),store:{...RECENT,firstMet:MORNING,bandSettings:{voice:'off',voiceChosen:true,band},more},percent:95,limits,readText:path=>path.endsWith('c3-text.json')?C3_WORDS_RAW:path.endsWith('frame-manifest.json')?JSON.stringify(C3_HEAD_MANIFEST):undefined})
 return {w,calls,reads,timers,wakeups,record:()=>{recording=true}}
}

for(const id of MORE_IDS)test(`M1 actual register: ${id} off spends no model, agent, tool registration, prompt or network work`,async($,on)=>{
 const f=setup(on,{[id]:id==='cap'?0:false})
 await $.session.start(START);await settleLegacyStart($,f.w)
 // Readiness is verified through the book, so a failed background boot cannot
 // make the absence assertions pass by leaving More unconfigured.
 await $.command.run({command:'coco',args:'more',origin:PERSON,presentation:P})
 const pane=await $.ui.mount({surface:'terminal',plugin:'coco',component:'Pane',requestId:'coco-book',props:{title:'Coco',isFocused:false,bodyColumns:100,placement:'dock',scroll:{offset:0,bodyRows:100},view:{}},viewport:{columns:100,rows:100}})
 expect(await pane.find({type:'Button',key:'coco:more:talk:on'})).toBeDefined()
 await pane.unmount()
 expect(f.w.view().voice).toBe('off')
 const sections=(await $.prompt.compose(ASK)).sections
 expect(sections.map(s=>s.id)).toEqual(['intro'])
 await $.prompt.edit({origin:{kind:'composer'},text:'',cursor:0,start:0,end:0,inputText:'sk-'+ 'x'.repeat(48)})
 await $.turn.start({turnId:'m1-off',text:'sk-'+ 'x'.repeat(48)})
 await $.tool.call({tool:'Edit',file_path:'/tmp/m1-integration/example.ts',old_string:'old',new_string:'new'})
 await $.turn.complete({turnId:'m1-off',answer:'Done.',reason:'answer',isAborted:false,durationMs:1000})
 for(let i=0;i<3;i++)await $.classic.StopFailure({error:'server_error',cwd:START.cwd,session_id:'fixture-session'})
 const later=(await $.prompt.compose(ASK)).sections
 expect(later.map(s=>s.id)).toEqual(sections.map(s=>s.id))
 expect(JSON.stringify(later)===JSON.stringify(sections)).toBe(true)
 expect(f.calls).toEqual([])
})

test('M1 F1 actual fresh defaults: 100 prompts and four surface book draws keep optional calls and context at zero',async($,on)=>{
 const submitted:{text:string;origin:string;context:readonly string[]}[]=[]
 // Testing dispatches the engine event directly; these fields simulate Enter,
 // while a shipping plugin's submit call remains engine-owned plugin origin.
 on('prompt.*',($,e,next)=>{if(next.is('prompt.submit',e))submitted.push({text:e.text,origin:e.origin.kind,context:e.context??[]});return next(e)})
 const f=setup(on)
 await $.session.start(START);await settleLegacyStart($,f.w)
 const before=(await $.prompt.compose(ASK)).sections
 expect(before.map(s=>s.id)).toEqual(['intro'])
 for(let i=0;i<100;i++){
  await $.prompt.submit({text:`fixture prompt ${i}`,asUser:true,origin:PERSON,presentation:P,wait:false})
  await $.turn.start({turnId:`m1-fresh-${i}`,text:`fixture prompt ${i}`})
  await $.turn.complete({turnId:`m1-fresh-${i}`,answer:'Done.',reason:'answer',isAborted:false,durationMs:1000})
 }
 expect(submitted.map(p=>({text:p.text,origin:p.origin,contextEntries:p.context.length}))).toEqual(Array.from({length:100},(_,i)=>({text:`fixture prompt ${i}`,origin:'composer',contextEntries:0})))
 await $.command.run({command:'coco',args:'more',origin:PERSON,presentation:P})
 for(const surface of ['terminal','desktop','vscode','mobile'] as const){
  const pane=await $.ui.mount({surface,plugin:'coco',component:'Pane',requestId:'coco-book',props:{title:'Coco',isFocused:false,bodyColumns:100,placement:'dock',scroll:{offset:0,bodyRows:100},view:{}},viewport:{columns:100,rows:100}})
  expect(await pane.find({type:'Button',key:'coco:more:talk:on'})).toBeDefined()
  if(surface==='mobile'){await pane.press({key:'coco:more:talk:help'});await pane.press({key:'coco:more:talk:help'})}
  await pane.press({key:'coco:more:talk:on'});await pane.press({key:'coco:more:talk:ask:no'})
  await pane.unmount()
 }
 const after=(await $.prompt.compose(ASK)).sections
 expect(JSON.stringify(after)===JSON.stringify(before)).toBe(true);expect(f.w.view().voice).toBe('off');expect(f.calls).toEqual([])
})

test('M1 actual register: all More off and hidden band perform zero idle reads and schedule zero timers',{options:{band:'off'}},async($,on)=>{
 const f=setup(on)
 await $.session.start(START);await settleLegacyStart($,f.w)
 expect(f.w.view().band).toBe('off');expect(f.w.view().voice).toBe('off')
 await f.w.clock.advance(600000);await settleLegacyStart($,f.w)
 f.record();await f.w.clock.advance(600000)
 expect(f.reads).toEqual([]);expect(f.timers).toEqual([]);expect(f.wakeups).toEqual([]);expect(f.calls).toEqual([])
})

// She falls asleep by default (owner 10-14, lane C): with all More off the quiet spell's one sleep timer is already armed,
// so the idle minutes read nothing, arm nothing and call nothing; falling asleep is the only redraw, and after it nothing.
test('M1 actual register: visible band with all More off reads, arms and calls nothing while idle; falling asleep is its only redraw',async($,on)=>{
 const f=setup(on,{},[],'on')
 await $.session.start(START);await settleLegacyStart($,f.w)
 const ui=await $.ui.mount({surface:'terminal',...bandRow(100)})
 await ui.drawn();await f.w.clock.advance(60000);await settleLegacyStart($,f.w)
 f.record();await f.w.clock.advance(600000)
 // falling asleep redraws the band, and each drawing reads only the band's own wake key again (its subscription); her one
 // sleep line arms nothing but its own 14-second lifetime, and its coming and going are the other two drawings
 expect(f.reads.filter(read=>read!=='state:bandWake')).toEqual([]);expect(f.reads.length).toBeLessThanOrEqual(3);expect(f.calls).toEqual([])
 expect(f.timers.filter(timer=>timer!=='timer:0'&&timer!=='timer:14000')).toEqual([]);expect(f.timers.length).toBeLessThanOrEqual(4)
 expect(f.w.view().mood).toBe('sleep')
 expect(f.wakeups.length).toBeGreaterThan(0);expect(f.wakeups.length).toBeLessThanOrEqual(2+f.timers.length)
 for(const seen of [f.reads,f.timers,f.wakeups,f.calls])seen.length=0
 await f.w.clock.advance(600000)
 expect(f.reads).toEqual([]);expect(f.timers).toEqual([]);expect(f.wakeups).toEqual([]);expect(f.calls).toEqual([])
 await ui.unmount()
})

test('M1 a retained spent window keeps its authored reset alt with no reading left',()=>{
 expect(incenseAlt('en',[],{out:[{kind:'five_hour',time:'5:40 PM'}]})).toBe(gapFill('en','alt.incense.out',{window:WORDS.en.quota.kinds.five_hour!,time:'5:40 PM'}))
})

test('M1 actual register: paste safety line shows Hide then Keep and Keep clears it without model work',async($,on)=>{
 const f=setup(on,{paste:true},[],'on')
 await $.session.start(START);await settleLegacyStart($,f.w)
 const ui=await $.ui.mount({surface:'terminal',...bandRow(100)})
 await $.prompt.edit({origin:{kind:'composer'},text:'',cursor:0,start:0,end:0,inputText:'sk-'+ 'x'.repeat(48)})
 await settleLegacyStart($,f.w);await ui.drawn()
 expect(f.w.view().line?.buttons?.map(b=>b.key)).toEqual(['coco:more:paste:hide','coco:more:paste:keep'])
 expect(await ui.find({type:'Button',key:'coco:more:paste:hide'})).toBeDefined()
 expect(await ui.find({type:'Button',key:'coco:more:paste:keep'})).toBeDefined()
 await ui.press({key:'coco:more:paste:keep'});expect(f.w.view().line?.key).not.toBe('more.paste')
 expect(f.calls).toEqual([]);await ui.unmount()
})


for(const [error,frame,firstKey] of [['rate_limit','tea-a','limit.out'],['overloaded','waiting','limit.crowded']] as const)test(`M1 MOD3 O10 actual ${error} stays still through expiry, moves again after, and a new limit stills her at once`,{options:{band:'on'}},async($,on)=>{
 let everyRequests=0,afterWakes=0,afterRequests=0
 on('clock.*',async(_hook,e,next)=>{
  if(next.is('clock.every',e))everyRequests++
  if(next.is('clock.after',e))afterRequests++
  const result=await next(e);if(next.is('clock.after',e))afterWakes++;return result
 })
 on('classic.StopFailure',()=>({}))
 const f=gapFixture(on,{more:{lively:true}},'terminal',false,undefined,{LANG:'en_US.UTF-8',TERM:'xterm-kitty'})
 await gapBegin($,f.w)
 const windows=[{kind:'five_hour',percentUsed:100,resetsAt:new Date(MORNING+60000).toISOString()}];f.w.limits=windows
 await $.session.measure({context:{window:200000,tokens:40000,percent:20},rateLimits:windows,changed:['rateLimits']})
 await $.turn.start({turnId:'limit-first',text:'work'})
 const terminal=await $.ui.mount({surface:'terminal',...bandRow(100),requestId:'limit-terminal'})
 await $.classic.StopFailure({error,cwd:START.cwd,session_id:'fixture-session'})
 await $.turn.complete({turnId:'limit-first',answer:'',reason:'error',durationMs:1000,isAborted:false})
 const desktop=await $.ui.mount({surface:'desktop',...bandRow(100),requestId:'limit-desktop'})
 await settleLegacyStart($,f.w)
 const assertStill=async()=>{
  await terminal.redraw();await desktop.redraw()
  // kitty draws her pixel version (DECISIONS 917): the limit's one picture, the sip for the tea and her stand for the wait
  const held=pixelHeld({action:frame==='tea-a'?'coffee':'wait',base:'idle',at:0,outfit:'A'})
  expect((await terminal.find({type:'Image',key:'sprite'}))?.props.source).toEqual({png:pixelPng(held.frame,held.other,PIXEL_LOOK)})
  // the desktop band draws Coco (coco-motion.ts): the limit's action as one still picture
  const source=String((await desktopPicture(desktop))?.props.source)
  expect(source).toContain(`data-coco="A ${frame==='tea-a'?'coffee':'wait'}"`)
  expect(source).not.toMatch(/animation:[^;"]*infinite/);expect(source).not.toMatch(/repeatCount=["']indefinite["']/)
  return source
 }
 expect(f.w.view().frame).toBe(frame);expect(f.w.view().line?.key).toBe(firstKey);expect(f.w.view().pose?.frame).toBe(frame)
 await assertStill();const firstPose={...f.w.view().pose!},firstBlits=f.w.blits.length
 await settleLegacyStart($,f.w);const firstWakes=afterWakes
 const settledAfterRequests=afterRequests
 await assertStill();await settleLegacyStart($,f.w)
 expect(afterRequests).toBe(settledAfterRequests)
 const authoredSwap=c3NextMotion({name:'tea',frame:'tea-a',aside:'',at:MORNING},0)!
 expect(authoredSwap).toBeGreaterThan(0)
 await f.w.clock.advance(88);await settleLegacyStart($,f.w);await assertStill()
 expect(f.w.view().pose).toEqual(firstPose);expect(f.w.view().frame).toBe(frame)
 await f.w.clock.advance(authoredSwap+1-88);await settleLegacyStart($,f.w)
 expect(afterWakes).toBe(firstWakes);expect(f.w.blits.length).toBe(firstBlits);expect(f.w.view().pose).toEqual(firstPose);await assertStill()
 const expiresAt=f.w.view().line!.expiresAt
 await f.w.clock.set(expiresAt);await settleLegacyStart($,f.w)
 expect(f.w.view().line?.key?.startsWith('limit.')).not.toBe(true);expect(f.w.view().pose).toEqual(firstPose);await assertStill()
 const expiryWakes=afterWakes,expiryRequests=everyRequests
 await f.w.clock.advance(6000);await settleLegacyStart($,f.w)
 expect(afterWakes).toBe(expiryWakes);expect(everyRequests).toBe(expiryRequests);expect(f.w.blits.length).toBe(firstBlits)
 await f.w.clock.set(MORNING+sleepAfter(MORNING));await settleLegacyStart($,f.w);await terminal.redraw()
 expect(f.w.view().mood).toBe('sleep');expect(f.w.view().pose).toBeUndefined()
 // Lively is on here, so she falls asleep first, then holds her sleeping picture
 await f.w.clock.advance(PIXEL_MOMENTS.doze!.body.reduce((a,s)=>a+s[1],0));await settleLegacyStart($,f.w);await terminal.redraw()
 expect((await terminal.find({type:'Image',key:'sprite'}))?.props.source).toEqual({png:pixelPng(PIXEL_MOMENTS.doze!.loop[0]![0],0,PIXEL_LOOK)})
 await $.turn.start({turnId:'limit-resumed',text:'continue'})
 await $.turn.complete({turnId:'limit-resumed',answer:'Done.',reason:'answer',durationMs:1000,isAborted:false})
 f.w.limits=[];await $.session.measure({context:{window:200000,tokens:40000,percent:20},rateLimits:[],changed:['rateLimits']})
 await f.w.clock.advance(60000);await settleLegacyStart($,f.w)
 // once the limit is gone her pixel loop moves again (Lively is on here); the old two-second owner never starts
 const seen=new Set<string>()
 for(let t=0;t<4000;t+=50){await f.w.clock.advance(50);seen.add(String((await terminal.find({type:'Image',key:'sprite'}))?.props.source?.png))}
 expect(seen.size).toBeGreaterThan(1);expect(everyRequests).toBe(expiryRequests)
 // a new limit while she moves: she holds its one picture at once, and nothing more is pending
 try{
  await $.classic.StopFailure({error,cwd:START.cwd,session_id:'fixture-session'})
  await terminal.drawn();await desktop.drawn();await settleLegacyStart($,f.w)
  const key=error==='rate_limit'?'limit.wait':'limit.crowded'
  expect(f.w.view().frame).toBe(frame);expect(f.w.view().line?.key).toBe(key);expect(f.w.view().pose?.frame).toBe(frame)
  const pose={...f.w.view().pose!},blits=f.w.blits.length,wakes=afterWakes
  await assertStill()
  await f.w.clock.advance(6000);await settleLegacyStart($,f.w)
  expect(afterWakes,'no frame of hers wakes the band while the limit holds').toBe(wakes);expect(everyRequests,'no recurring clock event after the limit').toBe(expiryRequests)
  expect(f.w.blits.length).toBe(blits);expect(f.w.view().pose).toEqual(pose);expect(f.w.view().line?.key).toBe(key);await assertStill()
 }finally{await desktop.unmount();await terminal.unmount()}
})

for(const first of ['failure','complete'] as const)test(`M1 actual register: main rate limit survives ${first}-first order and subagent overload cannot replace it`,async($,on)=>{
 const f=setup(on,{},[{kind:'five_hour',percentUsed:100,resetsAt:new Date(MORNING+3600000).toISOString()}],'on')
 await $.session.start(START);await settleLegacyStart($,f.w)
 await $.turn.start({turnId:'m1-limit',text:'work'})
 const complete=()=>$.turn.complete({turnId:'m1-limit',answer:'',reason:'error',isAborted:false,durationMs:1000})
 const fail=()=>$.classic.StopFailure({error:'rate_limit',cwd:START.cwd,session_id:'fixture-session'})
 if(first==='complete'){await complete();await fail()}else{await fail();await complete()}
 expect(f.w.view().line?.key).toBe('limit.out');expect(f.w.view().frame).toBe('tea-a');expect(f.w.view().spentWindows).toEqual(['five_hour'])
 expect(f.w.view().pose?.aside).toBe(c3Word('en','aside.tea'))
 await $.classic.StopFailure({error:'overloaded',agent_id:'child',cwd:START.cwd,session_id:'fixture-session'})
 expect(f.w.view().line?.key).toBe('limit.out');expect(f.w.view().frame).toBe('tea-a')
 await $.command.run({command:'coco',args:'band text',origin:PERSON,presentation:P})
 for(const [lang,name]of [['zh','小克'],['ja','Coco'],['ko','코코'],['en','Coco']]){
  await $.command.run({command:'coco',args:'lang '+lang,origin:PERSON,presentation:P});const reading=await $.ui.mount({surface:'terminal',...bandRow(100)})
  expect(m1Text(await reading.drawn()).startsWith(name+(lang==='zh'||lang==='ja'?'：':': '))).toBe(true);await reading.unmount()
 }
 await $.classic.StopFailure({error:'overloaded',cwd:START.cwd,session_id:'fixture-session'})
 const overloaded=f.w.view()
 expect(overloaded.frame).toBe('waiting');expect(overloaded.line?.key).toBe('limit.crowded')
 expect(overloaded.line?.text).toBe(gapWord(overloaded.lang,'limit.crowded'))
 expect(overloaded.pose?.aside).toBe(WORDS[overloaded.lang].aside.waiting)
 expect(f.calls).toEqual([])
})

for(const surface of ['terminal','desktop','vscode'] as const)test(`M1 MOD1 actual ${surface} closing stays on final UUID without messages, prompt sections or a second voice`,{options:{band:'on'}},async($,on)=>{
 let recordClosing=false;const closingReads:string[]=[],closingAppends:any[]=[]
 on('session.*',($,e,next)=>{if(recordClosing&&next.is('session.messages',e))closingReads.push('messages');if(recordClosing&&next.is('session.append',e))closingAppends.push(e);return next(e)})
 const f=gapFixture(on,{},surface);await gapBegin($,f.w,surface)
 await $.turn.start({turnId:'closing',text:'edit the file'});await $.tool.call({tool:'Edit',file_path:'/tmp/m1-integration/example.ts',old_string:'old',new_string:'new'})
 // The kit raises this protected engine event but has no native append core.
 // Seed its host transcript separately; only its exact unsupported-core error is tolerated.
 f.messages.push({uuid:'final-close-uuid',role:'assistant',text:'A complete reply.'})
 await $.session.append({door:'response',origin:{kind:'model',model:'test'},uuid:'final-close-uuid',message:{type:'assistant',role:'assistant',content:[{type:'text',text:'A complete reply.'}]}}).catch((error:unknown)=>{if(!String(error).includes('no implementation for session.append'))throw error})
 const messages=JSON.stringify(f.messages),sections=(await $.prompt.compose({...ASK,surfaces:[surface]})).sections;recordClosing=true
 await $.turn.complete({turnId:'closing',answer:'A complete reply.',reason:'answer',isAborted:false,durationMs:64000})
 expect(JSON.stringify(f.messages)).toBe(messages);expect(closingReads).toEqual([]);expect(closingAppends).toEqual([]);expect(JSON.stringify((await $.prompt.compose({...ASK,surfaces:[surface]})).sections)===JSON.stringify(sections)).toBe(true);expect(f.models).toEqual([])
 const held=f.w.cell('close:final-close-uuid')?.value as any;expect(held?.key).toBe('close.work');expect(gapPool('en','close.work')).toContain(held.line)
 const ui=await $.ui.mount({surface,plugin:'coco',component:'AssistantMessage',requestId:'final-close-uuid',props:{text:'A complete reply.',isFirstOfReply:true},viewport:{columns:100,rows:50}})
 const tree=await ui.drawn();expect(m1Nodes(tree,'engine')).toEqual([M1_ENGINE])
 if(surface==='terminal'){expect(m1Nodes(tree,'Box').some(n=>n.props?.key==='coco:close:final-close-uuid')).toBe(false);expect(f.w.view().line?.key).toBe('close.work');expect(f.w.view().line?.text).toBe(held.line)}
 else{expect(m1Nodes(tree,'Box').some(n=>n.props?.key==='coco:close:final-close-uuid')).toBe(true);expect(m1Text(tree)).toContain(held.line);expect(f.w.view().line).toBeUndefined()}
 expect(f.w.view().line?.key==='done'||f.w.view().line?.key==='done_long').toBe(false);await ui.unmount()
})
test('M1 MOD5 cut: TurnDuration is the engine tree with marks off and on, in every language',async($,on)=>{
 const f=gapFixture(on);await gapBegin($,f.w)
 for(const marks of ['off','replies'] as const){
  await $.command.run({command:'coco',args:'marks '+marks,origin:PERSON,presentation:P})
  for(const {code:lang} of LANGS){
   await $.command.run({command:'coco',args:'lang '+lang,origin:PERSON,presentation:P})
   const row=await $.ui.mount({surface:'terminal',plugin:'coco',component:'TurnDuration',requestId:'duration-'+marks+'-'+lang,props:{word:'Baked',durationMs:64000}})
   expect(await row.drawn()).toEqual(M1_ENGINE);await row.unmount()
  }
 }
 expect(gapPool('en','turnDone')).toEqual([]);expect(f.models).toEqual([])
})

test('M1 MOD7 actual descriptions change language, preserve hints and register two free commands',{options:{language:'zh'}},async($,on)=>{
 const f=gapFixture(on),invalidated:string[]=[];on('ui.invalidate',($,e,next)=>{invalidated.push(e.event);return next(e)})
 on('command.describe',($,e)=>({description:e.description,argumentHint:e.argumentHint,isHidden:e.isHidden}));await gapBegin($,f.w)
 const input={command:'coco',description:'engine description',argumentHint:'[unchanged]',isHidden:false,immediate:false,provider:{plugin:'coco',tier:'user' as const}}
 const before=await $.command.describe(input);expect(before.description).toBe(gapWord('zh','cmd.coco'));expect(before.argumentHint).toBe('[unchanged]');expect('command' in before).toBe(false)
 invalidated.length=0;await $.command.run({command:'coco',args:'lang ja',origin:PERSON,presentation:P});expect(invalidated.filter(e=>e==='command.describe').length).toBe(1)
 const after=await $.command.describe(input);expect(after.description).toBe(gapWord('ja','cmd.coco'));expect(after.argumentHint).toBe('[unchanged]');expect('command' in after).toBe(false)
 // One command (owner 10-16): /omen is no longer registered or described.
 expect((await $.command.describe({...input,command:'omen'})).description).toBe('engine description');expect(f.registered.filter(n=>n==='coco'||n==='omen').sort()).toEqual(['coco']);expect(f.registered.some(n=>n.includes(':companion')||n.includes(':icon'))).toBe(false)
})
test('M1 MOD7 actual companion status calls one permission-scoped Bash with zero model work',async($,on)=>{
 const direct:string[][]=[],permission:any[]=[]
 on('fs.exists',{path:'/System/Library/CoreServices/SystemVersion.plist'},()=>({value:true}))
 on('process.*',($,e,next)=>{if(next.is('process.run',e)&&e.argv.some(arg=>arg.endsWith('/bin/companion-macos.sh')))direct.push([...e.argv]);return next(e)})
 on('tool.call',{tool:'Bash'},($,e,next)=>{if(e.command.includes('companion-macos.sh')&&e.command.includes("'install'")){permission.push({tool:e.tool,command:e.command,timeout:e.timeout});return {deny:'person declined installation'}}return next(e)})
 const f=gapFixture(on,{},'terminal',true);await gapBegin($,f.w);f.tools.length=0;await $.command.run({command:'coco',args:'companion status',origin:PERSON,presentation:P})
 expect(f.tools.length).toBe(1);expect(f.tools[0].tool).toBe('Bash');const statusCommand=f.tools[0].command;expect(statusCommand).toMatch(/^'\/usr\/bin\/env' 'PATH=\/usr\/bin:\/bin:\/usr\/sbin:\/sbin' '\/bin\/sh' '[^']+[\\/]bin[\\/]companion-macos\.sh' 'status'$/);expect(f.models).toEqual([])
 await $.command.run({command:'coco',args:COMPANION_PAGE,origin:PERSON,presentation:P})
 const pane=await $.ui.mount({surface:'terminal',...M1_PANE});await f.w.clock.advance(0);await pane.redraw()
 expect(await pane.find({type:'Button',key:'coco:companion:install'})).toBeDefined();expect(permission).toEqual([]);expect(direct).toEqual([])
 await pane.press({key:'coco:companion:install'});await f.w.clock.advance(0);await pane.redraw()
 expect(permission).toEqual([{tool:'Bash',command:statusCommand.replace("'status'","'install' '--report'"),timeout:600000}]);expect(direct).toEqual([]);expect(f.models).toEqual([])
 expect(await pane.find({type:'Text',text:'Claude Code will ask first.'})).toBeDefined();await pane.unmount()
})
for(const placement of ['placed','unplaced','focus-denied'] as const)test(`M1 MOD8 actual book ${placement} focuses its page only after placement`,async($,on)=>{
 const calls:any[]=[];on('ui.*',($,e,next)=>{if(next.is('ui.open',e)){calls.push({api:'open',id:e.id});return {value:{isPlaced:placement!=='unplaced'}}}return next(e)})
 on('ui.focus',($,e)=>{calls.push({api:'focus',requestId:e.requestId,key:e.element});return placement==='focus-denied'?{deny:'composer has focus'}:{}})
 const f=gapFixture(on,{},'vscode')
 await gapBegin($,f.w,'vscode')
 // The SDK does not dispatch $.ui.focus; verify actual placement and target
 // separately from the shared adapter's exact focus request and refusal handling.
 const pane=await $.ui.mount({surface:'vscode',...M1_PANE,props:{...M1_PANE.props,isFocused:true}});calls.length=0;await $.command.run({command:'coco',args:'settings',origin:PERSON,presentation:P})
 expect(calls).toEqual([{api:'open',id:'coco-book'}])
 const targets:string[]=[];await focusBook(placement!=='unplaced','settings',async key=>{targets.push(key);if(placement==='focus-denied')throw Error('composer has focus');return {}})
 expect(targets).toEqual(placement==='unplaced'?[]:['coco:book:tab:settings'])
 await pane.redraw();expect(await pane.find({type:'Button',key:'coco:book:tab:settings'})).toBeDefined();await pane.unmount()
})
for(const response of ['success','skip','refused'] as const)test(`M1 MOD9 actual chapter ${response} clears the note and passes no compact instructions`,{options:{band:'on'}},async($,on)=>{
 const calls:any[]=[],fills:string[]=[]
 on('session.*',($,e,next)=>{if(!next.is('session.compact',e))return next(e);calls.push(e);if(response==='refused')throw Error('unsupported compact');return response==='skip'?{skip:'busy'}:{messages:[SUMMARY],tokensBefore:138000,tokensAfter:20000}})
 on('prompt.fill',($,e)=>{fills.push(e.text);return {isFilled:true}});const f=gapFixture(on,{bandSettings:{voice:'off',voiceChosen:true,notes:true,bookmark:false,guard:false}});await gapBegin($,f.w);await $.turn.start({turnId:'chapter',text:'run tests'});await $.tool.call({tool:'Bash',command:'npm test'});await $.turn.complete({turnId:'chapter',answer:'A complete reply.',reason:'answer',durationMs:1000,isAborted:false})
 const band=await $.ui.mount({surface:'terminal',...bandRow(100)});expect(await band.find({type:'Button',key:'coco:chapter:compact'})).toBeDefined();await band.press({key:'coco:chapter:compact'})
 expect(calls.length).toBe(1);expect(calls[0].instructions).toBeUndefined();expect(calls[0].summarizeInstructions).toBeUndefined();expect(fills).toEqual(response==='refused'?['/compact']:[]);expect(f.w.view().line?.key==='chapter').toBe(false);if(response==='skip')expect(f.w.view().context).toBe(95);await band.unmount()
})
for(const choice of ['keep','light'] as const)test(`M1 MOD2 actual fresh voice card ${choice} keeps authored order and answers in place`,async($,on)=>{
 const f=gapFixture(on,{bandSettings:{voice:'off',notes:false,bookmark:false,guard:false}});await gapBegin($,f.w);expect(f.w.view().voice).toBe('off');expect((await $.prompt.compose(ASK)).sections.map(s=>s.id)).toEqual(['intro'])
 await $.command.run({command:'coco',args:'about',origin:PERSON,presentation:P});const pane=await $.ui.mount({surface:'terminal',...M1_PANE})
 const keys=(await pane.findAll({type:'Button'})).map(b=>b.key),onIndex=keys.indexOf('coco:set:voice:light'),keepIndex=keys.indexOf('coco:first:voice:keep');expect(onIndex).toBeGreaterThanOrEqual(0);expect(keepIndex).toBeGreaterThan(onIndex)
 expect(PLUGIN_MANIFEST.repository).toBe('https://github.com/ninondev/cc-coco')
 for(const surface of ['terminal','desktop','vscode','mobile'] as const){
  const page=surface==='terminal'?pane:await $.ui.mount({surface,...M1_PANE}),tree=await page.drawn(),links=m1Nodes(tree,'Link')
  expect(links.length).toBe(1);expect(links[0].props.href).toBe(PLUGIN_MANIFEST.repository);expect(m1Text(links[0])).toBe('')
  expect(m1Text(tree)).toContain(gapWord('en','him.unofficial'))
  const leafTypes=(value:any):string[]=>!value||typeof value!=='object'?[]:Array.isArray(value)?value.flatMap(leafTypes):value.type==='Box'?leafTypes(value.children):[value.type]
  expect(leafTypes(tree).at(-1)).toBe('Link')
  if(surface!=='terminal')await page.unmount()
 }
 for(const key of ['coco:set:voice:light','coco:first:voice:keep'])expect((await pane.find({type:'Button',key}))?.props.variant).not.toBe('primary')
 const note=await pane.find({type:'Text',text:/tokens per request/});expect(note).toBeDefined();expect(note?.text).not.toContain('{n}')
 await pane.press({key:choice==='keep'?'coco:first:voice:keep':'coco:set:voice:light'});await settleLegacyStart($,f.w);await pane.redraw();expect(f.w.view().voice).toBe(choice==='keep'?'off':'light');expect(await pane.find({type:'Button',key:'coco:first:voice:keep'})).toBeUndefined();if(choice==='light')expect(await pane.find({type:'Button',key:'coco:set:voice:off'})).toBeDefined()
 await pane.unmount();await $.command.run({command:'coco',args:'about',origin:PERSON,presentation:P});const reopened=await $.ui.mount({surface:'terminal',...M1_PANE});expect(await reopened.find({type:'Button',key:'coco:first:voice:keep'})).toBeUndefined();await reopened.unmount()
})
test('M1 MOD7 actual '+(WINDOWS_ROOTS?'Windows icon status skips unsupported native commands':'icon status runs the one icon helper')+' with zero model work',async($,on)=>{
 const native:string[][]=[]
 on('process.*',($,e,next)=>{if(next.is('process.run',e)||next.is('process.spawn',e))native.push([...e.argv]);return next(e)})
 // Main's icon (10-09) asks first: with the app icon off, status only says S9, so this person has turned it on.
 const f=gapFixture(on,{bandSettings:{voice:'off',voiceChosen:true,notes:false,bookmark:false,guard:false,appIcon:'on'}});on('fs.exists',{path:'/System/Library/CoreServices/SystemVersion.plist'},()=>({value:true}));await gapBegin($,f.w);f.tools.length=0;native.length=0
 await $.command.run({command:'coco',args:'icon status',origin:PERSON,presentation:P})
 if(WINDOWS_ROOTS){expect(f.tools).toEqual([]);expect(native).toEqual([])}
 // Main's icon actions (kept at the 10-09 merge) run the helper as a process with a fixed PATH, not as a Bash tool call.
 else{expect(f.tools).toEqual([]);expect(native.filter(argv=>argv[1]?.endsWith('icon-macos.sh')&&argv[2]==='status').length).toBe(1)}
 expect(f.models).toEqual([])
})
test('M1 actual Explain off then on discards old completion without a late book opening or root repaint',async($,on)=>{
 const timeline:{phase:string;event:string;plugin:string|null;key?:string}[]=[];let phase='setup'
 let enter!:()=>void,release!:(reply:any)=>void,record=false;const entered=new Promise<void>(resolve=>{enter=resolve}),answer=new Promise<any>(resolve=>{release=resolve}),late:string[]=[]
 on('ui.*',($,e,next)=>{if(next.is('ui.open',e)||next.is('ui.invalidate',e))timeline.push({phase,event:next.is('ui.open',e)?'ui.open':'ui.invalidate',plugin:next.origin.plugin??null});if(record&&next.is('ui.open',e))late.push('open');if(record&&next.is('ui.invalidate',e))late.push('invalidate');return next(e)})
 const writes=gapStoreWrites(on,undefined,(e,next)=>{timeline.push({phase,event:'store.set',key:e.key,plugin:next.origin.plugin??null})})
 on('state.*',($,e,next)=>{if(record&&next.is('state.set',e))late.push(e.key==='bandWake'?'bandWake':'state');return next(e)})
 const f=gapFixture(on,{more:{explain:true},'more.agreed':['explain']},'terminal',false,()=>{enter();return answer})
 await gapBegin($,f.w);await $.turn.start({turnId:'explain-origin',text:'a question'});await $.turn.complete({turnId:'explain-origin',answer:'The main answer.',reason:'answer',durationMs:1000,isAborted:false})
 await $.command.run({command:'coco',args:'more',origin:PERSON,presentation:P});const pane=await $.ui.mount({surface:'terminal',...M1_PANE}),band=await $.ui.mount({surface:'terminal',...bandRow(200)})
 expect(await band.find({type:'Button',key:'coco:more:explain'})).toBeDefined();const pending=band.press({key:'coco:more:explain'});await entered
 phase='off';await pane.press({key:'coco:more:explain:off'});await pane.redraw();expect(await pane.find({type:'Button',key:'coco:more:explain:on'})).toBeDefined()
 phase='new-on';await pane.press({key:'coco:more:explain:on'});await pane.redraw();expect(await pane.find({type:'Button',key:'coco:more:explain:off'})).toBeDefined();await settleLegacyStart($,f.w)
 phase='old-completion';record=true;release({isAnswered:true,text:'Old rewritten answer.',usage:{input_tokens:11,output_tokens:2,cache_read_input_tokens:0,cache_creation_input_tokens:0}});await pending;await settleLegacyStart($,f.w);record=false
 // Lead, 10-10: the discarded answer still spent tokens, so main's cost line wakes the band (two bandWake writes); no
 // book opening, no invalidate and no other state write may follow.
 expect(late,JSON.stringify(timeline)).toEqual(['bandWake','bandWake']);expect(f.models).toEqual(['model']);expect((writes.get('more.today') as any).rows.explain).toEqual({n:1,tokens:13,cacheRead:0})
 await pane.unmount();await band.unmount()
})
test('M1 A1 actual macOS all More off keeps classic watch paths and never starts a fallback child',{options:{band:'off'}},async($,on)=>{
 const f=gapFixture(on,{},'terminal',true),spawns:string[][]=[]
 on('fs.exists',{path:/^\/tmp\/m1-owned-watch(?:\/|$)|^\/System\/Library\/CoreServices\/SystemVersion\.plist$|^\/usr\/bin\/tail$/},()=>({value:true}))
 on('classic.SessionStart',()=>({}));on('classic.CwdChanged',()=>({}));on('process.spawn',async function*($,e,next){spawns.push([...e.argv]);return yield*next(e)})
 await gapBegin($,f.w)
 const started=await $.classic.SessionStart({session_id:'fixture-session',cwd:START.cwd,source:'startup'}),paths=started.watchPaths??[];expect(paths.length).toBe(1);expect(paths[0]).toBe('/tmp/m1-owned-watch/Library/Application Support/Coco/requests.jsonl')
 await f.w.clock.advance(2000);await settleLegacyStart($,f.w);expect(spawns).toEqual([])
 const moved=await $.classic.CwdChanged({session_id:'fixture-session',cwd:START.cwd,old_cwd:'/tmp/before'});expect(moved.watchPaths).toEqual(paths)
 await f.w.clock.advance(600000);expect(spawns).toEqual([])
})

for(const surface of ['terminal','desktop','vscode'] as const)test(`M1 MOD11 actual Mac ${surface} Settings sound row defaults off, previews once on and persists off`,async($,on)=>{
 const plays:any[]=[],writes=gapStoreWrites(on)
 on('fs.exists',{path:'/System/Library/CoreServices/SystemVersion.plist'},()=>({value:true}))
 on('audio.play',($,e)=>{plays.push({clip:e.clip,gain:e.gain,shouldLoop:e.shouldLoop});return {value:undefined}})
 const f=gapFixture(on,{},surface,true);await gapBegin($,f.w,surface)
 await $.command.run({command:'coco',args:'settings',origin:PERSON,presentation:P})
 const pane=await $.ui.mount({surface,...M1_PANE});await f.w.clock.advance(0);await pane.redraw()
 const sound=(await pane.findAll({type:'Button'})).filter(button=>button.key?.startsWith('coco:set:waitSound:'))
 const approved=JSON.parse(BOOK_FILES['en.json']!).settings
 expect(sound.map(button=>({key:button.key,label:button.props.label}))).toEqual([{key:'coco:set:waitSound:off',label:moreWord('cap.off','en')},{key:'coco:set:waitSound:on',label:moreWord('on','en')}])
 expect(sound[0].props.variant).toBe('primary');expect(sound[1].props.variant).not.toBe('primary')
 expect(await pane.find({type:'Text',text:gapWord('en','settings.sound.label')})).toBeDefined();expect(await pane.find({type:'Text',text:gapWord('en','sound.help')})).toBeDefined()
 const rendered=m1Text(await pane.drawn());expect(rendered.indexOf(approved.reminders)).toBeLessThan(rendered.indexOf(gapWord('en','settings.sound.label')));if(COMPANION_PAGE==='settings')expect(rendered.indexOf(gapWord('en','settings.sound.label'))).toBeLessThan(rendered.indexOf(approved.companion.label))
 for(const lang of ['zh','ja','en']){await $.command.run({command:'coco',args:'lang '+lang,origin:PERSON,presentation:P});await pane.redraw();expect((await pane.find({type:'Button',key:'coco:set:waitSound:off'}))?.props.label).toBe(moreWord('cap.off',lang));expect((await pane.find({type:'Button',key:'coco:set:waitSound:on'}))?.props.label).toBe(moreWord('on',lang));expect(await pane.find({type:'Text',text:gapWord(lang,'settings.sound.label')})).toBeDefined();expect(await pane.find({type:'Text',text:gapWord(lang,'sound.help')})).toBeDefined()}
 expect(plays).toEqual([]);await pane.press({key:'coco:set:waitSound:on'});await settleLegacyStart($,f.w);await pane.redraw()
 expect(plays).toEqual([{clip:{asset:'assets/sound/waiting.wav'},gain:1,shouldLoop:false}]);expect((writes.get('bandSettings') as any).waitSound).toBe(true);expect((await pane.find({type:'Button',key:'coco:set:waitSound:on'}))?.props.variant).toBe('primary')
 await pane.press({key:'coco:set:waitSound:off'});await settleLegacyStart($,f.w);await pane.redraw();expect(plays.length).toBe(1);expect((writes.get('bandSettings') as any).waitSound).toBe(false);expect((await pane.find({type:'Button',key:'coco:set:waitSound:off'}))?.props.variant).toBe('primary');expect(f.models).toEqual([]);await pane.unmount()
})
for(const [platform,surface]of [['linux','terminal'],['windows','desktop'],['mac','mobile']] as const)test(`M1 MOD11 actual ${platform} ${surface} Settings hides the sound choice`,async($,on)=>{
 const plays:any[]=[];on('fs.exists',($,e)=>({value:platform==='mac'&&e.path==='/System/Library/CoreServices/SystemVersion.plist'}));on('audio.play',($,e)=>{plays.push(e.clip);return {value:undefined}})
 const env=platform==='windows'?{OS:'Windows_NT',USERPROFILE:'C:\\Users\\m1-synthetic',LANG:'en_US.UTF-8',TERM:'xterm-256color'}:{HOME:'/tmp/m1-owned-watch',LANG:'en_US.UTF-8',TERM:'xterm-256color'}
 const f=gapFixture(on,{},surface,false,undefined,env);await gapBegin($,f.w,surface);await $.command.run({command:'coco',args:'settings',origin:PERSON,presentation:P})
 const pane=await $.ui.mount({surface,...M1_PANE});await f.w.clock.advance(0);await pane.redraw();expect(await pane.find({type:'Button',key:'coco:book:tab:settings'})).toBeDefined()
 expect((await pane.findAll({type:'Button'})).filter(button=>button.key?.startsWith('coco:set:waitSound:'))).toEqual([]);expect(await pane.find({type:'Text',text:gapWord('en','settings.sound.label')})).toBeUndefined();expect(plays).toEqual([]);expect(f.models).toEqual([]);await pane.unmount()
})

test('M1 MOD11 actual held On preview respects Off, a newer On and lifecycle clear',async($,on)=>{
 const plays:any[]=[];let armed=false,held=false,gate=Promise.resolve(),entered=()=>{},observeChoice=(_value:boolean)=>{}
 on('fs.exists',{path:'/System/Library/CoreServices/SystemVersion.plist'},()=>({value:true}));on('audio.play',($,e)=>{plays.push(e.clip);return {value:undefined}})
 const writes=gapStoreWrites(on,async(e,next)=>{if(next.is('store.delete',e)&&armed&&!held&&e.key==='bookmarks'){held=true;entered();await gate}},(e,next)=>{if(held&&e.key==='bandSettings'&&typeof (e.value as any).waitSound==='boolean')observeChoice((e.value as any).waitSound)})
 const f=gapFixture(on,{},'terminal',true);await gapBegin($,f.w);await $.command.run({command:'coco',args:'settings',origin:PERSON,presentation:P})
 const pane=await $.ui.mount({surface:'terminal',...M1_PANE});await f.w.clock.advance(0);await pane.redraw();expect(await pane.find({type:'Button',key:'coco:set:waitSound:on'})).toBeDefined()
 const arm=()=>{armed=true;held=false;let resume!:()=>void;gate=new Promise<void>(resolve=>{resume=resolve});const atGate=new Promise<void>(resolve=>{entered=resolve});return {atGate,release:()=>{armed=false;resume()}}}
 const choiceWritten=(expected:boolean)=>new Promise<void>(resolve=>{observeChoice=value=>{if(value===expected)resolve()}})
 const settle=async(jobs:Promise<unknown>[])=>{const outcomes=await Promise.allSettled(jobs);for(const outcome of outcomes)if(outcome.status==='rejected')throw outcome.reason}
 const first=arm(),oldOn=pane.press({key:'coco:set:waitSound:on'});let off:Promise<unknown>|undefined
 try{await first.atGate;const offWritten=choiceWritten(false);off=pane.press({key:'coco:set:waitSound:off'});await offWritten}finally{first.release();await settle([oldOn,...(off?[off]:[])])}
 expect(plays).toEqual([]);expect((writes.get('bandSettings') as any).waitSound).toBe(false)
 const second=arm(),olderOn=pane.press({key:'coco:set:waitSound:on'});let newerOff:Promise<unknown>|undefined,newerOn:Promise<unknown>|undefined
 try{await second.atGate;const offWritten=choiceWritten(false);newerOff=pane.press({key:'coco:set:waitSound:off'});await offWritten;const onWritten=choiceWritten(true);newerOn=pane.press({key:'coco:set:waitSound:on'});await onWritten}finally{second.release();await settle([olderOn,...(newerOff?[newerOff]:[]),...(newerOn?[newerOn]:[])])}
 expect(plays).toEqual([{asset:'assets/sound/waiting.wav'}]);expect((writes.get('bandSettings') as any).waitSound).toBe(true)
 const third=arm(),beforeClear=pane.press({key:'coco:set:waitSound:on'})
 try{await third.atGate;await $.command.run({command:'clear',args:'',origin:PERSON,presentation:P})}finally{third.release();await beforeClear}
 expect(plays).toEqual([{asset:'assets/sound/waiting.wav'}]);expect(f.models).toEqual([]);await pane.unmount()
})

test('M1 MOD11 actual Off cancels a held notification before its own settings await completes',async($,on)=>{
 const plays:any[]=[];let holdNotice=false,holdOff=false,offHeld=false,noticeEntered!:()=>void,offEntered!:()=>void,releaseNotice!:()=>void,releaseOff!:()=>void
 const noticeGate=new Promise<void>(resolve=>{releaseNotice=resolve}),offGate=new Promise<void>(resolve=>{releaseOff=resolve}),noticeWaiting=new Promise<void>(resolve=>{noticeEntered=resolve}),offWaiting=new Promise<void>(resolve=>{offEntered=resolve})
 on('fs.exists',{path:'/System/Library/CoreServices/SystemVersion.plist'},()=>({value:true}));on('audio.play',($,e)=>{plays.push(e.clip);return {value:undefined}});on('classic.Notification',()=>({}))
 const writes=gapStoreWrites(on,async(e,next)=>{if(next.is('store.get',e)&&holdNotice&&e.key==='waitSoundAt'){noticeEntered();await noticeGate}if(next.is('store.delete',e)&&holdOff&&!offHeld&&e.key==='bookmarks'){offHeld=true;offEntered();await offGate}})
 const f=gapFixture(on,{bandSettings:{voice:'off',voiceChosen:true,notes:false,bookmark:false,guard:false,waitSound:true}},'terminal',true);await gapBegin($,f.w);await $.command.run({command:'coco',args:'settings',origin:PERSON,presentation:P})
 const pane=await $.ui.mount({surface:'terminal',...M1_PANE});await f.w.clock.advance(0);await pane.redraw();expect((await pane.find({type:'Button',key:'coco:set:waitSound:on'}))?.props.variant).toBe('primary');expect(plays).toEqual([])
 holdNotice=true;const notification=$.classic.Notification({session_id:'fixture-session',cwd:START.cwd,notification_type:'elicitation_dialog',message:'fixture question waiting'});let off:Promise<unknown>|undefined,beforeOffFinished:any[]=[]
 try{await noticeWaiting;holdOff=true;off=pane.press({key:'coco:set:waitSound:off'});await offWaiting;await pane.redraw();expect((await pane.find({type:'Button',key:'coco:set:waitSound:off'}))?.props.variant).toBe('primary');releaseNotice();await notification;beforeOffFinished=[...plays]}finally{releaseNotice();releaseOff();const outcomes=await Promise.allSettled([notification,...(off?[off]:[])]);for(const outcome of outcomes)if(outcome.status==='rejected')throw outcome.reason}
 expect(beforeOffFinished).toEqual([]);expect(plays).toEqual([]);expect((writes.get('bandSettings') as any).waitSound).toBe(false);expect(f.models).toEqual([]);await pane.unmount()
})

test('M1 MOD11 actual consecutive permission waits settle by tool identity despite classic requests',async($,on)=>{
 const plays:any[]=[]
 on('fs.exists',{path:'/System/Library/CoreServices/SystemVersion.plist'},()=>({value:true}));on('audio.play',($,e)=>{plays.push(e.clip);return {value:undefined}});on('classic.Notification',()=>({}));on('classic.PermissionRequest',()=>({}))
 on('tool.check',{tool:'Read'},()=>({decision:'ask'}))
 on('tool.call',{tool:'Read'},async(_hookEngine,e,next)=>{
  if(e.tool!=='Read')return next(e)
  await $.tool.check({tool:'Read',input:{file_path:e.file_path},tool_use_id:e.tool_use_id})
  await $.classic.PermissionRequest({tool_name:'Read',tool_input:{file_path:e.file_path}})
  for(let i=0;i<2;i++)await $.classic.Notification({session_id:'fixture-session',cwd:START.cwd,notification_type:'permission_prompt',message:'fixture permission waiting'})
  return next(e)
 })
 const f=gapFixture(on,{bandSettings:{voice:'off',voiceChosen:true,notes:false,bookmark:false,guard:false,waitSound:true}},'terminal',true);await gapBegin($,f.w);await $.turn.start({turnId:'permission-sound',text:'read both files'})
 await $.tool.call({tool:'Read',file_path:START.cwd+'/first.ts'});expect(plays).toEqual([{asset:'assets/sound/waiting.wav'}])
 await f.w.clock.advance(31000)
 await $.classic.Notification({session_id:'fixture-session',cwd:START.cwd,notification_type:'permission_prompt',message:'fixture settled permission'});expect(plays.length).toBe(1)
 await $.tool.call({tool:'Read',file_path:START.cwd+'/second.ts'});expect(plays).toEqual([{asset:'assets/sound/waiting.wav'},{asset:'assets/sound/waiting.wav'}]);expect(f.models).toEqual([])
})

test('M1 MOD11 actual session end cancels a notification held before its store read completes',async($,on)=>{
 const plays:any[]=[];let hold=false,entered!:()=>void,release!:()=>void
 const gate=new Promise<void>(resolve=>{release=resolve}),waiting=new Promise<void>(resolve=>{entered=resolve})
 on('fs.exists',{path:'/System/Library/CoreServices/SystemVersion.plist'},()=>({value:true}));on('audio.play',($,e)=>{plays.push(e.clip);return {value:undefined}});on('classic.Notification',()=>({}));on('session.end',()=>({sessionId:'fixture-session'}))
 const writes=gapStoreWrites(on,async(e,next)=>{if(next.is('store.get',e)&&hold&&e.key==='waitSoundAt'){entered();await gate}})
 const f=gapFixture(on,{bandSettings:{voice:'off',voiceChosen:true,notes:false,bookmark:false,guard:false,waitSound:true}},'terminal',true);await gapBegin($,f.w)
 hold=true;const notification=$.classic.Notification({session_id:'fixture-session',cwd:START.cwd,notification_type:'elicitation_dialog',message:'fixture question waiting'})
 try{await waiting;await $.session.end({reason:'prompt_input_exit'} as never)}finally{release();await notification}
 expect(plays).toEqual([]);expect(writes.has('waitSoundAt')).toBe(false);expect(f.models).toEqual([])
})

test('M1 MOD1 actual cold activation restores a final UUID distinct from its head with no row state or message reads',{options:{band:'off'}},async($,on)=>{
 const id='cold-final-not-head',line=gapPool('en','close.work')[0],closing={line,lang:'en',key:'close.work'},reads:string[]=[];let recording=false
 on('state.*',($,e,next)=>{if(recording&&next.is('state.get',e)&&e.id!==undefined)reads.push('state:'+e.key+':'+e.id);return next(e)})
 on('session.*',($,e,next)=>{if(recording&&next.is('session.messages',e))reads.push('messages');return next(e)})
 const f=gapFixture(on,{closings:[[id,closing]],heads:[['cold-first-head','happy',MORNING-1000,64000]]},'desktop');await gapBegin($,f.w,'desktop');expect(f.w.cell('close:'+id)).toBeUndefined()
 recording=true
 const row=await $.ui.mount({surface:'desktop',plugin:'coco',component:'AssistantMessage',requestId:id,props:{text:'Stored final reply.',isFirstOfReply:false},viewport:{columns:100,rows:50}})
 for(let i=0;i<2;i++){const tree=await row.drawn();expect(m1Nodes(tree,'engine')).toEqual([M1_ENGINE]);expect(m1Nodes(tree,'Box').filter(node=>node.props?.key==='coco:close:'+id).length).toBe(1);expect(m1Nodes(tree,'Text').filter(node=>m1Text(node)===line).length).toBe(1);await row.redraw()}
 const current=await $.ui.mount({surface:'desktop',plugin:'coco',component:'AssistantMessage',requestId:'unrecorded-current-reply',props:{text:'Current reply.',isFirstOfReply:false},viewport:{columns:100,rows:50}});expect(await current.drawn()).toEqual(M1_ENGINE);expect(reads).toEqual([]);expect(f.models).toEqual([]);await row.unmount();await current.unmount()
})


// The observer's independently scanned prepend hook dispatches the actual shared reading.
// This source is self-contained: no closure values, fake reading or test engine passed into hooks.
const M1_HELD_USAGE_OBSERVER:Plugin={name:'m1-held-usage-observer',tier:'prepend',register(on){
 on('command.run',{command:'coco'},async($,e,next)=>{
  if(e.args!=='m1-test-held-usage')return next(e)
  await $.session.usage()
  return {}
 })
}}
for(const route of ['open','observer'] as const)test(`M1 Book actual pushed measurement survives a held ${route} usage read`,{plugins:route==='observer'?[M1_HELD_USAGE_OBSERVER]:[]},async($,on)=>{
 let holdNext=false,release=()=>{},entered=()=>{}
 const held=new Promise<void>(resolve=>{release=resolve}),began=new Promise<void>(resolve=>{entered=resolve})
 on('session.*',async(_hook,e,next)=>{
  if(!next.is('session.usage',e))return next(e)
  const hold=holdNext;holdNext=false
  const result=await next(e)
  if(hold){entered();await held}
  return result
 })
 const f=gapFixture(on,{},'vscode')
 f.w.limits=[{kind:'five_hour',percentUsed:40,resetsAt:new Date(MORNING+60000).toISOString()}]
 await gapBegin($,f.w,'vscode')
 await $.command.run({command:'coco',args:'usage',origin:PERSON,presentation:P})
 const pane=await $.ui.mount({surface:'vscode',...M1_PANE,props:{...M1_PANE.props,isFocused:true}})
 // the quota page draws her battery (5 hours) and power bank (the week), 24 high, where the sticks stood (lane C, 10-14)
 const sticks=async()=> (await pane.findAll({type:'Svg'})).filter(node=>node.props.height===24&&(node.props.width===52||node.props.width===44))
 expect((await sticks()).length).toBe(1)
 holdNext=true
 const pending=$.command.run({command:'coco',args:route==='open'?'usage':'m1-test-held-usage',origin:PERSON,presentation:P})
 try{
  await Promise.race([began,pending.then(()=>{throw Error('Expected the actual usage read to be held')})])
  f.w.limits=[]
  await $.session.measure({context:{window:200000,tokens:40000,percent:20},rateLimits:[],changed:['rateLimits']})
  await pane.redraw();expect(await sticks()).toEqual([])
  expect(await pane.find({type:'Text',text:JSON.parse(BOOK_FILES['en.json']!).offerings.noLimits})).toBeDefined()
  release();await pending;await settleLegacyStart($,f.w);await pane.redraw()
  expect(await sticks()).toEqual([])
  expect(await pane.find({type:'Text',text:JSON.parse(BOOK_FILES['en.json']!).offerings.noLimits})).toBeDefined()
 }finally{release();await pending;await pane.unmount()}
})

test('M1 MOD3 actual Offerings keeps the spent stick, authored note and reset alt across surfaces and missing readings',async($,on)=>{
 on('classic.StopFailure',()=>({}))
 const f=gapFixture(on,{},'desktop'),resetsAt=new Date(MORNING+3600000).toISOString()
 await gapBegin($,f.w,'desktop')
 const windows=[{kind:'five_hour',percentUsed:100,resetsAt},{kind:'seven_day',percentUsed:40,resetsAt:new Date(MORNING+7*86400000).toISOString()}]
 f.w.limits=windows
 await $.session.measure({context:{window:200000,tokens:40000,percent:20},rateLimits:windows,changed:['rateLimits']})
 await $.classic.StopFailure({error:'rate_limit',session_id:'fixture-session',cwd:START.cwd})
 await $.command.run({command:'coco',args:'usage',origin:PERSON,presentation:P})
 const assertSpent=async(surface:'terminal'|'desktop'|'vscode'|'mobile',lang:'en'|'zh',expectedSticks:number)=>{
  const pane=await $.ui.mount({surface,...M1_PANE}),time=momentText(Date.parse(resetsAt),MORNING,lang,'UTC')
  expect(await pane.find({type:'Text',text:gapFill(lang,'offerings.out',{time})})).toBeDefined()
  expect((await pane.findAll({type:'Text',text:time})).some(node=>node.text===time&&node.props.bold===true)).toBe(true)
  if(surface!=='terminal'){
   const sticks=(await pane.findAll({type:'Svg'})).filter(node=>node.props.height===24&&(node.props.width===52||node.props.width===44))
   const view=f.w.view(),limitSnapshot={spentWindows:[...(view.spentWindows??[])],spentResets:{...(view.spentResets??{})},rateLimits:(view.quota?.rateLimits??[]).map(window=>({kind:window.kind,percentUsed:window.percentUsed,resetsAt:window.resetsAt??null})),lineKey:view.line?.key??null}
   const publicSources=sticks.map((node,index)=>({index,width:node.props.width,height:node.props.height,alt:node.props.alt,sourceType:typeof node.props.source,source:String(node.props.source)}))
   const drawnSources=m1Nodes(await pane.drawn(),'Svg').filter(node=>node.props?.width===12&&node.props?.height===26).map((node,index)=>({index,alt:node.props.alt,sourceType:typeof node.props.source,source:String(node.props.source)}))
   console.log('M1_MOD3_PUBLIC_DIAGNOSTIC '+JSON.stringify({phase:'before-stick-count',surface,lang,expectedSticks,limitSnapshot,publicSources,drawnSources}))
   expect(sticks.length).toBe(expectedSticks)
   // the spent window is her battery drawn empty under the bolt
   const ash=sticks.filter(node=>String(node.props.source)===quotaPixelSvg(quotaBatteryRows(0,true)))
   console.log('M1_MOD3_PUBLIC_DIAGNOSTIC '+JSON.stringify({phase:'before-ash-count',surface,lang,limitSnapshot,ashCount:ash.length,ashSourceIndexes:publicSources.filter(node=>node.source===quotaPixelSvg(quotaBatteryRows(0,true))).map(node=>node.index),sameSource:publicSources.length===2&&publicSources[0]!.source===publicSources[1]!.source,publicSources}))
   expect(ash.length).toBe(1)
   expect(ash[0].props.alt).toBe(gapFill(lang,'alt.incense.out',{window:JSON.parse(BOOK_FILES[lang+'.json']!).offerings.kinds.five_hour,time}))
   const source=String(ash[0].props.source)
   expect(source).not.toContain('class="ash"')
   expect(source).toContain('forced-color-adjust:none');expect(source).toContain('(prefers-contrast:more)');expect(source).toContain('(forced-colors:active)')
   expect(source).not.toContain('class="hot"');expect(source).not.toContain('class="k"');expect(source).not.toContain('fill="#E5562E"')
  }
  await pane.unmount()
 }
 for(const lang of ['en','zh'] as const){
  await $.command.run({command:'coco',args:'lang '+lang,origin:PERSON,presentation:P})
  for(const surface of ['terminal','desktop','vscode','mobile'] as const)await assertSpent(surface,lang,2)
 }
 f.w.limits=[];await $.session.measure({context:{window:200000,tokens:40000,percent:20},rateLimits:[],changed:['rateLimits']})
 await assertSpent('desktop','zh',1)
 await $.turn.start({turnId:'after-limit',text:'resume'});const restored=[{kind:'five_hour',percentUsed:99,resetsAt}];f.w.limits=restored
 await $.session.measure({context:{window:200000,tokens:40000,percent:20},rateLimits:restored,changed:['rateLimits']})
 const normal=await $.ui.mount({surface:'desktop',...M1_PANE})
 console.log('M1_MOD3_PUBLIC_DIAGNOSTIC '+JSON.stringify({phase:'before-restored-no-ash',surface:'desktop',lang:'zh',limitSnapshot:{spentWindows:f.w.view().spentWindows??[],spentResets:f.w.view().spentResets??{},rateLimits:(f.w.view().quota?.rateLimits??[]).map(window=>({kind:window.kind,percentUsed:window.percentUsed,resetsAt:window.resetsAt??null})),lineKey:f.w.view().line?.key??null},publicSources:(await normal.findAll({type:'Svg'})).filter(node=>node.props.width===12&&node.props.height===26).map((node,index)=>({index,alt:node.props.alt,sourceType:typeof node.props.source,source:String(node.props.source)}))}))
 expect((await normal.findAll({type:'Svg'})).filter(node=>String(node.props.source)===quotaPixelSvg(quotaBatteryRows(0,true)))).toEqual([])
 expect(await normal.find({type:'Text',text:gapFill('zh','offerings.out',{time:momentText(Date.parse(resetsAt),MORNING,'zh','UTC')})})).toBeUndefined()
 expect(f.models).toEqual([]);await normal.unmount()
})


for(const isShown of [true,false])test('M1 MOD4 actual bookmark suggestion isShown '+isShown+' preserves the whole prompt without fill, submit or retry',async($,on)=>{
 const suggestions:{text:string;origin:any}[]=[],fills:any[]=[],submits:any[]=[]
 on('session.*',($,e,next)=>next.is('session.turns',e)?{value:0}:next(e))
 on('prompt.*',($,e,next)=>{if(next.is('prompt.suggest',e)){suggestions.push({text:e.text,origin:e.origin});return {isShown}}if(next.is('prompt.fill',e)){fills.push(e);return {isFilled:true}}if(next.is('prompt.submit',e)){submits.push(e);return {text:e.text}}return next(e)})
 const bookmark={where:'src/parser.ts and its complete remaining task',kind:'todo' as const,at:MORNING-86400000}
 const project=WINDOWS_ROOTS?'C:\\Users\\windows\\project':START.cwd
 const f=gapFixture(on,{bookmarks:{[project]:bookmark},bandSettings:{voice:'off',voiceChosen:true,band:'on',notes:false,bookmark:true,guard:false}})
 await gapBegin($,f.w)
 expect(suggestions).toEqual([{text:gapFill('en','bookmark.suggest.todo',{where:bookmark.where}),origin:{kind:'plugin',name:'coco'}}]);expect(fills).toEqual([]);expect(submits).toEqual([])
 const band=await $.ui.mount({surface:'terminal',...bandRow(100)})
 for(let i=0;i<2;i++){await band.redraw();await f.w.clock.advance(60000);await settleLegacyStart($,f.w)}
 await $.command.run({command:'coco',args:'settings',origin:PERSON,presentation:P});await settleLegacyStart($,f.w)
 expect(suggestions.length).toBe(1);expect(fills).toEqual([]);expect(submits).toEqual([]);expect(f.models).toEqual([]);await band.unmount()
})
test('M1 MOD6 actual environment and manual Text bands have the same full tree',async($,on)=>{
 let screenReader:string|undefined='1'
 on('env.get',{name:'CLAUDE_AX_SCREEN_READER'},()=>({value:screenReader}));on('classic.StopFailure',()=>({}));on('classic.ConfigChange',()=>({}))
 const f=gapFixture(on,{bandSettings:{voice:'off',voiceChosen:true,band:'on',notes:false,bookmark:false,guard:false}})
 await gapBegin($,f.w);await $.classic.StopFailure({error:'rate_limit',cwd:START.cwd,session_id:'fixture-session'})
 expect(f.w.view().line?.key).toBe('limit.wait')
 const band=await $.ui.mount({surface:'terminal',...bandRow(100)}),environmentTree=await band.drawn(),lineId=f.w.view().line?.id
 expect(m1Text(environmentTree)).toBe('Coco: '+gapWord('en','limit.wait'));expect(m1Nodes(environmentTree,'Text').length).toBe(1)
 for(const type of ['Raster','Image','Svg'])expect(m1Nodes(environmentTree,type)).toEqual([])
 const hasBorder=(value:any):boolean=>!!value&&typeof value==='object'&&(Object.hasOwn(value,'borderStyle')||Object.values(value).some(hasBorder))
 expect(hasBorder(environmentTree)).toBe(false)
 await $.command.run({command:'coco',args:'band text',origin:PERSON,presentation:P});screenReader=undefined
 await $.classic.ConfigChange({source:'user_settings'});await settleLegacyStart($,f.w);await band.redraw()
 expect(f.w.view().band).toBe('text');expect(f.w.view().line?.id).toBe(lineId);expect(await band.drawn()).toEqual(environmentTree);expect(f.models).toEqual([]);await band.unmount()
})
test('M1 MOD10 actual ToolResult marks only the run that turns red to green and leaves every other call the engine tree',async($,on)=>{
 let outcome:'pass'|'fail'='pass'
 on('process.*',($,e,next)=>{
  if(!next.is('process.run',e))return next(e)
  let request:any;try{request=JSON.parse(e.init?.stdin??'{}')}catch{return next(e)}
  if(request?.op!=='recognize'&&request?.op!=='finish')return next(e)
  const result=request.op==='recognize'?(request.command==='npm test'?{kind:'test',tool:'npm',key:'npm test'}:null):{parsed:{outcome},slowness:{slow:false},history:{[request.key]:[{ms:request.ms,outcome}]}}
  return {value:{exitCode:0,stdout:JSON.stringify({ok:true,result}),stderr:'',isStdoutTruncated:false,isStderrTruncated:false}}
 })
 const f=gapFixture(on,{bandSettings:{voice:'off',voiceChosen:true,band:'on',notes:true,bookmark:false,guard:false}})
 await gapBegin($,f.w);await $.turn.start({turnId:'run-mark',text:'run the checks'})
 for(const [verdict,marked] of [['pass',false],['fail',false],['pass',true],['pass',false],['unknown',false]] as const){
  outcome=verdict==='fail'?'fail':'pass';f.w.fails=verdict==='fail'
  const command=verdict==='unknown'?'printf fixture':'npm test',result=await $.tool.call({tool:'Bash',command}),call=f.tools.at(-1)!
  expect(call.tool).toBe('Bash');expect(call.command).toBe(command);expect(typeof call.tool_use_id).toBe('string')
  for(const surface of ['terminal','desktop','vscode','mobile'] as const){
   const row=await $.ui.mount({surface,plugin:'coco',component:'ToolResult',requestId:call.tool_use_id,props:{tool_use_id:call.tool_use_id,tool:'Bash',output:result.result,isErrored:verdict==='fail'}}),tree:any=await row.drawn()
   if(!marked)expect(tree).toEqual(M1_ENGINE)
   else{
    expect(tree.type).toBe('Box');expect(tree.children[0]).toEqual(M1_ENGINE);expect(m1Nodes(tree,'engine')).toEqual([M1_ENGINE])
    expect(m1Nodes(tree,'Box').filter(node=>node.props?.key==='coco:run:'+call.tool_use_id).length).toBe(1)
    expect(m1Text(tree)).toContain(gapWord('en','run.passed'))
    if(surface==='terminal'){expect(m1Text(tree)).toContain('✿');expect(m1Nodes(tree,'Box').find(node=>node.props?.key==='coco:run:'+call.tool_use_id).props.paddingLeft).toBe(5)}
    else expect(m1Nodes(tree,'Svg')[0].props.source).toContain('class="p"')
   }
   await row.unmount()
  }
 }
 expect(f.models).toEqual([])
})
