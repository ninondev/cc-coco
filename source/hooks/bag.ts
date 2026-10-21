import { contrastSvg } from './high-contrast'
import type { Page } from './book-words'

// Their itabag replaces his book as the settings (owner 10-14, DECISIONS 892 and 894): the panel is 小克的痛包, seven
// pages in his order, the art drawn the way handoffs/program/design/1.0/new-play/tools/settings_drafts.py drew it
// (Italian futurism: one 30 degree diagonal, Balla's triangles, the bag swinging in, its gear badge spinning). The
// names are lane B's (hooks/bag-text.json, built by tools/build-bag-words.py) and are read when the panel first opens.

export const BAG_PAGES: readonly Page[] = ['him', 'offerings', 'omen', 'socks', 'log', 'library', 'settings']
// Their sock drawer in the names' order (tools/art/coco-socks.py PAIRS); the first pair is their own and needs no file.
export const SOCK_PAIRS = ['honmei', 'matcha', 'blueberry', 'sesame', 'mint', 'strawberry', 'taro', 'marshmallow', 'goodgirl', 'nude', 'lan', 'whitehat', 'reddot'] as const
export type SockPair = typeof SOCK_PAIRS[number]
export function sockPair(value: unknown): SockPair | undefined {
  return SOCK_PAIRS.find(pair => pair === value)
}
// Their drawer collects by default (owner 10-15): their own pair from the start, each other pair the first time its thing
// happens (register.tsx earnSocks), never by luck; or every pair at once. Both live in the shared settings, so every
// window and the companion see the same drawer. The pair they already wear stays theirs.
export type SockMode = 'collect' | 'all'
export function sockMode(settings: Record<string, unknown>): SockMode {
  return settings.socksMode === 'all' ? 'all' : 'collect'
}
export function socksEarned(settings: Record<string, unknown>): SockPair[] {
  const kept = settings.socksEarned
  return Array.isArray(kept) ? SOCK_PAIRS.filter(pair => pair !== 'honmei' && kept.includes(pair)) : []
}
export function socksOpen(settings: Record<string, unknown>): SockPair[] {
  if (sockMode(settings) === 'all') return [...SOCK_PAIRS]
  const earned = socksEarned(settings), worn = sockPair(settings.socks)
  return SOCK_PAIRS.filter(pair => pair === 'honmei' || pair === worn || earned.includes(pair))
}

export type BagGroup = 'voice' | 'band' | 'reminders' | 'cost' | 'records' | 'neighbours' | 'language'
export type BagTag = 'tokens' | 'off' | 'mac' | 'new'
export type BagWords = {
  entry: string; title: string; pages: readonly string[]; socks: readonly string[]; alt: readonly string[]
  vibe?: Partial<Record<VibeSituation, readonly VibeSet[]>>
  // the pages' insides (step 2): the switches page's groups, the marks after a label, the share card
  groups?: Record<BagGroup, string>; tags?: Record<BagTag, string>
  vibeGroups?: Record<'tests' | 'session' | 'share', string>; zineGroups?: Record<'week' | 'issues' | 'extras', string>
  himGroups?: Record<'companion' | 'together', string>; quotaGroups?: Record<'quota' | 'session' | 'more', string>
  noteGroups?: Record<'notes' | 'lastStop', string>
  look?: Record<'label' | 'coco' | 'dake' | 'maid' | 'fish' | 'help', string> // who is on the desktop band and the pet (claudeForm)
  bagStyle?: Record<'label' | 'classic' | 'mv' | 'help', string> // the bag's pictures: the current ones or the MV's (bagStyle)
  // their open windows on the first page (E1-2): the group's name with {n}, what a window is doing since {time} or now,
  // and the marks for the window you are reading in and the one the desktop pet follows
  windows?: Record<'title' | 'working' | 'quiet' | 'workingNow' | 'quietNow' | 'here' | 'follows', string>
  sockGroups?: Record<'drawer', string>; sockRows?: Record<'wearing' | 'back', string>; zineRows?: Record<'issue' | 'open', string>
  share?: Record<'make' | 'save' | 'folder', string>; shareHelp?: string
  // a page's line on top saying what its badges say (book.tsx pageLead fills the numbers)
  lead?: Partial<Record<Page, string>>
  // the vibe check page's rows (book.tsx vibeGroupBlocks fills them)
  vibeRows?: Record<VibeRow, string>
}
export type VibeRow = 'firstFail' | 'fixed' | 'storms' | 'stormsHelp' | 'build' | 'buildSlow' | 'tools' | 'toolKinds' | 'helpers' | 'commits' | 'compactions' | 'shareCard'
let bagText: Partial<Record<string, BagWords>> | undefined
export async function loadBagWords(read: () => Promise<string>): Promise<boolean> {
  if (bagText) return true
  try {
    const parsed = JSON.parse(await read()) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) bagText = parsed as Partial<Record<string, BagWords>>
  } catch {
    // the panel keeps the book's own words until the names can be read
  }
  return bagText !== undefined
}
export function bagWords(lang: string): BagWords | undefined {
  return bagText?.[lang] ?? bagText?.en
}
export function bagPageName(lang: string, page: Page): string | undefined {
  return bagWords(lang)?.pages[BAG_PAGES.indexOf(page)]
}
// Their vibe check (CANON: a verdict from what really happened this session, two roasts aimed only at bugs, tests and
// Claude, then a way out; never luck). The situation comes from this session's own counts, the first that holds; lane B
// writes three sets of words for each (bag-text.json `vibe`), and the local day picks the set, so it holds all day.
export const VIBE_SITUATIONS = ['stillRed', 'redToGreen', 'allGreen', 'compacted', 'noTests'] as const
export type VibeSituation = typeof VIBE_SITUATIONS[number]
export type VibeSet = { verdict: string; roasts: readonly string[]; step: string }
export type VibeFacts = { failed: number; fixed: number; compacted: number; ran?: number; last?: 'pass' | 'fail' }
export type VibeRarity = 'R' | 'SR' | 'SSR'
// How much drama the session had (his 10-17 read of the share card's draft): went berserk and still came back green, SSR;
// fixed something, or squashed twice or more, SR; anything else, R. The share card and the bag's MV picture both say it.
export function vibeRarity(f: VibeFacts & { storms?: number }): VibeRarity {
  if ((f.storms ?? 0) > 0 && vibeSituation(f) === 'redToGreen') return 'SSR'
  return f.fixed > 0 || f.compacted >= 2 ? 'SR' : 'R'
}
export function vibeSituation(f: VibeFacts): VibeSituation {
  if (f.last === 'fail') return 'stillRed'
  if ((f.ran ?? 0) > 0) return f.failed > 0 ? 'redToGreen' : 'allGreen'
  return f.compacted >= 2 ? 'compacted' : 'noTests'
}
export function vibePick(sets: readonly VibeSet[], now: number, timeZone?: string): VibeSet | undefined {
  if (!sets.length) return undefined
  let day = Math.floor(now / 86_400_000)
  try { day = Math.round(Date.parse(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)) / 86_400_000) } catch { /* the UTC day */ }
  return sets[((day % sets.length) + sets.length) % sets.length]
}
export function vibeSet(lang: string, f: VibeFacts, now: number, timeZone?: string): VibeSet | undefined {
  return vibePick(bagWords(lang)?.vibe?.[vibeSituation(f)] ?? [], now, timeZone)
}
export function bagFill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ''))
}

// ---------------------------------------------------------------- the art

const INK = '#141418', RULE = '#1E2A3A', CORAL = '#D97757', CORAL_DEEP = '#AE5539', BLUE = '#3A86C8', CREAM = '#FFFDF8', OFF = '#B9B2AC'
const TESSERA = ['#1E4F80', '#24578A', '#2F6FA8', '#3A86C8', '#79B6E6', '#F4ECE4', '#F2A587', '#D97757', '#AE5539']
const T30 = 0.5774

const n1 = (value: number) => Math.round(value * 10) / 10
// The colour a little quieter (owner 10-14: 「整体背景稍微素雅一点点」): mixed t of the way toward a light grey.
function mute(hex: string, t = 0.16): string {
  const toward = [196, 194, 192]
  return '#' + [1, 3, 5].map((at, i) => {
    const c = parseInt(hex.slice(at, at + 2), 16)
    return Math.round(c + (toward[i]! - c) * t).toString(16).padStart(2, '0').toUpperCase()
  }).join('')
}
// Seeded, so the same width always draws the same ground.
function seeded(seed: number): () => number {
  let state = seed >>> 0 || 1
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296 }
}
// Balla's iridescent interpenetrations: the ground cut into triangles on a grid leaning 30 degrees, from their blue on the
// left through cream to Claude coral on the right, a few dark ones for weight.
function tesserae(w: number, h: number): string {
  const random = seeded(w * 7 + h), out: string[] = [], cw = 44, ch = 46
  for (let j = 0; j < Math.floor(h / ch) + 2; j++) for (let i = -2; i < Math.floor(w / cw) + 4; i++) {
    const x0 = i * cw + j * ch * T30 * 0.6 - 30, y0 = j * ch - 10
    const t = Math.min(1, Math.max(0, (x0 + cw / 2) / w))
    for (const half of [0, 1]) {
      const k = Math.min(TESSERA.length - 1, Math.max(0, Math.round(t * (TESSERA.length - 1)) + [-1, 0, 0, 1][Math.floor(random() * 4)]!))
      const colour = random() < 0.025 ? RULE : TESSERA[k]!
      const points = (i + j) % 2
        ? half === 0 ? [[x0, y0], [x0 + cw, y0], [x0, y0 + ch]] : [[x0 + cw, y0], [x0 + cw, y0 + ch], [x0, y0 + ch]]
        : half === 0 ? [[x0, y0], [x0 + cw, y0 + ch], [x0, y0 + ch]] : [[x0, y0], [x0 + cw, y0], [x0 + cw, y0 + ch]]
      out.push(`<path d="M${points.map(([x, y]) => `${Math.round(x!)} ${Math.round(y!)}`).join(' L')} Z" fill="${mute(colour)}"/>`)
    }
  }
  return out.join('')
}
function gearPath(cx: number, cy: number, r: number, teeth = 8): string {
  const points: string[] = []
  for (let i = 0; i < teeth * 4; i++) {
    const a = Math.PI * 2 * i / (teeth * 4) - Math.PI / 2, rr = i % 4 < 2 ? r : r * 0.78
    points.push(`${n1(cx + rr * Math.cos(a))} ${n1(cy + rr * Math.sin(a))}`)
  }
  return 'M' + points.join(' L') + ' Z'
}
// A flat badge with an ink rim (settings_drafts.py flat_badge). Face up it wears its colour; turned off it is grey. What
// is printed on it says what it is: a switch (knob right when on), a test that failed (x), one fixed (a tick), a
// compaction (a squashed dot), a sock, a sticky note's lines, a quarter of a limit (a bar), a size (a dot that grows with n),
// an issue's number n.
export type BagBadge = { on: boolean; face: string; mark?: 'toggle' | 'x' | 'check' | 'squash' | 'sock' | 'note' | 'level' | 'size' | 'num'; n?: number }
const NUMBER_FONT = "-apple-system,'Segoe UI','Noto Sans',sans-serif"
function badge(cx: number, cy: number, r: number, b: BagBadge): string {
  const paper = b.on ? CREAM : '#DDD7D2', mark = b.mark ?? 'toggle'
  const disc = `<circle cx="${n1(cx)}" cy="${n1(cy)}" r="${n1(r)}" fill="${b.on ? b.face : OFF}" stroke="${INK}" stroke-width="1.6"/>`
  if (mark === 'level') return disc + `<rect x="${n1(cx - r * 0.55)}" y="${n1(cy - r * 0.28)}" width="${n1(r * 1.1)}" height="${n1(r * 0.56)}" rx="${n1(r * 0.12)}" fill="${paper}"/>`
  if (mark === 'x') { const d = r * 0.38; return disc + `<path d="M${n1(cx - d)} ${n1(cy - d)}L${n1(cx + d)} ${n1(cy + d)}M${n1(cx + d)} ${n1(cy - d)}L${n1(cx - d)} ${n1(cy + d)}" stroke="${paper}" stroke-width="${n1(r * 0.22)}" stroke-linecap="round"/>` }
  if (mark === 'check') return disc + `<path d="M${n1(cx - r * 0.42)} ${n1(cy)}l${n1(r * 0.3)} ${n1(r * 0.3)}l${n1(r * 0.52)} ${n1(-r * 0.56)}" fill="none" stroke="${paper}" stroke-width="${n1(r * 0.22)}" stroke-linecap="round" stroke-linejoin="round"/>`
  if (mark === 'squash') return disc + `<ellipse cx="${n1(cx)}" cy="${n1(cy)}" rx="${n1(r * 0.52)}" ry="${n1(r * 0.2)}" fill="${INK}"/>`
  if (mark === 'sock') {
    const u = r / 7, sock = `M${n1(cx - 2 * u)} ${n1(cy - 4 * u)}h${n1(3 * u)}v${n1(5 * u)}h${n1(2 * u)}a${n1(1.5 * u)} ${n1(1.5 * u)} 0 0 1 0 ${n1(3 * u)}h${n1(-4 * u)}a${n1(u)} ${n1(u)} 0 0 1 ${n1(-u)} ${n1(-u)}z`
    // a pair they do not have yet is only its dashed outline (owner 10-15): no colour until it is theirs
    if (!b.on) return `<circle cx="${n1(cx)}" cy="${n1(cy)}" r="${n1(r)}" fill="${CREAM}" fill-opacity=".55" stroke="${INK}" stroke-width="1.4" stroke-dasharray="${n1(r * 0.42)} ${n1(r * 0.3)}"/><path d="${sock}" fill="none" stroke="${INK}" stroke-opacity=".6" stroke-width="1"/>`
    return disc + `<path d="${sock}" fill="${light(b.face) ? INK : paper}"/>`
  }
  if (mark === 'size') return disc + `<circle cx="${n1(cx)}" cy="${n1(cy)}" r="${n1(r * (0.18 + (b.n ?? 0) * 0.1))}" fill="${paper}"/>`
  if (mark === 'num') {
    const text = String(b.n ?? ''), size = r * (text.length < 2 ? 1.05 : text.length < 3 ? 0.84 : 0.64)
    return disc + `<text x="${n1(cx)}" y="${n1(cy + size * 0.35)}" text-anchor="middle" font-family="${NUMBER_FONT}" font-weight="800" font-size="${n1(size)}" fill="${INK}">${text}</text>`
  }
  if (mark === 'note') return disc + [0, 1, 2].map(i => `<rect x="${n1(cx - r * 0.45)}" y="${n1(cy - r * 0.38 + i * r * 0.3)}" width="${n1(r * (i < 2 ? 0.9 : 0.55))}" height="${n1(r * 0.12)}" fill="${INK}"/>`).join('')
  const pw = r * 1.2, ph = r * 0.64, x0 = cx - pw / 2, knob = b.on ? x0 + pw - ph / 2 : x0 + ph / 2
  return disc + `<rect x="${n1(x0)}" y="${n1(cy - ph / 2)}" width="${n1(pw)}" height="${n1(ph)}" rx="${n1(ph / 2)}" fill="${paper}"/>`
    + `<circle cx="${n1(knob)}" cy="${n1(cy)}" r="${n1(ph * 0.34)}" fill="${INK}"/>`
}
// One badge on its own, `size` px square: a group's mark beside its name on the pages (settings_drafts.py mini_badge).
export function bagBadgeSvg(b: BagBadge, size = 18): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${badge(size / 2, size / 2, size / 2 - 1.2, b)}</svg>`
}
function light(hex: string): boolean {
  const [r, g, b] = [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16))
  return 0.299 * r! + 0.587 * g! + 0.114 * b! > 170
}
// The badges of the pages that count things: this session's failed tests (x, coral), fixed ones (a tick, blue) and
// compactions (squashed, blue), at most six of each kind; their sock drawer, a pair a badge in its own colour, grey until
// they have it; one sticky note a note.
export const SOCK_FACES: Readonly<Record<string, string>> = { honmei: CORAL, matcha: '#3CCB6E', blueberry: BLUE, sesame: '#34343B', mint: '#9ADBC0', strawberry: '#F4A6C0', taro: '#B79AD9', marshmallow: '#EFE6E2', goodgirl: '#25242A', nude: '#D29D7F', lan: '#222227', whitehat: '#FFFFFF', reddot: '#D9241C' }
export function vibeBadges(vibe: { failed: number; fixed: number; compacted: number }): BagBadge[] {
  const some = (n: number, b: BagBadge) => Array.from({ length: Math.max(0, Math.min(6, Math.floor(n))) }, () => b)
  return [...some(vibe.failed, { on: true, face: CORAL, mark: 'x' }), ...some(vibe.fixed, { on: true, face: BLUE, mark: 'check' }), ...some(vibe.compacted, { on: true, face: BLUE, mark: 'squash' })]
}
export function sockBadges(have: readonly string[]): BagBadge[] {
  return SOCK_PAIRS.map(pair => ({ on: have.includes(pair), face: SOCK_FACES[pair]!, mark: 'sock' }))
}
// Their page: the pet's switches face up where they are on, then the three sizes with the one they stand at face up.
export function petBadges(switches: readonly boolean[], size: number): BagBadge[] {
  return [...switches.map(on => ({ on, face: BLUE, mark: 'toggle' as const })), ...[1, 2, 3].map(n => ({ on: n - 1 === size, face: CORAL, mark: 'size' as const, n }))]
}
// The doujin: the latest issues in their collection, at most eight, the newest coral.
export function issueBadges(got: readonly number[]): BagBadge[] {
  const shown = got.slice(-8)
  return shown.map((n, k) => ({ on: true, face: k === shown.length - 1 ? CORAL : '#F4ECE4', mark: 'num' as const, n }))
}
export function noteBadges(notes: number): BagBadge[] {
  return Array.from({ length: Math.max(0, Math.min(12, Math.floor(notes))) }, () => ({ on: true, face: '#F7D768', mark: 'note' }))
}
// The quota charms on one split ring at the bag's top right corner: the 5h battery, the week power bank, four cells each.
function charm(kind: 'five' | 'week', x: number, y: number, left: number, k: number): string {
  const low = left === 1
  if (kind === 'five') {
    const w = 44 * k, h = 24 * k
    return `<rect x="${n1(x)}" y="${n1(y)}" width="${n1(w)}" height="${n1(h)}" rx="${n1(5 * k)}" fill="${CREAM}" stroke="${RULE}" stroke-width="${n1(2.2 * k)}"/>`
      + `<rect x="${n1(x + w)}" y="${n1(y + h * 0.3)}" width="${n1(4 * k)}" height="${n1(h * 0.4)}" rx="${n1(1.5 * k)}" fill="${RULE}"/>`
      + [0, 1, 2, 3].map(i => `<rect x="${n1(x + (5 + i * 9.4) * k)}" y="${n1(y + 5 * k)}" width="${n1(6.6 * k)}" height="${n1(h - 10 * k)}" rx="${n1(1.2 * k)}" fill="${i < left ? low ? CORAL : BLUE : '#D9CFC6'}"/>`).join('')
  }
  const w = 40 * k, h = 24 * k
  return `<rect x="${n1(x)}" y="${n1(y)}" width="${n1(w)}" height="${n1(h)}" rx="${n1(9 * k)}" fill="${RULE}" stroke="${RULE}" stroke-width="${n1(2.2 * k)}"/>`
    + `<rect x="${n1(x + 4 * k)}" y="${n1(y + h * 0.36)}" width="${n1(2.4 * k)}" height="${n1(h * 0.28)}" rx="${n1(k)}" fill="#9AA7B6"/>`
    + [0, 1, 2, 3].map(i => `<circle cx="${n1(x + (14 + i * 6.6) * k)}" cy="${n1(y + h / 2)}" r="${n1(2.3 * k)}" fill="${i < left ? low ? '#F2A587' : '#79B6E6' : '#3A4B60'}"/>`).join('')
}
function charms(ax: number, ay: number, quota: BagQuota, k: number): string {
  const b1x = ax + 6 * k, b1y = ay + 16 * k, b2x = ax + 10 * k, b2y = ay + 52 * k
  return `<circle cx="${n1(ax)}" cy="${n1(ay)}" r="${n1(6 * k)}" fill="none" stroke="#C9C2BC" stroke-width="${n1(2.6 * k)}"/>`
    + `<circle cx="${n1(ax)}" cy="${n1(ay)}" r="${n1(6 * k)}" fill="none" stroke="${RULE}" stroke-width="${n1(0.8 * k)}"/>`
    + (quota.five === undefined ? '' : `<path d="M${n1(ax + 3 * k)} ${n1(ay + 5 * k)}L${n1(b1x + 4 * k)} ${n1(b1y)}" stroke="${RULE}" stroke-width="${n1(1.6 * k)}" stroke-dasharray="${n1(2.5 * k)} ${n1(1.8 * k)}"/>` + charm('five', b1x, b1y, quota.five, k))
    + (quota.week === undefined ? '' : `<path d="M${n1(ax + 5 * k)} ${n1(ay + 4 * k)}L${n1(b2x + 6 * k)} ${n1(b2y)}" stroke="${RULE}" stroke-width="${n1(1.6 * k)}" stroke-dasharray="${n1(2.5 * k)} ${n1(1.8 * k)}"/>` + charm('week', b2x, b2y, quota.week, k))
}
// The bag in flat planes, Depero's way: a coral body with a darker base band, a black strap, a cream window ruled in black
// holding one badge a switch, the gear badge with two copies turned a few degrees behind it (it spins).
function bagBody(x: number, y: number, bw: number, bh: number, badges: readonly BagBadge[], r: number, quota?: BagQuota, rows?: readonly number[]): string {
  const out = [
    `<path d="M${Math.round(x + bw * 0.22)} ${y + 4} C${Math.round(x + bw * 0.22)} ${Math.round(y - bh * 0.45)} ${Math.round(x + bw * 0.78)} ${Math.round(y - bh * 0.45)} ${Math.round(x + bw * 0.78)} ${y + 4}" fill="none" stroke="${INK}" stroke-width="${n1(bh * 0.07)}"/>`,
    `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="10" fill="${CORAL}" stroke="${INK}" stroke-width="3"/>`,
    `<path d="M${n1(x + 1.5)} ${n1(y + bh * 0.82)}h${bw - 3}v${n1(bh * 0.18 - 11)}a8.5 8.5 0 0 1 -8.5 8.5h${-(bw - 20)}a8.5 8.5 0 0 1 -8.5 -8.5z" fill="${CORAL_DEEP}"/>`,
    `<rect x="${n1(x + bw * 0.05)}" y="${n1(y + bh * 0.07)}" width="${n1(bw * 0.9)}" height="${n1(bh * 0.05)}" fill="${INK}"/>`,
  ]
  const wx = x + bw * 0.05, wy = y + bh * 0.17, ww = bw * 0.6, wh = bh * 0.6
  out.push(`<rect x="${n1(wx)}" y="${n1(wy)}" width="${n1(ww)}" height="${n1(wh)}" fill="${CREAM}" stroke="${INK}" stroke-width="2.5"/>`)
  if (rows?.length) {
    // rows of their own (their page: the switches over the sizes), each row centred
    const cell = Math.min((ww - 8) / (Math.max(...rows) + 0.5), (wh - 6) / rows.length), rr = Math.min(r, cell / 2 - 2.5)
    let k = 0
    rows.forEach((count, row) => {
      for (let col = 0; col < count && k < badges.length; col++, k++)
        out.push(badge(wx + (ww - count * cell) / 2 + cell / 2 + col * cell, wy + 3 + cell / 2 + row * cell + (wh - 6 - rows.length * cell) / 2, rr, badges[k]!))
    })
  } else {
    const count = Math.max(1, badges.length), cols = Math.max(1, Math.ceil(Math.sqrt(count * ww / wh))), lines = Math.ceil(count / cols)
    const cell = Math.min((ww - 8) / (cols + 0.5), (wh - 6) / lines), rr = Math.min(r, cell / 2 - 2.5)
    badges.forEach((b, k) => {
      const row = Math.floor(k / cols), col = k % cols
      out.push(badge(wx + 4 + cell / 2 + col * cell + (row % 2) * cell * 0.45, wy + 3 + cell / 2 + row * cell + (wh - 6 - lines * cell) / 2, rr, b))
    })
  }
  const gr = bh * 0.3, gx = x + bw * 0.825, gy = y + bh * 0.47
  for (const [i, colour] of [[2, BLUE], [1, '#F2A587']] as const) out.push(`<g transform="rotate(${-i * 11} ${n1(gx)} ${n1(gy)}) translate(${-i * 5} ${i * 3})"><path d="${gearPath(gx, gy, gr * 1.04)}" fill="${colour}" stroke="${INK}" stroke-width="1.5"/></g>`)
  out.push(`<circle cx="${n1(gx)}" cy="${n1(gy)}" r="${n1(gr * 0.82)}" fill="${INK}"/><path d="${gearPath(gx, gy, gr * 0.7)}" fill="${CREAM}"/><circle cx="${n1(gx)}" cy="${n1(gy)}" r="${n1(gr * 0.24)}" fill="${CORAL}"/>`)
  for (let i = 0; i < 3; i++) {
    const rr2 = gr * (1.12 + i * 0.14)
    out.push(`<path d="M${n1(gx + rr2 * 0.5)} ${n1(gy - rr2 * 0.866)} A${n1(rr2)} ${n1(rr2)} 0 0 1 ${n1(gx + rr2)} ${n1(gy)}" fill="none" stroke="${CREAM}" stroke-width="${n1(2.4 - i * 0.7)}" stroke-linecap="round" opacity="${(0.9 - i * 0.28).toFixed(2)}"/>`)
  }
  if (quota && (quota.five !== undefined || quota.week !== undefined)) {
    out.push(`<circle cx="${n1(x + bw - 5)}" cy="${n1(y + 6)}" r="2.2" fill="#C9C2BC" stroke="${RULE}" stroke-width=".8"/>`)
    out.push(charms(x + bw + 2, y + 8, quota, 0.82 * Math.max(0.7, bh / 150)))
  }
  return out.join('')
}
function bagEcho(x: number, y: number, bw: number, bh: number): string {
  return `<path d="M${Math.round(x + bw * 0.22)} ${y} C${Math.round(x + bw * 0.22)} ${Math.round(y - bh * 0.45)} ${Math.round(x + bw * 0.78)} ${Math.round(y - bh * 0.45)} ${Math.round(x + bw * 0.78)} ${y}" fill="none" stroke="currentColor" stroke-width="5"/>`
    + `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="10" fill="currentColor"/>`
}

// The four cells left in each window (the band's pictures count the same way); absent where there is no reading.
export type BagQuota = { five?: number; week?: number }
export const BAG_ART_HEIGHT = { wide: 250, narrow: 176 } as const
export function bagArtHeight(width: number): number {
  return width > 400 ? BAG_ART_HEIGHT.wide : BAG_ART_HEIGHT.narrow
}
// The page's picture: the bag swinging in from the left with three phases of it behind (dark, blue, cream) like the legs of
// Balla's dog, force lines out of the gear, three swing arcs under it; the quota charms hang off it where the art is wide.
// Coco peeking in from the right (lane A's bag-peek.png, 236 x 360): Coco holds the picture's right edge, the dark line
// at x 223 of the drawing, and the fingers wrap over it, so the scene stops at that line and the fingers stay inside the pane.
export type BagPeek = { base64: string; width: number; height: number; outfit?: 'B' }
const PEEK_EDGE = 223 / 236
export function bagArtSvg(width: number, badges: readonly (boolean | BagBadge)[], quota?: BagQuota, rows?: readonly number[], peek?: BagPeek): string {
  const shown: BagBadge[] = badges.map((b, k) => typeof b === 'boolean' ? { on: b, face: k % 3 === 1 ? CORAL : BLUE, mark: 'toggle' } : b)
  const w = Math.max(160, Math.round(width)), h = bagArtHeight(w), wide = w > 400
  const [bw, bh] = wide ? [290, 146] : [180, 100], [bx, by] = wide ? [54, 74] : [26, 56]
  const gx = bx + bw * 0.825, gy = by + bh * 0.47, pivot = `${bx + bw / 2} ${n1(by - bh * 0.4)}`
  // Coco comes in the full height where the hair clears the gear's arcs (and the quota charms hanging off the bag), smaller
  // and standing on the bottom edge where room is shorter, and not at all below six tenths of the drawing's height
  const charmed = wide && quota !== undefined && (quota.five !== undefined || quota.week !== undefined)
  const full = peek ? peek.width * h / peek.height : 0, clear = charmed ? bx + bw + 56 : gx + bh * 0.3 * 1.5 + 4
  const iw = Math.min(full, (w - 2 - clear) / 0.96)
  const her = peek && iw >= full * 0.6 ? { iw, ih: iw * peek.height / peek.width, ix: w - iw - 2, edge: w - iw - 2 + iw * PEEK_EDGE } : undefined
  const right = her ? her.edge : w
  const clip = `M12 0H${n1(right - (her ? 0 : 12))}${her ? `V${h}` : `a12 12 0 0 1 12 12V${h - 12}a12 12 0 0 1 -12 12`}H12a12 12 0 0 1 -12 -12V12a12 12 0 0 1 12 -12Z`
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`,
    `<defs><clipPath id="bag-clip-${w}"><path d="${clip}"/></clipPath></defs>`,
    `<g clip-path="url(#bag-clip-${w})"><rect width="${w}" height="${h}" fill="#2F6FA8"/>`, tesserae(w, h),
  ]
  for (const [angle, colour, stroke] of [[-60, CREAM, 2], [-30, RULE, 2.5], [-8, CORAL, 5], [20, CREAM, 1.5]] as const) {
    const a = angle * Math.PI / 180
    out.push(`<path d="M${Math.round(gx)} ${Math.round(gy)} l${Math.round(Math.cos(a) * w)} ${Math.round(Math.sin(a) * w)}" stroke="${colour}" stroke-width="${stroke}" opacity=".8"/>`)
  }
  ;([[INK, 7], [CORAL, 5], [CREAM, 3]] as const).forEach(([colour, stroke], i) => {
    const rr = bw * (0.62 + i * 0.1), cx = bx + bw * 0.5, cy = by - bh * 0.4
    const a0 = (112 + i * 4) * Math.PI / 180, a1 = (150 + i * 3) * Math.PI / 180
    out.push(`<path d="M${Math.round(cx + rr * Math.cos(a0))} ${Math.round(cy + rr * Math.sin(a0) + bh * 0.9)} A${Math.round(rr)} ${Math.round(rr)} 0 0 1 ${Math.round(cx + rr * Math.cos(a1))} ${Math.round(cy + rr * Math.sin(a1) + bh * 0.9)}" fill="none" stroke="${colour}" stroke-width="${stroke}" stroke-linecap="round"/>`)
  })
  for (const [k, colour, opacity] of [[2, '#1E4F80', 0.5], [1, '#F4ECE4', 0.7]] as const) out.push(`<g style="color:${colour}" opacity="${opacity}" transform="translate(${-k * 22} ${k * 12}) rotate(${-8 - k * 5} ${pivot})">${bagEcho(bx, by, bw, bh)}</g>`)
  out.push(`<g transform="rotate(-8 ${pivot})">${bagBody(bx, by, bw, bh, shown, wide ? 14 : 9, wide ? quota : undefined, rows)}</g>`)
  if (her && peek) {
    // a calm plane of Coco's own, its left edge leaning and ruled dark, so the triangles stop where Coco starts (owner 10-14:
    // 「右边的小克他在里面显得有点看不清」); in B the cream hoodie would melt into it, so a darker sand there (A 10-17)
    const plane = her.ix + her.iw * 0.2
    out.push(`<path d="M${n1(plane - 22)} ${h}L${n1(plane + 18)} 0H${n1(right)}V${h}Z" fill="${peek.outfit === 'B' ? '#E3D3C3' : '#F4ECE4'}"/><path d="M${n1(plane - 22)} ${h}L${n1(plane + 18)} 0" stroke="${RULE}" stroke-width="3"/>`)
    out.push('</g>')
    // the edge Coco holds runs the picture's whole height, drawn like the line in the drawing
    out.push(`<path d="M${n1(her.edge)} 0V${h}" stroke="#282423" stroke-width="${n1(2.5 * her.ih / peek.height)}"/>`)
    out.push(`<image x="${n1(her.ix)}" y="${n1(h - her.ih)}" width="${n1(her.iw)}" height="${n1(her.ih)}" href="data:image/png;base64,${peek.base64}"/>`)
  } else out.push('</g>')
  out.push('</svg>')
  return contrastSvg(out.join(''))
}

// ---------------------------------------------------------------- the terminal's head

// Their bag on the terminal (settings_drafts.py bag_term80): a coral frame of half blocks, the page's number and name (as its
// tab writes them), three
// slashes on the diagonal, one badge a switch, and the two quota windows in four cells. What does not fit gives way: the
// cells, then the badges, then the slashes.
export type BagRun = { text: string; color?: 'claude' | 'suggestion' | 'inactive'; bold?: true }
export function bagTerminalHead(columns: number, page: string, switches: readonly boolean[], quota: BagQuota, width: (text: string) => number): BagRun[][] {
  const inner = Math.max(0, columns - 2)
  const title: BagRun = { text: ` ${page} `, bold: true }
  const slashes: BagRun = { text: '╱╱╱', color: 'claude' }
  const badges: BagRun[] = switches.map((on, i) => ({ text: on ? '(●)' : '(○)', color: on ? i % 3 === 1 ? 'claude' : 'suggestion' : 'inactive' }))
  const cells = (left: number) => '▮'.repeat(Math.max(0, Math.min(4, left))) + '▯'.repeat(4 - Math.max(0, Math.min(4, left)))
  const meters: BagRun[] = [
    ...(quota.five === undefined ? [] : [{ text: '  5h ', color: 'inactive' as const }, { text: cells(quota.five), color: quota.five <= 1 ? 'claude' as const : 'suggestion' as const }]),
    ...(quota.week === undefined ? [] : [{ text: ' week ', color: 'inactive' as const }, { text: cells(quota.week), color: quota.week <= 1 ? 'claude' as const : 'suggestion' as const }]),
  ]
  const runsWidth = (runs: readonly BagRun[]) => runs.reduce((sum, run) => sum + width(run.text), 0)
  const tries: BagRun[][] = [
    [title, slashes, { text: '  ' }, ...badges, ...meters],
    [title, slashes, { text: '  ' }, ...badges],
    [title, slashes],
    [title],
  ]
  let middle = tries.find(runs => runsWidth(runs) <= inner) ?? [{ text: title.text.trim().slice(0, inner), bold: true as const }]
  if (runsWidth(middle) > inner) middle = []
  const pad = Math.max(0, inner - runsWidth(middle))
  return [
    [{ text: '▗' + '▄'.repeat(inner) + '▖', color: 'claude' }],
    [{ text: '▐', color: 'claude' }, ...middle, { text: ' '.repeat(pad) }, { text: '▌', color: 'claude' }],
    [{ text: '▝' + '▀'.repeat(inner) + '▘', color: 'claude' }],
  ]
}
