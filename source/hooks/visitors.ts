// Visitors to her room: the rules and the shapes. Pure, no engine, no IO. Counts come from events the
// plugin already receives; nothing about the work is kept except small integers. The art, the words and
// the guest book page load when a visit is drawn or the page opens.

// Things off a programmer's desk (owner 10-12). The leaf and the snowman share one bar and take turns by season.
export const VISITOR_KINDS = ['plane', 'bulb', 'leaf', 'snowman', 'usb', 'note', 'ghost', 'keycap', 'cursor'] as const
export type VisitorKind = (typeof VISITOR_KINDS)[number]

// Today's work, per session. `long` is the longest single task in ms; `late` is turn time in ms inside the
// USB light's hours; the rest are plain counts.
export type VisitCounts = { run?: number; edit?: number; web?: number; slow?: number; done?: number; green?: number; long?: number; late?: number }
export type VisitCountKey = keyof VisitCounts

const MIN = 60_000
// What brings each kind. Ties in the pick follow this table's order.
export const VISITOR_BARS: Readonly<Record<VisitorKind, { key: VisitCountKey; n: number }>> = {
  plane: { key: 'slow', n: 3 },
  bulb: { key: 'green', n: 2 },
  leaf: { key: 'long', n: 20 * MIN },
  snowman: { key: 'long', n: 20 * MIN },
  usb: { key: 'late', n: 20 * MIN },
  note: { key: 'done', n: 10 },
  ghost: { key: 'web', n: 15 },
  keycap: { key: 'edit', n: 40 },
  cursor: { key: 'run', n: 60 },
}
/** The snowman comes December to February, the leaf the rest of the year; `day` is a visiting day, `YYYY-MM-DD`. */
export function inSeason(kind: VisitorKind, day: string): boolean {
  if (kind !== 'leaf' && kind !== 'snowman') return true
  const month = Number(day.slice(5, 7))
  const winter = month === 12 || month === 1 || month === 2
  return kind === 'snowman' ? winter : !winter
}
export const VISIT_SLOW_MS = 60_000
export const VISIT_REST_DAYS = 7
export const VISIT_DAY_SHARE = 3
// The USB light counts turn time from 21:30 to 04:59, local.
const LATE_FROM = 21 * 60 + 30
const LATE_TO = 5 * 60

const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])
const RUN_TOOLS = new Set(['Bash', 'Monitor', 'TaskStop', 'PowerShell'])
const WEB_TOOLS = new Set(['WebFetch', 'WebSearch'])

/** Which count a main-loop tool call adds to, by category. */
export function toolCountKey(tool: string): 'run' | 'edit' | 'web' | undefined {
  return RUN_TOOLS.has(tool) ? 'run' : EDIT_TOOLS.has(tool) ? 'edit' : WEB_TOOLS.has(tool) ? 'web' : undefined
}

/** `first` marks the very first visit this record has seen: its wake line is the one that is said once ever. */
export type Visit = { id: string; kind: VisitorKind; at: number; leftAt?: number; first?: true }
export type VisitDue = { day: string; kind: VisitorKind; tz?: string }
// Kept in the shared presence record: the newest due, the day of the last visit, and each kind's last day.
export type VisitState = { due?: VisitDue; last?: string; kinds?: Partial<Record<VisitorKind, string>>; visit?: Visit }

/** The word table's key for a kind's slot. */
export const visitorKey = (prefix: string, kind: VisitorKind): string => `${prefix}.${kind}`

export function isVisitorKind(value: unknown): value is VisitorKind {
  return typeof value === 'string' && (VISITOR_KINDS as readonly string[]).includes(value)
}

function localParts(at: number, tz?: string): { y: number; m: number; d: number; minutes: number } {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz }).formatToParts(new Date(at))
  } catch {
    parts = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(at))
  }
  const n = (type: string): number => Number(parts.find(p => p.type === type)?.value ?? 0)
  return { y: n('year'), m: n('month'), d: n('day'), minutes: (n('hour') % 24) * 60 + n('minute') }
}

/** The visiting day an instant belongs to: local time, from 05:00 to 04:59, as `YYYY-MM-DD`. */
export function visitDay(at: number, tz?: string): string {
  if (!Number.isFinite(at)) return ''
  const p = localParts(at, tz)
  const date = new Date(Date.UTC(p.y, p.m - 1, p.d - (p.minutes < LATE_TO ? 1 : 0)))
  return date.toISOString().slice(0, 10)
}

export function daysBetween(from: string, to: string): number {
  const a = Date.parse(from + 'T00:00:00Z'), b = Date.parse(to + 'T00:00:00Z')
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86_400_000) : NaN
}

/** Milliseconds of [start, end] that fall in 21:30 to 04:59 local time. */
export function lateMs(start: number, end: number, tz?: string): number {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0
  const origin = localParts(start, tz).minutes
  const span = (end - start) / MIN
  let total = 0
  for (let day = -1; day <= Math.ceil((origin + span) / 1440); day++) {
    const from = Math.max(origin, day * 1440 + LATE_FROM), to = Math.min(origin + span, (day + 1) * 1440 + LATE_TO)
    if (to > from) total += to - from
  }
  return Math.round(total * MIN)
}

/** 32-bit FNV-1a with a final avalanche, over `seed:day`. */
export function hash32(seed: number, day: string): number {
  let h = 0x811c9dc5 ^ (seed >>> 0)
  for (const ch of `${seed >>> 0}:${day}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16
  return h >>> 0
}
/** One day in three is a visiting day. */
export function visitingDay(seed: number, day: string): boolean { return hash32(seed, day) % VISIT_DAY_SHARE === 0 }

function sum(rows: readonly VisitCounts[], key: Exclude<VisitCountKey, 'long'>): number { return rows.reduce((n, row) => n + Math.max(0, Math.floor(Number(row[key]) || 0)), 0) }
/** Every session's counts for today as one: sums, and the longest single task. */
export function totalCounts(rows: readonly VisitCounts[]): VisitCounts {
  return { run: sum(rows, 'run'), edit: sum(rows, 'edit'), web: sum(rows, 'web'), slow: sum(rows, 'slow'), done: sum(rows, 'done'),
    green: sum(rows, 'green'), late: sum(rows, 'late'), long: rows.reduce((n, row) => Math.max(n, Number(row.long) || 0), 0) }
}

/** The kinds today's work reaches, in table order; with `day`, only the one of the leaf and the snowman in season. */
export function qualifying(counts: VisitCounts, day?: string): VisitorKind[] {
  return VISITOR_KINDS.filter(kind => (counts[VISITOR_BARS[kind].key] ?? 0) >= VISITOR_BARS[kind].n && (day === undefined || inSeason(kind, day)))
}

/** The one that comes: qualifying, not seen in the last seven days, and of those the one away longest (never seen counts as longest; ties in table order). */
export function visitorFor(counts: VisitCounts, kinds: VisitState['kinds'], today: string): VisitorKind | undefined {
  const away = (kind: VisitorKind): number => { const last = kinds?.[kind]; return last === undefined ? Infinity : daysBetween(last, today) }
  const candidates = qualifying(counts, today).filter(kind => !(away(kind) < VISIT_REST_DAYS))
  let best: VisitorKind | undefined
  for (const kind of candidates) if (best === undefined || away(kind) > away(best)) best = kind
  return best
}

export type DueInput = { on: boolean; now: number; tz?: string; seed: number; firstMet?: number; counts: VisitCounts; state?: VisitState }
/** Rules 1 to 5 of the doc, run at each main turn end. Returns what to hand the presence record, or nothing. */
export function decideDue(input: DueInput): VisitDue | undefined {
  if (!input.on) return undefined
  const day = visitDay(input.now, input.tz)
  if (!day) return undefined
  if (typeof input.firstMet === 'number' && visitDay(input.firstMet, input.tz) === day) return undefined
  if (input.state?.last === day) return undefined
  const kind = visitorFor(input.counts, input.state?.kinds, day)
  if (!kind) return undefined
  const everVisited = input.state?.kinds && Object.keys(input.state.kinds).length > 0
  if (everVisited && !visitingDay(input.seed, day)) return undefined
  return { day, kind, ...(input.tz ? { tz: input.tz } : {}) }
}

export function validDue(value: unknown): value is VisitDue {
  const due = value as Partial<VisitDue> | null
  return !!due && typeof due === 'object' && typeof due.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(due.day)
    && isVisitorKind(due.kind) && (due.tz === undefined || typeof due.tz === 'string' && due.tz.length <= 64)
}

/** Keeps only well-formed parts of a record's visitor state; anything else is dropped. */
export function parseVisitState(value: unknown): VisitState | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const input = value as Record<string, unknown>, out: VisitState = {}
  if (validDue(input.due)) out.due = { day: input.due.day, kind: input.due.kind, ...(input.due.tz ? { tz: input.due.tz } : {}) }
  if (typeof input.last === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.last)) out.last = input.last
  if (input.kinds && typeof input.kinds === 'object' && !Array.isArray(input.kinds)) {
    const kinds: Partial<Record<VisitorKind, string>> = {}
    for (const kind of VISITOR_KINDS) { const day = (input.kinds as Record<string, unknown>)[kind]; if (typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)) kinds[kind] = day }
    if (Object.keys(kinds).length) out.kinds = kinds
  }
  const visit = input.visit as Partial<Visit> | undefined
  if (visit && typeof visit === 'object' && typeof visit.id === 'string' && /^visit:\d+:\d+$/.test(visit.id) && visit.id.length <= 64
      && isVisitorKind(visit.kind) && typeof visit.at === 'number' && Number.isFinite(visit.at) && visit.at >= 0 && visit.at <= 8.64e15
      && (visit.leftAt === undefined || typeof visit.leftAt === 'number' && Number.isFinite(visit.leftAt) && visit.leftAt >= visit.at && visit.leftAt <= 8.64e15)) {
    out.visit = { id: visit.id, kind: visit.kind, at: visit.at, ...(visit.leftAt === undefined ? {} : { leftAt: visit.leftAt }), ...(visit.first === true ? { first: true as const } : {}) }
  }
  return Object.keys(out).length ? out : undefined
}

/** The newer of two dues; a due for another day never replaces today's. */
export function newerDue(held: VisitDue | undefined, offered: VisitDue | undefined): VisitDue | undefined {
  if (!offered) return held
  if (!held) return offered
  return offered.day >= held.day ? offered : held
}

/** The reducer's step when he falls asleep: the visit that arrives with the doze, if one is due today. */
export function visitAtSleep(held: VisitState | undefined, sleepAt: number, seq: number, on: boolean): VisitState | undefined {
  const due = held?.due
  if (!held || !due || !on) return held
  const day = visitDay(sleepAt, due.tz)
  if (due.day !== day || held.last === day) return held
  const { due: _used, ...rest } = held
  const first = !Object.keys(rest.kinds ?? {}).length
  return { ...rest, last: day, kinds: { ...rest.kinds, [due.kind]: day }, visit: { id: `visit:${seq}:${sleepAt}`, kind: due.kind, at: sleepAt, ...(first ? { first: true as const } : {}) } }
}

/** The reducer's step at any wake: the visit ends. */
export function visitAtWake(held: VisitState | undefined, wakeAt: number): VisitState | undefined {
  const visit = held?.visit
  if (!held || !visit || visit.leftAt !== undefined) return held
  return { ...held, visit: { ...visit, leftAt: Math.max(visit.at, wakeAt) } }
}

const GUEST_BOOK_MAX = 1000

/** The guest book as the store holds it: every well-formed visit, one per id (the later write wins), oldest first. */
export function readVisits(value: unknown): Visit[] {
  if (!Array.isArray(value)) return []
  const seen = new Map<string, Visit>()
  for (const row of value.slice(-GUEST_BOOK_MAX * 2)) {
    const parsed = parseVisitState({ visit: row })?.visit
    if (parsed) seen.set(parsed.id, parsed)
  }
  return [...seen.values()].sort((a, b) => a.at - b.at)
}
/** The list with this visit added or, when its id is there, replaced: a kind, two times, nothing about the work. */
export function withVisit(list: readonly Visit[], visit: Visit): Visit[] {
  const row: Visit = { id: visit.id, kind: visit.kind, at: visit.at, ...(visit.leftAt === undefined ? {} : { leftAt: visit.leftAt }) }
  return [...list.filter(v => v.id !== visit.id), row].sort((a, b) => a.at - b.at).slice(-GUEST_BOOK_MAX)
}
/** Visits are on unless the setting says off. */
export function visitorsOn(settings: Record<string, unknown>): boolean { return settings.visitors !== false && settings.visitors !== 'off' }

// Whether the band, companion and room draw this visit now: he is asleep with it there, or it has just left.
export function visitSitting(visit: Visit | undefined): visit is Visit { return visit !== undefined && visit.leftAt === undefined }

// ---------------------------------------------------------------- one session's side
// Today's counts from events the plugin already receives, kept as small integers in the plugin's store, and the decision at each
// main turn end. Nothing here reads a file name, a command, a test name or any text of the work.

type Store = { get: (key: string) => Promise<unknown>; set: (key: string, value: unknown) => Promise<void> }
type Tally = { day: string; rows: Record<string, VisitCounts> }
const MAX_SESSIONS = 64

function tally(value: unknown): Tally | undefined {
  const t = value as Tally | undefined
  return t && typeof t === 'object' && typeof t.day === 'string' && t.rows && typeof t.rows === 'object' && !Array.isArray(t.rows) ? t : undefined
}
/** The newer of two day strings, either may be missing. */
const later = (a?: string, b?: string): string | undefined => a === undefined ? b : b === undefined ? a : a >= b ? a : b

/** What the shared record and this machine's own store both know of past visits, merged. */
export function mergeVisitState(a?: VisitState, b?: VisitState): VisitState {
  const kinds: Partial<Record<VisitorKind, string>> = {}
  for (const source of [a?.kinds, b?.kinds]) for (const [kind, day] of Object.entries(source ?? {})) kinds[kind as VisitorKind] = later(kinds[kind as VisitorKind], day)
  const last = later(a?.last, b?.last)
  return { ...(last ? { last } : {}), ...(Object.keys(kinds).length ? { kinds } : {}) }
}

export class VisitCounter {
  private own: VisitCounts = {}
  private day = ''
  private done = new Set<string>()
  readonly tag = Math.random().toString(16).slice(2, 6).padEnd(4, '0')
  constructor(private on: () => boolean, private zone: () => string | undefined) {}

  private bump(at: number): VisitCounts | undefined {
    if (!this.on()) return undefined
    const day = visitDay(at, this.zone())
    if (day !== this.day) { this.day = day; this.own = {}; this.done.clear() }
    return this.own
  }
  private add(at: number, key: Exclude<keyof VisitCounts, 'long'>, n = 1): void {
    const own = this.bump(at)
    if (own) own[key] = (own[key] ?? 0) + n
  }

  /** A main-loop tool call that ran, from its start to its end. Denied calls and errors do not count. */
  tool(name: string, startAt: number, endAt: number, ran: { background?: boolean; failed?: boolean }): void {
    const key = toolCountKey(name)
    if (!key || ran.failed) return
    this.add(endAt, key)
    if (name === 'Bash' && !ran.background && endAt - startAt >= VISIT_SLOW_MS) this.add(endAt, 'slow')
  }
  /** A test run that passed after one that failed. */
  green(at: number): void { this.add(at, 'green') }
  /** The to-dos of a TodoWrite call: each content that is newly completed counts once. */
  todos(at: number, list: unknown): void {
    if (!Array.isArray(list)) return
    for (const item of list.slice(0, 200)) {
      const row = item as { content?: unknown; status?: unknown } | null
      if (row?.status !== 'completed' || typeof row.content !== 'string' || this.done.has(row.content)) continue
      this.done.add(row.content.slice(0, 200))
      this.add(at, 'done')
    }
  }
  /** A planned step finished outside TodoWrite (the engine's task hook). */
  step(at: number): void { this.add(at, 'done') }
  /** One task, prompt to quiet; only the longest of the day is kept. */
  task(at: number, ms: number): void {
    const own = this.bump(at)
    if (own && Number.isFinite(ms) && ms > (own.long ?? 0)) own.long = ms
  }
  /** A main turn that ended: its time inside the USB light's hours. */
  turn(at: number, ms: number): void {
    const late = lateMs(at - ms, at, this.zone())
    if (late > 0) this.add(at, 'late', late)
  }

  /** Writes this session's counts for today and says whether a visit is due. One store write, at a turn end that already writes. */
  async decide(store: Store, at: number, firstMet: number | undefined, held: VisitState | undefined): Promise<VisitDue | undefined> {
    if (!this.on()) return undefined
    const day = visitDay(at, this.zone())
    if (!day) return undefined
    const own = this.bump(at)!
    let held_ = tally(await store.get('visitTally').catch(() => undefined))
    if (!held_ || held_.day !== day) held_ = { day, rows: {} }
    held_.rows[this.tag] = { ...own }
    const tags = Object.keys(held_.rows)
    if (tags.length > MAX_SESSIONS) for (const tag of tags.slice(0, tags.length - MAX_SESSIONS)) delete held_.rows[tag]
    await store.set('visitTally', held_).catch(() => undefined)
    let seed = Number(await store.get('visitSeed').catch(() => undefined))
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
      seed = Math.floor(Math.random() * 0x100000000)
      await store.set('visitSeed', seed).catch(() => undefined)
    }
    const mine = (await store.get('visitState').catch(() => undefined)) as VisitState | undefined
    return decideDue({ on: true, now: at, tz: this.zone(), seed, firstMet, counts: totalCounts(Object.values(held_.rows)),
      state: mergeVisitState(held, mine) })
  }
}

/** This machine's own note of the last visit, so a lost presence record does not bring a kind back at once. */
export async function rememberVisit(store: Store, kind: VisitorKind, day: string): Promise<void> {
  const held = (await store.get('visitState').catch(() => undefined)) as VisitState | undefined
  const merged = mergeVisitState(held, { last: day, kinds: { [kind]: day } })
  await store.set('visitState', merged).catch(() => undefined)
}
