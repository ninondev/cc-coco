#!/bin/sh
# icon-linux.sh - give the Claude desktop app the Claude-sama icon on Linux.
#
# Usage: icon-linux.sh apply | clear | status [--launcher NAME.desktop|PATH] [--icon FILE] [--dry-run]
#
# How it works (standard freedesktop behaviour, nothing is installed system-wide):
#   apply   Finds the Claude desktop launcher, a *.desktop file whose Name or Exec mentions
#           "claude" (searched in ~/.local/share/applications, $XDG_DATA_DIRS and
#           /usr/share/applications). It writes a same-named copy into
#           ~/.local/share/applications with Icon= pointing at the Claude-sama PNG. A launcher in
#           your home directory shadows the packaged one, and package updates do not touch it.
#           The PNG is copied to ~/.local/share/claude-sama/icons/claude-sama.png first, so the path
#           stays valid when the plugin itself is updated or moved. The copy is scaled to 512 px
#           when ImageMagick, sips or python3 with Pillow is available (smaller to load); otherwise
#           the 1024 px PNG is copied as it is.
#   clear   Removes only the override files this script wrote (they carry a marker comment on
#           the first line) and the PNG copy. Edited Icon= lines and adopted user launchers are
#           retained. With explicit --replace-custom, restore only the packaged Icon= in place.
#   status  Reads the effective launcher and verifies the current image (never writes).
#
# Options
#   --launcher X   Use this launcher (a file name such as claude-desktop.desktop, or a full path).
#                  Needed only when more than one launcher looks like Claude.
#   --icon FILE    PNG to use. Default: ../assets/icon/claude-sama-1024.png next to this script.
#   --dry-run      Show what would be written, change nothing.
#   --report       Emit exactly icon: own|stock|custom|unknown; diagnostics go to stderr.
#   --replace-custom  Explicitly opt in to changing only a user's launcher Icon= value.
#
# A running app may keep showing its old icon until it is restarted (some desktops also want a
# log out and in). This script makes no network calls and needs no root.
# Testing aid: CLAUDE_SAMA_ALLOW_ANY_OS=1 lets it run on a non-Linux system against fake XDG dirs.
# License: MIT. Part of Claude-sama, an unofficial fan skin. Claude is a trademark of Anthropic.

set -eu

PROG=icon-linux.sh
MARK='# claude-sama-icon-override:'
MARK_LINE="$MARK written by $PROG; remove it with: $PROG clear"
PRESERVE_MARK='# claude-sama-icon-preserve-launcher:'
REPORT=0
REPORTED=0
WORK_TEMP=
exec 3>&1
for _argument in "$@"; do [ "$_argument" != --report ] || REPORT=1; done
if [ "$REPORT" -eq 1 ]; then exec 1>&2; fi
report_fallback() {
  if [ "$REPORT" -eq 1 ] && [ "$REPORTED" -eq 0 ]; then printf 'icon: unknown\n' >&3; fi
}
trap report_fallback EXIT

say() { printf '%s\n' "$*"; }
warn() { printf '%s: %s\n' "$PROG" "$*" >&2; }
die() {
  warn "$*"
  if [ "$REPORT" -eq 1 ] && [ "$REPORTED" -eq 0 ]; then
    printf 'icon: unknown\n' >&3
    REPORTED=1
  fi
  exit 2
}

usage() {
  cat <<EOF
Usage: $PROG apply | clear | status [--launcher NAME.desktop|PATH] [--icon FILE] [--dry-run]

  apply        Write ~/.local/share/applications/<launcher>.desktop with the Claude-sama icon
  clear        Remove the override this script wrote (and nothing else)
  status       Show the launcher found and whether the override is active (read only)

  --launcher X Pick the launcher by file name or path when auto-detection finds several
  --icon FILE  PNG to use (default: the 1024 px icon shipped with this plugin)
  --dry-run    Show what would happen, change nothing
  --report     Emit one machine-readable icon status line; diagnostics go to stderr
  --replace-custom  Explicitly replace/restore only Icon= in a user launcher, preserving its other fields
  -h, --help   This text
EOF
}

self_dir() {
  _p=$1
  while [ -h "$_p" ]; do
    _d=$(cd "$(dirname "$_p")" && pwd -P)
    _l=$(readlink "$_p")
    case $_l in
      /*) _p=$_l ;;
      *) _p=$_d/$_l ;;
    esac
  done
  (cd "$(dirname "$_p")" && pwd -P)
}

HERE=$(self_dir "$0")

# ---- arguments ---------------------------------------------------------------------------

CMD=
LAUNCHER=
OWN_ICON=$(cd "$HERE/.." 2>/dev/null && pwd -P)/assets/icon/claude-sama-1024.png
ICON=$OWN_ICON
DRY=0
REPLACE_CUSTOM=0

while [ $# -gt 0 ]; do
  case $1 in
    apply | clear | status)
      [ -z "$CMD" ] || die "only one of apply, clear, status at a time"
      CMD=$1
      ;;
    --launcher)
      [ $# -ge 2 ] || die "--launcher needs a value"
      LAUNCHER=$2
      shift
      ;;
    --launcher=*) LAUNCHER=${1#--launcher=} ;;
    --icon)
      [ $# -ge 2 ] || die "--icon needs a file"
      ICON=$2
      shift
      ;;
    --icon=*) ICON=${1#--icon=} ;;
    --dry-run) DRY=1 ;;
    --report) REPORT=1 ;;
    --replace-custom) REPLACE_CUSTOM=1 ;;
    -h | --help | help)
      usage
      exit 0
      ;;
    *)
      warn "unknown argument: $1"
      usage >&2
      exit 2
      ;;
  esac
  shift
done

if [ -z "$CMD" ]; then
  usage >&2
  exit 2
fi
if [ "$REPORT" -eq 1 ]; then exec 1>&2; fi

cleanup() {
  [ -z "$WORK_TEMP" ] || rm -f "$WORK_TEMP"
  if [ "$REPORT" -eq 1 ] && [ "$REPORTED" -eq 0 ]; then
    printf 'icon: unknown\n' >&3
  fi
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

if [ "$(uname -s)" != Linux ] && [ "$DRY" -eq 0 ] && [ -z "${CLAUDE_SAMA_ALLOW_ANY_OS:-}" ]; then
  die "this script is for Linux; on macOS use icon-macos.sh (add --dry-run to preview here)"
fi

[ -n "${HOME:-}" ] || die "HOME is not set"

# ---- locations ---------------------------------------------------------------------------

case ${XDG_DATA_HOME:-} in
  /*) DATA_HOME=$XDG_DATA_HOME ;;
  *) DATA_HOME=$HOME/.local/share ;;
esac
USER_APPS=$DATA_HOME/applications
ICON_DIR=$DATA_HOME/claude-sama/icons
ICON_COPY=$ICON_DIR/claude-sama.png

# Directories that can hold launchers, highest priority first, one per line.
search_dirs() {
  printf '%s\n' "$USER_APPS"
  _xdd=${XDG_DATA_DIRS:-/usr/local/share:/usr/share}
  _old=$IFS
  IFS=:
  # shellcheck disable=SC2086  # splitting on ':' is the point
  set -- $_xdd
  IFS=$_old
  for _x in "$@"; do
    [ -n "$_x" ] && printf '%s\n' "${_x%/}/applications"
  done
  printf '%s\n' /usr/share/applications
}

is_ours() { [ -f "$1" ] && grep -q "^$MARK" "$1" 2>/dev/null; }

# Print the path of every launcher that looks like the Claude desktop app, one per line.
# A file name is reported once (the highest priority copy), so a user copy shadows a system one.
# Files this script wrote are skipped, so the packaged original is still found.
list_candidates() {
  _seen='
'
  search_dirs | while IFS= read -r _dir; do
    [ -d "$_dir" ] || continue
    for _f in "$_dir"/*.desktop; do
      [ -f "$_f" ] || continue
      _b=${_f##*/}
      if is_ours "$_f"; then continue; fi
      case $_seen in *"
$_b
"*) continue ;; esac
      _seen="$_seen$_b
"
      case $_b in claude-code-url-handler.desktop) continue ;; esac
      grep -Eiq '^(Name|Exec)=.*claude' "$_f" || continue
      grep -Eq '^Type=Application' "$_f" || continue
      if grep -Eiq '^(NoDisplay|Hidden|Terminal)=true' "$_f"; then continue; fi
      printf '%s\n' "$_f"
    done
  done
}

# Set LAUNCHER_SRC to the launcher to base the override on, or exit with advice.
pick_launcher() {
  LAUNCHER_SRC=
  if [ -n "$LAUNCHER" ]; then
    case $LAUNCHER in
      */*)
        [ -f "$LAUNCHER" ] || die "launcher not found: $LAUNCHER"
        LAUNCHER_SRC=$LAUNCHER
        ;;
      *)
        _want=$LAUNCHER
        case $_want in *.desktop) ;; *) _want=$_want.desktop ;; esac
        _dirs=$(search_dirs)
        _oldifs=$IFS
        IFS='
'
        set -f
        _fallback=
        for _dir in $_dirs; do
          if [ -f "$_dir/$_want" ]; then
            if is_ours "$_dir/$_want"; then
              [ -n "$_fallback" ] || _fallback=$_dir/$_want
            else
              LAUNCHER_SRC=$_dir/$_want
              break
            fi
          fi
        done
        set +f
        IFS=$_oldifs
        [ -n "$LAUNCHER_SRC" ] || LAUNCHER_SRC=$_fallback
        [ -n "$LAUNCHER_SRC" ] || die "launcher $_want not found in the XDG application folders"
        ;;
    esac
    return 0
  fi

  _cands=$(list_candidates)
  # An already-managed launcher still has an effective icon after the packaged entry disappears.
  if [ -z "$_cands" ] && [ -d "$USER_APPS" ]; then
    _cands=$(
      for _f in "$USER_APPS"/*.desktop; do
        is_ours "$_f" || continue
        grep -Eiq '^(Name|Exec)=.*claude' "$_f" || continue
        printf '%s\n' "$_f"
      done
    )
  fi
  if [ -z "$_cands" ]; then
    warn "no Claude desktop launcher found in:"
    search_dirs | sed 's/^/  /' >&2
    warn "is the Claude desktop app installed? If its launcher has another name, pass --launcher."
    exit 2
  fi
  _n=$(printf '%s\n' "$_cands" | wc -l | tr -d ' ')
  if [ "$_n" -eq 1 ]; then
    LAUNCHER_SRC=$_cands
    return 0
  fi
  # Several candidates: take a well-known name if one is among them.
  for _pref in claude-desktop.desktop claude.desktop Claude.desktop; do
    _hit=$(printf '%s\n' "$_cands" | grep "/$_pref\$" | head -n 1 || true)
    if [ -n "$_hit" ]; then
      LAUNCHER_SRC=$_hit
      return 0
    fi
  done
  warn "several launchers look like Claude; pick one with --launcher NAME.desktop:"
  printf '%s\n' "$_cands" | sed 's/^/  /' >&2
  exit 2
}

# Print the Icon= value of the [Desktop Entry] group of file $1 (empty if none).
icon_of() {
  awk '
    /^\[/ { sect = substr($0, 2, length($0) - 2); next }
    sect == "Desktop Entry" && /^Icon=/ { print substr($0, 6); exit }
  ' "$1"
}

# Replace only the main Icon= value; keep all other launcher fields/comments. Strip only this
# script's management comments, so an in-place restoration ceases to be a managed override.
render_icon_body() {
    ICONPATH=$2 awk '
      BEGIN { sect = ""; done = 0 }
      /^# claude-sama-icon-(override|preserve-launcher):/ { next }
      /^\[/ {
        if (sect == "Desktop Entry" && !done) { print "Icon=" ENVIRON["ICONPATH"]; done = 1 }
        sect = substr($0, 2, length($0) - 2)
      }
      sect == "Desktop Entry" && /^Icon=/ {
        if (!done) { print "Icon=" ENVIRON["ICONPATH"]; done = 1 }
        next
      }
      { print }
      END { if (sect == "Desktop Entry" && !done) print "Icon=" ENVIRON["ICONPATH"] }
    ' "$1"
}

# Preserve markers are explicit launcher-management policy, never proof of image ownership.
render_override() {
  {
    printf '%s\n' "$MARK_LINE"
    if [ "${3:-0}" -eq 1 ]; then printf '%s kept in place on clear\n' "$PRESERVE_MARK"; fi
    render_icon_body "$1" "$2"
  }
}

find_packaged_launcher() {
  _package_name=$1
  search_dirs | while IFS= read -r _package_dir; do
    [ "$_package_dir" != "$USER_APPS" ] || continue
    if [ -r "$_package_dir/$_package_name" ] && ! is_ours "$_package_dir/$_package_name"; then
      printf '%s\n' "$_package_dir/$_package_name"
      exit 0
    fi
  done
}

restore_launcher_in_place() {
  _restore_target=$1
  _package=$(find_packaged_launcher "${_restore_target##*/}")
  if [ -z "$_package" ]; then
    warn "keeping $_restore_target: no packaged original launcher exists to restore its Icon= value"
    return 1
  fi
  _stock_value=$(icon_of "$_package") || return 1
  if [ "$DRY" -eq 1 ]; then
    say "[dry-run] would restore Icon=${_stock_value:-(none set)} in $_restore_target, preserving other launcher fields"
    return 0
  fi
  WORK_TEMP=$(mktemp "$USER_APPS/.claude-sama.XXXXXX") || return 1
  render_icon_body "$_restore_target" "$_stock_value" >"$WORK_TEMP" || return 1
  chmod 644 "$WORK_TEMP" || return 1
  mv "$WORK_TEMP" "$_restore_target" || return 1
  WORK_TEMP=
  say "Restored packaged Icon= in $_restore_target (other launcher fields kept)."
}

refresh_db() {
  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$USER_APPS" >/dev/null 2>&1 || warn "update-desktop-database failed (harmless)"
  fi
}

# Pick a tool that can scale a PNG to 512 px: sets RESIZER to magick, convert, sips, python or none.
pick_resizer() {
  if command -v magick >/dev/null 2>&1; then
    RESIZER=magick
  elif command -v convert >/dev/null 2>&1; then
    RESIZER=convert
  elif command -v sips >/dev/null 2>&1; then
    RESIZER=sips
  elif command -v python3 >/dev/null 2>&1 && python3 -c 'import PIL' >/dev/null 2>&1; then
    RESIZER=python
  else
    RESIZER=none
  fi
}

# make_icon_copy SRC DEST: write a 512 px PNG to DEST with the picked tool; if there is none, or it
# fails, copy SRC as it is. Sets COPY_NOTE to a short description of what happened.
make_icon_copy() {
  _src=$1
  _dst=$2
  case $RESIZER in
    magick) magick "$_src" -resize 512x512 "$_dst" >/dev/null 2>&1 && { COPY_NOTE="scaled to 512 px with ImageMagick"; return 0; } ;;
    convert) convert "$_src" -resize 512x512 "$_dst" >/dev/null 2>&1 && { COPY_NOTE="scaled to 512 px with ImageMagick"; return 0; } ;;
    sips) sips -z 512 512 "$_src" --out "$_dst" >/dev/null 2>&1 && { COPY_NOTE="scaled to 512 px with sips"; return 0; } ;;
    python)
      python3 -c 'import sys; from PIL import Image; Image.open(sys.argv[1]).convert("RGBA").resize((512, 512), Image.LANCZOS).save(sys.argv[2])' \
        "$_src" "$_dst" >/dev/null 2>&1 && { COPY_NOTE="scaled to 512 px with Pillow"; return 0; }
      ;;
  esac
  cp "$_src" "$_dst"
  COPY_NOTE="copied as it is (no resize tool found or it failed)"
}

# Compare actual pixels, not a stale marker or receipt. An unscaled byte-identical copy also
# works without an image tool. For scaled copies, compare the shipped image using each available
# supported resizer, in memory. Exact pixel comparison deliberately rejects modified artwork.
# sips cannot emit a PNG to stdout; a sips-only environment cannot verify a resized copy and is
# unknown. All comparisons are read-only, including status and dry-run.
copy_matches_own() {
  [ -r "$ICON_COPY" ] && [ -r "$OWN_ICON" ] || return 2
  cmp -s "$ICON_COPY" "$OWN_ICON" && return 0
  _compared=0
  for _tool in magick convert; do
    command -v "$_tool" >/dev/null 2>&1 || continue
    # ImageMagick's pixel signature keeps full pixel arrays out of shell variables. Include
    # dimensions as well. Round-trip the candidate through PNG in memory, matching apply's
    # quantization without creating any status-time files.
    _actual=$("$_tool" "$ICON_COPY" -alpha on -depth 8 -format '%wx%h:%[signature]' info: 2>/dev/null) || continue
    _original=$("$_tool" "$OWN_ICON" -alpha on -depth 8 -format '%wx%h:%[signature]' info: 2>/dev/null) || continue
    [ -n "$_actual" ] && [ -n "$_original" ] || continue
    _compared=1
    [ "$_actual" != "$_original" ] || return 0
    _expected=$("$_tool" "$OWN_ICON" -resize 512x512 png:- 2>/dev/null |
      "$_tool" - -alpha on -depth 8 -format '%wx%h:%[signature]' info: 2>/dev/null) || continue
    [ -n "$_expected" ] || continue
    _compared=1
    [ "$_actual" != "$_expected" ] || return 0
  done
  if command -v python3 >/dev/null 2>&1; then
    if python3 -c '
import sys
try:
    from PIL import Image
    with Image.open(sys.argv[1]) as f: actual = f.convert("RGBA")
    with Image.open(sys.argv[2]) as f: expected = f.convert("RGBA")
    candidates = [expected, expected.resize((512, 512), Image.LANCZOS)]
    sys.exit(0 if any(actual.size == c.size and actual.tobytes() == c.tobytes() for c in candidates) else 1)
except Exception:
    sys.exit(2)
' "$ICON_COPY" "$OWN_ICON" 2>/dev/null; then
      return 0
    else
      _python_result=$?
      [ "$_python_result" -ne 1 ] || _compared=1
    fi
  fi
  [ "$_compared" -eq 0 ] || return 1
  return 2
}

# Identify the effective launcher by XDG precedence, including another user override. Selecting
# the packaged source does not by itself prove it is the desktop entry currently in use.
icon_state() {
  LAUNCHER_SRC=
  # pick_launcher can fail or exit; contain it in a subshell and keep the report channel private.
  _source=$( (pick_launcher; printf '%s\n' "$LAUNCHER_SRC") 3>/dev/null 2>/dev/null) || {
    say unknown
    return
  }
  _name=${_source##*/}
  _effective=
  _dirs=$(search_dirs)
  _oldifs=$IFS
  IFS='
'
  set -f
  for _dir in $_dirs; do
    if [ -f "$_dir/$_name" ]; then _effective=$_dir/$_name; break; fi
  done
  set +f
  IFS=$_oldifs
  [ -n "$_effective" ] || { say unknown; return; }
  [ -r "$_effective" ] || { say unknown; return; }
  if is_ours "$_effective"; then
    _actual_icon=$(icon_of "$_effective") || { say unknown; return; }
    if [ "$_actual_icon" != "$ICON_COPY" ]; then say custom; return; fi
    if copy_matches_own; then
      say own
    else
      _match_result=$?
      if [ "$_match_result" -eq 1 ]; then say custom; else say unknown; fi
    fi
  else
    case $_effective in
      "$USER_APPS"/*)
        _package=$(find_packaged_launcher "$_name")
        if [ -n "$_package" ] && [ "$(icon_of "$_effective")" = "$(icon_of "$_package")" ]; then
          say stock
        else
          say custom
        fi
        ;;
      *) say stock ;;
    esac
  fi
}

# ---- commands ----------------------------------------------------------------------------

do_status() {
  say "Applications folder: $USER_APPS"
  _own=
  if [ -d "$USER_APPS" ]; then
    for _f in "$USER_APPS"/*.desktop; do
      if is_ours "$_f"; then _own="$_own$_f
"; fi
    done
  fi
  if [ -n "$_own" ]; then
    printf '%s' "$_own" | while IFS= read -r _f; do
      say "Override:           $_f"
      say "  Icon=             $(icon_of "$_f")"
    done
    if [ -f "$ICON_COPY" ]; then
      say "Icon copy:          $ICON_COPY"
    else
      say "Icon copy:          missing ($ICON_COPY); run apply again"
    fi
  else
    say "Override:           none written by this script"
  fi
  say "State:              $(icon_state)"
  _cands=$(list_candidates)
  if [ -n "$_cands" ]; then
    say "Launcher(s) found:"
    printf '%s\n' "$_cands" | sed 's/^/  /'
  else
    say "Launcher(s) found:  none (is the Claude desktop app installed?)"
  fi
}

do_apply() {
  [ -f "$ICON" ] || die "icon file not found: $ICON"
  pick_launcher
  _name=${LAUNCHER_SRC##*/}
  _target=$USER_APPS/$_name
  _preserve=0
  if [ -e "$_target" ]; then
    if [ "$REPLACE_CUSTOM" -eq 1 ]; then
      _package=$(find_packaged_launcher "$_name")
      [ -n "$_package" ] || die "no packaged original launcher exists for $_name; keeping the user launcher unchanged"
      LAUNCHER_SRC=$_target
      _preserve=1
    elif ! is_ours "$_target" || [ "$(icon_of "$_target")" != "$ICON_COPY" ]; then
      die "$_target already exists and is a user override or has an edited Icon= line; not touching it. Edit its Icon= line yourself, or move it away and run apply again."
    elif grep -q "^$PRESERVE_MARK" "$_target"; then
      LAUNCHER_SRC=$_target
      _preserve=1
    fi
  fi
  say "Launcher:  $LAUNCHER_SRC"
  say "Override:  $_target"
  _cur=$(icon_of "$LAUNCHER_SRC")
  say "Icon now:  ${_cur:-(none set)}"
  pick_resizer
  case $RESIZER in
    none) say "Icon new:  $ICON_COPY  (copy of $ICON as it is: no resize tool found)" ;;
    *) say "Icon new:  $ICON_COPY  (512 px copy of $ICON, made with $RESIZER)" ;;
  esac
  if [ "$DRY" -eq 1 ]; then
    say "[dry-run] would copy the icon, write the override and run update-desktop-database if present. Nothing was changed."
    return 0
  fi
  mkdir -p "$USER_APPS" "$ICON_DIR"
  make_icon_copy "$ICON" "$ICON_COPY"
  chmod 644 "$ICON_COPY"
  say "Icon copy: $COPY_NOTE"
  _tmp=$(mktemp "$USER_APPS/.claude-sama.XXXXXX")
  WORK_TEMP=$_tmp
  render_override "$LAUNCHER_SRC" "$ICON_COPY" "$_preserve" >"$_tmp"
  chmod 644 "$_tmp"
  mv "$_tmp" "$_target"
  WORK_TEMP=
  refresh_db
  say "Done. Restart the Claude app (and, on some desktops, log out and in) to see the new icon."
  if [ "$_preserve" -eq 1 ]; then
    say "Restore the packaged icon with: $PROG clear --replace-custom"
  else
    say "Undo with: $PROG clear"
  fi
}

do_clear() {
  _found=0
  _retained=0
  _clear_name=
  if [ "$REPLACE_CUSTOM" -eq 1 ]; then
    pick_launcher
    _clear_name=${LAUNCHER_SRC##*/}
  fi
  if [ -d "$USER_APPS" ]; then
    for _f in "$USER_APPS"/*.desktop; do
      [ -f "$_f" ] || continue
      if [ "$REPLACE_CUSTOM" -eq 1 ]; then
        [ "${_f##*/}" = "$_clear_name" ] || continue
      else
        is_ours "$_f" || continue
      fi
      if [ -n "$LAUNCHER" ]; then
        _want=${LAUNCHER##*/}
        case $_want in *.desktop) ;; *) _want=$_want.desktop ;; esac
        [ "${_f##*/}" = "$_want" ] || continue
      fi
      if [ "$REPLACE_CUSTOM" -eq 1 ]; then
        if restore_launcher_in_place "$_f"; then _found=1; else _retained=1; fi
        continue
      fi
      if [ "$(icon_of "$_f")" != "$ICON_COPY" ] || grep -q "^$PRESERVE_MARK" "$_f"; then
        warn "keeping $_f: its Icon= line was edited; the original icon was not restored"
        _retained=1
        continue
      fi
      _found=1
      if [ "$DRY" -eq 1 ]; then
        say "[dry-run] would remove $_f"
      else
        rm -f "$_f"
        say "Removed $_f"
      fi
    done
  fi
  if [ "$_found" -eq 0 ] && [ "$_retained" -eq 0 ]; then
    say "No override written by this script was found in $USER_APPS; nothing to clear."
  fi
  # Remove the PNG copy once no override of ours is left.
  _left=0
  if [ -d "$USER_APPS" ]; then
    for _f in "$USER_APPS"/*.desktop; do
      if is_ours "$_f"; then _left=1; fi
    done
  fi
  if [ "$DRY" -eq 1 ]; then
    [ -f "$ICON_COPY" ] && say "[dry-run] would remove $ICON_COPY once no override remains"
    return 0
  fi
  if [ "$_left" -eq 0 ] && [ "$_retained" -eq 0 ] && [ -f "$ICON_COPY" ]; then
    rm -f "$ICON_COPY"
    rmdir "$ICON_DIR" "${ICON_DIR%/icons}" 2>/dev/null || true
    say "Removed $ICON_COPY"
  fi
  if [ "$_found" -eq 1 ]; then
    refresh_db
    [ "$_retained" -eq 1 ] || say "Done. The packaged icon is back (restart the app to see it)."
  fi
  if [ "$_retained" -eq 1 ]; then
    if [ "$REPORT" -eq 1 ]; then
      printf 'icon: %s\n' "$(icon_state)" >&3
      REPORTED=1
    fi
    return 1
  fi
}

case $CMD in
  status) [ "$REPORT" -eq 1 ] || do_status ;;
  apply) do_apply ;;
  clear) do_clear ;;
esac

if [ "$REPORT" -eq 1 ]; then
  _reported_state=$(icon_state)
  printf 'icon: %s\n' "$_reported_state" >&3
  REPORTED=1
  [ "$_reported_state" != unknown ] || exit 1
fi
