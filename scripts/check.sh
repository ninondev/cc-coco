#!/bin/sh
# check.sh - validate this repo before a commit or release.
#
# Usage: scripts/check.sh [--strict] [--private-guard FILE] [--scan-only]
#   --strict   treat validator warnings as errors (claude plugin validate --strict)
#   --private-guard FILE   also scan the payload with a required private fixed-string guard
#   --scan-only            run only the generic payload checks and optional private guard
#
# Runs, in order:
#   1. claude plugin validate on the repo root (the marketplace)
#   2. claude plugin validate on plugin/ (the plugin itself)
#   3. the mod tests: python3 tools/run-tests.py (which runs claude plugin test on a scratch copy
#      of plugin/ with tools/tests/ beside it); falls back to claude plugin test on plugin/ if the
#      tests sit inside it
#   3b. python3 tools/build-lines.py --check: plugin/hooks/lines.ts and voice.ts match persona/
#   4. a syntax check of plugin/bin/*.sh and generic checks for local-only files and private keys
# Public mode is the default and needs no private files. Maintainers can set
# CLAUDE_SAMA_PRIVATE_GUARD or pass --private-guard FILE; a missing, unreadable or empty guard
# stops the check. Keep that file outside the public tree.
# Every step runs even if an earlier one fails; the exit code is 1 if any step failed.
#
# The claude CLI runs with a throwaway HOME and config folder, so checking never touches your own
# ~/.claude. Override the binary with CLAUDE_BIN=/path/to/claude (default: ~/.local/bin/claude,
# then whatever `claude` is on PATH). The scratch folder this script makes goes to the Trash where
# /usr/bin/trash exists (macOS) and is deleted outright where it does not (Linux CI).

set -eu

PROG=check.sh
say() { printf '%s\n' "$*"; }

ROOT=$(cd "$(dirname "$0")/.." && pwd -P)
STRICT=
SCAN_ONLY=0
PRIVATE_GUARD=${CLAUDE_SAMA_PRIVATE_GUARD-}
PRIVATE_MODE=${CLAUDE_SAMA_PRIVATE_GUARD+x}

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
checks bin/*.sh syntax, and checks for local-only files and private keys. Exit 1 if anything fails.
Public mode needs no private file. --private-guard FILE (or CLAUDE_SAMA_PRIVATE_GUARD)
adds a required private fixed-string scan; keep the file outside the public tree.
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

TMP=$(mktemp -d "${TMPDIR:-/tmp}/claude-sama-check.XXXXXX")
# shellcheck disable=SC2329  # called through trap
cleanup() {
  if [ -n "$TMP" ] && [ -d "$TMP" ]; then
    if [ -x /usr/bin/trash ]; then
      /usr/bin/trash "$TMP" >/dev/null 2>&1 || printf '%s: could not move %s to the Trash; left in place\n' "$PROG" "$TMP" >&2
    else
      rm -rf "$TMP"
    fi
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
  if grep -rIlE --exclude-dir='.git' \
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
    # Print only filenames: a guard failure must not echo private text into a release log.
    if grep -rIilF -f "$PRIVATE_GUARD" --exclude-dir='.git' "$ROOT" >"$TMP/private-hits"; then
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
      step "mod tests pass (tools/run-tests.py)" tail env CLAUDE_BIN="$CLAUDE" python3 "$ROOT/tools/run-tests.py"
    else
      fail "python3 not found; cannot run tools/run-tests.py"
    fi
  elif [ -n "$(find "$ROOT/plugin" \( -name '*.test.ts' -o -name '*.test.tsx' \) -print -quit 2>/dev/null)" ]; then
    run "mod tests pass (plugin test)" plugin test "$ROOT/plugin"
  else
    skip "no tools/run-tests.py and no *.test.ts or *.test.tsx files under plugin/; mod tests not run"
  fi
fi

# 3b. generated modules: plugin/hooks/lines.ts and voice.ts must match persona/ (CI runs the same
# rebuild and fails on a git diff; --check needs no git)
if [ -f "$ROOT/tools/build-lines.py" ]; then
  if command -v python3 >/dev/null 2>&1; then
    step "lines.ts and voice.ts match persona/ (tools/build-lines.py --check)" all python3 "$ROOT/tools/build-lines.py" --check
  else
    fail "python3 not found; cannot run tools/build-lines.py"
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
