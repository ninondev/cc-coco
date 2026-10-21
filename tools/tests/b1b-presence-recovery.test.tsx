import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { presenceWorld, snapshot } from './presence-world'
import { MORNING, P, PERSON, band } from './world'
const START={cwd:'/tmp/b1b-presence-recovery',surface:'desktop' as const,isInteractive:true}
async function flush($:Engine){for(let i=0;i<12;i++)await $.command.run({command:'b1b-boundary',args:'',origin:PERSON,presentation:P})}
function gate(){let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve});return{held,release}}

test('timed-out presence setup cannot replace its successful retry',{timeoutMs:20000},async($,on)=>{
  const delayed=gate();let first=true,oldReturned=false
  on('fs.*',async($,e,next)=>{
    if(next.is('fs.exists',e)&&e.path==='/bin/sh'&&first){first=false;await delayed.held;oldReturned=true}
    return next(e)
  })
  const f=presenceWorld(on,snapshot(),{withNativePresence:true})
  await $.session.start(START);await flush($)
  await f.clock.advance(5001);await flush($)
  await $.session.attach({clientId:'retry',surface:'desktop'});await flush($)
  const follows=f.calls.filter(call=>call.argv[3]==='follow').length
  expect(follows).toBe(1)
  delayed.release();await flush($)
  expect(oldReturned).toBe(true)
  expect(f.calls.filter(call=>call.argv[3]==='follow').length).toBe(follows)
  const ui=await $.ui.mount({surface:'desktop',...band(100)})
  expect(await ui.find({type:'Text',text:'Coco'})).toBeDefined()
})

test('remote durable settings remain selected after another desktop attachment',{timeoutMs:20000},async($,on)=>{
  let record:Record<string,unknown>={}
  on('store.*',($,e,next)=>{if(next.is('store.set',e)&&e.key==='bandSettings')record=e.value as Record<string,unknown>;return next(e)})
  const f=presenceWorld(on,snapshot(),{withNativePresence:true})
  await $.session.start(START);await f.clock.advance(0);await flush($)
  // band 'off': the desktop band has no pixel or smaller look to carry over any more (owner 10-19)
  const changes={voice:'full',affection:'clingy',band:'off',lang:'ja',language:'ja'}
  const event={kind:'settings',id:`settings:10:${MORNING}`,at:MORNING,changes}
  const remote={...snapshot('activity',MORNING,f.current.seq+1),event,settings:{...f.current.settings,...changes,futurePreference:{version:3}},settingsEvent:event}
  f.remote(remote as never);await flush($)
  expect(f.view().voice).toBe('full');expect(f.view().band).toBe('off');expect(f.view().lang).toBe('ja')
  await $.session.attach({clientId:'second-desktop',surface:'desktop'});await flush($)
  expect(f.view().voice).toBe('full');expect(f.view().affection).toBe('clingy');expect(f.view().band).toBe('off');expect(f.view().lang).toBe('ja')
  expect(record.voice).toBe('full');expect(record.futurePreference).toEqual({version:3})
})

test('accepted remote sleep requests redraw before a pending clock lookup',{timeoutMs:20000},async($,on)=>{
  const held=gate();let pause=false,entered=false
  on('clock.*',async($,e,next)=>{if(next.is('clock.now',e)&&pause){entered=true;await held.held}return next(e)})
  const f=presenceWorld(on,snapshot(),{withNativePresence:true})
  await $.session.start(START);await f.clock.advance(0);await flush($)
  const before=f.invalidates.length
  pause=true
  f.remote(snapshot('sleep',MORNING-300000,20))
  try{
    await flush($)
    expect(entered).toBe(true)
    expect(f.invalidates.length).toBeGreaterThan(before)
    const ui=await $.ui.mount({surface:'desktop',...band(100)})
    expect(await ui.find({type:'Text',text:'Coco'})).toBeDefined()
  }finally{pause=false;held.release();await flush($)}
})
