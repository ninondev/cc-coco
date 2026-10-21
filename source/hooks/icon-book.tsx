// Icon state is measured; consent and failed-press blocking live in the machine record.
import type { Elements, RenderElement } from 'claude-code'
import type { BookWords } from './book-words'
import { cells } from './band.js'

export type IconState = 'own' | 'stock' | 'custom' | 'legacy' | 'unknown'
// The four pictures Claude's icon can take (DECISIONS 932, 935 to 937, 939, 942); icon-<os>.sh --choice knows the same names.
export const ICON_CHOICES = ['coco', 'dake', 'keycap', 'ornament'] as const
export type IconChoice = typeof ICON_CHOICES[number]
export function iconChoice(value: unknown): IconChoice { return (ICON_CHOICES as readonly unknown[]).includes(value) ? value as IconChoice : 'coco' }
export type IconAction = 'apply' | 'clear' | 'choose' | 'cancel' | 'confirm' | 'dock-on' | 'dock-off' | 'legacy-choose' | 'legacy-clear' | `pick-${IconChoice}`
export function isIconPick(action: string): action is `pick-${IconChoice}` { return action.startsWith('pick-') && iconChoice(action.slice(5)) === action.slice(5) }
export type IconBookData = { state: IconState; busy?: 'status' | 'apply' | 'clear'; unavailable: boolean; failed: boolean; changed?: boolean; consent?: boolean; blocked?: boolean; confirming?: boolean; legacy?: boolean; mac?: boolean; dockTile?: boolean; choice?: IconChoice }
export class IconBook {
  platform?: Promise<'macos' | 'linux' | undefined>
  state: IconState = 'unknown'
  restoreKey?: string
  busy?: 'status' | 'apply' | 'clear'
  unavailable = false
  failed = false
  changed = false
  confirming = false
  legacy = false
  mac = false
  visible = true
  opened = -1
  generation = 0
  pendingStatus?: () => void
  pendingClear?: () => void
  pendingApply?: () => void
  forget(): void { this.generation += 1; this.state = 'unknown'; this.restoreKey = undefined; this.failed = false; this.changed = false; this.confirming = false; this.opened = -1; this.pendingStatus = undefined }
  data(record: Record<string, unknown> = {}): IconBookData { return { state: this.state, busy: this.busy, unavailable: this.unavailable, failed: this.failed, ...(this.changed ? { changed: true } : {}), consent: record.appIcon === 'on', blocked: record.appIconBlocked === true, confirming: this.confirming, legacy: this.legacy, mac: this.mac, dockTile: record.dockTile === 'on', choice: iconChoice(record.appIconChoice) } }
}

// No timer, no IO: callers notify this latch only after returning a drawn tree and hydration.
export class IconSession {
  drawn = false
  checked = false
  queued = false
  generation = 0
  reset(): void { this.generation++; this.drawn = false; this.checked = false; this.queued = false }
  explicitApply(): void { this.generation++; this.checked = true; this.queued = false }
  claim(record: Record<string, unknown>): boolean {
    if (!this.drawn || this.checked || record.appIcon !== 'on') return false
    this.checked = true
    return true
  }
}

export function iconReport(stdout: string): IconState {
  const lines = stdout.trim().split(/\r?\n/)
  if (lines.length === 2 && (lines[0] !== 'icon: stock' || !validIconRestoreKey(lines[1]?.slice('restore-key: '.length)) || !lines[1]?.startsWith('restore-key: '))) return 'unknown'
  if (lines.length !== 1 && lines.length !== 2) return 'unknown'
  return /^icon: (own|stock|custom|legacy|unknown)$/.exec(lines[0] ?? '')?.[1] as IconState ?? 'unknown'
}
export function validIconRestoreKey(value: unknown): value is string { return typeof value === 'string' && /^(macos|linux):[0-9]{1,10}:[0-9]{1,20}$/.test(value) }
export function iconRestoreKey(stdout: string): string | undefined { return iconReport(stdout) === 'stock' ? stdout.trim().split(/\r?\n/)[1]?.slice('restore-key: '.length) : undefined }

export function iconSection(ui: Elements['desktop'] | Elements['terminal'], w: BookWords['settings']['icon'], d: IconBookData, press: (action: IconAction) => void | Promise<void>, slant: boolean, columns: number): RenderElement {
  const { Box, Text, Button } = ui
  const note = (text: string) => <Text italic={slant && cells(text) <= columns} wrap="wrap">{text}</Text>
  const button = (action: IconAction, slot: string, primary = false) => <Button key={`coco:icon:${action}`} label={w[slot]} {...(primary ? { variant: 'primary' as const } : {})} onPress={() => { if (action === 'clear' && !d.consent) return; return press(action) }} />
  return <Box flexDirection="column" marginTop={1} gap={1}>
    <Text bold wrap="wrap">{w.S1}</Text>
    <Box flexDirection="row" flexWrap="wrap" gap={1}>{button('clear', 'S1a', !d.consent)}{button('choose', 'S1b', d.consent === true)}</Box>
    {note(w.S2)}
    <Text bold wrap="wrap">{w.pick}</Text>
    <Box flexDirection="row" flexWrap="wrap" gap={1}>{ICON_CHOICES.map(name => button(`pick-${name}`, `pick.${name}`, (d.choice ?? 'coco') === name))}</Box>
    {d.failed || d.unavailable ? <Box flexDirection="column" gap={1}>{note(w.failed)}{note(w.fallback)}</Box> : null}
    {d.confirming ? <Box flexDirection="column" gap={1}>
      <Text bold wrap="wrap">{w['S3.title']}</Text>{note(w['S3.body'])}
      {d.state === 'custom' ? note(w.S3c) : null}
      <Box flexDirection="row" flexWrap="wrap" gap={1}>{button('confirm', 'S3a', true)}{button('cancel', 'S3b')}</Box>
    </Box> : null}
    {d.legacy && !d.confirming ? <Box flexDirection="column" gap={1}>{note(w.S11)}<Box flexDirection="row" flexWrap="wrap" gap={1}>{button('legacy-choose', 'S11a')}{button('legacy-clear', 'S11b')}</Box></Box> : null}
    {d.consent && !d.busy && d.state === 'own' ? note(w.S4) : null}
    {d.consent && !d.busy && d.state === 'own' && d.changed && d.mac ? note(w.dockRedraw) : null}
    {d.consent && !d.busy && (d.state === 'stock' || d.blocked) ? <Box flexDirection="column" gap={1}>{d.state === 'stock' ? note(w.S5) : null}{button('apply', 'S5a', true)}</Box> : null}
    {d.mac ? <Box flexDirection="column" gap={1}><Text bold wrap="wrap">{w.S21}</Text>{button(d.dockTile ? 'dock-off' : 'dock-on', 'S21', d.dockTile === true)}{note(w.S22)}</Box> : null}
  </Box>
}
