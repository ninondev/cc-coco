import {test,expect} from 'claude-code/testing'
import {world,RECENT,MORNING,settleLegacyStart,band,desktopPicture,stubPng,PERSON,P,SUMMARY} from './world'
import {D1_WORDS_TEXT} from './d1-room-fixture'
import {C3_WORDS_RAW} from './c3-words-fixture'
import {WINDOWS_ROOTS} from './test-system'
import {SHELL_TAIL,shellPicture,shellRedraws} from './d1-pixel-shell'
const cuts=['shed-a','shed-b','shed-c'].map(stubPng)
async function flush($:any){for(let i=0;i<80;i++)await $.command.run({command:'d1-timeline-boundary',args:'',origin:PERSON,presentation:P})}
type Callback={kind:'begun'|'completed';edge:number;elapsed:number}
type SpriteBlit={requestId:string;key:string;generation:number;at:number;png?:string;cells?:string}
function effectiveTerminalSprite(on:any,now:()=>number){
 const generations=new Map<string,number>(),latest=new Map<string,SpriteBlit>(),accepted:SpriteBlit[]=[]
 let requestId=''
 on('ui.render',{component:'AbovePrompt',surface:'terminal'},async($:any,e:any,next:any)=>{
  const tree=await next(e);requestId=e.requestId;generations.set(requestId,(generations.get(requestId)??0)+1);latest.delete(requestId);return tree
 })
 on('ui.blit',{key:'sprite'},async($:any,e:any,next:any)=>{
  const generation=generations.get(e.requestId),at=now(),result=await next(e)
  const deny=result?.deny??result?.value?.deny
  if(result&&typeof result==='object'&&!deny&&generation!==undefined&&generation===generations.get(e.requestId)&&e.key==='sprite'){
   const record:SpriteBlit={requestId:e.requestId,key:e.key,generation,at,...(typeof e.source?.png==='string'?{png:e.source.png}:{}),...(typeof e.cells==='string'?{cells:e.cells}:{})}
   latest.set(e.requestId,record);accepted.push(record)
  }
  return result
 })
 return {accepted,requestId:()=>requestId,generation:()=>generations.get(requestId),async picture(ui:any){
  const image=await ui.find({type:'Image',key:'sprite'}),record=latest.get(requestId)
  return String(record?.generation===generations.get(requestId)&&record?.png!==undefined?record.png:image?.props.source?.png)
 },async cells(ui:any){const raster=await ui.find({type:'Raster',key:'sprite'}),record=latest.get(requestId);return String(record?.generation===generations.get(requestId)&&record?.cells!==undefined?record.cells:raster?.props.cells)}}
}
for(const denial of ['not mounted','unavailable'] as const)test(`D1 terminal ${denial} sprite blit falls back to each exact cut and full1600ms publication`,{options:{band:'on'}},async($,on)=>{
 let returnedTrees=0;const attempted:{at:number;requestId:string;key:string;png:string}[]=[]
 on('ui.render',{component:'AbovePrompt',surface:'terminal'},async($,e,next)=>{const tree=await next(e);returnedTrees++;return tree})
 const effective=effectiveTerminalSprite(on,()=>w.clock.now())
 on('ui.*',($,e,next)=>{if(!next.is('ui.blit',e))return next(e);const shed=w.view().shed,elapsed=shed?w.clock.now()-shed.at:-1;if(shed?.phase!=='end'||![160,360,960].includes(elapsed)||e.key!=='sprite')return next(e);attempted.push({at:w.clock.now(),requestId:e.requestId,key:e.key,png:String('source'in e?e.source.png:undefined)});return {value:{deny:denial}}})
 let entered!:()=>void,release!:()=>void;const atNext=new Promise<void>(r=>entered=r),held=new Promise<void>(r=>release=r)
 on('session.compact',{trigger:'manual'},async()=>{entered();await held;return {messages:[SUMMARY],tokensBefore:1000,tokensAfter:100}})
 on('process.run',()=>({value:{exitCode:1,stdout:'',stderr:'fixture decoder unavailable',isStdoutTruncated:false,isStderrTruncated:false}}))
 on('fs.read',{path:/[\\/]assets[\\/]pixel[\\/]4[234]-shed-[abc]\.png$/},($,e)=>({value:{base64:cuts[Number(e.path.match(/[\\/]4([234])-shed-/)![1])-2]!}}))
 // the first compaction earns her sesame socks and she says so once; she has them here, so only the compaction is counted
 const w=world(on,{store:{...RECENT,band:'on',pictures:'kitty',stamps:{met:MORNING,shiori:MORNING},occasions:{shedFirst:true,twoFirst:true,warned:{}},bandSettings:{socksEarned:['sesame']}},surfaces:['terminal'],env:{LANG:'en_US.UTF-8',TERM:'xterm-kitty'},settings:{prefersReducedMotion:false},readText:path=>path.endsWith('d1-words.json')?D1_WORDS_TEXT:path.endsWith('c3-text.json')?C3_WORDS_RAW:undefined})
 await $.session.start({cwd:WINDOWS_ROOTS?'C:\\Users\\windows\\d1-blit-denial':'/tmp/d1-blit-denial',surface:'terminal',isInteractive:true});await settleLegacyStart($,w)
 const ui=await $.ui.mount({surface:'terminal',...band(100)});await w.clock.advance(1600);await ui.drawn();await flush($)
 const callbacks=async()=>JSON.parse((await $.command.run({command:'d1-fixture-shed-callbacks',args:'',origin:PERSON,presentation:P})).text) as Callback[]
 const prior={mood:w.view().mood,frame:w.view().frame,picture:await effective.picture(ui)},before=returnedTrees
 const pending=$.session.compact({trigger:'manual',messages:[SUMMARY]});await atNext;await ui.drawn();await flush($)
 let snake='';try{snake=await effective.picture(ui);expect(w.view().shed?.phase).toBe('begin');expect(w.view().mood).toBe('snake')}finally{release()}
 await pending;await ui.drawn();await flush($);const ended=returnedTrees,shedAt=w.view().shed!.at,attemptsBefore=attempted.length,acceptedBefore=effective.accepted.length
 // her pixel version (DECISIONS 917): the shell change plays frame by frame, each frame one redraw; a denied edge blit publishes the same frame
 expect(await effective.picture(ui)).toBe(shellPicture(0,'png'));let elapsed=0
 for(const atMs of [159,160,359,360,959,960,1599,1600]){
  await w.clock.advance(atMs-elapsed);elapsed=atMs;await ui.drawn();await flush($)
  const records=await callbacks(),completed=[160,360,960,1600].filter(edge=>edge<=atMs)
  expect(records.filter(c=>c.kind==='begun').map(c=>c.edge)).toEqual(completed);expect(records.filter(c=>c.kind==='completed').map(c=>c.edge)).toEqual(completed)
  for(const record of records)expect(record.elapsed).toBe(record.edge)
  expect(await effective.picture(ui)).toBe(shellPicture(atMs,'png'))
  if(atMs<1600)expect(w.view().mood).toBe('snake')
  if([160,360,960].includes(atMs))expect(returnedTrees).toBe(ended+[160,360,960].filter(edge=>edge<=atMs).length+shellRedraws(atMs))
 }
 expect(attempted.slice(attemptsBefore).map(({at,key,png})=>({elapsed:at-shedAt,key,png}))).toEqual([160,360,960].map(elapsed=>({elapsed,key:'sprite',png:shellPicture(elapsed,'png')})))
 expect(effective.accepted.length).toBe(acceptedBefore);expect(returnedTrees-before).toBe(6+shellRedraws(1600));expect(w.view().mood).toBe(prior.mood);expect(w.view().frame).toBe(prior.frame)
 const settled={callbacks:await callbacks(),returnedTrees,reads:w.fileReads.length};await w.clock.advance(60000);await flush($)
 expect({callbacks:await callbacks(),returnedTrees,reads:w.fileReads.length}).toEqual({...settled,returnedTrees:settled.returnedTrees+SHELL_TAIL})
 const quiet=returnedTrees;await w.clock.advance(60000);await flush($);expect(returnedTrees).toBe(quiet)
 console.log('D1_TERMINAL_SHED_BLIT_DENIAL_METRIC '+JSON.stringify({denial,attempted:attempted.slice(attemptsBefore),callbacks:settled.callbacks,returnedTreesDelta:returnedTrees-before,idleWindowMs:60000,scope:'mocked accepted/denied API receipts and returned trees; no OS paint claim'}));await ui.unmount()
})

