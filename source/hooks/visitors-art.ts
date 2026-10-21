// What a visit looks like: the pixel visitors on his band picture, the terminal's half blocks, the guest
// book's portrait, and the words. Everything is read from visitor-art.json and visitors-text.json the first
// time a visit is drawn; nothing here runs at startup.
import { isVisitorKind, visitorKey } from './visitors'
import type { CellOverlay } from './pictures-lazy'
import type { GuestBook } from './book'
import type { Visit, VisitorKind } from './visitors'

type Grid = { rows: string[]; pal: string[] }
type KindArt = {
  w: number; h: number
  sit: { light: string; dark: string }
  px: { light: Grid; dark: Grid }
  pixel: [number, number]; term: [number, number]; band: [number, number, number]
  room: { x: number; y: number; 1: string; 2: string }
  lit?: { x: number; y: number; w: number; h: number; 1: string; 2: string }
  bandGlow?: { r: number; png: string }
  pixelGlow?: { r: number; png: string }
  /** Where the light's centre sits on the sprite, in art pixels from its top left. */
  glowCentre?: [number, number]
}
type Art = { v: 1; kinds: Record<VisitorKind, KindArt> }
type Table = Record<string, Record<string, string>>

let art: Art | undefined
let text: Table | undefined
let loadingArt: Promise<void> | undefined
let loadingText: Promise<void> | undefined

/** The words alone, for the Settings row and the guest book; a missing or malformed file leaves them unsaid. */
export function loadVisitorWords(read: (path: string) => Promise<string>): Promise<void> {
  if (text) return Promise.resolve()
  return loadingText ??= read('hooks/visitors-text.json').catch(() => '').then(raw => {
    try { const value = JSON.parse(raw) as Table; if (value && typeof value === 'object' && !Array.isArray(value)) text = value } catch { /* unsaid */ }
    text ??= {}
  }).finally(() => { loadingText = undefined })
}
/** The art and the words, read once. A missing or malformed art file leaves the visit undrawn, never an error. */
export function loadVisitorData(read: (path: string) => Promise<string>): Promise<void> {
  const pictures = art ? Promise.resolve() : loadingArt ??= read('hooks/visitor-art.json').catch(() => '').then(raw => {
    try { const value = JSON.parse(raw) as Art; if (value?.v === 1 && value.kinds && typeof value.kinds === 'object') art = value } catch { /* undrawn */ }
  }).finally(() => { loadingArt = undefined })
  return Promise.all([pictures, loadVisitorWords(read)]).then(() => undefined)
}
export function forgetVisitorData(): void { art = undefined; text = undefined; loadingArt = undefined; loadingText = undefined }
export function visitorArtReady(): boolean { return art !== undefined }
export function visitorWordsReady(): boolean { return text !== undefined }

/** One word or sentence in a language, English when that is missing, empty when neither exists. Slots are `{name}`. */
export function visitorWord(lang: string, key: string, values: Record<string, string | number> = {}): string {
  const entry = text?.[key]
  const own = entry?.[lang] ?? entry?.en
  return typeof own === 'string' ? own.replace(/\{([^}]+)\}/g, (token, name: string) => values[name] === undefined ? token : String(values[name])) : ''
}
export function visitorHasWord(lang: string, key: string): boolean { return visitorWord(lang, key) !== '' }

/**
 * The stage direction in the two narrow places, 24 columns and a desktop band under 480 px: the short name leads it, so a cut
 * at its end never takes the name. The words give the direction whole, with the creature's name in its opening, so the opening
 * name (or the short name inside it, past an article) is made the short name; a direction that does not open with either
 * becomes the short name alone.
 */
export function visitorNarrowDirection(lang: string, kind: VisitorKind): string | undefined {
  const direction = visitorWord(lang, visitorKey('aside.visitor', kind)), short = visitorWord(lang, visitorKey('visitor.short', kind))
  if (!direction || !short) return undefined
  const open = /^[(（]/.test(direction) ? direction[0]! : '', close = open && /[)）]$/.test(direction) ? direction.at(-1)! : ''
  const body = direction.slice(open.length)
  const name = visitorWord(lang, visitorKey('visitor.name', kind))
  if (body.startsWith(short)) return direction
  if (name && body.startsWith(name)) return open + short + body.slice(name.length)
  const at = body.indexOf(short)
  if (at > 0 && at <= 12) return open + body.slice(at)
  return open + short + close
}

// ---------------------------------------------------------------- the band picture

const MS = { glideFrom: 1400, glide: 640, squashIn: 60, settle: 240, crouch: 80, flyOff: 420, fade: 160 } as const
const f = (n: number): string => String(Number(n.toFixed(3)))
// The ones that fly in on a glide; the rest hop, slide, or drift down.
const GLIDERS = new Set<VisitorKind>(['plane', 'note'])
const STYLE = '.vl{display:inline}.vd{display:none}@media(prefers-color-scheme:dark){.vl{display:none}.vd{display:inline}}'
const STAGE_MS = MS.glideFrom + MS.glide + MS.squashIn + MS.settle

/** The house spring, displacement 1 to 0 (mass .5, stiffness 220, damping 12.6). */
function spring(ms: number): number {
  const w0 = Math.sqrt(220 / 0.5), z = 12.6 / (2 * Math.sqrt(220 * 0.5)), t = ms / 1000
  if (z >= 1) return Math.exp(-w0 * t) * (1 + w0 * t)
  const wd = w0 * Math.sqrt(1 - z * z)
  return Math.exp(-z * w0 * t) * (Math.cos(wd * t) + (z * w0 / wd) * Math.sin(wd * t))
}

function bezier(p1x: number, p1y: number, p2x: number, p2y: number): (x: number) => number {
  const at = (t: number, a: number, b: number): number => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3
  return x => { let lo = 0, hi = 1; for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (at(mid, p1x, p2x) < x) lo = mid; else hi = mid } return at((lo + hi) / 2, p1y, p2y) }
}
const OUT = bezier(0.16, 1, 0.3, 1) // a confident arrival
const IN = bezier(0.4, 0, 1, 1) // an accelerating exit
const DIP = bezier(0, 0, 0.2, 1)

type Pose = { x: number; y: number; o: number; sy: number }
/** Keyframes from a pose function sampled every 16 ms, positions in frame px; `total` ms long. */
function track(name: string, total: number, pose: (t: number) => Pose): string {
  const rows: string[] = []
  const last = Math.ceil(total / 16)
  for (let i = 0; i <= last; i++) {
    const t = Math.min(total, i * 16), p = pose(t)
    rows.push(`${f(t / total * 100)}%{transform:translate(${f(p.x)}px,${f(p.y)}px) scaleY(${f(p.sy)});opacity:${f(p.o)}}`)
  }
  return `@keyframes ${name}{${rows.join('')}}`
}
/** After landing: a 60 ms squash to .88 about the feet, then back on the house spring. */
function landing(t: number): number { return t < MS.squashIn ? 1 - 0.12 * DIP(t / MS.squashIn) : 1 - 0.12 * spring(t - MS.squashIn) }

type Arrive = { ms: number; at: (t: number) => Pose }
function arrival(kind: VisitorKind): Arrive {
  if (GLIDERS.has(kind)) return { ms: MS.glide, at: t => { const e = OUT(t / MS.glide); return { x: -34 * (1 - e), y: -30 * (1 - e), o: Math.min(1, t / 120), sy: 1 } } }
  if (kind === 'keycap') return { ms: 480, at: t => { const local = t < 240 ? t / 240 : (t - 240) / 240; return { x: -60 * (1 - t / 480), y: -10 * 4 * local * (1 - local), o: 1, sy: 1 } } } // two hops of 240 ms, each an arc 10 px high
  if (kind === 'cursor') return { ms: 300, at: t => ({ x: -60 * (1 - OUT(t / 300)), y: 0, o: 1, sy: 1 }) } // the arrow slides in, straight
  if (kind === 'leaf') return { ms: 800, at: t => ({ x: 3 * Math.sin(t / 800 * Math.PI * 2), y: -10 * (1 - t / 800), o: Math.min(1, t / 200), sy: 1 }) } // the leaf sways down
  if (kind === 'snowman') return { ms: 600, at: t => ({ x: 0, y: 0, o: t / 600, sy: 1 }) }
  return { ms: 800, at: t => ({ x: 0, y: -6 * (1 - t / 800), o: t / 800, sy: 1 }) } // the bulb, the ghost and the USB light drift down, the light rising
}
type Depart = { ms: number; fade: number; at: (t: number) => Pose }
function departure(kind: VisitorKind): Depart {
  if (GLIDERS.has(kind)) return { ms: MS.flyOff, fade: MS.fade, at: t => { const e = IN(t / MS.flyOff); return { x: -40 * e, y: -34 * e, o: t < MS.flyOff - MS.fade ? 1 : Math.max(0, (MS.flyOff - t) / MS.fade), sy: 1 } } }
  if (kind === 'keycap') return { ms: 280, fade: 1, at: t => ({ x: -60 * t / 280, y: -10 * 4 * (t / 280) * (1 - t / 280), o: 1, sy: 1 }) }
  if (kind === 'cursor') return { ms: 260, fade: 1, at: t => ({ x: -60 * IN(t / 260), y: 0, o: 1, sy: 1 }) }
  if (kind === 'snowman') return { ms: 300, fade: 300, at: t => ({ x: 0, y: 0, o: 1 - t / 300, sy: 1 }) }
  return { ms: 400, fade: 400, at: t => ({ x: 0, y: -8 * t / 400, o: 1 - t / 400, sy: 1 }) }
}

/** Arrival keyframes `name`: time 0 is the moment he is drawn asleep plus 1.4 s. */
function arriveCss(kind: VisitorKind, name: string): { css: string; total: number } {
  const m = arrival(kind), total = m.ms + MS.squashIn + MS.settle
  return { total, css: track(name, total, t => t < m.ms ? m.at(t) : { x: 0, y: 0, o: 1, sy: landing(t - m.ms) }) }
}
/** Taking-off keyframes: an 80 ms crouch, then away, faster than the arrival. */
function leaveCss(kind: VisitorKind, name: string): { css: string; total: number } {
  const d = departure(kind), total = MS.crouch + d.ms
  return { total, css: track(name, total, t => t < MS.crouch ? { x: 0, y: 0, o: 1, sy: 1 - 0.1 * DIP(t / MS.crouch) } : d.at(t - MS.crouch)) }
}

function insertBranches(source: string, normal: string, reduced: string): string {
  type G = { cls: string; parent?: G; end?: number }
  const groups: G[] = [], stack: G[] = []
  for (const match of source.matchAll(/<\/?g\b[^>]*>/g)) {
    const tag = match[0]
    if (tag.startsWith('</g')) { const g = stack.pop(); if (g) g.end = match.index }
    else if (!tag.endsWith('/>')) { const g: G = { cls: /class="([^"]+)"/.exec(tag)?.[1] ?? '', parent: stack.at(-1) }; groups.push(g); stack.push(g) }
  }
  const active = groups.find(g => g.cls === 'moroot' || g.cls === 'c3animated'), still = groups.find(g => g.cls === 'mostill' || g.cls === 'c3still')
  if (!active) return source.replace(/<\/svg>$/, normal + '</svg>')
  const within = (g: G): boolean => { for (let h: G | undefined = g; h; h = h.parent) if (h === active) return true; return false }
  const target = groups.filter(g => ['mosway', 'mobreath', 'moshift', 'mogesture'].includes(g.cls) && within(g)).at(-1) ?? active
  const inserts = [{ at: target.end, value: normal }, { at: still?.end, value: reduced }].filter((x): x is { at: number; value: string } => x.at !== undefined).sort((a, b) => b.at - a.at)
  for (const insert of inserts) source = source.slice(0, insert.at) + insert.value + source.slice(insert.at)
  return source
}

function sitImages(k: KindArt, pixel: boolean): string {
  const [x, y] = pixel ? k.pixel : [k.band[0], k.band[1]], scale = pixel ? 1 : k.band[2]
  const at = `x="${x}" y="${y}" width="${k.w * scale}" height="${k.h * scale}" style="image-rendering:pixelated"`
  return `<image class="vl" href="data:image/png;base64,${k.sit.light}" ${at}/><image class="vd" href="data:image/png;base64,${k.sit.dark}" ${at}/>`
}
function glowImage(k: KindArt, pixel: boolean): string {
  const glow = pixel ? k.pixelGlow : k.bandGlow
  if (!glow) return ''
  const r = glow.r, scale = pixel ? 1 : k.band[2], [x, y] = pixel ? k.pixel : [k.band[0], k.band[1]], [cx, cy] = k.glowCentre ?? [0, 0]
  return `<image href="data:image/png;base64,${glow.png}" x="${x + cx * scale - r}" y="${y + cy * scale - r}" width="${2 * r + 1}" height="${2 * r + 1}"/>`
}

/** Where the visit is in its story at `now`. Pixel contexts only cut: there, a visit is sitting or gone. */
export function visitPhase(visit: Visit, now: number, pixel: boolean): 'arriving' | 'sitting' | 'leaving' | 'gone' {
  if (visit.leftAt !== undefined) return pixel || now >= visit.leftAt + MS.crouch + departure(visit.kind).ms ? 'gone' : 'leaving'
  return pixel || now >= visit.at + STAGE_MS ? 'sitting' : 'arriving'
}
/** What the cached picture depends on besides the frame: the visit and its phase (a quarter second at a time while it arrives). */
export function visitorPictureKey(visit: Visit | undefined, now: number, pixel: boolean): string {
  if (!visit) return ''
  const phase = visitPhase(visit, now, pixel)
  return `${visit.id}:${phase}${phase === 'arriving' ? Math.floor((now - visit.at) / 250) : phase === 'leaving' ? Math.floor((now - visit.leftAt!) / 250) : ''}`
}

/** The band's picture with the visitor on him: arriving, sitting, or taking off. Unchanged when it has nothing to add. */
// place: a transform from the old painted band's perches onto another picture's canvas (Coco's, A lane 10-14)
export function visitorPicture(source: string, visit: Visit, o: { pixel: boolean; reduced: boolean; now: number; place?: string }): string {
  const k = isVisitorKind(visit.kind) ? art?.kinds[visit.kind] : undefined
  if (!k) return source
  const phase = visitPhase(visit, o.now, o.pixel)
  if (phase === 'gone') return source
  const images = glowImage(k, o.pixel) + sitImages(k, o.pixel)
  const sit = o.place ? `<g transform="${o.place}">${images}</g>` : images
  const style = (css = ''): string => `<style>${STYLE}${css}</style>`
  const both = (fragment: string): string => insertBranches(source, fragment, fragment)
  if (phase === 'sitting') return both(`${style()}<g class="vis">${sit}</g>`)
  // Reduced motion changes opacity only, over 200 ms.
  const fadeIn = `${style('@keyframes visfade{from{opacity:0}to{opacity:1}}')}<g class="vis" style="animation:visfade 200ms linear ${visit.at + MS.glideFrom - o.now}ms both">${sit}</g>`
  const fadeOut = (): string => `${style('@keyframes visout{from{opacity:1}to{opacity:0}}')}<g class="vis" style="animation:visout 200ms linear ${visit.leftAt! - o.now}ms both">${sit}</g>`
  if (phase === 'arriving') {
    if (o.reduced) return both(fadeIn)
    const { css, total } = arriveCss(visit.kind, 'visarrive')
    const moving = `${style(css)}<g class="vis" style="transform-box:fill-box;transform-origin:50% 100%;animation:visarrive ${total}ms linear ${visit.at + MS.glideFrom - o.now}ms both">${sit}</g>`
    return insertBranches(source, moving, fadeIn)
  }
  if (o.reduced) return both(fadeOut())
  const { css, total } = leaveCss(visit.kind, 'visleave')
  const moving = `${style(css)}<g class="vis" style="transform-box:fill-box;transform-origin:50% 100%;animation:visleave ${total}ms linear ${visit.leftAt! - o.now}ms both">${sit}</g>`
  return insertBranches(source, moving, fadeOut())
}

/** The first reply's head after a visit: the visitor on his small picture, top left, whatever the kind. It stays with that head. */
export function visitorHeadPicture(source: string, kind: string): string {
  const k = isVisitorKind(kind) ? art?.kinds[kind] : undefined
  if (!k) return source
  const fragment = `<style>${STYLE}</style><g class="vis">${sitImages({ ...k, pixel: [0, 0] }, true)}</g>`
  return insertBranches(source, fragment, fragment)
}

// ---------------------------------------------------------------- the terminal

const CUBE = [0, 95, 135, 175, 215, 255]
const near = (v: number): number => CUBE.reduce((a, b) => Math.abs(a - v) <= Math.abs(b - v) ? a : b)
/** The sprite as half-block pixels in his 35 x 18 sleep crop. Its edge follows the host theme, as the ribbon does. */
export function visitorCellOverlay(kind: string, colors: 'truecolor' | '256', darkGround: boolean): CellOverlay | undefined {
  if (!isVisitorKind(kind)) return undefined
  const k = art?.kinds[kind]
  if (!k) return undefined
  const grid = darkGround ? k.px.dark : k.px.light
  const rgb = grid.pal.map(hex => {
    const n = parseInt(hex.slice(1), 16)
    return colors === '256' ? near(n >> 16) << 16 | near(n >> 8 & 255) << 8 | near(n & 255) : n
  })
  return { key: `${kind}:${colors}:${darkGround ? 'd' : 'l'}`, x: k.term[0], y: k.term[1], rows: grid.rows, rgb }
}

// ---------------------------------------------------------------- the guest book

/** A portrait: the sprite at two CSS px per art pixel, centred on a 44 px square of his paper, night paper after dark. */
export function visitorPortrait(kind: string, night: boolean): string {
  const k = isVisitorKind(kind) ? art?.kinds[kind] : undefined
  if (!k) return ''
  const w = k.w * 2, h = k.h * 2, x = Math.round((44 - w) / 2), y = Math.round((44 - h) / 2)
  const paper = night ? '#2B3A5E' : '#FAEEE9', edge = night ? '#1F2A47' : '#E4C7BC'
  const [cx, cy] = k.glowCentre ?? [0, 0]
  const glow = night && k.pixelGlow ? `<image href="data:image/png;base64,${k.pixelGlow.png}" x="${x + cx * 2 - k.pixelGlow.r * 2}" y="${y + cy * 2 - k.pixelGlow.r * 2}" width="${(2 * k.pixelGlow.r + 1) * 2}" height="${(2 * k.pixelGlow.r + 1) * 2}"/>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 44" width="44" height="44" style="forced-color-adjust:none"><style>.p{fill:${paper};stroke:${edge}}@media(prefers-contrast:more){.p{stroke:#8E8481}}</style><rect class="p" x=".5" y=".5" width="43" height="43" rx="3"/>${glow}<image href="data:image/png;base64,${k.sit.light}" x="${x}" y="${y}" width="${w}" height="${h}" style="image-rendering:pixelated"/></svg>`
}

// ---------------------------------------------------------------- the guest book page's data
// His visitors, newest first, one month at a time: a portrait, when it came, and who it was. No counts of kinds or visits, no
// blank slots, nothing about the work.

function parts(at: number, tz: string | undefined): { y: number; m: number; hour: number } {
  let list: Intl.DateTimeFormatPart[]
  try { list = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'numeric', hour: 'numeric', hourCycle: 'h23', timeZone: tz }).formatToParts(new Date(at)) }
  catch { list = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'numeric', hour: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(at)) }
  const n = (type: string): number => Number(list.find(p => p.type === type)?.value ?? 0)
  return { y: n('year'), m: n('month'), hour: n('hour') % 24 }
}
function format(lang: string, options: Intl.DateTimeFormatOptions, at: number, tz?: string): string {
  try { return new Intl.DateTimeFormat(lang, { ...options, timeZone: tz }).format(new Date(at)) }
  catch { return new Intl.DateTimeFormat('en', options).format(new Date(at)) }
}
const monthName = (lang: string, y: number, m: number): string => format(lang, { month: 'long' }, Date.UTC(y, m - 1, 15, 12), 'UTC')
const sameLanguage = (lang: string): string => lang === 'zh-Hant' ? 'zh-TW' : lang

/** The page while his notes are being read, the first time it opens in a session. */
export function guestBookReading(lang: string, fallbackTitle: string, backLabel: string): GuestBook {
  return { title: visitorWord(lang, 'visitors.title') || fallbackTitle, direction: visitorWord(lang, 'visitors.direction'), back: backLabel, rows: [], state: 'reading', text: visitorWord(lang, 'visitors.reading') }
}

/** `index` counts months back from the newest month that holds a visit. */
export function guestBook(visits: readonly Visit[] | undefined, index: number, lang: string, tz: string | undefined, fallbackTitle: string, backLabel: string): GuestBook {
  const locale = sameLanguage(lang)
  const base = { title: visitorWord(lang, 'visitors.title') || fallbackTitle, direction: visitorWord(lang, 'visitors.direction'), back: backLabel, rows: [] }
  if (visits === undefined) return { ...base, state: 'unreadable', text: visitorWord(lang, 'visitors.unreadable', { path: '' }).replace(/[:：]\s*$/, '') }
  if (!visits.length) return { ...base, state: 'empty', text: visitorWord(lang, 'visitors.empty') }
  const keyed = [...visits].sort((a, b) => b.at - a.at).map(visit => ({ visit, ...parts(visit.at, tz) }))
  const months: { y: number; m: number }[] = []
  for (const row of keyed) if (!months.some(x => x.y === row.y && x.m === row.m)) months.push({ y: row.y, m: row.m })
  const at = Math.max(0, Math.min(months.length - 1, Math.floor(index) || 0)), here = months[at]!
  const older = months[at + 1], newer = months[at - 1]
  return {
    ...base, state: 'list',
    month: format(locale, { month: 'long', year: 'numeric' }, Date.UTC(here.y, here.m - 1, 15, 12), 'UTC'),
    rows: keyed.filter(row => row.y === here.y && row.m === here.m).map(({ visit, hour }) => ({
      id: visit.id,
      portrait: visitorPortrait(visit.kind, hour >= 19 || hour < 6),
      when: format(locale, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, visit.at, tz),
      name: visitorWord(lang, visitorKey('visitor.name', visit.kind)),
    })),
    ...(older ? { previous: `‹ ${monthName(locale, older.y, older.m)}` } : {}),
    ...(newer ? { next: `${monthName(locale, newer.y, newer.m)} ›` } : {}),
  }
}
