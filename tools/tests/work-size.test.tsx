// Painted may keep its resting geometry while Claude works. The choice affects the first
// redraw, persists in the plugin store, and never adds a timer or a terminal-only setting.
import { describe, expect, test } from 'claude-code/testing'
import { desktopHeight, planDesktop, terminalHasSprite } from '../hooks/band'
import { initialView } from '../hooks/mood'
import { DESKTOP_COMPACT, DESKTOP_REST } from '../hooks/pictures'
import { LANGS, WORDS } from '../hooks/words'
import { BOOK_FILES } from './book-files'
import { P, PERSON, RECENT, band, desktopPicture, world } from './world'

const START = { cwd: '/tmp/project', surface: 'desktop' as const, isInteractive: true }
const PANE = {
  plugin: 'claudesama', component: 'Pane' as const, requestId: 'claudesama-book',
  props: { title: 'Claude-sama', isFocused: false, bodyColumns: 64, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}
const SAME = 'claudesama:set:workSize:same'
const SMALLER = 'claudesama:set:workSize:smaller'
const size = (columns: number, isWorking = false, maxRows = 30) => ({ columns, isWorking, maxRows, screenRows: 48 })

function geometry(plan: ReturnType<typeof planDesktop>) {
  const { text, ...layout } = plan
  return layout
}

async function pictureHeight(ui: { find: (query: { type: string; key?: string }) => Promise<any> }) {
  return (await desktopPicture(ui))?.props.height
}

describe('Painted work size', () => {
  test('every language supplies just the label and two choices', () => {
    for (const { code } of LANGS) {
      const words = JSON.parse(BOOK_FILES[`${code}.json`] ?? 'null').settings.workSize
      expect(Object.keys(words).sort()).toEqual(['label', 'same', 'smaller'])
      expect(Object.values(words).every(word => typeof word === 'string' && word.length > 0)).toBe(true)
    }
    for (const [lang, expected] of [
      ['en', { label: 'While Claude works', same: 'Same size', smaller: 'Smaller' }],
      ['zh', { label: 'Claude干活时', same: '不缩小', smaller: '缩小' }],
      ['ja', { label: 'Claudeの作業中', same: 'そのまま', smaller: '小さく' }],
    ] as const) expect(JSON.parse(BOOK_FILES[`${lang}.json`] ?? 'null').settings.workSize).toEqual(expected)
  })

  test('Same size is the default; absent legacy values also keep the resting picture', () => {
    expect(initialView().workSize).toBe('same')
    for (const workSize of [undefined, 'same', 'smaller'] as const) {
      const view = { ...initialView(), workSize }
      expect(desktopHeight(view, size(100))).toBe(DESKTOP_REST)
      expect(desktopHeight(view, size(100, true))).toBe(workSize === 'smaller' ? DESKTOP_COMPACT : DESKTOP_REST)
      expect(desktopHeight(view, size(100, true, 3))).toBe(DESKTOP_COMPACT)
      expect(desktopHeight({ ...view, band: 'compact' }, size(100, true))).toBe(DESKTOP_COMPACT)
      expect(terminalHasSprite(view, size(100, true))).toBe(false)
      expect(planDesktop(view, size(100, true)).row).toBe(workSize === 'smaller')
    }
  })

  test('Same size keeps all layout slots across working moods and direction widths', { timeoutMs: 60_000 }, () => {
    for (const { code: lang } of LANGS) {
      for (let columns = 24; columns <= 180; columns += 1) {
        for (const maxRows of [3, 30]) {
          const rest = { ...initialView(), lang, context: 72 }
          const before = geometry(planDesktop(rest, size(columns, false, maxRows)))
          for (const mood of ['think', 'work', 'waiting', 'error', 'wild'] as const) {
            const after = geometry(planDesktop({ ...rest, mood }, size(columns, true, maxRows)))
            expect(after, `${lang} ${columns} columns, ${maxRows} rows, ${mood}`).toEqual(before)
            if (columns === 180 && maxRows === 30) expect(planDesktop({ ...rest, mood }, size(columns, true, maxRows)).text).toBe(WORDS[lang].aside[mood])
          }
        }
      }
    }
  })

  test('clearing an ordinary spoken line keeps the resting slots when a prompt arrives', () => {
    for (const { code: lang } of LANGS) {
      for (let columns = 60; columns <= 180; columns += 1) {
        const rest = { ...initialView(), lang, context: 72, said: 'ok' }
        expect(geometry(planDesktop({ ...rest, mood: 'think', said: null }, size(columns, true))))
          .toEqual(geometry(planDesktop(rest, size(columns))))
      }
    }
  })

  for (const stored of [undefined, 'same', 'smaller', 'invalid'] as const) {
    test(`stored ${String(stored)} applies on the first working draw`, async ($, on) => {
      const w = world(on, { store: { ...RECENT, workSize: stored }, settings: { prefersReducedMotion: true } })
      await $.session.start(START)
      await $.turn.start({ text: 'go', turnId: 'work-size' })
      const strip = await $.ui.mount({ surface: 'desktop', ...band(100, true) })
      expect(w.view().workSize).toBe(stored === 'smaller' ? 'smaller' : 'same')
      expect(await pictureHeight(strip)).toBe(stored === 'smaller' ? DESKTOP_COMPACT : DESKTOP_REST)
      expect(w.fileReads.filter(path => /[\\/]assets[\\/]/.test(path))).toEqual([])
    })
  }

  test('a book press changes the mounted working band and selection without a clock tick', async ($, on) => {
    let persisted: unknown
    on('store.set', { key: 'workSize' }, ($, e, next) => { persisted = e.value; return next(e) })
    const w = world(on, { store: RECENT, settings: { prefersReducedMotion: true } })
    await $.session.start(START)
    await $.turn.start({ text: 'go', turnId: 'work-size' })
    const strip = await $.ui.mount({ surface: 'desktop', ...band(100, true) })
    await $.command.run({ command: 'claudesama', args: 'settings', origin: PERSON, presentation: P })
    const book = await $.ui.mount({ surface: 'desktop', ...PANE })
    expect((await book.find({ type: 'Button', key: SAME }))?.props.variant).toBe('primary')
    expect(await pictureHeight(strip)).toBe(DESKTOP_REST)
    for (const [key, chosen, height] of [[SMALLER, 'smaller', DESKTOP_COMPACT], [SAME, 'same', DESKTOP_REST]] as const) {
      await book.press({ key })
      expect(w.view().workSize).toBe(chosen)
      expect(persisted).toBe(chosen)
      expect(await pictureHeight(strip)).toBe(height)
      expect((await book.find({ type: 'Button', key }))?.props.variant).toBe('primary')
    }
  })

  test('only a Painted desktop book shows the choice; hidden choices retain the preference', async ($, on) => {
    const writes: unknown[] = []
    on('store.set', { key: 'workSize' }, ($, e, next) => { writes.push(e.value); return next(e) })
    const w = world(on, { store: { ...RECENT, workSize: 'smaller' }, settings: { prefersReducedMotion: true } })
    await $.session.start(START)
    await $.command.run({ command: 'claudesama', args: 'settings', origin: PERSON, presentation: P })
    const book = await $.ui.mount({ surface: 'desktop', ...PANE })
    expect(await book.find({ type: 'Button', key: SMALLER })).toBeDefined()
    for (const chosen of ['compact', 'off', 'on'] as const) {
      await book.press({ key: `claudesama:set:band:${chosen}` })
      expect(w.view().workSize).toBe('smaller')
      expect(writes).toEqual([])
      if (chosen === 'on') expect(await book.find({ type: 'Button', key: SMALLER })).toBeDefined()
      else expect(await book.find({ type: 'Button', key: SMALLER })).toBeUndefined()
    }
    const terminal = await $.ui.mount({ surface: 'terminal', ...PANE })
    expect(await terminal.find({ type: 'Button', key: SAME })).toBeUndefined()
    expect(await terminal.find({ type: 'Button', key: SMALLER })).toBeUndefined()
  })

  for (const [key, before, chosen] of [
    ['band', 'on', 'compact'], ['voice', 'light', 'full'],
    ['affection', 'warm', 'clingy'], ['workSize', 'same', 'smaller'],
  ] as const) {
    test(`${key}: the first invalidation and mounted label use the applied choice while persistence stays old`, async ($, on) => {
      let recording = false
      let first: { view: unknown; stored: unknown } | undefined
      let storedRead: unknown
      on('store.set', { key }, () => ({ deny: 'test keeps the old stored choice' } as never))
      on('store.get', { key }, async ($, e, next) => {
        const read = await next(e)
        storedRead = 'value' in read ? read.value : undefined
        return read
      })
      on('ui.invalidate', ($, e, next) => {
        if (recording && first === undefined) first = { view: w.view()[key], stored: storedRead }
        return next(e)
      })
      const w = world(on, { store: { ...RECENT, [key]: before }, settings: { prefersReducedMotion: true } })
      await $.session.start(START)
      await $.command.run({ command: 'claudesama', args: 'settings', origin: PERSON, presentation: P })
      const book = await $.ui.mount({ surface: 'desktop', ...PANE })
      recording = true
      const element = `claudesama:set:${key}:${chosen}`
      await book.press({ key: element })
      expect((await book.find({ type: 'Button', key: element }))?.props.variant).toBe('primary')
      expect(first).toEqual({ view: chosen, stored: before })
    })
  }
})
