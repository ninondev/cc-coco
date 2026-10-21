import { expect, test } from 'claude-code/testing'
import { loadRoomLayers,roomState,roomLayerNames,roomAlt,roomScale,roomSvg,roomCacheSize,forgetRoom } from '../hooks/d1-room'
import { loadD1Words,d1Word,d1Words,d1Text,d1MissingWords,forgetD1Words } from '../hooks/d1-words'
import { selectRibbon,rememberRibbon,reconcileRibbon,ribbonSvg,ribbonTerminal,ribbonFolder,RIBBON_PALETTE } from '../hooks/d1-ribbon'
import { reminderSettings } from '../hooks/reminder-settings'
import { helperBoard,pageBlocks } from '../hooks/book'
import type { BookData } from '../hooks/book'
import type { Helper } from '../hooks/d1-runtime'
import { BOOK_TEXT } from '../hooks/book-text'
import { WORDS } from '../hooks/words'
import type { EngineInterface } from 'claude-code'
import { D1_ROOM_ASSET_FILES } from './d1-room-assets-fixture'
import { D1_WORDS_TEXT } from './d1-room-fixture'
import { loadD1Art } from '../hooks/d1-art-data'
import { D1_ART_FILES } from './d1-art-fixture'
const at=(hour:number)=>Date.UTC(2026,9,6,hour)
const data:BookData={view:undefined,usage:undefined,store:{},now:at(12),timeZone:'UTC',reducedMotion:false,marks:'replies',voiceSizes:{light:1,full:1},fortune:undefined,reading:0,own:WORDS.en}
async function words(){await loadD1Words(async()=>D1_WORDS_TEXT)}

test('D1 room: the local hour, calm poses, a sock on the line per pair, the thermos while warm, the lamp lit at night',()=>{
  for(const [hour,expected] of [[5,'night'],[6,'day'],[16,'day'],[17,'eve'],[18,'eve'],[19,'night']] as const)expect(roomState(at(hour),'UTC',false,false).hour).toBe(expected)
  const state=roomState(at(20),'UTC',false,true,{socks:['matcha','taro'],warm:true})
  expect(state.pose).toBe('writing')
  expect(roomState(at(20),'UTC',true,true).pose).toBe('asleep')
  // typing on the floor, they have the laptop with them
  expect(roomLayerNames(state)).toEqual(['sky-night','room-night','line','sock-matcha#0','sock-taro#1','ac','notes','lamp-night','mug','thermos','duck','teapot','flowers','mirror','box','cup','lamp-light','her-type'])
  expect(roomLayerNames(roomState(at(7),'UTC',false,false))).toEqual(['sky-day','room-day','line','ac','notes','lamp-day','mug','laptop','duck','teapot','flowers','mirror','box','cup','her-stand'])
  expect(roomState(at(7),'UTC',false,false,{socks:Array.from({length:14},(_,i)=>`p${i}`)}).socks.length).toBe(12)
  expect(roomScale(339)).toBe(1);expect(roomScale(340)).toBe(2)
})
test('D1 room: Claudie (either dress) or the whale girl stands all day in Coco\'s place, laptop on the desk; Coco or anything else keeps Coco',()=>{
  const tail=(form:unknown,asleep=false,running=false)=>roomLayerNames(roomState(at(20),'UTC',asleep,running,{form})).slice(-3)
  for(const [asleep,running] of [[false,false],[false,true],[true,false]] as const){
    expect(tail('dake',asleep,running)).toEqual(['cup','lamp-light','claudie-stand'])
    expect(tail('maid',asleep,running)).toEqual(['cup','lamp-light','claudie-stand'])
    expect(tail('fish',asleep,running)).toEqual(['cup','lamp-light','fish-stand'])
    expect(roomLayerNames(roomState(at(20),'UTC',asleep,running,{form:'fish'}))).toContain('laptop')
  }
  expect(tail('coco',false,true)).toEqual(['cup','lamp-light','her-type'])
  expect(tail('nope',true)).toEqual(['cup','lamp-light','her-sleep'])
  expect(roomState(at(20),'UTC',false,false,{form:'coco'}).form).toBeUndefined()
  for(const name of ['claudie-stand','fish-stand'])expect(D1_ROOM_ASSET_FILES[`${name}@1.png`]).toBeDefined()
})
test('D1 room alt says the hour, the pose and the things that change, and none of the old room\'s things',async()=>{
  await words()
  const alt=roomAlt(roomState(at(20),'UTC',false,false,{socks:['matcha'],warm:true}),d1Words('en'))
  expect(alt).toBe("Coco's room at night: Coco is standing. Also in the room: one sock on the clothesline; a thermos on the desk; the desk lamp, lit.")
  expect(roomAlt(roomState(at(20),'UTC',false,true,{socks:['matcha','pink']}),d1Words('en'))).toContain('2 socks on the clothesline')
  expect(roomAlt(roomState(at(9),'UTC',false,false),d1Words('en'))).toBe("Coco's room by day: Coco is standing.")
  // 10-19: whoever stands in the room is the one named
  expect(roomAlt(roomState(at(9),'UTC',false,true,{form:'maid'}),d1Words('en'))).toBe("Coco's room by day: Claudie is standing.")
  expect(roomAlt(roomState(at(9),'UTC',true,false,{form:'fish'}),d1Words('en'))).toBe("Coco's room by day: DeepSeek-chan is standing.")
  expect(roomAlt(roomState(at(9),'UTC',false,false,{form:'fish'}),d1Words('zh'))).not.toContain('{who}')
  for(const old of ['notebook','cushion','paper lamp','kettle','scroll','sprout','Shiori'])expect(alt).not.toContain(old)
  expect(d1Word('en','helpers.toolUses',{n:1},1)).toBe('1 tool use')
  expect(d1Word('en','helpers.toolUses',{n:2},2)).toBe('2 tool uses')
})
test('D1 source missing translations fall back to English and are receipted',()=>{
  expect(d1Text({lang:'zz',entries:{'x':{en:{one:'1',other:'{n}'}}}},'x',{n:2},2)).toBe('2')
  expect(d1MissingWords()).toContain('zz:x')
  expect(d1Text({lang:'fr',entries:{x:{en:{one:'one',other:'other'}}}},'x',{n:0},0)).toBe('other')
})
test('D1 deferred words lookup is empty until source load without reporting a missing source translation',async()=>{
  const before=[...d1MissingWords()];forgetD1Words()
  expect(d1Word('ja','settings.saving')).toBe('');expect(d1MissingWords()).toEqual(before)
  await words();expect(d1Word('ja','settings.saving')).toBe(JSON.parse(D1_WORDS_TEXT)['settings.saving'].ja)
  expect(d1MissingWords()).toEqual(before)
})
test('D1 closed room drops pictures and does not build without explicitly loaded layers',()=>{
  forgetRoom();expect(roomCacheSize()).toBe(0)
  expect(roomSvg(roomState(at(7),'UTC',false,false),2)).toBe('')
  expect(roomCacheSize()).toBe(0)
})
test('D1 ribbon choices are sticky, distinct through fourteen, bounded and younger claim resolves collision',()=>{
  expect(selectRibbon(5,[1,2])).toBe(5);expect(selectRibbon(5,[5])).toBe(1)
  expect(selectRibbon(undefined,[1,2,3,4,5,6,7])).toBe(8)
  expect(selectRibbon(undefined,Array.from({length:14},(_,i)=>i+1))).toBe(1)
  let map:Record<string,number>={};for(let i=0;i<65;i++)map=rememberRibbon(map,`folder${i}`,i%14+1)
  expect(Object.keys(map).length).toBe(64);expect(map.folder0).toBeUndefined()
  expect(rememberRibbon(map,'folder1',3).folder1).toBe(2)
  const older={id:'a',at:1,ribbon:1},younger={id:'b',at:2,ribbon:1}
  expect(reconcileRibbon(older,[older,younger])).toBe(1)
  expect(reconcileRibbon(younger,[older,younger])).toBe(2)
  expect(ribbonFolder('/home/me','/home/me')).toBe('~')
  expect(ribbonFolder('C:\\work\\client\\')).toBe('client')
})
test('D1 ribbon palette, CSS tie times, patterned cue and terminal cells are exact',async()=>{
  await loadD1Art('ribbon',path=>Promise.resolve(D1_ART_FILES[path]!))
  expect(RIBBON_PALETTE.map(p=>p[0])).toEqual(['#2E5C8A','#8C6100','#5F5E66','#3F7A2E','#0F6F78','#A8366F','#6A4FA0'])
  const source=ribbonSvg(8,50,true)
  expect(source).toContain('viewBox="0 0 12 50"');expect(source).toContain('class="p"')
  expect(source).toContain('forced-color-adjust:none')
  for(const clock of ['200ms','300ms','110ms','520ms','390ms','prefers-reduced-motion:reduce'])expect(source).toContain(clock)
  expect(ribbonSvg(1,50)).not.toContain('@keyframes')
  const resumed=ribbonSvg(1,50,true,12,120)
  expect(resumed).toContain('200ms cubic-bezier(0,0,.2,1) -120ms')
  expect(resumed).toContain('300ms cubic-bezier(0,0,.2,1) -10ms')
  expect(resumed).toContain('520ms cubic-bezier(.37,0,.63,1) 270ms')
  expect(ribbonTerminal(1,false)).toEqual({color:25,rows:['●','▐','▐','▐','▐','▐','▝']})
})
test('D1 simultaneous same-index claims reconcile once without cascading younger recolours',()=>{
 for(const n of [3,7,14]){
  const claims=Array.from({length:n},(_,i)=>({id:`session-${String(i).padStart(2,'0')}`,at:100,ribbon:1}))
  const canonical=claims.map(own=>({...own,ribbon:reconcileRibbon(own,[...claims].reverse())}))
  expect(canonical.map(c=>c.ribbon)).toEqual(Array.from({length:n},(_,i)=>i+1))
  expect(canonical.map(own=>reconcileRibbon(own,canonical))).toEqual(canonical.map(c=>c.ribbon))
  const mixed=claims.map(c=>({...c})),changes=new Map(claims.map(c=>[c.id,0]))
  for(const own of [...mixed].reverse()){
   const next=reconcileRibbon(own,mixed)
   if(next!==own.ribbon)changes.set(own.id,changes.get(own.id)!+1)
   own.ribbon=next
  }
  for(const own of mixed){const next=reconcileRibbon(own,mixed);if(next!==own.ribbon)changes.set(own.id,changes.get(own.id)!+1);own.ribbon=next}
  expect(mixed.map(c=>c.ribbon)).toEqual(canonical.map(c=>c.ribbon));expect([...changes.values()].every(n=>n<=1)).toBe(true)
 }
 const first={id:'a',at:1,ribbon:1},second={id:'b',at:1,ribbon:1},third={id:'c',at:1,ribbon:1},distinct={id:'d',at:1,ribbon:2},live=[first,second,third,distinct]
 expect(live.map(own=>reconcileRibbon(own,live))).toEqual([1,3,4,2])
})
// BOOK F10 (10-09): a token count below ten thousand is written with its digits grouped (2,200), above it in the compact form (12K).
test('D1 board engine totals win, descendants follow their parent, six rows and earlier totals',async()=>{
  await words()
  const helpers:Helper[]=Array.from({length:8},(_,i)=>({agentId:`h${i}`,description:`job ${i}`,type:'general',startedAt:i*100,endedAt:1000,toolUses:99,tokens:50,state:'done',...(i===7?{parentAgentId:'h0'}:{}),...(i===0?{engineTotals:{tokens:2000,durationMs:130000,toolUses:1}}:{})}))
  const blocks=helperBoard({...data,d1:{helpers,earlier:{count:1,tokens:100},totalTokens:4000,mainHelpers:0,runningHelpers:0}},BOOK_TEXT.en)
  expect(blocks.filter(b=>b.t==='helper').length).toBe(6)
  expect(blocks.some(b=>b.t==='para' && b.text==='and 3 earlier, 2,150 tokens')).toBe(true)
  const exact=helperBoard({...data,d1:{helpers:[helpers[0]!],earlier:{count:0,tokens:0},totalTokens:4000,mainHelpers:0,runningHelpers:0}},BOOK_TEXT.en)
  expect(exact.find(b=>b.t==='helper')).toMatchObject({text:'general, 2,000 tokens in 2m 10s (1 tool use)'})
  const active=helperBoard({...data,now:10000,d1:{helpers:[{...helpers[0]!,startedAt:0,endedAt:undefined,engineTotals:undefined,state:'running',toolUses:0}],earlier:{count:0,tokens:0},totalTokens:0,mainHelpers:1,runningHelpers:1}},BOOK_TEXT.en)
  expect(active.find(b=>b.t==='helper')).toMatchObject({text:'working, 10s so far'})
  // BOOK F3: an unknown share is left out, never written as a dash
  expect(active.find(b=>b.t==='para')).toBeUndefined()
  const nested=helperBoard({...data,d1:{helpers:[helpers[0]!,helpers[7]!],earlier:{count:0,tokens:0},totalTokens:4000,mainHelpers:0,runningHelpers:0}},BOOK_TEXT.en).filter(b=>b.t==='helper')
  expect(nested.map(b=>b.t==='helper'?b.description:'')).toEqual(['job 0','job 7'])
  expect(nested[1]).toMatchObject({nested:true})
})
test('D1 settings additions are in order with band default, trim Off, source copy and every Off way back',async()=>{
  await words();expect(reminderSettings({}).longTask).toBe('band');expect(reminderSettings({}).trim).toBe(false)
  const blocks=pageBlocks('settings',BOOK_TEXT.en,data,'desktop')
  const keys=blocks.flatMap(b=>b.t==='choice'?b.options.map(o=>o.key):[])
  expect(keys).toContain('coco:set:longtask:off');expect(keys).toContain('coco:set:longtask:band')
  expect(keys).not.toContain('coco:set:longtask:notify')
  expect(keys).toContain('coco:set:trim:off');expect(keys).toContain('coco:set:trim:on')
  const long=blocks.findIndex(b=>b.t==='choice' && b.label===d1Word('en','settings.longTask.label'))
  const saving=blocks.findIndex(b=>b.t==='heading' && b.text===d1Word('en','settings.saving'))
  expect(saving).toBeGreaterThan(long)
  const evidenceTemplate=JSON.parse(D1_WORDS_TEXT)['settings.trim.evidence'].en as string
  const evidence=d1Word('en','settings.trim.evidence',{p:37}),evidenceSuffix=evidenceTemplate.split('{p}')[1]!
  expect(evidence).toBe(evidenceTemplate.replace('{p}','37'));expect(evidence.length).toBeGreaterThan(0);expect(evidenceSuffix.length).toBeGreaterThan(0)
  expect(blocks.some(b=>b.t==='note' && b.text.includes(evidenceSuffix))).toBe(false)
  const denied={...data,d1NotifyAvailable:true,d1NotificationDenied:true,store:{longTask:'band'}}
  expect(pageBlocks('settings',BOOK_TEXT.en,denied,'desktop').some(b=>b.t==='button' && b.key==='coco:longtask:settings')).toBe(true)
  expect(pageBlocks('settings',BOOK_TEXT.en,{...denied,store:{longTask:'off'}},'desktop').some(b=>b.t==='button' && b.key==='coco:longtask:settings')).toBe(false)
  const mobile=pageBlocks('settings',BOOK_TEXT.en,{...denied,store:{longTask:'notify'}},'mobile')
  expect(mobile.some(b=>b.t==='button' && b.key==='coco:longtask:settings')).toBe(false)
  expect(mobile.find(b=>b.t==='choice' && b.label===d1Word('en','settings.longTask.label'))).toMatchObject({current:'band'})
})

test('D1 approved room layers load only on explicit request, cache exact effective inputs and close releases all',async()=>{
  forgetRoom();const reads:string[]=[]
  const engine={plugin:{root:'/fixture'},fs:{read:async(path:string,options?:{as:string})=>{reads.push(path);const source=D1_ROOM_ASSET_FILES[path.split(/[\\/]/).pop()!]!;return options?{base64:source}:source}}} as unknown as EngineInterface
  expect(reads).toEqual([]);await loadRoomLayers(engine)
  const count=reads.length,all=['matcha','blueberry','sesame','mint','strawberry','taro','marshmallow','goodgirl','nude','lan','whitehat','reddot']
  const state=roomState(at(20),'UTC',false,true,{socks:all,warm:true})
  const source=roomSvg(state,2)
  expect(source).toContain('forced-color-adjust:none')
  expect(source).toContain('color-interpolation-filters="sRGB"')
  expect(source).toContain('0.70 0 0 0 0 0 0.72 0 0 0 0 0 0.84')
  expect(source.match(/<image /g)?.length).toBe(28)
  // a full line hangs close, a few socks wide apart
  expect(source).toContain('<image x="46" y="9" width="4" height="8"')
  expect(roomSvg(roomState(at(20),'UTC',false,true,{socks:['matcha','taro']}),2)).toContain('<image x="19" y="9" width="4" height="8"')
  expect(source.length).toBeLessThan(131072)
  expect(roomCacheSize()).toBe(2)
  expect(roomSvg({...state},2)).toBe(source)
  expect(roomCacheSize()).toBe(2);expect(reads.length).toBe(count)
  forgetRoom();expect(roomCacheSize()).toBe(0);expect(roomSvg(state,2)).toBe('')
})
test('D1 closing during layer IO rejects late completion without keeping room data',async()=>{
  forgetRoom();let release:()=>void=()=>{};const gate=new Promise<void>(resolve=>{release=resolve})
  const engine={plugin:{root:'/fixture'},fs:{read:async(path:string,options?:{as:string})=>{if(path.endsWith('layers.json'))await gate;const source=D1_ROOM_ASSET_FILES[path.split(/[\\/]/).pop()!]!;return options?{base64:source}:source}}} as unknown as EngineInterface
  const loading=loadRoomLayers(engine);forgetRoom();release();await loading
  expect(roomSvg(roomState(at(7),'UTC',false,false),2)).toBe('');expect(roomCacheSize()).toBe(0)
})
