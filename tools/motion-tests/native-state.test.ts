import { expect, test } from 'bun:test'
import { stateProgram, stateProgramName } from '../../plugin/hooks/native-state'

function host(root = '/plugin', env: Record<string, string> = {}, mac = false) {
  const files = new Set<string>(mac ? ['/System/Library/CoreServices/SystemVersion.plist', root + '/bin/coco-state-macos-aarch64', root + '/bin/coco-state-macos-x86_64'] : [])
  const runs: string[][] = []
  let result = { exitCode: 0, stdout: 'Linux x86_64\n', isStdoutTruncated: false }
  const value = {
    plugin: { root }, env: { get: async (key: string) => env[key] },
    fs: { exists: async (path: string) => files.has(path) },
    process: { run: async (argv: string[]) => { runs.push(argv); return result } },
  } as unknown as Parameters<typeof stateProgram>[0]
  return { value, files, runs, result: (next: typeof result) => { result = next } }
}

test('six supported platform/ABI names and unsupported ABIs select only fixed filenames', () => {
  for (const arch of ['aarch64', 'x86_64']) {
    expect(stateProgramName('darwin', arch)).toBe('coco-state')
    expect(stateProgramName('linux', arch)).toBe('coco-state-linux-' + arch)
    expect(stateProgramName('windows', arch)).toBe('coco-state-windows-' + arch + '.exe')
  }
  expect(stateProgramName('windows', 'AMD64')).toBe('coco-state-windows-x86_64.exe')
  expect(stateProgramName('windows', 'ARM64')).toBe('coco-state-windows-aarch64.exe')
  for (const arch of ['', 'i386', 'armv7', '../other']) expect(stateProgramName('linux', arch)).toBeUndefined()
  expect(stateProgramName('freebsd', 'x86_64')).toBeUndefined()
})

test('macOS selection uses the launcher, rechecks absence, and never probes a child', async () => {
  const h = host('/plugin', {}, true)
  expect(await stateProgram(h.value)).toBeUndefined()
  h.files.add('/plugin/bin/coco-state')
  expect(await stateProgram(h.value)).toBe('/plugin/bin/coco-state')
  h.files.delete('/plugin/bin/coco-state')
  expect(await stateProgram(h.value)).toBeUndefined()
  expect(h.runs).toEqual([])
})

test('missing Linux binaries skip without a probe and retry a later available bundle', async () => {
  const h = host()
  expect(await stateProgram(h.value)).toBeUndefined()
  expect(h.runs).toEqual([])
  h.files.add('/plugin/bin/coco-state-linux-x86_64')
  expect(await stateProgram(h.value)).toBe('/plugin/bin/coco-state-linux-x86_64')
  expect(h.runs).toEqual([['/usr/bin/uname', '-sm']])
})

test('an incomplete Mac architecture package skips without executing its launcher', async () => {
  const h = host('/plugin', {}, true); h.files.add('/plugin/bin/coco-state')
  h.files.delete('/plugin/bin/coco-state-macos-x86_64')
  expect(await stateProgram(h.value)).toBeUndefined()
  h.files.add('/plugin/bin/coco-state-macos-x86_64')
  expect(await stateProgram(h.value)).toBe('/plugin/bin/coco-state')
  expect(h.runs).toEqual([])
})

test('Linux selection coalesces concurrent probes and rejects the other installed ABI', async () => {
  const h = host()
  h.files.add('/plugin/bin/coco-state-linux-aarch64')
  expect(await Promise.all([stateProgram(h.value), stateProgram(h.value)])).toEqual([undefined, undefined])
  expect(h.runs).toEqual([['/usr/bin/uname', '-sm']])
})

test('failed, truncated, and unsupported OS probes safely skip', async () => {
  for (const result of [
    { exitCode: 1, stdout: 'Linux x86_64', isStdoutTruncated: false },
    { exitCode: 0, stdout: 'Linux x86_64', isStdoutTruncated: true },
    { exitCode: 0, stdout: 'FreeBSD x86_64', isStdoutTruncated: false },
    { exitCode: 0, stdout: 'Linux armv7', isStdoutTruncated: false },
  ]) {
    const h = host(); h.files.add('/plugin/bin/coco-state-linux-x86_64'); h.result(result)
    expect(await stateProgram(h.value)).toBeUndefined()
  }
})

test('both Windows ABIs safely skip a missing binary and run no POSIX probe', async () => {
  for (const [arch, file] of [['AMD64', 'x86_64'], ['ARM64', 'aarch64']]) {
    const h = host('C:\\plugin', { OS: 'Windows_NT', PROCESSOR_ARCHITECTURE: arch! })
    expect(await stateProgram(h.value)).toBeUndefined()
    const path = 'C:\\plugin\\bin\\coco-state-windows-' + file + '.exe'
    h.files.add(path); expect(await stateProgram(h.value)).toBe(path)
    expect(h.runs).toEqual([])
  }
})

test('Windows native architecture overrides an emulated process architecture', async () => {
  const h = host('C:\\plugin', { PROCESSOR_ARCHITEW6432: 'ARM64', PROCESSOR_ARCHITECTURE: 'AMD64' })
  h.files.add('C:\\plugin\\bin\\coco-state-windows-aarch64.exe')
  expect(await stateProgram(h.value)).toBe('C:\\plugin\\bin\\coco-state-windows-aarch64.exe')
  expect(h.runs).toEqual([])
})

test('a changed plugin root invalidates the selection cache', async () => {
  const h = host('/plugin', {}, true); h.files.add('/plugin/bin/coco-state')
  expect(await stateProgram(h.value)).toBe('/plugin/bin/coco-state')
  h.value.plugin.root = '/replacement'
  expect(await stateProgram(h.value)).toBeUndefined()
  h.files.add('/replacement/bin/coco-state')
  h.files.add('/replacement/bin/coco-state-macos-aarch64')
  h.files.add('/replacement/bin/coco-state-macos-x86_64')
  expect(await stateProgram(h.value)).toBe('/replacement/bin/coco-state')
})
