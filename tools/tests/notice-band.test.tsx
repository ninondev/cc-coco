// NOTICES in the band: Shiori's place (desktop marker, terminal words), the stuck note leaving the terminal
// band under 40 columns, a reaction's stage direction, and the pictures dressed for the night lamp, the rain
// and the reading glasses. The band functions are drawn straight from a view, as the layout tests do.
import { expect, test } from 'claude-code/testing'
import { costumedView, desktopBand, planDesktop, terminalBand } from '../hooks/band'
import { dressPicture, lampLayer, placeSvg, rainLayer, slipIconSvg } from '../hooks/notice-art'
import { initialView } from '../hooks/mood'
import { WORDS } from '../hooks/words'
import { RECENT, band, desktopPicture, settleLegacyStart, world } from './world'
// A painted picture on the old band's canvas, one group per frame: the old stills left with his go of 10-16
// (DECISIONS 947), and dressPicture still dresses that canvas when it is given one.
const painted = (names: string[]) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 0 159 128" width="79.5" height="64">${names.map(name => `<g data-frame="${name}" class="mol0"><image data-name="${name}" x="0" y="0" width="151" height="128" href="data:image/png;base64,QUJD"/></g>`).join('')}</svg>`

const walk = (node: unknown): any[] => Array.isArray(node) ? node.flatMap(walk) : !node || typeof node !== 'object' ? [] : [node, ...((node as any).children ?? []).flatMap(walk)]
const strings = (node: any): string[] => typeof node === 'string' ? [node] : Array.isArray(node) ? node.flatMap(strings) : node && typeof node === 'object' ? (node.children ?? []).flatMap(strings) : []
const size = (columns: number, working = false) => ({ columns, maxRows: 30, screenRows: 48, isWorking: working })
const PLACE = { i: 3, n: 7, subject: 'add tests for the parser', dip: 0, short: 'task 3/7', text: '3 of 7', alt: 'Shiori marks task 3 of 7: add tests for the parser' }
const base = { ...initialView(), lang: 'en' as const, context: 34, band: 'on' as const }
const PLAN_PARTS = ['word', 'aside', 'text', 'name', 'frame', 'place', 'helpers', 'neighbours', 'showRight', 'showButton', 'speech', 'lineRows', 'rightGap'] as const

let current: (ui: any) => any = () => null
// The fixture's own Pane hook goes first so it sits above the test world's, which answers every Pane.
async function prepare(on: any) {
  on('ui.render', { component: 'Pane' }, ($: any, e: any) => current($.ui.resolve(e)))
  world(on)
}

async function draw($: any, _on: any, surface: 'desktop' | 'terminal', make: (ui: any) => any) {
  current = make
  const ui = await $.ui.mount({ surface, plugin: 'coco', component: 'Pane', props: { title: 'fixture', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } })
  const tree = await ui.drawn()
  await ui.unmount()
  return tree
}

test('NT place: the desktop marker stands before the offering when the band keeps everything else whole', async ($, on) => {
  await prepare(on)
  const view = { ...base, place: PLACE }
  const plan = planDesktop(view, size(100))
  expect(plan.marker).toBe(true)
  const without = planDesktop(base, size(100))
  for (const part of PLAN_PARTS) expect([part, plan[part]]).toEqual([part, without[part]])
  const tree = await draw($, on, 'desktop', ui => desktopBand(ui, view, size(100), '<svg xmlns="http://www.w3.org/2000/svg" width="68" height="64"><path d="M0 0h1"/></svg>', plan))
  const nodes = walk(tree)
  const place = nodes.find(n => n.props?.key === 'coco:place')!
  expect(strings(place)).toEqual([' 3 of 7'])
  const svg = place.children.find((n: any) => n.type === 'Svg')
  expect(svg.props).toMatchObject({ width: 16, height: 22, alt: PLACE.alt })
  expect(String(svg.props.source)).toContain('forced-color-adjust:none')
  expect(String(svg.props.source)).toContain('prefers-contrast:more')
  // The right block order: the marker, then the offering box (the first sibling after it holds the percentage).
  const right = nodes.find(n => n.type === 'Box' && n.children?.includes(place))!
  const at = right.children.indexOf(place)
  expect(strings(right.children[at + 1]).join('')).toContain('34%')
})

test('NT place: it is the first thing to yield, and only it', () => {
  const view = { ...base, place: PLACE }
  let yielded = 0
  for (let columns = 120; columns >= 20; columns -= 1) {
    const plan = planDesktop(view, size(columns)), without = planDesktop(base, size(columns))
    if (!plan.marker) { yielded++; for (const part of PLAN_PARTS) expect([columns, part, plan[part]]).toEqual([columns, part, without[part]]) }
  }
  expect(yielded).toBeGreaterThan(0)
  // Wide enough that no other part had to give way: it stands; narrow enough that something would have: it is gone.
  expect(planDesktop(view, size(120)).marker).toBe(true)
  expect(planDesktop(view, size(24)).marker).toBeUndefined()
})

test('NT place: the picture changes with each task done, and the first one rises in', () => {
  const first = placeSvg(0), next = placeSvg(1), again = placeSvg(2)
  expect(first).toContain('@keyframes cs-u')
  expect(next).toContain('@keyframes cs-pa')
  expect(again).toContain('@keyframes cs-pb')
  expect(next).not.toBe(again)
  for (const source of [first, next]) {
    expect(source).toContain('width="16" height="22"')
    expect(source).toContain('prefers-reduced-motion')
    expect(source).toContain('forced-color-adjust:none')
    expect(source).toContain('prefers-color-scheme:dark')
  }
  expect(slipIconSvg()).toContain('width="10" height="16"')
})

test('NT place: the terminal says «task 3/7» before the offering and drops it first', async ($, on) => {
  await prepare(on)
  const view = { ...base, place: PLACE }
  const row = (columns: number, v = view) => draw($, on, 'terminal', ui => terminalBand(ui, v, size(columns)))
  const wide = strings(await row(100)).join('')
  expect(wide).toContain('task 3/7')
  expect(wide.indexOf('task 3/7')).toBeLessThan(wide.indexOf('◉'))
  const without = strings(await row(100, base)).join('')
  expect(without).not.toContain('task 3/7')
  // Narrow: everything else stays and only the place goes.
  // (No unknown-cost dash fills the row any more, BAND F1, and since 10-14 the name is short and Settings a gear, so the
  // place gives way narrower than it once did: the first width from 50 down where it is left out.)
  let narrow = 50, squeezed = strings(await row(narrow)).join('')
  while (squeezed.includes('task 3/7') && narrow > 30) squeezed = strings(await row(--narrow)).join('')
  expect([narrow, squeezed.includes('task 3/7')]).toEqual([narrow, false])
  expect(squeezed).toBe(strings(await row(narrow, base)).join(''))
})

test('NT stuck: the note leaves the terminal band under 40 columns and stays at 40 and more', async ($, on) => {
  await prepare(on)
  const line = { id: 'n', key: 'stuck.circle', text: 'Claude opened parser.ts 4 times in 12 minutes, unchanged.', class: 1 as const, expiresAt: Infinity, button: { key: 'coco:stuck:off:circle', label: 'stop these' } }
  const view = { ...base, line }
  const wide = await draw($, on, 'terminal', ui => terminalBand(ui, view, size(100)))
  expect(strings(wide).join('')).toContain('parser.ts')
  expect(walk(wide).some(n => n.props?.label === 'stop these')).toBe(true)
  const narrow = await draw($, on, 'terminal', ui => terminalBand(ui, view, size(39)))
  const quiet = await draw($, on, 'terminal', ui => terminalBand(ui, base, size(39)))
  expect(strings(narrow)).toEqual(strings(quiet))
  expect(walk(narrow).some(n => n.props?.label === 'stop these')).toBe(false)
  expect(strings(narrow).join('')).toContain(WORDS.en.name)
})

test('NT costume: a reaction gives him its stage direction, the loosened bow first', async ($, on) => {
  await prepare(on)
  const aside = async (v: any) => strings(await draw($, on, 'terminal', ui => terminalBand(ui, v, size(100)))).join('')
  expect(await aside({ ...base, costumeDirection: '(paper lamp on)' })).toContain('(paper lamp on)')
  expect(await aside({ ...base, costumeDirection: '(bow loosened)', stageDirection: '(shiori bringing a scroll)' })).toContain('(shiori bringing a scroll)')
  expect(await aside(base)).not.toContain('(paper lamp on)')
})

// DECISIONS 1017: the desktop has no rain pane any more; a command left running past a minute is her coffee there, and
// her coffee picture names itself. On the desktop the words follow her picture (owner 10-18): no coffee while she types,
// no glasses she does not wear, the clip in her hand only while she takes it off.
test('NT costume: a long command says rain in the terminal; the desktop names only what her picture shows', () => {
  const view = { ...initialView(), mood: 'work' as const, costume: { rain: true as const } }
  expect(costumedView(view, 12, true, key => key).costumeDirection).toBe('aside.rain')
  expect(costumedView(view, 12, true, key => key, true).costumeDirection).toBeUndefined()
  expect(costumedView({ ...view, costume: { glasses: true } }, 12, true, key => key).costumeDirection).toBe('aside.glasses')
  expect(costumedView({ ...view, costume: { glasses: true } }, 12, true, key => key, true).costumeDirection).toBeUndefined()
  expect(costumedView({ ...view, costume: { rain: true, bow: true } }, 12, true, key => key, true).costumeDirection).toBeUndefined()
  expect(costumedView({ ...view, costume: { rain: true, bow: true } }, 12, true, key => key, true, true).costumeDirection).toBe('aside.ultrathink')
  expect(costumedView({ ...view, costume: { rain: true, bow: true } }, 12, true, key => key).costumeDirection).toBe('aside.ultrathink')
})

// DECISIONS 1017 and his screenshot (10-18): she was typing under "holding her coffee", the run pose holding the
// coffee picture back. Past a minute her coffee takes over the working pose, and its words come with it.
test('NT coffee: a command left running past a minute sits her down with her coffee on the desktop, its words with it', async ($, on) => {
  let release = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  // breathing off, so the minute's coffee is not covered by the breath picture that starts at 20 s of work
  const w = world(on, { store: { ...RECENT, bandSettings: { breathe: false } }, hold: (tool: string) => tool === 'Bash' ? gate : undefined })
  await $.session.start({ cwd: '/tmp/notice-coffee', surface: 'desktop' as const, isInteractive: true }); await settleLegacyStart($, w)
  const ui = await $.ui.mount({ surface: 'desktop', ...band(100, true) })
  await $.turn.start({ turnId: 'coffee', text: 'run the build' })
  const call = $.tool.call({ tool: 'Bash', command: 'make' })
  await w.clock.advance(30_000); await settleLegacyStart($, w)
  const typing = await desktopPicture(ui)
  expect(String(typing?.props.source)).toMatch(/data-coco="[AB] run"/)
  expect(String(typing?.props.alt)).toContain('sprawled at the computer, typing hard')
  await w.clock.advance(31_000); await settleLegacyStart($, w)
  const coffee = await desktopPicture(ui)
  expect(String(coffee?.props.source)).toMatch(/data-coco="[AB] coffee"/)
  expect(String(coffee?.props.alt)).toContain('holding the cup, waiting')
  release(); await call
  await ui.unmount()
})

test('NT words follow the picture: the stage words on the desktop are those of the picture drawn now (owner 10-18)', async ($, on) => {
  let release = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  const w = world(on, { store: RECENT, hold: (tool: string) => tool === 'Bash' ? gate : undefined })
  await $.session.start({ cwd: '/tmp/notice-words', surface: 'desktop' as const, isInteractive: true }); await settleLegacyStart($, w)
  const ui = await $.ui.mount({ surface: 'desktop', ...band(100, true) })
  await $.turn.start({ turnId: 'words', text: 'run the build' })
  const call = $.tool.call({ tool: 'Bash', command: 'make' })
  await w.clock.advance(5_000); await settleLegacyStart($, w)
  const typing = await desktopPicture(ui)
  expect(String(typing?.props.source)).toMatch(/data-coco="[AB] run"/)
  expect(String(typing?.props.alt)).toContain('sprawled at the computer, typing hard')
  // past 20 s of work she breathes: the typing words and the minute's coffee go with the typing picture
  await w.clock.advance(70_000); await settleLegacyStart($, w)
  const breath = await desktopPicture(ui)
  expect(String(breath?.props.source)).toMatch(/data-coco="[AB] breath"/)
  expect(String(breath?.props.alt)).toContain('hugging the laptop, catching a breath')
  expect(String(breath?.props.alt)).not.toContain('typing hard')
  expect(String(breath?.props.alt)).not.toContain('cup')
  release(); await call
  await ui.unmount()
})

test('NT costume: the painted picture gets the lamp, the rain pane or the glasses, nothing else is touched', () => {
  const sprite = painted(['idle-reading'])
  expect(sprite).toContain('viewBox="-4 0 159 128"')
  expect(dressPicture(sprite, { night: false, rain: false, glasses: false })).toBe(sprite)
  const night = dressPicture(sprite, { night: true, rain: false, glasses: false })
  expect(night.startsWith(sprite.slice(0, sprite.indexOf('>') + 1))).toBe(true)
  expect(night.endsWith('</svg>')).toBe(true)
  expect(night).toContain('id="cs-lamp"')
  expect(night).toContain('forced-colors:active')
  expect(night.indexOf('id="cs-lamp"')).toBeGreaterThan(night.indexOf('data:image/png'))
  const rain = dressPicture(sprite, { night: false, rain: true, glasses: false })
  expect(rain.indexOf('id="cs-rain"')).toBeLessThan(rain.indexOf('data:image/png'))
  expect((rain.match(/class="dr"/g) ?? []).length).toBe(30)
  expect(rain).toContain('animation-play-state:paused')
  const glasses = dressPicture(sprite, { night: false, rain: false, glasses: true })
  expect(glasses).toContain('id="cs-glasses"')
  // The pixel band's pictures have another viewBox and stay as they are.
  const pixel = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 35 32" width="35" height="32"><image href="data:image/png;base64,QUJD" width="35" height="32"/></svg>`
  expect(dressPicture(pixel, { night: true, rain: true, glasses: true })).toBe(pixel)
  // Same pictures every time, nothing scheduled or random at draw time.
  expect(lampLayer()).toBe(lampLayer())
  expect(rainLayer()).toBe(rainLayer())
})
