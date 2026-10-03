// What the drawings that must not subscribe to the band's fast-moving view (the transcript's
// rows, the footer, the book) read instead: the view as the plugin last wrote it, copied by one
// observer in pages.tsx, and the setting for his marks on the engine's rows. Plain module data,
// rebuilt on reload by the next write of the view.

import type { ClaudesamaView } from '../types'

// His marks in the conversation: `on`, all of them; `replies`, his alone (no cue above the
// person's prompts); `off`, none. The default is `replies` (owner, 2026-10-02 19:33: the app's
// bubble already shows who spoke, so the cue above the person's prompts only costs a line).
export type Marks = 'on' | 'replies' | 'off'
export const MARKS_DEFAULT: Marks = 'replies'

export const latest: {
  view: ClaudesamaView | undefined
  marks: Marks | undefined // undefined until the stored setting is read, once per load
  marksRead: Promise<Marks> | undefined // that one read, shared by every drawing waiting on it
} = { view: undefined, marks: undefined, marksRead: undefined }

export function marksFrom(stored: unknown): Marks {
  return stored === 'off' || stored === 'replies' || stored === 'on' ? stored : MARKS_DEFAULT
}
