// The keep-warm keeper (rules 2-8 and 11 of the brief). One instance per
// conversation; all time comes from the injected clock, all re-reads from the
// injected fork. Nothing here touches the file system, the network or timers.

import {
  ARM_MIN_USD,
  CAP_MS,
  CAP_NO_LOCK_MS,
  DEFAULT_REREAD_INPUT,
  DEFAULT_REREAD_OUTPUT,
  HIT_SHARE,
  KEEP_WARM_PROMPT,
  MARGIN_MS,
  MAX_REREAD_OUTPUT,
  RETURN_MISS_SHARE,
  SILENT_REASONS,
  SLEEP_GUARD_MS,
  TTL_MS,
  WINDOW_STOP_PERCENT,
} from './constants'
import type {
  ArmInput,
  ArmResult,
  Clock,
  ForkOutcome,
  ForkUsage,
  Keeper,
  KeeperEvent,
  KeeperStatus,
  LockSignal,
  PauseSummary,
  ReturnVerdict,
  StopReason,
  Ttl,
  WarmEnv,
} from './constants'

export function createKeeper(deps: {
  clock: Clock
  fork: (prompt: string) => Promise<ForkOutcome>
  env: WarmEnv
  onEvent?: (e: KeeperEvent) => void
}): Keeper {
  const { clock, fork, env } = deps
  const onEvent = deps.onEvent

  let state: 'idle' | 'armed' | 'stopped' = 'idle'
  let disabled = false
  let epoch = 0

  let pauseOpen = false
  let pauseStart = 0
  let sentAt = 0 // renewed by every successful re-read
  let armSentAt = 0 // the sentAt given to arm, for firstReply
  let ttl: Ttl = '5m'
  let prefix = 0
  let prices = { input: 0, write5m: 0, write1h: 0, read: 0, output: 0 }
  let delta = 0
  let spent = 0
  let rereads = 0
  let okHits = 0 // ok re-reads of this pause with cacheRead >= HIT_SHARE * prefix
  let goneCount = 0 // twice-gone counter, kept across pauses
  let measuredIn: number = DEFAULT_REREAD_INPUT
  let measuredOut: number = DEFAULT_REREAD_OUTPUT

  let turnRunning = false
  let resetFlag = false

  let cancelFn: (() => void) | null = null
  let nextAt: number | null = null

  let stoppedAt: number | null = null
  let stopReason: StopReason | null = null

  let summary: PauseSummary | null = null

  const emit = (e: KeeperEvent): void => {
    try {
      onEvent?.(e)
    } catch {
      // the keeper never throws
    }
  }

  // A throwing env getter counts as its stopping answer (rule 11).
  const switchOn = (): boolean => {
    try {
      return !!env.switchOn()
    } catch {
      return false
    }
  }
  const isNewest = (): boolean => {
    try {
      return !!env.isNewest()
    } catch {
      return false
    }
  }
  const lockNow = (): LockSignal => {
    try {
      return env.lock()
    } catch {
      return 'locked'
    }
  }
  const windowNow = (): number | null => {
    try {
      const w = env.windowPercent()
      return typeof w === 'number' ? w : null
    } catch {
      return 100
    }
  }

  // Rule 5: the estimate of the next re-read.
  const estimate = (): number =>
    (prefix * prices.read + measuredIn * prices.input + measuredOut * prices.output) / 1e6

  const writePrice = (): number => (ttl === '5m' ? prices.write5m : prices.write1h)

  const clearTimer = (): void => {
    if (cancelFn !== null) {
      const c = cancelFn
      cancelFn = null
      nextAt = null
      try {
        c()
      } catch {
        // ignore
      }
    }
  }

  const schedule = (at: number): void => {
    clearTimer()
    cancelFn = clock.after(Math.max(0, at - clock.now()), onTimer)
    nextAt = at
  }

  const stop = (at: number, reason: StopReason): void => {
    if (state !== 'armed') return
    clearTimer()
    state = 'stopped'
    stoppedAt = at
    stopReason = reason
    emit({ type: 'stop', at, reason })
  }

  const settle = (startedAt: number, myEpoch: number, outcome: ForkOutcome | null, charge: (usage: ForkUsage) => number): void => {
    const live = state === 'armed' && pauseOpen && myEpoch === epoch
    const usage = outcome?.usage ?? null
    const succeeded = outcome?.ok === true && usage !== null
    const usd = usage !== null ? charge(usage) : 0
    if (live && usage !== null) {
      spent += usd
      rereads += 1
      if (succeeded && usage.cacheRead >= HIT_SHARE * prefix) okHits += 1
    }
    emit({ type: 'reread', at: startedAt, ok: succeeded, usd, rereads })
    if (!live) return
    // Rule 11, checked as soon as the re-read settles, in this order.
    if (!succeeded || usage === null) {
      stop(clock.now(), 'error')
      return
    }
    if (usage.cacheRead < HIT_SHARE * prefix) {
      if (rereads === 1) goneCount += 1 // the first re-read of a pause
      if (goneCount >= 2) {
        disabled = true
        stop(clock.now(), 'unsupported')
      } else {
        stop(clock.now(), 'gone')
      }
      return
    }
    if (usage.output > MAX_REREAD_OUTPUT) {
      stop(clock.now(), 'costly')
      return
    }
    // The re-read succeeded.
    goneCount = 0
    sentAt = startedAt
    measuredIn = usage.input
    measuredOut = usage.output
    schedule(startedAt + TTL_MS[ttl] - MARGIN_MS[ttl])
  }

  const startReread = (startedAt: number): void => {
    const myEpoch = epoch
    // An old fork may settle after a different model/TTL is armed.
    const rates = { ...prices }, write = writePrice()
    const charge = (u: ForkUsage): number => (u.input * rates.input + u.cacheRead * rates.read + u.cacheWrite * write + u.output * rates.output) / 1e6
    let p: Promise<ForkOutcome | null>
    try {
      p = Promise.resolve(fork(KEEP_WARM_PROMPT))
    } catch {
      p = Promise.resolve(null) // a synchronous throw settles like a rejection
    }
    p.then(
      (o) => settle(startedAt, myEpoch, o ?? null, charge),
      () => settle(startedAt, myEpoch, null, charge),
    )
  }

  const onTimer = (): void => {
    cancelFn = null
    nextAt = null
    if (state !== 'armed' || !pauseOpen) return
    const t = clock.now()
    if (!switchOn()) {
      stop(t, 'off')
      return
    }
    if (turnRunning) {
      stop(t, 'turn')
      return
    }
    if (!isNewest()) {
      stop(t, 'other')
      return
    }
    const warmUntil = sentAt + TTL_MS[ttl]
    if (t >= warmUntil - SLEEP_GUARD_MS) {
      stop(t, 'slept')
      return
    }
    const lock = lockNow()
    if (lock === 'locked') {
      stop(t, 'locked')
      return
    }
    const cap = lock === 'none' ? CAP_NO_LOCK_MS : CAP_MS
    if (t + TTL_MS[ttl] > pauseStart + cap) {
      stop(t, 'cap')
      return
    }
    const k = estimate()
    if (spent + k > delta) {
      stop(t, 'budget')
      return
    }
    const w = windowNow()
    if (w !== null && w >= WINDOW_STOP_PERCENT) {
      stop(t, 'window')
      return
    }
    if (resetFlag) {
      stop(t, 'reset')
      return
    }
    startReread(t)
  }

  const arm = (a: ArmInput): ArmResult => {
    epoch += 1
    turnRunning = false
    clearTimer()
    summary = null
    pauseOpen = false
    if (!switchOn()) return { armed: false, why: 'off' }
    if (disabled) return { armed: false, why: 'disabled' }
    if (a.heldOff) return { armed: false, why: 'heldOff' }
    if (!a.observed) return { armed: false, why: 'unobserved' }
    const d = a.prefix * ((a.ttl === '5m' ? a.prices.write5m : a.prices.write1h) - a.prices.read) / 1e6
    if (d < ARM_MIN_USD) return { armed: false, why: 'small' }
    if (!a.interactive) return { armed: false, why: 'notInteractive' }
    if (!isNewest()) return { armed: false, why: 'notNewest' }
    if (a.cronWithinTtl) return { armed: false, why: 'cron' }
    pauseStart = clock.now()
    sentAt = a.sentAt
    armSentAt = a.sentAt
    ttl = a.ttl
    prefix = a.prefix
    prices = a.prices
    delta = d
    spent = 0
    rereads = 0
    okHits = 0
    resetFlag = false
    stoppedAt = null
    stopReason = null
    state = 'armed'
    pauseOpen = true
    const firstAt = a.sentAt + TTL_MS[a.ttl] - MARGIN_MS[a.ttl]
    schedule(firstAt)
    return { armed: true, firstAt, deltaUsd: d }
  }

  const turnStarted = (origin: 'composer' | 'bridge' | 'other'): PauseSummary | null => {
    turnRunning = true
    if (!pauseOpen) return null
    const end = clock.now()
    let reason: StopReason
    let sAt: number | null
    if (state === 'armed') {
      clearTimer()
      reason = 'turn'
      sAt = null
      emit({ type: 'stop', at: end, reason: 'turn' })
    } else {
      reason = stopReason ?? 'turn'
      sAt = stoppedAt
    }
    const allHit = rereads >= 1 && okHits === rereads
    const announce =
      (origin === 'composer' || origin === 'bridge') && (rereads >= 1 || SILENT_REASONS.indexOf(reason) < 0)
    summary = {
      start: pauseStart,
      end,
      rereads,
      spentUsd: spent,
      deltaUsd: delta,
      stoppedAt: sAt,
      reason,
      announce,
      allHit,
      warmUntil: sentAt + TTL_MS[ttl],
    }
    pauseOpen = false
    state = 'idle'
    stoppedAt = null
    stopReason = null
    return summary
  }

  const firstReply = (cacheRead: number, explained: boolean): ReturnVerdict | null => {
    const s = summary
    if (s === null) return null
    summary = null
    const warmOnReturn = cacheRead >= HIT_SHARE * prefix
    let savedUsd: number
    if (s.rereads === 0) savedUsd = 0
    else if (warmOnReturn && s.end >= armSentAt + TTL_MS[ttl]) savedUsd = delta - s.spentUsd
    else savedUsd = -s.spentUsd
    const notHeld = s.allHit && s.end < s.warmUntil && cacheRead < RETURN_MISS_SHARE * prefix && !explained
    return { warmOnReturn, savedUsd, notHeld }
  }

  const reset = (): void => {
    resetFlag = true
  }

  const cancel = (reason: 'off' | 'reset' = 'off'): void => {
    if (state === 'armed') stop(clock.now(), reason)
  }

  const status = (): KeeperStatus => {
    let stopsBy: number | null = null
    if (cancelFn !== null && nextAt !== null && state === 'armed' && pauseOpen) {
      const cap = lockNow() === 'none' ? CAP_NO_LOCK_MS : CAP_MS
      const ttlMs = TTL_MS[ttl]
      const k = estimate()
      let s = sentAt
      let n = nextAt
      let sp = spent
      while (n + ttlMs <= pauseStart + cap && sp + k <= delta) {
        s = n
        sp = sp + k
        n = s + ttlMs - MARGIN_MS[ttl]
      }
      stopsBy = s + ttlMs
    }
    return {
      state,
      pauseStart: pauseOpen ? pauseStart : null,
      rereads,
      spentUsd: spent,
      warmUntil: pauseOpen ? sentAt + TTL_MS[ttl] : null,
      nextAt: cancelFn !== null ? nextAt : null,
      stopsBy,
      reason: state === 'stopped' ? stopReason : null,
      disabled,
    }
  }

  return { arm, turnStarted, firstReply, reset, cancel, status }
}
