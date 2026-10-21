// The quota pictures in plugin/hooks-source/quota.ts against the design's own rows (play_sprites.py, 10-14).
import { describe, expect, test } from 'bun:test'
import { quotaBatteryRows, quotaBankRows, quotaPixelSvg, quotaPictures, quotaMeterText, quotaForecast, quotaForecastText, quotaBandItems } from '../../../plugin/hooks-source/quota'
import petPixels from '../../../plugin/companion-rs/tests/fixtures/quota-pixels.json'

const EXPECT: Record<string, string[]> = {"b62": [".OOOOOOOOOOOOOOOOOOOOOO...", "OhhhhhhhhhhhhhhhhhhhhhhO..", "OhiiiiiiiiiiiiiiiiiiiisO..", "OhibbbiibbbiieeeiieeeisOO.", "OhiBBBiiBBBiiEEEiiEEEisOMO", "OhiBBBiiBBBiiEEEiiEEEisOMO", "OhiBBBiiBBBiibbbiiEEEisONO", "OhiBBBiiBBBiiBBBiiEEEisONO", "OhiccciiccciiccciiEEEisOO.", "OhiiiiiiiiiiiiiiiiiiiisO..", "OhsssssssssssssssssssssO..", ".OOOOOOOOOOOOOOOOOOOOOO..."], "b25": [".OOOOOOOOOOOOOOOOOOOOOO...", "OhhhhhhhhhhhhhhhhhhhhhhO..", "OhiiiiiiiiiiiiiiiiiiiisO..", "OhirrriieeeiieeeiieeeisOO.", "OhiRRRiiEEEiiEEEiiEEEisOMO", "OhiRRRiiEEEiiEEEiiEEEisOMO", "OhiRRRiiEEEiiEEEiiEEEisONO", "OhiRRRiiEEEiiEEEiiEEEisONO", "OhiqqqiiEEEiiEEEiiEEEisOO.", "OhiiiiiiiiiiiiiiiiiiiisO..", "OhsssssssssssssssssssssO..", ".OOOOOOOOOOOOOOOOOOOOOO..."], "b0w": [".OOOOOOOOOOOOOOOOOOOOOO...", "OhhhhhhhhhhhhhhhhhhhhhhO..", "OhiiiiiiiiiiiYyiiiiiiisO..", "OhieeeiieeeiYyeeiieeeisOO.", "OhiEEEiiEEEYyEEEiiEEEisOMO", "OhiEEEiiEEYYYYyEiiEEEisOMO", "OhiEEEiiEEEiYyEEiiEEEisONO", "OhiEEEiiEEEYyEEEiiEEEisONO", "OhiEEEiiEEYyiEEEiiEEEisOO.", "OhiiiiiiiiyiiiiiiiiiiisO..", "OhsssssssssssssssssssssO..", ".OOOOOOOOOOOOOOOOOOOOOO..."], "b100": [".OOOOOOOOOOOOOOOOOOOOOO...", "OhhhhhhhhhhhhhhhhhhhhhhO..", "OhiiiiiiiiiiiiiiiiiiiisO..", "OhibbbiibbbiibbbiibbbisOO.", "OhiBBBiiBBBiiBBBiiBBBisOMO", "OhiBBBiiBBBiiBBBiiBBBisOMO", "OhiBBBiiBBBiiBBBiiBBBisONO", "OhiBBBiiBBBiiBBBiiBBBisONO", "OhiccciiccciiccciicccisOO.", "OhiiiiiiiiiiiiiiiiiiiisO..", "OhsssssssssssssssssssssO..", ".OOOOOOOOOOOOOOOOOOOOOO..."], "b9": [".OOOOOOOOOOOOOOOOOOOOOO...", "OhhhhhhhhhhhhhhhhhhhhhhO..", "OhiiiiiiiiiiiiiiiiiiiisO..", "OhieeeiieeeiieeeiieeeisOO.", "OhiEEEiiEEEiiEEEiiEEEisOMO", "OhiEEEiiEEEiiEEEiiEEEisOMO", "OhiEEEiiEEEiiEEEiiEEEisONO", "OhirrriiEEEiiEEEiiEEEisONO", "OhiqqqiiEEEiiEEEiiEEEisOO.", "OhiiiiiiiiiiiiiiiiiiiisO..", "OhsssssssssssssssssssssO..", ".OOOOOOOOOOOOOOOOOOOOOO..."], "k25": ["..OOOOOOOOOOOOOOOOOO..", ".OllllllllllllllllllO.", "OlLLLLLLLLLLLLLLLLLLLO", "OlLLLLLLLLLLLLLLLLLLLO", "OlMLLLrRRLDDDLDDDLDDDO", "OlZLLLRrRLDDDLDDDLDDDO", "OlZLLLRRRLDDDLDDDLDDDO", "OlMLLLLLLLLLLLLLLLLLLO", "OlLLLLLLLLLLLLLLLLLLLO", "OlLLLLLLLLLLLLLLLLLLLO", ".OkkkkkkkkkkkkkkkkkkO.", "..OOOOOOOOOOOOOOOOOO.."], "k96": ["..OOOOOOOOOOOOOOOOOO..", ".OllllllllllllllllllO.", "OlLLLLLLLLLLLLLLLLLLLO", "OlLLLLLLLLLLLLLLLLLLLO", "OlMLLLgGGLgGGLgGGLgGGO", "OlZLLLGgGLGgGLGgGLGgGO", "OlZLLLGGGLGGGLGGGLGGGO", "OlMLLLLLLLLLLLLLLLLLLO", "OlLLLLLLLLLLLLLLLLLLLO", "OlLLLLLLLLLLLLLLLLLLLO", ".OkkkkkkkkkkkkkkkkkkO.", "..OOOOOOOOOOOOOOOOOO.."], "k0w": ["..OOOOOOOOOOOOOOOOOO..", ".OllllllllllllllllllO.", "OlLLLLLLLLLLYyLLLLLLLO", "OlLLLLLLLLLYyLLLLLLLLO", "OlMLLLDDDLYyDLDDDLDDDO", "OlZLLLDDDYYYYyDDDLDDDO", "OlZLLLDDDLDYyLDDDLDDDO", "OlMLLLLLLLYyLLLLLLLLLO", "OlLLLLLLLYyLLLLLLLLLLO", "OlLLLLLLLyLLLLLLLLLLLO", ".OkkkkkkkkkkkkkkkkkkO.", "..OOOOOOOOOOOOOOOOOO.."], "k50": ["..OOOOOOOOOOOOOOOOOO..", ".OllllllllllllllllllO.", "OlLLLLLLLLLLLLLLLLLLLO", "OlLLLLLLLLLLLLLLLLLLLO", "OlMLLLgGGLgGGLDDDLDDDO", "OlZLLLGgGLGgGLDDDLDDDO", "OlZLLLGGGLGGGLDDDLDDDO", "OlMLLLLLLLLLLLLLLLLLLO", "OlLLLLLLLLLLLLLLLLLLLO", "OlLLLLLLLLLLLLLLLLLLLO", ".OkkkkkkkkkkkkkkkkkkO.", "..OOOOOOOOOOOOOOOOOO.."]}

describe('quota pictures', () => {
  test('the battery matches the design row for row', () => {
    expect(quotaBatteryRows(62)).toEqual(EXPECT.b62!)
    expect(quotaBatteryRows(25)).toEqual(EXPECT.b25!)
    expect(quotaBatteryRows(0, true)).toEqual(EXPECT.b0w!)
    expect(quotaBatteryRows(100)).toEqual(EXPECT.b100!)
    expect(quotaBatteryRows(9)).toEqual(EXPECT.b9!)
  })
  test('the power bank matches the design row for row', () => {
    expect(quotaBankRows(25)).toEqual(EXPECT.k25!)
    expect(quotaBankRows(96)).toEqual(EXPECT.k96!)
    expect(quotaBankRows(0, true)).toEqual(EXPECT.k0w!)
    expect(quotaBankRows(50)).toEqual(EXPECT.k50!)
  })
  test('62% and 70% left look different, so the picture follows the reading', () => {
    expect(quotaBatteryRows(62)).not.toEqual(quotaBatteryRows(70))
  })
  test('the svg is two CSS px a pixel and lightens only the edge outline on a dark ground', () => {
    const svg = quotaPixelSvg(quotaBatteryRows(62))
    expect(svg).toContain('width="52" height="24"')
    expect(svg).toContain('@media(prefers-color-scheme:dark){.e{fill:#A07B6A}}')
    expect(svg).toContain('class="e"')
  })
  test('a spent window is drawn empty under the bolt; missing windows draw nothing', () => {
    const p = quotaPictures([{ kind: 'five_hour', percentUsed: 100 }], ['five_hour'])
    expect(p.five).toBe(quotaPixelSvg(quotaBatteryRows(0, true)))
    expect(p.week).toBeUndefined()
  })
  test('the terminal says it plainly', () => {
    expect(quotaMeterText(38)).toBe('▮▮▯▯')
    expect(quotaMeterText(0)).toBe('▮▮▮▮')
    expect(quotaMeterText(75)).toBe('▮▯▯▯')
    expect(quotaMeterText(99)).toBe('▮▯▯▯')
    expect(quotaMeterText(100)).toBe('▯▯▯▯')
  })
})

describe('what the readings predict', () => {
  const H = 3_600_000, now = Date.UTC(2026, 9, 14, 14, 0)
  test('5h: the recent pace says where it lands by the reset and the even share left', () => {
    // 38% used, resets in 2h 10m, 11% an hour lately: 38 + 11 × 2.1667 ≈ 61.8 → 62; 62 left over 2.1667 h ≈ 28.6 → 29
    const f = quotaForecast({ kind: 'five_hour', percentUsed: 38, resetsAt: now + 130 * 60_000 }, now, 11)!
    expect(f.basis).toBe('recent')
    expect(f.reach).toBe(62)
    expect(f.allowance).toEqual({ per: 'hour', percent: 29 })
  })
  test("week: this week's average says it runs out before the reset", () => {
    // opened 4 days 20 hours ago (116 h), 75% used: 0.6466%/h; 25 left → 38.7 h, the reset is in 52 h
    const resetsAt = now + 52 * H, f = quotaForecast({ kind: 'seven_day', percentUsed: 75, resetsAt }, now, 30)!
    expect(f.basis).toBe('window')
    expect(f.reach).toBeUndefined()
    expect(Math.round((f.runsOutAt! - now) / H * 10) / 10).toBe(38.7)
    expect(f.allowance).toEqual({ per: 'day', percent: 12 })
  })
  test('the weekly window takes the recent pace only while it is hot', () => {
    const w = { kind: 'seven_day', percentUsed: 75, resetsAt: now + 52 * H }
    expect(quotaForecast(w, now, 2, true)!.basis).toBe('recent')
    expect(quotaForecast(w, now, 2, false)!.basis).toBe('window')
  })
  test('a fresh window does not stretch its first burst over the whole window', () => {
    // 20 minutes into a 5-hour window, no measured pace: too soon to predict, the even share still shows
    const f = quotaForecast({ kind: 'five_hour', percentUsed: 10, resetsAt: now + 280 * 60_000 }, now)!
    expect(f.basis).toBeUndefined()
    expect(f.allowance).toEqual({ per: 'hour', percent: 19 })
  })
  test('running out less than half an hour before the reset reads as reaching 100%', () => {
    const f = quotaForecast({ kind: 'five_hour', percentUsed: 90, resetsAt: now + H }, now, 11)!
    expect(f.runsOutAt).toBeUndefined()
    expect(f.reach).toBe(100)
  })
  test('no reset time, an unknown window or a spent one predicts nothing more', () => {
    expect(quotaForecast({ kind: 'five_hour', percentUsed: 38 }, now, 11)).toEqual({ kind: 'five_hour', used: 38 })
    expect(quotaForecast({ kind: 'spend_limit', percentUsed: 38, resetsAt: now + H }, now)).toBeUndefined()
    expect(quotaForecast({ kind: 'five_hour', percentUsed: 100, resetsAt: now + H }, now, 11)!.runsOutAt).toBeUndefined()
  })
  test('the words: whole sentences for the page, the compact form for the hover', () => {
    const f = quotaForecast({ kind: 'five_hour', percentUsed: 38, resetsAt: now + 130 * 60_000 }, now, 11)!
    expect(quotaForecastText('en', f, now, 'UTC')).toBe('at the recent pace, about 62% used by the reset, about 29% an hour to spare')
    expect(quotaForecastText('en', f, now, 'UTC', true)).toBe('~62% by the reset, ~29% an hour')
  })
})

describe('the band row', () => {
  test('both windows: short name, four cells, what is left; a quarter or less turns coral', () => {
    const items = quotaBandItems('en', [{ kind: 'five_hour', percentUsed: 38 }, { kind: 'seven_day', percentUsed: 75 }])
    // the week's short name is «week» in English (owner 10-15, DECISIONS 908)
    expect(items.map(i => [i.label, i.meter, i.tail, i.tone, i.flag])).toEqual([['5h', '▮▮▯▯', '62%', 'calm', ''], ['week', '▮▯▯▯', '25%', 'low', '']])
    expect(items[0]!.picture).toContain('width="52" height="24"')
    expect(items[1]!.picture).toContain('width="44" height="24"')
  })
  test('a hot window says when it runs out; a spent one waits under the bolt and says when it comes back', () => {
    const items = quotaBandItems('en', [{ kind: 'five_hour', percentUsed: 91 }, { kind: 'seven_day', percentUsed: 100 }], {
      pace: [{ kind: 'five_hour', narrow: 'out ~1h 10m', t: '~1h 10m' }], spent: [{ kind: 'seven_day', time: '16:10' }],
    })
    expect(items.map(i => [i.tone, i.flag, i.tail])).toEqual([['hot', 'out ~1h 10m', 'out ~1h 10m'], ['out', 'back at 16:10', 'back at 16:10']])
    expect(items[1]!.meter).toBe('▯▯▯▯')
    expect(items[1]!.picture).toBe(quotaPictures([], ['seven_day']).week!)
  })
  test('a spent window with no reading still shows, empty', () => {
    const items = quotaBandItems('en', [], { spent: [{ kind: 'five_hour', time: '16:10' }] })
    expect(items.length).toBe(1)
    expect(items[0]!.left).toBe(0)
  })
})

// The pets' Activity foot draws these same pictures (lane C, 10-17): the Rust pet's src/quota_pixels.rs and the Mac
// pet's QuotaPixels.swift are checked against this fixture, and the fixture against quota.ts here.
test('the pets\' fixture is quota.ts\'s rows', () => {
  expect(petPixels.cases.length).toBeGreaterThanOrEqual(30)
  for (const item of petPixels.cases) {
    expect(quotaBatteryRows(item.left, item.waiting)).toEqual(item.battery)
    expect(quotaBankRows(item.left, item.waiting)).toEqual(item.bank)
  }
})
