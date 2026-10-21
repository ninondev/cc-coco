import { expect, test } from 'claude-code/testing'
import { cardScript, cardWidth as acceptedWidth } from '../hooks/card-metrics'
import { cardWrap as acceptedWrap } from '../hooks/card'
import { cardWidth, loadCardMetrics, resetCardMetrics } from '../hooks/card-metrics-lazy'
import { cardWrap } from '../hooks/card-runtime'
import { CARD_METRICS_TEXT } from './card-metrics-data'
import { WEEK_TEXT_RAW } from './week-text-fixture'

// Compare the lazy consumer with the accepted generated tables and the accepted wrapping, on every word the week card
// can draw in every language.
const strings = (value: unknown): string[] => typeof value === 'string' ? [value]
  : Array.isArray(value) ? value.flatMap(strings) : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : []
test('C3 lazy card metrics preserve accepted widths and wrapping for every week word', async () => {
  resetCardMetrics()
  let reads = 0
  const read = async (path: string) => { expect(path).toBe('hooks/card-metrics.json'); reads++; return CARD_METRICS_TEXT }
  await Promise.all([loadCardMetrics(read), loadCardMetrics(read)])
  let checked = 0
  for (const byLang of Object.values(JSON.parse(WEEK_TEXT_RAW) as Record<string, Record<string, unknown>>)) {
    for (const [lang, value] of Object.entries(byLang)) for (const text of strings(value)) {
      const script = cardScript(lang)
      for (const size of [27, 33, 58]) expect(cardWrap(text, script, size, 860)).toEqual(acceptedWrap(text, script, size, 860))
      for (const size of [27, 33, 46, 58]) for (const bold of [false, true]) {
        expect(cardWidth(text, script, size, bold)).toBe(acceptedWidth(text, script, size, bold))
      }
      checked++
    }
  }
  expect(checked).toBeGreaterThan(100)
  await loadCardMetrics(read)
  expect(reads).toBe(1)
  resetCardMetrics()
})

test('C3 failed metric reads cannot poison a later save and unloaded widths are unavailable', async () => {
  resetCardMetrics()
  expect(() => cardWidth('test', 'latin', 46)).toThrow('Card metrics not loaded')
  let failed = false
  try { await loadCardMetrics(async () => '{"latin":[]}') } catch { failed = true }
  expect(failed).toBe(true)
  await loadCardMetrics(async () => CARD_METRICS_TEXT)
  expect(cardWidth('test', 'latin', 46)).toBe(acceptedWidth('test', 'latin', 46))
  resetCardMetrics()
})
