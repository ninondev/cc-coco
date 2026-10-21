// W1 order Do 3: exact v3 words replace old text pins; all other properties stay.
import { describe, expect, test } from 'claude-code/testing'
import { companionRecord, TASK_WORDS } from '../hooks/companion'
import { DOOR_WORDS } from '../hooks/door-words'
import { LINES } from '../hooks/lines'
import { APPROVED_PERSONA, APPROVED_REACTIONS } from './approved-localization'
import { APPROVED_RIDE } from './approved-ride'
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
    for (const { code: lang } of LANGS.filter(({ code }) => code.startsWith('zh'))) {
      const companion = companionRecord({ ...VIEW, lang })
      expect(violations({
        book: JSON.parse(BOOK_FILES[`${lang}.json`]), words: WORDS[lang],
        lines: [LINES[lang]], voice: VOICE, door: DOOR_WORDS[lang],
        companion: [companion.words, companion.reactions, TASK_WORDS[lang]], readme: CHINESE_README,
      })).toEqual([])
    }
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
    // Her page as the owner rewrote it on 10-15; the birthday row went, so 两面 is the seventh row.
    expect(book.profile[6]).toEqual({ label: '两面', text: '平时坐不住,爱抢功。测试连挂三次限制器就弹飞,火只冲烂代码从不冲你;真出大事时一秒收起玩笑替你兜底' })
    expect(book.log.wild).toBe('黑化过')
    // The bag's extras (lane B 10-15) replaced the old book's readings about the kami; his own wording of 10-15.
    expect(book.library.readings[1]).toEqual({
      title: '桌上的东西',
      text: '你桌上的物件,全被她征用成了游乐场和避难所。嫌吵就钻进大鼠标底下躲清静,犯困就往马克杯里塞个小睡袋打盹。代码一报错,她咻地钻进纸箱合上盖子,只从缝里伸出两根手指比V。遇上Claude拒答说不干,她就"叮"地把茶壶盖扣在头上生闷气。到了半夜,她会盘腿窝在空面桶的软垫上陪你熬夜。桶里没面,千万别往里倒开水。',
    })
  })

  test('all persona strings equal the frozen W1 values plus the approved W2 Chinese pat addition', { timeoutMs: 60_000 }, () => {
    // The fixture holds the owner's W2 pat line itself (zh, and zh-Hant from build-zh-hant), so every language is exact.
    for (const { code } of LANGS) expect(LINES[code]).toEqual(APPROVED_PERSONA[code])
    // Negative control: changing an unapproved warm line still fails the frozen boundary.
    const wrong = { ...LINES.en, start: ['changed without approval'] }
    expect(wrong).not.toEqual(APPROVED_PERSONA.en)
  })

  test('all companion reactions equal the approved W1 v3 native pools', { timeoutMs: 60_000 }, () => {
    for (const { code } of LANGS) {
      const { ride, ...before } = companionRecord({ ...VIEW, lang: code }).reactions
      expect(before).toEqual(APPROVED_REACTIONS[code])
      expect(ride).toEqual(APPROVED_RIDE[code])
    }
  })
})
