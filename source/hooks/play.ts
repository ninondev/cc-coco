// Play: breathing with the incense, one stick, the wait at a usage limit. Pure parts only;
// register.tsx owns the timers and the state, quota.ts and band.tsx draw what is here.
import type { PlayState } from '../types'
import { c3Word } from './c3-words'

export type Stick = NonNullable<PlayState['stick']>
export type FocusCommand = { kind: 'light'; minutes: number } | { kind: 'out' }

export const BREATH_AFTER_MS = 20_000
export const BREATH_CYCLE_MS = 10_000
export const BREATH_IN_MS = 4_000
export const BREATH_STEP_MS = 1_250
export const STICK_DEFAULT_MINUTES = 25
export const STICK_MIN_MINUTES = 5
export const STICK_MAX_MINUTES = 90
export const STICK_STEPS = 42
// The terminal redraws once a focus cell: eight over the focus (play-focus.ts FOCUS_CELLS).
export const STICK_ROWS = 8
// At the end the ember goes out in 800 ms and a last wisp rises in 1.2 s; the stick is gone 2 s after the end.
export const STICK_END_MS = 2_000

// His words for play, by key from the c3 table; '' where there is none, and the caller then draws nothing.
export function playWord(lang: string, key: string, values: Record<string, string | number> = {}): string {
  return c3Word(lang, key).replace(/\{(\w+)\}/g, (token, name: string) => values[name] === undefined ? token : String(values[name]))
}

// Four steps of the plume's height, low to high.
const CELLS = ['⢀', '⢠', '⢰', '⢸'] as const

// Where in the breath: 0 is out and low, 1 is in and high. Four seconds in, six out, sine eased.
export function breathLevel(elapsed: number): number {
  const t = ((elapsed % BREATH_CYCLE_MS) + BREATH_CYCLE_MS) % BREATH_CYCLE_MS
  if (t < BREATH_IN_MS) return (1 - Math.cos(Math.PI * t / BREATH_IN_MS)) / 2
  return (1 + Math.cos(Math.PI * (t - BREATH_IN_MS) / (BREATH_CYCLE_MS - BREATH_IN_MS))) / 2
}

// Reduce motion keeps two cells: in while breathing in, out for the rest of the cycle.
export function breathCell(elapsed: number, still = false): string {
  if (still) return ((elapsed % BREATH_CYCLE_MS) + BREATH_CYCLE_MS) % BREATH_CYCLE_MS < BREATH_IN_MS ? CELLS[2] : CELLS[0]
  return CELLS[Math.round(breathLevel(elapsed) * 3)]!
}

export function nextBreathStep(elapsed: number, still = false): number {
  const t = ((elapsed % BREATH_CYCLE_MS) + BREATH_CYCLE_MS) % BREATH_CYCLE_MS
  if (still) return t < BREATH_IN_MS ? BREATH_IN_MS - t : BREATH_CYCLE_MS - t
  return BREATH_STEP_MS - (t % BREATH_STEP_MS)
}

// `/coco focus`: 25 minutes; `focus 50` takes 5 to 90 and is clamped to that; `focus off` puts it out.
export function parseFocus(value: string): FocusCommand | undefined {
  const word = value.trim().toLowerCase()
  if (word === 'off') return { kind: 'out' }
  if (word === '') return { kind: 'light', minutes: STICK_DEFAULT_MINUTES }
  if (!/^\d{1,4}$/.test(word)) return undefined
  return { kind: 'light', minutes: Math.max(STICK_MIN_MINUTES, Math.min(STICK_MAX_MINUTES, Number(word))) }
}

export function stickBurning(stick: Pick<Stick, 'startedAt' | 'endsAt'> | undefined, now: number): boolean {
  return stick !== undefined && now >= stick.startedAt && now < stick.endsAt
}

// What a stick is, from the shared presence record: both times finite and in order, at most 90 minutes.
export function stickOf(value: unknown): { startedAt: number; endsAt: number } | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const { startedAt, endsAt } = value as Record<string, unknown>
  if (typeof startedAt !== 'number' || typeof endsAt !== 'number' || !Number.isFinite(startedAt) || !Number.isFinite(endsAt)) return undefined
  if (endsAt <= startedAt || endsAt - startedAt > STICK_MAX_MINUTES * 60_000) return undefined
  return { startedAt, endsAt }
}

// Share of the stick still standing, 1 at the lighting and 0 at the end.
export function stickRemaining(stick: Pick<Stick, 'startedAt' | 'endsAt'>, now: number): number {
  return Math.max(0, Math.min(1, (stick.endsAt - now) / (stick.endsAt - stick.startedAt)))
}

// How many one-pixel steps have burned, 0 to 42.
export function stickStep(stick: Pick<Stick, 'startedAt' | 'endsAt'>, now: number): number {
  return Math.min(STICK_STEPS, Math.max(0, Math.floor((1 - stickRemaining(stick, now)) * STICK_STEPS)))
}

// The terminal's ember row, 0 at the top to 5 at the dish.
export function stickRow(stick: Pick<Stick, 'startedAt' | 'endsAt'>, now: number): number {
  return Math.min(STICK_ROWS - 1, Math.max(0, Math.floor((1 - stickRemaining(stick, now)) * STICK_ROWS)))
}

// The time the next ember row is due, for one chained timer; undefined once the last row is reached.
export function nextStickRowAt(stick: Pick<Stick, 'startedAt' | 'endsAt'>, now: number): number | undefined {
  const row = stickRow(stick, now)
  if (row >= STICK_ROWS - 1) return undefined
  return stick.startedAt + (row + 1) / STICK_ROWS * (stick.endsAt - stick.startedAt)
}

// The engine's own rows about a usage limit, in its English. One place, one test: a miss only means no spare stick.
const WAIT = /continuing automatically at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i
const REACHED = /usage limit reached/i
const CANCELLED = /automatic continue cancelled|automatically continuing cancelled/i
export type WaitRow = { kind: 'wait'; time?: string } | { kind: 'cancelled' } | { kind: 'reached' }
export function waitRow(text: string): WaitRow | undefined {
  if (CANCELLED.test(text)) return { kind: 'cancelled' }
  const wait = WAIT.exec(text)
  if (wait) return { kind: 'wait', time: wait[1]!.trim() }
  if (REACHED.test(text)) return { kind: 'reached' }
  return undefined
}

export const AUTO_RESUME = ['quota_auto_resume_fired', 'quota_auto_resume_stale', 'quota_auto_resume_disabled'] as const
export type AutoResume = (typeof AUTO_RESUME)[number]
export function autoResume(kind: string): AutoResume | undefined {
  return (AUTO_RESUME as readonly string[]).includes(kind) ? kind as AutoResume : undefined
}

// The record kept in the book's log: when a window ran out and when Claude Code carried on.
export type LimitRecord = { kind: 'out'; at: number; window: string } | { kind: 'carried'; at: number; minutes: number; percent: number | null; window: string }
export function limitRecords(value: unknown): LimitRecord[] {
  if (!Array.isArray(value)) return []
  const rows: LimitRecord[] = []
  for (const raw of value.slice(-40)) {
    if (!raw || typeof raw !== 'object') continue
    const row = raw as Record<string, unknown>
    if (typeof row.at !== 'number' || !Number.isFinite(row.at) || typeof row.window !== 'string' || row.window.length > 40) continue
    if (row.kind === 'out') rows.push({ kind: 'out', at: row.at, window: row.window })
    else if (row.kind === 'carried' && typeof row.minutes === 'number' && Number.isFinite(row.minutes)) {
      rows.push({ kind: 'carried', at: row.at, minutes: Math.max(0, Math.round(row.minutes)), percent: typeof row.percent === 'number' && Number.isFinite(row.percent) ? Math.round(row.percent) : null, window: row.window })
    }
  }
  return rows
}
