import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { presenceWorld, snapshot } from './presence-world'
import { MORNING, P, PERSON, band, desktopPicture } from './world'
import { WINDOWS_ROOTS } from './test-system'
const START={cwd:'/tmp/b1b-working-race',surface:'desktop' as const,isInteractive:true}
function gate(){let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve});return{held,release}}
async function flush($:Engine){for(let i=0;i<20;i++)await $.command.run({command:'b1b-working-boundary',args:'',origin:PERSON,presentation:P})}
function animated(on:On){return ((event:string,...args:unknown[])=>event==='settings.read'?(on as any)(event,()=>({value:{timeZone:'UTC',prefersReducedMotion:false}})):(on as any)(event,...args)) as On}
// Coco's think (coco-motion.ts): drawn from the bundled rest before her band data has been read; the held read is her
// own band-A.json (the old figure's motion-data.json is not read since 10-16)

if(!WINDOWS_ROOTS)test('an active turn draws its synchronous think still over accepted stale sleeping presence',{timeoutMs:20000},async($,on)=>{
 const art=gate();let artEntered=false
 on('fs.*',async($,e,next)=>{if(next.is('fs.read',e)&&/[\\/]assets[\\/]coco[\\/]band-A\.json$/.test(e.path)){artEntered=true;await art.held}return next(e)})
 const f=presenceWorld(animated(on),snapshot(),{withNativePresence:true})
 try{
  await $.session.start(START);await f.clock.advance(0);await flush($)
  await $.turn.start({text:'fixture work',turnId:'active-turn'});await flush($)
  expect(f.current.busy).toBe(true)
  f.remote(snapshot('sleep',MORNING-300000,f.current.seq+1));await flush($)
  expect(f.current.asleep).toBe(true);expect(f.view().mood).toBe('sleep')
  const ui=await $.ui.mount({surface:'desktop',...band(100,true)})
  expect(String((await desktopPicture(ui))?.props.source)).toContain('data-coco="A think"')
  expect(await ui.find({type:'Text',text:'Coco'})).toBeDefined()
  await f.clock.advance(0);await flush($)
  expect(artEntered).toBe(true)
  expect(String((await desktopPicture(ui))?.props.source)).toContain('data-coco="A think"')
  art.release();await flush($);await f.clock.advance(0);await flush($)
  expect(String((await desktopPicture(ui))?.props.source)).toContain('@keyframes')
 }finally{art.release();await flush($)}
})

if(!WINDOWS_ROOTS)test('pending presence bootstrap and delayed boot retain desktop work in the claim and companion feed',{timeoutMs:20000},async($,on)=>{
 const setup=gate(),boot=gate(),art=gate();let setupEntered=false,bootEntered=false,artEntered=false
 on('fs.*',async($,e,next)=>{
  if(next.is('fs.exists',e)&&e.path==='/bin/sh'){setupEntered=true;await setup.held}
  if(next.is('fs.read',e)&&/[\\/]assets[\\/]coco[\\/]band-A\.json$/.test(e.path)){artEntered=true;await art.held}
  return next(e)
 })
  on('session.*',async($,e,next)=>{if(next.is('session.turns',e))return {value:0};if(next.is('session.root',e)){bootEntered=true;await boot.held}return next(e)})
  const f=presenceWorld(animated(on),snapshot('sleep',MORNING-300000),{withNativePresence:true,companion:true,sessionTurns:false})
 try{
  await $.session.start(START)
  const ui=await $.ui.mount({surface:'desktop',...band(100,true)})
  expect(String((await desktopPicture(ui))?.props.source)).toContain('data-coco="A think"')
  await f.clock.advance(0);await flush($)
  // Shared presence is on by default (10-16): its native setup starts at once, while boot's session.root read is still held.
  expect(setupEntered).toBe(true);expect(bootEntered).toBe(true);expect(artEntered).toBe(true)
  expect(f.calls.filter(call=>call.argv[3]==='follow').length).toBe(0)
  boot.release();await flush($)
  // Boot finishing starts no follower while native setup is held.
  expect(setupEntered).toBe(true);expect(bootEntered).toBe(true);expect(artEntered).toBe(true)
  expect(f.calls.filter(call=>call.argv[3]==='follow').length).toBe(0)
  setup.release();await flush($)
  expect(f.current.busy).toBe(true);expect(f.current.asleep).toBe(false)
  await f.clock.advance(0);await flush($)
  expect(f.view().mood).toBe('think')
  expect(f.current.busy).toBe(true);expect(f.current.asleep).toBe(false)
  const feed=f.companionFeeds.at(-1)
  expect(feed?.mood).toBe('think')
  expect((feed?.presence as {busy:boolean;asleep:boolean}).busy).toBe(true)
  expect((feed?.presence as {busy:boolean;asleep:boolean}).asleep).toBe(false)
  console.log('B1B_WORKING_RACE '+JSON.stringify({unknownBootHadNoSetup:true,bootReleasedBeforeKnownMore:true,setupHeld:true,animationReadHeld:true,claimBusy:f.current.busy,feedMood:feed?.mood}))
 }finally{setup.release();boot.release();art.release();await flush($)}
})
