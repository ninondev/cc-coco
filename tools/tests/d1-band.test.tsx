import { expect,test } from 'claude-code/testing'
import { desktopBand,terminalBand,planDesktop } from '../hooks/band'
import { normalizeDesktopView } from '../hooks/desktop-safe'
import { initialView } from '../hooks/mood'
import { loadD1Words } from '../hooks/d1-words'
import { loadD1Art } from '../hooks/d1-state.js'
import { D1_ART_FILES } from './d1-art-fixture'
import { ribbonTerminalCells } from '../hooks/d1-ribbon'
import { D1_WORDS_TEXT } from './d1-room-fixture'
import { C3_WORDS_RAW } from './c3-words-fixture'
import { WORDS } from '../hooks/words'
import { world } from './world'
import type { CocoView as View } from '../types'
const sprite='<svg xmlns="http://www.w3.org/2000/svg" width="73" height="64"/>'
const size={columns:200,maxRows:30,screenRows:48,isWorking:false}
const treeNodes=(n:any):any[]=>n&&typeof n==='object'?[n,...(n.children??[]).flatMap(treeNodes)]:[]
const pane=(surface:'desktop'|'terminal')=>({surface,plugin:'coco',component:'Pane' as const,requestId:'d1-band',props:{title:'fixture',isFocused:true,bodyColumns:size.columns,placement:'dock' as const,scroll:{offset:0,bodyRows:30},view:{}}})
const helpers=(n:number)=>Array.from({length:n},(_,i)=>({id:`h${i}`,state:'running' as const,at:i,arrivalAt:i,elapsed:1000}))

test('D1 desktop reserves twelve pixels without session ribbon and draws exact resting/compact heights',async($,on)=>{
 let view:View={...initialView(),stageDirection:'(fixture stage)'}
 on('ui.render',{component:'Pane',requestId:'d1-band'},($,e)=>e.surface==='desktop'?desktopBand($.ui.resolve(e),view,size,sprite):null)
 world(on);await Promise.all([loadD1Art('ribbon',path=>Promise.resolve(D1_ART_FILES[path]!)),loadD1Art('helpers',path=>Promise.resolve(D1_ART_FILES[path]!))]);await loadD1Words(()=>Promise.resolve(D1_WORDS_TEXT))
 // DECISIONS 1023: at rest with room, her ribbon stands beside her with the folder's name and the left slot stays empty;
 // the one-row band keeps the bare ribbon in the slot
 for(const [visible,compact,height] of [[false,false,1],[true,false,1],[true,true,28]] as const){
  view={...view,band:compact?'compact':'on',ribbon:{index:8,folder:'project',visible,alt:'ribbon fixture',tiedAt:0,elapsed:200}}
  const ui=await $.ui.mount(pane('desktop'));const nodes=treeNodes(await ui.drawn())
  const slot=nodes.find(n=>n.props?.key==='coco:ribbon-slot');expect(slot).toBeDefined()
  const drawing=treeNodes(slot).find(n=>n.type==='Svg');expect(drawing.props.width).toBe(12);expect(drawing.props.height).toBe(height)
  const tag=nodes.find(n=>n.props?.key==='coco:ribbon-tag')
  expect(!!tag).toBe(visible&&!compact)
  const shown=tag?treeNodes(tag).find(n=>n.type==='Svg'):drawing
  if(visible)expect(shown.props.source).toContain('forced-color-adjust:none')
  expect(shown.props.alt).toBe(visible?'ribbon fixture':'')
  if(tag)expect(treeNodes(tag).some(n=>n.type==='Text'&&(n.children??[]).join('')==='project')).toBe(true)
  const folder=nodes.find(n=>n.type==='Text'&&(n.children??[]).join('')==='project')
  if(visible){expect(folder).toBeDefined();expect(nodes.some(n=>n.type==='Svg'&&n.props.width===8&&n.props.height===18)).toBe(true)}else expect(folder).toBeUndefined()
  expect(nodes.some(n=>n.type==='Text'&&(n.children??[]).join('').trim()==='(fixture stage)')).toBe(true)
  await ui.unmount()
 }
})
test('D1 desktop: where her things leave no room for the folder name, the bare ribbon goes back to the left edge',async($,on)=>{
 const view:View={...initialView(),band:'on',context:40,contextTokens:80000,contextWindow:200000,quota:{rateLimits:[{kind:'five_hour',percentUsed:20},{kind:'seven_day',percentUsed:30}],at:0},ribbon:{index:3,folder:'a-rather-long-project-folder',visible:true,alt:'ribbon fixture'}}
 let columns=200
 on('ui.render',{component:'Pane',requestId:'d1-band'},($,e)=>e.surface==='desktop'?desktopBand($.ui.resolve(e),view,{...size,columns},sprite):null)
 world(on);await loadD1Art('ribbon',path=>Promise.resolve(D1_ART_FILES[path]!));await loadD1Words(()=>Promise.resolve(D1_WORDS_TEXT))
 const seen:boolean[]=[]
 for(columns of [200,60,44,36,30]){
  const ui=await $.ui.mount(pane('desktop'));const nodes=treeNodes(await ui.drawn())
  const tag=nodes.find(n=>n.props?.key==='coco:ribbon-tag'),slot=treeNodes(nodes.find(n=>n.props?.key==='coco:ribbon-slot')).find(n=>n.type==='Svg')
  // one ribbon at a time: beside her with the name, or alone at the left edge
  expect(slot.props.height).toBe(tag?1:50)
  if(tag)expect(tag.props.width).toBeGreaterThanOrEqual(5)
  seen.push(!!tag);await ui.unmount()
 }
 expect(seen[0]).toBe(true);expect(seen.at(-1)).toBe(false)
})
test('D1 helper count draws host inactive at terminal and raster uses exact ribbon cells',async($,on)=>{
 const view:View={...initialView(),helpersCount:2,helpersCountText:'2 helper fixtures',ribbon:{index:1,visible:true,folder:'project'}}
 on('ui.render',{component:'Pane',requestId:'d1-band'},($,e)=>e.surface==='terminal'?terminalBand($.ui.resolve(e),view,size):null)
 world(on);await Promise.all([loadD1Art('ribbon',path=>Promise.resolve(D1_ART_FILES[path]!)),loadD1Art('helpers',path=>Promise.resolve(D1_ART_FILES[path]!))]); const ui=await $.ui.mount(pane('terminal'));const nodes=treeNodes(await ui.drawn())
 const count=nodes.find(n=>n.type==='Text'&&(n.children??[]).join('')==='2 helper fixtures')
 expect(count).toBeDefined();expect(count.props.color).toBe('inactive');expect(count.props.dimColor).toBeUndefined()
 const ribbon=nodes.find(n=>n.type==='Raster'&&n.props.columns===1)
 expect(ribbon.props.rows).toBe(9);expect(ribbon.props.cells).toBe(ribbonTerminalCells(1,true,9))
 await ui.unmount()
})
test('D1 desktop shows three paper planes and a stack from five helpers with one combined alt (lane C, 10-14)',async($,on)=>{
 const view:View={...initialView(),helpers:helpers(5).map((h,i)=>({...h,at:0,arrivalAt:900+i*260,elapsed:0})),helpersCount:5,helpersAlt:'5 helper fixtures'}
 on('ui.render',{component:'Pane',requestId:'d1-band'},($,e)=>e.surface==='desktop'?desktopBand($.ui.resolve(e),view,size,sprite):null)
 world(on);await Promise.all([loadD1Art('ribbon',path=>Promise.resolve(D1_ART_FILES[path]!)),loadD1Art('helpers',path=>Promise.resolve(D1_ART_FILES[path]!))]); const ui=await $.ui.mount(pane('desktop'));const row=treeNodes(await ui.drawn()).find(n=>n.props?.key==='coco:helpers')
 expect(row).toBeDefined();const pictures=treeNodes(row).filter(n=>n.type==='Svg')
 expect(pictures.map(n=>n.props.width)).toEqual([20,20,20,20]);expect(pictures[3].props.source).toContain('1680ms');expect(pictures.map(n=>n.props.alt)).toEqual(['5 helper fixtures','','',''])
 for(const picture of pictures)expect(picture.props.source).toContain('forced-color-adjust:none')
 await ui.unmount()
})
// BAND 3.2 (10-09): the word "context" gives way before the scrolls; then scrolls reduce to a bundle, neighbours go, and the
// scrolls disappear last.
// 10-18 (DECISIONS 1017, CANON 192): on the floor the scrolls bundle, the neighbours go, the scrolls go, then the short names.
test('D1 narrow fitting reduces scrolls before neighbours, then scrolls disappear, then the context word goes',()=>{
 const view:View={...initialView(),context:34,helpers:helpers(4),helpersCount:4,neighbours:true,neighbourLights:{v:1,running:true,agents:[{id:'neighbour',label:'fixture',busy:true,partial:false}]}}
 const plans=Array.from({length:186},(_,i)=>planDesktop(view,{...size,columns:200-i}))
 const phases=plans.map(p=>`${p.helpers??'none'}:${p.neighbours??false}:${p.word}`)
 const full=phases.indexOf('full:true:true'),bundle=phases.indexOf('bundle:true:true'),noNeighbours=phases.indexOf('bundle:false:true'),none=phases.indexOf('none:false:true'),noWord=phases.indexOf('none:false:false')
 expect(full).toBeGreaterThan(-1);expect(bundle).toBeGreaterThan(full);expect(noNeighbours).toBeGreaterThan(bundle);expect(none).toBeGreaterThan(noNeighbours);expect(noWord).toBeGreaterThan(none)
})

test('D1 desktop normalization preserves resumed motion, alt and reduced-motion preference',async($,on)=>{
 let input:View={...initialView(),d1ReducedMotion:false,ribbon:{index:1,visible:true,folder:'project',tiedAt:0,elapsed:120,alt:'source ribbon alt'},helpers:[{id:'h',state:'running',at:0,arrivalAt:0,elapsed:200}],helpersCount:1,helpersAlt:'source helper alt'}
 const normal=()=>normalizeDesktopView(input,initialView(),['idle-reading'])
 expect(normal().ribbon).toMatchObject({elapsed:120,alt:'source ribbon alt'});expect(normal().helpers?.[0]?.elapsed).toBe(200);expect(normal().d1ReducedMotion).toBe(false)
 on('ui.render',{component:'Pane',requestId:'d1-band'},($,e)=>e.surface==='desktop'?desktopBand($.ui.resolve(e),normal(),size,sprite):null)
 world(on);await Promise.all([loadD1Art('ribbon',path=>Promise.resolve(D1_ART_FILES[path]!)),loadD1Art('helpers',path=>Promise.resolve(D1_ART_FILES[path]!))]); const ui=await $.ui.mount(pane('desktop'));let nodes=treeNodes(await ui.drawn())
 const ribbonSource=nodes.find(n=>n.type==='Svg' && n.props.alt==='source ribbon alt')?.props.source
 expect(ribbonSource).toContain('200ms cubic-bezier(0,0,.2,1) -120ms')
 const helperSource=nodes.find(n=>n.type==='Svg' && n.props.alt==='source helper alt')?.props.source
 expect(helperSource).toContain('240ms cubic-bezier(0,0,.2,1) -200ms')
 input={...input,d1ReducedMotion:true};await ui.redraw();nodes=treeNodes(await ui.drawn())
 for(const alt of ['source ribbon alt','source helper alt'])expect(nodes.find(n=>n.type==='Svg' && n.props.alt===alt)?.props.source).not.toContain('@keyframes')
 await ui.unmount()
 const bad=normalizeDesktopView({...input,ribbon:{...input.ribbon,elapsed:NaN,alt:'bad\u0001'},helpers:[{id:'h',at:0,state:'running',elapsed:-1}],d1ReducedMotion:'yes'},initialView(),['idle-reading'])
 expect(bad.ribbon?.elapsed).toBeUndefined();expect(bad.ribbon?.alt).toBeUndefined();expect(bad.helpers?.[0]?.elapsed).toBeUndefined();expect(bad.d1ReducedMotion).toBeUndefined()
})

test('D1 mounted desktop and terminal remove literal direction stars from approved Japanese and Korean pose and stage sources',async($,on)=>{
 let view:View=initialView()
 on('ui.render',{component:'Pane',requestId:'d1-band'},($,e)=>e.surface==='desktop'?desktopBand($.ui.resolve(e),view,size,sprite):e.surface==='terminal'?terminalBand($.ui.resolve(e),view,size):null)
 world(on);await Promise.all([loadD1Art('ribbon',path=>Promise.resolve(D1_ART_FILES[path]!)),loadD1Art('helpers',path=>Promise.resolve(D1_ART_FILES[path]!))]);await loadD1Words(()=>Promise.resolve(D1_WORDS_TEXT))
 const c3=JSON.parse(C3_WORDS_RAW),d1=JSON.parse(D1_WORDS_TEXT)
 for(const lang of ['ja','ko'] as const)for(const surface of ['desktop','terminal'] as const){
  for(const source of ['pose','stage'] as const){
   const raw=(source==='pose'?c3['aside.helper']:d1['aside.shed'])[lang] as string
   // W3 cleaned stage markup in generated copy. Add explicit markup to the
   // current authored source so this renderer test still exercises stripping.
   const marked='*'+raw.replace(/\*/g,'')+'*'
   expect(marked).toContain('*')
   view={...initialView(),lang,...(source==='pose'?{pose:{name:'helper' as const,frame:'helper-a',aside:marked,at:0}}:{stageDirection:marked})}
   const ui=await $.ui.mount(pane(surface)),texts=treeNodes(await ui.drawn()).filter(n=>n.type==='Text').map(n=>(n.children??[]).filter((c:any)=>typeof c==='string').join('')).join('\n')
   expect(texts).toContain(raw.replace(/\*/g,''));expect(texts).not.toContain(marked)
   await ui.unmount()
  }
 }
})

test('D1 mounted desktop removes literal stars from approved French touch directions without changing source words',async($,on)=>{
 let view:View=initialView()
 on('ui.render',{component:'Pane',requestId:'d1-band'},($,e)=>e.surface==='desktop'?desktopBand($.ui.resolve(e),view,size,sprite):null)
 world(on);await Promise.all([loadD1Art('ribbon',path=>Promise.resolve(D1_ART_FILES[path]!)),loadD1Art('helpers',path=>Promise.resolve(D1_ART_FILES[path]!))]); for(const [touch,key] of [['poke','poked'],['pat','patted'],['burst','flustered']] as const){
  const raw=WORDS.fr.touch[key];expect(raw).toContain('*')
  view={...initialView(),lang:'fr',touch}
  const ui=await $.ui.mount(pane('desktop')),texts=treeNodes(await ui.drawn()).filter(n=>n.type==='Text').map(n=>(n.children??[]).filter((c:any)=>typeof c==='string').join('')).join('\n')
  expect(texts).toContain(raw.replace(/\*/g,''));expect(texts).not.toContain(raw);expect(WORDS.fr.touch[key]).toBe(raw)
  await ui.unmount()
 }
})
