import { expect, test } from 'bun:test'
import { LITELLM_MAX_BYTES, OTHERS_MAX_BYTES, loadOtherPrices, otherResponseWithinLimit } from '../../../plugin/hooks/cost/prices/load'
import { expectedRows, expectedOthers, NOW } from './helpers'

// S16: the host's fetch cannot stop at a size, so what Coco downloads is the small daily list, refused over 64 KB;
// the 8 MB cap is the daily job's, on LiteLLM's own table (tools/prices/others-list.ts).
const LIMIT = OTHERS_MAX_BYTES
const prefix = `{"version":1,"generatedAt":"${new Date(NOW).toISOString()}","makers":[{"maker":"openai","label":"OpenAI","models":[{"name":"gpt-6.1-sol","input":3,"read":null,"output":15}]}],"padding":"`
const suffix = '"}'
const base = prefix.length + suffix.length
const ascii = (bytes: number) => prefix + 'a'.repeat(bytes - base) + suffix
async function load(text: string) {
  return loadOtherPrices({
    fetchText: async () => text, after: () => () => {}, now: () => NOW, env: {},
    stored: null, shipped: { asOf: '2026-10-06', source: 'fixture', rows: expectedRows, others: expectedOthers },
  })
}

test('S16 a list of exactly 64 KB remains usable', async () => {
  const result = await load(ascii(LIMIT))
  expect(result.why).toBeNull()
  expect(result.store?.makers[0].maker).toBe('openai')
})

test('S16 a list one byte over 64 KB is refused before persistence', async () => {
  const result = await load(ascii(LIMIT + 1))
  expect(result.why).toBe('changed')
  expect(result.store).toBeNull()
  expect(result.makers).toEqual(expectedOthers)
})

test('S16 the cap counts UTF-8 bytes rather than characters', async () => {
  const result = await load(prefix + 'é'.repeat(Math.floor((LIMIT - base) / 2) + 1) + suffix)
  expect(result.why).toBe('changed')
  expect(result.store).toBeNull()
})

test('S16 the cap handles supplementary code points and lone surrogates', async () => {
  const result = await load(prefix + '😀'.repeat(Math.floor((LIMIT - base) / 4) + 1) + suffix)
  expect(result.why).toBe('changed')
  expect(result.store).toBeNull()
  // JSON permits escaped lone surrogates, but the response may also contain
  // one directly. Its UTF-8 replacement takes three bytes.
  const lone = await load(prefix + '\ud800'.repeat(Math.floor((LIMIT - base) / 3) + 1) + suffix)
  expect(lone.why).toBe('changed')
  expect(lone.store).toBeNull()
})

test("S16 the daily job's cap on LiteLLM's table stays 8 MB", () => {
  expect(LITELLM_MAX_BYTES).toBe(8_000_000)
  expect(otherResponseWithinLimit('a'.repeat(LITELLM_MAX_BYTES), LITELLM_MAX_BYTES)).toBe(true)
  expect(otherResponseWithinLimit('a'.repeat(LITELLM_MAX_BYTES + 1), LITELLM_MAX_BYTES)).toBe(false)
  expect(otherResponseWithinLimit('a'.repeat(OTHERS_MAX_BYTES + 1))).toBe(false)
})
