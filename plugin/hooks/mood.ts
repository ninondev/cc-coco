// Pure parts of the state machine: timings, which frames each mood shows, how a line is picked,
// language and local time. Everything that talks to Claude Code is in register.tsx.

import type { FrameName } from './art'
import { MOTION } from './motion'
import { LINES, OMIKUJI_WEIGHTS } from './lines'
import { WORDS } from './words'
import type { Lang, Mood } from './words'
import type { ClaudesamaView as View } from '../types'

export const TIMING = {
  blinkMin: MOTION.blink.interval.min, blinkMax: MOTION.blink.interval.max, blinkShut: MOTION.blink.shut.median,
  think: MOTION.think.median, work: MOTION.work.median, wild: MOTION.wild.median, wildFor: 2400,
  happy: 3000, wave: 2600, flustered: 2600, errorFlash: 1600, error: 12000, refuse: 20000,
  snake: 3600, say: 14000, slip: 45000,
  sleepAfter: 4 * 60_000, clingyAfter: 150_000,
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
  sleep: 'sleep', wave: 'wave', snake: 'snake', omen: 'happy',
}

// The speaker cue's colour on the terminal: the theme's own accent, except under Claude Code's
// built-in light themes, whose accent is 3.15:1 on white; there the rubric #9E4123 (6.5:1).
export function cueFor(theme: unknown): string {
  return typeof theme === 'string' && theme.startsWith('light') ? '#9E4123' : 'claude'
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
// People ask whether Shiori is a python; she turns her head away (persona).
export const PYTHON = /\bpython\b|パイソン|蟒蛇|파이썬|पायथन/i
export const PRAISE =
  /\b(good job|great job|well done|nice work|you('| a)re (amazing|awesome|the best|a genius)|bravo|bien vu|gut gemacht|super gemacht|ottimo lavoro|ben fatto|buen trabajo|bien hecho|bom trabalho|mandou bem|kerja bagus|mantap)\b|bien joué|très bien fait|做得好|干得好|真棒|太棒了|厉害|すごい|さすが|よくやった|잘했어|잘했네|최고야|शाबाश|बहुत बढ़िया/i
// The phrase he bites his sleeve at, as Claude says it in each language.
export const ABSOLUTELY_RIGHT =
  /absolutely right|tout à fait raison|völlig recht|vollkommen recht|perfettamente ragione|toda la razón|toda (a )?razão|benar sekali|sepenuhnya benar|बिल्कुल सही|완전히 맞|전적으로 맞|おっしゃる通り|おっしゃるとおり|完全正确|您说得对|你说得对/i

export function initialView(): View {
  return {
    mood: 'idle', frame: 'idle-reading', said: null, slip: null, context: null, estimate: false,
    verb: WORDS.en.spinner[0] ?? 'reading', band: 'on', workSize: 'same', voice: 'light', affection: 'warm',
    lang: 'en', pictures: 'cells', colors: 'truecolor', cue: 'claude',
  }
}

// His lines for a key in the view's language; the clingy set replaces a key where it has one.
export function linesFor(view: View, key: string): readonly string[] {
  const own = LINES[view.lang] as Record<string, unknown>
  const clingy = own.clingy as Record<string, readonly string[]> | undefined
  if (view.affection === 'clingy' && clingy?.[key]) return clingy[key]
  const list = own[key] ?? (LINES.en as Record<string, unknown>)[key]
  return Array.isArray(list) ? (list as readonly string[]) : []
}

export function greetingFor(view: View, hour: number): readonly string[] {
  const part = hour >= 5 && hour < 11 ? 'morning' : hour >= 11 && hour < 17 ? 'day' : hour >= 17 && hour < 22 ? 'evening' : 'night'
  return (LINES[view.lang].greeting as Record<string, readonly string[]>)[part] ?? []
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
// (es-ES, es_ES, castellano) is es-ES, any other Spanish es-419; every Portuguese is pt-BR, every
// Chinese is zh (Chinese (Singapore), written in simplified characters). Anything else
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
  ['zh', /chinese|chinois|chinesisch|cinese|chino|chinês|mandarin|cantonese|中文|汉语|漢語|华文|華文|华语|華語|中国語|简体|繁體|중국어|चीनी/],
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
  const code = /^([a-z]{2,3})(?:[-_]([a-z0-9]+))?(?:[.@].*)?$/.exec(text)
  if (code) {
    const [, base = '', region = ''] = code
    if (base === 'es' && region === 'es') return 'es-ES'
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

// ---------------------------------------------------------------- hearing the person's language
//
// The desktop gives a mod no language setting and no locale, so he also listens to the prompts
// the person writes: no model, no request, a few regular expressions. Code, URLs and paths are
// cut out first. A script decides outright when it outweighs the Latin words around it (kana:
// ja; Hangul: ko; Devanagari: hi; Han without kana: zh); Latin prose is scored by small lists of
// function words. Too little evidence, or a thin lead, gives nothing.

export type Heard = { lang: Lang; confidence: number; words: number }
// One prompt this clear and this long is enough; otherwise two prompts in a row must agree.
export const HEARING = { sure: 0.8, long: 10 } as const

const STOP: Record<'en' | 'fr' | 'de' | 'es' | 'it' | 'pt' | 'id', readonly string[]> = {
  en: ['the', 'and', 'is', 'are', 'was', 'were', 'to', 'of', 'in', 'it', 'that', 'this', 'with', 'for', 'you', 'your', 'i', 'my', 'please', 'can', 'could', 'would', 'should', 'what', 'why', 'how', 'not', 'don', 'doesn', 'have', 'has', 'be', 'on', 'from', 'but', 'just', 'there', 'when', 'which', 'an', 'also', 'now', 'we', 'me', 'do', 'does', 'if'],
  fr: ['le', 'la', 'les', 'de', 'des', 'du', 'un', 'une', 'est', 'et', 'je', 'tu', 'vous', 'nous', 'il', 'elle', 'pas', 'ne', 'que', 'qui', 'pour', 'avec', 'dans', 'sur', 'ce', 'cette', 'mon', 'ton', 'mais', 'ou', 'aussi', 'peux', 'faire', 'plaît', 'merci', 'en', 'au', 'aux', 'ça', 'fait', 'ici', 'quoi', 'pourquoi', 'comment', 'si'],
  de: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'ich', 'du', 'sie', 'wir', 'ein', 'eine', 'einen', 'mit', 'für', 'auf', 'den', 'dem', 'zu', 'von', 'bitte', 'auch', 'kannst', 'wie', 'was', 'warum', 'noch', 'aber', 'oder', 'sind', 'wird', 'dass', 'mir', 'mich', 'hier', 'jetzt', 'in', 'im', 'nur', 'mal', 'doch', 'wenn'],
  es: ['el', 'la', 'los', 'las', 'que', 'de', 'y', 'es', 'en', 'un', 'una', 'por', 'para', 'con', 'no', 'se', 'lo', 'del', 'al', 'como', 'pero', 'más', 'esto', 'este', 'esta', 'puedes', 'hacer', 'quiero', 'porque', 'también', 'ahora', 'hay', 'está', 'son', 'mi', 'tu', 'si', 'me', 'qué', 'cómo', 'favor'],
  it: ['il', 'lo', 'la', 'gli', 'le', 'di', 'e', 'è', 'che', 'non', 'per', 'con', 'un', 'una', 'del', 'della', 'nel', 'sono', 'questo', 'questa', 'come', 'ma', 'anche', 'ho', 'hai', 'puoi', 'fare', 'voglio', 'perché', 'cosa', 'mi', 'ti', 'ci', 'se', 'più', 'già', 'ora', 'adesso', 'in', 'da', 'al'],
  pt: ['o', 'a', 'os', 'as', 'de', 'do', 'da', 'dos', 'das', 'e', 'é', 'que', 'não', 'um', 'uma', 'para', 'com', 'em', 'no', 'na', 'por', 'se', 'mais', 'isso', 'isto', 'este', 'esta', 'você', 'eu', 'meu', 'minha', 'mas', 'também', 'pode', 'fazer', 'quero', 'porque', 'agora', 'está', 'são', 'tem', 'pra', 'ao'],
  id: ['yang', 'dan', 'di', 'ke', 'dari', 'ini', 'itu', 'untuk', 'dengan', 'tidak', 'nggak', 'gak', 'ada', 'saya', 'aku', 'kamu', 'bisa', 'tolong', 'mau', 'sudah', 'belum', 'akan', 'juga', 'karena', 'kalau', 'apa', 'bagaimana', 'gimana', 'jadi', 'lagi', 'harus', 'buat', 'pakai', 'sama', 'atau', 'tapi', 'ya', 'dong', 'deh', 'coba', 'biar', 'supaya'],
}
const STOP_SETS = Object.entries(STOP).map(([lang, words]) => [lang, new Set(words)] as const)
// Spanish written in Spain: vosotros forms, the pronoun os, and a few words Latin America does not use.
const SPAIN = /\b(vosotr[oa]s|vuestr[oa]s?|os|habéis|tenéis|sois|estáis|podéis|queréis|hacéis|sabéis|vale|ordenador|ordenadores|móvil|coger|guay|vaya|tío)\b/u

function prose(text: string): string {
  return text
    .replace(/```[\s\S]*?(```|$)/g, ' ') // fenced code, closed or not
    .replace(/`[^`\n]*`/g, ' ') // inline code
    .replace(/\b(https?|ftp|file):\/\/\S+|\bwww\.\S+/gi, ' ') // URLs
    .replace(/\S*[\\/]\S*/g, ' ') // paths, and anything else with a slash in it
    .replace(/\S*[A-Za-z]\.[A-Za-z]\S*/g, ' ') // file names, dotted names
    .replace(/\S*(_|\d|[a-z][A-Z]|[<>{}()[\]=;$#@|])\S*/g, ' ') // identifiers and code-ish tokens
}

export function detectLanguage(text: string): Heard | undefined {
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
    return { lang, confidence: Math.min(1, weight / (weight + words / 2)), words: Math.ceil(weight) }
  }
  // Latin prose: hits of each language's function words; the lead must be clear.
  const parts = latin.flatMap(w => w.split(/['’]/))
  const scores = STOP_SETS.map(([name, set]) => [name, parts.filter(w => set.has(w)).length] as const)
  scores.sort((a, b) => b[1] - a[1])
  const [best = 'en', top = 0] = scores[0] ?? []
  const second = scores[1]?.[1] ?? 0
  if (words < 3 || top < 2 || top < second * 1.5 + 1) return undefined
  const confidence = Math.min(1, ((top - second) / top) * Math.min(1, top / 4))
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

export function rollRank(random: number): string {
  const ranks = Object.entries(OMIKUJI_WEIGHTS)
  let roll = random * ranks.reduce((sum, [, weight]) => sum + weight, 0)
  for (const [name, weight] of ranks) {
    roll -= weight
    if (roll < 0) return name
  }
  return ranks[ranks.length - 1]?.[0] ?? 'kichi'
}

// A fortune line opens with its rank ("great blessing." / "上上签。" / "大吉。" / "대박."); the slip
// picture writes that rank top to bottom when it is one to three Han or Hangul characters (Korean
// signs and banners stack short Hangul words this way), and stays blank otherwise.
export function slipLabel(line: string): string {
  const rank = line.split(/[。.]/, 1)[0]?.trim() ?? ''
  return /^[\u3400-\u9fff\uac00-\ud7a3]{1,3}$/.test(rank) ? rank : ''
}

export function fortunesFor(lang: Lang): Record<string, readonly string[]> {
  const all = LINES.omikuji as unknown as Record<string, Record<string, readonly string[]>>
  return all[lang] ?? all.en ?? {}
}
