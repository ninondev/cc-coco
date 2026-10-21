// One visible line, one waiting once-only line. No engine calls or idle timer.
export type LinePart = { text: string; slot?: boolean }
export type LineValue = { value: string; kind: 'path' | 'test' | 'todo' | 'value' | 'label' }
export type LineButton = { key: string; label: string }
export type LineRequest = {
  id?: string; key: string; text: string; class: 0 | 1 | 2 | 3; waitForId?: string;
  slots?: LineValue[]; button?: LineButton; buttons?: LineButton[]; once?: boolean; ttl?: number;
  untilPrompt?: boolean; untilTurn?: boolean; callId?: string;
  valid?: () => boolean; onShown?: () => unknown;
}
export type VisibleLine = Omit<LineRequest, 'valid' | 'onShown'> & { id: string; expiresAt: number }
type Held = { request: LineRequest; id: string; expiresAt: number; shown: boolean }
export class LineSlot {
  private serial = 0
  private current?: Held
  private waiting?: Held
  // While a stick burns he says nothing of his own: class 0 is dropped, notes that matter still show.
  muted = false
  mute(on: boolean, now: number): void {
    this.muted = on
    if (!on) return
    if (this.current?.request.class === 0) this.current = undefined
    if (this.waiting?.request.class === 0) this.waiting = undefined
    this.advance(now)
  }
  offer(request: LineRequest, now: number): 'shown' | 'queued' | 'dropped' {
    this.advance(now)
    if (!request.text || request.valid?.() === false) return 'dropped'
    if (this.muted && request.class === 0) return 'dropped'
    if(request.id&&this.current?.id===request.id)return 'shown'
    if(request.id&&this.waiting?.id===request.id)return 'queued'
    const held = { request, id: request.id ?? `${request.key}:${++this.serial}`, expiresAt: request.ttl === 0 || request.once && request.ttl === undefined ? Infinity : now + (request.ttl ?? 14000), shown: false }
    if(request.once&&request.waitForId!==undefined&&this.current?.id===request.waitForId){this.waiting=held;return 'queued'}
    if (!this.current || request.class >= this.current.request.class) {
      this.current = held
      return 'shown'
    }
    if (request.once) { if(request.ttl===undefined)held.expiresAt=Infinity;this.waiting = held; return 'queued' }
    return 'dropped'
  }
  private alive(line: Held | undefined, now: number): line is Held {
    return !!line && now < line.expiresAt && line.request.valid?.() !== false
  }
  advance(now: number): boolean {
    const before = this.current?.id
    if (!this.alive(this.current, now)) this.current = undefined
    if (!this.alive(this.waiting, now)) this.waiting = undefined
    if (!this.current && this.waiting) {
      const held = this.waiting; this.waiting = undefined
      // Lifetime on screen starts when it leaves the waiting slot. Validity has
      // its own captured occasion deadline, so an old done/bookmark cannot revive.
      held.expiresAt = held.request.ttl === 0 || held.request.once && held.request.ttl === undefined ? Infinity : now + (held.request.ttl ?? 14000)
      this.current = held
    }
    return before !== this.current?.id
  }
  visible(now: number): VisibleLine | undefined {
    this.advance(now)
    if (!this.current) return
    const { valid, onShown, ...request } = this.current.request
    return { ...request, id: this.current.id, expiresAt: this.current.expiresAt }
  }
  needsShown(id: string): boolean { return this.current?.id === id && !this.current.shown }
  markShown(id: string, now?: number): boolean {
    const held = this.current
    if (!held || held.id !== id || held.shown) return false
    held.shown = true
    if (held.request.ttl === undefined) held.expiresAt = (now ?? 0) + 14000
    held.request.onShown?.()
    return true
  }
  clear(where: 'prompt' | 'turn' | 'all', now: number, callId?: string): boolean {
    const before = this.current?.id
    const remove = (held: Held) => where === 'all' || (callId !== undefined ? held.request.callId === callId
      : where === 'prompt' ? held.request.untilPrompt === true : held.request.untilTurn === true || held.request.callId !== undefined)
    if (this.current && remove(this.current)) this.current = undefined
    if (this.waiting && remove(this.waiting)) this.waiting = undefined
    this.advance(now)
    return before !== this.current?.id
  }
  dismiss(key: string, now: number): boolean {
    const before = this.current?.id
    if (this.current?.request.key === key) this.current = undefined
    if (this.waiting?.request.key === key) this.waiting = undefined
    this.advance(now)
    return before !== this.current?.id
  }
  deadline(now: number): number | undefined { const at=this.visible(now)?.expiresAt;return at!==undefined&&Number.isFinite(at)?at:undefined }
  queued(): string | undefined { return this.waiting?.id }
  replaceText(key: string, text: string, slots?: LineValue[]): boolean {
    let changed = false
    for (const held of [this.current, this.waiting]) if (held?.request.key === key && (held.request.text !== text || JSON.stringify(held.request.slots) !== JSON.stringify(slots))) {
      held.request = { ...held.request, text, slots }; changed = true
    }
    return changed
  }
}

// Split only values that survive fitting; no markup is ever inserted into a string.
export function lineParts(text: string, values: readonly string[]): LinePart[] {
  const slots = [...new Set(values.filter(Boolean))].sort((a, b) => b.length - a.length)
  const parts: LinePart[] = []
  let at = 0
  while (at < text.length) {
    let index = text.length, selected = ''
    for (const value of slots) {
      const found = text.indexOf(value, at)
      if (found >= at && found < index) { index = found; selected = value }
    }
    if (index > at) parts.push({ text: text.slice(at, index) })
    if (!selected) break
    parts.push({ text: selected, slot: true }); at = index + selected.length
  }
  return parts
}
