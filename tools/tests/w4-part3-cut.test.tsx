import { expect, test } from 'claude-code/testing'
import { planDesktop } from '../hooks/band'
import { initialView } from '../hooks/mood'
import { C3_WORDS_RAW } from './c3-words-fixture'

const corpus=JSON.parse(C3_WORDS_RAW)
const size=(columns:number)=>({columns,maxRows:30,screenRows:48,isWorking:true})
const path='~/Claude/Projects/atlas/plugin/assets/build'
for(const columns of [38,54])test(`W4 part3 path omissions do not hide a sentence cut at ${columns} columns`,()=>{
 const spoken=corpus['guard.rm'].en.replace('{target}',path)
 const view={...initialView(),lang:'en' as const,context:56,band:'on' as const,workSize:'smaller' as const,line:{id:'guard.rm',key:'guard.rm',class:3 as const,text:spoken,slots:[{value:path,kind:'path' as const}],expiresAt:14000}}
 const p=planDesktop(view,size(columns)),shown=p.speech!
 const rewritten=p.parts?.map(part=>part.slot&&part.sourceValue?part.sourceValue:part.text).join('')??shown
 // A fully retained sentence may end at its original full stop. A sentence cut
 // short must have its own omission mark, independently of a shortened path.
 expect(shown.endsWith('…')||rewritten.endsWith(path+'.')||rewritten.endsWith('It cannot be undone.')).toBe(true)
 if(shown.includes('It cannot')&&!shown.includes('It cannot be undone.'))expect(shown.endsWith('…')).toBe(true)
})
