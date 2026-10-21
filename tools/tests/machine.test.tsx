import { TIMING } from '../hooks/mood'
// The state machine, driven through the events a session raises, on a clock the test moves.

import { describe, expect, test } from 'claude-code/testing'
import { LINES } from '../hooks/lines'
import { VOICE } from '../hooks/voice'
import { WORDS } from '../hooks/words'
import { C3_WORDS_RAW } from './c3-words-fixture'
import { C3_HEAD_MANIFEST } from './c3-head-assets'
import { spriteCells } from '../hooks/pictures-lazy'
import { settleLegacyStart, P, PERSON, RECENT, MORNING, band, desktopPicture, world } from './world'

const C3_WORDS=JSON.parse(C3_WORDS_RAW)
const readC3=(path:string)=>path.endsWith('c3-text.json')?C3_WORDS_RAW:path.endsWith('frame-manifest.json')?JSON.stringify(C3_HEAD_MANIFEST):undefined
const EN = LINES.en
const START = { cwd: '/tmp/project', surface: 'terminal' as const, isInteractive: true }

function turnEnd(durationMs: number, reason: 'answer' | 'aborted' | 'error' = 'answer', answer = 'Done.') {
  return { answer, durationMs, isAborted: reason === 'aborted', turnId: 't1', reason }
}

describe('greeting and idle', () => {
  test('waves and greets by the time of day, then reads', async ($, on) => {
    const w = world(on,{store:{voice:'light',voiceChosen:true}})
    await $.session.start(START); await settleLegacyStart($,w);
    expect(w.view().mood).toBe('wave')
    expect(EN.greeting.morning).toContain(w.view().said)
    await w.clock.advance(2700)
    expect(w.view().mood).toBe('idle')
    await w.clock.advance(14000)
    expect(w.view().said).toBe(null)
  })

  test('a reload right after activity does not greet again', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START); await settleLegacyStart($,w);
    expect(w.view().mood).toBe('idle')
    expect(w.view().said).toBe(null)
  })

  test('the desktop greets when it attaches', async ($, on) => {
    const w = world(on, { store: { voice: 'light', voiceChosen: true } })
    await $.session.start({ ...START, surface: null, isInteractive: false }); await settleLegacyStart($,w);
    expect(w.view().mood).toBe('idle')
    await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' }); await settleLegacyStart($,w);
    expect(w.view().mood).toBe('wave')
  })

  test('seeded normal blinks run only while a sprite is on screen before the sixty-second handoff', async ($, on) => {
    const frames: string[] = [], blitTimes: number[] = []
    on('ui.*', ($, e, next) => { if (next.is('ui.blit', e)) {frames.push(String(e.cells));blitTimes.push(w.clock.now()-MORNING)} return next(e) })
    const w = world(on, { withNativePresence:true, store: RECENT })
    await $.session.start(START); await settleLegacyStart($,w);
    await w.clock.advance(20_000)
    expect(w.blits.length).toBe(0) // nothing mounted: no timer did anything
    expect(frames).toEqual([])
    await $.ui.mount({ surface: 'terminal', ...band(100) })
    await w.clock.advance(40_000)
    // The normal loop owns the interval from mounting at twenty seconds through
    // the sixty-second handoff. This seed produces ten complete blinks there.
    const closed = spriteCells('idle-blink', w.view().colors)
    const open = spriteCells('idle-reading', w.view().colors)
    const expected = Array.from({ length: 10 }, () => [closed, open]).flat()
    expect(blitTimes.every(at=>at<60000)).toBe(true)
    expect(w.blits.length).toBe(20)
    expect(frames).toEqual(expected)
  })

  test('Lively Off holds still after sixty quiet seconds with no further blits', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START); await settleLegacyStart($,w)
    await w.clock.advance(20_000)
    await $.ui.mount({ surface: 'terminal', ...band(100) })
    await w.clock.advance(60_000)
    const settledBlits = w.blits.length
    await w.clock.advance(60_000)
    expect(w.blits.length).toBe(settledBlits)
    expect(w.view().frame).toBe('idle-reading')
  })

  test('with reduced motion: no blink, no loops', { timeoutMs: 60_000 }, async ($, on) => {
    const w = world(on, { settings: { prefersReducedMotion: true }, store: RECENT })
    await $.session.start(START); await settleLegacyStart($,w);
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

  test('falls asleep at the hashed quiet deadline, static, and wakes on the next prompt', { timeoutMs: 60_000 }, async ($, on) => {
    const w = world(on, {withNativePresence:true, store: RECENT })
    await $.session.start(START); await settleLegacyStart($,w);
    await $.ui.mount({ surface: 'terminal', ...band(100) })
    await w.clock.advance(TIMING.sleepAfter(MORNING) - 1)
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

  test('clingy speaks at 150 quiet seconds, once, then sleeps at the hashed quiet deadline', async ($, on) => {
    const w = world(on, {withNativePresence:true, store: { ...RECENT, affection: 'clingy' } })
    await $.session.start(START); await settleLegacyStart($,w);
    await w.clock.advance(149999)
    expect(w.view().said).toBe(null)
    await w.clock.advance(1)
    expect(EN.clingy.idle).toContain(w.view().said)
    await w.clock.advance(14001)
    expect(w.view().said).toBe(null)
    await w.clock.advance(TIMING.sleepAfter(MORNING) - 164002)
    expect(w.view().mood).toBe('idle')
    expect(w.view().said).toBe(null)
    await w.clock.advance(1)
    expect(w.view().mood).toBe('sleep')
  })

  test('back after two hours away, in the clingy voice when chosen', async ($, on) => {
    const w = world(on, { store: { affection: 'clingy' } })
    await $.session.start(START); await settleLegacyStart($,w);
    await w.clock.advance(2.1 * 3600_000)
    await $.prompt.submit({ text: 'hello again', wait: false, origin: PERSON })
    expect(EN.clingy.back).toContain(w.view().said)
  })
})

describe('turns', () => {
  test('thinks, writes, and smiles when the answer lands', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START); await settleLegacyStart($,w);
    const ui = await $.ui.mount({ surface: 'desktop', ...band(90) })
    await $.prompt.submit({ text: 'add a test', wait: false, origin: PERSON })
    await $.turn.start({ text: 'add a test', turnId: 't1' })
    await ui.redraw(band(90, true).props) // the engine's props change when the turn starts
    expect(w.view().mood).toBe('think')
    expect(EN.start).toContain(w.view().said)
    const pictures = new Set<string>()
    for (let t = 0; t < 5200; t += 50) {
      await w.clock.advance(50) // observe faster than the motion model's minimum hold
      const sprite = await desktopPicture(ui)
      pictures.add(String(sprite?.props.source))
    }
    // Coco's think loop (coco-motion.ts), one picture that plays by itself the whole time
    expect(pictures.size).toBe(1)
    expect([...pictures][0]).toContain('data-coco="A think"')
    expect([...pictures][0]).toContain('@keyframes')
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
    await $.session.start(START); await settleLegacyStart($,w);
    await $.ui.mount({ surface: 'terminal', ...band(100, true) })
    await $.turn.start({ text: 'go', turnId: 't1' })
    await w.clock.advance(10_000)
    expect(w.blits.length).toBe(0)
  })

  test('a long turn: still reading at 45 s, a done line after two minutes', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START); await settleLegacyStart($,w);
    await $.turn.start({ text: '', turnId: 't1' })
    await w.clock.advance(46_000)
    expect(EN.thinking_long).toContain(w.view().said)
    await $.turn.complete(turnEnd(150_000))
    expect(EN.done_long).toContain(w.view().said)
  })

  test('three failing commands wake the wild soul; the next pass calms him', async ($, on) => {
    const w = world(on, { store: RECENT })
    w.fails = true
    await $.session.start(START); await settleLegacyStart($,w);
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
    await $.session.start(START); await settleLegacyStart($,w);
    await $.turn.start({ text: 'find the todos', turnId: 't1' })
    for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'grep -rn TODO src' })
    expect(w.view().mood).toBe('work')
    expect(w.view().said).not.toBe(null) // the first turn's start line, not a wild one
    expect(EN.wild).not.toContain(w.view().said)
  })

  test('three failing pytest runs in a row wake the wild soul', async ($, on) => {
    const w = world(on, { store: RECENT })
    w.fails = true
    await $.session.start(START); await settleLegacyStart($,w);
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
    await $.session.start(START); await settleLegacyStart($,w);
    await $.turn.start({ text: '', turnId: 't1' })
    await $.tool.call({ tool: 'AskUserQuestion', questions: [] })
    expect(during).toBe('question')
    expect(EN.question).toContain(said)
    expect(w.view().mood).toBe('work')
  })

  test('a permission query (no call behind it) changes nothing', async ($, on) => {
    const w = world(on, { ask: true, store: RECENT })
    await $.session.start(START); await settleLegacyStart($,w);
    await $.turn.start({ text: '', turnId: 't1' })
    await $.tool.check({ tool: 'Bash', input: { command: 'rm -r build' } })
    expect(w.view().mood).toBe('think')
  })

  // SPEC 0.2 class order: faces follow outcomes.
  test('refusal, interruption and an API error each have their face and their eligible visible line', async ($, on) => {
    const w = world(on, { store: {...RECENT,firstMet:MORNING,stamps:{met:MORNING}},readText:readC3,settings:{prefersReducedMotion:true} })
    await $.session.start(START); await settleLegacyStart($,w)
    const ui=await $.ui.mount({surface:'terminal',...band(100)})
    for(const [id,reason,mood,key] of [['t1','refusal','refuse','refuse'],['t2','aborted','flustered','aborted'],['t3','error','error','error']] as const){
      await $.turn.start({text:'',turnId:id})
      await $.turn.complete({...turnEnd(5000,reason==='refusal'?'answer':reason),turnId:id,reason,...(reason==='refusal'?{refusal:{category:null,explanation:null}}:{})})
      expect(w.view().mood).toBe(mood)
      expect(w.view().line?.class).toBe(0)
      expect(EN[key]).toContain(w.view().line?.text)
      expect(await ui.find({type:'Text',text:w.view().line!.text})).toBeDefined()
      expect((await ui.find({type:'Raster'}))?.props.cells).toBe(spriteCells(w.view().frame,w.view().colors))
    }
  })

})

describe('easter eggs and counters', () => {
  test('ultrathink loosens the bow', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START); await settleLegacyStart($,w);
    await $.prompt.submit({ text: 'ultrathink about the cache', wait: false, origin: PERSON })
    expect(EN.ultrathink).toContain(w.view().said)
  })

  // SPEC 1.1 and 6.1: allowed Bash runs normally; only a real permission wait can display a guardian.
  test('an allowed force push keeps its Bash pose, shows no guardian and still runs', async ($, on) => {
    const w = world(on, { store: RECENT,readText:readC3 })
    await $.session.start(START); await settleLegacyStart($,w)
    await $.turn.start({ text: '', turnId: 't1' })
    await w.clock.advance(1200)
    const ran = await $.tool.call({ tool: 'Bash', command: 'git push --force origin main' })
    expect(ran.deny).toBe(undefined)
    expect(w.view().mood).toBe('work')
    expect(w.view().pose).toMatchObject({name:'run',frame:'run-a',aside:C3_WORDS['aside.run'].en})
    expect(w.view().line?.key).not.toMatch(/^guard\./)
    expect(EN.force_push).not.toContain(w.view().line?.text)
  })

  test('"absolutely right" in an answer makes him bite his sleeve', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START); await settleLegacyStart($,w);
    await $.turn.start({ text: '', turnId: 't1' })
    await $.turn.complete(turnEnd(3000, 'answer', "You're absolutely right, the cache was stale."))
    expect(EN.absolutely_right).toContain(w.view().said)
  })

  test('every hundred turns he counts the pages', async ($, on) => {
    const w = world(on, { store: { turns: 99, ...RECENT } })
    await $.session.start(START); await settleLegacyStart($,w);
    await $.turn.start({ text: '', turnId: 't1' })
    await $.turn.complete(turnEnd(3000))
    expect(w.view().said ?? '').toContain('100')
  })

  test('the offering box fills and warns once when nearly full', async ($, on) => {
    const w = world(on, { percent: 90, store: RECENT })
    await $.session.start(START); await settleLegacyStart($,w);
    expect(w.view().context).toBe(90)
    expect(EN.offering_full).toContain(w.view().said)
  })

  // 10-15 (owner): vibe check took the omen's page; /coco vibe opens it and draws nothing, in the band or the chat.
  // 10-16 (owner): one command is enough; /omen and the shrine words (omen, offerings) are gone as inputs.
  test('/coco vibe draws no slip and says nothing in the conversation; /coco omen and /coco offerings are no longer inputs', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START); await settleLegacyStart($,w);
    const first = await $.command.run({ command: 'coco', args: 'vibe', origin: PERSON, presentation: P })
    expect(first.text).toBe(undefined)
    expect(w.view().mood).not.toBe('omen')
    expect(w.view().slip).toBeFalsy()
    for (const args of ['omen', 'offerings']) {
      const before = w.toasts.length
      await $.command.run({ command: 'coco', args, origin: PERSON, presentation: P })
      // Answered with how /coco is used, like any word it does not know.
      expect(w.toasts.slice(before)).toEqual([WORDS.en.reply.usage])
    }
    expect(w.view().slip).toBeFalsy()
  })

  test('/coco vibe with the band off opens the page and leaves no toast', {options:{band:'off'}}, async ($, on) => {
    const w = world(on, { store: { ...RECENT, band: 'off' } })
    await $.session.start(START); await settleLegacyStart($,w);
    await $.command.run({ command: 'coco', args: 'vibe', origin: PERSON, presentation: P })
    expect(w.toasts.length).toBe(0)
  })
})

describe('commands and voice', () => {
  const ask = { model: 'claude', promptModel: 'claude', tools: [], outputStyle: null, traits: [] }

  test('voice: off by default, explicit light and full add one session-side section', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START); await settleLegacyStart($,w);
    const ours = async () => (await $.prompt.compose({ ...ask, surfaces: ['terminal'] })).sections.filter(s => s.id === 'coco:voice')
    expect((await ours()).length).toBe(0)
    await $.command.run({ command: 'coco', args: 'voice light', origin: PERSON, presentation: P })
    let mine = await ours()
    expect(mine.length).toBe(1)
    expect(mine[0]?.scope).toBe('session')
    expect(mine[0]?.text).toBe(VOICE.light)
    await $.command.run({ command: 'coco', args: 'voice full', origin: PERSON, presentation: P })
    mine = await ours()
    expect(mine.length).toBe(1)
    expect(mine[0]?.scope).toBe('session')
    expect(mine[0]?.text).toBe(VOICE.full)
    await $.command.run({ command: 'coco', args: 'voice off', origin: PERSON, presentation: P })
    expect((await ours()).length).toBe(0)
    expect(w.toasts).toContain(WORDS.en.reply.voice.replace('{value}', 'off'))
    console.log(`voice section sizes: light ${VOICE.light.length} chars, full ${VOICE.full.length} chars`)
  })

  test('the shared side of the prompt is never touched, and a run nobody sees gets nothing', async ($, on) => {
    const setupWorld=world(on, { store: RECENT })
    await $.session.start(START); await settleLegacyStart($,setupWorld);
    const seen = await $.prompt.compose({ ...ask, surfaces: ['desktop'] })
    expect(seen.sections.filter(s => s.scope === 'shared').map(s => s.id)).toEqual(['intro'])
    const unseen = await $.prompt.compose({ ...ask, surfaces: [] })
    expect(unseen.sections.map(s => s.id)).toEqual(['intro'])
  })

  test('settings commands answer with a toast and nothing in the transcript', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START); await settleLegacyStart($,w);
    const reply = await $.command.run({ command: 'coco', args: 'band compact', origin: PERSON, presentation: P })
    expect(reply.text).toBe(undefined)
    await $.command.run({ command: 'coco', args: 'affection clingy', origin: PERSON, presentation: P })
    expect(w.view().band).toBe('compact')
    expect(w.view().affection).toBe('clingy')
    expect(w.toasts).toEqual([WORDS.en.reply.band.replace('{value}', 'compact'), WORDS.en.reply.affection.replace('{value}', 'clingy')])
    // Bare /coco opens his book (book.test.tsx); a word it does not know lists the commands.
    await $.command.run({ command: 'coco', args: 'help', origin: PERSON, presentation: P })
    expect(w.toasts[2]).toContain('vibe')
  })

  test("the language follows Claude Code's language setting, then the locale", async ($, on) => {
    const w = world(on, { settings: { language: 'japanese' }, env: { LANG: 'zh_CN.UTF-8' } })
    await $.session.start(START); await settleLegacyStart($,w);
    expect(w.view().lang).toBe('ja')
  })
})
