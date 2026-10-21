// The engine watches requests, with the existing follower as a one-shot fallback.
// Journal text becomes a local note only; receiving UI owns every later press. The one exception is the DM thread
// (owner's card 10-17 late: one thread in the plugin and on the pet, read or reply on either): a 'dm' line is the
// person's message in the pet's DM window and goes into Talk as if typed in the bag, only while Talk is on, fresh,
// rate-limited, and through Talk's own guards (a secret is refused there, kept nowhere).
import type { ProcessSpawnChunk, ProcessSpawnResult, HookStream } from 'claude-code'
import { joinPath, windowsPath } from './d1-paths.js'

const LINE_BYTES = 8 * 1024
function utf8Bytes(text: string): number {
  let bytes = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4
  }
  return bytes
}

type Request = { v: 1; id: string; session: string; at: number; kind: 'submit' | 'seen' | 'dm' | 'dmSeen'; text?: string; upto?: number }
export type ChannelNote = Readonly<{ id: string; at: number; text: string }>
type Callbacks = { note?: (note: ChannelNote) => void | Promise<void>; dm?: (text: string) => boolean | Promise<boolean>; dmSeen?: () => void; running: (running: boolean) => void; seen: (upto: number) => void; ack: (id: string) => Promise<void>; changed: () => Promise<void>; companionState?: (info: Record<string, unknown>) => Promise<void>; error?: (error: unknown) => void }

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
  write?: (path: string, text: string) => Promise<void>
  /** Create the stream without truncating a request another session just appended. */
  ensureRequests?: (path: string) => Promise<void>
  spawn?: (argv: string[]) => HookStream<ProcessSpawnChunk, ProcessSpawnResult>
  /** No idle follower unless an optional More row requires it. */
  canFollow?: () => boolean
  /** Share the presence follower when it already reads this request log. */
  listen?: (receive: (text: string) => Promise<void>, ended: () => void, generation?: () => void) => (() => void) | undefined
  /** Engine-owned FileChanged transport; all three are required to self-test it. */
  read?: (path: string) => Promise<string>
  append?: (path: string, text: string) => Promise<void>
  after?: (ms: number, callback: () => void) => (() => void)
  now: () => Promise<number>
  /** @deprecated Journal delivery never invokes host authority. */
  authorize?: (request: Readonly<{ id: string; kind: 'submit' | 'clear'; text?: string }>) => Promise<boolean>
  /** @deprecated Submit belongs only to the receiving UI press handler. */
  submit?: (text: string) => Promise<unknown>
  /** @deprecated Clearing another session is unsupported. */
  clear?: () => Promise<unknown>
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
  private dms: number[] = []
  private lastDm = Number.NEGATIVE_INFINITY
  private unlisten: (() => void) | undefined
  private line = ''
  private bytes = 0
  private oversized = false
  private watchMode: 'off' | 'pending' | 'active' | 'failed' = 'off'
  private watchCancel: (()=>void) | undefined
  private hello: string | undefined
  private offsetBytes = 0
  private offsetChars = 0
  private anchor = ''
  private generation = 0
  private fileSerial: Promise<void> = Promise.resolve()

  constructor(private io: ChannelIO, private session: string, private folder: string, private callbacks: Callbacks) {}

  async start(): Promise<void> {
    if (this.attempted || this.active) return
    if (windowsPath(this.folder) && !(this.io.read && this.io.append && this.io.after)) return
    const generation=this.generation
    try {
      if (!(await this.io.exists(this.folder)) || generation!==this.generation) return
      if (this.attempted || this.active) return // another push may have finished the existence read
      this.attempted = true
      if (this.io.read && this.io.append && this.io.after) {
        await this.startWatch()
        return
      }
      await this.startFollower()
    } catch (error) {
      this.report(error)
      this.stop()
    }
  }

  requestWatch(): string { return joinPath(this.folder, 'requests.jsonl') }

  async classicStart(): Promise<void> { await this.start() }

  private setOffset(text: string): void {
    this.offsetBytes = utf8Bytes(text)
    this.offsetChars = text.length
    this.anchor = text.slice(Math.max(0,text.length-128))
  }

  private async startWatch(): Promise<void> {
    const path=this.requestWatch(),generation=this.generation
    try {
      if(this.io.ensureRequests)await this.io.ensureRequests(path)
      else if(!(await this.io.exists(path))){await this.startFollower();return}
      const baseline=await this.io.read!(path)
      if(generation!==this.generation)return
      if(utf8Bytes(baseline)>4*1024*1024)throw new Error('request log exceeds engine read bound')
      this.setOffset(baseline)
      this.watchMode='pending';this.active=true
      // Classic watchPaths is applied after the hook returns. The first host
      // clock callback writes the hello only after that result can land.
      this.watchCancel=this.io.after!(0,()=>{
        this.watchCancel=undefined
        void this.appendHello(generation).catch(error=>{if(generation===this.generation){this.report(error);void this.watchFallback().catch(error=>{this.report(error);this.stop()})}})
      })
    } catch(error) {
      if(generation!==this.generation)return
      this.report(error)
      await this.watchFallback()
    }
  }

  private async appendHello(generation:number):Promise<void> {
    if(generation!==this.generation||this.watchMode!=='pending')return
    const at=await this.io.now()
    if(generation!==this.generation||this.watchMode!=='pending')return
    this.hello=this.session+':'+at
    await this.io.append!(this.requestWatch(),JSON.stringify({v:1,kind:'hello',session:this.session,id:this.hello,at})+'\n')
    if(generation!==this.generation||this.watchMode!=='pending')return
    this.watchCancel=this.io.after!(1500,()=>{
      if(this.watchMode!=='pending')return
      this.watchCancel=undefined
      void this.watchFallback().catch(error=>{this.report(error);this.stop()})
    })
  }

  private async watchFallback():Promise<void> {
    this.watchCancel?.();this.watchCancel=undefined
    this.watchMode='failed';this.active=false;this.line='';this.bytes=0;this.oversized=false
    await this.startFollower()
  }

  private watching():boolean {return this.watchMode==='pending'||this.watchMode==='active'}

  fileChanged():Promise<void> {
    if(!this.watching())return Promise.resolve()
    const read=async()=>{
      if(!this.watching())return
      try {
        const text=await this.io.read!(this.requestWatch())
        if(!this.watching())return
        const bytes=utf8Bytes(text)
        if(bytes>4*1024*1024)throw new Error('request log exceeds engine read bound')
        const rotated=bytes<this.offsetBytes||text.slice(Math.max(0,this.offsetChars-128),this.offsetChars)!==this.anchor
        if(rotated){this.offsetChars=0;this.offsetBytes=0;this.line='';this.bytes=0;this.oversized=false}
        const incoming=text.slice(this.offsetChars)
        this.setOffset(text)
        await this.receiveText(incoming)
      } catch(error){if(!this.watching())return;this.report(error);await this.watchFallback()}
    }
    this.fileSerial=this.fileSerial.then(read,read)
    return this.fileSerial
  }

  /** Attach only after the shared reader is active; failed child attempts stay final. */
  sharedReady(): void {
    if (!this.attempted || this.active || this.watchMode !== 'failed' || !this.followingAllowed()) return
    this.attachSharedFollower()
  }

  private attachSharedFollower(): boolean {
    const generation = this.generation
    if (this.io.listen) {
      const unlisten = this.io.listen(async text => {
        if(generation!==this.generation)return
        try { await this.receiveText(text) }
        catch (error) {
          this.report(error); this.stop()
          void notifyChannelEnded(this.callbacks.changed).catch(error => this.report(error))
        }
      }, () => {
        if(generation!==this.generation)return
        this.stop()
        void notifyChannelEnded(this.callbacks.changed).catch(error => this.report(error))
      }, () => this.resetGeneration())
      if (unlisten) {
        this.unlisten = unlisten
        this.active = true
        this.callbacks.running(true)
        return true
      }
    }
    return false
  }

  private async startFollower(): Promise<void> {
      if(!this.followingAllowed()){this.attempted=false;return}
      const generation=this.generation
      if (this.attachSharedFollower()) return
      // No way to start a follower here: when presence can share one later, a later start (once it runs) tries again.
      if (windowsPath(this.folder) || typeof this.io.spawn !== 'function') { if (this.io.listen) this.attempted = false; return }
      if (!(await this.io.exists('/usr/bin/tail')) || generation!==this.generation||this.active||!this.followingAllowed()) return
      const path = joinPath(this.folder, 'requests.jsonl')
      if (this.io.ensureRequests) await this.io.ensureRequests(path)
      else if (!(await this.io.exists(path))) return // no safe creator: remain optional
      if(generation!==this.generation||this.active||!this.followingAllowed())return
      // A removal while creating the file must not start a child on a missing folder.
      if (!(await this.io.exists(this.folder)) || generation!==this.generation||this.active||!this.followingAllowed()) return
      this.child = this.io.spawn(['/usr/bin/tail', '-F', '-n', '0', path])
      this.ended = new Promise(resolve => { this.end = resolve })
      this.active = true
      this.callbacks.running(true)
      void this.read().catch(error => this.report(error))
  }

  get isRunning(): boolean { return this.active }

  private followingAllowed():boolean {try{return this.io.canFollow?.()!==false}catch{return false}}

  /** Keep the engine's pending/proven watch, stop only the optional fallback. */
  stopFollowerOnly():void {
    if(this.watching())return
    this.stop();this.attempted=false;this.child=undefined;this.ended=undefined
  }

  resetGeneration(): void {
    this.line = ''; this.bytes = 0; this.oversized = false
  }

  private report(error: unknown): void {
    // Diagnostics must never turn an optional request channel into a rejected setup.
    try { this.callbacks.error?.(error) } catch { /* logging is best effort */ }
  }

  stop(): void {
    this.generation++
    this.watchCancel?.();this.watchCancel=undefined;this.watchMode='off'
    this.unlisten?.()
    this.unlisten = undefined
    this.end?.()
    this.end = undefined
    if (this.active) {
      this.active = false
      this.callbacks.running(false)
    }
  }

  private async read(): Promise<void> {
    const child = this.child!
    const ended=this.ended!
    try {
      while (this.active&&this.child===child) {
        // Waking on a removal/end lets the loop leave even while tail has no output.
        const chunk = await Promise.race([child.next(), ended.then(() => undefined)])
        if (!chunk || chunk.done || !this.active||this.child!==child) break
        if (chunk.value.stream !== 'stdout') { this.resetGeneration(); continue }
        await this.receiveText(chunk.value.text)
      }
    } catch (error) {
      this.report(error)
      // Unsupported spawn, a failed first pull or a failed child never arms a retry.
    } finally {
      if(this.child===child)this.stop()
      // The engine kills the child on return(). Do not wait on a suspended test generator.
      void child.return({ code: null, signal: null }).catch(error => this.report(error))
      try { await notifyChannelEnded(this.callbacks.changed) } catch (error) { this.report(error) }
    }
  }

  private async receiveText(text: string): Promise<void> {
    for (const part of text.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
      if (!this.active) break
      const complete = part.endsWith('\n')
      const piece = complete ? part.slice(0, -1) : part
      this.bytes += utf8Bytes(piece)
      if (this.bytes > LINE_BYTES) { this.oversized = true; this.line = '' }
      if (!this.oversized) this.line += piece
      if (complete) {
        if (!this.oversized) await this.handle(this.line)
        this.line = ''; this.bytes = 0; this.oversized = false
      }
    }
  }

  private async handle(line: string): Promise<void> {
    let input: unknown
    try { input = JSON.parse(line) } catch { return }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return
    const event = input as Record<string, unknown>
    if(event.v===1&&event.kind==='hello') {
      if(this.watchMode==='pending'&&event.session===this.session&&event.id===this.hello){this.watchCancel?.();this.watchCancel=undefined;this.watchMode='active';this.callbacks.running(true)}
      return
    }
    if (event.v === 1 && event.kind === 'companion-state') {
      const now = await this.io.now()
      if (!this.active || typeof event.at !== 'number' || !Number.isFinite(event.at) || Math.abs(now - event.at) > 60_000) return
      if (!event.info || typeof event.info !== 'object' || Array.isArray(event.info)) return
      const info: Record<string, unknown> = {}, raw = event.info as Record<string, unknown>
      for (const key of ['running', 'accessibility', 'login', 'capture']) if (typeof raw[key] === 'boolean') info[key] = raw[key]
      for (const key of ['answered', 'sizeAt', 'loginAt', 'followAt', 'captureAt']) if (typeof raw[key] === 'number' && Number.isFinite(raw[key])) info[key] = raw[key]
      if (typeof raw.hiddenUntil === 'number' && Number.isFinite(raw.hiddenUntil * 1000) && Math.abs(raw.hiddenUntil * 1000) <= 8.64e15) info.hiddenUntil = raw.hiddenUntil * 1000
      if (typeof raw.longTaskAuthorization === 'string' && ['authorized','denied','notDetermined'].includes(raw.longTaskAuthorization)) info.longTaskAuthorization=raw.longTaskAuthorization
      if (typeof raw.version === 'string' && raw.version.length <= 64) info.version = raw.version
      if (['tiny', 'small', 'medium', 'large', 'larger'].includes(String(raw.size))) info.size = raw.size
      try { await this.callbacks.companionState?.(info) } catch (error) { this.report(error) }
      return
    }
    const request = input as Request
    if (request.v !== 1 || !['submit', 'seen', 'dm', 'dmSeen'].includes(request.kind)
        || request.session !== this.session || typeof request.at !== 'number' || !Number.isFinite(request.at)
        || typeof request.id !== 'string' || !/^[\da-f]{16,32}$/i.test(request.id)) return
    const now = await this.io.now()
    if (!this.active || Math.abs(now - request.at) > 60_000) return
    let text: string | undefined
    if (request.kind === 'submit' || request.kind === 'dm') {
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
      // An unchanged retry recovers a lost receipt. A thrown note callback
      // has an uncertain outcome and must never queue the same note again.
      if (previous.identity === identity && previous.completed) {
        try { await this.callbacks.ack(request.id) } catch (error) { this.report(error) /* another retry can recover the ack */ }
      }
      return
    }
    if (request.kind === 'submit') {
      this.submits = this.submits.filter(at => actionAt - at < 3_600_000)
      if (actionAt - this.lastSubmit < 2000 || this.submits.length >= 30) return
    }
    // A chat runs faster than notes: a message every two seconds, sixty an hour.
    if (request.kind === 'dm') {
      this.dms = this.dms.filter(at => actionAt - at < 3_600_000)
      if (actionAt - this.lastDm < 2000 || this.dms.length >= 60) return
    }
    // Never evict fresh identities to make room: that could replay an uncertain note.
    if (this.handled.size >= 4096) return
    const handled = { identity, at: request.at, completed: false }
    this.handled.set(request.id, handled)
    try {
      if (request.kind === 'submit') {
        // A valid journal identity establishes a receipt, never authority to act
        // as the person. Only the local UI may submit after a separate press.
        if (!this.callbacks.note) return
        this.lastSubmit = actionAt
        this.submits.push(actionAt)
        await this.callbacks.note({ id: request.id, at: request.at, text: text! })
      } else if (request.kind === 'dm') {
        // Refused (Talk off, or she is still answering): no receipt, and the same request may come again.
        if (!this.callbacks.dm || !(await this.callbacks.dm(text!))) { this.handled.delete(request.id); return }
        this.lastDm = actionAt
        this.dms.push(actionAt)
      } else if (request.kind === 'dmSeen') {
        this.callbacks.dmSeen?.()
      } else {
        this.callbacks.seen(request.upto!)
      }
      // A local delivery may await the host. Keep an uncertain delivery deduped,
      // but never acknowledge it after stop, uninstall or expiry.
      if (!this.active || !(await this.io.exists(this.folder))) { this.stop(); return }
      const receiptAt = await this.io.now()
      if (!this.active || Math.abs(receiptAt - request.at) > 60_000) return
      handled.completed = true
      await this.callbacks.ack(request.id)
    } catch (error) {
      this.report(error)
      // No acknowledgement if local delivery threw before handling the note.
    }
  }
}
