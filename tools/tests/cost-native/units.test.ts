import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import * as sourceCore from '../../../plugin/hooks/cost/core'
import { createLockReader as sourceLock } from '../../../plugin/hooks/cost/warm-runtime'
import { createPricesController as sourcePrices, estimateOtherModel as sourceEstimate } from '../../../plugin/hooks/cost/prices/runtime'
import { core, createLockReader, createPricesController, estimateOtherModel } from '../../../plugin/hooks/cost/units.js'
import type { ShippedPrices } from '../../../plugin/hooks/cost/prices'

const shipped = JSON.parse(readFileSync(new URL('../../../plugin/assets/prices.json', import.meta.url), 'utf8')) as ShippedPrices
const now = Date.UTC(2026, 9, 7, 12)

test('generated cost core matches every canonical row and both TTLs', () => {
  expect(Object.keys(core).sort()).toEqual(Object.keys(sourceCore).sort())
  for (const row of shipped.rows) for (const ttl of ['5m', '1h'] as const) {
    const usage = { input: 101, output: 37, cacheRead: 120000, cacheWrite: 99000 }
    expect(core.priceUsage(usage, row, ttl)).toBe(sourceCore.priceUsage(usage, row, ttl))
    expect(core.nextMessageCost(99000, row, ttl)).toEqual(sourceCore.nextMessageCost(99000, row, ttl))
  }
})

test('generated maker estimator preserves public unknown read rates and exact arithmetic', () => {
  for (const maker of shipped.others ?? []) for (const model of maker.models) for (const read of [0, 999]) {
    const usage = { input: 101, read, write: 301, output: 37 }
    const id = `${maker.maker}/${model.name}`
    expect(estimateOtherModel(id, usage, shipped.others ?? [])).toBe(sourceEstimate(id, usage, shipped.others ?? []))
  }
})

test('generated prices controller remains inactive until opening and matches canonical disabled fallback', async () => {
  const counts = [0, 0]
  const options = (index: number) => ({ shipped, store: { get: async () => undefined, set: async () => {} }, deps: {
    now: () => now, after: () => () => {}, fetchText: async () => { counts[index]!++; throw Error('unexpected traffic') },
    env: { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' },
  } })
  const original = sourcePrices(options(0)), generated = createPricesController(options(1))
  expect(generated.state()).toEqual(original.state())
  expect(counts).toEqual([0, 0])
  await original.open(); await generated.open()
  await original.openOthers(); await generated.openOthers()
  expect(generated.state()).toEqual(original.state())
  expect(counts).toEqual([0, 0])
  original.close(); generated.close()
})

test('generated lock reader matches canonical fresh companion and fallback branches', async () => {
  for (const state of ['locked', 'display-asleep', null] as const) for (const age of [1, 600000]) {
    const options = { now: () => now, platform: 'linux', terminal: true, linuxSessionId: 'fixture',
      away: () => ({ state, since: now - age }), run: async () => 'no' }
    expect(await createLockReader(options)()).toBe(await sourceLock(options)())
  }
})
