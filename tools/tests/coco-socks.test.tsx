// The socks from her drawer (10-14): the band player draws a worn pair over each picture it plays, and the
// band's picture worker reads both outfits' files (assets/coco/socks-<outfit>-<pair>.json) when a pair is asked for.
import { describe, expect, test } from 'claude-code/testing'
import * as COCO_FIXTURE from './coco-band-data'
import { cocoNext, cocoSocksWorn, cocoSvg, installCocoData, installCocoSocks } from '../hooks/coco-motion'
import type { CocoData, CocoSocks } from '../hooks/coco-motion'
import { band, desktopPicture, P, PERSON, RECENT, settleLegacyStart, world } from './world'

const COCO_BAND = (COCO_FIXTURE as { COCO_BAND_TEXT?: Record<string, string> }).COCO_BAND_TEXT ?? {}
const BLANK = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const data = (outfit: 'A' | 'B') => JSON.parse(COCO_BAND[outfit]!) as CocoData
// every picture of the outfit gets the same small patch, so any action shows it
const socksFor = (outfit: 'A' | 'B', pair: string): CocoSocks => ({
  outfit, pair, socks: Object.fromEntries(Object.keys(data(outfit).images).map(src => [src, { box: [12, 150, 40, 30], img: BLANK }])),
})
const START = { cwd: '/tmp/coco-socks', surface: 'desktop' as const, isInteractive: true }
async function flush($: any) { for (let i = 0; i < 30; i++) await $.command.run({ command: 'coco-socks-boundary', args: '', origin: PERSON, presentation: P }) }

describe('the player', () => {
  test('a worn pair is drawn over the picture, moved with it, and gone once she wears her own again', () => {
    installCocoData(data('A')); installCocoData(data('B'))
    const play = cocoNext(undefined, 'A', 'idle', 'idle', 0)
    expect(cocoSvg(play, 64, 0)).not.toMatch(/_s0"/)
    installCocoSocks('A', socksFor('A', 'matcha'))
    expect(cocoSocksWorn('A')).toBe('matcha')
    const svg = cocoSvg(play, 64, 0)
    const id = /<image id="(c[0-9a-z]+_s0)" x="12" y="150" width="40" height="30" href="data:image\/png;base64,/.exec(svg)?.[1]
    expect(id).toBeDefined()
    // inside the same group as her picture: the patch takes the picture's own moves
    expect(svg).toMatch(new RegExp(`<use href="#c[0-9a-z]+_i\\d+"/><use href="#${id}"/>`))
    installCocoSocks('A', undefined)
    expect(cocoSocksWorn('A')).toBe(undefined)
    expect(cocoSvg(play, 64, 0)).not.toMatch(/_s0"/)
  })
  test('a file for the wrong outfit or with an odd pair name is refused', () => {
    expect(() => installCocoSocks('A', socksFor('B', 'matcha'))).toThrow()
    expect(() => installCocoSocks('A', socksFor('A', '../band-A'))).toThrow()
    expect(() => installCocoSocks('A', { outfit: 'A', pair: 'matcha' } as unknown as CocoSocks)).toThrow()
    expect(cocoSocksWorn('A')).toBe(undefined)
  })
})

describe('the band', () => {
  test('the pair in her saved view is read for both outfits and she is drawn in it', { timeoutMs: 20000 }, async ($, on) => {
    const reads: string[] = []
    const readText = (path: string) => {
      const hit = /[\\/]assets[\\/]coco[\\/]socks-([AB])-([a-z]+)\.json$/.exec(path)
      if (!hit) return undefined
      reads.push(`${hit[1]} ${hit[2]}`)
      return JSON.stringify(socksFor(hit[1] as 'A' | 'B', hit[2]!))
    }
    const w = world(on, { store: RECENT, readText, initialState: { view: { socks: 'goodgirl' } } })
    await $.session.start(START); await settleLegacyStart($, w)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    await w.clock.advance(100); await flush($)
    await ui.press({ key: 'coco:band:poke' }); await w.clock.advance(500); await flush($)
    expect(reads.sort()).toEqual(['A goodgirl', 'B goodgirl'])
    // (the plugin's player is its own module instance: what it wears shows in what the band draws)
    expect(String((await desktopPicture(ui))?.props.source)).toMatch(/_s0" x="12" y="150"/)
  })
  test('a pair whose files cannot be read leaves her own on', { timeoutMs: 20000 }, async ($, on) => {
    const w = world(on, { store: RECENT, initialState: { view: { socks: 'nosuchpair' } } })
    await $.session.start(START); await settleLegacyStart($, w)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    await w.clock.advance(100); await flush($)
    await ui.press({ key: 'coco:band:poke' }); await w.clock.advance(500); await flush($)
    expect(String((await desktopPicture(ui))?.props.source)).not.toMatch(/_s0"/)
  })
})
