// The breathing light in plugin/hooks-source/play-light.ts (lane C, 10-14).
import { describe, expect, test } from 'bun:test'
import { LED, LIGHT_PX, laptopLightSvg, lightLevel } from '../../../plugin/hooks-source/play-light'
import { breathLevel, BREATH_IN_MS } from '../../../plugin/hooks-source/play'

describe('the breathing light', () => {
  test('off, half and full follow the breath: full at the top of the breath in, off at the bottom of the breath out', () => {
    expect(lightLevel(breathLevel(0))).toBe(0)
    expect(lightLevel(breathLevel(BREATH_IN_MS))).toBe(2)
    expect(lightLevel(breathLevel(BREATH_IN_MS / 2))).toBe(1)
  })
  test('one CSS cycle set to the breath phase, the same ten seconds as the plume, and still under reduced motion', () => {
    const svg = laptopLightSvg(2500)
    expect(svg).toContain(`width="${LIGHT_PX.width}" height="${LIGHT_PX.height}"`)
    expect(svg).toContain('animation:led 10s infinite;animation-delay:-2500ms')
    expect(svg).toContain(`@media(prefers-reduced-motion:reduce){.led{animation:none;fill:${LED[1]}}`)
    expect(laptopLightSvg(2500, true)).toContain(`.led{animation:none;fill:${LED[1]}}`)
  })
  test('the phase wraps within the cycle and rounds to a tenth of a second', () => {
    expect(laptopLightSvg(12_540)).toContain('animation-delay:-2500ms')
  })
  test('the light sits where the design puts it, the glow centred on it', () => {
    const svg = laptopLightSvg(0)
    expect(svg).toContain('<rect class="led" x="16" y="7" width="2" height="1"/>')
    expect(svg).toContain('<circle class="glow" cx="17" cy="7.5" r="4.5"')
  })
})
