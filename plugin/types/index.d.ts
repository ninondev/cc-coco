// Claude-sama's state contract: the one value the band draws from, held by the host for the
// session ($.state). Self-contained on purpose (the engine reads it as written).

export type ClaudesamaFrame =
  | 'idle-reading' | 'idle-blink' | 'think-a' | 'think-b' | 'work-a' | 'work-b' | 'happy' | 'waiting'
  | 'error' | 'wild-a' | 'wild-b' | 'sleep' | 'refuse' | 'flustered' | 'wave' | 'snake'

export type ClaudesamaMood =
  | 'idle' | 'think' | 'work' | 'happy' | 'waiting' | 'question' | 'error' | 'wild'
  | 'refuse' | 'flustered' | 'sleep' | 'wave' | 'snake' | 'omen'

export type ClaudesamaSlip = { rank: string; label: string; text: string }

// Kept for the session's Activity row, separate from the animated band state.
export type CompanionActivity = {
  project: string
  done: number | null
  waitAt: number | null
  reply: { text: string; at: number } | null
  notice: { kind: string; text: string; at: number } | null
  ack: string | null
  channel: boolean
}

export type ClaudesamaView = {
  mood: ClaudesamaMood
  frame: ClaudesamaFrame
  said: string | null
  slip: ClaudesamaSlip | null
  context: number | null
  estimate: boolean // the context figure is the engine's local estimate (after a compaction, at a fresh start)
  verb: string
  band: 'on' | 'compact' | 'off'
  bandBeforeOff?: 'on' | 'compact'
  workSize?: 'same' | 'smaller' // absent in an older session: keep the resting size
  voice: 'off' | 'light' | 'full'
  affection: 'warm' | 'clingy'
  lang: 'en' | 'fr' | 'de' | 'hi' | 'id' | 'it' | 'ja' | 'ko' | 'pt-BR' | 'es-419' | 'es-ES' | 'zh'
  pictures: 'cells' | 'kitty'
  colors: 'truecolor' | '256'
  cue: string
}

// His book (the pane): the page open, the library's reading, and a counter that redraws it.
export type ClaudesamaBook = {
  page: 'him' | 'omen' | 'offerings' | 'log' | 'library' | 'settings'
  reading: number
  rev: number
}

declare module 'claude-code' {
  interface PluginState {
    claudesama: { view: ClaudesamaView; book: ClaudesamaBook }
  }
}
