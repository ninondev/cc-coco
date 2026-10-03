#!/bin/sh
# icon-macos.sh - give the Claude desktop app the Claude-sama icon (macOS only).
#
# Usage: icon-macos.sh apply | clear | status [--app PATH] [--icon FILE] [--refresh-dock] [--dry-run]
#
# What it does
#   apply   Builds an .icns from assets/icon/claude-sama-1024.png in a temp folder (sips and
#           iconutil, both part of macOS), sets it as the custom icon of the app, then deletes the
#           temp folder. The icon is set with the same macOS call Finder uses for "Get Info > paste
#           icon" (NSWorkspace setIcon:forFile:options:, reached through osascript / JXA).
#           Nothing is compiled, downloaded or sent anywhere.
#   clear   Removes the custom icon, so the app shows its stock icon again.
#   status  Reads the custom-icon markers and compares the current image (never writes).
#
# Options
#   --app PATH       App bundle to change. Default: /Applications/Claude.app
#   --icon FILE      Picture for apply: a PNG (turned into an .icns on the fly) or a ready .icns.
#                    Default: ../assets/icon/claude-sama-1024.png next to this script
#   --refresh-dock   After apply/clear, touch the bundle and restart the Dock so the new icon shows now
#   --dry-run        Print what would happen and change nothing
#   --report         Emit exactly icon: own|stock|custom|unknown; diagnostics go to stderr
#
# Known limit: macOS "App Management" may stop Terminal (or any app that is not the app's own
# developer) from modifying Claude.app. Running this from inside a Claude desktop Code session
# works, because that process belongs to the same developer. Otherwise open System Settings >
# Privacy & Security > App Management and switch on your terminal app, then run it again.
#
# Claude updates replace the app bundle and drop the custom icon; run `apply` again afterwards.
# License: MIT. Part of Claude-sama, an unofficial fan skin. Claude is a trademark of Anthropic.

set -eu

PROG=icon-macos.sh
DEFAULT_APP=/Applications/Claude.app
REPORT=0
REPORTED=0
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
Usage: $PROG apply | clear | status [--app PATH] [--icon FILE] [--refresh-dock] [--dry-run]

  apply           Set the Claude-sama icon on the Claude desktop app
  clear           Go back to the stock icon
  status          Show whether a custom icon is set (read only)

  --app PATH      App bundle to change (default: $DEFAULT_APP)
  --icon FILE     PNG or .icns for apply (default: the 1024 px PNG shipped with this plugin)
  --refresh-dock  Touch the bundle and restart the Dock afterwards
  --dry-run       Show what would happen, change nothing
  --report        Emit one machine-readable icon status line; diagnostics go to stderr
  -h, --help      This text

If apply or clear fails, macOS App Management is probably blocking this process.
Run the command from inside a Claude desktop Code session (it belongs to the same
developer as the app), or allow your terminal under System Settings > Privacy &
Security > App Management.
EOF
}

# Directory this script lives in, following symlinks (readlink exists on every macOS).
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
CR=$(printf '\r')

# ---- arguments ---------------------------------------------------------------------------

CMD=
APP=$DEFAULT_APP
OWN_ICON=$(cd "$HERE/.." 2>/dev/null && pwd -P)/assets/icon/claude-sama-1024.png
ICON=$OWN_ICON
DRY=0
DOCK=0

while [ $# -gt 0 ]; do
  case $1 in
    apply | clear | status)
      [ -z "$CMD" ] || die "only one of apply, clear, status at a time"
      CMD=$1
      ;;
    --app)
      [ $# -ge 2 ] || die "--app needs a path"
      APP=$2
      shift
      ;;
    --app=*) APP=${1#--app=} ;;
    --icon)
      [ $# -ge 2 ] || die "--icon needs a file"
      ICON=$2
      shift
      ;;
    --icon=*) ICON=${1#--icon=} ;;
    --refresh-dock) DOCK=1 ;;
    --dry-run) DRY=1 ;;
    --report) REPORT=1 ;;
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

# ---- preconditions -----------------------------------------------------------------------

[ "$(uname -s)" = Darwin ] || die "this script is for macOS; on Linux use icon-linux.sh"
command -v osascript >/dev/null 2>&1 || die "osascript not found (it ships with macOS)"

# Tidy a trailing slash so messages and the Icon file path are clean.
case $APP in
  /) die "refusing to use / as the app path" ;;
  */) APP=${APP%/} ;;
esac

case $APP in
  *.app) ;;
  *) die "not an app bundle (name must end in .app): $APP" ;;
esac
[ -d "$APP" ] || die "app not found: $APP (use --app PATH if it lives elsewhere)"
[ -f "$APP/Contents/Info.plist" ] || die "not a macOS app bundle (no Contents/Info.plist): $APP"

if [ "$CMD" = apply ]; then
  [ -f "$ICON" ] || die "icon file not found: $ICON"
fi

# ---- helpers (read only) -----------------------------------------------------------------

app_version() {
  /usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist" 2>/dev/null || say unknown
}

# Prints yes/no/unknown. A denied read is not evidence that the stock icon is active.
finder_flag() {
  _attrs=$(xattr "$APP" 2>/dev/null) || { say unknown; return; }
  if ! printf '%s\n' "$_attrs" | grep -qx com.apple.FinderInfo; then
    say no
    return
  fi
  _hex=$(xattr -px com.apple.FinderInfo "$APP" 2>/dev/null) || { say unknown; return; }
  _hex=$(printf '%s' "$_hex" | tr -d ' \n')
  _byte=$(printf '%s' "$_hex" | cut -c17-18)
  case $_byte in
    [0-9a-fA-F][0-9a-fA-F]) ;;
    *) say unknown; return ;;
  esac
  if [ -n "$_byte" ] && [ $((0x$_byte & 4)) -ne 0 ]; then
    say yes
  else
    say no
  fi
}

# Prints yes/no: is the "Icon\r" file that stores the custom icon present at the bundle root?
icon_file() {
  if [ -e "$APP/Icon$CR" ]; then say yes; else say no; fi
}

# Prints own/stock/custom/unknown. Never trusts an installation receipt: compare the current
# NSWorkspace image with the shipped picture, rendered by AppKit at 1024 px. Exact comparison
# is conservative: rendering differences can yield custom, but another image cannot pass by
# retaining old metadata. The bundled picture stays authoritative even with --icon FILE.
icon_state() {
  _flag=$(finder_flag)
  _file=$(icon_file)
  case $_flag:$_file in
    no:no) say stock; return ;;
    yes:yes) ;;
    *) say unknown; return ;;
  esac
  [ -f "$OWN_ICON" ] || { say unknown; return; }
  _result=$(osascript -l JavaScript -e "$JXA_COMPARE" "$APP" "$OWN_ICON" 2>/dev/null) || {
    say unknown
    return
  }
  case $_result in
    own | custom) say "$_result" ;;
    *) say unknown ;;
  esac
}

# NSWorkspace reports the image currently used by Finder. Both images are drawn into the same
# fresh RGBA bitmap, so PNG/icns container metadata and representation ordering do not matter.
# Failure to decode/render returns unknown; no approximation or provenance marker is used.
# shellcheck disable=SC2016
JXA_COMPARE='
ObjC.import("AppKit");
function normalized(image) {
  if (!image || image.isNil() || !image.isValid) { throw new Error("unreadable image"); }
  var bitmap = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(
    null, 1024, 1024, 8, 4, true, false, $.NSCalibratedRGBColorSpace, 0, 0);
  if (bitmap.isNil()) { throw new Error("cannot create bitmap"); }
  $.NSGraphicsContext.saveGraphicsState;
  try {
    $.NSGraphicsContext.currentContext = $.NSGraphicsContext.graphicsContextWithBitmapImageRep(bitmap);
    $.NSColor.clearColor.set;
    $.NSRectFill($.NSMakeRect(0, 0, 1024, 1024));
    image.drawInRectFromRectOperationFractionRespectFlippedHints(
      $.NSMakeRect(0, 0, 1024, 1024), $.NSZeroRect, $.NSCompositingOperationCopy, 1, false, null);
  } finally {
    $.NSGraphicsContext.restoreGraphicsState;
  }
  var bytes = bitmap.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $({}));
  if (bytes.isNil()) { throw new Error("cannot encode bitmap"); }
  return bytes;
}
function run(argv) {
  try {
    var actual = $.NSWorkspace.sharedWorkspace.iconForFile($(argv[0]));
    var expected = $.NSImage.alloc.initWithContentsOfFile($(argv[1]));
    return normalized(actual).isEqualToData(normalized(expected)) ? "own" : "custom";
  } catch (error) { return "unknown"; }
}
'

print_limit_note() {
  cat >&2 <<EOF

This is usually macOS App Management refusing to let this process modify $APP.
  - Run the command from inside a Claude desktop Code session: that process belongs to
    the same developer as the app, so macOS allows it.
  - Or open System Settings > Privacy & Security > App Management, switch on your
    terminal app, quit and reopen the terminal, and run the command again.
Nothing was changed.
EOF
}

# Temp folder for the icon build; removed on every exit path.
WORK=
cleanup() {
  if [ -n "$WORK" ] && [ -d "$WORK" ]; then
    rm -rf "$WORK"
  fi
  if [ "$REPORT" -eq 1 ] && [ "$REPORTED" -eq 0 ]; then
    printf 'icon: unknown\n' >&3
  fi
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

# build_icns: turn $ICON (a PNG) into an .icns inside a fresh temp folder and set ICNS_FILE.
# A file that already ends in .icns is used as it is.
ICNS_FILE=
build_icns() {
  case $ICON in
    *.icns)
      ICNS_FILE=$ICON
      return 0
      ;;
  esac
  command -v sips >/dev/null 2>&1 || die "sips not found (it ships with macOS); nothing was changed"
  command -v iconutil >/dev/null 2>&1 || die "iconutil not found (it ships with macOS); nothing was changed"
  WORK=$(mktemp -d "${TMPDIR:-/tmp}/claude-sama-icon.XXXXXX") || die "cannot create a temp folder"
  _set=$WORK/claude-sama.iconset
  mkdir "$_set"
  # Resize once per distinct pixel size, then copy to the iconset names (the @2x names reuse sizes).
  for _px in 16 32 64 128 256 512 1024; do
    sips -z "$_px" "$_px" "$ICON" --out "$WORK/s$_px.png" >/dev/null 2>&1 ||
      die "sips could not read or resize $ICON; nothing was changed"
  done
  cp "$WORK/s16.png" "$_set/icon_16x16.png"
  cp "$WORK/s32.png" "$_set/icon_16x16@2x.png"
  cp "$WORK/s32.png" "$_set/icon_32x32.png"
  cp "$WORK/s64.png" "$_set/icon_32x32@2x.png"
  cp "$WORK/s128.png" "$_set/icon_128x128.png"
  cp "$WORK/s256.png" "$_set/icon_128x128@2x.png"
  cp "$WORK/s256.png" "$_set/icon_256x256.png"
  cp "$WORK/s512.png" "$_set/icon_256x256@2x.png"
  cp "$WORK/s512.png" "$_set/icon_512x512.png"
  cp "$WORK/s1024.png" "$_set/icon_512x512@2x.png"
  iconutil -c icns "$_set" -o "$WORK/claude-sama.icns" >/dev/null 2>&1 ||
    die "iconutil could not build the .icns; nothing was changed"
  ICNS_FILE=$WORK/claude-sama.icns
}

# JXA program. argv: mode target [icon]. Prints OK, BADICON:<reason> or FAIL:<reason>. Kept inline, nothing compiled.
# The $ signs are JXA's ObjC bridge, not shell variables, hence the single quotes.
# shellcheck disable=SC2016
JXA='
ObjC.import("AppKit");
function run(argv) {
  var mode = argv[0], target = argv[1], icon = argv[2];
  var ws = $.NSWorkspace.sharedWorkspace;
  var ok;
  if (mode === "apply") {
    var img = $.NSImage.alloc.initWithContentsOfFile($(icon));
    if (img.isNil()) { return "BADICON:cannot read the icon file as an image: " + icon; }
    ok = ws.setIconForFileOptions(img, $(target), 0);
  } else if (mode === "clear") {
    ok = ws.setIconForFileOptions($(), $(target), 0);
  } else {
    return "FAIL:unknown mode " + mode;
  }
  return ok ? "OK" : "FAIL:macOS refused to change the icon";
}
'

LAST_FAIL=
run_jxa() {
  # run_jxa MODE [ICON]; returns 0 on OK. Sets LAST_FAIL=icon when the icon file itself is the problem.
  _out=$(osascript -l JavaScript -e "$JXA" "$1" "$APP" "${2:-}" 2>&1) || {
    warn "osascript error: $_out"
    return 1
  }
  case $_out in
    OK) return 0 ;;
    BADICON:*)
      warn "${_out#BADICON:}"
      LAST_FAIL=icon
      return 1
      ;;
    FAIL:*)
      warn "${_out#FAIL:}"
      return 1
      ;;
    *)
      warn "unexpected osascript output: $_out"
      return 1
      ;;
  esac
}

refresh_dock() {
  if [ "$DOCK" -eq 0 ]; then
    [ "$DRY" -eq 1 ] || say "If the Dock still shows the old icon, run again with --refresh-dock (it restarts the Dock)."
    return 0
  fi
  if [ "$DRY" -eq 1 ]; then
    say "[dry-run] would run: touch \"$APP\" && killall Dock"
    return 0
  fi
  if ! touch "$APP" 2>/dev/null; then
    warn "could not touch $APP (continuing)"
  fi
  if killall Dock 2>/dev/null; then
    say "Dock restarted."
  else
    warn "could not restart the Dock (continuing)"
  fi
}

# ---- commands ----------------------------------------------------------------------------

do_status() {
  say "App:                $APP"
  say "Version:            $(app_version)"
  say "Icon file present:  $(icon_file)  (the Icon\\r file at the bundle root)"
  say "Custom-icon flag:   $(finder_flag)  (com.apple.FinderInfo)"
  _st=$(icon_state)
  say "State:              $_st"
  case $_st in
    own) say "The Claude-sama icon is in use (current image matches the shipped picture)." ;;
    custom) say "A different custom icon is in use." ;;
    stock) say "The stock icon is in use." ;;
    unknown) say "The current icon could not be verified." ;;
  esac
  if [ -f "$ICON" ]; then
    say "Claude-sama picture: $ICON"
  else
    say "Claude-sama picture: not found at $ICON"
  fi
}

do_apply() {
  say "Applying the Claude-sama icon to $APP (version $(app_version))"
  say "Icon file: $ICON"
  if [ "$DRY" -eq 1 ]; then
    say "[dry-run] would build an .icns from the picture in a temp folder (sips, iconutil),"
    say "[dry-run] call NSWorkspace setIcon:forFile:options: through osascript (JXA), then delete the temp folder."
    say "[dry-run] current state: $(icon_state). Nothing was changed."
    refresh_dock
    return 0
  fi
  build_icns
  if ! run_jxa apply "$ICNS_FILE"; then
    [ "$LAST_FAIL" = icon ] || print_limit_note
    exit 1
  fi
  if [ "$(finder_flag)" = yes ] && [ "$(icon_file)" = yes ]; then
    say "Done. The custom icon is set and verified (Icon file and Finder flag present)."
  else
    warn "macOS said OK but the custom-icon markers are not there; check with: $PROG status --app \"$APP\""
    exit 1
  fi
  say "Claude updates replace the app and drop this icon; run apply again after an update."
  refresh_dock
}

do_clear() {
  say "Restoring the stock icon of $APP (removes any custom icon on it)"
  if [ "$DRY" -eq 1 ]; then
    say "[dry-run] would call NSWorkspace setIcon:nil forFile:options: through osascript (JXA)."
    say "[dry-run] current state: $(icon_state). Nothing was changed."
    refresh_dock
    return 0
  fi
  if [ "$(icon_state)" = stock ] && [ "$(icon_file)" = no ]; then
    say "Already stock; nothing to do."
    return 0
  fi
  if ! run_jxa clear; then
    print_limit_note
    exit 1
  fi
  if [ "$(icon_state)" = stock ] && [ "$(icon_file)" = no ]; then
    say "Done. The stock icon is back."
  else
    warn "macOS said OK but the custom-icon markers are still there; check with: $PROG status --app \"$APP\""
    exit 1
  fi
  refresh_dock
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
