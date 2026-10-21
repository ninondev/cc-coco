import type { TurnCompleteInput, TurnUsage } from 'claude-code'

export type CacheRate = { turns: number; read: number; input: number }
export const emptyCacheRate = (): CacheRate => ({ turns: 0, read: 0, input: 0 })
function validUsage(usage: TurnUsage): boolean {
  return [usage.input_tokens, usage.output_tokens, usage.cache_read_input_tokens, usage.cache_creation_input_tokens]
    .every(value => Number.isSafeInteger(value) && value >= 0)
}
// Only call from turn.complete: model.fork/complete and turn.step usages never enter here.
// agentId identifies fork/subagent loops in 2.1.286. Session-fork exclusion is explicit.
export function countCacheTurn(previous: CacheRate, event: TurnCompleteInput, sessionIsFork = false): CacheRate {
  if (sessionIsFork || event.agentId !== undefined || !event.usage || !validUsage(event.usage)) return previous
  const usage = event.usage
  return { turns: previous.turns + 1, read: previous.read + usage.cache_read_input_tokens,
    input: previous.input + usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens }
}
export function cachePercent(value: CacheRate): number | null {
  if (value.turns === 0) return null
  return value.input === 0 ? 0 : Math.round(100 * value.read / value.input)
}
