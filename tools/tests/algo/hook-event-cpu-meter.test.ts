import { test, expect } from 'bun:test'
import { hookEventCpuMeter, validateHookEventCpu } from '../hook-event-cpu-meter'

test('SDK event CPU meter preserves API receivers and Promise identity', async () => {
  let cpu = 0
  const namespace = { async start(input: unknown) { expect(this).toBe(namespace); cpu += 7; return input } }
  const pending = Promise.resolve({ same: true })
  const prompt = { submit() { expect(this).toBe(prompt); cpu += 2; return pending } }
  const meter = hookEventCpuMeter(() => cpu)
  const $ = meter.wrapEngine({ session: namespace, prompt })
  expect($.prompt.submit()).toBe(pending)
  await pending
  expect(await $.session.start({ id: 1 })).toEqual({ id: 1 })
  expect(meter.snapshot().events.map(row => [row.event, row.maxCpuMs])).toEqual([['prompt.submit', 2], ['session.start', 7]])
})

test('SDK event CPU meter attributes UI mount only to actual component render dispatch', async () => {
  let cpu = 0
  const meter = hookEventCpuMeter(() => cpu)
  const $ = meter.wrapEngine({ ui: { async mount(input: any) { cpu += input.component === 'Pane' ? 5 : 2; return { drawn() { return 'cached read' } } }, async render(input: any) { cpu += 3; return input.component } } })
  const mounted = await $.ui.mount({ component: 'Pane', surface: 'desktop' })
  expect(mounted.drawn()).toBe('cached read')
  await $.ui.mount({ component: 'AbovePrompt', surface: 'terminal' })
  await $.ui.render({ component: 'AbovePrompt', surface: 'desktop' })
  expect(meter.snapshot().events.map(row => [row.event, row.component, row.calls, row.maxCpuMs])).toEqual([
    ['ui.render', 'AbovePrompt', 2, 3], ['ui.render', 'Pane', 1, 5],
  ])
})

test('SDK streaming event CPU excludes CPU between async iterator pulls', async () => {
  let cpu = 0
  const meter = hookEventCpuMeter(() => cpu)
  const $ = meter.wrapEngine({ turn: { async *step() { cpu += 3; yield 'a'; cpu += 4; return 'end' } } })
  const stream = $.turn.step()
  expect(await stream.next()).toEqual({ value: 'a', done: false })
  cpu += 100
  expect(await stream.next()).toEqual({ value: 'end', done: true })
  expect(meter.snapshot().events[0].maxCpuMs).toBe(7)
})

test('SDK event CPU validation enforces event and component budgets plus inventory coverage', () => {
  let cpu = 0
  const meter = hookEventCpuMeter(() => cpu)
  const $ = meter.wrapEngine({ session: { start() { cpu += 30; return {} } }, ui: { render() { cpu += 8; return {} } } })
  $.session.start({}); $.ui.render({ component: 'Pane' })
  const coverage = { hooks: [
    { pattern: 'session.start', matcher: null, calls: 1 },
    { pattern: 'ui.render', matcher: { component: 'Pane' }, calls: 1 },
    { pattern: 'prompt.submit', matcher: null, calls: 1 },
  ] }
  expect(validateHookEventCpu(meter.snapshot(), coverage, { defaultMaxCpuMs: 50, byEvent: { 'session.start': 20 }, byComponent: { Pane: 5 } })).toEqual([
    'session.start: 30 CPU ms exceeds 20', 'ui.render component Pane: 8 CPU ms exceeds 5',
    'prompt.submit: no direct SDK event CPU measurement',
  ])
})
