// His book: the pane /claudesama (or the band's "His book" button) opens. Six pages built from
// what the plugin and Claude Code already hold: no tokens, no network, no timer of its own. It
// draws only while open. Its words (plugin/book/<lang>.json, English and his language), its
// portraits and its drawings are read or built while it is open and let go when it closes, so
// the closed book holds nothing but which page it was on. What keeps the open book current are
// observers on writes that happen anyway (the band's view, the engine's usage figures, the
// plugin's own store): each is a comparison and, when the open page shows what moved, one
// redraw of the pane on the next tick. Other plugins' writes and closes are theirs: the hooks
// below act only on this plugin's own. It registers no hook on an event the rest of the plugin
// hooks without a matcher (one such hook per event per plugin).

import type { EngineInterface, On, SessionUsage } from 'claude-code'
import type { FrameName } from './art'
import { PORTRAIT, desktopBook, terminalBook } from './book'
import type { BookData, Press } from './book'
import { forgetBookArt } from './book-art'
import { IconBook, iconReport } from './icon-book'
import type { IconAction } from './icon-book'
import { CompanionBook, companionState, companionCommand, COMPANION_APP, COMPANION_PLIST, COMPANION_OPEN } from './companion-book'
import type { CompanionSnapshot, CompanionBookData, CompanionAction, CompanionRun, CompanionInfo } from './companion-book'
import { COMPANION_SIZES, STAGE_PNG, companionStageSvg, companionSizeSvg } from './companion-art'
import type { CompanionStage, CompanionSize } from './companion-art'
import { COMPANION_DIR, COMPANION_FEED, companionRequestText } from './companion'
import type { CompanionRequest } from './companion'
import { fill, overEnglish } from './book-words'
import type { BookWords, Page } from './book-words'
import { MARKS_DEFAULT, latest, marksFrom } from './latest'
import type { Marks } from './latest'
import { fortunesFor, localDay } from './mood'
import { pngPath, spriteSource } from './pictures'
import { homePath, isWindows, joinPath } from './paths'
import { VOICE } from './voice'
import { WORDS } from './words'
import type { Lang } from './words'
import type { ClaudesamaBook, ClaudesamaView } from '../types'

type Engine = EngineInterface
type Timer = { cancel: () => void }
type Draw = { day: string; rank: string; index: number }

async function windows($: Engine): Promise<boolean> {
  const [os, home, profile] = await Promise.all([$.env.get('OS'), $.env.get('HOME'), $.env.get('USERPROFILE')])
  return isWindows(os, home, profile)
}

async function homeOf($: Engine): Promise<string | undefined> {
  const home = await $.env.get('HOME')
  return homePath(home, home ? undefined : await $.env.get('USERPROFILE'))
}

export const BOOK_PANE = 'claudesama-book'
const BOOK = { plugin: 'claudesama', key: 'book' } as const
const VIEW = { plugin: 'claudesama', key: 'view' } as const

// The store values each page shows: a write to one of these redraws the open book on that page.
const WATCH: Record<Page, readonly string[]> = {
  him: [],
  omen: ['omen'],
  offerings: [],
  log: ['turns', 'firstMet', 'latestNight', 'wilds', 'omens'],
  library: [],
  settings: ['voice', 'affection', 'band', 'marks', 'lang'],
}

// `/claudesama <word>` opens the book at a page; anything else goes on to the other commands.
const ALIASES: Record<string, Page> = {
  about: 'him',
  him: 'him',
  offerings: 'offerings',
  usage: 'offerings',
  log: 'log',
  library: 'library',
  settings: 'settings',
}

let book: ClaudesamaBook = { page: 'him', reading: 0, rev: 0 }
let open = false
let usage: SessionUsage | undefined
let timeZone: string | undefined
let reducedMotion = false
let redraw: Timer | undefined
const companionBook = new CompanionBook()
const iconBook = new IconBook()
// Held only while the book is open (forget() empties them when it closes): the frames' PNGs, the
// portraits built from them, and the words, English and the one other language he reads in.
const pngs = new Map<FrameName, string>()
const portraits = new Map<string, string>()
const words = new Map<string, BookWords>()

function forget(): void {
  pngs.clear()
  portraits.clear()
  words.clear()
  forgetBookArt()
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
  const held = words.get(lang)
  if (held) return held
  const read = async (code: string): Promise<unknown> => {
    try {
      return JSON.parse(await $.fs.read(joinPath($.plugin.root, 'book', `${code}.json`)))
    } catch {
      return undefined
    }
  }
  let en = words.get('en')
  if (!en) {
    en = (await read('en')) as BookWords // shipped with the plugin; the tests read every file
    words.set('en', en)
  }
  if (lang === 'en') return en
  const own = overEnglish(en, await read(lang))
  for (const key of words.keys()) if (key !== 'en') words.delete(key)
  words.set(lang, own)
  return own
}

async function portraitOf($: Engine, frame: FrameName, height: number): Promise<string> {
  const key = `${frame}:${height}`
  let source = portraits.get(key)
  if (source === undefined) {
    let png = pngs.get(frame)
    if (png === undefined) {
      png = (await $.fs.read(joinPath($.plugin.root, pngPath(frame)), { as: 'bytes' })).base64
      pngs.set(frame, png)
    }
    source = spriteSource(height, png)
    portraits.set(key, source)
  }
  return source
}

async function show($: Engine, page: Page, reading = book.reading): Promise<void> {
  if (page !== 'settings') { companionBook.forget(); iconBook.forget() }
  book = { page, reading, rev: book.rev + 1 }
  await $.state.set(BOOK, book)
}

// One redraw of the open book just after whatever moved: never from inside a drawing (which may
// not write state), and any number of moves in one beat fold into one.
function redrawSoon($: Engine): void {
  if (!open || redraw) return
  redraw = $.clock.after(0, () => {
    redraw = undefined
    void show($, book.page)
  })
}

// Always at the person's asking (a command or a press), so it asks for the keyboard: the tabs'
// keys 1 to 6 work at once. The engine refuses the focus over text in the composer, rightly.
async function openBook($: Engine, page: Page): Promise<void> {
  try {
    usage = await $.session.usage()
  } catch {
    // the page says there is no reading yet
  }
  if (page === 'settings') await runIcon($, iconBook, 'status', () => redrawSoon($))
  await show($, page)
  const opened = await $.ui.open({ id: BOOK_PANE, title: 'Claude-sama', closeOnEscape: true, focus: true })
  open = opened.isPlaced
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
  await $.store.set('marks', marks)
  $.ui.invalidate('ui.render') // the transcript's rows draw again, once
}

async function dataFor($: Engine, held: ClaudesamaBook, view: ClaudesamaView | undefined): Promise<BookData> {
  const lang = view?.lang ?? 'en'
  const now = await $.clock.now()
  const store: Record<string, unknown> = {}
  for (const key of WATCH[held.page]) store[key] = await $.store.get(key)
  let fortune: BookData['fortune']
  const draw = store.omen as Draw | undefined
  if (draw && draw.day === localDay(now, timeZone)) {
    const line = fortunesFor(lang as never)[draw.rank]?.[draw.index]
    if (line) fortune = { line, rank: draw.rank, day: draw.day }
  }
  return {
    view,
    usage,
    store,
    now,
    timeZone,
    reducedMotion,
    marks: latest.marks ?? MARKS_DEFAULT,
    voiceSizes: { light: VOICE.light.length, full: VOICE.full.length },
    fortune,
    reading: held.reading,
    own: ownWords(lang),
  }
}

async function iconPlatform($: Engine, c: IconBook): Promise<'macos' | 'linux' | undefined> {
  return c.platform ??= (async () => {
    if (await windows($)) return undefined
    if (await $.fs.exists('/System/Library/CoreServices/SystemVersion.plist').catch(() => false)) return 'macos'
    if (await $.fs.exists('/proc/sys/kernel/ostype').catch(() => false)) return 'linux'
    return undefined
  })()
}

/** Called only by a command opening Settings, its tab press, or an icon button press. */
export async function runIcon($: Engine, c: IconBook, action: 'status' | IconAction, redraw: () => void): Promise<void> {
  if (c.busy) { if (action === 'status') c.pendingStatus = redraw; return }
  const generation = c.generation
  c.busy = action; c.failed = false; c.changed = false; redraw()
  try {
    const os = await iconPlatform($, c)
    if (generation !== c.generation) return
    if (!os) { c.unavailable = true; c.state = 'unknown'; return }
    const argv = ['sh', joinPath($.plugin.root, 'bin', `icon-${os}.sh`), action, '--report']
    if (os === 'linux' && action !== 'status') argv.push('--replace-custom')
    const result = await $.process.run(argv, { timeoutMs: 30_000 })
    if (generation !== c.generation) return
    c.unavailable = false
    c.state = iconReport(result.stdout)
    // A successful process with malformed output proves nothing about the current icon.
    c.failed = result.exitCode !== 0 || c.state === 'unknown' || (action === 'apply' && c.state !== 'own') || (action === 'clear' && c.state !== 'stock')
    c.changed = action !== 'status' && !c.failed
  } catch {
    if (generation === c.generation) { c.unavailable = true; c.state = 'unknown'; c.failed = true }
  } finally {
    c.busy = undefined; redraw()
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

function companionVersion($: Engine, c: CompanionBook): Promise<string | undefined> {
  return c.pluginVersion ??= $.fs.read(joinPath($.plugin.root, '.claude-plugin', 'plugin.json')).then(text => {
    try { const v = JSON.parse(text).version; return typeof v === 'string' ? v : undefined } catch { return undefined }
  }, () => undefined)
}

export async function companionSnapshot($: Engine, c: CompanionBook): Promise<CompanionSnapshot> {
  const home = await homeOf($)
  const version = await companionVersion($, c)
  if (!home) return { folder: false, app: false, login: false, info: {}, version }
  const folder = await $.fs.exists(joinPath(home, COMPANION_DIR)).catch(() => false)
  const app = await $.fs.exists(joinPath(home, COMPANION_APP)).catch(() => false)
  const login = await $.fs.exists(joinPath(home, COMPANION_PLIST)).catch(() => false)
  let info: CompanionInfo = {}
  if (folder) {
    try {
      const text = await $.fs.read(joinPath(home, COMPANION_DIR, 'companion.json'))
      const raw: unknown = text.length <= 2048 ? JSON.parse(text) : undefined
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const r = raw as Record<string, unknown>
        // Missing and wrong-shaped fields remain missing, never truthy by accident.
        for (const key of ['running', 'accessibility'] as const) if (typeof r[key] === 'boolean') info[key] = r[key]
        for (const key of ['answered', 'sizeAt', 'loginAt', 'followAt'] as const) if (typeof r[key] === 'number' && Number.isFinite(r[key])) info[key] = r[key]
        // This existing Store key is seconds since 1970; request/answer stamps are ms.
        if (typeof r.hiddenUntil === 'number' && Number.isFinite(r.hiddenUntil * 1000) && Math.abs(r.hiddenUntil * 1000) <= 8.64e15) info.hiddenUntil = r.hiddenUntil * 1000
        if (typeof r.version === 'string') info.version = r.version
        if (COMPANION_SIZES.includes(r.size as CompanionSize)) info.size = r.size as CompanionSize
      }
    } catch { /* a half-written or older record has no assumed fields */ }
  }
  return { folder, app, login, info, version }
}

export async function companionData($: Engine, c: CompanionBook, desktop: boolean, now: number): Promise<CompanionBookData> {
  const generation = c.generation
  const s = await companionSnapshot($, c)
  if ((s.info.answered ?? 0) >= c.summonAt) c.unanswered = false
  const state = companionState(s, now, { busy: c.progress, issue: c.issue, unanswered: c.unanswered, followed: c.followed })
  const notRun = c.notRun
  c.notRun = false // exactly one drawing after a permission refusal
  const data: CompanionBookData = { ...s, state, asks: c.processFailed, cannot: c.cannot, notRun, confirmed: c.confirmed, afterTools: c.afterTools, removed: c.removed, message: c.message }
  if (desktop && generation === c.generation) {
    const stage: CompanionStage = state === 'waiting' ? 'corner' : ['stopped', 'hidden', 'corner', 'following'].includes(state) ? state as CompanionStage : 'absent'
    if (c.stage?.state !== stage) {
      const path = STAGE_PNG[stage]
      const png = path ? (await $.fs.read(joinPath($.plugin.root, path), { as: 'bytes' })).base64 : ''
      if (generation !== c.generation) return data
      c.stage = { state: stage, source: companionStageSvg(stage, png) }
    }
    data.stage = { source: c.stage.source, altState: stage }
    if (['hidden', 'waiting', 'corner', 'following'].includes(state)) {
      if (!c.figures) {
        const pixel = (await $.fs.read(joinPath($.plugin.root, 'assets/pixel/01-idle-reading.png'), { as: 'bytes' })).base64
        if (generation !== c.generation) return data
        const painted = (await $.fs.read(joinPath($.plugin.root, 'assets/desktop/01-idle-reading.png'), { as: 'bytes' })).base64
        if (generation !== c.generation) return data
        c.figures = Object.fromEntries(COMPANION_SIZES.map(size => [size, companionSizeSvg(size, size === 'tiny' || size === 'small' ? pixel : painted)]))
      }
      data.figures = c.figures
    }
  }
  return data
}

export async function companionRun($: Engine, c: CompanionBook, argv: readonly string[], description: string, timeout = 30_000): Promise<CompanionRun> {
  c.cannot = false
  if (!c.processFailed) {
    try {
      const r = await $.process.run(argv, { timeoutMs: timeout })
      return { kind: 'ran', stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }
    } catch { c.processFailed = true }
  }
  try {
    const r = await $.tool.call({ tool: 'Bash', command: companionCommand(argv), description, timeout })
    if ('deny' in r) { c.notRun = true; return { kind: 'denied' } }
    const result = r.result as { stdout?: string; stderr?: string; interrupted?: boolean; exitCode?: number }
    return { kind: 'ran', stdout: typeof result?.stdout === 'string' ? result.stdout : (r.text ?? ''), stderr: typeof result?.stderr === 'string' ? result.stderr : '', exitCode: r.isError || result?.interrupted ? 1 : (typeof result?.exitCode === 'number' ? result.exitCode : 0) }
  } catch { c.cannot = true; return { kind: 'cannot' } }
}

export async function writeCompanionRequest($: Engine, c: CompanionBook, view: ClaudesamaView, request: CompanionRequest): Promise<boolean> {
  if (await windows($)) return false
  const home = await homeOf($)
  if (!home || !(await $.fs.exists(joinPath(home, COMPANION_DIR)))) return false
  const now = await $.clock.now(), session = await $.session.id(), desktop = (await $.session.surfaces()).includes('desktop')
  if (!(await $.fs.exists(joinPath(home, COMPANION_DIR)))) return false
  try {
    await $.fs.write(joinPath(home, COMPANION_FEED), companionRequestText(view, session, desktop, now, request))
    return true
  } catch { return false }
}

async function companionChecks($: Engine, c: CompanionBook, active: () => boolean, redraw: () => void, goal: (s: CompanionSnapshot) => boolean, began: number, initial: CompanionSnapshot): Promise<void> {
  c.timer?.cancel()
  const generation = ++c.generation
  let last = JSON.stringify(initial), step = 0, elapsedNow = await $.clock.now()
  if (elapsedNow - began >= 300_000) return
  const waits = [1000, 1000, 2000, 4000, 8000] // absolute offsets: 1, 2, 4, 8, 16 seconds
  const schedule = () => {
    if (!active() || generation !== c.generation) return
    const delay = waits[step++] ?? 30_000
    c.timer = $.clock.after(Math.min(delay, Math.max(0, 300_000 - (elapsedNow - began))), async () => {
      c.timer = undefined
      if (!active() || generation !== c.generation) return
      const now = await $.clock.now()
      elapsedNow = now
      if (now - began >= 300_000) return
      const s = await companionSnapshot($, c)
      if (!active() || generation !== c.generation) return
      const key = JSON.stringify(s)
      if (last !== key) { last = key; redraw() }
      if (goal(s)) {
        c.answerTimer?.cancel(); c.answerTimer = undefined
        c.busy.delete('summon')
      } else schedule()
    })
  }
  schedule()
}

export async function pressCompanion($: Engine, c: CompanionBook, action: CompanionAction, view: ClaudesamaView, redraw: () => void, active: () => boolean): Promise<void> {
  if (await windows($)) return
  const group = ['install', 'retry', 'updateButton'].includes(action) ? 'install' : action
  if (c.busy.has(group) || c.progress) return
  if (action === 'remove' || action === 'keep') { c.confirmed = action === 'remove'; redraw(); return }
  c.stop() // a new press owns the one chain and any delayed summon
  c.busy.add(group)
  const initial = await companionSnapshot($, c)
  // Install is the only action that may create an absent companion. Other presses cannot
  // resurrect his deleted folder, including a press on a stale rendered control.
  if (!['install', 'toolsButton', 'oldToolsButton'].includes(group) && (!initial.folder || !initial.app)) { c.busy.delete(group); return }
  if (action === 'trash' && !c.confirmed) { c.busy.delete(group); return }
  const now = await $.clock.now()
  const at = Math.max(Math.round(now), c.lastAt + 1); c.lastAt = at
  let goal = (_s: CompanionSnapshot) => true
  let deferred = false
  try {
    if (group === 'install' || action === 'trash') {
      c.progress = group as 'install' | 'trash'; redraw()
      const r = await companionRun($, c, ['sh', joinPath($.plugin.root, 'bin/companion-macos.sh'), group === 'install' ? 'install' : 'uninstall', '--report'], group === 'install' ? 'Install Claude-sama Companion' : 'Move Claude-sama Companion to the Trash', 600_000)
      if (r.kind === 'ran') {
        const lines = r.stdout.trim().split(/\r?\n/)
        const report = /^result: (ok|no-tools|old-tools|failed|not-mac)$/.exec(lines[lines.length - 1] ?? '')?.[1]
        if (report === 'ok' && r.exitCode === 0) {
          c.issue = undefined; c.afterTools = false
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
      const argv = action === 'toolsButton' ? ['xcode-select', '--install'] : ['open', 'x-apple.systempreferences:com.apple.Software-Update-Settings.extension']
      const r = await companionRun($, c, argv, action === 'toolsButton' ? 'Get Apple Command Line Tools' : 'Open Software Update')
      if (r.kind === 'ran' && r.exitCode === 0) c.afterTools = true
    } else if (action === 'summon') {
      c.unanswered = false
      c.summonAt = at
      if (!(await writeCompanionRequest($, c, view, { summon: at }))) return
      goal = s => (s.info.answered ?? 0) >= at
      redraw()
      if (initial.info.running === true) {
        // Do not hold a ui.press dispatch open for a clock wait. This one-shot is cancelled
        // with the check chain and cannot start him after his book closes.
        deferred = true
        c.answerTimer?.cancel()
        c.answerTimer = $.clock.after(1500, async () => {
          c.answerTimer = undefined
          if (!active()) { c.busy.delete(group); return }
          const answerGeneration = c.generation
          try {
            const s = await companionSnapshot($, c)
            if (!active() || answerGeneration !== c.generation) return
            if ((s.info.answered ?? 0) < at && s.folder && s.app) {
              c.unanswered = true
              await companionRun($, c, COMPANION_OPEN, 'Bring Claude-sama Companion back')
            }
          } finally { c.busy.delete(group); redraw() }
        })
      } else await companionRun($, c, COMPANION_OPEN, 'Bring Claude-sama Companion back')
    } else {
      let request: CompanionRequest
      if (action === 'follow') { request = { follow: at }; goal = s => s.info.accessibility === true }
      else if (action === 'openSettings') request = { settings: at }
      else if (action === 'on' || action === 'off') { const on = action === 'on'; request = { login: { on, at } }; goal = s => (s.info.loginAt ?? 0) >= at && s.login === on }
      else { const to = action as CompanionSize; request = { size: { to, at } }; goal = s => (s.info.sizeAt ?? 0) >= at && s.info.size === to }
      if (!(await writeCompanionRequest($, c, view, request))) return
      if (action === 'follow') c.followed = now
      redraw()
    }
  } finally {
    c.progress = undefined
    if (!deferred) c.busy.delete(group)
    redraw()
    await companionChecks($, c, active, redraw, goal, now, initial)
  }
}


// ---------------------------------------------------------------- hooks

export function registerBook(on: On): void {
  // The band's view as the plugin writes it: copied for the drawings that must not subscribe to
  // it, a count of the wild soul's visits, and a redraw where a shown figure moved.
  on('state.set', { plugin: 'claudesama', key: 'view' }, async ($, e, next) => {
    const set = await next(e)
    if ('deny' in set) return set
    const before = latest.view
    const after = e.value
    latest.view = after
    // The first view of a load (the session starting): read the marks setting now, so the
    // transcript's rows find it in hand. Rows drawn even earlier wait on this same read.
    if (latest.marks === undefined) {
      latest.marksRead ??= $.store.get('marks').then(
        stored => (latest.marks ??= marksFrom(stored)),
        () => (latest.marks ??= MARKS_DEFAULT),
      )
    }
    if (before && after.mood === 'wild' && before.mood !== 'wild') await countUp($, 'wilds')
    if (before?.lang !== after.lang || before?.voice !== after.voice) {
      $.ui.invalidate('ui.render') // his name and the footer label follow the language and voice
    } else if (open && (book.page === 'offerings' ? before.context !== after.context || before.estimate !== after.estimate : before.colors !== after.colors)) {
      redrawSoon($)
    }
    return set
  })

  // Every reading of the engine's usage figures, whoever asked: the open book shows the latest.
  // The closed book keeps none.
  on('session.usage', async ($, e, next) => {
    const read = await next(e)
    if (!open || !('value' in read)) return read
    const moved = !sameUsage(usage, read.value)
    usage = read.value
    if (moved && open && book.page === 'offerings') redrawSoon($)
    return read
  })

  // The store as this plugin writes it (every plugin's writes raise this event; another's, even
  // of a key of the same name, is not his). `turns` is written once at the end of each turn of
  // the main conversation: the moment to note the first page and the latest night. `omen` is
  // written only for a new slip.
  on('store.set', async ($, e, next) => {
    if (next.origin.plugin !== 'claudesama') return next(e)
    const set = await next(e)
    if ('deny' in set) return set
    if (e.key === 'turns') await turnFinished($)
    if (e.key === 'omen') await countUp($, 'omens')
    if (open && WATCH[book.page].includes(e.key)) redrawSoon($)
    return set
  })

  // The book closing, by the person (or the engine) or by this plugin; another plugin closing a
  // pane of its own under the same name is not his book. Closed, it lets go of all it held.
  on('ui.close', async ($, e, next) => {
    const closed = await next(e)
    const his = e.id === BOOK_PANE && (e.origin.kind !== 'plugin' || next.origin.plugin === 'claudesama')
    if (his && !('deny' in closed)) {
      open = false
      redraw?.cancel()
      redraw = undefined
      forget()
    }
    return closed
  })

  // The band's button.
  on('ui.press', { element: 'claudesama:book:open' }, async ($, e) => {
    await openBook($, book.page)
    return { element: e.element }
  })

  // `/claudesama` opens the book where it was left; `/claudesama about|settings|...` at a page;
  // `/claudesama marks on|replies|off` sets his marks on the engine's rows.
  // Registered before the plugin's other `/claudesama` hook, so this one sees the command first.
  on('command.run', { command: 'claudesama' }, async ($, e, next) => {
    const [verb = '', value = ''] = e.args.trim().toLowerCase().split(/\s+/)
    if (verb === 'warmth' && (value === 'warm' || value === 'clingy')) {
      return next({ ...e, args: e.args.replace(/^(\s*)warmth\b/i, '$1affection') })
    }
    if (verb === 'marks' && (value === 'on' || value === 'replies' || value === 'off')) {
      await setMarks($, value)
      $.ui.toast(fill(ownWords(latest.view?.lang ?? 'en').marks.noted, { value }), { timeoutMs: 8000 })
      return {}
    }
    const page = verb === '' || verb === 'book' ? book.page : ALIASES[verb]
    if (page === undefined) return next(e)
    await openBook($, page)
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: BOOK_PANE }, async ($, e, next) => {
    const held = (await $.state.get(BOOK)).value ?? book
    open = true
    const settings = await $.settings.read()
    timeZone = typeof settings.timeZone === 'string' ? settings.timeZone : undefined
    reducedMotion = settings.prefersReducedMotion === true
    const view = latest.view ?? (await $.state.get(VIEW)).value
    const w = await wordsFor($, view?.lang ?? 'en')
    const data = await dataFor($, held, view)
    const press: Press = {
      go: page => {
        void (async () => {
          await show($, page)
          if (page === 'settings') await runIcon($, iconBook, 'status', () => redrawSoon($))
        })()
      },
      turn: delta => void show($, 'library', book.reading + delta),
      marks: marks => void setMarks($, marks),
    }
    if (held.page === 'settings') {
      data.iconSupported = !(await windows($))
      if (data.iconSupported) {
        data.icon = iconBook.data()
        press.icon = action => runIcon($, iconBook, action, () => redrawSoon($))
      }
    }
    const columns = e.props.bodyColumns
    if (held.page === 'settings' && (e.surface === 'desktop' || e.surface === 'terminal') && (await companionIsMac($, companionBook))) {
      data.companion = await companionData($, companionBook, e.surface === 'desktop', data.now)
      press.companion = async action => {
        const current = latest.view ?? view
        if (current) await pressCompanion($, companionBook, action, current, () => redrawSoon($), () => open && book.page === 'settings')
      }
    }
    if (e.surface === 'desktop') {
      const bad = held.page === 'omen' && (data.fortune?.rank === 'kyo' || data.fortune?.rank === 'daikyo')
      const frame = bad ? 'flustered' : PORTRAIT[held.page]
      const height = held.page === 'him' ? 112 : 56
      const source = await portraitOf($, frame, height)
      return desktopBook($.ui.resolve(e), w, held, data, { source, height }, press, columns)
    }
    if (e.surface === 'terminal') return terminalBook($.ui.resolve(e), w, held, data, press, columns)
    return next(e)
  })
}
