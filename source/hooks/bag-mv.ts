// The bag's pictures in the duotone MV style (owner 10-17: both styles stay, the person picks, the current one by
// default; lane A's drawing, handoffs/program/design/1.0/mv-bag/tools/mv_bag.py). A deep navy ground, Claude coral and
// cream, a ring of bars behind the bag, the bag's window showing the page's reading as code (an off call struck
// through) and the page's one number in slab letters on a band under a rule; where the window is narrow, small marks
// of the same reading instead of code. Coco peeks in at the right in the same flat colours (bag-peek-mv.png).
import { contrastSvg } from './high-contrast'
import { MV_GLYPHS } from './bag-mv-glyphs'
import type { BagPeek } from './bag'

const GROUND = '#131C30', PANEL = '#1C2942', CORAL = '#D97757', CORAL_DEEP = '#A64E34', CREAM = '#F6EBDD', MUTED = '#8C9AB6', INK = '#0E1526'
const MONO = "ui-monospace,'SF Mono',Menlo,Consolas,'DejaVu Sans Mono',monospace"
const PEEK_EDGE = 223 / 236 // the line Coco holds, in the drawing
const SIZES = ['XS', 'S', 'M', 'L'] as const

// One reading a page, as the classic pictures read them (book.tsx bagHead).
export type MvReading =
  | { page: 'him'; switches: readonly boolean[]; size?: number }
  | { page: 'offerings'; five?: number; week?: number }
  | { page: 'omen'; failed: number; fixed: number; compacted: number; rarity: 'R' | 'SR' | 'SSR' }
  | { page: 'socks'; worn: string; have: number; all: number }
  | { page: 'log'; issues: readonly number[] }
  | { page: 'library'; notes: number }
  | { page: 'settings'; switches: readonly boolean[] }
type Page = MvReading['page']
const PAGE_SEED: Record<Page, number> = { him: 1, offerings: 2, omen: 3, socks: 4, log: 5, library: 6, settings: 7 }

const n1 = (v: number): number => Math.round(v * 10) / 10
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export const bagMvHeight = (width: number): number => width > 400 ? 250 : 176

function seeded(seed: number): () => number {
  let state = seed || 1
  return () => { state = (state * 1664525 + 1013904223) % 4294967296; return state / 4294967296 }
}

// Alfa Slab One letters as paths, cap high; the svg and how far it advanced.
function slab(text: string, x: number, baseline: number, cap: number, fill?: string, stroke?: string, width = 1.6): [string, number] {
  const k = cap / MV_GLYPHS.capHeight, parts: string[] = []
  let at = x
  for (const ch of text) {
    const g = MV_GLYPHS.glyphs[ch]
    if (!g) continue
    const paint = fill ? `fill="${fill}"` : `fill="none" stroke="${stroke}" stroke-width="${n1(width / k)}" stroke-linejoin="round"`
    if (g.d) parts.push(`<path transform="translate(${n1(at)} ${n1(baseline)}) scale(${k.toFixed(5)} ${(-k).toFixed(5)})" d="${g.d}" ${paint}/>`)
    at += g.advance * k
  }
  return [parts.join(''), at - x]
}
const slabWidth = (text: string, cap: number): number => [...text].reduce((sum, ch) => sum + (MV_GLYPHS.glyphs[ch]?.advance ?? 0), 0) * cap / MV_GLYPHS.capHeight

// The ring of bars behind the bag, the MV's rays: straight bars of even width set apart from the disc, their lengths
// uneven like a sound meter (no wedges from the disc's edge to the frame, so nothing reads as a rising-sun flag).
function bars(cx: number, cy: number, r0: number, lmin: number, lmax: number, count: number, width: number, seed: number): string {
  const rnd = seeded(seed), out: string[] = []
  for (let i = 0; i < count; i++) {
    const a = 2 * Math.PI * i / count - Math.PI / 2, t = 0.3 + 0.7 * rnd(), length = lmin + (lmax - lmin) * t ** 1.4
    out.push(`<path d="M${n1(cx + r0 * Math.cos(a))} ${n1(cy + r0 * Math.sin(a))}L${n1(cx + (r0 + length) * Math.cos(a))} ${n1(cy + (r0 + length) * Math.sin(a))}" stroke="${CORAL}" stroke-width="${n1(width)}"/>`)
  }
  return out.join('')
}

function gear(cx: number, cy: number, r: number, teeth = 8): string {
  const pts: string[] = []
  for (let i = 0; i < teeth * 4; i++) {
    const a = 2 * Math.PI * i / (teeth * 4) - Math.PI / 2, rr = i % 4 < 2 ? r : r * 0.78
    pts.push(`${n1(cx + rr * Math.cos(a))} ${n1(cy + rr * Math.sin(a))}`)
  }
  return 'M' + pts.join(' L') + ' Z'
}

type Window = (x: number, y: number, w: number, h: number) => string

// The bag as one flat shape, like the heart in the MV: a coral tote a little wider at the bottom, stitched, its darker
// base, the black strap, the gear pinned at its corner and the itabag's window, stitched in, showing the reading.
function bag(cx: number, cy: number, bw: number, bh: number, window: Window, id: string): string {
  const x = cx - bw / 2, y = cy - bh / 2, inset = bw * 0.04, r = bh * 0.1
  const tote = (grow: number): string => {
    const t = x + inset - grow, b = x + bw - inset + grow, l = x - grow, rr = x + bw + grow, top = y - grow, bot = y + bh + grow
    return `M${n1(t + r)} ${n1(top)}H${n1(b - r)}Q${n1(b)} ${n1(top)} ${n1(b + r * 0.25)} ${n1(top + r)}`
      + `L${n1(rr)} ${n1(bot - r)}Q${n1(rr)} ${n1(bot)} ${n1(rr - r)} ${n1(bot)}H${n1(l + r)}Q${n1(l)} ${n1(bot)} ${n1(l)} ${n1(bot - r)}`
      + `L${n1(t - r * 0.25)} ${n1(top + r)}Q${n1(t)} ${n1(top)} ${n1(t + r)} ${n1(top)}Z`
  }
  const out = [`<path d="M${n1(x + bw * 0.26)} ${n1(y + 3)}C${n1(x + bw * 0.26)} ${n1(y - bh * 0.44)} ${n1(x + bw * 0.74)} ${n1(y - bh * 0.44)} ${n1(x + bw * 0.74)} ${n1(y + 3)}" fill="none" stroke="${INK}" stroke-width="${n1(bh * 0.075)}"/>`,
    `<path d="${tote(0)}" fill="${CORAL}" stroke="${INK}" stroke-width="3"/>`,
    `<clipPath id="mv-base-${id}"><path d="${tote(-1.5)}"/></clipPath>`,
    `<rect x="${n1(x)}" y="${n1(y + bh * 0.84)}" width="${n1(bw)}" height="${n1(bh * 0.2)}" fill="${CORAL_DEEP}" clip-path="url(#mv-base-${id})"/>`,
    `<path d="${tote(-bh * 0.06)}" fill="none" stroke="${CORAL_DEEP}" stroke-width="1.3" stroke-dasharray="4 3"/>`]
  const wx = x + bw * 0.1, wy = y + bh * 0.16, ww = bw * 0.8, wh = bh * 0.6
  out.push(`<rect x="${n1(wx - 4)}" y="${n1(wy - 4)}" width="${n1(ww + 8)}" height="${n1(wh + 8)}" rx="6" fill="${CREAM}" stroke="${INK}" stroke-width="2.5"/>`,
    `<rect x="${n1(wx - 1.5)}" y="${n1(wy - 1.5)}" width="${n1(ww + 3)}" height="${n1(wh + 3)}" rx="4" fill="none" stroke="${CORAL_DEEP}" stroke-width="1" stroke-dasharray="3 2.5"/>`,
    `<rect x="${n1(wx)}" y="${n1(wy)}" width="${n1(ww)}" height="${n1(wh)}" rx="3" fill="${PANEL}"/>`, window(wx, wy, ww, wh))
  const gr = bh * 0.15, gx = x + bw - inset * 0.6, gy = y + bh * 0.08
  out.push(`<circle cx="${n1(gx)}" cy="${n1(gy)}" r="${n1(gr * 1.25)}" fill="${CREAM}" stroke="${INK}" stroke-width="2.2"/>`,
    `<path d="${gear(gx, gy, gr)}" fill="${INK}"/><circle cx="${n1(gx)}" cy="${n1(gy)}" r="${n1(gr * 0.45)}" fill="${CORAL}"/>`)
  return out.join('')
}

type Line = [text: string, kind: 'comment' | 'on' | 'off']
// The code in the window: a comment, then calls; an off one is struck through and dimmed, like the MV's withdrawn request.
const code = (lines: readonly Line[]): Window => (x, y, w, h) => {
  const longest = Math.max(...lines.map(([t]) => t.length))
  const size = Math.min(11.5, (w - 12) / (longest * 0.6), h / (lines.length * 1.45 + 0.5)), lead = size * 1.45, cw = size * 0.6
  const top = y + (h - lead * (lines.length - 1) - size) / 2
  return lines.map(([text, kind], i) => {
    const base = top + size * 0.8 + i * lead
    return `<text x="${n1(x + 6)}" y="${n1(base)}" font-family="${MONO}" font-size="${n1(size)}" fill="${kind === 'on' ? CREAM : MUTED}" xml:space="preserve">${esc(text)}</text>`
      + (kind === 'off' ? `<path d="M${n1(x + 5)} ${n1(base - size * 0.32)}h${n1(text.length * cw + 2)}" stroke="${CREAM}" stroke-width="1.2"/>` : '')
  }).join('')
}

// Where the window is too small for code: the pet's switches as flat pills, coral with the knob right when on.
const pills = (states: readonly boolean[]): Window => (x, y, w, h) => {
  const pw = Math.min(w * 0.26, 30), ph = pw * 0.52, gap = (w - pw * states.length) / (states.length + 1)
  return states.map((on, i) => {
    const px = x + gap + i * (pw + gap), py = y + (h - ph) / 2, knob = on ? px + pw - ph / 2 : px + ph / 2
    return `<rect x="${n1(px)}" y="${n1(py)}" width="${n1(pw)}" height="${n1(ph)}" rx="${n1(ph / 2)}" fill="${on ? CORAL : 'none'}" stroke="${CREAM}" stroke-width="1.4"/>`
      + `<circle cx="${n1(knob)}" cy="${n1(py + ph / 2)}" r="${n1(ph * 0.3)}" fill="${CREAM}"/>`
  }).join('')
}

// The doujin's last weeks as tabs, an issue coral, a missed week only its outline.
const weeks = (issues: readonly number[], count = 8): Window => (x, y, w, h) => {
  const last = issues.at(-1) ?? 0
  const nums = Array.from({ length: Math.min(count, Math.max(1, last)) }, (_, i) => Math.max(1, last - count + 1) + i), tw = (w - 10) / nums.length
  return nums.map((n, i) => {
    const got = issues.includes(n), tx = x + 5 + i * tw
    return `<rect x="${n1(tx + tw * 0.16)}" y="${n1(y + h * 0.24)}" width="${n1(tw * 0.68)}" height="${n1(h * 0.52)}" rx="1.5" fill="${got ? CORAL : 'none'}" stroke="${got ? CREAM : MUTED}" stroke-width="1.2"/>`
  }).join('')
}

// The switches page: every switch a small pill, rows of six.
const switchGrid = (states: readonly boolean[], per = 6): Window => (x, y, w, h) => {
  const rows = Math.max(1, Math.ceil(states.length / per)), pw = Math.min((w - 10) / per * 0.78, (h - 6) / rows / 0.75 * 0.9), ph = pw * 0.5
  return states.map((on, k) => {
    const row = Math.floor(k / per), col = k % per
    const px = x + (w - per * pw / 0.78) / 2 + col * pw / 0.78 + pw * 0.11, py = y + (h - rows * ph * 1.6) / 2 + row * ph * 1.6 + ph * 0.3
    const knob = on ? px + pw - ph / 2 : px + ph / 2
    return `<rect x="${n1(px)}" y="${n1(py)}" width="${n1(pw)}" height="${n1(ph)}" rx="${n1(ph / 2)}" fill="${on ? CORAL : 'none'}" stroke="${on ? CREAM : MUTED}" stroke-width="1.1"/>`
      + `<circle cx="${n1(knob)}" cy="${n1(py + ph / 2)}" r="${n1(ph * 0.3)}" fill="${on ? CREAM : MUTED}"/>`
  }).join('')
}

// Vibe check: a test that failed an x, one fixed a tick, a compaction a squashed dot.
const marks = (kinds: readonly ('x' | 'check' | 'squash')[]): Window => (x, y, w, h) => {
  const step = Math.min((w - 10) / Math.max(1, kinds.length), h * 0.7), r = step * 0.36, x0 = x + (w - step * kinds.length) / 2 + step / 2
  return kinds.map((k, i) => {
    const cx = x0 + i * step, cy = y + h / 2
    if (k === 'x') { const d = r * 0.8; return `<path d="M${n1(cx - d)} ${n1(cy - d)}L${n1(cx + d)} ${n1(cy + d)}M${n1(cx + d)} ${n1(cy - d)}L${n1(cx - d)} ${n1(cy + d)}" stroke="${CORAL}" stroke-width="${n1(r * 0.5)}" stroke-linecap="round"/>` }
    if (k === 'check') return `<path d="M${n1(cx - r)} ${n1(cy)}l${n1(r * 0.7)} ${n1(r * 0.7)}l${n1(r * 1.3)} ${n1(-r * 1.4)}" fill="none" stroke="${CREAM}" stroke-width="${n1(r * 0.5)}" stroke-linecap="round" stroke-linejoin="round"/>`
    return `<ellipse cx="${n1(cx)}" cy="${n1(cy)}" rx="${n1(r)}" ry="${n1(r * 0.38)}" fill="${CREAM}"/>`
  }).join('')
}

// The quota: each window's four cells, the ones left coral (a window not read yet only outlined).
const cells = (rows: readonly (number | undefined)[]): Window => (x, y, w, h) => {
  const cw = (w - 24) / 4, ch = h * 0.26, out: string[] = []
  rows.forEach((left, j) => {
    const cy = y + h * (0.16 + j * 0.42)
    for (let i = 0; i < 4; i++) {
      const on = left !== undefined && i < left
      out.push(`<rect x="${n1(x + 8 + i * (cw + 2.7))}" y="${n1(cy)}" width="${n1(cw)}" height="${n1(ch)}" rx="2" fill="${on ? CORAL : 'none'}" stroke="${on ? CREAM : MUTED}" stroke-width="1.2"/>`)
    }
  })
  return out.join('')
}

// The sock drawer: every pair a little sock, the ones they have filled.
const socks = (have: number, total: number): Window => (x, y, w, h) => {
  const per = 7, u = Math.min((w - 8) / per, h / 2) / 8, out: string[] = []
  for (let k = 0; k < total; k++) {
    const row = Math.floor(k / per), col = k % per
    const sx = x + (w - per * 8 * u) / 2 + col * 8 * u + 1.6 * u, sy = y + (h - 2 * 8 * u) / 2 + row * 8 * u + 0.6 * u
    // a leg with a ribbed cuff, the heel rounded, the toe rounded
    const d = `M${n1(sx)} ${n1(sy)}h${n1(3.2 * u)}v${n1(3.6 * u)}q${n1(0.2 * u)} ${n1(0.9 * u)} ${n1(1.4 * u)} ${n1(1.1 * u)}`
      + `q${n1(1.4 * u)} ${n1(0.3 * u)} ${n1(1.2 * u)} ${n1(1.6 * u)}q${n1(-0.2 * u)} ${n1(0.9 * u)} ${n1(-1.6 * u)} ${n1(0.9 * u)}`
      + `h${n1(-2.6 * u)}q${n1(-1.6 * u)} 0 ${n1(-1.6 * u)} ${n1(-1.7 * u)}z`
    const got = k < have
    out.push(`<path d="${d}" fill="${got ? CREAM : 'none'}" stroke="${got ? CREAM : MUTED}" stroke-width="1" stroke-linejoin="round"/>`)
    if (got) out.push(`<rect x="${n1(sx)}" y="${n1(sy + 0.7 * u)}" width="${n1(3.2 * u)}" height="${n1(0.7 * u)}" fill="${CORAL}"/>`)
  }
  return out.join('')
}

// The sticky notes: the note, pinned, or only its dashed place.
const note = (present: boolean): Window => (x, y, w, h) => {
  const side = h * 0.7, nx = x + (w - side) / 2, ny = y + (h - side) / 2
  if (!present) return `<rect x="${n1(nx)}" y="${n1(ny)}" width="${n1(side)}" height="${n1(side)}" fill="none" stroke="${MUTED}" stroke-width="1.2" stroke-dasharray="3 2.5"/>`
  return `<path d="M${n1(nx)} ${n1(ny)}h${n1(side)}v${n1(side * 0.78)}l${n1(-side * 0.22)} ${n1(side * 0.22)}H${n1(nx)}Z" fill="${CREAM}"/>`
    + [0, 1, 2].map(i => `<rect x="${n1(nx + side * 0.16)}" y="${n1(ny + side * (0.3 + i * 0.18))}" width="${n1(side * (i < 2 ? 0.68 : 0.4))}" height="${n1(side * 0.06)}" fill="${GROUND}"/>`).join('')
    + `<circle cx="${n1(nx + side / 2)}" cy="${n1(ny + side * 0.1)}" r="${n1(side * 0.09)}" fill="${CORAL}"/>`
}

function windowFor(r: MvReading, wide: boolean): Window {
  switch (r.page) {
    case 'him': {
      const names = ['onDesk', 'follow', 'openAtLogin']
      return wide ? code([['// coco pet', 'comment'], ...r.switches.map((on, i): Line => [`${names[i] ?? 'switch'}();`, on ? 'on' : 'off'])]) : pills(r.switches)
    }
    case 'offerings':
      return wide ? code([['// quota', 'comment'], ...([['5h', r.five], ['7d', r.week]] as const).map(([k, v]): Line => v === undefined ? [`left("${k}");`, 'off'] : [`left("${k}", ${v});`, 'on'])])
        : cells([r.five, r.week])
    case 'omen':
      return wide ? code([['// vibe check', 'comment'], [`fail(${r.failed});`, r.fixed >= r.failed ? 'off' : 'on'], [`fix(${r.fixed});`, 'on'], [`compact(${r.compacted});`, 'on']])
        : marks([...Array<'x'>(r.failed).fill('x'), ...Array<'check'>(r.fixed).fill('check'), ...Array<'squash'>(r.compacted).fill('squash')].slice(0, 12))
    case 'socks':
      return wide ? code([['// socks', 'comment'], [`wear("${r.worn}");`, 'on'], [`have(${r.have});`, 'on']]) : socks(r.have, r.all)
    case 'log': {
      const last = r.issues.at(-1) ?? 0, missed = Array.from({ length: Math.max(0, last - 1) }, (_, i) => i + 1).filter(n => !r.issues.includes(n))
      return wide ? code([['// doujin', 'comment'], [`collect(${r.issues.length});`, 'on'], ...missed.slice(-2).map((n): Line => [`issue(${n});`, 'off'])]) : weeks(r.issues)
    }
    case 'library':
      return wide ? code([['// sticky note', 'comment'], ['pin(note);', r.notes > 0 ? 'on' : 'off']]) : note(r.notes > 0)
    case 'settings': {
      const on = r.switches.filter(Boolean).length
      return wide ? code([['// settings', 'comment'], [`on(${on});`, 'on'], [`off(${r.switches.length - on});`, 'comment']]) : switchGrid(r.switches)
    }
  }
}

type BandItem = { kind: 'text'; text: string; now: boolean } | { kind: 'cells'; left?: number }
// The slab band: words filled coral when they are the reading now, else outlined; the quota's cells.
function bandItems(r: MvReading, wide: boolean): BandItem[] {
  const text = (value: string, now: boolean): BandItem => ({ kind: 'text', text: value, now })
  switch (r.page) {
    case 'him': return SIZES.map((s, i) => text(s, i === r.size))
    case 'offerings': return [text('5h', false), { kind: 'cells', ...(r.five === undefined ? {} : { left: r.five }) }, text('7d', false), { kind: 'cells', ...(r.week === undefined ? {} : { left: r.week }) }]
    case 'omen': return (['R', 'SR', 'SSR'] as const).map(x => text(x, x === r.rarity))
    case 'socks': return [text(String(r.have), true), text(`/${r.all}`, false)]
    case 'log': {
      const shown = r.issues.slice(wide ? -4 : -2)
      return shown.length ? [...shown.slice(0, -1).map(n => text(String(n), false)), text(`#${shown.at(-1)}`, true)] : [text('#0', false)]
    }
    case 'library': return [text('TODO', r.notes > 0)]
    case 'settings': { const on = r.switches.filter(Boolean).length; return [text(String(on), true), text(`/${r.switches.length}`, false)] }
  }
}

function band(items: readonly BandItem[], x: number, top: number, bottom: number, cap0: number, room: number): string {
  const tight = (item?: BandItem) => item?.kind === 'text' && item.text.startsWith('/') // a count's slash sits close to its number
  const widths = (c: number): { total: number; joins: number[] } => {
    const g = c * 0.3, sizes = items.map(item => item.kind === 'text' ? slabWidth(item.text, c) : 4 * c * 0.36 + 3 * c * 0.12)
    const joins = items.slice(0, -1).map((item, i) => tight(items[i + 1]) ? 0 : g * (item.kind === 'text' && items[i + 1]?.kind === 'cells' ? 0.6 : item.kind === 'cells' ? 1.2 : 1))
    return { total: sizes.reduce((a, b) => a + b, 0) + joins.reduce((a, b) => a + b, 0), joins }
  }
  let cap = cap0, { total, joins } = widths(cap)
  if (total > room) { cap *= room / total; ({ total, joins } = widths(cap)) }
  const baseline = bottom - (bottom - top - cap) / 2, out: string[] = []
  let at = x
  items.forEach((item, i) => {
    if (item.kind === 'text') {
      const [svg, advance] = slab(item.text, at, baseline, cap, item.now ? CORAL : undefined, item.now ? undefined : CREAM, 1.4)
      out.push(svg); at += advance
    } else {
      const cw = cap * 0.36, cg = cap * 0.12
      for (let k = 0; k < 4; k++) {
        const filled = item.left !== undefined && k < item.left
        out.push(`<rect x="${n1(at + k * (cw + cg))}" y="${n1(baseline - cap)}" width="${n1(cw)}" height="${n1(cap)}" rx="${n1(cap * 0.06)}" fill="${filled ? CORAL : 'none'}" stroke="${filled ? 'none' : CREAM}" stroke-width="1.4"/>`)
      }
      at += 4 * cw + 3 * cg
    }
    at += joins[i] ?? 0
  })
  return out.join('')
}

// The whole picture, `width` wide; Coco at the right where there is room (under 280 the bag has the picture alone).
export function bagMvSvg(width: number, reading: MvReading, peek?: BagPeek): string {
  const w = Math.max(160, Math.round(width)), wide = w > 400, h = bagMvHeight(w), rule = wide ? 170 : 122
  const her = peek && w >= 280 ? peek : undefined
  const ih = h, iw = (her ? her.width / her.height : 236 / 360) * ih, ix = w - iw - 2
  const edge = her ? ix + iw * PEEK_EDGE : w, plane = her ? ix + iw * 0.22 : w + 30
  const cx = her ? (plane - 10) * 0.47 : w * 0.5, cy = rule * 0.5, disc = rule * 0.46
  const [bw, bh] = wide ? [196, 100] : [128, 66], id = `${reading.page}-${w}`
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`,
    `<defs><clipPath id="mv-scene-${id}"><path d="M0 0H${n1(plane + 16)}L${n1(plane - 24)} ${rule}H0Z"/></clipPath><clipPath id="mv-all-${id}"><rect width="${n1(edge)}" height="${h}" rx="12"/></clipPath></defs>`,
    `<g clip-path="url(#mv-all-${id})"><rect width="${w}" height="${h}" fill="${GROUND}"/><g clip-path="url(#mv-scene-${id})">`,
    bars(cx, cy, disc + (wide ? 7 : 5), wide ? 10 : 6, wide ? 70 : 44, wide ? 60 : 44, wide ? 5 : 4, 16 + PAGE_SEED[reading.page]),
    `<circle cx="${n1(cx)}" cy="${n1(cy)}" r="${n1(disc)}" fill="${CREAM}"/>`,
    bag(cx, cy + bh * 0.16, bw, bh, windowFor(reading, wide), id), '</g>']
  // Coco's plane: cream, its left edge leaning, so the dark outline reads (the MV's figure stands on its pale disc)
  if (her) out.push(`<path d="M${n1(plane - 24)} ${h}L${n1(plane + 16)} 0H${w}V${h}Z" fill="${CREAM}"/>`)
  out.push(`<path d="M0 ${rule}H${n1(her ? plane - 24 + 40 * (h - rule) / h : w)}" stroke="${CREAM}" stroke-width="1.5"/>`)
  out.push(band(bandItems(reading, wide), 18, rule, h, wide ? 58 : 40, (her ? plane - 30 : w) - 18), '</g>')
  if (her) out.push(`<path d="M${n1(edge)} 0V${h}" stroke="${INK}" stroke-width="${n1(2.5 * ih / 360)}"/>`,
    `<image x="${n1(ix)}" y="0" width="${n1(iw)}" height="${n1(ih)}" href="data:image/png;base64,${her.base64}"/>`)
  out.push('</svg>')
  return contrastSvg(out.join(''))
}
