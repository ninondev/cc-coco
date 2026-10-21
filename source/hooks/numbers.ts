// SPEC 0.6 / 9.1. Pure formatting and visibility; callers own the event readings.
import { ESTIMATE_WORDS } from './numbers-text'
import { TEN_THOUSAND } from './chinese-number-data'
export const UNKNOWN_NUMBER = '—'
export type NumberReading = number | null | undefined
export type NumberWords = {
  offerings: {
    full: string; fullAbout: string; tokens: string; tokensAbout: string
    noReading: string; noLimits: string; used: string; cache: string
  }
  alt: { box: string; boxAbout: string }
  durations: readonly string[]
}

export function numberLocale(lang: string): string { return lang === 'zh' ? 'zh-SG' : lang === 'zh-Hant' ? 'zh-TW' : lang }
export function hasNumber(value: NumberReading): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}
const fill = (template: string, values: Record<string, string>) => template.replace(/\{(\w+)\}/g, (hole, key: string) => values[key] ?? hole)
const mark = (value: string, estimate: boolean) => estimate && value !== UNKNOWN_NUMBER ? `~${value}` : value
const CHINESE_TEN_THOUSAND = '万'

export function numberText(value: NumberReading, lang: string, estimate = false, whole = false): string {
  if (!hasNumber(value)) return UNKNOWN_NUMBER
  return mark(new Intl.NumberFormat(numberLocale(lang), { maximumFractionDigits: whole ? 0 : 1 }).format(value), estimate)
}
export function percentText(value: NumberReading, lang: string, estimate = false, whole = true): string {
  return hasNumber(value) ? `${numberText(value, lang, estimate, whole)}%` : UNKNOWN_NUMBER
}
export function tokenText(value: NumberReading, lang: string, estimate = false): string {
  return numberText(value, lang, estimate, true)
}
export function compactTokenText(value: NumberReading, lang: string): string {
  if (!hasNumber(value)) return tokenText(value, lang)
  const n = Math.round(value)
  if ((lang === 'zh' || lang === 'zh-Hant' || lang === 'ja') && n >= 10_000) return `${numberText(n / 10_000, lang)}${lang === 'zh-Hant' ? TEN_THOUSAND : CHINESE_TEN_THOUSAND}`
  if (lang !== 'zh' && lang !== 'zh-Hant' && lang !== 'ja' && n >= 10_000) return `${numberText(n / 1000, lang)}k`
  return tokenText(n, lang)
}
export function costText(value: NumberReading, lang: string, estimate = false): string {
  if (!hasNumber(value)) return UNKNOWN_NUMBER
  return mark(new Intl.NumberFormat(numberLocale(lang), { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value), estimate)
}

// The approved words carry five examples, which supply the exact localized unit suffixes
// and separators. Deriving the templates preserves the checked translation bytes.
export function durationText(seconds: NumberReading, lang: string, examples: readonly string[], estimate = false): string {
  if (!hasNumber(seconds)) return UNKNOWN_NUMBER
  if (examples.length !== 5) throw new Error('five duration examples required')
  const s = Math.floor(seconds), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24)
  const index = s < 60 ? 0 : m < 10 ? 1 : h < 1 ? 2 : d < 1 ? 3 : 4
  const values = index === 0 ? [s] : index === 1 ? [m, s % 60] : index === 2 ? [m] : index === 3 ? [h, m % 60] : [d, h % 24]
  // A zero trailing unit is dropped: 2 minutes, not 2 minutes 0 seconds (BAND F14). The unit's own text is cut from the
  // example, so every language keeps its words: what stands before the second number, minus the space it leaves.
  const whole = index === 1 || index === 3 || index === 4 ? values[1] === 0 : false
  const template = !whole ? examples[index]! : index === 1 ? examples[2]! : examples[index]!.slice(0, examples[index]!.search(/\d+(?!.*\d)/)).trimEnd()
  if (whole) values.length = 1
  let next = 0
  const text = template.replace(/\d+/g, () => numberText(values[next++], lang, false, true))
  return mark(text, estimate)
}

function timeText(ms: number, lang: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(numberLocale(lang), { hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(ms))
}
function dateText(ms: number, lang: string, timeZone?: string, year = false): string {
  return new Intl.DateTimeFormat(numberLocale(lang), { month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}), timeZone }).format(new Date(ms))
}
export function clockText(value: NumberReading, lang: string, timeZone?: string): string {
  if (!hasNumber(value) || value > 8.64e15) return UNKNOWN_NUMBER
  try { return timeText(value, lang, timeZone) }
  catch { return new Date(value).toISOString().slice(11, 16) }
}
export function calendarText(value: NumberReading, lang: string, timeZone?: string, year = false): string {
  if (!hasNumber(value) || value > 8.64e15) return UNKNOWN_NUMBER
  try { return dateText(value, lang, timeZone, year) }
  catch { return new Date(value).toISOString().slice(0, 10) }
}
// The book's existing moment rule: today is time only, other days carry their date;
// other years also carry the year. Null and invalid dates have no unit or estimate mark.
export function momentText(value: NumberReading | string, now: number, lang: string, timeZone?: string, estimate = false): string {
  const ms = typeof value === 'string' ? Date.parse(value) : value
  if (!hasNumber(ms) || ms > 8.64e15) return UNKNOWN_NUMBER
  try {
    const today = dateText(ms, lang, timeZone, true) === dateText(now, lang, timeZone, true)
    const year = new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone })
    const text = today ? timeText(ms, lang, timeZone) : `${dateText(ms, lang, timeZone, year.format(ms) !== year.format(now))}${lang === 'zh' || lang === 'zh-Hant' || lang === 'ja' ? '' : ' '}${timeText(ms, lang, timeZone)}`
    return mark(text, estimate)
  } catch { return mark(new Date(ms).toISOString().slice(11, 16), estimate) }
}

export function contextAlt(value: NumberReading, lang: string, words: Pick<NumberWords, 'alt'> & { offerings: Pick<NumberWords['offerings'], 'noReading'> }, estimate = false): string {
  if (!hasNumber(value)) return words.offerings.noReading
  return fill(estimate ? words.alt.boxAbout : words.alt.box, { percent: numberText(value, lang, false, true) })
}
export function contextText(value: NumberReading, lang: string, words: NumberWords, estimate = false): string {
  if (!hasNumber(value)) return words.offerings.noReading
  // Existing exact/full words carry %, changed fullAbout carries the complete formatted
  // percentage. Neither the caller nor the words insert a second estimate marker.
  const own = ESTIMATE_WORDS[lang] ?? ESTIMATE_WORDS.en!
  return fill(estimate ? own.fullAbout : words.offerings.full, {
    percent: estimate ? percentText(value, lang, true, false) : numberText(value, lang, false),
  })
}
export function contextTokens(used: NumberReading, max: NumberReading, lang: string, words: NumberWords, estimate = false): string {
  if (!hasNumber(used) || !hasNumber(max)) return words.offerings.noReading
  const own = ESTIMATE_WORDS[lang] ?? ESTIMATE_WORDS.en!
  return fill(estimate ? own.tokensAbout : words.offerings.tokens, {
    used: tokenText(used, lang, estimate), max: tokenText(max, lang),
    tokens: tokenText(used, lang, estimate), window: tokenText(max, lang),
  })
}
export function cacheText(value: NumberReading, lang: string, words: NumberWords): string {
  return hasNumber(value) ? fill(words.offerings.cache, { p: numberText(value, lang, false, true) }) : UNKNOWN_NUMBER
}

export type NumberPlace = 'band' | 'terminal' | 'hover' | 'incense' | 'context' | 'session' | 'window' | 'line' | 'neighbour' | 'dated'
export type NumberPolicy = { text: string | null; box: boolean; stick: boolean; lantern: boolean; canSay: boolean }
// Each row of 9.1 has one policy. Hover/window values omit missing windows, while their
// separately formatted costs/start/cache still show —. A zero incense is a full stick.
export function numberPolicy(place: NumberPlace, value: NumberReading, lang: string, words: NumberWords, estimate = false): NumberPolicy {
  const known = hasNumber(value), p = percentText(value, lang, estimate)
  const text = place === 'terminal' ? `▤ ${p}` : place === 'context' ? contextText(value, lang, words, estimate)
    : place === 'window' ? known ? fill(words.offerings.used, { percent: numberText(value, lang, estimate, false) }) : words.offerings.noLimits
    : place === 'hover' || place === 'incense' || place === 'neighbour' ? known ? p : null
    : place === 'line' ? known && value >= 1 ? durationText(value, lang, words.durations, estimate) : null
    : place === 'dated' ? null : p
  return { text, box: place === 'band' || place === 'terminal' || place === 'context',
    stick: known && (place === 'incense' || place === 'neighbour'), lantern: known && place === 'neighbour',
    canSay: place === 'line' && known && value >= 1 }
}
