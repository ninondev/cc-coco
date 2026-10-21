import { expect, test } from 'bun:test'
import { loadOtherPrices } from '../../../plugin/hooks/cost/prices/load'
import { expectedRows, expectedOthers, NOW } from './helpers'

const LIMIT = 8_000_000
const model = '"openai/gpt-6.1-sol":{"litellm_provider":"openai","mode":"chat","input_cost_per_token":0.000003,"output_cost_per_token":0.000015}'
const prefix = `{${model},"padding":"`
const suffix = '"}'
const base = prefix.length + suffix.length
const ascii = (bytes: number) => prefix + 'a'.repeat(bytes - base) + suffix
async function load(text: string) {
  return loadOtherPrices({
    fetchText: async () => text, after: () => () => {}, now: () => NOW, env: {},
    stored: null, shipped: { asOf: '2026-10-06', source: 'fixture', rows: expectedRows, others: expectedOthers },
    today: '2026-10-07',
  })
}

test('S16 LiteLLM response at exactly 8 MB remains usable', async () => {
  const result = await load(ascii(LIMIT))
  expect(result.why).toBeNull()
  expect(result.store?.makers[0].maker).toBe('openai')
})

test('S16 LiteLLM response one byte over 8 MB is refused before persistence', async () => {
  const result = await load(ascii(LIMIT + 1))
  expect(result.why).toBe('changed')
  expect(result.store).toBeNull()
  expect(result.makers).toEqual(expectedOthers)
})

test('S16 LiteLLM cap counts UTF-8 bytes rather than characters', async () => {
  const result = await load(prefix + 'é'.repeat(Math.floor((LIMIT - base) / 2) + 1) + suffix)
  expect(result.why).toBe('changed')
  expect(result.store).toBeNull()
})

test('S16 LiteLLM cap handles supplementary code points and lone surrogates', async () => {
  const result = await load(prefix + '😀'.repeat(Math.floor((LIMIT - base) / 4) + 1) + suffix)
  expect(result.why).toBe('changed')
  expect(result.store).toBeNull()
  // JSON permits escaped lone surrogates, but the response may also contain
  // one directly. Its UTF-8 replacement takes three bytes.
  const lone = await load(prefix + '\ud800'.repeat(Math.floor((LIMIT - base) / 3) + 1) + suffix)
  expect(lone.why).toBe('changed')
  expect(lone.store).toBeNull()
})
