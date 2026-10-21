// NOTICES commit reader: four gates, two qualities, one quoted clause. Frozen synthetic messages in
// 13 languages (written for the design, not real commits) and the rules that changed on 10-09.
import { describe, expect, test } from 'bun:test'
import synthetic from './notice-data/commit-synthetic.json'
import { executeNoticeAlgo } from '../../notice-core'
import { bodyOf, read, reasonQuote } from '../../notice/commit'

const msg = (subject: string, body: string) => `${subject}\n\n${body}`
const GOOD = 'The refresh call fails when the laptop wakes from sleep because the network is not up yet, so people were logged out mid-draft.'

describe('the labelled messages', () => {
  test('every message the design labelled keeps its verdict and quality', () => {
    expect(synthetic.length).toBe(35)
    for (const s of synthetic) {
      const got = read(s.message)
      expect(!!got, s.lang + ': ' + s.message.split('\n')[0]).toBe(s.pass)
      if (got) expect(got.quality).toBe(s.quality as string)
    }
  })

  test('the labels agree: every message he should praise passes, every silent one does not', () => {
    const wrong = synthetic.filter(s => !!read(s.message) !== !!s.want)
    expect(wrong.map(s => s.message.split('\n')[0])).toEqual([])
  })
})

describe('four gates (the subject mood is not judged)', () => {
  test('a past-tense subject with a good body now passes', () => {
    expect(read(msg('Fixed the login after wake', GOOD))?.quality).toBe('why')
    expect(read(msg('修复了休眠唤醒后的登录', '电脑从休眠中醒来时网络还没连上，刷新令牌的请求会失败，用户因此被登出、草稿丢失。现在失败后等两秒重试一次。'))?.quality).toBe('why')
  })

  test('mechanical, noisy and bare subjects get nothing', () => {
    expect(read(msg('Merge branch main into feature', GOOD))).toBeDefined()
    expect(read("Merge branch 'main' into feature")).toBeUndefined()
    expect(read(msg('Bump lodash from 4.17.20 to 4.17.21', GOOD))).toBeUndefined()
    expect(read(msg('fixup! Retry the refresh', GOOD))).toBeUndefined()
    expect(read(msg('WIP retry the token refresh', GOOD))).toBeUndefined()
    expect(read(msg('UPDATE EVERYTHING NOW PLEASE', GOOD))).toBeUndefined()
    expect(read(msg('Update auth.ts', GOOD))).toBeUndefined()
    expect(read(msg('PROJ-1234', GOOD))).toBeUndefined()
    expect(read(msg('Retry the refresh ✨🔥', GOOD))).toBeUndefined()
    expect(read(msg('Retry the token refresh once before logging out and show the draft again please now ok', GOOD))).toBeUndefined()
  })

  test('no body, a body glued to the subject, a short body and a body with no reason get nothing', () => {
    expect(read('Retry the token refresh once')).toBeUndefined()
    expect(read('Retry the token refresh once\nThe refresh call fails because the network is not up yet, so people were logged out.')).toBeUndefined()
    expect(read(msg('Retry the token refresh once', 'Because the network is down.'))).toBeUndefined()
    expect(read(msg('Retry the token refresh once', 'The refresh call runs after wake and the user sees the draft again with the old token intact today.'))).toBeUndefined()
  })

  test('Conventional Commits prefixes, scopes and trailers are not the subject or the body', () => {
    expect(read(msg('feat(auth): retry the token refresh once', GOOD))?.quality).toBe('why')
    expect(read(`Retry the token refresh once\n\n${GOOD}\n\nCo-Authored-By: Someone <a@b.c>\nSigned-off-by: Someone <a@b.c>`)?.quality).toBe('why')
    expect(read(`Retry the token refresh once\n\nSigned-off-by: Someone <a@b.c>`)).toBeUndefined()
  })
})

describe('two qualities', () => {
  const para = 'The cache stored the stripped tree, so comments were dropped on the second run because the tokens were gone. '
  const LONG = [para.repeat(3).trim(), 'Previously we kept nothing, which meant formatting broke whenever a file was saved twice, so we now store the originals.'].join('\n\n')

  test('60 words, two paragraphs and two reasons is the long, explained message; anything else that passes gives the reason', () => {
    expect(read(msg('Keep comments between runs', LONG))?.quality).toBe('long')
    expect(read(msg('Keep comments between runs', GOOD))?.quality).toBe('why')
  })

  test('both carry the clause with the first reason word when it fits (the note shows it for the reason only)', () => {
    expect(read(msg('Keep comments between runs', LONG))?.quote).toBe('because the tokens were gone')
    expect(read(msg('Retry the refresh once', GOOD))?.quote).toBe('because the network is not up yet')
  })
})

describe('the quote (NT7)', () => {
  test('the clause with the first reason word, whole between punctuation', () => {
    expect(reasonQuote('We retry once, because the network may be down. Then we stop.')).toBe('because the network may be down')
    expect(reasonQuote('用户因此被登出，草稿也丢失。')).toBe('用户因此被登出')
  })

  test('from the reason word when the whole clause is too long; none when even that does not fit', () => {
    expect(reasonQuote('The refresh call fails when the laptop wakes from sleep because the network is not up yet.')).toBe('because the network is not up yet')
    expect(reasonQuote('The refresh call fails because the network is not up yet and the retry that would have caught it never ran at all.')).toBeUndefined()
  })

  test('every quote is a verbatim piece of the body, fits 48 columns and ends at punctuation or the end', () => {
    for (const s of synthetic) {
      const v = read(s.message)
      if (!v?.quote) continue
      const body = bodyOf(s.message).join(' ')
      expect(body.includes(v.quote), v.quote).toBe(true)
      const at = body.indexOf(v.quote) + v.quote.length
      expect(at === body.length || /[.,;:!?。，；：！？、\s]/.test(body[at]!)).toBe(true)
      expect([...v.quote].reduce((n, c) => n + (c.charCodeAt(0) > 0x2e7f ? 2 : 1), 0)).toBeLessThanOrEqual(48)
    }
  })
})

describe('the worker op', () => {
  test('answers the quality and the quote, nothing else', () => {
    expect(executeNoticeAlgo({ op: 'commit', message: msg('Retry the refresh once', GOOD) })).toEqual({ quality: 'why', quote: 'because the network is not up yet' })
    expect(executeNoticeAlgo({ op: 'commit', message: 'wip' })).toBeNull()
    expect(executeNoticeAlgo({ op: 'commit' })).toBeNull()
  })
})
