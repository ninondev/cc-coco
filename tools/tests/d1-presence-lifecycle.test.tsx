import {test,expect} from 'claude-code/testing'
import {fixtureStoreReader} from './d1-store-read-fixture'
import {presenceWorld,snapshot} from './presence-world'
import {band,MORNING,PERSON,P} from './world'
import {D1_WORDS_TEXT} from './d1-room-fixture'
import {C3_WORDS_RAW} from './c3-words-fixture'
import {WINDOWS_ROOTS} from './test-system'
const start={cwd:'/tmp/presence-project',surface:'desktop' as const,isInteractive:true}
const text=(n:any):string=>typeof n==='string'?n:Array.isArray(n)?n.map(text).join(''):n&&typeof n==='object'?text(n.children):''
const words=(path:string)=>path.endsWith('d1-words.json')?D1_WORDS_TEXT:path.endsWith('c3-text.json')?C3_WORDS_RAW:undefined
const store={firstMet:MORNING-86400000,stamps:{met:MORNING-86400000},occasions:{omenOffered:'2026-10-02',warned:{}},omen:{day:'2026-10-02',rank:1,index:0}}
async function flush($:any){for(let i=0;i<80;i++)await $.command.run({command:'d1-presence-source-boundary',args:'',origin:PERSON,presentation:P})}
async function settle($:any,f:ReturnType<typeof presenceWorld>){await f.clock.advance(0);await flush($);await f.clock.advance(0);await flush($)}
function gate(){let entered!:()=>void,release!:()=>void;return {entered:new Promise<void>(r=>entered=r),held:new Promise<void>(r=>release=r),enter:()=>entered(),release:()=>release()}}

if(!WINDOWS_ROOTS){
 test('D1 birth with two actual live claims shows a tied ribbon silently without a gain animation',{options:{band:'on'}},async($,on)=>{
  const readStored=fixtureStoreReader(on)
  const f=presenceWorld(on,snapshot(),{withNativePresence:true,store,reducedMotion:false,readText:words})
  expect(f.insertSession('existing-window',{cwd:'/tmp/existing-window',ribbon:2,ribbonAt:MORNING-1000},MORNING)).toBe(false)
  await $.session.start(start);const ui=await $.ui.mount({surface:'desktop',...band(100)});await settle($,f)
  expect(f.view().ribbon?.visible).toBe(true);expect(f.view().ribbon?.tiedAt).toBeUndefined();expect(f.view().pose?.name==='ribbon-glance').toBe(false);expect(f.view().line?.key==='two.first').toBe(false)
  expect((await readStored($,'occasions') as {twoFirst?:boolean})?.twoFirst).toBeUndefined()
  await ui.unmount();await $.session.end({reason:'clear',sessionId:'local-session',resume:{id:'local-session'}})
 })

 test('D1 shipping second-window event ties ribbon, saves two.first only after shown, restores at720ms and throttles30min',{options:{band:'on'}},async($,on)=>{
  const readStored=fixtureStoreReader(on)
  const f=presenceWorld(on,snapshot(),{withNativePresence:true,store,reducedMotion:false,readText:words})
  await $.session.start(start);const ui=await $.ui.mount({surface:'desktop',...band(100)});await settle($,f)
  expect(f.view().ribbon?.visible).toBe(false)
  await f.clock.advance(1000);await $.prompt.submit({text:'fixture activity',wait:false,origin:PERSON});await settle($,f)
  const firstAt=MORNING+1000
  expect(f.view().pose?.frame??f.view().frame).toBe('idle-reading')
  expect(f.insertSession('second-window',{cwd:'/tmp/second-window',ribbon:2,ribbonAt:firstAt},firstAt)).toBe(true);await flush($)
  expect(f.view().ribbon?.visible).toBe(true);expect(f.view().ribbon?.tiedAt).toBe(firstAt);expect(f.view().pose?.name).toBe('ribbon-glance')
  const firstLine=JSON.parse(D1_WORDS_TEXT)['two.first'].en
  const firstLineId=f.view().line?.id;expect(firstLineId).toBeDefined();expect(f.view().line?.key).toBe('two.first');expect((await readStored($,'occasions') as {twoFirst?:boolean})?.twoFirst).toBeUndefined()
  await ui.redraw();expect(text(await ui.drawn())).toContain(firstLine)
  expect((await readStored($,'occasions') as {twoFirst?:boolean})?.twoFirst).toBeUndefined()
  await f.clock.advance(0);await flush($);expect((await readStored($,'occasions') as {twoFirst?:boolean})?.twoFirst).toBe(true)
  await f.clock.advance(719);await flush($);expect(f.view().pose?.name).toBe('ribbon-glance')
  await f.clock.advance(1);await flush($);expect(f.view().pose?.name==='ribbon-glance').toBe(false)
  await f.clock.advance(280);await $.prompt.submit({text:'fixture activity',wait:false,origin:PERSON});await settle($,f)
  expect(f.removeSession('second-window',firstAt+1000)).toBe(true);await flush($);expect(f.view().ribbon?.visible).toBe(false)
  expect(f.insertSession('second-window',{cwd:'/tmp/second-window',ribbon:2,ribbonAt:firstAt+1000},firstAt+1000)).toBe(true);await settle($,f)
  expect(f.view().ribbon?.visible).toBe(true);expect(f.view().ribbon?.tiedAt).toBe(firstAt+1000);expect(f.view().pose?.name==='ribbon-glance').toBe(false);expect(f.view().line?.id).toBe(firstLineId)
  expect(f.removeSession('second-window',firstAt+1000)).toBe(true);await settle($,f)
  await f.clock.advance(1799001);await $.prompt.submit({text:'fixture activity',wait:false,origin:PERSON});await settle($,f);await f.clock.advance(1000);await settle($,f)
  const thirdAt=firstAt+1801001
  expect(f.insertSession('second-window',{cwd:'/tmp/second-window',ribbon:2,ribbonAt:thirdAt},thirdAt)).toBe(true);await flush($)
  expect(f.view().ribbon?.tiedAt).toBe(thirdAt);expect(f.view().pose?.name).toBe('ribbon-glance');expect(f.view().line?.key==='two.first').toBe(false)
  expect((await readStored($,'occasions') as {twoFirst?:boolean})?.twoFirst).toBe(true)
  console.log('D1_SECOND_WINDOW_METRIC '+JSON.stringify({firstAt,restoreCheckedMs:[719,720],earlyRejoinAt:firstAt+1000,allowedRejoinAt:thirdAt,onceSaved:true,scope:'content-free simulated native FS/process claims with valid live identities; actual shipping mounted older desktop session; no real multiapp screen claim'}))
  await ui.unmount();await $.session.end({reason:'clear',sessionId:'local-session',resume:{id:'local-session'}})
 })

 test('D1 second-window gain after clock advance without a prompt ties at live time and restores at719720ms',{options:{band:'on'}},async($,on)=>{
  const readStored=fixtureStoreReader(on)
  const f=presenceWorld(on,snapshot(),{withNativePresence:true,store,reducedMotion:false,readText:words})
  await $.session.start(start);const ui=await $.ui.mount({surface:'desktop',...band(100)});await settle($,f)
  expect(f.view().ribbon?.visible).toBe(false)
  await f.clock.advance(1234)
  const gainedAt=MORNING+1234
  expect(f.insertSession('fresh-clock-second',{cwd:'/tmp/fresh-clock-second',ribbon:2,ribbonAt:gainedAt},gainedAt)).toBe(true);await flush($)
  expect(f.view().ribbon?.tiedAt).toBe(gainedAt);expect(f.view().pose?.name).toBe('ribbon-glance');expect(f.view().pose?.at).toBe(gainedAt)
  await f.clock.advance(719);await flush($);expect(f.view().pose?.name).toBe('ribbon-glance')
  await f.clock.advance(1);await flush($);expect(f.view().pose?.name==='ribbon-glance').toBe(false)
  await ui.unmount();await $.session.end({reason:'clear',sessionId:'local-session',resume:{id:'local-session'}})
 })

 test('D1 actual unsupported tool-base second-window event ties ribbon while preserving its tool pose',{options:{band:'on'}},async($,on)=>{
  const readStored=fixtureStoreReader(on)
  const blocked=gate()
  on('tool.call',{tool:'Grep'},async($,e,next)=>{blocked.enter();await blocked.held;return next(e)})
  const f=presenceWorld(on,snapshot(),{withNativePresence:true,store,reducedMotion:false,readText:words})
  await $.session.start(start);const ui=await $.ui.mount({surface:'desktop',...band(100)});await settle($,f)
  await $.turn.start({turnId:'tool-turn',text:'fixture search'});await f.clock.advance(1200)
  const pending=$.tool.call({tool:'Grep',pattern:'fixture',path:start.cwd});await blocked.entered
  try{
   await flush($)
   const before=f.view().pose;expect(before?.name).toBe('search')
   expect(f.insertSession('tool-second',{cwd:'/tmp/tool-second',ribbon:2,ribbonAt:MORNING+1200},MORNING+1200)).toBe(true);await flush($)
   expect(f.view().ribbon?.visible).toBe(true);expect(f.view().ribbon?.tiedAt).toBe(MORNING+1200);expect(f.view().pose?.name).toBe(before?.name);expect(f.view().pose?.frame).toBe(before?.frame);expect(f.view().pose?.at).toBe(before?.at)
   console.log('D1_TOOL_GLANCE_SKIP_METRIC '+JSON.stringify({beforePose:before,afterPose:f.view().pose,ribbon:f.view().ribbon,scope:'ART A2; actual held Grep and native claim event; no unrelated art borrowed'}))
  }finally{blocked.release()}
  await pending;await ui.unmount();await $.session.end({reason:'clear',sessionId:'local-session',resume:{id:'local-session'}})
 })

 test('D1 actual reduced terminal second-window glance retains its120ms cut and restores at720ms',{options:{band:'on'}},async($,on)=>{
  const readStored=fixtureStoreReader(on)
  const waits:number[]=[]
  on('clock.*',($,e,next)=>{if(next.is('clock.after',e))waits.push(e.ms);return next(e)})
  const f=presenceWorld(on,snapshot(),{withNativePresence:true,store,reducedMotion:true,readText:words,surface:'terminal'})
  await $.session.start({...start,surface:'terminal'});const ui=await $.ui.mount({surface:'terminal',...band(100)});await settle($,f)
  expect(await ui.find({type:'Raster',key:'sprite'})).toBeDefined();const before=waits.length
  expect(f.view().pose?.frame??f.view().frame).toBe('idle-reading')
  expect(f.insertSession('terminal-second',{cwd:'/tmp/terminal-second',ribbon:2,ribbonAt:MORNING},MORNING)).toBe(true);await flush($);await ui.redraw();await flush($)
  expect(f.view().ribbon?.visible).toBe(true);expect(f.view().pose?.name).toBe('ribbon-glance');expect(waits.slice(before)).toContain(120)
  await f.clock.advance(119);await flush($);expect(f.view().pose?.name).toBe('ribbon-glance')
  await f.clock.advance(1);await flush($);expect(f.view().pose?.name).toBe('ribbon-glance')
  await f.clock.advance(600);await flush($);expect(f.view().pose?.name==='ribbon-glance').toBe(false)
  console.log('D1_REDUCED_TERMINAL_GLANCE_METRIC '+JSON.stringify({reducedMotion:true,scheduledWaitsMs:waits.slice(before),checkedAtMs:[119,120,720],scope:'actual shipping terminal Raster and native claim event; actual scheduler cut; no donor pixel appearance claim'}))
  await ui.unmount();await $.session.end({reason:'clear',sessionId:'local-session',resume:{id:'local-session'}})
 })
}

if(WINDOWS_ROOTS)test('D1 Windows plugin root declines native presence IO and second-window gestures without saving twoFirst',{options:{band:'on'}},async($,on)=>{
 const readStored=fixtureStoreReader(on)
 // Deliberately provide POSIX-capable mock seams: the injected Windows plugin root must independently decline them.
 const f=presenceWorld(on,snapshot(),{withNativePresence:true,store,macCapabilities:true,reducedMotion:false,readText:words})
 await $.session.start({...start,cwd:'C:\\Users\\windows\\presence-project'});const ui=await $.ui.mount({surface:'desktop',...band(100)});await settle($,f)
 expect(f.reads.filter(path=>/[\\/]snapshot\.json$/.test(path)),'Windows plugin root refuses native presence snapshot reads').toEqual([])
 expect(f.calls.filter(call=>call.argv.some(arg=>/presence\.sh$/.test(arg))),'Windows plugin root refuses native presence processes').toEqual([])
 expect(f.insertSession('windows-second',{cwd:'C:\\Users\\windows\\second-window',ribbon:2,ribbonAt:MORNING},MORNING)).toBe(false)
 await flush($);await ui.redraw();await f.clock.advance(1000);await settle($,f)
 expect(f.view().ribbon?.visible===true).toBe(false);expect(f.view().pose?.name==='ribbon-glance').toBe(false);expect(f.view().line?.key==='two.first').toBe(false)
 expect((await readStored($,'occasions') as {twoFirst?:boolean})?.twoFirst).toBeUndefined()
 expect(f.reads.filter(path=>/[\\/]snapshot\.json$/.test(path))).toEqual([])
 expect(f.calls.filter(call=>call.argv.some(arg=>/presence\.sh$/.test(arg)))).toEqual([])
 console.log('D1_WINDOWS_PRESENCE_FALLBACK_METRIC '+JSON.stringify({scope:'actual shipping ensurePresence Windows-root rejection with mocked capable POSIX seams; no native presence IO, no genuine multi-window claim'}))
 await ui.unmount();await $.session.end({reason:'clear',sessionId:'local-session',resume:{id:'local-session'}})
})
