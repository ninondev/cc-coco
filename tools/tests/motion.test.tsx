import { describe, expect, test } from 'claude-code/testing'
import { MOTION, sampleHold, seededRandom, blinkDouble, gazeBlinkDelay, motionCycle } from '../hooks/motion'
import { TIMING } from '../hooks/mood'
import { PLUGIN_SOURCES } from './plugin-sources'

describe('one living motion model', () => {
  test('shipping runtime randomness needs no test setting, read or timer', () => {
    const source = PLUGIN_SOURCES['hooks/motion.ts'] ?? ''
    expect(source).toContain('export const runtimeRandom: Random = Math.random')
    expect(source).not.toContain('seededRandom(0x4c415544)')
  })
  test('seeded long samples have the requested medians, spreads and clamps', () => {
    const cases = [
      [MOTION.blink.interval, 5000, 2000, 12500],
      [MOTION.think, 1400, 800, 2600],
      [MOTION.work, 330, 220, 500],
      [MOTION.wild, 200, 120, 320],
    ] as const
    for (const [spec, median, low, high] of cases) {
      const random = seededRandom(42)
      const values = Array.from({ length: 100000 }, () => sampleHold(spec, random)).sort((a, b) => a - b)
      expect(Math.abs(values[50000]! / median - 1)).toBeLessThan(0.015)
      expect(values[5000]!).toBeGreaterThanOrEqual(low * 0.99)
      expect(values[5000]!).toBeLessThanOrEqual(low * 1.08)
      expect(values[95000]!).toBeLessThanOrEqual(high * 1.01)
      expect(values[95000]!).toBeGreaterThanOrEqual(high * 0.9)
      expect(values[0]!).toBeGreaterThanOrEqual(spec.min)
      expect(values[99999]!).toBeLessThanOrEqual(spec.max)
      expect(values[5000]! / values[95000]!).toBeLessThan(0.6)
    }
  })
  test('double and gaze blink shares and hold ranges are deterministic', () => {
    const random = seededRandom(17)
    let doubles = 0, gazes = 0, clamped = true
    for (let i = 0; i < 100000; i++) {
      if (blinkDouble(random)) doubles++
      const gaze = gazeBlinkDelay(random)
      if (gaze !== undefined) { gazes++; clamped &&= gaze >= 150 && gaze <= 400 }
      for (const spec of [MOTION.blink.shut, MOTION.blink.doubleGap]) {
        const value = sampleHold(spec, random)
        clamped &&= value >= spec.min && value <= spec.max
      }
    }
    expect(clamped).toBe(true)
    expect(Math.abs(doubles / 100000 - 1 / 12)).toBeLessThan(0.003)
    expect(Math.abs(gazes / 100000 - 0.5)).toBeLessThan(0.005)
  })
  test('work comes in three to eight changes, then a read-back pause', () => {
    const next = motionCycle('work', seededRandom(9))
    for (let burst = 0; burst < 2000; burst++) {
      let changes = 0, hold = next()
      while (hold < 800) { changes++; expect(hold).toBeGreaterThanOrEqual(220); expect(hold).toBeLessThanOrEqual(500); hold = next() }
      expect(changes).toBeGreaterThanOrEqual(3); expect(changes).toBeLessThanOrEqual(8)
      expect(hold).toBeLessThanOrEqual(2000)
    }
  })
  test('clingy precedes sleep in each quiet stretch', () => {
    expect(TIMING.clingyAfter).toBe(150000)
    expect(TIMING.sleepAfter).toBe(240000)
  })
})
