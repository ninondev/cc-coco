#!/bin/sh
# icon-linux.sh - give the Claude desktop app the Coco icon on Linux.
#
# Usage: icon-linux.sh apply | clear | status [--launcher NAME.desktop|PATH] [--choice NAME] [--icon FILE] [--dry-run]
#
# How it works (standard freedesktop behaviour, nothing is installed system-wide):
#   apply   Finds the Claude desktop launcher, a *.desktop file whose Name or Exec mentions
#           "claude" (searched in ~/.local/share/applications, $XDG_DATA_DIRS and
#           /usr/share/applications). It writes a same-named copy into
#           ~/.local/share/applications with Icon= pointing at the Coco PNG. A launcher in
#           your home directory shadows the packaged one, and package updates do not touch it.
#           The PNG is copied to ~/.local/share/coco/icons/coco.png first, so the path
#           stays valid when the plugin itself is updated or moved. The reviewed 512 px PNG is copied as it is.
#   clear   Removes only the override files this script wrote (they carry a marker comment on
#           the first line) and the PNG copy. Edited Icon= lines and adopted user launchers are
#           retained. With explicit --replace-custom, restore only the packaged Icon= in place.
#   status  Reads the effective launcher and verifies the current image (never writes).
#
# Options
#   --launcher X   Use this launcher (a file name such as claude-desktop.desktop, or a full path).
#                  Needed only when more than one launcher looks like Claude.
#   --choice NAME  Which of the four pictures: coco (the default), dake, keycap or ornament. Status counts
#                  any of the four as own, and the badge of earlier builds as legacy.
#   --icon FILE    PNG to use. Default: ../assets/icon/claude-tile-NAME-512.png for the --choice.
#   --dry-run      Show what would be written, change nothing.
#   --report       Emit exactly icon: own|legacy|stock|custom|unknown; diagnostics go to stderr.
#   --replace-custom  Explicitly opt in to changing only a user's launcher Icon= value.
#
# A running app may keep showing its old icon until it is restarted (some desktops also want a
# log out and in). This script makes no network calls and needs no root.
# Testing aid: COCO_ALLOW_ANY_OS=1 lets it run on a non-Linux system against fake XDG dirs.
# License: MIT. Part of Coco, an unofficial fan skin. Claude is a trademark of Anthropic.

set -eu
PATH=/usr/bin:/bin:/usr/sbin:/sbin
export PATH
LC_ALL=C
export LC_ALL

PROG=icon-linux.sh
MARK='# coco-icon-override:'
MARK_LINE=
PRESERVE_MARK='# coco-icon-preserve-launcher:'
REPORT=0
RESTORE_KEY=0
REPORTED=0
WORK_TEMP=
WORK_ICON=
WORK_PNG=
exec 3>&1
for _argument in "$@"; do [ "$_argument" != --report ] || REPORT=1; done
if [ "$REPORT" -eq 1 ]; then exec 1>&2; fi
report_fallback() {
  if [ "$REPORT" -eq 1 ] && [ "$REPORTED" -eq 0 ]; then printf 'icon: unknown\n' >&3; fi
}
trap report_fallback EXIT

say() { printf '%s\n' "$*"; }
# There is no approved diagnostic slot for manual errors; reports retain unknown.
warn() { [ "$*" != "${ICON_S9:-}" ] || printf '%s\n' "$ICON_S9" >&2; }
die() {
  warn unknown
  if [ "$REPORT" -eq 1 ] && [ "$REPORTED" -eq 0 ]; then
    printf 'icon: unknown\n' >&3
    REPORTED=1
  fi
  exit 2
}

OWNER_UID=$(/usr/bin/id -u) || die unknown
# Select only the OS stat syntax; metadata is never cached between guards.
if /usr/bin/stat -c '%u:%h' / >/dev/null 2>&1; then
  STAT_STYLE=gnu
elif /usr/bin/stat -f '%u:%l' / >/dev/null 2>&1; then
  STAT_STYLE=bsd
else
  die unknown
fi

# Conservative shell no-follow checks. Root-owned system ancestors are allowed;
# writable ancestors require root's sticky bit. Every destination folder is ours.
# These checks and same-folder atomic replacements do not provide descriptor-level
# protection against a hostile same-UID directory swap between shell operations.
file_metadata() {
  case $STAT_STYLE in
    gnu) /usr/bin/stat -c '%u:%h' "$1" ;;
    bsd) /usr/bin/stat -f '%u:%l' "$1" ;;
  esac
}
directory_metadata() {
  case $STAT_STYLE in
    gnu) /usr/bin/stat -c '%u:%a' "$@" ;;
    # Full mode keeps BSD's sticky bit; %Lp loses it.
    bsd) /usr/bin/stat -f '%u:%p' "$@" ;;
  esac
}
check_ancestors() (
  _guard_path=$1
  case $_guard_path in /*) ;; *) exit 1 ;; esac
  case $_guard_path in *//*|*/./*|*/../*|*/.|*/..) exit 1 ;; esac
  set --
  while :; do
    [ ! -L "$_guard_path" ] || exit 1
    if [ -e "$_guard_path" ]; then
      [ -d "$_guard_path" ] || exit 1
      set -- "$@" "$_guard_path"
    fi
    [ "$_guard_path" != / ] || break
    _guard_path=${_guard_path%/*}
    [ -n "$_guard_path" ] || _guard_path=/
  done
  # All current ancestors are stat'ed anew, in one quoted, format-only batch.
  # Validate every row and its count; no filename or cached identity is parsed.
  _guard_rows=$(directory_metadata "$@") || exit 1
  _guard_count=0
  while IFS= read -r _guard_meta; do
    _guard_count=$((_guard_count+1))
    _guard_uid=${_guard_meta%%:*}
    _guard_mode=${_guard_meta#*:}
    [ "$_guard_uid" = "$OWNER_UID" ] || [ "$_guard_uid" = 0 ] || exit 1
    if [ "$((0$_guard_mode & 0022))" -ne 0 ]; then
      [ "$_guard_uid" = 0 ] && [ "$((0$_guard_mode & 01000))" -ne 0 ] || exit 1
    fi
  done <<EOF_GUARD_ROWS
$_guard_rows
EOF_GUARD_ROWS
  [ "$_guard_count" -eq "$#" ]
)
check_directory() (
  check_ancestors "$1" || exit 1
  if [ -e "$1" ]; then
    _guard_meta=$(directory_metadata "$1") || exit 1
    [ "${_guard_meta%%:*}" = "$OWNER_UID" ] || exit 1
  fi
)
check_file() (
  check_directory "${1%/*}" || exit 1
  [ ! -L "$1" ] || exit 1
  if [ -e "$1" ]; then
    [ -f "$1" ] || exit 1
    _guard_meta=$(file_metadata "$1") || exit 1
    [ "$_guard_meta" = "$OWNER_UID:1" ] || exit 1
  fi
)
prepare_directory() (
  check_directory "$1" || exit 1
  if [ ! -d "$1" ]; then
    prepare_directory "${1%/*}" || exit 1
    /bin/mkdir -m 700 "$1" || exit 1
  fi
  check_directory "$1"
)
guard_file() { check_file "$1" || die unknown; }
guard_destinations() {
  check_directory "$USER_APPS" && check_directory "$ICON_DIR" || die unknown
  guard_file "$ICON_COPY"
  guard_file "$CONSENT_FILE"
  guard_file "$AUTO_BLOCK_FILE"
}
release_state() {
  if [ "$REVOKE_CONSENT" -eq 1 ]; then
    guard_file "$CONSENT_FILE"
    /bin/rm -f "$CONSENT_FILE"
  fi
  guard_file "$AUTO_BLOCK_FILE"
  /bin/rm -f "$AUTO_BLOCK_FILE"
}
remove_work_file() {
  [ -n "$1" ] || return 0
  check_file "$1" || return 0
  /bin/rm -f "$1"
}

usage() {
  printf '%s\n' "$ICON_S19"
  printf '%s\n' "$PROG apply|clear|status [--launcher NAME.desktop|PATH] [--icon FILE] [--replace-custom] [--dry-run] [--report]"
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
. "$HERE/../assets/icon/words.sh"
MARK_LINE=$MARK

# ---- arguments ---------------------------------------------------------------------------

CMD=
LAUNCHER=
ICON_ASSETS=$(cd "$HERE/.." 2>/dev/null && pwd -P)/assets/icon
CHOICE=coco
OWN_ICON=
ICON=
EXPLICIT_ICON=0
DRY=0
REVOKE_CONSENT=0
REPLACE_CUSTOM=0

while [ $# -gt 0 ]; do
  case $1 in
    apply | clear | status)
      [ -z "$CMD" ] || die unknown
      CMD=$1
      ;;
    --launcher)
      [ $# -ge 2 ] || die unknown
      LAUNCHER=$2
      shift
      ;;
    --launcher=*) LAUNCHER=${1#--launcher=} ;;
    --icon)
      [ $# -ge 2 ] || die unknown
      ICON=$2
      EXPLICIT_ICON=1
      shift
      ;;
    --icon=*) ICON=${1#--icon=}; EXPLICIT_ICON=1 ;;
    --choice)
      [ $# -ge 2 ] || die unknown
      CHOICE=$2
      shift
      ;;
    --choice=*) CHOICE=${1#--choice=} ;;
    --dry-run) DRY=1 ;;
    --revoke-consent) REVOKE_CONSENT=1 ;;
    --report) REPORT=1 ;;
    --restore-key) RESTORE_KEY=1 ;;
    --replace-custom) REPLACE_CUSTOM=1 ;;
    -h | --help | help)
      usage
      exit 0
      ;;
    *)
      warn unknown
      usage >&2
      exit 2
      ;;
  esac
  shift
done

# Only the four reviewed pictures can be chosen; the name never becomes a free path.
case $CHOICE in
  coco | dake | keycap | ornament) ;;
  *) die unknown ;;
esac
OWN_ICON=$ICON_ASSETS/claude-tile-$CHOICE-512.png
[ "$EXPLICIT_ICON" -eq 1 ] || ICON=$OWN_ICON

if [ -z "$CMD" ]; then
  usage >&2
  exit 2
fi
if [ "$REPORT" -eq 1 ]; then exec 1>&2; fi

if [ "$RESTORE_KEY" -eq 1 ] && { [ "$CMD" != status ] || [ "$REPORT" -ne 1 ]; }; then
  die unknown
fi

case ${XDG_STATE_HOME:-} in
  /*) STATE_HOME=$XDG_STATE_HOME ;;
  *) STATE_HOME=$HOME/.local/state ;;
esac
CONSENT_FILE="${COCO_ICON_CONSENT_FILE:-$STATE_HOME/coco/app-icon-consent}"
if [ "$REVOKE_CONSENT" -eq 1 ]; then
  [ "$CMD" = clear ] || die "$ICON_S19"
fi
if [ "$CMD" = apply ] && [ "$DRY" -eq 0 ]; then
  guard_file "$CONSENT_FILE"
  [ -r "$CONSENT_FILE" ] && [ "$(cat "$CONSENT_FILE")" = on ] || die "$ICON_S9"
fi
# An explicit permitted action releases the conservative automatic-attempt block.
AUTO_BLOCK_FILE="${CONSENT_FILE%/*}/app-icon-auto-block"

cleanup() {
  remove_work_file "$WORK_TEMP"
  remove_work_file "$WORK_ICON"
  [ -z "$WORK_PNG" ] || rm -rf "$WORK_PNG"
  if [ "$REPORT" -eq 1 ] && [ "$REPORTED" -eq 0 ]; then
    printf 'icon: unknown\n' >&3
  fi
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

if [ "$(uname -s)" != Linux ] && [ "$DRY" -eq 0 ] && [ -z "${COCO_ALLOW_ANY_OS:-}" ]; then
  die unknown
fi

[ -n "${HOME:-}" ] || die unknown

# ---- locations ---------------------------------------------------------------------------

case ${XDG_DATA_HOME:-} in
  /*) DATA_HOME=$XDG_DATA_HOME ;;
  *) DATA_HOME=$HOME/.local/share ;;
esac
USER_APPS=$DATA_HOME/applications
ICON_DIR=$DATA_HOME/coco/icons
ICON_COPY=$ICON_DIR/coco.png

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
        [ -f "$LAUNCHER" ] || die unknown
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
        [ -n "$LAUNCHER_SRC" ] || die unknown
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
    warn unknown
    search_dirs | sed 's/^/  /' >&2
    warn unknown
    exit 2
  fi
  _n=$(printf '%s\n' "$_cands" | wc -l | tr -d ' ')
  if [ "$_n" -eq 1 ]; then
    LAUNCHER_SRC=$_cands
    return 0
  fi
  # Several candidates: take a well-known name if one is among them, Anthropic's own Linux package first
  # (claude-desktop 2.42304.0 ships /usr/share/applications/com.anthropic.Claude.desktop).
  for _pref in com.anthropic.Claude.desktop claude-desktop.desktop claude.desktop Claude.desktop; do
    _hit=$(printf '%s\n' "$_cands" | grep "/$_pref\$" | head -n 1 || true)
    if [ -n "$_hit" ]; then
      LAUNCHER_SRC=$_hit
      return 0
    fi
  done
  warn unknown
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
    ICONPATH=$2 ICON_MANAGED_MARKERS="$(icon_managed_marker_lines)" awk '
      BEGIN {
        sect = ""; done = 0
        count = split(ENVIRON["ICON_MANAGED_MARKERS"], lines, "\n")
        for (i = 1; i <= count; i++) markers[lines[i]] = 1
      }
      /^# coco-icon-(override|preserve-launcher):/ { next }
      $0 in markers { next }
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
    printf '%s\n' "$MARK_LINE" "$ICON_S18"
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
    warn unknown
    return 1
  fi
  _stock_value=$(icon_of "$_package") || return 1
  if [ "$DRY" -eq 1 ]; then
    :
    return 0
  fi
  guard_file "$_restore_target"
  WORK_TEMP=$(/usr/bin/mktemp "$USER_APPS/.coco.XXXXXX") || return 1
  guard_file "$WORK_TEMP"
  render_icon_body "$_restore_target" "$_stock_value" >"$WORK_TEMP" || return 1
  guard_file "$WORK_TEMP"
  /bin/chmod 644 "$WORK_TEMP" || return 1
  guard_file "$_restore_target"
  /bin/mv -f "$WORK_TEMP" "$_restore_target" || return 1
  WORK_TEMP=
  :
}

refresh_db() {
  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$USER_APPS" >/dev/null 2>&1 || warn unknown
  fi
}

# The reviewed 512-pixel badge ships ready to copy. No decoder or resizer is needed.
make_icon_copy() {
  guard_file "$2"
  WORK_ICON=$(/usr/bin/mktemp "$ICON_DIR/.coco.XXXXXX") || return 1
  guard_file "$WORK_ICON"
  /bin/cp "$1" "$WORK_ICON" || return 1
  guard_file "$WORK_ICON"
  /bin/chmod 644 "$WORK_ICON" || return 1
  guard_file "$2"
  /bin/mv -f "$WORK_ICON" "$2" || return 1
  WORK_ICON=
}
copy_matches_own() {
  [ -r "$ICON_COPY" ] && [ -r "$OWN_ICON" ] || return 2
  cmp -s "$ICON_COPY" "$OWN_ICON" && return 0
  # Another of the four pictures is ours too.
  for _other in coco dake keycap ornament; do
    [ -r "$ICON_ASSETS/claude-tile-$_other-512.png" ] || continue
    if cmp -s "$ICON_COPY" "$ICON_ASSETS/claude-tile-$_other-512.png"; then return 0; fi
  done
  return 1
}
# The badge that builds before the four pictures put on is an earlier version's icon.
copy_matches_badge() {
  [ -r "$ICON_COPY" ] && [ -r "$ICON_ASSETS/claude-tile-512.png" ] && cmp -s "$ICON_COPY" "$ICON_ASSETS/claude-tile-512.png"
}

# Decode only for legacy migration. Bounds and Adler32 are checked by the helper;
# synthetic gzip CRC errors are expected, while incomplete decompression is rejected.
png_samples() {
  _input=$1
  _label=$2
  [ -r "$_input" ] || return 2
  _bytes=$(wc -c < "$_input" | tr -d " ")
  [ "$_bytes" -le 16777216 ] || return 2
  od -An -v -tu1 "$_input" | awk -v mode=extract -v meta="$WORK_PNG/$_label.meta" -f "$HERE/../assets/icon/png-compare.awk" > "$WORK_PNG/$_label.gz" || return 2
  _expected=$(awk '$1=="header" { channels=$4==6?4:($4==2?3:1);printf "%.0f",($2*channels+1)*$3 }' "$WORK_PNG/$_label.meta")
  [ -n "$_expected" ] || return 2
  # Bound even a malicious compressed stream before materializing its output.
  gzip -dc "$WORK_PNG/$_label.gz" 2>/dev/null | head -c "$((_expected+1))" > "$WORK_PNG/$_label.raw"
  od -An -v -tu1 "$WORK_PNG/$_label.raw" |
    awk -v mode=samples -v meta="$WORK_PNG/$_label.meta" -f "$HERE/../assets/icon/png-compare.awk" > "$WORK_PNG/$_label.samples" || return 2
  # Obtain a correct CRC/size footer from the bounded decoded bytes, then validate the
  # original deflate stream strictly (including trailing garbage) with the OS decoder.
  gzip -1 -n -c "$WORK_PNG/$_label.raw" | tail -c 8 > "$WORK_PNG/$_label.footer"
  _gzip_size=$(wc -c < "$WORK_PNG/$_label.gz" | tr -d " ")
  dd if="$WORK_PNG/$_label.footer" of="$WORK_PNG/$_label.gz" bs=1 seek="$((_gzip_size-8))" conv=notrunc 2>/dev/null || return 2
  gzip -t "$WORK_PNG/$_label.gz" 2>/dev/null || return 2

}
copy_matches_legacy() (
  [ -r "$ICON_COPY" ] || return 2
  cmp -s "$ICON_COPY" "$HERE/../assets/icon/recognise-0.1-source-1024.png" && return 0
  cmp -s "$ICON_COPY" "$HERE/../assets/icon/recognise-0.1-64.png" && return 0
  command -v gzip >/dev/null 2>&1 || return 2
  WORK_PNG=$(mktemp -d "${TMPDIR:-/tmp}/coco-icon-png.XXXXXX") || return 2
  trap '[ -z "$WORK_PNG" ] || rm -rf "$WORK_PNG"' EXIT
  trap 'exit 2' HUP INT TERM
  if ! png_samples "$ICON_COPY" actual || ! png_samples "$HERE/../assets/icon/recognise-0.1-64.png" legacy; then
    rm -rf "$WORK_PNG"; WORK_PNG=; return 2
  fi
  awk '
    NR==FNR { for(i=1;i<=4;i++)expected[FNR,i]=$i;next }
    { for(i=1;i<=4;i++){difference=$i-expected[FNR,i];if(difference<0)difference=-difference;sum+=difference} }
    END { if(FNR!=4096)exit 2;exit(sum/(4096*4)<=12?0:1) }
  ' "$WORK_PNG/legacy.samples" "$WORK_PNG/actual.samples"
  _legacy_match=$?
  rm -rf "$WORK_PNG"; WORK_PNG=
  return "$_legacy_match"
)

# Identify the effective launcher by XDG precedence, including another user override. Selecting
# the packaged source does not by itself prove it is the desktop entry currently in use.
# Return an opaque read-only snapshot. Device/inode identify replacement even at the same version.
# File metadata is checked around the content read; bundle-root dates change on icon presses.
restore_snapshot() (
  _restore_file=$1
  [ -r "$_restore_file" ] || exit 1
  _restore_identity=$(stat -c '%d:%i:%Y:%s' "$_restore_file" 2>/dev/null) ||
    _restore_identity=$(stat -f '%d:%i:%m:%z' "$_restore_file" 2>/dev/null) || exit 1
  _restore_content=$(cksum <"$_restore_file") || exit 1
  _restore_after=$(stat -c '%d:%i:%Y:%s' "$_restore_file" 2>/dev/null) ||
    _restore_after=$(stat -f '%d:%i:%m:%z' "$_restore_file" 2>/dev/null) || exit 1
  [ "$_restore_identity" = "$_restore_after" ] || exit 1
  _restore_digest=$(printf '%s\n' "$_restore_identity" "$_restore_content" | cksum) || exit 1
  set -- $_restore_digest
  printf '%s:%s\n' "$1" "$2"
)

stock_report() {
  say stock
  [ "$RESTORE_KEY" -eq 1 ] && [ -n "$2" ] || return 0
  _restore_last=$(restore_snapshot "$1") || return 0
  [ "$2" = "$_restore_last" ] || return 0
  printf 'restore-key: linux:%s\n' "$_restore_last"
}

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
  _restore_source=$_effective
  _restore_before=
  _package=
  if [ "$RESTORE_KEY" -eq 1 ]; then
    case $_effective in
      "$USER_APPS"/*) _package=$(find_packaged_launcher "$_name"); _restore_source=$_package ;;
    esac
    _restore_before=$(restore_snapshot "$_restore_source") || _restore_before=
  fi
  if is_ours "$_effective"; then
    _actual_icon=$(icon_of "$_effective") || { say unknown; return; }
    if [ "$_actual_icon" != "$ICON_COPY" ]; then say custom; return; fi
    if copy_matches_own; then
      say own
    else
      _match_result=$?
      if [ "$_match_result" -eq 1 ]; then
        if copy_matches_badge || copy_matches_legacy; then say legacy;
        else _legacy_result=$?; if [ "$_legacy_result" -eq 1 ]; then say custom; else say unknown; fi; fi
      else say unknown; fi
    fi
  else
    case $_effective in
      "$USER_APPS"/*)
        [ "$RESTORE_KEY" -eq 1 ] || _package=$(find_packaged_launcher "$_name")
        if [ -n "$_package" ] && [ "$(icon_of "$_effective")" = "$(icon_of "$_package")" ]; then
          stock_report "$_restore_source" "$_restore_before"
        else
          say custom
        fi
        ;;
      *) stock_report "$_restore_source" "$_restore_before" ;;
    esac
  fi
}

# ---- commands ----------------------------------------------------------------------------

do_status() {
  _st=$(icon_state)
  case $_st in
    own) printf '%s\n' "$ICON_S4" ;;
    legacy) printf '%s\n' "$ICON_S11" ;;
    stock) printf '%s\n' "$ICON_S1a" ;;
    custom|unknown) : ;;
  esac
}

do_apply() {
  [ -f "$ICON" ] || die unknown
  pick_launcher
  _name=${LAUNCHER_SRC##*/}
  _target=$USER_APPS/$_name
  if [ "$DRY" -eq 0 ]; then
    guard_destinations
    guard_file "$_target"
  fi
  _preserve=0
  if [ -e "$_target" ]; then
    if [ "$REPLACE_CUSTOM" -eq 1 ]; then
      _package=$(find_packaged_launcher "$_name")
      [ -n "$_package" ] || die unknown
      LAUNCHER_SRC=$_target
      _preserve=1
    elif ! is_ours "$_target" || [ "$(icon_of "$_target")" != "$ICON_COPY" ]; then
      die unknown
    elif grep -q "^$PRESERVE_MARK" "$_target"; then
      LAUNCHER_SRC=$_target
      _preserve=1
    fi
  fi
  :
  :
  _cur=$(icon_of "$LAUNCHER_SRC")
  :
  printf '%s\n' "$ICON_S10"
  if [ "$DRY" -eq 1 ]; then
    :
    return 0
  fi
  release_state
  prepare_directory "$USER_APPS" && prepare_directory "$ICON_DIR" || die unknown
  guard_file "$_target"
  make_icon_copy "$ICON" "$ICON_COPY"
  _tmp=$(/usr/bin/mktemp "$USER_APPS/.coco.XXXXXX")
  WORK_TEMP=$_tmp
  guard_file "$_tmp"
  render_override "$LAUNCHER_SRC" "$ICON_COPY" "$_preserve" >"$_tmp"
  guard_file "$_tmp"
  /bin/chmod 644 "$_tmp"
  guard_file "$_target"
  /bin/mv -f "$_tmp" "$_target"
  WORK_TEMP=
  refresh_db
  :
  if [ "$_preserve" -eq 1 ]; then
    :
  else
    :
  fi
}

do_clear() {
  if [ "$DRY" -eq 0 ]; then
    guard_destinations
    # Validate the whole existing destination set before clearing the first file.
    # This intentionally refuses unsafe unrelated desktop-entry leaves too.
    if [ -d "$USER_APPS" ]; then
      for _guard_entry in "$USER_APPS"/*.desktop; do
        [ -e "$_guard_entry" ] || [ -L "$_guard_entry" ] || continue
        guard_file "$_guard_entry"
      done
    fi
    release_state
  fi
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
        warn unknown
        _retained=1
        continue
      fi
      _found=1
      if [ "$DRY" -eq 1 ]; then
        :
      else
        guard_file "$_f"
        /bin/rm -f "$_f"
        :
      fi
    done
  fi
  if [ "$_found" -eq 0 ] && [ "$_retained" -eq 0 ]; then
    :
  fi
  # Remove the PNG copy once no override of ours is left.
  _left=0
  if [ -d "$USER_APPS" ]; then
    for _f in "$USER_APPS"/*.desktop; do
      if is_ours "$_f"; then _left=1; fi
    done
  fi
  if [ "$DRY" -eq 1 ]; then
    [ -f "$ICON_COPY" ] && :
    return 0
  fi
  if [ "$_left" -eq 0 ] && [ "$_retained" -eq 0 ] && [ -f "$ICON_COPY" ]; then
    guard_file "$ICON_COPY"
    /bin/rm -f "$ICON_COPY"
    check_directory "$ICON_DIR" && check_directory "${ICON_DIR%/icons}" || die unknown
    /bin/rmdir "$ICON_DIR" "${ICON_DIR%/icons}" 2>/dev/null || true
    :
  fi
  if [ "$_found" -eq 1 ]; then
    refresh_db
    [ "$_retained" -eq 1 ] || :
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
