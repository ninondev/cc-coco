import { test, expect } from 'claude-code/testing'
import type { Plugin } from 'claude-code/testing'

const CPU_PROBE: Plugin = { name: 'p1-hook-cpu-primitive', register(on) {
  on('command.run', { command: 'p1-hook-cpu-primitive' }, () => {
    const process = (globalThis as any).process
    if (typeof process?.cpuUsage !== 'function') return { text: JSON.stringify({ available: false, primitive: 'process.cpuUsage', scope: 'hook-worker' }) }
    try {
      const before = process.cpuUsage()
      let checksum = 0
      for (let index = 0; index < 100000; index++) checksum = (checksum + Math.imul(index, 31)) | 0
      const after = process.cpuUsage()
      return { text: JSON.stringify({ available: true, primitive: 'process.cpuUsage', scope: 'hook-worker-process', cpuMs: (after.user + after.system - before.user - before.system) / 1000, checksum }) }
    } catch (error) { return { text: JSON.stringify({ available: false, primitive: 'process.cpuUsage', scope: 'hook-worker', error: String(error) }) } }
  })
} }

test('P1 hook worker CPU primitive availability reports measurement gaps', { plugins: [CPU_PROBE] }, async $ => {
  const result = JSON.parse((await $.command.run({ command: 'p1-hook-cpu-primitive', args: '' })).text ?? 'null')
  console.log('P1_HOOK_CPU_PRIMITIVE ' + JSON.stringify(result))
  expect(typeof result?.available).toBe('boolean')
  expect(result?.primitive).toBe('process.cpuUsage')
  if (result.available) {
    expect(typeof result.cpuMs).toBe('number')
    expect(Number.isFinite(result.cpuMs) && result.cpuMs > 0).toBe(true)
  } else {
    expect(result.scope).toBe('hook-worker')
    expect(result.cpuMs).toBeUndefined()
    console.log('P1_HOOK_CPU_GAP ' + JSON.stringify({ primitive: result.primitive, reason: 'unavailable in hook worker; no CPU measurement and no elapsed-clock substitution' }))
  }
})
