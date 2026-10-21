// Owner-only comparison. The unchanged prior transport invokes /bin/ps. This
// module is loaded only for --compare-before, outside the restricted task run.
import { join } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { nodePresenceIO } from './presence-node-io'

export async function measureBefore(root: string, out: string, seconds: number,
  registerCleanup: (cleanup: () => Promise<void>) => void) {
  const { SharedPresence } = await import('./presence-before/hooks/presence')
  const folder = join(out, 'original-shared')
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, 'requests.jsonl'), '')
  const live = new Map<number, any>(), errors: string[] = []
  const seen = new Set<string>()
  const sessions: InstanceType<typeof SharedPresence>[] = []
  const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
  const sample = () => {
    if (!live.size) return []
    const result = spawnSync(join(root, 'plugin/bin/presence.sh'), ['stats-tree', [...live.keys()].join(',')], { encoding: 'utf8' })
    if (result.status !== 0) throw new Error(result.stderr || 'original-build owned process-tree sample failed')
    const rows = JSON.parse(result.stdout)
    for (const row of rows) seen.add(`${row.pid}:${row.birth}`)
    return rows
  }
  let stopped = false
  registerCleanup(async () => {
    if (stopped) return
    stopped = true
    await Promise.race([Promise.all(sessions.map(s => s.end())), wait(2000)])
    for (const child of live.values()) child.kill('SIGTERM')
    await wait(30)
    for (const child of live.values()) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  })
  for (let index = 0; index < 4; index++) sessions.push(new SharedPresence(nodePresenceIO({
    spawned(child) { live.set(child.pid, child); child.on('exit', () => live.delete(child.pid)) },
  }) as any, `before-meter-${index}`, folder, join(root, 'tools/tests/presence-before/presence.sh'), {
    changed() {}, error(error) { errors.push(String(error)) },
  }, undefined, undefined, { requestPath: join(folder, 'requests.jsonl') }))
  await Promise.all(sessions.map(s => s.start()))
  if (sessions.some(s => !s.isRunning)) throw new Error('original transport unavailable: ' + errors.join('; '))
  await wait(40)
  const idleRows = sample()
  await wait(seconds * 1000)
  let peak = 0, peakProcesses = 0, samples = 0, sampleError: unknown
  const started = performance.now()
  const timer = setInterval(() => {
    try {
      const rows = sample()
      peak = Math.max(peak, rows.reduce((sum: number, row: any) => sum + row.rssBytes, 0))
      peakProcesses = Math.max(peakProcesses, rows.length)
      samples++
    } catch (error) { sampleError = error }
  }, 2)
  try {
    while (performance.now() - started < seconds * 1000) {
      if (sampleError) throw sampleError
      await Promise.all(sessions.map(s => s.activity(true)))
      await wait(8)
    }
  } finally { clearInterval(timer) }
  if (sampleError) throw sampleError
  await Promise.all(sessions.map(s => s.activity(false)))
  if (errors.length) throw new Error(errors.join('; '))
  return { source: 'Unchanged pre-round-A SharedPresence + shell (SHA256 manifest beside source); recursive owned process RSS including short shell utility children.',
    idleRssBytesTotal: idleRows.reduce((sum: number, row: any) => sum + row.rssBytes, 0), idleRows,
    sampledPeakRssBytes: peak, sampledPeakProcesses: peakProcesses, samplingIntervalMs: 2, samples,
    busyElapsedSeconds: (performance.now() - started) / 1000, observedUniqueProcessGenerations: seen.size,
    processInventoryScope: 'Observed process generations are a sampling lower bound, not exhaustive OS spawn counts.' }
}
