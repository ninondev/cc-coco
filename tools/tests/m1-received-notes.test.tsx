import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { world, settleLegacyStart, RECENT, MORNING, P, PERSON, band } from './world'
import { M1_MORE_TEXT } from './m1-more-data-fixture'
import { ReceivedNotes, receivedNoteKey } from '../hooks/window-notes'
import { C3_WORDS_RAW } from './c3-words-fixture'
import { C3_HEAD_MANIFEST } from './c3-head-assets'

// Synthetic development inputs for the gate tests; the shipped words are checked below in en and zh.
const MARKER='fixture-from-other-window',DISCLOSURE='fixture-Claude-model-service'
const START={cwd:'/tmp/m1-received-note-fixture',surface:'desktop' as const,isInteractive:true}
const PANE={plugin:'coco',component:'Pane' as const,requestId:'coco-book',props:{title:'',isFocused:true,bodyColumns:100,placement:'dock' as const,scroll:{offset:0,bodyRows:100},view:{}},viewport:{columns:100,rows:100}}
// O6 is cut (10-09); the inbox stays for finding 2 and offers the pass only with its approved marker word.
function fixture(on:On,options:{marker?:boolean;throwSubmit?:boolean;shipped?:boolean;lang?:string}={}){
 const words=JSON.parse(M1_MORE_TEXT)
 if(!options.shipped){words['more.received.disclosure']={en:DISCLOSURE};if(options.marker!==false)words['more.received.marker']={en:MARKER};else delete words['more.received.marker']}
 const moreText=JSON.stringify(words)
 const submitted:{text:string;asUser:boolean}[]=[],queued:string[]=[],models:string[]=[],cleared:string[]=[]
 on('prompt.*',($,e,next)=>{
  if(next.is('prompt.submit',e)){submitted.push({text:e.text,asUser:e.origin.kind==='plugin'&&e.origin.asUser===true});if(options.throwSubmit)throw Error('fixture uncertain submission')}
  return next(e)
 })
 const writes=new Map<string,unknown>()
 // The testing engine has no store noun; observe successful documented writes.
 on('store.*',async($,e,next)=>{
  const result=await next(e)
  if(next.is('store.set',e)&&!('deny' in result))writes.set(e.key,e.value)
  return result
 })
 const w=world(on,{surfaces:['desktop'],...(options.lang?{settings:{language:options.lang}}:{}),initialState:{book:{page:'him',reading:0,rev:0}},store:{...RECENT,firstMet:MORNING,bandSettings:{voice:'off',voiceChosen:true,band:'on',notes:false}},moreText,readText:path=>path.endsWith('c3-text.json')?C3_WORDS_RAW:path.endsWith('frame-manifest.json')?JSON.stringify(C3_HEAD_MANIFEST):undefined})
 on('session.receive',($,e)=>{queued.push(e.text);return{text:e.text}})
 on('command.*',($,e,next)=>{if(next.is('command.run',e)&&e.command==='clear')cleared.push(e.command);return next(e)})
 on('model.*',($,e,next)=>{models.push('model');return next(e)})
 on('http.*',($,e,next)=>{models.push('network');return next(e)})
 on('agent.list',()=>({value:[]}));on('session.messages',()=>({value:[]}));on('session.model',()=>({value:'fixture-model'}));on('session.repo',()=>({value:null}));on('session.turns',()=>({value:1}));on('ui.panes',()=>({value:[]}));on('fs.write',()=>({value:undefined}));on('process.run',()=>({value:{exitCode:0,stdout:'{}',stderr:'',isStdoutTruncated:false,isStderrTruncated:false}}))
 return {w,submitted,queued,models,cleared,writes}
}
async function start($:Engine,w:ReturnType<typeof world>){await $.session.start(START);await settleLegacyStart($,w)}
async function receive($:Engine,text='fixture incoming note'){return $.session.receive({origin:{kind:'peer',plugin:'forged-plugin-name'},text})}

// The SDK only routes presses to currently drawn, plugin-owned buttons.
// Test imports have a separate singleton from registered host hooks. These
// explicitly local component controls make no host-inbox or dispatch claim.
async function componentRejects(kind:'unknown-id'|'missing-marker'|'consumed-id'):Promise<void>{
 const inbox=new ReceivedNotes(),id='fixture-component-owned-id',sent:string[]=[]
 expect(inbox.enqueue(id,'fixture incoming note')).toBe(true)
 if(kind==='consumed-id'){
  await inbox.pass(id,MARKER,async text=>{sent.push(text)})
  expect(sent).toEqual([MARKER+'\n\nfixture incoming note']);sent.length=0
 }
 const before=inbox.snapshot()
 const result=inbox.pass(kind==='unknown-id'?'fixture-forged-inbox-id':id,kind==='missing-marker'?'':MARKER,async text=>{sent.push(text)})
 await result
 expect(result).toBeUndefined();expect(sent).toEqual([]);expect(inbox.snapshot()).toEqual(before)
}

async function componentThrowsOnce():Promise<void>{
 const inbox=new ReceivedNotes(),id='fixture-component-throw-id',sent:string[]=[]
 expect(inbox.enqueue(id,'fixture incoming note')).toBe(true)
 await expect(inbox.pass(id,MARKER,async text=>{sent.push(text);throw Error('fixture uncertain component submission')})).rejects.toThrow('fixture uncertain component submission')
 expect(inbox.snapshot()).toEqual([])
 const repeated=inbox.pass(id,MARKER,async text=>{sent.push(text)})
 await repeated
 expect(repeated).toBeUndefined();expect(sent).toEqual([MARKER+'\n\nfixture incoming note'])
}

test('M1 S2 another-window note is visible in band and Him book, queues nothing and forged keys pass nothing',async($,on)=>{
 const f=fixture(on);await start($,f.w)
 const row=await $.ui.mount({surface:'desktop',...band(100)})
 try{
  const result=await receive($);console.log('M1_S2_RECEIVED_PHASE off-consumed');expect(result.consumed).toBeDefined();expect(f.queued).toEqual([])
  expect(f.w.view().line?.text).toBe('fixture incoming note')
  await row.redraw();console.log('M1_S2_RECEIVED_PHASE off-band-note');expect(await row.find({type:'Text',text:'fixture incoming note'})).toBeDefined()
  const id='fixture-forged-inbox-id'
  expect(await row.find({type:'Button',key:receivedNoteKey(id)})).toBeUndefined()
  await $.command.run({command:'coco',args:'him',origin:PERSON,presentation:P})
  const pane=await $.ui.mount({surface:'desktop',...PANE})
  try{console.log('M1_S2_RECEIVED_PHASE off-book-note');expect(await pane.find({type:'Text',text:'fixture incoming note'})).toBeDefined();expect(await pane.find({type:'Button',key:receivedNoteKey(id)})).toBeUndefined()}finally{await pane.unmount()}
  await componentRejects('unknown-id')
  expect(f.submitted).toEqual([]);expect(f.queued).toEqual([]);expect(f.models).toEqual([]);expect(f.cleared).toEqual([])
  expect(f.w.view().line?.text).toBe('fixture incoming note')
 }finally{await row.unmount()}
})

test('M1 S2 missing approved other-window marker hides passing and forged presses send nothing',async($,on)=>{
 const f=fixture(on,{marker:false});await start($,f.w);await receive($)
 const row=await $.ui.mount({surface:'desktop',...band(100)})
 try{
  const id='fixture-forged-inbox-id'
  expect(await row.find({type:'Button',key:receivedNoteKey(id)})).toBeUndefined()
  expect(f.w.view().line?.buttons).toBeUndefined()
  await componentRejects('missing-marker')
  expect(f.submitted).toEqual([]);expect(f.queued).toEqual([]);expect(f.models).toEqual([]);expect(f.cleared).toEqual([]);expect(f.w.view().line?.text).toBe('fixture incoming note')
 }finally{await row.unmount()}
})

test('M1 S2 a genuine band press passes marked text once without asUser; repeats cannot submit',async($,on)=>{
 const f=fixture(on);await start($,f.w);await receive($)
 const row=await $.ui.mount({surface:'desktop',...band(100)})
 try{
  const key=f.w.view().line?.buttons?.[0]?.key;console.log('M1_S2_RECEIVED_PHASE shipping-key');expect(key).toBeDefined()
  console.log('M1_S2_RECEIVED_PHASE band-button');expect(await row.find({type:'Button',key})).toBeDefined();expect(f.submitted).toEqual([]);expect(f.queued).toEqual([])
  await row.press({key:key!})
  await row.redraw();expect(await row.find({type:'Button',key})).toBeUndefined()
  await componentRejects('consumed-id')
  expect(f.submitted).toEqual([{text:MARKER+'\n\nfixture incoming note',asUser:false}]);expect(f.w.view().line?.text).not.toBe('fixture incoming note')
  expect(f.queued).toEqual([]);expect(f.models).toEqual([]);expect(f.cleared).toEqual([])
 }finally{await row.unmount()}
})

test('M1 S2 the Him book explains the service and its press passes the same note once',async($,on)=>{
 const f=fixture(on);await start($,f.w);await receive($)
 await $.command.run({command:'coco',args:'him',origin:PERSON,presentation:P})
 const pane=await $.ui.mount({surface:'desktop',...PANE})
 try{
  const key=f.w.view().line?.buttons?.[0]?.key;console.log('M1_S2_RECEIVED_PHASE shipping-key');expect(key).toBeDefined()
  console.log('M1_S2_RECEIVED_PHASE book-note');expect(await pane.find({type:'Text',text:'fixture incoming note'})).toBeDefined()
  console.log('M1_S2_RECEIVED_PHASE book-disclosure');expect(await pane.find({type:'Text',text:DISCLOSURE})).toBeDefined()
  console.log('M1_S2_RECEIVED_PHASE book-button');expect(await pane.find({type:'Button',key})).toBeDefined();expect(f.submitted).toEqual([])
  await pane.press({key:key!});await pane.redraw();expect(await pane.find({type:'Button',key})).toBeUndefined()
  await componentRejects('consumed-id')
  expect(f.submitted).toEqual([{text:MARKER+'\n\nfixture incoming note',asUser:false}]);expect(f.models).toEqual([]);expect(f.cleared).toEqual([])
 }finally{await pane.unmount()}
})

// The shipped words (groups-h-1010, 10-10): the title heads the Him book's letters and is the consumed
// reason, the disclosure stands above the pass button, and the marker leads the note Claude is given.
const SHIPPED={
 en:{title:'Letters',marker:'A note from another session:',disclosure:'This sends the note to Claude.'},
 zh:{title:'来信',marker:'来自另一个会话的消息:',disclosure:'这会把消息发给Claude。'},
} as const
for(const lang of ['en','zh'] as const)test(`M1 S2 the shipped letter words head the Him book, stand above the pass and lead the passed note: ${lang}`,{options:{language:lang,resolvedLanguage:lang}},async($,on)=>{
 const f=fixture(on,{shipped:true,lang});await start($,f.w)
 const result=await receive($);expect(result.consumed).toBe(SHIPPED[lang].title)
 await $.command.run({command:'coco',args:'him',origin:PERSON,presentation:P})
 const pane=await $.ui.mount({surface:'desktop',...PANE})
 try{
  expect(await pane.find({type:'Text',text:SHIPPED[lang].title})).toBeDefined()
  expect(await pane.find({type:'Text',text:'fixture incoming note'})).toBeDefined()
  expect(await pane.find({type:'Text',text:SHIPPED[lang].disclosure})).toBeDefined()
  const key=f.w.view().line?.buttons?.[0]?.key;expect(key).toBeDefined();expect(await pane.find({type:'Button',key})).toBeDefined()
  await pane.press({key:key!})
  expect(f.submitted).toEqual([{text:SHIPPED[lang].marker+'\n\nfixture incoming note',asUser:false}]);expect(f.models).toEqual([])
 }finally{await pane.unmount()}
})

test('M1 S2 a throwing host submission is consumed before dispatch and cannot be retried',async($,on)=>{
 const f=fixture(on,{throwSubmit:true});await start($,f.w);await receive($)
 const key=f.w.view().line?.buttons?.[0]?.key;console.log('M1_S2_RECEIVED_PHASE shipping-key');expect(key).toBeDefined()
 const row=await $.ui.mount({surface:'desktop',...band(100)})
 try{
  expect(await row.find({type:'Button',key})).toBeDefined()
  await componentThrowsOnce()
  // EngineEventOf declares failed hooks skipped; the button's core result stands.
  // This is an SDK fallback result, not a successful host submission receipt.
  expect(await row.press({key:key!})).toEqual({element:key})
  expect(f.submitted).toEqual([{text:MARKER+'\n\nfixture incoming note',asUser:false}])
  await row.redraw();console.log('M1_S2_RECEIVED_PHASE throwing-pass-clears-drawing')
  expect(f.w.view().line?.text).not.toBe('fixture incoming note')
  expect(await row.find({type:'Button',key})).toBeUndefined()
  await componentRejects('consumed-id')
  expect(f.submitted).toHaveLength(1);expect(f.submitted[0]!.asUser).toBe(false);expect(f.queued).toEqual([]);expect(f.models).toEqual([]);expect(f.cleared).toEqual([])
 }finally{await row.unmount()}
})

test('M1 S2 agent-targeted and non-peer deliveries retain their original downstream handling',async($,on)=>{
 const f=fixture(on);await start($,f.w)
 for(const input of [{origin:{kind:'peer' as const},agentId:'fixture-owned-agent',text:'agent message'},{origin:{kind:'bridge' as const},text:'person bridge message'}]){
  expect(await $.session.receive(input)).toEqual({text:input.text})
 }
 expect(f.queued).toEqual(['agent message','person bridge message']);expect(f.w.view().line?.text).not.toBe('fixture incoming note');expect(f.submitted).toEqual([]);expect(f.models).toEqual([]);expect(f.cleared).toEqual([])
})

