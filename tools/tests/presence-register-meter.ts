import { hookDirectory } from '../hooks-source'
// Exercise the shipping receivePresence -> publish -> ui.invalidate path. The
// adapter implements only the API boundary; Claude's paint/compositor is outside
// this measurement. Only scratch copies gain a test export, never the plugin.
import { cp, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PresenceSnapshot } from '../../plugin/hooks/presence'

export async function registerRedrawReceivers(root: string, out: string,
  redraw: (session: number, seq: number, at: number) => void,
  suppressRedraw = false): Promise<((state: PresenceSnapshot) => Promise<void>)[]> {
  const receivers: ((state: PresenceSnapshot) => Promise<void>)[] = []
  for (let session = 0; session < 4; session++) {
    const folder = join(out, `register-${session}`)
    await mkdir(folder, { recursive: true })
    await cp(join(root, 'plugin/hooks'), join(folder, 'hooks'), { recursive: true })
    const sourceDirectory = hookDirectory(join(root, 'plugin'))
    if (sourceDirectory !== join(root, 'plugin/hooks')) await cp(sourceDirectory, join(folder, 'hooks'), { recursive: true })
    await cp(join(root, 'plugin/types'), join(folder, 'types'), { recursive: true })
    // Force a self-contained TSX transform instead of inheriting generated host
    // tsconfig paths. No JSX executes on this presence-publication path.
    await writeFile(join(folder, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'react', jsxFactory: 'React.createElement' } }))
    const file = join(folder, 'hooks/register.tsx')
    let source = await readFile(file, 'utf8')
    const invalidate = "try { $.ui.invalidate('ui.render') } catch (error) { caught($, 'invalidate', error) }"
    if (source.split(invalidate).length !== 2) throw new Error('redraw request seam changed; meter must be reviewed')
    if (suppressRedraw) source = source.replace(invalidate, '/* negative-control: redraw suppressed in scratch */')
    await writeFile(file, source + '\nexport const meterReceivePresence = receivePresence\n')
    const transpiler = new Bun.Transpiler({ loader: 'tsx', tsconfig: JSON.stringify({ compilerOptions: { jsx: 'react', jsxFactory: 'React.createElement' } }) })
    for (const name of await readdir(join(folder, 'hooks'))) {
      if (!name.endsWith('.tsx')) continue
      const path = join(folder, 'hooks', name)
      await writeFile(path.slice(0, -4) + '.js', transpiler.transformSync(await readFile(path, 'utf8')))
      await unlink(path)
    }
    const module = await import(file.slice(0, -4) + '.js')
    let version = 0
    const timers = new Set<ReturnType<typeof setTimeout>>()
    receivers.push(async state => {
      const engine = {
        clock: {
          now: async () => Date.now(),
          after(ms: number, callback: () => unknown) {
            const timer = setTimeout(() => { timers.delete(timer); void callback() }, ms)
            timer.unref()
            timers.add(timer)
            return { cancel() { clearTimeout(timer); timers.delete(timer) } }
          },
        },
        state: { set: async () => ({ isSet: true, version: ++version }) },
        ui: { invalidate: (method: string) => {
          if (method !== 'ui.render') throw new Error('unexpected invalidation ' + method)
          redraw(session, state.seq, performance.now())
        } },
        env: { get: async () => undefined },
        fs: { exists: async () => false },
      }
      await module.meterReceivePresence(engine, state)
    })
  }
  return receivers
}
