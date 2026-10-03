// His spark beside each tool row on the desktop (the owner's choice, 2026-10-02 19:47): a tiny
// decorative picture in the row's left gutter, the engine's row whole and not moved, shown with
// marks `on` or `replies` and gone with `off`; nothing for screen readers, nothing per row
// beyond the wrapper, no state read.

import { describe, expect, test } from 'claude-code/testing'
import { P, PERSON, RECENT, world } from './world'

const START = { cwd: '/tmp/project', surface: 'terminal' as const, isInteractive: true }
const ENGINE = { type: 'engine', ref: 0 }
const TOOL = {
  plugin: 'claudesama',
  component: 'ToolUse' as const,
  props: { tool_use_id: 'toolu_1', tool: 'Bash', input: { command: 'npm test -- parser' }, isRunning: false, isErrored: true, isInterrupted: false, output: 'Exit code 1' },
}
const GROUP = {
  plugin: 'claudesama',
  component: 'ToolGroup' as const,
  props: { calls: [{ tool_use_id: 'toolu_2', tool: 'Read', input: { file_path: '/tmp/project/src/parser.ts' }, isRunning: false, isErrored: false, isInterrupted: false }], isActive: false, isExpanded: false },
}

type Node = { type?: string; props?: Record<string, unknown>; children?: Node[] }

// The engine's row, kept whole as the wrapper's first child, and the one placed spark after it.
function spark(tree: unknown): Node | undefined {
  const box = tree as Node
  if (box.type !== 'Box') return undefined
  expect(box.children?.[0]).toEqual(ENGINE)
  const placed = box.children?.[1]
  expect(box.children?.length).toBe(2)
  return placed
}

describe('his spark beside each tool row', () => {
  for (const marks of ['on', 'replies', undefined] as const) {
    test(`with marks ${marks ?? 'at the default'}: a spark in the gutter of each tool row and group, the row whole and not moved`, async ($, on) => {
      world(on, { store: { ...RECENT, ...(marks ? { marks } : {}) }, engineRows: true })
      await $.session.start(START)
      for (const row of [TOOL, GROUP]) {
        const placed = spark(await (await $.ui.mount({ surface: 'desktop', ...row })).drawn())
        expect(placed?.type).toBe('Box')
        expect(placed?.props).toEqual({ position: 'absolute', left: -2, top: 0 })
        const picture = placed?.children?.[0]
        expect(picture?.type).toBe('Svg')
        expect(picture?.props?.alt).toBe('') // decorative: screen readers skip it
        expect(String(picture?.props?.source)).toMatch(/^<svg [^>]*viewBox/)
      }
    })
  }

  test('with marks off, and on the terminal, tool rows are the engine\'s alone', async ($, on) => {
    world(on, { store: { ...RECENT, marks: 'off' }, engineRows: true })
    await $.session.start(START)
    for (const row of [TOOL, GROUP]) expect(await (await $.ui.mount({ surface: 'desktop', ...row })).drawn()).toEqual(ENGINE)
    await $.command.run({ command: 'claudesama', args: 'marks on', origin: PERSON, presentation: P })
    for (const row of [TOOL, GROUP]) expect(await (await $.ui.mount({ surface: 'terminal', ...row })).drawn()).toEqual(ENGINE)
  })

  test('one constant picture: the same spark on every row, no text glyph, and a hundred rows read no state', { timeoutMs: 60_000 }, async ($, on) => {
    const w = world(on, { store: RECENT, engineRows: true })
    await $.session.start(START)
    const before = w.stateReads
    const sources = new Set<string>()
    for (let i = 0; i < 100; i++) {
      const row = await $.ui.mount({ surface: 'desktop', ...TOOL, props: { ...TOOL.props, tool_use_id: `toolu_${i}` }, requestId: `toolu_${i}` })
      const placed = spark(await row.drawn())
      sources.add(String(placed?.children?.[0]?.props?.source))
      expect(JSON.stringify(await row.drawn()).includes('"Text"')).toBe(false)
      await row.unmount()
    }
    expect(sources.size).toBe(1)
    expect(w.stateReads - before).toBe(0)
  })
})
