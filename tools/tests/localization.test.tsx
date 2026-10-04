import { describe, expect, test } from 'claude-code/testing'
import { companionRecord, TASK_WORDS } from '../hooks/companion'
import { DOOR_WORDS } from '../hooks/door-words'
import { LINES } from '../hooks/lines'
import { APPROVED_PERSONA, APPROVED_REACTIONS } from './approved-localization'
import { VOICE } from '../hooks/voice'
import { LANGS, WORDS } from '../hooks/words'
import { BOOK_FILES } from './book-files'
import { CHINESE_README } from './review-texts'

const VIEW: Parameters<typeof companionRecord>[0] = {
  mood: 'idle', frame: 'idle-reading', said: null, slip: null, context: null, estimate: false,
  verb: '', band: 'on', voice: 'off', affection: 'warm', lang: 'zh', pictures: 'cells', colors: 'truecolor', cue: '',
}
const FORBIDDEN = /荒魂|和魂|荒御魂|和御魂/u

function strings(tree: unknown): string[] {
  if (typeof tree === 'string') return [tree]
  if (Array.isArray(tree)) return tree.flatMap(strings)
  if (tree && typeof tree === 'object') return Object.values(tree).flatMap(strings)
  return []
}

function violations(sources: Record<string, unknown>): string[] {
  return Object.entries(sources).flatMap(([source, tree]) =>
    strings(tree).filter(text => FORBIDDEN.test(text)).map(text => `${source}: ${text}`))
}

describe('owner-approved localization boundaries', () => {
  test('no Japanese soul names appear in Chinese user-facing text', { timeoutMs: 60_000 }, () => {
    const companion = companionRecord(VIEW)
    expect(violations({
      book: JSON.parse(BOOK_FILES['zh.json']), words: WORDS.zh,
      lines: [LINES.zh, LINES.omikuji.zh], voice: VOICE, door: DOOR_WORDS.zh,
      companion: [companion.words, companion.reactions, TASK_WORDS.zh], readme: CHINESE_README,
    })).toEqual([])
  })

  test('the guard rejects each forbidden name in every covered source, including nested values', () => {
    const sources = ['book', 'words', 'lines', 'voice', 'door', 'companion', 'readme']
    for (const source of sources) {
      for (const term of ['荒魂', '和魂', '荒御魂', '和御魂']) {
        expect(violations({ [source]: { zh: [{ text: `前${term}后` }] } }).length).toBe(1)
      }
    }
    expect(violations({ zh: '平常温和。黑化过', en: 'wild soul' })).toEqual([])
  })

  test('Chinese book keeps the exact five approved values', () => {
    const book = JSON.parse(BOOK_FILES['zh.json'])
    expect(book.profile[7]).toEqual({ label: '两面', text: '平常温和。黑化了也只冲着烂代码去,从不冲着你' })
    expect(book.log.wild).toBe('黑化过')
    expect(book.library.readings[1]).toEqual({
      title: '两面',
      text: '神都有两面。平常的他很温和:安静,读得慢,读完才开口。代码烂到一定地步,他就黑化了:头发一根根竖起,眼睛缩成两道橙色细缝,修起来快得吓人。修完他把头发按回原处,全当无事发生。发火只冲着代码,从不冲着你。',
    })
  })

  test('all persona strings equal the before snapshot plus only the round-6 approved changes', { timeoutMs: 60_000 }, () => {
    for (const { code } of LANGS) expect(LINES[code]).toEqual(APPROVED_PERSONA[code])
  })

  test('all companion reactions equal the before snapshot plus only the eight approved changes', { timeoutMs: 60_000 }, () => {
    for (const { code } of LANGS) expect(companionRecord({ ...VIEW, lang: code }).reactions).toEqual(APPROVED_REACTIONS[code])
  })
})
