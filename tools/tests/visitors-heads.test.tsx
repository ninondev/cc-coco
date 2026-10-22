// Where no band exists (VS Code, the phone, the desktop with the band off) the first reply's head after a visit shows the
// visitor on his small picture and says so in place of its usual direction (VISITORS.md 2.4).
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { MORNING, P, PERSON } from './world'
import { presenceWorld, snapshot } from './presence-world'
import { VISITORS_TEXT_RAW } from './visitors-text-fixture'
import { WINDOWS_ROOTS } from './test-system'
import { VISITOR_ART_TEXT } from './visitor-art-fixture'
// M1: shared presence (his sleep, so his visitors) runs only while a More row is on; these worlds turn Lively on.

const ART_TEXT = VISITOR_ART_TEXT
const ART = JSON.parse(ART_TEXT) as { kinds: Record<string, { sit: { light: string } }> }
const readText = (path: string) => /[\\/]hooks[\\/]visitor-art\.json$/.test(path) ? ART_TEXT : /[\\/]hooks[\\/]visitors-text\.json$/.test(path) ? VISITORS_TEXT_RAW : undefined
const reply = (id: string, surface: 'vscode' | 'mobile' | 'desktop') => ({ plugin: 'coco', component: 'AssistantMessage' as const, requestId: id, props: { text: 'A complete reply.', isFirstOfReply: true }, viewport: { columns: 100, rows: 48 }, surface })
async function flush($: Engine) { for (let i = 0; i < 80; i++) await $.command.run({ command: 'b1b-host-boundary', args: '', origin: PERSON, presentation: P }) }
const texts = (node: any): string[] => Array.isArray(node) ? node.flatMap(texts) : typeof node === 'string' ? [node] : node && typeof node === 'object' ? texts(node.children ?? []) : []
const left = (kind: string, ago = 500) => snapshot('wake', MORNING - ago, 9, { visitors: { visit: { id: `visit:7:${MORNING - 400_000}`, kind, at: MORNING - 400_000, leftAt: MORNING - ago }, last: '2026-10-02', kinds: { [kind]: '2026-10-02' } } } as never)

async function turn($: Engine) {
  await $.turn.start({ turnId: 'head-turn', text: 'work' })
  for await (const _ of $.turn.step({ turnId: 'head-turn', index: 0, model: 'test', messageCount: 1 })) { void _ }
  await $.session.append({ door: 'response', origin: { kind: 'model', model: 'test' }, uuid: 'head-1', message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: 'A complete reply.' }] } } as never)
    .catch((error: unknown) => { if (!String(error).includes('no implementation fo')) throw error })
  await $.turn.complete({ turnId: 'head-turn', answer: 'A complete reply.', reason: 'answer', durationMs: 900, isAborted: false } as never)
}
const setup = (on: any, surface: 'vscode' | 'mobile', text?: (path: string) => string | undefined) => {
  on('session.append', ($: any, e: any, next: any) => next(e))
  return presenceWorld(on, left('bulb'), { withNativePresence: true, readText: text ?? readText, surface, reducedMotion: true })
}

if (!WINDOWS_ROOTS) describe('the head after a visit', () => {
  for (const surface of ['vscode', 'mobile'] as const) test(`${surface}: the first head carries the visitor and its note, once`, async ($, on) => {
    const f = setup(on, surface)
    await $.session.start({ cwd: '/tmp/presence-project', surface, isInteractive: true })
    await f.clock.advance(0); await flush($)
    await turn($)
    const ui = await $.ui.mount({ ...reply('head-1', surface), surface })
    const svg = await ui.find({ type: 'Svg' })
    expect(String(svg?.props.source)).toContain(ART.kinds.bulb!.sit.light)
    expect(svg?.props.alt, 'a screen reader hears the note (V15)').toBe('a light bulb came by')
    expect(texts(await ui.drawn()).join(' ')).toContain('a light bulb came by')
    await ui.unmount()
    const later = await $.ui.mount({ ...reply('head-2', surface), surface })
    const laterSvg = await later.find({ type: 'Svg' }).catch(() => undefined)
    expect(String(laterSvg?.props.source ?? '')).not.toContain(ART.kinds.bulb!.sit.light)
    await later.unmount()
  })
  test('a head with no words for the note is drawn as usual', async ($, on) => {
    const f = setup(on, 'vscode', path => /visitors-text\.json$/.test(path) ? '{}' : readText(path))
    await $.session.start({ cwd: '/tmp/presence-project', surface: 'vscode', isInteractive: true })
    await f.clock.advance(0); await flush($)
    await turn($)
    const ui = await $.ui.mount({ ...reply('head-1', 'vscode'), surface: 'vscode' })
    expect(String((await ui.find({ type: 'Svg' }))?.props.source)).not.toContain(ART.kinds.bulb!.sit.light)
    await ui.unmount()
  })
})
// A visit comes through shared presence, which Windows declines with no pet program: the head is drawn as usual.
if (WINDOWS_ROOTS) test('Windows declines shared presence: a visit never reaches the head', async ($, on) => {
  const f = setup(on, 'vscode')
  await $.session.start({ cwd: '/tmp/presence-project', surface: 'vscode', isInteractive: true })
  await f.clock.advance(0); await flush($)
  await turn($)
  const ui = await $.ui.mount({ ...reply('head-1', 'vscode'), surface: 'vscode' })
  expect(String((await ui.find({ type: 'Svg' }))?.props.source)).not.toContain(ART.kinds.bulb!.sit.light)
  expect(texts(await ui.drawn()).join(' ')).not.toContain('a light bulb came by')
  await ui.unmount()
})
