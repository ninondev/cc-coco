// Scratch ownership for real Bun/Node process drivers, outside the plugin kit.
import { lstatSync, rmSync } from 'node:fs'
export function registerScratch(folder: string, stop: () => void = () => {}): () => void {
  const owner = lstatSync(folder)
  let active = true
  const cleanup = () => {
    if (!active) return
    active = false
    process.removeListener('exit', cleanup)
    for (const [signal, handler] of handlers) process.removeListener(signal, handler)
    stop()
    if (process.env.COCO_KEEP_SCRATCH === '1') {
      console.log(`scratch folder kept: ${folder}`)
      return
    }
    let current: ReturnType<typeof lstatSync>
    try { current = lstatSync(folder) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    if (current.isSymbolicLink() || current.dev !== owner.dev || current.ino !== owner.ino) return
    rmSync(folder, { recursive: true, force: true })
  }
  const handlers = (['SIGHUP', 'SIGINT', 'SIGTERM'] as const).map((signal, index) =>
    [signal, () => { cleanup(); process.exit([129, 130, 143][index]!) }] as const)
  process.once('exit', cleanup)
  for (const [signal, handler] of handlers) process.once(signal, handler)
  return cleanup
}
