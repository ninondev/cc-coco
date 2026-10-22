import {fixtureStoreReader} from './d1-store-read-fixture'
import {test,expect} from 'claude-code/testing'
import {MORNING,RECENT,PERSON,P,world,settleLegacyStart} from './world'
import {transportFixture} from './presence-transport-fixture'
import {drainFeed} from './feed-drain'
import {atomicFeed,PROCESS_OK} from './shared-world'
import {samePath} from './file-paths'
import {WINDOWS_ROOTS} from './test-system'
import {D1_WORDS_TEXT} from './d1-room-fixture'
import { BAG_TEXT_RAW } from './bag-text-fixture'
// her desktop companion stands on her page once lane B has named its group there (bag step 2), else on the switches page
const COMPANION_PAGE = JSON.parse(BAG_TEXT_RAW).en.himGroups ? 'him' : 'settings'

const home='/tmp/d1-notify-denial',folder=home+'/Library/Application Support/Coco'
const start={cwd:'/tmp/d1-notify-denial-project',isInteractive:true}
const pane={plugin:'coco',component:'Pane' as const,requestId:'coco-book',props:{title:'fixture',isFocused:true,bodyColumns:100,placement:'dock' as const,scroll:{offset:0,bodyRows:40},view:{}}}
const words=JSON.parse(D1_WORDS_TEXT)

for(const surface of ['desktop','terminal'] as const)if(!WINDOWS_ROOTS)test(`D1 ${surface} companion denial durably returns Notify to Band and redraws its settings action without authorization`,async($,on)=>{
 const readStored=fixtureStoreReader(on)
 const paneReturns=async()=>Number((await $.command.run({command:'d1-fixture-owned-pane-returns',args:JSON.stringify([pane.requestId,surface]),origin:PERSON,presentation:P})).text)
 const records:Record<string,unknown>[]=[]
 const transport=transportFixture({v:1,seq:0,quietAt:MORNING,asleep:false,clingy:false,busy:false,event:{kind:'initial',id:`initial:0:${MORNING}`,at:MORNING}})
 let followed=false,draws=0,recordReads=0,submitCalls=0,toolCalls=0
 const w=world(on,{withNativePresence:true,store:{...RECENT,longTask:'band'},env:{HOME:home,LANG:'en_US.UTF-8',TERM:'xterm-256color'},settings:{prefersReducedMotion:true},readText:path=>{
  if(path.endsWith('/snapshot.json'))return JSON.stringify(transport.state)
  if(path.endsWith('/companion.json')){recordReads++;return JSON.stringify({running:true,accessibility:true,size:'medium',login:false})}
  return path.endsWith('d1-words.json')?D1_WORDS_TEXT:undefined
 }})
 on('session.id',()=>({value:'denial-session'}))
 on('session.surfaces',()=>({value:[surface]}))
 on('fs.exists',($,e)=>({value:samePath(e.path,'/System/Library/CoreServices/SystemVersion.plist')||samePath(e.path,'/bin/sh')||samePath(e.path,folder)||samePath(e.path,folder+'/requests.jsonl')||samePath(e.path,home+'/Applications/Coco Pet.app/Contents/MacOS/coco-companion')}))
 on('process.run',($,e)=>{const feed=atomicFeed(e.argv,e.init?.stdin);if(feed)records.push(JSON.parse(feed.text));return {value:{...PROCESS_OK,stdout:String(e.argv[1]).includes('icon-')?'icon: stock\n':''}}})
 on('fs.write',async($,e)=>{if(e.path.endsWith('/commit'))await transport.write(e.path,e.text);return {value:undefined}})
 on('process.spawn',async function*($,e){
  if(e.argv[3]==='follow')followed=true
  const child=transport.spawn('denial-session',[...e.argv])
  try{for(;;){const packet=await child.next();if(packet.done)return {value:packet.value};yield packet.value}}
  finally{await child.return({code:0,signal:null})}
 })
 on('prompt.*',($,e,next)=>{if(next.is('prompt.submit',e))submitCalls++;return next(e)})
 on('tool.*',($,e,next)=>{if(next.is('tool.call',e))toolCalls++;return next(e)})
 await $.session.start({...start,surface});await settleLegacyStart($,w);await drainFeed($)
 // M1 A1: the channel first waits 1.5 s for the engine's file watch, then follows the presence stream.
 await w.clock.advance(1600);await drainFeed($)
 expect(followed,'D1_DENIAL_SETUP actual presence follower started').toBe(true)
 expect(Object.keys(transport.state.claims).length,'D1_DENIAL_SETUP actual presence claim exists').toBeGreaterThan(0)
 await $.command.run({command:'coco',args:'settings',origin:PERSON,presentation:P})
 const book=await $.ui.mount({surface,...pane});await settleLegacyStart($,w);await drainFeed($)
 draws=await paneReturns();expect(draws,'D1_DENIAL_SETUP actual owned Pane returned its startup tree').toBeGreaterThan(0)
 expect(await book.find({type:'Button',key:'coco:set:longtask:notify'}),'D1_DENIAL_SETUP installed companion exposes Notify').toBeDefined()
 expect(await book.find({type:'Button',key:'coco:longtask:settings'})).toBeUndefined()
 // the companion's own rows stand on her page once lane B's group names are merged (step 2); Notify stays on the switches page
 const turnTo=async(page:string)=>{if(COMPANION_PAGE!=='settings'){await $.command.run({command:'coco',args:page,origin:PERSON,presentation:P});await book.redraw()}}
 await turnTo(COMPANION_PAGE)
 await book.press({key:'coco:companion:large'});await book.press({key:'coco:companion:on'});await drainFeed($)
 await turnTo('settings')
 const seeded=records[records.length-1]!,sizeRequest=seeded.size,loginRequest=seeded.login
 expect(sizeRequest,'D1_DENIAL_SETUP shipping size action seeds unrelated request').toMatchObject({to:'large'})
 expect(loginRequest,'D1_DENIAL_SETUP shipping login action seeds unrelated request').toMatchObject({on:true})
 await book.press({key:'coco:set:longtask:notify'});await drainFeed($)
 expect((await readStored($,'bandSettings') as {longTask?:string}).longTask,'D1_DENIAL_SETUP Notify is durably selected').toBe('notify')
 expect(records.some(record=>typeof record.longTaskAuthorizationRequest==='number'),'D1_DENIAL_SETUP shipping Notify emits authorization').toBe(true)
 const beforeDraws=await paneReturns(),beforeRecordReads=recordReads
 records.length=0
 transport.request(folder+'/requests.jsonl',JSON.stringify({v:1,kind:'companion-state',at:w.clock.now(),info:{running:true,accessibility:true,size:'large',login:true,longTaskAuthorization:'denied'}})+'\n')
 await drainFeed($)
 expect((await readStored($,'bandSettings') as {longTask?:string}).longTask,'D1_DENIAL_BEHAVIOR denied event durably selects Band').toBe('band')
 expect(transport.state.settings?.longTask,'D1_DENIAL_BEHAVIOR denied Band reaches shared presence').toBe('band')
 expect(await book.find({type:'Text',text:words['settings.longTask.denied'].en}),'D1_DENIAL_BEHAVIOR actual pane renders approved denial row').toBeDefined()
 expect((await book.find({type:'Button',key:'coco:set:longtask:band'}))?.props.variant,'D1_DENIAL_BEHAVIOR Band choice redraws selected').toBe('primary')
 expect(await book.find({type:'Button',key:'coco:longtask:settings',text:words['settings.longTask.openSettings'].en}),'D1_DENIAL_BEHAVIOR actual pane exposes approved settings action').toBeDefined()
 draws=await paneReturns()
 expect(draws,'D1_DENIAL_BEHAVIOR received event redraws mounted pane').toBeGreaterThan(beforeDraws)
 console.log('D1_DENIAL_OWNED_PANE_RETURN_METRIC '+JSON.stringify({surface,beforeDraws,afterDraws:draws,scope:'successful returns from the actual production owned Pane handler in scratch facade; no forced redraw or OS paint count'}))
 expect(recordReads,'D1_DENIAL_BEHAVIOR denial uses event without rereading companion status').toBe(beforeRecordReads)
 expect(records.length,'D1_DENIAL_BEHAVIOR denial produces an updated feed').toBeGreaterThan(0)
 expect(records.filter(record=>record.longTaskAuthorizationRequest!==undefined),'D1_DENIAL_BEHAVIOR denied fallback cancels authorization').toEqual([])
 expect(records[records.length-1]?.size,'D1_DENIAL_BEHAVIOR denial preserves size request').toEqual(sizeRequest)
 expect(records[records.length-1]?.login,'D1_DENIAL_BEHAVIOR denial preserves login request').toEqual(loginRequest)
 records.length=0
 await book.press({key:'coco:longtask:settings'});await drainFeed($)
 expect(records.some(record=>typeof record.longTaskSettingsRequest==='number'),'D1_DENIAL_BEHAVIOR settings press emits native settings request').toBe(true)
 expect(records.filter(record=>record.longTaskAuthorizationRequest!==undefined),'D1_DENIAL_BEHAVIOR settings press never emits authorization').toEqual([])
 expect(records[records.length-1]?.size,'D1_DENIAL_BEHAVIOR settings action preserves size request').toEqual(sizeRequest)
 expect(records[records.length-1]?.login,'D1_DENIAL_BEHAVIOR settings action preserves login request').toEqual(loginRequest)
 expect((await readStored($,'bandSettings') as {longTask?:string}).longTask).toBe('band')
 expect(submitCalls).toBe(0);expect(toolCalls).toBe(0)
 await $.command.run({command:'d1-fixture-close-owned-pane',args:'',origin:PERSON,presentation:P});await book.unmount()
})

// The companion's follower and its denial event come through the pet's shared presence, which a Windows root declines.
for(const surface of ['desktop','terminal'] as const)if(WINDOWS_ROOTS)test(`D1 Windows plugin root starts no companion follower on ${surface} and offers no companion rows`,async($,on)=>{
 const shared=transportFixture({v:1,seq:0,quietAt:MORNING,asleep:false,clingy:false,busy:false,event:{kind:'initial',id:`initial:0:${MORNING}`,at:MORNING}})
 let followed=false
 const w=world(on,{withNativePresence:true,store:{...RECENT,longTask:'band'},env:{HOME:home,LANG:'en_US.UTF-8',TERM:'xterm-256color'},settings:{prefersReducedMotion:true},readText:path=>path.endsWith('/snapshot.json')?JSON.stringify(shared.state):path.endsWith('d1-words.json')?D1_WORDS_TEXT:undefined})
 on('session.id',()=>({value:'denial-session'}))
 on('session.surfaces',()=>({value:[surface]}))
 on('fs.exists',($,e)=>({value:samePath(e.path,'/System/Library/CoreServices/SystemVersion.plist')||samePath(e.path,'/bin/sh')||samePath(e.path,folder)||samePath(e.path,folder+'/requests.jsonl')||samePath(e.path,home+'/Applications/Coco Pet.app/Contents/MacOS/coco-companion')}))
 on('process.run',()=>({value:PROCESS_OK}))
 on('process.spawn',async function*($,e){if(e.argv[3]==='follow')followed=true;return {value:{code:0,signal:null}}})
 await $.session.start({...start,surface});await settleLegacyStart($,w);await drainFeed($)
 await w.clock.advance(1600);await drainFeed($)
 expect(followed,'a Windows plugin root declines the presence follower').toBe(false)
 expect(Object.keys(shared.state.claims).length).toBe(0)
 await $.command.run({command:'coco',args:'settings',origin:PERSON,presentation:P})
 const book=await $.ui.mount({surface,...pane});await settleLegacyStart($,w);await drainFeed($)
 expect((await book.findAll({type:'Button'})).filter(button=>/^coco:companion:/.test(String(button.key)))).toEqual([])
 await book.unmount()
})
