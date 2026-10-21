import { installM1Words, M1_MORE_TEXT } from './m1-more-data-fixture'
import { installModelServiceFixture } from './m1-model-service-fixture'
import { describe, expect, test } from 'claude-code/testing'
import type { EngineInterface, SessionUsage, ModelUsage } from 'claude-code'
import { MoreRuntime as ShippingMoreRuntime, rewriteKeepsExact, TALK_CAP, talkEstimate, talkLooksLikeWork, MISSING_MORE_MODEL_SLOTS } from '../hooks/more-runtime'
import { MoreTalk, MoreExplanation, MorePage, MoreEntry } from '../hooks/more-book'
import type { MoreSnapshot } from '../hooks/more-state'
import { MORE_IDS, moreDay, moreRows, moreRowSupported, capChoices, moreCountText, moreOn, moreValues } from '../hooks/more-state'
import { moreWord, moreMissing, moreFill, MORE_SLOTS, moreModelWords } from '../hooks/more-words'
import { gapCharacterName } from '../hooks/mod-gaps-words'
import { MORE_CORPUS } from './more-corpus'
import { composedVoiceSize, commandClashes, boundedHealth } from '../hooks/more-checks'
import { scriptArgv, inspectScripts } from '../hooks/more-scripts'
import { secretHits, hideSecrets } from '../hooks/more-secrets'
const MORE_KEY_SHAPES=['sk-ant-api03-'+ 'a'.repeat(60),'sk-proj-'+ 'b'.repeat(48),'sk-'+ 'b'.repeat(48),'AKIA'+'A'.repeat(16),'ghp_'+'c'.repeat(36),'gho_'+'c'.repeat(36),'ghu_'+'c'.repeat(36),'ghs_'+'c'.repeat(36),'ghr_'+'c'.repeat(36),'github_pat_'+'c'.repeat(50),'xoxb-'+'d'.repeat(32),'AIza'+'e'.repeat(35),'sk_live_'+'f'.repeat(28),'rk_live_'+'f'.repeat(28),'-----BEGIN RSA PRIVATE KEY-----\nfixture\n-----END RSA PRIVATE KEY-----','sk-ant-admin01-'+ 'z'.repeat(32),'xoxp-'+'d'.repeat(32),'-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----','sk-ant-usr01-'+ 'u'.repeat(48)]
export const MORE_KEY_FIXTURES=Array.from({length:12},(_,round)=>MORE_KEY_SHAPES.map(text=>text.includes('PRIVATE KEY')?text.replace('fixture',`fixture-${round}`):text.replace(/[A-Za-z0-9]$/,String.fromCharCode(65+round)))).flat()
installM1Words()
installModelServiceFixture()
const AT=1791273600000
const USAGE:SessionUsage={startedAt:AT,context:{tokens:40000,window:200000,percent:20},rateLimits:[]}
const TOKENS:ModelUsage={input_tokens:11,output_tokens:4,cache_read_input_tokens:7,cache_creation_input_tokens:3}
function world(options:{usage?:SessionUsage;answer?:string;reject?:boolean;env?:Record<string,string>;style?:string;now?:number}={}){
 const calls:{name:string;args:unknown[]}[]=[],stored:Record<string,unknown>={}
 const files:Record<string,string>={}
 const schedule:{ms:number;step:()=>void;alive:boolean}[]=[]
 let box='hello',timers=0,style=options.style??'old-style'
 const call=(name:string,...args:unknown[])=>{calls.push({name,args})}
 const engine={
  fs:{read:async(path:string)=>{call('fs.read',path);if(files[path]===undefined)throw Error('missing fixture');return files[path]},write:async(path:string,text:string)=>{call('fs.write',path,text);files[path]=text}},
  store:{get:async(key:string)=>{call('store.get',key);return stored[key]},set:async(key:string,value:unknown)=>{call('store.set',key,value);stored[key]=value}},
  ui:{invalidate:()=>{},log:(text:string)=>call('ui.log',text),status:(text:string|undefined)=>call('ui.status',text),toast:(...args:unknown[])=>call('ui.toast',...args),ask:async(...args:unknown[])=>{call('ui.ask',...args);if(options.reject)throw Error('headless');return options.answer??'Stop here'},copy:async(text:string)=>{call('ui.copy',text)},selection:async()=>{call('ui.selection');return{text:'the selected exact text'}}},
  model:{complete:async(request:unknown)=>{call('model.complete',request);return{isAnswered:true,text:'plain answer',usage:TOKENS}},fork:async(request:unknown)=>{call('model.fork',request);return{isAnswered:true,text:'fork answer',usage:TOKENS}},classify:async(...args:unknown[])=>{call('model.classify',...args);return'work'}},
  agent:{register:async(request:unknown)=>{call('agent.register',request)},spawn:async(request:unknown)=>{call('agent.spawn',request);return{agentId:'reader'}}},
  tool:{register:async(request:unknown)=>{call('tool.register',request)}},
  prompt:{read:async()=>{call('prompt.read');return{text:box}},fill:async(request:{text:string})=>{call('prompt.fill',request);box=request.text}},
  session:{usage:async()=>{call('session.usage');return options.usage??USAGE},send:async(request:unknown)=>{call('session.send',request);return{isDelivered:true}},append:async(request:unknown)=>{call('session.append',request)},repo:async()=>{call('session.repo');return null}},
  turn:{abort:async(request:unknown)=>{call('turn.abort',request)}},
  config:{list:async()=>{call('config.list');return[{key:'outputStyle',value:style,isLocked:false}]},set:async(request:{value:string})=>{call('config.set',request);style=request.value;return{value:style}}},
  command:{run:async(request:unknown)=>{call('command.run',request)}},
  env:{get:async(key:string)=>{call('env.get',key);return options.env?.[key]}},
  http:{fetch:async(...args:unknown[])=>{call('http.fetch',...args);return{ok:true,text:'{"incidents":[],"components":[{"name":"Claude Code","status":"operational"}]}'}}},
  clock:{now:async()=>{call('clock.now');return options.now??AT},every:(ms:number,step:()=>void)=>{call('clock.every',ms);timers++;const scheduled={ms,step,alive:true};schedule.push(scheduled);return{cancel:()=>{if(scheduled.alive){scheduled.alive=false;timers--}}}},after:(ms:number)=>{call('clock.after',ms);return{cancel:()=>{}}}},
 } as unknown as EngineInterface
 return{$:engine,calls,stored,files,advance:(ms:number)=>{for(const timer of schedule)if(timer.alive)for(let at=timer.ms;at<=ms;at+=timer.ms)timer.step()},setBox:(text:string)=>{box=text},box:()=>box,timers:()=>timers,count:(name:string)=>calls.filter(call=>call.name===name).length,style:()=>style}
}
// Explicit internal helper fixture. Shipping Look also needs its reader
// instruction, which these helper tests run without, so buffer and logging
// regressions stay visible on their own.
class MoreRuntime extends ShippingMoreRuntime {
 override isOn(id:Parameters<ShippingMoreRuntime['isOn']>[0]):boolean{return id==='look'?moreOn(this.values,id):super.isOn(id)}
 override restore(values:unknown,agreed:unknown,today:unknown,now:number,keepSessionCap=false):void{
  super.restore(values,agreed,today,now,keepSessionCap)
  const raw=moreValues(values);if(raw.look!==undefined)this.values.look=raw.look
 }
}
describe('More capabilities',()=>{
 test('Shipping Look stays off without its reader instruction, whatever the stored values say',()=>{
  const f=world(),r=new ShippingMoreRuntime()
  r.restore({look:true},[],undefined,AT);expect(r.values.look).toBe(true)
  r.values={look:true};expect(r.isOn('look')).toBe(false)
  expect(r.press(f.$,'coco:more:look:on')).toBe(false);expect(r.press(f.$,'coco:more:look:ask:yes')).toBe(false)
  r.edit('/fixture/private.ts','private input');expect((r as unknown as {editInputs:string[]}).editInputs).toEqual([]);expect((r as unknown as {changedPaths:Set<string>}).changedPaths.size).toBe(0);r.lookText='retained text'
  expect(r.registerLook(f.$)).toBe(undefined);expect(r.secondLook(f.$)).toBe(undefined);expect(r.lookAvailable()).toBe(false)
  expect(r.lookTell(f.$)).toBe(undefined);expect(r.copyLook(f.$)).toBe(undefined)
  expect(f.calls).toEqual([]);expect(f.timers()).toBe(0)
 })

 test('A4 script inspection checks the exact action argv and preserves denied verdict',async()=>{
  const seen:string[]=[],engine={plugin:{root:'/tmp/plugin'},tool:{check:async(request:{input:{command:string}})=>{seen.push(request.input.command);return{decision:'deny'}}}} as unknown as EngineInterface
  const tree={type:'Box',props:{},children:[{type:'Button',props:{key:'coco:icon:apply',label:'Apply'}}]} as never
  const found=await inspectScripts(engine,tree,'/tmp','linux')
  expect(scriptArgv('coco:icon:apply','/tmp/plugin','linux')).toEqual(['/bin/sh','/tmp/plugin/bin/icon-linux.sh','apply','--report','--replace-custom'])
  expect(found.get('coco:icon:apply')?.command).toBe(seen[0])
  expect(found.get('coco:icon:apply')?.decision).toBe('deny')
  expect(found.get('coco:icon:apply')?.source.includes('/tmp')).toBe(false)
 })
 test('A19 actual composed voice counts only his own section',()=>{
  expect(composedVoiceSize([{id:'coco:voice',text:'hello'},{id:'other',text:'other prompt'}] as never)).toBe(5)
 })
 test('A20 only first command resolution names a clash',()=>{
  expect(commandClashes([{name:'coco',plugin:'other'},{name:'coco',plugin:'coco'},{name:'omen',plugin:'coco'}] as never)).toEqual(['coco'])
 })
 test('A24 Fix health polls at 250ms and stops by twelve unchanged reads',async()=>{
  const sleeps:number[]=[],reads:number[]=[]
  expect(await boundedHealth(async(ms)=>{sleeps.push(ms)},async()=>{reads.push(1);return false},Boolean)).toBe(undefined)
  expect(sleeps).toEqual(Array(12).fill(250));expect(reads.length).toBe(12)
  let count=0
  expect(await boundedHealth(async()=>{},async()=>++count,n=>n===2)).toBe(2)
  expect(count).toBe(2)
 })

 test('A24 wall deadline answers at 3s and never starts another read after timeout',async()=>{
  let deadline=()=>{},cancelled=false,reads=0,release=(value:number)=>{}
  const pending=boundedHealth(async()=>{},()=>{reads++;return new Promise<number>(resolve=>{release=resolve})},()=>false,(ms,callback)=>{expect(ms).toBe(3000);deadline=callback;return{cancel:()=>{cancelled=true}}})
  await Promise.resolve();await Promise.resolve();deadline();expect(await pending).toBe(undefined)
  release(1);await Promise.resolve();await Promise.resolve();expect(reads).toBe(1);expect(cancelled).toBe(true)
 })
 test('F1 F3 F4 F6 every off path returns synchronously and does zero work in 100 replays',()=>{
  const f=world(),r=new MoreRuntime();r.restore({},[],undefined,AT)
  for(let i=0;i<100;i++){
   expect(r.talk(f.$,'hello',AT)).toBe(undefined)
   expect(r.explain(f.$,AT,true)).toBe(undefined)
   expect(r.registerLook(f.$)).toBe(undefined)
   expect(r.secondLook(f.$)).toBe(undefined)
   expect(r.capToolCall(f.$,'turn')).toBe(undefined)
   expect(r.pasteEdit(f.$,'sk-'+ 'x'.repeat(48))).toBe(undefined)
   expect(r.talkFromPrompt(f.$,'sama, hello',AT)).toBe(false)
   expect(r.writeDiary(f.$,AT)).toBe(undefined)
   expect(r.hidePaste(f.$)).toBe(undefined)
   r.syncLively(f.$,{terminal:true,awake:true,visible:true,idle:true,reducedMotion:false},()=>{})
  }
  expect(f.calls.length).toBe(0);expect(f.timers()).toBe(0)
 })
 test('one-time in-place agreement stays off until yes and survives restore',async()=>{
  const f=world(),r=new MoreRuntime({'more.model.talk.persona':'fixture persona'})
  expect(r.press(f.$,'coco:more:talk:on')).toBe(true)
  expect(r.asking).toBe('talk');expect(r.isOn('talk')).toBe(false);expect(f.calls.length).toBe(0)
  await r.press(f.$,'coco:more:talk:ask:yes')
  expect(r.isOn('talk')).toBe(true);expect(r.agreed).toEqual(['talk'])
  await r.press(f.$,'coco:more:talk:off');await r.press(f.$,'coco:more:talk:on')
  expect(r.asking).toBe(undefined);expect(r.isOn('talk')).toBe(true)
  const resumed=new MoreRuntime({'more.model.talk.persona':'fixture persona'});resumed.restore(f.stored.more,f.stored['more.agreed'],undefined,AT)
  expect(resumed.isOn('talk')).toBe(true)
 })
 test('O1 missing persona fails closed; authored persona makes one Send one Haiku completion with exact usage',async()=>{
  const f=world(),missing=new MoreRuntime();missing.restore({talk:true},[],undefined,AT)
  expect(missing.talk(f.$,'hello',AT)).toBe(undefined);expect(f.calls.length).toBe(0)
  const r=new MoreRuntime({'more.model.talk.persona':'test fixture persona'});r.restore({talk:true},[],undefined,AT)
  await r.talk(f.$,'hello',AT)
  expect(f.count('model.complete')).toBe(1);expect(f.count('model.classify')).toBe(0)
  expect((f.calls.find(call=>call.name==='model.complete')!.args[0] as {model:string}).model).toBe('haiku')
  expect(r.today.rows.talk).toEqual({n:1,tokens:25,cacheRead:7})
 })
 test('O1 diary takes no tokens: without a data folder zero reads; one press writes one template line once per local day',async()=>{
  const missing=new MoreRuntime({'more.model.talk.persona':'fixture persona'}),f=world();missing.restore({talk:true},[],undefined,AT)
  expect(missing.writeDiary(f.$,AT)).toBe(undefined);expect(f.calls.length).toBe(0)
  const r=new MoreRuntime({'more.model.talk.persona':'fixture persona'}, {dataFolder:()=>'/fixture/plugin-data'});r.restore({talk:true},[],undefined,AT)
  r.recordDay('prompts',AT,2);r.recordDay('turns',AT,3);r.recordDay('tests',AT,2);r.recordDay('awakeHours',AT,4.4);r.recordTool('private-server-name',AT)
  await r.writeDiary(f.$,AT);await r.writeDiary(f.$,AT)
  expect(f.count('model.complete')).toBe(0);expect(f.count('fs.write')).toBe(1)
  // no omen grade since the omen left (owner 10-15); the template's {grade} goes with lane B's words
  expect(r.diaryPage).toBe(moreFill(moreWord('diary.template','en'),{turns:3,greens:2,grade:'-',hours:4}))
  expect(r.diaryPage.includes('private-server-name')).toBe(false);expect(r.today.rows.talk).toBe(undefined)
  expect(Object.keys(f.files).every(path=>path.startsWith('/fixture/plugin-data/diary/'))).toBe(true)
  expect(Object.values(f.files).join('').includes('private-server-name')).toBe(false)
 })
 test('O1 the work sorter is a rule: backticks, a path, a URL or over 160 characters go to Claude with no model call',async()=>{
  for(const text of ['run `npm test` please','look at src/app.ts','see https://example.invalid/x','x'.repeat(161),'C:\\fixture\\a.ts'])expect(talkLooksLikeWork(text)).toBe(true)
  for(const text of ['good morning','how was your day?','y'.repeat(160)])expect(talkLooksLikeWork(text)).toBe(false)
  const f=world(),r=new MoreRuntime({'more.model.talk.persona':'fixture persona'});r.restore({talk:true},[],undefined,AT)
  await r.talk(f.$,'please fix `parse()`',AT)
  expect(f.count('model.complete')).toBe(0);expect(f.count('model.classify')).toBe(0);expect(r.today.rows.talk).toEqual({n:1,tokens:0,cacheRead:0})
  expect(r.exchanges.at(-1)).toEqual({side:'him',text:moreWord('talk.work','en'),work:'please fix `parse()`'})
  await r.talk(f.$,'good morning',AT)
  expect(f.count('model.complete')).toBe(1)
  const prompt=(f.calls.find(call=>call.name==='model.complete')!.args[0] as {prompt:string}).prompt
  expect(prompt.includes('parse()')).toBe(false);expect(prompt.endsWith('person: good morning')).toBe(true)
 })
 test('O1 probe: «sama,» or «小克,» at the prompt goes to Talk only when Talk is on and its persona is written',async()=>{
  const opened:string[]=[],f=world(),r=new MoreRuntime({'more.model.talk.persona':'fixture persona'},{openBook:page=>{opened.push(page)}});r.restore({talk:true},[],undefined,AT)
  for(const text of ['please fix sama, the bug','samantha, hi','sama,   ','小克'])expect(r.talkFromPrompt(f.$,text,AT)).toBe(false)
  expect(f.calls.length).toBe(0)
  for(const [text,said] of [['sama, hello','hello'],['Sama，how are you','how are you'],['小克，你好','你好'],['  小克,早','早']] as const){
   expect(r.talkFromPrompt(f.$,text,AT)).toBe(true)
   for(let i=0;i<50&&r.busy;i++)await new Promise(resolve=>setTimeout(resolve,0))
   expect(r.busy).toBe(false);expect(r.exchanges.filter(item=>item.side==='person').at(-1)?.text).toBe(said)
  }
  expect(opened).toEqual(['talk','talk','talk','talk']);expect(f.count('model.complete')).toBe(4)
  const off=world(),quiet=new MoreRuntime({'more.model.talk.persona':'fixture persona'});quiet.restore({},[],undefined,AT)
  expect(quiet.talkFromPrompt(off.$,'sama, hello',AT)).toBe(false);expect(off.calls.length).toBe(0)
  // The persona is a model instruction, not a word: without it Talk fails closed and nothing is routed.
  const silent=world(),unauthored=new MoreRuntime();unauthored.restore({talk:true},[],undefined,AT)
  expect(unauthored.talkFromPrompt(silent.$,'sama, hello',AT)).toBe(false);expect(silent.calls.length).toBe(0)
 })
 test('TALK-KEY Talk keeps under the 100,000 cap by dropping the oldest exchanges, and one message over it is never sent',async()=>{
  expect(talkEstimate('abc')).toBe(2003);expect(talkEstimate('ｱ')).toBe(2003);expect(talkEstimate('é','x')).toBe(2003)
  const f=world(),r=new MoreRuntime({'more.model.talk.persona':'fixture persona'});r.restore({talk:true},[],undefined,AT)
  r.exchanges=Array.from({length:12},(_,i)=>({side:i%2?'him':'person',text:String(i).padEnd(9000,'w')}))
  await r.talk(f.$,'z'.repeat(150),AT)
  const prompt=(f.calls.find(call=>call.name==='model.complete')!.args[0] as {prompt:string}).prompt
  expect(talkEstimate('fixture persona',prompt)<=TALK_CAP).toBe(true);expect(prompt.includes('0'.padEnd(9000,'w'))).toBe(false);expect(prompt.includes('11'.padEnd(9000,'w'))).toBe(true)
  // A message short enough to be talk can only pass the cap with an oversized persona, and the persona lint
  // (TALK-KEY 2, 10,000 bytes) now stops that one before anything: no call and nothing kept.
  const big=world(),alone=new MoreRuntime({'more.model.talk.persona':'p'.repeat(98000)});alone.restore({talk:true},[],undefined,AT)
  await alone.talk(big.$,'hello',AT)
  // The too-long line that answer() puts in his reply's place is drawn in the next two tests (groups-h-1010).
  expect(big.count('model.complete')).toBe(0);expect(alone.exchanges).toEqual([])
 })
 test('TALK-KEY Explain refuses a target over the cap without a model call',async()=>{
  const f=world(),opened:string[]=[],r=new MoreRuntime({}, {openBook:page=>{opened.push(page)}});r.restore({explain:true},[],undefined,AT);r.lastAnswer='x'.repeat(TALK_CAP)
  await r.explain(f.$,AT,false);expect(f.count('model.complete')).toBe(0);expect(r.explanation).toBe('Too long to explain at once. Select a shorter part.');expect(opened).toEqual(['him'])
  r.configure('zh');await r.explain(f.$,AT,false);expect(f.count('model.complete')).toBe(0);expect(r.explanation).toBe('太长了,选短一些。');expect(opened).toEqual(['him','him'])
 })
 // groups-h-1010 (10-10): each too-long line is drawn where his reply and the explanation go, in the person's language.
 for(const [lang,talkText,explainText] of [['en',"That's too long for one message to Coco. Claude can take it.",'Too long to explain at once. Select a shorter part.'],['zh','一条消息给她太长了,Claude接得住。','太长了,选短一些。']] as const)test(`TALK-KEY the too-long lines stand in the Talk tab, with Ask Claude, and as the explanation: ${lang}`,async($,on)=>{
  const big=world(),r=new MoreRuntime({'more.model.talk.persona':'p'.repeat(98000)});r.restore({talk:true,explain:true},[],undefined,AT);r.configure(lang)
  await r.talk(big.$,'hello',AT);r.lastAnswer='x'.repeat(TALK_CAP);await r.explain(big.$,AT,false)
  expect(big.count('model.complete')).toBe(0)
  // The persona lint (TALK-KEY 2, 10,000 bytes) stops this persona before anything, and no linted persona with a
  // talk-sized message reaches the cap, so the Talk exchange is drawn as answer() would build it.
  expect(r.exchanges).toEqual([])
  r.exchanges=[{side:'person',text:'hello'},{side:'him',text:moreWord('talk.tooLong',lang),work:'hello'}]
  const snapshot={...r.snapshot(),lang},pane=(requestId:string)=>({surface:'terminal' as const,plugin:'coco',component:'Pane' as const,requestId,props:{title:'Fixture',isFocused:true,bodyColumns:100,placement:'dock' as const,scroll:{offset:0,bodyRows:100},view:{}}})
  on('ui.render',{component:'Pane',requestId:'words-talk'},($,e)=>MoreTalk($.ui.resolve(e) as any,{surface:e.surface,snapshot,exchanges:r.exchanges,name:'Fixture'}))
  on('ui.render',{component:'Pane',requestId:'words-explain'},($,e)=>MoreExplanation($.ui.resolve(e) as any,{surface:e.surface,snapshot,text:r.explanation}))
  const talk=await $.ui.mount(pane('words-talk'))
  expect(await talk.find({type:'Text',text:talkText})).toBeDefined();expect(await talk.find({type:'Button',key:'coco:talk:askClaude:1'})).toBeDefined()
  await talk.unmount()
  const explain=await $.ui.mount(pane('words-explain'))
  expect(await explain.find({type:'Markdown',text:explainText})).toBeDefined()
  await explain.unmount()
 })
 // groups-i-1010 and persona-1010-v4 (10-10): with the shipped disclosure and the owner's persona, Explain, Plain and Talk
 // turn on through their one ask, and one Send is one call with the persona and the texting paragraph as system and
 // no cap of its own since his 10-17 「单条放开」: the request names none (Claude Code's own default holds).
 for(const lang of ['en','zh'] as const)test(`the shipped words let Explain, Plain and Talk turn on; one Send is one call with the persona and no token cap: ${lang}`,async()=>{
  const shipped=JSON.parse(M1_MORE_TEXT) as Record<string,Record<string,string>>,slots=['more.modelService.disclosure','more.model.talk.persona'],old=slots.map(slot=>MORE_SLOTS[slot])
  for(const slot of slots)MORE_SLOTS[slot]=shipped[slot]!
  try{
   const f=world(),r=new ShippingMoreRuntime(moreModelWords(MISSING_MORE_MODEL_SLOTS));r.configure(lang);r.restore({},[],undefined,AT)
   for(const id of ['explain','plain','talk'] as const){
    expect(await r.press(f.$,`coco:more:${id}:on`)).toBe(true);expect(r.asking).toBe(id)
    await r.press(f.$,`coco:more:${id}:ask:yes`);expect(r.isOn(id)).toBe(true)
   }
   await r.talk(f.$,lang==='zh'?'你好':'hello',AT)
   const calls=f.calls.filter(call=>call.name==='model.complete')
   expect(calls.length).toBe(1)
   const request=calls[0]!.args[0] as {system:string;maxTokens:number;model:string}
   expect(request.system).toBe(shipped['more.model.talk.persona']!.en);expect(request.maxTokens).toBe(undefined);expect(request.model).toBe('haiku')
   expect(r.talkFromPrompt(f.$,lang==='zh'?'小克，在吗':'sama, still there?',AT)).toBe(true)
  }finally{slots.forEach((slot,i)=>{if(old[i])MORE_SLOTS[slot]=old[i]!;else delete MORE_SLOTS[slot]})}
 })
 // The persona lint (EVERY-CAPABILITY O1; DECISIONS 10-10, owner): the persona, which ends with his texting paragraph,
 // is one English text for every language, at most 10,000 bytes (owner 10-14, raised from 6,000); it says she is a
 // character, and «character» alone passes (no «small model» or «Haiku» line since 10-10). No word lists on what it says
 // (his 10-17: no content rules in chat; anyone may call the person 主人).
 test('the shipped persona passes the persona lint',()=>{
  const shipped=JSON.parse(M1_MORE_TEXT) as Record<string,Record<string,string>>
  for(const slot of ['more.model.talk.persona','more.model.talk.compact'])for(const lang of Object.keys(shipped[slot]!))expect(shipped[slot]![lang]).toBe(shipped[slot]!.en)
  const text=shipped['more.model.talk.persona']!.en!
  // It tells her how to send several messages (his texting paragraph closes v7).
  expect(/a line with only --- between/i.test(text)).toBe(true)
  expect(new TextEncoder().encode(text).length<=10000).toBe(true)
  expect(/\bcharacter\b/i.test(text)).toBe(true);expect(/small model|haiku/i.test(text)).toBe(false)
  expect(text.includes('\u2014')).toBe(false);expect(text.includes(' \u00b7 ')).toBe(false)
 })
 test('口语版 shows the original when the rewrite drops a code span, a link or a number (10-20)',async()=>{
  expect(rewriteKeepsExact('Run `npm test`; 41 passed, see https://x.dev/a.','The tests: run npm test, 41 passed (https://x.dev/a).')).toBe(true)
  expect(rewriteKeepsExact('It took 1,412 bytes.','It took 1412 bytes.')).toBe(true)
  expect(rewriteKeepsExact('1. Open it. 2. Close it.','Open it, then close it.')).toBe(true)
  expect(rewriteKeepsExact('```sh\nnpm ci\nnpm test\n```','Run npm ci.')).toBe(false)
  expect(rewriteKeepsExact('Version 1.0.0 is out.','The new version is out.')).toBe(false)
  expect(rewriteKeepsExact('See https://x.dev/a.','See the page.')).toBe(false)
  const f=world(),r=new MoreRuntime();r.restore({explain:true},[],undefined,AT);r.lastAnswer='Run `npm test`; 41 passed.'
  await r.explain(f.$,AT,false);expect(f.count('model.complete')).toBe(1);expect(r.explanation).toBe('Run `npm test`; 41 passed.')
 })
 test('O2 selection reads only on press; one Haiku completion and no conversation append or submit',async()=>{
  const f=world(),r=new MoreRuntime();r.restore({explain:true},[],undefined,AT);r.lastAnswer='last answer'
  await r.explain(f.$,AT,true)
  expect(f.count('ui.selection')).toBe(1);expect(f.count('model.complete')).toBe(1)
  const request=f.calls.find(call=>call.name==='model.complete')!.args[0] as {prompt:string;model:string}
  expect(request.prompt.endsWith('the selected exact text')).toBe(true);expect(request.model).toBe('haiku')
  expect(f.count('session.append')).toBe(0);expect(f.count('prompt.submit')).toBe(0)
  expect(r.today.rows.explain).toEqual({n:1,tokens:25,cacheRead:7})
  const old=world();await r.explain(old.$,AT,false);expect(old.count('ui.selection')).toBe(0)
 })
 for(const [lang,cut] of [['en','Changes too large; only part was checked.'],['zh','改动太大,只查了一部分。']] as const)test(`O3 a cut look says so as a 14 s band note: ${lang}`,async()=>{
  const lines:[string,string,number][]=[],f=world(),r=new MoreRuntime({'more.model.look.prompt':'test fixture reader'},{line:(text,kind,ms)=>{lines.push([text,kind,ms])}});r.restore({look:true},[],undefined,AT);r.configure(lang);await r.registerLook(f.$)
  for(let i=0;i<4;i++)r.edit('/fixture/a.ts','x'.repeat(20000))
  await r.secondLook(f.$);expect(f.count('agent.spawn')).toBe(1);expect(lines[0]).toEqual([cut,'note',14000])
 })
 // U6 (owner 10-17: 「画出来，写一句为什么」): a row that cannot run here is drawn, «Off», with one line saying why.
 test('O3 is drawn; without its reader instruction it is Off with its reason, no switch, and is not counted on',async($,on)=>{
  expect(moreRowSupported('look')).toBe(true);expect(moreRows('terminal')).toContain('look');expect(moreRows('desktop')).toEqual([...MORE_IDS])
  MORE_SLOTS['more.unavailable']={en:'fixture reason this row cannot run'}
  // lane B wrote the reader instruction on 10-17, so this test takes it out to see the row that cannot run
  const instruction=MORE_SLOTS['more.model.look.prompt'];delete MORE_SLOTS['more.model.look.prompt']
  const snapshot={values:{look:true,explain:true},agreed:['explain'],today:{date:'',rows:{}},reading:0,open:true,lang:'en',screenReader:false} as MoreSnapshot
  const pane=(requestId:string)=>({surface:'terminal' as const,plugin:'coco',component:'Pane' as const,requestId,props:{title:'Fixture',isFocused:true,bodyColumns:100,placement:'dock' as const,scroll:{offset:0,bodyRows:200},view:{}}})
  const nodes=(tree:any):any[]=>!tree||typeof tree!=='object'?[]:Array.isArray(tree)?tree.flatMap(nodes):[tree,...(tree.children??[]).flatMap(nodes)]
  on('ui.render',{component:'Pane',requestId:'look-page'},($,e)=>MorePage($.ui.resolve(e) as any,{surface:e.surface,snapshot}))
  on('ui.render',{component:'Pane',requestId:'look-entry'},($,e)=>MoreEntry($.ui.resolve(e) as any,{surface:e.surface,snapshot}))
  try{
   const page=await $.ui.mount(pane('look-page')),drawn=nodes(await page.drawn())
   expect(drawn.some(node=>node.props?.key==='coco:more:row:look')).toBe(true)
   expect(drawn.some(node=>node.props?.key==='coco:more:row:explain')).toBe(true)
   for(const text of [moreWord('look.label','en'),moreWord('look.cost','en'),'fixture reason this row cannot run'])expect(await page.find({type:'Text',text})).toBeDefined()
   for(const key of ['coco:more:look:on','coco:more:look:off'])expect(await page.find({type:'Button',key})).toBeUndefined()
   await page.unmount()
   const entry=await $.ui.mount(pane('look-entry'))
   expect(await entry.find({type:'Text',text:moreFill(moreWord('entry.count','en'),{on:1,total:MORE_IDS.length})})).toBeDefined()
   await entry.unmount()
  }finally{delete MORE_SLOTS['more.unavailable'];if(instruction)MORE_SLOTS['more.model.look.prompt']=instruction}
 })
 test('O3 the reader has Read and Grep alone, runs on Haiku by default and is told the files it may open',async()=>{
  const f=world(),r=new MoreRuntime({'more.model.look.prompt':'test fixture prompt'});r.restore({look:true},[],undefined,AT)
  await r.registerLook(f.$);r.edit('/fixture/a.ts','fixture edit');r.edit('/fixture/b.ts','fixture edit');await r.secondLook(f.$)
  expect(f.count('agent.register')).toBe(1);expect(f.count('agent.spawn')).toBe(1);expect(r.lookOffered()).toBe(false)
  const request=f.calls.find(call=>call.name==='agent.register')!.args[0] as {tools:string[];model:string}
  expect(request.tools).toEqual(['Read','Grep']);expect(request.model).toBe('haiku')
  const spawn=f.calls.find(call=>call.name==='agent.spawn')!.args[0] as {model:string;prompt:string}
  expect(spawn.model).toBe('haiku');expect(spawn.prompt.startsWith('test fixture prompt\n\n/fixture/a.ts\n/fixture/b.ts\n\n')).toBe(true)
  // its answer is shown to the person, so it ends naming their language
  expect(spawn.prompt.endsWith('\n\nWrite in English.')).toBe(true)
  const g=world(),zh=new MoreRuntime({'more.model.look.prompt':'test fixture prompt'});zh.restore({look:true},[],undefined,AT);zh.configure('zh-Hant')
  await zh.registerLook(g.$);zh.edit('/fixture/a.ts','fixture edit');await zh.secondLook(g.$)
  expect((g.calls.find(call=>call.name==='agent.spawn')!.args[0] as {prompt:string}).prompt.endsWith('\n\nWrite in Chinese (Traditional).')).toBe(true)
 })
 test('session clear erases private buffers and discards a pending completion before a new request',async()=>{
  const f=world(),r=new MoreRuntime({'more.model.talk.persona':'test fixture persona'});r.restore({talk:true,explain:true,look:true},[],undefined,AT)
  r.exchanges=[{side:'him',text:'prior private conversation'}];r.lastAnswer='prior private answer';r.explanation='prior private explanation';r.lookText='prior private look';r.diaryPage='prior private diary';r.talkInput='prior private input'
  const complete=f.$.model.complete;let release=()=>{}
  f.$.model.complete=(async()=>{await new Promise<void>(resolve=>{release=resolve});return{isAnswered:true,text:'late private answer',usage:TOKENS}}) as typeof complete
  const pending=r.talk(f.$,'old conversation request',AT)
  r.stop();release();await pending
  expect(r.exchanges).toEqual([]);expect(r.lastAnswer).toBe('');expect(r.explanation).toBe('');expect(r.lookText).toBe('');expect(r.diaryPage).toBe('');expect(r.talkInput).toBe('');expect(r.busy).toBe(false)
  f.$.model.complete=complete;await r.talk(f.$,'new conversation request',AT)
  const prompt=(f.calls.find(call=>call.name==='model.complete')!.args[0] as {prompt:string}).prompt
  expect(prompt.includes('prior private')).toBe(false);expect(prompt.includes('old conversation request')).toBe(false);expect(prompt.includes('late private')).toBe(false)
 })
 test('O3 concurrent presses spawn one reader and cleared pending spawn cannot repopulate it',async()=>{
  const f=world(),r=new MoreRuntime({'more.model.look.prompt':'test fixture reader'});r.restore({look:true},[],undefined,AT);await r.registerLook(f.$);r.edit('/fixture/a.ts','fixture edit')
  const spawn=f.$.agent.spawn;let release=()=>{}
  f.$.agent.spawn=(async()=>{await new Promise<void>(resolve=>{release=resolve});return{agentId:'old-reader'}}) as typeof spawn
  const pending=r.secondLook(f.$);expect(r.secondLook(f.$)).toBe(undefined)
  await Promise.resolve();await Promise.resolve();r.stop();release();await pending
  expect(r.lookAgentId).toBe(undefined);expect(r.lookText).toBe('');expect(r.lookAvailable()).toBe(false)
 })
 test('O3 retained non-repository edit input is bounded at capture and results only fill on a press',async()=>{
  const lines:string[]=[],f=world(),r=new MoreRuntime({'more.model.look.prompt':'test fixture reader'},{line:text=>{lines.push(text)}});r.restore({look:true},[],undefined,AT);await r.registerLook(f.$)
  for(let i=0;i<10;i++)r.edit('/fixture/a.ts','x'.repeat(20000))
  expect((r as unknown as {editInputs:string[]}).editInputs.reduce((n,text)=>n+text.length,0)).toBe(60000)
  // TALK-KEY: the cut is said, as a band note (groups-h-1010, 10-10).
  await r.secondLook(f.$);expect(f.count('agent.spawn')).toBe(1);expect(lines[0]).toBe('Changes too large; only part was checked.')
  await r.finishLook(f.$,'reader','reader findings',TOKENS,AT,2)
  expect(f.count('prompt.fill')).toBe(0);expect(f.count('session.append')).toBe(0)
  await r.lookTell(f.$);expect(f.box()).toBe('reader findings');await r.copyLook(f.$);expect(f.count('ui.copy')).toBe(1)
 })
 test('O3 last-look cost is one completed look while today retains both completions',async()=>{
  const f=world(),r=new MoreRuntime();r.restore({look:true},[],undefined,AT)
  r.lookAgentId='first';await r.finishLook(f.$,'first','first result',TOKENS,AT)
  r.lookAgentId='second';await r.finishLook(f.$,'second','second result',{input_tokens:30,output_tokens:10,cache_read_input_tokens:1,cache_creation_input_tokens:0},AT)
  expect(r.today.rows.look?.tokens).toBe(66);expect(r.today.rows.look?.lastTokens).toBe(41)
  expect(moreCountText(r.snapshot(),'look')).toBe('Last look: about 41 tokens')
 })
 // BOOK F10: every number in a More line is grouped as the rest of the book writes it
 test('More lines group their numbers: 112,000 tokens, not 112000',async()=>{
  const f=world(),r=new MoreRuntime();r.restore({look:true},[],undefined,AT)
  r.lookAgentId='big';await r.finishLook(f.$,'big','result',{input_tokens:110000,output_tokens:2000,cache_read_input_tokens:0,cache_creation_input_tokens:0},AT)
  expect(moreCountText(r.snapshot(),'look')).toBe('Last look: about 112,000 tokens')
 })
 test('late Explain usage after clear and off persists exact numeric totals without private content or followups',async()=>{
  const f=world();let changed=0,opened=0,release=()=>{}
  const r=new MoreRuntime({}, {changed:()=>{changed++},openBook:()=>{opened++}});r.restore({explain:true},[],undefined,AT);r.lastAnswer='old private answer'
  const complete=f.$.model.complete
  f.$.model.complete=(async()=>{await new Promise<void>(resolve=>{release=resolve});return{isAnswered:true,text:'late private answer',usage:TOKENS}}) as typeof complete
  const pending=r.explain(f.$,AT,false);r.stop();r.values={};release();await pending
  expect(r.today.rows.explain).toEqual({n:1,tokens:25,cacheRead:7});expect((f.stored['more.today'] as {rows:unknown}).rows).toEqual(r.today.rows)
  expect(r.explanation).toBe('');expect(r.lastAnswer).toBe('');expect(changed).toBe(0);expect(opened).toBe(0)
  expect(f.calls.filter(call=>call.name!=='store.set'&&call.name!=='clock.now')).toEqual([])
 })
 test('Explain switched off without clear counts the result but performs no UI or settings followup',async()=>{
  const f=world();let changed=0,opened=0,release=()=>{}
  const r=new MoreRuntime({}, {changed:()=>{changed++},openBook:()=>{opened++}});r.restore({explain:true},[],undefined,AT);r.lastAnswer='same-session target'
  f.$.model.complete=async()=>{await new Promise<void>(resolve=>{release=resolve});return{isAnswered:true,text:'off result',usage:TOKENS}}
  const pending=r.explain(f.$,AT,false);r.values={};release();await pending
  expect(r.today.rows.explain).toEqual({n:1,tokens:25,cacheRead:7});expect(r.explanation).toBe('');expect(r.busy).toBe(false)
  expect(changed).toBe(0);expect(opened).toBe(0);expect(f.calls.filter(call=>call.name!=='store.set'&&call.name!=='clock.now')).toEqual([])
  const diary=world(),writer=new MoreRuntime({}, {dataFolder:()=>'/fixture/data'});writer.restore({talk:true},[],undefined,AT)
  diary.$.fs.read=async()=>{writer.restore({},[],writer.today,AT);writer.restore({talk:true},[],writer.today,AT);return JSON.stringify({[moreDay(AT)]:'saved page'})}
  await writer.writeDiary(diary.$,AT);expect(writer.diaryPage).toBe('');expect(diary.count('model.complete')).toBe(0)
  const look=world(),reader=new MoreRuntime({'more.model.look.prompt':'fixture reader'},{line:()=>{opened++},openBook:()=>{opened++}});reader.restore({look:true},[],undefined,AT);await reader.registerLook(look.$);reader.edit('/fixture/a.ts','diff')
  look.$.agent.spawn=async()=>{reader.restore({},[],reader.today,AT);reader.restore({look:true},[],reader.today,AT);return{model:'haiku',agentId:'off-reader'}}
  await reader.secondLook(look.$);expect(reader.lookAgentId).toBe(undefined);expect(opened).toBe(0)
  reader.restore({look:true},[],undefined,AT);reader.lookAgentId='store-reader';look.$.store.set=async()=>{reader.restore({},[],reader.today,AT);reader.restore({look:true},[],reader.today,AT)}
  await reader.finishLook(look.$,'store-reader','findings',TOKENS,AT);expect(opened).toBe(0)
  for(const via of ['restore','press']){
   const f2=world();let resolve=()=>{},published=0,ui=0
   const old=new MoreRuntime({}, {changed:()=>{published++},openBook:()=>{ui++}});old.restore({explain:true},['explain'],undefined,AT);old.lastAnswer='target'
   f2.$.model.complete=async()=>{await new Promise<void>(r=>{resolve=r});return{isAnswered:true,text:'old content',usage:TOKENS}}
   const pending=old.explain(f2.$,AT,false)
   if(via==='restore'){old.restore({},['explain'],old.today,AT);old.restore({explain:true},['explain'],old.today,AT)}
   else{await old.press(f2.$,'coco:more:explain:off');await old.press(f2.$,'coco:more:explain:on')}
   const before=published;resolve();await pending
   expect(old.today.rows.explain?.tokens).toBe(25);expect(old.explanation).toBe('');expect(ui).toBe(0);expect(published).toBe(before)
  }
  const oldTalk=world(),speaker=new MoreRuntime({'more.model.talk.persona':'fixture persona'});speaker.restore({talk:true},[],undefined,AT)
  oldTalk.$.model.complete=async()=>{speaker.restore({},[],speaker.today,AT);speaker.restore({talk:true},[],speaker.today,AT);return{isAnswered:true,text:'old talk',usage:TOKENS}}
  await speaker.talk(oldTalk.$,'hello',AT);expect(speaker.exchanges).toEqual([]);expect(speaker.today.rows.talk?.tokens).toBe(25)
  for(const kind of ['talk','explain'] as const){
   const cancelled=world(),runtime=new MoreRuntime({'more.model.talk.persona':'fixture persona'}),row=kind==='explain'?'explain':'talk'
   runtime.restore({[row]:true},[],undefined,AT);runtime.lastAnswer='target'
   let dispatched=()=>{},finish=()=>{},signal:AbortSignal|undefined
   const ready=new Promise<void>(resolve=>{dispatched=resolve})
   cancelled.$.model.complete=(async(_request:unknown,options?:{signal?:AbortSignal})=>{signal=options?.signal;dispatched();await new Promise<void>(resolve=>{finish=resolve});return{isAnswered:true,text:'late paid result',usage:TOKENS}}) as typeof cancelled.$.model.complete
   const pending=kind==='talk'?runtime.talk(cancelled.$,'hello',AT):runtime.explain(cancelled.$,AT,false)
   await ready;expect(signal?.aborted).toBe(false);runtime.stop();expect(signal?.aborted).toBe(true);finish();await pending
   expect(runtime.today.rows[row]?.tokens).toBe(25);expect(runtime.exchanges).toEqual([]);expect(runtime.explanation).toBe('');expect(runtime.diaryPage).toBe('')
  }
  const thrown=world(),quiet=new MoreRuntime();quiet.restore({explain:true},[],undefined,AT);quiet.lastAnswer='target'
  thrown.$.model.complete=(async(_request:unknown,options?:{signal?:AbortSignal})=>new Promise((_resolve,reject)=>{options?.signal?.addEventListener('abort',()=>reject(Object.assign(Error('cancelled'),{name:'AbortError'})),{once:true})})) as typeof thrown.$.model.complete
  const cut=quiet.explain(thrown.$,AT,false);quiet.stop();await cut;expect(quiet.explanation).toBe('');expect(quiet.today.rows.explain?.tokens).toBe(0)
  const unrelated=world(),owner=new MoreRuntime();owner.restore({talk:true,explain:true},[],undefined,AT);owner.lastAnswer='target'
  let releaseOwner=()=>{};unrelated.$.model.complete=async()=>{await new Promise<void>(resolve=>{releaseOwner=resolve});return{isAnswered:true,text:'held explain',usage:TOKENS}}
  const heldExplain=owner.explain(unrelated.$,AT,false);owner.restore({explain:true},[],owner.today,AT)
  expect(owner.busy).toBe(true);expect(owner.explain(unrelated.$,AT,false)).toBe(undefined);releaseOwner();await heldExplain;expect(owner.busy).toBe(false)
  const midnight=world({now:AT+86400000}),dated=new MoreRuntime();dated.restore({explain:true},[],undefined,AT);dated.lastAnswer='target'
  await dated.explain(midnight.$,AT,false);expect(dated.today.date).toBe(moreDay(AT+86400000));expect(dated.today.rows.explain?.tokens).toBe(25)
  const workday=new MoreRuntime({'more.model.talk.persona':'fixture persona'});workday.restore({talk:true},[],undefined,AT)
  await workday.talk(midnight.$,'https://fixture.invalid',AT);expect(workday.today.date).toBe(moreDay(AT+86400000));expect(workday.today.rows.talk).toEqual({n:1,tokens:0,cacheRead:0})
 })
 test('cleared readers retain only sixteen usage slots and late finishes count once without content or opening',async()=>{
  const f=world();let opened=0,changed=0
  const r=new MoreRuntime({'more.model.look.prompt':'test reader'}, {openBook:()=>{opened++},changed:()=>{changed++}});r.restore({look:true},[],undefined,AT);await r.registerLook(f.$)
  f.$.agent.spawn=(async()=>({agentId:'reader-'+f.count('session.repo')})) as typeof f.$.agent.spawn
  for(let i=0;i<16;i++){r.edit('/private/path.ts','private input');await r.secondLook(f.$);r.stop()}
  r.edit('/new/path.ts','new input');expect(r.secondLook(f.$)).toBe(undefined)
  expect((r as unknown as {clearedLookIds:Set<string>}).clearedLookIds.size).toBe(16)
  r.values={};await r.finishLook(f.$,'reader-1','old private result',TOKENS,AT)
  expect(r.lookText).toBe('');expect(r.lookAgentId).toBe(undefined);expect(opened).toBe(0);expect(changed).toBe(0)
  expect(r.today.rows.look?.tokens).toBe(25);expect(r.finishLook(f.$,'reader-1','duplicate old private result',TOKENS,AT)).toBe(undefined)
  expect((r as unknown as {clearedLookIds:Set<string>}).clearedLookIds.size).toBe(15)
 })
 test('O5 config changes only on press and Stop restores previous style',async()=>{
  const f=world({style:'old-style'}),r=new MoreRuntime()
  expect(f.count('config.set')).toBe(0)
  await r.style(f.$,true);expect(f.style()).toBe('coco:plain-words')
  await r.style(f.$,false);expect(f.style()).toBe('old-style');expect(f.count('config.set')).toBe(2)
  const delayed=world({style:'previous'}),plain=new MoreRuntime();let release=()=>{}
  delayed.$.config.list=async()=>{await new Promise<void>(resolve=>{release=resolve});return[{key:'outputStyle',value:'previous',isLocked:false}]}
  const activation=plain.style(delayed.$,true)
  delayed.$.config.list=async()=>[{key:'outputStyle',value:'previous',isLocked:false}]
  await plain.press(delayed.$,'coco:more:plain:off');release();await activation
  expect(delayed.count('config.set')).toBe(0);expect(plain.isOn('plain')).toBe(false)
  const native=world({style:'previous'}),queued=new MoreRuntime();let started=()=>{},finish=()=>{},applied='previous'
  const dispatched=new Promise<void>(resolve=>{started=resolve}),written:string[]=[]
  native.$.config.set=(async(request:{key:string;value:string})=>{written.push(request.value);if(request.value==='coco:plain-words'){started();await new Promise<void>(resolve=>{finish=resolve})}applied=request.value;return{value:request.value}}) as typeof native.$.config.set
  const turnOn=queued.style(native.$,true);await dispatched
  const turnOff=queued.press(native.$,'coco:more:plain:off');await Promise.resolve();await Promise.resolve()
  const beforeFinish=[...written];finish();await turnOn;await turnOff;expect(beforeFinish).toEqual(['coco:plain-words'])
  expect(written).toEqual(['coco:plain-words','previous']);expect(applied).toBe('previous');expect(queued.isOn('plain')).toBe(false)
  const reset=world({style:'previous'}),old=new MoreRuntime();let began=()=>{},unblock=()=>{},engineStyle='previous'
  const start=new Promise<void>(resolve=>{began=resolve}),order:string[]=[]
  reset.$.config.list=async()=>[{key:'outputStyle',value:engineStyle,isLocked:false}]
  reset.$.config.set=(async(request:{value:string})=>{order.push(request.value);if(order.length===1){engineStyle=request.value;began();await new Promise<void>(resolve=>{unblock=resolve})}engineStyle=request.value;return{value:request.value}}) as typeof reset.$.config.set
  const first=old.style(reset.$,true);await start;old.stop()
  const newer=new MoreRuntime(),latest=newer.style(reset.$,true);await Promise.resolve();await Promise.resolve();await Promise.resolve()
  const beforeUnblock=[...order];unblock();await first;await latest;expect(beforeUnblock).toEqual(['coco:plain-words'])
  expect(order).toEqual(['coco:plain-words','previous','coco:plain-words']);expect(old.isOn('plain')).toBe(false);expect(newer.isOn('plain')).toBe(true)
  newer.stop();expect(newer.isOn('plain')).toBe(true);await newer.style(reset.$,false);expect(engineStyle).toBe('previous')



 })
 test('O5 a config row that offers only the built-in styles: the plugin style goes through /output-style, a built-in back through the row',async()=>{
  const f=world({style:'default'}),r=new MoreRuntime(),run:unknown[]=[]
  let style='default'
  f.$.config.list=async()=>[{key:'outputStyle',value:style,isLocked:false}] as never
  f.$.config.set=(async(request:{value:string})=>{if(request.value.includes(':'))return{deny:'For custom styles, open /config.'};style=request.value;return{value:style}}) as typeof f.$.config.set
  f.$.command.run=(async(request:{command:string;args?:string})=>{run.push(request);if(request.command==='output-style'&&request.args)style=request.args;return{text:''}}) as typeof f.$.command.run
  await r.style(f.$,true)
  expect(run).toEqual([{command:'output-style',args:'coco:plain-words'}]);expect(style).toBe('coco:plain-words');expect(r.isOn('plain')).toBe(true)
  await r.style(f.$,false)
  expect(run.length).toBe(1);expect(style).toBe('default');expect(r.isOn('plain')).toBe(false)
  const stuck=world({style:'default'}),plain=new MoreRuntime()
  stuck.$.config.set=(async()=>({deny:'For custom styles, open /config.'})) as typeof stuck.$.config.set
  stuck.$.command.run=(async()=>({text:''})) as typeof stuck.$.command.run
  await plain.style(stuck.$,true);expect(plain.isOn('plain')).toBe(false)
 })
 test('O5 spending style asks in place before any config change and remembers yes',async()=>{
  const f=world(),r=new MoreRuntime()
  await r.press(f.$,'coco:more:plain:on');expect(r.asking).toBe('plain');expect(r.isOn('plain')).toBe(false);expect(f.count('config.set')).toBe(0)
  await r.press(f.$,'coco:more:plain:ask:yes');expect(r.isOn('plain')).toBe(true);expect(f.count('config.set')).toBe(1)
  await r.press(f.$,'coco:more:plain:off');await r.press(f.$,'coco:more:plain:on');expect(r.asking).toBe(undefined);expect(r.isOn('plain')).toBe(true)
 })
 test('O7 stop denies once with abort/status/stored notice and rejected headless dialog safely stops',async()=>{
  for(const reject of [false,true]){
   const f=world({usage:{...USAGE,cost:{usd:5} as SessionUsage['cost']},reject}),r=new MoreRuntime();r.restore({cap:1},[],undefined,AT)
   expect((await r.capToolCall(f.$,'turn'))?.deny.length!>0).toBe(true)
   await r.capToolCall(f.$,'turn')
   expect(f.count('ui.ask')).toBe(1);expect(f.count('turn.abort')).toBe(1);expect(f.count('ui.status')).toBe(1);expect(f.count('session.append')).toBe(1)
  }
 })
 test('O7 Keep going advances the session-only dollar line without abort; the choices are 1, 5 and 20 USD',async()=>{
  const f=world({usage:{...USAGE,cost:{usd:1} as SessionUsage['cost']},answer:'Keep going'}),r=new MoreRuntime();r.restore({cap:1},[],undefined,AT)
  await r.capToolCall(f.$,'turn');expect(r.values.cap).toBe(5);expect(f.count('turn.abort')).toBe(0)
  expect(capChoices('en').map(choice=>choice.value)).toEqual(['0','1','5','20'])
  expect(capChoices('en').slice(1).map(choice=>choice.label)).toEqual([0,1,2].map(i=>moreWord('cap.choices.'+i,'en')))
  for(const window of [80,90,95]){const old=new MoreRuntime();old.restore({cap:window},[],undefined,AT);expect(old.isOn('cap')).toBe(false)}
  const combined=world({usage:{...USAGE,cost:{usd:19} as SessionUsage['cost'],rateLimits:[{kind:'five_hour',percentUsed:99}]}}),dollars=new MoreRuntime();dollars.restore({cap:20},[],undefined,AT)
  expect(await dollars.capToolCall(combined.$,'turn')).toBe(undefined);expect(combined.count('ui.ask')).toBe(0)
  const late=world(),cap=new MoreRuntime();cap.restore({cap:5},[],undefined,AT)
  late.$.session.usage=async()=>{cap.restore({cap:0},[],cap.today,AT);cap.restore({cap:5},[],cap.today,AT);return{...USAGE,cost:{usd:6}} as SessionUsage}
  await cap.capToolCall(late.$,'turn');expect(late.count('ui.ask')).toBe(0)
  const choice=world({usage:{...USAGE,cost:{usd:6}} as never}),selected=new MoreRuntime();selected.restore({cap:5},[],undefined,AT)
  choice.$.ui.ask=async()=>{await selected.select(choice.$,'20');await selected.select(choice.$,'5');return moreWord('cap.go','en')}
  await selected.capToolCall(choice.$,'turn');expect(selected.values.cap).toBe(5);expect(choice.count('turn.abort')).toBe(0)

 })
 test('keeping warm survives a restore from the band and follows a switch another session stored (10-20)',async()=>{
  const f=world(),r=new MoreRuntime()
  f.stored.more={lively:false,warm:true};r.restore(f.stored.more,[],undefined,AT);expect(r.warmOn()).toBe(true)
  r.restore({lively:false},[],r.today,AT,true);expect(r.warmOn()).toBe(true)
  await r.press(f.$,'coco:more:lively:on');expect((f.stored.more as {warm?:boolean}).warm).toBe(true)
  f.stored.more={...(f.stored.more as object),warm:false}
  await r.press(f.$,'coco:more:lively:off');expect((f.stored.more as {warm?:boolean}).warm).toBe(false);expect(r.warmOn()).toBe(false)
 })
 test('O7 Keep going stays session-only across row saves, usage publication and clear',async()=>{
  const f=world({answer:moreWord('cap.go','en'),usage:{...USAGE,cost:{usd:1}} as never}),published:number[]=[]
  const r=new MoreRuntime({}, {changed:s=>{published.push(Number(s.values.cap))}});r.restore({cap:1,look:true},[],undefined,AT)
  await r.capToolCall(f.$,'turn');expect(r.values.cap).toBe(5)
  await r.press(f.$,'coco:more:lively:on');expect((f.stored.more as {cap:number}).cap).toBe(1)
  r.restore(f.stored.more,[],r.today,AT,true);expect(r.values.cap).toBe(5)
  r.lookAgentId='reader';await r.finishLook(f.$,'reader','fixture result',TOKENS,AT)
  expect(published.every(n=>n===1)).toBe(true);expect(r.snapshot().values.cap).toBe(5)
  r.stop();expect(r.values.cap).toBe(1)
  r.restore({cap:20},[],r.today,AT,true);expect(r.values.cap).toBe(20)
  r.restore({cap:1},[],r.today,AT);expect(r.values.cap).toBe(1)
 })
 test('O8 228 synthetic keys match in a paste; 20000 ordinary lines zero hits',()=>{
  const samples=MORE_KEY_FIXTURES
  let count=0
  expect(new Set(samples).size).toBe(228)
  for(const text of samples){expect(secretHits(text).length).toBe(1);expect(hideSecrets(text,'hidden').includes('hidden')).toBe(true);count++}
  expect(count).toBe(228)
  expect(MORE_CORPUS.length).toBe(20000)
  for(const line of MORE_CORPUS)expect(secretHits(line).length).toBe(0)
 })
 test('O10 exactly one 2000ms timer; sleep/hidden/reduced motion/off cancel without reads',()=>{
  const f=world(),r=new MoreRuntime();r.restore({lively:true},[],undefined,AT)
  let wakes=0
  const ready={terminal:true,awake:true,visible:true,idle:true,reducedMotion:false}
  r.syncLively(f.$,ready,()=>{wakes++});r.syncLively(f.$,ready,()=>{wakes++});f.advance(60000);expect(wakes).toBe(30);expect(f.timers()).toBe(1);expect(f.calls[0]!.args).toEqual([2000])
  for(const state of [{...ready,awake:false},{...ready,visible:false},{...ready,reducedMotion:true},{...ready,terminal:false},{...ready,idle:false}]){
   r.syncLively(f.$,state,()=>{});expect(f.timers()).toBe(0);r.syncLively(f.$,ready,()=>{})
  }
  r.restore({},[],undefined,AT);expect(f.timers()).toBe(0)
 })
 test('A3 exactly one focused help and phone help toggle, title scroll independent of body',()=>{
  const f=world(),r=new MoreRuntime()
  r.focus('coco:more:open');expect(r.entryFocused).toBe(true)
  r.focus('coco:more:talk:on');expect(r.entryFocused).toBe(false);expect(r.focused).toBe('talk')
  r.focus('coco:more:explain:on');expect(r.focused).toBe('explain')
  r.press(f.$,'coco:more:open');r.scroll(20);expect(r.reading).toBe(15);expect(r.open).toBe(true)
  r.press(f.$,'coco:more:talk:help');expect(r.focused).toBe('talk');r.press(f.$,'coco:more:talk:help');expect(r.focused).toBe(undefined)
 })
 test('authorized proper names normalize fallback and leave the engine Claude unchanged',()=>{
  MORE_SLOTS['more.test.name']={en:'Coco / /coco more, coco@coco / Claude'}
  try {
   for(const [lang,name] of [['zh','小克'],['ja','Coco'],['ko','코코'],['de','Coco'],['en','Coco']]){expect(moreWord('test.name',lang)).toBe(`${name} / /coco more, coco@coco / Claude`);expect(gapCharacterName(lang)).toBe(name)}
   expect(moreWord('model.missing.persona','zh')).toBe('')
  } finally { delete MORE_SLOTS['more.test.name'] }
 })
 test('authored English fallback names exact missing languages and midnight has no timer',()=>{
  expect(moreWord('talk.label','fixture-absent-language')).toBe(moreWord('talk.label','en'));expect(moreMissing('fixture-absent-language').length>100).toBe(true);expect(moreMissing('de')).toEqual([])
  const r=new MoreRuntime();r.restore({},[],{date:moreDay(AT-86400000),rows:{talk:{n:2,tokens:5,cacheRead:0}}},AT)
  expect(r.today.rows).toEqual({});expect([...MORE_IDS]).toEqual(['cap','paste','lively','talk','explain','look','plain','lines'])
 })
})
