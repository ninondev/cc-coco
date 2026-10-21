import { contrastSvg } from './high-contrast'
// His book, drawn: each page is a list of blocks built from data the plugin already holds, then
// laid out for the desktop (pictures as SVG) or the terminal (pictures as cells and text).
// Pure: no `$`. Text uses theme keys or none, so it follows the app's light or dark theme; the
// only raw colours sit inside pictures. Nothing is faint, so everything keeps the theme's full
// contrast, and nothing is told by colour alone. Italics mark his stage directions and short
// notes; help and notes longer than one line stand upright, which reads faster. Scripts without
// italics (Chinese, Japanese, Korean, Devanagari) stay upright throughout: a slanted glyph there
// is a distortion, not a style.

import { cacheBookLines, costBookLines, costDollars, makerSessionUSD, voiceCacheCost, warmAskLine, warmHeldOffLine, warmTodayLine } from './cost/surfaces'
import type { CostSurfaceSnapshot } from './cost/surfaces'
import { cupSvg } from './cost/cup'
import { costWord } from './cost/words'
import type { PresenceNeighbours } from './presence'
import { gapWord, gapFill } from './mod-gaps-words'
import { moreWord, moreFill } from './more-words'
import type { HelperRow } from './m1-always'
import { MoreEntry, MoreRow, moreRowDrawn } from './more-book'
import { moreOn, moreRowAuthored } from './more-state'
import type { MoreId } from './more-state'
import type { MoreBookData } from './more-book'
import type { D1Snapshot, Helper } from './d1-runtime'
import type { RoomState } from './d1-room'
import { d1Word } from './d1-state.js'
import { scrollSvg, lyingScrollSvg } from './d1-state.js'
import { durationText } from './numbers'
import type { Elements, RenderElement, SessionUsage } from 'claude-code'
import { middleCut } from './tasks'
import { tildePath } from './paths'
import { cacheText, calendarText, clockText, contextAlt, contextText, contextTokens, hasNumber, momentText, numberLocale, numberText, percentText } from './numbers'
import type { NumberWords } from './numbers'
import { issueLine, weekSection } from './week-book'
import type { IssueLine } from './week-book'
import { weekWord } from './week-words'
import type { WeekBookData } from './week-book'
import type { CheckResult, CheckRow } from './checkup'
import { reminderSettings } from './reminder-settings'
import { limitRecords, playWord } from './play'
import { meterSvg } from './book-art'
import { companionSection, nowFit } from './companion-book'
import { MAC_SIZES } from './companion-art'
import { iconSection } from './icon-book'
import type { IconBookData, IconAction } from './icon-book'
import type { CompanionBookData, CompanionAction } from './companion-book'
import { PAGES, fill } from './book-words'
import type { BookWords, Page } from './book-words'
import { cells } from './band.js'
import { visitorWord } from './visitors-art'
import { visitorsOn } from './visitors'
import {untrustedDisplaySlot} from './display-slots'
import { COLUMN_PX, planPx } from './typeset'
import type { Marks } from './latest'
import { desktopWidth, spriteCells, TERMINAL_COLUMNS, TERMINAL_ROWS } from './pictures-lazy'
import { LANGS, WORDS } from './words'
import type { CocoBook, CocoView } from '../types'
import { SOCK_PAIRS, bagArtHeight, bagArtSvg, bagBadgeSvg, bagFill, bagPageName, bagTerminalHead, bagWords, issueBadges, noteBadges, petBadges, sockBadges, vibeBadges, vibeRarity, vibeSet } from './bag'
import { bagMvHeight, bagMvSvg } from './bag-mv'
import type { MvReading } from './bag-mv'
import type { SockMode, SockPair } from './bag'
import type { BagBadge, BagGroup, BagPeek, BagQuota, BagTag } from './bag'
import { quotaBankRows, quotaBatteryRows, quotaCellsLeft, quotaForecast, quotaForecastText, quotaMeterText, quotaPixelSvg, quotaTrendFor, quotaTrendSvg } from './quota'
import type { QuotaTrend } from './quota'
import { quotaTrailFrom } from './quota-trail'
import { commitCount, commitLineHeight, commitLineSvg, commitLineText, commitLineWidth } from './play-commits'
import type { Lang } from './words'
import { STRINGS as CARD_WORDS, langOf as cardLang } from './cards/i18n'


// Where a slanted glyph is a distortion: these languages' secondary text stays upright, and
// their stage directions keep their parentheses to say what they are.
export const NO_ITALIC: ReadonlySet<string> = new Set(['zh', 'zh-Hant', 'ja', 'ko', 'hi'])

type Own = (typeof WORDS)['en']

// What a page needs besides the book's words: the band's latest view, the engine's latest usage
// figures, the store values the page shows, the time, a few settings, and the band's own small
// words in this language (his name, the about lines, the pictures' alt text).
export type BookData = {
  cost?: CostSurfaceSnapshot
  // Every open session on this computer, read when their page opens (E1-2); self is the one this book is in.
  windows?: { rows: readonly BookWindow[]; self: string; home?: string }
  costHow?: boolean
  d1?: D1Snapshot
  room?: RoomState
  roomNarration?: string
  roomPicture?: { source: string; alt: string; width: number; height: number }
  d1NotificationDenied?: boolean
  d1NotifyAvailable?: boolean
  pace?: readonly { kind: string; exhaustionAt: number }[]
  bookmark?: { where: string; at: number }
  spark?: { file: string; line: number; quote?: string } // the comment he liked last, this session only
  shelf?: { names: string[] } | 'empty' | 'error' // the files Claude opened most in this folder
  neighbours?: PresenceNeighbours
  view: CocoView | undefined
  usage: SessionUsage | undefined
  store: Record<string, unknown>
  now: number
  timeZone: string | undefined
  reducedMotion: boolean
  marks: Marks
  voiceSizes: { light: number; full: number }
  voiceSize?: number
  reading: number
  own: Own
  iconSupported?: boolean
  icon?: IconBookData
  companion?: CompanionBookData
  languages?: boolean
  cache?: number | null
  check?: CheckResult
  platform?: 'darwin' | 'win32' | 'linux'
  more?: MoreBookData
  m1Him?: RenderElement
  windowNotes?: RenderElement
  talkEnabled?: boolean
  talkTab?: string
  m1Always?: {helpers?:HelperRow[];wake?:{at:number;what:string}|null;model?:string;summary?:number;worktrees?:string[];added?:string[]}
  diaryPage?: string
  visitors?: GuestBook
  visitorsButton?: string
  cards?: number // the skill cards the deck holds once dealt (cards/state.ts dealtCards), beside the button at the bag's top
  week?: WeekBookData
  socks?: string // the pair from their drawer they wear (bag.ts SOCK_PAIRS); absent: their own
  drawer?: { mode: SockMode; open: readonly string[] } // how their drawer fills and the pairs they can put on (bag.ts socksOpen)
  switches?: Record<string, unknown> // the settings as the settings page reads them, for their bag's badges on every page
  vibe?: { failed: number; fixed: number; compacted: number; ran?: number; last?: 'pass' | 'fail' } & VibeRows // this session's failed, fixed and all test runs, the last one's verdict, and compactions
  vibeShare?: { saved?: string; button: { key: string; label: string } } // the share card's save button and what the last save did (lane C, 10-17)
  issues?: readonly number[] // the doujin's issues in their collection, oldest first (week-days.ts weekIssues)
  bagPeek?: BagPeek // Coco peeking into the bag's picture from the right (lane A's bag-peek.png)
}

// The guest book page, already worded: his page's visitors, newest first, one month at a time.
export type GuestBook = {
  state: 'list' | 'empty' | 'reading' | 'unreadable'
  title: string; direction: string; back: string
  text?: string; month?: string
  rows: { id: string; portrait: string; when: string; name: string }[]
  previous?: string; next?: string
}

export type Press = {
  costHow?: () => void
  check?: (row: CheckRow) => Promise<void>
  go: (page: Page) => void
  turn: (delta: number) => void
  marks: (marks: Marks) => void
  icon?: (action: 'status' | IconAction) => Promise<void>
  companion?: (action: CompanionAction) => Promise<void>
}

// The vibe check page's rows (step 2): the first failing test by name, three reds in a row, the last build and its usual
// time, the main loop's tools by kind, helpers sent and back done, commits.
type VibeRows = { storms?: number; firstFail?: string; build?: { ms: number; usualMs?: number; slow: boolean }; tools?: Partial<Record<string, number>>; helpers?: number; back?: number; commits?: number }
type Option = { value: string; label: string; key: string }
type Block =
  | { t: 'window-notes'; element: RenderElement }
  | { t: 'more'; data: MoreBookData }
  // one More row in its switches-page group (step 2)
  | { t: 'moreRow'; id: MoreId; data: MoreBookData; tags?: readonly string[]; payer?: true }
  | { t: 'link'; href: string; text: string }
  | { t: 'cup'; state: CostSurfaceSnapshot['cache']['state']; alt: string; text: string }
  | { t: 'helper'; description: string; text: string; nested: boolean; state: Helper['state'] }
  | { t: 'week'; data: WeekBookData }
  // a row of the zine's every issue (owner 10-17)
  | { t: 'issue'; line: IssueLine }
  | { t: 'check'; data: CheckResult }
  // a group on their itabag's pages wears its badge and a notched rule (step 2)
  | { t: 'heading'; text: string; marginTop?: 1; badge?: BagBadge }
  | { t: 'para'; text: string; space?: true }
  // the line on top of a page of their itabag saying what its badges say, with the numbers (step 2)
  | { t: 'lead'; text: string }
  // a row of an itabag page's group: what it counts, in bold, and a dim line under it where one helps (step 2)
  | { t: 'row'; label: string; help?: string }
  | { t: 'note'; text: string; value?: string }
  | { t: 'fact'; label: string; text: string }
  | { t: 'meter'; percent: number; alt: string; neighbour?: true }
  | { t: 'trend'; trend: QuotaTrend; alt: string }
  | { t: 'incense'; label: string; text: string; percent: number; alt: string; neighbour?: true; hot?: true; kind?: string; out?: true }
  | { t: 'box'; percent: number | null; title: string; detail: string | null; alt: string }
  | { t: 'choice'; label: string; now: string; current: string; options: readonly Option[]; help: string; local?: true; tags?: readonly string[] }
  | { t: 'button'; key: string; label: string; primary?: true }
  | { t: 'nav'; previous: string; next: string; where: string }
  | { t: 'icon'; data: IconBookData }
  | { t: 'companion'; data: CompanionBookData }
  | { t: 'visit'; portrait: string; when: string; name: string }
  | { t: 'months'; previous?: string; next?: string }
  | { t: 'socks'; pairs: { key: string; label: string; worn: boolean; locked?: string }[] }

// ---------------------------------------------------------------- formatting

const locale = numberLocale
const number = numberText
export function bookNumberWords(w: BookWords, own: Own): NumberWords { return { offerings: w.offerings, durations: w.durations, alt: own.alt } }

const time = clockText
const date = calendarText

export function moment(iso: string, now: number, lang: string, timeZone: string | undefined): string { return momentText(iso, now, lang, timeZone) }

// Whether a line of text fits the body's width on one line, as cells count it (generous on the
// desktop, whose proportional type fits a little more).
function oneLine(text: string, columns: number): boolean {
  return cells(text) <= (columns > 0 ? columns : 60)
}

export function answeredVoiceRow(E: Elements[keyof Elements], w: BookWords, voice: string): RenderElement {
  const {Box,Text,Button}=E, s=w.settings, on=voice!=='off'
  const now=fill(s.now,{value:on?s.voice.light:s.voice.off})
  return <Box flexDirection="column"><Box flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={1} alignItems="center"><Text wrap="wrap"><Text bold>{s.voice.label}</Text>{`  ${now}`}</Text><Box flexDirection="row" flexWrap="wrap" columnGap={1}><Button key={`coco:set:voice:${on?'off':'light'}`} label={on?s.voice.off:s.voice.light} onPress={()=>{}}/></Box></Box></Box>
}

// ---------------------------------------------------------------- pages

export type BookWindow = { session: string; cwd: string; busy?: boolean; busySince?: number; lastPromptAt?: number }
// Their windows (E1-2, his card 10-17: list only, no buttons): with two or more sessions open, a row each with its folder,
// what it is doing and since when; the window this book is in, and the one the desktop pet follows (the newest prompt,
// as the presence record decides), are marked. A language without lane B's words draws none of it.
function windowsBlocks(d: BookData, lang: string): Block[] {
  const w = bagWords(lang)?.windows, list = d.windows
  if (!w || !list || list.rows.length < 2) return []
  const pet = d.companion?.folder && d.companion.app && d.companion.info.running === true
  const followed = pet ? [...list.rows].filter(r => typeof r.lastPromptAt === 'number').sort((a, b) => b.lastPromptAt! - a.lastPromptAt! || a.session.localeCompare(b.session))[0]?.session : undefined
  const folder = (cwd: string) => tildePath(cwd, list.home)
  return groupBlocks(fill(w.title, { n: number(list.rows.length, lang) }), { on: true, face: '#3A86C8' }, list.rows.map((r): Block => {
    const since = hasNumber(r.busySince) ? momentText(r.busySince, d.now, lang, d.timeZone) : undefined
    const doing = r.busy ? since ? fill(w.working, { time: since }) : w.workingNow : since ? fill(w.quiet, { time: since }) : w.quietNow
    const marks = [r.session === list.self ? w.here : '', r.session === followed ? w.follows : ''].filter(Boolean)
    return { t: 'row', label: middleCut(folder(r.cwd), 60), help: tagLine([doing, ...marks], lang) }
  }))
}
export function pageBlocks(page: Page, w: BookWords, d: BookData, surface: 'desktop' | 'terminal' | 'vscode' | 'mobile' = 'desktop'): Block[] {
  const body = pageBody(page, w, d, surface), lead = pageLead(page, body, d, w)
  if (!lead) return body
  // under the check-up, which stays the first thing on the page
  const at = body[0]?.t === 'check' ? 1 : 0
  return [...body.slice(0, at), { t: 'lead', text: lead }, ...body.slice(at)]
}
// What a page's badges say, in lane B's words with this page's numbers (settings_drafts.py lead). A language shows it
// once lane B has written it; their page and the zine wait for their own parts of step 2.
// Who keeps them company on the desktop band and the pet: Coco, Claudie or Claudie in her maid's dress (A 10-16; the
// terminal always has Coco). Shown once lane B's words are in.
const LOOKS = ['coco', 'dake', 'maid', 'fish'] as const
function lookOf(d: BookData): typeof LOOKS[number] {
  const form = (d.switches ?? d.store)?.claudeForm
  return LOOKS.find(look => look === form) ?? 'coco'
}
function lookBlocks(d: BookData, w: BookWords, lang: string): Block[] {
  const look = bagWords(lang)?.look
  if (!look) return []
  const current = lookOf(d)
  return [{ t: 'choice', label: look.label, current, now: fill(w.settings.now, { value: look[current] }), options: LOOKS.map(value => ({ value, label: look[value], key: `coco:set:claudeForm:${value}` })), help: look.help }]
}
// The bag's pictures: the current ones, or the duotone MV style (owner 10-17: both stay, the current one by default).
// Shown once lane B's words are in.
const BAG_STYLES = ['classic', 'mv'] as const
const bagStyleOf = (d: BookData): typeof BAG_STYLES[number] => (d.switches ?? d.store)?.bagStyle === 'mv' ? 'mv' : 'classic'
function bagStyleBlocks(d: BookData, w: BookWords, lang: string): Block[] {
  const style = bagWords(lang)?.bagStyle
  if (!style) return []
  const current = bagStyleOf(d)
  return [{ t: 'choice', label: style.label, current, now: fill(w.settings.now, { value: style[current] }), options: BAG_STYLES.map(value => ({ value, label: style[value], key: `coco:set:bagStyle:${value}` })), help: style.help }]
}
function pageLead(page: Page, body: readonly Block[], d: BookData, w: BookWords): string | undefined {
  const lang = d.view?.lang ?? 'en', template = bagWords(lang)?.lead?.[page]
  if (!template) return undefined
  if (page === 'settings') { const states = switchStates(body); return bagFill(template, { total: states.length, on: states.filter(Boolean).length }) }
  if (page === 'socks') return bagFill(template, { total: SOCK_PAIRS.length, have: (d.drawer?.open ?? SOCK_PAIRS).length })
  if (page === 'library') return bagFill(template, { notes: d.bookmark ? 1 : 0 })
  if (page === 'omen') { const v = d.vibe; return bagFill(template, { failed: v?.failed ?? 0, fixed: v?.fixed ?? 0, compacted: v?.compacted ?? 0 }) }
  if (page === 'log') return d.issues?.length ? bagFill(template, { issues: number(d.issues.length, lang), latest: number(d.issues.at(-1)!, lang) }) : undefined
  // their page: the size they stand at on the desk, in the companion section's own names; nothing while they are not there
  if (page === 'him') {
    const c = d.companion
    if (!c?.folder || !c.app || c.info.running !== true) return undefined
    const size = c.info.size === 'tiny' || c.info.size === 'small' ? 'medium' : c.info.size ?? 'medium'
    return bagFill(template, { size: w.settings.companion.macSizes[MAC_SIZES.indexOf(size)] ?? size, name: bagWords(lang)?.look?.[lookOf(d)] ?? d.own.name })
  }
  // what is left of each window, as a percentage (owner 10-15: 「5小时额度还剩「具体额度」7天额度还剩「具体额度」」); both or none
  if (page === 'offerings') {
    const limits = d.usage?.rateLimits ?? d.view?.quota?.rateLimits ?? [], lang = d.view?.lang ?? 'en'
    const left = (kind: string) => { const limit = limits.find(l => l.kind === kind); return limit && hasNumber(limit.percentUsed) ? percentText(Math.round(Math.max(0, 100 - limit.percentUsed)), lang) : undefined }
    const fiveLeft = left('five_hour'), weekLeft = left('seven_day')
    const q = bagQuota(d)
    return fiveLeft && weekLeft ? bagFill(template, { fiveLeft, weekLeft, five: q.five ?? 0, week: q.week ?? 0, total: 4 }) : undefined
  }
  return undefined
}
// The files he opens most and the seven short reads, as the sticky notes page draws them and, from step 2, the zine page.
function shelfBlocks(d: BookData, w: BookWords, lang: string): Block[] {
  const sh = w.library.shelf, shelf = d.shelf
  return !reminderSettings(d.store).bookmark || shelf === undefined ? [] : [
    { t: 'heading', text: sh.head },
    ...(shelf === 'error' ? [{ t: 'note' as const, text: sh.error }] : shelf === 'empty' ? [{ t: 'note' as const, text: sh.empty }]
      : [...shelf.names.map((name, n): Block => ({ t: 'para', text: `${numberText(n + 1, lang)}. ${name}` })), { t: 'note' as const, text: sh.note }]),
  ]
}
function readingBlocks(d: BookData, w: BookWords, lang: string, below = false): Block[] {
  const all = w.library.readings, i = ((d.reading % all.length) + all.length) % all.length, reading = all[i] ?? all[0]
  return [
    { t: 'heading', ...(below ? { marginTop: 1 as const } : {}), text: reading?.title ?? '' },
    { t: 'para', text: reading?.text ?? '' },
    { t: 'nav', previous: w.library.previous, next: w.library.next, where: fill(w.library.of, { i: numberText(i + 1, lang), n: numberText(all.length, lang) }) },
  ]
}
// A group on an itabag page: its name with a badge, then its rows; a group with nothing to show is left out.
function groupBlocks(text: string, badge: BagBadge, rows: readonly Block[]): Block[] {
  return rows.length ? [{ t: 'heading', text, badge }, ...rows] : []
}
// Vibe check's groups (settings_drafts.py body_vibe): tests and builds, then this session, in lane B's words; a row with
// nothing to count is left out, and a language without the words draws neither group.
function vibeGroupBlocks(d: BookData, w: BookWords, lang: string): Block[] {
  const bag = bagWords(lang), rows = bag?.vibeRows, names = bag?.vibeGroups
  if (!rows || !names) return []
  const v = d.vibe, n = (value: number) => number(value, lang), row = (label: string, help?: string): Block => ({ t: 'row', label, ...(help ? { help } : {}) })
  const build = v?.build && v.build.usualMs !== undefined ? v.build : undefined
  const tests = [
    ...(v?.firstFail ? [row(rows.firstFail, v.firstFail)] : []),
    ...((v?.ran ?? 0) > 0 ? [row(bagFill(rows.fixed, { fixed: n(v!.fixed) }))] : []),
    ...((v?.storms ?? 0) > 0 ? [row(bagFill(rows.storms, { storms: n(v!.storms!) }), rows.stormsHelp)] : []),
    ...(build ? [row(bagFill(rows.build, { usual: durationText(build.usualMs! / 1000, lang, w.durations), now: durationText(build.ms / 1000, lang, w.durations) }), build.slow ? rows.buildSlow : undefined)] : []),
  ]
  const kinds = { read: 0, search: 0, write: 0, run: 0, web: 0, plan: 0, ...v?.tools }, used = kinds.read + kinds.search + kinds.write + kinds.run + kinds.web + kinds.plan
  const session = [
    ...(used > 0 ? [row(bagFill(rows.tools, { n: n(used) }), bagFill(rows.toolKinds, { read: n(kinds.read), search: n(kinds.search), write: n(kinds.write), run: n(kinds.run), web: n(kinds.web), plan: n(kinds.plan) }))] : []),
    ...((v?.helpers ?? 0) > 0 ? [row(bagFill(rows.helpers, { n: n(v!.helpers!), back: n(v!.back ?? 0) }))] : []),
    ...((v?.commits ?? 0) > 0 ? [row(bagFill(rows.commits, { n: n(v!.commits!) }))] : []),
    ...((v?.compacted ?? 0) > 0 ? [row(bagFill(rows.compactions, { n: n(v!.compacted) }))] : []),
  ]
  // The share card (his design, 10-17): what goes on it, the save, and where it went.
  const share: Block[] = d.vibeShare ? [
    ...(bag?.shareHelp ? [{ t: 'note' as const, text: bag.shareHelp }] : []),
    ...(d.vibeShare.saved ? [{ t: 'para' as const, text: d.vibeShare.saved }] : []),
    { t: 'button', key: d.vibeShare.button.key, label: d.vibeShare.button.label },
  ] : []
  return [...groupBlocks(names.tests, { on: true, face: '#D97757', mark: 'x' }, tests), ...groupBlocks(names.session, { on: true, face: '#3A86C8', mark: 'squash' }, session),
    ...groupBlocks(names.share, { on: true, face: '#D97757', mark: 'note' }, share)]
}
function pageBody(page: Page, w: BookWords, d: BookData, surface: 'desktop' | 'terminal' | 'vscode' | 'mobile'): Block[] {
  const lang = d.view?.lang ?? 'en'
  if (page === 'him' && d.visitors) {
    const g = d.visitors
    return g.state === 'list'
      ? [{ t: 'heading', text: g.month ?? '' }, ...g.rows.map((r): Block => ({ t: 'visit', portrait: r.portrait, when: r.when, name: r.name })), ...(g.previous || g.next ? [{ t: 'months' as const, previous: g.previous, next: g.next }] : [])]
      : [{ t: 'para', text: g.text ?? '' }]
  }
  // Their sock drawer (lane C, 10-14): press a pair and they wear it, in the band, the other windows and the companion.
  if (page === 'socks') {
    const bag = bagWords(lang), names = bag?.socks, worn = d.socks ?? 'honmei', drawer = d.drawer ?? { mode: 'all' as const, open: SOCK_PAIRS }
    // How the drawer fills (owner 10-15): collect, a pair for each first, or every pair at once.
    const ways = { collect: playWord(lang, 'socks.mode.collect'), all: playWord(lang, 'socks.mode.all') }, label = playWord(lang, 'socks.mode.label')
    const mode: Block[] = label && ways.collect && ways.all ? [{ t: 'choice', label, current: drawer.mode, now: fill(w.settings.now, { value: ways[drawer.mode] }), options: (['collect', 'all'] as const).map(value => ({ value, label: ways[value], key: `coco:set:socksMode:${value}` })), help: playWord(lang, 'socks.mode.help') }] : []
    // A pair they do not have yet says how they get it.
    const pairs: Block = { t: 'socks', pairs: SOCK_PAIRS.map((key, i) => ({ key, label: names?.[i] ?? key, worn: key === worn, ...(drawer.open.includes(key) ? {} : { locked: playWord(lang, `socks.hint.${key}`) }) })) }
    // Step 2 (settings_drafts.py body_socks): the drawer under its group name, then the pair they wear and the way back
    // to their first pair, in lane B's words; a language without them keeps the drawer as it was.
    const drawerName = bag?.sockGroups?.drawer, rows = bag?.sockRows
    if (!drawerName || !rows) return [...mode, pairs]
    const first = SOCK_PAIRS[0], nameOf = (pair: string) => names?.[SOCK_PAIRS.indexOf(pair as SockPair)] ?? pair
    return [
      ...groupBlocks(drawerName, { on: true, face: '#D97757', mark: 'sock' }, [...mode, pairs]),
      { t: 'fact', label: rows.wearing, text: nameOf(worn) },
      ...(worn === first ? [] : [{ t: 'button' as const, key: `coco:socks:${first}:back`, label: bagFill(rows.back, { name: nameOf(first) }) }]),
    ]
  }
  if (page === 'him') {
    const diary: Block[] = [
      ...(d.talkEnabled?[{t:'button' as const,key:'coco:diary:write',label:moreWord('diary.write',lang)}]:[]),
      ...(d.diaryPage?[{t:'para' as const,text:d.diaryPage}]:[]),
    ]
    const shed: Block[] = d.m1Always?.summary?[{t:'para' as const,text:moreFill(moreWord('shed.summary',lang),{n:d.m1Always.summary})}]:[]
    const letters: Block[] = d.windowNotes ? [{t:'window-notes' as const,element:d.windowNotes}] : []
    const room: Block[] = surface === 'terminal' && d.roomNarration ? [{t:'para' as const,text:d.roomNarration,space:true as const}] : []
    const guests: Block[] = surface === 'terminal' && d.visitorsButton ? [{ t: 'button' as const, key: 'coco:visitors:open', label: d.visitorsButton }] : []
    const about: Block[] = [...d.own.about.map((text): Block => ({ t: 'para', text })), ...w.profile.map((f): Block => ({ t: 'fact', label: f.label, text: f.text }))]
    // His one stick (main 10-09) comes before the closing link, which stays the page's last line (M1 MOD2).
    const link: Block = { t: 'link', href: 'https://github.com/ninondev/cc-coco', text: gapWord(lang,'him.unofficial') }
    // Step 2 (settings_drafts.py body_her): their lines first, then their desktop companion (from the switches page) and what
    // you do together, under lane B's group names; a language without them keeps the older page.
    const groups = bagWords(lang)?.himGroups
    if (!groups) return [...diary, ...shed, ...letters, ...room, ...guests, ...about, ...stickBlocks(d, w), link]
    const companion: Block[] = surface !== 'mobile' && d.companion ? [{ t: 'companion', data: d.companion }] : []
    return [
      ...room, ...about, ...lookBlocks(d, w, lang), ...bagStyleBlocks(d, w, lang),
      ...groupBlocks(groups.companion, { on: true, face: '#3A86C8' }, companion),
      ...windowsBlocks(d, lang),
      ...groupBlocks(groups.together, { on: true, face: '#D97757' }, [...stickBlocks(d, w), ...diary, ...letters, ...guests, ...shed]),
      link,
    ]
  }

  if (page === 'omen') {
    // Their vibe check (lane C, 10-14): the day's verdict on this session, two roasts and a way out, in lane B's words, then
    // what this session did. It took the day's omen's place whole (owner 10-15).
    const facts = d.vibe ?? { failed: 0, fixed: 0, compacted: 0 }, verdict = vibeSet(lang, facts, d.now, d.timeZone)
    const slots = { fixed: number(facts.fixed, lang), compacted: number(facts.compacted, lang) }
    const vibe: Block[] = verdict ? [{ t: 'heading', text: bagFill(verdict.verdict, slots) }, ...verdict.roasts.map(text => ({ t: 'para' as const, text: bagFill(text, slots) })), { t: 'note', text: bagFill(verdict.step, slots) }] : []
    return [...vibe, ...vibeGroupBlocks(d, w, lang)]
  }

  if (page === 'offerings') {
    const o = w.offerings
    const nw = bookNumberWords(w, d.own)
    const context = d.usage?.context
    const percent = hasNumber(d.view?.context) ? d.view.context : null
    const estimate = d.view?.estimate === true
    const tokens = estimate ? context?.breakdown?.totalTokens : context?.tokens
    // the band's window is the one the engine compacts at; the model's is the fallback
    const window = hasNumber(d.view?.contextWindow) ? d.view?.contextWindow : context?.window
    const conversation: Block[] = [...(d.m1Always?.model?[{t:'para' as const,text:d.m1Always.model}]:[])]
    if (percent === null) {
      conversation.push({ t: 'box', percent: null, title: o.noReading, detail: null, alt: '' })
    } else {
      conversation.push({
        t: 'box',
        percent,
        title: contextText(percent, lang, nw, estimate),
        detail: hasNumber(tokens) && hasNumber(window) ? contextTokens(tokens, window, lang, nw, estimate) : null,
        alt: contextAlt(percent, lang, nw, estimate),
      })
      conversation.push({ t: 'meter', percent, alt: contextAlt(percent, lang, nw, estimate) })
      if (estimate) conversation.push({ t: 'note', text: o.estimateNote })
    }
    const quota: Block[] = []
    const spent = d.view?.spentWindows ?? []
    const readings = (d.usage?.rateLimits ?? []).filter(limit => hasNumber(limit.percentUsed))
    const limits = [...readings, ...spent.filter(kind => !readings.some(limit => limit.kind === kind)).map(kind => ({kind, percentUsed: 100, resetsAt: hasNumber(d.view?.spentResets?.[kind]) ? new Date(d.view!.spentResets![kind]!).toISOString() : null}))]
    if (limits.length === 0) quota.push({ t: 'note', text: o.noLimits })
    const trail = quotaTrailFrom(d.store.quotaTrail)
    for (const limit of limits) {
      const used = fill(o.used, { percent: number(limit.percentUsed, lang) })
      const resetClause = limit.resetsAt ? fill(o.resets, { time: moment(limit.resetsAt, d.now, lang, d.timeZone) }) : ''
      const kind = o.kinds[limit.kind] ?? limit.kind
      const out = spent.includes(limit.kind), reset = d.view?.spentResets?.[limit.kind] ?? (limit.resetsAt ? Date.parse(limit.resetsAt) : undefined)
      const time = momentText(reset, d.now, lang, d.timeZone)
      quota.push({ t: 'incense', kind: limit.kind, label: kind, text: resetClause ? fill(o.usedAndReset, { used, reset: resetClause }) : used, percent: limit.percentUsed, alt: out ? gapFill(lang,'alt.incense.out',{window:kind,time}) : `${kind}: ${used}`, ...(out ? { out: true as const } : {}), ...(reminderSettings(d.store).notes && d.pace?.some(p => p.kind === limit.kind && p.exhaustionAt > d.now) ? {hot:true as const} : {}) })
      if (out) quota.push({t:'note',text:gapFill(lang,'offerings.out',{time}),value:time})
      // What the readings say comes next (lane C, 10-14; the band's hover says the short form): the whole sentence, with
      // the pace it was worked out from and what is left per hour or per day. It stands for the older pace note.
      const forecast = out ? undefined : quotaForecast({ kind: limit.kind, percentUsed: limit.percentUsed, ...(limit.resetsAt ? { resetsAt: limit.resetsAt } : {}) }, d.now, d.view?.paceRates?.[limit.kind], !!d.view?.hotWindows?.includes(limit.kind))
      const sentence = forecast ? quotaForecastText(lang as Lang, forecast, d.now, d.timeZone) : ''
      // Where the window went since it opened, and where this pace takes it (lane C, 10-15; quota_page.py's charts).
      const trend = forecast ? quotaTrendFor(trail, forecast, d.now) : undefined
      if (trend) quota.push({ t: 'trend', alt: sentence ? `${kind}: ${sentence}` : `${kind}: ${used}`, trend: { ...trend, resetLabel: momentText(trend.end, d.now, lang, d.timeZone),
        ...(trend.warn && trend.median ? { crossLabel: `~${momentText(trend.median[0], d.now, lang, d.timeZone)}` } : {}) } })
      if (sentence) quota.push({ t: 'para', text: sentence })
      const pace = reminderSettings(d.store).notes ? d.pace?.find(p => p.kind === limit.kind) : undefined
      if (!sentence && pace && hasNumber(pace.exhaustionAt) && pace.exhaustionAt > d.now) {const value=`~${clockText(pace.exhaustionAt, lang, d.timeZone)}`;quota.push({t:'note',text:fill(o.pace, {time:value}),value})}
    }
    if (reminderSettings(d.store).neighbours && d.neighbours?.running) for (const agent of d.neighbours.agents.slice(0,32)) {
      const agentLabel=untrustedDisplaySlot(agent.label)
      const windows = [agent.quota?.primary, agent.quota?.secondary].filter(window => hasNumber(window?.usedPercent))
      if (!windows.length) continue
      quota.push({t:'heading',text:fill(o.neighbour,{agent:agentLabel})})
      for (const window of windows) {
        const kind = window!.windowMinutes === 300 ? 'five_hour' : window!.windowMinutes === 10080 ? 'seven_day' : ''
        const label = o.kinds[kind] ?? agentLabel
        const used = fill(o.used,{percent:number(window!.usedPercent,lang)})
        const reset = hasNumber(window!.resetsAt) ? fill(o.resets,{time:moment(new Date(window!.resetsAt! * 1000).toISOString(),d.now,lang,d.timeZone)}) : ''
        quota.push({t:'incense',label,text:reset?fill(o.usedAndReset,{used,reset}):used,percent:window!.usedPercent!,alt:`${label}: ${used}`,neighbour:true})
      }
    }
    const cost = d.cost ?? d.view?.cost
    const cache: Block[] = []
    {
      const heading=costWord(lang,'offerings.cacheHeading')
      if(heading)cache.push({t:'heading',text:heading})
      if(cost)cache.push(...cacheBookLines(cost,lang,d.now,d.timeZone))
      else if(heading)cache.push({t:'para',text:costWord(lang,'offerings.cacheNone')})
      const how=costWord(lang,d.costHow?'offerings.howHide':'offerings.howShow')
      if(how)cache.push({t:'button',key:'coco:cache:how',label:how})
      if(d.costHow)cache.push({t:'para',text:costWord(lang,'offerings.how')})
      // The More focus path is connected in K1b.
    }
    // A figure that is not known yet leaves its line out; with none known, one note says so (BOOK F3).
    // Dollars appear only after a payer is named (K1 W5): a ledger figure with no payer snapshot is not shown, since on a plan it is not a bill.
    const sessionUSD=cost?.sessionUSD??d.usage?.cost?.usd
    const subscription=cost?.billing.kind==='plan'
    const sessionQualified=!!cost&&!['unknown','cloud','credits'].includes(cost.billing.kind)
    const makerUSD = cost ? makerSessionUSD(cost) : undefined
    const session: Block[] = []
    if(cost&&cost.billing.kind!=='unknown'){
      if(makerUSD!==undefined)session.push({ t: 'para', text: fill(o.cost, { usd: costDollars(makerUSD, lang, true) }) }, { t: 'para', text: costWord(lang, 'prices.unknownModel') })
      else if(sessionQualified&&!cost.billing.organisation&&!cost.billing.otherMaker&&hasNumber(sessionUSD))session.push({ t: 'para', text: fill(subscription ? o.subscriptionCost : o.cost, { usd: costDollars(sessionUSD, lang, cost.sessionEstimated) }) })
    }
    if(hasNumber(d.usage?.startedAt))session.push({ t: 'para', text: fill(o.started, { time: momentText(d.usage.startedAt, d.now, lang, d.timeZone) }) })
    if(hasNumber(d.cache))session.push({ t: 'para', text: cacheText(d.cache, lang, nw) })
    const thisSession: Block[] = session.length ? session : [{ t: 'note', text: o.noReading }]
    if(cost)thisSession.push(...costBookLines(cost,lang,makerUSD!==undefined).map(text=>({t:'para' as const,text})))
    const prices=costWord(lang,'offerings.prices')
    const more: Block[] = prices ? [{t:'button',key:'coco:prices:open',label:prices}] : []
    const rest: Block[] = []
    if(d.m1Always?.wake)rest.push({t:'para',text:moreFill(moreWord('wake.hover',lang),{time:time(d.m1Always.wake.at,lang,d.timeZone),what:d.m1Always.wake.what})})
    for(const name of d.m1Always?.worktrees??[])rest.push({t:'para',text:moreFill(moreWord('ribbon.worktree',lang),{name})})
    for(const folder of d.m1Always?.added??[])rest.push({t:'para',text:moreFill(moreWord('ribbon.added',lang),{folder})})
    rest.push(...helperBoard(d,w))
    // Step 2 (settings_drafts.py body_quota): the windows first, then this session, then the price table, under lane B's
    // group names; a language without them keeps the older order under the book's headings.
    const groups = bagWords(lang)?.quotaGroups
    if (!groups) return [{ t: 'heading', text: o.context }, ...conversation, { t: 'heading', text: o.limits }, ...quota, ...cache, { t: 'heading', text: o.session }, ...thisSession, ...more, ...rest]
    return [
      ...groupBlocks(groups.quota, { on: true, face: '#3A86C8', mark: 'level' }, quota),
      ...groupBlocks(groups.session, { on: true, face: '#D97757', mark: 'squash' }, [...conversation, ...thisSession, ...cache, ...rest]),
      ...groupBlocks(groups.more, { on: true, face: '#B9B2AC' }, more),
    ]
  }

  if (page === 'log') {
    const l = w.log
    const turns = Number(d.store.turns ?? 0)
    const count = (n: number) => (n === 0 ? l.never : n === 1 ? l.once : fill(l.times, { n: number(n, lang) }))
    const night = d.store.latestNight as { at: number; minutes: number } | undefined
    const first = Number(d.store.firstMet ?? 0)
    const week: Block[] = d.week ? [{ t: 'week' as const, data: d.week }] : []
    const days: Block[] = [
      { t: 'fact', label: l.pages, text: number(turns, lang) },
      { t: 'fact', label: l.first, text: first ? date(first, lang, d.timeZone, true) : l.never },
      { t: 'fact', label: l.latest, text: night ? fill(l.at, { time: time(night.at, lang, d.timeZone), date: date(night.at, lang, d.timeZone, true) }) : l.never },
      { t: 'fact', label: l.wild, text: count(Number(d.store.wilds ?? 0)) },
    ]
    const helpers: Block[] = (d.m1Always?.helpers??[]).map(helper=>({t:'para' as const,text:helper.description+(helper.result?', '+moreFill(moreWord('helpers.result',lang),{line:helper.result}):'')}))
    const bookmark: Block[] = reminderSettings(d.store).bookmark && d.bookmark ? [{t:'fact' as const,label:w.settings.bookmark.label,text:fill(l.bookmark,{where:d.bookmark.where,when:momentText(d.bookmark.at,d.now,lang,d.timeZone)})}] : []
    const spark: Block[] = d.spark ? [{ t: 'fact' as const, label: l.spark, text: `${d.spark.file}:${d.spark.line}${d.spark.quote ? ` “${d.spark.quote}”` : ''}` }] : []
    // Step 2 (settings_drafts.py body_zine): this week (its cover, the facts, the files he opens most), then the seven
    // short reads as extras; the bookmark goes to the sticky notes page. Both pages change together, once lane B has named
    // the sticky notes page's groups. The stamp book that closed this page is gone (DECISIONS 1035).
    const zine = bagWords(lang)?.zineGroups
    if (!zine || !bagWords(lang)?.noteGroups) return [...week, ...days, ...helpers, ...bookmark, ...spark, ...limitBlocks(d, w, lang)]
    return [
      ...groupBlocks(zine.week, { on: true, face: '#D97757', mark: 'level' }, [...week, ...days, ...helpers, ...spark, ...limitBlocks(d, w, lang), ...shelfBlocks(d, w, lang)]),
      ...groupBlocks(zine.issues, { on: true, face: '#F4ECE4', mark: 'num', n: d.week?.issues?.[0]?.n ?? 1 }, (d.week?.issues ?? []).map(line => ({ t: 'issue' as const, line }))),
      ...groupBlocks(zine.extras, { on: true, face: '#B9B2AC', mark: 'note' }, readingBlocks(d, w, lang)),
    ]
  }

  if (page === 'library') {
    // Step 2 (settings_drafts.py body_notes): where you stopped last, from the bookmark; the shelf and the seven short
    // reads stand on the zine page then.
    const notes = bagWords(lang)?.noteGroups
    if (notes && bagWords(lang)?.zineGroups) {
      const stop: Block[] = reminderSettings(d.store).bookmark && d.bookmark ? [{ t: 'row', label: d.bookmark.where, help: momentText(d.bookmark.at, d.now, lang, d.timeZone) }] : []
      return groupBlocks(notes.lastStop, { on: true, face: '#B9B2AC', mark: 'note' }, stop)
    }
    // His shelf opens the page: the five files Claude opened most here, as a plain numbered list, names only.
    const shelved = shelfBlocks(d, w, lang)
    return [...shelved, ...readingBlocks(d, w, lang, shelved.length > 0)]
  }

  // settings
  const s = w.settings
  const reminders = reminderSettings(d.store)
  const switches = { on: s.companion.on, off: s.companion.off }
  const remote = surface === 'vscode' || surface === 'mobile'
  const choice = (label: string, setting: string, current: string, options: Record<string, string>, help = '', local?: true, shown?: string): Block => ({
    t: 'choice',
    label,
    current,
    now: fill(s.now, { value: shown ?? options[current] ?? current }),
    options: (setting === 'budget' ? ['off', '50', '80', '90'].map(key => [key, options[key]!] as const) : Object.entries(options)).map(([value, text]) => ({ value, label: text, key: `coco:set:${setting}:${value}` })),
    help,
    ...(local ? { local } : {}),
  })
  // Keeping the cache warm (the thermos). The first «on» asks once in place with this chat's numbers, «not now» or
  // «turn it on» (COST-CACHE 4.2); while on, today's tally under it; turned off by itself, why (4.7).
  const warmChoice = (cost: CostSurfaceSnapshot | undefined): Block[] => {
    const label = costWord(lang, 'more.warm.label')
    if (surface === 'mobile' || !cost || !label) return []
    // Where the screen lock cannot be read it stops after 30 minutes, which the question's own two hours do not say.
    const noLock = cost.warmNoLock ? costWord(lang, 'more.warm.helpNoLock') : ''
    const help = [costWord(lang, 'more.warm.help'), costWord(lang, 'more.warm.cost'), noLock, cost.warmEnabled ? warmTodayLine(cost, lang) : warmHeldOffLine(cost, lang)].filter(Boolean).join('\n')
    if (cost.warmAsking) return [choice(label, 'warm', 'on', { no: moreWord('ask.no', lang), on: moreWord('ask.yes', lang) }, warmAskLine(cost, lang) ? [warmAskLine(cost, lang), noLock].filter(Boolean).join('\n') : help, undefined, switches.off)]
    return [choice(label, 'warm', cost.warmEnabled ? 'on' : 'off', cost.warmEnabled || cost.warmAsked ? switches : { ask: switches.on, off: switches.off }, help)]
  }
  const picked = LANGS.find(l => l.code === d.store.lang)?.code
  // The applied view first: choices publish their reaction before waiting on persistence.
  const now = (key: 'voice' | 'affection' | 'band', fallback: string) => String(d.view?.[key] ?? d.store[key] ?? fallback)
  // Marks use their stored choice, then the value the transcript holds.
  const stored = d.store.marks
  const marks: Marks = stored === 'off' || stored === 'replies' || stored === 'on' ? stored : d.marks
  const reading = LANGS.find(l => l.code === d.view?.lang)?.native ?? 'English'
  // Every row once; their itabag's switches page puts them in lane B's groups (step 2, settings_drafts.py body_switches),
  // and until the bag's names are read the page keeps the book's order.
  const bag = bagWords(lang), tag = (kinds: readonly BagTag[]) => bag?.tags ? { tags: kinds.map(k => bag.tags![k]) } : {}
  const row = {
    voice: [
      { ...choice(s.voice.label, 'voice', now('voice', 'off'), { off: s.voice.off, light: s.voice.light, full: s.voice.full }, [gapWord(lang,'settings.voice.help'),voiceCacheCost(d.cost??d.view?.cost,lang)].filter(Boolean).join('\n')), ...tag(['tokens', 'off']) } as Block,
      ...(d.voiceSize!==undefined?[{t:'para' as const,text:moreFill(moreWord('settings.voice.size',lang),{n:d.voiceSize})}]:[]),
    ],
    affection: [choice(s.affection.label, 'affection', now('affection', 'warm'), { warm: s.affection.warm, clingy: s.affection.clingy })],
    // the desktop band is always the painted one at full size (owner 10-19), so only the terminal offers its shapes
    band: remote || surface === 'desktop' ? [] : [choice(s.band.label, 'band', now('band', 'on'), { on: s.band.on, compact: s.band.compact, ...(surface === 'terminal' ? {text:gapWord(lang,'settings.band.text')} : {}), off: s.band.off })],
    marks: [choice(s.marks.label, 'marks', surface === 'terminal' && marks === 'on' ? 'replies' : marks, surface === 'terminal' ? {replies:s.marks.replies,off:s.marks.off} : { on:s.marks.on,replies:s.marks.replies,off:s.marks.off }, gapWord(lang,'settings.marks.help'),true)],
    visitors: visitorWord(lang, 'settings.visitors.label') ? [choice(visitorWord(lang, 'settings.visitors.label'), 'visitors', visitorsOn(d.store) ? 'on' : 'off', switches, visitorWord(lang, 'settings.visitors.help'))] : [],
    // Each language by its own name, so anyone finds theirs whatever the page is in.
    lang: [{ ...choice(
      s.language.label,
      'lang',
      picked ?? 'auto',
      Object.fromEntries([['auto', s.language.auto], ...LANGS.map(l => [l.code, l.native])]),
      '',
      undefined,
      picked ? undefined : fill(s.language.autoNow, { auto: s.language.auto, language: reading }),
    ), ...(remote && !d.languages ? { options: [{ value: 'open', key: 'coco:set:lang:open', label: s.language.choose }] } : {}) } as Block],
    motion: !remote && d.reducedMotion ? [{ t: 'fact' as const, label: s.motion.label, text: s.motion.still }] : [],
    breathe: remote ? [] : breatheBlocks(choice, reminders.breathe, switches, lang),
    guard: [choice(s.guard.label, 'guard', reminders.guard ? 'on' : 'off', switches, s.guard.help)],
    bookmark: [choice(s.bookmark.label, 'bookmark', reminders.bookmark ? 'on' : 'off', switches, s.bookmark.help)],
    week: weekWord(lang,'week.setting') ? [choice(weekWord(lang,'week.setting'), 'week', reminders.week ? 'on' : 'off', switches, weekWord(lang,'week.setting.help'))] : [],
    notes: [choice(s.notes.label, 'notes', reminders.notes ? 'on' : 'off', switches, s.notes.help)],
    budget: (d.usage?.rateLimits ?? []).some(limit => hasNumber(limit.percentUsed)) ? [{ ...choice(s.budget.label, 'budget', String(reminders.budget), { off: s.budget.off, 50: percentText(50, lang), 80: percentText(80, lang), 90: percentText(90, lang) }), ...tag(['off']) } as Block] : [],
    // Keeping the cache warm (lane C, 10-14): it re-reads the chat while you are away and uses your plan, so it says so.
    warm: warmChoice(d.cost ?? d.view?.cost).map(b => ({ ...b, ...tag(['tokens', 'off', 'new']) }) as Block),
    waitSound: surface !== 'mobile' && d.platform === 'darwin' ? [{ ...choice(gapWord(lang,'settings.sound.label'), 'waitSound', d.store.waitSound === true ? 'on' : 'off', {off:moreWord('cap.off',lang),on:moreWord('on',lang)}, gapWord(lang,'sound.help')), ...tag(['mac', 'off']) } as Block] : [],
    longTask: [
      choice(d1Word(lang,'settings.longTask.label'), 'longtask', surface==='mobile' && reminders.longTask!=='off' ? 'band' : reminders.longTask === 'notify' && !d.d1NotifyAvailable ? 'band' : reminders.longTask, surface === 'mobile' ? {off:switches.off,band:switches.on} : {off:switches.off,band:d1Word(lang,'settings.longTask.band'),...(d.d1NotifyAvailable ? {notify:d1Word(lang,'settings.longTask.notify')} : {})}, d1Word(lang,'settings.longTask.help')),
      ...(d.d1NotificationDenied && d.d1NotifyAvailable && surface!=='mobile' && reminders.longTask!=='off' ? [{t:'para' as const,text:d1Word(lang,'settings.longTask.denied')},{t:'button' as const,key:'coco:longtask:settings',label:d1Word(lang,'settings.longTask.openSettings')}] : []),
    ],
    trim: [{ ...choice(d1Word(lang,'settings.trim.label'),'trim',reminders.trim ? 'on' : 'off',switches,d1Word(lang,'settings.trim.help')), ...tag(['off']) } as Block],
    // their desktop companion stands here until their page has lane B's group for it
    companion: surface !== 'mobile' && d.companion && !bagWords(lang)?.himGroups ? [{ t: 'companion' as const, data: d.companion }] : [],
    neighbours: surface !== 'mobile' && d.platform === 'darwin' ? [{ ...choice(s.neighbours.label, 'neighbours', reminders.neighbours ? 'on' : 'off', switches, s.neighbours.help), ...tag(['mac', 'off']) } as Block] : [],
    icon: remote || d.iconSupported === false ? [] : [{ t: 'icon' as const, data: d.icon ?? { state: 'unknown' as const, unavailable: true, failed: false } }],
    more: d.more ? [{t:'more' as const,data:d.more}] : [],
  } satisfies Record<string, Block[]>
  const top: Block[] = d.check?.placement === 'top' ? [{ t: 'check' as const, data: d.check }] : []
  const end: Block[] = d.check?.placement === 'end' ? [{ t: 'fact' as const, label: d.check.title, text: d.check.ok }] : []
  const groups = bag?.groups
  if (!groups) return [
    ...top,
    ...row.voice, ...row.affection, ...row.band, ...row.marks, ...row.visitors, ...row.lang, ...row.motion, ...row.breathe,
    { t: 'heading', text: s.reminders, marginTop: 1 },
    ...row.guard, ...row.bookmark, ...row.week, ...row.notes, ...row.budget, ...row.warm, ...row.waitSound, ...row.longTask,
    {t:'heading' as const,text:d1Word(lang,'settings.saving'),marginTop:1},
    ...row.trim, ...row.companion, ...row.neighbours, ...row.icon, ...row.more,
    ...end,
  ]
  // A group's badge says what kind of switch it holds; a group with nothing on this surface is left out.
  const group = (name: BagGroup, badge: BagBadge, rows: readonly Block[]): Block[] => groupBlocks(groups[name], badge, rows)
  // The More page's rows stand in the groups by what they do (settings_drafts.py body_switches).
  // Who pays for Talk draws under it here as on the More page, which has no entry on this page any more (lane A, 10-15).
  const more = (id: MoreId, kinds: readonly BagTag[]): Block[] => d.more && moreRowDrawn(id, d.more) ? [{ t: 'moreRow', id, data: d.more, ...tag(kinds), ...(id === 'talk' ? { payer: true as const } : {}) }] : []
  return [
    ...top,
    ...group('voice', { on: true, face: '#3A86C8' }, [...row.voice, ...row.affection, ...more('plain', ['tokens', 'off']), ...more('explain', ['tokens', 'off']), ...more('look', ['tokens', 'off', 'new']), ...more('lines', ['tokens', 'off', 'new']), ...more('talk', ['tokens', 'off'])]),
    ...group('band', { on: true, face: '#3A86C8' }, [...row.band, ...row.marks, ...row.visitors, ...row.motion, ...row.breathe, ...more('lively', ['off'])]),
    ...group('reminders', { on: true, face: '#D97757' }, [...row.guard, ...row.notes, ...row.budget, ...row.longTask, ...row.waitSound, ...more('paste', ['off'])]),
    ...group('cost', { on: true, face: '#D97757', mark: 'level' }, [...more('cap', ['off']), ...row.warm]),
    ...group('records', { on: true, face: '#B9B2AC', mark: 'note' }, [...row.bookmark, ...row.week, ...row.trim]),
    ...group('neighbours', { on: true, face: '#B9B2AC' }, [...row.neighbours, ...row.icon]),
    ...group('language', { on: true, face: '#D97757' }, row.lang),
    ...row.companion,
    ...end,
  ]
}

// Token counts: grouped digits below ten thousand (1,102), compact above (12K), as the other pages write them.
function compactGrouped(n: number, lang: string): string {
  return n < 10_000 ? numberText(n, lang, false, true) : new Intl.NumberFormat(numberLocale(lang), { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

// One stick on the first page: lit by a press, or by `/coco focus`.
function stickBlocks(d: BookData, w: BookWords): Block[] {
  const k = w.stick
  const stick = d.view?.play?.stick, burning = stick !== undefined && stick.endedAt === undefined
  return [
    { t: 'heading', text: k.title, marginTop: 1 },
    { t: 'para', text: burning ? fill(k.until, { time: stick.until }) : k.help },
    burning ? { t: 'button', key: 'coco:stick:out', label: k.out } : { t: 'button', key: 'coco:stick:light', label: k.light, primary: true },
    ...(d.platform === 'darwin' ? [stickEndChoice(d, w)] : []),
  ]
}

// How the stick ends: quietly, or with a soft sound, which only a Mac can play.
function stickEndChoice(d: BookData, w: BookWords): Block {
  const k = w.stick, current = reminderSettings(d.store).stickEnd, shown = current === 'sound' ? k.endSound : k.endQuiet
  return {
    t: 'choice', label: k.endLabel, current,
    now: fill(w.settings.now, { value: shown }),
    options: [{ value: 'quiet', label: k.endQuiet, key: 'coco:set:stickEnd:quiet' }, { value: 'sound', label: k.endSound, key: 'coco:set:stickEnd:sound' }],
    help: '',
  }
}

// When a window ran out and when Claude Code carried on, from the book's own record (no tokens).
function limitBlocks(d: BookData, w: BookWords, lang: string): Block[] {
  const rows: Block[] = []
  for (const row of limitRecords(d.store.limitLog)) {
    const window = w.offerings.kinds[row.window] ?? row.window
    const text = row.kind === 'out'
      ? playWord(lang, 'log.limitOut', { window })
      : playWord(lang, 'log.carried', { window, minutes: durationText(row.minutes * 60, lang, w.durations), p: row.percent === null ? '—' : percentText(row.percent, lang) })
    if (text) rows.push({ t: 'fact', label: momentText(row.at, d.now, lang, d.timeZone), text })
  }
  return rows.slice(-6)
}

// Breathing with the incense is on until turned off; its row sits on the main page and costs no tokens.
function breatheBlocks(choice: (label: string, setting: string, current: string, options: Record<string, string>, help?: string) => Block, on: boolean, switches: Record<string, string>, lang: string): Block[] {
  const label = playWord(lang, 'settings.breathe.label')
  if (!label) return []
  const cost = playWord(lang, 'settings.breathe.cost'), help = playWord(lang, 'settings.breathe.help')
  return [choice(label, 'breathe', on ? 'on' : 'off', switches, cost), ...(help ? [{ t: 'note' as const, text: help }] : [])]
}

export function helperBoard(d:BookData,w:BookWords):Block[] {
  const snapshot=d.d1,lang=d.view?.lang??'en'
  if(!snapshot || (!snapshot.helpers.length && !snapshot.earlier.count))return []
  const total=(h:Helper)=>h.engineTotals?.tokens??h.tokens
  const summed=snapshot.helpers.reduce((n,h)=>n+total(h),snapshot.earlier.tokens)
  const n=snapshot.helpers.length+snapshot.earlier.count
  const p=snapshot.totalTokens>0?Math.round(summed/snapshot.totalTokens*100):undefined
  const blocks:Block[]=[{t:'heading',text:d1Word(lang,'helpers.title')},...(p===undefined?[]:[{t:'para' as const,text:d1Word(lang,'helpers.summary',{n:numberText(n,lang),p:numberText(p,lang)},n)}])]
  const sorted=[...snapshot.helpers].sort((a,b)=>b.startedAt-a.startedAt || a.agentId.localeCompare(b.agentId))
  // Parents precede their descendants; at most six rows reach the page.
  const ordered:Helper[]=[],seen=new Set<string>()
  const add=(h:Helper)=>{if(seen.has(h.agentId))return;seen.add(h.agentId);ordered.push(h);for(const child of sorted.filter(c=>c.parentAgentId===h.agentId))add(child)}
  for(const h of sorted.filter(h=>!h.parentAgentId || !sorted.some(p=>p.agentId===h.parentAgentId)))add(h)
  for(const h of sorted)add(h)
  for(const h of ordered.slice(0,6)){
    const running=h.state==='running',tools=h.engineTotals?.toolUses??h.toolUses
    const ms=h.engineTotals?.durationMs??Math.max(0,(h.endedAt??d.now)-h.startedAt)
    const duration=durationText(ms/1000,lang,w.durations)
    const tokens=compactGrouped(total(h),lang)
    const toolText=d1Word(lang,'helpers.toolUses',{n:numberText(tools,lang)},tools)
    const row=(key:string,extra:Record<string,string>={})=>d1Word(lang,key,{type:h.type,tokens:d1Word(lang,'helpers.tokens',{tokens}),duration,tools:toolText,...extra})
    const text=running?d1Word(lang,'helpers.runningStatus',{elapsed:duration}):h.state==='failed'||h.state==='stopped'?row('helpers.finishedStatusState',{state:d1Word(lang,`helpers.${h.state}`)}):row('helpers.finishedStatus')
    blocks.push({t:'helper',description:h.description,text,nested:!!h.parentAgentId,state:h.state})
  }
  const earlier=ordered.slice(6),count=snapshot.earlier.count+earlier.length
  if(count)blocks.push({t:'para',text:d1Word(lang,'helpers.earlier',{n:numberText(count,lang),tokens:compactGrouped(snapshot.earlier.tokens+earlier.reduce((n,h)=>n+total(h),0),lang)},count)})
  return blocks
}

// A line saying what Coco does only where the page's still shows it (owner 10-17: 「这种动作没有实际发生，别写了」, then
// 「跟静图对不上的删」): lane B's words keep the lines for Coco's page, the sticky notes (the peek) and the switches.
function direction(page: Page, w: BookWords, d: BookData): string {
  if(page==='him'&&d.visitors)return d.visitors.direction
  if(page==='him')return d1Word(d.view?.lang??'en','direction.room').replace(/\*/g,'')
  const text = w.direction[page] ?? ''
  return text.replace(/\*([^*\n]+)\*/g, '$1')
}

function titleOf(page: Page, w: BookWords, d: BookData): string {
  if (page === 'him' && d.visitors) return d.visitors.title
  return page === 'him' ? d.own.name : bagPageName(d.view?.lang ?? 'en', page) ?? w.title[page] ?? w.tabs[page] ?? ''
}

function plain(text: string): string {
  return text.replace(/^[（(]|[）)]$/g, '')
}

// ---------------------------------------------------------------- layout both surfaces share

const MEASURE = 72 // columns: the body never runs wider, so a line of text stays readable on a wide pane
const BUTTON_PAD = 22 // a desktop Button's horizontal padding and border, as band.tsx counts it
const GRID_FROM = 48 // columns: from here labels stand in their own column

// A person who chose the pixel band (the compact choice on the desktop) gets his room in the book; a painted one keeps
// the painted portrait (the owner's answer of 10-09).
function pixelBand(view: CocoView | undefined): boolean {
  return (view?.band === 'off' ? view.bandBeforeOff : view?.band) === 'compact'
}
// The label column is as wide as the page's longest label, between 8 and 18 columns.
function labelColumn(blocks: readonly Block[]): number {
  const longest = Math.max(0, ...blocks.flatMap(b => b.t === 'fact' || b.t === 'choice' ? [cells(b.label)] : []))
  return Math.min(18, Math.max(8, longest + 1))
}
// Blank rows above a block: two above a heading and above every choice, none under a heading, one between the rest on
// the desktop (the terminal keeps its rows tight) (BOOK F5, F9).
function gapAbove(b: Block, previous: Block | undefined, desktop: boolean): number {
  if (!previous || previous.t === 'heading') return 0
  if (b.t === 'choice' || b.t === 'moreRow') return 2
  if (b.t === 'heading') return desktop ? 2 : 1
  return desktop ? 1 : 0
}
// His page's head: the stage direction in italics where the script has them, his own words upright (BOOK F11).
function himDirection(lang: string): { aside: string; gap: string; said: string } {
  const raw = d1Word(lang, 'direction.room').replace(/\*/g, '')
  const parts = /^([（(][^）)]*[）)])(\s*)([\s\S]*)$/.exec(raw)
  return parts ? { aside: parts[1]!, gap: parts[2]!, said: parts[3]! } : { aside: raw, gap: '', said: '' }
}

// A grey hairline under a group's title.
function ruleSvg(width: number): string {
  return contrastSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 7" width="${width}" height="7"><style>path{stroke:#8C877E}@media(prefers-color-scheme:dark){path{stroke:#8E8B85}}</style><path d="M0 4.5h${width}" fill="none" stroke-width="1"/></svg>`, 'path{stroke:#8E8481}', 'path{stroke:#9A918C}')
}

// A group's rule on their itabag's pages: the same hairline with a coral notch at its start, leaning on the bag's 30 degree
// line (settings_drafts.py rule).
// The notch is a polygon, so the hairline's stroke rule leaves it alone.
function groupRuleSvg(width: number): string {
  return contrastSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 7" width="${width}" height="7"><style>path{stroke:#8C877E}@media(prefers-color-scheme:dark){path{stroke:#8E8B85}}</style><path d="M0 4.5h${width}" fill="none" stroke-width="1"/><polygon points="0,7 3.5,1 21.5,1 18,7" fill="#D97757"/></svg>`, 'path{stroke:#8E8481}', 'path{stroke:#9A918C}')
}
// The small marks after a label (uses tokens, off by default, Mac only, new), in the language's own list.
function tagLine(tags: readonly string[], lang: string): string {
  return tags.join(lang === 'zh' || lang === 'zh-Hant' || lang === 'ja' ? '、' : ', ')
}

// ---------------------------------------------------------------- their itabag's head (lane C, 10-14)

// One badge a switch on the settings page, face up where it is on (the language picker is not a switch).
function bagSwitches(w: BookWords, d: BookData, surface: 'desktop' | 'terminal' | 'vscode' | 'mobile'): boolean[] {
  return switchStates(pageBody('settings', w, { ...d, store: d.switches ?? d.store }, surface))
}
// The open warm question is still off.
function switchStates(blocks: readonly Block[]): boolean[] {
  return blocks.flatMap(b => b.t === 'moreRow' ? [moreOn(b.data.snapshot.values, b.id) && moreRowAuthored(b.id, b.data.snapshot.lang)] : b.t === 'choice' && !b.options.some(o => o.key.startsWith('coco:set:lang:')) ? [b.current !== 'off' && b.current !== 'false' && !b.options.some(o => o.key === 'coco:set:warm:no')] : [])
}
// The cells left in each window, as the band counts them.
function bagQuota(d: BookData): BagQuota {
  const limits = d.usage?.rateLimits ?? d.view?.quota?.rateLimits ?? []
  const cells = (kind: string) => { const limit = limits.find(l => l.kind === kind); return limit && hasNumber(limit.percentUsed) ? quotaCellsLeft(limit.percentUsed) : undefined }
  const five = cells('five_hour'), week = cells('seven_day')
  return { ...(five === undefined ? {} : { five }), ...(week === undefined ? {} : { week }) }
}
const SVG_MAX = 131_072 // an Svg's source, in characters (2.1.299's SvgProps)
// The art and what a screen reader hears for it, one picture a page (the alt lines are lane B's, one a page): the quota page
// hangs the two charms on the bag; vibe check shows this session's failed tests, fixed ones and compactions; the sock
// drawer a badge a pair; the doujin its latest issues; the sticky notes one note each; their page the pet's switches and
// sizes; the switches page its switches.
function bagHead(w: BookWords, d: BookData, page: Page, surface: 'desktop' | 'vscode' | 'mobile', width: number): { source: string; alt: string; width: number; height: number } | undefined {
  const lang = d.view?.lang ?? 'en', bag = bagWords(lang)
  if (!bag) return undefined
  // The MV style draws the same reading its own way, with the same words for a screen reader (lane A 10-17).
  const mv = bagStyleOf(d) === 'mv'
  // The desktop takes a picture of at most 131072 characters and refuses the whole page for a larger one (his empty bag,
  // 10-18), so a drawing past it goes without her peek.
  const art = (badges: readonly (boolean | BagBadge)[], alt: string, reading: MvReading, quota?: BagQuota, rows?: readonly number[]) => {
    const draw = (peek?: BagPeek) => mv ? bagMvSvg(width, reading, peek) : bagArtSvg(width, badges, quota, rows, peek)
    const source = draw(d.bagPeek)
    return { source: source.length <= SVG_MAX ? source : draw(undefined), alt, width, height: mv ? bagMvHeight(width) : bagArtHeight(width) }
  }
  const quota = bagQuota(d)
  const quotaRead = quota.five !== undefined || quota.week !== undefined
  // the MV picture draws the quota page even before a reading, its cells outlined; then it is only the bag's name
  if (page === 'offerings' && mv && !quotaRead) return art([], bag.title, { page })
  if (page === 'offerings' && quotaRead && (mv || width > 400))
    return art(bagSwitches(w, d, surface), bagFill(bag.alt[1]!, { five: quota.five ?? 0, week: quota.week ?? 0, total: 4 }), { page, ...quota }, quota)
  if (page === 'omen') {
    const vibe = { failed: d.vibe?.failed ?? 0, fixed: d.vibe?.fixed ?? 0, compacted: d.vibe?.compacted ?? 0 }
    return art(vibeBadges(vibe), bagFill(bag.alt[2]!, vibe), { page, ...vibe, rarity: vibeRarity({ ...vibe, ...(d.vibe ?? {}) }) })
  }
  // every pair is theirs until the owner says which first earns which (lanes/C.md, 等他回来问的)
  if (page === 'socks') { const open = d.drawer?.open ?? SOCK_PAIRS; return art(sockBadges(open), bagFill(bag.alt[3]!, { total: SOCK_PAIRS.length, have: open.length }), { page, worn: d.socks ?? 'honmei', have: open.length, all: SOCK_PAIRS.length }) }
  if (page === 'library') { const notes = d.bookmark ? 1 : 0; return art(noteBadges(notes), bagFill(bag.alt[5]!, { notes }), { page, notes }) }
  // the doujin: its latest issues, the newest coral; before the first issue only the bag
  if (page === 'log') {
    const badges = issueBadges(d.issues ?? []), n = badges.length, reading: MvReading = { page, issues: d.issues ?? [] }
    if (!d.issues?.length) return art([], bag.title, reading)
    return art(badges, bagFill(bag.alt[4]!, { issues: number(d.issues.length, lang), latest: number(d.issues.at(-1)!, lang) }), reading, undefined, n <= 4 ? [n] : [Math.ceil(n / 2), Math.floor(n / 2)])
  }
  // their page (settings_drafts.py her_states): on the desk, following the app, opening at login over the three sizes
  // (read on a Mac; elsewhere, and on a phone, the book has no pet to read yet, so only the bag)
  if (page === 'him') {
    const c = d.companion
    if (!c) return art([], bag.title, { page, switches: [false, false, false] })
    const there = c.folder && c.app, size = Math.max(0, MAC_SIZES.indexOf(c.info.size ?? 'medium'))
    const switches = [there && c.info.running === true, there && c.state === 'following', there && c.login]
    return art(petBadges(switches, size), bagFill(bag.alt[0]!, { on: switches.filter(Boolean).length, total: switches.length, size: w.settings.companion.macSizes[size] ?? '' }), { page, switches, size }, undefined, [switches.length, 3])
  }
  const switches = bagSwitches(w, d, surface)
  return art(switches, bagFill(bag.alt[6]!, { total: switches.length, on: switches.filter(Boolean).length }), { page: 'settings', switches })
}

// The skill cards' own pane, also `/coco cards`, opens from the very top of the bag on every page (owner 10-19,
// DECISIONS 1039): one native button holding the pane's name, at title size off the terminal, and how many cards the
// deck holds, so the words and the ground under them are one place to press.
function cardsOpen(ui: Elements[keyof Elements], lang: string, cards: number | undefined, terminal: boolean): RenderElement {
  const { Box, Text, Button } = ui as Elements['desktop']
  const s = CARD_WORDS[cardLang(lang)]
  return <Box flexDirection="row" marginBottom={1}>
    <Button key="coco:cards:open" label={s.title} onPress={() => {}}>
      {terminal ? <Text bold>{s.title}</Text> : <Text size="title">{s.title}</Text>}
      {cards === undefined ? null : <Text dimColor>{'  ' + s.count(cards)}</Text>}
    </Button>
  </Box>
}

// ---------------------------------------------------------------- desktop

// `portrait` is the page's picture of them as SVG source, drawn `height` px tall (and `width` wide, when it says).
export function desktopBook(
  ui: Elements['desktop'] | Elements['vscode'] | Elements['mobile'],
  w: BookWords,
  book: CocoBook,
  d: BookData,
  portrait: { source: string; height: number; width?: number },
  press: Press,
  columns: number,
  surface: 'desktop' | 'vscode' | 'mobile' = 'desktop',
): RenderElement {
  const { Box, Text, Button, Svg, Link } = ui
  const page = book.page
  const lang = d.view?.lang ?? 'en'
  const blocks = pageBlocks(page, w, { ...d, languages: book.languages === true }, surface)
  const pixel = surface === 'desktop' && pixelBand(d.view)
  const slant = !NO_ITALIC.has(lang)
  const aside = (text: string) => slant && oneLine(text, columns)
  const noop = () => {}
  const grid = columns >= GRID_FROM
  const measure = Math.min(columns, MEASURE)
  const labelW = labelColumn(blocks)
  const ruleW = Math.max(40, Math.min(560, Math.floor(measure * COLUMN_PX) - 4))
  const colon = lang === 'zh' || lang === 'zh-Hant' || lang === 'ja' ? ':' : '  '

  const block = (b: Block): RenderElement | null => {
    switch (b.t) {
      case 'window-notes': return b.element
      case 'more': return MoreEntry(ui,b.data)
      case 'moreRow': return MoreRow(ui, b.data, b.id, b.tags?.length ? tagLine(b.tags, lang) : undefined, b.payer === true)
      case 'link': return <Box flexDirection="column"><Text color="inactive">{b.text}</Text><Link href={b.href}/></Box>
      case 'cup':
        return <Box flexDirection="row" alignItems="center"><Svg source={cupSvg(b.state,19,26)} alt={b.alt} width={19} height={26}/><Box marginLeft={1} flexShrink={1} minWidth={0}><Text wrap="wrap">{b.text}</Text></Box></Box>
      case 'week':
        return weekSection(ui, b.data, { terminal: false })
      case 'issue':
        return issueLine(ui, b.line, false)
      case 'check':
        return <Box flexDirection="column" borderStyle="round" borderColor="inactive" paddingX={1} rowGap={1}>
          <Text bold>{b.data.title}</Text>
          {b.data.rows.map(row => <Box flexDirection="row" columnGap={1} alignItems="center">
            <Box flexGrow={1} flexShrink={1} minWidth={0}><Text wrap="wrap"><Text bold>{row.subject}</Text>{'  '}{row.state}</Text>{row.after ? <Text italic={slant} wrap="wrap">{row.after}</Text> : null}</Box>
            {row.fix ? <Button key={`coco:check:${row.id}`} label={w.check.fix} onPress={row.fix === 'bandOn' ? noop : () => press.check?.(row)} /> : null}
          </Box>)}
        </Box>
      case 'helper':
        return <Box flexDirection="row" columnGap={1} marginLeft={b.nested?2:0}><Box width={3} flexShrink={0}><Svg source={b.state==='running'?scrollSvg().replace('viewBox="0 0 12 18"','viewBox="0 0 9 18"').replace('width="12"','width="9"'):lyingScrollSvg(b.state==='failed'||b.state==='stopped')} alt="" width={b.state==='running'?9:18} height={b.state==='running'?18:9}/></Box><Box flexDirection="column" flexShrink={1} minWidth={0}><Text bold wrap="wrap">{b.description}</Text><Text wrap="wrap">{b.text}</Text></Box></Box>
      case 'heading':
        return b.badge
          ? <Box flexDirection="column"><Box flexDirection="row" columnGap={1} alignItems="center"><Svg source={bagBadgeSvg(b.badge)} alt="" width={18} height={18} /><Box flexShrink={1} minWidth={0}><Text bold wrap="wrap">{b.text}</Text></Box></Box><Svg source={groupRuleSvg(ruleW)} alt="" width={ruleW} height={7} /></Box>
          : <Box flexDirection="column"><Text bold wrap="wrap">{b.text}</Text><Svg source={ruleSvg(ruleW)} alt="" width={ruleW} height={7} /></Box>
      case 'para':
        return <Text wrap="wrap">{b.text}</Text>
      case 'lead':
        return <Text bold wrap="wrap">{b.text}</Text>
      case 'row':
        return <Box flexDirection="column"><Text bold wrap="wrap">{b.label}</Text>{b.help ? <Text color="inactive" wrap="wrap">{b.help}</Text> : null}</Box>
      case 'note':
        return <Text italic={b.value ? false : aside(b.text)} wrap="wrap">{b.value ? [b.text.split(b.value)[0]??'',<Text bold>{b.value}</Text>,b.text.split(b.value)[1]??''] : b.text}</Text>
      case 'fact':
        return grid
          ? <Box flexDirection="row" columnGap={2}><Box width={labelW} flexShrink={0}><Text bold wrap="wrap">{b.label}</Text></Box><Box flexGrow={1} flexShrink={1} minWidth={0}><Text wrap="wrap">{b.text}</Text></Box></Box>
          : <Text wrap="wrap"><Text bold>{b.label}</Text>{`${colon}${b.text}`}</Text>
      case 'incense': {
        // their battery (5 hours) or power bank (the week and the rest), as the band draws them (lane C, 10-14)
        const left = b.out ? 0 : Math.max(0, 100 - b.percent), battery = b.kind === 'five_hour'
        return <Box flexDirection="row" alignItems="center"><Svg alt={b.alt} source={quotaPixelSvg(battery ? quotaBatteryRows(left, left <= 0) : quotaBankRows(left, left <= 0))} width={battery ? 52 : 44} height={24} /><Box marginLeft={1} flexShrink={1}><Text wrap="wrap"><Text bold>{b.label}</Text>{`${colon}${b.text}`}</Text></Box></Box>
      }
      case 'meter':
        return <Svg alt={b.alt} source={meterSvg(b.percent)} width={168} height={8} />
      case 'trend': {
        const width = Math.max(160, Math.min(520, Math.floor(measure * COLUMN_PX)))
        return <Svg alt={b.alt} source={quotaTrendSvg(b.trend, width)} width={width} height={96} />
      }
      case 'box':
        return (
          <Box flexDirection="row" alignItems="center">
            {b.percent === null ? null : <Svg alt={b.alt} source={commitLineSvg(commitCount(b.percent), undefined, false, 2, surface === 'vscode' || surface === 'mobile')} width={commitLineWidth(commitCount(b.percent), false, undefined, 2)} height={commitLineHeight(2)} />}
            <Box flexDirection="column" marginLeft={b.percent === null ? 0 : 1} flexShrink={1}>
              <Text bold={b.percent !== null} wrap="wrap">{b.title}</Text>
              {b.detail ? <Text wrap="wrap">{b.detail}</Text> : null}
            </Box>
          </Box>
        )
      case 'choice': {
        const buttons = <Box flexDirection="row" flexWrap="wrap" gap={1}>
          {b.options.map(o => (
            <Button
              key={o.key}
              label={o.label}
              {...(o.value === b.current ? { variant: 'primary' as const } : {})}
              onPress={b.local ? () => press.marks(o.value as Marks) : noop}
            />
          ))}
        </Box>
        const help = b.help ? <Text italic={aside(b.help)} wrap="wrap">{b.help}</Text> : null
        const tags = b.tags?.length ? <Text color="inactive" wrap="wrap">{tagLine(b.tags, lang)}</Text> : null
        // A Button never wraps, and the label column's width is only its least (it grows to its longest line, as
        // «Actuellement : Automatique (Français)» does), so the buttons stand beside it only when the widest one fits
        // what is left; otherwise the label goes above them («Español (Latinoamérica)» at 52 columns).
        const labelPx = Math.max(labelW * COLUMN_PX, planPx(b.label, true), planPx(b.now), b.tags?.length ? planPx(tagLine(b.tags, lang)) : 0)
        const beside = grid && labelPx + 2 * COLUMN_PX + Math.max(...b.options.map(o => planPx(o.label, o.value === b.current) + BUTTON_PAD)) <= measure * COLUMN_PX
        return beside
          ? <Box flexDirection="row" columnGap={2}>
            <Box flexDirection="column" width={labelW} flexShrink={0}><Text bold wrap="wrap">{b.label}</Text><Text color="inactive" wrap="wrap">{nowFit(b.now, labelW)}</Text>{tags}</Box>
            <Box flexDirection="column" rowGap={1} flexGrow={1} flexShrink={1} minWidth={0}>{buttons}{help}</Box>
          </Box>
          : <Box flexDirection="column" rowGap={1}>
            <Box flexDirection="column"><Text bold wrap="wrap">{b.label}</Text><Text color="inactive" wrap="wrap">{nowFit(b.now, measure)}</Text>{tags}</Box>
            {buttons}{help}
          </Box>
      }
      case 'button':
        return (
          <Box flexDirection="row">
            <Button key={b.key} label={b.label} {...(b.primary ? { variant: 'primary' as const } : {})} onPress={b.key==='coco:cache:how'?()=>press.costHow?.():noop} />
          </Box>
        )
      case 'icon':
        return surface === 'desktop' ? iconSection(ui as Elements['desktop'], w.settings.icon, b.data, action => press.icon?.(action), slant, columns) : null
      case 'companion':
        return companionSection(ui, true, w.settings.companion, w.settings.now, b.data, action => press.companion?.(action), slant, columns, moment(new Date(b.data.info.hiddenUntil ?? d.now).toISOString(), d.now, d.view?.lang ?? 'en', d.timeZone), w.settings.language, surface === 'vscode' || surface === 'mobile')
      case 'visit':
        return <Box flexDirection="row" columnGap={1} alignItems="center"><Svg source={b.portrait} alt="" width={44} height={44} /><Box flexDirection="column" flexShrink={1}><Text color="inactive" wrap="wrap">{b.when}</Text><Text bold wrap="wrap">{b.name}</Text></Box></Box>
      case 'months':
        return <Box flexDirection="row" flexWrap="wrap" columnGap={1}>{b.previous ? <Button key="coco:visitors:previous" label={b.previous} onPress={noop} /> : null}{b.next ? <Button key="coco:visitors:next" label={b.next} onPress={noop} /> : null}</Box>
      case 'socks': {
        // the pairs they have are buttons; the rest, dim, say how they get them (name and hint apart, so no space joins
        // a Chinese or Japanese word to a Latin one)
        const locked = b.pairs.filter(pair => pair.locked !== undefined)
        return <Box flexDirection="column" rowGap={1}>
          <Box flexDirection="row" flexWrap="wrap" gap={1}>{b.pairs.filter(pair => pair.locked === undefined).map(pair => <Button key={`coco:socks:${pair.key}`} label={pair.label} {...(pair.worn ? { variant: 'primary' as const } : {})} onPress={noop} />)}</Box>
          {locked.length ? <Box flexDirection="column">{locked.map(pair => <Box flexDirection="row" flexWrap="wrap" gap={2}><Text color="inactive" bold>{pair.label}</Text>{pair.locked ? <Text color="inactive" wrap="wrap">{pair.locked}</Text> : null}</Box>)}</Box> : null}
        </Box>
      }
      case 'nav':
        return (
          <Box flexDirection="row" flexWrap="wrap" gap={1} alignItems="center">
            <Button key="coco:book:previous" label={b.previous} onPress={() => press.turn(-1)} />
            <Button key="coco:book:next" label={b.next} onPress={() => press.turn(1)} />
            <Text italic={slant}>{b.where}</Text>
          </Box>
        )
    }
    return null
  }

  const title = <Text bold wrap="wrap"><Text color="claude">{'✻ '}</Text>{titleOf(page, w, d)}</Text>
  const said = page === 'him' && !d.visitors ? himDirection(lang) : undefined
  const stage = said
    ? <Text wrap="wrap"><Text italic={slant}>{said.aside}</Text>{said.said ? `${said.gap}${said.said}` : ''}</Text>
    : direction(page, w, d) ? <Text italic={slant} wrap="wrap">{direction(page, w, d)}</Text> : null
  const head = <Box flexDirection="column">{title}{stage}</Box>
  const visitorsOpen = page === 'him' && !d.visitors && d.visitorsButton ? <Button key="coco:visitors:open" label={d.visitorsButton} onPress={noop} /> : null
  const picture = page === 'him' && d.visitors
    ? <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="row"><Button key="coco:visitors:back" label={`‹ ${bagPageName(lang, 'him') ?? w.tabs.him}`} onPress={noop} /></Box>
      <Box flexDirection="column" marginTop={1}>{head}</Box>
    </Box>
    : page === 'him' && d.roomPicture
      ? <Box flexDirection="column" marginTop={1}>
        <Svg source={d.roomPicture.source} alt={d.roomPicture.alt} width={d.roomPicture.width} height={d.roomPicture.height} />
        <Box flexDirection="row" flexWrap="wrap" columnGap={1} marginTop={1} alignItems="flex-start" justifyContent="space-between"><Box flexDirection="column" flexShrink={1}>{head}</Box>{visitorsOpen}</Box>
      </Box>
      : pixel
          ? <Box flexDirection="column" marginTop={1}>{head}{visitorsOpen}</Box>
          : <Box flexDirection="row" alignItems="center" marginTop={1}>
            {/* A portrait still being read draws nothing yet; the engine refuses an empty picture. */}
            {portrait.source ? <Svg alt={direction(page, w, d) ? `${d.own.name},${lang === 'zh' || lang === 'zh-Hant' || lang === 'ja' ? '' : ' '}${plain(direction(page, w, d))}` : d.own.name} source={portrait.source} width={portrait.width ?? desktopWidth(portrait.height)} height={portrait.height} /> : null}
            <Box flexDirection="column" marginLeft={1} flexShrink={1}>{title}{stage}{visitorsOpen}</Box>
          </Box>

  const art = bagHead(w, d, page, surface, Math.max(160, Math.min(560, Math.floor(measure * COLUMN_PX) - 4)))
  return (
    <Box flexDirection="column">
      {cardsOpen(ui, lang, d.cards, false)}
      {art ? <Box marginBottom={1}><Svg source={art.source} alt={art.alt} width={art.width} height={art.height} /></Box> : null}
      <Box flexDirection="row" flexWrap="wrap" gap={1}>
        {PAGES.flatMap((p, i) => (
          [<Button
            key={`coco:book:tab:${p}`}
            label={bagPageName(lang, p) ?? w.tabs[p] ?? ''}
            hotkey={String(i + 1)}
            {...(p === page ? { variant: 'primary' as const } : {})}
            onPress={() => press.go(p)}
          />, ...(p==='him'&&d.talkEnabled?[<Button key="coco:talk:open" label={d.talkTab??''} onPress={noop}/>]:[])]
        ))}
      </Box>
      {picture}
      <Box flexDirection="column" marginTop={1} width={measure}>
        {page==='him'?d.m1Him:null}
        {blocks.map((b, i) => {
          const node = block(b), above = gapAbove(b, blocks[i - 1], true)
          return node ? <Box {...(above ? { marginTop: above } : {})}>{node}</Box> : null
        })}
      </Box>
    </Box>
  )
}

// ---------------------------------------------------------------- terminal

const BAR = 24

function bar(percent: number): string {
  const filled = Math.max(0, Math.min(BAR, Math.round((BAR * percent) / 100)))
  return `${'█'.repeat(filled)}${'░'.repeat(BAR - filled)}`
}

export function terminalBook(ui: Elements['terminal'], w: BookWords, book: CocoBook, d: BookData, press: Press, columns: number): RenderElement {
  const { Box, Text, Button, Raster, Link } = ui
  const page = book.page
  const lang = d.view?.lang ?? 'en'
  const blocks = pageBlocks(page, w, d, 'terminal')
  const slant = !NO_ITALIC.has(lang)
  const aside = (text: string) => slant && oneLine(text, columns)
  const noop = () => {}
  const cue = d.view?.cue ?? 'claude'
  // His portrait on his page only where it leaves the title a fair line beside it.
  const portrait = page === 'him' && !d.visitors && columns >= TERMINAL_COLUMNS + 2 + 24
  const grid = columns >= GRID_FROM
  const measure = Math.min(columns, MEASURE)
  const labelW = labelColumn(blocks)
  const colon = lang === 'zh' || lang === 'zh-Hant' || lang === 'ja' ? ':' : '  '
  // A terminal Button cannot wrap: a group whose bracketed labels do not all fit the pane is drawn plain, one to a row.
  const bracketsFit = (labels: readonly string[], room: number) => labels.every(label => cells(label) + 4 <= room)
  const group = (labels: readonly string[], buttons: (plain: boolean) => RenderElement[], wrapRow = true, room = measure) => {
    const plain = !bracketsFit(labels, room)
    return plain ? <Box flexDirection="column">{buttons(true)}</Box> : <Box flexDirection="row" flexWrap={wrapRow ? 'wrap' : 'nowrap'} columnGap={1}>{buttons(false)}</Box>
  }

  const block = (b: Block): RenderElement | null => {
    switch (b.t) {
      case 'window-notes': return b.element
      case 'more': return MoreEntry(ui,b.data)
      case 'moreRow': return MoreRow(ui, b.data, b.id, b.tags?.length ? tagLine(b.tags, lang) : undefined, b.payer === true)
      case 'link': return <Box flexDirection="column"><Text color="inactive">{b.text}</Text><Link href={b.href}/></Box>
      case 'cup':
        return <Text wrap="wrap">{b.text}</Text>
      case 'week':
        return weekSection(ui, b.data, { terminal: true })
      case 'issue':
        return issueLine(ui, b.line, true)
      case 'check':
        return <Box flexDirection="column" borderStyle="round" borderColor="inactive" paddingX={1} rowGap={1}>
          <Text bold>{b.data.title}</Text>
          {b.data.rows.map(row => <Box flexDirection="row" columnGap={1} alignItems="center">
            <Box flexGrow={1} flexShrink={1} minWidth={0}><Text wrap="wrap"><Text bold>{row.subject}</Text>{'  '}{row.state}</Text>{row.after ? <Text italic={slant} wrap="wrap">{row.after}</Text> : null}</Box>
            {row.fix ? <Button key={`coco:check:${row.id}`} label={w.check.fix} onPress={row.fix === 'bandOn' ? noop : () => press.check?.(row)} /> : null}
          </Box>)}
        </Box>
      case 'helper':
        return <Box flexDirection="column" marginLeft={b.nested?2:0}><Text bold wrap="wrap">{b.description}</Text><Text wrap="wrap">{b.text}</Text></Box>
      case 'heading':
        return b.badge
          ? <Box flexDirection="column"><Text bold wrap="wrap">{b.text}</Text><Text><Text color={cue}>{'╱'}</Text><Text color="inactive">{'─'.repeat(Math.max(0, Math.min(columns, 40) - 1))}</Text></Text></Box>
          : <Box flexDirection="column"><Text bold wrap="wrap">{b.text}</Text><Text color="inactive">{'─'.repeat(Math.min(columns, 40))}</Text></Box>
      case 'para':
        return <Box {...(b.space ? { marginBottom: 1 } : {})}><Text wrap="wrap">{b.text}</Text></Box>
      case 'lead':
        return <Text bold wrap="wrap">{b.text}</Text>
      case 'row':
        return <Box flexDirection="column"><Text bold wrap="wrap">{b.label}</Text>{b.help ? <Text color="inactive" wrap="wrap">{b.help}</Text> : null}</Box>
      case 'note':
        return <Text italic={b.value ? false : aside(b.text)} wrap="wrap">{b.value ? [b.text.split(b.value)[0]??'',<Text bold>{b.value}</Text>,b.text.split(b.value)[1]??''] : b.text}</Text>
      case 'fact':
        return grid
          ? <Box flexDirection="row" columnGap={2}><Box width={labelW} flexShrink={0}><Text bold wrap="wrap">{b.label}</Text></Box><Box flexGrow={1} flexShrink={1} minWidth={0}><Text wrap="wrap">{b.text}</Text></Box></Box>
          : <Text wrap="wrap"><Text bold>{b.label}</Text>{`${colon}${b.text}`}</Text>
      case 'incense':
        return <Box flexDirection="column"><Text wrap="wrap"><Text bold>{b.label}</Text>{`${colon}${b.text}`}</Text><Text color={b.neighbour || b.out ? 'inactive' : quotaCellsLeft(b.percent) <= 1 ? cue : 'suggestion'}>{quotaMeterText(b.out ? 100 : b.percent)}</Text></Box>
      case 'meter':
        return <Text color={b.neighbour ? 'inactive' : cue}>{bar(b.percent)}</Text>
      case 'trend':
        return null // the terminal keeps the cells and the sentence (quota_page.py term_block)
      case 'box':
        return (
          <Box flexDirection="column">
            <Text bold={b.percent !== null} wrap="wrap">{`${b.percent === null ? '' : commitLineText(commitCount(b.percent)) + ' '}${b.title}`}</Text>
            {b.detail ? <Text wrap="wrap">{b.detail}</Text> : null}
          </Box>
        )
      case 'choice': {
        const buttons = group(b.options.map(o => o.label), plain => b.options.map(o => (
          <Button key={o.key} label={o.label} {...(plain ? { plain: true as const } : {})} {...(o.value === b.current ? { variant: 'primary' as const } : {})} onPress={b.local ? () => press.marks(o.value as Marks) : noop} />
        )), true, grid ? measure - labelW - 2 : measure)
        const help = b.help ? <Text italic={aside(b.help)} wrap="wrap">{b.help}</Text> : null
        const tags = b.tags?.length ? <Text color="inactive" wrap="wrap">{tagLine(b.tags, lang)}</Text> : null
        return grid
          ? <Box flexDirection="row" columnGap={2}>
            <Box flexDirection="column" width={labelW} flexShrink={0}><Text bold wrap="wrap">{b.label}</Text><Text color="inactive" wrap="wrap">{nowFit(b.now, labelW)}</Text>{tags}</Box>
            <Box flexDirection="column" rowGap={1} flexGrow={1} flexShrink={1} minWidth={0}>{buttons}{help}</Box>
          </Box>
          : <Box flexDirection="column" rowGap={1}>
            <Box flexDirection="column"><Text bold wrap="wrap">{b.label}</Text><Text color="inactive" wrap="wrap">{nowFit(b.now, measure)}</Text>{tags}</Box>
            {buttons}{help}
          </Box>
      }
      case 'button':
        return <Button key={b.key} label={b.label} {...(bracketsFit([b.label], measure) ? {} : { plain: true as const })} {...(b.primary ? { variant: 'primary' as const } : {})} onPress={b.key==='coco:cache:how'?()=>press.costHow?.():noop} />
      case 'icon':
        return iconSection(ui, w.settings.icon, b.data, action => press.icon?.(action), slant, columns)
      case 'companion':
        return companionSection(ui, false, w.settings.companion, w.settings.now, b.data, action => press.companion?.(action), slant, columns, moment(new Date(b.data.info.hiddenUntil ?? d.now).toISOString(), d.now, d.view?.lang ?? 'en', d.timeZone), w.settings.language)
      case 'visit':
        return <Box flexDirection="column"><Text wrap="wrap">{b.when}</Text><Text bold wrap="wrap">{b.name}</Text></Box>
      case 'months':
        return <Box flexDirection="row" flexWrap="wrap" columnGap={1}>{b.previous ? <Button key="coco:visitors:previous" label={b.previous} onPress={noop} /> : null}{b.next ? <Button key="coco:visitors:next" label={b.next} onPress={noop} /> : null}</Box>
      case 'socks': {
        const open = b.pairs.filter(pair => pair.locked === undefined), locked = b.pairs.filter(pair => pair.locked !== undefined)
        const buttons = group(open.map(pair => pair.label), plain => open.map(pair => <Button key={`coco:socks:${pair.key}`} label={pair.label} {...(plain ? { plain: true as const } : {})} {...(pair.worn ? { variant: 'primary' as const } : {})} onPress={noop} />))
        return locked.length ? <Box flexDirection="column" rowGap={1}>{buttons}<Box flexDirection="column">{locked.map(pair => <Box flexDirection="row" flexWrap="wrap" columnGap={2}><Text color="inactive" bold>{pair.label}</Text>{pair.locked ? <Text color="inactive" wrap="wrap">{pair.locked}</Text> : null}</Box>)}</Box></Box> : buttons
      }
      case 'nav':
        return (
          <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
            {group([b.previous, b.next], plain => [
              <Button key="coco:book:previous" label={b.previous} {...(plain ? { plain: true as const } : {})} onPress={() => press.turn(-1)} />,
              <Button key="coco:book:next" label={b.next} {...(plain ? { plain: true as const } : {})} onPress={() => press.turn(1)} />,
            ])}
            <Text italic={slant}>{b.where}</Text>
          </Box>
        )
    }
    return null
  }

  // Under 32 columns the tabs are plain (the engine draws the key, a colon and the label); the page's own title says
  // which one is open, since a plain tab carries no mark.
  const narrowTabs = columns < 32
  const tab = (p: Page) => bagPageName(lang, p) ?? w.tabs[p] ?? ''
  // Their itabag on the terminal (lane C, 10-14): the coral frame with the page's number and name, its badges and quota.
  const numbered = (p: Page) => `${numberText(PAGES.indexOf(p) + 1, lang)}${lang === 'zh' || lang === 'zh-Hant' || lang === 'ja' ? '' : ' '}${tab(p)}`
  const bagRows = bagWords(lang) ? bagTerminalHead(Math.min(columns, 80), numbered(page), bagSwitches(w, d, 'terminal'), bagQuota(d), cells) : []
  return (
    <Box flexDirection="column">
      {cardsOpen(ui, lang, d.cards, true)}
      {bagRows.length ? <Box flexDirection="column" marginBottom={1}>{bagRows.map(row => <Text>{row.map(run => run.color || run.bold ? <Text {...(run.color ? { color: run.color === 'claude' ? cue : run.color } : {})} {...(run.bold ? { bold: true } : {})}>{run.text}</Text> : run.text)}</Text>)}</Box> : null}
      <Box flexDirection="row" flexWrap="wrap" columnGap={narrowTabs ? 2 : 1}>
        {PAGES.flatMap((p, i) => (
          [<Button key={`coco:book:tab:${p}`} label={narrowTabs ? tab(p) : numbered(p)} hotkey={String(i + 1)} {...(narrowTabs ? { plain: true as const } : p === page ? { variant: 'primary' as const } : {})} onPress={() => press.go(p)} />, ...(p==='him'&&d.talkEnabled?[<Button key="coco:talk:open" label={d.talkTab??''} onPress={noop}/>]:[])]
        ))}
      </Box>
      {d.visitors ? <Box marginTop={1}><Button key="coco:visitors:back" label={`‹ ${tab('him')}`} onPress={noop} /></Box> : null}
      <Box flexDirection="row" alignItems="flex-end" marginTop={1}>
        {portrait ? <Raster key="portrait" columns={TERMINAL_COLUMNS} rows={TERMINAL_ROWS} cells={spriteCells(d.room?.pose==='asleep'?'sleep':'idle-reading', d.view?.colors ?? 'truecolor')} /> : null}
        <Box flexDirection="column" marginLeft={portrait ? 2 : 0} flexShrink={1}>
          <Text bold wrap="wrap">
            <Text color={cue}>{'✻ '}</Text>
            {titleOf(page, w, d)}
          </Text>
          {page === 'him'
            ? (() => { const said = himDirection(lang); return <Text wrap="wrap"><Text italic={slant}>{said.aside}</Text>{said.said ? `${said.gap}${said.said}` : ''}</Text> })()
            : direction(page, w, d) ? <Text italic={slant} wrap="wrap">{direction(page, w, d)}</Text> : null}
        </Box>
      </Box>
      <Box flexDirection="column" marginTop={1} width={measure}>
        {page==='him'?d.m1Him:null}
        {blocks.map((b, i) => {
          const node = block(b), above = gapAbove(b, blocks[i - 1], false)
          return node ? <Box {...(above ? { marginTop: above } : {})}>{node}</Box> : null
        })}
      </Box>
    </Box>
  )
}
