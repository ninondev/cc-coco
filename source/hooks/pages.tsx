import * as priceRuntime from './cost/units.js'
import { pricesPage as renderPricesPage } from './cost/prices-page'
import type { D1Snapshot } from './d1-runtime'
import { loadD1Words, d1Words } from './d1-state.js'
import * as D1Room from './d1-state.js'
import { loadD1Art } from './d1-state.js'
import { ATOMIC_WRITE } from './shared-files'
// His book: the pane /coco (or the band's "His book" button) opens. Six pages built from
// what the plugin and Claude Code already hold: no tokens, no network, no timer of its own. It
// draws only while open. Its words (plugin/book/<lang>.json, English and his language), its
// portraits and its drawings are read or built while it is open and let go when it closes, so
// the closed book holds nothing but which page it was on. What keeps the open book current are
// observers on writes that happen anyway (the band's view, the engine's usage figures, the
// plugin's own store): each is a comparison and, when the open page shows what moved, one
// redraw of the pane on the next tick. Other plugins' writes and closes are theirs: the hooks
// below act only on this plugin's own. It registers no hook on an event the rest of the plugin
// hooks without a matcher (one such hook per event per plugin).

import { numberText } from './numbers'
import { composedVoiceSize, voiceTokens, commandClashes, boundedHealth, fixHealthDeadline } from './more-checks'
import { foldScripts, inspectScripts, scriptArgv } from './more-scripts'
import { MorePage, MoreTalk, MoreExplanation, MoreLook } from './more-book'
import type { MoreRuntime } from './more-runtime'
import { morePayer } from './more-state'
import type { MoreBookData } from './more-book'
import { keyPlatform, keyNoDisplay } from './talk-key'
import { moreWord, moreFill, loadMoreWords } from './more-words'
import { ReceivedNotesBook } from './window-notes'
import { focusBook } from './mod-gaps'
import { gapWord, gapFill, gapCharacterName, claudieName } from './mod-gaps-words'
import { PAGES } from './book-words'
import type { RenderElement, Elements } from 'claude-code'
import type { EngineInterface, On, SessionUsage, SessionMeasureInput } from 'claude-code'
import { desktopBook, terminalBook, answeredVoiceRow } from './book.js'
import type { BookData, BookWindow, Press } from './book'
import { forgetBookArt, bookCompanionStageSvg } from './book-art'
import { IconBook, IconSession, iconChoice, iconReport, iconRestoreKey, isIconPick } from './icon-book'
import type { IconAction } from './icon-book'
import { CompanionBook, companionState, companionCommand, COMPANION_APP, COMPANION_PLIST, COMPANION_OPEN } from './companion-book'
import type { CompanionSnapshot, CompanionBookData, CompanionAction, CompanionRun, CompanionInfo } from './companion-book'
import { petAppFolder, petDataFolder, petWriteArgv } from './pet-program'
import { COMPANION_SIZES, STAGE_HEIGHT, STAGE_POSE, companionSizeSvg } from './companion-art'
import type { CompanionStage, CompanionSize } from './companion-art'
import { COMPANION_DIR, companionRequestText } from './companion'
import type { CompanionRequest } from './companion'
import { fill, overEnglish } from './book-words'
import { PLUGIN_VERSION } from './plugin-version'
import type { BookWords, Page } from './book-words'
import { bookCachePercent } from './book-session'
import { cardDestination, cardName, cardSaveWords, revealCard, saveCard, saveWeekCard } from './card-runtime'
import { vibeCardSvg, vibePngSize, vibeRarity } from './vibe-card'
import type { VibeCardRow } from './vibe-card'
import { loadCardMetrics } from './card-metrics-lazy'
import { reminderSettings } from './reminder-settings'
import { WEEK_STORE, viewTotals, weekIssues, weekRange, weekRecordFrom, weekView, zineCover } from './week-days'
import { weekBookData } from './week-book'
import { dealtCards } from './cards/state'
import { forgetWeekWords, loadWeekWords, weekWord } from './week-words'
import { weekCardSvg } from './week-card'
import type { WeekWord } from './week-book'
import type { CardDestination, CardSaveResult } from './card-runtime'
import { checkup, readCheckCompanion } from './checkup'
import type { CheckRow, CheckSession, CheckCompanion, CheckHealth } from './checkup'
import { MARKS_DEFAULT, latest, marksFrom } from './latest'
import type { Marks } from './latest'
import { localDay } from './mood'
import { cocoHas, cocoSocksWorn, cocoStill, cocoWidth } from './coco-motion'
import type { CocoOutfit } from './coco-motion'
import { PORTRAIT_POSES, bookPortrait } from './book-portrait'
import { homePath, isWindows, joinPath, presenceFolder } from './d1-paths.js'
import { currentNotice } from './notice'
import { guestBook, guestBookReading, loadVisitorData, loadVisitorWords, visitorArtReady, visitorHasWord, visitorWord } from './visitors-art'
import { readVisits, visitDay, visitorKey, visitorsOn } from './visitors'
import type { Visit, VisitorKind } from './visitors'
import { loadC3Words } from './c3-words'
import { VOICE } from './voice'
import { WORDS } from './words'
import type { Lang } from './words'
import type { CocoBook, CocoView, CostSurfaceSnapshot } from '../types'
import { costSnapshot } from './cost/state'
import { costWord, installCostWords } from './cost/words'
import type { PricesController } from './cost/prices/runtime'
import type { pricesPage as PricesPageRenderer } from './cost/prices-page'
import type { ShippedPrices } from './cost/prices/load'
import { bagFill, bagPageName, bagWords, loadBagWords, sockMode, sockPair, socksOpen, vibeSet, vibeSituation } from './bag'
import type { BagPeek } from './bag'

type Engine = EngineInterface
type Timer = { cancel: () => void }

function bookEngine($: Engine): Engine {
  return {
    store: { get: (key: string) => $.store.get(key), set: (key: string, value: unknown) => $.store.set(key, value as never) },
    ui: { toast: (text: string, options?: { timeoutMs?: number }) => $.ui.toast(text, options), invalidate: () => $.ui.invalidate('ui.render') },
    session: { id: () => $.session.id(), surfaces: () => $.session.surfaces() },
    clock: { now: () => $.clock.now() },
    env: { get: (key: string) => key === 'HOME' ? $.env.get('HOME') : key === 'USERPROFILE' ? $.env.get('USERPROFILE') : key === 'OS' ? $.env.get('OS') : key === 'XDG_STATE_HOME' ? $.env.get('XDG_STATE_HOME') : Promise.resolve(undefined) },
    fs: {
      exists: (path: string) => $.fs.exists(path),
      read: (path: string, options?: { as: 'bytes' }) => options ? $.fs.read(path, options) : $.fs.read(path),
      write: (path: string, text: string) => $.fs.write(path, text),
      stat: (path: string) => $.fs.stat(path),
    },
    process: { run: (argv: string[], options?: Parameters<Engine['process']['run']>[1]) => $.process.run(argv, options) },
    plugin: { root: $.plugin.root, name: $.plugin.name },
    settings: { read: () => $.settings.read() },
    config: { list: () => $.config.list() },
  } as unknown as Engine
}

async function windows($: Engine): Promise<boolean> {
  const [os, home, profile] = await Promise.all([$.env.get('OS'), $.env.get('HOME'), $.env.get('USERPROFILE')])
  return isWindows(os, home, profile)
}

async function homeOf($: Engine): Promise<string | undefined> {
  const home = await $.env.get('HOME')
  return homePath(home, home ? undefined : await $.env.get('USERPROFILE'))
}

export const BOOK_PANE = 'coco-book'
const BOOK = { plugin: 'coco', key: 'book' } as const
const VIEW = { plugin: 'coco', key: 'view' } as const

// The store values each page shows: a write to one of these redraws the open book on that page.
function morePageEngine($:Engine):Engine {
 return {
  ...bookEngine($),
  fs:{read:(path:string)=>$.fs.read(path),write:(path:string,text:string)=>$.fs.write(path,text),exists:(path:string)=>$.fs.exists(path),stat:(path:string)=>$.fs.stat(path)},
  store:{get:(key:string)=>$.store.get(key),set:(key:string,value:unknown)=>$.store.set(key,value as never)},
  // The Lively timer belongs to the band's engine (register.tsx). The waits a book press or Talk's drawing can start are
  // Talk's: the pause before his next message, one at a time, only while Talk is drawn and his messages are still to come,
  // and the ten quiet minutes before Coco's one line (talk-openers.ts), only while Talk stays open.
  clock:{now:()=>$.clock.now(),after:(ms:number,callback:()=>unknown)=>$.clock.after(ms,callback)},
  model:{complete:(...args:Parameters<Engine['model']['complete']>)=>$.model.complete(...args)},
  agent:{register:(...args:Parameters<Engine['agent']['register']>)=>$.agent.register(...args),spawn:(...args:Parameters<Engine['agent']['spawn']>)=>$.agent.spawn(...args)},
  tool:{check:(...args:Parameters<Engine['tool']['check']>)=>$.tool.check(...args),register:(...args:Parameters<Engine['tool']['register']>)=>$.tool.register(...args)},
  config:{list:()=>$.config.list(),set:(...args:Parameters<Engine['config']['set']>)=>$.config.set(...args)},
  command:{run:(...args:Parameters<Engine['command']['run']>)=>$.command.run(...args)},
  prompt:{read:()=>$.prompt.read(),fill:(...args:Parameters<Engine['prompt']['fill']>)=>$.prompt.fill(...args)},
  session:{messages:()=>$.session.messages(),usage:()=>$.session.usage(),repo:()=>$.session.repo(),send:(...args:Parameters<Engine['session']['send']>)=>$.session.send(...args),append:(...args:Parameters<Engine['session']['append']>)=>$.session.append(...args)},
  turn:{abort:(...args:Parameters<Engine['turn']['abort']>)=>$.turn.abort(...args)},
  ui:{selection:async()=>{try{return await ($.ui as Engine['ui']&{selection:()=>Promise<{text:string}|undefined>}).selection()}catch{return undefined}},ask:(...args:Parameters<Engine['ui']['ask']>)=>$.ui.ask(...args),copy:(...args:Parameters<Engine['ui']['copy']>)=>$.ui.copy(...args),invalidate:(...args:Parameters<Engine['ui']['invalidate']>)=>$.ui.invalidate(...args),log:(...args:Parameters<Engine['ui']['log']>)=>$.ui.log(...args),status:(...args:Parameters<Engine['ui']['status']>)=>$.ui.status(...args),toast:(...args:Parameters<Engine['ui']['toast']>)=>$.ui.toast(...args)},
  process:{run:(...args:Parameters<Engine['process']['run']>)=>$.process.run(...args)},
  env:{get:(key:string)=>{
   switch(key){
    case 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC':return $.env.get('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC')
    case 'CLAUDE_CODE_USE_BEDROCK':return $.env.get('CLAUDE_CODE_USE_BEDROCK')
    case 'CLAUDE_CODE_USE_VERTEX':return $.env.get('CLAUDE_CODE_USE_VERTEX')
    case 'CLAUDE_CODE_USE_FOUNDRY':return $.env.get('CLAUDE_CODE_USE_FOUNDRY')
    case 'CLAUDE_CODE_USE_MANTLE':return $.env.get('CLAUDE_CODE_USE_MANTLE')
    case 'CLAUDE_CODE_USE_ANTHROPIC_AWS':return $.env.get('CLAUDE_CODE_USE_ANTHROPIC_AWS')
    case 'ANTHROPIC_BASE_URL':return $.env.get('ANTHROPIC_BASE_URL')
    // The key program's helpers need the session bus and the display; SSH means no window can open.
    case 'OS':return $.env.get('OS')
    case 'DBUS_SESSION_BUS_ADDRESS':return $.env.get('DBUS_SESSION_BUS_ADDRESS')
    case 'XDG_RUNTIME_DIR':return $.env.get('XDG_RUNTIME_DIR')
    case 'DISPLAY':return $.env.get('DISPLAY')
    case 'WAYLAND_DISPLAY':return $.env.get('WAYLAND_DISPLAY')
    case 'SSH_CONNECTION':return $.env.get('SSH_CONNECTION')
    default:return Promise.resolve(undefined)
   }
  }},
 } as unknown as Engine
}

let m1Runtime: MoreRuntime | undefined
let m1TalkOpen = false
let m1VoiceCardShown = false
let m1VoiceAnswered = false
let m1VoiceAskActive = false
const m1ScriptFolds = new Set<string>()
const m1VoiceSizes = new Map<string,number>()
const m1CheckAfter = new Map<string,string>()
export function configureM1Book(runtime: MoreRuntime): void { m1Runtime = runtime }
/** Who pays, and where the key row is drawn: read to draw only; the key program never runs for this. `drawn` is true
 * where who pays is on screen: the More page, or the switches page under Talk. */
// Who pays is asked of the host once a minute at most (owner 10-19, his presses lagged): the host holds the credential for
// every ask, and the switches page asked on each of its many drawings, which then all waited seconds on the same host. A
// drawing after the first uses the kind it last heard while a fresh ask runs on its own and redraws only if the kind moved.
let payerHeard:{kind:string|undefined,at:number}|undefined,payerAsking:Promise<string|undefined>|undefined
function askPayer($:Engine):Promise<string|undefined>{
  payerAsking??=$.session.authorize().then(held=>held?.kind,()=>undefined).then(kind=>{
    const moved=payerHeard!==undefined&&payerHeard.kind!==kind
    payerHeard={kind,at:Date.now()};payerAsking=undefined
    if(moved)$.ui.invalidate('ui.render')
    return kind
  })
  return payerAsking
}
async function m1KeyData($:Engine,columns:number|undefined,drawn=m1Runtime?.open===true):Promise<Pick<MoreBookData,'payer'|'place'|'columns'>>{
  let payerKind:string|undefined
  if(!payerHeard)payerKind=await askPayer($)
  else{payerKind=payerHeard.kind;if(Date.now()-payerHeard.at>60_000)void askPayer($)}
  const rateWindows=(usage?.rateLimits??[]).some(limit=>limit.kind==='five_hour'||limit.kind==='seven_day')
  const data:Pick<MoreBookData,'payer'|'place'|'columns'>={payer:morePayer(payerKind,rateWindows),...(typeof columns==='number'?{columns}:{})}
  if(drawn&&m1Runtime&&m1Runtime.payer()==='key'){
    const engine=morePageEngine($),platform=await keyPlatform(engine)
    const surfaces=await $.session.surfaces().catch(()=>['terminal'])
    const noDisplay=await keyNoDisplay(engine,platform)
    // VS Code's engine runs on this computer like the terminal's, so its key dialog opens here too (owner 10-20)
    data.place={platform,noDisplay,remote:!surfaces.some(surface=>surface==='desktop'||surface==='terminal'||surface==='vscode'),command:noDisplay?await m1Runtime.keyCommand():''}
  }
  return data
}
export async function restoreM1Book($: Engine,stillCurrent:()=>boolean=()=>true): Promise<void> {
  const initial=book
  const current=()=>stillCurrent()&&book===initial
  try {
    const panes=await $.ui.panes()
    const own=panes.find(pane=>pane.id===BOOK_PANE)
    if(!current()||!own)return
    const held=(await $.state.get({plugin:'coco',key:'book'})).value
    if(!current())return
    if(held&&PAGES.includes(held.page))book=held
    open=own.isPlaced
    if(m1Runtime){m1Runtime.open=book.more===true;m1TalkOpen=book.talk===true}
    if(!open)return
    await loadMoreWords(()=>$.fs.read(joinPath($.plugin.root,'hooks/more-text.json')))
    if(!stillCurrent())return
    const restored=book,revision=usageRevision
    try {
      const read=await $.session.usage()
      if(stillCurrent()&&book===restored&&open&&revision===usageRevision)usage=read
    } catch {}
    if(stillCurrent()&&book===restored&&open)$.ui.invalidate('ui.render')
  } catch {}
}

export async function openM1Book($: Engine, page: 'talk'|'him'|'settings',stillCurrent:()=>boolean=()=>true): Promise<void> {
  if(!stillCurrent())return
  if (m1Runtime) m1Runtime.open = false
  await openBook($, page === 'talk' ? 'him' : page,undefined,stillCurrent)
  if(!stillCurrent())return
  m1TalkOpen = page === 'talk'
  await m1BookFlags($,false,m1TalkOpen)
  if(!stillCurrent())return
  if(m1TalkOpen)await focusM1Book($,'coco:talk:open')
  if(!stillCurrent())return
  $.ui.invalidate('ui.render')
}
async function focusM1Book($:Engine,key:string):Promise<void>{if(!open)return;try{await $.ui.focus({requestId:BOOK_PANE,key})}catch{}}
async function m1BookFlags($: Engine,more:boolean,talk:boolean):Promise<void>{
  book={...book,more,talk};try{bookPublishFailed=!(await $.state.set(BOOK,book)).isSet}catch{bookPublishFailed=true}
}
function m1Frame(E: Elements[keyof Elements], w: BookWords, surface: string, content: RenderElement): RenderElement {
  const {Box,Button}=E
  return <Box flexDirection="column" rowGap={1}><Box flexDirection="row" flexWrap="wrap" {...(surface==='terminal'?{columnGap:1}:{gap:1})}>{PAGES.flatMap((page,index)=>[<Button key={`coco:book:tab:${page}`} label={surface==='terminal'?`${numberText(index+1,m1Runtime?.lang??'en')}${m1Runtime?.lang==='zh'||m1Runtime?.lang==='zh-Hant'||m1Runtime?.lang==='ja'?'':' '}${bagPageName(m1Runtime?.lang??'en',page)??w.tabs[page]??''}`:bagPageName(m1Runtime?.lang??'en',page)??w.tabs[page]??''} hotkey={String(index+1)} {...(page===book.page&&!m1TalkOpen?{variant:'primary' as const}:{})} onPress={()=>{}}/>,...(page==='him'&&m1Runtime?.isOn('talk')?[<Button key="coco:talk:open" label={moreWord('talk.tab',m1Runtime.lang)} {...(m1TalkOpen?{variant:'primary' as const}:{})} onPress={()=>{}}/>]:[])])}</Box>{content}</Box>
}
export function m1VoiceCard(E: Elements[keyof Elements],lang:string,n:number,changed:boolean):RenderElement {
  const {Box,Text,Button}=E
  return <Box flexDirection="column" borderStyle="round" borderColor="inactive" paddingX={1} rowGap={1}>{changed?<Text bold wrap="wrap">{gapWord(lang,'first.voiceChanged')}</Text>:null}<Text bold wrap="wrap">{gapWord(lang,'first.voiceAsk')}</Text><Box flexDirection="row" flexWrap="wrap" columnGap={1}><Button key="coco:set:voice:light" label={gapWord(lang,'first.voiceOn')} onPress={()=>{}}/><Text color="inactive" wrap="wrap">{gapFill(lang,'first.voiceOnNote',{n})}</Text></Box><Box flexDirection="row" flexWrap="wrap" columnGap={1}><Button key="coco:first:voice:keep" label={gapWord(lang,'first.voiceKeep')} onPress={()=>{}}/><Text color="inactive" wrap="wrap">{gapWord(lang,'first.voiceOffNote')}</Text></Box></Box>
}

const WATCH: Record<Page, readonly string[]> = {
  him: ['turns','visits'],
  omen: [],
  offerings: ['notes','budget','neighbours','quotaTrail'],
  log: ['bookmark','bookmarks','turns', 'firstMet', 'latestNight', 'wilds', 'limitLog'],
  library: [],
  settings: ['voice', 'affection', 'band', 'workSize', 'marks', 'lang', 'companionTarget', 'guard', 'bookmark', 'notes', 'budget', 'neighbours', 'bandSettings','longTask','trim','visitors','breathe'],
  socks: [],
}

// `/coco <word>` opens the book at a page; anything else goes on to the other commands.
const ALIASES: Record<string, Page> = {
  about: 'him',
  him: 'him',
  usage: 'offerings',
  log: 'log',
  library: 'library',
  settings: 'settings',
  socks: 'socks',
}

let roomModule: typeof D1Room | undefined
async function roomForHis(): Promise<typeof D1Room> { return roomModule ??= D1Room }

let bookPublishFailed = false
let book: CocoBook = { page: 'him', reading: 0, rev: 0 }
let open = false
let observedView: CocoView | undefined
let usage: SessionUsage | undefined
let usageRevision = 0
let timeZone: string | undefined
let reducedMotion = false
let costHow = false
let costWordsReady = false
let costWordsLoading: Promise<void> | undefined
let readCostBook: ((now: number) => Promise<CostSurfaceSnapshot | undefined>) | undefined
export function setCostBookReader(read: (now: number) => Promise<CostSurfaceSnapshot | undefined>): void { readCostBook = read }
// What the book's last press and draw did, for register.tsx's diagnostics rows (written only while the switch file
// is there): the book on a surface the tests cannot reach (his empty desktop pane, 10-18).
type BookReport = { [field: string]: unknown }
let bookPressReport: BookReport | undefined, bookDrawReport: BookReport | undefined
export function takeBookPressReport(): BookReport | undefined { const report = bookPressReport; bookPressReport = undefined; return report }
export function takeBookDrawReport(): BookReport | undefined { const report = bookDrawReport; bookDrawReport = undefined; return report }
// The six-second limit on an opened price page is a timer, and timers belong to register.tsx's cost layer; the book
// pages (Settings above all) hold none. register.tsx hands this seam over, bound to the press that opens the page.
let startPriceTimer: ((ms: number, fire: () => void) => () => void) | undefined
export function setPriceTimer(start: (ms: number, fire: () => void) => () => void): void { startPriceTimer = start }
async function ensureCostWords($: Engine): Promise<void> {
  if (costWordsReady) return
  await (costWordsLoading ??= (async () => {
    try { installCostWords(JSON.parse(await $.fs.read(joinPath($.plugin.root, 'hooks', 'cost-text.json')))) } catch { /* Missing approved words are never replaced with authored copy. */ }
    costWordsReady = true
  })())
}
let pricesOpen = false
let pricesGeneration = 0
let pricesController: PricesController | undefined
let drawPrices: typeof PricesPageRenderer | undefined
function forgetPrices(): void {
  pricesOpen = false; pricesGeneration++
  pricesController?.close(); pricesController = undefined; drawPrices = undefined
}
export function pricePolicyRefuses(policy: unknown, url: string): boolean {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return false
  const permissions = (policy as { permissions?: unknown }).permissions
  if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)) return false
  const deny = (permissions as { deny?: unknown }).deny
  if (!Array.isArray(deny)) return false
  const host = /^https:\/\/([^/]+)/.exec(url)?.[1]
  return deny.some(rule => typeof rule === 'string' && (rule === 'WebFetch' || rule === 'WebFetch(*)' || rule === `WebFetch(domain:${host})`))
}
// Called solely by the two Prices ui.press paths below; host policy handles other rule shapes.
async function beginPrices($: Engine): Promise<void> {
  if (!open || book.page !== 'offerings' || pricesOpen || !startPriceTimer) return
  pricesOpen = true
  const generation = ++pricesGeneration
  await ensureCostWords($)
  const [text, disabled, policy, now, model] = await Promise.all([
    $.fs.read(joinPath($.plugin.root, 'assets', 'prices.json')),
    $.env.get('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC'),
    $.settings.read({ source: 'policy' }), $.clock.now(), $.session.model().catch(() => null),
  ])
  if (!pricesOpen || generation !== pricesGeneration || !open || book.page !== 'offerings') return
  let priceNow = now
  pricesController = priceRuntime.createPricesController({
    shipped: JSON.parse(text) as ShippedPrices,
    store: { get: key => $.store.get(key), set: (key, value) => $.store.set(key, value as never) },
    chatModel: model,
    policyRefusesOthers: pricePolicyRefuses(policy, priceRuntime.OTHERS_URL),
    changed: () => { if (pricesOpen && generation === pricesGeneration) redrawSoon($) },
    deps: {
      now: () => priceNow,
      env: { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: disabled },
      policyRefuses: pricePolicyRefuses(policy, priceRuntime.PRICE_PAGE_URL),
      after: (ms, fn) => startPriceTimer!(ms, fn),
      fetchText: async url => {
        if (pricePolicyRefuses(policy, url)) throw Error('managed WebFetch denial')
        // The host reads a whole response with no size limit, so the other makers come from the few-kilobyte
        // daily list (OTHERS_URL), never LiteLLM's 3 MB table itself; load.ts refuses a list over 64 KB.
        const response = await $.http.fetch(url)
        if (!response.ok) throw Error('public price page unavailable')
        priceNow = await $.clock.now()
        return response.text
      },
    },
  })
  drawPrices = renderPricesPage
  redrawSoon($)
  void pricesController.open()
}

let redraw: Timer | undefined
const companionBook = new CompanionBook()
// Their desktop companion stands on their page once lane B has named its group there (bag step 2), else on the switches
// page; the check-up keeps reading it on the switches page either way.
function companionPage(): Page { return bagWords(latest.view?.lang ?? 'en')?.himGroups ? 'him' : 'settings' }
// The files he opens most and the seven short reads move to the zine page with the sticky notes page's groups (step 2).
function readingsPage(): Page { const bag = bagWords(latest.view?.lang ?? 'en'); return bag?.noteGroups && bag.zineGroups ? 'log' : 'library' }
const iconBook = new IconBook()
const iconSession = new IconSession()
// Session work survives book close/page changes and never consumes a pending UI status.
let automaticIcon = new IconBook()
let iconCheck: Promise<void> | undefined
let iconMeasuredGeneration = -1
// Native mutations finish in press order, including a clear while a person applies.
let iconMutation = Promise.resolve()
let iconMarker = Promise.resolve()
let iconPress = 0
let iconWriter: ((engine: Engine, values: Record<string, string | boolean>) => Promise<void>) | undefined
export function setIconSettingsWriter(write: typeof iconWriter): void { iconWriter = write }
export function resetIconSession(): void {
  iconSession.reset()
  iconCheck = undefined; iconMeasuredGeneration = -1
  const platform = automaticIcon.platform
  automaticIcon = new IconBook(); automaticIcon.platform = platform
  iconBook.forget()
}
export function iconFirstDraw($: Engine): void {
  if (iconSession.drawn || iconSession.queued) return
  iconSession.queued = true
  // The microtask cannot run until the synchronous host render has returned its tree.
  const generation = iconSession.generation
  void Promise.resolve().then(() => { if (generation !== iconSession.generation) return; iconSession.queued = false; iconSession.drawn = true; return iconAutomatic($) }).catch(() => {})
}
export function iconSettingsHydrated($: Engine): void { if (iconSession.drawn) void iconAutomatic($).catch(() => {}) }
async function saveIconSettings($: Engine, values: Record<string, string | boolean>): Promise<void> {
  if (iconWriter) await iconWriter(bookEngine($), values)
  else { latest.settings = { ...latest.settings, ...values }; await $.store.set('bandSettings', latest.settings as never) }
}
async function writeIconConsent($: Engine, path: string, value: string): Promise<void> {
  const previous = iconMarker
  let release!: () => void
  iconMarker = new Promise<void>(resolve => { release = resolve })
  await previous
  try { await $.fs.write(path, value) } finally { release() }
}
export async function iconWord($: Engine, slot: string): Promise<string> {
  const w = await wordsFor($, latest.view?.lang ?? 'en')
  return w.settings.icon[slot] ?? w.settings.icon.S8
}
export async function iconCommand($: Engine, action: 'apply' | 'clear' | 'status', say: (text: string) => void | Promise<void>): Promise<void> {
  if ((action === 'apply' || action === 'status') && latest.settings.appIcon !== 'on') { await say(await iconWord($, 'S9')); return }
  if (action !== 'status') iconPress++
  const press = iconPress
  if (action === 'apply') {
    iconSession.explicitApply()
    const text = await iconWord($, 'S10')
    if (press !== iconPress) return
    await say(text)
    if (press !== iconPress) return
    await saveIconSettings($, { appIconBlocked: false })
  }
  if (action === 'clear') await saveIconSettings($, { appIcon: 'off', appIconBlocked: false }).catch(() => {})
  if (action !== 'status' && press !== iconPress) return
  await runIcon($, iconBook, action, () => redrawSoon($))
  if (iconBook.busy) return
  if (action === 'status' && await iconBook.platform === 'linux') {
    iconBook.visible = true
    await saveIconSettings($, { iconLauncherFound: !iconBook.failed && !iconBook.unavailable && iconBook.state !== 'unknown' })
  }
  if (!iconBook.failed && iconBook.state === 'own') {
    await say(await iconWord($, 'S4'))
    if (action === 'apply' && iconBook.mac && iconBook.changed) await say(await iconWord($, 'dockRedraw'))
  } else if (!iconBook.failed && iconBook.state === 'stock') await say(await iconWord($, 'S1a'))
  else if (!iconBook.failed && iconBook.state === 'legacy') await say(await iconWord($, 'S11'))
}
// This observer only reads, once after first draw. All native writes begin in runIcon presses.
export async function iconAutomatic($: Engine): Promise<void> {
  if (!iconSession.claim(latest.settings)) { if (latest.settings.appIcon === 'on') await iconCheck; return }
  const generation = iconSession.generation, press = iconPress, c = automaticIcon
  const checking = (async () => {
    await runIcon($, c, 'status', () => redrawSoon($))
    if (generation !== iconSession.generation || latest.settings.appIcon !== 'on') return
    iconMeasuredGeneration = generation
    if (!iconBook.busy) copyIconMeasurement(c, iconBook)
    redrawSoon($)
    if (await c.platform === 'linux') await saveIconSettings($, { iconLauncherFound: !c.failed && !c.unavailable }).catch(() => {})
    if (generation !== iconSession.generation || press !== iconPress || latest.settings.appIcon !== 'on' || c.failed || c.state !== 'stock' || !c.restoreKey || latest.settings.appIconRestoreNotice === c.restoreKey) return
    // Without durable acknowledgement, fail closed: no toast and no fallback file.
    try { await saveIconSettings($, { appIconRestoreNotice: c.restoreKey }) } catch { return }
    if (press !== iconPress || latest.settings.appIcon !== 'on' || latest.settings.appIconRestoreNotice !== c.restoreKey) return
    try {
      const text = await iconWord($, 'S20')
      if (press === iconPress && latest.settings.appIcon === 'on' && latest.settings.appIconRestoreNotice === c.restoreKey) await $.ui.toast(text)
    } catch {}
  })()
  iconCheck = checking
  await checking
}
function copyIconMeasurement(source: IconBook, target: IconBook): void {
  target.state = source.state; target.restoreKey = source.restoreKey
  target.failed = source.failed; target.unavailable = source.unavailable
}
// Held only while the book is open (forget() empties them when it closes): their portraits, and the words,
// English and the one other language he reads in.
const portraits = new Map<string, string>()
const words = new Map<string, BookWords>()
let bookGeneration = 0
let weekWant: boolean | number | undefined // last week (true), this week (false) or an issue's number
let weekShown: 'this' | 'last' | 'back' = 'this'
const zineCovers = new Map<number, string>() // the zine's covers read so far, by cover number
let weekSave: CardSaveResult | 'saving' | undefined
let weekDestination: CardDestination | undefined
let vibeSave: CardSaveResult | 'saving' | undefined // the vibe check share card's last save while its page stays open
// Coco peeking into the bag's picture, read once a session, in each outfit (null: it could not be read; in B the A drawing
// stands in when the B one cannot be read). Lane A's B drawing, his 10-17 card.
let bagPeek: { A: BagPeek | null; B: BagPeek | null } | undefined
// The same peeks in the MV style's flat colours (lane A's bag-peek-mv.png and bag-peek-b-mv.png), read once it is chosen.
let bagPeekMv: { A: BagPeek | null; B: BagPeek | null } | undefined
const bagStyleMv = (): boolean => latest.settings.bagStyle === 'mv'
async function readPeek($: Engine, name: string): Promise<BagPeek | null> {
  try {
    const base64 = (await $.fs.read(joinPath($.plugin.root, 'assets', 'coco', name), { as: 'bytes' })).base64, size = vibePngSize(base64)
    // only the drawing itself (a stand-in picture, as the tests and the web demo read, leaves the bag alone)
    return size && size.height >= 100 ? { base64, ...size } : null
  } catch { return null }
}
async function loadBagPeek($: Engine): Promise<void> {
  if (bagPeek !== undefined) return
  const A = await readPeek($, 'bag-peek.png')
  const B = A && await $.fs.exists(joinPath($.plugin.root, 'assets', 'coco', 'bag-peek-b.png')).catch(() => false) ? await readPeek($, 'bag-peek-b.png') : null
  bagPeek = { A, B: B ? { ...B, outfit: 'B' } : A }
}
async function loadBagPeekMv($: Engine): Promise<void> {
  if (bagPeekMv !== undefined) return
  const A = await readPeek($, 'bag-peek-mv.png'), B = A ? await readPeek($, 'bag-peek-b-mv.png') : null
  bagPeekMv = { A, B: B ?? A }
}
const peekFor = (): BagPeek | undefined => { const peeks = bagStyleMv() ? bagPeekMv : bagPeek; return (latest.view?.outfit === 'B' ? peeks?.B : peeks?.A) ?? undefined }
const copiedChecks = new Set<string>()
const checkWorking = new Map<string, string>()
// Optional check-up IO never holds the first Settings frame. One request per open-page
// generation; redraws consume its cache instead of launching another read.
let checkHome: string | undefined
let checkPlatform: 'darwin' | 'win32' | 'linux' | undefined
let checkCompanion: { installed: boolean; companion: CheckCompanion; health: CheckHealth } | undefined
let checkCompanionVersion: string | undefined
let checkSessionRows: CheckSession[] = []
let checkSessionGeneration = -1
let checkCompanionGeneration = ''
let checkSessionRequest = 0
let checkCompanionRequest = 0
function forgetChecks(): void {
  checkHome = undefined; checkPlatform = undefined; checkCompanion = undefined; checkCompanionVersion = undefined
  checkSessionRows = []; checkSessionGeneration = -1; checkCompanionGeneration = ''
  checkSessionRequest++; checkCompanionRequest++
  windowRows = []; windowGeneration = -1; windowRequest++
}
// Their windows on the first page (E1-2): every open session, read once each time the page opens, the way the check-up
// reads them; nothing is read while the page is shut.
let windowRows: BookWindow[] = []
let windowGeneration = -1
let windowRequest = 0
function refreshWindows($: Engine): void {
  if (book.page !== companionPage() || windowGeneration === bookGeneration) return
  const generation = windowGeneration = bookGeneration, request = ++windowRequest
  void checkSessions().then(rows => {
    if (generation !== bookGeneration || request !== windowRequest || book.page !== companionPage()) return
    windowRows = rows as BookWindow[]
    redrawSoon($)
  }).catch(() => {})
}

let checkSessions: () => Promise<CheckSession[]> = async () => []
export function setCheckSessionsReader(read: () => Promise<CheckSession[]>): void { checkSessions = read }
// Off macOS `/coco companion` runs the pet's own program (pet-program.ts; lane C, 10-16); register.tsx knows its path.
let petProgramPath: () => Promise<string | undefined> = async () => undefined
export function setPetProgramReader(read: () => Promise<string | undefined>): void { petProgramPath = read }

export function bookMeasured($: Engine, e: SessionMeasureInput): void {
  if (!open || usage === undefined) return
  usageRevision++
  const updated = { ...usage, context: e.context, rateLimits: e.rateLimits, cost: e.cost }
  const moved = !sameUsage(usage, updated)
  usage = updated
  if (moved && (book.page === 'offerings' || book.page === 'settings')) redrawSoon($)
}

export function bookSettingsChanged($: Engine): void {
  if (open && book.page === 'settings') refreshChecks($, true)
  if (open && (book.page === 'settings' || book.page === 'offerings' || book.page === 'him' || book.page === 'socks')) redrawSoon($)
}

// The stick shows on the first page and the limit's record on the log.
export function bookPlayChanged($: Engine): void {
  if (open && (book.page === 'him' || book.page === 'log')) redrawSoon($)
}

function forget(): void {
  forgetPrices(); costHow = false
  portraits.clear()
  words.clear()
  weekWant = undefined; weekSave = undefined; weekDestination = undefined; vibeSave = undefined; zineCovers.clear()
  copiedChecks.clear(); checkWorking.clear(); bookGeneration++; forgetChecks()
  forgetBookArt()
  usageRevision++
  forgetWeekWords()
  roomModule?.forgetRoom()
  usage = undefined
  companionBook.forget()
  iconBook.forget()
}

function ownWords(lang: string): (typeof WORDS)['en'] {
  return WORDS[lang as Lang] ?? WORDS.en
}

function sameUsage(a: SessionUsage | undefined, b: SessionUsage): boolean {
  if (!a?.context || !b.context) return false
  const limits = (u: SessionUsage) => u.rateLimits.map(l => `${l.kind}:${l.percentUsed}:${l.resetsAt ?? ''}`).join('|')
  return (
    a.context.tokens === b.context.tokens &&
    a.context.window === b.context.window &&
    a.context.breakdown?.totalTokens === b.context.breakdown?.totalTokens &&
    a.cost?.usd === b.cost?.usd &&
    a.startedAt === b.startedAt &&
    limits(a) === limits(b)
  )
}

function clockOf(now: number): { hour: number; minute: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: 'numeric', hourCycle: 'h23', timeZone }).formatToParts(new Date(now))
    const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? 0)
    return { hour: get('hour') % 24, minute: get('minute') }
  } catch {
    const d = new Date(now)
    return { hour: d.getHours(), minute: d.getMinutes() }
  }
}

// ---------------------------------------------------------------- what it does

// The book's words in his language, laid over English's so a missing word shows in English.
// Read from the plugin's own files the first time the book opens in that language.
async function wordsFor($: Engine, lang: string): Promise<BookWords> {
  await Promise.all([loadMoreWords(()=>$.fs.read(joinPath($.plugin.root,'hooks/more-text.json'))),loadBagWords(()=>$.fs.read(joinPath($.plugin.root,'hooks/bag-text.json')))])
  const held = words.get(lang)
  if (held) return held
  const read = async (code: string): Promise<unknown> => JSON.parse(await $.fs.read(joinPath($.plugin.root, 'book', `${code}.json`)))
  let en = words.get('en')
  if (!en) {
    en = await read('en') as BookWords // shipped with the plugin; the tests read every file
    words.set('en', en)
  }
  if (lang === 'en') return en
  let text: unknown
  try { text = await read(lang) } catch { text = undefined }
  const own = overEnglish(en, text)
  for (const key of words.keys()) if (key !== 'en') words.delete(key)
  words.set(lang, own)
  return own
}

// Each itabag page's portrait (book-portrait.ts), kept while the book is open; one made before their band data has the
// page's pose is not kept, so the next drawing picks it up.
function portraitOf(page: Page, height: number, outfit: CocoOutfit): { source: string; width: number } {
  const key = `${outfit}:${page}:${height}:${cocoSocksWorn(outfit) ?? ''}`
  const held = portraits.get(key)
  if (held !== undefined) return { source: held, width: cocoWidth(height) }
  const made = bookPortrait(page, height, outfit)
  if (made.source && cocoHas(outfit, PORTRAIT_POSES[page])) portraits.set(key, made.source)
  return made
}

async function show($: Engine, page: Page, reading = book.reading,stillCurrent:()=>boolean=()=>true): Promise<void> {
  if(!stillCurrent())return
  forgetPrices()
  if (page !== 'offerings') costHow = false
  if (page === 'offerings' || page === 'settings') await ensureCostWords($)
  if(!stillCurrent())return
  if (m1Runtime) { m1Runtime.open = false; m1Runtime.talkHidden() }
  m1TalkOpen = false
  if (page !== 'him') roomModule?.forgetRoom()
  if (page !== 'settings' && page !== companionPage()) companionBook.forget()
  if (page !== 'settings') { iconBook.forget(); copiedChecks.clear(); checkWorking.clear(); forgetChecks() }
  if (page !== 'log') weekSave = undefined
  if (page !== 'omen') vibeSave = undefined
  bookGeneration++
  book = { page, reading, rev: book.rev + 1, languages: page === 'settings' && book.languages === true, ...(page === 'him' && book.visitors !== undefined ? { visitors: book.visitors } : {}) }
  try { bookPublishFailed = !(await $.state.set(BOOK, book)).isSet } catch { bookPublishFailed = true }
  if(!stillCurrent())return
  if (bookPublishFailed) $.ui.invalidate('ui.render')
  if (page === 'settings') refreshChecks($)
}

// One redraw of the open book just after whatever moved: never from inside a drawing (which may
// not write state), and any number of moves in one beat fold into one.
function redrawSoon($: Engine): void {
  if (open) $.ui.invalidate('ui.render')
}

// Settings acknowledgements arrive with the companion's event-driven request stream. The
// current book consumes the payload, so a reaction never waits for another file read.
let companionEvent: CompanionSnapshot | undefined
let companionStatusRevision = 0
function withCapabilities(snapshot: CompanionSnapshot, c: CompanionBook): CompanionSnapshot {
  return { ...snapshot, info: { ...snapshot.info, targets: c.targets } }
}
export function companionChanged(info: CompanionInfo): void {
  companionStatusRevision += 1
  checkCompanion = undefined // A native acknowledgement supersedes earlier file receipts.
  companionEvent = { folder: true, app: true, login: info.login === true, info }
  companionBook.macReady = true
  companionBook.mac = Promise.resolve(true)
  companionBook.snapshot = withCapabilities(companionEvent, companionBook)
  companionBook.busy.clear()
  companionBook.unanswered = false
}


function refreshChecks($: Engine, force = false): void {
  if (book.page !== 'settings') return
  if (force) { checkSessionGeneration = -1; checkCompanionGeneration = '' }
  const generation = bookGeneration
  const current = () => generation === bookGeneration && book.page === 'settings'
  // Presence locks and companion probes are independent; a held optional probe must
  // not prevent a fast live-session reading from reaching the opening frame.
  if (checkSessionGeneration !== generation) {
    checkSessionGeneration = generation
    const request = ++checkSessionRequest
    void checkSessions().then(rows => {
      if (!current() || request !== checkSessionRequest) return
      checkSessionRows = rows
      redrawSoon($)
    }).catch(() => {})
  }
  const companionGeneration = companionBook.generation
  const key = `${generation}:${companionGeneration}`
  if (checkCompanionGeneration === key) return
  checkCompanionGeneration = key
  const request = ++checkCompanionRequest
  const revision = companionStatusRevision
  warmCompanion($, companionBook, () => redrawSoon($))
  void (async () => {
    const [home, win] = await Promise.all([homeOf($), windows($)])
    if (!current() || request !== checkCompanionRequest || companionGeneration !== companionBook.generation) return
    checkHome = home
    if (win) checkPlatform = 'win32'
    await companionBook.warming
    if (!current() || request !== checkCompanionRequest || companionGeneration !== companionBook.generation) return
    checkPlatform = companionBook.macReady === true ? 'darwin' : win ? 'win32' : 'linux'
    // Native state is the authoritative fresh snapshot. Do not probe or read files
    // again when its request stream has already supplied this generation's answer.
    if (companionEvent || revision !== companionStatusRevision) { redrawSoon($); return }
    const snapshot = companionBook.snapshot
    const found: { installed: boolean; companion: CheckCompanion; health: CheckHealth } = home && snapshot && companionBook.macReady === true
      ? await readCheckCompanion(bookEngine($), joinPath(home, COMPANION_DIR), snapshot.folder && snapshot.app)
      : { installed: false, companion: {}, health: {} }
    if (!current() || request !== checkCompanionRequest || companionGeneration !== companionBook.generation || revision !== companionStatusRevision) return
    checkCompanion = found
    checkCompanionVersion = found.companion.version ?? found.health.version ?? snapshot?.info.version
    redrawSoon($)
  })().catch(() => {})
}


// Whether the bag open now was opened in the terminal (their sock drawer's reddot pair, owner 10-15).
// register.tsx reads it after the press or command that opened the bag.
let openInTerminal = false
export function bagOpenInTerminal(): boolean { return open && openInTerminal }
// The desktop band's quota things open the bag on its quota page (DECISIONS 1017).
export async function openQuotaPage($: Engine): Promise<void> { await openBook($, 'offerings', 'desktop') }

// Always at the person's asking (a command or a press), so it asks for the keyboard: the tabs'
// keys 1 to 6 work at once. The engine refuses the focus over text in the composer, rightly.
async function openBook($: Engine, page: Page, surface?: 'terminal' | 'desktop' | 'vscode' | 'mobile',stillCurrent:()=>boolean=()=>true): Promise<void> {
  if(!stillCurrent())return
  await show($, page,book.reading,stillCurrent)
  if(!stillCurrent())return // request the event's redraw before detached optional status can start
  const revision = usageRevision
  try {
    const read = await $.session.usage()
    if (revision === usageRevision) usage = read
  } catch {
    // the page says there is no reading yet
  }
  if(!stillCurrent())return
  const surfaces: readonly string[] = surface ? [surface] : await $.session.surfaces().catch(() => [])
  if(!stillCurrent())return
  const rows = surfaces.includes('desktop') || surfaces.includes('terminal') ? undefined : surfaces.includes('vscode') ? 24 : surfaces.includes('mobile') ? 18 : undefined
  const opened = await $.ui.open({ id: BOOK_PANE, title: bagWords(latest.view?.lang ?? 'en')?.title ?? WORDS[latest.view?.lang ?? 'en'].name, closeOnEscape: true, focus: true, ...(rows === undefined ? {} : { rows }) })
  if(!stillCurrent())return
  open = opened.isPlaced
  openInTerminal = open && surfaces.includes('terminal')
  await focusBook(open,page,key=>$.ui.focus({requestId:BOOK_PANE,key}))
  if(!stillCurrent())return
  if (open && page === 'settings' && (surfaces.includes('terminal') || surfaces.includes('desktop'))) void openIconSettings($, iconBook, () => redrawSoon($)).catch(() => {})
}

// /coco vibe opens their vibe check page, which took the day's omen's place (owner 10-15); /omen is gone (10-16).
export async function openVibeCheck($: Engine): Promise<void> {
  await openBook($, 'omen')
}

async function countUp($: Engine, key: string): Promise<void> {
  await $.store.set(key, Number((await $.store.get(key)) ?? 0) + 1)
}

// At the end of each turn: the first page if none is noted yet, and the latest night (the latest
// time after midnight and before five that a turn finished).
async function turnFinished($: Engine): Promise<void> {
  const now = await $.clock.now()
  if ((await $.store.get('firstMet')) === undefined) await $.store.set('firstMet', now)
  const settings = await $.settings.read()
  timeZone = typeof settings.timeZone === 'string' ? settings.timeZone : undefined
  const { hour, minute } = clockOf(now)
  if (hour >= 5) return
  const minutes = hour * 60 + minute
  const held = (await $.store.get('latestNight')) as { at: number; minutes: number } | undefined
  if (!held || minutes > held.minutes) await $.store.set('latestNight', { at: now, minutes })
}

// His marks on the engine's rows (transcript.tsx), all behind this one setting.
async function setMarks($: Engine, marks: Marks): Promise<void> {
  latest.marks = marks
  $.ui.invalidate('ui.render')
  try { await $.store.set('marks', marks) } catch { /* the applied choice remains visible */ }
  $.ui.invalidate('ui.render') // the transcript's rows draw again, once
}

export type C3BookSnapshot = Pick<BookData, 'pace' | 'bookmark' | 'neighbours' | 'vibe'>
let c3Snapshot: C3BookSnapshot = {}
export function setC3BookSnapshot(snapshot: C3BookSnapshot): void { c3Snapshot = snapshot }
let d1Snapshot: D1Snapshot | undefined
let d1Asleep=false,d1Running=false,d1NotificationDenied=false
export function setD1BookSnapshot(snapshot:D1Snapshot,asleep=false,running=false,$?:Engine):void {
  const roomChanged=d1Asleep!==asleep || d1Running!==running
  const boardChanged=JSON.stringify(d1Snapshot?.helpers.map(h=>[h.agentId,h.state,h.endedAt,h.engineTotals]))!==JSON.stringify(snapshot.helpers.map(h=>[h.agentId,h.state,h.endedAt,h.engineTotals])) || d1Snapshot?.earlier.count!==snapshot.earlier.count
  d1Snapshot=snapshot;d1Asleep=asleep;d1Running=running
  if($ && open && ((book.page==='him' && roomChanged)||(book.page==='offerings' && boardChanged)))redrawSoon($)
}
// Today's visitor, for the room, set by the band when the shared record moves.
let visitToday: Visit | undefined
export function setVisitBookSnapshot(visit: Visit | undefined, $?: Engine): void {
  const moved = visitToday?.id !== visit?.id
  visitToday = visit
  if ($ && moved && open && book.page === 'him') redrawSoon($)
}
export function setD1BookNotificationDenied(denied:boolean,$?:Engine):void {const moved=d1NotificationDenied!==denied;d1NotificationDenied=denied;if($ && moved && open && book.page==='settings')redrawSoon($)}

async function dataFor($: Engine, held: CocoBook, view: CocoView | undefined): Promise<BookData> {
  const lang = view?.lang ?? 'en'
  const now = await $.clock.now()
  const store: Record<string, unknown> = {}
  if(held.page==='settings') {
    Object.assign(store,latest.settings)
    if(view)Object.assign(store,{band:view.band,voice:view.voice,affection:view.affection,workSize:view.workSize,companionTarget:view.companionTarget})
    store.marks=latest.marks??MARKS_DEFAULT
  } else for (const key of WATCH[held.page]) store[key] = await $.store.get(key)
  for (const key of ['notes','bookmark','budget','neighbours','stickEnd']) if (latest.settings[key] !== undefined) store[key] = latest.settings[key]
  const notice = currentNotice(), spark = held.page === 'log' ? notice?.lastSpark() : undefined
  // Their sock drawer's pair is a shared setting (register.tsx chooseReminder), so the other windows and the companion follow.
  const worn = held.page === 'socks' ? sockPair(latest.settings.socks) : undefined
  const shelf = held.page === readingsPage() && notice ? await notice.shelf() : undefined
  return {
    ...c3Snapshot,
    ...(spark ? { spark } : {}),
    ...(shelf ? { shelf } : {}),
    cost: held.page === 'offerings' || held.page === 'settings' ? (readCostBook ? await readCostBook(now) : costSnapshot()) : undefined,
    costHow,
    d1:d1Snapshot,
    // their room: a sock on the line for each pair in the drawer but their own, the thermos while the cache is kept warm
    ...(held.page==='him' && roomModule?{room:roomModule.roomState(now,timeZone,d1Asleep,d1Running,{socks:socksOpen(latest.settings).filter(pair=>pair!=='honmei'),warm:costSnapshot()?.warmEnabled===true,visitor:visitToday&&visitorsOn(latest.settings)&&visitDay(visitToday.at,timeZone)===visitDay(now,timeZone)?visitToday.kind:undefined,form:latest.settings.claudeForm})}:{}),
    d1NotificationDenied,
    cache: bookCachePercent(),
    view,
    usage,
    store,
    now,
    timeZone,
    reducedMotion,
    marks: latest.marks ?? MARKS_DEFAULT,
    m1Always: latest.settings.m1Always as BookData['m1Always'],
    diaryPage: m1Runtime?.isOn('talk') ? m1Runtime.diaryPage : undefined,
    voiceSizes: { light: VOICE.light.length, full: VOICE.full.length },
    reading: held.reading,
    own: ownWords(lang),
    ...(worn ? { socks: worn } : {}),
    ...(held.page === 'socks' ? { drawer: { mode: sockMode(latest.settings), open: socksOpen(latest.settings) } } : {}),
    ...(held.page === 'omen' ? vibeShareData(lang) : {}),
    ...(peekFor() ? { bagPeek: peekFor()! } : {}),
    switches: { ...latest.settings, ...(view ? { band: view.band, voice: view.voice, affection: view.affection, workSize: view.workSize, companionTarget: view.companionTarget } : {}), marks: latest.marks ?? MARKS_DEFAULT },
  }
}

const resolvedIconPlatforms = new WeakMap<IconBook, { generation: number; platform: 'macos' | 'linux' | undefined }>()
function resolvedIconPlatform(c: IconBook): 'macos' | 'linux' | undefined {
  const held = resolvedIconPlatforms.get(c)
  return held?.generation === c.generation ? held.platform : undefined
}
// His notes are read, and the pictures and words loaded, the first time the guest book opens in a session. The page says so
// until that is done and then draws itself once more; later openings find everything ready and never show it.
let readingNotes: Promise<void> | undefined
let readingShown = false
function readNotes($: Engine): void {
  if (readingNotes || visitorArtReady()) return
  readingNotes = (async () => {
    try { await loadVisitorData(path => $.fs.read(joinPath($.plugin.root, path))) } catch { /* the page says what it can */ }
    readingNotes = undefined
    if (readingShown) { readingShown = false; redrawSoon($) }
  })()
}

// His page: the guest book when it is open, else the button that opens it once anyone has come.
async function visitorsForBook($: Engine, held: CocoBook, data: BookData, view: CocoView | undefined, w: BookWords): Promise<void> {
  const lang = view?.lang ?? 'en'
  let visits: Visit[] | undefined
  try { visits = readVisits(await $.store.get('visits')) } catch { /* the page says it could not read */ }
  if (held.visitors !== undefined || visits?.length || data.room?.visitor) await loadVisitorData(path => $.fs.read(joinPath($.plugin.root, path))).catch(() => {})
  if (held.visitors !== undefined) data.visitors = guestBook(visits, held.visitors, lang, timeZone, data.own.name, `‹ ${bagPageName(lang, 'him') ?? w.tabs.him}`)
  else if (visits?.length && visitorHasWord(lang, 'visitors.open')) data.visitorsButton = visitorWord(lang, 'visitors.open')
}

async function iconPlatform($: Engine, c: IconBook): Promise<'macos' | 'linux' | undefined> {
  const generation = c.generation
  const platform = await (c.platform ??= (async () => {
    if (await windows($)) return undefined
    if (await $.fs.exists('/System/Library/CoreServices/SystemVersion.plist').catch(() => false)) return 'macos'
    if (await $.fs.exists('/proc/sys/kernel/ostype').catch(() => false)) return 'linux'
    return undefined
  })())
  if (generation === c.generation) resolvedIconPlatforms.set(c, { generation, platform })
  return platform
}

/** Settings uses the session measurement, never discovers an icon while consent is off. */
export async function openIconSettings($: Engine, c: IconBook, redraw: () => void): Promise<void> {
  if (c.opened === c.generation) return
  c.opened = c.generation
  const generation = c.generation
  redraw()
  const os = await iconPlatform($, c)
  if (generation !== c.generation) return
  c.mac = os === 'macos'; c.visible = os !== undefined
  if (!os) return
  if (latest.settings.appIcon === 'on') {
    await iconAutomatic($)
    if (generation !== c.generation) return
    if (!c.busy && iconMeasuredGeneration === iconSession.generation) copyIconMeasurement(automaticIcon, c)
  }
  redraw()
}

export async function runIcon($: Engine, c: IconBook, action: 'status' | IconAction, redraw: () => void): Promise<void> {
  return runIconAction($, c, action, redraw)
}
// Only a person's Linux first-enable press may discover a launcher before consent.
async function runIconAction($: Engine, c: IconBook, action: 'status' | IconAction, redraw: () => void, discover = false): Promise<void> {
  if (action === 'legacy-choose') return runIcon($, c, 'choose', redraw)
  if (action === 'legacy-clear') return runIcon($, c, 'clear', redraw)
  if (action === 'dock-on' || action === 'dock-off') { await saveIconSettings($, { dockTile: action === 'dock-on' ? 'on' : 'off' }); redraw(); return }
  if (action === 'cancel') { iconPress++; c.confirming = false; redraw(); return }
  if (isIconPick(action)) {
    const choice = iconChoice(action.slice(5))
    if (choice === iconChoice(latest.settings.appIconChoice)) return
    await saveIconSettings($, { appIconChoice: choice }); redraw()
    // While her icon is on, a new pick goes on at once; otherwise the next confirm puts it on.
    if (latest.settings.appIcon === 'on' && !c.confirming) return runIcon($, c, 'apply', redraw)
    return
  }
  if (action === 'choose') {
    if (latest.settings.appIcon === 'on') return runIcon($, c, 'apply', redraw)
    if (c.busy) return
    const generation = c.generation, press = ++iconPress
    const os = await iconPlatform($, c)
    if (generation !== c.generation || press !== iconPress) return
    if (os === 'linux') {
      c.confirming = false
      await runIconAction($, c, 'status', redraw, true)
      if (generation !== c.generation || press !== iconPress || c.failed || c.unavailable) return
    }
    c.confirming = true; redraw(); return
  }
  if (action === 'confirm') {
    if (await iconPlatform($, c) === 'linux' && !c.confirming) return
    iconPress++
    c.confirming = false
    await saveIconSettings($, { appIcon: 'on', appIconBlocked: false })
    return runIcon($, c, 'apply', redraw)
  }
  if ((action === 'apply' || (action === 'status' && !discover)) && latest.settings.appIcon !== 'on') return
  const press = action === 'apply' || action === 'clear' ? ++iconPress : iconPress
  if (action === 'apply') {
    iconSession.explicitApply()
    // A held old read belongs to its old object and cannot overwrite this press's result.
    const platform = automaticIcon.platform
    automaticIcon = new IconBook(); automaticIcon.platform = platform
    iconCheck = undefined; iconMeasuredGeneration = -1
  }
  if (action === 'clear') {
    await saveIconSettings($, { appIcon: 'off', appIconBlocked: false }).catch(() => {})
    // A press revokes the script gate even while this book's status is still held.
    try {
      const os = await iconPlatform($, c), home = await homeOf($)
      if (os && home) await writeIconConsent($, joinPath(presenceFolder(home, os === 'macos', await $.env.get('XDG_STATE_HOME')), 'app-icon-consent'), '')
    } catch {}
    if (press !== iconPress) return
  }
  if (c.busy) {
    if (action === 'status') c.pendingStatus = redraw
    if (action === 'clear') { c.pendingClear = redraw; c.pendingApply = undefined }
    if (action === 'apply') {
      const revoked = c.pendingClear !== undefined
      c.pendingClear = undefined
      // A newer consent press restores the marker revoked by a queued clear.
      if (c.busy !== 'apply' || revoked) c.pendingApply = redraw
    }
    return
  }
  const generation = c.generation
  let releaseMutation: (() => void) | undefined
  c.busy = action; c.failed = false; c.changed = false; redraw()
  try {
    const os = await iconPlatform($, c)
    if (generation !== c.generation && action !== 'clear') return
    if (discover && press !== iconPress) return
    c.mac = os === 'macos'
    if (!os) { c.unavailable = true; c.state = 'unknown'; c.failed = true; return }
    if (action !== 'status') {
      const previousMutation = iconMutation
      iconMutation = new Promise<void>(resolve => { releaseMutation = resolve })
      await previousMutation
      if (action === 'apply' && (generation !== c.generation || latest.settings.appIcon !== 'on')) return
    }
    if (action === 'apply') {
      await saveIconSettings($, { appIconBlocked: false })
      const home = await homeOf($)
      if (!home) throw new Error('icon consent home unavailable')
      if (latest.settings.appIcon !== 'on') return
      await writeIconConsent($, joinPath(presenceFolder(home, os === 'macos', await $.env.get('XDG_STATE_HOME')), 'app-icon-consent'), 'on\n')
      if (latest.settings.appIcon !== 'on') return
    }
    if (action === 'clear') {
      // Revoke again after a preceding apply's already-started marker write has finished.
      const home = await homeOf($)
      if (home) await writeIconConsent($, joinPath(presenceFolder(home, os === 'macos', await $.env.get('XDG_STATE_HOME')), 'app-icon-consent'), '')
    }
    const argv = ['/bin/sh', joinPath($.plugin.root, 'bin', `icon-${os}.sh`), action, '--report']
    if (action === 'status') argv.push('--restore-key')
    const choice = iconChoice(latest.settings.appIconChoice)
    if (action === 'apply' && choice !== 'coco') argv.push('--choice', choice)
    if (os === 'linux' && action !== 'status') argv.push('--replace-custom')
    if (action === 'clear') argv.push('--revoke-consent')
    const result = await $.process.run(argv, { timeoutMs: 30_000, env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', COCO_LANGUAGE: latest.view?.lang ?? 'en' } })
    if (generation !== c.generation) return
    c.unavailable = false
    c.state = iconReport(result.stdout)
    c.restoreKey = iconRestoreKey(result.stdout)
    c.failed = result.exitCode !== 0 || c.state === 'unknown' || (action === 'apply' && c.state !== 'own') || (action === 'clear' && c.state !== 'stock')
    c.changed = action !== 'status' && !c.failed
    if (c.changed) c.legacy = false
  } catch {
    if (generation === c.generation) { c.unavailable = true; c.state = 'unknown'; c.failed = true }
  } finally {
    if (action === 'apply' && generation === c.generation && latest.settings.appIcon === 'on') {
      await saveIconSettings($, c.failed ? { appIconBlocked: true } : { appIconBlocked: false, appIconRestoreNotice: '' }).catch(() => {})
    }
    if (action !== 'status' && generation === c.generation) {
      copyIconMeasurement(c, automaticIcon); iconMeasuredGeneration = iconSession.generation
    }
    releaseMutation?.()
    c.busy = undefined; redraw()
    const clear = c.pendingClear; c.pendingClear = undefined
    if (clear) await runIcon($, c, 'clear', clear)
    const apply = c.pendingApply; c.pendingApply = undefined
    if (apply) await runIcon($, c, 'apply', apply)
    const pending = c.pendingStatus; c.pendingStatus = undefined
    if (pending) await runIcon($, c, 'status', pending)
  }
}

export async function companionIsMac($: Engine, c: CompanionBook): Promise<boolean> {
  return c.mac ??= (async () => {
    if (await windows($)) return false
    return $.fs.exists('/System/Library/CoreServices/SystemVersion.plist').catch(() => false)
  })()
}

export async function companionSnapshot($: Engine, c: CompanionBook): Promise<CompanionSnapshot> {
  const generation = c.generation, revision = companionStatusRevision
  const home = await homeOf($)
  const version = PLUGIN_VERSION
  if (!home) {
    const snapshot = { folder: false, app: false, login: false, info: {}, version }
    if (generation === c.generation) { c.targets = undefined; c.capabilityGeneration = generation }
    if (generation === c.generation && revision === companionStatusRevision) c.snapshot = snapshot
    return snapshot
  }
  // Off macOS the pet keeps its settings in the system's usual place (petDataFolder), installs itself in its own
  // folder, and keeps whether it starts at login in its record.
  const pet = c.pet
  const dir = pet ? await petDataFolder($, home, pet.windows) : joinPath(home, COMPANION_DIR)
  const folder = await $.fs.exists(dir).catch(() => false)
  const app = await $.fs.exists(pet ? await petAppFolder($, home, pet.windows) : joinPath(home, COMPANION_APP)).catch(() => false)
  let login = pet ? false : await $.fs.exists(joinPath(home, COMPANION_PLIST)).catch(() => false)
  let info: CompanionInfo = {}
  if (folder) {
    try {
      const text = await $.fs.read(joinPath(dir, 'companion.json'))
      const raw: unknown = text.length <= 2048 ? JSON.parse(text) : undefined
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const r = raw as Record<string, unknown>
        // Missing and wrong-shaped fields remain missing, never truthy by accident.
        for (const key of ['running', 'accessibility', 'capture'] as const) if (typeof r[key] === 'boolean') info[key] = r[key]
        for (const key of ['answered', 'sizeAt', 'loginAt', 'followAt', 'captureAt'] as const) if (typeof r[key] === 'number' && Number.isFinite(r[key])) info[key] = r[key]
        // This existing Store key is seconds since 1970; request/answer stamps are ms.
        if (typeof r.hiddenUntil === 'number' && Number.isFinite(r.hiddenUntil * 1000) && Math.abs(r.hiddenUntil * 1000) <= 8.64e15) info.hiddenUntil = r.hiddenUntil * 1000
        if (Array.isArray(r.targets) && r.targets.every(target => target === 'claude' || target === 'vscode')) info.targets = [...new Set(r.targets)] as ('claude' | 'vscode')[]
        if (typeof r.version === 'string') info.version = r.version
        if (r.longTaskAuthorization === 'authorized' || r.longTaskAuthorization === 'denied' || r.longTaskAuthorization === 'notDetermined') info.longTaskAuthorization = r.longTaskAuthorization
        if (COMPANION_SIZES.includes(r.size as CompanionSize)) info.size = r.size as CompanionSize
        if (pet && typeof r.login === 'boolean') login = r.login
      }
    } catch { /* a half-written or older record has no assumed fields */ }
  }
  const snapshot = { folder, app, login, info, version }
  if (generation === c.generation) { c.targets = info.targets; c.capabilityGeneration = generation }
  if (generation === c.generation) c.snapshot = companionEvent ? withCapabilities(companionEvent, c) : revision === companionStatusRevision ? snapshot : c.snapshot
  return snapshot
}

// Optional status warms once per generation, separately from the first Settings drawing.
export function warmCompanion($: Engine, c: CompanionBook, changed: () => void): void {
  if (companionEvent) { c.macReady = true; c.mac = Promise.resolve(true); c.snapshot = withCapabilities(companionEvent, c) }
  if ((c.macReady === false && !c.pet) || c.capabilityGeneration === c.generation || c.warmGeneration === c.generation) return
  const generation = c.generation, revision = companionStatusRevision, previousTargets = c.targets
  c.warmGeneration = generation
  c.warming = (async () => {
    const mac = await companionIsMac($, c)
    if (generation !== c.generation) return
    c.macReady = mac
    if (!mac && !c.pet) {
      const program = await petProgramPath()
      if (program) c.pet = { program, windows: /\.exe$/i.test(program) }
    }
    if (mac || c.pet) await companionSnapshot($, c)
    if (generation === c.generation && (revision === companionStatusRevision || JSON.stringify(previousTargets) !== JSON.stringify(c.targets))) changed()
  })().catch(() => { /* unknown stays unknown; an optional probe never blocks drawing */ })
}

export async function companionData($: Engine, c: CompanionBook, desktop: boolean, now: number): Promise<CompanionBookData> {
  const s = companionEvent ? { ...withCapabilities(companionEvent, c), version: PLUGIN_VERSION } : await companionSnapshot($, c)
  return companionDataFromSnapshot(c, s, desktop, now)
}

export function companionDataFromSnapshot(c: CompanionBook, s: CompanionSnapshot, desktop: boolean, now: number, target: 'auto' | 'claude' | 'vscode' = 'auto', automaticApp: 'Claude' | 'VS Code' = 'Claude'): CompanionBookData {
  const generation = c.generation
  if ((s.info.answered ?? 0) >= c.summonAt) c.unanswered = false
  const state = companionState(s, now, { busy: c.progress, issue: c.issue, unanswered: c.unanswered, followed: c.followed })
  const notRun = c.notRun
  c.notRun = false // exactly one drawing after a permission refusal
  const app = s.info.targets?.includes('vscode') ? target === 'auto' ? automaticApp : target === 'vscode' ? 'VS Code' : 'Claude' : 'Claude'
  const data: CompanionBookData = { ...s, target, targetApp: app, state, asks: c.processFailed, cannot: c.cannot, notRun, confirmed: c.confirmed, afterTools: c.afterTools, removed: c.removed, message: c.message }
  if (desktop && generation === c.generation) {
    const stage: CompanionStage = state === 'waiting' ? 'corner' : ['stopped', 'hidden', 'corner', 'following'].includes(state) ? state as CompanionStage : 'absent'
    // Coco Pet draws them hand-drawn at every size, so the diagram and the sizes show their still in what they wear now;
    // a picture made before their band data is read is not kept
    const outfit: CocoOutfit = latest.view?.outfit === 'B' ? 'B' : 'A', pose = STAGE_POSE[stage]
    let stagePicture = c.stage
    if (stagePicture?.state !== stage || stagePicture?.app !== app || stagePicture?.outfit !== outfit) {
      stagePicture = { state: stage, app, outfit, source: bookCompanionStageSvg(stage, pose ? cocoStill(outfit, pose, STAGE_HEIGHT) : '', app) }
      if (!pose || cocoHas(outfit, pose)) c.stage = stagePicture
    }
    data.stage = { source: stagePicture.source, altState: stage }
    if (['hidden', 'waiting', 'corner', 'following'].includes(state)) {
      if (!c.figures || c.figuresOutfit !== outfit) {
        const figures = Object.fromEntries(COMPANION_SIZES.map(size => [size, companionSizeSvg(size, height => ({ source: cocoStill(outfit, 'idle', height), width: cocoWidth(height) }))]))
        if (!cocoHas(outfit, 'idle')) { data.figures = figures; return data }
        c.figures = figures; c.figuresOutfit = outfit
      }
      data.figures = c.figures
    }
  }
  return data
}

// Auto mode's classifier refuses a call it was not asked for by the model, so a person's own command or
// press would never run there; it runs directly instead (owner 10-20). Other modes keep the permission dialog,
// and a refusal the person clicked stands. plainPath runs it under the plain PATH, as the Bash command does
// (Windows has no /usr/bin/env to do it outside Git Bash).
const AUTO_MODE_REFUSAL = /\bauto mode\b/i
export async function ownCall($: Engine, argv: readonly string[], plainPath: boolean, description: string, timeout = 30_000, windows = false): Promise<CompanionRun> {
  const quoted = plainPath ? companionCommand(argv) : argv.map(arg => `'${arg.replace(/'/g, `'"'"'`)}'`).join(' ')
  const r = await $.tool.call({ tool: 'Bash', command: quoted, description, timeout })
  if ('deny' in r) {
    if (!AUTO_MODE_REFUSAL.test(r.deny)) return { kind: 'denied' }
    const run = await $.process.run(plainPath && !windows ? ['/usr/bin/env', 'PATH=/usr/bin:/bin:/usr/sbin:/sbin', ...argv] : argv, { timeoutMs: timeout })
    return { kind: 'ran', stdout: run.stdout, stderr: run.stderr, exitCode: run.exitCode }
  }
  const result = r.result as { stdout?: string; stderr?: string; interrupted?: boolean; exitCode?: number }
  return { kind: 'ran', stdout: typeof result?.stdout === 'string' ? result.stdout : (r.text ?? ''), stderr: typeof result?.stderr === 'string' ? result.stderr : '', exitCode: r.isError || result?.interrupted ? 1 : (typeof result?.exitCode === 'number' ? result.exitCode : 0) }
}

export async function companionRun($: Engine, c: CompanionBook, argv: readonly string[], description: string, timeout = 30_000): Promise<CompanionRun> {
  c.cannot = false
  c.processFailed = true // Every program action asks through the engine's permission dialog first.
  try {
    const r = await ownCall($, argv, true, description, timeout, c.pet?.windows === true)
    if (r.kind === 'denied') c.notRun = true
    return r
  } catch { c.cannot = true; return { kind: 'cannot' } }
}

export async function writeCompanionRequest($: Engine, c: CompanionBook, view: CocoView, request: CompanionRequest): Promise<boolean> {
  try {
    if (!c.pet && await windows($)) return false
    const home = await homeOf($)
    if (!home) return false
    const folder = c.pet ? await petDataFolder($, home, c.pet.windows) : joinPath(home, COMPANION_DIR)
    if (!(await $.fs.exists(folder))) return false
    const now = await $.clock.now(), session = await $.session.id(), desktop = (await $.session.surfaces()).includes('desktop')
    if (!(await $.fs.exists(folder))) return false
    // Off macOS the request rides the pet's feed, written by its own program (as register.tsx feeds it).
    if (c.pet) return (await $.process.run(petWriteArgv(c.pet.program, folder, 'view.json'), { stdin: companionRequestText(view, session, desktop, now, request), timeoutMs: 2000 })).exitCode === 0
    const written = await $.process.run(['/bin/sh', '-c', ATOMIC_WRITE, 'coco', folder, 'view.json', joinPath($.plugin.root, 'bin/companion-control'), joinPath($.plugin.root, 'bin/presence.sh')], { stdin: companionRequestText(view, session, desktop, now, request), timeoutMs: 2000 })
    return written.exitCode === 0
  } catch { return false }
}

export async function pressCompanion($: Engine, c: CompanionBook, action: CompanionAction, view: CocoView, redraw: () => void, active: () => boolean): Promise<void> {
  if (!c.pet && await windows($)) return
  const group = ['install', 'retry', 'updateButton'].includes(action) ? 'install' : action
  if (c.busy.has(group) || c.progress) return
  if (action === 'remove' || action === 'keep') { c.confirmed = action === 'remove'; redraw(); return }
  companionEvent = undefined
  c.stop() // a new press owns the one chain and any delayed summon
  c.busy.add(group)
  if (group === 'install' || action === 'trash') c.progress = group as 'install' | 'trash'
  redraw() // the press is visible before optional status validation or program/file work
  let goal = (_s: CompanionSnapshot) => true
  try {
    const initial = await companionSnapshot($, c)
    // Install is the only action that may create an absent companion. Other presses cannot
    // resurrect his deleted folder, including a press on a stale rendered control.
    if (!['install', 'toolsButton', 'oldToolsButton'].includes(group) && (!initial.folder || !initial.app)) return
    if (action === 'trash' && !c.confirmed) return
    const now = await $.clock.now()
    const at = Math.max(Math.round(now), c.lastAt + 1); c.lastAt = at
    if (group === 'install' || action === 'trash') {
      const verb = group === 'install' ? 'install' : 'uninstall'
      const r = await companionRun($, c, c.pet ? [c.pet.program, verb] : ['/bin/sh', joinPath($.plugin.root, 'bin/companion-macos.sh'), verb, '--report'], group === 'install' ? 'Install Coco Pet' : 'Move Coco Pet to the Trash', 600_000)
      if (r.kind === 'ran') {
        const lines = r.stdout.trim().split(/\r?\n/)
        // The pet's own program (setup.rs) answers by its exit code alone.
        const report = c.pet ? r.exitCode === 0 ? 'ok' : 'failed' : /^result: (ok|no-tools|old-tools|failed|not-mac)$/.exec(lines[lines.length - 1] ?? '')?.[1]
        if (report === 'ok' && r.exitCode === 0) {
          c.issue = undefined; c.afterTools = false
          c.snapshot = undefined; c.warmGeneration = -1
          if (action === 'trash') { c.removed = true; c.confirmed = false; goal = s => !s.folder || !s.app }
          else { c.removed = false; await writeCompanionRequest($, c, latest.view ?? view, {}); goal = s => s.folder && s.app && s.info.running === true && s.info.version === s.version }
        } else {
          c.issue = report === 'no-tools' ? 'tools' : report === 'old-tools' ? 'oldTools' : 'failed'
          c.afterTools = false
          c.message = [...lines.filter(line => line.trim() && !/^result:/.test(line)), ...r.stderr.trim().split(/\r?\n/).filter(Boolean)].pop() ?? ''
        }
      }
    } else if (action === 'toolsButton' || action === 'oldToolsButton') {
      redraw()
      const argv = action === 'toolsButton' ? ['/usr/bin/xcode-select', '--install'] : ['/usr/bin/open', 'x-apple.systempreferences:com.apple.Software-Update-Settings.extension']
      const r = await companionRun($, c, argv, action === 'toolsButton' ? 'Get Apple Command Line Tools' : 'Open Software Update')
      if (r.kind === 'ran' && r.exitCode === 0) c.afterTools = true
    } else if (action === 'summon') {
      c.unanswered = false
      c.summonAt = at
      if (!(await writeCompanionRequest($, c, view, { summon: at }))) return
      goal = s => (s.info.answered ?? 0) >= at
      redraw()
      await companionRun($, c, c.pet ? [c.pet.program, 'start'] : COMPANION_OPEN, 'Bring Coco Pet back')
    } else {
      let request: CompanionRequest
      if (action === 'follow') { request = { follow: at }; goal = s => s.info.accessibility === true }
      else if (action === 'openSettings') request = { settings: at }
      else if (action === 'on' || action === 'off') { const on = action === 'on'; request = { login: { on, at } }; goal = s => (s.info.loginAt ?? 0) >= at && s.login === on }
      else if (action === 'captureOn' || action === 'captureOff') { const on = action === 'captureOn'; request = { capture: { on, at } }; goal = s => (s.info.captureAt ?? 0) >= at && s.info.capture === on }
      else { const to = action as CompanionSize; request = { size: { to, at } }; goal = s => (s.info.sizeAt ?? 0) >= at && s.info.size === to }
      if (!(await writeCompanionRequest($, c, view, request))) return
      if (action === 'follow') c.followed = now
      redraw()
    }
  } finally {
    c.progress = undefined
    c.busy.delete(group)
    redraw()
  }
}


// Destination discovery is read-only: a host without a Pictures directory offers no save.
async function usableCardDestination($: Engine): Promise<CardDestination | undefined> {
  const found = await cardDestination(bookEngine($)).catch(() => undefined)
  if (!found) return undefined
  const pictures = found.folder.replace(/[\\/][^\\/]+$/, '')
  try {
    if ((await $.fs.stat(pictures)).kind !== 'dir') return undefined
    if (found.platform !== 'windows') {
      const writable = await $.process.run(['/bin/test', '-w', pictures], { timeoutMs: 2000 })
      if (writable.exitCode !== 0) return undefined
    }
    return found
  } catch { return undefined }
}

// ---------------------------------------------------------------- the week

const weekWords = (lang: string): WeekWord => (key, vars, n) => weekWord(lang, key, vars, n)
const weekCardWords = (word: WeekWord): boolean => ['card.week.title', 'card.week.facts', 'card.unofficial', 'card.week.rangeJoin'].every(key => word(key) !== '')

// An issue's cover (owner 10-17: the twelve take turns by issue number), read once.
async function zineCoverArt($: Engine, n: number): Promise<string | undefined> {
  const k = zineCover(n)
  if (!zineCovers.has(k)) {
    try { zineCovers.set(k, (await $.fs.read(joinPath($.plugin.root, 'assets', 'zine', `cover-${String(k).padStart(2, '0')}.jpg`), { as: 'bytes' })).base64) } catch { return undefined }
  }
  return zineCovers.get(k)
}

async function weekData($: Engine, view: CocoView | undefined, surface: 'desktop' | 'terminal' | 'vscode' | 'mobile') {
  if (!reminderSettings(latest.settings).week) return undefined
  const lang = view?.lang ?? 'en', word = weekWords(lang), zine = bagWords(lang)?.zineRows
  const held = weekRecordFrom(await $.store.get(WEEK_STORE)), now = await $.clock.now()
  const shown = weekView(held, localDay(now, timeZone), lang, weekWant)?.n, art = shown && surface !== 'terminal' ? await zineCoverArt($, shown) : undefined
  // Drawing the page reads no folder and runs nothing: whether the card can be saved is found out at the press.
  const data = weekBookData({
    held, now, zone: timeZone, lang, surface, word, ...(weekWant === undefined ? {} : { want: weekWant }),
    ...(zine ? { zine } : {}), ...(art ? { cover: (n: number) => n === shown ? art : undefined } : {}),
    canSave: weekCardWords(word), ...(weekSave ? { save: weekSave } : {}), ...(weekDestination ? { home: weekDestination.home } : {}), localDay,
  })
  if (data?.shown) weekShown = data.shown
  return data
}

async function saveWeek($: Engine): Promise<void> {
  if (weekSave === 'saving') return
  const generation = bookGeneration, lang = latest.view?.lang ?? 'en', word = weekWords(lang)
  weekSave = 'saving'; redrawSoon($)
  let result: CardSaveResult = { kind: 'failed' }
  try {
    const [now, config] = await Promise.all([$.clock.now(), $.config.list()])
    const theme = config.find(row => row.key === 'theme')?.value
    const held = weekRecordFrom(await $.store.get(WEEK_STORE)), view = weekView(held, localDay(now, timeZone), lang, weekWant)
    const dest = weekDestination ?? await usableCardDestination($)
    weekDestination = dest
    if (dest && view && weekCardWords(word)) {
      const read = (path: string): Promise<string> => $.fs.read(joinPath($.plugin.root, path))
      result = await saveWeekCard(bookEngine($), view.start, async () => {
        await loadCardMetrics(read)
        const art = async (...path: string[]): Promise<string | undefined> => { try { return (await $.fs.read(joinPath($.plugin.root, ...path), { as: 'bytes' })).base64 } catch { return undefined } }
        const { pages, green } = viewTotals(view), n = (v: number): string => numberText(v, lang)
        // this issue's cover (owner 10-17); should it not read, their night-window painting (DECISIONS 931)
        const cover = view.n ? await zineCoverArt($, view.n) : undefined, illustration = cover ? undefined : await art('assets', 'card', 'week.png')
        // a past issue's card is titled with its number, and its numbers are not 'this week''s
        const issue = view.shown === 'back' ? bagWords(lang)?.zineRows?.issue.replace('{n}', n(view.n!)) : undefined
        return weekCardSvg({
          lang, theme: typeof theme === 'string' && theme.startsWith('dark') ? 'dark' : 'light', title: issue ?? word('card.week.title'),
          facts: issue ? word('week.facts', { pages: n(pages), green: n(green) }, pages) : word('card.week.facts', { pages: n(pages), green: n(green) }, pages),
          range: weekRange(view.start, view.end, lang, word('card.week.rangeJoin')), unofficial: word('card.unofficial'),
          ...(cover ? { cover } : illustration ? { illustration } : {}),
        })
      }, dest)
    }
  } catch { result = { kind: 'failed' } }
  finally {
    weekSave = open && book.page === 'log' && generation === bookGeneration ? result : undefined
    redrawSoon($)
  }
}

// ---------------------------------------------------------------- the vibe check's share card

// His design (10-17): one button saves the card as <Pictures>/Coco/vibe-<day>-<time>.png and then opens that folder; the line
// above it says where it went, or that it failed. The buttons are lane B's share words, the notes the week card's.
const pathNote = (text: string): string => text.includes('{path}') ? text : `${text} {path}`
function vibeShareData(lang: string): Pick<BookData, 'vibeShare'> {
  const share = bagWords(lang)?.share, saving = weekWord(lang, 'week.saving')
  if (!share || !saving) return {}
  const done = typeof vibeSave === 'object' && vibeSave.kind !== 'failed'
  const saved = typeof vibeSave === 'object'
    ? cardSaveWords(vibeSave, { saved: pathNote(weekWord(lang, 'week.saved')), savedSvg: pathNote(weekWord(lang, 'week.savedSvg')), failed: weekWord(lang, 'week.failed') }, weekDestination?.home ?? '')
    : undefined
  return { vibeShare: {
    ...(saved ? { saved } : {}),
    button: vibeSave === 'saving' ? { key: 'coco:vibe:saving', label: saving } : done ? { key: 'coco:vibe:show', label: share.folder } : { key: 'coco:vibe:save', label: share.save },
  } }
}

// The card holds the verdict, the two roasts and only the numbers that happened (vibe-card.ts); its time in the file name
// keeps every save, since a session's verdict moves.
async function saveVibe($: Engine): Promise<void> {
  if (vibeSave === 'saving') return
  const generation = bookGeneration, lang = latest.view?.lang ?? 'en'
  vibeSave = 'saving'; redrawSoon($)
  let result: CardSaveResult = { kind: 'failed' }
  try {
    const now = await $.clock.now(), facts = c3Snapshot.vibe ?? { failed: 0, fixed: 0, compacted: 0 }
    const set = vibeSet(lang, facts, now, timeZone), rows = bagWords(lang)?.vibeRows
    const dest = weekDestination ?? await usableCardDestination($)
    weekDestination = dest
    if (dest && set && rows) {
      let clock = new Date(now).toISOString().slice(11, 16)
      try { clock = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now) } catch { /* the UTC time */ }
      const n = (v: number): string => numberText(v, lang), slots = { fixed: n(facts.fixed), compacted: n(facts.compacted) }
      const tools = Object.values(facts.tools ?? {}).reduce((sum: number, v) => sum + (v ?? 0), 0)
      const cardRows: VibeCardRow[] = [
        ...(facts.fixed > 0 ? [{ template: rows.fixed, key: 'fixed', value: n(facts.fixed) }] : []),
        ...((facts.storms ?? 0) > 0 ? [{ template: rows.storms, key: 'storms', value: n(facts.storms!) }] : []),
        ...(facts.compacted > 0 ? [{ template: rows.compactions, key: 'n', value: n(facts.compacted) }] : []),
        ...((facts.helpers ?? 0) > 0 ? [{ template: bagFill(rows.helpers, { n: '{n}', back: n(facts.back ?? 0) }), key: 'n', value: n(facts.helpers!) }] : []),
        ...((facts.commits ?? 0) > 0 ? [{ template: rows.commits, key: 'n', value: n(facts.commits!) }] : []),
        ...(tools > 0 ? [{ template: rows.tools, key: 'n', value: n(tools) }] : []),
      ]
      result = await saveCard(bookEngine($), `vibe-${localDay(now, timeZone)}-${clock.replace(/\D/g, '')}`, async () => {
        let art: { base64: string; width: number; height: number } | undefined
        try {
          const base64 = (await $.fs.read(joinPath($.plugin.root, 'assets', 'card', `vibe-${vibeSituation(facts)}.png`), { as: 'bytes' })).base64, size = vibePngSize(base64)
          if (size) art = { base64, ...size }
        } catch { /* the card without its picture */ }
        const unofficial = weekWord(lang, 'card.unofficial')
        return vibeCardSvg({
          lang, title: bagFill(set.verdict, slots), roasts: set.roasts.map(text => bagFill(text, slots)), rows: cardRows, rarity: vibeRarity(facts),
          name: cardName(lang).text, ...(unofficial ? { unofficial } : {}), ...(art ? { art } : {}),
        })
      }, dest)
    }
  } catch { result = { kind: 'failed' } }
  finally {
    vibeSave = open && book.page === 'omen' && generation === bookGeneration ? result : undefined
    redrawSoon($)
  }
}

async function fixCheck($: Engine, row: CheckRow, view: CocoView, w: BookWords): Promise<void> {
  if (!row.fix || checkWorking.has(row.id)) return
  const generation = bookGeneration
  if (row.fix === 'reloadPlugins') {
    const copied = await $.ui.copy({ text: '/reload-plugins' })
    if (generation === bookGeneration) {
      if (copied.isCopied) copiedChecks.add(row.id.slice('session:'.length))
      refreshChecks($, true)
    }
    redrawSoon($)
    return
  }
  if (row.fix === 'bandOn') return // The Button uses the existing band setting's ui.press action.
  checkWorking.set(row.id, row.fix === 'summon' || row.fix === 'updateButton' ? moreWord('check.fixWaiting',view.lang) : row.fix === 'follow' ? w.settings.companion.waiting : w.settings.companion.stopped)
  redrawSoon($)
  try {
    await pressCompanion($, companionBook, row.fix, view, () => redrawSoon($), () => open && book.page === 'settings')
    if(row.fix==='summon'||row.fix==='updateButton'){
      const home=checkHome??await homeOf($),folder=home?joinPath(home,COMPANION_DIR):undefined
      const found=folder?await boundedHealth(ms=>$.clock.sleep(ms),()=>readCheckCompanion(bookEngine($),folder,true),found=>found.companion.running===true&&(row.fix!=='updateButton'||(found.health.version??found.companion.version)===PLUGIN_VERSION),fixHealthDeadline($)):undefined
      if(found)checkCompanion=found
      m1CheckAfter.set(row.id,moreWord(found?'check.fixBack':'check.fixGone',view.lang))
    }
  } finally {
    if (generation === bookGeneration) { checkWorking.delete(row.id); refreshChecks($, true) }
    redrawSoon($)
  }
}

// ---------------------------------------------------------------- hooks

export function completeBookClose(event:{id:string;origin:{kind:'plugin'|'person'|'unload'}},originPlugin:string|undefined,denied:boolean):boolean {
  const his=event.id===BOOK_PANE&&(event.origin.kind!=='plugin'||originPlugin==='coco')
  if(!his||denied)return false
  open=false
  if(m1Runtime){m1Runtime.open=false;m1Runtime.explanation='';m1Runtime.talkHidden()}
  m1TalkOpen=false;m1VoiceAskActive=false;m1VoiceAnswered=false
  book={...book,languages:false}
  delete book.visitors
  redraw?.cancel()
  redraw=undefined
  forget()
  return true
}

export function registerBook(on: On): void {
  // Observe publication order independently of latest.view: the band installs that cache
  // before state.set, and a delayed host completion must never replace its newer snapshot.
  observedView = undefined
  on('state.set', { plugin: 'coco', key: 'view' }, async ($, e, next) => {
    const before = observedView
    const after = e.value
    observedView = after
    const set = await next(e)
    if ('deny' in set) {
      if (observedView === after) observedView = before
      return set
    }
    if (before && after.mood === 'wild' && before.mood !== 'wild') await countUp($, 'wilds')
    // Root publication already updated the cache. Keep its generation authoritative
    // while preserving the book's explicit settings refresh and language panel.
    const current = latest.view
    if (current?.lang !== after.lang || current?.voice !== after.voice || current?.band !== after.band) {
      $.ui.invalidate('ui.render')
    } else if (open && (book.page === 'settings' || book.page === companionPage()) && (
      before?.companionTarget !== after.companionTarget ||
      before?.affection !== after.affection ||
      before?.workSize !== after.workSize
    )) {
      await show($, book.page)
    } else if (open && (book.page === 'offerings' ? current?.context !== after.context || current?.estimate !== after.estimate : current?.colors !== after.colors)) {
      redrawSoon($)
    }
    return set
  })

  on('session.attach', { clientId: /./ }, async ($, e, next) => {
    const attached = await next(e)
    if (open && (book.page === 'settings' || book.page === companionPage())) await show($, book.page)
    return attached
  })
  on('session.detach', { clientId: /./ }, async ($, e, next) => {
    const detached = await next(e)
    if (open && (book.page === 'settings' || book.page === companionPage())) await show($, book.page)
    return detached
  })

  // Every reading of the engine's usage figures, whoever asked: the open book shows the latest.
  // The closed book keeps none.
  on('session.usage', async ($, e, next) => {
    const revision = usageRevision
    const read = await next(e)
    if (revision !== usageRevision || !open || !('value' in read) || read.value === undefined) return read
    warmCompanion($, companionBook, () => redrawSoon($))
    const moved = !sameUsage(usage, read.value)
    usage = read.value
    if (moved && open && (book.page === 'offerings' || book.page === 'settings')) redrawSoon($)
    return read
  })

  // The store as this plugin writes it (every plugin's writes raise this event; another's, even
  // of a key of the same name, is not his). `turns` is written once at the end of each turn of
  // the main conversation: the moment to note the first page and the latest night.
  on('store.set', async ($, e, next) => {
    if (next.origin.plugin !== 'coco') return next(e)
    const set = await next(e)
    if ('deny' in set) return set
    if (e.key === 'turns') await turnFinished($)
    if (open && (WATCH[book.page].includes(e.key)||e.key==='more')) redrawSoon($)
    return set
  })

  // The book closing, by the person (or the engine) or by this plugin. Closed, it lets go of all it held.
  on('ui.close', async ($, e, next) => {
    const closed = await next(e)
    completeBookClose(e,next.origin.plugin,'deny' in closed)
    return closed
  })

  on('ui.press', { element: 'coco:prices:open' }, async ($, e) => {
    try { await beginPrices($) } catch { forgetPrices(); redrawSoon($) }
    return { element: e.element }
  })
  on('ui.press', { element: /^coco:prices:(back|older|about|others)$/ }, async ($, e) => {
    if (!pricesOpen || !pricesController) return { element: e.element }
    if (e.element === 'coco:prices:back') { forgetPrices(); redrawSoon($) }
    else if (e.element === 'coco:prices:older') pricesController.toggleOlder()
    else void pricesController.openOthers()
    return { element: e.element }
  })
  on('ui.press', { element: 'coco:cache:how' }, ($, e) => {
    if (open && book.page === 'offerings' && !pricesOpen) { costHow = !costHow; redrawSoon($) }
    return { element: e.element }
  })
  on('ui.press', { element: 'coco:week:save' }, async ($, e) => { await saveWeek($); return { element: e.element } })
  on('ui.press', { element: 'coco:week:show' }, async ($, e) => {
    if (typeof weekSave === 'object' && weekDestination) await revealCard(bookEngine($), weekSave, weekDestination.platform)
    return { element: e.element }
  })
  on('ui.press', { element: 'coco:vibe:save' }, async ($, e) => { await saveVibe($); return { element: e.element } })
  on('ui.press', { element: 'coco:vibe:show' }, async ($, e) => {
    if (typeof vibeSave === 'object' && weekDestination) await revealCard(bookEngine($), vibeSave, weekDestination.platform)
    return { element: e.element }
  })
  on('ui.press', { element: 'coco:week:previous' }, async ($, e) => { weekWant = weekShown === 'this'; weekSave = undefined; redrawSoon($); return { element: e.element } })
  // a row of the zine's every issue opens that issue at the top of the page
  on('ui.press', { element: /^coco:zine:issue:\d+$/ }, async ($, e) => {
    if (open && book.page === 'log') { weekWant = Number(e.element.slice('coco:zine:issue:'.length)); weekSave = undefined; redrawSoon($) }
    return { element: e.element }
  })
  // The band's line «last week's page is in my book» opens the book on that page.
  on('ui.press', { element: 'coco:week:open' }, async ($, e) => { weekWant = true; await openBook($, 'log', e.surface); return { element: e.element } })

  // The band's button.
  on('ui.press', { element: 'coco:book:open' }, async ($, e) => {
    bookPressReport = { wasOpen: open, page: book.page }
    if (open) { await $.ui.close({id:BOOK_PANE}); return {element:e.element} }
    await openBook($, book.page, e.surface)
    bookPressReport = { ...bookPressReport, placed: open }
    return { element: e.element }
  })

  // The guest book: opened from His page, paged by month, left by its back button.
  on('ui.press', { element: /^coco:visitors:(open|back|previous|next)$/ }, async ($, e) => {
    const what = e.element.split(':').at(-1)
    const at = book.visitors ?? 0
    book = { ...book, visitors: what === 'open' ? 0 : what === 'previous' ? at + 1 : what === 'next' ? Math.max(0, at - 1) : undefined }
    if (book.visitors === undefined) delete book.visitors
    else if (what === 'open') readNotes($)
    await show($, 'him')
    return { element: e.element }
  })

  on('ui.press', { element: /^coco:set:lang:/ }, async ($, e, next) => {
    if (e.element === 'coco:set:lang:open') {
      book = { ...book, languages: true }
      await show($, 'settings')
      return { element: e.element }
    }
    const pressed = await next(e)
    if (book.languages) { book = { ...book, languages: false }; await show($, 'settings') }
    return pressed
  })

  // `/coco` opens the book where it was left; `/coco about|settings|...` at a page;
  // `/coco marks on|replies|off` sets his marks on the engine's rows.
  // Registered before the plugin's other `/coco` hook, so this one sees the command first.
  on('command.run', { command: 'coco' }, async ($, e, next) => {
    const [verb = '', value = ''] = e.args.trim().toLowerCase().split(/\s+/)
    if(m1Runtime&&verb==='more'){
      await openM1Book($,'settings');m1Runtime.open=true;m1Runtime.reading=0;await m1BookFlags($,true,false);await focusM1Book($,'coco:book:tab:settings');redrawSoon($);return{}
    }
    if(m1Runtime&&verb==='talk'&&m1Runtime.isOn('talk')){const runtime=m1Runtime,token=runtime.operationToken('talk');await openM1Book($,'talk',()=>m1Runtime===runtime&&runtime.operationCurrent('talk',token));return{}}
    if(m1Runtime&&verb==='say'){
      if(m1Runtime.isOn('talk')){const runtime=m1Runtime,token=runtime.operationToken('talk'),now=await $.clock.now();if(m1Runtime!==runtime||!runtime.operationCurrent('talk',token))return{};await runtime.talk(morePageEngine($),e.args.replace(/^\s*say(?:\s+|$)/i,''),now);if(m1Runtime===runtime&&runtime.operationCurrent('talk',token))await openM1Book($,'talk',()=>m1Runtime===runtime&&runtime.operationCurrent('talk',token))}
      return{}
    }
    if(verb==='companion'){
      const args=e.args.trim().split(/\s+/).slice(1)
      const pet=await petProgramPath()
      // Windows and Linux: install copies the pet into its own folder and starts it (with --login, at login too);
      // uninstall moves both of its folders to the trash (companion-rs/src/setup.rs). The Mac's script also says its status.
      const verbs=pet!==undefined?['install','start','stop','uninstall']:['install','start','stop','status','uninstall']
      if(!verbs.includes(args[0]??'')||args.length>2||args[1]!==undefined&&(args[1]!=='--login'||args[0]!=='install')){
        $.ui.toast(`/coco companion ${verbs.join('|')}\n/coco companion install --login`,{timeoutMs:8000})
        return{}
      }
      // The program is named by its whole path, so PATH is left as it is: the pet started here keeps it.
      const argv=pet!==undefined?[pet,...args]:['/bin/sh',joinPath($.plugin.root,'bin','companion-macos.sh'),...args]
      const r=await ownCall($,argv,pet===undefined,gapWord(latest.view?.lang??'en','cmd.coco')).catch(()=>undefined)
      // A run outside the Bash tool leaves nothing in the conversation, so its own words come up here.
      const said=r?.kind==='ran'?(r.stdout.trim()||r.stderr.trim()).split(/\r?\n/).slice(-3).join('\n'):''
      if(said)$.ui.toast(said,{timeoutMs:8000})
      return{}
    }
    if (verb === 'warmth' && (value === 'warm' || value === 'clingy')) {
      return next({ ...e, args: e.args.replace(/^(\s*)warmth\b/i, '$1affection') })
    }
    if (verb === 'marks' && (value === 'on' || value === 'replies' || value === 'off')) {
      await setMarks($, value)
      $.ui.toast(fill(ownWords(latest.view?.lang ?? 'en').marks.noted, { value }), { timeoutMs: 8000 })
      return {}
    }
    if (verb === 'visitors') {
      book = { ...book, visitors: 0 }
      readNotes($)
      await openBook($, 'him')
      return {}
    }
    const page = verb === '' || verb === 'book' ? book.page : ALIASES[verb]
    if (page === undefined) return next(e)
    await openBook($, page)
    return {}
  })

  on('ui.press',{element:/^coco:script:/},($,e)=>{
    const key=e.element.slice('coco:script:'.length)
    if(m1ScriptFolds.has(key))m1ScriptFolds.delete(key);else m1ScriptFolds.add(key)
    redrawSoon($);return{element:e.element}
  })
  on('ui.press',{element:/^coco:(?:companion:(?:install|retry|updateButton|trash|summon)|icon:(?:apply|clear))$/},async($,e,next)=>{
    const platform=iconBook.platform?await iconBook.platform:undefined
    const argv=scriptArgv(e.element,$.plugin.root,platform)
    if(argv){const verdict=await $.tool.check({tool:'Bash',input:{command:companionCommand(argv)}});if(verdict.decision==='deny'){$.ui.toast(moreWord('script.blocked',latest.view?.lang??'en'));return{element:e.element}}}
    return next(e)
  })
  on('ui.press', {element:/^coco:more:/}, async ($,e,next)=>{
    if(!m1Runtime)return next(e)
    if(e.element==='coco:more:open'){await show($,'settings');m1Runtime.open=true;m1Runtime.reading=0;await m1BookFlags($,true,false);await focusM1Book($,'coco:book:tab:settings')}
    else if(e.element==='coco:more:back'){m1Runtime.open=false;await m1BookFlags($,false,false);await focusM1Book($,'coco:book:tab:settings')}
    else if(e.element==='coco:more:key:add'||e.element==='coco:more:key:replace'){
      // The dialog waits for a person, so the press returns now and the row redraws when it closes.
      const runtime=m1Runtime;void runtime.addKey(morePageEngine($)).catch(()=>{}).then(()=>{if(m1Runtime===runtime)redrawSoon($)})
    }
    else if(e.element==='coco:more:key:remove')await m1Runtime.removeKey(morePageEngine($))
    else if(e.element==='coco:more:key:check')await m1Runtime.checkKey(morePageEngine($))
    else if(e.element==='coco:more:key:copy')await m1Runtime.copyAddCommand(morePageEngine($))
    else if(e.element.startsWith('coco:more:payer:pick:'))await m1Runtime.choosePayer(morePageEngine($),e.element.split(':').at(-1)!)
    else if(!await m1Runtime.press(morePageEngine($),e.element))return next(e)
    redrawSoon($);return {element:e.element}
  })
  on('ui.input',{element:/^coco:more:key:(?:base|model)$/},($,e,next)=>{
    if(!m1Runtime)return next(e)
    m1Runtime.setKeyEndpoint(e.element.endsWith(':base')?'base':'model',e.value)
    redrawSoon($);return{element:e.element,value:e.value}
  })
  on('ui.select',{element:'coco:more:payer'},async($,e,next)=>{
    if(!m1Runtime)return next(e)
    await m1Runtime.choosePayer(morePageEngine($),e.value);redrawSoon($);return{element:e.element,value:e.value}
  })
  on('ui.select',{element:'coco:more:cap'},async($,e,next)=>{
    if(!m1Runtime)return next(e)
    await m1Runtime.select(morePageEngine($),e.value);redrawSoon($);return{element:e.element,value:e.value}
  })
  // Coco's written lines alone or mixed with the shipped ones (his 10-17 pick)
  on('ui.select',{element:'coco:more:lines:mix'},async($,e,next)=>{
    if(!m1Runtime)return next(e)
    await m1Runtime.chooseLinesMix(morePageEngine($),e.value);redrawSoon($);return{element:e.element,value:e.value}
  })
  // The DM thread's choices (owner's cards 10-17 late): her first messages from her lines or by the model, notifications.
  on('ui.select',{element:/^coco:more:dm:(?:first|notify)$/},async($,e,next)=>{
    if(!m1Runtime||!['lines','model','on','off'].includes(e.value))return next(e)
    m1Runtime.setDm(e.element.endsWith(':first')?{first:e.value==='model'?'model':'lines'}:{notify:e.value==='on'});redrawSoon($);return{element:e.element,value:e.value}
  })
  on('ui.press',{element:/^coco:more:dm:(?:first:(?:lines|model)|notify:(?:on|off))$/},async($,e,next)=>{
    if(!m1Runtime)return next(e)
    const value=e.element.split(':').at(-1)!
    m1Runtime.setDm(e.element.includes(':first:')?{first:value==='model'?'model':'lines'}:{notify:value==='on'});redrawSoon($);return{element:e.element}
  })
  // The language written lines are in (his 10-17 pick)
  on('ui.select',{element:'coco:more:lines:lang'},async($,e,next)=>{
    if(!m1Runtime)return next(e)
    await m1Runtime.chooseLinesLang(morePageEngine($),e.value);redrawSoon($);return{element:e.element,value:e.value}
  })
  // The model Talk (and Explain, on the same pick) or the second look runs on, by its place in the list (more-models.ts)
  on('ui.select',{element:/^coco:more:(?:talk|explain|look|lines):model$/},async($,e,next)=>{
    if(!m1Runtime||!/^\d+$/.test(e.value))return next(e)
    await m1Runtime.chooseModel(morePageEngine($),e.element.includes(':look:')?'look':e.element.includes(':lines:')?'lines':'talk',Number(e.value));redrawSoon($);return{element:e.element,value:e.value}
  })
  on('ui.focus',{element:/^coco:more:/},($,e,next)=>{
    if(m1Runtime?.focus(e.element))redrawSoon($)
    return next(e)
  })
  on('ui.scroll',{requestId:BOOK_PANE},($,e,next)=>{
    if(!m1Runtime?.scroll(e.by))return next(e)
    redrawSoon($);return {}
  })
  on('ui.press',{element:/^coco:book:tab:/},async($,e,next)=>{
    if(!m1Runtime||(!m1Runtime.open&&!m1TalkOpen))return next(e)
    const page=e.element.split(':').at(-1) as Page
    if(PAGES.includes(page)){await show($,page);redrawSoon($)}
    return{element:e.element}
  })
  // The band's DM entry: the thread, wherever the bag was.
  on('ui.press',{element:'coco:dm:open'},async($,e,next)=>{
    if(!m1Runtime?.isOn('talk'))return next(e)
    const runtime=m1Runtime,token=runtime.operationToken('talk')
    await openM1Book($,'talk',()=>m1Runtime===runtime&&runtime.operationCurrent('talk',token))
    return{element:e.element}
  })
  on('ui.press',{element:/^coco:talk:/},async($,e,next)=>{
    if(!m1Runtime?.isOn('talk'))return next(e)
    const runtime=m1Runtime,token=runtime.operationToken('talk')
    if(e.element==='coco:talk:open')await openM1Book($,'talk',()=>m1Runtime===runtime&&runtime.operationCurrent('talk',token))
    else if(e.element==='coco:talk:send'){const text=runtime.talkInput,now=await $.clock.now();if(m1Runtime!==runtime||!runtime.operationCurrent('talk',token))return{element:e.element};await runtime.talk(morePageEngine($),text,now)}
    else if(e.element.startsWith('coco:talk:askClaude:'))await runtime.askClaude(morePageEngine($),Number(e.element.split(':').at(-1)))
    else if(e.element.startsWith('coco:talk:openSettings:')){await show($,'settings');runtime.open=true;runtime.reading=0;await m1BookFlags($,true,false);await focusM1Book($,'coco:book:tab:settings')}
    else if(e.element.startsWith('coco:talk:fallback:')){const now=await $.clock.now();await runtime.talkFallback(morePageEngine($),Number(e.element.split(':').at(-1)),now)}
    else return next(e)
    if(m1Runtime===runtime&&runtime.operationCurrent('talk',token))redrawSoon($);return{element:e.element}
  })
  on('ui.input',{element:'coco:talk:input'},async($,e,next)=>{
    if(!m1Runtime?.isOn('talk'))return next(e)
    const runtime=m1Runtime,token=runtime.operationToken('talk')
    m1Runtime.talkInput=e.value
    if(e.kind==='submit'){const now=await $.clock.now();if(m1Runtime!==runtime||!runtime.operationCurrent('talk',token))return{element:e.element,value:e.value};await runtime.talk(morePageEngine($),e.value,now)}
    if(m1Runtime===runtime&&runtime.operationCurrent('talk',token))redrawSoon($);return{element:e.element,value:e.value}
  })
  on('ui.press',{element:/^coco:(?:set:voice:light|first:voice:keep)$/},async($,e,next)=>{const result=await next(e);m1VoiceAskActive=false;m1VoiceCardShown=true;m1VoiceAnswered=book.page==='him';redrawSoon($);return result})
  on('ui.press',{element:'coco:diary:write'},async($,e,next)=>{
    if(!m1Runtime?.isOn('talk'))return next(e)
    const runtime=m1Runtime,token=runtime.operationToken('talk')
    const now=await $.clock.now();if(m1Runtime!==runtime||!runtime.operationCurrent('talk',token))return{element:e.element}
    await runtime.writeDiary(morePageEngine($),now);if(m1Runtime===runtime&&runtime.operationCurrent('talk',token))redrawSoon($);return{element:e.element}
  })
  on('ui.press',{element:'coco:explain:copy'},async($,e,next)=>{
    if(!m1Runtime?.isOn('explain'))return next(e)
    await m1Runtime.copyExplanation(morePageEngine($));return{element:e.element}
  })
  on('ui.press',{element:'coco:look:tellClaude'},async($,e,next)=>{
    if(!m1Runtime?.isOn('look'))return next(e)
    await m1Runtime.lookTell(morePageEngine($));return{element:e.element}
  })
  on('ui.press',{element:'coco:look:copy'},async($,e,next)=>{
    if(!m1Runtime?.isOn('look'))return next(e)
    await m1Runtime.copyLook(morePageEngine($));return{element:e.element}
  })

  on('ui.render', { component: 'Pane', requestId: BOOK_PANE }, async ($, e, next) => {
    const started = Date.now()
    try {
    const drawn = await (async () => {
    const held = bookPublishFailed ? book : (await $.state.get(BOOK)).value ?? book
    open = true
    book=held
    if(m1Runtime){m1Runtime.open=held.more===true;m1TalkOpen=held.talk===true}
    if(m1Runtime&&(m1Runtime.open||m1TalkOpen&&m1Runtime.isOn('talk'))) {
      const words=await wordsFor($,m1Runtime.lang), E=$.ui.resolve(e), d:MoreBookData={snapshot:m1Runtime.snapshot(),surface:e.surface,usage,...await m1KeyData($,e.props.bodyColumns)}
      // His messages still to come wait on a clock only while Talk is drawn (owner, 10-10).
      if(m1Runtime.open)m1Runtime.talkHidden();else m1Runtime.talkShown(morePageEngine($))
      const content=m1Runtime.open?MorePage(E,d):MoreTalk(E,{...d,exchanges:m1Runtime.talkView,name:gapCharacterName(m1Runtime.lang),claudieName:claudieName(m1Runtime.lang),who:m1Runtime.talkSpeaker,busy:m1Runtime.busy,writing:m1Runtime.talkWriting})
      return m1Frame(E,words,e.surface,content)
    }
    m1Runtime?.talkHidden()
    if (!open || book.rev !== held.rev) return next(e)
    const generation=bookGeneration
    const roomCurrent=()=>open && book.page==='him' && generation===bookGeneration
    const settings = await $.settings.read()
    timeZone = typeof settings.timeZone === 'string' ? settings.timeZone : undefined
    reducedMotion = settings.prefersReducedMotion === true
    const view = latest.view ?? (await $.state.get(VIEW)).value
    const w = await wordsFor($, view?.lang ?? 'en')
    if (held.page === 'offerings' || held.page === 'settings') await ensureCostWords($)
    if (held.page !== 'offerings' && pricesOpen) forgetPrices()
    if (pricesOpen && pricesController && drawPrices) {
      pricesController.setChatModel(await $.session.model().catch(() => null))
      return drawPrices($.ui.resolve(e), pricesController.state(), {
        lang: view?.lang ?? 'en', word: costWord, surface: e.surface, columns: e.props.bodyColumns,
        onBack: () => { forgetPrices(); redrawSoon($) },
        onOlder: () => pricesController?.toggleOlder(),
        onOthers: () => { void pricesController?.openOthers() },
      })
    }
    await loadD1Words(bookEngine($),view?.lang??'en')
    await loadC3Words(() => $.fs.read(joinPath($.plugin.root, 'hooks/c3-text.json')))
    await loadWeekWords(bookEngine($))
    if (e.surface !== 'terminal') { if (bagStyleMv()) await loadBagPeekMv($); else await loadBagPeek($) }
    if(held.page==='him') {
      if(!roomCurrent())return next(e)
      await roomForHis()
      if(!roomCurrent())return next(e)
    }
    const data = await dataFor($, held, view)
    data.cards = await dealtCards($).catch(() => undefined)
    const E=$.ui.resolve(e),incoming=ReceivedNotesBook(E,view?.lang??'en',true)
    if(incoming)data.windowNotes=incoming
    if(m1Runtime){
      // The plan group's heading names who pays (TALK-KEY 3), and so do the rows under Talk on the switches page. Only the
      // credential's kind is read, and only while the More page or the switches page is open; the handle is dropped unspent.
      const rateWindows=(usage?.rateLimits??[]).some(limit=>limit.kind==='five_hour'||limit.kind==='seven_day')
      data.more=m1Runtime.open||held.page==='settings'
        ?{snapshot:m1Runtime.snapshot(),surface:e.surface,usage,...await m1KeyData($,e.props.bodyColumns,true)}
        :{snapshot:m1Runtime.snapshot(),surface:e.surface,usage,payer:morePayer(undefined,rateWindows)}
      data.talkEnabled=m1Runtime.isOn('talk');data.talkTab=moreWord('talk.tab',m1Runtime.lang)
      if(held.page==='him'){
        const E=$.ui.resolve(e),{Box}=E
        const explanation=m1Runtime.explanation&&m1Runtime.isOn('explain')?MoreExplanation(E,{...data.more,text:m1Runtime.explanation}):undefined
        const look=m1Runtime.lookText&&m1Runtime.isOn('look')?MoreLook(E,{...data.more,text:m1Runtime.lookText,findingCount:m1Runtime.lookFindingCount}):undefined
        if(explanation||look)data.m1Him=<Box flexDirection="column" rowGap={1}>{explanation}{look}</Box>
      }
    }
    if(latest.settings.voiceAskAgain===true){m1VoiceAskActive=true;m1VoiceCardShown=false;m1VoiceAnswered=false}
    if(held.page==='him'&&m1VoiceAnswered){
      const E=$.ui.resolve(e),{Box}=E
      data.m1Him=<Box flexDirection="column" rowGap={1}>{answeredVoiceRow(E,w,String(view?.voice??latest.settings.voice??'off'))}{data.m1Him}</Box>
    } else if(held.page==='him'&&(!m1VoiceCardShown||latest.settings.voiceChosen!==true||m1VoiceAskActive)) {
      if(latest.settings.voiceChosen===true&&!m1VoiceAskActive)m1VoiceCardShown=true
      else {
      const E=$.ui.resolve(e),{Box}=E
      data.m1Him=<Box flexDirection="column" rowGap={1}>{m1VoiceCard(E,view?.lang??'en',voiceTokens(data.voiceSizes.light),m1VoiceAskActive)}{data.m1Him}</Box>
      if(latest.settings.voiceAskAgain===true){latest.settings.voiceAskAgain=false;void Promise.resolve().then(()=>$.store.delete('voiceAskAgain')).catch(()=>{})}
      }
    }
    if(held.page==='him'){
      if(held.visitors!==undefined&&readingNotes){await loadVisitorWords(path=>$.fs.read(joinPath($.plugin.root,path))).catch(()=>{})}
      if(held.visitors!==undefined&&readingNotes){readingShown=true;data.visitors=guestBookReading(view?.lang??'en',data.own.name,`‹ ${bagPageName(view?.lang??'en','him')??w.tabs.him}`)}
      else await visitorsForBook($,held,data,view,w)
    }
    if(held.page==='settings')await loadVisitorWords(path=>$.fs.read(joinPath($.plugin.root,path))).catch(()=>{})
    // one Mac probe a visit, kept with the companion's (their page redraws for every companion record once it stands there)
    if (held.page === 'him') data.platform = await companionIsMac($, companionBook) ? 'darwin' : undefined
    if(held.page==='him' && data.room && roomModule && !data.visitors) {
      if(!roomCurrent())return next(e)
      data.roomNarration=roomModule.roomAlt(data.room,d1Words(view?.lang??'en'))
      if(data.room.visitor){const lang=view?.lang??'en',extra=visitorWord(lang,visitorKey('room.alt.visitor',data.room.visitor as VisitorKind));if(extra)data.roomNarration+=(lang==='zh'||lang==='zh-Hant'||lang==='ja'?'':' ')+extra}
      if(e.surface!=='terminal') {
        await roomModule.loadRoomLayers(bookEngine($)).catch(()=>{})
        const scale=roomModule.roomScale(e.props.bodyColumns*7.8)
        // Room layers still being read give no picture; his portrait stands in.
        const roomSource=roomModule.roomSvg(data.room,scale)
        if(roomSource)data.roomPicture={source:roomSource,alt:data.roomNarration,width:160*scale,height:90*scale}
      }
    }
    if(held.page!=='him')roomModule?.forgetRoom()
    if (held.page === 'log') {
      const week = await weekData($, view, e.surface as 'desktop' | 'terminal' | 'vscode' | 'mobile')
      if (week) data.week = week
      // the doujin's issues for its bag and its first line, with this week's finished days already in
      if (reminderSettings(latest.settings).week) {
        const issues = weekIssues(weekRecordFrom(await $.store.get(WEEK_STORE)), localDay(await $.clock.now(), timeZone), view?.lang ?? 'en')
        if (issues) data.issues = issues.got
      }
    }
    const press: Press = {
      costHow: () => { costHow = !costHow; redrawSoon($) },
      go: page => {
        void (async () => {
          if (page === 'him' && book.visitors !== undefined) { book = { ...book }; delete book.visitors }
          await show($, page)
          if (page === 'settings' && (e.surface === 'desktop' || e.surface === 'terminal')) await openIconSettings($, iconBook, () => redrawSoon($))
        })().catch(() => {})
      },
      turn: delta => void show($, readingsPage(), book.reading + delta),
      marks: marks => void setMarks($, marks),
    }
    if (held.page === 'settings' && (e.surface === 'desktop' || e.surface === 'terminal')) {
      data.iconSupported = !(await windows($)) && iconBook.visible
      if (data.iconSupported) {
        data.icon = iconBook.data(latest.settings)
        press.icon = action => runIcon($, iconBook, action, () => redrawSoon($))
      }
    }
    const columns = e.props.bodyColumns
    const companionHere = held.page === companionPage()
    if (companionHere) {
      refreshWindows($)
      if (windowRows.length >= 2) data.windows = { rows: windowRows, self: await $.session.id().catch(() => ''), home: await homeOf($) }
    }
    if ((held.page === 'settings' || companionHere) && (e.surface === 'desktop' || e.surface === 'terminal' || e.surface === 'vscode')) {
      warmCompanion($, companionBook, () => redrawSoon($))
      const snapshot = companionEvent ? { ...withCapabilities(companionEvent, companionBook), version: PLUGIN_VERSION } : companionBook.snapshot
      const pet = companionBook.pet
      if ((companionBook.macReady === true || pet) && snapshot) {
        if (!pet) data.d1NotifyAvailable=snapshot.folder && snapshot.app
        if (companionHere) {
          const surfaces = await $.session.surfaces().catch(() => [e.surface])
          data.companion = companionDataFromSnapshot(companionBook, snapshot, e.surface !== 'terminal', data.now, view?.companionTarget ?? 'auto', surfaces.includes('desktop') ? 'Claude' : surfaces.includes('vscode') ? 'VS Code' : 'Claude')
          if (pet) data.companion.pc = pet.windows ? 'windows' : 'linux'
          press.companion = async action => {
            const current = latest.view ?? view
            if (current) await pressCompanion($, companionBook, action, current, () => redrawSoon($), () => open && book.page === companionPage())
          }
        }
      }
    }
    if (held.page === 'settings') {
      const sizeKey=`${view?.lang??'en'}:${view?.voice??'off'}`
      if(!m1VoiceSizes.has(sizeKey)){try{const composed=await $.prompt.compose();m1VoiceSizes.set(sizeKey,voiceTokens(composedVoiceSize(composed.sections)))}catch{}}
      data.voiceSize=m1VoiceSizes.get(sizeKey)
      refreshChecks($)
      data.platform = companionBook.macReady === true ? 'darwin' : checkPlatform ?? 'linux'
      const snapshot = companionEvent ?? companionBook.snapshot
      const companion = companionEvent ? {
        installed: true,
        companion: { ...companionEvent.info, version: companionEvent.info.version ?? checkCompanionVersion },
        health: {},
      } : checkCompanion ?? {
        installed: snapshot?.folder === true && snapshot.app === true,
        companion: snapshot?.info ?? {}, health: {},
      }
      data.check = checkup({ platform: data.platform, surface: e.surface, ...companion, version: PLUGIN_VERSION, band: view?.band ?? 'on', sessions: checkSessionRows, home: checkHome, copied: [...copiedChecks], working: Object.fromEntries(checkWorking) }, w)
      try{
        const commands=await $.command.list()
        for(const name of commandClashes(commands)){data.check.rows.push({id:`command:${name}`,subject:`/${name}`,state:moreFill(moreWord('check.cmdHidden',view?.lang??'en'),{name}),fix:null})}
      }catch{}
      for(const row of data.check.rows){const after=m1CheckAfter.get(row.id);if(after)row.after=after}
      if(data.check.rows.length)data.check.placement='top'
      press.check = async row => { if (view) await fixCheck($, row, latest.view ?? view, w) }
    }
    if (e.surface !== 'terminal') {
      const height = e.surface === 'desktop' ? held.page === 'him' ? 112 : 56 : held.page === 'him' ? 96 : 48
      // Their page draws the room when there is one; otherwise the portrait, never an empty picture.
      const { source, width } = held.page==='him' && data.roomPicture ? { source: '', width: 0 } : portraitOf(held.page, height, view?.outfit === 'B' ? 'B' : 'A')
      if(data.d1?.helpers.length)await loadD1Art('helpers',path=>$.fs.read(joinPath($.plugin.root,path)))
      if(held.page==='settings'||companionHere){const E=$.ui.resolve(e),tree=desktopBook(E,w,held,data,{source,height,width},press,columns,e.surface);const previews=await inspectScripts(morePageEngine($),tree,checkHome,resolvedIconPlatform(iconBook));return foldScripts(E,tree,previews,m1ScriptFolds,view?.lang??'en')}
      return desktopBook($.ui.resolve(e), w, held, data, { source, height, width }, press, columns, e.surface)
    }
    if (e.surface === 'terminal' && (held.page === 'settings' || companionHere)) { const E=$.ui.resolve(e),tree=terminalBook(E,w,held,data,press,columns);const previews=await inspectScripts(morePageEngine($),tree,checkHome,resolvedIconPlatform(iconBook));return foldScripts(E,tree,previews,m1ScriptFolds,view?.lang??'en') }
    if (e.surface === 'terminal') { return terminalBook($.ui.resolve(e), w, held, data, press, columns) }
    return next(e)
    })()
    bookDrawReport = { page: book.page, more: m1Runtime?.open === true, ownMs: Date.now() - started, aborted: next.signal?.aborted === true, own: drawn && typeof drawn === 'object' && 'type' in drawn ? String(drawn.type) : typeof drawn }
    return drawn
    } catch (error) {
      bookDrawReport = { page: book.page, ownMs: Date.now() - started, aborted: next.signal?.aborted === true, error }
      throw error
    }
  })
}
