import { TIMING } from '../hooks/mood'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { LINES } from '../hooks/lines'
import { MORNING, P, PERSON, band, desktopPicture } from './world'
import { desktopRenderReceipts } from './desktop-render-receipts'
import { WINDOWS_ROOTS } from './test-system'
import { presenceWorld, snapshot } from './presence-world'


const START = { cwd: '/tmp/presence-project', surface: 'desktop' as const, isInteractive: true }
async function flush($: Engine) { for (let i = 0; i < 80; i++) await $.command.run({ command: 'b1b-host-boundary', args: '', origin: PERSON, presentation: P }) }
async function settle($: Engine, f: ReturnType<typeof presenceWorld>) { await f.clock.advance(0); await flush($); await f.clock.advance(0); await flush($) }

describe('one Coco shared presence in the real band', () => {
  if (!WINDOWS_ROOTS) {
    test('the native follower shares presence even when the obsolete tail utility is absent', async ($, on) => {
      const f = presenceWorld(on,snapshot('sleep', MORNING - 300000),{withNativePresence:true, missingTail: true })
      await $.session.start(START)
      await $.ui.mount({ surface: 'desktop', ...band(100) })
      await settle($, f)
      expect(f.view().mood).toBe('sleep')
      expect(f.calls.some(call => call.argv[3] === 'follow')).toBe(true)
    })
    test('a failed presence follower keeps the band usable without starting an orphanable companion tail', async ($, on) => {
      const f = presenceWorld(on,snapshot(),{withNativePresence:true, noTransport: true, companion: true })
      await $.session.start(START)
      await $.ui.mount({ surface: 'desktop', ...band(100) })
      await settle($, f)
      await flush($)
      expect(f.view().mood).toBe('idle')
      expect(f.calls.filter(call => call.argv[0] === '/usr/bin/tail')).toEqual([])
      expect(f.calls.filter(call => call.argv[0] === '/usr/bin/touch')).toEqual([])
      expect(f.companionFeeds.length).toBeGreaterThan(0)
      expect(f.companionFeeds.at(-1)?.channel).toBe(false)
    })
    for (const state of ['awake', 'asleep'] as const) {
      for (const source of ['startup', 'resume', 'fork'] as const) {
        test(`${source} first frame uses its bundled still and then corrects shared ${state}`, async ($, on) => {
          const f = presenceWorld(on,snapshot(state === 'asleep' ? 'sleep' : 'wake', MORNING - (state === 'asleep' ? 300000 : 1000), 7),{withNativePresence:true})
          const hydrationBegan = Date.now()
          await $.classic.SessionStart({ source, session_id: `first-${source}`, cwd: START.cwd })
          await $.session.start(START)
          const hydration = Date.now() - hydrationBegan
          const began = Date.now()
          const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
          const cost = Date.now() - began
          const firstSource = String((await desktopPicture(ui))?.props.source)
          const firstPresenceReads = f.secureReads.filter(path => path.endsWith('/snapshot.json')).length
          const desired = state === 'asleep' ? 'sleep' : 'idle'
          expect(firstSource.startsWith('<svg '), 'the first answer already contains his bundled picture').toBe(true)
          await settle($, f)
          // Coco (coco-motion.ts): asleep they nap on the shut laptop, awake they rest
          expect(String((await desktopPicture(ui))?.props.source)).toContain(`data-coco="A ${state === 'asleep' ? 'nap' : 'idle'}"`)
          expect(f.view().mood).toBe(desired)
          expect(f.secureReads.filter(path => path.endsWith('/snapshot.json')).length).toBeGreaterThanOrEqual(1)
          expect(f.reads.filter(path => path.endsWith('/snapshot.json'))).toEqual([])
          console.log('PRESENCE_METRIC ' + JSON.stringify({ source, state, startup_hydration_wall_ms: hydration, mount_first_frame_wall_ms: cost, first_frame_presence_reads: firstPresenceReads, presence_read_backend: 'secured native transaction', corrected_frame_presence_reads: f.secureReads.filter(path => path.endsWith('/snapshot.json')).length }))
        })
      }
    }
    test('without the native shell capability, fallback reads no presence file and starts no child', async ($, on) => {
      const f = presenceWorld(on,snapshot('sleep', MORNING - 300000),{withNativePresence:true, missingShell: true })
      await $.session.start(START)
      await $.ui.mount({ surface: 'desktop', ...band(100) })
      await settle($, f)
      expect(f.view().mood).toBe('idle')
      expect(f.reads.filter(path => path.endsWith('/snapshot.json'))).toEqual([])
      expect(f.secureReads.filter(path => path.endsWith('/snapshot.json'))).toEqual([])
      expect(f.calls.filter(call => call.argv.some(arg => arg.endsWith('presence.sh')))).toEqual([])
      await f.clock.advance(TIMING.sleepAfter(f.clock.now()))
      expect(f.view().mood).toBe('sleep')
    })
    for (const failure of ['unavailable', 'first-pull'] as const) {
      test(`${failure} transport deliberately falls back before the first frame`, async ($, on) => {
        const f = presenceWorld(on,snapshot('sleep', MORNING - 300000),{withNativePresence:true, noTransport: failure === 'unavailable', firstPullFails: failure === 'first-pull' })
        await $.session.start(START)
        await $.ui.mount({ surface: 'desktop', ...band(100) })
        await settle($, f)
        expect(f.view().mood).toBe('idle')
        await f.clock.advance(TIMING.sleepAfter(f.clock.now()))
        expect(f.view().mood).toBe('sleep')
        await $.prompt.submit({ text: 'hi', wait: false, origin: PERSON })
        expect(f.view().mood).toBe('idle')
      })
    }
    test('a running turn on a cold band draws immediately and wakes shared asleep state in the background', async ($, on) => {
      const f = presenceWorld(on,snapshot('sleep', MORNING - 300000),{withNativePresence:true})
      await $.session.start(START)
      const ui = await $.ui.mount({ surface: 'desktop', ...band(100, true) })
      expect(String((await desktopPicture(ui))?.props.source)).toContain('data-coco="A think"')
      await settle($, f)
      expect(f.current.busy).toBe(true)
      expect(f.current.asleep).toBe(false)
    })
    test('a resumed running session draws immediately then updates its idle bootstrap claim', async ($, on) => {
      const f = presenceWorld(on,snapshot('sleep', MORNING - 300000),{withNativePresence:true, mockDiagnostics: true, companion: true })
      await $.classic.SessionStart({ source: 'resume', session_id: 'resumed-work', cwd: START.cwd })
      await $.session.start({ ...START, surface: null, isInteractive: false })
      await settle($, f)
      expect(f.current.asleep).toBe(true)
      expect(f.current.busy).toBe(false)
      const before = f.diagnosticRecords.length
      const ui = await $.ui.mount({ surface: 'desktop', ...band(100, true) })
      expect(String((await desktopPicture(ui))?.props.source)).toContain('data-coco="A think"')
      await settle($, f)
      expect(f.current.busy).toBe(true)
      expect(f.current.asleep).toBe(false)
      await flush($)
      expect(f.diagnosticRecords.slice(before).filter(record => record.step === 'error:state.set')).toEqual([])
      const feed = f.companionFeeds[f.companionFeeds.length - 1]!
      expect((feed.presence as { asleep: boolean }).asleep).toBe(false)
      expect(feed.mood).toBe('think')
      await f.clock.advance(TIMING.sleepAfter(f.clock.now()))
      expect(f.view().mood).not.toBe('sleep')
    })
    test('an accepted clear releases the running claim without a turn completion and rearms the hashed quiet deadline', async ($, on) => {
      const f = presenceWorld(on,snapshot(),{withNativePresence:true})
      await $.session.start(START)
      await $.ui.mount({ surface: 'desktop', ...band(100) })
      await settle($, f)
      await $.turn.start({ text: 'go', turnId: 'clear-running' })
      await flush($)
      expect(f.current.busy).toBe(true)
      await f.clock.advance(600000)
      expect(f.view().mood).not.toBe('sleep')
      await $.command.run({ command: 'clear', args: '', origin: PERSON, presentation: P })
      await flush($)
      expect(f.current.busy).toBe(false)
      expect(f.current.quietAt).toBe(f.clock.now())
      await f.clock.advance(TIMING.sleepAfter(f.current.quietAt) - 1)
      expect(f.view().mood).not.toBe('sleep')
      await f.clock.advance(1)
      expect(f.view().mood).toBe('sleep')
    })
    test('remote presence preserves this session task, and book, poke and door actions publish activity', async ($, on) => {
      const f = presenceWorld(on,snapshot(),{withNativePresence:true})
      await $.session.start(START)
      const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
      await settle($, f)
      await $.turn.start({ text: 'go', turnId: 'local-task' })
      await $.tool.call({ tool: 'Read', file_path: '/tmp/test-file' })
      expect(f.view().mood).toBe('work')
      expect(f.remote(snapshot('activity', f.clock.now(), f.current.seq + 1, { busy: true }))).toBe(true)
      await flush($)
      expect(f.view().mood).toBe('work')
      await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 'local-task', reason: 'answer' })
      await f.clock.advance(4000)
      let seq = f.current.seq
      await ui.press({ key: 'coco:book:open' })
      await flush($)
      expect(f.current.seq).toBeGreaterThan(seq)
      await f.clock.advance(1000)
      seq = f.current.seq
      await ui.press({ key: 'coco:band:poke' })
      await flush($)
      expect(f.current.seq).toBeGreaterThan(seq)
      await $.command.run({ command: 'coco', args: 'band off', origin: PERSON, presentation: P })
      await f.clock.advance(1000)
      seq = f.current.seq
      await ui.press({ key: 'coco:band:wake' })
      await flush($)
      expect(f.current.seq).toBeGreaterThan(seq)
    })
    test('shared speech language stays identical while this session task language stays local', async ($, on) => {
      const f = presenceWorld(on,snapshot(),{withNativePresence:true})
      await $.session.start(START)
      await $.ui.mount({ surface: 'desktop', ...band(100) })
      await settle($, f)
      expect(f.view().lang).toBe('en')
      expect(f.remote(snapshot('sleep', f.clock.now(), f.current.seq + 1, { lang: 'zh' }))).toBe(true)
      await flush($)
      expect(LINES.zh.sleep).toContain(f.view().said)
      expect(f.view().lang).toBe('en')
      expect(f.remote(snapshot('wake', f.clock.now(), f.current.seq + 1, { lang: 'zh' }))).toBe(true)
      await flush($)
      expect(LINES.zh.wake).toContain(f.view().said)
      expect(f.view().lang).toBe('en')
    })
    test('the durable time extends the same wake line through the complete shared lifetime', async ($, on) => {
      const f = presenceWorld(on,snapshot(),{withNativePresence:true})
      await $.session.start(START)
      await $.ui.mount({ surface: 'desktop', ...band(100) })
      await settle($, f)
      const began = f.clock.now()
      const optimistic = snapshot('wake', began, f.current.seq + 1)
      optimistic.event.id = `wake:0:${began - 300000}`
      optimistic.wakeEvent = { ...optimistic.event }
      expect(f.remote(optimistic)).toBe(true)
      await flush($)
      const line = f.view().said
      expect(LINES.en.wake).toContain(line)
      await f.clock.advance(5000)
      const durable = snapshot('wake', f.clock.now(), f.current.seq + 1)
      durable.event.id = optimistic.event.id
      durable.wakeEvent = { ...durable.event }
      expect(f.remote(durable)).toBe(true)
      await flush($)
      expect(f.view().said).toBe(line)
      await f.clock.advance(9000) // the optimistic timestamp's old deadline
      expect(f.view().said).toBe(line)
      await f.clock.advance(4999)
      expect(f.view().said).toBe(line)
      await f.clock.advance(1) // the durable timestamp's exact shared deadline
      expect(f.view().said).toBe(null)
    })
    test('a quiet remote band wakes on the shared event without any clock advancement', async ($, on) => {
      const receipts=desktopRenderReceipts(on)
      const f = presenceWorld(on,snapshot(),{withNativePresence:true})
      await $.session.start(START)
      const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
      await settle($, f)
      await f.clock.advance(TIMING.sleepAfter(f.clock.now()))
      expect(f.view().mood).toBe('sleep')
      await ui.drawn()
      await receipts.flush($)
      const before = receipts.current()
      const at = f.clock.now(), began = Date.now()
      const delivered = f.remote(snapshot('wake', at, f.current.seq + 1))
      await flush($)
      await ui.drawn() // observe the subscription's pending draw, without requesting one
      await receipts.flush($)
      console.log('PRESENCE_METRIC ' + JSON.stringify({ wake_observed_ms: Date.now() - began, scope: 'upper bound after observed ui.drawn', remote_wake_virtual_ms: f.clock.now() - at, delivered }))
      expect(delivered).toBe(true)
      expect(receipts.current()).toBeGreaterThan(before)
      expect(f.clock.now()).toBe(at)
      expect(f.view().mood).toBe('idle')
      expect(LINES.en.wake).toContain(f.view().said)
      expect(await ui.find({ type: 'Text', text: f.view().said! })).toBeDefined()
    })
    test('tool calls during a busy turn change local moods without a shared write or spawn', async ($, on) => {
      const f = presenceWorld(on,snapshot(),{withNativePresence:true})
      await $.session.start(START)
      await $.ui.mount({ surface: 'desktop', ...band(100) })
      await settle($, f)
      await $.turn.start({ text: 'go', turnId: 'busy-tools' })
      await flush($)
      const seq = f.current.seq, transactions = f.calls.filter(call => call.mode === 'transaction').length
      for (let i = 0; i < 12; i++) await $.tool.call({ tool: 'Read', file_path: `/tmp/tool-${i}.txt` })
      await flush($)
      expect(f.view().mood).toBe('work')
      expect(f.current.busy).toBe(true)
      expect(f.current.seq).toBe(seq)
      expect(f.calls.filter(call => call.mode === 'transaction').length).toBe(transactions)
    })
    test('a turn running elsewhere keeps a locally quiet session awake through the sleep deadline', async ($, on) => {
      const f = presenceWorld(on,snapshot('activity', MORNING, 1, { busy: true }),{withNativePresence:true, remoteBusy: true })
      await $.session.start(START)
      await $.ui.mount({ surface: 'desktop', ...band(100) })
      await settle($, f)
      await f.clock.advance(600000)
      expect(f.view().mood).toBe('idle')
      expect(f.view().frame).toBe('idle-reading')
    })
    test('global activity restarts both deadlines, then clingy fires only once in the quiet stretch', async ($, on) => {
      const f = presenceWorld(on,snapshot(),{withNativePresence:true, affection: 'clingy' })
      await $.session.start(START)
      await $.ui.mount({ surface: 'desktop', ...band(100) })
      await settle($, f)
      await f.clock.advance(149999)
      expect(f.view().said).toBe(null)
      expect(f.remote(snapshot('activity', f.clock.now(), f.current.seq + 1))).toBe(true)
      await flush($)
      await f.clock.advance(1)
      expect(f.view().said).toBe(null)
      await f.clock.advance(149999)
      expect(LINES.en.clingy.idle).toContain(f.view().said)
      const seq = f.current.seq
      await f.clock.advance(15000)
      expect(f.view().said).toBe(null)
      expect(f.current.seq).toBe(seq)
      await f.clock.advance(TIMING.sleepAfter(f.current.quietAt) - 165000)
      expect(f.view().mood).toBe('sleep')
    })
    // DECISIONS 1013 and 1018: the band and the pet each answer their own touches.
    test('a touch on the pet leaves the line this band is saying', async ($, on) => {
      const f = presenceWorld(on,snapshot(),{withNativePresence:true, affection: 'clingy' })
      await $.session.start(START)
      await $.ui.mount({ surface: 'desktop', ...band(100) })
      await settle($, f)
      await f.clock.advance(150000)
      const line = f.view().said
      expect(LINES.en.clingy.idle).toContain(line)
      await f.clock.advance(1000)
      const at = f.clock.now(), touch = { kind: 'touch', id: `touch:companion:${at}`, at, by: 'companion', touch: 'pat', lang: 'en' }
      expect(f.remote({ ...snapshot('activity', at, f.current.seq + 1), event: touch, touchEvent: touch } as any)).toBe(true)
      await flush($)
      expect(f.view().said).toBe(line)
    })
  }
  test('Windows deliberately keeps the per-session behavior and creates no presence child', async ($, on) => {
    const f = presenceWorld(on,snapshot('sleep', MORNING - 300000),{withNativePresence:true, windows: true })
    await $.session.start({ ...START, cwd: 'C:\\project' })
    await $.ui.mount({ surface: 'desktop', ...band(100) })
    await settle($, f)
    expect(f.view().mood).toBe('idle')
    expect(f.calls.filter(call => call.argv.some(arg => arg.endsWith('presence.sh')))).toEqual([])
    expect(f.reads.filter(path => path.endsWith('/snapshot.json'))).toEqual([])
      expect(f.secureReads.filter(path => path.endsWith('/snapshot.json'))).toEqual([])
    await f.clock.advance(TIMING.sleepAfter(f.clock.now()))
    expect(f.view().mood).toBe('sleep')
    await $.prompt.submit({ text: 'hi', wait: false, origin: PERSON })
    expect(f.view().mood).toBe('idle')
  })
})
