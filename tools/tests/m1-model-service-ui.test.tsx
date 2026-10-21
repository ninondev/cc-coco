import {expect,test} from 'claude-code/testing'
import {MoreEntry,MorePage,MoreTalk} from '../hooks/more-book'
import type {MoreSnapshot} from '../hooks/more-state'
import {moreRows} from '../hooks/more-state'
import {MORE_SLOTS,moreWord,moreFill} from '../hooks/more-words'
import {installM1Words,M1_MORE_TEXT} from './m1-more-data-fixture'
import {installModelServiceFixture,modelServiceFixtureText} from './m1-model-service-fixture'
import {world,settleLegacyStart,RECENT,PERSON,P} from './world'

// The second look is not drawn in 0.9.9 (EVERY-CAPABILITY 7.2; lead, 10-10), so the drawn service rows are three.
const IDS=['talk','explain','plain'] as const
const FIXTURE='fixture-model-service-disclosure',SLOT='more.modelService.disclosure'
const nodes=(tree:any):any[]=>!tree||typeof tree!=='object'?[]:Array.isArray(tree)?tree.flatMap(nodes):[tree,...(tree.children??[]).flatMap(nodes)]
const snapshot=():MoreSnapshot=>({values:{},agreed:[],today:{date:'',rows:{}},reading:0,open:true,lang:'en',screenReader:false})
const pane=(requestId:string)=>({surface:'terminal' as const,plugin:'coco',component:'Pane' as const,requestId,props:{title:'Fixture',isFocused:true,bodyColumns:100,placement:'dock' as const,scroll:{offset:0,bodyRows:100},view:{}}})
async function hydrate($:any,on:Parameters<typeof world>[0],moreText?:string):Promise<void>{
 const w=world(on,{surfaces:['terminal'],store:{...RECENT,voiceChosen:true},moreText})
 await $.session.start({cwd:'/tmp/m1-service-fixture',surface:'terminal',isInteractive:true});await settleLegacyStart($,w)
 // Exercise the shipping host's lazy read with an explicitly scoped JSON fixture.
 await $.command.run({command:'coco',args:'more',origin:PERSON,presentation:P});await settleLegacyStart($,w)
}
test('M1 S5 actual More helps and reachable confirmations disclose model service',async($,on)=>{
 installM1Words();installModelServiceFixture()
 for(const id of IDS){
  const requestId='m1-service-'+id,s={...snapshot(),focused:id,asking:id}
  on('ui.render',{component:'Pane',requestId},($,e)=>MorePage($.ui.resolve(e) as any,{surface:e.surface,snapshot:s}))
 }
 const requestId='m1-service-talk-disclosure'
 on('ui.render',{component:'Pane',requestId},($,e)=>MoreTalk($.ui.resolve(e) as any,{surface:e.surface,snapshot:snapshot(),exchanges:[],name:'Fixture'}))
 await hydrate($,on,modelServiceFixtureText())
 for(const id of IDS){
  const requestId='m1-service-'+id
  const ui=await $.ui.mount(pane(requestId))
  console.log('M1_S5_UI_PHASE disclosure-help '+id)
  expect(await ui.find({type:'Text',text:moreWord(id+'.help','en')+'\n'+FIXTURE})).toBeDefined()
  const ask=moreFill(moreWord(id+'.ask','en')||(id==='plain'?moreWord('plain.help','en')+'\n'+moreWord('plain.cost','en'):''),{n:0})
  console.log('M1_S5_UI_PHASE disclosure-confirmation '+id)
  expect(await ui.find({type:'Text',text:ask+'\n'+FIXTURE})).toBeDefined()
  expect(await ui.find({type:'Button',key:'coco:more:'+id+':ask:yes'})).toBeDefined()
  await ui.unmount()
 }
 const ui=await $.ui.mount(pane(requestId))
 expect(await ui.find({type:'Text',text:moreWord('talk.disclosure','en')+'\n'+FIXTURE})).toBeDefined()
 await ui.unmount()
})
test('M1 S5 missing approved disclosure keeps every stale On row Off and removes stale confirmations and Talk Send',async($,on)=>{
 installM1Words();delete MORE_SLOTS[SLOT]
 for(const id of IDS){
  const requestId='m1-service-missing-'+id,s={...snapshot(),values:{[id]:true},focused:id,asking:id}
  on('ui.render',{component:'Pane',requestId},($,e)=>MorePage($.ui.resolve(e) as any,{surface:e.surface,snapshot:s}))
 }
 const requestId='m1-service-missing-talk'
 on('ui.render',{component:'Pane',requestId},($,e)=>MoreTalk($.ui.resolve(e) as any,{surface:e.surface,snapshot:{...snapshot(),values:{talk:true}},exchanges:[],name:'Fixture'}))
 await hydrate($,on)
 for(const id of IDS){
  const requestId='m1-service-missing-'+id
  const ui=await $.ui.mount(pane(requestId))
  expect(await ui.find({type:'Button',key:'coco:more:'+id+':on'})).toBeUndefined()
  expect(await ui.find({type:'Button',key:'coco:more:'+id+':ask:yes'})).toBeUndefined()
  const row=nodes(await ui.drawn()).find(node=>node.props?.key==='coco:more:row:'+id)
  console.log('M1_S5_UI_PHASE missing-row '+id)
  expect(row).toBeDefined()
  const texts=nodes(row).filter(node=>node.type==='Text').flatMap(node=>node.children??[])
  expect(texts).toContain(moreWord('cap.off','en'))
  expect(texts).not.toContain(moreWord(id==='plain'?'plain.inUse':'on','en'))
  await ui.unmount()
 }
 const ui=await $.ui.mount(pane(requestId))
 expect(await ui.find({type:'Button',key:'coco:talk:send'})).toBeUndefined()
 await ui.unmount()
})
test('M1 S5 More entry counts zero available service options when four stale stored flags remain On',async($,on)=>{
 installM1Words();delete MORE_SLOTS[SLOT]
 const requestId='m1-service-missing-entry',s={...snapshot(),values:Object.fromEntries(IDS.map(id=>[id,true]))}
 on('ui.render',{component:'Pane',requestId},($,e)=>MoreEntry($.ui.resolve(e) as any,{surface:e.surface,snapshot:s}))
 await hydrate($,on)
 const ui=await $.ui.mount(pane(requestId))
 expect(await ui.find({type:'Text',text:moreFill(moreWord('entry.count','en'),{on:0,total:moreRows('terminal').length})})).toBeDefined()
 await ui.unmount()
})

// The shipped words (groups-i-1010, 10-10; reworded with no model named, his 10-17 「都通过」): the model rows' disclosure stands under each model row's help and in its
// asks-once confirmation; with the owner's persona (10-10) Talk asks once like the others.
const SERVICE={en:'Your text is sent to the same model service this conversation uses.',zh:'你的文字会发给模型服务,和这个对话用的是同一个。'} as const
for(const lang of ['en','zh'] as const)test(`M1 S5 the shipped model-service disclosure stands under each model row's help and in its asks-once confirmation: ${lang}`,async($,on)=>{
 installM1Words()
 const shipped=JSON.parse(M1_MORE_TEXT) as Record<string,Record<string,string>>,old=MORE_SLOTS[SLOT]
 expect(shipped[SLOT]?.[lang]).toBe(SERVICE[lang])
 expect(shipped['more.received.disclosure']?.[lang]).not.toBe(SERVICE[lang])
 const persona=MORE_SLOTS['more.model.talk.persona'];MORE_SLOTS['more.model.talk.persona']=shipped['more.model.talk.persona']!
 MORE_SLOTS[SLOT]=shipped[SLOT]!
 try{
  for(const id of IDS){
   const s={...snapshot(),lang,focused:id,asking:id}
   on('ui.render',{component:'Pane',requestId:`m1-service-shipped-${lang}-${id}`},($,e)=>MorePage($.ui.resolve(e) as any,{surface:e.surface,snapshot:s}))
  }
  for(const id of IDS){
   const ui=await $.ui.mount(pane(`m1-service-shipped-${lang}-${id}`))
   expect(await ui.find({type:'Text',text:moreWord(id+'.help',lang)+'\n'+SERVICE[lang]})).toBeDefined()
    const ask=moreFill(moreWord(id+'.ask',lang)||(id==='plain'?moreWord('plain.help',lang)+'\n'+moreWord('plain.cost',lang):''),{n:0})
    expect(await ui.find({type:'Text',text:ask+'\n'+SERVICE[lang]})).toBeDefined()
    expect(await ui.find({type:'Button',key:'coco:more:'+id+':ask:yes'})).toBeDefined()
   await ui.unmount()
  }
 }finally{if(old)MORE_SLOTS[SLOT]=old;else delete MORE_SLOTS[SLOT];if(persona)MORE_SLOTS['more.model.talk.persona']=persona}
})
