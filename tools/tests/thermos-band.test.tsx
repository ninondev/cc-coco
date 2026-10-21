// The thermos (lane C, 10-14): while keeping the cache warm is on, the band's cache cup is her thermos, in the cup's own
// place; with it off the cup is drawn as before.
import { expect, test } from 'claude-code/testing'
import { desktopBand } from '../hooks/band'
import { installCostWords } from '../hooks/cost/words'
import { initialView } from '../hooks/mood'
import type { CostSurfaceSnapshot } from '../types'
import { COST_WORDS_RAW } from './cost-words-fixture'
import { world } from './world'

const now = Date.UTC(2026, 9, 7, 14, 30)
const cost = (warmEnabled: boolean): CostSurfaceSnapshot => ({ billing: { kind: 'plan' }, cache: { observed: true, state: warmEnabled ? 'kept' : 'cooling', sentAt: now - 1000, warmUntil: now + 299000, ttlMs: 300000, prefix: 128400, warmUSD: .03, coldUSD: .64, deltaUSD: .61, kept: { since: now - 600000, pings: 3, usd: .06, stopAt: now + 3600000 } }, sessionUSD: 3.84, lastTurn: { usd: .42, window: { kind: '5h', from: 41, to: 43 } }, ownCalls: { count: 3, usd: .04 }, misses: { count: 1, usd: .6 }, ledger: { day: 14, week: 61, month: 230 }, warmEnabled })
const nodes = (tree: any): any[] => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...(tree.children ?? []).flatMap(nodes)]

test('keeping the cache warm turns her cup into the thermos, in the cup\'s own 16 by 22 place', async ($, on) => {
  installCostWords(JSON.parse(COST_WORDS_RAW))
  let warm = true
  on('ui.render', { component: 'Pane' }, ($, e) => desktopBand($.ui.resolve(e) as any, { ...initialView(), lang: 'en', context: 40, cost: cost(warm), quota: { rateLimits: [], at: now } }, { columns: 120, maxRows: 30, screenRows: 48, isWorking: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="68" height="64"><path d="M0 0h1"/></svg>', undefined))
  world(on)
  const pane = { plugin: 'coco', component: 'Pane' as const, requestId: 'thermos', props: { title: 'thermos', isFocused: true, bodyColumns: 120, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} } }
  const cup = async () => {
    const ui = await $.ui.mount({ surface: 'desktop', ...pane })
    const box = nodes(await ui.drawn()).find(n => n.type === 'Box' && n.props?.key === 'coco:thing:cup')
    await ui.unmount()
    return box?.children?.find((n: any) => n.type === 'Svg') // her cup on the floor (10-18)
  }
  const kept = await cup()
  expect(String(kept?.props.source)).toContain('viewBox="-0.5 -0.5 8 11"')
  expect([kept?.props.width, kept?.props.height]).toEqual([16, 22])
  warm = false
  const plain = await cup()
  expect(String(plain?.props.source)).not.toContain('viewBox="-0.5 -0.5 8 11"')
  expect([plain?.props.width, plain?.props.height]).toEqual([16, 22])
})

// U5 (PLAY 1.4 with MOD-GAPS 3): at a limit the tea face stands with her things, and the focus bar comes after the
// cache cup and the quota pictures, as PLAY places the stick «after the quota incense and the cup».
test('at a limit the cup, the spent battery and the focus bar share the band in PLAY\'s order', async ($, on) => {
  installCostWords(JSON.parse(COST_WORDS_RAW))
  const view = { ...initialView(), lang: 'en' as const, context: 40, cost: cost(false), frame: 'tea-a' as const,
    pose: { name: 'tea', frame: 'tea-a', aside: '(tea)', at: now },
    quota: { rateLimits: [{ kind: 'five_hour', percentUsed: 100 }, { kind: 'seven_day', percentUsed: 20 }], at: now },
    play: { at: now, stick: { startedAt: now - 60000, endsAt: now + 1440000, until: '14:55', tag: 'focus 14:55' } } }
  on('ui.render', { component: 'Pane' }, ($, e) => desktopBand($.ui.resolve(e) as any, view as any, { columns: 120, maxRows: 30, screenRows: 48, isWorking: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="68" height="64"><path d="M0 0h1"/></svg>', undefined))
  world(on)
  const pane = { plugin: 'coco', component: 'Pane' as const, requestId: 'limit', props: { title: 'limit', isFocused: true, bodyColumns: 120, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} } }
  const ui = await $.ui.mount({ surface: 'desktop', ...pane })
  const keys = nodes(await ui.drawn()).map(n => n.props?.key).filter((key): key is string => typeof key === 'string')
  const at = (key: string) => keys.indexOf(key)
  // her things on the floor (10-18): the batteries, the cup, then the focus bar
  expect([at('coco:thing:cup') >= 0, at('coco:thing:quota:five_hour') >= 0, at('coco:thing:stick') >= 0]).toEqual([true, true, true])
  expect(at('coco:thing:quota:five_hour') < at('coco:thing:cup') && at('coco:thing:cup') < at('coco:thing:stick')).toBe(true)
})
