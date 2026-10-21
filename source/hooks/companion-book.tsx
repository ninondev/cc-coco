// Buttons for the desktop companion, on both book surfaces. No work at rest: re-checks belong
// to one press, stop on its goal, and are cancelled as soon as Settings is left or closed.
import type { Elements, RenderElement } from 'claude-code'
import type { BookWords } from './book-words'
import { fill } from './book-words'
import { cells } from './band.js'
import { MAC_SIZES } from './companion-art'
import type { CompanionSize, CompanionStage } from './companion-art'

// "Now: value" keeps its no-break spaces only when the whole line fits the width; a longer one may wrap (BOOK F2).
export function nowFit(text: string, columns: number): string {
  return columns > 0 && cells(text) <= columns ? text.replace(/ /g, '\u00a0') : text
}

type Timer = { cancel: () => void }
export type CompanionState = 'building' | 'removing' | 'tools' | 'oldTools' | 'failed' | 'absent' | 'stopped' | 'hidden' | 'waiting' | 'corner' | 'following'
export type CompanionInfo = {
  longTaskAuthorization?: 'authorized'|'denied'|'notDetermined';
  running?: boolean; accessibility?: boolean; login?: boolean; hiddenUntil?: number; answered?: number;
  targets?: readonly ('claude' | 'vscode')[]; version?: string; size?: CompanionSize; sizeAt?: number; loginAt?: number; followAt?: number
  /** Whether screenshots and recordings show him; a pet that cannot hide its windows (Linux) leaves it out. */
  capture?: boolean; captureAt?: number
}
export type CompanionSnapshot = {
  folder: boolean; app: boolean; login: boolean; info: CompanionInfo; version?: string
}
export type CompanionBookData = CompanionSnapshot & {
  state: CompanionState; asks: boolean; cannot: boolean; notRun: boolean; confirmed: boolean
  afterTools: boolean; removed: boolean; message: string
  target?: 'auto' | 'claude' | 'vscode'
  targetApp?: 'Claude' | 'VS Code'
  stage?: { source: string; altState: CompanionStage }
  figures?: Partial<Record<CompanionSize, { source: string; width: number; height: number }>>
  /** Off macOS: the pet's own program does the work (DECISIONS 941), so nothing Apple-only is offered. */
  pc?: 'windows' | 'linux'
}
export type CompanionAction = 'install' | 'retry' | 'updateButton' | 'toolsButton' | 'oldToolsButton' | 'summon' | 'follow' | 'openSettings' | 'on' | 'off' | 'captureOn' | 'captureOff' | 'remove' | 'keep' | 'trash' | CompanionSize
export const COMPANION_APP = 'Applications/Coco Pet.app/Contents/MacOS/coco-companion'
export const COMPANION_PLIST = 'Library/LaunchAgents/io.github.ninondev.coco-companion.plist'
export const COMPANION_OPEN = ['/usr/bin/open', '-g', '-b', 'io.github.ninondev.coco-companion'] as const

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

export { companionCommand } from './script-command'
export type CompanionRun = { kind: 'ran'; stdout: string; stderr: string; exitCode: number } | { kind: 'denied' | 'cannot' }
export class CompanionBook {
  mac?: Promise<boolean>
  macReady?: boolean
  targets?: CompanionInfo['targets']
  capabilityGeneration = -1
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
  stage?: { state: CompanionStage; source: string; app?: 'Claude' | 'VS Code'; outfit?: 'A' | 'B' }
  figures?: CompanionBookData['figures']
  figuresOutfit?: 'A' | 'B'
  lastAt = 0
  /** Off macOS, the pet's program in the plugin for this computer, once found. */
  pet?: { program: string; windows: boolean }

  stop(): void {
    this.generation += 1
    this.warming = undefined; this.warmGeneration = -1
    this.timer?.cancel(); this.timer = undefined
    this.answerTimer?.cancel(); this.answerTimer = undefined
    this.busy.delete('summon')
  }
  forget(): void { this.stop(); this.targets = undefined; this.capabilityGeneration = -1; this.snapshot = undefined; this.stage = undefined; this.figures = undefined }
}

// One shared block drawing keeps the two surfaces in the same order. Pictures are desktop
// only. Native buttons carry stable keys and no hotkeys: the engine owns keyboard navigation.
export function companionSection(ui: Elements['desktop'] | Elements['terminal'] | Elements['vscode'] | Elements['mobile'], desktop: boolean, mac: BookWords['settings']['companion'], now: string, d: CompanionBookData, press: (action: CompanionAction) => void | Promise<void>, slant: boolean, columns: number, hiddenTime: string, language?: BookWords['settings']['language'], remote = false): RenderElement {
  const { Box, Text, Button } = ui
  const Svg = 'Svg' in ui ? ui.Svg : undefined
  const nowLine = (value: string) => nowFit(fill(now, { value }), columns)
  const app = (d.info.targets?.includes('vscode') ? d.targetApp ?? 'Claude' : 'Claude').replace(/VS Code/g, 'VS\u00a0Code')
  const note = (text: string) => {
    const shown = text.replace(/VS Code/g, 'VS\u00a0Code')
    return <Text italic={slant && cells(shown) <= columns} wrap="wrap">{shown}</Text>
  }
  const button = (action: CompanionAction, label: string, primary = false) => <Button key={`coco:companion:${action}`} label={label} {...(primary ? { variant: 'primary' as const } : {})} onPress={() => press(action)} />
  const buttons = (...children: (RenderElement | null)[]) => <Box flexDirection="row" flexWrap="wrap" gap={1}>{children}</Box>
  // Off macOS the Mac's words give way to their own; a line not written yet is left out, a label falls back to the Mac's.
  const pc = d.pc ? mac.pc ?? {} : undefined, bin = d.pc === 'windows' && pc
  const w = { ...mac, ...(pc ? { absentLine: pc.absentLine ?? '', remove: pc.remove ?? mac.trash, cannot: pc.cannot ?? '', fallback: '' } : {}),
    ...(bin ? { trash: bin.trashWindows ?? mac.trash, confirm: bin.confirmWindows ?? mac.confirm, removing: bin.removingWindows ?? mac.removing, removed: bin.removedWindows ?? mac.removed } : {}) }
  const programNotes = () => <>{d.cannot ? [w.cannot, w.fallback].filter(Boolean).map(note) : d.asks ? [note(w.asks)] : []}</>
  const s = d.state
  const stateLabel = s === 'hidden' ? fill(w.hidden, { time: hiddenTime }) : w[s]
  const lineKey = `${s}Line` as keyof typeof w
  const line = fill(s === 'failed' ? d.message : typeof w[lineKey] === 'string' ? w[lineKey] as string : '', { app })
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
  // every pet offers the Mac's three sizes; a size from before (Tiny, Small) stands for the smallest, Medium
  const sizes = MAC_SIZES, names = w.macSizes
  const size = d.info.size === 'tiny' || d.info.size === 'small' ? 'medium' : d.info.size ?? 'medium'
  return <Box flexDirection="column" marginTop={1} gap={1}>
    <Text bold wrap="wrap">{w.label}</Text>
    <Box flexDirection={desktop ? 'row' : 'column'} flexWrap="wrap" gap={desktop ? 2 : 0} alignItems={desktop ? 'center' : 'stretch'}>
      {desktop && Svg && d.stage ? <Svg source={d.stage.source} alt={fill(w.stageAlt[d.stage.altState], { app })} width={188} height={96} /> : null}
      <Box flexDirection="column" flexShrink={1} minWidth={0} {...(desktop ? { width: 26, flexGrow: 1 } : {})}>
        <Text bold wrap="wrap">{stateLabel}</Text>
        {line ? note(line) : null}{actionRow}
        {program ? programNotes() : null}
      </Box>
    </Box>
    {language && d.info.targets?.includes('vscode') ? <Box flexDirection="column" {...(remote ? {} : { gap: 1 })}><Text wrap="wrap"><Text bold>{w.target.label}</Text>{`  ${nowLine(d.target === 'auto' || !d.target ? fill(language.autoNow, { auto: language.auto, language: app }) : app)}`}</Text><Box flexDirection="row" flexWrap="wrap" gap={1}>{(['auto', 'claude', 'vscode'] as const).map(value => <Button key={`coco:set:companionTarget:${value}`} label={value === 'auto' ? language.auto : value === 'claude' ? 'Claude' : 'VS\u00a0Code'} {...((d.target ?? 'auto') === value ? { variant: 'primary' as const } : {})} onPress={() => {}} />)}</Box>{note(w.target.help)}</Box> : null}
    {d.notRun ? note(w.notRun) : null}
    {s === 'tools' && d.afterTools ? note(w.toolsAfter) : null}
    {s === 'oldTools' && d.afterTools ? note(w.oldToolsAfter) : null}
    {s === 'absent' && d.removed ? note(w.removed) : null}
    {s === 'corner' ? note(w.followHelp) : s === 'waiting' ? note(w.waitingHelp) : null}
    {installed && d.version && typeof d.info.version === 'string' && d.info.version !== d.version ? <Box flexDirection="column" marginTop={1} gap={1}>
      <Text wrap="wrap">{w.update}</Text>{buttons(button('updateButton', w.updateButton))}{programNotes()}
    </Box> : null}
    {running ? <>
      <Box flexDirection="column" {...(remote ? {} : { marginTop: 1, gap: 1 })}>
        <Text wrap="wrap"><Text bold>{w.size}</Text>{`  ${nowLine(names[sizes.indexOf(size)] ?? size)}`}</Text>
        <Box flexDirection="row" flexWrap="wrap" gap={1} alignItems="flex-end">
          {sizes.map((value, i) => <Box flexDirection="column" alignItems="center" gap={1}>
            {desktop && Svg && d.figures?.[value] ? <Svg {...d.figures[value]!} alt={fill(w.sizeAlt.painted, { size: names[i] ?? value })} /> : null}
            {button(value, names[i] ?? value, size === value)}
          </Box>)}
        </Box>
      </Box>
      <Box flexDirection="column" {...(remote ? {} : { marginTop: 1, gap: 1 })}>
        <Text wrap="wrap"><Text bold>{w.login}</Text>{`  ${nowLine(d.login ? w.on : w.off)}`}</Text>
        {buttons(button('on', w.on, d.login), button('off', w.off, !d.login))}
      </Box>
      {typeof d.info.capture === 'boolean' ? <Box flexDirection="column" {...(remote ? {} : { marginTop: 1, gap: 1 })}>
        <Text wrap="wrap"><Text bold>{w.capture}</Text>{`  ${nowLine(d.info.capture ? w.on : w.off)}`}</Text>
        {buttons(button('captureOn', w.on, d.info.capture), button('captureOff', w.off, !d.info.capture))}
      </Box> : null}
    </> : null}
    {installed ? <Box flexDirection="column" marginTop={1} gap={1}>
      {d.confirmed ? <Box flexDirection="column" gap={1}><Text wrap="wrap">{w.confirm}</Text>{buttons(button('keep', w.keep, true), button('trash', w.trash))}{programNotes()}</Box> : buttons(button('remove', w.remove))}
    </Box> : null}
  </Box>
}
