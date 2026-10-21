import {test,expect} from 'claude-code/testing'
import type {EngineInterface} from 'claude-code'
import {installM1Words} from './m1-more-data-fixture'
import {installModelServiceFixture} from './m1-model-service-fixture'
import {LINE_GROUPS,writtenLinesFrom,claudieUnsaid,installWritten,installEdited,useWritten,lineCells,linesText,linesFromText,libraryLines,shippedLines} from '../hooks/line-library'
import {initialView,linesFor,greetingFor} from '../hooks/mood'
import {LINES} from '../hooks/lines'
import {desktopBand,terminalBand} from '../hooks/band'
import {WORDS} from '../hooks/words'
import {MoreRuntime,LINES_WRITE_TOKENS} from '../hooks/more-runtime'
import {MorePage} from '../hooks/more-book'
import {moreModels} from '../hooks/more-models'
import {MORE_SLOTS} from '../hooks/more-words'
import {world} from './world'
installM1Words()
installModelServiceFixture()
const AT=Date.UTC(2026,9,17,12)
const nodes=(tree:any):any[]=>!tree||typeof tree!=='object'?[]:Array.isArray(tree)?tree.flatMap(nodes):[tree,...(tree.children??[]).flatMap(nodes)]
const text=(node:any):string=>typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.children??[]):''
const named=(tree:any):boolean=>nodes(tree).some(n=>n.type==='Text'&&text(n)===WORDS.en.name)
// a full set as lane B's prompt asks for it: every group, three lines each
const full=(line:(group:string,i:number)=>string)=>Object.fromEntries(LINE_GROUPS.map(group=>[group,[0,1,2].map(i=>line(group,i))]))
const PROMPTS={'more.model.lines.coco':'fixture coco instruction','more.model.lines.dake':'fixture dake instruction','more.model.lines.maid':'fixture maid instruction'}
const reset=()=>{useWritten(false);installEdited(undefined);for(const c of ['coco','dake','maid'] as const)installWritten(c,undefined)}

test('A written set keeps each group whole or not at all: three lines the band can show, whatever they say',()=>{
 const good=full((group,i)=>`${group} line ${i}`)
 expect(Object.keys(writtenLinesFrom(JSON.stringify(good))!)).toEqual([...LINE_GROUPS])
 expect(writtenLinesFrom('Here you go:\n'+JSON.stringify(good)+'\nEnjoy')?.start).toEqual(['start line 0','start line 1','start line 2'])
 expect(writtenLinesFrom('no json here')).toBe(undefined);expect(writtenLinesFrom('[1,2,3]')).toBe(undefined)
 const kept=writtenLinesFrom(JSON.stringify({...good,start:['fine','x'.repeat(49),'fine'],working:['one','two'],waiting:['ok','','ok'],pat:['ok','tab\there','ok']}))!
 for(const group of ['start','working','waiting','pat'])expect(kept[group]).toBe(undefined)
 expect(kept.fixed).toEqual(['fixed line 0','fixed line 1','fixed line 2'])
 // nothing is filtered for what it says (his 10-17: 「对台词生成不要有限制」), anyone may say 主人
 expect(writtenLinesFrom(JSON.stringify({...good,done:['杂鱼～','本天才搞定','主人,好了']}))?.done).toEqual(['杂鱼～','本天才搞定','主人,好了'])
 expect(lineCells('大'.repeat(24))).toBe(48)
 expect(writtenLinesFrom(JSON.stringify({...good,back:['大'.repeat(25),'a','b']}))?.back).toBe(undefined)
})

test('The library: Coco says the shipped lines as before; Claudie nothing until a written set is on; Coco mixes or not',()=>{
 reset()
 const coco={...initialView(),lang:'zh' as const},dake={...coco,claudie:'dake' as const}
 // the shipped lines, unchanged: the clingy set where it has one, English where a language has none, the greetings
 expect(linesFor(coco,'start')).toEqual(LINES.zh.start);expect(linesFor({...coco,affection:'clingy'},'start')).toEqual(LINES.zh.clingy.start)
 expect(linesFor({...coco,affection:'clingy'},'pat')).toEqual(LINES.zh.pat);expect(greetingFor(coco,8)).toEqual(LINES.zh.greeting.morning)
 expect(linesFor(dake,'start')).toEqual([])
 installWritten('dake',{start:['d1','d2','d3']});installWritten('coco',{start:['c1','c2','c3']})
 try{
  expect(linesFor(dake,'start')).toEqual([])
  useWritten(true,'both')
  expect(linesFor(dake,'start')).toEqual(['d1','d2','d3']);expect(linesFor(dake,'wild')).toEqual([])
  expect(linesFor(coco,'start')).toEqual([...LINES.zh.start,'c1','c2','c3'])
  // a written Coco set leaves the occasions it has none of to the shipped lines when mixed, to nothing alone
  expect(linesFor(coco,'wild')).toEqual(LINES.zh.wild)
  useWritten(true,'only')
  expect(linesFor(coco,'start')).toEqual(['c1','c2','c3']);expect(linesFor(coco,'wild')).toEqual([])
  // Coco's shipped lines as the person edited them
  useWritten(false);installEdited({start:['my own line'],'greeting.morning':['morning, mine']})
  expect(linesFor(coco,'start')).toEqual(['my own line']);expect(greetingFor(coco,8)).toEqual(['morning, mine']);expect(linesFor(coco,'wild')).toEqual([])
 }finally{reset()}
})

test('A set\'s text file reads back as written: notes and blank lines skipped, an occasion emptied says nothing',()=>{
 // a line that breaks in two on the band is written with \n where it breaks
 const set={start:['one','two'],'greeting.morning':['早'],'clingy.back':['回来啦'],poke:['戳我一下\n(￣ω￣)']}
 const file=linesText('How to edit:\n[occasion] then one line a line',set)
 expect(file.startsWith('# How to edit:\n# [occasion] then one line a line\n')).toBe(true)
 expect(linesFromText(file)).toEqual(set);expect(file).toContain('戳我一下\\n(￣ω￣)')
 expect(linesFromText('﻿# note\n\n[start]\n  spaced  \n# not a line\n[done]\n\n[bad key!]\nlost\n')).toEqual({start:['spaced'],done:[]})
 expect(Object.keys(shippedLines('ja'))).toContain('greeting.night');expect(Object.keys(shippedLines('ja'))).toContain('clingy.idle')
})

test('Coco\'s chatter is unsaid in Claudie\'s forms; reminders are not',()=>{
 for(const line of [{key:'two.first',class:0},{key:'week.ready',class:0},{key:'first.hello',class:2},{key:'commit.praise',class:1},{key:'commit.uwu',class:1}])expect(claudieUnsaid(line)).toBe(true)
 for(const line of [{key:'ambient',class:0},{key:'guard.rm',class:3},{key:'more.paste',class:3},{key:'long.done',class:1},{key:'stuck.loop',class:1},{key:'limit.out',class:1}])expect(claudieUnsaid(line)).toBe(false)
})

test('The band in Claudie\'s form writes no stage direction over the words, and the terminal, which draws Coco, still names Coco',async($,on)=>{
 const reminder={id:'r',key:'long.done',text:'fixture reminder line',class:1 as const,slots:[],expiresAt:AT+60000}
 let view:any={...initialView(),lang:'en',claudie:'dake',line:reminder,mood:'idle'}
 on('ui.render',{component:'Pane',requestId:'claudie-band'},($,e)=>e.surface==='terminal'?terminalBand($.ui.resolve(e) as any,view,{columns:100,maxRows:30,screenRows:48,isWorking:false}):desktopBand($.ui.resolve(e) as any,view,{columns:100,isWorking:false,maxRows:30,screenRows:48},'<svg width="76" height="64"></svg>'))
 world(on)
 for(const surface of ['desktop','terminal'] as const){
  const ui=await $.ui.mount({surface,plugin:'coco',component:'Pane',requestId:'claudie-band',props:{title:'Fixture',isFocused:true,bodyColumns:100,placement:'dock',scroll:{offset:0,bodyRows:30},view:{}}})
  expect(text(await ui.drawn())).toContain('fixture reminder line');expect(named(await ui.drawn())).toBe(surface==='terminal')
  await ui.unmount()
 }
 view={...view,claudie:undefined}
 const ui=await $.ui.mount({surface:'desktop',plugin:'coco',component:'Pane',requestId:'claudie-band',props:{title:'Fixture',isFocused:true,bodyColumns:100,placement:'dock',scroll:{offset:0,bodyRows:30},view:{}}})
 expect(named(await ui.drawn())).toBe(true)
 await ui.unmount()
})

// An engine with a small file system whose files carry a modification time, as $.fs.stat reports it.
function engine(reply:string|Error|((request:{system:string;prompt:string})=>string)){
 const calls:{name:string;args:unknown[]}[]=[],stored:Record<string,unknown>={},files:Record<string,{text:string;mtimeMs:number}>={}
 let clock=AT
 const $={
  clock:{now:async()=>AT,after:()=>({cancel:()=>{}})},
  store:{get:async(key:string)=>stored[key],set:async(key:string,value:unknown)=>{calls.push({name:'store.set',args:[key,value]});stored[key]=structuredClone(value)}},
  model:{complete:async(request:{system:string;prompt:string})=>{calls.push({name:'model.complete',args:[request]});if(reply instanceof Error)throw reply;return{isAnswered:true,text:typeof reply==='function'?reply(request):reply,usage:{input_tokens:900,output_tokens:1500,cache_read_input_tokens:0,cache_creation_input_tokens:0}}}},
  fs:{
   exists:async(path:string)=>path in files,
   read:async(path:string)=>{calls.push({name:'fs.read',args:[path]});if(!(path in files))throw Error('missing');return files[path]!.text},
   write:async(path:string,text:string)=>{calls.push({name:'fs.write',args:[path,text]});files[path]={text,mtimeMs:++clock}},
   stat:async(path:string)=>{calls.push({name:'fs.stat',args:[path]});if(!(path in files))throw Error('missing');return{kind:'file',size:files[path]!.text.length,mtimeMs:files[path]!.mtimeMs,isLink:false}},
  },
  ui:{invalidate:()=>{},log:()=>{}},
 } as unknown as EngineInterface
 // the person saving the file in their editor
 const save=(path:string,text:string)=>{files[path]={text,mtimeMs:++clock}}
 return{$,calls,stored,files,save}
}
const bindings=(opened:string[],open=true)=>({linesFolder:()=>'/home/fixture/.config/coco/lines',openFile:async(path:string)=>{opened.push(path);return open},characterName:(c:string)=>({coco:'Coco',dake:'Claudie',maid:'Maid Claudie'} as Record<string,string>)[c]!})

test('On: the character worn gets one set written with the picked model in the picked language, kept, and written again on Write again',async()=>{
 const f=engine(request=>JSON.stringify(full((group,i)=>`${request.system.split(' ')[1]} ${group} ${i}`)))
 const r=new MoreRuntime(PROMPTS);r.restore({lines:true},['lines'],undefined,AT);r.setModels(moreModels({}),undefined)
 try{
  // Coco first: written, said mixed with the shipped lines
  await r.lines(f.$)
  const request=f.calls.find(call=>call.name==='model.complete')!.args[0] as {model:string;system:string;prompt:string;maxTokens:number}
  expect(request).toMatchObject({model:'haiku',system:'fixture coco instruction',prompt:'Write in English.',maxTokens:LINES_WRITE_TOKENS})
  expect(r.snapshot().lines).toEqual({character:'coco',lang:'en',mix:'both',state:'ready'})
  expect(linesFor({...initialView(),lang:'en'},'pat')).toEqual([...LINES.en.pat,'coco pat 0','coco pat 1','coco pat 2'])
  // maid Claudie, in Traditional Chinese: a set of hers
  r.setLinesForm('maid');r.configure('zh-Hant');await r.lines(f.$)
  expect((f.calls.filter(call=>call.name==='model.complete').at(-1)!.args[0] as {system:string;prompt:string})).toMatchObject({system:'fixture maid instruction',prompt:'Write in Chinese (Traditional).'})
  expect(linesFor({...initialView(),lang:'zh-Hant',claudie:'maid'},'pat')).toEqual(['maid pat 0','maid pat 1','maid pat 2'])
  expect(Object.keys((f.stored['more.lines'] as {sets:object}).sets).sort()).toEqual(['coco:en','maid:zh-Hant'])
  // kept: asked again nothing is written; Write again writes anew
  const writes=()=>f.calls.filter(call=>call.name==='model.complete').length,before=writes()
  expect(r.lines(f.$)).toBe(undefined)
  expect(await r.press(f.$,'coco:more:lines:redo')).toBe(true);expect(writes()).toBe(before+1)
  // a language picked for the lines: Japanese has no set yet, so it is written now
  expect(await r.press(f.$,'coco:more:lines:lang:ja')).toBe(true)
  expect((f.calls.filter(call=>call.name==='model.complete').at(-1)!.args[0] as {prompt:string}).prompt).toBe('Write in Japanese.')
  expect((f.stored['more.lines'] as {lang:string}).lang).toBe('ja')
  // off: written sets are not said, and are kept; the next session says them again
  await r.press(f.$,'coco:more:lines:off')
  expect(linesFor({...initialView(),lang:'ja',claudie:'maid'},'pat')).toEqual([])
  const next=new MoreRuntime(PROMPTS);next.restore({lines:true},['lines'],undefined,AT);next.restoreLines(f.stored['more.lines'])
  expect(linesFor({...initialView(),lang:'ja',claudie:'maid'},'pat')).toEqual(['maid pat 0','maid pat 1','maid pat 2'])
 }finally{reset()}
})

test('Coco alone or mixed; a failed write keeps nothing and waits; on another service nothing is written before a pick',async()=>{
 const f=engine(JSON.stringify(full((group,i)=>`w ${group} ${i}`))),r=new MoreRuntime(PROMPTS);r.restore({lines:true},['lines'],undefined,AT)
 try{
  await r.lines(f.$)
  expect(await r.press(f.$,'coco:more:lines:mix:only')).toBe(true)
  expect(linesFor({...initialView(),lang:'en'},'pat')).toEqual(['w pat 0','w pat 1','w pat 2']);expect(linesFor({...initialView(),lang:'en'},'wild')).toEqual([])
  expect((f.stored['more.lines'] as {mix:string}).mix).toBe('only')
  for(const reply of ['not json',new Error('fixture network')]){
   const g=engine(reply),s=new MoreRuntime(PROMPTS);s.restore({lines:true},['lines'],undefined,AT);s.setLinesForm('dake')
   await s.lines(g.$)
   expect(g.stored['more.lines']).toBe(undefined);expect(s.snapshot().lines?.state).toBe('failed');expect(s.lines(g.$)).toBe(undefined)
  }
  const h=engine('{}'),own=new MoreRuntime(PROMPTS);own.restore({lines:true},['lines'],undefined,AT);own.setModels(moreModels({base:'https://gw.example.invalid',main:'glm-4.6'}),undefined)
  expect(own.isOn('lines')).toBe(false);expect(own.lines(h.$)).toBe(undefined);expect(h.calls).toEqual([])
 }finally{reset()}
})

test('Edit opens the set\'s file, written from what is said if new; what the person saves is said next; Restore and Let go',async()=>{
 const opened:string[]=[],f=engine(JSON.stringify(full((group,i)=>`w ${group} ${i}`)))
 const r=new MoreRuntime(PROMPTS,bindings(opened));r.restore({},[],undefined,AT);r.configure('zh');r.restoreLines(undefined)
 const coco={...initialView(),lang:'zh' as const}
 try{
  // a file never opened is never looked at
  await r.refreshLines(f.$);expect(f.calls.filter(call=>call.name.startsWith('fs.'))).toEqual([])
  // the shipped lines can be edited with the row off
  expect(await r.press(f.$,'coco:more:lines:edit:shipped')).toBe(true)
  const shippedPath='/home/fixture/.config/coco/lines/coco-shipped-zh.txt'
  expect(opened).toEqual([shippedPath]);expect(linesFromText(f.files[shippedPath]!.text)).toEqual(shippedLines('zh'))
  expect(r.snapshot().lines?.paths).toEqual({shipped:shippedPath})
  // nothing saved yet: what is said stands; saved: said from the next line on, with only a stat when nothing changed
  await r.refreshLines(f.$);expect(linesFor(coco,'start')).toEqual(LINES.zh.start)
  f.save(shippedPath,'# mine\n[start]\n开工开工\n')
  await r.refreshLines(f.$);expect(linesFor(coco,'start')).toEqual(['开工开工']);expect(linesFor(coco,'wild')).toEqual([])
  // the next session looks at the opened file again and reads the saved lines
  const next=new MoreRuntime(PROMPTS,bindings(opened));next.restore({},[],undefined,AT);next.configure('zh');next.restoreLines(f.stored['more.lines'])
  expect((f.stored['more.lines'] as {opened?:string[]}).opened).toEqual(['shipped:zh'])
  await next.refreshLines(f.$);expect(linesFor(coco,'start')).toEqual(['开工开工'])
  const reads=f.calls.filter(call=>call.name==='fs.read').length
  await r.refreshLines(f.$);expect(f.calls.filter(call=>call.name==='fs.read').length).toBe(reads)
  // Restore: the shipped lines as we ship them, the file written back
  expect(await r.press(f.$,'coco:more:lines:restore:shipped')).toBe(true)
  expect(linesFor(coco,'start')).toEqual(LINES.zh.start);expect(linesFromText(f.files[shippedPath]!.text)).toEqual(shippedLines('zh'))
  await r.refreshLines(f.$);expect(linesFor(coco,'start')).toEqual(LINES.zh.start)
  // a written set: edited, restored to as written, let go
  r.setLinesForm('dake');r.restore({lines:true},['lines'],undefined,AT);await r.lines(f.$)
  const dake={...coco,claudie:'dake' as const},dakePath='/home/fixture/.config/coco/lines/dake-generated-zh.txt'
  expect(await r.press(f.$,'coco:more:lines:edit:generated')).toBe(true);expect(opened.at(-1)).toBe(dakePath)
  f.save(dakePath,'[pat]\n摸摸\n')
  await r.refreshLines(f.$);expect(linesFor(dake,'pat')).toEqual(['摸摸'])
  expect(await r.press(f.$,'coco:more:lines:restore:generated')).toBe(true);expect(linesFor(dake,'pat')).toEqual(['w pat 0','w pat 1','w pat 2'])
  expect(await r.press(f.$,'coco:more:lines:drop')).toBe(true);expect(linesFor(dake,'pat')).toEqual([])
  expect((f.stored['more.lines'] as {sets:object}).sets).toEqual({})
  // the editor could not open: the file is still written and its place said
  const closed:string[]=[],s=new MoreRuntime(PROMPTS,bindings(closed,false));s.restore({},[],undefined,AT);s.configure('zh')
  await s.press(f.$,'coco:more:lines:edit:shipped');expect(s.snapshot().lines?.editFailed).toBe('shipped')
 }finally{reset()}
})

test('The book: Coco\'s shipped lines can be edited with the row off; on, the written set, Coco\'s mix and the language',async($,on)=>{
 const words:Record<string,string>={'more.lines.label':'fixture lines','more.lines.shipped':'fixture shipped','more.lines.generated':'fixture written','more.lines.edit':'fixture edit','more.lines.restore':'fixture restore','more.lines.redo':'fixture again','more.lines.generate':'fixture write','more.lines.done':'fixture done','more.lines.drop':'fixture let go','more.lines.mix':'fixture mix','more.lines.mix.only':'fixture only','more.lines.mix.both':'fixture both','more.lines.path':'fixture at {path}',...PROMPTS}
 for(const [key,value] of Object.entries(words))MORE_SLOTS[key]={en:value}
 let snapshot:any={values:{},agreed:[],today:{date:'',rows:{}},reading:0,open:true,lang:'en',screenReader:false,models:{...moreModels({}),picks:{}},lines:{character:'coco',lang:'en',mix:'both',state:'none',paths:{shipped:'/fixture/coco-shipped-en.txt'}}}
 on('ui.render',{component:'Pane',requestId:'lines-row'},($,e)=>MorePage($.ui.resolve(e) as any,{surface:e.surface,snapshot}))
 const pane={surface:'mobile' as const,plugin:'coco',component:'Pane' as const,requestId:'lines-row',props:{title:'Fixture',isFocused:true,bodyColumns:100,placement:'dock' as const,scroll:{offset:0,bodyRows:400},view:{}}}
 try{
  let ui=await $.ui.mount(pane)
  for(const key of ['coco:more:lines:edit:shipped','coco:more:lines:restore:shipped','coco:more:lines:on'])expect(await ui.find({type:'Button',key})).toBeDefined()
  expect(await ui.find({type:'Text',text:'fixture at /fixture/coco-shipped-en.txt'})).toBeDefined()
  expect(await ui.find({type:'Button',key:'coco:more:lines:redo'})).toBeUndefined()
  await ui.unmount()
  snapshot={...snapshot,values:{lines:true},agreed:['lines'],lines:{...snapshot.lines,state:'ready'}}
  ui=await $.ui.mount(pane)
  for(const key of ['coco:more:lines:redo','coco:more:lines:edit:generated','coco:more:lines:restore:generated','coco:more:lines:drop','coco:more:lines:mix:only','coco:more:lines:lang:ja','coco:more:lines:model:0'])expect(await ui.find({type:'Button',key})).toBeDefined()
  expect((await ui.find({type:'Button',key:'coco:more:lines:mix:both'}))?.props.variant).toBe('primary')
  expect(await ui.find({type:'Text',text:'fixture done'})).toBeDefined()
  await ui.unmount()
  // in Claudie's form there is no shipped set to edit
  snapshot={...snapshot,lines:{...snapshot.lines,character:'dake'}}
  ui=await $.ui.mount(pane)
  expect(await ui.find({type:'Button',key:'coco:more:lines:edit:shipped'})).toBeUndefined();expect(await ui.find({type:'Button',key:'coco:more:lines:mix:only'})).toBeUndefined()
  expect(await ui.find({type:'Button',key:'coco:more:lines:edit:generated'})).toBeDefined()
  await ui.unmount()
 }finally{for(const key of Object.keys(words))delete MORE_SLOTS[key]}
})
