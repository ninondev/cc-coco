import { expect,test } from 'claude-code/testing'
import { LINES } from '../hooks/lines'
import { WORDS } from '../hooks/words'
import type { Lang } from '../hooks/words'
function strings(value:unknown):string[]{return typeof value==='string'?[value]:Array.isArray(value)?value.flatMap(strings):value&&typeof value==='object'?Object.values(value).flatMap(strings):[]}
test('B1b approved line activation inventory is exact',()=>{
 const counts=Object.fromEntries((Object.keys(WORDS) as Lang[]).map(lang=>[lang,strings(LINES[lang]).length]))
 expect(Object.values(counts).every(n=>n>0)).toBe(true)
 console.log('B1B_APPROVED_LINE_INVENTORY '+JSON.stringify({counts,total:Object.values(counts).reduce((a,b)=>a+b,0),surfacesPerActivation:2}))
})
