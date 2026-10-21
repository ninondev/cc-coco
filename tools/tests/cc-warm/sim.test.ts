// The simulation (rule 9): simPause and simOptimum line by line, the 24
// expected totals within +-0.005, and the gate. The learned early stop is cut
// (owner 10-09), so the gate is the budget rule's own bound: on any one pause
// it pays at most one full re-read (delta) more than not keeping warm.

import { beforeAll, expect, test } from 'bun:test'
import { SIM_PRICES, simulate, simOptimum, simPause } from '../../../plugin/hooks/cost/warm/index'
import type { SimModel, SimPerson, SimRow, Ttl } from '../../../plugin/hooks/cost/warm/index'

const C = 120000
const pricesOf = (model: SimModel, ttl: Ttl): { delta: number; k: number } => {
  const p = SIM_PRICES[model]
  const w = ttl === '5m' ? p.write5m : p.write1h
  return { delta: C * (w - p.read) / 1e6, k: (C * p.read + 30 * p.input + 150 * p.output) / 1e6 }
}

// --- simPause ---

test('simPause none: pays delta exactly when the pause outlives the TTL', () => {
  const { delta, k } = pricesOf('Opus 5.5', '5m')
  expect(simPause(300, 'none', delta, k, '5m')).toBe(0)
  expect(simPause(301, 'none', delta, k, '5m')).toBe(delta)
  expect(simPause(10000, 'none', delta, k, '5m')).toBe(delta)
})

test('simPause budget: back before the first decision costs nothing', () => {
  const { delta, k } = pricesOf('Opus 5.5', '5m')
  expect(simPause(240, 'budget', delta, k, '5m')).toBe(0)
})

test('simPause budget: one re-read covers a pause of 241 s', () => {
  const { delta, k } = pricesOf('Opus 5.5', '5m')
  expect(simPause(241, 'budget', delta, k, '5m')).toBeCloseTo(k, 12)
})

test('simPause budget: two and three re-reads by the cover rule', () => {
  const { delta, k } = pricesOf('Opus 5.5', '5m')
  expect(simPause(540, 'budget', delta, k, '5m')).toBeCloseTo(2 * k, 12)
  expect(simPause(781, 'budget', delta, k, '5m')).toBeCloseTo(3 * k, 12)
})

test('simPause budget: the budget rule stops at 21 re-reads for Opus 5m', () => {
  const { delta, k } = pricesOf('Opus 5.5', '5m')
  expect(simPause(10000, 'budget', delta, k, '5m')).toBeCloseTo(21 * k + delta, 9)
})

test('simPause budget: rent above the price of buying stops at once', () => {
  expect(simPause(10000, 'budget', 0.02, 0.02712, '5m')).toBeCloseTo(0.02, 12)
})

// --- simOptimum ---

test('simPause budget: a 1h cache allows a single re-read at most', () => {
  const { delta, k } = pricesOf('Opus 5.5', '1h')
  // Back at 4000 s: one re-read covers to 6960 s, then the person returns.
  expect(simPause(4000, 'budget', delta, k, '1h')).toBeCloseTo(k, 12)
  // Still away at 10000 s: the single re-read, then the cold price.
  expect(simPause(10000, 'budget', delta, k, '1h')).toBeCloseTo(k + delta, 12)
})

test('simOptimum: a pause within the TTL is free', () => {
  expect(simOptimum(300, 0.576, 0.02712, '5m')).toBe(0)
  expect(simOptimum(3600, 0.936, 0.02712, '1h')).toBe(0)
})

test('simOptimum: just past the TTL needs one re-read', () => {
  expect(simOptimum(301, 0.576, 0.01, '5m')).toBeCloseTo(0.01, 12)
  expect(simOptimum(3601, 0.936, 0.02712, '1h')).toBeCloseTo(0.02712, 12)
})

test('simOptimum: pays min(delta, n * k) when it fits under the cap', () => {
  expect(simOptimum(7000, 0.576, 0.01, '5m')).toBeCloseTo(28 * 0.01, 9)
})

test('simOptimum: past the cap it pays the cold delta', () => {
  expect(simOptimum(7100, 0.576, 0.01, '5m')).toBeCloseTo(0.576, 12)
  expect(simOptimum(6961, 0.936, 0.02712, '1h')).toBeCloseTo(0.936, 12)
})

// --- the 24 totals ---

const EXPECTED: Array<[SimPerson, Ttl, SimModel, number, number, number]> = [
  ['short breaks', '5m', 'Opus 5.5', 439.488, 235.39368, 137.9244],
  ['short breaks', '5m', 'Sonnet 5.5', 210.588, 134.63676, 86.07276],
  ['short breaks', '5m', 'Haiku 4.5', 105.294, 67.31838, 43.03638],
  ['short breaks', '5m', 'Fable 5.1', 1121.61, 474.4404, 298.8972],
  ['short breaks', '1h', 'Opus 5.5', 154.44, 153.32592, 148.98672],
  ['short breaks', '1h', 'Sonnet 5.5', 75.24, 76.74696, 72.65736],
  ['short breaks', '1h', 'Haiku 4.5', 37.62, 38.37348, 36.32868],
  ['short breaks', '1h', 'Fable 5.1', 391.05, 383.1048, 377.0568],
  ['meetings', '5m', 'Opus 5.5', 508.608, 410.18784, 297.61272],
  ['meetings', '5m', 'Sonnet 5.5', 243.708, 330.18516, 196.76196],
  ['meetings', '5m', 'Haiku 4.5', 121.854, 165.09258, 98.38098],
  ['meetings', '5m', 'Fable 5.1', 1298.01, 676.809, 516.348],
  ['meetings', '1h', 'Opus 5.5', 336.024, 147.55824, 142.43256],
  ['meetings', '1h', 'Sonnet 5.5', 163.704, 76.85112, 72.02028],
  ['meetings', '1h', 'Haiku 4.5', 81.852, 38.42556, 36.01014],
  ['meetings', '1h', 'Fable 5.1', 850.83, 361.2156, 354.0714],
  ['gone at night', '5m', 'Opus 5.5', 551.808, 831.63816, 424.02456],
  ['gone at night', '5m', 'Sonnet 5.5', 264.408, 393.60516, 209.62428],
  ['gone at night', '5m', 'Haiku 4.5', 132.204, 196.80258, 104.81214],
  ['gone at night', '5m', 'Fable 5.1', 1408.26, 1822.5606, 1066.0314],
  ['gone at night', '1h', 'Opus 5.5', 666.432, 685.74144, 666.432],
  ['gone at night', '1h', 'Sonnet 5.5', 324.672, 342.87072, 324.672],
  ['gone at night', '1h', 'Haiku 4.5', 162.336, 171.43536, 162.336],
  ['gone at night', '1h', 'Fable 5.1', 1687.44, 1714.3536, 1687.44],
]

let rows: SimRow[] = []
let simMs = 0

beforeAll(() => {
  const t0 = Date.now()
  rows = simulate()
  simMs = Date.now() - t0
})

test('simulate returns the 24 rows in the table order', () => {
  expect(rows.length).toBe(24)
  for (let i = 0; i < 24; i++) {
    expect(rows[i].person).toBe(EXPECTED[i][0])
    expect(rows[i].ttl).toBe(EXPECTED[i][1])
    expect(rows[i].model).toBe(EXPECTED[i][2])
  }
})

for (const [person, ttl, model, none, budget, optimum] of EXPECTED) {
  test(`totals: ${person} ${ttl} ${model}`, () => {
    const row = rows.find((r) => r.person === person && r.ttl === ttl && r.model === model)
    expect(row).toBeDefined()
    expect(row!.none).toBeCloseTo(none, 3)
    expect(row!.budget).toBeCloseTo(budget, 3)
    expect(row!.optimum).toBeCloseTo(optimum, 3)
  })
}

test('the gate holds in every row: keeping warm never loses more than one full re-read on any pause', () => {
  for (const row of rows) expect(row.worstExtra).toBeLessThanOrEqual(row.delta + 1e-9)
})

test('the budget rule is worth having: below not keeping warm in the long run for short breaks and meetings', () => {
  for (const person of ['short breaks', 'meetings'] as const) {
    const mine = rows.filter((r) => r.person === person && r.ttl === '5m')
    expect(mine.reduce((a, r) => a + r.budget, 0)).toBeLessThan(mine.reduce((a, r) => a + r.none, 0))
  }
})

test('the known cost of cutting the learned stop: someone who is gone overnight pays more than with no warm on a 5-minute cache', () => {
  for (const row of rows.filter((r) => r.person === 'gone at night' && r.ttl === '5m')) expect(row.budget).toBeGreaterThan(row.none)
})

test('simulate() finishes well under 10 s', () => {
  expect(simMs).toBeLessThan(10000)
})

test('simulate with the default seed equals simulate(20261006)', () => {
  expect(simulate()).toEqual(simulate(20261006))
})
