import { expect, test } from 'claude-code/testing'
import { MORE_SLOTS, installMoreWords, loadMoreWords, moreWord, moreModelWords, resetMoreWords } from '../hooks/more-words'
import { installGapWords, loadGapWords, gapWord, resetGapWords } from '../hooks/mod-gaps-words'
import { MoreRuntime, MISSING_MORE_MODEL_SLOTS } from '../hooks/more-runtime'
import type { EngineInterface } from 'claude-code'
import { M1_MORE_TEXT, M1_GAPS_TEXT } from './m1-more-data-fixture'

for (const row of [
 {name:'More',load:loadMoreWords,reset:resetMoreWords,install:installMoreWords,text:M1_MORE_TEXT,word:()=>moreWord('entry.label','en')},
 {name:'gaps',load:loadGapWords,reset:resetGapWords,install:installGapWords,text:M1_GAPS_TEXT,word:()=>gapWord('en','run.passed')},
]) {
 test('M1 '+row.name+' data reads once on demand and coalesces concurrent requests',async()=>{
  row.reset();let reads=0,release=(_value:string)=>{}
  const read=()=>{reads++;return new Promise<string>(resolve=>{release=resolve})}
  expect(reads).toBe(0);expect(row.word()).toBe('')
  const first=row.load(read),second=row.load(read)
  expect(first).toBe(second);expect(reads).toBe(1)
  release(row.text);expect(await first).toBe(true);expect(await second).toBe(true)
  expect(row.word().length>0).toBe(true);expect(await row.load(read)).toBe(true);expect(reads).toBe(1)
 })
 test('M1 '+row.name+' missing or malformed data fails closed and permits a later retry',async()=>{
  row.reset();expect(await row.load(async()=>{throw Error('fixture refusal')})).toBe(false);expect(row.word()).toBe('')
  expect(await row.load(async()=>'{')).toBe(false);expect(row.word()).toBe('')
  expect(row.install({})).toBe(false);expect(row.install({bad:{en:12}})).toBe(false)
  expect(await row.load(async()=>row.text)).toBe(true);expect(row.word().length>0).toBe(true)
 })
 test('M1 '+row.name+' reset rejects a stale pending read',async()=>{
  row.reset();let release=(_value:string)=>{}
  const held=row.load(()=>new Promise<string>(resolve=>{release=resolve}))
  row.reset();release(row.text);expect(await held).toBe(false);expect(row.word()).toBe('')
  expect(await row.load(async()=>row.text)).toBe(true)
 })
}
test('M1 authored More data retains fixture overrides and missing model slots fail closed',async()=>{
 resetMoreWords();MORE_SLOTS['more.fixture']={en:'fixture override'}
 expect(await loadMoreWords(async()=>M1_MORE_TEXT)).toBe(true)
 // The persona ships (v4 from 10-10, v7 from 10-14); Look's reader instructions ship from 10-17 (lane B).
 expect(moreWord('fixture','en')).toBe('fixture override');expect(moreWord('model.look.prompt','en').startsWith('You are a second reader')).toBe(true);expect(moreWord('model.talk.persona','en').startsWith('You are Coco')).toBe(true)
 delete MORE_SLOTS['more.fixture']
})

test('M1 cold supported Talk reads approved model instructions after constructor hydration',async()=>{
 resetMoreWords();const calls:any[]=[],now=1791273600000
 const runtime=new MoreRuntime(moreModelWords(MISSING_MORE_MODEL_SLOTS))
 runtime.restore({talk:true},['talk'],undefined,now)
 const engine={clock:{now:async()=>now,after:()=>({cancel:()=>{}})},store:{set:async()=>{}},ui:{invalidate:()=>{},log:()=>{}},model:{complete:async(request:any)=>{calls.push(request);return{isAnswered:true,text:'fixture reply',usage:{input_tokens:0,output_tokens:0,cache_read_input_tokens:0,cache_creation_input_tokens:0}}}}} as unknown as EngineInterface
 expect(runtime.talk(engine,'hello',now)).toBeUndefined();expect(calls.length).toBe(0)
 const data=JSON.parse(M1_MORE_TEXT);data['more.model.talk.persona']={en:'synthetic test talk instructions'}
 data['more.modelService.disclosure']={en:'fixture-model-service-disclosure'}
 expect(await loadMoreWords(async()=>JSON.stringify(data))).toBe(true)
 await runtime.talk(engine,'hello',now)
 expect(calls.length).toBe(1);expect(calls[0].system).toBe('synthetic test talk instructions')
 runtime.stop();resetMoreWords();await loadMoreWords(async()=>M1_MORE_TEXT)
})
