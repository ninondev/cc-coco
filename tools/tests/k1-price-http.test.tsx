import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { OTHERS_URL, PRICE_PAGE_URL } from '../hooks/cost/prices/load'
import { COST_WORDS_RAW, SHIPPED_PRICES_RAW } from './cost-words-fixture'
import { C3_WORDS_RAW } from './c3-words-fixture'
import { MORNING, PERSON, P, RECENT, settleLegacyStart, world } from './world'
import { WINDOWS_ROOTS } from './test-system'

const START = { cwd: WINDOWS_ROOTS ? 'C:\\Users\\windows\\k1-price-http' : '/tmp/k1-price-http', surface: 'vscode' as const, isInteractive: true }
const PANE = { plugin: 'coco', component: 'Pane' as const, requestId: 'coco-book', props: { title: 'Coco', isFocused: true, bodyColumns: 42, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 24 }, view: {} } }
const OK = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
const OTHER = { 'openai/gpt-6.1-sol': { litellm_provider: 'openai', mode: 'chat', input_cost_per_token: .000003, output_cost_per_token: .000015, cache_read_input_token_cost: .0000003 } }
const pageRow = (name: string, p: { input: number; write5m: number; write1h: number; read: number; output: number }) => `| ${name} | ${[p.input, p.write5m, p.write1h, p.read, p.output].map(n => `$${n}/MTok`).join(' | ')} |`
const PAGE = ['## Model pricing', '| Model | Input | 5m writes | 1h writes | Cache hits | Output |', '| --- | --- | --- | --- | --- | --- |', ...JSON.parse(SHIPPED_PRICES_RAW).rows.flatMap((row: any) => [pageRow(row.over ? `${row.name} (up to 100K tokens)` : row.name, row), ...(row.over ? [pageRow(`${row.name} (over 100K tokens)`, row.over)] : [])])].join('\n')

function fixture(on: On, options: { stored?: boolean } = {}) {
  const calls: { url: string; init: unknown; signal: AbortSignal; origin: string }[] = []
  on('http.fetch', async ($, e, next) => {
    calls.push({ url: e.url, init: e.init, signal: next.signal, origin: next.origin.plugin })
    return { value: { ok: true, status: 200, headers: {}, text: e.url === PRICE_PAGE_URL ? PAGE : JSON.stringify(OTHER) } }
  })
  on('settings.read', { source: 'policy' }, () => ({ value: {} }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('process.run', ($, e) => {
    if (e.argv[1]?.endsWith('algo-worker.mjs')) {
      const request = JSON.parse(e.init?.stdin ?? '{}')
      const result = request.op === 'pace' ? { projections: [], hot: { state: { hot: {} }, hot: [] } } : request.op === 'repeat' ? null : {}
      return { value: { ...OK, stdout: JSON.stringify({ ok: true, result }) } }
    }
    return { value: OK }
  })
  const old = { fetchedAt: MORNING + 5 * 86400000 - 3600000, rows: JSON.parse(SHIPPED_PRICES_RAW).others }
  const w = world(on, {
    observeStore: true, sessionRoot: START.cwd, sessionId: 'k1-price-http', surfaces: ['vscode'],
    store: { ...RECENT, firstMet: MORNING, lang: 'en', bandSettings: { lang: 'en', motion: 'still', marks: 'off' }, ...(options.stored ? { 'prices.others': old } : {}) },
    settings: { prefersReducedMotion: true }, env: { HOME: '/tmp/k1-price-http-home', LANG: 'en_US.UTF-8', TERM: 'xterm-256color' },
    readText: path => path.endsWith('cost-text.json') ? COST_WORDS_RAW : path.endsWith('prices.json') ? SHIPPED_PRICES_RAW : path.endsWith('c3-text.json') ? C3_WORDS_RAW : undefined,
  })
  return { w, calls, old }
}
async function settle($: any, f: ReturnType<typeof fixture>, ui: any) { await settleLegacyStart($, f.w); await ui.redraw() }
async function mount($: any, f: ReturnType<typeof fixture>) {
  await f.w.clock.advance(5 * 86400000)
  await $.session.start(START); await settleLegacyStart($, f.w)
  await $.command.run({ command: 'coco', args: 'usage', origin: PERSON, presentation: P })
  const ui = await $.ui.mount({ surface: 'vscode', ...PANE })
  await ui.redraw(); expect(f.calls).toEqual([])
  await ui.press({ key: 'coco:prices:open' }); await settle($, f, ui)
  expect(f.calls.map(call => call.url)).toEqual([PRICE_PAGE_URL])
  return ui
}

const WORDS = JSON.parse(COST_WORDS_RAW) as Record<string, Record<string, string>>
function word(key: string, values: Record<string, string> = {}): string {
  const template = WORDS[key]?.en
  if (!template) throw Error(`missing approved expected word: ${key}.en`)
  return template.replace(/\{(\w+)\}/g, (_match, slot: string) => values[slot] ?? `{${slot}}`)
}
async function visible(ui: any) { return (await ui.findAll({ type: 'Text' })).map((node: any) => String(node.text)).join('\n') }

test('S16 unsupported HTTP adapter stays offline for other makers across folds and page openings', async ($, on) => {
  const f = fixture(on), ui = await mount($, f)
  await ui.press({ key: 'coco:prices:others' }); await settle($, f, ui)
  expect(f.calls.map(call => call.url)).toEqual([PRICE_PAGE_URL])
  expect(f.calls.every(call => call.init === undefined)).toBe(true)
  expect(await visible(ui)).toContain(word('prices.why.offline'))
  for (let i = 0; i < 3; i++) { await ui.press({ key: 'coco:prices:others' }); await settle($, f, ui) }
  expect(f.calls.map(call => call.url)).toEqual([PRICE_PAGE_URL])
  expect(f.w.stored('prices.others')).toBeUndefined()
  await ui.press({ key: 'coco:prices:back' }); await ui.redraw()
  await ui.press({ key: 'coco:prices:open' }); await settle($, f, ui)
  await ui.press({ key: 'coco:prices:others' }); await settle($, f, ui)
  expect(f.calls.map(call => call.url)).toEqual([PRICE_PAGE_URL, PRICE_PAGE_URL])
  expect(await visible(ui)).toContain(word('prices.why.offline'))
  await ui.unmount()
})

for (const stored of [false, true]) test(`S16 unsupported HTTP adapter preserves ${stored ? 'previously fetched' : 'shipped dated'} other makers`, async ($, on) => {
  const f = fixture(on, { stored }), ui = await mount($, f)
  await ui.press({ key: 'coco:prices:others' }); await settle($, f, ui)
  const text = await visible(ui)
  expect(f.calls.map(call => call.url)).toEqual([PRICE_PAGE_URL])
  expect(text).toContain(word('prices.why.offline'))
  const shipped = JSON.parse(SHIPPED_PRICES_RAW)
  const source = stored ? word('prices.others.source', { time: new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit' }).format(new Date(f.old.fetchedAt)) }) : word('prices.source.shipped', { date: new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(shipped.asOf)) })
  expect(text).toContain(source)
  expect(text).toContain(shipped.others[0].models[0].name)
  expect(f.w.stored('prices.others')).toEqual(stored ? f.old : undefined)
  await ui.unmount()
})
