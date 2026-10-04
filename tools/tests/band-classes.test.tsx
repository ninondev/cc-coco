// Actual band hooks, held engine clock: no unrelated event may make style or door correct.
import { describe, expect, test } from 'claude-code/testing'
import { planDesktop, rowsOf } from '../hooks/band'
import { P, PERSON, RECENT, band, desktopPicture, world } from './world'

const START = { cwd: '/tmp/project', surface: 'desktop' as const, isInteractive: true }
const WAKE = 'claudesama:band:wake'

function dimensions(source: unknown): [number, number] {
  const data = /data:image\/png;base64,([A-Za-z0-9+/=]+)/.exec(String(source))
  expect(data).not.toBe(null)
  const bytes = atob(data?.[1] ?? '')
  const n = (offset: number) => ((bytes.charCodeAt(offset) << 24) | (bytes.charCodeAt(offset + 1) << 16) | (bytes.charCodeAt(offset + 2) << 8) | bytes.charCodeAt(offset + 3)) >>> 0
  return [n(16), n(20)]
}

describe('style follows choice at every desktop size', () => {
  for (const chosen of ['on', 'compact'] as const) {
    for (const state of ['rest', 'working', 'short', 'narrow'] as const) {
      test(`${chosen}: ${state} first draw needs no asset read`, async ($, on) => {
        const w = world(on, { store: { ...RECENT, band: chosen } })
        await $.session.start(START)
        const columns = state === 'narrow' ? Array.from({ length: 90 }, (_, i) => i + 24).find(columns => planDesktop(w.view(), { columns, maxRows: 30, screenRows: 48, isWorking: false }).height === 32) ?? 48 : 100
        const ui = await $.ui.mount({ surface: 'desktop', ...band(columns, state === 'working', state === 'short' ? 3 : 30) })
        const sprite = await desktopPicture(ui)
        expect(sprite).toBeDefined()
        expect(String(sprite?.props.alt).startsWith('Claude-sama,')).toBe(true)
        expect(dimensions(sprite?.props.source)).toEqual(chosen === 'compact' ? [35, 32] : [137, 128])
        expect(String(sprite?.props.source).includes('image-rendering:pixelated')).toBe(chosen === 'compact')
        expect(w.fileReads.filter(path => /[\\/]assets[\\/]/.test(path))).toEqual([])
      })
    }
  }
})

describe('Off keeps an on-screen way back', () => {
  for (const surface of ['desktop', 'terminal'] as const) {
    for (const previous of ['on', 'compact'] as const) {
      test(`${surface}: door wakes exact ${previous} choice without a clock tick`, async ($, on) => {
        const w = world(on, { store: { ...RECENT, band: previous }, percent: 42 })
        await $.session.start({ ...START, surface })
        const ui = await $.ui.mount({ surface, ...band(100) })
        await $.command.run({ command: 'claudesama', args: 'band off', origin: PERSON, presentation: P })
        const wake = await ui.find({ type: 'Button', key: WAKE })
        expect(wake?.props.label).toBe('Wake him')
        expect(wake?.props.plain).toBe(true)
        expect(wake?.props.dimColor).toBe(true)
        expect(await ui.find({ type: 'Button', key: 'claudesama:book:open' })).toBe(undefined)
        expect(await ui.find({ type: 'Text', text: /42%|training/ })).toBe(undefined)
        if (surface === 'desktop') {
          const head = await desktopPicture(ui)
          expect(head).toBeDefined()
          expect(head?.props.alt).toBe('claude-sama, asleep')
          expect(dimensions(head?.props.source)).toEqual(previous === 'compact' ? [35, 32] : [137, 128])
          expect((await ui.findAll({ type: 'Svg' })).length).toBe(1)
        } else {
          expect(rowsOf(await ui.drawn())).toBe(1)
          const head = await ui.find({ type: 'Raster', key: 'claudesama:door:sleep' })
          expect(head?.props.columns).toBe(8)
          expect(head?.props.rows).toBe(1)
          expect(atob(String(head?.props.cells)).length).toBe(8 * 12)
        }
        const before = await ui.drawn()
        await w.clock.advance(60_000)
        expect(await ui.drawn()).toEqual(before)
        await ui.press({ key: WAKE })
        expect(w.view().band).toBe(previous)
        expect(await ui.find({ type: 'Button', key: WAKE })).toBe(undefined)
        expect(await ui.find({ type: 'Button', key: 'claudesama:book:open' })).toBeDefined()
        await ui.press({ key: 'claudesama:book:open' })
        expect(w.opens.some(open => open.id === 'claudesama-book')).toBe(true)
      })
    }
  }
})

describe('terminal recovery reaches the book without a command', () => {
  for (const compact of [false, true]) {
    test(`${compact ? 'one line' : 'full'} keeps a visible pressable book`, async ($, on) => {
      const w = world(on, { store: { ...RECENT, band: compact ? 'compact' : 'on' } })
      await $.session.start({ ...START, surface: 'terminal' })
      const ui = await $.ui.mount({ surface: 'terminal', ...band(100) })
      const book = await ui.find({ type: 'Button', key: 'claudesama:book:open' })
      expect(book).toBeDefined()
      expect(book?.props.plain).toBe(true)
      expect(book?.props.dimColor).toBe(true)
      await ui.press({ key: 'claudesama:book:open' })
      expect(w.opens.some(open => open.id === 'claudesama-book')).toBe(true)
    })
  }
})
