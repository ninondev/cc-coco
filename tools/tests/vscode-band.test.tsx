// The band on VS Code (owner 10-19): its panel has no hover and places nothing absolutely, so Poke, Pat and Close stay
// drawn as dim buttons, and a press on a thing opens its card in a row of its own above the floor; a second press or
// 6 s close it, and a quota thing's card carries the button to the quota page.
import { expect, test } from 'claude-code/testing'
import { RECENT, world, settleLegacyStart, band } from './world'
import { initialView } from '../hooks/mood'
import { desktopBand } from '../hooks/band'

declare const console: { log: (...parts: unknown[]) => void }
const nodes = (tree: unknown): { type?: string; props?: Record<string, unknown>; children?: unknown[] }[] => {
  if (!tree || typeof tree !== 'object') return []
  const node = tree as { children?: unknown[] }
  return [node as never, ...(node.children ?? []).flatMap(nodes)]
}
const words = (tree: unknown): string => {
  if (typeof tree === 'string') return tree
  if (!tree || typeof tree !== 'object') return ''
  return ((tree as { children?: unknown[] }).children ?? []).map(words).join(' ')
}

async function vscodeBand($: Parameters<Parameters<typeof test>[1]>[0], on: Parameters<Parameters<typeof test>[1]>[1]) {
  const w = world(on, { store: { ...RECENT, lang: 'en' }, engineRows: true, percent: 56,
    limits: [{ kind: 'five_hour', percentUsed: 23.5 }, { kind: 'seven_day', percentUsed: 87 }], cost: 1.84 })
  on('session.surfaces', () => ({ value: ['vscode'] }))
  await $.session.start({ cwd: '/tmp/vscode-band', surface: 'vscode', isInteractive: true }); await settleLegacyStart($, w)
  const ui = await $.ui.mount({ surface: 'vscode', ...band(80) })
  await w.clock.advance(0)
  return { w, ui }
}

test('on VS Code the buttons stay drawn and nothing is placed absolutely', { options: { language: 'en' } }, async ($, on) => {
  const { ui } = await vscodeBand($, on)
  for (const key of ['coco:band:poke', 'coco:band:pat', 'coco:band:close']) expect(await ui.find({ type: 'Button', key }), key).toBeDefined()
  expect(nodes(await ui.drawn()).filter(n => n.props?.position === 'absolute')).toEqual([])
})

test('on VS Code a press on a thing opens its card above the floor, and a second press or 6 s close it', { options: { language: 'en' } }, async ($, on) => {
  const { w, ui } = await vscodeBand($, on)
  const press = async (key: string) => { await ui.press({ key }); await w.clock.advance(0) }
  const card = async () => (await ui.findAll({ type: 'Box' })).find(b => String(b.key).startsWith('coco:thing-card:'))
  expect(await card()).toBeUndefined()
  await press('coco:thing:ctx')
  expect(words(await card())).toContain('112k')
  await press('coco:thing:ctx')
  expect(await card()).toBeUndefined()
  await press('coco:thing:ctx')
  await w.clock.advance(6000)
  expect(await card()).toBeUndefined()
})

test("on VS Code a quota thing's card opens the quota page", { options: { language: 'en' } }, async ($, on) => {
  const { w, ui } = await vscodeBand($, on)
  await ui.press({ key: 'coco:thing:quota:five_hour' }); await w.clock.advance(0)
  expect(words(await ui.find({ key: 'coco:thing-card:quota:five_hour' }))).toContain('23')
  await ui.press({ key: 'coco:thing:quota-page' }); await w.clock.advance(0)
  expect(w.opens.map(o => o.id)).toContain('coco-book')
  expect((await ui.findAll({ type: 'Box' })).some(b => String(b.key).startsWith('coco:thing-card:'))).toBe(false)
})

// Direct: the same view with the breathing light on draws it on the desktop and leaves it out on VS Code.
test('on VS Code the band leaves the breathing light out', async ($, on) => {
  const view = { ...initialView(), lang: 'en' as const, context: 56, play: { at: 1000, breath: { since: 0 } } } as never
  for (const surface of ['desktop', 'vscode'] as const) {
    on('ui.render', { component: 'Pane', requestId: 'light-' + surface }, ($, e) => desktopBand($.ui.resolve(e) as never, view, { columns: 80, isWorking: false, maxRows: 30, screenRows: 48 }, '<svg width="76" height="64"></svg>', undefined, undefined, undefined, surface === 'vscode' ? 'vscode' : false))
  }
  world(on)
  for (const surface of ['desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ surface, plugin: 'coco', component: 'Pane', requestId: 'light-' + surface, props: { title: 'Light', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } })
    const lit = JSON.stringify(await ui.drawn()).includes('@keyframes led')
    expect(lit, surface).toBe(surface === 'desktop')
    await ui.unmount()
  }
})

// The phone has no hover either (owner 10-19): the same buttons and cards. Its pictures stay pictures (whether its
// Markdown draws a picture link nobody has seen), so a thing is pressed by its words, and a thing drawn as a picture
// alone (the batteries at this width) is not pressed there.
test('on the phone the buttons stay drawn, the batteries stay pictures and a thing\'s words open its card', { options: { language: 'en' } }, async ($, on) => {
  const w = world(on, { store: { ...RECENT, lang: 'en' }, engineRows: true, percent: 56,
    limits: [{ kind: 'five_hour', percentUsed: 23.5 }, { kind: 'seven_day', percentUsed: 87 }], cost: 1.84 })
  on('session.surfaces', () => ({ value: ['mobile'] }))
  await $.session.start({ cwd: '/tmp/mobile-band', surface: 'mobile', isInteractive: true }); await settleLegacyStart($, w)
  const ui = await $.ui.mount({ surface: 'mobile', ...band(60) })
  await w.clock.advance(0)
  for (const key of ['coco:band:poke', 'coco:band:pat', 'coco:band:close', 'coco:thing:ctx']) expect(await ui.find({ type: 'Button', key }), key).toBeDefined()
  const tree = await ui.drawn()
  expect(nodes(tree).filter(n => n.props?.position === 'absolute')).toEqual([])
  expect(nodes(tree).filter(n => n.type === 'Markdown')).toEqual([])
  expect(nodes(tree).filter(n => n.type === 'Svg' && /hour|day|week/i.test(String(n.props?.alt))).length).toBe(2)
  await ui.press({ key: 'coco:thing:ctx' }); await w.clock.advance(0)
  expect(words((await ui.findAll({ type: 'Box' })).find(b => String(b.key) === 'coco:thing-card:ctx'))).toContain('112k')
})

// The battery and the power bank stay pictures on VS Code (owner 10-20: 「我希望vscode的横条上也有充电宝和电池的图片而不是
// 文字按钮」). VS Code's Markdown draws a picture as its alt text, so no picture there is a Markdown link: the pictures
// are drawn as they are, and their short names are the buttons that open their cards.
test('on VS Code the battery and the power bank are pictures, pressed by their names', { options: { language: 'en' } }, async ($, on) => {
  const { w, ui } = await vscodeBand($, on)
  const tree = await ui.drawn()
  expect(nodes(tree).filter(n => n.type === 'Markdown' && String((n as { key?: unknown }).key ?? '').startsWith('coco:thing'))).toEqual([])
  expect(nodes(tree).filter(n => n.type === 'Svg' && /hour|day|week/i.test(String(n.props?.alt))).length).toBe(2)
  for (const kind of ['five_hour', 'seven_day']) expect(await ui.find({ type: 'Button', key: 'coco:thing:quota:' + kind }), kind).toBeDefined()
  await ui.press({ key: 'coco:thing:quota:seven_day' }); await w.clock.advance(0)
  expect(words(await ui.find({ key: 'coco:thing-card:quota:seven_day' }))).toContain('87')
})
