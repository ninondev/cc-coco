import { expect, test } from 'claude-code/testing'
import { planDesktop } from '../hooks/band'
import { initialView, linesFor } from '../hooks/mood'
import { LANGS } from '../hooks/words'
import { getMotionWidth } from '../hooks/pictures-lazy'
import { COLUMN_PX, minWrapPx, planPx } from '../hooks/typeset'
import { P, PERSON, RECENT, world, settleLegacyStart } from './world'

// G1 fix round, lead's call 10-09: the name goes before the cut of the line's end. Since 10-18 her line hangs after her
// name on the script row (DECISIONS 1017), so her name gives way where the line then stands whole in the column's two rows;
// a line too long for the column without her name is cut once, and her name stays. The cases are the golden review's R1
// captures (reports/g1-golden-review.md).
const size = (columns: number) => ({ columns, isWorking: false, maxRows: 30, screenRows: 48 })
const quota = { rateLimits: [], tokens: 182000, at: Date.UTC(2026, 9, 2, 9) } as any
const saying = (lang: any, said: string) => ({ ...initialView(), lang, said, context: 91, quota })

// The text column, worked out from the design and not from the planner: the band less the two-column inset on the right, the
// ribbon slot, his picture and a column.
const columnPx = (columns: number, height: number) => columns * COLUMN_PX - 2 * COLUMN_PX - (12 + getMotionWidth(height, false) + COLUMN_PX)
// Independent word-wrap oracle, CJK breaking between characters.
function rowsOf(text: string, width: number): number {
  const units = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[^ \t\n\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+|[ \t]+|\n/gu) ?? []
  let rows = 1, used = 0
  for (const unit of units) {
    const w = planPx(unit)
    if (w > width && unit.trim()) return Infinity
    if (used + w > width) { rows++; used = unit.trim() ? w : 0 } else used += w
  }
  return rows
}

for (const [lang, said, columns] of [
  ['de', 'Der Spendenkasten ist voll.', 38],
  ['id', 'kotak persembahan hampir penuh.', 38],
  ['ja', 'お賽銭箱、そろそろいっぱい', 34],
] as const) test(`R1 ${lang} ${columns} cols: the whole line stands in the column's two rows, her name giving way first`, () => {
  const p = planDesktop(saying(lang, said) as any, size(columns))
  expect(p.row).toBe(false)
  expect(p.speech).toBe(said)
  expect(p.lineRows).toBe(2)
  expect(rowsOf(said, columnPx(columns, p.height))).toBeLessThanOrEqual(2)
  // her name stays where the whole line stands after it, and gives way where it does not
  expect([undefined, planDesktop({ ...saying(lang, said), said: null } as any, size(columns)).name]).toContain(p.name)
})

// A line wider than two rows of the column is cut once, at its end, and its name on the cue line stays as it was.
test('R1 a line too long for two rows is cut once at its end; the name on the cue line is the silent one', () => {
  const said = 'Der Spendenkasten ist voll. Es wäre schön, wenn du ihn bald ausleeren könntest, bevor er überläuft und alles durcheinanderbringt.'
  const p = planDesktop(saying('de', said) as any, size(34))
  expect(rowsOf(said, columnPx(34, p.height))).toBeGreaterThan(2)
  expect(p.speech!.endsWith('…')).toBe(true)
  expect(p.speech!.split('…').length - 1).toBe(1)
  expect(rowsOf(p.speech!, columnPx(34, p.height))).toBeLessThanOrEqual(2)
  expect(p.name).toBe(planDesktop({ ...saying('de', said), said: null } as any, size(34)).name)
})

// The order itself, for every language and every width the desktop band has: at rest a line is cut only when it does not fit
// the two rows of the column, so a cut line never stands where the whole of it would have fitted.
const COLS = [34, 38, 42, 46, 52, 58, 63, 70, 76, 86, 95, 120]
for (const lang of LANGS.map(l => l.code)) for (const scene of ['saying', 'saying-word'] as const) test(`R1 ${lang}/${scene}: at rest a line is cut only when two rows of the column cannot hold it`, async ($, on) => {
  const w = world(on, { store: RECENT, percent: 91, env: { LANG: LANGS.find(l => l.code === lang)!.locale } })
  await $.session.start({ cwd: '/tmp/project', surface: 'terminal', isInteractive: true })
  await settleLegacyStart($, w)
  await w.clock.advance(1000)
  const candidates = linesFor(w.view(), 'offering_full')
  const width = scene === 'saying-word' ? minWrapPx : planPx
  const selected = candidates.reduce((best, line) => width(line) > width(best) ? line : best)
  w.patch({ said: selected, line: undefined })
  const source = selected
  let checked = 0
  for (const columns of COLS) {
    const p = planDesktop(w.view(), size(columns), selected)
    if (p.row || p.speech === undefined || p.speech === '') continue
    checked++
    const room = columnPx(columns, p.height)
    if (!p.speech.includes('…')) expect([lang, scene, columns, p.speech === source]).toEqual([lang, scene, columns, true])
    else expect([lang, scene, columns, rowsOf(source, room) > 2 || p.showButton === false]).toEqual([lang, scene, columns, true])
  }
  expect(checked).toBeGreaterThan(0)
})
