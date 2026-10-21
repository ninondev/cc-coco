import { describe, expect, test } from 'claude-code/testing'
import type { TurnCompleteInput, TurnUsage } from 'claude-code'
import { cachePercent, countCacheTurn, emptyCacheRate } from '../hooks/cache-rate'

const usage: TurnUsage = { model: 'claude-sonnet-4-5-20250929', input_tokens: 120, output_tokens: 810, cache_read_input_tokens: 800, cache_creation_input_tokens: 80 }
const complete = (cost?: TurnUsage, agentId?: string): TurnCompleteInput => ({ reason: 'answer', answer: 'done', durationMs: 3500, isAborted: false, turnId: 'turn-1', ...(agentId ? { agentId } : {}), ...(cost ? { usage: cost } : {}) })

describe('0.2 main turn.complete cache sums, engine 2.1.286 TurnUsage shape', () => {
  test('unknown before any counted usage; all input classes contribute, output does not', () => {
    const before = emptyCacheRate()
    expect(cachePercent(before)).toBeNull()
    const first = countCacheTurn(before, complete(usage))
    expect(first).toEqual({ turns: 1, read: 800, input: 1000 })
    expect(cachePercent(first)).toBe(80)
    expect(before).toEqual(emptyCacheRate())
    const second = countCacheTurn(first, complete({ ...usage, input_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 150, output_tokens: 999999 }))
    expect(cachePercent(second)).toBe(67)
  })
  test('fork, subagent and missing or malformed usages leave the same object untouched', () => {
    const before = emptyCacheRate()
    expect(countCacheTurn(before, complete(usage, 'fork-4'))).toBe(before)
    expect(countCacheTurn(before, complete(usage, 'subagent-7'))).toBe(before)
    expect(countCacheTurn(before, complete(usage), true)).toBe(before)
    expect(countCacheTurn(before, complete())).toBe(before)
    expect(countCacheTurn(before, complete({ ...usage, input_tokens: -1 }))).toBe(before)
    expect(countCacheTurn(before, complete({ ...usage, cache_creation_input_tokens: NaN }))).toBe(before)
  })
  test('zero is known, cache creation is not a hit; interrupted real requests still counted', () => {
    const zero = countCacheTurn(emptyCacheRate(), complete({ ...usage, input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }))
    expect(cachePercent(zero)).toBe(0)
    expect(cachePercent(countCacheTurn(emptyCacheRate(), complete({ ...usage, input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 200 })))).toBe(0)
    const ended: TurnCompleteInput = { ...complete(usage), reason: 'aborted', isAborted: true }
    expect(cachePercent(countCacheTurn(emptyCacheRate(), ended))).toBe(80)
  })
})
