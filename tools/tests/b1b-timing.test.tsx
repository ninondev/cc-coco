// One unchanged fixture serves BEFORE and AFTER shipping snapshots; no runtime preinstall.
import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { MORNING, RECENT, band, world } from './world'
function measuredWorld(on:On){
 const calls:string[]=[]
 on('state.*',($,e,next)=>{calls.push(next.event);return next(e)})
 on('store.*',($,e,next)=>{calls.push(next.event+':'+e.key);return next(e)})
 on('settings.*',($,e,next)=>{calls.push(next.event);return next(e)})
 on('env.*',($,e,next)=>{calls.push(next.event+':'+e.name);return next(e)})
 on('ui.log',($,e)=>{if((e.text.startsWith('B1B_PATH_METER ')||e.text.startsWith('B1B_STEP_METER ')))console.log(e.text);return{}})
 const w=world(on,{store:RECENT});return{w,calls}
}
for(const surface of ['desktop','terminal','vscode','mobile'] as const)test('healthy first answer measurement '+surface,{timeoutMs:60_000},async($,on)=>{
 const f=measuredWorld(on);const began=Date.now();const ui=await $.ui.mount({surface,...band(100)} as never)
 console.log('B1B_TIMING_FIXTURE '+JSON.stringify({event:'first-answer',surface,mountWallMs:Date.now()-began,calls:f.calls}))
 if(surface==='desktop')expect(await ui.find({type:'Text',text:'Coco'})).toBeDefined()
})
test('healthy session start measurement',{timeoutMs:60_000},async($,on)=>{
 const f=measuredWorld(on);const began=Date.now();await $.session.start({cwd:'/tmp/b1b-timing',surface:'desktop',isInteractive:true})
 console.log('B1B_TIMING_FIXTURE '+JSON.stringify({event:'session.start',wallMs:Date.now()-began,calls:[...f.calls]}))
 await f.w.clock.advance(0)
 for(let i=0;i<40;i++)await $.command.run({command:'b1b-meter-boundary',args:''})
 console.log('B1B_TIMING_FIXTURE '+JSON.stringify({event:'session.start-background',calls:f.calls}))
})
test('cached picture repeated hook measurement',{timeoutMs:60_000},async($,on)=>{
 const f=measuredWorld(on);const ui=await $.ui.mount({surface:'desktop',...band(100)})
 const before=f.calls.length;for(let i=0;i<12;i++){await ui.redraw(band(100).props);expect(await ui.find({type:'Text',text:'Coco'})).toBeDefined()}
 console.log('B1B_TIMING_FIXTURE '+JSON.stringify({event:'cached-picture',repeatedDraws:12,drawCalls:f.calls.slice(before)}))
})
