// A new session opens in the person's own language before they write a word, in every language he speaks;
// and Claude Code's own settings never travel in his shared record.

import { describe, expect, test } from 'claude-code/testing'
import { macSystemLanguage } from '../hooks/mood'
import { parsePresence, reducePresence } from '../hooks/presence'
import { LANGS, WORDS } from '../hooks/words'
import type { Lang } from '../hooks/words'
import { MORNING, P, PERSON, RECENT, settleLegacyStart, world } from './world'

const START = { cwd: '/tmp/system-language', surface: 'desktop' as const, isInteractive: true }

// __CF_USER_TEXT_ENCODING as macOS writes it at login (user:encoding:region) for each language first in the
// person's list. Region and encoding codes measured on 10-18 with CFLocaleGetLanguageRegionEncodingForLocaleIdentifier
// on each language's own locale; zh-Hans-TW (his Mac) gives the same 0x19:0x34 as zh-Hans-CN.
const MAC: Record<Exclude<Lang, 'id'>, string> = {
  zh: '0x1F6:0x19:0x34', 'zh-Hant': '0x1F6:0x2:0x35', en: '0x1F6:0x0:0x0', ja: '0x1F6:0x1:0xE', ko: '0x1F6:0x3:0x33',
  fr: '0x1F6:0x0:0x1', de: '0x1F6:0x0:0x3', 'es-ES': '0x1F6:0x0:0x8', 'es-419': '0x1F6:0x0:0x56', 'pt-BR': '0x1F6:0x0:0x47',
  it: '0x1F6:0x0:0x4', hi: '0x1F6:0x9:0x21',
}

describe('the Mac system language', () => {
  test('every measured code, the region variants, and what is not a code', () => {
    for (const [lang, code] of Object.entries(MAC)) expect([lang, macSystemLanguage(code)]).toEqual([lang, lang])
    // fr-CA, fr-CH, fr-BE; de-AT, de-CH; it-CH; pt-PT; es-MX shares es-419's 86, es-AR Spain's 8; en-GB, en-AU
    for (const [code, lang] of [['0:0:11', 'fr'], ['0:0:18', 'fr'], ['0:0:98', 'fr'], ['0:0:92', 'de'], ['0:0:19', 'de'], ['0:0:36', 'it'],
      ['0:0:10', 'pt-BR'], ['0:0:86', 'es-419'], ['0:0:8', 'es-ES'], ['0:0:2', 'en'], ['0:0:15', 'en']] as const) expect(macSystemLanguage(code)).toBe(lang)
    // a region he has no table entry for falls back to an encoding that names the script
    expect(macSystemLanguage('0x1F6:0x19:0x7F')).toBe('zh')
    expect(macSystemLanguage('0x1F6:0x0:0x31')).toBe(undefined) // Russia: not one of his languages
    for (const junk of [undefined, '', 'zh', '0x1F6', '0x1F6:zz:yy', 7]) expect(macSystemLanguage(junk)).toBe(undefined)
  })
})

describe('a new desktop session opens in his language', () => {
  expect(LANGS.map(lang => lang.code).sort()).toEqual([...Object.keys(MAC), 'id'].sort())
  for (const [lang, code] of Object.entries(MAC) as [Lang, string][]) {
    test(`${lang}: the system language, before any prompt`, async ($, on) => {
      const w = world(on, { store: RECENT, env: { __CF_USER_TEXT_ENCODING: code } })
      await $.session.start(START); await settleLegacyStart($, w)
      expect(w.view().lang).toBe(lang)
      expect(w.view().verb).toBe(WORDS[lang].spinner[0])
    })
  }
  // Indonesian has no Mac region code: what he heard before decides, kept in the record.
  test('id: what he heard in an earlier session', async ($, on) => {
    const w = world(on, { store: { ...RECENT, heard: 'id' }, env: { __CF_USER_TEXT_ENCODING: '0x1F6:0x0:0x0' } })
    await $.session.start(START); await settleLegacyStart($, w)
    expect(w.view().lang).toBe('id')
    expect(w.view().verb).toBe(WORDS.id.spinner[0])
  })
  test('order: the setting, what he heard, the system; a stored result never beats the system', async ($, on) => {
    const stale = world(on, { store: { ...RECENT, language: 'en' }, env: { __CF_USER_TEXT_ENCODING: MAC.zh } })
    await $.session.start(START); await settleLegacyStart($, stale)
    expect(stale.view().lang).toBe('zh')
  })
  test('what he heard beats the system', async ($, on) => {
    const w = world(on, { store: { ...RECENT, heard: 'fr' }, env: { __CF_USER_TEXT_ENCODING: MAC.zh } })
    await $.session.start(START); await settleLegacyStart($, w)
    expect(w.view().lang).toBe('fr')
  })
  test('Claude Code\'s language setting beats the system', async ($, on) => {
    const w = world(on, { store: RECENT, env: { __CF_USER_TEXT_ENCODING: MAC.zh }, settings: { language: 'japanese' } })
    await $.session.start(START); await settleLegacyStart($, w)
    expect(w.view().lang).toBe('ja')
  })
  test('on the desktop, another session\'s brief (sdk) is not what he writes; the composer is', async ($, on) => {
    // a real brief runs to hundreds of words; his own desktop lines, which also arrive as sdk, are a sentence or two
    const brief = 'Background from the session that started this one: please fix the failing settings test and report what you changed in the record. '.repeat(4)
    const w = world(on, { store: RECENT, env: { __CF_USER_TEXT_ENCODING: MAC.zh } })
    await $.session.start(START); await settleLegacyStart($, w)
    await $.prompt.submit({ text: brief, wait: false, origin: { kind: 'sdk' } as never })
    expect(w.view().lang).toBe('zh')
    await $.prompt.submit({ text: brief, wait: false, origin: { kind: 'composer' } as never })
    expect(w.view().lang).toBe('en')
  })
  test('who stands on the band comes from the record at once', async ($, on) => {
    const w = world(on, { store: { ...RECENT, claudeForm: 'dake' }, env: { __CF_USER_TEXT_ENCODING: MAC.zh } })
    await $.session.start(START); await settleLegacyStart($, w)
    expect((w.view() as { claudie?: string }).claudie).toBe('dake')
  })
})

describe('his shared record carries his settings only', () => {
  const leaked = { env: { SOME_TOKEN: 'secret' }, permissions: { allow: ['Bash'] }, hooks: {}, model: 'opus', enabledPlugins: { 'x@y': true } }
  const sleeping = () => ({ v: 1, seq: 4, quietAt: MORNING - 900_000, asleep: true, clingy: true, busy: false, lang: 'en', claims: {},
    event: { kind: 'sleep', id: `sleep:4:${MORNING - 600_000}`, at: MORNING - 600_000, lang: 'en' } })
  test('a settings patch keeps his keys and a newer version\'s, and drops Claude Code\'s', () => {
    const prior = { ...sleeping(), settings: { ...leaked, claudeForm: 'dake', future: { enabled: true } } }
    const after = (reducePresence as any)(prior, 'settings', 'settings-session', MORNING + 800, false,
      1, 'reader', new Map(), 'owner', 'en', undefined, undefined, undefined, { settings: { socks: 'pink', ...leaked }, at: MORNING })
    expect(after.settings).toEqual({ claudeForm: 'dake', future: { enabled: true }, socks: 'pink' })
    expect(after.settingsEvent?.changes).toEqual({ socks: 'pink' })
  })
  test('a snapshot read from disk loses them too', () => {
    const raw = { ...sleeping(), settings: { ...leaked, band: 'on' }, settingsEvent: { kind: 'settings', id: 'settings:4:1', at: 1, lang: 'en', changes: { ...leaked, band: 'on' } } }
    const parsed = parsePresence(JSON.stringify(raw)) as any
    expect(parsed.settings).toEqual({ band: 'on' })
    expect(parsed.settingsEvent.changes).toEqual({ band: 'on' })
  })
  test('a session never writes Claude Code\'s settings into his record', async ($, on) => {
    const w = world(on, { store: RECENT, observeStore: true, env: { __CF_USER_TEXT_ENCODING: MAC.zh }, settings: { ...leaked, language: 'chinese' } })
    await $.session.start(START); await settleLegacyStart($, w)
    await $.command.run({ command: 'coco', args: 'lang fr', origin: PERSON, presentation: P })
    const record = w.stored('bandSettings') as Record<string, unknown>
    expect(record?.lang).toBe('fr')
    for (const key of Object.keys(leaked)) expect([key, key in record]).toEqual([key, false])
  })
})
