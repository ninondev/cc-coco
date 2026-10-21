import { describe, expect, test } from 'claude-code/testing'
import type { Elements, ElementChildren } from 'claude-code'
import { pageBlocks } from '../hooks/book'
import type { BookData } from '../hooks/book'
import { BOOK_TEXT } from '../hooks/book-text'
import { companionSection, nowFit } from '../hooks/companion-book'
import { LANGS, WORDS } from '../hooks/words'
import { MORNING } from './world'

type Node = { type?: string; key?: string; props?: Record<string, any>; children?: unknown[] }
function nodes(tree: unknown): Node[] {
  if (!tree || typeof tree !== 'object') return []
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  const n = tree as Node
  return [n, ...(n.children ?? []).flatMap(nodes)]
}
function text(tree: unknown): string {
  if (typeof tree === 'string') return tree
  if (Array.isArray(tree)) return tree.map(text).join('')
  return ((tree as Node)?.children ?? []).map(text).join('')
}
const data: BookData = { view: undefined, usage: undefined, timeZone: 'UTC', fortune: undefined, own: WORDS.en, store: {}, now: MORNING, reducedMotion: false, marks: 'replies', voiceSizes: { light: 100, full: 200 }, reading: 0 }

// Coco Pet for Windows (the same three sizes as the Mac since 10-19); a size saved as Small reads as Medium.
// The mobile page hides companion controls. Exercise its shared drawing directly,
// while the remote page and capture tests validate the engine-mounted VS Code path.
function section(surface: 'desktop' | 'terminal' | 'vscode' | 'mobile'): unknown {
  const element = (type: string) => ({ children, ...props }: Record<string, unknown> & ElementChildren) =>
    ({ type, key: props.key, props, children: children === undefined ? [] : Array.isArray(children) ? children : [children] }) as never
  const ui = { Box: element('Box'), Text: element('Text'), Button: element('Button'), ...(surface === 'terminal' ? {} : { Svg: element('Svg') }) } as unknown as Elements['desktop'] | Elements['terminal'] | Elements['vscode'] | Elements['mobile']
  return companionSection(ui, surface !== 'terminal', BOOK_TEXT.en.settings.companion, BOOK_TEXT.en.settings.now,
    { folder: true, app: true, login: true, state: 'following', asks: false, cannot: false, notRun: false, confirmed: false, afterTools: false, removed: false, message: '', target: 'vscode', targetApp: 'VS Code', pc: 'windows', info: { running: true, size: 'small', targets: ['claude', 'vscode'] }, figures: { medium: { source: '<svg/>', width: 47, height: 48 } } },
    () => {}, true, 54, '', BOOK_TEXT.en.settings.language, surface === 'vscode' || surface === 'mobile')
}

describe('B4c companion rhythm and Now glue', () => {
  for (const surface of ['vscode', 'mobile', 'desktop', 'terminal'] as const) {
    test(`${surface}: size and login keep only the specified gaps`, () => {
      const tree = section(surface)
      for (const label of ["Coco's size", 'Start at login']) {
        const group = nodes(tree).find(n => n.type === 'Box' && (n.children?.[0] as Node)?.type === 'Text' && text(n.children?.[0]).startsWith(label))
        expect(group, label).toBeDefined()
        expect(group?.props?.marginTop, label).toBe(surface === 'vscode' || surface === 'mobile' ? undefined : 1)
        expect(group?.props?.gap, label).toBe(surface === 'vscode' || surface === 'mobile' ? undefined : 1)
      }
      const figureGroup = nodes(tree).find(n => n.type === 'Box' && n.props?.alignItems === 'center' && nodes(n).some(c => c.type === 'Button' && c.key === 'coco:companion:medium'))
      expect(figureGroup?.props?.gap).toBe(1)
      if (surface !== 'terminal') expect(nodes(figureGroup).some(n => n.type === 'Svg')).toBe(true)
    })
  }
  test('every ordinary choice glues Now to its value in all supported languages', () => {
    for (const { code } of LANGS) for (const surface of ['desktop', 'terminal', 'vscode', 'mobile'] as const) {
      const words = BOOK_TEXT[code]
      const choices = pageBlocks('settings', words, { ...data, own: WORDS[code] }, surface).filter(b => b.t === 'choice')
      expect(choices.length).toBeGreaterThan(0)
      for (const choice of choices) {
        // BOOK F2: the block keeps its ordinary spaces; the drawing glues them with nowFit while the whole line fits its width.
        const plain = words.settings.now.split('{value}')[0]!
        expect(choice.now.startsWith(plain), `${code}/${surface}/${choice.label}`).toBe(true)
        expect(nowFit(choice.now, 400).startsWith(plain.replace(/ /g, '\u00a0')), `${code}/${surface}/${choice.label}`).toBe(true)
      }
    }
  })
  test('companion target, size and login glue Now to the current value', () => {
    const shown = nodes(section('vscode')).filter(n => n.type === 'Text').map(text)
    for (const expected of ['Now:\u00a0VS\u00a0Code', 'Now:\u00a0Medium', 'Now:\u00a0On']) expect(shown.some(s => s.includes(expected)), expected).toBe(true)
  })
})
