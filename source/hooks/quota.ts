import { contrastSvg } from './high-contrast'
import { QUOTA_TRAIL_SAME_RESET_MS } from './quota-trail'
import type { QuotaTrail } from './quota-trail'
import { hasNumber, momentText, percentText } from './numbers'
import { gapFill } from './mod-gaps-words'
import { c3Word } from './c3-words'
import { quotaDuration, quotaIncenseAlt, WORDS } from './words'
import type { Lang } from './words'
import { playWord } from './play'

// What a screen reader hears for the quota pictures (the name is from the incense days; quotaBandItems uses it).
export type IncenseAltOptions = { neighbour?: boolean; pace?: readonly { kind: string; t: string }[]; spare?: string; breathing?: boolean; out?: readonly { kind:string;time:string }[] }
export function incenseAlt(lang: Lang, windows: readonly { kind: string; percentUsed: number }[], options: IncenseAltOptions = {}): string {
  windows=[...windows,...(options.out??[]).filter(spent=>!windows.some(w=>w.kind===spent.kind)).map(spent=>({kind:spent.kind,percentUsed:100}))]
  const base = quotaIncenseAlt(lang, windows)
  if (!base || options.neighbour) return base
  // Play adds what is drawn beside the figures: a spare stick waiting, smoke breathing.
  const extra = [options.spare === undefined ? '' : playWord(lang, 'alt.incense.spare', { time: options.spare }), options.breathing ? playWord(lang, 'alt.incense.breathing') : ''].filter(Boolean)
  if (!options.pace?.length && !options.out?.length) return extra.length ? [base, ...extra].join('; ') : base
  const fill = (key: string, fallback: string, values: Record<string, string>) => (c3Word(lang, key) || fallback).replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? '')
  const groups = windows.filter(window => hasNumber(window.percentUsed) && window.kind in WORDS[lang].quota.kinds).map(window => {
    const spent=options.out?.find(p=>p.kind===window.kind)
    if(spent)return gapFill(lang,'alt.incense.out',{window:WORDS[lang].quota.kinds[window.kind]??window.kind,time:spent.time})
    const reading = quotaIncenseAlt(lang, [window]), pace = options.pace?.find(p => p.kind === window.kind)
    return pace?.t ? reading + WORDS[lang].quota.separator + fill('alt.incense.pace', 'out in about {t}', { t: pace.t.replace(/^~\s*/, '') }) : reading
  })
  return [...groups, ...extra].join('; ')
}

// ---------------------------------------------------------------- the quota pictures (lane C, 10-14)
// The owner chose a laptop battery for the 5-hour limit and a power bank for the weekly one, then asked that they
// follow the real readings exactly (「它和真实的额度状态同步」). Both are 12 art pixels tall and sit on one
// baseline: the battery is cream with four bars that fill bottom up in sixths, the power bank charcoal with four
// little lights (lit, half lit, off). A quarter or less left turns what is left coral; a spent window waits under
// a hand-drawn bolt. Drawn as one rect per run of a colour, two CSS px per art pixel; the outline on the picture's
// edge lightens on a dark ground the way the pixel family does (battery_live and bank_live in the unpublished
// drawing tool play_sprites.py are the source these rows are checked against).
const QUOTA_INK: Record<string, string> = {
  O: '#5C2A1E', h: '#FFFDF8', i: '#F4ECE4', s: '#E0D1C6', M: '#F2EEEA', N: '#C9C2BC', Z: '#2E2E35',
  b: '#79B6E6', B: '#3A86C8', c: '#2A6399', r: '#F2A587', R: '#D97757', q: '#AE5539', e: '#A99282', E: '#CBB8AA',
  Y: '#D97757', y: '#AE5539', l: '#6A6A74', L: '#45454D', k: '#2E2E35', D: '#222227', g: '#F4FBFF', G: '#79B6E6',
}
const OUTLINE_ON_DARK = '#A07B6A'
const BOLT = ['...##', '..##.', '.##..', '#####', '..##.', '.##..', '##...', '#....']

function quarterFill(left: number, k: number): number { return Math.max(0, Math.min(1, (left - 25 * k) / 25)) }
function boltOver(g: string[][], x0: number, y0: number): void {
  BOLT.forEach((row, j) => [...row].forEach((ch, i) => { if (ch === '#') g[y0 + j]![x0 + i] = row[i + 1] === '#' ? 'Y' : 'y' }))
}

/** The 5-hour battery's rows, one character a pixel ('.' is clear): left is the percent remaining. */
export function quotaBatteryRows(left: number, waiting = false): string[] {
  const W = 26, H = 12, g = Array.from({ length: H }, () => Array<string>(W).fill('.'))
  for (let y = 0; y < H; y++) for (let x = 0; x < 24; x++) {
    const dx = Math.min(x, 23 - x), dy = Math.min(y, H - 1 - y)
    if (dx === 0 && dy === 0) continue
    g[y]![x] = dx === 0 || dy === 0 ? 'O' : y === 1 || x === 1 ? 'h' : y === H - 2 || x === 22 ? 's' : 'i'
  }
  for (let y = 3; y < 9; y++) g[y]![24] = 'O'
  for (let y = 4; y < 8; y++) { g[y]![25] = 'O'; g[y]![24] = y < 6 ? 'M' : 'N' }
  const low = left <= 25
  for (let k = 0; k < 4; k++) {
    const f = quarterFill(left, k), rows = f > 0 ? Math.max(1, Math.round(6 * f)) : 0
    const [top, mid, bot] = low ? ['r', 'R', 'q'] : ['b', 'B', 'c']
    for (let y = 3; y < 9; y++) for (let x = 3 + 5 * k; x < 6 + 5 * k; x++) {
      const filled = y >= 9 - rows
      g[y]![x] = filled ? (y === 9 - rows ? top! : y === 8 ? bot! : mid!) : (y === 3 ? 'e' : 'E')
    }
  }
  if (waiting) boltOver(g, 10, 2)
  return g.map(row => row.join(''))
}

/** The weekly power bank's rows: lit when its quarter is two thirds there, half lit from a third, and the first
 * light never dark while anything is left. */
export function quotaBankRows(left: number, waiting = false): string[] {
  const W = 22, H = 12, g = Array.from({ length: H }, () => Array<string>(W).fill('.'))
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = Math.min(x, W - 1 - x), dy = Math.min(y, H - 1 - y)
    if (dx + dy < 2) continue
    g[y]![x] = dx === 0 || dy === 0 || dx + dy === 2 ? 'O' : dy === 1 ? (y < H / 2 ? 'l' : 'k') : 'L'
  }
  for (let y = 2; y < H - 2; y++) if (g[y]![1] === 'L') g[y]![1] = 'l'
  for (let y = 4; y < 8; y++) g[y]![2] = 'M'
  g[5]![2] = 'Z'; g[6]![2] = 'Z'
  const low = left <= 25
  for (let k = 0; k < 4; k++) {
    const f = quarterFill(left, k), x0 = 6 + 4 * k
    const shown = f >= 1 / 3 || (k === 0 && left > 0), full = f >= 2 / 3
    for (let y = 4; y < 7; y++) for (let x = x0; x < x0 + 3; x++) g[y]![x] = !shown ? 'D' : full ? (low ? 'R' : 'G') : (low ? 'q' : 'B')
    if (shown && full) { const glint = low ? 'r' : 'g'; g[5]![x0 + 1] = glint; g[4]![x0] = glint }
  }
  if (waiting) boltOver(g, 9, 2)
  return g.map(row => row.join(''))
}

/** Rows as an SVG at `scale` CSS px an art pixel: one rect per run, the outline on the picture's edge in class e. */
/** One rect per run of a colour; the outline on the picture's edge gets class "e" so it can lighten on a dark ground. */
export function pixelRuns(rows: readonly string[], ox = 0, oy = 0, ink: Readonly<Record<string, string>> = QUOTA_INK): string {
  const h = rows.length, w = rows[0]?.length ?? 0
  const at = (x: number, y: number) => (y < 0 || y >= h || x < 0 || x >= w ? '.' : rows[y]![x]!)
  const edge = (x: number, y: number) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => at(x + dx!, y + dy!) === '.')
  const runs: string[] = []
  for (let y = 0; y < h; y++) {
    let x = 0
    while (x < w) {
      const ch = at(x, y)
      if (ch === '.') { x++; continue }
      const outer = ch === 'O' && edge(x, y)
      let end = x + 1
      while (end < w && at(end, y) === ch && (ch !== 'O' || edge(end, y) === outer)) end++
      runs.push(`<rect x="${x + ox}" y="${y + oy}" width="${end - x}" height="1"${outer ? ' class="e"' : ` fill="${ink[ch]}"`}/>`)
      x = end
    }
  }
  return runs.join('')
}
export const PIXEL_EDGE_STYLE = `.e{fill:${QUOTA_INK.O}}@media(prefers-color-scheme:dark){.e{fill:${OUTLINE_ON_DARK}}}`
export function quotaPixelSvg(rows: readonly string[], scale = 2): string {
  const h = rows.length, w = rows[0]?.length ?? 0
  return contrastSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w * scale}" height="${h * scale}" shape-rendering="crispEdges"><style>${PIXEL_EDGE_STYLE}</style>${pixelRuns(rows)}</svg>`)
}

/** The pictures' CSS width at two CSS px an art pixel: the battery is 26 art pixels wide, the power bank 22; both 12 high. */
export const QUOTA_PICTURE_PX: Readonly<Record<'five_hour' | 'seven_day', number>> = { five_hour: 52, seven_day: 44 }
/** The two pictures for the band from the windows' percent used; a spent window is drawn empty under the bolt. */
export function quotaPictures(windows: readonly { kind: string; percentUsed: number }[], spent: readonly string[] = []): { five?: string; week?: string } {
  const left = (kind: string) => { const w = windows.find(item => item.kind === kind); return w && hasNumber(w.percentUsed) ? Math.max(0, 100 - w.percentUsed) : undefined }
  const five = spent.includes('five_hour') ? 0 : left('five_hour'), week = spent.includes('seven_day') ? 0 : left('seven_day')
  return {
    ...(five === undefined ? {} : { five: quotaPixelSvg(quotaBatteryRows(five, five <= 0)) }),
    ...(week === undefined ? {} : { week: quotaPixelSvg(quotaBankRows(week, week <= 0)) }),
  }
}

/** The terminal's plain form (owner 10-14: 「终端要改……更直白的5h/week limit之类」): four cells, a filled one for
 * each quarter at least half there, so 62% left reads ▮▮▮▯. */
export function quotaMeterText(usedPercent: number): string {
  const full = quotaCellsLeft(usedPercent)
  return '▮'.repeat(full) + '▯'.repeat(4 - full)
}
export function quotaCellsLeft(usedPercent: number): number {
  const left = Math.max(0, Math.min(100, 100 - usedPercent))
  return left <= 0 ? 0 : Math.max(1, Math.min(4, Math.round(left / 25)))
}

// ---------------------------------------------------------------- what the readings say comes next (lane C, 10-14)
// The owner asked that hovering the pictures say the details and what the numbers predict (「鼠标提上去还会真正写详细
// 内容和详细情况甚至预测算法」). Both forecasts are plain arithmetic on what Claude Code reported: the 5-hour one uses
// the pace measured over the last 90 minutes when the reminders have one (algo/pace.ts), otherwise this window's own
// average since it opened; the weekly one uses this week's average (the approved quota page: 「照这周的速度」). A hot
// window keeps the pace the warning used, so the hover never disagrees with the band.
export const QUOTA_WINDOW_MS: Readonly<Record<string, number>> = { five_hour: 5 * 3_600_000, seven_day: 7 * 86_400_000 }
const EARLY_MS = 30 * 60_000
export type QuotaForecast = {
  kind: string
  /** Percent used now, 0 to 100. */
  used: number
  resetsAt?: number
  /** 'recent': the last 90 minutes; 'window': this window's average since it opened. */
  basis?: 'recent' | 'window'
  /** Percent used at the reset at this pace, when it lasts until then. */
  reach?: number
  /** When it runs out at this pace, when that is half an hour or more before the reset. */
  runsOutAt?: number
  /** What is left spread evenly until the reset: per hour for the 5-hour window, per day for the weekly one. */
  allowance?: { per: 'hour' | 'day'; percent: number }
}
export function quotaForecast(window: { kind: string; percentUsed: number; resetsAt?: number | string }, now: number, ratePerHour?: number, hot = false): QuotaForecast | undefined {
  const length = QUOTA_WINDOW_MS[window.kind]
  if (length === undefined || !hasNumber(window.percentUsed) || !Number.isFinite(now)) return undefined
  const used = Math.max(0, Math.min(100, window.percentUsed))
  const reset = typeof window.resetsAt === 'string' ? Date.parse(window.resetsAt) : window.resetsAt
  if (reset === undefined || !Number.isFinite(reset) || reset <= now) return { kind: window.kind, used }
  const out: QuotaForecast = { kind: window.kind, used, resetsAt: reset }
  const left = 100 - used, unit = window.kind === 'five_hour' ? 3_600_000 : 86_400_000, units = (reset - now) / unit
  if (left > 0 && units >= 1) out.allowance = { per: unit === 3_600_000 ? 'hour' : 'day', percent: Math.round(left / units) }
  if (left <= 0) return out
  // The recent pace when there is one (the weekly window only while it is hot), else this window's average so far,
  // asked only once a tenth of the window has passed so a first burst is not stretched over the whole window.
  const recent = hasNumber(ratePerHour) && ratePerHour > 0 && (window.kind === 'five_hour' || hot) ? ratePerHour : undefined
  const elapsed = now - (reset - length)
  const average = elapsed >= length / 10 && used > 0 ? used / (elapsed / 3_600_000) : undefined
  const rate = recent ?? average
  if (rate === undefined) return out
  out.basis = recent !== undefined ? 'recent' : 'window'
  const hours = (reset - now) / 3_600_000, end = used + rate * hours
  if (end < 100) { out.reach = Math.round(end); return out }
  const runsOutAt = now + (left / rate) * 3_600_000
  if (reset - runsOutAt >= EARLY_MS) out.runsOutAt = runsOutAt
  else out.reach = 100
  return out
}

// One window as the band shows it (the approved quota page, 10-14): its short name, then the picture on the desktop or
// four cells in the terminal. Beside it stands what is left, or, when it matters, when it runs out (coral) or when it
// comes back (under the bolt). Nothing blinks and nothing sounds.
export type QuotaBandItem = {
  kind: 'five_hour' | 'seven_day'
  label: string
  /** Percent left, 0 to 100. */
  left: number
  tone: 'calm' | 'low' | 'hot' | 'out'
  meter: string
  /** The terminal's words after the cells: what is left, or the flag. */
  tail: string
  /** The desktop's words after the picture; only a hot or spent window has them. */
  flag: string
  picture: string
  alt: string
}
export type QuotaBandOptions = {
  spent?: readonly { kind: string; time: string }[]
  pace?: readonly { kind: string; narrow: string; t?: string }[]
}
// The band asks for its widths many times a render, so a width-only call draws nothing, and the few pictures a session
// sees are kept by what they show.
const pictureCache = new Map<string, string>()
function quotaPicture(kind: 'five_hour' | 'seven_day', left: number): string {
  const key = kind + ':' + left
  let svg = pictureCache.get(key)
  if (svg === undefined) {
    svg = quotaPixelSvg(kind === 'five_hour' ? quotaBatteryRows(left, left <= 0) : quotaBankRows(left, left <= 0))
    if (pictureCache.size >= 16) pictureCache.clear()
    pictureCache.set(key, svg)
  }
  return svg
}
export function quotaBandItems(lang: Lang, windows: readonly { kind: string; percentUsed: number }[], options: QuotaBandOptions = {}, pictures = true): QuotaBandItem[] {
  const q = WORDS[lang].quota
  return (['five_hour', 'seven_day'] as const).flatMap(kind => {
    const reading = windows.find(w => w.kind === kind && hasNumber(w.percentUsed)), spent = options.spent?.find(s => s.kind === kind)
    if (!reading && !spent) return []
    const left = spent ? 0 : Math.max(0, Math.min(100, 100 - reading!.percentUsed))
    const pace = spent ? undefined : options.pace?.find(p => p.kind === kind && p.narrow)
    const back = spent ? playWord(lang, 'quota.band.back', { time: spent.time }) : ''
    const flag = spent ? back : pace?.narrow ?? ''
    const tone = spent || left <= 0 ? 'out' : pace ? 'hot' : left <= 25 ? 'low' : 'calm'
    const alt = pictures ? incenseAlt(lang, reading ? [reading] : [], { ...(spent ? { out: [spent] } : {}), ...(pace?.t ? { pace: [{ kind, t: pace.t }] } : {}) }) : ''
    return [{ kind, label: q.shortKinds[kind] ?? kind, left, tone, meter: quotaMeterText(100 - left), tail: flag || percentText(Math.round(left), lang), flag, picture: pictures ? quotaPicture(kind, left) : '', alt }]
  })
}

/** The words for one forecast: the pace it rests on and what it comes to, then the even share left. The band's hover
 * takes the compact form (one row holds both windows); the quota page takes the whole sentences. */
export function quotaForecastText(lang: Lang, forecast: QuotaForecast, now: number, timeZone?: string, compact = false): string {
  const separator = WORDS[lang].quota.separator, parts: string[] = []
  const pct = (value: number) => percentText(Math.round(value), lang)
  const basis = forecast.basis === 'recent' ? playWord(lang, 'quota.basis.recent') : forecast.basis ? playWord(lang, 'quota.basis.' + forecast.kind) : ''
  if (basis && forecast.reach !== undefined) parts.push(compact ? playWord(lang, 'quota.hover.reach', { p: pct(forecast.reach) }) : playWord(lang, 'quota.forecast.reach', { basis, p: pct(forecast.reach) }))
  else if (basis && forecast.runsOutAt !== undefined && forecast.resetsAt !== undefined) {
    const time = momentText(forecast.runsOutAt, now, lang, timeZone)
    parts.push(compact ? playWord(lang, 'quota.hover.out', { time }) : playWord(lang, 'quota.forecast.out', {
      basis, t: quotaDuration(lang, forecast.runsOutAt - now), time, early: quotaDuration(lang, forecast.resetsAt - forecast.runsOutAt),
    }))
  }
  if (forecast.allowance) parts.push(playWord(lang, (compact ? 'quota.hover.' : 'quota.allowance.') + forecast.allowance.per, { p: pct(forecast.allowance.percent) }))
  return parts.filter(Boolean).join(separator)
}

// ---------------------------------------------------------------- where each window went (lane C, 10-15)
// The trails themselves are kept by quota-trail.ts (register.tsx takes the readings in at start); this draws them.
/** One window's chart: what was used from its opening until now, and where this pace takes it by the reset. */
export type QuotaTrend = {
  kind: string
  /** [ms, percent] readings, the last one now. */
  points: readonly (readonly [number, number])[]
  start: number
  end: number
  /** Where the median pace ends: at the reset, or at 100% when it runs out first. */
  median?: readonly [number, number]
  /** The same with the pace a quarter faster: the edge of the band. */
  late?: readonly [number, number]
  /** The median runs out before the reset (coral). */
  warn: boolean
  resetLabel: string
  crossLabel?: string
}
const LATE = 1.25
export function quotaTrendFor(trail: QuotaTrail, forecast: QuotaForecast, now: number): Omit<QuotaTrend, 'resetLabel' | 'crossLabel'> | undefined {
  const length = QUOTA_WINDOW_MS[forecast.kind], held = trail[forecast.kind], reset = forecast.resetsAt
  if (length === undefined || !held || reset === undefined || Math.abs(held.resetsAt - reset) > QUOTA_TRAIL_SAME_RESET_MS || now >= reset) return undefined
  const start = reset - length
  const points: [number, number][] = held.points.map(([t, p]) => [Math.max(start, Math.min(now, t * 60_000)), p])
  if (!points.length || points[points.length - 1]![0] < now) points.push([now, forecast.used])
  if (points.length < 2) return undefined
  const used = forecast.used, left = 100 - used
  let median: [number, number] | undefined, late: [number, number] | undefined
  const rate = forecast.runsOutAt !== undefined ? left / (forecast.runsOutAt - now) : forecast.reach !== undefined ? (forecast.reach - used) / (reset - now) : undefined
  if (rate !== undefined && rate > 0 && left > 0) {
    median = forecast.runsOutAt !== undefined ? [forecast.runsOutAt, 100] : [reset, Math.min(100, forecast.reach!)]
    const fast = rate * LATE, crossing = now + left / fast
    late = crossing < reset ? [crossing, 100] : [reset, used + fast * (reset - now)]
  }
  return { kind: forecast.kind, points, start, end: reset, ...(median ? { median, late } : {}), warn: forecast.runsOutAt !== undefined }
}
// The chart's colours, checked with the dataviz validator for quota_page.py (light on white, dark on #262422): their blue
// for what was used, coral when this pace runs out before the reset. Text wears the ink, never the series colours.
const TREND_CSS = '.l{stroke:#3A86C8}.lf{fill:#3A86C8}.w{stroke:#D97757}.wf{fill:#D97757}.h{stroke:#E3DCD5}.m{stroke:#6E625C}.t{fill:#6E625C}.k{fill:#232122}.g{stroke:#FFFFFF}'
  + '@media(prefers-color-scheme:dark){.l{stroke:#4A98DD}.lf{fill:#4A98DD}.w{stroke:#D27149}.wf{fill:#D27149}.h{stroke:#3A3633}.m{stroke:#A99D96}.t{fill:#A99D96}.k{fill:#EFE7E1}.g{stroke:#262422}}'
const trendCache = new Map<string, string>()
export function quotaTrendSvg(trend: QuotaTrend, width: number, height = 96): string {
  const key = JSON.stringify([trend, width, height])
  const cached = trendCache.get(key)
  if (cached !== undefined) return cached
  const x0 = 8, x1 = width - 10, y0 = 16, y1 = height - 22, span = Math.max(1, trend.end - trend.start)
  const X = (t: number): string => (x0 + (x1 - x0) * Math.max(0, Math.min(1, (t - trend.start) / span))).toFixed(1)
  const Y = (p: number): string => (y1 - (y1 - y0) * Math.max(0, Math.min(100, p)) / 100).toFixed(1)
  const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const series = trend.warn ? 'w' : 'l'
  const [nowT, nowP] = trend.points[trend.points.length - 1]!
  const line = trend.points.map(([t, p]) => `${X(t)} ${Y(p)}`).join(' L')
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="system-ui,-apple-system,'Segoe UI','PingFang SC',sans-serif" font-size="10">`,
    `<style>${TREND_CSS}</style>`,
    `<path class="h" d="M${x0} ${Y(100)}H${x1}M${x0} ${y1}H${x1}" stroke-width="1"/>`,
    `<text class="t" x="${x0}" y="${(Number(Y(100)) - 4).toFixed(1)}">100%</text>`,
    `<path class="m" d="M${X(trend.end)} ${y0 - 4}V${y1 + 4}" stroke-width="1"/>`,
    `<text class="t" x="${X(trend.end)}" y="${height - 6}" text-anchor="end">${esc(trend.resetLabel)}</text>`,
    `<path class="h" d="M${X(nowT)} ${y0}V${y1 + 4}" stroke-width="1"/>`,
  ]
  if (trend.median && trend.late) {
    const fan = [[nowT, nowP], trend.median, trend.late] as const
    parts.push(`<path class="${series}f" d="M${fan.map(([t, p]) => `${X(t)} ${Y(p)}`).join(' L')} Z" fill-opacity=".12"/>`)
    parts.push(`<path class="${series}" d="M${X(nowT)} ${Y(nowP)} L${X(trend.median[0])} ${Y(trend.median[1])}" fill="none" stroke-width="2" stroke-dasharray="4 3" stroke-linecap="round"/>`)
  }
  parts.push(`<path class="lf" d="M${X(trend.points[0]![0])} ${y1} L${line} L${X(nowT)} ${y1} Z" fill-opacity=".10"/>`)
  parts.push(`<path class="l" d="M${line}" fill="none" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`)
  parts.push(`<circle class="lf g" cx="${X(nowT)}" cy="${Y(nowP)}" r="4" stroke-width="2"/>`)
  if (trend.warn && trend.median) {
    parts.push(`<circle class="wf g" cx="${X(trend.median[0])}" cy="${Y(100)}" r="4" stroke-width="2"/>`)
    // the time it runs out stands above the 100% line, right of its dot, or left of it near the reset (6 px a character)
    const cx = Number(X(trend.median[0])), right = cx + 7 + 6 * (trend.crossLabel?.length ?? 0) <= x1 - 4
    if (trend.crossLabel) parts.push(`<text class="k" x="${(right ? cx + 7 : cx - 7).toFixed(1)}" y="${(Number(Y(100)) - 5).toFixed(1)}" text-anchor="${right ? 'start' : 'end'}">${esc(trend.crossLabel)}</text>`)
  }
  parts.push('</svg>')
  const svg = contrastSvg(parts.join(''), '.l,.w,.h,.m,.g{stroke:#000}.lf,.wf,.t,.k{fill:#000}', '.l,.w,.h,.m,.g{stroke:#FFF}.lf,.wf,.t,.k{fill:#FFF}')
  if (trendCache.size >= 16) trendCache.clear()
  trendCache.set(key, svg)
  return svg
}
