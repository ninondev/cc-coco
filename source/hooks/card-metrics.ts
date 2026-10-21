// The engine has no font measurement dependency: advances were measured offline.
import { METRICS as latin } from './card-metrics-latin'
import { METRICS as latinBold } from './card-metrics-latin-bold'
import { METRICS as zh } from './card-metrics-zh'
import { METRICS as zhBold } from './card-metrics-zh-bold'
import { METRICS as ja } from './card-metrics-ja'
import { METRICS as jaBold } from './card-metrics-ja-bold'
import { METRICS as ko } from './card-metrics-ko'
import { METRICS as koBold } from './card-metrics-ko-bold'
import { METRICS as hi } from './card-metrics-hi'
import { METRICS as hiBold } from './card-metrics-hi-bold'

export type CardScript = 'latin' | 'zh' | 'ja' | 'ko' | 'hi'
export type CardMetrics = { characters: Record<string, number>; pairs: Record<string, number>; exact: Record<string, Record<string, number>>; fallback: number }
const TABLES = { latin: [latin, latinBold], zh: [zh, zhBold], ja: [ja, jaBold], ko: [ko, koBold], hi: [hi, hiBold] } as const
export function cardScript(lang: string): CardScript {
  return lang === 'zh-Hant' ? 'zh' : lang === 'zh' || lang === 'ja' || lang === 'ko' || lang === 'hi' ? lang : 'latin'
}
export function cardWidth(text: string, script: CardScript, size: number, bold = false): number {
  const m = TABLES[script][bold ? 1 : 0], exact = m.exact[String(size)]
  if (exact?.[text] !== undefined) return exact[text]!
  const basic = (s: string): number => {
    const chars = [...s]
    return chars.reduce((sum, ch, i) => sum + (m.characters[ch] ?? m.fallback)
      + (i ? m.pairs[chars[i - 1]! + ch] ?? 0 : 0), 0) * size
  }
  if (!bold && exact && script !== 'zh' && script !== 'ja') {
    const words = text.split(' ')
    let total = 0
    for (let i = 0; i < words.length; i++) {
      const word = words[i]!
      total += exact[word] ?? basic(word)
      if (i) {
        const before = [...words[i - 1]!].at(-1) ?? '', after = [...word][0] ?? ''
        total += ((m.characters[' '] ?? 0) + (m.pairs[before + ' '] ?? 0) + (m.pairs[' ' + after] ?? 0)) * size
      }
    }
    return total
  }
  return basic(text)
}
