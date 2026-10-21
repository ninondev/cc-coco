import { expect, test } from 'claude-code/testing'
import { desktopBand } from '../hooks/band'
import { initialView } from '../hooks/mood'
import { COLUMN_PX, planPx } from '../hooks/typeset'
import { world } from './world'

const text = (node: any): string => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.children ?? []) : ''
const nodes = (node: any): any[] => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...(node.children ?? []).flatMap(nodes)]

// Count emitted siblings, margins and styled text; do not read planner width decisions.
// Font advances are conservative source estimates, not native DOM measurements.
function extent(node: any, bold = false): number {
  if (typeof node === 'string') return planPx(node, bold) + (node.match(/…/gu)?.length ?? 0) * (14 - planPx('…', bold))
  if (!node || typeof node !== 'object') return 0
  if (Array.isArray(node)) return node.reduce((sum, child) => sum + extent(child, bold), 0)
  const props = node.props ?? {}
  if (props.display === 'none' || props.position === 'absolute') return 0
  const margins = (Number(props.marginLeft ?? 0) + Number(props.marginRight ?? 0)) * COLUMN_PX
  if (node.type === 'Svg') return margins + Number(props.width)
  if (node.type === 'Text') return margins + extent(node.children ?? [], props.bold ?? bold)
  if (node.type === 'Button') return margins + planPx(props.label) + 22
  const children = (node.children ?? []).filter((child: any) => child && child.props?.display !== 'none' && child.props?.position !== 'absolute')
  const widths = children.map((child: any) => extent(child, bold))
  return margins + 2 * Number(props.paddingX ?? 0) * COLUMN_PX + (String(props.flexDirection ?? 'row').startsWith('column')
    ? Math.max(0, ...widths) : widths.reduce((sum: number, width: number) => sum + width, 0) + Math.max(0, widths.length - 1) * Number(props.columnGap ?? 0) * COLUMN_PX)
}

test('W4 physical 24-column filename recovery keeps the complete bold filename inside all fixed siblings', async ($, on) => {
  const value = 'a/b/name.ts', columns = 24
  const view = { ...initialView(), context: 56, band: 'compact' as const, line: { id: 'w2', key: 'first_down', text: value, class: 1 as const, slots: [{ value, kind: 'path' as const }], expiresAt: 14000 } }
  on('ui.render', { component: 'Pane', requestId: 'w4-filename' }, ($, event) => desktopBand($.ui.resolve(event) as any, view, { columns, isWorking: true, maxRows: 30, screenRows: 48 }, '<svg width="35" height="32"></svg>'))
  world(on)
  const ui = await $.ui.mount({ surface: 'desktop', plugin: 'coco', component: 'Pane', requestId: 'w4-filename', props: { title: 'W4 filename', isFocused: true, bodyColumns: columns, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } })
  const all = nodes(await ui.drawn()), band = all.find(node => node.props?.key === 'coco:band')
  expect(band).toBeDefined()
  expect(all.some(node => node.type === 'Text' && node.props?.bold && text(node).endsWith('name.ts'))).toBe(true)
  expect(extent(band)).toBeLessThanOrEqual(columns * COLUMN_PX + 0.5)
  await ui.unmount()
})
