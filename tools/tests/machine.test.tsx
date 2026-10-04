// The state machine, driven through the events a session raises, on a clock the test moves.

import { describe, expect, test } from 'claude-code/testing'
import { LINES } from '../hooks/lines'
import { VOICE } from '../hooks/voice'
import { WORDS } from '../hooks/words'
import { PAINTED_FRAMES } from '../hooks/painted-frames'
import { P, PERSON, RECENT, band, desktopPicture, world } from './world'

const EN = LINES.en
const START = { cwd: '/tmp/project', surface: 'terminal' as const, isInteractive: true }

function turnEnd(durationMs: number, reason: 'answer' | 'aborted' | 'error' = 'answer', answer = 'Done.') {
  return { answer, durationMs, isAborted: reason === 'aborted', turnId: 't1', reason }
}

describe('greeting and idle', () => {
  test('waves and greets by the time of day, then reads', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(w.view().mood).toBe('wave')
    expect(EN.greeting.morning).toContain(w.view().said)
    await w.clock.advance(2700)
    expect(w.view().mood).toBe('idle')
    await w.clock.advance(14000)
    expect(w.view().said).toBe(null)
  })

  test('a reload right after activity does not greet again', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START)
    expect(w.view().mood).toBe('idle')
    expect(w.view().said).toBe(null)
  })

  test('the desktop greets when it attaches', async ($, on) => {
    const w = world(on)
    await $.session.start({ ...START, surface: null, isInteractive: false })
    expect(w.view().mood).toBe('idle')
    await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
    expect(w.view().mood).toBe('wave')
  })

  test('seeded living blinks run only while a sprite is on screen', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START)
    await w.clock.advance(20_000)
    expect(w.blits.length).toBe(0) // nothing mounted: no timer did anything
    await $.ui.mount({ surface: 'terminal', ...band(100) })
    await w.clock.advance(60_000)
    console.log(`seeded visible idle blink blits in 60000ms: ${w.blits.length}`)
    // A minute of the scratch runner's fixed seed has complete natural blinks.
    expect(w.blits.length).toBe(26) // thirteen complete blinks for seed 0x4c415544
  })

  test('with reduced motion: no blink, no loops', { timeoutMs: 60_000 }, async ($, on) => {
    const w = world(on, { settings: { prefersReducedMotion: true }, store: RECENT })
    await $.session.start(START)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(90) })
    const frames = new Set<string>()
    for (let t = 0; t < 8000; t += 100) {
      await w.clock.advance(100)
      frames.add(w.view().frame)
    }
    expect([...frames]).toEqual(['idle-reading'])
    await $.turn.start({ text: 'fix it', turnId: 't1' })
    await ui.redraw(band(90, true).props)
    frames.clear()
    for (let t = 0; t < 4000; t += 100) {
      await w.clock.advance(100)
      frames.add(w.view().frame)
    }
    expect([...frames]).toEqual(['think-a'])
  })

  test('falls asleep at exactly four quiet minutes, static, and wakes on the next prompt', { timeoutMs: 60_000 }, async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START)
    await $.ui.mount({ surface: 'terminal', ...band(100) })
    await w.clock.advance(239999)
    expect(w.view().mood).toBe('idle')
    await w.clock.advance(1)
    expect(w.view().mood).toBe('sleep')
    expect(EN.sleep).toContain(w.view().said)
    const blits = w.blits.length
    await w.clock.advance(5 * 60_000)
    expect(w.blits.length).toBe(blits) // asleep: no blinking
    await $.prompt.submit({ text: 'hi', wait: false, origin: PERSON })
    expect(w.view().mood).toBe('idle')
    expect(EN.wake).toContain(w.view().said)
  })

  test('clingy speaks at 150 quiet seconds, once, then sleeps at four minutes', async ($, on) => {
    const w = world(on, { store: { ...RECENT, affection: 'clingy' } })
    await $.session.start(START)
    await w.clock.advance(149999)
    expect(w.view().said).toBe(null)
    await w.clock.advance(1)
    expect(EN.clingy.idle).toContain(w.view().said)
    await w.clock.advance(14001)
    expect(w.view().said).toBe(null)
    await w.clock.advance(75998)
    expect(w.view().mood).toBe('idle')
    expect(w.view().said).toBe(null)
    await w.clock.advance(1)
    expect(w.view().mood).toBe('sleep')
  })

  test('back after two hours away, in the clingy voice when chosen', async ($, on) => {
    const w = world(on, { store: { affection: 'clingy' } })
    await $.session.start(START)
    await w.clock.advance(2.1 * 3600_000)
    await $.prompt.submit({ text: 'hello again', wait: false, origin: PERSON })
    expect(EN.clingy.back).toContain(w.view().said)
  })

  test('a prompt about python makes Shiori peek out', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START)
    await $.prompt.submit({ text: 'port this to python', wait: false, origin: PERSON })
    expect(w.view().mood).toBe('snake')
  })
})

describe('turns', () => {
  test('thinks, writes, and smiles when the answer lands', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(90) })
    await $.prompt.submit({ text: 'add a test', wait: false, origin: PERSON })
    await $.turn.start({ text: 'add a test', turnId: 't1' })
    await ui.redraw(band(90, true).props) // the engine's props change when the turn starts
    expect(w.view().mood).toBe('think')
    expect(EN.start).toContain(w.view().said)
    const frames = new Set<string>()
    for (let t = 0; t < 5200; t += 200) {
      await w.clock.advance(200)
      const sprite = await desktopPicture(ui)
      const source = String(sprite?.props.source)
      if (source.includes(PAINTED_FRAMES['think-a'])) frames.add('think-a')
      if (source.includes(PAINTED_FRAMES['think-b'])) frames.add('think-b')
    }
    expect([...frames].sort()).toEqual(['think-a', 'think-b'])
    await $.tool.call({ tool: 'Read', file_path: '/tmp/project/a.ts' })
    expect(w.view().mood).toBe('work')
    await $.turn.complete(turnEnd(10_000))
    await ui.redraw(band(90, false).props)
    expect(w.view().mood).toBe('happy')
    await w.clock.advance(3100)
    expect(w.view().mood).toBe('idle')
  })

  test('loops run only while a sprite is on screen: a compact terminal band gets none', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START)
    await $.ui.mount({ surface: 'terminal', ...band(100, true) })
    await $.turn.start({ text: 'go', turnId: 't1' })
    await w.clock.advance(10_000)
    expect(w.blits.length).toBe(0)
  })

  test('a long turn: still reading at 45 s, a done line after two minutes', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START)
    await $.turn.start({ text: '', turnId: 't1' })
    await w.clock.advance(46_000)
    expect(EN.thinking_long).toContain(w.view().said)
    await $.turn.complete(turnEnd(150_000))
    expect(EN.done_long).toContain(w.view().said)
  })

  test('three failing commands wake the wild soul; the next pass calms him', async ($, on) => {
    const w = world(on, { store: RECENT })
    w.fails = true
    await $.session.start(START)
    await $.turn.start({ text: 'run the tests', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    expect(w.view().mood).toBe('error')
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    expect(w.view().mood).toBe('wild')
    expect(EN.wild).toContain(w.view().said)
    await w.clock.advance(2500)
    expect(w.view().mood).toBe('work')
    w.fails = false
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    expect(w.view().mood).toBe('flustered')
    expect(EN.wild_after).toContain(w.view().said)
  })

  test('a grep that finds nothing (exit 1) is no failure: no face, no wild soul', async ($, on) => {
    const w = world(on, { store: RECENT })
    w.fails = true
    await $.session.start(START)
    await $.turn.start({ text: 'find the todos', turnId: 't1' })
    for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'grep -rn TODO src' })
    expect(w.view().mood).toBe('work')
    expect(w.view().said).not.toBe(null) // the first turn's start line, not a wild one
    expect(EN.wild).not.toContain(w.view().said)
  })

  test('three failing pytest runs in a row wake the wild soul', async ($, on) => {
    const w = world(on, { store: RECENT })
    w.fails = true
    await $.session.start(START)
    await $.turn.start({ text: 'fix the tests', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'pytest -q tests/' })
    await $.tool.call({ tool: 'Bash', command: 'python -m pytest tests/test_parser.py' })
    expect(w.view().mood).toBe('error')
    await $.tool.call({ tool: 'Bash', command: 'cd api && pytest' })
    expect(w.view().mood).toBe('wild')
  })

  test('a question for you shows him waiting, with one line, until it is answered', async ($, on) => {
    let during = ''
    let said: string | null = null
    const w = world(on, {
      store: RECENT,
      onTool: tool => {
        if (tool === 'AskUserQuestion') {
          during = w.view().mood
          said = w.view().said
        }
      },
    })
    await $.session.start(START)
    await $.turn.start({ text: '', turnId: 't1' })
    await $.tool.call({ tool: 'AskUserQuestion', questions: [] })
    expect(during).toBe('question')
    expect(EN.question).toContain(said)
    expect(w.view().mood).toBe('work')
  })

  test('a permission query (no call behind it) changes nothing', async ($, on) => {
    const w = world(on, { ask: true, store: RECENT })
    await $.session.start(START)
    await $.turn.start({ text: '', turnId: 't1' })
    await $.tool.check({ tool: 'Bash', input: { command: 'rm -r build' } })
    expect(w.view().mood).toBe('think')
  })

  test('refusal, interruption and an API error each have their face', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START)
    await $.turn.start({ text: '', turnId: 't1' })
    await $.turn.complete({ ...turnEnd(5000), reason: 'refusal', refusal: { category: null, explanation: null } })
    expect(w.view().mood).toBe('refuse')
    expect(EN.refuse).toContain(w.view().said)
    await $.turn.start({ text: '', turnId: 't2' })
    await $.turn.complete(turnEnd(5000, 'aborted'))
    expect(w.view().mood).toBe('flustered')
    await $.turn.start({ text: '', turnId: 't3' })
    await $.turn.complete(turnEnd(5000, 'error'))
    expect(w.view().mood).toBe('error')
    expect(EN.error).toContain(w.view().said)
  })
})

describe('easter eggs and counters', () => {
  test('ultrathink loosens the bow', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START)
    await $.prompt.submit({ text: 'ultrathink about the cache', wait: false, origin: PERSON })
    expect(EN.ultrathink).toContain(w.view().said)
  })

  test('a force push makes him hold the book tighter, and still runs', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START)
    await $.turn.start({ text: '', turnId: 't1' })
    const ran = await $.tool.call({ tool: 'Bash', command: 'git push --force origin main' })
    expect(ran.deny).toBe(undefined)
    expect(w.view().mood).toBe('flustered')
    expect(EN.force_push).toContain(w.view().said)
  })

  test('"absolutely right" in an answer makes him bite his sleeve', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START)
    await $.turn.start({ text: '', turnId: 't1' })
    await $.turn.complete(turnEnd(3000, 'answer', "You're absolutely right, the cache was stale."))
    expect(EN.absolutely_right).toContain(w.view().said)
  })

  test('every hundred turns he counts the pages', async ($, on) => {
    const w = world(on, { store: { turns: 99, ...RECENT } })
    await $.session.start(START)
    await $.turn.start({ text: '', turnId: 't1' })
    await $.turn.complete(turnEnd(3000))
    expect(w.view().said ?? '').toContain('100')
  })

  test('the offering box fills and warns once when nearly full', async ($, on) => {
    const w = world(on, { percent: 90, store: RECENT })
    await $.session.start(START)
    expect(w.view().context).toBe(90)
    expect(EN.offering_full).toContain(w.view().said)
  })

  test('/omen: a slip in the band, never in the conversation, the same slip all day', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START)
    const first = await $.command.run({ command: 'omen', args: '', origin: PERSON, presentation: P })
    expect(first.text).toBe(undefined)
    expect(w.view().mood).toBe('omen')
    const slip = w.view().slip
    expect(slip?.text.length ?? 0).toBeGreaterThan(0)
    await $.command.run({ command: 'claudesama', args: 'omen', origin: PERSON, presentation: P })
    expect(w.view().slip?.rank).toBe(slip?.rank)
  })

  test('fortunes stay in their own culture: no romaji ranks outside Japanese', { timeoutMs: 60_000 }, () => {
    for (const lang of ['en', 'zh'] as const) {
      for (const lines of Object.values(LINES.omikuji[lang])) {
        for (const line of lines) {
          expect(/kichi|daikyo|kyo\./i.test(line)).toBe(false)
        }
      }
    }
  })

  test('the slip shows the rank as written: English lines carry their own words', async ($, on) => {
    const w = world(on, { store: { ...RECENT, omen: { day: '2026-10-02', rank: 'daikichi', index: 0 } } })
    await $.session.start(START)
    await $.command.run({ command: 'omen', args: '', origin: PERSON, presentation: P })
    const slip = w.view().slip
    expect(slip?.text.startsWith(LINES.omikuji.en.daikichi[0])).toBe(true)
    expect(slip?.label).toBe('')
  })

  test('a Japanese slip writes its rank top to bottom', async ($, on) => {
    const w = world(on, { env: { LANG: 'ja_JP.UTF-8' }, store: { ...RECENT, omen: { day: '2026-10-02', rank: 'daikichi', index: 0 } } })
    await $.session.start(START)
    await $.command.run({ command: 'omen', args: '', origin: PERSON, presentation: P })
    expect(w.view().slip?.label).toBe('大吉')
  })

  test('/omen with the band off goes to a toast', async ($, on) => {
    const w = world(on, { store: { ...RECENT, band: 'off' } })
    await $.session.start(START)
    await $.command.run({ command: 'omen', args: '', origin: PERSON, presentation: P })
    expect(w.toasts.length).toBe(1)
  })
})

describe('commands and voice', () => {
  const ask = { model: 'claude', promptModel: 'claude', tools: [], outputStyle: null, traits: [] }

  test('voice: light by default, exactly one session-side section; full the same; off none', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START)
    const ours = async () => (await $.prompt.compose({ ...ask, surfaces: ['terminal'] })).sections.filter(s => s.id === 'claudesama:voice')
    let mine = await ours()
    expect(mine.length).toBe(1)
    expect(mine[0]?.scope).toBe('session')
    expect(mine[0]?.text).toBe(VOICE.light)
    await $.command.run({ command: 'claudesama', args: 'voice full', origin: PERSON, presentation: P })
    mine = await ours()
    expect(mine.length).toBe(1)
    expect(mine[0]?.scope).toBe('session')
    expect(mine[0]?.text).toBe(VOICE.full)
    await $.command.run({ command: 'claudesama', args: 'voice off', origin: PERSON, presentation: P })
    expect((await ours()).length).toBe(0)
    expect(w.toasts).toContain(WORDS.en.reply.voice.replace('{value}', 'off'))
    console.log(`voice section sizes: light ${VOICE.light.length} chars, full ${VOICE.full.length} chars`)
  })

  test('the shared side of the prompt is never touched, and a run nobody sees gets nothing', async ($, on) => {
    world(on, { store: RECENT })
    await $.session.start(START)
    const seen = await $.prompt.compose({ ...ask, surfaces: ['desktop'] })
    expect(seen.sections.filter(s => s.scope === 'shared').map(s => s.id)).toEqual(['intro'])
    const unseen = await $.prompt.compose({ ...ask, surfaces: [] })
    expect(unseen.sections.map(s => s.id)).toEqual(['intro'])
  })

  test('settings commands answer with a toast and nothing in the transcript', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START)
    const reply = await $.command.run({ command: 'claudesama', args: 'band compact', origin: PERSON, presentation: P })
    expect(reply.text).toBe(undefined)
    await $.command.run({ command: 'claudesama', args: 'affection clingy', origin: PERSON, presentation: P })
    expect(w.view().band).toBe('compact')
    expect(w.view().affection).toBe('clingy')
    expect(w.toasts).toEqual([WORDS.en.reply.band.replace('{value}', 'compact'), WORDS.en.reply.affection.replace('{value}', 'clingy')])
    // Bare /claudesama opens his book (book.test.tsx); a word it does not know lists the commands.
    await $.command.run({ command: 'claudesama', args: 'help', origin: PERSON, presentation: P })
    expect(w.toasts[2]).toContain('omen')
  })

  test("the language follows Claude Code's language setting, then the locale", async ($, on) => {
    const w = world(on, { settings: { language: 'japanese' }, env: { LANG: 'zh_CN.UTF-8' } })
    await $.session.start(START)
    expect(w.view().lang).toBe('ja')
  })
})
