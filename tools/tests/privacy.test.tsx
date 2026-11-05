// /coco privacy and /coco models (owner 11-04): the keys, the person's own values, the file, and the list in the book.
import { describe, expect, test } from 'claude-code/testing'
import type { EngineInterface } from 'claude-code'
import { pageBlocks } from '../hooks/book'
import type { BookData } from '../hooks/book'
import type { BookWords } from '../hooks/book-words'
import { uninstallSteps } from '../hooks/coco-commands'
import { initialView } from '../hooks/mood'
import { MODEL_SERVICES, isQuiet, quieted, readPrivacy, restorePrivacy, setPrivacy, unquieted } from '../hooks/privacy'
import { BOOK_FILES } from './book-files'
import { installM1Words } from './m1-more-data-fixture'
import { MORNING } from './world'

installM1Words()
const words = JSON.parse(BOOK_FILES['en.json']!) as BookWords
const FIRST = { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', FORCE_AUTOUPDATE_PLUGINS: '1' }
const SECOND = { CLAUDE_CODE_ATTRIBUTION_HEADER: '0', CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1' }
const ATTRIBUTION = { commit: '', pr: '', sessionUrl: false }
const FILE = '/home/ninon/.claude/settings.json'

function engine(files: Record<string, string>, env: Record<string, string> = { HOME: '/home/ninon' }, model: string | undefined = 'claude-opus-5-5', refuseWrite = false, store: Record<string, unknown> = {}) {
  const writes: string[] = []
  const $ = {
    env: { get: async (name: string) => env[name] },
    fs: {
      exists: async (path: string) => path in files,
      read: async (path: string) => { if (!(path in files)) throw new Error('missing'); return files[path] },
      write: async (path: string, text: string) => { if (refuseWrite) throw new Error('refused'); writes.push(path); files[path] = text },
    },
    session: { model: async () => model },
    store: {
      get: async (key: string) => store[key],
      set: async (key: string, value: unknown) => { store[key] = value },
      delete: async (key: string) => { delete store[key] },
    },
  } as unknown as Pick<EngineInterface, 'env' | 'fs' | 'session' | 'store'>
  return { $, writes, files }
}

describe('the keys', () => {
  test('the first tier is for everybody and the second only for another maker\'s model', () => {
    expect(quieted({}, false)).toEqual({ env: FIRST })
    expect(quieted({}, true)).toEqual({ env: { ...FIRST, ...SECOND }, skipWebFetchPreflight: true, attribution: ATTRIBUTION })
    expect(isQuiet({ env: FIRST }, false)).toBe(true)
    expect(isQuiet({ env: FIRST }, true)).toBe(false)
    expect(isQuiet(quieted({}, true)!, true)).toBe(true)
    expect(isQuiet({}, false)).toBe(false)
  })
  test('a press keeps what already says the same, and puts right what says the opposite', () => {
    const mine = { env: { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 'yes', KEEP: '1' }, attribution: { commit: 'mine' }, skipWebFetchPreflight: false, theme: 'dark' }
    const next = quieted(mine, true)!
    expect((next.env as Record<string, string>).CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe('yes')
    expect(next.attribution).toEqual({ commit: 'mine' })
    expect(next.skipWebFetchPreflight).toBe(true)
    expect(isQuiet(next, true)).toBe(true)
    expect(isQuiet({ env: { ...FIRST, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '0' } }, false)).toBe(false)
    expect(isQuiet({ env: { ...FIRST, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: ' TRUE ' } }, false)).toBe(true)
    expect(isQuiet(quieted({ env: { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '0' } }, false)!, false)).toBe(true)
    expect(unquieted({ env: { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 'true', KEEP: '1' } })).toEqual({ env: { KEEP: '1' } })
  })
  test('there and back leaves the file as it was', () => {
    for (const start of [{}, { theme: 'dark' }, { env: { KEEP: '1' } }]) for (const other of [false, true]) expect(unquieted(quieted(start, other)!)).toEqual(start)
  })
  test('an env that is not an object is refused rather than replaced', () => {
    expect(quieted({ env: 'x' }, false)).toBeUndefined()
  })
  test('the website check key stays on someone else\'s service, and also undoes the installer\'s keys otherwise', () => {
    const base = 'https://api.deepseek.com/anthropic'
    expect(unquieted({ env: { ANTHROPIC_BASE_URL: base, ...FIRST, ...SECOND }, skipWebFetchPreflight: true, attribution: ATTRIBUTION })).toEqual({ env: { ANTHROPIC_BASE_URL: base }, skipWebFetchPreflight: true })
    expect(unquieted({ env: FIRST, skipWebFetchPreflight: true })).toEqual({})
  })
})

describe('the file', () => {
  test('nothing is written by reading, and a missing file reads as nothing set', async () => {
    const e = engine({})
    expect(await readPrivacy(e.$)).toEqual({ quiet: false, other: false })
    expect(e.writes).toEqual([])
  })
  test('turning it off writes to the person\'s settings.json and keeps the rest', async () => {
    const e = engine({ [FILE]: '﻿{"theme":"dark"}' })
    expect(await setPrivacy(e.$, true)).toBe(true)
    expect(e.writes).toEqual([FILE])
    expect(JSON.parse(e.files[FILE]!)).toEqual({ theme: 'dark', env: FIRST })
    expect(await readPrivacy(e.$)).toEqual({ quiet: true, other: false })
    expect(await setPrivacy(e.$, false)).toBe(true)
    expect(JSON.parse(e.files[FILE]!)).toEqual({ theme: 'dark' })
  })
  test('CLAUDE_CONFIG_DIR names the folder when it is set', async () => {
    const e = engine({}, { HOME: '/home/ninon', CLAUDE_CONFIG_DIR: '/tmp/fresh' })
    await setPrivacy(e.$, true)
    expect(e.writes).toEqual(['/tmp/fresh/settings.json'])
  })
  test('a file that does not parse is left alone', async () => {
    const e = engine({ [FILE]: '{"theme":' }, undefined, undefined, false, { privacyAdded: ['FORCE_AUTOUPDATE_PLUGINS'] })
    expect(await readPrivacy(e.$)).toBeUndefined()
    expect(await setPrivacy(e.$, true)).toBe(false)
    expect(await restorePrivacy(e.$)).toBe('failed')
    expect(e.writes).toEqual([])
  })
  test('a refused write says so', async () => {
    expect(await setPrivacy(engine({}, undefined, undefined, true).$, true)).toBe(false)
  })
  test('another maker\'s model on another service gets the second tier; Claude on either does not', async () => {
    const base = 'https://api.deepseek.com/anthropic'
    const other = engine({ [FILE]: JSON.stringify({ env: { ANTHROPIC_BASE_URL: base } }) }, undefined, 'deepseek-flash')
    expect((await readPrivacy(other.$))?.other).toBe(true)
    await setPrivacy(other.$, true)
    expect(JSON.parse(other.files[FILE]!).attribution).toEqual(ATTRIBUTION)
    expect((await readPrivacy(engine({}, { HOME: '/home/ninon', ANTHROPIC_BASE_URL: base }, 'deepseek-flash').$))?.other).toBe(true)
    expect((await readPrivacy(engine({ [FILE]: JSON.stringify({ env: { ANTHROPIC_BASE_URL: base } }) }, undefined, 'anthropic/claude-sonnet-4.5').$))?.other).toBe(false)
    expect((await readPrivacy(engine({}, undefined, 'claude-opus-5-5').$))?.other).toBe(false)
  })
  test('a press that changes nothing writes nothing', async () => {
    const e = engine({ [FILE]: JSON.stringify({ env: FIRST }) })
    expect(await setPrivacy(e.$, true)).toBe(true)
    expect(e.writes).toEqual([])
  })
  test('the uninstaller takes back what a press added and nothing else, silent when that is nothing', async () => {
    const mine = { theme: 'dark', env: { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' } }
    const used = engine({ [FILE]: JSON.stringify(mine) })
    await setPrivacy(used.$, true)
    expect(JSON.parse(used.files[FILE]!).env).toEqual(FIRST)
    expect(await restorePrivacy(used.$)).toBe('done')
    expect(JSON.parse(used.files[FILE]!)).toEqual(mine)
    expect(await restorePrivacy(used.$)).toBe('same')
    const clean = engine({ [FILE]: JSON.stringify({ env: FIRST, theme: 'dark' }) })
    expect(await restorePrivacy(clean.$)).toBe('same')
    expect(clean.writes).toEqual([])
    const back = engine({ [FILE]: '{"theme":"dark"}' })
    await setPrivacy(back.$, true)
    await setPrivacy(back.$, false)
    expect(await restorePrivacy(back.$)).toBe('same')
  })
})

describe('the list in the book', () => {
  const base = (extra: Partial<BookData> = {}) => ({ view: initialView(), usage: undefined, store: {}, now: MORNING, timeZone: 'UTC', reducedMotion: true, marks: 'off', voiceSizes: {}, ...extra }) as unknown as BookData
  const keys = (blocks: readonly { t: string; key?: string }[]) => blocks.flatMap(b => b.key ? [b.key] : [])
  test('the settings page has the way in, and a back button leads out', () => {
    const page = pageBlocks('settings', words, base(), 'terminal')
    expect(keys(page as never)[0]).toBe('coco:care:open')
    const care = pageBlocks('settings', words, base({ care: { first: 'privacy', state: { quiet: false, other: false } } }), 'terminal')
    expect(keys(care as never)).toEqual(['coco:care:back'])
    expect(care.some(b => b.t === 'choice' && b.options.map(o => o.key).join() === 'coco:care:plain,coco:care:quiet')).toBe(true)
  })
  test('the second tier is only mentioned on another maker\'s model, and the state is the file\'s', () => {
    const choice = (state: { quiet: boolean; other: boolean }) => pageBlocks('settings', words, base({ care: { first: 'privacy', state } }), 'terminal').find(b => b.t === 'choice') as { current: string; help: string }
    expect(choice({ quiet: false, other: false }).current).toBe('on')
    expect(choice({ quiet: true, other: false }).current).toBe('off')
    expect(choice({ quiet: false, other: false }).help).not.toContain('fingerprint')
    expect(choice({ quiet: false, other: true }).help).toContain('fingerprint')
  })
  test('an unreadable settings.json says so and offers no switch', () => {
    const care = pageBlocks('settings', words, base({ care: { first: 'privacy' } }), 'terminal')
    expect(care.some(b => b.t === 'choice')).toBe(false)
    expect(care.some(b => b.t === 'para' && b.text.includes('settings.json'))).toBe(true)
  })
  test('/coco models puts the services first, and every service is named', () => {
    const care = pageBlocks('settings', words, base({ care: { first: 'models', state: { quiet: false, other: false } } }), 'terminal')
    const headings = care.flatMap(b => b.t === 'heading' ? [b.text] : [])
    expect(headings).toEqual(['other models', 'privacy'])
    const rows = care.flatMap(b => b.t === 'row' ? [`${b.label} ${b.help}`] : [])
    expect(rows.length).toBe(MODEL_SERVICES.length)
    for (const s of MODEL_SERVICES) expect(rows.some(row => row.includes(s.name) && row.includes(s.url))).toBe(true)
    expect(care.some(b => b.t === 'para' && b.text.includes('whoever runs the model'))).toBe(true)
  })
})

test('the services stand in the alphabet, the hosted ones first, with no ranking', () => {
  const local = MODEL_SERVICES.filter(s => s.where === 'here'), hosted = MODEL_SERVICES.filter(s => s.where !== 'here')
  for (const list of [hosted, local]) expect(list.map(s => s.name.toLowerCase())).toEqual(list.map(s => s.name.toLowerCase()).sort())
  expect(hosted.every(s => s.url.startsWith('https://'))).toBe(true)
  expect(local.every(s => /^http:\/\/(localhost|127\.0\.0\.1):/.test(s.url))).toBe(true)
})

test('the uninstaller reports the switch only when it was used', async () => {
  const steps = async (files: Record<string, string>, store: Record<string, unknown> = {}) => {
    const e = engine(files, undefined, undefined, false, store)
    const $ = { ...e.$, process: { run: async () => ({ kind: 'ran', stdout: '', stderr: '', exitCode: 0 }) } } as never
    return uninstallSteps($, { root: '/plugin', pet: undefined, petInstalled: false, iconPlatform: undefined, run: async () => undefined }, 'en')
  }
  const set = { [FILE]: JSON.stringify({ env: FIRST }) }
  expect((await steps(set, { privacyAdded: Object.keys(FIRST) })).some(line => line.includes('privacy switch'))).toBe(true)
  expect((await steps(set)).some(line => line.includes('privacy switch'))).toBe(false)
})
