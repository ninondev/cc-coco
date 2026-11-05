// Package E, part 1: the character table and the one name for each language (zcode/notes/e-character-table.md).
// Names for coco, dake, maid and fish in all thirteen languages, and the table's rules. Where the names are read (the
// pet, the long-task title, the DM notice) is e-character-names.test.tsx.
import { describe, expect, test } from 'claude-code/testing'
import { character, characterForm, characters, installCharacters, nameFor, resetCharacters } from '../hooks/characters'
import { claudieName } from '../hooks/mod-gaps-words'
import { normalizeLegacySettings } from '../hooks/reminder-settings'
import { LANGS } from '../hooks/words'


const LANG13 = ['zh', 'zh-Hant', 'en', 'ja', 'fr', 'it', 'de', 'es-ES', 'es-419', 'pt-BR', 'hi', 'id', 'ko']

// What the pet said for Coco before the table (companion.ts, 10-29 and earlier): the table keeps it for coco.
const OLD_PET_NAME = (lang: string): string => lang === 'zh' ? '小克' : lang === 'ja' ? 'Coco' : lang === 'ko' ? '코코' : 'Coco'

describe('the names', () => {
  test('dake, maid and fish read the right name in zh, zh-Hant, ja, ko and en', () => {
    const want: Record<string, Record<string, string>> = {
      coco: { zh: '小克', 'zh-Hant': 'Coco', ja: 'Coco', ko: '코코', en: 'Coco' }, // zh-Hant stays what the pet always said
      dake: { zh: '大克', 'zh-Hant': '大克', ja: 'Claudeさま', ko: '클로디', en: 'Claudie' },
      maid: { zh: '大克', 'zh-Hant': '大克', ja: 'Claudeさま', ko: '클로디', en: 'Claudie' },
      fish: { zh: '大肥鱼', 'zh-Hant': '大肥魚', ja: 'DeepSeek-chan', ko: 'DeepSeek-chan', en: 'DeepSeek-chan' },
    }
    for (const [form, names] of Object.entries(want)) for (const [lang, name] of Object.entries(names)) expect(nameFor(form, lang), `${form} ${lang}`).toBe(name)
  })
  test('fish is DeepSeek-chan in every language but the two Chinese ones, and is never Claudie, Fatfish or fish', () => {
    for (const lang of LANG13) {
      const name = nameFor('fish', lang)
      expect(name).toBe(lang === 'zh' ? '大肥鱼' : lang === 'zh-Hant' ? '大肥魚' : 'DeepSeek-chan')
      expect(name).not.toBe(claudieName(lang))
      expect(/fatfish|^fish$/i.test(name)).toBe(false)
    }
  })
  test('every row reads in all thirteen languages, and no code name is ever shown', () => {
    expect(LANGS.map(language => language.code)).toEqual(expect.arrayContaining(LANG13))
    for (const each of characters()) for (const lang of LANG13) {
      const name = nameFor(each.id, lang)
      expect(name.trim(), `${each.id} ${lang}`).not.toBe('')
      expect(/fatfish/i.test(name)).toBe(false)
    }
  })
  test('Claudie keeps the names the DM notice used before the table, in all thirteen languages', () => {
    for (const lang of LANG13) { expect(nameFor('dake', lang)).toBe(claudieName(lang)); expect(nameFor('maid', lang)).toBe(claudieName(lang)) }
  })
  test('Coco keeps what the pet said before the table; an unknown or empty form reads as Coco', () => {
    for (const lang of LANG13) expect(nameFor('coco', lang)).toBe(OLD_PET_NAME(lang))
    for (const form of [undefined, null, 'nobody', 42, '']) expect(nameFor(form, 'zh')).toBe('小克')
  })
  test('a language the row does not list takes the row default', () => {
    expect(nameFor('fish', 'xx')).toBe('DeepSeek-chan')
    expect(nameFor('dake', 'xx')).toBe('Claudie')
  })
})

describe('the table', () => {
  test('the shipped rows, in order, with fish on DeepSeek and the Claude characters on Anthropic', () => {
    expect(characters().map(each => each.id)).toEqual(['coco', 'dake', 'maid', 'fish'])
    expect(character('fish')?.chat.provider).toBe('deepseek')
    expect(character('fish')?.persona).toBe('deepseek')
    for (const id of ['coco', 'dake', 'maid']) expect(character(id)?.chat.provider).toBe('anthropic')
    expect(character('dake')?.desktop).toEqual({ folder: 'claudie/dake', cells: 16, placeholder: false })
    expect(characters().every(each => each.peek === null)).toBe(true)
  })
  test('only a stored choice names a character: characterForm', () => {
    expect(characterForm('fish')).toBe('fish')
    expect(characterForm('dake')).toBe('dake')
    expect(characterForm('maid')).toBe('maid')
    for (const value of ['coco', 'deepseek', 'Fish', '', undefined, null, 7, {}]) expect(characterForm(value)).toBeUndefined()
  })
  test('sixteen characters load, and a new one is only data', () => {
    const rows = [...characters().map(each => JSON.parse(JSON.stringify(each)))]
    for (let n = 0; rows.length < 16; n++) rows.push({ ...JSON.parse(JSON.stringify(character('fish'))), id: `partner-${n}`, names: { default: `Partner ${n}`, zh: `伙伴${n}` }, persona: 'gpt', lines: `partner-${n}`, desktop: null })
    expect(installCharacters({ version: 1, characters: rows })).toBe(true)
    expect(characters().length).toBe(16)
    expect(nameFor('partner-3', 'zh')).toBe('伙伴3')
    expect(nameFor('partner-3', 'en')).toBe('Partner 3')
    expect(characterForm('partner-3')).toBe('partner-3')
    resetCharacters()
    expect(characters().length).toBe(4)
  })
  test('a table that breaks a rule changes nothing', () => {
    const good = JSON.parse(JSON.stringify({ version: 1, characters: characters() }))
    const bad = (change: (table: any) => void): unknown => { const copy = JSON.parse(JSON.stringify(good)); change(copy); return copy }
    for (const table of [
      null, 'x', { version: 2, characters: good.characters },
      bad(t => { t.characters.reverse() }),
      bad(t => { t.characters[1].id = 'coco' }),
      bad(t => { t.characters[1].id = 'Dake Two' }),
      bad(t => { t.characters[3].names.default = '' }),
      bad(t => { t.characters[3].desktop = { folder: '../outside', cells: 16, placeholder: false } }),
      bad(t => { t.characters[3].desktop = { folder: 'fish', cells: 15, placeholder: false } }),
      bad(t => { t.characters[3].chat.context = -1 }),
      bad(t => { t.characters[3].peek = '/etc/passwd' }),
      bad(t => { t.characters = [] }),
      bad(t => { while (t.characters.length < 65) t.characters.push({ ...t.characters[3], id: `p${t.characters.length}` }) }),
    ]) { expect(installCharacters(table)).toBe(false); expect(characters().length).toBe(4); expect(nameFor('fish', 'zh')).toBe('大肥鱼') }
  })
  test('the plugin validates the stored form with the same ids the table has', () => {
    for (const each of characters()) expect(normalizeLegacySettings({ claudeForm: each.id }).claudeForm).toBe(each.id)
    expect(normalizeLegacySettings({ claudeForm: 'nobody' }).claudeForm).toBeUndefined()
  })
})

