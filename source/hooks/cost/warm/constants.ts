// Constants and shared shapes for the keep-warm scheduler (rules 1 and 2 of the brief).

export type Ttl = '5m' | '1h'

export interface Prices {
  input: number
  write5m: number
  write1h: number
  read: number
  output: number
}

export const KEEP_WARM_PROMPT: 'Reply with the single word: ok' = 'Reply with the single word: ok'

export const TTL_MS: { readonly '5m': 300000; readonly '1h': 3600000 } = { '5m': 300000, '1h': 3600000 }
export const MARGIN_MS: { readonly '5m': 60000; readonly '1h': 240000 } = { '5m': 60000, '1h': 240000 }
export const CAP_MS: 7200000 = 7200000
export const CAP_NO_LOCK_MS: 1800000 = 1800000
export const SLEEP_GUARD_MS: 5000 = 5000
export const ARM_MIN_USD: 0.05 = 0.05
export const HIT_SHARE: 0.9 = 0.9
export const RETURN_MISS_SHARE: 0.5 = 0.5
export const MAX_REREAD_OUTPUT: 1000 = 1000
export const WINDOW_STOP_PERCENT: 95 = 95
export const DEFAULT_REREAD_INPUT: 30 = 30
export const DEFAULT_REREAD_OUTPUT: 150 = 150

export interface ForkUsage {
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
}

// Even an unsuccessful engine request may report billed usage.
export type ForkOutcome = { ok: true; usage: ForkUsage } | { ok: false; usage?: ForkUsage }

export type ForkFn = (prompt: string) => Promise<ForkOutcome>

export interface Clock {
  now(): number
  after(ms: number, fn: () => void): () => void
}

export type LockSignal = 'locked' | 'unlocked' | 'none'

export interface WarmEnv {
  switchOn(): boolean
  isNewest(): boolean
  lock(): LockSignal
  windowPercent(): number | null
}

export type StopReason =
  | 'off'
  | 'turn'
  | 'other'
  | 'slept'
  | 'locked'
  | 'cap'
  | 'budget'
  | 'window'
  | 'reset'
  | 'gone'
  | 'error'
  | 'costly'
  | 'unsupported'

export const SILENT_REASONS: readonly StopReason[] = ['off', 'turn', 'reset']

export interface ArmInput {
  sentAt: number
  prefix: number
  ttl: Ttl
  prices: Prices
  observed: boolean
  interactive: boolean
  cronWithinTtl: boolean
  heldOff: boolean
}

export type ArmRefusal =
  | 'off'
  | 'disabled'
  | 'heldOff'
  | 'unobserved'
  | 'small'
  | 'notInteractive'
  | 'notNewest'
  | 'cron'

export type ArmResult = { armed: true; firstAt: number; deltaUsd: number } | { armed: false; why: ArmRefusal }

export interface PauseSummary {
  start: number
  end: number
  rereads: number
  spentUsd: number
  deltaUsd: number
  stoppedAt: number | null
  reason: StopReason
  announce: boolean
  allHit: boolean
  warmUntil: number
}

export interface ReturnVerdict {
  warmOnReturn: boolean
  savedUsd: number
  notHeld: boolean
}

export interface KeeperStatus {
  state: 'idle' | 'armed' | 'stopped'
  pauseStart: number | null
  rereads: number
  spentUsd: number
  warmUntil: number | null
  nextAt: number | null
  stopsBy: number | null
  reason: StopReason | null
  disabled: boolean
}

export type KeeperEvent =
  | { type: 'reread'; at: number; ok: boolean; usd: number; rereads: number }
  | { type: 'stop'; at: number; reason: StopReason }

export interface Keeper {
  arm(a: ArmInput): ArmResult
  turnStarted(origin: 'composer' | 'bridge' | 'other'): PauseSummary | null
  firstReply(cacheRead: number, explained: boolean): ReturnVerdict | null
  reset(): void
  cancel(reason?: 'off' | 'reset'): void
  status(): KeeperStatus
}
