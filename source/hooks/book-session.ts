// Event-owned session memory: this session's cache reading for the book.
import type { TurnCompleteInput } from 'claude-code'
import { cachePercent, countCacheTurn, emptyCacheRate } from './cache-rate'

let cache = emptyCacheRate()

export function resetBookSession(): void {
  cache = emptyCacheRate()
}
export function countBookCache(event: TurnCompleteInput, sessionIsFork = false): void {
  cache = countCacheTurn(cache, event, sessionIsFork)
}
export function bookCachePercent(): number | null { return cachePercent(cache) }
