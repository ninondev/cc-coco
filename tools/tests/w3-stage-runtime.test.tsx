import { expect, test } from 'claude-code/testing'
import { desktopBand, terminalBand, planDesktop } from '../hooks/band'
import { initialView } from '../hooks/mood'
import { world } from './world'

type Surface = 'desktop' | 'terminal'
type Slot = { kind: 'path' | 'test' | 'label'; value: string }
type Run = { text: string; italic: boolean }
const sprite = '<svg width="73" height="64"></svg>'
const slots: Slot[] = [
  { kind: 'path', value: 'src/*literal*/file.ts' },
  { kind: 'test', value: 'test_*literal*_case' },
  { kind: 'label', value: 'label *literal*' },
]

function runs(tree: any, inheritedItalic = false): Run[] {
  if (typeof tree === 'string') return [{ text: tree, italic: inheritedItalic }]
  if (!tree || typeof tree !== 'object') return []
  if (Array.isArray(tree)) return tree.flatMap(child => runs(child, inheritedItalic))
  const italic = tree.type === 'Text' ? (tree.props?.italic ?? inheritedItalic) : inheritedItalic
  return (tree.children ?? []).flatMap((child: any) => runs(child, italic))
}
const characters = (parts: Run[]) => parts.flatMap(run => Array.from(run.text, text => ({ text, italic: run.italic })))
function exactStyles(tree: unknown, expected: Run[]): void {
  const painted = runs(tree)
  const text = painted.map(run => run.text).join('')
  const expectedText = expected.map(run => run.text).join('')
  const at = text.indexOf(expectedText)
  expect(at).toBeGreaterThanOrEqual(0)
  const offset = Array.from(text.slice(0, at)).length
  const wanted = characters(expected)
  expect(characters(painted).slice(offset, offset + wanted.length)).toEqual(wanted)
}

async function draw($: any, on: any, surface: Surface, source: string, identified?: Slot[], columns = 200, compact = false): Promise<unknown> {
  const view = { ...initialView(), band: compact ? 'compact' as const : 'on' as const, line: { id: 'w3-runtime', key: 'w3-runtime', text: source, class: 2 as const, expiresAt: 14000, slots: identified } }
  const size = { columns, maxRows: 30, screenRows: 48, isWorking: false }
  on('ui.render', { component: 'Pane', requestId: 'w3-stage-runtime' }, ($: any, e: any) => surface === 'desktop'
    ? desktopBand($.ui.resolve(e) as any, view, size, sprite)
    : terminalBand($.ui.resolve(e) as any, view, size))
  world(on)
  const ui = await $.ui.mount({ surface, plugin: 'coco', component: 'Pane', requestId: 'w3-stage-runtime', props: { title: 'W3 fixture', isFocused: true, bodyColumns: columns, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } })
  const tree = await ui.drawn()
  await ui.unmount()
  expect(view.line.text).toBe(source)
  expect(view.line.slots).toEqual(identified)
  return tree
}

for (const surface of ['desktop', 'terminal'] as const) for (const slot of slots) {
  test(`W3 A1 runtime ${surface}: stage runs leave identified ${slot.kind} stars exact and roman`, async ($, on) => {
    const source = `before *stage* ${slot.value} after *second stage* end`
    const original = { ...slot }
    const tree = await draw($, on, surface, source, [slot])
    exactStyles(tree, [
      { text: 'before ', italic: false },
      { text: 'stage', italic: true },
      { text: ` ${slot.value} after `, italic: false },
      { text: 'second stage', italic: true },
      { text: ' end', italic: false },
    ])
    expect(slot).toEqual(original)
  })
  test(`W3 A1 runtime ${surface}: identified ${slot.kind} markup-shaped value alone is a literal control`, async ($, on) => {
    const source = `${slot.value} ordinary`
    const tree = await draw($, on, surface, source, [slot])
    exactStyles(tree, [{ text: source, italic: false }])
  })
}

for (const surface of ['desktop', 'terminal'] as const) {
  test(`W3 A1 runtime ${surface}: an outer stage pair spans an identified path without consuming its literal stars`, async ($, on) => {
    const slot: Slot = { kind: 'path', value: 'src/*literal*/file.ts' }
    const source = `before *opens ${slot.value} then closes* after`
    const tree = await draw($, on, surface, source, [slot])
    exactStyles(tree, [
      { text: 'before ', italic: false },
      { text: `opens ${slot.value} then closes`, italic: true },
      { text: ' after', italic: false },
    ])
  })
  test(`W3 A1 runtime ${surface}: a cut inside an oversized stage keeps painted prefix italic and ordinary neighbors roman`, async ($, on) => {
    const stage = 'segment '.repeat(80).trimEnd()
    const source = `before *first* between *${stage}* after`
    const tree = await draw($, on, surface, source, [], 72, true)
    const painted = runs(tree)
    const allText = painted.map(run => run.text).join('')
    expect(allText.includes('*')).toBe(false)
    const prefix = 'before first between '
    const at = allText.indexOf(prefix)
    expect(at).toBeGreaterThanOrEqual(0)
    exactStyles(tree, [
      { text: 'before ', italic: false },
      { text: 'first', italic: true },
      { text: ' between ', italic: false },
    ])
    const offset = Array.from(allText.slice(0, at + prefix.length)).length
    const tail = characters(painted).slice(offset)
    const paintedStage = tail.map(char => char.text).join('').replace(/…$/, '')
    expect(paintedStage.length).toBeGreaterThan(0)
    expect(paintedStage.length).toBeLessThan(stage.length)
    expect(stage.startsWith(paintedStage)).toBe(true)
    expect(tail.slice(0, Array.from(paintedStage).length).every(char => char.italic)).toBe(true)
  })
}

test('W3 A1 runtime desktop: inferred path fallback preserves literal stars without explicit slots', async ($, on) => {
  const path = '/tmp/*literal*/file.ts'
  const source = `before *stage* ${path} after`
  const tree = await draw($, on, 'desktop', source)
  exactStyles(tree, [
    { text: 'before ', italic: false },
    { text: 'stage', italic: true },
    { text: ` ${path} after`, italic: false },
  ])
})

test('W3 A1 runtime desktop: duplicate shortened paths retain distinct source attribution and stage styles', async ($, on) => {
  const first = '/one/' + 'very-long-directory/'.repeat(12) + 'file.ts'
  const second = '/two/' + 'very-long-directory/'.repeat(12) + 'file.ts'
  const identified: Slot[] = [{ kind: 'path', value: first }, { kind: 'path', value: second }]
  const source = `a ${first} *b ${second} c* d`
  const view = { ...initialView(), band: 'compact' as const, line: { id: 'w3-runtime', key: 'w3-runtime', text: source, class: 2 as const, expiresAt: 14000, slots: identified } }
  let selected: { columns: number; plan: ReturnType<typeof planDesktop> } | undefined
  for (let columns = 20; columns <= 240; columns++) {
    const plan = planDesktop(view, { columns, maxRows: 30, screenRows: 48, isWorking: false })
    const fitted = (plan.parts ?? []).filter(part => part.slot)
    if (fitted.length === 2 && fitted[0]!.text === '/…/file.ts' && fitted[1]!.text === fitted[0]!.text
      && plan.place < 3 && plan.speech === `a ${fitted[0]!.text} b ${fitted[1]!.text} c d`) {
      selected = { columns, plan }
      break
    }
  }
  expect(selected).toBeDefined()
  const fitted = selected!.plan.parts!.filter(part => part.slot)
  expect(first === second).toBe(false)
  expect(fitted.map(part => part.text)).toEqual(['/…/file.ts', '/…/file.ts'])
  expect(selected!.plan.place).toBeLessThan(3)
  expect(selected!.plan.speech).toBe('a /…/file.ts b /…/file.ts c d')
  expect(fitted.map(part => part.sourceValue)).toEqual([first, second])
  const tree = await draw($, on, 'desktop', source, identified, selected!.columns, true)
  exactStyles(tree, [
    { text: 'a /…/file.ts ', italic: false },
    { text: 'b /…/file.ts c', italic: true },
    { text: ' d', italic: false },
  ])
  expect(view.line.text).toBe(source)
  expect(view.line.slots.map(slot => slot.value)).toEqual([first, second])
})
