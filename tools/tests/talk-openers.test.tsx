// Talk opening up on its own (T5, lane C 10-17; signals and order agreed with lane B 10-16): one line as the chat opens,
// from the group that fits best, and one more after ten quiet minutes with the chat open.
import { installM1Words, M1_MORE_TEXT } from './m1-more-data-fixture'
import { installModelServiceFixture } from './m1-model-service-fixture'
import { describe, expect, test } from 'claude-code/testing'
import type { EngineInterface } from 'claude-code'
import { MoreRuntime } from '../hooks/more-runtime'
import { OPENER_AWAY_MS, OPENER_EVENT_MS, OPENER_QUIET_MS, openerClock, openerGroup, openerPick } from '../hooks/talk-openers'
import type { OpenerFacts } from '../hooks/talk-openers'

installM1Words()
installModelServiceFixture()
const AT = Date.UTC(2026, 9, 14, 14, 0) // a Wednesday, 14:00 in UTC
const facts = (more: Partial<OpenerFacts> = {}): OpenerFacts => ({ now: AT, timeZone: 'UTC', first: false, events: {}, ...more })

describe('Talk openers', () => {
  test('the first group that holds wins, in the order agreed with lane B, and the time of day always holds', () => {
    expect(openerGroup(facts())).toBe('day')
    expect(openerGroup(facts({ first: true, lastActiveAt: AT - OPENER_AWAY_MS, events: { green: AT } }))).toBe('first')
    expect(openerGroup(facts({ lastActiveAt: AT - OPENER_AWAY_MS, events: { calmed: AT } }))).toBe('away')
    expect(openerGroup(facts({ lastActiveAt: AT - OPENER_AWAY_MS + 60_000, events: { calmed: AT, refused: AT } }))).toBe('calmed')
    expect(openerGroup(facts({ events: { refused: AT, red: AT } }))).toBe('refused')
    expect(openerGroup(facts({ events: { red: AT, green: AT } }))).toBe('red')
    expect(openerGroup(facts({ events: { green: AT, ultrathink: AT } }))).toBe('green')
    expect(openerGroup(facts({ events: { ultrathink: AT, bigJob: AT } }))).toBe('ultrathink')
    expect(openerGroup(facts({ events: { bigJob: AT, compacted: AT }, quota: 'out' }))).toBe('bigJob')
    expect(openerGroup(facts({ events: { compacted: AT }, quota: 'out' }))).toBe('compacted')
    expect(openerGroup(facts({ quota: 'out' }))).toBe('quotaOut')
    expect(openerGroup(facts({ quota: 'low', now: Date.UTC(2026, 9, 17, 14) }))).toBe('quotaLow')
  })
  test('an event counts for ten minutes; the clock is theirs: weekend, then night 23 to 5, morning 5 to 11, day', () => {
    expect(openerGroup(facts({ events: { green: AT - OPENER_EVENT_MS } }))).toBe('green')
    expect(openerGroup(facts({ events: { green: AT - OPENER_EVENT_MS - 1 } }))).toBe('day')
    expect(openerGroup(facts({ now: Date.UTC(2026, 9, 17, 23, 30) }))).toBe('weekend') // Saturday
    expect(openerGroup(facts({ now: Date.UTC(2026, 9, 14, 23, 30) }))).toBe('night')
    expect(openerGroup(facts({ now: Date.UTC(2026, 9, 14, 4, 59) }))).toBe('night')
    expect(openerGroup(facts({ now: Date.UTC(2026, 9, 14, 5, 0) }))).toBe('morning')
    expect(openerGroup(facts({ now: Date.UTC(2026, 9, 14, 11, 0) }))).toBe('day')
    // 14:00 UTC is 23:00 in Tokyo
    expect(openerClock(AT, 'Asia/Tokyo')).toEqual({ hour: 23, weekend: false })
    expect(openerGroup(facts({ timeZone: 'Asia/Tokyo' }))).toBe('night')
  })
  test('a line at random from the group, never the one said last time; one line is always that line', () => {
    const lines = ['a', 'b', 'c']
    for (const r of [0, 0.4, 0.99]) expect(openerPick(lines, 1, () => r)).not.toBe(1)
    expect(openerPick(lines, undefined, () => 0.99)).toBe(2)
    expect(openerPick(['only'], 0, () => 0.5)).toBe(0)
    expect(openerPick([], undefined)).toBeUndefined()
  })
})

function fake() {
  let now = AT
  const timers: { at: number; fn: () => void; alive: boolean }[] = []
  let redraws = 0
  const $ = {
    clock: { now: async () => now, after: (ms: number, fn: () => void) => { const timer = { at: now + ms, fn, alive: true }; timers.push(timer); return { cancel: () => { timer.alive = false } } } },
    store: { get: async () => undefined, set: async () => {} },
    ui: { invalidate: () => { redraws++ } },
  } as unknown as EngineInterface
  return {
    $, redraws: () => redraws, now: () => now,
    alive: () => timers.filter(t => t.alive),
    advance: (ms: number) => { now += ms; for (const t of timers.filter(t => t.alive && t.at <= now)) { t.alive = false; t.fn() } },
  }
}
function talk(lines: (quiet: boolean) => string | undefined) {
  const f = fake(), asked: boolean[] = []
  // Talk can only send with its persona, so the shipped one comes along
  const shipped = JSON.parse(M1_MORE_TEXT) as Record<string, Record<string, string>>
  const words = { 'more.model.talk.persona': shipped['more.model.talk.persona']!.en!, 'more.model.talk.compact': shipped['more.model.talk.compact']!.en! }
  const r = new MoreRuntime(words, { talkFacts: () => ({ now: f.now(), timeZone: 'UTC', working: false }) as never, opener: quiet => { asked.push(quiet); return lines(quiet) } })
  r.restore({ talk: true }, [], undefined, AT)
  return { f, r, asked, her: () => r.talkView.filter(b => b.side === 'him').map(b => b.text) }
}

describe('Talk opening up', () => {
  test('one line as Talk opens, none on a redraw, the next opening may speak again once the first was answered', () => {
    const t = talk(quiet => quiet ? 'quiet line' : 'hello')
    t.r.talkHidden(); t.r.talkShown(t.f.$)
    expect(t.her()).toEqual(['hello'])
    t.r.talkShown(t.f.$); t.r.talkShown(t.f.$)
    expect(t.her()).toEqual(['hello'])
    // closed and opened again at once: her line still stands unanswered, so she waits
    t.r.talkHidden(); t.r.talkShown(t.f.$)
    expect(t.her()).toEqual(['hello'])
    // ten minutes on it is a new opening
    t.r.talkHidden(); t.f.advance(OPENER_QUIET_MS); t.r.talkShown(t.f.$)
    expect(t.her()).toEqual(['hello', 'hello'])
    // her opener rides in the history, so a reply to it makes sense
    expect(t.r.exchanges.at(-1)).toEqual({ side: 'him', text: 'hello' })
  })
  test('after ten quiet minutes with Talk open one more line, then nothing more while nobody writes', () => {
    const t = talk(quiet => quiet ? 'quiet line' : 'hello')
    t.r.talkHidden(); t.r.talkShown(t.f.$)
    t.f.advance(OPENER_QUIET_MS - 1)
    expect(t.her()).toEqual(['hello'])
    t.f.advance(1)
    expect(t.her()).toEqual(['hello', 'quiet line'])
    expect(t.f.redraws()).toBe(1)
    t.f.advance(OPENER_QUIET_MS * 3)
    expect(t.her()).toEqual(['hello', 'quiet line'])
    expect(t.f.alive()).toEqual([])
  })
  test('closing Talk stops the quiet clock; with Talk off, or no words, she says nothing', () => {
    const t = talk(() => 'hello')
    t.r.talkHidden(); t.r.talkShown(t.f.$); t.r.talkHidden()
    expect(t.f.alive()).toEqual([])
    const silent = talk(() => undefined)
    silent.r.talkHidden(); silent.r.talkShown(silent.f.$)
    expect(silent.her()).toEqual([])
    const off = talk(() => 'hello')
    off.r.restore({ talk: false }, [], undefined, AT)
    off.r.talkHidden(); off.r.talkShown(off.f.$)
    expect(off.her()).toEqual([])
    expect(off.asked).toEqual([])
  })
})

// Talk remembers them across sessions (owner 10-17: 「记住最近的聊天」): the newest plain chat goes to the store after each
// message, secrets hidden, and the next session's Talk starts from it; switching Talk off forgets it.
function chat(reply: string) {
  const f = fake(), remembered: unknown[] = []
  const shipped = JSON.parse(M1_MORE_TEXT) as Record<string, Record<string, string>>
  const words = { 'more.model.talk.persona': shipped['more.model.talk.persona']!.en!, 'more.model.talk.compact': shipped['more.model.talk.compact']!.en! }
  const $ = { ...(f.$ as object), model: { complete: async () => ({ isAnswered: true, text: reply, usage: { input_tokens: 900, output_tokens: 40, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }) }, prompt: { fill: async () => {} } } as unknown as EngineInterface
  const r = new MoreRuntime(words, { talkFacts: () => ({ now: f.now(), timeZone: 'UTC', working: false }) as never, remember: memory => { remembered.push(structuredClone(memory)) } })
  r.restore({ talk: true }, [], undefined, AT)
  return { $, r, remembered, words }
}

describe('Talk remembering them', () => {
  test('each message hands the newest plain chat to be kept; a secret that got into the chat is hidden in it', async () => {
    const c = chat('nice, the parser again')
    await c.r.talk(c.$, 'the parser broke again', AT)
    const last = c.remembered.at(-1) as { exchanges: { side: string; text: string }[] }
    expect(last.exchanges).toEqual([{ side: 'person', text: 'the parser broke again' }, { side: 'him', text: 'nice, the parser again' }])
    // a message holding a secret is never sent (the paste guard); were one in the chat, what is kept hides it
    const kept = chat('hi')
    kept.r.restoreTalk({ exchanges: [{ side: 'person', text: 'my token is ghp_abcdefghijklmnopqrstuvwxyz0123456789 lol' }, { side: 'him', text: 'yikes' }] })
    expect(JSON.stringify(kept.r.talkMemory())).not.toContain('abcdefghijklmnopqrstuvwxyz0123456789')
    expect(kept.r.talkMemory()?.exchanges.length).toBe(2)
  })
  test('the next session starts from it; a damaged record keeps only what reads; switching Talk off forgets', () => {
    const c = chat('hi')
    c.r.restoreTalk({ exchanges: [{ side: 'person', text: 'remember me?' }, { side: 'him', text: 'always' }, { side: 'robot', text: 'x' }, 7], summary: 'they fix parsers' })
    expect(c.r.talkView.map(item => item.text)).toEqual(['remember me?', 'always'])
    expect(c.r.exchanges.length).toBe(2)
    // a chat already under way is never replaced
    c.r.restoreTalk({ exchanges: [{ side: 'person', text: 'other' }] })
    expect(c.r.talkView.map(item => item.text)).toEqual(['remember me?', 'always'])
    c.r.restore({ talk: false }, [], undefined, AT)
    expect(c.remembered.at(-1)).toBeUndefined()
    expect(c.r.talkView).toEqual([])
  })
})
