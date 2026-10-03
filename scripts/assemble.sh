#!/bin/sh
# assemble.sh - refresh claude-sama/plugin, tools and persona from the working tree.
#
# Maintainer script. The working copy lives next to this repo folder (../plugin, ../tools,
# ../persona); the public repo ships a clean copy of it. Run this, then the maintainer check, then
# commit.
#
# Usage: scripts/assemble.sh [--dry-run] [--source DIR] [--tools-source DIR] [--persona-source DIR]
#   --dry-run              show what rsync would change; leave destination trees untouched
#   --source DIR           working plugin folder (default: ../plugin relative to this repo)
#   --tools-source DIR     working tools folder (default: ../tools relative to this repo)
#   --persona-source DIR   working persona folder (default: ../persona relative to this repo)
#
# What is copied:
#   plugin/               from the working plugin folder, without the files Claude Code writes into
#                         a plugin it loads from a folder (.claude-plugin/types/ and tsconfig.json:
#                         about 750 KB of type declarations that the engine regenerates per version)
#   tools/tests/          from the working tools/tests (the generated book-files.ts is left out;
#                         tools/run-tests.py writes it in its scratch copy)
#   tools/run-tests.py    from the working tools folder
#   tools/build-lines.py  from the working tools folder (regenerates plugin/hooks/lines.ts and
#                         voice.ts from persona/)
#   persona/lines.json, persona/voice-prompt.md
#                         from the working persona folder: the sources of his words. Nothing else in
#                         persona/ is copied, and anything else found in persona/ here is removed.
# Nothing else under tools/ is copied: previews, mockups and asset builders stay private.
#
# The tree copies use rsync --delete, so files removed from the working tree disappear here too.
# Scratch output of tests, editor leftovers and logs are never copied.
#
# Required leak guard: ../tools/release/leak-patterns.private stays outside the public tree,
# one fixed string per line, case-insensitive. The inputs are staged in a scratch folder with
# the same transfer filters as publication, then checked in maintainer scan mode. A match,
# missing, unreadable or empty pattern file, or scan error stops the run before
# destination trees are touched. Dry runs also use scratch storage for this scan.

set -eu

PROG=assemble.sh
say() { printf '%s\n' "$*"; }
die() {
  printf '%s: %s\n' "$PROG" "$*" >&2
  exit 2
}

ROOT=$(cd "$(dirname "$0")/.." && pwd -P)
SRC=$ROOT/../plugin
TOOLS_SRC=$ROOT/../tools
PERSONA_SRC=$ROOT/../persona
DRY=0

# The two persona files that are published, and the tools files copied one by one.
PERSONA_FILES="lines.json voice-prompt.md"
TOOLS_FILES="run-tests.py build-lines.py"

while [ $# -gt 0 ]; do
  case $1 in
    --dry-run | -n) DRY=1 ;;
    --source)
      [ $# -ge 2 ] || die "--source needs a folder"
      SRC=$2
      shift
      ;;
    --tools-source)
      [ $# -ge 2 ] || die "--tools-source needs a folder"
      TOOLS_SRC=$2
      shift
      ;;
    --persona-source)
      [ $# -ge 2 ] || die "--persona-source needs a folder"
      PERSONA_SRC=$2
      shift
      ;;
    -h | --help)
      cat <<EOF
Usage: scripts/assemble.sh [--dry-run] [--source DIR] [--tools-source DIR] [--persona-source DIR]
Refreshes claude-sama/plugin (from ../plugin), claude-sama/tools/tests, tools/run-tests.py and
tools/build-lines.py (from ../tools), and claude-sama/persona/lines.json and voice-prompt.md (from
../persona) with rsync, leaving out test scratch output, logs, editor leftovers, the generated
book-files.ts and the files Claude Code writes into a plugin it loads (.claude-plugin/types/,
tsconfig.json).
--dry-run leaves destination trees untouched; the leak scan uses temporary scratch storage.
EOF
      exit 0
      ;;
    *) die "unknown argument: $1 (try --help)" ;;
  esac
  shift
done

PATTERNS=$ROOT/../tools/release/leak-patterns.private
[ -f "$PATTERNS" ] && [ -r "$PATTERNS" ] && [ -s "$PATTERNS" ] || \
  die "private guard missing, unreadable, empty or not a regular file: $PATTERNS; destination trees untouched"

[ -d "$SRC" ] || die "working plugin folder not found: $SRC"
SRC=$(cd "$SRC" && pwd -P)
DEST=$ROOT/plugin

[ -d "$TOOLS_SRC" ] || die "working tools folder not found: $TOOLS_SRC"
TOOLS_SRC=$(cd "$TOOLS_SRC" && pwd -P)
[ -d "$TOOLS_SRC/tests" ] || die "working tests folder not found: $TOOLS_SRC/tests"
for f in $TOOLS_FILES; do
  [ -f "$TOOLS_SRC/$f" ] || die "working tools file not found: $TOOLS_SRC/$f"
done
TOOLS_DEST=$ROOT/tools

[ -d "$PERSONA_SRC" ] || die "working persona folder not found: $PERSONA_SRC"
PERSONA_SRC=$(cd "$PERSONA_SRC" && pwd -P)
for f in $PERSONA_FILES; do
  [ -f "$PERSONA_SRC/$f" ] || die "working persona file not found: $PERSONA_SRC/$f"
done
PERSONA_DEST=$ROOT/persona

[ "$SRC" != "$DEST" ] || die "source and destination are the same folder: $SRC"
[ "$TOOLS_SRC" != "$TOOLS_DEST" ] || die "tools source and destination are the same folder: $TOOLS_SRC"
[ "$PERSONA_SRC" != "$PERSONA_DEST" ] || die "persona source and destination are the same folder: $PERSONA_SRC"
case $DEST/ in
  "$SRC"/*) die "destination $DEST is inside the source $SRC" ;;
esac
case $TOOLS_DEST/ in
  "$TOOLS_SRC"/*) die "destination $TOOLS_DEST is inside the tools source $TOOLS_SRC" ;;
esac
case $PERSONA_DEST/ in
  "$PERSONA_SRC"/*) die "destination $PERSONA_DEST is inside the persona source $PERSONA_SRC" ;;
esac
command -v rsync >/dev/null 2>&1 || die "rsync not found"

if [ ! -f "$SRC/.claude-plugin/plugin.json" ]; then
  printf '%s: warning: %s has no .claude-plugin/plugin.json yet; the copy will not validate as a plugin\n' \
    "$PROG" "$SRC" >&2
fi

# sync FROM/ TO/ [extra rsync options]
# --delete-excluded also clears excluded leftovers that an earlier copy may have picked up.
# The tests/... patterns apply to a plugin that carries its own tests/ folder; the bare ones
# (out/, tmp/ ...) apply when the transfer root is a tests/ folder itself.
sync() {
  _from=$1
  _to=$2
  shift 2
  rsync -a --delete --delete-excluded \
    --exclude '.git/' \
    --exclude '.DS_Store' \
    --exclude 'node_modules/' \
    --exclude '__pycache__/' \
    --exclude '*.log' \
    --exclude '*.tmp' \
    --exclude '*.bak' \
    --exclude '*.swp' \
    --exclude '*~' \
    --exclude 'tests/out/' \
    --exclude 'tests/tmp/' \
    --exclude 'tests/.tmp/' \
    --exclude 'tests/scratch/' \
    --exclude 'tests/.scratch/' \
    --exclude 'tests/output/' \
    --exclude 'tests/*.actual.*' \
    "$@" "$_from" "$_to"
}

# publish PLUGIN_DEST TOOLS_DEST PERSONA_DEST [extra rsync options]
# Both the scan staging and final transfer use this selection. Keep all exclusions here or in sync.
publish() {
  _plugin_dest=$1
  _tools_dest=$2
  _persona_dest=$3
  shift 3
  sync "$SRC/" "$_plugin_dest/" "$@" \
    --exclude '/.claude-plugin/types/' \
    --exclude '/tsconfig.json' || return $?
  sync "$TOOLS_SRC/tests/" "$_tools_dest/tests/" "$@" \
    --exclude 'book-files.ts' \
    --exclude 'out/' \
    --exclude 'tmp/' \
    --exclude '.tmp/' \
    --exclude 'scratch/' \
    --exclude '.scratch/' \
    --exclude 'output/' \
    --exclude '*.actual.*' || return $?
  for f in $TOOLS_FILES; do
    rsync -a "$@" "$TOOLS_SRC/$f" "$_tools_dest/$f" || return $?
  done
  # Only the two named persona files; remove other files from the destination persona tree.
  sync "$PERSONA_SRC/" "$_persona_dest/" "$@" \
    --include 'lines.json' \
    --include 'voice-prompt.md' \
    --exclude '*' || return $?
}

SCAN=$(mktemp -d "${TMPDIR:-/tmp}/assemble-scan.XXXXXX")
cleanup() { rm -rf "$SCAN"; }
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
mkdir -p "$SCAN/plugin" "$SCAN/tools/tests" "$SCAN/persona" "$SCAN/scripts"
if publish "$SCAN/plugin" "$SCAN/tools" "$SCAN/persona"; then
  :
else
  die "could not stage inputs for leak scan (diagnostic above); destination trees untouched"
fi
# Use the same generic and private scans as the release gate; no validators or tests run here.
cp "$ROOT/scripts/check.sh" "$SCAN/scripts/check.sh"
if ! sh "$SCAN/scripts/check.sh" --scan-only --private-guard "$PATTERNS"; then
  die "maintainer payload scan failed; destination trees untouched"
fi

say "Plugin source:   $SRC"
say "Plugin dest:     $DEST"
say "Tools source:    $TOOLS_SRC"
say "Tools dest:      $TOOLS_DEST"
say "Persona source:  $PERSONA_SRC"
say "Persona dest:    $PERSONA_DEST"

if [ "$DRY" -eq 1 ]; then
  publish "$DEST" "$TOOLS_DEST" "$PERSONA_DEST" --dry-run -v
else
  mkdir -p "$DEST" "$TOOLS_DEST/tests" "$PERSONA_DEST"
  publish "$DEST" "$TOOLS_DEST" "$PERSONA_DEST"
fi

if [ "$DRY" -eq 1 ]; then
  say "Dry run: destination trees untouched; temporary scan storage was used."
else
  n=$(find "$DEST" -type f | wc -l | tr -d ' ')
  t=$(find "$TOOLS_DEST" -type f | wc -l | tr -d ' ')
  p=$(find "$PERSONA_DEST" -type f | wc -l | tr -d ' ')
  say "Done: $n files in $DEST, $t in $TOOLS_DEST, $p in $PERSONA_DEST"
  say "Next: scripts/check.sh --private-guard ../tools/release/leak-patterns.private"
fi
