import {test,expect} from 'claude-code/testing'
import {world,RECENT,MORNING,settleLegacyStart,PERSON,P} from './world'
import {closeOwnedPane,observeOwnedPaneRenders} from './d1-owner-test-fixture'
import {D1_WORDS_TEXT} from './d1-room-fixture'
import {C3_WORDS_RAW} from './c3-words-fixture'
import {WINDOWS_ROOTS} from './test-system'

const start={cwd:WINDOWS_ROOTS?'C:\\Users\\windows\\d1-open-book-idle':'/tmp/d1-open-book-idle',surface:'desktop' as const,isInteractive:true}
const pane={surface:'desktop' as const,plugin:'coco',component:'Pane' as const,requestId:'coco-book',props:{title:'fixture',isFocused:true,bodyColumns:100,placement:'dock' as const,scroll:{offset:0,bodyRows:40},view:{}}}
const readText=(path:string)=>path.endsWith('d1-words.json')?D1_WORDS_TEXT:path.endsWith('c3-text.json')?C3_WORDS_RAW:undefined
async function flush($:any){for(let i=0;i<80;i++)await $.command.run({command:'d1-open-book-idle-boundary',args:'',origin:PERSON,presentation:P})}
const text=(n:any):string=>typeof n==='string'?n:Array.isArray(n)?n.map(text).join(''):n&&typeof n==='object'?text(n.children):''

for(const page of ['him','usage'] as const)test(`D1 open ${page} Pane has no reads timers invalidations or returned trees during60000ms settled idle`,{options:{band:'off'}},async($,on)=>{
 let draws=0;const timers:number[]=[],invalidations:string[]=[]
 observeOwnedPaneRenders(on,count=>{draws=count})
 on('clock.*',($,e,next)=>{if(next.is('clock.after',e))timers.push(e.ms);return next(e)})
 on('ui.invalidate',($,e,next)=>{invalidations.push(e.event);return next(e)})
 on('agent.spawn',()=>({agentId:'open-idle-helper',model:'fixture'}))
 const w=world(on,{store:{...RECENT,band:'off',stamps:{met:MORNING,shiori:MORNING},occasions:{shedFirst:true,twoFirst:true,warned:{}}},surfaces:['desktop'],readText})
 await $.session.start(start);await settleLegacyStart($,w)
 if(page==='usage'){
  await $.agent.spawn({prompt:'fixture work',description:'fixture completed board helper',subagentType:'general-purpose'})
  await $.turn.complete({turnId:'open-idle-helper-turn',agentId:'open-idle-helper',answer:'',reason:'aborted',durationMs:1000,isAborted:true})
 }
 await $.command.run({command:'coco',args:page,origin:PERSON,presentation:P})
 const ui=await $.ui.mount(pane);await flush($)
 if(page==='him')expect((await ui.findAll({type:'Svg'})).some((n:any)=>String(n.props.source).includes('viewBox="0 0 160 90"'))).toBe(true)
 else expect(text(await ui.drawn())).toContain('fixture completed board helper')
 await w.clock.advance(1601);await flush($)
 expect(draws).toBeGreaterThan(0)
 const sample=()=>({draws,reads:w.fileReads.length,timers:timers.length,invalidations:invalidations.length})
 const before=sample()
 await w.clock.advance(60000);await flush($)
 const after=sample();expect(after).toEqual(before)
 console.log('D1_OPEN_BOOK_IDLE_METRIC '+JSON.stringify({page,idleWindowMs:60000,before,after,forcedRedraws:0,scope:'actual shipping open Pane; virtual clock; returned-tree/read/scheduler/invalidation counters; no OS paint claim'}))
 await closeOwnedPane($);await ui.unmount()
})
