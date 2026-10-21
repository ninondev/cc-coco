import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CostRuntime } from '../../../plugin/hooks/cost/runtime'
import { localDay } from '../../../plugin/hooks/cost/core'
import { dayStart } from '../../../plugin/hooks/cost/prices'

const shipped = JSON.parse(readFileSync(join(import.meta.dir, '../../../plugin/assets/prices.json'), 'utf8'))
const usage = { model: 'anthropic/claude-opus-5.5-20261001', input_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1 }
function fixture() {
  let now = new Date(2026, 9, 7, 12).getTime()
  const store = new Map<string, unknown>()
  const runtime = new CostRuntime({
    store: { get: async key => store.get(key), set: async (key, value) => { store.set(key, value) }, keys: async () => [...store.keys()] },
    now: () => now, after: () => () => {}, usage: async () => ({ rateLimits: [], cost: { usd: 0 } }), sessionId: async () => 'retention-fixture',
    env: {}, settings: {}, policy: {}, shipped, isNewest: async () => false, readLock: async () => 'none', fork: async () => ({ ok: false }), changed: () => {},
  })
  return { runtime, store, now: () => now, nextDay: () => { const d = new Date(now); d.setDate(d.getDate() + 1); now = d.getTime() } }
}
const relativeDay = (now: number, offset: number): string => new Date(dayStart(localDay(now))! + offset * 86400000).toISOString().slice(0, 10)

test('models.used normalizes raw IDs and keeps exactly 30 local calendar days', async () => {
  const f = fixture(), today = localDay(f.now()), day29 = relativeDay(f.now(), -29), day30 = relativeDay(f.now(), -30)
  f.store.set('models.used', {
    'us.anthropic.claude-haiku-4-5-20251001-v1:0': day29,
    'claude-sonnet-5-5': day30,
    'claude-opus-4-1': 'not-a-date',
    'claude-sonnet-4-6': '2026-02-30',
    'claude-fable-5-1': relativeDay(f.now(), 1),
  })
  await f.runtime.turnStart('composer'); await f.runtime.step(f.now(), usage, true); await f.runtime.turnComplete(usage)
  expect(f.store.get('models.used')).toEqual({ 'claude-haiku-4-5': day29, 'claude-opus-5-5': today })
  await f.runtime.close()
})

test('models.used does not move a model last answered yesterday to today on an unrelated turn', async () => {
  const f = fixture(), yesterday = localDay(f.now())
  await f.runtime.turnStart('composer'); await f.runtime.step(f.now(), usage, true); await f.runtime.turnComplete(usage)
  f.nextDay()
  const other = { ...usage, model: 'claude-haiku-4-5' }
  await f.runtime.turnStart('composer'); await f.runtime.step(f.now(), other, true); await f.runtime.turnComplete(other)
  expect(f.store.get('models.used')).toEqual({ 'claude-opus-5-5': yesterday, 'claude-haiku-4-5': localDay(f.now()) })
  await f.runtime.close()
})

test('models.used retains the response day when the following completion crosses midnight', async () => {
  const f = fixture(), yesterday = localDay(f.now())
  await f.runtime.ownCall('claude-opus-5-5', { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, f.now())
  f.nextDay()
  const other = { ...usage, model: 'claude-haiku-4-5' }
  await f.runtime.turnStart('composer'); await f.runtime.step(f.now(), other, true); await f.runtime.turnComplete(other)
  expect(f.store.get('models.used')).toEqual({ 'claude-opus-5-5': yesterday, 'claude-haiku-4-5': localDay(f.now()) })
  await f.runtime.close()
})
