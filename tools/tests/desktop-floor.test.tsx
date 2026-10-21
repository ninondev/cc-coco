// The desktop band redone on his desktop (DECISIONS 1017 to 1019): her script row is hers alone, her things stand on the
// floor row right-aligned with the bag last, each thing a keyed block with its card above, the card never reaching past
// her; the pointer on her opens Poke, Pat and Close on the floor row, and her touch rows read clicks and strokes.
import { expect, test } from 'claude-code/testing'
import { desktopBand, floorThings, planDesktop, planFloor } from '../hooks/band'
import { installCostWords } from '../hooks/cost/words'
import { initialView } from '../hooks/mood'
import { TurnPath } from '../hooks/play-client'
import { COLUMN_PX, planPx } from '../hooks/typeset'
import { WORDS } from '../hooks/words'
import type { CostSurfaceSnapshot } from '../types'
import { COST_WORDS_RAW } from './cost-words-fixture'
import { world } from './world'

const now = Date.UTC(2026, 9, 18, 9, 0)
const walk = (node: unknown): any[] => Array.isArray(node) ? node.flatMap(walk) : !node || typeof node !== 'object' ? [] : [node, ...((node as any).children ?? []).flatMap(walk)]
const strings = (node: any): string[] => typeof node === 'string' ? [node] : Array.isArray(node) ? node.flatMap(strings) : node && typeof node === 'object' ? (node.children ?? []).flatMap(strings) : []
const size = (columns: number) => ({ columns, maxRows: 30, screenRows: 48, isWorking: false })
const sprite = '<svg xmlns="http://www.w3.org/2000/svg" width="62" height="64"><path d="M0 0h1"/></svg>'
const cost: CostSurfaceSnapshot = { billing: { kind: 'plan' }, cache: { observed: true, state: 'cooling', sentAt: now - 1000, warmUntil: now + 299000, ttlMs: 300000, prefix: 128400, warmUSD: .03, coldUSD: .64, deltaUSD: .61 }, sessionUSD: 3.84, lastTurn: { usd: .42, window: { kind: '5h', from: 41, to: 43 } }, ownCalls: { count: 3, usd: .04 }, misses: { count: 1, usd: .6 }, ledger: { day: 14, week: 61, month: 230 }, warmEnabled: false } as CostSurfaceSnapshot
const view = (lang: 'en' | 'zh' | 'de' | 'hi', extra: Record<string, unknown> = {}) => ({
  ...initialView(), lang, band: 'on' as const, context: 31, contextTokens: 309_000, contextWindow: 1_000_000, cost,
  quota: { at: now, rateLimits: [{ kind: 'five_hour', percentUsed: 38, resetsAt: new Date(now + 8_280_000).toISOString() }, { kind: 'seven_day', percentUsed: 60, resetsAt: new Date(now + 309_600_000).toISOString() }] },
  bagEntry: { en: 'Settings', zh: '设置', de: 'Einstellungen', hi: 'सेटिंग्स' }[lang], ...extra,
}) as any

let current: (ui: any) => any = () => null
// The fixture's own Pane hook goes first so it sits above the test world's, which answers every Pane.
function prepare(on: any) {
  on('ui.render', { component: 'Pane' }, ($: any, e: any) => current($.ui.resolve(e)))
  world(on)
}
// The drawn tree leaves out hover styles, so the reveals are read by what they hide: display none.
async function draw($: any, make: (ui: any) => any) {
  current = make
  const ui = await $.ui.mount({ surface: 'desktop', plugin: 'coco', component: 'Pane', props: { title: 'fixture', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } })
  const tree = await ui.drawn()
  await ui.unmount()
  return tree
}

test('DF the script row is hers alone; her things stand on the floor, right-aligned, the bag last and big', async ($, on) => {
  installCostWords(JSON.parse(COST_WORDS_RAW))
  prepare(on)
  const v = view('zh')
  const tree = await draw($, ui => desktopBand(ui, v, size(110), sprite))
  const nodes = walk(tree)
  const floor = nodes.find(n => n.props?.key === 'coco:floor')!
  expect(floor.props).toMatchObject({ position: 'absolute', right: 0, bottom: 0 })
  const keys = walk(floor).map(n => n.props?.key).filter((k: unknown) => typeof k === 'string' && /^coco:(thing|book)/.test(k))
  expect(keys).toEqual(['coco:thing:ctx', 'coco:thing:quota:five_hour', 'coco:thing:quota:seven_day', 'coco:thing:cup', 'coco:book:open'])
  const bag = nodes.find(n => n.props?.key === 'coco:book:open')!
  expect(bag.type).toBe('Button')
  expect(bag.props.plain).toBeUndefined()
  expect(strings(bag).join('')).toBe('👜 设置')
  // Nothing of hers but her name and her direction stands outside the floor.
  const column = nodes.find(n => n.props?.key === 'coco:text-column')!
  const script = column.children.filter((n: any) => n !== floor)
  expect(walk(script).some(n => n.type === 'Svg' || n.type === 'Button')).toBe(false)
  expect(strings(script).join('')).toContain(WORDS.zh.name)
  // Each thing is one keyed block: the tint under the pointer takes its name and its picture together.
  const battery = nodes.find(n => n.props?.key === 'coco:thing:quota:five_hour')!
  expect(battery.props).toMatchObject({ position: 'relative', paddingX: 1 })
  expect(strings(battery).join('')).toContain('5小时')
})

test('DF a card says the full name and number above its thing, and never reaches past her', async ($, on) => {
  installCostWords(JSON.parse(COST_WORDS_RAW))
  prepare(on)
  for (const lang of ['zh', 'en', 'de', 'hi'] as const) for (const columns of [34, 48, 70, 110, 180]) {
    const v = view(lang), plan = planDesktop(v, size(columns))
    const tree = await draw($, ui => desktopBand(ui, v, size(columns), sprite, plan))
    const nodes = walk(tree), column = columns * COLUMN_PX - 2 * COLUMN_PX - (12 + 62 + COLUMN_PX)
    const floor = nodes.find(n => n.props?.key === 'coco:floor')!
    const blocks = floor.children.filter((n: any) => typeof n.props?.key === 'string' && n.props.key.startsWith('coco:thing:'))
    const things = floorThings(v, { cup: plan.cup === true, word: plan.word, aside: 'none', label: 'book', helpers: plan.helpers ?? 'none', neighbours: plan.neighbours === true, quota: plan.quota ?? 'full', name: true, ...(plan.cells === false ? { cells: false } : {}), ...(plan.number === false ? { number: false } : {}), ...(plan.bagWord === false ? { bagWord: false } : {}), ...(plan.play === false ? { play: false } : {}), ...(plan.pad === false ? { pad: false } : {}) } as any)
    expect([lang, columns, things.map(t => 'coco:thing:' + t.kind)]).toEqual([lang, columns, blocks.map((b: any) => b.props.key)])
    // The bag's own room: its margin, the button with 👜, and its word unless that gave way.
    let offset = COLUMN_PX + 32 + (plan.bagWord === false ? 0 : planPx(' ' + v.bagEntry))
    for (let i = blocks.length - 1; i >= 0; i--) {
      const block = blocks[i], card = block.children.find((n: any) => n.props?.position === 'absolute' && n.props?.right === 0)
      if (card) {
        expect(card.props).toMatchObject({ display: 'none', backgroundColor: 'userMessageBackground' })
        expect([lang, columns, block.props.key, card.props.width <= Math.floor((column - offset) / COLUMN_PX)]).toEqual([lang, columns, block.props.key, true])
      }
      offset += things[i]!.px
    }
    if (columns >= 110) {
      const five = nodes.find(n => n.props?.key === 'coco:thing:quota:five_hour')!
      const card = five.children.find((n: any) => n.props?.right === 0)!
      expect(strings(card)[0]!.startsWith(WORDS[lang].quota.kinds.five_hour)).toBe(true)
      expect([lang, columns, strings(card).length, strings(card)]).toEqual([lang, columns, 2, strings(card)])
    }
  }
})

test('DF the floor gives way in his order and always fits, the bag kept', () => {
  installCostWords(JSON.parse(COST_WORDS_RAW))
  for (const lang of ['zh', 'en', 'de', 'hi'] as const) {
    const v = view(lang)
    let seen: string[] = []
    for (let columns = 180; columns >= 34; columns--) {
      const plan = planDesktop(v, size(columns)), column = columns * COLUMN_PX - 2 * COLUMN_PX - (12 + 62 + COLUMN_PX)
      expect([lang, columns, plan.height]).toEqual([lang, columns, 64])
      const floor = planFloor(v, column)
      if (columns >= 40) expect([lang, columns, floor.px <= column]).toEqual([lang, columns, true])
      const gone = [plan.word ? '' : 'names', plan.cells === false ? 'cells' : '', plan.cup ? '' : 'cup', plan.bagWord === false ? 'bagWord' : '', plan.number === false ? 'number' : ''].filter(Boolean)
      for (const step of gone) if (!seen.includes(step)) seen.push(step)
    }
    // Each step comes after the ones before it (DECISIONS 1017); the first width that loses a step loses no later one first.
    const order = ['names', 'cells', 'cup', 'bagWord', 'number']
    expect([lang, seen]).toEqual([lang, order.filter(step => seen.includes(step))])
  }
})

test('DF the pointer on her opens Poke, Pat and Close on the floor row beside her, Close never given away', async ($, on) => {
  installCostWords(JSON.parse(COST_WORDS_RAW))
  prepare(on)
  for (const columns of [180, 110, 34]) {
    const v = view('zh')
    const tree = await draw($, ui => desktopBand(ui, v, size(columns), sprite))
    const nodes = walk(tree)
    const picture = nodes.find(n => n.type === 'Box' && n.props?.key === 'coco:picture')!
    const strip = picture.children.find((n: any) => n.props?.display === 'none')!
    expect(strip.props).toMatchObject({ position: 'absolute', top: 2, height: 1, left: 9 })
    expect(strip.props.width).toBeGreaterThan(0)
    const keys = walk(strip).filter(n => n.type === 'Button').map(n => n.props.key)
    expect(keys.at(-1)).toBe('coco:band:close')
    if (columns >= 110) expect(keys).toEqual(['coco:band:poke', 'coco:band:pat', 'coco:band:close'])
  }
})

test('DF her touch rows and a pointer layer on each of her things stand where the hooks module hands them in', async ($, on) => {
  installCostWords(JSON.parse(COST_WORDS_RAW))
  prepare(on)
  const off = walk(await draw($, ui => desktopBand(ui, view('en'), size(110), sprite)))
  expect(off.some(n => /^coco:(touch|press):/.test(n.props?.key ?? ''))).toBe(false)
  const nodes = walk(await draw($, ui => desktopBand(ui, view('en'), size(110), sprite, undefined, undefined, {
    touch: (row, columns) => <ui.Box key={'coco:touch:' + row} width={columns} height={1} />,
    press: (kind, columns) => <ui.Box key={'coco:press:' + kind} width={columns} height={1} />,
  })))
  const keys = nodes.map(n => n.props?.key).filter((k: unknown) => typeof k === 'string' && /^coco:(touch|press):/.test(k))
  // every thing reports its leave (his 10-18 report: cards stayed a minute); only the quota ones open the quota page
  expect(keys.sort()).toEqual(['coco:press:ctx', 'coco:press:cup', 'coco:press:quota:five_hour', 'coco:press:quota:seven_day', 'coco:touch:0', 'coco:touch:1', 'coco:touch:2'])
  for (const row of [0, 1, 2]) expect(nodes.find(n => n.props?.key === 'coco:touch:' + row)?.props).toMatchObject({ width: 8, height: 1 })
  const layer = nodes.find(n => n.type === 'Box' && n.props?.flexDirection === 'column' && n.children?.some((c: any) => c.props?.key === 'coco:touch:0'))!
  expect(layer.props).toMatchObject({ position: 'absolute', left: 0, top: 0, width: 8, height: 3 })
  const five = nodes.find(n => n.props?.key === 'coco:thing:quota:five_hour')!
  expect(walk(five).some(n => n.props?.key === 'coco:press:quota:five_hour')).toBe(true)
  // a leave bumps the thing's epoch: it is drawn again under a new key, which drops the hover the surface kept
  const left = walk(await draw($, ui => desktopBand(ui, { ...view('en'), hoverEpochs: { 'quota:five_hour': 2, picture: 1 } }, size(110), sprite)))
  expect(left.some(n => n.props?.key === 'coco:thing:quota:five_hour:2')).toBe(true)
  expect(left.some(n => n.props?.key === 'coco:thing:quota:seven_day')).toBe(true)
  expect(left.some(n => n.props?.key === 'coco:picture:1')).toBe(true)
})

// His 10-18 screenshots: with the surface's own hover, every card the pointer had crossed stayed up. With the pointer
// layers the plugin draws the one card under the pointer, and the others are not drawn at all.
test('DF with the pointer layers only the thing the pointer is on has its card and tint', async ($, on) => {
  installCostWords(JSON.parse(COST_WORDS_RAW))
  prepare(on)
  const clients = (ui: any) => ({
    touch: (row: number, columns: number) => <ui.Box key={'coco:touch:' + row} width={columns} height={1} />,
    press: (kind: string, columns: number) => <ui.Box key={'coco:press:' + kind} width={columns} height={1} />,
  })
  const cardOf = (block: any) => block.children.find((n: any) => n.props?.position === 'absolute' && n.props?.right === 0)
  for (const pointerOn of [undefined, 'quota:five_hour', 'ctx']) {
    const v = { ...view('en'), ...(pointerOn ? { pointerOn } : {}) }
    const nodes = walk(await draw($, ui => desktopBand(ui, v, size(110), sprite, undefined, undefined, clients(ui))))
    const blocks = nodes.filter(n => typeof n.props?.key === 'string' && n.props.key.startsWith('coco:thing:'))
    expect(blocks.length).toBeGreaterThan(2)
    for (const block of blocks) {
      const kind = block.props.key.slice('coco:thing:'.length), mine = kind === pointerOn, card = cardOf(block)
      expect([kind, !!card]).toEqual([kind, mine && kind !== 'cup' ? true : mine ? !!card : false])
      if (card) expect(card.props.display).toBeUndefined()
      expect([kind, block.props.backgroundColor]).toEqual([kind, mine ? 'userMessageBackground' : undefined])
      expect(block.props.hover).toBeUndefined()
    }
  }
})

test('DF a click on her is a poke, each turn of a stroke is a turn, passing over her is nothing', () => {
  const ev = (type: string, x: number, extra: Record<string, unknown> = {}) => ({ type, x, y: 0, ...extra }) as any
  const click = new TurnPath()
  click.pointer(ev('enter', 2), 0)
  click.pointer(ev('down', 3, { button: 'left' }), 10)
  expect(click.pointer(ev('up', 3), 200)).toEqual({ t: 'poke' })
  click.pointer(ev('down', 3, { button: 'left' }), 300)
  expect(click.pointer(ev('up', 3), 900)).toBeUndefined() // held too long
  const pass = new TurnPath(), posts: unknown[] = []
  for (let x = 0, at = 0; x <= 8; x++, at += 30) { const p = pass.pointer(ev('move', x), at); if (p) posts.push(p) }
  expect(posts).toEqual([])
  const rub = new TurnPath(), turns: unknown[] = []
  for (const [i, x] of [1, 3, 5, 3, 1, 3, 5, 6].entries()) { const p = rub.pointer(ev('move', x), i * 60); if (p) turns.push(p) }
  expect(turns).toEqual([{ t: 'turn' }, { t: 'turn' }])
  const press = new TurnPath()
  press.pointer(ev('down', 2, { button: 'left' }), 0, true)
  expect(press.pointer(ev('up', 2), 900, true)).toEqual({ t: 'press' })
})
