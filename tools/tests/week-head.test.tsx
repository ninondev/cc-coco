// The weekly line where no band shows it (FIRST-MEETING 3.8): VS Code, the phone and the desktop with the band off carry
// «week.ready» as one plain line under the week's first head, no button, gone when the next turn starts.
import { expect, test } from 'claude-code/testing'
import type { On, RenderSurface } from 'claude-code'
import { OPENING_TEXT_RAW, WEEK_TEXT_RAW } from './week-text-fixture'
import { C3_HEAD_MANIFEST } from './c3-head-assets'
import { MORNING, settleLegacyStart, world } from './world'
import { forgetWeekWords } from '../hooks/week-words'
import { weekStart } from '../hooks/week-days'

const TEXT: Record<string, Record<string, string>> = JSON.parse(WEEK_TEXT_RAW)
const READY = TEXT['week.ready']!.en!
const HELD = { days: [{ day: '2026-09-22', pages: 3, runs: [['read', 1]], green: 0, wild: [] }], slid: [] }
const readText = (path: string) => /[\\/]hooks[\\/]week-text\.json$/.test(path) ? WEEK_TEXT_RAW : /[\\/]hooks[\\/]opening-text\.json$/.test(path) ? OPENING_TEXT_RAW : path.endsWith('frame-manifest.json') ? JSON.stringify(C3_HEAD_MANIFEST) : undefined
const nodes = (tree: any, type: string): any[] => !tree || typeof tree !== 'object' ? [] : [...(tree.type === type ? [tree] : []), ...(tree.children ?? []).flatMap((child: any) => nodes(child, type))]
const text = (tree: any): string => typeof tree === 'string' ? tree : Array.isArray(tree) ? tree.map(text).join('') : tree && typeof tree === 'object' ? text(tree.children) : ''

function fixture(on: On, surface: RenderSurface, store: Record<string, unknown> = {}, initialState?: Record<string, unknown>) {
  forgetWeekWords()
  const writes = new Map<string, unknown>(), headWrites: { id: string; value: any }[] = []
  on('store.*', async ($, e, next) => { const out = await next(e); if (next.is('store.set', e)) writes.set(e.key, e.value); return out })
  on('state.*', ($, e, next) => { if (next.is('state.set', e) && e.key === 'head') headWrites.push({ id: e.id!, value: e.value }); return next(e) })
  // Met long ago and away overnight, so the session opens; last week has a finished day, so the weekly line is due.
  const w = world(on, { engineRows: true, surfaces: [surface], stepText: 'First reply.', readText, initialState,
    store: { firstMet: MORNING - 86_400_000, lastActive: MORNING - 36_000_000, 'days:v1': HELD, ...(surface === 'desktop' ? { bandSettings: { band: 'off' } } : {}), ...store } })
  return { w, writes, headWrites }
}
async function reply($: any, turnId: string) {
  await $.turn.start({ turnId, text: 'hello' })
  for await (const _ of $.turn.step({ turnId, index: 0, model: 'test', messageCount: 1 })) {}
}
const mountHead = ($: any, surface: RenderSurface, requestId: string) =>
  $.ui.mount({ surface, plugin: 'coco', component: 'AssistantMessage', requestId, props: { text: 'First reply.', isFirstOfReply: true }, viewport: { columns: 100, rows: 80 } })

for (const surface of ['vscode', 'mobile', 'desktop'] as const) test(`the week's first head on ${surface} carries the weekly line, plainly, until the next turn starts`, { options: { band: surface === 'desktop' ? 'off' : 'on' } }, async ($, on) => {
  const f = fixture(on, surface)
  await $.session.start({ cwd: '/tmp/week-head', surface, isInteractive: true }); await settleLegacyStart($, f.w)
  await reply($, 'first')
  const row = await mountHead($, surface, 'week-head'); await f.w.clock.advance(0)
  const tree = await row.drawn()
  expect(text(tree)).toContain(READY)
  // One plain line indented to the name, as the first hello is; the head's own book button is the only way in.
  const note = nodes(tree, 'Box').find(box => box.children?.length === 2 && box.children[0]?.props.width === 35 && text(box.children[1]) === READY)
  expect(note).toBeDefined()
  expect(nodes(tree, 'Button').some(node => node.props.key === 'coco:week:open')).toBe(false)
  expect(f.writes.get('weekReady')).toBe(weekStart('2026-10-02', 'en'))
  expect(f.w.cell('head:week-head')?.value.week).toBe(true)
  await $.turn.complete({ turnId: 'first', answer: 'First reply.', reason: 'answer', isAborted: false, durationMs: 1000 })
  const before = f.headWrites.length
  await $.turn.start({ turnId: 'second', text: 'again' })
  expect(f.headWrites.slice(before).filter(write => write.id === 'week-head' && write.value.week === false).length).toBe(1)
  await row.redraw(); expect(text(await row.drawn())).not.toContain(READY)
  // Only the week's first head carries it.
  for await (const _ of $.turn.step({ turnId: 'second', index: 0, model: 'test', messageCount: 1 })) {}
  const next = await mountHead($, surface, 'second-head'); await f.w.clock.advance(0)
  expect(text(await next.drawn())).not.toContain(READY)
  await next.unmount(); await row.unmount()
})

const QUIET: [string, Record<string, unknown>][] = [['once it was shown this week', { weekReady: weekStart('2026-10-02', 'en') }], ['with the weekly page off', { week: false }]]
for (const [name, store] of QUIET) test(`the heads carry no weekly line ${name}`, async ($, on) => {
  const f = fixture(on, 'vscode', store)
  await $.session.start({ cwd: '/tmp/week-head', surface: 'vscode', isInteractive: true }); await settleLegacyStart($, f.w)
  await reply($, 'first')
  const row = await mountHead($, 'vscode', 'quiet-head'); await f.w.clock.advance(0)
  expect(text(await row.drawn())).not.toContain(READY)
  expect(f.writes.has('weekReady')).toBe(false)
  expect(f.w.cell('head:quiet-head')?.value.week).toBeUndefined()
  await row.unmount()
})

test('a head kept from before with the weekly line clears it at the next turn, before the old scroll draws again', async ($, on) => {
  const key = 'heads:v2:' + String(MORNING - 10000).padStart(16, '0') + ':fixture-session:old-week'
  const f = fixture(on, 'vscode', { weekReady: weekStart('2026-10-02', 'en'), [key]: ['old-week', 'happy', MORNING - 10000, 1000] },
    { 'head:old-week': { mood: 'happy', newest: true, endedAt: MORNING - 10000, ms: 1000, week: true } })
  await $.session.start({ cwd: '/tmp/week-head', surface: 'vscode', isInteractive: true }); await settleLegacyStart($, f.w)
  await $.turn.start({ turnId: 'after-resume', text: 'continue' })
  expect(f.w.cell('head:old-week')?.value.week).toBe(false)
  const row = await mountHead($, 'vscode', 'old-week')
  expect(text(await row.drawn())).not.toContain(READY)
  await row.unmount()
})
