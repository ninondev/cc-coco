// Claude-sama reads beside you above the prompt.
//
// No model or network calls, no telemetry. The companion's field submits only on the person's
// press, through Claude Code's prompt API. Besides drawing, this module
// touches: $.store (his settings, the turn count, today's omen, when you were last here), the
// settings it reads (reduced motion, language, time zone, theme), a few locale and terminal
// environment variables, its own assets/ PNGs and one short system-prompt section for his voice
// (/claudesama voice). The book's companion button runs the system `open` command. The app
// icon is a separate command (/claudesama:icon) that asks Claude to run bin/icon-*.sh where you
// can see and approve it.
//
// Cost: animation holds follow one shared motion model. Terminal frames blit; desktop SVG
// frames redraw from bundled bytes. Off and sleep have no animation timer. The offering box
// follows response/measurement events, with no polling even while working. Optional companion
// writes and diagnostics run after the band's state publication/redraw request.
//
// The state machine lives here because every function handed `$` must sit in this file.
// mood.ts holds its pure parts; band.tsx draws; pictures.ts builds the images once.

import type { EngineInterface, Register, SessionContextUsage, ToolCallInput, TurnCompleteInput, TurnUsage } from 'claude-code'
import type { FrameName } from './art'
import { desktopBand, desktopDoor, planDesktop, rowsOf, terminalBand, terminalDoor, terminalHasSprite } from './band'
import {
  ABSOLUTELY_RIGHT, FORCE_PUSH, LOOPS, PERSON, PRAISE, PYTHON, STILL, TEST_RUN, TIMING, colorsOf, cueFor, fill, fortunesFor, greetingFor,
  HEARING, detectLanguage, initialView, langOf, languageOf, linesFor, localDay, localHour, pick, rollRank, slipLabel,
} from './mood'
import { COMPANION_DIR, COMPANION_FEED, companionActivity, companionEnded, companionKey, companionSeen, companionSession, companionTask, companionText } from './companion'
import { CompanionChannel } from './channel'
import { replyExcerpt, taskForTool } from './tasks'
import type { TaskDescription } from './tasks'
import { companionChanged, registerBook } from './pages'
import { bundledPng, bundledSvg, spriteCells } from './pictures'
import { blinkDouble, blinkGap, blinkInterval, blinkShut, gazeBlinkDelay, motionCycle } from './motion'
import { ATOMIC_WRITE, DIAGNOSTIC_APPEND, safeDiagnosticError } from './shared-files'
import { homePath, isWindows, joinPath } from './paths'
import { registerTranscript } from './transcript'
import { latest } from './latest'
import { gapBefore } from './typeset'
import { VOICE } from './voice'
import { LANGS, WORDS } from './words'
import type { Lang, Mood } from './words'
import type { ClaudesamaView as View } from '../types'

type Engine = EngineInterface
type Timer = { cancel: () => void }
type TimerName =
  | 'loop' | 'revert' | 'blink' | 'say' | 'slip' | 'long' | 'sleep' | 'clingy' | 'ask' | 'poke' | 'pokeLine'
type Draw = { day: string; rank: string; index: number }
type Shown = 'cells' | 'image' | 'svg' | null // what each mounted band draws for him

const VIEW = { plugin: 'claudesama', key: 'view' } as const
// Built once: the one system-prompt section per voice level, on the session side of the cache.
const VOICE_SECTION = {
  light: { id: 'claudesama:voice', text: VOICE.light, scope: 'session' as const },
  full: { id: 'claudesama:voice', text: VOICE.full, scope: 'session' as const },
}

// ---------------------------------------------------------------- what he is doing now

let view: View = initialView()
let reducedMotion = false
let timeZone: string | undefined
let working = false
let turnId = ''
let toolsThisTurn = 0
let failures = 0
let wildPending = false
let lastActivity = 0
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
let companionHome: string | undefined
let companionThere = false
let companionSupported = false
let companionLive = false
let companionId = ''
let companionChannel: CompanionChannel | undefined
let currentTask: TaskDescription | null = null
let locale: unknown[] = [] // LC_ALL, LC_MESSAGES, LANG as read at start
let langChosen: Lang | undefined // /claudesama lang, kept in $.store: wins over settings and locale
let heard: Lang | undefined // the language of the person's prompts, kept in $.store: after the setting
let hearing: Lang | undefined // the last prompt's guess, waiting for a second that agrees
const timers: Partial<Record<TimerName, Timer>> = {}
const bands = new Map<string, Shown>() // band instances by requestId
const animationRedraws = new Set<string>()
const diagnosticBands = new Map<string, string>()
let statePublishFailed = false
let publishedVersion = 0
let publishPending = 0
let lastBand: 'on' | 'compact' = 'on'
let preferences: Promise<void> | undefined
let adoptedRestored = false
let diagnosticEnabled = false
let diagnosticChecked = -Infinity
let diagnosticChecking = false
let firstBand = true
// Local touch is a face overlay; task mood, book records and companion feed stay unchanged.
let poked: { frame?: FrameName; line?: string } | undefined
let pokeClicks: number[] = []
let lastPoke = -Infinity
const pokeNext = new Map<string, number>()
let diagnostics: Promise<string | undefined> | undefined
let diagnosticWrite: Promise<void> = Promise.resolve()
let diagnosticRegistered = false
let diagnosticPending = 0

// register has no engine argument. Record its completed step with the first engine event.
async function checkDiagnostics($: Engine, force = false): Promise<void> {
  if (diagnosticChecking) return
  const now = await $.clock.now()
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
  finally { diagnosticChecking = false }
}

// Cached OFF is an immediate return, including on every render. Only engine events refresh
// the flag, at most once per ten seconds; animation frames never enter this function.
function diagnose($: Engine, step: string, error?: unknown, detail?: Record<string, unknown>): void {
  if (!diagnosticEnabled || diagnosticPending >= 64) return
  diagnosticPending += 1
  const message = error === undefined ? undefined : safeDiagnosticError(error)
  const at = $.clock.now()
  diagnosticWrite = diagnosticWrite.then(async () => {
    const folder = await diagnostics
    if (!folder || !diagnosticEnabled) return
    const steps = diagnosticRegistered ? [step] : ['register', step]
    diagnosticRegistered = true
    for (const current of steps) {
      const line = JSON.stringify({ at: await at, step: current,
        ...(current === step ? detail : {}),
        ...(current === step && message !== undefined ? { message } : {}) }) + '\n'
      const written = await $.process.run(['/bin/sh', '-c', DIAGNOSTIC_APPEND, 'claudesama', folder], { stdin: line, timeoutMs: 2000 })
      if (written.exitCode !== 0) throw new Error('diagnostic append failed')
    }
  }).catch(() => undefined).finally(() => { diagnosticPending -= 1 })
}

function caught($: Engine, step: string, error: unknown): void { diagnose($, `error:${step}`, error) }
function background($: Engine, step: string, work: Promise<unknown>): Promise<void> {
  return work.then(() => undefined, error => caught($, step, error))
}
async function optional<T>($: Engine, step: string, work: () => Promise<T>, fallback: T): Promise<T> {
  try { return await work() } catch (error) { caught($, step, error); return fallback }
}
function redraw($: Engine, why: string): void {
  animationRedraws.clear()
  diagnose($, `redraw:${why}`)
  try { $.ui.invalidate('ui.render') } catch (error) { caught($, 'invalidate', error) }
}

function after($: Engine, ms: number, callback: () => unknown): Timer {
  return $.clock.after(ms, async () => {
    try { await callback() } catch (error) { caught($, 'timer.after', error) }
  })
}

function stop(name: TimerName): void {
  timers[name]?.cancel()
  delete timers[name]
}

function stopAll(): void {
  for (const name of Object.keys(timers) as TimerName[]) stop(name)
}

function spriteOnScreen(): boolean {
  for (const shown of bands.values()) if (shown) return true
  return false
}

async function publish($: Engine, invalidate = true, trace = true): Promise<void> {
  if (trace) animationRedraws.clear()
  const snapshot = { ...view, bandBeforeOff: lastBand }
  publishPending += 1
  try {
    const set = await $.state.set(VIEW, snapshot)
    statePublishFailed = !set.isSet
    if (!set.isSet) latest.view = snapshot
    publishedVersion = set.version
    if (trace) diagnose($, 'push', undefined, { version: set.version, published: set.isSet })
  } catch (error) {
    statePublishFailed = true
    latest.view = snapshot
    if (trace) caught($, 'state.set', error)
    if (trace) diagnose($, 'push', undefined, { version: publishedVersion, published: false })
  } finally {
    publishPending -= 1
    if (invalidate) redraw($, statePublishFailed ? 'state.set-fallback' : 'state.set')
  }
}

async function push($: Engine): Promise<void> {
  taskNow()
  const captured = companionLive ? companionKey(view) : undefined
  await publish($)
  void background($, 'diagnostics.check', checkDiagnostics($))
  // Optional host I/O never lies between the event and its redraw or delays the next mood.
  if (captured !== undefined) void background($, 'companion', pushCompanion($, captured))
}

async function pushCompanion($: Engine, captured = companionKey(view)): Promise<void> {
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
    const record = JSON.parse(captured) as Record<string, unknown>
    record.channel = companionChannel?.isRunning ?? false
    const key = JSON.stringify(record)
    if (key === companionSent) return
    companionSent = key
    const desktop = (await $.session.surfaces()).includes('desktop')
    if (!(await feedCompanion($, companionText(key, companionId, desktop, await $.clock.now()))) && companionSent === key) companionSent = ''
  } catch (error) {
    companionSent = ''
    companionChannel?.stop()
    caught($, 'companion', error)
  } finally { finish() }
}

async function companionHere($: Engine): Promise<boolean> {
  if (!companionSupported) return false
  companionHome ??= homePath(await $.env.get('HOME'), await $.env.get('USERPROFILE'))
  companionThere = companionHome !== undefined && (await $.fs.exists(joinPath(companionHome, COMPANION_DIR)))
  return companionThere
}

async function feedCompanion($: Engine, text: string): Promise<boolean> {
  if (companionHome === undefined) return false
  // $.fs.write creates missing folders, so look again right before every write: a companion
  // uninstalled a moment ago must stay uninstalled.
  if (!(await $.fs.exists(joinPath(companionHome, COMPANION_DIR)))) {
    companionThere = false
    companionChannel?.stop()
    companionSent = ''
    return false
  }
  try {
    const written = await $.process.run(['/bin/sh', '-c', ATOMIC_WRITE, 'claudesama', joinPath(companionHome, COMPANION_DIR), 'view.json'], { stdin: text, timeoutMs: 2000 })
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
      : { requestId, key: 'sprite', source: { png: bundledPng(frame) } })
      .catch(() => ({ deny: 'unavailable' }))
    if (blit.deny) bands.set(requestId, null)
  }
  // Keep the task's frame current beneath a held poke face, without redrawing hidden frames.
  if (svg && !poked?.frame) {
    for (const requestId of bands.keys()) animationRedraws.add(requestId)
    try { $.ui.invalidate('ui.render') } catch { /* next draw carries the frame */ }
  }
}

async function setMood($: Engine, mood: Mood, holdMs?: number): Promise<void> {
  clearPoke()
  stop('loop')
  stop('revert')
  stop('blink')
  view.mood = mood
  view.frame = STILL[mood]
  if (holdMs !== undefined) timers.revert = after($, holdMs, () => background($, 'settle', settle($)))
  animate($)
  await push($)
  if (mood === 'idle') blinkAtGaze($)
}

// Starts the mood's motion if a sprite is on screen and nothing runs yet: the two-frame loop
// of a running turn, or the idle blink. Also called when a band first shows his picture.
function animate($: Engine): void {
  if (reducedMotion || view.band === 'off' || !spriteOnScreen()) return
  const loop = LOOPS[view.mood]
  if (loop && !timers.loop) {
    let tick = 0
    const hold = motionCycle(view.mood as 'think' | 'work' | 'wild')
    const schedule = () => {
      timers.loop = after($, hold(), async () => {
        delete timers.loop
        if (view.band === 'off' || LOOPS[view.mood] !== loop || !spriteOnScreen()) return
        tick = 1 - tick
        await showFrame($, loop.frames[tick] ?? loop.frames[0])
        schedule()
      })
    }
    schedule()
  }
  if (view.mood === 'idle' && !timers.blink) blinkLater($)
}

// The face he rests on: reading when idle, thinking or writing while a turn runs.
async function settle($: Engine): Promise<void> {
  delete timers.revert
  if (view.slip) return push($)
  return setMood($, working ? (toolsThisTurn > 0 ? 'work' : 'think') : 'idle')
}

function blinkLater($: Engine, wait = blinkInterval()): void {
  stop('blink')
  if (reducedMotion || view.band === 'off' || !spriteOnScreen() || view.mood !== 'idle') return
  timers.blink = after($, wait, () => blink($, blinkDouble()))
}

async function blink($: Engine, double: boolean): Promise<void> {
  if (view.mood !== 'idle' || view.band === 'off' || reducedMotion) return
  await showFrame($, 'idle-blink')
  timers.blink = after($, blinkShut(), async () => {
    if (view.mood !== 'idle' || view.band === 'off' || reducedMotion) return
    await showFrame($, 'idle-reading')
    if (double) timers.blink = after($, blinkGap(), () => blink($, false))
    else blinkLater($)
  })
}

function blinkAtGaze($: Engine): void {
  if (view.mood !== 'idle' || view.frame === 'idle-blink') return
  const wait = gazeBlinkDelay()
  if (wait !== undefined) blinkLater($, wait)
}

async function sayText($: Engine, text: string | undefined): Promise<void> {
  if (!text) return push($)
  stop('say')
  view.said = text
  blinkAtGaze($)
  timers.say = after($, TIMING.say, () => {
    view.said = null
    blinkAtGaze($)
    background($, 'push', push($))
  })
  await push($)
}

function say($: Engine, key: string, vars: Record<string, string | number> = {}): Promise<void> {
  return sayText($, fill(pick(`${view.lang}:${view.affection}:${key}`, linesFor(view, key)), vars))
}

// One-shot timers armed by activity, never a polling loop: asleep after four quiet minutes, and
// in the clingy voice one line after 150 seconds.
function armQuiet($: Engine): void {
  stop('sleep')
  stop('clingy')
  if (working || view.band === 'off') return
  timers.sleep = after($, TIMING.sleepAfter, async () => {
    delete timers.sleep
    if (working || view.mood !== 'idle') return
    await setMood($, 'sleep')
    await say($, 'sleep')
  })
  if (view.affection === 'clingy') {
    timers.clingy = after($, TIMING.clingyAfter, () => {
      delete timers.clingy
      if (!working && view.mood === 'idle') background($, 'say.idle', say($, 'idle'))
    })
  }
}

// ---------------------------------------------------------------- the offering box
//
// Each main-thread response completes turn.step on every surface. Usage is an in-process
// snapshot, measured events carry their figure directly. No sampler or delayed spinner read.

async function gauge($: Engine, given?: SessionContextUsage, response = false, usage?: TurnUsage): Promise<void> {
  if (awaitingResponse && !response) return
  if (response) awaitingResponse = false
  let context = given
  if (context === undefined) {
    try {
      context = (await $.session.usage()).context
    } catch (error) {
      caught($, 'usage', error)
      return
    }
  }
  if (context?.window && usage) {
    const tokens = usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens
    context = { ...context, tokens, percent: Math.round(tokens / context.window * 100) }
  }
  if (!context?.window || (context.tokens === undefined && context.percent === undefined)) return
  await showContext($, context.percent ?? Math.round(((context.tokens ?? 0) / context.window) * 100), false)
}

async function showContext($: Engine, percent: number, estimate: boolean): Promise<void> {
  if (percent < TIMING.offeringReset) offeringWarned = false
  if (view.context === percent && view.estimate === estimate) return
  view.context = percent
  view.estimate = estimate
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
    const total = context.breakdown?.totalTokens ?? tokensAfter
    if (context.window && total !== undefined) return showContext($, Math.round((total / context.window) * 100), true)
  } catch (error) {
    caught($, 'usage.estimate', error)
  }
  view.context = null
  view.estimate = false
  await push($)
}

// ---------------------------------------------------------------- session

// Host store/settings/env calls stay in process. A fresh first draw awaits exactly this
// initialization; a restored host view already carries its correct visible preferences.
function hydrate($: Engine): Promise<void> {
  return preferences ??= (async () => {
  const settings = await optional($, 'settings.read', () => $.settings.read(), {})
  reducedMotion = settings.prefersReducedMotion === true
  timeZone = typeof settings.timeZone === 'string' ? settings.timeZone : undefined
  locale = [await optional($, 'env.LC_ALL', () => $.env.get('LC_ALL'), undefined), await optional($, 'env.LC_MESSAGES', () => $.env.get('LC_MESSAGES'), undefined), await optional($, 'env.LANG', () => $.env.get('LANG'), undefined)]
  langChosen = langOf(await optional($, 'store.lang', () => $.store.get('lang'), undefined))
  heard = langOf(await optional($, 'store.heard', () => $.store.get('heard'), undefined))
  hearing = undefined
  const lang = languageOf(langChosen, settings.language, heard, ...locale)
  const term = (await optional($, 'env.TERM', () => $.env.get('TERM'), undefined)) ?? ''
  const program = (await optional($, 'env.TERM_PROGRAM', () => $.env.get('TERM_PROGRAM'), undefined)) ?? ''
  const inTmux = (await optional($, 'env.TMUX', () => $.env.get('TMUX'), undefined)) !== undefined
  const kittyWindow = (await optional($, 'env.KITTY_WINDOW_ID', () => $.env.get('KITTY_WINDOW_ID'), undefined)) !== undefined
  const colorterm = (await optional($, 'env.COLORTERM', () => $.env.get('COLORTERM'), undefined)) ?? ''
  const windowsTerminal = (await optional($, 'env.WT_SESSION', () => $.env.get('WT_SESSION'), undefined)) !== undefined
  const band = await optional($, 'store.band', () => $.store.get('band'), undefined)
  const workSize = await optional($, 'store.workSize', () => $.store.get('workSize'), undefined)
  const voice = await optional($, 'store.voice', () => $.store.get('voice'), undefined)
  const affection = await optional($, 'store.affection', () => $.store.get('affection'), undefined)
  const beforeOff = await optional($, 'store.bandBeforeOff', () => $.store.get('bandBeforeOff'), undefined)
  lastBand = band === 'on' || band === 'compact' ? band : beforeOff === 'compact' ? 'compact' : 'on'
  view = {
    ...view,
    lang,
    pictures: !inTmux && (kittyWindow || /kitty|ghostty/i.test(term) || /ghostty/i.test(program)) ? 'kitty' : 'cells',
    band: band === 'compact' || band === 'off' ? band : 'on',
    workSize: workSize === 'smaller' ? 'smaller' : 'same',
    voice: voice === 'off' || voice === 'full' ? voice : 'light',
    affection: affection === 'clingy' ? 'clingy' : 'warm',
    verb: WORDS[lang].spinner[0] ?? 'reading',
    colors: colorsOf({ colorterm, term, program, tmux: inTmux, windowsTerminal }),
    cue: cueFor(settings.theme),
  }
  })()
}

async function boot($: Engine, surface: string | null): Promise<void> {
  clearPoke()
  pokeClicks = []
  lastPoke = -Infinity
  pokeNext.clear()
  await hydrate($)
  await publish($)
  stopAll()
  companionChannel?.stop()
  companionChannel = undefined
  companionSent = ''
  const home = await optional($, 'env.HOME', () => $.env.get('HOME'), undefined), profile = await optional($, 'env.USERPROFILE', () => $.env.get('USERPROFILE'), undefined)
  companionSupported = !isWindows(await optional($, 'env.OS', () => $.env.get('OS'), undefined), home, profile) && (await optional($, 'platform', () => $.fs.exists('/System/Library/CoreServices/SystemVersion.plist'), false))
  companionLive = companionSupported
  companionHome = companionLive ? homePath(home, profile) : undefined
  companionId = await optional($, 'session.id', () => $.session.id(), '')
  companionSession(await optional($, 'session.root', () => $.session.root(), ''))
  currentTask = null
  if (companionLive && companionHome !== undefined) {
    const channel = new CompanionChannel({
      exists: path => $.fs.exists(path),
      spawn: argv => $.process.spawn({ argv }),
      ensureRequests: async path => {
        const made = await $.process.run(['/usr/bin/touch', path], { timeoutMs: 2000 })
        if (made.exitCode !== 0) throw new Error('request create failed')
      },
      now: () => $.clock.now(),
      submit: text => $.prompt.submit({ text, asUser: true }),
      clear: () => $.command.run({ command: 'clear', args: '' }),
    }, companionId, joinPath(companionHome, COMPANION_DIR), {
      running: running => { if (companionChannel === channel) companionActivity({ channel: running }) },
      seen: upto => { if (companionChannel === channel) companionSeen(upto) },
      ack: async id => {
        if (companionChannel !== channel) return
        companionActivity({ ack: id })
        companionSent = '' // An idempotent retry must republish even an unchanged acknowledgement.
        await push($)
      },
      changed: async () => { if (companionChannel === channel) await push($) },
      companionState: async info => { companionChanged(info); redraw($, 'companion-state') },
      error: error => caught($, 'channel', error),
    })
    companionChannel = channel
  }
  await hydrate($)
  working = false
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
  lastActivity = await $.clock.now()
  await gauge($)
  if (view.context === null) await sweep($)
  await setMood($, 'idle')
  armQuiet($)
  if (surface === 'terminal') await arrive($)
  if (await companionHere($)) void background($, 'companion.start', pushCompanion($))
}

// A /config change applies at once: reduced motion, theme, language, time zone.
async function settingsMoved($: Engine): Promise<void> {
  const settings = await optional($, 'settings.read', () => $.settings.read(), {})
  timeZone = typeof settings.timeZone === 'string' ? settings.timeZone : undefined
  view.cue = cueFor(settings.theme)
  const lang = languageOf(langChosen, settings.language, heard, ...locale)
  if (lang !== view.lang) {
    view.lang = lang
    view.verb = WORDS[lang].spinner[0] ?? view.verb
  }
  const motion = settings.prefersReducedMotion === true
  if (motion !== reducedMotion) {
    reducedMotion = motion
    if (motion) {
      stop('loop')
      stop('blink')
      view.frame = STILL[view.mood]
    } else {
      animate($)
    }
  }
  await push($)
  await gauge($)
}

// The first time a surface shows him this session: a wave and a greeting by the time of day,
// unless the session was active a moment ago (a reload, a quick resume).
async function arrive($: Engine): Promise<void> {
  await gauge($)
  if (arrived) return
  arrived = true
  const now = await $.clock.now()
  if (now - lastSeen < TIMING.reload) return
  await setMood($, 'wave', TIMING.wave)
  await sayText($, pick(`${view.lang}:greeting`, greetingFor(view, localHour(now, timeZone))))
}

async function sessionEnded($: Engine, reason: string): Promise<void> {
  clearPoke()
  pokeClicks = []
  lastPoke = -Infinity
  companionLive = false
  stopAll()
  companionChannel?.stop()
  companionChannel = undefined
  working = false
  currentTask = null
  companionTask(null)
  companionActivity({ reply: null, notice: null, waitAt: null, channel: false })
  await companionWrite
  if (await companionHere($)) await feedCompanion($, companionEnded(await $.session.id(), await $.clock.now()))
  companionSent = ''
  await optional($, 'store.set.lastActive', async () => { await $.store.set('lastActive', await $.clock.now()) }, undefined)
  if (reason === 'clear') return
  const line = pick(`${view.lang}:goodbye`, linesFor(view, 'goodbye'))
  if (line && view.band !== 'off') $.ui.toast(line)
}

// ---------------------------------------------------------------- turns

// The language he hears in the person's prompts (the desktop gives a mod no language setting
// and no locale). It takes over after two prompts in a row agree, or one long, clear prompt; a
// prompt with too little prose (code, a path, "ok") changes nothing. No toast and no line about
// it: the band speaks the new language from the next line on. A /claudesama lang choice and
// Claude Code's language setting still come first.
async function hear($: Engine, text: string): Promise<void> {
  const guess = detectLanguage(text)
  if (!guess) return
  const sure = guess.confidence >= HEARING.sure && guess.words >= HEARING.long
  const agreed = guess.lang === hearing
  hearing = guess.lang
  if ((!sure && !agreed) || guess.lang === heard) return
  heard = guess.lang
  await optional($, 'store.set.heard', async () => { await $.store.set('heard', heard) }, undefined)
  const lang = languageOf(langChosen, (await $.settings.read()).language, heard, ...locale)
  if (lang === view.lang) return
  view.lang = lang
  view.verb = WORDS[lang].spinner[0] ?? view.verb
}

async function prompted($: Engine, text: string, origin: string): Promise<void> {
  if (!PERSON.has(origin)) return
  await hear($, text)
  const now = await $.clock.now()
  const away = now - lastActivity
  const wasAsleep = view.mood === 'sleep'
  lastActivity = now
  view.slip = null
  view.said = null
  stop('say')
  stop('slip')
  if (wasAsleep) await setMood($, 'idle')
  if (away >= TIMING.back) return say($, 'back')
  if (wasAsleep) return say($, 'wake')
  if (/ultrathink/i.test(text)) return say($, 'ultrathink')
  if (PRAISE.test(text)) return say($, 'praised')
  if (PYTHON.test(text)) return setMood($, 'snake', TIMING.snake)
  await push($)
}

async function turnStarted($: Engine, id: string): Promise<void> {
  reducedMotion = (await optional($, 'settings.read', () => $.settings.read(), {})).prefersReducedMotion === true
  working = true
  currentTask = null
  companionTask({ key: 'thinking' })
  companionActivity({ waitAt: null })
  turnId = id
  toolsThisTurn = 0
  spinnerStage = ''
  lastActivity = await $.clock.now()
  stop('sleep')
  stop('clingy')
  view.verb = pick(`${view.lang}:verb`, WORDS[view.lang].spinner) ?? view.verb
  stop('long')
  timers.long = after($, TIMING.thinkingLong, () => {
    if (working && turnId === id) background($, 'say.thinking_long', say($, 'thinking_long'))
  })
  await setMood($, 'think')
  if (!startSaid) {
    startSaid = true
    await say($, 'start')
  }
}

async function toolStarted($: Engine, input: ToolCallInput, command: string | undefined): Promise<void> {
  const tool = input.tool
  lastActivity = await $.clock.now()
  if (!working) return
  toolsThisTurn += 1
  if (view.mood === 'waiting') await settled($)
  currentTask = taskForTool(input)
  companionTask(currentTask)
  companionActivity({ waitAt: tool === 'AskUserQuestion' ? lastActivity : null })
  await gauge($, undefined, true) // a tool call proves its main-thread response has landed
  if (tool === 'AskUserQuestion') {
    await setMood($, 'question')
    if (lastActivity - lastQuestion >= TIMING.questionGap) {
      lastQuestion = lastActivity
      await say($, 'question')
    }
    return
  }
  if (command !== undefined && FORCE_PUSH.test(command)) {
    await setMood($, 'flustered', TIMING.flustered)
    return say($, 'force_push')
  }
  if (view.mood === 'think' || view.mood === 'idle') await setMood($, 'work')
  await push($)
  if (toolsThisTurn === 25) await say($, 'working')
}

// Only test and build runs count toward the wild soul (and flash the startled face); any other
// command may fail quietly, as a grep with no match does.
async function toolEnded($: Engine, tool: string, command: string | undefined, isError: boolean, isDenied: boolean): Promise<void> {
  if (!working) return
  currentTask = null
  companionTask({ key: 'thinking' })
  companionActivity({ waitAt: null })
  if (view.mood === 'waiting') await settled($)
  else if (view.mood === 'question') await settle($)
  await gauge($)
  await push($)
  if (tool !== 'Bash' || isDenied || command === undefined || !TEST_RUN.test(command)) return
  if (isError) {
    failures += 1
    if (failures >= 3 && !wildPending) {
      wildPending = true
      await setMood($, 'wild', TIMING.wildFor)
      return say($, 'wild')
    }
    if (view.mood !== 'wild') await setMood($, 'error', TIMING.errorFlash)
    return
  }
  failures = 0
  if (wildPending) {
    wildPending = false
    await setMood($, 'flustered', TIMING.flustered)
    await say($, 'wild_after')
  }
}

// A call-bound permission event starts the wait immediately. The corresponding tool call
// settles it, including a classifier decision that never needed a human dialog.
async function asked($: Engine): Promise<void> {
  if (!working) return
  askedAt = await $.clock.now()
  companionActivity({ waitAt: askedAt })
  companionTask({ key: 'waitingOK' })
  await setMood($, 'waiting')
  await say($, 'waiting')
}

async function settled($: Engine): Promise<void> {
  askedAt = 0
  companionActivity({ waitAt: null })
  companionTask(currentTask ?? { key: 'thinking' })
  stop('ask')
  if (view.mood === 'waiting') await setMood($, 'work')
}

async function turnEnded($: Engine, e: TurnCompleteInput): Promise<void> {
  if (e.agentId !== undefined) return
  working = false
  currentTask = null
  companionTask(null)
  askedAt = 0
  spinnerStage = ''
  stop('long')
  stop('ask')
  const now = await $.clock.now()
  companionActivity({ done: now, waitAt: null, reply: { text: replyExcerpt(e.answer), at: now } })
  lastActivity = now
  const turns = Number((await optional($, 'store.turns', () => $.store.get('turns'), undefined)) ?? 0) + 1
  await optional($, 'store.set.turns', async () => { await $.store.set('turns', turns) }, undefined)
  await optional($, 'store.set.lastActive', async () => { await $.store.set('lastActive', now) }, undefined)
  armQuiet($)
  await gauge($, undefined, e.reason === 'answer' || e.reason === 'refusal')
  if (e.reason === 'error') {
    await setMood($, 'error', TIMING.error)
    return say($, 'error')
  }
  if (e.reason === 'refusal') {
    await setMood($, 'refuse', TIMING.refuse)
    return say($, 'refuse')
  }
  if (e.reason === 'aborted') {
    failures = 0
    wildPending = false
    await setMood($, 'flustered', TIMING.flustered)
    return say($, 'aborted')
  }
  if (ABSOLUTELY_RIGHT.test(e.answer)) {
    await setMood($, 'flustered', TIMING.flustered)
    return say($, 'absolutely_right')
  }
  await setMood($, 'happy', TIMING.happy)
  if (turns % 100 === 0) return say($, 'milestone', { pages: turns })
  if (e.durationMs >= TIMING.doneLong) return say($, 'done_long')
  if (e.durationMs >= TIMING.done) return say($, 'done')
}

// Native head pats use happy for 1.4 s, and three clicks in 1.5 s use flustered for 1.8 s.
// Repeated pokes within 300 ms do not extend the hold or queue work. Only a touch arms a timer.
function clearPoke(): void {
  stop('poke')
  stop('pokeLine')
  poked = undefined
}

async function poke($: Engine): Promise<void> {
  if (view.band === 'off') return
  const now = await $.clock.now()
  if (now - lastPoke < 300) return
  lastPoke = now
  pokeClicks = [...pokeClicks.filter(at => now - at < 1500), now].slice(-3)
  const flustered = pokeClicks.length >= 3
  const urgent = ['waiting', 'question', 'error', 'wild', 'refuse'].includes(view.mood)
  const hold = Math.min(flustered ? 1800 : 1400, urgent ? 900 : Infinity)
  const lines = linesFor(view, flustered ? 'poke_many' : 'poke')
  const next = flustered ? 0 : (pokeNext.get(view.lang) ?? 0)
  const line = lines.length ? lines[next % lines.length] : undefined
  if (!flustered && lines.length) pokeNext.set(view.lang, (next + 1) % lines.length)
  poked = { frame: flustered ? 'flustered' : 'happy', ...(line ? { line } : {}) }
  stop('poke')
  redraw($, 'poke')
  timers.poke = after($, hold, () => {
    delete timers.poke
    poked = poked?.line ? { line: poked.line } : undefined
    redraw($, 'poke.end')
  })
  stop('pokeLine')
  if (line) timers.pokeLine = after($, urgent ? 2000 : 2600, () => {
    delete timers.pokeLine
    poked = poked?.frame ? { frame: poked.frame } : undefined
    redraw($, 'poke.line.end')
  })
}

// ---------------------------------------------------------------- commands

async function choose($: Engine, picked: Partial<Pick<View, 'band' | 'voice' | 'affection' | 'workSize'>>): Promise<void> {
  if (picked.band === 'off') { if (view.band !== 'off') lastBand = view.band }
  else if (picked.band) lastBand = picked.band
  Object.assign(view, picked)
  if (view.band === 'off') { clearPoke(); stop('loop'); stop('blink'); stop('sleep'); stop('clingy') }
  else { animate($); if (picked.band) armQuiet($) }
  if (picked.affection) armQuiet($)
  await push($)
  if (picked.band) {
    await optional($, 'store.set.bandBeforeOff', async () => { await $.store.set('bandBeforeOff', lastBand) }, undefined)
    await optional($, 'store.set.band', async () => { await $.store.set('band', picked.band) }, undefined)
  }
  if (picked.workSize) await optional($, 'store.set.workSize', async () => { await $.store.set('workSize', picked.workSize) }, undefined)
  if (picked.voice) await optional($, 'store.set.voice', async () => { await $.store.set('voice', picked.voice) }, undefined)
  if (picked.affection) await optional($, 'store.set.affection', async () => { await $.store.set('affection', picked.affection) }, undefined)
}

// /claudesama lang <code>|auto: a language picked by hand wins over the settings and the locale
// until `auto`. Returns the reply, in the language he reads from now on.
async function chooseLang($: Engine, value: string): Promise<string> {
  const codes = LANGS.map(l => l.code).join(' ')
  if (value === '') return `lang: ${view.lang} (${codes} auto)`
  const picked = value === 'auto' ? undefined : langOf(value)
  if (value !== 'auto' && picked === undefined) return fill(WORDS[view.lang].reply.unknown, { value, codes }) ?? ''
  langChosen = picked
  await optional($, 'store.set.lang', async () => { await $.store.set('lang', picked ?? 'auto') }, undefined)
  view.lang = picked ?? languageOf((await $.settings.read()).language, heard, ...locale)
  view.verb = WORDS[view.lang].spinner[0] ?? view.verb
  await push($)
  return picked ? WORDS[view.lang].reply.lang : WORDS[view.lang].reply.auto
}

// /omen: one slip a day, as at a shrine: drawing again the same day shows the same slip. It shows in
// the band (or a toast when the band is off), never in the conversation.
async function drawOmen($: Engine): Promise<void> {
  const now = await $.clock.now()
  lastActivity = now
  const day = localDay(now, timeZone)
  const fortunes = fortunesFor(view.lang)
  const held = (await optional($, 'store.omen', () => $.store.get('omen'), undefined)) as Draw | undefined
  const again = held !== undefined && held.day === day && fortunes[held.rank]?.[held.index] !== undefined
  let draw: Draw
  if (again && held) {
    draw = held
  } else {
    const rank = rollRank(Math.random())
    draw = { day, rank, index: Math.floor(Math.random() * (fortunes[rank]?.length ?? 1)) }
    await optional($, 'store.set.omen', async () => { await $.store.set('omen', draw) }, undefined)
  }
  // Shown as written: each language's line carries its own culture's rank.
  const line = fortunes[draw.rank]?.[draw.index] ?? ''
  if (view.band === 'off') return $.ui.toast(line, { timeoutMs: 12000 })
  view.slip = { rank: draw.rank, label: slipLabel(line), text: again ? `${line}${gapBefore(WORDS[view.lang].again)}${WORDS[view.lang].again}` : line }
  view.said = null
  stop('say')
  stop('slip')
  timers.slip = after($, TIMING.slip, () => {
    view.slip = null
    background($, 'settle', settle($))
  })
  await setMood($, 'omen')
  if (draw.rank === 'kyo' || draw.rank === 'daikyo') await showFrame($, 'flustered')
}

// ---------------------------------------------------------------- hooks

export const register: Register = on => {
  // His book (pages.tsx) and his marks on the engine's rows (transcript.tsx). First, so the book's
  // /claudesama hook stands outside the one below and sees the command first.
  registerBook(on)
  registerTranscript(on)

  on('session.start', async ($, e, next) => {
    await checkDiagnostics($, true)
    diagnose($, 'session.start.begin')
    try {
      const started = await next(e)
      await optional($, 'command.register', () => $.command.register({
        name: 'claudesama',
        description: 'Claude-sama: his voice, warmth, the band, language, omen, about',
        argumentHint: '[voice|warmth|band|lang|omen|about] [value]',
      }), undefined)
      await optional($, 'command.register', () => $.command.register({ name: 'omen', description: 'Draw an omen from Claude-sama' }), undefined)
      try { await boot($, e.surface) }
      catch (error) { caught($, 'boot', error); await push($) }
      return started
    } finally { diagnose($, 'session.start.end') }
  })

  on('session.attach', async ($, e, next) => {
    const attached = await next(e)
    await optional($, 'arrive', () => arrive($), undefined)
    return attached
  })

  on('session.end', async ($, e, next) => {
    await sessionEnded($, e.reason)
    return next(e)
  })

  // A compaction of the main conversation empties the box at once (an estimate until the next
  // response); a precompute changes nothing, a subagent's compaction is its own.
  on('session.compact', async ($, e, next) => {
    const compacted = await next(e)
    if (e.agentId === undefined && e.trigger !== 'precompute' && compacted.skip === undefined) {
      await sweep($, compacted.tokensAfter)
      diagnose($, 'compaction', undefined, { trigger: e.trigger, tokensAfter: compacted.tokensAfter !== undefined, context: view.context, estimate: view.estimate })
    }
    return compacted
  })

  // The engine's own measurement after each turn, pushed: no read needed.
  on('session.measure', async ($, e, next) => {
    const measured = await next(e)
    if (e.changed.includes('context')) await gauge($, e.context)
    return measured
  })

  on('config.set', async ($, e, next) => {
    const set = await next(e)
    if (set.deny === undefined) await settingsMoved($)
    return set
  })

  // Built-in commands that change the box without a response: another model's window, a rewind.
  on('command.run', { command: 'model' }, async ($, e, next) => {
    const ran = await next(e)
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
    if (ran.deny === undefined) {
      working = false
      askedAt = 0
      stop('long')
      stop('ask')
              currentTask = null
      companionTask(null)
      companionActivity({ done: null, waitAt: null, reply: null, notice: null })
      await push($)
    }
    return ran
  })

  on('classic.Notification', async ($, e, next) => {
    const notified = await next(e)
    companionActivity({ notice: { kind: e.notification_type, text: [...e.message].slice(0, 140).join(''), at: await $.clock.now() } })
    await push($)
    return notified
  })

  on('prompt.submit', async ($, e, next) => {
    await prompted($, e.text, e.origin.kind)
    background($, 'gauge', gauge($))
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const response = yield* next(e)
    if (e.agentId === undefined && response.stopReason !== null) await gauge($, undefined, true, response.usage ?? undefined)
    return response
  })

  on('turn.start', async ($, e, next) => {
    const started = await next(e)
    if (e.agentId === undefined) await turnStarted($, e.turnId)
    return started
  })

  on('tool.call', async ($, e, next) => {
    const isMain = e.agentId === undefined
    const command = typeof e.command === 'string' ? e.command : undefined
    if (isMain) await toolStarted($, e, command)
    const ran = await next(e)
    if (isMain) await toolEnded($, e.tool, command, ran.isError === true, ran.deny !== undefined)
    return ran
  })

  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (verdict.decision === 'ask' && e.tool_use_id !== undefined && e.agentId === undefined) await asked($)
    return verdict
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await turnEnded($, e)
    return done
  })

  // The band. Another mod's band content is kept, drawn under his. Reading the state cell
  // subscribes this drawing to it; an absent or refused cell uses the ready module defaults.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const held = await optional($, 'state.get', () => $.state.get(VIEW), { value: undefined, version: 0 })
    if (!held.value) await hydrate($)
    else if (!preferences && !adoptedRestored) { adoptedRestored = true; publishedVersion = held.version; view = held.value; lastBand = held.value.bandBeforeOff ?? (held.value.band === 'compact' ? 'compact' : 'on') }
    const fallback = statePublishFailed || publishPending > 0 || held.value === undefined
    let drawn = fallback ? view : held.value!
    if (!fallback && held.version === publishedVersion && drawn.mood === view.mood) drawn = { ...drawn, frame: view.frame }
    // A cold module can attach to a running turn without having heard its start. The engine's
    // render prop decides that first frame directly; rendering never schedules a state write.
    if (!turnId) {
      working = e.props.isWorking
      if (working && ['idle', 'sleep'].includes(drawn.mood)) {
        drawn = { ...drawn, mood: 'think', frame: view.mood === 'think' ? view.frame : 'think-a' }; view = drawn
      } else if (!working && ['think', 'work'].includes(view.mood) && ['idle', 'sleep'].includes(drawn.mood)) {
        view = drawn; stop('loop')
      }
    }
    const record = (kind: string, height = 0) => {
      const detail = { surface: e.surface, isWorking: e.props.isWorking,
        bodyColumns: e.props.bodyColumns, maxRows: e.props.maxRows,
        style: (drawn.band === 'off' ? drawn.bandBeforeOff ?? lastBand : drawn.band) === 'compact' ? 'pixel' : 'painted',
        height, fallback, version: held.version }
      const animation = animationRedraws.delete(e.requestId)
      if (!diagnosticEnabled) return
      const signature = JSON.stringify({ ...detail, kind, viewport: e.viewport, scroll: e.props.scroll })
      if (animation && diagnosticBands.get(e.requestId) === signature) return
      diagnosticBands.set(e.requestId, signature)
      diagnose($, 'band', undefined, detail)
      if (firstBand) { firstBand = false; diagnose($, `first-band:${kind}`) }
    }
    if (e.props.hasSurvey) { bands.set(e.requestId, null); record('survey'); return next(e) }
    if (drawn.band === 'off') {
      bands.set(e.requestId, null); stop('loop'); stop('blink'); record('off', e.surface === 'desktop' ? 32 : 1)
      const wake = () => choose($, { band: lastBand })
      if (e.surface === 'desktop') return desktopDoor($.ui.resolve(e), drawn, wake, (drawn.bandBeforeOff ?? lastBand) === 'compact')
      if (e.surface === 'terminal') return terminalDoor($.ui.resolve(e), drawn, wake)
      return next(e)
    }
    // Good manners: other mods' rows under ours come off the room we take, so the band does not
    // start scrolling; at worst he keeps one line.
    const theirs = await optional($, 'band.next', () => next(e), undefined)
    const size = {
      columns: e.props.bodyColumns,
      maxRows: e.props.maxRows - rowsOf(theirs),
      screenRows: e.viewport?.rows ?? 40,
      isWorking: e.props.isWorking,
    }
    if (e.surface === 'terminal') {
      const ui = $.ui.resolve(e)
      const { Box } = ui
      const sprite = terminalHasSprite(drawn, size)
      const png = sprite && drawn.pictures === 'kitty' ? bundledPng(drawn.frame) : undefined
      bands.set(e.requestId, sprite ? (png ? 'image' : 'cells') : null)
      animate($)
      record(png ? 'image' : sprite ? 'cells' : 'text')
      return (
        <Box flexDirection="column">
          {terminalBand(ui, drawn, size, png)}
          {theirs}
        </Box>
      )
    }
    if (e.surface === 'desktop') {
      const ui = $.ui.resolve(e)
      const { Box } = ui
      if (poked?.frame) drawn = { ...drawn, frame: poked.frame }
      const plan = planDesktop(drawn, size, poked?.line)
      bands.set(e.requestId, plan.height ? 'svg' : null)
      animate($)
      const sprite = plan.height ? bundledSvg(drawn.frame, plan.height, drawn.band === 'compact') : ''
      record(plan.height ? 'svg-bundled' : 'text', plan.height)
      return (
        <Box flexDirection="column">
          {desktopBand(ui, drawn, size, sprite, plan, poked?.line)}
          {theirs}
        </Box>
      )
    }
    record('other-surface')
    return theirs
  })

  // Terminal spinner: his verb for this turn; the engine keeps its glyph, time and tokens.
  // Responses update the box through turn.step, independently of whether this row draws.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.message !== null) return next(e)
    await $.state.get(VIEW)
    return next({ ...e, props: { ...e.props, word: view.verb } })
  })

  // Presses in his book that change what lives here: the settings and today's slip. The book
  // (pages.tsx) draws those buttons; any other press passes on.
  on('ui.press', async ($, e, next) => {
    if (e.plugin !== 'claudesama') return next(e)
    const [, scope, what, value] = e.element.split(':')
    if (scope === 'band' && what === 'poke' && e.surface === 'desktop' && e.link?.href === 'file:///claudesama-poke') {
      await poke($)
      return { element: e.element }
    }
    else if (scope === 'set' && what === 'workSize' && (value === 'same' || value === 'smaller')) await choose($, { workSize: value })
    else if (scope === 'band' && what === 'wake') await choose($, { band: lastBand })
    else if (scope === 'set' && what === 'voice' && (value === 'off' || value === 'light' || value === 'full')) await choose($, { voice: value })
    else if (scope === 'set' && what === 'affection' && (value === 'warm' || value === 'clingy')) await choose($, { affection: value })
    else if (scope === 'set' && what === 'band' && (value === 'on' || value === 'compact' || value === 'off')) await choose($, { band: value })
    else if (scope === 'set' && what === 'lang' && value) await chooseLang($, value)
    else if (scope === 'omen' && what === 'draw') await drawOmen($)
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
    const composed = await next(e)
    if (view.voice === 'off' || e.surfaces.length === 0 || e.traits.includes('bare')) return composed
    return { sections: [...composed.sections, VOICE_SECTION[view.voice]] }
  })

  on('command.run', { command: 'omen' }, async $ => {
    await drawOmen($)
    return {}
  })

  // Replies go to a toast: nothing reaches the transcript or the model.
  on('command.run', { command: 'claudesama' }, async ($, e) => {
    const words = WORDS[view.lang]
    const [verb = '', value = ''] = e.args.trim().toLowerCase().split(/\s+/)
    const tell = (text: string) => $.ui.toast(text, { timeoutMs: 8000 })
    if (verb === 'voice' && (value === 'off' || value === 'light' || value === 'full')) {
      await choose($, { voice: value })
      tell(words.reply.voice.replace('{value}', value))
    } else if (verb === 'affection' && (value === 'warm' || value === 'clingy')) {
      await choose($, { affection: value })
      tell(words.reply.affection.replace('{value}', value))
    } else if (verb === 'band' && (value === 'on' || value === 'compact' || value === 'off')) {
      await choose($, { band: value })
      tell(words.reply.band.replace('{value}', value))
    } else if (verb === 'lang') {
      tell(await chooseLang($, value))
    } else if (verb === 'omen') {
      await drawOmen($)
    } else {
      tell(words.reply.usage)
    }
    return {}
  })
}
