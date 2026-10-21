import {test,expect} from 'claude-code/testing'
import {world,RECENT,MORNING,settleLegacyStart,PERSON,P,band} from './world'
import {D1_WORDS_TEXT} from './d1-room-fixture'
import {C3_WORDS_RAW} from './c3-words-fixture'
import {WINDOWS_ROOTS} from './test-system'
const cwd=WINDOWS_ROOTS?'C:\\Users\\windows\\d1-helper-silence':'/tmp/d1-helper-silence'
const readText=(path:string)=>path.endsWith('d1-words.json')?D1_WORDS_TEXT:path.endsWith('c3-text.json')?C3_WORDS_RAW:undefined
const snapshot=(w:ReturnType<typeof world>)=>JSON.parse(JSON.stringify({line:w.view().line??null,said:w.view().said??null,toasts:w.toasts}))
for(const state of ['done','failed','stopped'] as const)test(`D1 actual helper ${state} exit and240ms cleanup add no speech line said or toast`,{options:{band:'on'}},async($,on)=>{
 on('agent.spawn',()=>({agentId:'silent-exit-helper',model:'fixture'}))
 // the first whole batch back earns her taro socks and she says so once; she has them here, so only the exit is measured
 const w=world(on,{store:{...RECENT,firstMet:MORNING-86400000,stamps:{met:MORNING-86400000,shiori:MORNING-86400000},occasions:{shedFirst:true,twoFirst:true,warned:{}},bandSettings:{socksEarned:['taro']}},surfaces:['desktop'],readText})
 await $.session.start({cwd,surface:'desktop',isInteractive:true});await settleLegacyStart($,w)
 const ui=await $.ui.mount({surface:'desktop',...band(100)})
 await ui.drawn()
 await $.turn.start({turnId:'silent-exit-main',text:'fixture work'})
 await $.agent.spawn({prompt:'fixture work',description:'fixture helper',subagentType:'general-purpose'});await w.clock.advance(1000)
 for(let i=0;i<80;i++)await $.command.run({command:'d1-helper-silence-boundary',args:'',origin:PERSON,presentation:P})
 await ui.drawn();expect(w.view().helpersCount).toBe(1);const before=snapshot(w)
 let notice:Awaited<ReturnType<typeof $.ui.mount>>|undefined
 if(state==='done'){
  notice=await $.ui.mount({surface:'desktop',plugin:'coco',component:'UserMessage',requestId:'silent-exit-complete',props:{text:'fixture completion',origin:{kind:'task-notification'},task:{id:'silent-exit-helper',status:'completed',durationMs:1000}},viewport:{columns:120,rows:40}})
  await notice.drawn();await w.clock.advance(0)
 }else await $.turn.complete({turnId:'silent-exit-helper-turn',agentId:'silent-exit-helper',answer:'',reason:state==='failed'?'error':'aborted',durationMs:1000,isAborted:state==='stopped'})
 for(let i=0;i<80;i++)await $.command.run({command:'d1-helper-silence-boundary',args:'',origin:PERSON,presentation:P})
 expect(w.view().helpersCount).toBe(0);expect(w.view().helpers?.find(h=>h.id==='silent-exit-helper')?.state).toBe(state);expect(snapshot(w)).toEqual(before)
 await w.clock.advance(239);expect(w.view().helpers?.some(h=>h.id==='silent-exit-helper')).toBe(true);expect(snapshot(w)).toEqual(before)
 await w.clock.advance(1);for(let i=0;i<80;i++)await $.command.run({command:'d1-helper-silence-boundary',args:'',origin:PERSON,presentation:P})
 expect(w.view().helpers??[]).toEqual([]);expect(snapshot(w)).toEqual(before)
 if(notice)await notice.unmount();await ui.unmount()
})
