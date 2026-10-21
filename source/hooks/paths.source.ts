// Engine and OS paths may use either separator. Keep the root's path style when joining;
// comparisons fold case only for Windows paths, where the drive and names ignore case.
export function windowsPath(path: string): boolean {
  return /^[a-z]:[\\/]|^[\\/]{2}/i.test(path)
}

export function joinPath(root: string, ...parts: string[]): string {
  const windows = windowsPath(root), separator = windows ? '\\' : '/'
  const base = windows ? root.replace(/[\\/]+$/, '').replace(/[\\/]/g, separator) : root.replace(/\/+$/, '')
  const tail = parts.map(part => windows ? part.replace(/^[\\/]+|[\\/]+$/g, '').replace(/[\\/]/g, separator) : part.replace(/^\/+|\/+$/g, '')).filter(Boolean).join(separator)
  return tail ? `${base}${root ? separator : ''}${tail}` : windows ? root.replace(/[\\/]/g, separator) : root
}

export function samePath(a: string, b: string): boolean {
  const windows = windowsPath(a) || windowsPath(b)
  const key = (path: string) => (windows ? path.replace(/\\/g, '/') : path).replace(/\/+$/, '') || '/'
  return windows ? key(a).toLowerCase() === key(b).toLowerCase() : key(a) === key(b)
}

export function homePath(home: string | undefined, profile: string | undefined): string | undefined {
  return home || profile
}

/** `path` written from `home`: `~` for the home folder itself, `~/…` (or `~\…`) inside it, anything else as it is;
 *  Windows folders compare without case. */
export function tildePath(path: string, home: string | undefined): string {
  const base = home?.replace(/[\\/]+$/, '')
  if (!base) return path
  const windows = windowsPath(base)
  const head = path.slice(0, base.length), after = path.slice(base.length, base.length + 1)
  if (windows ? head.toLowerCase() !== base.toLowerCase() : head !== base) return path
  return after === '' || after === '/' || (windows && after === '\\') ? '~' + path.slice(base.length) : path
}

export function isWindows(os: string | undefined, home: string | undefined, profile: string | undefined): boolean {
  return os === 'Windows_NT' || (!home && windowsPath(profile ?? ''))
}

/** Machine-local presence never uses a macOS folder on Linux. */
export function presenceFolder(home: string, macOS: boolean, stateHome?: string): string {
  return macOS ? joinPath(home, 'Library', 'Application Support', 'Coco-presence')
    : joinPath(stateHome?.startsWith('/') ? stateHome : joinPath(home, '.local', 'state'), 'coco')
}

export type BranchIO = {
  root: string
  exists(path: string): Promise<boolean>
  run(argv: string[]): Promise<{ exitCode: number | null; stdout: string }>
  systemRoot?: () => Promise<string | undefined>
}

// The host file API cannot hold a no-follow descriptor. Metadata reads use the
// bundled helper, which limits bytes and validates registered worktree backlinks.
export async function readRepositoryBranch(io: BranchIO, cwd: string): Promise<string | undefined> {
  try {
    let argv: string[]
    if (windowsPath(cwd)) {
      const root = await io.systemRoot?.()
      if (!root || !/^[A-Za-z]:[\\/]Windows[\\/]?$/.test(root)) return undefined
      const shell = joinPath(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      if (!await io.exists(shell)) return undefined
      argv = [shell, '-NoProfile', '-NonInteractive', '-File', joinPath(io.root, 'bin', 'repository-branch.ps1'), '-Cwd', cwd]
    } else {
      const linux = await io.exists('/proc/sys/kernel/ostype')
      const helper = joinPath(io.root, 'bin', linux ? 'presence.sh' : 'companion-control')
      if (!await io.exists(helper)) return undefined
      argv = linux ? ['/bin/sh', helper, 'branch', cwd] : [helper, 'branch', cwd]
    }
    const result = await io.run(argv)
    if (result.exitCode !== 0 || result.stdout.length > 513) return undefined
    const branch = result.stdout.replace(/\r?\n$/, '')
    if (!branch || /[\x00-\x20\x7f]/.test(branch) || branch.includes('..')) return undefined
    return branch
  } catch { return undefined }
}
