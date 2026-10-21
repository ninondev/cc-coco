import { describe, expect, test } from 'claude-code/testing'
import { planHead } from '../hooks/transcript'
import { LANGS, WORDS } from '../hooks/words'
import { planPx } from '../hooks/typeset'

describe('B4 heads at narrow widths', () => {
  for (const language of LANGS) test(language.code, () => {
    const lang = language.code
    const w = WORDS[lang]
    const narrow = planHead({ mood: 'think', newest: true }, lang, 42, 'vscode', true)
    expect([w.marks.book, w.marks.shelf]).toContain(narrow.label)
    if (narrow.direction?.includes('…')) expect(narrow.direction.endsWith(w.aside.think.slice(-1))).toBe(true)
    expect(planHead({ mood: 'think', newest: true }, lang, 25, 'mobile', true).label).toBeUndefined()
    expect(planHead({ mood: 'happy', newest: false, endedAt: 172800000, ms: 120000 }, lang, 100, 'mobile', true).note).toBeUndefined()
  })
  test('desktop band cue budgets only the visible crest and name for its hover note', () => {
    const w = WORDS.en
    const wide = planHead({ mood: 'flustered', newest: false, endedAt: 172800000, ms: 120000 }, 'en', 100, 'desktop', false)
    expect(wide.note).toBeDefined()
    const columns = Math.ceil((planPx('✻ ', true) + planPx(w.name, true) + 7.8 + planPx(wide.note!)) / 7.8)
    const fitted = planHead({ mood: 'flustered', newest: false, endedAt: 172800000, ms: 120000 }, 'en', columns, 'desktop', false)
    expect(fitted.direction).toBeUndefined()
    expect(fitted.note).toBe(wide.note)
  })
})
