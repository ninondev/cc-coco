import { expect, test } from 'claude-code/testing'
import { companionActivity, companionKey, companionRecord, companionSession, companionTask, companionText } from '../hooks/companion'
import { initialView, PRESENCE_LINES } from '../hooks/mood'
import { LINES } from '../hooks/lines'
import { LANGS, WORDS } from '../hooks/words'
import type { Lang } from '../hooks/words'
import { APPROVED_REACTIONS } from './approved-localization'
import { APPROVED_RIDE } from './approved-ride'

const paired = /\*[^*\n]+\*/u
const face = '(*´ω`*)'
const sourceLines = JSON.stringify(LINES)
const sourceWords = JSON.stringify(WORDS)
const sourcePresence = JSON.stringify(PRESENCE_LINES)
type Entry = { path: string[]; text: string }
function strings(value: unknown, path: string[] = []): Entry[] {
  if (typeof value === 'string') return [{ path, text: value }]
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, item]) => strings(item, [...path, key]))
}
const marked = strings(LINES).filter(entry => paired.test(entry.text))
const decode = (text: string) => text.split(face).map(part => part.replace(/\*([^*\n]+)\*/g, '$1')).join(face)
function clean(value: unknown): void {
  expect(strings(value).filter(entry => paired.test(entry.text.split(face).join('')))).toEqual([])
}
function unchanged(): void {
  expect(JSON.stringify(LINES)).toBe(sourceLines)
  expect(JSON.stringify(WORDS)).toBe(sourceWords)
  expect(JSON.stringify(PRESENCE_LINES)).toBe(sourcePresence)
}
function presence(lang: Lang, said: string | null) {
  return { seq: 41, asleep: false, event: { kind: 'wake', id: 'wake:*literal*:41', at: 1000 }, said, quietAt: 900,
    busy: false, clingy: false, lang, touchEvent: { kind: 'pat', id: 'touch:*literal*:40', at: 950 },
    settings: { future: '*literal*' }, settingsEvent: { kind: 'settings', id: 'settings:*literal*:39', at: 850 },
    affection: 'warm', lines: PRESENCE_LINES }
}
function feed(view: Parameters<typeof companionRecord>[0], shared?: Record<string, unknown>) {
  return JSON.parse(companionText(companionKey(view, shared), 'session:*literal*', true, 1000, ['desktop', 'vscode']))
}
function metadata(payload: any, shared: ReturnType<typeof presence>): void {
  expect(payload.session).toBe('session:*literal*')
  expect(payload.at).toBe(1000)
  expect(payload.surfaces).toEqual(['desktop', 'vscode'])
  for (const key of ['seq', 'event', 'touchEvent', 'settings', 'settingsEvent', 'quietAt', 'busy', 'clingy', 'lang', 'affection'] as const) expect(payload.presence[key]).toEqual(shared[key])
}

// Since the Coco lines (10-14) every language writes stage directions in half-width parentheses (CANON 3).
test('W3 A1 companion stage corpus has no authored marked lines', () => {
  expect(marked.length).toBe(0)
  expect(marked.filter(entry => !LANGS.some(({ code }) => entry.path.includes(code)))).toEqual([])
  unchanged()
})

for (const entry of marked) test(`W3 A1 companion authored ${entry.path.join('.')}: feed and shared presence expose exact decoded stage text`, () => {
  companionSession('/tmp/w3-companion')
  const lang = LANGS.find(({ code }) => entry.path.includes(code))!.code
  const shared = presence(lang, entry.text)
  const view = { ...initialView(), lang, said: entry.text }
  const payload = feed(view, shared)
  expect(payload.said).toBe(decode(entry.text))
  expect(payload.presence.said).toBe(decode(entry.text))
  clean({ said: payload.said, sharedSaid: payload.presence.said })
  metadata(payload, shared)
  expect(view.said).toBe(entry.text)
  expect(shared.said).toBe(entry.text)
  unchanged()
})

for (const { code: lang } of LANGS) test(`W3 A1 companion ${lang}: native reaction, wake, words and accessible aside pools contain no authored stage marks`, () => {
  companionSession('/tmp/w3-companion')
  for (const affection of ['warm', 'clingy'] as const) {
    const aside = WORDS[lang].touch.patted
    const view = { ...initialView(), lang, affection, pose: { name: 'tea', frame: 'think', aside, at: 17 } }
    const shared = { ...presence(lang, null), affection }
    const payload = feed(view, shared)
    expect(payload.aside).toBe(decode(aside))
    expect(payload.pose.aside).toBe(decode(aside))
    expect(payload.pose.at).toBe(17)
    clean({ name: payload.name, aside: payload.aside, poseAside: payload.pose.aside, words: payload.words,
      reactions: payload.reactions, wake: payload.wakeLines, nativePresencePools: payload.presence.lines })
    const originalWake = affection === 'clingy' ? LINES[lang].clingy.wake : LINES[lang].wake
    expect(payload.wakeLines).toEqual(originalWake.map(decode))
    for (const key of ['pat', 'flustered', 'drag', 'drop', 'hold', 'ride'] as const) {
      const approved = key === 'ride' ? APPROVED_RIDE[lang]! : APPROVED_REACTIONS[lang][key]
      expect(payload.reactions[key]).toEqual(approved.map(decode))
    }
    for (const { code } of LANGS) for (const key of ['sleep', 'wake', 'idle'] as const) expect(payload.presence.lines[code][key]).toEqual(PRESENCE_LINES[code][key].map(decode))
    metadata(payload, shared)
    expect(view.pose.aside).toBe(aside)
  }
  unchanged()
})

test('W3 A1 companion projection preserves the approved literal kaomoji stars', () => {
  companionSession('/tmp/w3-companion')
  const payload = feed(initialView())
  expect(payload.reactions.pat.some((text: string) => text.endsWith(face))).toBe(true)
  expect(decode(face)).toBe(face)
  unchanged()
})

test('W3 A1 companion runtime activity, task, path and metadata literal stars stay exact', () => {
  companionSession('/tmp/*root*')
  const reply = { text: 'runtime *literal* reply', at: 700 }
  const notice = { kind: '*literal*', text: 'runtime *literal* notice', at: 800 }
  companionActivity({ reply, notice, ack: 'ack:*literal*', channel: true })
  const path = 'src/*literal*/file.ts'
  companionTask({ key: 'reading', file: path })
  const shared = presence('en', null)
  const payload = feed(initialView(), shared)
  expect(payload.reply).toEqual(reply)
  expect(payload.notice).toEqual(notice)
  expect(payload.ack).toBe('ack:*literal*')
  expect(payload.project).toBe('*root*')
  expect(payload.task).toBe(`reading ${path}`)
  metadata(payload, shared)
  unchanged()
})

test('W3 A1 companion line slots protect literal path stars across an outer stage pair', () => {
  companionSession('/tmp/w3-companion')
  const path = 'src/*literal*/file.ts'
  const source = `before *opens ${path} then closes* after`
  const view = { ...initialView(), line: { id: 'line:*literal*', key: 'w3-companion', text: source, class: 2 as const,
    expiresAt: 14000, slots: [{ kind: 'path' as const, value: path }] } }
  const payload = feed(view)
  expect(payload.said).toBe(`before opens ${path} then closes after`)
  expect(view.line.text).toBe(source)
  expect(view.line.id).toBe('line:*literal*')
  expect(view.line.slots[0]!.value).toBe(path)
  unchanged()
})
