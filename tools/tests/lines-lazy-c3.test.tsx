import { expect, test } from 'claude-code/testing'
import { LINES } from '../hooks/lines'
import { initialView, linesFor, PRESENCE_LINES } from '../hooks/mood'
import { LANGS, WORDS } from '../hooks/words'

test('C3 unopened locale pools and companion lines remain getters with stable first-use references', () => {
  for (const { code: lang } of LANGS) {
    expect(typeof Object.getOwnPropertyDescriptor(WORDS, lang)?.get).toBe('function')
    expect(WORDS[lang]).toBe(WORDS[lang])
    expect(typeof Object.getOwnPropertyDescriptor(LINES, lang)?.get).toBe('function')
    expect(typeof Object.getOwnPropertyDescriptor(PRESENCE_LINES[lang], 'sleep')?.get).toBe('function')
    expect(LINES[lang]).toBe(LINES[lang])
    const view = { ...initialView(), lang }
    expect(PRESENCE_LINES[lang].sleep).toBe(linesFor(view, 'sleep'))
    expect(PRESENCE_LINES[lang].wake).toBe(linesFor(view, 'wake'))
    expect(PRESENCE_LINES[lang].idle).toBe(linesFor({ ...view, affection: 'clingy' }, 'idle'))
  }
})
