// Fixed native descriptor operations; callers pass paths as argv and content on stdin.
export const ATOMIC_WRITE = String.raw`set -eu
folder=$1
name=$2
helper=$3
linux=$4
case "$helper" in /*) ;; *) exit 64 ;; esac
case "$linux" in /*) ;; *) exit 64 ;; esac
if test -r /proc/sys/kernel/ostype; then
  exec /bin/sh "$linux" write-shared "$folder" "$name"
fi
exec "$helper" write-shared "$folder" "$name"
`

export const DIAGNOSTIC_APPEND = String.raw`set -eu
folder=$1
helper=$2
linux=$3
case "$helper" in /*) ;; *) exit 64 ;; esac
case "$linux" in /*) ;; *) exit 64 ;; esac
if test -r /proc/sys/kernel/ostype; then
  exec /bin/sh "$linux" diagnostic-append "$folder"
fi
exec "$helper" diagnostic-append "$folder"
`

const SAFE_ERRORS = new Set([
  'shared write failed', 'request create failed', 'invalid image',
  'cannot start tail', 'file read failed', 'store read failed', 'cannot read folder',
  'first pull failed', 'tail first pull failed', 'folder check failed', 'settings read failed',
  '$.state.set refused: no hooks module of that name is loaded, so there is no scan to allow it (host rule)',
])
const ERROR_CLASSES = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'URIError', 'EvalError'])

// Error messages can carry a prompt, file content or a path. Keep only fixed known messages
// and OS error codes; unknown text never crosses the diagnostic boundary.
export function safeDiagnosticError(error: unknown): string {
  const name = error instanceof Error && ERROR_CLASSES.has(error.name) ? error.name : 'Error'
  const message = error instanceof Error ? error.message.replace(/^environment \d+: /, '').replace(/^(?:coco: )?\$\.(?:fs\.(?:read|exists)|store\.(?:get|set)|state\.(?:get|set)|process\.(?:run|spawn))(?:: | refused: )/, '') : ''
  if (SAFE_ERRORS.has(message)) return `${name}: ${message}`
  const code = message.match(/\b(?:EACCES|EPERM|ENOENT|EIO|ENOSPC|EROFS|EEXIST|ENOTDIR|EISDIR|EMFILE|ENFILE|ETIMEDOUT|ECONNRESET|EPIPE)\b/)?.[0]
  return code ? `${name}: ${code}` : `${name}: [redacted]`
}
