// Today's visitor in their room (VISITORS.md 4.2; the room of 10-16): an ordinary layer on the floor beside them,
// night-filtered like the rest, and the usb's light above the filter.
import { expect, test } from 'claude-code/testing'
import type { EngineInterface } from 'claude-code'
import { forgetRoom, loadRoomLayers, roomLayerNames, roomState, roomSvg } from '../hooks/d1-room'
import { D1_ROOM_ASSET_FILES } from './d1-room-assets-fixture'
import { VISITOR_ART_TEXT } from './visitor-art-fixture'

const ART_TEXT = VISITOR_ART_TEXT
const ART = JSON.parse(ART_TEXT) as { kinds: Record<string, { w: number; h: number; room: { x: number; y: number; 1: string; 2: string } }> }
const at = (hour: number) => Date.UTC(2026, 9, 6, hour)
const engine = (missing = false) => ({ plugin: { root: '/fixture' }, fs: { read: async (path: string, options?: { as: string }) => {
  const name = path.split(/[\\/]/).pop()!
  if (name === 'visitor-art.json') { if (missing) throw new Error('no such file'); return ART_TEXT }
  const source = D1_ROOM_ASSET_FILES[name]!
  return options ? { base64: source } : source
} } }) as unknown as EngineInterface
const images = (svg: string) => svg.match(/<image /g)?.length ?? 0

test('a visitor is one more layer, after them and before nothing else, and nothing without one', () => {
  const day = ['sky-day', 'room-day', 'line', 'ac', 'notes', 'lamp-day', 'mug', 'laptop', 'duck', 'teapot', 'flowers', 'mirror', 'box', 'cup', 'her-sleep']
  expect(roomLayerNames(roomState(at(7), 'UTC', true, false))).toEqual(day)
  expect(roomLayerNames(roomState(at(7), 'UTC', true, false, { visitor: 'bulb' }))).toEqual([...day, 'visitor-bulb'])
  expect(roomLayerNames(roomState(at(21), 'UTC', true, false, { visitor: 'plane', socks: ['mint'] }))).toEqual(
    ['sky-night', 'room-night', 'line', 'sock-mint#0', 'ac', 'notes', 'lamp-night', 'mug', 'laptop', 'duck', 'teapot', 'flowers', 'mirror', 'box', 'cup', 'lamp-light', 'her-sleep', 'visitor-plane'])
})
test('the usb lights above the night filter at dusk and after dark, and not by day', () => {
  expect(roomLayerNames(roomState(at(12), 'UTC', true, false, { visitor: 'usb' })).at(-1)).toBe('visitor-usb')
  expect(roomLayerNames(roomState(at(17), 'UTC', true, false, { visitor: 'usb' })).slice(-2)).toEqual(['visitor-usb', 'visitor-usb-lit'])
  expect(roomLayerNames(roomState(at(22), 'UTC', true, false, { visitor: 'usb' })).slice(-2)).toEqual(['visitor-usb', 'visitor-usb-lit'])
})
test('each of the eight kinds sits at its own spot, at both scales, inside the size limit', async () => {
  forgetRoom()
  await loadRoomLayers(engine())
  const plain = roomSvg(roomState(at(12), 'UTC', true, false), 2)
  for (const [kind, art] of Object.entries(ART.kinds)) {
    for (const scale of [1, 2] as const) {
      const svg = roomSvg(roomState(at(12), 'UTC', true, false, { visitor: kind }), scale)
      expect(images(svg), kind).toBe(images(roomSvg(roomState(at(12), 'UTC', true, false), scale)) + 1)
      // on the floor beside them (d1-room.source.ts VISIT), standing on the same line as their feet
      expect(svg, kind).toContain(`<image x="94" y="${82 - art.h}" width="${art.w}" height="${art.h}" href="data:image/png;base64,${art.room[scale]}"/>`)
      expect(svg.length).toBeLessThan(131072)
    }
    expect(roomSvg(roomState(at(12), 'UTC', true, false, { visitor: kind }), 2).length - plain.length, kind).toBeLessThan(700)
  }
})
test('at night the visitor is filtered with the room, and the usb keeps its own light', async () => {
  forgetRoom()
  await loadRoomLayers(engine())
  const night = roomSvg(roomState(at(22), 'UTC', true, false, { visitor: 'bulb' }), 2)
  const filtered = night.slice(night.indexOf('<g filter="url(#n)">'), night.lastIndexOf('</g>'))
  expect(filtered).toContain(ART.kinds.bulb!.room[2])
  const glow = roomSvg(roomState(at(22), 'UTC', true, false, { visitor: 'usb' }), 2)
  const after = glow.slice(glow.lastIndexOf('</g>'))
  expect(images(after)).toBe(1)
  expect(glow.indexOf('</g>')).toBeLessThan(glow.lastIndexOf('<image'))
})
test('a visitor the room has no layer for leaves the room as it was, and a missing file draws no visitor', async () => {
  forgetRoom()
  await loadRoomLayers(engine())
  expect(roomSvg(roomState(at(12), 'UTC', true, false, { visitor: 'owl' }), 2)).toBe(roomSvg(roomState(at(12), 'UTC', true, false), 2))
  forgetRoom()
  await loadRoomLayers(engine(true))
  expect(roomSvg(roomState(at(12), 'UTC', true, false, { visitor: 'bulb' }), 2)).toBe(roomSvg(roomState(at(12), 'UTC', true, false), 2))
})
