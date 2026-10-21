import { expect, test } from 'bun:test'
import { ledgerAdd, ledgerTotals } from '../../../plugin/hooks/cost/core'
test('impossible calendar dates are never counted in the local ledger', () => {
  expect(ledgerAdd({ '2026-02-31': 99 }, '2026-03-03', 1, '2026-03-03')).toEqual({ '2026-03-03': 1 })
  expect(ledgerTotals([{ '2026-02-31': 99 }], '2026-03-03')).toEqual({ today: 0, week: 0, month: 0 })
})
