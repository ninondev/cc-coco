// Observe the real registered startup through public host calls, without a desktop claim.
import { describe, expect, mock, test, type Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { M1_MORE_TEXT, M1_GAPS_TEXT } from './m1-more-data-fixture'
import { RECENT, MORNING, P, PERSON, band, desktopPicture } from './world'
const START = {cwd:'/tmp/b1-startup-project',surface:null,isInteractive:false}
const preferenceNames = ['LC_ALL','LC_MESSAGES','LANG','TERM','TERM_PROGRAM','TMUX','KITTY_WINDOW_ID','COLORTERM','WT_SESSION']
function gate(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve});return {promise,release}}
async function crossHost($: Engine, condition:()=>boolean){for(let i=0;i<100 && !condition();i++)await $.command.run({command:'b1-host-boundary',args:'',origin:PERSON,presentation:P})}

function fixture(on: On, preferencesGate?: Promise<void>, registrationGate?: Promise<void>, wordsGate?: Promise<void>) {
  const clock=mock.clock(on,{now:MORNING})
  const stored={...RECENT,band:'compact',lang:'ja',voice:'full',affection:'clingy'}
  mock.store(on,{...stored,bandSettings:stored})
  const cells=new Map<string,{value:unknown;version:number}>()
  const entered=new Set<string>();let active=0,peak=0,registrations=0,rootReads=0
  on('env.get',async($,e)=>{
    if(preferenceNames.includes(e.name)){
      entered.add(e.name);active++;peak=Math.max(peak,active)
      await preferencesGate;active--
    }
    return {value:e.name==='LANG'?'en_US.UTF-8':e.name==='TERM'?'xterm-256color':undefined}
  })
  on('settings.read',()=>({value:{timeZone:'UTC',prefersReducedMotion:true}}))
  on('state.get',($,e)=>({value:cells.get(e.key)??{value:undefined,version:0}}) as never)
  on('state.set',($,e)=>{const version=(cells.get(e.key)?.version??0)+1;cells.set(e.key,{value:e.value,version});return {value:{isSet:true,version}}})
  on('session.usage',()=>({value:{startedAt:0,context:{window:200000,percent:20,tokens:40000},rateLimits:[]}}))
  on('session.id',()=>({value:'b1-startup'}))
  on('session.root',()=>{rootReads++;return {value:START.cwd}})
  on('session.surfaces',()=>({value:['desktop']}))
  on('fs.exists',()=>({value:false}))
  on('fs.read',async($,e)=>{
    if (/[\\/]hooks[\\/]gaps-text\.json$/.test(e.path)) { await wordsGate;return {value:M1_GAPS_TEXT} }
    if (/[\\/]hooks[\\/]more-text\.json$/.test(e.path)) return {value:M1_MORE_TEXT}
    return {value:'{}'}
  })
  on('command.register',async($,e)=>{registrations++;await registrationGate;return {value:{command:e.name}}})
  on('session.start',($,e)=>({cwd:e.cwd}))
  on('command.run',()=>({text:''}))
  on('ui.render',()=> <></>)
  return {clock,entered,peak:()=>peak,registrations:()=>registrations,rootReads:()=>rootReads,view:()=>cells.get('view')?.value as {context?:number;band:string;lang:string;voice:string;affection:string}|undefined}
}

describe('round B1 startup dependency barriers',()=>{
 test('held command words cannot defer configured startup or a mounted first frame',{options:{band:'compact',language:'ja'}},async($,on)=>{
  const waiting=gate(),f=fixture(on,undefined,undefined,waiting.promise)
  const starting=(async()=>await $.session.start(START))()
  try{
   await f.clock.advance(0);await crossHost($,()=>f.rootReads()===1&&f.view()?.context===20)
   expect(f.rootReads()).toBe(1);expect(f.registrations()).toBe(0)
   expect(f.view()?.lang).toBe('ja');expect(f.view()?.band).toBe('compact');expect(f.view()?.voice).toBe('full');expect(f.view()?.context).toBe(20)
   const ui=await $.ui.mount({surface:'desktop',...band(90)})
   expect((await desktopPicture(ui))?.props.height).toBe(32);expect((await desktopPicture(ui))?.props.source).toContain('data:image/png;base64,')
   expect(f.registrations()).toBe(0);await ui.unmount()
  }finally{waiting.release();await starting;await crossHost($,()=>f.registrations()===1)}
  expect(f.registrations()).toBe(1) // one command, /coco (10-16; /omen is gone)
 })

 test('all nine preference environment reads enter one batch before any resolves',{options:{band:'compact',language:'ja'}},async($,on)=>{
  const waiting=gate(),f=fixture(on,waiting.promise)
  const begin=Date.now(),starting=(async()=>await $.session.start(START))()
  try{
   await crossHost($,()=>f.entered.size===preferenceNames.length)
   console.log('B1 gated preference receipt',JSON.stringify({enteredBeforeRelease:[...f.entered],simultaneousReadPeak:f.peak(),wallMs:Date.now()-begin,mockClockAdvancedMs:0}))
   expect([...f.entered].sort()).toEqual([...preferenceNames].sort())
   expect(f.peak()).toBe(9)
  }finally{waiting.release();await starting;await f.clock.advance(0);await crossHost($,()=>f.view()!==undefined)}
  expect(f.view()!.band).toBe('compact');expect(f.view()!.lang).toBe('ja');expect(f.view()!.voice).toBe('full');expect(f.view()!.affection).toBe('clingy')
  const ui=await $.ui.mount({surface:'desktop',...band(90)})
  expect((await desktopPicture(ui))?.props.height).toBe(32)
  console.log('B1 startup batch metric',JSON.stringify({preferenceReadCount:f.entered.size,simultaneousReadPeak:f.peak(),wallMs:Date.now()-begin,scope:'engine-kit mock host; not desktop scheduling'}))
 })
 test('blocked command registration cannot defer correctly configured state publication or mounted first frame',{options:{band:'compact',language:'ja'}},async($,on)=>{
  const waiting=gate(),f=fixture(on,undefined,waiting.promise)
  const begin=Date.now(),starting=(async()=>await $.session.start(START))()
  try{
   await f.clock.advance(0)
   await crossHost($,()=>f.registrations()===1 && f.view()?.context===20)
   console.log('B1 gated registration receipt',JSON.stringify({registrations:f.registrations(),publishedView:f.view()??null,wallMs:Date.now()-begin,registrationStillBlocked:true,mockClockAdvancedMs:0}))
   expect(f.registrations()).toBe(1)
   expect(f.view()?.lang).toBe('ja');expect(f.view()?.band).toBe('compact');expect(f.view()?.voice).toBe('full');expect(f.view()?.context).toBe(20)
   const ui=await $.ui.mount({surface:'desktop',...band(90)})
   expect((await desktopPicture(ui))?.props.height).toBe(32)
   expect((await desktopPicture(ui))?.props.source).toContain('data:image/png;base64,')
   console.log('B1 startup first-frame metric',JSON.stringify({registrations:f.registrations(),wallMs:Date.now()-begin,registrationStillBlocked:true,scope:'engine-kit mock host; not desktop scheduling'}))
  }finally{waiting.release();await starting;await f.clock.advance(0);await crossHost($,()=>f.view()!==undefined)}
 })
})
