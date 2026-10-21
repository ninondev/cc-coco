import { installM1Words, M1_MORE_TEXT } from './m1-more-data-fixture'
import { installModelServiceFixture } from './m1-model-service-fixture'
import { describe, expect, test } from 'claude-code/testing'
import type { EngineInterface, ModelUsage } from 'claude-code'
import { MoreRuntime, MISSING_MORE_MODEL_SLOTS, TALK_SHARED_COCO } from '../hooks/more-runtime'
import { MoreTalk } from '../hooks/more-book'
import { claudieName, gapCharacterName } from '../hooks/mod-gaps-words'
import { moreWord } from '../hooks/more-words'
import { keyMessages } from '../hooks/talk-key'

// Claudie in the DMs (owner 10-21): once her gown or maid outfit is worn she answers in the same chat as Coco, with her
// form's persona, her own first-message cue, notes and opener lines; every one of his messages keeps who wrote it, and
// the other character's replies reach the model under their name.
installM1Words()
installModelServiceFixture()
const SHIPPED=JSON.parse(M1_MORE_TEXT) as Record<string,Record<string,string>>
const en=(slot:string)=>SHIPPED[slot]!.en!
const COCO=en('more.model.talk.persona'),GOWN=en('more.model.talk.persona.dake'),MAID=en('more.model.talk.persona.maid')
const COMPACT=en('more.model.talk.compact.claudie')
const AT=Date.UTC(2026,9,21,10,0)
const USAGE:ModelUsage={input_tokens:900,output_tokens:40,cache_read_input_tokens:0,cache_creation_input_tokens:0}
type Request={system?:string;prompt:string}
function runtime(answer:(request:Request)=>string){
 const requests:Request[]=[]
 const $={
  clock:{now:async()=>AT,after:()=>({cancel:()=>{}})},
  store:{get:async()=>undefined,set:async()=>{}},
  model:{complete:async(request:Request)=>{requests.push(request);return{isAnswered:true,text:answer(request),usage:USAGE}}},
  ui:{invalidate:()=>{}},
  prompt:{fill:async()=>{}},
 } as unknown as EngineInterface
 // The shipped words themselves (the model-service fixture swaps Coco's persona for a stand-in).
 const r=new MoreRuntime(Object.fromEntries(MISSING_MORE_MODEL_SLOTS.map(slot=>[slot,SHIPPED[slot]?.en])));r.restore({talk:true},[],undefined,AT)
 return{$,r,requests}
}

describe('Claudie in the DMs',()=>{
 test('her two personas, her cue and her notes ship, the same English in every language (her name in Traditional script for zh-Hant), each persona under the limit',()=>{
  for(const slot of ['more.model.talk.persona.dake','more.model.talk.persona.maid','more.model.talk.first.claudie','more.model.talk.compact.claudie'])
   // Traditional Chinese gets her Chinese name in its own script (克勞德); every other language has the English as is.
   for(const lang of Object.keys(SHIPPED['more.model.talk.persona']!))expect(SHIPPED[slot]![lang]).toBe(lang==='zh-Hant'?en(slot).replaceAll('克劳德','克勞德'):en(slot))
  for(const persona of [GOWN,MAID]){
   expect(new TextEncoder().encode(persona).length<=10000).toBe(true)
   expect(/a line with only --- between/i.test(persona)).toBe(true)
   expect(persona.includes('marked with Coco')).toBe(true)
  }
  expect(GOWN).not.toBe(MAID);expect(en('more.model.talk.first.claudie').includes('{moment}')).toBe(true)
 })
 test('worn, she answers with her form\'s persona; Coco\'s earlier reply reaches her marked [Coco], hers is kept as hers',async()=>{
  const {$,r,requests}=runtime(()=>'Tea first.')
  await r.talk($,'hi coco',AT)
  expect(requests[0]!.system).toBe(COCO);expect(r.exchanges.at(-1)).toEqual({side:'him',text:'Tea first.'})
  r.setLinesForm('maid')
  await r.talk($,'oh, you changed',AT)
  expect(requests[1]!.system).toBe(MAID)
  expect(requests[1]!.prompt.includes('him: [Coco] Tea first.\n')).toBe(true)
  expect(r.exchanges.at(-1)).toEqual({side:'him',text:'Tea first.',who:'claudie'})
  r.setLinesForm('dake')
  await r.talk($,'and the gown',AT)
  // Her other outfit is still her: her own maid reply is not marked.
  expect(requests[2]!.system).toBe(GOWN);expect(requests[2]!.prompt.includes('him: Tea first.\n')).toBe(true)
 })
 test('back to Coco: her replies are marked [Claudie] and Coco is told whose they are',async()=>{
  const {$,r,requests}=runtime(()=>'Hm.')
  r.setLinesForm('dake')
  await r.talk($,'hello',AT)
  r.setLinesForm(undefined)
  await r.talk($,'coco?',AT)
  expect(requests[1]!.system).toBe(COCO+'\n\n'+TALK_SHARED_COCO)
  expect(requests[1]!.prompt.includes('him: [Claudie] Hm.\n')).toBe(true)
  expect(r.exchanges.at(-1)).toEqual({side:'him',text:'Hm.'})
 })
 test('the key path marks the other one the same way',()=>{
  const messages=keyMessages([{side:'person',text:'hi'},{side:'him',text:'[Coco] yo'}],'and you?')
  expect(messages.map(m=>m.content)).toEqual(['hi','[Coco] yo','and you?'])
 })
 test('a long chat while she is worn compacts with her own instruction',async()=>{
  const {$,r,requests}=runtime(request=>request.system===COMPACT?'NOTES':'Mm.')
  r.setLinesForm('dake')
  r.exchanges=Array.from({length:100},(_,i)=>({side:i%2?'him' as const:'person' as const,text:`line ${i} `.padEnd(1000,'w')}))
  await r.talk($,'hello',AT)
  expect(requests[0]!.system).toBe(COMPACT);expect(requests[0]!.prompt.includes('him: [Coco] line 1 ')).toBe(true)
  expect(requests[1]!.system).toBe(GOWN)
 })
 test('who wrote what is remembered across sessions',async()=>{
  const {$,r}=runtime(()=>'Welcome back.')
  r.setLinesForm('maid')
  await r.talk($,'hi',AT)
  const memory=r.talkMemory()!
  expect(memory.exchanges.at(-1)).toEqual({side:'him',text:'Welcome back.',who:'claudie'})
  const next=runtime(()=>'')
  next.r.restoreTalk(JSON.parse(JSON.stringify(memory)))
  expect(next.r.exchanges.at(-1)!.who).toBe('claudie');expect(next.r.talkView.at(-1)!.who).toBe('claudie')
  next.r.restoreTalk(undefined);const odd=runtime(()=>'');odd.r.restoreTalk({exchanges:[{side:'him',text:'x',who:'someone'}]})
  expect(odd.r.exchanges[0]).toEqual({side:'him',text:'x'})
 })
 test('the thread names each run of his messages after who wrote it, and the dots after who answers now',()=>{
  const E={Box:(p:any)=>({type:'Box',props:p}),Text:(p:any)=>({type:'Text',props:p}),Button:(p:any)=>({type:'Button',props:p})} as any
  const {r}=runtime(()=>'')
  const texts=(node:any):string[]=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(texts):[...(node.type==='Text'&&node.props?.bold?[String(node.props.children)]:[]),...texts(node.props?.children)]
  const tree=MoreTalk(E,{snapshot:r.snapshot(),surface:'terminal',exchanges:[{side:'him',text:'a'},{side:'him',text:'b'},{side:'him',text:'c',who:'claudie'},{side:'person',text:'d'},{side:'him',text:'e',who:'claudie'}],name:'Coco',claudieName:'Claudie',who:'claudie',writing:true} as any)
  // Coco over a and b, Claudie over c, Claudie again over e after the person's d; the dots follow e, so no name.
  expect(texts(tree).filter(t=>t==='Coco'||t==='Claudie')).toEqual(['Coco','Claudie','Claudie'])
 })
 test('her names as others call her, and her opener lines in every group for both forms',()=>{
  expect(claudieName('zh')).toBe('大克');expect(claudieName('ja')).toBe('Claudeさま');expect(claudieName('ko')).toBe('클로디')
  expect(claudieName('en')).toBe('Claudie');expect(claudieName('fr')).toBe('Claudette');expect(gapCharacterName('zh')).toBe('小克')
  const groups=['first','morning','day','night','weekend','away','bigJob','green','red','calmed','ultrathink','compacted','quotaLow','quotaOut','quiet','refused']
  for(const form of ['dake','maid'])for(const group of groups)for(const lang of ['zh','zh-Hant','en']){
   const lines=[0,1,2].map(i=>moreWord(`talk.${form}.open.${group}.${i}`,lang))
   expect(lines.every(Boolean)).toBe(true)
   if(group==='night')expect(lines.every(line=>line.includes('{time}'))).toBe(true)
  }
  expect(moreWord('talk.dake.open.first.0','zh').includes('克劳德')).toBe(true)
 })
})
