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

export function isWindows(os: string | undefined, home: string | undefined, profile: string | undefined): boolean {
  return os === 'Windows_NT' || (!home && windowsPath(profile ?? ''))
}
