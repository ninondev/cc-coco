// later-03 (ZCode-2): the product's own time and month formats, one table per language in the
// word source; a Latin "am" once showed inside Hindi, so Intl answers only in fixed "en".

import { costWord } from './cost/words'

export type FormatWord = (lang: string, key: string, values?: Record<string, string | number>) => string
// A caller with its own word callback (a page's o.word) passes it; either path renders the same.
const say: FormatWord = (lang, key, values) => costWord(lang, key, values)
// The table's own clock; a plain value picks the half of the day, so no placeholder is read raw.
export function productClock(at: number, lang: string, zone?: string, speak: FormatWord = say): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23', hour12: false }).formatToParts(at)
  const field = (name: string) => parts.find(part => part.type === name)?.value ?? ''
  let hour = Number(field('hour'))
  if (!Number.isFinite(hour)) return ''
  const minute = field('minute').padStart(2, '0')
  // The table picks its half of the day by a plain value, so no placeholder is ever read raw.
  if (speak(lang, 'format.clock').includes('12h')) {
    const meridiem = hour < 12 ? speak(lang, 'format.am') : speak(lang, 'format.pm')
    hour = hour % 12 === 0 ? 12 : hour % 12
    // {hh} pads, for clocks like 01:00 AM.
    return speak(lang, 'format.clock12', { h: hour, hh: String(hour).padStart(2, '0'), mm: minute, ap: meridiem })
  }
  return speak(lang, 'format.clock24', { h: String(hour % 24).padStart(2, '0'), mm: minute })
}
export type MonthStyle = 'long' | 'short'
export function productMonth(index: number, lang: string, style: MonthStyle = 'long', speak: FormatWord = say): string {
  const names = speak(lang, 'format.months.' + style).split(',')
  return names[((index % 12) + 12) % 12] ?? ''
}
/** A calendar date in the person's own order and words. */
export function productDate(at: number, lang: string, zone?: string, style: MonthStyle = 'short', speak: FormatWord = say): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(at)
  const field = (name: string) => Number(parts.find(part => part.type === name)?.value)
  const month = productMonth((field('month') || 1) - 1, lang, style, speak)
  const day = field('day'), year = field('year')
  if (!month || !Number.isFinite(day) || !Number.isFinite(year)) return ''
  return speak(lang, 'format.date', { y: year, m: month, d: day })
}
