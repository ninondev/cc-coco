import { TIMING } from '../hooks/mood'
import{WINDOWS_ROOTS}from'./test-system'
import type{On}from'claude-code'
import{presenceWorld,snapshot,type SharedSnapshot}from'./presence-world'
import{test,expect}from'claude-code/testing'
import{world,RECENT,settleLegacyStart,band,desktopPicture,P,PERSON,MORNING,cocoBandText}from'./world'
const START={cwd:'/tmp/b1c-motion-events',surface:'desktop' as const,isInteractive:true}
const source=async(ui:Parameters<typeof desktopPicture>[0])=>String((await desktopPicture(ui))?.props.source)
async function flush($:any){for(let i=0;i<30;i++)await $.command.run({command:'b1c-host-boundary',args:'',origin:PERSON,presentation:P})}
// Coco (coco-motion.ts): a touch is a new play from the moment it lands, its first track starting at 0
const firstDelay=(svg:string)=>/animation:c[0-9a-z]+_k\d+ \d+ms linear (-?\d+)ms/.exec(svg)?.[1]
for(const requested of['poke','pat']as const)test('actual nap then '+requested+' uses a fresh one-shot clock',{timeoutMs:20000},async($,on)=>{
 const w=world(on,{withNativePresence:true,store:RECENT});await $.session.start(START);await settleLegacyStart($,w);const ui=await $.ui.mount({surface:'desktop',...band(100)})
 await w.clock.advance(TIMING.sleepAfter(w.clock.now()));await flush($);expect(w.view().mood).toBe('sleep')
 await ui.press({key:'coco:band:poke'});await w.clock.advance(60000);await flush($)
 await ui.press({key:'coco:band:'+requested});await w.clock.advance(500);await flush($);const svg=await source(ui)
 expect(svg).toContain('@keyframes');expect(svg).toContain('data-coco="A petted"');expect(firstDelay(svg)).toBe('0')
})
test('actual happy-to-idle settling never replays happy on a later touch',{timeoutMs:20000},async($,on)=>{
 const w=world(on,{store:RECENT});await $.session.start(START);await settleLegacyStart($,w);const ui=await $.ui.mount({surface:'desktop',...band(100)})
 await $.turn.start({turnId:'entry',text:'go'});await $.turn.complete({turnId:'entry',reason:'answer',answer:'Done.',durationMs:1200,isAborted:false})
 await w.clock.advance(20000);await flush($);expect(w.view().mood).toBe('idle')
 await ui.press({key:'coco:band:poke'});expect((await source(ui)).includes('data-name="happy"')).toBe(false)
})

if(!WINDOWS_ROOTS){
test('actual presence sleep starts from the running burst before clearing it',{timeoutMs:20000},async($,on)=>{
 const f=animatedPresence(on,snapshot('activity',MORNING));await $.session.start(START);const ui=await $.ui.mount({surface:'desktop',...band(100)});await f.clock.advance(0);await flush($)
 await ui.press({key:'coco:band:poke'});await f.clock.advance(300);await ui.press({key:'coco:band:pat'});await f.clock.advance(300);await ui.press({key:'coco:band:poke'});await f.clock.advance(1200)
 f.remote(snapshot('sleep',f.clock.now(),f.current.seq+1));await flush($);expect(f.view().mood).toBe('sleep')
 const svg=await source(ui);expect(svg).toContain('data-coco="A nap"')
 // the sink out of the drawing the burst left (0.12 s), then the nap
 expect(svg).toMatch(/^[^]*?animation:c[0-9a-z]+_k\d+ 120ms linear 0ms 1 forwards/)
})
for(const requested of['poke','pat']as const)test('actual presence wake then '+requested+' starts a new reaction60seconds later',{timeoutMs:20000},async($,on)=>{
 const f=animatedPresence(on,snapshot('sleep',MORNING-300000));await $.session.start(START);const ui=await $.ui.mount({surface:'desktop',...band(100)});await f.clock.advance(0);await flush($)
 const at=f.clock.now();f.remote({...snapshot('activity',at,f.current.seq+1),wakeEvent:{kind:'wake',id:`wake:0:${at-300000}`,at}});await flush($);expect(f.view().mood).toBe('idle')
 await f.clock.advance(60000);await flush($);await ui.press({key:'coco:band:'+requested});await f.clock.advance(500);await flush($);const svg=await source(ui)
 expect(svg).toContain('@keyframes');expect(svg).toContain('data-coco="A petted"');expect(firstDelay(svg)).toBe('0')
})

}
function animatedPresence(on:On,initial:SharedSnapshot){const fixtureOn=((event:string,...args:unknown[])=>event==='settings.read'?(on as any)(event,()=>({value:{timeZone:'UTC',prefersReducedMotion:false}})):(on as any)(event,...args))as On;return presenceWorld(fixtureOn,initial,{withNativePresence:true,readText:cocoBandText})}
