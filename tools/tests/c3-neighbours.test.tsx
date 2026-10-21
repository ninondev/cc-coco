import { describe, expect, test } from 'claude-code/testing'
import { SharedPresence, parsePresence } from '../hooks/presence'
import { momentText } from '../hooks/numbers'
import { pageBlocks } from '../hooks/book'
import type { BookData } from '../hooks/book'
import type { BookWords } from '../hooks/book-words'
import { BOOK_FILES } from './book-files'
import { transportFixture } from './presence-transport-fixture'
import { presenceWorld, snapshot } from './presence-world'
import type { On } from 'claude-code'
import { band, P, PERSON } from './world'
import { C3_WORDS_RAW } from './c3-words-fixture'
import { C3_HEAD_MANIFEST } from './c3-head-assets'
import { WINDOWS_ROOTS } from './test-system'
import { WORDS } from '../hooks/words'
const base = {v:1,seq:1,quietAt:1,asleep:false,clingy:false,busy:false,event:{kind:'initial',id:'initial:0:1',at:1}}
const neighbours={v:1,running:true,agents:[{id:'codex',label:'Codex',busy:true,partial:false,startedAt:100,quota:{primary:{usedPercent:40,windowMinutes:300,resetsAt:1760014800}}}]}
const w=JSON.parse(BOOK_FILES['en.json']!) as BookWords
const spell=(id:string,busy:boolean,startedAt:number)=>({v:1,running:true,agents:[{id,label:'Codex',busy,partial:false,startedAt}]})
const d:BookData={view:undefined,usage:undefined,store:{neighbours:true},now:1760010000000,timeZone:'UTC',reducedMotion:false,marks:'replies',voiceSizes:{light:0,full:0},fortune:undefined,reading:0,own:WORDS.en}
describe('C3 neighbours and book',()=>{
 test('presence transports only the content-free neighbour schema',()=>{
  const result=parsePresence(JSON.stringify({...base,neighbours:{...neighbours,content:'private',agents:[{...neighbours.agents[0],prompt:'private'}]}}))
  expect(result?.neighbours).toEqual(neighbours)
  expect(JSON.stringify(result)).not.toContain('private')
 })
 test('invalid neighbour values never enter the band',()=>{
  expect(parsePresence(JSON.stringify({...base,neighbours:{...neighbours,agents:[{...neighbours.agents[0],label:12}]}}))?.neighbours).toBeUndefined()
 })
 test('known neighbour windows follow own limits before this session',()=>{
  const blocks=pageBlocks('offerings',w,{...d,neighbours} as BookData)
  expect(blocks.some(b=>b.t==='heading'&&b.text==='Codex next door')).toBe(true)
  const incense=blocks.find(b=>b.t==='incense'&&b.percent===40)
  expect(incense&&'neighbour' in incense&&incense.neighbour).toBe(true)
 })
 test('neighbour facts require both setting and a running companion',()=>{
  for(const input of [{...d,store:{neighbours:false},neighbours},{...d,neighbours:{...neighbours,running:false}}])
   expect(pageBlocks('offerings',w,input as BookData).some(b=>b.t==='heading'&&b.text==='Codex next door')).toBe(false)
 })
 test('book pace is an estimate and respects His notes',()=>{
  const usage={rateLimits:[{kind:'five_hour',percentUsed:40,resetsAt:null}]}
  const data={...d,usage,pace:[{kind:'five_hour',exhaustionAt:1760011800000}]} as BookData
  expect(pageBlocks('offerings',w,data).some(b=>b.t==='note'&&b.text.includes('~'))).toBe(true)
  expect(pageBlocks('offerings',w,{...data,store:{notes:false}}).some(b=>b.t==='note'&&b.text.includes('~'))).toBe(false)
 })
 test('bookmark fact follows four reading-log facts and disappears when switched off',()=>{
  const data={...d,bookmark:{where:'src/main.ts',at:1760010000000}} as BookData
  expect(pageBlocks('log',w,data)[4]).toEqual({t:'fact',label:'Sticky notes and most-opened files',text:`src/main.ts (${momentText(1760010000000,1760010000000,'en','UTC')})`})
  // switched off, the fact is gone; since the week's bookmarks left (adcd5ea1) nothing follows the four facts
  expect(pageBlocks('log',w,{...data,store:{bookmark:false}}).map(b=>'label' in b?b.label:b.t)).toEqual(pageBlocks('log',w,data).slice(0,4).map(b=>'label' in b?b.label:b.t))
 })
 test('native owner identity gates lights and kernel exit clears their durable state',async()=>{
  const owner={pid:77,birth:'darwin:100:2'}
  const fixture=transportFixture({...snapshot(),neighbours:{...neighbours,owner}})
  const seen:any[]=[]
  let deliver:((text:string)=>void)|undefined
  const watcher={
   next:()=>new Promise<any>(resolve=>{deliver=text=>resolve({done:false,value:{stream:'stdout',text}})}),
   return:async()=>({done:true,value:{code:0,signal:null}}),
  }
  const io:any={read:(path:string)=>fixture.read(path),write:async()=>{throw new Error('unsafe SDK presence write')},now:async()=>1_000_000,
   run:async(argv:string[],stdin?:string)=>{
    if(argv[0]!=='/bin/sh'||argv[1]!=='/plugin/bin/presence.sh'||argv[3]!=='write'||typeof argv[5]!=='string'||typeof stdin!=='string')throw new Error('invalid secure presence write fixture')
    await fixture.write(argv[5],stdin)
    return {code:0,stdout:''}
   },
   after:()=>()=>{},spawn:(argv:string[])=>argv[3]==='watch-companion'?watcher:fixture.spawn('s',argv)}
  const controller=new SharedPresence(io,'s','/tmp/one-shared-presence','/plugin/bin/presence.sh',{changed:state=>{seen.push(state)}})
  await controller.start()
  expect(seen[seen.length-1].neighbours.running).toBe(false)
  deliver!('LIVE\t77\tdarwin:100:2\n')
  for(let i=0;i<40;i++)await Promise.resolve()
  expect(seen[seen.length-1].neighbours.running).toBe(true)
  deliver!('EXIT\t77\tdarwin:100:2\n')
  for(let i=0;i<400;i++)await Promise.resolve()
  expect(seen[seen.length-1].neighbours.running).toBe(false)
  expect(fixture.state.neighbours).toEqual({v:1,running:false,agents:[]})
  await controller.end()
 })

})

if(!WINDOWS_ROOTS)for(const interruption of ['new turn','newest tool'] as const)test(`C3 registered neighbour glance cannot restore its held pose after ${interruption}`,async($,on)=>{
 // SPEC 6.2 / 8.1: the 450ms neighbour glance (with the done line) never replaces a newer turn or tool pose when it ends.
 const fixtureOn=((event:string,...args:any[])=>event==='fs.read'?(on as any)('fs.read',($:any,e:any,next:any)=>e.path.endsWith('c3-text.json')?{value:C3_WORDS_RAW}:e.path.endsWith('frame-manifest.json')?{value:JSON.stringify(C3_HEAD_MANIFEST)}:args[0]($,e,next)):(on as any)(event,...args)) as On
 const f=presenceWorld(fixtureOn,{...snapshot(),settings:{neighbours:true}} as any,{withNativePresence:true,mockDiagnostics:true})
 const settleGlance=async()=>{await f.clock.advance(0);for(let i=0;i<80;i++)await $.command.run({command:'b1b-host-boundary',args:'',origin:PERSON,presentation:P});await f.clock.advance(0)}
 const start={cwd:'/tmp/presence-project',surface:'desktop' as const,isInteractive:true}
 await $.session.start(start);await settleGlance()
 const ui=await $.ui.mount({surface:'desktop',...band(100,false)});await ui.drawn();await settleGlance()
 await f.clock.advance(20000);await settleGlance()
 await $.turn.start({text:'inspect project',turnId:'neighbour-old'});await f.clock.advance(1200)
 await $.tool.call({tool:'Grep',pattern:'old pose'});await settleGlance();await f.clock.advance(1300);await settleGlance()
 expect(f.view().pose?.name).toBe('search');expect(f.view().neighbours).toBe(true)
 expect((f.view().line?.class??0)<=0).toBe(true)
 const held=JSON.parse(JSON.stringify(f.view().pose)),at=f.clock.now()
 expect(f.remote({...snapshot('activity',at,f.current.seq+1,{busy:true}),settings:{neighbours:true},neighbours:spell('codex-glance',true,at-40000)} as any)).toBe(true)
 await settleGlance();await ui.redraw();await settleGlance()
 expect(f.view().line?.key).not.toBe('neighbour.busy');expect(f.view().pose?.name).toBe('search')
 expect(f.remote({...snapshot('activity',at,f.current.seq+1,{busy:true}),settings:{neighbours:true},neighbours:spell('codex-glance',false,at-40000)} as any)).toBe(true)
 await settleGlance();await ui.redraw();await settleGlance()
 expect(f.diagnosticRecords.filter(r=>['error:state.set','error:band.wake','error:c3.line.shown','error:c3.omen.shown'].includes(String(r.step)))).toEqual([])
 expect(f.view().line?.key).toBe('neighbour.done');expect(f.view().pose?.name).toBe('glance')
 await f.clock.advance(100)
 if(interruption==='new turn')await $.turn.start({text:'a new turn owns the face',turnId:'neighbour-new'})
 else await $.tool.call({tool:'Read',file_path:'/tmp/presence-project/newest.ts'})
 await settleGlance()
 const current=JSON.parse(JSON.stringify({mood:f.view().mood,pose:f.view().pose??null}))
 expect(current.pose?.name).not.toBe('glance');expect(current.pose).not.toEqual(held)
 if(interruption==='newest tool')expect(current.pose?.name).toBe('scroll')
 await f.clock.advance(at+449-f.clock.now());await settleGlance()
 expect({mood:f.view().mood,pose:f.view().pose??null}).toEqual(current)
 await f.clock.advance(1);await settleGlance()
 expect({mood:f.view().mood,pose:f.view().pose??null}).toEqual(current)
 await ui.unmount()
})

// her glance is her own pixels and band data, so no old frame (nor its manifest) is read in the event, the render or the timer
if(!WINDOWS_ROOTS)test('C3 first idle neighbour done line glances without reading an old frame in the event, the render or the timer',async($,on)=>{
 on('session.turns',()=>({value:0}))
 let phase='event'
 const manifestReads:string[]=[]
 const fixtureOn=((event:string,...args:any[])=>event==='fs.read'?(on as any)('fs.read',($:any,e:any,next:any)=>{
  if(e.path.endsWith('c3-text.json'))return {value:C3_WORDS_RAW}
  if(e.path.endsWith('frame-manifest.json')){manifestReads.push(phase);return {value:JSON.stringify(C3_HEAD_MANIFEST)}}
  return args[0]($,e,next)
 }):(on as any)(event,...args)) as On
 const f=presenceWorld(fixtureOn,{...snapshot(),settings:{neighbours:true}} as any,{withNativePresence:true,mockDiagnostics:true})
 const flush=async()=>{for(let i=0;i<80;i++)await $.command.run({command:'c3-host-boundary',args:'',origin:PERSON,presentation:P})}
 await $.session.start({cwd:'/tmp/presence-project',surface:'desktop',isInteractive:true});await flush();await f.clock.advance(20000);await flush()
 expect(f.view().mood).toBe('idle');expect(f.view().pose).toBeUndefined();expect(manifestReads).toEqual([])
 const at=f.clock.now()
 expect(f.remote({...snapshot('activity',at,f.current.seq+1,{busy:true}),settings:{neighbours:true},neighbours:spell('first-idle-neighbour',true,at-40000)} as any)).toBe(true)
 await flush()
 expect(f.view().line).toBeUndefined();expect(manifestReads).toEqual([])
 expect(f.remote({...snapshot('activity',at,f.current.seq+1,{busy:true}),settings:{neighbours:true},neighbours:spell('first-idle-neighbour',false,at-40000)} as any)).toBe(true)
 await flush()
 expect(f.view().line?.key).toBe('neighbour.done');expect(manifestReads).toEqual([])
 phase='render'
 const ui=await $.ui.mount({surface:'desktop',...band(100,false)});await ui.redraw();await flush()
 expect(JSON.stringify(await ui.drawn())).toContain('Codex next door is done.')
 expect(f.view().pose).toBeUndefined()
 phase='timer';await f.clock.advance(0);await flush()
 expect(f.view().pose?.name).toBe('glance');expect(manifestReads).toEqual([])
 expect(f.diagnosticRecords.filter(r=>['error:state.set','error:band.wake'].includes(String(r.step)))).toEqual([])
 await f.clock.advance(450);await flush();expect(f.view().pose).toBeUndefined();expect(manifestReads).toEqual([])
 await ui.unmount()
})
