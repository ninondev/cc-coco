import { expect, test } from 'bun:test'
import { resolveLock } from '../../../plugin/hooks/cost/warm/lock'
import { armInput, deferredFork, flush, okUsage, OPUS, FABLE, setup, usd } from './helpers'

test('a companion report exactly ten minutes old is stale', () => {
  expect(resolveLock({ now: 700000, away: { state: 'locked', since: 100000 }, ioreg: '"IOConsoleLocked" = No' })).toBe('unlocked')
})
test('a future companion timestamp is not current evidence', () => {
  expect(resolveLock({ now: 100000, away: { state: 'locked', since: 100001 }, loginctl: 'no' })).toBe('unlocked')
})

test('an unsuccessful paid fork counts usage then stops with error without renewing', async () => {
  const usage = okUsage()
  const s = setup({ fork: async () => ({ ok: false, usage }) })
  s.keeper.arm(armInput())
  s.clock.advance(240000); await flush()
  const paid = usd(usage, OPUS, '5m')
  expect(s.events).toEqual([
    { type: 'reread', at: 240000, ok: false, usd: paid, rereads: 1 },
    { type: 'stop', at: 240000, reason: 'error' },
  ])
  expect(s.keeper.status()).toMatchObject({ reason: 'error', rereads: 1, spentUsd: paid, warmUntil: 300000, nextAt: null })
  expect(s.clock.pending()).toBe(0)
  expect(s.keeper.turnStarted('composer')?.allHit).toBe(false)
})

test('late usage is priced with the originating arm prices and TTL', async () => {
  const d = deferredFork(), s = setup({ fork: d.fork })
  s.keeper.arm(armInput()); s.clock.advance(240000)
  s.keeper.turnStarted('composer')
  s.keeper.arm(armInput({ sentAt: s.clock.now(), prices: FABLE, ttl: '1h' }))
  const usage = okUsage({ cacheWrite: 500 })
  d.resolve({ ok: false, usage }); await flush()
  expect(s.events.at(-1)).toMatchObject({ type: 'reread', usd: usd(usage, OPUS, '5m') })
  expect(s.keeper.status()).toMatchObject({ rereads: 0, spentUsd: 0, state: 'armed' })
})
