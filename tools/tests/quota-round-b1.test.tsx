import { describe, expect, test } from 'claude-code/testing'
import * as Words from '../hooks/words'
import { LANGS } from '../hooks/words'
import { pageBlocks, type BookData } from '../hooks/book'
import type { BookWords } from '../hooks/book-words'
import { BOOK_TEXT } from '../hooks/book-text'
const q = Words as unknown as {
  quotaDetailGroups: (lang: string, windows: {kind: string; percentUsed:number; resetsAt?:number|string}[], tokens?:number, costUSD?:number, narrow?:boolean, now?:number) => string[]
  quotaIncenseAlt: (lang:string,windows:{kind:string;percentUsed:number}[])=>string
  quotaDuration: (lang:string,ms:number)=>string
  quotaTokens: (lang:string,n:number)=>string
}
const now = 1000000
const windows = [{kind:'five_hour',percentUsed:15,resetsAt:now+16200000},{kind:'seven_day',percentUsed:75,resetsAt:now+183600000}]
describe('the authors quota words in laid-out groups',()=>{
 test('owner exact example, subscription honesty and multilingual units',()=>{
  expect(q.quotaDetailGroups('zh',windows,182000,1.42,false,now)).toEqual(['5小时额度 耗15%, 4时30分后重置','7天额度 耗75%, 2天3时后重置','本场 18.2万token, 折合US$1.42'])
  expect(q.quotaDetailGroups('en',windows,182000,1.42,false,now)).toEqual(['5-hour window 15% used, resets in 4h 30m','7-day window 75% used, resets in 2d 3h','This session 182k tokens, $1.42 at API prices'])
  expect(q.quotaDetailGroups('ja',windows,182000,1.42,false,now)).toEqual(['5時間の枠 15%使用、あと4時間30分でリセット','7日間の枠 75%使用、あと2日3時間でリセット','このセッション 18.2万トークン、API料金換算 $1.42'])
  expect(q.quotaIncenseAlt('zh',windows)).toBe('5小时额度耗15%, 7天额度耗75%')
  expect(q.quotaIncenseAlt('en',windows)).toBe('5-hour window 15% used, 7-day window 75% used')
  expect(q.quotaIncenseAlt('ja',windows)).toBe('5時間の枠 15%使用、7日間の枠 75%使用')
 })
 // BAND F1 (10-09): an unknown cost leaves its group out; the band never draws a placeholder, so no dash group is returned.
 test('API keys show only cost; unknown cost leaves its group out and missing reset stays absent',()=>{
  expect(q.quotaDetailGroups('zh',[{kind:'five_hour',percentUsed:15,resetsAt:new Date(now+16200000).toISOString()}],undefined,undefined,false,now)).toEqual(['5小时额度 耗15%, 4时30分后重置'])
  expect(q.quotaDetailGroups('zh',[],182000,1.42,false,now)).toEqual(['花费US$1.42'])
  expect(q.quotaDetailGroups('en',[],182000,1.42,false,now)).toEqual(['spent $1.42'])
  expect(q.quotaDetailGroups('ja',[],182000,1.42,false,now)).toEqual(['費用 $1.42'])
  expect(q.quotaDetailGroups('zh',[],182000,undefined,false,now)).toEqual([])
  expect(q.quotaDetailGroups('zh',[{kind:'five_hour',percentUsed:15}],undefined,undefined,false,now)).toEqual(['5小时额度 耗15%'])
  expect(q.quotaDetailGroups('zh',windows,182000,1.42,true,now)).toEqual(['5小时 耗15%','一周 耗75%','折合US$1.42'])
  expect(q.quotaDetailGroups('zh',[{kind:'spend_limit',percentUsed:30}],undefined,undefined,false,now)).toEqual(['花费上限 耗30%'])
 })
 test('book preserves the actual-vs-equivalent cost distinction',()=>{
  // The book names a payer before it shows dollars (W5): API keys see the actual cost, a plan sees the API-price
  // equivalent (the Chinese lines carry «API价» / «API價» since groups-f-1009.json, so the plan figure shows there too).
  const snapshot = (kind: 'api' | 'plan') => ({ billing: { kind }, cache: { observed: false, state: 'cold', sentAt: 0, warmUntil: 0, ttlMs: 300000, prefix: 0 }, warmEnabled: false, sessionUSD: 1.42 })
  const texts = (lang: string, kind: 'api' | 'plan') => {
   const data = { view:{lang}, cost:snapshot(kind), usage:{rateLimits: kind === 'plan' ? [{kind:'five_hour',percentUsed:15}] : [],cost:{usd:1.42}}, store:{},now,timeZone:'UTC',marks:'off',voiceSizes:{light:0,full:0},fortune:undefined,reading:0,own:Words.WORDS[lang as keyof typeof Words.WORDS],reducedMotion:true } as unknown as BookData
   return pageBlocks('offerings',BOOK_TEXT[lang] as BookWords,data).flatMap(block=>'text' in block ? [block.text] : [])
  }
  for (const [lang, api, subscription] of [
   ['zh','目前花费:$1.42','目前折合API价:$1.42'],
   ['zh-Hant','目前花費:$1.42','目前折合API價:$1.42'],
   ['en','Cost so far: $1.42','At API prices so far: $1.42'],
   ['ja','ここまでの費用:$1.42','ここまでのAPI料金換算:$1.42'],
  ] as const){
   expect(texts(lang,'api')).toContain(api)
   expect(texts(lang,'plan')).toContain(subscription)
  }
 })
 test('duration and token examples are exact and every translation is complete',()=>{
  expect(q.quotaDuration('zh',1500000)).toBe('25分')
  expect(q.quotaDuration('en',1500000)).toBe('25m')
  expect(q.quotaDuration('ja',1500000)).toBe('25分')
  expect(q.quotaTokens('zh',3400)).toBe('3,400')
  expect(q.quotaTokens('en',182000)).toBe('182k')
  for(const {code} of LANGS){
   const words = Words.WORDS[code] as unknown as {hover:{poke:string;pat:string;close:string};touch:{poked:string;patted:string;flustered:string}}
   expect(Object.values(words.hover).every(Boolean)).toBe(true)
   expect(Object.values(words.touch).every(Boolean)).toBe(true)
   expect(q.quotaDetailGroups(code,windows,182000,1.42,false,now).length).toBe(3)
  }
 })
})
