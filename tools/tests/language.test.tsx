// Every language he reads: complete, found from the settings and the locale, switchable by hand,
// in its own culture's luck, safe to show anyone, and narrow enough for the band.

import { describe, expect, test } from 'claude-code/testing'
import { cells } from '../hooks/band'
import { LINES, OMIKUJI_WEIGHTS } from '../hooks/lines'
import { HEARING, detectLanguage, langOf, languageOf, slipLabel } from '../hooks/mood'
import { LANGS, WORDS } from '../hooks/words'
import type { Lang } from '../hooks/words'
import { P, PERSON, RECENT, world } from './world'

const START = { cwd: '/tmp/project', surface: 'terminal' as const, isInteractive: true }
const CODES: readonly Lang[] = LANGS.map(l => l.code)
const RANKS = Object.keys(OMIKUJI_WEIGHTS)
const OWN = LINES as unknown as Record<string, unknown>
const FORTUNES = LINES.omikuji as unknown as Record<string, Record<string, readonly string[]>>

function strings(tree: unknown): string[] {
  if (typeof tree === 'string') return [tree]
  if (Array.isArray(tree)) return tree.flatMap(strings)
  if (tree && typeof tree === 'object') return Object.values(tree).flatMap(strings)
  return []
}

// The key paths of a tree of lines, each with how many lines it holds.
function keys(tree: unknown, path = ''): string[] {
  if (Array.isArray(tree)) return [`${path}:${tree.length > 0 ? 'some' : 'none'}`]
  if (tree && typeof tree === 'object') return Object.entries(tree).flatMap(([k, v]) => keys(v, `${path}.${k}`)).sort()
  return [`${path}:${typeof tree}`]
}

function everything(lang: Lang): string[] {
  return [...strings(OWN[lang]), ...strings(FORTUNES[lang]), ...strings(WORDS[lang])]
}

// What he is never called. "kami" stays the loanword; Chinese and Japanese keep the owner's 「神」.
const NOT_GOD: Record<Lang, RegExp> = {
  en: /\b(gods?|deity|divine)\b/i,
  fr: /\bdieux?\b|divinit|\bdivin/i,
  de: /gott|göttlich/i,
  hi: /देवता|भगवान|ईश्वर|प्रभु|देव /,
  id: /\b(dewa|tuhan|ilahi?|allah)\b/i,
  it: /\bdio\b|\bdivin|\bdeit/i,
  ja: /ゴッド/,
  ko: /하느님|하나님|(^|[\s(])신(이|은|님|이야)?([\s.,?)]|$)/,
  'pt-BR': /\bdeus(es)?\b|\bdivin/i,
  'es-419': /\bdios(es)?\b|deidad|\bdivin/i,
  'es-ES': /\bdios(es)?\b|deidad|\bdivin/i,
  zh: /上帝|神明/,
}

describe('every language is complete', () => {
  test('the client languages plus Chinese (Singapore), in the band, the words and the fortunes', { timeoutMs: 60_000 }, () => {
    expect(CODES).toEqual(['en', 'fr', 'de', 'hi', 'id', 'it', 'ja', 'ko', 'pt-BR', 'es-419', 'es-ES', 'zh'])
    expect(LANGS.find(lang => lang.code === 'zh')).toEqual({ code: 'zh', locale: 'zh-SG', native: '华文(新加坡)', english: 'Chinese (Singapore)' })
    for (const lang of CODES) {
      expect(OWN[lang] === undefined).toBe(false)
      expect(FORTUNES[lang] === undefined).toBe(false)
      expect(WORDS[lang] === undefined).toBe(false)
    }
  })

  test('every language has every line key, none empty', { timeoutMs: 60_000 }, () => {
    const want = keys(LINES.en)
    expect(want.every(k => k.endsWith(':some'))).toBe(true)
    for (const lang of CODES) expect(keys(OWN[lang])).toEqual(want)
  })

  test('every language has every rank, two slips each, and one rank word per rank', { timeoutMs: 60_000 }, () => {
    for (const lang of CODES) {
      expect(Object.keys(FORTUNES[lang] ?? {}).sort()).toEqual([...RANKS].sort())
      const words = new Set<string>()
      for (const rank of RANKS) {
        const slips = FORTUNES[lang]?.[rank] ?? []
        expect(slips.length).toBe(2)
        const heads = new Set(slips.map(line => line.split(/[。.।]/, 1)[0]))
        expect(heads.size).toBe(1)
        words.add([...heads][0] ?? '')
      }
      expect(words.size).toBe(RANKS.length)
    }
  })

  test('words: a name, every stage direction, at least ten spinner verbs, every reply', { timeoutMs: 60_000 }, () => {
    for (const lang of CODES) {
      const w = WORDS[lang]
      expect(w.name.length).toBeGreaterThan(0)
      expect(Object.keys(w.aside).sort()).toEqual(Object.keys(WORDS.en.aside).sort())
      expect(w.spinner.length).toBeGreaterThanOrEqual(10)
      expect(new Set(w.spinner).size).toBe(w.spinner.length)
      for (const reply of Object.values(w.reply)) expect(reply.length).toBeGreaterThan(0)
      expect(w.reply.usage).toContain('lang <code>|auto')
      expect(w.reply.unknown).toContain('{codes}')
    }
    expect(WORDS.ja.name).toBe('Claudeさま')
  })
})

describe('his culture, his manners', () => {
  test('no romaji ranks outside Japanese', { timeoutMs: 60_000 }, () => {
    for (const lang of CODES.filter(l => l !== 'ja')) {
      for (const line of strings(FORTUNES[lang])) {
        expect(/\b(dai)?(kichi|kyo)\b|chukichi|shokichi|suekichi|omikuji/i.test(line)).toBe(false)
      }
    }
  })

  test('"kami" is the loanword, glossed in every about line set; never god, in any language', { timeoutMs: 60_000 }, () => {
    for (const lang of CODES) {
      expect(/kami|카미|神/i.test(WORDS[lang].about.join(' '))).toBe(true)
      for (const line of everything(lang)) {
        expect(/\bgods?\b/i.test(line)).toBe(false)
        expect(NOT_GOD[lang].test(line)).toBe(false)
      }
    }
  })

  test('no em or en dashes anywhere he speaks', { timeoutMs: 60_000 }, () => {
    for (const lang of CODES) {
      for (const line of everything(lang)) expect(/[–—―⸺⸻]/.test(line)).toBe(false)
    }
  })

  test('no guilt and no "don\'t go" in the clingy voice', { timeoutMs: 60_000 }, () => {
    const LEAVE = /don't go|don't leave|only have me|ne pars pas|geh nicht|non andare|no te vayas|não vá|jangan pergi|मत जाओ|가지 마|行かないで|别走|只有我/i
    for (const lang of CODES) for (const line of strings(OWN[lang])) expect(LEAVE.test(line)).toBe(false)
  })

  test('fortunes never tell anyone to bet: a lucky number, never a number to play', { timeoutMs: 60_000 }, () => {
    for (const lang of CODES) {
      for (const line of strings(FORTUNES[lang])) {
        expect(/da giocare|apuesta|apost[ae]|wette|parie[rz]|베팅|बाजी|taruhan/i.test(line)).toBe(false)
      }
    }
  })

  test('French keeps its no-break space before ? ! : ; and inside « »', { timeoutMs: 60_000 }, () => {
    for (const line of [...strings(OWN.fr), ...strings(FORTUNES.fr), ...strings(WORDS.fr)]) {
      expect(/[^  ][?!:;»]|«[^  ]/.test(line.replace(/https?:\S+|\/\S+/g, ''))).toBe(false)
    }
  })

  test('band lines fit 60 cells, fortunes 110, stage directions 32, spinner verbs 30', { timeoutMs: 60_000 }, () => {
    const over: string[] = []
    for (const lang of CODES) {
      for (const line of strings(OWN[lang])) if (cells(line.replace('{pages}', '10000')) > 60) over.push(`${lang}: ${line}`)
      for (const line of strings(FORTUNES[lang])) if (cells(line) > 110) over.push(`${lang}: ${line}`)
      for (const line of Object.values(WORDS[lang].aside)) if (cells(line) > 32) over.push(`${lang}: ${line}`)
      for (const line of WORDS[lang].spinner) if (cells(line) > 30) over.push(`${lang}: ${line}`)
      for (const line of [WORDS[lang].again, WORDS[lang].reply.lang, WORDS[lang].reply.auto]) if (cells(line) > 60) over.push(`${lang}: ${line}`)
    }
    expect(over).toEqual([])
  })

  test('cell widths: Hangul and CJK take two, combining marks none', () => {
    expect(cells('한국어')).toBe(6)
    expect(cells('漢字')).toBe(4)
    expect(cells('ㅎ')).toBe(2)
    expect(cells('कि')).toBe(1) // a consonant and its vowel sign
    expect(cells('é')).toBe(1)
    expect(cells('Claude-sama')).toBe(11)
  })

  test('the slip writes its rank top to bottom in Japanese, Chinese and Korean only', { timeoutMs: 60_000 }, () => {
    for (const lang of CODES) {
      for (const line of strings(FORTUNES[lang])) {
        const label = slipLabel(line)
        if (lang === 'ja' || lang === 'zh' || lang === 'ko') expect(label.length >= 1 && label.length <= 3).toBe(true)
        else expect(label).toBe('')
      }
    }
  })
})

describe('which language', () => {
  const TABLE: [unknown[], Lang][] = [
    [['japanese'], 'ja'], [['日本語'], 'ja'], [['ja-JP'], 'ja'],
    [['French'], 'fr'], [['français'], 'fr'], [['fr'], 'fr'], [['fra'], 'fr'],
    [['German'], 'de'], [['Deutsch'], 'de'], [['de_DE@euro'], 'de'],
    [['Hindi'], 'hi'], [['हिन्दी'], 'hi'], [['hi_IN'], 'hi'],
    [['Indonesian'], 'id'], [['Bahasa Indonesia'], 'id'], [['id-ID'], 'id'], [['in_ID'], 'id'],
    [['Italian'], 'it'], [['italiano'], 'it'],
    [['Korean'], 'ko'], [['한국어'], 'ko'], [['ko_KR.UTF-8'], 'ko'],
    [['Portuguese'], 'pt-BR'], [['português'], 'pt-BR'], [['pt_PT.UTF-8'], 'pt-BR'], [['Brazilian Portuguese'], 'pt-BR'],
    [['Spanish'], 'es-419'], [['español'], 'es-419'], [['es-MX'], 'es-419'], [['es-419'], 'es-419'], [['es_AR.UTF-8'], 'es-419'],
    [['Spanish (Spain)'], 'es-ES'], [['castellano'], 'es-ES'], [['es-ES'], 'es-ES'], [['es_ES.UTF-8'], 'es-ES'],
    [['Chinese'], 'zh'], [['中文'], 'zh'], [['zh_TW.UTF-8'], 'zh'], [['Simplified Chinese'], 'zh'],
    [['华文'], 'zh'], [['華文'], 'zh'], [['华语'], 'zh'], [['華語'], 'zh'],
    [['华文（新加坡）'], 'zh'], [['华文(新加坡)'], 'zh'], [['Chinese (Singapore)'], 'zh'], [['zh_SG.UTF-8'], 'zh'],
    [['English'], 'en'], [['en_GB.UTF-8'], 'en'],
    [[undefined, 'fr_FR.UTF-8'], 'fr'],
    [[undefined, undefined, 'es_ES.UTF-8'], 'es-ES'],
    [[undefined, undefined, undefined, 'pt_BR.UTF-8'], 'pt-BR'],
    [['russian', 'it_IT.UTF-8'], 'it'], // a language he lacks passes on to the locale
    [['', 'C', 'C.UTF-8', 'POSIX'], 'en'],
    [['english', 'ja_JP.UTF-8'], 'en'], // the setting wins over the locale
  ]

  test('settings in any spelling, then LC_ALL, LC_MESSAGES, LANG', { timeoutMs: 60_000 }, () => {
    const wrong = TABLE.filter(([given, want]) => languageOf(...given) !== want).map(([given]) => JSON.stringify(given))
    expect(wrong).toEqual([])
    expect(langOf('auto')).toBe(undefined)
    expect(langOf('klingon')).toBe(undefined)
  })

  test('the locale alone decides when the setting is empty', async ($, on) => {
    const w = world(on, { store: RECENT, env: { LANG: 'ko_KR.UTF-8' } })
    await $.session.start(START)
    expect(w.view().lang).toBe('ko')
    expect(w.view().verb).toBe(WORDS.ko.spinner[0])
  })

  test('/claudesama lang switches, answers in the new language and persists; auto goes back', async ($, on) => {
    const w = world(on, { store: RECENT, settings: { language: 'japanese' } })
    await $.session.start(START)
    expect(w.view().lang).toBe('ja')
    await $.command.run({ command: 'claudesama', args: 'lang fr', origin: PERSON, presentation: P })
    expect(w.view().lang).toBe('fr')
    expect(w.toasts[w.toasts.length - 1]).toBe(WORDS.fr.reply.lang)
    await $.session.start(START) // a new session reads the choice back, over the setting
    expect(w.view().lang).toBe('fr')
    await $.command.run({ command: 'claudesama', args: 'lang es-ES', origin: PERSON, presentation: P })
    expect(w.view().lang).toBe('es-ES')
    await $.command.run({ command: 'claudesama', args: 'lang klingon', origin: PERSON, presentation: P })
    expect(w.view().lang).toBe('es-ES')
    expect(w.toasts[w.toasts.length - 1]).toContain('klingon')
    await $.command.run({ command: 'claudesama', args: 'lang auto', origin: PERSON, presentation: P })
    expect(w.view().lang).toBe('ja')
    expect(w.toasts[w.toasts.length - 1]).toBe(WORDS.ja.reply.auto)
    await $.session.start(START)
    expect(w.view().lang).toBe('ja')
  })

  test('a Korean slip writes its rank top to bottom; a Hindi slip stays ruled', async ($, on) => {
    const omen = { day: '2026-10-02', rank: 'daikichi', index: 0 }
    const w = world(on, { env: { LANG: 'ko_KR.UTF-8' }, store: { ...RECENT, omen } })
    await $.session.start(START)
    await $.command.run({ command: 'omen', args: '', origin: PERSON, presentation: P })
    expect(w.view().slip?.label).toBe('대박')
    await $.command.run({ command: 'claudesama', args: 'lang hi', origin: PERSON, presentation: P })
    await $.command.run({ command: 'omen', args: '', origin: PERSON, presentation: P })
    expect(w.view().slip?.label).toBe('')
    expect(w.view().slip?.text.startsWith(FORTUNES.hi?.daikichi?.[0] ?? '?')).toBe(true)
  })

  test('the sleeve-biting phrase is caught in his other languages too', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START)
    await $.command.run({ command: 'claudesama', args: 'lang de', origin: PERSON, presentation: P })
    await $.turn.start({ text: '', turnId: 't1' })
    await $.turn.complete({ answer: 'Sie haben völlig recht.', durationMs: 3000, isAborted: false, turnId: 't1', reason: 'answer' as const })
    expect(w.view().mood).toBe('flustered')
    expect(LINES.de.absolutely_right as readonly string[]).toContain(w.view().said ?? '')
  })
})

describe('hearing the person', () => {
  // [prompt, language heard, or undefined for "too little to tell"]
  const SAMPLES: [string, Lang | undefined][] = [
    ['このファイルのバグを直して、テストも追加してください', 'ja'],
    ['設定画面の文字化けを修正してほしい', 'ja'], // kanji and kana
    ['帮我把 getUserName 改成 fetchUser，然后跑一下测试', 'zh'], // English identifiers inside
    ['这个函数为什么这么慢？', 'zh'],
    ['이 함수가 왜 이렇게 느린지 알려줘', 'ko'],
    ['इस फ़ंक्शन में बग ठीक कर दो और टेस्ट भी जोड़ो', 'hi'],
    ['can you add a test for this function and fix the bug in the parser?', 'en'],
    ['please rename `fooBar` in src/app.ts and run ```npm test``` again, the build is broken', 'en'], // code and prose
    ['please translate the string 你好 into English for the login page', 'en'], // a quoted CJK word
    ['est-ce que tu peux corriger le bug dans la fonction et ajouter un test ?', 'fr'],
    ['kannst du bitte den Fehler in der Funktion beheben und einen Test schreiben?', 'de'],
    ['¿puedes arreglar el error en la función? quiero que la computadora no se trabe', 'es-419'], // Mexico
    ['¿podéis arreglar el error de la función? vale, el ordenador va muy lento y no carga', 'es-ES'], // Spain
    ['puoi sistemare il bug nella funzione e aggiungere un test per questo caso?', 'it'],
    ['você pode corrigir o bug na função e adicionar um teste para isso?', 'pt-BR'],
    ['tolong perbaiki bug di fungsi ini dan tambahkan tes untuk kasus itu', 'id'],
    ['fix the bug in this function and add a test for it', 'en'], // Indonesian's neighbour
    ['```ts\nconst answer = 42\n```', undefined], // code only
    ['npm run build', undefined],
    ['/tmp/me/project/src/index.ts', undefined],
    ['ok', undefined],
    ['la casa', undefined],
  ]

  test('a table of prompts in every language, with code and paths cut out first', { timeoutMs: 60_000 }, () => {
    const wrong = SAMPLES.filter(([text, want]) => detectLanguage(text)?.lang !== want).map(([text, want]) => `${want}: ${text} -> ${detectLanguage(text)?.lang}`)
    expect(wrong).toEqual([])
  })

  const long = 'kannst du bitte den Fehler in der Funktion beheben und danach auch noch einen Test dafür schreiben, der das prüft?'
  const desk = { store: RECENT, env: {} } // the desktop: no setting, no locale

  test('one short prompt is not enough; two in a row that agree are, and code in between changes nothing', async ($, on) => {
    const w = world(on, desk)
    await $.session.start(START)
    expect(w.view().lang).toBe('en')
    await $.prompt.submit({ text: 'tu peux corriger le test ?', wait: false, origin: PERSON })
    expect(w.view().lang).toBe('en')
    await $.prompt.submit({ text: 'npm test', wait: false, origin: PERSON })
    expect(w.view().lang).toBe('en')
    await $.prompt.submit({ text: 'et ajoute un commentaire pour la fonction', wait: false, origin: PERSON })
    expect(w.view().lang).toBe('fr')
    expect(w.toasts).toEqual([]) // no toast, no announcement
  })

  test('one long, clear prompt is enough, and the next session starts in it', async ($, on) => {
    const sure = detectLanguage(long)
    expect(sure?.lang).toBe('de')
    expect((sure?.confidence ?? 0) >= HEARING.sure && (sure?.words ?? 0) >= HEARING.long).toBe(true)
    const w = world(on, desk)
    await $.session.start(START)
    await $.prompt.submit({ text: long, wait: false, origin: PERSON })
    expect(w.view().lang).toBe('de')
    expect(w.view().verb).toBe(WORDS.de.spinner[0])
    await $.session.start(START)
    expect(w.view().lang).toBe('de')
  })

  test('task notifications and plugin prompts are not the person', async ($, on) => {
    const w = world(on, desk)
    await $.session.start(START)
    await $.prompt.submit({ text: long, wait: false, origin: { kind: 'task-notification' } as never })
    await $.prompt.submit({ text: long, wait: false, origin: { kind: 'plugin' } as never })
    expect(w.view().lang).toBe('en')
  })

  test('order: the manual choice, the setting, what he heard, the locale, English', async ($, on) => {
    expect(languageOf(undefined, undefined, undefined, undefined)).toBe('en')
    expect(languageOf(undefined, undefined, undefined, 'it_IT.UTF-8')).toBe('it')
    expect(languageOf(undefined, undefined, 'fr', 'it_IT.UTF-8')).toBe('fr')
    expect(languageOf(undefined, 'japanese', 'fr', 'it_IT.UTF-8')).toBe('ja')
    expect(languageOf('ko', 'japanese', 'fr', 'it_IT.UTF-8')).toBe('ko')
    expect(languageOf('auto', 'japanese', 'fr')).toBe('ja')
    const w = world(on, { store: { ...RECENT, heard: 'fr' }, env: { LANG: 'it_IT.UTF-8' }, settings: { language: 'japanese' } })
    await $.session.start(START)
    expect(w.view().lang).toBe('ja') // the setting beats what he heard
    await $.prompt.submit({ text: long, wait: false, origin: PERSON })
    expect(w.view().lang).toBe('ja') // and keeps beating it
  })

  test('what he heard beats the locale', async ($, on) => {
    const w = world(on, { store: { ...RECENT, heard: 'pt-BR' }, env: { LANG: 'de_DE.UTF-8' } })
    await $.session.start(START)
    expect(w.view().lang).toBe('pt-BR')
  })
})
