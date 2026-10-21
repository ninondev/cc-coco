import {test,expect} from 'claude-code/testing'
import {world,RECENT,MORNING,settleLegacyStart,band,desktopPicture,stubPng,PERSON,P,SUMMARY} from './world'
import {D1_WORDS_TEXT} from './d1-room-fixture'
import {C3_WORDS_RAW} from './c3-words-fixture'
import {WINDOWS_ROOTS} from './test-system'
import {desktopRenderReceipts} from './desktop-render-receipts'
const start={cwd:WINDOWS_ROOTS?'C:\\Users\\windows\\d1-shed-cache':'/tmp/d1-shed-cache',surface:'desktop' as const,isInteractive:true}
import {effectiveD1DesktopPixel} from './d1-pixel-css-observer'
const cuts=['shed-a','shed-b','shed-c'].map(stubPng)
async function flush($:any){for(let i=0;i<20;i++)await $.command.run({command:'d1-source-boundary',args:'',origin:PERSON,presentation:P})}

// Coco (coco-motion.ts, owner 10-14 cards): compaction is the shell change. She packs while it runs,
// then plays her outfit's shell clip into the other outfit, worn until the next compaction.
const label=(svg:string)=>/data-coco="([^"]+)"/.exec(svg)?.[1]
test('D1 actual compaction plays the Coco shell change into the other outfit',{options:{band:'on'}},async($,on)=>{
 const w=world(on,{store:{...RECENT,band:'on',stamps:{met:MORNING,shiori:MORNING},occasions:{shedFirst:true,warned:{}}},surfaces:['desktop'],settings:{prefersReducedMotion:false},readText:path=>path.endsWith('d1-words.json')?D1_WORDS_TEXT:path.endsWith('c3-text.json')?C3_WORDS_RAW:undefined})
 await $.session.start(start);await settleLegacyStart($,w);const ui=await $.ui.mount({surface:'desktop',...band(100)})
 expect(label(String((await desktopPicture(ui))?.props.source))).toBe('A idle')
 await $.session.compact({trigger:'manual',messages:[SUMMARY]});await flush($);await ui.redraw();await flush($)
 const source=String((await desktopPicture(ui))?.props.source);expect(label(source)).toBe('A shell');expect(source).toContain('@keyframes')
 expect((w.view() as {outfit?:string}).outfit).toBe('B')
 await w.clock.advance(60000);await flush($);await ui.redraw();await flush($)
 expect(label(String((await desktopPicture(ui))?.props.source))).toBe('A shell')
 // after the change she is back to the moods, in the outfit she now wears
 await $.turn.start({text:'go',turnId:'after-shell'});await flush($);await ui.redraw();await flush($)
 expect(label(String((await desktopPicture(ui))?.props.source))).toBe('B think')
 await $.turn.complete({turnId:'after-shell',reason:'answer',answer:'Done.',durationMs:1000,isAborted:false});await w.clock.advance(60000);await flush($)
 await $.session.compact({trigger:'manual',messages:[SUMMARY]});await flush($);await ui.redraw();await flush($)
 expect(label(String((await desktopPicture(ui))?.props.source))).toBe('B shell')
 await ui.unmount()
})

test('D1 mounted compact desktop measures compaction begin and end redraws without forcing a redraw',{options:{band:'compact'}},async($,on)=>{
 const renders=desktopRenderReceipts(on),waits:number[]=[],invalidations:number[]=[]
 let entered!:()=>void,release!:()=>void;const atNext=new Promise<void>(r=>entered=r),held=new Promise<void>(r=>release=r)
 on('clock.*',($,e,next)=>{if(next.is('clock.after',e))waits.push(e.ms);return next(e)})
 on('ui.invalidate',($,e,next)=>{invalidations.push(renders.current());return next(e)})
 on('session.compact',{trigger:'manual'},async()=>{entered();await held;return {messages:[SUMMARY],tokensBefore:1000,tokensAfter:100}})
 on('process.run',()=>({value:{exitCode:1,stdout:'',stderr:'fixture decoder unavailable',isStdoutTruncated:false,isStderrTruncated:false}}))
 on('fs.read',{path:/[\\/]assets[\\/]pixel[\\/]4[234]-shed-[abc]\.png$/},($,e)=>({value:{base64:cuts[Number(e.path.match(/[\\/]4([234])-shed-/)![1])-2]!}}))
 const effective=effectiveD1DesktopPixel(on,()=>w.clock.now())
 const w=world(on,{store:{...RECENT,band:'compact',stamps:{met:MORNING,shiori:MORNING},occasions:{shedFirst:true,warned:{}}},surfaces:['desktop'],settings:{prefersReducedMotion:false},readText:path=>path.endsWith('d1-words.json')?D1_WORDS_TEXT:path.endsWith('c3-text.json')?C3_WORDS_RAW:undefined})
 await effective.enable($)
 await $.session.start(start);await settleLegacyStart($,w);const ui=await $.ui.mount({surface:'desktop',...band(100)});await w.clock.advance(1600);await renders.flush($)
 const sample=()=>({renders:renders.available?renders.current():null,invalidations:invalidations.length,scheduledTimers:waits.length,reads:w.fileReads.length})
 const source=async()=>effective.source(ui)
 const before=sample();if(renders.available)expect(before.renders!).toBeGreaterThan(0)
 const pending=$.session.compact({trigger:'manual',messages:[SUMMARY]});await atNext;await renders.flush($)
 // Coco: pack while it runs, the shell clip once it ends; the clip plays by itself, the old cuts never load
 const begun=sample();try{expect(w.view().shed?.phase).toBe('begin');expect(label(await source())).toBe('A pack')}finally{release()}
 await pending;await renders.flush($);const ended=sample(),shell=await source();expect(w.view().shed?.phase).toBe('end');expect(label(shell)).toBe('A shell')
 await w.clock.advance(159);await renders.flush($);const at159=sample();expect(await source()).toBe(shell)
 await w.clock.advance(1);await renders.flush($);const at160=sample();expect(await source()).toBe(shell)
 await w.clock.advance(200);await renders.flush($);const at360=sample();expect(await source()).toBe(shell)
 await w.clock.advance(600);await renders.flush($);const at960=sample();expect(await source()).toBe(shell)
 for(const cut of cuts)expect(shell).not.toContain(cut);expect(at960.renders).toBe(at159.renders)
 const delta=(a:ReturnType<typeof sample>,b:ReturnType<typeof sample>)=>({renders:a.renders===null||b.renders===null?null:b.renders-a.renders,invalidations:b.invalidations-a.invalidations,scheduledTimers:b.scheduledTimers-a.scheduledTimers,reads:b.reads-a.reads})
 console.log('D1_SHED_EVENT_REDRAW_METRIC '+JSON.stringify({actualRenderCounterAvailable:renders.available,before,begun,ended,at159,at160,at360,at960,deltas:{begin:delta(before,begun),end:delta(begun,ended),endTo159:delta(ended,at159),cut159To160:delta(at159,at160),cut160To360:delta(at160,at360),return360To960:delta(at360,at960)},forcedRedraws:0,scope:'actual shipping mounted compact AbovePrompt and gated session.compact; virtual clock exact cuts; all work counted; valid distinct PNG fixture identities; no pixel appearance claim'}))
 await ui.unmount()
})

test('D1 mounted compact desktop draws the shell change through the shipping cached picture path',{options:{band:'compact'}},async($,on)=>{
 const renders=desktopRenderReceipts(on),waits:number[]=[],invalidates:number[]=[]
 on('clock.*',($,e,next)=>{if(next.is('clock.after',e))waits.push(e.ms);return next(e)})
 on('ui.invalidate',($,e,next)=>{invalidates.push(waits.length);return next(e)})
 on('process.run',()=>({value:{exitCode:1,stdout:'',stderr:'fixture decoder unavailable',isStdoutTruncated:false,isStderrTruncated:false}}))
 on('fs.read',{path:/[\\/]assets[\\/]pixel[\\/]4[234]-shed-[abc]\.png$/},($,e)=>({value:{base64:cuts[Number(e.path.match(/[\\/]4([234])-shed-/)![1])-2]!}}))
 const effective=effectiveD1DesktopPixel(on,()=>w.clock.now())
 const w=world(on,{store:{...RECENT,band:'compact',stamps:{met:MORNING,shiori:MORNING},occasions:{shedFirst:true,warned:{}}},surfaces:['desktop'],settings:{prefersReducedMotion:false},readText:path=>path.endsWith('d1-words.json')?D1_WORDS_TEXT:path.endsWith('c3-text.json')?C3_WORDS_RAW:undefined})
 await effective.enable($)
 await $.session.start(start);await settleLegacyStart($,w)
 const ui=await $.ui.mount({surface:'desktop',...band(100)});await w.clock.advance(0);await flush($)
 await $.session.compact({trigger:'manual',messages:[SUMMARY]});await w.clock.advance(0);await flush($)
 const source=async()=>{await ui.redraw();await flush($);return effective.source(ui)}
 // Coco: one shell picture through the whole 1600 ms, the same string on every redraw (cached play)
 const at0=await source();expect(label(at0)).toBe('A shell');for(const cut of cuts)expect(at0).not.toContain(cut)
 await w.clock.advance(159);const at159=await source();expect(at159).toBe(at0)
 await w.clock.advance(1);const at160=await source();expect(at160).toBe(at0)
 await w.clock.advance(200);const at360=await source();expect(at360).toBe(at0)
 await w.clock.advance(600);const at960=await source();expect(at960).toBe(at0)
 await w.clock.advance(640);await flush($);await renders.flush($)
 const idleBefore={waits:waits.length,invalidations:invalidates.length,renders:renders.current(),reads:w.fileReads.length}
 await w.clock.advance(10000);await renders.flush($)
 const idleAfter={waits:waits.length,invalidations:invalidates.length,renders:renders.current(),reads:w.fileReads.length}
 expect(idleAfter.waits).toBe(idleBefore.waits);expect(idleAfter.invalidations).toBe(idleBefore.invalidations);expect(idleAfter.reads).toBe(idleBefore.reads)
 if(renders.available){expect(idleBefore.renders).toBeGreaterThan(0);expect(idleAfter.renders).toBe(idleBefore.renders)}
 const record={idleWindowMs:10000,idleBefore,idleAfter,actualRenderCounterAvailable:renders.available,scope:'mounted AbovePrompt; shipping session.compact/cache; mocked valid PNG cut identities; no pixel appearance claim',atMs:[0,159,160,360,960],distinctSources:1,scheduledWaitsMs:[...waits],invalidations:invalidates.length}
 console.log('D1_SHED_CACHE_METRIC '+JSON.stringify(record));await ui.unmount()
})
