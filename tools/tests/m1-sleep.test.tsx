import { expect, test } from 'claude-code/testing'
import { TIMING } from '../hooks/mood'
import { reducePresence } from '../hooks/presence'
import type { On } from 'claude-code'
import { world, MORNING, RECENT, band, settleLegacyStart, PERSON, P } from './world'

// Observe actual engine waits, including cancellation and completion. Short UI
// transitions are separate from the 150s clingy / 4–6 minute quiet deadlines.
function quietWaits(on: On, now: () => number, hold?: { take: () => boolean; entered: () => void; wait: Promise<void> }) {
  const waits: { at: number; active: boolean }[] = []
  on('clock.*', async (_$, event, next) => {
    if (next.is('clock.now', event) && hold?.take()) {
      const result = await next(event); hold.entered(); await hold.wait; return result
    }
    if (!next.is('clock.after', event) || event.ms < 90000) return next(event)
    const wait = { at: now() + event.ms, active: true }; waits.push(wait)
    next.signal.addEventListener('abort', () => { wait.active = false }, { once: true })
    try { return await next(event) } finally { wait.active = false }
  })
  return () => waits.filter(wait => wait.active).map(wait => wait.at)
}

test('M1 clingy fallback has one active quiet timer and reuses the absolute shared sleep deadline', async ($, on) => {
  let now = () => MORNING
  const active = quietWaits(on, () => now())
  const w = world(on, { withNativePresence: true,
    store: { ...RECENT, bandSettings: { affection: 'clingy' } }, settings: { prefersReducedMotion: true } })
  now = () => w.clock.now()
  await $.session.start({ cwd: '/tmp/m1-sleep', surface: 'terminal', isInteractive: true })
  await settleLegacyStart($, w)
  await $.ui.mount({ surface: 'terminal', ...band(100) })
  const deadline = MORNING + TIMING.sleepAfter(MORNING)
  expect(active()).toEqual([MORNING + TIMING.clingyAfter])
  await w.clock.advance(TIMING.clingyAfter - 1)
  expect(w.view().mood).not.toBe('sleep')
  expect(active()).toEqual([MORNING + TIMING.clingyAfter])
  await w.clock.advance(1); await settleLegacyStart($, w)
  expect(active()).toEqual([deadline])
  expect(w.view().mood).not.toBe('sleep')
  await w.clock.advance(deadline - w.clock.now() - 1)
  expect(w.view().mood).not.toBe('sleep')
  await w.clock.advance(1); await settleLegacyStart($, w)
  expect(w.view().mood).toBe('sleep')
  expect(active()).toEqual([])
})

test('M1 held clingy callback cannot arm sleep over a new quiet spell', async ($, on) => {
  let now = () => MORNING, holdNextNow = false
  let release = () => {}, entered = () => {}
  const held = new Promise<void>(resolve => { release = resolve })
  const began = new Promise<void>(resolve => { entered = resolve })
  const active = quietWaits(on, () => now(), { entered: () => entered(), wait: held,
    take: () => { if (!holdNextNow) return false; holdNextNow = false; return true } })
  const w = world(on, { withNativePresence: true,
    store: { ...RECENT, bandSettings: { affection: 'clingy' } }, settings: { prefersReducedMotion: true } })
  now = () => w.clock.now()
  await $.session.start({ cwd: '/tmp/m1-sleep', surface: 'terminal', isInteractive: true })
  await settleLegacyStart($, w)
  const ui = await $.ui.mount({ surface: 'terminal', ...band(100) })
  await w.clock.advance(TIMING.clingyAfter - 1)
  holdNextNow = true
  const ticking = w.clock.advance(1); await began
  try {
    const quietAt = w.clock.now(), deadline = quietAt + TIMING.sleepAfter(quietAt)
    await ui.press({ key: 'coco:book:open' })
    for (let i = 0; i < 80; i++) await $.command.run({ command: 'b1b-host-boundary', args: '', origin: PERSON, presentation: P })
    release(); await ticking; await settleLegacyStart($, w)
    expect(active()).toEqual([quietAt + TIMING.clingyAfter])
    await w.clock.advance(TIMING.clingyAfter); await settleLegacyStart($, w)
    expect(active()).toEqual([deadline])
    await w.clock.advance(deadline - w.clock.now() - 1)
    expect(w.view().mood).not.toBe('sleep')
    await w.clock.advance(1); await settleLegacyStart($, w)
    expect(w.view().mood).toBe('sleep')
    expect(active()).toEqual([])
  } finally { release(); await ticking; await ui.unmount() }
})

test('M1 transient refusal at the clingy deadline preserves the later absolute sleep timer', async ($, on) => {
  let now = () => MORNING
  const active = quietWaits(on, () => now())
  on('classic.PermissionDenied', () => ({}))
  const w = world(on, { withNativePresence: true,
    store: { ...RECENT, bandSettings: { affection: 'clingy' } }, settings: { prefersReducedMotion: true } })
  now = () => w.clock.now()
  await $.session.start({ cwd: '/tmp/m1-sleep', surface: 'terminal', isInteractive: true })
  await settleLegacyStart($, w)
  await $.ui.mount({ surface: 'terminal', ...band(100) })
  const deadline = MORNING + TIMING.sleepAfter(MORNING)
  await w.clock.advance(TIMING.clingyAfter - 1)
  await $.classic.PermissionDenied({ tool_name: 'Read', tool_input: { file_path: '/tmp/m1-sleep/synthetic' },
    tool_use_id: 'synthetic-refusal', reason: 'Synthetic refusal.' })
  await settleLegacyStart($, w)
  expect(w.view().mood).toBe('refuse')
  await w.clock.advance(1); await settleLegacyStart($, w)
  expect(w.view().mood).toBe('refuse')
  expect(active()).toEqual([deadline])
  await w.clock.advance(TIMING.errorFlash); await settleLegacyStart($, w)
  expect(w.view().mood).toBe('idle')
  await w.clock.advance(deadline - w.clock.now() - 1)
  expect(w.view().mood).not.toBe('sleep')
  await w.clock.advance(1); await settleLegacyStart($, w)
  expect(w.view().mood).toBe('sleep')
  expect(active()).toEqual([])
})

test('M1 fallback band arms one idle sleep timer at the same deadline as shared presence', async ($, on) => {
  const sleeps: number[] = []
  on('clock.*', ($, event, next) => {
    if (next.is('clock.after', event) && event.ms >= 240000 && event.ms < 360000) sleeps.push(event.ms)
    return next(event)
  })
  const w = world(on, { withNativePresence: true, store: RECENT, settings: { prefersReducedMotion: true } })
  await $.session.start({ cwd: '/tmp/m1-sleep', surface: 'terminal', isInteractive: true })
  await settleLegacyStart($, w)
  await $.ui.mount({ surface: 'terminal', ...band(100) })
  const delay = TIMING.sleepAfter(MORNING)
  expect(sleeps).toEqual([delay])
  const start = reducePresence(undefined, 'decide', 'shared', MORNING, false, 0, '', new Map(), '', 'en')
  await w.clock.advance(delay - 1)
  expect(w.view().mood).not.toBe('sleep')
  const before = reducePresence(start, 'decide', 'shared', MORNING + delay - 1, false, 0, '', new Map(), '', 'en')
  expect(before.asleep).toBe(false)
  await w.clock.advance(1)
  const asleep = reducePresence(before, 'decide', 'shared', MORNING + delay, false, 0, '', new Map(), '', 'en')
  expect(w.view().mood).toBe('sleep')
  expect(asleep.sleepEvent?.at).toBe(w.clock.now())
  expect(sleeps).toEqual([delay])
})

test('M1 fallback book activity starts a new hashed quiet spell and cancels the old sleep deadline', async ($, on) => {
  const sleeps: number[] = []
  on('clock.*', ($, event, next) => {
    if (next.is('clock.after', event) && event.ms >= 240000 && event.ms < 360000) sleeps.push(event.ms)
    return next(event)
  })
  const w = world(on, { withNativePresence: true, store: RECENT, settings: { prefersReducedMotion: true } })
  await $.session.start({ cwd: '/tmp/m1-sleep', surface: 'terminal', isInteractive: true })
  await settleLegacyStart($, w)
  const ui = await $.ui.mount({ surface: 'terminal', ...band(100) })
  const originalDelay = TIMING.sleepAfter(MORNING)
  await w.clock.advance(180000)
  const nextQuiet = w.clock.now(), nextDelay = TIMING.sleepAfter(nextQuiet)
  await ui.press({ key: 'coco:book:open' })
  await settleLegacyStart($, w)
  expect(sleeps).toEqual([originalDelay, nextDelay])
  await w.clock.advance(originalDelay - 180000)
  expect(w.view().mood).not.toBe('sleep')
  await w.clock.advance(nextQuiet + nextDelay - w.clock.now() - 1)
  expect(w.view().mood).not.toBe('sleep')
  await w.clock.advance(1)
  expect(w.view().mood).toBe('sleep')
  expect(sleeps).toEqual([originalDelay, nextDelay])
})

test('M1 fallback late sleep callback cannot consume a newer quiet spell timer', async ($, on) => {
  let holdNextNow = false, heldReads = 0
  let release = () => {}, entered = () => {}
  const held = new Promise<void>(resolve => { release = resolve })
  const began = new Promise<void>(resolve => { entered = resolve })
  on('clock.*', async ($, event, next) => {
    if (!next.is('clock.now', event) || !holdNextNow) return next(event)
    holdNextNow = false; heldReads++
    const result = await next(event)
    entered(); await held; return result
  })
  const w = world(on, { withNativePresence: true, store: RECENT, settings: { prefersReducedMotion: true } })
  await $.session.start({ cwd: '/tmp/m1-sleep', surface: 'terminal', isInteractive: true })
  await settleLegacyStart($, w)
  const ui = await $.ui.mount({ surface: 'terminal', ...band(100) })
  await settleLegacyStart($, w)
  await w.clock.advance(TIMING.sleepAfter(MORNING) - 1)
  holdNextNow = true
  const ticking = w.clock.advance(1)
  await began
  try {
    expect(heldReads).toBe(1)
    const nextQuiet = w.clock.now()
    await ui.press({ key: 'coco:book:open' })
    for (let i = 0; i < 80; i++) await $.command.run({ command: 'b1b-host-boundary', args: '', origin: PERSON, presentation: P })
    release(); await ticking; await settleLegacyStart($, w)
    expect(w.view().mood).not.toBe('sleep')
    await w.clock.advance(nextQuiet + TIMING.sleepAfter(nextQuiet) - w.clock.now() - 1)
    expect(w.view().mood).not.toBe('sleep')
    await w.clock.advance(1)
    expect(w.view().mood).toBe('sleep')
  } finally {
    release(); await ticking; await ui.unmount()
  }
})
