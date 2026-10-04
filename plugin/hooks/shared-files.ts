// Fixed host scripts. Callers supply paths as argv and content on stdin, never as shell code.
// The existing companion folder is the only place either script may create a file.
export const ATOMIC_WRITE = String.raw`set -eu
folder=$1
name=$2
case "$name" in view.json) ;; *) exit 64 ;; esac
test -d "$folder" || exit 1
umask 077
temporary=$(mktemp "$folder/.view.XXXXXXXX")
trap 'rm -f "$temporary"' EXIT
trap 'exit 1' HUP INT TERM
cat > "$temporary"
test -d "$folder" || exit 1
mv -f "$temporary" "$folder/$name"
`

// A mkdir lock serializes rotation across sessions. Dead owners are recoverable; a busy
// writer costs at most one hundred short waits and then drops this optional diagnostic record.
export const DIAGNOSTIC_APPEND = String.raw`set -eu
folder=$1
test -d "$folder" && test -e "$folder/diagnostics" || exit 0
umask 077
lock="$folder/.diagnostics.lock"
owner="$lock/owner.$$"
acquired=0
attempt=0
while test "$attempt" -lt 100; do
  if mkdir "$lock" 2>/dev/null; then
    if printf '%s\n' "$$" > "$owner"; then acquired=1; break; fi
  fi
  for previous in "$lock"/owner.*; do
    test -f "$previous" || continue
    pid=$(cat "$previous" 2>/dev/null || true)
    case "$pid" in ''|*[!0-9]*) continue ;; esac
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$previous"
      rmdir "$lock" 2>/dev/null || true
    fi
  done
  if test -d "$lock" && test -n "$(find "$lock" -prune -mmin +1 -print 2>/dev/null)"; then
    rmdir "$lock" 2>/dev/null || true
  fi
  attempt=$((attempt + 1))
  sleep 0.01
done
test "$acquired" -eq 1 || exit 75
temporary=''
trap 'test -z "$temporary" || rm -f "$temporary"; rm -f "$owner"; rmdir "$lock" 2>/dev/null || true' EXIT
trap 'exit 1' HUP INT TERM
test -e "$folder/diagnostics" || exit 0
temporary=$(mktemp "$folder/.diagnostic.XXXXXXXX")
cat > "$temporary"
bytes=$(wc -c < "$temporary")
test "$bytes" -gt 0 && test "$bytes" -le 4096 || exit 0
lines=$(wc -l < "$temporary")
test "$lines" -eq 1 || exit 0
log="$folder/diagnostics.log"
size=0
if test -f "$log"; then size=$(wc -c < "$log"); fi
if test "$((size + bytes))" -gt 204800; then mv -f "$log" "$log.1"; fi
test -e "$folder/diagnostics" || exit 0
cat "$temporary" >> "$log"
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
  const message = error instanceof Error ? error.message.replace(/^environment \d+: /, '').replace(/^(?:claudesama: )?\$\.(?:fs\.(?:read|exists)|store\.(?:get|set)|state\.(?:get|set)|process\.(?:run|spawn))(?:: | refused: )/, '') : ''
  if (SAFE_ERRORS.has(message)) return `${name}: ${message}`
  const code = message.match(/\b(?:EACCES|EPERM|ENOENT|EIO|ENOSPC|EROFS|EEXIST|ENOTDIR|EISDIR|EMFILE|ENFILE|ETIMEDOUT|ECONNRESET|EPIPE)\b/)?.[0]
  return code ? `${name}: ${code}` : `${name}: [redacted]`
}
