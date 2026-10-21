import { expect, test } from 'bun:test'
import { cupSvg } from '../../../plugin/hooks/cost/cup'
import { assertCupLegible } from './cup-contract'

test('W10 every emitted cup recomputes every mark against its specified grounds', () => {
  for (const state of ['warm', 'cooling', 'cold', 'kept'] as const) for (const [width, height] of [[16,22],[19,26]]) {
    const svg = cupSvg(state,width,height)
    assertCupLegible(svg)
    expect(svg).toContain('viewBox="0 0 16 22"')
    expect(svg).toContain(`width="${width}" height="${height}"`)
    expect((svg.match(/class="s"/g) ?? []).length).toBe(state==='cold'?0:state==='cooling'?1:2)
    expect(svg.includes('<ellipse')).toBe(state!=='cold')
    expect(svg.includes('stroke-dasharray="1.2 1"')).toBe(state==='cold')
    // No brazier (owner 10-09): kept warm is drawn exactly as warm, two wisps.
    expect(svg).not.toContain('M2.6 19.4H13.4L12.4 22H3.6Z')
    expect(svg).not.toContain('translate(')
    expect(svg.includes('class="k"')||svg.includes('class="e"')).toBe(false)
  }
})
test('kept warm draws the same cup as warm', () => {
  expect(cupSvg('kept')).toBe(cupSvg('warm'))
})
test('W10 broken emitted copies fail for a faint mark or either missing contrast block', () => {
  const svg=cupSvg('kept')
  expect(()=>assertCupLegible(svg.replace('forced-color-adjust:none','forced-color-adjust:auto'))).toThrow()
  expect(()=>assertCupLegible(svg.replace('@media(prefers-contrast:more),(forced-colors:active)','@media(unused)'))).toThrow()
  expect(()=>assertCupLegible(svg.replace('@media(prefers-contrast:more) and (prefers-color-scheme:dark)','@media(unused)'))).toThrow()
  expect(()=>assertCupLegible(svg.replace('#846D57','#F0EEE6'))).toThrow()
})
