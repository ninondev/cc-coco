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
function solidRasterCells(colour:number):string{
 const bytes=new Uint8Array(35*9*12),view=new DataView(bytes.buffer)
 for(let i=0;i<35*9;i++){view.setUint32(i*12,0x2580,true);view.setUint32(i*12+4,colour,true);view.setUint32(i*12+8,colour,true)}
 return btoa(String.fromCharCode(...bytes))
}
test('D1 terminal Raster accepts all three cached crop blits with four exact callbacks and three returned trees',{options:{band:'on'}},async($,on)=>{
 let returnedTrees=0;const decoderInputs:{names:string[];paths:string[];widths:number[]}[]=[]
 on('ui.render',{component:'AbovePrompt',surface:'terminal'},async($,e,next)=>{const tree=await next(e);returnedTrees++;return tree})
 const effective=effectiveTerminalSprite(on,()=>w.clock.now()),colours=[0x5f0000,0x005f00,0x00005f],cells=colours.map(solidRasterCells)
 on('process.run',($,e,next)=>{
  if(!e.argv.some(arg=>arg.endsWith('pose-pixels.mjs')))return next(e)
  const decoded=Object.fromEntries(Object.keys(JSON.parse(e.init?.stdin??'{}')).map(name=>[name,{width:35,pixels:Array(35*32).fill(colours[['shed-a','shed-b','shed-c'].indexOf(name)]??0)}]))
  decoderInputs.push({names:Object.keys(decoded).sort(),paths:Object.values(JSON.parse(e.init?.stdin??'{}')) as string[],widths:Object.values(decoded).map(frame=>frame.width)})
  return {value:{exitCode:0,stdout:JSON.stringify(decoded),stderr:'',isStdoutTruncated:false,isStderrTruncated:false}}
 })
 let entered!:()=>void,release!:()=>void;const atNext=new Promise<void>(r=>entered=r),held=new Promise<void>(r=>release=r)
 on('session.compact',{trigger:'manual'},async()=>{entered();await held;return {messages:[SUMMARY],tokensBefore:1000,tokensAfter:100}})
 // the first compaction earns her sesame socks and she says so once; she has them here, so only the compaction is counted
 const w=world(on,{store:{...RECENT,band:'on',pictures:'cells',stamps:{met:MORNING,shiori:MORNING},occasions:{shedFirst:true,twoFirst:true,warned:{}},bandSettings:{socksEarned:['sesame']}},surfaces:['terminal'],env:{LANG:'en_US.UTF-8',TERM:'xterm-256color'},settings:{prefersReducedMotion:false},readText:path=>path.endsWith('d1-words.json')?D1_WORDS_TEXT:path.endsWith('c3-text.json')?C3_WORDS_RAW:undefined})
 await $.session.start({cwd:WINDOWS_ROOTS?'C:\\Users\\windows\\d1-raster-blit':'/tmp/d1-raster-blit',surface:'terminal',isInteractive:true});await settleLegacyStart($,w)
 const ui=await $.ui.mount({surface:'terminal',...band(100)});await w.clock.advance(1600);await ui.drawn();await flush($)
 const callbacks=async()=>JSON.parse((await $.command.run({command:'d1-fixture-shed-callbacks',args:'',origin:PERSON,presentation:P})).text) as Callback[]
 const prior={mood:w.view().mood,frame:w.view().frame,cells:await effective.cells(ui)},before=returnedTrees
 const pending=$.session.compact({trigger:'manual',messages:[SUMMARY]});await atNext;await ui.drawn();await flush($)
 let snake='';try{snake=await effective.cells(ui);expect(w.view().mood).toBe('snake')}finally{release()}
 await pending;await ui.drawn();await flush($);const ended=returnedTrees,shedAt=w.view().shed!.at,acceptedBefore=effective.accepted.length
 // her pixel version (DECISIONS 917) draws the shell change from her own frames: no decoder, no crops, 24 columns,
 // each frame of the change one redraw; the edges blit the frame current then, in this terminal's 256 colours
 expect(decoderInputs).toEqual([])
 expect((await ui.find({type:'Raster',key:'sprite'}))?.props).toMatchObject({columns:24,rows:9})
 expect(await effective.cells(ui)).toBe(shellPicture(0,'cells','256'));let elapsed=0
 for(const atMs of [159,160,359,360,959,960,1599,1600]){
  await w.clock.advance(atMs-elapsed);elapsed=atMs;await ui.drawn();await flush($)
  const records=await callbacks(),completed=[160,360,960,1600].filter(edge=>edge<=atMs)
  expect(records.filter(c=>c.kind==='begun').map(c=>c.edge)).toEqual(completed);expect(records.filter(c=>c.kind==='completed').map(c=>c.edge)).toEqual(completed)
  for(const record of records)expect(record.elapsed).toBe(record.edge)
  expect(await effective.cells(ui)).toBe(shellPicture(atMs,'cells','256'))
  if(atMs<1600)expect(w.view().mood).toBe('snake')
  if([160,360,960].includes(atMs))expect(returnedTrees).toBe(ended+shellRedraws(atMs))
 }
 const blits=effective.accepted.slice(acceptedBefore)
 expect(blits.map(({at,key,cells})=>({elapsed:at-shedAt,key,cells}))).toEqual([160,360,960].map(elapsed=>({elapsed,key:'sprite',cells:shellPicture(elapsed,'cells','256')})))
 expect(blits.every(blit=>blit.requestId===effective.requestId())).toBe(true);expect(returnedTrees-before).toBe(3+shellRedraws(1600))
 expect(w.view().mood).toBe(prior.mood);expect(w.view().frame).toBe(prior.frame)
 const settled={callbacks:await callbacks(),returnedTrees,reads:w.fileReads.length};await w.clock.advance(60000);await flush($)
 expect({callbacks:await callbacks(),returnedTrees,reads:w.fileReads.length}).toEqual({...settled,returnedTrees:settled.returnedTrees+SHELL_TAIL})
 const quiet=returnedTrees;await w.clock.advance(60000);await flush($);expect(returnedTrees).toBe(quiet)
 console.log('D1_TERMINAL_SHED_RASTER_BLIT_METRIC '+JSON.stringify({callbackEdges:[160,360,960,1600],blitEdges:blits.map(blit=>blit.at-shedAt),distinctEffectiveSources:new Set(blits.map(blit=>blit.cells)).size,returnedTreesDelta:returnedTrees-before,idleWindowMs:60000,scope:'mock decoder crop cells and accepted API receipts; no terminal paint claim'}));await ui.unmount()
})
