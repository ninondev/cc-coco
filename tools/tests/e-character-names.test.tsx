// Package E, part 1: where the name of the character on the band is read. The pet's record and the long-task title
// (companion.ts), the DM notice (register.tsx) and the desktop identity take the table's name for every form; fish is
// never titled Claudie and is never worn unless the person chose her (DECISIONS 1058). The expected names are written
// out here, not read from the table, so the file also runs against code that has no table.
import { installM1Words } from './m1-more-data-fixture'
import { installModelServiceFixture, modelServiceFixtureText } from './m1-model-service-fixture'
import { describe, expect, test } from 'claude-code/testing'
import { companionRecord } from '../hooks/companion'
import { initialView } from '../hooks/mood'
import { normalizeDesktopView } from '../hooks/desktop-safe'
import { world, settleLegacyStart, RECENT } from './world'

installM1Words()
installModelServiceFixture()

const LANG13 = ['zh', 'zh-Hant', 'en', 'ja', 'fr', 'it', 'de', 'es-ES', 'es-419', 'pt-BR', 'hi', 'id', 'ko'] as const
const CLAUDIE: Record<string, string> = { zh: '大克', 'zh-Hant': '大克', en: 'Claudie', ja: 'Claudeさま', fr: 'Claudette', it: 'Claudina', de: 'Claudi', 'es-ES': 'Claudita', 'es-419': 'Claudita', 'pt-BR': 'Claudinha', hi: 'क्लॉडी', id: 'Claudie', ko: '클로디' }
// What the pet has always said for Coco; the table keeps it (zh-Hant and hi say Coco there, unlike the band).
const COCO = (lang: string): string => lang === 'zh' ? '小克' : lang === 'ko' ? '코코' : 'Coco'
const FISH = (lang: string): string => lang === 'zh' ? '大肥鱼' : lang === 'zh-Hant' ? '大肥魚' : 'DeepSeek-chan'
const longTask = { id: 't', startedAt: 1, completedAt: 2, durationMs: 1, mode: 'notify' as const, quiet: false, title: 'x', body: 'y', thread: 'z' }
const view = (extra: Record<string, unknown>) => ({ ...initialView(), longTask, ...extra }) as never

describe('the pet record and the long-task title', () => {
  test('Coco: the name of today in every language, and no new key in the record', () => {
    for (const lang of LANG13) {
      const record = companionRecord(view({ lang }))
      expect(record.name, lang).toBe(COCO(lang))
      expect(record.longTask?.title, lang).toBe(COCO(lang))
    }
    const plain = companionRecord(initialView())
    expect('character' in plain || 'claudie' in plain).toBe(false)
  })
  test('Claudie, gown and maid: her name for the language', () => {
    for (const lang of LANG13) for (const form of ['dake', 'maid'] as const) {
      const record = companionRecord(view({ lang, claudie: form, character: form }))
      expect(record.name, `${form} ${lang}`).toBe(CLAUDIE[lang])
      expect(record.longTask?.title, `${form} ${lang}`).toBe(CLAUDIE[lang])
    }
    expect(companionRecord(view({ lang: 'zh', claudie: 'maid' })).name).toBe('大克')
  })
  test('fish: 大肥鱼, 大肥魚 and DeepSeek-chan, never Claudie', () => {
    for (const lang of LANG13) {
      const record = companionRecord(view({ lang, character: 'fish' }))
      expect(record.name, lang).toBe(FISH(lang))
      expect(record.longTask?.title, lang).toBe(FISH(lang))
      expect(record.name).not.toBe(CLAUDIE[lang])
    }
  })
  test('the same names in zh, zh-Hant, ja, ko and en for dake, maid and fish', () => {
    const want = { dake: ['大克', '大克', 'Claudeさま', '클로디', 'Claudie'], maid: ['大克', '大克', 'Claudeさま', '클로디', 'Claudie'], fish: ['大肥鱼', '大肥魚', 'DeepSeek-chan', 'DeepSeek-chan', 'DeepSeek-chan'] } as const
    for (const [form, names] of Object.entries(want)) ['zh', 'zh-Hant', 'ja', 'ko', 'en'].forEach((lang, i) =>
      expect(companionRecord(view({ lang, character: form, ...(form === 'fish' ? {} : { claudie: form }) })).name, `${form} ${lang}`).toBe(names[i]))
  })
})

describe('the desktop view', () => {
  test('keeps the character through the safe copy, and drops a bad one', () => {
    const frames = ['idle-reading']
    expect((normalizeDesktopView({ ...initialView(), character: 'fish' }, initialView(), frames) as { character?: string }).character).toBe('fish')
    expect((normalizeDesktopView({ ...initialView(), character: 'Fish Two' }, initialView(), frames) as { character?: string }).character).toBeUndefined()
    expect((normalizeDesktopView({ ...initialView() }, { ...initialView(), character: 'fish' } as never, frames) as { character?: string }).character).toBeUndefined()
  })
})

// The whole plugin: a DM at the morning start, under the name of whoever is worn (the same flow as dm.test.tsx).
const START = { cwd: '/tmp/e-characters', surface: 'terminal' as const, isInteractive: true }
function plugin(on: Parameters<typeof world>[0], record: Record<string, unknown>, env: Record<string, string> = {}, model = 'fixture model') {
  on('model.complete', () => ({ value: { isAnswered: true, text: 'fixture reply', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }))
  on('http.fetch', () => ({ deny: 'unexpected fixture network request' }))
  on('agent.list', () => ({ value: [] })); on('session.messages', () => ({ value: [] })); on('session.model', () => ({ value: model })); on('session.repo', () => ({ value: null }))
  on('fs.write', () => ({ value: undefined })); on('process.run', () => ({ value: { exitCode: 0, stdout: '{"ok":true,"result":{},"ensured":true,"claimed":true}', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  const data = JSON.parse(modelServiceFixtureText()) as Record<string, Record<string, string>>
  data['more.model.talk.persona'] = { en: 'fixture talk persona' }
  const more = { talk: true }
  return world(on, { surfaces: ['terminal'], observeStore: true, env: { HOME: '/tmp/e-characters-home', LANG: 'en_US.UTF-8', TERM: 'xterm-256color', ...env }, moreText: JSON.stringify(data),
    store: { ...RECENT, more, 'more.agreed': ['talk'], bandSettings: { voice: 'off', voiceChosen: true, band: 'compact', guard: false, bookmark: false, notes: false, more, ...record } } })
}
async function morning(on: Parameters<typeof world>[0], $: any, record: Record<string, unknown>) {
  const w = plugin(on, record)
  await $.session.start(START); await settleLegacyStart($, w)
  for (let i = 0; i < 4; i++) await w.clock.advance(0)
  return w
}
describe('the DM notice, in the whole plugin', () => {
  test('nothing chosen: the notice is Coco\'s, as before', async ($, on) => {
    const w = await morning(on, $, {})
    expect((w.view() as { character?: string }).character).toBeUndefined()
    expect(w.view().dmNotice?.title).toBe('New message from Coco')
    expect(w.toasts.some(text => text.startsWith('New message from Coco: '))).toBe(true)
  })
  test('fish chosen: titled DeepSeek-chan, never Claudie', async ($, on) => {
    const w = await morning(on, $, { claudeForm: 'fish' })
    expect((w.view() as { character?: string }).character).toBe('fish')
    expect(w.view().dmNotice?.title).toBe('New message from DeepSeek-chan')
    expect(w.toasts.some(text => text.startsWith('New message from DeepSeek-chan: '))).toBe(true)
    expect(w.toasts.some(text => /claudie/i.test(text))).toBe(false)
  })
  test('Claudie chosen: titled with her name, as before', async ($, on) => {
    const w = await morning(on, $, { claudeForm: 'dake' })
    expect((w.view() as { character?: string }).character).toBe('dake')
    expect(w.view().claudie).toBe('dake')
    expect(w.view().dmNotice?.title).toBe('New message from Claudie')
  })
})

describe('never worn by itself', () => {
  test('a session on a DeepSeek base URL, model and key leaves the form Coco and writes no form', async ($, on) => {
    const w = plugin(on, {}, { ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic', ANTHROPIC_MODEL: 'deepseek-flash[1m]', ANTHROPIC_AUTH_TOKEN: 'sk-fake-not-a-key' }, 'deepseek-flash[1m]')
    await $.session.start(START); await settleLegacyStart($, w)
    for (let i = 0; i < 4; i++) await w.clock.advance(0)
    await $.prompt.submit({ text: 'hello', wait: false, origin: { kind: 'composer' } as never })
    for (let i = 0; i < 4; i++) await w.clock.advance(0)
    expect((w.view() as { character?: string }).character).toBeUndefined()
    expect(w.view().claudie).toBeUndefined()
    expect((w.stored('bandSettings') as { claudeForm?: string } | undefined)?.claudeForm).toBeUndefined()
    expect(companionRecord(w.view() as never).name).toBe('Coco')
  })
})
