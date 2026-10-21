// W1 order Do 3: exact v3 words replace old text pins; all other properties stay.
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { companionFeedContext, companionKey, companionRecord, companionText } from '../hooks/companion'
import { initialView } from '../hooks/mood'
import { LINES } from '../hooks/lines'
import { LANGS } from '../hooks/words'
import { MORNING, P, PERSON, band } from './world'
import { WINDOWS_ROOTS } from './test-system'
import { presenceWorld, snapshot } from './presence-world'

async function settleStartup($: Engine, f: ReturnType<typeof presenceWorld>) {
  const flush = async () => { for (let i = 0; i < 80; i++) await $.command.run({ command: 'b1b-host-boundary', args: '', origin: PERSON, presentation: P }) }
  await f.clock.advance(0); await flush(); await f.clock.advance(0); await flush()
}

describe('B3 companion contract', () => {
  if (!WINDOWS_ROOTS) test('a local target choice survives the next shared presence activity and reaches the companion feed', async ($, on) => {
    const future = { enabled: true }
    const initial = { ...snapshot(), settings: { companionTarget: 'claude', neighbours: true, future } }
    const f = presenceWorld(on,initial,{withNativePresence:true, companion: true })
    await $.session.start({ cwd: '/tmp/presence-project', surface: 'desktop', isInteractive: true })
    await $.ui.mount({ surface: 'desktop', ...band(100) })
    await settleStartup($, f)
    const flush = async () => { for (let i = 0; i < 12; i++) await $.command.run({ command: 'model', args: '', origin: PERSON, presentation: P }) }
    await flush()
    expect(f.view().companionTarget).toBe('claude')
    await $.command.run({ command: 'coco', args: 'companiontarget vscode', origin: PERSON, presentation: P })
    await flush()
    expect(f.view().companionTarget).toBe('vscode')
    expect(f.companionFeeds.at(-1)?.companionTarget).toBe('vscode')
    await $.prompt.submit({ text: 'next activity', wait: false, origin: PERSON })
    await flush()
    expect(f.view().companionTarget).toBe('vscode')
    expect(f.companionFeeds.at(-1)?.companionTarget).toBe('vscode')
    expect((f.current as typeof initial).settings.companionTarget).toBe('vscode')
    expect((f.current as typeof initial).settings.future).toEqual(future)
    expect((f.current as typeof initial).settings.neighbours).toBe(true)
  })

  if (!WINDOWS_ROOTS) for (const target of ['auto', 'claude', 'vscode'] as const) test(`incoming shared ${target} preference reaches the live view and companion feed`, async ($, on) => {
    const future = { enabled: true, keys: ['untouched', 2] }
    const initial = { ...snapshot(), settings: { companionTarget: 'claude', neighbours: true, future } }
    const f = presenceWorld(on,initial,{withNativePresence:true, companion: true })
    await $.session.start({ cwd: '/tmp/presence-project', surface: 'desktop', isInteractive: true })
    await $.ui.mount({ surface: 'desktop', ...band(100) })
    await settleStartup($, f)
    const flush = async () => { for (let i = 0; i < 12; i++) await $.command.run({ command: 'model', args: '', origin: PERSON, presentation: P }) }
    await flush()
    expect(f.view().companionTarget).toBe('claude')
    expect(f.companionFeeds.at(-1)?.companionTarget).toBe('claude')
    const incoming = { ...snapshot('activity', MORNING, f.current.seq + 1), settings: { companionTarget: target, neighbours: true, future } }
    expect(f.remote(incoming)).toBe(true)
    await flush()
    expect(f.view().companionTarget).toBe(target)
    expect(f.companionFeeds.at(-1)?.companionTarget).toBe(target)
    expect((f.current as typeof incoming).settings.future).toEqual(future)
    expect((f.current as typeof incoming).settings.neighbours).toBe(true)
    expect(f.remote({ ...incoming, seq: f.current.seq + 1, settings: { ...incoming.settings, companionTarget: 'unknown' } })).toBe(true)
    await flush()
    expect(f.view().companionTarget).toBe(target)
    expect(f.companionFeeds.at(-1)?.companionTarget).toBe(target)
    expect((f.current as typeof incoming).settings.future).toEqual(future)
  })

  test('the optional target and neighbours settings have conservative defaults', () => {
    const view = initialView()
    const defaults = companionRecord(view)
    expect(defaults.companionTarget).toBe('auto')
    expect(defaults.neighbours).toBe(false)
    const chosen = companionRecord({ ...view, companionTarget: 'vscode', neighbours: true } as typeof view)
    expect(chosen.companionTarget).toBe('vscode')
    expect(chosen.neighbours).toBe(true)
  })
  // 10-18 on his Mac: switching to Claudie changed nothing on the pet, because the record never carried the form.
  test('the pet hears Claude\'s form, her hoodie and her socks, and nothing of them when unset', () => {
    const plain = companionRecord(initialView())
    expect('claudie' in plain || 'outfit' in plain || 'socks' in plain).toBe(false)
    const dressed = companionRecord({ ...initialView(), claudie: 'maid', outfit: 'B', socks: 'stripes' })
    expect([dressed.claudie, dressed.outfit, dressed.socks]).toEqual(['maid', 'B', 'stripes'])
    expect(JSON.parse(companionKey({ ...initialView(), claudie: 'dake' })).claudie).toBe('dake')
  })
  test('each language preserves the app name slot for opens and back', () => {
    for (const { code } of LANGS) {
      const words = companionRecord({ ...initialView(), lang: code }).words
      expect(words.opens.includes('{app}')).toBe(true)
      expect(words.back.includes('{app}')).toBe(true)
      expect(words.opens.includes('Claude')).toBe(false)
    }
  })
  test('surfaces are queried per feed push, deduped with the record, and retained in JSON', async () => {
    let current: ('desktop' | 'vscode' | 'terminal')[] = ['desktop']
    let queries = 0
    const engine = { session: { surfaces: async () => { queries++; return current } } } as Parameters<typeof companionFeedContext>[0]
    const key = companionKey(initialView())
    const desktop = await companionFeedContext(engine, key)
    current = ['vscode']
    const code = await companionFeedContext(engine, key)
    expect(queries).toBe(2)
    expect(desktop === code).toBe(false)
    const stored = JSON.parse(companionText(code, 'session', false, 1000))
    expect(stored.surfaces).toEqual(['vscode'])
    expect(stored.desktop).toBe(false)
    expect(JSON.parse(companionText(key, 'session', true, 1000, ['desktop', 'vscode'])).surfaces).toEqual(['desktop', 'vscode'])
  })
  test('wake lines and warmth travel with each mood without I/O in record projection', () => {
    const warm = companionRecord(initialView())
    const clingy = companionRecord({ ...initialView(), affection: 'clingy' })
    expect(warm.affection).toBe('warm')
    expect(clingy.affection).toBe('clingy')
    expect(warm.wakeLines.length).toBeGreaterThan(0)
    expect(clingy.wakeLines.length).toBeGreaterThan(0)
    expect(clingy.wakeLines).toEqual(LINES.en.clingy.wake)
    expect(companionRecord({ ...initialView(), lang: 'zh', affection: 'clingy' }).wakeLines).toEqual(LINES.zh.clingy.wake)
    expect(companionRecord({ ...initialView(), lang: 'ja', affection: 'clingy' }).wakeLines).toEqual(LINES.ja.clingy.wake)
  })
})
