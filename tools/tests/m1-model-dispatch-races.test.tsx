import {expect,test} from 'claude-code/testing'
import {world,settleLegacyStart,RECENT,MORNING,P,PERSON} from './world'
import {modelServiceFixtureText} from './m1-model-service-fixture'
import {C3_WORDS_RAW} from './c3-words-fixture'
import {C3_HEAD_MANIFEST} from './c3-head-assets'

// All added words are explicit development inputs in the actual hook host.
// Spies keep only call names; they never retain a model's private instruction.
const START={cwd:'/tmp/m1-dispatch-race-fixture',surface:'terminal' as const,isInteractive:true}
const PANE={surface:'terminal' as const,plugin:'coco',component:'Pane' as const,requestId:'coco-book',props:{title:'Fixture',isFocused:true,bodyColumns:100,placement:'dock' as const,scroll:{offset:0,bodyRows:100},view:{}},viewport:{columns:100,rows:100}}
// The diary takes no tokens since 10-09 (O1), so it has no model dispatch to race.
const ROUTES=['say','send','input'] as const

for(const route of ROUTES)test(`M1 S5 actual ${route} held clock cannot reuse a press after Talk Off then On`,async($,on)=>{
 let armed=false,heldReads=0,release!:()=>void,entered!:()=>void
 const held=new Promise<void>(resolve=>{release=resolve}),ready=new Promise<void>(resolve=>{entered=resolve})
 on('clock.*',async(_hook,e,next)=>{
  if(!next.is('clock.now',e)||!armed)return next(e)
  armed=false;heldReads++;const result=await next(e);entered();await held;return result
 })
 const calls:string[]=[],saved=new Map<string,unknown>()
 on('model.complete',()=>{calls.push('model.complete');return{value:{isAnswered:true,text:'fixture reply',usage:{input_tokens:1,output_tokens:1,cache_read_input_tokens:0,cache_creation_input_tokens:0}}}})
 on('model.classify',()=>{calls.push('model.classify');return{value:'chat'}})
 on('http.fetch',()=>{calls.push('http.fetch');return{deny:'unexpected fixture network request'}})
 on('store.*',async(_hook,e,next)=>{const result=await next(e);if(next.is('store.set',e)&&!('deny'in result))saved.set(e.key,e.value);return result})
 on('agent.list',()=>({value:[]}));on('session.messages',()=>({value:[]}));on('session.model',()=>({value:'fixture model'}));on('session.repo',()=>({value:null}));on('session.turns',()=>({value:1}))
 on('fs.write',()=>({value:undefined}));on('process.run',()=>({value:{exitCode:0,stdout:'{"ok":true,"result":{},"ensured":true,"claimed":true}',stderr:'',isStdoutTruncated:false,isStderrTruncated:false}}))
 const data=JSON.parse(modelServiceFixtureText()) as Record<string,Record<string,string>>
 data['more.model.talk.persona']={en:'fixture talk persona'}
 const w=world(on,{surfaces:['terminal'],env:{HOME:'/tmp/m1-dispatch-race-fixture-home',LANG:'en_US.UTF-8',TERM:'xterm-256color'},moreText:JSON.stringify(data),store:{...RECENT,firstMet:MORNING,more:{talk:true},'more.agreed':['talk'],bandSettings:{voice:'off',voiceChosen:true,band:'off',guard:false,bookmark:false,notes:false,more:{talk:true}}},readText:path=>path.endsWith('c3-text.json')?C3_WORDS_RAW:path.endsWith('frame-manifest.json')?JSON.stringify(C3_HEAD_MANIFEST):undefined})
 await $.session.start(START);await settleLegacyStart($,w)
 const callerPage=route==='send'||route==='input'?'talk':route==='diary'?'him':'more'
 const open=(args:string)=>$.command.run({command:'coco',args,origin:PERSON,presentation:P})
 await open(callerPage)
 const pane=await $.ui.mount(PANE)
 const phase=(name:string)=>console.log('M1_S5_DISPATCH_PHASE '+route+' '+name)
 const send=(fresh=false)=>route==='say'?$.command.run({command:'coco',args:'say '+(fresh?'fixture fresh text':'fixture cancelled text'),origin:PERSON,presentation:P}):route==='send'?pane.press({key:'coco:talk:send'}):route==='input'?pane.input({key:'coco:talk:input',text:fresh?'fixture fresh text':'fixture cancelled text',kind:'submit'}):pane.press({key:'coco:diary:write'})
 let pending:Promise<unknown>|undefined
 try{
  if(route==='send'||route==='input'){
   expect(await pane.find({type:'Input',key:'coco:talk:input'})).toBeDefined()
   await pane.input({key:'coco:talk:input',text:'fixture cancelled text',kind:'change'})
   if(route==='send')expect(await pane.find({type:'Button',key:'coco:talk:send'})).toBeDefined()
  }else expect(await pane.find({type:'Button',key:route==='diary'?'coco:diary:write':'coco:more:talk:off'})).toBeDefined()
  phase('caller-rendered');expect(calls).toEqual([]);armed=true;pending=send()
  await Promise.race([ready,pending.then(()=>{throw Error('Expected the actual caller clock-await boundary')})])
  expect(heldReads).toBe(1);phase('clock-held')
  // The shipping More page owns these Buttons. Reuse the actual book mount;
  // a test renderer's matching key does not establish plugin ownership.
  await open('more');await pane.redraw();phase('more-rendered')
  expect(await pane.find({type:'Button',key:'coco:more:talk:off'})).toBeDefined()
  await pane.press({key:'coco:more:talk:off'});phase('off-pressed')
  expect((saved.get('more') as {talk?:boolean})?.talk).toBe(false)
  await pane.redraw();expect(await pane.find({type:'Button',key:'coco:more:talk:on'})).toBeDefined()
  await pane.press({key:'coco:more:talk:on'});phase('on-pressed')
  await pane.redraw()
  if(await pane.find({type:'Button',key:'coco:more:talk:ask:yes'})){await pane.press({key:'coco:more:talk:ask:yes'});await pane.redraw();phase('agreement-pressed')}
  expect((saved.get('more') as {talk?:boolean})?.talk).toBe(true)
  expect(await pane.find({type:'Button',key:'coco:more:talk:off'})).toBeDefined()
  expect(calls).toEqual([])
  release();await pending;await settleLegacyStart($,w);phase('cancelled-caller-settled')
  expect(calls).toEqual([]);expect(heldReads).toBe(1)
  // A fresh explicit action must reach the same real model boundary. Missing
  // words, a missing event route, or a disabled fixture cannot fake this pass.
  await open(callerPage);await pane.redraw();phase('fresh-caller-rendered')
  if(route==='send')await pane.input({key:'coco:talk:input',text:'fixture fresh text',kind:'change'})
  await send(true);phase('fresh-caller-settled')
  expect(calls).toEqual(['model.complete'])
 }finally{release();await pending;await pane.unmount()}
})
