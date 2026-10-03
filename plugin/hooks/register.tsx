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
// Cost: no timer runs while he is hidden or asleep; while idle and visible, one blink every
// 4 to 6 s; two-frame loops (at most 2.5 frames a second) only while a turn runs and a sprite
// is on screen. Terminal frames swap by $.ui.blit, desktop frames by a redraw of a cached SVG.
// The offering box reads the engine's figure (a free in-process call) at the moments it can
// move and every 0.75 s while a turn runs, never while idle, and redraws only when it changes.
//
// The state machine lives here because every function handed `$` must sit in this file.
// mood.ts holds its pure parts; band.tsx draws; pictures.ts builds the images once.

import type { EngineInterface, Register, SessionContextUsage, ToolCallInput, TurnCompleteInput } from 'claude-code'
import type { FrameName } from './art'
import { desktopBand, planDesktop, rowsOf, terminalBand, terminalHasSprite } from './band'
import {
  ABSOLUTELY_RIGHT, FORCE_PUSH, LOOPS, PERSON, PRAISE, PYTHON, STILL, TEST_RUN, TIMING, colorsOf, cueFor, fill, fortunesFor, greetingFor,
  HEARING, detectLanguage, initialView, langOf, languageOf, linesFor, localDay, localHour, pick, rollRank, slipLabel,
} from './mood'
import { COMPANION_DIR, COMPANION_FEED, companionActivity, companionEnded, companionKey, companionSeen, companionSession, companionTask, companionText } from './companion'
import { CompanionChannel } from './channel'
import { replyExcerpt, taskForTool } from './tasks'
import type { TaskDescription } from './tasks'
import { registerBook } from './pages'
import { DESKTOP_REST, pngPath, spriteCells, spriteSvg } from './pictures'
import { registerTranscript } from './transcript'
import { gapBefore } from './typeset'
import { VOICE } from './voice'
import { LANGS, WORDS } from './words'
import type { Lang, Mood } from './words'
import type { ClaudesamaView as View } from '../types'

type Engine = EngineInterface
type Timer = { cancel: () => void }
type TimerName =
  | 'loop' | 'revert' | 'blink' | 'say' | 'slip' | 'long' | 'sleep' | 'clingy' | 'gauge' | 'ask' | 'reconcile' | 'sync'
  | 'sample'
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
let lastTokens: number | undefined // the engine's last reading, in tokens
let staleTokens: number | undefined // a reading that still counts the conversation before a compaction
let askedAt = 0
// The companion app (plugin/companion, macOS) reads a feed of what he is doing. The mod writes it
// only while the companion's folder exists, and only when the record changed. A push checks
// installation too, so it can start or stop the request child even when the picture is unchanged.
let companionSent = ''
let companionWrite: Promise<void> = Promise.resolve()
let companionHome: string | undefined
let companionThere = false
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
const pngs = new Map<string, string>() // painted and pixel frame paths read so far, base64

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

async function push($: Engine): Promise<void> {
  taskNow()
  await $.state.set(VIEW, { ...view })
  if (!companionLive) return
  if (!(await companionHere($))) {
    companionChannel?.stop()
    companionSent = ''
    return
  }
  await companionChannel?.start()
  const key = companionKey(view)
  if (key === companionSent) return
  companionSent = key
  const previous = companionWrite
  let finish!: () => void
  companionWrite = new Promise(resolve => { finish = resolve })
  await previous
  try {
    const desktop = (await $.session.surfaces()).includes('desktop')
    if (!(await feedCompanion($, companionText(key, companionId, desktop, await $.clock.now()))) && companionSent === key) companionSent = ''
  } finally { finish() }
}

async function companionHere($: Engine): Promise<boolean> {
  companionHome ??= await $.env.get('HOME')
  companionThere = companionHome !== undefined && (await $.fs.exists(`${companionHome}/${COMPANION_DIR}`))
  return companionThere
}

async function feedCompanion($: Engine, text: string): Promise<boolean> {
  if (companionHome === undefined) return false
  // $.fs.write creates missing folders, so look again right before every write: a companion
  // uninstalled a moment ago must stay uninstalled.
  if (!(await $.fs.exists(`${companionHome}/${COMPANION_DIR}`))) {
    companionThere = false
    companionChannel?.stop()
    companionSent = ''
    return false
  }
  try {
    await $.fs.write(`${companionHome}/${COMPANION_FEED}`, text)
    return true
  } catch { return false }
}

function taskNow(): void {
  companionTask(!working ? null : view.mood === 'waiting' ? { key: 'waitingOK' }
    : view.mood === 'question' ? { key: 'waitingAnswer' } : currentTask ?? { key: 'thinking' })
}

async function pngOf($: Engine, frame: FrameName, height = DESKTOP_REST): Promise<string> {
  const path = pngPath(frame, height)
  let png = pngs.get(path)
  if (png === undefined) {
    png = (await $.fs.read(`${$.plugin.root}/${path}`, { as: 'bytes' })).base64
    pngs.set(path, png)
  }
  return png
}

// A new frame of the same mood: blitted where the terminal draws cells or a picture, redrawn
// where the desktop draws (its SVG strings are cached). Nothing on screen: the loop stops.
async function showFrame($: Engine, frame: FrameName): Promise<void> {
  view.frame = frame
  if (!spriteOnScreen()) {
    stop('loop')
    return
  }
  let redraw = false
  for (const [requestId, shown] of bands) {
    if (shown === 'svg') redraw = true
    if (shown === 'cells' || shown === 'image') {
      const blit =
        shown === 'cells'
          ? await $.ui.blit({ requestId, key: 'sprite', cells: spriteCells(frame, view.colors) })
          : await $.ui.blit({ requestId, key: 'sprite', source: { png: await pngOf($, frame) } })
      if (blit.deny) bands.set(requestId, null)
    }
  }
  if (redraw) await push($)
}

async function setMood($: Engine, mood: Mood, holdMs?: number): Promise<void> {
  stop('loop')
  stop('revert')
  stop('blink')
  view.mood = mood
  view.frame = STILL[mood]
  if (holdMs !== undefined) timers.revert = $.clock.after(holdMs, () => void settle($))
  animate($)
  await push($)
}

// Starts the mood's motion if a sprite is on screen and nothing runs yet: the two-frame loop
// of a running turn, or the idle blink. Also called when a band first shows his picture.
function animate($: Engine): void {
  if (reducedMotion || !spriteOnScreen()) return
  const loop = LOOPS[view.mood]
  if (loop && !timers.loop) {
    let tick = 0
    timers.loop = $.clock.every(loop.every, () => {
      tick = 1 - tick
      void showFrame($, loop.frames[tick] ?? loop.frames[0])
    })
  }
  if (view.mood === 'idle' && !timers.blink) blinkLater($)
}

// The face he rests on: reading when idle, thinking or writing while a turn runs.
async function settle($: Engine): Promise<void> {
  delete timers.revert
  if (view.slip) return push($)
  return setMood($, working ? (toolsThisTurn > 0 ? 'work' : 'think') : 'idle')
}

function blinkLater($: Engine): void {
  stop('blink')
  if (reducedMotion || !spriteOnScreen()) return
  const wait = TIMING.blinkMin + Math.random() * (TIMING.blinkMax - TIMING.blinkMin)
  timers.blink = $.clock.after(wait, async () => {
    if (view.mood !== 'idle') return
    void gauge($) // rides the blink: catches a model picked outside /model while idle
    await showFrame($, 'idle-blink')
    timers.blink = $.clock.after(TIMING.blinkShut, async () => {
      if (view.mood !== 'idle') return
      await showFrame($, 'idle-reading')
      blinkLater($)
    })
  })
}

async function sayText($: Engine, text: string | undefined): Promise<void> {
  if (!text) return push($)
  stop('say')
  view.said = text
  timers.say = $.clock.after(TIMING.say, () => {
    view.said = null
    void push($)
  })
  await push($)
}

function say($: Engine, key: string, vars: Record<string, string | number> = {}): Promise<void> {
  return sayText($, fill(pick(`${view.lang}:${view.affection}:${key}`, linesFor(view, key)), vars))
}

// One-shot timers armed by activity, never a polling loop: asleep after ten quiet minutes, and
// in the clingy voice one line after six.
function armQuiet($: Engine): void {
  stop('sleep')
  stop('clingy')
  if (working) return
  timers.sleep = $.clock.after(TIMING.sleepAfter, async () => {
    delete timers.sleep
    if (working || view.mood !== 'idle') return
    await setMood($, 'sleep')
    await say($, 'sleep')
  })
  if (view.affection === 'clingy') {
    timers.clingy = $.clock.after(TIMING.clingyAfter, () => {
      delete timers.clingy
      if (!working && view.mood === 'idle') void say($, 'idle')
    })
  }
}

// ---------------------------------------------------------------- the offering box
//
// The box shows the engine's own figure: the last response's input side against the window.
// That figure moves only when a response starts or lands, so the box reads it at those moments:
// every 0.75 s while a turn runs, each change of the spinner's stage where the surface raises it
// (and once more 250 ms later), each tool call's start and end, the end of a turn, the engine's
// own measurement after it, /model, a setting changed in /config, a prompt sent. Every read is a
// free in-process call; the band redraws only when the number moves.

async function gauge($: Engine, given?: SessionContextUsage): Promise<void> {
  let context = given
  if (context === undefined) {
    try {
      context = (await $.session.usage()).context
    } catch {
      return
    }
  }
  if (!context?.window || (context.tokens === undefined && context.percent === undefined)) return
  // After a compaction the engine may still hold the response that counted the old conversation.
  if (staleTokens !== undefined && context.tokens === staleTokens) return
  staleTokens = undefined
  lastTokens = context.tokens
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
  staleTokens = lastTokens
  try {
    const { context } = await $.session.usage({ breakdown: 'summary' })
    const total = context.breakdown?.totalTokens ?? tokensAfter
    if (context.window && total !== undefined) return showContext($, Math.round((total / context.window) * 100), true)
  } catch {
    // no estimate this time
  }
  view.context = null
  view.estimate = false
  await push($)
}

// While a turn runs the figure moves with every response, and the desktop raises no spinner
// stages, so the box also reads it every 0.75 s until the turn ends: one free in-process call,
// a redraw only when the number moves. No read at all while idle.
function sample($: Engine): void {
  stop('sample')
  timers.sample = $.clock.every(TIMING.sample, () => void gauge($))
}

// A stage change of the spinner is the engine starting or landing a response, or a tool
// starting after a permission was settled. Called from the spinner's drawing, which may not
// write state, so the reads run just after it: at once, and once more a beat later.
function stageMoved($: Engine, stage: string): void {
  if (stage === spinnerStage) return
  spinnerStage = stage
  stop('gauge')
  timers.gauge = $.clock.after(0, async () => {
    timers.gauge = $.clock.after(TIMING.gaugeAgain, () => {
      delete timers.gauge
      void gauge($)
    })
    if (view.mood === 'waiting' && askedAt !== 0 && (await $.clock.now()) - askedAt >= TIMING.askSettled) await settled($)
    await gauge($)
  })
}

// ---------------------------------------------------------------- session

async function boot($: Engine, surface: string | null): Promise<void> {
  stopAll()
  companionChannel?.stop()
  companionChannel = undefined
  companionSent = ''
  companionLive = true
  companionHome = await $.env.get('HOME')
  companionId = await $.session.id().catch(() => '')
  companionSession(await $.session.root().catch(() => ''))
  currentTask = null
  if (companionHome !== undefined) {
    const channel = new CompanionChannel({
      exists: path => $.fs.exists(path),
      write: (path, text) => $.fs.write(path, text),
      spawn: argv => $.process.spawn({ argv }),
      now: () => $.clock.now(),
      submit: text => $.prompt.submit({ text, asUser: true }),
      clear: () => $.command.run({ command: 'clear', args: '' }),
    }, companionId, `${companionHome}/${COMPANION_DIR}`, {
      running: running => { if (companionChannel === channel) companionActivity({ channel: running }) },
      seen: upto => { if (companionChannel === channel) companionSeen(upto) },
      ack: async id => {
        if (companionChannel !== channel) return
        companionActivity({ ack: id })
        companionSent = '' // An idempotent retry must republish even an unchanged acknowledgement.
        await push($)
      },
      changed: async () => { if (companionChannel === channel) await push($) },
    })
    companionChannel = channel
  }
  const settings = await $.settings.read()
  reducedMotion = settings.prefersReducedMotion === true
  timeZone = typeof settings.timeZone === 'string' ? settings.timeZone : undefined
  locale = [await $.env.get('LC_ALL'), await $.env.get('LC_MESSAGES'), await $.env.get('LANG')]
  langChosen = langOf(await $.store.get('lang'))
  heard = langOf(await $.store.get('heard'))
  hearing = undefined
  const lang = languageOf(langChosen, settings.language, heard, ...locale)
  const term = (await $.env.get('TERM')) ?? ''
  const program = (await $.env.get('TERM_PROGRAM')) ?? ''
  const inTmux = (await $.env.get('TMUX')) !== undefined
  const kittyWindow = (await $.env.get('KITTY_WINDOW_ID')) !== undefined
  const colorterm = (await $.env.get('COLORTERM')) ?? ''
  const windowsTerminal = (await $.env.get('WT_SESSION')) !== undefined
  const band = await $.store.get('band')
  const voice = await $.store.get('voice')
  const affection = await $.store.get('affection')
  view = {
    ...initialView(),
    lang,
    pictures: !inTmux && (kittyWindow || /kitty|ghostty/i.test(term) || /ghostty/i.test(program)) ? 'kitty' : 'cells',
    band: band === 'compact' || band === 'off' ? band : 'on',
    voice: voice === 'off' || voice === 'full' ? voice : 'light',
    affection: affection === 'clingy' ? 'clingy' : 'warm',
    verb: WORDS[lang].spinner[0] ?? 'reading',
    colors: colorsOf({ colorterm, term, program, tmux: inTmux, windowsTerminal }),
    cue: cueFor(settings.theme),
  }
  working = false
  turnId = ''
  toolsThisTurn = 0
  failures = 0
  wildPending = false
  arrived = false
  startSaid = false
  offeringWarned = false
  spinnerStage = ''
  lastTokens = undefined
  staleTokens = undefined
  askedAt = 0
  lastSeen = Number((await $.store.get('lastActive')) ?? 0)
  lastActivity = await $.clock.now()
  await gauge($)
  if (view.context === null) await sweep($)
  await setMood($, 'idle')
  armQuiet($)
  if (surface === 'terminal') await arrive($)
}

// A /config change applies at once: reduced motion, theme, language, time zone.
async function settingsMoved($: Engine): Promise<void> {
  const settings = await $.settings.read()
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
  await $.store.set('lastActive', await $.clock.now())
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
  await $.store.set('heard', heard)
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
  reducedMotion = (await $.settings.read()).prefersReducedMotion === true
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
  stop('reconcile')
  sample($)
  view.verb = pick(`${view.lang}:verb`, WORDS[view.lang].spinner) ?? view.verb
  stop('long')
  timers.long = $.clock.after(TIMING.thinkingLong, () => {
    if (working && turnId === id) void say($, 'thinking_long')
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
  currentTask = taskForTool(input)
  companionTask(currentTask)
  await gauge($) // the response that asked for this call has landed
  if (view.mood === 'waiting') await settled($)
  companionActivity({ waitAt: tool === 'AskUserQuestion' ? lastActivity : null })
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

// An ask goes to the mode's decider: the dialog, or in auto mode a classifier that settles it
// without you. He waits at once, but says it is your page only once the wait has lasted long
// enough to be yours; the next spinner stage or the call itself ends the wait.
async function asked($: Engine): Promise<void> {
  if (!working) return
  askedAt = await $.clock.now()
  companionActivity({ waitAt: askedAt })
  companionTask({ key: 'waitingOK' })
  await setMood($, 'waiting')
  stop('ask')
  timers.ask = $.clock.after(TIMING.askLine, () => {
    delete timers.ask
    if (view.mood === 'waiting') void say($, 'waiting')
  })
}

async function settled($: Engine): Promise<void> {
  askedAt = 0
  companionActivity({ waitAt: null })
  companionTask(currentTask ?? { key: 'thinking' })
  stop('ask')
  if (view.mood === 'waiting') await setMood($, 'work')
}

// The engine's own word on whether a turn runs wins over ours: after a reload in the middle of
// a turn, or a turn whose end we did not hear, the band catches up on its next draw.
async function reconcile($: Engine, isWorking: boolean): Promise<void> {
  if (isWorking && !working) {
    working = true
    currentTask = null
    companionTask({ key: 'thinking' })
    toolsThisTurn = 0
    stop('sleep')
    stop('clingy')
    sample($)
    return setMood($, 'think')
  }
  if (!isWorking && working && !timers.reconcile) {
    timers.reconcile = $.clock.after(TIMING.reconcile, () => {
      delete timers.reconcile
      if (!working) return
      working = false
      currentTask = null
      companionTask(null)
      companionActivity({ waitAt: null })
      askedAt = 0
      stop('long')
      stop('ask')
      stop('sample')
      armQuiet($)
      void gauge($)
      void settle($)
    })
  }
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
  stop('reconcile')
  stop('sample')
  const now = await $.clock.now()
  companionActivity({ done: now, waitAt: null, reply: { text: replyExcerpt(e.answer), at: now } })
  lastActivity = now
  const turns = Number((await $.store.get('turns')) ?? 0) + 1
  await $.store.set('turns', turns)
  await $.store.set('lastActive', now)
  armQuiet($)
  await gauge($)
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

// ---------------------------------------------------------------- commands

async function choose($: Engine, picked: Partial<Pick<View, 'band' | 'voice' | 'affection'>>): Promise<void> {
  Object.assign(view, picked)
  if (picked.band) await $.store.set('band', picked.band)
  if (picked.voice) await $.store.set('voice', picked.voice)
  if (picked.affection) await $.store.set('affection', picked.affection)
  if (picked.affection) armQuiet($)
  await push($)
}

// /claudesama lang <code>|auto: a language picked by hand wins over the settings and the locale
// until `auto`. Returns the reply, in the language he reads from now on.
async function chooseLang($: Engine, value: string): Promise<string> {
  const codes = LANGS.map(l => l.code).join(' ')
  if (value === '') return `lang: ${view.lang} (${codes} auto)`
  const picked = value === 'auto' ? undefined : langOf(value)
  if (value !== 'auto' && picked === undefined) return fill(WORDS[view.lang].reply.unknown, { value, codes }) ?? ''
  langChosen = picked
  await $.store.set('lang', picked ?? 'auto')
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
  const held = (await $.store.get('omen')) as Draw | undefined
  const again = held !== undefined && held.day === day && fortunes[held.rank]?.[held.index] !== undefined
  let draw: Draw
  if (again && held) {
    draw = held
  } else {
    const rank = rollRank(Math.random())
    draw = { day, rank, index: Math.floor(Math.random() * (fortunes[rank]?.length ?? 1)) }
    await $.store.set('omen', draw)
  }
  // Shown as written: each language's line carries its own culture's rank.
  const line = fortunes[draw.rank]?.[draw.index] ?? ''
  if (view.band === 'off') return $.ui.toast(line, { timeoutMs: 12000 })
  view.slip = { rank: draw.rank, label: slipLabel(line), text: again ? `${line}${gapBefore(WORDS[view.lang].again)}${WORDS[view.lang].again}` : line }
  view.said = null
  stop('say')
  stop('slip')
  timers.slip = $.clock.after(TIMING.slip, () => {
    view.slip = null
    void settle($)
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
    const started = await next(e)
    await $.command.register({
      name: 'claudesama',
      description: 'Claude-sama: his voice, warmth, the band, language, omen, about',
      argumentHint: '[voice|warmth|band|lang|omen|about] [value]',
    })
    await $.command.register({ name: 'omen', description: 'Draw an omen from Claude-sama' })
    await boot($, e.surface)
    return started
  })

  on('session.attach', async ($, e, next) => {
    const attached = await next(e)
    await arrive($)
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
      stop('reconcile')
      stop('sample')
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
    void gauge($)
    return next(e)
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
  // subscribes this drawing to it; the drawing itself uses the module's `view`, which is newer.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    await $.state.get(VIEW)
    if (e.props.isWorking !== working) {
      const isWorking = e.props.isWorking
      stop('sync')
      timers.sync = $.clock.after(0, () => {
        delete timers.sync
        void reconcile($, isWorking)
      })
    }
    if (e.props.hasSurvey || view.band === 'off') {
      bands.set(e.requestId, null)
      return next(e)
    }
    // Good manners: other mods' rows under ours come off the room we take, so the band does not
    // start scrolling; at worst he keeps one line.
    const theirs = await next(e)
    const size = {
      columns: e.props.bodyColumns,
      maxRows: e.props.maxRows - rowsOf(theirs),
      screenRows: e.viewport?.rows ?? 40,
      isWorking: e.props.isWorking,
    }
    if (e.surface === 'terminal') {
      const ui = $.ui.resolve(e)
      const { Box } = ui
      const sprite = terminalHasSprite(view, size)
      const png = sprite && view.pictures === 'kitty' ? await pngOf($, view.frame) : undefined
      bands.set(e.requestId, sprite ? (png ? 'image' : 'cells') : null)
      animate($)
      return (
        <Box flexDirection="column">
          {terminalBand(ui, view, size, png)}
          {theirs}
        </Box>
      )
    }
    if (e.surface === 'desktop') {
      const ui = $.ui.resolve(e)
      const { Box } = ui
      const plan = planDesktop(view, size)
      bands.set(e.requestId, plan.height ? 'svg' : null)
      animate($)
      const sprite = plan.height ? spriteSvg(view.frame, plan.height, await pngOf($, view.frame, plan.height)) : ''
      return (
        <Box flexDirection="column">
          {desktopBand(ui, view, size, sprite, plan)}
          {theirs}
        </Box>
      )
    }
    return theirs
  })

  // Terminal spinner: his verb for this turn; the engine keeps its glyph, time and tokens.
  // The desktop's spinner row already says what the step is doing, so it is left alone. On
  // both, a new stage is where the offering box reads the engine's figure.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    stageMoved($, e.props.mode)
    if (e.surface !== 'terminal' || e.props.message !== null) return next(e)
    await $.state.get(VIEW)
    return next({ ...e, props: { ...e.props, word: view.verb } })
  })

  // Presses in his book that change what lives here: the settings and today's slip. The book
  // (pages.tsx) draws those buttons; any other press passes on.
  on('ui.press', async ($, e, next) => {
    if (e.plugin !== 'claudesama') return next(e)
    const [, scope, what, value] = e.element.split(':')
    if (scope === 'set' && what === 'voice' && (value === 'off' || value === 'light' || value === 'full')) await choose($, { voice: value })
    else if (scope === 'set' && what === 'affection' && (value === 'warm' || value === 'clingy')) await choose($, { affection: value })
    else if (scope === 'set' && what === 'band' && (value === 'on' || value === 'compact' || value === 'off')) await choose($, { band: value })
    else if (scope === 'set' && what === 'lang' && value) await chooseLang($, value)
    else if (scope === 'omen' && what === 'draw') await drawOmen($)
    else return next(e)
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
