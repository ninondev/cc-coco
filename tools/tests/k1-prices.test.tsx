import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { ShippedPrices } from '../hooks/cost/prices/load'
import { OTHERS_URL, PRICE_PAGE_URL } from '../hooks/cost/prices/load'
import { COST_WORDS_RAW, SHIPPED_PRICES_RAW } from './cost-words-fixture'
import { C3_WORDS_RAW } from './c3-words-fixture'
import { MORNING, PERSON, P, RECENT, settleLegacyStart, world } from './world'
import { WINDOWS_ROOTS } from './test-system'

const SHIPPED = JSON.parse(SHIPPED_PRICES_RAW) as ShippedPrices
const WORDS = JSON.parse(COST_WORDS_RAW) as Record<string, Record<string, string>>
function costWord(lang: string, key: string, values: Record<string, string | number> = {}): string {
  const template = WORDS[key]?.[lang]
  if (!template) throw Error(`missing approved expected word: ${key}.${lang}`)
  return template.replace(/\{(\w+)\}/g, (_match, slot: string) => String(values[slot] ?? `{${slot}}`))
}
// Twenty days on: past the shipped table's day (10-21), so a table kept from an hour ago is newer than it.
const DAYS = 20
const NOW = MORNING + DAYS * 86400000
const START = { cwd: WINDOWS_ROOTS ? 'C:\\Users\\windows\\k1-prices' : '/tmp/k1-prices', surface: 'vscode' as const, isInteractive: true }
const PANE = { plugin: 'coco', component: 'Pane' as const, requestId: 'coco-book', props: { title: 'Coco', isFocused: true, bodyColumns: 42, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 24 }, view: {} } }
const OK = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
const FRESH_ROWS = SHIPPED.rows.map(row => row.id === 'claude-opus-5-5' ? { ...row, input: 6, write5m: 7.5, write1h: 12, read: .3, output: 30 } : row)
// Public response fixture, with the production parser's full table shape and families.
const pageRow = (name: string, p: { input: number; write5m: number; write1h: number; read: number; output: number }) => `| ${name} | ${[p.input, p.write5m, p.write1h, p.read, p.output].map(n => `$${n}/MTok`).join(' | ')} |`
const PAGE = ['## Model pricing', '| Model | Input | 5m writes | 1h writes | Cache hits | Output |', '| --- | --- | --- | --- | --- | --- |', ...FRESH_ROWS.flatMap(row => [pageRow(row.over ? `${row.name} (up to 100K tokens)` : row.name, row), ...(row.over ? [pageRow(`${row.name} (over 100K tokens)`, row.over)] : [])])].join('\n')
// The daily other makers' list (readOthersList), made two hours before the press.
const LIST_MADE = NOW - 7200000
const OTHER_PAGE = JSON.stringify({ version: 1, generatedAt: new Date(LIST_MADE).toISOString(), source: 'fixture', makers: [{ maker: 'openai', label: 'OpenAI', models: [{ name: 'gpt-6.2-fixture', input: 3, read: .3, output: 15 }] }] })
type Mode = 'online' | 'offline' | 'changed' | 'pending'
function fixture(on: On, options: { mode?: Mode; disabled?: string; deny?: string[]; stored?: boolean } = {}) {
  const requests: { url: string; init: unknown }[] = [], delays: number[] = [], sources: (string | undefined)[] = []
  let release: (() => void) | undefined
  on('settings.*', ($, e, next) => {
    if (next.is('settings.read', e)) {
      sources.push(e.source)
      if (e.source === 'policy') return { value: { permissions: { deny: options.deny ?? [] } } } as never
    }
    return next(e)
  })
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('clock.*', ($, e, next) => { if (next.is('clock.after', e)) delays.push(e.ms); return next(e) })
  on('http.fetch', async ($, e) => {
    requests.push({ url: e.url, init: e.init })
    if (options.mode === 'offline') throw Error('fixture offline')
    if (options.mode === 'pending') await new Promise<void>(resolve => { release = resolve })
    return { value: { ok: true, status: 200, headers: {}, text: options.mode === 'changed' ? 'unrecognizable public page' : e.url === PRICE_PAGE_URL ? PAGE : OTHER_PAGE } }
  })
  on('process.run', ($, e) => {
    if (e.argv[1]?.endsWith('algo-worker.mjs')) {
      const request = JSON.parse(e.init?.stdin ?? '{}')
      const result = request.op === 'pace' ? { projections: [], hot: { state: { hot: {} }, hot: [] } } : request.op === 'repeat' ? null : {}
      return { value: { ...OK, stdout: JSON.stringify({ ok: true, result }) } }
    }
    return { value: OK }
  })
  const old = { fetchedAt: NOW - 3600000, rows: SHIPPED.rows }
  const w = world(on, {
    observeStore: true,
    store: { ...RECENT, firstMet: MORNING, lang: 'en', bandSettings: { lang: 'en', motion: 'still', marks: 'off' }, ...(options.stored ? { 'prices.claude': old, 'prices.others': { fetchedAt: old.fetchedAt, rows: SHIPPED.others } } : {}) },
    sessionRoot: START.cwd, sessionId: 'k1-prices-fixture', surfaces: ['vscode'],
    settings: { prefersReducedMotion: true },
    env: { HOME: '/tmp/k1-prices-home', LANG: 'en_US.UTF-8', TERM: 'xterm-256color', ...(options.disabled === undefined ? {} : { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: options.disabled }) },
    readText: path => path.endsWith('cost-text.json') ? COST_WORDS_RAW : path.endsWith('prices.json') ? SHIPPED_PRICES_RAW : path.endsWith('c3-text.json') ? C3_WORDS_RAW : undefined,
  })
  return { w, requests, delays, sources, old, release: () => release?.() }
}
async function mount($: any, f: ReturnType<typeof fixture>) {
  await f.w.clock.advance(DAYS * 86400000)
  await $.session.start(START); await settleLegacyStart($, f.w)
  expect(f.requests).toEqual([])
  await $.command.run({ command: 'coco', args: 'usage', origin: PERSON, presentation: P })
  const ui = await $.ui.mount({ surface: 'vscode', ...PANE })
  await ui.redraw(); await ui.redraw()
  expect(f.requests).toEqual([])
  expect(await ui.find({ type: 'Button', key: 'coco:prices:open' })).toBeDefined()
  return ui
}
async function settle($: any, f: ReturnType<typeof fixture>, ui: any) {
  await settleLegacyStart($, f.w); await ui.redraw()
}
async function visible(ui: any): Promise<string> {
  return (await ui.findAll({ type: 'Text' })).map((node: any) => String(node.text)).join('\n')
}

test('K1 mounted Prices fetches only on opening, uses a default GET, and loads other makers only on unfolding', async ($, on) => {
  const f = fixture(on), ui = await mount($, f)
  await ui.press({ key: 'coco:prices:open' }); await settle($, f, ui)
  expect(f.requests).toEqual([{ url: PRICE_PAGE_URL, init: undefined }])
  expect(f.sources).toContain('policy')
  expect(f.delays).toContain(6000)
  expect(await visible(ui)).toContain(costWord('en', 'prices.thisChat'))
  expect(await visible(ui)).toContain(costWord('en', 'prices.narrow.inout', { in: '6', out: '30' }))
  expect(await visible(ui)).not.toContain('gpt-6.1-sol')
  for (let i = 0; i < 3; i++) await ui.redraw()
  expect(await visible(ui)).toContain(costWord('en', 'prices.about'))
  expect(await ui.find({ type: 'Button', key: 'coco:prices:about' })).toBeUndefined()
  expect(await visible(ui)).toContain(costWord('en', 'prices.tier.haiku'))
  await ui.press({ key: 'coco:prices:older' }); await ui.redraw()
  expect(f.requests.length).toBe(1)
  expect((f.w.stored('prices.claude') as { rows: unknown[] }).rows).toEqual(FRESH_ROWS.map(row => ({ ...row, status: 'current' })))
  await ui.press({ key: 'coco:prices:others' }); await settle($, f, ui)
  // The small daily list, as a default GET; it shows with the day it was made and is kept.
  expect(f.requests).toEqual([{ url: PRICE_PAGE_URL, init: undefined }, { url: OTHERS_URL, init: undefined }])
  expect(await visible(ui)).toContain('gpt-6.2-fixture')
  expect(await visible(ui)).toContain(costWord('en', 'prices.others.source', { time: new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(LIST_MADE)) }))
  expect(await visible(ui)).not.toContain(costWord('en', 'prices.why.offline'))
  expect((f.w.stored('prices.others') as { fetchedAt: number }).fetchedAt).toBe(LIST_MADE)
  for (let i = 0; i < 3; i++) { await ui.press({ key: 'coco:prices:others' }); await ui.redraw() }
  expect(f.requests.length).toBe(2)
  await ui.press({ key: 'coco:prices:back' }); await ui.redraw()
  expect(await ui.find({ type: 'Button', key: 'coco:prices:open' })).toBeDefined()
  await ui.press({ key: 'coco:prices:open' }); await settle($, f, ui)
  expect(f.requests.map(request => request.url)).toEqual([PRICE_PAGE_URL, OTHERS_URL, PRICE_PAGE_URL])
  // Prices occupies the subpage body; its only navigation button is Back.
  // The real book command can still change the page while this subpage is open.
  await $.command.run({ command: 'coco', args: 'log', origin: PERSON, presentation: P }); await settle($, f, ui)
  expect(await ui.find({ type: 'Button', key: 'coco:book:tab:offerings' })).toBeDefined()
  await ui.press({ key: 'coco:book:tab:offerings' }); await settle($, f, ui)
  expect(f.requests.length).toBe(3)
  await ui.press({ key: 'coco:prices:open' }); await settle($, f, ui)
  expect(f.requests.length).toBe(4)
  await ui.unmount()
})

for (const mode of ['offline', 'changed'] as const) for (const stored of [false, true]) test(`K1 mounted Prices ${mode} keeps ${stored ? 'last fetched' : 'shipped dated'} table`, async ($, on) => {
  const f = fixture(on, { mode, stored }), ui = await mount($, f)
  await ui.press({ key: 'coco:prices:open' }); await settle($, f, ui)
  const text = await visible(ui)
  expect(f.requests).toEqual([{ url: PRICE_PAGE_URL, init: undefined }])
  expect(text).toContain(costWord('en', `prices.why.${mode}`))
  expect(text).toContain(costWord('en', 'prices.narrow.inout', { in: '4', out: '20' }))
  expect(text).toContain(stored ? costWord('en', 'prices.source.fetched', { time: new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit' }).format(new Date(f.old.fetchedAt)) }) : costWord('en', 'prices.source.shipped', { date: new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(SHIPPED.asOf)) }))
  expect(f.w.stored('prices.claude')).toEqual(stored ? f.old : undefined)
  await ui.redraw(); expect(f.requests.length).toBe(1)
  await ui.unmount()
})

for (const blocked of ['nonessential', 'policy'] as const) test(`K1 mounted Prices ${blocked} denial makes no requests and retains both old tables`, async ($, on) => {
  const f = fixture(on, { stored: true, ...(blocked === 'nonessential' ? { disabled: '1' } : { deny: ['WebFetch(*)'] }) }), ui = await mount($, f)
  await ui.press({ key: 'coco:prices:open' }); await settle($, f, ui)
  expect(await visible(ui)).toContain(costWord('en', 'prices.why.off'))
  expect(await visible(ui)).toContain(costWord('en', 'prices.narrow.inout', { in: '4', out: '20' }))
  await ui.press({ key: 'coco:prices:others' }); await settle($, f, ui)
  expect(await visible(ui)).toContain('gpt-6.1-sol')
  expect(f.requests).toEqual([])
  expect(f.delays.filter(ms => ms === 6000)).toEqual([])
  expect(f.w.stored('prices.claude')).toEqual(f.old)
  await ui.unmount()
})

test('K1 mounted Prices domain denial of the Claude page still loads the other makers\' list', async ($, on) => {
  const f = fixture(on, { deny: ['WebFetch(domain:platform.claude.com)'] }), ui = await mount($, f)
  await ui.press({ key: 'coco:prices:open' }); await settle($, f, ui)
  expect(f.requests).toEqual([])
  expect(await visible(ui)).toContain(costWord('en', 'prices.why.off'))
  await ui.press({ key: 'coco:prices:others' }); await settle($, f, ui)
  expect(f.requests).toEqual([{ url: OTHERS_URL, init: undefined }])
  expect(await visible(ui)).toContain('gpt-6.2-fixture')
  await ui.unmount()
})

test('K1 mounted Prices pending fetch times out at six seconds without blocking the first frame', async ($, on) => {
  const f = fixture(on, { mode: 'pending' }), ui = await mount($, f)
  await ui.press({ key: 'coco:prices:open' }); await settle($, f, ui)
  expect(await visible(ui)).toContain(costWord('en', 'prices.checking'))
  expect(f.requests).toEqual([{ url: PRICE_PAGE_URL, init: undefined }])
  await f.w.clock.advance(5999); await ui.redraw()
  expect(await visible(ui)).toContain(costWord('en', 'prices.checking'))
  await f.w.clock.advance(1); await settle($, f, ui)
  expect(await visible(ui)).toContain(costWord('en', 'prices.why.offline'))
  expect(await visible(ui)).not.toContain(costWord('en', 'prices.checking'))
  f.release(); await settle($, f, ui)
  expect(f.w.stored('prices.claude')).toBeUndefined()
  expect(f.requests.length).toBe(1)
  await ui.unmount()
})
