import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { CostRuntime } from '../../../plugin/hooks/cost/runtime'
import type { CostDeps } from '../../../plugin/hooks/cost/runtime'
import type { ShippedPrices } from '../../../plugin/hooks/cost/prices'
const SHIPPED = JSON.parse(readFileSync(new URL('../../../plugin/assets/prices.json', import.meta.url), 'utf8')) as ShippedPrices
const NOW = Date.UTC(2026, 9, 7, 12)
const MAIN = { model: 'openai/gpt-6.1-sol', input_tokens: 1000000, cache_read_input_tokens: 1000000, cache_creation_input_tokens: 1000000, output_tokens: 1000000 }
function fixture(options: { policy?: CostDeps['policy']; ledger?: number; stored?: unknown } = {}) {
  let ledger = options.ledger
  const store = new Map<string, unknown>(options.stored === undefined ? [] : [['prices.others', options.stored]])
  const runtime = new CostRuntime({
    now: () => NOW, after: () => () => {}, store: { get: async key => store.get(key), set: async (key, value) => { store.set(key, value) }, keys: async () => [...store.keys()] },
    usage: async () => ({ rateLimits: [{ kind: 'spend_limit', percentUsed: 1 }], ...(ledger === undefined ? {} : { cost: { usd: ledger } }) }),
    sessionId: async () => 'other-maker-fixture', env: {}, settings: {}, policy: options.policy ?? {}, shipped: SHIPPED,
    isNewest: async () => true, readLock: async () => 'unlocked', fork: async () => ({ ok: false }), changed: () => {},
  })
  return { runtime, store, ledger: (value: number | undefined) => { ledger = value } }
}
async function finish(f: ReturnType<typeof fixture>, usage = MAIN) {
  await f.runtime.turnStart('composer'); await f.runtime.step(NOW, usage, true); await f.runtime.turnComplete(usage)
}

test('W9 actual gateway turn/session estimates use maker read/input/output and ordinary input for writes', async () => {
  const f = fixture(); await finish(f)
  const snapshot = f.runtime.snapshot()
  expect(snapshot.billing.kind).toBe('gateway')
  expect(snapshot.billing.otherMaker).toBe(true)
  expect(snapshot.lastTurn?.usd).toBeCloseTo(14.1, 10)
  expect(snapshot.lastTurn?.estimated).toBe(true)
  expect(snapshot.sessionUSD).toBeCloseTo(14.1, 10)
  expect((snapshot as typeof snapshot & { sessionEstimated?: boolean }).sessionEstimated).toBe(true)
  expect(snapshot.cache.coldUSD).toBeUndefined()
  expect(snapshot.cache.shown).toBe(false)
  await f.runtime.close()
})

test('W9 gateway fallback includes helpers and in-turn own calls, excluding idle own calls from next turn', async () => {
  const f = fixture()
  await f.runtime.turnStart('composer'); await f.runtime.step(NOW, MAIN, true)
  await f.runtime.step(NOW, { ...MAIN, model: 'gemini/gemini-3.8-flash' }, false, 'helper-other')
  await f.runtime.ownCall(MAIN.model, { input: 1000000, cacheRead: 0, cacheWrite: 0, output: 0 }, NOW)
  await f.runtime.turnComplete(MAIN)
  expect(f.runtime.snapshot().lastTurn?.usd).toBeCloseTo(21.425, 10)
  expect(f.runtime.helperCosts()['helper-other']).toBeCloseTo(5.325, 10)
  expect(f.runtime.snapshot().ownCalls).toEqual({ count: 1, usd: 2 })
  await f.runtime.ownCall(MAIN.model, { input: 1000000, cacheRead: 0, cacheWrite: 0, output: 0 }, NOW)
  expect(f.runtime.snapshot().lastTurn?.usd).toBeCloseTo(21.425, 10)
  expect(f.runtime.snapshot().sessionUSD).toBeCloseTo(23.425, 10)
  await finish(f)
  expect(f.runtime.snapshot().lastTurn?.usd).toBeCloseTo(14.1, 10)
  expect(f.runtime.snapshot().sessionUSD).toBeCloseTo(37.525, 10)
  await f.runtime.close()
})

test('W9 newest known maker table is used without any fetch; a table older than shipped is ignored', async () => {
  const maker = { maker: 'openai', label: 'OpenAI', models: [{ name: 'gpt-6.1-sol', input: 3, read: .3, output: 15 }] }
  const f = fixture({ stored: { fetchedAt: NOW - 1, rows: [maker] } })
  await f.runtime.refreshPrices(); await finish(f)
  expect(f.runtime.snapshot().lastTurn?.usd).toBeCloseTo(21.3, 10)
  f.store.set('prices.others', { fetchedAt: Date.UTC(2026, 9, 5), rows: [maker] })
  await f.runtime.refreshPrices(); await finish(f)
  expect(f.runtime.snapshot().lastTurn?.usd).toBeCloseTo(14.1, 10)
  await f.runtime.close()
})

test('W9 unknown read price and an unpriced helper suppress incomplete maker estimates', async () => {
  const f = fixture(), missing = { ...MAIN, model: 'dashscope/qwen3-vl-235b-a22b-instruct' }
  await finish(f, missing)
  expect(f.runtime.snapshot().lastTurn?.usd).toBeUndefined()
  expect(f.runtime.snapshot().sessionUSD).toBeUndefined()
  await f.runtime.close()
  const unknown = fixture()
  await unknown.runtime.turnStart('composer'); await unknown.runtime.step(NOW, MAIN, true)
  await unknown.runtime.step(NOW, { ...MAIN, model: 'maker/unknown' }, false, 'unknown-helper')
  await unknown.runtime.turnComplete(MAIN)
  expect(unknown.runtime.snapshot().lastTurn?.usd).toBeUndefined()
  expect(unknown.runtime.snapshot().sessionUSD).toBeUndefined()
  await unknown.runtime.close()
})

test('W9 missing maker cache-read rate is harmless when the response reports no cache read', async () => {
  const f = fixture()
  await finish(f, { ...MAIN, model: 'dashscope/qwen3-vl-235b-a22b-instruct', cache_read_input_tokens: 0 })
  expect(f.runtime.snapshot().lastTurn?.usd).toBeCloseTo(2.4, 10)
  expect(f.runtime.snapshot().sessionUSD).toBeCloseTo(2.4, 10)
  await f.runtime.close()
})

test('W9 corrupt locally stored maker rates yield unknown rather than a non-finite estimate', async () => {
  const f = fixture({ stored: { fetchedAt: NOW, rows: [{ maker: 'openai', label: 'OpenAI', models: [{ name: 'gpt-6.1-sol', input: null, read: .3, output: 15 }] }] } })
  await f.runtime.refreshPrices(); await finish(f)
  expect(f.runtime.snapshot().lastTurn?.usd).toBeUndefined()
  expect(f.runtime.snapshot().sessionUSD).toBeUndefined()
  await f.runtime.close()
})

test('W9 exact engine ledger remains primary even for unknown maker/read prices', async () => {
  const f = fixture({ ledger: 12.25 })
  await f.runtime.turnStart('composer'); await f.runtime.step(NOW, { ...MAIN, model: 'unknown/model' }, true)
  f.ledger(14.5); await f.runtime.turnComplete(MAIN)
  expect(f.runtime.snapshot().lastTurn).toMatchObject({ usd: 2.25, estimated: false })
  expect(f.runtime.snapshot().sessionUSD).toBe(14.5)
  expect((f.runtime.snapshot() as { sessionEstimated?: boolean }).sessionEstimated).not.toBe(true)
  expect((await f.runtime.book()).ledger?.day).toBe(2.25)
  await f.runtime.close()
})

test('W9 known gateway prices retain a separate maker estimate beside an engine ledger', async () => {
  const f = fixture({ ledger: 12.25 })
  await f.runtime.turnStart('composer'); await f.runtime.step(NOW, MAIN, true)
  f.ledger(14.5); await f.runtime.turnComplete(MAIN)
  const snapshot = f.runtime.snapshot()
  expect(snapshot.lastTurn).toMatchObject({ usd: 2.25, estimated: false })
  expect(snapshot.sessionUSD).toBe(14.5)
  expect((snapshot as typeof snapshot & { makerEstimate?: { turnUSD: number; sessionUSD: number } }).makerEstimate).toEqual({ turnUSD: 14.1, sessionUSD: 14.1 })
  await f.runtime.close()
})

test('W9 managed rates without known cache columns never borrow public maker estimates', async () => {
  const f = fixture({ policy: { modelPricing: { [MAIN.model]: { input: 90, output: 180 } } } })
  await finish(f)
  expect(f.runtime.snapshot().billing.organisation).toBe(true)
  expect(f.runtime.snapshot().lastTurn?.usd).toBeUndefined()
  expect(f.runtime.snapshot().sessionUSD).toBeUndefined()
  await f.runtime.close()
})
