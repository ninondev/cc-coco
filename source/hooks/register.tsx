// Coco reads beside you above the prompt.
//
// More's model and network calls require their individual switches. No telemetry. The companion's field submits only on the person's
// press, through Claude Code's prompt API. Besides drawing, this module
// touches: $.store (his settings, the turn count, when you were last here, the quota windows' readings), the
// settings it reads (reduced motion, language, time zone), the config theme, locale and terminal
// environment variables, its own assets/ PNGs and one short system-prompt section for his voice
// (/coco voice). The book's companion button runs the system `open` command. The app
// icon uses the free /coco icon verb. The mod runs bin/icon-*.sh only after the
// machine-local consent gate; status and clear remain available without consent.
//
// Cost: animation holds follow one shared motion model. Terminal frames blit; desktop SVG
// frames redraw from bundled bytes. Off and sleep have no animation timer. The offering box
// follows response/measurement events, with no polling even while working. Optional companion
// writes and diagnostics run after the band's state publication/redraw request.
//
// The state machine lives here because every function handed `$` must sit in this file.
// mood.ts holds its pure parts; band.tsx draws; pictures.ts builds the images once.

import type { Elements, EngineInterface, Register, RenderElement, RenderInput, PluginOptions, SessionContextUsage, ToolCallInput, TurnCompleteInput, TurnUsage, HookStream, ProcessSpawnChunk, ProcessSpawnResult } from 'claude-code'
import type { FrameName } from './art'
import { costumedView, desktopBand, desktopDoor, planDesktop, rowsOf, squashedView, terminalBand, terminalDoor, terminalHasSprite } from './band.js'
import type { DesktopClients } from './band.js'
import {
  ABSOLUTELY_RIGHT, FORCE_PUSH, LOOPS, PERSON, PRAISE, STILL, TEST_RUN, TIMING, colorsOf, cueFor, fill, greetingFor,
  HEARING, PRESENCE_LINES, detectLanguage, detectLanguageNow, typed, initialView, langOf, languageOf, linesFor, localDay, localHour, macSystemLanguage, pick, sharedLineFor,
  NOT_FOUND, PLAN_TOOL, runMoment,
} from './mood'
import { COMPANION_DIR, COMPANION_FEED, companionActivity, companionEnded, companionKey, companionSeen, companionSession, companionTask, companionDock, companionDm, companionText, companionRequestText, clearCompanionLongTaskAuthorization } from './companion'
import { CompanionChannel } from './channel'
import { receivedInbox, resetReceivedInbox, receivedNoteKey, receivedNoteId, RECEIVED_MARKER_SLOT } from './window-notes'
import { SharedPresence, cocoSettings } from './presence'
import { dispatchTouchMessage } from './touch-client'
import type { PresenceSnapshot, PresenceSettings, PresenceTouch } from './presence'
import { replyExcerpt, taskForTool } from './tasks'
import type { TaskDescription } from './tasks'
import { bagOpenInTerminal, openQuotaPage, companionChanged, registerBook, setPetProgramReader, openVibeCheck, bookSettingsChanged, bookPlayChanged, bookMeasured, setCheckSessionsReader, setC3BookSnapshot, setCostBookReader, takeBookPressReport, takeBookDrawReport, setPriceTimer, configureM1Book, openM1Book, restoreM1Book, setD1BookSnapshot, setD1BookNotificationDenied, setVisitBookSnapshot, setIconSettingsWriter, iconFirstDraw, iconSettingsHydrated, resetIconSession, iconCommand, iconWord } from './pages'
import { PLUGIN_VERSION } from './plugin-version'
import { countBookCache, resetBookSession } from './book-session'
import { reminderSettings, LEGACY_SETTING_KEYS, normalizeLegacySettings } from './reminder-settings'
import { setTerminalLook, spritePng, spriteCells, ANIMATION_MODE, terminalMotionFrame, imageColumns, TERMINAL_COLUMNS, TERMINAL_ROWS } from './pictures-lazy'
import { blinkDouble, blinkGap, blinkInterval, blinkShut, gazeBlinkDelay, motionCycle, sampleMotion, sampleTouch, pickMotionVariant, nextMotionChange, motionHasFace, runtimeRandom } from './d1-state.js'
import { bandMotionOptions } from './d1-state.js'
import { describeCocoConfig } from './config-words'
import type { MotionSnapshot, TouchKind } from './motion'
import type { MotionPictureOptions } from './motion-svg'
import { PREBUILT_FRAME_NAMES } from './motion-stills'
import { normalizeDesktopView, normalizeDesktopSettings, safeDesktopTree, validateDesktopTree } from './d1-state.js'
import { ATOMIC_WRITE, DIAGNOSTIC_APPEND, safeDiagnosticError } from './shared-files'
import { homePath, isWindows, joinPath, presenceFolder, windowsPath, readRepositoryBranch } from './d1-paths.js'
import { stateProgram } from './native-state'
import { petDataFolder, petProgram, petProgramShipped, petWriteArgv } from './pet-program'
import { registerTranscript, configureC3Transcript, configureD1Transcript, configureVisitTranscript } from './transcript'
import { bandShownOn, latest, marksFrom } from './latest'
import { gapBefore } from './typeset'
import { VOICE } from './voice'
import { LANGS, WORDS } from './words'
import type { DrawnKey, Lang, Mood } from './words'
import type { CocoView as View } from '../types'
import { LineSlot } from './line-slot'
import type { LineRequest } from './line-slot'
import { createC3Runtime } from './c3-runtime'
import { createNotice, setNotice } from './notice'
import { dressPicture } from './notice-art'
import type { Notice } from './notice'
import type { C3Runtime, C3Reaction } from './c3-runtime'
import { c3Word, c3Durations, loadC3Words } from './c3-words'
import { durationText, clockText } from './numbers'
import { quotaTrailFrom, quotaTrailMerged, quotaTrailWith } from './quota-trail'
import type { QuotaTrail } from './quota-trail'
import { ToolPoses, poseForTool } from './tool-poses'
import { WEEK_STORE, WeekTally, recordWeek, weekKind, weekRecordFrom, weekStart } from './week-days'
import type { WeekKind } from './week-days'
import { chooseOpening, markOpening, openingsFrom, sourceFrom, weekReadyDue } from './openings'
import type { OpeningKind, SessionSource } from './openings'
import { loadWeekWords, weekWord } from './week-words'
import { ModGapsRuntime, GapLimits, WaitSound, detectScreenReader, voiceDecision, textBandMode, hintTail, personBandFocus, compactChapter } from './mod-gaps'
import { renderTextBand, renderRunMark } from './mod-gaps-render'
import { gapWord, gapCharacterName, loadGapWords } from './mod-gaps-words'
import { MoreRuntime, MISSING_MORE_MODEL_SLOTS } from './more-runtime'
import { moreModels } from './more-models'
import type { TalkFacts } from './talk-parts'
import type { KeyHost, KeyPlatform, KeyPrice } from './talk-key'
import { keyArch } from './talk-key'
import { moreWord, moreFill, loadMoreWords, moreModelWords } from './more-words'
import { openerGroup, openerPick } from './talk-openers'
import type { OpenerEvent, OpenerGroup } from './talk-openers'
import { dmPreview } from './dm'
import { AlwaysState, RunDurations, wordCount } from './m1-always'
import { configureM1Transcript } from './transcript'

import { c3MotionFrame, c3NextMotion, openingFrames, openingLife, openingStart } from './c3-motion'
import { installCostWords } from './cost/words'
import { loopColdLine, resumeColdLine, warmReturnLine } from './cost/surfaces'
import { setCostSnapshot } from './cost/state'
import { CostRuntime, usageTokens } from './cost/runtime.js'
import { createLockReader } from './cost/units.js'
import { loadD1Words, d1Word } from './d1-state.js'
import { selectRibbon, rememberRibbon, reconcileRibbon, ribbonFolder } from './d1-state.js'
import { loadD1Art, isD1PixelTimeline } from './d1-state.js'
import { makeD1ShedAsides } from './d1-shed-asides'
import { moment } from './d1-state.js'
import { D1Runtime } from './d1-state.js'
import type { D1Snapshot } from './d1-runtime'
import { createD1TrimRuntime, replaceD1TrimmedResult } from './d1-state.js'
import type { D1TrimRuntime } from './d1-trim'
import { loadVisitorData, visitorArtReady, visitorCellOverlay, visitorHasWord, visitorNarrowDirection, visitorPicture, visitorWord } from './visitors-art'
import { VisitCounter, newerDue, visitorKey, readVisits, rememberVisit, visitAtSleep, visitAtWake, visitDay, visitorsOn, withVisit } from './visitors'
import type { VisitDue, VisitState } from './visitors'
import { BREATH_AFTER_MS, STICK_DEFAULT_MINUTES, STICK_END_MS, autoResume, breathCell, limitRecords, nextBreathStep, nextStickRowAt, parseFocus, playWord, stickBurning, stickOf, waitRow } from './play'
import type { LimitRecord } from './play'
import type { PlayState } from '../types'
import { COCO_ACTIONS, cocoAction, cocoBase, cocoBodySeconds, cocoHas, cocoNext, cocoPicture, cocoReady, cocoSocksWorn, cocoStill, cocoWidth, installCocoData, installCocoSocks } from './coco-motion'
import type { CocoActionKey, CocoData, CocoInput, CocoOutfit, CocoPlay, CocoSocks } from './coco-motion'
import { claudieForm, claudieReady, claudieSvg, installClaudie, pngSize } from './claudie'
import { claudieUnsaid } from './line-library'
import type { ClaudieForm } from './claudie'
import { COCO_RESTING } from './coco-stills'
import { PIXEL_SHELL_MS, pixelCells, pixelHeld, pixelNext, pixelPng, pixelStep } from './coco-pixel-play'
import type { PixelPlay } from './coco-pixel-play'
import { bagWords, loadBagWords, SOCK_PAIRS, sockMode, sockPair, socksEarned, socksOpen } from './bag'
import type { SockPair } from './bag'
import { cardsSpawned, cardsStarted, registerCards } from './cards/cards'

type Engine = EngineInterface
type Timer = { cancel: () => void }
type TimerName =
  | 'loop' | 'revert' | 'calmed' | 'blink' | 'say' | 'long' | 'sleep' | 'clingy' | 'ask' | 'poke' | 'pokeLine' | 'wakeLine' | 'burstLine' | 'touchFace' | 'wakeEnd' | 'lineSlot' | 'poseHold' | 'celebration' | 'c3Frames' | 'glance' | 'c3Shown' | 'shed' | 'helperLeave'
  | 'breathe' | 'breathCell' | 'stickEnd' | 'stickRow' | 'stickGone' | 'stickOut' | 'dragFace' | 'dragWalk' | 'pointerGlance' | 'pixelFrames' | 'firstHello'
type Shown = 'cells' | 'image' | 'svg' | null // what each mounted band draws for him

const VIEW = { plugin: 'coco', key: 'view' } as const
const BAND_WAKE = { plugin: 'coco', key: 'bandWake' } as const
// Built once: the one system-prompt section per voice level, on the session side of the cache.
const VOICE_SECTION = {
  light: { id: 'coco:voice', text: VOICE.light, scope: 'session' as const },
  full: { id: 'coco:voice', text: VOICE.full, scope: 'session' as const },
}

// Imported data modules receive explicit capabilities, never the hook's special `$`.
function bookEngine($: Engine): Engine {
  return {
    store: { get: (key: string) => $.store.get(key), set: (key: string, value: unknown) => $.store.set(key, value as never) },
    ui: {
      toast: (text: string, options?: { timeoutMs?: number }) => $.ui.toast(text, options),
      invalidate: () => $.ui.invalidate('ui.render'),
      panes:()=>$.ui.panes(),
      open:(options:Parameters<Engine['ui']['open']>[0])=>$.ui.open({id:'coco-book',title:options.title,closeOnEscape:options.closeOnEscape,focus:options.focus,...(options.rows===undefined?{}:{rows:options.rows})}),
      focus:(options:Parameters<Engine['ui']['focus']>[0])=>$.ui.focus({requestId:'coco-book',key:options.key}),
    },
    state: {
      get:(reference:Parameters<Engine['state']['get']>[0])=>reference.key==='book'?$.state.get({plugin:'coco',key:'book'}):reference.key==='view'?$.state.get(VIEW):Promise.reject(new Error('unsupported book state reference')),
      set:(reference:Parameters<Engine['state']['set']>[0],value:unknown)=>reference.key==='book'?$.state.set({plugin:'coco',key:'book'},value as never):reference.key==='view'?$.state.set(VIEW,value as never):Promise.reject(new Error('unsupported book state reference')),
    },
    session: { id: () => $.session.id(), surfaces: () => $.session.surfaces(), usage:()=>$.session.usage() },
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


function moreEngine($:Engine):Engine {
 return {
  fs:{read:(path:string)=>$.fs.read(path),write:(path:string,text:string)=>$.fs.write(path,text),exists:(path:string)=>$.fs.exists(path),stat:(path:string)=>$.fs.stat(path)},
  store:{get:(key:string)=>$.store.get(key),set:(key:string,value:unknown)=>$.store.set(key,value as never)},
  clock:{now:()=>$.clock.now(),after:(ms:number,callback:()=>unknown)=>$.clock.after(ms,callback),every:(ms:number,callback:()=>unknown)=>$.clock.every(ms,callback)},
  model:{complete:(...args:Parameters<Engine['model']['complete']>)=>$.model.complete(...args)},
  agent:{register:(...args:Parameters<Engine['agent']['register']>)=>$.agent.register(...args),spawn:(...args:Parameters<Engine['agent']['spawn']>)=>$.agent.spawn(...args),list:()=>$.agent.list()},
  tool:{register:(...args:Parameters<Engine['tool']['register']>)=>$.tool.register(...args)},
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
async function stateAvailable($: Engine): Promise<boolean> {
 return await stateProgram(stateEngine($)) !== undefined
}
async function runState($: Engine, args: string[], init?: Parameters<Engine['process']['run']>[1]) {
 const program=await stateProgram(stateEngine($))
 if (!program) return undefined
 return $.process.run([program, ...args], init)
}
function spawnState($: Engine, args: string[]): HookStream<ProcessSpawnChunk, ProcessSpawnResult> {
 let resolve!: (value: ProcessSpawnResult) => void, reject!: (error: unknown) => void
 let child: HookStream<ProcessSpawnChunk, ProcessSpawnResult> | undefined, closed=false
 const result = new Promise<ProcessSpawnResult>((yes,no)=>{resolve=yes;reject=no})
 void result.catch(()=>{})
 const stream = (async function*(): AsyncGenerator<ProcessSpawnChunk, ProcessSpawnResult> {
  try {
   const program=await stateProgram(stateEngine($))
   if (!program || closed) { const value={code:0,signal:null};resolve(value);return value }
   child = $.process.spawn({argv:[program, ...args]})
   while (true) { const chunk=await child.next();if(chunk.done){resolve(chunk.value);return chunk.value}yield chunk.value }
  } catch(error) { reject(error);throw error }
  finally { if(child)await child.return({code:0,signal:null}) }
 })()
 const close=stream.return.bind(stream), fail=stream.throw.bind(stream)
 return Object.assign(stream,{result,
  return:async(value:Parameters<typeof close>[0])=>{closed=true;reject(new Error());if(child)await child.return(value);return close(value)},
  throw:async(error:Parameters<typeof fail>[0])=>{closed=true;reject(error);if(child)await child.return({code:0,signal:null});return fail(error)},
 })
}
async function claimM1($:Engine,kind:'waiting'|'closing',at:number,cooldown:number,day?:string):Promise<boolean>{
 if(!Number.isFinite(at)||at<0)return false
 if(kind==='closing'&&(!day||!/^\d{4}-\d{2}-\d{2}$/.test(day)))return false
 try{const argv=['--claim',kind,'--now',String(Math.floor(at)),'--cooldown',String(cooldown)];if(kind==='closing')argv.push('--day',day!,'--limit','6');const result=await runState($,argv,{timeoutMs:2000});return result!==undefined&&result.exitCode===0&&JSON.parse(result.stdout).claimed===true}catch{return false}
}
// TALK-KEY 3: where the key program is and what this host is. Read only when a key action or send runs.
let talkKeyHostCache:Promise<KeyHost>|undefined
function talkKeyHost($:Engine):Promise<KeyHost>{
 talkKeyHostCache??=(async()=>{
  // Inline, as the engine follows $ only within this file.
  const platform:KeyPlatform=await $.env.get('OS').catch(()=>undefined)==='Windows_NT'?'win32':await $.fs.exists('/System/Library/CoreServices/SystemVersion.plist').catch(()=>false)?'darwin':'linux'
  // The build for this processor (libexec): Windows names it in the environment, Linux answers a uname.
  const arch=platform==='win32'?keyArch(await $.env.get('PROCESSOR_ARCHITEW6432').catch(()=>undefined)||await $.env.get('PROCESSOR_ARCHITECTURE').catch(()=>undefined))
   :platform==='linux'?await $.process.run(['/usr/bin/uname','-m'],{timeoutMs:1000}).then(r=>r.exitCode===0&&!r.isStdoutTruncated?keyArch(r.stdout.trim()):undefined,()=>undefined):undefined
  const surfaces=await $.session.surfaces().catch(()=>['terminal'])
  return{root:$.plugin.root,platform,...(arch?{arch}:{}),desktop:surfaces.includes('desktop')&&!surfaces.includes('terminal')}
 })()
 // A processor not found is asked again at the next key action.
 const asked=talkKeyHostCache
 void asked.then(host=>{if(host.platform!=='darwin'&&!host.arch&&talkKeyHostCache===asked)talkKeyHostCache=undefined})
 return asked
}
let talkKeyPriceCache:Promise<unknown[]>|undefined
/** K1's row for a Claude model by its id; no row means no dollar figure. */
function talkKeyPrice($:Engine,model:string):Promise<KeyPrice|undefined>{
 talkKeyPriceCache??=$.fs.read(joinPath($.plugin.root,'assets','prices.json')).then(text=>(JSON.parse(text) as {rows?:unknown[]}).rows??[]).catch(()=>{talkKeyPriceCache=undefined;return []})
 return talkKeyPriceCache.then(rows=>rows.find((row):row is KeyPrice=>!!row&&typeof row==='object'&&(row as {id?:unknown}).id===model))
}
// What Talk and the second look may run on: Claude Code's own model settings, which cc-switch and tools like it write
// (owner 10-17); the base URL is read for its host alone and no key is read.
async function readMoreModels($:Engine):Promise<[ReturnType<typeof moreModels>,unknown]>{
 const [base,main,haiku,sonnet,opus,haikuName,sonnetName,opusName,smallFast,custom,customName,picks]=await Promise.all([
  $.env.get('ANTHROPIC_BASE_URL'),$.env.get('ANTHROPIC_MODEL'),
  $.env.get('ANTHROPIC_DEFAULT_HAIKU_MODEL'),$.env.get('ANTHROPIC_DEFAULT_SONNET_MODEL'),$.env.get('ANTHROPIC_DEFAULT_OPUS_MODEL'),
  $.env.get('ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME'),$.env.get('ANTHROPIC_DEFAULT_SONNET_MODEL_NAME'),$.env.get('ANTHROPIC_DEFAULT_OPUS_MODEL_NAME'),
  $.env.get('ANTHROPIC_SMALL_FAST_MODEL'),$.env.get('ANTHROPIC_CUSTOM_MODEL_OPTION'),$.env.get('ANTHROPIC_CUSTOM_MODEL_OPTION_NAME'),
  $.store.get('more.models'),
 ].map(read=>Promise.resolve(read).catch(()=>undefined)))
 const text=(value:unknown)=>typeof value==='string'?value:undefined
 return [moreModels({base:text(base),main:text(main),pinned:{haiku:text(haiku),sonnet:text(sonnet),opus:text(opus)},names:{haiku:text(haikuName),sonnet:text(sonnetName),opus:text(opusName)},smallFast:text(smallFast),custom:text(custom),customName:text(customName)}),picks]
}
// The character worn reaches the More runtime's line library, which writes their lines if the row is on and none are
// kept yet in the language picked.
function syncLines($:Engine):void{
 const runtime=m1More
 if(!runtime)return
 runtime.setLinesForm(view.claudie)
 const work=runtime.lines(moreEngine($))
 if(work)void background($,'m1.lines',work)
}
// A line set's file opened in the system's text editor (his 10-17 card): TextEdit on a Mac, the default .txt program
// (Notepad) on Windows, the default editor on Linux. Each returns once the editor is asked, and the person's own
// permission rules are asked first, as a Bash command would be.
async function openInEditor($:Engine,path:string):Promise<boolean>{
 const windows=await $.env.get('OS').catch(()=>undefined)==='Windows_NT'
 const mac=!windows&&await $.fs.exists('/System/Library/CoreServices/SystemVersion.plist').catch(()=>false)
 const argv=windows?['explorer.exe',path]:mac?['open','-t',path]:['xdg-open',path]
 const verdict=await $.tool.check({tool:'Bash',input:{command:argv.map(arg=>JSON.stringify(arg)).join(' ')}}).catch(()=>undefined)
 if(verdict?.decision==='deny')return false
 // explorer.exe answers 1 when it has opened the file
 try{const run=await $.process.run(argv,{timeoutMs:10000});return windows||run.exitCode===0}catch{return false}
}
async function startM1($:Engine):Promise<void>{
 const generation=lifecycleGeneration
 if(m1Ready)return
 await loadGapWords(()=>$.fs.read(joinPath($.plugin.root,'hooks/gaps-text.json')))
 if(generation!==lifecycleGeneration)return
 const [values,agreed,today,durations,again,model,repo,home,closings,payer,savedKey,keyToday,estimateFactor]=await Promise.all([$.store.get('more'),$.store.get('more.agreed'),$.store.get('more.today'),$.store.get('runDurations'),$.store.get('voiceAskAgain'),$.session.model().catch(()=>''),$.session.repo().catch(()=>null),$.env.get('HOME'),$.store.get('closings'),$.store.get('more.payer'),$.store.get('more.key'),$.store.get('more.keyToday'),$.store.get('more.estimateFactor')])
 if(generation!==lifecycleGeneration)return
 modGaps.restoreClosings(closings)
 // A history an older version kept as command text is stored again at once, hashed (DECISIONS 594).
 if(runDurations.restore(durations))await $.store.set('runDurations',runDurations.snapshot())
 always.model=model;always.repo=repo?.root??presenceMetadata.cwd??''
 // Resumed helpers come from main's D1 board (its own agent.list); A8 keeps this process's starts.
 latest.settings={...latest.settings,voiceAskAgain:again===true,m1Always:alwaysSnapshot()}
 const runtime:MoreRuntime=new MoreRuntime(moreModelWords(MISSING_MORE_MODEL_SLOTS), {
  talkFacts:()=>({now:clockSnapshot,timeZone,working,tool:talkTool,mood:view.mood,test:talkTest,lastActiveAt:lastPromptAt||undefined}),
  // the chat's language heard the way the band hears a prompt (no model): his reply is told to answer in it (10-21)
  hearLanguage:text=>detectLanguageNow(text,[langChosen,cachedEngineSettings.language,heard,...locale]),
  debug:(step,detail)=>{diagnose($,step,undefined,detail)},
  dataFolder:()=>home?joinPath(home,'.local/share/coco/mod'):undefined,
  // the line library's files, where the person opens and edits them (his 10-17 cards)
  linesFolder:()=>home?joinPath(home,'.config/coco/lines'):undefined,
  openFile:path=>openInEditor($,path),
  characterName:character=>bagWords(view.lang)?.look?.[character]??'',
  changed:async snapshot=>{storedSettings={...storedSettings,more:snapshot.values};latest.settings={...latest.settings,...storedSettings,m1Always:alwaysSnapshot()};await writeSettingsRecord($);if(presence){await presence.settings({more:snapshot.values});await presence.quietChanged()}await syncM1Presence($);syncM1Lively($);armQuiet($);syncM1Actions();if(receivedInbox().snapshot().length){refreshReceivedLine($);await push($)}$.ui.invalidate('ui.render')},
  openBook:(page,stillCurrent)=>openM1Book(bookEngine($),page,()=>m1More===runtime&&(stillCurrent?.()??true)),
  keyHost:()=>talkKeyHost($),
  keyPrice:model=>talkKeyPrice($,model),
  opener:quiet=>talkOpener($,quiet),
  // the chat kept for the next session on this computer only, gone when Talk is switched off (owner 10-17); the pet's DM
  // window shows the same messages (dm.ts)
  remember:memory=>{void background($,'store.talkMemory',memory?$.store.set('talk.memory',memory as never):$.store.delete('talk.memory'));companionDm(true,memory?.exchanges??[]);void background($,'dm.thread',push($))},
  // The DM thread (owner's cards 10-17 late, dm.ts): her lines for a moment, the counts kept on this computer, and a new
  // message's notification in Claude Code and through the pet.
  dmLine:moment=>talkOpenerLine($,moment,dmAwayFrom||undefined),
  dmChanged:state=>{view.dm={unread:state.unread};if(!state.unread)delete view.dmNotice;void background($,'store.dm',$.store.set('dm',state as never));void background($,'dm.push',push($))},
  dmArrived:texts=>dmNotify($,texts),
  line:(text,kind,ms)=>{offerLine($,{key:kind==='safety'?'more.paste':'more.status',text,class:kind==='safety'?3:1,ttl:ms,...(kind==='safety'?{buttons:[{key:'coco:more:paste:hide',label:moreWord('paste.hide',view.lang)},{key:'coco:more:paste:keep',label:moreWord('paste.keep',view.lang)}]}:{})})},
 })
 m1More=runtime
 void background($,'store.talkOpened',(async()=>{talkOpenedBefore=(await $.store.get('talkOpened'))===true})())
 const current=()=>generation===lifecycleGeneration&&m1More===runtime
 m1More.restore(values,agreed,today,clockSnapshot);m1More.restoreKey(payer,savedKey,keyToday,estimateFactor,clockSnapshot);m1More.configure(view.lang,screenReader);configureM1Book(m1More)
 const [models,modelPicks]=await readMoreModels($)
 if(!current())return
 m1More.setModels(models,modelPicks)
 if(Object.values(m1More.values).some(value=>value===true||typeof value==='number'&&value>0))await loadMoreWords(()=>$.fs.read(joinPath($.plugin.root,'hooks/more-text.json')))
 if(!current())return
 // last session's chat, once the words that let Talk send are in
 void background($,'store.talkMemory',(async()=>{const memory=await $.store.get('talk.memory');if(!current())return;m1More?.restoreTalk(memory);if(m1More?.isOn('talk'))companionDm(true,m1More.talkMemory()?.exchanges??[])})())
 // the DM thread's counts; then she may write first, as at a prompt (they are here, back from whenever they were last)
 void background($,'store.dm',(async()=>{const value=await $.store.get('dm');if(!current())return;m1More?.restoreDm(value);if(m1More?.dm().unread)view.dm={unread:m1More.dm().unread};await dmConsider($,Math.max(lastPromptAt,lastSeen))})())
 await restoreM1Book(bookEngine($),current)
 if(!current())return
 if(m1More.isOn('look'))await m1More.registerLook(moreEngine($))
 if(!current())return
 // The line library's written sets from earlier sessions, and any still to write for the character worn (owner 10-17)
 m1More.restoreLines(await $.store.get('more.lines'))
 if(!current())return
 syncLines($)
 const seenHints=Math.max(0,Math.min(3,Math.floor(Number(await $.store.get('hintSessions'))||0)))
 if(!current())return
 hintSessions=seenHints+1;if(seenHints<3)await $.store.set('hintSessions',hintSessions)
 if(!current())return
 const usedKeys=await $.store.get('bandKeysUsed')===true
 if(!current())return
 bandKeysUsed=usedKeys
 terminalMouse=(cachedEngineSettings as Record<string,unknown>).mouse===true||(cachedEngineSettings as Record<string,unknown>).terminalMouse===true
 const turns=await optional($,'m1.turns',()=>$.session.turns(),-1),bookmark=c3?.view().bookmark
 if(!current())return
 const suggestion=await modGaps.bookmarkSuggestion({initial:true,turns,on:reminderSettings().bookmark,promptSuggestionEnabled:(cachedEngineSettings as Record<string,unknown>).promptSuggestionEnabled!==false,bookmark,now:clockSnapshot,lang:view.lang})
 if(!current())return
 // A host without prompt suggestions (or one that refuses it) must not stop M1's start: presence and the rest follow.
 if(suggestion)await optional($,'prompt.suggest',()=>$.prompt.suggest({text:suggestion}),undefined)
 if(!current())return
 await syncM1Presence($)
 if(!current())return
 // Presence is on by default, so it may have started before M1: its shared sleep deadline waited for M1 and is armed now.
 if(presence)void background($,'m1.presence.quiet',presence.quietChanged())
 syncM1Lively($)
 armQuiet($)
 m1Ready=true
}

function anyMoreOn():boolean{return !!m1More&&((['cap','paste','lively','talk','explain','look','plain'] as const).some(id=>m1More!.isOn(id))||m1More.warmOn())}
// Shared presence is on by default on every system (his card, 10-16 evening): the windows and the pet sleep and wake
// together without a setting, so a More row no longer starts or ends it.
async function syncM1Presence($:Engine):Promise<void>{
 await ensurePresence($,working);await companionChannel?.start()
}

async function reprojectHello($:Engine):Promise<void>{
 await snapshotNow($)
 const before=view.line?.id;projectLine($,false)
 if(before!==view.line?.id){const generation=lifecycleGeneration;$.clock.after(0,()=>{if(generation===lifecycleGeneration)return publish($,false,false)})}
}
function syncM1Actions():void{
 const actions:{key:string;label:string}[]=[]
 const explain=moreWord('explain.button',view.lang),look=moreWord('look.button',view.lang)
 if(explain&&m1More?.isOn('explain'))actions.push({key:'coco:more:explain',label:explain})
 if(look&&!working&&m1More?.lookAvailable())actions.push({key:'coco:more:look',label:look})
 // The DM thread's unread mark (owner's card 10-17 late: 「未读标记加系统通知」): the entry stands on the band while
 // something of hers is unseen, with the count; the thread is otherwise the bag's Talk page and /coco dm.
 const talk=m1More?.isOn('talk')===true,unread=talk?m1More!.dm().unread:0,dm=unread?moreFill(moreWord('dm.unread',view.lang),{count:String(unread)}):''
 companionDm(talk,undefined,talk?{label:moreWord('talk.label',view.lang),placeholder:moreWord('talk.placeholder',view.lang)}:undefined,talk?m1More!.dm().notify:undefined)
 if(dm)actions.push({key:'coco:dm:open',label:dm})
 if(actions.length)view.moreActions=actions;else delete view.moreActions
}
let receivedSerial=0
function refreshReceivedLine($:Engine):void {
 const note=receivedInbox().snapshot()[0]
 lineSlot.dismiss('letter.in',clockSnapshot)
 if(note){
  const label=moreWord('talk.askClaude',view.lang),marker=moreWord(RECEIVED_MARKER_SLOT,view.lang)
  offerLine($,{key:'letter.in',text:note.text,class:1,untilPrompt:true,...(label&&marker?{buttons:[{key:receivedNoteKey(note.id),label}]}:{})})
 }else projectLine($)
}
async function receiveNote($:Engine,id:string,text:string,generation:number):Promise<void> {
 // Only own approved word data is loaded on a delivery; the inbox has no poll.
 await loadMoreWords(()=>$.fs.read(joinPath($.plugin.root,'hooks/more-text.json')))
 if(generation!==lifecycleGeneration||!receivedInbox().enqueue(id,text))return
 refreshReceivedLine($);await push($);$.ui.invalidate('ui.render')
}
function alwaysSnapshot():Record<string,unknown>{return {helpers:[...always.helpers.values()],wake:always.wake??null,background:always.background,model:always.model,repo:always.repo,summary:always.summary,worktrees:[...always.worktrees.values()],added:[...always.added]}}
function publishAlways($:Engine):void {latest.settings={...latest.settings,m1Always:alwaysSnapshot()};$.ui.invalidate('ui.render')}
// The terminal's picture is the pixel version's (coco-pixel-play.ts), cells and kitty's PNG alike, and it moves
// itself when the band may move while idle. M1's old idle frames left the plugin with his go of 10-16 (DECISIONS
// 947); the More runtime still hears the idle state for its lively row.
function syncM1Lively($:Engine):void{
 const runtime=m1More
 if(!runtime)return
 runtime.syncLively(moreEngine($),{terminal:c3Surface==='terminal',awake:view.mood!=='sleep'&&!presenceState?.asleep,visible:false,idle:!working&&!limitMotionHeld()&&clockSnapshot-lastActivity>=60000,reducedMotion},()=>{})
}

// ---------------------------------------------------------------- what he is doing now

let view: View = initialView()
let reducedMotion = false
let timeZone: string | undefined
let working = false
let turnId = ''
let toolsThisTurn = 0
let failures = 0
let failedTest = false
let testedTurn = -1 // c3TurnSerial of the last test run
let wildPending = false
// The new moments (owner 10-14): a turn's first plan, and whether the last turn ended in an error.
let planSaid = false
let lastTurnErrored = false
let calmingGeneration = 0
let presenceMetadata: { cwd?: string; version: string; requestPath?: string; ribbon?:number; ribbonAt?:number; visitorDue?: VisitDue; lastPromptAt?: number } = { version: PLUGIN_VERSION }
let lastActivity = 0
// Talk's context line reads these: the main turn's current tool name (mapped to a verb there) and the last test run.
let talkTool: string | undefined
let talkTest: TalkFacts['test']
const weekTally = new WeekTally()
let lastSeen = 0
let lastQuestion = 0
let arrived = false
let startSaid = false
let offeringWarned = false
let spinnerStage = '' // the spinner's last stage this turn: requesting, thinking, responding, ...
let awaitingResponse = false // a compacted window keeps its estimate until its own first response
let askedAt = 0
// The companion app (plugin/companion, macOS) reads a feed of what he is doing. The mod writes it
// only while the companion's folder exists, and only when the record changed. A push checks
// installation too, so it can start or stop the request child even when the picture is unchanged.
let companionSent = ''
let companionWrite: Promise<void> = Promise.resolve()
// The pet's folder: Application Support on macOS, the system's usual place for the Windows and Linux pet (petFolderOf).
let companionFolder: string | undefined
let companionThere = false
let companionSupported = false
let companionLive = false
// The Windows and Linux pet's own program, which writes its shared files there (pet-program.ts; lane C, 10-16).
let petPath: string | undefined
// Off macOS: the package carries a pet build for this computer, and the engine that resolves which one (once).
let petShipped = false
let petHost: ReturnType<typeof stateEngine> | undefined
async function petResolved(): Promise<string | undefined> {
  if (petPath === undefined && petShipped && petHost) petPath = await petProgram(petHost).catch(() => undefined)
  return petPath
}
let companionId = ''
let companionChannel: CompanionChannel | undefined
let currentTask: TaskDescription | null = null
let locale: unknown[] = [] // LC_ALL, LC_MESSAGES, LANG, then the Mac's system language, as read at start
let langChosen: Lang | undefined // /coco lang, kept in $.store: wins over settings and locale
let heard: Lang | undefined // the language of the person's prompts, kept in $.store: after the setting
let hearing: Lang | undefined // the last prompt's guess, waiting for a second that agrees
let hearingQueue: Promise<void> = Promise.resolve()
const timers: Partial<Record<TimerName, Timer>> = {}
const bands = new Map<string, Shown>() // band instances by requestId
const animationRedraws = new Set<string>()
const diagnosticBands = new Map<string, string>()
let statePublishFailed = false
let publishedVersion = 0
let publishPending = 0
let lastBand: 'on' | 'compact' | 'text' = 'on'
let preferences: Promise<void> | undefined
let adoptedRestored = false
let diagnosticEnabled = false
let diagnosticChecked = -Infinity
let diagnosticChecking = false
let diagnosticKnown = false
const earlyDesktopDiagnostics: { step: string; detail: Record<string, unknown> }[] = []
let firstBand = true
const registeredAt = Date.now()
let firstDesktopReturnAt: number | undefined
const startupTimings: Record<string, number> = {}
// Local touch is a face overlay; task mood, book records and companion feed stay unchanged.
let poked: { kind: TouchKind; at: number; requestId: string; continuation?: MotionSnapshot; wakeAt?: number; line?: string; until: number; signature: number } | undefined
let pictureEpoch = 0
let pictureVariant: 0 | 1 | 2 = 0
let pictureMood: Mood = 'idle'
let pictureFrom: string | undefined
let pictureReady = false
let pictureSerial = 0
const pictureStrings = new Map<string, string>()
let wakingAt: number | undefined
// Coco's band picture (coco-motion.ts): what plays now, and their two outfits' data once read.
let cocoPlay: CocoPlay | undefined
let cocoLoad: Promise<void> | undefined
let cocoAsked = 0, cocoShown = 0 // redraws asked for, and the last one a desktop band drew them in
const COCO_ACT_MS = 12000
const COCO_VISIT_PLACE = 'translate(16.4 32) scale(1.45)' // old figure box (10,4)-(146,127) centred on theirs (42,26)-(217,228)
// the rain pane fills Coco's canvas (his viewBox -4 0 159 128 onto 0 0 234 241); the lamp keeps the visitors' scale
// and stands at the lower left on Coco's floor (his y 128 at y 227.3)
const COCO_DRESS = { pane: 'scale(1.4717 1.8828) translate(4 0)', lamp: 'translate(0 41.7) scale(1.45)' }
// the sticky note's perch sits where the lamp stands, so on Coco it moves across to the mug's right wall
const COCO_NOTE_PLACE = 'translate(166.4 32) scale(1.45)'
for (const outfit of ['A', 'B'] as const) installCocoData(COCO_RESTING[outfit] as unknown as CocoData, true)
let wakingId = ''
let ownTouchId = ''
let sharedSettings: PresenceSettings = {}
let settingEventId = ''
const mainToolCalls = new Set<string>()
let pokeClicks: number[] = []
let lastPoke = -Infinity
const pokeNext = new Map<string, number>()
let diagnostics: Promise<string | undefined> | undefined
let diagnosticWrite: Promise<void> = Promise.resolve()
let diagnosticRegistered = false
let diagnosticPending = 0
let presence: SharedPresence | undefined
let presenceReady: Promise<void> | undefined
let presenceState: PresenceSnapshot | undefined
let presenceLine: string | null = null
let presenceLineShort: string | null = null // the same line with the visitor's short name, for the two narrow places
let presenceLineEvent = ''
let presenceSpeech: PresenceSnapshot['event'] | undefined
let presenceStarting = false
let presenceDrawing = 0
let presenceLineUntil = 0
let localLineUntil = 0
let settingLineUntil = 0
let lineExpiryGeneration = 0
let motionGeneration = 0
let moodGeneration = 0
let publicationGeneration = 0
const lineSlot = new LineSlot()
const modGaps = new ModGapsRuntime()
const gapLimits = new GapLimits()
let limitStill:{epoch:number;frame:'tea-a'|'waiting';from:string}|undefined
const waitBell = new WaitSound()
let waitSoundPreviewChoice = 0
const always = new AlwaysState()
const runDurations = new RunDurations()
let m1More: MoreRuntime | undefined
let m1Ready = false
let screenReader = false
let hintSessions = 0
let bandKeysUsed = false
let terminalTouchFailed = false
let terminalMouse = false
let classicPromptSource = ''
let batchNeedsSettle=false
const m1Commands = new Map<string,{command:string;recognized:boolean}>()

const toolPoses = new ToolPoses()
let c3: C3Runtime | undefined
let notice: Notice | undefined
let c3Surface: string | null = null
let c3ReactionUntil = 0
let c3ReactionPose: View['pose'] | undefined
let c3Start: Promise<void> | undefined
let c3Started = false
let c3ThanksUntil=0
let c3HeadPose:View['pose']|undefined
let c3TurnSerial=0
type C3Shown={line?:{id:string;project:()=>Promise<void>}}
type C3ShownDefer=(callback:(now:number)=>Promise<void>)=>Timer
let c3ShownPending:C3Shown|undefined
let cost: CostRuntime | undefined
let costLoading: Promise<CostRuntime | undefined> | undefined
let costInteractive = false
let costOrigin: 'composer' | 'bridge' | 'other' = 'other'
let pendingCostStart: { origin: 'composer' | 'bridge' | 'other'; reading: unknown } | undefined
let pendingCostTTL: '5m' | '1h' | undefined
let pendingCostCrons: unknown
// A resumed chat's re-read, waiting for the cost model to know how they pay (COST-CACHE 3.8).
let pendingResumeCold: { expired?: unknown; tokens?: unknown; usd?: unknown } | undefined
let lastPromptAt = 0
// The cold moments named before they cost, once each: a resumed chat's first message, each slow /loop.
function coldNotes($: Engine): void {
  if (!cost) return
  const snapshot = cost.snapshot(), note = (key: string, text: string): void => { if (text) offerLine($, { key, text, class: 1, ttl: 14000 }) }
  if (pendingResumeCold) {
    const text = resumeColdLine(snapshot, pendingResumeCold, view.lang), hello = lineSlot.visible(clockSnapshot)
    pendingResumeCold = undefined
    // The first hello already up steps aside for it and comes back after (helloAfterCold).
    if (text && hello?.key === 'first.hello') {
      lineSlot.dismiss('first.hello', clockSnapshot); note('cold.resume', text)
      helloAfterCold($, { key: hello.key, text: hello.text, class: 2, ttl: 300000, untilPrompt: true })
    } else note('cold.resume', text)
  }
  for (const loop of cost.untoldLoops()) {
    const text = loopColdLine(snapshot, loop.everyMs, view.lang)
    if (text) { cost.toldLoop(loop.id); note('cold.loop', text) }
  }
}
// His card of 10-17 late: when the first hello and a resumed chat's cold note want the line together, the cold note
// goes first, since it helps only before the next message (14 s); the hello follows it, still once in a lifetime, and
// then holds until the person speaks or 300 s. A timer, not the slot's queue: a prompt clears a waiting line too.
let heldHello: LineRequest | undefined
function helloAfterCold($: Engine, hello: LineRequest): boolean {
  const cold = lineSlot.visible(clockSnapshot)
  if (cold?.key !== 'cold.resume' || !Number.isFinite(cold.expiresAt)) return false
  heldHello = hello
  const lifecycle = lifecycleGeneration
  stop('firstHello')
  timers.firstHello = scheduleAfter($, Math.max(0, cold.expiresAt - clockSnapshot), async () => {
    delete timers.firstHello
    const line = heldHello; heldHello = undefined
    if (!line || lifecycle !== lifecycleGeneration) return
    offerLine($, line)
    await push($)
  })
  return true
}
const cupInstances = new Map<string, boolean>()
function refreshCostView(): void {
  if (!cost) return
  const fresh = cost.snapshot()
  view.cost = fresh
  if (latest.view) latest.view = { ...latest.view, cost: fresh }
}
function costCupDrawn(e: RenderInput, tree: RenderElement): void {
  if (!cost) return
  const pending: unknown[] = [tree]
  let shown = false, walked = 0
  while (pending.length && walked++ < 1024) {
    const node = pending.pop()
    if (Array.isArray(node)) { pending.push(...node); continue }
    if (!node || typeof node !== 'object') continue
    const element = node as { props?: { key?: unknown }; children?: unknown }
    if (element.props?.key === 'coco:cache:cup' || element.props?.key === 'coco:cache:terminal' || element.props?.key === 'coco:head:cup') shown = true
    pending.push(element.children)
  }
  if (e.component === 'AssistantMessage' && e.props.onScreen === null) shown = false
  cupInstances.set(e.surface + ':' + e.requestId, shown)
  while (cupInstances.size > 64) cupInstances.delete(cupInstances.keys().next().value!)
  cost.visibility(Array.from(cupInstances.values()).some(Boolean))
}

async function ensureCost($: Engine): Promise<CostRuntime | undefined> {
  if (costLoading) return costLoading
  if (cost) return cost
  return costLoading = (async () => {
    const [shipped, words, settings, policy, values] = await Promise.all([
      $.fs.read(joinPath($.plugin.root, 'assets', 'prices.json')),
      $.fs.read(joinPath($.plugin.root, 'hooks', 'cost-text.json')),
      $.settings.read(), $.settings.read({ source: 'policy' }),
      Promise.all([
        $.env.get('CLAUDE_CODE_USE_BEDROCK'), $.env.get('CLAUDE_CODE_USE_VERTEX'),
        $.env.get('CLAUDE_CODE_USE_FOUNDRY'), $.env.get('CLAUDE_CODE_USE_MANTLE'), $.env.get('CLAUDE_CODE_USE_ANTHROPIC_AWS'),
        $.env.get('FORCE_PROMPT_CACHING_5M'), $.env.get('CLAUDE_CODE_PROMPT_CACHE_TTL'), $.env.get('ENABLE_PROMPT_CACHING_1H'),
        $.env.get('OS'), $.env.get('XDG_SESSION_ID'),
      ]),
    ])
    installCostWords(JSON.parse(words))
    const env = Object.fromEntries(['CLAUDE_CODE_USE_BEDROCK','CLAUDE_CODE_USE_VERTEX','CLAUDE_CODE_USE_FOUNDRY','CLAUDE_CODE_USE_MANTLE','CLAUDE_CODE_USE_ANTHROPIC_AWS','FORCE_PROMPT_CACHING_5M','CLAUDE_CODE_PROMPT_CACHE_TTL','ENABLE_PROMPT_CACHING_1H'].map((name, i) => [name, values[i]]))
    let lockReader: ReturnType<typeof createLockReader> | undefined
    const readLock = async () => {
      if (!lockReader) {
        const platform = values[8] === 'Windows_NT' ? 'win32' : await $.fs.exists('/System/Library/CoreServices/SystemVersion.plist').catch(() => false) ? 'darwin' : 'linux'
        lockReader = createLockReader({ now: () => clockSnapshot, platform, terminal: c3Surface === 'terminal', linuxSessionId: values[9],
          away: async () => {
            await snapshotNow($)
            // Only the Mac pet keeps the screen lock, in its health file (Health.swift); the Windows and Linux pet writes none.
            if (platform !== 'darwin') return null
            const home = await $.env.get('HOME') ?? await $.env.get('USERPROFILE')
            if (!home) return null
            const folder = joinPath(home, COMPANION_DIR)
            try { return JSON.parse(await $.fs.read(joinPath(folder, 'health.json'))).away ?? null } catch { return null }
          },
          run: async argv => { const r = await $.process.run(argv, { timeoutMs: 2000 }); return r.exitCode === 0 ? r.stdout : null },
        })
      }
      return lockReader()
    }
    // Where the screen lock can be read: the Mac terminal's own flag or the companion's away signal, a Linux login session.
    // Elsewhere keeping warm stops after 30 minutes, and their bag says so under the switch.
    const lockSeen = values[8] !== 'Windows_NT' && (companionSupported ? c3Surface === 'terminal' || companionLive : !!values[9])
    const created = new CostRuntime({ store: { get: key => $.store.get(key), set: (key, value) => $.store.set(key, value), keys: () => $.store.keys() }, lockUnseen: !lockSeen,
      saved: () => void background($, 'socks.mint', earnSocks($, 'mint')),
      now: () => clockSnapshot, after: (ms, callback) => { const timer = scheduleAfter($, ms, async () => { await snapshotNow($); callback() }); return () => timer.cancel() },
      usage: () => $.session.usage(), sessionId: () => $.session.id(), env, settings, policy, shipped: JSON.parse(shipped),
      isNewest: async () => {
        const rows = await presence?.readSessions() ?? []
        if (!rows.length || !lastPromptAt) return false
        const session = await $.session.id()
        // A tie has one deterministic winner, including simultaneous prompts.
        const newest = rows.filter(row => typeof row.lastPromptAt === 'number').sort((a, b) => b.lastPromptAt! - a.lastPromptAt! || a.session.localeCompare(b.session))[0]
        return newest?.session === session && newest.lastPromptAt === lastPromptAt
      }, readLock,
      fork: async prompt => { await snapshotNow($); const r = await $.model.fork({ prompt }); await snapshotNow($); return r.isAnswered ? { ok: true, usage: usageTokens(r.usage) } : { ok: false, ...('usage' in r ? { usage: usageTokens(r.usage) } : {}) } },
      changed: snapshot => {
        view.cost = snapshot
        if (latest.view) latest.view = { ...latest.view, cost: snapshot }
        redraw($, 'cost')
        if (Array.from(cupInstances.values()).some(Boolean)) globalBandRedraw($)
      },
    })
    created.setInteractive(costInteractive)
    await created.refreshPrices()
    while (pendingCostStart) {
      const pending = pendingCostStart
      pendingCostStart = undefined
      await created.turnStart(pending.origin, pending.reading)
    }
    if (pendingCostTTL) created.ttlEvidence(pendingCostTTL)
    if (pendingCostCrons !== undefined) created.cronsChanged(pendingCostCrons)
    cost = created
    coldNotes($)
    return created
  })().catch(error => { costLoading = undefined; caught($, 'cost.setup', error); return undefined })
}
const c3Branches=new Map<string,Promise<string|undefined>>()
let d1:D1Runtime|undefined,d1Ready:Promise<void>|undefined,d1Epoch=0,d1Session='',d1Home='',d1LongSaid=''
let d1ShedAsides:Readonly<Record<string,string>>|undefined
let d1Trim:D1TrimRuntime|undefined,d1TrimReady:Promise<void>|undefined
let d1CopySurface:'terminal'|'desktop'|'vscode'|'mobile'='terminal'
let d1GlanceAt=-Infinity,d1CompactSerial=0,d1RowsFirst=false,d1PresenceKnown=false
let d1ShedPrevious:FrameName='idle-reading'
const d1Spawns=new Map<string,string>()
let planeBatch={n:0,failed:false} // the paper planes out since none was flying, and whether one came back failed or stopped
async function ensureD1($:Engine):Promise<void>{
 if(d1Ready)return d1Ready
 const own=d1Epoch
 const starting=loadD1Words(()=>$.fs.read(joinPath($.plugin.root,'hooks/d1-words.json'))).then(()=>{if(own===d1Epoch)d1??=new D1Runtime()}).catch(error=>caught($,'d1.start',error)).finally(()=>{if(d1Ready===starting)d1Ready=undefined})
 d1Ready=starting;return starting
}
function d1Sync($:Engine):void{
 if(view.play)view.play={...view.play,at:clockSnapshot}
 d1?.removeLeaving(clockSnapshot)
 const state:D1Snapshot=d1?.snapshot()??{helpers:[],earlier:{count:0,tokens:0},totalTokens:0,mainHelpers:0,runningHelpers:0}
 view.d1ReducedMotion=reducedMotion
 if(view.ribbon)view.ribbon={...view.ribbon,elapsed:Math.max(0,clockSnapshot-(view.ribbon.tiedAt??clockSnapshot)),alt:d1Word(view.lang,'ribbon.alt',{folder:view.ribbon.folder})}
 if(state.shed?.phase==='end'&&clockSnapshot-state.shed.at>=1600&&view.mood==='snake'){view.mood=working?'think':'idle';view.frame=STILL[view.mood]}
 const helpers=[...state.helpers,...(state.overflowHelpers??[])].filter(h=>!h.parentAgentId&&(h.state==='running'||h.leavingAt!==undefined)).map(h=>({id:h.agentId,state:h.state,at:h.startedAt,arrivalAt:h.arrivalAt,leavingAt:h.leavingAt,elapsed:Math.max(0,clockSnapshot-h.startedAt)}))
 const chronological=(a:typeof helpers[number],b:typeof helpers[number])=>a.at-b.at||(a.arrivalAt??a.at)-(b.arrivalAt??b.at)||a.id.localeCompare(b.id)
 helpers.sort(chronological)
 const rest=helpers.slice(3)
 view.helpers=[...helpers.slice(0,3),...rest.filter(h=>h.state==='running'),...rest.filter(h=>h.state!=='running')].slice(0,64).sort(chronological)
 view.helpersCount=state.mainHelpers;view.helpersAlt=d1Word(view.lang,'helpers.alt',{n:state.mainHelpers},state.mainHelpers);view.helpersCountText=d1Word(view.lang,'helpers.count',{n:state.mainHelpers},state.mainHelpers)
 if(state.shed&&state.shed.phase!=='skip')view.shed=state.shed;else delete view.shed
 const shed=state.shed&&(state.shed.phase==='begin'||state.shed.phase==='end'&&clockSnapshot-state.shed.at<1600)||view.line?.key==='shed.first'
 if(shed)view.stageDirection=(d1Word(view.lang,'aside.shed')??'').replace(/\*/g,'') || (d1ShedAsides?.[view.lang]??d1ShedAsides?.en??'').replace(/\*/g,'')
 else if(!working&&state.runningHelpers>0)view.stageDirection=d1Word(view.lang,'aside.helpers').replace(/\*/g,'')
 else{const aside=playAside();if(aside)view.stageDirection=aside.replace(/\*/g,'');else delete view.stageDirection}
 setD1BookSnapshot(state,presenceState?.asleep??view.mood==='sleep',working,bookEngine($))
}
async function ensureD1Trim($:Engine):Promise<void>{
 if(d1Trim)return
 if(d1TrimReady)return d1TrimReady
 const generation=lifecycleGeneration
 const starting:Promise<void>=(async()=>{
 const [home,profile,os,xdg,mac,id]=await Promise.all([$.env.get('HOME'),$.env.get('USERPROFILE'),$.env.get('OS'),$.env.get('XDG_STATE_HOME'),$.fs.exists('/System/Library/CoreServices/SystemVersion.plist'),$.session.id()])
 const ownHome=homePath(home,profile),root=ownHome?presenceFolder(ownHome,mac,xdg):undefined
 if(!root||generation!==lifecycleGeneration)return
 if(generation!==lifecycleGeneration)return
 d1Trim=createD1TrimRuntime({dataRoot:root,workerPath:joinPath($.plugin.root,'hooks/d1-trim-worker.mjs'),home:ownHome,platform:isWindows(os,home,profile)?'win32':mac?'darwin':'linux',now:()=>clockSnapshot,lang:()=>view.lang,enabled:()=>reminderSettings(storedSettings).trim,readWords:()=>$.fs.read(joinPath($.plugin.root,'hooks/d1-words.json')),process:(argv,options)=>$.process.run(argv,options),copy:async text=>(await $.ui.copy({text,surface:d1CopySurface})).isCopied})
 d1Trim.start(id)
 })().catch(error=>caught($,'d1.trim.start',error)).finally(()=>{if(d1TrimReady===starting)d1TrimReady=undefined})
 d1TrimReady=starting;return starting
}
let d1ShedArmedAt=NaN,d1ShedArmedSerial=-1
const d1DesktopShedTimelines=new Map<string,{epoch:number;serial:number;at:number}>()
function holdsD1DesktopShed(serial:number,own:number):boolean{
 const state=d1?.snapshot().shed,mounted=[...bands].filter(([,shown])=>shown)
 if(own!==d1Epoch||serial!==d1CompactSerial||state?.phase!=='end'||view.band!=='compact'||view.mood!=='snake'||view.pose||reducedMotion||!['image-css','interactive-css'].includes(ANIMATION_MODE)||!mounted.length)return false
 return mounted.every(([requestId,shown])=>{const held=d1DesktopShedTimelines.get(requestId);return shown==='svg'&&held?.epoch===own&&held.serial===serial&&held.at===state.at})
}
function noteD1DesktopShedTree(requestId:string,tree:RenderElement,full:boolean,drawn:View):void{
 d1DesktopShedTimelines.delete(requestId)
 if(!full||drawn.band!=='compact'||drawn.shed?.phase!=='end'||reducedMotion||!['image-css','interactive-css'].includes(ANIMATION_MODE))return
 const nodes=(node:unknown):RenderElement[]=>Array.isArray(node)?node.flatMap(nodes):node&&typeof node==='object'?[node as RenderElement,...nodes((node as {children?:unknown}).children)]:[]
 const picture=nodes(tree).find(node=>node.type==='Box'&&node.props?.key==='coco:picture')
 const svg=picture&&nodes(picture).find(node=>node.type==='Svg')
 if(svg?.type==='Svg'&&isD1PixelTimeline(svg.props.source))d1DesktopShedTimelines.set(requestId,{epoch:d1Epoch,serial:d1CompactSerial,at:drawn.shed.at})
 while(d1DesktopShedTimelines.size>32)d1DesktopShedTimelines.delete(d1DesktopShedTimelines.keys().next().value!)
}
async function blitD1Shed($:Engine,serial:number,own:number):Promise<boolean>{
 const active=()=>own===d1Epoch&&serial===d1CompactSerial&&view.band!=='off'
 const mounted=[...bands].filter(([,shown])=>shown)
 if(!active()||!mounted.length||mounted.some(([,shown])=>shown!=='image'&&shown!=='cells')||view.mood!=='snake'||view.pose)return false
 const state=d1?.snapshot().shed
 if(state?.phase!=='end')return false
 for(const [requestId,shown] of mounted){
  if(!active()||bands.get(requestId)!==shown)return false
  const now=terminalPixelNow(present(view))
  const result=await $.ui.blit(shown==='image'
   ? {requestId,key:'sprite',source:{png:now.png}}
   : {requestId,key:'sprite',cells:now.cells})
   .catch(()=>({deny:'unavailable'}))
  if(!active()||bands.get(requestId)!==shown||result.deny)return false
 }
 return true
}
function d1ShedDeadline($:Engine,serial:number):void{
 const state=d1?.snapshot().shed
 if(state?.phase!=='end'||serial!==d1CompactSerial||!spriteOnScreen()||view.band==='off'){d1DesktopShedTimelines.clear();stop('shed');return}
 const elapsed=clockSnapshot-state.at,edge=(c3Surface==='terminal'?[160,360,960,1600]:[1600]).find(n=>n>elapsed) // the desktop band's shell clip plays by itself (Coco); the terminal still steps its cuts
 if(edge===undefined){d1DesktopShedTimelines.clear();stop('shed');return}
 const deadline=state.at+edge,own=d1Epoch
 const current=()=>own===d1Epoch&&serial===d1CompactSerial&&view.band!=='off'
 if(timers.shed&&d1ShedArmedAt===deadline&&d1ShedArmedSerial===serial)return
 stop('shed');d1ShedArmedAt=deadline;d1ShedArmedSerial=serial
 timers.shed=scheduleAfter($,edge-elapsed,async()=>{delete timers.shed;await snapshotNow($);if(own!==d1Epoch)return;const priorPictureSerial=pictureSerial;if(serial!==d1CompactSerial||view.band==='off'||!spriteOnScreen())return;pictureSerial++;if(edge===1600){d1DesktopShedTimelines.clear();await setMood($,working?'think':'idle');await updatePose($)}const cssHeld=edge<1600&&holdsD1DesktopShed(serial,own);if(cssHeld)pictureSerial=priorPictureSerial;const blitted=edge<1600&&!cssHeld&&await blitD1Shed($,serial,own);if(!current())return;if(!cssHeld&&!blitted){rebuildDesktopPictures($,false);await push($)}d1ShedDeadline($,serial)})
}
async function d1Long($:Engine):Promise<void>{
 const task=d1?.snapshot().longTask,mode=reminderSettings(storedSettings).longTask
 if(!task||task.id===d1LongSaid||mode==='off')return
 d1LongSaid=task.id;openerEvents.bigJob=clockSnapshot
 const duration=durationText(task.durationMs/1000,view.lang,c3Durations(view.lang),false),time=moment(new Date(task.completedAt).toISOString(),clockSnapshot,view.lang,timeZone)
 const folder=view.ribbon?.folder??ribbonFolder(presenceMetadata.cwd??'',d1Home)
 view.longTask={...task,mode,quiet:true,title:WORDS[view.lang].name,body:d1Word(view.lang,'long.notify',{folder,duration}),thread:folder,...(c3Surface==='desktop'?{targetBundleID:'com.anthropic.claudefordesktop'}:c3Surface==='vscode'?{targetBundleID:'com.microsoft.VSCode'}:{})}
 if(c3Visible())offerLine($,{id:'long:'+task.id,key:'long.done',text:d1Word(view.lang,'long.done',{time,duration}),class:1,once:true,ttl:14400000,untilPrompt:true,slots:[{value:time,kind:'value'},{value:duration,kind:'value'}]})
}
async function d1Finished($:Engine,id:string,state:'done'|'failed'|'stopped',totals?:{tokens?:number;durationMs?:number;toolUses?:number}):Promise<void>{
 const own=d1Epoch,runtime=d1;if(!runtime)return
 await snapshotNow($);if(own!==d1Epoch||runtime!==d1)return;const before=JSON.stringify(runtime.snapshot());runtime.finish(id,clockSnapshot,state,totals)
 if(before===JSON.stringify(runtime.snapshot()))return
 if(state==='done'){vibeSession.back++;cocoAct('catch')} // the plane flies back and they catch it
 // every paper plane of a batch back, none failed or stopped: their taro pair the first time (owner 10-15)
 if(state!=='done')planeBatch.failed=true
 if(runtime.snapshot().runningHelpers===0){const whole=planeBatch.n>0&&!planeBatch.failed;planeBatch={n:0,failed:false};if(whole)void background($,'socks.taro',earnSocks($,'taro'))}
 await d1Long($);if(own!==d1Epoch)return;presenceActivity($);await updatePose($);await push($)
 $.ui.invalidate('ui.render')
 d1HelperDeadline($)
}
let d1HelperArmedAt=NaN,d1HelperArmedEpoch=-1
function d1HelperDeadline($:Engine):void{
 if(!spriteOnScreen()||view.band==='off'){stop('helperLeave');return}
 const state=d1?.snapshot(),deadline=Math.min(...[...(state?.helpers??[]),...(state?.overflowHelpers??[])].filter(h=>!h.parentAgentId&&h.leavingAt!==undefined).map(h=>h.leavingAt!+240))
 if(!Number.isFinite(deadline)){stop('helperLeave');return}
 const own=d1Epoch
 if(timers.helperLeave&&d1HelperArmedAt===deadline&&d1HelperArmedEpoch===own)return
 stop('helperLeave');d1HelperArmedAt=deadline;d1HelperArmedEpoch=own
 timers.helperLeave=scheduleAfter($,Math.max(0,deadline-clockSnapshot),async()=>{delete timers.helperLeave;await snapshotNow($);if(own!==d1Epoch||view.band==='off'||!spriteOnScreen())return;d1?.removeLeaving(clockSnapshot);await push($);d1HelperDeadline($)})
}
async function d1Ribbon($:Engine,state?:PresenceSnapshot):Promise<void>{
 if(!d1Session){d1Session=await $.session.id();d1Home=homePath(await $.env.get('HOME'),await $.env.get('USERPROFILE'))??''}
 const live=state?.sessions??[],other=live.filter(row=>row.session!==d1Session)
 let index=presenceMetadata.ribbon
 if(index===undefined){const raw=await $.store.get('ribbons'),map=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Record<string,number>:{};index=selectRibbon(map[presenceMetadata.cwd??''],other.flatMap(c=>c.ribbon===undefined?[]:[c.ribbon]));presenceMetadata.ribbon=index;presenceMetadata.ribbonAt=clockSnapshot;const next=rememberRibbon(map,presenceMetadata.cwd??'',index);if(JSON.stringify(next)!==JSON.stringify(map))await $.store.set('ribbons',next)}
 else {const selected=reconcileRibbon({id:d1Session,at:presenceMetadata.ribbonAt??0,ribbon:index},other.flatMap(c=>c.ribbon===undefined?[]:[{id:c.session,at:c.ribbonAt??0,ribbon:c.ribbon}]));if(selected!==index){index=selected;presenceMetadata.ribbon=index;presenceActivity($)}}
 const visible=other.length>=1,before=view.ribbon?.visible===true,gained=visible&&!before&&d1PresenceKnown&&view.band!=='off'&&spriteOnScreen()
 if(gained){const own=d1Epoch;await snapshotNow($);if(own!==d1Epoch||state&&presenceState!==state)return}
 if(visible){const own=d1Epoch;await ensureD1($);await loadD1Art('ribbon',path=>$.fs.read(joinPath($.plugin.root,path)));if(own!==d1Epoch||state&&presenceState!==state)return}
 if(state)d1PresenceKnown=true
 view.ribbon={index,visible,folder:ribbonFolder(presenceMetadata.cwd??'',d1Home),...(gained?{tiedAt:clockSnapshot}:before&&visible&&view.ribbon?.tiedAt!==undefined?{tiedAt:view.ribbon.tiedAt}:{})}
 if(gained&&clockSnapshot-d1GlanceAt>=1800000){
  const own=d1Epoch,activeRibbon=()=>own===d1Epoch&&view.band!=='off'&&spriteOnScreen();await startC3($);if(!activeRibbon())return
  if(!c3?.onceSaid('twoFirst'))offerLine($,{key:'two.first',text:d1Word(view.lang,'two.first'),class:0,ttl:14000,onShown:()=>c3?.markOnce('twoFirst')},false)
  const base=view.pose?.frame??view.frame,pixel=c3Surface==='terminal'||view.band==='compact'
  // ART A2: tie the ribbon without borrowing a face from another tool's base (the static face table, so the old
  // figure's picture data need not be read for it).
  if(!motionHasFace(base,'glance',pixel))return
  d1GlanceAt=clockSnapshot
  view.companionPose=view.pose??null
  const pose:NonNullable<View['pose']>={name:'ribbon-glance',frame:base,aside:view.pose?.aside??WORDS[view.lang].aside[view.mood],at:clockSnapshot};view.pose=pose
  stop('glance');timers.glance=scheduleAfter($,Math.max(0,pose.at+720-clockSnapshot),async()=>{delete timers.glance;if(own===d1Epoch&&view.pose===pose){delete view.pose;await updatePose($);await push($)}})
 }
}

// The surfaces that draw the desktop's painted band: the desktop app, VS Code and the phone (owner 10-19, DECISIONS 1044, 1045).
const paintedBand = (surface: string | null): surface is 'desktop' | 'vscode' | 'mobile' => surface === 'desktop' || surface === 'vscode' || surface === 'mobile'
function c3Visible(): boolean { return view.band !== 'off' && (c3Surface === 'terminal' || bandShownOn(c3Surface ?? '', view.band)) }
function clearCompanionLine(where:'prompt'|'turn'|'all',callId?:string):void {
  const prior=view.companionLine
  if(prior&&(where==='all'||where==='prompt'&&prior.untilPrompt===true||callId!==undefined&&prior.callId===callId))view.companionLine=null
}
function projectLine($: Engine, rearm = true): void {
  const before=view.line,line=lineSlot.visible(clockSnapshot)
  if(line?.key==='two.first') {
    if(before?.id!==line.id)view.companionLine=before&&before.key!=='two.first'&&(!before.expiresAt||before.expiresAt>clockSnapshot)?before:null
    else if(view.companionLine?.expiresAt&&view.companionLine.expiresAt<=clockSnapshot)view.companionLine=null
  } else delete view.companionLine
  const headLimitVisible=c3Surface!==null&&c3Surface!=='terminal'&&!c3Visible()
  gapLimits.visible(line?.key??(headLimitVisible?gapLimits.current(clockSnapshot)?.request.key:undefined)); view.spentWindows=[...gapLimits.out()];view.spentResets=Object.fromEntries(gapLimits.burned().map(w=>[w.kind,w.resetsAt]))
  if (line) view.line = { id:line.id,key:line.key,text:line.text,class:line.class,slots:line.slots,button:line.button,buttons:line.buttons,callId:line.callId,expiresAt:Number.isFinite(line.expiresAt)?line.expiresAt:0 }
  else delete view.line
  if(rearm)expireLines($,clockSnapshot)
}
function languageChangeLimit($: Engine): void {
  const limit=gapLimits.display(clockSnapshot,view.lang,kind=>WORDS[view.lang].quota.kinds[kind]??kind,timeZone)
  if(!limit)return
  if(lineSlot.replaceText(limit.request.key,limit.request.text,limit.request.slots))projectLine($,false)
  if(view.pose?.frame===limit.frame)view.pose.aside=limit.frame==='waiting'?WORDS[view.lang].aside.waiting:c3Word(view.lang,'aside.tea')
}
function offerLine($: Engine, line: LineRequest, shouldPublish = true, rearm = true): 'shown'|'queued'|'dropped' {
  // Claudie and maid Claudie leave Coco's chatter unsaid; reminders still show (owner 10-17, claudie-lines.ts)
  if(view.claudie&&claudieUnsaid(line))return 'dropped'
  if(!c3Visible()) {
    // Guardians ride notice(), never a toast; every other note has the approved 12-second toast.
    if(line.callId)return 'dropped'
    if(line.valid?.()===false||lineSlot.muted&&line.class===0)return 'dropped'
    $.ui.toast(line.text,{timeoutMs:12000});modGaps.lineShown(line.class);line.onShown?.();return 'shown'
  }
  const prior=lineSlot.visible(clockSnapshot),before=prior?.id
  const shown=line.onShown;line={...line,onShown:()=>{modGaps.lineShown(line.class);shown?.()}}
  const result=lineSlot.offer(line,clockSnapshot)
  projectLine($,rearm)
  if(line.key==='two.first'&&result==='shown'&&before!==view.line?.id&&view.companionLine)view.companionLine={...view.companionLine,untilPrompt:prior?.id===view.companionLine.id&&prior.untilPrompt===true}
  if(shouldPublish&&before!==view.line?.id)void background($,'c3.line',push($))
  return result
}
// Talk opening up on its own (talk-openers.ts): the group for right now, one of lane B's lines for it (never the same one
// twice running), its slots filled. The first opening is written down, so it is only ever the first once.
const openerEvents:Partial<Record<OpenerEvent,number>>={},openerLast=new Map<OpenerGroup,number>()
let talkOpenedBefore:boolean|undefined,openerFailed=0
function openerQuota():'low'|'out'|undefined {
  const used=(view.quota?.rateLimits??[]).map(limit=>limit.percentUsed).filter((p):p is number=>typeof p==='number'&&Number.isFinite(p))
  return used.some(p=>p>=100)?'out':used.some(p=>p>75)?'low':undefined
}
function talkOpener($:Engine,quiet:boolean):string|undefined {
  const now=clockSnapshot,lastActiveAt=Math.max(lastPromptAt,lastSeen)||undefined
  const quota=openerQuota()
  const group:OpenerGroup=quiet?'quiet':openerGroup({now,timeZone,first:talkOpenedBefore===false,...(lastActiveAt?{lastActiveAt}:{}),events:openerEvents,...(quota?{quota}:{})})
  return talkOpenerLine($,group,lastActiveAt)
}
/** One of lane B's talk.open.<group> lines with its slots filled, never the one said last from that group. */
function talkOpenerLine($:Engine,group:OpenerGroup,lastActiveAt=Math.max(lastPromptAt,lastSeen)||undefined):string|undefined {
  const now=clockSnapshot,lang=view.lang
  const lines:string[]=[]
  for(let i=0;i<10;i++){const text=moreWord(`talk.open.${group}.${i}`,lang);if(!text)break;lines.push(text)}
  const at=openerPick(lines,openerLast.get(group))
  if(at===undefined)return undefined
  openerLast.set(group,at)
  if(talkOpenedBefore===false){talkOpenedBefore=true;void background($,'store.set.talkOpened',$.store.set('talkOpened',true))}
  const away=lastActiveAt?durationText(Math.max(60,(now-lastActiveAt)/1000),lang,c3Durations(lang),false):''
  return moreFill(lines[at]!,{time:clockText(now,lang,timeZone),away})
}
// She may write first while the DM thread is closed (dm.ts): at the person's prompt and when the session starts (they are
// here, back from `lastActiveAt`), and at the end of a turn (nobody came back then); never while she is asleep.
let dmAwayFrom=0,dmTurnEndAt=0
async function dmConsider($:Engine,lastActiveAt?:number):Promise<void>{
  const runtime=m1More,asleep=()=>view.mood==='sleep'
  if(!runtime?.isOn('talk')||asleep())return
  await loadMoreWords(()=>$.fs.read(joinPath($.plugin.root,'hooks/more-text.json')))
  // Another window may have written since: her pace and the person's choices are this computer's, the unread this thread's.
  const stored=await optional($,'store.dm',()=>$.store.get('dm'),undefined)
  if(m1More!==runtime||asleep())return
  runtime.shareDm(stored)
  const quota=openerQuota()
  dmAwayFrom=lastActiveAt??0
  try{await runtime.dmFirst(moreEngine($),{now:clockSnapshot,timeZone,first:false,...(lastActiveAt?{lastActiveAt}:{}),events:openerEvents,...(quota?{quota}:{})})}
  finally{dmAwayFrom=0}
}
// A DM that reached the closed thread: a toast in Claude Code and, through the pet, the system's notification, unless
// the person turned notifications off or she is asleep (the pet also holds it while the screen is locked).
function dmNotify($:Engine,texts:string[]):void{
  if(!m1More?.dm().notify||view.mood==='sleep'||!texts.length)return
  // Titled as a chat app titles it, «New message from Coco» (his words, via lane B), her words under it.
  const title=moreWord('dm.notice',view.lang)||WORDS[view.lang].name,body=dmPreview(texts.join(' '))
  if(!body)return
  // Answering what the person wrote on the pet: the pet shows it (or notifies, its window closed); Claude Code stays quiet.
  if(clockSnapshot>=dmPetUntil)void background($,'dm.toast',Promise.resolve($.ui.toast(`${title}: ${body}`,{timeoutMs:12000})))
  view.dmNotice={id:`dm:${clockSnapshot}`,at:clockSnapshot,title,body}
}
// The person wrote in the pet's DM window (owner's card 10-17 late: read or reply on either): the same thread as the
// bag's, on the same payer, through Talk's own guards. Refused while Talk is off or she is still answering.
let dmPetUntil=0
function dmFromPet($:Engine,text:string):boolean{
  const runtime=m1More
  if(!runtime?.isOn('talk'))return false
  const sent=runtime.talk(moreEngine($),text,clockSnapshot)
  if(!sent)return false
  dmPetUntil=clockSnapshot+120_000
  void background($,'dm.pet',sent.then(()=>push($)))
  return true
}
function c3Changed($: Engine): void {
  if(!c3)return
  const before=JSON.stringify([view.hotWindows,view.paceDetails,view.paceRates,view.neighbourBusyLabel,view.line])
  const state=c3.view()
  view.hotWindows=state.pace.map(p=>p.kind)
  if(Object.keys(state.rates).length)view.paceRates=state.rates;else delete view.paceRates
  view.paceDetails=state.pace.map(p=>{const t=durationText(Math.max(1,(p.exhaustionAt-clockSnapshot)/1000),view.lang,c3Durations(view.lang),false);return {kind:p.kind,t,wide:fill(c3Word(view.lang,'quota.pace.wide'),{t:'~'+t})??'',narrow:fill(c3Word(view.lang,'quota.pace.narrow'),{t:'~'+t})??''}})
  view.neighbourBusyLabel=c3Word(view.lang,'neighbour.busy')
  setC3BookSnapshot({pace:state.pace,bookmark:state.bookmark,neighbours:view.neighbourLights,vibe:{...state.tests,...vibeFacts()}})
  if((state.tests.failed??0)>openerFailed)openerEvents.red=clockSnapshot
  openerFailed=state.tests.failed??0
  projectLine($)
  if(before!==JSON.stringify([view.hotWindows,view.paceDetails,view.paceRates,view.neighbourBusyLabel,view.line]))void background($,'c3.changed',push($))
}
function runtimeC3($: Engine): C3Runtime {
  return c3??=createC3Runtime({
    get:key=>$.store.get(key),set:(key,value)=>$.store.set(key,value as never),remove:key=>$.store.delete(key),
    process:(argv,options)=>$.process.run(argv,options),now:()=>clockSnapshot,lang:()=>view.lang,
    settings:()=>reminderSettings(),localDay:at=>localDay(at,timeZone),
    windowName:kind=>WORDS[view.lang].quota.kinds[kind]??kind,
    emit:line=>offerLine($,line.key.startsWith('guard.')?{...line,onShown:()=>{line.onShown?.();void background($,'socks.whitehat',earnSocks($,'whitehat'))}}:line),reaction:event=>c3React($,event),notice:(id,text)=>{if(text!==undefined)void background($,'socks.whitehat',earnSocks($,'whitehat'));return $.ui.notice(id,text)},
    readWords:()=>$.fs.read(joinPath($.plugin.root,'hooks/c3-text.json')),workerPath:joinPath($.plugin.root,'hooks/algo-worker.mjs'),
    changed:()=>c3Changed($),diagnostic:code=>diagnose($,code),
  })
}
function runtimeNotice($: Engine): Notice {
  if (notice) return notice
  notice = createNotice({
    get:key=>$.store.get(key),set:(key,value)=>$.store.set(key,value as never),remove:key=>$.store.delete(key),
    process:(argv,options)=>$.process.run(argv,options),now:()=>clockSnapshot,lang:()=>view.lang,localDay:at=>localDay(at,timeZone),
    marks:async()=>latest.marks??marksFrom(await $.store.get('marks').catch(()=>undefined)),settings:()=>reminderSettings(),
    root:async()=>(await $.session.repo().catch(()=>null))?.root??presenceMetadata.cwd,
    screenReader:async()=>{const flag=await $.env.get('CLAUDE_AX_SCREEN_READER');return flag==='1'?true:flag==='0'?false:(await $.settings.read() as Record<string,unknown>).axScreenReader===true},
    workerPath:joinPath($.plugin.root,'hooks/notice-worker.mjs'),readWords:()=>$.fs.read(joinPath($.plugin.root,'hooks/c3-text.json')),
    changed:()=>$.ui.invalidate('ui.render'),diagnostic:code=>diagnose($,code),
    emit:line=>c3Visible()?offerLine($,line.key==='commit.praise'?{...line,onShown:()=>void background($,'socks.blueberry',earnSocks($,'blueberry'))}:line):'dropped',dismiss:key=>{lineSlot.dismiss(key,clockSnapshot);projectLine($)},
    committed:()=>{vibeSession.commits++},
    react:kind=>{
      if(kind==='stuck'){c3React($,{kind:'neighbour'});return}
      void background($,'notice.react',setMood($,kind==='hair'?'wild':'happy',kind==='hair'?280:kind==='praise'?1400:1720))
    },
    // Not drawn in screen-reader mode: the engine's own list is the accessible one.
    place:place=>{void background($,'notice.place',(async()=>{
      if(place&&!await notice?.screenReader()){const say=(key:string)=>notice?.word(key,{i:place.i,n:place.n,subject:place.subject}),short=say('tasks.short'),text=say('tasks.place'),alt=say('tasks.alt');view.place={...place,...(short?{short}:{}),...(text?{text}:{}),...(alt?{alt}:{})}}
      else delete view.place
      await push($)
    })())},
    // Coco's picture has no bow to loosen (the keycap hairclip comes off in frames of Coco's own); a bow in the costume only names the band's stage direction.
    costume:costume=>{
      if(!costume.rain)rainSince=undefined;else if(!view.costume?.rain)rainSince=clockSnapshot
      if(Object.keys(costume).length)view.costume=costume;else delete view.costume
      void background($,'notice.costume',push($))
    },
    after:(ms,run)=>scheduleAfter($,ms,run),
  })
  setNotice(notice)
  return notice
}
async function startC3($:Engine):Promise<void> {
  if(c3Start)return c3Start
  c3Start=(async()=>{
    await hydrate($);await snapshotNow($)
    const [turns,home,tmpdir]=await Promise.all([$.session.turns(),$.env.get('HOME'),$.env.get('TMPDIR')])
    await runtimeC3($).start({cwd:presenceMetadata.cwd??'',turns:turns,home,tmpdir})
    c3Started=true;c3Changed($)
  })().catch(error=>caught($,'c3.start',error))
  return c3Start
}
// SPEC 2.2: reduced motion holds the first drawing; resuming motion keeps the absolute celebration phase.
function syncCelebrationAside():boolean {
  const pose=c3ReactionPose
  if(!pose||clockSnapshot>=c3ReactionUntil)return false
  const smile=pose.at+((pose.celebration??1)>=3?2933:1933)
  const aside=reducedMotion||clockSnapshot<smile?c3Word(view.lang,'aside.cheer'):WORDS[view.lang].aside.happy
  if(pose.aside===aside)return false
  pose.aside=aside;return true
}
function c3React($:Engine,event:C3Reaction):void {
  const now=clockSnapshot
  if(event.kind==='green'||event.kind==='green_after_reds'){openerEvents.green=now;weekTally.greenRun();void background($,'socks.matcha',earnSocks($,'matcha'))}
  if(event.kind==='bookmark'){void background($,'c3.bookmark',setMood($,'snake',3600));return}
  if(event.kind==='thanks'){c3ThanksUntil=now+1600;void background($,'c3.thanks',setMood($,'flustered',1600).then(()=>say($,'praised')));return}
  if(event.kind==='error'){void background($,'c3.error',setMood($,'error',1600));return}
  if(event.kind==='neighbour'){
    const held=view.pose,lifecycle=lifecycleGeneration
    const glance:NonNullable<View['pose']>={name:'glance',frame:held?.frame??view.frame,aside:held?.aside??WORDS[view.lang].aside[view.mood],at:now}
    view.pose=glance
    stop('glance')
    void background($,'c3.glance',push($))
    const timer=scheduleAfter($,450,async()=>{
      if(lifecycle!==lifecycleGeneration||timers.glance!==timer)return
      delete timers.glance
      if(view.pose!==glance)return
      await updatePose($)
      if(lifecycle===lifecycleGeneration)await push($)
    })
    timers.glance=timer;return
  }
  const reds=event.reds??1,big=reds>=3
  c3ReactionUntil=now+(big?5500:3300)
  c3ReactionPose={name:'cheer',frame:'cheer-a',aside:c3Word(view.lang,'aside.cheer'),at:now,celebration:reds}
  view.pose=c3ReactionPose
  const calming=timers.calmed!==undefined
  stop('celebration');stop('revert')
  void background($,'c3.cheer',push($))
  // SPEC 2.2 / tools/g_tests.py105: the smile owns its authored direction, without restarting recovery.
  const reaction=c3ReactionPose,end=c3ReactionUntil,lifecycle=lifecycleGeneration
  const active=()=>c3ReactionPose===reaction&&lifecycle===lifecycleGeneration
  const finish=async()=>{if(!active())return;delete timers.celebration;c3ReactionPose=undefined;c3ReactionUntil=0;await updatePose($);if(lifecycle===lifecycleGeneration)await push($)}
  timers.celebration=scheduleAfter($,big?2933:1933,async()=>{
    if(!active())return
    delete timers.celebration
    const changed=syncCelebrationAside()
    timers.celebration=scheduleAfter($,Math.max(0,end-clockSnapshot),finish)
    if(changed)await push($)
  })
  if(calming)scheduleCalmed($,big?5500:3300)
}
function underlyingCompanionPose():View['pose'] {
  if(clockSnapshot<c3ReactionUntil&&c3ReactionPose)return c3ReactionPose
  if(!working||['waiting','question','error','wild','refuse','flustered','snake'].includes(view.mood))return undefined
  const name=toolPoses.pose,current=view.pose?.name==='ribbon-glance'?view.companionPose:view.pose
  if(current?.name===name&&current.at===toolPoses.since)return current
  return {name,frame:name==='think'?'think-a':name==='lookup'?'look-up':name+'-a',aside:name==='think'||name==='work'?WORDS[view.lang].aside[name]:name==='lookup'?WORDS[view.lang].aside.work:c3Word(view.lang,'aside.'+name),at:toolPoses.since,longAt:toolPoses.longAt()}
}
async function updatePose($:Engine):Promise<void>{
  const pose=underlyingCompanionPose()
  if(view.pose?.name==='ribbon-glance'&&clockSnapshot-view.pose.at<720){view.companionPose=pose??null;return}
  delete view.companionPose
  if(view.pose===pose)return
  if(!pose){delete view.pose;return}
  view.pose=pose
  if(pose===c3ReactionPose)return
}
function poseDeadline($:Engine):void{
  stop('poseHold')
  if(limitMotionHeld())return
  const driven=c3Surface==='terminal'||ANIMATION_MODE==='swaps'
  const at=toolPoses.deadline(driven);if(at===undefined||!working)return
  timers.poseHold=scheduleAfter($,Math.max(1,at-clockSnapshot),async()=>{delete timers.poseHold;await snapshotNow($);if(limitMotionHeld())return;toolPoses.tick(clockSnapshot);await updatePose($);await push($);poseDeadline($)})
}



function repositoryBranch($:Engine,cwd:string):Promise<string|undefined>{
 const held=c3Branches.get(cwd);if(held)return held
 const pending=readRepositoryBranch({root:$.plugin.root,exists:(path:string)=>$.fs.exists(path),run:(argv:string[])=>$.process.run(argv),systemRoot:()=>$.env.get('SystemRoot')},cwd)
 c3Branches.set(cwd,pending);void pending.finally(()=>{if(c3Branches.get(cwd)===pending)c3Branches.delete(cwd)});return pending
}

function syncNeighbours($:Engine):void {
  const neighbours=reminderSettings().neighbours&&presenceState?.neighbours?.running?presenceState.neighbours:undefined
  if(neighbours)view.neighbourLights=neighbours;else delete view.neighbourLights
  if(neighbours?.agents.some(agent=>agent.busy))void background($,'socks.lan',earnSocks($,'lan'))
  if(c3){
    const runtime=c3,lifecycle=lifecycleGeneration
    void background($,'c3.neighbours',(async()=>{await snapshotNow($);if(lifecycle===lifecycleGeneration&&runtime===c3&&view.neighbourLights===neighbours)await runtime.neighbours(neighbours,neighbours?.running===true)})())
    setC3BookSnapshot({pace:c3.view().pace,bookmark:c3.view().bookmark,neighbours,vibe:{...c3.view().tests,...vibeFacts()}})
  }
}
function acknowledgeC3($:Engine,drawn:View,tree:RenderElement):void {
  const has=(node:unknown,key:string):boolean=>!!node&&typeof node==='object'&&(Array.isArray(node)?node.some(child=>has(child,key)):(node as {props?:{key?:string}}).props?.key===key||has((node as {children?:unknown}).children,key))
  const id=drawn.line?.id,line=id&&lineSlot.needsShown(id)?{id,project:async()=>{const before=JSON.stringify([view.line,view.companionLine]);projectLine($);if(before!==JSON.stringify([view.line,view.companionLine]))await push($,false,false)}}:undefined
  scheduleC3Shown(callback=>scheduleAfter($,0,()=>callback(clockSnapshot)),{line})
}
function scheduleC3Shown(defer:C3ShownDefer,request:C3Shown):void {
  const pending={line:request.line}
  if(!pending.line)return
  if(timers.c3Shown&&c3ShownPending){
    c3ShownPending.line=pending.line
    return
  }
  const lifecycle=lifecycleGeneration,runtime=c3
  c3ShownPending=pending
  const timer=defer(async now=>{
    if(timers.c3Shown!==timer)return
    clockSnapshot=now
    delete timers.c3Shown;c3ShownPending=undefined
    if(lifecycle!==lifecycleGeneration||runtime!==c3)return
    const current=lineSlot.visible(clockSnapshot)
    if(c3Visible()&&pending.line&&current?.id===pending.line.id&&lineSlot.markShown(pending.line.id,clockSnapshot))await pending.line.project()
  })
  timers.c3Shown=timer
}
function limitMotionHeld():boolean {return limitStill?.epoch===gapLimits.epoch}
function heldLimitPose(drawn:View):boolean {return limitMotionHeld()&&drawn.pose?.frame===limitStill?.frame}
function c3FrameDeadline($:Engine):void {
  if(!working&&clockSnapshot-lastActivity>=60000){syncM1Lively($);return}
  stop('c3Frames')
  const pose=view.pose,driven=[...bands.values()].some(shown=>shown==='cells'||shown==='image'||shown==='svg'&&ANIMATION_MODE==='swaps')
  const opening=pose!==undefined&&openingLife(pose.name)!==undefined
  if(!pose||!(driven||opening&&reducedMotion)||(reducedMotion&&pose.name!=='ribbon-glance'&&!opening)||limitMotionHeld()||view.band==='off'||!working&&clockSnapshot-lastActivity>=60000)return
  const next=c3NextMotion(pose,Math.max(0,clockSnapshot-pose.at),reducedMotion);if(next===undefined)return
  // At least a millisecond: a frame edge a few microseconds off is below a clock reading's precision, and a wait
  // that short ends at the same reading and arms again (the kit's clock spun on it with a band on screen).
  timers.c3Frames=scheduleAfter($,Math.max(1,working?next:Math.min(next,Math.max(1,lastActivity+60000-clockSnapshot))),async()=>{delete timers.c3Frames;if(limitMotionHeld()||view.pose!==pose)return;await snapshotNow($);if(limitMotionHeld()||view.pose!==pose)return;pictureSerial++;rebuildDesktopPictures($,false);redraw($,'c3.frame');syncM1Lively($);c3FrameDeadline($)})
}

// B1b: only plain data crosses the synchronous desktop response boundary.
const SETTINGS_RECORD = 'bandSettings'
let activationOptions: PluginOptions = {}
const activationId = `${registeredAt.toString(36)}-${Math.random().toString(36).slice(2, 10)}`
let sessionIdentity = ''
let engineVersion = 'unresolved'
let lifecycleGeneration = 0
// Bumped by a session's start and end only: the desktop's attach begins a new lifecycle inside the same session.
let sessionSerial = 0
let presenceGeneration = 0
let presenceAttempt = 0
let hydrationRevision = 0
let stateReadStarted = false
let desktopEntered = false
let firstDesktopAnswered = false
let reaskTimer: Timer | undefined
let animationBoot: Timer | undefined
let firstAnswerResolve: (() => void) | undefined
let firstAnswer = new Promise<void>(resolve => { firstAnswerResolve = resolve })
let animationWorkerGeneration = -1
let pictureRequestRevision = 0
let pictureRequestResolve: (() => void) | undefined
let pictureBuildGeneration = 0
let desktopWorking: boolean | undefined
const desktopRequests = new Map<string, RenderInput<'AbovePrompt', 'desktop' | 'vscode' | 'mobile'>>()
// A first answer uses only the snapshot. One later render installs a native dependency.
const bandSeen = new Set<string>()
const bandSubscribed = new Set<string>()
const bandPrimePending = new Set<string>()
let bandPrimeTimer: Timer | undefined
let bandPrimeGeneration = 0
let bandWakeRevision = 0

// The slot and both speech projections share one expiry publication.
function expireLines($: Engine, now: number): void {
  const generation=++lineExpiryGeneration,lifecycle=lifecycleGeneration
  stop('say');stop('lineSlot')
  // The fresh action keeps its authored deadline in the slot. With every More
  // option off, expiry is evaluated by the next event/draw, without an idle wake.
  if(view.band==='off')return
  const held=lineSlot.visible(now)
  const slotDeadline=held?.key==='first.hello'&&!anyMoreOn()?Infinity:held?.key==='long.done'&&!spriteOnScreen()?Infinity:lineSlot.deadline(now)??Infinity
  const deadline = Math.min(slotDeadline,view.line?.key==='two.first'&&view.companionLine?.expiresAt?view.companionLine.expiresAt:Infinity,localLineUntil || Infinity, presenceLineUntil || Infinity)
  if (!Number.isFinite(deadline)) return
  const active=()=>generation===lineExpiryGeneration&&lifecycle===lifecycleGeneration
  timers.lineSlot = $.clock.after(Math.max(0, deadline - now), async () => {
    if(!active())return
    try {
      const at=await $.clock.now()
      if(!active())return
      clockSnapshot=at;delete timers.lineSlot
      lineSlot.advance(at)
      if (localLineUntil && at >= localLineUntil) { localLineUntil = 0; settingLineUntil = 0; view.said = null }
      if (presenceLineUntil && at >= presenceLineUntil) { presenceLineUntil = 0; presenceLine = null }
      projectLine($,false)
      expireLines($,at)
      await push($)
      blinkAtGaze($)
    } catch(error) { caught($,'line.expiry',error) }
  })
}

// The task stays in view. Only this projection is shared with the other bands.
function present(local: View): View { return visitedView(presentBase(local)) }
function presentBase(local: View): View {
  if(limitMotionHeld()&&local.mood==='sleep')local={...local,pose:undefined}
  if (!presenceState) return local
  if (presenceState.asleep && !settingLineUntil) return { ...local, mood: 'sleep', frame: STILL.sleep, ...(limitMotionHeld()?{pose:undefined}:{}), said: presenceLine }
  const awake = local.mood === 'sleep' ? { ...local, mood: 'idle' as const, frame: STILL.idle } : local
  return settingLineUntil > 0 || presenceLine === null || (local.said !== null && localLineUntil >= presenceLineUntil) ? awake : { ...awake, said: presenceLine }
}

// The reactions that need the clock: the night lamp is read when the band draws, nothing is scheduled.
// Their stage direction (a bow loosened outranks rain, rain outranks glasses, glasses the lamp) goes to the band only.
function costumed(local: View, at: number | undefined, working: boolean, desktop = false): View {
  // No lamp before the engine's clock is known; the next draw (a blink, seconds later) has it.
  const clipOff = at !== undefined && local.act?.key === 'serious' && at - local.act.at < COCO_ACT_MS
  return costumedView(local, at === undefined ? undefined : localHour(at, timeZone), working, key => c3Word(local.lang, key), desktop, clipOff)
}
// A command left running past a minute: on the desktop she sits down with her coffee (the existing coffee picture), in
// place of the rain pane (DECISIONS 1017). Claudie's forms have no coffee of theirs; a touch or another pose comes first.
// Her working poses give way to it (his screenshot, 10-18: typing under "holding her coffee"); a moment that comes and
// goes, a cheer, a glance or an opening, does not.
const COFFEE_OVER: ReadonlySet<string> = new Set(['think', 'work', 'lookup', 'search', 'scroll', 'spyglass', 'plan', 'run', 'helper'])
let rainSince: number | undefined
function coffeeBreak(drawn: View): View {
  if (!drawn.costume?.rain || (drawn.pose && !COFFEE_OVER.has(drawn.pose.name)) || drawn.touch || drawn.claudie || drawn.mood === 'sleep') return drawn
  return { ...drawn, pose: { name: 'tea', frame: 'tea-a', aside: c3Word(drawn.lang, 'aside.tea'), at: rainSince ?? clockSnapshot } }
}

// ---------------------------------------------------------------- visitors
// A visit lives in the shared presence record (one visitor for every window); without shared presence
// this session keeps its own. The art and words are read the first time a visit is drawn.
const visits = new VisitCounter(() => visitorsOn(storedSettings), () => timeZone)
let localVisit: VisitState = {}
let localVisitSeq = 0
let visitLogged = ''
let visitData: Promise<void> | undefined
function visitState(): VisitState | undefined { return presenceState ? presenceState.visitors : localVisit }
function visitedView(base: View): View {
  const withShort = presenceLineShort !== null && base.said !== null && base.said === presenceLine ? { ...base, saidShort: presenceLineShort } : base
  const visit = visitState()?.visit
  if (!visit || !visitorsOn(storedSettings) || !visitorArtReady()) return withShort
  const sleeping = base.mood === 'sleep' && visit.leftAt === undefined
  if (!sleeping && !(visit.leftAt !== undefined && clockSnapshot < visit.leftAt + 500)) return withShort
  const direction = sleeping ? visitorWord(base.lang, visitorKey('aside.visitor', visit.kind)) : ''
  const name = visitorWord(base.lang, visitorKey('visitor.name', visit.kind)), label = sleeping && name ? visitorWord(base.lang, 'visitor.companionLabel', { visitor: name }) : ''
  const narrow = sleeping ? visitorNarrowDirection(base.lang, visit.kind) : undefined
  return { ...withShort, visit: { ...visit, ...(label ? { label } : {}), ...(narrow ? { narrow } : {}) }, ...(direction ? { stageDirection: direction } : {}) }
}
// The wake line that names who came, in place of his usual one; the very first visit has its own line. `short` is the same
// line with the visitor's short name, for 24 columns and a desktop band under 480 px.
function visitWakeLine(at: number, lang: string): { text: string; short: string } | null {
  const state = visitState(), visit = state?.visit
  if (!visit || visit.leftAt !== at || !visitorsOn(storedSettings)) return null
  const slot = (key: string, visitor: string): string => visitorWord(lang, key, { visitor })
  const name = visitorWord(lang, visitorKey('visitor.name', visit.kind))
  if (!name) return null
  const short = visitorWord(lang, visitorKey('visitor.short', visit.kind)) || name
  const key = visit.first === true && visitorHasWord(lang, 'visitor.first') ? 'visitor.first' : 'visitor.back'
  const text = slot(key, name)
  return text ? { text, short: slot(key, short) } : null
}
// The first head after a visit ended: once, soon after, and only with its words in hand.
let visitHeaded = ''
function visitHeadFor(lang: string): { kind: string; note: string } | undefined {
  const visit = visitState()?.visit
  if (!visit || visit.leftAt === undefined || visitHeaded === visit.id || !visitorsOn(storedSettings) || !visitorArtReady() || clockSnapshot - visit.leftAt > 600_000) return undefined
  const name = visitorWord(lang, visitorKey('visitor.name', visit.kind)), note = name ? visitorWord(lang, 'visitor.headNote', { visitor: name }) : ''
  if (!note) return undefined
  visitHeaded = visit.id
  return { kind: visit.kind, note }
}
function visitLoad($: Engine): Promise<void> {
  return visitData ??= loadVisitorData(path => $.fs.read(joinPath($.plugin.root, path))).catch(error => { visitData = undefined; caught($, 'visitors.load', error) })
}
// A session sees a visit in the record: load what drawing it needs, note it on this machine, and let one session write the guest book.
async function visitObserved($: Engine, state: PresenceSnapshot, old: PresenceSnapshot | undefined): Promise<void> {
  const visit = state.visitors?.visit
  setVisitBookSnapshot(visit, bookEngine($))
  if (!visit) return
  if (!visitorArtReady() && visitorsOn(storedSettings) && (visit.leftAt === undefined || clockSnapshot < visit.leftAt + 2000)) await visitLoad($)
  if (visit.id !== old?.visitors?.visit?.id) void optional($, 'visitors.remember', () => rememberVisit(bookEngine($).store, visit.kind, visitDay(visit.at, timeZone)), undefined)
  if (visit.leftAt !== undefined) await visitLog($, visit, state.sessions)
}
async function visitLog($: Engine, visit: NonNullable<VisitState['visit']>, sessions?: PresenceSnapshot['sessions']): Promise<void> {
  if (visitLogged === visit.id) return
  const writer = (sessions ?? []).map(row => row.session).sort()[0]
  if (writer !== undefined && writer !== companionId) return
  visitLogged = visit.id
  const held = readVisits(await optional($, 'store.visits', () => $.store.get('visits'), undefined))
  await optional($, 'store.set.visits', async () => { await $.store.set('visits', withVisit(held, visit)) }, undefined)
  bookSettingsChanged(bookEngine($))
}
async function visitDecide($: Engine, now: number): Promise<void> {
  if (!visitorsOn(storedSettings)) { delete presenceMetadata.visitorDue; return }
  const firstMet = await optional($, 'store.firstMet', () => $.store.get('firstMet'), undefined)
  const due = await visits.decide(bookEngine($).store, now, typeof firstMet === 'number' ? firstMet : undefined, visitState())
  if (due) presenceMetadata.visitorDue = due; else delete presenceMetadata.visitorDue
  if (!presence && due) localVisit = { ...localVisit, due: newerDue(localVisit.due, due) }
}
// Without shared presence the local doze and wake make the visit, by the same rules as the record's reducer.
function localVisitSleep($: Engine, at: number): void {
  const next = visitAtSleep(localVisit, at, ++localVisitSeq, visitorsOn(storedSettings))
  if (next?.visit && next.visit.id !== localVisit.visit?.id) { localVisit = next; setVisitBookSnapshot(next.visit, bookEngine($)); void visitLoad($).then(() => push($)) }
}
function localVisitWake($: Engine, at: number): void {
  const next = visitAtWake(localVisit, at)
  if (next?.visit && next.visit.leftAt !== localVisit.visit?.leftAt) { localVisit = next; void background($, 'visitors.log', visitLog($, next.visit)) }
}

function presenceRecord(): Record<string, unknown> | undefined {
  return presenceState ? { seq: presenceState.seq, asleep: presenceState.asleep, event: presenceSpeech ?? presenceState.event, said: presenceLine,
    quietAt: presenceState.quietAt, busy: presenceState.busy, clingy: presenceState.clingy, lang: presenceState.lang,
    touchEvent: presenceState.touchEvent, settings: presenceState.settings, settingsEvent: presenceState.settingsEvent,
    affection: view.affection, lines: PRESENCE_LINES } : undefined
}

// The same settings in another key order are the same settings: an echo is not a new choice.
function settingsText(values: PresenceSettings): string {
  return JSON.stringify(Object.keys(values).sort().map(key => [key, values[key]]))
}
async function receivePresence($: Engine, state: PresenceSnapshot): Promise<void> {
  const old = presenceState
  if (state.asleep && !old?.asleep) {
    const at=state.sleepEvent?.at ?? state.event.at
    const from=pictureReady ? currentMotion(at).frame : undefined
    clearPoke()
    pictureFrom=from; pictureMood='sleep'; pictureEpoch=at
    pictureVariant=pickMotionVariant(); pictureReady=true; pictureSerial++; pictureStrings.clear()
  }
  const fromDrawing = presenceDrawing > 0
  const beforeSnapshot=JSON.stringify(normalizeDesktopView(present(view),initialView(),PREBUILT_FRAME_NAMES))
  const localTouch = state.event.kind === 'touch' && state.event.id === ownTouchId
  const settingsChanged = settingsText(sharedSettings) !== settingsText(state.settings ?? sharedSettings)
  presenceState = state
  syncM1Lively($)
  await visitObserved($, state, old)
  await d1Ribbon($,state)
  syncNeighbours($)
  if (state.asleep && !old?.asleep) queueDesktopPictures($)
  if (state.settings && settingsChanged) applySettings($,state.settings)
  const snapshotChanged=beforeSnapshot!==JSON.stringify(normalizeDesktopView(present(view),initialView(),PREBUILT_FRAME_NAMES))
  // The accepted plain snapshot is useful even if clock/state publication stalls.
  // Our local touch already requested its redraw before the shared echo arrives.
  if(snapshotChanged && !fromDrawing && (!localTouch || settingsChanged)) {
    latest.view={...present(view),bandBeforeOff:lastBand}
    redraw($,'presence.snapshot')
  }
  diagnose($, 'presence.event', undefined, { seq: state.seq, kind: state.event.kind, asleep: state.asleep, busy: state.busy })
  const now = await snapshotNow($)
  if (presenceState !== state) return
  let armWakeLine: ((afterDrawAt:number) => void) | undefined
  if (!localTouch && (state.asleep || old?.asleep !== state.asleep || state.event.kind === 'wake')) clearPoke()
  if (state.settingsEvent && state.settingsEvent.id !== settingEventId) {
    settingEventId = state.settingsEvent.id
    if (now < state.settingsEvent.at + TIMING.say) {
      const line = settingLine(state.settingsEvent.changes)
      if (line) { view.said = line; settingLineUntil = localLineUntil = state.settingsEvent.at + TIMING.say }
    }
  }
  const wake = state.wakeEvent ?? (state.event.kind === 'wake' ? state.event : undefined)
  // A touch on the pet or in another window is answered there (DECISIONS 1013, 1018): this band keeps its line.
  const foreignTouch = state.event.kind === 'touch' && !localTouch && presenceSpeech !== undefined
  const speech = state.asleep ? state.sleepEvent ?? state.event
    : wake && now < wake.at + TIMING.say ? wake
    : state.clingy ? state.clingyEvent ?? state.event
    : foreignTouch ? presenceSpeech! : state.event
  if (wake && wake.id !== wakingId && now < wake.at + 450) { beginWake($, wake.at, wake.id); stop('loop') }
  if(localTouch)rebuildDesktopPictures($,false)
  presenceSpeech = speech
  const speechLang = speech.lang ?? state.lang ?? 'en'
  const signature = `${speech.id}:${speech.at}:${speechLang}:${view.affection}`
  if (signature !== presenceLineEvent) {
    presenceLineEvent = signature
    presenceLine = null
    presenceLineShort = null
    presenceLineUntil = 0
    const key = speech.kind === 'sleep' || speech.kind === 'wake' ? speech.kind
      : speech.kind === 'clingy' && view.affection === 'clingy' ? 'idle' : undefined
    const left = speech.at + TIMING.say - now
    if (key && left > 0) {
      const visitLine = lineSlot.muted || key !== 'wake' ? null : visitWakeLine(speech.at, speechLang)
      presenceLineShort = visitLine?.short ?? null
      const line = lineSlot.muted ? null : (visitLine?.text ?? sharedLineFor({ ...view, lang: speechLang }, key, speech.id))
      presenceLineUntil = speech.at + TIMING.say
      stop('wakeLine')
      if (key === 'wake' && !reducedMotion && now < speech.at + 220) {
        armWakeLine = afterDrawAt => {
          timers.wakeLine = scheduleAfter($, Math.max(0,speech.at + 220 - afterDrawAt), async () => {
            delete timers.wakeLine
            if (presenceSpeech?.id !== speech.id || presenceState?.asleep) return
            presenceLine = line
            if (poked?.wakeAt === speech.at) poked.line = line ?? undefined
            await push($)
          })
        }
      } else { presenceLine = line; if (poked?.wakeAt === speech.at) poked.line = line ?? undefined }
    }
  }
  stop('sleep'); stop('clingy')
  if (state.asleep) { stop('loop'); stop('blink') }
  if (!presenceStarting && !fromDrawing && (!localTouch || settingsChanged)) await push($)
  if (presenceState !== state) return
  const afterDrawAt = armWakeLine || localLineUntil || presenceLineUntil ? await snapshotNow($) : now
  if (presenceState !== state) return
  armWakeLine?.(afterDrawAt)
  expireLines($, afterDrawAt)
  if (!state.asleep) animate($)
}

// One in-process snapshot read before the first drawing. Store freshness across processes
// is not promised by the API. Host setup happens only once. Windows runs it through the pet program's own build
// (pet-program.ts, DECISIONS 941); a package without one leaves each window to itself there.
function ensurePresence($: Engine, busy = false): Promise<void> {
  if(presenceReady)return presenceReady
  const generation=presenceGeneration, attempt=++presenceAttempt
  const active=()=>generation===presenceGeneration&&attempt===presenceAttempt
  let owned:SharedPresence|undefined
  return presenceReady = bounded($, 'presence.setup', (async () => {
    const [home, profile, os, xdg, shell, macOS, session] = await Promise.all([$.env.get('HOME'), $.env.get('USERPROFILE'), $.env.get('OS'), $.env.get('XDG_STATE_HOME'), $.fs.exists('/bin/sh'), $.fs.exists('/System/Library/CoreServices/SystemVersion.plist'), $.session.id()])
    if (!active()) return
    const windows = isWindows(os, home, profile) || windowsPath($.plugin.root)
    const program = windows ? await petProgram(stateEngine($)).catch(() => undefined) : undefined
    if (!active() || (windows ? !program : !shell)) return
    const folderHome = homePath(home, profile)
    if (!folderHome) return
    const folder = presenceFolder(folderHome, macOS, xdg)
    const requests = macOS ? joinPath(folderHome, COMPANION_DIR, 'requests.jsonl') : undefined
    companionId = session
    presenceStarting = true
    const metadata = presenceMetadata
    metadata.requestPath = requests
    const shared:SharedPresence = new SharedPresence({
      // M1: the shared snapshot is read only through the native transaction, never as a plain file (a peek gets nothing).
      read: path => /[\\/]snapshot\.json$/.test(path) ? Promise.reject(new Error('snapshot.json is read through the transaction')) : $.fs.read(path),
      run: async argv => { const result = await $.process.run(argv, { timeoutMs: 5000 }); return { stdout: result.stdout, code: result.exitCode } },
      spawn: argv => $.process.spawn({ argv }),
      now: () => $.clock.now(),
      after: (ms, callback) => { const timer = scheduleAfter($, ms, callback); return () => timer.cancel() },
    }, session, folder, program ?? joinPath($.plugin.root, 'bin', 'presence.sh'), {
      changed: state => active() && presence===shared ? receivePresence($, state) : Promise.resolve(),
      error: error => caught($, 'presence', error),
      ended: async () => {
        if (!active() || presence !== shared) return
        presence = undefined; presenceState = undefined; presenceLine = null
        presenceLineUntil = 0
        expireLines($, await snapshotNow($))
        diagnose($, 'presence.fallback')
        armQuiet($)
        if (!presenceStarting && !presenceDrawing) await push($)
      },
    }, { sleepAfter: TIMING.sleepAfter, clingyAfter: TIMING.clingyAfter, enabled:()=>m1More!==undefined }, () => view.lang, metadata)
    owned=shared; presence = shared
    try {
      const began = Date.now()
      const state = await bounded($, 'presence.peek', shared.peek(), 5000)
      startupTimings.presenceReadMs = Date.now() - began
      if (state && active() && presence===shared) await receivePresence($, state)
    } catch (error) { caught($, 'presence.peek', error) }
    finally { if(active()&&presence===shared)presenceStarting = false }
    if(!active()||presence!==shared)return
    // Opening the follower, claims and request readiness cannot decide a pixel.
    let claimedBusy=busy
    void background($, 'presence.start', hydrate($).then(() => {
      claimedBusy=working||((d1?.snapshot().runningHelpers??0)>0)
      return active()&&presence===shared ? bounded($,'presence.start',shared.start(claimedBusy, sharedSettings),5000) : undefined
    }).then(async state => {
      if (!active() || presence !== shared) return
      if (state) {
        companionChannel?.sharedReady()
        await receivePresence($, state)
        if(active()&&presence===shared&&claimedBusy!==working)presenceActivity($)
      }
      else { presence = undefined; presenceState = undefined; armQuiet($) }
    }).catch(error=>{
      shared.stop()
      if(active()&&presence===shared){presenceAttempt++;presence=undefined;presenceState=undefined;presenceReady=undefined;armQuiet($);redraw($,'presence.failed')}
      caught($,'presence.start',error)
    }))
  })(), 5000).catch(error => {
    if(active()) {
      presenceAttempt++;presenceReady=undefined
      owned?.stop()
      if(owned&&presence===owned){presence=undefined;presenceState=undefined;presenceStarting=false;redraw($,'presence.failed')}
    }
    caught($,'presence.setup',error)
  })
}

// Publication is immediate; optional cross-process I/O starts after the local redraw.
function presenceActivity($: Engine): void {
  if (!presence) {
    const generation=lifecycleGeneration
    void background($,'presence.activity',snapshotNow($).then(now=>{
      if(generation!==lifecycleGeneration)return
      lastActivity=now
      armQuiet($)
    }))
    return
  }
  void background($, 'presence.activity', presence.activity(working||((d1?.snapshot().runningHelpers??0)>0)))
}

// register has no engine argument. Record its completed step with the first engine event.
async function checkDiagnostics($: Engine, force = false): Promise<void> {
  if (diagnosticChecking) return
  const now = await snapshotNow($)
  if (!force && now - diagnosticChecked < 10_000) return
  diagnosticChecking = true
  diagnosticChecked = now
  try {
    diagnostics ??= (async () => {
      const rawHome = await $.env.get('HOME'), profile = await $.env.get('USERPROFILE')
      const home = homePath(rawHome, profile)
      if (!home || isWindows(await $.env.get('OS'), rawHome, profile)) return undefined
      return joinPath(home, COMPANION_DIR)
    })().catch(() => undefined)
    const folder = await diagnostics
    diagnosticEnabled = !!folder && await $.fs.exists(joinPath(folder, 'diagnostics'))
  } catch { diagnosticEnabled = false }
  finally {
    diagnosticChecking = false; diagnosticKnown = true
    for(const entry of earlyDesktopDiagnostics.splice(0))if(diagnosticEnabled)diagnose($,entry.step,undefined,entry.detail)
  }
}

// Cached OFF is an immediate return, including on every render. Only engine events refresh
// the flag, at most once per ten seconds; animation frames never enter this function.
function diagnose($: Engine, step: string, error?: unknown, detail?: Record<string, unknown>, first = false): boolean {
  if(!diagnosticKnown && detail?.surface==='desktop' && (step==='hook.entry'||step==='returned-tree')){
    if(earlyDesktopDiagnostics.length<24)earlyDesktopDiagnostics.push({step,detail})
    return false
  }
  // Reserve one bounded slot for the first visible band, even during a startup burst.
  if (!diagnosticEnabled || (diagnosticPending >= 64 && !first)) return false
  diagnosticPending += 1
  const message = error === undefined ? undefined : safeDiagnosticError(error)
  const at = Date.now()
  diagnosticWrite = diagnosticWrite.then(async () => {
    const folder = await diagnostics
    if (!folder || !diagnosticEnabled) { if (first) firstBand = true; return }
    const steps = diagnosticRegistered ? [step] : ['register', step]
    diagnosticRegistered = true
    for (const current of steps) {
      const line = JSON.stringify({ at: current === 'register' ? registeredAt : at, step: current,
        activationId, sessionId: sessionIdentity, engineVersion,
        ...(current === step ? detail : {}),
        ...(current === step && message !== undefined ? { message } : {}) }) + '\n'
      const written = await $.process.run(['/bin/sh', '-c', DIAGNOSTIC_APPEND, 'coco', folder, joinPath($.plugin.root, 'bin/companion-control'), joinPath($.plugin.root, 'bin/presence.sh')], { stdin: line, timeoutMs: 2000 })
      if (written.exitCode !== 0) throw new Error('diagnostic append failed')
    }
  }).catch(() => { if (first) firstBand = true }).finally(() => { diagnosticPending -= 1 })
  return true
}

function caught($: Engine, step: string, error: unknown): void { diagnose($, `error:${step}`, error) }
function background($: Engine, step: string, work: Promise<unknown>): Promise<void> {
  return work.then(() => undefined, error => caught($, step, error))
}
async function optional<T>($: Engine, step: string, work: () => Promise<T>, fallback: T): Promise<T> {
  try { return await work() } catch (error) { caught($, step, error); return fallback }
}
function redraw($: Engine, why: string): void {
  cocoAsked++
  animationRedraws.clear()
  diagnose($, `redraw:${why}`)
  wakeBand($)
}
function globalBandRedraw($: Engine): void {
  try { $.ui.invalidate('ui.render') } catch (error) { caught($, 'invalidate', error) }
}
function wakeBand($: Engine): void {
  if (!bandSubscribed.size || bandPrimePending.size) { globalBandRedraw($); return }
  const generation = bandPrimeGeneration
  try {
    void $.state.set(BAND_WAKE, { activationId, revision: ++bandWakeRevision }).then(result => {
      if (!result.isSet && generation === bandPrimeGeneration) globalBandRedraw($)
    }, error => {
      if (generation !== bandPrimeGeneration) return
      caught($, 'band.wake', error); globalBandRedraw($)
    })
  } catch (error) { caught($, 'band.wake', error); globalBandRedraw($) }
}
const paintedRequest = (e: RenderInput<'AbovePrompt'>): e is RenderInput<'AbovePrompt', 'desktop' | 'vscode' | 'mobile'> => paintedBand(e.surface)
function bandRequestKey(e: RenderInput<'AbovePrompt'>): string { return `${e.surface}:${e.requestId}` }
function subscribeBand($: Engine, e: RenderInput<'AbovePrompt'>): void {
  if (e.props.hasSurvey) return
  const key = bandRequestKey(e), generation = bandPrimeGeneration
  if (!bandSeen.has(key)) {
    bandSeen.add(key)
    bandPrimePending.add(key)
    // This microtask runs after the ordinary first return; it never reads state there.
    void Promise.resolve().then(() => {
      if (generation !== bandPrimeGeneration || bandPrimeTimer || !bandPrimePending.size) return
      bandPrimeTimer = $.clock.after(0, () => {
        bandPrimeTimer = undefined
        if (generation === bandPrimeGeneration && bandPrimePending.size) {
          bandPrimePending.clear(); globalBandRedraw($)
        }
      })
    })
    return
  }
  bandPrimePending.delete(key)
  if (!bandPrimePending.size) { bandPrimeTimer?.cancel(); bandPrimeTimer=undefined }
  bandSubscribed.add(key)
  // Reading establishes only a dependency, not the drawing's source or a wait.
  try {
    void $.state.get(BAND_WAKE).catch(error => {
      if (generation !== bandPrimeGeneration) return
      bandSubscribed.delete(key); caught($, 'band.subscribe', error)
    })
  } catch (error) { bandSubscribed.delete(key); caught($, 'band.subscribe', error) }
}

// One bag drawing at a time for each surface and width (owner 10-19, his presses in the bag lagged): the band, his other
// sessions and every push ask for a redraw, and on the desktop some fifty bag drawings once ran side by side, each waiting on
// the host, so the one after a press took up to four seconds. A request that comes while one is drawing shares the single
// drawing that starts after it, which reads the newest state; a drawing stuck past three seconds no longer holds the rest.
const bagDraws = new Map<string, { running?: Promise<unknown>; startedAt: number; waiting?: Promise<unknown>; draw?: () => Promise<unknown> }>()
function oneBagDrawing<T>(key: string, draw: () => Promise<T>): Promise<T> {
  let slot = bagDraws.get(key)
  if (!slot) bagDraws.set(key, slot = { startedAt: 0 })
  const s = slot
  s.draw = draw
  if (s.waiting) return s.waiting as Promise<T>
  const start = (): Promise<T> => {
    s.waiting = undefined
    const run = (s.draw as () => Promise<T>)()
    s.running = run; s.startedAt = Date.now()
    const done = () => { if (s.running === run) s.running = undefined }
    run.then(done, done)
    return run
  }
  if (!s.running || Date.now() - s.startedAt > 3000) return start()
  const waiting = s.running.then(start, start)
  s.waiting = waiting
  return waiting
}

function scheduleAfter($: Engine, ms: number, callback: () => unknown): Timer {
  return $.clock.after(ms, async () => {
    try { await snapshotNow($); await callback() } catch (error) { caught($, 'timer.after', error) }
  })
}

function stop(name: TimerName): void {
  if(name==='c3Shown')c3ShownPending=undefined
  if (name === 'loop') motionGeneration++
  timers[name]?.cancel()
  delete timers[name]
}

function stopAll(): void {
  d1DesktopShedTimelines.clear()
  for (const name of Object.keys(timers) as TimerName[]) stop(name)
}

function cancelCalming(): void { calmingGeneration++; stop('calmed') }

function scheduleCalmed($:Engine,delay:number):void {
  cancelCalming()
  const generation=calmingGeneration,serial=c3TurnSerial,lifecycle=lifecycleGeneration
  const active=()=>generation===calmingGeneration&&serial===c3TurnSerial&&lifecycle===lifecycleGeneration
  timers.calmed=scheduleAfter($,delay,async()=>{
    delete timers.calmed
    if(!active())return
    if(working)await settle($)
    if(!active())return
    const at=await snapshotNow($)
    if(!active())return
    openerEvents.calmed=at
    await push($)
  })
}

function spriteOnScreen(): boolean {
  for (const shown of bands.values()) if (shown) return true
  return false
}

async function publish($: Engine, invalidate = true, trace = true): Promise<void> {
  const generation = ++publicationGeneration
  if (trace) animationRedraws.clear()
  syncM1Actions()
  if(view.band==='off')d1DesktopShedTimelines.clear()
  const snapshot = { ...present(view), bandBeforeOff: lastBand }
  latest.view = snapshot
  // The local snapshot is already authoritative. A pending host write cannot withhold it.
  if (invalidate) { redraw($, 'snapshot'); queueDesktopPictures($) }
  publishPending += 1
  try {
    const storedSnapshot={...snapshot}
    delete storedSnapshot.companionPose;delete storedSnapshot.companionLine
    const set = await $.state.set(VIEW, storedSnapshot)
    if (generation === publicationGeneration) {
      statePublishFailed = !set.isSet
      if (!set.isSet) latest.view = snapshot
      publishedVersion = set.version
    }
    if (trace) diagnose($, 'push', undefined, { version: set.version, published: set.isSet })
  } catch (error) {
    statePublishFailed = true
    latest.view = { ...present(view), bandBeforeOff: lastBand }
    if (trace) caught($, 'state.set', error)
    if (trace) diagnose($, 'push', undefined, { version: publishedVersion, published: false })
  } finally {
    publishPending -= 1
    // A host write can complete out of order. Repair the latest projection before
    // letting an old completion expose its stored snapshot or schedule old work.
    if (generation !== publicationGeneration) {
      statePublishFailed = true
      // Remaining writers still own the final cell. Only the last stale writer
      // repairs it, so overlapping repairs cannot supersede one another forever.
      if (publishPending === 0) await publish($, invalidate, trace)
      else if (invalidate) redraw($, 'state.set-fallback')
    }
  }
}

async function push($: Engine, invalidate = true, trace = true): Promise<void> {
  d1Sync($)
  taskNow()
  const captured = companionLive ? companionKey(present(view), presenceRecord()) : undefined
  await publish($, invalidate, trace)
  void background($, 'diagnostics.check', checkDiagnostics($))
  // Optional host I/O never lies between the event and its redraw or delays the next mood.
  if (captured !== undefined) void background($, 'companion', pushCompanion($, captured))
}

async function pushCompanion($: Engine, captured = companionKey(present(view), presenceRecord())): Promise<void> {
  // Reserve ordering before any await. A fast tool's start and finish must retain their own
  // immutable records even when optional host I/O completes out of order.
  const previous = companionWrite
  let finish!: () => void
  companionWrite = new Promise(resolve => { finish = resolve })
  await previous
  try {
    if (!companionLive) return
    if (!(await companionHere($))) { companionChannel?.stop(); companionSent = ''; return }
    await companionChannel?.start()
    // Refresh surface context before dedupe, as companionFeedContext does.
    // The engine follows $ only into helpers declared in this module.
    const surfaces = await $.session.surfaces()
    const record = { ...JSON.parse(captured), surfaces, desktop: surfaces.includes('desktop') } as Record<string, unknown>
    record.channel = companionChannel?.isRunning ?? false
    const key = JSON.stringify(record)
    if (key === companionSent) return
    companionSent = key
    const desktop = record.desktop === true
    if (!(await feedCompanion($, companionText(key, companionId, desktop, await snapshotNow($)))) && companionSent === key) companionSent = ''
  } catch (error) {
    companionSent = ''
    companionChannel?.stop()
    caught($, 'companion', error)
  } finally { finish() }
}

function scheduleCompanionContext($: Engine): void {
  const generation = lifecycleGeneration
  scheduleAfter($, 0, () => {
    if (generation === lifecycleGeneration && companionLive)
      void background($, 'companion.context', pushCompanion($))
  })
}

/** The pet's folder under this home: COMPANION_DIR on macOS, petDataFolder (%APPDATA%\Coco, ~/.config/coco-pet) for
 *  the Windows and Linux pet (his card of 10-18). */
async function petFolderOf($: Engine, home: string | undefined, profile: string | undefined, os: string | undefined): Promise<string | undefined> {
  const at = homePath(home, profile)
  if (at === undefined) return undefined
  return companionSupported ? joinPath(at, COMPANION_DIR) : petDataFolder($, at, isWindows(os, home, profile) || windowsPath($.plugin.root))
}

async function companionHere($: Engine): Promise<boolean> {
  if (!companionSupported && !petShipped) return false
  companionFolder ??= await petFolderOf($, await $.env.get('HOME'), await $.env.get('USERPROFILE'), await $.env.get('OS'))
  companionThere = companionFolder !== undefined && (await $.fs.exists(companionFolder))
  return companionThere
}

async function feedCompanion($: Engine, text: string | (() => string), stillCurrent?: () => boolean): Promise<boolean> {
  if (companionFolder === undefined) return false
  // $.fs.write creates missing folders, so look again right before every write: a companion
  // uninstalled a moment ago must stay uninstalled.
  if (!(await $.fs.exists(companionFolder))) {
    companionThere = false
    companionChannel?.stop()
    companionSent = ''
    return false
  }
  if (stillCurrent && !stillCurrent()) return false
  // The pet's folder is there: off macOS this is when its program is first looked for.
  if (!companionSupported && await petResolved() === undefined) return false
  if (stillCurrent && !stillCurrent()) return false
  try {
    let payload = typeof text === 'function' ? text() : text
    if (reminderSettings(storedSettings).longTask !== 'notify' && payload.includes('"longTaskAuthorizationRequest"')) {
      const record = JSON.parse(payload)
      delete record.longTaskAuthorizationRequest
      payload = JSON.stringify(record) + '\n'
    }
    const written = petPath !== undefined
      ? await $.process.run(petWriteArgv(petPath, companionFolder, 'view.json'), { stdin: payload, timeoutMs: 2000 })
      : await $.process.run(['/bin/sh', '-c', ATOMIC_WRITE, 'coco', companionFolder, 'view.json', joinPath($.plugin.root, 'bin/companion-control'), joinPath($.plugin.root, 'bin/presence.sh')], { stdin: payload, timeoutMs: 2000 })
    if (written.exitCode !== 0) throw new Error('shared write failed')
    return true
  } catch (error) { caught($, 'feed', error); return false }
}

function taskNow(): void {
  companionTask(!working ? null : view.mood === 'waiting' ? { key: 'waitingOK' }
    : view.mood === 'question' ? { key: 'waitingAnswer' } : currentTask ?? { key: 'thinking' })
}

// Animation changes remain blits on terminals. SVG needs a desktop redraw; a band restored
// without a mounted sprite needs publication so its host cell carries the current frame.
async function showFrame($: Engine, frame: FrameName): Promise<void> {
  view.frame = frame
  if (!spriteOnScreen()) { stop('loop'); await publish($, false, false); return }
  let svg = false
  for (const [requestId, shown] of bands) {
    if (shown === 'svg') { svg = true; continue }
    if (shown !== 'cells' && shown !== 'image') continue
    const blit = await $.ui.blit(shown === 'cells'
      ? { requestId, key: 'sprite', cells: spriteCells(frame, view.colors) }
      : { requestId, key: 'sprite', source: { png: spritePng(frame) } })
      .catch(() => ({ deny: 'unavailable' }))
    if (blit.deny) bands.set(requestId, null)
  }
  // Keep the task's frame current beneath a held poke face, without redrawing hidden frames.
  if (svg && ANIMATION_MODE === 'swaps') {
    pictureSerial++; pictureStrings.clear()
    rebuildDesktopPictures($, false)
    for (const requestId of bands.keys()) animationRedraws.add(requestId)
    wakeBand($)
  }
}

async function setMood($: Engine, mood: Mood, holdMs?: number): Promise<void> {
  const generation = ++moodGeneration
  const began = await snapshotNow($)
  if (generation !== moodGeneration) return
  if(began<c3ThanksUntil&&(mood==='think'||mood==='work')){mood='flustered';holdMs=c3ThanksUntil-began}
  if(['waiting','question','error','wild','refuse','flustered','snake'].includes(mood)){cancelCalming();delete view.pose;toolPoses.interrupt();stop('c3Frames');c3ReactionUntil=0;c3ReactionPose=undefined;stop('celebration')}
  const from = pictureReady ? currentMotion(began).frame : undefined
  clearPoke()
  stop('loop')
  stop('revert')
  stop('blink')
  if (!pictureReady || pictureMood !== mood) {
    const now = began
    pictureFrom = from
    pictureMood = mood; pictureEpoch = now; pictureVariant = pickMotionVariant(); pictureReady = true
    pictureSerial++; pictureStrings.clear()
    queueDesktopPictures($)
  }
  if (view.mood === 'sleep' && mood !== 'sleep') localVisitWake($, began)
  view.mood = mood
  view.frame = STILL[mood]
  delete view.act
  await push($)
  await syncBreath($)
  if (generation !== moodGeneration || view.mood !== mood) return
  syncM1Lively($)
  if (holdMs !== undefined) {
    const now = await snapshotNow($)
    if (generation !== moodGeneration || view.mood !== mood) return
    timers.revert = scheduleAfter($, Math.max(0, began + holdMs - now), () => background($, 'settle', settle($)))
  }
  animate($)
  if (mood === 'idle') blinkAtGaze($)
}

// Starts the mood's motion if a sprite is on screen and nothing runs yet: the two-frame loop
// of a running turn, or the idle blink. Also called when a band first shows his picture.
function animate($: Engine): void {
  syncM1Lively($)
  if(limitMotionHeld()){stop('loop');stop('blink');stop('c3Frames');return}
  if(view.pose){stop('loop');stop('blink');c3FrameDeadline($);return}
  const driven = [...bands.values()].some(shown => shown === 'cells' || shown === 'image' || shown === 'svg' && ANIMATION_MODE === 'swaps')
  if (!driven || view.mood === 'sleep' || presenceState?.asleep || reducedMotion || view.band === 'off') { stop('loop'); stop('blink'); return }
  if (timers.loop) return
  const mood = view.mood, variant = pictureVariant, epoch = pictureEpoch, generation = motionGeneration
  const active = () => (working||clockSnapshot-lastActivity<60000) && generation === motionGeneration && view.mood === mood && !limitMotionHeld() && !presenceState?.asleep && view.band !== 'off' && !reducedMotion
  const schedule = async () => {
    if (!active()) return
    let cancelled = false
    timers.loop = { cancel: () => { cancelled = true } }
    const now = await snapshotNow($), elapsed = Math.max(0, now - epoch)
    if (cancelled || !active()) return
    const waking = wakingAt !== undefined && now < wakingAt + 450
    const boundary = waking ? [33,220,330,400,450].find(ms => ms > now - wakingAt!) : undefined
    const next = boundary !== undefined ? {afterMs: Math.max(1,wakingAt! + boundary - now)} : nextMotionChange(mood, elapsed, variant)
    timers.loop = scheduleAfter($,working?next.afterMs:Math.min(next.afterMs,Math.max(1,lastActivity+60000-now)),async()=>{
      delete timers.loop
      if (!active()) { syncM1Lively($); return }
      const at = await snapshotNow($)
      if(!active()){syncM1Lively($);return}
      const sharedMotion = wakingAt !== undefined && at < wakingAt + 450
        ? sampleMotion('idle', at - wakingAt, variant, {waking:true})
        : sampleMotion(mood, at - epoch, variant)
      await showFrame($, terminalSnapshotFrame(sharedMotion))
      if (!timers.loop && active() && [...bands.values()].some(shown => shown === 'cells' || shown === 'image' || shown === 'svg' && ANIMATION_MODE === 'swaps')) await schedule()
    })
  }
  void schedule()
}

// The face he rests on: reading when idle, thinking or writing while a turn runs.
async function settle($: Engine): Promise<void> {
  delete timers.revert
  return setMood($, working ? (toolsThisTurn > 0 ? 'work' : 'think') : 'idle')
}

function blinkAtGaze($: Engine): void { animate($) }

async function sayText($: Engine, text: string | undefined): Promise<void> {
  if (!text) return push($)
  const now = await snapshotNow($)
  const accepted=lineSlot.offer({key:'ambient',text,class:0,untilPrompt:true},now)
  projectLine($)
  if(accepted==='dropped')return
  view.said = text

  localLineUntil = now + TIMING.say
  await push($)
  expireLines($, await snapshotNow($))
  blinkAtGaze($)
}

async function say($: Engine, key: string, vars: Record<string, string | number> = {}): Promise<void> {
  // a line set saved in its file since it was read is read again first (his 10-17 card)
  await m1More?.refreshLines(moreEngine($)).catch(error => caught($, 'lines.refresh', error))
  return sayText($, fill(pick(`${view.lang}:${view.affection}:${key}`, linesFor(view, key)), vars))
}

// One-shot timers armed by activity: one shared timestamp fixes a four-to-six-minute sleep, and
// in the clingy voice one line after 150 seconds. They fall asleep by default (owner 10-14: 「她默认就会自己睡」);
// "lively when idle" only adds the terminal's idle motion.
function armQuiet($: Engine): void {
  stop('sleep')
  stop('clingy')
  if (presence) return
  if (working || view.band === 'off' || !m1More || (d1?.snapshot().runningHelpers??0)>0) return
  const quietAt = presenceState?.quietAt ?? lastActivity
  const current = () => (presenceState?.quietAt ?? lastActivity) === quietAt && !presence
    && !working && view.band !== 'off' && m1More !== undefined
  const armSleep = () => {
    const sleepTimer = scheduleAfter($, Math.max(0, quietAt + TIMING.sleepAfter(quietAt) - clockSnapshot), async () => {
      if (timers.sleep !== sleepTimer || !current() || view.mood !== 'idle' || (d1?.snapshot().runningHelpers??0)>0) return
      delete timers.sleep
      await setMood($, 'sleep')
      localVisitSleep($, clockSnapshot)
      await say($, 'sleep')
    })
    timers.sleep = sleepTimer
  }
  if (view.affection === 'clingy' && clockSnapshot < quietAt + TIMING.clingyAfter) {
    const clingyTimer = scheduleAfter($, quietAt + TIMING.clingyAfter - clockSnapshot, () => {
      if (timers.clingy !== clingyTimer || !current()) return
      delete timers.clingy
      armSleep()
      if (view.mood === 'idle') background($, 'say.idle', say($, 'idle'))
    })
    timers.clingy = clingyTimer
  } else armSleep()
}

// ---------------------------------------------------------------- the offering box
//
// Each main-thread response completes turn.step on every surface. Usage is an in-process
// snapshot, measured events carry their figure directly. No sampler or delayed spinner read.

// Each window's readings since it opened, for their quota page's charts (lane C, 10-15): taken in at every reading, written
// at most once a minute, together with what another window of theirs wrote meanwhile. Only this machine's store holds them.
let quotaTrail: QuotaTrail | undefined, quotaTrailWritten = Number.NEGATIVE_INFINITY
async function noteQuotaTrail($: Engine, rateLimits: readonly { kind: string; percentUsed: number; resetsAt?: string }[], at: number): Promise<void> {
  try {
    quotaTrail ??= quotaTrailFrom(await $.store.get('quotaTrail'))
    const next = quotaTrailWith(quotaTrail, rateLimits, at)
    if (!next) return
    quotaTrail = next
    if (at - quotaTrailWritten < 60_000) return
    quotaTrailWritten = at
    quotaTrail = quotaTrailMerged(quotaTrailFrom(await $.store.get('quotaTrail')), quotaTrail)
    await $.store.set('quotaTrail', quotaTrail)
  } catch (error) { caught($, 'quota.trail', error) }
}

async function quotaMeasured($: Engine, rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[], costUSD?: number, tokens?: number): Promise<void> {
  const before = view.quota
  const at = await snapshotNow($)
  await noteQuotaTrail($, rateLimits, at)
  gapLimits.read(rateLimits.map(w=>({...w,resetsAt:w.resetsAt?Date.parse(w.resetsAt):undefined})));view.spentWindows=[...gapLimits.out()];view.spentResets=Object.fromEntries(gapLimits.burned().map(w=>[w.kind,w.resetsAt]));spentSocks($)
  const current = { rateLimits, ...(costUSD !== undefined ? { costUSD } : {}), ...(tokens !== undefined ? { tokens } : {}), at }
  if (JSON.stringify({ ...before, at: 0 }) === JSON.stringify({ ...current, at: 0 })) return
  view.quota = current
  await push($)
}

// The window the box fills against is the one the engine compacts at, as /context measures it: his auto-compact window
// (400k on his Mac, 10-18) when auto-compaction is on, the model's own otherwise. The engine settles it from the
// variable, his settings, the account or the model; a local estimate, no request, 3 to 4 ms measured on his Mac.
function compactingWindow(context: SessionContextUsage): number {
  const b = context.breakdown
  return b?.isAutoCompactEnabled && Number.isFinite(b.rawMaxTokens) && b.rawMaxTokens > 0 ? Math.min(b.rawMaxTokens, context.window || b.rawMaxTokens) : context.window
}

async function gauge($: Engine, given?: SessionContextUsage, response = false, usage?: TurnUsage): Promise<void> {
  if (awaitingResponse && !response) return
  if (response) awaitingResponse = false
  let context = given, window = 0
  try {
    const read = await $.session.usage({ breakdown: 'summary' })
    if (context === undefined) {
      await quotaMeasured($, read.rateLimits, read.cost?.usd, read.context.tokens)
      context = read.context
    }
    window = compactingWindow(read.context)
  } catch (error) {
    caught($, 'usage', error)
    if (context === undefined) return
  }
  window ||= context.window
  if (context.window && usage) context = { ...context, tokens: usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens }
  if (!window || (context.tokens === undefined && context.percent === undefined)) return
  // the engine's percent is over the model's window; over a smaller one of his it is recounted from the tokens
  const percent = window === context.window && context.percent !== undefined && !usage ? context.percent
    : context.tokens !== undefined ? Math.round(context.tokens / window * 100) : Math.round((context.percent ?? 0) * context.window / window)
  await showContext($, percent, false, context.tokens, window)
}

async function showContext($: Engine, percent: number, estimate: boolean, tokens?: number, window?: number): Promise<void> {
  if (percent < TIMING.offeringReset) offeringWarned = false
  const counted = tokens !== undefined && Number.isFinite(tokens) && tokens >= 0 ? Math.round(tokens) : undefined
  const size = window !== undefined && Number.isFinite(window) && window > 0 ? Math.round(window) : undefined
  if (view.context === percent && view.estimate === estimate && view.contextTokens === counted && view.contextWindow === size) return
  view.context = percent
  view.estimate = estimate
  if (counted === undefined) delete view.contextTokens; else view.contextTokens = counted
  if (size === undefined) delete view.contextWindow; else view.contextWindow = size
  if (!estimate && percent >= TIMING.offeringFull && !offeringWarned) {
    offeringWarned = true
    return say($, 'offering_full')
  }
  await push($)
}

// After a compaction, a /rewind or at a fresh start the engine has no figure for the
// conversation as it now stands until the next response. Until then the box shows the engine's
// local estimate (no request, no tokens), marked "~"; without one it hides rather than show the
// old number.
async function sweep($: Engine, tokensAfter?: number): Promise<void> {
  awaitingResponse = true
  try {
    const { context } = await $.session.usage({ breakdown: 'summary' })
    const total = context.breakdown?.totalTokens ?? tokensAfter, window = compactingWindow(context)
    if (window && total !== undefined) return showContext($, Math.round((total / window) * 100), true, total, window)
  } catch (error) {
    caught($, 'usage.estimate', error)
  }
  view.context = null
  view.estimate = false
  await push($)
}

// ---------------------------------------------------------------- session

// Preferences are enriched from lifecycle dispatches, never while drawing.
let clockSnapshot = Date.now()
// False until the engine's clock has been read: the module's own Date.now() is not the session's time.
let clockFromEngine = false
async function snapshotNow($:Engine):Promise<number> {
  const now=await $.clock.now(); clockSnapshot=now; clockFromEngine=true; return now
}
let cachedEngineSettings: Record<string, unknown> = {}
let cachedEngineTheme: string | undefined
let themeRevision = 0
let storedSettings: PresenceSettings = {}
// A successfully read activation record is reused by every lifecycle. Failed
// reads retry on a later lifecycle; malformed/oversized data is never replaced.
const SETTINGS_RECORD_BYTES = 16_384
// The record keeps his own choices: the stick lives in presence alone, and the theme, reduced motion and time zone
// are Claude Code's, read again each session.
function recordSettings(values: Record<string, unknown>): PresenceSettings {
  const { stick: _stick, theme: _theme, prefersReducedMotion: _motion, timeZone: _zone, outfit: _outfit, ...kept } = cocoSettings(values, cachedEngineSettings)
  return kept
}
let settingsRecordRead: Promise<void> | undefined
let settingsRecordWritable = false
let settingsRecordLoaded = false
const legacySettingReads = new Map<string, Promise<unknown>>()
let legacySettingsImported = false
let pendingMigrationMirrors: { band?: true; language?: true; resolvedLanguage?: true } | undefined
let configLabelsLanguage = view.lang
let engineSettingsRead: Promise<void> | undefined
let engineThemeRead: Promise<void> | undefined
let environmentRead: Promise<void> | undefined
let environmentSnapshot: (string | undefined)[] = []
let preferencesGeneration = -1
let settingsWrite: Promise<unknown> = Promise.resolve()
let settingsWriteRevision = 0
function optionsView(value: View): View {
  const band = activationOptions.band
  const chosen = langOf(activationOptions.language)
  return desktopLook({ ...value, band: band === 'off' || band === 'compact' || band === 'text' ? band : 'on',
    lang: chosen ?? langOf(activationOptions.resolvedLanguage) ?? value.lang })
}
// The desktop band is always the painted one and never shrinks while Claude works (owner 10-19): its two settings are
// gone, so a pixel band or a smaller one stored by a terminal session or an older build is drawn as the painted one.
// What is written back keeps the stored shapes, which a terminal session still uses: the desktop only draws them as the
// painted band at full size.
function keptShape(): { band: View['band']; workSize: 'same' | 'smaller' } {
  if (!paintedBand(c3Surface)) return { band: view.band, workSize: view.workSize ?? 'same' }
  return { band: view.band === 'on' && storedSettings.band === 'compact' ? 'compact' : view.band, workSize: storedSettings.workSize === 'smaller' ? 'smaller' : 'same' }
}
function desktopLook(value: View): View {
  if (!paintedBand(c3Surface)) return value
  return { ...value, band: value.band === 'compact' ? 'on' : value.band, workSize: 'same', ...(value.bandBeforeOff === 'compact' ? { bandBeforeOff: 'on' as const } : {}) }
}
function refreshConfigLabels($: Engine): void {
  if (configLabelsLanguage === view.lang) return
  configLabelsLanguage = view.lang
  try { $.ui.invalidate('command.describe'); $.ui.invalidate('config.describe') } catch (error) { caught($, 'config.labels', error) }
  // The neighbours' label was worded in the old language (BAND F3).
  if(c3)c3Changed($)
}
async function readLegacySettings($: Engine): Promise<PresenceSettings> {
  const values = await Promise.all(LEGACY_SETTING_KEYS.map(async key => {
    let read = legacySettingReads.get(key)
    if (!read) {
      read = bounded($, `settings.legacy.${key}`, $.store.get(key), 5000).catch(error => {
        legacySettingReads.delete(key); throw error
      })
      legacySettingReads.set(key, read)
    }
    return [key, await read] as const
  }))
  return normalizeLegacySettings(Object.fromEntries(values))
}
// Terminal.app draws half blocks from its font, short of the line's top (coco-pixel-play.ts halfCell)
let shortBlocks=false
function applyHydratedSettings($: Engine): void {
  locale=[...environmentSnapshot.slice(0,3),macSystemLanguage(environmentSnapshot[10])]
  const term=environmentSnapshot[3]??'', program=environmentSnapshot[4]??'', tmux=environmentSnapshot[5]!==undefined, kitty=environmentSnapshot[6]!==undefined
  view.pictures=!tmux&&(kitty||/kitty|ghostty/i.test(term)||/ghostty/i.test(program))?'kitty':'cells'
  shortBlocks=program==='Apple_Terminal'
  view.colors=colorsOf({term,program,tmux,colorterm:environmentSnapshot[7]??'',windowsTerminal:environmentSnapshot[8]!==undefined})
  const settings = normalizeDesktopSettings(cachedEngineSettings)
  reducedMotion = settings.prefersReducedMotion === true
  screenReader=detectScreenReader(environmentSnapshot[9],settings as {axScreenReader?:unknown})
  timeZone = typeof settings.timeZone === 'string' ? settings.timeZone : undefined
  view.quotaTimeZone=timeZone
  langChosen = langOf(activationOptions.language)
  heard = langOf(storedSettings.heard)
  const lang = langChosen ?? languageOf(settings.language, heard, ...locale, storedSettings.language, activationOptions.resolvedLanguage)
  lastBand = storedSettings.bandBeforeOff === 'compact' ? 'compact' : view.band === 'compact' ? 'compact' : 'on'
  // The one-time legacy read runs only when the batched activation record is missing.
  view = optionsView({ ...view, lang, workSize: storedSettings.workSize === 'smaller' || storedSettings.workSize === 'same' ? storedSettings.workSize : view.workSize??'same',
    voice: storedSettings.voice === 'off' || storedSettings.voice === 'full' || storedSettings.voice === 'light' ? storedSettings.voice : view.voice,
    affection: storedSettings.affection === 'clingy' || storedSettings.affection === 'warm' ? storedSettings.affection : view.affection,
    theme: cachedEngineTheme, cue: cueFor(cachedEngineTheme),
    companionTarget: companionTargetOf(storedSettings.companionTarget ?? view.companionTarget),
    neighbours: typeof storedSettings.neighbours === 'boolean' ? storedSettings.neighbours : view.neighbours ?? false })
  if (!langChosen) view.lang = lang
  view.verb = WORDS[view.lang].spinner[0] ?? view.verb
  // Who stands on the band and what they wear come from the record at once: the shared record repeats the same
  // values, so its first snapshot is no change and would never put them on.
  if (storedSettings.socks !== undefined) wearPair(storedSettings.socks)
  if (storedSettings.claudeForm !== undefined) { wearForm(storedSettings.claudeForm); syncLines($) }
  storedSettings = { ...Object.fromEntries(Object.entries(reminderSettings(storedSettings)).filter(([key]) => key !== 'appIcon' && key !== 'dockTile')), ...storedSettings }
  latest.settings = settingsForBook()
  storedSettings = recordSettings(storedSettings)
  sharedSettings = cocoSettings({ ...storedSettings, prefersReducedMotion:settings.prefersReducedMotion, timeZone:settings.timeZone,
    ...(cachedEngineTheme === undefined ? {} : { theme:cachedEngineTheme }), ...keptShape(), bandBeforeOff:lastBand,
    voice:view.voice, affection:view.affection, lang:langChosen ?? 'auto', language:view.lang })
  latest.marks = marksFrom(storedSettings.marks)
  latest.view = { ...present(view), bandBeforeOff:lastBand }
  refreshConfigLabels($)
  redraw($, 'hydration')
}
function hydrate($: Engine): Promise<void> {
  if (preferences && preferencesGeneration === lifecycleGeneration) return preferences
  const generation = lifecycleGeneration, revision = hydrationRevision, began = Date.now()
  preferencesGeneration = generation
  const active = () => generation === lifecycleGeneration && revision === hydrationRevision
  const timed = async <T,>(step:string, read:()=>Promise<T>):Promise<T> => {
    const start=Date.now()
    try { return await bounded($, step, read(), 5000) }
    finally { startupTimings[`${step}Ms`] = Date.now()-start }
  }
  const settingsAtRead=cachedEngineSettings
  engineSettingsRead ??= timed('settings', () => $.settings.read()).then(settings => {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('invalid settings')
    if (cachedEngineSettings===settingsAtRead) cachedEngineSettings = normalizeDesktopSettings(settings)
  }).catch(error => { engineSettingsRead=undefined; throw error })
  const themeAtRead = themeRevision
  engineThemeRead ??= readEngineTheme(() => timed('theme', () => $.config.list()), themeAtRead)
    .catch(error => { engineThemeRead=undefined; caught($, 'config.theme', error) })
  settingsRecordRead ??= timed('settingsStore', () => $.store.get(SETTINGS_RECORD)).then(async stored => {
    if (stored === undefined) {
      const legacy = await timed('settingsMigration', () => readLegacySettings($))
      storedSettings={...legacy,...storedSettings}; if(legacy.voice!==undefined)storedSettings.voiceChosen=true
      legacySettingsImported=true
      settingsRecordLoaded=true; settingsRecordWritable=true; latest.settings=settingsForBook(); return
    }
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
      settingsRecordLoaded=true; settingsRecordWritable=false; caught($,'settings.record.invalid',new Error('invalid settings record')); return
    }
    // A record that took in Claude Code's settings by mistake (before 10-18) sheds them here and is written small again.
    const serialized=JSON.stringify(recordSettings(stored as Record<string, unknown>))
    if (new TextEncoder().encode(serialized).length > SETTINGS_RECORD_BYTES) {
      settingsRecordLoaded=true; settingsRecordWritable=false; caught($,'settings.record.oversize',new Error('settings record too large')); return
    }
    // Local changes made while the store read was pending take precedence.
    storedSettings={...JSON.parse(serialized),...storedSettings} as PresenceSettings
    if(storedSettings.voiceChosen!==true){
      const legacy=await $.store.get('voice')
      const decision=voiceDecision(storedSettings,legacy)
      storedSettings={...storedSettings,voice:decision.voice,voiceChosen:decision.voiceChosen}
      if(decision.askAgain)await $.store.set('voiceAskAgain',true)
    }
    latest.settings=settingsForBook()
    settingsRecordLoaded=true; settingsRecordWritable=true
  }).catch(error => { settingsRecordRead=undefined; throw error })
  environmentRead ??= Promise.all([
    $.env.get('LC_ALL'), $.env.get('LC_MESSAGES'), $.env.get('LANG'), $.env.get('TERM'), $.env.get('TERM_PROGRAM'),
    $.env.get('TMUX'), $.env.get('KITTY_WINDOW_ID'), $.env.get('COLORTERM'), $.env.get('WT_SESSION'), $.env.get('CLAUDE_AX_SCREEN_READER'),
    $.env.get('__CF_USER_TEXT_ENCODING'),
  ].map((read,index) => timed(`preferenceEnv${index}`, () => read).catch(() => undefined))).then(environment => {
    environmentSnapshot=environment
  })
  const work = Promise.all([engineSettingsRead,engineThemeRead,settingsRecordRead,environmentRead]).then(() => {
    // A pending migration merges local choices field by field. Applying that merged
    // result must still import the untouched old preferences after a newer choice.
    if (!active() && !(generation===lifecycleGeneration && legacySettingsImported)) return
    let migratedOptions: {band?: 'on'|'compact'|'off'|'text'; language?: Lang|'auto'} | undefined
    if (legacySettingsImported) {
      // Upgrade old choices before applying register defaults; newer local choices already won above.
      const band=storedSettings.band
      const language=storedSettings.lang==='auto'?'auto':langOf(storedSettings.lang)
      activationOptions={...activationOptions,
        ...(band==='on'||band==='compact'||band==='off'||band==='text'?{band}:{}),
        ...(language!==undefined?{language}:{})}
      legacySettingsImported=false
      migratedOptions={...(band==='on'||band==='compact'||band==='off'||band==='text'?{band}:{}),...(language!==undefined?{language}:{})}
    }
    applyHydratedSettings($)
    iconSettingsHydrated(bookEngine($))
    startupTimings.preferencesMs = Date.now()-began
    const resolvedLanguage=activationOptions.language==='auto' && activationOptions.resolvedLanguage!==view.lang ? view.lang : undefined
    if(resolvedLanguage!==undefined)activationOptions={...activationOptions,resolvedLanguage}
    const saved=writeSettingsRecord($)
    void background($,'settings.record',saved)
    if (migratedOptions) pendingMigrationMirrors={...pendingMigrationMirrors,
      ...(migratedOptions.band!==undefined?{band:true as const}:{}),
      ...(migratedOptions.language!==undefined?{language:true as const}:{}),
      ...(resolvedLanguage!==undefined?{resolvedLanguage:true as const}:{})}
    const pendingMirrors=pendingMigrationMirrors
    if (pendingMirrors) void background($,'config.migrate',saved.then(written=>{
      if (written!==true || generation!==lifecycleGeneration) return
      // The record survives any resulting reload. Dispatch both mirrors together.
      const mirrors:Promise<unknown>[]=[]
      if(pendingMirrors.band)mirrors.push($.config.set({key:'coco.band',value:activationOptions.band??'on'}))
      if(pendingMirrors.language)mirrors.push($.config.set({key:'coco.language',value:activationOptions.language??'auto'}))
      if(pendingMirrors.resolvedLanguage)mirrors.push($.config.set({key:'coco.resolvedLanguage',value:activationOptions.resolvedLanguage??view.lang}))
      return Promise.all(mirrors).then(()=>{
        if(generation===lifecycleGeneration && pendingMigrationMirrors===pendingMirrors)pendingMigrationMirrors=undefined
      })
    }))
    if (resolvedLanguage!==undefined && !pendingMirrors) {
      void background($,'config.resolvedLanguage',optional($, 'config.resolvedLanguage', () => $.config.set({key:'coco.resolvedLanguage',value:resolvedLanguage}), undefined))
    }
  }).catch(error => {
    if (generation === preferencesGeneration) preferences = undefined
    caught($, 'preferences', error)
  })
  preferences = work
  return work
}
// Book adapters provide explicit capabilities, not the hook's special engine binding.
async function persistIconMachineSettings($: Engine, changes: Record<string, string | boolean>): Promise<void> {
  const before = { ...storedSettings }, sharedBefore = { ...sharedSettings }
  hydrationRevision++
  storedSettings = { ...storedSettings, ...changes }; sharedSettings = { ...sharedSettings, ...changes }
  latest.settings = settingsForBook()
  // The Mac pet's Dock tile follows the switch on its next record.
  if ('dockTile' in changes) companionDock(reminderSettings(storedSettings).dockTile === 'on')
  const written = await writeSettingsRecord($, changes)
  if (written !== true) {
    // A refused durable record must not become permission for a native app write.
    for (const [key, value] of Object.entries(changes)) {
      // Refused storage cannot undo an in-memory protective off/block choice.
      if (changes.appIcon === 'off' || (key === 'appIconBlocked' && value === true)) continue
      if (storedSettings[key] === value) { if (before[key] === undefined) delete storedSettings[key]; else storedSettings[key] = before[key]! }
      if (sharedSettings[key] === value) { if (sharedBefore[key] === undefined) delete sharedSettings[key]; else sharedSettings[key] = sharedBefore[key]! }
    }
    latest.settings = settingsForBook(); bookSettingsChanged(bookEngine($))
    companionDock(reminderSettings(storedSettings).dockTile === 'on')
    throw new Error('icon settings record not written')
  }
  // A delayed acknowledgement must publish the current record: a stale presence
  // snapshot could otherwise undo a newer icon press and supersede its durable write.
  if (presence) {
    // Retain the presence record's key order so its own echo is not a new choice.
    sharedSettings = cocoSettings({ ...presenceState?.settings, ...storedSettings }, cachedEngineSettings)
    await presence.settings(sharedSettings)
  }
  bookSettingsChanged(bookEngine($))
}
// What the book reads: the stored settings, plus what this session works out for itself (the More rows' always
// snapshot, whether to ask about the voice again). Reading or writing the settings replaces the stored part only;
// replacing all of it dropped those two until their next event (a pair earned as /coco him opened lost the
// summary size, m1-always-wiring A25).
function settingsForBook(): Record<string, unknown> {
  const { m1Always, voiceAskAgain } = latest.settings
  return { ...storedSettings, ...(m1Always === undefined ? {} : { m1Always }), ...(voiceAskAgain === undefined ? {} : { voiceAskAgain }) }
}
function writeSettingsRecord($:Engine,changes?:PresenceSettings):Promise<unknown> {
  const revision=++settingsWriteRevision, generation=lifecycleGeneration
  // Project the latest choice before waiting so a late initial store result
  // merges its future keys without rolling the person's choice back.
  const projected:PresenceSettings={...keptShape(), bandBeforeOff:lastBand,
    voice:view.voice, affection:view.affection, lang:langChosen??'auto', language:view.lang, heard:heard??langOf(storedSettings.heard)??null,
    marks:latest.marks??marksFrom(undefined),
    companionTarget: view.companionTarget ?? 'auto', ...Object.fromEntries(Object.entries(reminderSettings(storedSettings)).filter(([key]) => key !== 'appIcon' && key !== 'dockTile')), neighbours: view.neighbours ?? false }
  storedSettings={...storedSettings,...(settingsRecordLoaded?projected:changes??{})}
  latest.settings=settingsForBook()
  // The lifecycle owns the read. Until it starts, retain choices locally; its
  // completion merges the record and queues the durable write below.
  if (!settingsRecordRead) return Promise.resolve()
  const write=settingsWrite.catch(()=>undefined).then(async()=>{
    try { await settingsRecordRead } catch { return }
    if (revision!==settingsWriteRevision || generation!==lifecycleGeneration || !settingsRecordWritable) return
    let serialized:string
    try { serialized=JSON.stringify(recordSettings(storedSettings)) } catch(error) { caught($,'settings.record.invalid',error); return }
    if (new TextEncoder().encode(serialized).length>SETTINGS_RECORD_BYTES) {
      caught($,'settings.record.oversize',new Error('settings record too large')); return
    }
    return optional($,'store.bandSettings',async()=>{await $.store.set(SETTINGS_RECORD,JSON.parse(serialized));return true},false)
  })
  settingsWrite=write
  return write
}
function bounded<T>($:Engine, step:string, work:Promise<T>, ms:number):Promise<T> {
  let timer:Timer|undefined
  const deadline=new Promise<never>((_,reject) => { timer=$.clock.after(ms,()=>{reject(new Error(`${step} deadline`))}) })
  return Promise.race([work,deadline]).finally(()=>timer?.cancel())
}

// Render signals plain latches only. The lifecycle owns data reads and every build.
function prepareAnimationBoot($:Engine):void {
  if (animationBoot || animationWorkerGeneration===lifecycleGeneration) return
  const generation=lifecycleGeneration
  const answer=firstAnswer
  animationWorkerGeneration=generation
  animationBoot=scheduleAfter($,0,()=>{
    animationBoot=undefined
    void background($,'pictures.worker',runPictureWorker($,generation,answer))
  })
}
async function runPictureWorker($:Engine,generation:number,answer:Promise<void>):Promise<void> {
  await answer
  // the bag's word (👜 设置) is read beside her pictures, not after them, so its one redraw never waits on a slow read of hers
  if(!bagWordsAsked&&!bagWords(view.lang)){
    bagWordsAsked=true
    void loadBagWords(()=>bounded($,'bag.read',$.fs.read(joinPath($.plugin.root,'hooks/bag-text.json')),5000)).then(ok=>{if(ok&&bagWords(view.lang)&&generation===lifecycleGeneration)redraw($,'bag.words')},error=>caught($,'bag.words',error))
  }
  while(generation===lifecycleGeneration){
    const revision=pictureRequestRevision
    reconcileDesktopWorking($)
    // Coco's whole data first (the band draws them); redraw only if what they show was a bundled stand-in
    if(!cocoReady('A')||!cocoReady('B')){
      const load=cocoLoad??=loadCoco($)
      try { await load; if(cocoStale())redraw($,'coco.ready') } catch(error) { if(cocoLoad===load)cocoLoad=undefined; caught($,'coco.load',error) }
      if(generation!==lifecycleGeneration)return
    }
    // the socks from their drawer (view.socks, shared with the other windows and the desktop companion): both
    // outfits' pixels for that pair, then they are drawn in them; a pair that cannot be read leaves their own on
    const socks=view.socks
    if(cocoReady('A')&&cocoReady('B')&&(cocoSocksWorn('A')!==socks||cocoSocksWorn('B')!==socks)){
      try { await wearSocks($,socks);redraw($,'coco.socks') } catch(error) { installCocoSocks('A',undefined);installCocoSocks('B',undefined);if(view.socks===socks)delete view.socks;caught($,'coco.socks',error) }
      if(generation!==lifecycleGeneration)return
    }
    const form=view.claudie
    if(form&&!claudieReady(form)&&!claudieFailed.has(form)){
      try { await loadClaudie($,form);redraw($,'claudie.ready') } catch(error) { claudieFailed.add(form);caught($,'claudie.load',error) }
      if(generation!==lifecycleGeneration)return
    }
    if(generation!==lifecycleGeneration)return
    try { rebuildDesktopPictures($);animate($) } catch(error) { caught($,'pictures.build',error) }
    // A request received during loading/building remains dirty. Otherwise sleep
    // until a returned answer changes the latch; there is no polling timer.
    if(revision===pictureRequestRevision)await new Promise<void>(resolve=>{pictureRequestResolve=resolve})
  }
}
// Claudie's sixteen cells for her form, read once a session; a form that cannot be read leaves Coco on the band.
const claudieFailed=new Set<ClaudieForm>()
async function loadClaudie($:Engine,form:ClaudieForm):Promise<void> {
  const png:string[]=[]
  for(let n=1;n<=16;n++){
    const file=await bounded($,'claudie.read',$.fs.read(joinPath($.plugin.root,`assets/claudie/${form}/${String(n).padStart(2,'0')}.png`),{as:'bytes'}),5000)
    png.push(file.base64)
  }
  const size=pngSize(png[0]!)
  if(!size)throw new Error('claudie cell unreadable')
  installClaudie(form,{...size,png})
}
// Their outfit first, then the other one (the shell change ends in it).
async function loadCoco($:Engine):Promise<void> {
  const first:CocoOutfit=view.outfit==='B'?'B':'A'
  for(const outfit of [first,first==='A'?'B':'A'] as const){
    if(cocoReady(outfit))continue
    const text=await bounded($,'coco.read',$.fs.read(joinPath($.plugin.root,`assets/coco/band-${outfit}.json`)),5000)
    installCocoData(JSON.parse(text) as CocoData)
  }
}
async function wearSocks($:Engine,pair:string|undefined):Promise<void> {
  const files:Partial<Record<CocoOutfit,CocoSocks>>={}
  if(pair!==undefined)for(const outfit of ['A','B'] as const){
    const text=await bounded($,'coco.socks.read',$.fs.read(joinPath($.plugin.root,`assets/coco/socks-${outfit}-${pair}.json`)),5000)
    files[outfit]=JSON.parse(text) as CocoSocks
  }
  installCocoSocks('A',files.A);installCocoSocks('B',files.B)
}
// What they should be playing for a drawn state: the state's action, or before their band data is read the
// nearest bundled resting state (coco-stills.ts).
// What the band's state asks of them, read the same way by the desktop's pictures and the terminal's pixels.
// shellMs: how long the ended shed plays the shell change (each surface's own clip length).
function cocoInputFor(drawn:View,isWorking:boolean,now:number,touch:View['touch'],shellMs:number):{outfit:CocoOutfit;input:CocoInput;act?:{key:string;at:number}} {
  const outfit:CocoOutfit=drawn.outfit==='B'?'B':'A'
  const act=drawn.act&&now-drawn.act.at<COCO_ACT_MS&&(COCO_ACTIONS as readonly string[]).includes(drawn.act.key)?drawn.act:undefined
  const shed=drawn.shed?.phase==='begin'||drawn.shed?.phase==='end'&&now-drawn.shed.at<shellMs?drawn.shed.phase:undefined
  return {outfit,act,input:{mood:drawn.mood,pose:drawn.pose?.name,touch,shed,act:act?.key as CocoActionKey|undefined,night:drawn.night===true,working:isWorking||working,breath:drawn.play?.breath!==undefined}}
}
function cocoWanted(drawn:View,isWorking:boolean,now:number,touch=drawn.touch):{outfit:CocoOutfit;action:CocoActionKey;base:CocoActionKey;act?:{at:number}} {
  // the ended shed stays in the view until the next compaction: the shell change is only its own clip long
  const {outfit,input,act}=cocoInputFor(drawn,isWorking,now,touch,cocoBodySeconds(drawn.outfit==='B'?'A':'B','shell')*1000)
  const action=cocoAction(input),base=cocoBase(input)
  const playing:CocoOutfit=action==='shell'?(outfit==='A'?'B':'A'):outfit
  if(!cocoReady(playing)){
    const rest=([action,base,'think','idle'] as CocoActionKey[]).find(key=>cocoHas(outfit,key))??'idle'
    return {outfit,action:rest,base:rest}
  }
  return {outfit:playing,action,base,...(act&&action===act.key?{act}:{})}
}
// The desktop band's picture of them: the wanted action joined to whatever was showing (coco-motion.ts).
// still: a held usage limit draws one picture, as reduced motion does.
function cocoBand(drawn:View,isWorking:boolean,now:number,height:number,still=false):string {
  const wanted=cocoWanted(drawn,isWorking,now)
  // Claude's form set to Claudie: her still cell for the same action, in the box the band keeps for Coco
  if(drawn.claudie&&claudieReady(drawn.claudie))return claudieSvg(drawn.claudie,wanted.action,cocoWidth(height),height)
  cocoPlay=cocoNext(cocoPlay,wanted.outfit,wanted.action,wanted.base,now,wanted.act)
  return cocoPicture(cocoPlay,height,now,reducedMotion||still)
}
// Whether the band's play is no longer what the state wants (their data arrived, or the state changed
// without a redraw of its own, such as presence falling asleep), so the band must be drawn again.
function cocoStale():boolean {
  if(!cocoPlay)return false
  let drawn=present(view)
  if(working&&['idle','sleep'].includes(drawn.mood))drawn={...drawn,mood:'think',frame:'think-a'}
  // a touch is drawn from the poke itself, as the band's render does
  const touch=poked&&clockSnapshot<poked.until&&clockSnapshot>=Math.max(poked.at,(poked.wakeAt??-Infinity)+450)?(poked.kind==='wink'?'poke':poked.kind):drawn.touch
  if(!touch)drawn=coffeeBreak(drawn)
  const wanted=cocoWanted(drawn,false,clockSnapshot,touch)
  return cocoNext(cocoPlay,wanted.outfit,wanted.action,wanted.base,clockSnapshot,wanted.act)!==cocoPlay
}
// The stage direction of every picture the desktop band draws, read from the picture it settles on, so the words beside
// her name the picture whichever of a touch, a moment, the shell change, her breathing, a tool or the mood won it
// (owner 10-18: 「小字跟着画面走」, after "(typing away)" beside her breathing, "(sipping coffee)" beside her typing and
// "(antennae twisting into a ?)" beside the shell change). The words are his picks on the review page of 10-18, one
// per picture (WORDS.drawn); where he kept the words already shown, they stay the mood's, the touch's or the shell's.
// The terminal band draws another set of pictures and keeps its own words.
const shedWords = (lang: Lang): string => (d1Word(lang, 'aside.shed') ?? '').replace(/\*/g, '') || (d1ShedAsides?.[lang] ?? d1ShedAsides?.en ?? '').replace(/\*/g, '')
const drawnWords = (key: DrawnKey) => (lang: Lang): string => WORDS[lang].drawn[key]
const DRAWN_ASIDE: Readonly<Record<CocoActionKey, (lang: Lang, drawn: View) => string>> = {
  idle: drawnWords('idle'), wait: drawnWords('wait'), think: drawnWords('think'), work: drawnWords('work'), done: drawnWords('done'),
  error: drawnWords('error'), wild: drawnWords('wild'), night: drawnWords('night'), nap: drawnWords('nap'), peek: drawnWords('peek'),
  hood: drawnWords('hood'), serious: drawnWords('serious'), out: drawnWords('out'), firsttry: drawnWords('firsttry'), catch: drawnWords('catch'),
  pack: drawnWords('pack'), read: drawnWords('read'), search: drawnWords('search'), lookup: drawnWords('lookup'), plan: drawnWords('plan'),
  run: drawnWords('run'), helper: drawnWords('helper'), coffee: drawnWords('coffee'), fixed: drawnWords('fixed'), breath: drawnWords('breath'),
  hello: lang => WORDS[lang].aside.wave, teapot: lang => WORDS[lang].aside.refuse, praised: lang => WORDS[lang].aside.flustered,
  petted: (lang, drawn) => drawn.touch === 'pat' ? WORDS[lang].touch.patted : WORDS[lang].touch.poked, shell: shedWords,
  // never drawn today (no mood, pose or moment asks for them)
  doze: () => '', pass: () => '', watch: () => '',
}
// A moment for Coco to act out once (the picture reads it with the mood that came with it).
function cocoAct(key:CocoActionKey):void { view.act={key,at:clockSnapshot} }
// Coco's pixel version in the terminal (DECISIONS 913, 917): the band's state read as for the desktop, played
// from coco-pixel.ts. special: the terminal's own moments (a glance, the moment after waking, being dragged).
let pixelPlay: PixelPlay | undefined
function terminalPixel(drawn:View,isWorking:boolean,now:number,special?:string):{frame:number;other:number;next?:number;outfit:CocoOutfit} {
  const {outfit,input,act}=cocoInputFor(drawn,isWorking,now,drawn.touch,PIXEL_SHELL_MS)
  const action:string=special??cocoAction(input),base=cocoBase(input)
  const playing:CocoOutfit=action==='shell'?(outfit==='A'?'B':'A'):outfit
  pixelPlay=pixelNext(pixelPlay,action,base,playing,now,act&&action===act.key?act.at:undefined)
  // a held usage limit draws one picture for as long as it holds, and asks for no frames
  if(heldLimitPose(drawn))return {...pixelHeld(pixelPlay),outfit:pixelPlay.outfit}
  const moving=!reducedMotion
  // their idle life (falling asleep, breathing, blinking) plays only when "闲着也动来动去" is on, and their loop never moves while asleep
  return {...pixelStep(pixelPlay,now,moving,m1More?.isOn('lively')===true,drawn.mood==='sleep'),outfit:pixelPlay.outfit}
}
// Their pixel frame for now, as cells and as kitty's PNG, for the blits that do not go through a render.
function terminalPixelNow(drawn:View):{cells:string;png:string} {
  const p=terminalPixel(drawn,working,clockSnapshot)
  const look={outfit:p.outfit,...(drawn.socks?{socks:drawn.socks}:{}),dark:!(drawn.theme??'').startsWith('light'),colors:drawn.colors,...(shortBlocks?{short:true}:{})}
  return {cells:pixelCells(p.frame,p.other,look),png:pixelPng(p.frame,p.other,look)}
}
// The next frame of a moment that is playing: one timer, gone when it fires; none while they hold still.
function pixelDeadline($:Engine,next:number|undefined):void {
  stop('pixelFrames')
  if(next===undefined||view.band==='off'||![...bands.values()].some(shown=>shown==='cells'||shown==='image'))return
  timers.pixelFrames=scheduleAfter($,Math.max(16,Math.ceil(next)),()=>{delete timers.pixelFrames;redraw($,'pixel.frame')})
}
function reconcileDesktopWorking($:Engine):void {
  // A resumed desktop may provide a running turn before any turn.start event.
  // The render only records that fact; this lifecycle worker owns its effects.
  if(turnId || desktopWorking===undefined || working===desktopWorking)return
  hostWorking(desktopWorking)
  if(working){stop('sleep');stop('clingy')}
  if(working&&['idle','sleep'].includes(view.mood)){
    view.mood='think';view.frame=STILL.think
  }else if(!working&&view.mood==='think'){
    view.mood='idle';view.frame=STILL.idle
  }
  void background($,'desktop.working',push($))
  presenceActivity($)
}
function signalPictureRequest():void {
  pictureRequestRevision++
  pictureRequestResolve?.();pictureRequestResolve=undefined
}
function cancelPictureWorker():void {
  pictureRequestResolve?.();pictureRequestResolve=undefined
  animationWorkerGeneration=-1
}
function queueDesktopPictures($:Engine):void {
  if (!cocoReady(view.outfit==='B'?'B':'A')) return
  const generation=++pictureBuildGeneration
  void background($,'pictures.build',Promise.resolve().then(()=>{
    if(generation===pictureBuildGeneration)rebuildDesktopPictures($)
  }))
}
// Coco's state changed without a redraw of its own (presence falling asleep, a mood change): draw the band again.
function rebuildDesktopPictures($:Engine,invalidate=true):void {
  if (!firstDesktopAnswered) return
  // a redraw already on its way draws what the state wants; only a change nobody redraws for needs one
  if (cocoReady(view.outfit==='B'?'B':'A') && invalidate && cocoShown === cocoAsked && cocoStale()) redraw($,'coco.state')
}
function beginLifecycle($:Engine,source:string):void {
  resetReceivedInbox(); receivedSerial=0
  m1More?.stopLively()
  limitStill=undefined
  const generation=++lifecycleGeneration
  stop('c3Shown')
  bandPrimeGeneration++; bandPrimeTimer?.cancel(); bandPrimeTimer=undefined
  bandSeen.clear(); bandSubscribed.clear(); bandPrimePending.clear();d1DesktopShedTimelines.clear()
  cancelPictureWorker()
  reaskTimer?.cancel(); animationBoot?.cancel(); animationBoot=undefined
  desktopEntered=false; firstDesktopAnswered=false; firstAnswerResolve?.()
  desktopWorking=undefined
  firstAnswer=new Promise(resolve=>{firstAnswerResolve=resolve})
  if(!presence) presenceReady=undefined
  reaskTimer=$.clock.after(1200,()=>{
    reaskTimer=undefined
    if(generation===lifecycleGeneration&&!desktopEntered&&view.band!=='off')redraw($,`no-entry:${source}`)
  })
  const revision=publicationGeneration
  if(!stateReadStarted){
    stateReadStarted=true
    const began=Date.now()
    void background($,'state.restore',bounded($,'state', $.state.get(VIEW),5000).then(held=>{
      startupTimings.stateReadMs=Date.now()-began
      if(generation!==lifecycleGeneration||revision!==publicationGeneration||!held?.value)return
      // the outfit comes from the shared record, never the saved view: a saved one would dress this session apart
      const outfit=view.outfit
      view=optionsView(normalizeDesktopView(held.value,view,PREBUILT_FRAME_NAMES));delete view.companionPose;delete view.companionLine; adoptedRestored=true
      if(outfit)view.outfit=outfit;else delete view.outfit
      publishedVersion=held.version; lastBand=view.bandBeforeOff??(view.band==='compact'?'compact':'on')
      latest.view=view; redraw($,'state.restore')
    }))
  }
  void background($,'hydrate',hydrate($))
  void background($,'presence.lifecycle',ensurePresence($,working))
  void background($,'identity',Promise.all([$.session.id(),$.session.version()]).then(([id,version])=>{
    if(generation!==lifecycleGeneration)return
    sessionIdentity=id;engineVersion=version.version
  }))
  prepareAnimationBoot($)
}

let bootPromise:Promise<void>|undefined,bootGeneration=-1
function boot($:Engine,surface:string|null):Promise<void>{if(bootGeneration===lifecycleGeneration&&bootPromise)return bootPromise;bootGeneration=lifecycleGeneration;return bootPromise=bootWork($,surface)}
async function bootWork($: Engine, surface: string | null): Promise<void> {
  const generation=lifecycleGeneration, bootTurn=turnId, serial=sessionSerial
  const active=()=>generation===lifecycleGeneration && turnId===bootTurn
  clearPoke()
  pokeClicks = []
  lastPoke = -Infinity
  pokeNext.clear()
  await hydrate($)
  if(!active())return
  if (presenceState?.settings) applySettings($, presenceState.settings)
  await publish($)
  if(!active())return
  stopAll()
  expireLines($, await snapshotNow($))
  companionChannel?.stop()
  companionChannel = undefined
  companionSent = ''
  const home = await optional($, 'env.HOME', () => $.env.get('HOME'), undefined), profile = await optional($, 'env.USERPROFILE', () => $.env.get('USERPROFILE'), undefined)
  const os = await optional($, 'env.OS', () => $.env.get('OS'), undefined)
  companionSupported = !isWindows(os, home, profile) && (await optional($, 'platform', () => $.fs.exists('/System/Library/CoreServices/SystemVersion.plist'), false))
  // Off macOS the pet is fed through its own program, when the plugin carries a build for this computer. Which Linux
  // build fits (a uname) is asked only once the pet's folder is there (feedCompanion) or /coco companion runs.
  petPath = undefined; petHost = stateEngine($)
  petShipped = companionSupported ? false : await optional($, 'pet.program', () => petProgramShipped(petHost!), false)
  companionLive = companionSupported || petShipped
  companionFolder = companionLive ? await optional($, 'pet.folder', () => petFolderOf($, home, profile, os), undefined) : undefined
  companionId = await optional($, 'session.id', () => $.session.id(), '')
  const root = await optional($, 'session.root', () => $.session.root(), '')
  companionSession(root)
  if (generation === lifecycleGeneration && root) presenceMetadata.cwd = root
  if(!active())return
  currentTask = null
  // The companion's requests (its state, a denial) reach every session. With the native state helper the channel
  // reads and writes through it; without one (the shipping build has none yet) it hears them on the presence follower.
  const nativeState = companionLive && companionFolder !== undefined && await stateAvailable($)
  if (companionLive && companionFolder !== undefined) {
    const channel = new CompanionChannel({
      ...(nativeState?{ensureRequests:async()=>{const result=await runState($,['--ensure-requests'],{timeoutMs:2000});if(!result||result.exitCode!==0||JSON.parse(result.stdout).ensured!==true)throw new Error('request create failed')},read:async()=>{const done=await runState($,['--read-requests'],{timeoutMs:2000});if(!done||done.exitCode!==0||done.isStdoutTruncated)throw new Error('request read failed');const value=JSON.parse(done.stdout);if(value.read!==true||typeof value.text!=='string')throw new Error('request read failed');return value.text},append:async(_path,text)=>{const done=await runState($,['--append-requests'],{stdin:text,timeoutMs:2000});if(!done||done.exitCode!==0||JSON.parse(done.stdout).appended!==true)throw new Error('request hello append failed')},after:(ms,callback)=>{const timer=$.clock.after(ms,callback);return ()=>timer.cancel()},spawn:()=>spawnState($,['--follow-requests'])}:{}),
      exists:path=>$.fs.exists(path),
      listen: (receive, ended, generation) => presence?.subscribeRequests(receive, ended, generation),
      now: () => $.clock.now(),
    }, companionId, companionFolder, {
      running: running => { if (companionChannel === channel) companionActivity({ channel: running }) },
      seen: upto => { if (companionChannel === channel) companionSeen(upto) },
      // The channel belongs to the session: the desktop's attach begins a new lifecycle but does not boot it again.
      note: async note => { if(companionChannel===channel&&serial===sessionSerial)await receiveNote($,'journal:'+note.id,note.text,lifecycleGeneration) },
      dm: (text:string):boolean => companionChannel===channel&&serial===sessionSerial&&dmFromPet($,text),
      dmSeen: () => { if(companionChannel===channel)m1More?.dmRead() },
      ack: async id => {
        if (companionChannel !== channel) return
        companionActivity({ ack: id })
        companionSent = '' // An idempotent retry must republish even an unchanged acknowledgement.
        await push($)
      },
      changed: async () => { if (companionChannel === channel) await push($) },
      companionState: async info => { companionChanged(info);setD1BookNotificationDenied(info?.longTaskAuthorization==='denied',bookEngine($));if(info?.longTaskAuthorization==='denied'&&reminderSettings(storedSettings).longTask==='notify')await chooseReminder($,'longTask','band');redraw($, 'companion-state') },
      error: error => caught($, 'channel', error),
    })
    companionChannel = channel
  }
  await hydrate($)
  if(!active())return
  working = false
  hostWorking(desktopWorking ?? false)
  turnId = ''
  toolsThisTurn = 0
  failures = 0
  wildPending = false
  arrived = false
  startSaid = false
  offeringWarned = false
  spinnerStage = ''
  awaitingResponse = false
  askedAt = 0
  lastSeen = Number((await optional($, 'store.lastActive', () => $.store.get('lastActive'), undefined)) ?? 0)
  lastActivity = await snapshotNow($)
  await gauge($)
  if(!active())return
  if (view.context === null) await sweep($)
  await setMood($, working ? 'think' : 'idle')
  armQuiet($)
  await startC3($)
  await startM1($)
  if(!active())return
  await d1Ribbon($,presenceState)
  if(!active())return
  await publish($)
  if (surface === 'terminal' && !view.line?.key.startsWith('bookmark')) await arrive($)
  if (await companionHere($)) void background($, 'companion.start', pushCompanion($))
}

// A newer config event wins over any outstanding initial/theme row read.
async function readEngineTheme(read: () => ReturnType<Engine['config']['list']>, revision = themeRevision): Promise<void> {
  const rows = await read()
  if (themeRevision !== revision) return
  const theme = rows.find(row => row.key === 'theme')?.value
  cachedEngineTheme = typeof theme === 'string' ? theme : undefined
}

// A /config change applies at once: reduced motion, theme, language, time zone.
async function settingsMoved($: Engine): Promise<void> {
  // his auto-compact window may have moved with them: the box follows at once (his words, 10-18: 「随时跟着来」)
  background($, 'gauge', gauge($))
  const settings = normalizeDesktopSettings(await optional($, 'settings.read', () => $.settings.read(), {}))
  cachedEngineSettings = settings
  hydrationRevision++
  timeZone = typeof settings.timeZone === 'string' ? settings.timeZone : undefined
  view.quotaTimeZone=timeZone
  view.theme = cachedEngineTheme
  view.cue = cueFor(cachedEngineTheme)
  const lang = languageOf(langChosen, settings.language, heard, ...locale)
  if (lang !== view.lang) {
    view.lang = lang
    view.verb = WORDS[lang].spinner[0] ?? view.verb
    refreshConfigLabels($)
  }
  const motion = settings.prefersReducedMotion === true
  if (motion !== reducedMotion) {
    reducedMotion = motion
    if (motion) {
      stop('loop')
      stop('blink')
      view.frame = STILL[view.mood]
    }
  }
  await snapshotNow($)
  syncCelebrationAside()
  languageChangeLimit($)
  await push($)
  armQuiet($)
  animate($)
  // Only what the others follow: Claude Code's settings themselves stay out of the shared record.
  if (presence) void background($, 'presence.config.settings', presence.settings(cocoSettings({ theme:cachedEngineTheme,
    prefersReducedMotion:settings.prefersReducedMotion, timeZone:settings.timeZone, ...(langChosen ? {} : { language:view.lang }) })))
  await gauge($)
}

// The first time a surface shows him this session, he opens it the way it started: a wave and the
// greeting for a new one, the page Shiori kept for a resumed one, a copy for a fork (openings.ts).
// A reload, a quick resume or a source older than ten seconds plays nothing.
let sessionSource: { kind: SessionSource; seconds?: number; at: number } | undefined
const openingLast: Partial<Record<'clear' | 'fork', number>> = {}

async function arrive($: Engine): Promise<void> {
  if (arrived) return
  await gauge($)
  arrived = true
  if (presenceState?.asleep || presenceLine !== null || view.line?.key.startsWith('bookmark')===true) return
  const now = await snapshotNow($)
  // The first hello, once in his life on this machine: the window that claims it says it instead of the opening.
  // Any other start (met before, or another window claimed it) plays the opening below.
  if(storedSettings.voiceChosen!==true&&c3Visible()){
    const generation=lifecycleGeneration
    const [firstMet,welcome]=await Promise.all([$.store.get('firstMet'),$.store.get('welcome')])
    if(generation!==lifecycleGeneration)return
    if(firstMet===undefined&&welcome===undefined){
      let claimed=false
      try{const result=await runState($,['--claim-welcome'],{timeoutMs:2000});claimed=result!==undefined&&result.exitCode===0&&!result.isStdoutTruncated&&JSON.parse(result.stdout).claimed===true}catch{}
      if(generation!==lifecycleGeneration)return
      if(claimed&&c3Visible()){
        await $.store.set('welcome',{at:now})
        if(generation!==lifecycleGeneration||!c3Visible())return
        await setMood($,'wave',TIMING.wave)
        // The first appearance greets with a first-meeting line and no book button (owner 10-14: the book goes).
        const hello:LineRequest={key:'first.hello',text:pick(`${view.lang}:first_meet`,linesFor(view,'first_meet'))??'',class:2,ttl:300000,untilPrompt:true}
        if(!helloAfterCold($,hello))offerLine($,hello)
        return
      }
    }
  }
  const turns = sessionSource ? undefined : await optional($, 'session.turns', () => $.session.turns(), undefined)
  await openIf($, { source: sessionSource?.kind, seconds: sessionSource?.seconds, turns, now, sourceAge: sessionSource ? now - sessionSource.at : 0, arrival: true })
}

async function openIf($: Engine, input: { source?: SessionSource | undefined; seconds?: number | undefined; turns?: number | undefined; now: number; sourceAge: number; arrival: boolean }): Promise<void> {
  const surface = c3Surface ?? 'terminal', sessionId = await optional($, 'session.id', () => $.session.id(), '')
  const played = openingsFrom(await optional($, 'store.openings', () => $.store.get('openings'), undefined))
  const kind = chooseOpening({ source: input.source, seconds: input.seconds, turns: input.turns, sessionId, surface, played, now: input.now, lastSeen, sourceAge: input.sourceAge, last: openingLast, arrival: input.arrival })
  if (!kind) return
  if (kind === 'clear' || kind === 'fork') openingLast[kind] = input.now
  else await optional($, 'store.set.openings', () => $.store.set('openings', markOpening(played, sessionId, surface)), undefined)
  await playOpening($, kind, input.seconds ?? Math.max(0, (input.now - lastSeen) / 1000))
}

// A painted band's surface without the band up: the heads carry Coco's notes (the first hello, the weekly line).
const headsSpeak = (): boolean => paintedBand(c3Surface) && !bandShownOn(c3Surface, view.band)
const bracketed = (text: string): string => text && !/^[(（]/.test(text) ? `(${text})` : text

async function playOpening($: Engine, kind: OpeningKind, secondsAway: number): Promise<void> {
  if (presenceState?.asleep || presenceLine !== null || view.line?.key==='bookmark') return
  const lang = view.lang, now = await snapshotNow($), visible = c3Visible()
  await loadWeekWords(bookEngine($))
  // Once a week the first line becomes «last week's page is in my book», with a button to open it.
  let week = false
  const today = localDay(now, timeZone)
  if (visible && (kind === 'startup' || kind === 'resume') && reminderSettings(storedSettings).week && weekWord(lang, 'week.ready') && weekWord(lang, 'week.open')) {
    const held = weekRecordFrom(await optional($, 'store.week', () => $.store.get(WEEK_STORE), undefined))
    week = weekReadyDue(held, today, lang, await optional($, 'store.weekReady', () => $.store.get('weekReady'), undefined))
  }
  const name = week ? 'open-week' : `open-${kind}`
  if (kind === 'startup' && !week) await setMood($, 'wave', TIMING.wave)
  let at = now
  if (visible) {
    const aside = week ? c3Word(lang, 'aside.scroll') : kind === 'startup' ? WORDS[lang].aside.wave : bracketed(weekWord(lang, `aside.${kind}`))
    at = await snapshotNow($)
    const life = openingLife(name)!
    const pose: NonNullable<View['pose']> = { name, frame: openingStart(name), ...(aside ? { aside } : { aside: WORDS[lang].aside[view.mood] }), at }
    const lifecycle = lifecycleGeneration
    c3ReactionPose = pose; c3ReactionUntil = at + life; view.pose = pose
    stop('celebration')
    timers.celebration = scheduleAfter($, life, async () => {
      if (c3ReactionPose !== pose || lifecycle !== lifecycleGeneration) return
      delete timers.celebration; c3ReactionPose = undefined; c3ReactionUntil = 0
      await updatePose($)
      if (lifecycle === lifecycleGeneration) await push($)
    })
  }
  if (week) {
    await optional($, 'store.set.weekReady', () => $.store.set('weekReady', weekStart(today, lang)), undefined)
    offerLine($, { key: 'week.ready', text: weekWord(lang, 'week.ready'), class: 0, untilPrompt: true, button: { key: 'coco:week:open', label: weekWord(lang, 'week.open') } })
  } else if (kind === 'startup') await sayText($, pick(`${lang}:greeting`, greetingFor(view, localHour(at, timeZone))))
  else if (kind === 'resume' && secondsAway * 1000 >= TIMING.back) await say($, 'back')
  await push($)
}

// A /clear, /resume or /fork inside a running session, or the source arriving after he is drawn.
async function sessionStarted($: Engine, source: SessionSource, seconds: number | undefined): Promise<void> {
  const now = await snapshotNow($)
  sessionSource = { kind: source, ...(seconds === undefined ? {} : { seconds }), at: now }
  if (source === 'compact' || source === 'startup' || !arrived) return
  await openIf($, { source, seconds, now, sourceAge: 0, arrival: false })
}

async function sessionEnded($: Engine, reason: string): Promise<void> {
  waitBell.end()
  m1More?.stop()
  notice?.sessionStart()
  sessionSource=undefined
  delete view.companionPose;delete view.companionLine;d1CompactSerial++;d1Epoch++;d1DesktopShedTimelines.clear();d1RowsFirst=false;d1PresenceKnown=false;d1?.clear();d1=undefined;d1Ready=undefined;d1LongSaid='';d1Session='';d1Home='';d1Trim=undefined;d1TrimReady=undefined;d1Spawns.clear();delete view.ribbon;delete view.helpers;delete view.shed;delete view.longTask;delete view.stageDirection
  presenceGeneration++; lifecycleGeneration++; sessionSerial++
  bandPrimeGeneration++; bandPrimeTimer?.cancel(); bandPrimeTimer=undefined
  bandSeen.clear(); bandSubscribed.clear(); bandPrimePending.clear();d1DesktopShedTimelines.clear()
  cancelPictureWorker()
  reaskTimer?.cancel(); reaskTimer=undefined; animationBoot?.cancel();animationBoot=undefined;firstAnswerResolve?.()
  const endingPresence=presence
  clearPoke()
  pokeClicks = []
  lastPoke = -Infinity
  companionLive = false
  petPath = undefined; petShipped = false; petHost = undefined
  presence = undefined
  presenceState = undefined
  presenceReady = undefined
  presenceLine = null
  presenceLineUntil = 0
  localLineUntil = 0
  stopAll()
  companionChannel?.stop()
  companionChannel = undefined
  working = false
  currentTask = null
  companionTask(null)
  companionActivity({ reply: null, notice: null, waitAt: null, channel: false })
  if(endingPresence) void background($,'presence.end',bounded($,'presence.end',endingPresence.end(),1000))
  await bounded($,'companion.end',companionWrite,1000)
  if (await companionHere($)) await feedCompanion($, companionEnded(await $.session.id(), await snapshotNow($)))
  companionSent = ''
  await optional($, 'store.set.lastActive', async () => { await $.store.set('lastActive', await snapshotNow($)) }, undefined)
  if (reason === 'clear') return
  const line = pick(`${view.lang}:goodbye`, linesFor(view, 'goodbye'))
  if (line && view.band !== 'off') $.ui.toast(line)
}

// ---------------------------------------------------------------- turns

// The language he hears in the person's prompts, followed at any time (owner 10-18: 「根据用户的实际语言灵活切换。
// 随时切换」): one clear prompt switches, or two in a row that agree; a prompt with too little prose (code, a path,
// "ok") changes nothing. No toast and no line about it: the band speaks the new language from the next line on. A
// /coco lang choice and Claude Code's language setting still come first, the device's language after it, English last.
function hear($: Engine, text: string): Promise<void> {
  const queued = hearingQueue.then(() => hearPrompt($, text))
  hearingQueue = queued.catch(() => {})
  return queued
}

async function hearPrompt($: Engine, text: string): Promise<void> {
  const guess = await detectLanguage(text, [langChosen, cachedEngineSettings.language, heard, ...locale],
    () => $.fs.read(joinPath($.plugin.root, 'hooks/chinese-script-data.json')))
  if (!guess) return
  const sure = guess.confidence >= HEARING.sure
  const agreed = guess.lang === hearing
  hearing = guess.lang
  if (!sure && !agreed) return
  // Already heard: still shown in his language when another session's English had taken the band.
  if (guess.lang !== heard) {
    heard = guess.lang
    await optional($, 'store.set.heard', async () => { await $.store.set('heard', heard) }, undefined)
    void background($,'settings.heard.record',writeSettingsRecord($,{heard}))
  }
  const lang = languageOf(langChosen, cachedEngineSettings.language, heard, ...locale)
  if (lang === view.lang) return
  view.lang = lang
  view.verb = WORDS[lang].spinner[0] ?? view.verb
  refreshConfigLabels($)
}

async function prompted($: Engine, text: string, origin: string): Promise<void> {
  if (!PERSON.has(origin)) return
  // What he types is heard: the composer, his phone through the bridge, and the desktop app, whose typing arrives as sdk.
  // Another session's brief arrives as sdk too, long and in English: one had set his heard language to English for every
  // session (10-18). So a desktop prompt is heard only up to HEARING.brief characters; his own run a sentence or two.
  const own = typed(text)
  if (origin === 'composer' || origin === 'bridge' || (origin === 'sdk' && own.length <= HEARING.brief)) await hear($, own)
  const now = await snapshotNow($)
  const away = now - lastActivity
  const wasAsleep = view.mood === 'sleep', hour = localHour(now, timeZone)
  if (wasAsleep) void background($, 'socks.marshmallow', earnSocks($, 'marshmallow'))
  if (hour >= 23 || hour < 5) void background($, 'socks.goodgirl', earnSocks($, 'goodgirl'))
  lastActivity = now
  view.said = null
  localLineUntil = 0
  if (wasAsleep) await setMood($, 'idle')
  if (/ultrathink/i.test(text)) openerEvents.ultrathink = now
  if (away >= TIMING.back) await say($, 'back')
  else if (wasAsleep && !presence) await say($, 'wake')
  else if (/ultrathink/i.test(text)) { cocoAct('serious'); await say($, 'ultrathink') }
  else if (PRAISE.test(text)) { cocoAct('praised'); await say($, 'praised') }
  else await push($)
  expireLines($, now)
  presenceActivity($)
}

async function turnStarted($: Engine, id: string): Promise<void> {
  const own=d1Epoch
  cancelCalming()
  working = true
  await ensureD1($);if(own!==d1Epoch)return
  const began=await snapshotNow($);if(own!==d1Epoch)return
  if(reminderSettings(storedSettings).longTask!=='off')d1?.startTurn(id,began);d1LongSaid='';delete view.longTask
  toolPoses.reset(began);c3HeadPose=undefined;c3ReactionPose=undefined;c3ReactionUntil=0;delete view.pose
  mainToolCalls.clear()
  currentTask = null
  companionTask({ key: 'thinking' })
  companionActivity({ waitAt: null })
  turnId = id
  toolsThisTurn = 0
  planSaid = false
  spinnerStage = ''
  lastActivity = await snapshotNow($)
  turnBeganAt = clockSnapshot
  if(own!==d1Epoch)return
  stop('sleep')
  stop('clingy')
  view.verb = pick(`${view.lang}:verb`, WORDS[view.lang].spinner) ?? view.verb
  stop('long')
  if (rateLimitStopAt) await relightIncense($)
  await setMood($, 'think')
  if(own!==d1Epoch)return
  armBreath($, id)
  presenceActivity($)
  timers.long = scheduleAfter($, TIMING.thinkingLong, () => {
    if (working && turnId === id) background($, 'say.thinking_long', say($, 'thinking_long'))
  })
  if (!startSaid) {
    startSaid = true
    if(clockSnapshot>=c3ThanksUntil)await say($, 'start')
  }
}

async function toolStarted($: Engine, input: ToolCallInput, command: string | undefined): Promise<void> {
  const tool = input.tool
  lastActivity = await snapshotNow($)
  if (!working) return
  toolsThisTurn += 1
  if (view.mood === 'waiting') await settled($)
  currentTask = taskForTool(input)
  companionTask(currentTask)
  companionActivity({ waitAt: tool === 'AskUserQuestion' ? lastActivity : null })
  await gauge($, undefined, true) // a tool call proves its main-thread response has landed
  if (tool === 'AskUserQuestion') {
    d1?.waiting(true)
    await setMood($, 'question')
    if (lastActivity - lastQuestion >= TIMING.questionGap) {
      lastQuestion = lastActivity
      await say($, 'question')
    }
    return
  }
  if (view.mood === 'think' || view.mood === 'idle') await setMood($, 'work')
  toolPoses.start(input.tool_use_id,tool,lastActivity);await updatePose($);poseDeadline($)
  await push($)
  if (!planSaid && PLAN_TOOL.test(tool)) { planSaid = true; return say($, 'big_start') }
  if (toolsThisTurn === 25) await say($, 'working')
}

// Only test and build runs count toward the wild soul (and flash the startled face); any other
// command may fail quietly, as a grep with no match does.
async function toolEnded($: Engine, tool: string, command: string | undefined, isError: boolean, isDenied: boolean): Promise<void> {
  if (!working) return
  if(tool==='AskUserQuestion')d1?.waiting(false)
  currentTask = null
  companionTask({ key: 'thinking' })
  companionActivity({ waitAt: null })
  if (view.mood === 'waiting') await settled($)
  else if (view.mood === 'question') await settle($)
  await gauge($)
  await push($)
  if (tool !== 'Bash' || isDenied || command === undefined || !TEST_RUN.test(command)) return
  const testRun = /(^|[\s;&|(/])((npm|pnpm|yarn|bun)\s+(run\s+)?test\b|npx\s+(jest|vitest)\b|python3?\s+-m\s+(pytest|unittest)\b|pytest\b|cargo\s+test\b|go\s+test\b|jest\b|vitest\b|swift\s+test\b|mvn\s+test\b|gradlew?\s+test\b|xcodebuild[^;&|\n]*\btest\b)/.test(command)
  // Coco's moments (B lane hangs the words on the same branches): green after a red is fixed, the
  // turn's first test run going green is firsttry
  const fixedNow = testRun && !isError && failedTest, firstTry = testRun && !isError && testedTurn !== c3TurnSerial
  const failedBefore = failedTest, firstOfTurn = testRun && testedTurn !== c3TurnSerial
  if (testRun) {
    if (!isError && failedTest) visits.green(clockSnapshot)
    failedTest = isError
    testedTurn = c3TurnSerial
  }
  const moment = runMoment({ test: testRun, failed: isError, failures: isError ? failures + 1 : 0, failedBefore, firstOfTurn })
  if (isError) {
    cancelCalming()
    failures += 1
    if (failures >= 3 && !wildPending) {
      wildPending = true
      await setMood($, 'wild', TIMING.wildFor)
      return say($, 'wild')
    }
    // a failing build is the small slip (out); a failing test keeps the error picture
    if (view.mood !== 'wild') { await setMood($, 'error', TIMING.errorFlash); if (!testRun) { cocoAct('out'); await push($) } }
    // Three more failures after the wild soul woke: they stop joking (owner 10-14).
    if (wildPending && failures === 6) { cocoAct('serious'); await push($); return say($, 'serious') }
    if (moment) await say($, moment)
    return
  }
  failures = 0
  if (wildPending) {
    wildPending = false
    await setMood($, 'flustered', TIMING.flustered)
    cocoAct('fixed')
    await say($, 'wild_after')
    scheduleCalmed($,TIMING.flustered)
  } else {
    if (fixedNow) { cocoAct('fixed'); await push($) }
    else if (firstTry) { cocoAct('firsttry'); await push($) }
    if (moment) await say($, moment)
  }
}

// A call-bound permission event starts the wait immediately. The corresponding tool call
// settles it, including a classifier decision that never needed a human dialog.
async function asked($: Engine): Promise<void> {
  if (!working) return
  askedAt = await snapshotNow($)
  d1?.waiting(true)
  companionActivity({ waitAt: askedAt })
  companionTask({ key: 'waitingOK' })
  await setMood($, 'waiting')
  await say($, 'waiting')
}

async function settled($: Engine): Promise<void> {
  d1?.waiting(false)
  askedAt = 0
  companionActivity({ waitAt: null })
  companionTask(currentTask ?? { key: 'thinking' })
  stop('ask')
  if (view.mood === 'waiting') await setMood($, 'work')
}

async function turnEnded($: Engine, e: TurnCompleteInput): Promise<void> {
  if (e.agentId !== undefined) return
  const own=d1Epoch
  const erroredBefore = lastTurnErrored
  lastTurnErrored = e.reason === 'error'
  if(e.reason!=='answer')cancelCalming()
  working = false
  mainToolCalls.clear()
  currentTask = null
  companionTask(null)
  askedAt = 0
  spinnerStage = ''
  stop('long')
  stop('ask')
  endBreath()
  const now = await snapshotNow($)
  if(own!==d1Epoch)return
  d1?.complete(now,e.reason)
  companionActivity({ done: now, waitAt: null, reply: { text: replyExcerpt(e.answer), at: now } })
  lastActivity = now
  if (e.reason === 'error') openerEvents.red = now; else if (e.reason === 'refusal') openerEvents.refused = now
  const mood = e.reason === 'error' ? 'error' : e.reason === 'refusal' ? 'refuse'
    : e.reason === 'aborted' || ABSOLUTELY_RIGHT.test(e.answer) ? 'flustered' : 'happy'
  const hold = mood === 'error' ? TIMING.error : mood === 'refuse' ? TIMING.refuse
    : mood === 'flustered' ? TIMING.flustered : TIMING.happy
  const limit=e.reason==='error'?gapLimits.recent(now):undefined
  if(limit){await setMood($,'idle');view.frame=limit.frame as FrameName;view.pose={name:limit.frame==='tea-a'?'tea':'waiting',frame:limit.frame,aside:limit.frame==='waiting'?WORDS[view.lang].aside.waiting:c3Word(view.lang,'aside.tea'),at:now};offerLine($,limit.request)}
  else await setMood($, mood, hold)
  visits.turn(now, e.durationMs)
  if (e.reason === 'answer' || e.reason === 'refusal') visits.task(now, e.durationMs)
  await visitDecide($, now)
  presenceActivity($)
  countBookCache(e)
  if (reminderSettings(storedSettings).week) await optional($, 'store.set.week', () => recordWeek(bookEngine($), weekTally, localDay(now, timeZone), view.lang), undefined)
  else weekTally.clear()
  const turns = Number((await optional($, 'store.turns', () => $.store.get('turns'), undefined)) ?? 0) + 1
  await optional($, 'store.set.turns', async () => { await $.store.set('turns', turns) }, undefined)
  bookSettingsChanged(bookEngine($))
  await optional($, 'store.set.lastActive', async () => { await $.store.set('lastActive', now) }, undefined)
  await gauge($, undefined, e.reason === 'answer' || e.reason === 'refusal')
  if(own!==d1Epoch)return
  await carriedRecord($)
  // Every completed main turn returns to reading while helpers remain out,
  // including the legacy refusal and hundredth-page speech branches below.
  const helpersStillOut=(d1?.snapshot().runningHelpers??0)>0
  if(helpersStillOut)await setMood($,'idle')
  if(d1?.snapshot().longTask&&reminderSettings(storedSettings).longTask!=='off'){await d1Long($);await push($);return}
  if (e.reason === 'error') {
    if(gapLimits.recent(now))return
    // A second turn in a row stopped by an error is serious: no more jokes (owner 10-14).
    if (erroredBefore) { cocoAct('serious'); await push($) }
    return say($, erroredBefore ? 'serious' : 'error')
  }
  if (e.reason === 'refusal') {
    return say($, 'refuse')
  }
  if (e.reason === 'aborted') {
    failures = 0
    wildPending = false
    return say($, 'aborted')
  }
  if (ABSOLUTELY_RIGHT.test(e.answer)) {
    return say($, 'absolutely_right')
  }
  if((lineSlot.visible(now)?.class??0)>=1)modGaps.lineShown(lineSlot.visible(now)!.class)
  const closing=await modGaps.close({reason:e.reason,at:now,day:localDay(now,timeZone),hour:localHour(now,timeZone),lang:view.lang,
    choice:{voice:view.voice,marks:latest.marks??'on',band:view.band,surface:c3Surface??'',affection:view.affection},
    store:{get:key=>$.store.get(key),set:(key,value)=>$.store.set(key,value as never)},pick,
    claim:()=>claimM1($,'closing',now,1200000,localDay(now,timeZone)),
    mirror:(id,value)=>$.state.set({plugin:'coco',key:'close',id},value)})
  if(closing){if(c3Surface==='terminal')offerLine($,closing.request);else{lineSlot.dismiss('ambient',now);view.said=null;localLineUntil=0;settingLineUntil=0;projectLine($);$.ui.invalidate('ui.render')}return}
  if (turns % 100 === 0) return say($, 'milestone', { pages: turns })
  if(helpersStillOut)return
  if (e.durationMs >= TIMING.doneLong) return say($, 'done_long')
  if (e.durationMs >= TIMING.done) return say($, 'done')
}

// Each touch keeps the task's pose. The picture owns its end, so CSS modes
// never schedule a plugin frame redraw when the gesture settles.
function clearPoke(): void {
  stop('poke'); stop('pokeLine'); stop('burstLine'); stop('touchFace')
  if (!poked) return
  poked = undefined
  pictureSerial++; pictureStrings.clear()
}

function beginWake($: Engine, at: number, id: string): void {
  moodGeneration++
  if (view.mood === 'sleep') { view.mood = 'idle'; view.frame = STILL.idle }
  wakingAt = at; wakingId = id
  pictureMood = view.mood; pictureEpoch = at; pictureVariant = pickMotionVariant(); pictureReady = true
  pictureSerial++; pictureStrings.clear()
  stop('wakeEnd')
  timers.wakeEnd = scheduleAfter($, Math.max(0, at + 450 - clockSnapshot), () => {
    delete timers.wakeEnd
    if (wakingAt === at) wakingAt = undefined
  })
}

function terminalSnapshotFrame(snapshot: MotionSnapshot): FrameName {
  if (snapshot.frame === 'idle-reading' && snapshot.face === 'closed') return 'idle-blink'
  return terminalMotionFrame(snapshot.frame)
}

function currentMotion(now: number): MotionSnapshot {
  if (wakingAt !== undefined && now >= wakingAt + 450) wakingAt = undefined
  const options = bandMotionOptions({ mood: pictureMood, now, epoch: pictureEpoch, from: pictureFrom,
    variant: pictureVariant, wakingAt, touch: poked, pixel: view.band === 'compact', height: 64,
    reducedMotion, mode: ANIMATION_MODE })
  return sampleMotion(pictureMood, options.wakeElapsedMs ?? options.reactionElapsedMs ?? 0, pictureVariant,
    { ...options, moodElapsedMs: Math.max(0, now - pictureEpoch) })

}

async function touch($: Engine, requested: 'poke' | 'pat', requestId: string): Promise<void> {
  if (view.band === 'off') return
  const now = await snapshotNow($)
  const wasAsleep = presenceState?.asleep === true || view.mood === 'sleep'
  if (requested === 'poke' && now - lastPoke < 300 && !wasAsleep && !(wakingAt !== undefined && now < wakingAt + 450)) return
  if (wasAsleep) void background($, 'socks.marshmallow', earnSocks($, 'marshmallow'))
  const continuation = currentMotion(now)
  lastActivity = now
  if (requested === 'poke') lastPoke = now
  {
    pokeClicks = [...pokeClicks.filter(at => now - at <= 1500), now].slice(-3)
  }
  const burst = pokeClicks.length >= 3
  const wink = !burst && requested === 'poke' && !lastWink
    && motionHasFace(continuation.frame, 'wink', view.band === 'compact') && runtimeRandom() < 0.5
  if (requested === 'poke') lastWink = wink
  const kind: TouchKind = burst ? 'burst' : wink ? 'wink' : requested
  const urgent = ['waiting', 'question', 'error', 'wild', 'refuse'].includes(view.mood)
  if (wasAsleep) {
    beginWake($, now, `touch:band:${now}`)
    stop('sleep'); stop('clingy'); stop('loop'); stop('blink')
  }
  const wakeAt = wakingAt !== undefined && now < wakingAt + 450 ? wakingAt : undefined
  const reactionAt = Math.max(now, (wakeAt ?? -Infinity) + 450)
  const duration = Math.min(burst ? 2200 : requested === 'pat' ? 1400 : 1100, urgent ? 900 : Infinity)
  const key = burst ? 'poke_many' : requested === 'pat' ? 'pat' : 'poke'
  const lines = linesFor(view, key)
  const cursorKey = `${view.lang}:${key}`
  const next = pokeNext.get(cursorKey) ?? 0
  let line = wink ? undefined : lines.length ? lines[next % lines.length] : undefined
  if (line) pokeNext.set(cursorKey, (next + 1) % lines.length)
  if (poked?.kind === kind && now - poked.at < 1500) line = poked.line
  if (wakeAt !== undefined) line = sharedLineFor(view, 'wake', `touch:band:${wakeAt}`) ?? undefined
  poked = { kind, at: now, requestId, continuation: wasAsleep ? undefined : continuation, wakeAt, line, until: reactionAt + duration, signature: ++pictureSerial }
  pictureStrings.clear()
  ownTouchId = `touch:band:${now}`
  rebuildDesktopPictures($,false)
  redraw($, 'touch'); queueDesktopPictures($) // no fs, spawn, state write or timer before this point
  if (presence) void background($, 'presence.touch', presence.touch(burst ? 'burst' : requested, now))
  else {
    if (wasAsleep) void background($, 'touch.publish', publish($, false))
    armQuiet($)
  }
  stop('poke'); stop('pokeLine'); stop('burstLine'); stop('touchFace')
  if (reducedMotion) {
    const signature = poked.signature
    timers.touchFace = scheduleAfter($, Math.max(0, reactionAt + (burst ? 435 : 120) - now), () => {
      delete timers.touchFace
      if (poked?.signature !== signature) return
      pictureSerial++; pictureStrings.clear(); rebuildDesktopPictures($,false); redraw($, 'touch.face')
    })
  } else if (wakeAt !== undefined && cocoReady(view.outfit === 'B' ? 'B' : 'A')) {
    // Coco's touch is a play of its own (coco-motion.ts), drawn once the wake is over
    const signature = poked.signature
    timers.touchFace = scheduleAfter($, Math.max(0, reactionAt - now), () => {
      delete timers.touchFace
      if (poked?.signature === signature) redraw($, 'touch.face')
    })
  }
  if (reducedMotion || ANIMATION_MODE === 'swaps') timers.poke = scheduleAfter($, Math.max(0, reactionAt + duration - now), () => {
    delete timers.poke; if (poked) poked.until = 0
    pictureSerial++; pictureStrings.clear(); rebuildDesktopPictures($,false); redraw($, 'touch.end')
  })
  if (wakeAt !== undefined && !reducedMotion) {
    // These timers publish words, never the animated frames.
    const captured = poked.signature
    if (!presence) { stop('wakeLine'); timers.wakeLine = scheduleAfter($, Math.max(0, wakeAt + 220 - now), () => { delete timers.wakeLine; if (poked?.signature === captured) redraw($, 'wake.line') }) }
    if (burst) timers.burstLine = scheduleAfter($, Math.max(0, reactionAt - now), () => {
      delete timers.burstLine
      if (poked?.signature === captured) { poked.line = lines[0]; redraw($, 'burst.line') }
    })
  }
  if (line) timers.pokeLine = scheduleAfter($, Math.max(0, reactionAt + (urgent ? 2000 : 2600) - now), () => {
    delete timers.pokeLine; if (poked) { poked.line = undefined; redraw($, 'touch.line.end') }
  })
}
let lastWink = false

function settingLine(changes: PresenceSettings): string | undefined {
  if (changes.affection === 'clingy') return pick(`${view.lang}:set_clingy`, linesFor(view, 'set_clingy'))
  if (changes.affection === 'warm') return pick(`${view.lang}:set_warm`, linesFor(view, 'set_warm'))
  if (changes.voice === 'full' || changes.voice === 'light' || changes.voice === 'off') return pick(`${view.lang}:set_voice_${changes.voice}`, linesFor(view, `set_voice_${changes.voice}`))
  return undefined
}

function applySettings($: Engine, values: PresenceSettings): void {
  values = cocoSettings(values, cachedEngineSettings)
  // The stick is shared, never stored: it lives in the presence record and ends with its time.
  if ('stick' in values) {
    const { stick, ...rest } = values
    if (stick === null || stick === undefined) delete sharedSettings.stick; else sharedSettings = { ...sharedSettings, stick }
    void background($, 'stick.adopt', adoptStick($, stickOf(stick)))
    values = rest
  }
  const priorReminders=reminderSettings(storedSettings),priorTrim=priorReminders.trim
  if(values.longTask!==undefined&&values.longTask!==priorReminders.longTask)d1ReminderChoice++
  sharedSettings = { ...sharedSettings, ...values }
  storedSettings = { ...storedSettings, ...recordSettings(values) }
  if(reminderSettings(storedSettings).longTask!=='notify')clearCompanionLongTaskAuthorization()
  latest.settings={...latest.settings,...storedSettings,m1Always:alwaysSnapshot()}
  if(values.more!==undefined&&m1More){m1More.restore(values.more,m1More.agreed,m1More.today,clockSnapshot,true);if(m1More.isOn('look')){const work=m1More.registerLook(moreEngine($));if(work)void background($,'m1.look.shared',work)}if(presence)void background($,'m1.quiet.shared',presence.quietChanged())}
  syncM1Actions()
  if(values.more!==undefined&&anyMoreOn()){
    const generation=lifecycleGeneration,runtime=m1More
    void background($,'m1.words.shared',loadMoreWords(()=>$.fs.read(joinPath($.plugin.root,'hooks/more-text.json'))).then(loaded=>{
      if(!loaded||generation!==lifecycleGeneration||runtime!==m1More)return
      syncM1Actions();$.ui.invalidate('ui.render')
    }))
  }
  bookSettingsChanged(bookEngine($))
  for (const key of ['band', 'voice', 'affection', 'workSize'] as const) {
    const value = values[key]
    if (key === 'band' && (value === 'on' || value === 'compact' || value === 'off' || value === 'text')) view.band = value
    else if (key === 'voice' && (value === 'off' || value === 'light' || value === 'full')) view.voice = value
    else if (key === 'affection' && (value === 'warm' || value === 'clingy')) view.affection = value
    else if (key === 'workSize' && (value === 'same' || value === 'smaller')) view.workSize = value
  }
  if (values.bandBeforeOff === 'on' || values.bandBeforeOff === 'compact' || values.bandBeforeOff === 'text') lastBand = values.bandBeforeOff
  view = desktopLook(view)
  // What one session heard reaches the others; a session that heard nothing yet sends null, which clears nothing.
  if (values.heard !== undefined) heard = langOf(values.heard) ?? heard
  // Another session's shown language is a result, not a choice: Claude Code's setting, what he writes and the
  // system's language come first.
  const shared = () => languageOf(cachedEngineSettings.language, heard, ...locale, values.language)
  if (values.lang !== undefined) {
    langChosen = values.lang === 'auto' ? undefined : langOf(values.lang)
    if (langChosen) view.lang = langChosen
    else if (typeof values.language === 'string') view.lang = shared()
  }
  if (values.language !== undefined && !langChosen) view.lang = shared()
  if (values.marks !== undefined) latest.marks = marksFrom(values.marks)
  if (values.companionTarget === 'auto' || values.companionTarget === 'claude' || values.companionTarget === 'vscode') view.companionTarget = values.companionTarget
  if (typeof values.neighbours === 'boolean') view.neighbours = values.neighbours
  if (values.dockTile !== undefined) companionDock(values.dockTile === 'on')
  if (values.socks !== undefined) wearPair(values.socks)
  if (values.claudeForm !== undefined) wearForm(values.claudeForm)
  if (values.outfit === 'A' || values.outfit === 'B') view.outfit = values.outfit
  if (values.prefersReducedMotion !== undefined) reducedMotion = values.prefersReducedMotion === true
  m1More?.configure(view.lang,screenReader)
  syncLines($)
  syncCelebrationAside()
  if (typeof values.timeZone === 'string') timeZone = values.timeZone
  view.quotaTimeZone=timeZone
  languageChangeLimit($)
  if(values.band==='on'||values.band==='compact'||values.band==='off'||values.band==='text')activationOptions={...activationOptions,band:values.band}
  const selectedLanguage=values.lang==='auto'?'auto':langOf(values.lang), resolvedLanguage=langOf(values.language)
  if(selectedLanguage!==undefined)activationOptions={...activationOptions,language:selectedLanguage}
  if(resolvedLanguage!==undefined)activationOptions={...activationOptions,resolvedLanguage}
  hydrationRevision++
  view.verb = WORDS[view.lang].spinner[0] ?? view.verb
  refreshConfigLabels($)
  void background($,'settings.shared.record',writeSettingsRecord($,values))
  if(c3)void background($,'c3.settings.shared',c3.settingsChanged())
  if(notice)void background($,'notice.settings.shared',notice.settingsChanged())
  if(values.longTask==='off'){d1?.dismissLong();delete view.longTask;lineSlot.dismiss('long.done',clockSnapshot);projectLine($)}
  else if(view.longTask&&(values.longTask==='band'||values.longTask==='notify'))view.longTask={...view.longTask,mode:values.longTask}
  if('breathe' in values)void background($,'breathe.shared',syncBreath($))
  if(priorTrim&&!reminderSettings(storedSettings).trim)void background($,'d1.trim.shared.off',ensureD1Trim($).then(()=>reminderSettings(storedSettings).trim?undefined:d1Trim?.settingsChanged()))
  syncNeighbours($)
  if (view.band === 'off') { stop('loop'); stop('blink'); stop('sleep'); stop('clingy');stop('shed');stop('helperLeave');stop('glance');stop('c3Frames');stop('lineSlot');if(view.pose?.name==='ribbon-glance')delete view.pose;delete view.companionPose;delete view.companionLine;clearPoke() }
  if(values.more!==undefined)void background($,'m1.presence.shared',syncM1Presence($))
  syncM1Lively($)
  armQuiet($)
}

// ---------------------------------------------------------------- play: breathing, one stick, the wait at a limit
//
// Everything here is events and one-shots; nothing runs while idle. The desktop animates in the host's CSS, so
// only the terminal's breathing cell and ember row are redrawn by timers, and only while they are shown.

// A function declaration: the engine lets $ pass only to declared functions, and the split graph keeps none of a const arrow.
function playWords($: Engine): ReturnType<typeof loadC3Words> { return loadC3Words(() => $.fs.read(joinPath($.plugin.root, 'hooks/c3-text.json'))) }
let turnBeganAt = 0
// Work the host reports with no turn start seen here (a resumed desktop, another window): the breath's 20 s count from when it was first seen.
function hostWorking(next: boolean): void { if (next && !working) turnBeganAt = clockSnapshot; working = next }
let stickLitHere = 0
let rateLimitStopAt = 0
let limitOutAt = 0
let carriedFrom: { at: number; window: string } | undefined
function playView(patch: Partial<PlayState>): void {
  const next: Record<string, unknown> = { ...view.play, ...patch, at: clockSnapshot }
  for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key]
  if (Object.keys(next).some(key => key !== 'at')) view.play = next as PlayState; else delete view.play
}
function resetPlay(): void {
  stop('breathe'); stop('breathCell'); stop('stickEnd'); stop('stickRow'); stop('stickGone'); stop('stickOut'); stop('dragFace'); stop('dragWalk'); stop('pointerGlance')
  delete view.play; lineSlot.mute(false, clockSnapshot); rateLimitStopAt = 0; limitOutAt = 0; noRelightAt = 0; carriedFrom = undefined
}
function playAside(): string | undefined {
  const p = view.play
  if (!p) return undefined
  if (p.drag) return playWord(view.lang, p.drag.droppedAt === undefined ? 'aside.lifted' : p.drag.dx > 0 ? (p.drag.sigh ? 'aside.sigh' : 'aside.walkBack') : 'aside.home') || undefined
  if (p.relit?.turn && working) return playWord(view.lang, 'aside.relit') || undefined
  if (p.out !== undefined && clockSnapshot - p.out < 6000) return playWord(view.lang, 'aside.stickOut') || undefined
  if (p.stick && p.stick.endedAt === undefined) return playWord(view.lang, 'stick.aside', { time: p.stick.until }) || undefined
  return undefined
}

// Breathing: after 20 s of a main turn the incense's plume breathes six times a minute, until the turn ends or Claude needs him.
function breathAllowed(): boolean {
  return working && view.band !== 'off' && reminderSettings(storedSettings).breathe && view.mood !== 'waiting' && view.mood !== 'question' && clockSnapshot - turnBeganAt >= BREATH_AFTER_MS
}
function breathTick($: Engine): void {
  stop('breathCell')
  const breath = view.play?.breath
  if (!breath || c3Surface !== 'terminal') return
  const elapsed = Math.max(0, clockSnapshot - breath.since), cell = breathCell(elapsed, breath.still)
  if (cell !== breath.cell) { playView({ breath: { ...breath, cell } }); redraw($, 'breath') }
  timers.breathCell = scheduleAfter($, nextBreathStep(elapsed, breath.still), () => breathTick($))
}
async function syncBreath($: Engine): Promise<void> {
  const has = view.play?.breath !== undefined
  if (breathAllowed()) {
    if (has) return
    await playWords($)
    playView({ breath: { since: clockSnapshot, still: reducedMotion, cell: breathCell(0, reducedMotion) } })
    breathTick($)
    await push($)
  } else if (has) {
    stop('breathCell'); playView({ breath: undefined })
    await push($)
  }
}
function armBreath($: Engine, id: string): void {
  stop('breathe')
  turnBeganAt = clockSnapshot
  if (!reminderSettings(storedSettings).breathe) return
  const own = lifecycleGeneration
  timers.breathe = scheduleAfter($, BREATH_AFTER_MS, async () => { delete timers.breathe; if (own === lifecycleGeneration && working && turnId === id) await syncBreath($) })
}
function endBreath(): void {
  stop('breathe'); stop('breathCell')
  if (view.play?.breath) playView({ breath: undefined })
}

// One stick: lit for the person and shared by every open band; he says nothing of his own while it burns.
function stickView(stick: { startedAt: number; endsAt: number }, endedAt?: number): NonNullable<PlayState['stick']> {
  const until = clockText(stick.endsAt, view.lang, timeZone), word = playWord(view.lang, 'stick.word')
  return { startedAt: stick.startedAt, endsAt: stick.endsAt, until, tag: word ? `${word} ${until}` : until, ...(endedAt === undefined ? {} : { endedAt }) }
}
function stickRowTick($: Engine): void {
  stop('stickRow')
  const stick = view.play?.stick
  if (!stick || stick.endedAt !== undefined || c3Surface !== 'terminal') return
  const at = nextStickRowAt(stick, clockSnapshot)
  if (at === undefined) return
  timers.stickRow = scheduleAfter($, Math.max(0, at - clockSnapshot), () => { playView({}); redraw($, 'stick.row'); stickRowTick($) })
}
async function adoptStick($: Engine, value: { startedAt: number; endsAt: number } | undefined): Promise<void> {
  await playWords($)
  const now = await snapshotNow($)
  stop('stickEnd'); stop('stickRow'); stop('stickGone')
  if (!value || now >= value.endsAt) {
    if (view.play?.stick) { playView({ stick: undefined }); lineSlot.mute(false, now); bookPlayChanged(bookEngine($)); await push($) }
    return
  }
  playView({ stick: stickView(value) })
  lineSlot.mute(true, now); projectLine($)
  timers.stickEnd = scheduleAfter($, value.endsAt - now, () => stickEnded($, value))
  stickRowTick($)
  bookPlayChanged(bookEngine($))
  await push($)
}
async function stickEnded($: Engine, stick: { startedAt: number; endsAt: number }): Promise<void> {
  delete timers.stickEnd
  if (view.play?.stick?.endsAt !== stick.endsAt) return
  const at = clockSnapshot
  playView({ stick: stickView(stick, at) })
  lineSlot.mute(false, at); stop('stickRow')
  // The soft sound is the Mac's, played once, by the session that lit the stick.
  if (stick.endsAt === stickLitHere && reminderSettings(storedSettings).stickEnd === 'sound' && await $.fs.exists('/System/Library/CoreServices/SystemVersion.plist').catch(() => false)) void background($, 'stick.sound', $.audio.play({ asset: 'assets/sound/stick-end.wav' }))
  const note = playWord(view.lang, 'stick.end')
  if (note) offerLine($, { key: 'stick.end', text: note, class: 1, ttl: 14000 }, false)
  void background($, 'socks.strawberry', earnSocks($, 'strawberry'))
  if (working || view.band === 'off') await push($); else await setMood($, 'happy', 1200)
  timers.stickGone = scheduleAfter($, STICK_END_MS, async () => {
    delete timers.stickGone
    if (view.play?.stick?.endsAt !== stick.endsAt) return
    playView({ stick: undefined })
    if (presence && presenceState?.settings?.stick) void background($, 'presence.settings.stick', presence.settings({ stick: null }))
    delete sharedSettings.stick
    bookPlayChanged(bookEngine($))
    await push($)
  })
}
async function lightStick($: Engine, minutes: number): Promise<void> {
  await hydrate($)
  const at = await snapshotNow($), stick = { startedAt: at, endsAt: at + minutes * 60_000 }
  stickLitHere = stick.endsAt
  sharedSettings = { ...sharedSettings, stick }
  if (presence) void background($, 'presence.settings.stick', presence.settings({ stick }))
  await adoptStick($, stick)
}
async function putOutStick($: Engine): Promise<void> {
  await playWords($)
  if (!view.play?.stick) return
  const at = await snapshotNow($)
  delete sharedSettings.stick
  if (presence) void background($, 'presence.settings.stick', presence.settings({ stick: null }))
  await adoptStick($, undefined)
  if (playWord(view.lang, 'aside.stickOut')) {
    playView({ out: at })
    timers.stickOut = scheduleAfter($, 6000, async () => { delete timers.stickOut; playView({ out: undefined }); await push($) })
    await push($)
  }
}

// The wait at a limit, as Claude Code itself keeps it: his incense shows the spare stick and relights it; he sends nothing.
function limitWindow(): string {
  const spent = (view.quota?.rateLimits ?? []).filter(window => window.percentUsed >= 100)
  return (spent.find(window => window.kind === 'five_hour') ?? spent[0])?.kind ?? 'five_hour'
}
async function recordLimit($: Engine, row: LimitRecord): Promise<void> {
  const rows = limitRecords(await optional($, 'store.limitLog', () => $.store.get('limitLog'), undefined))
  await optional($, 'store.set.limitLog', async () => { await $.store.set('limitLog', [...rows, row].slice(-40)) }, undefined)
  bookPlayChanged(bookEngine($))
}
async function markLimitOut($: Engine): Promise<void> {
  const at = await snapshotNow($)
  if (limitOutAt && at - limitOutAt < 3_600_000) return
  limitOutAt = at
  await recordLimit($, { kind: 'out', at, window: limitWindow() })
}
async function noteWaitRow($: Engine, text: string): Promise<void> {
  const row = waitRow(text)
  if (!row) return
  await playWords($)
  const at = await snapshotNow($)
  if (row.kind === 'cancelled') {
    if (!view.play?.wait) return
    playView({ wait: undefined }); lineSlot.dismiss('limit.relight', at); projectLine($); await push($)
    return
  }
  await markLimitOut($)
  if (row.kind === 'reached') return
  const kind = limitWindow(), reset = (view.quota?.rateLimits ?? []).find(window => window.kind === kind)?.resetsAt
  const resetsAt = reset ? Date.parse(reset) : NaN
  const time = Number.isFinite(resetsAt) ? clockText(resetsAt, view.lang, timeZone) : row.time ?? ''
  if (view.play?.wait?.time === time) return
  playView({ wait: { at, time, ...(Number.isFinite(resetsAt) ? { resetsAt } : {}) } })
  const line = playWord(view.lang, 'limit.relight', { window: WORDS[view.lang].quota.kinds[kind] ?? kind, time })
  if (line) offerLine($, { key: 'limit.relight', text: line, class: 1, ttl: 0, slots: time ? [{ value: time, kind: 'value' }] : [], valid: () => view.play?.wait !== undefined }, false)
  await push($)
}
// Claude Code will not carry on by itself (its auto-continue is off): one note, once for this limit, and no relight is promised.
let noRelightAt = 0
async function noteNoRelight($: Engine): Promise<void> {
  const at = await snapshotNow($)
  if (noRelightAt && at - noRelightAt < 3_600_000) return
  noRelightAt = at
  await playWords($)
  const line = playWord(view.lang, 'limit.noRelight')
  if (line) offerLine($, { key: 'limit.noRelight', text: line, class: 1, ttl: 14000 }, false)
}
async function relightIncense($: Engine): Promise<void> {
  await playWords($)
  const at = await snapshotNow($), kind = limitWindow()
  rateLimitStopAt = 0
  carriedFrom = { at, window: kind }
  playView({ wait: undefined, relit: { at, turn: true } })
  lineSlot.dismiss('limit.relight', at); projectLine($)
  // The new window starts empty until the next measurement says otherwise.
  if (view.quota) view.quota = { ...view.quota, rateLimits: view.quota.rateLimits.map(window => window.kind === kind ? { ...window, percentUsed: 0 } : window) }
  // Their battery comes back full with it, out from under the bolt (lane C, 10-14).
  if (view.spentWindows?.includes(kind)) view.spentWindows = view.spentWindows.filter(spent => spent !== kind)
  presenceActivity($)
  await push($)
}
// The terminal's pointer over his picture (play-client.ts): drag him a few cells and he walks back; a glance toward the pointer.
let playClientFailed = false
// The desktop band's pointer clients (her touch rows, the press on her quota things), left out once the host faulted one.
let desktopPointerFailed = false
// Her touch rows each report the turns of a stroke; rubbing her is two turns inside 1.5 s across the rows (DECISIONS 1017).
let desktopTurns: number[] = [], lastDesktopPat = -Infinity
// The desktop surface keeps a hover until the band is redrawn under a new key (his report, 10-18: the cards stayed about a
// minute after the pointer left). A thing's pointer layer reports its leave and the thing is redrawn at once; her picture
// waits 2.5 s, so the pointer can still reach Poke, Pat and Close beside her.
let hoverEpochs: Record<string, number> = {}, pictureLeave: Timer | undefined
// The thing on the floor the pointer is on, from its pointer layer's enter and leave: the band draws that one's card.
let pointerOn: string | undefined
let thingCardClose: Timer | undefined
function leftHover($: Engine, kind: string): void {
  hoverEpochs = { ...hoverEpochs, [kind]: (hoverEpochs[kind] ?? 0) + 1 }
  redraw($, 'hover.leave')
}
// The bag's word for its band button is read with the bag's own words, once, by the picture worker after the first answer.
let bagWordsAsked = false
let lastGlanceAt = -Infinity
let dragTimes: number[] = []
function terminalPointerOn(): boolean {
  const settings = cachedEngineSettings as Record<string, unknown>
  return !playClientFailed && (settings.mouse === true || settings.terminalMouse === true)
}
function dragWalk($: Engine): void {
  stop('dragWalk')
  const drag = view.play?.drag
  if (!drag || drag.droppedAt === undefined) return
  const gap = drag.droppedAt + 420 - clockSnapshot, own = lifecycleGeneration
  const step = (ms: number, work: () => void) => { timers.dragWalk = scheduleAfter($, ms, () => { delete timers.dragWalk; if (own === lifecycleGeneration) work() }) }
  if (reducedMotion) { step(Math.max(0, gap), () => { playView({ drag: undefined }); d1Sync($); redraw($, 'drag.home') }); return }
  step(Math.max(0, gap), function walk() {
    const now = view.play?.drag
    if (!now || now.droppedAt === undefined) return
    if (now.dx <= 0) { step(130, () => { playView({ drag: undefined }); d1Sync($); redraw($, 'drag.home') }); return }
    playView({ drag: { ...now, dx: now.dx - 1 } }); d1Sync($); redraw($, 'drag.walk')
    step(now.dx - 1 <= 2 ? 140 : 90, walk)
  })
}
async function playPointer($: Engine, data: unknown): Promise<void> {
  const post = data !== null && typeof data === 'object' ? data as { t?: unknown; dx?: unknown; side?: unknown } : {}
  const at = await snapshotNow($)
  if (post.t === 'glance') {
    if ((post.side !== 'left' && post.side !== 'right') || at - lastGlanceAt < 2000 || view.mood === 'sleep' || view.play?.drag) return
    lastGlanceAt = at
    playView({ glance: { at, side: post.side } }); redraw($, 'glance')
    stop('pointerGlance')
    timers.pointerGlance = scheduleAfter($, 450, () => { delete timers.pointerGlance; playView({ glance: undefined }); redraw($, 'glance.end') })
    return
  }
  if (post.t === 'drag' && typeof post.dx === 'number' && Number.isFinite(post.dx)) {
    const dx = Math.max(0, Math.min(12, Math.round(post.dx))), held = view.play?.drag
    if (held?.droppedAt !== undefined) stop('dragWalk')
    const began = held && held.droppedAt === undefined ? held.at : at
    if (!held || held.droppedAt !== undefined) {
      if (presenceState?.asleep || view.mood === 'sleep') { presenceActivity($); if (!presence) await setMood($, 'idle') }
      delete view.pose; stop('pointerGlance'); lineSlot.dismiss('dragged', at)
      stop('dragFace'); timers.dragFace = scheduleAfter($, 280, () => { delete timers.dragFace; if (view.play?.drag && view.play.drag.droppedAt === undefined) { playView({}); redraw($, 'drag.face') } })
    }
    playView({ drag: { dx, at: began } }); d1Sync($); redraw($, 'drag')
    return
  }
  if (post.t === 'drop') {
    const drag = view.play?.drag
    if (!drag || drag.droppedAt !== undefined) return
    stop('dragFace')
    if (drag.dx < 2) { playView({ drag: undefined }); d1Sync($); redraw($, 'drag.drop'); return }
    dragTimes = [...dragTimes.filter(time => at - time < 60_000), at]
    // The third drag inside a minute gets no line, only a sigh as he walks back.
    const third = dragTimes.length >= 3
    playView({ drag: { ...drag, droppedAt: at, ...(third ? { sigh: true } : {}) } }); d1Sync($)
    if (!third) {
      await playWords($)
      const line = c3Word(view.lang, 'dragged', Math.floor(runtimeRandom() * 1000))
      if (line) offerLine($, { key: 'dragged', text: line, class: 0, ttl: 5000 }, false)
    }
    redraw($, 'drag.drop'); dragWalk($)
  }
}
// His face while lifted: startled for 280 ms, the book held up until he is let go, then flustered for 420 ms.
function playDragFrame(drawn: View): FrameName | undefined {
  const drag = drawn.play?.drag, at = drawn.play?.at
  if (!drag || at === undefined) return undefined
  if (drag.droppedAt === undefined) return at - drag.at < 280 ? 'error' : 'refuse'
  return at - drag.droppedAt < 420 ? 'flustered' : undefined
}
async function carriedRecord($: Engine): Promise<void> {
  if (view.play?.relit) playView({ relit: undefined })
  const from = carriedFrom
  if (!from) return
  carriedFrom = undefined
  const at = clockSnapshot, five = view.quota?.rateLimits.find(window => window.kind === from.window)
  await recordLimit($, { kind: 'carried', at, minutes: Math.max(1, Math.round((at - from.at) / 60_000)), percent: five ? Math.round(five.percentUsed) : null, window: from.window })
}

// ---------------------------------------------------------------- commands

let companionTargetChoice = 0
let companionTargetMirror: Promise<unknown> = Promise.resolve()
function companionTargetOf(value: unknown): 'auto' | 'claude' | 'vscode' {
  return value === 'claude' || value === 'vscode' ? value : 'auto'
}

// The main conversation's compactions this session, for the itabag's vibe check (lane C, 10-14).
let compactions = 0
// This session's work for their vibe check (step 2): the main loop's tools by kind, helpers sent and back done, commits.
let vibeSession: { tools: Partial<Record<WeekKind, number>>; helpers: number; back: number; commits: number } = { tools: {}, helpers: 0, back: 0, commits: 0 }
const vibeFacts = () => ({ compacted: compactions, tools: { ...vibeSession.tools }, helpers: vibeSession.helpers, back: vibeSession.back, commits: vibeSession.commits })
let d1ReminderChoice = 0
// The pair from their sock drawer (the itabag's fourth page, lane C 10-14) onto the view, where the picture worker puts it on.
// Their drawer collects (owner 10-15): the first time a pair's thing happens it is theirs for good, kept in the shared
// settings like the pair they wear; in collect mode they say so on the band. The thirteen firsts are the owner's table
// (lanes/C.md, 10-15): matcha red to green, blueberry their LGTM, sesame a compaction, mint the thermos saving money,
// strawberry a whole focus, taro every paper plane back, marshmallow woken from a nap, goodgirl writing after 23:00,
// nude the 5-hour window spent, lan a busy neighbour, whitehat a guard warning, reddot their bag opened in the terminal.
// Two firsts can come in one moment (woken after 23:00); each is kept after the one before, so neither list
// overwrites the other.
const socksEarning = new Set<SockPair>()
let socksKept: Promise<void> = Promise.resolve()
async function earnSocks($: Engine, pair: SockPair): Promise<void> {
  if (pair === 'honmei' || socksEarned(storedSettings).includes(pair) || socksEarning.has(pair)) return
  socksEarning.add(pair)
  const turn = socksKept.then(() => keepSocks($, pair))
  socksKept = turn.catch(() => undefined)
  try { await turn } finally { socksEarning.delete(pair) }
}
async function keepSocks($: Engine, pair: SockPair): Promise<void> {
  if (socksEarned(storedSettings).includes(pair)) return
  const collecting = sockMode(storedSettings) === 'collect' && !socksOpen(storedSettings).includes(pair)
  await keepEarnedSocks($, [...socksEarned(storedSettings), pair])
  // the pairs' names are B's, read with the panel's words; the first pair can come before the panel ever opened
  await loadBagWords(() => $.fs.read(joinPath($.plugin.root, 'hooks/bag-text.json')))
  const name = bagWords(view.lang)?.socks[SOCK_PAIRS.indexOf(pair)], line = name ? playWord(view.lang, 'socks.earned', { pair: name }) : ''
  if (!collecting || !line) return
  // Their own words, said once: they wait behind whatever is on the band, show for 14 seconds once drawn, are not said during a focus, and are let go if a minute passes first.
  const made = await snapshotNow($)
  offerLine($, { key: 'socks.earned', text: line, class: 0, once: true, valid: () => clockSnapshot < made + 60000 })
}
// The earned pairs are kept like a setting (their record, every window, the companion) but without republishing their
// view the way a choice does: a first can come just as /coco more opens, and that publish reopened the settings
// page under More (m1-integration). Only the drawer reads them, so the open bag is redrawn.
async function keepEarnedSocks($: Engine, earned: SockPair[]): Promise<void> {
  await hydrate($)
  // The shared record drops touches older than its last write, so this write keeps the touches' clock.
  const at = await snapshotNow($)
  hydrationRevision++
  const changes = { socksEarned: earned } as PresenceSettings
  storedSettings = { ...storedSettings, ...changes }
  sharedSettings = { ...sharedSettings, ...changes }
  latest.settings = { ...latest.settings, ...changes }
  bookSettingsChanged(bookEngine($))
  void background($, 'settings.record', writeSettingsRecord($, changes))
  if (presence) void background($, 'presence.settings.socks', presence.settings(changes, at))
}
// Their bag opened in the terminal gives them the reddot pair. Checked after the press or command that opened it:
// state written while a ui.render hook draws is refused, so the pane's drawing never earns it.
function bagSeen($: Engine): void {
  if (bagOpenInTerminal() && !socksEarned(storedSettings).includes('reddot')) void background($, 'socks.reddot', earnSocks($, 'reddot'))
}
// The 5-hour window spent for the first time gives them the nude pair.
function spentSocks($: Engine): void {
  if (view.spentWindows?.includes('five_hour') && !socksEarned(storedSettings).includes('nude')) void background($, 'socks.nude', earnSocks($, 'nude'))
}
function wearPair(value: unknown): void {
  const pair = sockPair(value)
  if (pair && pair !== 'honmei') view.socks = pair; else delete view.socks
}
// Claude's form: Claudie or maid Claudie on the desktop band (claudie.ts); Coco, or anything else, leaves it to Coco.
function wearForm(value: unknown): void {
  const form = claudieForm(value)
  if (form) view.claudie = form; else delete view.claudie
}
async function chooseReminder($: Engine, key: string, value: boolean | number | string): Promise<void> {
  const longTaskChoice=key==='longTask',choice=longTaskChoice?++d1ReminderChoice:0,own=d1Epoch
  const latestChoice=()=>own===d1Epoch&&choice===d1ReminderChoice
  const currentChoice=()=>latestChoice()&&reminderSettings(storedSettings).longTask===value
  await hydrate($)
  if(longTaskChoice&&!latestChoice())return
  hydrationRevision++
  const changes = { [key]: value } as PresenceSettings
  storedSettings = { ...storedSettings, ...changes }
  if(longTaskChoice&&reminderSettings(storedSettings).longTask!=='notify')clearCompanionLongTaskAuthorization()
  sharedSettings = { ...sharedSettings, ...changes }
  if (key === 'neighbours') view.neighbours = value === true
  if (key === 'socks') wearPair(value)
  if (key === 'claudeForm') { wearForm(value); syncLines($) }
  latest.settings = settingsForBook()
  bookSettingsChanged(bookEngine($))
  void background($, 'settings.record', writeSettingsRecord($, changes))
  if (presence) void background($, 'presence.settings.reminders', presence.settings(changes))
  await runtimeC3($).settingsChanged();await runtimeNotice($).settingsChanged()
  if(longTaskChoice&&!currentChoice())return
  if(key==='breathe')await syncBreath($)
  if(key==='trim'&&value===false){await ensureD1Trim($);await d1Trim?.settingsChanged()}
  if(key==='week'&&value===false){weekTally.clear();await optional($,'store.delete.week',()=>$.store.delete(WEEK_STORE),undefined)}
  if(key==='longTask'&&value==='off'){d1?.dismissLong();delete view.longTask;lineSlot.dismiss('long.done',clockSnapshot);projectLine($)}
  else if(key==='longTask'&&view.longTask&&(value==='band'||value==='notify'))view.longTask={...view.longTask,mode:value}
  if(longTaskChoice&&value==='notify'&&await companionHere($)&&currentChoice())await feedCompanion($,()=>companionRequestText(present(view),companionId,c3Surface==='desktop',clockSnapshot,{longTaskAuthorizationRequest:clockSnapshot}),currentChoice)
  if(longTaskChoice&&!currentChoice())return
  syncNeighbours($)
  projectLine($)
  await push($)
}

async function chooseCompanionTarget($: Engine, target: 'auto' | 'claude' | 'vscode'): Promise<void> {
  const choice = ++companionTargetChoice
  hydrationRevision++
  view.companionTarget = target
  sharedSettings = { ...sharedSettings, companionTarget: target }
  void background($, 'settings.record', writeSettingsRecord($, { companionTarget: target }))
  if (presence) void background($, 'presence.settings.target', presence.settings({ companionTarget: target }))
  await push($)
  // Keep the existing book's store event contract; this is a write-only mirror.
  // Hydration and rendering read only the batched record.
  companionTargetMirror = companionTargetMirror.catch(() => undefined).then(async () => {
    if (choice !== companionTargetChoice || view.companionTarget !== target) return
    return optional($, 'store.set.companionTarget', () => $.store.set('companionTarget', target), undefined)
  })
  void background($, 'store.set.companionTarget', companionTargetMirror)
}

async function choose($: Engine, picked: Partial<Pick<View, 'band' | 'voice' | 'affection' | 'workSize'>>): Promise<void> {
  // the desktop band is always the painted one at full size (owner 10-19): a pixel or smaller choice there changes nothing
  if (c3Surface === 'desktop') picked = { ...picked, ...(picked.band === 'compact' ? { band: 'on' as const } : {}), ...(picked.workSize === 'smaller' ? { workSize: 'same' as const } : {}) }
  if(picked.voice!==undefined)storedSettings.voiceChosen=true
  if (picked.band === 'off') { if (view.band !== 'off') lastBand = view.band }
  else if (picked.band) lastBand = picked.band
  hydrationRevision++
  const changes = Object.fromEntries(Object.entries(picked).filter(([key,value]) => view[key as keyof View] !== value)) as PresenceSettings
  const at = await snapshotNow($)
  if (!presence && view.mood === 'sleep' && picked.band !== 'off') beginWake($, at, `settings:local:${at}`)
  if (!presence) lastActivity = at
  Object.assign(view, picked)
  view = desktopLook(view)
  if(picked.band) activationOptions={...activationOptions,band:picked.band}
  const changedLine = settingLine(changes)
  if (changedLine) { view.said = changedLine; settingLineUntil = localLineUntil = at + TIMING.say; clearPoke() }
  if (view.band === 'off') { clearPoke(); stop('loop'); stop('blink'); stop('sleep'); stop('clingy');stop('shed');stop('helperLeave');stop('glance');stop('c3Frames');stop('lineSlot');if(view.pose?.name==='ribbon-glance')delete view.pose;delete view.companionPose;delete view.companionLine }
  // Project in operation order; SharedPresence waits for its changed/redraw
  // callback before doing durable I/O, while overlapping choices still merge.
  if (presence) void background($, 'presence.settings', presence.settings({ ...picked, ...(picked.voice!==undefined?{voiceChosen:true}:{}), bandBeforeOff: lastBand }))
  void background($,'settings.record',writeSettingsRecord($,{...picked,...(picked.voice!==undefined?{voiceChosen:true}:{}),bandBeforeOff:lastBand}))
  if(picked.band) void background($,'config.band', $.config.set({key:'coco.band',value:picked.band}))
  await push($)
  if (changedLine) expireLines($, await snapshotNow($))
  if (view.band !== 'off') { animate($);d1ShedDeadline($,d1CompactSerial);d1HelperDeadline($);if(picked.band)expireLines($,clockSnapshot);armQuiet($) }

}

// /coco lang <code>|auto: a language picked by hand wins over the settings and the locale
// until `auto`. Returns the reply, in the language he reads from now on.
async function chooseLang($: Engine, value: string): Promise<string> {
  const codes = LANGS.map(l => l.code).join(' ')
  if (value === '') return `lang: ${view.lang} (${codes} auto)`
  const picked = value === 'auto' ? undefined : langOf(value)
  if (value !== 'auto' && picked === undefined) return fill(WORDS[view.lang].reply.unknown, { value, codes }) ?? ''
  hydrationRevision++
  langChosen = picked
  view.lang = picked ?? languageOf(cachedEngineSettings.language, heard, ...locale)
  activationOptions={...activationOptions,language:picked??'auto',resolvedLanguage:view.lang}
  void background($,'settings.record',writeSettingsRecord($,{lang:picked??'auto',language:view.lang}))
  void background($,'config.language',$.config.set({key:'coco.language',value:picked??'auto'}))
  view.verb = WORDS[view.lang].spinner[0] ?? view.verb
  refreshConfigLabels($)
  languageChangeLimit($)
  await push($)
  if (presence) void background($, 'presence.settings.lang', presence.settings({ lang: picked ?? 'auto', language: view.lang }))
  return picked ? WORDS[view.lang].reply.lang : WORDS[view.lang].reply.auto
}

// ---------------------------------------------------------------- hooks

function desktopIdentity($:Engine,e:RenderInput<'AbovePrompt','desktop'|'vscode'|'mobile'>):RenderElement {
  const { Text }=$.ui.resolve(e)
  return <Text>{(WORDS[view.lang]??WORDS.en).name}</Text>
}
// The desktop band's middle tier, when its full tree could not be built: Coco's idle still and their name (the name
// alone before any of their data is installed).
function desktopStillBand($:Engine,e:RenderInput<'AbovePrompt','desktop'|'vscode'|'mobile'>):RenderElement {
  const { Box, Svg, Text }=$.ui.resolve(e),name=(WORDS[view.lang]??WORDS.en).name,still=view.claudie&&claudieReady(view.claudie)?claudieSvg(view.claudie,'idle',cocoWidth(64),64):cocoStill(view.outfit==='B'?'B':'A','idle',64)
  return <Box flexDirection="row" alignItems="center">{still?<Svg source={still} width={cocoWidth(64)} height={64} alt={name}/>:null}<Text>{name}</Text></Box>
}
function renderDesktop($:Engine,e:RenderInput<'AbovePrompt','desktop'|'vscode'|'mobile'>):RenderElement {
  const enteredAt=Date.now(), steps:Record<string,number>={}
  const renderCount=++latest.desktopRenders
  let pictureHeight=0
  desktopEntered=true
  try { reaskTimer?.cancel() } catch { /* generation guard also disarms a stale callback */ }
  reaskTimer=undefined
  let drawn=initialView()
  const result=safeDesktopTree(()=>{
    const started=Date.now()
    drawn=present(normalizeDesktopView(view,initialView(),PREBUILT_FRAME_NAMES))
    if(e.props.isWorking && ['idle','sleep'].includes(drawn.mood)) drawn={...drawn,mood:'think',frame:'think-a'}
    drawn=costumed(drawn,clockFromEngine?clockSnapshot:undefined,e.props.isWorking,true)
    drawn=squashedView(drawn,clockSnapshot)
    steps.snapshotMs=Date.now()-started
    // VS Code and the phone have no Client: their band is the desktop's without the pointer layers.
    const ui=$.ui.resolve(e) as Elements['desktop'], { Box }=ui
    if(e.props.hasSurvey){ bands.set(e.requestId,null); return <></> }
    if(drawn.band==='off'){
      bands.set(e.requestId,null)
      pictureHeight=32
      return desktopDoor(ui,drawn,()=>choose($,{band:lastBand}))
    }
    validateDesktopTree({type:'Text',children:[drawn.said??'']})
    desktopRequests.set(e.requestId,e)
    while(desktopRequests.size>32)desktopRequests.delete(desktopRequests.keys().next().value!)
    const now=clockSnapshot, localTouch=poked?.requestId===e.requestId?poked:undefined
    const reactionAt=localTouch?Math.max(localTouch.at,(localTouch.wakeAt??-Infinity)+450):Infinity
    const line=localTouch?(reducedMotion||localTouch.wakeAt===undefined||now>=localTouch.wakeAt+220?localTouch.line:''):undefined
    if(localTouch&&now<localTouch.until&&now>=reactionAt)drawn={...drawn,touch:localTouch.kind==='wink'?'poke':localTouch.kind}
    drawn=coffeeBreak(drawn)
    const bagEntry=bagWords(drawn.lang)?.entry
    if(bagEntry)drawn={...drawn,bagEntry}
    if(Object.keys(hoverEpochs).length)drawn={...drawn,hoverEpochs}
    if(pointerOn)drawn={...drawn,pointerOn}
    // a visitor's own direction (presentBase) stays: the drawn picture's words would name Coco's nap instead of it
    if(!drawn.claudie&&!(drawn.visit&&drawn.stageDirection))drawn={...drawn,drawnAside:DRAWN_ASIDE[cocoWanted(drawn,e.props.isWorking,now).action](drawn.lang,drawn)}
    const size={columns:e.props.bodyColumns,maxRows:e.props.maxRows,screenRows:e.viewport?.rows??40,isWorking:e.props.isWorking}
    const layoutAt=Date.now(),plan=planDesktop(drawn,size,line)
    pictureHeight=plan.height
    steps.layoutMs=Date.now()-layoutAt
    bands.set(e.requestId,plan.height?'svg':null)
    const pictureAt=Date.now(), pixel=drawn.band==='compact'
    const coco=plan.height?cocoBand(drawn,e.props.isWorking,now,plan.height,heldLimitPose(drawn)):undefined
    if(coco!==undefined)cocoShown=cocoAsked
    let sprite=coco??''
    // No rain pane behind Coco: the old figure's window sat askew on their canvas as a dark square (his card, 10-18)
    if(coco!==undefined&&plan.height&&!pixel&&drawn.night)sprite=dressPicture(sprite,{night:true,rain:false,glasses:false},COCO_DRESS)
    // Coco: the same perches, moved and scaled from the old figure's box onto theirs (both bands draw them painted)
    if(coco!==undefined&&drawn.visit&&plan.height)sprite=visitorPicture(sprite,drawn.visit,{pixel:false,reduced:reducedMotion,now,place:drawn.visit.kind==='note'?COCO_NOTE_PLACE:COCO_VISIT_PLACE})
    steps.pictureMs=Date.now()-pictureAt
    // Her touch rows and the press on her quota things (DECISIONS 1017), left out once the host faulted one.
    const { Client }=ui
    const clients:DesktopClients|undefined=desktopPointerFailed||e.surface!=='desktop'?undefined:{
     touch:(row,columns)=><Client key={'coco:touch:'+row} module="./play-client.ts" props={{mode:'desktop'}} width={columns} height={1}/>,
     press:(kind,columns)=><Client key={'coco:press:'+kind} module="./play-client.ts" props={{mode:'press'}} width={columns} height={1}/>,
    }
    const buildAt=Date.now(),tree=<Box flexDirection="column">{desktopBand(ui,drawn,size,sprite,plan,line,clients,e.surface==='desktop'?false:e.surface)}</Box>
    steps.buildMs=Date.now()-buildAt
    return tree
  },()=>desktopStillBand($,e),()=>desktopIdentity($,e))
  noteD1DesktopShedTree(e.requestId,result.tree,result.fallback==='full',drawn)
  steps.validationMs=result.validationMs
  steps.totalMs=Date.now()-enteredAt
  firstDesktopReturnAt??=enteredAt+steps.totalMs
  if(!e.props.hasSurvey&&drawn.band!=='off'&&e.surface!=='desktop'&&result.fallback==='full'&&!latest.bandDrawnOn.has(e.surface)){
    // the first painted band on VS Code or the phone: the heads drawn so far go quiet, and Coco's lines move to the band
    latest.bandDrawnOn.add(e.surface)
    scheduleAfter($,0,()=>{$.ui.invalidate('ui.render')})
  }
  if(!e.props.hasSurvey&&drawn.band!=='off'){
    desktopWorking=e.props.isWorking
    firstDesktopAnswered=true;firstAnswerResolve?.();firstAnswerResolve=undefined
    signalPictureRequest()
  }
  // Candidate exists and was validated before diagnostics can touch any engine noun.
  diagnose($,'band',undefined,{requestId:e.requestId,surface:e.surface,isWorking:e.props.isWorking,
    bodyColumns:e.props.bodyColumns,maxRows:e.props.maxRows,style:drawn.band==='compact'?'pixel':'painted',
    height:result.fallback==='still'?64:result.fallback==='name'?0:pictureHeight,fallback:result.fallback,version:publishedVersion})
  diagnose($,'hook.entry',undefined,{requestId:e.requestId,surface:e.surface,enteredAt})
  diagnose($,'returned-tree',undefined,{requestId:e.requestId,surface:e.surface,fallback:result.fallback,renderCount,steps,
    ...(firstBand?{startup:{...startupTimings,registerToFirstRenderMs:firstDesktopReturnAt-registeredAt}}:{})})
  if(firstBand&&!e.props.hasSurvey&&diagnose($,'first-band:returned',undefined,{requestId:e.requestId},true))firstBand=false
  if(result.fallback==='full'&&!e.props.hasSurvey&&drawn.band!=='off')acknowledgeC3($,drawn,result.tree)
  c3FrameDeadline($)
  d1ShedDeadline($,d1CompactSerial);d1HelperDeadline($)
  return result.tree
}
async function renderOtherBand($:Engine,e:RenderInput<'AbovePrompt'>,next:(e:RenderInput<'AbovePrompt'>)=>Promise<RenderElement>):Promise<RenderElement> {
  const enteredAt=Date.now()
  if(e.props.hasSurvey){if(e.surface==='terminal'){bands.set(e.requestId,null);syncM1Lively($)}return next(e)}
  if(e.surface!=='terminal')return next(e)
  await hydrate($)
  if(view.band!=='off'&&textBandMode(e.surface,view.band,screenReader)){bands.set(e.requestId,null);stop('loop');stop('blink');syncM1Lively($);return renderTextBand($.ui.resolve(e),gapCharacterName(view.lang),view.lang,lineSlot.visible(clockSnapshot))}
  let drawn=present(normalizeDesktopView(view,initialView(),PREBUILT_FRAME_NAMES))
  if(!turnId){hostWorking(e.props.isWorking);if(working&&['idle','sleep'].includes(drawn.mood))drawn={...drawn,mood:'think',frame:'think-a'}}
  setTerminalLook({outfit:drawn.outfit==='B'?'B':'A',...(drawn.socks?{socks:drawn.socks}:{}),dark:!(drawn.theme??'').startsWith('light'),...(shortBlocks?{short:true}:{})})
  if(drawn.band==='off'){bands.set(e.requestId,null);syncM1Lively($);return terminalDoor($.ui.resolve(e),drawn,()=>choose($,{band:lastBand}))}
  const theirs=await optional($,'band.next',()=>next(e),<></>)
  const size={columns:e.props.bodyColumns,maxRows:e.props.maxRows-rowsOf(theirs),screenRows:e.viewport?.rows??40,isWorking:e.props.isWorking}
  const ui=$.ui.resolve(e),{ Box,Client }=ui,at=await snapshotNow($)
  drawn=costumed(drawn,at,e.props.isWorking)
  drawn=squashedView(drawn,at,true)
  if(!heldLimitPose(drawn)&&!reducedMotion&&wakingAt!==undefined&&at<wakingAt+450)
    drawn={...drawn,frame:terminalSnapshotFrame(sampleMotion('idle',at-wakingAt,pictureVariant,{waking:true}))}
  const lifted=playDragFrame(drawn)
  if(lifted)drawn={...drawn,frame:lifted}
  const pointed=!!drawn.play?.glance&&!lifted&&at-drawn.play.glance.at<450
  const glance=pointed||!!drawn.pose&&(drawn.pose.name==='glance'||drawn.pose.name==='ribbon-glance')&&(drawn.pose.name==='glance'||at-drawn.pose.at>=120&&at-drawn.pose.at<720)
  const sprite=terminalHasSprite(drawn,size),idlePixel=drawn.pictures!=='kitty'
  const visitOverlay=drawn.visit&&drawn.mood==='sleep'&&sprite?visitorCellOverlay(drawn.visit.kind,drawn.colors,!(drawn.theme??'').startsWith('light')):undefined
  // Coco's pixel version draws every terminal picture (DECISIONS 917): half-block cells, or kitty and Ghostty's image
  const waking=!heldLimitPose(drawn)&&!reducedMotion&&wakingAt!==undefined&&at<wakingAt+450
  const special=lifted?(lifted==='flustered'?'dropped':'lifted'):waking?'waking':pointed?(drawn.play?.glance?.side==='left'?'glance-left':'glance-right'):glance?(drawn.pose?.name==='ribbon-glance'?'glance-left':'glance-right'):undefined
  const pixel=sprite?terminalPixel(drawn,e.props.isWorking,at,special):undefined
  // a visitor while they sleep stands on the ground to their right, and they move to the left edge
  const placed=visitOverlay?{...visitOverlay,x:TERMINAL_COLUMNS-(visitOverlay.rows[0]?.length??0),y:TERMINAL_ROWS*2-visitOverlay.rows.length}:undefined
  const pixelLook={outfit:pixel?.outfit??'A',...(drawn.socks?{socks:drawn.socks}:{}),dark:!(drawn.theme??'').startsWith('light'),colors:drawn.colors,...(shortBlocks?{short:true}:{})}
  const cells=pixel&&idlePixel?pixelCells(pixel.frame,pixel.other,pixelLook,placed,placed?-4:0):undefined
  const png=sprite&&!idlePixel&&pixel?pixelPng(pixel.frame,pixel.other,pixelLook,placed,placed?-4:0):undefined
  bands.set(e.requestId,sprite?(png?'image':'cells'):null)
  animate($)
  pixelDeadline($,pixel?.next)
  const pointer=sprite&&e.viewport?.isFullscreen===true&&terminalPointerOn()
  // One pointer client covers his picture: play-client.ts reads the drag, the glance, and M1's pat and poke.
  const tree=<Box flexDirection="column">{pointer?<Box height={0} position="relative"><Box position="absolute" left={0} top={0}><Client key="coco:terminal:play" module="./play-client.ts" width={png?imageColumns(TERMINAL_ROWS):TERMINAL_COLUMNS} height={TERMINAL_ROWS} props={{enabled:true}}/></Box></Box>:null}{terminalBand(ui,drawn,size,png,cells)}{theirs}</Box>
  acknowledgeC3($,drawn,tree);c3FrameDeadline($);d1ShedDeadline($,d1CompactSerial);d1HelperDeadline($)
  diagnose($,'band',undefined,{requestId:e.requestId,surface:'terminal',isWorking:e.props.isWorking,
    bodyColumns:e.props.bodyColumns,maxRows:e.props.maxRows,style:drawn.band==='compact'?'pixel':'painted',
    height:sprite?1:0,fallback:false,version:publishedVersion})
  diagnose($,'returned-tree',undefined,{requestId:e.requestId,surface:'terminal',fallback:'full',steps:{totalMs:Date.now()-enteredAt}})
  return tree
}

export const register: Register = (on, options) => {
  cost = undefined; costLoading = undefined; pendingCostStart = undefined; pendingCostTTL = undefined; pendingCostCrons = undefined; setCostSnapshot(undefined); delete view.cost
  cupInstances.clear()
  activationOptions = options
  latest.desktopRenders=0
  latest.settings={}
  view = optionsView(view)
  langChosen = langOf(options.language)
  latest.view = view
  latest.marks = marksFrom(undefined)
  // The skill cards register before Coco's first hook, so their hooks run outside Coco's own (cards/cards.tsx says why).
  registerCards(on, () => view.lang)
  on('command.describe',{command:'coco'},async($,e,next)=>{await loadGapWords(()=>$.fs.read(joinPath($.plugin.root,'hooks/gaps-text.json')));return {...await next(e),description:gapWord(view.lang,'cmd.coco')}})
  on('config.describe', { key:/^coco\.(band|language|resolvedLanguage)$/ }, ($,e) => describeCocoConfig(view.lang,e))
  // Observe the press outside the book's handlers, including handlers that consume it.
  on('ui.press', { plugin: 'coco' }, async ($, e, next) => {
    if(e.element==='coco:book:open'&&view.line?.key==='first.hello'){
      lineSlot.dismiss('first.hello',clockSnapshot);projectLine($)
      await openM1Book(bookEngine($),'him');await push($);bagSeen($)
      return {element:e.element}
    }
    const pressed = await next(e)
    if (e.element === 'coco:book:open') diagnose($, 'book.press', undefined, { surface: e.surface, ...takeBookPressReport() })
    bagSeen($)
    if (!e.element.startsWith('coco:band:poke') && !e.element.startsWith('coco:band:pat')) presenceActivity($)
    return pressed
  })
  on('command.run', async ($, e, next) => {
    const ran = await next(e)
    if (e.command === 'coco') { presenceActivity($); bagSeen($) }
    return ran
  })
  on('ui.close', { id: 'coco-book' }, async ($, e, next) => {
    const closed = await next(e)
    if (e.origin.kind === 'person') presenceActivity($)
    return closed
  })
  on('store.set', { key: /^(band|bandBeforeOff|voice|affection|workSize|lang|heard|marks|companionTarget|neighbours)$/ }, async ($, e, next) => {
    const set = await next(e)
    // A held old mirror must not roll the latest choice back through shared presence.
    const currentTarget = e.key !== 'companionTarget' || e.value === view.companionTarget
    if(next.origin.plugin==='coco'&&!('deny' in set)&&currentTarget){storedSettings={...storedSettings,[e.key]:e.value} as PresenceSettings; void background($,'settings.record',writeSettingsRecord($))}
    const settingsKeys = ['band','bandBeforeOff','voice','affection','workSize','lang','heard','marks','companionTarget','neighbours']
    if (next.origin.plugin === 'coco' && !('deny' in set) && settingsKeys.includes(e.key) && currentTarget && presence) {
      void background($, 'presence.store.settings', presence.settings({ [e.key]: e.value } as PresenceSettings))
    }
    return set
  })
  // His book (pages.tsx) and his marks on the engine's rows (transcript.tsx). First, so the book's
  // /coco hook stands outside the one below and sees the command first.
  setCheckSessionsReader(() => presence?.readSessions() ?? Promise.resolve([]))
  setPetProgramReader(petResolved)
  setIconSettingsWriter(persistIconMachineSettings)
  setCostBookReader(async now => { clockSnapshot = now; return cost?.book() })
  // Opening the price page is the one press that starts a timer (its six-second limit); the timer lives here.
  // The book's three target buttons choose here, not through `/coco companionTarget`: in his VS Code (10-19) a press that
  // ran the command left the choice as it was, while every other choice on the page took.
  on('ui.press', { element: /^coco:set:companionTarget:(auto|claude|vscode)$/ }, async ($, e) => {
    await chooseCompanionTarget($, companionTargetOf(e.element.split(':').at(-1)))
    return { element: e.element }
  })
  // VS Code's band (no hover there): a press on a thing opens its card, a second press or 6 s close it; the quota
  // things' card carries the button to their page, which the desktop opens on a click (owner 10-19).
  on('ui.press', { element: /^coco:thing:/ }, async ($, e) => {
    try { thingCardClose?.cancel() } catch { /* a spent timer */ }
    thingCardClose = undefined
    if (e.element === 'coco:thing:quota-page') { pointerOn = undefined; await openQuotaPage($); redraw($, 'thing.page'); return { element: e.element } }
    const thing = e.element.slice('coco:thing:'.length).replace(/#\d+$/, '')
    pointerOn = pointerOn === thing ? undefined : thing
    if (pointerOn) thingCardClose = scheduleAfter($, 6000, () => { thingCardClose = undefined; if (pointerOn === thing) { pointerOn = undefined; redraw($, 'thing.close') } })
    redraw($, 'thing.press')
    return { element: e.element }
  })
  on('ui.press', { element: 'coco:prices:open' }, ($, e, next) => {
    setPriceTimer((ms, fire) => { const timer = scheduleAfter($, ms, fire); return () => timer.cancel() })
    return next(e)
  })
  on('ui.render', { component: 'Pane', requestId: 'coco-book' }, ($, e, next) => oneBagDrawing(`${e.surface}:${e.props.bodyColumns}`, async () => {
    const started = Date.now()
    const held = (await $.state.get({ plugin: 'coco', key: 'book' })).value
    if (held?.page === 'offerings' || held?.page === 'settings') {
      const needsCostSetup = !cost && !costLoading
      const ready = await ensureCost($)
      if (ready && needsCostSetup) ready.measure(await $.session.usage().catch(() => ({})))
    }
    const tree = await next(e)
    // what came back (the book's own tree, or the engine's after the book failed) and what the book said it did
    const { error, ...report } = takeBookDrawReport() ?? {}
    diagnose($, error === undefined ? 'book.render' : 'error:book.render', error, { surface: e.surface, columns: e.props.bodyColumns, ms: Date.now() - started, root: tree && typeof tree === 'object' && 'type' in tree ? String(tree.type) : typeof tree, ...report })
    return tree
  }))
  registerBook(on)
  configureM1Transcript({closing:id=>modGaps.closings.get(id),restore:(id,value)=>modGaps.restoreClosing(id,value),limit:()=>gapLimits.display(clockSnapshot,view.lang,kind=>WORDS[view.lang].quota.kinds[kind]??kind,timeZone),screenReader:()=>screenReader,firstHead:headsSpeak,weekOn:()=>reminderSettings(storedSettings).week,today:()=>localDay(clockSnapshot,timeZone)});
  configureC3Transcript({state:()=>c3?.view(),pose:()=>c3HeadPose??view.pose,bandCarries:c3Visible})
  configureD1Transcript({ribbon:()=>view.ribbon?.visible?{index:view.ribbon.index,folder:view.ribbon.folder}:undefined,helperRow:id=>{const agent=d1Spawns.get(id);return !!agent&&d1?.snapshot().helpers.some(h=>h.agentId===agent&&h.state==='done')===true},shedLine:()=>d1RowsFirst?d1Word(view.lang,'shed.first'):undefined,shedShown:defer=>{d1RowsFirst=false;defer(()=>c3?.markOnce('shedFirst'))},trimRow:id=>d1Trim?.row(id),trimPress:key=>d1Trim?.press(key)??Promise.resolve(false),loadWords:read=>loadD1Words(read)})
  configureVisitTranscript({take:visitHeadFor})
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (cost) { await snapshotNow($); refreshCostView() }
    const tree = await next(e)
    costCupDrawn(e, tree)
    return tree
  })
  registerTranscript(on)

  on('session.start', async ($, e, next) => {
    delete view.companionPose;delete view.companionLine;d1CompactSerial++;d1Epoch++;d1DesktopShedTimelines.clear();d1RowsFirst=false;d1PresenceKnown=false;d1?.clear();d1=undefined;d1Ready=undefined;d1Session='';d1LongSaid='';d1Trim=undefined;d1TrimReady=undefined;d1Spawns.clear();delete view.ribbon;delete view.shed;delete view.longTask;delete view.helpers;delete view.stageDirection
    resetBookSession(); resetIconSession(); failedTest = false
    resetPlay()
    c3Surface=e.surface
    view = desktopLook(view)
    costInteractive = e.isInteractive
    presenceMetadata = { cwd: e.cwd, version: PLUGIN_VERSION }
    runtimeNotice($).sessionStart()
    const began=Date.now()
    beginLifecycle($, 'start')
    const serial=++sessionSerial
    // Optional work runs from a lifecycle-owned callback after this handler returns.
    scheduleAfter($,0,async()=>{
      void background($,'diagnostics.start',checkDiagnostics($,true).then(()=>{diagnose($,'session.start.begin')}))
      await Promise.all([
        background($,'boot',boot($,e.surface).catch(async error=>{caught($,'boot',error);await push($)})),
        background($,'cards.start',cardsStarted($,e.cwd)),
        loadGapWords(()=>$.fs.read(joinPath($.plugin.root,'hooks/gaps-text.json'))).then(async loaded=>{
          // The command belongs to the session, so an attach in between does not drop it.
          if(!loaded||serial!==sessionSerial)return
          await Promise.all([
            optional($,'command.register',()=>$.command.register({name:'coco',description:gapWord(view.lang,'cmd.coco'),argumentHint:'[voice|warmth|band|lang|vibe|dm|focus|about|companion|icon|more|say|cards] [value]'}),undefined),
          ])
        }),
      ])
    })
    startupTimings.sessionStartOwnMs=Date.now()-began
    try { return await next(e) }
    finally { diagnose($,'session.start.end',undefined,{ownMs:startupTimings.sessionStartOwnMs}) }
  })

  on('session.attach', async ($, e, next) => {
    if(e.surface==='desktop') beginLifecycle($,'attach')
    scheduleAfter($,0,()=>background($,'arrive',arrive($)))
    const attached = await next(e)
    scheduleCompanionContext($)
    return attached
  })

  on('session.detach', async ($, e, next) => {
    const detached = await next(e)
    if (!(await $.session.surfaces()).includes(e.surface)) {
      for (const key of cupInstances.keys()) if (key.startsWith(e.surface + ':')) cupInstances.delete(key)
      cost?.visibility(Array.from(cupInstances.values()).some(Boolean))
    }
    d1DesktopShedTimelines.clear()
    scheduleCompanionContext($)
    return detached
  })

  on('session.end', async ($, e, next) => {
    if (cost) await cost.close()
    void background($,'session.end.cleanup',sessionEnded($,e.reason))
    return next(e)
  })

  // A compaction of the main conversation empties the box at once (an estimate until the next
  // response); a precompute changes nothing, a subagent's compaction is its own.
  on('session.compact', async ($, e, next) => {
    const main=e.agentId===undefined&&e.trigger!=='precompute',serial=main?++d1CompactSerial:0,id='shed:'+serial,own=d1Epoch
    const active=()=>serial===d1CompactSerial&&own===d1Epoch
    if(main){
      openerEvents.compacted=clockSnapshot
      notice?.compacted()
      d1ShedPrevious=view.frame
      if(!d1Word(view.lang,'aside.shed')&&!d1ShedAsides){
        const asides=makeD1ShedAsides()
        if(!active())return next(e)
        d1ShedAsides=asides
      }
      if(!active())return next(e)
      d1??=new D1Runtime()
      const now=await snapshotNow($);if(!active())return next(e)
      stop('shed');d1.compact(id,'begin',now);presenceActivity($);await setMood($,'snake')
      if(!active())return next(e)
      await ensureD1($);if(!active())return next(e)
    }
    let compacted:Awaited<ReturnType<typeof next>>
    const cancelShed=async()=>{const now=await snapshotNow($);if(!active())return;d1DesktopShedTimelines.clear();d1?.compact(id,'skip',now);await setMood($,working?'think':'idle');if(!active())return;await updatePose($);if(active())await push($)}
    try{compacted=await next(e)}catch(error){if(main&&active())await cancelShed();throw error}
    if(main&&active()&&compacted.skip!==undefined)await cancelShed()
    if (main && active() && compacted.skip === undefined) {
      cost?.reset()
      const now=await snapshotNow($);if(!active())return compacted
      // the shell change: the other outfit, and the band reads the ended shed now, not at the next push
      view.outfit=view.outfit==='B'?'A':'B'
      // one Coco: the outfit is shared like the theme, so every session, and the pet showing any of them, wears what
      // the last compaction anywhere changed her into (owner 10-20: the pet kept changing, each session in its own)
      sharedSettings={...sharedSettings,outfit:view.outfit}
      if(presence)void background($,'presence.settings.outfit',presence.settings({outfit:view.outfit}))
      compactions++;void background($,'socks.sesame',earnSocks($,'sesame'))
      // the shell change is drawn from their own pictures (pixel version and band data), so no old cuts are read here
      d1?.compact(id,'end',now);d1Sync($);await startC3($);if(!active())return compacted
      d1RowsFirst=!c3?.onceSaid('shedFirst')
      if(d1RowsFirst&&(c3Visible()||e.trigger==='auto'))offerLine($,{key:'shed.first',text:d1Word(view.lang,'shed.first'),class:1,ttl:14000,onShown:()=>{d1RowsFirst=false;return c3?.markOnce('shedFirst')}},false)
      await sweep($, compacted.tokensAfter)
      d1ShedDeadline($,serial)
      diagnose($, 'compaction', undefined, { trigger: e.trigger, tokensAfter: compacted.tokensAfter !== undefined, context: view.context, estimate: view.estimate })
    }
    return compacted
  })

  // The engine's own measurement after each turn, pushed: no read needed.
  on('session.measure', async ($, e, next) => {
    const measured = await next(e)
    bookMeasured(bookEngine($),e)
    await snapshotNow($)
    await quotaMeasured($,e.rateLimits,e.cost?.usd,e.context.tokens)
    await startC3($);await runtimeC3($).measure((e.rateLimits??[]).map(w=>({kind:w.kind,percentUsed:w.percentUsed,resetsAt:w.resetsAt?Date.parse(w.resetsAt):undefined})),clockSnapshot);c3Changed($)
    if (e.changed.includes('context')) await gauge($, e.context)
    const measuredCost = cost
    measuredCost?.measure(e)
    if (measuredCost) await push($)
    return measured
  })

  on('config.set', async ($, e, next) => {
    const set = await next(e)
    if (set.deny === undefined && !e.key.startsWith('coco.')) {
      if (e.key === 'theme') {
        themeRevision++
        cachedEngineTheme = typeof set.value === 'string' ? set.value : undefined
      }
      await settingsMoved($)
      if (cost) cost.settings(await $.settings.read(), await $.settings.read({ source: 'policy' }))
    }
    return set
  })

  // Built-in commands that change the box without a response: another model's window, a rewind.
  on('command.run', { command: 'model' }, async ($, e, next) => {
    const ran = await next(e)
    cost?.reset()
    await gauge($)
    return ran
  })

  on('command.run', { command: 'rewind' }, async ($, e, next) => {
    const ran = await next(e)
    await sweep($)
    return ran
  })

  on('command.run', { command: 'clear' }, async ($, e, next) => {
    const ran = await next(e)
    cost?.reset()
    { // CommandRunResult has no deny; reaching here means next completed.
      working = false
      compactions=0;vibeSession={tools:{},helpers:0,back:0,commits:0};d1CompactSerial++;d1Epoch++;d1DesktopShedTimelines.clear();d1RowsFirst=false;d1?.clear();d1=undefined;d1Ready=undefined;d1LongSaid='';d1Spawns.clear();d1Trim?.start(d1Session);stop('shed');stop('helperLeave');delete view.longTask;delete view.shed;delete view.helpers;delete view.stageDirection
      view.mood='idle'; view.frame=STILL.idle; view.said=null
      endBreath()
      resetBookSession();failedTest=false;always.clear();latest.settings={...latest.settings,m1Always:alwaysSnapshot()};modGaps.reset();gapLimits.startTurn();waitBell.end();m1More?.stop();c3?.reset();talkTool=undefined;talkTest=undefined;clearCompanionLine('all');lineSlot.clear('all',clockSnapshot);delete view.line;delete view.pose;delete view.companionPose;delete view.companionLine;stop('poseHold');stop('celebration')
      beginLifecycle($,'clear')
      presenceActivity($)
      askedAt = 0
      stop('long')
      stop('ask')
              currentTask = null
      companionTask(null)
      companionActivity({ done: null, waitAt: null, reply: null, notice: null })
      void background($,'clear.publish',push($))
    }
    return ran
  })


  on('prompt.edit',{inputText:/[\s\S]{20,}/},($,e,next)=>{
   const result=next(e)
   if(m1More?.isOn('paste'))void Promise.resolve(result).then(()=>m1More?.pasteEdit(moreEngine($),e.inputText)).catch(()=>{})
   return result
  })
  on('classic.StopFailure',async($,e,next)=>{
   const result=await next(e),at=await snapshotNow($)
   // A rate-limit stop, whoever the next turn belongs to, is what the relight waits for.
   if(e.error==='rate_limit'){rateLimitStopAt=at;await markLimitOut($)}
   const limit=gapLimits.failure(e.error,e.agent_id,(view.quota?.rateLimits??[]).map(w=>({...w,resetsAt:w.resetsAt?Date.parse(w.resetsAt):undefined})),at,view.lang,kind=>WORDS[view.lang].quota.kinds[kind]??kind,timeZone)
   if(limit){
    const from=view.pose?c3MotionFrame(view.pose,Math.max(0,at-view.pose.at),reducedMotion||limitMotionHeld()):view.frame
    limitStill={epoch:limit.epoch,frame:limit.frame,from}
    moodGeneration++;stop('revert');cancelCalming();toolPoses.interrupt();stop('poseHold');stop('celebration');stop('glance');c3ReactionPose=undefined;c3ReactionUntil=0
    view.mood='idle';view.frame=limit.frame as FrameName;view.pose={name:limit.frame==='tea-a'?'tea':'waiting',frame:limit.frame,aside:limit.frame==='tea-a'?c3Word(view.lang,'aside.tea'):WORDS[view.lang].aside.waiting,at}
    offerLine($,limit.request);view.spentWindows=[...gapLimits.out()];spentSocks($);animate($);syncM1Lively($)
    if(limitStill?.epoch===limit.epoch&&limitStill.frame===limit.frame){pictureSerial++;await push($)}
   }
   return result
  })
  on('ui.render',{component:'ToolResult'},async($,e,next)=>{
   const outcome=modGaps.runVerdicts.get(e.props.tool_use_id)
   if((latest.marks??'on')==='off'||outcome!=='pass'&&outcome!=='fail')return next(e)
   const theirs=await next(e)
   return renderRunMark($.ui.resolve(e) as never,theirs,e.props.tool_use_id,outcome,e.surface,view.lang,screenReader,cueFor(view.colors))
  })
  on('ui.render',{component:'PromptHint'},($,e,next)=>{
   const tail=hintTail({surface:e.surface,band:view.band,sessions:hintSessions,keysUsed:bandKeysUsed,isDraft:e.props.isDraft,isWorking:e.props.isWorking,lang:view.lang})
   return tail?next({...e,props:{...e.props,tail}}):next(e)
  })
  on('ui.focus',{component:'AbovePrompt',plugin:'coco'},async($,e,next)=>{
   const result=await next(e)
   if(personBandFocus(e,result,bandKeysUsed)){
    bandKeysUsed=true;await $.store.set('bandKeysUsed',true)
   }
   return result
  })
  on('ui.render',{component:'ToolProgress'},($,e,next)=>{
   const command=m1Commands.get(e.props.tool_use_id),usual=command?.recognized&&reminderSettings().notes?runDurations.median(presenceMetadata.cwd??'',command.command):undefined
   if(e.surface!=='terminal'||usual===undefined)return next(e)
   const generation=lifecycleGeneration,turn=turnId
   return loadMoreWords(()=>$.fs.read(joinPath($.plugin.root,'hooks/more-text.json'))).then(()=>{
    if(generation!==lifecycleGeneration||turn!==turnId||!reminderSettings().notes)return next(e)
    const part=moreFill(moreWord('pill.usually',view.lang),{duration:durationText(usual/1000,view.lang,c3Durations(view.lang))})
    return part?next({...e,props:{...e.props,hint:e.props.hint+', '+part}}):next(e)
   })
  })
  on('classic.PostToolUse',async($,e,next)=>{
   const result=await next(e)
   if(e.tool_name==='Bash'&&typeof e.duration_ms==='number'&&reminderSettings().notes){
    const known=m1Commands.get(e.tool_use_id)
    runtimeC3($).executionDuration(e.tool_use_id,e.duration_ms)
    if(known?.recognized){runDurations.add(presenceMetadata.cwd??'',known.command,e.duration_ms);await $.store.set('runDurations',runDurations.snapshot())}
   }
   return result
  })
  on('classic.PostToolBatch',async($,e,next)=>{
   const result=await next(e)
   if(batchNeedsSettle){batchNeedsSettle=false;toolPoses.interrupt();stop('poseHold');if(clockSnapshot<c3ReactionUntil||['waiting','question','error','wild','refuse','flustered'].includes(view.mood))return result;delete view.pose;await setMood($,'think')}
   return result
  })
  on('classic.PostToolUseFailure',async($,e,next)=>{
   const result=await next(e)
   if(!e.is_interrupt){await setMood($,'error',TIMING.errorFlash)}
   return result
  })
  // The terminal's pointer client (play-client.ts): drag and glance go to play, pat and poke to his touch.
  on('ui.message',($,e,next)=>{
   // The desktop band's clients: a click on her is a poke, two turns of a stroke inside 1.5 s a pat, a press on a quota
   // thing opens the bag's quota page.
   if(e.surface==='desktop'&&e.module==='hooks/play-client.ts'){
    const kind=e.data&&typeof e.data==='object'?(e.data as {t?:unknown}).t:undefined
    if(desktopPointerFailed)return Promise.resolve({})
    if(e.element.startsWith('coco:touch:')&&(kind==='enter'||kind==='leave')){
     try { pictureLeave?.cancel() } catch { /* a spent timer */ }
     pictureLeave=kind==='leave'?scheduleAfter($,2500,()=>{pictureLeave=undefined;leftHover($,'picture')}):undefined
     return Promise.resolve({})
    }
    if(e.element.startsWith('coco:press:')&&(kind==='enter'||kind==='leave')){
     const thing=e.element.slice('coco:press:'.length),pointed=kind==='enter'?thing:pointerOn===thing?undefined:pointerOn
     if(pointed!==pointerOn){pointerOn=pointed;redraw($,'pointer.'+kind)}
     return Promise.resolve({})
    }
    if((e.element.startsWith('coco:press:quota')||e.element==='coco:press:money')&&kind==='press')return openQuotaPage($).then(()=>({}))
    if(e.element.startsWith('coco:touch:')&&kind==='poke')return touch($,'poke',e.requestId).then(()=>({}))
    if(e.element.startsWith('coco:touch:')&&kind==='turn'){
     const now=Date.now()
     desktopTurns=[...desktopTurns.filter(at=>now-at<=1500),now]
     if(desktopTurns.length>=2&&now-lastDesktopPat>=600){desktopTurns=[];lastDesktopPat=now;return touch($,'pat',e.requestId).then(()=>({}))}
    }
    return Promise.resolve({})
   }
   if(e.surface==='terminal'&&e.module==='hooks/play-client.ts'&&!playClientFailed){
    const kind=e.data&&typeof e.data==='object'?(e.data as {t?:unknown}).t:undefined
    if(kind==='pat'||kind==='poke')return touch($,kind,e.requestId).then(()=>({}))
    return playPointer($,e.data).then(()=>({}))
   }
   return dispatchTouchMessage(e,terminalTouchFailed,(kind,requestId)=>touch($,kind,requestId),next)
  })
  // ui.fault first exists in 2.1.289. Older registries may refuse the event.
  try {
   ;(on as unknown as (event:string,hook:($:Engine,e:{surface:string;module?:string;element:string},next:(e:unknown)=>Promise<unknown>)=>Promise<unknown>)=>void)('ui.fault',async($,e,next)=>{
    if(e.surface==='terminal'&&e.module==='hooks/touch-client.ts'){terminalTouchFailed=true;$.ui.invalidate('ui.render')}
    if(e.surface==='terminal'&&e.module==='hooks/play-client.ts'){playClientFailed=true;$.ui.invalidate('ui.render')}
    if(e.surface==='desktop'&&e.module==='hooks/play-client.ts'&&!desktopPointerFailed){desktopPointerFailed=true;$.ui.invalidate('ui.render')}
    return next(e)
   })
  } catch { /* optional event; terminal pointer input still works on older hosts */ }
  on('classic.Elicitation',async($,e,next)=>{await asked($);return next(e)})
  on('classic.ElicitationResult',async($,e,next)=>{waitBell.end();const result=await next(e);await settled($);return result})
  on('classic.PermissionRequest',async($,e,next)=>{await asked($);return next(e)})
  on('classic.PermissionDenied',async($,e,next)=>{const result=await next(e);await setMood($,'refuse',TIMING.errorFlash);return result})
  on('classic.ConfigChange',async($,e,next)=>{const result=await next(e);themeRevision++;await optional($,'config.theme',()=>readEngineTheme(()=>bounded($,'config.theme',$.config.list(),5000)),undefined);await settingsMoved($);screenReader=detectScreenReader(await $.env.get('CLAUDE_AX_SCREEN_READER'),cachedEngineSettings);m1More?.configure(view.lang,screenReader);syncM1Lively($);$.ui.invalidate('ui.render');return result})
  // One Stop hook: M1's always-on rows, then the cost model's crons (main 10-10).
  on('classic.Stop',async($,e,next)=>{
   always.crons(e.session_crons??[],clockSnapshot);always.background=e.background_tasks?.length??0;latest.settings={...latest.settings,m1Always:alwaysSnapshot()}
   const stopped=await next(e)
   const rows=(e as unknown as Record<string,unknown>).session_crons
   if(Array.isArray(rows)){pendingCostCrons=rows;cost?.cronsChanged(rows);coldNotes($)}
   return stopped
  })
  on('classic.UserPromptSubmit',($,e,next)=>{classicPromptSource=e.source??'';return next(e)})
  on('classic.SubagentStart',($,e,next)=>{always.helperStart(e.agent_id,e.agent_type);m1More?.recordDay('helpers',clockSnapshot);latest.settings={...latest.settings,m1Always:alwaysSnapshot()};$.ui.invalidate('ui.render');return next(e)})
  on('classic.SubagentStop',($,e,next)=>{always.helperStop(e.agent_id,e.last_assistant_message);latest.settings={...latest.settings,m1Always:alwaysSnapshot()};$.ui.invalidate('ui.render');return next(e)})
  on('classic.TeammateIdle',($,e,next)=>{const row=always.helpers.get(e.teammate_name);if(row)row.status='idle';return next(e)})
  // One PostModelSwitch hook: M1's model row, then the cost model's cache lifetime (main 10-10).
  on('classic.PostModelSwitch',async($,e,next)=>{
   always.model=e.to_model;latest.settings={...latest.settings,m1Always:alwaysSnapshot()};$.ui.invalidate('ui.render')
   const switched=await next(e)
   // each model has its own compaction window (his 10-18: 400k for most, more for Fable, 100k for Haiku): the box follows the switch
   background($,'gauge',gauge($))
   const ttl=(e as unknown as Record<string,unknown>).cache_ttl
   if(ttl==='5m'||ttl==='1h')pendingCostTTL=ttl
   cost?.reset(ttl)
   return switched
  })
  on('classic.WorktreeCreate',async($,e,next)=>{const result=await next(e);if(result.worktreePath)always.worktrees.set(result.worktreePath,e.name);publishAlways($);return result})
  on('classic.WorktreeRemove',($,e,next)=>{always.worktrees.delete(e.worktree_path);publishAlways($);return next(e)})
  on('classic.DirectoryAdded',($,e,next)=>{always.added.add(e.directory);publishAlways($);return next(e)})
  on('classic.SessionStart',async($,e,next)=>{
   const result=await next(e)
   // A boot already under way is awaited so the companion channel can name its watch path; this hook never starts
   // one, since a boot reads M1's words and the first draw must find no file read before it.
   if(bootGeneration===lifecycleGeneration&&bootPromise)await bootPromise
   // The opening for a /clear, /resume or /fork, or the source he waits for at arrival (openings.ts).
   const source=sourceFrom(e.source)
   if(source)await sessionStarted($,source,typeof e.seconds_since_last_response==='number'?e.seconds_since_last_response:undefined)
   // A resumed or forked chat whose cache has lapsed says what its first message will re-read (COST-CACHE 3.8).
   if(e.source==='resume'||e.source==='fork'){pendingResumeCold={expired:e.prompt_cache_likely_expired,tokens:e.context_tokens,usd:e.estimated_cache_write_usd};coldNotes($)}
   if(companionChannel){await companionChannel.classicStart();return {...result,watchPaths:[...(result.watchPaths??[]),companionChannel.requestWatch()]}}
   return result
  })
  on('classic.FileChanged',async($,e,next)=>{if(companionChannel&&e.file_path===companionChannel.requestWatch())await companionChannel.fileChanged();return next(e)})
  on('classic.Setup',async($,e,next)=>{const result=await next(e);if(e.trigger==='maintenance')await optional($,'m1.maintenance',()=>runState($,['--prune-logs'],{timeoutMs:2000}),undefined);return result})
  on('classic.PostCompact',async($,e,next)=>{const result=await next(e);always.summary=wordCount(e.compact_summary);latest.settings={...latest.settings,m1Always:alwaysSnapshot()};return result})
  on('classic.TaskCreated',async($,e,next)=>{const result=await next(e);await runtimeC3($).task(always.task(e.task_id,e.task_subject));return result})
  on('classic.TaskCompleted',async($,e,next)=>{const result=await next(e);await runtimeC3($).task(always.task(e.task_id));return result})
  on('session.send',async($,e,next)=>{
   const generation=lifecycleGeneration,result=await next(e)
   if(result.isDelivered&&generation===lifecycleGeneration){
    await loadMoreWords(()=>$.fs.read(joinPath($.plugin.root,'hooks/more-text.json')))
    if(generation===lifecycleGeneration){const text=moreWord('aside.letterOut',view.lang);if(text)offerLine($,{key:'letter.out',text,class:0,ttl:3000})}
   }
   return result
  })
  // Sender labels on same-user channels are claims, never approval to queue a turn.
  on('session.receive',async($,e,next)=>{
   if(e.agentId!==undefined||!['peer','peer-send-message'].includes(e.origin.kind))return next(e)
   const generation=lifecycleGeneration
   await receiveNote($,'peer:'+generation+':'+(++receivedSerial),e.text,generation)
   return {consumed:moreWord('received.title',view.lang)||'coco:received'}
  })
  on('agent.offer',{agent:'coco:second-look'},()=>({isOffered:false}))


  on('classic.Notification', async ($, e, next) => {
    if(storedSettings.waitSound===true)await snapshotNow($);if(storedSettings.waitSound===true)await waitBell.notify({on:true,macOS:companionSupported,screenReader,preferredNotifChannel:(cachedEngineSettings as Record<string,unknown>).preferredNotifChannel},e.notification_type,clockSnapshot,{get:key=>$.store.get(key),set:(key,value)=>$.store.set(key,value as never),surfaces:()=>$.session.surfaces(),claim:()=>claimM1($,'waiting',clockSnapshot,30000),play:()=>$.audio.play({asset:'assets/sound/waiting.wav'},{gain:1})})
    const notified = await next(e)
    companionActivity({ notice: { kind: e.notification_type, text: [...e.message].slice(0, 140).join(''), at: await snapshotNow($) } })
    const resume = autoResume(e.notification_type)
    if (resume === 'quota_auto_resume_fired') await relightIncense($)
    else if (resume) {
      if (view.play?.wait) { playView({ wait: undefined }); lineSlot.dismiss('limit.relight', clockSnapshot); projectLine($) }
      if (resume === 'quota_auto_resume_disabled') await noteNoRelight($)
    }
    await push($)
    return notified
  })

  on('classic.PreModelSwitch', async ($, e, next) => {
    const switched = await next(e)
    const ttl = (e as unknown as Record<string, unknown>).cache_ttl
    if (ttl === '5m' || ttl === '1h') { pendingCostTTL = ttl; cost?.ttlEvidence(ttl) }
    return switched
  })
  on('model.complete', async ($, e, next) => {
    if (next.origin.plugin !== 'coco') return next(e)
    const accounted = await ensureCost($)
    if (accounted) accounted.measure(await $.session.usage().catch(() => ({})))
    const startedAt = await snapshotNow($), reply = await next(e)
    if (next.origin.plugin === 'coco' && 'value' in reply && reply.value?.usage) {
      await snapshotNow($)
      await accounted?.ownCall(e.model, usageTokens(reply.value.usage), startedAt)
    }
    return reply
  })
  on('model.fork', async ($, e, next) => {
    if (next.origin.plugin !== 'coco' || e.prompt === 'Reply with the single word: ok') return next(e)
    const model = await $.session.model(), accounted = await ensureCost($)
    if (accounted) accounted.measure(await $.session.usage().catch(() => ({})))
    const revision = accounted?.revision()
    const startedAt = await snapshotNow($), reply = await next(e)
    if (next.origin.plugin === 'coco' && e.prompt !== 'Reply with the single word: ok' && 'value' in reply && 'usage' in (reply.value ?? {})) {
      await snapshotNow($)
      const value = reply.value as { usage: unknown }
      await accounted?.ownCall(model, usageTokens(value.usage), startedAt, revision !== undefined && revision === accounted?.revision())
    }
    return reply
  })
  on('store.set', { key: /^(more|prices\.claude|prices\.others)$/ }, async ($, e, next) => {
    const saved = await next(e)
    if (next.origin.plugin === 'coco' && !('deny' in saved) && cost) {
      if (e.key === 'more') await cost.syncWarm()
      else await cost.refreshPrices()
    }
    return saved
  })

  // The engine's own rows about its wait: one string test per row, and only on rows that mention a limit or a continue.
  on('session.append', ($, e, next) => {
    if (e.agentId === undefined && e.message.type !== 'assistant') {
      const content = e.message.content
      const text = typeof content === 'string' ? content : content.map(block => block.type === 'text' && typeof block.text === 'string' ? block.text : '').join(' ')
      if (text.length < 400 && /limit|automatic/i.test(text)) void background($, 'limit.row', noteWaitRow($, text))
    }
    return next(e)
  })

  on('session.append',{door:'response'},($,e,next)=>{modGaps.append(e.uuid,e.message as never,e.agentId);return next(e)})
  on('prompt.submit', async ($, e, next) => {
    // Only the person's own prompt can go to Talk; it then never enters the session.
    if(e.origin.kind==='composer'&&m1More?.talkFromPrompt(moreEngine($),e.text,clockSnapshot))return {drop:moreWord('talk.routed',view.lang)}
    if(PERSON.has(e.origin.kind))runtimeNotice($).prompted(e.text)
    m1More?.newPrompt(moreEngine($));if(PERSON.has(e.origin.kind))m1More?.recordDay('prompts',clockSnapshot);
    const source=classicPromptSource;classicPromptSource='';if(source==='loop_wakeup'||source==='schedule_wakeup'){
     const generation=lifecycleGeneration
     await loadMoreWords(()=>$.fs.read(joinPath($.plugin.root,'hooks/more-text.json')))
     if(generation===lifecycleGeneration){const text=moreWord(source==='loop_wakeup'?'wake.loop':'wake.schedule',view.lang);if(text)offerLine($,{key:'wake',text,class:0,ttl:14000})}
     return next(e)
    }
    await snapshotNow($)
    await prompted($,e.text,e.origin.kind)
    costOrigin = PERSON.has(e.origin.kind) ? e.origin.kind === 'bridge' ? 'bridge' : 'composer' : 'other'
    if(PERSON.has(e.origin.kind)){await startC3($);clearCompanionLine('prompt');lineSlot.clear('prompt',clockSnapshot);projectLine($);await runtimeC3($).prompt({text:e.text});c3Changed($)}
    // Shared presence learns this prompt's time after the line is cleared, so its own change report shows the cleared line.
    talkTool = undefined
    // When they were last here before this prompt (a turn that ended since counts as their being here): back after long
    // enough, she may DM them (dm.ts).
    const dmFrom = Math.max(lastPromptAt, lastSeen, dmTurnEndAt)
    lastPromptAt = Math.max(lastPromptAt + 1, clockSnapshot)
    presenceMetadata.lastPromptAt = lastPromptAt
    await presence?.prompt(lastPromptAt)
    background($, 'gauge', gauge($))
    if (PERSON.has(e.origin.kind)) void background($, 'dm.first', dmConsider($, dmFrom))
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const costStartedAt = await snapshotNow($)
    const own=d1Epoch
    const stream = next(e)
    let part = await stream.next()
    while (!part.done) {
      if (e.agentId === undefined && part.value.kind === 'tool') mainToolCalls.add(part.value.id)
      if(e.agentId===undefined&&part.value.kind==='text'&&part.value.text.length){await snapshotNow($);if(toolPoses.text(clockSnapshot)){await updatePose($);await push($)}poseDeadline($)}
      yield part.value
      part = await stream.next()
    }
    const response = part.value
    if(own===d1Epoch){await ensureD1($);if(own===d1Epoch){d1?.stepUsage(e.agentId,e.turnId,response.usage);d1Sync($)}}
    if (e.agentId === undefined && response.stopReason !== null) await gauge($, undefined, true, response.usage ?? undefined)
    if (response.usage && response.stopReason !== null) { await snapshotNow($); await (await ensureCost($))?.step(costStartedAt, response.usage, e.agentId === undefined, e.agentId) }
    return response
  })

  on('turn.start', async ($, e, next) => {
    const own=d1Epoch
    await snapshotNow($);modGaps.startTurn(clockSnapshot);gapLimits.startTurn();projectLine($)
    c3TurnSerial++
    await snapshotNow($)
    // Back from a pause it kept warm: one line, what it cost or when and why it stopped (COST-CACHE 4.7).
    if (cost) { const pause = await cost.turnStart(costOrigin), back = pause ? warmReturnLine(pause, cost.snapshot(), view.lang) : ''; if (back) offerLine($, { key: 'warm.back', text: back, class: 1, ttl: 14000 }) }
    else pendingCostStart = { origin: costOrigin, reading: await $.session.usage().catch(() => ({})) }
    costOrigin = 'other'
    const started = await next(e)
    if(own!==d1Epoch)return started
    runtimeC3($).turnStart();runtimeNotice($).turnStart();await turnStarted($,e.turnId);syncM1Lively($)
    return started
  })

  on('tool.call',async($,e,next)=>{
    const cap=m1More?.capToolCall(moreEngine($),turnId);if(cap){const denied=await cap;if(denied)return denied}
    // The second look's reader opens only the changed files (U3, 10-17)
    if(e.agentId!==undefined&&m1More){const look=await m1More.lookDeny(moreEngine($),e.agentId,e.tool,e as unknown as Record<string,unknown>);if(look)return {deny:look}}
    if(e.agentId===undefined&&['Edit','Write','MultiEdit','NotebookEdit'].includes(e.tool)){const input=e as unknown as Record<string,unknown>,path=typeof input.file_path==='string'?input.file_path:typeof input.notebook_path==='string'?input.notebook_path:undefined;if(path)m1More?.edit(path,JSON.stringify(input))}
    const isMain = e.agentId === undefined,own=d1Epoch
    if (isMain) { const kind = weekKind(e.tool); if (kind !== 'helpers') vibeSession.tools[kind] = (vibeSession.tools[kind] ?? 0) + 1 }
    if(!isMain&&d1){const runtime=d1;await snapshotNow($);if(own===d1Epoch&&d1===runtime){runtime.tool(e.agentId!);presenceActivity($)}}
    const command = e.tool === 'Bash' && 'command' in e && typeof e.command === 'string' ? e.command : undefined
    let visitStart=0
    if (isMain) {talkTool=e.tool;m1More?.recordTool(e.tool,clockSnapshot);await startC3($);mainToolCalls.add(e.tool_use_id);await toolStarted($,e,command);visitStart=clockSnapshot;const headName=poseForTool(e.tool);c3HeadPose={name:headName,frame:headName+'-a',aside:headName==='work'?WORDS[view.lang].aside.work:c3Word(view.lang,'aside.'+headName),at:clockSnapshot};await runtimeC3($).toolStart({id:e.tool_use_id,name:e.tool,input:e as unknown as Record<string,unknown>,cwd:presenceMetadata.cwd,branch:command?await repositoryBranch($,presenceMetadata.cwd??''):undefined,at:clockSnapshot})}
    if(command){m1Commands.set(e.tool_use_id,{command,recognized:runtimeC3($).isRecognized(e.tool_use_id)});while(m1Commands.size>256)m1Commands.delete(m1Commands.keys().next().value!)}
    runtimeNotice($).toolStart({id:e.tool_use_id,tool:e.tool,background:'run_in_background' in e&&e.run_in_background===true,main:isMain})
    let ran = await next(e)
    if(own!==d1Epoch)return ran
    if(e.tool==='Agent'||String(e.tool)==='Task'){const r=ran.result as unknown as Record<string,unknown>|undefined,id=d1Spawns.get(e.tool_use_id);if(id&&r?.status==='completed'){await d1Finished($,id,'done',{tokens:typeof r.totalTokens==='number'?r.totalTokens:undefined,durationMs:typeof r.totalDurationMs==='number'?r.totalDurationMs:undefined,toolUses:typeof r.totalToolUseCount==='number'?r.totalToolUseCount:undefined})}else if(id&&(ran.isError||ran.deny))await d1Finished($,id,ran.deny?'stopped':'failed')}
    waitBell.settled(e.tool_use_id)
    if (isMain) {
      await snapshotNow($);visits.tool(e.tool,visitStart,clockSnapshot,{background:(e as {run_in_background?:unknown}).run_in_background===true,failed:ran.isError===true||ran.deny!==undefined});if(e.tool==='TodoWrite')visits.todos(clockSnapshot,(e as {todos?:unknown}).todos);if((e.tool as string)==='TaskUpdate'&&(e as {status?:unknown}).status==='completed'&&ran.deny===undefined&&ran.isError!==true)visits.step(clockSnapshot);clearCompanionLine('turn',e.tool_use_id);lineSlot.clear('turn',clockSnapshot,e.tool_use_id);projectLine($);toolPoses.end(e.tool_use_id,clockSnapshot);poseDeadline($)
      batchNeedsSettle=true
      const rawResult:unknown=ran.result
      const result=rawResult!==null&&typeof rawResult==='object'&&!Array.isArray(rawResult)&&(Object.getPrototypeOf(rawResult)===Object.prototype||Object.getPrototypeOf(rawResult)===null)?rawResult as Record<string,unknown>:undefined
      const output=typeof ran.text==='string'?ran.text:result?String(result.stdout??'')+'\n'+String(result.stderr??''):typeof ran.result==='string'?ran.result:''
      const exitCode=result&&typeof result.exitCode==='number'?result.exitCode:result&&typeof result.exit_code==='number'?result.exit_code:ran.deny!==undefined?null:ran.isError?1:0
      await toolEnded($,e.tool,command,ran.isError===true,ran.deny!==undefined||result?.interrupted===true)
      if(working&&e.tool==='Bash'&&ran.deny===undefined&&(exitCode===127||(ran.isError===true&&NOT_FOUND.test(output))))await say($,'typo')
      const run=runtimeC3($).recognized(e.tool_use_id)
      await runtimeC3($).toolResult({id:e.tool_use_id,output,exitCode,denied:ran.deny!==undefined,interrupted:result?.interrupted===true,at:clockSnapshot})
      const verdict=c3?.runVerdict(e.tool_use_id);const recognized=verdict!==undefined;if(verdict==='pass'&&c3?.runKind(e.tool_use_id)==='test')m1More?.recordDay('tests',clockSnapshot);if((verdict==='pass'||verdict==='fail')&&c3?.runKind(e.tool_use_id)==='test')talkTest=verdict==='pass'?{verdict}:{verdict,failed:c3.runFailed(e.tool_use_id)};if(m1Commands.has(e.tool_use_id))m1Commands.get(e.tool_use_id)!.recognized=recognized
      modGaps.toolRan({id:e.tool_use_id,name:e.tool,command,key:run?.key,committed:c3?.committed(e.tool_use_id),exitCode:exitCode??undefined,denied:ran.deny!==undefined,interrupted:result?.interrupted===true,recognized,outcome:verdict})
      void background($,'notice.tool',runtimeNotice($).toolResult({id:e.tool_use_id,tool:e.tool,input:e as unknown as Record<string,unknown>,result,text:typeof ran.text==='string'?ran.text:undefined,failed:ran.isError===true||ran.deny!==undefined,main:true}))
      if(run&&reminderSettings(storedSettings).trim&&ran.deny===undefined&&e.tool==='Bash'&&result&&typeof result.stdout==='string'&&typeof result.stderr==='string'&&!result.rawOutputPath&&!result?.persistedOutputPath&&!result?.persistedOutputSize&&!result?.backgroundTaskId&&!result?.structuredContent&&!result?.isImage){
       await ensureD1Trim($)
       const stdout=result&&typeof result.stdout==='string'?result.stdout:typeof ran.text==='string'?ran.text:'',stderr=result&&typeof result.stderr==='string'?result.stderr:undefined
       const trimmed=await d1Trim?.capture({id:e.tool_use_id,output:stdout,stderr,run})
       if(trimmed?.row)ran=replaceD1TrimmedResult(ran,result,trimmed)
      }
      await push($)
    }
    // A helper's read counts for his shelf, nothing else of a helper's work does.
    else if(e.tool==='Read'&&ran.isError!==true&&ran.deny===undefined&&ran.result&&typeof ran.result==='object')void background($,'notice.read',runtimeNotice($).toolResult({id:e.tool_use_id,tool:'Read',input:{},result:ran.result as Record<string,unknown>,failed:false,main:false}))
    return ran
  })

  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if(e.tool_use_id!==undefined&&mainToolCalls.has(e.tool_use_id)){
      if(verdict.decision==='ask'){waitBell.ask(e.tool_use_id);await asked($);await runtimeC3($).permission(e.tool_use_id,'ask',!c3Visible());projectLine($);await push($)}
      else await runtimeC3($).permission(e.tool_use_id,'resolved')
    }
    return verdict
  })

  on('turn.complete', async ($, e, next) => {
    const serial=c3TurnSerial,own=d1Epoch
    const done = await next(e)
    if(own!==d1Epoch)return done
    await snapshotNow($)
    if(own!==d1Epoch)return done
    await (await ensureCost($))?.turnComplete(e.usage, e.agentId === undefined)
    if(own!==d1Epoch)return done
    d1?.turnUsage(e.agentId,e.turnId,e.usage)
    if(e.agentId!==undefined&&(e.reason==='error'||e.reason==='aborted'||e.isAborted))await d1Finished($,e.agentId,e.reason==='error'?'failed':'stopped')
    if(e.agentId&&e.usage){await m1More?.finishLook(moreEngine($),e.agentId,e.answer,e.usage,clockSnapshot)}
    if(e.agentId===undefined){if(m1More)m1More.lastAnswer=e.answer;m1More?.recordDay('turns',clockSnapshot)}
    if(e.agentId===undefined){await turnEnded($,e);syncM1Lively($)}
    // A turn's end is a moment she may DM about (a big job done, the tests green, the quota low; dm.ts).
    if(e.agentId===undefined&&own===d1Epoch){dmTurnEndAt=clockSnapshot;void background($,'dm.first',dmConsider($))}
    if(own===d1Epoch&&e.agentId===undefined&&serial===c3TurnSerial){void background($,'notice.turn',runtimeNotice($).turnComplete());clearCompanionLine('turn');lineSlot.clear('turn',clockSnapshot);projectLine($);toolPoses.interrupt();stop('poseHold');if(clockSnapshot>=c3ReactionUntil&&!gapLimits.current(clockSnapshot))delete view.pose;await runtimeC3($).turnComplete({main:true,reason:e.reason,contextPercent:view.context});if(own===d1Epoch&&serial===c3TurnSerial)await push($)}
    return done
  })
  on('agent.spawn',async($,e,next)=>{
    const own=d1Epoch
    const spawned=await next(e)
    void cardsSpawned($,e.subagentType)
    if(own===d1Epoch&&'agentId' in spawned&&spawned.agentId){vibeSession.helpers++;await ensureD1($);await loadD1Art('helpers',path=>$.fs.read(joinPath($.plugin.root,path)));const now=await snapshotNow($);if(own!==d1Epoch)return spawned;planeBatch.n++;d1?.spawn(spawned.agentId,typeof e.description==='string'?e.description:'',typeof e.subagentType==='string'&&e.subagentType.trim()?e.subagentType:'general-purpose',now,e.parentAgentId);d1Spawns.set(e.tool_use_id,spawned.agentId);for(const [tool,id]of d1Spawns){if(d1Spawns.size<=64)break;if(!d1?.isRunning(id))d1Spawns.delete(tool)}presenceActivity($);if(!e.parentAgentId){toolPoses.start(e.tool_use_id,'Agent',now);toolPoses.request('helper',now,true);await updatePose($);poseDeadline($)}await push($)}
    return spawned
  })
  // One CwdChanged hook: main's D1 ribbon refresh and m1's always-on repository line and channel watch.
  on('classic.CwdChanged',async($,e,next)=>{
    const own=d1Epoch,result=await next(e)
    const changed={...result,...(companionChannel?{watchPaths:[...((result as {watchPaths?:string[]}).watchPaths??[]),companionChannel.requestWatch()]}:{})}
    if(own!==d1Epoch)return changed
    // A host without a repository reader still moves the ribbon.
    const repo=await $.session.repo().catch(()=>null);if(own!==d1Epoch)return changed
    always.repo=repo?.root??e.new_cwd;publishAlways($)
    presenceMetadata.cwd=e.new_cwd;await snapshotNow($);if(own!==d1Epoch)return changed
    await d1Ribbon($,presenceState);if(own!==d1Epoch)return changed
    companionActivity({project:view.ribbon?.folder??ribbonFolder(e.new_cwd,d1Home)});presenceActivity($);await push($);return changed
  })
  on('ui.render',{component:'UserMessage'},async($,e,next)=>{
    const task=e.props.task,id=task?.id,own=d1Epoch
    if(task&&id&&['completed','failed','killed'].includes(task.status??''))scheduleAfter($,0,()=>own===d1Epoch?d1Finished($,id,task.status==='completed'?'done':task.status==='failed'?'failed':'stopped',task.durationMs===undefined?undefined:{durationMs:task.durationMs}):undefined)
    return next(e)
  })

  // Desktop answers are ordinary return values. The asynchronous terminal lane remains separate.
  on('ui.render', { component:'AbovePrompt' }, ($,e,next) => {
    // The first hello is re-projected against a fresh clock before this draw: an expired one is gone from it.
    const hello = view.line?.key === 'first.hello'
    if (cost) return snapshotNow($).then(async () => {
      if (hello) await reprojectHello($)
      refreshCostView()
      const drawn = paintedRequest(e) ? renderDesktop($,e) : await renderOtherBand($,e,next)
      subscribeBand($,e)
      costCupDrawn(e,drawn)
      if (e.surface === 'desktop' || e.surface === 'terminal') iconFirstDraw(bookEngine($))
      return drawn
    })
    if(paintedRequest(e)) {
      // The host runs the plume, the stick's steps and the relight on its own clock from the offsets drawn here, so a
      // draw made after quiet minutes (a tab switch, a second window) takes the time now, not the last event's.
      const playing = view.play?.stick !== undefined || view.play?.breath !== undefined || view.play?.relit !== undefined
      const candidate: RenderElement | Promise<RenderElement> = playing || hello
        ? snapshotNow($).then(async () => { if (hello) await reprojectHello($); if (view.play) view.play = { ...view.play, at: clockSnapshot }; return renderDesktop($,e) })
        : renderDesktop($,e)
      subscribeBand($,e)
      // With the incense playing the draw waits for the clock first; the cup is read from the tree it gives.
      if (candidate instanceof Promise) void candidate.then(tree => costCupDrawn(e, tree)); else costCupDrawn(e, candidate)
      if (e.surface === 'desktop') iconFirstDraw(bookEngine($))
      return candidate
    }
    const candidate = hello ? reprojectHello($).then(() => renderOtherBand($,e,next)) : renderOtherBand($,e,next)
    if (bandSeen.has(bandRequestKey(e))) subscribeBand($,e)
    else void candidate.then(() => subscribeBand($,e))
    void candidate.then(() => { if (e.surface === 'terminal') iconFirstDraw(bookEngine($)) })
    return candidate.then(tree => { costCupDrawn(e, tree); return tree })
  }).catch(($,e) => {
    if(paintedRequest(e)) return desktopIdentity($,e)
    return <></>
  })

  // Terminal spinner: his verb for this turn; the engine keeps its glyph, time and tokens.
  // Responses update the box through turn.step, independently of whether this row draws.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.message !== null) return next(e)
    return next({ ...e, props: { ...e.props, word: view.verb } })
  })

  // Presses in his book that change what lives here: the settings and today's slip. The book
  // (pages.tsx) draws those buttons; any other press passes on.
  on('ui.press', async ($, e, next) => {
    if (e.plugin !== 'coco') return next(e)
    const noteId=receivedNoteId(e.element)
    if(noteId!==undefined){
      const generation=lifecycleGeneration,inbox=receivedInbox()
      const marker=moreWord(RECEIVED_MARKER_SLOT,view.lang)
      try{
        await inbox.pass(noteId,marker,text=>generation===lifecycleGeneration&&moreWord(RECEIVED_MARKER_SLOT,view.lang)===marker
          ?$.prompt.submit({text}):Promise.resolve(undefined))
      }finally{
        if(generation===lifecycleGeneration){refreshReceivedLine($);await push($);$.ui.invalidate('ui.render')}
      }
      return {element:e.element}
    }
    if(bands.has(e.requestId)&&view.line?.key==='long.done'){lineSlot.dismiss('long.done',clockSnapshot);projectLine($,false)}
    if(e.element.startsWith('coco:trim:'))d1CopySurface=e.surface as typeof d1CopySurface
    if(e.element==='coco:longtask:settings'){await feedCompanion($,companionRequestText(present(view),companionId,c3Surface==='desktop',await snapshotNow($),{longTaskSettingsRequest:clockSnapshot}));return {element:e.element}}
    const [, scope, what, value] = e.element.split(':')
    if(scope==='more'){
      const engine=moreEngine($),runtime=m1More
      if(!runtime)return next(e)
      const id=what==='explain'?'explain':what==='look'?'look':what==='paste'?'paste':undefined
      if(!id)return next(e)
      const token=runtime?.operationToken(id)
      if(what==='explain')await runtime?.explain(engine,clockSnapshot,e.surface!=='terminal')
      else if(what==='look')await runtime?.secondLook(engine)
      else if(what==='paste'&&value==='hide'){await runtime?.hidePaste(engine);if(runtime!==m1More||token===undefined||!runtime.operationCurrent(id,token))return {element:e.element};lineSlot.dismiss('more.paste',clockSnapshot);projectLine($)}
      else if(what==='paste'&&value==='keep'){runtime?.keepPaste();lineSlot.dismiss('more.paste',clockSnapshot);projectLine($)}
      else return next(e)
      if(runtime===m1More&&token!==undefined&&runtime.operationCurrent(id,token))await push($)
      return {element:e.element}
    }
    if(scope==='chapter'&&what==='compact'){clearCompanionLine('prompt');lineSlot.clear('prompt',clockSnapshot);projectLine($);c3?.chapterPressed();await compactChapter(()=>$.session.compact(),text=>$.prompt.fill({text}));await push($);return {element:e.element}}
    if(scope==='stuck'&&what==='off'){await runtimeNotice($).stuckOff(value??'');return {element:e.element}}
    if (scope === 'band' && (what === 'poke' || what === 'pat') && paintedBand(e.surface) && (!e.link || e.link.href === 'file:///coco-poke')) {
      await touch($, what, e.requestId)
      return { element: e.element }
    }
    else if (scope === 'check' && what === 'band') await choose($, { band: 'on' })
    else if (scope === 'band' && what === 'close') await choose($, { band: 'off' })
    else if (scope === 'set' && what === 'workSize' && (value === 'same' || value === 'smaller')) await choose($, { workSize: value })
    else if (scope === 'band' && what === 'wake') await choose($, { band: lastBand })
    else if (scope === 'set' && what === 'voice' && (value === 'off' || value === 'light' || value === 'full')) await choose($, { voice: value })
    else if (scope === 'set' && what === 'affection' && (value === 'warm' || value === 'clingy')) await choose($, { affection: value })
    else if(scope==='first'&&what==='voice'&&value==='keep'){storedSettings.voiceChosen=true;await choose($,{voice:'off'})}
    else if(scope==='set'&&what==='waitSound'&&(value==='on'||value==='off')){const previewChoice=++waitSoundPreviewChoice,previewLifecycle=lifecycleGeneration;if(value==='off')waitBell.end();await chooseReminder($,'waitSound',value==='on');if(value==='on'&&companionSupported&&previewChoice===waitSoundPreviewChoice&&previewLifecycle===lifecycleGeneration&&storedSettings.waitSound===true)await $.audio.play({asset:'assets/sound/waiting.wav'},{gain:1})}
    else if (scope === 'set' && what === 'band' && (value === 'on' || value === 'compact' || value === 'off' || value === 'text')) await choose($, { band: value })
    else if (scope === 'set' && what !== undefined && ['guard','bookmark','notes','neighbours','visitors','breathe','week'].includes(what) && (value === 'on' || value === 'off')) await chooseReminder($, what, value === 'on')
    else if (scope === 'set' && what === 'stickEnd' && (value === 'quiet' || value === 'sound')) await chooseReminder($, 'stickEnd', value)
    else if (scope === 'socks' && what !== undefined && sockPair(what) && socksOpen(storedSettings).includes(sockPair(what)!)) await chooseReminder($, 'socks', what)
    else if (scope === 'set' && what === 'socksMode' && (value === 'collect' || value === 'all')) await chooseReminder($, 'socksMode', value)
    else if (scope === 'set' && what === 'claudeForm' && (value === 'coco' || value === 'dake' || value === 'maid' || value === 'fish')) await chooseReminder($, 'claudeForm', value)
    // the bag's pictures: the current ones or the MV style's (owner 10-17)
    else if (scope === 'set' && what === 'bagStyle' && (value === 'classic' || value === 'mv')) await chooseReminder($, 'bagStyle', value)
    // Keeping the cache warm, from their bag's switches (lane C, 10-14): the cost runtime stores and runs it; their cup is the
    // thermos while it is on.
    // Keeping the cache warm: the first «on» opens the one-time question (ask, then no or on); «off» while off changes nothing.
    else if (scope === 'set' && what === 'warm' && (value === 'on' || value === 'off' || value === 'ask' || value === 'no')) {
      const ready = await ensureCost($)
      if (value === 'ask' || value === 'no') ready?.askWarm(value === 'ask')
      else if (value === 'on' || ready?.snapshot().warmEnabled) { m1More?.noteWarm(value === 'on'); await ready?.setWarm(value === 'on') }
      await push($)
    }
    else if (scope === 'stick' && (what === 'light' || what === 'out')) { if (what === 'light') await lightStick($, STICK_DEFAULT_MINUTES); else await putOutStick($) }
    else if (scope === 'set' && what === 'budget' && value !== undefined && ['off','50','80','90'].includes(value)) await chooseReminder($, what, value === 'off' ? 'off' : Number(value))
    else if(scope==='set'&&what==='longtask'&&value!==undefined&&['off','band','notify'].includes(value))await chooseReminder($,'longTask',value)
    else if(scope==='set'&&what==='trim'&&(value==='on'||value==='off'))await chooseReminder($,'trim',value==='on')
    else if (scope === 'set' && what === 'lang' && value) await chooseLang($, value)
    else {
      const pressed = await next(e)
      if (companionLive) void background($, 'companion.refresh', companionHere($).then(() => pushCompanion($)))
      return pressed
    }
    if (companionLive) void background($, 'companion.refresh', companionHere($).then(() => pushCompanion($)))
    return { element: e.element }
  })

  // His voice in Claude's replies: one short section on the session side of the prompt cache,
  // never the shared side, and none in a session nobody sees.
  on('prompt.compose', async ($, e, next) => {
    // Claude Code 2.1.302 refuses a next() whose input has no promptModel, and the compose the Settings check-up asks for
    // itself ($.prompt.compose()) can arrive without one; promptModel is the model's own unless the engine names another
    const input = (e as { promptModel?: string }).promptModel ? e : ({ ...e, promptModel: e.model } as typeof e)
    const composed = await next(input)
    if (view.voice === 'off' || e.surfaces.length === 0 || e.traits.includes('bare')) return composed
    return { sections: [...composed.sections, VOICE_SECTION[view.voice]] }
  })

  // Replies go to a toast: nothing reaches the transcript or the model.
  on('command.run', { command: 'coco' }, async ($, e) => {
    const words = WORDS[view.lang]
    const [verb = '', value = ''] = e.args.trim().toLowerCase().split(/\s+/)
    const tell = (text: string) => $.ui.toast(text, { timeoutMs: 8000 })
    if (verb === 'icon') {
      // Native icon actions require an engine-stamped human command, including Remote Control.
      if (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge') return {}
      const args = e.args.trim().split(/\s+/)
      const action = args[1] ?? 'status'
      await hydrate($)
      if (args.length > 2 || !['apply','clear','status'].includes(action)) tell(await iconWord(bookEngine($), 'S8'))
      else await iconCommand(bookEngine($), action as 'apply' | 'clear' | 'status', tell)
      return {}
    } else if (verb === 'companiontarget' && (value === 'auto' || value === 'claude' || value === 'vscode')) {
      await chooseCompanionTarget($, value)
    } else if (verb === 'voice' && (value === 'off' || value === 'light' || value === 'full')) {
      await choose($, { voice: value })
      tell(words.reply.voice.replace('{value}', value))
    } else if (verb === 'affection' && (value === 'warm' || value === 'clingy')) {
      await choose($, { affection: value })
      tell(words.reply.affection.replace('{value}', value))
    } else if (verb === 'band' && (value === 'on' || value === 'compact' || value === 'off' || value === 'text')) {
      await choose($, { band: value })
      tell(words.reply.band.replace('{value}', value))
    } else if (verb === 'lang') {
      tell(await chooseLang($, value))
    } else if (verb === 'vibe') {
      // One command is enough (owner 10-16): /omen and the shrine words (omen, offerings) are gone as inputs.
      await openVibeCheck(bookEngine($))
    } else if (verb === 'dm') {
      // The DM thread (owner's cards 10-17 late); with Talk off, the bag's page where it turns on.
      await openM1Book(bookEngine($), m1More?.isOn('talk') ? 'talk' : 'settings')
    } else if (verb === 'focus') {
      const focus = parseFocus(value)
      if (focus?.kind === 'out') await putOutStick($)
      else if (focus) await lightStick($, focus.minutes)
      else tell(words.reply.usage)
    } else {
      tell(words.reply.usage)
    }
    return {}
  })
}
