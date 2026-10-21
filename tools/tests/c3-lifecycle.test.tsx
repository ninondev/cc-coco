import { DIAGNOSTIC_APPEND } from '../hooks/shared-files'
import {test,expect} from 'claude-code/testing'
import {world,RECENT,MORNING,PERSON,band,settleLegacyStart} from './world'
import {C3_WORDS_RAW} from './c3-words-fixture'
import {LINES} from '../hooks/lines'
const START={cwd:'/tmp/c3-lifecycle',surface:'desktop' as const,isInteractive:true}
const text=(v:any):string=>typeof v==='string'?v:Array.isArray(v)?v.map(text).join(''):v&&typeof v==='object'?text(v.children):''
function setup(on:any,store:Record<string,unknown>={}){
 const records:any[]=[]
 on('fs.exists',{path:/[\\/]diagnostics$/},()=>({value:true}))
 on('process.run',($:any,e:any)=>{
  if((e.argv[0] === '/bin/sh' && e.argv[1] === '-c' && e.argv[2] === DIAGNOSTIC_APPEND)){for(const line of (e.init?.stdin??'').trim().split('\n'))if(line)records.push(JSON.parse(line));return {value:{exitCode:0,stdout:'',stderr:''}}}
  return {value:{exitCode:0,stdout:JSON.stringify({ok:true,result:e.init?.stdin&&JSON.parse(e.init.stdin).op==='guard'?{}:null}),stderr:''}}
 })
 const w=world(on,{store:{...RECENT,firstMet:MORNING,stamps:{met:MORNING},omen:{day:'2026-10-02',rank:1,index:0},...store},surfaces:['desktop'],env:{HOME:'/tmp/c3-lifecycle-home',LANG:'en_US.UTF-8'},readText:path=>path.endsWith('c3-text.json')?C3_WORDS_RAW:undefined})
 return {w,records,count:()=>records.filter(r=>r.step==='returned-tree'&&r.surface==='desktop').length}
}
async function flush($:any){for(let i=0;i<30;i++)await $.command.run({command:'c3-host-boundary',args:'',origin:PERSON,presentation:{isFullscreen:false,columns:100}})}
test('C3 thanks keeps flustered for 1600ms across immediate turn start, then think; praised stays one line',async($,on)=>{
 const f=setup(on);await $.session.start(START);await settleLegacyStart($,f.w)
 const ui=await $.ui.mount({surface:'desktop',...band(100,false)})
 await $.prompt.submit({text:'thanks',wait:false,origin:PERSON});await $.turn.start({text:'thanks',turnId:'thanks'})
 expect(f.w.view().mood).toBe('flustered');await f.w.clock.advance(1599);expect(f.w.view().mood).toBe('flustered');await f.w.clock.advance(1);expect(f.w.view().mood).toBe('think')
 await ui.redraw();const praise=LINES.en.praised,drawn=text(await ui.drawn());expect(praise.some(p=>drawn.includes(p))).toBe(true)
 expect(praise.filter(p=>drawn.includes(p)).length).toBe(1);await ui.unmount()
})
test('C3 desktop idle has zero automatic renders in a settled minute; event redraw counts are measured',async($,on)=>{
 const f=setup(on);await $.session.start(START);await settleLegacyStart($,f.w)
 const beforeMount=f.count(),ui=await $.ui.mount({surface:'desktop',...band(100,false)});await flush($);expect(f.count()).toBeGreaterThan(beforeMount)
 await f.w.clock.advance(20000);await flush($);const before=f.count();await f.w.clock.advance(60000);await ui.drawn();await flush($);const idle=f.count()-before;expect(idle).toBe(0)
 const events:Record<string,number>={}
 let at=f.count();await $.prompt.submit({text:'Inspect the parser',wait:false,origin:PERSON});await f.w.clock.advance(0);await ui.drawn();await flush($);events.prompt=f.count()-at
 at=f.count();await $.turn.start({text:'Inspect the parser',turnId:'t1'});await f.w.clock.advance(0);await ui.drawn();await flush($);events.turnStart=f.count()-at
 at=f.count();await $.tool.call({tool:'Read',file_path:START.cwd+'/parser.ts'});await f.w.clock.advance(0);await ui.drawn();await flush($);events.toolCall=f.count()-at
 at=f.count();await $.turn.complete({turnId:'t1',answer:'done',reason:'answer',durationMs:1000,isAborted:false});await f.w.clock.advance(0);await ui.drawn();await flush($);events.turnComplete=f.count()-at
 console.log(JSON.stringify({c3Lifecycle:{idleRendersPerMinute:idle,redrawsPerEvent:events,scope:'engine test kit desktop automatic render dispatch'}}))
 await ui.unmount()
})

// Breathing (PLAY 4.1, on by default since 10-09) adds one publication of its own when the turn passes 20 s.
for (const breathe of [false, true]) test(`C3 working-minute long line and its shared deadline publish exactly twice (breathing ${breathe ? 'on: one more for the breath' : 'off'})`,async($,on)=>{
 let counting=false,pulses=0
 const publications:{said:string|null,breath:boolean}[]=[]
 on('state.set',{key:'bandWake'},($,e,next)=>{if(counting)pulses++;return next(e)})
 on('state.set',{key:'view'},async($,e,next)=>{const result=await next(e);const value=e.value as {said:string|null,play?:{breath?:unknown}};if(counting&&result.value?.isSet)publications.push({said:value.said,breath:value.play?.breath!==undefined});return result})
 const f=setup(on,breathe?{}:{bandSettings:{breathe:false}});await $.session.start(START);await settleLegacyStart($,f.w)
 await $.turn.start({text:'Inspect the parser',turnId:'long-line'})
 const ui=await $.ui.mount({surface:'desktop',...band(100,true)})
 await $.tool.call({tool:'Read',file_path:START.cwd+'/parser.ts'});await f.w.clock.advance(15000);await flush($)
 counting=true;await f.w.clock.advance(60000);await flush($);counting=false
 // A text publication changes what he says; the breath's own publication (at 20 s, before the long line) does not.
 const lines=publications.filter((row,i)=>row.said!==(i===0?null:publications[i-1]!.said))
 expect(pulses).toBe(breathe?3:2);expect(publications.length).toBe(breathe?3:2);expect(lines.length).toBe(2)
 expect(LINES.en.thinking_long).toContain(lines[0]!.said);expect(lines[1]!.said).toBe(null)
 if(breathe)expect(publications[0]).toEqual({said:null,breath:true});else expect(publications.some(row=>row.breath)).toBe(false)
 console.log(JSON.stringify({c3SharedExpiry:{breathe,bandPulses:pulses,textPublications:lines.length,scope:'engine test kit automatic dispatch'}}))
 await ui.unmount()
})
