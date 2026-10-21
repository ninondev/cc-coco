// Port of reference/warm_sim.py (rule 9) without its learned policy, which the
// owner cut on 10-09. Times in seconds. Each pause is priced three ways: no
// warm, the budget rule, and the best a person who knew the pause could do.

import { CAP_MS, MARGIN_MS, TTL_MS } from './constants'
import type { Prices, Ttl } from './constants'
import { PyRandom } from './pyrandom'

export type SimPerson = 'short breaks' | 'meetings' | 'gone at night'
export type SimModel = 'Opus 5.5' | 'Sonnet 5.5' | 'Haiku 4.5' | 'Fable 5.1'

export const SIM_PRICES: Record<SimModel, Prices> = {
  'Opus 5.5': { input: 4, write5m: 5, write1h: 8, read: 0.2, output: 20 },
  'Sonnet 5.5': { input: 2, write5m: 2.5, write1h: 4, read: 0.2, output: 10 },
  'Haiku 4.5': { input: 1, write5m: 1.25, write1h: 2, read: 0.1, output: 5 },
  'Fable 5.1': { input: 10, write5m: 12.5, write1h: 20, read: 0.25, output: 50 },
}

export interface SimRow {
  person: SimPerson
  ttl: Ttl
  model: SimModel
  none: number
  budget: number
  optimum: number
  /** One full re-read, the price of the cache going cold. */
  delta: number
  /** The most one pause paid beyond what no warm would have paid. */
  worstExtra: number
}

const C = 120000 // prefix tokens
const PING_IN = 30
const PING_OUT = 150
const CAP_S = CAP_MS / 1000

// run_pause, line by line: re-read at t = j * tau while the person is still
// away, the two-hour limit holds and the budget rule allows it.
export function simPause(T: number, policy: 'none' | 'budget', delta: number, k: number, ttl: Ttl): number {
  const ttlS = TTL_MS[ttl] / 1000
  const marginS = MARGIN_MS[ttl] / 1000
  const tau = ttlS - marginS
  let spent = 0.0
  let last = 0.0
  let j = 1
  for (;;) {
    const t = j * tau
    if (T <= t) break
    if (t + ttlS > CAP_S) break
    if (spent + k > delta) break
    if (policy === 'none') break
    spent += k
    last = t
    j += 1
  }
  const expiry = last + ttlS
  const cold = T > expiry
  return spent + (cold ? delta : 0.0)
}

export function simOptimum(T: number, delta: number, k: number, ttl: Ttl): number {
  const ttlS = TTL_MS[ttl] / 1000
  const tau = ttlS - MARGIN_MS[ttl] / 1000
  if (T <= ttlS) return 0.0
  const n = Math.ceil((T - ttlS) / tau)
  if (n * tau + ttlS > CAP_S) return delta
  return Math.min(delta, n * k)
}

export function simulate(seed: number = 20261006): SimRow[] {
  const rng = new PyRandom(seed)
  const m = (med: number, s: number): number => rng.lognormvariate(Math.log(med), s)
  const draws: Record<SimPerson, () => number> = {
    'short breaks': () => (rng.random() < 0.85 ? m(480, 0.8) : m(18000, 0.4)),
    meetings: () => (rng.random() < 0.7 ? m(3000, 0.5) : rng.random() < 0.67 ? m(300, 0.4) : m(14400, 0.3)),
    'gone at night': () => (rng.random() < 0.7 ? m(39600, 0.3) : m(540, 0.5)),
  }
  const rows: SimRow[] = []
  const persons: SimPerson[] = ['short breaks', 'meetings', 'gone at night']
  const models: SimModel[] = ['Opus 5.5', 'Sonnet 5.5', 'Haiku 4.5', 'Fable 5.1']
  for (const person of persons) {
    const pauses: number[] = []
    for (let i = 0; i < 1000; i++) pauses.push(draws[person]())
    for (const ttl of ['5m', '1h'] as Ttl[]) {
      for (const model of models) {
        const p = SIM_PRICES[model]
        const w = ttl === '5m' ? p.write5m : p.write1h
        const delta = C * (w - p.read) / 1e6
        const k = (C * p.read + PING_IN * p.input + PING_OUT * p.output) / 1e6
        let none = 0
        let budget = 0
        let optimum = 0
        let worstExtra = 0
        for (const T of pauses) {
          const noWarm = simPause(T, 'none', delta, k, ttl)
          const kept = simPause(T, 'budget', delta, k, ttl)
          none += noWarm
          budget += kept
          optimum += simOptimum(T, delta, k, ttl)
          worstExtra = Math.max(worstExtra, kept - noWarm)
        }
        rows.push({ person, ttl, model, none, budget, optimum, delta, worstExtra })
      }
    }
  }
  return rows
}
