// Coco's band pictures (10-14): the actions the owner picked, played as one animated SVG each.
// tools/art/coco-clips.py samples the approved clips into tracks (plugin/assets/coco/band-<outfit>.json);
// this file only chooses an action, joins it to whatever was showing, and writes the SVG. CSS keyframes
// only: once drawn, a picture plays by itself, so nothing here runs while Coco is idle.

export type CocoOutfit = 'A' | 'B'
export type CocoActionKey =
  | 'idle' | 'wait' | 'think' | 'watch' | 'petted' | 'hood' | 'hello' | 'peek' | 'doze' | 'night' | 'pack'
  | 'serious' | 'shell' | 'work' | 'done' | 'search' | 'read' | 'lookup' | 'plan' | 'run' | 'coffee' | 'helper'
  | 'praised' | 'pass' | 'firsttry' | 'out' | 'error' | 'wild' | 'fixed' | 'teapot' | 'breath' | 'nap' | 'catch'
export const COCO_ACTIONS: readonly CocoActionKey[] = [
  'idle', 'wait', 'think', 'watch', 'petted', 'hood', 'hello', 'peek', 'doze', 'night', 'pack', 'serious', 'shell',
  'work', 'done', 'search', 'read', 'lookup', 'plan', 'run', 'coffee', 'helper', 'praised', 'pass', 'firsttry',
  'out', 'error', 'wild', 'fixed', 'teapot', 'breath', 'nap', 'catch',
]

type Track = readonly (readonly number[])[]          // [[t s, value...], ...], linear in between
type Element = {
  src: string; origin: readonly [number, number]
  clip_local: readonly number[] | null; clip_final: readonly number[] | null
  a: Track; t: Track; r: Track; s: Track             // opacity, translate x y, rotate deg, scale x y
}
type Part = { seconds: number; elements: readonly Element[] }
type Action = { entry: { kind: 'sink' | 'hop' | 'cut'; depth: number; h: number }; body: Part; loop?: Part }
export type CocoData = {
  outfit: CocoOutfit
  canvas: readonly [number, number]                  // viewBox units (the preview's), headroom included
  floor: readonly [number, number]
  sink: number                                       // s: the dip before a swap
  hop: readonly [number, number]                     // s: the crouch, then the rise
  actions: Readonly<Record<string, Action>>
  images: Readonly<Record<string, string>>           // source id -> PNG, base64
  // the frames they hold with open eyes: where the eyes sit (viewBox units) and them half shut and shut
  eyes?: Readonly<Record<string, { box: readonly number[]; half: string; closed: string }>>
}

const installed: Partial<Record<CocoOutfit, CocoData>> = {}
const complete: Partial<Record<CocoOutfit, boolean>> = {}
// partial: the resting states bundled for the band's first answer (coco-stills.ts); the whole file
// (plugin/assets/coco/band-<outfit>.json) replaces them once it is read, and is never replaced back.
export function installCocoData(data: CocoData, partial = false): void {
  if (!data || (data.outfit !== 'A' && data.outfit !== 'B') || !Array.isArray(data.canvas) || !data.actions || !data.images) throw new Error('Invalid Coco data')
  for (const key of partial ? Object.keys(data.actions) : COCO_ACTIONS) {
    const action = data.actions[key]
    if (!action?.body || !(action.body.seconds > 0)) throw new Error(`Coco data lacks ${key}`)
    for (const part of [action.body, action.loop]) for (const e of part?.elements ?? []) if (!data.images[e.src]) throw new Error(`Coco data lacks ${e.src}`)
  }
  if (partial && complete[data.outfit]) return
  installed[data.outfit] = data
  complete[data.outfit] = !partial
}
// The socks Coco wears when they are not the pair drawn in the pictures (10-14, the sock drawer): for each picture, the pixels
// that pair changes and where they sit (viewBox units), drawn over the picture (tools/art/coco-socks.py and
// coco-clips.py --socks write assets/coco/socks-<outfit>-<pair>.json). The drawn pair needs nothing.
export type CocoSocks = { outfit: CocoOutfit; pair: string; socks: Readonly<Record<string, { box: readonly number[]; img: string }>> }
const socksWorn: Partial<Record<CocoOutfit, CocoSocks>> = {}
export function installCocoSocks(outfit: CocoOutfit, data: CocoSocks | undefined): void {
  if (data !== undefined && (!data || data.outfit !== outfit || typeof data.pair !== 'string' || !/^[a-z]{2,24}$/.test(data.pair) || typeof data.socks !== 'object' || !data.socks)) throw new Error('Invalid Coco socks')
  if (data) socksWorn[outfit] = data
  else delete socksWorn[outfit]
}
export function cocoSocksWorn(outfit: CocoOutfit): string | undefined { return socksWorn[outfit]?.pair }
export function cocoReady(outfit: CocoOutfit): boolean { return complete[outfit] === true }
export function cocoHas(outfit: CocoOutfit, action: CocoActionKey): boolean { return installed[outfit]?.actions[action] !== undefined }
export function cocoCanvas(): readonly [number, number] { return (installed.A ?? installed.B)?.canvas ?? [234, 241] }
export function cocoWidth(height: number): number { const [w, h] = cocoCanvas(); return height * w / h }

// ---------------------------------------------------------------- which action

export type CocoInput = {
  mood: string; pose?: string; touch?: 'poke' | 'pat' | 'burst' | 'wink'; shed?: 'begin' | 'end' | 'skip'
  act?: CocoActionKey; night?: boolean; working: boolean
  breath?: boolean // the breathing light is on (play.breath): they hold the shut laptop and breathe with it
}
const POSES: Readonly<Record<string, CocoActionKey>> = {
  search: 'search', scroll: 'read', spyglass: 'lookup', plan: 'plan', run: 'run', helper: 'helper', tea: 'coffee',
  cheer: 'fixed', waiting: 'wait', 'look-up': 'watch', // cheer is C3's green after a red: 修好了
}
const MOODS: Readonly<Record<string, CocoActionKey>> = {
  idle: 'idle', think: 'think', work: 'work', happy: 'done', waiting: 'wait', question: 'wait', error: 'error',
  wild: 'wild', refuse: 'teapot', flustered: 'praised', wave: 'hello', snake: 'peek',
  peek: 'peek', // the name lane C gives 'snake' when the white snake's code goes
}
// The 48-cell table of the 《Coco 全清单》 page: a touch first, then an explicit moment, the shell
// change, a tool pose, then the mood.
export function cocoAction(input: CocoInput): CocoActionKey {
  if (input.touch === 'burst') return 'hood'
  if (input.touch) return 'petted'
  if (input.act) return input.act
  if (input.shed === 'begin') return 'pack'
  if (input.shed === 'end') return 'shell'
  if (input.breath) return 'breath'
  const pose = input.pose ? POSES[input.pose] : undefined
  if (pose) return pose
  if (input.mood === 'sleep') return input.night ? 'night' : 'nap'
  return MOODS[input.mood] ?? (input.working ? 'think' : 'idle')
}
// What Coco settles into after an action played once.
export function cocoBase(input: Pick<CocoInput, 'mood' | 'working' | 'night' | 'breath'>): CocoActionKey {
  if (input.breath) return 'breath'
  if (input.mood === 'sleep') return input.night ? 'night' : 'nap'
  if (input.mood === 'waiting' || input.mood === 'question') return 'wait'
  if (input.working) return input.mood === 'work' ? 'work' : 'think'
  return 'idle'
}

// ---------------------------------------------------------------- playing

// One picture on the band: an action, the clock it started at, and the drawing it left (joined with a dip).
// once: played through and then into the base even if the action has a loop of its own (a moment, not a state).
export type CocoPlay = { outfit: CocoOutfit; action: CocoActionKey; base: CocoActionKey; at: number; once?: boolean; from?: readonly Element[] }
export const COCO_BASES: ReadonlySet<CocoActionKey> = new Set<CocoActionKey>(['idle', 'think', 'work', 'wait', 'doze', 'night', 'breath', 'nap'])

function sample(track: Track, t: number): number[] {
  if (track.length === 1 || t <= track[0]![0]!) return track[0]!.slice(1)
  for (let i = 1; i < track.length; i++) {
    const b = track[i]!
    if (t <= b[0]!) {
      const a = track[i - 1]!, u = (t - a[0]!) / Math.max(1e-9, b[0]! - a[0]!)
      return a.slice(1).map((v, k) => v + u * (b[k + 1]! - v))
    }
  }
  return track[track.length - 1]!.slice(1)
}

type Segment = { part: Part; loop?: boolean }

const other = (o: CocoOutfit): CocoOutfit => o === 'A' ? 'B' : 'A'

function segments(play: CocoPlay): Segment[] {
  const data = installed[play.outfit]
  if (!data) return []
  const action = data.actions[play.action]!
  const out: Segment[] = []
  if (play.from?.length && action.entry.kind !== 'cut') out.push({ part: join(play.from, action.entry, data) })
  out.push({ part: action.body })
  if (action.loop && !play.once) out.push({ part: action.loop, loop: true })
  else {
    // played once, then into the base; the shell change ends in the other hoodie, so its base is that one's
    const next = play.action === 'shell' ? installed[other(play.outfit)] ?? data : data
    const base = next.actions[play.base] ?? next.actions.idle!
    const end = drawnAt([{ part: action.body }], action.body.seconds - 1e-3)
    if (end.length) out.push({ part: join(end, base.entry.kind === 'cut' ? { kind: 'sink', depth: .045, h: 8 } : base.entry, next) })
    out.push({ part: base.loop ?? base.body, loop: true })
  }
  return out
}

// The elements drawn at t seconds into a list of segments, frozen at their values then.
function drawnAt(list: readonly Segment[], t: number): Element[] {
  let start = 0
  for (const [i, seg] of list.entries()) {
    const last = i === list.length - 1
    if (t < start + seg.part.seconds || last) {
      let u = t - start
      if (seg.loop && last) u = ((u % seg.part.seconds) + seg.part.seconds) % seg.part.seconds
      u = Math.min(Math.max(0, u), seg.part.seconds)
      return seg.part.elements.flatMap(e => {
        const a = sample(e.a, u)[0]!
        if (a < .01) return []
        const still = (track: Track) => [[0, ...sample(track, u)]]
        return [{ ...e, a: [[0, a]], t: still(e.t), r: still(e.r), s: still(e.s) }]
      })
    }
    start += seg.part.seconds
  }
  return []
}

export function cocoDrawn(play: CocoPlay, now: number): Element[] {
  return drawnAt(segments(play), Math.max(0, now - play.at) / 1000)
}

// How long an action plays before it holds or hands over to its base.
export function cocoBodySeconds(outfit: CocoOutfit, action: CocoActionKey): number {
  return installed[outfit]?.actions[action]?.body.seconds ?? 0
}

// A new play. The same action keeps its clock. An action played once goes on into its base by itself,
// so the base it was going to coming back keeps that picture (played through, then held); any other
// state, or a new moment, starts now from whatever was drawn.
// A moment (act) is played once from the clock it happened at; the same moment again keeps its play.
export function cocoNext(previous: CocoPlay | undefined, outfit: CocoOutfit, action: CocoActionKey, base: CocoActionKey, now: number, act?: { at: number }): CocoPlay {
  const once = act !== undefined
  if (previous && previous.outfit === outfit && previous.action === action && (once ? previous.once && previous.at === act.at : !previous.once)) return previous.base === base ? previous : { ...previous, base }
  const was = previous && installed[previous.outfit]?.actions[previous.action]
  if (previous && was && (previous.once || !was.loop) && !once && action === previous.base) {
    const into = previous.action === 'shell' ? other(previous.outfit) : previous.outfit
    if (outfit === into) return previous
  }
  return { outfit, action, base, at: once ? Math.min(now, act.at) : now, ...(once ? { once } : {}), ...(previous ? { from: cocoDrawn(previous, now) } : {}) }
}

const ease = (u: number) => { const x = Math.max(0, Math.min(1, u)); return x * x * (3 - 2 * x) }

// The dip (or the crouch and rise) on the drawing they leave, before the swap: as the preview's
// fine_pose does it on the beat before a 'sink' or 'hop' entry.
function join(from: readonly Element[], entry: Action['entry'], data: CocoData): Part {
  const hop = entry.kind === 'hop'
  const seconds = hop ? data.hop[0] + data.hop[1] : data.sink
  const steps = 8
  const elements = from.map(e => {
    const [a] = e.a[0]!.slice(1), [tx, ty] = e.t[0]!.slice(1), [sx, sy] = e.s[0]!.slice(1)
    const top = !!e.clip_local && e.clip_local[3]! < 1e4, bottom = !!e.clip_local && e.clip_local[1]! > -1e4
    const t: number[][] = [], s: number[][] = []
    for (let k = 0; k <= steps; k++) {
      const at = seconds * k / steps
      let px = 1, py = 1, dy = 0
      if (hop) {
        const [crouch, rise] = data.hop
        if (at <= crouch) { py = 1 - .05 * ease(at / crouch); px = 1 + .5 * (1 - py) }
        else { const u = ease((at - crouch) / rise); py = 1 + .04 * u; px = 1 - .02 * u; dy = -entry.h * u }
      } else { py = 1 - entry.depth * ease(at / seconds); px = 1 + .5 * (1 - py) }
      if (bottom) { px = 1; py = 1 } else if (top) px = 1
      t.push([at, tx!, ty! + dy])
      s.push([at, sx! * px, sy! * py])
    }
    return { ...e, a: [[0, a!], [seconds, a!]], t, s }
  })
  return { seconds, elements }
}

// ---------------------------------------------------------------- the SVG

const n = (v: number, d = 2) => {
  const s = d > 0 ? v.toFixed(d).replace(/\.?0+$/, '') : v.toFixed(0)
  return s === '-0' ? '0' : s
}
function rect(r: readonly number[]): string {
  const [x0, y0, x1, y1] = r.map(v => Math.max(-1e4, Math.min(1e4, v)))
  return `<rect x="${n(x0!)}" y="${n(y0!)}" width="${n(x1! - x0!)}" height="${n(y1! - y0!)}"/>`
}
const VALUE = {
  a: (k: readonly number[]) => `opacity:${n(k[1]!, 3)}`,
  t: (k: readonly number[]) => `transform:translate(${n(k[1]!)}px,${n(k[2]!)}px)`,
  r: (k: readonly number[]) => `transform:rotate(${n(k[1]!, 3)}deg)`,
  s: (k: readonly number[]) => `transform:scale(${n(k[1]!, 4)},${n(k[2]!, 4)})`,
} as const
const IDENTITY = { a: [1], t: [0, 0], r: [0], s: [1, 1] } as const

// Blinks while Coco holds still, timed like a person's (MOTION.blink in motion.ts: a median of 5 s, most
// between 2 and 12, now and then a double blink): half shut 33 ms, shut 130 ms, half open 50 ms. One
// cycle of a minute, the same for every frame, so a blink is only seen on the frame that is drawn.
const BLINK_CYCLE = 61
export function cocoBlinkTimes(): number[] {
  let seed = 7, t = 2.2
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296 }
  const out: number[] = []
  while (t < BLINK_CYCLE - 1) {
    out.push(t)
    if (random() < 1 / 12 && t + .6 < BLINK_CYCLE - 1) out.push(t + .26 + .04 * random())
    const normal = Math.sqrt(-2 * Math.log(Math.max(1e-9, random()))) * Math.cos(2 * Math.PI * random())
    t += Math.max(2, Math.min(12, 5 * Math.exp(.54 * normal)))
  }
  return out
}
let blinkFrames: { half: string; closed: string } | undefined
function blinkKeyframes(): { half: string; closed: string } {
  if (blinkFrames) return blinkFrames
  // four decimals: one step is 6 ms of the cycle, so the two keys a millisecond apart stay apart
  const at = (s: number) => n(100 * s / BLINK_CYCLE, 4) + '%'
  const half: string[] = ['0%{opacity:0}'], closed: string[] = ['0%{opacity:0}']
  for (const t of cocoBlinkTimes()) {
    const a = t, b = t + .033, c = t + .163, d = t + .213, e = .001
    half.push(`${at(a - e)}{opacity:0}`, `${at(a)}{opacity:1}`, `${at(b)}{opacity:1}`, `${at(b + e)}{opacity:0}`,
      `${at(c - e)}{opacity:0}`, `${at(c)}{opacity:1}`, `${at(d)}{opacity:1}`, `${at(d + e)}{opacity:0}`)
    closed.push(`${at(b - e)}{opacity:0}`, `${at(b)}{opacity:1}`, `${at(c)}{opacity:1}`, `${at(c + e)}{opacity:0}`)
  }
  half.push('100%{opacity:0}'); closed.push('100%{opacity:0}')
  return blinkFrames = { half: half.join(''), closed: closed.join('') }
}

let pictureSerial = 0
// label: what is drawn, data-coco="<outfit> <action>" on the picture (for tests and diagnostics)
function svgOf(list: readonly Segment[], data: CocoData, height: number, delayMs: number, still: boolean, label: string): string {
  const [W, H] = data.canvas
  // ids and keyframe names are the document's, so two pictures on one page must not share them
  const p = 'c' + (++pictureSerial).toString(36) + '_'
  const head = `<svg style="forced-color-adjust:none" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(W)} ${n(H)}" width="${n(height * W / H)}" height="${n(height)}" data-coco="${label}">`
  const sources = [...new Set(list.flatMap(s => s.part.elements.map(e => e.src)))]
  // a drawing left from the other outfit (after the shell change) is found in that outfit's pictures
  const png = (src: string) => data.images[src] ?? installed[data.outfit === 'A' ? 'B' : 'A']?.images[src] ?? ''
  const defs = sources.map((src, i) => `<image id="${p}i${i}" width="${n(W)}" height="${n(H)}" href="data:image/png;base64,${png(src)}"/>`)
  const rules = new Map<string, string>()
  const css: string[] = []
  const animation = (frames: string, seconds: number, start: number, loop: boolean): string => {
    let name = rules.get(frames)
    if (!name) { name = p + 'k' + rules.size; rules.set(frames, name); css.push(`@keyframes ${name}{${frames}}`) }
    // before its start nothing applies (the group's own opacity:0 hides it); a played-once track holds its end
    return `${name} ${n(seconds * 1000, 0)}ms linear ${n(start * 1000 + delayMs, 0)}ms ${loop ? 'infinite' : '1'} ${loop ? 'none' : 'forwards'}`
  }
  const body: string[] = []
  let start = 0, serial = 0
  const lids = new Map<string, number>()
  const eyesOf = (src: string) => data.eyes?.[src] ?? installed[data.outfit === 'A' ? 'B' : 'A']?.eyes?.[src]
  const socksOf = (src: string) => socksWorn[data.outfit]?.socks[src] ?? socksWorn[data.outfit === 'A' ? 'B' : 'A']?.socks[src]
  const socked = new Map<string, number>()
  for (const [index, seg] of list.entries()) {
    const looping = !!seg.loop && index === list.length - 1
    for (const e of seg.part.elements) {
      const k = serial++
      const style = (name: keyof typeof VALUE, track: Track): string | undefined => {
        const constant = track.length === 1, v = track[0]!
        if (constant && name !== 'a' && v.slice(1).every((x, i) => Math.abs(x - IDENTITY[name][i]!) < 1e-9)) return undefined
        if (still) return VALUE[name](v)
        const frames = constant ? `0%,100%{${VALUE[name](v)}}` : track.map(key => `${n(100 * key[0]! / seg.part.seconds, 3)}%{${VALUE[name](key)}}`).join('')
        return animation(frames, seg.part.seconds, start, looping)
      }
      const outer: string[] = [], put = (v?: string) => { if (v) outer.push(v) }
      put(style('a', e.a)); put(style('t', e.t))
      if (!looping && !still) outer.push(animation('0%,100%{opacity:0}', 1, start + seg.part.seconds, true))
      let g = `<use href="#${p}i${sources.indexOf(e.src)}"/>`
      // the pair of socks from their drawer, over the drawn ones, moved with the picture
      const socks = socksOf(e.src)
      if (socks) {
        let id = socked.get(e.src)
        if (id === undefined) {
          id = socked.size; socked.set(e.src, id)
          const [x, y, w, h] = socks.box.map(v => n(v!, 3))
          defs.push(`<image id="${p}s${id}" x="${x}" y="${y}" width="${w}" height="${h}" href="data:image/png;base64,${socks.img}"/>`)
        }
        g += `<use href="#${p}s${id}"/>`
      }
      // their blink, on a frame they hold in a loop, inside the part of the frame that holds their eyes
      const eyes = looping && !still ? eyesOf(e.src) : undefined
      if (eyes && !(e.clip_local && (e.clip_local[1]! > eyes.box[1]! || e.clip_local[3]! < eyes.box[1]! + eyes.box[3]!))) {
        let id = lids.get(e.src)
        if (id === undefined) {
          id = lids.size; lids.set(e.src, id)
          const [x, y, w, h] = eyes.box.map(v => n(v!, 3))
          defs.push(`<image id="${p}h${id}" x="${x}" y="${y}" width="${w}" height="${h}" href="data:image/png;base64,${eyes.half}"/>`,
            `<image id="${p}c${id}" x="${x}" y="${y}" width="${w}" height="${h}" href="data:image/png;base64,${eyes.closed}"/>`)
        }
        const frames = blinkKeyframes()
        const blink = (body: string) => animation(body, BLINK_CYCLE, 0, true)
        g += `<use href="#${p}h${id}" style="opacity:0;animation:${blink(frames.half)}"/><use href="#${p}c${id}" style="opacity:0;animation:${blink(frames.closed)}"/>`
      }
      const origin = `transform-origin:${n(e.origin[0])}px ${n(e.origin[1])}px`
      const sc = style('s', e.s); if (sc) g = `<g style="${origin};${still ? sc : `animation:${sc}`}">${g}</g>`
      const rt = style('r', e.r); if (rt) g = `<g style="${origin};${still ? rt : `animation:${rt}`}">${g}</g>`
      if (e.clip_local) { defs.push(`<clipPath id="${p}l${k}">${rect(e.clip_local)}</clipPath>`); g = `<g clip-path="url(#${p}l${k})">${g}</g>` }
      if (still) {
        const [o] = e.a[0]!.slice(1), tr = style('t', e.t)
        g = `<g style="opacity:${n(o!, 3)}${tr ? ';' + tr : ''}">${g}</g>`
      } else g = `<g style="opacity:0;animation:${outer.join(',')}">${g}</g>`
      if (e.clip_final) { defs.push(`<clipPath id="${p}f${k}">${rect(e.clip_final)}</clipPath>`); g = `<g clip-path="url(#${p}f${k})">${g}</g>` }
      body.push(g)
    }
    start += seg.part.seconds
  }
  return `${head}<defs>${defs.join('')}</defs>${css.length ? `<style>${css.join('')}</style>` : ''}${body.join('')}</svg>`
}

// The play as an SVG height px tall, synchronised to now. Reduced motion: only the pose, drawn still
// (the owner's 「开了「减弱动态」只换姿势不动」).
const pictures = new Map<string, string>()
export function cocoPicture(play: CocoPlay, height: number, now: number, reducedMotion = false): string {
  const key = `${play.outfit}:${play.action}:${play.base}:${play.at}:${play.once ? 1 : 0}:${height}:${reducedMotion ? 1 : 0}:${socksWorn.A?.pair ?? ''}:${socksWorn.B?.pair ?? ''}`
  let svg = pictures.get(key)
  if (svg === undefined) {
    // built once per play, already as far in as now: the same string again lets a surface keep the
    // picture it is playing
    svg = cocoSvg(play, height, now, reducedMotion)
    pictures.set(key, svg)
    while (pictures.size > 16) pictures.delete(pictures.keys().next().value!)
  }
  return svg
}
// One still of hers in an outfit: the pose held, or her idle one before that outfit's data has it ('' before even that).
export function cocoStill(outfit: CocoOutfit, wanted: CocoActionKey, height: number): string {
  const action: CocoActionKey = cocoHas(outfit, wanted) ? wanted : 'idle'
  return cocoHas(outfit, action) ? cocoPicture({ outfit, action, base: action, at: 0 }, height, 0, true) : ''
}
export function cocoSvg(play: CocoPlay, height: number, now: number, reducedMotion = false): string {
  const data = installed[play.outfit]
  if (!data) throw new Error('Coco data is not installed')
  const list = segments(play)
  if (reducedMotion) {
    const action = data.actions[play.action]!
    const part = action.loop ?? action.body
    const at = action.loop ? 0 : part.seconds - 1e-3
    return svgOf([{ part: { seconds: 1, elements: drawnAt([{ part }], at) } }], data, height, 0, true, `${play.outfit} ${play.action}`)
  }
  return svgOf(list, data, height, -(Math.max(0, now - play.at)), false, `${play.outfit} ${play.action}`)
}
