// Actual C2 event wiring. Imports exist in the pinned pre-C2 plugin too, so the
// baseline fails on missing behaviour rather than on an unresolved new module.
import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { BOOK_FILES } from './book-files'
import { RECENT, PERSON, P, SUMMARY, settleLegacyStart, world } from './world'

const START = { cwd: '/tmp/c2-events', surface: 'vscode' as const, isInteractive: true }
const PANE = { plugin: 'coco', component: 'Pane' as const, requestId: 'coco-book', props: { title: 'Coco', isFocused: true, bodyColumns: 64, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} } }
const words = JSON.parse(BOOK_FILES['en.json']!)
const cacheLine = (percent: number): string => words.offerings.cache.replace('{p}', String(percent))
const complete = (turnId: string, agentId?: string, input = 120, read = 800, create = 80) => ({ turnId, answer: 'done', reason: 'answer' as const, durationMs: 900, isAborted: false, ...(agentId === undefined ? {} : { agentId }), usage: { model: 'test', input_tokens: input, output_tokens: 9999, cache_read_input_tokens: read, cache_creation_input_tokens: create } })
const text = (value: unknown): string => typeof value === 'string' ? value : Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text((value as { children?: unknown }).children) : ''
const command = ($: any, args: string) => $.command.run({ command: 'coco', args, origin: PERSON, presentation: P })

function stampWrites(on: On) {
  const writes: Record<string, number>[] = []
  on('store.*', ($, e, next) => {
    if (next.is('store.set', e) && e.key === 'stamps') writes.push({ ...(e.value as Record<string, number>) })
    return next(e)
  })
  return writes
}

// Nothing writes the old achievements key any more (DECISIONS 1035).
test('C2 a prompt about python no longer brings Shiori out or earns a stamp', async ($, on) => {
  const writes = stampWrites(on)
  const w = world(on, { store: RECENT })
  await $.session.start(START); await settleLegacyStart($, w)
  await $.prompt.submit({ text: 'python', wait: false, origin: PERSON })
  expect(w.view().mood).not.toBe('snake')
  expect(writes).toEqual([])
})

// Her shed while the chat is compacted shows the same snake, and earns nothing either (lane A, 10-17).
test('C2 a compaction brings the snake and no Peekaboo', async ($, on) => {
  const writes = stampWrites(on)
  on('session.compact', { trigger: 'manual' }, () => ({ messages: [SUMMARY], tokensBefore: 1000, tokensAfter: 100 }))
  const w = world(on, { store: RECENT })
  await $.session.start(START); await settleLegacyStart($, w)
  await $.session.compact({ trigger: 'manual', messages: [SUMMARY] })
  expect(w.view().mood).toBe('snake')
  await w.clock.advance(2000); await settleLegacyStart($, w)
  expect(writes).toEqual([])
})

test('C2 cache counts weighted main completions only and clear resets the session denominator', async ($, on) => {
  const w = world(on, { store: RECENT, surfaces: ['vscode'], stepUsage: complete('stream', undefined, 0, 9000, 0).usage })
  await $.session.start(START); await settleLegacyStart($, w)
  await $.turn.start({ text: 'cache', turnId: 'cache-main' })
  for await (const _ of $.turn.step({ turnId: 'cache-main', index: 0, model: 'test', messageCount: 1 })) {}
  await $.turn.complete(complete('first'))
  await $.turn.complete(complete('agent', 'worker', 0, 9000, 0))
  await $.turn.complete(complete('second', undefined, 700, 100, 200))
  await command($, 'usage')
  const ui = await $.ui.mount({ surface: 'vscode', ...PANE })
  expect(text(await ui.drawn())).toContain(cacheLine(45))
  await $.command.run({ command: 'clear', args: '', origin: PERSON, presentation: P })
  await command($, 'usage'); await ui.redraw()
  expect(text(await ui.drawn())).not.toContain(cacheLine(45))
  await $.turn.complete(complete('after-clear', undefined, 500, 500, 0))
  await command($, 'usage'); await ui.redraw()
  expect(text(await ui.drawn())).toContain(cacheLine(50))
  expect(text(await ui.drawn())).not.toContain(cacheLine(47))
  await ui.unmount()
})

test('C2 every reminder action updates effective and durable settings and survives a fresh host session', async ($, on) => {
  let record: Record<string, unknown> = { voice: 'full', voiceChosen:true, future: { retained: true } }
  const saved: Record<string, unknown>[] = []
  on('store.*', ($, e, next) => {
    if (next.is('store.get', e) && e.key === 'bandSettings') return { value: record } as never
    if (next.is('store.set', e) && e.key === 'bandSettings') { record = { ...(e.value as Record<string, unknown>) }; saved.push({ ...record }) }
    return next(e)
  })
  const choices: [string, unknown][] = [ ['guard:off', false], ['guard:on', true], ['bookmark:off', false], ['bookmark:on', true], ['notes:off', false], ['notes:on', true], ['budget:50', 50], ['budget:80', 80], ['budget:90', 90], ['budget:off', 'off'], ['neighbours:on', true], ['neighbours:off', false], ['guard:off', false], ['bookmark:off', false], ['notes:off', false], ['budget:90', 90], ['neighbours:on', true] ]
  // A mocked macOS host exposes the actual Neighbours row on both native and
  // Windows-root path runs. No installed app or native process is involved.
  on('fs.exists', { path: /SystemVersion\.plist$/ }, () => ({ value: true }))
  const w = world(on, { store: { ...RECENT, bandSettings: record }, env: { HOME: '/tmp/c2-reminder-fixture', LANG: 'en_US.UTF-8' }, limits: [{ kind: 'five_hour', percentUsed: 10 }] })
  await $.session.start(START); await settleLegacyStart($, w)
  await command($, 'settings')
  const ui = await $.ui.mount({ surface: 'vscode', ...PANE })
  const effective: Record<string, unknown> = { guard: true, bookmark: true, notes: true, budget: 'off', neighbours: false }
  const choiceFor = (key: string, value: unknown) => typeof value === 'boolean' ? value ? 'on' : 'off' : String(value)
  for (const [key, value] of Object.entries(effective)) expect((await ui.find({ key: `coco:set:${key}:${choiceFor(key, value)}` }))?.props.variant).toBe('primary')
  for (const [choice, value] of choices) {
    const key = choice.split(':')[0]!
    const before = saved.length
    await ui.press({ key: `coco:set:${choice}` }); await settleLegacyStart($, w)
    effective[key] = value
    expect(saved.length).toBe(before + 1)
    expect(record).toMatchObject({ ...effective, voice: 'full', future: { retained: true } })
    expect((await ui.find({ key: `coco:set:${choice}` }))?.props.variant).toBe('primary')
    for (const other of (await ui.findAll({ type: 'Button' })).filter(button => button.key?.startsWith(`coco:set:${key}:`) && button.key !== `coco:set:${choice}`)) expect(other.props.variant).not.toBe('primary')
  }
  await ui.unmount()
  w.resetHostState()
  await $.session.start(START); await settleLegacyStart($, w)
  await command($, 'settings')
  const restored = await $.ui.mount({ surface: 'vscode', ...PANE })
  for (const [key, value] of Object.entries(effective)) expect((await restored.find({ key: `coco:set:${key}:${choiceFor(key, value)}` }))?.props.variant).toBe('primary')
  expect(record).toMatchObject({ ...effective, future: { retained: true } })
  await restored.unmount()
})
