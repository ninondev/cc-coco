import type { EngineInterface } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import { checkFolder, checkup, olderVersion, readCheckCompanion, readCheckSessions } from '../hooks/checkup'
import type { CheckInput, CheckWords } from '../hooks/checkup'
import { LANGS } from '../hooks/words'
import { BOOK_FILES } from './book-files'
import { C1_NUMBER_WORDS } from './c1-number-words'

const good: CheckInput = { platform: 'darwin', surface: 'desktop', installed: true,
  companion: { running: true, accessibility: true, version: '0.2.0' }, health: {}, version: '0.2.0', band: 'on', sessions: [], home: '/tmp/home' }
function words(lang: keyof typeof C1_NUMBER_WORDS.durations): CheckWords {
  return { ...JSON.parse(BOOK_FILES[`${lang}.json`]!), check: {
    title: C1_NUMBER_WORDS['check.title'][lang], ok: C1_NUMBER_WORDS['check.ok'][lang], fix: C1_NUMBER_WORDS['check.fix'][lang],
    oldSession: C1_NUMBER_WORDS['check.oldSession'][lang], copied: C1_NUMBER_WORDS['check.copied'][lang],
  } }
}

describe('0.2 9.2 the five check-up rows', () => {
  test('all good belongs at the end; absent companion makes no running claim', () => {
    expect(checkup(good, words('en'))).toEqual({ title: 'Check-up', ok: 'All good', placement: 'end', rows: [] })
    expect(checkup({ ...good, installed: false, companion: {} }, words('en')).rows).toEqual([])
  })
  for (const { code } of LANGS) test(`${code}: five subjects, exact states and fix ids`, () => {
    const w = words(code)
    const stopped = checkup({ ...good, companion: { running: false, version: '0.1.2' }, band: 'off', sessions: [
      { session: 'older', version: '0.1.2', cwd: '/tmp/home/Project', open: true },
    ] }, w)
    expect(stopped.placement).toBe('top')
    expect(stopped.rows).toEqual([
      { id: 'companion', subject: w.settings.companion.label, state: w.settings.companion.stopped, fix: 'summon' },
      { id: 'update', subject: w.settings.companion.label, state: w.settings.companion.update, fix: 'updateButton' },
      { id: 'band', subject: w.settings.band.label, state: w.settings.now.replace('{value}', w.settings.band.off), fix: 'bandOn' },
      { id: 'session:older', subject: '~/Project', state: w.check.oldSession, fix: 'reloadPlugins' },
    ])
    expect(checkup({ ...good, health: { accessibility: false } }, w).rows).toEqual([
      { id: 'follow', subject: w.settings.companion.label, state: w.settings.companion.corner, fix: 'follow' },
    ])
    const copied = checkup({ ...good, sessions: [{ session: 'older', version: '0.1.2', cwd: '/tmp/project', open: true }], copied: ['older'] }, w)
    expect(copied.rows[0]?.after).toBe(w.check.copied)
  })
  test('platform/surface, actual live records, numeric older version and working words', () => {
    for (const platform of ['win32', 'linux'] as const)
      expect(checkup({ ...good, platform, companion: { running: false, accessibility: false, version: '0.1.0' } }, words('en')).rows).toEqual([])
    for (const surface of ['vscode', 'mobile'] as const)
      expect(checkup({ ...good, surface, band: 'off' }, words('en')).rows).toEqual([])
    expect(checkup({ ...good, sessions: [
      { session: 'closed', version: '0.1.2', cwd: '/tmp/closed', open: false },
      { session: 'newer', version: '0.10.0', cwd: '/tmp/newer', open: true },
      { session: 'same', version: '0.2.0', cwd: '/tmp/same', open: true },
    ] }, words('en')).rows).toEqual([])
    const w = words('en')
    expect(checkup({ ...good, companion: { running: false }, working: { companion: 'Building him…' } }, w).rows[0]).toEqual({ id: 'companion', subject: w.settings.companion.label, state: 'Building him…', fix: null })
    expect(olderVersion('0.10.0', '0.2.0')).toBe(false)
    expect(olderVersion('0.2.0-beta.2', '0.2.0-beta.11')).toBe(true)
    expect(olderVersion('0.2.0-beta.1', '0.2.0')).toBe(true)
    expect(olderVersion('unknown', '0.2.0')).toBe(false)
    expect(checkFolder('C:\\Users\\Owner\\Work', 'c:\\users\\owner')).toBe('~/Work')
    expect(checkFolder('/tmp/homely/project', '/tmp/home')).toBe('/tmp/homely/project')
  })

  test('small reads use only caller-named own files; closed, link, oversized, malformed fields ignored', async () => {
    const reads: string[] = [], files: Record<string, string> = {
      '/tmp/own/companion.json': JSON.stringify({ running: true, accessibility: 'false', version: '0.1.2' }),
      '/tmp/own/health.json': JSON.stringify({ version: '0.1.2', protocolGeneration: 'B3b', accessibility: false, targetFound: true, target: 'claude' }),
      '/tmp/own/session.json': JSON.stringify({ session: 'old', cwd: '/tmp/project', version: '0.1.2' }),
      '/tmp/own/bad.json': '{', '/tmp/own/array.json': '[]', '/tmp/own/wrong.json': JSON.stringify({ session: 'bad', cwd: 4, version: false }),
    }
    const $ = { fs: {
      stat: async (path: string) => ({ kind: 'file', size: path.endsWith('huge.json') ? 20000 : 300, mtimeMs: 0, isLink: path.endsWith('link.json') }),
      read: async (path: string) => { reads.push(path); return files[path] ?? '{}' },
    } } as unknown as EngineInterface
    expect(await readCheckCompanion($, '/tmp/own', true)).toEqual({ installed: true, companion: { running: true, version: '0.1.2' }, health: { version: '0.1.2', protocolGeneration: 'B3b', accessibility: false } })
    expect(await readCheckSessions($, ['session', 'bad', 'array', 'wrong', 'huge', 'link'].map(name => ({ path: `/tmp/own/${name}.json`, open: true })).concat([{ path: '/tmp/own/closed.json', open: false }]))).toEqual([
      { session: 'old', cwd: '/tmp/project', version: '0.1.2', open: true },
    ])
    expect(reads.includes('/tmp/own/closed.json')).toBe(false)
    expect(reads.includes('/tmp/own/huge.json')).toBe(false)
    expect(reads.includes('/tmp/own/link.json')).toBe(false)
  })
  test('home abbreviation requires a complete Unix directory boundary and preserves case', () => {
    expect(checkFolder('/Users/me', '/Users/me/')).toBe('~')
    expect(checkFolder('/Users/me/Project', '/Users/me')).toBe('~/Project')
    expect(checkFolder('/Users/meadow/Project', '/Users/me')).toBe('/Users/meadow/Project')
    expect(checkFolder('/Users/Me/Project', '/Users/me')).toBe('/Users/Me/Project')
    expect(checkFolder('/Users/me/Project')).toBe('/Users/me/Project')
  })
  test('Windows home abbreviation folds case and separators but keeps sibling prefixes and drives distinct', () => {
    expect(checkFolder('C:\\Users\\Owner', 'c:/users/owner/')).toBe('~')
    expect(checkFolder('C:\\Users\\OWNER\\Work', 'c:/users/owner/')).toBe('~/Work')
    expect(checkFolder('c:/Users/Owner/Work', 'C:\\users\\OWNER')).toBe('~/Work')
    expect(checkFolder('C:\\Users\\Ownerly\\Work', 'c:/users/owner')).toBe('C:\\Users\\Ownerly\\Work')
    expect(checkFolder('D:\\Users\\Owner\\Work', 'c:/users/owner')).toBe('D:\\Users\\Owner\\Work')
    expect(checkFolder('C:\\Users\\Owner', 'c:\\')).toBe('~/Users/Owner')
  })
  test('root home abbreviates absolute descendants and leaves relative paths intact', () => {
    expect(checkFolder('/', '/')).toBe('~')
    expect(checkFolder('/Users/me/Project', '/')).toBe('~/Users/me/Project')
    expect(checkFolder('relative/Project', '/')).toBe('relative/Project')
  })
  test('missing companion folder reads nothing else', async () => {
    let reads = 0
    const $ = { fs: {
      stat: async () => { reads++; throw new Error('must not stat absent installation') },
      read: async () => { reads++; throw new Error('must not read absent installation') },
    } } as unknown as EngineInterface
    expect(await readCheckCompanion($, '/tmp/missing', false)).toEqual({ installed: false, companion: {}, health: {} })
    expect(reads).toBe(0)
  })
})
