import type { EngineInterface, ModelUsage, SessionUsage, ConfigValue } from 'claude-code'
import { MORE_IDS, MORE_ASK, MORE_SERVICE_ROWS, MORE_SERVICE_SLOT, moreValues, moreDay, moreOn, moreRowSupported } from './more-state'
import type { MoreId, MoreSnapshot, MoreValues, MoreToday, MorePayerChoice, MoreKey, MoreKeyToday, MoreKeyView, MoreModels, MoreModelRow, MoreLines } from './more-state'
import { moreModelFor } from './more-models'
import { installWritten, installEdited, useWritten, writtenLinesFrom, shippedLines, linesText, linesFromText, LINE_GROUPS } from './line-library'
import { LANGS } from './words'
import type { LineCharacter, LineSet, LineMix } from './line-library'
import { moreWord, moreFill } from './more-words'
import { numberText } from './numbers'
import { secretHits, hideSecrets, secretHash } from './more-secrets'
import { joinPath } from './paths'
import type { MoreExchange } from './more-book'
import { sayItPlainRewritePrompt } from './say-it-plain-runtime'
import { splitTalkReply, talkTurnText, talkPause, talkContextLine, talkHistory, TALK_GAP_MIN } from './talk-parts'
import type { TalkFacts } from './talk-parts'
import { OPENER_QUIET_MS } from './talk-openers'
import type { OpenerFacts, OpenerGroup } from './talk-openers'
import { dmInitial, dmState, dmMoment, dmMomentLine, dmWrote, dmArrived, dmAnswered, dmSeen, dmSpoken } from './dm'
import type { DmState, DmFirst } from './dm'
import { runTalkKey, keyMessages, keyFailure, keyFailureText, keyCost, keyPriced, talkKeyPath, KEY_DIALOG_TIMEOUT } from './talk-key'
import type { KeyFailure, KeyHost, KeyPrice, KeyReply, KeyRequest, KeyStore } from './talk-key'
export type { MorePayerChoice, MoreKey, MoreKeyToday, MoreKeyView } from './more-state'
export const MISSING_MORE_MODEL_SLOTS=['more.model.talk.persona','more.model.talk.compact','more.model.talk.first','more.model.look.prompt','more.model.lines.coco','more.model.lines.dake','more.model.lines.maid'] as const
// Talk's history (owner, 10-10): compact into his notes once a Send would estimate over the trigger, keeping the
// newest exchanges that fit TALK_RECENT verbatim; without a compact, keep the newest that fit TALK_HISTORY (about
// 90,000 since his 10-17 「记录8万改成上下文9万」). The whole request never passes TALK_CAP (TALK-KEY 2). Estimates
// are the conservative byte count below.
export const TALK_COMPACT_TRIGGER=95000
export const TALK_RECENT=20000
export const TALK_HISTORY=90000
// A reply has no cap of its own (owner 10-17: 「单条放开」): the request names none, so Claude Code's own default
// (model.complete's maxTokens, 1,024) holds on the plan, and the key program takes the model's own limit. A plan reply
// that reaches that default is counted, as the 400 was.
export const TALK_DEFAULT_REPLY_TOKENS=1024
export const TALK_COMPACT_TOKENS=1000
export const TALK_NOTES_HEAD='Your notes from earlier in this chat:'
// Talk remembers them across sessions (owner 10-17: 「记住最近的聊天」): the newest plain chat, at most this many items and
// this estimate, and its notes, kept on this computer only; secrets hidden, work and failure lines never kept.
export const TALK_MEMORY_ITEMS=24
export const TALK_MEMORY=6000
export type TalkMemory={exchanges:{side:'person'|'him';text:string}[];summary?:string}
// A failure line (TALK-KEY 3) is a bubble too: shown in his place, never his voice, never in a prompt.
export type MoreBubble={side:'person'|'him';text:string;work?:string;failure?:KeyFailure;retry?:string}
export type MoreModelWords=Partial<Record<typeof MISSING_MORE_MODEL_SLOTS[number],string>>
type Timer={cancel:()=>void}
// A written set of lines: 24 groups of three short lines, one JSON object (line-library.ts), well under this.
export const LINES_WRITE_TOKENS=3000
// TALK-KEY 2: bytes over-count tokens; the NFKC form covers a normalising tokenizer.
export const TALK_CAP=100000
/** The persona is checked at this many bytes or fewer (TALK-KEY 2); a longer one fails closed. 10,000 since the
 * owner's card of 10-14 (lanes/B.md: 「放宽到 1 万字节」); his persona since then is 7,093 bytes. */
export const TALK_PERSONA_LIMIT=10000
// Her first messages written by the model (dm.ts): one to three short texts, never a long reply.
export const DM_FIRST_TOKENS=300
/** Explain sends nothing for text over this many bytes (its prompt and framing fill the rest of the cap). */
export const EXPLAIN_TEXT_LIMIT=96500
const utf8=(text:string)=>new TextEncoder().encode(text).length
export function talkEstimate(...parts:string[]):number{return parts.reduce((sum,part)=>sum+Math.max(utf8(part),utf8(part.normalize('NFKC'))),2000)}
const textBytes=(text:string)=>Math.max(utf8(text),utf8(text.normalize('NFKC')))
/** Backticks, a path, a URL or over 160 characters: that one is for Claude. */
export function talkLooksLikeWork(text:string):boolean{return /`|(?:\/|\\)[\w.-]+|https?:\/\//.test(text)||text.length>160}
let styleWriteTail:Promise<void>|undefined
// The engine's outputStyle row offers only the built-in styles (2.1.304: «For custom styles, open /config.») and refuses a
// plugin's, so that one goes the way `/output-style <style>` sets it; the row read back says whether it took.
async function setOutputStyle($:EngineInterface,value:ConfigValue):Promise<{deny?:unknown}>{
 const result=await $.config.set({key:'outputStyle',value})
 if(result.deny===undefined||typeof value!=='string')return result
 await $.command.run({command:'output-style',args:value})
 return (await $.config.list()).find(row=>row.key==='outputStyle')?.value===value?{}:result
}
export type MoreBindings={
 changed?:(snapshot:MoreSnapshot)=>void|Promise<void>
 openBook?:(page:'talk'|'him'|'settings',stillCurrent?:()=>boolean)=>void|Promise<void>
 line?:(text:string,kind:'safety'|'note',ms:number)=>void
 dataFolder?:()=>string|undefined
 livelyStopped?:()=>void
 /** Facts for Talk's context line: only enumerated values and numbers (talk-parts.ts). */
 talkFacts?:()=>TalkFacts
 /** The language of what the person wrote, heard on this computer (mood.ts detectLanguage): no model, no request. */
 hearLanguage?:(text:string)=>{lang:string;confidence:number}|undefined
 /** Debug-only diagnostics (no text of the chat). */
 debug?:(step:string,detail?:Record<string,unknown>)=>void
 // Where the key program lives and whether this is the desktop app; undefined where it cannot run.
 keyHost?:()=>Promise<KeyHost|undefined>
 // K1's price row for a Claude model on api.anthropic.com, for the key's Today line.
 keyPrice?:(model:string)=>Promise<KeyPrice|undefined>
 // The line library's folder (~/.config/coco/lines), the system's text editor on one of its files, and a character's
 // name for a file's head.
 linesFolder?:()=>string|undefined
 openFile?:(path:string)=>Promise<boolean>
 characterName?:(character:LineCharacter)=>string
 /** Coco's line as Talk opens, or after ten quiet minutes (`quiet`), lane B's words with its slots filled (talk-openers.ts). */
 opener?:(quiet:boolean)=>string|undefined
 /** The chat to remember for the next session, or undefined to forget it (Talk switched off). */
 remember?:(memory:TalkMemory|undefined)=>void
 /** One of her lines for a DM moment (dm.ts), lane B's talk.open.<moment> words with their slots filled. */
 dmLine?:(moment:OpenerGroup)=>string|undefined
 /** The DM thread's counts changed: store them and redraw the band and the pet. */
 dmChanged?:(state:DmState)=>void
 /** Her messages reached the thread while it was closed: notify, unless the person turned that off. */
 dmArrived?:(texts:string[])=>void
}
// No hook is registered by this module. Existing event handlers call the matching method.
// Every off path returns synchronously before an engine operation, promise or clock read.
const moreBoundarySupported=moreRowSupported
// What the second look's reader is told when it reaches past the changed files (model-facing, never shown).
export const LOOK_DENY='Only the changed files listed in the request can be read, each by its own path.'
// The person's language by its English name, the last line of a request whose answer is shown to them (lane B's
// instructions: «Write in the language named at the end»): the second look's, Claudie's lines, her first DMs.
const MORE_LANGUAGE:Record<string,string>=Object.fromEntries(LANGS.map(lang=>[lang.code,lang.english]))
// A message is heard by name at the band's own bar (mood.ts HEARING.sure); one with this many letters and no name heard
// is still words in some language, so his reply follows it rather than an older one.
const TALK_LANGUAGE_SURE=0.7,TALK_LANGUAGE_LETTERS=6
function boundedMoreValues(values:MoreValues):MoreValues {const safe={...values};for(const id of MORE_IDS)if(!moreBoundarySupported(id))delete safe[id];return safe}
// 口语版 keeps the original's exact parts (his card 10-20): a code line or span, a link, or a number of two or more
// digits missing from the rewrite shows the original instead.
export function rewriteKeepsExact(source:string,rewrite:string):boolean{
 const digits=(text:string):string=>text.replace(/(\d),(?=\d{3})/g,'$1')
 const items:string[]=[]
 const prose=source.replace(/```[^\n]*\n([\s\S]*?)```/g,(_,body:string)=>{for(const line of body.split('\n'))if(line.trim())items.push(line.trim());return ' '}).replace(/`([^`\n]+)`/g,(_,span:string)=>{items.push(span.trim());return ' '})
 for(const m of prose.matchAll(/https?:\/\/[^\s)\]>'"]+/g))items.push(m[0].replace(/[.,;:!?。，；：！？]+$/,''))
 for(const m of digits(prose).matchAll(/(?<![\w.])\d+(?:\.\d+)*%?/g))if(m[0].replace(/\D/g,'').length>=2)items.push(m[0])
 const flat=digits(rewrite)
 return items.every(item=>flat.includes(digits(item)))
}
export class MoreRuntime {
 values:MoreValues={}
 // «Keep the cache warm» (COST-CACHE 7.1) is main's row, read by its keeper from the same store object; M1 draws no
 // row for it yet (K1b) but keeps it through every save and counts it as a row that is on.
 private keepWarm:boolean|undefined
 agreed:MoreId[]=[]
 today:MoreToday={date:'',rows:{}}
 asking?:MoreId
 focused?:MoreId
 entryFocused=false
 open=false
 reading=0
 lang='en'
 screenReader=false
 exchanges:MoreExchange[]=[]
 /** What the Talk tab shows: each of his messages on its own, in the order they appeared (exchanges is the history). */
 talkView:MoreBubble[]=[]
 // The DM thread's own state (dm.ts, owner's cards 10-17 late): unread, her first messages, notifications.
 private dmCounts:DmState=dmInitial()
 private dmWriting=false
 // Where the thread ended after her own last messages: opened while they still end it, Talk adds no opener on top.
 private dmStands=-1
 private talkSummary=''
 // The last plan reply's own count: the bytes estimated for what was sent plus the reply, the tokens the API counted
 // for both, and the notes it went with (talkSize).
 private talkMeasured?:{bytes:number;tokens:number;summary:string}
 // His messages still to come, in order, across replies: one queue so no two ever appear at once (owner, 10-10).
 private pendingParts:{bubble:MoreBubble;quick:boolean}[]=[]
 private lastShownPart=''
 private revealTimer?:Timer
 // The 0.2 s after one of his messages appears, while nothing else of his may.
 private settleTimer?:Timer
 private revealEngine?:EngineInterface
 private talkVisible=true
 private lastTalkAt=0
 // Talk opening up on its own (T5): open since it was last drawn shut; Coco's last opener and how much of the tab stood
 // then; the ten quiet minutes' clock, and whether its line was said since the person last wrote.
 private talkOpen=false
 private openerAt=-Infinity
 private openerSeen=-1
 private openerEngine?:EngineInterface
 private quietTimer?:Timer
 private quietSaid=false
 explanation=''
 talkInput=''
 busy=false
 private busyOwner?:'talk'|'explain'
 lastAnswer=''
 lastRequestAt=0
 cacheTtl=300000
 private previousStyle?:ConfigValue
 private styleWrites?:Promise<void>
 private asked=new Set<string>()
 private capHeld?:Promise<{deny:string}|undefined>
 private capStopped=false
 private selectedCap?:number
 private alive?:Timer
 private keptKeys=new Set<string>()
 private pasteHashes:string[]=[]
 private pasteKind?:string
 private operationEpochs:Partial<Record<MoreId,number>>={}
 private lookToken?:number
 private sessionGeneration=0
 private completions=new Map<MoreId,Set<AbortController>>()
 private registeredLook=false
 private lookBusy=false
 private lookUsageSlots=0
 private clearedLookIds=new Set<string>()
 // Every reader spawned as the second look, by id, and the other agents already found not to be one.
 private lookIds=new Set<string>()
 private otherAgents=new Set<string>()
 // The files the reader may open, fixed as it is spawned (a new prompt starts a new list of changes).
 private lookAllowed=new Set<string>()
 lookAgentId?:string
 lookText=''
 lookFindingCount?:number
 diaryPage=''
 private diaryBusy=false
 private diaryDays=new Set<string>()
 private dayCounts:{date:string;prompts:number;turns:number;tools:Record<string,number>;tests:number;helpers:number;awakeHours:number}={date:'',prompts:0,turns:0,tools:{},tests:0,helpers:0,awakeHours:0}
 private changedPaths=new Set<string>()
 private editInputs:string[]=[]
 private editsCut=false
 // TALK-KEY 3: who pays for Talk and Explain, and the key program's own state. The key itself is never here.
 payerChoice:MorePayerChoice='session'
 key?:MoreKey
 keyToday:MoreKeyToday={date:'',n:0,tokens:0,usd:0,day:0}
 keyNoRun=false
 keyNotice?:string
 keyBusy=false
 // The base URL and model the person typed for the next add; unset means Anthropic and claude-haiku-5-5.
 keyBase?:string
 keyModel?:string
 // TALK-KEY 2 self-correction: 2 once a reply's usage was over its estimate.
 estimateFactor=1
 // What Talk and the second look may run on, read once a session from Claude Code's own settings (more-models.ts).
 private models?:MoreModels
 // The line library (owner 10-17, his cards): the form worn; the sets written, by character and language (kept in
 // 'more.lines' as they were written); the one being written and those that failed this session (written again only
 // on Write again); the language picked for them and Coco's mix; and the files as last read (their mtime and lines),
 // where they are and whether the editor opened.
 private linesForm?:'dake'|'maid'
 private linesSets:Record<string,{lines:LineSet;at:number}>={}
 private linesBusy?:string
 private linesFailed=new Set<string>()
 private linesLang?:string
 private linesMix:LineMix='both'
 private linesSeen:Record<string,number|undefined>={}
 private linesEdits:Record<string,LineSet>={}
 private linesPaths:{shipped?:string;generated?:string}={}
 // The sets whose file the person has opened, by slot: only those are looked at on disk before a line is said.
 private linesOpened=new Set<string>()
 private linesEditFailed?:'shipped'|'generated'
 constructor(private modelWords:MoreModelWords={},private bindings:MoreBindings={}){}
 snapshot():MoreSnapshot{return{values:boundedMoreValues(this.values),agreed:[...this.agreed],today:structuredClone(this.today),asking:this.asking,focused:this.focused,entryFocused:this.entryFocused,reading:this.reading,open:this.open,lang:this.lang,screenReader:this.screenReader,key:this.keyView(),...(this.models?{models:structuredClone(this.models)}:{}),lines:this.linesView(),dm:{first:this.dmCounts.first,notify:this.dmCounts.notify,model:this.dmModelReady,unread:this.dmCounts.unread}}}
 keyView():MoreKeyView{return{payer:this.payer(),...(this.key?{key:{...this.key}}:{}),...(this.keyToday.date?{today:{...this.keyToday}}:{}),noRun:this.keyNoRun,...(this.keyNotice?{notice:this.keyNotice}:{}),busy:this.keyBusy,...(this.keyBase?{base:this.keyBase}:{}),...(this.keyModel?{model:this.keyModel}:{})}}
 private keyAt():{host?:string;model?:string}{return{...(this.key?.host?{host:this.key.host}:{}),...(this.key?.model?{model:this.key.model}:{})}}
 /** The key pays only when chosen and the program can run here. */
 payer():MorePayerChoice{return this.payerChoice==='key'&&!this.keyNoRun?'key':'session'}
 restoreKey(payer:unknown,key:unknown,today:unknown,factor:unknown,now:number):void{
   this.payerChoice=payer==='key'?'key':'session'
   const k=key as Partial<MoreKey>|undefined
   this.key=k&&typeof k==='object'&&typeof k.last4==='string'&&/^[!-~]{4}$/.test(k.last4)&&(k.state==='works'||k.state==='refused'||k.state==='unchecked')?{last4:k.last4,state:k.state,...(typeof k.store==='string'?{store:k.store as KeyStore}:{}),...(typeof k.host==='string'?{host:k.host}:{}),...(typeof k.model==='string'?{model:k.model}:{})}:undefined
   const t=today as Partial<MoreKeyToday>|undefined
   this.keyToday=t&&typeof t==='object'&&t.date===moreDay(now)&&[t.n,t.tokens,t.usd,t.day].every(v=>typeof v==='number'&&Number.isFinite(v))?t as MoreKeyToday:{date:'',n:0,tokens:0,usd:0,day:0}
   const f=factor as {factor?:unknown}|undefined
   this.estimateFactor=f&&typeof f==='object'&&f.factor===2?2:1
 }
 private over(estimate:number):boolean{return estimate*this.estimateFactor>TALK_CAP}
 // A request's size for the compaction trigger and the cap (his 10-17 card: 「用上一条的实际数校准」). Bytes over-count
 // tokens, Chinese most, so on the plan the last reply's own count (what was sent and what came back, exact in every
 // language) stands for all that came before, and only what is new since is counted in bytes: still never under the
 // real count. Bytes alone for the first message, after notes are written, and on the person's own key, whose
 // program holds its own byte cap before anything is sent.
 private talkSize(payer:MorePayerChoice,...parts:string[]):number{
   const bytes=talkEstimate(...parts),m=this.talkMeasured
   return payer!=='key'&&m&&m.summary===this.talkSummary?Math.min(bytes,m.tokens+Math.max(0,bytes-m.bytes)):bytes
 }
 isOn(id:MoreId):boolean{return moreBoundarySupported(id)&&this.canSend(id)&&moreOn(this.values,id)}
 operationToken(id:MoreId):number{return this.operationEpochs[id]??0}
 operationCurrent(id:MoreId,token:number):boolean{return this.isOn(id)&&this.canSend(id)&&this.operationToken(id)===token}
 // `switchedOff` is false when the session ends or is cleared: the DM thread and its kept chat stay for the next one.
 private invalidateOperation(id:MoreId,switchedOff=true):void{
   this.operationEpochs[id]=this.operationToken(id)+1
   for(const controller of this.completions.get(id)??[])controller.abort()
   if(id==='talk'&&switchedOff&&moreOn(this.values,'talk')){
     this.bindings.remember?.(undefined)
     if(this.dmCounts.unread||this.dmCounts.unanswered){this.dmCounts=dmAnswered(dmSeen(this.dmCounts));this.dmSave()}
   }
   if(id==='talk'){this.dropTalk();this.diaryPage='';if(this.busyOwner==='talk'){this.busy=false;this.busyOwner=undefined}this.diaryBusy=false}
   if(id==='explain'){this.explanation='';if(this.busyOwner==='explain'){this.busy=false;this.busyOwner=undefined}}
   if(id==='look'){this.lookText='';this.lookFindingCount=undefined;this.lookBusy=false;if(this.lookAgentId)this.clearedLookIds.add(this.lookAgentId);this.lookAgentId=undefined;this.lookToken=undefined}
   if(id==='cap'){this.capHeld=undefined;this.asked.clear();this.capStopped=false}
   if(id==='lines')this.linesBusy=undefined
 }
 configure(lang:string,screenReader=false):void{this.lang=lang;this.screenReader=screenReader;this.activateLines()}
 restore(values:unknown,agreed:unknown,today:unknown,now:number,keepSessionCap=false):void{
   const incoming=boundedMoreValues(moreValues(values)),sessionCap=keepSessionCap&&typeof this.selectedCap==='number'&&incoming.cap===this.selectedCap?this.values.cap:undefined
   for(const id of MORE_IDS)if(moreOn(this.values,id)&&!moreOn(incoming,id))this.invalidateOperation(id)
   if(incoming.cap!==this.selectedCap)this.invalidateOperation('cap')
   this.values=incoming
   // The band's shared settings carry no warm row, so a restore without one keeps what this session knows.
   const warm=values&&typeof values==='object'?(values as Record<string,unknown>).warm:undefined
   if(typeof warm==='boolean')this.keepWarm=warm
   this.selectedCap=typeof this.values.cap==='number'?this.values.cap:undefined
   if(typeof sessionCap==='number')this.values.cap=sessionCap
   this.agreed=Array.isArray(agreed)?agreed.filter((id):id is MoreId=>MORE_IDS.includes(id as MoreId)):[]
   this.today=today&&typeof today==='object'&&(today as MoreToday).date===moreDay(now)?structuredClone(today as MoreToday):{date:moreDay(now),rows:{}}
   this.syncOff()
 }
 private syncOff():void{
   this.activateLines()
   if(!this.isOn('lively'))this.stopLively()
   if(!this.isOn('paste')){this.pasteHashes=[];this.pasteKind=undefined}
 }
 warmOn():boolean{return this.keepWarm===true}
 // Keeping the cache warm is switched in the cost runtime, which stores it in 'more' itself; this keeps a later save from
 // dropping it (lane C, 10-14).
 noteWarm(on:boolean):void{this.keepWarm=on}
 private persistedValues():MoreValues&{warm?:boolean}{return{...boundedMoreValues(this.values),...(this.selectedCap===undefined?{}:{cap:this.selectedCap}),...(this.keepWarm===undefined?{}:{warm:this.keepWarm})}}
 private changedSnapshot():MoreSnapshot{return{...this.snapshot(),values:this.persistedValues()}}
 private async save($:EngineInterface):Promise<void>{
   this.syncOff()
   // Another session may have switched keeping warm since this one read it; a save carries the stored row (10-20).
   const stored=await $.store.get('more'),warm=stored&&typeof stored==='object'?(stored as Record<string,unknown>).warm:undefined
   if(typeof warm==='boolean')this.keepWarm=warm
   await $.store.set('more',this.persistedValues())
   await $.store.set('more.agreed',this.agreed)
   await this.bindings.changed?.(this.changedSnapshot())
   $.ui.invalidate('ui.render')
 }
 select($:EngineInterface,value:string):Promise<void>|undefined{
   if(!['0','1','5','20'].includes(value))return
   if(Number(value)!==this.selectedCap)this.invalidateOperation('cap')
   this.values.cap=Number(value);this.selectedCap=Number(value);this.asked.clear();this.capStopped=false
   return this.save($)
 }
 focus(element?:string):boolean{
   const id=element?.match(/^coco:more:([^:]+)/)?.[1]
   const next=MORE_IDS.includes(id as MoreId)?id as MoreId:undefined
   const entryFocused=element==='coco:more:open'
   if(next===this.focused&&entryFocused===this.entryFocused)return false
   this.entryFocused=entryFocused
   this.focused=next;return true
 }
 scroll(by:number):boolean{if(!this.open)return false;this.reading=Math.max(0,Math.min(15,this.reading+by));return true}
 press($:EngineInterface,key:string):Promise<boolean>|boolean{
   if(key==='coco:more:open'){this.open=true;this.reading=0;return true}
   if(key==='coco:more:back'){this.open=false;return true}
   const match=key.match(/^coco:more:([^:]+):(on|off|ask:yes|ask:no|help|pick:\d+|model:\d+|redo|drop|lang:[A-Za-z-]+|mix:(?:only|both)|edit:(?:shipped|generated)|restore:(?:shipped|generated))$/)
   if(!match||!MORE_IDS.includes(match[1] as MoreId))return false
   const id=match[1] as MoreId,action=match[2]!
   if(action.startsWith('model:'))return id==='talk'||id==='explain'||id==='look'||id==='lines'?this.chooseModel($,id==='look'||id==='lines'?id:'talk',Number(action.slice(6))):false
   if(id==='lines'&&(action==='redo'||action==='drop'||/^(?:mix|edit|restore):/.test(action))){
     const [verb,arg]=action.split(':') as [string,string|undefined]
     if(verb==='redo')return this.redoLines($)
     if(verb==='drop')return this.dropLines($)
     if(verb==='mix')return this.chooseLinesMix($,arg!)
     return verb==='edit'?this.editLines($,arg as 'shipped'|'generated'):this.restoreLinesSet($,arg as 'shipped'|'generated')
   }
   if(action.startsWith('lang:'))return id==='lines'?this.chooseLinesLang($,action.slice(5)):false
   if(!moreBoundarySupported(id)&&action!=='help'&&action!=='off')return false
   if(action==='help'){this.focused=this.focused===id?undefined:id;return true}
   if(id==='cap'&&action.startsWith('pick:'))return this.select($,action.slice(5))?.then(()=>true)??false
   if(action==='ask:no'){this.asking=undefined;return true}
   if(action!=='off'&&!this.canSend(id))return false
   if(action==='on'&&MORE_ASK.has(id)&&!this.agreed.includes(id)){this.asking=id;return true}
   if(action==='ask:yes'){
     if(this.asking!==id)return false
     this.agreed.push(id);this.asking=undefined
   }
   if(action==='off'&&moreOn(this.values,id))this.invalidateOperation(id)
   if(id==='plain')return this.style($,action!=='off').then(()=>true)
   this.values[id]=action!=='off'
   const work=this.save($).then(async()=>{
     if(this.isOn(id)&&id==='look')await this.registerLook($)
     if(this.isOn(id)&&id==='lines')await this.lines($)
     return true
   })
   return work
 }
 private w(key:string):string{return moreWord(key,this.lang)}
 // Talk also needs its persona and the second look its instruction (fail closed): without them the row cannot turn on
 // and nothing is routed to it. Each needs a model too, which on the person's own connection they pick first.
 private canSend(id:MoreId):boolean{return (!MORE_SERVICE_ROWS.has(id)||!!this.w(MORE_SERVICE_SLOT))&&(id!=='talk'||!!this.modelWords['more.model.talk.persona'])&&(id!=='look'||!!this.modelWords['more.model.look.prompt'])&&(id!=='lines'||!!this.modelWords['more.model.lines.coco']&&!!this.modelWords['more.model.lines.dake']&&!!this.modelWords['more.model.lines.maid'])&&!this.needsModel(id)}
 // Explain runs on Talk's pick (his 10-17 card: 「跟聊天用同一个选择」); the person's own key brings its own model.
 private needsModel(id:MoreId):boolean{
   if(id==='look'||id==='lines')return this.modelFor(id)===undefined
   return (id==='talk'||id==='explain')&&this.payer()!=='key'&&this.modelFor('talk')===undefined
 }
 modelFor(row:MoreModelRow):string|undefined{return moreModelFor(this.models,row)}
 /** The choices for this session, and the picks kept from earlier ones ('more.models'). */
 setModels(models:MoreModels,picks:unknown):void{
   const kept=picks&&typeof picks==='object'?picks as Record<string,unknown>:{}
   this.models={choices:models.choices.map(choice=>({...choice})),own:models.own,picks:Object.fromEntries((['talk','look','lines'] as const).flatMap(row=>typeof kept[row]==='string'?[[row,kept[row]]]:[]))}
   this.syncOff()
 }
 /** The person picks the model a row runs on, by its place in the list. */
 async chooseModel($:EngineInterface,row:MoreModelRow,index:number):Promise<boolean>{
   const choice=this.models?.choices[index]
   if(!this.models||!choice)return false
   this.models.picks={...this.models.picks,[row]:choice.value}
   await $.store.set('more.models',this.models.picks)
   await this.save($)
   if(this.isOn(row)&&row==='look')await this.registerLook($)
   if(this.isOn(row)&&row==='lines')await this.lines($)
   return true
 }
 private async completeRow($:EngineInterface,id:MoreId,request:Parameters<EngineInterface['model']['complete']>[0]):ReturnType<EngineInterface['model']['complete']>{
   if(!this.isOn(id)||!this.canSend(id))return {isAnswered:false,reason:'aborted',usage:{input_tokens:0,output_tokens:0,cache_read_input_tokens:0,cache_creation_input_tokens:0}}
   const controller=new AbortController(),pending=this.completions.get(id)??new Set<AbortController>()
   pending.add(controller);this.completions.set(id,pending)
   try{return await $.model.complete(request,{signal:controller.signal})}
   catch(error){if(!controller.signal.aborted)throw error;return{isAnswered:false,reason:'aborted',usage:{input_tokens:0,output_tokens:0,cache_read_input_tokens:0,cache_creation_input_tokens:0}}}
   finally{pending.delete(controller);if(!pending.size)this.completions.delete(id)}
 }
 private async completionAt($:EngineInterface,fallback:number):Promise<number>{try{return await $.clock.now()}catch{return fallback}}
 private async count($:EngineInterface,id:MoreId,usage:ModelUsage|undefined,now:number,n=1,publish=true):Promise<void>{
   const generation=this.sessionGeneration,token=this.operationToken(id)
   if(this.today.date!==moreDay(now))this.today={date:moreDay(now),rows:{}}
   const row=this.today.rows[id]??{n:0,tokens:0,cacheRead:0}
   row.n+=n
   if(usage){const tokens=usage.input_tokens+usage.output_tokens+usage.cache_read_input_tokens+usage.cache_creation_input_tokens;row.tokens+=tokens;row.cacheRead+=usage.cache_read_input_tokens;if(id==='look')row.lastTokens=tokens}
   this.today.rows[id]=row;await $.store.set('more.today',this.today);if(publish&&generation===this.sessionGeneration&&this.operationCurrent(id,token))await this.bindings.changed?.(this.changedSnapshot())
 }
 talk($:EngineInterface,text:string,now:number,payer:MorePayerChoice=this.payer()):Promise<void>|undefined{
   if(!this.isOn('talk')||!this.canSend('talk')||this.busy||this.diaryBusy||!text.trim())return
   const persona=this.modelWords['more.model.talk.persona']
   if(!persona)return // Missing authored text: fail closed; never substitute instructions.
   if(utf8(persona)>TALK_PERSONA_LIMIT)return // TALK-KEY 2 persona lint: never shipped over the bound.
   const generation=this.sessionGeneration,token=this.operationToken('talk')
   this.busy=true;this.busyOwner='talk';this.revealEngine=$
   // Written while his messages are still coming: he finishes them, quicker, then answers (owner, 10-10).
   for(const item of this.pendingParts)item.quick=true
   return this.answer($,text,persona,now,generation,token,payer).finally(()=>{if(generation===this.sessionGeneration&&this.operationToken('talk')===token){this.busy=false;this.busyOwner=undefined;if(this.isOn('talk'))$.ui.invalidate('ui.render')}})
 }
 /** The language his reply is named (owner 10-21, any language): what the person just wrote, heard clearly; else, when
  *  it has words in a language not heard by name, theirs; else (too short: «ok», «好») their last message heard in
  *  this chat; else the band's. Without it a short Chinese line once got Japanese, the persona's examples outweighing it. */
 private replyLanguage(text:string,history:readonly MoreExchange[]):string{
   const named=(said:string)=>{let heard:{lang:string;confidence:number}|undefined;try{heard=this.bindings.hearLanguage?.(said)}catch{};return heard&&heard.confidence>=TALK_LANGUAGE_SURE?MORE_LANGUAGE[heard.lang]:undefined}
   const wordy=(said:string)=>(said.match(/\p{L}/gu)??[]).length>=TALK_LANGUAGE_LETTERS
   const now=named(text)
   if(now)return `Reply in ${now}.`
   if(wordy(text))return 'Reply in the language of their message.'
   for(const item of [...history].reverse()){
     if(item.side!=='person')continue
     const before=named(item.text)
     if(before)return `Reply in ${before}.`
     if(wordy(item.text))return 'Reply in the language of their messages.'
   }
   return MORE_LANGUAGE[this.lang]?`Reply in ${MORE_LANGUAGE[this.lang]}.`:''
 }
 private async answer($:EngineInterface,text:string,persona:string,now:number,generation:number,token:number,payer:MorePayerChoice):Promise<void>{
   const current=()=>generation===this.sessionGeneration&&this.operationCurrent('talk',token)
   // O8's secret families, before any send and either payer: refused and kept nowhere (TALK-KEY 3).
   if(secretHits(text.slice(0,100000)).length){
     this.talkInput=''
     this.failLine({side:'him',text:keyFailureText('pasted',undefined,this.lang),failure:'pasted'})
     return
   }
   // Work goes to Claude by a rule alone (TALK-KEY 2): no model call sorts it. Its 160 characters are under
   // the design's 2,000, so a long message never reaches a model either.
   if(talkLooksLikeWork(text)){
     this.say('person',text);this.lastTalkAt=now
     await this.count($,'talk',undefined,await this.completionAt($,now),1,current())
     if(!current())return
     this.his([{side:'him',text:this.w('talk.work'),work:text}])
     return
   }
   // Work messages, their answers and failure lines never ride in later prompts.
   const items=this.exchanges.filter(item=>!item.work&&!item.failure&&!(item.side==='person'&&this.exchanges.some(other=>other.work===item.text)))
   // The persona ends with his texting paragraph (DECISIONS 10-10): one text, so a new persona is one swap.
   const system=persona
   const facts=this.bindings.talkFacts?.(),language=this.replyLanguage(text,items)
   const context=[facts?talkContextLine(facts,this.lastTalkAt||undefined):'',language].filter(Boolean).join(' ')
   this.lastTalkAt=now
   this.say('person',text)
   const line=(item:MoreExchange)=>`${item.side}: ${item.text}`
   const estimate=(part:string)=>talkEstimate(part)-2000
   const prompt=(history:readonly MoreExchange[])=>[this.talkSummary?TALK_NOTES_HEAD+'\n'+this.talkSummary+'\n':'',...history.map(item=>line(item)+'\n'),context?context+'\n':'','person: '+text].join('')
   let history=items
   // Over the trigger the older exchanges become his notes with one more call on the chat's own payer (on the key,
   // the compact kind, TALK-KEY K4); the newest stay as they are.
   if(this.talkSize(payer,system,prompt(history))>TALK_COMPACT_TRIGGER){
     const recent=talkHistory(items,line,TALK_RECENT,estimate),older=items.slice(0,items.length-recent.length)
     const instruction=this.modelWords['more.model.talk.compact']
     let compacted=false
     if(instruction&&older.length){
       // The compact request stays under TALK_CAP too: the oldest of what it summarises goes first if it must.
       const notesBlock=this.talkSummary?TALK_NOTES_HEAD+'\n'+this.talkSummary+'\n\n':''
       const summarised=talkHistory(older,line,TALK_CAP-talkEstimate(instruction,notesBlock),estimate)
       const body=[notesBlock,...summarised.map(item=>line(item)+'\n')].join('')
       // Its tokens count in Today and its usage; it is not one of the person's messages.
       let written=''
       if(payer==='key'){
         const reply=await this.sendKey($,'talk',{kind:'compact',system:instruction,messages:[{role:'user',content:body}],max_tokens:TALK_COMPACT_TOKENS},talkEstimate(instruction,body),now,0)
         if(!current())return
         if(reply.kind==='ok')written=reply.text??''
       }else{
         const notes=await this.completeRow($,'talk',{model:this.modelFor('talk')??'haiku',system:instruction,prompt:body,maxTokens:TALK_COMPACT_TOKENS})
         await this.count($,'talk',notes.usage,await this.completionAt($,now),0,current())
         if(!current())return
         if(notes.isAnswered)written=notes.text
       }
       if(written.trim()){
         this.talkSummary=written;compacted=true
         const gone=new Set(older);this.exchanges=this.exchanges.filter(item=>!gone.has(item))
         history=recent
         const count=summarised.filter(item=>item.side==='person').length
         this.bindings.debug?.(`talk compacted: ${count} exchanges into the notes`,{exchanges:count})
       }
     }
     // No compact (none written, or it failed): the newest whole exchanges that fit the history budget.
     if(!compacted)history=talkHistory(items,line,TALK_HISTORY,estimate)
   }
   while(history.length&&this.over(this.talkSize(payer,system,prompt(history))))history=talkHistory(history,line,history.reduce((n,item)=>n+estimate(line(item)+'\n'),0)-1,estimate)
   if(this.over(this.talkSize(payer,system,prompt(history)))){
     // In place of his reply, with Ask Claude under it (TALK-KEY 2).
     this.his([{side:'him',text:this.w('talk.tooLong'),work:text}])
     return
   }
   const estimated=talkEstimate(system,prompt(history))
   if(payer==='key'){
     // The same words as the plan's prompt: his notes ride with the persona, the context line with this message.
     const notes=this.talkSummary?TALK_NOTES_HEAD+'\n'+this.talkSummary:''
     const reply=await this.sendKey($,'talk',{system:notes?system+'\n\n'+notes:system,messages:keyMessages(history,context?context+'\n'+text:text)},estimated,now)
     if(!current())return
     if(reply.kind!=='ok'){this.failLine({side:'him',text:keyFailureText(keyFailure(reply),reply,this.lang,this.keyAt()),failure:keyFailure(reply),retry:text});return}
     this.his(splitTalkReply(reply.text??'').map(text=>({side:'him' as const,text})))
     return
   }
   // On the model the person picked; on their own connection none is picked for them (owner 10-17), so a fallback from
   // the key sends nothing until they pick one.
   const model=this.modelFor('talk')
   if(!model){this.his([{side:'him',text:moreFill(this.w('talk.failed'),{reason:'model'})}]);return}
   const result=await this.completeRow($,'talk',{model,system,prompt:prompt(history),effort:'low'})
   await this.count($,'talk',result.usage,await this.completionAt($,now),1,current())
   await this.checkEstimate($,estimated,result.usage)
   if(!current())return
   if(result.isAnswered&&result.usage.output_tokens>=TALK_DEFAULT_REPLY_TOKENS)this.replyCut(now)
   if(result.isAnswered){const u=result.usage;this.talkMeasured={bytes:estimated+textBytes(result.text),tokens:u.input_tokens+u.cache_read_input_tokens+u.cache_creation_input_tokens+u.output_tokens,summary:this.talkSummary}}
   if(result.isAnswered)this.his(splitTalkReply(result.text).map(text=>({side:'him' as const,text})))
   else this.his([{side:'him',text:moreFill(this.w('talk.failed'),{reason:result.reason})}])
 }
 /** A reply that reached its cap is shown as he wrote it; it is counted so we can see how often (lead, 10-10). */
 private replyCut(now:number):void{
   const row=this.today.date===moreDay(now)?this.today.rows.talk:undefined
   if(row)row.cut=(row.cut??0)+1
   this.bindings.debug?.('talk reply reached its token cap',{maxTokens:TALK_DEFAULT_REPLY_TOKENS})
 }
 private say(side:'person',text:string):void{
   this.exchanges.push({side,text})
   this.talkView.push({side,text})
   this.trimTalk()
   this.quietSaid=false;this.armQuiet()
   this.remember()
   if(this.dmCounts.unanswered){this.dmCounts=dmAnswered(this.dmCounts);this.dmSave()}
 }
 /** What Talk keeps for the next session: the newest plain exchanges within the memory's size, secrets hidden. */
 talkMemory():TalkMemory|undefined{
   const hidden=this.w('key.hidden'),plain=this.exchanges.filter(item=>item.work===undefined&&!item.failure).map(item=>({side:item.side,text:hideSecrets(item.text,hidden)}))
   const kept=talkHistory(plain,item=>`${item.side}: ${item.text}`,TALK_MEMORY,part=>talkEstimate(part)-2000).slice(-TALK_MEMORY_ITEMS)
   const summary=this.talkSummary?hideSecrets(this.talkSummary,hidden):''
   return kept.length||summary?{exchanges:kept,...(summary?{summary}:{})}:undefined
 }
 private remember():void{if(this.isOn('talk'))this.bindings.remember?.(this.talkMemory())}
 /** The last session's chat, at the start of this one, while Talk is on and nothing has been said yet. */
 restoreTalk(value:unknown):void{
   if(!this.isOn('talk')||this.exchanges.length||!value||typeof value!=='object')return
   const memory=value as {exchanges?:unknown;summary?:unknown}
   const items=(Array.isArray(memory.exchanges)?memory.exchanges:[]).filter((item):item is {side:'person'|'him';text:string}=>!!item&&typeof item==='object'&&((item as {side?:unknown}).side==='person'||(item as {side?:unknown}).side==='him')&&typeof (item as {text?:unknown}).text==='string').slice(-TALK_MEMORY_ITEMS).map(item=>({side:item.side,text:item.text.slice(0,TALK_MEMORY)}))
   this.exchanges=items.map(item=>({...item}));this.talkView=items.map(item=>({...item}))
   if(typeof memory.summary==='string')this.talkSummary=memory.summary.slice(0,TALK_MEMORY)
   this.trimTalk()
 }
 /**
  * His reply: one history turn (parts joined by blank lines), each part its own message. The first shows now unless
  * one of his is still to come or has just appeared; every other waits its pause behind the ones before it.
  */
 private his(parts:MoreBubble[]):void{
   if(!parts.length)return
   const work=parts.find(part=>part.work)?.work
   this.exchanges.push(work===undefined?{side:'him',text:talkTurnText(parts.map(part=>part.text))}:{side:'him',text:talkTurnText(parts.map(part=>part.text)),work})
   const waiting=this.pendingParts.length>0||this.revealTimer!==undefined||this.settleTimer!==undefined
   const rest=waiting?parts:parts.slice(1)
   if(!waiting)this.showPart(parts[0]!)
   this.pendingParts.push(...rest.map(bubble=>({bubble,quick:false})))
   this.trimTalk()
   if(this.pendingParts.length)this.armReveal();else this.settle()
   this.remember()
   // A reply that reaches a closed thread is unread, and notified like a message (unless the person turned that off).
   if(!this.talkOpen){this.dmCounts=dmArrived(this.dmCounts,parts.length);this.dmSave();this.bindings.dmArrived?.(parts.map(part=>part.text))}
 }
 /** A failure line in his place (TALK-KEY 3): kept in the history for its retry (prompts skip it), shown in turn. */
 private failLine(item:MoreBubble):void{
   this.exchanges.push(item)
   const waiting=this.pendingParts.length>0||this.revealTimer!==undefined||this.settleTimer!==undefined
   if(waiting)this.pendingParts.push({bubble:item,quick:true});else this.showPart(item)
   this.trimTalk()
   if(this.pendingParts.length)this.armReveal();else this.settle()
 }
 private showPart(bubble:MoreBubble):void{this.talkView.push(bubble);this.lastShownPart=bubble.text;this.armQuiet()}
 private armReveal():void{
   if(this.revealTimer||!this.talkVisible||!this.revealEngine||!this.pendingParts.length)return
   this.settleTimer?.cancel();this.settleTimer=undefined
   const $=this.revealEngine,generation=this.sessionGeneration,next=this.pendingParts[0]!
   this.revealTimer=$.clock.after(talkPause(this.lastShownPart,next.bubble.text,next.quick),()=>{
     this.revealTimer=undefined
     if(generation!==this.sessionGeneration)return
     const item=this.pendingParts.shift()
     if(!item)return
     this.showPart(item.bubble);this.trimTalk()
     try{$.ui.invalidate('ui.render')}catch{}
     if(this.pendingParts.length)this.armReveal();else this.settle()
   })
 }
 private settle():void{
   this.settleTimer?.cancel();this.settleTimer=undefined
   if(!this.talkVisible||!this.revealEngine)return
   const generation=this.sessionGeneration
   this.settleTimer=this.revealEngine.clock.after(TALK_GAP_MIN,()=>{this.settleTimer=undefined;if(generation===this.sessionGeneration)this.armReveal()})
 }
 /** His writing state: a call is running or messages of his are still to come. */
 get talkWriting():boolean{return this.busy&&this.busyOwner==='talk'||this.pendingParts.length>0}
 /** The Talk tab is showing again: messages still to come keep their pacing from here; just opened, she may speak first. */
 talkShown($?:EngineInterface):void{
   this.talkVisible=true;this.armReveal()
   if(this.dmCounts.unread){this.dmCounts=dmSeen(this.dmCounts);this.dmSave()}
   if(this.talkOpen)return
   this.talkOpen=true;this.openerEngine=$
   if(!this.isOn('talk'))return
   // One line as it opens, unless Coco is mid-reply, or the last opener still stands unanswered from under ten minutes ago
   // (her own DMs stand until the person writes).
   const now=this.bindings.talkFacts?.().now??this.openerAt
   const standing=this.talkView.length===this.openerSeen&&(now-this.openerAt<OPENER_QUIET_MS||this.dmStands===this.talkView.length)
   if(!this.busy&&!this.pendingParts.length&&!standing)this.opener(false,now)
   this.armQuiet()
 }
 /** Talk closed or the book moved on: nothing is dropped, nothing waits on a clock. */
 talkHidden():void{
   this.talkVisible=false;this.revealTimer?.cancel();this.revealTimer=undefined;this.settleTimer?.cancel();this.settleTimer=undefined
   this.talkOpen=false;this.quietTimer?.cancel();this.quietTimer=undefined
 }
 /** The DM thread's counts (dm.ts): what the person has not seen, and how her first messages and notifications go. */
 dm():DmState{return this.dmCounts}
 restoreDm(value:unknown):void{this.dmCounts=dmState(value)}
 /** Another window's newest counts from the store: her pace and the person's choices are the computer's; what is unread
  *  belongs to this window's thread. */
 shareDm(value:unknown):void{if(value&&typeof value==='object')this.dmCounts={...dmState(value),unread:this.dmCounts.unread}}
 private dmSave():void{this.bindings.dmChanged?.(this.dmCounts)}
 /** The thread was read somewhere else (the pet's DM window). */
 dmRead():void{if(this.dmCounts.unread){this.dmCounts=dmSeen(this.dmCounts);this.dmSave()}}
 /** The person picks where her first messages come from, and whether a new message notifies. */
 setDm(change:{first?:DmFirst;notify?:boolean}):void{
   const next={...this.dmCounts,...(change.first?{first:change.first}:{}),...(change.notify===undefined?{}:{notify:change.notify})}
   if(next.first===this.dmCounts.first&&next.notify===this.dmCounts.notify)return
   this.dmCounts=next;this.dmSave()
 }
 /** Her first messages can be written by the model once lane B's instruction for them is there (fail closed). */
 get dmModelReady():boolean{return !!this.modelWords['more.model.talk.persona']&&!!this.modelWords['more.model.talk.first']}
 /**
  * She writes first while the thread is closed (dm.ts): about the first moment every rule allows, in one to three
  * messages written by the model when the person chose that and it answers, else one of her lines. They land in the
  * thread at once (the pacing is for an open thread), unseen and notified.
  */
 async dmFirst($:EngineInterface,facts:OpenerFacts):Promise<boolean>{
   if(!this.isOn('talk')||this.talkOpen||this.busy||this.dmWriting||this.pendingParts.length)return false
   const moment=dmMoment(this.dmCounts,facts)
   if(!moment)return false
   const generation=this.sessionGeneration
   this.dmWriting=true
   try{
     let texts=this.dmCounts.first==='model'&&this.dmModelReady&&this.canSend('talk')?await this.dmWritten($,moment,facts):[]
     if(generation!==this.sessionGeneration||!this.isOn('talk'))return false
     if(!texts.length){const line=this.bindings.dmLine?.(moment);if(line)texts=[line]}
     texts=texts.map(dmSpoken)
     if(!texts.length)return false
     for(const text of texts){this.exchanges.push({side:'him',text});this.talkView.push({side:'him',text})}
     this.trimTalk();this.lastShownPart=texts.at(-1)!
     // Opening the thread does not add an opener on top of her own messages.
     this.openerAt=facts.now;this.openerSeen=this.dmStands=this.talkView.length
     this.dmCounts=dmWrote(this.dmCounts,moment,facts.now,this.talkOpen?0:texts.length);this.dmSave()
     this.remember()
     if(!this.talkOpen)this.bindings.dmArrived?.(texts)
     return true
   }finally{this.dmWriting=false}
 }
 /** Her first messages written by the model on the chat's payer: lane B's instruction names the moment; the recent
  *  exchanges, his notes and the context line go with it, as with a reply. Nothing written is nothing sent. */
 private async dmWritten($:EngineInterface,moment:OpenerGroup,facts:OpenerFacts):Promise<string[]>{
   const persona=this.modelWords['more.model.talk.persona'],cue=this.modelWords['more.model.talk.first']
   if(!persona||!cue||utf8(persona)>TALK_PERSONA_LIMIT)return []
   const generation=this.sessionGeneration,token=this.operationToken('talk')
   const current=()=>generation===this.sessionGeneration&&this.operationCurrent('talk',token)
   const line=(item:MoreExchange)=>`${item.side}: ${item.text}`
   const items=talkHistory(this.exchanges.filter(item=>!item.work&&!item.failure),line,TALK_RECENT,part=>talkEstimate(part)-2000)
   const talkFacts=this.bindings.talkFacts?.()
   const context=[talkFacts?talkContextLine(talkFacts,this.lastTalkAt||undefined):'',dmMomentLine(moment)].filter(Boolean).join(' ')
   const instruction=moreFill(cue,{moment:dmMomentLine(moment)})+'\nWrite in '+(MORE_LANGUAGE[this.lang]??'English')+'.'
   const prompt=[this.talkSummary?TALK_NOTES_HEAD+'\n'+this.talkSummary+'\n':'',...items.map(item=>line(item)+'\n'),context?context+'\n':'',instruction].join('')
   const payer=this.payer()
   try{
     if(payer==='key'){
       const notes=this.talkSummary?TALK_NOTES_HEAD+'\n'+this.talkSummary:''
       const reply=await this.sendKey($,'talk',{system:notes?persona+'\n\n'+notes:persona,messages:keyMessages(items,context?context+'\n'+instruction:instruction),max_tokens:DM_FIRST_TOKENS},talkEstimate(persona,prompt),facts.now,0)
       return current()&&reply.kind==='ok'?splitTalkReply(reply.text??'').slice(0,3):[]
     }
     const model=this.modelFor('talk')
     if(!model)return []
     const result=await this.completeRow($,'talk',{model,system:persona,prompt,effort:'low',maxTokens:DM_FIRST_TOKENS})
     await this.count($,'talk',result.usage,await this.completionAt($,facts.now),0,current())
     return current()&&result.isAnswered?splitTalkReply(result.text).slice(0,3):[]
   }catch{return []}
 }
 private opener(quiet:boolean,now:number):boolean{
   const text=this.bindings.opener?.(quiet)
   if(!text)return false
   this.exchanges.push({side:'him',text});this.showPart({side:'him',text});this.trimTalk()
   this.openerAt=now;this.openerSeen=this.talkView.length
   this.remember()
   return true
 }
 // Ten minutes with Talk open and nothing said by either: one more line, then nothing until the person writes again.
 private armQuiet():void{
   this.quietTimer?.cancel();this.quietTimer=undefined
   const $=this.openerEngine
   if(!$||!this.talkOpen||this.quietSaid||!this.isOn('talk'))return
   const generation=this.sessionGeneration
   this.quietTimer=$.clock.after(OPENER_QUIET_MS,()=>{
     this.quietTimer=undefined
     if(generation!==this.sessionGeneration||!this.talkOpen||this.busy||this.pendingParts.length)return
     this.quietSaid=true
     if(this.opener(true,this.bindings.talkFacts?.().now??this.openerAt))try{$.ui.invalidate('ui.render')}catch{}
   })
 }
 private trimTalk():void{
   // Session memory only, bounded: the history the budget can use, and what the tab can show.
   const line=(item:MoreExchange)=>`${item.side}: ${item.text}`
   this.exchanges=talkHistory(this.exchanges,line,TALK_CAP,part=>talkEstimate(part)-2000)
   if(this.talkView.length>200)this.talkView=this.talkView.slice(-200)
 }
 private dropTalk():void{
   this.exchanges=[];this.talkView=[];this.talkSummary='';this.talkMeasured=undefined;this.pendingParts=[];this.lastShownPart='';this.lastTalkAt=0
   this.revealTimer?.cancel();this.revealTimer=undefined;this.settleTimer?.cancel();this.settleTimer=undefined
   this.quietTimer?.cancel();this.quietTimer=undefined;this.quietSaid=false;this.openerSeen=-1;this.openerAt=-Infinity;this.dmStands=-1
 }
 /** Card 1: the person's own press sends that one message on the session's payer; nothing switches by itself. */
 talkFallback($:EngineInterface,index:number,now:number):Promise<void>|undefined{
   // The index is the tab's (talkView), as for Ask Claude; the line and the message it answered leave both lists.
   const item=this.talkView[index]
   if(!this.isOn('talk')||this.busy||!item?.failure||!item.retry)return
   const text=item.retry
   this.talkView.splice(index,1)
   const before=this.talkView[index-1]
   if(before?.side==='person'&&before.text===text)this.talkView.splice(index-1,1)
   const at=this.exchanges.indexOf(item)
   if(at>=0){this.exchanges.splice(at,1);const asked=this.exchanges[at-1];if(asked?.side==='person'&&asked.text===text)this.exchanges.splice(at-1,1)}
   return this.talk($,text,now,'session')
 }
 /** TALK-KEY 2: when a reply's usage was over its estimate, the factor becomes 2, once, and stays. */
 private async checkEstimate($:EngineInterface,estimate:number,usage:ModelUsage|undefined):Promise<void>{
   if(!usage||this.estimateFactor===2)return
   const sent=usage.input_tokens+usage.cache_read_input_tokens+usage.cache_creation_input_tokens
   if(sent<=estimate)return
   this.estimateFactor=2
   $.ui.log(`talk estimate too low (${estimate} estimated, ${sent} sent); estimates now count double`,{to:'debug'})
   await $.store.set('more.estimateFactor',{factor:2,estimate,usage:sent})
 }
 private async keyHost():Promise<KeyHost|undefined>{try{return await this.bindings.keyHost?.()}catch{return undefined}}
 /** One send through the key program, counted on the key's own Today line as well as M1's row. */
 private async sendKey($:EngineInterface,id:'talk'|'explain',request:KeyRequest,estimate:number,now:number,messages=1):Promise<KeyReply>{
   const host=await this.keyHost()
   const reply:KeyReply=host?await runTalkKey($,host,['send'],{stdin:JSON.stringify(request)}):{kind:'computer',detail:'noProgram'}
   if(reply.kind==='noRun'){this.keyNoRun=true;$.ui.invalidate('ui.render');return{kind:'computer',detail:'noRun'}}
   const at=await this.completionAt($,now)
   if(reply.kind==='invalid'&&this.key&&this.key.state!=='refused'){this.key={...this.key,state:'refused'};await $.store.set('more.key',this.key)}
   if(reply.kind!=='ok')return reply
   // «saved, not checked yet» becomes «works» after the first good send; host and model follow the record.
   if(this.key&&(this.key.state==='unchecked'||reply.host&&reply.host!==this.key.host||reply.model&&reply.model!==this.key.model)){
     this.key={...this.key,...(this.key.state==='unchecked'?{state:'works' as const}:{}),...(reply.host?{host:reply.host}:{}),...(reply.model?{model:reply.model}:{})};await $.store.set('more.key',this.key)
   }
   const usage=reply.usage??{input_tokens:0,output_tokens:0,cache_read_input_tokens:0,cache_creation_input_tokens:0}
   if(this.keyToday.date!==moreDay(at))this.keyToday={date:moreDay(at),n:0,tokens:0,usd:0,day:0}
   const model=reply.model??this.key?.model,sentTo=reply.host??this.key?.host
   const price=keyPriced(sentTo,model)?await this.bindings.keyPrice?.(model??'claude-haiku-5-5').catch(()=>undefined):undefined
   this.keyToday={date:moreDay(at),n:this.keyToday.n+1,tokens:this.keyToday.tokens+usage.input_tokens+usage.output_tokens+usage.cache_read_input_tokens+usage.cache_creation_input_tokens,usd:this.keyToday.usd+(price?keyCost(usage,price):0),day:reply.count?.day??this.keyToday.day}
   await $.store.set('more.keyToday',this.keyToday)
   await this.count($,id,usage,at,messages)
   await this.checkEstimate($,estimate,usage)
   return reply
 }
 /** The person's payer choice. With no program to run here, only the session's payer is offered. */
 async choosePayer($:EngineInterface,value:string):Promise<void>{
   if(value!=='key'&&value!=='session')return
   this.payerChoice=value==='key'&&!this.keyNoRun?'key':'session'
   await $.store.set('more.payer',this.payerChoice)
   $.ui.invalidate('ui.render')
 }
 /** «Add» and «Replace»: the system's own password dialog, opened by the program; the words come from here. */
 async addKey($:EngineInterface):Promise<void>{
   if(this.keyBusy)return
   const host=await this.keyHost();if(!host){this.keyNotice=keyFailureText('computer',undefined,this.lang);return}
   this.keyBusy=true;this.keyNotice=undefined;$.ui.invalidate('ui.render')
   try{
     const w=(k:string)=>this.w(k)
     const elsewhere=!!this.keyBase&&!/^https:\/\/api\.anthropic\.com\/?$/i.test(this.keyBase)
     const text=elsewhere?moreFill(w('dialog.textAt'),{host:this.keyBase!.replace(/^https?:\/\//,'').split('/')[0]!}):w('dialog.text')
     if(!text){this.keyNotice=undefined;return}
     const endpoint=[...(this.keyBase?['--base',this.keyBase]:[]),...(this.keyModel?['--model',this.keyModel]:[])]
     const reply=await runTalkKey($,host,['add','--dialog','--title',w('dialog.title'),'--text',text,'--save',w('dialog.save'),'--cancel',w('dialog.cancel'),...endpoint],{timeoutMs:KEY_DIALOG_TIMEOUT})
     await this.keySaved($,reply)
   }finally{this.keyBusy=false;$.ui.invalidate('ui.render')}
 }
 private async keySaved($:EngineInterface,reply:KeyReply):Promise<void>{
   if(reply.kind==='noRun'){this.keyNoRun=true;this.payerChoice='session';await $.store.set('more.payer','session');return}
   if((reply.kind==='works'||reply.kind==='saved')&&reply.last4){this.key={last4:reply.last4,state:reply.kind==='works'?'works':'unchecked',...(reply.store?{store:reply.store}:{}),...(reply.host?{host:reply.host}:{}),...(reply.model?{model:reply.model}:{})};await $.store.set('more.key',this.key);return}
   if(reply.kind==='address'){this.keyNotice=this.w('key.address')||undefined;return}
   if(reply.kind==='cancelled')return
   if(reply.kind==='invalid'){this.keyNotice=this.keyBase&&!/^https:\/\/api\.anthropic\.com\/?$/i.test(this.keyBase)?moreFill(this.w('key.refusedAt'),{host:this.keyBase.replace(/^https?:\/\//,'').split('/')[0]!})||undefined:this.w('key.refused');return}
   if(reply.kind==='format'){this.keyNotice=this.w('key.format');return}
   this.keyNotice=keyFailureText(keyFailure(reply),reply,this.lang,this.keyAt())
 }
 /** The base URL and the model typed on the row; they are passed to the next add and checked by the program. */
 setKeyEndpoint(field:'base'|'model',value:string):void{const v=value.trim().slice(0,512)||undefined;if(field==='base')this.keyBase=v;else this.keyModel=v}
 /** The terminal command for no display, with the typed endpoint; empty where this computer has no build of the
  *  program. Quoted for a POSIX shell. */
 addCommand(host:Pick<KeyHost,'root'|'platform'|'arch'>):string{
   const path=talkKeyPath(host.root,host.platform,host.arch);if(!path)return ''
   const quote=(v:string)=>/^[A-Za-z0-9_./:@+-]+$/.test(v)?v:`'${v.replace(/'/g,`'\\''`)}'`
   return [path,'add',...(this.keyBase?['--base',quote(this.keyBase)]:[]),...(this.keyModel?['--model',quote(this.keyModel)]:[])].join(' ')
 }
 async removeKey($:EngineInterface):Promise<void>{
   if(this.keyBusy)return
   const host=await this.keyHost();if(!host){this.keyNotice=keyFailureText('computer',undefined,this.lang);return}
   this.keyBusy=true;this.keyNotice=undefined
   try{
     const reply=await runTalkKey($,host,['remove'])
     if(reply.kind==='removed'){this.key=undefined;await $.store.set('more.key',null)}
     else if(reply.kind==='noRun'){this.keyNoRun=true}
     else this.keyNotice=keyFailureText('computer',reply,this.lang)
   }finally{this.keyBusy=false;$.ui.invalidate('ui.render')}
 }
 /** «Check again»: the program's `status` asks the stored record's host about the stored key; no dialog, no tokens. */
 async checkKey($:EngineInterface):Promise<void>{
   if(this.keyBusy||!this.key)return
   const host=await this.keyHost();if(!host){this.keyNotice=keyFailureText('computer',undefined,this.lang);return}
   this.keyBusy=true;this.keyNotice=undefined;$.ui.invalidate('ui.render')
   try{
     const reply=await runTalkKey($,host,['status'])
     if(reply.kind==='noRun'){this.keyNoRun=true;this.payerChoice='session';await $.store.set('more.payer','session');return}
     if((reply.kind==='works'||reply.kind==='saved')&&reply.last4){this.key={last4:reply.last4,state:reply.kind==='works'?'works':'unchecked',...(reply.store?{store:reply.store}:{}),...(reply.host?{host:reply.host}:{}),...(reply.model?{model:reply.model}:{})};await $.store.set('more.key',this.key);return}
     // The refusal shows as the row's own state, so it needs no notice.
     if(reply.kind==='invalid'){this.key={...this.key,state:'refused'};await $.store.set('more.key',this.key);return}
     this.keyNotice=keyFailureText(keyFailure(reply),reply,this.lang,this.keyAt())
   }finally{this.keyBusy=false;$.ui.invalidate('ui.render')}
 }
 /** With no display, the row offers the one command for the person's own terminal. */
 async copyAddCommand($:EngineInterface):Promise<void>{
   const command=await this.keyCommand();if(!command)return
   await $.ui.copy({text:command})
 }
 /** The same command for drawing the row; the host is read once per session (register.tsx talkKeyHost). */
 async keyCommand():Promise<string>{const host=await this.keyHost();return host?this.addCommand(host):''}
 recordDay(kind:'prompts'|'turns'|'tests'|'helpers'|'awakeHours',now:number,amount=1):void{
   if(!this.isOn('talk'))return
   if(this.dayCounts.date!==moreDay(now))this.dayCounts={date:moreDay(now),prompts:0,turns:0,tools:{},tests:0,helpers:0,awakeHours:0}
   if(Number.isFinite(amount))this.dayCounts[kind]+=Math.max(0,amount)
 }
 recordTool(name:string,now:number):void{
   if(!this.isOn('talk'))return
   this.recordDay('turns',now,0)
   const kind=['Read','Edit','Write','Bash','Glob','Grep','Agent','NotebookEdit','MultiEdit'].includes(name)?name:'other'
   this.dayCounts.tools[kind]=(this.dayCounts.tools[kind]??0)+1
 }
 writeDiary($:EngineInterface,now:number):Promise<void>|undefined{
   if(!this.isOn('talk')||this.busy||this.diaryBusy||this.diaryDays.has(moreDay(now)))return
   const template=this.w('diary.template'),folder=this.bindings.dataFolder?.()
   if(!template||!folder)return
   const day=moreDay(now),generation=this.sessionGeneration,token=this.operationToken('talk');this.diaryBusy=true
   return (async()=>{
     const path=joinPath(folder,'diary',`${new Date(now).getFullYear()}.json`)
     let pages:Record<string,string>={}
     try{const read=JSON.parse(await $.fs.read(path));if(read&&typeof read==='object'&&!Array.isArray(read))pages=Object.fromEntries(Object.entries(read).filter((entry):entry is [string,string]=>typeof entry[1]==='string'))}catch{}
     if(generation!==this.sessionGeneration||!this.operationCurrent('talk',token))return
     if(pages[day]!==undefined){this.diaryPage=pages[day]!;this.diaryDays.add(day);return}
     this.recordDay('turns',now,0)
     this.diaryDays.add(day)
     const counts=this.dayCounts
     this.diaryPage=moreFill(template,{turns:counts.turns,greens:counts.tests,hours:Math.round(counts.awakeHours)})
     pages[day]=this.diaryPage;await $.fs.write(path,JSON.stringify(pages))
   })().finally(()=>{if(generation===this.sessionGeneration&&this.operationToken('talk')===token){this.diaryBusy=false;if(this.isOn('talk'))$.ui.invalidate('ui.render')}})
 }
 /** A prompt that starts «sama,» or «小克,» goes to Talk instead of Claude (the O1 probe). */
 talkFromPrompt($:EngineInterface,text:string,now:number):boolean{
   const match=/^\s*(?:sama|小克)\s*[,，]\s*([\s\S]*)$/i.exec(text)
   if(!match||!match[1]!.trim()||!this.isOn('talk')||!this.canSend('talk')||this.busy||this.diaryBusy)return false
   const work=this.talk($,match[1]!,now)
   if(!work)return false
   void this.bindings.openBook?.('talk')
   return true
 }
 askClaude($:EngineInterface,index:number):Promise<void>|undefined{
   if(!this.isOn('talk'))return
   const text=this.talkView[index]?.work
   if(!text)return
   return $.prompt.fill({text,mode:'replace'}).then(()=>{})
 }
 explain($:EngineInterface,now:number,selectionSupported:boolean):Promise<void>|undefined{
   if(!this.isOn('explain')||!this.canSend('explain')||this.busy)return
   const generation=this.sessionGeneration,token=this.operationToken('explain')
   this.busy=true;this.busyOwner='explain'
   return (async()=>{
     const api=$.ui as EngineInterface['ui']&{selection?:()=>Promise<{text?:string}|undefined>}
     const selected=selectionSupported&&typeof api.selection==='function'?await api.selection():undefined
     if(generation!==this.sessionGeneration||!this.operationCurrent('explain',token))return
     let target=selected?.text||this.lastAnswer
     if(!target){
       try{
         const rows=await $.session.messages()
         if(generation!==this.sessionGeneration||!this.operationCurrent('explain',token))return
         for(let index=rows.length-1;index>=0;index--){const row=rows[index];if(row?.role==='assistant'&&row.text.trim()){target=row.text;break}}
       }catch{return}
     }
     if(!target)return
     // TALK-KEY 2: over 96,500 bytes nothing is sent; «select a part» is the line.
     const estimate=talkEstimate(sayItPlainRewritePrompt(),target)
     if(textBytes(target)>EXPLAIN_TEXT_LIMIT||this.over(estimate)){
       this.explanation=this.w('explain.tooLong')
       await this.bindings.openBook?.('him',()=>generation===this.sessionGeneration&&this.operationCurrent('explain',token))
       return
     }
     const prompt=sayItPlainRewritePrompt()+'\n\n'+target
     if(this.payer()==='key'){
       const reply=await this.sendKey($,'explain',{messages:[{role:'user',content:prompt}],max_tokens:400},estimate,now)
       if(generation!==this.sessionGeneration||!this.operationCurrent('explain',token))return
       this.explanation=(reply.kind==='ok'?(rewriteKeepsExact(target,reply.text??'')?reply.text??'':target):keyFailureText(keyFailure(reply),reply,this.lang,this.keyAt())).slice(0,10000)
       await this.bindings.openBook?.('him',()=>generation===this.sessionGeneration&&this.operationCurrent('explain',token))
       return
     }
     const result=await this.completeRow($,'explain',{model:this.modelFor('talk')??'haiku',prompt,maxTokens:400,effort:'low'})
     await this.count($,'explain',result.usage,await this.completionAt($,now),1,generation===this.sessionGeneration&&this.operationCurrent('explain',token))
     await this.checkEstimate($,estimate,result.usage)
     if(generation!==this.sessionGeneration||!this.operationCurrent('explain',token))return
     this.explanation=(result.isAnswered?(rewriteKeepsExact(target,result.text)?result.text:target):moreFill(this.w('talk.failed'),{reason:result.reason})).slice(0,10000)
     await this.bindings.openBook?.('him',()=>generation===this.sessionGeneration&&this.operationCurrent('explain',token))
   })().finally(()=>{if(generation===this.sessionGeneration&&this.operationToken('explain')===token){this.busy=false;this.busyOwner=undefined;if(this.isOn('explain'))$.ui.invalidate('ui.render')}})
 }
 copyExplanation($:EngineInterface):Promise<void>|undefined{if(!this.isOn('explain')||!this.explanation)return;return $.ui.copy({text:this.explanation}).then(()=>{})}
 cacheHelp(tokens:number,now:number):string{return moreFill(this.w(now-this.lastRequestAt<this.cacheTtl?'explain.costWarm':'explain.costCold'),{n:numberText(tokens,this.lang)})}
 async style($:EngineInterface,on:boolean):Promise<void>{
   if(on&&!this.canSend('plain'))return
   this.invalidateOperation('plain')
   const token=this.operationToken('plain'),generation=this.sessionGeneration
   const row=(await $.config.list()).find(row=>row.key==='outputStyle')
   if(generation!==this.sessionGeneration||token!==this.operationToken('plain')||on&&!this.canSend('plain'))return
   if(!row){await $.command.run({command:'output-style'});return}
   if(row.isLocked)return
   if(on&&!this.isOn('plain')&&!this.styleWrites){
     const kept=row.value==='coco:plain-words'?await $.store.get('more.previousStyle'):undefined
     this.previousStyle=typeof kept==='string'||typeof kept==='boolean'||typeof kept==='number'||Array.isArray(kept)?kept as ConfigValue:row.value
     await $.store.set('more.previousStyle',this.previousStyle)
   }
   if(!on&&this.previousStyle===undefined){const kept=await $.store.get('more.previousStyle');if(typeof kept==='string'||typeof kept==='boolean'||typeof kept==='number'||Array.isArray(kept))this.previousStyle=kept as ConfigValue}
   if(!on&&this.previousStyle===undefined)return
   if(generation!==this.sessionGeneration||token!==this.operationToken('plain')||on&&!this.canSend('plain'))return
   const apply=async()=>{
     if(generation!==this.sessionGeneration||token!==this.operationToken('plain')||on&&!this.canSend('plain'))return
     const result=await setOutputStyle($,on?'coco:plain-words':this.previousStyle!)
     if(generation!==this.sessionGeneration){
       if(on&&!this.isOn('plain')&&this.previousStyle!==undefined&&result.deny===undefined)await setOutputStyle($,this.previousStyle)
       return
     }
     if(token!==this.operationToken('plain')||result.deny!==undefined)return
     this.values.plain=on;await this.save($)
   }
   const prior=styleWriteTail,work=prior?prior.catch(()=>{}).then(apply):apply()
   this.styleWrites=work;styleWriteTail=work
   try{await work}finally{if(this.styleWrites===work)this.styleWrites=undefined;if(styleWriteTail===work)styleWriteTail=undefined}
 }
 lookAvailable():boolean{return this.isOn('look')&&this.changedPaths.size>0&&!this.lookAgentId&&!this.lookBusy&&this.lookUsageSlots<16}
 edit(path:string,input:string):void{if(!this.isOn('look'))return;this.changedPaths.add(path);const left=60000-this.editInputs.reduce((n,value)=>n+value.length,0);if(input.length>left)this.editsCut=true;if(left>0)this.editInputs.push(input.slice(0,left))}
 /** The character worn now: Coco, or one of Claudie's forms. */
 setLinesForm(form:'dake'|'maid'|undefined):void{this.linesForm=form}
 private linesCharacter():LineCharacter{return this.linesForm??'coco'}
 private linesLangNow():string{return this.linesLang??this.lang}
 private linesView():MoreLines{
   const character=this.linesCharacter(),lang=this.linesLangNow(),key=`${character}:${lang}`
   return {character,lang,mix:this.linesMix,state:this.linesBusy===key?'busy':this.linesSets[key]?'ready':this.linesFailed.has(key)?'failed':'none',...(Object.keys(this.linesPaths).length?{paths:{...this.linesPaths}}:{}),...(this.linesEditFailed?{editFailed:this.linesEditFailed}:{})}
 }
 // What is said: each character's written set in the language picked (as edited, once its file was saved), Coco's
 // shipped lines as edited, the switch and Coco's mix (line-library.ts).
 private activateLines():void{
   const lang=this.linesLangNow()
   for(const character of ['coco','dake','maid'] as const){const key=`${character}:${lang}`;installWritten(character,this.linesEdits[key]??this.linesSets[key]?.lines)}
   installEdited(this.linesEdits[`shipped:${this.lang}`])
   useWritten(moreOn(this.values,'lines'),this.linesMix)
 }
 private linesPath(part:'shipped'|'generated',character:LineCharacter,lang:string):string|undefined{
   const folder=this.bindings.linesFolder?.()
   return folder?joinPath(folder,`${character}-${part}-${lang}.txt`):undefined
 }
 private linesHead(character:LineCharacter,part:'shipped'|'generated',lang:string):string{
   return moreFill(this.w('lines.file.head'),{name:this.bindings.characterName?.(character)??character,set:this.w(`lines.${part}`),lang:LANGS.find(l=>l.code===lang)?.native??lang})
 }
 private async publishLines($:EngineInterface):Promise<void>{await this.bindings.changed?.(this.changedSnapshot());$.ui.invalidate('ui.render')}
 /** The sets written in earlier sessions, the language picked for them and Coco's mix ('more.lines'). */
 restoreLines(stored:unknown):void{
   this.linesSets={};this.linesLang=undefined;this.linesMix='both';this.linesOpened=new Set()
   const data=stored&&typeof stored==='object'?stored as {sets?:unknown;lang?:unknown;mix?:unknown;opened?:unknown}:{}
   if(Array.isArray(data.opened))for(const slot of data.opened){
     const [part,code]=typeof slot==='string'?slot.split(':'):[]
     if(['shipped','coco','dake','maid'].includes(part??'')&&LANGS.some(l=>l.code===code))this.linesOpened.add(slot as string)
   }
   if(typeof data.lang==='string'&&LANGS.some(l=>l.code===data.lang))this.linesLang=data.lang
   if(data.mix==='only')this.linesMix='only'
   if(data.sets&&typeof data.sets==='object')for(const [key,entry] of Object.entries(data.sets as Record<string,unknown>)){
     const [character,code]=key.split(':') as [string,string|undefined]
     const lines=(entry as {lines?:unknown})?.lines,at=(entry as {at?:unknown})?.at
     if(!['coco','dake','maid'].includes(character)||!code||!LANGS.some(l=>l.code===code)||!lines||typeof lines!=='object')continue
     const set=writtenLinesFrom(JSON.stringify(Object.fromEntries(LINE_GROUPS.map(group=>[group,(lines as Record<string,unknown>)[group]]))))
     if(set&&Object.keys(set).length)this.linesSets[key]={lines:set,at:typeof at==='number'?at:0}
   }
   this.activateLines()
 }
 private async saveLines($:EngineInterface):Promise<void>{
   await $.store.set('more.lines',{sets:this.linesSets,...(this.linesLang?{lang:this.linesLang}:{}),mix:this.linesMix,...(this.linesOpened.size?{opened:[...this.linesOpened]}:{})})
 }
 /** Before a line is picked: a set's file saved since it was last read is read again (his card: 「下次横条说话就用新的」);
  * a file that is gone leaves the set as it was. Only files the person has opened are looked at, and only the stat
  * is asked when nothing changed. */
 async refreshLines($:EngineInterface):Promise<void>{
   const character=this.linesCharacter(),lang=this.linesLangNow(),files:[string,string|undefined][]=[]
   if(character==='coco'&&this.linesOpened.has(`shipped:${this.lang}`))files.push([`shipped:${this.lang}`,this.linesPath('shipped','coco',this.lang)])
   if(this.linesSets[`${character}:${lang}`]&&this.linesOpened.has(`${character}:${lang}`))files.push([`${character}:${lang}`,this.linesPath('generated',character,lang)])
   let changed=false
   for(const [slot,path] of files){
     if(!path)continue
     let mtime:number|undefined
     try{mtime=(await $.fs.stat(path)).mtimeMs}catch{mtime=undefined}
     if(mtime===this.linesSeen[slot])continue
     this.linesSeen[slot]=mtime
     if(mtime===undefined){if(this.linesEdits[slot]){delete this.linesEdits[slot];changed=true}continue}
     try{this.linesEdits[slot]=linesFromText(await $.fs.read(path));changed=true}catch{}
   }
   if(changed)this.activateLines()
 }
 /** The set's file opened in the system's text editor (his card), written first from what is said now if it is not
  * there; its place is shown under the row either way. */
 async editLines($:EngineInterface,part:'shipped'|'generated'):Promise<boolean>{
   const character=this.linesCharacter()
   if(part==='shipped'&&character!=='coco')return false
   const lang=part==='shipped'?this.lang:this.linesLangNow(),slot=part==='shipped'?`shipped:${lang}`:`${character}:${lang}`
   const set=this.linesEdits[slot]??(part==='shipped'?shippedLines(lang):this.linesSets[slot]?.lines),path=this.linesPath(part,character,lang)
   if(!set||!path)return false
   if(!await $.fs.exists(path).catch(()=>false))await $.fs.write(path,linesText(this.linesHead(character,part,lang),set))
   this.linesPaths={...this.linesPaths,[part]:path}
   if(!this.linesOpened.has(slot)){this.linesOpened.add(slot);await this.saveLines($)}
   const opened=await this.bindings.openFile?.(path).catch(()=>false)??false
   this.linesEditFailed=opened?undefined:part
   await this.publishLines($)
   return true
 }
 /** Restore: this set back as it was (his card): the shipped lines as we ship them, a written set as it was written,
  * and Coco's mix back to both. Its file, when there is one, is written back too. */
 async restoreLinesSet($:EngineInterface,part:'shipped'|'generated'):Promise<boolean>{
   const character=this.linesCharacter()
   if(part==='shipped'&&character!=='coco')return false
   const lang=part==='shipped'?this.lang:this.linesLangNow(),slot=part==='shipped'?`shipped:${lang}`:`${character}:${lang}`
   const set=part==='shipped'?shippedLines(lang):this.linesSets[slot]?.lines,path=this.linesPath(part,character,lang)
   if(!set)return false
   if(path&&await $.fs.exists(path).catch(()=>false)){await $.fs.write(path,linesText(this.linesHead(character,part,lang),set));try{this.linesSeen[slot]=(await $.fs.stat(path)).mtimeMs}catch{}}
   delete this.linesEdits[slot];this.linesMix='both'
   this.activateLines();await this.saveLines($);await this.publishLines($)
   return true
 }
 /** The written set for this character and language is let go: the character says the shipped lines, or nothing. */
 async dropLines($:EngineInterface):Promise<boolean>{
   const key=`${this.linesCharacter()}:${this.linesLangNow()}`
   if(!this.linesSets[key])return false
   delete this.linesSets[key];delete this.linesEdits[key];delete this.linesSeen[key];this.linesFailed.delete(key)
   this.activateLines();await this.saveLines($);await this.publishLines($)
   return true
 }
 /** The person picks the language their lines are written in; a set not written yet in it is written now. */
 async chooseLinesLang($:EngineInterface,lang:string):Promise<boolean>{
   if(!LANGS.some(l=>l.code===lang))return false
   this.linesLang=lang;this.activateLines()
   await this.saveLines($);await this.save($)
   await this.lines($)
   return true
 }
 /** Coco says the written lines alone, or mixed with the shipped ones (his 10-17: either, or both). */
 async chooseLinesMix($:EngineInterface,mix:string):Promise<boolean>{
   if(mix!=='only'&&mix!=='both')return false
   this.linesMix=mix;this.activateLines()
   await this.saveLines($);await this.save($)
   return true
 }
 /** The written set for the character worn, in the language picked: written once while the row is on, then kept. */
 lines($:EngineInterface):Promise<void>|undefined{
   const character=this.linesCharacter(),key=`${character}:${this.linesLangNow()}`
   if(!this.isOn('lines')||this.linesBusy||this.linesSets[key]||this.linesFailed.has(key))return
   return this.writeLines($,character)
 }
 /** Write again: the set for the character worn and this language is written anew. */
 redoLines($:EngineInterface):Promise<boolean>|false{
   if(!this.isOn('lines')||this.linesBusy)return false
   return this.writeLines($,this.linesCharacter()).then(()=>true)
 }
 private async writeLines($:EngineInterface,character:LineCharacter):Promise<void>{
   const lang=this.linesLangNow(),key=`${character}:${lang}`,instruction=this.modelWords[`more.model.lines.${character}`],model=this.modelFor('lines')
   if(!instruction||!model)return
   const generation=this.sessionGeneration,token=this.operationToken('lines'),current=()=>generation===this.sessionGeneration&&this.operationCurrent('lines',token)
   this.linesBusy=key;this.linesFailed.delete(key)
   await this.publishLines($)
   try{
     const result=await this.completeRow($,'lines',{model,system:instruction,prompt:'Write in '+(MORE_LANGUAGE[lang]??'English')+'.',maxTokens:LINES_WRITE_TOKENS,effort:'low'})
     await this.count($,'lines',result.usage,await this.completionAt($,0),1,current())
     if(!current())return
     // A reply that is not the JSON, or keeps no group, is no set: nothing is said, and Write again tries anew.
     const set=result.isAnswered?writtenLinesFrom(result.text):undefined
     if(!set||!Object.keys(set).length){this.linesFailed.add(key);return}
     this.linesSets[key]={lines:set,at:await this.completionAt($,0)};delete this.linesEdits[key]
     // A file of the old set is written over with the new one, so what the person opens is what is said.
     const path=this.linesPath('generated',character,lang)
     if(path&&await $.fs.exists(path).catch(()=>false)){await $.fs.write(path,linesText(this.linesHead(character,'generated',lang),set));try{this.linesSeen[key]=(await $.fs.stat(path)).mtimeMs}catch{}}
     this.activateLines();await this.saveLines($)
   }catch{if(current())this.linesFailed.add(key)}
   finally{
     if(this.linesBusy===key&&current())this.linesBusy=undefined
     if(generation===this.sessionGeneration)await this.publishLines($)
   }
 }
 registerLook($:EngineInterface):Promise<void>|undefined{
   if(!this.isOn('look')||!this.canSend('look')||this.registeredLook)return
   const prompt=this.modelWords['more.model.look.prompt']
   if(!prompt)return
   // Read and Grep only, each held to the changed files by lookDeny; the model is the person's pick, sent again with
   // each spawn so a later pick holds.
   return $.agent.register({name:'second-look',description:this.w('look.help'),prompt,tools:['Read','Grep'],model:this.modelFor('look')!}).then(()=>{this.registeredLook=true})
 }
 /** The second look's reader reads only the changed files (U3): Read of one of them, or Grep with one of them as its
  * path; every other call it makes is refused. Agents that are not the reader pass untouched. */
 async lookDeny($:EngineInterface,agentId:string|undefined,tool:string,input:Record<string,unknown>):Promise<string|undefined>{
   if(agentId===undefined||!this.registeredLook&&!this.lookIds.size)return
   if(!this.lookIds.has(agentId)){
     if(this.otherAgents.has(agentId))return
     const agent=(await $.agent.list().catch(()=>[])).find(info=>info.id===agentId)
     // One not listed yet while a look is starting is held as the reader would be.
     if(!agent&&!this.lookBusy)return
     if(agent&&agent.type!=='coco:second-look'){this.otherAgents.add(agentId);while(this.otherAgents.size>256)this.otherAgents.delete(this.otherAgents.values().next().value!);return}
     if(agent)this.lookIds.add(agentId)
   }
   const path=tool==='Read'?input.file_path:tool==='Grep'?input.path:undefined
   return typeof path==='string'&&this.lookAllowed.has(path)?undefined:LOOK_DENY
 }
 lookOffered():boolean{return false}
 secondLook($:EngineInterface):Promise<void>|undefined{
   if(!this.isOn('look')||!this.canSend('look')||!this.registeredLook||!this.changedPaths.size||this.lookAgentId||this.lookBusy||this.lookUsageSlots>=16)return
   const instruction=this.modelWords['more.model.look.prompt'];if(!instruction)return
   const generation=this.sessionGeneration,token=this.operationToken('look')
   this.lookBusy=true;this.lookUsageSlots++
   let spawned=false
   return (async()=>{
     const repo=await $.session.repo()
     if(generation!==this.sessionGeneration||!this.operationCurrent('look',token))return
     const diff=repo?(await $.process.run(['git','diff','--no-color','--',...this.changedPaths])).stdout:this.editInputs.join('\n')
     if(generation!==this.sessionGeneration||!this.operationCurrent('look',token))return
     // The cut is said, never silent (TALK-KEY 2): a longer diff, or edits past the capture bound.
     const cut=repo?diff.length>60000:this.editsCut
     // The instruction, then the files the reader may open (one a line), the changes, and the language to write in.
     this.lookAllowed=new Set(this.changedPaths)
     const result=await $.agent.spawn({subagentType:'coco:second-look',description:this.w('look.button'),model:this.modelFor('look'),prompt:instruction+'\n\n'+[...this.changedPaths].join('\n')+'\n\n'+(repo?diff.slice(0,60000):diff)+'\n\nWrite in '+(MORE_LANGUAGE[this.lang]??'English')+'.'})
     if(cut)this.bindings.line?.(this.w('look.cut'),'note',14000)
     if(typeof result.agentId!=='string'||!result.agentId)return
     spawned=true;this.lookIds.add(result.agentId)
     if(generation!==this.sessionGeneration||!this.operationCurrent('look',token)){this.clearedLookIds.add(result.agentId);return}
     this.lookToken=token;this.lookAgentId=result.agentId;this.bindings.line?.(this.w('look.aside'),'note',14000)
   })().finally(()=>{if(!spawned)this.lookUsageSlots--;if(generation===this.sessionGeneration&&this.operationCurrent('look',token))this.lookBusy=false})
 }
 finishLook($:EngineInterface,agentId:string,text:string,usage:ModelUsage,now:number,findingCount?:number):Promise<void>|undefined{
   if(this.clearedLookIds.delete(agentId)){this.lookUsageSlots=Math.max(0,this.lookUsageSlots-1);return this.completionAt($,now).then(at=>this.count($,'look',usage,at,1,false))}
   if(agentId!==this.lookAgentId)return
   this.lookUsageSlots=Math.max(0,this.lookUsageSlots-1)
   const token=this.lookToken??this.operationToken('look')
   if(!this.operationCurrent('look',token)){this.lookAgentId=undefined;return this.completionAt($,now).then(at=>this.count($,'look',usage,at,1,false))}
   this.lookText=text;this.lookFindingCount=typeof findingCount==='number'&&Number.isInteger(findingCount)&&findingCount>=0?findingCount:undefined;this.lookAgentId=undefined
   const generation=this.sessionGeneration
   return this.completionAt($,now).then(at=>this.count($,'look',usage,at,1,this.operationCurrent('look',token))).then(()=>{if(generation!==this.sessionGeneration||!this.operationCurrent('look',token))return;this.bindings.openBook?.('him',()=>generation===this.sessionGeneration&&this.operationCurrent('look',token));$.ui.invalidate('ui.render')})
 }
 lookTell($:EngineInterface):Promise<void>|undefined{if(!this.isOn('look')||!this.lookText)return;return $.prompt.fill({text:this.lookText,mode:'replace'}).then(()=>{})}
 copyLook($:EngineInterface):Promise<void>|undefined{if(!this.isOn('look')||!this.lookText)return;return $.ui.copy({text:this.lookText}).then(()=>{})}
 capToolCall($:EngineInterface,turnId:string):Promise<{deny:string}|undefined>|undefined{
   if(!this.isOn('cap'))return
   if(this.capHeld)return this.capHeld
   const generation=this.sessionGeneration,token=this.operationToken('cap')
   this.capHeld=this.checkCap($,turnId,generation,token).finally(()=>{if(generation===this.sessionGeneration&&this.operationCurrent('cap',token))this.capHeld=undefined})
   return this.capHeld
 }
 private async checkCap($:EngineInterface,turnId:string,generation:number,token:number):Promise<{deny:string}|undefined>{
   const limit=Number(this.values.cap)
   const usage=await $.session.usage()
   if(generation!==this.sessionGeneration||!this.operationCurrent('cap',token)||Number(this.values.cap)!==limit)return
   if((usage.cost?.usd??0)<limit)return
   const line=moreFill(this.w('cap.dollar'),{n:limit})
   const identity=`usd:${limit}`,name=(this.lang==='zh'||this.lang==='zh-Hant')?'小克':this.lang==='ja'?'Coco':this.lang==='ko'?'코코':'Coco'
   if(this.capStopped)return{deny:moreFill(this.w('cap.notice'),{name,line})}
   if(this.asked.has(identity))return
   this.asked.add(identity)
   let answer=''
   try{answer=await $.ui.ask(moreFill(this.w('cap.question'),{name,line}),{options:[this.w('cap.stop'),this.w('cap.go')],header:name})}catch{}
   if(generation!==this.sessionGeneration||!this.operationCurrent('cap',token)||Number(this.values.cap)!==limit)return
   if(!this.isOn('cap'))return
   if(answer===this.w('cap.go')){
     this.values.cap=[1,5,20,50].find(n=>n>limit)??limit
     return
   }
   this.capStopped=true
   try{await $.turn.abort({turnId})}catch{}
   if(generation!==this.sessionGeneration||!this.operationCurrent('cap',token)||Number(this.values.cap)!==limit)return
   $.ui.status(moreFill(this.w('cap.status'),{line}))
   const notice=moreFill(this.w('cap.notice'),{name,line})
   await $.session.append({message:{type:'system',content:[{type:'text',text:notice}]}})
   if(generation!==this.sessionGeneration||!this.operationCurrent('cap',token))return
   if(answer==='')$.ui.log(notice)
   return{deny:moreFill(this.w('cap.notice'),{name,line})}
 }
 newPrompt($:EngineInterface):void{if(this.capStopped){this.capStopped=false;$.ui.status(undefined)};this.changedPaths.clear();this.editInputs=[];this.editsCut=false}
 pasteEdit($:EngineInterface,text:string):Promise<void>|undefined{
   if(!this.isOn('paste')||text.length<20)return
   const hits=secretHits(text.slice(0,100000));if(!hits.length)return
   const generation=this.sessionGeneration,token=this.operationToken('paste')
   return (async()=>{
     const hashes=await Promise.all(hits.map(hit=>secretHash(hit.text)))
     if(generation!==this.sessionGeneration||!this.operationCurrent('paste',token))return
     const index=hashes.findIndex(hash=>!this.keptKeys.has(hash));if(index<0)return
     this.pasteHashes=hashes;this.pasteKind=hits[index]!.kind
     this.bindings.line?.(moreFill(this.w('paste.line'),{kind:this.w(`paste.kinds.${this.pasteKind}`)}),'safety',12000)
   })()
 }
 hidePaste($:EngineInterface):Promise<void>|undefined{
   if(!this.isOn('paste')||!this.pasteKind)return
   const generation=this.sessionGeneration,token=this.operationToken('paste')
   return (async()=>{const box=await $.prompt.read();if(generation!==this.sessionGeneration||!this.operationCurrent('paste',token))return;await $.prompt.fill({text:hideSecrets(box.text,this.w('key.hidden')),mode:'replace'});if(generation===this.sessionGeneration&&this.operationCurrent('paste',token)){this.pasteHashes=[];this.pasteKind=undefined}})()
 }
 keepPaste():void{if(!this.isOn('paste'))return;for(const hash of this.pasteHashes)this.keptKeys.add(hash);this.pasteHashes=[];this.pasteKind=undefined}
 syncLively($:EngineInterface,state:{terminal:boolean;awake:boolean;visible:boolean;idle:boolean;reducedMotion:boolean},step:()=>void):void{
   const active=this.isOn('lively')&&state.terminal&&state.awake&&state.visible&&state.idle&&!state.reducedMotion
   if(!active){this.stopLively();return}
   if(this.alive)return
   const timer=$.clock.every(2000,()=>{if(this.alive===timer)step()})
   this.alive=timer
 }
 stopLively():void{this.alive?.cancel();this.alive=undefined;this.bindings.livelyStopped?.()}
 clearSession():void{
   this.sessionGeneration++
   for(const id of MORE_IDS)this.invalidateOperation(id,false)
   this.stopLively()
   this.keptKeys.clear();this.pasteHashes=[];this.pasteKind=undefined
   if(this.lookAgentId)this.clearedLookIds.add(this.lookAgentId)
   this.dropTalk();this.lastAnswer='';this.explanation='';this.talkInput='';this.lookText='';this.lookFindingCount=undefined;this.lookAgentId=undefined;this.diaryPage=''
   this.busy=false;this.busyOwner=undefined;this.lookBusy=false;this.diaryBusy=false;this.diaryDays.clear()
   this.dayCounts={date:'',prompts:0,turns:0,tools:{},tests:0,helpers:0,awakeHours:0}
   this.changedPaths.clear();this.editInputs=[];this.editsCut=false
   this.asked.clear();this.capHeld=undefined;this.capStopped=false
   if(this.selectedCap!==undefined)this.values.cap=this.selectedCap
   this.lastRequestAt=0
   this.asking=undefined;this.focused=undefined;this.entryFocused=false;this.reading=0;this.open=false
   this.keyNotice=undefined;this.keyBusy=false
 }
 stop():void{this.clearSession()}
}
