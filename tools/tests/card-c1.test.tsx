import { describe, expect, test } from 'claude-code/testing'
import type { EngineInterface as Engine } from 'claude-code'
import { cardDestination, cardPng, cardSaveWords, cardWrap, revealCard, saveWeekCard, type CardDestination, type CardPlatform } from '../hooks/card'

// The saving path the share cards use: the week card since the omen card went (owner 10-15). A real 1080 × 1080 PNG
// (the wrong height) and a real 1080 × 1350 one (the week card's).
const PNG = 'iVBORw0KGgoAAAANSUhEUgAABDgAAAQ4AQAAAADEa1EiAAAApUlEQVR42u3BMQEAAADCoPVPbQlPoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB4Gj3eAAG8D63NAAAAAElFTkSuQmCC'
const WEEK_PNG = 'iVBORw0KGgoAAAANSUhEUgAABDgAAAVGAQAAAABTNDYnAAAAyUlEQVR42u3BMQEAAADCoPVPbQ0PoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIB3A81OAAEIy9R9AAAAAElFTkSuQmCC'
const START = '2026-10-04'
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"/>'

type Call = { argv: string[]; stdin?: string }
const unliteral = (s: string): string => s.slice(1, -1).replace(/''/g, "'")

function fake(platform: CardPlatform, selected = platform === 'macos' ? 'sips' : platform === 'windows' ? 'msedge' : 'rsvg-convert') {
  const home = platform === 'windows' ? "C:\\Users\\O'Neil 李" : "/tmp/O'Neil 李"
  const dest: CardDestination = { platform, home, folder: home + (platform === 'windows' ? '\\Pictures\\Coco' : '/Pictures/Coco') }
  const files = new Map<string, string>(), calls: Call[] = [], reads: string[] = [], writes: { path: string; text: string }[] = []
  const env: Record<string, string> = platform === 'windows' ? { USERPROFILE: home, OS: 'Windows_NT' } : { HOME: home }
  let payload = WEEK_PNG, exit = 0, xdg = '', hold: (() => Promise<void>) | undefined, active = 0, maximum = 0
  let failedMove = false
  const renderers: string[] = [], fresh: boolean[] = []
  const io = {
    plugin: { root: '/plugin' }, session: { id: async () => 'session-1' }, clock: { now: async () => 1791072000000 },
    env: { get: async (key: string) => env[key] },
    fs: {
      exists: async (path: string) => path === '/System/Library/CoreServices/SystemVersion.plist' ? platform === 'macos' : files.has(path),
      read: async (path: string) => {
        reads.push(path)
        if (!files.has(path)) throw new Error('missing file')
        return { base64: files.get(path)! }
      },
      write: async (path: string, text: string) => { writes.push({ path, text }); files.set(path, text) },
      stat: async (path: string) => ({ kind: 'file', isLink: false, size: Math.floor((files.get(path)?.length ?? 0) * .75) }),
    },
    process: { run: async (argv: string[], options?: { stdin?: string }) => {
      calls.push({ argv: [...argv], stdin: options?.stdin })
      const result = (code = 0, stdout = '') => ({ exitCode: code, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })
      if (argv[0] === 'xdg-user-dir') return result(xdg ? 0 : 1, xdg)
      if (argv[0] === 'rm') { for (const p of argv.slice(3)) for (const key of [...files.keys()]) if (key === p || key.startsWith(p + '/')) files.delete(key); return result() }
      if (argv[0] === 'mv') {
        if (failedMove) return result(1)
        const from = argv[3]!, to = argv[4]!
        if (!files.has(from)) return result(1)
        files.set(to, files.get(from)!); files.delete(from); return result()
      }
      if (argv[0] === 'powershell.exe') {
        const script = options?.stdin ?? ''
        const move = /Move-Item -LiteralPath ('(?:''|[^'])*') -Destination ('(?:''|[^'])*') -Force/.exec(script)
        if (move) {
          if (failedMove) return result(1)
          const from = unliteral(move[1]!), to = unliteral(move[2]!)
          if (!files.has(from)) return result(1)
          files.set(to, files.get(from)!); files.delete(from)
        }
        for (const m of script.matchAll(/Remove-Item -LiteralPath ('(?:''|[^'])*')/g)) {
          const p = unliteral(m[1]!)
          for (const key of [...files.keys()]) if (key === p || key.startsWith(p + '\\')) files.delete(key)
        }
        return result()
      }
      const name = argv[0]!.split(/[\\/]/).at(-1)!
      if (['sips', 'msedge', 'msedge.exe', 'rsvg-convert', 'chromium', 'chromium-browser', 'google-chrome', 'firefox'].includes(name)) {
        const png = name === 'sips' ? argv[argv.indexOf('--out') + 1]!
          : name === 'rsvg-convert' ? argv[argv.indexOf('-o') + 1]!
          : argv.find(a => a.startsWith('--screenshot='))?.slice(13) ?? argv[argv.indexOf('--screenshot') + 1]!
        renderers.push(name); fresh.push(!files.has(png))
        active++; maximum = Math.max(maximum, active)
        if (hold) await hold()
        active--
        if (name !== selected) {
          // A failing rasterizer may leave partial bytes behind. The next one
          // must explicitly clear them before it can claim success.
          files.set(png, 'partial'); return result(1)
        }
        if (payload) files.set(png, payload)
        return result(exit)
      }
      return result()
    } },
  }
  return { $: io as unknown as Engine, dest, files, calls, reads, writes, env, renderers, fresh,
    payload: (value: string) => { payload = value }, exit: (value: number) => { exit = value }, xdg: (value: string) => { xdg = value },
    hold: (value: (() => Promise<void>) | undefined) => { hold = value }, maximum: () => maximum,
    failMove: () => { failedMove = true } }
}

const drawing = () => {
  let built = 0
  return { build: async () => { built++; return SVG }, built: () => built }
}

describe('C1 share card saving (the week card)', () => {
  test('CJK wrapping keeps every character and never starts a line with closing punctuation', () => {
    const wrapped = cardWrap('世界世界。世界世界。', 'zh', 44, 100)
    expect(wrapped.join('')).toBe('世界世界。世界世界。')
    for (const line of wrapped) expect('。.,、,!?:;)]」』%~ー'.includes(line[0]!)).toBe(false)
  })
  test('PNG accepts an actual 1080 × 1350 image and rejects a wrong header or dimensions', () => {
    expect(cardPng(WEEK_PNG, 1350)).toBe(true)
    expect(cardPng(PNG, 1350)).toBe(false)
    expect(cardPng('not a PNG', 1350)).toBe(false)
    expect(cardPng(WEEK_PNG.slice(0, 44), 1350)).toBe(false)
    const wrong = atob(WEEK_PNG).split('').map(c => c.charCodeAt(0))
    wrong[19] = 57 // width 1081
    expect(cardPng(btoa(String.fromCharCode(...wrong)), 1350)).toBe(false)
  })
  test('destination discovery uses only own home and prescribed pictures locations', async () => {
    const mac = fake('macos'), win = fake('windows'), linux = fake('linux')
    expect(await cardDestination(mac.$)).toEqual(mac.dest)
    expect(await cardDestination(win.$)).toEqual(win.dest)
    linux.xdg('/tmp/图片 space\n')
    expect((await cardDestination(linux.$))?.folder).toBe('/tmp/图片 space/Coco')
    linux.xdg('relative\n')
    expect(await cardDestination(linux.$)).toEqual(linux.dest)
    linux.env.HOME = 'relative'
    expect(await cardDestination(linux.$)).toBe(undefined)
  })
  for (const platform of ['macos', 'windows', 'linux'] as const) {
    test(`${platform}: render exact argv, replace the same week's output and draw only when saving`, async () => {
      const f = fake(platform), card = drawing()
      expect(card.built()).toBe(0)
      const first = await saveWeekCard(f.$, START, card.build, f.dest)
      expect(first.kind).toBe('png')
      const second = await saveWeekCard(f.$, START, card.build, f.dest)
      expect(second).toEqual(first)
      expect(card.built()).toBe(2)
      expect(f.reads.every(p => p.endsWith('.png'))).toBe(true) // only the renderer's own output is read back
      expect([...f.files.keys()]).toEqual([f.dest.folder + (platform === 'windows' ? '\\' : '/') + 'week-2026-10-04.png'])
      expect(f.fresh.every(Boolean)).toBe(true)
      const call = f.calls.find(c => c.argv[0] === (platform === 'macos' ? 'sips' : platform === 'windows' ? 'msedge' : 'rsvg-convert'))!
      if (platform === 'macos') {
        expect(call.argv.slice(0, 4)).toEqual(['sips', '-s', 'format', 'png'])
        expect(call.argv[5]).toBe('--out')
        expect(f.calls.some(c => c.argv[0] === 'qlmanage')).toBe(false) // qlmanage crops anything but a square
      }
      if (platform === 'linux') expect(call.argv.slice(0, 5)).toEqual(['rsvg-convert', '-w', '1080', '-h', '1350'])
      if (platform === 'windows') {
        expect(call.argv).toContain('--disable-background-networking')
        expect(call.argv).toContain('--window-size=1080,1350')
        expect(call.argv.some(a => a.startsWith('--user-data-dir=') && a.includes("O'Neil 李"))).toBe(true)
        expect(call.argv.at(-1)).toContain("O'Neil%20%E6%9D%8E")
        const move = f.calls.find(c => c.stdin?.includes('Move-Item'))!
        expect(move.argv).toEqual(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', '-'])
        expect(move.stdin).toContain("O''Neil 李")
      }
      expect(await revealCard(f.$, first, platform)).toBe(true)
      if (first.kind === 'failed') throw new Error('unreachable')
      expect(f.calls.at(-1)?.argv).toEqual(platform === 'macos' ? ['open', '-R', first.path] : platform === 'windows' ? ['explorer', '/select,' + first.path] : ['xdg-open', f.dest.folder])
    })
  }
  test('missing renderer preserves SVG and erases every temporary/profile file', async () => {
    const f = fake('linux', 'none')
    const result = await saveWeekCard(f.$, START, drawing().build, f.dest)
    expect(result.kind).toBe('svg')
    expect([...f.files.keys()]).toEqual([f.dest.folder + '/week-2026-10-04.svg'])
    expect(f.renderers).toEqual(['rsvg-convert', 'chromium', 'chromium-browser', 'google-chrome', 'firefox'])
    expect(f.fresh.every(Boolean)).toBe(true)
    const preferences = f.writes.find(w => w.path.endsWith('/user.js'))!
    expect(preferences.text).toContain('user_pref("browser.offline", true)')
    expect(preferences.text).toContain('user_pref("toolkit.telemetry.enabled", false)')
    expect(cardSaveWords(result, { saved: 'Saved {path}', savedSvg: 'Drawing {path}', failed: 'Failed' }, f.dest.home)).toBe('Drawing ~/Pictures/Coco/week-2026-10-04.svg')
  })
  test('Firefox fallback uses its fresh own profile after clearing partial output', async () => {
    const f = fake('linux', 'firefox'), result = await saveWeekCard(f.$, START, drawing().build, f.dest)
    expect(result.kind).toBe('png')
    expect(f.fresh.every(Boolean)).toBe(true)
    const firefox = f.calls.find(c => c.argv[0] === 'firefox')!
    const profile = firefox.argv[firefox.argv.indexOf('--profile') + 1]!
    expect(profile.startsWith(f.dest.folder + '/.week-')).toBe(true)
    expect(firefox.argv).toContain('1080,1350')
    expect(f.writes.some(w => w.path === profile + '/user.js')).toBe(true)
    expect([...f.files.keys()].some(p => p.startsWith(profile))).toBe(false)
  })
  test('wrong renderer PNG is rejected and a valid SVG retained; failures are explicit', async () => {
    const f = fake('macos')
    f.payload(btoa('a long non-PNG renderer output that is not an image'))
    expect((await saveWeekCard(f.$, START, drawing().build, f.dest)).kind).toBe('svg')
    const square = fake('macos')
    square.payload(PNG)
    expect((await saveWeekCard(square.$, START, drawing().build, square.dest)).kind).toBe('svg')
    const missing = fake('macos')
    expect(await saveWeekCard(missing.$, START, async () => { throw new Error('missing illustration') }, missing.dest)).toEqual({ kind: 'failed' })
    expect(missing.renderers.length).toBe(0)
    const invalid = fake('macos'), card = drawing()
    expect(await saveWeekCard(invalid.$, '../2026-10-04', card.build, invalid.dest)).toEqual({ kind: 'failed' })
    expect(card.built()).toBe(0)
    expect(invalid.writes.length).toBe(0)
    const rename = fake('macos'); rename.failMove()
    expect(await saveWeekCard(rename.$, START, drawing().build, rename.dest)).toEqual({ kind: 'failed' })
    expect(rename.files.size).toBe(0)
    expect(await revealCard(rename.$, { kind: 'failed' }, 'macos')).toBe(false)
  })
  test('concurrent saves of one week queue and the final press replaces prior content', async () => {
    const f = fake('macos')
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let reached!: () => void
    const started = new Promise<void>(resolve => { reached = resolve })
    f.hold(async () => { reached(); await gate })
    const first = saveWeekCard(f.$, START, async () => SVG, f.dest)
    await started
    const second = saveWeekCard(f.$, START, async () => SVG.replace('/>', '><rect fill="#211B19"/></svg>'), f.dest)
    expect(f.renderers.length).toBe(1)
    release()
    const results = await Promise.all([first, second])
    expect(results[0]).toEqual(results[1])
    expect(f.maximum()).toBe(1)
    expect(f.renderers.length).toBe(2)
    expect(f.writes.filter(w => w.path.endsWith('.svg')).at(-1)?.text).toContain('fill="#211B19"')
    const temps = f.writes.filter(w => w.path.endsWith('.svg')).map(w => w.path)
    expect(temps[0] === temps[1]).toBe(false)
    expect(f.files.size).toBe(1)
  })
})
