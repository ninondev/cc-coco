// resolveLock (rule 10): first matching source wins.

import { expect, test } from 'bun:test'
import { resolveLock } from '../../../plugin/hooks/cost/warm/index'

test('fresh away with state locked gives locked', () => {
  expect(resolveLock({ now: 600000, away: { state: 'locked', since: 100000 } })).toBe('locked')
})

test('fresh away with state display-asleep gives locked', () => {
  expect(resolveLock({ now: 600000, away: { state: 'display-asleep', since: 100000 } })).toBe('locked')
})

test('fresh away with state null gives unlocked', () => {
  expect(resolveLock({ now: 600000, away: { state: null, since: 100000 } })).toBe('unlocked')
})

// K1a correction: the design says newer than ten minutes, strictly.
test('away exactly ten minutes old is stale', () => {
  expect(resolveLock({ now: 700000, away: { state: 'locked', since: 100000 } })).toBe('none')
})

test('stale away falls through to ioreg', () => {
  expect(resolveLock({ now: 700001, away: { state: 'locked', since: 100000 }, ioreg: '"IOConsoleLocked" = No' })).toBe('unlocked')
})

test('away with non-finite since falls through', () => {
  expect(resolveLock({ now: 0, away: { state: 'locked', since: Number.NaN }, ioreg: '"IOConsoleLocked" = Yes' })).toBe('locked')
  expect(resolveLock({ now: 0, away: { state: 'locked', since: Number.POSITIVE_INFINITY } })).toBe('none')
})

test('away absent falls through to ioreg', () => {
  expect(resolveLock({ now: 0, away: null, ioreg: '"IOConsoleLocked" = Yes' })).toBe('locked')
  expect(resolveLock({ now: 0, ioreg: '"IOConsoleLocked" = Yes' })).toBe('locked')
})

test('ioreg Yes gives locked', () => {
  expect(resolveLock({ now: 0, ioreg: '"IOConsoleLocked" = Yes' })).toBe('locked')
})

test('ioreg No gives unlocked', () => {
  expect(resolveLock({ now: 0, ioreg: '"IOConsoleLocked" = No' })).toBe('unlocked')
})

test('ioreg spacing variants match', () => {
  expect(resolveLock({ now: 0, ioreg: '"IOConsoleLocked"=Yes' })).toBe('locked')
  expect(resolveLock({ now: 0, ioreg: '"IOConsoleLocked"   =   No' })).toBe('unlocked')
  expect(resolveLock({ now: 0, ioreg: 'ioreg:\n    "IOConsoleLocked" = Yes;\n' })).toBe('locked')
})

test('ioreg without the key falls through to loginctl', () => {
  expect(resolveLock({ now: 0, ioreg: 'nothing here', loginctl: 'yes' })).toBe('locked')
})

test('loginctl yes (trimmed, any case) gives locked', () => {
  expect(resolveLock({ now: 0, loginctl: 'yes' })).toBe('locked')
  expect(resolveLock({ now: 0, loginctl: '  Yes  ' })).toBe('locked')
  expect(resolveLock({ now: 0, loginctl: 'YES' })).toBe('locked')
})

test('loginctl no gives unlocked', () => {
  expect(resolveLock({ now: 0, loginctl: 'no' })).toBe('unlocked')
  expect(resolveLock({ now: 0, loginctl: ' No ' })).toBe('unlocked')
})

test('loginctl garbage gives none', () => {
  expect(resolveLock({ now: 0, loginctl: 'maybe' })).toBe('none')
})

test('no signal at all gives none', () => {
  expect(resolveLock({ now: 0 })).toBe('none')
  expect(resolveLock({ now: 0, away: null, ioreg: null, loginctl: null })).toBe('none')
})
