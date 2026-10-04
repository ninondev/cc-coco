// The offering box keeps up with the engine within a beat, and costs nothing while nothing moves.

import { describe, expect, test } from 'claude-code/testing'
import { RECENT, SUMMARY, band, desktopPicture, world } from './world'

const START = { cwd: '/tmp/project', surface: 'terminal' as const, isInteractive: true }
const SPINNER = { word: 'Working', message: null, suffix: '…' }

function spinner(mode: 'requesting' | 'responding' | 'thinking' | 'tool-input' | 'tool-use') {
  return { plugin: 'claudesama', component: 'Spinner' as const, props: { ...SPINNER, mode } }
}

describe('the offering box keeps up', () => {
  test('a compaction empties it at once, as the engine estimates, until the next response', async ($, on) => {
    const w = world(on, { percent: 69, store: RECENT, estimate: 24000 })
    await $.session.start(START)
    expect(w.view().context).toBe(69)
    w.percent = null // the engine has no figure until the next response
    await $.session.compact({ trigger: 'manual', messages: [SUMMARY] })
    expect(w.view().context).toBe(12)
    expect(w.view().estimate).toBe(true)
    w.percent = 15
    await $.turn.start({ text: 'go on', turnId: 't2' })
    await $.tool.call({ tool: 'Read', file_path: '/tmp/a' })
    expect(w.view().context).toBe(15)
    expect(w.view().estimate).toBe(false)
  })

  test('a reading that still counts the old conversation does not bring the old number back', async ($, on) => {
    const w = world(on, { percent: 69, store: RECENT, estimate: 24000 })
    await $.session.start(START)
    await $.session.compact({ trigger: 'auto', messages: [SUMMARY] })
    expect(w.view().context).toBe(12)
    await $.prompt.submit({ text: 'next', wait: false, origin: { kind: 'composer' } })
    await w.clock.advance(10)
    expect(w.view().context).toBe(12) // the engine still reports 69 % from before: ignored
    w.percent = 14
    await $.turn.start({ text: 'next', turnId: 't2' })
    await $.tool.call({ tool: 'Read', file_path: '/tmp/a' })
    expect(w.view().context).toBe(14)
  })

  test('a precompute and a subagent compaction leave it alone', async ($, on) => {
    const w = world(on, { percent: 69, store: RECENT, estimate: 24000 })
    await $.session.start(START)
    await $.session.compact({ trigger: 'precompute', messages: [SUMMARY] })
    expect(w.view().context).toBe(69)
    await $.session.compact({ trigger: 'auto', messages: [SUMMARY], agentId: 'a1' })
    expect(w.view().context).toBe(69)
  })

  test('a fresh session shows the estimate, never a made-up 0 %', async ($, on) => {
    const w = world(on, { percent: null, store: RECENT, estimate: 16000 })
    await $.session.start(START)
    expect(w.view().context).toBe(8)
    expect(w.view().estimate).toBe(true)
  })

  test('with no figure and no estimate the box hides', async ($, on) => {
    const w = world(on, { percent: null, store: RECENT })
    await $.session.start(START)
    expect(w.view().context).toBe(null)
  })

  test('each response reads it immediately on either surface, without a spinner or a timer', async ($, on) => {
    const w = world(on, { percent: 20, store: RECENT })
    await $.session.start(START)
    await $.turn.start({ text: 'go', turnId: 't1' })
    for (const [index, percent] of [31, 33].entries()) {
      w.percent = percent
      for await (const chunk of $.turn.step({ turnId: 't1', index, model: 'claude', messageCount: 1 })) {}
      expect(w.view().context).toBe(percent)
    }
  })

  test('the engine’s own measurement after a turn is taken as pushed', async ($, on) => {
    const w = world(on, { percent: 20, store: RECENT })
    await $.session.start(START)
    await $.session.measure({ context: { window: 200000, tokens: 90000, percent: 45 }, rateLimits: [], changed: ['context'] })
    expect(w.view().context).toBe(45)
  })

  test('/model and /rewind take effect at once', async ($, on) => {
    const w = world(on, { percent: 40, store: RECENT, estimate: 30000 })
    await $.session.start(START)
    w.percent = 8 // the same conversation against a window five times larger
    await $.command.run({ command: 'model', args: 'opus[1m]', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
    expect(w.view().context).toBe(8)
    w.percent = 8
    await $.command.run({ command: 'rewind', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
    expect(w.view().context).toBe(15)
    expect(w.view().estimate).toBe(true)
  })

  test('a running response changes the figure without a clock advance, tool call or stage', async ($, on) => {
    const w = world(on, { percent: 20, store: RECENT })
    await $.session.start(START)
    await $.turn.start({ text: 'think hard', turnId: 't1' })
    w.percent = 27 // a response landed during a long think
    for await (const chunk of $.turn.step({ turnId: 't1', index: 0, model: 'claude', messageCount: 1 })) {}
    expect(w.view().context).toBe(27)
    await $.turn.complete({ answer: 'Done.', durationMs: 9000, isAborted: false, turnId: 't1', reason: 'answer' })
    const after = w.reads
    await w.clock.advance(60_000)
    expect(w.reads).toBe(after) // the sampler stops with the turn
  })

  test('nothing reads while nothing moves: no sprite, no turn, no timer', async ($, on) => {
    const w = world(on, { percent: 20, store: RECENT })
    await $.session.start(START)
    const before = w.reads
    await w.clock.advance(5 * 60_000)
    expect(w.reads).toBe(before)
  })
})

describe('the band keeps up with everything else', () => {
  test('a /config change applies at once: theme, reduced motion, language', async ($, on) => {
    const settings: Record<string, unknown> = { theme: 'dark' }
    const w = world(on, { settings, store: RECENT })
    await $.session.start(START)
    expect(w.view().cue).toBe('claude')
    settings.theme = 'light'
    settings.prefersReducedMotion = true
    settings.language = 'japanese'
    await $.config.set({ key: 'theme', value: 'light' })
    expect(w.view().cue).toBe('#9E4123')
    expect(w.view().lang).toBe('ja')
    await $.ui.mount({ surface: 'terminal', ...band(100) })
    const blits = w.blits.length
    await w.clock.advance(20_000)
    expect(w.blits.length).toBe(blits) // reduced motion took effect without a restart
  })

  test('a turn the band did not hear start still shows him working, and he settles when it ends', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START)
    const drawn = await $.ui.mount({ surface: 'desktop', ...band(90, true) })
    expect(String((await desktopPicture(drawn))?.props.source)).toContain('data:image/png;base64,')
    expect(await drawn.find({ type: 'Text', text: /rereading a line/ })).toBeDefined()
    await drawn.redraw(band(90, false).props)
    expect(await drawn.find({ type: 'Text', text: /training/ })).toBeDefined()
  })
})
