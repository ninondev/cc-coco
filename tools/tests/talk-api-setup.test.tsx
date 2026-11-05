import {test,expect} from 'claude-code/testing'
import {world,RECENT,PERSON,P,settleLegacyStart} from './world'
import {M1_MORE_TEXT,installM1Words} from './m1-more-data-fixture'
import {moreWord} from '../hooks/more-words'
installM1Words()
const START={cwd:'/tmp/talk-api-setup',surface:'terminal' as const,isInteractive:true}
const PANE={plugin:'coco',component:'Pane' as const,requestId:'coco-book',props:{title:'Coco',isFocused:true,bodyColumns:80,placement:'dock' as const,scroll:{offset:0,bodyRows:60},view:{}}}
const OLD_KEY={last4:'old1',state:'works' as const,store:'keychain' as const,host:'api.example.invalid',model:'test-chat'}
function fixture(on:Parameters<typeof world>[0],cancel=false,wait?:Promise<void>,options:{existing?:boolean;agreed?:boolean;failure?:boolean;reject?:boolean;enabled?:boolean;storeFailure?:boolean}={}){
 let models=0,adds=0
 on('session.model',()=>({value:'default'}))
 on('model.complete',()=>{models++;return{deny:'setup must not send to a model'}})
 on('fs.exists',{path:/SystemVersion\.plist$|\/libexec\/talk-key$/},()=>({value:true}))
 on('process.run',async($,e,next)=>{
  if(!e.argv.some(v=>v.endsWith('/libexec/talk-key')))return next(e)
  if(e.argv.includes('add')){adds++;await wait;if(options.reject)throw Error('fixture helper failed')}
  const reply=e.argv.includes('add')?(options.failure?{kind:'offline'}:cancel?{kind:'cancelled'}:{kind:'saved',last4:'test',store:'keychain',host:'api.example.invalid',model:'test-chat'}):options.existing?{...OLD_KEY,kind:'works'}:{kind:'cancelled'}
  return{value:{exitCode:0,stdout:JSON.stringify(reply),stderr:'',isStdoutTruncated:false,isStderrTruncated:false}}
 })
 if(options.storeFailure)on('store.set',{key:'more.key'},()=>{throw Error('fixture store failed')})
 const w=world(on,{observeStore:true,moreText:M1_MORE_TEXT,store:{...RECENT,...(options.existing?{'more.key':OLD_KEY}:{}),...(options.agreed?{'more.agreed':['talk']}:{}),...(options.enabled?{more:{talk:true}}:{})},env:{HOME:'/tmp/talk-api-home',LANG:'zh_CN.UTF-8',TERM:'xterm-256color',ANTHROPIC_BASE_URL:'https://api.example.invalid'}})
 return{w,models:()=>models,adds:()=>adds}
}
for(const surface of ['desktop','terminal','vscode','mobile'] as const)test(`Talk API setup: ${surface} offers a connection when no model is available`,async($,on)=>{
 const f=fixture(on)
 await $.session.start(START);await settleLegacyStart($,f.w)
 await $.command.run({command:'coco',args:'settings',origin:PERSON,presentation:P})
 const ui=await $.ui.mount({surface,...PANE})
 expect(await ui.find({key:'coco:more:talk:connect'})).toBeDefined()
 await ui.press({key:'coco:more:talk:connect'});await ui.redraw()
 expect(f.w.stored('more.payer')).toBe('key')
 if(surface==='mobile')expect((await ui.findAll({type:'Text'})).map(n=>n.text).join('\n')).toContain(moreWord('key.phone','zh'))
 else expect(await ui.find({key:'coco:more:key:add'})).toBeDefined()
 expect(f.models()).toBe(0);expect(f.adds()).toBe(0)
 if(surface==='desktop')console.log('TALKAPIDUMP '+JSON.stringify({name:'接入 API',tree:await ui.drawn()}))
 await ui.unmount()
})

for(const outcome of ['cancelled','failed','rejected','store-failed','saved'] as const)for(const agreed of [false,true])test(`Talk API setup: existing key ${outcome}, prior consent ${agreed}, only a saved replacement continues`,async($,on)=>{
 let finish!:()=>void
 const f=fixture(on,outcome==='cancelled',new Promise<void>(resolve=>{finish=resolve}),{existing:true,agreed,failure:outcome==='failed',reject:outcome==='rejected',storeFailure:outcome==='store-failed'})
 await $.session.start(START);await settleLegacyStart($,f.w)
 await $.command.run({command:'coco',args:'talk',origin:PERSON,presentation:P})
 const ui=await $.ui.mount({surface:'desktop',...PANE})
 try{
  expect(await ui.find({key:'coco:more:key:replace'})).toBeDefined()
  await ui.press({key:'coco:more:key:replace'})
  for(let i=0;i<30;i++)await Promise.resolve()
  expect(f.adds()).toBe(1)
  expect(await ui.find({key:'coco:talk:input'})).toBeUndefined()
  finish();for(let i=0;i<30;i++)await Promise.resolve()
  await ui.redraw()
  if(outcome==='saved'){
   expect((f.w.stored('more.key') as {last4:string}).last4).toBe('test')
   if(!agreed){expect(await ui.find({key:'coco:more:talk:ask:yes'})).toBeDefined();await ui.press({key:'coco:more:talk:ask:yes'});await ui.redraw()}
   expect(await ui.find({key:'coco:talk:input'})).toBeDefined()
  }else{
   expect((f.w.stored('more.key') as {last4:string}).last4).toBe('old1')
   expect(await ui.find({key:'coco:more:talk:ask:yes'})).toBeUndefined()
   expect(await ui.find({key:'coco:talk:input'})).toBeUndefined()
   expect(await ui.find({key:'coco:more:talk:off'})).toBeUndefined()
  }
  expect(f.models()).toBe(0)
 }finally{finish();await ui.unmount()}
})

for(const interrupt of ['payer','cleared runtime'] as const)test(`Talk API setup: a saved key cannot reopen a request after ${interrupt}`,async($,on)=>{
 let finish!:()=>void
 const f=fixture(on,false,new Promise<void>(resolve=>{finish=resolve}),{existing:true,agreed:true})
 await $.session.start(START);await settleLegacyStart($,f.w)
 await $.command.run({command:'coco',args:'talk',origin:PERSON,presentation:P})
 const ui=await $.ui.mount({surface:'desktop',...PANE})
 try{
  await ui.press({key:'coco:more:key:replace'})
  for(let i=0;i<30;i++)await Promise.resolve()
  expect(f.adds()).toBe(1)
  if(interrupt==='payer')await ui.select({key:'coco:more:payer',value:'session'})
  else await $.command.run({command:'clear',args:'',origin:PERSON,presentation:P})
  finish();for(let i=0;i<30;i++)await Promise.resolve()
  await ui.redraw()
  expect(await ui.find({key:'coco:talk:input'})).toBeUndefined()
  expect(await ui.find({key:'coco:more:talk:ask:yes'})).toBeUndefined()
  expect(f.models()).toBe(0)
 }finally{finish();await ui.unmount()}
})
for(const cancel of [false,true])test(`Talk API setup: an enabled Talk waits for the dialog and ${cancel?'stays in settings on cancel':'opens after saving'}`,async($,on)=>{
 let finish!:()=>void
 const f=fixture(on,cancel,new Promise<void>(resolve=>{finish=resolve}),{existing:true,agreed:true,enabled:true})
 await $.session.start(START);await settleLegacyStart($,f.w)
 await $.command.run({command:'coco',args:'talk',origin:PERSON,presentation:P})
 const ui=await $.ui.mount({surface:'desktop',...PANE})
 try{
  await ui.press({key:'coco:more:key:replace'})
  for(let i=0;i<30;i++)await Promise.resolve()
  expect(f.adds()).toBe(1)
  await ui.redraw()
  expect(await ui.find({key:'coco:talk:input'})).toBeUndefined()
  finish();for(let i=0;i<30;i++)await Promise.resolve()
  await ui.redraw()
  if(cancel){
   expect((f.w.stored('more.key') as {last4:string}).last4).toBe('old1')
   expect(await ui.find({key:'coco:talk:input'})).toBeUndefined()
   await ui.press({key:'coco:more:key:check'});await ui.redraw()
   expect(await ui.find({key:'coco:talk:input'})).toBeUndefined()
  }else expect(await ui.find({key:'coco:talk:input'})).toBeDefined()
  expect(f.models()).toBe(0)
 }finally{finish();await ui.unmount()}
})
test('Talk API setup: declining the cost ends the automatic opening request',async($,on)=>{
 const f=fixture(on)
 await $.session.start(START);await settleLegacyStart($,f.w)
 await $.command.run({command:'coco',args:'talk',origin:PERSON,presentation:P})
 const ui=await $.ui.mount({surface:'desktop',...PANE})
 await ui.press({key:'coco:more:key:add'})
 for(let i=0;i<30;i++)await Promise.resolve()
 await ui.redraw();await ui.press({key:'coco:more:talk:ask:no'});await ui.redraw()
 expect(await ui.find({key:'coco:talk:input'})).toBeUndefined()
 await ui.press({key:'coco:more:talk:on'});await ui.redraw()
 await ui.press({key:'coco:more:talk:ask:yes'});await ui.redraw()
 expect(await ui.find({key:'coco:more:talk:off'})).toBeDefined()
 expect(await ui.find({key:'coco:talk:input'})).toBeUndefined()
 expect(f.models()).toBe(0)
 await ui.unmount()
})
test('Talk API setup: leaving setup before the key dialog returns keeps the book on the chosen page',async($,on)=>{
 let finish!:()=>void
 const f=fixture(on,false,new Promise<void>(resolve=>{finish=resolve}))
 await $.session.start(START);await settleLegacyStart($,f.w)
 await $.command.run({command:'coco',args:'talk',origin:PERSON,presentation:P})
 const ui=await $.ui.mount({surface:'desktop',...PANE})
 await ui.press({key:'coco:more:key:add'})
 for(let i=0;i<30;i++)await Promise.resolve()
 expect(f.adds()).toBe(1)
 await ui.press({key:'coco:more:back'});finish()
 for(let i=0;i<30;i++)await Promise.resolve()
 await ui.redraw()
 expect(await ui.find({key:'coco:more:talk:ask:yes'})).toBeUndefined()
 expect(await ui.find({key:'coco:talk:input'})).toBeUndefined()
 expect(f.models()).toBe(0)
 await ui.unmount()
})
for(const cancel of [false,true])test(`Talk API setup: command routes to setup and ${cancel?'cancellation stays off':'saving preserves consent before opening'}`,async($,on)=>{
 const f=fixture(on,cancel)
 await $.session.start(START);await settleLegacyStart($,f.w)
 await $.command.run({command:'coco',args:'talk',origin:PERSON,presentation:P})
 const ui=await $.ui.mount({surface:'desktop',...PANE})
 expect(await ui.find({key:'coco:more:key:add'})).toBeDefined()
 await ui.press({key:'coco:more:key:add'})
 for(let i=0;i<30;i++)await Promise.resolve()
 await ui.redraw()
 expect(f.adds()).toBe(1)
 if(cancel){
  expect(await ui.find({key:'coco:more:key:add'})).toBeDefined()
  expect(await ui.find({key:'coco:more:talk:ask:yes'})).toBeUndefined()
 }else{
  expect(await ui.find({key:'coco:more:talk:ask:yes'})).toBeDefined()
  await ui.press({key:'coco:more:talk:ask:yes'});await ui.redraw()
  expect(await ui.find({key:'coco:talk:input'})).toBeDefined()
 }
 expect(f.models()).toBe(0)
 await ui.unmount()
})
