// B4 contract checks use the engine kit's four element tables. They preserve the
// engine row and never stand in for the hosts' compositor or native controls.
import { describe, expect, test } from 'claude-code/testing'
import { WORDS } from '../hooks/words'
import { RECENT, world } from './world'
import { D1_WORDS_TEXT } from './d1-room-fixture'
const D1_MARKS = JSON.parse(D1_WORDS_TEXT)['marks.shed'] as Record<string,string>
const shedDirection = (lang:string) => D1_MARKS[lang]!.replace(/\*/g,'')


const ENGINE = { type: 'engine', ref: 0 }
const START = { cwd: '/tmp/b4-surfaces', surface: 'vscode' as const, isInteractive: true }
const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const
type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
function nodes(tree: unknown, type: string): Node[] {
  if (!tree || typeof tree !== 'object') return []
  const n = tree as Node
  return [...(n.type === type ? [n] : []), ...(n.children ?? []).flatMap(c => nodes(c, type))]
}
function tool(tool: string, change: Record<string, unknown> = {}) {
  return { plugin: 'coco', component: 'ToolUse' as const,
    props: { tool_use_id: `b4-${tool}`, tool, input: {}, isRunning: false, isErrored: false, isInterrupted: false, ...change } }
}

describe('B4 file changes show nothing of his (SP1)', () => {
  // The spark leaves file changes: it marks a comment he liked (tools/tests/notice-spark.test.tsx).
  for (const surface of SURFACES) {
    test(`${surface}: no built-in call, completed or not, gets a spark without a comment he liked`, async ($, on) => {
      world(on, { store: RECENT, engineRows: true, settings: { prefersReducedMotion: true } })
      await $.session.start({ ...START, surface })
      for (const name of ['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Read', 'Grep', 'Bash', 'AskUserQuestion', 'mcp__files__write']) {
        const ui = await $.ui.mount({ surface, ...tool(name) })
        expect(await ui.drawn(), `${surface}:${name}`).toEqual(ENGINE)
        await ui.unmount()
      }
    })
    test(`${surface}: running, failed, interrupted changes and folded groups are the engine's alone`, async ($, on) => {
      world(on, { store: RECENT, engineRows: true })
      await $.session.start({ ...START, surface })
      for (const change of [{ isRunning: true }, { isErrored: true }, { isInterrupted: true }]) {
        expect(await (await $.ui.mount({ surface, ...tool('Edit', change) })).drawn()).toEqual(ENGINE)
      }
      expect(await (await $.ui.mount({ surface, plugin: 'coco', component: 'ToolGroup',
        props: { calls: [tool('Read').props], isActive: false, isExpanded: false } })).drawn()).toEqual(ENGINE)
    })
    test(`${surface}: marks off leaves completed changes entirely to the engine`, async ($, on) => {
      world(on, { store: { ...RECENT, marks: 'off' }, engineRows: true })
      await $.session.start({ ...START, surface })
      expect(await (await $.ui.mount({ surface, ...tool('Write') })).drawn()).toEqual(ENGINE)
    })
  }
  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    test(`${surface}: a change that completes still gains nothing`, async ($, on) => {
      world(on, { store: RECENT, engineRows: true })
      await $.session.start({ ...START, surface })
      const ui = await $.ui.mount({ surface, ...tool('Edit', { isRunning: true }) })
      expect(await ui.drawn()).toEqual(ENGINE)
      await ui.redraw(tool('Edit').props)
      expect(await ui.drawn()).toEqual(ENGINE)
    })
  }
})

describe('B4 waiting and compact wrappers', () => {
  for (const surface of SURFACES) {
    test(`${surface}: open question keeps the whole native card and exactly its declared face`, async ($, on) => {
      world(on, { store: RECENT, engineRows: true })
      await $.session.start({ ...START, surface })
      const ui = await $.ui.mount({ surface, plugin: 'coco', component: 'AskUserQuestion',
        props: { tool: 'AskUserQuestion', questions: [{ question: 'Pick', header: 'Choice', options: [{ label: 'A', description: 'A' }, { label: 'B', description: 'B' }] }] } })
      const tree = await ui.drawn()
      expect(nodes(tree, 'engine')).toEqual([ENGINE])
      expect(nodes(tree, 'Svg').length).toBe(surface === 'vscode' || surface === 'mobile' ? 1 : 0)
      expect(nodes(tree, 'Button').length).toBe(0)
      if (surface !== 'terminal') expect(await ui.find({ text: WORDS.en.aside.question })).toBeDefined()
      await ui.unmount()
    })
    test(`${surface}: successful compact adds one swept line, errors and other commands do not`, async ($, on) => {
      world(on, { store: RECENT, engineRows: true })
      await $.session.start({ ...START, surface })
      for (const [command, isErrored] of [['compact', false], ['compact', true], ['cost', false]] as const) {
        const ui = await $.ui.mount({ surface, plugin: 'coco', component: 'CommandOutput',
          props: { command, isErrored, args: '', text: 'native command output' } })
        const tree = await ui.drawn()
        expect(nodes(tree, 'engine')).toEqual([ENGINE])
        const marked = command === 'compact' && !isErrored && surface !== 'terminal'
        if (marked) expect(await ui.find({ text: surface === 'desktop' ? WORDS.en.marks.swept : shedDirection('en') })).toBeDefined()
        expect(nodes(tree, 'Svg').length).toBe(marked && surface !== 'desktop' ? 1 : 0)
        if (!marked) expect(tree).toEqual(ENGINE)
      }
    })
    test(`${surface}: marks off removes question and compact additions`, async ($, on) => {
      world(on, { store: { ...RECENT, marks: 'off' }, engineRows: true })
      await $.session.start({ ...START, surface })
      expect(await (await $.ui.mount({ surface, plugin: 'coco', component: 'AskUserQuestion', props: { tool: 'AskUserQuestion', questions: [] } })).drawn()).toEqual(ENGINE)
      expect(await (await $.ui.mount({ surface, plugin: 'coco', component: 'CommandOutput', props: { command: 'compact', isErrored: false, args: '', text: 'done' } })).drawn()).toEqual(ENGINE)
    })
  }
})
