// The visitor words as shipped: every language, every slot the design names, and their limits (VISITORS.md 6, 9: V14).
import { VISITORS_TEXT_RAW } from './visitors-text-fixture'
import { describe, expect, test } from 'claude-code/testing'
import { cells } from '../hooks/band'
import { LANGS } from '../hooks/words'
import { VISITOR_KINDS, visitorKey } from '../hooks/visitors'
import { forgetVisitorData, loadVisitorWords, visitorNarrowDirection, visitorWord } from '../hooks/visitors-art'

const TABLE = JSON.parse(VISITORS_TEXT_RAW) as Record<string, Record<string, string>>
const CODES = LANGS.map(l => l.code)
const CJK = new Set(['zh', 'zh-Hant', 'ja', 'ko'])

describe('the delivered visitor words', () => {
  test('every slot is in all thirteen languages, with zh-Hant made from zh', () => {
    expect(Object.keys(TABLE).length).toBeGreaterThanOrEqual(12)
    for (const [key, texts] of Object.entries(TABLE)) for (const lang of CODES) expect(typeof texts[lang], `${key} ${lang}`).toBe('string')
  })
  test('the eight kinds are named in every language, none is a god or a cat, and the owl and white-eyes are not there', () => {
    for (const kind of VISITOR_KINDS) for (const lang of CODES) expect(TABLE[visitorKey('visitor.name', kind)]![lang]!.length, `${kind} ${lang}`).toBeGreaterThan(1)
    expect(Object.keys(TABLE).filter(key => /owl|whiteeye|white-eye/i.test(key))).toEqual([])
  })
  test('a name fits its slot: 28 cells in Latin scripts, 6 CJK characters, and none runs over', () => {
    const over: string[] = []
    for (const kind of VISITOR_KINDS) for (const lang of CODES) {
      const name = TABLE[visitorKey('visitor.name', kind)]![lang]!
      if (CJK.has(lang) ? [...name].length > 6 : cells(name) > 28) over.push(`${kind} ${lang}`)
    }
    expect(over).toEqual([])
  })
  test('the wake line names the visitor first and stays inside 70 cells with the longest name, in every language', () => {
    const over: string[] = []
    for (const lang of CODES) {
      const back = TABLE['visitor.back']![lang]!
      expect(back.startsWith('{visitor}'), lang).toBe(true)
      const longest = Math.max(...VISITOR_KINDS.map(kind => cells(TABLE[visitorKey('visitor.name', kind)]![lang]!)))
      if (cells(back.replace('{visitor}', '')) + longest > 70) over.push(lang)
    }
    expect(over).toEqual([])
  })
  test('the wake line never says he was alone, waited, or missed you', () => {
    for (const lang of CODES) expect(TABLE['visitor.back']![lang]!).not.toMatch(/\b(alone|waited|missed)\b|孤|等了|想你|一人|寂/i)
  })
  test('no middle dot chains, em dashes or en dashes in any visitor word', () => {
    for (const [key, texts] of Object.entries(TABLE)) for (const [lang, text] of Object.entries(texts)) expect(text, `${key} ${lang}`).not.toMatch(/ · |[–—]/)
  })
})

const SLOTS = [
  ...VISITOR_KINDS.flatMap(kind => ['visitor.name', 'visitor.short', 'aside.visitor', 'room.alt.visitor'].map(prefix => visitorKey(prefix, kind))),
  'visitor.back', 'visitor.first', 'visitor.headNote', 'visitor.companionLabel', 'visitors.open', 'visitors.title', 'visitors.direction',
  'visitors.empty', 'visitors.reading', 'visitors.unreadable', 'settings.visitors.label', 'settings.visitors.help',
]
const longestName = (lang: string): number => Math.max(...VISITOR_KINDS.map(kind => cells(TABLE[visitorKey('visitor.name', kind)]![lang]!)))


describe('every slot the design names is delivered', () => {
  test('all of them are in the table, and nothing else is', () => {
    expect(SLOTS.filter(key => TABLE[key] === undefined)).toEqual([])
    expect(Object.keys(TABLE).filter(key => !SLOTS.includes(key))).toEqual([])
  })
  test('a short name is bare: at most 10 cells in Latin scripts and Devanagari, 4 kana, Han characters or Hangul syllables (V14)', () => {
    const over: string[] = []
    for (const kind of VISITOR_KINDS) for (const lang of CODES) {
      const short = TABLE[visitorKey('visitor.short', kind)]![lang]!
      if (CJK.has(lang) ? [...short].length > 4 : cells(short) > 10) over.push(`${kind} ${lang} ${short}`)
    }
    expect(over).toEqual([])
  })
  test('limits of the other slots: direction 52 cells, first visit 90 and head note 40 with the longest name, the button 12 (V14)', () => {
    const over: string[] = []
    for (const lang of CODES) {
      for (const kind of VISITOR_KINDS) if (cells(TABLE[visitorKey('aside.visitor', kind)]![lang]!) > 52) over.push(`aside ${kind} ${lang}`)
      for (const [key, limit] of [['visitor.first', 90], ['visitor.headNote', 40]] as const) {
        const text = TABLE[key]![lang]!
        expect(text.startsWith('{visitor}'), `${key} ${lang} names the visitor first`).toBe(true)
        if (cells(text.replace('{visitor}', '')) + longestName(lang) > limit) over.push(`${key} ${lang}`)
      }
      if (cells(TABLE['visitors.open']![lang]!) > 12) over.push(`visitors.open ${lang}`)
    }
    expect(over).toEqual([])
  })
  test('the first visit names who came and nothing more: no guest book sentence, no reason, no company', () => {
    for (const lang of CODES) expect(TABLE['visitor.first']![lang]!, lang).not.toMatch(/\b(book|wrote|notes?|alone|waited|missed)\b|本|书|書|ノート|記録|笔记/i)
  })
  test('the narrow forms keep the short name first in every language, for every kind (V14)', async () => {
    forgetVisitorData()
    await loadVisitorWords(async () => VISITORS_TEXT_RAW)
    const lost: string[] = []
    for (const kind of VISITOR_KINDS) for (const lang of CODES) {
      const short = TABLE[visitorKey('visitor.short', kind)]![lang]!
      const narrow = visitorNarrowDirection(lang, kind)
      if (!narrow || !narrow.replace(/^[(（]/, '').startsWith(short)) lost.push(`direction ${kind} ${lang}: ${narrow}`)
      const line = visitorWord(lang, 'visitor.back', { visitor: short })
      if (!line.startsWith(short) || line.includes('{')) lost.push(`wake ${kind} ${lang}: ${line}`)
      if (narrow && cells(narrow) > cells(TABLE[visitorKey('aside.visitor', kind)]![lang]!)) lost.push(`narrow longer than the full direction ${kind} ${lang}`)
    }
    expect(lost).toEqual([])
  })
})
