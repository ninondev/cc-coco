// Optional native status must never hold the first Settings frame. Cold reads run separately,
// and their completion cannot replace a newer native event or an abandoned book generation.
import { describe, expect, test } from 'claude-code/testing'
import type { EngineInterface, On } from 'claude-code'
import { CompanionChannel } from '../hooks/channel'
import { CompanionBook, COMPANION_APP } from '../hooks/companion-book'
import { companionChanged, companionData, pressCompanion, warmCompanion } from '../hooks/pages'
import { PLUGIN_VERSION } from '../hooks/book-text'
import { MORNING, P, PERSON, RECENT, world } from './world'
import { PROCESS_OK } from './shared-world'
import { samePath } from './file-paths'

const HOME = '/tmp/cold-companion', FOLDER = `${HOME}/Library/Application Support/Claude-sama`
const MAC = '/System/Library/CoreServices/SystemVersion.plist'
const PANE = { plugin: 'claudesama', component: 'Pane' as const, requestId: 'claudesama-book', props: { title: 'Claude-sama', isFocused: false, bodyColumns: 64, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} } }
function gate() {
  let release: (() => void) | undefined, begin: (() => void) | undefined
  const waiting = new Promise<void>(resolve => { release = resolve })
  const began = new Promise<void>(resolve => { begin = resolve })
  return { waiting, began, begin: () => begin?.(), release: () => release?.() }
}
function cold(on: On, block: 'probe' | 'record') {
  const held = gate()
  let requested = false
  on('ui.invalidate', ($, e, next) => { requested = true; return next(e) })
  on('fs.exists', async ($, e) => {
    expect(requested, 'optional filesystem work starts after the open event redraw').toBe(true)
    if (samePath(e.path, MAC)) { if (block === 'probe') { held.begin(); await held.waiting }; return { value: true } }
    return { value: samePath(e.path, FOLDER) || samePath(e.path, `${HOME}/${COMPANION_APP}`) }
  })
  on('fs.read', { path: /[\\/]companion\.json$/ }, async () => {
    if (block === 'record') { held.begin(); await held.waiting }
    return { value: JSON.stringify({ running: false, accessibility: true, version: PLUGIN_VERSION }) }
  })
  on('process.run', () => ({ value: { ...PROCESS_OK, stdout: 'icon: stock\n' } }))
  world(on, { store: RECENT, env: { HOME, LANG: 'en_US.UTF-8', TERM: 'xterm-256color' } })
  return held
}

describe('cold companion status is separate from the first Settings frame', () => {
  for (const surface of ['desktop', 'terminal'] as const) for (const block of ['probe', 'record'] as const) {
    test(`${surface}: first Settings frame draws with a held ${block}, then status redraws from completion`, async ($, on) => {
      const held = cold(on, block)
      // Open directly, without a startup which could have prewarmed optional status.
      await $.command.run({ command: 'claudesama', args: 'settings', origin: PERSON, presentation: P })
      const ui = await $.ui.mount({ surface, ...PANE })
      await held.began
      try {
        expect(await ui.find({ type: 'Text', text: 'Band above the prompt' })).toBeDefined()
        expect(await ui.find({ type: 'Button', text: surface === 'desktop' ? 'Painted' : 'Full' })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: 'Desktop companion' })).toBeUndefined()
        expect(await ui.find({ type: 'Button', text: 'Install the companion' })).toBeUndefined()
      } finally { held.release() }
      // find consumes the redraw requested by background completion; no forced redraw/clock.
      expect(await ui.find({ type: 'Text', text: 'Not running' })).toBeDefined()
    })
  }

  for (const desktop of [true, false]) test(`${desktop ? 'desktop' : 'terminal'}: native channel status draws while the initial record is held, and wins after it completes`, async () => {
    // TestKit holds streamed process chunks behind a pending mocked noun callback. Use the
    // production channel directly so this race models independent native/event and file IO;
    // reaction.test separately covers its real engine stream and mounted book on both surfaces.
    await pressCompanion({ env: { get: async () => undefined } } as unknown as EngineInterface, new CompanionBook(), 'trash', {} as never, () => {}, () => true)
    const held = gate(), c = new CompanionBook()
    let redraws = 0, reads = 0, finished = false, packet: string | undefined, wake: (() => void) | undefined, accepted: (() => void) | undefined
    const engine = {
      env: { get: async (key: string) => key === 'HOME' ? HOME : undefined },
      fs: { exists: async () => true, read: async () => { reads++; held.begin(); await held.waiting; finished = true; return JSON.stringify({ running: false, accessibility: false, version: 'old' }) } },
    } as unknown as EngineInterface
    warmCompanion(engine, c, () => { redraws++ })
    const pending = c.warming
    await held.began
    const channel = new CompanionChannel({
      exists: async () => true, now: async () => MORNING, submit: async () => {}, clear: async () => {},
      spawn: async function* () {
        while (true) {
          if (packet === undefined) await new Promise<void>(resolve => { wake = resolve })
          const text = packet; packet = undefined
          if (text !== undefined) yield { stream: 'stdout' as const, text }
        }
        return { code: null, signal: null }
      },
    }, 'cold-session', FOLDER, {
      running: () => {}, seen: () => {}, ack: async () => {}, changed: async () => {},
      companionState: async info => { companionChanged(info); warmCompanion(engine, c, () => {}); redraws++; accepted?.() },
    })
    await channel.start()
    try {
      const receipt = new Promise<void>(resolve => { accepted = resolve })
      packet = JSON.stringify({ v: 1, kind: 'companion-state', at: MORNING, info: { running: true, accessibility: true, size: 'large', version: PLUGIN_VERSION } }) + '\n'
      wake?.()
      await receipt
      expect(finished).toBe(false)
      expect(redraws).toBe(1)
      const data = await companionData(engine, c, desktop, MORNING)
      expect(data.state).toBe('following')
      expect(data.info.size).toBe('large')
      if (desktop) expect(data.stage?.altState).toBe('following')
      expect(reads).toBe(1)
      held.release(); await pending
      expect(redraws).toBe(1)
      expect((await companionData(engine, c, desktop, MORNING)).state).toBe('following')
    } finally { held.release(); channel.stop() }
  })

  for (const block of ['probe', 'record'] as const) for (const stale of ['generation', 'event'] as const) test(`held ${block} cannot publish after a newer ${stale}`, async () => {
    // Direct helper imports share a module across tests; an absent-folder press clears its
    // earlier native event without file/program work, as it does for a new native action.
    await pressCompanion({ env: { get: async () => undefined } } as unknown as EngineInterface, new CompanionBook(), 'trash', {} as never, () => {}, () => true)
    const held = gate(), c = new CompanionBook()
    let redraws = 0, reads = 0
    const engine = {
      env: { get: async (key: string) => key === 'HOME' ? HOME : undefined },
      fs: { exists: async (path: string) => { if (path === MAC && block === 'probe') { held.begin(); await held.waiting }; return path === MAC || path === FOLDER || path === `${HOME}/${COMPANION_APP}` },
        read: async () => { reads++; if (block === 'record') { held.begin(); await held.waiting }; return JSON.stringify({ running: false }) } },
    } as unknown as EngineInterface
    warmCompanion(engine, c, () => { redraws++ })
    const pending = c.warming
    await held.began
    if (stale === 'generation') c.forget()
    else companionChanged({ running: true, accessibility: true, size: 'large', version: PLUGIN_VERSION })
    held.release(); await pending
    expect(redraws).toBe(0)
    expect(c.snapshot).toBeUndefined()
    if (stale === 'event') {
      // The native event itself proves macOS; no further probe or read is needed.
      warmCompanion(engine, c, () => { redraws++ })
      expect(c.macReady).toBe(true)
      expect((await companionData(engine, c, false, 0)).state).toBe('following')
      expect(reads).toBe(block === 'record' ? 1 : 0)
    }
  })
})
