import { test, expect } from 'bun:test'
import { hookCpuMeter, validateHookCpuReceipt } from '../hook-cpu-meter'

test('hook CPU meter keeps registration filters, receiver, values and ordering', () => {
  let cpu = 0
  const registrations: any[][] = [], catchHandlers: Function[] = []
  const receiver = { name: 'on receiver' }
  const original = function(this: unknown, ...args: any[]) {
    expect(this).toBe(receiver); registrations.push(args)
    return { catch(handler: Function) { catchHandlers.push(handler) } }
  }
  const meter = hookCpuMeter(() => cpu)
  const on = meter.wrapOn(original as any)
  const matcher = { component: ['Pane', 'AbovePrompt'], key: /^view$/ }
  const hookReceiver = { name: 'hook receiver' }
  const result = { value: 'unchanged' }
  const registered = on.call(receiver, 'ui.render', matcher, function(this: unknown) {
    expect(this).toBe(hookReceiver); cpu += 4; return result
  })
  registered.catch(function(this: unknown) { expect(this).toBe(hookReceiver); cpu += 2; return result })
  expect(registrations[0][1]).toBe(matcher)
  expect(registrations[0][2].call(hookReceiver, {}, { component: 'Pane' }, { event: 'ui.render' })).toBe(result)
  expect(catchHandlers[0].call(hookReceiver, {}, {}, { event: 'ui.render' })).toBe(result)
  const receipt = meter.snapshot()
  expect(receipt.hooks[0].pattern).toBe('ui.render')
  expect(receipt.hooks[0].matcher).toEqual({ component: ['Pane', 'AbovePrompt'], key: { regexp: '^view$', flags: '' } })
  expect(receipt.hooks[0].calls).toBe(2)
  expect(receipt.hooks[0].maxCpuMs).toBe(4)
  expect(receipt.hooks[0].components).toEqual(['Pane'])
})

test('hook CPU meter preserves pending Promise identity and records real CPU through settlement', async () => {
  let cpu = 10
  let hook: Function = () => {}
  const meter = hookCpuMeter(() => cpu)
  const on = meter.wrapOn(((_name: string, callback: Function) => { hook = callback; return { catch() {} } }) as any)
  let resolve!: (value: unknown) => void
  const pending = new Promise(resolvePromise => { resolve = resolvePromise })
  on('prompt.submit', () => pending)
  expect(hook({}, {}, { event: 'prompt.submit' })).toBe(pending)
  expect(meter.snapshot().hooks[0].pending).toBe(1)
  cpu += 7; resolve({ value: 'same' }); await pending
  expect(meter.snapshot().hooks[0].maxCpuMs).toBe(7)
  expect(meter.snapshot().scope).toBe('hook-worker-process-inclusive')
  expect(meter.snapshot().limitations).toContain('CPU includes lower hooks, awaited host work, and concurrent work in the same worker process.')
})

test('hook CPU meter preserves async iterator pull receiver and order, excluding idle between pulls', async () => {
  let cpu = 0
  let hook: Function = () => {}
  const meter = hookCpuMeter(() => cpu)
  const on = meter.wrapOn(((_name: string, callback: Function) => { hook = callback; return { catch() {} } }) as any)
  on('turn.step', async function* () { cpu += 3; yield { text: 'a' }; cpu += 5; yield { text: 'b' }; return { text: 'done' } })
  const iterator = hook({}, {}, { event: 'turn.step' })
  expect(await iterator.next()).toEqual({ value: { text: 'a' }, done: false })
  cpu += 100
  expect(await iterator.next()).toEqual({ value: { text: 'b' }, done: false })
  expect(await iterator.next()).toEqual({ value: { text: 'done' }, done: true })
  expect(meter.snapshot().hooks[0].maxCpuMs).toBe(8)
  expect(meter.snapshot().hooks[0].calls).toBe(1)
  expect(meter.snapshot().hooks[0].pending).toBe(0)
})

test('hook CPU receipt rejects missing clocks, uncovered filters and budget regressions', () => {
  const registrations: Function[] = []
  const meter = hookCpuMeter(() => undefined)
  const on = meter.wrapOn(((_name: string, _matcher: unknown, hook: Function) => { registrations.push(hook); return { catch() {} } }) as any)
  on('ui.render', { component: 'Pane' }, () => ({ value: null }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ value: null }))
  registrations[0]({}, { component: 'Pane' }, { event: 'ui.render' })
  expect(validateHookCpuReceipt(meter.snapshot(), { defaultMaxCpuMs: 20 })).toEqual([
    'registration 0 ui.render: CPU primitive unavailable',
    'registration 1 ui.render: no dispatched calls',
  ])
  let cpu = 0
  let measuredHook: Function = () => {}
  const busyMeter = hookCpuMeter(() => cpu)
  const availableOn = busyMeter.wrapOn(((_name: string, _matcher: unknown, hook: Function) => { measuredHook = hook; return { catch() {} } }) as any)
  availableOn('ui.render', { component: 'Pane' }, () => { cpu += 21; return { value: null } })
  measuredHook({}, { component: 'Pane' }, { event: 'ui.render' })
  const busy = busyMeter.snapshot()
  expect(validateHookCpuReceipt(busy, { defaultMaxCpuMs: 20 })).toEqual(['registration 0 ui.render: 21 CPU ms exceeds 20'])
})

test('hook CPU meter catches a real callback CPU busy loop', () => {
  let hook: Function = () => {}
  const meter = hookCpuMeter(() => { const cpu = process.cpuUsage(); return (cpu.user + cpu.system) / 1000 })
  const on = meter.wrapOn(((_name: string, callback: Function) => { hook = callback; return { catch() {} } }) as any)
  on('session.start', () => {
    const start = process.cpuUsage()
    while (true) { const spent = process.cpuUsage(start); if ((spent.user + spent.system) / 1000 >= 3) break }
    return { value: null }
  })
  hook({}, {}, { event: 'session.start' })
  expect(validateHookCpuReceipt(meter.snapshot(), { defaultMaxCpuMs: 1 }).length).toBe(1)
  expect(meter.snapshot().hooks[0].maxCpuMs).toBeGreaterThanOrEqual(3)
})
