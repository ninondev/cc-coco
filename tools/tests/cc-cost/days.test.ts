import { test, expect, describe } from 'bun:test'
import { localDay, ledgerAdd, ledgerTotals } from '../../../plugin/hooks/cost/core/index'

describe('rule 9: localDay', () => {
  test('the epoch is already the first of the month in Tokyo', () => {
    expect(localDay(0, 'Asia/Tokyo')).toBe('1970-01-01')
  })

  test("20:00 UTC on 2026-10-06 is the next day in Tokyo", () => {
    expect(localDay(Date.UTC(2026, 9, 6, 20), 'Asia/Tokyo')).toBe('2026-10-07')
  })

  test('the same instant stays on the day in UTC', () => {
    expect(localDay(Date.UTC(2026, 9, 6, 20), 'UTC')).toBe('2026-10-06')
  })

  test('and moves back a day in New York', () => {
    expect(localDay(Date.UTC(2026, 9, 6, 2), 'America/New_York')).toBe('2026-10-05')
  })

  test('without a time zone the system zone is used and the shape holds', () => {
    expect(localDay(Date.UTC(2026, 9, 6, 12))).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  test('Pacific/Auckland sees 2026-10-07 while Honolulu trails 23 hours behind', () => {
    // Auckland is UTC+13 (NZDT) and Honolulu UTC-10 in October 2026, so their
    // dates can differ by at most one day, never two
    const ms = Date.UTC(2026, 9, 6, 12)
    expect(localDay(ms, 'Pacific/Auckland')).toBe('2026-10-07')
    expect(localDay(ms, 'Pacific/Honolulu')).toBe('2026-10-06')
    // before 10:00 UTC the same day Honolulu still sees 2026-10-05
    expect(localDay(Date.UTC(2026, 9, 6, 9), 'Pacific/Honolulu')).toBe('2026-10-05')
  })
})

describe('rule 9: ledgerAdd', () => {
  const today = '2026-10-06'

  test('adds a value under its day', () => {
    expect(ledgerAdd({}, today, 1.25, today)).toEqual({ '2026-10-06': 1.25 })
  })

  test('accumulates onto what is already there', () => {
    expect(ledgerAdd({ '2026-10-06': 1 }, today, 0.5, today)).toEqual({ '2026-10-06': 1.5 })
  })

  test('keeps the day 61 days back', () => {
    expect(ledgerAdd({ '2026-08-06': 5 }, today, 2, today)).toEqual({ '2026-08-06': 5, '2026-10-06': 2 })
  })

  test('drops the day 62 days back', () => {
    expect(ledgerAdd({ '2026-08-05': 5 }, today, 2, today)).toEqual({ '2026-10-06': 2 })
  })

  test('drops days after today', () => {
    expect(ledgerAdd({ '2026-10-07': 5, '2026-12-01': 6 }, today, 2, today)).toEqual({ '2026-10-06': 2 })
  })

  test('drops keys that are not plain YYYY-MM-DD', () => {
    expect(ledgerAdd({ '2026-10-6': 5, '2026-1-06': 5, 'garbage': 5, '20261006': 5 }, today, 2, today)).toEqual({ '2026-10-06': 2 })
  })

  test('the added day itself is pruned when out of range or invalid', () => {
    expect(ledgerAdd({}, '2026-08-05', 5, today)).toEqual({})
    expect(ledgerAdd({}, '2026-10-07', 5, today)).toEqual({})
    expect(ledgerAdd({}, 'not-a-day', 5, today)).toEqual({})
  })

  test('a negative or non-finite usd adds nothing but pruning still runs', () => {
    for (const bad of [-5, -0.01, NaN, Infinity, -Infinity]) {
      expect(ledgerAdd({ '2026-08-05': 1, '2026-10-06': 2 }, today, bad, today)).toEqual({ '2026-10-06': 2 })
    }
  })

  test('a zero usd keeps the day at its value', () => {
    expect(ledgerAdd({ '2026-10-06': 2 }, today, 0, today)).toEqual({ '2026-10-06': 2 })
    expect(ledgerAdd({}, today, 0, today)).toEqual({ '2026-10-06': 0 })
  })

  test('never mutates the input ledger', () => {
    const ledger = { '2026-10-06': 1, '2026-01-01': 2 }
    ledgerAdd(ledger, today, 3, today)
    expect(ledger).toEqual({ '2026-10-06': 1, '2026-01-01': 2 })
  })

  test('the full 62-day window survives', () => {
    const ledger: Record<string, number> = {}
    for (let i = 0; i <= 61; i++) {
      ledger[localDay(Date.UTC(2026, 9, 6 - i), 'UTC')] = 1
    }
    const out = ledgerAdd(ledger, today, 0, today)
    expect(Object.keys(out).length).toBe(62)
  })
})

describe('rule 9: ledgerTotals', () => {
  // 2026-10-06 is a Tuesday
  const ledger = {
    '2026-10-06': 2,
    '2026-10-05': 1,
    '2026-10-04': 4,
    '2026-10-03': 8,
    '2026-09-06': 16,
    '2026-09-05': 32,
    '2026-11-06': 64,
    'bogus': 128,
    '2026-10-6': 256,
  }

  test('today is the value at today', () => {
    expect(ledgerTotals([ledger], '2026-10-06').today).toBe(2)
  })

  test('the week runs Monday to today by default', () => {
    expect(ledgerTotals([ledger], '2026-10-06').week).toBe(3)
  })

  test('a Sunday week start takes in the Sunday too', () => {
    expect(ledgerTotals([ledger], '2026-10-06', 0).week).toBe(7)
  })

  test('the month holds every day of October up to today', () => {
    expect(ledgerTotals([ledger], '2026-10-06').month).toBe(15)
  })

  test('a week crossing a month boundary', () => {
    // 2026-10-01 is a Thursday; the Monday-start week begins 2026-09-28,
    // the Sunday-start week begins 2026-09-27
    const crossMonth = { '2026-09-27': 8, '2026-09-28': 1, '2026-09-30': 2, '2026-10-01': 4 }
    expect(ledgerTotals([crossMonth], '2026-10-01')).toEqual({ today: 4, week: 7, month: 4 })
    expect(ledgerTotals([crossMonth], '2026-10-01', 0)).toEqual({ today: 4, week: 15, month: 4 })
  })

  test('a Sunday today with a Monday week start reaches six days back', () => {
    // 2026-10-04 is a Sunday; 2026-10-05 lies after today and is ignored
    const sunday = { '2026-10-04': 5, '2026-10-03': 7, '2026-10-05': 2, '2026-09-28': 9 }
    expect(ledgerTotals([sunday], '2026-10-04', 0)).toEqual({ today: 5, week: 5, month: 12 })
    expect(ledgerTotals([sunday], '2026-10-04', 1)).toEqual({ today: 5, week: 21, month: 12 })
  })

  test('keys after today are ignored everywhere', () => {
    expect(ledgerTotals([{ '2026-10-07': 9, '2026-10-06': 1 }], '2026-10-06')).toEqual({ today: 1, week: 1, month: 1 })
  })

  test('several ledgers add up (parallel sessions)', () => {
    expect(ledgerTotals([{ '2026-10-06': 2 }, { '2026-10-06': 3, '2026-10-05': 10 }], '2026-10-06')).toEqual({ today: 5, week: 15, month: 15 })
  })

  test('an empty list of ledgers gives zeros', () => {
    expect(ledgerTotals([], '2026-10-06')).toEqual({ today: 0, week: 0, month: 0 })
  })

  test('a today that is not a plain YYYY-MM-DD gives zeros', () => {
    expect(ledgerTotals([ledger], '2026-10-6')).toEqual({ today: 0, week: 0, month: 0 })
  })

  test('a whole October-only ledger', () => {
    const october = { '2026-10-01': 1, '2026-10-02': 2, '2026-10-03': 3, '2026-10-04': 4, '2026-10-05': 5, '2026-10-06': 6 }
    // Tuesday today: the Monday week is 10-05 + 10-06
    expect(ledgerTotals([october], '2026-10-06')).toEqual({ today: 6, week: 11, month: 21 })
  })
})
