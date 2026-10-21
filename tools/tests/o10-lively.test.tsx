// O10's "闲着也动来动去" in the terminal since the pixel version (DECISIONS 917): with Lively on her resting loop
// (breathing, a blink) plays frame by frame in the band, as cells and as kitty's picture alike, each frame asking
// for the next with one timer; Off holds her still on the loop's first frame and nothing more is pending. The old
// figure's composites (idle-terminal-*.json) are never read and the two-second Lively owner never starts.
import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { world, band, settleLegacyStart, RECENT, MORNING, PERSON, P } from './world'
import { installM1Words } from './m1-more-data-fixture'
import { C3_WORDS_RAW } from './c3-words-fixture'
import { C3_HEAD_MANIFEST } from './c3-head-assets'
import { PIXEL_MOMENTS } from '../hooks/coco-pixel'
import { pixelCells, pixelPng } from '../hooks/coco-pixel-play'
installM1Words()
const START={cwd:'/tmp/o10-sdk',surface:'terminal' as const,isInteractive:true}
const LOOK={outfit:'A' as const,dark:true,colors:'truecolor' as const}
const LOOP=PIXEL_MOMENTS.idle!.loop
const ROUND=LOOP.reduce((a,s)=>a+s[1],0)
function fixture(on:On,kitty:boolean){
 let every=0,renders=0
 const lazy:string[]=[]
 on('agent.list',()=>({value:[]}));on('session.model',()=>({value:'test-model'}));on('session.repo',()=>({value:null}));on('session.turns',()=>({value:1}));on('fs.write',()=>({value:undefined}))
 on('fs.*',async($,e,next)=>{if(next.is('fs.read',e)&&/idle-terminal-(pixel|painted)\.json$/.test(e.path))lazy.push(e.path);return next(e)})
 on('clock.*',($,e,next)=>{if(next.is('clock.every',e))every++;return next(e)})
 const w=world(on,{surfaces:['terminal'],env:{LANG:'en_US.UTF-8',TERM:kitty?'xterm-kitty':'xterm-256color',COLORTERM:'truecolor'},store:{...RECENT,firstMet:MORNING,bandSettings:{voice:'off',voiceChosen:true,band:'on',notes:false,bookmark:false,guard:false},more:{lively:true}},onRender:component=>{if(component==='AbovePrompt')renders++},readText:path=>path.endsWith('c3-text.json')?C3_WORDS_RAW:path.endsWith('frame-manifest.json')?JSON.stringify(C3_HEAD_MANIFEST):undefined})
 return{w,lazy,every:()=>every,renders:()=>renders}
}
async function begin($:any,w:any){
 await $.session.start(START);await settleLegacyStart($,w)
 await $.turn.start({turnId:'o10-entry',text:'fixture activity'});await $.turn.complete({turnId:'o10-entry',answer:'',reason:'answer',durationMs:1000,isAborted:false});await settleLegacyStart($,w)
}
// what the band's sprite shows now, as cells or as kitty's PNG
async function shown(row:any,kitty:boolean):Promise<string|undefined>{
 const sprite=await row.find({type:kitty?'Image':'Raster',key:'sprite'})
 return kitty?sprite?.props.source?.png:sprite?.props.cells
}

for(const kitty of [false,true])test('O10 Lively on: her pixel resting loop plays frame by frame as '+(kitty?'kitty pictures':'cells'),{options:{band:'on'},timeoutMs:60000},async($,on)=>{
 const f=fixture(on,kitty)
 await begin($,f.w)
 const row=await $.ui.mount({surface:'terminal',...band(100),requestId:'o10-'+(kitty?'kitty':'cells')})
 await row.drawn();await f.w.clock.advance(60000);await settleLegacyStart($,f.w)
 const frames=new Map(LOOP.map(([frame])=>[kitty?pixelPng(frame,0,LOOK):pixelCells(frame,0,LOOK),frame]))
 const seen=new Set<number>(),before=f.renders()
 for(let t=0;t<2*ROUND;t+=50){
  await f.w.clock.advance(50)
  const now=await shown(row,kitty)
  expect(frames.has(now!)).toBe(true)
  seen.add(frames.get(now!)!)
 }
 expect([...seen].sort()).toEqual([...new Set(LOOP.map(s=>s[0]))].sort())
 // each step of the loop is one drawing: two rounds of it, and no more than a couple of others
 expect(f.renders()-before).toBeGreaterThanOrEqual(2*LOOP.length-1);expect(f.renders()-before).toBeLessThanOrEqual(2*LOOP.length+2)
 expect(f.lazy).toEqual([]);expect(f.every()).toBe(0)
 await row.unmount()
})

test('O10 Lively Off holds her still, and nothing more is pending',{options:{band:'on'},timeoutMs:60000},async($,on)=>{
 const f=fixture(on,false)
 await begin($,f.w)
 const row=await $.ui.mount({surface:'terminal',...band(100),requestId:'o10-off'})
 await row.drawn();await f.w.clock.advance(60000);await settleLegacyStart($,f.w)
 // wait for a blink, so a frame is pending when she is told to stop
 const blink=pixelCells(LOOP.find(s=>s[1]<200)![0],0,LOOK)
 for(let t=0;t<ROUND&&await shown(row,false)!==blink;t+=10)await f.w.clock.advance(10)
 expect(await shown(row,false)).toBe(blink)
 await $.command.run({command:'coco',args:'more',origin:PERSON,presentation:P})
 const pane=await $.ui.mount({surface:'terminal',plugin:'coco',component:'Pane',requestId:'coco-book',props:{title:'Coco',isFocused:false,bodyColumns:100,placement:'dock',scroll:{offset:0,bodyRows:100},view:{}},viewport:{columns:100,rows:100}})
 await pane.press({key:'coco:more:lively:off'});expect(await pane.find({type:'Button',key:'coco:more:lively:on'})).toBeDefined()
 // whatever the book's opening asked of her has played out by now; from here she does not move
 await f.w.clock.advance(ROUND);await settleLegacyStart($,f.w)
 const still=await shown(row,false)
 expect(still).toBeDefined()
 const before=f.renders()
 for(let t=0;t<2*ROUND;t+=100){await f.w.clock.advance(100);expect(await shown(row,false)).toBe(still)}
 expect(f.renders()).toBe(before);expect(f.lazy).toEqual([]);expect(f.every()).toBe(0)
 await pane.unmount();await row.unmount()
})
