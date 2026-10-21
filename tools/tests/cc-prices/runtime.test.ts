import { expect, test } from 'bun:test'
import { createPricesController, estimateOtherModel, recordModelUsed } from '../../../plugin/hooks/cost/prices/runtime.ts'
import { expectedRows, expectedOthers, pricingPage, othersList, NOW, fakeDeps } from './helpers'
import type { LoadDeps } from '../../../plugin/hooks/cost/prices/load'
const shipped = { asOf: '2026-10-06', source: 'fixture', rows: expectedRows, others: expectedOthers }
function fixture(over: Partial<LoadDeps> = {}) {
  const raw = new Map<string, unknown>()
  const fake = fakeDeps(over)
  const store = { get: async (k: string) => raw.get(k), set: async (k: string, v: unknown) => { raw.set(k, v) } }
  const c = createPricesController({ shipped, store, deps: fake.d as unknown as LoadDeps })
  return { c, raw, store, ...fake }
}
const tick = () => new Promise(resolve => queueMicrotask(resolve))

test('W2 constructor and redraws stay offline; one Claude fetch per opening; others only on press', async () => {
  const f = fixture()
  for (let i = 0; i < 100; i++) f.c.state()
  expect(f.calls).toEqual([])
  const opening = f.c.open()
  const duplicate = f.c.open()
  await tick()
  expect(f.calls).toHaveLength(1)
  expect(f.calls[0]).toContain('pricing.md')
  f.fetch.resolve(pricingPage)
  await Promise.all([opening, duplicate])
  expect(f.c.state().table.rows).toHaveLength(19)
  expect(f.raw.has('prices.claude')).toBe(true)
  expect(f.raw.has('prices.seen')).toBe(true)
  await f.c.open()
  expect(f.calls).toHaveLength(1)
  await f.c.openOthers() // resolved Claude text is refused as others JSON; still exactly one press fetch
  expect(f.calls).toHaveLength(2)
  await f.c.openOthers()
  await f.c.openOthers()
  expect(f.calls).toHaveLength(2)
  f.c.close()
  await f.c.open()
  expect(f.calls).toHaveLength(3)
})

test('W2 the injected boundary receives URL only, with no init or auth; others persistence shape', async () => {
  const args: unknown[][] = []
  const f = fixture({ fetchText: async (...call: [string]) => { args.push(call); return call[0].includes('pricing.md') ? pricingPage : othersList() } })
  await f.c.open()
  await f.c.openOthers()
  expect(args).toHaveLength(2)
  expect(args.every(a => a.length === 1 && typeof a[0] === 'string')).toBe(true)
  const persisted = f.raw.get('prices.others') as { fetchedAt: number; rows: unknown[]; makers?: unknown }
  expect(persisted.rows).toEqual(expectedOthers)
  expect(persisted.makers).toBeUndefined()
})

for (const opts of [{ env: { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' } }, { policyRefuses: true }]) test('W2 traffic off or policy refusal issues no request or timer', async () => {
  const f = fixture(opts)
  await f.c.open()
  await f.c.openOthers()
  expect(f.calls).toEqual([])
  expect(f.timers).toEqual([])
  expect(f.c.state().why).toBe('off')
  expect(f.c.state().others?.why).toBe('off')
})

test('opening is synchronous with shipped table while store read and fetch run', async () => {
  const f = fixture()
  const opening = f.c.open()
  expect(f.c.state().checking).toBe(true)
  expect(f.c.state().table.rows).toHaveLength(19)
  await tick()
  expect(f.timers[0]?.ms).toBe(6000)
  f.timers[0]!.fn()
  await opening
  expect(f.c.state().why).toBe('offline')
  f.fetch.resolve(pricingPage)
  await tick()
  expect(f.raw.has('prices.claude')).toBe(false)
})

test('closing cancels timeout and drops late fetch and persistence', async () => {
  const f = fixture()
  const opening = f.c.open()
  await tick()
  f.c.close()
  expect(f.timers.every(t => t.cancelled)).toBe(true)
  f.fetch.resolve(pricingPage)
  await opening
  expect(f.raw.has('prices.claude')).toBe(false)
  expect(f.c.state().checking).toBe(false)
})

test('changed page preserves newest known table and emits no store write', async () => {
  const f = fixture({ fetchText: async () => 'no usable table' })
  f.raw.set('prices.claude', { fetchedAt: NOW, rows: expectedRows })
  await f.c.open()
  expect(f.c.state().table.from).toBe('fetched')
  expect(f.c.state().why).toBe('changed')
  expect(f.raw.has('prices.seen')).toBe(false)
})

test('models.used keeps only 30 local days and records normalized ids', async () => {
  const f = fixture()
  f.raw.set('models.used', { old: '2026-09-01', recent: '2026-10-05', invalid: '2026-13-01', future: '2027-10-01' })
  await recordModelUsed(f.store, 'anthropic/claude-opus-4.1', NOW)
  expect(f.raw.get('models.used')).toEqual({ recent: '2026-10-05', 'claude-opus-4-1': '2026-10-06' })
})

test('gateway estimate uses the maker own prices; unknown or missing cache rate stays unknown', () => {
  const makers = [{ maker: 'zai', label: 'Z.ai', models: [{ name: 'glm-5.3', input: 2, read: 0.2, output: 3 }, { name: 'glm-4', input: 1, read: null, output: 2 }] }]
  expect(estimateOtherModel('zai/glm-5.3', { input: 1000000, read: 1000000, write: 1000000, output: 1000000 }, makers)).toBe(7.2)
  expect(estimateOtherModel('glm-4', { input: 10, read: 20, output: 30 }, makers)).toBeNull()
  expect(estimateOtherModel('unknown', { input: 10, output: 30 }, makers)).toBeNull()
})

test('managed refusal is specific to each source: denied Claude does not disable allowed others', async () => {
  const raw = new Map<string, unknown>(), calls: string[] = []
  const c = createPricesController({
    shipped, store: { get: async key => raw.get(key), set: async (key, value) => { raw.set(key, value) } },
    policyRefusesOthers: false,
    deps: { now: () => NOW, env: {}, policyRefuses: true, after: () => () => {}, fetchText: async url => { calls.push(url); return othersList() } },
  })
  await c.open()
  expect(c.state().why).toBe('off')
  await c.openOthers()
  expect(calls).toHaveLength(1)
  expect(calls[0]).toContain('prices/others.json')
  expect(c.state().others?.why).toBeNull()
})

test('used host model ids normalize before fetched price-change detection', async () => {
  const f = fixture({ fetchText: async () => pricingPage })
  f.raw.set('models.used', { 'anthropic/claude-opus-5.5-20261001': '2026-10-06' })
  f.raw.set('prices.seen', { 'claude-opus-5-5': { input: 3, write5m: 3.75, write1h: 6, read: .15, output: 15, at: NOW - 86400000 } })
  await f.c.open()
  expect(f.c.state().usedRecently).toContain('claude-opus-5-5')
  expect(f.c.state().changes).toHaveLength(5)
})
