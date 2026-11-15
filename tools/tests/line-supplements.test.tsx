import {test,expect} from 'claude-code/testing'
import type {EngineInterface} from 'claude-code'
import {installM1Words} from './m1-more-data-fixture'
import {installModelServiceFixture} from './m1-model-service-fixture'
import {LINE_SUPPLEMENTS} from '../hooks/line-supplements'
import {installWritten,installEdited,useWritten,libraryLines,lineImportPreview,linesText} from '../hooks/line-library'
import {initialView,linesFor} from '../hooks/mood'
import {companionRecord,companionWakeLines} from '../hooks/companion'
import {MoreRuntime} from '../hooks/more-runtime'
installM1Words()
installModelServiceFixture()
const AT=Date.UTC(2026,9,17,12)
const PROMPTS={'more.model.lines.coco':'fixture coco instruction','more.model.lines.dake':'fixture dake instruction','more.model.lines.maid':'fixture maid instruction'}
// An engine that only holds stored rows; the line tests never call the model.
function storeEngine(){
 const stored:Record<string,unknown>={}
 const $={clock:{now:async()=>AT,after:()=>({cancel:()=>{}})},store:{get:async(key:string)=>stored[key],set:async(key:string,value:unknown)=>{stored[key]=structuredClone(value)}},model:{complete:async()=>{throw Error('no model')}},fs:{exists:async()=>false,read:async()=>{throw Error('missing')},write:async()=>{},stat:async()=>{throw Error('missing')}},ui:{invalidate:()=>{},log:()=>{}}} as unknown as EngineInterface
 return{$,stored}
}

test('Approved Chinese supplements round-trip as 12 lines per character, including idle',()=>{
 for(const [character,set] of Object.entries(LINE_SUPPLEMENTS.zh)){
  const imported=lineImportPreview(linesText('',set as unknown as Record<string,string[]>))
  expect(imported.accepted).toBe(12);expect(imported.rejected).toBe(0)
  expect(imported.lines).toEqual(set)
  expect(JSON.stringify(set).includes('轻薄本')).toBe(false)
 }
})

test('Fish follows its own library and existing on, off, language and only choices',()=>{
 installEdited(undefined);installWritten('fish',undefined);useWritten(false)
 const view={...initialView(),lang:'zh' as const,character:'fish' as const}
 try{
  expect(linesFor(view,'start')).toEqual([])
  useWritten(true)
  expect(linesFor(view,'start')).toEqual(LINE_SUPPLEMENTS.zh.fish.start)
  expect(linesFor(view,'idle')).toEqual(LINE_SUPPLEMENTS.zh.fish.idle)
  expect(libraryLines('fish','en','start',false)).toEqual([])
  installWritten('fish',{start:['own fish line']});useWritten(true,'only')
  expect(linesFor(view,'start')).toEqual(['own fish line'])
  expect(linesFor(view,'idle')).toEqual([])
  expect(companionRecord(view).lineLibrary.start).toEqual(['own fish line'])
  expect(companionRecord(view).character).toBe('fish')
  useWritten(false)
  expect(companionRecord(view).lineLibrary.start).toEqual([])
 }finally{installWritten('fish',undefined);useWritten(false)}
})

test('Coco keeps its clingy wake fallback',()=>{
 installEdited(undefined);installWritten('coco',undefined);useWritten(false)
 try{
  const coco={...initialView(),lang:'zh' as const,affection:'clingy' as const}
  const warm=linesFor({...coco,affection:'warm'},'wake')
  // Coco's shipped wake lines are the same warm and clingy, so the legacy fallback applies
  expect(companionWakeLines(coco).length).toBeGreaterThan(0)
  expect(companionWakeLines({...coco,affection:'warm'})).toEqual(warm)
 }finally{installWritten('coco',undefined);useWritten(false)}
})

test('Supplemental lines follow the selected line language, not the UI language, both ways',async()=>{
 const f=storeEngine(),r=new MoreRuntime(PROMPTS);r.restore({lines:true},['lines'],undefined,AT)
 try{
  // UI zh, selected line language ja: ja has no supplements, so nothing is said
  r.configure('zh');r.setLinesForm('dake');r.restoreLines({lang:'ja'})
  expect(linesFor({...initialView(),lang:'zh',claudie:'dake'},'start')).toEqual([])
  // UI en, selected line language zh: the zh supplements are said
  r.configure('en');r.restoreLines({lang:'zh'})
  expect(linesFor({...initialView(),lang:'en',claudie:'dake'},'start')).toEqual(LINE_SUPPLEMENTS.zh.dake.start)
  // fish follows the same rule
  r.setLinesForm(undefined,'fish')
  expect(linesFor({...initialView(),lang:'en',character:'fish'},'start')).toEqual(LINE_SUPPLEMENTS.zh.fish.start)
  // switching the row off stays silent, back on says them again
  expect(await r.press(f.$,'coco:more:lines:off')).toBe(true)
  expect(linesFor({...initialView(),lang:'en',character:'fish'},'start')).toEqual([])
  expect(await r.press(f.$,'coco:more:lines:on')).toBe(true)
  expect(linesFor({...initialView(),lang:'en',character:'fish'},'start')).toEqual(LINE_SUPPLEMENTS.zh.fish.start)
  // a custom imported set overrides the supplements while on; UI en, selected zh
  r.setLinesForm('dake');r.restoreLines({lang:'zh',imported:{'dake:zh':{text:linesText('',{start:['my own start']}),on:true}}})
  expect(linesFor({...initialView(),lang:'en',claudie:'dake'},'start')).toEqual(['my own start'])
  // imported disabled: the imported set is not said, and the supplements are said again as before
  expect(await r.pressLinesImport(f.$,'off')).toBe(true)
  expect(linesFor({...initialView(),lang:'en',claudie:'dake'},'start')).toEqual(LINE_SUPPLEMENTS.zh.dake.start)
 }finally{r.restoreLines(undefined)}
})

test('Coco clingy fallback is Coco only; imported fish wake lines survive clingy affection',()=>{
 installEdited(undefined);installWritten('fish',undefined);useWritten(false)
 try{
  // a fish wake set imported and on, clingy: the lines are still said
  installWritten('fish',{wake:['fish wake one','fish wake two']});useWritten(true,'both')
  const fish={...initialView(),lang:'zh' as const,character:'fish' as const,affection:'clingy' as const}
  expect(companionWakeLines(fish)).toEqual(['fish wake one','fish wake two'])
  expect(linesFor(fish,'wake')).toEqual(['fish wake one','fish wake two'])
  expect(companionRecord(fish).wakeLines).toEqual(['fish wake one','fish wake two'])
  // disabled: silent, not the Coco clingy lines
  useWritten(false)
  expect(companionWakeLines(fish)).toEqual([])
  expect(linesFor(fish,'wake')).toEqual([])
  expect(companionRecord(fish).wakeLines).toEqual([])
 }finally{installWritten('fish',undefined);useWritten(false)}
})
