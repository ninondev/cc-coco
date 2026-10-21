import { expect, test } from 'claude-code/testing'
import { desktopBand, terminalBand, planDesktop } from '../hooks/band'
import { initialView } from '../hooks/mood'
import { WORDS, quotaDetailGroups } from '../hooks/words'
import { RECENT, P, PERSON, world, settleLegacyStart, band } from './world'

const PANE = { plugin: 'coco', component: 'Pane' as const, requestId: 'coco-book', props: { title: 'Coco', isFocused: true, bodyColumns: 64, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} } }
const START = { cwd: '/tmp/c2-runtime', surface: 'vscode' as const, isInteractive: true }
const complete = (turnId: string, agentId?: string) => ({ turnId, answer: 'done', reason: 'answer' as const, durationMs: 900, isAborted: false, ...(agentId ? { agentId } : {}), usage: { model: 'test', input_tokens: 120, output_tokens: 9999, cache_read_input_tokens: 800, cache_creation_input_tokens: 80 } })
const text = (n: any): string => typeof n === 'string' ? n : Array.isArray(n) ? n.map(text).join('') : n && typeof n === 'object' ? text(n.children ?? []) : ''
const nodes = (n: any): any[] => !n || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(nodes) : [n, ...nodes(n.children ?? [])]

// BAND F1 (10-09): the band never draws a placeholder character; an unknown figure leaves its group out and the box keeps
// its words in the alt text.
test('C2 unknown context retains the desktop box and draws no placeholder anywhere', async ($, on) => {
  const w = world(on, { store: RECENT, percent: null })
  await $.session.start({ ...START, surface: 'terminal' }); await settleLegacyStart($, w)
  const desktop = await $.ui.mount({ surface: 'desktop', ...band(100) })
  expect(nodes(await desktop.drawn()).some(n => n.type === 'Svg' && n.props.alt === 'No reading yet.')).toBe(true)
  expect(text(await desktop.drawn())).not.toContain('—')
  await desktop.unmount()
  const terminal = await $.ui.mount({ surface: 'terminal', ...band(100, true) })
  expect(text(await terminal.drawn())).not.toMatch(/—|◉/)
  await terminal.unmount()
})

test('C2 quota is Intl', () => {
  expect(quotaDetailGroups('de', [{ kind: 'five_hour', percentUsed: 23.5 }], undefined, 0, true)).toContain('5h 23,5%')
  expect(quotaDetailGroups('en', [], undefined, undefined)).toEqual([])
  expect(quotaDetailGroups('en', [{ kind: 'five_hour', percentUsed: 0 }], undefined, undefined)).toEqual(['5-hour window 0% used'])
})

test('C2 main completion writes no achievement (DECISIONS 1035) and exposes weighted session cache; agents excluded', async ($, on) => {
  const writes: unknown[] = []
  on('store.*', ($, e, next) => { if (next.is('store.set', e) && e.key === 'stamps') writes.push(e.value); return next(e) })
  const w = world(on, { store: { ...RECENT, firstMet: undefined }, surfaces: ['vscode'] })
  await $.session.start(START); await settleLegacyStart($, w)
  await $.turn.complete(complete('agent', 'subagent'))
  await $.turn.complete(complete('main-1'))
  await $.turn.complete(complete('main-2'))
  expect(writes).toEqual([])
  await $.command.run({ command: 'coco', args: 'usage', origin: PERSON, presentation: P })
  const ui = await $.ui.mount({ surface: 'vscode', ...PANE })
  expect(text(await ui.drawn())).toContain('80%')
  await ui.unmount()
})

test('C2 reminder buttons update the batched record, keep choices and redraw', async ($, on) => {
  let settingsRecord: unknown
  on('store.*', ($, e, next) => { if (next.is('store.set', e) && e.key === 'bandSettings') settingsRecord = e.value; return next(e) })
  const w = world(on, { store: { ...RECENT, bandSettings: { voice: 'full', voiceChosen:true, future: 'preserved' } }, surfaces: ['vscode'] })
  await $.session.start(START); await settleLegacyStart($, w)
  await $.command.run({ command: 'coco', args: 'settings', origin: PERSON, presentation: P })
  const ui = await $.ui.mount({ surface: 'vscode', ...PANE })
  expect(await ui.find({ key: 'coco:set:guard:off' })).toBeDefined()
  await ui.press({ key: 'coco:set:guard:off' }); await settleLegacyStart($, w)
  expect(settingsRecord).toMatchObject({ guard: false, bookmark: true, notes: true, budget: 'off', neighbours: false, voice: 'full', future: 'preserved' })
  expect((await ui.find({ key: 'coco:set:guard:off' }))?.props.variant).toBe('primary')
  await ui.unmount()
})

// 10-15 (owner): vibe check took the omen's page; /coco vibe draws nothing, so no omen stamp is pressed
test('C2 /coco vibe presses no stamp', async ($, on) => {
  const writes: unknown[] = []
  on('store.*', ($, e, next) => { if (next.is('store.set', e) && e.key === 'stamps') writes.push(e.value); return next(e) })
  const w = world(on, { store: RECENT, surfaces: ['vscode'] })
  await $.session.start(START); await settleLegacyStart($, w)
  await $.command.run({ command: 'coco', args: 'vibe', origin: PERSON, presentation: P })
  await $.command.run({ command: 'coco', args: 'vibe', origin: PERSON, presentation: P })
  expect(writes).toEqual([])
  expect(w.toasts.some(t => t.includes('stamp') || t.includes('pressed'))).toBe(false)
})
