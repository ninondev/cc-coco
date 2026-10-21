// Test tools: a fake clock (no real timers anywhere), a flush helper for fork
// promises, and small factories for fork/env/arm inputs.

import type { ArmInput, Clock, ForkFn, ForkOutcome, ForkUsage, KeeperEvent, Prices, WarmEnv } from '../../../plugin/hooks/cost/warm/index'
import { createKeeper } from '../../../plugin/hooks/cost/warm/index'

export class FakeClock implements Clock {
  private t: number
  private timers: Array<{ at: number; seq: number; cancelled: boolean; fn: () => void }> = []
  private seq = 0
  constructor(now = 0) {
    this.t = now
  }
  now(): number {
    return this.t
  }
  after(ms: number, fn: () => void): () => void {
    const rec = { at: this.t + Math.max(0, ms), seq: this.seq++, cancelled: false, fn }
    this.timers.push(rec)
    return () => {
      rec.cancelled = true
    }
  }
  pending(): number {
    return this.timers.filter((r) => !r.cancelled).length
  }
  private nextDue(limit: number) {
    let best: { at: number; seq: number; cancelled: boolean; fn: () => void } | null = null
    for (const r of this.timers) {
      if (r.cancelled || r.at > limit) continue
      if (best === null || r.at < best.at || (r.at === best.at && r.seq < best.seq)) best = r
    }
    return best
  }
  // Runs due callbacks in time order, each at its own due time.
  advance(ms: number): void {
    const target = this.t + Math.max(0, ms)
    for (;;) {
      const due = this.nextDue(target)
      if (due === null) break
      this.t = due.at
      due.cancelled = true
      due.fn()
    }
    this.t = target
  }
  // The computer slept: jump forward, then run the now-overdue callbacks at
  // the wake time (they fire late).
  sleep(ms: number): void {
    this.t += Math.max(0, ms)
    for (;;) {
      const due = this.nextDue(this.t)
      if (due === null) break
      due.cancelled = true
      due.fn()
    }
  }
}

export async function flush(rounds = 25): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve()
}

export const OPUS: Prices = { input: 4, write5m: 5, write1h: 8, read: 0.2, output: 20 }
export const SONNET: Prices = { input: 2, write5m: 2.5, write1h: 4, read: 0.2, output: 10 }
export const HAIKU: Prices = { input: 1, write5m: 1.25, write1h: 2, read: 0.1, output: 5 }
export const FABLE: Prices = { input: 10, write5m: 12.5, write1h: 20, read: 0.25, output: 50 }

export function okUsage(over: Partial<ForkUsage> = {}): ForkUsage {
  return { input: 30, cacheRead: 120000, cacheWrite: 0, output: 150, ...over }
}

export function okFork(over: Partial<ForkUsage> = {}): { fork: ForkFn; calls: string[] } {
  const calls: string[] = []
  const usage = okUsage(over)
  return {
    calls,
    fork: (p: string) => {
      calls.push(p)
      return Promise.resolve({ ok: true as const, usage: { ...usage } })
    },
  }
}

export type ForkStep = ForkOutcome | 'reject' | 'throw'

export function forkSeq(steps: ForkStep[]): { fork: ForkFn; calls: string[] } {
  const calls: string[] = []
  let i = 0
  return {
    calls,
    fork: (p: string) => {
      calls.push(p)
      const s = steps[Math.min(i++, steps.length - 1)]
      if (s === 'reject') return Promise.reject(new Error('fork rejected'))
      if (s === 'throw') throw new Error('fork threw')
      return Promise.resolve(s)
    },
  }
}

export function deferredFork(): { fork: ForkFn; calls: string[]; resolve(o: ForkOutcome): void } {
  const calls: string[] = []
  let res: ((o: ForkOutcome) => void) | null = null
  const fork: ForkFn = (p: string) => {
    calls.push(p)
    return new Promise<ForkOutcome>((r) => {
      res = r
    })
  }
  return {
    fork,
    calls,
    resolve: (o: ForkOutcome) => {
      const r = res
      res = null
      if (r) r(o)
    },
  }
}

export function makeEnv(over: Partial<WarmEnv> = {}): WarmEnv {
  return {
    switchOn: () => true,
    isNewest: () => true,
    lock: () => 'unlocked',
    windowPercent: () => null,
    ...over,
  }
}

export function armInput(over: Partial<ArmInput> = {}): ArmInput {
  return {
    sentAt: 0,
    prefix: 120000,
    ttl: '5m',
    prices: OPUS,
    observed: true,
    interactive: true,
    cronWithinTtl: false,
    heldOff: false,
    ...over,
  }
}

export function setup(over: { env?: Partial<WarmEnv>; fork?: ForkFn } = {}) {
  const clock = new FakeClock(0)
  const calls: string[] = []
  const base = over.fork ?? okFork().fork
  const fork: ForkFn = (p: string) => {
    calls.push(p)
    return base(p)
  }
  const events: KeeperEvent[] = []
  const keeper = createKeeper({ clock, fork, env: makeEnv(over.env), onEvent: (e) => events.push(e) })
  return { clock, fork, calls, events, keeper }
}

// Money helpers: recompute the same expression the keeper uses instead of
// trusting decimal literals.
export const usd = (usage: ForkUsage, p: Prices, ttl: '5m' | '1h'): number =>
  (usage.input * p.input + usage.cacheRead * p.read + usage.cacheWrite * (ttl === '5m' ? p.write5m : p.write1h) + usage.output * p.output) / 1e6
