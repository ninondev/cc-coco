import { expect, test } from 'claude-code/testing'
import { desktopBand, planDesktop } from '../hooks/band'
import { initialView } from '../hooks/mood'
import { LANGS, WORDS } from '../hooks/words'
import { COLUMN_PX, planPx } from '../hooks/typeset'
import { getMotionWidth } from '../hooks/pictures-lazy'
import { world } from './world'

const nodes=(tree:any):any[]=>!tree||typeof tree!=='object'?[]:Array.isArray(tree)?tree.flatMap(nodes):[tree,...(tree.children??[]).flatMap(nodes)]
const size=(columns:number)=>({columns,isWorking:false,maxRows:30,screenRows:48})
const mount=($:any,id:string)=>$.ui.mount({surface:'desktop',plugin:'coco',component:'Pane',requestId:id,props:{title:'W4 fixture',isFocused:true,bodyColumns:80,placement:'dock',scroll:{offset:0,bodyRows:30},view:{}}})
// D1 design/0.3/SPEC.md:272-273 keeps the empty 12px ribbon slot before the picture.
const RIBBON_SLOT=12
// DECISIONS 1018 (10-18): the pointer on her opens Poke, Pat and Close beside her. The strip is a hidden child of her keyed
// picture block (a shared hover scope never revealed anything on his desktop), placed in whole cells from her left edge:
// after her picture, after her name in a one-row band.
const picture=(tree:any[])=>tree.find(n=>n.type==='Box'&&n.props?.key==='coco:picture')
const hoverStrip=(tree:any[])=>(picture(tree)?.children??[]).find((n:any)=>n.type==='Box'&&n.props?.position==='absolute'&&n.props?.display==='none')
const buttonWidth=(labels:string[])=>labels.reduce((sum,label)=>sum+planPx(label)+22,0)+(labels.length-1)*COLUMN_PX
const NAME_END=planPx('Coco',true)+COLUMN_PX

for(const compact of [false,true])for(const extra of ['none','said'] as const)test(`W4 N1 ${compact?'one':'two'} row/${extra} hover stands beside her, after her name in one row, on the floor row at rest`,async($,on)=>{
 const view={...initialView(),band:compact?'compact' as const:'on' as const,
  ...(extra==='said'?{said:'The page keeps turning.'}:{})}
 const planned=planDesktop(view as any,size(103)),width=getMotionWidth(planned.height,compact)
 on('ui.render',{component:'Pane',requestId:'w4-hover-edge'},($,e)=>desktopBand($.ui.resolve(e) as any,view as any,size(103),`<svg width="${width}" height="${planned.height}"></svg>`))
 world(on);const ui=await mount($,'w4-hover-edge'),tree=nodes(await ui.drawn())
 const strip=hoverStrip(tree)
 expect(strip).toBeDefined();expect(picture(tree).props.position).toBe('relative')
 const pictureCols=Math.ceil(width/COLUMN_PX)
 expect(strip.props.top).toBe(compact?0:2)
 expect(strip.props.height).toBe(1)
 expect(strip.props.left).toBe(pictureCols+1+(compact?Math.ceil(NAME_END/COLUMN_PX):0))
 await ui.unmount()
})

for(const {code:lang} of LANGS)for(const compact of [false,true])test(`W4 N2 ${lang}/${compact?'one':'two'} row hover never paints over her picture and stays inside the band`,async($,on)=>{
 const words=WORDS[lang]
 const view={...initialView(),lang,band:compact?'compact' as const:'on' as const}
 let columns=38
 on('ui.render',{component:'Pane',requestId:'w4-hover-picture'},($,e)=>{const pl=planDesktop(view,size(columns));return desktopBand($.ui.resolve(e) as any,view,size(columns),`<svg width="${getMotionWidth(pl.height,compact)}" height="${pl.height}"></svg>`)})
 world(on)
 for(columns of [38,54,103]){
  const ui=await mount($,'w4-hover-picture'),all=nodes(await ui.drawn())
  const planned=planDesktop(view,size(columns)),width=getMotionWidth(planned.height,compact),strip=hoverStrip(all)
  const buttons=nodes(strip).filter(n=>n.type==='Button'),keys=buttons.map(b=>b.props.key),labels=buttons.map(b=>b.props.label)
  expect(strip.props.left*COLUMN_PX).toBeGreaterThanOrEqual(width)
  expect(RIBBON_SLOT+(strip.props.left+strip.props.width)*COLUMN_PX).toBeLessThanOrEqual(columns*COLUMN_PX+0.000001)
  expect(buttonWidth(labels)).toBeLessThanOrEqual(strip.props.width*COLUMN_PX)
  expect(keys.at(-1)).toBe('coco:band:close')
  expect(keys.includes('coco:book:open')).toBe(false) // the bag stands on the floor or at the row's end
  // Poke and Pat go together, and stay wherever the three fit
  expect([keys.includes('coco:band:poke'),keys.includes('coco:band:pat')]).toEqual([keys.length===3,keys.length===3])
  if(columns===103)expect(keys).toEqual(['coco:band:poke','coco:band:pat','coco:band:close'])
  expect(labels.at(-1)).toBe(words.hover.close)
  await ui.unmount()
 }
})
