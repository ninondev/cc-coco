// The app icon, in his book. Scripts run only from a person opening Settings or pressing a
// button; drawing, store writes and timers never run them. No watcher, receipt or model call.
import type { Elements, RenderElement } from 'claude-code'
import type { BookWords } from './book-words'
import { cells } from './band'

export type IconState = 'own' | 'stock' | 'custom' | 'unknown'
export type IconAction = 'apply' | 'clear'
export type IconBookData = { state: IconState; busy?: 'status' | IconAction; unavailable: boolean; failed: boolean; changed?: boolean }
export class IconBook {
  platform?: Promise<'macos' | 'linux' | undefined>
  state: IconState = 'unknown'
  busy?: 'status' | IconAction
  unavailable = false
  failed = false
  changed = false
  generation = 0
  pendingStatus?: () => void
  forget(): void { this.generation += 1; this.state = 'unknown'; this.failed = false; this.changed = false; this.pendingStatus = undefined }
  data(): IconBookData { return { state: this.state, busy: this.busy, unavailable: this.unavailable, failed: this.failed, ...(this.changed ? { changed: true } : {}) } }
}

export function iconReport(stdout: string): IconState {
  const lines = stdout.trim().split(/\r?\n/)
  // Machine mode emits one line. Refuse an ambiguous or accidentally human-mode answer.
  if (lines.length !== 1) return 'unknown'
  return /^icon: (own|stock|custom|unknown)$/.exec(lines[0] ?? '')?.[1] as IconState ?? 'unknown'
}

export function iconSection(ui: Elements['desktop'] | Elements['terminal'], w: BookWords['settings']['icon'], d: IconBookData, press: (action: IconAction) => void | Promise<void>, slant: boolean, columns: number): RenderElement {
  const { Box, Text, Button } = ui
  const note = (text: string) => <Text italic={slant && cells(text) <= columns} wrap="wrap">{text}</Text>
  const button = (action: IconAction, label: string, primary: boolean) => <Button key={`claudesama:icon:${action}`} label={label} {...(primary ? { variant: 'primary' as const } : {})} onPress={() => press(action)} />
  const status = d.failed && d.unavailable ? w.failed : d.busy === 'apply' ? w.applying : d.busy === 'clear' ? w.clearing : d.busy === 'status' ? w.reading : w[d.state]
  return <Box flexDirection="column" marginTop={1} gap={1}>
    <Text bold wrap="wrap">{w.label}</Text>
    <Text bold wrap="wrap">{status}</Text>
    {/* Warnings precede the buttons in both reading and keyboard order. */}
    {!d.busy && !d.unavailable && (d.state === 'custom' || d.state === 'unknown') ? note(d.state === 'custom' ? w.replace : w.unknownHelp) : null}
    {d.failed && !d.unavailable ? note(w.failed) : null}
    {!d.busy && !d.unavailable ? <Box flexDirection="row" flexWrap="wrap" gap={1}>
      {button('apply', w.apply, d.state !== 'own')}{button('clear', w.clear, d.state === 'own')}
    </Box> : null}
    {d.unavailable || d.failed ? note(w.fallback) : null}
    {d.changed && !d.busy && !d.failed ? note(w.help) : null}
  </Box>
}
