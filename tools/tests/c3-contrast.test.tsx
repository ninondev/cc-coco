// Owner's final high-contrast design, C3 round 4 items 4–5: host palette, readable controls and cream paper.
import { expect, test } from 'claude-code/testing'
import { initialView, cueFor } from '../hooks/mood'
import { desktopBand, desktopDoor, terminalBand, terminalDoor } from '../hooks/band'
import { offeringSvg } from '../hooks/pictures-lazy'
import { WORDS, quotaDetailGroups } from '../hooks/words'
import { world } from './world'
import type { CocoView } from '../types'

const size = { columns: 200, maxRows: 30, screenRows: 48, isWorking: false }
const sprite = '<svg xmlns="http://www.w3.org/2000/svg" width="73" height="64"></svg>'
function nodes(tree: unknown): any[] {
  if (!tree || typeof tree !== 'object') return []
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  const node = tree as any
  return [node, ...(node.children ?? []).flatMap(nodes)]
}
function pane(id: string, surface: 'terminal' | 'desktop') {
  return { surface, plugin: 'coco', component: 'Pane' as const, requestId: id,
    props: { title: 'Contrast fixture', isFocused: true, bodyColumns: size.columns,
      placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} } }
}

test('name cue obeys exact built-in palette choices, including ANSI and unknown themes', () => {
  for (const theme of ['light', 'light-daltonized', 'light-ansi', 'dark-ansi', 'dark', 'dark-daltonized', 'auto', 'light-custom', undefined]) {
    expect(cueFor(theme)).toBe(theme === 'light' || theme === 'light-daltonized' ? '#9E4123' : 'claude')
  }
})

test('both ANSI themes use host text colours on both surfaces', async ($, on) => {
    let view: CocoView = initialView()
    const id = 'c3-ansi-chip'
    on('ui.render', { component: 'Pane', requestId: id }, ($, e) => e.surface === 'terminal'
      ? terminalBand($.ui.resolve(e), view, size)
      : e.surface === 'desktop' ? desktopBand($.ui.resolve(e), view, size, sprite) : null)
    world(on)
    // The direct renderer uses the same first-use picture preparation as its lifecycle caller.
    for (const theme of ['light-ansi', 'dark-ansi']) for (const surface of ['terminal', 'desktop'] as const) {
    view = { ...view, theme, cue: cueFor(theme) }
    expect(view.cue).toBe('claude')
    const ui = await $.ui.mount(pane(id, surface))
    const text = nodes(await ui.drawn()).filter(n => n.type === 'Text')
    for (const node of text) {
      expect(String(node.props?.color ?? '').startsWith('#')).toBe(false)
      expect(String(node.props?.backgroundColor ?? '').startsWith('#')).toBe(false)
    }
    await ui.unmount()
    }
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: the name uses its selected cue, readable groups use inactive, Book and Wake have no dim or colour`, async ($, on) => {
    const limits = [{ kind: 'five_hour', percentUsed: 42 }, { kind: 'seven_day', percentUsed: 23 }]
    const view: CocoView = { ...initialView(), theme: 'light', cue: cueFor('light'), context: 56,
      quota: { rateLimits: limits, tokens: 123, costUSD: 0.03, at: 0 }, neighbours: true,
      neighbourLights: { v: 1, running: true, agents: [{ id: 'a', label: 'Neighbour', busy: true, partial: false,
        quota: { primary: { usedPercent: 17 } } }] } }
    let door = false
    const id = 'c3-readable-controls'
    on('ui.render', { component: 'Pane', requestId: id }, ($, e) => {
      if (e.surface === 'terminal') return door ? terminalDoor($.ui.resolve(e), view, () => {}) : terminalBand($.ui.resolve(e), view, size)
      if (e.surface === 'desktop') return door ? desktopDoor($.ui.resolve(e), view, () => {}) : desktopBand($.ui.resolve(e), view, size, sprite)
      return null
    })
    world(on)
    const ui = await $.ui.mount(pane(id, surface))
    expect((await ui.find({ type: 'Text', text: WORDS.en.name }))?.props.color).toBe('#9E4123')
    const book = await ui.find({ type: 'Button', key: 'coco:book:open' })
    expect(book).toBeDefined()
    expect(book?.props.dimColor).toBeUndefined()
    expect(book?.props.color).toBeUndefined()
    const text = nodes(await ui.drawn()).filter(n => n.type === 'Text')
    // The band shows a plan's dollars only with an API-price qualifier (W5), so its groups are the quota windows alone.
    const expected = surface === 'terminal' ? ['5h ', ' 58%', 'week ', ' 77%'] : quotaDetailGroups('en', limits, 123, undefined, false, 0).slice(0, limits.length)
    expect(text.some(node => (node.children ?? []).join('').includes('$'))).toBe(false)
    // The desktop's groups are its cards (10-18): the name and number semibold, the rest in inactive; never dim.
    if (surface === 'desktop') {
      const cards = text.filter(node => node.props?.size === 'caption')
      for (const group of expected) expect(cards.some(node => group.startsWith((node.children ?? []).join('')))).toBe(true)
      for (const node of cards) {
        expect(node.props.dimColor).toBeUndefined()
        expect(node.props.weight === 'semibold' || node.props.color === 'inactive').toBe(true)
      }
    }
    for (const group of surface === 'desktop' ? [] : expected) {
      const found = text.find(node => (node.children ?? []).join('') === group)
      expect(found).toBeDefined()
      expect(found?.props.color).toBe('inactive')
      expect(found?.props.dimColor).toBeUndefined()
    }
    // The terminal's four cells carry the pictures' colours (lane C, 10-14): blue while there is plenty, coral at a quarter or less.
    if (surface === 'terminal') for (const [cells, colour] of [['▮▮▯▯', 'suggestion'], ['▮▮▮▯', 'suggestion']] as const) {
      const found = text.find(node => (node.children ?? []).join('') === cells)
      expect(found?.props.color).toBe(colour)
    }
    // on the desktop the neighbour's name is in its card, held above
    const neighbourText = text.filter(node => node.props?.size !== 'caption' && (node.children ?? []).join('').includes('Neighbour'))
    if (surface === 'desktop') expect(text.some(node => node.props?.size === 'caption' && (node.children ?? []).join('').includes('Neighbour'))).toBe(true)
    else expect(neighbourText.length).toBeGreaterThan(0)
    for (const group of neighbourText) {
      expect(group.props.color).toBe('inactive')
      expect(group.props.dimColor).toBeUndefined()
    }
    if (surface === 'terminal') {
      // SPEC 8.1 keeps the busy dot warning-coloured; R4 item 5 makes its readable name inactive.
      const dots = text.filter(node => (node.children ?? []).join('') === '●')
      expect(dots.length).toBe(1)
      expect(dots[0]?.props.color).toBe('warning')
    }
    await ui.unmount()
    door = true
    const off = await $.ui.mount(pane(id, surface))
    const wake = await off.find({ type: 'Button', key: 'coco:band:wake' })
    expect(wake).toBeDefined()
    expect(wake?.props.dimColor).toBeUndefined()
    expect(wake?.props.color).toBeUndefined()
  })
}

test('offering paper stays cream below, at and above both warning thresholds in every picture variant', () => {
  for (const percent of [0, 84, 85, 94, 95, 100]) {
    const level = Math.round(9 * percent / 100)
    for (const fixed of [false, true]) {
      const svg = offeringSvg(percent, fixed)
      expect(svg).toContain(`<rect x="4" y="${16 - level}" width="12" height="${level}" fill="#FAEEE9"/>`)
      expect(svg).toContain('fill="#AA5E47"')
    }
  }
})

for (const surface of ['terminal', 'desktop'] as const) {
    test(`${surface}: the commit line keeps the warning thresholds, accessible numbers and full-colour Book`, async ($, on) => {
      const view = initialView()
      const id = 'c3-offering-contrast'
      on('ui.render', { component: 'Pane', requestId: id }, ($, e) => e.surface === 'terminal'
        ? terminalBand($.ui.resolve(e), view, size)
        : e.surface === 'desktop' ? desktopBand($.ui.resolve(e), view, size, sprite) : null)
      world(on)
      for (const percent of [84, 85, 94, 95, 100]) {
      view.context = percent
      const ui = await $.ui.mount(pane(id, surface))
      const book = await ui.find({ type: 'Button', key: 'coco:book:open' })
      expect(book).toBeDefined()
      expect(book?.props.dimColor).toBeUndefined()
      expect(book?.props.color).toBeUndefined()
      const value = await ui.find({ type: 'Text', text: new RegExp(`${percent}%`) })
      expect(value).toBeDefined()
      expect(value?.props.color).toBe(percent >= 95 ? 'error' : percent >= 85 ? 'warning' : 'inactive')
      if (surface === 'desktop') {
        const line = nodes(await ui.drawn()).find(n => n.type === 'Svg' && n.props?.width === 50 && n.props?.height === 9)
        expect(line?.props.alt).toBe(`context window, ${percent}% full`)
        expect(line?.props.source).toContain('fill="#D97757"')
      }
      await ui.unmount()
      }
    })
}
