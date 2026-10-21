import { expect, test } from 'bun:test'
import { TIMING } from '../../../plugin/hooks/mood'

const delay = (quietAt: number): number => typeof TIMING.sleepAfter === 'function'
  ? TIMING.sleepAfter(quietAt) : TIMING.sleepAfter
const BASE = 1_791_014_400_000

test('10,000 quiet spells use all six 20-second and ten equal probability buckets', () => {
  const sixths = Array(6).fill(0), tenths = Array(10).fill(0)
  for (let i = 0; i < 10000; i++) {
    const value = delay(BASE + i)
    expect(Number.isInteger(value)).toBe(true)
    expect(value).toBeGreaterThanOrEqual(240000)
    expect(value).toBeLessThan(360000)
    expect(TIMING.clingyAfter).toBeLessThan(value)
    sixths[Math.floor((value - 240000) / 20000)]++
    tenths[Math.floor((value - 240000) / 12000)]++
  }
  for (const count of sixths) expect(Math.abs(count / 10000 - 1 / 6)).toBeLessThanOrEqual(0.015)
  for (const count of tenths) expect(Math.abs(count / 10000 - 0.1)).toBeLessThanOrEqual(0.015)
})

test('the shared timestamp fixes one integer deadline independently of the session', () => {
  const first = Array.from({ length: 10000 }, (_, i) => delay(BASE + i))
  const second = Array.from({ length: 10000 }, (_, i) => delay(BASE + i))
  expect(second).toEqual(first)
  expect(new Set(first).size).toBeGreaterThan(9000)
})

test('a changed quiet spell hashes both timestamp halves and draws again', () => {
  expect(delay(BASE)).not.toBe(delay(BASE + 1))
  expect(delay(BASE)).not.toBe(delay(BASE + 2 ** 32))
})
