import { expect, test } from 'claude-code/testing'
import { desktopBand, terminalBand } from '../hooks/band'
import { initialView } from '../hooks/mood'
import { world } from './world'

type Run = { text: string; italic: boolean }
const sprite = '<svg width="73" height="64"></svg>'
const size = { columns: 200, maxRows: 30, screenRows: 48, isWorking: false }
const cases: { name: string; source: string; expected: Run[] }[] = [
  {
    name: 'outer closing star directly follows inferred path at source end',
    source: 'before *opens /tmp/file.ts*',
    expected: [{ text: 'before ', italic: false }, { text: 'opens /tmp/file.ts', italic: true }],
  },
  {
    name: 'ordinary trailing glob remains literal and roman',
    source: 'before /tmp/file.ts* after',
    expected: [{ text: 'before /tmp/file.ts* after', italic: false }],
  },
  {
    name: 'inner path stars remain literal while outer pair closes at path end',
    source: 'before *opens /tmp/*literal*/file.ts* after',
    expected: [{ text: 'before ', italic: false }, { text: 'opens /tmp/*literal*/file.ts', italic: true }, { text: ' after', italic: false }],
  },
  {
    name: 'trailing path glob inside stage remains literal before later outer close',
    source: 'before *opens /tmp/file.ts* then closes* after',
    expected: [{ text: 'before ', italic: false }, { text: 'opens /tmp/file.ts* then closes', italic: true }, { text: ' after', italic: false }],
  },
]

function runs(tree: any, inheritedItalic = false): Run[] {
  if (typeof tree === 'string') return [{ text: tree, italic: inheritedItalic }]
  if (!tree || typeof tree !== 'object') return []
  if (Array.isArray(tree)) return tree.flatMap(child => runs(child, inheritedItalic))
  const italic = tree.type === 'Text' ? (tree.props?.italic ?? inheritedItalic) : inheritedItalic
  return (tree.children ?? []).flatMap((child: any) => runs(child, italic))
}

const characters = (parts: Run[]) => parts.flatMap(run => Array.from(run.text, text => ({ text, italic: run.italic })))
function speechRoots(tree: any): Run[][] {
  if (!tree || typeof tree !== 'object') return []
  if (Array.isArray(tree)) return tree.flatMap(speechRoots)
  if (tree.type === 'Text') {
    const painted = runs(tree)
    const text = painted.map(run => run.text).join('')
    return /^(?:before | before )/u.test(text) ? [painted] : []
  }
  return (tree.children ?? []).flatMap(speechRoots)
}

function exactStyles(tree: unknown, expected: Run[], surface: 'desktop' | 'terminal'): void {
  const roots = speechRoots(tree)
  expect(roots.length).toBe(1)
  const painted = roots[0]!
  const text = painted.map(run => run.text).join('')
  const expectedText = expected.map(run => run.text).join('')
  const gap = surface === 'terminal' && text.startsWith(' ') ? ' ' : ''
  expect(text).toBe(gap + expectedText)
  const wanted = characters(expected)
  expect(characters(painted).slice(gap.length)).toEqual(wanted)
}

for (const surface of ['desktop', 'terminal'] as const) for (const fixture of cases) {
  test(`W3 A1 inferred ${surface}: ${fixture.name}`, async ($, on) => {
    const view = { ...initialView(), lang: 'en' as const, band: 'on' as const,
      line: { id: 'w3-inferred', key: 'w3-inferred', text: fixture.source, class: 2 as const, expiresAt: 14000 } }
    const original = JSON.stringify(view.line)
    expect((view.line as { slots?: unknown }).slots).toBeUndefined()
    on('ui.render', { component: 'Pane', requestId: 'w3-inferred-stage' }, ($: any, e: any) => surface === 'desktop'
      ? desktopBand($.ui.resolve(e) as any, view, size, sprite)
      : terminalBand($.ui.resolve(e) as any, view, size))
    world(on)
    const ui = await $.ui.mount({ surface, plugin: 'coco', component: 'Pane', requestId: 'w3-inferred-stage',
      props: { title: 'W3 fixture', isFocused: true, bodyColumns: size.columns, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } })
    const tree = await ui.drawn()
    await ui.unmount()
    exactStyles(tree, fixture.expected, surface)
    expect(view.line.text).toBe(fixture.source)
    expect(JSON.stringify(view.line)).toBe(original)
    expect((view.line as { slots?: unknown }).slots).toBeUndefined()
  })
}
