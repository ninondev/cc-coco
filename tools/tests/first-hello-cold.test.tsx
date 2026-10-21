// The first hello and a resumed chat's cold note at the same start (his card of 10-17 late): the cold note goes first,
// since it helps only before the next message, and the hello follows it, still once in a lifetime, then holds until
// the person speaks or five minutes pass. Either may arrive first.
import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { COST_WORDS_RAW, SHIPPED_PRICES_RAW } from './cost-words-fixture'
import { C3_WORDS_RAW } from './c3-words-fixture'
import { C3_HEAD_MANIFEST } from './c3-head-assets'
import { installM1Words } from './m1-more-data-fixture'
import { MORNING, PERSON, band, settleLegacyStart, world } from './world'
import { LINES } from '../hooks/lines'

installM1Words()
const MODEL = 'claude-opus-5-5'
const START = { cwd: '/tmp/first-hello-cold', surface: 'terminal' as const, isInteractive: true }
const TOKENS = { input_tokens: 0, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 120000, model: MODEL }
const OK = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
const STATE = /[\\/]bin[\\/]coco-state(?:-macos-(?:x86_64|aarch64)|-linux-(?:x86_64|aarch64)|-windows-(?:x86_64|aarch64)\.exe)?$/
const LAPSED = { source: 'resume', seconds_since_last_response: 4000, prompt_cache_likely_expired: true, context_tokens: 120000, estimated_cache_write_usd: 0.9 }

function fixture(on: On) {
  const claims: string[][] = []
  on('classic.SessionStart', () => ({}))
  on('fs.exists', { path: '/System/Library/CoreServices/SystemVersion.plist' }, () => ({ value: true }))
  on('fs.exists', { path: STATE }, () => ({ value: true }))
  on('fs.exists', () => ({ value: false }))
  on('process.run', ($, e) => {
    if (!STATE.test(e.argv[0] ?? '')) return { value: OK }
    if (e.argv.includes('--claim-welcome')) { claims.push([...e.argv]); return { value: { ...OK, stdout: JSON.stringify({ claimed: claims.length === 1 }) } } }
    return { value: { ...OK, stdout: JSON.stringify({ ok: true, result: {}, ensured: true, read: true, text: '', appended: true }) } }
  })
  // A new install: neither firstMet nor welcome. The window readings and a finished turn tell the cost model a plan
  // pays, so the cold note has its words.
  const w = world(on, {
    observeStore: true, engineRows: true, surfaces: ['terminal'], percent: 60, cost: 1, startedAt: MORNING, stepUsage: TOKENS, stepText: 'done',
    store: { bandSettings: { voice: 'off', notes: false, guard: false, bookmark: false } },
    limits: [{ kind: 'five_hour', percentUsed: 40, resetsAt: new Date(MORNING + 5 * 3600000).toISOString() }],
    settings: { promptCacheTtl: '5m', prefersReducedMotion: true },
    env: { HOME: '/tmp/first-hello-cold-home', LANG: 'en_US.UTF-8', TERM: 'xterm-256color', FORCE_PROMPT_CACHING_5M: '1' },
    readText: path => path.endsWith('cost-text.json') ? COST_WORDS_RAW : path.endsWith('prices.json') ? SHIPPED_PRICES_RAW
      : path.endsWith('c3-text.json') ? C3_WORDS_RAW : path.endsWith('frame-manifest.json') ? JSON.stringify(C3_HEAD_MANIFEST) : undefined,
  })
  return { w, claims }
}
async function paidTurn($: any) {
  await $.turn.start({ text: 'first', turnId: 'paid' })
  for await (const _ of $.turn.step({ turnId: 'paid', index: 0, model: MODEL, messageCount: 1 })) {}
  await $.turn.complete({ turnId: 'paid', answer: 'done', reason: 'answer', durationMs: 1000, isAborted: false, usage: TOKENS })
}
const hello = (key: string | undefined) => key === 'first.hello'

test('the hello already up steps aside for the cold note and comes back when the note is done', async ($, on) => {
  const f = fixture(on)
  await $.session.start(START); await settleLegacyStart($, f.w)
  const row = await $.ui.mount({ surface: 'terminal', ...band(100) }); await settleLegacyStart($, f.w); await row.redraw()
  await paidTurn($)
  expect(f.w.view().cost?.billing.kind).toBe('plan')
  expect(f.w.view().line?.key).toBe('first.hello')
  await $.classic.SessionStart(LAPSED); await f.w.clock.advance(0)
  expect(f.w.view().line?.key).toBe('cold.resume')
  await f.w.clock.advance(13_000)
  expect(f.w.view().line?.key).toBe('cold.resume')
  await f.w.clock.advance(1_500)
  const back = f.w.view().line
  expect(hello(back?.key) && LINES.en.first_meet.includes(back!.text)).toBe(true)
  // Once in a lifetime: one claim, and it now holds until the person speaks.
  expect(f.claims.length).toBe(1)
  await $.prompt.submit({ text: 'hi', wait: false, origin: PERSON }); await $.turn.start({ text: 'hi', turnId: 'after-hello' })
  expect(hello(f.w.view().line?.key)).toBe(false)
  await row.unmount()
})

// Why a timer and not the slot's queue: a message sent while the cold note shows clears a waiting line, and the hello
// would be gone for good. (The other order, the note up before the claim, takes the same path at the claim; on a new
// install the cost model learns who pays only after he is drawn, so the hello comes first.)
test('a message sent while the cold note shows does not lose the hello, which then holds until the next one', async ($, on) => {
  const f = fixture(on)
  await $.session.start(START); await settleLegacyStart($, f.w)
  const row = await $.ui.mount({ surface: 'terminal', ...band(100) }); await settleLegacyStart($, f.w); await row.redraw()
  await paidTurn($)
  expect(f.w.view().line?.key).toBe('first.hello')
  await $.classic.SessionStart(LAPSED); await f.w.clock.advance(0)
  expect(f.w.view().line?.key).toBe('cold.resume')
  await $.prompt.submit({ text: 'go on', wait: false, origin: PERSON }); await $.turn.start({ text: 'go on', turnId: 'during-note' })
  await f.w.clock.advance(15_000)
  expect(hello(f.w.view().line?.key)).toBe(true)
  expect(f.claims.length).toBe(1)
  await $.prompt.submit({ text: 'thanks', wait: false, origin: PERSON }); await $.turn.start({ text: 'thanks', turnId: 'after-hello' })
  expect(hello(f.w.view().line?.key)).toBe(false)
  await row.unmount()
})
