// One Coco (owner 10-20: 「我这边在不停的显示压缩换衣动作」): the pet shows whichever of his sessions is newest, and each
// session wore the outfit of its own compactions, so the pet changed clothes every time it showed another one. The
// outfit is shared like the theme: a compaction puts the new one in the shared record, and every session wears it.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { MORNING, P, PERSON, SUMMARY, band, cocoBandText } from './world'
import { presenceWorld, snapshot } from './presence-world'
import { companionRecord } from '../hooks/companion'
import { WINDOWS_ROOTS } from './test-system'

const START = { cwd: '/tmp/coco-outfit-shared', surface: 'desktop' as const, isInteractive: true }
async function flush($: Engine) { for (let i = 0; i < 40; i++) await $.command.run({ command: 'model', args: '', origin: PERSON, presentation: P }) }

if (!WINDOWS_ROOTS) test("another session's compaction dresses this one, and its pet record, in the new outfit", async ($, on) => {
  const f = presenceWorld(on, snapshot(), { withNativePresence: true, readText: cocoBandText })
  await $.session.start(START)
  const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
  await f.clock.advance(0); await flush($)
  expect(f.view().outfit).toBeUndefined()
  const at = f.clock.now(), changes = { outfit: 'B' }
  const event = { kind: 'settings', id: `settings:90:${at}`, at, lang: 'en', changes }
  f.remote({ ...snapshot('activity', at, f.current.seq + 1), event, settingsEvent: event, settings: { ...f.current.settings, ...changes } } as never)
  await flush($)
  expect(f.view().outfit).toBe('B')
  expect(companionRecord(f.view()).outfit).toBe('B')
  await ui.unmount()
})

if (!WINDOWS_ROOTS) test("this session's compaction puts the outfit it changed into in the shared record", async ($, on) => {
  on('session.compact', () => ({ messages: [SUMMARY], tokensBefore: 138000, tokensAfter: 20000 }))
  const f = presenceWorld(on, snapshot('activity', MORNING, 1, { settings: { outfit: 'B' } }), { withNativePresence: true, readText: cocoBandText })
  await $.session.start(START)
  const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
  await f.clock.advance(0); await flush($)
  expect(f.view().outfit).toBe('B')
  await $.session.compact({ trigger: 'manual', messages: [SUMMARY] }); await flush($)
  expect(f.view().outfit).toBe('A')
  expect(f.current.settings?.outfit).toBe('A')
  await ui.unmount()
})

// With no shared presence on Windows the outfit is this session's own: a compaction changes it here and writes nothing shared.
if (WINDOWS_ROOTS) test("Windows declines shared presence: a compaction changes this session's outfit and leaves the shared record alone", async ($, on) => {
  on('session.compact', () => ({ messages: [SUMMARY], tokensBefore: 138000, tokensAfter: 20000 }))
  const f = presenceWorld(on, snapshot(), { withNativePresence: true, readText: cocoBandText })
  await $.session.start(START)
  const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
  await f.clock.advance(0); await flush($)
  expect(f.view().outfit).toBeUndefined()
  await $.session.compact({ trigger: 'manual', messages: [SUMMARY] }); await flush($)
  expect(f.view().outfit).toBe('B')
  expect(companionRecord(f.view()).outfit).toBe('B')
  expect(f.current.settings?.outfit).toBeUndefined()
  expect(f.calls.filter(call => call.argv.some(arg => /presence\.sh$/.test(arg)))).toEqual([])
  await ui.unmount()
})
