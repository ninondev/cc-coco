import { test, expect, describe } from 'bun:test'
import * as idx from '../../../plugin/hooks/cost/core/index'

const FUNCTIONS = [
  'priceUsage',
  'rereadDelta',
  'nextMessageCost',
  'initialPayer',
  'updatePayer',
  'wordsVariant',
  'resolveTtl',
  'initialCache',
  'onMainStep',
  'onForkRead',
  'onTtlEvidence',
  'onReset',
  'warmUntil',
  'cacheLook',
  'indicatorShown',
  'indicatorTimers',
  'clearTip',
  'turnBaseline',
  'turnCost',
  'ownCallsToday',
  'localDay',
  'ledgerAdd',
  'ledgerTotals',
  'formatUsd',
  'formatTokens',
  'formatPercent',
  'formatMove',
  'floorToMinute',
]

describe('final: src/index.ts exports', () => {
  test('every function of Exact outputs is exported under its exact name', () => {
    expect(FUNCTIONS.length).toBe(28)
    for (const name of FUNCTIONS) {
      expect(typeof (idx as Record<string, unknown>)[name]).toBe('function')
    }
  })

  test('the constants carry the documented values', () => {
    expect(idx.TTL_MS).toEqual({ '5m': 300000, '1h': 3600000 })
    expect(idx.TTL_MS['5m']).toBe(300000)
    expect(idx.TTL_MS['1h']).toBe(3600000)
    expect(idx.INDICATOR_MIN_USD).toBe(0.25)
    expect(idx.CLEAR_TIP_USD).toBe(0.5)
  })

  test('initialPayer and initialCache return fresh objects', () => {
    expect(idx.initialPayer()).not.toBe(idx.initialPayer())
    expect(idx.initialCache()).not.toBe(idx.initialCache())
  })

  test('the em dash literal is U+2014', () => {
    expect(idx.formatUsd(null, 'en')).toBe('—')
    expect('—'.charCodeAt(0)).toBe(0x2014)
  })
})
