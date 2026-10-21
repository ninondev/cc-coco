// A deterministic generator of realistic assistant sessions, used only by
// the tests. Everything is drawn from one seeded RNG so a failure can be
// replayed from its seed.
//
// The session has a known true future. The simulator also emits the same
// session without measurement noise (exact percents), and the projection of
// those exact readings is the truth the tests compare against: it answers
// "when does this window run out if work continues the way these readings
// show". Comparing the two projections measures exactly what the module has
// to survive: whole-percent readings, missing reset times and duplicated
// stamps. The realized active pace is kept as well for calibration checks.

import type { Reading, WindowKind } from "../../../../plugin/hooks/algo/pace.ts"

export interface SimTruthPoint {
  at: number
  resetsAt: number
  truePercent: number
  windowStartAt: number
  trueRunOutAt: number
}

export interface SimTurn {
  at: number
  cost: number
  leadMs: number // minutes since the previous turn, 0 for the first of a burst
}

export interface SimSession {
  seed: number
  kind: WindowKind
  readings: Reading[]
  truth: SimTruthPoint[]
  turns: SimTurn[]
  // The same session without measurement noise: the same stamps (duplicates
  // included) and reset times (always reported), but the exact percent.
  exactReadings: Reading[]
  activeRatePerHour: number
  resets: number
}

export interface SimOptions {
  kind?: WindowKind
  windowMs?: number
  maxReadings?: number
  maxDurationMs?: number
  startPercent?: number
  idleMinMinutes?: number
  idleMaxMinutes?: number
  burstMinTurns?: number
  burstMaxTurns?: number
}

const MIN = 60_000
const HOUR = 3_600_000

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

export function simulateSession(seed: number, opts: SimOptions = {}): SimSession {
  const rng = mulberry32(seed)
  const kind: WindowKind = opts.kind ?? "five_hour"
  const windowMs = opts.windowMs ?? (90 + rng() * 210) * MIN // 1.5h .. 5h
  const maxReadings = opts.maxReadings ?? 220
  const maxDurationMs = opts.maxDurationMs ?? 8 * HOUR
  const idleMin = (opts.idleMinMinutes ?? 15) * MIN
  const idleMax = (opts.idleMaxMinutes ?? 90) * MIN
  const t0 = 1_700_000_000_000

  // Session level pace: every turn of this user costs about the same and
  // follows about the same rhythm, with per turn jitter.
  const costBase = 1.0 + rng() * 2.2 // 1.0 .. 3.2 points per turn
  const spaceBase = 1 + rng() * 2 // 1 .. 3 minutes between turns

  let resetsAt = t0 + windowMs
  let p = opts.startPercent !== undefined ? opts.startPercent : rng() * 30
  let t = t0 + rng() * 10 * MIN
  let resets = 0
  let activePoints = 0
  let activeMs = 0
  let windowStartAt = t

  const readings: Reading[] = []
  const exactReadings: Reading[] = []
  const raw: Omit<SimTruthPoint, "trueRunOutAt">[] = []
  const turns: SimTurn[] = []

  const report = (v: number): number => (rng() < 0.1 ? Math.round(v * 10) / 10 : Math.round(v))

  const resetIfDue = (): void => {
    while (t >= resetsAt) {
      resetsAt += windowMs
      p = rng() * 2
      resets++
      windowStartAt = t
    }
  }

  let done = false
  while (!done && readings.length < maxReadings && t - t0 < maxDurationMs) {
    const burstMin = opts.burstMinTurns ?? 4
    const burstMax = opts.burstMaxTurns ?? 14
    const burst = burstMin + Math.floor(rng() * (burstMax - burstMin + 1))
    for (let k = 0; k < burst; k++) {
      const spacing = clamp(spaceBase * (0.7 + rng() * 0.6), 1, 3) * MIN
      t += spacing
      activeMs += spacing
      resetIfDue() // a reset can land in the middle of a burst
      const cost = clamp(costBase * (0.7 + rng() * 0.6), 1, 4)
      p = Math.min(100, p + cost)
      activePoints += cost
      const at = Math.round(t)
      turns.push({ at, cost, leadMs: Math.round(spacing) })
      const reading: Reading = { kind, percentUsed: report(p), at }
      if (rng() >= 0.08) reading.resetsAt = Math.round(resetsAt) // occasionally unreported
      readings.push(reading)
      exactReadings.push({ kind, percentUsed: Math.round(p * 1000) / 1000, resetsAt: Math.round(resetsAt), at })
      const point = {
        at,
        resetsAt: Math.round(resetsAt),
        truePercent: p,
        windowStartAt: Math.round(windowStartAt),
      }
      // an occasional duplicated stamp keeps the collapse rule exercised
      if (rng() < 0.02) {
        readings.push({ kind, percentUsed: report(p), at })
        exactReadings.push({ kind, percentUsed: Math.round(p * 1000) / 1000, resetsAt: Math.round(resetsAt), at })
        raw.push(point)
      }
      raw.push(point)
      if (p >= 100 || readings.length >= maxReadings || t - t0 >= maxDurationMs) {
        done = true
        break
      }
    }
    if (done) break
    t += idleMin + rng() * (idleMax - idleMin)
    resetIfDue()
  }

  const activeRatePerMs = activeMs > 0 ? activePoints / activeMs : 0
  const truth: SimTruthPoint[] = raw.map((x) => ({
    ...x,
    trueRunOutAt: activeRatePerMs > 0 ? x.at + (100 - x.truePercent) / activeRatePerMs : Number.POSITIVE_INFINITY,
  }))

  return {
    seed,
    kind,
    readings,
    truth,
    turns,
    exactReadings,
    activeRatePerHour: activeRatePerMs * HOUR,
    resets,
  }
}
