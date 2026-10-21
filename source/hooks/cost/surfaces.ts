import { clockText, numberLocale, numberText } from '../numbers'
import { WORDS, quotaDuration } from '../words'
import type { Lang } from '../words'
import { costWord } from './words'
import type { CostSurfaceSnapshot } from '../../types'
import type { PauseSummary, StopReason } from './warm/constants'
export type { CostSurfaceSnapshot } from '../../types'

export const CUP_MIN_USD = 0.25
export function cupShown(s: CostSurfaceSnapshot | undefined): boolean {
  return !!s?.cache.observed && (s.cache.deltaUSD ?? 0) >= CUP_MIN_USD
}
export function makerSessionUSD(s: CostSurfaceSnapshot): number | undefined {
  return makerEstimated(s) ? s.makerEstimate?.sessionUSD : undefined
}
export function costDollars(value: number | undefined, lang: string, estimated = false): string {
  if (value === undefined || !Number.isFinite(value) || value < 0) return '—'
  const digits = value >= 100 ? 0 : 2
  const currency = new Intl.NumberFormat(numberLocale(lang), { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', minimumFractionDigits: digits, maximumFractionDigits: digits })
  return (estimated ? '~' : '') + (value > 0 && value < .01 ? '<' + currency.format(.01) : currency.format(value))
}
export function costTokens(value: number, lang: string): string {
  return new Intl.NumberFormat(numberLocale(lang), { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}
export function costTime(at: number, lang: string, zone?: string): string {
  return clockText(Math.floor(at / 60_000) * 60_000, lang, zone)
}
const plan = (s: CostSurfaceSnapshot) => s.billing.kind === 'plan'
// People on a plan get the form that says the dollars are at API rates.
const planForm = (s: CostSurfaceSnapshot) => plan(s) ? '.plan' : ''
// A chat answered by another maker's model (through a gateway): the session is estimated at that maker's own
// price, and the engine's own figure, which is a default-tier guess, is left out.
const makerEstimated = (s: CostSurfaceSnapshot) => !!s.billing.otherMaker && !s.billing.organisation && (s.billing.kind === 'api' || s.billing.kind === 'gateway')
const usableMoney = (s: CostSurfaceSnapshot) => s.billing.kind !== 'unknown' && s.billing.kind !== 'cloud' && !s.billing.organisation && !s.billing.otherMaker
export function cacheAlt(s: CostSurfaceSnapshot, lang: string, now: number): string {
  if (s.cache.state === 'kept' && !usableMoney(s)) return costWord(lang, 'cache.narrow.kept')
  const values = { n: numberText(s.cache.state === 'kept' ? s.cache.kept?.pings ?? 0 : Math.max(0, Math.ceil((s.cache.warmUntil - now) / 60_000)), lang), usd: costDollars(s.cache.kept?.usd, lang, true) }
  return costWord(lang, 'alt.cup.' + s.cache.state + (s.cache.state === 'kept' ? planForm(s) : ''), values)
}
export function turnCostLine(s: CostSurfaceSnapshot, lang: string, surface: 'hover' | 'book'): string {
  if (makerEstimated(s)) {
    const usd = s.makerEstimate?.turnUSD
    return usd === undefined ? '' : costWord(lang, surface === 'hover' ? 'cost.hover.turn.money' : 'offerings.lastTurn.money', { usd: costDollars(usd, lang, true) })
  }
  const turn = s.lastTurn
  if (!turn || turn.usd === undefined || !usableMoney(s)) return ''
  const form = plan(s) ? 'plan' : s.billing.kind === 'credits' ? 'credits' : 'money'
  if (form === 'plan' && !turn.window) return ''
  const window = turn.window
  const windowLabel=window?(WORDS[lang as Lang]??WORDS.en).quota.shortKinds[window.kind==='5h'?'five_hour':'seven_day']??'':''
  return costWord(lang, surface === 'hover' ? 'cost.hover.turn.' + form : 'offerings.lastTurn.' + form, {
    usd: costDollars(turn.usd, lang, turn.estimated), window: windowLabel,
    from: numberText(window?.from ?? 0, lang,false,true) + '%', to: numberText(window?.to ?? 0, lang,false,true) + '%',
  })
}
export function cacheHover(s: CostSurfaceSnapshot | undefined, lang: string, narrow: boolean, zone?: string): string[] {
  if (!s) return []
  const cache = s.cache
  let line = ''
  if (cache.observed) {
    const time = costTime(cache.state === 'kept' ? cache.kept?.since ?? cache.sentAt : cache.warmUntil, lang, zone)
    if (narrow || (cache.state === 'kept' && !usableMoney(s))) line = costWord(lang, 'cache.narrow.' + (cache.state === 'cooling' ? 'warm' : cache.state), { time })
    else if (cache.state === 'cold') {
      if (usableMoney(s)) line = costWord(lang, 'cache.hover.cold.' + (plan(s) ? 'plan' : 'money'), { time, tokens: costTokens(cache.prefix, lang), usd: costDollars(cache.coldUSD, lang, true) })
      else line = costWord(lang, 'cache.narrow.cold')
    } else line = costWord(lang, 'cache.hover.' + cache.state + (cache.state === 'kept' ? planForm(s) : ''), { time, n: numberText(cache.kept?.pings ?? 0, lang), usd: costDollars(cache.kept?.usd, lang, true) })
  }
  const turn = turnCostLine(s, lang, 'hover')
  return [line, turn, turn && makerEstimated(s) ? costWord(lang, 'prices.unknownModel') : ''].filter(Boolean)
}
export function cacheTerminal(s: CostSurfaceSnapshot | undefined, lang: string, zone?: string): string {
  if (!cupShown(s) || s!.cache.state === 'warm') return ''
  return costWord(lang, 'cache.term.' + s!.cache.state, { time: costTime(s!.cache.warmUntil, lang, zone) })
}
export type CostTextBlock = { t: 'para'; text: string } | { t: 'cup'; state: CostSurfaceSnapshot['cache']['state']; alt: string; text: string }
export function cacheBookLines(s: CostSurfaceSnapshot, lang: string, now: number, zone?: string): CostTextBlock[] {
  const c = s.cache
  if (!c.observed) return [{ t: 'para', text: costWord(lang, 'offerings.cacheNone') }]
  const n = numberText(Math.max(0, Math.ceil((c.warmUntil - now) / 60_000)), lang)
  const state = c.state === 'kept' && !usableMoney(s) ? 'warm' : c.state
  const key = 'offerings.cache' + ({ warm: 'Warm', cooling: 'Cooling', cold: 'Cold', kept: 'Kept' } as const)[state] + (state === 'kept' ? planForm(s) : '')
  const line = costWord(lang, key, { time: costTime(state === 'kept' ? c.kept?.since ?? c.sentAt : c.warmUntil, lang, zone), n: state === 'kept' ? numberText(c.kept?.pings ?? 0, lang) : n, usd: costDollars(c.kept?.usd, lang, true), stop: costTime(c.kept?.stopAt ?? c.warmUntil, lang, zone) })
  const blocks: CostTextBlock[] = [{ t: 'cup', state: c.state, alt: cacheAlt(s, lang, now), text: line }]
  if (usableMoney(s)) blocks.push({ t: 'para', text: costWord(lang, 'offerings.' + (c.state === 'cold' ? 'nextCold.' : 'next.') + (plan(s) ? 'plan' : 'money'), { tokens: costTokens(c.prefix, lang), warm: costDollars(c.warmUSD, lang, true), cold: costDollars(c.coldUSD, lang, true) }) })
  if (c.state === 'cold' && (c.deltaUSD ?? 0) >= .5) blocks.push({ t: 'para', text: costWord(lang, 'offerings.clearTip') })
  return blocks.filter(b => b.text)
}
// `noted`: the page already put the no-price note beside the session estimate, so the turn estimate does not repeat it.
export function costBookLines(s: CostSurfaceSnapshot, lang: string, noted = false): string[] {
  const lines = [turnCostLine(s, lang, 'book')]
  if (makerEstimated(s) && lines[0] && !noted) lines.push(costWord(lang, 'prices.unknownModel'))
  if (usableMoney(s)) {
    if ((s.ownCalls?.count ?? 0) > 0) lines.push(costWord(lang, 'offerings.ownCalls' + planForm(s), { n: numberText(s.ownCalls!.count, lang), usd: costDollars(s.ownCalls!.usd, lang, true) }))
    if ((s.misses?.count ?? 0) > 0) lines.push(costWord(lang, 'offerings.misses' + planForm(s), { n: numberText(s.misses!.count, lang), usd: costDollars(s.misses!.usd, lang, true) }))
  }
  if (s.ledger && usableMoney(s)) lines.push(costWord(lang, 'offerings.ledger.' + (plan(s) ? 'plan' : 'money'), { d: costDollars(s.ledger.day, lang), w: costDollars(s.ledger.week, lang), m: costDollars(s.ledger.month, lang) }))
  return lines.filter(Boolean)
}

// The keeper's finer stop codes fold into six sentences; the silent ones (off, turn, reset) say nothing.
export type WarmReasonKey = 'warm.reason.locked' | 'warm.reason.cap' | 'warm.reason.budget' | 'warm.reason.error' | 'warm.reason.other' | 'warm.reason.window'
const WARM_REASON_KEYS: Partial<Record<StopReason | 'notHeld', WarmReasonKey>> = {
  locked: 'warm.reason.locked', slept: 'warm.reason.locked',
  cap: 'warm.reason.cap',
  budget: 'warm.reason.budget',
  other: 'warm.reason.other',
  window: 'warm.reason.window',
  gone: 'warm.reason.error', error: 'warm.reason.error', costly: 'warm.reason.error', unsupported: 'warm.reason.error', notHeld: 'warm.reason.error',
}
export function warmReasonKey(reason: StopReason | 'notHeld' | null | undefined): WarmReasonKey | null {
  return (reason && WARM_REASON_KEYS[reason]) || null
}

// Keeping the cache warm, before, during and after (COST-CACHE 4.2 and 4.7). Before: the one-time question with this
// chat's numbers (how often, about how much each re-read, one full re-read); where the dollars are not the person's own
// (a plan, an organisation, another maker), the share of one full re-read. Before the chat has a reading there is no
// number to give, so nothing: the question shows the switch's own two lines.
export function warmAskLine(s: CostSurfaceSnapshot, lang: string): string {
  const c = s.cache
  if (!c.observed || c.pingUSD === undefined || !c.coldUSD) return ''
  // The sentence says «about» itself, so the dollars carry no estimate mark.
  if (usableMoney(s) && !plan(s))
    return costWord(lang, 'more.warm.ask', { interval: quotaDuration(lang as Lang, c.ttlMs - rereadEarlyMs(c.ttlMs)), ping: costDollars(c.pingUSD, lang), rewrite: costDollars(c.coldUSD, lang) })
  return costWord(lang, 'more.warm.askRatio', { r: numberText(Math.max(1, Math.round(c.pingUSD / c.coldUSD * 100)), lang) })
}
// The keeper re-reads this long before the cache would cool (its MARGIN_MS; the cost-native warm test holds them equal).
export const rereadEarlyMs = (ttlMs: number): number => ttlMs > 300_000 ? 240_000 : 60_000
// During, under the switch: today's pauses kept warm, the re-reads, their price and what they saved. A day that saved
// nothing says nothing saved, never a minus.
export function warmTodayLine(s: CostSurfaceSnapshot, lang: string): string {
  const t = s.warmToday
  if (!t || !usableMoney(s)) return ''
  return costWord(lang, 'more.warm.today', { n: numberText(t.pauses, lang), p: numberText(t.pings, lang), usd: costDollars(t.usd, lang, true), saved: costDollars(Math.max(0, t.saved), lang, true) })
}
// Turned itself off (a return found the cache not held): the row says why.
export function warmHeldOffLine(s: CostSurfaceSnapshot, lang: string): string {
  return s.warmHeldOff ? costWord(lang, 'warm.heldOff') : ''
}
// After: the one line when you come back from a pause it kept warm. Still warm, what it cost; cooled, when and why it
// stopped. A stop you made (off, your own turn, a reset) says nothing.
export function warmReturnLine(p: PauseSummary, s: CostSurfaceSnapshot | undefined, lang: string, zone?: string): string {
  if (!p.announce) return ''
  if (p.end < p.warmUntil) return p.rereads > 0 && s && usableMoney(s) ? costWord(lang, 'line.warm.back', { duration: quotaDuration(lang as Lang, p.end - p.start), n: numberText(p.rereads, lang), usd: costDollars(p.spentUsd, lang, true) }) : ''
  const reason = warmReasonKey(p.reason)
  return reason ? costWord(lang, 'line.warm.stopped', { time: costTime(p.stoppedAt ?? p.warmUntil, lang, zone), reason: costWord(lang, reason) }) : ''
}

// Cold moments named before they cost (COST-CACHE 3.8), each a note once, and only when one full re-read is worth a
// mention ($0.25 or more). A resumed or forked chat whose cache has lapsed: the engine's own estimate at its start.
export function resumeColdLine(s: CostSurfaceSnapshot | undefined, start: { expired?: unknown; tokens?: unknown; usd?: unknown }, lang: string): string {
  const { expired, tokens, usd } = start
  if (!s || expired !== true || typeof tokens !== 'number' || !(tokens > 0) || typeof usd !== 'number' || !(usd >= CUP_MIN_USD) || !usableMoney(s)) return ''
  return costWord(lang, 'line.resumeCold.' + (plan(s) ? 'plan' : 'money'), { tokens: costTokens(tokens, lang), usd: costDollars(usd, lang, true) })
}
// A recurring /loop whose runs come after the cache has cooled re-reads the whole chat at full price on every run.
export function loopColdLine(s: CostSurfaceSnapshot | undefined, everyMs: number, lang: string): string {
  if (!s || !s.cache.observed || !(everyMs > s.cache.ttlMs) || s.cache.coldUSD === undefined || (s.cache.deltaUSD ?? 0) < CUP_MIN_USD || !usableMoney(s)) return ''
  return costWord(lang, 'line.loopCold.' + (plan(s) ? 'plan' : 'money'), { interval: quotaDuration(lang as Lang, everyMs), usd: costDollars(s.cache.coldUSD, lang, true) })
}

export function voiceCacheCost(s: CostSurfaceSnapshot | undefined, lang: string): string {
  if(!s||!s.cache.observed||s.cache.state==='cold'||(s.cache.deltaUSD??0)<CUP_MIN_USD||!usableMoney(s))return ''
  return costWord(lang,'settings.voice.cacheCost.'+(plan(s)?'plan':'money'),{usd:costDollars(s.cache.coldUSD,lang,true)})
}
