import { expect, test } from 'claude-code/testing'
import { planDesktop } from '../hooks/band'
import { initialView } from '../hooks/mood'
import { C3_WORDS_RAW } from './c3-words-fixture'
const corpus=JSON.parse(C3_WORDS_RAW),file='plugin/hooks/config.ts',key='guard.secretAfter'
const quota={rateLimits:[{kind:'five_hour',percentUsed:72},{kind:'seven_day',percentUsed:41}],costUSD:1.84,at:Date.UTC(2026,9,2,9)}
const plan=(columns:number)=>{
 const spoken=corpus[key].ko.replace('{file}',file).replace('{line}','17')
 return planDesktop({...initialView(),lang:'ko' as const,context:56,band:'on' as const,workSize:'smaller' as const,quota,line:{id:key,key,text:spoken,class:3 as const,slots:[{value:file,kind:'path' as const},{value:'17',kind:'value' as const}],expiresAt:14000}},{columns,maxRows:30,screenRows:48,isWorking:true})
}
for(const columns of [38,54]){
 test(`W4 part3 Korean secret/${columns} retains the authored warning word and particle`,()=>{
  const p=plan(columns),speech=p.speech??''
  expect(speech.includes('비밀 정보가')).toBe(true)
 })
 test(`W4 part3 Korean secret/${columns} keeps line17 whole without borrowing a filename label`,()=>{
  const p=plan(columns),speech=p.speech??''
  expect(speech.includes('17행')).toBe(true)
  expect(/(?:^|\s)ts,\s*17행/u.test(speech)).toBe(false)
  if(speech.includes('config.ts'))expect(p.parts?.some(part=>part.slot&&part.sourceValue===file&&part.text.includes('config.ts'))).toBe(true)
  expect(p.parts?.filter(part=>part.slot&&part.sourceValue==='17').length).toBe(1)
 })
}
