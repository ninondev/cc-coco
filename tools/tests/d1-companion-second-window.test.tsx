import {test,expect} from 'claude-code/testing'
import {presenceWorld,snapshot} from './presence-world'
import {band,MORNING,PERSON,P} from './world'
import {D1_WORDS_TEXT} from './d1-room-fixture'
import {C3_WORDS_RAW} from './c3-words-fixture'
const start={cwd:'/tmp/presence-project',surface:'desktop' as const,isInteractive:true}
const words=(path:string)=>path.endsWith('d1-words.json')?D1_WORDS_TEXT:path.endsWith('c3-text.json')?C3_WORDS_RAW:undefined
const store={firstMet:MORNING-86400000,stamps:{met:MORNING-86400000},occasions:{omenOffered:'2026-10-02',warned:{}},omen:{day:'2026-10-02',rank:1,index:0}}
async function flush($:any){for(let i=0;i<80;i++)await $.command.run({command:'d1-presence-source-boundary',args:'',origin:PERSON,presentation:P})}
async function settle($:any,f:ReturnType<typeof presenceWorld>){await f.clock.advance(0);await flush($);await f.clock.advance(0);await flush($)}
function gate(){let entered!:()=>void,release!:()=>void;return {entered:new Promise<void>(r=>entered=r),held:new Promise<void>(r=>release=r),enter:()=>entered(),release:()=>release()}}
function currentFeed(f:ReturnType<typeof presenceWorld>){const row=f.companionFeeds.at(-1);expect(row).toBeDefined();return row!}
function storedProjection(f:ReturnType<typeof presenceWorld>,caseIndex:number){expect(Object.prototype.hasOwnProperty.call(f.view(),'companionPose')).toBe(false);expect(Object.prototype.hasOwnProperty.call(f.view(),'companionLine')).toBe(false)}
 test('D1 actual second-window band gesture and line preserve the companion underlying frame and speech',{options:{band:'on'}},async($,on)=>{
  on('classic.CwdChanged',()=>({}))
  const f=presenceWorld(on,snapshot(),{withNativePresence:true,store:{...store,lastActive:MORNING-86400000},companion:true,macCapabilities:true,reducedMotion:false,readText:words})
  await $.session.start(start);await settle($,f)
  await $.session.attach({clientId:'projection-ambient-first',surface:'desktop'});await settle($,f)
  await f.clock.advance(10000);await settle($,f)
  await $.classic.CwdChanged({old_cwd:start.cwd,new_cwd:start.cwd})
  const ui=await $.ui.mount({surface:'desktop',...band(100)})
  expect(f.view().line?.key).toBe('ambient');await ui.redraw();await ui.drawn();await settle($,f)
  await $.classic.CwdChanged({old_cwd:start.cwd,new_cwd:start.cwd})
  const priorDeadline=f.view().line!.expiresAt;expect(priorDeadline).toBe(MORNING+24000)
  await f.clock.advance(5000);await settle($,f);expect(f.view().said).toBe(null)
  expect(f.view().line?.key).toBe('ambient');expect(currentFeed(f).said).toBe(f.view().line!.text)
  await f.clock.advance(100);await settle($,f)
  const before=currentFeed(f),feedIndex=f.companionFeeds.length,gainedAt=MORNING+15100
  expect(f.insertSession('native-second',{cwd:'/tmp/native-second',ribbon:2,ribbonAt:gainedAt},gainedAt)).toBe(true);await settle($,f)
  expect(f.view().pose?.name).toBe('ribbon-glance');expect(f.view().line?.key).toBe('two.first');storedProjection(f,0)
  const after=currentFeed(f);expect(after.said===before.said).toBe(true);expect(after.frame).toBe(before.frame);expect(after.pose).toEqual(before.pose);expect(after.said).toBe(before.said)
  expect((after.ribbon as {visible?:boolean})?.visible).toBe(true)
  await f.clock.advance(719);await flush($);expect(currentFeed(f).pose).toEqual(before.pose);expect(currentFeed(f).said).toBe(before.said)
  await f.clock.advance(1);await flush($);expect(f.view().pose?.name==='ribbon-glance').toBe(false)
  expect(currentFeed(f).pose).toEqual(before.pose);expect(currentFeed(f).said).toBe(before.said)
  await f.clock.advance(priorDeadline-(gainedAt+720));await flush($)
  expect(f.view().line?.key).toBe('two.first');expect(currentFeed(f).said).toBe(null)
  storedProjection(f,0)
  await $.prompt.submit({text:'fixture activity',wait:false,origin:PERSON});await settle($,f)
  expect(currentFeed(f).said).toBe(null)
  console.log('D1_COMPANION_SECOND_WINDOW_METRIC '+JSON.stringify({before,feeds:f.companionFeeds.slice(feedIndex),scope:'shipping shared-transport second-window event and injected companion feed writes; no real app/window/notification reads'}))
  await ui.unmount();await $.session.end({reason:'clear',sessionId:'local-session',resume:{id:'local-session'}})
 })
 test('D1 actual prompt clears retained ambient speech while a band-only second-window line remains',{options:{band:'on'}},async($,on)=>{
  const f=presenceWorld(on,snapshot(),{withNativePresence:true,store:{...store,lastActive:MORNING-86400000},companion:true,macCapabilities:true,reducedMotion:false,readText:words})
  await $.session.start(start);const ui=await $.ui.mount({surface:'desktop',...band(100)});await settle($,f)
  await f.clock.advance(3000);await $.session.attach({clientId:'projection-ambient-prompt',surface:'desktop'});await settle($,f);expect(f.view().line?.key).toBe('ambient')
  const before=currentFeed(f),gainedAt=MORNING+3000
  expect(f.insertSession('prompt-second',{cwd:'/tmp/prompt-second',ribbon:2,ribbonAt:gainedAt},gainedAt)).toBe(true);await settle($,f)
  expect(f.view().line?.key).toBe('two.first');expect(currentFeed(f).said===before.said).toBe(true);expect(currentFeed(f).said).toBe(before.said);storedProjection(f,1)
  await $.prompt.submit({text:'fixture activity',wait:false,origin:PERSON});await settle($,f)
  expect(f.view().line?.key).toBe('two.first');expect(currentFeed(f).said).toBe(null)
  storedProjection(f,1)
  await ui.unmount();await $.session.end({reason:'clear',sessionId:'local-session',resume:{id:'local-session'}})
 })
 test('D1 actual held helper second-window event retains accepted native pose clocks and suppresses band-only speech',{options:{band:'on'}},async($,on)=>{
  const blocked=gate();on('tool.call',{tool:'Agent'},async()=>{blocked.enter();await blocked.held;return {result:{status:'completed',agentId:'native-helper',totalTokens:937,totalDurationMs:4500,totalToolUseCount:7}}})
  const f=presenceWorld(on,snapshot(),{withNativePresence:true,store,companion:true,macCapabilities:true,reducedMotion:false,readText:words})
  await $.session.start(start);const ui=await $.ui.mount({surface:'desktop',...band(100)});await settle($,f)
  await $.turn.start({turnId:'native-helper-turn',text:'fixture activity'});await f.clock.advance(1200);await settle($,f)
  const pending=$.tool.call({tool:'Agent',prompt:'fixture work',description:'fixture helper',subagent_type:'general-purpose',tool_use_id:'native-helper-call'});await blocked.entered
  try{
   await settle($,f);const before=currentFeed(f),pose=before.pose as {name:string;at:number;longAt:number};expect(pose.name).toBe('helper')
   const feedIndex=f.companionFeeds.length,gainedAt=MORNING+1200
   expect(f.insertSession('helper-second',{cwd:'/tmp/helper-second',ribbon:2,ribbonAt:gainedAt},gainedAt)).toBe(true);await settle($,f)
   expect(f.view().pose?.name).toBe('helper');expect(f.view().line?.key).toBe('two.first');storedProjection(f,2)
 expect(currentFeed(f).said===before.said).toBe(true)
   expect(currentFeed(f).pose).toEqual(pose);expect(currentFeed(f).said).toBe(before.said)
   await f.clock.advance(720);await flush($);expect(currentFeed(f).pose).toEqual(pose)
   expect((currentFeed(f).pose as {at:number}).at).toBe(pose.at);expect((currentFeed(f).pose as {longAt:number}).longAt).toBe(pose.longAt)
   expect(f.companionFeeds.slice(feedIndex).every(row=>JSON.stringify(row.pose)===JSON.stringify(pose))).toBe(true)
   console.log('D1_COMPANION_HELPER_SECOND_WINDOW_METRIC '+JSON.stringify({pose,feeds:f.companionFeeds.slice(feedIndex),scope:'actual held Agent and shared transport; existing ART gate skips unsupported helper glance; no shipping helper-glance reachability claim'}))
  }finally{blocked.release()}
  await pending;await ui.unmount();await $.session.end({reason:'clear',sessionId:'local-session',resume:{id:'local-session'}})
 })
