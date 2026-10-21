import { test, expect } from 'claude-code/testing'
import type { Plugin } from 'claude-code/testing'
import { cpuMilliseconds } from './process-cpu'

const CALIBRATION: Plugin = { name: 'p1-hook-event-cpu-calibration', register(on) {
  on('command.run', { command: 'p1-hook-event-cpu-baseline' }, () => ({ text: '0' }))
  on('command.run', { command: 'p1-hook-event-cpu-busy' }, () => {
    // A real hook callback computes a fixed amount of work. No worker clock,
    // elapsed deadline, IO, engine internals, or external process participates.
    let checksum = 0
    for (let index = 0; index < 5000000; index++) checksum = (checksum + Math.imul(index ^ checksum, 31)) | 0
    return { text: String(checksum) }
  })
} }

test('P1 SDK test realm CPU availability preserves explicit measurement gaps', { plugins: [CALIBRATION] }, async $ => {
  if (typeof (globalThis as any).process?.cpuUsage !== 'function') {
    const gap = { available: false, primitive: 'process.cpuUsage', scope: 'sdk-test-realm', reason: 'process is not defined; worker CPU is unmeasured by this clock' }
    console.log('P1_HOOK_EVENT_CPU_CALIBRATION_GAP ' + JSON.stringify(gap))
    expect(gap.available).toBe(false)
    expect((gap as any).cpuMs).toBeUndefined()
    return
  }
  const samples: { baselineCpuMs: number; busyCpuMs: number; addedCpuMs: number }[] = []
  // Warm the public SDK dispatch and plugin load before paired measurements.
  await $.command.run({ command: 'p1-hook-event-cpu-baseline', args: '' })
  await $.command.run({ command: 'p1-hook-event-cpu-busy', args: '' })
  for (let pair = 0; pair < 3; pair++) {
    let began = cpuMilliseconds()
    const baseline = await $.command.run({ command: 'p1-hook-event-cpu-baseline', args: '' })
    const baselineCpuMs = cpuMilliseconds() - began
    began = cpuMilliseconds()
    const busy = await $.command.run({ command: 'p1-hook-event-cpu-busy', args: '' })
    const busyCpuMs = cpuMilliseconds() - began
    expect(baseline.text).toBe('0')
    expect(typeof busy.text).toBe('string')
    samples.push({ baselineCpuMs, busyCpuMs, addedCpuMs: busyCpuMs - baselineCpuMs })
  }
  const sorted = samples.map(sample => sample.addedCpuMs).sort((a, b) => a - b)
  console.log('P1_HOOK_EVENT_CPU_CALIBRATION ' + JSON.stringify({ primitive: 'process.cpuUsage', scope: 'sdk-test-realm-process-inclusive-event-dispatch', work: { iterations: 5000000, pairs: 3 }, samples, medianAddedCpuMs: sorted[1] }))
  expect(samples.every(sample => Number.isFinite(sample.busyCpuMs) && sample.busyCpuMs > 0)).toBe(true)
  expect(sorted[1], 'test-realm process CPU must charge real worker hook compute before event budgets use this clock').toBeGreaterThan(10)
  expect(samples.filter(sample => sample.addedCpuMs > 10).length).toBeGreaterThanOrEqual(2)
})
