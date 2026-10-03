// One sleeping child per installed session. The request text is handed to Claude Code;
// this module never executes it or changes the engine's permissions.
import type { ProcessSpawnChunk, ProcessSpawnResult, HookStream } from 'claude-code'
import { joinPath, windowsPath } from './paths'

const LINE_BYTES = 8 * 1024
function utf8Bytes(text: string): number {
  let bytes = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4
  }
  return bytes
}

type Request = { v: 1; id: string; session: string; at: number; kind: 'submit' | 'clear' | 'seen'; text?: string; upto?: number }
type Callbacks = { running: (running: boolean) => void; seen: (upto: number) => void; ack: (id: string) => Promise<void>; changed: () => Promise<void> }

export async function notifyChannelEnded(changed: () => Promise<void>): Promise<void> {
  try {
    await changed()
  } catch (error) {
    // HookStream has no unload/abort flag. The host may finish its stream after
    // removing this module's state-write permission; drop only that refusal.
    const message = error instanceof Error ? error.message.replace(/^environment \d+: /, '') : undefined
    if (message !== '$.state.set refused: no hooks module of that name is loaded, so there is no scan to allow it (host rule)') throw error
  }
}

export type ChannelIO = {
  exists: (path: string) => Promise<boolean>
  write: (path: string, text: string) => Promise<void>
  spawn?: (argv: string[]) => HookStream<ProcessSpawnChunk, ProcessSpawnResult>
  now: () => Promise<number>
  submit: (text: string) => Promise<unknown>
  clear: () => Promise<unknown>
}

export class CompanionChannel {
  private attempted = false
  private active = false
  private child: HookStream<ProcessSpawnChunk, ProcessSpawnResult> | undefined
  private end: (() => void) | undefined
  private ended: Promise<void> | undefined
  private handled = new Map<string, { identity: string; at: number; completed: boolean }>()
  private submits: number[] = []
  private lastSubmit = Number.NEGATIVE_INFINITY
  private lastClear = Number.NEGATIVE_INFINITY

  constructor(private io: ChannelIO, private session: string, private folder: string, private callbacks: Callbacks) {}

  async start(): Promise<void> {
    if (this.attempted || this.active) return
    if (windowsPath(this.folder)) return
    if (!(await this.io.exists(this.folder))) return
    if (this.attempted || this.active) return // another push may have finished the existence read
    this.attempted = true
    if (typeof this.io.spawn !== 'function') return
    try {
      if (!(await this.io.exists('/usr/bin/tail'))) return
      const path = joinPath(this.folder, 'requests.jsonl')
      if (!(await this.io.exists(path))) await this.io.write(path, '')
      // A removal while creating the file must not start a child on a missing folder.
      if (!(await this.io.exists(this.folder))) return
      this.child = this.io.spawn(['/usr/bin/tail', '-f', '-n', '0', path])
      this.ended = new Promise(resolve => { this.end = resolve })
      this.active = true
      this.callbacks.running(true)
      void this.read()
    } catch {
      this.stop()
    }
  }

  stop(): void {
    this.end?.()
    this.end = undefined
    if (this.active) {
      this.active = false
      this.callbacks.running(false)
    }
  }

  private async read(): Promise<void> {
    const child = this.child!
    let line = ''
    let bytes = 0
    let oversized = false
    try {
      while (this.active) {
        // Waking on a removal/end lets the loop leave even while tail has no output.
        const chunk = await Promise.race([child.next(), this.ended!.then(() => undefined)])
        if (!chunk || chunk.done || !this.active) break
        if (chunk.value.stream !== 'stdout') continue
        for (const part of chunk.value.text.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
          if (!this.active) break
          const complete = part.endsWith('\n')
          const piece = complete ? part.slice(0, -1) : part
          bytes += utf8Bytes(piece)
          if (bytes > LINE_BYTES) { oversized = true; line = '' }
          if (!oversized) line += piece
          if (complete) {
            if (!oversized) await this.handle(line)
            line = ''
            bytes = 0
            oversized = false
          }
        }
      }
    } catch {
      // Unsupported spawn, a failed first pull or a failed child never arms a retry.
    } finally {
      this.stop()
      // The engine kills the child on return(). Do not wait on a suspended test generator.
      void child.return({ code: null, signal: null }).catch(() => undefined)
      await notifyChannelEnded(this.callbacks.changed)
    }
  }

  private async handle(line: string): Promise<void> {
    let input: unknown
    try { input = JSON.parse(line) } catch { return }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return
    const request = input as Request
    const now = await this.io.now()
    if (request.v !== 1 || !['submit', 'clear', 'seen'].includes(request.kind)
        || request.session !== this.session || typeof request.at !== 'number' || !Number.isFinite(request.at)
        || Math.abs(now - request.at) > 60_000 || typeof request.id !== 'string'
        || !/^[\da-f]{16,32}$/i.test(request.id)) return
    let text: string | undefined
    if (request.kind === 'submit') {
      if (typeof request.text !== 'string' || request.text.includes('\0')) return
      text = request.text.trim()
      const length = [...text].length
      if (length < 1 || length > 4000) return
    } else if (request.kind === 'seen' && (typeof request.upto !== 'number' || !Number.isFinite(request.upto) || request.upto < 0)) return
    // Validate presence again at the action boundary: buffered lines cannot revive an uninstall.
    if (!this.active || !(await this.io.exists(this.folder))) { this.stop(); return }
    const actionAt = await this.io.now()
    if (!this.active || Math.abs(actionAt - request.at) > 60_000) return
    for (const [id, value] of this.handled) if (actionAt > value.at + 60_000) this.handled.delete(id)
    const identity = JSON.stringify([request.session, request.at, request.kind, request.text ?? null, request.upto ?? null])
    const previous = this.handled.get(request.id)
    if (previous) {
      // An unchanged retry recovers a lost confirmation, including New chat. A thrown
      // engine action has an uncertain outcome and must never be executed again.
      if (previous.identity === identity && previous.completed) {
        try { await this.callbacks.ack(request.id) } catch { /* another retry can recover the ack */ }
      }
      return
    }
    if (request.kind === 'submit') {
      this.submits = this.submits.filter(at => actionAt - at < 3_600_000)
      if (actionAt - this.lastSubmit < 2000 || this.submits.length >= 30) return
    } else if (request.kind === 'clear' && actionAt - this.lastClear < 10_000) return
    const handled = { identity, at: request.at, completed: false }
    this.handled.set(request.id, handled)
    try {
      if (request.kind === 'submit') {
        this.lastSubmit = actionAt
        this.submits.push(actionAt)
        await this.io.submit(text!)
      } else if (request.kind === 'clear') {
        this.lastClear = actionAt
        await this.io.clear()
      } else {
        this.callbacks.seen(request.upto!)
      }
      handled.completed = true
      await this.callbacks.ack(request.id)
    } catch {
      // No acknowledgement if an engine call threw before handling the request.
    }
  }
}
