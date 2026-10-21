const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
// Their quota page draws each window from its opening to its reset (owner 10-15, first of the 1.0 order; the charts of the
// approved quota page, quota_page.py). The readings Claude Code reports are kept on this machine only: one trail per
// window kind, for the window open now, so a reading with another reset starts it again. A point is [minute, percent]:
// at most one a minute, a run that does not move kept as its two ends, thinned to every other point past 240.
export type QuotaTrailPoint = readonly [number, number]
// The lengths of the two account windows, as quota.ts has them; register.tsx loads this module at start, so it stays small.
const WINDOW_MS: Readonly<Record<string, number>> = { five_hour: 5 * 3_600_000, seven_day: 7 * 86_400_000 }
export type QuotaTrail = Readonly<Record<string, { readonly resetsAt: number; readonly points: readonly QuotaTrailPoint[] }>>
export const QUOTA_TRAIL_POINTS = 240
export const QUOTA_TRAIL_SAME_RESET_MS = 5 * 60_000
const SAME_RESET_MS = QUOTA_TRAIL_SAME_RESET_MS
const trailKinds = ['five_hour', 'seven_day'] as const
const tenth = (value: number): number => Math.round(Math.max(0, Math.min(100, value)) * 10) / 10
function thinned(points: QuotaTrailPoint[]): QuotaTrailPoint[] {
  while (points.length > QUOTA_TRAIL_POINTS) points = points.filter((_, i) => i === 0 || i === points.length - 1 || i % 2 === 0)
  return points
}
/** What the store holds, checked: anything else is dropped. */
export function quotaTrailFrom(raw: unknown): QuotaTrail {
  const out: Record<string, { resetsAt: number; points: QuotaTrailPoint[] }> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const kind of trailKinds) {
    const held = (raw as Record<string, unknown>)[kind] as { resetsAt?: unknown; points?: unknown } | undefined
    if (!held || typeof held !== 'object' || !finite(held.resetsAt) || !Array.isArray(held.points)) continue
    const points = (held.points as unknown[]).filter((p): p is [number, number] => Array.isArray(p) && p.length === 2 && finite(p[0]) && finite(p[1]))
      .map(([t, p]): QuotaTrailPoint => [Math.round(t), tenth(p)]).sort((a, b) => a[0] - b[0])
    if (points.length) out[kind] = { resetsAt: held.resetsAt as number, points: thinned(points) }
  }
  return out
}
/** The trail with these readings taken in, or undefined when nothing in it changed. */
export function quotaTrailWith(trail: QuotaTrail, readings: readonly { kind: string; percentUsed: number; resetsAt?: number | string }[], at: number): QuotaTrail | undefined {
  const out: Record<string, { resetsAt: number; points: readonly QuotaTrailPoint[] }> = { ...trail }
  const minute = Math.floor(at / 60_000)
  let changed = false
  for (const reading of readings) {
    const length = WINDOW_MS[reading.kind]
    const reset = typeof reading.resetsAt === 'string' ? Date.parse(reading.resetsAt) : reading.resetsAt
    if (length === undefined || !finite(reading.percentUsed) || reset === undefined || !Number.isFinite(reset) || at > reset || at < reset - length) continue
    const p = tenth(reading.percentUsed), held = out[reading.kind]
    if (!held || Math.abs(held.resetsAt - reset) > SAME_RESET_MS) { out[reading.kind] = { resetsAt: reset, points: [[minute, p]] }; changed = true; continue }
    const points = [...held.points], last = points[points.length - 1]!, before = points[points.length - 2]
    if (minute < last[0] || (minute === last[0] && last[1] === p)) continue
    if (minute === last[0] || (last[1] === p && before?.[1] === p)) points[points.length - 1] = [minute, p]
    else points.push([minute, p])
    out[reading.kind] = { resetsAt: held.resetsAt, points: thinned(points) }
    changed = true
  }
  return changed ? out : undefined
}
/** Two sessions' trails as one: the same window's points together (one a minute, the later trail's standing), else the
 * window that resets later. */
export function quotaTrailMerged(stored: QuotaTrail, mine: QuotaTrail): QuotaTrail {
  const out: Record<string, { resetsAt: number; points: readonly QuotaTrailPoint[] }> = { ...stored }
  for (const kind of trailKinds) {
    const a = stored[kind], b = mine[kind]
    if (!b) continue
    if (!a || b.resetsAt - a.resetsAt > SAME_RESET_MS) { out[kind] = b; continue }
    if (a.resetsAt - b.resetsAt > SAME_RESET_MS) continue
    const byMinute = new Map<number, QuotaTrailPoint>()
    for (const point of [...a.points, ...b.points]) byMinute.set(point[0], point)
    out[kind] = { resetsAt: b.resetsAt, points: thinned([...byMinute.values()].sort((x, y) => x[0] - y[0])) }
  }
  return out
}
