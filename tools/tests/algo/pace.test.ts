import { describe, expect, test } from "bun:test"
import { crossed, hotness, project, shouldWarn } from "../../../plugin/hooks/algo/pace"
import type { HotState, Projection, Reading, ReminderState, WindowKind } from "../../../plugin/hooks/algo/pace"
import { simulateSession } from "./sim/session"
import type { SimSession } from "./sim/session"

const MIN = 60_000
const HOUR = 3_600_000
const T0 = 1_700_000_000_000
const RESET = T0 + 6 * HOUR

function r(kind: WindowKind, p: number, minutes: number, resetsAt?: number): Reading {
  const reading: Reading = { kind, percentUsed: p, at: T0 + Math.round(minutes * MIN) }
  if (resetsAt !== undefined) reading.resetsAt = resetsAt
  return reading
}

function at(minutes: number): number {
  return T0 + Math.round(minutes * MIN)
}

function ramp(kind: WindowKind, percents: number[], stepMinutes: number, resetsAt?: number): Reading[] {
  return percents.map((p, i) => r(kind, p, i * stepMinutes, resetsAt))
}

function one(readings: Reading[], now: number, kind: WindowKind = "five_hour"): Projection | undefined {
  return project(readings, now).find((p) => p.kind === kind)
}

// Independent textbook quantile (linear interpolation between order
// statistics) so the expectations below come from the spec, not the module.
function quantile(values: number[], q: number): number {
  const s = [...values].sort((a, b) => a - b)
  const n = s.length
  if (n === 0) return Number.NaN
  const pos = (n - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return s[lo] + (s[hi] - s[lo]) * (pos - lo)
}

// Pairwise slopes of explicitly listed [minutes, percent] points: the set the
// spec says the estimator is allowed to see.
function slopesFrom(points: Array<[number, number]>, minGapMinutes: number): number[] {
  const out: number[] = []
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dt = points[j][0] - points[i][0]
      if (dt >= minGapMinutes) out.push((points[j][1] - points[i][1]) / dt)
    }
  }
  return out
}

const pointsOf = (readings: Reading[]): Array<[number, number]> =>
  readings.map((x) => [(x.at - T0) / MIN, x.percentUsed] as [number, number])

// Expected rate (points per hour, two decimals) from explicitly listed points.
const rateOf = (points: Array<[number, number]>): number =>
  Math.round(quantile(slopesFrom(points, 3), 0.5) * 60 * 100) / 100

describe("cleaning", () => {
  test("drops a reading newer than now + 60s (clock skew)", () => {
    const rs = [r("five_hour", 10, 0, RESET), r("five_hour", 20, 10, RESET), r("five_hour", 45, 30 + 61 / 60, RESET)]
    expect(one(rs, at(30))?.ratePerHour).toBeUndefined()
  })

  test("keeps a reading exactly 60s into the future", () => {
    const rs = [r("five_hour", 10, 0, RESET), r("five_hour", 20, 10, RESET), r("five_hour", 45, 30 + 1, RESET)]
    expect(one(rs, at(30))?.ratePerHour).toBeDefined()
  })

  test("drops readings with non-finite percentUsed", () => {
    const rs = [
      r("five_hour", Number.NaN, 0, RESET),
      r("five_hour", Number.POSITIVE_INFINITY, 5, RESET),
      r("five_hour", 20, 10, RESET),
      r("five_hour", 30, 20, RESET),
    ]
    expect(one(rs, at(20))?.ratePerHour).toBeUndefined()
  })

  test("drops readings with non-finite at", () => {
    const rs = [
      { kind: "five_hour", percentUsed: 10, at: Number.NaN, resetsAt: RESET },
      { kind: "five_hour", percentUsed: 20, at: Number.NEGATIVE_INFINITY, resetsAt: RESET },
      r("five_hour", 20, 10, RESET),
      r("five_hour", 30, 20, RESET),
    ] as Reading[]
    expect(one(rs, at(20))?.ratePerHour).toBeUndefined()
  })

  test("treats a non-finite resetsAt as absent", () => {
    const rs = [
      { kind: "five_hour", percentUsed: 10, at: at(0), resetsAt: Number.NaN },
      r("five_hour", 20, 10),
      r("five_hour", 30, 20),
    ] as Reading[]
    const p = one(rs, at(20))
    expect(p?.resetsAt).toBeUndefined()
    expect(p?.early).toBe(false)
    expect(p?.ratePerHour).toBe(60)
  })

  test("drops readings that are not objects", () => {
    const rs = [null, undefined, 7, "nope", {}, r("five_hour", 20, 10, RESET), r("five_hour", 30, 20, RESET)] as unknown as Reading[]
    expect(one(rs, at(20))?.ratePerHour).toBeUndefined()
  })

  test("drops readings without a kind", () => {
    const rs = [
      { percentUsed: 10, at: at(0), resetsAt: RESET },
      r("five_hour", 20, 10, RESET),
      r("five_hour", 30, 20, RESET),
    ] as unknown as Reading[]
    expect(one(rs, at(20))?.ratePerHour).toBeUndefined()
  })

  test("accepts readings given in any order", () => {
    const sorted = ramp("five_hour", [10, 20, 30, 40], 10, RESET)
    const shuffled = [sorted[2], sorted[0], sorted[3], sorted[1]]
    expect(project(shuffled, at(30))).toEqual(project(sorted, at(30)))
  })

  test("collapses duplicate timestamps keeping the last reading", () => {
    const late = [r("five_hour", 10, 0, RESET), r("five_hour", 50, 10, RESET), r("five_hour", 20, 10, RESET), r("five_hour", 30, 20, RESET)]
    expect(one(late, at(20))?.ratePerHour).toBe(60)
    const early = [r("five_hour", 10, 0, RESET), r("five_hour", 20, 10, RESET), r("five_hour", 50, 10, RESET), r("five_hour", 30, 20, RESET)]
    expect(one(early, at(20))?.ratePerHour).toBeUndefined()
  })

  test("clamps percentUsed below zero to zero", () => {
    const rs = [r("five_hour", -40, 0, RESET), r("five_hour", 0, 5, RESET), r("five_hour", 4, 10, RESET), r("five_hour", 8, 15, RESET)]
    const p = one(rs, at(15))
    expect(p?.ratePerHour).toBe(rateOf([[0, 0], [5, 0], [10, 4], [15, 8]]))
    expect(p?.runsOutAt).toBe(T0 + Math.round((15 + (100 - 8) / quantile(slopesFrom([[0, 0], [5, 0], [10, 4], [15, 8]], 3), 0.5)) * MIN))
  })

  test("clamps percentUsed above 100 to a burnt window", () => {
    const rs = ramp("five_hour", [10, 20, 140], 10, RESET)
    const p = one(rs, at(20))
    expect(p?.runsOutAt).toBe(at(20))
    expect(p?.runsOutAtLate).toBe(at(20))
  })
})

describe("windows", () => {
  test("the current window shares the resetsAt of the newest reading", () => {
    const A = T0 + 3 * HOUR
    const B = T0 + 9 * HOUR
    const rs = [r("five_hour", 10, 0, A), r("five_hour", 20, 10, A), r("five_hour", 30, 20, B), r("five_hour", 40, 30, B)]
    const p = one(rs, at(35))
    expect(p?.resetsAt).toBe(B)
    expect(p?.ratePerHour).toBeUndefined() // only two readings in the new window
  })

  test("readings without resetsAt form one window on their own", () => {
    const rs = ramp("five_hour", [10, 20, 30, 40], 10)
    const p = one(rs, at(30))
    expect(p?.resetsAt).toBeUndefined()
    expect(p?.ratePerHour).toBe(60)
    expect(p?.runsOutAt).toBe(at(30 + 60))
    expect(p?.early).toBe(false)
  })

  test("a reading without resetsAt starts its own current window", () => {
    const rs = [r("five_hour", 10, 0, RESET), r("five_hour", 20, 10), r("five_hour", 30, 20, RESET), r("five_hour", 40, 30)]
    const p = one(rs, at(30))
    // Repair brief: the newest unknown-reset run has only one reading.
    expect(p?.resetsAt).toBeUndefined()
    expect(p?.ratePerHour).toBeUndefined()
  })

  test("a drop of five points starts a new window with the same resetsAt", () => {
    const rs = [r("five_hour", 10, 0, RESET), r("five_hour", 30, 10, RESET), r("five_hour", 25, 20, RESET), r("five_hour", 26, 30, RESET)]
    const p = one(rs, at(30))
    expect(p?.resetsAt).toBe(RESET)
    expect(p?.ratePerHour).toBeUndefined() // the new window holds only two readings
  })

  test("a drop of five points is measured against the window maximum", () => {
    // 31 against a running maximum of 35 is only four points: same window
    const rs = [r("five_hour", 10, 0, RESET), r("five_hour", 30, 10, RESET), r("five_hour", 35, 20, RESET), r("five_hour", 31, 30, RESET), r("five_hour", 33, 40, RESET)]
    expect(one(rs, at(40))?.ratePerHour).toBe(rateOf(pointsOf(rs)))
  })

  test("a drop of exactly five points splits, slightly less does not", () => {
    const splits = [r("five_hour", 10, 0, RESET), r("five_hour", 30, 10, RESET), r("five_hour", 25, 20, RESET), r("five_hour", 26, 30, RESET)]
    expect(one(splits, at(30))?.ratePerHour).toBeUndefined()
    const stays = [r("five_hour", 10, 0, RESET), r("five_hour", 30, 10, RESET), r("five_hour", 25.01, 20, RESET), r("five_hour", 26, 30, RESET)]
    expect(one(stays, at(30))?.ratePerHour).toBeDefined()
    expect(one(stays, at(30))?.resetsAt).toBe(RESET)
  })

  test("drops a window whose resetsAt is already past", () => {
    const past = T0 + 25 * MIN
    const rs = [r("five_hour", 10, 0, past), r("five_hour", 20, 10, past), r("five_hour", 30, 20, past)]
    expect(project(rs, at(30))).toEqual([])
  })

  test("drops a window whose resetsAt is exactly now", () => {
    const rs = [r("five_hour", 10, 0, at(30)), r("five_hour", 20, 10, at(30)), r("five_hour", 30, 20, at(30))]
    expect(project(rs, at(30))).toEqual([])
  })

  test("keeps a window whose resetsAt is one millisecond away", () => {
    const rs = [r("five_hour", 10, 0, at(30) + 1), r("five_hour", 20, 10, at(30) + 1), r("five_hour", 30, 20, at(30) + 1)]
    expect(project(rs, at(30))).toHaveLength(1)
  })

  test("an old window never hides the current one", () => {
    const A = T0 + 20 * MIN
    const rs = [r("five_hour", 40, 0, A), r("five_hour", 50, 10, A), r("five_hour", 10, 30, RESET), r("five_hour", 20, 40, RESET), r("five_hour", 30, 50, RESET)]
    const p = one(rs, at(50))
    expect(p?.resetsAt).toBe(RESET)
    expect(p?.ratePerHour).toBe(60)
  })

  test("a reset that goes unreported is caught by the drop rule", () => {
    // same resetsAt reported throughout, but usage restarted at 12 after a reset
    const rs = [r("five_hour", 20, 0, RESET), r("five_hour", 40, 10, RESET), r("five_hour", 12, 30, RESET), r("five_hour", 16, 40, RESET), r("five_hour", 20, 50, RESET)]
    const p = one(rs, at(50))
    expect(p?.ratePerHour).toBe(24)
    expect(p?.runsOutAt).toBe(at(50 + 80 / 0.4))
  })
})

describe("rate", () => {
  test("three equal slopes give the exact Theil-Sen rate", () => {
    const p = one(ramp("five_hour", [10, 20, 30], 10, RESET), at(20))
    expect(p?.ratePerHour).toBe(60)
    expect(p?.runsOutAt).toBe(at(90))
    expect(p?.runsOutAtLate).toBe(at(90))
  })

  test("the median of unequal pairwise slopes", () => {
    const rs = [10, 12, 16, 18].map((p, i) => r("seven_day", p, [0, 6, 12, 20][i]))
    const pts = pointsOf(rs)
    const p = one(rs, at(20), "seven_day")
    expect(p?.ratePerHour).toBe(rateOf(pts))
    expect(p?.runsOutAt).toBe(T0 + Math.round((20 + (100 - 18) / quantile(slopesFrom(pts, 3), 0.5)) * MIN))
    expect(p?.runsOutAtLate).toBe(T0 + Math.round((20 + (100 - 18) / quantile(slopesFrom(pts, 3), 0.25)) * MIN))
  })

  test("pairs closer than three minutes are left out", () => {
    const rs = [r("five_hour", 10, 0), r("five_hour", 12, 1), r("five_hour", 12, 61), r("five_hour", 14, 62), r("five_hour", 16, 63)]
    const p = one(rs, at(63))
    expect(p?.ratePerHour).toBeUndefined() // every allowed pair straddles idle time
    expect(p?.resetsAt).toBeUndefined()
  })

  test("pairs exactly three minutes apart count, shorter ones do not", () => {
    const tight = [r("five_hour", 10, 0), r("five_hour", 20, 1), r("five_hour", 22, 10)]
    expect(one(tight, at(10))?.ratePerHour).toBe(rateOf(pointsOf(tight)))
    const exact = [r("five_hour", 10, 0), r("five_hour", 12, 3), r("five_hour", 14, 6), r("five_hour", 16, 9), r("five_hour", 18, 12)]
    expect(one(exact, at(12))?.ratePerHour).toBe(40)
  })

  test("sparse readings still project", () => {
    const rs = [r("five_hour", 10, 0, RESET), r("five_hour", 19, 9, RESET), r("five_hour", 20, 11, RESET)]
    expect(one(rs, at(11))?.ratePerHour).toBe(rateOf(pointsOf(rs)))
  })

  test("only the last 90 minutes of the window feed the rate", () => {
    const fresh = [r("five_hour", 50, 100, RESET), r("five_hour", 52, 110, RESET), r("five_hour", 54, 120, RESET)]
    const withOld = [r("five_hour", 10, 0, RESET), ...fresh]
    expect(one(withOld, at(120))?.ratePerHour).toBe(12)
    expect(one(withOld, at(120))?.ratePerHour).toBe(one(fresh, at(120))?.ratePerHour)
  })

  test("a reading exactly 90 minutes before the newest is still used", () => {
    const inside = [r("five_hour", 30, 30, RESET), r("five_hour", 50, 100, RESET), r("five_hour", 52, 110, RESET), r("five_hour", 54, 120, RESET)]
    const outside = [r("five_hour", 30, 29, RESET), r("five_hour", 50, 100, RESET), r("five_hour", 52, 110, RESET), r("five_hour", 54, 120, RESET)]
    expect(one(inside, at(120))?.ratePerHour).toBe(rateOf(pointsOf(inside)))
    expect(one(outside, at(120))?.ratePerHour).toBe(12)
  })

  test("a window younger than 90 minutes uses all of its readings", () => {
    const rs = ramp("five_hour", [5, 10, 15, 20, 25], 20, RESET)
    expect(one(rs, at(80))?.ratePerHour).toBe(rateOf(pointsOf(rs)))
  })

  test("two readings are not enough", () => {
    expect(one(ramp("five_hour", [10, 40], 10, RESET), at(10))?.ratePerHour).toBeUndefined()
  })

  test("a span of exactly ten minutes is enough, one millisecond less is not", () => {
    const ms = (offset: number, p: number): Reading => ({ kind: "five_hour", percentUsed: p, at: T0 + offset, resetsAt: RESET })
    expect(one([ms(0, 10), ms(300_000, 15), ms(600_000, 20)], T0 + 600_000)?.ratePerHour).toBe(60)
    expect(one([ms(0, 10), ms(300_000, 20), ms(599_999, 30)], T0 + 599_999)?.ratePerHour).toBeUndefined()
  })

  test("two points of rise are needed, exactly two is enough", () => {
    expect(one(ramp("five_hour", [10, 11, 12], 5, RESET), at(10))?.ratePerHour).toBe(12)
    expect(one(ramp("five_hour", [10, 11, 11.99], 5, RESET), at(10))?.ratePerHour).toBeUndefined()
  })

  test("a duplicate timestamp cannot fake a third reading", () => {
    const rs = [r("five_hour", 10, 0, RESET), r("five_hour", 20, 10, RESET), r("five_hour", 30, 10, RESET)]
    expect(one(rs, at(10))?.ratePerHour).toBeUndefined()
  })

  test("a flat pace does not project", () => {
    const p = one(ramp("five_hour", [20, 20, 20, 20], 10, RESET), at(30))
    expect(p?.ratePerHour).toBeUndefined()
    expect(p?.runsOutAt).toBeUndefined()
    expect(p?.early).toBe(false)
  })

  test("a falling pace does not project", () => {
    const p = one(ramp("five_hour", [40, 30, 20], 10, RESET), at(20))
    expect(p?.ratePerHour).toBeUndefined()
    expect(p?.runsOutAt).toBeUndefined()
  })

  test("a noisy but rising pace projects the Theil-Sen median", () => {
    const rs = [r("five_hour", 10, 0, RESET), r("five_hour", 20, 10, RESET), r("five_hour", 16, 20, RESET), r("five_hour", 26, 30, RESET), r("five_hour", 36, 40, RESET)]
    expect(one(rs, at(40))?.ratePerHour).toBe(rateOf(pointsOf(rs)))
  })
})

describe("idle gaps", () => {
  test("a long gap with no rise does not dilute the rate", () => {
    const rs = [r("five_hour", 10, 0), r("five_hour", 30, 30), r("five_hour", 30, 80), r("five_hour", 32, 83), r("five_hour", 34, 86)]
    const p = one(rs, at(86))
    expect(p?.ratePerHour).toBe(40)
    expect(p?.runsOutAt).toBe(at(86 + 66 / (2 / 3)))
  })

  test("a gap of exactly twenty minutes is not idle", () => {
    const rs = [r("five_hour", 10, 0), r("five_hour", 20, 10), r("five_hour", 20, 30), r("five_hour", 22, 33), r("five_hour", 24, 36)]
    expect(one(rs, at(36))?.ratePerHour).toBe(rateOf(pointsOf(rs)))
  })

  test("a long gap with a real rise is work and stays in the set", () => {
    // twenty five points over the hour long gap is a real pace, not a turn
    const rs = [r("five_hour", 10, 0), r("five_hour", 20, 10), r("five_hour", 45, 70), r("five_hour", 47, 73), r("five_hour", 49, 76)]
    expect(one(rs, at(76))?.ratePerHour).toBe(rateOf(pointsOf(rs)))
  })

  test("one point of rise across an hour remains work", () => {
    // All ten slopes count; the middle two are 13/73 and 15/76 points/min.
    // Their mean times 60 rounds to 11.26 points/hour.
    const rs = [r("five_hour", 10, 0), r("five_hour", 20, 10), r("five_hour", 21, 70), r("five_hour", 23, 73), r("five_hour", 25, 76)]
    expect(one(rs, at(76))?.ratePerHour).toBe(11.26)
  })

  test("two idle gaps in one window", () => {
    const rs = [
      r("five_hour", 10, 0, RESET),
      r("five_hour", 14, 6, RESET),
      r("five_hour", 14, 50, RESET),
      r("five_hour", 18, 56, RESET),
      r("five_hour", 18, 100, RESET),
      r("five_hour", 22, 106, RESET),
    ]
    const p = one(rs, at(106))
    expect(p?.ratePerHour).toBe(40)
  })

  test("a single burst after a long idle keeps its own pace", () => {
    const rs = [r("five_hour", 10, 0, RESET), r("five_hour", 20, 10, RESET), r("five_hour", 20, 90, RESET), r("five_hour", 22, 93, RESET), r("five_hour", 24, 96, RESET)]
    const p = one(rs, at(96))
    expect(p?.ratePerHour).toBe(40)
    expect(p?.runsOutAt).toBe(at(96 + 76 / (2 / 3)))
  })

  test("readings before a very long idle fall outside the 90 minute slice", () => {
    const rs = [r("five_hour", 10, 0, RESET), r("five_hour", 20, 10, RESET), r("five_hour", 21, 110, RESET), r("five_hour", 23, 113, RESET), r("five_hour", 25, 116, RESET), r("five_hour", 27, 119, RESET), r("five_hour", 29, 122, RESET)]
    expect(one(rs, at(122))?.ratePerHour).toBe(rateOf([[110, 21], [113, 23], [116, 25], [119, 27], [122, 29]]))
  })
})

describe("runs out", () => {
  test("runsOutAt is the newest reading extrapolated at the median slope", () => {
    const p = one(ramp("five_hour", [10, 20, 30], 10, RESET), at(20))
    expect(p?.runsOutAt).toBe(at(90))
  })

  test("runsOutAtLate uses the 25th percentile of the slopes", () => {
    const rs = [r("five_hour", 10, 0, RESET), r("five_hour", 30, 10, RESET), r("five_hour", 32, 20, RESET), r("five_hour", 60, 30, RESET)]
    const pts = pointsOf(rs)
    const p = one(rs, at(30))
    expect(p?.runsOutAt).toBe(T0 + Math.round((30 + (100 - 60) / quantile(slopesFrom(pts, 3), 0.5)) * MIN))
    expect(p?.runsOutAtLate).toBe(T0 + Math.round((30 + (100 - 60) / quantile(slopesFrom(pts, 3), 0.25)) * MIN))
    expect((p?.runsOutAtLate ?? 0) >= (p?.runsOutAt ?? 0)).toBe(true)
  })

  test("early is true exactly when the slow projection beats the reset by 30 minutes", () => {
    const readings = ramp("five_hour", [10, 20, 30], 10)
    const exact = one(readings.map((x) => ({ ...x, resetsAt: at(120) })), at(20))
    expect(exact?.early).toBe(true)
    const late = one(readings.map((x) => ({ ...x, resetsAt: at(120) - 1 })), at(20))
    expect(late?.early).toBe(false)
  })

  test("early is false without a known reset time", () => {
    const p = one(ramp("five_hour", [10, 20, 30], 10), at(20))
    expect(p?.runsOutAt).toBe(at(90))
    expect(p?.early).toBe(false)
  })

  test("a window already at 100 percent runs out at its newest reading", () => {
    const rs = ramp("five_hour", [10, 50, 100], 10, at(50))
    const p = one(rs, at(20))
    expect(p?.runsOutAt).toBe(at(20))
    expect(p?.runsOutAtLate).toBe(at(20))
    expect(p?.early).toBe(true)
  })

  test("100 percent half an hour before the reset is early, a moment less is not", () => {
    const tight = ramp("five_hour", [10, 50, 100], 10, at(50))
    expect(one(tight, at(20))?.early).toBe(true)
    const justUnder = ramp("five_hour", [10, 50, 100], 10, at(50) - 1)
    expect(one(justUnder, at(20))?.early).toBe(false)
  })

  test("100 percent without a reset time is not early", () => {
    const p = one(ramp("five_hour", [10, 50, 100], 10), at(20))
    expect(p?.runsOutAt).toBe(at(20))
    expect(p?.early).toBe(false)
  })

  test("the newest percent, not the maximum, sets the remaining budget", () => {
    const rs = [r("five_hour", 10, 0, RESET), r("five_hour", 50, 10, RESET), r("five_hour", 48, 20, RESET), r("five_hour", 58, 30, RESET)]
    const pts = pointsOf(rs)
    const slope = quantile(slopesFrom(pts, 3), 0.5)
    expect(one(rs, at(30))?.runsOutAt).toBe(T0 + Math.round((30 + (100 - 58) / slope) * MIN))
  })

  test("the slow projection is never earlier than the median one", () => {
    const datasets = [
      ramp("five_hour", [10, 22, 35, 41], 7, RESET),
      [r("five_hour", 10, 0, RESET), r("five_hour", 40, 10, RESET), r("five_hour", 42, 25, RESET), r("five_hour", 80, 40, RESET)],
      [r("five_hour", 5, 0, RESET), r("five_hour", 6, 4, RESET), r("five_hour", 30, 30, RESET)],
    ]
    for (const rs of datasets) {
      const p = one(rs, at(60))
      if (p?.runsOutAt !== undefined && p.runsOutAtLate !== undefined) {
        expect(p.runsOutAtLate >= p.runsOutAt).toBe(true)
      }
    }
  })
})

describe("ordering", () => {
  test("five_hour comes first, seven_day second, the rest alphabetically", () => {
    const rs = [
      ...ramp("beta", [10, 20, 30], 10, RESET),
      ...ramp("seven_day", [10, 20, 30], 10, RESET),
      ...ramp("alpha", [10, 20, 30], 10, RESET),
      ...ramp("five_hour", [10, 20, 30], 10, RESET),
    ]
    expect(project(rs, at(20)).map((p) => p.kind)).toEqual(["five_hour", "seven_day", "alpha", "beta"])
  })

  test("unknown kinds sort among themselves", () => {
    const rs = [...ramp("zeta", [10, 20, 30], 10), ...ramp("gamma", [10, 20, 30], 10), ...ramp("kiwi", [10, 20, 30], 10)]
    expect(project(rs, at(20)).map((p) => p.kind)).toEqual(["gamma", "kiwi", "zeta"])
  })

  test("seven_day_opus is an ordinary kind", () => {
    const rs = [
      ...ramp("seven_day_opus", [10, 20, 30], 10, RESET),
      ...ramp("seven_day", [10, 20, 30], 10, RESET),
      ...ramp("zeta", [10, 20, 30], 10, RESET),
    ]
    expect(project(rs, at(20)).map((p) => p.kind)).toEqual(["seven_day", "seven_day_opus", "zeta"])
  })

  test("the special names are case sensitive", () => {
    const rs = [...ramp("FIVE_HOUR", [10, 20, 30], 10), ...ramp("five_hour", [10, 20, 30], 10), ...ramp("seven_day", [10, 20, 30], 10)]
    expect(project(rs, at(20)).map((p) => p.kind)).toEqual(["five_hour", "seven_day", "FIVE_HOUR"])
  })

  test("each kind projects alone and together with the same numbers", () => {
    const five = ramp("five_hour", [10, 20, 30], 10, RESET)
    const seven = ramp("seven_day", [40, 45, 50], 10, RESET)
    const aloneFive = one(five, at(20))
    const aloneSeven = one(seven, at(20), "seven_day")
    const together = project([...five, ...seven], at(20))
    expect(together).toHaveLength(2)
    expect(together[0]).toEqual(aloneFive)
    expect(together[1]).toEqual(aloneSeven)
  })

  test("non-ASCII kinds sort by code unit, deterministically", () => {
    const rs = [...ramp("źeta", [10, 20, 30], 10), ...ramp("άνω", [10, 20, 30], 10), ...ramp("五時", [10, 20, 30], 10)]
    const order = project(rs, at(20)).map((p) => p.kind)
    expect(order).toEqual([...order].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)))
    expect(order).toHaveLength(3)
  })

  test("an empty kind name is an ordinary kind", () => {
    const rs = [...ramp("", [10, 20, 30], 10, RESET), ...ramp("alpha", [10, 20, 30], 10, RESET)]
    expect(project(rs, at(20)).map((p) => p.kind)).toEqual(["", "alpha"])
  })
})

function pr(kind: WindowKind, resetsAt: number | undefined, runsOutAtLate: number | undefined, early: boolean): Projection {
  return { kind, resetsAt, runsOutAt: runsOutAtLate, runsOutAtLate, early }
}

describe("hotness", () => {
  test("an early projection turns the kind hot", () => {
    const out = hotness({ hot: {} }, [pr("five_hour", RESET, at(90), true)])
    expect(out.hot).toEqual(["five_hour"])
    expect(out.changed).toBe(true)
    expect(out.state.hot["five_hour:" + RESET]).toBe(true)
  })

  test("a projection that is not early leaves the kind cold", () => {
    const out = hotness({ hot: {} }, [pr("five_hour", RESET, at(90), false)])
    expect(out.hot).toEqual([])
    expect(out.changed).toBe(false)
    expect(out.state.hot).toEqual({})
  })

  test("a hot kind stays hot inside the 10 to 30 minute band", () => {
    const key = "five_hour:" + RESET
    const prev: HotState = { hot: { [key]: true } }
    const out = hotness(prev, [pr("five_hour", RESET, RESET - 20 * MIN, false)])
    expect(out.hot).toEqual(["five_hour"])
    expect(out.changed).toBe(false)
    expect(out.state.hot[key]).toBe(true)
  })

  test("a hot kind stays hot exactly ten minutes before the reset", () => {
    const prev: HotState = { hot: { ["five_hour:" + RESET]: true } }
    const out = hotness(prev, [pr("five_hour", RESET, RESET - 10 * MIN, false)])
    expect(out.hot).toEqual(["five_hour"])
    expect(out.changed).toBe(false)
  })

  test("a hot kind holds until the median clears reset plus ten minutes", () => {
    const prev: HotState = { hot: { ["five_hour:" + RESET]: true } }
    const out = hotness(prev, [pr("five_hour", RESET, RESET - 10 * MIN + 1, false)])
    expect(out.hot).toEqual(["five_hour"])
    expect(out.changed).toBe(false)
    expect(out.state.hot).toEqual(prev.hot)
    expect(hotness(prev, [pr("five_hour", RESET, RESET + 10 * MIN - 1, false)]).hot).toEqual(["five_hour"])
    const cleared = hotness(prev, [pr("five_hour", RESET, RESET + 10 * MIN, false)])
    expect(cleared.hot).toEqual([])
    expect(cleared.changed).toBe(true)
    expect(cleared.state.hot).toEqual({})
  })

  test("a window reset drops the hot state even mid band", () => {
    const A = T0 + 2 * HOUR
    const prev: HotState = { hot: { ["five_hour:" + A]: true } }
    const out = hotness(prev, [pr("five_hour", RESET, RESET - 20 * MIN, false)])
    expect(out.hot).toEqual([])
    expect(out.changed).toBe(true)
    expect(out.state.hot).toEqual({})
  })

  test("a kind with no projection at all cools down", () => {
    const prev: HotState = { hot: { ["five_hour:" + RESET]: true } }
    const out = hotness(prev, [])
    expect(out.hot).toEqual([])
    expect(out.changed).toBe(true)
  })

  test("a projection that lost its rate retains the same-window warning", () => {
    const prev: HotState = { hot: { ["five_hour:" + RESET]: true } }
    const out = hotness(prev, [{ kind: "five_hour", resetsAt: RESET, early: false }])
    expect(out.hot).toEqual(["five_hour"])
    expect(out.changed).toBe(false)
  })

  test("the kind can turn hot again after the reset", () => {
    const A = T0 + 2 * HOUR
    const prev: HotState = { hot: { ["five_hour:" + A]: true } }
    const out = hotness(prev, [pr("five_hour", RESET, RESET - 45 * MIN, true)])
    expect(out.hot).toEqual(["five_hour"])
    expect(out.state.hot).toEqual({ ["five_hour:" + RESET]: true })
  })

  test("two kinds decide independently", () => {
    const prev: HotState = { hot: { ["five_hour:" + RESET]: true } }
    const out = hotness(prev, [pr("seven_day", RESET, at(90), true), pr("five_hour", RESET, RESET - 20 * MIN, false)])
    expect(out.hot).toEqual(["five_hour", "seven_day"])
    expect(out.changed).toBe(true)
  })

  test("a kind that stays hot reports no change", () => {
    const prev: HotState = { hot: { ["five_hour:" + RESET]: true, ["seven_day:" + RESET]: true } }
    const out = hotness(prev, [pr("five_hour", RESET, RESET - 25 * MIN, false), pr("seven_day", RESET, at(1), true)])
    expect(out.changed).toBe(false)
    expect(out.hot).toEqual(["five_hour", "seven_day"])
  })

  test("the previous state is never mutated", () => {
    const prev: HotState = { hot: { ["five_hour:" + RESET]: true } }
    const frozen = Object.freeze(prev)
    const frozenHot = Object.freeze(frozen.hot)
    const out = hotness(frozen, [pr("seven_day", RESET, at(90), true)])
    expect(out.hot).toEqual(["seven_day"])
    expect(frozenHot).toEqual({ ["five_hour:" + RESET]: true })
    expect(out.state).not.toBe(frozen)
  })

  test("a window without a reset time can never be hot", () => {
    const prev: HotState = { hot: { ["five_hour:undefined"]: true } }
    const out = hotness(prev, [pr("five_hour", undefined, at(90), false)])
    expect(out.hot).toEqual([])
    expect(out.changed).toBe(true)
  })

  test("the sign does not flicker across 50 noisy readings", () => {
    const readings: Reading[] = []
    let p = 8
    let minute = 0
    for (let i = 0; i < 50; i++) {
      readings.push(r("five_hour", p, minute, RESET))
      minute += i % 2 === 0 ? 6 : 2
      p += i % 2 === 0 ? 2 : 0
    }
    // The slow projection does not depend on the reset time, so first look at
    // how much it wobbles and then park the reset so that the raw early flag
    // would flip repeatedly without hysteresis.
    const lateSeries = readings.map((_, i) => one(readings.slice(0, i + 1), readings[i].at)?.runsOutAtLate)
    const tail = lateSeries.slice(25).filter((x): x is number => x !== undefined)
    expect(tail.length).toBeGreaterThan(10)
    const lo = Math.min(...tail)
    const hi = Math.max(...tail)
    expect(hi - lo).toBeGreaterThan(MIN)
    const reset = (lo + hi) / 2 + 30 * MIN
    const stamped = readings.map((x) => ({ ...x, resetsAt: reset }))
    const rawEarly = readings.map((_, i) =>
      one(stamped.slice(0, i + 1), stamped[i].at)?.early === true)
    let rawFlips = 0
    for (let i = 1; i < rawEarly.length; i++) if (rawEarly[i] !== rawEarly[i - 1]) rawFlips++
    expect(rawFlips).toBeGreaterThan(20) // without hysteresis the sign would flicker
    const instrument = stamped.map(x => ({ ...x, resetsAt: reset + MIN }))
    let state: HotState = { hot: {} }
    let firstHot = -1
    let offAfterHot = 0
    let changes = 0
    for (let i = 0; i < instrument.length; i++) {
      const projections = project(instrument.slice(0, i + 1), instrument[i].at)
      const out = hotness(state, projections)
      if (out.hot.includes("five_hour") && firstHot < 0) firstHot = i
      if (firstHot >= 0 && !out.hot.includes("five_hour")) offAfterHot++
      if (out.changed) changes++
      state = out.state
    }
    expect(firstHot).toBeGreaterThanOrEqual(0)
    expect(offAfterHot).toBe(0)
    expect(changes).toBe(1)
  })

  test("a kind that resets and is immediately hot again keeps the sign on", () => {
    const A = T0 + 2 * HOUR
    const prev: HotState = { hot: { ["five_hour:" + A]: true } }
    const out = hotness(prev, [pr("five_hour", RESET, RESET - 45 * MIN, true)])
    expect(out.hot).toEqual(["five_hour"])
    expect(out.changed).toBe(false)
  })

  test("empty and malformed inputs behave", () => {
    expect(hotness({ hot: {} }, []).hot).toEqual([])
    expect(hotness({ hot: {} }, [null as unknown as Projection, pr("five_hour", RESET, at(1), true)]).hot).toEqual(["five_hour"])
  })
})

describe("crossed", () => {
  test("reports the thresholds reached or passed, ascending", () => {
    expect(crossed(41, 55, [50, 80, 45])).toEqual([45, 50])
  })

  test("a threshold exactly met counts", () => {
    expect(crossed(49.999, 50, [50])).toEqual([50])
    expect(crossed(50, 50, [50])).toEqual([])
  })

  test("an undefined previous means no crossing", () => {
    expect(crossed(undefined, 100, [10, 50, 90])).toEqual([])
  })

  test("unsorted thresholds come back sorted", () => {
    expect(crossed(10, 40, [90, 30, 15, 60])).toEqual([15, 30])
  })

  test("the same threshold twice is reported once", () => {
    expect(crossed(10, 40, [30, 30])).toEqual([30])
  })

  test("a falling current reports nothing", () => {
    expect(crossed(80, 20, [50])).toEqual([])
  })

  test("negative and zero thresholds work", () => {
    expect(crossed(-10, 5, [-5, 0, 3])).toEqual([-5, 0, 3])
  })

  test("non-finite thresholds and values are ignored", () => {
    expect(crossed(10, 40, [Number.NaN, 30, Number.POSITIVE_INFINITY])).toEqual([30])
    expect(crossed(Number.NaN, 40, [30])).toEqual([])
    expect(crossed(10, Number.NaN, [30])).toEqual([])
  })

  test("crossing is stateless and repeatable", () => {
    expect(crossed(10, 40, [30])).toEqual(crossed(10, 40, [30]))
    expect(crossed(10, 40, [])).toEqual([])
  })

  test("many thresholds at once", () => {
    expect(crossed(0, 100, [1, 25, 50, 75, 99, 100])).toEqual([1, 25, 50, 75, 99, 100])
  })
})

describe("shouldWarn", () => {
  test("warns once per window period", () => {
    const first = shouldWarn({ warned: {} }, "five_hour", RESET, "runs_out")
    expect(first.warn).toBe(true)
    expect(first.state.warned["five_hour:" + RESET + ":runs_out"]).toBe(true)
    const second = shouldWarn(first.state, "five_hour", RESET, "runs_out")
    expect(second.warn).toBe(false)
    expect(second.state).toEqual(first.state)
  })

  test("a different reason warns again", () => {
    const first = shouldWarn({ warned: {} }, "five_hour", RESET, "runs_out")
    const other = shouldWarn(first.state, "five_hour", RESET, "nearly_reset")
    expect(other.warn).toBe(true)
  })

  test("a new resetsAt warns again", () => {
    const first = shouldWarn({ warned: {} }, "five_hour", T0 + 2 * HOUR, "runs_out")
    expect(first.warn).toBe(true)
    const next = shouldWarn(first.state, "five_hour", RESET, "runs_out")
    expect(next.warn).toBe(true)
  })

  test("an unknown reset time has its own key", () => {
    const first = shouldWarn({ warned: {} }, "five_hour", undefined, "runs_out")
    expect(first.warn).toBe(true)
    expect(shouldWarn(first.state, "five_hour", undefined, "runs_out").warn).toBe(false)
    expect(shouldWarn(first.state, "five_hour", RESET, "runs_out").warn).toBe(true)
  })

  test("kinds warn independently", () => {
    const first = shouldWarn({ warned: {} }, "five_hour", RESET, "runs_out")
    expect(shouldWarn(first.state, "seven_day", RESET, "runs_out").warn).toBe(true)
    expect(shouldWarn(first.state, "five_hour", RESET, "runs_out").warn).toBe(false)
  })

  test("the input state is never mutated", () => {
    const state: ReminderState = Object.freeze({ warned: Object.freeze({ ["five_hour:" + RESET + ":runs_out"]: true }) })
    const out = shouldWarn(state, "five_hour", RESET, "runs_out")
    expect(out.warn).toBe(false)
    expect(out.state).toBe(state)
    const out2 = shouldWarn(state, "five_hour", RESET, "something_else")
    expect(out2.warn).toBe(true)
    expect(out2.state).not.toBe(state)
    expect(state.warned).toEqual({ ["five_hour:" + RESET + ":runs_out"]: true })
  })

  test("two windows in a row each warn exactly once", () => {
    const A = T0 + 2 * HOUR
    let state: ReminderState = { warned: {} }
    const seen: boolean[] = []
    for (const reset of [A, RESET, RESET]) {
      const out = shouldWarn(state, "five_hour", reset, "runs_out")
      seen.push(out.warn)
      state = out.state
    }
    expect(seen).toEqual([true, true, false])
  })

  test("a zero resetsAt is a real key, not the unknown one", () => {
    const first = shouldWarn({ warned: {} }, "five_hour", 0, "runs_out")
    expect(first.warn).toBe(true)
    expect(shouldWarn(first.state, "five_hour", 0, "runs_out").warn).toBe(false)
    expect(shouldWarn(first.state, "five_hour", undefined, "runs_out").warn).toBe(true)
  })

  test("malformed state objects still work", () => {
    expect(shouldWarn({} as ReminderState, "five_hour", RESET, "runs_out").warn).toBe(true)
    expect(shouldWarn(undefined as unknown as ReminderState, "five_hour", RESET, "runs_out").warn).toBe(true)
  })
})

// Deterministic RNG for the fuzz tests (mulberry32, same family as the sim).
function fuzzRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function fuzzNumber(rand: () => number): number {
  const pick = rand()
  if (pick < 0.08) return Number.NaN
  if (pick < 0.12) return Number.POSITIVE_INFINITY
  if (pick < 0.16) return Number.NEGATIVE_INFINITY
  if (pick < 0.2) return 0
  if (pick < 0.24) return -0
  if (pick < 0.3) return Math.floor(rand() * 1e15)
  if (pick < 0.36) return -Math.floor(rand() * 1e15)
  if (pick < 0.5) return Math.round(rand() * 100 * 10) / 10
  return (rand() - 0.5) * 2e12
}

function fuzzString(rand: () => number): string {
  const n = 1 + Math.floor(rand() * 12)
  let out = ""
  for (let i = 0; i < n; i++) {
    const pick = rand()
    let cp: number
    if (pick < 0.15) cp = Math.floor(rand() * 0x20)
    else if (pick < 0.3) cp = 0xd800 + Math.floor(rand() * 0x7ff)
    else if (pick < 0.4) cp = 0xe000 + Math.floor(rand() * 0x800)
    else if (pick < 0.5) cp = 0x10000 + Math.floor(rand() * 0xffff)
    else cp = 1 + Math.floor(rand() * 0x2fff)
    out += String.fromCodePoint(cp)
  }
  if (rand() < 0.05) out = out.repeat(300)
  return out
}

function fuzzReading(rand: () => number): Reading {
  const reading: Reading = { kind: fuzzString(rand), percentUsed: fuzzNumber(rand), at: T0 + Math.round((rand() - 0.3) * 4 * HOUR) }
  if (rand() < 0.7) reading.resetsAt = T0 + Math.round(rand() * 8 * HOUR)
  return reading
}

const saneProjection = (p: Projection): void => {
  expect(typeof p.kind).toBe("string")
  expect(typeof p.early).toBe("boolean")
  if (p.ratePerHour !== undefined) {
    expect(p.ratePerHour).toBeGreaterThan(0)
    expect(Number.isFinite(p.ratePerHour)).toBe(true)
  }
  if (p.runsOutAt !== undefined) expect(Number.isFinite(p.runsOutAt)).toBe(true)
  if (p.runsOutAt !== undefined && p.runsOutAtLate !== undefined) expect(p.runsOutAtLate).toBeGreaterThanOrEqual(p.runsOutAt)
}

describe("robustness", () => {
  test("empty input", () => {
    expect(project([], 0)).toEqual([])
    expect(project([], T0)).toEqual([])
  })

  test("a non-array input", () => {
    expect(project(undefined as unknown as Reading[], T0)).toEqual([])
    expect(project(null as unknown as Reading[], T0)).toEqual([])
    expect(project({} as unknown as Reading[], T0)).toEqual([])
  })

  test("a non-finite now", () => {
    expect(project(ramp("five_hour", [10, 20, 30], 10, RESET), Number.NaN)).toEqual([])
    expect(project(ramp("five_hour", [10, 20, 30], 10, RESET), Number.POSITIVE_INFINITY)).toEqual([])
  })

  test("ten thousand readings inside fifty milliseconds", () => {
    const readings: Reading[] = []
    for (let i = 0; i < 10_000; i++) {
      readings.push({ kind: "five_hour", percentUsed: 10 + (i % 40), resetsAt: RESET, at: T0 + (i % 50) })
    }
    const started = performance.now()
    const out = project(readings, T0 + 100)
    const elapsed = performance.now() - started
    expect(Array.isArray(out)).toBe(true)
    // Measured around a millisecond; the budget the spec names is fifty.
    expect(elapsed).toBeLessThan(50)
  })

  test("eight thousand readings over six hours", () => {
    const readings: Reading[] = []
    for (let i = 0; i < 8_000; i++) {
      const minute = (i / 8000) * 360
      readings.push({ kind: "five_hour", percentUsed: Math.min(99, 5 + (i / 8000) * 90), resetsAt: T0 + 8 * HOUR, at: T0 + Math.round(minute * MIN) })
    }
    const started = performance.now()
    const out = project(readings, T0 + 360 * MIN)
    const elapsed = performance.now() - started
    expect(out).toHaveLength(1)
    expect(elapsed).toBeLessThan(1500)
  })

  test("thirty thousand readings collapse into one window without exploding", () => {
    const readings: Reading[] = []
    for (let i = 0; i < 30_000; i++) {
      readings.push({ kind: "five_hour", percentUsed: 10, resetsAt: RESET, at: T0 + i })
    }
    const out = project(readings, T0 + 30_000)
    expect(out).toHaveLength(1)
    expect(out[0].ratePerHour).toBeUndefined()
  })

  test("readings before the epoch and far in the future", () => {
    const old = [-5000, -4000, -3000].map((at, i) => ({ kind: "five_hour", percentUsed: 10 + i * 5, resetsAt: 60_000, at }))
    expect(project(old, 0)).toHaveLength(1)
    const far = [1e14, 1e14 + 6e5, 1e14 + 12e5].map((at, i) => ({ kind: "five_hour", percentUsed: 10 + i * 5, resetsAt: 1e15, at }))
    expect(project(far, 1e14 + 12e5)).toHaveLength(1)
  })

  test("the input is never mutated", () => {
    const readings = [r("five_hour", 30, 0, RESET), r("five_hour", 42, 12, RESET), r("five_hour", 51, 25, RESET)]
    for (const x of readings) Object.freeze(x)
    const frozen = Object.freeze([...readings])
    const before = JSON.stringify(readings)
    project(frozen, at(25))
    hotness(Object.freeze({ hot: Object.freeze({}) }), project(frozen, at(25)))
    expect(JSON.stringify(readings)).toBe(before)
    expect(frozen.length).toBe(3)
  })

  test("a projection of a frozen previous state round trips", () => {
    const prev: HotState = Object.freeze({ hot: Object.freeze({ ["five_hour:" + RESET]: true }) })
    // Reinspection has the same reading stamp. Two bare synthetic forecasts
    // instead represent two observations and advance the public fresh count.
    const projections = project([r("five_hour", 10, 0, RESET), r("five_hour", 40, 10, RESET), r("five_hour", 70, 20, RESET)], at(20))
    const first = hotness(prev, projections)
    const second = hotness(first.state, projections)
    expect(first.state).toEqual(second.state)
    expect(prev.hot).toEqual({ ["five_hour:" + RESET]: true })
  })
})

describe("fuzz", () => {
  test("project survives 2000 random inputs", () => {
    const rand = fuzzRng(0xc0ffee)
    for (let i = 0; i < 2000; i++) {
      const count = Math.floor(rand() * 26)
      const readings: unknown[] = []
      for (let k = 0; k < count; k++) {
        const shape = rand()
        if (shape < 0.05) readings.push(null)
        else if (shape < 0.1) readings.push(fuzzNumber(rand))
        else if (shape < 0.15) readings.push({ kind: fuzzNumber(rand), percentUsed: fuzzNumber(rand), at: fuzzNumber(rand) })
        else readings.push(fuzzReading(rand))
      }
      const now = fuzzNumber(rand)
      const out = project(readings as Reading[], now)
      expect(Array.isArray(out)).toBe(true)
      for (const p of out) saneProjection(p)
      const kinds = out.map((p) => p.kind)
      expect([...kinds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual(kinds)
    }
  })

  test("hotness survives 2000 random inputs", () => {
    const rand = fuzzRng(0xbadc0de)
    for (let i = 0; i < 2000; i++) {
      const hot: Record<string, true> = {}
      const hotCount = Math.floor(rand() * 4)
      for (let k = 0; k < hotCount; k++) hot[fuzzString(rand) + ":" + Math.round(rand() * 1e12)] = true
      const prev: HotState = { hot }
      const snapshot = JSON.stringify(prev)
      const projections: Projection[] = []
      const n = Math.floor(rand() * 8)
      for (let k = 0; k < n; k++) {
        const resetsAt = rand() < 0.8 ? Math.round(rand() * 1e12) : undefined
        const late = rand() < 0.8 ? Math.round(rand() * 1e12) : undefined
        projections.push({ kind: fuzzString(rand), resetsAt, runsOutAt: late, runsOutAtLate: late, early: rand() < 0.5 })
      }
      const out = hotness(prev, projections)
      expect(Array.isArray(out.hot)).toBe(true)
      expect(typeof out.changed).toBe("boolean")
      expect(JSON.stringify(prev)).toBe(snapshot)
      for (const kind of out.hot) expect(typeof kind).toBe("string")
    }
  })

  test("crossed survives 2000 random inputs", () => {
    const rand = fuzzRng(0x5eed)
    for (let i = 0; i < 2000; i++) {
      const previous = rand() < 0.25 ? undefined : fuzzNumber(rand)
      const current = fuzzNumber(rand)
      const thresholds: number[] = []
      const n = Math.floor(rand() * 12)
      for (let k = 0; k < n; k++) thresholds.push(fuzzNumber(rand))
      const out = crossed(previous, current, thresholds)
      expect(Array.isArray(out)).toBe(true)
      for (let k = 1; k < out.length; k++) expect(out[k]).toBeGreaterThanOrEqual(out[k - 1])
      for (const v of out) expect(Number.isFinite(v)).toBe(true)
    }
  })

  test("shouldWarn survives 2000 random inputs", () => {
    const rand = fuzzRng(0xf00d)
    for (let i = 0; i < 2000; i++) {
      const warned: Record<string, true> = {}
      const n = Math.floor(rand() * 5)
      for (let k = 0; k < n; k++) warned[fuzzString(rand) + ":" + fuzzString(rand) + ":" + fuzzString(rand)] = true
      const state: ReminderState = { warned }
      const snapshot = JSON.stringify(state)
      const kind = fuzzString(rand)
      const resetsAt = rand() < 0.2 ? undefined : fuzzNumber(rand)
      const reason = fuzzString(rand)
      const out = shouldWarn(state, kind, resetsAt, reason)
      expect(typeof out.warn).toBe("boolean")
      expect(out.state.warned).toBeInstanceOf(Object)
      expect(JSON.stringify(state)).toBe(snapshot)
      if (out.warn) expect(out.state.warned).not.toBe(state.warned)
    }
  })
})

function scanSession(s: SimSession): { violations: number; rawViolations: number; worstMargin: number; i0: number; detected: boolean; usable: boolean; observations: number; shortestSwitch: number } {
  let violations = 0, rawViolations = 0, worstMargin = Number.NEGATIVE_INFINITY, i0 = -1, detected = false, observations = 0;
  let measuredState: HotState = { hot: {} };
  let referenceState: HotState = { hot: {} };
  let previousHot = false, lastSwitch = -Infinity, shortestSwitch = Infinity;
  for (let i = 0; i < s.readings.length; i++) {
    const now = s.truth[i].at;
    const measured = hotness(measuredState, project(s.readings.slice(0, i + 1), now));
    const exactProjections = project(s.exactReadings.slice(0, i + 1), now);
    const exact = exactProjections.find(p => p.kind === s.kind);
    const reference = hotness(referenceState, exactProjections);
    measuredState = measured.state;
    referenceState = reference.state;
    const got = measured.hot.includes(s.kind), ideal = reference.hot.includes(s.kind);
    if (got && exact?.early !== true) rawViolations++;
    observations++;
    if (got !== previousHot) { shortestSwitch = Math.min(shortestSwitch, i - lastSwitch); lastSwitch = i; }
    previousHot = got;
    if (got && !ideal) {
      violations++;
      if (exact?.runsOutAtLate !== undefined) worstMargin = Math.max(worstMargin, (s.truth[i].resetsAt - exact.runsOutAtLate) / MIN);
    }
    if (i0 < 0 && exact?.early === true && exact.runsOutAtLate !== undefined) i0 = i;
    if (i0 >= 0 && !detected && got) detected = i <= i0 + 3;
  }
  return { violations, rawViolations, worstMargin, i0, detected, usable: i0 >= 0 && i0 + 3 < s.readings.length, observations, shortestSwitch };
}

function realizedWallClockRate(s: SimSession): number {
  const unique: Reading[] = [];
  for (const reading of s.readings) {
    if (unique.length && unique[unique.length - 1].at === reading.at) unique[unique.length - 1] = reading;
    else unique.push(reading);
  }
  const newest = unique[unique.length - 1];
  let unknownStart = 0;
  if (newest.resetsAt === undefined) {
    unknownStart = unique.length - 1;
    while (unknownStart > 0 && unique[unknownStart - 1].resetsAt === undefined) unknownStart--;
  }
  let segmentStart = unknownStart, maximum = -Infinity, reset: number | undefined;
  for (let i = unknownStart; i < unique.length; i++) {
    const x = unique[i];
    if (i === unknownStart || (x.resetsAt !== undefined && x.resetsAt !== reset) || maximum - x.percentUsed >= 5) {
      segmentStart = i; maximum = x.percentUsed; reset = x.resetsAt;
    } else { maximum = Math.max(maximum, x.percentUsed); if (x.resetsAt !== undefined) reset = x.resetsAt; }
  }
  const horizon = unique.slice(segmentStart).filter(x => newest.at - x.at <= 90 * MIN && x.resetsAt === newest.resetsAt);
  if (horizon.length < 2) return 0;
  const first = horizon[0], last = horizon[horizon.length - 1];
  const truth = new Map(s.truth.map(x => [x.at, x.truePercent]));
  return ((truth.get(last.at) ?? 0) - (truth.get(first.at) ?? 0)) * HOUR / (last.at - first.at);
}

describe("simulator", () => {
  test("the same seed replays the same session", () => {
    expect(simulateSession(42)).toEqual(simulateSession(42))
    expect(simulateSession(7, { kind: "seven_day" })).toEqual(simulateSession(7, { kind: "seven_day" }))
  })

  test("different seeds give different sessions", () => {
    expect(simulateSession(1).readings).not.toEqual(simulateSession(2).readings)
  })

  test("session shape: bursts, idles, rounding, missing resets, resets", () => {
    let missingResets = 0
    let wholePercent = 0
    let total = 0
    let resets = 0
    for (let seed = 1; seed <= 50; seed++) {
      const s = simulateSession(seed)
      expect(s.readings.length).toBe(s.truth.length)
      expect(s.readings.length).toBeGreaterThan(9)
      expect(s.kind).toBe("five_hour")
      resets += s.resets
      let previous = Number.NEGATIVE_INFINITY
      for (let i = 0; i < s.readings.length; i++) {
        const x = s.readings[i]
        total++
        expect(x.percentUsed).toBeGreaterThanOrEqual(0)
        expect(x.percentUsed).toBeLessThanOrEqual(100)
        expect(x.at).toBeGreaterThanOrEqual(previous)
        previous = x.at
        expect(x.at).toBe(s.truth[i].at)
        if (x.resetsAt === undefined) missingResets++
        if (Number.isInteger(x.percentUsed)) wholePercent++
        const gap = (x.at - (i > 0 ? s.readings[i - 1].at : x.at - 60_000)) / MIN
        expect(gap <= 3.01 || gap >= 15).toBe(true)
      }
    }
    expect(missingResets).toBeGreaterThan(0)
    expect(wholePercent / total).toBeGreaterThan(0.8)
    expect(resets).toBeGreaterThan(0)
  })

  test("a short window forces a reset in the middle", () => {
    const s = simulateSession(91, { windowMs: 40 * MIN, maxDurationMs: 4 * HOUR, startPercent: 40 })
    expect(s.resets).toBeGreaterThanOrEqual(1)
    const afterReset = s.truth.filter((t) => t.at >= t.windowStartAt + 5 * MIN)
    expect(afterReset.length).toBeGreaterThan(3)
  })

  test("the estimated pace tracks the realized wall-clock pace over the same horizon", () => {
    const ratios: number[] = []
    for (let seed = 1; seed <= 300; seed++) {
      const s = simulateSession(seed)
      const realized = realizedWallClockRate(s)
      if (!(realized > 0)) continue
      const p = project(s.readings, s.truth[s.truth.length - 1].at).find((x) => x.kind === s.kind)
      if (p?.ratePerHour !== undefined) ratios.push(p.ratePerHour / realized)
    }
    ratios.sort((a, b) => a - b)
    const median = ratios[Math.floor(ratios.length / 2)]
    const low = ratios[Math.floor(ratios.length * 0.1)]
    console.log("G2 wall-clock ratios", JSON.stringify({ count: ratios.length, median, low }))
    expect(ratios.length).toBeGreaterThan(200)
    expect(median).toBeGreaterThan(0.8)
    expect(median).toBeLessThan(1.15)
    expect(low).toBeGreaterThan(0.6)
  })

  const sessions = (from: number, to: number): SimSession[] => {
    const out: SimSession[] = []
    for (let seed = from; seed <= to; seed++) out.push(simulateSession(seed))
    return out
  }

  test("no false alarms and detection within three readings (sessions 1-250)", () => {
    const scans = sessions(1, 250).map(scanSession)
    const dirty = scans.filter((x) => x.violations > 0)
    const observations = scans.reduce((sum, x) => sum + x.observations, 0)
    const violations = scans.reduce((sum, x) => sum + x.violations, 0)
    const usable = scans.filter((x) => x.usable)
    const detected = usable.filter((x) => x.detected)
    const shortestSwitch = Math.min(...scans.map(x => x.shortestSwitch))
    const rawDirty = scans.filter(x => x.rawViolations > 0).length, rawViolations = scans.reduce((sum, x) => sum + x.rawViolations, 0)
    console.log("G3 simulation metrics", JSON.stringify({ half: "train", dirty: dirty.length, observations, violations, falseFraction: violations / observations, rawDirty, rawViolations, rawFalseFraction: rawViolations / observations, worstMargin: Math.max(...scans.map(x => x.worstMargin)), detected: detected.length, usable: usable.length, detection: detected.length / usable.length, shortestSwitch }))
    // A whole-percent reading moves the conservative projection by a few
    // minutes, so a hard thirty minute line cannot be resolved to the minute:
    // what must never happen is an alarm while the truth is clearly safe.
    for (const x of scans) expect(x.worstMargin).toBeLessThan(45)
    expect(dirty.length).toBeLessThan(scans.length * 0.1)
    expect(violations / observations).toBeLessThan(0.01)
    expect(shortestSwitch).toBeGreaterThanOrEqual(3)
    expect(detected.length / usable.length).toBeGreaterThanOrEqual(0.95)
  }, 120_000)

  test("no false alarms and detection within three readings (sessions 251-500)", () => {
    const scans = sessions(251, 500).map(scanSession)
    const dirty = scans.filter((x) => x.violations > 0)
    const observations = scans.reduce((sum, x) => sum + x.observations, 0)
    const violations = scans.reduce((sum, x) => sum + x.violations, 0)
    const usable = scans.filter((x) => x.usable)
    const detected = usable.filter((x) => x.detected)
    const shortestSwitch = Math.min(...scans.map(x => x.shortestSwitch))
    const rawDirty = scans.filter(x => x.rawViolations > 0).length, rawViolations = scans.reduce((sum, x) => sum + x.rawViolations, 0)
    console.log("G3 simulation metrics", JSON.stringify({ half: "heldout", dirty: dirty.length, observations, violations, falseFraction: violations / observations, rawDirty, rawViolations, rawFalseFraction: rawViolations / observations, worstMargin: Math.max(...scans.map(x => x.worstMargin)), detected: detected.length, usable: usable.length, detection: detected.length / usable.length, shortestSwitch }))
    for (const x of scans) expect(x.worstMargin).toBeLessThan(45)
    expect(dirty.length).toBeLessThan(scans.length * 0.1)
    expect(violations / observations).toBeLessThan(0.01)
    expect(shortestSwitch).toBeGreaterThanOrEqual(3)
    expect(detected.length / usable.length).toBeGreaterThanOrEqual(0.95)
  }, 120_000)

  test("the sign stays stable along a whole simulated session", () => {
    for (const seed of [3, 17, 61, 144, 233, 377]) {
      const s = simulateSession(seed)
      let state: HotState = { hot: {} }
      let prevKey = ""
      let prevHot = false
      let prevSwitch = -10
      let switches = 0
      let changes = 0
      for (let i = 0; i < s.readings.length; i++) {
        const projections = project(s.readings.slice(0, i + 1), s.truth[i].at)
        const out = hotness(state, projections)
        if (out.changed) changes++
        const p = projections.find((x) => x.kind === s.kind)
        const key = p && p.resetsAt !== undefined ? s.kind + ":" + p.resetsAt : ""
        const hot = out.hot.includes(s.kind)
        // a switch inside the same window means the pace genuinely moved;
        // two of them close together would be flapping
        if (key !== "" && key === prevKey && hot !== prevHot) {
          expect(i - prevSwitch).toBeGreaterThanOrEqual(3)
          prevSwitch = i
          switches++
        }
        prevKey = key
        prevHot = hot
        state = out.state
      }
      expect(switches).toBeLessThanOrEqual(6)
      expect(changes).toBeLessThanOrEqual(s.resets + 6)
    }
  })
})

// Generic invariants every projection list must hold.
function checkInvariants(ps: Projection[]): void {
  expect(Array.isArray(ps)).toBe(true)
  for (const p of ps) saneProjection(p)
  const kinds = ps.map((p) => p.kind)
  expect(new Set(kinds).size).toBe(kinds.length)
  const ranked = (k: string): number => (k === "five_hour" ? 0 : k === "seven_day" ? 1 : 2)
  const sorted = [...kinds].sort((a, b) => ranked(a) - ranked(b) || (a < b ? -1 : a > b ? 1 : 0))
  expect(kinds).toEqual(sorted)
}

const bigKind = "kiwi".repeat(2500)

interface Case {
  name: string
  readings: Reading[]
  now: number
  check?: (ps: Projection[]) => void
}

const redTeam: Case[] = [
  {
    name: "a very long kind name",
    readings: ramp(bigKind, [10, 20, 30], 10, RESET),
    now: at(20),
    check: (ps) => expect(ps[0].ratePerHour).toBe(60),
  },
  {
    name: "kinds differing only by case and emoji",
    readings: [...ramp("five_hour", [10, 20, 30], 10, RESET), ...ramp("FIVE_HOUR", [10, 20, 30], 10, RESET), ...ramp("🔥five_hour", [10, 20, 30], 10, RESET)],
    now: at(20),
    check: (ps) => expect(ps.map((p) => p.kind)).toEqual(["five_hour", "FIVE_HOUR", "🔥five_hour"]),
  },
  {
    name: "a kind with a colon survives the hotness key",
    readings: ramp("api:v2", [10, 20, 30], 10, RESET),
    now: at(20),
    check: (ps) => {
      const out = hotness({ hot: {} }, ps)
      expect(out.hot).toEqual(["api:v2"])
      expect(Object.keys(out.state.hot)).toEqual(["api:v2:" + RESET])
      const again = hotness(out.state, ps)
      expect(again.hot).toEqual(["api:v2"])
    },
  },
  {
    name: "all readings at zero percent",
    readings: ramp("five_hour", [0, 0, 0, 0], 10, RESET),
    now: at(30),
    check: (ps) => expect(ps[0].ratePerHour).toBeUndefined(),
  },
  {
    name: "99.99 percent is not a burnt window",
    readings: ramp("five_hour", [96, 98, 99.99], 10, at(60)),
    now: at(20),
    check: (ps) => expect(ps[0].runsOutAt).not.toBe(at(20)),
  },
  {
    name: "repeated 100 percent readings",
    readings: ramp("five_hour", [100, 100, 100], 10, at(90)),
    now: at(20),
    check: (ps) => {
      expect(ps[0].runsOutAt).toBe(at(20))
      expect(ps[0].early).toBe(true)
    },
  },
  {
    name: "100 percent exactly half an hour before the reset",
    readings: ramp("five_hour", [40, 70, 100], 10, at(50)),
    now: at(20),
    check: (ps) => expect(ps[0].early).toBe(true),
  },
  {
    name: "100 percent twenty nine minutes before the reset",
    readings: ramp("five_hour", [40, 70, 100], 10, at(49)),
    now: at(20),
    check: (ps) => expect(ps[0].early).toBe(false),
  },
  {
    name: "the reset time bounces between two values",
    readings: [r("five_hour", 10, 0, T0 + HOUR), r("five_hour", 20, 10, T0 + 2 * HOUR), r("five_hour", 30, 20, T0 + HOUR), r("five_hour", 40, 30, T0 + HOUR)],
    now: at(30),
    check: (ps) => {
      expect(ps[0].resetsAt).toBe(T0 + HOUR)
      expect(ps[0].ratePerHour).toBeUndefined() // the current window holds two readings
    },
  },
  {
    name: "the reset time equals the newest reading time",
    readings: [r("five_hour", 10, 0, at(20)), r("five_hour", 20, 10, at(20)), r("five_hour", 30, 20, at(20))],
    now: at(20),
    check: (ps) => expect(ps).toEqual([]),
  },
  {
    name: "one kind is stale, the other is live",
    readings: [r("five_hour", 10, 0, T0 + MIN), r("five_hour", 20, 10, T0 + MIN), r("five_hour", 30, 20, T0 + MIN), ...ramp("seven_day", [10, 20, 30], 10, RESET)],
    now: at(20),
    check: (ps) => expect(ps.map((p) => p.kind)).toEqual(["seven_day"]),
  },
  {
    name: "two kinds sharing one reset time",
    readings: [...ramp("five_hour", [10, 20, 30], 10, RESET), ...ramp("seven_day", [40, 50, 60], 10, RESET)],
    now: at(20),
    check: (ps) => {
      expect(ps).toHaveLength(2)
      expect(ps[0].resetsAt).toBe(RESET)
      expect(ps[1].resetsAt).toBe(RESET)
    },
  },
  {
    // Corrected: the Theil-Sen median of the three pairwise slopes is
    // 1 point per 45 minutes (2 points over the 1.5 h span only ties the
    // low pair), so the rate is 2 / 1.5 points per hour. The first draft
    // said 4 / 1.5, which is not any pair or median of the ramp.
    name: "the slowest allowed pace",
    readings: ramp("five_hour", [10, 11, 12], 45, RESET),
    now: at(90),
    check: (ps) => expect(ps[0].ratePerHour).toBeCloseTo(2 / 1.5, 2),
  },
  {
    name: "a very fast pace",
    readings: ramp("five_hour", [10, 60, 110], 5, RESET),
    now: at(10),
    check: (ps) => {
      expect(ps[0].runsOutAt).toBe(at(10))
      expect(ps[0].early).toBe(true)
    },
  },
  {
    name: "percents with six decimals",
    readings: [r("five_hour", 10.000001, 0, RESET), r("five_hour", 10.999999, 5, RESET), r("five_hour", 12.000001, 10, RESET)],
    now: at(10),
    check: (ps) => expect(ps[0].ratePerHour).toBe(12),
  },
  {
    name: "a rise of exactly five points is not a new window",
    readings: [r("five_hour", 10, 0, RESET), r("five_hour", 15, 10, RESET), r("five_hour", 20, 20, RESET)],
    now: at(20),
    check: (ps) => expect(ps[0].ratePerHour).toBe(30),
  },
  {
    name: "a drop of 4.99 at the newest reading",
    readings: [r("five_hour", 10, 0, RESET), r("five_hour", 40, 10, RESET), r("five_hour", 35.01, 20, RESET), r("five_hour", 36.01, 30, RESET)],
    now: at(30),
    check: (ps) => expect(ps[0].ratePerHour).toBe(rateOf([[0, 10], [10, 40], [20, 35.01], [30, 36.01]])),
  },
  {
    name: "negative now",
    // Fixture corrected: the stamps were 1 s apart, a 2 s span that the
    // ten minute minimum rightly rejects; spaced six minutes apart the same
    // negative-epoch ramp is worth projecting at 5 points per 6 minutes.
    readings: [-2 * 360_000, -360_000, 0].map((t, i) => ({ kind: "five_hour", percentUsed: 10 + i * 5, resetsAt: 360_000, at: t })),
    now: 0,
    check: (ps) => expect(ps[0].ratePerHour).toBe(50),
  },
  {
    name: "now far in the future drops every window",
    readings: ramp("five_hour", [10, 20, 30], 10, RESET),
    now: T0 + 100 * HOUR,
    check: (ps) => expect(ps).toEqual([]),
  },
  {
    name: "an idle gap a hair over twenty minutes",
    readings: [r("five_hour", 10, 0), r("five_hour", 30, 10), r("five_hour", 30, 30.0000001), r("five_hour", 32, 33), r("five_hour", 34, 36)],
    now: at(36),
    check: (ps) => expect(ps[0].ratePerHour).toBe(40),
  },
  {
    name: "an idle gap carrying real work",
    readings: [r("five_hour", 10, 0), r("five_hour", 20, 10), r("five_hour", 50, 70), r("five_hour", 52, 73), r("five_hour", 54, 76)],
    now: at(76),
    check: (ps) => expect(ps[0].ratePerHour).toBe(rateOf(pointsOf(ps ? [r("five_hour", 10, 0), r("five_hour", 20, 10), r("five_hour", 50, 70), r("five_hour", 52, 73), r("five_hour", 54, 76)] : []))),
  },
  {
    name: "one hundred readings every 3.5 minutes",
    readings: Array.from({ length: 100 }, (_, i) => r("five_hour", 5 + i, i * 3.5, RESET)),
    now: at(99 * 3.5),
    check: (ps) => expect(ps[0].ratePerHour).toBeCloseTo(60 / 3.5, 1),
  },
  {
    name: "rising by exactly five points repeatedly",
    readings: ramp("five_hour", [5, 10, 15, 20, 25], 10, RESET),
    now: at(40),
    check: (ps) => expect(ps[0].ratePerHour).toBe(30),
  },
  {
    name: "interleaved kinds with different clock skew",
    readings: [r("five_hour", 10, 0, RESET), r("seven_day", 10, 90, RESET), r("five_hour", 20, 10 + 61 / 60, RESET), r("seven_day", 20, 100, RESET), r("seven_day", 30, 110, RESET)],
    now: at(110),
    check: (ps) => {
      expect(ps.map((p) => p.kind)).toEqual(["five_hour", "seven_day"])
      expect(ps[0].ratePerHour).toBeUndefined()
      expect(ps[1].ratePerHour).toBe(60)
    },
  },
  {
    name: "a reset time as a numeric string is ignored",
    readings: [
      { kind: "five_hour", percentUsed: 10, at: at(0), resetsAt: "1700000000000" as unknown as number },
      r("five_hour", 20, 10),
      r("five_hour", 30, 20),
    ],
    now: at(20),
    check: (ps) => expect(ps[0].resetsAt).toBeUndefined(),
  },
  {
    name: "a percent as a numeric string is ignored",
    readings: [
      { kind: "five_hour", percentUsed: "20" as unknown as number, at: at(0) },
      r("five_hour", 20, 10),
      r("five_hour", 30, 20),
    ],
    now: at(20),
    check: (ps) => expect(ps[0].ratePerHour).toBeUndefined(),
  },
  {
    name: "five_hour with a trailing space is an ordinary kind",
    readings: [...ramp("five_hour ", [10, 20, 30], 10, RESET), ...ramp("zeta", [10, 20, 30], 10, RESET)],
    now: at(20),
    check: (ps) => expect(ps.map((p) => p.kind)).toEqual(["five_hour ", "zeta"]),
  },
  {
    name: "the same kind split across the array merges",
    readings: [...ramp("beta", [10, 20, 30], 10, RESET).slice(0, 1), ...ramp("beta", [40, 50], 10, RESET).slice(0, 2)],
    now: at(20),
    check: (ps) => expect(ps).toHaveLength(1),
  },
  {
    name: "a reading from the year 2000 next to fresh ones",
    readings: [r("five_hour", 90, -6e11, RESET), r("five_hour", 10, 0, RESET), r("five_hour", 20, 10, RESET), r("five_hour", 30, 20, RESET)],
    now: at(20),
    check: (ps) => expect(ps[0].ratePerHour).toBe(60),
  },
  {
    name: "two readings at the same millisecond for different kinds",
    readings: [r("five_hour", 10, 10, RESET), r("seven_day", 10, 10, RESET), r("five_hour", 20, 20, RESET), r("seven_day", 20, 20, RESET), r("five_hour", 30, 30, RESET), r("seven_day", 30, 30, RESET)],
    now: at(30),
    check: (ps) => expect(ps.map((p) => p.ratePerHour)).toEqual([60, 60]),
  },
  {
    name: "identical duplicate readings collapse",
    readings: [r("five_hour", 10, 0, RESET), r("five_hour", 10, 0, RESET), r("five_hour", 10, 0, RESET)],
    now: at(0),
    check: (ps) => expect(ps[0].ratePerHour).toBeUndefined(),
  },
  {
    // Corrected: the reading sits 61 s past its predecessor but still
    // inside now + 60 s, and the spec drops future readings only past that
    // line, so it stands and the ramp still projects 60 points per hour.
    name: "the middle reading skewed into the future",
    readings: [r("five_hour", 10, 0, RESET), r("five_hour", 20, 10 + 61 / 60, RESET), r("five_hour", 30, 20, RESET)],
    now: at(20),
    check: (ps) => expect(ps[0].ratePerHour).toBe(60),
  },
  {
    name: "only the newest reading reports a new reset time",
    readings: [r("five_hour", 10, 0, T0 + HOUR), r("five_hour", 20, 10, T0 + HOUR), r("five_hour", 22, 20, T0 + 5 * HOUR)],
    now: at(20),
    check: (ps) => expect(ps[0].resetsAt).toBe(T0 + 5 * HOUR),
  },
  {
    name: "the newest reading omits the reset time",
    readings: [r("five_hour", 10, 0, RESET), r("five_hour", 20, 10, RESET), r("five_hour", 30, 20)],
    now: at(20),
    // Repair brief: the latest unknown-reset run is independent.
    check: (ps) => expect(ps[0].resetsAt).toBeUndefined(),
  },
  {
    name: "the reset time at the maximum safe integer",
    readings: ramp("five_hour", [10, 20, 30], 10, Number.MAX_SAFE_INTEGER),
    now: at(20),
    check: (ps) => {
      // Corrected: the spec says early means the conservative projection
      // runs out at least 30 minutes before the reset, and every finite
      // projection does that against a reset at the maximum safe integer.
      expect(ps[0].early).toBe(true)
      expect(ps[0].resetsAt).toBe(Number.MAX_SAFE_INTEGER)
    },
  },
  {
    name: "timestamps at the maximum safe integer",
    readings: [Number.MAX_SAFE_INTEGER - 6e5, Number.MAX_SAFE_INTEGER - 3e5, Number.MAX_SAFE_INTEGER].map((t, i) => ({ kind: "five_hour", percentUsed: 10 + i * 5, resetsAt: Number.MAX_SAFE_INTEGER + 1, at: t })),
    now: Number.MAX_SAFE_INTEGER,
    // Corrected: every pairwise slope here is exactly 5 points per 5 minutes.
    check: (ps) => expect(ps[0].ratePerHour).toBe(60),
  },
  {
    name: "a percent so small it cannot rise two points",
    readings: [r("five_hour", 0.0000001, 0, RESET), r("five_hour", 0.0000002, 10, RESET), r("five_hour", 0.0000003, 20, RESET)],
    now: at(20),
    check: (ps) => expect(ps[0].ratePerHour).toBeUndefined(),
  },
  {
    name: "readings given newest first",
    readings: [r("five_hour", 30, 20, RESET), r("five_hour", 20, 10, RESET), r("five_hour", 10, 0, RESET)],
    now: at(20),
    check: (ps) => expect(ps[0].ratePerHour).toBe(60),
  },
  {
    name: "alternating reset times a thousand times",
    readings: Array.from({ length: 1000 }, (_, i) => r("five_hour", 10 + (i % 10), i * 0.5, i % 2 === 0 ? T0 + HOUR : T0 + 2 * HOUR)),
    now: at(500),
    // Corrected: the newest window reports a reset eight hours past now, and
    // the spec drops a window whose reset time is already gone, so nothing
    // is projected rather than a stale window.
    check: (ps) => expect(ps).toEqual([]),
  },
  {
    name: "a five hour session with periodic idles",
    readings: Array.from({ length: 60 }, (_, i) => {
      const burst = i % 10
      const minute = Math.floor(i / 10) * 45 + burst * 3
      return r("five_hour", 5 + i * 1.4, minute, T0 + 5 * HOUR)
    }),
    now: T0 + 5 * HOUR - 1,
    check: (ps) => expect(ps[0].ratePerHour).toBeGreaterThan(10),
  },
  {
    name: "one enormous turn",
    readings: [r("five_hour", 3, 0, at(60)), r("five_hour", 97, 6, at(60)), r("five_hour", 98, 12, at(60))],
    now: at(12),
    check: (ps) => expect(ps[0].ratePerHour).toBeCloseTo(rateOf([[0, 3], [6, 97], [12, 98]]), 2),
  },
  {
    name: "a burnt window without a reset time",
    readings: ramp("five_hour", [10, 60, 100], 10),
    now: at(20),
    check: (ps) => {
      expect(ps[0].runsOutAt).toBe(at(20))
      expect(ps[0].early).toBe(false)
    },
  },
  {
    name: "usage continuing after a full window",
    readings: [r("five_hour", 100, 0, at(30)), r("five_hour", 5, 10, RESET), r("five_hour", 15, 20, RESET), r("five_hour", 25, 30, RESET)],
    now: at(30),
    check: (ps) => {
      expect(ps[0].resetsAt).toBe(RESET)
      expect(ps[0].ratePerHour).toBe(60)
    },
  },
  {
    name: "three readings with a 4:59 span",
    readings: [r("five_hour", 10, 0, RESET), r("five_hour", 20, 2.5, RESET), r("five_hour", 30, 4.9833, RESET)],
    now: at(4.9833),
    check: (ps) => expect(ps[0].ratePerHour).toBeUndefined(),
  },
  {
    name: "a kind that only ever reports whole tens",
    readings: ramp("five_hour", [10, 10, 20, 20, 30], 6, RESET),
    now: at(24),
    check: (ps) => expect(ps[0].ratePerHour).toBe(rateOf(pointsOf(ramp("five_hour", [10, 10, 20, 20, 30], 6)))),
  },
  {
    name: "two windows back to back with the second one empty",
    readings: [r("five_hour", 10, 0, T0 + 30 * MIN), r("five_hour", 30, 10, T0 + 30 * MIN), r("five_hour", 32, 20, T0 + 30 * MIN), r("five_hour", 2, 40, RESET)],
    now: at(40),
    check: (ps) => expect(ps[0].ratePerHour).toBeUndefined(),
  },
  {
    name: "mixed kinds, mixed order, mixed noise",
    readings: [
      r("seven_day", 30, 30, RESET),
      r("five_hour", 12, 5, RESET),
      r("seven_day", 10, 0, RESET),
      r("five_hour", 20.5, 15, RESET),
      r("seven_day", 20, 10, RESET),
      r("five_hour", 30, 25, RESET),
      r("seven_day", 40, 20, RESET),
    ],
    now: at(30),
    check: (ps) => {
      expect(ps.map((p) => p.kind)).toEqual(["five_hour", "seven_day"])
      expect(ps[0].ratePerHour).toBe(rateOf([[5, 12], [15, 20.5], [25, 30]]))
      // Corrected: 30 points after 40 points is a ten point drop, which
      // the spec treats as an unreported reset, so the seven day window that
      // remains has a single reading and no projection.
      expect(ps[1].ratePerHour).toBeUndefined()
    },
  },
]

for (const c of redTeam) {
  test("red team: " + c.name, () => {
    const ps = project(c.readings, c.now)
    checkInvariants(ps)
    c.check?.(ps)
  })
}

// A second, independent adversarial table written against the spec text
// alone; every expected number below was derived by hand from the pairwise
// slope definition before it was run.
const redTeamTwo: Case[] = [
  {
    // One turn every half hour: every stretch is over twenty minutes, so the
    // reference pace has to come from all pairs or the window would look
    // idle and project nothing.
    name: "a steady half hour rhythm keeps its own pace",
    readings: [r("five_hour", 0, 0, RESET), r("five_hour", 3, 30, RESET), r("five_hour", 3, 60, RESET), r("five_hour", 6, 90, RESET), r("five_hour", 9, 120, RESET)],
    now: at(120),
    check: (ps) => {
      expect(ps[0].ratePerHour).toBe(6)
      expect(ps[0].runsOutAt).toBe(at(1030))
      expect(ps[0].runsOutAtLate).toBe(at(1030))
      expect(ps[0].early).toBe(false)
    },
  },
  {
    name: "a duplicate stamp whose later copy is five points lower",
    readings: [r("five_hour", 40, 0, RESET), r("five_hour", 10, 0, RESET), r("five_hour", 20, 10, RESET), r("five_hour", 30, 20, RESET)],
    now: at(20),
    check: (ps) => expect(ps[0].ratePerHour).toBe(60),
  },
  {
    name: "the reset time moves earlier in the middle",
    readings: [r("five_hour", 10, 0, RESET), r("five_hour", 20, 10, T0 + 5 * HOUR), r("five_hour", 30, 20, T0 + 5 * HOUR)],
    now: at(20),
    check: (ps) => {
      expect(ps[0].resetsAt).toBe(T0 + 5 * HOUR)
      expect(ps[0].ratePerHour).toBeUndefined()
    },
  },
  {
    name: "a noisy wiggle keeps the late projection later than the median",
    readings: [r("five_hour", 10, 0, RESET), r("five_hour", 12, 5, RESET), r("five_hour", 9, 10, RESET), r("five_hour", 14, 15, RESET), r("five_hour", 16, 20, RESET)],
    now: at(20),
    check: (ps) => {
      expect(ps[0].ratePerHour).toBe(17)
      expect(ps[0].runsOutAtLate!).toBeGreaterThan(ps[0].runsOutAt!)
      expect(ps[0].early).toBe(false)
    },
  },
  {
    name: "percents far outside the range clamp before anything else",
    readings: [r("five_hour", -50, 0, RESET), r("five_hour", 250, 10, RESET), r("five_hour", 260, 20, RESET)],
    now: at(20),
    check: (ps) => {
      expect(ps[0].ratePerHour).toBe(300)
      expect(ps[0].runsOutAt).toBe(at(20))
      expect(ps[0].early).toBe(true)
    },
  },
  {
    name: "zero rising to a hundred within twenty minutes",
    readings: [r("five_hour", 0, 0, RESET), r("five_hour", 100, 10, RESET), r("five_hour", 100, 20, RESET)],
    now: at(20),
    check: (ps) => {
      expect(ps[0].runsOutAt).toBe(at(20))
      expect(ps[0].early).toBe(true)
    },
  },
  {
    // Every positive stretch counts: the six sorted slopes have middle
    // values 2/30 and 14/65 points/min; their mean is 11/78 points/min.
    name: "a fast burst followed by a trickle",
    readings: [r("five_hour", 10, 0, RESET), r("five_hour", 20, 5, RESET), r("five_hour", 22, 35, RESET), r("five_hour", 24, 65, RESET)],
    now: at(65),
    check: (ps) => {
      expect(ps[0].ratePerHour).toBe(8.46)
      expect(ps[0].runsOutAt).toBe(at(65 + 76 / (11 / 78)))
    },
  },
  {
    name: "a burst after an idle inside the ninety minute slice",
    readings: [r("five_hour", 40, 0, RESET), r("five_hour", 42, 10, RESET), r("five_hour", 44, 45, RESET), r("five_hour", 60, 48, RESET), r("five_hour", 62, 51, RESET)],
    now: at(51),
    check: (ps) => {
      // The +2 over35min is work. Ten slopes have middle values22/51,
      // 18/38 points/min; the 25th quantile interpolates .2 and20/48.
      expect(ps[0].ratePerHour).toBe(27.15)
      expect(Math.abs(ps[0].runsOutAtLate! - Math.round(at(51) + (38 / 15.25) * HOUR))).toBeLessThanOrEqual(1)
      expect(ps[0].early).toBe(true)
    },
  },
  {
    name: "a single reading already at a hundred percent",
    readings: [r("five_hour", 100, 0, RESET)],
    now: at(5),
    check: (ps) => {
      expect(ps[0].ratePerHour).toBeUndefined()
      expect(ps[0].runsOutAt).toBe(at(0))
      expect(ps[0].early).toBe(true)
    },
  },
  {
    name: "a single reading at a hundred percent twenty nine minutes before the reset",
    readings: [r("five_hour", 100, 0, at(29))],
    now: at(5),
    check: (ps) => {
      expect(ps[0].runsOutAt).toBe(at(0))
      expect(ps[0].early).toBe(false)
    },
  },
  {
    name: "a hundred percent exactly half an hour before the reset",
    readings: ramp("five_hour", [40, 70, 100], 5, at(40)),
    now: at(10),
    check: (ps) => expect(ps[0].early).toBe(true),
  },
  {
    name: "a hundred percent one millisecond short of half an hour before the reset",
    readings: ramp("five_hour", [40, 70, 100], 5, at(40) - 1),
    now: at(10),
    check: (ps) => expect(ps[0].early).toBe(false),
  },
  {
    name: "every reading is still in the future",
    readings: [r("five_hour", 10, -5, RESET), r("five_hour", 20, -4, RESET), r("five_hour", 30, -3, RESET)],
    now: at(-10),
    check: (ps) => expect(ps).toEqual([]),
  },
  {
    name: "half point noise around a flat line",
    readings: [r("five_hour", 50, 0, RESET), r("five_hour", 50.5, 10, RESET), r("five_hour", 50, 20, RESET), r("five_hour", 50.5, 30, RESET)],
    now: at(30),
    check: (ps) => expect(ps[0].ratePerHour).toBeUndefined(),
  },
  {
    // The first pair is under three minutes apart, so only two slopes exist.
    name: "only two pairs clear the three minute rule",
    readings: [r("five_hour", 10, 0, RESET), r("five_hour", 11, 2.9, RESET), r("five_hour", 12, 12, RESET)],
    now: at(12),
    check: (ps) => {
      const pts: Array<[number, number]> = [[0, 10], [2.9, 11], [12, 12]]
      expect(ps[0].ratePerHour).toBe(rateOf(pts))
      const slowPerHour = quantile(slopesFrom(pts, 3), 0.25) * 60
      expect(Math.abs(ps[0].runsOutAtLate! - Math.round(at(12) + (88 / slowPerHour) * HOUR))).toBeLessThanOrEqual(1)
    },
  },
  {
    name: "extra properties on readings are ignored",
    readings: [
      Object.assign(r("five_hour", 10, 0, RESET), { extra: true, note: "kiwi" }),
      Object.assign(r("five_hour", 20, 10, RESET), { extra: 2 }),
      r("five_hour", 30, 20, RESET),
    ],
    now: at(20),
    check: (ps) => expect(ps[0].ratePerHour).toBe(60),
  },
  {
    name: "the newest reading lands exactly on now",
    readings: ramp("five_hour", [10, 20, 30], 10, RESET),
    now: at(20),
    check: (ps) => expect(ps[0].ratePerHour).toBe(60),
  },
  {
    name: "a window whose reset passed while its newest reading omits it",
    readings: [r("five_hour", 10, 0, T0 + HOUR), r("five_hour", 20, 10, T0 + HOUR), r("five_hour", 30, 20)],
    now: at(70),
    check: (ps) => {
      // Only the newest unknown-reset reading belongs to the current run.
      expect(ps).toHaveLength(1)
      expect(ps[0].resetsAt).toBeUndefined()
      expect(ps[0].ratePerHour).toBeUndefined()
      expect(ps[0].early).toBe(false)
    },
  },
  {
    name: "a hundred then a five point drop leaves too few readings",
    readings: [r("five_hour", 100, 0, RESET), r("five_hour", 95, 10, RESET), r("five_hour", 99, 20, RESET)],
    now: at(20),
    check: (ps) => {
      expect(ps[0].ratePerHour).toBeUndefined()
      expect(ps[0].early).toBe(false)
    },
  },
  {
    name: "twenty five kinds at once",
    readings: Array.from({ length: 25 }, (_, k) => ramp("k" + k, [10, 20, 30], 10, RESET)).flat(),
    now: at(20),
    check: (ps) => {
      expect(ps).toHaveLength(25)
      expect(ps[0].kind).toBe("k0")
      expect(ps[1].kind).toBe("k1")
      expect(ps[24].kind).toBe("k9")
    },
  },
  {
    name: "a numeric kind is read as its string",
    readings: [r(7 as unknown as WindowKind, 10, 0, RESET), r(7 as unknown as WindowKind, 20, 10, RESET), r(7 as unknown as WindowKind, 30, 20, RESET)],
    now: at(20),
    check: (ps) => {
      expect(ps[0].kind).toBe("7")
      expect(ps[0].ratePerHour).toBe(60)
    },
  },
  {
    name: "a null reset time is an unknown one",
    readings: [
      { kind: "five_hour", percentUsed: 10, at: at(0), resetsAt: null as unknown as number },
      r("five_hour", 20, 10),
      r("five_hour", 30, 20),
    ],
    now: at(20),
    check: (ps) => {
      expect(ps[0].resetsAt).toBeUndefined()
      expect(ps[0].ratePerHour).toBe(60)
      expect(ps[0].early).toBe(false)
    },
  },
  {
    name: "project is pure across two calls",
    readings: [...ramp("beta", [10, 20, 30], 10, RESET), ...ramp("alpha", [5, 15, 25], 10, RESET)],
    now: at(20),
    check: (ps) => expect(project([...ramp("beta", [10, 20, 30], 10, RESET), ...ramp("alpha", [5, 15, 25], 10, RESET)], at(20))).toEqual(ps),
  },
  {
    name: "two kinds with the same numbers go hot together",
    readings: [...ramp("five_hour", [10, 60, 100], 10, RESET), ...ramp("seven_day", [10, 60, 100], 10, RESET)],
    now: at(20),
    check: (ps) => {
      const out = hotness({ hot: {} }, ps)
      expect(out.hot).toEqual(["five_hour", "seven_day"])
      expect(out.changed).toBe(true)
    },
  },
  {
    name: "stamps with fractions of a millisecond",
    readings: [
      { kind: "five_hour", percentUsed: 10, resetsAt: RESET, at: T0 + 0.5 },
      { kind: "five_hour", percentUsed: 20, resetsAt: RESET, at: T0 + 600000.25 },
      { kind: "five_hour", percentUsed: 30, resetsAt: RESET, at: T0 + 1200000.75 },
    ],
    now: T0 + 1200000.75,
    check: (ps) => expect(ps[0].ratePerHour).toBe(60),
  },
  {
    name: "control, CJK and astral kinds sort by code unit",
    readings: [...ramp("\nZ", [10, 20, 30], 10, RESET), ...ramp("Z", [10, 20, 30], 10, RESET), ...ramp("\u{1D54F}x", [10, 20, 30], 10, RESET), ...ramp("\u4E94\u5C0F\u65F6", [10, 20, 30], 10, RESET)],
    now: at(20),
    check: (ps) => expect(ps.map((p) => p.kind)).toEqual(["\nZ", "Z", "\u4E94\u5C0F\u65F6", "\u{1D54F}x"]),
  },
  {
    // The rate only ever sees the last ninety minutes, so a window reported
    // every six hours never has three readings to work with.
    name: "a seven day window reported every six hours never projects",
    readings: [r("seven_day", 20, 0, T0 + 7 * 24 * HOUR), r("seven_day", 25, 360, T0 + 7 * 24 * HOUR), r("seven_day", 30, 720, T0 + 7 * 24 * HOUR), r("seven_day", 35, 1080, T0 + 7 * 24 * HOUR)],
    now: at(1080),
    check: (ps) => {
      expect(ps[0].ratePerHour).toBeUndefined()
      expect(ps[0].runsOutAt).toBeUndefined()
    },
  },
  {
    name: "one turn every thirty minutes for three hours",
    readings: Array.from({ length: 6 }, (_, i) => r("five_hour", 2 + i * 2, i * 30, RESET)),
    now: at(150),
    check: (ps) => {
      expect(ps[0].ratePerHour).toBe(4)
      expect(ps[0].runsOutAt).toBe(at(1470))
    },
  },
  {
    name: "dense readings every thirty seconds",
    readings: Array.from({ length: 100 }, (_, i) => ({ kind: "five_hour", percentUsed: 5 + i * 0.3, resetsAt: RESET, at: T0 + i * 30000 })),
    now: T0 + 99 * 30000,
    check: (ps) => expect(ps[0].ratePerHour).toBe(36),
  },
  {
    name: "two hundred readings every three minutes",
    // Kept under a hundred percent so no reading is clamped flat; only
    // the last ninety minutes of the two hundred feed the rate.
    readings: Array.from({ length: 200 }, (_, i) => r("five_hour", 5 + i * 0.2, i * 3, at(600))),
    now: at(597),
    check: (ps) => expect(ps[0].ratePerHour).toBe(4),
  },
  {
    name: "the second window sits exactly on the three reading, ten minute and two point edges",
    readings: [r("five_hour", 10, 0, at(10)), r("five_hour", 50, 5, at(10)), r("five_hour", 20, 20, RESET), r("five_hour", 21, 30, RESET), r("five_hour", 22, 40, RESET)],
    now: at(40),
    check: (ps) => {
      expect(ps[0].resetsAt).toBe(RESET)
      expect(ps[0].ratePerHour).toBe(6)
      expect(ps[0].runsOutAt).toBe(at(820))
    },
  },
  {
    name: "a reset landing exactly on a reading stamp",
    readings: [r("five_hour", 10, 0, at(15)), r("five_hour", 20, 10, at(15)), r("five_hour", 30, 20, at(75)), r("five_hour", 35, 25, at(75)), r("five_hour", 40, 30, at(75))],
    now: at(30),
    check: (ps) => {
      expect(ps[0].resetsAt).toBe(at(75))
      expect(ps[0].ratePerHour).toBe(60)
    },
  },
  {
    name: "a quarter of the slopes at zero leaves no conservative projection",
    readings: [r("five_hour", 10, 0, RESET), r("five_hour", 10, 5, RESET), r("five_hour", 10, 10, RESET), r("five_hour", 10, 15, RESET), r("five_hour", 14, 30, RESET), r("five_hour", 18, 45, RESET)],
    now: at(45),
    check: (ps) => {
      expect(ps[0].ratePerHour).toBe(9.6)
      expect(ps[0].runsOutAtLate).toBeUndefined()
      expect(ps[0].early).toBe(false)
    },
  },
  {
    name: "ninety nine point nine nine nine percent is not burnt and not early at the line",
    readings: [r("five_hour", 97, 0, at(50)), r("five_hour", 99, 10, at(50)), r("five_hour", 99.999, 20, at(50))],
    now: at(20),
    check: (ps) => {
      expect(ps[0].runsOutAt!).toBeGreaterThan(at(20))
      expect(ps[0].early).toBe(false)
    },
  },
  {
    // The reading survives the skew rule and sets the newest end of every
    // pair, so the median slope is 20 points over 21 minutes.
    name: "the newest reading sixty seconds into the future is kept",
    readings: [r("five_hour", 10, 0, RESET), r("five_hour", 20, 10, RESET), r("five_hour", 30, 21, RESET)],
    now: at(20),
    check: (ps) => expect(ps[0].ratePerHour).toBe(57.14),
  },
  {
    name: "a shuffled series with duplicates and a mid-series reset",
    readings: [r("five_hour", 9, 50, RESET), r("five_hour", 30, 20, at(25)), r("five_hour", 5, 30, RESET), r("five_hour", 10, 0, at(25)), r("five_hour", 7, 40, RESET), r("five_hour", 20, 10, at(25))],
    now: at(50),
    check: (ps) => {
      expect(ps[0].resetsAt).toBe(RESET)
      expect(ps[0].ratePerHour).toBe(12)
    },
  },
  {
    name: "duplicate projections of one kind in hotness",
    now: at(20),
    readings: ramp("five_hour", [10, 60, 100], 10, RESET),
    check: (ps) => {
      const out = hotness({ hot: {} }, [...ps, ...ps])
      expect(out.hot).toEqual(["five_hour"])
      expect(Object.keys(out.state.hot)).toEqual(["five_hour:" + RESET])
    },
  },
  {
    name: "hotness drops garbage keys from the previous state",
    now: at(0),
    readings: [],
    check: () => {
      const out = hotness({ hot: { "": true, "x:": true, ":y": true, "five_hour:bad": true } }, [])
      expect(out.hot).toEqual([])
      expect(out.state.hot).toEqual({})
      expect(out.changed).toBe(true)
    },
  },
  {
    name: "a null entry inside the projection list is skipped",
    now: at(0),
    readings: [],
    check: () => {
      const out = hotness({ hot: {} }, [null as unknown as Projection])
      expect(out.hot).toEqual([])
      expect(out.changed).toBe(false)
    },
  },
  {
    name: "a reason with colons warns once",
    now: at(0),
    readings: [],
    check: () => {
      const first = shouldWarn({ warned: {} }, "five_hour", RESET, "a:b:c")
      expect(first.warn).toBe(true)
      expect(shouldWarn(first.state, "five_hour", RESET, "a:b:c").warn).toBe(false)
    },
  },
  {
    name: "shouldWarn keeps the earlier keys when adding one",
    now: at(0),
    readings: [],
    check: () => {
      const first = shouldWarn({ warned: {} }, "five_hour", RESET, "low")
      const second = shouldWarn(first.state, "seven_day", undefined, "low")
      expect(second.warn).toBe(true)
      expect(Object.keys(second.state.warned).sort()).toEqual(["five_hour:" + RESET + ":low", "seven_day:none:low"])
      expect(first.state.warned).toEqual({ ["five_hour:" + RESET + ":low"]: true })
    },
  },
  {
    name: "crossed with no movement reports nothing",
    now: at(0),
    readings: [],
    check: () => expect(crossed(40, 40, [10, 40, 50])).toEqual([]),
  },
  {
    name: "crossed on a falling current reports nothing",
    now: at(0),
    readings: [],
    check: () => expect(crossed(90, 50, [10, 50, 90])).toEqual([]),
  },
  {
    name: "crossed over several thresholds at once",
    now: at(0),
    readings: [],
    check: () => expect(crossed(5, 35, [40, 10, 30, 20])).toEqual([10, 20, 30]),
  },
  {
    name: "crossed with no thresholds",
    now: at(0),
    readings: [],
    check: () => expect(crossed(5, 35, [])).toEqual([]),
  },
  {
    name: "crossed exactly onto a threshold",
    now: at(0),
    readings: [],
    check: () => expect(crossed(39.99, 40, [40])).toEqual([40]),
  },
]

for (const c of redTeamTwo) {
  test("red team two: " + c.name, () => {
    const ps = project(c.readings, c.now)
    checkInvariants(ps)
    c.check?.(ps)
  })
}


describe("repair regressions", () => {
  test("positive fractional rise after twenty minutes and one millisecond stays in every pair", () => {
    const readings = [r("five_hour", 10, 0, RESET), r("five_hour", 20, 5, RESET),
      { kind: "five_hour", percentUsed: 20.25, at: at(25) + 1, resetsAt: RESET },
      r("five_hour", 22, 30, RESET), r("five_hour", 24, 35, RESET)]
    // No adjacent gap has zero rise: all ten >=3min slopes count.
    const slopes = slopesFrom(pointsOf(readings), 3)
    const median = quantile(slopes, .5)
    const slow = quantile(slopes, .25)
    const p = one(readings, at(35))!
    expect(p.ratePerHour).toBe(Math.round(median * 6000) / 100)
    expect(p.runsOutAt).toBe(Math.round(at(35) + 76 / median * MIN))
    expect(p.runsOutAtLate).toBe(Math.round(at(35) + 76 / slow * MIN))
  })

  test("newest unknown reset uses only its latest uninterrupted unknown run", () => {
    const readings = [r("five_hour", 5, 0, RESET), r("five_hour", 10, 5, RESET),
      r("five_hour", 15, 10, RESET), r("five_hour", 16, 15),
      r("five_hour", 17, 20), r("five_hour", 18, 25), r("five_hour", 19, 30)]
    // Four unknown readings rise1 point/5min: every slope is12/hour;
    // remaining81 points take405min after the newest minute30.
    expect(one(readings, at(30))).toEqual({ kind: "five_hour", resetsAt: undefined,
      ratePerHour: 12, runsOutAt: at(435), runsOutAtLate: at(435), early: false })
  })

  test("dense nonlinear inputs retain the exact full pairwise quantiles", () => {
    const readings = Array.from({ length: 650 }, (_, i) => r("five_hour", 10 + 60 * (i / 649) ** 3, 90 * i / 649, RESET))
    // Explicit enumeration is the independent full-data oracle; no600-point
    // thinning can reproduce the exact type7 quantiles for this cubic curve.
    const slopes = slopesFrom(pointsOf(readings), 3)
    const median = quantile(slopes, .5)
    const slow = quantile(slopes, .25)
    const p = one(readings, at(90))!
    expect(p.ratePerHour).toBe(Math.round(median * 6000) / 100)
    expect(p.runsOutAt).toBe(Math.round(at(90) + 30 / median * MIN))
    expect(p.runsOutAtLate).toBe(Math.round(at(90) + 30 / slow * MIN))
  })

  test("ten thousand dense readings across five kinds finish within fifty milliseconds", () => {
    const readings = Array.from({ length: 10_000 }, (_, i) => {
      const index = Math.floor(i / 5), fraction = index / 1999
      return r("kind" + i % 5, 10 + 70 * fraction ** 3, 90 * fraction, RESET)
    })
    project(readings, at(90)) // one warm-up, then best of five
    let best = Infinity
    const samples: number[] = []
    let output: Projection[] = []
    for (let i = 0; i < 5; i++) {
      const start = performance.now()
      output = project(readings, at(90))
      const elapsed = performance.now() - start
      samples.push(elapsed)
      best = Math.min(best, elapsed)
    }
    expect(output).toHaveLength(5)
    expect(output.every(p => p.ratePerHour !== undefined)).toBe(true)
    console.log("pace five-kind10000 samples ms:", samples, "best:", best)
    expect(best).toBeLessThan(50)
  })
})

test("repair regression: an unknown-reset five-point drop still separates older known-rate readings", () => {
  const readings = [r("five_hour", 30, 0, RESET), r("five_hour", 35, 5, RESET),
    r("five_hour", 5, 10), r("five_hour", 40, 20, RESET),
    r("five_hour", 45, 30, RESET), r("five_hour", 50, 40, RESET)]
  // The unreported drop starts a new window; its three known points rise
  // five points/10min, so every eligible slope is30/hour, runout at140min.
  const p = one(readings, at(40))!
  expect(p.ratePerHour).toBe(30)
  expect(p.runsOutAt).toBe(at(140))
  expect(p.runsOutAtLate).toBe(at(140))
})

test("repair regression: an omitted-reset reading preserves a real idle boundary", () => {
  const readings = [r("five_hour", 10, 0, RESET), r("five_hour", 20, 10, RESET),
    r("five_hour", 20, 60), r("five_hour", 21, 70, RESET), r("five_hour", 22, 80, RESET)]
  // The unchanged report at60min proves the50min gap idle. Missing reset
  // reports never add slopes, but pairs crossing that actual gap stay out.
  // The two retained slopes are60/hour and6/hour: median33, quarter19.5.
  const p = one(readings, at(80))!
  expect(p.ratePerHour).toBe(33)
  expect(p.runsOutAtLate).toBe(Math.round(at(80) + 78 / 19.5 * HOUR))
})


// G2: independent cleaning, explicit eligible-pair sorting and type-7 oracle.
function g2Brute(readings: Reading[], now: number): Projection[] {
  const rows = readings.map((r, order) => ({ ...r, order })).filter(r => Number.isFinite(r.at) && Number.isFinite(r.percentUsed) && r.at <= now + MIN)
    .sort((a, b) => a.at - b.at || a.order - b.order);
  const unique: Reading[] = [];
  for (const row of rows) {
    const r = { kind: row.kind, at: row.at, percentUsed: Math.max(0, Math.min(100, row.percentUsed)), resetsAt: Number.isFinite(row.resetsAt) ? row.resetsAt : undefined };
    if (unique.length && unique[unique.length - 1].at === r.at) unique[unique.length - 1] = r;
    else unique.push(r);
  }
  if (!unique.length) return [];
  let start = 0;
  if (unique.at(-1)!.resetsAt === undefined) {
    start = unique.length - 1;
    while (start && unique[start - 1].resetsAt === undefined) start--;
  }
  let current: Reading[] = [], reset: number | undefined, maximum = -Infinity;
  for (const r of unique.slice(start)) {
    if (!current.length || (r.resetsAt !== undefined && r.resetsAt !== reset) || maximum - r.percentUsed >= 5) {
      current = []; reset = r.resetsAt; maximum = -Infinity;
    }
    current.push(r); maximum = Math.max(maximum, r.percentUsed);
    if (r.resetsAt !== undefined) reset = r.resetsAt;
  }
  if (reset !== undefined && reset <= now) return [];
  const newest = current.at(-1)!, recent = current.filter(r => newest.at - r.at <= 90 * MIN);
  let block = 0;
  const rateRows: { r: Reading; block: number }[] = [];
  for (let i = 0; i < recent.length; i++) {
    if (i && recent[i].at - recent[i-1].at > 20 * MIN && recent[i].percentUsed <= recent[i-1].percentUsed) block++;
    if (recent[i].resetsAt === newest.resetsAt) rateRows.push({r: recent[i], block});
  }
  const out: Projection = {kind:newest.kind,resetsAt:reset,ratePerHour:undefined,runsOutAt:undefined,runsOutAtLate:undefined,early:false};
  if (rateRows.length >= 3 && newest.at - rateRows[0].r.at >= 10 * MIN && newest.percentUsed - rateRows[0].r.percentUsed >= 2) {
    const slopes: number[] = [];
    for (let i = 0; i < rateRows.length; i++) for (let j = i+1; j < rateRows.length; j++) {
      const a=rateRows[i],b=rateRows[j];
      if (a.block === b.block && b.r.at - a.r.at >= 3 * MIN) slopes.push((b.r.percentUsed-a.r.percentUsed)/(b.r.at-a.r.at));
    }
    if (slopes.length) {
      slopes.sort((a,b)=>a-b);
      const q=(f:number)=>{const h=(slopes.length-1)*f,lo=Math.floor(h),hi=Math.ceil(h);return slopes[lo]+(slopes[hi]-slopes[lo])*(h-lo)};
      const median=q(.5),slow=q(.25),rate=Math.round(median*HOUR*100)/100;
      if (rate>0) {
        out.ratePerHour=rate;out.runsOutAt=Math.round(newest.at+(100-newest.percentUsed)/median);
        if(slow>0)out.runsOutAtLate=Math.round(newest.at+(100-newest.percentUsed)/slow);
      }
    }
  }
  if(newest.percentUsed>=100){out.runsOutAt=newest.at;out.runsOutAtLate=newest.at;}
  out.early=reset!==undefined && out.runsOutAtLate!==undefined && out.runsOutAtLate<=reset-30*MIN;
  return [out];
}
function g2Dense(): Reading[] {
  return Array.from({length:10000},(_,i)=>r('five_hour',10+70*(i/9999)**3,90*i/9999,RESET));
}
function g2Time(readings:Reading[]) {
  project(readings,at(90));
  const samples:number[]=[];
  for(let k=0;k<5;k++){const begin=performance.now();const out=project(readings,at(90));samples.push(performance.now()-begin);expect(out[0].ratePerHour).toBeDefined();}
  return {samples,best:Math.min(...samples)};
}
test('G2 exact slope selection: 200 seeded brute-force oracles, ties and dense single-kind under50ms',()=>{
  let state=0x714ac53;
  const rnd=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296};
  for(let seed=0;seed<200;seed++){
    const n=55+seed%101,shape=seed%8;
    const readings:Reading[]=[];
    for(let i=0;i<n;i++){
      const f=i/(n-1);let minute=90*f,percent=10+55*f;
      if(shape===0){minute=i*512/MIN;percent=10+i/1024;}
      if(shape===1)percent=10+55*f**3;
      if(shape===2)percent=10+2*Math.floor(27*f);
      if(shape===3)percent=10+55*f+1.5*(rnd()-.5);
      if(shape===4)percent=80-40*f;
      if(i&&i%11===0)minute=(readings.at(-1)!.at-T0)/MIN;
      if(shape===6){minute=i<20?i:25+i;percent=i===20?readings.at(-1)!.percentUsed:10+55*f;}
      const reset=shape===5&&(rnd()<.2||i>=n-4)?undefined:shape===7&&i>n/2?RESET+HOUR:RESET;
      readings.push(r('five_hour',percent,minute,reset));
    }
    if(seed%3===0)readings.reverse();
    if(seed%3===1)for(let i=readings.length-1;i;i--){const j=Math.floor(rnd()*(i+1));[readings[i],readings[j]]=[readings[j],readings[i]];}
    const now=Math.max(...readings.map(r=>r.at));
    expect(project(readings,now)).toEqual(g2Brute(readings,now));
  }
  const affine=Array.from({length:10000},(_,i)=>r('five_hour',10+i/1024,i*512/MIN,RESET));
  const affineOut=project(affine,affine.at(-1)!.at)[0];
  expect(affineOut.ratePerHour).toBe(Math.round((1/1024)/512*HOUR*100)/100);
  const timing=g2Time(g2Dense());console.log('G2 dense single-kind ms',JSON.stringify(timing));expect(timing.best).toBeLessThan(50);
});
test('G2 exact slope selection: randomized-order 10000 single-kind readings under50ms',()=>{
  const readings=g2Dense();let state=0x6345821;
  for(let i=readings.length-1;i;i--){state^=state<<13;state^=state>>>17;state^=state<<5;const j=(state>>>0)%(i+1);[readings[i],readings[j]]=[readings[j],readings[i]];}
  expect(project(readings,at(90))).toEqual(project(g2Dense(),at(90)));
  const timing=g2Time(readings);console.log('G2 shuffled single-kind ms',JSON.stringify(timing));expect(timing.best).toBeLessThan(50);
});


test('G2 rounded zero slopes include positive subnormal percentage differences',()=>{
  const readings=Array.from({length:31},(_,i)=>r('five_hour',i===30?2:i*Number.MIN_VALUE,3*i,RESET));
  // The435 pre-jump pairs round to zero on IEEE division; median and quarter
  // are zero, so no rate is available but the current projection still exists.
  expect(project(readings,at(90))).toEqual(g2Brute(readings,at(90)));
  expect(project(readings,at(90))).toHaveLength(1);
});


test('G2 decimal-linear10000 exact slope selection remains under50ms',()=>{
  const readings=Array.from({length:10000},(_,i)=>r('five_hour',10+.007*i,i*512/MIN,RESET));
  const timing=g2Time(readings);console.log('G2 decimal-linear single-kind ms',JSON.stringify(timing));expect(timing.best).toBeLessThan(50);
});


test('G2 warning evidence requires three readings and ten elapsed minutes',()=>{
  for(const readings of [[r('five_hour',100,0,RESET)],[r('five_hour',80,0,RESET),r('five_hour',90,1,RESET),r('five_hour',100,2,RESET)]]){
    const projections=project(readings,readings.at(-1)!.at);expect(projections[0].early).toBe(true);expect(hotness({hot:{}},projections).hot).toEqual([]);
  }
  const readings=[r('five_hour',10,0,RESET),r('five_hour',20,5,RESET),r('five_hour',30,10,RESET)];
  expect(hotness({hot:{}},project(readings,at(10))).hot).toEqual(['five_hour']);
});
test('G2 warning clears only when the median passes the reset margin',()=>{
  const key='five_hour:'+RESET,prev:HotState={hot:{[key]:true}};
  const cautious:Projection={kind:'five_hour',resetsAt:RESET,runsOutAt:RESET-5*MIN,runsOutAtLate:RESET+20*MIN,early:false};
  const held=hotness(prev,[cautious]);expect(held.hot).toEqual(['five_hour']);expect(held.changed).toBe(false);
  const cleared=hotness(held.state,[{...cautious,runsOutAt:RESET+11*MIN}]);expect(cleared.hot).toEqual([]);
});
test('G2 warning switches stay at least three fresh readings apart',()=>{
  let out=hotness({hot:{}},[pr('five_hour',RESET,RESET-40*MIN,true)]);expect(out.hot).toEqual(['five_hour']);
  for(let i=0;i<2;i++){out=hotness(out.state,[pr('five_hour',RESET,RESET+20*MIN,false)]);expect(out.hot).toEqual(['five_hour']);}
  out=hotness(out.state,[pr('five_hour',RESET,RESET+20*MIN,false)]);expect(out.hot).toEqual([]);
});
test('G2 repeated inspection of one reading does not consume warning dwell',()=>{
  const readings=[r('five_hour',10,0,RESET),r('five_hour',20,5,RESET),r('five_hour',30,10,RESET)];
  let state=hotness({hot:{}},project(readings,at(10))).state;
  readings.push(r('five_hour',30.01,90,RESET));
  for(let i=0;i<8;i++){const out=hotness(state,project(readings,at(90)));expect(out.hot).toEqual(['five_hour']);state=out.state;}
  readings.push(r('five_hour',30.02,91,RESET));let out=hotness(state,project(readings,at(91)));expect(out.hot).toEqual(['five_hour']);state=out.state;
  readings.push(r('five_hour',30.03,92,RESET));out=hotness(state,project(readings,at(92)));expect(out.hot).toEqual([]);
});


test('G2 retiring warning survives only its dwell after a known window reset', () => {
  const readings = [r('five_hour', 10, 0, RESET), r('five_hour', 40, 10, RESET), r('five_hour', 70, 20, RESET)];
  let state = hotness({ hot: {} }, project(readings, at(20))).state;
  expect(Object.keys(state.hot).length).toBe(1);
  for (let minute = 30; minute <= 50; minute += 10) {
    readings.push(r('five_hour', 5, minute, RESET + HOUR));
    const out = hotness(state, project(readings, at(minute)));
    expect(out.hot).toEqual(minute < 50 ? ['five_hour'] : []);
    state = out.state;
  }
});


test('G2 an unchanged warning for an empty kind reports no change', () => {
  const readings = [r('', 10, 0, RESET), r('', 40, 10, RESET), r('', 70, 20, RESET)];
  const projections = project(readings, at(20));
  const first = hotness({ hot: {} }, projections);
  expect(first.hot).toEqual(['']);
  const again = hotness(first.state, projections);
  expect(again.hot).toEqual(['']);
  expect(again.changed).toBe(false);
});


test('G2 replayed older snapshots do not consume fresh-reading dwell', () => {
  const warm = [r('five_hour', 10, 0, RESET), r('five_hour', 40, 10, RESET), r('five_hour', 70, 20, RESET)];
  let state = hotness({ hot: {} }, project(warm, at(20))).state;
  const slow = [r('five_hour', 30, 30, RESET), r('five_hour', 31, 35, RESET), r('five_hour', 32, 40, RESET)];
  const older = project([...warm, ...slow], at(40));
  slow.push(r('five_hour', 33, 45, RESET));
  const newer = project([...warm, ...slow], at(45));
  for (const projections of [older, newer, older]) {
    const out = hotness(state, projections);
    expect(out.hot).toEqual(['five_hour']);
    state = out.state;
  }
  slow.push(r('five_hour', 34, 50, RESET));
  expect(hotness(state, project([...warm, ...slow], at(50))).hot).toEqual([]);
});

test('G3 public warning state survives JSON between every seeded reading', () => {
  for (const seed of [2, 61, 144, 233, 377]) {
    const session = simulateSession(seed);
    let direct: HotState = { hot: {} }, persisted: HotState = { hot: {} };
    for (let i = 0; i < session.readings.length; i++) {
      const projections = project(session.readings.slice(0, i + 1), session.truth[i].at);
      const snapshot = JSON.stringify(persisted);
      const expected = hotness(direct, projections);
      const restored: HotState = JSON.parse(snapshot);
      for (const entry of Object.values(restored.history ?? {})) Object.freeze(entry);
      Object.freeze(restored.history ?? {});
      Object.freeze(restored.hot);
      Object.freeze(restored);
      const actual = hotness(restored, projections);
      expect(actual).toEqual(expected);
      expect(Object.hasOwn(actual.state, 'history')).toBe(true);
      expect(JSON.parse(JSON.stringify(actual.state))).toEqual(actual.state);
      expect(JSON.stringify(persisted)).toBe(snapshot);
      direct = expected.state;
      persisted = JSON.parse(JSON.stringify(actual.state));
    }
  }
});

test('G3 integer-ms 10000-reading warning pipeline persists public history under50ms', () => {
  const readings = Array.from({ length: 10000 }, (_, i) => ({
    kind: 'five_hour', percentUsed: 10 + 70 * (i / 9999) ** 3,
    at: T0 + i * 512, resetsAt: RESET,
  }));
  const now = readings.at(-1)!.at;
  const projections = project(readings, now);
  const first = hotness({ hot: {} }, projections);
  expect(first.hot).toEqual(['five_hour']);
  expect(Object.hasOwn(first.state, 'history')).toBe(true);
  const persisted = JSON.parse(JSON.stringify(first.state));
  expect(hotness(persisted, projections)).toEqual(hotness(first.state, projections));
  const timing = g2Time(readings);
  console.log('G3 integer-ms dense pipeline ms', JSON.stringify(timing));
  expect(timing.samples).toHaveLength(5);
  expect(timing.best).toBeLessThan(50);
});


for (const [label, readings] of [
  ['decimal near-collinear', Array.from({length:321},(_,i)=>r('five_hour',10+.007*i,i*14000/MIN,RESET))],
  ['binary affine', Array.from({length:321},(_,i)=>r('five_hour',10+i/128,i*16384/MIN,RESET))],
  ['partial affine clusters', Array.from({length:321},(_,i)=>r('five_hour',i<=240?10+i/128:10+240/128+(i-240)/64,i*14000/MIN,RESET))],
] as [string, Reading[]][]) {
  test('G2 exact certificate reuse preserves brute-force projections: '+label,()=>{
    const now=Math.max(...readings.map(row=>row.at));
    const expected=g2Brute(readings,now);
    expect(expected).toHaveLength(1);
    expect(expected[0].ratePerHour).toBeDefined();
    const shuffled=[...readings];let state=0x24bc87d;
    for(let i=shuffled.length-1;i;i--){state^=state<<13;state^=state>>>17;state^=state<<5;const j=(state>>>0)%(i+1);[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];}
    for(const order of [readings,[...readings].reverse(),shuffled]) {
      expect(project(order,now)).toEqual(expected);
    }
  });
}
