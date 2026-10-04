// Buttons for the desktop companion, on both book surfaces. No work at rest: re-checks belong
// to one press, stop on its goal, and are cancelled as soon as Settings is left or closed.
import type { Elements, RenderElement } from 'claude-code'
import type { BookWords } from './book-words'
import { fill } from './book-words'
import { cells } from './band'
import { COMPANION_SIZES } from './companion-art'
import type { CompanionSize, CompanionStage } from './companion-art'

type Timer = { cancel: () => void }
export type CompanionState = 'building' | 'removing' | 'tools' | 'oldTools' | 'failed' | 'absent' | 'stopped' | 'hidden' | 'waiting' | 'corner' | 'following'
export type CompanionInfo = {
  running?: boolean; accessibility?: boolean; login?: boolean; hiddenUntil?: number; answered?: number;
  version?: string; size?: CompanionSize; sizeAt?: number; loginAt?: number; followAt?: number
}
export type CompanionSnapshot = {
  folder: boolean; app: boolean; login: boolean; info: CompanionInfo; version?: string
}
export type CompanionBookData = CompanionSnapshot & {
  state: CompanionState; asks: boolean; cannot: boolean; notRun: boolean; confirmed: boolean
  afterTools: boolean; removed: boolean; message: string
  stage?: { source: string; altState: CompanionStage }
  figures?: Partial<Record<CompanionSize, { source: string; width: number; height: number }>>
}
export type CompanionAction = 'install' | 'retry' | 'updateButton' | 'toolsButton' | 'oldToolsButton' | 'summon' | 'follow' | 'openSettings' | 'on' | 'off' | 'remove' | 'keep' | 'trash' | CompanionSize
export const COMPANION_APP = 'Applications/Claude-sama Companion.app/Contents/MacOS/claudesama-companion'
export const COMPANION_PLIST = 'Library/LaunchAgents/io.github.ninondev.claudesama-companion.plist'
export const COMPANION_OPEN = ['open', '-g', '-b', 'io.github.ninondev.claudesama-companion'] as const

export function companionState(s: CompanionSnapshot, now: number, p: { busy?: string; issue?: 'tools' | 'oldTools' | 'failed'; unanswered?: boolean; followed?: number }): CompanionState {
  if (p.busy === 'install') return 'building'
  if (p.busy === 'trash') return 'removing'
  if (p.issue) return p.issue
  if (!s.folder || !s.app) return 'absent'
  if (s.info.running !== true || p.unanswered) return 'stopped'
  if (typeof s.info.hiddenUntil === 'number' && s.info.hiddenUntil > now) return 'hidden'
  if (s.info.accessibility === false) return p.followed !== undefined && now - p.followed < 600_000 ? 'waiting' : 'corner'
  return 'following'
}

/** POSIX quoting: every argument, including paths containing apostrophes, stays literal. */
export function companionCommand(argv: readonly string[]): string {
  return argv.map(arg => `'${arg.replace(/'/g, `'"'"'`)}'`).join(' ')
}
export type CompanionRun = { kind: 'ran'; stdout: string; stderr: string; exitCode: number } | { kind: 'denied' | 'cannot' }
export class CompanionBook {
  mac?: Promise<boolean>
  macReady?: boolean
  snapshot?: CompanionSnapshot
  warming?: Promise<void>
  warmGeneration = -1
  pluginVersion?: Promise<string | undefined>
  busy = new Set<string>()
  progress?: 'install' | 'trash'
  issue?: 'tools' | 'oldTools' | 'failed'
  afterTools = false
  removed = false
  confirmed = false
  followed?: number
  unanswered = false
  summonAt = 0
  processFailed = false
  cannot = false
  notRun = false
  message = ''
  timer?: Timer
  answerTimer?: Timer
  generation = 0
  stage?: { state: CompanionStage; source: string }
  figures?: CompanionBookData['figures']
  lastAt = 0

  stop(): void {
    this.generation += 1
    this.warming = undefined; this.warmGeneration = -1
    this.timer?.cancel(); this.timer = undefined
    this.answerTimer?.cancel(); this.answerTimer = undefined
    this.busy.delete('summon')
  }
  forget(): void { this.stop(); this.snapshot = undefined; this.stage = undefined; this.figures = undefined }
}

// One shared block drawing keeps the two surfaces in the same order. Pictures are desktop
// only. Native buttons carry stable keys and no hotkeys: the engine owns keyboard navigation.
export function companionSection(ui: Elements['desktop'] | Elements['terminal'], desktop: boolean, w: BookWords['settings']['companion'], now: string, d: CompanionBookData, press: (action: CompanionAction) => void | Promise<void>, slant: boolean, columns: number, hiddenTime: string): RenderElement {
  const { Box, Text, Button, Svg } = ui
  const note = (text: string) => <Text italic={slant && cells(text) <= columns} wrap="wrap">{text}</Text>
  const button = (action: CompanionAction, label: string, primary = false) => <Button key={`claudesama:companion:${action}`} label={label} {...(primary ? { variant: 'primary' as const } : {})} onPress={() => press(action)} />
  const buttons = (...children: RenderElement[]) => <Box flexDirection="row" flexWrap="wrap" gap={1}>{children}</Box>
  const programNotes = () => <>{d.cannot ? <>{note(w.cannot)}{note(w.fallback)}</> : d.asks ? note(w.asks) : null}</>
  const s = d.state
  const stateLabel = s === 'hidden' ? fill(w.hidden, { time: hiddenTime }) : w[s]
  const lineKey = `${s}Line` as keyof typeof w
  const line = s === 'failed' ? d.message : typeof w[lineKey] === 'string' ? w[lineKey] as string : ''
  const program = ['absent', 'tools', 'oldTools', 'failed', 'stopped'].includes(s)
  const actionRow = s === 'absent' ? buttons(button('install', w.install, true))
    : s === 'tools' ? buttons(button(d.afterTools ? 'install' : 'toolsButton', d.afterTools ? w.install : w.toolsButton, true))
    : s === 'oldTools' ? buttons(button(d.afterTools ? 'install' : 'oldToolsButton', d.afterTools ? w.install : w.oldToolsButton, true))
    : s === 'failed' ? buttons(button('retry', w.retry, true))
    : s === 'waiting' ? buttons(button('openSettings', w.openSettings, true))
    : s === 'corner' ? buttons(button('follow', w.follow, true))
    : ['stopped', 'hidden', 'following'].includes(s) ? buttons(button('summon', w.summon, s !== 'following')) : null
  const installed = ['stopped', 'hidden', 'waiting', 'corner', 'following'].includes(s)
  const running = installed && s !== 'stopped'
  const names = w.sizes.split(' · ')
  const size = d.info.size ?? 'medium'
  return <Box flexDirection="column" marginTop={1} gap={1}>
    <Text bold wrap="wrap">{w.label}</Text>
    <Box flexDirection={desktop ? 'row' : 'column'} flexWrap="wrap" gap={desktop ? 2 : 0} alignItems={desktop ? 'center' : 'stretch'}>
      {desktop && d.stage ? <Svg source={d.stage.source} alt={w.stageAlt[d.stage.altState]} width={188} height={96} /> : null}
      <Box flexDirection="column" flexShrink={1} minWidth={0} {...(desktop ? { width: 26, flexGrow: 1 } : {})}>
        <Text bold wrap="wrap">{stateLabel}</Text>
        {line ? note(line) : null}{actionRow}
        {program ? programNotes() : null}
      </Box>
    </Box>
    {d.notRun ? note(w.notRun) : null}
    {s === 'tools' && d.afterTools ? note(w.toolsAfter) : null}
    {s === 'oldTools' && d.afterTools ? note(w.oldToolsAfter) : null}
    {s === 'absent' && d.removed ? note(w.removed) : null}
    {s === 'corner' ? note(w.followHelp) : s === 'waiting' ? note(w.waitingHelp) : null}
    {installed && d.version && typeof d.info.version === 'string' && d.info.version !== d.version ? <Box flexDirection="column" marginTop={1} gap={1}>
      <Text wrap="wrap">{w.update}</Text>{buttons(button('updateButton', w.updateButton))}{programNotes()}
    </Box> : null}
    {running ? <>
      <Box flexDirection="column" marginTop={1} gap={1}>
        <Text wrap="wrap"><Text bold>{w.size}</Text>{`  ${fill(now, { value: names[COMPANION_SIZES.indexOf(size)] ?? size })}`}</Text>
        <Box flexDirection="row" flexWrap="wrap" gap={1} alignItems="flex-end">
          {COMPANION_SIZES.map((value, i) => <Box flexDirection="column" alignItems="center" gap={1}>
            {desktop && d.figures?.[value] ? <Svg {...d.figures[value]!} alt={fill(w.sizeAlt[value === 'tiny' || value === 'small' ? 'pixel' : 'painted'], { size: names[i] ?? value })} /> : null}
            {button(value, names[i] ?? value, size === value)}
          </Box>)}
        </Box>
      </Box>
      <Box flexDirection="column" marginTop={1} gap={1}>
        <Text wrap="wrap"><Text bold>{w.login}</Text>{`  ${fill(now, { value: d.login ? w.on : w.off })}`}</Text>
        {buttons(button('on', w.on, d.login), button('off', w.off, !d.login))}
      </Box>
    </> : null}
    {installed ? <Box flexDirection="column" marginTop={1} gap={1}>
      {d.confirmed ? <><Text wrap="wrap">{w.confirm}</Text>{buttons(button('keep', w.keep, true), button('trash', w.trash))}{programNotes()}</> : buttons(button('remove', w.remove))}
    </Box> : null}
  </Box>
}
