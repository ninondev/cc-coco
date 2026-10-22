import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { presenceWorld, snapshot } from './presence-world'
import { P, PERSON, band } from './world'
import { WINDOWS_ROOTS } from './test-system'

const START = { cwd: '/tmp/merge-companion-target', surface: 'desktop' as const, isInteractive: true }
function gate() {
  let enter!: () => void, release!: () => void
  const entered = new Promise<void>(resolve => { enter = resolve })
  const held = new Promise<void>(resolve => { release = resolve })
  return { enter, release, entered, held }
}
async function flush($: Engine) {
  for (let i = 0; i < 24; i++) await $.command.run({ command: 'merge-target-boundary', args: '', origin: PERSON, presentation: P })
}
async function choose($: Engine, target: string) {
  return $.command.run({ command: 'coco', args: `companiontarget ${target}`, origin: PERSON, presentation: P })
}

describe('merged companion target ordering and roster', () => {
  if (!WINDOWS_ROOTS) for (const hold of ['publication', 'legacy-store'] as const) test(`newer target survives an older held ${hold}`, { timeoutMs: 30_000 }, async ($, on) => {
    const blocked = gate()
    let armed = false
    let record: Record<string, unknown> = {}
    let mirror: unknown
    const mirrorWrites: unknown[] = []
    on('state.*', async ($, e, next) => {
      const result = await next(e)
      if (armed && hold === 'publication' && next.is('state.set', e) && e.key === 'view' && (e.value as { companionTarget?: string }).companionTarget === 'claude') {
        armed = false; blocked.enter(); await blocked.held
      }
      return result
    })
    on('store.*', async ($, e, next) => {
      if (armed && hold === 'legacy-store' && next.is('store.set', e) && e.key === 'companionTarget' && e.value === 'claude') {
        armed = false; blocked.enter(); await blocked.held
      }
      const result = await next(e)
      if (next.is('store.set', e)) {
        if (e.key === 'bandSettings') record = e.value as Record<string, unknown>
        if (e.key === 'companionTarget') { mirror = e.value; mirrorWrites.push(e.value) }
      }
      return result
    })
    const initial = { ...snapshot(), settings: { companionTarget: 'auto', neighbours: true, future: { preserved: 7 } } }
    const f = presenceWorld(on,initial,{withNativePresence:true, companion: true })
    await $.session.start(START)
    await $.ui.mount({ surface: 'desktop', ...band(100) })
    await f.clock.advance(0); await flush($); await f.clock.advance(0); await flush($)
    expect(f.view().companionTarget).toBe('auto')
    armed = true
    const first = choose($, 'claude')
    try {
      await blocked.entered
      await choose($, 'vscode'); await flush($)
      expect(f.view().companionTarget).toBe('vscode')
      expect(record.companionTarget).toBe('vscode')
    } finally { blocked.release() }
    await first; await flush($); await f.clock.advance(0); await flush($)
    await $.prompt.submit({ text: 'activity after both target choices', wait: false, origin: PERSON })
    await flush($)
    const shared = (f.current as typeof initial).settings
    expect(f.view().companionTarget).toBe('vscode')
    expect(record.companionTarget).toBe('vscode')
    expect(mirror).toBe('vscode')
    expect(shared.companionTarget).toBe('vscode')
    expect(shared.neighbours).toBe(true)
    expect(shared.future).toEqual({ preserved: 7 })
    expect(f.companionFeeds.at(-1)?.companionTarget).toBe('vscode')
    expect(f.companionFeeds.at(-1)?.neighbours).toBe(true)
    console.log('MERGE_TARGET_ORDER '+JSON.stringify({ hold, view: f.view().companionTarget, record: record.companionTarget, mirror, mirrorWrites, shared: shared.companionTarget, feed: f.companionFeeds.at(-1)?.companionTarget }))
  })

  if (!WINDOWS_ROOTS) test('production feed refreshes attached surfaces before dedupe and suppresses an identical roster', { timeoutMs: 30_000 }, async ($, on) => {
    let surfaces: ('desktop' | 'vscode' | 'terminal')[] = ['desktop']
    let queries = 0
    on('session.*', ($, e, next) => { if (next.is('session.turns', e)) return { value: 0 }; if (next.is('session.surfaces', e)) { queries++; return { value: surfaces } } return next(e) })
    on('session.detach', ($, e) => ({ clientId: e.clientId }))
    const f = presenceWorld(on, snapshot(), { withNativePresence: true, companion: true, sessionTurns: false })
    await $.session.start(START)
    await $.ui.mount({ surface: 'desktop', ...band(100) })
    await f.clock.advance(0); await flush($); await f.clock.advance(0); await flush($)
    const initial = f.companionFeeds.at(-1)!
    expect(initial.surfaces).toEqual(['desktop'])
    expect(initial.desktop).toBe(true)
    const mood = initial.mood
    surfaces = ['desktop', 'vscode']
    await $.session.attach({ clientId: 'editor', surface: 'vscode' })
    await f.clock.advance(0); await flush($)
    expect(f.companionFeeds.at(-1)?.surfaces).toEqual(['desktop', 'vscode'])
    expect(f.companionFeeds.at(-1)?.desktop).toBe(true)
    expect(f.companionFeeds.at(-1)?.mood).toBe(mood)
    surfaces = ['vscode']
    await $.session.detach({ clientId: 'desktop', surface: 'desktop', reason: 'detach' })
    await f.clock.advance(0); await flush($)
    expect(f.companionFeeds.at(-1)?.surfaces).toEqual(['vscode'])
    expect(f.companionFeeds.at(-1)?.desktop).toBe(false)
    expect(f.companionFeeds.at(-1)?.mood).toBe(mood)
    const before = f.companionFeeds.length, beforeQueries = queries
    await $.session.detach({ clientId: 'duplicate-editor-event', surface: 'vscode', reason: 'detach' })
    await f.clock.advance(0); await flush($)
    expect(queries).toBeGreaterThan(beforeQueries)
    expect(f.companionFeeds.length).toBe(before)
    console.log('MERGE_TARGET_ROSTER '+JSON.stringify({ initialSurfaces: initial.surfaces, finalSurfaces: f.companionFeeds.at(-1)?.surfaces, feedCount: before, unchangedRosterWrites: f.companionFeeds.length-before, queries }))
  })

  // The companion feed goes out through shared presence; with none on Windows a target choice stays in the view and the record.
  if (WINDOWS_ROOTS) test('Windows declines shared presence: a companion target choice is kept in the view and the record, and no feed is written', { timeoutMs: 30_000 }, async ($, on) => {
    let record: Record<string, unknown> = {}
    on('store.*', ($, e, next) => { if (next.is('store.set', e) && e.key === 'bandSettings') record = e.value as Record<string, unknown>; return next(e) })
    const f = presenceWorld(on, { ...snapshot(), settings: { companionTarget: 'auto', neighbours: true } }, { withNativePresence: true, companion: true })
    await $.session.start(START)
    await $.ui.mount({ surface: 'desktop', ...band(100) })
    await f.clock.advance(0); await flush($)
    await choose($, 'claude'); await choose($, 'vscode'); await flush($)
    expect(f.view().companionTarget).toBe('vscode')
    expect(record.companionTarget).toBe('vscode')
    expect(f.companionFeeds).toEqual([])
    expect(f.calls.filter(call => call.argv.some(arg => /presence\.sh$/.test(arg)))).toEqual([])
  })
})
