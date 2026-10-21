// Use counts and rarity. A card rises with use (R at 5 uses, SR at 20) and drops one level for each full 30 days
// without a use, never below N; the drop is silent (no toast, no line from Coco). One use after a drop restores the
// level its count earns. Thresholds are the product defaults, to be tuned against real use after launch.
import type { Usage, Use } from './model'

export type Rarity = 'N' | 'R' | 'SR'

export const R_AT = 5
export const SR_AT = 20
export const DECAY_MS = 30 * 24 * 60 * 60 * 1000

const LEVELS: Rarity[] = ['N', 'R', 'SR']

/** The level a count earns, before any decay. */
export function earned(n: number): Rarity {
  return n >= SR_AT ? 'SR' : n >= R_AT ? 'R' : 'N'
}

export function rarity(use: Use | undefined, now: number): Rarity {
  if (!use || use.n <= 0) return 'N'
  const idle = Math.max(0, now - use.last)
  const level = LEVELS.indexOf(earned(use.n)) - Math.floor(idle / DECAY_MS)
  return LEVELS[Math.max(0, level)]!
}

/** What the next use buys: uses still needed for the next level, or null at SR. Counts against the earned level. */
export function toNext(use: Use | undefined, now: number): { uses: number; to: Rarity } | null {
  const n = use?.n ?? 0
  const shown = rarity(use, now)
  if (shown === 'SR') return null
  // decayed below what the count earns: the next use restores it
  if (LEVELS.indexOf(shown) < LEVELS.indexOf(earned(n))) return { uses: 1, to: earned(n) }
  return shown === 'N' ? { uses: R_AT - n, to: 'R' } : { uses: SR_AT - n, to: 'SR' }
}

/** The "+1" flags after a use of `id`: the card joins the fresh ones, once. */
export function markFresh(fresh: readonly string[] | undefined, id: string): string[] {
  const now = fresh ?? []
  return now.includes(id) ? [...now] : [...now, id]
}

/** The "+1" flags after the person pulls `id` out to read it: its flag comes off. */
export function seen(fresh: readonly string[] | undefined, id: string): string[] {
  return (fresh ?? []).filter(f => f !== id)
}

/** One more use of `id` at `now`. Returns the new record set and whether the shown level went up. */
export function addUse(usage: Usage, id: string, now: number): { usage: Usage; rankedUp: boolean } {
  const before = usage[id]
  const after: Use = { n: (before?.n ?? 0) + 1, last: now }
  const rankedUp = LEVELS.indexOf(rarity(after, now)) > LEVELS.indexOf(rarity(before, now))
  return { usage: { ...usage, [id]: after }, rankedUp }
}

/** Reads a stored value back into a usage record set, dropping anything malformed. */
export function parseUsage(value: unknown): Usage {
  const out: Usage = {}
  if (!value || typeof value !== 'object') return out
  for (const [id, v] of Object.entries(value as Record<string, unknown>)) {
    const u = v as Partial<Use> | null
    if (u && typeof u.n === 'number' && u.n > 0 && typeof u.last === 'number') out[id] = { n: Math.floor(u.n), last: u.last }
  }
  return out
}
