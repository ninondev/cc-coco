#!/bin/sh
# check.sh - validate this repo before a commit or release.
#
# Usage: scripts/check.sh [--strict] [--private-guard FILE] [--scan-only]
#   --strict   treat validator warnings as errors (claude plugin validate --strict)
#   --private-guard FILE   also check working modules against private sources and scan the payload
#   --scan-only            run only the generic payload checks and optional private guard
#
# Runs, in order:
#   1. claude plugin validate on the repo root (the marketplace)
#   2. claude plugin validate on plugin/ (the plugin itself)
#   3. the mod tests: python3 tools/run-tests.py (which runs claude plugin test on a scratch copy
#      of plugin/ with tools/tests/ beside it); falls back to claude plugin test on plugin/ if the
#      tests sit inside it
#   3b. maintainer mode only: check the working modules against the private maintainer sources
#   4. a syntax check of plugin/bin/*.sh and generic checks for local-only files and private keys
# Public mode is the default and needs no private files. Maintainers can set
# COCO_PRIVATE_GUARD or pass --private-guard FILE; a missing, unreadable or empty guard
# stops the check. Keep that file outside the public tree.
# Every step runs even if an earlier one fails; the exit code is 1 if any step failed.
#
# The claude CLI runs with a throwaway HOME and config folder, so checking never touches your own
# ~/.claude. Override the binary with CLAUDE_BIN=/path/to/claude (default: ~/.local/bin/claude,
# then whatever `claude` is on PATH). Scratch lives under /private/tmp and is deleted after the check.

set -eu
export PYTHONDONTWRITEBYTECODE=1

PROG=check.sh
say() { printf '%s\n' "$*"; }

ROOT=$(cd "$(dirname "$0")/.." && pwd -P)
STRICT=
SCAN_ONLY=0
PRIVATE_GUARD=${COCO_PRIVATE_GUARD-}
PRIVATE_MODE=${COCO_PRIVATE_GUARD+x}

while [ $# -gt 0 ]; do
  case $1 in
    --strict) STRICT=--strict ;;
    --scan-only) SCAN_ONLY=1 ;;
    --private-guard)
      [ $# -ge 2 ] || { printf '%s: --private-guard needs a file\n' "$PROG" >&2; exit 2; }
      PRIVATE_GUARD=$2
      PRIVATE_MODE=x
      shift
      ;;
    -h | --help)
      cat <<EOF
Usage: scripts/check.sh [--strict] [--private-guard FILE] [--scan-only]
Validates the marketplace (repo root) and plugin/, runs the mod tests if there are any,
checks bin/*.sh syntax, explicit release includes, the 64 MiB plugin budget, excluded files,
and byte-level local/private material. Exit 1 if anything fails.
Public mode needs no private file. --private-guard FILE (or COCO_PRIVATE_GUARD)
checks the working modules against private sources and adds a required fixed-string scan;
keep the file outside the public tree.
--scan-only runs just the payload scans, for maintainer assembly preflight.
EOF
      exit 0
      ;;
    *)
      printf '%s: unknown argument: %s\n' "$PROG" "$1" >&2
      exit 2
      ;;
  esac
  shift
done

if [ -n "$PRIVATE_MODE" ]; then
  if [ ! -f "$PRIVATE_GUARD" ] || [ ! -r "$PRIVATE_GUARD" ] || [ ! -s "$PRIVATE_GUARD" ]; then
    printf '%s: private guard missing, unreadable, empty or not a regular file: %s\n' "$PROG" "$PRIVATE_GUARD" >&2
    exit 2
  fi
fi

CLAUDE=${CLAUDE_BIN:-}
if [ "$SCAN_ONLY" -eq 0 ] && [ -z "$CLAUDE" ]; then
  if [ -n "${HOME:-}" ] && [ -x "$HOME/.local/bin/claude" ]; then
    CLAUDE=$HOME/.local/bin/claude
  elif command -v claude >/dev/null 2>&1; then
    CLAUDE=$(command -v claude)
  else
    printf '%s: claude CLI not found (set CLAUDE_BIN or install Claude Code)\n' "$PROG" >&2
    exit 2
  fi
fi

SCRATCH_BASE=/private/tmp
[ -d "$SCRATCH_BASE" ] || SCRATCH_BASE=${TMPDIR:-/tmp}
TMP=$(mktemp -d "$SCRATCH_BASE/coco-check.XXXXXX")
# shellcheck disable=SC2329  # called through trap
cleanup() {
  [ "${COCO_KEEP_SCRATCH:-0}" = 1 ] && return 0
  if [ -n "$TMP" ] && [ -d "$TMP" ]; then
    rm -rf "$TMP"
  fi
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

FAILS=0
pass() { say "ok    $1"; }
fail() {
  say "FAIL  $1"
  FAILS=$((FAILS + 1))
}
skip() { say "skip  $1"; }

scan_payload() {
  # Remain self-contained for the public transport tests' minimal scanner fixtures.
  # Real plugin/marketplace trees additionally require the explicit include policy.
  # plugin/types and the Windows builds in plugin/companion-rs/bin and plugin/libexec ship;
  # the policy below names each of those files.
  if find "$ROOT" -name .git -prune -o \
      \( -name evidence -o -name sheets -o -name previews -o -name preview \
         -o -name target -o -name build -o -name dist -o -name .build \
         -o \( -name types ! -path "$ROOT/plugin/types" \) -o -name tsconfig.json -o -name node_modules \
         -o -name __pycache__ -o -name '*.app' \
         -o \( -name '*.exe' ! -path "$ROOT/plugin/companion-rs/bin/*" ! -path "$ROOT/plugin/libexec/*" \) \
         -o -name '*.o' -o -name '*.dylib' -o -name '*.so' \
         -o -name '*.log' -o -name '*.tmp' -o -name '*.bak' -o -name '*.swp' \) \
      -print >"$TMP/excluded-hits"; then
    if [ -s "$TMP/excluded-hits" ]; then
      head -n 20 "$TMP/excluded-hits" | sed 's/^/      /'
      fail "excluded release files or directories found"
    else
      pass "no excluded release files or directories"
    fi
  else
    fail "excluded release file inventory failed"
  fi
  if [ -f "$ROOT/plugin/.claude-plugin/plugin.json" ] || [ -f "$ROOT/.claude-plugin/marketplace.json" ]; then
    if [ ! -f "$ROOT/scripts/release-policy.py" ] || [ ! -f "$ROOT/scripts/public-tests.py" ]; then
      fail "release policy helper missing; restore scripts/release-policy.py and scripts/public-tests.py"
    elif python3 -B "$ROOT/scripts/release-policy.py" check "$ROOT" >"$TMP/policy-out" 2>&1; then
      sed 's/^/      /' "$TMP/policy-out"
      pass "explicit release includes and plugin size budget"
    else
      sed 's/^/      /' "$TMP/policy-out"
      fail "release include, executable or size policy failed"
    fi
  fi
  # Shipping code may mention the snake; it must never invoke an interpreter.
  if ! find "$ROOT/plugin" -type f -name '*.py' -print >"$TMP/python-hits" ||
      ! find "$ROOT/plugin" -type f -print >"$TMP/python-files"; then
    fail "Python runtime invocation scan failed (file inventory; rerun after fixing the error above)"
    return
  fi
  : >"$TMP/python-errors"
  while IFS= read -r f; do
    case $f in
      *.png|*.ico|*.icns|*.jpg|*.jpeg|*.gif|*.webp) ;;
      *)
        # Mach-O/ELF helpers contain arbitrary bytes. Scan as bytes, and retain
        # both command statuses: POSIX pipelines have no pipefail.
        if ! LC_ALL=C sed '/^[[:space:]]*\/\//d; /^[[:space:]]*#[^!]/d' "$f" >"$TMP/python-code"; then
          printf '%s\n' "$f" >>"$TMP/python-errors"
          continue
        fi
        if LC_ALL=C grep -aE "(^#!.*python[0-9.]*|(^|[;|&()[:space:]])(/(usr/)?bin/)?python[0-9.]*([[:blank:]]+[^[:blank:]]|[[:blank:]]*$)|/[^[:space:]\"']*python[0-9.]*[\"']|(^|[^[:alnum:]_])(argv|executableURL|spawn|exec|execFile|run)[^;]{0,160}[\"']python[0-9.]*[\"'])" "$TMP/python-code" >/dev/null; then
          printf '%s\n' "$f" >>"$TMP/python-hits"
        else
          scan_status=$?
          [ "$scan_status" -eq 1 ] || printf '%s\n' "$f" >>"$TMP/python-errors"
        fi
        ;;
    esac
  done <"$TMP/python-files"
  if [ -s "$TMP/python-errors" ]; then
    while IFS= read -r f; do printf '      %s\n' "$f"; done <"$TMP/python-errors"
    fail "Python runtime invocation scan failed for the files above; fix the read or scanner error and rerun"
  elif [ -s "$TMP/python-hits" ]; then
    while IFS= read -r f; do printf '      %s\n' "$f"; done <"$TMP/python-hits"
    fail "Python runtime invocation or helper found under plugin/"
  else
    pass "plugin/ has no Python runtime invocation or helper"
  fi
  # Private authoring files never belong in the public payload, even as empty paths or symlinks.
  if [ -e "$ROOT/persona" ] || [ -L "$ROOT/persona" ] || \
      [ -e "$ROOT/tools/build-lines.py" ] || [ -L "$ROOT/tools/build-lines.py" ]; then
    fail "private persona sources or generator found in the public payload"
  else
    pass "no private persona sources or generator in the public payload"
  fi

  # Filename checks also catch empty files and symlinks, which a text scan could miss.
  if find "$ROOT" -name .git -prune -o \
      \( -name '.env' -o -name '.env.*' -o -name '.leak-patterns' -o -name 'leak-patterns.private' \) \
      -print >"$TMP/local-only"; then
    if [ -s "$TMP/local-only" ]; then
      head -n 20 "$TMP/local-only" | sed 's/^/      /'
      fail "local-only files found in the public payload"
    else
      pass "no local-only files in the public payload"
    fi
  else
    fail "could not scan the payload for local-only files"
  fi

  # Anchor key headers to a whole line so this check's own expression is not a match.
  if LC_ALL=C grep -ralE --exclude-dir='.git' \
      '^-----BEGIN (RSA |DSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----[[:space:]]*$' \
      "$ROOT" >"$TMP/key-hits"; then
    head -n 20 "$TMP/key-hits" | sed 's/^/      /'
    fail "private key material found in the public payload"
  else
    scan_status=$?
    if [ "$scan_status" -eq 1 ]; then
      pass "no private key material in the public payload"
    else
      fail "generic key scan failed (grep exit $scan_status; diagnostic above)"
    fi
  fi

  if [ -n "$PRIVATE_MODE" ]; then
    if ! (cd "$ROOT" && find . -name .git -prune -o -print) >"$TMP/payload-paths"; then
      fail "private guard path inventory failed"
    elif LC_ALL=C grep -aiF -f "$PRIVATE_GUARD" "$TMP/payload-paths" >/dev/null; then
      fail "private guard matched a public payload path"
    else
      scan_status=$?
      if [ "$scan_status" -eq 1 ]; then
        pass "no private guard path hits"
      else
        fail "private guard path scan failed (grep exit $scan_status)"
      fi
    fi
    # Print only filenames: a guard failure must not echo private text into a release log.
    if LC_ALL=C grep -railF -f "$PRIVATE_GUARD" --exclude-dir='.git' "$ROOT" >"$TMP/private-hits"; then
      head -n 20 "$TMP/private-hits" | sed 's/^/      /'
      fail "private guard matched text in the public payload"
    else
      scan_status=$?
      if [ "$scan_status" -eq 1 ]; then
        pass "no private guard hits"
      else
        fail "private guard scan failed (grep exit $scan_status; diagnostic above)"
      fi
    fi
  fi
}

finish() {
  say ""
  if [ "$FAILS" -eq 0 ]; then
    say "All checks passed."
    exit 0
  fi
  say "$FAILS check(s) failed."
  exit 1
}

if [ "$SCAN_ONLY" -eq 1 ]; then
  scan_payload
  finish
fi

# POSIX sh has no pipefail, so run through a helper that records the real exit status.
# step LABEL SHOW CMD ARGS...   SHOW is "all" (print the whole output) or "tail" (on success print
# only the last lines, on failure everything).
step() {
  _label=$1
  _show=$2
  shift 2
  (
    HOME=$TMP CLAUDE_CONFIG_DIR=$TMP/.claude "$@" >"$TMP/out" 2>&1
    echo $? >"$TMP/rc"
  ) || true
  if [ "$(cat "$TMP/rc")" -eq 0 ]; then
    if [ "$_show" = tail ]; then tail -n 4 "$TMP/out" | sed 's/^/      /'; else sed 's/^/      /' "$TMP/out"; fi
    pass "$_label"
  else
    sed 's/^/      /' "$TMP/out"
    fail "$_label"
  fi
}

# run LABEL ARGS...   runs the claude CLI
run() {
  _l=$1
  shift
  step "$_l" all "$CLAUDE" "$@"
}

say "claude CLI: $(HOME=$TMP CLAUDE_CONFIG_DIR=$TMP/.claude "$CLAUDE" --version 2>/dev/null || echo unknown)"
say "repo:       $ROOT"
say ""

# 1. marketplace
[ -f "$ROOT/.claude-plugin/marketplace.json" ] || fail "missing .claude-plugin/marketplace.json"
# shellcheck disable=SC2086  # $STRICT is empty or one flag
run "marketplace validates (repo root)" plugin validate $STRICT "$ROOT"

# 2. plugin
if [ ! -d "$ROOT/plugin" ]; then
  fail "plugin/ is missing; run scripts/assemble.sh first"
elif [ ! -f "$ROOT/plugin/.claude-plugin/plugin.json" ]; then
  fail "plugin/.claude-plugin/plugin.json is missing; run scripts/assemble.sh once the working plugin has a manifest"
else
  # shellcheck disable=SC2086
  run "plugin validates (plugin/)" plugin validate $STRICT "$ROOT/plugin"

  # 3. tests
  if [ -f "$ROOT/tools/run-tests.py" ] && [ -d "$ROOT/tools/tests" ]; then
    if command -v python3 >/dev/null 2>&1; then
      step "mod tests pass (tools/run-tests.py)" tail env COCO_TEST_SERIAL_FILES=1 CLAUDE_BIN="$CLAUDE" python3 "$ROOT/tools/run-tests.py"
    else
      fail "python3 not found; cannot run tools/run-tests.py"
    fi
  elif [ -n "$(find "$ROOT/plugin" \( -name '*.test.ts' -o -name '*.test.tsx' \) -print -quit 2>/dev/null)" ]; then
    run "mod tests pass (plugin test)" plugin test "$ROOT/plugin"
  else
    skip "no tools/run-tests.py and no *.test.ts or *.test.tsx files under plugin/; mod tests not run"
  fi
fi

# 3b. Maintainers check the WORKING tree, never the public copies. The private generator resolves
# ../persona and ../plugin from its own location; --check writes nothing. Public CI needs neither.
if [ -n "$PRIVATE_MODE" ]; then
  if [ ! -f "$ROOT/../tools/build-lines.py" ]; then
    fail "private maintainer generator missing: $ROOT/../tools/build-lines.py"
  elif command -v python3 >/dev/null 2>&1; then
    step "working lines.ts and voice.ts match private sources" all python3 "$ROOT/../tools/build-lines.py" --check
  else
    fail "python3 not found; cannot check working modules against private sources"
  fi
fi

# 4a. shell syntax of the icon scripts
if [ -d "$ROOT/plugin/bin" ]; then
  bad=0
  for f in "$ROOT"/plugin/bin/*.sh; do
    [ -f "$f" ] || continue
    if ! sh -n "$f" 2>"$TMP/syntax"; then
      sed 's/^/      /' "$TMP/syntax"
      bad=1
    fi
    if [ ! -x "$f" ]; then
      say "      not executable: $f"
      bad=1
    fi
  done
  if [ "$bad" -eq 0 ]; then pass "plugin/bin/*.sh parse and are executable"; else fail "plugin/bin/*.sh problem (see above)"; fi
fi

# 4b. generic payload checks and optional private guard
scan_payload
finish
