import {WINDOWS_ROOTS} from './test-system'
import {test,expect} from 'claude-code/testing'
import {presenceWorld,snapshot} from './presence-world'
import {band,MORNING,PERSON,P} from './world'
import {D1_WORDS_TEXT} from './d1-room-fixture'
import {C3_WORDS_RAW} from './c3-words-fixture'
import {LineSlot} from '../hooks/line-slot'
const start={cwd:'/tmp/presence-project',surface:'desktop' as const,isInteractive:true}
const words=(path:string)=>path.endsWith('d1-words.json')?D1_WORDS_TEXT:path.endsWith('c3-text.json')?C3_WORDS_RAW:undefined
const store={firstMet:MORNING-86400000,lastActive:MORNING,stamps:{met:MORNING-86400000,shiori:MORNING-86400000},occasions:{omenOffered:'2026-10-02',warned:{}},omen:{day:'2026-10-02',rank:1,index:0},bookmark:true,bookmarks:{'/tmp/presence-project':{where:'src/retained-bookmark-fixture.ts',kind:'file',at:MORNING-1000}}}
async function flush($:any){for(let i=0;i<80;i++)await $.command.run({command:'d1-bookmark-projection-boundary',args:'',origin:PERSON,presentation:P})}
async function settle($:any,f:ReturnType<typeof presenceWorld>){await f.clock.advance(0);await flush($);await f.clock.advance(0);await flush($)}
function feed(f:ReturnType<typeof presenceWorld>){const row=f.companionFeeds.at(-1);expect(row).toBeDefined();return row!}

for(const boundary of ['prompt','turn-then-prompt'] as const)if(WINDOWS_ROOTS)console.log('D1_PLATFORM_SKIP '+JSON.stringify({name:`D1 actual retained bookmark clears at ${boundary} while the second-window band line remains`,reason:'shipping ensurePresence rejects Windows plugin roots'}));else test(`D1 actual retained bookmark clears at ${boundary} while the second-window band line remains`,{options:{band:'on'}},async($,on)=>{
 let enteredBookmarks!:()=>void,releaseBookmarks!:()=>void,bookmarksHeld=false
 const bookmarksEntered=new Promise<void>(resolve=>{enteredBookmarks=resolve}),bookmarksReleased=new Promise<void>(resolve=>{releaseBookmarks=resolve})
 on('store.get',{key:'bookmarks'},async($,e,next)=>{
  const result=await next(e)
  if(boundary==='turn-then-prompt'&&next.origin.plugin==='coco'&&!bookmarksHeld){bookmarksHeld=true;enteredBookmarks();await bookmarksReleased}
  return result
 })
 const f=presenceWorld(on,snapshot(),{withNativePresence:true,store,companion:true,macCapabilities:true,reducedMotion:true,readText:words})
 await $.session.start(start)
 const ui=await $.ui.mount({surface:'desktop',...band(100)})
 try{
  const initialSettling=settle($,f)
  if(boundary==='turn-then-prompt'){
   await bookmarksEntered
   try{await $.turn.start({turnId:'bookmark-boundary-turn',text:'fixture boundary'})}finally{releaseBookmarks()}
  }
  await initialSettling;expect(f.view().line?.key).toBe('bookmark');expect(f.view().line?.class).toBe(0)
  await ui.redraw();await settle($,f)
  const bookmark=f.view().line!.text,before=feed(f)
  expect(before.said).toBe(bookmark);expect(bookmark).toContain('src/retained-bookmark-fixture.ts')
  await f.clock.advance(100);await settle($,f)
  const gainedAt=MORNING+100
  expect(f.insertSession('bookmark-second',{cwd:'/tmp/bookmark-second',ribbon:2,ribbonAt:gainedAt},gainedAt)).toBe(true)
  await settle($,f);expect(f.view().line?.key).toBe('two.first')
  expect(feed(f).said===before.said).toBe(true)
  if(boundary==='turn-then-prompt'){
   await $.turn.complete({turnId:'bookmark-boundary-turn',answer:'fixture completion',reason:'answer',durationMs:100,isAborted:false})
   await settle($,f);expect(f.view().line?.key).toBe('two.first')
   expect(feed(f).said).toBe(bookmark)
  }
  await $.prompt.submit({text:'fixture continuation',wait:false,origin:PERSON});await settle($,f)
  expect(f.view().line?.key).toBe('two.first')
  expect(feed(f).said===before.said).toBe(false)
  expect(feed(f).said).toBe(f.view().slip?.text??f.view().said)
  expect(Object.prototype.hasOwnProperty.call(f.view(),'companionPose')).toBe(false)
  expect(Object.prototype.hasOwnProperty.call(f.view(),'companionLine')).toBe(false)
 }finally{
  await ui.unmount();await $.session.end({reason:'clear',sessionId:'local-session',resume:{id:'local-session'}})
 }
})

test('D1 LineSlot class-zero lifecycle follows request flags independently of the line key',()=>{
 for(const flag of ['untilPrompt','untilTurn'] as const){
  const slot=new LineSlot()
  expect(slot.offer({key:'same-fixture-key',text:'fixture payload',class:0,ttl:300000,[flag]:true},0)).toBe('shown')
  expect(slot.visible(0)?.[flag]).toBe(true)
  slot.clear(flag==='untilPrompt'?'turn':'prompt',1)
  expect(slot.visible(1)?.key).toBe('same-fixture-key')
  slot.clear(flag==='untilPrompt'?'prompt':'turn',2)
  expect(slot.visible(2)).toBeUndefined()
 }
})
