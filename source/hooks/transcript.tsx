// Transcript marks wrap the host's whole row. Turn heads read only their own state-family
// member; mood pushes never subscribe these rows to the band's live view.
import type { EngineInterface, On, RenderElement, RenderSurface } from 'claude-code'
import { moment, NO_ITALIC } from './d1-state.js'
import { MARKS_DEFAULT, bandShownOn, latest, marksFrom } from './latest'
import type { Marks } from './latest'
import { PERSON, STILL } from './mood'
import { LINES } from './lines'
import { offeringSvg } from './pictures-lazy'
import { EXTRA_HEAD_SVG, HEAD_ALIAS, HEAD_SVG } from './head-art'
import { COLUMN_PX, cutToPx, gapBefore, planPx } from './typeset'
import { HEAD_CAP, HEAD_PREFIX, TurnLedger, headAddress, headEntry, headKey,headAdornment,headTuple } from './turn-ledger'
import { WORDS } from './words'
import type { Lang } from './words'
import type { HeadState } from '../types'
import { c3Word } from './c3-words'
import { numberLocale } from './numbers'
import { isThanks } from './c3-runtime'
import { stateProgram } from './native-state'
import {renderClose,renderLimitNote} from './mod-gaps-render'
import type {GapClosing,GapLimit} from './mod-gaps'
import {gapCharacterName} from './mod-gaps-words'
import { cacheAlt, cacheHover, cupShown } from './cost/surfaces'
import { cupSvg } from './cost/cup'
import { QUOTA_PICTURE_PX, quotaBandItems } from './quota'
import { LIGHT_PX, laptopLightSvg } from './play-light'
import { playWord } from './play'
import {d1Word} from './d1-state.js'
import { loadD1Art, ribbonSvg, scrollSvg, shedRowSvg, renderD1TrimRow, renderD1TrimOutput } from './d1-state.js'
import {joinPath} from './d1-paths.js'
import { currentNotice } from './notice'
import { commitNote, sparkMark, sparkTerminal, stuckNote } from './notice-rows'
import type { SparkLook } from './notice-rows'
import { visitorHeadPicture } from './visitors-art'
import { loadWeekWords, weekWord } from './week-words'
import { WEEK_STORE, weekRecordFrom, weekStart } from './week-days'
import { weekReadyDue } from './openings'

export type C3TranscriptHooks = {
 state: () => {lastRunOutcome?:'pass'|'fail'|'unknown';recoveredReds?:number} | undefined
 pose: () => {frame:string;aside:string} | undefined
 bandCarries?: () => boolean // the band is drawn here and can carry his line
}
export type M1TranscriptHooks={closing:(id:string)=>GapClosing|undefined;restore:(id:string,value:unknown)=>GapClosing|undefined;limit:()=>GapLimit|undefined;screenReader:()=>boolean;firstHead:()=>boolean;weekOn:()=>boolean;today:()=>string}
let m1Hooks:M1TranscriptHooks|undefined
export function configureM1Transcript(hooks:M1TranscriptHooks):void{m1Hooks=hooks}
// The heads beside replies stay quiet where the painted band is up (latest.ts bandShownOn); the terminal draws no heads.
const noPaintedBand=(surface:RenderSurface):boolean=>!bandShownOn(surface,latest.view?.band)
async function withClosing($:Engine,e:{requestId:string;surface:RenderSurface},block:RenderElement):Promise<RenderElement>{
 if(e.surface==='terminal'||latest.view?.voice!=='off'||(latest.marks??MARKS_DEFAULT)==='off')return block
 const closing=m1Hooks?.closing(e.requestId)
 if(!closing)return block
 const sr=m1Hooks?.screenReader()===true
 const elements=$.ui.resolve(e as never)
 return renderClose(elements as never,block,e.requestId,closing.line,!sr&&noPaintedBand(e.surface))
}
export type D1TranscriptHooks={ribbon:()=>{index?:number;folder?:string}|undefined;helperRow?:(id:string)=>boolean;shedLine?:()=>string|undefined;shedShown?:(defer:(callback:()=>unknown)=>void)=>void;trimRow?:(id:string)=>import('./d1-trim').D1TrimRow|undefined;trimPress?:(key:string)=>Promise<boolean>;loadWords?:(read:()=>Promise<string>)=>Promise<void>}
let d1Hooks:D1TranscriptHooks|undefined
export function configureD1Transcript(hooks:D1TranscriptHooks):void{d1Hooks=hooks}
const shedRows=new Map<string,{line?:string;said:boolean}>()
let helperRowEpoch=0
const HELPER_TASK_CAP=64
const helperTaskStates=new Map<string,{status:string;notification:boolean}>()
const helperFirstRows=new Map<string,number>()
function helperFirstRowEpoch(requestId:string,toolUseId:string,task:{id:string;local:boolean}):number{
 const key=JSON.stringify([requestId,toolUseId,task.local,task.id]),epoch=helperFirstRows.get(key)??helperRowEpoch
 helperFirstRows.delete(key);helperFirstRows.set(key,epoch)
 while(helperFirstRows.size>HELPER_TASK_CAP)helperFirstRows.delete(helperFirstRows.keys().next().value!)
 return epoch
}
function rememberHelperTask(id:string,status:string,notification=false):void{
 helperTaskStates.delete(id);helperTaskStates.set(id,{status,notification})
 while(helperTaskStates.size>HELPER_TASK_CAP)helperTaskStates.delete(helperTaskStates.keys().next().value!)
}
function clearHelperTasks():void{helperRowEpoch++;helperTaskStates.clear()}
function nativeHelperTask(output:unknown):{id:string;local:boolean}|undefined{
 if(!output||typeof output!=='object'||Array.isArray(output))return undefined
 const value=output as {status?:unknown;agentId?:unknown;taskId?:unknown},id=value.status==='async_launched'?value.agentId:value.status==='remote_launched'?value.taskId:undefined
 return typeof id==='string'&&id?{id,local:value.status==='async_launched'}:undefined
}
async function nativeHelperCompleted($:Engine,task:{id:string;local:boolean}):Promise<boolean>{
 const known=helperTaskStates.get(task.id);if(known!==undefined)return known.status==='completed'
 if(!task.local)return false
 const own=helperRowEpoch
 const agents=await $.agent.list().catch(()=>[])
 if(own!==helperRowEpoch)return false
 const current=helperTaskStates.get(task.id);if(current!==undefined)return current.status==='completed'
 const state=agents.find(agent=>agent.id===task.id)?.status
 if(state==='completed')rememberHelperTask(task.id,state)
 return state==='completed'
}

function requestHead(id:string,mood:HeadState['mood']):HeadState|undefined{const current=d1Hooks?.ribbon();return ledger.request(id,mood,{ribbon:current?.index,folder:current?.folder})}
// The first head after a visit shows the visitor on his picture, and says so in place of its usual direction.
export type VisitTranscriptHooks={take:(lang:string)=>{kind:string;note:string}|undefined}
let visitHooks:VisitTranscriptHooks|undefined
export function configureVisitTranscript(hooks:VisitTranscriptHooks):void{visitHooks=hooks}
const visitHeads=new Map<string,{kind:string;note:string}>()
let c3Hooks:C3TranscriptHooks|undefined
export function configureC3Transcript(hooks:C3TranscriptHooks):void { c3Hooks=hooks }
const headDetails=new Map<string,{frame:string;aside:string}>()
let thanksTurn=false,thanksHead:string|undefined
// Her head for a frame name: every still of hers has one (head-art.ts), and an unknown name takes the fallback's.
export function headPicture(frame:string,fallback:string):string {
 const head=(name:string)=>{const key=HEAD_ALIAS[name]??name;return (HEAD_SVG as Record<string,string>)[key]??EXTRA_HEAD_SVG[key]}
 return (head(frame)??head(fallback)??HEAD_SVG['idle-reading']).replace('<svg xmlns=','<svg style="forced-color-adjust:none" xmlns=')
}
type Engine = EngineInterface
const stateHosts = new Map<string, Pick<Engine, 'env' | 'fs' | 'process' | 'plugin'>>()
function stateEngine($: Engine): Pick<Engine, 'env' | 'fs' | 'process' | 'plugin'> {
  let host = stateHosts.get($.plugin.root)
  if (!host) {
    host = {
      env: { get: (key: string) => {
      switch (key) {
        case 'OS': return $.env.get('OS')
        case 'HOME': return $.env.get('HOME')
        case 'USERPROFILE': return $.env.get('USERPROFILE')
        case 'PROCESSOR_ARCHITEW6432': return $.env.get('PROCESSOR_ARCHITEW6432')
        case 'PROCESSOR_ARCHITECTURE': return $.env.get('PROCESSOR_ARCHITECTURE')
        default: return Promise.resolve(undefined)
      }
    } },
      fs: { exists: (path: string) => $.fs.exists(path) },
      process: { run: (...args: Parameters<Engine['process']['run']>) => $.process.run(...args) },
      plugin: { root: $.plugin.root, name: $.plugin.name },
    } as Pick<Engine, 'env' | 'fs' | 'process' | 'plugin'>
    stateHosts.set($.plugin.root, host)
  }
  return host
}
function wordsOf(lang: string): (typeof WORDS)['en'] { return WORDS[lang as Lang] ?? WORDS.en }
// His spark beside a comment he liked (notice.ts decides which row). The words stay his: the head and the alt come from his word table.
async function sparkLook($:Engine,e:{surface:RenderSurface;viewport?:{columns:number}},ui:SparkLook['ui'],id:string,tool:string,input:unknown,output:unknown,onScreen:unknown):Promise<SparkLook|undefined>{
 const notice=currentNotice(),row=notice?.spark(id)
 if(!notice||!row)return undefined
 if(row.quote===undefined&&output!==undefined)await notice.quoteOf(id,tool,output).catch(()=>undefined)
 const lang=latest.view?.lang??'en',values=object(input),path=String(values.file_path??values.notebook_path??''),file=path.replaceAll('\\','/').split('/').pop()||path
 const first=notice.firstDraw(id)&&!latest.view?.d1ReducedMotion,shown=object(onScreen)
 return {ui,surface:e.surface,id,file,line:row.line,quote:row.quote,head:notice.word('spark.head'),alt:notice.word('spark.alt',{file,n:row.line,first_words:row.quote??''}),
  columns:e.viewport?.columns??80,theme:latest.view?.theme,drawing:first,below:shown.first===0,reader:await notice.screenReader()}
}
// The stuck note as a row, for the surfaces where the band does not carry it.
async function stuckRow(e:{surface:RenderSurface},ui:SparkLook['ui'],note:{cause:string;text:string}):Promise<RenderElement|undefined>{
 const notice=currentNotice()
 if(!notice)return undefined
 await notice.words()
 const reader=await notice.screenReader(),button=notice.word(reader?'stuck.button.sr':'stuck.button')
 return button?stuckNote({ui,surface:e.surface,cue:latest.view?.cue??'claude',name:wordsOf(latest.view?.lang??'en').name,text:note.text,cause:note.cause,button,reader}):undefined
}
const stuckBelongsHere=(e:{surface:RenderSurface;viewport?:{columns:number}}):boolean=>c3Hooks?.bandCarries?.()!==true||e.surface==='terminal'&&(e.viewport?.columns??80)<40
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}
let ledger = new TurnLedger()
let firstHeadId:string|undefined,firstHeadArmed=false,firstWelcome:Promise<void>|undefined
// Claim only after the first main response actually contains text, and only for
// a visible remote head. The owned native marker arbitrates windows atomically.
function prepareFirstHead($:Engine):Promise<void>{
  if(!m1Hooks?.firstHead()||(latest.marks??MARKS_DEFAULT)==='off'||latest.settings.voiceChosen===true)return Promise.resolve()
  return firstWelcome??=(async()=>{
    const owner=ledger
    const [firstMet,welcome]=await Promise.all([$.store.get('firstMet'),$.store.get('welcome')])
    if(owner!==ledger||firstMet!==undefined||welcome!==undefined)return
    let claimed=false
    try{const program=await stateProgram(stateEngine($));if(!program||owner!==ledger)return;const result=await $.process.run([program,'--claim-welcome'],{timeoutMs:2000});claimed=result.exitCode===0&&!result.isStdoutTruncated&&JSON.parse(result.stdout).claimed===true}catch{}
    if(!claimed||owner!==ledger||!m1Hooks?.firstHead()||(latest.marks??MARKS_DEFAULT)==='off')return
    const at=await $.clock.now()
    await $.store.set('welcome',{at})
    if(owner===ledger&&m1Hooks?.firstHead()&&(latest.marks??MARKS_DEFAULT)!=='off')firstHeadArmed=true
  })()
}
function applyFirstHead(id:string,head:HeadState|undefined):boolean{
  if(!firstHeadArmed||firstHeadId!==undefined||!head)return false
  firstHeadArmed=false;firstHeadId=id;head.first=true;head.mood='wave';return true
}
// The week's first head carries «week.ready» where no band shows it (FIRST-MEETING 3.8): asked once a session at its
// first reply, taken by that head, written false when the next turn starts, like the first hello. It never displaces
// the first meeting: then it waits for the week's next session.
// weekHeadArmed is the week's start, recorded as «weekReady» once a head takes the line (the band's own rule).
let weekHeadId:string|undefined,weekHeadArmed:string|undefined,weekAsked:Promise<void>|undefined
function prepareWeekHead($:Engine):Promise<void>{
  if(!m1Hooks?.firstHead()||!m1Hooks.weekOn()||(latest.marks??MARKS_DEFAULT)==='off')return Promise.resolve()
  return weekAsked??=(async()=>{
    const owner=ledger,lang=latest.view?.lang??'en',today=m1Hooks!.today()
    await loadWeekWords($)
    if(!weekWord(lang,'week.ready'))return
    const [held,announced]=await Promise.all([$.store.get(WEEK_STORE),$.store.get('weekReady')])
    if(owner===ledger&&weekReadyDue(weekRecordFrom(held),today,lang,announced))weekHeadArmed=weekStart(today,lang)
  })().catch(()=>{})
}
function applyWeekHead(id:string,head:HeadState|undefined):string|undefined{
  if(!weekHeadArmed||weekHeadId!==undefined||!head)return undefined
  const week=weekHeadArmed;weekHeadArmed=undefined
  if(head.first||firstHeadId===id)return undefined
  weekHeadId=id;head.week=true;return week
}
const failedHeads = new Set<string>()
let ledgerReady: Promise<void> | undefined
let persistence = { owner: ledger, session: '', order: 0 }
const recorded = new Map<string, string>()
const headReads = new Map<string, Promise<void>>()
function loadLedger($: Engine): Promise<void> {
  return ledgerReady ??= (async () => {
    const current = ledger
    const context = persistence
    const [heads, active, session, keys] = await Promise.all([$.store.get('heads').catch(() => undefined), $.store.get('lastActive').catch(() => undefined), $.session.id().catch(() => undefined), $.store.keys().catch(() => [])])
    if (current !== ledger) return
    ledger.restore(heads, active)
    context.session = session ?? ''
    const saved = keys.filter(key => headAddress(key)).sort().slice(-HEAD_CAP)
    if (saved.length) ledger.newest = undefined
    for (const key of saved) {
      const address = headAddress(key)!
      recorded.set(address.id, key)
      if (address.session === session) {
        ledger.newest = address.id
        context.order = Number(key.slice(HEAD_PREFIX.length, HEAD_PREFIX.length + 16))
      }
    }
    for (const [id, head] of ledger.heads) head.newest = id === ledger.newest
    if(ledger.newest){const held=await $.state.get({plugin:'coco',key:'head',id:ledger.newest}).catch(()=>({value:undefined}));if(current===ledger&&held.value?.week===true){weekHeadId=ledger.newest;const head=ledger.heads.get(weekHeadId);if(head)head.week=true;else ledger.heads.set(weekHeadId,{...held.value,newest:true})}if(current===ledger&&held.value?.first===true){firstHeadId=ledger.newest;const head=ledger.heads.get(firstHeadId);if(head)head.first=true;else ledger.heads.set(firstHeadId,{...held.value,newest:true})}}
  })()
}
function readRecordedHead($: Engine, id: string): Promise<void> | undefined {
  const key = recorded.get(id)
  if (!key || ledger.heads.has(id)) return
  let pending = headReads.get(id)
  if (!pending) {
    const current = ledger
    pending = $.store.get(key).then(stored => {
      if (current !== ledger) return
      const entry = headEntry(stored)
      if (entry?.[0] === id) ledger.heads.set(id, { mood: entry[1], endedAt: entry[2], ms: entry[3], newest: id === ledger.newest,...headAdornment(entry) })
      else ledger.seen.add(id)
    }, () => { if (current === ledger) ledger.seen.add(id) })
    headReads.set(id, pending)
  }
  return pending
}
async function saveHead($: Engine, id: string, head: HeadState, key: string, owner: TurnLedger): Promise<void> {
  await $.store.set(key,headTuple(id,head))
  if (owner === ledger) recorded.set(id, key)
  const keys = (await $.store.keys()).filter(key => headAddress(key)).sort()
  for (const old of keys.slice(0, Math.max(0, keys.length - HEAD_CAP))) {
    await $.store.delete(old)
    const address = headAddress(old)!
    if (owner === ledger && recorded.get(address.id) === old) {
      recorded.delete(address.id); headReads.delete(address.id); ledger.heads.delete(address.id)
    }
  }
}
async function writeHead($: Engine, id: string, head: HeadState, owner = ledger): Promise<void> {
  try {
    if ((await $.state.set({ plugin: 'coco', key: 'head', id }, head)).isSet) {
      if (owner === ledger) failedHeads.delete(id)
      return
    }
  } catch {}
  if (owner !== ledger) return
  failedHeads.add(id)
  $.ui.invalidate('ui.render')
}
function marksOf($: Engine): Marks | Promise<Marks> {
  if (latest.marks !== undefined) return latest.marks
  latest.marksRead ??= $.store.get('marks').then(stored => (latest.marks ??= marksFrom(stored)), () => (latest.marks ??= MARKS_DEFAULT))
  return latest.marksRead
}

export type OlderHeadDirection = 'news' | 'none' | 'all'
export const OLDER_HEAD_DIRECTION: OlderHeadDirection = 'news'
const HEAD_MOODS = ['wave', 'think', 'work', 'happy', 'flustered', 'error', 'refuse'] as const
const UNSPACED = new Set(['zh', 'zh-Hant', 'ja', 'ko'])

// Transcript directions stop on whole words; the band's shared cutter stays unchanged.
export function cutDirection(text: string, budget: number, lang: string): string | undefined {
  text=text.replace(/\*/g,'')
  if (planPx(text) <= budget) return text
  if (UNSPACED.has(lang)) return cutToPx(text, budget)
  const open = /^[（(「『【〔〈《［｛]/u.test(text) ? text[0]! : ''
  const close = /[)）」』】〕〉》］｝]$/u.test(text) ? text.slice(-1) : ''
  const words = text.slice(open.length, text.length - close.length).split(' ')
  while (words.length > 1) {
    words.pop()
    while (words.length && [...words[words.length - 1]!].length <= 4) words.pop()
    if (!words.length) return undefined
    const cut = `${open}${words.join(' ')}…${close}`
    if (planPx(cut) <= budget) return cut
  }
  return undefined
}

export function turnNote(head: HeadState, lang: string, now: number, timeZone: string | undefined): string | undefined {
  if (head.endedAt === undefined || head.ms === undefined) return undefined
  try {
    const locale = numberLocale(lang)
    const clock = moment(new Date(head.endedAt).toISOString(), now, lang, timeZone)
    const unit = head.ms >= 3_600_000 ? 'hour' : head.ms >= 60_000 ? 'minute' : 'second'
    const duration = new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'short', maximumFractionDigits: unit === 'hour' ? 1 : 0 }).format(head.ms / (unit === 'hour' ? 3_600_000 : unit === 'minute' ? 60_000 : 1000))
    return wordsOf(lang).transcript.turnTime.replace(/\{(clock|duration)\}/g, (_, slot: string) => slot === 'clock' ? clock : duration)
  } catch { return undefined }
}

export function planLine(text: string, lead: number, lang: string, columns: number, surface: RenderSurface): string | undefined {
  const budget = Math.max(0, columns) * 7.2 * (surface === 'mobile' ? 0.9 : 1)
  return cutDirection(text, budget - (lead + 7.2) - planPx(wordsOf(lang).name, true) - planPx(gapBefore(text, lang)), lang)
}

export function planHead(head: HeadState, lang: string, columns: number, surface: RenderSurface, face: boolean,
  now = Date.now(), timeZone?: string, olderDirection: OlderHeadDirection = OLDER_HEAD_DIRECTION): { direction?: string; label?: string; note?: string } {
  const w = wordsOf(lang)
  const cell = surface === 'desktop' ? COLUMN_PX : 7.2
  const budget = Math.max(0, columns) * cell * (surface === 'mobile' ? 0.9 : 1)
  const base = (face ? 35 + cell+(head.ribbon?8+cell:0) : planPx('✻ ', true)) + planPx(w.name, true)
  const buttonWidth = (text: string | undefined) => text ? planPx(text) + 3 * cell : 0
  const longest = Math.max(...HEAD_MOODS.map(mood => planPx(gapBefore(w.aside[mood], lang) + w.aside[mood])))
  const label = head.newest && face && columns >= 26
    ? base + buttonWidth(w.marks.book) + longest <= budget ? w.marks.book : w.marks.shelf
    : undefined
  const olderSettled = !head.newest && head.endedAt !== undefined
  const keepDirection = head.newest || olderDirection === 'all' || (olderDirection === 'news' && (!olderSettled || (head.mood !== 'happy' && head.mood !== 'idle')))
  let direction: string | undefined = face && keepDirection ? w.aside[head.mood] : undefined
  const gap = direction ? planPx(gapBefore(direction, lang)) : 0
  if (direction) direction = cutDirection(direction, budget - base - buttonWidth(label) - gap, lang)
  const note = surface !== 'mobile' && !label ? turnNote(head, lang, now, timeZone) : undefined
  const occupied = base + (direction ? gap + planPx(direction) : 0)
  return { direction, label, note: note && occupied + cell + planPx(note) <= budget ? note : undefined }
}

export function registerTranscript(on: On): void {
  on('command.*',async($,e,next)=>{
    if(!next.is('command.run',e)||e.command!=='clear')return next(e)
    const result=await next(e);clearHelperTasks();return result
  })
  // Narrow matchers coexist with the band's event hooks without a second unfiltered hook.
  on('turn.start', { turnId: /./ }, async ($, e, next) => {
    await loadLedger($)
    if(firstHeadId){const id=firstHeadId,head=ledger.heads.get(id);firstHeadId=undefined;firstHeadArmed=false;if(head){head.first=false;await writeHead($,id,head)}}
    if(weekHeadId){const id=weekHeadId,head=ledger.heads.get(id);weekHeadId=undefined;weekHeadArmed=undefined;if(head){head.week=false;await writeHead($,id,head)}}
    ledger.start(e.turnId, await $.clock.now())
    thanksTurn=isThanks(e.text);thanksHead=undefined
    return next(e)
  })
  on('turn.step', { turnId: /./ }, async function* ($, e, next) {
    const stream = next(e)
    try {
      while (true) {
        const part = await stream.next()
        if (part.done) return part.value
        if (e.agentId === undefined && part.value.kind === 'text' && part.value.text.length) {
          await prepareFirstHead($);await prepareWeekHead($)
          const demoted = ledger.arm(e.turnId)
          if (demoted) await writeHead($, demoted.id, demoted.head)
        }
        yield part.value
      }
    } finally { await stream.return?.(undefined as never) }
  })
  on('session.append',{door:'response'},async($,e,next)=>{
    if(e.agentId===undefined&&e.message.type==='assistant'&&e.message.content.some(block=>block.type==='text'&&typeof block.text==='string'&&block.text.length>0)){
      await loadLedger($)
      if(ledger.turn){
        const demoted=ledger.arm(ledger.turn.id)
        if(demoted)await writeHead($,demoted.id,demoted.head)
        await prepareFirstHead($);await prepareWeekHead($)
        const head=requestHead(e.uuid,latest.view?.mood??'think')
        if(applyFirstHead(e.uuid,head))await writeHead($,e.uuid,head!)
        const week=m1Hooks?.firstHead()?applyWeekHead(e.uuid,head):undefined
        if(week){await $.store.set('weekReady',week).catch(()=>{});await writeHead($,e.uuid,head!)}
      }
    }
    return next(e)
  })
  on('turn.complete', { turnId: /./ }, async ($, e, next) => {
    const context = persistence // Capture identity before the clock or publication can yield.
    const ended = context.owner.settle(e, await $.clock.now())
    if(ended&&ended.id===firstHeadId)ended.head.first=true
    if(ended&&ended.id===weekHeadId)ended.head.week=true
    if(ended){
      const state=c3Hooks?.state(),lang=latest.view?.lang??'en'
      if(state?.lastRunOutcome==='fail')headDetails.set(ended.id,{frame:'error',aside:wordsOf(lang).aside.error})
      else if(state?.lastRunOutcome==='pass'&&(state.recoveredReds??0)>0)headDetails.set(ended.id,{frame:'cheer-a',aside:c3Word(lang,'aside.cheer')})
      else if(thanksTurn&&thanksHead===undefined){thanksHead=ended.id;headDetails.set(ended.id,{frame:'flustered',aside:wordsOf(lang).aside.flustered})}
      else if(headDetails.get(ended.id)?.frame!=='flustered')headDetails.delete(ended.id)
      while(headDetails.size>HEAD_CAP)headDetails.delete(headDetails.keys().next().value!)
    }
    if (ended) {
      // The address orders ties; the stored tuple keeps the actual measured end time.
      context.order = Math.max(Math.floor(ended.head.endedAt!), context.order + 1)
      const key = context.session ? headKey(context.order, context.session, ended.id) : undefined
      await writeHead($, ended.id, ended.head, context.owner)
      try { if (key) await saveHead($, ended.id, ended.head, key, context.owner) } catch {}
    }
    return next(e)
  })
  on('session.end', { reason: ['clear', 'resume'] }, async ($, e, next) => {
    const ended = await next(e)
    ledger = new TurnLedger(); ledgerReady = undefined
    persistence = { owner: ledger, session: '', order: 0 }
    recorded.clear(); headReads.clear(); failedHeads.clear(); headDetails.clear();shedRows.clear();clearHelperTasks(); thanksTurn=false;thanksHead=undefined
    firstHeadId=undefined;firstHeadArmed=false;firstWelcome=undefined;weekHeadId=undefined;weekHeadArmed=undefined;weekAsked=undefined
    return ended
  })
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (!e.props.isFirstOfReply) { ledger.seen.add(e.requestId); return withClosing($,e,await next(e)) }
    await loadLedger($)
    await readRecordedHead($, e.requestId)
    const record = requestHead(e.requestId, latest.view?.mood ?? 'think')
    if (e.surface === 'terminal' || !record || (latest.marks ?? (await marksOf($))) === 'off') return withClosing($,e,await next(e))
    if(applyFirstHead(e.requestId,record)){const owner=ledger;$.clock.after(0,async()=>{if(owner===ledger&&firstHeadId===e.requestId&&record.first===true)await writeHead($,e.requestId,record,owner)})}
    const week=m1Hooks?.firstHead()?applyWeekHead(e.requestId,record):undefined
    if(week){const owner=ledger;$.clock.after(0,async()=>{await $.store.set('weekReady',week).catch(()=>{});if(owner===ledger&&weekHeadId===e.requestId&&record.week===true)await writeHead($,e.requestId,record,owner)})}
    if(record.ribbon)await d1Hooks?.loadWords?.(()=>$.fs.read(joinPath($.plugin.root,'hooks/d1-words.json')))
    const ref = { plugin: 'coco', key: 'head', id: e.requestId } as const
    const held = await $.state.get(ref).catch(() => ({ value: undefined, version: 0 }))
    const head = { ...(failedHeads.has(e.requestId) ? record : held.value ?? record), newest: record.newest,first:record.first??held.value?.first,week:record.week??held.value?.week,ribbon:record.ribbon,folder:record.folder }
    const theirs = await next(e)
    const { Box, Text, Svg, Button } = $.ui.resolve(e)
    const lang = latest.view?.lang ?? 'en'
    const w = wordsOf(lang)
    const face = m1Hooks?.screenReader()!==true&&noPaintedBand(e.surface)
    // The weekly line under the week's first head, plain and without a button, while the week setting is on.
    const weekShows=head.week===true&&!head.first&&m1Hooks?.firstHead()===true&&m1Hooks.weekOn()
    if(weekShows)await loadWeekWords($)
    const weekLine=weekShows?weekWord(lang,'week.ready'):''
    if(face&&head.ribbon)await loadD1Art('ribbon',path=>$.fs.read(joinPath($.plugin.root,path)))
    const [now, settings] = head.endedAt !== undefined && e.surface !== 'mobile'
      ? await Promise.all([$.clock.now(), $.settings.read()]) : [0, undefined]
    const timeZone = typeof settings?.timeZone === 'string' ? settings.timeZone : undefined
    const plan = planHead(head, lang, e.viewport?.columns ?? 80, e.surface, face, now, timeZone)
    const defaultFrame = head.mood === 'think' ? 'think-a' : head.mood === 'work' ? 'work-a' : STILL[head.mood]
    if(head.newest&&head.endedAt===undefined&&!headDetails.has(e.requestId)){
      const pose=c3Hooks?.pose();if(thanksTurn&&thanksHead===undefined){thanksHead=e.requestId;headDetails.set(e.requestId,{frame:'flustered',aside:w.aside.flustered})}else if(pose)headDetails.set(e.requestId,pose)
      while(headDetails.size>HEAD_CAP)headDetails.delete(headDetails.keys().next().value!)
    }
    const limit=head.newest?m1Hooks?.limit():undefined
    if(limit){plan.direction=planLine(limit.frame==='tea-a'?c3Word(lang,'aside.tea'):w.aside.waiting,35,lang,e.viewport?.columns??80,e.surface)}
    const detail=headDetails.get(e.requestId),frame=head.first&&head.endedAt===undefined?'wave':head.newest&&head.mood==='error'&&m1Hooks?.limit()?m1Hooks.limit()!.frame:detail?.frame??defaultFrame
    if(face&&head.newest&&!visitHeads.has(e.requestId)){const taken=visitHooks?.take(lang);if(taken){visitHeads.set(e.requestId,taken);while(visitHeads.size>HEAD_CAP)visitHeads.delete(visitHeads.keys().next().value!)}}
    const visitor=face?visitHeads.get(e.requestId):undefined
    if(detail&&face&&!limit)plan.direction=planLine(detail.aside,35+(head.ribbon?8+7.2:0),lang,e.viewport?.columns??80,e.surface)
    if(visitor&&!limit)plan.direction=planLine(visitor.note,35+(head.ribbon?8+7.2:0),lang,e.viewport?.columns??80,e.surface)
    const occupied=35+7.2+(head.ribbon?8+7.2:0)+planPx(w.name,true)+(plan.direction?planPx(gapBefore(plan.direction,lang)+plan.direction):0)+(plan.label?planPx(plan.label)+4*7.2:0)
    const live=latest.view,cost=live?.cost
    const windows=(live?.quota?.rateLimits??[]).filter(w=>w.kind==='five_hour'||w.kind==='seven_day')
    const headRoom=(e.viewport?.columns??80)*7.2*(e.surface==='mobile'?.9:1)-occupied
    // Their battery and power bank, as on the band (lane C, 10-14), stacked at one CSS px an art pixel beside the face.
    const quotaItems=head.newest&&face?quotaBandItems(lang as Lang,windows,{pace:live?.paceDetails?.filter(p=>live.hotWindows?.includes(p.kind))}):[]
    const quotaPx=quotaItems.length?Math.max(...quotaItems.map(item=>QUOTA_PICTURE_PX[item.kind]/2))+7.2:0
    const showQuota=quotaPx>0&&headRoom>=quotaPx
    // Breathing: the light on the side of their shut laptop, as on the band; its own CSS keeps it breathing between draws.
    const breath=head.newest&&face?live?.play?.breath:undefined
    const lightPx=breath?LIGHT_PX.width+7.2:0
    const showLight=lightPx>0&&headRoom>=(showQuota?quotaPx:0)+lightPx
    const showCup=!!(head.newest&&face&&cupShown(cost)&&headRoom>=(showQuota?quotaPx:0)+(showLight?lightPx:0)+16+7.2)
    const cupAt=showCup?await $.clock.now():now
    const hoverWidth=(e.viewport?.columns??80)*7.2*(e.surface==='mobile'?.9:1)
    const notesWidth=(texts:string[])=>texts.reduce((width,text)=>width+planPx(text),Math.max(0,texts.length-1)*7.2)
    const turn=plan.note??turnNote(head,lang,now,timeZone)
    const noteText=(plan.note||head.folder)&&e.surface!=='mobile'?`${head.folder??''}${head.folder&&turn?', ':''}${turn??''}`:undefined
    let cacheNotes=cost?cacheHover(cost,lang,false,timeZone):[]
    if(notesWidth([...(noteText?[noteText]:[]),...cacheNotes])>hoverWidth)cacheNotes=cost?cacheHover(cost,lang,true,timeZone):[]
    const hoverNotes=[
      ...(noteText?[{text:noteText,node:<Text color="inactive">{head.folder?<Text bold>{head.folder}</Text>:undefined}{head.folder&&turn?', ':''}{turn}</Text>}]:[]),
      ...cacheNotes.map(text=>({text,node:<Text color="inactive">{text}</Text>})),
    ].filter(item=>!!item.text&&planPx(item.text)<=hoverWidth)
    while(hoverNotes.length>1&&notesWidth(hoverNotes.map(item=>item.text))>hoverWidth)hoverNotes.pop()
    return withClosing($,e,(
      <Box flexDirection="column">
        <Box key={`coco:head:${e.requestId}`} flexDirection="row" alignItems="center">
          {face&&head.ribbon?<Box marginRight={1} flexShrink={0}><Svg source={ribbonSvg(head.ribbon,28,false,8)} alt={d1Word(lang,'ribbon.alt',{folder:head.folder??''})} width={8} height={28}/></Box>:undefined}
          {face ? <Svg source={visitor?visitorHeadPicture(headPicture(frame,defaultFrame),visitor.kind):headPicture(frame,defaultFrame)} alt={visitor?.note??''} width={35} height={32} /> : undefined}
          <Box flexDirection="row" flexGrow={1} flexShrink={1} minWidth={0} {...(face ? { marginLeft: 1 } : {})}>
            <Text wrap="truncate-end">
              <Text bold>{face||m1Hooks?.screenReader()?undefined:<Text color="claude">{'✻ '}</Text>}{head.first?gapCharacterName(lang):w.name}</Text>
              {face && plan.direction ? gapBefore(plan.direction, lang) : ''}
              {face && plan.direction ? <Text italic={!NO_ITALIC.has(lang)} color="inactive">{plan.direction}</Text> : undefined}
            </Text>
          </Box>
          {showQuota?<Box key="coco:head:quota" marginLeft={1} flexShrink={0} flexDirection="column" alignItems="flex-start">{quotaItems.map(item=><Svg key={'coco:head:quota:'+item.kind} source={item.picture} alt={item.alt} width={QUOTA_PICTURE_PX[item.kind]/2} height={12}/>)}</Box>:undefined}
          {showLight&&breath?<Box key="coco:head:light" marginLeft={1} flexShrink={0}><Svg source={laptopLightSvg(Math.round(Math.max(0,(live?.play?.at??breath.since)-breath.since)/100)*100,breath.still===true||live?.d1ReducedMotion===true)} alt={playWord(lang as Lang,'alt.incense.breathing')} width={LIGHT_PX.width} height={LIGHT_PX.height}/></Box>:undefined}
          {showCup&&cost?<Box key="coco:head:cup" marginLeft={1} flexShrink={0}><Svg source={cupSvg(cost.cache.state)} alt={cacheAlt(cost,lang,cupAt)} width={16} height={22}/></Box>:undefined}
          {plan.label ? <Box marginLeft={1} flexShrink={0}><Button key="coco:book:open" label={plan.label} onPress={() => {}} /></Box> : undefined}
          {hoverNotes.length ? <Box position="absolute" right={0} top={0} bottom={0} flexDirection="row" columnGap={1} alignItems="center" display="none" hover={{ display: 'flex' }}>{hoverNotes.map(item=>item.node)}</Box> : undefined}
        </Box>
        {head.first&&m1Hooks?.firstHead()?<Box flexDirection="row"><Box width={35} flexShrink={0}/><Box marginLeft={1} flexGrow={1} flexShrink={1} minWidth={0}><Text wrap="wrap">{LINES[lang as Lang].first_meet[0]}</Text></Box></Box>:undefined}
        {weekLine?<Box flexDirection="row"><Box width={35} flexShrink={0}/><Box marginLeft={1} flexGrow={1} flexShrink={1} minWidth={0}><Text wrap="wrap">{weekLine}</Text></Box></Box>:undefined}
        {head.newest&&(e.surface==='vscode'||e.surface==='mobile')&&latest.view?.moreActions?.some(action=>action.key==='coco:more:explain')?<Box flexDirection="row">{latest.view.moreActions.filter(action=>action.key==='coco:more:explain').map(action=><Button key={action.key} label={action.label} onPress={()=>{}}/>)}</Box>:undefined}
        {limit&&noPaintedBand(e.surface)?renderLimitNote({Box,Text,Svg,Button},limit,m1Hooks?.screenReader()):undefined}
        {theirs}
      </Box>
    ))
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if(e.props.origin.kind==='task-notification'&&e.props.task?.id&&['completed','failed','killed'].includes(e.props.task.status??''))rememberHelperTask(e.props.task.id,e.props.task.status!,true)
    if(!PERSON.has(e.props.origin.kind))return next(e)
    const mark=e.surface!=='terminal'&&(latest.marks??await marksOf($))==='on'
    if(!mark)return next(e)
    const theirs=await next(e),{Box,Text}=$.ui.resolve(e),lang=latest.view?.lang??'en'
    return <Box flexDirection="column">
      <Box flexDirection="row" justifyContent={e.surface==='vscode'?'flex-start':'flex-end'}><Text bold>{wordsOf(lang).marks.you}</Text></Box>
      {theirs}
    </Box>
  })

  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    if (e.surface === 'terminal' || (latest.marks ?? (await marksOf($))) === 'off') return next(e)
    const theirs = await next(e)
    const { Box, Text, Svg } = $.ui.resolve(e)
    const lang = latest.view?.lang ?? 'en'
    const w = wordsOf(lang)
    const face = e.surface !== 'desktop'
    const direction = face ? planLine(w.aside.question, 35, lang, e.viewport?.columns ?? 80, e.surface) : w.aside.question.replace(/\*/g,'')
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" alignItems="center">
          {face ? <Svg source={HEAD_SVG.waiting} alt="" width={35} height={32} /> : undefined}
          <Box flexGrow={1} flexShrink={1} {...(face ? { marginLeft: 1 } : {})}>
            <Text wrap={face ? 'truncate-end' : 'wrap'}><Text bold>{face||m1Hooks?.screenReader()?undefined:<Text color="claude">{'✻ '}</Text>}{w.name}</Text>{direction ? e.surface === 'desktop' ? gapBefore(direction) : gapBefore(direction, lang) : ''}{direction ? <Text italic={!NO_ITALIC.has(lang)} {...(face ? { color: 'inactive' as const } : {})}>{direction}</Text> : undefined}</Text>
          </Box>
        </Box>
        {theirs}
      </Box>
    )
  })

  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    if (e.surface === 'terminal' || e.props.command !== 'compact' || e.props.isErrored || (latest.marks ?? (await marksOf($))) === 'off') return next(e)
    const theirs = await next(e)
    const { Box, Text, Svg } = $.ui.resolve(e)
    const lang = latest.view?.lang ?? 'en'
    const w = wordsOf(lang)
    await d1Hooks?.loadWords?.(()=>$.fs.read(joinPath($.plugin.root,'hooks/d1-words.json')))
    const shed=d1Word(lang,'marks.shed'),remote = e.surface !== 'desktop'
    const shedMark=!!d1Hooks&&!!shed&&noPaintedBand(e.surface),lead=shedMark?26:20
    if(shedMark)await loadD1Art('shed',path=>$.fs.read(joinPath($.plugin.root,path)))
    const directionText=(shedMark?shed:w.marks.swept).replace(/\*/g,'')
    const direction = remote ? planLine(directionText,lead,lang,e.viewport?.columns??80,e.surface):directionText
    let first=shedRows.get(e.requestId)
    if(shedMark&&!first){first={line:d1Hooks?.shedLine?.()?.replace(/\*/g,''),said:false};shedRows.set(e.requestId,first);while(shedRows.size>HEAD_CAP)shedRows.delete(shedRows.keys().next().value!)}
    if(first?.line&&!first.said){first.said=true;d1Hooks?.shedShown?.(callback=>{$.clock.after(0,async()=>{await callback()})})}
    return (
      <Box flexDirection="column">
        {theirs}
        <Box flexDirection="row" alignItems="center">
          {shedMark?<Svg source={shedRowSvg()} alt="" width={26} height={15}/>:remote ? <Svg source={offeringSvg(0, true)} alt="" width={20} height={18} /> : undefined}
          {remote||shedMark ? <Box flexGrow={1} flexShrink={1} minWidth={0} marginLeft={1}>
            <Text wrap="truncate-end"><Text bold>{w.name}</Text>{direction ? gapBefore(direction, lang) : ''}{direction ? <Text italic={!NO_ITALIC.has(lang)} color="inactive">{direction}</Text> : undefined}</Text>
          </Box> : <Box flexDirection="row" flexWrap="wrap" flexGrow={1} flexShrink={1} minWidth={0} alignItems="flex-start">
            <Text bold><Text color="claude">{'✻ '}</Text>{w.name}</Text>
            {direction ? <Text wrap="wrap">{gapBefore(direction)}<Text italic={!NO_ITALIC.has(lang)}>{direction}</Text></Text> : undefined}
          </Box>}
        </Box>
        {shedMark&&first?.line?<Text wrap="wrap">{first.line}</Text>:undefined}
      </Box>
    )
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const own=helperRowEpoch,output=e.props.output,task=(e.props.tool==='Agent'||e.props.tool==='Task')?nativeHelperTask(output):undefined
    const rowCurrent=!task||helperFirstRowEpoch(e.requestId,e.props.tool_use_id,task)===own
    const trim=d1Hooks?.trimRow?.(e.props.tool_use_id),done=!e.props.isRunning&&!e.props.isErrored&&!e.props.isInterrupted
    const marked=done&&(latest.marks??await marksOf($))!=='off',mark=e.surface!=='terminal'&&marked
    if(marked)await currentNotice()?.ready()
    const nativeDone=!!output&&typeof output==='object'&&!Array.isArray(output)&&(output as {status?:unknown}).status==='completed'
    const eligibleHelper=mark&&(e.props.tool==='Agent'||e.props.tool==='Task'),known=task&&helperTaskStates.get(task.id)
    let helper=eligibleHelper&&(nativeDone||(known!==undefined&&(rowCurrent||known.notification)?known.status==='completed':rowCurrent&&(d1Hooks?.helperRow?.(e.props.tool_use_id)===true||task!==undefined&&await nativeHelperCompleted($,task))))
    if(own!==helperRowEpoch&&!nativeDone)helper=false
    const change=marked&&currentNotice()?.spark(e.props.tool_use_id)!==undefined
    if(!trim&&!helper&&!change&&!(eligibleHelper&&task))return next(e)
    const theirs=await next(e),lang=latest.view?.lang??'en'
    if(!nativeDone){
      if(own!==helperRowEpoch)helper=false
      else if(task){const current=helperTaskStates.get(task.id);if(current!==undefined&&(rowCurrent||current.notification))helper=eligibleHelper&&current.status==='completed'}
    }
    if(!trim&&!helper&&!change)return theirs
    if(helper)await loadD1Art('helpers',path=>$.fs.read(joinPath($.plugin.root,path)))
    if(trim)await loadD1Art('trim',path=>$.fs.read(joinPath($.plugin.root,path)))
    if(own!==helperRowEpoch&&!nativeDone)helper=false
    if(!trim&&!helper&&!change)return theirs
    const look=change?await sparkLook($,e,$.ui.resolve(e),e.props.tool_use_id,e.props.tool,e.props.input,e.props.output,e.props.onScreen):undefined
    if(e.surface==='terminal'){const ui=$.ui.resolve(e),{Box}=ui,t=look?sparkTerminal(look):undefined;return <Box flexDirection="column" {...(t?.pad?{paddingRight:t.pad}:{})}>{theirs}{t?.mark}{trim?renderD1TrimRow(ui,trim,e.surface,lang,e.viewport?.columns??80):undefined}{t?.reader}</Box>}
    const ui=$.ui.resolve(e),{Box,Svg}=ui
    let adornment:RenderElement|undefined
    if(helper){const source=scrollSvg().replace('viewBox="0 0 12 18"','viewBox="0 0 9 18"').replace('width="12"','width="9"');adornment=<Box position="absolute" {...(e.surface==='desktop'?{left:-2}:{right:0})} top={0}><Svg alt="" source={source} width={9} height={18}/></Box>}
    else if(look)adornment=sparkMark(look)
    return <Box flexDirection="column" {...(adornment&&e.surface!=='desktop'?{paddingRight:2}:{})}>{theirs}{adornment}{trim?renderD1TrimRow(ui,trim,e.surface,lang,e.viewport?.columns??80):undefined}</Box>
  })
  // His notes under a tool's own result, after the engine's drawing and never in place of it: the commit he
  // marked and, where the band does not carry it, the note when Claude seems stuck.
  on('ui.render',{component:'ToolResult'},async($,e,next)=>{
    const notice=currentNotice(),id=e.props.tool_use_id
    const commit=notice?.commit(id),stuck=notice?.note(id)
    if(!notice||e.props.isErrored||(!commit&&!stuck))return next(e)
    const columns=e.viewport?.columns??80
    const stuckHere=stuck!==undefined&&stuckBelongsHere(e)
    const noteHere=commit!==undefined&&(latest.marks??await marksOf($))!=='off'
    if(!stuckHere&&!noteHere)return next(e)
    await notice.words()
    const ui=$.ui.resolve(e),{Box}=ui
    let row:RenderElement|undefined
    if(commit&&noteHere){
      const short=notice.word(`commit.quality.${commit.quality}`)
      if(short){
        const alt=notice.word('commit.note.alt',{quality:short,quote:commit.quote??''})?.replace(/[,，、]?\s*"{2}\s*$/,'')??short
        row=commitNote({ui,surface:e.surface,columns,cue:latest.view?.cue??'claude',name:wordsOf(latest.view?.lang??'en').name,full:commit.quote?notice.word(`commit.praise.${commit.quality}`,{quote:commit.quote})??short:short,short,alt,reader:await notice.screenReader()})
      }
    }else if(stuck)row=await stuckRow(e,ui,stuck)
    const theirs=await next(e)
    return row?<Box flexDirection="column">{theirs}{row}</Box>:theirs
  })
  on('ui.render',{component:'ToolResult'},async($,e,next)=>{
    const trim=d1Hooks?.trimRow?.(e.props.tool_use_id)
    if(!trim||e.props.tool!=='Bash')return next(e)
    const raw=e.props.output
    let output:string|undefined
    if(typeof raw==='string')output=raw
    else if(raw&&typeof raw==='object'){
      const value=raw as Record<string,unknown>
      if(typeof value.stdout==='string'&&typeof value.stderr==='string')output=value.stdout+(value.stderr?(value.stdout&&!value.stdout.endsWith('\n')?'\n':'')+value.stderr:'')
    }
    if(output===undefined)return next(e)
    const lines=output.split('\n')
    if(trim.markerLines?trim.markerLines.length===0||!trim.markerLines.every(index=>Number.isInteger(index)&&index>=0&&trim.markers.includes(lines[index]!)):!trim.markers.some(marker=>lines.includes(marker)))return next(e)
    await next(e)
    await loadD1Art('trim',path=>$.fs.read(joinPath($.plugin.root,path)))
    // The ToolUse wrapper retains the host row; only its known trimmed Bash body is restyled.
    return renderD1TrimOutput(output,trim,$.ui.resolve(e))
  })
  on('ui.press',{element:/^coco:trim:(?:open|copy):/},async($,e,next)=>{
    if(await d1Hooks?.trimPress?.(e.element))return {element:e.element}
    return next(e)
  })

  // A folded group carries the spark of the read inside it; unfolded, the read's own row does.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const notice = currentNotice(), calls = e.props.calls
    await notice?.ready()
    if (!notice || e.props.isActive || e.props.isExpanded || !calls.length || calls.some(call => call.isRunning || call.isErrored || call.isInterrupted)) return next(e)
    const marked = (latest.marks ?? (await marksOf($))) !== 'off'
    const sparked = marked ? calls.find(call => call.tool_use_id !== undefined && notice.spark(call.tool_use_id)) : undefined
    const stuck = stuckBelongsHere(e) ? calls.map(call => call.tool_use_id === undefined ? undefined : notice.note(call.tool_use_id)).find(note => note !== undefined) : undefined
    if (!sparked && !stuck) return next(e)
    const theirs = await next(e), ui = $.ui.resolve(e), { Box } = ui
    const look = sparked ? await sparkLook($, e, ui, sparked.tool_use_id!, sparked.tool ?? '', sparked.input, undefined, undefined) : undefined
    const row = stuck ? await stuckRow(e, ui, stuck) : undefined
    if (!look && !row) return theirs
    if (e.surface === 'terminal') { const t = look ? sparkTerminal(look) : undefined; return <Box flexDirection="column" {...(t?.pad ? { paddingRight: t.pad } : {})}>{theirs}{t?.mark}{t?.reader}{row}</Box> }
    return <Box flexDirection="column" {...(look && e.surface !== 'desktop' ? { paddingRight: 2 } : {})}>{theirs}{look ? sparkMark(look) : undefined}{row}</Box>
  })

  // Dormant on today's desktop (see above): where the step row has nothing to say but "Working",
  // his reading word. A step's own words and every message the engine puts there pass untouched.
  on('ui.render', { component: 'Spinner', surface: 'desktop' }, async ($, e, next) => {
    const verb = latest.view?.verb
    if (e.props.message !== null || e.props.word !== 'Working' || !verb || (latest.marks ?? (await marksOf($))) === 'off') return next(e)
    return next({ ...e, props: { ...e.props, word: verb } })
  })

  // A mode label in the desktop footer while his voice is full, so nobody wonders why Claude
  // sounds different. Light, the default, adds at most one line after a task and shows nothing.
  on('ui.render', { component: 'SessionMode', surface: 'desktop' }, async ($, e, next) => {
    const view = latest.view
    if (view?.voice !== 'full' || (latest.marks ?? (await marksOf($))) === 'off') return next(e)
    return next({ ...e, props: { ...e.props, modes: [...e.props.modes, wordsOf(view.lang).marks.mode] } })
  })
}
