import { DIAGNOSTIC_APPEND } from '../hooks/shared-files'
// Observe the real hook runtime through its bounded diagnostic record; test imports
// and actual hook modules have separate mutable module instances in the engine kit.
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { P, PERSON } from './world'
import { WINDOWS_ROOTS } from './test-system'

export function desktopRenderReceipts(on: On) {
  const flush=async($: Engine)=>{for(let i=0;i<80;i++)await $.command.run({command:'b1b-host-boundary',args:'',origin:PERSON,presentation:P})}
  // Windows deliberately has no native diagnostics. Preserve its HOME/platform
  // mocks; tests observe the existing global invalidation event instead.
  if(WINDOWS_ROOTS)return{available:false,current:()=>0,flush}
  const records: number[] = []
  on('env.get', { name: 'HOME' }, () => ({ value: '/tmp/desktop-render-receipts' }))
  on('fs.exists', { path: /[\\/]diagnostics$/ }, () => ({ value: true }))
  on('process.*', ($, e, next) => {
    if (!next.is('process.run', e) || !(e.argv[0] === '/bin/sh' && e.argv[1] === '-c' && e.argv[2] === DIAGNOSTIC_APPEND)) return next(e)
    for (const text of (e.init?.stdin ?? '').trim().split('\n')) {
      if (!text) continue
      const record = JSON.parse(text) as { step?: string; surface?: string; renderCount?: number }
      if (record.step === 'returned-tree' && record.surface === 'desktop' && typeof record.renderCount === 'number') records.push(record.renderCount)
    }
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return {
    available:true,
    current: () => records.at(-1) ?? 0,
    flush,
  }
}
