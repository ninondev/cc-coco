import {expect,test} from 'claude-code/testing'
import {BAND_INPUT_LIMIT,safeBandText,safeBandSpeech,fitBandSlotLength,bandSlotFitLengths,planDesktop,terminalBand,desktopBand,cutTerminalDirection,cutDirection,shortenSlot,wrappedRows,terminalWrapRows} from '../hooks/band'
import {DESKTOP_LIMITS,validateDesktopTree} from '../hooks/desktop-safe'
import {initialView} from '../hooks/mood'

const size={columns:180,maxRows:30,screenRows:48,isWorking:false}
const ui=Object.fromEntries(['Box','Text','Svg','Button','Markdown','Raster','Image'].map(type=>[type,type])) as any
;(globalThis as any).m1Element=(type:any,props:any,...children:any[])=>({type,props:props??{},children:children.flat(Infinity)})
function texts(node:any):string {if(typeof node==='string')return node;if(!node||typeof node!=='object')return '';return (node.children??[]).map(texts).join('')}
function alts(node:any):string {if(!node||typeof node!=='object')return '';return String(node.props?.alt??'')+(node.children??[]).map(alts).join('')}
function view(text:string,slots:{value:string;kind:'path'|'test'|'todo'|'value'|'label'}[]=[]){return {...initialView(),lang:'en' as const,context:null,line:{id:'fixture',key:'guard.rm',text,class:3 as const,expiresAt:10000,slots}}}

test('M1 S1 band limits preprocessing to the existing text and slot transport budget',()=>{
 const giant='a'.repeat(1_000_000)
 const result=safeBandSpeech(giant,{slots:[{value:giant,kind:'test'},...Array.from({length:50},()=>({value:'small',kind:'label' as const}))]})
 expect(BAND_INPUT_LIMIT).toBe(DESKTOP_LIMITS.text)
 expect(result.text.length).toBeLessThanOrEqual(10000)
 expect(result.text.endsWith('…')).toBe(true)
 expect(result.fit.slots!.length).toBeLessThanOrEqual(12)
 expect(result.fit.slots!.some(slot=>slot.value===giant)).toBe(false)
 const giantControls='bad\n\t'+'x'.repeat(20000)
 const omitted=safeBandSpeech(giantControls,{slots:[{value:giantControls,kind:'test'}]})
 expect(omitted.text.startsWith('bad\\u000a\\u0009')).toBe(true)
 expect(omitted.text.includes('\n')).toBe(false);expect(omitted.text.includes('\t')).toBe(false)
 expect(safeBandSpeech('authored\nline',{slots:[]}).text).toBe('authored\nline')
})

test('M1 S1 band fit visits at most sixteen actual long-path states and retains the twelve-character floor',()=>{
 const slot={value:'/one/'+'very-long-directory/'.repeat(480)+'final-file-name.ts',kind:'path' as const}
 const lengths=bandSlotFitLengths([slot]);let calls=0,selected=0
 const result=fitBandSlotLength(slot.value.length,length=>{calls++;selected=length;return shortenSlot(slot.value,slot.kind,length)==='final-file-name.ts'},lengths)
 expect(shortenSlot(slot.value,slot.kind,result)).toBe('final-file-name.ts');expect(selected).toBe(result);expect(calls).toBeLessThanOrEqual(16)
 calls=0;expect(fitBandSlotLength(slot.value.length,length=>{calls++;selected=length;return false},lengths)).toBe(12)
 expect(selected).toBe(12);expect(calls).toBeLessThanOrEqual(16)
 expect(lengths.length).toBeLessThanOrEqual(16)
 const scalar=bandSlotFitLengths([{value:'x'.repeat(BAND_INPUT_LIMIT),kind:'test'}])
 expect(scalar.length).toBeLessThanOrEqual(BAND_INPUT_LIMIT)
})

test('M1 S1 band fit chooses the same largest fitting length as the original decrement oracle',()=>{
 for(const maximum of [12,13,31,128,513,10000])for(const threshold of [0,11,12,13,29,127,512,9999,10000]){
  let expected=12;for(let length=maximum;length>=12;length--)if(length<=threshold){expected=length;break}
  expect(fitBandSlotLength(maximum,length=>length<=threshold)).toBe(expected)
 }
 // The oracle uses the actual shipped slot formatter and both surface fitters.
 // Each outcome must equal the old descending search, including a failed floor.
 const fixtures=[
  {value:'/one/two/three/file.ts',kind:'path' as const},
  {value:'/甲乙/丙丁戊己/庚辛壬癸.ts',kind:'path' as const},
  {value:'suite › child :: deeply nested final test name',kind:'test' as const},
  {value:'iiiiiiiiiiii iiiiiiiiiii bbbbbbbbbbb',kind:'test' as const},
  {value:'iiiiiiiiiiiiiiiiiiii ii bbbbbbbbbbb',kind:'test' as const},
  {value:'甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未',kind:'test' as const},
  {value:('a\u0301').repeat(14)+'末尾',kind:'test' as const},
  {value:'first several words then a long final task',kind:'todo' as const},
 ]
 for(const slot of fixtures)for(const rows of [1,2,3])for(const width of [11,12,18,24,36,48,64,96,128])for(const wrap of [wrappedRows,terminalWrapRows]){
  const render=(length:number)=>'read '+shortenSlot(slot.value,slot.kind,length)+' now'
  const maximum=Math.max(12,slot.value.length)
  if(wrap(render(maximum),width)<=rows)continue // production enters shortening only when the full line fails
  let expected=render(12);for(let length=maximum;length>=12;length--){expected=render(length);if(wrap(expected,width)<=rows)break}
  let actual='';fitBandSlotLength(maximum,length=>{actual=render(length);return wrap(actual,width)<=rows},bandSlotFitLengths([slot]))
  expect({slot:slot.value,rows,width,surface:wrap.name,actual}).toEqual({slot:slot.value,rows,width,surface:wrap.name,actual:expected})
 }
})

test('M1 S1 ordinary band slots and shaping survive unchanged and truncation never splits a surrogate',()=>{
 const value='src/日本語/فارسی\u200cعربی\u200d/file.ts',text='read '+value
 expect(safeBandSpeech(text,{slots:[{value,kind:'path'}]})).toEqual({text,fit:{slots:[{value,kind:'path'}]}})
 expect(safeBandText('a'.repeat(9998)+'𠮷'+'tail')).toBe('a'.repeat(9998)+'…')
})

test('M1 S1 bounded band source visibly encodes controls and direction overrides in every slot occurrence',()=>{
 const value='file\n\t\u001b\u202e.ts',text='check '+value+' and '+value
 const result=safeBandSpeech(text,{slots:[{value,kind:'path'}]})
 expect(result.fit.slots![0]!.value).toBe('file\\u000a\\u0009\\u001b\\u202e.ts')
 expect(result.text).toBe('check file\\u000a\\u0009\\u001b\\u202e.ts and file\\u000a\\u0009\\u001b\\u202e.ts')
 expect(safeBandText('authored\nline')).toBe('authored\nline')
})

test('M1 S1 desktop planning bounds raw values before scans and preserves ordinary source attribution',()=>{
 const value='/one/'+'very-long-directory/'.repeat(12)+'file.ts'
 const normal=planDesktop(view('read '+value,[{value,kind:'path'}]),{...size,columns:80})
 const slot=normal.parts?.find(part=>part.slot)
 expect(slot?.sourceValue).toBe(value)
 const hostile='한'.repeat(20000)
 const plan=planDesktop(view(hostile,[{value:hostile,kind:'test'}]),{...size,columns:40})
 expect(plan.speech!.length).toBeLessThanOrEqual(10000)
 // Main's planner (merged 10-09) shows no cut that leaves a lone CJK fragment, so this one unbroken run may show nothing.
 expect(plan.speech==='' || plan.speech!.endsWith('…')).toBe(true)
})

for(const surface of ['terminal','desktop'] as const)test(`M1 S1 ${surface} drawing escapes untrusted bidi and terminal controls`,()=>{
 const value='bad\u202efile\u001b[31m',v=view('read '+value,[{value,kind:'path'}])
 const neighbour='neighbour\u202e\u001b[31m'
 const shown={...v,neighbours:true,neighbourLights:{v:1 as const,running:true,agents:[{id:'fixture-neighbour',label:neighbour,busy:true,partial:false}]}}
 const tree=surface==='terminal'?terminalBand(ui,shown,size):desktopBand(ui,shown,size,'<svg width="151" height="64"></svg>')
 const text=texts(tree)
 expect(text.includes('\u202e')).toBe(false);expect(text.includes('\u001b')).toBe(false)
 // Main's untrusted display slots name each control (merged 10-09).
 expect(text.includes('bad⟨U+202E⟩file⟨U+001B⟩[31m')).toBe(true)
 const labels=surface==='terminal'?text:alts(tree)
 expect(labels.includes('neighbour⟨U+202E⟩⟨U+001B⟩[31m')).toBe(true)
 expect(labels.includes('\u202e')).toBe(false);expect(labels.includes('\u001b')).toBe(false)
})

test('M1 S1 desktop validation rejects control and bidi payloads and preserves multilingual joining marks',()=>{
 for(const control of ['\u0001','\u001b','\u0085','\u061c','\u200e','\u202e','\u2066']){
  let rejected=false;try{validateDesktopTree({type:'Text',children:['file'+control+'.ts']})}catch{rejected=true}
  expect(rejected).toBe(true)
 }
 expect(()=>validateDesktopTree({type:'Text',children:['فارسی\u200cعربی\u200d日本語 हिन्दी']})).not.toThrow()
})

test('M1 S1 traditional Chinese uses the same character-boundary direction clipping as Chinese',()=>{
 const direction='（甲乙丙丁戊己庚辛壬癸）'
 for(let width=1;width<80;width++)expect(cutTerminalDirection(direction,width,'zh-Hant')).toBe(cutTerminalDirection(direction,width,'zh'))
 for(let width=1;width<250;width++)expect(cutDirection(direction,width,'zh-Hant')).toBe(cutDirection(direction,width,'zh'))
})
