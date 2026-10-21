// The desktop pet's own program on Windows and Linux (lane C, 10-16; DECISIONS 941): one build per system and
// processor ships in the plugin (companion-rs/bin), and the plugin asks it to write the pet's shared files and to
// install, start or take away the pet (companion-rs/src/setup.rs). macOS keeps its Swift pet and companion-control.
import type { EngineInterface } from 'claude-code'
import { isWindows, joinPath, windowsPath } from './paths'

type Host = Pick<EngineInterface, 'env' | 'fs' | 'process' | 'plugin'>
const choices = new WeakMap<object, { root: string; value: Promise<string | undefined> }>()

export function petProgramName(platform: string, architecture = ''): string | undefined {
  const arch = /^(?:arm64|aarch64)$/i.test(architecture) ? 'aarch64'
    : /^(?:amd64|x86_64)$/i.test(architecture) ? 'x86_64' : undefined
  if (!arch) return
  if (platform === 'linux') return 'companion-rs/bin/coco-companion-linux-' + arch
  if (platform === 'windows') return 'companion-rs/bin/coco-companion-windows-' + arch + '.exe'
}

async function choose($: Host): Promise<string | undefined> {
  const [os, home, profile] = await Promise.all([$.env.get('OS'), $.env.get('HOME'), $.env.get('USERPROFILE')])
  if (isWindows(os, home, profile) || windowsPath($.plugin.root)) {
    const arch = await $.env.get('PROCESSOR_ARCHITEW6432') || await $.env.get('PROCESSOR_ARCHITECTURE')
    return petProgramName('windows', arch)
  }
  if (await $.fs.exists('/System/Library/CoreServices/SystemVersion.plist')) return
  // No build in the package, no question to the system.
  const available = await Promise.all(['x86_64', 'aarch64'].map(arch => $.fs.exists(joinPath($.plugin.root, petProgramName('linux', arch)!))))
  if (!available.some(Boolean)) return
  const result = await $.process.run(['/usr/bin/uname', '-sm'], { timeoutMs: 1000 })
  if (result.exitCode !== 0 || result.isStdoutTruncated) return
  const [platform, arch] = result.stdout.trim().split(/\s+/)
  return petProgramName(platform?.toLowerCase() ?? '', arch)
}

/** The pet program's path for this computer, or nothing on macOS, an unknown processor or a package without it. */
export async function petProgram($: Host): Promise<string | undefined> {
  const root = $.plugin.root
  let choice = choices.get($)
  if (!choice || choice.root !== root) {
    const value = choose($).catch(() => undefined)
    choice = { root, value }; choices.set($, choice)
    void value.then(name => { if (!name && choices.get($)?.value === value) choices.delete($) })
  }
  const name = await choice.value
  if (!name) return
  const path = joinPath(root, name)
  return await $.fs.exists(path).catch(() => false) ? path : undefined
}

/** Whether the package carries the pet for this computer, asking the system nothing: the Windows build for its
 *  processor (named in the environment), or any Linux build. Which Linux build fits costs a uname, so petProgram is
 *  asked only once the pet's folder is there or `/coco companion` runs. macOS has its own pet. */
export async function petProgramShipped($: Host): Promise<boolean> {
  const [os, home, profile] = await Promise.all([$.env.get('OS'), $.env.get('HOME'), $.env.get('USERPROFILE')])
  if (isWindows(os, home, profile) || windowsPath($.plugin.root)) return await petProgram($) !== undefined
  if (await $.fs.exists('/System/Library/CoreServices/SystemVersion.plist')) return false
  const builds = await Promise.all(['x86_64', 'aarch64'].map(arch => $.fs.exists(joinPath($.plugin.root, petProgramName('linux', arch)!))))
  return builds.some(Boolean)
}

/** Where `install` puts the pet (companion-rs/src/setup.rs app_folder): `$XDG_DATA_HOME/coco-pet`, else
 *  `~/.local/share/coco-pet`, on Linux; `%LOCALAPPDATA%\Programs\Coco Pet` on Windows. */
export async function petAppFolder($: Pick<Host, 'env'>, home: string, windows: boolean): Promise<string> {
  if (windows) {
    const local = await $.env.get('LOCALAPPDATA')
    return joinPath(local && windowsPath(local) ? local : joinPath(home, 'AppData', 'Local'), 'Programs', 'Coco Pet')
  }
  const data = await $.env.get('XDG_DATA_HOME')
  return joinPath(data?.startsWith('/') ? data : joinPath(home, '.local', 'share'), 'coco-pet')
}

/** The pet's own folder, which `install` creates and `uninstall` moves to the trash: its settings (companion.json), the
 *  mod's feed and its requests (companion-rs/src/paths.rs companion_folder). `%APPDATA%\Coco` on Windows;
 *  `$XDG_CONFIG_HOME/coco-pet`, else `~/.config/coco-pet`, on Linux, since `~/.config/coco` holds the line library and
 *  the talk key (his card of 10-18). macOS keeps `~/Library/Application Support/Coco` (COMPANION_DIR). */
export async function petDataFolder($: Pick<Host, 'env'>, home: string, windows: boolean): Promise<string> {
  if (windows) {
    const roaming = await $.env.get('APPDATA')
    return joinPath(roaming && windowsPath(roaming) ? roaming : joinPath(home, 'AppData', 'Roaming'), 'Coco')
  }
  const config = await $.env.get('XDG_CONFIG_HOME')
  return joinPath(config?.startsWith('/') ? config : joinPath(home, '.config'), 'coco-pet')
}

/** The argument vector that writes `name` in the pet's folder from stdin: staged, renamed, never creating the folder. */
export function petWriteArgv(program: string, folder: string, name: string): string[] {
  return [program, 'write-shared', folder, name]
}
