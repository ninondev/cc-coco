import {expect,test} from 'claude-code/testing'
import type {EngineInterface,SessionUsage} from 'claude-code'
import {MoreRuntime} from '../hooks/more-runtime'
import {MORE_IDS,moreOn} from '../hooks/more-state'
import type {MoreId} from '../hooks/more-state'
import {MORE_SLOTS,installMoreWords} from '../hooks/more-words'
import {installM1Words} from './m1-more-data-fixture'

// This marker exercises a development input; it is not approved product copy.
const SLOT='more.modelService.disclosure',FIXTURE='fixture-model-service-disclosure',AT=1791273600000
const USAGE:SessionUsage={startedAt:AT,context:{tokens:100,window:200000,percent:0.05},rateLimits:[]}
const MODEL_WORDS={'more.model.talk.persona':'fixture persona','more.model.look.prompt':'fixture reader'}
class HelperRuntime extends MoreRuntime {
 override isOn(id:MoreId):boolean{return id==='look'?moreOn(this.values,id):super.isOn(id)}
}
function engine(){
 const calls:string[]=[]
 const call=(name:string)=>{calls.push(name)}
 const usage={input_tokens:1,output_tokens:1,cache_read_input_tokens:0,cache_creation_input_tokens:0}
 const $={
  fs:{read:async()=>{call('fs.read');return '{}'},write:async()=>{call('fs.write')}},
  store:{get:async()=>{call('store.get');return undefined},set:async()=>{call('store.set')}},
  ui:{invalidate:()=>{call('ui.invalidate')},log:()=>{call('ui.log')},copy:async()=>{call('ui.copy')},selection:async()=>{call('ui.selection');return {text:'fixture selection'}}},
  prompt:{read:async()=>{call('prompt.read');return {text:'fixture note'}},fill:async()=>{call('prompt.fill')}},
  model:{complete:async()=>{call('model.complete');return {isAnswered:true,text:'fixture reply',usage}},classify:async()=>{call('model.classify');return 'chat'}},
  agent:{register:async()=>{call('agent.register')},spawn:async()=>{call('agent.spawn');return {agentId:'fixture-reader'}}},
  tool:{register:async()=>{call('tool.register')}},
  config:{list:async()=>{call('config.list');return [{key:'outputStyle',value:'fixture-old-style',isLocked:false}]},set:async()=>{call('config.set');return {value:'fixture-style'}}},
  command:{run:async()=>{call('command.run')}},
  session:{repo:async()=>{call('session.repo');return null},messages:async()=>{call('session.messages');return []},send:async()=>{call('session.send');return {isDelivered:true}}},
  process:{run:async()=>{call('process.run');return {exitCode:0,stdout:'fixture diff',stderr:''}}},
  env:{get:async()=>{call('env.get');return undefined}},
  http:{fetch:async()=>{call('http.fetch');return {ok:true,text:'{"incidents":[],"components":[]}'}}},
  clock:{now:async()=>{call('clock.now');return AT},every:()=>{call('clock.every');return {cancel:()=>{call('clock.cancel')}}},after:()=>({cancel:()=>{}})},
 } as unknown as EngineInterface
 return {$,calls}
}
function words(enabled:boolean){installM1Words();delete MORE_SLOTS[SLOT];if(enabled)expect(installMoreWords({[SLOT]:{en:FIXTURE}})).toBe(true)}
function runtime(){return new HelperRuntime(MODEL_WORDS,{dataFolder:()=>'/fixture-owned-data'})}
async function dispatch(r:MoreRuntime,$:EngineInterface,id:MoreId,enablePlain=true){
 if(id==='talk'){await r.talk($,'fixture text',AT);r.talkFromPrompt($,'sama, fixture text',AT);await r.writeDiary($,AT)}
 if(id==='explain')await r.explain($,AT,true)
 if(id==='look'){r.edit('/fixture.ts','fixture change');await r.registerLook($);await r.secondLook($)}
 if(id==='plain'){if(enablePlain)await r.style($,true);else r.press($,'coco:more:plain:help')}
 if(id==='cap')await r.capToolCall($,'fixture-turn')
 if(id==='paste'){await r.pasteEdit($,'ordinary fixture paste');await r.hidePaste($)}
 if(id==='lively')r.syncLively($,{terminal:true,awake:true,visible:true,idle:true,reducedMotion:false},()=>{})
}
test('M1 S5 missing approved model service words reject stale On before every private read or send',async()=>{
 words(false)
 try{
  for(const id of ['talk','explain','look','plain'] as const){
   const f=engine(),r=runtime();r.restore({[id]:true},[],undefined,AT);r.values[id]=true
   await dispatch(r,f.$,id)
   expect(f.calls).toEqual([])
   expect(r.press(f.$,'coco:more:'+id+':on')).toBe(false)
   r.asking=id;expect(r.press(f.$,'coco:more:'+id+':ask:yes')).toBe(false)
  }
 }finally{words(true)}
})
test('M1 S5 every More row Off makes zero model network prompt or timer calls despite other rows On',async()=>{
 words(true)
 for(const id of MORE_IDS){
  const f=engine(),r=runtime();r.restore({},[],undefined,AT)
  r.values=Object.fromEntries(MORE_IDS.filter(other=>other!==id).map(other=>[other,other==='cap'?5:true]))
  await dispatch(r,f.$,id,false)
  expect(f.calls).toEqual([])
 }
})
test('M1 S5 stale On and idle events do not call a model; each explicit Send makes exactly one completion',async()=>{
 words(true);const f=engine(),r=runtime();r.restore({talk:true},[],undefined,AT)
 expect(f.calls).toEqual([])
 r.recordDay('prompts',AT);r.recordTool('Read',AT)
 expect(f.calls).toEqual([])
 const sending=r.talk(f.$,'fixture first press',AT)
 expect(r.talk(f.$,'fixture concurrent duplicate',AT)).toBeUndefined()
 await sending;expect(f.calls.filter(name=>name==='model.complete').length).toBe(1)
 await r.talk(f.$,'fixture second press',AT)
 expect(f.calls.filter(name=>name==='model.complete').length).toBe(2)
 expect(f.calls.filter(name=>name==='http.fetch'||name==='clock.every'||name==='model.classify')).toEqual([])
})
test('M1 S5 losing disclosure while Explain selects text prevents the delayed model dispatch',async()=>{
 words(true);const f=engine(),r=runtime();r.restore({explain:true},[],undefined,AT)
 let release!:(value:{text:string})=>void
 (f.$.ui as unknown as {selection:()=>Promise<{text:string}>}).selection=async()=>{f.calls.push('ui.selection');return new Promise(resolve=>{release=resolve})}
 const pending=r.explain(f.$,AT,true);delete MORE_SLOTS[SLOT];release({text:'fixture selection'})
 try{await pending;expect(f.calls.filter(name=>name==='ui.selection')).toEqual(['ui.selection']);expect(f.calls.filter(name=>name.startsWith('model.')||name==='http.fetch'||name==='prompt.read'||name==='fs.read')).toEqual([])}finally{words(true)}
})
for(const disable of ['press','restore'] as const)test(`M1 S5 ${disable} Off invalidates a raw On request while its disclosure is unavailable`,async()=>{
 words(true);const f=engine(),r=runtime();r.restore({talk:true},['talk'],undefined,AT)
 let release!:(value:{isAnswered:true;text:string;usage:{input_tokens:number;output_tokens:number;cache_read_input_tokens:number;cache_creation_input_tokens:number}})=>void
 let signal:AbortSignal|undefined
 ;(f.$.model as unknown as {complete:(request:unknown,options?:{signal?:AbortSignal})=>Promise<unknown>}).complete=async(_request,options)=>{f.calls.push('model.complete');signal=options?.signal;return new Promise(resolve=>{release=resolve})}
 const pending=r.talk(f.$,'fixture cancelled reply',AT)
 expect(f.calls).toEqual(['model.complete']);expect(r.exchanges.length).toBe(1);expect(signal?.aborted).toBe(false)
 delete MORE_SLOTS[SLOT];expect(r.isOn('talk')).toBe(false)
 try{
  if(disable==='press')await r.press(f.$,'coco:more:talk:off');else r.restore({talk:false},['talk'],undefined,AT)
  expect(moreOn(r.values,'talk')).toBe(false)
  expect(signal?.aborted).toBe(true)
  words(true)
  if(disable==='press')await r.press(f.$,'coco:more:talk:on');else r.restore({talk:true},['talk'],undefined,AT)
  expect(r.isOn('talk')).toBe(true)
  release({isAnswered:true,text:'fixture obsolete model answer',usage:{input_tokens:1,output_tokens:1,cache_read_input_tokens:0,cache_creation_input_tokens:0}})
  await pending
  expect(r.exchanges).toEqual([])
  expect(f.calls.filter(name=>name==='model.complete')).toEqual(['model.complete'])
 }finally{release({isAnswered:true,text:'fixture obsolete model answer',usage:{input_tokens:1,output_tokens:1,cache_read_input_tokens:0,cache_creation_input_tokens:0}});await pending;words(true)}
})
