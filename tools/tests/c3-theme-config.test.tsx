// C3 round 4 item 4: the person's theme is the real /config row and accepted config.set result.
import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { cueFor, initialView } from '../hooks/mood'
import { normalizeDesktopView } from '../hooks/desktop-safe'
import { P, PERSON, RECENT, band, settleLegacyStart, themeConfig, world } from './world'

const START = { cwd: '/tmp/c3-theme-config', surface: 'desktop' as const, isInteractive: true }

for (const theme of ['light', 'light-daltonized', 'dark', 'dark-daltonized', 'light-ansi', 'dark-ansi']) {
  test(`C3 theme ${theme} comes from the config row instead of settings.json`, async ($, on) => {
    const settings = { theme: theme.startsWith('light') ? 'dark' : 'light' }
    const config = [{ ...themeConfig('dark')[0]!, key: 'verbose', kind: 'toggle' as const, value: false }, ...themeConfig(theme)]
    const w = world(on, { settings, config, store: RECENT })
    await $.session.start(START); await settleLegacyStart($, w)
    expect(w.view().theme).toBe(theme)
    expect(w.view().cue).toBe(cueFor(theme))
  })
}

test('C3 accepted theme changes update the mounted band while settings contain no theme', async ($, on) => {
  const w = world(on, { settings: {}, config: themeConfig('dark'), store: RECENT })
  await $.session.start(START); await settleLegacyStart($, w)
  const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
  for (const theme of ['light', 'dark-ansi', 'light-daltonized', 'dark']) {
    const result = await $.config.set({ key: 'theme', value: theme })
    expect(result).toEqual({ value: theme })
    expect(w.view().theme).toBe(theme)
    expect(w.view().cue).toBe(cueFor(theme))
    await ui.redraw()
    expect((await ui.find({ type: 'Text', text: 'Coco' }))?.props.color).toBe(cueFor(theme))
  }
  await ui.unmount()
})

test('C3 denied theme changes keep the accepted row and band theme', async ($, on) => {
  on('config.*', ($, e, next) => next.is('config.set', e) && e.key === 'theme'
    ? { deny: 'fixture locked theme' } : next(e))
  const w = world(on, { config: themeConfig('dark'), store: RECENT })
  await $.session.start(START); await settleLegacyStart($, w)
  expect(await $.config.set({ key: 'theme', value: 'light' })).toEqual({ deny: 'fixture locked theme' })
  expect(w.view().theme).toBe('dark')
  expect(w.view().cue).toBe(cueFor('dark'))
})

test('C3 theme changes use the accepted config result after a downstream rewrite', async ($, on) => {
  on('config.*', ($, e, next) => next.is('config.set', e) && e.key === 'theme'
    ? next({ ...e, value: 'light' }) : next(e))
  const w = world(on, { config: themeConfig('dark'), store: RECENT })
  await $.session.start(START); await settleLegacyStart($, w)
  expect(await $.config.set({ key: 'theme', value: 'dark' })).toEqual({ value: 'light' })
  expect(w.view().theme).toBe('light')
  expect(w.view().cue).toBe(cueFor('light'))
})

for (const missing of [false, true]) test(`C3 ${missing ? 'missing' : 'nonstring'} config theme uses no raw theme name`, async ($, on) => {
  const w = world(on, { settings: { theme: 'light' }, config: missing ? [] : themeConfig(true), store: RECENT })
  await $.session.start(START); await settleLegacyStart($, w)
  expect(w.view().theme).toBeUndefined()
  expect(w.view().cue).toBe('claude')
})

test('C3 desktop view normalization retains the optional ANSI theme', () => {
  const view = initialView()
  expect(normalizeDesktopView({ ...view, theme: 'light-ansi' }, view, [view.frame]).theme).toBe('light-ansi')
  expect(normalizeDesktopView({ ...view, theme: true }, view, [view.frame]).theme).toBeUndefined()
})

test('C3 unresolved config listing does not block the first desktop frame', async ($, on) => {
  let listed = false
  const pending = new Promise<never>(() => {})
  const fixtureOn = ((event: string, ...args: unknown[]) => event === 'config.list'
    ? (on as any)(event, () => { listed = true; return pending }) : (on as any)(event, ...args)) as On
  const w = world(fixtureOn, { store: RECENT })
  await $.session.start(START)
  const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
  expect(await ui.find({ type: 'Text', text: 'Coco' })).toBeDefined()
  for (let i = 0; i < 20 && !listed; i++) await $.command.run({ command: 'b1b-host-boundary', args: '', origin: PERSON, presentation: P })
  expect(listed).toBe(true)
  expect(await ui.find({ type: 'Text', text: 'Coco' })).toBeDefined()
  expect(w.fileReads.some(path => path.endsWith('card-metrics.json'))).toBe(false)
  await ui.unmount()
})

test('C3 a late initial config snapshot cannot replace an accepted theme change', async ($, on) => {
  let release!: () => void
  let listed = false
  const held = new Promise<void>(resolve => { release = resolve })
  const fixtureOn = ((event: string, ...args: unknown[]) => event === 'config.list'
    ? (on as any)(event, async () => { listed = true; await held; return { value: themeConfig('dark') } })
    : (on as any)(event, ...args)) as On
  const w = world(fixtureOn, { store: RECENT })
  await $.session.start(START)
  try {
    for (let i = 0; i < 20 && !listed; i++) await $.command.run({ command: 'b1b-host-boundary', args: '', origin: PERSON, presentation: P })
    expect(listed).toBe(true)
    await $.config.set({ key: 'theme', value: 'light' })
    expect(w.view().theme).toBe('light')
  } finally { release() }
  await settleLegacyStart($, w)
  expect(w.view().theme).toBe('light')
  expect(w.view().cue).toBe(cueFor('light'))
})

// The omen card's theme test (each lazy save reads the current config theme) left with the card on 10-15; it comes back
// with her vibe check's share card.
