import { PIXEL_COLUMNS, PIXEL_DOOR_COLUMNS, PIXEL_ROWS, pixelCells, pixelDoorCells, pixelPng, pixelStill, pixelWear, setPixelWear } from './coco-pixel-play'
import type { PixelWear } from './coco-pixel-play'
import { contrastSvg } from './high-contrast'
// Sizes and Coco's pixel stills for the band and the book. The old figure's picture pool (motion-data.json and
// its painted and pixel stills) left the plugin with his go of 10-16 (DECISIONS 947).
import type { FrameName } from './art'
import { STILL_SIZES, STILL_FRAME_METADATA, STILL_FRAME_NAMES, STILL_ANIMATION_MODE } from './motion-stills'
export { getMotionWidth } from './d1-state.js'
import type { AnimationMode } from './motion-svg'
const DESKTOP_SIZE={width:STILL_SIZES.desktop_size[0],height:STILL_SIZES.desktop_size[1]}
export const ANIMATION_MODE:AnimationMode=STILL_ANIMATION_MODE
export function terminalMotionFrame(frame:string):FrameName {
  const aliases:Record<string,FrameName>={'work-c':'work-a','work-d':'work-b','think-c':'think-a','think-d':'think-b','shiori-a':'flustered','shiori-b':'flustered'}
  if(aliases[frame])return aliases[frame]!
  if((STILL_FRAME_NAMES as readonly string[]).includes(frame))return frame as FrameName
  const meta=STILL_FRAME_METADATA.find(item=>item.name===frame);return meta&&(STILL_FRAME_NAMES as readonly string[]).includes(meta.base)?meta.base as FrameName:'idle-reading'
}

const cache = new Map<string, string>()

function once(key: string, make: () => string): string {
  let value = cache.get(key)
  if (value === undefined) {
    value = make()
    cache.set(key, value)
  }
  return value
}

// ---------------------------------------------------------------- desktop

export const DESKTOP_REST = 64 // CSS px tall; the PNG is 128 px, so 2x on a Retina screen
export const DESKTOP_COMPACT = 32
const PIXEL_SIZE = { width: STILL_SIZES.pixel_size[0], height: STILL_SIZES.pixel_size[1] } as const

export function desktopWidth(height: number, pixel = height === DESKTOP_COMPACT): number {
  const size = pixel ? PIXEL_SIZE : DESKTOP_SIZE
  return pixel ? Math.round((size.width * height) / size.height) : (size.width * height) / size.height
}

// The offering box (saisen-bako): a wooden box seen from the front, its body showing how full it
// is. The body colour alone keeps 3:1 against both a light and a dark band; the outline lightens
// in dark mode where the app's colour scheme reaches the image.
export function offeringSvg(percent: number, fixedOutline = false): string {
  const p = Math.max(0, Math.min(100, Math.round(percent)))
  return once(`box:${fixedOutline ? 'fixed:' : ''}${p}`, () => {
    const inner = 9 // px of body height that can fill
    const level = Math.round((inner * p) / 100)
    const fill = '#FAEEE9'
    const outline = fixedOutline ? 'stroke="#8A4A36"' : 'class="o"'
    return (
      contrastSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 18" width="20" height="18">') +
      (fixedOutline ? '' : '<style>.o{stroke:#573A33}@media (prefers-color-scheme:dark){.o{stroke:#E68F6F}}</style>') +
      `<path ${outline} d="M3.5 1.5h13l2 3h-17z" fill="#CC7556" stroke-width="1"/>` +
      '<path d="M6 2v2.5M9 2v2.5M12 2v2.5M15 2v2.5" stroke="#572A1C" stroke-width="1"/>' +
      `<rect ${outline} x="2" y="5" width="16" height="12" fill="#AA5E47" stroke-width="1"/>` +
      `<rect x="4" y="${7 + inner - level}" width="12" height="${level}" fill="${fill}"/>` +
      '</svg>'
    )
  })
}

// ---------------------------------------------------------------- terminal

// Coco's pixel version (DECISIONS 913, 917): 24 columns and 9 rows of half blocks (coco-pixel-play.ts).
export const TERMINAL_COLUMNS = PIXEL_COLUMNS
export const TERMINAL_ROWS = PIXEL_ROWS
export function setTerminalLook(look: PixelWear): void { setPixelWear(look) }

// Half-block cells, each [codePoint, foreground, background] as little-endian u32, in 24-bit
// colour or in colours the xterm 256 palette holds exactly.
// A visitor's pixels drawn over the frame: its top-left in the frame's pixels, rows of palette letters, and the colours as numbers.
export type CellOverlay = { key: string; x: number; y: number; rows: readonly string[]; rgb: readonly number[] }
export function spriteCells(frame: FrameName, colors: 'truecolor' | '256' = 'truecolor', overlay?: CellOverlay): string {
  const look = { ...pixelWear(), colors }
  if (!overlay) return pixelCells(pixelStill(frame), 0, look)
  // a visitor while she sleeps: she moves to the left edge and it stands on the ground to her right
  const width = overlay.rows[0]?.length ?? 0
  return pixelCells(pixelStill(frame), 0, look, { ...overlay, x: TERMINAL_COLUMNS - width, y: TERMINAL_ROWS * 2 - overlay.rows.length }, -4)
}

// The closed band's door: her sleeping face in one dim row of eight cells.
export const DOOR_COLUMNS = PIXEL_DOOR_COLUMNS
// The same still as a PNG, for kitty and Ghostty (the pixel version there too).
export function spritePng(frame: FrameName): string {
  return pixelPng(pixelStill(frame), 0, { ...pixelWear(), colors: 'truecolor' })
}
export function sleepingDoorCells(colors: 'truecolor' | '256' = 'truecolor'): string {
  return pixelDoorCells({ ...pixelWear(), colors })
}

// The kitty/Ghostty picture: her pixel frame as a PNG in the same box of cells as the half blocks
// (each cell one pixel wide and two tall).
export function imageColumns(rows: number): number {
  return Math.round((rows * PIXEL_COLUMNS) / PIXEL_ROWS)
}
