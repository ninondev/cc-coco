import { expect, test } from 'bun:test'
import { dayStart, shippedTooOld } from '../../../plugin/hooks/cost/prices/load.ts'

test('W9 release dates refuse nonexistent calendar days', () => {
  expect(dayStart('2026-02-31')).toBeNull()
  expect(dayStart('2026-13-01')).toBeNull()
  expect(shippedTooOld('2026-02-31', '2026-03-10')).toBe(true)
})
