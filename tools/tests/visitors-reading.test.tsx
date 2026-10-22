// The guest book the first time it opens in a session: the page says it is reading his notes while the pictures and words
// load, then shows them; later openings find everything ready (VISITORS.md 4.3).
import { describe, expect, test } from 'claude-code/testing'
import { MORNING, P, PERSON, RECENT, settleLegacyStart, world } from './world'
import { VISITORS_TEXT_RAW } from './visitors-text-fixture'
import { VISITOR_ART_TEXT } from './visitor-art-fixture'

const START = { cwd: '/tmp/project', surface: 'terminal' as const, isInteractive: true }
const PANE = {
  plugin: 'coco',
  component: 'Pane' as const,
  requestId: 'coco-book',
  props: { title: 'Coco', isFocused: false, bodyColumns: 64, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}
const VISITS = [{ id: 'visit:3:1', kind: 'keycap', at: MORNING - 86_400_000 * 3, leftAt: MORNING - 86_400_000 * 3 + 1_800_000 }]
const texts = (node: any): string[] => Array.isArray(node) ? node.flatMap(texts) : typeof node === 'string' ? [node] : node && typeof node === 'object' ? texts(node.children ?? []) : []
const open = ($: any) => $.command.run({ command: 'coco', args: 'visitors', origin: PERSON, presentation: P })

describe('the guest book on its first opening', () => {
  test('says it is reading his notes until the pictures are in, then shows the visits', async ($, on) => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    on('fs.read', { path: /[\\/]hooks[\\/]visitor-art\.json$/ }, async () => { await gate; return { value: VISITOR_ART_TEXT } as never })
    on('fs.read', { path: /[\\/]hooks[\\/]visitors-text\.json$/ }, () => ({ value: VISITORS_TEXT_RAW }) as never)
    const w = world(on, { store: { ...RECENT, visits: VISITS } })
    await $.session.start(START); await settleLegacyStart($, w)
    await open($)
    const ui = await $.ui.mount({ surface: 'desktop', ...PANE })
    const first = texts(await ui.drawn()).join(' | ')
    expect(first).toContain('reading their notes')
    expect(first).toContain('visitors')
    expect(first).not.toContain('a lost keycap')
    release()
    for (let i = 0; i < 40; i++) await w.clock.advance(0)
    const after = texts(await ui.drawn()).join(' | ')
    expect(after).toContain('a lost keycap')
    expect(after).not.toContain('reading their notes')
    await ui.unmount()
  })
  test('is not said again once everything is in: the next opening goes straight to the visits', async ($, on) => {
    on('fs.read', { path: /[\\/]hooks[\\/]visitor-art\.json$/ }, () => ({ value: VISITOR_ART_TEXT }) as never)
    on('fs.read', { path: /[\\/]hooks[\\/]visitors-text\.json$/ }, () => ({ value: VISITORS_TEXT_RAW }) as never)
    const w = world(on, { store: { ...RECENT, visits: VISITS } })
    await $.session.start(START); await settleLegacyStart($, w)
    await open($)
    for (let i = 0; i < 40; i++) await w.clock.advance(0)
    const ui = await $.ui.mount({ surface: 'desktop', ...PANE })
    for (let i = 0; i < 40; i++) await w.clock.advance(0)
    expect(texts(await ui.drawn()).join(' | ')).toContain('a lost keycap')
    await ui.unmount()
    await open($)
    const again = await $.ui.mount({ surface: 'desktop', ...PANE })
    expect(texts(await again.drawn()).join(' | ')).not.toContain('reading their notes')
    await again.unmount()
  })
})
