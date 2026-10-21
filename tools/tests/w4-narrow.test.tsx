import { expect, test } from 'claude-code/testing'
import { desktopBand, planDesktop } from '../hooks/band'
import { initialView, linesFor } from '../hooks/mood'
import { LANGS, WORDS } from '../hooks/words'
import { COLUMN_PX, minWrapPx, planPx } from '../hooks/typeset'
import { getMotionWidth } from '../hooks/pictures-lazy'
import { percentText } from '../hooks/numbers'
import { contextTokensText } from '../hooks/play-commits'
import { RECENT, world } from './world'

const size = { columns: 24, maxRows: 30, screenRows: 48, isWorking: false }
const text = (node:any):string => typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.children??[]):''
const nodes = (node:any):any[] => !node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(nodes):[node,...(node.children??[]).flatMap(nodes)]
// Independent 13 px CoreText receipts: bold speaker advances rounded up plus1 px.
const NAME_BOUNDS:Readonly<Record<string,number>>={'クロードさま':76,'클로디':35,'小克':27}
const nameBound=(name:string)=>NAME_BOUNDS[name]??planPx(name,true)
// Regular omission glyph advance10.384765625 px, rounded up plus1 px.
const OMISSION_PX=12
const cjk=/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u
const useful=(source:string)=>[...source.matchAll(/[\p{L}\p{N}]/gu)]

function firstUsefulPrefix(source:string,lang:string):string {
 if(['zh','zh-Hant','ja'].includes(lang)){
  const characters=useful(source)
  if(characters.length<2)return source
  const second=characters[1]!
  return source.slice(0,second.index!+second[0].length)
 }
 return source.trimStart().split(/\s+/u)[0]!.replace(/[\p{P}\p{S}]+$/u,'')
}
function omissionJustified(source:string,lang:string,columns:number,available:number):boolean {
 if(columns!==24||!source||planPx(source)<=available)return false
 const prefix=firstUsefulPrefix(source,lang)
 return !!prefix&&planPx(prefix)+OMISSION_PX>available
}
function certifiedSpeech(spoken:string,source:string):boolean {
 if(!spoken||/[\r\n]/u.test(spoken)||!useful(spoken).length)return false
 if(useful(source).length>1&&useful(spoken).length===1&&cjk.test(spoken))return false
 if(spoken===source)return true
 if((spoken.match(/…/gu)?.length??0)!==1||!spoken.endsWith('…'))return false
 const prefix=spoken.slice(0,-1)
 return prefix===prefix.trimEnd()&&source.startsWith(prefix)
}

test('W4 P2 floor omission requires an unavailable useful source prefix; fragments retain their source',()=>{
 expect(omissionJustified('too many words to hold at once.','en',24,30.64)).toBe(true)
 expect(omissionJustified('一次装不下这么多字','zh',24,30.64)).toBe(true)
 expect(omissionJustified('お賽銭箱、そろそろいっぱい','ja',24,30.64)).toBe(true)
 expect(omissionJustified('la suite.','fr',24,30.64)).toBe(false)
 expect(omissionJustified('too many words to hold at once.','en',24,40)).toBe(false)
 expect(omissionJustified('too many words to hold at once.','en',34,1)).toBe(false)
 expect(omissionJustified('花','zh',24,30.64)).toBe(false)
 expect(certifiedSpeech('…','一次装不下这么多字')).toBe(false)
 expect(certifiedSpeech('一…','一次装不下这么多字')).toBe(false)
 expect(certifiedSpeech('次一…','一次装不下这么多字')).toBe(false)
 expect(certifiedSpeech('一次……','一次装不下这么多字')).toBe(false)
 expect(certifiedSpeech('la…','la suite.')).toBe(true)
 expect(certifiedSpeech('一次…','一次装不下这么多字')).toBe(true)
 expect(certifiedSpeech('花','花')).toBe(true)
})

// P1's exact saying/saying-word setup and selection rule, extended to every language.
// The header name is an unshrinkable Box. Its measured planning width must fit the
// shared text column or it can push the following offering Box beyond the band.
for (const {code:lang} of LANGS) for (const state of ['saying','saying-word'] as const) test(`W4 P2 ${lang}/${state} keeps the offering inside at 24 columns`,async($,on)=>{
 let w:ReturnType<typeof world>
 let columns=24
 on('ui.render',{component:'Pane',requestId:'w4-narrow'},($,e)=>{
  const ui=$.ui.resolve(e) as any, {Box}=ui
  return <Box flexDirection="column">{desktopBand(ui,w.view(),{...size,columns},'<svg xmlns="http://www.w3.org/2000/svg"/>')}</Box>
 })
 w=world(on,{store:RECENT,percent:91,env:{LANG:lang==='zh-Hant'?'zh_TW.UTF-8':lang==='zh'?'zh_CN.UTF-8':lang.replace('-','_')+'.UTF-8'}})
 await $.session.start({cwd:'/tmp/project',surface:'terminal',isInteractive:true})
 await w.clock.advance(1000)
 const candidates=linesFor(w.view(),'offering_full'), measure=state==='saying-word'?minWrapPx:planPx
 expect(candidates.length).toBeGreaterThan(0)
 const selected=candidates.reduce((best,line)=>measure(line)>measure(best)?line:best)
 expect(LANGS.length).toBe(13)
 w.patch({said:selected,line:undefined})
 // The conversation in k tokens where the engine counted them (owner 10-14), else its percent.
 const shown=w.view().contextTokens!==undefined?contextTokensText(w.view().contextTokens!,lang):percentText(91,lang)
 for(columns of [24,34,52,180]){
 const p=planDesktop(w.view(),{...size,columns})
 const ui=await $.ui.mount({surface:'desktop',plugin:'coco',component:'Pane',requestId:'w4-narrow',props:{title:'W4 narrow',isFocused:true,bodyColumns:columns,placement:'dock',scroll:{offset:0,bodyRows:30},view:{}}})
 const tree=await ui.drawn(), all=nodes(tree), column=all.find(n=>n.props?.key==='coco:text-column')
 expect(w.view().lang).toBe(lang)
 expect(text(tree).includes(shown)).toBe(true)
 expect(p.showRight).toBe(true)
 // BAND 3.2: his picture is 32 px where the cue line cannot hold his name beside it at 64 px; 64 px where it can
 expect([32,64]).toContain(p.height)
 if(columns>=52)expect(p.height).toBe(64)
 expect(column.props.minWidth).toBe(0)
 expect(w.view().said).toBe(selected)
 expect(w.view().line).toBeUndefined()
 expect(candidates.includes(selected)).toBe(true)
 const band=all.find(n=>n.props?.key==='coco:band')
 // D1 SPEC 0.3:272 reserves a separate 12px ribbon slot before the picture.
 const ribbon=nodes(band).find(n=>n.props?.key==='coco:ribbon-slot')
 const ribbonPicture=nodes(ribbon).find(n=>n.type==='Svg')
 const pictureBox=nodes(band).find(n=>n.props?.key==='coco:picture')
 const picture=nodes(pictureBox).find(n=>n.type==='Svg')
 expect(ribbonPicture.props.width).toBe(12)
 expect(picture.props.height).toBe(p.height)
 // The floor (DECISIONS 1017): the context gauge with its number and word, the bag last; desktop-floor holds its fitting.
 const resting=(n:any):any[]=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(resting):n.props?.display==='none'?[]:[n,...(n.children??[]).flatMap(resting)]
 const floor=all.find(n=>n.props?.key==='coco:floor'),ctx=nodes(floor).find(n=>n.props?.key==='coco:thing:ctx')
 expect(resting(ctx).filter(n=>n.type==='Text').map(text).join('')).toBe(' '+shown+(p.word?' '+WORDS[lang].context:''))
 expect(nodes(floor.children.at(-1)).some(n=>n.type==='Button'&&n.props?.key==='coco:book:open')).toBe(true)
 const left=ribbonPicture.props.width+picture.props.width+column.props.marginLeft*COLUMN_PX
 const renderedName=nodes(column).find(n=>n.type==='Text'&&text(n)===WORDS[lang].name)
 expect(!!renderedName).toBe(p.name!==undefined)
 if(renderedName){
  expect(renderedName.props.bold).toBe(true)
  const nameBox=nodes(column).find(n=>n.type==='Box'&&nodes(n).includes(renderedName)&&n.props?.flexShrink===0)
  expect(nameBox).toBeDefined()
  expect(left+nameBound(text(renderedName))+column.props.marginRight*COLUMN_PX).toBeLessThanOrEqual(columns*COLUMN_PX+0.5)
 }
 const available=columns*COLUMN_PX-left-column.props.marginRight*COLUMN_PX
 const speech=nodes(column).find(n=>n.type==='Text'&&n.props?.wrap==='wrap'),spoken=text(speech)
 expect(spoken).toBe(p.speech??'')
 if(spoken){
  expect(certifiedSpeech(spoken,selected)).toBe(true)
  let cursor=0
  for(const fragment of spoken.split('…').filter(Boolean)){
   const at=selected.indexOf(fragment,cursor)
   expect(at).toBeGreaterThanOrEqual(cursor)
   cursor=at+fragment.length
  }
 }else{
  expect(omissionJustified(selected,lang,columns,available)).toBe(true)
  expect(nodes(column).some(n=>n.type==='Text'&&text(n)==='…')).toBe(false)
 }
 if(columns>=34){
  expect(spoken.length).toBeGreaterThan(0)
  const prefix=firstUsefulPrefix(selected,lang)
  expect(useful(spoken).length>=2||spoken.startsWith(prefix)).toBe(true)
 }
 if(columns===180)expect(spoken).toBe(selected)
 const speechAtoms=nodes(speech).filter(n=>n.type==='Text'&&n.props?.wrap==='truncate-end').map(n=>planPx(text(n),!!n.props?.bold))
 const occupied=left+Math.max(0,...speechAtoms)+column.props.marginRight*COLUMN_PX
 expect(occupied).toBeLessThanOrEqual(columns*COLUMN_PX+0.5)
 await ui.unmount()
 }
})

// All eight P1 desktop scene shapes retain the right-edge budget at the same floor.
for(const {code:lang} of LANGS)test(`W4 P2 ${lang} all desktop scene shapes fit at 24 columns`,()=>{
 expect(LANGS.length).toBe(13)
 const base={...initialView(),lang,context:34}
 const offered=linesFor({...base,context:91},'offering_full')
 const scenes=[
  {name:'reading',view:base,size},
  {name:'compact',view:{...base,band:'compact' as const},size},
  {name:'short',view:base,size:{...size,maxRows:3}},
  ...(['saying','saying-word'] as const).map(name=>{const measure=name==='saying-word'?minWrapPx:planPx;return{name,view:{...base,context:91,said:offered.reduce((best,line)=>measure(line)>measure(best)?line:best)},size}}),
  {name:'working',view:{...base,context:56,mood:'work' as const},size:{...size,isWorking:true}},
  {name:'omen',view:{...base,context:72,slip:{rank:'daikyo' as const,label:'大凶',text:linesFor(base,'offering_full')[0]!}},size},
  {name:'full',view:{...base,context:100},size},
 ]
 expect(scenes.length).toBe(8)
 expect(scenes.map(scene=>scene.name)).toEqual(['reading','compact','short','saying','saying-word','working','omen','full'])
 for(const scene of scenes){
  const p=planDesktop(scene.view,scene.size)
  const label=' '+percentText(scene.view.context,lang)+(p.word?' '+WORDS[lang].context:'')
  const left=getMotionWidth(p.height,scene.view.band==='compact')+COLUMN_PX+(p.slip?24+COLUMN_PX:0)
  const middle=p.textWidth??(24*COLUMN_PX-left-(p.showRight===false?0:20+planPx(label)+2*COLUMN_PX))
  if(p.name)expect([scene.name,nameBound(p.name)<=middle]).toEqual([scene.name,true])
 }
})
