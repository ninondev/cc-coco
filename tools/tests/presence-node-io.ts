// Actual filesystem/process adapter for transport checks and scratch measurements.
import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
export function nodePresenceIO(options: { now?: () => number; spawned?: (child: any, argv: string[]) => void; writes?: (path: string, text: string) => void } = {}) {
  return {
    read: (path: string) => readFile(path, 'utf8'),
    write: async (path: string, text: string) => { options.writes?.(path,text); await writeFile(path,text) },
    run: async (argv: string[], stdin?: string) => {
      if (argv[3] === 'write' && stdin !== undefined) options.writes?.(argv[5]!, stdin)
      const child = spawn(argv[0], argv.slice(1), { stdio: ['pipe', 'pipe', 'pipe'] })
      options.spawned?.(child, argv)
      let stdout = '', stderr = ''; child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
      child.stdout.on('data', text => { stdout += text }); child.stderr.on('data', text => { stderr += text })
      const ended = new Promise<number | null>((resolve, reject) => { child.on('exit', resolve); child.on('error', reject) })
      child.stdin.end(stdin ?? '')
      const code = await ended; if (code !== 0) throw new Error('native secure write failed: ' + stderr)
      return { stdout, code }
    },
    now: async () => options.now?.() ?? Date.now(),
    after: (ms: number, callback: () => void) => { const timer = setTimeout(callback,ms); return () => clearTimeout(timer) },
    spawn: (argv: string[]) => {
      const child = spawn(argv[0],argv.slice(1), { stdio: ['ignore','pipe','pipe'] })
      options.spawned?.(child,argv)
      const packets: {stream:'stdout'|'stderr';text:string}[] = []
      let ended = false, code: number|null = null, signal: string|null = null, wake: (()=>void)|undefined
      for (const name of ['stdout','stderr'] as const) { child[name].setEncoding('utf8'); child[name].on('data',text=>{ packets.push({stream:name,text});wake?.();wake=undefined }) }
      child.on('exit',(nextCode,nextSignal)=>{ ended=true;code=nextCode;signal=nextSignal;wake?.();wake=undefined })
      child.on('error',error=>{ packets.push({stream:'stderr',text:String(error)});ended=true;wake?.();wake=undefined })
      return {
        async next() { while (!packets.length && !ended) await new Promise<void>(resolve=>{wake=resolve}); return packets.length ? {done:false as const,value:packets.shift()!} : {done:true as const,value:{code,signal}} },
        async return() { if (!ended) child.kill('SIGTERM'); return {done:true as const,value:{code,signal}} },
        [Symbol.asyncIterator]() { return this },
      }
    },
  }
}
