// W1 order Do 3: exact v3 words replace old text pins; all other properties stay.
import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { LINES } from '../hooks/lines'
import { MORNING, P, PERSON, band, desktopPicture, cocoBandText } from './world'
import { presenceWorld, snapshot } from './presence-world'
import { WINDOWS_ROOTS } from './test-system'

const START = { cwd: '/tmp/b1-wake-settings', surface: 'desktop' as const, isInteractive: true }
function animatedPresence(on: On) {
  // One bottom endpoint per engine event is allowed. Replace only this fixture's
  // settings endpoint at registration, leaving the shared fixture source unchanged.
  const fixtureOn = ((event: string, ...args: unknown[]) => event === 'settings.read'
    ? (on as any)(event, () => ({ value: { timeZone: 'UTC', prefersReducedMotion: false } }))
    : (on as any)(event, ...args)) as On
  return presenceWorld(fixtureOn,snapshot('sleep', MORNING - 300000),{withNativePresence:true,readText:cocoBandText})
}
async function flush($: Engine) { for (let i = 0; i < 12; i++) await $.command.run({ command: 'model', args: '', origin: PERSON, presentation: P }) }
const image = async (ui: Parameters<typeof desktopPicture>[0]) => String((await desktopPicture(ui))?.props.source)
async function hasWake(ui: { find: (match: { type: string; text: string }) => Promise<unknown> }) {
  for (const line of LINES.en.wake) if (await ui.find({ type: 'Text', text: line })) return true
  return false
}

if (!WINDOWS_ROOTS) describe('B1 wake and shared settings on the rendered band', () => {
  test('an untouched session wakes immediately and reveals its shared wake line exactly at 220 ms', async ($, on) => {
    const f = animatedPresence(on)
    await $.session.start(START)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    await f.clock.advance(0)
    await flush($)
    const at = f.clock.now(), wake = { kind: 'wake', id: `wake:0:${at - 300000}`, at, lang: 'en' }
    const touch = { kind: 'touch', id: `touch:companion:${at}`, at, by: 'companion', touch: 'pat', lang: 'en' }
    f.remote({ ...snapshot('activity', at, f.current.seq + 1), event: touch, touchEvent: touch, wakeEvent: wake,
      settings: f.current.settings } as any)
    await flush($)
    expect(f.view().mood).toBe('idle')
    expect(await hasWake(ui)).toBe(false)
    const source = await image(ui)
    await f.clock.advance(219)
    expect(await hasWake(ui)).toBe(false)
    await f.clock.advance(1)
    expect(await hasWake(ui)).toBe(true)
    expect(await image(ui)).toBe(source)
  })

  test('the touched viewport gets the face while a second viewport only wakes; shared words arrive at 220 ms', async ($, on) => {
    const f = animatedPresence(on)
    await $.session.start(START)
    const touched = await $.ui.mount({ surface: 'desktop', ...band(100) })
    const other = await $.ui.mount({ surface: 'desktop', ...band(100) })
    await f.clock.advance(0)
    await flush($)
    await touched.press({ key: 'coco:band:poke' })
    await flush($)
    expect(f.current.asleep).toBe(false)
    expect(await hasWake(touched)).toBe(false)
    expect(await hasWake(other)).toBe(false)
    // Coco: both wake into idle; the touched viewport's petted starts 450 ms after the wake
    const source = await image(touched), remoteSource = await image(other)
    expect(source).toContain('data-coco="A idle"')
    expect(remoteSource).toContain('data-coco="A idle"')
    await f.clock.advance(219)
    expect(await hasWake(touched)).toBe(false)
    expect(await hasWake(other)).toBe(false)
    await f.clock.advance(1)
    expect(await hasWake(touched)).toBe(true)
    expect(await hasWake(other)).toBe(true)
    expect(await image(touched)).toBe(source)
    expect(await image(other)).toBe(remoteSource)
    await f.clock.advance(230)
    await flush($)
    expect(await image(touched)).toContain('data-coco="A petted"')
    expect(await image(other)).toContain('data-coco="A idle"')
  })

  test('voice and warmth confirmations remain visible in their new mode when commands wake sleeping presence', async ($, on) => {
    const f = animatedPresence(on)
    await $.session.start(START)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    await f.clock.advance(0)
    await flush($)
    for (const [args, line, property, value] of [
      ['voice full', LINES.en.set_voice_full[0]!, 'voice', 'full'],
      ['voice light', LINES.en.set_voice_light[0]!, 'voice', 'light'],
      ['voice off', LINES.en.set_voice_off[0]!, 'voice', 'off'],
      ['warmth clingy', LINES.en.set_clingy[0]!, 'affection', 'clingy'],
      ['warmth warm', LINES.en.set_warm[0]!, 'affection', 'warm'],
    ] as const) {
      if (f.current.asleep !== true) {
        await f.clock.advance(15000)
        f.remote({ ...snapshot('sleep', f.clock.now(), f.current.seq + 1), settings: f.current.settings } as any)
        await flush($)
      }
      expect(f.current.asleep).toBe(true)
      // the first round is asleep; later rounds keep the last confirmation on the band, awake with it
      if (args === 'voice full') expect(await image(ui)).toContain('data-coco="A nap"')
      await $.command.run({ command: 'coco', args, origin: PERSON, presentation: P })
      await flush($)
      expect(f.current.asleep).toBe(false)
      expect(f.view()[property]).toBe(value)
      expect(await ui.find({ type: 'Text', text: line })).toBeDefined()
      await f.clock.advance(220)
      expect(await ui.find({ type: 'Text', text: line })).toBeDefined()
    }
  })

  test('a remote setting event wakes this session and adopts voice, warmth and marks over stale local store', async ($, on) => {
    const f = animatedPresence(on)
    await $.session.start(START)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    await f.clock.advance(0)
    await flush($)
    const at = f.clock.now(), changes = { voice: 'full', affection: 'clingy', marks: 'off' }
    const event = { kind: 'settings', id: `settings:90:${at}`, at, lang: 'en', changes }
    f.remote({ ...snapshot('activity', at, f.current.seq + 1), event, settingsEvent: event,
      wakeEvent: { kind: 'wake', id: `wake:0:${at - 300000}`, at, lang: 'en' },
      settings: { ...f.current.settings, ...changes } } as any)
    await flush($)
    expect(f.view().mood).toBe('idle')
    expect(f.view().voice).toBe('full')
    expect(f.view().affection).toBe('clingy')
    expect(await ui.find({ type: 'Text', text: LINES.en.set_clingy[0] })).toBeDefined()
    await f.clock.advance(220)
    expect(await ui.find({ type: 'Text', text: LINES.en.set_clingy[0] })).toBeDefined()
  })

  test('sleeping poke pat poke shares the original wake clock, then reveals the burst line at 450 ms', async ($, on) => {
    const f = animatedPresence(on)
    await $.session.start(START)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    await f.clock.advance(0)
    await flush($)
    expect(f.current.asleep).toBe(true)
    await ui.press({ key: 'coco:band:poke' }); await flush($)
    expect(await hasWake(ui)).toBe(false)
    await f.clock.advance(100)
    await ui.press({ key: 'coco:band:pat' }); await flush($)
    expect(await hasWake(ui)).toBe(false)
    await f.clock.advance(100)
    await ui.press({ key: 'coco:band:poke' }); await flush($)
    expect((f.current as any).touchEvent?.touch).toBe('burst')
    expect(await hasWake(ui)).toBe(false)
    expect(await ui.find({ type: 'Text', text: LINES.en.poke_many[0]! })).toBeUndefined()
    await f.clock.advance(19)
    expect(await hasWake(ui)).toBe(false)
    await f.clock.advance(1)
    expect(await hasWake(ui)).toBe(true)
    expect(await ui.find({ type: 'Text', text: LINES.en.poke_many[0]! })).toBeUndefined()
    await f.clock.advance(229)
    expect(await hasWake(ui)).toBe(true)
    expect(await ui.find({ type: 'Text', text: LINES.en.poke_many[0]! })).toBeUndefined()
    await f.clock.advance(1)
    expect(await ui.find({ type: 'Text', text: LINES.en.poke_many[0]! })).toBeDefined()
  })

  test('a setting before the sleeping burst deadline cancels the old fluster line', async ($, on) => {
    const f = animatedPresence(on)
    await $.session.start(START)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    await f.clock.advance(0)
    await flush($)
    await ui.press({ key: 'coco:band:poke' }); await flush($)
    await f.clock.advance(100)
    await ui.press({ key: 'coco:band:pat' }); await flush($)
    await f.clock.advance(100)
    await ui.press({ key: 'coco:band:poke' }); await flush($)
    expect((f.current as any).touchEvent?.touch).toBe('burst')
    await f.clock.advance(100)
    const confirmation = LINES.en.set_voice_full[0]!
    await $.command.run({ command: 'coco', args: 'voice full', origin: PERSON, presentation: P })
    await flush($)
    expect(f.view().voice).toBe('full')
    expect(await ui.find({ type: 'Text', text: confirmation })).toBeDefined()
    await f.clock.advance(149)
    expect(await ui.find({ type: 'Text', text: confirmation })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: LINES.en.poke_many[0]! })).toBeUndefined()
    await f.clock.advance(1)
    expect(await ui.find({ type: 'Text', text: confirmation })).toBeDefined()
    for (const line of LINES.en.poke_many) expect(await ui.find({ type: 'Text', text: line })).toBeUndefined()
    await f.clock.advance(500)
    expect(await ui.find({ type: 'Text', text: confirmation })).toBeDefined()
    for (const line of LINES.en.poke_many) expect(await ui.find({ type: 'Text', text: line })).toBeUndefined()
  })

})
