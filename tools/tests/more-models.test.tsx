import {test,expect} from 'claude-code/testing'
import type {EngineInterface} from 'claude-code'
import {installM1Words} from './m1-more-data-fixture'
import {installModelServiceFixture} from './m1-model-service-fixture'
import {MoreRuntime} from '../hooks/more-runtime'
import {MorePage} from '../hooks/more-book'
import {moreModels,moreModelFor,moreModelsDirect} from '../hooks/more-models'
import {MORE_SLOTS} from '../hooks/more-words'
installM1Words()
installModelServiceFixture()
const AT=Date.UTC(2026,9,17,12)
const nodes=(tree:any):any[]=>!tree||typeof tree!=='object'?[]:Array.isArray(tree)?tree.flatMap(nodes):[tree,...(tree.children??[]).flatMap(nodes)]
function engine(){
 const calls:{name:string;args:unknown[]}[]=[],stored:Record<string,unknown>={}
 const call=(name:string,...args:unknown[])=>{calls.push({name,args})}
 const $={
  clock:{now:async()=>AT,after:()=>({cancel:()=>{}})},
  store:{get:async(key:string)=>stored[key],set:async(key:string,value:unknown)=>{call('store.set',key,value);stored[key]=value}},
  model:{complete:async(request:unknown)=>{call('model.complete',request);return{isAnswered:true,text:'hi',usage:{input_tokens:1,output_tokens:1,cache_read_input_tokens:0,cache_creation_input_tokens:0}}}},
  agent:{register:async(request:unknown)=>{call('agent.register',request)},spawn:async(request:unknown)=>{call('agent.spawn',request);return{agentId:'reader'}},list:async()=>[]},
  session:{repo:async()=>null},
  ui:{invalidate:()=>{},log:()=>{}},
 } as unknown as EngineInterface
 return{$,calls,stored}
}
// cc-switch writes these for a provider in its Direct mode: the address, a model per family and the main one.
const GLM={base:'https://open.bigmodel.cn/api/anthropic',main:'glm-4.6',pinned:{haiku:'glm-4.5-air',sonnet:'glm-4.6',opus:'glm-4.6'}}

test('Claude\'s own service offers Haiku, Sonnet and Opus, Haiku by default for both rows',()=>{
 for(const base of [undefined,'','https://api.anthropic.com','https://api.anthropic.com/']){
  const models=moreModels({base})
  expect(models.own).toBe(false);expect(moreModelsDirect(base)).toBe(true)
  expect(models.choices).toEqual([{value:'haiku',label:'Haiku'},{value:'sonnet',label:'Sonnet'},{value:'opus',label:'Opus'}])
  expect(moreModelFor(models,'talk')).toBe('haiku');expect(moreModelFor(models,'look')).toBe('haiku')
  expect(moreModelFor({...models,picks:{look:'opus'}},'look')).toBe('opus')
 }
 // a pin the person set on Claude's service is what its family reaches; a custom option joins the list
 expect(moreModels({pinned:{sonnet:'claude-sonnet-4-5[1m]'},custom:'claude-fable-5',customName:'Fable 5'}).choices).toEqual([{value:'haiku',label:'Haiku'},{value:'sonnet',label:'claude-sonnet-4-5'},{value:'opus',label:'Opus'},{value:'claude-fable-5',label:'Fable 5'}])
})

test('Another service offers only the models connected there, once each, and picks none',()=>{
 const glm=moreModels(GLM)
 expect(glm.own).toBe(true)
 expect(glm.choices).toEqual([{value:'haiku',label:'glm-4.5-air'},{value:'sonnet',label:'glm-4.6'}])
 expect(moreModelFor(glm,'talk')).toBe(undefined);expect(moreModelFor(glm,'look')).toBe(undefined)
 expect(moreModelFor({...glm,picks:{talk:'sonnet'}},'talk')).toBe('sonnet')
 // a pick the connection no longer offers is no pick
 expect(moreModelFor({...glm,picks:{talk:'opus'}},'talk')).toBe(undefined)
 // cc-switch's routing writes a stand-in name per family and the real name beside it
 expect(moreModels({base:'http://127.0.0.1:15721',pinned:{haiku:'claude-haiku-5',sonnet:'claude-sonnet-5'},names:{haiku:'kimi-k3-turbo',sonnet:'Kimi K3'}}).choices).toEqual([{value:'haiku',label:'kimi-k3-turbo'},{value:'sonnet',label:'Kimi K3'}])
 // only the main model set: that one; the older name for Haiku still counts
 expect(moreModels({base:'https://api.deepseek.com/anthropic',main:'deepseek-chat'}).choices).toEqual([{value:'deepseek-chat',label:'deepseek-chat'}])
 expect(moreModels({base:'https://gw.example.invalid',smallFast:'small-1',main:'default'}).choices).toEqual([{value:'haiku',label:'small-1'}])
 // nothing set: nothing to pick, and a value with spaces or control characters is no model
 expect(moreModels({base:'https://gw.example.invalid'}).choices).toEqual([])
 expect(moreModels({base:'https://gw.example.invalid',main:'two words',pinned:{haiku:'bad\u0007id'}}).choices).toEqual([])
})

test('On another service Talk turns on only after a pick, sends on it, and keeps it for the next session',async()=>{
 const f=engine(),r=new MoreRuntime({'more.model.talk.persona':'fixture persona'})
 r.restore({talk:true},['talk'],undefined,AT);r.setModels(moreModels(GLM),undefined)
 expect(r.isOn('talk')).toBe(false)
 expect(await r.press(f.$,'coco:more:talk:on')).toBe(false)
 expect(await r.press(f.$,'coco:more:talk:model:1')).toBe(true)
 expect(f.stored['more.models']).toEqual({talk:'sonnet'})
 expect(r.isOn('talk')).toBe(true)
 await r.talk(f.$,'hello there',AT)
 expect((f.calls.find(call=>call.name==='model.complete')!.args[0] as {model:string}).model).toBe('sonnet')
 // the next session: the pick holds while the connection still offers it, and is dropped once it does not
 const next=new MoreRuntime({'more.model.talk.persona':'fixture persona'});next.restore({talk:true},['talk'],undefined,AT)
 next.setModels(moreModels(GLM),f.stored['more.models']);expect(next.isOn('talk')).toBe(true);expect(next.modelFor('talk')).toBe('sonnet')
 next.setModels(moreModels({base:GLM.base,main:'glm-5'}),f.stored['more.models']);expect(next.isOn('talk')).toBe(false)
 expect(await next.press(f.$,'coco:more:talk:model:9')).toBe(false)
})

// his 10-17 card: Explain runs on Talk's pick, with no choice of its own
test('Explain runs on Talk\'s pick and, on another service, waits for it',async()=>{
 const f=engine(),r=new MoreRuntime()
 r.restore({explain:true},['explain'],undefined,AT);r.setModels(moreModels(GLM),undefined)
 expect(r.isOn('explain')).toBe(false)
 expect(await r.press(f.$,'coco:more:explain:model:0')).toBe(true)
 expect(f.stored['more.models']).toEqual({talk:'haiku'});expect(r.isOn('explain')).toBe(true);expect(r.modelFor('talk')).toBe('haiku')
 r.lastAnswer='fixture answer to put plainly';await r.explain(f.$,AT,false)
 expect((f.calls.find(call=>call.name==='model.complete')!.args[0] as {model:string}).model).toBe('haiku')
})
test('The second look spawns on the picked model; on Claude\'s service it needs no pick',async()=>{
 const f=engine(),r=new MoreRuntime({'more.model.look.prompt':'fixture reader'})
 r.restore({look:true},['look'],undefined,AT);r.setModels(moreModels({}),{look:'opus'})
 expect(r.isOn('look')).toBe(true)
 await r.registerLook(f.$);r.edit('/fixture/a.ts','edit');await r.secondLook(f.$)
 expect((f.calls.find(call=>call.name==='agent.spawn')!.args[0] as {model:string}).model).toBe('opus')
})

test('The book: Claude\'s service shows the pick under a row that is on; another service shows the choices with none picked; nothing connected says why',async($,on)=>{
 MORE_SLOTS['more.model.none']={en:'fixture no model here'};MORE_SLOTS['more.model.look.prompt']={en:'fixture reader'}
 const base={values:{talk:true,look:true},agreed:['talk','look'],today:{date:'',rows:{}},reading:0,open:true,lang:'en',screenReader:false}
 let snapshot:any={...base,models:{...moreModels({}),picks:{}}}
 on('ui.render',{component:'Pane',requestId:'models'},($,e)=>MorePage($.ui.resolve(e) as any,{surface:e.surface,snapshot}))
 const pane={plugin:'coco',component:'Pane' as const,requestId:'models',props:{title:'Fixture',isFocused:true,bodyColumns:100,placement:'dock' as const,scroll:{offset:0,bodyRows:300},view:{}}}
 try{
  // mobile draws a button a model; the default one is marked
  let ui=await $.ui.mount({surface:'mobile',...pane})
  expect((await ui.find({type:'Button',key:'coco:more:talk:model:0'}))?.props.variant).toBe('primary')
  expect((await ui.find({type:'Button',key:'coco:more:talk:model:1'}))?.props.variant).toBe(undefined)
  await ui.unmount()
  // the terminal draws a Select at the default
  ui=await $.ui.mount({surface:'terminal',...pane})
  const select=nodes(await ui.drawn()).find(node=>node.props?.key==='coco:more:talk:model')
  expect(select?.props.value).toBe('0');expect(select?.props.options.map((o:any)=>o.label)).toEqual(['Haiku','Sonnet','Opus'])
  await ui.unmount()
  // another service: no row is on, the choices wait with none marked
  snapshot={...base,models:{...moreModels(GLM),picks:{}}}
  ui=await $.ui.mount({surface:'mobile',...pane})
  expect(await ui.find({type:'Button',key:'coco:more:talk:off'})).toBeUndefined()
  expect(await ui.find({type:'Button',key:'coco:more:talk:on'})).toBeUndefined()
  for(const key of ['coco:more:talk:model:0','coco:more:talk:model:1','coco:more:look:model:0'])expect((await ui.find({type:'Button',key}))?.props.variant).toBe(undefined)
  await ui.unmount()
  // nothing connected that can be picked: Off, and why
  snapshot={...base,models:{...moreModels({base:GLM.base}),picks:{}}}
  ui=await $.ui.mount({surface:'mobile',...pane})
  expect(await ui.find({type:'Text',text:'fixture no model here'})).toBeDefined()
  expect(await ui.find({type:'Button',key:'coco:more:talk:model:0'})).toBeUndefined()
  await ui.unmount()
 }finally{delete MORE_SLOTS['more.model.none'];delete MORE_SLOTS['more.model.look.prompt']}
})
