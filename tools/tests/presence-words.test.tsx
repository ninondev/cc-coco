import { describe, expect, test } from 'claude-code/testing'
import { fill } from '../hooks/book-words'
import { BOOK_FILES } from './book-files'
import { LANGS } from '../hooks/words'

// The marks help is the SPARK words of 10-09 as the 90-cell rewrite of groups-f-1009.json (his spark sits beside a comment he liked, not a file change).
const EXACT = {
  zh: ['她喜欢的注释旁一颗星芒,由红转绿的测试或构建下面一朵花', '选择…', '站在谁旁边', '开着好几个VS Code窗口时,她站在最前面那个旁边'],
  en: ['A spark beside a comment Coco liked, a flower when a run turns red to green.', 'Choose…', 'Stands beside', 'With several VS Code windows open, Coco stands by the one in front.'],
  ja: ['気に入ったコメントに星芒、赤から緑に変わったテストやビルドに花', '選ぶ…', 'そばにいるアプリ', 'VS Codeのウィンドウがいくつもあるときは、いちばん手前のそばに立つ'],
}

describe('presence words', () => {
  test('the authored Chinese, English and Japanese book words stay exact', () => {
    for (const lang of ['zh', 'en', 'ja'] as const) {
      const settings = JSON.parse(BOOK_FILES[`${lang}.json`]).settings
      expect([settings.marks.help, settings.language.choose, settings.companion.target?.label, settings.companion.target?.help]).toEqual(EXACT[lang])
    }
  })

  test('all supported books translate the new controls and fill only the named companion app', () => {
    expect(Object.keys(BOOK_FILES).sort()).toEqual(LANGS.map(({ code }) => `${code}.json`).sort())
    for (const [name, source] of Object.entries(BOOK_FILES)) {
      const settings = JSON.parse(source).settings
      for (const text of [settings.language.choose, settings.companion.target?.label, settings.companion.target?.help]) {
        expect(typeof text).toBe('string')
        expect(String(text).trim().length).toBeGreaterThan(0)
      }
      expect(settings.companion.target.help.includes('VS Code')).toBe(true)
      for (const text of [settings.companion.absentLine, settings.companion.stageAlt.absent, settings.companion.stageAlt.following]) {
        expect(text.includes('{app}')).toBe(true)
        expect(text.includes('Claude')).toBe(false)
        for (const app of ['Claude', 'VS Code']) {
          const rendered = fill(text, { app })
          expect(rendered.includes(app)).toBe(true)
          expect(rendered.includes('{app}')).toBe(false)
        }
      }
      for (const state of ['stopped', 'hidden', 'corner']) expect(settings.companion.stageAlt[state].includes('{app}')).toBe(false)
      expect(settings.language.autoNow).toMatch(/^\{auto\} ?\(\{language\}\)$/)
      if (name !== 'en.json') expect(settings.marks.help).not.toBe(EXACT.en[0])
    }
  })
})
