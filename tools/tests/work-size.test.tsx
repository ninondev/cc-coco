// The painted band keeps its resting geometry while Claude works. Since 10-19 (owner) the desktop band never shrinks and the
// bag has no work-size choice; the geometry for a stored 'same' and the first-redraw rule for the bag's choices stay checked.
import { describe, expect, test } from 'claude-code/testing'
import { desktopHeight, planDesktop, terminalHasSprite } from '../hooks/band'
import { initialView } from '../hooks/mood'
import { DESKTOP_COMPACT, DESKTOP_REST } from '../hooks/pictures-lazy'
import { LANGS, WORDS } from '../hooks/words'
import { settleLegacyStart, P, PERSON, RECENT, band, desktopPicture, world } from './world'

const START = { cwd: '/tmp/project', surface: 'desktop' as const, isInteractive: true }
const PANE = {
  plugin: 'coco', component: 'Pane' as const, requestId: 'coco-book',
  props: { title: 'Coco', isFocused: false, bodyColumns: 64, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}
const size = (columns: number, isWorking = false, maxRows = 30) => ({ columns, isWorking, maxRows, screenRows: 48 })

function geometry(plan: ReturnType<typeof planDesktop>) {
  // B1c's fixed slot may drop or shorten text; physical picture/row geometry stays fixed.
  return { height: plan.height, row: plan.row, slip: plan.slip }
}

async function pictureHeight(ui: { find: (query: { type: string; key?: string }) => Promise<any> }) {
  return (await desktopPicture(ui))?.props.height
}

describe('Painted work size', () => {
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

  test('Same size keeps fixed picture and text-row geometry across working moods and direction widths', { timeoutMs: 60_000 }, () => {
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
    // the desktop band never shrinks (owner 10-19): every stored value draws the resting size on the first working draw
    test(`stored ${String(stored)} draws the resting size on the first working draw`, async ($, on) => {
      const w = world(on, { store: { ...RECENT, workSize: stored }, settings: { prefersReducedMotion: true } })
      await $.session.start(START); await settleLegacyStart($,w);
      await $.turn.start({ text: 'go', turnId: 'work-size' })
      const strip = await $.ui.mount({ surface: 'desktop', ...band(100, true) })
      expect(w.view().workSize).toBe('same')
      expect(await pictureHeight(strip)).toBe(DESKTOP_REST)
      // Coco's band data (assets/coco) is the picture worker's own read, not a frame asset
      expect(w.fileReads.filter(path => /[\\/]assets[\\/]/.test(path) && !/[\\/]assets[\\/]coco[\\/]/.test(path))).toEqual([])
    })
  }

  // the desktop bag has no band or work-size row since 10-19 (owner), so its two remaining choices are checked
  for (const [key, before, chosen] of [['voice', 'light', 'full'], ['affection', 'warm', 'clingy']] as const) {
    test(`${key}: the first subscriber publication or fallback redraw and mounted label use the applied choice while persistence stays old`, async ($, on) => {
      let recording = false
      let first: { view: unknown; stored: unknown } | undefined
      let firstSeen = false
      let storedRead: unknown
      let mountedBook: any
      const element = `coco:set:${key}:${chosen}`
      on('store.set', { key:'bandSettings' }, () => ({ deny: 'test keeps the old stored choice' } as never))
      on('store.get', { key:'bandSettings' }, async ($, e, next) => {
        const read = await next(e)
        storedRead = 'value' in read ? (read.value as Record<string,unknown>)[key] : undefined
        return read
      })
      on('ui.invalidate', async ($, e, next) => {
        const capture = recording && !firstSeen
        if (capture) firstSeen = true
        const oldStored = storedRead
        const result = await next(e)
        if (capture) {
          const selected = await mountedBook.find({ type:'Button', key:element })
          first = { view: selected?.props.variant === 'primary' ? chosen : before, stored:oldStored }
        }
        return result
      })
      on('state.set', { plugin: 'coco', key: 'book' }, async ($, e, next) => {
        const result = await next(e)
        if (result.value?.isSet && recording && first === undefined) first = { view: w.view()[key], stored: storedRead }
        return result
      })
      const w = world(on, { store: { ...RECENT, [key]: before }, settings: { prefersReducedMotion: true } })
      await $.session.start(START); await settleLegacyStart($,w);
      await $.command.run({ command: 'coco', args: 'settings', origin: PERSON, presentation: P })
      const book = await $.ui.mount({ surface: 'desktop', ...PANE })
      mountedBook = book
      recording = true
      await book.press({ key: element })
      expect((await book.find({ type: 'Button', key: element }))?.props.variant).toBe('primary')
      expect(first).toEqual({ view: chosen, stored: before })
    })
  }
})
