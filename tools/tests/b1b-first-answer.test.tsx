import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { initialView } from '../hooks/mood'
import { LANGS, WORDS } from '../hooks/words'
import * as COCO_FIXTURE from './coco-band-data'
const COCO_BAND=(COCO_FIXTURE as {COCO_BAND_TEXT?:Record<string,string>}).COCO_BAND_TEXT??{}
import { PLUGIN_SOURCES } from './plugin-sources'
import { BOOK_FILES } from './book-files'
import { completeBookClose } from '../hooks/pages'
import { desktopPicture } from './world'
const NOW=Date.UTC(2026,9,4,10,0)
const START={cwd:'/tmp/b1b-first-answer',surface:'desktop' as const,isInteractive:true}
const REQUEST={plugin:'coco',component:'AbovePrompt' as const,surface:'desktop' as const,props:{hasSurvey:false,isWorking:false,maxRows:30,bodyColumns:100,scroll:{offset:0,bodyRows:30},view:{}},viewport:{columns:100,rows:48}}
type Options={hang?:string;throwAt?:string;initial?:unknown;settingsNull?:boolean;nextTree?:unknown;storeRecord?:unknown;label?:string;pictureGate?:Promise<void>;gateBook?:boolean;reduced?:boolean;bookFiles?:boolean}
function fixture(on:On,option:Options={}){
 const storeWrites:{key:string;value:unknown}[]=[]
 const calls:string[]=[],spans:{step:string;ms:number}[]=[]
 const frozen=new Promise<void>(()=>{})
 const clock=mock.clock(on,{now:NOW})
 const cells=new Map<string,{value:unknown;version:number}>()
 if(option.initial!==undefined)cells.set('view',{value:option.initial,version:1})
 const step=async<T,>(name:string,answer:()=>T)=>{const at=Date.now();calls.push(name);try{if(option.throwAt===name)throw Error('injected:'+name);if((name==='fs.read:coco'||option.gateBook&&name==='fs.read:book')&&option.pictureGate)await option.pictureGate;if(option.hang===name||option.hang==='store'&&name.startsWith('store.get:'))await frozen;return answer()}finally{spans.push({step:name,ms:Date.now()-at})}}
 on('state.get',async($,e,next)=>{await next(e);return step('state.get:'+e.key,()=>({value:cells.get(e.key)??{value:undefined,version:0}}) as never)})
 on('state.set',async($,e,next)=>{const result=await step('state.set',()=>{const version=(cells.get(e.key)?.version??0)+1;cells.set(e.key,{value:e.value,version});return{value:{isSet:true,version}}});await next(e);return result})
 on('store.get',($,e)=>step('store.get:'+e.key,()=>({value:e.key==='bandSettings'?option.storeRecord:e.key==='lastActive'?NOW-60000:undefined})))
 on('store.set',($,e)=>{storeWrites.push({key:e.key,value:e.value});return{value:undefined}})
 on('settings.read',()=>step('settings.read',()=>({value:option.settingsNull?null:{timeZone:'UTC',prefersReducedMotion:option.reduced}}) as never))
 on('env.get',($,e)=>step('env.get:'+e.name,()=>({value:e.name==='LANG'?'en_US.UTF-8':undefined})))
 on('session.id',()=>step('session.id',()=>({value:'b1b-kit-session'})))
 on('session.root',()=>step('session.root',()=>({value:START.cwd})))
 on('session.surfaces',()=>({value:['desktop']}))
 on('session.usage',()=>step('session.usage',()=>({value:{startedAt:0,context:{window:200000,percent:20,tokens:40000},rateLimits:[]}})))
 on('fs.exists',()=>({value:false}))
 on('fs.read',($,e)=>{
  const coco=/[\\/]assets[\\/]coco[\\/]band-([AB])\.json$/.exec(e.path)
  if(coco)return step('fs.read:coco',()=>({value:COCO_BAND[coco[1]!]??'{}'}))
  const book=option.bookFiles&&/[\\/]book[\\/]([\w-]+\.json)$/.exec(e.path)
  if(book)return step('fs.read:book',()=>({value:BOOK_FILES[book[1]!]??'{}'}))
  return{value:'{}'}
 })
 on('command.register',($,e)=>step('command.register',()=>({value:{command:e.name}})))
 on('ui.render',()=>step('next.render',()=>option.nextTree===undefined?<></>:option.nextTree as never))
 on('session.start',($,e)=>({cwd:e.cwd}))
 on('session.attach',($,e)=>({clientId:e.clientId}))
 on('command.run',()=>({text:''}))
 on('config.set',($,e)=>({value:e.value}))
 on('ui.toast',()=>({value:undefined}))
 on('ui.log',($,e)=>{if(e.text.startsWith('B1B_PATH_METER ')){const value=JSON.parse(e.text.slice('B1B_PATH_METER '.length));console.log('B1B_PATH_METER '+JSON.stringify({...value,scenario:option.label??'matrix'}))}else console.log(e.text);return{}})
 return{calls,spans,clock,storeWrites}
}
async function visible($:any,req:any=REQUEST){const at=Date.now();const ui=await $.ui.mount(req);expect(await ui.find({type:'Text',text:'Coco'})).toBeDefined();return{ui,ms:Date.now()-at}}
function metric(f:ReturnType<typeof fixture>,extra:object={}){console.log('B1b kit metric '+JSON.stringify({scope:'isolated engine kit; wall time includes host round trip; seam ms is mock-handler own time',...extra,calls:f.calls,spans:f.spans}))}
async function desktopWorkerBoundary($:any,f:ReturnType<typeof fixture>){
 await f.clock.advance(0)
 for(let i=0;i<16;i++)await $.command.run({command:'b1b-host-boundary',args:'',origin:{kind:'composer'},presentation:{isFullscreen:false,columns:100}})
 await f.clock.advance(0)
 for(let i=0;i<4;i++)await $.command.run({command:'b1b-host-boundary',args:'',origin:{kind:'composer'},presentation:{isFullscreen:false,columns:100}})
}
async function animatedSource(ui:any){return String((await desktopPicture(ui))?.props.source)}

describe('B1b synchronous desktop first answer',()=>{
 for(const band of ['on','compact','off'] as const)test('cold options select '+band+' before pending store',{options:{band,language:'en'},timeoutMs:10000},async($,on)=>{
  fixture(on,{hang:'store'});const ui=await $.ui.mount(REQUEST)
  if(band==='off'){expect(await ui.find({type:'Button',key:'coco:band:wake'})).toBeDefined();expect(await ui.find({type:'Button',key:'coco:band:poke'})).toBeUndefined()}
  else {expect((await desktopPicture(ui))?.props.height).toBe(band==='compact'?32:64);expect(await ui.find({type:'Text',text:'Coco'})).toBeDefined()}
 })
 for(const {code} of LANGS)test('cold options select '+code+' before pending settings',{options:{band:'on',language:code},timeoutMs:10000},async($,on)=>{
  fixture(on,{hang:'settings.read'});const ui=await $.ui.mount(REQUEST);expect(await ui.find({type:'Text',text:WORDS[code].name})).toBeDefined()
 })
 test('auto uses synchronously supplied resolvedLanguage',{options:{band:'on',language:'auto',resolvedLanguage:'ja'},timeoutMs:10000},async($,on)=>{fixture(on,{hang:'settings.read'});const ui=await $.ui.mount(REQUEST);expect(await ui.find({type:'Text',text:WORDS.ja.name})).toBeDefined()})
 test('resolvedLanguage config row can be hidden while remaining addressable',async($,on)=>{
  fixture(on);const result=await $.config.describe({key:'coco.resolvedLanguage',label:'TODO-WORDS',description:'TODO-WORDS',isHidden:false,provider:{plugin:'coco',tier:'user'}})
  expect(result.isHidden).toBe(true)
 })

 test('healthy cold first answer',async($,on)=>{const f=fixture(on),r=await visible($);metric(f,{firstAnswerMs:r.ms})})
 for(const hang of ['state.get:view','settings.read','store','next.render','session.id'])test('pending '+hang+' cannot delay cold desktop',{timeoutMs:10000},async($,on)=>{const f=fixture(on,{hang});await visible($);metric(f,{pending:hang})})
 for(const throwAt of ['state.get:view','settings.read','next.render'])test('throw '+throwAt+' leaves identity',async($,on)=>{fixture(on,{throwAt});await visible($)})
 for(const [name,initial] of [['null',null],['language',{...initialView(),lang:'xx'}],['mood',{...initialView(),mood:'not-a-mood'}],['frame',{...initialView(),frame:'not-a-frame'}],['Text 10001',{...initialView(),said:'a'.repeat(10001)}],['control',{...initialView(),said:'hello\u0001there'}]] as const)test('restored '+name+' normalizes to valid identity',async($,on)=>{fixture(on,{initial});await $.session.start(START);for(let i=0;i<4;i++)await $.command.run({command:'b1b-host-boundary',args:'',origin:{kind:'composer'},presentation:{isFullscreen:false,columns:100}});await visible($)})
 test('successful null settings do not poison first answer',async($,on)=>{fixture(on,{settingsNull:true});await visible($)})
 test('failed hydration can recover on desktop attachment',async($,on)=>{
  const option:Options={throwAt:'settings.read'},f=fixture(on,option)
  await $.session.start(START);await visible($)
  option.throwAt=undefined
  await $.session.attach({clientId:'b1b-desktop',surface:'desktop'})
  await visible($)
  for(let i=0;i<20&&f.calls.filter(x=>x==='settings.read').length<2;i++)await $.command.run({command:'b1b-host-boundary',args:'',origin:{kind:'composer'},presentation:{isFullscreen:false,columns:100}})
  expect(f.calls.filter(x=>x==='settings.read').length).toBe(2)
 })
 for(const [name,nextTree] of [['Bogus',{type:'Bogus',props:{},children:[]}],['oversize Text',{type:'Text',props:{},children:['a'.repeat(10001)]}],['control Text',{type:'Text',props:{},children:['hello\u0001there']}],['oversize Svg',{type:'Svg',props:{source:'x'.repeat(131073),width:64,height:64},children:[]}],['oversize Markdown image',{type:'Markdown',props:{text:'![x](data:image/png;base64,'+'a'.repeat(10001)+')'},children:[]}],['Client',{type:'Client',props:{module:'./none.tsx'},children:[]}]] as const)test('invalid downstream '+name+' cannot erase identity',async($,on)=>{fixture(on,{nextTree});await visible($)})
 test('cold render performs no asynchronous host or downstream calls',async($,on)=>{
  const f=fixture(on);await visible($)
  const forbidden=f.calls.filter(x=>/^(state\.|settings\.|store\.|env\.|session\.|next\.)/.test(x))
  expect(forbidden).toEqual([])
 })
 test('desktop response is built by a synchronous callback',()=>{
  const source=PLUGIN_SOURCES['hooks/register.tsx']!
  expect(source).not.toMatch(/on\('ui\.render',\s*\{\s*component:\s*'AbovePrompt'\s*\},\s*async/)
 })
 for(const surface of ['desktop','terminal','vscode','mobile'] as const)test('first answer metric on '+surface,async($,on)=>{
  const f=fixture(on);const at=Date.now();const ui=await $.ui.mount({...REQUEST,surface} as never)
  console.log('B1b surface metric '+JSON.stringify({surface,firstAnswerMs:Date.now()-at,scope:'engine-kit mount only; AbovePrompt documented only terminal/desktop',calls:f.calls,spans:f.spans}))
  if(surface==='desktop')expect(await ui.find({type:'Text',text:'Coco'})).toBeDefined()
 })
 test('session.start returns without pending optional settings/state/store work',{timeoutMs:10000},async($,on)=>{
  const f=fixture(on,{hang:'settings.read'});const at=Date.now();await $.session.start(START)
  metric(f,{startMs:Date.now()-at,settingsPending:true});await visible($)
 })
 test('hydrated drawing does not reread the view or settings or store',async($,on)=>{
  const f=fixture(on);await $.session.start(START);await visible($)
  const count=f.calls.filter(x=>/^(state.get:view$|settings.read|store.get:)/.test(x)).length
  await visible($);await visible($)
  expect(f.calls.filter(x=>/^(state.get:view$|settings.read|store.get:)/.test(x)).length).toBe(count)
  metric(f,{repeatedDraws:3})
 })
 test('no hook entry re-asks exactly once at 1200 ms',async($,on)=>{
  const f=fixture(on);const invalidates:number[]=[]
  on('ui.invalidate',($,e,next)=>{invalidates.push(f.clock.now());return next(e)})
  await $.session.start(START);await f.clock.advance(1199);const before=invalidates.length
  await f.clock.advance(1);expect(invalidates.length-before).toBe(1)
  const once=invalidates.length;await f.clock.advance(3600);expect(invalidates.length).toBe(once)
 })
 test('first desktop entry cancels its 1200 ms re-ask',async($,on)=>{
  const f=fixture(on);const invalidates:number[]=[]
  on('ui.invalidate',($,e,next)=>{invalidates.push(f.clock.now());return next(e)})
  await $.session.start(START);await visible($);await f.clock.advance(1199);const before=invalidates.length
  await f.clock.advance(1);expect(invalidates.length).toBe(before)
 })
 test('desktop attach replaces the prior generation re-ask',async($,on)=>{
  const f=fixture(on);const invalidates:number[]=[]
  on('ui.invalidate',($,e,next)=>{invalidates.push(f.clock.now());return next(e)})
  await $.session.start(START);await f.clock.advance(1100);await $.session.attach({clientId:'reask-desktop',surface:'desktop'})
  await f.clock.advance(1199);const before=invalidates.length
  await f.clock.advance(1);expect(invalidates.length-before).toBe(1)
  const once=invalidates.length;await f.clock.advance(3600);expect(invalidates.length).toBe(once)
 })

 test('successful settings/state/store reads are reused across attach',async($,on)=>{
  const f=fixture(on,{storeRecord:{voice:'full',futureKey:'preserved'}})
  await $.session.start(START);for(let i=0;i<20;i++)await $.command.run({command:'b1b-host-boundary',args:'',origin:{kind:'composer'},presentation:{isFullscreen:false,columns:100}})
  await $.session.attach({clientId:'cache-desktop',surface:'desktop'});for(let i=0;i<10;i++)await $.command.run({command:'b1b-host-boundary',args:'',origin:{kind:'composer'},presentation:{isFullscreen:false,columns:100}})
  expect(f.calls.filter(x=>x==='settings.read').length).toBe(1)
  expect(f.calls.filter(x=>x==='store.get:bandSettings').length).toBe(1)
  expect(f.calls.filter(x=>x==='state.get:view').length).toBe(1)
  const records=f.storeWrites.filter(x=>x.key==='bandSettings')
  expect(records.length).toBeGreaterThan(0);expect((records[records.length-1]!.value as any).futureKey).toBe('preserved')
 })
 for(const record of ['malformed',{futureKey:'x'.repeat(17000)}])test('invalid/oversized settings record is never overwritten '+typeof record,async($,on)=>{
  const f=fixture(on,{storeRecord:record});await $.session.start(START)
  for(let i=0;i<20;i++)await $.command.run({command:'b1b-host-boundary',args:'',origin:{kind:'composer'},presentation:{isFullscreen:false,columns:100}})
  expect(f.storeWrites.filter(x=>x.key==='bandSettings')).toEqual([]);await visible($)
 })

 test('repeated cached desktop picture timing scenario',async($,on)=>{
  fixture(on,{label:'cached-picture'});const first=await $.ui.mount(REQUEST)
  for(let i=0;i<12;i++){await first.redraw(REQUEST.props);expect(await first.find({type:'Text',text:'Coco'})).toBeDefined()}
 })
 test('a later desktop request remains visible while downstream is pending',async($,on)=>{
  fixture(on,{hang:'next.render'});await $.session.start(START);await visible($);await visible($)
 })

 test('pending clock.now cannot hold the single no-entry re-ask',{timeoutMs:10000},async($,on)=>{
  const pending=new Promise<void>(()=>{});let invalidates=0
  const pendingClockOn=((event:string,...args:unknown[])=>event==='clock.now'?(on as any)(event,async()=>{await pending;return{value:NOW}}):(on as any)(event,...args)) as On
  const f=fixture(pendingClockOn)
  on('ui.invalidate',($,e,next)=>{invalidates++;return next(e)})
  await $.session.start(START);await f.clock.advance(1199);const before=invalidates
  await f.clock.advance(1);expect(invalidates-before).toBe(1);await visible($)
 })

 test('lifecycle worker upgrades changed work props, new requests and resized pictures',{timeoutMs:10000},async($,on)=>{
  const f=fixture(on);await $.session.start(START);const first=(await visible($)).ui;await desktopWorkerBoundary($,f)
  expect(await animatedSource(first)).toContain('@keyframes')
  await first.redraw({...REQUEST.props,isWorking:true});await desktopWorkerBoundary($,f);expect(await animatedSource(first)).toContain('@keyframes')
  const second=(await visible($,{...REQUEST,props:{...REQUEST.props,bodyColumns:120}})).ui;await desktopWorkerBoundary($,f);expect(await animatedSource(second)).toContain('@keyframes')
  await second.redraw({...REQUEST.props,maxRows:3});await desktopWorkerBoundary($,f);expect((await desktopPicture(second))?.props.height).toBe(32);expect(await animatedSource(second)).toContain('@keyframes')
 })
 test('survey owns the site until the first visible band releases its animation worker',{timeoutMs:10000},async($,on)=>{
  const f=fixture(on);await $.session.start(START)
  const ui=await $.ui.mount({...REQUEST,props:{...REQUEST.props,hasSurvey:true}})
  expect(await ui.find({type:'Text',text:'Coco'})).toBeUndefined();await desktopWorkerBoundary($,f)
  await ui.redraw(REQUEST.props);await desktopWorkerBoundary($,f);expect(await animatedSource(ui)).toContain('@keyframes')
 })
 test('attach and clear upgrade animation while reusing the loaded data',{timeoutMs:10000},async($,on)=>{
  const f=fixture(on);await $.session.start(START);const ui=(await visible($)).ui;await desktopWorkerBoundary($,f)
  expect(await animatedSource(ui)).toContain('@keyframes')
  await $.session.attach({clientId:'animation-desktop',surface:'desktop'});await ui.redraw(REQUEST.props);await desktopWorkerBoundary($,f);expect(await animatedSource(ui)).toContain('@keyframes')
  await $.command.run({command:'clear',args:'',origin:{kind:'composer'},presentation:{isFullscreen:false,columns:100}});await ui.redraw(REQUEST.props);await desktopWorkerBoundary($,f);expect(await animatedSource(ui)).toContain('@keyframes')
 })
 // Coco (coco-motion.ts): her resting states come bundled, so the first answer moves before any read;
 // her whole data file is read after it, and a failed or stuck read is tried again on a later request.
 test('a failed Coco data read keeps her bundled resting loop and retries on the later request',{timeoutMs:10000},async($,on)=>{
  const option:Options={throwAt:'fs.read:coco'},f=fixture(on,option)
  await $.session.start(START);const ui=(await visible($)).ui;await desktopWorkerBoundary($,f)
  expect(await animatedSource(ui)).toContain('data-coco="A idle"');expect(await animatedSource(ui)).toContain('@keyframes')
  const readsBeforeRetry=f.calls.filter(x=>x==='fs.read:coco').length;expect(readsBeforeRetry).toBeGreaterThan(0)
  option.throwAt=undefined;await ui.redraw(REQUEST.props);await desktopWorkerBoundary($,f)
  expect(f.calls.filter(x=>x==='fs.read:coco').length).toBe(readsBeforeRetry+2)
  expect(await animatedSource(ui)).toContain('data-coco="A idle"')
 })
 test('a pending Coco data read keeps her bundled resting loop and can retry after its background deadline',{timeoutMs:10000},async($,on)=>{
  const option:Options={hang:'fs.read:coco'},f=fixture(on,option)
  await $.session.start(START);const ui=(await visible($)).ui;await desktopWorkerBoundary($,f)
  expect(await animatedSource(ui)).toContain('data-coco="A idle"');expect(await animatedSource(ui)).toContain('@keyframes')
  const readsBefore=f.calls.filter(x=>x==='fs.read:coco').length
  option.hang=undefined;await f.clock.advance(5000);await ui.redraw(REQUEST.props);await desktopWorkerBoundary($,f)
  expect(f.calls.filter(x=>x==='fs.read:coco').length).toBeGreaterThan(readsBefore)
 })

 // Held states before her data is read show the nearest bundled one, then her own once it is read.
 for(const [mood,first,after] of [['work','idle','work'],['error','idle','error'],['waiting','wait','wait']] as const)test('held noncold '+mood+' picture hydrates without caching the temporary rest',{timeoutMs:10000},async($,on)=>{
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve})
  const f=fixture(on,{initial:{...initialView(),mood},pictureGate:held,reduced:true,hang:'session.root'})
  try{
   await $.session.start(START)
   for(let i=0;i<8;i++)await $.command.run({command:'b1b-host-boundary',args:'',origin:{kind:'composer'},presentation:{isFullscreen:false,columns:100}})
   const ui=(await visible($)).ui;await desktopWorkerBoundary($,f)
   const pending=await animatedSource(ui)
   expect(pending).toContain('data:image/png;base64,');expect(pending).not.toMatch(/undefined|NaN/)
   expect(pending).toContain(`data-coco="A ${first}"`)
   release();await desktopWorkerBoundary($,f)
   await ui.redraw(REQUEST.props)
   expect(await animatedSource(ui)).toContain(`data-coco="A ${after}"`)
   if(first!==after)expect(await animatedSource(ui)).not.toBe(pending)
  }finally{release()}
 })

 test('held picture completion uses the newer active turn instead of a restored error',{timeoutMs:10000},async($,on)=>{
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve})
  const f=fixture(on,{initial:{...initialView(),mood:'error',frame:'error'},pictureGate:held,reduced:true,hang:'session.root'})
  on('turn.start',($,e)=>({turnId:e.turnId}))
  try{
   await $.session.start(START);const ui=(await visible($)).ui;await desktopWorkerBoundary($,f)
   await $.turn.start({text:'fixture work',turnId:'sparse-new-turn'})
   await ui.redraw({...REQUEST.props,isWorking:true});await desktopWorkerBoundary($,f)
   release();await desktopWorkerBoundary($,f)
   await ui.redraw({...REQUEST.props,isWorking:true})
   expect(await animatedSource(ui)).toContain('data-coco="A think"')
   expect(await animatedSource(ui)).not.toContain('data-coco="A error"')
  }finally{release()}
 })

 // The book waits on no picture data since 10-16; the read it still waits on is its words, held here.
 test('closing the book during its first words read discards its held drawing and reopening uses exact portrait',{timeoutMs:10000},async($,on)=>{
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve})
  const f=fixture(on,{initial:initialView(),pictureGate:held,gateBook:true,hang:'session.root',bookFiles:true,reduced:true})
  const closes:{id:string;origin:{kind:'plugin'|'person'|'unload'};plugin:string|undefined}[]=[]
  on('ui.open',()=>({value:{isPlaced:true}}))
  // The kit has no ui.close implementation. Record the real band's close DTO;
  // below, apply the same production completion after a synthetic accepted close.
  // This tests cleanup/invalidation, not a physical pane close or host ownership.
  on('ui.close',($,e,next)=>{closes.push({id:e.id,origin:e.origin,plugin:next.origin.plugin});return{value:undefined}})
  const command={command:'coco',args:'him',origin:{kind:'composer' as const},presentation:{isFullscreen:false,columns:100}}
  const pane={plugin:'coco',component:'Pane' as const,requestId:'coco-book',surface:'desktop' as const,props:{title:'Coco',isFocused:false,bodyColumns:64,placement:'dock' as const,scroll:{offset:0,bodyRows:40},view:{}}}
  let pending:ReturnType<typeof $.ui.mount>|undefined
  try{
   await $.session.start(START)
   await $.command.run(command)
   const band=(await visible($)).ui
   await desktopWorkerBoundary($,f)
   let settled=false
   pending=$.ui.mount(pane).then(ui=>{settled=true;return ui})
   for(let i=0;i<12;i++)await $.command.run({command:'b1b-host-boundary',args:'',origin:command.origin,presentation:command.presentation})
   expect(settled).toBe(false)
   expect(f.calls.filter(x=>x==='fs.read:book').length).toBe(1) // started, and held
   await band.press({key:'coco:book:open'})
   expect(closes).toHaveLength(1)
   const close=closes[0]!
   expect(close.id).toBe('coco-book')
   expect(close.origin.kind).toBe('plugin')
   expect(close.plugin).toBe('coco')
   expect(completeBookClose(close,'intruder',false)).toBe(false)
   expect(completeBookClose({...close,id:'other-pane'},close.plugin,false)).toBe(false)
   expect(completeBookClose(close,close.plugin,true)).toBe(false)
   expect(completeBookClose(close,close.plugin,false)).toBe(true)
   release();await desktopWorkerBoundary($,f)
   const discarded=await pending
   expect(await discarded.find({type:'Svg'})).toBeUndefined()
   expect(await discarded.find({key:'coco:book:tab:him'})).toBeUndefined()
   expect(f.calls.filter(x=>x==='fs.read:book').length).toBe(1) // no second read for the drawing it threw away
   await discarded.unmount()
   await $.command.run(command)
   const reopened=await $.ui.mount(pane)
   // the him page's portrait: her praised pose held still, in the outfit she wears (book-portrait.ts)
   const expected='data-coco="A praised"'
   expect(await animatedSource(reopened)).toContain(expected)
   await reopened.redraw()
   expect(await animatedSource(reopened)).toContain(expected)
   await reopened.unmount();await band.unmount()
  }finally{release();if(pending)await pending.catch(()=>undefined)}
 })

})
