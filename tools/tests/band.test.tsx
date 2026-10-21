// The band and the spinner on each surface: what is drawn at rest, while working, when narrow,
// and that the trees validate on the terminal and the desktop alike.

import { describe, expect, test } from 'claude-code/testing'
import { TERMINAL_COLUMNS, TERMINAL_ROWS } from '../hooks/pictures-lazy'
import { settleLegacyStart, PERSON, RECENT, band, desktopPicture, world } from './world'
import { pixelCells, pixelWear } from '../hooks/coco-pixel-play'
import { PIXEL_MOMENTS } from '../hooks/coco-pixel'
const momentCells=(key:string,colors:'truecolor'|'256')=>[...PIXEL_MOMENTS[key]!.body,...PIXEL_MOMENTS[key]!.loop].map(s=>pixelCells(s[0],s[2],{...pixelWear(),colors}))

const START = { cwd: '/tmp/project', surface: 'terminal' as const, isInteractive: true }

describe('terminal', () => {
  test('at rest: the sprite, his name, the stage direction and the offering box', async ($, on) => {
    const w = world(on, { store: RECENT, percent: 42 })
    await $.session.start(START); await settleLegacyStart($,w);
    const ui = await $.ui.mount({ surface: 'terminal', ...band(100) })
    await w.clock.advance(0) // the deferred asset load must invalidate this mounted band
    const sprite = await ui.find({ type: 'Raster' })
    expect(sprite?.props.columns).toBe(TERMINAL_COLUMNS)
    expect(sprite?.props.rows).toBe(TERMINAL_ROWS)
    expect(await ui.find({ type: 'Text', text: 'Coco' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\(swinging legs\)/ })).toBeDefined()
    // The commit line and the tokens in k (lane C, 10-14): 42% of a 200k window is two commits and 84k.
    expect((await ui.find({ type: 'Text', text: /◉◉ 84k/ }))?.props.color).toBe('inactive')
  })

  test('while a turn runs: one line, no sprite', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START); await settleLegacyStart($,w);
    await $.turn.start({ text: 'go', turnId: 't1' })
    const ui = await $.ui.mount({ surface: 'terminal', ...band(100, true) })
    await w.clock.advance(0) // the deferred asset load must invalidate this mounted band
    expect(await ui.find({ type: 'Raster' })).toBe(undefined)
    expect(await ui.find({ type: 'Text', text: 'Coco' })).toBeDefined()
    expect((await ui.findAll({ type: 'Text' })).length).toBeLessThanOrEqual(4)
  })

  test('narrow or short terminals get the one-line band', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START); await settleLegacyStart($,w);
    const narrow = await $.ui.mount({ surface: 'terminal', ...band(TERMINAL_COLUMNS + 20) })
    expect(await narrow.find({ type: 'Raster' })).toBe(undefined)
    const short = await $.ui.mount({ surface: 'terminal', ...band(120, false, TERMINAL_ROWS - 1) })
    expect(await short.find({ type: 'Raster' })).toBe(undefined)
  })

  test('kitty and Ghostty get the picture itself', async ($, on) => {
    const w = world(on, { store: RECENT, env: { TERM: 'xterm-ghostty', TERM_PROGRAM: 'ghostty' } })
    await $.session.start(START); await settleLegacyStart($,w);
    const ui = await $.ui.mount({ surface: 'terminal', ...band(100) })
    await w.clock.advance(0) // the deferred asset load must invalidate this mounted band
    expect(await ui.find({ type: 'Image' })).toBeDefined()
  })

  test('the light built-in theme gets a darker name colour', async ($, on) => {
    // C3 round 4 item 4: theme is a /config row; settings.read never contains it.
    const w = world(on, { store: RECENT, theme: 'light' })
    await $.session.start(START); await settleLegacyStart($,w);
    const ui = await $.ui.mount({ surface: 'terminal', ...band(100) })
    await w.clock.advance(0) // the deferred asset load must invalidate this mounted band
    expect((await ui.find({ type: 'Text', text: 'Coco' }))?.props.color).toBe('#9E4123')
  })

  test('the spinner says his verb on the terminal and is left alone on the desktop', async ($, on) => {
    let word = ''
    const w = world(on, {
      store: RECENT,
      onRender: (component, props) => {
        if (component === 'Spinner') word = (props as { word: string }).word
      },
    })
    await $.session.start(START); await settleLegacyStart($,w);
    await $.prompt.submit({ text: 'go', wait: false, origin: PERSON })
    await $.turn.start({ text: 'go', turnId: 't1' })
    const spinner = { plugin: 'coco', component: 'Spinner' as const, props: { word: 'Sauteing', message: null, suffix: '…', mode: 'thinking' as const } }
    await $.ui.mount({ surface: 'terminal', ...spinner })
    expect(word).not.toBe('Sauteing')
    expect(word.length).toBeGreaterThan(0)
    await $.ui.mount({ surface: 'desktop', ...spinner, props: { ...spinner.props, word: 'Creating notes.md' } })
    expect(word).toBe('Creating notes.md')
  })
})

describe('both surfaces', () => {
  // SPEC 0.2 rules 4/5a; visual review row 3: the resting direction remains when the line fits.
  test('every mood draws a tree each surface accepts, at rest and while working', { timeoutMs: 60_000 }, async ($, on) => {
    const w = world(on, { store: RECENT, percent: 91, bashFails: () => true })
    await $.session.start(START); await settleLegacyStart($,w);
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
      expect(w.view().mood).toBe('wild')
      // On the desktop her line takes the direction's place on the script row; the direction stays in her picture's alt.
      if(surface==='terminal')expect(await ui.find({ type: 'Text', text: /\(antennae snapping straight\)/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: w.view().line?.text ?? w.view().said! })).toBeDefined()
      // the desktop names the picture it draws, the raised claw (his words, 10-18)
      if(surface==='desktop')expect(String((await desktopPicture(ui))?.props.alt)).toContain('raising the big claw')
      // the terminal plays her pixel version's moment for the mood (DECISIONS 917): one of its frames
      else expect(momentCells('wild',w.view().colors)).toContain((await ui.find({type:'Raster'}))?.props.cells)
      expect(await ui.find({ text: /182k/ })).toBeDefined()
    }
  })

  test('band off leaves only its visible wake door', {options:{band:'off'}}, async ($, on) => {
    const w = world(on, { store: { ...RECENT, band: 'off' } })
    await $.session.start(START); await settleLegacyStart($,w);
    for (const surface of ['terminal', 'desktop'] as const) {
      const off = await $.ui.mount({ surface, ...band(100) })
      expect(await off.find({ type: 'Button', key: 'coco:band:wake' })).toBeDefined()
      expect(await off.find({ type: 'Text', text: /Coco/ })).toBe(undefined)
    }
  })
})
