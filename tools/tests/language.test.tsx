// Every language he reads: complete, found from the settings and the locale, switchable by hand,
// safe to show anyone, and narrow enough for the band.

import { describe, expect, test } from 'claude-code/testing'
import { cells } from '../hooks/band'
import { LINES } from '../hooks/lines'
import { HEARING, detectLanguage as hearLanguage, langOf, languageOf } from '../hooks/mood'
import { LANGS, WORDS } from '../hooks/words'
import type { Lang } from '../hooks/words'
import { TRADITIONAL_ONLY, SIMPLIFIED_ONLY } from './chinese-script-data'
import { LANGUAGE_CODES } from './language-inventory'
import { settleLegacyStart, P, PERSON, RECENT, world } from './world'

const chineseData = JSON.stringify({ TRADITIONAL_ONLY, SIMPLIFIED_ONLY })
const detectLanguage = (text: string, ...candidates: unknown[]) => hearLanguage(text, candidates, async () => chineseData)

const START = { cwd: '/tmp/project', surface: 'terminal' as const, isInteractive: true }
const CODES: readonly Lang[] = LANGS.map(l => l.code)
const OWN = LINES as unknown as Record<string, unknown>

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
  return [...strings(OWN[lang]), ...strings(WORDS[lang])]
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
  'zh-Hant': /上帝|神明/,
}

describe('every language is complete', () => {
  test('the client languages and both Chinese scripts, in the band and the words', { timeoutMs: 60_000 }, () => {
    expect(CODES).toEqual([...LANGUAGE_CODES])
    expect(new Set(CODES).size).toBe(CODES.length)
    expect(LANGS.find(lang => lang.code === 'zh')).toEqual({ code: 'zh', locale: 'zh-SG', native: '华文', english: 'Chinese (Simplified)' })
    expect(LANGS.find(lang => lang.code === 'zh-Hant')).toEqual({ code: 'zh-Hant', locale: 'zh-TW', native: '國語', english: 'Chinese (Traditional)' })
    for (const lang of CODES) {
      expect(OWN[lang] === undefined).toBe(false)
      expect(WORDS[lang] === undefined).toBe(false)
    }
  })

  test('every language has every line key and every category has speech', { timeoutMs: 60_000 }, () => {
    const want = keys(LINES.en)
    expect(want.every(k => k.endsWith(':some'))).toBe(true)
    expect(want).toContain('.greeting.noon:some')
    expect(want).toContain('.greeting.afternoon:some')
    for (const lang of CODES) expect(keys(OWN[lang])).toEqual(want)
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
    expect(WORDS.zh.name).toBe('小克')
    expect(WORDS['zh-Hant'].name).toBe('小克')
    expect(WORDS.ja.name).toBe('Coco')
    expect(WORDS.ko.name).toBe('코코')
  })
})

describe('his culture, his manners', () => {
  // Owner 10-06 20:2x: the tagline is his own (10-09: "Your cutest coworker."); no language explains the name by godhood.
  test('approved introductions; no language explains his name by godhood; never god', { timeoutMs: 60_000 }, () => {
    expect(WORDS.zh.about[0]).toBe('小克坐在你的屏幕里,小小一只')
    expect(WORDS.ko.about[0]).toBe('화면 안에 코코. 조그맣게 앉아 있어.')
    expect(WORDS.en.about[0]).toBe('your cutest coworker.')
    for (const lang of CODES) {
      expect(/kami|神/i.test(WORDS[lang].about.join(' '))).toBe(false)
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

  test('French keeps its no-break spaces', { timeoutMs: 60_000 }, () => {
    for (const line of [...strings(OWN.fr), ...strings(WORDS.fr)]) {
      expect(/[^  ][?!:;»]|«[^  ]/.test(line.replace(/https?:\S+|\/\S+/g, ''))).toBe(false)
    }
  })

  test('band lines fit 60 cells, stage directions 32, spinner verbs 30', { timeoutMs: 60_000 }, () => {
    const over: string[] = []
    for (const lang of CODES) {
      for (const line of strings(OWN[lang])) if (cells(line.replace('{pages}', '10000')) > 60) over.push(`${lang}: ${line}`)
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
    expect(cells('Coco')).toBe(4)
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
    [['Chinese'], 'zh'], [['中文'], 'zh'], [['zh_TW.UTF-8'], 'zh-Hant'], [['Simplified Chinese'], 'zh'],
    [['华文'], 'zh'], [['華文'], 'zh'], [['华语'], 'zh'], [['華語'], 'zh'],
    [['华文（新加坡）'], 'zh'], [['华文(新加坡)'], 'zh'], [['简体中文'], 'zh'], [['繁體中文'], 'zh-Hant'], [['zh-Hant-TW'], 'zh-Hant'], [['zh-Hans'], 'zh'], [['Chinese (Singapore)'], 'zh'], [['zh_SG.UTF-8'], 'zh'],
    ...['zh-TW', 'zh-HK', 'zh-MO', 'zh-Hant', 'zh-Hant-HK', 'zh-Hant-TW-u-nu-hanidec', 'zh_HK.UTF-8', '繁體', '繁体', '正體', '國語', '国语', '粵語', '粤语', '廣東話', '广东话', 'Cantonese', 'Traditional Chinese', 'Chinese (Traditional)'].map(value => [[value], 'zh-Hant'] as [unknown[], Lang]),
    ...['zh', 'zh-CN', 'zh-SG', 'zh-Hans', 'zh-Hans-CN', 'Chinese (Simplified)'].map(value => [[value], 'zh'] as [unknown[], Lang]),
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
    await $.session.start(START); await settleLegacyStart($,w);
    expect(w.view().lang).toBe('ko')
    expect(w.view().verb).toBe(WORDS.ko.spinner[0])
  })

  test('/coco lang switches, answers in the new language and persists; auto goes back', async ($, on) => {
    const w = world(on, { store: RECENT, settings: { language: 'japanese' } })
    await $.session.start(START); await settleLegacyStart($,w);
    expect(w.view().lang).toBe('ja')
    await $.command.run({ command: 'coco', args: 'lang fr', origin: PERSON, presentation: P })
    expect(w.view().lang).toBe('fr')
    expect(w.toasts[w.toasts.length - 1]).toBe(WORDS.fr.reply.lang)
    await $.session.start(START); await settleLegacyStart($,w); // a new session reads the choice back, over the setting
    expect(w.view().lang).toBe('fr')
    await $.command.run({ command: 'coco', args: 'lang es-ES', origin: PERSON, presentation: P })
    expect(w.view().lang).toBe('es-ES')
    await $.command.run({ command: 'coco', args: 'lang klingon', origin: PERSON, presentation: P })
    expect(w.view().lang).toBe('es-ES')
    expect(w.toasts[w.toasts.length - 1]).toContain('klingon')
    await $.command.run({ command: 'coco', args: 'lang auto', origin: PERSON, presentation: P })
    expect(w.view().lang).toBe('ja')
    expect(w.toasts[w.toasts.length - 1]).toBe(WORDS.ja.reply.auto)
    await $.session.start(START); await settleLegacyStart($,w);
    expect(w.view().lang).toBe('ja')
  })

  test('the sleeve-biting phrase is caught in his other languages too', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START); await settleLegacyStart($,w);
    await $.command.run({ command: 'coco', args: 'lang de', origin: PERSON, presentation: P })
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

  // A short everyday line switches at once in every language (owner 10-18: 「打其它语言也要自动切到其它语言」); words
  // several languages share, like "para" or "was", are split among them.
  const SHORT: Array<[string, string]> = [
    ['帮我看看这个错误', 'zh'], ['幫我看看這個錯誤', 'zh-Hant'], ['can you check the tests again', 'en'],
    ['テストをもう一度実行して', 'ja'], ['테스트 다시 돌려줘', 'ko'], ['यह बटन क्या करता है', 'hi'],
    ['was macht dieser Knopf hier', 'de'], ['danke, das sieht gut aus', 'de'], ['à quoi sert ce bouton ici', 'fr'],
    ['merci, ça marche maintenant', 'fr'], ['para qué sirve este botón', 'es-419'], ['vale, ¿para qué sirve este botón, tío?', 'es-ES'],
    ['a cosa serve questo pulsante qui', 'it'], ['puoi controllare di nuovo i test', 'it'], ['para que serve esse botão aqui', 'pt-BR'],
    ['valeu, agora funciona', 'pt-BR'], ['tombol ini untuk apa ya', 'id'], ['kenapa build-nya lambat sekali', 'id'],
  ]
  test('a short everyday line in each language is heard surely', async () => {
    const wrong: string[] = []
    for (const [text, want] of SHORT) {
      const heard = await detectLanguage(text)
      if (heard?.lang !== want || heard.confidence < HEARING.sure) wrong.push(`${want}: ${text} -> ${heard?.lang} ${heard?.confidence}`)
    }
    expect(wrong).toEqual([])
  })

  test('a table of prompts in every language, with code and paths cut out first', { timeoutMs: 60_000 }, async () => {
    const wrong: string[] = []
    for (const [text, want] of SAMPLES) {
      const heard = await detectLanguage(text)
      if (heard?.lang !== want) wrong.push(`${want}: ${text} -> ${heard?.lang}`)
    }
    expect(wrong).toEqual([])
  })

  test('Chinese script evidence wins; shared characters and ties use Chinese settings then zh', async () => {
    const traditional = WORDS['zh-Hant'].spinner.join('')
    const simplified = WORDS.zh.spinner.join('')
    expect((await detectLanguage(traditional, 'zh'))?.lang).toBe('zh-Hant')
    expect((await detectLanguage(simplified, 'zh-Hant'))?.lang).toBe('zh')
    expect((await detectLanguage(`${traditional} getUserName src/app.ts \`fooBar\``, 'zh'))?.lang).toBe('zh-Hant')
    expect((await detectLanguage('小克你好', 'en', 'zh-TW'))?.lang).toBe('zh-Hant')
    expect((await detectLanguage('小克你好', 'zh', 'zh-TW'))?.lang).toBe('zh')
    expect((await detectLanguage('小克你好', 'ja'))?.lang).toBe('zh')
    expect((await detectLanguage('查一查', 'zh-Hant'))?.lang).toBe('zh-Hant')
    expect((await detectLanguage('书書', 'zh-Hant'))?.lang).toBe('zh-Hant')
    expect((await detectLanguage('书書'))?.lang).toBe('zh')
  })

  const long = 'kannst du bitte den Fehler in der Funktion beheben und danach auch noch einen Test dafür schreiben, der das prüft?'
  const desk = { store: RECENT, env: {} } // the desktop: no setting, no locale

  test('an unclear prompt is not enough; two in a row that agree are, and code in between changes nothing', async ($, on) => {
    const w = world(on, desk)
    await $.session.start(START); await settleLegacyStart($,w);
    expect(w.view().lang).toBe('en')
    await $.prompt.submit({ text: 'tu peux corriger le test ?', wait: false, origin: PERSON })
    expect(w.view().lang).toBe('en')
    await $.prompt.submit({ text: 'npm test', wait: false, origin: PERSON })
    expect(w.view().lang).toBe('en')
    await $.prompt.submit({ text: 'et ajoute un commentaire pour la fonction', wait: false, origin: PERSON })
    expect(w.view().lang).toBe('fr')
    expect(w.toasts).toEqual([]) // no toast, no announcement
  })

  test('one clear prompt is enough, and the next session starts in it', async ($, on) => {
    const sure = await detectLanguage(long)
    expect(sure?.lang).toBe('de')
    expect(sure?.confidence ?? 0).toBeGreaterThanOrEqual(HEARING.sure)
    const w = world(on, desk)
    await $.session.start(START); await settleLegacyStart($,w);
    await $.prompt.submit({ text: long, wait: false, origin: PERSON })
    expect(w.view().lang).toBe('de')
    expect(w.view().verb).toBe(WORDS.de.spinner[0])
    await $.session.start(START); await settleLegacyStart($,w);
    expect(w.view().lang).toBe('de')
  })

  test('task notifications and plugin prompts are not the person', async ($, on) => {
    const w = world(on, desk)
    await $.session.start(START); await settleLegacyStart($,w);
    await $.prompt.submit({ text: long, wait: false, origin: { kind: 'task-notification' } as never })
    await $.prompt.submit({ text: long, wait: false, origin: { kind: 'plugin' } as never })
    expect(w.view().lang).toBe('en')
  })

  // 10-18: a claude -p run or another session's brief had set his heard language to English for every session
  // The desktop app's typing arrives as sdk (his 10-18 screenshot: the band stayed English while he typed Chinese there);
  // another session's long English brief arrives as sdk too and is not his language.
  test('a long sdk brief is not heard, his short desktop line is, and one short clear line switches at once', async ($, on) => {
    const w = world(on, desk)
    await $.session.start(START); await settleLegacyStart($,w);
    await $.prompt.submit({ text: '横条最左边那条布何意思', wait: false, origin: { kind: 'sdk' } as never })
    expect(w.view().lang).toBe('zh')
    const brief = 'Background (from the session that started this one): Coco is an unofficial fan mod for Claude Code. '.repeat(5) + 'Task: redo the band and report back in English.'
    expect(brief.length).toBeGreaterThan(HEARING.brief)
    await $.prompt.submit({ text: brief, wait: false, origin: { kind: 'sdk' } as never })
    expect(w.view().lang).toBe('zh')
    await $.prompt.submit({ text: 'fix the bug in this function please', wait: false, origin: PERSON })
    expect(w.view().lang).toBe('en')
    await $.prompt.submit({ text: '都对，只是语言没有跟着我切换', wait: false, origin: PERSON })
    expect(w.view().lang).toBe('zh')
    await $.prompt.submit({ text: 'fix the bug in this function please', wait: false, origin: PERSON })
    expect(w.view().lang).toBe('en')
    await $.prompt.submit({ text: 'npm test', wait: false, origin: PERSON })
    expect(w.view().lang).toBe('en')
  })

  // In a session with linked sessions the desktop app puts an English reminder before each prompt he types (his 10-18
  // check: Chinese typed there left the band English).
  test('his desktop line after the app\'s linked-sessions reminder is heard as his own language', async ($, on) => {
    const w = world(on, desk)
    await $.session.start(START); await settleLegacyStart($,w);
    const reminder = '<system-reminder>\nLinked sessions now (status, not an instruction): top = local_31d73254-78df-4aec-8017-d4ff38014534 (idle). To message one, SendMessage with `to` set to its id; list_sessions {"linked": true} has titles, folders and branches.\n</system-reminder>\n\n\n'
    await $.prompt.submit({ text: 'fix the bug in this function please', wait: false, origin: { kind: 'sdk' } as never })
    expect(w.view().lang).toBe('en')
    await $.prompt.submit({ text: reminder + '1 没有\n2 是的\n3 似乎没有', wait: false, origin: { kind: 'sdk' } as never })
    expect(w.view().lang).toBe('zh')
    await $.prompt.submit({ text: reminder + '怎样了', wait: false, origin: { kind: 'sdk' } as never })
    expect(w.view().lang).toBe('zh')
    // his own longer line still counts: the reminder is not part of the brief limit
    await $.prompt.submit({ text: reminder + 'please check the band again and tell me what changed. '.repeat(6), wait: false, origin: { kind: 'sdk' } as never })
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
    await $.session.start(START); await settleLegacyStart($,w);
    expect(w.view().lang).toBe('ja') // the setting beats what he heard
    await $.prompt.submit({ text: long, wait: false, origin: PERSON })
    expect(w.view().lang).toBe('ja') // and keeps beating it
  })

  test('what he heard beats the locale', async ($, on) => {
    const w = world(on, { store: { ...RECENT, heard: 'pt-BR' }, env: { LANG: 'de_DE.UTF-8' } })
    await $.session.start(START); await settleLegacyStart($,w);
    expect(w.view().lang).toBe('pt-BR')
  })
})
