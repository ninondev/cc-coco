// File changes carry nothing of his (SPARK 4, SP1): the spark moved to the comment he liked, so a
// completed Edit, Write or folded Read draws the engine's row by identity, marks on or off. The spark
// itself is in notice-spark.test.tsx. A hundred rows read no state.

import { describe, expect, test } from 'claude-code/testing'
import { settleLegacyStart, P, PERSON, RECENT, world } from './world'

const START = { cwd: '/tmp/project', surface: 'terminal' as const, isInteractive: true }
const ENGINE = { type: 'engine', ref: 0 }
const TOOL = {
  plugin: 'coco',
  component: 'ToolUse' as const,
  props: { tool_use_id: 'toolu_1', tool: 'Edit', input: { file_path: '/tmp/project/src/parser.ts', old_string: 'old', new_string: 'new' }, isRunning: false, isErrored: false, isInterrupted: false, output: 'Applied' },
}
const GROUP = {
  plugin: 'coco',
  component: 'ToolGroup' as const,
  props: { calls: [{ tool_use_id: 'toolu_2', tool: 'Read', input: { file_path: '/tmp/project/src/parser.ts' }, isRunning: false, isErrored: false, isInterrupted: false }], isActive: false, isExpanded: false },
}

describe('file changes show nothing of his', () => {
  for (const marks of ['on', 'replies', 'off', undefined] as const) {
    test(`with marks ${marks ?? 'at the default'}: a completed file change and a folded read are the engine's row, whole`, async ($, on) => {
      const setupWorld = world(on, { store: { ...RECENT, ...(marks ? { marks } : {}) }, engineRows: true })
      await $.session.start(START); await settleLegacyStart($, setupWorld)
      for (const surface of ['desktop', 'vscode', 'mobile', 'terminal'] as const) {
        expect(await (await $.ui.mount({ surface, ...TOOL, requestId: 'a-' + surface })).drawn()).toEqual(ENGINE)
        expect(await (await $.ui.mount({ surface, ...GROUP, requestId: 'g-' + surface })).drawn()).toEqual(ENGINE)
      }
    })
  }

  test('a hundred rows read no state', { timeoutMs: 60_000 }, async ($, on) => {
    const w = world(on, { store: RECENT, engineRows: true })
    await $.session.start(START); await settleLegacyStart($, w)
    await $.command.run({ command: 'coco', args: 'marks on', origin: PERSON, presentation: P })
    const before = w.stateReads
    for (let i = 0; i < 100; i++) {
      const row = await $.ui.mount({ surface: 'desktop', ...TOOL, props: { ...TOOL.props, tool_use_id: `toolu_${i}` }, requestId: `toolu_${i}` })
      expect(await row.drawn()).toEqual(ENGINE)
      await row.unmount()
    }
    expect(w.stateReads - before).toBe(0)
  })
})
