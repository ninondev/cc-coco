// The DM thread (owner's cards 10-17 late: 「小窗 / DMs」, one thread in the plugin and on the pet, her first messages from
// her lines by default and by the model behind a switch, unread marks and notifications): her pace, the thread's
// unread count, what reaches the band and the pet.
import { installM1Words, M1_MORE_TEXT } from './m1-more-data-fixture'
import { installModelServiceFixture, modelServiceFixtureText } from './m1-model-service-fixture'
import { describe, expect, test } from 'claude-code/testing'
import type { EngineInterface } from 'claude-code'
import { MoreRuntime } from '../hooks/more-runtime'
import { MorePage } from '../hooks/more-book'
import { companionDm, companionRecord, COMPANION_DM_CHARS, COMPANION_DM_LINES } from '../hooks/companion'
import { CompanionChannel } from '../hooks/channel'
import { initialView } from '../hooks/mood'
import { normalizeDesktopView } from '../hooks/desktop-safe'
import { WORDS } from '../hooks/words'
import { DM_BACK_MS, DM_CLOCK_MS, DM_DAY_CAP, DM_GAP_MS, DM_MOMENTS, DM_MOMENT_MS, DM_PREVIEW, dmInitial, dmMoment, dmMomentLine, dmPreview, dmState, dmWrote, dmSpoken } from '../hooks/dm'
import type { DmState } from '../hooks/dm'
import type { OpenerFacts } from '../hooks/talk-openers'
import { world, settleLegacyStart, RECENT, PERSON } from './world'

installM1Words()
installModelServiceFixture()
const AT = Date.UTC(2026, 9, 14, 14, 0) // a Wednesday, 14:00 in UTC: no clock moment
const facts = (more: Partial<OpenerFacts> = {}): OpenerFacts => ({ now: AT, timeZone: 'UTC', first: false, events: {}, ...more })

describe('DM pace', () => {
  test('she writes about a reason a friend would text: back after half an hour, an event, the quota, the clock', () => {
    const fresh = dmInitial()
    expect(dmMoment(fresh, facts())).toBeUndefined()
    expect(dmMoment(fresh, facts({ lastActiveAt: AT - DM_BACK_MS }))).toBe('away')
    expect(dmMoment(fresh, facts({ lastActiveAt: AT - DM_BACK_MS + 1 }))).toBeUndefined()
    // the openers' own groups that are no reason to text first: the chat's first opening, a refusal, red tests, ultrathink
    expect(dmMoment(fresh, facts({ first: true, events: { refused: AT, red: AT, ultrathink: AT } }))).toBeUndefined()
    expect(dmMoment(fresh, facts({ events: { red: AT, green: AT } }))).toBe('green')
    expect(dmMoment(fresh, facts({ events: { bigJob: AT }, quota: 'low' }))).toBe('bigJob')
    expect(dmMoment(fresh, facts({ quota: 'out' }))).toBe('quotaOut')
    expect(dmMoment(fresh, facts({ now: Date.UTC(2026, 9, 14, 23, 30) }))).toBe('night')
    expect(dmMoment(fresh, facts({ now: Date.UTC(2026, 9, 14, 8, 0) }))).toBe('morning')
    expect(dmMoment(fresh, facts({ now: Date.UTC(2026, 9, 17, 14, 0) }))).toBe('weekend')
    for (const moment of DM_MOMENTS) expect(dmMomentLine(moment)).not.toBe('')
  })
  test('45 minutes between hers, a kind of moment once in six hours and the clock once a day, six a day, two unanswered', () => {
    let state = dmWrote(dmInitial(), 'green', AT, 1)
    expect(state).toMatchObject({ unread: 1, written: 1, lastAt: AT, unanswered: 1, moments: { green: AT } })
    const later = (ms: number, more: Partial<OpenerFacts> = {}) => facts({ now: AT + ms, ...more })
    expect(dmMoment(state, later(DM_GAP_MS - 1, { events: { bigJob: AT + DM_GAP_MS - 1 } }))).toBeUndefined()
    expect(dmMoment(state, later(DM_GAP_MS, { events: { bigJob: AT + DM_GAP_MS } }))).toBe('bigJob')
    expect(dmMoment(state, later(DM_GAP_MS, { events: { green: AT + DM_GAP_MS } }))).toBeUndefined()
    expect(dmMoment(state, later(DM_MOMENT_MS, { events: { green: AT + DM_MOMENT_MS } }))).toBe('green')
    const night = Date.UTC(2026, 9, 14, 23, 0)
    state = dmWrote(dmInitial(), 'night', night, 1)
    expect(dmMoment(state, facts({ now: night + 5 * 3_600_000 }))).toBeUndefined() // 04:00, still night
    expect(DM_CLOCK_MS).toBeLessThan(24 * 3_600_000)
    expect(dmMoment(state, facts({ now: night + 24 * 3_600_000 }))).toBe('night') // the next night
    // unanswered twice, she waits until the person writes
    state = dmWrote(dmWrote(dmInitial(), 'green', AT, 1), 'bigJob', AT + DM_GAP_MS, 1)
    expect(dmMoment(state, later(DM_MOMENT_MS, { quota: 'out' }))).toBeUndefined()
    expect(dmMoment({ ...state, unanswered: 0 }, later(DM_MOMENT_MS, { quota: 'out' }))).toBe('quotaOut')
    // the day's cap, and a new day
    const full: DmState = { ...dmInitial(), day: '2026-10-14', written: DM_DAY_CAP }
    expect(dmMoment(full, facts({ quota: 'out' }))).toBeUndefined()
    expect(dmMoment(full, facts({ now: Date.UTC(2026, 9, 15, 14, 0), quota: 'out' }))).toBe('quotaOut')
  })
  test('a stored state is read field by field; anything else starts fresh', () => {
    expect(dmState(undefined)).toEqual(dmInitial())
    expect(dmState('nope')).toEqual(dmInitial())
    expect(dmState({ unread: 5000, day: '2026-10-14', written: 99, lastAt: AT, unanswered: 9, moments: { green: AT, day: AT, away: -1, night: 'x' }, first: 'model', notify: false }))
      .toEqual({ unread: 999, day: '2026-10-14', written: DM_DAY_CAP, lastAt: AT, unanswered: 2, moments: { green: AT }, first: 'model', notify: false })
    expect(dmState({ unread: 1.5, day: 'Monday', lastAt: NaN, first: 'x' })).toEqual(dmInitial())
  })
  test('a notification shows one line, cut at a word', () => {
    expect(dmPreview('  you   back?\n\nmissed you ')).toBe('you back? missed you')
    const long = 'word '.repeat(60)
    const cut = dmPreview(long)
    expect([...cut].length).toBeLessThanOrEqual(DM_PREVIEW)
    expect(cut.endsWith('word…')).toBe(true)
    expect([...dmPreview('好'.repeat(200))].length).toBe(DM_PREVIEW)
  })
})

function fake() {
  let now = AT
  const stored = new Map<string, unknown>()
  const $ = {
    clock: { now: async () => now, after: () => ({ cancel: () => {} }) },
    store: { get: async (key: string) => stored.get(key), set: async (key: string, value: unknown) => { stored.set(key, value) } },
    ui: { invalidate: () => {} },
  } as unknown as EngineInterface
  return { $, now: () => now, set: (at: number) => { now = at } }
}
const shipped = JSON.parse(M1_MORE_TEXT) as Record<string, Record<string, string>>
const FIRST = 'Text them first about this, casually, one to three short messages: {moment}'
function thread(options: { first?: boolean; reply?: string; answered?: boolean; line?: string } = {}) {
  const f = fake(), arrived: string[][] = [], changed: DmState[] = [], remembered: unknown[] = [], requests: { system: string; prompt: string; maxTokens?: number }[] = []
  const words = { 'more.model.talk.persona': shipped['more.model.talk.persona']!.en!, ...(options.first ? { 'more.model.talk.first': FIRST } : {}) }
  const $ = { ...(f.$ as object), model: { complete: async (request: { system: string; prompt: string; maxTokens?: number }) => {
    requests.push(request)
    return options.answered === false ? { isAnswered: false, reason: 'error', usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }
      : { isAnswered: true, text: options.reply ?? 'ok', usage: { input_tokens: 900, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }
  } }, prompt: { fill: async () => {} } } as unknown as EngineInterface
  const r = new MoreRuntime(words, {
    talkFacts: () => ({ now: f.now(), timeZone: 'UTC', working: false }) as never,
    opener: () => 'opener line',
    dmLine: moment => options.line ?? `line for ${moment}`,
    dmChanged: state => { changed.push(structuredClone(state)) },
    dmArrived: texts => { arrived.push(texts) },
    remember: memory => { remembered.push(memory) },
  })
  r.restore({ talk: true }, [], undefined, AT)
  return { f, $, r, arrived, changed, remembered, requests, her: () => r.talkView.filter(b => b.side === 'him').map(b => b.text) }
}

describe('DM thread', () => {
  // His card of 10-17 late via lane B: a first message sent while the thread is closed, and its notice, leave off a
  // leading stage direction in brackets; the live opener in an open thread keeps it.
  test('a first message sent as a DM leaves off a leading action in brackets, in the thread and the notice', async () => {
    expect(dmSpoken('(呆毛立正)回来啦?')).toBe('回来啦?')
    expect(dmSpoken('（伸懒腰） 早')).toBe('早')
    expect(dmSpoken('(stretches) you back?')).toBe('you back?')
    expect(dmSpoken('you back? (still here)')).toBe('you back? (still here)')
    expect(dmSpoken('(waves)')).toBe('(waves)')
    expect(dmSpoken('hi')).toBe('hi')
    const t = thread({ line: '(呆毛立正) you back?' })
    expect(await t.r.dmFirst(t.$, facts({ lastActiveAt: AT - DM_BACK_MS }))).toBe(true)
    expect(t.her()).toEqual(['you back?'])
    expect(t.arrived).toEqual([['you back?']])
  })
  test('while the thread is closed she writes one of her lines: in the history, unread, notified; seen once it opens', async () => {
    const t = thread()
    expect(await t.r.dmFirst(t.$, facts({ events: { green: AT } }))).toBe(true)
    expect(t.her()).toEqual(['line for green'])
    expect(t.r.exchanges.at(-1)).toEqual({ side: 'him', text: 'line for green' })
    expect(t.r.dm()).toMatchObject({ unread: 1, written: 1, unanswered: 1 })
    expect(t.arrived).toEqual([['line for green']])
    expect(t.changed.at(-1)?.unread).toBe(1)
    expect(t.r.snapshot().dm).toEqual({ first: 'lines', notify: true, model: false, unread: 1 })
    // the chat is kept for the next session with her message in it
    expect(JSON.stringify(t.remembered.at(-1))).toContain('line for green')
    // opened hours later: seen, and her unanswered message stands, so no opener on top
    t.f.set(AT + 3 * 3_600_000)
    t.r.talkShown(t.f.$)
    expect(t.r.dm().unread).toBe(0)
    expect(t.changed.at(-1)?.unread).toBe(0)
    expect(t.her()).toEqual(['line for green'])
  })
  test('nothing while the thread is open or Talk is off; the person writing lets her write first again', async () => {
    const open = thread()
    open.r.talkShown(open.f.$)
    expect(await open.r.dmFirst(open.$, facts({ events: { green: AT } }))).toBe(false)
    const off = thread()
    off.r.restore({ talk: false }, [], undefined, AT)
    expect(await off.r.dmFirst(off.$, facts({ events: { green: AT } }))).toBe(false)
    const t = thread({ reply: 'haha yeah' })
    await t.r.dmFirst(t.$, facts({ events: { green: AT } }))
    await t.r.dmFirst(t.$, facts({ now: AT + DM_GAP_MS, events: { bigJob: AT + DM_GAP_MS } }))
    expect(t.r.dm().unanswered).toBe(2)
    expect(await t.r.dmFirst(t.$, facts({ now: AT + 2 * DM_GAP_MS, quota: 'out' }))).toBe(false)
    t.r.talkShown(t.f.$)
    await t.r.talk(t.$, 'sorry, was busy', AT + 2 * DM_GAP_MS)
    expect(t.r.dm().unanswered).toBe(0)
  })
  test('a reply that reaches the closed thread is unread and notified, each of its messages', async () => {
    const t = thread({ reply: 'oh nice\n\nwhat broke' })
    await t.r.talk(t.$, 'the parser works now', AT)
    const texts = t.arrived.at(-1)!
    expect(texts.join(' ')).toContain('oh nice')
    expect(texts.join(' ')).toContain('what broke')
    expect(t.r.dm().unread).toBe(texts.length)
  })
  test('with the model on, one call writes up to three texts about the moment; a failed call falls back to her line', async () => {
    const t = thread({ first: true, reply: 'wait\n\nyou back??\n\nthought the bug ate you\n\nlol' })
    expect(t.r.snapshot().dm?.model).toBe(true)
    t.r.setDm({ first: 'model' })
    expect(t.changed.at(-1)?.first).toBe('model')
    expect(await t.r.dmFirst(t.$, facts({ lastActiveAt: AT - DM_BACK_MS }))).toBe(true)
    expect(t.requests.length).toBe(1)
    const request = t.requests[0]!
    expect(request.system).toBe(shipped['more.model.talk.persona']!.en!)
    expect(request.maxTokens).toBe(300)
    expect(request.prompt).toContain(dmMomentLine('away'))
    expect(request.prompt).toContain('Text them first about this')
    // Lane B's instruction ends «Write in the language named at the end»: the request's last line names it.
    expect(request.prompt.split('\n').at(-1)).toBe('Write in English, actions in brackets too.')
    expect(t.her().length).toBeGreaterThanOrEqual(1)
    expect(t.her().length).toBeLessThanOrEqual(3)
    expect(t.r.dm().unread).toBe(t.her().length)
    const failed = thread({ first: true, answered: false })
    failed.r.setDm({ first: 'model' })
    await failed.r.dmFirst(failed.$, facts({ events: { green: AT } }))
    expect(failed.her()).toEqual(['line for green'])
    // without lane B's instruction the model is never offered, and her lines are used whatever was stored
    const lines = thread()
    lines.r.restoreDm({ first: 'model' })
    expect(lines.r.snapshot().dm?.model).toBe(false)
    await lines.r.dmFirst(lines.$, facts({ events: { green: AT } }))
    expect(lines.requests).toEqual([])
    expect(lines.her()).toEqual(['line for green'])
  })
  test('another window\'s pace and choices come from the store; switching Talk off empties the thread, a session\'s end keeps it', async () => {
    const t = thread()
    t.r.shareDm({ lastAt: AT - 60_000, notify: false, unread: 7 })
    expect(t.r.dm()).toMatchObject({ lastAt: AT - 60_000, notify: false, unread: 0 })
    expect(await t.r.dmFirst(t.$, facts({ events: { green: AT } }))).toBe(false)
    t.r.shareDm(undefined)
    expect(t.r.dm().notify).toBe(false)
    const kept = thread()
    await kept.r.dmFirst(kept.$, facts({ events: { green: AT } }))
    kept.r.stop()
    expect(kept.remembered.includes(undefined)).toBe(false)
    const off = thread()
    await off.r.dmFirst(off.$, facts({ events: { green: AT } }))
    off.r.restore({ talk: false }, [], undefined, AT)
    expect(off.remembered.at(-1)).toBeUndefined()
    expect(off.r.dm()).toMatchObject({ unread: 0, unanswered: 0 })
    expect(off.changed.at(-1)?.unread).toBe(0)
  })
})

describe('DM on the band, in the bag and on the pet', () => {
  test('while Talk is on the pet gets the unread count, the newest notice and the thread; the desktop band keeps a whole count', () => {
    const notice = { id: 'dm:1', at: AT, title: 'Coco', body: 'you back?' }
    companionDm(false)
    expect('dm' in companionRecord({ ...initialView(), dm: { unread: 2 }, dmNotice: notice })).toBe(false)
    const words = { label: 'DMs', placeholder: 'Message Coco...' }
    companionDm(true, [{ side: 'him', text: 'you back?' }], words, true)
    expect(companionRecord({ ...initialView(), dm: { unread: 2 }, dmNotice: notice }).dm).toEqual({ unread: 2, notice, thread: [{ side: 'him', text: 'you back?' }], words, notify: true })
    companionDm(true, undefined, undefined, false)
    expect(companionRecord(initialView()).dm).toEqual({ unread: 0, thread: [{ side: 'him', text: 'you back?' }], words, notify: false })
    // Talk on again without a thread keeps the one it has; a long one is cut to its newest lines, each line to its length
    companionDm(true)
    expect(companionRecord(initialView()).dm?.thread.length).toBe(1)
    companionDm(true, Array.from({ length: COMPANION_DM_LINES + 5 }, (_, i) => ({ side: i % 2 ? 'person' as const : 'him' as const, text: `${i} ` + 'x'.repeat(COMPANION_DM_CHARS) })))
    const thread = companionRecord(initialView()).dm!.thread
    expect(thread.length).toBe(COMPANION_DM_LINES)
    expect(thread[0]!.text.startsWith('5 ')).toBe(true)
    expect([...thread[0]!.text].length).toBe(COMPANION_DM_CHARS)
    companionDm(false)
    expect(companionRecord(initialView()).dm).toBeUndefined()
    const defaults = initialView()
    expect(normalizeDesktopView({ ...defaults, dm: { unread: 3 } }, defaults, []).dm).toEqual({ unread: 3 })
    expect(normalizeDesktopView({ ...defaults, dm: { unread: 1.5 } }, defaults, []).dm).toBeUndefined()
    expect(normalizeDesktopView({ ...defaults, dm: { unread: 5000 } }, defaults, []).dm).toEqual({ unread: 999 })
  })
  for (const surface of ['terminal', 'mobile'] as const) test(`the bag's Talk row offers notifications, and the model only once its instruction is there: ${surface}`, async ($, on) => {
    const base = { values: { talk: true }, agreed: ['talk' as const], today: { date: '', rows: {} }, reading: 0, open: true, lang: 'en', screenReader: false }
    let dm = { first: 'lines' as const, notify: true, model: false, unread: 0 }
    on('ui.render', { component: 'Pane', requestId: 'dm-bag' }, ($, e) => MorePage($.ui.resolve(e) as never, { surface: e.surface, snapshot: { ...base, dm } } as never))
    world(on, { surfaces: [surface] })
    const mount = () => $.ui.mount({ surface, plugin: 'coco', component: 'Pane', requestId: 'dm-bag', props: { title: WORDS.en.name, isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 200 }, view: {} } })
    let ui = await mount()
    if (surface === 'terminal') {
      expect(await ui.find({ key: 'coco:more:dm:notify' })).toBeDefined()
      expect(await ui.find({ key: 'coco:more:dm:first' })).toBeUndefined()
    } else {
      expect(await ui.find({ type: 'Button', key: 'coco:more:dm:notify:off' })).toBeDefined()
      expect(await ui.find({ type: 'Button', key: 'coco:more:dm:first:model' })).toBeUndefined()
    }
    await ui.unmount()
    dm = { ...dm, model: true }
    ui = await mount()
    expect(await ui.find(surface === 'terminal' ? { key: 'coco:more:dm:first' } : { type: 'Button', key: 'coco:more:dm:first:model' })).toBeDefined()
    await ui.unmount()
  })
})

// The pet's DM window writes into the request log like a note, but a 'dm' line goes into Talk (owner's card: read or
// reply on either): fresh, its own rate, refused without a receipt so the pet may send it again; 'dmSeen' clears unread.
test('DM a message from the pet goes into Talk; refused, it gets no receipt; seen is passed on; the pace holds', async () => {
  let now = AT, receive: ((text: string) => Promise<void>) | undefined, accept = true, seen = 0
  const acks: string[] = [], dms: string[] = []
  const channel = new CompanionChannel({ exists: async () => true, now: async () => now, listen: input => { receive = input; return () => { receive = undefined } } }, 's1', '/tmp/dm-pet', {
    dm: text => { dms.push(text); return accept },
    dmSeen: () => { seen++ },
    running: () => {}, seen: () => {}, ack: async id => { acks.push(id) }, changed: async () => {},
  })
  await channel.start()
  const send = (n: number, kind: string, more: Record<string, unknown> = {}) => receive!(JSON.stringify({ v: 1, id: n.toString(16).padStart(16, '0'), session: 's1', at: now, kind, ...more }) + '\n')
  await send(1, 'dm', { text: '  you there? ' })
  expect(dms).toEqual(['you there?'])
  expect(acks).toEqual(['0000000000000001'])
  now += 3000; accept = false
  await send(2, 'dm', { text: 'hello?' })
  expect(acks.length).toBe(1)
  accept = true
  await send(2, 'dm', { text: 'hello?' })
  expect(acks.at(-1)).toBe('0000000000000002')
  // two seconds apart at least; another session's line, an empty one, a stale one are dropped
  await send(3, 'dm', { text: 'too soon' })
  now += 3000
  await send(4, 'dm', { text: 'x', session: 's2' })
  await send(5, 'dm', { text: '   ' })
  await send(6, 'dm', { text: 'old', at: now - 61_000 })
  expect(dms).toEqual(['you there?', 'hello?', 'hello?'])
  await send(7, 'dmSeen')
  expect(seen).toBe(1)
  channel.stop()
})

// The whole plugin: she writes first as the session starts in the morning; the band's DM entry carries the count, a toast
// and the pet's notice say it, and /coco dm opens the thread. With notifications off the count stays and nothing pops up.
const START = { cwd: '/tmp/dm-fixture', surface: 'terminal' as const, isInteractive: true }
function plugin(on: Parameters<typeof world>[0], dm?: unknown) {
  on('model.complete', () => ({ value: { isAnswered: true, text: 'fixture reply', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }))
  on('http.fetch', () => ({ deny: 'unexpected fixture network request' }))
  on('agent.list', () => ({ value: [] })); on('session.messages', () => ({ value: [] })); on('session.model', () => ({ value: 'fixture model' })); on('session.repo', () => ({ value: null }))
  on('fs.write', () => ({ value: undefined })); on('process.run', () => ({ value: { exitCode: 0, stdout: '{"ok":true,"result":{},"ensured":true,"claimed":true}', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  const data = JSON.parse(modelServiceFixtureText()) as Record<string, Record<string, string>>
  data['more.model.talk.persona'] = { en: 'fixture talk persona' }
  const more = { talk: true }
  return world(on, { surfaces: ['terminal'], observeStore: true, env: { HOME: '/tmp/dm-fixture-home', LANG: 'en_US.UTF-8', TERM: 'xterm-256color' }, moreText: JSON.stringify(data),
    store: { ...RECENT, more, 'more.agreed': ['talk'], ...(dm === undefined ? {} : { dm }), bandSettings: { voice: 'off', voiceChosen: true, band: 'compact', guard: false, bookmark: false, notes: false, more } } })
}
test('DM she writes first at a morning start: the band entry with the count, a toast, the pet\'s notice, /coco dm', async ($, on) => {
  const w = plugin(on)
  await $.session.start(START); await settleLegacyStart($, w)
  for (let i = 0; i < 4; i++) await w.clock.advance(0)
  const view = w.view()
  expect(view.dm).toEqual({ unread: 1 })
  expect(view.moreActions?.find(action => action.key === 'coco:dm:open')?.label).toBe('DMs 1')
  expect(w.toasts.filter(text => text.startsWith('New message from Coco: ')).length).toBe(1)
  expect(view.dmNotice?.title).toBe('New message from Coco')
  expect(w.toasts.some(text => text === `New message from Coco: ${view.dmNotice?.body}`)).toBe(true)
  expect((w.stored('dm') as DmState | undefined)?.unread).toBe(1)
  // a prompt right after: back from a minute ago and under her 45 minutes, so nothing more
  await $.prompt.submit({ text: 'hi', wait: false, origin: PERSON })
  for (let i = 0; i < 4; i++) await w.clock.advance(0)
  expect(w.toasts.filter(text => text.startsWith('New message from Coco: ')).length).toBe(1)
  const before = w.opens.length
  await $.command.run({ command: 'coco', args: 'dm', origin: PERSON, presentation: { isFullscreen: false, columns: 100 } })
  expect(w.opens.length).toBeGreaterThan(before)
})
test('DM with notifications off the count still reaches the band and nothing pops up', async ($, on) => {
  const w = plugin(on, { notify: false })
  await $.session.start(START); await settleLegacyStart($, w)
  for (let i = 0; i < 4; i++) await w.clock.advance(0)
  expect(w.view().dm).toEqual({ unread: 1 })
  expect(w.toasts.filter(text => text.startsWith('New message from Coco: '))).toEqual([])
  expect(w.view().dmNotice).toBeUndefined()
})
