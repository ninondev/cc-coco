import { test, expect } from 'claude-code/testing'
import type { Plugin } from 'claude-code/testing'
import { promiseWorld, drivePromiseEvents, PANE } from './promises-runtime-world'
import { PERSON, P } from './world'
import { BRIDGED_CPU_EVENTS } from './hook-event-cpu-meter'

const CLOSE: Plugin = { name: 'p1-hook-cpu-closer', register(on) {
  on('command.run', { command: 'p1-fixture-close' }, async $ => { await $.ui.close({ id: 'coco-book' }); return {} })
} }

test('P1 static hook declarations retain every event without claiming callback CPU', { plugins: [CLOSE] }, async ($, on) => {
  const f = promiseWorld(on, { companion: true })
  const measured = $
  await drivePromiseEvents(measured, f)
  await measured.command.run({ command: 'coco', args: 'settings', origin: PERSON, presentation: P })
  const settings = await measured.ui.mount({ surface: 'terminal', ...PANE })
  await measured.ui.press({ plugin: 'coco', requestId: 'coco-book', surface: 'terminal', key: 'coco:book:tab:settings' })
  await settings.unmount()
  for (const event of BRIDGED_CPU_EVENTS) {
    const bridge = JSON.parse((await measured.command.run({ command: 'p1-kit-hook-event-cpu:' + event, args: '' })).text ?? 'null')
    expect(bridge).toEqual({ marker: 'p1-kit-hook-event-cpu-bridge', event })
  }
  const result = JSON.parse((await $.command.run({ command: 'p1-kit-hook-cpu-receipt', args: '' })).text ?? 'null')
  expect(result?.marker, 'scratch runner must instrument shipping registration').toBe('p1-kit-hook-cpu')
  expect(result?.scope).toBe('static-registration-declarations')
  expect(Array.isArray(result?.registrations) && result.registrations.length > 0).toBe(true)
  console.log('P1_HOOK_STATIC_DECLARATIONS ' + JSON.stringify(result))
  expect(new Set(result.registrations.map((row: any) => row.registration)).size).toBe(result.registrations.length)
  for (const row of result.registrations) {
    expect(typeof row.pattern).toBe('string')
    expect(typeof row.source).toBe('string')
    expect(Number.isSafeInteger(row.line) && row.line > 0).toBe(true)
    expect(row.calls).toBeUndefined()
    expect(row.cpuMs).toBeUndefined()
  }
  const events = [...new Set(result.registrations.map((row: any) => row.pattern))].sort()
  for (const event of ['session.start', 'prompt.submit', 'tool.call', 'ui.render', 'turn.start', 'turn.step', 'turn.complete']) expect(events).toContain(event)
  expect(result.limitations).toContain('This source inventory retains matcher text but does not measure dynamic callback calls, filter coverage or CPU.')
})
