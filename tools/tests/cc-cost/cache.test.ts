import { test, expect, describe } from 'bun:test'
import {
  initialCache,
  onMainStep,
  onForkRead,
  onTtlEvidence,
  onReset,
  warmUntil,
  cacheLook,
  indicatorShown,
  indicatorTimers,
  clearTip,
  TTL_MS,
  type CacheState,
  type Prices,
  type Usage,
} from '../../../plugin/hooks/cost/core/index'

const opus: Prices = { input: 4, write5m: 5, write1h: 8, read: 0.2, output: 20 }
// write rates 2.5 (5m) and 5 (1h) with read 0 make rereadDelta hit 0.25 / 0.5 exactly
const P25: Prices = { input: 0, write5m: 2.5, write1h: 5, read: 0, output: 0 }

const u = (input: number, cacheRead: number, cacheWrite: number, output: number): Usage => ({ input, cacheRead, cacheWrite, output })
const ctx5 = { ttl: '5m' as const, prices: opus }
const ctx5Free = { ttl: '5m' as const, prices: null }
const ctx1 = { ttl: '1h' as const, prices: opus }

const cacheState = (over: Partial<CacheState> = {}): CacheState => ({
  sentAt: null,
  prefix: 0,
  model: null,
  observed: false,
  evidence: null,
  misses: 0,
  missUsd: 0,
  ...over,
})

// a realistic state after one main step: sent at t=1000 with a 100K prefix
const s1: CacheState = cacheState({ sentAt: 1000, prefix: 100000, model: 'claude-opus-5-5', observed: true })

describe('rule 4: initialCache and the first main step', () => {
  test('initialCache has every field at rest', () => {
    expect(initialCache()).toEqual({ sentAt: null, prefix: 0, model: null, observed: false, evidence: null, misses: 0, missUsd: 0 })
  })

  test('the first step stores sentAt, prefix and model and cannot be a miss', () => {
    const s = onMainStep(initialCache(), { startedAt: 1000, usage: u(10000, 50000, 40000, 1000), model: 'claude-opus-5-5' }, ctx5)
    expect(s).toEqual({ sentAt: 1000, prefix: 100000, model: 'claude-opus-5-5', observed: true, evidence: null, misses: 0, missUsd: 0 })
  })

  test('a first step with no cache activity stays unobserved', () => {
    const s = onMainStep(initialCache(), { startedAt: 0, usage: u(100, 0, 0, 50) }, ctx5)
    expect(s.observed).toBe(false)
    // the prefix is input + cacheRead + cacheWrite; output is not part of it
    expect(s.prefix).toBe(100)
    expect(s.sentAt).toBe(0)
  })

  test('a first step with a huge gap cannot prove 1h evidence (no previous prefix)', () => {
    const s = onMainStep(initialCache(), { startedAt: 10_000_000, usage: u(0, 500, 0, 0) }, ctx5)
    expect(s.evidence).toBe(null)
    expect(s.observed).toBe(true)
  })
})

describe('rule 4a: the miss check', () => {
  test('a low re-read inside the TTL window is an unexpected miss', () => {
    const s = onMainStep(s1, { startedAt: 2000, usage: u(10000, 49999, 100000, 500) }, ctx5)
    expect(s.misses).toBe(1)
    expect(s.missUsd).toBeCloseTo(0.5, 12)
  })

  test('the miss is priced at the write rate of the ctx ttl', () => {
    const s = onMainStep(s1, { startedAt: 2000, usage: u(0, 0, 100000, 0) }, ctx1)
    expect(s.misses).toBe(1)
    expect(s.missUsd).toBeCloseTo(0.8, 12)
  })

  test('a re-read of exactly 50% of the prefix is not a miss', () => {
    const s = onMainStep(s1, { startedAt: 2000, usage: u(0, 50000, 100000, 0) }, ctx5)
    expect(s.misses).toBe(0)
    expect(s.missUsd).toBe(0)
  })

  test('a re-read just under 50% is a miss', () => {
    expect(onMainStep(s1, { startedAt: 2000, usage: u(0, 49999, 100000, 0) }, ctx5).misses).toBe(1)
  })

  test('a low re-read exactly at sentAt + TTL is expected, not a miss', () => {
    expect(onMainStep(s1, { startedAt: 301000, usage: u(0, 0, 100000, 0) }, ctx5).misses).toBe(0)
  })

  test('a low re-read one millisecond before the TTL is a miss', () => {
    expect(onMainStep(s1, { startedAt: 300999, usage: u(0, 0, 100000, 0) }, ctx5).misses).toBe(1)
  })

  test('with the 1h ttl the miss window lasts an hour', () => {
    expect(onMainStep(s1, { startedAt: 3600999, usage: u(0, 0, 100000, 0) }, ctx1).misses).toBe(1)
    expect(onMainStep(s1, { startedAt: 3601000, usage: u(0, 0, 100000, 0) }, ctx1).misses).toBe(0)
  })

  test('no miss without a previous prefix or send time', () => {
    const noPrefix = cacheState({ sentAt: 1000, prefix: 0, observed: true })
    const noSent = cacheState({ sentAt: null, prefix: 100000, observed: true })
    expect(onMainStep(noPrefix, { startedAt: 2000, usage: u(0, 0, 50000, 0) }, ctx5).misses).toBe(0)
    expect(onMainStep(noSent, { startedAt: 2000, usage: u(0, 0, 50000, 0) }, ctx5).misses).toBe(0)
  })

  test('null prices still count the miss but add nothing to missUsd', () => {
    const s = onMainStep(s1, { startedAt: 2000, usage: u(0, 0, 100000, 0) }, ctx5Free)
    expect(s.misses).toBe(1)
    expect(s.missUsd).toBe(0)
  })

  test('misses and missUsd accumulate over several steps', () => {
    let s = s1
    s = onMainStep(s, { startedAt: 2000, usage: u(0, 0, 100000, 0) }, ctx5)
    s = onMainStep(s, { startedAt: 3000, usage: u(0, 0, 100000, 0) }, ctx5)
    expect(s.misses).toBe(2)
    expect(s.missUsd).toBeCloseTo(1.0, 12)
  })
})

describe('rule 4b: one-hour evidence', () => {
  test('a gap over 300000 ms with a 90% re-read proves 1h', () => {
    const s = onMainStep(s1, { startedAt: 301001, usage: u(0, 90000, 0, 0) }, ctx5)
    expect(s.evidence).toBe('1h')
    expect(s.misses).toBe(0)
  })

  test('a gap of exactly 300000 ms is not evidence', () => {
    expect(onMainStep(s1, { startedAt: 301000, usage: u(0, 90000, 0, 0) }, ctx5).evidence).toBe(null)
  })

  test('a re-read of exactly 90% of the prefix is evidence', () => {
    expect(onMainStep(s1, { startedAt: 301001, usage: u(0, 90000, 0, 0) }, ctx1).evidence).toBe('1h')
  })

  test('a re-read just under 90% is not evidence', () => {
    expect(onMainStep(s1, { startedAt: 301001, usage: u(0, 89999, 0, 0) }, ctx5).evidence).toBe(null)
  })

  test('no evidence without a previous prefix or send time', () => {
    const noPrefix = cacheState({ sentAt: 1000, prefix: 0, observed: true })
    const noSent = cacheState({ sentAt: null, prefix: 100000, observed: true })
    expect(onMainStep(noPrefix, { startedAt: 10_000_000, usage: u(0, 500, 0, 0) }, ctx5).evidence).toBe(null)
    expect(onMainStep(noSent, { startedAt: 10_000_000, usage: u(0, 90000, 0, 0) }, ctx5).evidence).toBe(null)
  })

  test('a miss never becomes evidence, and evidence survives a later miss', () => {
    let s = onTtlEvidence(s1, '1h')
    s = onMainStep(s, { startedAt: 2000, usage: u(0, 0, 100000, 0) }, ctx5)
    expect(s.misses).toBe(1)
    expect(s.evidence).toBe('1h')
  })

  test('the 1h evidence is found whatever ttl the ctx carries', () => {
    const s = onMainStep(s1, { startedAt: 400000, usage: u(0, 95000, 0, 0) }, ctx1)
    expect(s.evidence).toBe('1h')
  })
})

describe('rule 4c/4d: observed, sentAt, prefix, model', () => {
  test('observed never goes back to false', () => {
    let s = onMainStep(initialCache(), { startedAt: 0, usage: u(0, 10, 0, 0) }, ctx5)
    expect(s.observed).toBe(true)
    s = onMainStep(s, { startedAt: 1000, usage: u(0, 0, 0, 0) }, ctx5)
    expect(s.observed).toBe(true)
  })

  test('observed only turns true when read plus write is positive', () => {
    expect(onMainStep(initialCache(), { startedAt: 0, usage: u(0, -5, 5, 0) }, ctx5).observed).toBe(false)
  })

  test('a step without a model keeps the previous one', () => {
    const s = onMainStep(s1, { startedAt: 2000, usage: u(0, 50000, 0, 0) }, ctx5)
    expect(s.model).toBe('claude-opus-5-5')
  })

  test('a step with a model replaces it', () => {
    const s = onMainStep(s1, { startedAt: 2000, usage: u(0, 50000, 0, 0), model: 'claude-sonnet-5-5' }, ctx5)
    expect(s.model).toBe('claude-sonnet-5-5')
  })

  test('the new prefix is input plus cacheRead plus cacheWrite', () => {
    const s = onMainStep(s1, { startedAt: 2000, usage: u(7, 11, 13, 1000) }, ctx5)
    expect(s.prefix).toBe(31)
    expect(s.sentAt).toBe(2000)
  })
})

describe('rule 4: onForkRead', () => {
  test('a 90% read at a later time renews sentAt', () => {
    const s = onForkRead(s1, { startedAt: 5000, cacheRead: 90000 })
    expect(s).toEqual({ ...s1, sentAt: 5000 })
  })

  test('exactly 90% of the prefix qualifies', () => {
    expect(onForkRead(s1, { startedAt: 5000, cacheRead: 90000 }).sentAt).toBe(5000)
  })

  test('just under 90% does not renew', () => {
    expect(onForkRead(s1, { startedAt: 5000, cacheRead: 89999 }).sentAt).toBe(1000)
  })

  test('a fork read at or before the last send does not renew', () => {
    expect(onForkRead(s1, { startedAt: 1000, cacheRead: 90000 }).sentAt).toBe(1000)
    expect(onForkRead(s1, { startedAt: 500, cacheRead: 90000 }).sentAt).toBe(1000)
  })

  test('no renewal without a prefix', () => {
    const s = onForkRead(cacheState({ sentAt: 1000 }), { startedAt: 5000, cacheRead: 90000 })
    expect(s).toEqual(cacheState({ sentAt: 1000 }))
  })

  test('with sentAt null a qualifying read sets it', () => {
    const s = onForkRead(cacheState({ prefix: 100 }), { startedAt: 42, cacheRead: 90 })
    expect(s.sentAt).toBe(42)
  })

  test('a fork read changes nothing but sentAt', () => {
    const s = onForkRead(s1, { startedAt: 9999, cacheRead: 100000 })
    expect(s.prefix).toBe(100000)
    expect(s.model).toBe('claude-opus-5-5')
    expect(s.observed).toBe(true)
    expect(s.evidence).toBe(null)
    expect(s.misses).toBe(0)
    expect(s.missUsd).toBe(0)
  })
})

describe('rule 4: onTtlEvidence', () => {
  test('stores 5m and 1h', () => {
    expect(onTtlEvidence(initialCache(), '5m').evidence).toBe('5m')
    expect(onTtlEvidence(initialCache(), '1h').evidence).toBe('1h')
  })

  test('the latest evidence wins', () => {
    const s = onTtlEvidence(onTtlEvidence(initialCache(), '5m'), '1h')
    expect(s.evidence).toBe('1h')
    expect(onTtlEvidence(s, '5m').evidence).toBe('5m')
  })

  test('any other value leaves the state unchanged', () => {
    const s = onTtlEvidence(s1, '1h')
    for (const v of ['bogus', '', '5M', 5, null, undefined, {}]) {
      expect(onTtlEvidence(s, v)).toEqual(s)
    }
  })

  test('evidence survives unrelated events', () => {
    const s = onReset(onTtlEvidence(s1, '5m'))
    expect(s.evidence).toBe('5m')
  })
})

describe('rule 4: onReset', () => {
  const rich: CacheState = cacheState({ sentAt: 5000, prefix: 123456, model: 'claude-opus-5-5', observed: true, evidence: '1h', misses: 2, missUsd: 1.5 })

  test('empties the prefix and keeps everything else', () => {
    expect(onReset(rich)).toEqual({ ...rich, prefix: 0 })
  })

  test('a reset is never counted as a miss', () => {
    const s = onReset(rich)
    const after = onMainStep(s, { startedAt: 6000, usage: u(0, 0, 200000, 0) }, ctx5)
    expect(after.misses).toBe(2)
    expect(after.missUsd).toBe(1.5)
  })

  test('after a reset a normal conversation rebuilds', () => {
    let s = onReset(rich)
    s = onMainStep(s, { startedAt: 6000, usage: u(10000, 0, 50000, 500), model: 'claude-sonnet-5-5' }, ctx5)
    expect(s.prefix).toBe(60000)
    expect(s.sentAt).toBe(6000)
    expect(s.model).toBe('claude-sonnet-5-5')
  })
})

describe('rule 4: warmUntil', () => {
  test('null while nothing was sent or the prefix is empty', () => {
    expect(warmUntil(initialCache(), '5m')).toBe(null)
    expect(warmUntil(cacheState({ sentAt: 1000, prefix: 0 }), '1h')).toBe(null)
  })

  test('sentAt plus the ttl', () => {
    expect(warmUntil(s1, '5m')).toBe(301000)
    expect(warmUntil(s1, '1h')).toBe(3601000)
  })

  test('TTL_MS holds 300000 and 3600000', () => {
    expect(TTL_MS['5m']).toBe(300000)
    expect(TTL_MS['1h']).toBe(3600000)
  })
})

describe('rule 4: cacheLook', () => {
  const live = cacheState({ sentAt: 0, prefix: 100000, observed: true })
  const idle = { turnRunning: false, keptWarm: false }

  test('none before anything was observed', () => {
    expect(cacheLook(cacheState({ sentAt: 0, prefix: 100000, observed: false }), '5m', 0, idle)).toBe('none')
  })

  test('none with an empty prefix', () => {
    expect(cacheLook(cacheState({ sentAt: 0, prefix: 0, observed: true }), '5m', 0, idle)).toBe('none')
  })

  test('none without a send time', () => {
    expect(cacheLook(cacheState({ sentAt: null, prefix: 100000, observed: true }), '5m', 0, idle)).toBe('none')
  })

  test('kept wins over every other look', () => {
    expect(cacheLook(live, '5m', 10 ** 9, { turnRunning: false, keptWarm: true })).toBe('kept')
    expect(cacheLook(live, '5m', 10 ** 9, { turnRunning: true, keptWarm: true })).toBe('kept')
  })

  test('a running turn is always warm', () => {
    expect(cacheLook(live, '5m', 10 ** 9, { turnRunning: true, keptWarm: false })).toBe('warm')
    expect(cacheLook(live, '5m', 0, { turnRunning: true, keptWarm: false })).toBe('warm')
  })

  test('warm before the exact two-thirds boundary (5m)', () => {
    expect(cacheLook(live, '5m', 0, idle)).toBe('warm')
    expect(cacheLook(live, '5m', 199999, idle)).toBe('warm')
  })

  test('the exact two-thirds boundary of a 5m cache is cooling', () => {
    expect(cacheLook(live, '5m', 200000, idle)).toBe('cooling')
  })

  test('cooling until warmUntil, then cold (5m)', () => {
    expect(cacheLook(live, '5m', 299999, idle)).toBe('cooling')
    expect(cacheLook(live, '5m', 300000, idle)).toBe('cold')
    expect(cacheLook(live, '5m', 10 ** 9, idle)).toBe('cold')
  })

  test('the same boundaries for a 1h cache', () => {
    expect(cacheLook(live, '1h', 2399999, idle)).toBe('warm')
    expect(cacheLook(live, '1h', 2400000, idle)).toBe('cooling')
    expect(cacheLook(live, '1h', 3599999, idle)).toBe('cooling')
    expect(cacheLook(live, '1h', 3600000, idle)).toBe('cold')
  })

  test('cooling is the last 100 s of a 5m cache and the last 20 min of a 1h one', () => {
    expect(300000 - 200000).toBe(100000)
    expect(3600000 - 2400000).toBe(1200000)
  })
})

describe('rule 4: indicatorShown', () => {
  const live = cacheState({ sentAt: 0, prefix: 100000, observed: true })

  test('shown when the reread delta is exactly 0.25', () => {
    expect(indicatorShown(live, P25, '5m')).toBe(true)
  })

  test('not shown when the delta is 0.2499', () => {
    expect(indicatorShown(cacheState({ sentAt: 0, prefix: 99960, observed: true }), P25, '5m')).toBe(false)
  })

  test('not shown unobserved, without a prefix or without prices', () => {
    expect(indicatorShown(cacheState({ prefix: 100000 }), P25, '5m')).toBe(false)
    expect(indicatorShown(cacheState({ observed: true }), P25, '5m')).toBe(false)
    expect(indicatorShown(live, null, '5m')).toBe(false)
  })

  test('the 1h write rate reaches the threshold sooner', () => {
    expect(indicatorShown(cacheState({ prefix: 50000, observed: true }), P25, '1h')).toBe(true)
    expect(indicatorShown(cacheState({ prefix: 50000, observed: true }), P25, '5m')).toBe(false)
    expect(indicatorShown(cacheState({ prefix: 100000, observed: true }), P25, '5m')).toBe(true)
  })

  test('a big real prefix on opus 5.5 shows the indicator', () => {
    expect(indicatorShown(cacheState({ prefix: 120000, observed: true }), opus, '5m')).toBe(true)
    expect(indicatorShown(cacheState({ prefix: 50000, observed: true }), opus, '5m')).toBe(false)
  })
})

describe('rule 4: indicatorTimers', () => {
  test('empty when not shown', () => {
    expect(indicatorTimers(s1, '5m', false)).toEqual([])
  })

  test('empty when warmUntil is null', () => {
    expect(indicatorTimers(initialCache(), '5m', true)).toEqual([])
    expect(indicatorTimers(cacheState({ sentAt: 1000, prefix: 0, observed: true }), '5m', true)).toEqual([])
  })

  test('the two-thirds point and warmUntil for a 5m cache', () => {
    expect(indicatorTimers(s1, '5m', true)).toEqual([201000, 301000])
  })

  test('the two-thirds point and warmUntil for a 1h cache', () => {
    expect(indicatorTimers(s1, '1h', true)).toEqual([2401000, 3601000])
  })

  test('returns a fresh array every call', () => {
    expect(indicatorTimers(s1, '5m', true)).not.toBe(indicatorTimers(s1, '5m', true))
  })
})

describe('rule 4: clearTip', () => {
  const live = cacheState({ sentAt: 0, prefix: 100000, observed: true })

  test('a cold cache with a 0.5 delta tips', () => {
    expect(clearTip(live, P25, '1h', 3600000)).toBe(true)
  })

  test('exactly 0.5 tips, just under does not', () => {
    expect(clearTip(cacheState({ sentAt: 0, prefix: 200000, observed: true }), P25, '5m', 300000)).toBe(true)
    expect(clearTip(cacheState({ sentAt: 0, prefix: 199999, observed: true }), P25, '5m', 300000)).toBe(false)
  })

  test('warm and cooling caches never tip', () => {
    expect(clearTip(live, P25, '1h', 1000000)).toBe(false)
    expect(clearTip(live, P25, '1h', 3000000)).toBe(false)
  })

  test('no tip without prices or without an observed cache', () => {
    expect(clearTip(live, null, '1h', 3600000)).toBe(false)
    expect(clearTip(cacheState({ sentAt: 0, prefix: 100000 }), P25, '1h', 3600000)).toBe(false)
  })

  test('keptWarm and turnRunning change the look, but clearTip always uses the idle look', () => {
    const s = cacheState({ sentAt: 0, prefix: 200000, observed: true })
    expect(cacheLook(s, '5m', 300000, { turnRunning: false, keptWarm: true })).toBe('kept')
    expect(cacheLook(s, '5m', 300000, { turnRunning: true, keptWarm: false })).toBe('warm')
    // rule 4 computes clearTip through cacheLook(s, ttl, now, { turnRunning: false,
    // keptWarm: false }): a wall-clock cold cache tips even while a fork keeps it warm
    expect(clearTip(s, P25, '5m', 300000)).toBe(true)
  })
})

describe('rule 4: immutability', () => {
  const clone = (s: CacheState): CacheState => JSON.parse(JSON.stringify(s))

  test('onMainStep never mutates its input', () => {
    const before = clone(s1)
    onMainStep(s1, { startedAt: 2000, usage: u(0, 0, 100000, 0), model: 'claude-sonnet-5-5' }, ctx5)
    expect(s1).toEqual(before)
  })

  test('onForkRead never mutates its input', () => {
    const before = clone(s1)
    onForkRead(s1, { startedAt: 9999, cacheRead: 100000 })
    expect(s1).toEqual(before)
  })

  test('onTtlEvidence and onReset never mutate their input', () => {
    const before = clone(s1)
    onTtlEvidence(s1, '5m')
    expect(s1).toEqual(before)
    onReset(s1)
    expect(s1).toEqual(before)
  })

  test('every reducer returns a new object even when nothing changes', () => {
    expect(onForkRead(s1, { startedAt: 0, cacheRead: 0 })).not.toBe(s1)
    expect(onTtlEvidence(s1, 'nope')).not.toBe(s1)
    expect(onReset(s1)).not.toBe(s1)
  })
})
