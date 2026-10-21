import {test,expect} from 'claude-code/testing'
import {world,RECENT,settleLegacyStart,PERSON,P} from './world'
import {D1_WORDS_TEXT} from './d1-room-fixture'
import {atomicFeed,PROCESS_OK} from './shared-world'
import {samePath} from './file-paths'
import {drainFeed} from './feed-drain'
const home='/tmp/d1-request-owner-home',folder=home+'/Library/Application Support/Coco'
test('D1 source-side companion request priming carries ordinary requests through actual shipping mood feeds',{options:{band:'on'}},async($,on)=>{
 const records:Record<string,unknown>[]=[]
 on('fs.exists',($,e)=>({value:samePath(e.path,folder)||samePath(e.path,home+'/Applications/Coco Pet.app/Contents/MacOS/coco-companion')||samePath(e.path,'/System/Library/CoreServices/SystemVersion.plist')}))
 on('process.run',($,e)=>{const feed=atomicFeed(e.argv,e.init?.stdin);if(feed)records.push(JSON.parse(feed.text));return {value:PROCESS_OK}})
 const w=world(on,{store:RECENT,surfaces:['desktop'],env:{HOME:home,LANG:'en_US.UTF-8'},readText:path=>path.endsWith('d1-words.json')?D1_WORDS_TEXT:undefined})
 await $.session.start({cwd:'/tmp/d1-request-owner',surface:'desktop',isInteractive:true});await settleLegacyStart($,w);await drainFeed($)
 await $.command.run({command:'d1-fixture-companion-request',args:JSON.stringify([w.view(),'fixture',true,1,{summon:11,follow:12,settings:13,longTaskSettingsRequest:14}]),origin:PERSON,presentation:P})
 records.length=0
 await $.turn.start({turnId:'ordinary-request-carriage',text:'fixture ordinary work'});await drainFeed($)
 expect(records.length).toBeGreaterThan(0)
 const latest=records[records.length-1]!
 expect(latest.summon).toBe(11);expect(latest.follow).toBe(12);expect(latest.settings).toBe(13);expect(latest.longTaskSettingsRequest).toBe(14)
 records.length=0
 await $.turn.complete({turnId:'ordinary-request-carriage',answer:'fixture done',reason:'answer',durationMs:1000,isAborted:false});await drainFeed($)
 expect(records.length).toBeGreaterThan(0)
 const completed=records[records.length-1]!
 expect([completed.summon,completed.follow,completed.settings,completed.longTaskSettingsRequest]).toEqual([11,12,13,14])
})
