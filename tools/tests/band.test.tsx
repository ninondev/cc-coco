// The band and the spinner on each surface: what is drawn at rest, while working, when narrow,
// and that the trees validate on the terminal and the desktop alike.

import { describe, expect, test } from 'claude-code/testing'
import { TERMINAL_COLUMNS, TERMINAL_ROWS } from '../hooks/pictures'
import { P, PERSON, RECENT, band, world } from './world'

const START = { cwd: '/tmp/project', surface: 'terminal' as const, isInteractive: true }

describe('terminal', () => {
  test('at rest: the sprite, his name, the stage direction and the offering box', async ($, on) => {
    const w = world(on, { store: RECENT, percent: 42 })
    await $.session.start(START)
    const ui = await $.ui.mount({ surface: 'terminal', ...band(100) })
    await w.clock.advance(0) // the deferred asset load must invalidate this mounted band
    const sprite = await ui.find({ type: 'Raster' })
    expect(sprite?.props.columns).toBe(TERMINAL_COLUMNS)
    expect(sprite?.props.rows).toBe(TERMINAL_ROWS)
    expect(await ui.find({ type: 'Text', text: 'Claude-sama' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\(training\.\.\.\)/ })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /▤ 42%/ }))?.props.color).toBe('inactive')
  })

  test('while a turn runs: one line, no sprite', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START)
    await $.turn.start({ text: 'go', turnId: 't1' })
    const ui = await $.ui.mount({ surface: 'terminal', ...band(100, true) })
    await w.clock.advance(0) // the deferred asset load must invalidate this mounted band
    expect(await ui.find({ type: 'Raster' })).toBe(undefined)
    expect(await ui.find({ type: 'Text', text: 'Claude-sama' })).toBeDefined()
    expect((await ui.findAll({ type: 'Text' })).length).toBeLessThanOrEqual(4)
  })

  test('narrow or short terminals get the one-line band', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START)
    const narrow = await $.ui.mount({ surface: 'terminal', ...band(TERMINAL_COLUMNS + 20) })
    expect(await narrow.find({ type: 'Raster' })).toBe(undefined)
    const short = await $.ui.mount({ surface: 'terminal', ...band(120, false, TERMINAL_ROWS - 1) })
    expect(await short.find({ type: 'Raster' })).toBe(undefined)
  })

  test('kitty and Ghostty get the picture itself', async ($, on) => {
    const w = world(on, { store: RECENT, env: { TERM: 'xterm-ghostty', TERM_PROGRAM: 'ghostty' } })
    await $.session.start(START)
    const ui = await $.ui.mount({ surface: 'terminal', ...band(100) })
    await w.clock.advance(0) // the deferred asset load must invalidate this mounted band
    expect(await ui.find({ type: 'Image' })).toBeDefined()
  })

  test('the light built-in theme gets a darker name colour', async ($, on) => {
    const w = world(on, { store: RECENT, settings: { theme: 'light' } })
    await $.session.start(START)
    const ui = await $.ui.mount({ surface: 'terminal', ...band(100) })
    await w.clock.advance(0) // the deferred asset load must invalidate this mounted band
    expect((await ui.find({ type: 'Text', text: 'Claude-sama' }))?.props.color).toBe('#9E4123')
  })

  test('the spinner says his verb on the terminal and is left alone on the desktop', async ($, on) => {
    let word = ''
    const w = world(on, {
      store: RECENT,
      onRender: (component, props) => {
        if (component === 'Spinner') word = (props as { word: string }).word
      },
    })
    await $.session.start(START)
    await $.prompt.submit({ text: 'go', wait: false, origin: PERSON })
    await $.turn.start({ text: 'go', turnId: 't1' })
    const spinner = { plugin: 'claudesama', component: 'Spinner' as const, props: { word: 'Sauteing', message: null, suffix: '…', mode: 'thinking' as const } }
    await $.ui.mount({ surface: 'terminal', ...spinner })
    expect(word).not.toBe('Sauteing')
    expect(word.length).toBeGreaterThan(0)
    await $.ui.mount({ surface: 'desktop', ...spinner, props: { ...spinner.props, word: 'Creating notes.md' } })
    expect(word).toBe('Creating notes.md')
  })
})

describe('both surfaces', () => {
  test('every mood draws a tree each surface accepts, at rest and while working', { timeoutMs: 60_000 }, async ($, on) => {
    const w = world(on, { store: RECENT, percent: 91, bashFails: () => true })
    await $.session.start(START)
    for (const surface of ['terminal', 'desktop'] as const) {
      for (const isWorking of [false, true]) {
        for (const columns of [44, 80, 140]) {
          const ui = await $.ui.mount({ surface, ...band(columns, isWorking) })
          await w.clock.advance(0) // the deferred asset load must invalidate this mounted band
          expect(await ui.drawn()).toBeDefined()
          await ui.unmount()
        }
      }
    }
    await $.turn.start({ text: 'go', turnId: 't1' })
    for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'npm test' })
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ surface, ...band(100) })
      await w.clock.advance(0) // the deferred asset load must invalidate this mounted band
      expect(await ui.find({ text: /\(hair rising\)/ })).toBeDefined()
      expect(await ui.find({ text: /91%/ })).toBeDefined()
    }
  })

  test('band off leaves only its visible wake door', async ($, on) => {
    const w = world(on, { store: { ...RECENT, band: 'off' } })
    await $.session.start(START)
    for (const surface of ['terminal', 'desktop'] as const) {
      const off = await $.ui.mount({ surface, ...band(100) })
      expect(await off.find({ type: 'Button', key: 'claudesama:band:wake' })).toBeDefined()
      expect(await off.find({ type: 'Text', text: /Claude-sama/ })).toBe(undefined)
    }
  })

  test('the omen slip shows on both surfaces', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START)
    await $.command.run({ command: 'omen', args: '', origin: PERSON, presentation: P })
    const desk = await $.ui.mount({ surface: 'desktop', ...band(100) })
    expect((await desk.findAll({ type: 'Svg' })).some(svg => String(svg.props.alt).startsWith('fortune slip'))).toBe(true)
    const term = await $.ui.mount({ surface: 'terminal', ...band(100) })
    expect(await term.find({ type: 'Text', text: /lucky number/ })).toBeDefined()
  })
})
