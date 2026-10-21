/** POSIX quoting: every argument, including paths containing apostrophes, stays literal. */
export function companionCommand(argv: readonly string[]): string {
  return ['/usr/bin/env', 'PATH=/usr/bin:/bin:/usr/sbin:/sbin', ...argv].map(arg => `'${arg.replace(/'/g, `'"'"'`)}'`).join(' ')
}
