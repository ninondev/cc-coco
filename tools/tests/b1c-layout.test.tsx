import { expect, test } from 'claude-code/testing'
import { planDesktop, desktopHeight, desktopBand } from '../hooks/band'
import { initialView } from '../hooks/mood'
import { LANGS, WORDS } from '../hooks/words'
import { planPx } from '../hooks/typeset'
import type { Lang } from '../hooks/words'
import { settleLegacyStart, world, band, P, PERSON, desktopPicture } from './world'

const CODES = LANGS.map(({ code }) => code)
const size = (px:number, working=false) => ({columns:Math.floor(px/7.8),maxRows:30,screenRows:48,isWorking:working})
test('B1c every line keeps resting and compact geometry in all supported languages at 300/600/900px',()=>{
 for(const lang of CODES) for(const px of [300,600,900]) for(const compact of [false,true]) {
  const base={...initialView(),lang,band:compact?'compact' as const:'on' as const,context:34}
  const before=planDesktop(base,size(px))
  for(const line of ['one short line.', Array(70).fill('a longer line').join(' ')]) {
   const after=planDesktop({...base,said:line},size(px))
   expect([lang,px,compact,after.height,after.row]).toEqual([lang,px,compact,before.height,before.row])
   expect(after.height).toBe(desktopHeight(base,size(px)))
   expect(after.speech===line || after.speech?.endsWith('…')).toBe(true)
  }
 }
})
// SPEC 0.2 rules 4 and 8: speech stays in the fixed column; class >= 1 hides only hover detail.
test('B1c speech stays in text column and note-class hover details leave while its buttons stay',async($,on)=>{
 const base={...initialView(),lang:'en' as const,context:34,quota:{rateLimits:[{kind:'five_hour',percentUsed:20,resetsAt:'2026-10-02T10:00:00Z'}]}}
 let view=base
 const walk=(node:unknown):any[]=>!node||typeof node!=='object'?[]:[node,...((node as any).children??[]).flatMap(walk)]
 on('ui.render',{component:'Pane'},($,e)=>desktopBand($.ui.resolve(e) as any,view,size(900),'<svg xmlns="http://www.w3.org/2000/svg" width="68" height="64"><path d="M0 0h1"/></svg>',undefined))
 const ui=await $.ui.mount({surface:'desktop',plugin:'coco',component:'Pane',props:{title:'fixture',isFocused:false,bodyColumns:100,placement:'dock',scroll:{offset:0,bodyRows:40},view:{}}})
 for(const lineClass of [0,1,2,3] as const){
  view={...base,said:'A visible line.',line:{id:'fixture',key:'fixture',text:'A visible line.',class:lineClass,expiresAt:Infinity}} as typeof base
  await ui.redraw()
  const tree=await ui.drawn(),nodes=walk(tree),column=nodes.find(n=>n.props?.key==='coco:text-column'),hover=nodes.find(n=>n.props?.position==='absolute'&&n.props?.display==='none')
  expect(column.props.height).toBe(3)
  expect(walk(column).some(n=>n.type==='Text'&&n.children?.includes('A visible line.'))).toBe(true)
  expect(nodes.filter(n=>n.type==='Text'&&n.children?.includes('A visible line.')).length).toBe(1)
  // The pointer on her (DECISIONS 1018): Poke, Pat and Close stand on the floor row beside her while she speaks too, never
  // on her line's rows; the bag stays on the floor. A line of class 1 and up keeps the things' cards closed.
  expect(hover.props.left).toBeGreaterThan(0);expect(hover.props.top).toBe(2)
  expect(hover.children.length).toBe(1)
  for(const key of ['coco:band:poke','coco:band:pat','coco:book:open','coco:band:close'])expect(await ui.find({type:'Button',key})).toBeDefined()
  const five=nodes.find(n=>n.props?.key==='coco:thing:quota:five_hour')
  expect(five.children.some((n:any)=>n.props?.display==='none')).toBe(lineClass===0)
 }
 view=base;await ui.redraw()
 // At rest the same three buttons; the quota's words are on its card above it.
 const resting=walk(await ui.drawn()),strip=resting.find(n=>n.props?.position==='absolute'&&n.props?.display==='none')
 expect(strip.props.top).toBe(2);expect(strip.children.length).toBe(1)
 const card=resting.find(n=>n.props?.key==='coco:thing:quota:five_hour').children.find((n:any)=>n.props?.display==='none')
 expect(walk(card).filter(n=>n.type==='Text').length).toBe(2)
})
// 10-19 (owner): the desktop band has no compact look any more, so only its three resting rows are checked here
test('B1c rendered speech reserves three resting rows',async($,on)=>{
 const w=world(on,{store:{band:'on',lang:'en',heard:true}})
 await $.session.start({cwd:'/tmp/b1c-layout',surface:'desktop',isInteractive:true}); await settleLegacyStart($,w)
 const ui=await $.ui.mount({surface:'desktop',...band(100)})
 const tree=await ui.drawn()
 const walk=(node:unknown):any[]=>!node||typeof node!=='object'?[]:[node,...((node as any).children??[]).flatMap(walk)]
 expect(walk(tree).some(n=>n.type==='Box'&&n.props?.key==='coco:text-column'&&n.props.height===3)).toBe(true)
 await $.command.run({command:'coco',args:'band compact',origin:PERSON,presentation:P})
 expect(walk(await ui.drawn()).some(n=>n.type==='Box'&&n.props?.key==='coco:text-column'&&n.props.height===3)).toBe(true)
 expect((await desktopPicture(ui))?.props.height).toBe(64)
})

// BAND 3.2 (10-09) replaces the old "yields the right block, keeps a name only while the whole line fits beside it": at rest
// his props and his name stand on the cue line and are never taken by his line, which has the column's two rows under it.
test('B1c safety shortens slots and keeps his props: the line is cut inside the column\'s two rows, never his props',()=>{
 const base={...initialView(),context:34}
 const text='This deletes everything in ~/Projects/very-long-project-name/build. It cannot be undone.'
 const slots=[{value:'~/Projects/very-long-project-name/build',kind:'path' as const}]
 const wrappedRows=(text:string,width:number)=>{
  let rows=1,used=0
  for(const word of text.match(/[^ \t\n]+|[ \t]+|\n/g)??[]){
   if(word==='\n'){rows++;used=0;continue}
   const widthOfWord=planPx(word)
   if(word.trim()&&widthOfWord>width)return Infinity
   if(used+widthOfWord>width){rows++;used=word.trim()?widthOfWord:0}else used+=widthOfWord
  }
  return rows
 }
 // 30 columns at the narrow end: her line hangs after her name since 10-18, and at 25 columns a guard line this long no
 // longer stands in two rows beside her 64 px picture
 const pxs=[900,600,420,300,234]
 const plans=pxs.map(px=>planDesktop({...base,said:text},size(px),undefined,{class:3,slots}))
 expect(plans[0].speech).toBe(text)
 expect(plans.some(p=>p.speech?.includes('~/Projects/…/build'))).toBe(true)
 expect(plans.some(p=>p.speech?.includes('…'))).toBe(true)
 // CANON 197 (10-18): on the script row the stage direction gives way first; it stands beside a line only where the
 // whole line keeps one row after it, so this two-row guard line has none
 expect(plans.map(p=>p.aside)).toEqual(pxs.map(()=>'none'))
 const short=planDesktop({...base,said:'ok.'},size(900))
 expect([short.aside,short.text]).toEqual(['beside',WORDS.en.aside.idle])
 plans.forEach((p,i)=>{
  const silent=planDesktop(base,size(pxs[i]!))
  expect([p.row,p.showRight]).toEqual([false,true])
  expect([32,64]).toContain(p.height)
  expect(p.height).toBe(silent.height)
  expect([undefined, silent.name]).toContain(p.name) // her name gives way where the line then stands whole (G1)
  expect(p.parts?.some(part=>part.slot&&part.text.endsWith('build'))).toBe(true)
  expect(p.lineRows).toBe(2)
  expect(wrappedRows(p.speech!,p.textWidth!)).toBeLessThanOrEqual(2)
 })
 // Three complete numeric units need three rows and the column has two: whole units stand, never a number cut inside, one mark.
 const values=['1111111111','2222222222','3333333333'],protectedText=values.join(' ')
 const protectedPlan=planDesktop({...base,said:protectedText},size(234),undefined,{class:3,slots:values.map(value=>({value,kind:'value' as const}))})
 for(const value of values)expect(planPx(value)).toBeLessThanOrEqual(protectedPlan.textWidth!)
 for(const value of values)expect(planPx(value,true)).toBeLessThanOrEqual(protectedPlan.textWidth!)
 expect(protectedPlan.lineRows).toBe(2)
 expect(protectedPlan.showRight).toBe(true)
 expect(protectedPlan.height).toBe(planDesktop(base,size(234)).height)
 expect(values.filter(value=>protectedPlan.speech!.includes(value)).length).toBeGreaterThanOrEqual(1)
 expect(protectedPlan.parts?.filter(part=>part.slot).every(part=>values.includes(part.text))).toBe(true)
 expect(protectedPlan.speech!.split('…').length-1).toBeLessThanOrEqual(1)
 const ambient=planDesktop({...base,said:Array(50).fill('long text').join(' ')},size(300))
 expect(ambient.showRight).toBe(true)
})
test('B1c compact replaces direction and cuts speech without dropping French no-break spaces',()=>{
 const said='toujours debout\u00a0? alors on lit encore un peu.'
 const p=planDesktop({...initialView(),lang:'fr',band:'compact',context:34,said},size(300))
 expect(p.row).toBe(true)
 expect(p.aside).toBe('beside')
 expect(said.startsWith(p.speech!.replace(/…$/,''))).toBe(true)
 expect(p.speech!.includes('debout?')).toBe(false)
})
test('B1c a shortened to-do slot prefers a complete word below the twelve-character floor',()=>{
 const said='Add a test for parser'
 const p=planDesktop({...initialView(),band:'compact',context:34,said},size(300),undefined,{class:2,slots:[{value:said,kind:'todo'}]})
 expect(p.place).not.toBe(3) // This fixture fits before the separate final end-cut step.
 expect(p.speech).toBe('Add a test…')
 expect(said.startsWith(p.speech!.replace(/…$/,''))).toBe(true)
})
