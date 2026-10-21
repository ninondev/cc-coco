import type { EngineInterface } from 'claude-code'
import { isWindows, joinPath, windowsPath } from './paths'

type Host = Pick<EngineInterface, 'env' | 'fs' | 'process' | 'plugin'>
const choices = new WeakMap<object, { root: string; value: Promise<string | undefined> }>()

export function stateProgramName(platform: string, architecture = ''): string | undefined {
  if (platform === 'darwin') return 'coco-state'
  const arch = /^(?:arm64|aarch64)$/i.test(architecture) ? 'aarch64'
    : /^(?:amd64|x86_64)$/i.test(architecture) ? 'x86_64' : undefined
  if (!arch) return
  if (platform === 'linux') return 'coco-state-linux-' + arch
  if (platform === 'windows') return 'coco-state-windows-' + arch + '.exe'
}

async function choose($: Host): Promise<string | undefined> {
  const [os, home, profile] = await Promise.all([$.env.get('OS'), $.env.get('HOME'), $.env.get('USERPROFILE')])
  if (isWindows(os, home, profile) || windowsPath($.plugin.root)) {
    const arch = await $.env.get('PROCESSOR_ARCHITEW6432') || await $.env.get('PROCESSOR_ARCHITECTURE')
    return stateProgramName('windows', arch)
  }
  if (await $.fs.exists('/System/Library/CoreServices/SystemVersion.plist')) {
    // The launcher supports both Mac ABIs; an incomplete package is unavailable.
    const slices = await Promise.all(['aarch64', 'x86_64'].map(arch => $.fs.exists(joinPath($.plugin.root, 'bin/coco-state-macos-' + arch))))
    return slices.every(Boolean) ? stateProgramName('darwin') : undefined
  }
  // A missing bundle never needs an OS-probe child. Selection runs on first use.
  const available = await Promise.all(['x86_64', 'aarch64'].map(arch => $.fs.exists(joinPath($.plugin.root, 'bin/' + stateProgramName('linux', arch)))))
  if (!available.some(Boolean)) return
  const result = await $.process.run(['/usr/bin/uname', '-sm'], { timeoutMs: 1000 })
  if (result.exitCode !== 0 || result.isStdoutTruncated) return
  const [platform, arch] = result.stdout.trim().split(/\s+/)
  return stateProgramName(platform?.toLowerCase() ?? '', arch)
}

export async function stateProgram($: Host): Promise<string | undefined> {
  const root = $.plugin.root
  let choice = choices.get($)
  if (!choice || choice.root !== root) {
    const value = choose($).catch(() => undefined)
    choice = { root, value }; choices.set($, choice)
    void value.then(name => { if (!name && choices.get($)?.value === value) choices.delete($) })
  }
  const name = await choice.value
  if (!name) return
  const path = joinPath(root, 'bin/' + name)
  try { return await $.fs.exists(path) ? path : undefined } catch { return }
}
