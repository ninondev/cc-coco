import { expect, test } from 'claude-code/testing'
import { desktopBand, planDesktop } from '../hooks/band'
import { getMotionWidth } from '../hooks/pictures-lazy'
import { initialView } from '../hooks/mood'
import { WORDS } from '../hooks/words'
import { world } from './world'
const text=(n:any):string=>typeof n==='string'?n:Array.isArray(n)?n.map(text).join(''):text(n?.children??[])
const nodes=(n:any):any[]=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(nodes):[n,...(n.children??[]).flatMap(nodes)]
const atoms:Record<string,number>={'…':12.3271484375,'大凶…':36.182430994649806,'下下…':36.182430994649806,'お賽銭箱、…':74.49490878494736,'凶…':23.283598309824903,'下…':23.283598309824903,'箱、…':36.359473796206224,'賽銭箱、…':62.15713916585603}
const atomWidth=(s:string)=>atoms[s]??[...s].reduce((n,c)=>n+(c==='…'?12.3271484375:/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}、。]/u.test(c)?13.2:0),0)
// Short CJK samples with measured glyph receipts (above); 'quiet' has no context reading on the cue line.
const cases=[{lang:'ja',state:'saying',source:'お賽銭箱、…'},{lang:'ja',state:'quiet',source:'大凶…'},{lang:'zh',state:'quiet',source:'下下…'},{lang:'zh-Hant',state:'quiet',source:'下下…'}] as const
for(const item of cases)for(const columns of [24,34])test(`W4 part3 desktop ${columns} ${item.lang}/${item.state} contains its painted speech atoms`,async($,on)=>{
 const view={...initialView(),lang:item.lang,context:item.state==='saying'?91:null,said:item.source}
 const plan=planDesktop(view as any,{columns,maxRows:30,screenRows:48,isWorking:false}) // his picture is 32 px at these widths (BAND 3.2)
 on('ui.render',{component:'Pane',requestId:'w4-floor'},($,e)=>desktopBand($.ui.resolve(e) as any,view as any,{columns,maxRows:30,screenRows:48,isWorking:false},`<svg width="${getMotionWidth(plan.height,false)}" height="${plan.height}"></svg>`))
 world(on)
 const ui=await $.ui.mount({surface:'desktop',plugin:'coco',component:'Pane',requestId:'w4-floor',props:{title:'W4 floor',isFocused:true,bodyColumns:columns,placement:'dock',scroll:{offset:0,bodyRows:30},view:{}}})
 const all=nodes(await ui.drawn()),band=all.find(n=>n.props?.key==='coco:band'),column=all.find(n=>n.props?.key==='coco:text-column')
 // 10-18: the commit line stands on the floor, empty while there is no reading; her line hangs after her name above it
 const floor=nodes(column).find(n=>n.props?.key==='coco:floor')
 expect(nodes(floor).some(n=>n.type==='Svg'&&/viewBox="0 0 \d+ 6"/.test(String(n.props?.source)))).toBe(plan.cells!==false) // the cells give way on a narrow floor
 const speech=nodes(column).find(n=>n.type==='Text'&&n.props?.wrap==='wrap'),spoken=text(speech)
 expect(spoken.trim()==='…').toBe(false)
 if(spoken)expect((spoken.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu)??[]).length).toBeGreaterThanOrEqual(2)
 if(columns===34)expect(spoken).toBe(item.source)
 const runs=nodes(speech).filter(n=>n.type==='Text'&&n.props?.wrap==='truncate-end').map(n=>atomWidth(text(n)))
 const content=Math.max(0,...runs)
 // Independent footprint uses actual serialized dimensions and native glyph receipts.
 const picture=nodes(nodes(band).find(n=>n.props?.key==='coco:picture')).find(n=>n.type==='Svg')
 const page=band.children.find((n:any)=>n.type==='Box'&&nodes(n).some(c=>c.type==='Svg'&&c.props?.width===24))
 const pageSvg=nodes(page).find(n=>n.type==='Svg')
 const left=12+Number(picture.props.width)+(page?Number(page.props.marginLeft)*7.8+Number(pageSvg.props.width):0)+Number(column.props.marginLeft)*7.8
 const occupied=left+content+Number(column.props.marginRight)*7.8
 expect(occupied).toBeLessThanOrEqual(columns*7.8+0.5)
 await ui.unmount()
})
