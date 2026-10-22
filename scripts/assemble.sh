#!/bin/sh
# Refresh a public payload only after a complete scratch preflight.
set -eu
export PYTHONDONTWRITEBYTECODE=1
PROG=assemble.sh
die() { printf '%s: %s\n' "$PROG" "$*" >&2; exit 2; }
ROOT=$(cd "$(dirname "$0")/.." && pwd -P)
SRC=$ROOT/../plugin
TOOLS_SRC=$ROOT/../tools
README_SRC=
WORD_INPUTS=
DEST=$ROOT
PATTERNS=$ROOT/../tools/release/leak-patterns.private
DRY=0
MANIFEST=
while [ $# -gt 0 ]; do
  case $1 in
    --dry-run|-n) DRY=1 ;;
    --source|--tools-source|--readme-source|--word-inputs|--dest|--private-guard|--manifest)
      [ $# -ge 2 ] || die "$1 needs a path"
      case $1 in
        --source) SRC=$2 ;; --tools-source) TOOLS_SRC=$2 ;;
        --readme-source) README_SRC=$2 ;; --word-inputs) WORD_INPUTS=$2 ;; --dest) DEST=$2 ;;
        --private-guard) PATTERNS=$2 ;; --manifest) MANIFEST=$2 ;;
      esac
      shift ;;
    --help|-h)
      cat <<EOF
Usage: scripts/assemble.sh [--dry-run] [--source PLUGIN] [--tools-source TOOLS]
       [--readme-source DRAFTS] [--dest TREE] [--private-guard FILE] [--manifest JSON]
Stages explicit runtime, companion source/assets, public tests, licenses and documentation.
Rejects excluded files, a plugin over 64 MiB, leaks and tests that read private sources before copying.
--dry-run scans and inventories scratch only; destinations stay untouched.
--dest selects a separate assembly tree. Existing managed files use rsync --delete.
Private guard must be a readable, nonempty regular file outside the public payload.
EOF
      exit 0 ;;
    *) die "unknown argument: $1 (try --help)" ;;
  esac
  shift
done
command -v python3 >/dev/null 2>&1 || die "python3 not found"
command -v rsync >/dev/null 2>&1 || die "rsync not found"
[ -f "$PATTERNS" ] && [ -r "$PATTERNS" ] && [ -s "$PATTERNS" ] || die "private guard missing, unreadable or empty; destination untouched"
[ -d "$SRC" ] && [ -d "$TOOLS_SRC/tests" ] || die "plugin or public tests source missing"
SRC=$(cd "$SRC" && pwd -P)
TOOLS_SRC=$(cd "$TOOLS_SRC" && pwd -P)
if [ -z "$README_SRC" ]; then
  README_SRC=$SRC/../handoffs/program/words/1.0/readme
  [ -d "$README_SRC" ] || README_SRC=$ROOT
fi
[ -d "$README_SRC" ] || die "README source missing: $README_SRC"
# Validate path relationships before any destination mutation, including new paths.
python3 - "$SRC" "$TOOLS_SRC" "$ROOT" "$DEST" "$PATTERNS" "$MANIFEST" "$README_SRC" <<'PY'
import sys
from pathlib import Path
src, tools, root, dest, guard = map(lambda p: Path(p).resolve(), sys.argv[1:6])
raw_dest = Path(sys.argv[4]).absolute()
for candidate in (raw_dest, *raw_dest.parents, *(raw_dest/d for d in ('plugin','tools','scripts','media','.claude-plugin','.github'))):
    if candidate.is_symlink():
        raise SystemExit('assembly destination contains a symlink')
drafts = Path(sys.argv[7]).resolve()
if dest == drafts or drafts in dest.parents or dest in drafts.parents:
    if not (dest == root and drafts == root):
        raise SystemExit('document source and destination must be separate trees')
if sys.argv[6]:
    output = Path(sys.argv[6]).resolve()
    for protected in (src, tools, drafts, dest, guard, root):
        if output == protected or protected in output.parents:
            raise SystemExit('manifest output overlaps a source, payload or guard')
    if Path(sys.argv[6]).is_symlink():
        raise SystemExit('manifest output is a symlink')
for source in (src, tools):
    if dest == source or source in dest.parents or dest in source.parents:
        raise SystemExit('assembly source and destination must be separate trees')
if dest.exists():
    import importlib.util
    spec = importlib.util.spec_from_file_location('policy', root/'scripts/release-policy.py')
    policy = importlib.util.module_from_spec(spec); spec.loader.exec_module(policy)
    permitted = {n.split('/')[0] for n in policy.ROOT_FILES} | {'plugin','tools','.git'}
    for entry in dest.iterdir():
        if entry.name not in permitted:
            raise SystemExit('unmanaged destination entry; retain and remove from release separately: ' + entry.name)
if guard == dest or dest in guard.parents or root in guard.parents:
    raise SystemExit('private guard must stay outside the public payload')
PY
SCRATCH_BASE=/private/tmp
[ -d "$SCRATCH_BASE" ] || SCRATCH_BASE=${TMPDIR:-/tmp}
SCAN=$(mktemp -d "$SCRATCH_BASE/coco-assemble.XXXXXX")
cleanup() { rm -rf "$SCAN"; }
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
mkdir -p "$SCAN/tree/plugin" "$SCAN/tree/tools"
POLICY=$ROOT/scripts/release-policy.py
python3 "$POLICY" filters plugin "$SRC" "$SCAN/plugin.filters"
python3 "$POLICY" filters tools "$TOOLS_SRC" "$SCAN/tools.filters"
rsync -a --delete --delete-excluded --filter="merge $SCAN/plugin.filters" "$SRC/" "$SCAN/tree/plugin/"
rsync -a --delete --delete-excluded --filter="merge $SCAN/tools.filters" "$TOOLS_SRC/" "$SCAN/tree/tools/"
chmod -R u+w "$SCAN/tree"
# Public scaffolding is already in this repo. README drafts override only matching documents;
# missing translations and the changelog remain existing public copies, visibly reported.
python3 -B - "$ROOT" "$README_SRC" "$SCAN/tree" <<'PY'
import importlib.util
import shutil
import sys
from pathlib import Path
root, drafts, stage = map(Path, sys.argv[1:])
spec = importlib.util.spec_from_file_location('policy', root/'scripts/release-policy.py')
policy = importlib.util.module_from_spec(spec); spec.loader.exec_module(policy)
for name in sorted(policy.ROOT_FILES):
    source = root/name
    if name in {'README.md', 'README.zh.md', 'README.ja.md', 'LORE.md', 'CHANGELOG.md'}:
        if (drafts/name).is_file():
            source = drafts/name
        else:
            print('Document fallback to existing public copy: ' + name)
    if source.is_file():
        target = stage/name; target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
for name in ('LICENSE','ART-LICENSE.md','README.md','README.zh.md','README.ja.md','LORE.md','CHANGELOG.md',
             '.claude-plugin/marketplace.json','scripts/check.sh','scripts/release-policy.py','scripts/public-tests.py'):
    if not (stage/name).is_file():
        raise SystemExit('required public file missing: ' + name)
PY
[ -n "$WORD_INPUTS" ] || WORD_INPUTS=$TOOLS_SRC/../handoffs/program/words-1.0.i18n.json
python3 "$ROOT/scripts/public-tests.py" "$TOOLS_SRC" "$SCAN/tree/tools" --word-inputs "$WORD_INPUTS"
# Preserve the existing public generated-comment cleanup, without changing runtime data.
for f in "$SCAN/tree/plugin/hooks/lines.ts" "$SCAN/tree/plugin/hooks/voice.ts" \
    "$SCAN/tree/plugin/hooks/words.ts" "$SCAN/tree/tools/tests/book-fewer-words.test.tsx"; do
  [ -f "$f" ] || continue
  sed \
    -e 's|^// GENERATED by tools/build-lines.py from persona/.*|// GENERATED from private maintainer sources. Do not edit here.|' \
    -e 's|^// edit persona/lines.json and rebuild. Everything he says in the band.|// Everything he says in the band.|' \
    -e 's|^// Omikuji draw weights, from omikuji._about in persona/lines.json.|// Omikuji draw weights.|' \
    -e 's|^// lines.ts (generated from persona/lines.json).|// lines.ts (bundled with the plugin).|' \
    -e 's|^// Rank words pinned independently from persona/lines.json. Every slip is checked, not|// Rank words pinned independently from the bundled lines. Every slip is checked, not|' \
    "$f" >"$SCAN/comment.public"
  cat "$SCAN/comment.public" >"$f"
done
python3 - "$SRC/hooks/voice.ts" "$SCAN/tree/plugin/hooks/voice.ts" "$SCAN/tree/plugin/hooks/voice-sizes.json" <<'PYVOICE'
import hashlib, json, pathlib, sys
source, staged, metadata = map(pathlib.Path, sys.argv[1:])
sizes = json.loads(metadata.read_text())
if sizes.get('sourceSha256') != hashlib.sha256(source.read_bytes()).hexdigest():
    raise SystemExit('voice-size metadata does not match the pinned source')
sizes['sourceSha256'] = hashlib.sha256(staged.read_bytes()).hexdigest()
metadata.write_text(json.dumps(sizes, ensure_ascii=False, indent=2) + '\n')
PYVOICE
if ! sh "$SCAN/tree/scripts/check.sh" --scan-only --private-guard "$PATTERNS"; then
  die "staged payload failed; destination untouched"
fi
python3 "$POLICY" manifest "$SCAN/tree" >"$SCAN/manifest.json"
if [ -n "$MANIFEST" ]; then cp "$SCAN/manifest.json" "$MANIFEST"; fi
python3 - "$SCAN/manifest.json" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
print('Staged total: %d files, %d bytes' % (m['files'], m['bytes']))
for folder, row in m['folders'].items():
    print('%s: %d files, %d bytes' % (folder, row['files'], row['bytes']))
PY
if [ "$DRY" -eq 1 ]; then
  printf '%s\n' 'Dry run passed; destination untouched.'
  exit 0
fi
mkdir -p "$DEST"
# Copy all and only scanned managed files. Preserve the repository database; clean old
# excluded artifacts in managed folders. No git command is run.
for folder in plugin tools scripts media .claude-plugin .github; do
  [ -d "$SCAN/tree/$folder" ] || continue
  mkdir -p "$DEST/$folder"
  rsync -a --delete --delete-excluded "$SCAN/tree/$folder/" "$DEST/$folder/"
done
for file in "$SCAN/tree"/.* "$SCAN/tree"/*; do
  [ -f "$file" ] || continue
  rsync -a "$file" "$DEST/"
done
printf '%s\n' "Assembly passed: $DEST"
