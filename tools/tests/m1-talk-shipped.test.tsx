import {expect,test} from 'claude-code/testing'
import {world,settleLegacyStart,RECENT,MORNING,P,PERSON} from './world'
import {M1_MORE_TEXT} from './m1-more-data-fixture'
import {C3_WORDS_RAW} from './c3-words-fixture'
import {C3_HEAD_MANIFEST} from './c3-head-assets'
import {splitTalkReply,talkPause,TALK_GAP_MIN} from '../hooks/talk-parts'

// Talk end to end on the shipped words only (persona-1010-v4, groups-i-1010; DECISIONS 10-10) with a stand-in
// model: off by default, one ask turns it on, one Send is one call with the owner's persona and no token cap (10-17).
const SHIPPED=JSON.parse(M1_MORE_TEXT) as Record<string,Record<string,string>>
const START={cwd:'/tmp/m1-talk-shipped-fixture',surface:'terminal' as const,isInteractive:true}
const PANE={surface:'terminal' as const,plugin:'coco',component:'Pane' as const,requestId:'coco-book',props:{title:'Fixture',isFocused:true,bodyColumns:100,placement:'dock' as const,scroll:{offset:0,bodyRows:100},view:{}},viewport:{columns:100,rows:100}}
const USAGE={input_tokens:900,output_tokens:40,cache_read_input_tokens:0,cache_creation_input_tokens:0}

type TalkWorld={surfaces?:('terminal'|'desktop')[];settings?:Record<string,unknown>;env?:Record<string,string>;repo?:unknown}
export function talkWorld(on:Parameters<typeof world>[0],reply:()=>string=()=>'fixture reply',extra:TalkWorld={}){
 const requests:{system?:string;maxTokens?:number;model?:string;prompt?:string}[]=[],reached:string[]=[],others:string[]=[]
 on('prompt.*',($,e,next)=>{if(next.is('prompt.submit',e))reached.push(e.text);return next(e)})
 on('model.complete',($,e)=>{requests.push({system:e.system,maxTokens:e.maxTokens,model:e.model,prompt:e.prompt});return{value:{isAnswered:true,text:reply(),usage:USAGE}}})
 on('model.classify',()=>{others.push('model.classify');return{value:'chat'}})
 on('model.fork',()=>{others.push('model.fork');return{deny:'unexpected fixture fork'}})
 on('http.fetch',()=>{others.push('http.fetch');return{deny:'unexpected fixture network request'}})
 on('agent.list',()=>({value:[]}));on('session.messages',()=>({value:[]}));on('session.model',()=>({value:'fixture model'}));on('session.repo',()=>({value:(extra.repo??null) as never}));on('session.turns',()=>({value:1}))
 on('fs.write',()=>({value:undefined}));on('process.run',()=>({value:{exitCode:0,stdout:'{"ok":true,"result":{},"ensured":true,"claimed":true}',stderr:'',isStdoutTruncated:false,isStderrTruncated:false}}))
 const w=world(on,{surfaces:extra.surfaces??['terminal'],settings:extra.settings,env:{HOME:'/tmp/m1-talk-shipped-fixture-home',LANG:'en_US.UTF-8',TERM:'xterm-256color',...extra.env},moreText:M1_MORE_TEXT,store:{...RECENT,firstMet:MORNING,bandSettings:{voice:'off',voiceChosen:true,band:'off',guard:false,bookmark:false,notes:false}},readText:path=>path.endsWith('c3-text.json')?C3_WORDS_RAW:path.endsWith('frame-manifest.json')?JSON.stringify(C3_HEAD_MANIFEST):undefined})
 return {w,requests,reached,others}
}

test('M1 O1 actual Talk on the shipped words: off by default, one ask turns it on, the disclosure heads the tab, one Send is one call with the persona and no token cap, and «sama,» routes',async($,on)=>{
 const f=talkWorld(on);await $.session.start(START);await settleLegacyStart($,f.w)
 const open=(args:string)=>$.command.run({command:'coco',args,origin:PERSON,presentation:P})
 // Off by default: a replay of 50 prompts, «sama,» among them, all reach the session and call no model.
 for(let i=0;i<50;i++){const text=i%10===0?'sama, prompt '+i:'fixture prompt '+i;await $.prompt.submit({text,wait:false,origin:PERSON})}
 await settleLegacyStart($,f.w)
 expect(f.requests).toEqual([]);expect(f.others).toEqual([]);expect(f.reached.length).toBe(50)
 await open('more')
 const pane=await $.ui.mount(PANE)
 try{
  await pane.press({key:'coco:more:talk:on'});await pane.redraw()
  expect(await pane.find({type:'Button',key:'coco:more:talk:ask:yes'})).toBeDefined()
  await pane.press({key:'coco:more:talk:ask:yes'});await pane.redraw()
  expect(await pane.find({type:'Button',key:'coco:more:talk:off'})).toBeDefined();expect(f.requests).toEqual([])
  await open('talk');await pane.redraw()
  const disclosure=SHIPPED['more.talk.disclosure']!.en+'\n'+SHIPPED['more.modelService.disclosure']!.en
  expect(await pane.find({type:'Text',text:disclosure})).toBeDefined()
  await pane.input({key:'coco:talk:input',text:'hello there',kind:'change'})
  await pane.press({key:'coco:talk:send'});await settleLegacyStart($,f.w)
  expect(f.requests.length).toBe(1)
  expect(f.requests[0]!.system).toBe(SHIPPED['more.model.talk.persona']!.en);expect(f.requests[0]!.maxTokens).toBe(undefined);expect(f.requests[0]!.model).toBe('haiku')
  expect(f.requests[0]!.prompt?.endsWith('person: hello there')).toBe(true)
  const before=f.reached.length
  for(const text of ['sama, how was the morning','小克，今天怎么样']){
   const result=await $.prompt.submit({text,wait:false,origin:PERSON}) as {drop?:string};await settleLegacyStart($,f.w)
   expect(result.drop).toBe(SHIPPED['more.talk.routed']!.en)
  }
  expect(f.reached.length).toBe(before);expect(f.requests.length).toBe(3);expect(f.others).toEqual([])
 }finally{await pane.unmount()}
})

// Several messages per reply on the shipped words (owner and lead, 10-10), drawn: one call per Send; the first message
// shows when the reply lands, each next one alone after its pause, a still «…» in every gap; the same on a 24-column
// terminal and on the desktop, with reduced motion and with a screen reader; a page change holds the rest.
const REPLY='Oh!\n---\nIs that the parser again?\n---\nI thought the little comma test caught that one on Tuesday.'
const PARTS=splitTalkReply(REPLY)
const SECRET='AKIAIOSFODNN7EXAMPLE'
for(const [name,surface,columns,extra] of [
 ['a 24-column terminal','terminal',24,{}],
 ['the desktop','desktop',100,{surfaces:['desktop'] as ('terminal'|'desktop')[]}],
 ['reduced motion','terminal',100,{settings:{prefersReducedMotion:true}}],
 ['a screen reader','terminal',100,{env:{CLAUDE_AX_SCREEN_READER:'1'}}],
] as const)test(`M1 O1 Talk sends his reply as several messages, one call, paced from the content: ${name}`,async($,on)=>{
 const f=talkWorld(on,()=>REPLY,{...extra,repo:{root:`/tmp/m1-talk-shipped-fixture/${SECRET}-private-project`}})
 await $.session.start({...START,surface});await settleLegacyStart($,f.w)
 const open=(args:string)=>$.command.run({command:'coco',args,origin:PERSON,presentation:P})
 await open('more')
 const pane=await $.ui.mount({...PANE,surface,props:{...PANE.props,bodyColumns:columns},viewport:{columns,rows:100}})
 try{
  await pane.press({key:'coco:more:talk:on'});await pane.redraw();await pane.press({key:'coco:more:talk:ask:yes'});await pane.redraw()
  // A prompt to Claude with a path in it; neither it nor the repository's name may reach his context line.
  await $.prompt.submit({text:`please read /home/fixture/.ssh/${SECRET}.pem`,wait:false,origin:PERSON});await settleLegacyStart($,f.w)
  await open('talk');await pane.redraw()
  const has=async(text:string)=>(await pane.find({type:'Text',text}))!==undefined
  await pane.input({key:'coco:talk:input',text:'the parser broke',kind:'change'})
  await pane.press({key:'coco:talk:send'});await settleLegacyStart($,f.w);await pane.redraw()
  expect(f.requests.length).toBe(1)
  const prompt=f.requests[0]!.prompt!,context=prompt.split('\n').at(-2)!
  expect(/^Now: Friday \d\d:\d\d\. Claude is (idle|working|[a-z ]+)\./.test(context)).toBe(true)
  for(const never of [SECRET,'/home','.ssh','private-project','please read','.pem'])expect(prompt.includes(never)).toBe(false)
  expect(new TextEncoder().encode(context).length<=200).toBe(true);expect(context.includes(' \u00b7 ')).toBe(false)
  // The first message at once, the writing state under it, nothing else yet.
  expect(await has(PARTS[0]!)).toBe(true);expect(await has('\u2026')).toBe(true);expect(await has(PARTS[1]!)).toBe(false)
  const first=talkPause(PARTS[0]!,PARTS[1]!),second=talkPause(PARTS[1]!,PARTS[2]!)
  expect(first>=TALK_GAP_MIN&&second>=TALK_GAP_MIN).toBe(true)
  await f.w.clock.advance(first-1);await pane.redraw()
  expect(await has(PARTS[1]!)).toBe(false);expect(await has('\u2026')).toBe(true)
  // His timer redraws the tab itself.
  await f.w.clock.advance(1)
  expect(await has(PARTS[1]!)).toBe(true);expect(await has(PARTS[2]!)).toBe(false);expect(await has('\u2026')).toBe(true)
  // The page changes: nothing comes while it is away, and back on Talk the last one waits its whole pause.
  await open('more');await pane.redraw();await f.w.clock.advance(10000)
  await open('talk');await pane.redraw()
  expect(await has(PARTS[2]!)).toBe(false);expect(await has('\u2026')).toBe(true)
  await f.w.clock.advance(second-1);await pane.redraw();expect(await has(PARTS[2]!)).toBe(false)
  await f.w.clock.advance(1);await pane.redraw()
  expect(await has(PARTS[2]!)).toBe(true);expect(await has('\u2026')).toBe(false)
  for(const part of PARTS)expect(await has(part)).toBe(true)
  expect(f.requests.length).toBe(1);expect(f.others).toEqual([])
 }finally{await pane.unmount()}
})
