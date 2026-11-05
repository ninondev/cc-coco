// /coco doctor and /coco uninstall (package D; lead review fixes 10-28). The dispatcher in
// register.tsx and pages.tsx calls these on demand; the words come from the gaps tables, so
// nothing here loads before it is asked for.
//
// The plugin's uninstall touches Coco's own runtime things: the pet (its own uninstaller),
// the app icon and the saved chat key, and takes the privacy switch's keys back out of
// settings.json (owner 11-04). The installer's record and .coco-bak backups belong to the
// installer's own Uninstall (the Mac app button, install.sh); they stay untouched here so
// that path keeps working (review D-1).
import type { EngineInterface } from 'claude-code'
import { baseHost } from './api-lines'
import { gapFill } from './mod-gaps-words'
import { joinPath } from './paths'
import { restorePrivacy } from './privacy'
import { olderVersion, readCheckCompanion, COMPANION_MIN_VERSION } from './checkup'
import { COMPANION_DIR } from './companion'
import { keyArch, keyPlatform, runTalkKey } from './talk-key'

export type DoctorEngine = Pick<EngineInterface, 'env' | 'fs' | 'settings' | 'session' | 'clock'>
export type CommandEngine = Pick<EngineInterface, 'env' | 'fs' | 'process' | 'session' | 'store'>

// The minimum Claude Code this Coco needs (package B's floor; the VS Code privacy switch wants 2.1.304).
export const MIN_ENGINE_VERSION = '2.1.299'

/** The key's shape, in memory, as a verdict only. The value itself never leaves this function. */
export function keyShapeVerdict(value: unknown): 'missing' | 'ok' | 'shape' | 'length' {
  if (typeof value !== 'string' || value === '') return 'missing'
  if (/\s/.test(value) || /["']/.test(value)) return 'shape'
  if (value.length < 8 || value.length > 512) return 'length'
  return 'ok'
}

export async function doctorLines($: DoctorEngine, input: { pluginVersion: string; engineVersion: string; lang: string; companionInstalled: boolean }): Promise<string[]> {
  const lang = input.lang
  const lines: string[] = []
  lines.push(gapFill(lang, 'doctor.versions', { engine: input.engineVersion, plugin: input.pluginVersion }))
  if (olderVersion(input.engineVersion, MIN_ENGINE_VERSION)) lines.push(gapFill(lang, 'doctor.engineOld', { version: input.engineVersion }))
  const home = await $.env.get('HOME').catch(() => undefined)
  if (home) {
    const found = await readCheckCompanion($, joinPath(home, COMPANION_DIR), input.companionInstalled)
    const version = found.companion.version ?? found.health.version
    if (!found.installed || version === undefined) lines.push(gapFill(lang, 'doctor.pet.off', {}))
    else {
      lines.push(gapFill(lang, found.companion.running === true ? 'doctor.pet.on' : 'doctor.pet.stopped', { version }))
      // The pet's own update path (review D-6): the book's install button runs the same command.
      if (olderVersion(version, COMPANION_MIN_VERSION)) lines.push(gapFill(lang, 'doctor.pet.old', { version, plugin: COMPANION_MIN_VERSION }))
    }
  }
  const settings = await $.settings.read().catch(() => undefined)
  const env = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as { env?: Record<string, unknown> }).env : undefined
  const base = await $.env.get('ANTHROPIC_BASE_URL').catch(() => undefined)
  const host = baseHost(typeof base === 'string' ? base : undefined)
  lines.push(gapFill(lang, 'doctor.provider', { host: host ?? 'api.anthropic.com' }))
  const privacy = env?.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC ?? await $.env.get('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC').catch(() => undefined)
  lines.push(gapFill(lang, privacy === '1' ? 'doctor.privacy.on' : 'doctor.privacy.off', {}))
  // The token's home is settings.json env; an {"$env": ...} reference there resolves into the
  // process environment, so a plain string here or the process value there covers both shapes.
  // The verdict names a word key; no part of the value is ever returned. On Anthropic's own
  // endpoint without a token there is nothing to check (a login, not a key), so no key line.
  const stored = env?.ANTHROPIC_AUTH_TOKEN
  const token = typeof stored === 'string' && stored !== '' ? stored : await $.env.get('ANTHROPIC_AUTH_TOKEN').catch(() => undefined)
  const verdict = keyShapeVerdict(token)
  if (verdict === 'missing') {
    if (host === undefined || host === 'api.anthropic.com') return lines.filter(line => line !== '')
    lines.push(gapFill(lang, 'doctor.key.missing', {}))
  } else if (verdict === 'ok' && host === 'api.deepseek.com' && !token!.startsWith('sk-')) {
    lines.push(gapFill(lang, 'doctor.key.prefix', {}))
  } else {
    lines.push(gapFill(lang, `doctor.key.${verdict}`, {}))
  }
  return lines.filter(line => line !== '')
}

// ---------------------------------------------------------------- uninstall

export type UninstallPort = {
  root: string
  pet: { program: string } | undefined
  petInstalled: boolean
  iconPlatform: 'macos' | 'linux' | undefined
  run: (argv: readonly string[]) => Promise<{ stdout: string; stderr: string; exitCode: number } | undefined>
}

// The last word the pet's uninstaller prints: companion-macos.sh --report says ok | no-tools |
// old-tools | failed | not-mac; the Rust pet (companion-rs setup.rs) says removed | kept.
function lastReportWord(run: { stdout: string; stderr: string } | undefined): string | undefined {
  if (!run) return undefined
  const lines = (run.stdout || run.stderr).trim().split(/\r?\n/)
  return lines[lines.length - 1]?.trim() || undefined
}

// icon-*.sh --report prints "icon: own|legacy|stock|custom|unknown"; a cleared icon answers stock.
function iconReportState(run: { stdout: string; stderr: string } | undefined): string | undefined {
  if (!run) return undefined
  const lines = (run.stdout || run.stderr).trim().split(/\r?\n/)
  const last = lines[lines.length - 1]?.trim() ?? ''
  return /^icon: (\w+)$/.exec(last)?.[1]
}

export async function uninstallSteps($: CommandEngine, port: UninstallPort, lang: string): Promise<string[]> {
  const said: string[] = []
  // 1. The pet: its own uninstaller also takes the autostart, the Start Menu shortcut and the
  //    old self-signed certificate with it. Skipped where no pet is installed (review D-8).
  if (port.petInstalled) {
    const report = lastReportWord(await port.run(port.pet ? [port.pet.program, 'uninstall'] : ['/bin/sh', joinPath(port.root, 'bin/companion-macos.sh'), 'uninstall', '--report']))
    said.push(gapFill(lang, report === 'ok' || report === 'removed' ? 'uninstall.pet.ok' : 'uninstall.pet.failed', {}))
  }
  // 2. The app icon change.
  if (port.iconPlatform) {
    const state = iconReportState(await port.run(['/bin/sh', joinPath(port.root, `bin/icon-${port.iconPlatform}.sh`), 'clear', '--report', ...(port.iconPlatform === 'linux' ? ['--replace-custom'] : [])]))
    said.push(gapFill(lang, state === 'stock' || state === 'legacy' ? 'uninstall.icon.ok' : 'uninstall.icon.failed', {}))
  }
  // 3. The saved chat key. A record that never existed answers the same word as a removed one.
  const platform = await keyPlatform($)
  const arch = keyArch(await $.env.get('PROCESSOR_ARCHITEW6432').catch(() => undefined) ?? await $.env.get('PROCESSOR_ARCHITECTURE').catch(() => undefined))
  const reply = await runTalkKey($, { root: port.root, platform, arch, desktop: false }, ['remove'], { timeoutMs: 30_000 })
  said.push(gapFill(lang, reply.kind === 'removed' ? 'uninstall.keys.done' : 'uninstall.keys.none', {}))
  // 4. The privacy switch: back to Claude Code's own defaults, and silent when it was never used.
  const privacy = await restorePrivacy($)
  if (privacy !== 'same') said.push(gapFill(lang, privacy === 'done' ? 'uninstall.privacy.ok' : 'uninstall.privacy.failed', {}))
  // 5. What stays, and who removes it: the plugin by hand, the installer's files by its own Uninstall.
  said.push(gapFill(lang, 'uninstall.installer', {}))
  said.push(gapFill(lang, 'uninstall.plugin', {}))
  return said
}
