// HIGH-CONTRAST.md:174-177 requires the constructor's exact pictureColors transform.
import {test,expect} from 'claude-code/testing'
import {desktopBand} from '../hooks/band'
import {pictureColors} from '../hooks/high-contrast'
import {loadD1Art} from '../hooks/d1-state.js'
import {D1_ART_FILES} from './d1-art-fixture'
import {validateDesktopTree} from '../hooks/desktop-safe'
import {initialView} from '../hooks/mood'
import {loadD1Words} from '../hooks/d1-words'
import {world,desktopPicture,MORNING} from './world'
import {D1_WORDS_TEXT} from './d1-room-fixture'
import type {CocoView as View} from '../types'
const SOURCE='<svg xmlns="http://www.w3.org/2000/svg" width="73" height="64"><g data-fixture="actual-visible-picture"></g></svg>'
const size={columns:240,maxRows:30,screenRows:48,isWorking:false}
const nodes=(n:any):any[]=>Array.isArray(n)?n.flatMap(nodes):n&&typeof n==='object'?[n,...nodes(n.children??[])]:[]
const pane={surface:'desktop' as const,plugin:'coco',component:'Pane' as const,requestId:'d1-whole-desktop-tree-contract',props:{title:'fixture',isFocused:true,bodyColumns:240,placement:'dock' as const,scroll:{offset:0,bodyRows:40},view:{}}}
function sample(kind:string):View{
 const view=initialView()
 if(kind==='helper')return {...view,helpers:Array.from({length:5},(_,i)=>({id:'fixture-'+i,state:'running' as const,at:0,arrivalAt:i*260,elapsed:1000})),helpersCount:5,helpersAlt:'five fixture helpers'}
 if(kind==='shed')return {...view,line:{id:'fixture-shed',key:'shed.first',text:JSON.parse(D1_WORDS_TEXT)['shed.first'].en,class:1,expiresAt:0},stageDirection:JSON.parse(D1_WORDS_TEXT)['aside.shed'].en,shed:{id:'fixture-shed',phase:'end',at:0,elapsed:100}}
 if(kind==='quotas')return {...view,quota:{at:MORNING,rateLimits:[{kind:'five_hour',percentUsed:40}]},neighbours:true,neighbourLights:{v:1,running:true,agents:[{id:'fixture-neighbour',label:'fixture neighbour',busy:true,partial:false,startedAt:MORNING,quota:{primary:{usedPercent:20,resetsAt:MORNING+10000}}}]}}
 return view
}
for(const kind of ['idle','helper','shed','quotas'] as const)test(`D1 whole actual desktop constructor ${kind} passes the unchanged validator`,async($,on)=>{
 // This direct constructor bypasses the shipping async first-use event boundary.
 if(kind==='helper'||kind==='shed')await loadD1Art(kind==='helper'?'helpers':'shed',path=>Promise.resolve(D1_ART_FILES[path]!))
 const view=sample(kind);let violation:string|null=null,constructed:any
 on('ui.render',{component:'Pane',requestId:pane.requestId},($,e)=>{
  if(e.surface!=='desktop')throw new Error('desktop constructor contract used another surface')
  constructed=desktopBand($.ui.resolve(e),view,size,SOURCE)
  try{validateDesktopTree(constructed)}catch(error){violation=(error as Error).message}
  return constructed
 })
 world(on);await loadD1Words(()=>Promise.resolve(D1_WORDS_TEXT))
 const ui=await $.ui.mount(pane)
 expect(violation).toBe(null)
 const drawn=nodes(await ui.drawn()),svgs=drawn.filter(n=>n.type==='Svg'),picture=svgs.find(n=>n.props.source===pictureColors(SOURCE))
 expect(picture).toBeDefined();expect(picture.props.width).toBe(73);expect(picture.props.height).toBe(64)
 expect(svgs.every(n=>n.props.key===undefined)).toBe(true)
 const keys=drawn.flatMap(n=>typeof n.props?.key==='string'?[n.props.key]:[])
 expect(new Set(keys).size).toBe(keys.length)
 if(kind==='helper'){
  const row=drawn.find(n=>n.type==='Box'&&n.props?.key==='coco:helpers'),pictures=nodes(row).filter(n=>n.type==='Svg')
  expect(pictures.map(n=>[n.props.width,n.props.height])).toEqual([[20,14],[20,14],[20,14],[20,20]])
  expect(pictures.map(n=>n.props.alt)).toEqual(['five fixture helpers','','',''])
  expect(nodes(row).filter(n=>n.type==='Box'&&String(n.props?.key).startsWith('coco:helper:')).map(n=>n.props.key)).toEqual(['coco:helper:fixture-0','coco:helper:fixture-1','coco:helper:fixture-2','coco:helper:bundle'])
 }
 if(kind==='shed')expect(drawn.filter(n=>n.type==='Text').flatMap(n=>n.children??[]).join('')).toContain(JSON.parse(D1_WORDS_TEXT)['shed.first'].en)
 if(kind==='quotas')for(const key of ['coco:thing:quota:five_hour','coco:quota:five_hour','lamp:fixture-neighbour'])expect(drawn.find(n=>n.type==='Box'&&n.props?.key===key)).toBeDefined()
 await ui.unmount()
})
test('D1 desktop picture reader selects the actual drawn picture before a ribbon or transparent hit target',async($,on)=>{
 on('ui.render',{component:'Pane',requestId:pane.requestId},($,e)=>{
  if(e.surface!=='desktop')throw new Error('desktop picture contract used another surface')
  return desktopBand($.ui.resolve(e),initialView(),size,SOURCE)
 })
 world(on); const ui=await $.ui.mount(pane),visible=nodes(await ui.drawn()).find(n=>n.type==='Svg'&&n.props.source===pictureColors(SOURCE))
 expect(visible).toBeDefined()
 expect((await desktopPicture(ui))?.props.source).toBe(pictureColors(SOURCE))
 expect((await desktopPicture(ui))?.props.width).toBe(visible.props.width);expect((await desktopPicture(ui))?.props.height).toBe(visible.props.height)
 await ui.unmount()
})
