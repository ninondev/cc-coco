import { expect, test } from 'bun:test'
import { CostRuntime } from '../../../plugin/hooks/cost/runtime'
import type { CostDeps } from '../../../plugin/hooks/cost/runtime'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const SHIPPED = JSON.parse(readFileSync(join(import.meta.dir, '../../../plugin/assets/prices.json'), 'utf8'))
const NOW = Date.UTC(2026, 9, 7, 12)
const MODEL = 'claude-opus-5-5'
const MAIN = { model: MODEL, input_tokens: 0, cache_creation_input_tokens: 120000, cache_read_input_tokens: 0, output_tokens: 10 }
const HIT = { ...MAIN, cache_creation_input_tokens: 0, cache_read_input_tokens: 120000 }
type Reading = { cost?: { usd: number }; rateLimits: unknown[] }
function fixture(options: { env?: CostDeps['env']; settings?: CostDeps['settings']; policy?: CostDeps['policy'] } = {}) {
  let now = NOW, reading: Reading = { cost: { usd: 0 }, rateLimits: [] }
  let forks = 0, nextId = 0, usageReads = 0
  const store = new Map<string, unknown>(), timers = new Map<number, { due: number; callback: () => void }>()
  const snapshots: ReturnType<CostRuntime['snapshot']>[] = []
  const runtime = new CostRuntime({
    store: { get: async key => store.get(key), set: async (key, value) => { store.set(key, value) }, keys: async () => [...store.keys()] },
    now: () => now,
    after: (ms, callback) => { const id = ++nextId; timers.set(id, { due: now + ms, callback }); return () => { timers.delete(id) } },
    usage: async () => { usageReads++; return reading }, sessionId: async () => 'session-fixture',
    env: options.env ?? {}, settings: options.settings ?? {}, policy: options.policy ?? {}, shipped: SHIPPED,
    isNewest: async () => true, readLock: async () => 'unlocked', fork: async () => { forks++; return { ok: false } },
    changed: snapshot => { snapshots.push(snapshot) },
  })
  const f = {
    runtime, store, timers, snapshots, forks: () => forks, usageReads: () => usageReads,
    now: () => now,
    setReading: (value: Reading) => { reading = value },
    read: () => reading,
    advance: async (ms: number) => {
      const end = now + ms
      for (;;) {
        const due = [...timers].filter(([, t]) => t.due <= end).sort((a, b) => a[1].due - b[1].due)[0]
        if (!due) break
        now = due[1].due; timers.delete(due[0]); due[1].callback(); await Promise.resolve()
      }
      now = end
    },
  }
  return f
}
async function turn(f: ReturnType<typeof fixture>, usage = MAIN) {
  await f.runtime.turnStart('composer')
  const start = f.now()
  await f.runtime.step(start, usage, true)
  await f.runtime.turnComplete(usage)
}

for (const visible of [false, true]) test(`W3 idle clock: visible ${visible}, no more than two one-shot deadlines`, async () => {
  const f = fixture()
  f.runtime.visibility(visible)
  await turn(f)
  const warmUntil = f.runtime.snapshot().cache.warmUntil
  expect([...f.timers.values()].map(t => t.due).sort()).toEqual(visible ? [NOW + 200000, NOW + 300000] : [])
  await f.advance(60000)
  expect(f.timers.size).toBe(visible ? 2 : 0)
  expect(f.forks()).toBe(0)
  await f.advance(140000)
  expect(f.runtime.snapshot().cache.state).toBe('cooling')
  expect(f.timers.size).toBe(visible ? 1 : 0)
  await f.advance(100000)
  expect(f.runtime.snapshot().cache.state).toBe('cold')
  expect(f.timers.size).toBe(0)
  expect(f.now()).toBe(warmUntil)
  await f.advance(3600000)
  expect(f.timers.size).toBe(0)
  await f.runtime.close()
})

test('W3 turn.start cancels both timers before any asynchronous usage read returns', async () => {
  const f = fixture()
  f.runtime.visibility(true)
  await turn(f)
  expect(f.timers.size).toBe(2)
  const starting = f.runtime.turnStart('bridge')
  expect(f.timers.size).toBe(0)
  await starting
  await f.advance(3600000)
  expect(f.timers.size).toBe(0)
  expect(f.runtime.snapshot().cache.state).toBe('warm')
  await f.runtime.close()
})

test('W3 hiding cup cancels timers; subthreshold or unreported caches never schedule them', async () => {
  const f = fixture()
  f.runtime.visibility(true)
  await turn(f)
  expect(f.timers.size).toBe(2)
  f.runtime.visibility(false)
  expect(f.timers.size).toBe(0)
  f.runtime.visibility(true)
  expect(f.timers.size).toBe(2)
  await turn(f, { ...MAIN, cache_creation_input_tokens: 10 })
  expect(f.timers.size).toBe(0)
  const fresh = fixture()
  fresh.runtime.visibility(true)
  await turn(fresh, { ...MAIN, input_tokens: 120000, cache_creation_input_tokens: 0 })
  expect(fresh.runtime.snapshot().cache.observed).toBe(false)
  expect(fresh.timers.size).toBe(0)
  await f.runtime.close(); await fresh.runtime.close()
})

test('W3 shorter TTL evidence replaces old one-hour deadlines with five-minute deadlines', async () => {
  const f = fixture({ env: { ENABLE_PROMPT_CACHING_1H: '1' } })
  f.runtime.visibility(true)
  await turn(f)
  expect([...f.timers.values()].map(t => t.due).sort()).toEqual([NOW + 2400000, NOW + 3600000])
  f.runtime.ttlEvidence('5m')
  expect([...f.timers.values()].map(t => t.due).sort()).toEqual([NOW + 200000, NOW + 300000])
  await f.advance(300000)
  expect(f.timers.size).toBe(0)
  await f.runtime.close()
})

test('W4 ledger difference includes helpers and excludes every between-turn call', async () => {
  const f = fixture()
  f.setReading({ cost: { usd: 10.375 }, rateLimits: [] })
  await f.runtime.turnStart('composer')
  await f.runtime.step(f.now(), MAIN, true)
  await f.runtime.step(f.now(), { ...MAIN, model: 'claude-haiku-4-5', cache_creation_input_tokens: 20000 }, false, 'helper-A')
  f.setReading({ cost: { usd: 13.125 }, rateLimits: [] })
  await f.runtime.turnComplete(MAIN, false)
  expect(f.runtime.snapshot().lastTurn).toBeUndefined()
  await f.runtime.turnComplete(MAIN)
  expect(f.runtime.snapshot().lastTurn?.usd).toBe(13.125 - 10.375)
  expect(f.runtime.snapshot().lastTurn?.estimated).toBe(false)
  expect(f.runtime.snapshot().sessionUSD).toBe(13.125)
  expect(f.runtime.helperCosts()['helper-A']).toBeGreaterThan(0)
  f.setReading({ cost: { usd: 13.875 }, rateLimits: [] })
  await f.runtime.ownCall(MODEL, { input: 100, cacheRead: 0, cacheWrite: 0, output: 10 }, f.now())
  expect(f.runtime.snapshot().lastTurn?.usd).toBe(2.75)
  expect(f.runtime.snapshot().sessionUSD).toBe(13.875)
  await f.runtime.turnStart('composer')
  await f.runtime.step(f.now(), HIT, true)
  f.setReading({ cost: { usd: 14.125 }, rateLimits: [] })
  await f.runtime.turnComplete(HIT)
  expect(f.runtime.snapshot().lastTurn?.usd).toBe(14.125 - 13.875)
  expect((await f.runtime.book()).ledger?.day).toBe(14.125 - 10.375)
  await f.runtime.close()
})

test('deferred runtime setup preserves the supplied turn-start engine baseline without another usage read', async () => {
  const f = fixture()
  f.setReading({ cost: { usd: 10.375 }, rateLimits: [] })
  const capturedAtStart = f.read()
  // The turn's reading changes while the lazy runtime is being prepared.
  f.setReading({ cost: { usd: 13.125 }, rateLimits: [] })
  await f.runtime.turnStart('composer', capturedAtStart)
  expect(f.runtime.snapshot().sessionUSD).toBe(10.375)
  expect(f.usageReads()).toBe(0)
  await f.runtime.step(f.now(), MAIN, true)
  await f.runtime.turnComplete(MAIN)
  expect(f.runtime.snapshot().lastTurn?.usd).toBe(13.125 - 10.375)
  expect(f.runtime.snapshot().lastTurn?.estimated).toBe(false)
  expect(f.runtime.snapshot().sessionUSD).toBe(13.125)
  expect(f.usageReads()).toBe(1)
  // Existing callers without an injected baseline still query exactly once.
  await f.runtime.turnStart('composer')
  expect(f.usageReads()).toBe(2)
  await f.runtime.close()
})

test('W4 missing ledger falls back to marked token estimate; lower ledger never yields negative cost', async () => {
  const f = fixture()
  f.setReading({ rateLimits: [] })
  await turn(f)
  expect(f.runtime.snapshot().lastTurn?.estimated).toBe(true)
  expect(f.runtime.snapshot().lastTurn?.usd).toBe((120000 * 5 + 10 * 20) / 1e6)
  f.setReading({ cost: { usd: 100 }, rateLimits: [] })
  await f.runtime.turnStart('composer')
  await f.runtime.step(f.now(), HIT, true)
  f.setReading({ cost: { usd: 1 }, rateLimits: [] })
  await f.runtime.turnComplete(HIT)
  expect(f.runtime.snapshot().lastTurn?.usd).toBeUndefined()
  expect(f.runtime.snapshot().lastTurn?.estimated).toBe(false)
  await f.runtime.close()
})

const TTL_CASES = [
  { name: 'force wins over env/settings/enable', env: { FORCE_PROMPT_CACHING_5M: '1', CLAUDE_CODE_PROMPT_CACHE_TTL: '1h', ENABLE_PROMPT_CACHING_1H: '1' }, setting: '1h', expected: 300000 },
  { name: 'env one hour wins over settings', env: { CLAUDE_CODE_PROMPT_CACHE_TTL: ' 1h ', ENABLE_PROMPT_CACHING_1H: '1' }, setting: '5m', expected: 3600000 },
  { name: 'env five minutes wins over settings', env: { CLAUDE_CODE_PROMPT_CACHE_TTL: '5m' }, setting: '1h', expected: 300000 },
  { name: 'settings one hour', env: {}, setting: '1h', expected: 3600000 },
  { name: 'settings five minutes beats enable', env: { ENABLE_PROMPT_CACHING_1H: '1' }, setting: '5m', expected: 300000 },
  { name: 'enable one hour', env: { ENABLE_PROMPT_CACHING_1H: ' 1 ' }, setting: 'invalid', expected: 3600000 },
  { name: 'invalid env/setting fallback', env: { FORCE_PROMPT_CACHING_5M: 'true', CLAUDE_CODE_PROMPT_CACHE_TTL: '1H', ENABLE_PROMPT_CACHING_1H: 'true' }, setting: ' 1h ', expected: 300000 },
]
for (const row of TTL_CASES) test(`W6 integration TTL ${row.name}`, async () => {
  const f = fixture({ env: row.env, settings: { promptCacheTtl: row.setting } })
  await turn(f)
  expect(f.runtime.snapshot().cache.ttlMs).toBe(row.expected)
  expect(f.runtime.snapshot().cache.warmUntil).toBe(NOW + row.expected)
  f.runtime.ttlEvidence('1h')
  expect(f.runtime.snapshot().cache.ttlMs).toBe(3600000)
  f.runtime.ttlEvidence('5m')
  expect(f.runtime.snapshot().cache.ttlMs).toBe(300000)
  f.runtime.ttlEvidence('invalid')
  expect(f.runtime.snapshot().cache.ttlMs).toBe(300000)
  f.runtime.reset('1h')
  expect(f.runtime.snapshot().cache.prefix).toBe(0)
  expect(f.runtime.snapshot().cache.warmUntil).toBe(0)
  expect(f.runtime.snapshot().cache.ttlMs).toBe(3600000)
  await f.runtime.close()
})

for (const kind of ['unknown','plan','api','credits','gateway','cloud'] as const) test(`W6 integration default billing ${kind}`, async () => {
  const f = fixture({ env: kind === 'cloud' ? { CLAUDE_CODE_USE_VERTEX: '1' } : {} })
  const windows = kind === 'plan' || kind === 'credits' ? [{ kind: 'five_hour', percentUsed: kind === 'credits' ? 100 : 40 }] : kind === 'gateway' ? [{ kind: 'spend_limit', percentUsed: 40 }] : []
  const reading = { cost: { usd: 0 }, rateLimits: windows }
  f.setReading(reading); f.runtime.measure(reading)
  if (kind !== 'unknown' && kind !== 'plan') await turn(f)
  expect(f.runtime.snapshot().billing.kind).toBe(kind)
  expect(f.runtime.snapshot().cache.ttlMs).toBe(kind === 'plan' ? 3600000 : 300000)
  await f.runtime.close()
})

for (const name of ['CLAUDE_CODE_USE_BEDROCK','CLAUDE_CODE_USE_VERTEX','CLAUDE_CODE_USE_FOUNDRY','CLAUDE_CODE_USE_MANTLE','CLAUDE_CODE_USE_ANTHROPIC_AWS']) test(`W6 cloud env literal ${name}`, async () => {
  const f = fixture({ env: { [name]: '1' } })
  f.runtime.measure(f.read())
  expect(f.runtime.snapshot().billing.kind).toBe('cloud')
  expect(f.runtime.snapshot().cache.ttlMs).toBe(300000)
  await f.runtime.close()
})

test('W6 successful main cache hit after five minutes proves one hour; misses do not prove five minutes', async () => {
  const f = fixture({ env: { FORCE_PROMPT_CACHING_5M: '1' } })
  await turn(f)
  await f.advance(300001)
  await turn(f, HIT)
  expect(f.runtime.snapshot().cache.ttlMs).toBe(3600000)
  await f.advance(1000)
  await turn(f, MAIN)
  expect(f.runtime.snapshot().cache.ttlMs).toBe(3600000)
  expect(f.runtime.snapshot().misses?.count).toBe(1)
  f.runtime.reset()
  expect(f.runtime.snapshot().cache.prefix).toBe(0)
  expect(f.runtime.snapshot().cache.ttlMs).toBe(3600000)
  await turn(f)
  expect(f.runtime.snapshot().cache.ttlMs).toBe(3600000)
  await f.runtime.close()
})

test('W6 helper cache hits and model replacement cannot establish long-cache evidence', async () => {
  const f = fixture({ env: { FORCE_PROMPT_CACHING_5M: '1' } })
  await turn(f)
  await f.advance(300001)
  await f.runtime.step(f.now(), HIT, false, 'helper')
  expect(f.runtime.snapshot().cache.ttlMs).toBe(300000)
  await turn(f, { ...HIT, model: 'claude-sonnet-5-5' })
  expect(f.runtime.snapshot().cache.ttlMs).toBe(300000)
  expect('model' in f.runtime.snapshot().cache).toBe(false)
  expect(f.runtime.snapshot().model).toBe('claude-sonnet-5-5')
  await f.runtime.close()
})

test('W3 changed merged TTL settings replace idle deadlines before the new cache expiry', async () => {
  const f = fixture({ settings: { promptCacheTtl: '1h' } })
  f.runtime.visibility(true)
  await turn(f)
  f.runtime.settings({ promptCacheTtl: '5m' }, {})
  expect(f.runtime.snapshot().cache.ttlMs).toBe(300000)
  expect([...f.timers.values()].map(t => t.due).sort()).toEqual([NOW + 200000, NOW + 300000])
  await f.advance(300000)
  expect(f.timers.size).toBe(0)
  await f.runtime.close()
})

test('W3 idle billing change from plan to API replaces one-hour deadlines', async () => {
  const f = fixture()
  f.runtime.visibility(true)
  f.setReading({ cost: { usd: 0 }, rateLimits: [{ kind: 'five_hour', percentUsed: 40 }] })
  await turn(f)
  expect(f.runtime.snapshot().cache.ttlMs).toBe(3600000)
  f.runtime.measure({ cost: { usd: 0 }, rateLimits: [] })
  expect(f.runtime.snapshot().billing.kind).toBe('api')
  expect(f.runtime.snapshot().cache.ttlMs).toBe(300000)
  expect([...f.timers.values()].map(t => t.due).sort()).toEqual([NOW + 200000, NOW + 300000])
  await f.runtime.close()
})
