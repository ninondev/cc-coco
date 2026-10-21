// Play, 1.0: breathing (the incense, then from lane C 10-14 her laptop's side light), one focus (the stick, then her
// eight cells), the wait at a limit. Texts are the shipped English words, read the way the plugin reads them.

import { describe, expect, test } from 'claude-code/testing'
import { AUTO_RESUME, BREATH_AFTER_MS, breathCell, breathLevel, limitRecords, nextBreathStep, nextStickRowAt, parseFocus, stickBurning, stickOf, stickRow, stickStep, waitRow } from '../hooks/play'
import { quotaPictures } from '../hooks/quota'
import { DragPath } from '../hooks/play-client'
import { companionRecord, companionSession } from '../hooks/companion'
import { initialView } from '../hooks/mood'
import { TERMINAL_COLUMNS, TERMINAL_ROWS, spriteCells } from '../hooks/pictures-lazy'
import { P, PERSON, RECENT, band, settleLegacyStart, world } from './world'

const START = { cwd: '/tmp/project', surface: 'terminal' as const, isInteractive: true }
const DESKTOP = { cwd: '/tmp/project', surface: 'desktop' as const, isInteractive: true }
const LIMITS = [{ kind: 'five_hour', percentUsed: 62 }, { kind: 'seven_day', percentUsed: 20 }]
const nodes = (node: unknown): any[] => Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === 'object' ? [node, ...nodes((node as { children?: unknown }).children ?? [])] : []
const lightOf = async (ui: { drawn: () => Promise<unknown> }) => nodes(await ui.drawn()).find(n => n.type === 'Svg' && String(n.props.source).includes('class="led"'))
const batteryOf = async (ui: { drawn: () => Promise<unknown> }) => nodes(await ui.drawn()).find(n => n.type === 'Svg' && String(n.props.source).includes('viewBox="0 0 26 12"'))
const focusOf = async (ui: { drawn: () => Promise<unknown> }) => nodes(await ui.drawn()).find(n => n.type === 'Svg' && String(n.props.source).includes('viewBox="0 0 39 4"'))
const texts = (tree: unknown): string[] => nodes(tree).flatMap(n => (n.children ?? []).filter((c: unknown) => typeof c === 'string') as string[])
const complete = (turnId = 't1') => ({ turnId, answer: 'done', reason: 'answer' as const, durationMs: 900, isAborted: false })
const measure = async ($: any, w: ReturnType<typeof world>, limits: { kind: string; percentUsed: number; resetsAt?: string }[]) => {
  w.limits = limits
  await $.session.measure({ context: { window: 200000, tokens: 40000, percent: 20 }, rateLimits: limits, changed: ['rateLimits'] })
}
const appendRow = (text: string, $: any) => $.session.append({ door: 'notice', origin: { kind: 'engine' }, uuid: 'row-' + text.length, message: { type: 'system', content: [{ type: 'text', text }] } })
  .catch((error: unknown) => { if (!String(error).includes('no implementation for session.append')) throw error })

describe('the pure parts', () => {
  test('a breath is four seconds in and six out, and its cell follows the curve', () => {
    const near = (value: number, to: number) => expect(Math.abs(value - to) < 1e-9).toBe(true)
    near(breathLevel(0), 0); near(breathLevel(4000), 1); near(breathLevel(10000), 0); near(breathLevel(7000), .5)
    const cells = [0, 1250, 2500, 3750, 5000, 6250, 7500, 8750].map(t => breathCell(t))
    expect(cells).toEqual(['⢀', '⢠', '⢰', '⢸', '⢸', '⢰', '⢠', '⢀'])
    expect(breathCell(1000, true)).toBe('⢰')
    expect(breathCell(5000, true)).toBe('⢀')
    expect(nextBreathStep(0)).toBe(1250)
    expect(nextBreathStep(1000)).toBe(250)
    expect(nextBreathStep(1000, true)).toBe(3000)
  })
  test('`focus` lights 25 minutes, takes 5 to 90, and `off` puts the stick out', () => {
    expect(parseFocus('')).toEqual({ kind: 'light', minutes: 25 })
    expect(parseFocus('50')).toEqual({ kind: 'light', minutes: 50 })
    expect(parseFocus('1')).toEqual({ kind: 'light', minutes: 5 })
    expect(parseFocus('500')).toEqual({ kind: 'light', minutes: 90 })
    expect(parseFocus('OFF')).toEqual({ kind: 'out' })
    expect(parseFocus('soon')).toBeUndefined()
    expect(parseFocus('-5')).toBeUndefined()
  })
  test('a focus counts 42 steps and redraws the terminal once a cell, eight cells; a shared one must be sane', () => {
    const stick = { startedAt: 1000, endsAt: 1000 + 25 * 60_000 }
    expect(stickBurning(stick, 1000)).toBe(true)
    expect(stickBurning(stick, stick.endsAt)).toBe(false)
    expect(stickStep(stick, 1000)).toBe(0)
    expect(stickStep(stick, 1000 + 12.5 * 60_000)).toBe(21)
    expect(stickStep(stick, stick.endsAt)).toBe(42)
    expect([0, 4, 8, 12, 16, 24.9].map(m => stickRow(stick, 1000 + m * 60_000))).toEqual([0, 1, 2, 3, 5, 7])
    expect(nextStickRowAt(stick, 1000)).toBe(1000 + 25 * 60_000 / 8)
    expect(nextStickRowAt(stick, stick.endsAt - 1000)).toBeUndefined()
    expect(stickOf(stick)).toEqual(stick)
    expect(stickOf({ startedAt: 5, endsAt: 4 })).toBeUndefined()
    expect(stickOf({ startedAt: 0, endsAt: 100 * 60_000 })).toBeUndefined()
    expect(stickOf({ startedAt: 'now', endsAt: 3 })).toBeUndefined()
    expect(stickOf(null)).toBeUndefined()
  })
  test('the engine rows about its wait are read in one place', () => {
    const dot = '·'
    expect(waitRow(`Usage limit reached ${dot} limit resets 3:45pm`)).toEqual({ kind: 'reached' })
    expect(waitRow(`Continuing automatically at 3:45pm ${dot} esc to cancel`)).toEqual({ kind: 'wait', time: '3:45pm' })
    expect(waitRow('Continuing automatically at 15:45')).toEqual({ kind: 'wait', time: '15:45' })
    expect(waitRow('Automatic continue cancelled')).toEqual({ kind: 'cancelled' })
    expect(waitRow('Your plan has a usage meter')).toBeUndefined()
    expect(AUTO_RESUME).toEqual(['quota_auto_resume_fired', 'quota_auto_resume_stale', 'quota_auto_resume_disabled'])
  })
  test('the limit record keeps only sane rows', () => {
    expect(limitRecords([{ kind: 'out', at: 5, window: 'five_hour' }, { kind: 'carried', at: 9, minutes: 14.4, percent: 8.6, window: 'five_hour' }, { kind: 'x' }, null, { kind: 'out', at: 'soon', window: 'five_hour' }]))
      .toEqual([{ kind: 'out', at: 5, window: 'five_hour' }, { kind: 'carried', at: 9, minutes: 14, percent: 9, window: 'five_hour' }])
    expect(limitRecords('no')).toEqual([])
  })
})

describe('breathing, on the desktop', () => {
  test('on by default: her laptop light comes after 20 s of a turn and goes with the turn', async ($, on) => {
    const w = world(on, { store: RECENT, limits: LIMITS, surfaces: ['desktop'] })
    await $.session.start(DESKTOP); await settleLegacyStart($, w)
    await measure($, w, LIMITS)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100, true) })
    await w.clock.advance(0)
    expect(await lightOf(ui)).toBeUndefined()
    await $.turn.start({ text: 'go', turnId: 't1' })
    await w.clock.advance(BREATH_AFTER_MS - 1000)
    expect(await lightOf(ui)).toBeUndefined()
    await w.clock.advance(1100)
    const breathing = await lightOf(ui)
    expect(String(breathing?.props.source)).toContain('animation:led 10s infinite')
    expect([breathing?.props.width, breathing?.props.height]).toEqual([35, 20])
    expect(w.view().play?.breath?.since).toBeGreaterThan(0)
    await $.turn.complete(complete())
    await w.clock.advance(0)
    expect(await lightOf(ui)).toBeUndefined()
    expect(w.view().play?.breath).toBeUndefined()
  })
  test('off: no light at any age of the turn, and no timer was armed for it', async ($, on) => {
    const w = world(on, { store: { ...RECENT, breathe: 'off' }, limits: LIMITS, surfaces: ['desktop'] })
    await $.session.start(DESKTOP); await settleLegacyStart($, w)
    await measure($, w, LIMITS)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100, true) })
    await $.turn.start({ text: 'go', turnId: 't1' })
    await w.clock.advance(BREATH_AFTER_MS * 3)
    expect(await lightOf(ui)).toBeUndefined()
    expect(w.view().play).toBeUndefined()
  })
  test('with no quota the light still comes with the breathing, and says so to a screen reader', async ($, on) => {
    const w = world(on, { store: RECENT, cost: 1.5, surfaces: ['desktop'] })
    await $.session.start(DESKTOP); await settleLegacyStart($, w)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100, true) })
    await $.turn.start({ text: 'go', turnId: 't1' })
    await w.clock.advance(BREATH_AFTER_MS + 100)
    const light = await lightOf(ui)
    expect(light?.props.height).toBe(20)
    expect(String(light?.props.alt)).toBe('breathing light: in 4 s, out 6 s') // what it is for (DECISIONS 1022)
  })
})

describe('breathing, on the terminal', () => {
  test('the working row gains one cell, redrawn about eight times in ten seconds, and loses it with the turn', async ($, on) => {
    let renders = 0
    const w = world(on, { store: RECENT, limits: LIMITS, onRender: component => { if (component === 'AbovePrompt') renders += 1 } })
    await $.session.start(START); await settleLegacyStart($, w)
    const ui = await $.ui.mount({ surface: 'terminal', ...band(100, true) })
    await w.clock.advance(0)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await w.clock.advance(BREATH_AFTER_MS + 50)
    expect(await ui.find({ type: 'Text', text: /^[⢀⢠⢰⢸]$/ })).toBeDefined()
    const before = renders
    await w.clock.advance(10_000)
    expect(renders - before).toBeGreaterThanOrEqual(6)
    expect(renders - before).toBeLessThanOrEqual(9)
    await $.turn.complete(complete())
    await w.clock.advance(0)
    expect(await ui.find({ type: 'Text', text: /^[⢀⢠⢰⢸]$/ })).toBe(undefined)
    const quiet = renders
    await w.clock.advance(20_000)
    expect(renders - quiet).toBeLessThanOrEqual(2)
  })
})

describe('one stick', () => {
  test('`/coco focus` runs 25 minutes: eight cells at the right of the quota pictures, and until when', async ($, on) => {
    const w = world(on, { store: RECENT, limits: LIMITS, surfaces: ['desktop'] })
    await $.session.start(DESKTOP); await settleLegacyStart($, w)
    await measure($, w, LIMITS)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    await $.command.run({ command: 'coco', args: 'focus', origin: PERSON, presentation: P })
    await w.clock.advance(0)
    const stick = w.view().play?.stick
    expect(stick?.endsAt).toBe(stick!.startedAt + 25 * 60_000)
    expect(stick?.tag).toBe(`focus ${stick!.until}`)
    // The time stands beside the cells; her stage direction may give way to the pictures on the band.
    expect(nodes(await ui.drawn()).some(n => n.type === 'Text' && (n.children ?? []).join('') === stick!.until)).toBe(true)
    const svg = await focusOf(ui)
    expect(svg?.props.width).toBe(59)
    expect(svg?.props.height).toBe(6)
    expect(String(svg?.props.alt)).toBe(`hood up, focusing until ${stick!.until}`)
    const order = nodes(await ui.drawn()).filter(n => n.type === 'Svg').map(n => String(n.props.source).includes('viewBox="0 0 39 4"') ? 'focus' : String(n.props.source).includes('viewBox="0 0 26 12"') ? 'battery' : 'other')
    expect(order.indexOf('battery')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('battery')).toBeLessThan(order.indexOf('focus'))
  })
  test('a band drawn after quiet minutes takes the time now: three cells already lit, the fourth due in 2.5 minutes', async ($, on) => {
    const w = world(on, { store: RECENT, limits: LIMITS, surfaces: ['desktop'] })
    await $.session.start(DESKTOP); await settleLegacyStart($, w)
    await $.command.run({ command: 'coco', args: 'focus', origin: PERSON, presentation: P })
    await w.clock.advance(0)
    await w.clock.advance(10 * 60_000)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    await w.clock.advance(0)
    const svg = await focusOf(ui)
    expect(String(svg?.props.source)).toContain('.c3{opacity:0;animation:on 1ms forwards;animation-delay:150000ms}')
    expect(String(svg?.props.source)).not.toContain('.c2{')
  })
  test('`focus 50` and `focus off`; the stick is never kept in the store', async ($, on) => {
    const stored: string[] = []
    on('store.set', { key: 'bandSettings' }, ($, e, next) => { stored.push(JSON.stringify(e.value)); return next(e) })
    const w = world(on, { store: RECENT, surfaces: ['desktop'] })
    await $.session.start(DESKTOP); await settleLegacyStart($, w)
    await $.command.run({ command: 'coco', args: 'focus 50', origin: PERSON, presentation: P })
    await w.clock.advance(0)
    expect(w.view().play!.stick!.endsAt - w.view().play!.stick!.startedAt).toBe(50 * 60_000)
    await $.command.run({ command: 'coco', args: 'focus off', origin: PERSON, presentation: P })
    await w.clock.advance(0)
    expect(w.view().play?.stick).toBeUndefined()
    expect(w.view().stageDirection).toBe('(pushes the hood back)')
    await w.clock.advance(6100)
    expect(w.view().stageDirection).toBeUndefined()
    expect(stored.some(text => text.includes('endsAt'))).toBe(false)
  })
  test('while it burns he says nothing of his own; at the end he says one note and the stick goes 2 s later', async ($, on) => {
    const w = world(on, { store: RECENT, surfaces: ['desktop'] })
    await $.session.start(DESKTOP); await settleLegacyStart($, w)
    await $.command.run({ command: 'coco', args: 'focus 5', origin: PERSON, presentation: P })
    await w.clock.advance(0)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.turn.complete({ ...complete(), durationMs: 200_000 })
    await w.clock.advance(0)
    expect(w.view().line?.class === 0 ? w.view().line : undefined).toBeUndefined()
    expect(w.view().said ?? null).toBeNull()
    await w.clock.advance(5 * 60_000 + 10)
    expect(w.view().play?.stick?.endedAt).toBeGreaterThan(0)
    expect(w.view().line?.text).toBe('focus done, hood down~')
    expect(w.view().line?.class).toBe(1)
    await w.clock.advance(2100)
    expect(w.view().play?.stick).toBeUndefined()
  })
  test('the companion feed carries the stick while it stands, and nothing without one', () => {
    companionSession('/fixture/project')
    const view = initialView()
    expect(companionRecord(view).stick).toBeUndefined()
    const lit = { ...view, play: { stick: { startedAt: 1_000, endsAt: 1_000 + 25 * 60_000, until: '4:15 PM', tag: 'stick 4:15 PM' } } }
    expect(companionRecord(lit).stick).toEqual({ startedAt: 1_000, endsAt: 1_000 + 25 * 60_000 })
  })
  const MAC = '/System/Library/CoreServices/SystemVersion.plist'
  const sound = (choice: 'quiet' | 'sound' | undefined, mac: boolean) => async ($: any, on: any) => {
    const played: string[] = []
    on('audio.play', (_$: unknown, e: { clip: unknown }) => { played.push(JSON.stringify(e.clip)); return { value: undefined } })
    if (mac) on('fs.exists', { path: MAC }, () => ({ value: true }))
    const w = world(on, { store: { ...RECENT, ...(choice ? { stickEnd: choice } : {}) }, surfaces: ['desktop'] })
    await $.session.start(DESKTOP); await settleLegacyStart($, w)
    await $.command.run({ command: 'coco', args: 'focus 5', origin: PERSON, presentation: P })
    await w.clock.advance(5 * 60_000 + 10)
    expect(w.view().play?.stick?.endedAt).toBeGreaterThan(0)
    await w.clock.advance(0)
    return played
  }
  test('the end of the stick is quiet unless he chose the sound, and the sound is the Mac\'s alone', async ($, on) => {
    expect(await sound(undefined, true)($, on)).toEqual([])
  })
  test('with the sound chosen on a Mac the soft note plays once', async ($, on) => {
    const played = await sound('sound', true)($, on)
    expect(played.length).toBe(1)
    expect(played[0]).toContain('assets/sound/stick-end.wav')
  })
  test('with the sound chosen off a Mac nothing plays', async ($, on) => {
    expect(await sound('sound', false)($, on)).toEqual([])
  })
  test('on the terminal: eight cells and the time on her name row, only the time at 24 columns', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START); await settleLegacyStart($, w)
    await $.command.run({ command: 'coco', args: 'focus', origin: PERSON, presentation: P })
    await w.clock.advance(0)
    const until = w.view().play!.stick!.until
    const rest = await $.ui.mount({ surface: 'terminal', ...band(100) })
    await w.clock.advance(0)
    expect(texts(await rest.drawn())).toContain('▫▫▫▫▫▫▫▫')
    expect(texts(await rest.drawn())).toContain(` ${until}`)
    expect(texts(await rest.drawn()).some(t => t.includes(`(until ${until})`))).toBe(true)
    const working = await $.ui.mount({ surface: 'terminal', ...band(100, true) })
    await w.clock.advance(0)
    expect(texts(await working.drawn())).toContain('▫▫▫▫▫▫▫▫')
    expect(texts(await working.drawn())).toContain(` ${until}`)
    const narrow = await $.ui.mount({ surface: 'terminal', ...band(24, true) })
    await w.clock.advance(0)
    expect(texts(await narrow.drawn())).toContain(until)
    expect(texts(await narrow.drawn())).not.toContain('▫▫▫▫▫▫▫▫')
  })
  for (const [name, lang] of [['中文', 'zh_CN'], ['日本語', 'ja_JP']] as const) {
    test(`the terminal's cells and time need no word in ${name}`, async ($, on) => {
      const w = world(on, { store: RECENT, env: { LANG: `${lang}.UTF-8`, TERM: 'xterm-256color' } })
      await $.session.start(START); await settleLegacyStart($, w)
      await $.command.run({ command: 'coco', args: 'focus', origin: PERSON, presentation: P })
      await w.clock.advance(0)
      const until = w.view().play!.stick!.until
      const working = await $.ui.mount({ surface: 'terminal', ...band(100, true) })
      await w.clock.advance(0)
      expect(texts(await working.drawn())).toContain('▫▫▫▫▫▫▫▫')
      expect(texts(await working.drawn())).toContain(` ${until}`)
    })
  }
  test('his first page offers one press, and the press lights and puts out', async ($, on) => {
    const w = world(on, { store: RECENT, surfaces: ['desktop'] })
    await $.session.start(DESKTOP); await settleLegacyStart($, w)
    await $.command.run({ command: 'coco', args: 'about', origin: PERSON, presentation: P })
    const pane = { plugin: 'coco', component: 'Pane' as const, requestId: 'coco-book', props: { title: 'Coco', isFocused: false, bodyColumns: 60, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 } } }
    const ui = await $.ui.mount({ surface: 'desktop', ...pane }); await ui.redraw()
    expect(await ui.find({ type: 'Button', key: 'coco:stick:light' })).toBeDefined()
    await ui.press({ key: 'coco:stick:light' }); await w.clock.advance(0); await ui.redraw()
    expect(w.view().play?.stick).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'coco:stick:out' })).toBeDefined()
    await ui.press({ key: 'coco:stick:out' }); await w.clock.advance(0); await ui.redraw()
    expect(w.view().play?.stick).toBeUndefined()
  })
})

describe('the wait at a limit', () => {
  const SPENT = [{ kind: 'five_hour', percentUsed: 100, resetsAt: new Date(Date.UTC(2026, 9, 2, 15, 45)).toISOString() }, { kind: 'seven_day', percentUsed: 20 }]
  const dot = '·'
  test('the engine row: her line says when it relights, the spent battery waits under the bolt and says when it comes back; cancel takes the line', async ($, on) => {
    const w = world(on, { store: RECENT, limits: SPENT, surfaces: ['desktop'] })
    await $.session.start(DESKTOP); await settleLegacyStart($, w)
    await measure($, w, SPENT)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    await appendRow(`Usage limit reached ${dot} limit resets 3:45pm`, $); await w.clock.advance(0)
    expect(w.view().play?.wait).toBeUndefined()
    await appendRow(`Continuing automatically at 3:45pm ${dot} esc to cancel`, $); await w.clock.advance(0)
    expect(w.view().play?.wait?.time).toBe('3:45 PM')
    expect(w.view().line?.text).toBe('the 5-hour window ran flat; back at 3:45 PM')
    expect(String((await batteryOf(ui))?.props.source)).toBe(quotaPictures([], ['five_hour']).five)
    expect(nodes(await ui.drawn()).some(n => n.type === 'Text' && (n.children ?? []).join('') === 'back at 3:45 PM')).toBe(true)
    await appendRow('Automatic continue cancelled', $); await w.clock.advance(0)
    expect(w.view().play?.wait).toBeUndefined()
    expect(w.view().line?.key).not.toBe('limit.relight')
  })
  test('the fired notice relights for 900 ms, says what he does for that turn, and the record is kept', async ($, on) => {
    const stored = new Map<string, unknown>()
    on('store.set', { key: 'limitLog' }, ($, e, next) => { stored.set(e.key, e.value); return next(e) })
    const w = world(on, { store: RECENT, limits: SPENT, surfaces: ['desktop'] })
    on('classic.Notification', () => ({}))
    on('classic.StopFailure', () => ({}))
    await $.session.start(DESKTOP); await settleLegacyStart($, w)
    await measure($, w, SPENT)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    await appendRow(`Continuing automatically at 3:45pm ${dot} esc to cancel`, $); await w.clock.advance(0)
    await $.classic.StopFailure({ error: 'rate_limit' } as never)
    await $.classic.Notification({ message: '', title: '', notification_type: 'quota_auto_resume_fired' } as never)
    await w.clock.advance(0)
    expect(w.view().play?.wait).toBeUndefined()
    expect(w.view().play?.relit?.turn).toBe(true)
    expect(String((await batteryOf(ui))?.props.source)).toBe(quotaPictures([{ kind: 'five_hour', percentUsed: 0 }]).five)
    expect(w.view().quota?.rateLimits.find(l => l.kind === 'five_hour')?.percentUsed).toBe(0)
    await $.turn.start({ text: '', turnId: 't9' })
    await w.clock.advance(0)
    expect(w.view().stageDirection).toBe('(back on charge)')
    await w.clock.advance(14 * 60_000)
    await measure($, w, [{ kind: 'five_hour', percentUsed: 9 }, { kind: 'seven_day', percentUsed: 20 }])
    await $.turn.complete(complete('t9'))
    await w.clock.advance(0)
    expect(w.view().stageDirection).toBeUndefined()
    const rows = limitRecords(stored.get('limitLog'))
    expect(rows.map(r => r.kind)).toEqual(['out', 'carried'])
    expect(rows[1]).toMatchObject({ kind: 'carried', minutes: 14, percent: 9, window: 'five_hour' })
  })
  test('the first turn after a rate-limit stop relights even when the plugin never saw the engine rows', async ($, on) => {
    const w = world(on, { store: RECENT, limits: SPENT, surfaces: ['desktop'] })
    on('classic.StopFailure', () => ({}))
    await $.session.start(DESKTOP); await settleLegacyStart($, w)
    await measure($, w, SPENT)
    await $.classic.StopFailure({ error: 'rate_limit' } as never)
    await $.turn.start({ text: 'again', turnId: 't2' })
    await w.clock.advance(0)
    expect(w.view().play?.relit?.turn).toBe(true)
  })
  test('his log lists when the window ran out and when Claude Code carried on', async ($, on) => {
    const rows = [{ kind: 'out', at: Date.UTC(2026, 9, 2, 8, 41), window: 'five_hour' }, { kind: 'carried', at: Date.UTC(2026, 9, 2, 8, 55), minutes: 14, percent: 9, window: 'five_hour' }]
    const w = world(on, { store: { ...RECENT, limitLog: rows }, surfaces: ['desktop'] })
    await $.session.start(DESKTOP); await settleLegacyStart($, w)
    await $.command.run({ command: 'coco', args: 'log', origin: PERSON, presentation: P })
    const pane = { plugin: 'coco', component: 'Pane' as const, requestId: 'coco-book', props: { title: 'Coco', isFocused: false, bodyColumns: 60, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 } } }
    const ui = await $.ui.mount({ surface: 'desktop', ...pane }); await ui.redraw()
    expect(await ui.find({ type: 'Text', text: /the 5-hour window ran out/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Claude Code carried on, 14m of work, new window at 9%/ })).toBeDefined()
  })
})

describe('no relight', () => {
  const SPENT = [{ kind: 'five_hour', percentUsed: 100, resetsAt: new Date(Date.UTC(2026, 9, 2, 15, 45)).toISOString() }, { kind: 'seven_day', percentUsed: 20 }]
  test('when Claude Code will not carry on by itself he says so once, and the wait goes', async ($, on) => {
    const w = world(on, { store: RECENT, limits: SPENT, surfaces: ['desktop'] })
    on('classic.Notification', () => ({}))
    await $.session.start(DESKTOP); await settleLegacyStart($, w)
    await measure($, w, SPENT)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    const dot = '·'
    await appendRow(`Continuing automatically at 3:45pm ${dot} esc to cancel`, $); await w.clock.advance(0)
    expect(w.view().play?.wait).toBeDefined()
    const disabled = { message: '', title: '', notification_type: 'quota_auto_resume_disabled' } as never
    await $.classic.Notification(disabled); await w.clock.advance(0)
    expect(w.view().play?.wait).toBeUndefined()
    expect(w.view().line?.key).toBe('limit.noRelight')
    expect(w.view().line?.class).toBe(1)
    expect(w.view().line?.text).toBe('it won\'t come back by itself this time')
    expect(await batteryOf(ui)).toBeDefined()
    await w.clock.advance(15_000)
    await $.classic.Notification(disabled); await w.clock.advance(0)
    expect(w.view().line?.key).not.toBe('limit.noRelight')
    // The engine's other two notices add no word of his.
    await $.classic.Notification({ message: '', title: '', notification_type: 'quota_auto_resume_stale' } as never); await w.clock.advance(0)
    expect(w.view().line?.key).not.toBe('limit.noRelight')
  })
})

describe('the settings row', () => {
  test('breathing sits on the main page, on, and one press turns it off for good', async ($, on) => {
    const w = world(on, { store: RECENT, limits: LIMITS, surfaces: ['desktop'] })
    await $.session.start(DESKTOP); await settleLegacyStart($, w)
    await $.command.run({ command: 'coco', args: 'settings', origin: PERSON, presentation: P })
    const pane = { plugin: 'coco', component: 'Pane' as const, requestId: 'coco-book', props: { title: 'Coco', isFocused: false, bodyColumns: 60, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 } } }
    const ui = await $.ui.mount({ surface: 'desktop', ...pane }); await ui.redraw()
    expect(await ui.find({ type: 'Text', text: /^Breathing$/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'coco:set:breathe:on' })).toBeDefined()
    await ui.press({ key: 'coco:set:breathe:off' }); await w.clock.advance(0)
    await measure($, w, LIMITS)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await w.clock.advance(BREATH_AFTER_MS + 100)
    expect(w.view().play).toBeUndefined()
  })
})

describe('the terminal pointer', () => {
  const fullscreen = (columns: number, working = false) => ({ ...band(columns, working), viewport: { columns, rows: 48, isFullscreen: true } })
  const post = (ui: any, data: unknown) => ui.post(data)
  const lifted = (tree: unknown, columns: number) => nodes(tree).find(n => n.type === 'Box' && n.props?.marginLeft === columns && (n.children ?? []).some((c: any) => c?.type === 'Raster'))
  const pointer = (type: string, x: number, extra: Record<string, unknown> = {}) => ({ type, x, y: 3, ...extra }) as any

  test('a press that does not move is not a drag; two cells sideways is; the lift is clamped to 0 to 12', () => {
    const path = new DragPath()
    expect(path.pointer(pointer('down', 4, { button: 'left' }), 35)).toBeUndefined()
    expect(path.pointer(pointer('move', 5, { button: 'left' }), 35)).toBeUndefined()
    expect(path.pointer(pointer('up', 5, { button: 'left' }), 35)).toBeUndefined()
    path.pointer(pointer('down', 4, { button: 'left' }), 35)
    expect(path.pointer(pointer('move', 6, { button: 'left' }), 35)).toEqual({ t: 'drag', dx: 2 })
    expect(path.pointer(pointer('move', 6, { button: 'left' }), 35)).toBeUndefined()
    expect(path.pointer(pointer('move', 40, { button: 'left' }), 35)).toEqual({ t: 'drag', dx: 12 })
    expect(path.pointer(pointer('move', -9, { button: 'left' }), 35)).toEqual({ t: 'drag', dx: 0 })
    expect(path.pointer(pointer('up', -9, { button: 'left' }), 35)).toEqual({ t: 'drop', dx: 0 })
    expect(path.pointer(pointer('enter', 2), 35)).toEqual({ t: 'glance', side: 'left' })
    expect(path.pointer(pointer('enter', 33), 35)).toEqual({ t: 'glance', side: 'right' })
  })
  test('the client is drawn only with the mouse on, a fullscreen terminal and his picture', async ($, on) => {
    const w = world(on, { store: RECENT, settings: { mouse: true } })
    await $.session.start(START); await settleLegacyStart($, w)
    const on1 = await $.ui.mount({ surface: 'terminal', ...fullscreen(100) }); await w.clock.advance(0)
    expect((await on1.findAll({ type: 'Client' })).length).toBe(1)
    const flat = await $.ui.mount({ surface: 'terminal', ...band(100) }); await w.clock.advance(0)
    expect(await flat.findAll({ type: 'Client' })).toEqual([])
    const working = await $.ui.mount({ surface: 'terminal', ...fullscreen(100, true) }); await w.clock.advance(0)
    expect(await working.findAll({ type: 'Client' })).toEqual([])
  })
  test('without the mouse setting no client is drawn', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START); await settleLegacyStart($, w)
    const ui = await $.ui.mount({ surface: 'terminal', ...fullscreen(100) }); await w.clock.advance(0)
    expect(await ui.findAll({ type: 'Client' })).toEqual([])
  })
  test('held, he is lifted startled then with his book up; let go he is flustered, walks home a cell every 90 ms, and nothing is pending after 2.5 s', async ($, on) => {
    let renders = 0
    const w = world(on, { store: RECENT, settings: { mouse: true }, onRender: component => { if (component === 'AbovePrompt') renders += 1 } })
    await $.session.start(START); await settleLegacyStart($, w)
    const ui = await $.ui.mount({ surface: 'terminal', ...fullscreen(100) }); await w.clock.advance(0)
    const at = (frame: string) => spriteCells(frame as never, w.view().colors)
    const idle0 = renders
    await w.clock.advance(5000)
    const idleRate = renders - idle0
    await ui.pointer({ type: 'down', x: 2, y: 3, button: 'left' })
    await ui.pointer({ type: 'move', x: 3, y: 3, button: 'left' })
    await w.clock.advance(0)
    expect(lifted(await ui.drawn(), 12)).toBeUndefined()
    await ui.pointer({ type: 'move', x: 60, y: 3, button: 'left' })
    await w.clock.advance(0)
    expect(lifted(await ui.drawn(), 12)).toBeDefined()
    const faces: string[] = []
    const face = async () => { const c = (await ui.find({ type: 'Raster' }))?.props.cells; return ['error', 'refuse', 'flustered', 'idle-reading'].find(f => at(f) === c) ?? 'other' }
    faces.push(await face())
    await w.clock.advance(300)
    faces.push(await face())
    expect(faces).toEqual(['error', 'refuse'])
    await post(ui, { t: 'drag', dx: 7 }); await w.clock.advance(0)
    expect(lifted(await ui.drawn(), 7)).toBeDefined()
    await ui.pointer({ type: 'up', x: 9, y: 3, button: 'left' })
    await w.clock.advance(0)
    expect(await face()).toBe('flustered')
    const before = renders
    await w.clock.advance(420 + 5)
    expect(lifted(await ui.drawn(), 6)).toBeDefined()
    await w.clock.advance(90 * 4)
    expect(lifted(await ui.drawn(), 2)).toBeDefined()
    await w.clock.advance(140 * 2 + 130 + 10)
    expect(nodes(await ui.drawn()).some(n => n.type === 'Box' && typeof n.props?.marginLeft === 'number' && n.props.marginLeft > 2 && (n.children ?? []).some((c: any) => c?.type === 'Raster'))).toBe(false)
    expect(renders - before).toBeLessThanOrEqual(20)
    // His protest line ends by itself after 5 s (one redraw); after that nothing is pending.
    await w.clock.advance(6000)
    const settled = renders
    await w.clock.advance(5000)
    expect(renders - settled).toBeLessThanOrEqual(idleRate)
  })
  test('the drag has his words: picked up, walks back, finds his page; the third drag in a minute only sighs', async ($, on) => {
    const w = world(on, { store: RECENT, settings: { mouse: true } })
    await $.session.start(START); await settleLegacyStart($, w)
    const ui = await $.ui.mount({ surface: 'terminal', ...fullscreen(100) }); await w.clock.advance(0)
    const pool = ['hey, i was typing', "my keycap's slipping!", 'careful with the sleeves', 'put me back', "you're wrinkling my hoodie"]
    const drag = async () => {
      await ui.pointer({ type: 'down', x: 2, y: 3, button: 'left' })
      await ui.pointer({ type: 'move', x: 3, y: 3, button: 'left' })
      await ui.pointer({ type: 'move', x: 40, y: 3, button: 'left' })
      await w.clock.advance(0)
    }
    const drop = async () => { await ui.pointer({ type: 'up', x: 40, y: 3, button: 'left' }); await w.clock.advance(0) }
    const seen = async () => texts(await ui.drawn()).join('|')
    const said = async () => { const all = await seen(); return pool.find(line => all.includes(line)) }
    // Twelve cells: 420 ms flustered, nine steps of 90 ms, then three of 140 ms, and he is home 20 ms into his page.
    const walk = 420 + 90 * 9 + 140 * 3 + 20
    await drag()
    expect(await seen()).toContain('(picked up)')
    await drop()
    expect(await seen()).toContain('(walks back)')
    expect(await said()).toBeDefined()
    expect(await seen()).not.toContain('(sighs)')
    await w.clock.advance(walk)
    expect(await seen()).toContain('(finds the page)')
    await w.clock.advance(200)
    expect(await seen()).not.toContain('(finds the page)')
    await drag(); await drop()
    expect(await seen()).toContain('(walks back)')
    await w.clock.advance(9000)
    expect(await said()).toBeUndefined()
    await drag(); await drop()
    expect(await seen()).toContain('(sighs)')
    expect(await seen()).not.toContain('(walks back)')
    expect(await said()).toBeUndefined()
    await w.clock.advance(walk)
    expect(await seen()).toContain('(finds the page)')
    // A minute later the count starts again: a line and the plain walk.
    await w.clock.advance(61_000)
    await drag(); await drop()
    expect(await seen()).toContain('(walks back)')
    expect(await said()).toBeDefined()
  })
  test('a tiny lift is nothing, and his name and line keep 18 cells whatever the drag', async ($, on) => {
    const w = world(on, { store: RECENT, settings: { mouse: true } })
    await $.session.start(START); await settleLegacyStart($, w)
    const ui = await $.ui.mount({ surface: 'terminal', ...fullscreen(70) }); await w.clock.advance(0)
    await post(ui, { t: 'drag', dx: 1 }); await post(ui, { t: 'drop', dx: 1 }); await w.clock.advance(0)
    expect(nodes(await ui.drawn()).some(n => n.type === 'Box' && n.props?.marginLeft === 1 && (n.children ?? []).some((c: any) => c?.type === 'Raster'))).toBe(false)
    await post(ui, { t: 'drag', dx: 12 }); await w.clock.advance(0)
    const room = 70 - (TERMINAL_COLUMNS + 2) - 18
    expect(lifted(await ui.drawn(), Math.min(12, room))).toBeDefined()
  })
  test('the pointer coming onto him gives a glance, at most every two seconds', async ($, on) => {
    const w = world(on, { store: RECENT, settings: { mouse: true } })
    await $.session.start(START); await settleLegacyStart($, w)
    const ui = await $.ui.mount({ surface: 'terminal', ...fullscreen(100) }); await w.clock.advance(0)
    const cells = async () => (await ui.find({ type: 'Raster' }))?.props.cells
    expect(typeof await cells()).toBe('string')
    await post(ui, { t: 'glance', side: 'left' }); await w.clock.advance(0)
    expect(typeof await cells()).toBe('string')
    await w.clock.advance(460)
    await post(ui, { t: 'glance', side: 'right' }); await w.clock.advance(0)
    expect(typeof await cells()).toBe('string')
    // A drag takes the face; the glance does not come back over it.
    await post(ui, { t: 'drag', dx: 6 }); await post(ui, { t: 'glance', side: 'left' }); await w.clock.advance(0)
    expect(lifted(await ui.drawn(), 6)).toBeDefined()
  })
})
