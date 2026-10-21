import {test,expect} from 'claude-code/testing'
import {world,RECENT,settleLegacyStart,band,PERSON,P} from './world'
import {WINDOWS_ROOTS} from './test-system'
type Receipt={component:'AbovePrompt';requestId:string;surface:string;count:number;at:number|null}
for(const surface of ['desktop','terminal'] as const)test('D1 owned '+surface+' AbovePrompt receipt records its completed return clock and actual mount identity',async($,on)=>{
 const w=world(on,{store:RECENT,surfaces:[surface],settings:{prefersReducedMotion:true}})
 await $.session.start({cwd:WINDOWS_ROOTS?'C:\\Users\\windows\\owned-render':'/tmp/owned-render',surface,isInteractive:true});await settleLegacyStart($,w)
 await $.command.run({command:'d1-fixture-owned-render-clock',args:'enable',origin:PERSON,presentation:P})
 const ui=await $.ui.mount({surface,...band(100)});await ui.drawn()
 const read=async(requestId:string|null)=>JSON.parse((await $.command.run({command:'d1-fixture-owned-render-receipt',args:JSON.stringify(['AbovePrompt',requestId,surface]),origin:PERSON,presentation:P})).text!)
 const rows=await read(null) as Receipt[];expect(rows.length,'owned source AbovePrompt callback has one actual mounted request').toBe(1)
 const receipt=rows[0]!;expect(receipt.component).toBe('AbovePrompt');expect(receipt.surface).toBe(surface);expect(receipt.requestId.length).toBeGreaterThan(0);expect(receipt.count,'owned source AbovePrompt callback returned').toBeGreaterThan(0);expect(receipt.at).toBe(w.clock.now())
 expect(await read(receipt.requestId),'owned receipt getter is read-only').toEqual(receipt);expect(await read(null)).toEqual(rows)
 await w.clock.advance(159);await ui.redraw();await ui.drawn()
 const advanced=await read(receipt.requestId) as Receipt;expect(advanced.count,'owned cached redraw actually returned').toBeGreaterThan(receipt.count);expect(advanced.at,'owned cached redraw timestamp follows actual clock without intervening source clock request').toBe(w.clock.now());expect(advanced.at).toBe(receipt.at!+159)
 const timing=JSON.parse((await $.command.run({command:'d1-fixture-owned-render-clock',args:'read',origin:PERSON,presentation:P})).text!);expect(timing.clockRequests).toBeGreaterThan(0);expect(timing.clockErrors).toBe(0);expect(timing.pending).toBe(0)
 console.log('D1_OWNED_RENDER_RECEIPT_METRIC '+JSON.stringify({receipt,advanced,timing,scope:'actual production-owned AbovePrompt return; explicit opted-in readonly test clock.now after actual return, preserving synchronous desktop return; explicit contract redraw only; seam never forces redraw; no blit or OS paint claim'}));await ui.unmount()
})
