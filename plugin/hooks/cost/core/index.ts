// cc-cost — pure cost, payer, prompt-cache and number-format facts.
// No I/O, no timers, no clock: every time is a number of ms since the epoch,
// passed in by the caller.

// ---- Rule 1: pricing helpers -----------------------------------------------

export type Ttl = '5m' | '1h'

export const TTL_MS: { readonly '5m': 300000; readonly '1h': 3600000 } = { '5m': 300000, '1h': 3600000 }

export const INDICATOR_MIN_USD: 0.25 = 0.25
export const CLEAR_TIP_USD: 0.5 = 0.5

export interface Prices {
  input: number
  write5m: number
  write1h: number
  read: number
  output: number
}

export interface Usage {
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
}

function writePrice(p: Prices, ttl: Ttl): number {
  return ttl === '1h' ? p.write1h : p.write5m
}

export function priceUsage(u: Usage, p: Prices, ttl: Ttl): number {
  return (u.input * p.input + u.cacheRead * p.read + u.cacheWrite * writePrice(p, ttl) + u.output * p.output) / 1e6
}

export function rereadDelta(prefix: number, p: Prices, ttl: Ttl): number {
  return (prefix * (writePrice(p, ttl) - p.read)) / 1e6
}

export function nextMessageCost(prefix: number, p: Prices, ttl: Ttl): { warm: number; cold: number } {
  return { warm: (prefix * p.read) / 1e6, cold: (prefix * writePrice(p, ttl)) / 1e6 }
}

// ---- Rule 2: who pays --------------------------------------------------------

export type PayerKind = 'plan' | 'credits' | 'api' | 'cloud' | 'gateway' | 'unknown'

export interface WindowReading {
  usedPercent: number
  resetsAt: number
}

export interface LimitsReading {
  fiveHour?: WindowReading | null
  sevenDay?: WindowReading | null
  spendLimit?: object | null
}

export interface PayerState {
  kind: PayerKind
  orgRates: boolean
  otherMaker: boolean
  responses: number
  cloud: boolean
  gateway: boolean
  planWindows: boolean
  full: boolean
  creditsConfirmed: boolean
}

export type PayerEvent =
  | { type: 'measure'; env: Record<string, string | undefined>; limits: LimitsReading | null; policyPricing: boolean }
  | { type: 'response'; main: boolean; hasUsage: boolean; modelPriced: boolean }

function isNonNullObject(v: unknown): v is object {
  return typeof v === 'object' && v !== null
}

function envSet(env: Record<string, string | undefined> | undefined, name: string): boolean {
  const v = env?.[name]
  if (typeof v !== 'string') return false
  const t = v.trim()
  return t !== '' && t.toLowerCase() !== '0' && t.toLowerCase() !== 'false'
}

const CLOUD_ENV_VARS = [
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_MANTLE',
  'CLAUDE_CODE_USE_ANTHROPIC_AWS',
]

function decideKind(s: PayerState): PayerKind {
  if (s.cloud) return 'cloud'
  if (s.gateway) return 'gateway'
  if (s.planWindows) return s.full && s.creditsConfirmed ? 'credits' : 'plan'
  if (s.responses >= 1) return 'api'
  return 'unknown'
}

export function initialPayer(): PayerState {
  return {
    kind: 'unknown',
    orgRates: false,
    otherMaker: false,
    responses: 0,
    cloud: false,
    gateway: false,
    planWindows: false,
    full: false,
    creditsConfirmed: false,
  }
}

export function updatePayer(s: PayerState, e: PayerEvent): PayerState {
  if (e.type === 'measure') {
    const fiveHour = e.limits?.fiveHour
    const sevenDay = e.limits?.sevenDay
    const full =
      (isNonNullObject(fiveHour) && (fiveHour as WindowReading).usedPercent >= 100) ||
      (isNonNullObject(sevenDay) && (sevenDay as WindowReading).usedPercent >= 100)
    const next: PayerState = {
      ...s,
      cloud: CLOUD_ENV_VARS.some((name) => envSet(e.env, name)),
      gateway: isNonNullObject(e.limits?.spendLimit),
      planWindows: isNonNullObject(fiveHour) || isNonNullObject(sevenDay),
      full,
      creditsConfirmed: full && s.full ? s.creditsConfirmed : false,
      orgRates: e.policyPricing,
    }
    next.kind = decideKind(next)
    return next
  }
  if (e.type === 'response') {
    if (!e.main) return { ...s }
    const next: PayerState = {
      ...s,
      responses: s.responses + 1,
      otherMaker: !e.modelPriced,
      creditsConfirmed: e.hasUsage && s.full ? true : s.creditsConfirmed,
    }
    next.kind = decideKind(next)
    return next
  }
  return { ...s }
}

export function wordsVariant(kind: PayerKind): 'money' | 'plan' | 'credits' | null {
  if (kind === 'plan') return 'plan'
  if (kind === 'credits') return 'credits'
  if (kind === 'api' || kind === 'cloud' || kind === 'gateway') return 'money'
  return null
}

// ---- Rule 3: cache lifetime --------------------------------------------------

export type TtlSource = 'evidence' | 'force5m' | 'env' | 'settings' | 'enable1h' | 'payer'

function trimmedEq(v: string | undefined, expected: string): boolean {
  return typeof v === 'string' && v.trim() === expected
}

export function resolveTtl(i: {
  env: Record<string, string | undefined>
  settingsTtl?: unknown
  kind: PayerKind
  evidence?: Ttl | null
}): { ttl: Ttl; source: TtlSource } {
  if (i.evidence === '5m' || i.evidence === '1h') return { ttl: i.evidence, source: 'evidence' }
  if (trimmedEq(i.env?.FORCE_PROMPT_CACHING_5M, '1')) return { ttl: '5m', source: 'force5m' }
  const envTtl =
    typeof i.env?.CLAUDE_CODE_PROMPT_CACHE_TTL === 'string' ? i.env.CLAUDE_CODE_PROMPT_CACHE_TTL.trim() : undefined
  if (envTtl === '5m' || envTtl === '1h') return { ttl: envTtl, source: 'env' }
  if (i.settingsTtl === '5m' || i.settingsTtl === '1h') return { ttl: i.settingsTtl, source: 'settings' }
  if (trimmedEq(i.env?.ENABLE_PROMPT_CACHING_1H, '1')) return { ttl: '1h', source: 'enable1h' }
  return { ttl: i.kind === 'plan' ? '1h' : '5m', source: 'payer' }
}

// ---- Rule 4: cache state -----------------------------------------------------

export interface CacheState {
  sentAt: number | null
  prefix: number
  model: string | null
  observed: boolean
  evidence: Ttl | null
  misses: number
  missUsd: number
}

export function initialCache(): CacheState {
  return { sentAt: null, prefix: 0, model: null, observed: false, evidence: null, misses: 0, missUsd: 0 }
}

export function onMainStep(
  s: CacheState,
  step: { startedAt: number; usage: Usage; model?: string },
  ctx: { ttl: Ttl; prices: Prices | null },
): CacheState {
  const u = step.usage
  let misses = s.misses
  let missUsd = s.missUsd
  let evidence = s.evidence
  if (s.prefix > 0 && s.sentAt !== null && step.startedAt < s.sentAt + TTL_MS[ctx.ttl] && u.cacheRead < 0.5 * s.prefix) {
    misses += 1
    if (ctx.prices !== null) missUsd += (u.cacheWrite * writePrice(ctx.prices, ctx.ttl)) / 1e6
  }
  if (s.prefix > 0 && s.sentAt !== null && step.startedAt - s.sentAt > 300000 && u.cacheRead >= 0.9 * s.prefix) {
    evidence = '1h'
  }
  return {
    sentAt: step.startedAt,
    prefix: u.input + u.cacheRead + u.cacheWrite,
    model: step.model ?? s.model,
    observed: s.observed || u.cacheRead + u.cacheWrite > 0,
    evidence,
    misses,
    missUsd,
  }
}

export function onForkRead(s: CacheState, f: { startedAt: number; cacheRead: number }): CacheState {
  if (s.prefix > 0 && f.cacheRead >= 0.9 * s.prefix && (s.sentAt === null || f.startedAt > s.sentAt)) {
    return { ...s, sentAt: f.startedAt }
  }
  return { ...s }
}

export function onTtlEvidence(s: CacheState, ttl: unknown): CacheState {
  if (ttl === '5m' || ttl === '1h') return { ...s, evidence: ttl }
  return { ...s }
}

export function onReset(s: CacheState): CacheState {
  return { ...s, prefix: 0 }
}

export function warmUntil(s: CacheState, ttl: Ttl): number | null {
  if (s.sentAt === null || s.prefix === 0) return null
  return s.sentAt + TTL_MS[ttl]
}

export type CacheLook = 'none' | 'warm' | 'cooling' | 'cold' | 'kept'

export function cacheLook(
  s: CacheState,
  ttl: Ttl,
  now: number,
  o: { turnRunning: boolean; keptWarm: boolean },
): CacheLook {
  if (!s.observed || s.prefix === 0 || s.sentAt === null) return 'none'
  if (o.keptWarm) return 'kept'
  if (o.turnRunning || now < s.sentAt + (2 * TTL_MS[ttl]) / 3) return 'warm'
  if (now < s.sentAt + TTL_MS[ttl]) return 'cooling'
  return 'cold'
}

export function indicatorShown(s: CacheState, p: Prices | null, ttl: Ttl): boolean {
  return s.observed && s.prefix > 0 && p !== null && rereadDelta(s.prefix, p, ttl) >= INDICATOR_MIN_USD
}

export function indicatorTimers(s: CacheState, ttl: Ttl, shown: boolean): number[] {
  if (!shown || s.sentAt === null || s.prefix === 0) return []
  return [s.sentAt + (2 * TTL_MS[ttl]) / 3, s.sentAt + TTL_MS[ttl]]
}

export function clearTip(s: CacheState, p: Prices | null, ttl: Ttl, now: number): boolean {
  return (
    cacheLook(s, ttl, now, { turnRunning: false, keptWarm: false }) === 'cold' &&
    p !== null &&
    rereadDelta(s.prefix, p, ttl) >= CLEAR_TIP_USD
  )
}

// ---- Rule 5: one turn --------------------------------------------------------

function finiteNumber(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) ? x : null
}

function pickWindow(limits: LimitsReading | null | undefined): { name: '5h' | '7d'; reading: WindowReading } | null {
  const fiveHour = limits?.fiveHour
  if (isNonNullObject(fiveHour)) return { name: '5h', reading: fiveHour as WindowReading }
  const sevenDay = limits?.sevenDay
  if (isNonNullObject(sevenDay)) return { name: '7d', reading: sevenDay as WindowReading }
  return null
}

export interface LedgerReading {
  costUsd: number | null
  limits: LimitsReading | null
}

export interface TurnBaseline {
  c0: number | null
  window: { name: '5h' | '7d'; percent: number; resetsAt: number } | null
}

export interface TurnCost {
  usd: number | null
  estimated: boolean
  tokens: Usage
  window: { name: '5h' | '7d'; from: number; to: number } | null
}

export function turnBaseline(r: LedgerReading): TurnBaseline {
  const w = pickWindow(r.limits)
  return {
    c0: finiteNumber(r.costUsd),
    window: w === null ? null : { name: w.name, percent: w.reading.usedPercent, resetsAt: w.reading.resetsAt },
  }
}

export function turnCost(
  b: TurnBaseline,
  end: LedgerReading,
  tokens: Usage,
  est: { prices: Prices | null; ttl: Ttl },
): TurnCost {
  const c1 = finiteNumber(end.costUsd)
  let usd: number | null = null
  let estimated = false
  if (b.c0 !== null && c1 !== null) {
    if (c1 - b.c0 >= 0) usd = c1 - b.c0
  } else if (est.prices !== null) {
    usd = priceUsage(tokens, est.prices, est.ttl)
    estimated = true
  }
  const w = pickWindow(end.limits)
  let window: TurnCost['window'] = null
  if (b.window !== null && w !== null && b.window.name === w.name && b.window.resetsAt === w.reading.resetsAt) {
    window = { name: b.window.name, from: b.window.percent, to: w.reading.usedPercent }
  }
  return { usd, estimated, tokens, window }
}

// ---- Rule 7: the plugin's own calls ------------------------------------------

export function ownCallsToday(calls: { day: string; usd: number }[], today: string): { count: number; usd: number } | null {
  let count = 0
  let usd = 0
  for (const c of calls ?? []) {
    if (c.day === today) {
      count += 1
      usd += c.usd
    }
  }
  return count === 0 ? null : { count, usd }
}

// ---- Rule 9: totals per day, week, month -------------------------------------

export type DayLedger = Record<string, number>

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/

function parseDayKey(key: string): number | null {
  if (typeof key !== 'string' || !DAY_KEY.test(key)) return null
  const value = Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)))
  return new Date(value).toISOString().slice(0, 10) === key ? value : null
}

export function localDay(ms: number, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms)
  } catch {
    // JSC's format() throws for a non-finite ms where V8 says "Invalid Date";
    // rule 11 forbids throwing, so try the system zone and then give up with '—'.
    try {
      return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms)
    } catch {
      return '—'
    }
  }
}

export function ledgerAdd(ledger: DayLedger, day: string, usd: number, today: string): DayLedger {
  const staged: DayLedger = { ...ledger }
  if (typeof usd === 'number' && Number.isFinite(usd) && usd >= 0) {
    staged[day] = (staged[day] ?? 0) + usd
  }
  const todayMs = parseDayKey(today)
  const out: DayLedger = {}
  if (todayMs === null) return out
  for (const key of Object.keys(staged)) {
    const keyMs = parseDayKey(key)
    if (keyMs === null) continue
    const diff = Math.round((todayMs - keyMs) / 86400000)
    if (diff >= 0 && diff <= 61) out[key] = staged[key]!
  }
  return out
}

export function ledgerTotals(
  ledgers: DayLedger[],
  today: string,
  weekStartsOn = 1,
): { today: number; week: number; month: number } {
  const todayMs = parseDayKey(today)
  if (todayMs === null) return { today: 0, week: 0, month: 0 }
  const weekFirstOffset = (new Date(todayMs).getUTCDay() - weekStartsOn + 7) % 7
  let todaySum = 0
  let week = 0
  let month = 0
  for (const ledger of ledgers ?? []) {
    for (const key of Object.keys(ledger)) {
      const keyMs = parseDayKey(key)
      if (keyMs === null) continue
      const diff = Math.round((todayMs - keyMs) / 86400000)
      if (diff < 0) continue
      const v = ledger[key]!
      if (diff === 0) todaySum += v
      if (diff <= weekFirstOffset) week += v
      if (key.slice(0, 7) === today.slice(0, 7)) month += v
    }
  }
  return { today: todaySum, week, month }
}

// ---- Rule 10: formats ---------------------------------------------------------

function numberFormat(lang: string, opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  try {
    return new Intl.NumberFormat(lang, opts)
  } catch {
    return new Intl.NumberFormat('en', opts)
  }
}

export function formatUsd(x: number | null | undefined, lang: string, opts?: { estimate?: boolean }): string {
  if (typeof x !== 'number' || !Number.isFinite(x)) return '—'
  const two: Intl.NumberFormatOptions = {
    style: 'currency',
    currency: 'USD',
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }
  const whole: Intl.NumberFormatOptions = {
    style: 'currency',
    currency: 'USD',
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }
  let out: string
  if (x === 0) out = numberFormat(lang, two).format(0)
  else if (x > 0 && x < 0.01) out = '<' + numberFormat(lang, two).format(0.01)
  else if (x < 0 && x > -0.01) out = '>' + numberFormat(lang, two).format(-0.01)
  else if (Math.abs(x) < 100) out = numberFormat(lang, two).format(x)
  else out = numberFormat(lang, whole).format(x)
  if (opts?.estimate && out !== '—' && !out.startsWith('<') && !out.startsWith('>')) out = '~' + out
  return out
}

export function formatTokens(n: number | null | undefined, lang: string): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  return numberFormat(lang, { notation: 'compact', compactDisplay: 'short', maximumFractionDigits: 1 }).format(n)
}

export function formatPercent(p: number | null | undefined, lang: string): string {
  if (typeof p !== 'number' || !Number.isFinite(p)) return '—'
  return numberFormat(lang, { style: 'percent', maximumFractionDigits: 0 }).format(p / 100)
}

export function formatMove(from: number, to: number, lang: string): string {
  const d = to - from
  const f = Math.abs(d) < 1 ? 1 : 0
  return numberFormat(lang, {
    style: 'percent',
    signDisplay: 'always',
    minimumFractionDigits: f,
    maximumFractionDigits: f,
  }).format(d / 100)
}

export function floorToMinute(ms: number): number {
  return ms - (((ms % 60000) + 60000) % 60000)
}
