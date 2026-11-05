import { core as c, dayStart, newestTable, normalizeModelId, priceAt, priceFor, createWarmRuntime, estimateOtherModel, knownOtherPrices } from './units.js'
import type * as CostTypes from './core'
import type { ShippedPrices, StoredPrices } from './prices'
import type { OtherMaker } from './prices/others'
import type { CostSurfaceSnapshot } from '../../types'
import { setCostSnapshot } from './state'
import type { CostFeatureSettings } from './features'
import type { WarmRuntime } from './warm-runtime'
import type { ForkOutcome, LockSignal, PauseSummary } from './warm/constants'

type Raw = Record<string, unknown>
type Store = { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<unknown>; keys(): Promise<string[]> }
export interface CostDeps {
  store: Store
  now(): number
  after(ms: number, callback: () => void): () => void
  usage(): Promise<unknown>
  sessionId(): Promise<string>
  env: Record<string, string | undefined>
  settings: Raw
  policy: Raw
  shipped: ShippedPrices
  isNewest(): Promise<boolean>
  readLock(): Promise<LockSignal>
  /** The system's screen lock cannot be read here, so keeping warm stops after 30 minutes (CAP_NO_LOCK_MS). */
  lockUnseen?: boolean
  /** A kept-warm pause that the next real message read warm and that saved money (their sock drawer's mint pair). */
  saved?(): void
  fork(prompt: string): Promise<ForkOutcome>
  changed(snapshot: CostSurfaceSnapshot): void
}
const object = (v: unknown): Raw => v && typeof v === 'object' && !Array.isArray(v) ? v as Raw : {}
const number = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null
export function usageTokens(value: unknown): CostTypes.Usage {
  const u = object(value)
  return { input: number(u.input_tokens) ?? 0, output: number(u.output_tokens) ?? 0,
    cacheRead: number(u.cache_read_input_tokens) ?? 0, cacheWrite: number(u.cache_creation_input_tokens) ?? 0 }
}
export function limitsReading(value: unknown): CostTypes.LimitsReading {
  const out: CostTypes.LimitsReading = {}
  if (Array.isArray(value)) for (const raw of value) {
    const w = object(raw), percent = number(w.percentUsed)
    if (percent === null) continue
    const resetsAt = typeof w.resetsAt === 'string' ? Date.parse(w.resetsAt) : typeof w.resetsAt === 'number' ? w.resetsAt : NaN
    // Missing reset identity must never produce a comparable window movement.
    const reading = { usedPercent: percent, resetsAt }
    if (w.kind === 'five_hour') out.fiveHour = reading
    if (w.kind === 'seven_day') out.sevenDay = reading
    if (w.kind === 'spend_limit') out.spendLimit = w
  }
  return out
}
function policyPrice(raw: unknown): CostTypes.Prices | null {
  const p = object(raw)
  const input = number(p.input), output = number(p.output)
  if (input === null || output === null) return null
  // Managed entries use dollars per million tokens, as the engine catalog does.
  const read = number(p.read)
  const write5m = number(p.write5m)
  const write1h = number(p.write1h)
  if (read === null || write5m === null || write1h === null) return null
  return { input, output, read, write5m, write1h }
}
export function fixedCronMs(expression: string): number | null {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5 || fields.slice(2).some(f => f !== '*')) return null
  const minute = /^\*\/(\d+)$/.exec(fields[0] ?? '')
  if (fields[1] === '*' && (fields[0] === '*' || minute)) {
    const n = minute ? Number(minute[1]) : 1
    return n >= 1 && n <= 60 && 60 % n === 0 ? n * 60000 : null
  }
  const hour = /^\*\/(\d+)$/.exec(fields[1] ?? '')
  if (/^\d+$/.test(fields[0] ?? '') && Number(fields[0]) < 60 && (fields[1] === '*' || hour)) {
    const n = hour ? Number(hour[1]) : 1
    return n >= 1 && n <= 24 && 24 % n === 0 ? n * 3600000 : null
  }
  return null
}

export class CostRuntime {
  private payer = c.initialPayer()
  private cache = c.initialCache()
  private last: CostTypes.LedgerReading = { costUsd: null, limits: {} }
  private baseline?: CostTypes.TurnBaseline
  private lastTurn?: CostTypes.TurnCost
  private modelItems: { model: string; usage: CostTypes.Usage; day: string }[] = []
  private modelsRecordedThrough = 0
  private calls: { day: string; usd: number }[] = []
  private storedPrices: StoredPrices | null = null
  private otherPrices: OtherMaker[]
  private turnItemsFrom = 0
  private lastMakerTurnUSD: number | null = null
  private unknownHelpers = new Set<string>()
  private running = false
  private interactive = false
  private visible = false
  private crons: { id: string; expression: string; recurring: boolean }[] = []
  private loopsTold = new Set<string>()
  private indicatorCancels: (() => void)[] = []
  private indicatorDeadlines = ''
  private ledgerAt: number | null = null
  private ledgerGrowth = 0
  private ledgerQueue = Promise.resolve()
  private helperSums = new Map<string, number>()
  private warmEnabled = false
  private warmAsked = false
  private warmAsking = false
  private cacheRevision = 0
  private warm: WarmRuntime
  constructor(private deps: CostDeps) {
    this.otherPrices = deps.shipped.others ?? []
    this.warm = createWarmRuntime({ clock: { now: deps.now, after: deps.after }, store: deps.store,
      isNewest: deps.isNewest, sessionId: () => deps.sessionId(), readLock: deps.readLock, billingKind: () => this.payer.kind,
      windowPercent: () => Math.max(this.last.limits?.fiveHour?.usedPercent ?? 0, this.last.limits?.sevenDay?.usedPercent ?? 0),
      fork: async prompt => {
        const startedAt = deps.now()
        const model = this.cache.model ?? '', revision = this.cacheRevision
        const result = await deps.fork(prompt)
        if (result.usage) await this.ownCall(model, result.usage, startedAt, result.ok && result.usage.output <= 1000 && revision === this.cacheRevision)
        return result
      },
      onReread: () => this.publish(), onStop: () => { this.scheduleIndicator(); this.publish() } })
  }
  setInteractive(value: boolean): void { this.interactive = value }
  revision(): number { return this.cacheRevision }
  settings(settings: Raw, policy: Raw): void {
    const ttl = this.ttl()
    this.deps.settings = settings; this.deps.policy = policy
    if (this.ttl() !== ttl) { this.cacheRevision++; this.warm.reset() }
    this.scheduleIndicator(); this.publish()
  }
  private ttl(): CostTypes.Ttl { return c.resolveTtl({ env: this.deps.env, settingsTtl: this.deps.settings.promptCacheTtl, kind: this.payer.kind, evidence: this.cache.evidence }).ttl }
  // `promptTokens` is the whole prompt of the request being priced (input, cache reads and cache writes together):
  // a model with a second price above 100,000 tokens uses it for that request alone.
  prices(model: string, promptTokens = 0): CostTypes.Prices | null {
    const managed = object(this.deps.policy.modelPricing)
    const configured = policyPrice(managed[model])
    if (configured) return configured
    if (Object.keys(managed).length) return null
    // A fetched page that lacks a model the shipped table has (a row it could not read) must not unprice it.
    const row = priceFor(model, newestTable(this.storedPrices, this.deps.shipped).rows, this.deps.shipped.aliases)
      ?? priceFor(model, this.deps.shipped.rows, this.deps.shipped.aliases)
    return row ? priceAt(row, promptTokens) : null
  }
  private estimate(model: string, usage: CostTypes.Usage): number | null {
    const prices = this.prices(model, usage.input + usage.cacheRead + usage.cacheWrite)
    if (prices) return c.priceUsage(usage, prices, this.ttl())
    if (Object.keys(object(this.deps.policy.modelPricing)).length) return null
    return estimateOtherModel(model, { input: usage.input, read: usage.cacheRead, write: usage.cacheWrite, output: usage.output }, this.otherPrices)
  }
  private estimatedModels(items: { model: string; usage: CostTypes.Usage }[]): Map<string, number> | null {
    if (!items.length) return null
    const sums = new Map<string, number>()
    for (const item of items) {
      const usd = this.estimate(item.model, item.usage)
      if (usd === null) return null
      sums.set(item.model, (sums.get(item.model) ?? 0) + usd)
    }
    return sums
  }
  async refreshPrices(): Promise<void> {
    const [claude, others] = await Promise.all([this.deps.store.get('prices.claude'), knownOtherPrices(this.deps.store, this.deps.shipped)])
    this.storedPrices = claude as StoredPrices | null; this.otherPrices = others; this.publish()
  }
  // r20-14 item 1: one cache re-creation on another model at its own tier; an estimate.
  nextOnOtherModel(model: string, tokens: number): number | null {
    if (!(tokens > 0)) return null
    const prices = this.prices(model, tokens)
    return prices ? (tokens * (this.ttl() === '1h' ? prices.write1h : prices.write5m)) / 1e6 : null
  }
  // r20-14 item 2: a prompt's input cost on the current model; null when no price applies.
  inputCostUsd(tokens: number): number | null {
    const model = this.cache.model
    if (!model || !(tokens > 0)) return null
    const prices = this.prices(model, tokens)
    return prices ? (tokens * prices.input) / 1e6 : null
  }
  // The cost features' switches (r20-14); parsed here so the compiled runtime's imports stay units and state.
  private features: CostFeatureSettings = {}
  private async readFeatures(): Promise<CostFeatureSettings> {
    const raw = object(await this.deps.store.get('cost.features')), paste = raw.pasteBytes, cap = raw.dayCapUsd
    return {
      ...(raw.switchCost === true ? { switchCost: true } : {}),
      ...(typeof paste === 'number' && Number.isFinite(paste) && paste > 0 ? { pasteBytes: paste } : {}),
      ...(typeof cap === 'number' && Number.isFinite(cap) && (cap as number) > 0 ? { dayCapUsd: cap as number } : {}),
      ...(raw.costForecast === true ? { costForecast: true } : {}),
      ...(raw.costFolders === true ? { costFolders: true } : {}),
      ...(raw.planConvert === true ? { planConvert: true } : {}),
    }
  }
  async syncFeatures(): Promise<void> { this.features = await this.readFeatures(); this.publish() }
  // r20-14 item 3: today's spend across the local ledgers, the offerings page's figure.
  async todayLedgerUsd(): Promise<number> {
    const keys = (await this.deps.store.keys()).filter(key => key.startsWith('ledger.'))
    const ledgers = await Promise.all(keys.map(async key => object(await this.deps.store.get(key)) as CostTypes.DayLedger))
    return c.ledgerTotals(ledgers, c.localDay(this.deps.now())).today
  }
  measure(value: unknown): void {
    const ttl = this.ttl()
    const u = object(value)
    this.last = { costUsd: number(object(u.cost).usd), limits: limitsReading(u.rateLimits) }
    this.payer = c.updatePayer(this.payer, { type: 'measure', env: this.deps.env, limits: this.last.limits, policyPricing: Object.keys(object(this.deps.policy.modelPricing)).length > 0 })
    if (this.ttl() !== ttl) { this.cacheRevision++; this.warm.reset() }
    if (this.last.costUsd !== null) {
      if (this.ledgerAt !== null && this.last.costUsd >= this.ledgerAt) this.ledgerGrowth += this.last.costUsd - this.ledgerAt
      this.ledgerAt = this.last.costUsd
    }
    this.scheduleIndicator(); this.publish()
  }
  private cancelIndicator(): void { for (const cancel of this.indicatorCancels) cancel(); this.indicatorCancels = []; this.indicatorDeadlines = '' }
  visibility(shown: boolean): void {
    if (this.visible === shown) return
    this.visible = shown; this.scheduleIndicator()
  }
  private scheduleIndicator(): void {
    const now = this.deps.now()
    const deadlines = this.running || !this.visible || this.warm.status()?.state === 'armed' ? [] :
      c.indicatorTimers(this.cache, this.ttl(), c.indicatorShown(this.cache, this.cache.model ? this.prices(this.cache.model, this.cache.prefix) : null, this.ttl())).filter(at => at > now)
    const signature = deadlines.join(',')
    if (signature === this.indicatorDeadlines) return
    this.cancelIndicator(); this.indicatorDeadlines = signature
    for (const at of deadlines) {
      let cancel: () => void
      cancel = this.deps.after(at - now, () => { this.indicatorCancels = this.indicatorCancels.filter(f => f !== cancel); this.publish() })
      this.indicatorCancels.push(cancel)
    }
  }
  // The pause that just ended, for the one line they say when you come back (COST-CACHE 4.7).
  async turnStart(origin: 'composer' | 'bridge' | 'other', reading?: unknown): Promise<PauseSummary | null> {
    this.cancelIndicator(); this.running = true
    this.turnItemsFrom = this.modelItems.length
    const pause = await this.warm.turnStarted(origin)
    this.measure(reading === undefined ? await this.deps.usage().catch(() => ({})) : reading)
    this.baseline = c.turnBaseline(this.last)
    this.publish()
    return pause
  }
  async step(startedAt: number, raw: unknown, main: boolean, agentId?: string): Promise<void> {
    const u = object(raw), tokens = usageTokens(u), model = typeof u.model === 'string' ? u.model : this.cache.model ?? ''
    const price = this.prices(model, tokens.input + tokens.cacheRead + tokens.cacheWrite)
    this.modelItems.push({ model, usage: tokens, day: c.localDay(this.deps.now()) })
    if (!main) {
      if (agentId) {
        const usd = this.estimate(model, tokens)
        if (usd === null) this.unknownHelpers.add(agentId)
        else this.helperSums.set(agentId, (this.helperSums.get(agentId) ?? 0) + usd)
      }
      return
    }
    this.payer = c.updatePayer(this.payer, { type: 'response', main: true, hasUsage: true, modelPriced: price !== null })
    const verdict = await this.warm.firstReply(tokens.cacheRead, this.cache.prefix === 0 || model !== this.cache.model)
    if (verdict?.warmOnReturn && verdict.savedUsd > 0) this.deps.saved?.()
    if (this.cache.model && model !== this.cache.model) this.cache = c.onReset(this.cache)
    this.cacheRevision++
    this.cache = c.onMainStep(this.cache, { startedAt, usage: tokens, model }, { ttl: this.ttl(), prices: price })
    this.publish()
  }
  async turnComplete(rawUsage: unknown, main = true): Promise<void> {
    if (!main) return
    this.measure(await this.deps.usage().catch(() => ({})))
    this.running = false
    const turnItems = this.modelItems.slice(this.turnItemsFrom)
    const turnRaw = object(rawUsage), turnModel = typeof turnRaw.model === 'string' ? turnRaw.model : this.cache.model ?? ''
    const turnEstimates = this.estimatedModels(turnItems.length ? turnItems : [{ model: turnModel, usage: usageTokens(rawUsage) }])
    this.lastMakerTurnUSD = turnEstimates ? [...turnEstimates.values()].reduce((sum, usd) => sum + usd, 0) : null
    this.lastTurn = c.turnCost(this.baseline ?? { c0: null, window: null }, this.last, usageTokens(rawUsage), { prices: this.cache.model ? this.prices(this.cache.model, this.cache.prefix) : null, ttl: this.ttl() })
    if (this.baseline?.c0 == null || this.last.costUsd === null) {
      const items = this.modelItems.slice(this.turnItemsFrom)
      const raw = object(rawUsage), model = typeof raw.model === 'string' ? raw.model : this.cache.model ?? ''
      const sums = this.estimatedModels(items.length ? items : [{ model, usage: usageTokens(rawUsage) }])
      this.lastTurn.usd = sums ? [...sums.values()].reduce((sum, usd) => sum + usd, 0) : null
      this.lastTurn.estimated = sums !== null
    }
    this.baseline = undefined
    await this.flushLedger()
    await this.recordUsed()
    const prices = this.cache.model ? this.prices(this.cache.model, this.cache.prefix) : null
    if (this.warm.asked()) this.warmAsked = true
    await this.warm.arm({ sentAt: this.cache.sentAt ?? this.deps.now(), prefix: prices ? this.cache.prefix : 0, ttl: this.ttl(), prices: prices ?? { input: 0, output: 0, read: 0, write5m: 0, write1h: 0 }, observed: prices !== null && this.cache.observed,
      interactive: this.interactive, cronWithinTtl: this.crons.some(cron => cron.recurring && (fixedCronMs(cron.expression) ?? Infinity) <= c.TTL_MS[this.ttl()]), heldOff: false })
    // arm refreshes the switch state first, so the snapshot carries this conversation's row.
    this.warmEnabled = this.warm.isEnabled()
    this.scheduleIndicator(); this.publish()
  }
  async ownCall(model: string, usage: CostTypes.Usage, startedAt: number, fork = false): Promise<void> {
    this.modelItems.push({ model, usage, day: c.localDay(this.deps.now()) })
    const usd = this.estimate(model, usage)
    if (usd !== null) this.calls.push({ day: c.localDay(this.deps.now()), usd })
    if (fork) this.cache = c.onForkRead(this.cache, { startedAt, cacheRead: usage.cacheRead })
    this.measure(await this.deps.usage().catch(() => ({})))
    await this.flushLedger(); this.scheduleIndicator(); this.publish()
  }
  reset(ttlEvidence?: unknown): void { this.cacheRevision++; this.cache = c.onReset(this.cache); this.cache = c.onTtlEvidence(this.cache, ttlEvidence); this.warm.reset(); this.cancelIndicator(); this.publish() }
  ttlEvidence(ttl: unknown): void {
    const before = this.ttl()
    this.cache = c.onTtlEvidence(this.cache, ttl)
    if (this.ttl() !== before) { this.cacheRevision++; this.warm.reset() }
    this.scheduleIndicator(); this.publish()
  }
  cronsChanged(rows: unknown): void {
    this.crons = Array.isArray(rows) ? rows.flatMap(v => { const r = object(v); return typeof r.id === 'string' && typeof r.schedule === 'string' ? [{ id: r.id, expression: r.schedule, recurring: r.recurring === true }] : [] }) : []
    if (this.crons.some(cron => cron.recurring && (fixedCronMs(cron.expression) ?? Infinity) <= c.TTL_MS[this.ttl()])) this.warm.reset()
  }
  // Recurring crons with a fixed period not yet named in a note (COST-CACHE 3.8: each /loop once).
  untoldLoops(): { id: string; everyMs: number }[] {
    return this.crons.flatMap(cron => { const ms = cron.recurring && !this.loopsTold.has(cron.id) ? fixedCronMs(cron.expression) : null; return ms === null ? [] : [{ id: cron.id, everyMs: ms }] })
  }
  toldLoop(id: string): void { this.loopsTold.add(id) }
  async setWarm(enabled: boolean): Promise<void> { this.warmAsked = true; this.warmAsking = false; await this.warm.setEnabled(enabled); this.warmEnabled = this.warm.isEnabled(); this.publish() }
  // r11-01: every conversation's switch off at once; the other sessions see it on their next
  // refresh, the same eventual hand-off the shared row always had.
  async allWarmOff(): Promise<void> { this.warmAsked = true; this.warmAsking = false; await this.warm.allOff(); this.warmEnabled = false; this.publish() }
  async syncWarm(): Promise<void> { await this.warm.syncEnabled(); this.warmEnabled = this.warm.isEnabled(); if (this.warm.asked()) this.warmAsked = true; this.publish() }
  // The first «on» asks once, with this chat's numbers; «not now» closes the question.
  askWarm(open: boolean): void { this.warmAsking = open && !this.warmEnabled; this.publish() }
  async close(): Promise<void> { this.cancelIndicator(); await this.warm.close(); await this.flushLedger() }
  private flushLedger(): Promise<void> {
    const growth = this.ledgerGrowth; this.ledgerGrowth = 0
    this.ledgerQueue = this.ledgerQueue.then(async () => {
      if (growth <= 0) return
      const id = await this.deps.sessionId(), key = 'ledger.' + id, day = c.localDay(this.deps.now())
      const ledger = object(await this.deps.store.get(key)) as CostTypes.DayLedger
      await this.deps.store.set(key, c.ledgerAdd(ledger, day, growth, day))
    }).catch(() => { this.ledgerGrowth += growth })
    return this.ledgerQueue
  }
  private async recordUsed(): Promise<void> {
    const day = c.localDay(this.deps.now()), today = dayStart(day)
    if (today === null) return
    // Day strings are calendar ordinals, so DST and the current hour cannot
    // shorten retention. Today plus the preceding 29 days is exactly 30 days.
    const cutoff = today - 29 * 86400000
    const rows: Record<string, string> = Object.create(null)
    for (const [raw, value] of Object.entries(object(await this.deps.store.get('models.used')))) {
      const id = normalizeModelId(raw), at = dayStart(value)
      if (!id || at === null || at < cutoff || at > today) continue
      if (typeof value === 'string' && (rows[id] === undefined || value > rows[id]!)) rows[id] = value
    }
    const through = this.modelItems.length
    // Session totals remain cumulative, but only newly answered models update
    // their response day. Old answers must not keep themselves alive forever.
    for (const row of this.modelItems.slice(this.modelsRecordedThrough, through)) {
      const id = normalizeModelId(row.model), at = dayStart(row.day)
      if (id && at !== null && at >= cutoff && at <= today && (rows[id] === undefined || row.day > rows[id]!)) rows[id] = row.day
    }
    await this.deps.store.set('models.used', rows)
    this.modelsRecordedThrough = through
  }
  async book(): Promise<CostSurfaceSnapshot> {
    this.features = await this.readFeatures()
    const keys = (await this.deps.store.keys()).filter(key => key.startsWith('ledger.'))
    const ledgers = await Promise.all(keys.map(async key => object(await this.deps.store.get(key)) as CostTypes.DayLedger))
    const totals = c.ledgerTotals(ledgers, c.localDay(this.deps.now()))
    const snapshot = this.snapshot()
    snapshot.ledger = { day: totals.today, week: totals.week, month: totals.month }
    if (this.features.costForecast && totals.month > 0 && snapshot.billing.kind !== 'unknown' && snapshot.billing.kind !== 'cloud' && !snapshot.billing.organisation && !snapshot.billing.otherMaker) {
      const now = new Date(this.deps.now())
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
      const dayOfMonth = now.getDate()
      if (dayOfMonth < daysInMonth) snapshot.forecast = { monthUsd: totals.month, projectedUsd: totals.month / dayOfMonth * daysInMonth }
    }
    if (this.features.costFolders) {
      // A compact mirror of cost/features.ts's folderRows (its tested source of truth): the
      // compiled runtime's value imports stay units and state, so the rows are summed here.
      const month = this.deps.now(), key = c.localDay(month)
      const rows: { name: string; day: number; month: number }[] = []
      for (const row of Object.values(object(await this.deps.store.get('cost.folders')))) {
        const name = (row as { name?: unknown }).name
        if (typeof name !== 'string') continue
        let day = 0, monthTotal = 0
        for (const [one, value] of Object.entries(object((row as { days?: unknown }).days))) {
          if (typeof value !== 'number' || !Number.isFinite(value)) continue
          if (one === key) day += value
          if (one.slice(0, 7) === key.slice(0, 7)) monthTotal += value
        }
        rows.push({ name, day, month: monthTotal })
      }
      const top = rows.filter(row => row.day > 0 || row.month > 0).sort((a, b) => b.month - a.month || b.day - a.day || a.name.localeCompare(b.name)).slice(0, 3)
      if (top.length) snapshot.folders = top
    }
    const warm = await this.warm.dayTotals()
    if (warm.any && (warm.pauses > 0 || warm.pings > 0)) snapshot.warmToday = { pauses: warm.pauses, pings: warm.pings, usd: warm.usd, saved: warm.saved }
    return snapshot
  }
  helperCosts(): Record<string, number> { return Object.fromEntries([...this.helperSums].filter(([id]) => !this.unknownHelpers.has(id))) }
  snapshot(): CostSurfaceSnapshot {
    const now = this.deps.now(), ttl = this.ttl(), prices = this.cache.model ? this.prices(this.cache.model, this.cache.prefix) : null
    // Resets retain internal TTL evidence, but an empty/new prefix has no
    // current cache lifetime to describe on the book or hover.
    const observed = this.cache.observed && this.cache.prefix > 0 && this.cache.sentAt !== null && Number.isFinite(this.cache.sentAt) && this.cache.sentAt >= 0 && this.cache.sentAt <= now
    const next = prices ? c.nextMessageCost(this.cache.prefix, prices, ttl) : undefined
    const heldOff = this.warm.disabledReason()
    const status = this.warm.status(), look = c.cacheLook(this.cache, ttl, now, { turnRunning: this.running, keptWarm: status?.state === 'armed' })
    const snapshot: CostSurfaceSnapshot = {
      billing: { kind: this.payer.kind, organisation: this.payer.orgRates, otherMaker: this.payer.otherMaker },
      model: this.cache.model ?? undefined,
      cache: { observed, shown: observed && c.indicatorShown(this.cache, prices, ttl), state: look === 'none' ? 'warm' : look,
        sentAt: this.cache.sentAt ?? 0, warmUntil: c.warmUntil(this.cache, ttl) ?? 0, ttlMs: c.TTL_MS[ttl], prefix: this.cache.prefix,
        warmUSD: next?.warm, coldUSD: next?.cold, deltaUSD: prices ? c.rereadDelta(this.cache.prefix, prices, ttl) : undefined,
        // The keeper's own first estimate (its DEFAULT_REREAD_INPUT and _OUTPUT): 30 tokens in, 150 out.
        ...(prices ? { pingUSD: (this.cache.prefix * prices.read + 30 * prices.input + 150 * prices.output) / 1e6 } : {}) },
      // Turned itself off on this computer (the return check, COST-CACHE 4.7): the switch reads off until they turn it on.
      warmEnabled: this.warmEnabled && heldOff === null,
      ...(this.warmEnabled && heldOff ? { warmHeldOff: heldOff } : {}),
      ...(this.warmAsked ? { warmAsked: true as const } : {}),
      ...(this.warmAsking ? { warmAsking: true as const } : {}),
      ...(this.warm.othersOn() > 0 ? { warmOthersOn: this.warm.othersOn() } : {}),
      ...(Object.keys(this.features).length ? { features: this.features } : {}),
      ...(this.deps.lockUnseen ? { warmNoLock: true as const } : {}),
    }
    if (status?.state === 'armed' && status.pauseStart !== null) snapshot.cache.kept = { since: status.pauseStart, pings: status.rereads, usd: status.spentUsd, stopAt: status.stopsBy ?? now }
    if (this.last.costUsd !== null) snapshot.sessionUSD = this.last.costUsd
    if (this.modelItems.length) {
      const kinds = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
      for (const item of this.modelItems) { kinds.input += item.usage.input; kinds.output += item.usage.output; kinds.cacheRead += item.usage.cacheRead; kinds.cacheWrite += item.usage.cacheWrite }
      snapshot.tokens = kinds
    }
    const estimates = this.estimatedModels(this.modelItems)
    const estimatedTotal = estimates ? [...estimates.values()].reduce((sum, usd) => sum + usd, 0) : null
    // r20-14 item 6: on a plan, this conversation at the API price table, an estimate.
    if (this.features.planConvert && this.payer.kind === 'plan' && estimatedTotal !== null && estimatedTotal > 0) snapshot.planConvertUsd = estimatedTotal
    if (this.payer.otherMaker && (this.lastMakerTurnUSD !== null || estimatedTotal !== null)) snapshot.makerEstimate = {
      ...(this.lastMakerTurnUSD === null ? {} : { turnUSD: this.lastMakerTurnUSD }),
      ...(estimatedTotal === null ? {} : { sessionUSD: estimatedTotal }),
    }
    if (this.last.costUsd === null && estimatedTotal !== null) { snapshot.sessionUSD = estimatedTotal; snapshot.sessionEstimated = true }
    if (this.lastTurn) snapshot.lastTurn = { usd: this.lastTurn.usd ?? undefined, estimated: this.lastTurn.estimated,
      window: this.lastTurn.window ? { kind: this.lastTurn.window.name, from: this.lastTurn.window.from, to: this.lastTurn.window.to } : undefined }
    const own = c.ownCallsToday(this.calls, c.localDay(now))
    if (own) snapshot.ownCalls = own
    if (this.cache.misses) snapshot.misses = { count: this.cache.misses, usd: this.cache.missUsd }
    return snapshot
  }
  private publish(): void { const snapshot = this.snapshot(); setCostSnapshot(snapshot); this.deps.changed(snapshot) }
}
