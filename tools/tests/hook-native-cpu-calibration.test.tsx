import { test, expect } from 'claude-code/testing'
import type { Plugin } from 'claude-code/testing'
import { NATIVE_HOOK_CPU } from './native-hook-config'

const NATIVE: Plugin = { name: 'p1-native-hook-cpu-calibration', register(on) {
  on('command.run', { command: 'p1-native-hook-cpu-observe' }, async ($, e) => {
    const config = JSON.parse(e.args)
    try {
      const result = await $.process.run([config.python, config.helper, '--pid-file', config.pidFile])
      if (result.exitCode !== 0) throw Error('native owned-engine CPU observer failed: ' + result.stderr)
      return { text: result.stdout }
    } catch (error) { return { text: JSON.stringify({ marker: 'p1-native-hook-cpu-gap', available: false, reason: String(error) }) } }
  })
  on('command.run', { command: 'p1-native-hook-cpu-baseline' }, () => ({ text: 'baseline' }))
  on('command.run', { command: 'p1-native-hook-cpu-busy' }, () => {
    let checksum = 0
    for (let index = 0; index < 5000000; index++) checksum = (checksum + Math.imul(index ^ checksum, 31)) | 0
    return { text: 'busy:' + checksum }
  })
} }

test('P1 kit native CPU observer availability reports unsupported host calls', { plugins: [NATIVE] }, async $ => {
  const availability = JSON.parse((await $.command.run({ command: 'p1-native-hook-cpu-observe', args: JSON.stringify(NATIVE_HOOK_CPU) })).text ?? 'null')
  if (availability.marker === 'p1-native-hook-cpu-gap') {
    console.log('P1_NATIVE_HOOK_CPU_GAP ' + JSON.stringify(availability))
    expect(availability.available).toBe(false)
    expect(availability.reason).toContain('no implementation for process.run')
    expect(availability.cpuMs).toBeUndefined()
    return
  }
  const snapshot = async () => {
    const result = JSON.parse((await $.command.run({ command: 'p1-native-hook-cpu-observe', args: JSON.stringify(NATIVE_HOOK_CPU) })).text ?? 'null')
    expect(result.marker).toBe('p1-native-hook-cpu')
    expect(result.primitive).toBe('Darwin.proc_pid_rusage.RUSAGE_INFO_V2')
    expect(result.scope).toBe('owned-engine-tree-inclusive')
    expect(Number.isFinite(result.cpuMs) && result.cpuMs > 0).toBe(true)
    expect(Array.isArray(result.processes) && result.processes.length > 0).toBe(true)
    return result
  }
  const delta = (before: any, after: any) => {
    expect(after.enginePid).toBe(before.enginePid)
    expect(after.engineStartAbstime).toBe(before.engineStartAbstime)
    expect(after.cpuMs >= before.cpuMs, 'native cumulative owned-tree CPU must not regress').toBe(true)
    return after.cpuMs - before.cpuMs
  }
  await $.command.run({ command: 'p1-native-hook-cpu-baseline', args: '' })
  await $.command.run({ command: 'p1-native-hook-cpu-busy', args: '' })
  const samples: { baselineCpuMs: number; busyCpuMs: number; addedCpuMs: number; rootAddedCpuMs: number }[] = []
  for (let pair = 0; pair < 3; pair++) {
    let before = await snapshot()
    expect((await $.command.run({ command: 'p1-native-hook-cpu-baseline', args: '' })).text).toBe('baseline')
    let after = await snapshot()
    const baselineCpuMs = delta(before, after), rootBaselineCpuMs = after.rootCpuMs - before.rootCpuMs
    before = await snapshot()
    expect((await $.command.run({ command: 'p1-native-hook-cpu-busy', args: '' })).text).toContain('busy:')
    after = await snapshot()
    const busyCpuMs = delta(before, after), rootBusyCpuMs = after.rootCpuMs - before.rootCpuMs
    samples.push({ baselineCpuMs, busyCpuMs, addedCpuMs: busyCpuMs - baselineCpuMs, rootAddedCpuMs: rootBusyCpuMs - rootBaselineCpuMs })
  }
  const added = samples.map(sample => sample.addedCpuMs).sort((a, b) => a - b)
  console.log('P1_NATIVE_HOOK_CPU_CALIBRATION ' + JSON.stringify({ primitive: 'Darwin.proc_pid_rusage.RUSAGE_INFO_V2', scope: 'owned-engine-tree-inclusive', work: { iterations: 5000000, pairs: 3 }, samples, medianAddedCpuMs: added[1] }))
  expect(added[1], 'native engine tree CPU must charge actual worker hook compute before event budgets use this primitive').toBeGreaterThan(10)
  expect(samples.filter(sample => sample.addedCpuMs > 10).length).toBeGreaterThanOrEqual(2)
})
