// A visitor on him in the band while he dozes: the picture, the stage direction, the wake line, and the
// rules about motion (VISITORS.md 2.4, 3, 9: V11, V12, V14, V15). The words are the shipped table.
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { MORNING, P, PERSON, band, desktopPicture } from './world'
import { presenceWorld, snapshot } from './presence-world'
import { VISITORS_TEXT_RAW } from './visitors-text-fixture'
import { WINDOWS_ROOTS } from './test-system'
import { VISITOR_ART_TEXT } from './visitor-art-fixture'
// M1: shared presence (his sleep, so his visitors) runs only while a More row is on; these worlds turn Lively on.

const ART_TEXT = VISITOR_ART_TEXT
const ART = JSON.parse(ART_TEXT) as { kinds: Record<string, { sit: { light: string; dark: string } }> }
const readText = (path: string) => /[\\/]hooks[\\/]visitor-art\.json$/.test(path) ? ART_TEXT : /[\\/]hooks[\\/]visitors-text\.json$/.test(path) ? VISITORS_TEXT_RAW : undefined
const START = { cwd: '/tmp/presence-project', surface: 'desktop' as const, isInteractive: true }
async function flush($: Engine) { for (let i = 0; i < 80; i++) await $.command.run({ command: 'b1b-host-boundary', args: '', origin: PERSON, presentation: P }) }
async function settle($: Engine, f: ReturnType<typeof presenceWorld>) { await f.clock.advance(0); await flush($); await f.clock.advance(0); await flush($) }
const sleeping = (kind: string, at = MORNING - 100_000, extra: object = {}, first = false) =>
  snapshot('sleep', at, 7, { visitors: { visit: { id: `visit:7:${at}`, kind, at, ...(first ? { first: true } : {}) }, last: '2026-10-02', kinds: { [kind]: '2026-10-02' }, ...extra } } as never)
const woke = (kind: string, at: number, kinds: Record<string, string>, first = false) => snapshot('wake', at, 9, { visitors: { visit: { id: `visit:7:${MORNING - 100_000}`, kind, at: MORNING - 100_000, leftAt: at, ...(first ? { first: true } : {}) }, last: '2026-10-02', kinds } } as never)
const texts = (node: any): string[] => Array.isArray(node) ? node.flatMap(texts) : typeof node === 'string' ? [node] : node && typeof node === 'object' ? texts(node.children ?? []) : []

if (!WINDOWS_ROOTS) describe('a visitor on him in the desktop band', () => {
  test('it sits in his sleeping picture, and the direction names it', async ($, on) => {
    const f = presenceWorld(on, sleeping('bulb'), { withNativePresence: true, readText, reducedMotion: false })
    await $.session.start(START)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    await settle($, f)
    const source = String((await desktopPicture(ui))?.props.source)
    expect(source).toContain('class="vis"')
    expect(source).toContain(ART.kinds.bulb!.sit.light)
    expect(source).toContain(ART.kinds.bulb!.sit.dark)
    expect(texts(await ui.drawn()).join(' ')).toContain('(a bulb lit above their head; they sleep)')
    expect(f.view().mood).toBe('sleep')
  })
  for (const kind of Object.keys(ART.kinds)) test(`the ${kind} sits in his picture, and no other kind does`, async ($, on) => {
    const f = presenceWorld(on, sleeping(kind), { withNativePresence: true, readText, reducedMotion: false })
    await $.session.start(START)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    await settle($, f)
    const source = String((await desktopPicture(ui))?.props.source)
    expect(source).toContain(ART.kinds[kind]!.sit.light)
    for (const other of Object.keys(ART.kinds)) if (other !== kind) expect(source, `${kind} with ${other}`).not.toContain(ART.kinds[other]!.sit.light)
  })
  test('a redraw long after he lay down draws the visitor sitting, with nothing moving (V11)', async ($, on) => {
    const f = presenceWorld(on, sleeping('keycap', MORNING - 100_000), { withNativePresence: true, readText, reducedMotion: false })
    await $.session.start(START)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    await settle($, f)
    const source = String((await desktopPicture(ui))?.props.source)
    const group = /<g class="vis"[^>]*>/.exec(source)?.[0] ?? ''
    expect(group).not.toContain('animation')
    expect(source).not.toContain('visarrive')
  })
  test('Visitors off draws nobody and says nothing of it', async ($, on) => {
    const f = presenceWorld(on, sleeping('bulb', MORNING - 100_000, {}), { withNativePresence: true, readText, reducedMotion: false })
    f.remote({ ...sleeping('bulb'), settings: { visitors: false } } as never)
    await $.session.start(START)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    await settle($, f)
    expect(String((await desktopPicture(ui))?.props.source)).not.toContain('class="vis"')
    expect(texts(await ui.drawn()).join(' ')).not.toContain('bulb')
  })
  test('without its words the visitor still sits and he says nothing new', async ($, on) => {
    const f = presenceWorld(on, sleeping('plane'), { withNativePresence: true, readText: path => /visitors-text\.json$/.test(path) ? '{}' : readText(path), reducedMotion: false })
    await $.session.start(START)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    await settle($, f)
    expect(String((await desktopPicture(ui))?.props.source)).toContain(ART.kinds.plane!.sit.light)
    expect(texts(await ui.drawn()).join(' ')).not.toContain('asleep)')
  })

  test('when you come back, his wake line names who came, in place of his usual one', async ($, on) => {
    const f = presenceWorld(on, sleeping('bulb', MORNING - 100_000, { kinds: { bulb: '2026-10-02', plane: '2026-09-20' } }), { withNativePresence: true, readText, reducedMotion: false })
    await $.session.start(START)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    await settle($, f)
    f.remote(woke('bulb', MORNING, { bulb: '2026-10-02', plane: '2026-09-20' }))
    await f.clock.advance(300); await settle($, f)
    expect(texts(await ui.drawn()).join(' ')).toContain("a light bulb came by while they dozed. you're back.")
    const picture = String((await desktopPicture(ui))?.props.source)
    expect(picture, 'the visitor is taking off, not sitting').toContain('visleave')
  })
  test('the first visitor ever has its own line, which says only who came', async ($, on) => {
    const f = presenceWorld(on, sleeping('bulb', MORNING - 100_000, { kinds: { bulb: '2026-10-02' } }, true), { withNativePresence: true, readText, reducedMotion: false })
    await $.session.start(START)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    await settle($, f)
    f.remote(woke('bulb', MORNING, { bulb: '2026-10-02' }, true))
    await f.clock.advance(300); await settle($, f)
    const drawn = texts(await ui.drawn()).join(' ')
    expect(drawn).toContain('a light bulb came by while they dozed.')
    expect(drawn).not.toContain("you're back")
  })
  test('a second visit by the same kind is not the first: it says the usual line', async ($, on) => {
    const f = presenceWorld(on, sleeping('bulb', MORNING - 100_000, { kinds: { bulb: '2026-10-02' } }), { withNativePresence: true, readText, reducedMotion: false })
    await $.session.start(START)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    await settle($, f)
    f.remote(woke('bulb', MORNING, { bulb: '2026-10-02' }))
    await f.clock.advance(300); await settle($, f)
    expect(texts(await ui.drawn()).join(' ')).toContain("you're back")
  })
  test('under 480 px the direction opens with the short name, wider it keeps the full words (V14)', async ($, on) => {
    const f = presenceWorld(on, sleeping('bulb'), { withNativePresence: true, readText, reducedMotion: false })
    await $.session.start(START)
    const narrow = await $.ui.mount({ surface: 'desktop', ...band(48) })
    await settle($, f)
    const small = texts(await narrow.drawn()).join(' ')
    expect(small).toContain('(bulb')
    expect(small).not.toContain('(a bulb')
    await narrow.unmount()
    const wide = await $.ui.mount({ surface: 'desktop', ...band(100) })
    await settle($, f)
    expect(texts(await wide.drawn()).join(' ')).toContain('(a bulb lit above their head; they sleep)')
  })
  test('under 480 px a direction that does not fit beside his name runs onto the empty row below it, short name first (V14)', async ($, on) => {
    const f = presenceWorld(on, sleeping('cursor'), { withNativePresence: true, readText, reducedMotion: false })
    await $.session.start(START)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(48) })
    await settle($, f)
    const rows = texts(await ui.drawn())
    const all = rows.join(' ')
    expect(all).toContain('(arrow')
    expect(all, 'the end of the direction is on the second row, not cut').toContain('sleep)')
    expect(rows.findIndex(r => r.includes('(arrow')), 'the name leads the first row').toBeLessThan(rows.findIndex(r => r.includes('sleep)')))
  })
  test('under 480 px the wake line says the short name where the full one stood (V14)', async ($, on) => {
    const f = presenceWorld(on, sleeping('bulb', MORNING - 100_000, { kinds: { bulb: '2026-10-02', plane: '2026-09-20' } }), { withNativePresence: true, readText, reducedMotion: false })
    await $.session.start(START)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(48) })
    await settle($, f)
    f.remote(woke('bulb', MORNING, { bulb: '2026-10-02', plane: '2026-09-20' }))
    await f.clock.advance(300); await settle($, f)
    const drawn = texts(await ui.drawn()).join(' ')
    expect(drawn).toContain("bulb came by while they dozed. you're back.")
    expect(drawn).not.toMatch(/\ba light bulb came by/)
  })
  test('the band picture names the visitor for a screen reader while it sits (V15)', async ($, on) => {
    const f = presenceWorld(on, sleeping('keycap'), { withNativePresence: true, readText, reducedMotion: false })
    await $.session.start(START)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    await settle($, f)
    expect(String((await desktopPicture(ui))?.props.alt)).toContain('keycap')
  })
  test('one session writes the visit into the guest book when it ends, once, with a kind and two times', async ($, on) => {
    const writes: unknown[] = []
    on('store.*', async ($, e, next) => {
      const out = await next(e)
      if (next.is('store.set', e) && e.key === 'visits') writes.push(e.value)
      return out
    })
    const f = presenceWorld(on, sleeping('bulb', MORNING - 100_000, { kinds: { bulb: '2026-10-02' } }), { withNativePresence: true, readText, reducedMotion: false })
    await $.session.start(START)
    await $.ui.mount({ surface: 'desktop', ...band(100) })
    await settle($, f)
    expect(writes).toEqual([])
    f.remote(woke('bulb', MORNING, { bulb: '2026-10-02' }))
    await f.clock.advance(300); await settle($, f)
    const book = [{ id: `visit:7:${MORNING - 100_000}`, kind: 'bulb', at: MORNING - 100_000, leftAt: MORNING }]
    expect(writes).toEqual([book])
    f.remote({ ...woke('bulb', MORNING, { bulb: '2026-10-02' }), seq: 10 } as never)
    await f.clock.advance(300); await settle($, f)
    expect(writes).toEqual([book])
  })
  test('a visit in progress leaves no timer pending and reads nothing while he is idle (V1)', async ($, on) => {
    let timers = 0, reads = 0
    on('clock.after', { ms: /.*/ }, async ($, e, next) => { timers++; return next(e) })
    on('clock.every', { ms: /.*/ }, async ($, e, next) => { timers++; return next(e) })
    on('fs.read', { path: /.*/ }, async ($, e, next) => { reads++; return next(e) })
    on('store.get', { key: /.*/ }, async ($, e, next) => { reads++; return next(e) })
    const f = presenceWorld(on, sleeping('keycap'), { withNativePresence: true, readText, reducedMotion: true })
    await $.session.start(START)
    await $.ui.mount({ surface: 'desktop', ...band(100) })
    await settle($, f)
    const before = { timers, reads }
    await f.clock.advance(60_000)
    expect({ timers: timers - before.timers, reads: reads - before.reads }).toEqual({ timers: 0, reads: 0 })
  })
  test('under reduced motion the visitor only fades, in 200 ms, and a still picture carries it (V12)', async ($, on) => {
    const f = presenceWorld(on, sleeping('keycap', MORNING - 1500), { withNativePresence: true, readText, reducedMotion: true })
    await $.session.start(START)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    await settle($, f)
    const source = String((await desktopPicture(ui))?.props.source)
    const animations = [...source.matchAll(/animation:([^;"]+)/g)].map(m => m[1]!).filter(a => a.startsWith('vis'))
    expect(animations.length).toBeGreaterThan(0)
    for (const a of animations) expect(a, a).toMatch(/^visfade 200ms linear -?\d+ms both$/)
    expect(source).not.toContain('transform:translate')
  })
})


const TERMINAL = { cwd: '/tmp/presence-project', surface: 'terminal' as const, isInteractive: true }
if (!WINDOWS_ROOTS) describe('a visitor on him in the terminal band', () => {
  test('at 24 columns the one row opens with the short name; wider it keeps the full words (V14)', async ($, on) => {
    const f = presenceWorld(on, sleeping('plane'), { withNativePresence: true, readText, surface: 'terminal', reducedMotion: false })
    await $.session.start(TERMINAL)
    const narrow = await $.ui.mount({ surface: 'terminal', ...band(24) })
    await settle($, f)
    const small = texts(await narrow.drawn()).join(' ')
    expect(small).toContain('(plane')
    expect(small).not.toContain('(a paper plane')
    await narrow.unmount()
    const wide = await $.ui.mount({ surface: 'terminal', ...band(100) })
    await settle($, f)
    expect(texts(await wide.drawn()).join(' ')).toContain('(a paper plane in hand; they sleep)')
  })
  test('at 24 columns the wake line leads with the short name (V14)', async ($, on) => {
    const f = presenceWorld(on, sleeping('plane', MORNING - 100_000, { kinds: { plane: '2026-10-02', leaf: '2026-09-20' } }), { withNativePresence: true, readText, surface: 'terminal', reducedMotion: false })
    await $.session.start(TERMINAL)
    const ui = await $.ui.mount({ surface: 'terminal', ...band(24) })
    await settle($, f)
    f.remote(woke('plane', MORNING, { plane: '2026-10-02', leaf: '2026-09-20' }))
    await f.clock.advance(300); await settle($, f)
    const drawn = texts(await ui.drawn()).join(' ')
    expect(drawn).toContain('plane')
    expect(drawn).not.toMatch(/\ba paper plane/)
  })
})
// His sleep and his visitors come through shared presence, which Windows declines with no pet program.
if (WINDOWS_ROOTS) test('Windows declines shared presence: a visitor on his sleeping picture never arrives', async ($, on) => {
  const f = presenceWorld(on, sleeping('bulb'), { withNativePresence: true, readText, reducedMotion: false })
  await $.session.start(START)
  const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
  await settle($, f)
  const source = String((await desktopPicture(ui))?.props.source)
  expect(source).not.toContain('class="vis"')
  expect(source).not.toContain(ART.kinds.bulb!.sit.light)
  expect(texts(await ui.drawn()).join(' ')).not.toContain('(a bulb lit above their head; they sleep)')
  expect(f.view().mood).not.toBe('sleep')
})
