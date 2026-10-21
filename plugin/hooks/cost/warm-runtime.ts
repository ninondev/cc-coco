import type { ArmInput, ArmResult, Clock, ForkOutcome, ForkUsage, Keeper, KeeperEvent, KeeperStatus, LockSignal, PauseSummary, ReturnVerdict } from './warm/constants'
import { createKeeper } from './warm/keeper'
import { resolveLock } from './warm/lock'

type MaybePromise<T> = T | Promise<T>
export interface WarmStore {
  get(key: string): MaybePromise<unknown>
  set(key: string, value: unknown): MaybePromise<unknown>
}
export interface WarmToday { date: string; pauses: number; pings: number; usd: number; saved: number }
export interface WarmRuntimeDeps {
  clock: Clock
  fork(prompt: string): Promise<ForkOutcome>
  store: WarmStore
  isNewest(): MaybePromise<boolean>
  readLock(): Promise<LockSignal>
  windowPercent(): MaybePromise<number | null>
  billingKind(): string
  /** Stable machine identity, never sent to a model. */
  computerId?: string
  onReread?(event: Extract<KeeperEvent, { type: 'reread' }> & { usage?: ForkUsage }): void
  onStop?(event: Extract<KeeperEvent, { type: 'stop' }>): void
}
export interface WarmRuntime {
  arm(input: ArmInput): Promise<ArmResult>
  setEnabled(enabled: boolean): Promise<void>
  syncEnabled(): Promise<void>
  turnStarted(origin: 'composer' | 'bridge' | 'other'): Promise<PauseSummary | null>
  firstReply(cacheRead: number, explained: boolean): Promise<ReturnVerdict | null>
  reset(): void
  close(): Promise<void>
  status(): KeeperStatus | null
  disabledReason(): 'notHeld' | null
  flush(): Promise<void>
}

// These holds cover runtimes in this process only. A durable per-billing-kind
// computer hold needs a field outside the exact section-9 schema. Presence
// claims coordinate newest-prompt ownership; they do not carry this hold.
const disabledKinds = new Map<string, Set<string>>()
const inFlight = new Set<string>()
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const localDay = (time: number): string => {
  const d = new Date(time)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function createWarmRuntime(deps: WarmRuntimeDeps): WarmRuntime {
  const machine = deps.computerId ?? 'local'
  let keeper: Keeper | null = null
  let enabled = false
  let lock: LockSignal = 'none'
  let newest = false
  let window: number | null = null
  let pendingReturn: PauseSummary | null = null
  let pauseStart: number | null = null
  let generation = 0
  let closed = false
  let lastForkUsage: ForkUsage | undefined
  type Accounting = { start: number; summary?: PauseSummary; verdict?: ReturnVerdict; latePings: number; lateUsd: number; counted: boolean; appliedSaved: number }
  let activeAccounting: Accounting | undefined
  let pendingForkAccounting: Accounting | undefined
  let lastForkAccounting: Accounting | undefined
  let lastForkGeneration = 0
  const accounts = new Map<number, Accounting>()
  let queue: Promise<void> = Promise.resolve()
  const heldOff = (): boolean => disabledKinds.get(machine)?.has(deps.billingKind()) === true
  const enqueue = (work: () => Promise<void>): void => {
    queue = queue.then(work).catch(() => { /* Store failure cannot start a fork. */ })
  }
  const today = async (): Promise<WarmToday> => {
    const date = localDay(deps.clock.now())
    const old = record(await deps.store.get('warm.today'))
    if (old.date !== date) return { date, pauses: 0, pings: 0, usd: 0, saved: 0 }
    const n = (key: string): number => typeof old[key] === 'number' && Number.isFinite(old[key]) ? old[key] as number : 0
    return { date, pauses: n('pauses'), pings: n('pings'), usd: n('usd'), saved: n('saved') }
  }
  // A paid re-read can settle after the person has come back; the pause keeps its summary and verdict so the
  // fee still corrects that pause's saving once.
  const remember = (summary: PauseSummary, verdict?: ReturnVerdict): void => {
    const account = accounts.get(summary.start)
    if (account) { account.summary = summary; if (verdict) account.verdict = verdict }
  }
  const refresh = async (): Promise<void> => {
    enabled = record(await deps.store.get('more')).warm === true && !closed && !heldOff()
    if (!enabled) return
    newest = await deps.isNewest()
    // Keep the stop order: no lock command when this session already lost.
    if (!newest) return
    lock = await deps.readLock().catch(() => 'none' as const)
    window = await deps.windowPercent()
  }
  const load = async (): Promise<Keeper> => {
    if (keeper) return keeper
    // Keeper state is created on the first enabled arm.
    const clock: Clock = {
      now: () => deps.clock.now(),
      after: (ms, callback) => {
        const epoch = generation
        let cancelled = false
        const cancel = deps.clock.after(ms, () => {
          void refresh().then(() => {
            if (!cancelled && epoch === generation && !closed) callback()
          }).catch(() => { keeper?.cancel() })
        })
        return () => { cancelled = true; cancel() }
      },
    }
    keeper = createKeeper({
      clock,
      fork: async (prompt) => {
        lastForkUsage = undefined
        if (inFlight.has(machine)) return { ok: false }
        const account = activeAccounting, forkGeneration = generation
        pendingForkAccounting = account
        inFlight.add(machine)
        try {
          const outcome = await deps.fork(prompt)
          lastForkUsage = outcome.usage
          lastForkAccounting = account; lastForkGeneration = forkGeneration
          return outcome
        }
        finally { inFlight.delete(machine); pendingForkAccounting = undefined }
      },
      env: {
        switchOn: () => enabled && !heldOff(), isNewest: () => newest,
        lock: () => lock, windowPercent: () => window,
      },
      onEvent: event => {
        if (event.type === 'reread') {
          const usage = lastForkUsage
          const account = lastForkAccounting
          const late = !!account && (lastForkGeneration !== generation || activeAccounting !== account || keeper?.status().state !== 'armed')
          if (usage && late && account) { account.latePings++; account.lateUsd += event.usd }
          // The pure keeper emits before it renews sentAt and schedules next.
          // Publish after settlement so the surface sees the finished state.
          void Promise.resolve().then(() => {
            try { deps.onReread?.({ ...event, usage }) } catch { /* Observer failure is isolated. */ }
          })
          if (usage !== undefined) enqueue(async () => {
            const t = await today()
            let saved = t.saved, pauseCount = t.pauses
            if (late && account?.verdict && account.summary) {
              const target = account.verdict.savedUsd - account.lateUsd
              saved += target - account.appliedSaved; account.appliedSaved = target
              if (!account.counted) { pauseCount++; account.counted = true }
            }
            await deps.store.set('warm.today', { ...t, pings: t.pings + 1, usd: t.usd + event.usd, pauses: pauseCount, saved })
          })
        } else {
          try { deps.onStop?.(event) } catch { /* Observer failure is isolated. */ }
        }
      },
    })
    return keeper
  }
  return {
    arm: async input => {
      // W1: no keeper instance, timer, fork, or lock check while off.
      if (!closed) pauseStart = deps.clock.now()
      const epoch = generation
      await refresh()
      if (!enabled) return { armed: false, why: heldOff() ? 'heldOff' : 'off' }
      const k = await load()
      if (closed || epoch !== generation) return { armed: false, why: 'off' }
      // Retain only the current/returning pause and an outstanding fork's
      // origin, rather than growing a session-long accounting history.
      for (const [start, old] of accounts) if (old !== pendingForkAccounting && start !== pendingReturn?.start) accounts.delete(start)
      const account: Accounting = { start: pauseStart ?? deps.clock.now(), latePings: 0, lateUsd: 0, counted: false, appliedSaved: 0 }
      activeAccounting = account; accounts.set(account.start, account)
      const result = k.arm(input)
      if (!result.armed) { accounts.delete(account.start); activeAccounting = undefined }
      return result
    },
    setEnabled: async value => {
      const more = record(await deps.store.get('more'))
      await deps.store.set('more', { ...more, warm: value })
      enabled = value
      if (value) {
        disabledKinds.get(machine)?.delete(deps.billingKind())
        // Session unsupported holds are released by a deliberate toggle too.
        if (keeper?.status().disabled) keeper = null
      } else { generation += 1; keeper?.cancel() }
    },
    syncEnabled: async () => {
      enabled = record(await deps.store.get('more')).warm === true && !closed && !heldOff()
      if (!enabled) { generation += 1; keeper?.cancel() }
    },
    turnStarted: async origin => {
      generation += 1
      const s = keeper?.turnStarted(origin) ?? null
      pauseStart = null
      pendingReturn = s
      await queue
      if (s) remember(s)
      return s
    },
    firstReply: async (cacheRead, explained) => {
      const verdict = keeper?.firstReply(cacheRead, explained) ?? null
      const s = pendingReturn
      pendingReturn = null
      if (!verdict || !s) return verdict
      if (verdict.notHeld) {
        const kinds = disabledKinds.get(machine) ?? new Set<string>()
        kinds.add(deps.billingKind()); disabledKinds.set(machine, kinds)
        enabled = false; keeper?.cancel()
      }
      await queue
      remember(s, verdict)
      const account = accounts.get(s.start), total = s.rereads + (account?.latePings ?? 0)
      if (total > 0) {
        const t = await today()
        const saved = verdict.savedUsd - (account?.lateUsd ?? 0)
        await deps.store.set('warm.today', { ...t, pauses: t.pauses + (account?.counted ? 0 : 1), saved: t.saved + saved - (account?.appliedSaved ?? 0) })
        if (account) { account.counted = true; account.appliedSaved = saved }
      }
      return account ? { ...verdict, savedUsd: verdict.savedUsd - account.lateUsd } : verdict
    },
    reset: () => {
      generation += 1
      keeper?.reset()
      keeper?.cancel('reset')
    },
    close: async () => {
      closed = true; enabled = false; generation += 1
      keeper?.cancel()
      pauseStart = null
      await queue
    },
    status: () => keeper?.status() ?? null,
    disabledReason: () => heldOff() ? 'notHeld' : null,
    flush: () => queue,
  }
}

export interface LockReaderDeps {
  now(): number
  platform: 'darwin' | 'linux' | 'win32' | string
  terminal: boolean
  away(): MaybePromise<{ state: 'locked' | 'display-asleep' | null; since: number } | null>
  run(argv: string[]): Promise<string | null>
  linuxSessionId?: string
}
export function createLockReader(deps: LockReaderDeps): () => Promise<LockSignal> {
  return async () => {
    const away = await Promise.resolve().then(() => deps.away()).catch(() => null)
    const now = deps.now()
    const fresh = away && Number.isFinite(away.since) && away.since <= now && now - away.since < 600000 ? away : null
    if (fresh) return resolveLock({ now, away: fresh })
    try {
      if (deps.platform === 'darwin' && deps.terminal) return resolveLock({ now, ioreg: await deps.run(['/usr/sbin/ioreg', '-n', 'Root', '-d1']) })
      if (deps.platform === 'linux' && deps.linuxSessionId) return resolveLock({ now, loginctl: await deps.run(['loginctl', 'show-session', deps.linuxSessionId, '-p', 'LockedHint', '--value']) })
    } catch { /* No readable system flag uses the 30-minute cap. */ }
    return 'none'
  }
}
