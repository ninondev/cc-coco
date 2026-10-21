// When he opens a session and how: one opening per way a session starts, played once.
// Pure: register.tsx hands in what it knows and plays what comes back (FIRST-MEETING 2.3).
import { lastWeekReady, weekStart } from './week-days'
import type { WeekRecord } from './week-days'

export type OpeningKind = 'startup' | 'resume' | 'clear' | 'fork'
export type SessionSource = 'startup' | 'resume' | 'clear' | 'compact' | 'fork'
export type OpeningMark = { id: string; s: string[] }
export type OpeningInput = {
  source?: SessionSource
  seconds?: number
  turns?: number
  sessionId: string
  surface: string
  played: readonly OpeningMark[]
  now: number
  lastSeen: number
  sourceAge: number
  last: Partial<Record<'clear' | 'fork', number>>
  arrival: boolean
}
const RELOAD_MS = 120_000
const QUICK_RESUME_S = 120
const FRESH_MS = 10_000
const MARKS = 32
const SOURCES: readonly string[] = ['startup', 'resume', 'clear', 'compact', 'fork']

export const openingsFrom = (value: unknown): OpeningMark[] =>
  Array.isArray(value) ? value.filter((m): m is OpeningMark => !!m && typeof m.id === 'string' && Array.isArray(m.s)).slice(-MARKS) : []
export const sourceFrom = (value: unknown): SessionSource | undefined => typeof value === 'string' && SOURCES.includes(value) ? value as SessionSource : undefined

// Which opening plays, if any. A compaction's shed is its own opening. A reload, a re-attach or a
// quick resume plays nothing, and neither does a source older than ten seconds.
export function chooseOpening(i: OpeningInput): OpeningKind | undefined {
  if (i.source === 'compact') return undefined
  const kind: OpeningKind = i.source ?? ((i.turns ?? 0) > 0 ? 'resume' : 'startup')
  if (i.sourceAge > FRESH_MS) return undefined
  if (kind === 'clear' || kind === 'fork') {
    const before = i.last[kind]
    return before !== undefined && i.now - before < 60_000 ? undefined : kind
  }
  if (i.arrival && i.played.some(m => m.id === i.sessionId && m.s.includes(i.surface))) return undefined
  if (i.arrival && i.now - i.lastSeen < RELOAD_MS) return undefined
  if (kind === 'resume' && i.seconds !== undefined && i.seconds < QUICK_RESUME_S) return undefined
  return kind
}

export function markOpening(played: readonly OpeningMark[], id: string, surface: string): OpeningMark[] {
  const held = played.find(m => m.id === id)
  const rest = played.filter(m => m.id !== id)
  return [...rest, { id, s: [...new Set([...(held?.s ?? []), surface])] }].slice(-MARKS)
}

// Last week's page is ready, and this week has not announced it yet.
export const weekReadyDue = (held: WeekRecord, today: string, lang: string, announced: unknown): boolean =>
  lastWeekReady(held, today, lang) && announced !== weekStart(today, lang)
