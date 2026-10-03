// His touch reactions, VoiceOver hint and menu reach the companion in every language.

import { describe, expect, test } from 'claude-code/testing'
import { companionRecord, TASK_WORDS } from '../hooks/companion'
import { LINES } from '../hooks/lines'
import { LANGS } from '../hooks/words'

const VIEW: Parameters<typeof companionRecord>[0] = {
  mood: 'idle', frame: 'idle-reading', said: null, slip: null, context: null, estimate: false,
  verb: '', band: 'on', voice: 'off', affection: 'warm', lang: 'en', pictures: 'cells', colors: 'truecolor', cue: '',
}
const REACTIONS = ['pat', 'flustered', 'drag', 'drop', 'hold', 'shiori'] as const
const CARD_SPEECH = ['followMenu', 'offerTitle', 'offerBody', 'yes', 'later', 'waitTitle', 'waitBody', 'open', 'close', 'thanks'] as const
const ACTIVITY = ['activity', 'activityMenu', 'empty', 'ready', 'finished', 'placeholder', 'send', 'sending', 'unconfirmed', 'retry', 'expired', 'dictate', 'newChat', 'confirmClear', 'clear', 'cancel', 'close', 'badge', 'opens', 'back', 'hideLines', 'showLines'] as const
const TASKS = ['thinking', 'reading', 'editing', 'running', 'searching', 'web', 'helper', 'planning', 'using', 'waitingOK', 'waitingAnswer'] as const
const MENU = ['pat', 'hide', 'home', 'quit', 'size', 'tiny', 'small', 'medium', 'large', 'followMenu', 'offerTitle', 'offerBody', 'yes', 'later', 'waitTitle', 'waitBody', 'open', 'close', 'thanks'] as const
const ENGLISH = companionRecord(VIEW)

// Horizontal padding only: an explicit newline before a kaomoji is part of his layout.
const LATIN_CJK_SPACE = /[\p{Script=Latin}\p{Number}][^\S\r\n\u2028\u2029]+[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}][^\S\r\n\u2028\u2029]+[\p{Script=Latin}\p{Number}]/u

function speechStrings(tree: unknown): string[] {
  if (typeof tree === 'string') return [tree]
  if (Array.isArray(tree)) return tree.flatMap(speechStrings)
  if (tree && typeof tree === 'object') return Object.values(tree).flatMap(speechStrings)
  return []
}

function allSpeech(lang: 'zh' | 'ja'): string[] {
  const { reactions, words } = companionRecord({ ...VIEW, lang })
  // Root notes and deferred book/command replies stay outside this speech and omen rule.
  return [...speechStrings(LINES[lang]), ...speechStrings(LINES.omikuji[lang]),
    ...REACTIONS.flatMap(key => reactions[key] ?? []), ...Object.values(words), ...Object.values(TASK_WORDS[lang])]
}

function punctuationProblems(lang: 'zh' | 'ja', line: string): string[] {
  const wrong: string[] = []
  // U+203A is the narrow Latin separator macOS uses for its settings paths.
  const keep = (lang === 'ja' ? '、。「」' : '。《》～') + '›'
  for (const mark of line) {
    const forbidden = (/[^\x00-\x7F]/u.test(mark) && /\p{P}/u.test(mark) && mark !== '･')
      || /[\uFF01-\uFF60]/u.test(mark)
    if (forbidden && !keep.includes(mark)) wrong.push(`non-ASCII punctuation ${mark}`)
  }
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(line)
      && /[,\.?!:;()"'][^\S\r\n\u2028\u2029]/u.test(line)) {
    wrong.push('padding after punctuation in CJK text')
  }
  for (const dots of line.matchAll(/\.{2,}/gu)) {
    const before = line[(dots.index ?? 0) - 1]
    const after = line[(dots.index ?? 0) + dots[0].length]
    const parentPath = dots[0] === '..' && /[/\\]/u.test(after ?? '') && (!before || /[\s/\\(]/u.test(before))
    if (dots[0].length !== 3 && !parentPath) wrong.push('ellipsis is not three ASCII dots')
  }
  if (lang === 'zh') {
    for (const prose of line.split(/\r?\n/u)) {
      if (/。[^\p{L}\p{N}]*$/u.test(prose) || /^\s*。/u.test(prose)) wrong.push('Chinese full stop outside two sentences')
    }
  }
  return wrong
}

// Face symbols, rather than a list copied from the reactions, also catch compact variants.
// Restrict Latin letters to common eyes/mouths so ordinary words are not kaomoji.
const KAOMOJI_ENDING = /(?:\([*´`˘ᵕω･⊙><д_^~@oOTuUQq;:'=.\/\\ -]{2,}\)|[><^@oOTuUQq;=˘⊙･][_.~^ωᵕд･][><^@oOTuUQq;=˘⊙･]|\/\/ω\/\/|[:;=][-^]?[3DPp)])$/u

function reactionLayoutProblems(line: string): string[] {
  const wrong: string[] = []
  const face = line.match(KAOMOJI_ENDING)?.[0]
  if (face && !line.endsWith(`\n${face}`)) wrong.push('inline kaomoji')
  if (/[^\S\n]\n/u.test(line)) wrong.push('space before line break')
  for (const tail of line.split('\n').slice(1)) {
    if ([...tail].length > 12) wrong.push('more than twelve characters after line break')
    if (tail.match(KAOMOJI_ENDING)?.[0] !== tail) wrong.push('second line is not a whole kaomoji')
  }
  return wrong
}

describe('the companion in every language', () => {
  test('Chinese and Japanese speech, menus and omen slips use ASCII punctuation except their listed keeps', { timeoutMs: 60_000 }, () => {
    const wrong: string[] = []
    for (const lang of ['zh', 'ja'] as const) {
      for (const line of allSpeech(lang)) {
        for (const problem of punctuationProblems(lang, line)) {
          wrong.push(`${lang}: ${problem} in ${JSON.stringify(line)}`)
        }
      }
    }
    expect(wrong).toEqual([])
    const { words } = companionRecord({ ...VIEW, lang: 'zh' })
    expect(words.thanks).toBe('谢谢,我会跟紧你的窗口✨')
    expect(words.offerBody).toBe('这样我就能一直在旁边。我只看它在哪儿')
    expect(words.waitBody).toBe('隐私与安全性 › 辅助功能')
  })
  test('the punctuation guard rejects planted wide marks and padding while preserving language exceptions and faces', { timeoutMs: 60_000 }, () => {
    for (const lang of ['zh', 'ja'] as const) {
      for (const mark of ['，', '？', '！', '：', '；', '（', '）', '“', '”', '‘', '’', '…', '……', '【', '】', '＊', '＞', '»']) {
        expect(punctuationProblems(lang, `前${mark}後`).length).toBeGreaterThan(0)
      }
      expect(punctuationProblems(lang, '前›後')).toEqual([])
      expect(punctuationProblems(lang, lang === 'zh' ? '隐私与安全性 › 辅助功能' : 'プライバシーとセキュリティ › アクセシビリティ')).toEqual([])
      for (const mark of [',', '?', '!', ':', ';', '(', ')', '"', "'", '...']) {
        expect(punctuationProblems(lang, `前${mark}後`)).toEqual([])
        for (const padding of [' ', '  ', '\t', '\u00a0', '\u3000']) {
          expect(punctuationProblems(lang, `前${mark}${padding}後`)).toContain('padding after punctuation in CJK text')
          expect(punctuationProblems(lang, `前${mark}${padding}bug也醒了`)).toContain('padding after punctuation in CJK text')
        }
      }
      expect(punctuationProblems(lang, '好\n(´･ω･`)')).toEqual([])
      expect(punctuationProblems(lang, '好\n(*´ω`*)')).toEqual([])
      expect(punctuationProblems(lang, '运行 /claudesama lang zh')).toEqual([])
      expect(punctuationProblems(lang, '打开 ~/Library/Application Support')).toEqual([])
      expect(punctuationProblems(lang, '打开 ../assets/../../frames')).toEqual([])
      for (const dots of ['..', '....', '......']) {
        expect(punctuationProblems(lang, `好${dots}再读`)).toContain('ellipsis is not three ASCII dots')
      }
    }
    expect(punctuationProblems('ja', '「本」、次のページ。')).toEqual([])
    expect(punctuationProblems('zh', '读《书》。再读一页')).toEqual([])
    expect(punctuationProblems('zh', '咕噜噜～🐱')).toEqual([])
    expect(punctuationProblems('zh', '太阳当空照, bug也在闹')).toContain('padding after punctuation in CJK text')
    for (const line of ['好、再读', '「好了」']) expect(punctuationProblems('zh', line).length).toBeGreaterThan(0)
    for (const line of ['《本》', 'ゴロゴロ～']) expect(punctuationProblems('ja', line).length).toBeGreaterThan(0)
    for (const line of ['好了。', '"好了。"', '(好了。)', '好了。\n>_<', '。再读']) {
      expect(punctuationProblems('zh', line)).toContain('Chinese full stop outside two sentences')
    }
  })
  test('Chinese and Japanese speech, menus and omen slips close Latin and digit gaps', { timeoutMs: 60_000 }, () => {
    const wrong: string[] = []
    for (const lang of ['zh', 'ja'] as const) {
      for (const line of allSpeech(lang)) {
        // Milestones render a number rather than the literal placeholder braces.
        if (LATIN_CJK_SPACE.test(line.replace(/\{pages\}/g, '12'))) wrong.push(`${lang}: ${JSON.stringify(line)}`)
      }
    }
    expect(wrong).toEqual([])
  })
  test('the gap check rejects digits and repeated or nonbreaking padding without crossing face newlines', { timeoutMs: 60_000 }, () => {
    for (const cjk of ['中', 'あ', 'ア']) {
      for (const latin of ['bug', 'macOS', 'é', '12', '２']) {
        for (const padding of [' ', '  ', '\t', '\u00a0', '\u3000']) {
          expect(LATIN_CJK_SPACE.test(`${latin}${padding}${cjk}`)).toBe(true)
          expect(LATIN_CJK_SPACE.test(`${cjk}${padding}${latin}`)).toBe(true)
        }
        expect(LATIN_CJK_SPACE.test(`${latin}${cjk}`)).toBe(false)
        expect(LATIN_CJK_SPACE.test(`${cjk}${latin}`)).toBe(false)
      }
    }
    expect(LATIN_CJK_SPACE.test('小白\no_o')).toBe(false)
    expect(LATIN_CJK_SPACE.test('シオリ\nT_T')).toBe(false)
    expect(LATIN_CJK_SPACE.test('隐私 › Claude-sama Companion')).toBe(false)
    expect(LATIN_CJK_SPACE.test('运行 /claudesama lang zh')).toBe(false)
    expect(LATIN_CJK_SPACE.test('打开 ~/Library/Application Support')).toBe(false)
  })
  test('Chinese and Japanese card speech has no final full stop', { timeoutMs: 60_000 }, () => {
    for (const lang of ['zh', 'ja'] as const) {
      const { words } = companionRecord({ ...VIEW, lang })
      for (const key of CARD_SPEECH) {
        expect(/[。]$|[–—―⸺⸻]/.test(words[key])).toBe(false)
      }
    }
  })
  test('all twelve languages have their own six reactions, with four to six lines each', { timeoutMs: 60_000 }, () => {
    expect(LANGS.length).toBe(12)
    const wrong: string[] = []
    for (const { code } of LANGS) {
      const { reactions } = companionRecord({ ...VIEW, lang: code })
      if (code !== 'en' && reactions === ENGLISH.reactions) wrong.push(`${code}: reactions fall back to English`)
      expect(Object.keys(reactions).sort()).toEqual([...REACTIONS].sort())
      for (const key of REACTIONS) {
        const lines = reactions[key]
        if (!Array.isArray(lines) || lines.length < 4 || lines.length > 6) wrong.push(`${code}.${key}: needs four to six lines`)
      }
    }
    expect(wrong).toEqual([])
  })

  test('task phrases exist in all twelve languages with only the specified placeholders', { timeoutMs: 60_000 }, () => {
    expect(Object.keys(TASK_WORDS).sort()).toEqual(LANGS.map(({ code }) => code).sort())
    for (const { code } of LANGS) {
      const tasks = TASK_WORDS[code]
      expect(Object.keys(tasks).sort()).toEqual([...TASKS].sort())
      for (const key of TASKS) {
        expect(typeof tasks[key]).toBe('string')
        expect(tasks[key].trim().length).toBeGreaterThan(0)
        const placeholders = tasks[key].match(/\{[^}]+\}/gu) ?? []
        expect(placeholders).toEqual(key === 'reading' || key === 'editing' ? ['{file}'] : key === 'running' ? ['{cmd}'] : key === 'using' ? ['{tool}'] : [])
      }
      if (code !== 'en') expect(tasks.thinking).not.toBe(TASK_WORDS.en.thinking)
    }
  })

  test('Activity placeholders preserve their target and count in every language', { timeoutMs: 60_000 }, () => {
    for (const { code } of LANGS) {
      const { words } = companionRecord({ ...VIEW, lang: code })
      for (const key of ACTIVITY) {
        const placeholders = words[key].match(/\{[^}]+\}/gu) ?? []
        expect(placeholders).toEqual(key === 'placeholder' || key === 'confirmClear' ? ['{project}'] : key === 'badge' ? ['{n}'] : [])
      }
      if (code !== 'en') expect(words.activity).not.toBe(ENGLISH.words.activity)
    }
  })

  test('five-second uncertainty and retry are concise and localized in all twelve languages', { timeoutMs: 60_000 }, () => {
    const expected = ['Not sure it arrived', 'Pas sûr que ce soit arrivé', 'Unklar, ob es angekommen ist', 'पता नहीं पहुँचा या नहीं', 'Belum pasti sampai', 'Non so se è arrivato', '届いたかわからない', '도착했는지 모르겠어', 'Não sei se chegou', 'No sé si llegó', 'No sé si llegó', '不确定送到没有']
    expect(LANGS.map(({ code }) => companionRecord({ ...VIEW, lang: code }).words.unconfirmed)).toEqual(expected)
    for (const { code } of LANGS) {
      const { words } = companionRecord({ ...VIEW, lang: code })
      expect(words.retry.trim().length).toBeGreaterThan(0)
      expect(words.expired.trim().length).toBeGreaterThan(0)
      expect(words.unconfirmed.includes('?')).toBe(false)
      expect(words.unconfirmed.includes('!')).toBe(false)
    }
  })

  test('English, Chinese and Japanese task phrases keep the design table wording', () => {
    expect(TASK_WORDS.en).toEqual({ thinking: 'thinking', reading: 'reading {file}', editing: 'editing {file}', running: 'running {cmd}', searching: 'searching', web: 'searching the web', helper: 'a helper is working', planning: 'planning', using: 'using {tool}', waitingOK: 'waiting for your OK', waitingAnswer: 'waiting for your answer' })
    expect(TASK_WORDS.zh).toEqual({ thinking: '在想', reading: '在读{file}', editing: '在改{file}', running: '在运行{cmd}', searching: '在搜索', web: '在网上查', helper: '助手在干活', planning: '在列计划', using: '在用{tool}', waitingOK: '等你同意', waitingAnswer: '等你回答' })
    expect(TASK_WORDS.ja).toEqual({ thinking: '考え中', reading: '{file}を読んでいる', editing: '{file}を編集中', running: '{cmd}を実行中', searching: '検索中', web: 'ウェブで調べている', helper: '助手が作業中', planning: '計画中', using: '{tool}を使っている', waitingOK: '許可待ち', waitingAnswer: '返事待ち' })
  })

  test('English, Chinese and Japanese Activity words keep the design table wording', { timeoutMs: 60_000 }, () => {
    const expected = {
      en: ['Activity', 'Activity…', 'Nothing yet.', 'ready', 'finished', 'Tell Claude in {project}…', 'Send', 'Sending…', 'Not sure it arrived', 'Retry', 'Timed out', 'Dictate', 'New chat', 'Clear this conversation in {project}?', 'Clear', 'Cancel', 'Close', '{n} new. Opens Activity.', 'Opens Claude.', 'Back to Claude', 'Hide his lines', 'Show his lines'],
      zh: ['活动', '活动...', '还没有动静', '待命', '做完了', '在{project}里跟Claude说...', '发送', '正在发送...', '不确定送到没有', '重试', '超时了', '听写', '新对话', '清空{project}里的这段对话?', '清空', '取消', '关闭', '{n}条新动态,打开活动', '打开Claude', '回到Claude', '不显示台词', '显示台词'],
      ja: ['アクティビティ', 'アクティビティ...', 'まだ何もない', '待機中', '終わった', '{project}でClaudeに伝える...', '送信', '送信中...', '届いたかわからない', '再試行', '時間切れ', '音声入力', '新しいチャット', '{project}の会話を消す?', '消す', 'やめる', '閉じる', '新しいこと{n}件。アクティビティを開く', 'Claudeを開く', 'Claudeに戻る', 'セリフを隠す', 'セリフを出す'],
    }
    for (const lang of ['en', 'zh', 'ja'] as const) {
      const { words } = companionRecord({ ...VIEW, lang })
      expect(ACTIVITY.map(key => words[key])).toEqual(expected[lang])
    }
  })

  test('the short permission card keeps the pane path and drops its old extra instructions', { timeoutMs: 60_000 }, () => {
    expect(ENGLISH.words.offerBody).toBe('Then I can stay right beside it. I only see where it is.')
    expect(ENGLISH.words.waitBody).toBe('Privacy & Security › Accessibility')
    const zh = companionRecord({ ...VIEW, lang: 'zh' }).words
    const ja = companionRecord({ ...VIEW, lang: 'ja' }).words
    expect(zh.offerBody).toBe('这样我就能一直在旁边。我只看它在哪儿')
    expect(zh.waitBody).toBe('隐私与安全性 › 辅助功能')
    expect(ja.offerBody).toBe('そうすれば、ずっとそばにいられる。見るのは場所だけ')
    expect(ja.waitBody).toBe('プライバシーとセキュリティ › アクセシビリティ')
    expect(zh.quit).toBe('退出Claude-sama桌面伙伴')
    expect(ja.quit).toBe('Claude-samaコンパニオンを終了')
    for (const { code } of LANGS) {
      const { words } = companionRecord({ ...VIEW, lang: code })
      expect(words.offerBody.includes('macOS')).toBe(false)
      expect(words.waitBody.includes('Claude-sama Companion')).toBe(false)
    }
  })

  test('kaomoji stand alone on a short second line; emoji and ww stay inline', { timeoutMs: 60_000 }, () => {
    const wrong: string[] = []
    for (const { code } of LANGS) {
      const { reactions } = companionRecord({ ...VIEW, lang: code })
      for (const key of REACTIONS) {
        for (const line of reactions[key] ?? []) {
          for (const problem of reactionLayoutProblems(line)) {
            wrong.push(`${code}.${key}: ${problem} in ${JSON.stringify(line)}`)
          }
        }
      }
    }
    expect(wrong).toEqual([])
  })

  test('the layout check rejects inline faces, padding and oversized second lines', { timeoutMs: 60_000 }, () => {
    for (const face of ['(*´ω`*)', '˘ᵕ˘', '(˘ᵕ˘)', '>_<', 'T_T', '//ω//', '(//ω//)', '@_@', '(>д<)', 'o.o', '(⊙_⊙)', '>~<', 'u_u', '^_^', '(´･ω･`)', 'o_o', ':3', ';_;', '=ω=']) {
      expect(reactionLayoutProblems(`hello\n${face}`)).toEqual([])
      expect(reactionLayoutProblems(`hello${face}`)).toContain('inline kaomoji')
      expect(reactionLayoutProblems(`hello ${face}`)).toContain('inline kaomoji')
    }
    expect(reactionLayoutProblems('hello \n>_<')).toContain('space before line break')
    expect(reactionLayoutProblems('hello\n(********ω********)')).toContain('more than twelve characters after line break')
    expect(reactionLayoutProblems('hello\nwords >_<')).toContain('second line is not a whole kaomoji')
    for (const ending of ['🌸', '🐍', '✨', 'ww']) {
      expect(reactionLayoutProblems(`hello ${ending}`)).toEqual([])
      expect(reactionLayoutProblems(`hello\n${ending}`)).toContain('second line is not a whole kaomoji')
    }
    // A single emoji is one Unicode character even though it takes two UTF-16 units.
    expect(reactionLayoutProblems('hello\n' + '🐱'.repeat(12))).not.toContain('more than twelve characters after line break')
    expect(reactionLayoutProblems('hello\n' + '🐱'.repeat(13))).toContain('more than twelve characters after line break')
  })

  test('reaction endings are distinct characters, without final stops or full-width kaomoji', { timeoutMs: 60_000 }, () => {
    const wrong: string[] = []
    for (const { code } of LANGS) {
      const { reactions } = companionRecord({ ...VIEW, lang: code })
      for (const key of REACTIONS) {
        const endings: string[] = []
        for (const line of reactions[key] ?? []) {
          const text = line.trim()
          if (!text) wrong.push(`${code}.${key}: empty line`)
          if (/[.。．]$/.test(text)) wrong.push(`${code}.${key}: final stop in ${line}`)
          if (/[・〃＞＜]/.test(text)) wrong.push(`${code}.${key}: full-width kaomoji in ${line}`)
          // Count Unicode characters, including emoji variation selectors, not UTF-16 halves.
          endings.push([...text].pop() ?? '')
        }
        if (new Set(endings).size !== endings.length) wrong.push(`${code}.${key}: repeated last character`)
      }
    }
    expect(wrong).toEqual([])
  })

  test('every VoiceOver hint and menu word exists, is filled, and uses its own language', { timeoutMs: 60_000 }, () => {
    const wrong: string[] = []
    for (const { code } of LANGS) {
      const { words } = companionRecord({ ...VIEW, lang: code })
      if (code !== 'en' && words.pat === ENGLISH.words.pat) wrong.push(`${code}: menu falls back to English`)
      for (const key of [...MENU, ...ACTIVITY]) {
        if (typeof words[key] !== 'string' || !words[key].trim()) wrong.push(`${code}.${key}: empty menu word`)
      }
      if (new Set([words.tiny, words.small, words.medium, words.large]).size !== 4) wrong.push(`${code}: size names must differ`)
    }
    expect(wrong).toEqual([])
  })
})
