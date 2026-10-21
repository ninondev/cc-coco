import { installM1Words, M1_MORE_TEXT } from './m1-more-data-fixture'
import { installModelServiceFixture } from './m1-model-service-fixture'
import { describe, expect, test } from 'claude-code/testing'
import type { EngineInterface, ModelUsage } from 'claude-code'
import { MoreRuntime, TALK_CAP, TALK_COMPACT_TRIGGER, TALK_HISTORY, TALK_RECENT, TALK_NOTES_HEAD, TALK_DEFAULT_REPLY_TOKENS, talkEstimate } from '../hooks/more-runtime'
import { splitTalkReply, talkTurnText, talkPause, talkContextLine, TALK_GAP_MIN, TALK_GAP_MAX, TALK_MAX_PARTS, TALK_CONTEXT_LIMIT } from '../hooks/talk-parts'

// Talk texts as a person does (owner and lead, 10-10): one call per Send; his reply splits only at lines of `---`;
// each next message waits a thinking beat plus typing time from its content, clamped to 0.2 to 2.5 s; a short
// context line rides before the person's message; a long chat compacts into his notes inside the Send.
installM1Words()
installModelServiceFixture()
const SHIPPED=JSON.parse(M1_MORE_TEXT) as Record<string,Record<string,string>>
const PERSONA=SHIPPED['more.model.talk.persona']!.en!,COMPACT=SHIPPED['more.model.talk.compact']!.en!
// The order's paragraph, word for word; the persona ends with it (talk-alive-1010 §1 and §2).
const TEXTING="How you text. You're messaging, the way a person does. Sometimes a single line says it all. Sometimes you react first and then add the thought that follows, or ask something right after. Sometimes one longer message is what fits. Let the moment decide: what they said, how you feel, what's going on. When you want to send separate messages, put a line with only --- between them."
const WORDS={'more.model.talk.persona':PERSONA,'more.model.talk.compact':COMPACT}
const AT=Date.UTC(2026,9,9,23,40) // a Friday, 23:40 in UTC
const USAGE:ModelUsage={input_tokens:900,output_tokens:40,cache_read_input_tokens:0,cache_creation_input_tokens:0}
type Request={system?:string;prompt:string;maxTokens?:number;model?:string}
type Answer={text:string;usage?:ModelUsage;isAnswered?:boolean;hold?:Promise<void>}

// A reply's usage when a test names none: a token for every byte, the worst any tokenizer does, so the count Talk
// calibrates by (his 10-17 card) is the byte estimate it had before.
const counted=(request:Request,text:string):ModelUsage=>({...USAGE,input_tokens:talkEstimate(request.system??'',request.prompt),output_tokens:talkEstimate(text)-2000})
function fake(answer:(request:Request,index:number)=>Answer){
 let now=AT
 const timers:{at:number;ms:number;fn:()=>void;alive:boolean}[]=[],requests:Request[]=[],stored:unknown[]=[],gaps:number[]=[]
 const $={
  clock:{now:async()=>now,after:(ms:number,fn:()=>void)=>{const timer={at:now+ms,ms,fn,alive:true};timers.push(timer);return{cancel:()=>{timer.alive=false}}}},
  store:{get:async()=>undefined,set:async(key:string,value:unknown)=>{stored.push([key,structuredClone(value)])}},
  model:{complete:async(request:Request)=>{requests.push(request);const reply=answer(request,requests.length-1);if(reply.hold)await reply.hold;return reply.isAnswered===false?{isAnswered:false,reason:'fixture failure',usage:reply.usage??USAGE}:{isAnswered:true,text:reply.text,usage:reply.usage??counted(request,reply.text)}}},
  ui:{invalidate:()=>{}},
  prompt:{fill:async()=>{}},
 } as unknown as EngineInterface
 const alive=()=>timers.filter(timer=>timer.alive)
 return{$,requests,stored,gaps,alive,now:()=>now,
  /** Fires the next of his waits, as the clock would, and says how long it was. */
  next:async():Promise<number|undefined>=>{
   const due=alive().sort((a,b)=>a.at-b.at)[0]
   if(!due)return undefined
   due.alive=false;now=due.at;gaps.push(due.ms);due.fn();await settle();return due.ms
  },
 }
}
const settle=async()=>{for(let i=0;i<30;i++)await new Promise(resolve=>setTimeout(resolve,0))}
function runtime(answer:(request:Request,index:number)=>Answer,bindings:ConstructorParameters<typeof MoreRuntime>[1]={},words:Record<string,string>=WORDS){
 const f=fake(answer),r=new MoreRuntime(words,bindings);r.restore({talk:true},[],undefined,AT)
 return{f,r}
}
const him=(r:MoreRuntime)=>r.talkView.filter(item=>item.side==='him').map(item=>item.text)
const filler=(i:number,bytes:number)=>`exchange ${i} `.padEnd(bytes,'w')

describe('Talk texting',()=>{
 test('the persona Talk sends ends with the texting paragraph and is the system text as it is',()=>{
  expect(PERSONA.endsWith('\n\n'+TEXTING)).toBe(true);expect(PERSONA.startsWith('You are Coco, a cute character')).toBe(true)
 })
 test('his reply splits only at lines that are exactly ---, the markers go, nothing else of his words changes',()=>{
  expect(splitTalkReply('Morning.')).toEqual(['Morning.'])
  expect(splitTalkReply('  spaced as he wrote it  \n')).toEqual(['  spaced as he wrote it  \n'])
  expect(splitTalkReply('Oh!\n---\nWait, the parser again?')).toEqual(['Oh!','Wait, the parser again?'])
  expect(splitTalkReply('a\n  ---  \nb\r\n---\r\nc')).toEqual(['a','b','c'])
  // Only a line of its own is a marker: a dash run inside a line, or four dashes, is his text.
  expect(splitTalkReply('a --- b\n----\nc')).toEqual(['a --- b\n----\nc'])
  expect(splitTalkReply('---\n\n---\nonly this\n---\n   \n---')).toEqual(['only this'])
  expect(splitTalkReply('first line\nsecond line\n---\n\nafter a blank')).toEqual(['first line\nsecond line','\nafter a blank'])
  const many=Array.from({length:9},(_,i)=>`part ${i+1}`).join('\n---\n')
  const capped=splitTalkReply(many)
  expect(capped.length).toBe(TALK_MAX_PARTS);expect(capped.slice(0,5)).toEqual(['part 1','part 2','part 3','part 4','part 5'])
  expect(capped[5]).toBe('part 6\n\npart 7\n\npart 8\n\npart 9')
  expect(capped.join('').includes('---')).toBe(false)
  expect(talkTurnText(['Oh!','Wait, the parser again?'])).toBe('Oh!\n\nWait, the parser again?')
 })
 test('each pause is a thinking beat plus typing from the content: the same input gives the same wait, always 0.2 to 2.5 s',()=>{
  const corpus=['Oh!','Ha.','(adjusts glasses)','Wait.','Is that the parser again?','Hmm...','I read about this once, in a very old book about compilers and the people who wrote them.','好！','你今天又在改那个解析器吗？','x'.repeat(400),'']
  for(const prev of corpus)for(const next of corpus){
   const wait=talkPause(prev,next),quick=talkPause(prev,next,true)
   expect(talkPause(prev,next)).toBe(wait);expect(talkPause(prev,next,true)).toBe(quick)
   expect(wait>=TALK_GAP_MIN&&wait<=TALK_GAP_MAX).toBe(true);expect(quick>=TALK_GAP_MIN&&quick<=wait).toBe(true)
  }
  // Longer to type, longer to wait, until the clamp.
  expect(talkPause('Okay','I looked at it yesterday')<talkPause('Okay','I looked at it yesterday and the tests were fine')).toBe(true)
  expect(talkPause('Okay','x'.repeat(400))).toBe(TALK_GAP_MAX)
  // A new thought (after a question, trailing dots, or a finished sentence opening differently) thinks longer than a
  // quick reaction, and longer than the same words carrying on.
  const next='Did the tests pass this time, or not yet?'
  expect(talkPause('Is that the parser again?',next)).toBeGreaterThan(talkPause('Is that the parser again',next))
  expect(talkPause('Hmm...',next)).toBeGreaterThan(talkPause('Hmm',next))
  expect(talkPause('That one was mine.',next)).toBeGreaterThan(talkPause('That one was mine',next))
  for(const reaction of ['Ha!','(nods)','Oh, that is wonderful news!'])expect(talkPause('Is that the parser again?',reaction)).toBeLessThan(talkPause('Is that the parser again?',next))
 })
 test('one call per Send: the first message shows when the reply arrives, each next one alone after its wait, the writing state in every gap',async()=>{
  const reply='Oh!\n---\nIs that the parser again?\n---\nI thought we fixed it on Tuesday, with the little test that checks the commas.'
  const {f,r}=runtime(()=>({text:reply}))
  await r.talk(f.$,'the parser broke',AT)
  expect(f.requests.length).toBe(1);expect(f.requests[0]!.maxTokens).toBe(undefined);expect(f.requests[0]!.system).toBe(PERSONA)
  expect(him(r)).toEqual(['Oh!']);expect(r.talkWriting).toBe(true)
  const parts=splitTalkReply(reply)
  expect(await f.next()).toBe(talkPause(parts[0]!,parts[1]!));expect(him(r)).toEqual(parts.slice(0,2));expect(r.talkWriting).toBe(true)
  expect(f.alive().length).toBe(1)
  expect(await f.next()).toBe(talkPause(parts[1]!,parts[2]!));expect(him(r)).toEqual(parts)
  // Then only the 0.2 s in which nothing else of his may appear, and nothing after it.
  expect(r.talkWriting).toBe(false);expect(f.alive().length).toBe(1);expect(await f.next()).toBe(TALK_GAP_MIN);expect(f.alive().length).toBe(0)
  expect(him(r)).toEqual(parts);expect(f.requests.length).toBe(1)
  // The history keeps his turn as one, parts joined by blank lines, no marker.
  expect(r.exchanges).toEqual([{side:'person',text:'the parser broke'},{side:'him',text:parts.join('\n\n')}])
  await r.talk(f.$,'yes, that one',AT)
  expect(f.requests.length).toBe(2)
  expect(f.requests[1]!.prompt.includes('him: '+parts.join('\n\n')+'\n')).toBe(true);expect(f.requests[1]!.prompt.includes('---')).toBe(false)
  // The same reply twice gives the same waits.
  const again=runtime(()=>({text:reply}));await again.r.talk(again.f.$,'the parser broke',AT);while(await again.f.next()!==undefined){}
  expect(again.f.gaps).toEqual(f.gaps.slice(0,3))
 })
 test('a new message while his are still coming: he sends the rest in order, quicker but never under 0.2 s, then answers',async()=>{
  const replies=['Oh!\n---\nWait, which one?\n---\nThe one with the commas?\n---\nI remember that one.','Ah, that.\n---\nThen I was right.']
  let release!:()=>void
  const hold=new Promise<void>(resolve=>{release=resolve})
  const {f,r}=runtime((_,index)=>({text:replies[index]!,...(index===1?{hold}:{})}))
  await r.talk(f.$,'the parser broke',AT)
  const first=splitTalkReply(replies[0]!),second=splitTalkReply(replies[1]!)
  expect(await f.next()).toBe(talkPause(first[0]!,first[1]!))
  const sent=r.talk(f.$,'the comma one',AT);await settle()
  // One call for this Send, at once, while his last messages keep coming.
  expect(f.requests.length).toBe(2);expect(r.busy).toBe(true);expect(r.talkWriting).toBe(true)
  expect(await f.next()).toBe(talkPause(first[1]!,first[2]!)) // the wait already running finishes as it was
  // His answer lands while one of the earlier messages is still to come: it waits behind it.
  release();await sent;expect(r.busy).toBe(false);expect(r.talkWriting).toBe(true)
  expect(him(r)).toEqual(first.slice(0,3))
  expect(await f.next()).toBe(talkPause(first[2]!,first[3]!,true))
  expect(talkPause(first[2]!,first[3]!,true)).toBeLessThan(talkPause(first[2]!,first[3]!))
  // Never two at once: his new answer's first message waits its own pause after the last one, then its own pace.
  expect(him(r)).toEqual(first)
  expect(await f.next()).toBe(talkPause(first[3]!,second[0]!))
  expect(await f.next()).toBe(talkPause(second[0]!,second[1]!))
  expect(await f.next()).toBe(TALK_GAP_MIN);expect(await f.next()).toBe(undefined)
  expect(r.talkView.map(item=>item.side+': '+item.text)).toEqual(['person: the parser broke','him: Oh!','him: Wait, which one?','person: the comma one','him: The one with the commas?','him: I remember that one.','him: Ah, that.','him: Then I was right.'])
  for(const gap of f.gaps)expect(gap>=TALK_GAP_MIN&&gap<=TALK_GAP_MAX).toBe(true)
  expect(f.requests.length).toBe(2)
  // The history keeps each of his replies as one turn.
  expect(r.exchanges.map(item=>item.side+': '+item.text)).toEqual(['person: the parser broke','him: '+first.join('\n\n'),'person: the comma one','him: '+second.join('\n\n')])
 })
 test('never two of his messages at once, whatever comes next: a line that needs no call waits out the 0.2 s after his last',async()=>{
  const {f,r}=runtime(()=>({text:'Mm.'}))
  await r.talk(f.$,'hello',AT)
  expect(him(r)).toEqual(['Mm.'])
  // A work message right away: no call, and his fixed line comes only after the 0.2 s, never with «Mm.».
  await r.talk(f.$,'please fix `parse()` in src/parser.ts',AT)
  expect(f.requests.length).toBe(1);expect(him(r)).toEqual(['Mm.']);expect(r.talkWriting).toBe(true)
  const waited=await f.next()
  expect(waited!).toBeGreaterThanOrEqual(TALK_GAP_MIN);expect(waited!).toBeLessThanOrEqual(TALK_GAP_MAX)
  expect(him(r).length).toBe(2);expect(r.talkView.at(-1)!.work).toBe('please fix `parse()` in src/parser.ts')
  // After the 0.2 s a new reply shows at once again.
  expect(await f.next()).toBe(TALK_GAP_MIN)
  await r.talk(f.$,'never mind',AT);expect(him(r).length).toBe(3)
 })
 test('Talk closed or the page changed: nothing waits on a clock and nothing is dropped; shown again, the rest keep their pacing',async()=>{
  const reply='Oh!\n---\nWait, which one?\n---\nThe one with the commas?'
  const {f,r}=runtime(()=>({text:reply}))
  await r.talk(f.$,'the parser broke',AT)
  r.talkHidden()
  expect(f.alive().length).toBe(0);expect(him(r)).toEqual(['Oh!']);expect(r.talkWriting).toBe(true)
  r.talkShown()
  // Nothing appears at once: the next one waits its whole pause from here, never under 0.2 s.
  expect(him(r)).toEqual(['Oh!']);expect(f.alive().length).toBe(1)
  const parts=splitTalkReply(reply)
  expect(await f.next()).toBe(talkPause(parts[0]!,parts[1]!))
  r.talkHidden();r.talkShown();r.talkShown()
  expect(f.alive().length).toBe(1)
  expect(await f.next()).toBe(talkPause(parts[1]!,parts[2]!));expect(him(r)).toEqual(parts)
  for(const gap of f.gaps)expect(gap>=TALK_GAP_MIN).toBe(true)
  // A reply that lands while Talk is closed shows its first message only, the rest wait for Talk.
  const late=runtime(()=>({text:reply}));late.r.talkHidden()
  await late.r.talk(late.f.$,'hello',AT)
  expect(him(late.r)).toEqual(['Oh!']);expect(late.f.alive().length).toBe(0)
  late.r.talkShown();expect(await late.f.next()).toBe(talkPause(parts[0]!,parts[1]!))
 })
 test('a reply that reaches Claude Code\'s default cap is shown as he wrote it and counted, with a debug line',async()=>{
  const debug:string[]=[],text='A long thought that ran right up to the end of what he could say and'
  const {f,r}=runtime(()=>({text,usage:{...USAGE,output_tokens:TALK_DEFAULT_REPLY_TOKENS}}),{debug:step=>{debug.push(step)}})
  await r.talk(f.$,'tell me everything',AT)
  expect(him(r)).toEqual([text]);expect(r.today.rows.talk?.cut).toBe(1);expect(debug).toEqual(['talk reply reached its token cap'])
 })
 test('the context line: weekday and time, Claude, the last tests, time away over 10 min, his face; never a name, a path or code; under 200 bytes',async()=>{
  const facts={now:AT,timeZone:'UTC',working:true,tool:'Edit',test:{verdict:'fail' as const,failed:3},lastActiveAt:AT-2*3600000,mood:'wild'}
  expect(talkContextLine(facts)).toBe('Now: Friday 23:40. Claude is editing. Last tests: 3 failed. They were away 2 h. Your face: grumpy.')
  expect(talkContextLine({now:AT,timeZone:'UTC',working:false})).toBe('Now: Friday 23:40. Claude is idle.')
  expect(talkContextLine({now:AT,timeZone:'UTC',working:false,test:{verdict:'pass'},lastActiveAt:AT-9*60000})).toBe('Now: Friday 23:40. Claude is idle. Last tests: green.')
  expect(talkContextLine({now:AT,timeZone:'UTC',working:false,lastActiveAt:AT-3*3600000},AT-11*60000)).toBe('Now: Friday 23:40. Claude is idle. They were away 11 min.')
  expect(talkContextLine({now:AT,timeZone:'Not/AZone',working:true,tool:'mcp__fixture__read_secret_AKIAAAAAAAAAAAAAAAAA',mood:'not-a-mood'}).startsWith('Now: ')).toBe(true)
  expect(talkContextLine({now:AT,timeZone:'UTC',working:true,tool:'mcp__fixture__read_secret_AKIAAAAAAAAAAAAAAAAA',mood:'not-a-mood'})).toBe('Now: Friday 23:40. Claude is working.')
  for(const line of [talkContextLine(facts),talkContextLine({...facts,lastActiveAt:1,test:{verdict:'fail',failed:123456789}})]){
   expect(new TextEncoder().encode(line).length<=TALK_CONTEXT_LIMIT).toBe(true);expect(line.includes(' · ')).toBe(false)
  }
  // In the request it is one line just before the person's message, and not in the system text.
  const {f,r}=runtime(()=>({text:'Mm.'}),{talkFacts:()=>facts})
  await r.talk(f.$,'still here?',AT)
  expect(f.requests[0]!.prompt).toBe(talkContextLine(facts)+'\nperson: still here?');expect(f.requests[0]!.system).toBe(PERSONA)
 })
 test('the persona, the context line and the empty-chat framing stay within 10 % of their measured size (10-10)',()=>{
  const wednesday=AT-2*86400000
  const longest=talkContextLine({now:wednesday,timeZone:'UTC',working:true,tool:'WebSearch',test:{verdict:'fail',failed:999},lastActiveAt:wednesday-47*3600000,mood:'flustered'})
  expect(longest).toBe('Now: Wednesday 23:40. Claude is searching the web. Last tests: 999 failed. They were away 47 h. Your face: flustered.')
  const empty=talkEstimate(PERSONA,longest+'\nperson: ')
  // Measured on the shipped words 10-14 (v7, which ends with the texting paragraph, a long context line, no history):
  // 7,219 bytes plus the estimate's 2,000 margin. 10-10 with v4 it was 2,739.
  const MEASURED=9219
  expect(empty).toBeLessThanOrEqual(Math.floor(MEASURED*1.1))
 })
 test('a long chat stays under 100,000 and keeps as much whole history as fits under 90,000 when no notes can be written',async()=>{
  // Short messages from the person (talk, not work) and long answers from him.
  const answer=(i:number)=>`answer ${i} `.padEnd(1350,'m')
  const {f,r}=runtime((_,index)=>({text:answer(index)}),{},{'more.model.talk.persona':PERSONA})
  for(let i=0;i<120;i++)await r.talk(f.$,filler(i,150),AT)
  expect(f.requests.length).toBe(120)
  const line=(text:string)=>talkEstimate(text)-2000
  for(const request of f.requests)expect(talkEstimate(request.system!,request.prompt)).toBeLessThanOrEqual(TALK_CAP)
  const last=f.requests.at(-1)!.prompt,kept=last.split('\n').filter(row=>row.startsWith('person: exchange ')).length-1
  expect(kept).toBeGreaterThan(40)
  // One more whole exchange would not have fitted the history budget.
  const history=last.slice(0,last.lastIndexOf('person: exchange 119'))
  const one=line(`person: ${filler(0,150)}\n`)+line(`him: ${answer(0)}\n`)
  expect(line(history)).toBeLessThanOrEqual(TALK_HISTORY);expect(line(history)+one).toBeGreaterThan(TALK_HISTORY)
  expect(history.startsWith('person: exchange ')).toBe(true)
  expect(last.includes(filler(0,150))).toBe(false);expect(last.includes(TALK_NOTES_HEAD)).toBe(false)
 })
 test('auto-compact: none under the trigger; over it one notes call and one reply, the notes replace the older exchanges, the recent stay word for word',async()=>{
  const debug:string[]=[]
  const {f,r}=runtime(request=>request.system===COMPACT?{text:'NOTES: they fix a parser; we joke about commas.'}:{text:'Mm.'},{debug:step=>{debug.push(step)}})
  // Under the trigger: one call per Send.
  r.exchanges=Array.from({length:40},(_,i)=>({side:i%2?'him' as const:'person' as const,text:filler(i,1000)}))
  await r.talk(f.$,'hello',AT)
  expect(f.requests.length).toBe(1);expect(f.requests[0]!.system).toBe(PERSONA)
  // Over it: the notes first, then his reply.
  r.exchanges=Array.from({length:90},(_,i)=>({side:i%2?'him' as const:'person' as const,text:filler(i,1000)}))
  const before=structuredClone(r.exchanges)
  await r.talk(f.$,'and now?',AT)
  expect(f.requests.length).toBe(3)
  const notes=f.requests[1]!,reply=f.requests[2]!
  expect(notes.system).toBe(COMPACT);expect(notes.maxTokens).toBe(1000);expect(notes.model).toBe('haiku')
  expect(notes.prompt.includes(filler(0,1000))).toBe(true)
  expect(reply.system).toBe(PERSONA);expect(reply.maxTokens).toBe(undefined)
  expect(reply.prompt.startsWith(TALK_NOTES_HEAD+'\nNOTES: they fix a parser; we joke about commas.\n')).toBe(true)
  expect(talkEstimate(reply.system!,reply.prompt)).toBeLessThanOrEqual(TALK_CAP)
  // The recent exchanges ride word for word; what the notes hold left the history.
  const recent=before.filter(item=>reply.prompt.includes(`${item.side}: ${item.text}\n`))
  expect(recent.length).toBeGreaterThan(0);expect(recent.length%2).toBe(0)
  const recentBytes=recent.reduce((sum,item)=>sum+talkEstimate(`${item.side}: ${item.text}\n`)-2000,0)
  expect(recentBytes).toBeLessThanOrEqual(TALK_RECENT)
  for(const item of before.slice(0,before.length-recent.length)){expect(notes.prompt.includes(item.text)).toBe(true);expect(reply.prompt.includes(item.text)).toBe(false)}
  expect(r.exchanges.slice(0,recent.length)).toEqual(recent)
  expect(debug).toEqual([`talk compacted: ${(before.length-recent.length)/2} exchanges into the notes`])
  // Both calls count in Today, at what each one used; only the person's message counts as one.
  const used=f.requests.map(request=>counted(request,request.system===COMPACT?'NOTES: they fix a parser; we joke about commas.':'Mm.')).reduce((n,u)=>n+u.input_tokens+u.output_tokens,0)
  expect(r.today.rows.talk).toEqual({n:2,tokens:used,cacheRead:0})
  // The notes live in session memory only.
  expect(JSON.stringify(f.stored).includes('NOTES:')).toBe(false)
  // The next Send carries the notes and needs no new compact.
  await r.talk(f.$,'one more',AT)
  expect(f.requests.length).toBe(4);expect(f.requests[3]!.prompt.startsWith(TALK_NOTES_HEAD)).toBe(true)
  r.clearSession();await r.talk(f.$,'fresh',AT)
  expect(f.requests[4]!.prompt.includes('NOTES:')).toBe(false)
 })
 test('auto-compact: a failed notes call falls back to the newest whole exchanges under 90,000; the writing state shows while it runs',async()=>{
  let release!:()=>void
  const hold=new Promise<void>(resolve=>{release=resolve})
  const {f,r}=runtime(request=>request.system===COMPACT?{text:'',isAnswered:false,hold}:{text:'Mm.'})
  r.exchanges=Array.from({length:90},(_,i)=>({side:i%2?'him' as const:'person' as const,text:filler(i,1000)}))
  const sent=r.talk(f.$,'and now?',AT);await settle()
  expect(f.requests.length).toBe(1);expect(r.talkWriting).toBe(true)
  release();await sent
  expect(f.requests.length).toBe(2)
  const reply=f.requests[1]!.prompt
  expect(reply.includes(TALK_NOTES_HEAD)).toBe(false);expect(reply.includes(filler(0,1000))).toBe(false);expect(reply.includes(filler(89,1000))).toBe(true)
  const kept=r.exchanges.slice(0,90).filter(item=>reply.includes(`${item.side}: ${item.text}\n`))
  expect(kept.length%2).toBe(0);expect(kept[0]!.side).toBe('person')
  expect(talkEstimate(...kept.map(item=>`${item.side}: ${item.text}\n`))-2000).toBeLessThanOrEqual(TALK_HISTORY)
  expect(talkEstimate(f.requests[1]!.system!,reply)).toBeLessThanOrEqual(TALK_CAP)
 })
 // his 10-17 card 「用上一条的实际数校准」: bytes over-count Chinese about threefold, so the last reply's own count decides
 test('a Chinese chat compacts by the last reply\'s own token count, not by its bytes; with no count yet, by bytes',async()=>{
  const zh=(i:number)=>`第${i}段`.padEnd(700,'字')
  const many=(n:number)=>Array.from({length:n},(_,i)=>({side:i%2?'him' as const:'person' as const,text:zh(i)}))
  // three bytes a token, near what a Chinese chat costs
  const third=(request:Request):Answer=>request.system===COMPACT?{text:'NOTES: earlier.'}:{text:'嗯。',usage:{...USAGE,input_tokens:Math.ceil(talkEstimate(request.system??'',request.prompt)/3),output_tokens:2}}
  const {f,r}=runtime(third)
  r.exchanges=many(30)
  await r.talk(f.$,'在吗',AT)
  expect(f.requests.length).toBe(1);expect(f.requests[0]!.system).toBe(PERSONA)
  // 14 more of the same: by bytes past the trigger, by the count well under it, so nothing is compacted or cut
  r.exchanges=[...r.exchanges,...many(14)]
  expect(talkEstimate(PERSONA,...r.exchanges.map(item=>`${item.side}: ${item.text}\n`))).toBeGreaterThan(TALK_COMPACT_TRIGGER)
  await r.talk(f.$,'还在吗',AT)
  expect(f.requests.length).toBe(2);expect(f.requests[1]!.system).toBe(PERSONA);expect(f.requests[1]!.prompt.includes(zh(0))).toBe(true)
  // the same chat with no reply counted yet goes by bytes and writes notes first
  const fresh=runtime(third)
  fresh.r.exchanges=[...many(30),{side:'person',text:'在吗'},{side:'him',text:'嗯。'},...many(14)]
  await fresh.r.talk(fresh.f.$,'还在吗',AT)
  expect(fresh.f.requests[0]!.system).toBe(COMPACT)
 })
 test('with Talk off nothing is called, nothing waits on a clock and no notes are written',async()=>{
  const f=fake(()=>({text:'Mm.'})),r=new MoreRuntime(WORDS);r.restore({},[],undefined,AT)
  r.exchanges=Array.from({length:200},(_,i)=>({side:i%2?'him' as const:'person' as const,text:filler(i,1000)}))
  for(let i=0;i<20;i++)expect(r.talk(f.$,'hello '+i,AT)).toBe(undefined)
  expect(f.requests.length).toBe(0);expect(f.alive().length).toBe(0);expect(f.stored.length).toBe(0)
  expect(talkEstimate(PERSONA,'person: hello')).toBeLessThan(TALK_COMPACT_TRIGGER)
 })
})
