// Helpers as paper planes in plugin/hooks-source/play-planes.ts against the design's own rows (play_sprites.py, 10-14).
import { describe, expect, test } from 'bun:test'
import { PLANE_PX, PLANES_PX, planeRows, planeSvg } from '../../../plugin/hooks-source/play-planes'

const EXPECT: Record<string, string[]> = {"plane": ["...........OO", "........OOOhO", ".....OOOhhhO.", "..OOOhhhhhhO.", "OOhhhhhhhhO..", ".OOmmmmshO...", "...OOOmmsO...", "......OOsO...", "........O...."], "stack": ["...........OO", "........OOOhO", ".....OOOhhhO.", "..OOOhhhhhhO.", "OOhhhhhhhhOOO", ".OOmmmmshOOhO", "...OOOmmsOhO.", "..OOOhOOsOhO.", "OOhhhhhhOhO..", ".OOmmmmshO...", "...OOOmmsO...", "......OOsO...", "........O...."]}

describe('paper planes', () => {
  test('one plane and the stack of two match the design row for row', () => {
    expect(planeRows()).toEqual(EXPECT.plane!)
    expect(planeRows(true)).toEqual(EXPECT.stack!)
  })
  test('thrown in when a helper starts, flown back when it is done, dropped when it fails, in the helpers\' own timings; never repeated', () => {
    expect(planeSvg({ arrivalDelay: 1680, elapsed: 0 })).toContain('animation:pa 240ms cubic-bezier(0,0,.2,1) 1680ms both')
    expect(planeSvg({ leave: 'done', elapsed: 200 })).toContain('@keyframes pd{to{opacity:0;transform:translate(-8px,-3px)}}')
    expect(planeSvg({ leave: 'failed', elapsed: 0 })).toContain('rotate(24deg)')
    for (const svg of [planeSvg({ arrivalDelay: 0 }), planeSvg({ leave: 'done' })]) expect(svg).not.toContain('infinite')
    expect(planeSvg({ arrivalDelay: 0, reduced: true })).not.toContain('@keyframes')
  })
  test('sizes on the band', () => {
    expect(planeSvg()).toContain(`width="${PLANE_PX.width}" height="${PLANE_PX.height}"`)
    expect(planeSvg({}, true)).toContain(`width="${PLANES_PX.width}" height="${PLANES_PX.height}"`)
  })
})
