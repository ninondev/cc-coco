import { test, expect, describe } from 'bun:test'
import { formatUsd, formatTokens, formatPercent, formatMove, floorToMinute } from '../../../plugin/hooks/cost/core/index'

// CLDR separates number and currency or percent with a non-breaking space in
// some locales; normalize those so the asserts do not depend on the exact space
const norm = (s: string): string => s.replace(/[\u00a0\u202f]/g, ' ')

describe('rule 10: formatUsd in en', () => {
  test('missing and non-finite values become an em dash', () => {
    expect(formatUsd(null, 'en')).toBe('—')
    expect(formatUsd(undefined, 'en')).toBe('—')
    expect(formatUsd(NaN, 'en')).toBe('—')
    expect(formatUsd(Infinity, 'en')).toBe('—')
    expect(formatUsd(-Infinity, 'en')).toBe('—')
  })

  test('zero formats with two decimals', () => {
    expect(formatUsd(0, 'en')).toBe('$0.00')
    expect(formatUsd(-0, 'en')).toBe('$0.00')
  })

  test('a positive value under a cent is shown as less than a cent', () => {
    expect(formatUsd(0.004, 'en')).toBe('<$0.01')
    expect(formatUsd(0.0099, 'en')).toBe('<$0.01')
  })

  test('a negative value over minus a cent is shown as greater than it', () => {
    expect(formatUsd(-0.004, 'en')).toBe('>-$0.01')
  })

  test('exactly a cent is not bracketed', () => {
    expect(formatUsd(0.01, 'en')).toBe('$0.01')
    expect(formatUsd(-0.01, 'en')).toBe('-$0.01')
  })

  test('amounts under 100 keep two decimals', () => {
    expect(formatUsd(0.42, 'en')).toBe('$0.42')
    expect(formatUsd(-0.3, 'en')).toBe('-$0.30')
    expect(formatUsd(99.99, 'en')).toBe('$99.99')
  })

  test('rounding still happens inside the two decimals', () => {
    expect(formatUsd(99.999, 'en')).toBe('$100.00')
  })

  test('100 and above switch to whole dollars', () => {
    expect(formatUsd(100, 'en')).toBe('$100')
    expect(formatUsd(230.4, 'en')).toBe('$230')
    expect(formatUsd(-250, 'en')).toBe('-$250')
    expect(formatUsd(1234.6, 'en')).toBe('$1,235')
  })
})

describe('rule 10: formatUsd with estimate', () => {
  test('a tilde is prefixed with no space', () => {
    expect(formatUsd(0.42, 'en', { estimate: true })).toBe('~$0.42')
    expect(formatUsd(0, 'en', { estimate: true })).toBe('~$0.00')
    expect(formatUsd(230.4, 'en', { estimate: true })).toBe('~$230')
  })

  test('no tilde on the em dash or bracketed results', () => {
    expect(formatUsd(null, 'en', { estimate: true })).toBe('—')
    expect(formatUsd(NaN, 'en', { estimate: true })).toBe('—')
    expect(formatUsd(0.004, 'en', { estimate: true })).toBe('<$0.01')
    expect(formatUsd(-0.004, 'en', { estimate: true })).toBe('>-$0.01')
  })

  test('an options object without estimate changes nothing', () => {
    expect(formatUsd(0.42, 'en', {})).toBe('$0.42')
    expect(formatUsd(0.42, 'en', { estimate: false })).toBe('$0.42')
  })
})

describe('rule 10: formatUsd in other languages', () => {
  test('de puts the narrow dollar after the number', () => {
    expect(norm(formatUsd(0.42, 'de'))).toBe('0,42 $')
  })

  test('zh-CN and ja keep the digits recognizable', () => {
    expect(norm(formatUsd(0.42, 'zh-CN'))).toContain('0.42')
    expect(norm(formatUsd(0.42, 'ja'))).toContain('0.42')
  })

  test('the bracket forms still start with < and >', () => {
    expect(formatUsd(0.004, 'de')[0]).toBe('<')
    expect(formatUsd(-0.004, 'de')[0]).toBe('>')
  })
})

describe('rule 10: formatTokens', () => {
  test('missing and non-finite values become an em dash', () => {
    expect(formatTokens(null, 'en')).toBe('—')
    expect(formatTokens(undefined, 'en')).toBe('—')
    expect(formatTokens(NaN, 'en')).toBe('—')
    expect(formatTokens(Infinity, 'en')).toBe('—')
  })

  test('compact short with one fraction digit in en', () => {
    expect(formatTokens(128400, 'en')).toBe('128.4K')
    expect(formatTokens(0, 'en')).toBe('0')
    expect(formatTokens(999, 'en')).toBe('999')
    expect(formatTokens(1234, 'en')).toBe('1.2K')
    expect(formatTokens(1500000, 'en')).toBe('1.5M')
    expect(formatTokens(-5000, 'en')).toBe('-5K')
  })

  test('zh-CN counts in units of ten thousand', () => {
    expect(formatTokens(128400, 'zh-CN')).toBe('12.8万')
  })

  test('ja also uses the ten-thousand unit', () => {
    expect(formatTokens(128400, 'ja')).toContain('万')
  })

  test('de keeps the digits recognizable', () => {
    expect(formatTokens(128400, 'de')).toContain('128')
  })
})

describe('rule 10: formatPercent', () => {
  test('missing and non-finite values become an em dash', () => {
    expect(formatPercent(null, 'en')).toBe('—')
    expect(formatPercent(undefined, 'en')).toBe('—')
    expect(formatPercent(NaN, 'en')).toBe('—')
    expect(formatPercent(Infinity, 'en')).toBe('—')
  })

  test('whole percents without decimals in en', () => {
    expect(formatPercent(43, 'en')).toBe('43%')
    expect(formatPercent(0, 'en')).toBe('0%')
    expect(formatPercent(100, 'en')).toBe('100%')
    expect(formatPercent(150, 'en')).toBe('150%')
    expect(formatPercent(-5, 'en')).toBe('-5%')
  })

  test('fractions are rounded away', () => {
    expect(formatPercent(43.4, 'en')).toBe('43%')
  })

  test('other languages keep the number recognizable', () => {
    expect(norm(formatPercent(43, 'de'))).toContain('43')
    expect(norm(formatPercent(43, 'zh-CN'))).toContain('43')
    expect(norm(formatPercent(43, 'ja'))).toContain('43')
  })
})

describe('rule 10: formatMove', () => {
  test('a move of two points', () => {
    expect(formatMove(41, 43, 'en')).toBe('+2%')
  })

  test('a fractional move keeps one decimal', () => {
    expect(formatMove(41, 41.4, 'en')).toBe('+0.4%')
  })

  test('no move still shows a signed zero', () => {
    expect(formatMove(41, 41, 'en')).toBe('+0.0%')
  })

  test('a drop carries a minus', () => {
    expect(formatMove(43, 41, 'en')).toBe('-2%')
    expect(formatMove(10, 8.5, 'en')).toBe('-2%')
  })

  test('a move of exactly one point drops the decimal', () => {
    expect(formatMove(40, 41, 'en')).toBe('+1%')
    expect(formatMove(0, 5, 'en')).toBe('+5%')
    expect(formatMove(10, 10.5, 'en')).toBe('+0.5%')
  })

  test('other languages keep the signed number recognizable', () => {
    expect(norm(formatMove(41, 43, 'de'))).toContain('+2')
    expect(norm(formatMove(41, 43, 'ja'))).toContain('+2')
  })
})

describe('rule 10: floorToMinute', () => {
  test('rounds down inside a minute', () => {
    expect(floorToMinute(0)).toBe(0)
    expect(floorToMinute(59999)).toBe(0)
    expect(floorToMinute(60000)).toBe(60000)
    expect(floorToMinute(129400)).toBe(120000)
  })

  test('negative times floor to the earlier minute', () => {
    expect(floorToMinute(-1)).toBe(-60000)
    expect(floorToMinute(-60000)).toBe(-60000)
    expect(floorToMinute(-60001)).toBe(-120000)
  })

  test('large values', () => {
    expect(floorToMinute(123456789012)).toBe(123456780000)
  })
})
