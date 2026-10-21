import { expect, test } from 'claude-code/testing'
import { planDesktop } from '../hooks/band'
import { initialView } from '../hooks/mood'
// Lines that open on an authored pause, kept as fixed samples from the earlier lines: the Coco lines (10-14) have none,
// and what is tested here is how the fitter cuts such a line.
const cases=[
 {lang:'de',source:'…wer hat das geschrieben.',band:'compact'},
 {lang:'de',source:'…Entschuldigung. Vorbei.',band:'on'},
 {lang:'id',source:'…oke. *pitanya dilonggarkan*',band:'compact'},
 {lang:'it',source:'…chi ha scritto questa roba.',band:'compact'},
 {lang:'it',source:'…va bene. *allenta il fiocco*',band:'compact'},
] as const
for(const item of cases)for(const context of [34,91])test(`W4 part3 ${item.lang}/${item.band}/${context} leading authored pause retains useful ordered speech`,()=>{
 const source=item.source.replace(/\*([^*\n]+)\*/g,'$1')
 expect(source.startsWith('…')).toBe(true)
 const view={...initialView(),lang:item.lang,context,band:item.band,said:item.source}
 const spoken=planDesktop(view,{columns:38,maxRows:30,screenRows:48,isWorking:false}).speech??''
 expect(/[\p{L}\p{N}]/u.test(spoken)).toBe(true)
 expect((spoken.match(/…/gu)??[]).length).toBeLessThanOrEqual(1)
 if(spoken!==source){
  expect(spoken.endsWith('…')).toBe(true)
  expect(source.slice(1).startsWith(spoken.slice(0,-1))).toBe(true)
  expect(spoken).not.toBe('…')
 }
})

// BAND 3.2 (10-09): his name stands on the cue line and his line has the column's two rows under it, so the whole authored
// pause is kept in two rows without the name having to yield.
for(const context of [34,91])for(const isWorking of [false,true])test(`W4 part3 French/${context}/${isWorking?'working':'rest'} preserves the whole authored pause in the column's two rows`,()=>{
 const source='…bon. *desserre le nœud*',spoken=source.replace(/\*([^*\n]+)\*/g,'$1')
 const size={columns:38,maxRows:30,screenRows:48,isWorking}
 const view={...initialView(),lang:'fr' as const,context,said:source}
 const p=planDesktop(view,size)
 expect(p.speech).toBe(spoken)
 expect([undefined,'Coco']).toContain(p.name) // his name stands or goes by the room the cue line has
 expect(p.lineRows).toBe(2)
 expect((p.speech?.match(/…/gu)??[]).length).toBe(1)
})
