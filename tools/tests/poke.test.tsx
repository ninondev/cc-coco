// Mounted band behavior at the engine seam: face touches, shared wake and silent wink.
import { describe, expect, test } from 'claude-code/testing'
import { LANGS, WORDS } from '../hooks/words'
import { C3_WORDS_RAW } from './c3-words-fixture'
import { C3_HEAD_MANIFEST } from './c3-head-assets'
import { LINES } from '../hooks/lines'
import { APPROVED_PERSONA } from './approved-localization'
import { settleLegacyStart, band, desktopPicture, P, PERSON, RECENT, world } from './world'

// The desktop band draws Coco (coco-motion.ts): a touch is her petted clip, a burst of touches the hood,
// and she goes back to what she was doing when the touch ends. Under reduced motion each is one picture.
const label=(source:string)=>/data-coco="([^"]+)"/.exec(source)?.[1]
const assetRead=(path:string)=>/[\\/]assets[\\/]/.test(path)&&!/[\\/]assets[\\/]coco[\\/]band-[AB]\.json$/.test(path)

const KEY='coco:band:poke',PAT='coco:band:pat'
const START={cwd:'/tmp/poke',surface:'desktop' as const,isInteractive:true}
const PANE={plugin:'coco',component:'Pane' as const,requestId:'coco-book',props:{title:'Coco',isFocused:false,bodyColumns:64,placement:'dock' as const,scroll:{offset:0,bodyRows:40},view:{}}}
const svg=async(ui:Parameters<typeof desktopPicture>[0])=>String((await desktopPicture(ui))?.props.source)
const coco=async(ui:Parameters<typeof desktopPicture>[0])=>label(await svg(ui))
const visibleTree=(tree:unknown)=>JSON.parse(JSON.stringify(tree,(key,value)=>key==='press'?undefined:value))
function textOf(node:unknown):string {if(typeof node==='string')return node;if(!node||typeof node!=='object')return '';return ((node as{children?:unknown[]}).children??[]).map(textOf).join('')}
const speech=async(ui:{drawn:()=>Promise<unknown>})=>textOf(await ui.drawn())
const visibleStage=(source:string)=>source.replace(/\*([^*\n]+)\*/g,'$1')

test('approved stage visibility decodes paired delimiters while preserving exact words and unmatched literal marks',()=>{
  const source='*stage* ordinary *second stage*'
  expect(visibleStage(source)).toBe('stage ordinary second stage')
  expect(source).toBe('*stage* ordinary *second stage*')
  for(const literal of ['ordinary text','(stage) ordinary','ordinary * unmatched','ordinary ** marker','*across\na line*'])expect(visibleStage(literal)).toBe(literal)
})

for(const style of ['on','compact'] as const)test(`${style}: default touches are hover buttons beside a borderless bundled image`,{options:{band:style}},async($,on)=>{
  const w=world(on,{store:{...RECENT,band:style},settings:{prefersReducedMotion:true}})
  await $.session.start(START);; await settleLegacyStart($,w);const ui=await $.ui.mount({surface:'desktop',...band(100)})
  expect(await ui.find({type:'Markdown',key:KEY})).toBeUndefined()
  for(const key of [KEY,PAT,'coco:book:open','coco:band:close'])expect(await ui.find({type:'Button',key})).toBeDefined()
  expect(await coco(ui)).toBe('A idle');expect(await svg(ui)).not.toContain('@keyframes')
  for(const image of await ui.findAll({type:'Svg'}))expect(image.props.isInteractive).not.toBe(true)
  expect(w.fileReads.filter(assetRead)).toEqual([])
})

describe('B1 touch behavior',()=>{
  test('first band pulse keeps the book and changes the face before file, spawn, durable state or timer work',async($,on)=>{
    const w=world(on,{store:RECENT,settings:{prefersReducedMotion:true}})
    let recording=false,readsAtRedraw:number|undefined,writesAtRedraw:number|undefined,redraws=0,writes=0
    const operations:string[]=[];const note=(operation:string)=>{if(recording)operations.push(operation)}
    on('state.set',{key:'view'},($,e,next)=>{if(recording)writes++;note('state.set');return next(e)})
    on('fs.exists',{path:/.*/},($,e,next)=>{note('fs.exists');return next(e)})
    on('fs.write',{path:/.*/},($,e,next)=>{note('fs.write');return next(e)})
    on('process.spawn',async function*(){note('process.spawn')})
    on('clock.*',($,e,next)=>{if(next.is('clock.after',e))note('clock.after');return next(e)})
    on('state.set',{key:'bandWake'},($,e,next)=>{if(recording){redraws++;readsAtRedraw??=w.fileReads.length;writesAtRedraw??=writes}note('bandWake');return next(e)})
    on('ui.invalidate',($,e,next)=>{note('globalRedraw');return next(e)})
    await $.session.start(START);; await settleLegacyStart($,w);const ui=await $.ui.mount({surface:'desktop',...band(100)})
    await $.command.run({command:'coco',args:'settings',origin:PERSON,presentation:P})
    const book=await $.ui.mount({surface:'desktop',...PANE})
    // The cold first answer primes its band-only subscription on the next host turn.
    await w.clock.advance(0);await ui.drawn()
    const beforeBook=visibleTree(await book.drawn()),beforeReads=w.fileReads.length,now=w.clock.now()
    recording=true;await ui.press({key:KEY});recording=false
    const first=operations.indexOf('bandWake');expect(first).toBeGreaterThanOrEqual(0);expect(operations.slice(0,first)).toEqual([])
    expect(readsAtRedraw).toBe(beforeReads);expect(writesAtRedraw).toBe(0);expect(w.clock.now()).toBe(now)
    const firstSource=await svg(ui);expect(label(firstSource)).toBe('A petted')
    expect(await speech(ui)).toContain(APPROVED_PERSONA.en.poke[0]);expect(redraws).toBe(1);expect(visibleTree(await book.drawn())).toEqual(beforeBook)
    await w.clock.advance(120);expect(await coco(ui)).toBe('A petted')
    await w.clock.advance(979);expect(await coco(ui)).toBe('A petted')
    await w.clock.advance(1);expect(await coco(ui)).toBe('A idle')
    console.log('POKE_FIRST_REDRAW '+JSON.stringify({operationsBeforeFirst:operations.slice(0,first),assetReadsBeforeFirst:readsAtRedraw!-beforeReads,stateWritesBeforeFirst:writesAtRedraw,virtualWaitMs:w.clock.now()-now-1100}))
  })
  test('300ms acceptance gate and three accepted touches within1500ms produce a burst',async($,on)=>{
    const w=world(on,{store:RECENT,settings:{prefersReducedMotion:true}});await $.session.start(START);; await settleLegacyStart($,w);await $.turn.start({text:'go',turnId:'poke-work'})
    const ui=await $.ui.mount({surface:'desktop',...band(100,true)})
    await ui.press({key:KEY});for(let i=0;i<20;i++)await ui.press({key:KEY})
    expect(await coco(ui)).toBe('A petted');expect(w.view().mood).toBe('think')
    await w.clock.advance(300);await ui.press({key:KEY});expect(await coco(ui)).toBe('A petted')
    await w.clock.advance(300);await ui.press({key:KEY});expect(await coco(ui)).toBe('A hood');expect(await speech(ui)).toContain(APPROVED_PERSONA.en.poke_many[0]);expect(w.view().mood).toBe('think')
    await w.clock.advance(2200);expect(await coco(ui)).toBe('A think')
  })
  test('ignored rapid poke cannot extend the1100ms reduced deadline; a semantic turn ends the touch',async($,on)=>{
    const w=world(on,{store:RECENT,settings:{prefersReducedMotion:true}});await $.session.start(START);; await settleLegacyStart($,w);const ui=await $.ui.mount({surface:'desktop',...band(100)})
    await ui.press({key:KEY});await w.clock.advance(299);await ui.press({key:KEY});await w.clock.advance(801)
    expect(await coco(ui)).toBe('A idle');await ui.press({key:PAT});expect(await coco(ui)).toBe('A petted');await $.turn.start({text:'go',turnId:'interrupt-pat'})
    expect(await coco(ui)).toBe('A think')
  })
  // SPEC 6.2-6.3: pose holds and event deadlines may publish; CSS strokes and body-only touches never redraw frames.
  test('a self animated tool pose and its touch stay fixed between event-owned pose transitions',async($,on)=>{
    const readC3=(path:string)=>path.endsWith('c3-text.json')?C3_WORDS_RAW:path.endsWith('frame-manifest.json')?JSON.stringify(C3_HEAD_MANIFEST):undefined
    const w=world(on,{store:RECENT,readText:readC3});let counting=false,redraws=0,globalRedraws=0
    on('state.set',{key:'bandWake'},($,e,next)=>{if(counting)redraws++;return next(e)})
    on('ui.invalidate',($,e,next)=>{if(counting)globalRedraws++;return next(e)})
    await $.session.start(START);await settleLegacyStart($,w)
    await $.turn.start({text:'go',turnId:'pat-animation'});const ui=await $.ui.mount({surface:'desktop',...band(100,true)})
    await w.clock.advance(1200);await $.tool.call({tool:'Read',file_path:'/tmp/a'});await settleLegacyStart($,w)
    expect(w.view().mood).toBe('work');expect(w.view().pose?.name).toBe('scroll')
    counting=true;await ui.press({key:PAT})
    const picture=await svg(ui)
    expect(picture).toContain('@keyframes');expect(label(picture)).toBe('A petted');expect(redraws).toBe(1)
    await w.clock.advance(2499);expect(w.view().pose?.name).toBe('scroll');expect(redraws).toBe(1);expect(await svg(ui)).toBe(picture)
    await w.clock.advance(1);await settleLegacyStart($,w)
    const quiet=await svg(ui)
    console.log('C3_EXPIRED_TOUCH_TRACE '+JSON.stringify({at:w.clock.now(),pose:w.view().pose?.name,redraws,coco:label(quiet)}))
    // Coco builds no pose pictures and reads no old frames for them, so the quiet pose publishes once
    expect(w.view().pose?.name).toBe('think');expect(redraws).toBe(2);expect(quiet).not.toBe(picture)
    expect(label(quiet)).not.toBe('A petted')
    const resting=await svg(ui),before=redraws
    await w.clock.advance(99);expect(redraws).toBe(before);expect(await svg(ui)).toBe(resting)
    await w.clock.advance(1);expect(redraws).toBe(before+1);expect(globalRedraws).toBe(0)
    console.log('C3_POSE_TOUCH_PUBLICATIONS '+JSON.stringify({touch:1,quietPose:1,touchDeadline:1,globalInvalidations:globalRedraws}))
  })
  // SPEC 6.2-6.3: a queued pose change keeps the original touch clock instead of replaying the pat.
  test('an active pat keeps its elapsed phase when a tool pose changes after the minimum hold',async($,on)=>{
    const readC3=(path:string)=>path.endsWith('c3-text.json')?C3_WORDS_RAW:path.endsWith('frame-manifest.json')?JSON.stringify(C3_HEAD_MANIFEST):undefined
    const w=world(on,{store:RECENT,readText:readC3})
    await $.session.start(START);await settleLegacyStart($,w);await $.turn.start({text:'go',turnId:'pat-handoff'})
    const ui=await $.ui.mount({surface:'desktop',...band(100,true)})
    await w.clock.advance(1200);await $.tool.call({tool:'Read',file_path:'/tmp/a'});await settleLegacyStart($,w)
    await ui.press({key:PAT});const patted=await svg(ui);expect(label(patted)).toBe('A petted');await w.clock.advance(1199)
    await $.tool.call({tool:'Grep',pattern:'parser'});expect(w.view().pose?.name).toBe('scroll')
    await w.clock.advance(1);await settleLegacyStart($,w)
    expect(w.view().pose?.name).toBe('search')
    // the pat's play keeps its own clock: the same picture, not a new one from the pose change
    const source=await svg(ui)
    console.log('C3_ACTIVE_TOUCH_TRACE '+JSON.stringify({at:w.clock.now(),pose:w.view().pose?.name,coco:label(source)}))
    expect(source).toBe(patted)
  })
  test('identified main permission keeps waiting and uses the exact900ms reduced touch cap',async($,on)=>{
    const w=world(on,{store:RECENT,settings:{prefersReducedMotion:true},ask:true,stepTools:[{id:'wait',name:'Read'}]})
    await $.session.start(START);; await settleLegacyStart($,w);await $.turn.start({text:'go',turnId:'wait-pat'});for await(const _ of $.turn.step({turnId:'wait-pat',index:0,model:'test',messageCount:1})){}
    await $.tool.check({tool:'Read',input:{file_path:'/tmp/a'},tool_use_id:'wait'});const ui=await $.ui.mount({surface:'desktop',...band(100,true)});expect(w.view().mood).toBe('waiting')
    await ui.press({key:PAT});expect(w.view().mood).toBe('waiting');await w.clock.advance(899);expect(await coco(ui)).toBe('A petted');await w.clock.advance(1);expect(await coco(ui)).toBe('A wait')
  })
  test('Off removes touch buttons and cancels every local touch deadline; its door restores the original face',async($,on)=>{
    const w=world(on,{store:RECENT,settings:{prefersReducedMotion:true}});let redraws=0;on('ui.invalidate',($,e,next)=>{redraws++;return next(e)})
    await $.session.start(START);; await settleLegacyStart($,w);const ui=await $.ui.mount({surface:'desktop',...band(100)});await ui.press({key:PAT});await $.command.run({command:'coco',args:'band off',origin:PERSON,presentation:P})
    expect(await ui.find({type:'Button',key:KEY})).toBeUndefined();expect(await ui.find({type:'Button',key:PAT})).toBeUndefined();const stopped=redraws;await w.clock.advance(10000);expect(redraws).toBe(stopped)
    await ui.press({key:'coco:band:wake'});expect(await coco(ui)).toBe('A idle')
  })
  test('exact approved per-language poke and burst fixtures remain intact',()=>{for(const{code}of LANGS){expect(LINES[code].poke).toEqual(APPROVED_PERSONA[code].poke);expect(LINES[code].poke_many).toEqual(APPROVED_PERSONA[code].poke_many)}})
  for(const{code}of LANGS)test(`${code}: random winks are silent, never consecutive, and spoken touches keep the approved line cycle`,{options:{language:code}},async($,on)=>{
    const w=world(on,{store:{...RECENT,lang:code},settings:{prefersReducedMotion:true}});await $.session.start(START);; await settleLegacyStart($,w);const ui=await $.ui.mount({surface:'desktop',...band(140)});expect(w.view().lang).toBe(code)
    let spoken=0,lastSilent=false
    for(let ordinal=1;ordinal<=9;ordinal++){
      await ui.press({key:KEY});const said=await speech(ui),silent=!APPROVED_PERSONA[code].poke.some(line=>said.includes(visibleStage(line)))
      // W1 order §1: each language keeps its own approved poke pool and cycle length.
      if(silent){expect(APPROVED_PERSONA[code].poke.some(line=>said.includes(visibleStage(line)))).toBe(false);expect(lastSilent).toBe(false)}else{const approved=APPROVED_PERSONA[code].poke[spoken%APPROVED_PERSONA[code].poke.length]!;expect(LINES[code].poke[spoken%APPROVED_PERSONA[code].poke.length]).toBe(approved);expect(said).toContain(visibleStage(approved));spoken++}
      lastSilent=silent
      await w.clock.advance(299);await ui.press({key:KEY});expect(await speech(ui)).toBe(said)
      await w.clock.advance(2701)
    }
    expect(spoken).toBeGreaterThan(0);expect(spoken).toBeLessThan(9)
    await ui.press({key:KEY});await w.clock.advance(300);await ui.press({key:KEY});await w.clock.advance(300);await ui.press({key:KEY})
    expect(await coco(ui)).toBe('A hood');expect(await speech(ui)).toContain(visibleStage(APPROVED_PERSONA[code].poke_many[0]!));await w.clock.advance(435);expect(await coco(ui)).toBe('A hood');await w.clock.advance(1764);expect(await coco(ui)).toBe('A hood');await w.clock.advance(1);expect(await coco(ui)).toBe('A idle')
    expect(await speech(ui)).toContain(visibleStage(APPROVED_PERSONA[code].poke_many[0]!));await w.clock.advance(400);expect((await speech(ui)).includes(visibleStage(APPROVED_PERSONA[code].poke_many[0]!))).toBe(false)
  })
  // 10-19 (owner): the desktop band is always painted at full size, so a stored pixel choice is petted at 64 pixels
  test('a stored compact choice is petted at full size on the desktop',{options:{band:'compact'}},async($,on)=>{
    const setupWorld=world(on,{store:{...RECENT,band:'compact'},settings:{prefersReducedMotion:true}});await $.session.start(START);; await settleLegacyStart($,setupWorld);const ui=await $.ui.mount({surface:'desktop',...band(100)});await ui.press({key:KEY});const picture=await svg(ui)
    expect(label(picture)).toBe('A petted');expect(picture).toContain('height="64"');expect(picture).not.toContain('@keyframes')
  })
})

test('a pending durable VIEW publication cannot hold back the touch face or band pulse',{timeoutMs:10000},async($,on)=>{
  let holding=false,held=0,pulses=0,finished=false
  const pending=new Promise<void>(()=>{})
  on('state.set',{key:'view'},async($,e,next)=>{if(holding){held++;await pending}return next(e)})
  on('state.set',{key:'bandWake'},($,e,next)=>{if(holding)pulses++;return next(e)})
  const w=world(on,{store:RECENT,settings:{prefersReducedMotion:true}})
  await $.session.start(START);await settleLegacyStart($,w);const ui=await $.ui.mount({surface:'desktop',...band(100)})
  await w.clock.advance(0)
  holding=true
  void $.turn.start({text:'go',turnId:'held-touch-view'}).then(()=>{finished=true},()=>{})
  for(let i=0;i<12;i++)await $.command.run({command:'b1c-host-boundary',args:'',origin:PERSON,presentation:P})
  expect(held).toBeGreaterThan(0);expect(finished).toBe(false)
  const before=pulses
  await ui.press({key:KEY})
  expect(pulses).toBeGreaterThan(before)
  expect(await coco(ui)).toBe('A petted')
  expect(finished).toBe(false)
})
