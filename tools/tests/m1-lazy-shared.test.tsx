import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { resetMoreWords } from '../hooks/more-words'
import { M1_MORE_TEXT } from './m1-more-data-fixture'
import { modelServiceFixtureText } from './m1-model-service-fixture'
import { presenceWorld, snapshot } from './presence-world'
import { parsePresence } from '../hooks/presence'
import { band, MORNING, P, PERSON } from './world'
import { WINDOWS_ROOTS } from './test-system'
const START={cwd:'/tmp/m1-lazy-shared',surface:'desktop' as const,isInteractive:true}
async function flush($:Engine){for(let i=0;i<80;i++)await $.command.run({command:'m1-host-boundary',args:'',origin:PERSON,presentation:P})}
test('M1 clear during held first initialization lets the fresh lifecycle restore supported More',async($,on)=>{
 resetMoreWords();let reads=0,release=()=>{}
 const held=new Promise<void>(resolve=>{release=resolve})
 on('store.get',{key:'more'},async()=>{
  reads++;if(reads===1)await held
  return {value:{lively:true,explain:true}}
 })
 // The settings record holds the same More rows, as writeSettingsRecord keeps it: shared presence (on by default since 10-16)
 // publishes the record at once, before the held read, and a record that disagreed would win.
 on('store.get',{key:'bandSettings'},()=>({value:{more:{lively:true,explain:true}}}))
 const f=presenceWorld(on,snapshot(),{withNativePresence:true,moreRead:()=>Promise.resolve(modelServiceFixtureText())})
 await $.session.start(START);const row=await $.ui.mount({surface:'desktop',...band(100)})
 try{
  await f.clock.advance(0);await flush($)
  expect(reads).toBe(1);expect(f.view().moreActions).toBeUndefined()
  await $.command.run({command:'clear',args:'',origin:PERSON,presentation:P})
  await $.session.start(START);await f.clock.advance(0);await flush($)
  expect(reads).toBe(2)
  await $.command.run({command:'coco',args:'more',origin:PERSON,presentation:P})
  const pane=await $.ui.mount({surface:'desktop',plugin:'coco',component:'Pane',requestId:'coco-book',props:{title:'Coco',isFocused:false,bodyColumns:100,placement:'dock',scroll:{offset:0,bodyRows:100},view:{}},viewport:{columns:100,rows:100}})
  try{
   expect(await pane.find({type:'Button',key:'coco:more:lively:off'})).toBeDefined()
   expect(f.view().moreActions?.find(action=>action.key==='coco:more:explain')?.label).toBe(JSON.parse(M1_MORE_TEXT)['more.explain.button'].en)
   release();await flush($)
   expect(reads).toBe(2)
   expect(await pane.find({type:'Button',key:'coco:more:lively:off'})).toBeDefined()
   expect(f.view().moreActions?.find(action=>action.key==='coco:more:explain')?.label).toBe(JSON.parse(M1_MORE_TEXT)['more.explain.button'].en)
  }finally{await pane.unmount()}
 }finally{release();await flush($);await row.unmount()}
})
if(!WINDOWS_ROOTS)for(const ending of [false,true])test('M1 shared enabled words hydrate once; '+(ending?'ended lifecycle rejects late redraw':'Off clears actions while data is held'),async($,on)=>{
 resetMoreWords();let reads=0,release=()=>{}
 const held=new Promise<string>(resolve=>{release=()=>resolve(modelServiceFixtureText())})
 const f=presenceWorld(on,snapshot(),{withNativePresence:true,moreRead:()=>{reads++;return reads===1?Promise.resolve('{'):held}})
 await $.session.start(START);const row=await $.ui.mount({surface:'desktop',...band(100)})
 await f.clock.advance(0);await flush($)
 expect(reads).toBe(1);expect(f.view().moreActions).toBeUndefined()
 const update=(more:Record<string,boolean|number>)=>{
  const seq=f.current.seq+1,event={kind:'settings' as const,id:`settings:${seq}:${MORNING}`,at:MORNING,changes:{more}}
  const value={...snapshot('activity',MORNING,seq),event,settings:{more},settingsEvent:event}
  expect(parsePresence(JSON.stringify(value))?.settings).toEqual({more})
  return f.remote(value)
 }
 expect(update({lively:true,explain:true})).toBe(true);await flush($);expect(reads).toBe(2)
 expect(update({lively:true,explain:true,cap:1})).toBe(true);await flush($);expect(reads).toBe(2)
 expect(f.view().moreActions).toBeUndefined()
 if(ending){
  await $.session.end({reason:'prompt_input_exit',sessionId:'local-session',resume:{id:'local-session'}});await flush($)
  const invalidates=f.invalidates.length
  release();await flush($)
  expect(f.invalidates.length).toBe(invalidates)
 }else{
  expect(update({lively:true,explain:false,cap:1})).toBe(true);await flush($)
  expect(f.view().moreActions).toBeUndefined()
  release();await flush($);expect(reads).toBe(2);expect(f.view().moreActions).toBeUndefined()
  expect(update({lively:true,explain:true,cap:1})).toBe(true);await flush($)
  expect(f.view().moreActions?.find(action=>action.key==='coco:more:explain')?.label).toBe(JSON.parse(M1_MORE_TEXT)['more.explain.button'].en);expect(reads).toBe(2)
 }
 await row.unmount()
})
