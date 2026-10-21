// Generated runtime copy by tools/build-card-lazy.py; card.ts SHA-256 05c5b04361f84e000944020029da822fa1afb305e0e3a489ed002595b4811397.
import type { EngineInterface as Engine } from 'claude-code'
import { cardWidth, type CardScript } from './card-metrics-lazy'
import { joinPath, windowsPath } from './d1-paths.js'

export const CARD_FONTS: Record<CardScript, string> = {
  latin: "'Iowan Old Style','Palatino Linotype','Book Antiqua',Georgia,'Noto Serif','DejaVu Serif',serif",
  zh: "'Songti SC','STSong','SimSun','Noto Serif CJK SC','Source Han Serif SC',serif",
  ja: "'Hiragino Mincho ProN','Yu Mincho','Noto Serif CJK JP','Source Han Serif JP',serif",
  ko: "'AppleMyungjo','Batang','Noto Serif KR','Nanum Myeongjo',serif",
  hi: "'Kohinoor Devanagari','Nirmala UI','Noto Serif Devanagari','Noto Sans Devanagari',sans-serif",
}
// Coco's name on a card's header, as everywhere else: 小克, 코코, and Coco in the Latin face in the other languages.
const CARD_NAMES: Record<string, string | undefined> = { zh: '小克', 'zh-Hant': '小克', ja: 'Coco', ko: '코코' }
export function cardName(lang: string): { text: string; latin: boolean } {
  const own = CARD_NAMES[lang]
  return own ? { text: own, latin: false } : { text: 'Coco', latin: true }
}
export function cardCrest(cx: number, cy: number, r: number, color: string, sw: number): string {
  let d = ''
  for (const a of [90, 0, 45, 135]) {
    const dx = Math.cos(a * Math.PI / 180) * r, dy = Math.sin(a * Math.PI / 180) * r
    d += `M${(cx - dx).toFixed(1)} ${(cy - dy).toFixed(1)}L${(cx + dx).toFixed(1)} ${(cy + dy).toFixed(1)}`
  }
  return `<path d="${d}" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>`
}
export function cardWrap(text: string, script: CardScript, size: number, max: number, factor = 1): string[] {
  const lines: string[] = []
  let current = ''
  const unspaced = script === 'zh' || script === 'ja'
  for (const word of unspaced ? [...text] : text.split(' ')) {
    const next = current && !unspaced ? current + ' ' + word : current + word
    if (cardWidth(next, script, size) * factor > max && current && !(unspaced && '。.,、,!?:;)]」』%~ー'.includes(word))) {
      lines.push(current); current = word
    } else current = next
  }
  if (current) lines.push(current)
  return lines
}
export type CardPlatform = 'macos' | 'windows' | 'linux'
export type CardDestination = { platform: CardPlatform; home: string; folder: string }
export type CardSaveResult = { kind: 'png' | 'svg'; path: string; folder: string } | { kind: 'failed' }
export async function cardDestination($: Engine): Promise<CardDestination | undefined> {
  const home = await $.env.get('HOME'), profile = await $.env.get('USERPROFILE'), os = await $.env.get('OS')
  const win = os === 'Windows_NT' || (!home && windowsPath(profile ?? ''))
  const root = win ? profile : home
  if (!root || (!win && !root.startsWith('/')) || (win && !windowsPath(root))) return undefined
  if (win) return { platform: 'windows', home: root, folder: joinPath(root, 'Pictures', 'Coco') }
  if (await $.fs.exists('/System/Library/CoreServices/SystemVersion.plist')) return { platform: 'macos', home: root, folder: joinPath(root, 'Pictures', 'Coco') }
  let pictures = ''
  try {
    const r = await $.process.run(['xdg-user-dir', 'PICTURES'], { timeoutMs: 2000 })
    if (r.exitCode === 0 && !r.isStdoutTruncated && /^\/[^\r\n]*$/.test(r.stdout.trim())) pictures = r.stdout.trim()
  } catch { /* The prescribed fallback is ~/Pictures. */ }
  return { platform: 'linux', home: root, folder: joinPath(pictures || joinPath(root, 'Pictures'), 'Coco') }
}
const psLiteral = (s: string): string => "'" + s.replace(/'/g, "''") + "'"
async function removeOwn($: Engine, platform: CardPlatform, paths: string[], directory = false): Promise<void> {
  if (!paths.length) return
  if (platform === 'windows') {
    const script = paths.map(p => `Remove-Item -LiteralPath ${psLiteral(p)} -Force ${directory ? '-Recurse ' : ''}-ErrorAction SilentlyContinue`).join('\n')
    await $.process.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', '-'], { stdin: script, timeoutMs: 2000 })
  } else await $.process.run(['rm', directory ? '-rf' : '-f', '--', ...paths], { timeoutMs: 2000 })
}
async function moveOwn($: Engine, platform: CardPlatform, from: string, to: string): Promise<void> {
  const r = platform === 'windows'
    ? await $.process.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', '-'], { stdin: `$ErrorActionPreference='Stop'\nMove-Item -LiteralPath ${psLiteral(from)} -Destination ${psLiteral(to)} -Force`, timeoutMs: 2000 })
    : await $.process.run(['mv', '-f', '--', from, to], { timeoutMs: 2000 })
  if (r.exitCode !== 0) throw new Error('card rename failed')
}
const localUrl = (path: string): string => 'file://' + (windowsPath(path) ? '/' : '') + path.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/')
export function cardPng(base64: string, height: number): boolean {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const bytes: number[] = []
  let bits = 0, value = 0
  if (base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return false
  for (const ch of base64.replace(/=+$/, '')) {
    const digit = alphabet.indexOf(ch)
    if (digit < 0) return false
    value = (value << 6) | digit; bits += 6
    if (bits >= 8) { bits -= 8; bytes.push((value >>> bits) & 255) }
  }
  const signature = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]
  const integer = (i: number): number => bytes.slice(i, i + 4).reduce((n, b) => n * 256 + b, 0)
  if (!signature.every((b, i) => bytes[i] === b) || integer(16) !== 1080 || integer(20) !== height) return false
  let offset = 8, imageData = false
  while (offset + 12 <= bytes.length) {
    const size = integer(offset), end = offset + 12 + size
    if (end > bytes.length) return false
    const kind = String.fromCharCode(...bytes.slice(offset + 4, offset + 8))
    let crc = 0xffffffff
    for (let i = offset + 4; i < end - 4; i++) {
      crc ^= bytes[i]!
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
    if (((crc ^ 0xffffffff) >>> 0) !== integer(end - 4)) return false
    if (kind === 'IDAT') imageData = true
    if (kind === 'IEND') return imageData && size === 0 && end === bytes.length
    offset = end
  }
  return false
}
async function rasterize($: Engine, dest: CardDestination, svg: string, png: string, profile: string, height: number): Promise<boolean> {
  const run = async (argv: string[]): Promise<boolean> => {
    try {
      await removeOwn($, dest.platform, [png])
      const r = await $.process.run(argv, { timeoutMs: 30_000 })
      if (r.exitCode !== 0 || !(await $.fs.exists(png))) return false
      const stat = await $.fs.stat(png)
      return stat.kind === 'file' && !stat.isLink && stat.size > 32 && cardPng((await $.fs.read(png, { as: 'bytes' })).base64, height)
    } catch { return false }
  }
  // qlmanage crops anything but a square, so the portrait card goes through sips.
  if (dest.platform === 'macos') return run(['sips', '-s', 'format', 'png', svg, '--out', png])
  const browser = (name: string): string[] => [name, '--headless', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, `--screenshot=${png}`, `--window-size=1080,${height}`, localUrl(svg)]
  if (dest.platform === 'windows') {
    if (await run(browser('msedge'))) return true
    const programs = [await $.env.get('PROGRAMFILES(X86)'), await $.env.get('PROGRAMFILES'), await $.env.get('LOCALAPPDATA')]
    for (const root of programs) if (root && await run(browser(joinPath(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe')))) return true
    return false
  }
  if (await run(['rsvg-convert', '-w', '1080', '-h', String(height), '-o', png, svg])) return true
  for (const name of ['chromium', 'chromium-browser', 'google-chrome']) if (await run(browser(name))) return true
  // Firefox requires a fresh existing profile directory, never the user's profile.
  try {
    await $.fs.write(joinPath(profile, 'user.js'), [
      'user_pref("browser.offline", true);', 'user_pref("network.manage-offline-status", false);',
      'user_pref("app.update.enabled", false);', 'user_pref("app.update.auto", false);',
      'user_pref("toolkit.telemetry.enabled", false);', 'user_pref("datareporting.healthreport.uploadEnabled", false);',
      'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
      'user_pref("network.captive-portal-service.enabled", false);', 'user_pref("network.connectivity-service.enabled", false);',
      'user_pref("browser.safebrowsing.malware.enabled", false);', 'user_pref("browser.safebrowsing.phishing.enabled", false);',
    ].join('\n'))
  } catch { return false }
  return run(['firefox', '--headless', '--no-remote', '--profile', profile, '--screenshot', png, '--window-size', `1080,${height}`, localUrl(svg)])
}
const SAVING = new Map<string, Promise<CardSaveResult>>()
// The portrait week card: `build` returns the SVG after loading what it draws. The file is
// <Pictures>/Coco/week-<first day>.png, replaced by a later save; an SVG stays if no renderer works.
export async function saveWeekCard($: Engine, start: string, build: () => Promise<string>, destination?: CardDestination): Promise<CardSaveResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return { kind: 'failed' }
  return saveCard($, `week-${start}`, build, destination)
}
// Any portrait card (1080 by 1350) saved as <Pictures>/Coco/<stem>.png; the vibe check card's stem is vibe-<day>-<time>.
export async function saveCard($: Engine, stem: string, build: () => Promise<string>, destination?: CardDestination): Promise<CardSaveResult> {
  let dest: CardDestination | undefined
  try { dest = destination ?? await cardDestination($) } catch { return { kind: 'failed' } }
  if (!dest || !/^[a-z]+-[0-9-]+$/.test(stem)) return { kind: 'failed' }
  const held = dest, key = joinPath(held.folder, stem), before = SAVING.get(key)
  const task = (async (): Promise<CardSaveResult> => {
    if (before) await before
    const token = Math.floor(await $.clock.now()).toString(36) + '-' + (await $.session.id()).replace(/[^a-z0-9_-]/gi, '').slice(0, 80) + '-' + Math.random().toString(36).slice(2)
    const temp = joinPath(held.folder, `.${stem}-${token}.svg`), profile = temp + '.profile', generated = temp.replace(/\.svg$/, '.png')
    try {
      await $.fs.write(temp, await build())
      if (await rasterize($, held, temp, generated, profile, 1350)) {
        await moveOwn($, held.platform, generated, key + '.png')
        return { kind: 'png', path: key + '.png', folder: held.folder }
      }
      await moveOwn($, held.platform, temp, key + '.svg')
      return { kind: 'svg', path: key + '.svg', folder: held.folder }
    } catch { return { kind: 'failed' } }
    finally {
      await removeOwn($, held.platform, [temp, generated]).catch(() => {})
      await removeOwn($, held.platform, [profile], true).catch(() => {})
    }
  })().catch((): CardSaveResult => ({ kind: 'failed' }))
  SAVING.set(key, task)
  const result = await task
  if (SAVING.get(key) === task) SAVING.delete(key)
  return result
}
// Show the saved file selected in the file manager; Linux can only open the folder.
export async function revealCard($: Engine, result: CardSaveResult, platform: CardPlatform): Promise<boolean> {
  if (result.kind === 'failed') return false
  try {
    const argv = platform === 'macos' ? ['open', '-R', result.path] : platform === 'windows' ? ['explorer', '/select,' + result.path] : ['xdg-open', result.folder]
    const r = await $.process.run(argv, { timeoutMs: 2000 })
    return platform === 'windows' || r.exitCode === 0
  } catch { return false }
}
export function cardSaveWords(result: CardSaveResult, words: { saved: string; savedSvg: string; failed: string }, home: string): string {
  if (result.kind === 'failed') return words.failed
  const path = result.path === home ? '~' : result.path.startsWith(home + (windowsPath(home) ? '\\' : '/')) ? '~' + result.path.slice(home.length) : result.path
  return (result.kind === 'svg' ? words.savedSvg : words.saved).replace('{path}', path)
}
