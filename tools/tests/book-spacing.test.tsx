// The book's zh/ja typography: joined Latin/CJK prose, including numbers filled at runtime.
// Commands, paths, URLs and inline code retain their own spaces. The source check includes
// the shared about/alt words, so an unvisited page cannot hide a gap.
import { describe, expect, test } from 'claude-code/testing'
import { pageBlocks } from '../hooks/book'
import { loadD1Words } from '../hooks/d1-words'
import { D1_WORDS_TEXT } from './d1-room-fixture'
import { loadC3Words } from '../hooks/c3-words'
import { C3_WORDS_RAW } from './c3-words-fixture'
import type { BookData } from '../hooks/book'
import { PAGES } from '../hooks/book-words'
import type { BookWords } from '../hooks/book-words'
import { LANGS, WORDS } from '../hooks/words'
import { BOOK_FILES } from './book-files'
import { ICON_AUTHOR_WORDS } from './icon-words-fixture'
import { settleLegacyStart, MORNING, P, PERSON, RECENT, world } from './world'

function strings(tree: unknown, path = ''): Record<string, string> {
  if (typeof tree === 'string') return { [path]: tree }
  const out: Record<string, string> = {}
  if (Array.isArray(tree)) tree.forEach((value, i) => Object.assign(out, strings(value, `${path}[${i}]`)))
  else if (tree && typeof tree === 'object') for (const [key, value] of Object.entries(tree)) Object.assign(out, strings(value, `${path}.${key}`))
  return out
}

function proseGaps(text: string): string[] {
  // A slash command includes its Latin arguments, not the Chinese/Japanese words after it.
  // The two bare commands in his library are intentional copyable technical text.
  // His two fallback lines also show literal commands. Keep their own spaces,
  // including the alternate `clear` argument, without exempting nearby prose.
  const technical = text.replace(/\/coco:icon (?:apply|clear)(?: (?:或|か) clear)?|\bopen -a "Coco Pet"/g, '•')
  const prose = technical.replace(/`+[^`]*`+|https?:\/\/[^\s\u3400-\u9fff\u3040-\u30ff]+|(?:~\/|\.\.?\/|\/)[A-Za-z0-9_:.<>|/-]+(?: +[A-Za-z0-9_:.<>|/-]+)*|\bgit push --force\b|\bultrathink\b/g, '•')
  const cjk = '[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}]'
  // Templates are filled before checking. A % belongs to its number, and -sama is a suffix.
  const gaps = new RegExp(`[\\p{Script=Latin}\\p{Number}%][ \\u00a0\\u202f]+${cjk}|${cjk}[ \\u00a0\\u202f]+(?:[\\p{Script=Latin}\\p{Number}]|-[\\p{Script=Latin}])`, 'gu')
  return [...prose.matchAll(gaps)].map(match => match[0])
}

function filled(text: string): string {
  return text.replace(/\{\w+\}/g, '12')
}

const APPROVED_ICON_FALLBACK = {
  zh: '可以试试 /coco icon apply 或 clear',
  'zh-Hant': '可以試試 /coco icon apply 或 clear',
  ja: '/coco icon apply か clear で試せる',
} as const

function problems(tree: unknown, source: string): string[] {
  // C2 requires these exact author-approved bytes. Exempt only this template
  // and this independent fixed-data rendering; all adjacent prose stays checked.
  const approved: Record<string, string> = {
    'book/ja.json.offerings.tokensAbout': '{used} / {max} トークン',
    'ja.offerings.estimate[1].detail': '~64,500 / 200,000 トークン',
    'book/zh.json.settings.icon.fallback': APPROVED_ICON_FALLBACK.zh,
    'book/zh-Hant.json.settings.icon.fallback': APPROVED_ICON_FALLBACK['zh-Hant'],
    'book/ja.json.settings.icon.fallback': APPROVED_ICON_FALLBACK.ja,
  }
  return Object.entries(strings(tree)).flatMap(([path, text]) => approved[`${source}${path}`] === text ? [] : proseGaps(filled(text)).map(gap => `${source}${path}: ${gap}`))
}

describe('zh and ja book spacing', () => {
  test('approved C2 Japanese estimate spacing is byte exact and key scoped', () => {
    expect(problems({ offerings: { tokensAbout: '{used} / {max} トークン' } }, 'book/ja.json')).toEqual([])
    expect(problems({ offerings: { tokensAbout: '{used} / {max}  トークン' } }, 'book/ja.json').length).toBeGreaterThan(0)
    expect(problems({ offerings: { tokens: '{used} / {max} トークン' } }, 'book/ja.json').length).toBeGreaterThan(0)
    expect(problems([{}, { detail: '~64,500 / 200,000 トークン' }], 'ja.offerings.estimate')).toEqual([])
    expect(problems([{}, { detail: '~64,500 / 200,000 トークン です' }], 'ja.offerings.estimate').length).toBeGreaterThan(0)
  })
  test('approved icon fallback spacing is byte exact, source exact and key scoped', () => {
    for (const code of ['zh', 'zh-Hant', 'ja'] as const) {
      const text = APPROVED_ICON_FALLBACK[code]
      const source = `book/${code}.json`
      expect(ICON_AUTHOR_WORDS.fallback![code]).toBe(text)
      expect((JSON.parse(BOOK_FILES[`${code}.json`] ?? 'null') as BookWords).settings.icon.fallback).toBe(text)
      expect(proseGaps(text).length).toBeGreaterThan(0)
      expect(problems({ settings: { icon: { fallback: text } } }, source)).toEqual([])
      expect(problems({ settings: { icon: { other: text } } }, source).length).toBeGreaterThan(0)
      expect(problems({ settings: { icon: { fallback: text.replace('clear', ' clear') } } }, source).length).toBeGreaterThan(0)
      expect(problems({ settings: { icon: { fallback: text + ' changed' } } }, source).length).toBeGreaterThan(0)
      expect(problems({ settings: { icon: { fallback: text } } }, 'book/en.json').length).toBeGreaterThan(0)
      expect(problems({ settings: { icon: { fallback: text } } }, `words.${code}`).length).toBeGreaterThan(0)
    }
  })
  test('the guard rejects prose gaps in either direction and after filling numbers', () => {
    for (const text of ['Claude Code 的语言', '在 Claude Code里', '12 種', '第 12页', '32% たまっている', '要加 -sama', 'café の本', '第 {n}篇', '{n} 回']) {
      expect(proseGaps(filled(text)).length).toBeGreaterThan(0)
    }
    for (const text of ['Claude Code的语言', '在Claude Code里', '12種', '32%たまっている', '运行 /coco lang zh 打开', '/coco:icon apply と入力', '按 /cost 的算法', '看见 git push --force 就抱紧书', '写 ultrathink 他就松开一点', '查看 ~/Library/Claude Code/view.json 文件', '访问 https://example.com/book 页面', '查看 `Claude Code 的` 示例']) {
      expect(proseGaps(text)).toEqual([])
    }
    for (const text of ['可以试试 /coco:icon apply 或 clear', '/coco:icon apply か clear で試せる', '也可以运行 open -a "Coco Pet"', 'または open -a "Coco Pet" を実行']) expect(proseGaps(text)).toEqual([])
    // Protecting a command must not exempt the rest of its sentence.
    expect(proseGaps('运行 /coco lang zh 后，Claude Code 的语言改变')).toEqual(['e 的'])
    expect(proseGaps('运行 open -a "Coco Pet" 后,Claude Code 的语言改变')).toEqual(['e 的'])
    expect(proseGaps('/coco:icon apply か clear で試せる。Claude Code の表示')).toEqual(['e の'])
  })

  test('all zh/ja book sources have no prose gaps, including the companion and shared words', { timeoutMs: 60_000 }, () => {
    const wrong: string[] = []
    for (const code of ['zh', 'zh-Hant', 'ja'] as const) {
      wrong.push(...problems(JSON.parse(BOOK_FILES[`${code}.json`] ?? 'null'), `book/${code}.json`))
      wrong.push(...problems({ name: WORDS[code].name, about: WORDS[code].about, alt: WORDS[code].alt }, `words.${code}`))
    }
    expect(wrong).toEqual([])
    const zh = JSON.parse(BOOK_FILES['zh.json'] ?? 'null') as BookWords
    const ja = JSON.parse(BOOK_FILES['ja.json'] ?? 'null') as BookWords
    expect(zh.library.readings.some(reading => reading.text.includes('你敲下ultrathink时'))).toBe(true)
    expect(ja.library.readings.some(reading => reading.text.includes('きみがultrathinkと打つと'))).toBe(true)
    expect(zh.settings.voice.help).toContain('Claude全程')
    expect(ja.settings.companion.toolsButton).toBe('Command Line Toolsを入れる')
  })

  test('page text stays joined after percentages, counts, dates and prompt sizes are filled', { timeoutMs: 60_000 }, async ($, on) => {
    await loadD1Words(async () => D1_WORDS_TEXT)
    const live = world(on, { store: RECENT })
    await $.session.start({ cwd: '/tmp/project', surface: 'terminal', isInteractive: true }); await settleLegacyStart($,live);
    const wrong: string[] = []
    for (const code of ['zh', 'zh-Hant', 'ja'] as const) {
      await $.command.run({ command: 'coco', args: `lang ${code}`, origin: PERSON, presentation: P })
      const words = JSON.parse(BOOK_FILES[`${code}.json`] ?? 'null') as BookWords
      const data: BookData = {
        view: { ...live.view(), context: 32 },
        own: WORDS[code], now: MORNING, timeZone: 'UTC', reducedMotion: false,
        marks: 'replies', voiceSizes: { light: 124, full: 456 }, reading: 0,
        store: { turns: 12, wilds: 12, firstMet: MORNING - 86_400_000, latestNight: { at: MORNING - 86_400_000, minutes: 60 } },
        usage: { startedAt: MORNING - 86_400_000, context: { window: 200000, tokens: 64000, percent: 32 }, rateLimits: [{ kind: 'five_hour', percentUsed: 23.5, resetsAt: '2026-10-06T09:00:00Z' }], cost: { usd: 1.84 } },
      }
      for (const page of PAGES) wrong.push(...problems(pageBlocks(page, words, data), `${code}.${page}`))
      data.view = { ...data.view!, estimate: true }
      data.usage = { ...data.usage!, context: { ...data.usage!.context!, breakdown: { totalTokens: 64500 } } }
      wrong.push(...problems(pageBlocks('offerings', words, data), `${code}.offerings.estimate`))
      await $.command.run({ command: 'coco', args: 'about', origin: PERSON, presentation: P })
      for (const surface of ['desktop', 'terminal'] as const) {
        const ui = await $.ui.mount({
          surface, plugin: 'coco', component: 'Pane', requestId: 'coco-book',
          props: { title: 'Coco', isFocused: false, bodyColumns: 64, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
        })
        for (const page of PAGES) {
          await ui.press({ key: `coco:book:tab:${page}` })
          await ui.redraw()
          const text = (await ui.findAll({ type: 'Text' })).map(node => String(node.text))
          const labels = (await ui.findAll({ type: 'Button' })).map(node => String(node.props.label))
          const alts = (await ui.findAll({ type: 'Svg' })).map(node => String(node.props.alt))
          wrong.push(...problems([...text, ...labels, ...alts], `${code}.${surface}.${page}`))
        }
        await ui.unmount()
      }
    }
    expect(wrong).toEqual([])
  })

  // BOOK 10-09 (label column, D3): a choice stands as its label (bold) with "Now: value" under it in the secondary colour
  // in the terminal; the desktop marks the chosen button and has no "Now:" line (owner 10-23). From 48 columns
  // a fact is its label in a column and its value beside it, with no colon. Under 48 columns a fact keeps
  // today's inline form, so zh, zh-Hant and ja keep their colon there.
  for (const {code} of LANGS) test('choice labels carry Now under them in the terminal and not on the desktop; zh and ja facts keep their colon under 48 columns: '+code, { options:{language:'auto',resolvedLanguage:code}, timeoutMs: 60_000 }, async ($, on) => {
    await loadD1Words(async () => D1_WORDS_TEXT)
    // The Breathing row (PLAY 4.1, main Settings since 10-09) takes its words from c3-text.json, as the plugin does.
    await loadC3Words(async () => C3_WORDS_RAW)
    const store = { ...RECENT, voice: 'light', voiceChosen: true, marks: 'replies', turns: 12, wilds: 12, firstMet: MORNING - 86_400_000, latestNight: { at: MORNING - 86_400_000, minutes: 60 } }
    const settings = { language: code }
    const live = world(on, { store, settings, percent: 32, cost: 1.84, startedAt: MORNING - 86_400_000 })
    await $.session.start({ cwd: '/tmp/project', surface: 'terminal', isInteractive: true }); await settleLegacyStart($,live);
    const wrong: string[] = []
      await $.command.run({ command: 'coco', args: 'lang auto', origin: PERSON, presentation: P })
      const words = JSON.parse(BOOK_FILES[`${code}.json`] ?? 'null') as BookWords
      const data: BookData = {
        view: { ...live.view(), context: 32 },
        own: WORDS[code], now: MORNING, timeZone: 'UTC', reducedMotion: false,
        marks: 'replies', voiceSizes: { light: 124, full: 456 }, reading: 0,
        store,
        usage: { startedAt: MORNING - 86_400_000, context: { window: 200000, tokens: 64000, percent: 32 }, rateLimits: [], cost: { usd: 1.84 } },
      }
      await $.command.run({ command: 'coco', args: 'settings', origin: PERSON, presentation: P })
      const glued = (value: string) => value.replace(/[\u00a0\u202f]/g, ' ')
      for (const surface of ['desktop', 'terminal'] as const) for (const columns of [64, 40]) {
        // the breathing row is worded from the c3 table, which this test process does not hold in the pane's language
        const headers = pageBlocks('settings', words, data, surface).filter(block => block.t === 'choice' && !block.options.some(option => option.key.startsWith('coco:set:breathe:')))
        const ui = await $.ui.mount({
          surface, plugin: 'coco', component: 'Pane', requestId: 'coco-book',
          props: { title: 'Coco', isFocused: false, bodyColumns: columns, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
        })
        const rendered = (await ui.findAll({ type: 'Text' })).map(node => String(node.text))
        for (const header of headers) {
          if (!rendered.includes(header.label)) wrong.push(`${code}.${surface}.${columns}: missing choice label ${JSON.stringify(header.label)}`)
          const nowShown = rendered.some(shown => glued(shown) === glued(header.now))
          if (surface === 'terminal' && !nowShown) wrong.push(`${code}.${surface}.${columns}: missing Now line ${JSON.stringify(header.now)}`)
          if (surface === 'desktop' && nowShown) wrong.push(`${code}.${surface}.${columns}: Now line on the desktop ${JSON.stringify(header.now)}`)
          if (rendered.includes(`${header.label}:${header.now}`)) wrong.push(`${code}.${surface}.${columns}: colon joined choice header ${header.label}`)
        }
        if (code.startsWith('zh') || code === 'ja') {
          for (const page of ['offerings', 'log'] as const) {
            const pageData = pageBlocks(page, words, data)
            await ui.press({ key: `coco:book:tab:${page}` })
            await ui.redraw()
            const pageText = (await ui.findAll({ type: 'Text' })).map(node => String(node.text))
            for (const fact of pageData.filter(block => block.t === 'fact')) {
              if (columns >= 48) {
                if (!pageText.includes(fact.label) || !pageText.includes(fact.text) || pageText.includes(`${fact.label}:${fact.text}`)) wrong.push(`${code}.${surface}.${columns}.${page}: fact not in two columns ${JSON.stringify(fact.label)}`)
              } else {
                const joined = `${fact.label}:${fact.text}`
                if (!pageText.includes(joined)) wrong.push(`${code}.${surface}.${columns}.${page}: missing fact ${JSON.stringify(joined)}`)
              }
            }
            await ui.press({ key: 'coco:book:tab:settings' })
            await ui.redraw()
          }
          if (code === 'zh' && (!rendered.includes('回复语气') || (surface === 'terminal') !== rendered.includes('现在:开'))) wrong.push(`${code}.${surface}.${columns}: exact voice header missing`)
          if (code === 'ja' && (!rendered.includes('言語') || (surface === 'terminal') !== rendered.some(shown => glued(shown) === 'いま:自動(日本語)'))) wrong.push(`${code}.${surface}.${columns}: exact language header missing`)
        }
        await ui.unmount()
      }
    expect(wrong).toEqual([])
  })
})
