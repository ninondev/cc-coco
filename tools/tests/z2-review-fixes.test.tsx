// Exercise the review fixes through the shipping settings controls and persistence.

import { expect, test } from 'claude-code/testing'
import { MORNING, PERSON, RECENT, P, settleLegacyStart, world } from './world'
import { COST_WORDS_RAW, SHIPPED_PRICES_RAW } from './cost-words-fixture'
import { C3_WORDS_RAW } from './c3-words-fixture'
import { createWarmRuntime } from '../hooks/cost/warm-runtime'

const MODEL = 'claude-opus-5-5'
const START = { cwd: '/tmp/z2-fixtures', surface: 'terminal' as const, isInteractive: true }
const TOKENS = { input_tokens: 0, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 120000, model: MODEL }
const complete = (turnId: string) => ({ turnId, answer: 'done', reason: 'answer' as const, durationMs: 1000, isAborted: false, usage: TOKENS })
async function step($: unknown, turnId: string) {
  for await (const _ of (($ as any).turn.step({ turnId, index: 0, model: MODEL, messageCount: 1 }))) {}
}
const PANE = { surface: 'terminal', plugin: 'coco', component: 'Pane', requestId: 'coco-book', props: { title: 'Coco', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } } as const

function fixture(on: Parameters<typeof world>[0]) {
  return world(on, {
    observeStore: true,
    store: { ...RECENT, firstMet: MORNING, stamps: { met: MORNING }, bandSettings: { marks: 'off' }, 'cost.features': { dayCapUsd: 1, costFolders: true } },
    sessionId:'z2-review-fixture', sessionRoot: START.cwd, surfaces: ['terminal'], percent: 60,
    cost: 1, startedAt: MORNING,
    limits: [{ kind: 'five_hour', percentUsed: 40, resetsAt: new Date(MORNING + 5 * 3600000).toISOString() }],
    settings: { promptCacheTtl: '5m', prefersReducedMotion: true },
    env: { HOME: '/tmp/z2-fixture-home', LANG: 'en_US.UTF-8', TERM: 'xterm-256color', FORCE_PROMPT_CACHING_5M: '1' },
    readText: path => path.endsWith('cost-text.json') ? COST_WORDS_RAW : path.endsWith('prices.json') ? SHIPPED_PRICES_RAW : path.endsWith('c3-text.json') ? C3_WORDS_RAW : undefined,
  })
}

test('Z2 MC1 switching warm on retires the shared row, so a More save cannot leak it back on', async ($, on) => {
  const w = fixture(on)
  await $.session.start(START); await settleLegacyStart($, w)
  await $.command.run({ command: 'coco', args: 'settings', origin: PERSON, presentation: P })
  const ui = await $.ui.mount(PANE)
  // The row asks once first: ask, then on.
  await ui.press({ key: 'coco:set:warm:ask' })
  await ui.press({ key: 'coco:set:warm:on' })
  // The per-session choice writes this chat's row and retires the shared row to false.
  expect((w.stored('more') as Record<string, unknown> | undefined)?.warm).toBe(false)
  expect((w.stored('warm.sessions') as { on: Record<string, unknown> }).on['z2-review-fixture']).toEqual({ on: true, at: expect.any(Number) })
  await ui.redraw()
  expect(await ui.find({key:'coco:warm:alloff'})).toBeDefined()
  await ui.press({key:'coco:more:lively:on'})
  let forks=0,timers=0
  const untouched=createWarmRuntime({clock:{now:()=>MORNING,after:()=>{timers++;return()=>{}}},store:{get:async key=>w.stored(key),set:async(key,value)=>$.store.set(key,value as never),keys:async()=>w.storedEntries().map(([key])=>key)},sessionId:()=> 'z2-untouched-chat',isNewest:()=>true,readLock:async()=> 'unlocked',windowPercent:()=>40,billingKind:()=> 'plan',fork:async()=>{forks++;return{ok:false}}})
  await untouched.syncEnabled()
  expect(untouched.isEnabled()).toBe(false)
  expect(await untouched.arm({sentAt:MORNING,prefix:120000,ttl:'5m',prices:{input:4,write5m:5,write1h:8,read:0.2,output:20},observed:true,interactive:true,cronWithinTtl:false,heldOff:false})).toEqual({armed:false,why:'off'})
  await ui.press({key:'coco:warm:alloff'})
  await ui.press({key:'coco:more:lively:off'})
  expect((w.stored('more') as Record<string,unknown>).warm).toBe(false)
  await untouched.syncEnabled()
  expect(untouched.isEnabled()).toBe(false)
  expect(w.view().cost?.warmEnabled).toBe(false)
  expect(forks).toBe(0);expect(timers).toBe(0)
  await untouched.close();await ui.unmount()
})

for(const surface of ['terminal','desktop','vscode','mobile'] as const)test(`Z2 MC2 ${surface} saves the TODO threshold from its visible button`,async($,on)=>{
 const w=fixture(on)
 await $.session.start(START);await settleLegacyStart($,w)
 await $.command.run({command:'coco',args:'settings',origin:PERSON,presentation:P})
 const ui=await $.ui.mount({...PANE,surface})
 const enabledCount=async()=>Number((await ui.findAll({type:'Text'})).map(n=>n.text??'').join('\n').match(/Switches on: (\d+) of \d+/)?.[1])
 const before=await enabledCount()
 expect(Number.isFinite(before)).toBe(true)
 await ui.press({key:'coco:todo:pile:5'});await ui.redraw()
 expect(w.stored('c3.todoPile')).toBe(5)
 expect((await ui.find({key:'coco:todo:pile:5'}))?.props.variant).toBe('primary')
 expect(await enabledCount()).toBe(before+1)
 await ui.press({key:'coco:todo:pile:off'});await ui.redraw()
 expect(w.stored('c3.todoPile')).toBe(0)
 expect(await enabledCount()).toBe(before)
 expect((await ui.find({key:'coco:todo:pile:off'}))?.props.variant).toBe('primary')
 await ui.unmount()
})

// Review MC5: the cost features' turn blocks run AFTER the turn's own figures land, so the
// folder record carries this turn's dollars and the day cap speaks on the turn that crossed it.
test('Z2 MC5 folder spend and the day cap read this turn, not the previous one', async ($, on) => {
  const w = fixture(on)
  await $.session.start(START); await settleLegacyStart($, w)
  await $.command.run({command:'coco',args:'band off',origin:PERSON,presentation:P})
  const spend = [1.42, 1.7, 2.05]
  let after: number | undefined
  const run = async (index: number) => {
    await ($.prompt.submit as (i: unknown) => Promise<unknown>)({ text: 'go ' + index, origin: PERSON })
    await ($.turn.start as (i: unknown) => Promise<unknown>)({ text: 'go ' + index, turnId: 't' + index })
    // The turn's own spend lands while it runs, after its start read the baseline.
    ;((w as unknown as { cost: number }).cost = spend[index]!)
    await step($, 't' + index)
    await ($.turn.complete as (i: unknown) => Promise<unknown>)(complete('t' + index))
    const record = w.stored('cost.folders') as Record<string, { days: Record<string, number> }> | undefined
    const row = record && Object.values(record)[0]
    const total = row ? Object.values(row.days).reduce((sum, value) => sum + value, 0) : 0
    return total
  }
  const one = await run(0)
  expect(one).toBeGreaterThan(0)
  const two = await run(1)
  expect(two).toBeGreaterThan(one)  // a turn late, this stayed at `one`
  const three = await run(2)
  expect(three).toBeGreaterThan(two)  // the last turn's dollars were never lost
  expect(w.toasts).toContain('Today has reached $1.05 at API rates, past your $1.00 cap')
})
