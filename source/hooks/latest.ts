// What the drawings that must not subscribe to the band's fast-moving view (the transcript's
// rows, the footer, the book) read instead: the view as the plugin last wrote it, copied by one
// observer in pages.tsx, and the setting for his marks on the engine's rows. Plain module data,
// rebuilt on reload by the next write of the view.

import type { CocoView } from '../types'

// His marks in the conversation: `on`, all of them; `replies`, his alone (no cue above the
// person's prompts); `off`, none. The default is `replies` (owner, 2026-10-02 19:33: the app's
// bubble already shows who spoke, so the cue above the person's prompts only costs a line).
export type Marks = 'on' | 'replies' | 'off'
export const MARKS_DEFAULT: Marks = 'replies'

export const latest: {
  desktopRenders: number // own synchronous hook entries, distinct from downstream/core draws
  view: CocoView | undefined
  settings: Record<string, unknown> // activation-local batched settings; no render-time store read
  marks: Marks | undefined // undefined until the stored setting is read, once per load
  marksRead: Promise<Marks> | undefined // that one read, shared by every drawing waiting on it
  bandDrawnOn: Set<string> // VS Code and the phone, once either has drawn the painted band in this load
} = { desktopRenders: 0, view: undefined, settings: {}, marks: undefined, marksRead: undefined, bandDrawnOn: new Set() }

// Where the painted band is up, the heads beside replies stay quiet (owner 10-19, DECISIONS 1044, 1045). The desktop
// always asks for the band; VS Code and the phone count only once they have drawn it, so a host that never asks for it
// keeps her heads.
export function bandShownOn(surface: string, band: string | undefined): boolean {
  if (band === 'off') return false
  return surface === 'desktop' || (surface === 'vscode' || surface === 'mobile') && latest.bandDrawnOn.has(surface)
}

export function marksFrom(stored: unknown): Marks {
  return stored === 'off' || stored === 'replies' || stored === 'on' ? stored : MARKS_DEFAULT
}
