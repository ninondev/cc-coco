import { installM1Words } from './m1-more-data-fixture'
import {expect,test} from 'claude-code/testing'
import type {On} from 'claude-code'
import {world,settleLegacyStart,RECENT,MORNING,P,PERSON,band as bandRow} from './world'
import {moreWord} from '../hooks/more-words'
import {C3_WORDS_RAW} from './c3-words-fixture'
import {C3_HEAD_MANIFEST} from './c3-head-assets'

installM1Words()

const START={cwd:'/tmp/m1-book-controls',surface:'terminal' as const,isInteractive:true}
const PANE={plugin:'coco',component:'Pane' as const,requestId:'coco-book',props:{title:'',isFocused:true,bodyColumns:60,placement:'dock' as const,scroll:{offset:0,bodyRows:4},view:{}}}
function fixture(on:On,initialState:Record<string,unknown>={}){
 const w=world(on,{initialState,store:{...RECENT,firstMet:MORNING,bandSettings:{voice:'off',voiceChosen:true,band:'on',notes:false}},readText:path=>path.endsWith('c3-text.json')?C3_WORDS_RAW:path.endsWith('frame-manifest.json')?JSON.stringify(C3_HEAD_MANIFEST):undefined})
 on('agent.list',()=>({value:[]}));on('session.messages',()=>({value:[]}));on('session.model',()=>({value:'fixture-model'}));on('session.repo',()=>({value:null}));on('session.turns',()=>({value:1}));on('fs.write',()=>({value:undefined}));on('process.run',()=>({value:{exitCode:0,stdout:'{}',stderr:'',isStdoutTruncated:false,isStderrTruncated:false}}))
 return w
}
function keyedBody(tree:any):any{if(Array.isArray(tree)){for(const child of tree){const found=keyedBody(child);if(found)return found}}else if(tree&&typeof tree==='object'){if(tree.type==='Box'&&tree.props?.key==='coco:more:body')return tree;return keyedBody(tree.children)}return undefined}
async function start($:any,w:any){await $.session.start(START);await settleLegacyStart($,w)}
test('M1 A3 no retained book pane leaves its state and closed behavior untouched',async($,on)=>{
 const held={page:'offerings',reading:0,rev:7},w=fixture(on,{book:held});let queried=0
 on('ui.panes',()=>{queried++;return{value:[]}})
 await start($,w);expect(queried).toBe(1);expect(w.opens).toEqual([]);expect(w.cell('book')?.value).toEqual(held)
 const band=await $.ui.mount({surface:'terminal',...bandRow(100)})
 await band.press({key:'coco:book:open'});expect(w.opens.length).toBe(1);await band.unmount()
})
for(const more of [false,true])test(`M1 A3 retained ${more?'More':'Offerings'} pane restores on activation without reopen or focus`,async($,on)=>{
 let queried=0,focused=0,closed=0
 on('ui.*',($,e,next)=>{if(next.is('ui.close',e))closed++;return next(e)})
 const held={page:more?'settings':'offerings',reading:0,rev:7,more},w=fixture(on,{book:held})
 on('ui.panes',()=>{queried++;return{value:[{id:'coco-book',title:'Fixture',isShown:true,isFocused:false,isPlaced:true}]}})
 on('ui.focus',($,e,next)=>{focused++;return next(e)})
 await start($,w)
 expect(queried).toBe(1);expect(w.opens).toEqual([]);expect(focused).toBe(0);expect(w.cell('book')?.value).toEqual(held)
 // Before any Pane render can set the module's open flag, the public Book press closes it.
 const band=await $.ui.mount({surface:'terminal',...bandRow(100)})
 await band.press({key:'coco:book:open'});expect(closed).toBe(1);expect(w.opens).toEqual([])
 await band.press({key:'coco:book:open'});expect(w.opens.length).toBe(1)
 const pane=await $.ui.mount({surface:'terminal',...PANE})
 expect((await pane.find({key:`coco:book:tab:${held.page}`}))?.props.variant).toBe('primary')
 await pane.unmount();await band.unmount()
})
test('M1 A3 unplaced retained pane retries placement on the first Book press',async($,on)=>{
 let queried=0,closed=0
 on('ui.*',($,e,next)=>{if(next.is('ui.close',e))closed++;return next(e)})
 const held={page:'offerings',reading:0,rev:7},w=fixture(on,{book:held})
 on('ui.panes',()=>{queried++;return{value:[{id:'coco-book',title:'Fixture',isShown:false,isFocused:false,isPlaced:false}]}})
 await start($,w);expect(queried).toBe(1);expect(w.opens).toEqual([]);expect(closed).toBe(0);expect(w.cell('book')?.value).toEqual(held)
 const band=await $.ui.mount({surface:'terminal',...bandRow(100)})
 await band.press({key:'coco:book:open'});expect(w.opens.length).toBe(1);expect(closed).toBe(0)
 expect((w.cell('book')?.value as {page:string})?.page).toBe('offerings')
 await band.press({key:'coco:book:open'});expect(w.opens.length).toBe(1);expect(closed).toBe(1)
 await band.unmount()
})
test('M1 A3 public Book button opens then closes on its second press',async($,on)=>{
 let closed=0
 on('ui.*',($,e,next)=>{if(next.is('ui.close',e))closed++;return next(e)})
 const w=fixture(on)
 on('ui.panes',()=>({value:[]}))
 await start($,w);const band=await $.ui.mount({surface:'terminal',...bandRow(100)})
 await band.press({key:'coco:book:open'});expect(w.opens.length).toBe(1);expect(closed).toBe(0)
 await band.press({key:'coco:book:open'});expect(w.opens.length).toBe(1);expect(closed).toBe(1)
 await band.unmount()
})
test('M1 A3 real scroll dispatch changes only More body while tab controls remain',{plugins:[{name:'m1-scroll-observer',tier:'prepend',register(on){on('ui.scroll',{requestId:'coco-book'},($,e,next)=>{$.ui.log('M1_A3_SCROLL '+JSON.stringify({by:e.by,offset:e.offset}),{to:'debug'});return next(e)})}}]},async($,on)=>{
 const w=fixture(on),moves:{by:number;offset:number}[]=[]
 on('ui.panes',()=>({value:[]}));on('ui.log',($,e,next)=>{if(!e.text.startsWith('M1_A3_SCROLL '))return next(e);moves.push(JSON.parse(e.text.slice('M1_A3_SCROLL '.length)));return{value:undefined}})
 on('ui.scroll',()=>({}))
 // the More rows stand in the switches page's groups now (her itabag, step 2); its own page opens by its verb
 await start($,w);await $.command.run({command:'coco',args:'more',origin:PERSON,presentation:P})
 const pane=await $.ui.mount({surface:'terminal',...PANE});await pane.redraw()
 const controls=async()=>(await pane.findAll({type:'Button'})).filter(node=>node.key?.startsWith('coco:book:tab:')).map(node=>({key:node.key,label:node.props.label,hotkey:node.props.hotkey}))
 const before=await controls(),bodyBefore=keyedBody(await pane.drawn());expect(bodyBefore).toBeDefined()
 const bodyKeys=(body:any)=>(body.children as any[]).flat(Infinity).map((row:any)=>row.props.key as string),bodyKeysBefore=bodyKeys(bodyBefore)
 const backBefore=(await pane.find({key:'coco:more:back'}))?.props.label
 const by=20,bodyRows=PANE.props.scroll.bodyRows
 await $.ui.scroll({component:PANE.component,requestId:PANE.requestId,offset:by,by,bodyRows,contentRows:by+bodyRows,origin:{kind:'person'}});await pane.redraw()
 expect(moves.some(move=>move.by>=20)).toBe(true)
 expect(await controls()).toEqual(before);expect((await pane.find({key:'coco:more:back'}))?.props.label).toBe(backBefore)
 expect(await pane.find({type:'Text',text:moreWord('title','en')})).toBeDefined()
 const bodyAfter=keyedBody(await pane.drawn());expect(bodyAfter).toBeDefined();expect(JSON.stringify(bodyAfter)===JSON.stringify(bodyBefore)).toBe(false)
 const bodyKeysAfter=bodyKeys(bodyAfter)
 expect(bodyKeysAfter.length).toBeGreaterThan(0);expect(bodyKeysAfter.length).toBeLessThan(bodyKeysBefore.length)
 expect(bodyKeysAfter).toEqual(bodyKeysBefore.slice(-bodyKeysAfter.length))
 await pane.unmount()
})
