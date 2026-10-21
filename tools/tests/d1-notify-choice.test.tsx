import {test,expect} from 'claude-code/testing'
import {fixtureStoreReader} from './d1-store-read-fixture'
import {world,RECENT,settleLegacyStart,PERSON,P} from './world'
import {D1_WORDS_TEXT} from './d1-room-fixture'
import {atomicFeed,PROCESS_OK} from './shared-world'
import {samePath} from './file-paths'
import {drainFeed} from './feed-drain'

const start={cwd:'/tmp/d1-notify-choice',surface:'desktop' as const,isInteractive:true}
const pane={surface:'desktop' as const,plugin:'coco',component:'Pane' as const,requestId:'coco-book',props:{title:'fixture',isFocused:true,bodyColumns:100,placement:'dock' as const,scroll:{offset:0,bodyRows:40},view:{}}}
const home='/tmp/d1-notify-choice-home',folder=home+'/Library/Application Support/Coco'
function gate(){let enter!:()=>void,release!:()=>void;return {entered:new Promise<void>(r=>enter=r),held:new Promise<void>(r=>release=r),enter:()=>enter(),release:()=>release()}}

for(const boundary of ['companionHere','feedCompanion'] as const)test(`D1 held Notify at ${boundary} cannot authorize after a newer Off choice`,{options:{band:'on'}},async($,on)=>{
 const readStored=fixtureStoreReader(on)
 const blocked=gate(),records:Record<string,unknown>[]=[];let armed=false,folderReads=0
 on('fs.exists',async($,e)=>{
  if(samePath(e.path,folder)&&armed&&++folderReads===(boundary==='companionHere'?1:2)){armed=false;blocked.enter();await blocked.held}
  return {value:samePath(e.path,folder)||samePath(e.path,home+'/Applications/Coco Pet.app/Contents/MacOS/coco-companion')||samePath(e.path,'/System/Library/CoreServices/SystemVersion.plist')}
 })
 on('process.run',($,e)=>{const feed=atomicFeed(e.argv,e.init?.stdin);if(feed)records.push(JSON.parse(feed.text));return {value:PROCESS_OK}})
 const w=world(on,{store:RECENT,surfaces:['desktop'],env:{HOME:home,LANG:'en_US.UTF-8'},readText:path=>path.endsWith('d1-words.json')?D1_WORDS_TEXT:undefined})
 await $.session.start(start);await settleLegacyStart($,w);await drainFeed($)
 await $.command.run({command:'coco',args:'settings',origin:PERSON,presentation:P});const ui=await $.ui.mount(pane);await drainFeed($);await ui.redraw();await drainFeed($)
 expect(await ui.find({type:'Button',key:'coco:set:longtask:notify'})).toBeDefined()
 records.length=0;armed=true
 const pending=ui.press({key:'coco:set:longtask:notify'});await blocked.entered
 try{await ui.press({key:'coco:set:longtask:off'});await drainFeed($)}finally{blocked.release()}
 await pending;await drainFeed($)
 expect(folderReads).toBe(boundary==='companionHere'?1:2)
 expect((await readStored($,'bandSettings') as {longTask?:string}).longTask).toBe('off')
 expect(records.filter(record=>record.longTaskAuthorizationRequest!==undefined)).toEqual([])
 expect(w.view().longTask).toBeUndefined()
 await $.turn.start({turnId:'ordinary-after-off',text:'fixture ordinary work'});await drainFeed($)
 expect(records.filter(record=>record.longTaskAuthorizationRequest!==undefined)).toEqual([])
 await ui.unmount()
})

test('D1 held Notify survives an unrelated language choice without granting before its final feed guard',{options:{band:'on'}},async($,on)=>{
 const readStored=fixtureStoreReader(on)
 const blocked=gate(),records:Record<string,unknown>[]=[];let armed=false,folderReads=0
 on('fs.exists',async($,e)=>{
  if(samePath(e.path,folder)&&armed&&++folderReads===2){armed=false;blocked.enter();await blocked.held}
  return {value:samePath(e.path,folder)||samePath(e.path,home+'/Applications/Coco Pet.app/Contents/MacOS/coco-companion')||samePath(e.path,'/System/Library/CoreServices/SystemVersion.plist')}
 })
 on('process.run',($,e)=>{const feed=atomicFeed(e.argv,e.init?.stdin);if(feed)records.push(JSON.parse(feed.text));return {value:PROCESS_OK}})
 const w=world(on,{store:RECENT,surfaces:['desktop'],env:{HOME:home,LANG:'en_US.UTF-8'},readText:path=>path.endsWith('d1-words.json')?D1_WORDS_TEXT:undefined})
 await $.session.start(start);await settleLegacyStart($,w);await drainFeed($)
 await $.command.run({command:'coco',args:'settings',origin:PERSON,presentation:P});const ui=await $.ui.mount(pane);await drainFeed($);await ui.redraw();await drainFeed($)
 records.length=0;armed=true
 const pending=ui.press({key:'coco:set:longtask:notify'});await blocked.entered
 try{
  await $.command.run({command:'coco',args:'lang ja',origin:PERSON,presentation:P});await drainFeed($)
  expect(w.view().lang).toBe('ja')
  expect(records.filter(record=>record.longTaskAuthorizationRequest!==undefined)).toEqual([])
 }finally{blocked.release()}
 await pending;await drainFeed($)
 expect((await readStored($,'bandSettings') as {longTask?:string}).longTask).toBe('notify')
 expect(records.filter(record=>record.longTaskAuthorizationRequest!==undefined).length).toBeGreaterThan(0)
 expect(w.view().lang).toBe('ja');await ui.unmount()
})

test('D1 stale Off finishing C3 settings cannot dismiss a held completion after a newer Band choice',{options:{band:'on'}},async($,on)=>{
 const readStored=fixtureStoreReader(on)
 const blocked=gate(),bandStored=gate();let armed=false,observeBand=false
 on('store.*',async($,e,next)=>{
  if(next.is('store.delete',e)&&armed&&e.key==='bookmarks'){armed=false;blocked.enter();await blocked.held}
  const result=await next(e)
  if(next.is('store.set',e)&&observeBand&&e.key==='bandSettings'&&(e.value as {longTask?:string})?.longTask==='band')bandStored.enter()
  return result
 })
 const w=world(on,{store:{...RECENT,longTask:'band',bookmark:false},surfaces:['desktop'],readText:path=>path.endsWith('d1-words.json')?D1_WORDS_TEXT:undefined})
 await $.session.start(start);await settleLegacyStart($,w)
 await $.turn.start({turnId:'held-after-newer-band',text:'fixture long work'});await w.clock.advance(120000)
 await $.turn.complete({turnId:'held-after-newer-band',answer:'fixture done',reason:'answer',durationMs:120000,isAborted:false})
 expect(w.view().longTask?.id).toBe('held-after-newer-band')
 await $.command.run({command:'coco',args:'settings',origin:PERSON,presentation:P});const ui=await $.ui.mount(pane);await drainFeed($);await ui.redraw();await drainFeed($)
 armed=true;const older=ui.press({key:'coco:set:longtask:off'});await blocked.entered
 observeBand=true;const newer=ui.press({key:'coco:set:longtask:band'})
 try{await bandStored.entered;expect((await readStored($,'bandSettings') as {longTask?:string}).longTask).toBe('band')}finally{blocked.release()}
 await Promise.all([older,newer]);await drainFeed($)
 expect(w.view().longTask?.id).toBe('held-after-newer-band');expect(w.view().longTask?.mode).toBe('band')
 await ui.unmount()
})

for(const mode of ['off','band'] as const)test(`D1 completed Notify request is removed by ${mode} including an already captured ordinary feed`,{options:{band:'on'}},async($,on)=>{
 const readStored=fixtureStoreReader(on)
 const blocked=gate(),records:Record<string,unknown>[]=[];let armed=false,folderReads=0
 on('fs.exists',async($,e)=>{
  if(samePath(e.path,folder)&&armed&&++folderReads===2){armed=false;blocked.enter();await blocked.held}
  return {value:samePath(e.path,folder)||samePath(e.path,home+'/Applications/Coco Pet.app/Contents/MacOS/coco-companion')||samePath(e.path,'/System/Library/CoreServices/SystemVersion.plist')}
 })
 on('process.run',($,e)=>{const feed=atomicFeed(e.argv,e.init?.stdin);if(feed)records.push(JSON.parse(feed.text));return {value:PROCESS_OK}})
 const w=world(on,{store:RECENT,surfaces:['desktop'],env:{HOME:home,LANG:'en_US.UTF-8'},readText:path=>path.endsWith('d1-words.json')?D1_WORDS_TEXT:undefined})
 await $.session.start(start);await settleLegacyStart($,w);await drainFeed($)
 await $.command.run({command:'coco',args:'settings',origin:PERSON,presentation:P});const ui=await $.ui.mount(pane);await drainFeed($);await ui.redraw();await drainFeed($)
 await $.command.run({command:'d1-fixture-companion-request',args:JSON.stringify([w.view(),'fixture',true,1,{summon:11,follow:12,settings:13,longTaskSettingsRequest:14}]),origin:PERSON,presentation:P})
 await ui.press({key:'coco:set:longtask:notify'});await drainFeed($)
 expect(records.filter(record=>record.longTaskAuthorizationRequest!==undefined).length).toBeGreaterThan(0)
 armed=true;await $.turn.start({turnId:'captured-before-cancel',text:'fixture ordinary work'});await blocked.entered
 records.length=0
 try{await ui.press({key:`coco:set:longtask:${mode}`});await drainFeed($)}finally{blocked.release()}
 await drainFeed($)
 expect(records.length).toBeGreaterThan(0)
 expect(records.filter(record=>record.longTaskAuthorizationRequest!==undefined)).toEqual([])
 const latest=records[records.length-1]!
 expect(latest.summon).toBe(11);expect(latest.follow).toBe(12);expect(latest.settings).toBe(13);expect(latest.longTaskSettingsRequest).toBe(14)
 await $.turn.complete({turnId:'captured-before-cancel',answer:'fixture done',reason:'answer',durationMs:1000,isAborted:false});await drainFeed($)
 expect(records.filter(record=>record.longTaskAuthorizationRequest!==undefined)).toEqual([])
 expect((await readStored($,'bandSettings') as {longTask?:string}).longTask).toBe(mode)
 await ui.unmount()
})
