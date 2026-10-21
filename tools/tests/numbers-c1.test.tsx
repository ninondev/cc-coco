import { describe, expect, test } from 'claude-code/testing'
import { WORDS, LANGS } from '../hooks/words'
import { cacheText, contextAlt, contextText, contextTokens, costText, compactTokenText, durationText, momentText, numberLocale, numberPolicy, numberText, percentText, tokenText } from '../hooks/numbers'
import type { NumberPlace, NumberWords } from '../hooks/numbers'
import { ESTIMATE_WORDS } from '../hooks/numbers-text'
import { pageBlocks } from '../hooks/book'
import type { BookData } from '../hooks/book'
import type { BookWords } from '../hooks/book-words'
import { BOOK_FILES } from './book-files'
import { C1_NUMBER_WORDS } from './c1-number-words'

export function numberWords(lang: keyof typeof C1_NUMBER_WORDS.durations): NumberWords {
  const book = JSON.parse(BOOK_FILES[`${lang}.json`]!)
  return { ...book, alt: WORDS[lang].alt }
}

describe('0.2 9.1 every number-table cell', () => {
  test('Chinese script locales preserve Singapore and use Taiwan for Traditional', () => {
    expect(numberLocale('zh')).toBe('zh-SG')
    expect(numberLocale('zh-Hant')).toBe('zh-TW')
    const date = Date.parse('2026-10-04T12:00:00Z'), now = Date.parse('2026-10-05T12:00:00Z')
    const options = { month: 'short' as const, day: 'numeric' as const, timeZone: 'UTC' }
    const time = new Intl.DateTimeFormat('zh-TW', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(date)
    expect(momentText(date, now, 'zh-Hant', 'UTC')).toBe(new Intl.DateTimeFormat('zh-TW', options).format(date) + time)
    expect(compactTokenText(20000, 'zh-Hant')).toBe(new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 1 }).format(2) + '萬')
    expect(compactTokenText(20000, 'zh')).toBe('2万')
  })
  const unknown: Record<NumberPlace, string | null> = { band: '—', terminal: '▤ —', hover: null, incense: null,
    context: 'No reading yet.', session: '—', window: 'No limit readings yet.', line: null, neighbour: null, dated: null }
  const zero: Record<NumberPlace, string | null> = { band: '0%', terminal: '▤ 0%', hover: '0%', incense: '0%',
    context: '0% full', session: '0%', window: '0% used', line: null, neighbour: '0%', dated: null }
  const estimated: Record<NumberPlace, string | null> = { band: '~23%', terminal: '▤ ~23%', hover: '~23%', incense: '~23%',
    context: '~23% full', session: '~23%', window: '~23% used', line: '~23s', neighbour: '~23%', dated: null }
  for (const place of Object.keys(unknown) as NumberPlace[]) {
    for (const [state, value, estimate, expected] of [
      ['unknown', null, false, unknown[place]], ['zero', 0, false, zero[place]], ['estimate', 23, true, estimated[place]],
    ] as const) test(`${place}: ${state}`, () => {
      const policy = numberPolicy(place, value, 'en', numberWords('en'), estimate)
      expect(policy.text).toBe(expected)
      expect(policy.box).toBe(['band', 'terminal', 'context'].includes(place))
      expect(policy.stick).toBe(value !== null && ['incense', 'neighbour'].includes(place))
      expect(policy.lantern).toBe(place === 'neighbour' && value !== null)
      expect(policy.canSay).toBe(place === 'line' && value !== null && value >= 1)
    })
  }

  test('unknown is a unitless dash; zero is a known reading; negative/nonfinite is unknown', () => {
    for (const value of [null, undefined, NaN, Infinity, -1]) {
      expect(numberText(value, 'en', true)).toBe('—')
      expect(percentText(value, 'en', true)).toBe('—')
      expect(costText(value, 'en', true)).toBe('—')
      expect(tokenText(value, 'en', true)).toBe('—')
      expect(durationText(value, 'en', numberWords('en').durations, true)).toBe('—')
    }
    expect(costText(0, 'en')).toBe('$0.00')
    expect(tokenText(0, 'en')).toBe('0')
    expect(durationText(0, 'en', numberWords('en').durations)).toBe('0s')
    expect(numberPolicy('line', 0.999, 'en', numberWords('en')).canSay).toBe(false)
    expect(numberPolicy('incense', 0, 'en', numberWords('en')).stick).toBe(true)
  })

  for (const { code } of LANGS) test(`${code}: Intl, approved duration examples and spoken estimate words`, () => {
    const words = numberWords(code), samples = [58, 130, 720, 3720, 183600]
    for (let i = 0; i < samples.length; i++) {
      expect(durationText(samples[i], code, words.durations)).toBe(C1_NUMBER_WORDS.durations[code][i])
      expect(durationText(samples[i], code, words.durations, true)).toBe(`~${C1_NUMBER_WORDS.durations[code][i]}`)
    }
    const intl = new Intl.NumberFormat(numberLocale(code), { maximumFractionDigits: 0 })
    expect(tokenText(22161, code, true)).toBe(`~${intl.format(22161)}`)
    expect(percentText(23.2, code, true)).toBe(`~${intl.format(23)}%`)
    expect(costText(0, code)).toBe(new Intl.NumberFormat(numberLocale(code), { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(0))
    expect(contextText(11, code, words, true)).toBe(C1_NUMBER_WORDS['offerings.fullAbout'][code].replace('{percent}', `~${intl.format(11)}%`))
    expect(contextTokens(22161, 200000, code, words, true)).toBe(C1_NUMBER_WORDS['offerings.tokensAbout'][code].replace('{used}', `~${intl.format(22161)}`).replace('{max}', intl.format(200000)))
    expect(contextAlt(23, code, words, true)).toBe(WORDS[code].alt.boxAbout.replace('{percent}', intl.format(23)))
    expect(contextAlt(null, code, words, true)).toBe(words.offerings.noReading)
    expect(contextAlt(23, code, words, true).includes('~')).toBe(false)
    expect(cacheText(null, code, words)).toBe('—')
    expect(cacheText(0, code, words)).toBe(words.offerings.cache.replace('{p}', intl.format(0)))
    expect(contextTokens(null, 0, code, words, true)).toBe(words.offerings.noReading)
  })

  // C2 migrates the consumers and approved templates together; spoken alts keep words.
  for (const { code } of LANGS) test(`${code}: book consumes approved estimate templates and keeps spoken estimates in words`, () => {
    const words = JSON.parse(BOOK_FILES[`${code}.json`]!) as BookWords
    expect(words.offerings.fullAbout).toBe(C1_NUMBER_WORDS['offerings.fullAbout'][code])
    expect(words.offerings.tokensAbout).toBe(C1_NUMBER_WORDS['offerings.tokensAbout'][code])
    expect(ESTIMATE_WORDS[code]).toEqual({
      fullAbout: C1_NUMBER_WORDS['offerings.fullAbout'][code],
      tokensAbout: C1_NUMBER_WORDS['offerings.tokensAbout'][code],
    })
    const data: BookData = {
      view: {
        mood: 'idle', frame: 'idle-reading', said: null, slip: null, context: 23, estimate: true,
        verb: '', band: 'on', voice: 'off', affection: 'warm', lang: code, pictures: 'cells', colors: 'truecolor', cue: '',
      },
      usage: { startedAt: 0, context: { percent: 23, window: 200, tokens: 99, breakdown: { totalTokens: 123 } }, rateLimits: [] },
      store: {}, now: 0, timeZone: 'UTC', reducedMotion: false, marks: 'replies',
      voiceSizes: { light: 0, full: 0 }, fortune: undefined, reading: 0, own: WORDS[code],
    }
    for (const surface of ['desktop', 'terminal', 'vscode', 'mobile'] as const) {
      const blocks = pageBlocks('offerings', words, data, surface)
      const box = blocks.find(block => block.t === 'box')
      const meter = blocks.find(block => block.t === 'meter')
      expect(box?.t === 'box' ? box.title : null).toBe(C1_NUMBER_WORDS['offerings.fullAbout'][code].replace('{percent}', '~23%'))
      expect(box?.t === 'box' ? box.detail : null).toBe(C1_NUMBER_WORDS['offerings.tokensAbout'][code].replace('{used}', '~123').replace('{max}', '200'))
      expect(meter?.t === 'meter' ? meter.alt : null).toBe(WORDS[code].alt.boxAbout.replace('{percent}', '23'))
      expect(box?.t === 'box' ? box.alt : null).toBe(WORDS[code].alt.boxAbout.replace('{percent}', '23'))
      expect(C1_NUMBER_WORDS['offerings.fullAbout'][code].replace('{percent}', '~23%').includes('~')).toBe(true)
      expect(C1_NUMBER_WORDS['offerings.tokensAbout'][code].replace('{used}', '~123').replace('{max}', '200').includes('~')).toBe(true)
      expect(C1_NUMBER_WORDS['offerings.fullAbout'][code].replace('{percent}', '~23%')).not.toBe(words.offerings.full.replace('{percent}', '23'))
      expect(C1_NUMBER_WORDS['offerings.tokensAbout'][code].replace('{used}', '~123').replace('{max}', '200')).not.toBe(words.offerings.tokens.replace('{tokens}', '123').replace('{window}', '200'))
    }
    const standaloneFull = contextText(23, code, numberWords(code), true)
    const standaloneTokens = contextTokens(123, 200, code, numberWords(code), true)
    expect(standaloneFull).toBe(C1_NUMBER_WORDS['offerings.fullAbout'][code].replace('{percent}', '~23%'))
    expect(standaloneTokens).toBe(C1_NUMBER_WORDS['offerings.tokensAbout'][code].replace('{used}', '~123').replace('{max}', '200'))
    expect(standaloneFull.split('~').length - 1).toBe(1)
    expect(standaloneTokens.split('~').length - 1).toBe(1)
  })

  // BAND F14 (owner 10-09): a zero trailing unit is not written, so a whole minute, hour or day stands alone.
  test('duration edges drop seconds at exactly ten minutes; hours and days retain two units unless the second is zero', () => {
    const words = numberWords('en')
    for (const [seconds, expected] of [[59, '59s'], [60, '1m'], [61, '1m 1s'], [599, '9m 59s'], [600, '10m'], [659, '10m'], [3599, '59m'], [3600, '1h'], [3660, '1h 1m'], [86399, '23h 59m'], [86400, '1d'], [90000, '1d 1h']] as const)
      expect(durationText(seconds, 'en', words.durations)).toBe(expected)
    expect(durationText(3900, 'en', words.durations, true)).toBe('~1h 5m')
  })

  test('times use the book moment rule, known dates, and one touching estimate mark', () => {
    const now = Date.parse('2026-10-05T12:00:00Z'), future = Date.parse('2026-10-05T17:25:00Z')
    for (const { code } of LANGS) {
      expect(momentText(future, now, code, 'UTC', true)).toBe(`~${new Intl.DateTimeFormat(numberLocale(code), { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(future)}`)
      expect(momentText(null, now, code, 'UTC', true)).toBe('—')
      expect(momentText('invalid', now, code, 'UTC')).toBe('—')
      expect(momentText('2025-10-04T12:00:00Z', now, code, 'UTC').includes('2025')).toBe(true)
    }
  })
})
