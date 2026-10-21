// The weekly page's record: counts per day, kept under the store key `days:v1`.
// Never kept: tool inputs, names, folders, commands, times of day or costs.
import { poseForTool } from './tool-poses'
import { numberLocale } from './numbers'

export const WEEK_STORE = 'days:v1'
// The kinds of work a tool call is, for the vibe check's counts.
export const WEEK_KINDS = ['read', 'search', 'write', 'run', 'web', 'plan', 'helpers'] as const
export type WeekKind = (typeof WEEK_KINDS)[number]
// A finished day: its pages (turns) and its fixes (red to green). Records from before 10-19 also kept each day's tool runs,
// wild moments and which bookmarks had slid out, for the bookmarks he took off the zine (DECISIONS 1036); they are dropped
// on read.
export type WeekDay = { day: string; pages: number; green: number }
// The doujin's issues (page 5): one a week, numbered from the first week they worked with Coco; a week with a finished day
// is an issue in their collection, a week without one is an issue they missed. Kept as that first week's first day and the
// numbers collected, at most ten years of them.
export type WeekIssues = { first: string; got: number[] }
// A past issue whose days have dropped keeps only its first day and its two numbers (owner 10-17: a past issue opens to its
// cover and that week's numbers).
export type WeekBack = { n: number; start: string; pages: number; green: number }
export type WeekRecord = { days: WeekDay[]; issues?: WeekIssues; back?: WeekBack[] }

const DAYS_LIMIT = 14
const ISSUES_LIMIT = 520
const DAY = /^\d{4}-\d{2}-\d{2}$/

// Every tool the pose table does not name counts as writing; BashOutput and Monitor belong to running.
export function weekKind(tool: string): WeekKind {
  switch (poseForTool(tool)) {
    case 'scroll': return 'read'
    case 'search': return 'search'
    case 'run': case 'tea': return 'run'
    case 'spyglass': return 'web'
    case 'plan': return 'plan'
    case 'helper': return 'helpers'
    default: return 'write'
  }
}

// The fixes since the last write, held in memory until a turn ends.
export class WeekTally {
  green = 0
  greenRun(): void { this.green += 1 }
  clear(): void { this.green = 0 }
}

const whole = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0

// Anything unreadable is dropped, so a damaged record can only lose days, never draw wrong ones.
export function weekRecordFrom(value: unknown): WeekRecord {
  const record: WeekRecord = { days: [] }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return record
  const stored = value as { days?: unknown }
  if (Array.isArray(stored.days)) {
    for (const entry of stored.days) {
      if (!entry || typeof entry !== 'object') continue
      const d = entry as Record<string, unknown>
      if (typeof d.day !== 'string' || !DAY.test(d.day) || record.days.some(x => x.day === d.day)) continue
      record.days.push({ day: d.day, pages: whole(d.pages), green: whole(d.green) })
    }
  }
  record.days.sort((a, b) => a.day.localeCompare(b.day))
  record.days = record.days.slice(-DAYS_LIMIT)
  const issues = (value as { issues?: unknown }).issues as { first?: unknown; got?: unknown } | undefined
  if (issues && typeof issues === 'object' && typeof issues.first === 'string' && DAY.test(issues.first) && Array.isArray(issues.got)) {
    const got = [...new Set(issues.got.filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1))].sort((a, b) => a - b)
    if (got.length) record.issues = { first: issues.first, got: got.slice(-ISSUES_LIMIT) }
  }
  const back = (value as { back?: unknown }).back
  if (Array.isArray(back)) {
    const kept = new Map<number, WeekBack>()
    for (const entry of back) {
      if (!entry || typeof entry !== 'object') continue
      const b = entry as Record<string, unknown>
      if (typeof b.n !== 'number' || !Number.isInteger(b.n) || b.n < 1 || typeof b.start !== 'string' || !DAY.test(b.start) || kept.has(b.n)) continue
      kept.set(b.n, { n: b.n, start: b.start, pages: whole(b.pages), green: whole(b.green) })
    }
    if (kept.size) record.back = [...kept.values()].sort((a, b) => a.n - b.n).slice(-ISSUES_LIMIT)
  }
  return record
}

export function addDays(day: string, n: number): string {
  const time = Date.parse(`${day}T12:00:00Z`) + n * 86400000
  return new Date(time).toISOString().slice(0, 10)
}

// The first weekday comes from the locale; Simplified Chinese counts Monday to Sunday, and a runtime without week data starts on Monday.
export function weekFirstDay(lang: string): number {
  if (lang === 'zh') return 1
  try {
    const locale = new Intl.Locale(numberLocale(lang)) as Intl.Locale & { getWeekInfo?: () => { firstDay?: number }; weekInfo?: { firstDay?: number } }
    const first = (locale.getWeekInfo?.() ?? locale.weekInfo)?.firstDay
    return typeof first === 'number' && first >= 1 && first <= 7 ? first : 1
  } catch { return 1 }
}

export function weekStart(day: string, lang: string): string {
  const jsDay = new Date(`${day}T12:00:00Z`).getUTCDay()
  const iso = jsDay === 0 ? 7 : jsDay
  return addDays(day, -((iso - weekFirstDay(lang) + 7) % 7))
}

// A week's issue number, counted from the first week (a change of language moves a week's first day by a day or so, which
// the rounding absorbs).
export function issueNumber(first: string, start: string): number {
  return Math.round((Date.parse(`${start}T12:00:00Z`) - Date.parse(`${first}T12:00:00Z`)) / (7 * 86400000)) + 1
}
// The issues with every finished day of the record in them (a day before `today` with work).
export function weekIssues(held: WeekRecord, today: string, lang: string): WeekIssues | undefined {
  const starts = held.days.filter(d => d.day < today && d.pages > 0).map(d => weekStart(d.day, lang)).sort()
  const first = held.issues?.first ?? starts[0]
  if (!first) return undefined
  const got = new Set(held.issues?.got ?? [])
  for (const start of starts) { const n = issueNumber(first, start); if (n >= 1) got.add(n) }
  return got.size ? { first, got: [...got].sort((a, b) => a - b).slice(-ISSUES_LIMIT) } : undefined
}

// Days older than last week's first day leave the record; their numbers stay with their issue.
function archive(held: WeekRecord, keepFrom: string, first: string | undefined, lang: string): WeekBack[] | undefined {
  const back = new Map((held.back ?? []).map(b => [b.n, { ...b }]))
  for (const d of held.days) {
    if (d.day >= keepFrom || d.pages <= 0 || !first) continue
    const start = weekStart(d.day, lang), n = issueNumber(first, start)
    if (n < 1) continue
    const b = back.get(n) ?? { n, start, pages: 0, green: 0 }
    b.pages += d.pages; b.green += d.green
    back.set(n, b)
  }
  return back.size ? [...back.values()].sort((a, b) => a.n - b.n).slice(-ISSUES_LIMIT) : undefined
}

// Fold the tally into today's day. Older than last week's first day, a day drops; its week's issue stays collected, with
// its numbers.
export function foldTurn(held: WeekRecord, tally: WeekTally, day: string, lang: string): WeekRecord {
  const keepFrom = addDays(weekStart(day, lang), -7)
  const days = held.days.filter(d => d.day >= keepFrom && d.day !== day).map(d => ({ ...d }))
  const old = held.days.find(d => d.day === day)
  const today: WeekDay = old ? { ...old } : { day, pages: 0, green: 0 }
  today.pages += 1
  today.green += tally.green
  days.push(today)
  days.sort((a, b) => a.day.localeCompare(b.day))
  const issues = weekIssues(held, day, lang), back = archive(held, keepFrom, issues?.first, lang)
  return { days: days.slice(-DAYS_LIMIT), ...(issues ? { issues } : {}), ...(back ? { back } : {}) }
}

// One write per finished main turn, so a day's counts reach the store with the `turns` count.
export async function recordWeek($: { store: { get(key: string): Promise<unknown>; set(key: string, value: never): Promise<unknown> } }, tally: WeekTally, day: string, lang: string): Promise<void> {
  const next = foldTurn(weekRecordFrom(await $.store.get(WEEK_STORE)), tally, day, lang)
  tally.clear()
  await $.store.set(WEEK_STORE, next as never)
}

// `n` is the shown week's issue number once there is a first issue; an issue from before last week ('back') has no days,
// only its two numbers.
export type WeekView = { shown: 'this' | 'last' | 'back'; start: string; end: string; days: WeekDay[]; other: boolean; n?: number; totals?: { pages: number; green: number } }

// A day is final once the local date has moved on, so today never draws. Before this week has a
// finished day, last week's page shows. `want` is true for last week, false for this week, or an issue's number.
export function weekView(held: WeekRecord, today: string, lang: string, want?: boolean | number): WeekView | undefined {
  const start = weekStart(today, lang), lastStart = addDays(start, -7)
  const finished = held.days.filter(d => d.day < today && d.pages > 0)
  const mine = finished.filter(d => d.day >= start)
  const last = finished.filter(d => d.day >= lastStart && d.day < start)
  const first = weekIssues(held, today, lang)?.first, number = (from: string): { n?: number } => first ? { n: issueNumber(first, from) } : {}
  if (typeof want === 'number' && first) {
    const old = held.back?.find(b => b.n === want)
    if (want === issueNumber(first, start) && mine.length) want = false
    else if (want === issueNumber(first, lastStart) && last.length) want = true
    else if (old) return { shown: 'back', start: old.start, end: addDays(old.start, 6), days: [], other: false, n: old.n, totals: { pages: old.pages, green: old.green } }
  }
  if (!mine.length && !last.length) return undefined
  let shown: 'this' | 'last' = mine.length ? 'this' : 'last'
  if (want === true && last.length) shown = 'last'
  if (want === false && mine.length) shown = 'this'
  const from = shown === 'this' ? start : lastStart
  return { shown, start: from, end: addDays(from, 6), days: shown === 'this' ? mine : last, other: shown === 'this' ? last.length > 0 : mine.length > 0, ...number(from) }
}

export const viewTotals = (view: WeekView): { pages: number; green: number } => view.totals ?? weekTotals(view.days)

// The issues in their collection, newest first, each with its first day and its numbers where the record still has them.
export type IssueRow = { n: number; start?: string; pages?: number; green?: number }
export function issueRows(held: WeekRecord, today: string, lang: string): IssueRow[] {
  const issues = weekIssues(held, today, lang)
  if (!issues) return []
  const live = new Map<number, IssueRow>()
  for (const d of held.days.filter(d => d.day < today && d.pages > 0)) {
    const start = weekStart(d.day, lang), n = issueNumber(issues.first, start), row = live.get(n) ?? { n, start, pages: 0, green: 0 }
    row.pages! += d.pages; row.green! += d.green
    live.set(n, row)
  }
  const back = new Map((held.back ?? []).map(b => [b.n, b]))
  return [...issues.got].reverse().map(n => live.get(n) ?? back.get(n) ?? { n })
}

// The twelve covers take turns by issue number (owner 10-17).
export const ZINE_COVERS = 12
export const zineCover = (n: number): number => ((Math.max(1, Math.floor(n)) - 1) % ZINE_COVERS) + 1

// Last week's page is ready when the week before today's has a finished day and today's has none.
export function lastWeekReady(held: WeekRecord, today: string, lang: string): boolean {
  const start = weekStart(today, lang), lastStart = addDays(start, -7)
  return held.days.some(d => d.pages > 0 && d.day >= lastStart && d.day < start)
}

export const weekTotals = (days: readonly WeekDay[]): { pages: number; green: number } =>
  ({ pages: days.reduce((n, d) => n + d.pages, 0), green: days.reduce((n, d) => n + d.green, 0) })

// The range in the locale's own order; the joiner word replaces the separator, so no dash appears.
export function weekRange(start: string, end: string, lang: string, join: string): string {
  const a = new Date(`${start}T12:00:00Z`), b = new Date(`${end}T12:00:00Z`)
  const spaced = /[\p{Script=Latin}\p{Script=Devanagari}\p{Script=Hangul}]/u.test(join)
  const joiner = (value: string): string => {
    const m = /^([\s.,]*)([^\s.,]+)([\s.,]*)$/.exec(value)
    if (!m) return value
    const [, lead = '', , trail = ''] = m
    return spaced ? `${lead}${/\s$/.test(lead) ? '' : ' '}${join}${/^\s/.test(trail) ? '' : ' '}${trail}` : `${lead}${join}${trail}`
  }
  try {
    const format = new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : numberLocale(lang), { dateStyle: ['zh', 'zh-Hant', 'ja', 'ko'].includes(lang) ? 'long' : 'medium', timeZone: 'UTC' }) as Intl.DateTimeFormat & { formatRangeToParts(a: Date, b: Date): { source: string; value: string }[] }
    const parts = format.formatRangeToParts(a, b)
    const from = parts.map(p => p.source).lastIndexOf('startRange'), to = parts.map(p => p.source).indexOf('endRange')
    if (from < 0 || to < 0) throw new Error('no range')
    return parts.map((p, i) => i > from && i < to ? joiner(p.value) : p.value).join('')
  } catch { return `${start} ${join} ${end}` }
}

