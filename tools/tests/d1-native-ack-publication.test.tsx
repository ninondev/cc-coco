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
test('D1 actual native ACK publishes the approved first-display deadline before any later publisher',{options:{band:'on'}},async($,on)=>{
  on('classic.CwdChanged',()=>({}))
  const f=presenceWorld(on,snapshot(),{withNativePresence:true,store:{...store,lastActive:MORNING-86400000},companion:true,macCapabilities:true,reducedMotion:false,readText:words})
  await $.session.start(start);await settle($,f)
  await $.session.attach({clientId:'ack-publication-ambient-first',surface:'desktop'});await settle($,f)
  await f.clock.advance(10000);await settle($,f)
  await $.classic.CwdChanged({old_cwd:start.cwd,new_cwd:start.cwd})
  const ui=await $.ui.mount({surface:'desktop',...band(100)})
  expect(f.view().line?.key).toBe('ambient')
  await ui.redraw();await ui.drawn();await settle($,f)
  // Read the actual state.set-observed host cell before CwdChanged or any other publisher.
  // Unknown boundary commands above only drain the engine; their handlers do not publish state.
  expect(f.view().line?.key).toBe('ambient')
  console.log('D1_NATIVE_ACK_PUBLICATION_METRIC '+JSON.stringify({firstDisplayAt:MORNING+10000,publishedExpiresAt:f.view().line!.expiresAt,expectedExpiresAt:MORNING+24000,scope:'actual documented ui.drawn and native state.set facade; no real provider or presentation acceptance'}))
  expect(f.view().line!.expiresAt).toBe(MORNING+24000)
  await ui.unmount();await $.session.end({reason:'clear',sessionId:'local-session',resume:{id:'local-session'}})
})
