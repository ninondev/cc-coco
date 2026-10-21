// Pure parts of the state machine: timings, which frames each mood shows, how a line is picked,
// language and local time. Everything that talks to Claude Code is in register.tsx.

import type { FrameName } from './art'
import { MOTION } from './d1-state.js'
import { LINES } from './lines'
import { libraryLines } from './line-library'
import { LANGS, WORDS } from './words'
import { sleepAfter } from './sleep'
import type { Lang, Mood } from './words'
import type { CocoView as View } from '../types'

export const TIMING = {
  blinkMin: MOTION.blink.interval.min, blinkMax: MOTION.blink.interval.max, blinkShut: MOTION.blink.shut.median,
  think: MOTION.think.median, work: MOTION.work.median, wild: MOTION.wild.median, wildFor: 2400,
  happy: 3000, wave: 2600, flustered: 2600, errorFlash: 1600, error: 12000, refuse: 20000,
  snake: 3600, say: 14000,
  sleepAfter, clingyAfter: 150_000,
  thinkingLong: 45_000, done: 45_000, doneLong: 120_000, back: 2 * 3600_000, reload: 2 * 60_000,
  questionGap: 90_000, offeringFull: 85, offeringReset: 60,

} as const

// Two-frame loops; with reduced motion only the first frame shows.
export const LOOPS: Partial<Record<Mood, { frames: readonly [FrameName, FrameName]; every: number }>> = {
  think: { frames: ['think-a', 'think-b'], every: TIMING.think },
  work: { frames: ['work-a', 'work-b'], every: TIMING.work },
  wild: { frames: ['wild-a', 'wild-b'], every: TIMING.wild },
}

export const STILL: Record<Mood, FrameName> = {
  idle: 'idle-reading', think: 'think-a', work: 'work-a', happy: 'happy', waiting: 'waiting',
  question: 'waiting', error: 'error', wild: 'wild-a', refuse: 'refuse', flustered: 'flustered',
  sleep: 'sleep', wave: 'wave', snake: 'snake',
}

// The owner's high-contrast design: ANSI and custom themes keep the host palette.
export function cueFor(theme: unknown): string {
  return theme === 'light' || theme === 'light-daltonized' ? '#9E4123' : 'claude'
}

// 24-bit colour only where the terminal says so: COLORTERM, a terminal known to draw it, and
// not inside tmux unless COLORTERM says so there too. Otherwise (Terminal.app before macOS 26,
// tmux, a bare xterm-256color over ssh) the sprite uses colours from the xterm 256 palette.
export function colorsOf(env: { colorterm: string; term: string; program: string; tmux: boolean; windowsTerminal: boolean }): 'truecolor' | '256' {
  if (/truecolor|24bit/i.test(env.colorterm)) return 'truecolor'
  if (env.tmux) return '256'
  if (/-direct|kitty|ghostty|alacritty|foot|wezterm/i.test(env.term)) return 'truecolor'
  if (/^(iTerm\.app|WezTerm|ghostty|vscode|Hyper|Tabby|rio)$/i.test(env.program) || env.windowsTerminal) return 'truecolor'
  return '256'
}

// Prompts the person wrote (typed, from a phone, or the desktop app), not notifications or plugins.
export const PERSON = new Set(['composer', 'bridge', 'sdk'])
// A test or build run: only these, failing three times in a row, wake the wild soul. A grep that
// finds nothing (exit 1) is not your code being terrible.
export const TEST_RUN =
  /(^|[\s;&|(/])((npm|pnpm|yarn|bun)\s+(run\s+)?(test|build)\b|npx\s+(jest|vitest|tsc)\b|python3?\s+-m\s+pytest\b|pytest\b|cargo\s+(test|build)\b|go\s+(test|build)\b|make\b|gradlew?\b|mvn\b|jest\b|vitest\b|tsc\b|swift\s+(test|build)\b|xcodebuild\b)/
export const FORCE_PUSH = /\bpush\b[^\n|;&]*\s(--force(-with-lease)?|-f)\b/
// Claude starting a plan this turn: a task list or plan mode is where a big job begins (owner 10-14).
export const PLAN_TOOL = /^(TodoWrite|TaskCreate|EnterPlanMode|ExitPlanMode)$/
// A shell that could not find the command it was asked to run (exit 127).
export const NOT_FOUND = /command not found|: not found$|is not recognized as an internal or external command/m

// The line a finished test or build run calls for (owner 10-14). A build that fails is a small slip and a
// failing test is a failed test, both only before the third failure in a row wakes the wild soul; green
// after a red test is fixed; a turn's first test passing is a first-try pass.
export function runMoment(run: { test: boolean; failed: boolean; failures: number; failedBefore: boolean; firstOfTurn: boolean }): 'small_slip' | 'test_fail' | 'fixed' | 'pass_first' | undefined {
  if (run.failed) return run.failures >= 3 ? undefined : run.test ? 'test_fail' : 'small_slip'
  if (!run.test) return undefined
  return run.failedBefore ? 'fixed' : run.firstOfTurn ? 'pass_first' : undefined
}
export const PRAISE =
  /\b(good job|great job|well done|nice work|you('| a)re (amazing|awesome|the best|a genius)|bravo|bien vu|gut gemacht|super gemacht|ottimo lavoro|ben fatto|buen trabajo|bien hecho|bom trabalho|mandou bem|kerja bagus|mantap)\b|bien joué|très bien fait|做得好|干得好|真棒|太棒了|厉害|すごい|さすが|よくやった|잘했어|잘했네|최고야|शाबाश|बहुत बढ़िया/i
// The phrase he bites his sleeve at, as Claude says it in each language.
export const ABSOLUTELY_RIGHT =
  /absolutely right|tout à fait raison|völlig recht|vollkommen recht|perfettamente ragione|toda la razón|toda (a )?razão|benar sekali|sepenuhnya benar|बिल्कुल सही|완전히 맞|전적으로 맞|おっしゃる通り|おっしゃるとおり|完全正确|您说得对|你说得对/i

export function initialView(): View {
  return {
    mood: 'idle', frame: 'idle-reading', said: null, context: null, estimate: false,
    verb: WORDS.en.spinner[0] ?? 'reading', band: 'on', workSize: 'same', voice: 'off', affection: 'warm',
    lang: 'en', pictures: 'cells', colors: 'truecolor', cue: 'claude',
  }
}

// The lines for a key in the view's language, from the line library (line-library.ts): Coco's shipped ones (the clingy
// set replacing a key where it has one) or as the person edited them, mixed with or replaced by a written set; Claudie
// and maid Claudie say only a written set of theirs, and nothing without one.
export function linesFor(view: View, key: string): readonly string[] {
  return libraryLines(view.claudie ?? 'coco', view.lang, key, view.affection === 'clingy')
}

// A shared event always selects the same existing line. Sleep and wake do not
// depend on a band's warmth or its recent local line history.
export function sharedLineFor(view: View, key: 'sleep' | 'wake' | 'idle', event: string): string | null {
  const lines = linesFor(key === 'idle' ? view : { ...view, affection: 'warm' }, key)
  let hash = 2166136261
  for (const char of event) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0
  return lines[hash % lines.length] ?? null
}

// The companion can speak the same event after the last session has closed.
// These are references to the existing lines, with no new words or local history.
type PresenceLines = { sleep: readonly string[]; wake: readonly string[]; idle: readonly string[] }
const presenceLocales: Partial<Record<Lang, PresenceLines>> = {}
function presenceLines(lang: Lang): PresenceLines {
  const cached = presenceLocales[lang]
  if (cached) return cached
  let held: PresenceLines | undefined
  const own = () => {
    const base = { ...initialView(), lang }
    return held ??= { sleep: linesFor(base, 'sleep'), wake: linesFor(base, 'wake'), idle: linesFor({ ...base, affection: 'clingy' }, 'idle') }
  }
  return presenceLocales[lang] ??= { get sleep() { return own().sleep }, get wake() { return own().wake }, get idle() { return own().idle } }
}
export const PRESENCE_LINES = Object.defineProperties({}, Object.fromEntries(
  LANGS.map(({ code }) => [code, { enumerable: true, get: () => presenceLines(code) }]),
)) as Record<Lang, PresenceLines>

// Daytime is lunch (11 to 13) and the afternoon (13 to 17), in every language (owner 10-14).
export function greetingFor(view: View, hour: number): readonly string[] {
  const part = hour >= 5 && hour < 11 ? 'morning' : hour >= 11 && hour < 13 ? 'noon' : hour >= 13 && hour < 17 ? 'afternoon' : hour >= 17 && hour < 22 ? 'evening' : 'night'
  return libraryLines(view.claudie ?? 'coco', view.lang, `greeting.${part}`, false)
}

// A random line, never the one this key showed last time.
const lastPick = new Map<string, string>()
export function pick(key: string, list: readonly string[]): string | undefined {
  if (list.length === 0) return undefined
  const last = lastPick.get(key)
  const choices = list.length > 1 ? list.filter(line => line !== last) : list
  const line = choices[Math.floor(Math.random() * choices.length)] ?? list[0]
  if (line !== undefined) lastPick.set(key, line)
  return line
}

export function fill(line: string | undefined, vars: Record<string, string | number>): string | undefined {
  return line?.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? ''))
}

// One value in any spelling a person or a system gives a language: an ISO code or a locale
// (fr, fr-FR, fr_FR.UTF-8, fra), an English name or the language's own name. Spanish from Spain
// (es-ES, es_ES, castellano) is es-ES, any other Spanish es-419; every Portuguese is pt-BR.
// Chinese scripts follow the setting's script or region. Anything else
// (C, POSIX, auto, Russian) is undefined.
const CODES: Record<string, Lang> = {
  en: 'en', eng: 'en', fr: 'fr', fra: 'fr', fre: 'fr', de: 'de', deu: 'de', ger: 'de', hi: 'hi', hin: 'hi',
  id: 'id', in: 'id', ind: 'id', it: 'it', ita: 'it', ja: 'ja', jpn: 'ja', ko: 'ko', kor: 'ko',
  pt: 'pt-BR', por: 'pt-BR', es: 'es-419', spa: 'es-419', zh: 'zh', zho: 'zh', chi: 'zh',
}
const NAMES: readonly [Lang, RegExp][] = [
  ['es-ES', /(spanish|espa[nñ]ol|spanisch|espagnol|spagnolo|espanhol|スペイン語|西班牙语|스페인어|स्पेनिश).*(spain|españa|espana|spanien|espagne|spagna|espanha)|^castellano|castilian|^español de españa/],
  ['es-419', /spanish|espa[nñ]ol|spanisch|espagnol|spagnolo|espanhol|スペイン語|西班牙语|스페인어|स्पेनिश|latam/],
  ['pt-BR', /portugu|portugiesisch|portoghese|ポルトガル語|葡萄牙语|포르투갈어|पुर्तगाली|brazil|brasil/],
  ['zh-Hant', /traditional\s*chinese|chinese\s*\(traditional\)|cantonese|繁體|繁体|正體|國語|国语|粵語|粤语|廣東話|广东话/],
  ['zh', /chinese|chinois|chinesisch|cinese|chino|chinês|mandarin|中文|汉语|漢語|华文|華文|华语|華語|中国語|简体|중국어|चीनी/],
  ['ja', /japanese|japonais|japanisch|giapponese|japon[eé]s|japonês|日本語|にほんご|일본어|जापानी/],
  ['ko', /korean|coréen|koreanisch|coreano|韓国語|韩语|韓語|한국어|조선말|कोरियाई/],
  ['fr', /french|fran[cç]ais|französisch|francese|franc[eé]s|francês|フランス語|法语|法語|프랑스어|फ़्रेंच|फ्रेंच/],
  ['de', /german|deutsch|allemand|tedesco|alem[aá]n|alemão|ドイツ語|德语|德語|독일어|जर्मन/],
  ['it', /italian|italiano|italien|イタリア語|意大利语|이탈리아어|इतालवी/],
  ['hi', /hindi|हिन्दी|हिंदी|ヒンディー語|印地语|힌디어/],
  ['id', /indonesi|^bahasa$|インドネシア語|印尼语|印度尼西亚语|인도네시아어/],
  ['en', /english|anglais|englisch|inglese|ingl[eé]s|inglês|英語|英语|영어|अंग्रेज़ी|अंग्रेजी|^inggris/],
]

export function langOf(value: unknown): Lang | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim().toLowerCase()
  if (text === '') return undefined
  const code = /^([a-z]{2,3})((?:[-_][a-z0-9]+)*)(?:[.@].*)?$/.exec(text)
  if (code) {
    const [, base = '', subtags = ''] = code
    const parts = subtags.split(/[-_]/).filter(Boolean)
    if (base === 'zh' && (parts.includes('hant') || ['tw', 'hk', 'mo'].includes(parts[0] ?? ''))) return 'zh-Hant'
    if (base === 'es' && parts[0] === 'es') return 'es-ES'
    if (CODES[base]) return CODES[base]
  }
  for (const [lang, name] of NAMES) if (name.test(text)) return lang
  return undefined
}

// Claude Code's own language setting first, then LC_ALL, LC_MESSAGES and LANG; English
// otherwise. A value he cannot read (a language he does not have) passes to the next one.
export function languageOf(...candidates: unknown[]): Lang {
  for (const value of candidates) {
    const lang = langOf(value)
    if (lang) return lang
  }
  return 'en'
}

// The Mac's system language where the desktop app passes no LANG: macOS sets __CF_USER_TEXT_ENCODING
// ("0x1F6:0x19:0x34", user:encoding:region) at login from the first language in the person's list, and
// every process inherits it. The codes were measured with CFLocaleGetLanguageRegionEncodingForLocaleIdentifier
// (10-18): zh-Hans 52 (whatever its region), zh-Hant 53, es-419 and es-MX 86 but es-AR Spain's 8, pt-PT 10.
// Indonesian has no region code at all, so it is left to what he hears.
const MAC_REGIONS: Readonly<Record<number, Lang>> = {
  0: 'en', 2: 'en', 15: 'en', 52: 'zh', 53: 'zh-Hant', 14: 'ja', 51: 'ko', 1: 'fr', 11: 'fr', 18: 'fr', 98: 'fr',
  3: 'de', 19: 'de', 92: 'de', 8: 'es-ES', 86: 'es-419', 71: 'pt-BR', 10: 'pt-BR', 4: 'it', 36: 'it', 33: 'hi',
}
// The encodings that name a script outright, for a region the table does not know.
const MAC_ENCODINGS: Readonly<Record<number, Lang>> = { 25: 'zh', 2: 'zh-Hant', 1: 'ja', 3: 'ko', 9: 'hi' }
export function macSystemLanguage(value: unknown): Lang | undefined {
  if (typeof value !== 'string') return undefined
  const [, encoding, region] = value.trim().split(':').map(part => /^(0x[0-9a-f]+|\d+)$/i.test(part) ? Number(part) : NaN)
  return (region === undefined || Number.isNaN(region) ? undefined : MAC_REGIONS[region])
    ?? (encoding === undefined || Number.isNaN(encoding) ? undefined : MAC_ENCODINGS[encoding])
}

// ---------------------------------------------------------------- hearing the person's language
//
// The desktop gives a mod no language setting and no locale, so he also listens to the prompts
// the person writes: no model, no request, a few regular expressions. Code, URLs and paths are
// cut out first. A script decides outright when it outweighs the Latin words around it (kana:
// ja; Hangul: ko; Devanagari: hi; Han without kana: Chinese); Latin prose is scored by small lists of
// function words. Too little evidence, or a thin lead, gives nothing.

export type Heard = { lang: Lang; confidence: number; words: number }
// One prompt this clear and this long is enough; otherwise two prompts in a row must agree.
// sure: the confidence one prompt needs to switch; brief: the longest desktop prompt heard (characters)
export const HEARING = { sure: 0.7, brief: 400 } as const

let stopSets: ReadonlyArray<readonly [string, Set<string>]> | undefined
function languageSets(): ReadonlyArray<readonly [string, Set<string>]> {
  if (stopSets) return stopSets
  const STOP: Record<'en' | 'fr' | 'de' | 'es' | 'it' | 'pt' | 'id', readonly string[]> = {
    en: ['good', 'great', 'looks', 'like', 'right', 'sure', 'let', 'yes', 'thanks', 'hello', 'where', 'who', 'here', 'very', 'all', 'some', 'will', 'did', 'its', 'they', 'them', 'these', 'those', 'about', 'want', 'need', 'still', 'again', 'something', 'anything', 'the', 'and', 'is', 'are', 'was', 'were', 'to', 'of', 'in', 'it', 'that', 'this', 'with', 'for', 'you', 'your', 'i', 'my', 'please', 'can', 'could', 'would', 'should', 'what', 'why', 'how', 'not', 'don', 'doesn', 'have', 'has', 'be', 'on', 'from', 'but', 'just', 'there', 'when', 'which', 'an', 'also', 'now', 'we', 'me', 'do', 'does', 'if'],
    fr: ['oui', 'très', 'bien', 'où', 'quel', 'quelle', 'tout', 'rien', 'c', 'j', 'ai', 'suis', 'sont', 'peut', 'veux', 'bonjour', 'salut', 'encore', 'toujours', 'sert', 'marche', 'ceci', 'cela', 'le', 'la', 'les', 'de', 'des', 'du', 'un', 'une', 'est', 'et', 'je', 'tu', 'vous', 'nous', 'il', 'elle', 'pas', 'ne', 'que', 'qui', 'pour', 'avec', 'dans', 'sur', 'ce', 'cette', 'mon', 'ton', 'mais', 'ou', 'aussi', 'peux', 'faire', 'plaît', 'merci', 'en', 'au', 'aux', 'ça', 'fait', 'ici', 'quoi', 'pourquoi', 'comment', 'si'],
    de: ['gut', 'aus', 'sieht', 'nochmal', 'langsam', 'dieser', 'diese', 'dieses', 'macht', 'mach', 'kann', 'gibt', 'geht', 'habe', 'hast', 'haben', 'wo', 'wer', 'sehr', 'schon', 'danke', 'ja', 'nein', 'kein', 'keine', 'bin', 'bist', 'soll', 'muss', 'alles', 'etwas', 'immer', 'funktioniert', 'der', 'die', 'das', 'und', 'ist', 'nicht', 'ich', 'du', 'sie', 'wir', 'ein', 'eine', 'einen', 'mit', 'für', 'auf', 'den', 'dem', 'zu', 'von', 'bitte', 'auch', 'kannst', 'wie', 'was', 'warum', 'noch', 'aber', 'oder', 'sind', 'wird', 'dass', 'mir', 'mich', 'hier', 'jetzt', 'in', 'im', 'nur', 'mal', 'doch', 'wenn'],
    es: ['vamos', 'otra', 'vez', 'sirve', 'aquí', 'eso', 'esa', 'ese', 'hola', 'gracias', 'sí', 'muy', 'tengo', 'tiene', 'dónde', 'cuál', 'ya', 'necesito', 'puede', 'hace', 'todo', 'algo', 'nada', 'funciona', 'todavía', 'a', 'el', 'la', 'los', 'las', 'que', 'de', 'y', 'es', 'en', 'un', 'una', 'por', 'para', 'con', 'no', 'se', 'lo', 'del', 'al', 'como', 'pero', 'más', 'esto', 'este', 'esta', 'puedes', 'hacer', 'quiero', 'porque', 'también', 'ahora', 'hay', 'está', 'son', 'mi', 'tu', 'si', 'me', 'qué', 'cómo', 'favor'],
    it: ['i', 'nuovo', 'così', 'serve', 'qui', 'quello', 'quella', 'ciao', 'grazie', 'sì', 'molto', 'dove', 'quale', 'tutto', 'niente', 'qualcosa', 'devo', 'posso', 'funziona', 'ancora', 'sei', 'a', 'il', 'lo', 'la', 'gli', 'le', 'di', 'e', 'è', 'che', 'non', 'per', 'con', 'un', 'una', 'del', 'della', 'nel', 'sono', 'questo', 'questa', 'come', 'ma', 'anche', 'ho', 'hai', 'puoi', 'fare', 'voglio', 'perché', 'cosa', 'mi', 'ti', 'ci', 'se', 'più', 'già', 'ora', 'adesso', 'in', 'da', 'al'],
    pt: ['valeu', 'vou', 'vamos', 'tá', 'né', 'novo', 'tão', 'esse', 'essa', 'aqui', 'olá', 'oi', 'obrigado', 'obrigada', 'sim', 'muito', 'tenho', 'onde', 'qual', 'tudo', 'nada', 'algo', 'preciso', 'faz', 'funciona', 'ainda', 'serve', 'sei', 'o', 'a', 'os', 'as', 'de', 'do', 'da', 'dos', 'das', 'e', 'é', 'que', 'não', 'um', 'uma', 'para', 'com', 'em', 'no', 'na', 'por', 'se', 'mais', 'isso', 'isto', 'este', 'esta', 'você', 'eu', 'meu', 'minha', 'mas', 'também', 'pode', 'fazer', 'quero', 'porque', 'agora', 'está', 'são', 'tem', 'pra', 'ao'],
    id: ['kenapa', 'sekali', 'banget', 'udah', 'makasih', 'kasih', 'sih', 'nih', 'aja', 'kok', 'yang', 'dan', 'di', 'ke', 'dari', 'ini', 'itu', 'untuk', 'dengan', 'tidak', 'nggak', 'gak', 'ada', 'saya', 'aku', 'kamu', 'bisa', 'tolong', 'mau', 'sudah', 'belum', 'akan', 'juga', 'karena', 'kalau', 'apa', 'bagaimana', 'gimana', 'jadi', 'lagi', 'harus', 'buat', 'pakai', 'sama', 'atau', 'tapi', 'ya', 'dong', 'deh', 'coba', 'biar', 'supaya'],
  }
  return stopSets = Object.entries(STOP).map(([lang, words]) => [lang, new Set(words)] as const)
}
// Letters only one of these languages writes.
const LETTERS: ReadonlyArray<readonly [string, RegExp]> = [['de', /[äöüß]/u], ['es', /ñ/u], ['pt', /[ãõ]/u], ['it', /[ìò]/u], ['fr', /[œîïûô]/u]]
// Spanish written in Spain: vosotros forms, the pronoun os, and a few words Latin America does not use.
const SPAIN = /\b(vosotr[oa]s|vuestr[oa]s?|os|habéis|tenéis|sois|estáis|podéis|queréis|hacéis|sabéis|vale|ordenador|ordenadores|móvil|coger|guay|vaya|tío)\b/u

// What he typed, without the notes the host adds around it: the desktop app puts an English
// <system-reminder> before each prompt in a session with linked sessions (10-18), and with it his Chinese was heard as English.
export function typed(text: string): string {
  return text.replace(/<system-reminder>[\s\S]*?(<\/system-reminder>|$)/g, ' ').trim()
}

function prose(text: string): string {
  return typed(text)
    .replace(/```[\s\S]*?(```|$)/g, ' ') // fenced code, closed or not
    .replace(/`[^`\n]*`/g, ' ') // inline code
    .replace(/\b(https?|ftp|file):\/\/\S+|\bwww\.\S+/gi, ' ') // URLs
    .replace(/\S*[\\/]\S*/g, ' ') // paths, and anything else with a slash in it
    .replace(/\S*[A-Za-z]\.[A-Za-z]\S*/g, ' ') // file names, dotted names
    .replace(/\S*(_|\d|[a-z][A-Z]|[<>{}()[\]=;$#@|])\S*/g, ' ') // identifiers and code-ish tokens
}

let chineseSets: Promise<readonly [ReadonlySet<string>, ReadonlySet<string>]> | undefined
async function chineseLanguage(text: string, candidates: readonly unknown[], read?: () => Promise<string>): Promise<'zh' | 'zh-Hant'> {
  if (read) {
    chineseSets ??= Promise.resolve().then(read).then(text => {
      const data: unknown = JSON.parse(text)
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid Chinese script data')
      const { TRADITIONAL_ONLY, SIMPLIFIED_ONLY } = data as Record<string, unknown>
      if (typeof TRADITIONAL_ONLY !== 'string' || typeof SIMPLIFIED_ONLY !== 'string') throw new Error('Invalid Chinese script data')
      return [new Set(TRADITIONAL_ONLY), new Set(SIMPLIFIED_ONLY)] as const
    }).catch(error => { chineseSets = undefined; throw error })
  }
  if (chineseSets) {
    const sets = await chineseSets.catch(() => undefined)
    if (sets) {
      const [traditional, simplified] = sets
      let traditionalHits = 0, simplifiedHits = 0
      for (const char of text) {
        if (traditional.has(char)) traditionalHits++
        if (simplified.has(char)) simplifiedHits++
      }
      if (traditionalHits !== simplifiedHits) return traditionalHits > simplifiedHits ? 'zh-Hant' : 'zh'
    }
  }
  for (const candidate of candidates) {
    const fallback = langOf(candidate)
    if (fallback === 'zh' || fallback === 'zh-Hant') return fallback
  }
  return 'zh'
}

export async function detectLanguage(text: string, fallbackCandidates: readonly unknown[] = [], readChinese?: () => Promise<string>): Promise<Heard | undefined> {
  const rest = prose(text)
  const latin = (rest.match(/[\p{Script=Latin}]+(?:['’][\p{Script=Latin}]+)*/gu) ?? []).map(w => w.toLowerCase())
  const kana = (rest.match(/[ぁ-ゟ゠-ヿ]/g) ?? []).length
  const han = (rest.match(/\p{Script=Han}/gu) ?? []).length
  const hangul = (rest.match(/\p{Script=Hangul}/gu) ?? []).length
  const devanagari = (rest.match(/[ऀ-ॿ]+/g) ?? []).length // words
  const words = latin.length
  // A script outweighs the Latin words around it: Han, kana and Hangul count two characters to
  // a word, Devanagari by its words.
  const scripts: [Lang, number][] = [
    ['ja', kana > 0 ? (kana + han) / 2 : 0],
    ['ko', hangul / 2],
    ['hi', devanagari],
    ['zh', kana > 0 ? 0 : han / 2],
  ]
  const [lang, weight] = scripts.reduce((a, b) => (b[1] > a[1] ? b : a))
  if (weight >= 1 && weight >= words / 2) {
    return { lang: lang === 'zh' ? await chineseLanguage(rest, fallbackCandidates, readChinese) : lang, confidence: Math.min(1, weight / (weight + words / 2)), words: Math.ceil(weight) }
  }
  // Latin prose: each language's function words and its own letters. A word several languages share is split among
  // them, so "para" or "was" alone decides nothing and a short line in Spanish or German is heard (owner 10-18:
  // 「打其它语言也要自动切到其它语言」). The lead must be clear.
  const parts = latin.flatMap(w => w.split(/['’]/))
  const sets = languageSets(), votes = new Map(sets.map(([name]) => [name, 0]))
  const vote = (name: string, by: number) => votes.set(name, (votes.get(name) ?? 0) + by)
  for (const part of parts) {
    const owners = sets.filter(([, set]) => set.has(part))
    for (const [name] of owners) vote(name, 1 / owners.length)
    for (const [name, mark] of LETTERS) if (mark.test(part)) vote(name, 1)
  }
  if (/[¿¡]/u.test(rest)) vote('es', 1)
  const scores = [...votes].sort((a, b) => b[1] - a[1])
  const [best = 'en', top = 0] = scores[0] ?? []
  const second = scores[1]?.[1] ?? 0
  if (words < 3 || top < 2 || top < second * 1.5 + 0.5) return undefined
  const confidence = Math.min(1, (top / (top + second)) * Math.min(1, top / 2.5))
  const found: Lang = best === 'es' ? (SPAIN.test(parts.join(' ')) ? 'es-ES' : 'es-419') : best === 'pt' ? 'pt-BR' : (best as Lang)
  return { lang: found, confidence, words }
}

export function localHour(now: number, timeZone: string | undefined): number {
  try {
    const text = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(new Date(now))
    return Number.parseInt(text, 10) % 24
  } catch {
    return new Date(now).getHours()
  }
}

export function localDay(now: number, timeZone: string | undefined): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).format(new Date(now))
  } catch {
    return new Date(now).toISOString().slice(0, 10)
  }
}
