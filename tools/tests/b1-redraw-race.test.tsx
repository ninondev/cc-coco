import { describe, expect, test } from 'claude-code/testing'
import { settleLegacyStart, P, PERSON, RECENT, band, world } from './world'
import { LINES } from '../hooks/lines'

const START = { cwd: '/tmp/b1-redraw-race', surface: 'desktop' as const, isInteractive: true }

function gate() {
  let enter!: () => void, release!: () => void
  const entered = new Promise<void>(resolve => { enter = resolve })
  const held = new Promise<void>(resolve => { release = resolve })
  return { enter, release, entered, held }
}

describe('B1 reaction deadlines across a delayed redraw', () => {
  test('two overlapping writes do not create competing publication repair chains', async ($, on) => {
    const gates = Array.from({ length: 8 }, () => gate())
    let intercept = false, writes = 0
    on('state.*', async ($, e, next) => {
      const result = await next(e)
      if (intercept && next.is('state.set', e)) {
        const held = gates[writes++]
        if (!held) throw new Error('publication repair exceeded bounded fixture capacity')
        held.enter()
        await held.held
      }
      return result
    })
    const setupWorld=world(on, { store: RECENT, settings: { prefersReducedMotion: true } })
    await $.session.start(START); await settleLegacyStart($,setupWorld)
    const flush = async () => { for (let i = 0; i < 3; i++) await $.command.run({ command: 'model', args: '', origin: PERSON, presentation: P }) }
    intercept = true
    const first = $.command.run({ command: 'coco', args: 'voice full', origin: PERSON, presentation: P })
    await gates[0]!.entered
    const second = $.command.run({ command: 'coco', args: 'voice light', origin: PERSON, presentation: P })
    await gates[1]!.entered
    try {
      gates[0]!.release()
      await flush()
      gates[1]!.release()
      await flush()
      expect(writes).toBeLessThanOrEqual(3)
    } finally {
      // Release newest first so the unfixed implementation cannot keep two
      // overlapping repair chains alive after the failed assertion.
      intercept = false
      for (let i = Math.min(writes, gates.length) - 1; i >= 0; i--) { gates[i]!.release(); await flush() }
      await Promise.all([first, second])
    }
  })

  test('an older setting redraw cannot persist over the newer selected voice', async ($, on) => {
    const blocked = gate()
    let intercept = false
    let persistedVoice: unknown
    on('store.*', async ($, e, next) => {
      const result = await next(e)
      if (next.is('store.set', e) && e.key === 'bandSettings') persistedVoice = (e.value as {voice?:unknown}).voice
      return result
    })
    on('state.*', async ($, e, next) => {
      const result = await next(e)
      if (intercept && next.is('state.set', e) && (e.value as { voice?: string }).voice === 'full') {
        intercept = false
        blocked.enter()
        await blocked.held
      }
      return result
    })
    const w = world(on, { store: RECENT, settings: { prefersReducedMotion: true } })
    await $.session.start(START); await settleLegacyStart($,w)
    intercept = true
    const old = $.command.run({ command: 'coco', args: 'voice full', origin: PERSON, presentation: P })
    await blocked.entered
    try {
      await $.command.run({ command: 'coco', args: 'voice light', origin: PERSON, presentation: P })
      expect(w.view().voice).toBe('light')
      expect(persistedVoice).toBe('light')
    } finally { blocked.release() }
    await old
    expect(w.view().voice).toBe('light')
    expect(persistedVoice).toBe('light')
  })

  test('an older pending state write cannot replace a newer permission wait', async ($, on) => {
    const blocked = gate()
    let intercept = false
    on('state.*', async ($, e, next) => {
      if (intercept && next.is('state.set', e) && (e.value as { mood?: string }).mood === 'happy') {
        intercept = false
        blocked.enter()
        await blocked.held
      }
      return next(e)
    })
    const w = world(on, { store: RECENT, ask: true, stepTools: [{ id: 'next-permission', name: 'Bash' }], settings: { prefersReducedMotion: true } })
    await $.session.start(START); await settleLegacyStart($,w)
    await $.ui.mount({ surface: 'desktop', ...band(100) })
    await $.turn.start({ text: 'first', turnId: 'first' })
    intercept = true
    const old = $.turn.complete({ answer: 'Done.', durationMs: 1000, isAborted: false, turnId: 'first', reason: 'answer' })
    await blocked.entered
    try {
      await $.turn.start({ text: 'second', turnId: 'second' })
      for await (const _ of $.turn.step({ turnId: 'second', index: 0, model: 'test', messageCount: 1 })) {}
      await $.tool.check({ tool: 'Bash', input: { command: 'echo ok' }, tool_use_id: 'next-permission' })
      expect(w.view().mood).toBe('waiting')
    } finally { blocked.release() }
    await old
    expect(w.view().mood).toBe('waiting')
    await w.clock.advance(3000)
    expect(w.view().mood).toBe('waiting')
  })

  test('an older completed mood cannot arm a hold after a newer permission wait', async ($, on) => {
    const blocked = gate()
    let intercept = false
    on('state.*', async ($, e, next) => {
      // Hold completion after the old state was stored. A newer state can then
      // persist normally; the test isolates late timer setup, not write rollback.
      const result = await next(e)
      if (intercept && next.is('state.set', e) && (e.value as { mood?: string }).mood === 'happy') {
        intercept = false
        blocked.enter()
        await blocked.held
      }
      return result
    })
    const w = world(on, { store: RECENT, ask: true, stepTools: [{ id: 'next-permission', name: 'Bash' }], settings: { prefersReducedMotion: true } })
    await $.session.start(START); await settleLegacyStart($,w)
    await $.ui.mount({ surface: 'desktop', ...band(100) })
    await $.turn.start({ text: 'first', turnId: 'first' })
    intercept = true
    const old = $.turn.complete({ answer: 'Done.', durationMs: 1000, isAborted: false, turnId: 'first', reason: 'answer' })
    await blocked.entered
    try {
      await $.turn.start({ text: 'second', turnId: 'second' })
      for await (const _ of $.turn.step({ turnId: 'second', index: 0, model: 'test', messageCount: 1 })) {}
      await $.tool.check({ tool: 'Bash', input: { command: 'echo ok' }, tool_use_id: 'next-permission' })
      expect(w.view().mood).toBe('waiting')
    } finally { blocked.release() }
    await old
    expect(w.view().mood).toBe('waiting')
    await w.clock.advance(3000)
    expect(w.view().mood).toBe('waiting')
  })

  test('speech expires at its absolute deadline even when its redraw is delayed', async ($, on) => {
    const blocked = gate()
    let intercept = false
    on('state.*', async ($, e, next) => {
      if (intercept && next.is('state.set', e) && (e.value as { said?: string }).said === LINES.en.set_voice_full[0]) {
        intercept = false
        blocked.enter()
        await blocked.held
      }
      return next(e)
    })
    const w = world(on, { store: RECENT, settings: { prefersReducedMotion: true } })
    await $.session.start(START); await settleLegacyStart($,w)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    intercept = true
    const pending = $.command.run({ command: 'coco', args: 'voice full', origin: PERSON, presentation: P })
    await blocked.entered
    try { await w.clock.advance(5000) } finally { blocked.release() }
    await pending
    await w.clock.advance(8999)
    expect(await ui.find({ type: 'Text', text: LINES.en.set_voice_full[0] })).toBeDefined()
    await w.clock.advance(1)
    expect(await ui.find({ type: 'Text', text: LINES.en.set_voice_full[0] })).toBeUndefined()
  })
})
