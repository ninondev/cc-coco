// Claudie's and maid Claudie's sixteen chibi expressions (tools/art/claudie-cells.py, plugin/assets/claudie), drawn on
// the desktop band in Coco's place when Claude's form is set to one of them (DECISIONS 927, 943); the terminal keeps
// Coco. Each of Coco's actions shows one still cell: no clip plays, the band's geometry still moves her.
import type { CocoActionKey } from './coco-motion'

export const CLAUDIE_FORMS = ['dake', 'maid'] as const
export type ClaudieForm = typeof CLAUDIE_FORMS[number]
export function claudieForm(value: unknown): ClaudieForm | undefined {
  return (CLAUDIE_FORMS as readonly unknown[]).includes(value) ? value as ClaudieForm : undefined
}

// The sixteen cells: 1 hello, 2 laughing, 3 thinking, 4 explaining, 5 surprised, 6 flustered, 7 pouting, 8 crying,
// 9 sleepy, 10 confused, 11 smug, 12 thumbs up, 13 sorry; Claudie 14 reading, 15 the book grown thick, 16 closing it;
// maid Claudie 14 offering tea, 15 writing in her order notebook, 16 a curtsy.
const SHARED = {
  wait: 1, hello: 1, firsttry: 2, fixed: 2, think: 3, search: 3, lookup: 3, plan: 4, run: 4, helper: 4, peek: 5,
  petted: 6, praised: 6, hood: 7, teapot: 7, wild: 8, doze: 9, nap: 9, error: 10, watch: 11, done: 12, pass: 12, out: 13,
  catch: 5,
} as const
export const CLAUDIE_CELLS: Record<ClaudieForm, Record<CocoActionKey, number>> = {
  dake: { ...SHARED, idle: 14, breath: 14, read: 14, work: 14, serious: 14, coffee: 11, pack: 15, shell: 16, night: 16 },
  maid: { ...SHARED, idle: 14, breath: 14, coffee: 14, read: 15, work: 15, serious: 15, pack: 15, shell: 16, night: 9 },
}

type Cells = { width: number; height: number; png: readonly string[] }
const installed: Partial<Record<ClaudieForm, Cells>> = {}
export function installClaudie(form: ClaudieForm, cells: Cells | undefined): void {
  if (cells && cells.png.length === 16) installed[form] = cells
  else delete installed[form]
}
export function claudieReady(form: ClaudieForm): boolean { return installed[form] !== undefined }

// Her cell for an action, fitted into the box the band keeps for Coco and standing on its bottom edge.
export function claudieSvg(form: ClaudieForm, action: CocoActionKey, width: number, height: number): string {
  const cells = installed[form]
  if (!cells) return ''
  const n = CLAUDIE_CELLS[form][action] ?? CLAUDIE_CELLS[form].idle
  const round = (v: number): string => String(Math.round(v * 100) / 100)
  return `<svg style="forced-color-adjust:none" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${round(width)} ${round(height)}" width="${round(width)}" height="${round(height)}" data-coco="${form} ${action}">`
    + `<image width="${round(width)}" height="${round(height)}" preserveAspectRatio="xMidYMax meet" href="data:image/png;base64,${cells.png[n - 1]}"/></svg>`
}

// PNG width and height from its header, for the canvas the sixteen share.
export function pngSize(base64: string): { width: number; height: number } | undefined {
  try {
    const head = atob(base64.slice(0, 44))
    if (head.slice(1, 4) !== 'PNG') return undefined
    const at = (i: number): number => (head.charCodeAt(i) << 24 >>> 0) + (head.charCodeAt(i + 1) << 16) + (head.charCodeAt(i + 2) << 8) + head.charCodeAt(i + 3)
    return { width: at(16), height: at(20) }
  } catch { return undefined }
}
