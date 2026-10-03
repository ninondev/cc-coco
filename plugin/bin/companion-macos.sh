#!/bin/sh
# companion-macos.sh - put Claude-sama beside the Claude desktop app's window (macOS only).
#
# Usage: companion-macos.sh install [--login] | start | stop | status | uninstall [--report]
#
# What it does
#   install    Builds the companion from its Swift source (../companion) with swiftc from the Xcode
#              Command Line Tools (Swift 5.9 or newer, Xcode 15 or later) into ~/Applications/Claude-sama Companion.app, copies the mod's
#              frames into it (16 desktop pictures, 16 pixel ones), signs it for this Mac only (ad
#              hoc, no Apple ID) and starts it. Nothing is downloaded. It rebuilds only when the
#              source changed, so a permission you gave the app stays valid. --login also adds a
#              LaunchAgent so it starts when you log in (macOS shows a "background item added"
#              notice).
#              Settings and the mod's feed stay in ~/Library/Application Support/Claude-sama/;
#              that folder tells the mod the companion is installed.
#   start      Starts the installed companion, or brings him back if he is running or hidden.
#   stop       Stops it. A login item stays in place; uninstall removes it.
#   status     Reads, never writes: installed, running (with its memory), whether it may follow the
#              window, login item, and when the mod last wrote its feed.
#   uninstall  Stops it and moves the app, ~/Library/Application Support/Claude-sama/ (settings and
#              the mod's feed file) and the LaunchAgent to the Trash; resets only its own
#              Accessibility entry.
#
# Permissions: to follow the window it needs Accessibility (System Settings > Privacy & Security >
# Accessibility > Claude-sama Companion); his card or the book's Settings button offers it. Without it he waits in the
# lower right corner of the screen while Claude is in front. It never asks for Screen Recording and
# never reads window titles, keystrokes or anything over the network. Claude.app is never touched.
#
# The companion is started through LaunchServices (open) or launchd, never as a child of this
# shell, so macOS asks about Accessibility for the companion itself and not for the app that runs
# this script. --no-prompt stays accepted as a no-op; launch never asks for permission.
# --report adds one final result line for the book; the human messages stay available.
#
# License: MIT. Part of Claude-sama, an unofficial fan skin. Claude is a trademark of Anthropic.

set -eu

PROG=companion-macos.sh
LABEL=io.github.ninondev.claudesama-companion
EXE=claudesama-companion
NAME="Claude-sama Companion"
REPORT=0
RESULT=failed

say() { printf '%s\n' "$*"; }
warn() { printf '%s: %s\n' "$PROG" "$*" >&2; }
die() {
  warn "$*"
  exit 2
}

usage() {
  cat <<EOF
Usage: $PROG install [--login] | start | stop | status | uninstall [--report]

  install       Build from source (swiftc), install into ~/Applications/Claude-sama Companion.app, start
  install --login   The same, and start it at every login (a LaunchAgent)
  start         Start it or bring him back, even while hidden
  stop          Stop it
  status        Show what is installed and running (read only)
  uninstall     Stop it, move everything it created to the Trash, reset its Accessibility entry

  --no-prompt   Accepted for compatibility; does nothing (launch never asks for permission)
  --report      Print result: ok | no-tools | old-tools | failed | not-mac as the last line

  Building needs Swift 5.9 or newer (Xcode 15 Command Line Tools or later).
  His book's Settings page has the same controls as buttons. His card offers window following.
  -h, --help    This text
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
PLUGIN=$(cd "$HERE/.." && pwd -P)
SRC=$PLUGIN/companion
FRAMES=$PLUGIN/assets/desktop
PIXELS=$PLUGIN/assets/pixel
ICON=$PLUGIN/assets/icon/claude-sama-1024.png

DIR="$HOME/Library/Application Support/Claude-sama"
APPS="$HOME/Applications"
APP="$APPS/$NAME.app"
OLD_APP="$DIR/$NAME.app"
BIN="$APP/Contents/MacOS/$EXE"
STATE="$DIR/companion.json"
FEED="$DIR/view.json"
AGENT="$HOME/Library/LaunchAgents/$LABEL.plist"
UIDN=$(id -u)
MATCH="Claude-sama Companion.app/Contents/MacOS/$EXE"

# ---- arguments ---------------------------------------------------------------------------

CMD=
LOGIN=0
while [ $# -gt 0 ]; do
  case $1 in
    install | start | stop | status | uninstall)
      [ -z "$CMD" ] || die "only one of install, start, stop, status, uninstall at a time"
      CMD=$1
      ;;
    --login) LOGIN=1 ;;
    --no-prompt) : ;;
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
[ -n "$CMD" ] || CMD=status

# No build output exists yet, but --report also covers platform and preflight failures.
STAGE=
cleanup() {
  _exit=$?
  if [ -n "$STAGE" ] && [ -d "$STAGE" ]; then
    rm -rf "$STAGE"
  fi
  if [ "$REPORT" -eq 1 ]; then
    printf 'result: %s\n' "$RESULT"
  fi
  return "$_exit"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

if [ "$(uname -s)" != Darwin ]; then
  RESULT=not-mac
  die "the companion is for macOS; on other systems the band inside Claude Code is all there is"
fi

VERSION=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$PLUGIN/.claude-plugin/plugin.json" 2>/dev/null | head -n 1)
[ -n "$VERSION" ] || VERSION=0

# ---- helpers -----------------------------------------------------------------------------

pids() { pgrep -f "$MATCH" 2>/dev/null || true; }

running_pid() { pids | head -n 1; }

# Moves a path to the Trash: /usr/bin/trash when present (macOS 15+), otherwise ~/.Trash.
to_trash() {
  if command -v trash >/dev/null 2>&1 && trash "$1" >/dev/null 2>&1; then
    return 0
  fi
  mkdir -p "$HOME/.Trash"
  _base=$(basename "$1")
  _dest="$HOME/.Trash/$_base"
  [ -e "$_dest" ] && _dest="$HOME/.Trash/$_base $(date +%Y%m%d-%H%M%S)"
  mv "$1" "$_dest"
}

# A short hash of everything the app is built from: rebuild only when it changes.
source_hash() {
  {
    printf '%s\n' "$VERSION"
    for _f in "$SRC/Info.plist" "$SRC"/Sources/*.swift "$FRAMES"/*.png "$PIXELS"/*.png "$ICON" "$HERE/$PROG"; do
      shasum -a 256 "$_f" | cut -d ' ' -f 1
    done
  } | shasum -a 256 | cut -c 1-16
}

installed_build() { cat "$APP/Contents/Resources/build.txt" 2>/dev/null || true; }

state_value() { plutil -extract "$1" raw -o - "$STATE" 2>/dev/null || true; }

agent_loaded() { launchctl print "gui/$UIDN/$LABEL" >/dev/null 2>&1; }

# Only the selected Xcode compiler is inspected. Neither lookup opens an installer dialog.
preflight() {
  if ! xcode-select -p >/dev/null 2>&1; then
    RESULT=no-tools
    warn "the Xcode Command Line Tools are not installed. Run: xcode-select --install   then run install again."
    exit 3
  fi
  _swiftc=$(xcrun --sdk macosx --find swiftc 2>/dev/null) || _swiftc=
  if [ -z "$_swiftc" ] || [ ! -x "$_swiftc" ]; then
    RESULT=no-tools
    warn "swiftc not found. Run: xcode-select --install   then run install again."
    exit 3
  fi
  _swift_version=$("$_swiftc" -version 2>&1) || _swift_version=
  _swift_numbers=$(printf '%s\n' "$_swift_version" | sed -n 's/.*Swift version \([0-9][0-9]*\)\.\([0-9][0-9]*\).*/\1 \2/p' | head -n 1)
  _major=${_swift_numbers%% *}
  _minor=${_swift_numbers#* }
  if [ -z "$_swift_numbers" ] || ! { [ "$_major" -gt 5 ] || { [ "$_major" -eq 5 ] && [ "$_minor" -ge 9 ]; }; }; then
    RESULT=old-tools
    if [ -z "$_swift_numbers" ]; then
      warn "could not read swiftc's version. This build needs Swift 5.9 or newer (Xcode 15 or its Command Line Tools or later); update through Software Update, then run install again."
    else
      warn "Swift $_major.$_minor is too old. This build needs Swift 5.9 or newer (Xcode 15 or its Command Line Tools or later); update through Software Update, then run install again."
    fi
    exit 4
  fi
}

build() {
  for _f in "$SRC/Info.plist" "$FRAMES/01-idle-reading.png" "$PIXELS/01-idle-reading.png"; do
    [ -f "$_f" ] || die "missing $_f; is the plugin complete?"
  done
  preflight
  STAGE=$(mktemp -d "${TMPDIR:-/tmp}/claudesama-companion.XXXXXX") || die "cannot create a temp folder"
  NEW="$STAGE/$NAME.app"
  mkdir -p "$NEW/Contents/MacOS" "$NEW/Contents/Resources/frames" "$NEW/Contents/Resources/pixel"
  sed "s/@VERSION@/$VERSION/g" "$SRC/Info.plist" >"$NEW/Contents/Info.plist"
  cp "$FRAMES"/*.png "$NEW/Contents/Resources/frames/"
  cp "$PIXELS"/*.png "$NEW/Contents/Resources/pixel/"
  printf '%s\n' "$1" >"$NEW/Contents/Resources/build.txt"
  # His icon for the app (shown where macOS asks about Accessibility); skipped if it cannot be made.
  if [ -f "$ICON" ] && command -v sips >/dev/null 2>&1 && command -v iconutil >/dev/null 2>&1; then
    _set="$STAGE/AppIcon.iconset"
    mkdir "$_set"
    for _px in 16 32 128 256; do
      sips -z "$_px" "$_px" "$ICON" --out "$_set/icon_${_px}x${_px}.png" >/dev/null 2>&1 || true
      _px2=$((_px * 2))
      sips -z "$_px2" "$_px2" "$ICON" --out "$_set/icon_${_px}x${_px}@2x.png" >/dev/null 2>&1 || true
    done
    iconutil -c icns "$_set" -o "$NEW/Contents/Resources/AppIcon.icns" >/dev/null 2>&1 || warn "no app icon (iconutil failed); continuing"
  fi
  xcrun --sdk macosx swiftc -O -swift-version 5 -module-cache-path "$STAGE/cache" \
    -o "$NEW/Contents/MacOS/$EXE" "$SRC"/Sources/*.swift >&2 ||
    die "the build failed (messages above); nothing was installed"
  codesign --force --sign - --identifier "$LABEL" "$NEW" >/dev/null 2>&1 ||
    die "codesign could not sign the app; nothing was installed"
}

# Home paths are text in XML, and can contain ampersands or other markup characters.
xml_text() { printf '%s' "$1" | sed -e 's/\&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g' -e "s/'/\&apos;/g"; }

# Kept byte-for-byte in sync with LoginAgent.plist in the companion.
agent_text() {
  _agent_bin=$(xml_text "$BIN")
  cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>$LABEL</string>
	<key>ProgramArguments</key>
	<array>
		<string>$_agent_bin</string>
		<string>--login</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<false/>
	<key>ProcessType</key>
	<string>Interactive</string>
	<key>LimitLoadToSessionType</key>
	<string>Aqua</string>
	<key>AssociatedBundleIdentifiers</key>
	<array>
		<string>$LABEL</string>
	</array>
</dict>
</plist>
EOF
}

write_agent() {
  mkdir -p "$HOME/Library/LaunchAgents"
  agent_text >"$AGENT"
}

start_it() {
  _pid=$(running_pid)
  [ -x "$BIN" ] || die "not installed; run: $PROG install"
  open -g "$APP" || die "macOS could not open $APP"
  if [ -n "$_pid" ]; then
    say "Brought him back (pid $_pid)."
    return 0
  fi
  _i=0
  while [ $_i -lt 30 ] && [ -z "$(running_pid)" ]; do
    sleep 0.1
    _i=$((_i + 1))
  done
  _pid=$(running_pid)
  [ -n "$_pid" ] || die "it did not start; see Console.app for $EXE"
  wait_state "$_pid"
  say "Started (pid $_pid)."
}

# Waits up to 3 s for the companion to write its state (whether Accessibility is allowed).
wait_state() {
  _i=0
  while [ $_i -lt 30 ] && [ "$(state_value pid)" != "$1" ]; do
    sleep 0.1
    _i=$((_i + 1))
  done
}

stop_it() {
  _list=$(pids)
  if [ -z "$_list" ]; then
    [ "${1:-}" = quiet ] || say "Not running."
    return 0
  fi
  # shellcheck disable=SC2086 # one pid per word
  kill -TERM $_list 2>/dev/null || true
  _i=0
  while [ $_i -lt 30 ] && [ -n "$(pids)" ]; do
    sleep 0.1
    _i=$((_i + 1))
  done
  if [ -n "$(pids)" ]; then
    warn "it did not stop within 3 seconds (pid $(running_pid))"
    return 1
  fi
  [ "${1:-}" = quiet ] || say "Stopped."
}

# ---- commands ----------------------------------------------------------------------------

do_status() {
  if [ -x "$BIN" ]; then
    _v=$(plutil -extract CFBundleShortVersionString raw -o - "$APP/Contents/Info.plist" 2>/dev/null || say "?")
    say "Installed:      yes, version $_v, build $(installed_build)"
    say "                $APP"
    [ "$(installed_build)" = "$(source_hash)" ] || say "                (this plugin's source is newer: run install to rebuild)"
  else
    say "Installed:      no (run: install)"
    say "                $APP"
    [ ! -e "$OLD_APP" ] || say "                (an app is at the old location: run install to move or rebuild it)"
  fi
  _pid=$(running_pid)
  if [ -n "$_pid" ]; then
    _rss=$(ps -o rss= -p "$_pid" 2>/dev/null | tr -d ' ')
    _fp=$(footprint -p "$_pid" 2>/dev/null | sed -n 's/.*phys_footprint: *\([0-9.]* [KMG]B\).*/\1/p' | head -n 1)
    say "Running:        yes, pid $_pid, ${_rss:-?} KB resident${_fp:+, footprint $_fp}"
    case $(state_value accessibility) in
      true) say "Accessibility:  allowed: he follows the Claude window." ;;
      false)
        say "Accessibility:  not allowed: he cannot follow the window, so he waits in the lower right corner"
        say "                (or where you drag him) while Claude is in front. Use his card, or Let him follow"
        say "                the window in his book's Settings. If those cannot help, open System Settings >"
        say "                Privacy & Security > Accessibility > switch on \"$NAME\". If it"
        say "                is on already, that entry belongs to an earlier build (each build needs its"
        say "                own): select it, remove it with the minus button, add the app again with the"
        say "                plus button from $APPS, and switch it on."
        say "                He notices as soon as you come back to any app; no restart needed."
        ;;
      *) say "Accessibility:  unknown (no state written yet)" ;;
    esac
  else
    say "Running:        no"
  fi
  if [ -f "$AGENT" ]; then
    if agent_loaded; then say "At login:       yes (LaunchAgent $LABEL)"; else say "At login:       plist present, not loaded"; fi
  else
    say "At login:       no (install --login adds it)"
  fi
  if [ -f "$FEED" ]; then
    _age=$(($(date +%s) - $(stat -f %m "$FEED")))
    say "Feed:           the mod last wrote ${_age}s ago"
  else
    say "Feed:           nothing yet (the mod writes it while a session with this plugin runs)"
  fi
}

do_install() {
  _hash=$(source_hash)
  if [ -x "$OLD_APP/Contents/MacOS/$EXE" ] && [ "$(cat "$OLD_APP/Contents/Resources/build.txt" 2>/dev/null || true)" = "$_hash" ]; then
    stop_it quiet || die "could not stop the running companion; nothing was moved"
    mkdir -p "$APPS"
    mkdir -p -m 700 "$DIR"
    chmod 700 "$DIR"
    if [ -e "$APP" ]; then
      to_trash "$APP" || die "could not move the previous build to the Trash; nothing was moved"
      say "The previous build went to the Trash."
    fi
    mv "$OLD_APP" "$APP"
    say "Moved $NAME from its old location to $APP (build $_hash); keeping the same binary and its Accessibility permission."
  fi
  if [ -x "$BIN" ] && [ "$(installed_build)" = "$_hash" ]; then
    say "Already built from this source (build $_hash); keeping it, so an Accessibility permission stays valid."
  else
    say "Building $NAME $VERSION from source with swiftc (takes a few seconds)..."
    build "$_hash"
    stop_it quiet || die "could not stop the running companion; nothing was replaced"
    mkdir -p "$APPS"
    mkdir -p -m 700 "$DIR"
    chmod 700 "$DIR"
    if [ -e "$APP" ]; then
      to_trash "$APP" || die "could not move the previous build to the Trash; nothing was replaced"
      say "The previous build went to the Trash."
    fi
    mv "$NEW" "$APP"
    say "Installed $APP (build $_hash)."
  fi
  if [ -e "$OLD_APP" ]; then
    stop_it quiet || die "could not stop the running companion; the app at the old location was not retired"
    to_trash "$OLD_APP" || die "could not move the app at the old location to the Trash"
    say "The app at the old location went to the Trash."
  fi
  mkdir -p -m 700 "$DIR"
  chmod 700 "$DIR"
  if [ "$LOGIN" -eq 1 ] || [ -f "$AGENT" ]; then
    agent_loaded && launchctl bootout "gui/$UIDN/$LABEL" >/dev/null 2>&1 || true
    write_agent
    stop_it quiet || true
    launchctl bootstrap "gui/$UIDN" "$AGENT" || die "launchctl could not load $AGENT"
    say "Starts at login: $AGENT"
    _i=0
    while [ $_i -lt 30 ] && [ -z "$(running_pid)" ]; do
      sleep 0.1
      _i=$((_i + 1))
    done
    wait_state "$(running_pid)"
  else
    start_it
  fi
  do_status
}

do_uninstall() {
  stop_it || true
  if [ -f "$AGENT" ]; then
    launchctl bootout "gui/$UIDN/$LABEL" >/dev/null 2>&1 || true
    to_trash "$AGENT" || die "could not move the login item to the Trash"
    say "Moved to the Trash: $AGENT"
  fi
  for _extra in "$HOME/Library/Saved Application State/$LABEL.savedState" \
    "$HOME/Library/Preferences/$LABEL.plist" "$HOME/Library/Caches/$LABEL"; do
    if [ -e "$_extra" ]; then
      to_trash "$_extra" || die "could not move $_extra to the Trash"
      say "Moved to the Trash: $_extra"
    fi
  done
  if [ -e "$APP" ]; then
    to_trash "$APP" || die "could not move the app to the Trash"
    say "Moved to the Trash: $APP"
  else
    say "Nothing installed at $APP."
  fi
  if [ -e "$DIR" ]; then
    to_trash "$DIR" || die "could not move its settings to the Trash"
    say "Moved to the Trash: $DIR (its settings, the mod's feed file, any app at the old location)"
  else
    say "Nothing installed at $DIR."
  fi
  say "The mod writes its feed only while that folder exists, so it has stopped too."
  if tccutil reset Accessibility "$LABEL"; then
    say "Reset its own Accessibility entry ($LABEL)."
  else
    warn "could not reset its Accessibility entry; remove \"$NAME\" under System Settings > Privacy & Security > Accessibility."
    return 1
  fi
}

case $CMD in
  install) do_install ;;
  start)
    start_it
    do_status
    ;;
  stop) stop_it ;;
  status) do_status ;;
  uninstall) do_uninstall ;;
esac

RESULT=ok
