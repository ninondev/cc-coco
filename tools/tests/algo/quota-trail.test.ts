// Their quota page's charts (lane C, 10-15): the trail each window keeps of its readings, and the chart drawn from it
// (quota_page.py, the approved quota page).
import { describe, expect, test } from 'bun:test'
import { QUOTA_TRAIL_POINTS, quotaTrailFrom, quotaTrailMerged, quotaTrailWith } from '../../../plugin/hooks-source/quota-trail'
import { quotaForecast, quotaTrendFor, quotaTrendSvg } from '../../../plugin/hooks-source/quota'

const H = 3_600_000, M = 60_000
const RESET = Date.UTC(2026, 9, 15, 16, 10) // the 5-hour window opened at 11:10
const at = (minutes: number): number => RESET - 5 * H + minutes * M
const minute = (minutes: number): number => Math.floor(at(minutes) / M)
const five = (percentUsed: number, reset = RESET) => ({ kind: 'five_hour', percentUsed, resetsAt: new Date(reset).toISOString() })

describe('the quota trail', () => {
  test('a first reading opens the trail; within a minute the latest reading stands', () => {
    let trail = quotaTrailWith({}, [five(4)], at(20))!
    expect(trail.five_hour).toEqual({ resetsAt: RESET, points: [[minute(20), 4]] })
    trail = quotaTrailWith(trail, [five(5.04)], at(20) + 30_000)!
    expect(trail.five_hour!.points).toEqual([[minute(20), 5]])
    expect(quotaTrailWith(trail, [five(5)], at(20) + 40_000)).toBeUndefined()
  })
  test('a run that does not move keeps its two ends', () => {
    let trail = quotaTrailWith({}, [five(9)], at(40))!
    trail = quotaTrailWith(trail, [five(9)], at(50))!
    trail = quotaTrailWith(trail, [five(9)], at(70))!
    expect(trail.five_hour!.points).toEqual([[minute(40), 9], [minute(70), 9]])
    trail = quotaTrailWith(trail, [five(14)], at(80))!
    expect(trail.five_hour!.points).toEqual([[minute(40), 9], [minute(70), 9], [minute(80), 14]])
  })
  test('an older reading changes nothing, readings outside the window are left out, another reset starts again', () => {
    const trail = quotaTrailWith({}, [five(20)], at(100))!
    expect(quotaTrailWith(trail, [five(19)], at(90))).toBeUndefined()
    expect(quotaTrailWith({}, [five(20)], at(-1))).toBeUndefined()
    expect(quotaTrailWith({}, [five(20)], RESET + M)).toBeUndefined()
    expect(quotaTrailWith({}, [{ kind: 'spend_limit', percentUsed: 20, resetsAt: new Date(RESET).toISOString() }], at(10))).toBeUndefined()
    const next = quotaTrailWith(trail, [five(1, RESET + 5 * H)], RESET + 2 * M)!
    expect(next.five_hour).toEqual({ resetsAt: RESET + 5 * H, points: [[Math.floor((RESET + 2 * M) / M), 1]] })
    // a reset reported a few seconds off is the same window
    expect(quotaTrailWith(trail, [five(22, RESET + 3000)], at(101))!.five_hour!.points.length).toBe(2)
  })
  test(`past ${QUOTA_TRAIL_POINTS} points every other one goes, the first and the last stay`, () => {
    let trail = {}
    for (let i = 0; i <= QUOTA_TRAIL_POINTS; i++) trail = quotaTrailWith(trail, [five(i % 2 ? 30 : 31)], at(i))!
    const points = (trail as ReturnType<typeof quotaTrailFrom>).five_hour!.points
    expect(points.length).toBeLessThanOrEqual(QUOTA_TRAIL_POINTS)
    expect(points[0]).toEqual([minute(0), 31])
    expect(points.at(-1)).toEqual([minute(QUOTA_TRAIL_POINTS), 31])
  })
  test('two windows of hers merge minute by minute, and a window that resets later wins', () => {
    const a = { five_hour: { resetsAt: RESET, points: [[minute(10), 2], [minute(30), 6]] as const } }
    const b = { five_hour: { resetsAt: RESET, points: [[minute(30), 7], [minute(40), 9]] as const } }
    expect(quotaTrailMerged(a, b).five_hour!.points).toEqual([[minute(10), 2], [minute(30), 7], [minute(40), 9]])
    const later = { five_hour: { resetsAt: RESET + 5 * H, points: [[minute(310), 1]] as const } }
    expect(quotaTrailMerged(a, later).five_hour).toEqual(later.five_hour)
    expect(quotaTrailMerged(later, a).five_hour).toEqual(later.five_hour)
  })
  test('what the store holds is checked and anything else is dropped', () => {
    expect(quotaTrailFrom(undefined)).toEqual({})
    expect(quotaTrailFrom({ five_hour: { resetsAt: 'soon', points: [[1, 2]] } })).toEqual({})
    expect(quotaTrailFrom({ five_hour: { resetsAt: RESET, points: [[minute(5), 140], 'x', [minute(2), 3.04], [1]] }, other: {} }))
      .toEqual({ five_hour: { resetsAt: RESET, points: [[minute(2), 3], [minute(5), 100]] } })
  })
})

describe('the quota chart', () => {
  const trail = { five_hour: { resetsAt: RESET, points: [[minute(0), 0], [minute(95), 19], [minute(170), 35]] as const } }
  test('the readings end now; the median pace runs to the reset and the band edge a quarter faster', () => {
    const forecast = quotaForecast(five(38), at(190))!
    expect(forecast.reach).toBe(60)
    const trend = quotaTrendFor(trail, forecast, at(190))!
    expect(trend.start).toBe(RESET - 5 * H)
    expect(trend.end).toBe(RESET)
    expect(trend.points.at(-1)).toEqual([at(190), 38])
    expect(trend.median).toEqual([RESET, 60])
    expect(trend.late![0]).toBe(RESET)
    expect(trend.late![1]).toBeCloseTo(38 + 12 * 1.25 * 110 / 60, 6)
    expect(trend.warn).toBe(false)
    const svg = quotaTrendSvg({ ...trend, resetLabel: '16:10' }, 520)
    expect(svg).toContain('viewBox="0 0 520 96"')
    expect(svg).toContain('>100%</text>')
    expect(svg).toContain('>16:10</text>')
    expect(svg).toContain('stroke-dasharray="4 3"')
    expect(svg).toContain('forced-color-adjust:none')
    expect(svg).toContain('prefers-color-scheme:dark')
    expect(svg).not.toContain('class="w"')
  })
  test('when this pace runs out before the reset the projection turns coral and its crossing is marked', () => {
    const hot = { five_hour: { resetsAt: RESET, points: [[minute(0), 0], [minute(60), 40]] as const } }
    const forecast = quotaForecast(five(80), at(120))!
    expect(forecast.runsOutAt).toBe(at(150))
    const trend = quotaTrendFor(hot, forecast, at(120))!
    expect(trend.warn).toBe(true)
    expect(trend.median).toEqual([at(150), 100])
    expect(trend.late![0]).toBeCloseTo(at(144), 0)
    const svg = quotaTrendSvg({ ...trend, resetLabel: '16:10', crossLabel: '~13:40' }, 300)
    expect(svg).toContain('class="w"')
    expect(svg).toContain('>~13:40</text>')
  })
  test('another window, an out window or a lone reading draws nothing', () => {
    expect(quotaTrendFor(trail, quotaForecast(five(38, RESET + 5 * H), at(190))!, at(190))).toBeUndefined()
    expect(quotaTrendFor({}, quotaForecast(five(38), at(190))!, at(190))).toBeUndefined()
    expect(quotaTrendFor({ five_hour: { resetsAt: RESET, points: [[minute(190), 38]] } }, quotaForecast(five(38), at(190))!, at(190))).toBeUndefined()
  })
})
