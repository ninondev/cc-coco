// Every constant of rule 1 with its exact value, SILENT_REASONS, SIM_PRICES,
// and the export surface of src/index.ts.

import { expect, test } from 'bun:test'
import * as idx from '../../../plugin/hooks/cost/warm/index'

test('KEEP_WARM_PROMPT is the exact prompt text', () => {
  expect(idx.KEEP_WARM_PROMPT).toBe('Reply with the single word: ok')
})

test('TTL_MS exact values', () => {
  expect(idx.TTL_MS['5m']).toBe(300000)
  expect(idx.TTL_MS['1h']).toBe(3600000)
})

test('MARGIN_MS exact values', () => {
  expect(idx.MARGIN_MS['5m']).toBe(60000)
  expect(idx.MARGIN_MS['1h']).toBe(240000)
})

test('CAP_MS is two hours', () => {
  expect(idx.CAP_MS).toBe(7200000)
})

test('CAP_NO_LOCK_MS is thirty minutes', () => {
  expect(idx.CAP_NO_LOCK_MS).toBe(1800000)
})

test('SLEEP_GUARD_MS is five seconds', () => {
  expect(idx.SLEEP_GUARD_MS).toBe(5000)
})

test('ARM_MIN_USD is 0.05', () => {
  expect(idx.ARM_MIN_USD).toBe(0.05)
})

test('HIT_SHARE is 0.9', () => {
  expect(idx.HIT_SHARE).toBe(0.9)
})

test('RETURN_MISS_SHARE is 0.5', () => {
  expect(idx.RETURN_MISS_SHARE).toBe(0.5)
})

test('MAX_REREAD_OUTPUT is 1000', () => {
  expect(idx.MAX_REREAD_OUTPUT).toBe(1000)
})

test('WINDOW_STOP_PERCENT is 95', () => {
  expect(idx.WINDOW_STOP_PERCENT).toBe(95)
})

test('DEFAULT_REREAD_INPUT is 30', () => {
  expect(idx.DEFAULT_REREAD_INPUT).toBe(30)
})

test('DEFAULT_REREAD_OUTPUT is 150', () => {
  expect(idx.DEFAULT_REREAD_OUTPUT).toBe(150)
})

test('SILENT_REASONS is exactly off, turn, reset', () => {
  expect(idx.SILENT_REASONS).toEqual(['off', 'turn', 'reset'])
})

test('SIM_PRICES Opus 5.5', () => {
  expect(idx.SIM_PRICES['Opus 5.5']).toEqual({ input: 4, write5m: 5, write1h: 8, read: 0.2, output: 20 })
})

test('SIM_PRICES Sonnet 5.5', () => {
  expect(idx.SIM_PRICES['Sonnet 5.5']).toEqual({ input: 2, write5m: 2.5, write1h: 4, read: 0.2, output: 10 })
})

test('SIM_PRICES Haiku 4.5', () => {
  expect(idx.SIM_PRICES['Haiku 4.5']).toEqual({ input: 1, write5m: 1.25, write1h: 2, read: 0.1, output: 5 })
})

test('SIM_PRICES Fable 5.1', () => {
  expect(idx.SIM_PRICES['Fable 5.1']).toEqual({ input: 10, write5m: 12.5, write1h: 20, read: 0.25, output: 50 })
})

test('index exports every runtime name of Exact outputs', () => {
  const names = [
    'KEEP_WARM_PROMPT',
    'TTL_MS',
    'MARGIN_MS',
    'CAP_MS',
    'CAP_NO_LOCK_MS',
    'SLEEP_GUARD_MS',
    'ARM_MIN_USD',
    'HIT_SHARE',
    'RETURN_MISS_SHARE',
    'MAX_REREAD_OUTPUT',
    'WINDOW_STOP_PERCENT',
    'DEFAULT_REREAD_INPUT',
    'DEFAULT_REREAD_OUTPUT',
    'SILENT_REASONS',
    'createKeeper',
    'resolveLock',
    'PyRandom',
    'SIM_PRICES',
    'simPause',
    'simOptimum',
    'simulate',
  ]
  const bag = idx as unknown as Record<string, unknown>
  for (const n of names) expect(bag[n], `missing export ${n}`).toBeDefined()
})

test('createKeeper is a function and PyRandom a class', () => {
  expect(typeof idx.createKeeper).toBe('function')
  expect(typeof idx.PyRandom).toBe('function')
  expect(new idx.PyRandom(1).nextUint32()).toBeGreaterThan(0)
})
