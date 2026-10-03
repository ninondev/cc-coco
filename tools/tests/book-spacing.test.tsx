// The book's zh/ja typography: joined Latin/CJK prose, including numbers filled at runtime.
// Commands, paths, URLs and inline code retain their own spaces. The source check includes
// the shared about/alt words and every fortune, so an unvisited page or slip cannot hide a gap.
import { describe, expect, test } from 'claude-code/testing'
import { pageBlocks } from '../hooks/book'
import type { BookData } from '../hooks/book'
import { PAGES } from '../hooks/book-words'
import type { BookWords } from '../hooks/book-words'
import { LINES } from '../hooks/lines'
import { LANGS, WORDS } from '../hooks/words'
import { BOOK_FILES } from './book-files'
import { MORNING, P, PERSON, RECENT, world } from './world'

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
  const technical = text.replace(/\/claudesama:icon (?:apply|clear)(?: (?:或|か) clear)?|\bopen -a "Claude-sama Companion"/g, '•')
  const prose = technical.replace(/`+[^`]*`+|https?:\/\/[^\s\u3400-\u9fff\u3040-\u30ff]+|(?:~\/|\.\.?\/|\/)[A-Za-z0-9_:.<>|/-]+(?: +[A-Za-z0-9_:.<>|/-]+)*|\bgit push --force\b|\bultrathink\b/g, '•')
  const cjk = '[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}]'
  // Templates are filled before checking. A % belongs to its number, and -sama is a suffix.
  const gaps = new RegExp(`[\\p{Script=Latin}\\p{Number}%][ \\u00a0\\u202f]+${cjk}|${cjk}[ \\u00a0\\u202f]+(?:[\\p{Script=Latin}\\p{Number}]|-[\\p{Script=Latin}])`, 'gu')
  return [...prose.matchAll(gaps)].map(match => match[0])
}

function filled(text: string): string {
  return text.replace(/\{\w+\}/g, '12')
}

function problems(tree: unknown, source: string): string[] {
  return Object.entries(strings(tree)).flatMap(([path, text]) => proseGaps(filled(text)).map(gap => `${source}${path}: ${gap}`))
}

describe('zh and ja book spacing', () => {
  test('the guard rejects prose gaps in either direction and after filling numbers', () => {
    for (const text of ['Claude Code 的语言', '在 Claude Code里', '12 種', '第 12页', '32% たまっている', '要加 -sama', 'café の本', '第 {n}篇', '{n} 回']) {
      expect(proseGaps(filled(text)).length).toBeGreaterThan(0)
    }
    for (const text of ['Claude Code的语言', '在Claude Code里', '12種', '32%たまっている', '运行 /claudesama lang zh 打开', '/claudesama:icon apply と入力', '按 /cost 的算法', '看见 git push --force 就抱紧书', '写 ultrathink 他就松开一点', '查看 ~/Library/Claude Code/view.json 文件', '访问 https://example.com/book 页面', '查看 `Claude Code 的` 示例']) {
      expect(proseGaps(text)).toEqual([])
    }
    for (const text of ['可以试试 /claudesama:icon apply 或 clear', '/claudesama:icon apply か clear で試せる', '也可以运行 open -a "Claude-sama Companion"', 'または open -a "Claude-sama Companion" を実行']) expect(proseGaps(text)).toEqual([])
    // Protecting a command must not exempt the rest of its sentence.
    expect(proseGaps('运行 /claudesama lang zh 后，Claude Code 的语言改变')).toEqual(['e 的'])
    expect(proseGaps('运行 open -a "Claude-sama Companion" 后,Claude Code 的语言改变')).toEqual(['e 的'])
    expect(proseGaps('/claudesama:icon apply か clear で試せる。Claude Code の表示')).toEqual(['e の'])
  })

  test('all zh/ja book sources have no prose gaps, including the companion and shared words', { timeoutMs: 60_000 }, () => {
    const wrong: string[] = []
    for (const code of ['zh', 'ja'] as const) {
      wrong.push(...problems(JSON.parse(BOOK_FILES[`${code}.json`] ?? 'null'), `book/${code}.json`))
      wrong.push(...problems({ name: WORDS[code].name, about: WORDS[code].about, alt: WORDS[code].alt }, `words.${code}`))
      wrong.push(...problems(LINES.omikuji[code], `omikuji.${code}`))
    }
    expect(wrong).toEqual([])
    const zh = JSON.parse(BOOK_FILES['zh.json'] ?? 'null') as BookWords
    const ja = JSON.parse(BOOK_FILES['ja.json'] ?? 'null') as BookWords
    expect(zh.library.readings.some(reading => reading.text.includes('看见 git push --force,他'))).toBe(true)
    expect(ja.library.readings.some(reading => reading.text.includes('git push --force を見る'))).toBe(true)
    expect(zh.settings.voice.help).toContain('Claude全程')
    expect(ja.settings.companion.toolsButton).toBe('Command Line Toolsを入れる')
  })

  test('page text stays joined after percentages, counts, dates and prompt sizes are filled', { timeoutMs: 60_000 }, async ($, on) => {
    const live = world(on, { store: RECENT })
    await $.session.start({ cwd: '/tmp/project', surface: 'terminal', isInteractive: true })
    const wrong: string[] = []
    for (const code of ['zh', 'ja'] as const) {
      await $.command.run({ command: 'claudesama', args: `lang ${code}`, origin: PERSON, presentation: P })
      const words = JSON.parse(BOOK_FILES[`${code}.json`] ?? 'null') as BookWords
      const data: BookData = {
        view: { ...live.view(), context: 32 },
        own: WORDS[code], now: MORNING, timeZone: 'UTC', reducedMotion: false,
        marks: 'replies', voiceSizes: { light: 124, full: 456 }, reading: 0,
        store: { turns: 12, wilds: 12, omens: 12, firstMet: MORNING - 86_400_000, latestNight: { at: MORNING - 86_400_000, minutes: 60 } },
        usage: { startedAt: MORNING - 86_400_000, context: { window: 200000, tokens: 64000, percent: 32 }, rateLimits: [{ kind: 'five_hour', percentUsed: 23.5, resetsAt: '2026-10-06T09:00:00Z' }], cost: { usd: 1.84 } },
        fortune: { line: Object.values(LINES.omikuji[code]).flat()[0]!, rank: '', day: '2026-10-01' },
      }
      for (const page of PAGES) wrong.push(...problems(pageBlocks(page, words, data), `${code}.${page}`))
      data.view = { ...data.view!, estimate: true }
      data.usage = { ...data.usage!, context: { ...data.usage!.context!, breakdown: { totalTokens: 64500 } } }
      wrong.push(...problems(pageBlocks('offerings', words, data), `${code}.offerings.estimate`))
      await $.command.run({ command: 'claudesama', args: 'about', origin: PERSON, presentation: P })
      for (const surface of ['desktop', 'terminal'] as const) {
        const ui = await $.ui.mount({
          surface, plugin: 'claudesama', component: 'Pane', requestId: 'claudesama-book',
          props: { title: 'Claude-sama', isFocused: false, bodyColumns: 64, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
        })
        for (const page of PAGES) {
          await ui.press({ key: `claudesama:book:tab:${page}` })
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

  test('choice headers use two spaces on both book surfaces; zh and ja facts keep their colon', { timeoutMs: 60_000 }, async ($, on) => {
    const store = { ...RECENT, marks: 'replies', turns: 12, wilds: 12, omens: 12, firstMet: MORNING - 86_400_000, latestNight: { at: MORNING - 86_400_000, minutes: 60 } }
    const settings = { language: 'en' }
    const live = world(on, { store, settings, percent: 32, cost: 1.84, startedAt: MORNING - 86_400_000 })
    await $.session.start({ cwd: '/tmp/project', surface: 'terminal', isInteractive: true })
    const wrong: string[] = []
    for (const { code } of LANGS) {
      settings.language = code
      await $.command.run({ command: 'claudesama', args: 'lang auto', origin: PERSON, presentation: P })
      const words = JSON.parse(BOOK_FILES[`${code}.json`] ?? 'null') as BookWords
      const data: BookData = {
        view: { ...live.view(), context: 32 },
        own: WORDS[code], now: MORNING, timeZone: 'UTC', reducedMotion: false,
        marks: 'replies', voiceSizes: { light: 124, full: 456 }, reading: 0,
        store,
        usage: { startedAt: MORNING - 86_400_000, context: { window: 200000, tokens: 64000, percent: 32 }, rateLimits: [], cost: { usd: 1.84 } },
        fortune: { line: Object.values(LINES.omikuji[code]).flat()[0]!, rank: '', day: '2026-10-01' },
      }
      await $.command.run({ command: 'claudesama', args: 'settings', origin: PERSON, presentation: P })
      for (const surface of ['desktop', 'terminal'] as const) {
        const headers = pageBlocks('settings', words, data, surface).filter(block => block.t === 'choice')
        const ui = await $.ui.mount({
          surface, plugin: 'claudesama', component: 'Pane', requestId: 'claudesama-book',
          props: { title: 'Claude-sama', isFocused: false, bodyColumns: 64, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
        })
        const rendered = (await ui.findAll({ type: 'Text' })).map(node => String(node.text))
        for (const header of headers) {
          const joined = `${header.label}  ${header.now}`
          if (!rendered.includes(joined)) wrong.push(`${code}.${surface}: missing choice header ${JSON.stringify(joined)}`)
          if (rendered.includes(`${header.label}:${header.now}`)) wrong.push(`${code}.${surface}: colon joined choice header ${header.label}`)
        }
        if (code === 'zh' || code === 'ja') {
          for (const page of ['offerings', 'log'] as const) {
            const pageData = pageBlocks(page, words, data)
            await ui.press({ key: `claudesama:book:tab:${page}` })
            await ui.redraw()
            const pageText = (await ui.findAll({ type: 'Text' })).map(node => String(node.text))
            for (const fact of pageData.filter(block => block.t === 'fact')) {
              const joined = `${fact.label}:${fact.text}`
              if (!pageText.includes(joined)) wrong.push(`${code}.${surface}.${page}: missing fact ${JSON.stringify(joined)}`)
            }
            await ui.press({ key: 'claudesama:book:tab:settings' })
            await ui.redraw()
          }
          if (code === 'zh' && !rendered.includes('回复语气  现在:轻')) wrong.push(`${code}.${surface}: exact voice header missing`)
          if (code === 'ja' && !rendered.includes('言語  いま:自動 · 日本語')) wrong.push(`${code}.${surface}: exact language header missing`)
        }
        await ui.unmount()
      }
    }
    expect(wrong).toEqual([])
  })
})
