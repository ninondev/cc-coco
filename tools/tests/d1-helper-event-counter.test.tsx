import {test,expect} from 'claude-code/testing'
import {world,RECENT,MORNING,settleLegacyStart,band,PERSON,P} from './world'
import {D1_WORDS_TEXT} from './d1-room-fixture'
import {C3_WORDS_RAW} from './c3-words-fixture'
import {WINDOWS_ROOTS} from './test-system'
async function flush($:any){for(let i=0;i<80;i++)await $.command.run({command:'d1-helper-budget-boundary',args:'',origin:PERSON,presentation:P})}
type Callback={kind:'begun'|'completed';deadline:number;elapsed:number}
for(const exit of ['error','aborted'] as const)test(`D1 actual mocked-backend helper ${exit} has two event returned trees and one240ms cleanup returned tree`,{options:{band:'on'}},async($,on)=>{
 const waits:number[]=[],invalidations:string[]=[]
 on('clock.*',($,e,next)=>{if(next.is('clock.after',e))waits.push(e.ms);return next(e)})
 on('ui.invalidate',($,e,next)=>{invalidations.push(e.event);return next(e)})
 on('agent.spawn',()=>({agentId:'budget-helper',model:'fixture'}))
 const w=world(on,{store:{...RECENT,band:'on',stamps:{met:MORNING,shiori:MORNING},occasions:{shedFirst:true,twoFirst:true,warned:{}}},surfaces:['desktop'],readText:path=>path.endsWith('d1-words.json')?D1_WORDS_TEXT:path.endsWith('c3-text.json')?C3_WORDS_RAW:undefined})
 await $.session.start({cwd:WINDOWS_ROOTS?'C:\\Users\\windows\\d1-helper-budget':'/tmp/d1-helper-budget',surface:'desktop',isInteractive:true});await settleLegacyStart($,w)
 const ui=await $.ui.mount({surface:'desktop',...band(100)});await $.turn.start({turnId:'budget-main',text:'fixture work'});await ui.drawn();await flush($)
 const count=async()=>Number((await $.command.run({command:'d1-fixture-desktop-returned-trees',args:'',origin:PERSON,presentation:P})).text)
 const callbacks=async()=>JSON.parse((await $.command.run({command:'d1-fixture-helper-callbacks',args:'',origin:PERSON,presentation:P})).text) as Callback[]
 const sample=async()=>({returnedTrees:await count(),callbacks:await callbacks(),scheduledTimers:waits.length,invalidations:invalidations.length})
 const before=await sample();expect(before.returnedTrees).toBeGreaterThan(0);expect(before.callbacks).toEqual([])
 await $.agent.spawn({prompt:'fixture work',description:'fixture helper',subagentType:'general-purpose'});await ui.drawn();await flush($);const started=await sample();expect(w.view().helpersCount).toBe(1)
 await $.turn.complete({turnId:'budget-helper-turn',agentId:'budget-helper',answer:'',reason:exit,durationMs:1000,isAborted:exit==='aborted'});await ui.drawn();await flush($);const stopped=await sample();console.log('D1_HELPER_STOP_COUNTER_METRIC '+JSON.stringify({exit,before,started,stopped}));expect(stopped.returnedTrees-started.returnedTrees).toBe(1);expect(w.view().helpersCount).toBe(0);expect(w.view().helpers?.some(h=>h.id==='budget-helper')).toBe(true);expect(stopped.callbacks).toEqual([])
 await w.clock.advance(239);await ui.drawn();await flush($);const at239=await sample();expect(w.view().helpers?.some(h=>h.id==='budget-helper')).toBe(true);expect(at239.callbacks).toEqual([])
 await w.clock.advance(1);await ui.drawn();await flush($);const at240=await sample();expect(w.view().helpers??[]).toEqual([])
 expect(at240.callbacks.map(c=>c.kind)).toEqual(['begun','completed']);for(const c of at240.callbacks)expect(c.elapsed).toBe(240);expect(new Set(at240.callbacks.map(c=>c.deadline)).size).toBe(1)
 console.log('D1_HELPER_BUDGET_COUNTER_METRIC '+JSON.stringify({exit,before,started,stopped,at239,at240,expectedStartStopReturnedTrees:2,expectedLeaveReturnedTrees:1,scope:'actual shipping mounted desktop event hooks; agent.spawn backend mocked; virtual239/240; scratch-only same-hook returned tree and completed callback counters; no genuine AgentTool/provider/OS paint claim'}))
 // Private measurement variant removes only the four budget assertions below.
 expect(started.returnedTrees-before.returnedTrees).toBe(1)
 expect(at239.returnedTrees).toBe(stopped.returnedTrees)
 expect(at240.returnedTrees-at239.returnedTrees).toBe(1)
 await ui.unmount()
})
