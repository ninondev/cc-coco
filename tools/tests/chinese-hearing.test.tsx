import { expect, test } from 'claude-code/testing'
import { WORDS } from '../hooks/words'
import { TRADITIONAL_ONLY, SIMPLIFIED_ONLY } from './chinese-script-data'
import { P, PERSON, RECENT, settleLegacyStart, world } from './world'

function gate() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}

test('cold Chinese hearing keeps overlapping prompts in arrival order and switches on one short clear prompt', { timeoutMs: 60_000 }, async ($, on) => {
  const firstRead = gate(), readRelease = gate()
  const data = JSON.stringify({ TRADITIONAL_ONLY, SIMPLIFIED_ONLY })
  let datasetReads = 0
  const heardWrites: unknown[] = []
  on('store.set', { key: 'heard' }, async ($, e, next) => {
    heardWrites.push(e.value)
    return next(e)
  })
  const w = world(on, {
    store: RECENT, env: {},
    readText: path => {
      if (!/[\\/]hooks[\\/]chinese-script-data\.json$/.test(path)) return undefined
      datasetReads++
      firstRead.release()
      return readRelease.promise.then(() => data)
    },
  })
  await $.session.start({ cwd: '/tmp/chinese-hearing-project', surface: 'terminal', isInteractive: true })
  await settleLegacyStart($, w)
  expect(datasetReads).toBe(0)
  const earlierText = WORDS['zh-Hant'].spinner.join('')
  const laterText = 'kannst du bitte den Fehler in der Funktion beheben und danach auch noch einen Test dafür schreiben, der das prüft?'
  const earlier = $.prompt.submit({ text: earlierText, wait: false, origin: PERSON })
  await firstRead.promise
  let laterFinished = false
  const later = $.prompt.submit({ text: laterText, wait: false, origin: PERSON }).then(result => {
    laterFinished = true
    return result
  })
  try {
    // Real unrelated host requests give the second event time to enter hearing.
    for (let i = 0; i < 20; i++) await $.command.run({ command: 'b1b-host-boundary', args: '', origin: PERSON, presentation: P })
    expect(laterFinished).toBe(false)
    expect(heardWrites).toEqual([])
  } finally {
    readRelease.release()
    await Promise.all([earlier, later])
  }
  expect(w.view().lang).toBe('de')
  expect(heardWrites).toEqual(['zh-Hant', 'de'])
  expect(datasetReads).toBe(1)

  const shortText = WORDS['zh-Hant'].spinner.slice(0, 2).join('')
  // one short, clear line of his switches at once (owner 10-18: 「随时切换」)
  await $.prompt.submit({ text: shortText, wait: false, origin: PERSON })
  expect(w.view().lang).toBe('zh-Hant')
  await $.prompt.submit({ text: shortText, wait: false, origin: PERSON })
  expect(w.view().lang).toBe('zh-Hant')
  expect(heardWrites).toEqual(['zh-Hant', 'de', 'zh-Hant'])
  expect(datasetReads).toBe(1)
})
