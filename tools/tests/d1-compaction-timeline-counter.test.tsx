import {test,expect} from 'claude-code/testing'
import {world,RECENT,MORNING,settleLegacyStart,band,desktopPicture,stubPng,PERSON,P,SUMMARY} from './world'
import {D1_WORDS_TEXT} from './d1-room-fixture'
import {C3_WORDS_RAW} from './c3-words-fixture'
import {WINDOWS_ROOTS} from './test-system'
import {effectiveD1DesktopPixel} from './d1-pixel-css-observer'
import {shellPicture,shellRedraws} from './d1-pixel-shell'
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
for(const surface of ['desktop','terminal'] as const)test(`D1 actual ${surface} compaction completes every required callback and preserves its full1600ms timeline`,{options:{band:'on'}},async($,on)=>{
 let returnedTrees=0;const waits:number[]=[],invalidations:string[]=[]
 const effective=effectiveTerminalSprite(on,()=>w.clock.now())
 on('ui.invalidate',($,e,next)=>{invalidations.push(e.event);return next(e)})
 on('ui.render',{component:'AbovePrompt',surface:'terminal'},async($,e,next)=>{const tree=await next(e);returnedTrees++;return tree})
 on('clock.*',($,e,next)=>{if(next.is('clock.after',e))waits.push(e.ms);return next(e)})
 let entered!:()=>void,release!:()=>void;const atNext=new Promise<void>(r=>entered=r),held=new Promise<void>(r=>release=r)
 on('session.compact',{trigger:'manual'},async()=>{entered();await held;return {messages:[SUMMARY],tokensBefore:1000,tokensAfter:100}})
 on('process.run',()=>({value:{exitCode:1,stdout:'',stderr:'fixture decoder unavailable',isStdoutTruncated:false,isStderrTruncated:false}}))
 on('fs.read',{path:/[\\/]assets[\\/]pixel[\\/]4[234]-shed-[abc]\.png$/},($,e)=>({value:{base64:cuts[Number(e.path.match(/[\\/]4([234])-shed-/)![1])-2]!}}))
 // the first compaction earns her sesame socks and she says so once; she has them here, so only the compaction is counted
 const w=world(on,{store:{...RECENT,band:'on',pictures:'kitty',stamps:{met:MORNING,shiori:MORNING},occasions:{shedFirst:true,twoFirst:true,warned:{}},bandSettings:{socksEarned:['sesame']}},surfaces:[surface],env:{LANG:'en_US.UTF-8',TERM:'xterm-kitty'},settings:{prefersReducedMotion:false},readText:path=>path.endsWith('d1-words.json')?D1_WORDS_TEXT:path.endsWith('c3-text.json')?C3_WORDS_RAW:undefined})
 await $.session.start({cwd:WINDOWS_ROOTS?'C:\\Users\\windows\\d1-timeline-'+surface:'/tmp/d1-timeline-'+surface,surface,isInteractive:true});await settleLegacyStart($,w)
 const ui=await $.ui.mount({surface,...band(100)});await w.clock.advance(1600);await ui.drawn();await flush($)
 const picture=async()=>surface==='desktop'?String((await desktopPicture(ui))?.props.source):await effective.picture(ui)
 const callbacks=async()=>JSON.parse((await $.command.run({command:'d1-fixture-shed-callbacks',args:'',origin:PERSON,presentation:P})).text) as Callback[]
 const sample=async()=>({returnedTrees:surface==='desktop'?Number((await $.command.run({command:'d1-fixture-desktop-returned-trees',args:'',origin:PERSON,presentation:P})).text):returnedTrees,invalidations:invalidations.length,scheduledTimers:waits.length,reads:w.fileReads.length,callbacks:await callbacks()})
 const prior={mood:w.view().mood,frame:w.view().frame,picture:await picture()};expect(prior.picture).not.toBe('undefined');const before=await sample();expect(before.returnedTrees).toBeGreaterThan(0);expect(before.callbacks).toEqual([])
 const pending=$.session.compact({trigger:'manual',messages:[SUMMARY]});await atNext;await ui.drawn();await flush($)
 const begun=await sample();let snake=''
 try{expect(w.view().shed?.phase).toBe('begin');expect(w.view().mood).toBe('snake');snake=await picture();expect(begun.callbacks).toEqual([])}finally{release()}
 await pending;await ui.drawn();await flush($);const ended=await sample(),blitsBeforeCuts=effective.accepted.length,shedAt=w.view().shed!.at;expect(w.view().shed?.phase).toBe('end');expect(ended.callbacks).toEqual([])
 // Coco on the desktop (coco-motion.ts): packing while it ran, then one shell clip that plays by itself
 const shell=await picture()
 // her pixel version in the terminal (DECISIONS 917): the shell change plays frame by frame, each frame one redraw
 if(surface==='desktop'){expect(snake).toContain('data-coco="A pack"');expect(shell).toContain('data-coco="A shell"')}
 else expect(shell).toBe(shellPicture(0,'png'))
 const edges=surface==='desktop'?[1600]:[160,360,960,1600],records:{atMs:number;picture:string;counters:Awaited<ReturnType<typeof sample>>}[]=[]
 let elapsed=0
 for(const atMs of [159,160,359,360,959,960,1599,1600]){
  await w.clock.advance(atMs-elapsed);elapsed=atMs;await ui.drawn();await flush($)
  const actual=await picture(),counters=await sample(),completed=edges.filter(edge=>edge<=atMs)
  expect(counters.callbacks.filter(c=>c.kind==='begun').map(c=>c.edge)).toEqual(completed)
  expect(counters.callbacks.filter(c=>c.kind==='completed').map(c=>c.edge)).toEqual(completed)
  for(const callback of counters.callbacks)expect(callback.elapsed).toBe(callback.edge)
  if(atMs<1600)expect(w.view().mood).toBe('snake')
  else {expect(w.view().mood).toBe(prior.mood);expect(w.view().frame).toBe(prior.frame)}
  // the terminal's shell change outlasts the 1600 ms timeline
  if(surface==='terminal')expect(actual).toBe(shellPicture(atMs,'png'))
  if(surface==='desktop')expect(actual).toBe(shell)
  if(surface==='terminal'&&[160,360,960].includes(atMs)){
   const blits=effective.accepted.slice(blitsBeforeCuts).filter(blit=>blit.at===shedAt+atMs)
   expect(blits.map(({requestId,key,png})=>({requestId,key,png}))).toEqual([{requestId:effective.requestId(),key:'sprite',png:shellPicture(atMs,'png')}])
   expect(blits[0]!.generation).toBe(effective.generation())
   expect(counters.returnedTrees).toBe(ended.returnedTrees+shellRedraws(atMs))
  }
  records.push({atMs,picture:actual,counters})
 }
 const settled=await sample();await w.clock.advance(60000);await flush($);const idleAfter=await sample();expect(idleAfter.callbacks).toEqual(settled.callbacks);if(surface==='desktop')expect(idleAfter).toEqual(settled)
 console.log('D1_COMPACTION_TIMELINE_CALLBACK_METRIC '+JSON.stringify({surface,before,begun,ended,records:records.map(({atMs,counters})=>({atMs,...counters})),callbackEdges:edges,completedCallbacks:settled.callbacks.filter(c=>c.kind==='completed').length,idleWindowMs:60000,idleBefore:settled,idleAfter,forcedRedraws:0,spec11ThreeRedrawBudget:'strict three returned-tree budget; accepted terminal sprite blits observed separately',scope:'actual shipping mounted AbovePrompt; same-hook scratch source callback counter; virtual clock; returned trees and global invalidations observed separately; no OS paint count'}))
 await ui.unmount();expect(settled.returnedTrees-before.returnedTrees).toBe(3+(surface==='terminal'?shellRedraws(1600):0))
})


test('D1 compact desktop plays the Coco shell change with one callback within three returned trees',{options:{band:'compact'}},async($,on)=>{
 const waits:number[]=[],invalidations:string[]=[]
 on('clock.*',($,e,next)=>{if(next.is('clock.after',e))waits.push(e.ms);return next(e)})
 on('ui.invalidate',($,e,next)=>{invalidations.push(e.event);return next(e)})
 const effective=effectiveD1DesktopPixel(on,()=>w.clock.now())
 let entered!:()=>void,release!:()=>void;const atNext=new Promise<void>(r=>entered=r),held=new Promise<void>(r=>release=r)
 on('session.compact',{trigger:'manual'},async()=>{entered();await held;return {messages:[SUMMARY],tokensBefore:1000,tokensAfter:100}})
 on('process.run',()=>({value:{exitCode:1,stdout:'',stderr:'fixture decoder unavailable',isStdoutTruncated:false,isStderrTruncated:false}}))
 on('fs.read',{path:/[\\/]assets[\\/]pixel[\\/]4[234]-shed-[abc]\.png$/},($,e)=>({value:{base64:cuts[Number(e.path.match(/[\\/]4([234])-shed-/)![1])-2]!}}))
 // the first compaction earns her sesame socks and she says so once; she has them here, so only the compaction is counted
 const w=world(on,{store:{...RECENT,band:'compact',stamps:{met:MORNING,shiori:MORNING},occasions:{shedFirst:true,twoFirst:true,warned:{}},bandSettings:{socksEarned:['sesame']}},surfaces:['desktop'],settings:{prefersReducedMotion:false},readText:path=>path.endsWith('d1-words.json')?D1_WORDS_TEXT:path.endsWith('c3-text.json')?C3_WORDS_RAW:undefined})
 await effective.enable($)
 await $.session.start({cwd:WINDOWS_ROOTS?'C:\\Users\\windows\\d1-css-budget':'/tmp/d1-css-budget',surface:'desktop',isInteractive:true});await settleLegacyStart($,w)
 const ui=await $.ui.mount({surface:'desktop',...band(100)});await w.clock.advance(1600);await ui.drawn();await flush($)
 const sample=async()=>({returnedTrees:Number((await $.command.run({command:'d1-fixture-desktop-returned-trees',args:'',origin:PERSON,presentation:P})).text),callbacks:JSON.parse((await $.command.run({command:'d1-fixture-shed-callbacks',args:'',origin:PERSON,presentation:P})).text) as Callback[],waits:waits.length,invalidations:invalidations.length,reads:w.fileReads.length})
 const before=await sample(),prior={mood:w.view().mood,frame:w.view().frame,picture:await effective.source(ui)}
 const pending=$.session.compact({trigger:'manual',messages:[SUMMARY]});await atNext;await ui.drawn();await flush($)
 let pack='';try{expect(w.view().shed?.phase).toBe('begin');pack=await effective.source(ui);expect(pack).toContain('data-coco="A pack"')}finally{release()}
 await pending;await ui.drawn();await flush($);const ended=await sample()
 expect(ended.returnedTrees-before.returnedTrees).toBe(2)
 let elapsed=0;const records:any[]=[]
 for(const atMs of [0,159,160,359,360,959,960,1599,1600]){
  await w.clock.advance(atMs-elapsed);elapsed=atMs;await ui.drawn();await flush($)
  // Coco's shell clip plays by itself on the desktop band: one callback, at the 1600 ms end
  const observed=await effective.sample(ui),actual=await sample(),completed=[1600].filter(edge=>edge<=atMs)
  expect(actual.callbacks.filter(c=>c.kind==='begun').map(c=>c.edge)).toEqual(completed);expect(actual.callbacks.filter(c=>c.kind==='completed').map(c=>c.edge)).toEqual(completed)
  for(const c of actual.callbacks)expect(c.elapsed).toBe(c.edge)
  // Coco: the compact band draws her painted shell clip too (no pixel cut timeline until her pixel art)
  expect(observed.layers).toEqual([]);expect(observed.source).toContain('data-coco="A shell"');for(const cut of cuts)expect(observed.source).not.toContain(cut)
  if(atMs<1600){
   expect(actual.returnedTrees).toBe(ended.returnedTrees);expect(actual.reads).toBe(ended.reads);expect(actual.invalidations).toBe(ended.invalidations)
   expect(w.view().mood).toBe('snake')
  }else{expect(w.view().mood).toBe(prior.mood);expect(w.view().frame).toBe(prior.frame)}
  records.push({atMs,layers:observed.layers,...actual})
 }
 const settled=await sample();expect(settled.returnedTrees-before.returnedTrees).toBe(3)
 await w.clock.advance(60000);await flush($);expect(await sample()).toEqual(settled)
 console.log('D1_DESKTOP_PIXEL_CSS_BUDGET_METRIC '+JSON.stringify({before,ended,records,idleWindowMs:60000,forcedRedraws:0,scope:'actual returned SVG emitted CSS deterministic visibility sampling; exact source layers and callbacks; host paint unverified'}));await ui.unmount()
})
