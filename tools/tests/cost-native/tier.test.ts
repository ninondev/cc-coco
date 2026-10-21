// Haiku 5.5 prices each request by the length of its whole prompt (K1 part 2).
import { expect, test } from 'bun:test'
import { CostRuntime } from '../../../plugin/hooks/cost/runtime'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const SHIPPED = JSON.parse(readFileSync(join(import.meta.dir, '../../../plugin/assets/prices.json'), 'utf8'))
const NOW = Date.UTC(2026, 9, 9, 12)
const MODEL = 'claude-haiku-5-5'
function fixture() {
  const store = new Map<string, unknown>()
  const runtime = new CostRuntime({
    store: { get: async key => store.get(key), set: async (key, value) => { store.set(key, value) }, keys: async () => [...store.keys()] },
    now: () => NOW, after: () => () => {}, usage: async () => ({ cost: { usd: 0 }, rateLimits: [] }), sessionId: async () => 'tier',
    env: {}, settings: {}, policy: {}, shipped: SHIPPED, isNewest: async () => true, readLock: async () => 'unlocked',
    fork: async () => ({ ok: false }), changed: () => {},
  })
  return runtime
}
const usage = (prompt: number) => ({ model: MODEL, input_tokens: 0, cache_creation_input_tokens: prompt, cache_read_input_tokens: 0, output_tokens: 10 })
async function chat(prompt: number) {
  const runtime = fixture()
  await runtime.turnStart('composer')
  await runtime.step(NOW, usage(prompt), true)
  await runtime.turnComplete(usage(prompt))
  return runtime
}

test('a prompt of 100,000 tokens is priced at the lower tier, one token more at the higher', async () => {
  const lower = (await chat(100000)).snapshot().cache
  expect(lower.coldUSD).toBeCloseTo(100000 * 0.125 / 1e6, 12)
  expect(lower.warmUSD).toBeCloseTo(100000 * 0.01 / 1e6, 12)
  const higher = (await chat(100001)).snapshot().cache
  expect(higher.coldUSD).toBeCloseTo(100001 * 0.625 / 1e6, 12)
  expect(higher.warmUSD).toBeCloseTo(100001 * 0.05 / 1e6, 12)
})

test('the re-read saving and the cup threshold follow the tier of the cached prefix', async () => {
  expect((await chat(60000)).snapshot().cache.deltaUSD).toBeCloseTo(60000 * (0.125 - 0.01) / 1e6, 12)
  expect((await chat(300000)).snapshot().cache.deltaUSD).toBeCloseTo(300000 * (0.625 - 0.05) / 1e6, 12)
})

test('his own call is priced by its own prompt, with cache reads counted in the length', async () => {
  const runtime = fixture()
  await runtime.ownCall(MODEL, { input: 1000, output: 100, cacheRead: 150000, cacheWrite: 0 }, NOW)
  expect(runtime.snapshot().ownCalls?.usd).toBeCloseTo((1000 * 0.5 + 150000 * 0.05 + 100 * 2.5) / 1e6, 12)
  const small = fixture()
  await small.ownCall(MODEL, { input: 1000, output: 100, cacheRead: 90000, cacheWrite: 0 }, NOW)
  expect(small.snapshot().ownCalls?.usd).toBeCloseTo((1000 * 0.1 + 90000 * 0.01 + 100 * 0.5) / 1e6, 12)
})

test('a fetched table that could not read the model does not unprice it: the shipped row is used', async () => {
  const runtime = fixture()
  ;(runtime as unknown as { storedPrices: unknown }).storedPrices = { fetchedAt: NOW, rows: SHIPPED.rows.filter((r: { id: string }) => r.id !== 'claude-haiku-5-5') }
  expect(runtime.prices(MODEL, 150000)?.input).toBe(0.5)
  expect(runtime.prices('claude-unknown-9', 0)).toBeNull()
})
