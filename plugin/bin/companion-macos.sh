#!/bin/sh
# companion-macos.sh - put Coco beside the Claude desktop app's window (macOS only).
#
# Usage: companion-macos.sh install [--login] | start | stop | status | uninstall [--report]
#
# What it does
#   install    Copies the bundled bin/Coco Pet.app into ~/Applications and starts it.
#              The package is checked and staged before the installed app is stopped or moved.
#              An unchanged package keeps the installed app and its permission identity.
#              --developer-build explicitly builds from source and signs ad hoc instead.
#              --login adds a LaunchAgent so it starts when you log in.
#              Settings and the mod's feed stay in ~/Library/Application Support/Coco/;
#              that folder tells the mod the companion is installed.
#   start      Starts the installed companion, or brings it back if it is running or hidden.
#   stop       Stops it. A login item stays in place; uninstall removes it.
#   status     Reads, never writes: installed, running (with its memory), whether it may follow the
#              window, login item, and when the mod last wrote its feed.
#   uninstall  Stops it and moves the app, ~/Library/Application Support/Coco/ (settings and
#              the mod's feed file) and the LaunchAgent to the Trash; resets only its own
#              Accessibility entry and deletes its signing identity.
#
# Permissions: to follow the window it needs Accessibility (System Settings > Privacy & Security >
# Accessibility > Coco Pet); its card or the bag's Settings button offers it. Without it, Coco waits in the
# lower right corner of the screen while Claude is in front. It never asks for Screen Recording and
# never reads window titles, keystrokes or anything over the network. Claude.app is never touched.
#
# The companion is started through LaunchServices (open) or launchd, never as a child of this
# shell, so macOS asks about Accessibility for the companion itself and not for the app that runs
# this script. --no-prompt stays accepted as a no-op; launch never asks for permission.
# --report adds one final result line for the book; the human messages stay available.
#
# License: MIT. Part of Coco, an unofficial fan skin. Claude is a trademark of Anthropic.

set -eu
PATH=/usr/bin:/bin:/usr/sbin:/sbin
export PATH

PROG=companion-macos.sh
LABEL=io.github.ninondev.coco-companion
EXE=coco-companion
NAME="Coco Pet"
SIGN_NAME="Coco Pet Local Signing"
REPORT=0
RESULT=failed

say() { printf '%s\n' "$*"; }
warn() { printf '%s: %s\n' "$PROG" "$*" >&2; }
die() {
  warn "$*"
  exit 2
}

usage() {
  /bin/cat <<EOF
Usage: $PROG install [--login] | start | stop | status | uninstall [--report]

  install       Install the bundled Coco Pet.app into ~/Applications, then start it
  install --login   The same, and start it at every login (a LaunchAgent)
  start         Start it or bring it back, even while hidden
  stop          Stop it
  status        Show what is installed and running (read only)
  uninstall     Stop it, move everything it created to the Trash, reset its Accessibility entry

  --no-prompt   Accepted for compatibility; does nothing (launch never asks for permission)
  --report      Print result: ok | no-tools | old-tools | failed | not-mac as the last line

  --developer-build   Build from source with Swift 5.9 or newer; use ad hoc signing
  Normal installation needs the bundled app, not Xcode Command Line Tools.
  Coco's bag has the same controls as buttons. Coco Pet's card offers window following.
  -h, --help    This text
EOF
}

# Directory this script lives in, following symlinks (readlink exists on every macOS).
self_dir() {
  _p=$1
  while [ -h "$_p" ]; do
    _d=$(cd "$(/usr/bin/dirname "$_p")" && pwd -P)
    _l=$(/usr/bin/readlink "$_p")
    case $_l in
      /*) _p=$_l ;;
      *) _p=$_d/$_l ;;
    esac
  done
  (cd "$(/usr/bin/dirname "$_p")" && pwd -P)
}

HERE=$(self_dir "$0")
PLUGIN=$(cd "$HERE/.." && pwd -P)
CONTROL=$HERE/companion-control
PACKAGED="$HERE/$NAME.app"
SRC=$PLUGIN/companion
# Coco's animation clips and Claudie's current cells.
COCO=$PLUGIN/companion-rs/assets/coco
# The quota foot's words, the Rust pet's own table (QuotaPixels.swift reads them from Resources/words).
QUOTA_WORDS=$PLUGIN/companion-rs/assets/words
CLAUDIE=$PLUGIN/assets/claudie
ICON=$PLUGIN/assets/icon/coco-1024.png

DIR="$HOME/Library/Application Support/Coco"
APPS="$HOME/Applications"
APP="$APPS/$NAME.app"
OLD_APP="$DIR/$NAME.app"
BIN="$APP/Contents/MacOS/$EXE"
STATE="$DIR/companion.json"
FEED="$DIR/view.json"
AGENT="$HOME/Library/LaunchAgents/$LABEL.plist"
UIDN=$(/usr/bin/id -u)
OLD_BIN="$OLD_APP/Contents/MacOS/$EXE"

# ---- arguments ---------------------------------------------------------------------------

CMD=
LOGIN=0
DEVELOPER_BUILD=0
while [ $# -gt 0 ]; do
  case $1 in
    install | start | stop | status | uninstall)
      [ -z "$CMD" ] || die "only one of install, start, stop, status, uninstall at a time"
      CMD=$1
      ;;
    --login) LOGIN=1 ;;
    --developer-build) DEVELOPER_BUILD=1 ;;
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
[ "$DEVELOPER_BUILD" -eq 0 ] || [ "$CMD" = install ] || die "--developer-build is only for install"

# No build output exists yet, but --report also covers platform and preflight failures.
STAGE=
BACKUP=
cleanup() {
  _exit=$?
  if [ -n "$BACKUP" ] && [ -e "$BACKUP" ]; then
    if [ ! -e "$APP" ] && [ ! -L "$APP" ]; then
      /bin/mv "$BACKUP" "$APP" || warn "could not restore the previous app from $BACKUP"
    fi
    if [ -e "$BACKUP" ]; then
      warn "the previous app is kept at $BACKUP"
      STAGE=
    fi
  fi
  if [ -n "$STAGE" ] && [ -d "$STAGE" ]; then
    /bin/rm -rf "$STAGE"
  fi
  if [ "$REPORT" -eq 1 ]; then
    printf 'result: %s\n' "$RESULT"
  fi
  return "$_exit"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

if [ "$(/usr/bin/uname -s)" != Darwin ]; then
  RESULT=not-mac
  die "the companion is for macOS; on other systems the band inside Claude Code is all there is"
fi

VERSION=$(/usr/bin/sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$PLUGIN/.claude-plugin/plugin.json" 2>/dev/null | /usr/bin/head -n 1)
[ -n "$VERSION" ] || VERSION=0

# ---- helpers -----------------------------------------------------------------------------

pids() { "$CONTROL" list "$BIN" "$OLD_BIN"; }

running_pid() { pids | /usr/bin/head -n 1; }

# Moves a path to the Trash: /usr/bin/trash when present (macOS 15+), otherwise ~/.Trash.
to_trash() {
  if [ -x /usr/bin/trash ] && /usr/bin/trash "$1" >/dev/null 2>&1; then
    return 0
  fi
  "$CONTROL" ensure-dir "$HOME/.Trash"
  _base=$(/usr/bin/basename "$1")
  _dest="$HOME/.Trash/$_base"
  [ -e "$_dest" ] && _dest="$HOME/.Trash/$_base $(/bin/date +%Y%m%d-%H%M%S)"
  /bin/mv "$1" "$_dest"
}

# A short hash of everything the app is built from: rebuild only when it changes.
source_hash() {
  {
    printf '%s\n' "$VERSION"
    for _f in "$SRC/Info.plist" "$SRC"/Sources/*.swift "$ICON" "$PLUGIN/assets/icon/coco-16.png" "$PLUGIN/assets/icon/coco-32.png" "$PLUGIN/assets/icon/build-icns.sh" "$HERE/$PROG"; do
      /usr/bin/shasum -a 256 "$_f" | /usr/bin/cut -d ' ' -f 1
    done
    for _f in "$PLUGIN/assets/frame-manifest.json" "$PLUGIN/assets/companion-tuning.json" "$PLUGIN/assets/neighbours.json" "$PLUGIN/assets/shed"/*.png "$PLUGIN/assets/shed/shed.json" "$PLUGIN/assets/visitors"/*.png "$PLUGIN/assets/visitors/visitors.json" "$COCO"/*.json "$COCO"/*.bin "$CLAUDIE"/*/*.png "$QUOTA_WORDS/quota.json" "$QUOTA_WORDS/languages.json"; do
      if [ -f "$_f" ]; then /usr/bin/shasum -a 256 "$_f" | /usr/bin/cut -d ' ' -f 1; fi
    done
  } | /usr/bin/shasum -a 256 | /usr/bin/cut -c 1-16
}

# Include relative names and every signed payload byte, independent of where the bundle lives.
bundle_hash() (
  cd "$1" || exit 1
  _files=$(/usr/bin/find -s . -type f -exec /usr/bin/shasum -a 256 {} +) || exit 1
  printf '%s\n' "$_files" | /usr/bin/shasum -a 256 | /usr/bin/cut -d ' ' -f 1
)

require_coco_assets() {
  for _coco_file in "$1/band-A.json" "$1/band-A.bin" "$1/band-B.json" "$1/band-B.bin"; do
    [ -s "$_coco_file" ] || die "missing required Coco asset: $_coco_file"
  done
  for _coco_json in "$1"/*.json; do
    [ -s "${_coco_json%.json}.bin" ] || die "missing Coco image data for $_coco_json"
  done
}

validate_package() {
  [ -d "$1" ] && [ ! -L "$1" ] || die "missing bundled app at $1; install the complete macOS package"
  [ -z "$(/usr/bin/find "$1" -type l -print)" ] || die "the bundled app contains a symbolic link; download the macOS package again"
  [ -x "$1/Contents/MacOS/$EXE" ] && [ -s "$1/Contents/Resources/build.txt" ] || die "the bundled app is incomplete; download the macOS package again"
  require_coco_assets "$1/Contents/Resources/coco"
  _id=$(/usr/bin/plutil -extract CFBundleIdentifier raw -o - "$1/Contents/Info.plist") || die "cannot read the bundled app's Info.plist"
  _exe=$(/usr/bin/plutil -extract CFBundleExecutable raw -o - "$1/Contents/Info.plist") || die "cannot read the bundled app's executable name"
  _version=$(/usr/bin/plutil -extract CFBundleVersion raw -o - "$1/Contents/Info.plist") || die "cannot read the bundled app's version"
  [ "$_id" = "$LABEL" ] && [ "$_exe" = "$EXE" ] && [ -n "$_version" ] || die "the bundled app has the wrong identity; download the macOS package again"
  /usr/bin/codesign --verify --deep --strict "$1" || die "the bundled app's signature is invalid; download the macOS package again"
}

installed_build() { /bin/cat "$APP/Contents/Resources/build.txt" 2>/dev/null || true; }

state_value() { /usr/bin/plutil -extract "$1" raw -o - "$STATE" 2>/dev/null || true; }

agent_loaded() { /bin/launchctl print "gui/$UIDN/$LABEL" >/dev/null 2>&1; }

# Only the selected Xcode compiler is inspected. Neither lookup opens an installer dialog.
preflight() {
  if ! /usr/bin/xcode-select -p >/dev/null 2>&1; then
    RESULT=no-tools
    warn "the Xcode Command Line Tools are not installed. Run: xcode-select --install   then run install again."
    exit 3
  fi
  _swiftc=$(/usr/bin/xcrun --sdk macosx --find swiftc 2>/dev/null) || _swiftc=
  if [ -z "$_swiftc" ] || [ ! -x "$_swiftc" ]; then
    RESULT=no-tools
    warn "swiftc not found. Run: xcode-select --install   then run install again."
    exit 3
  fi
  _swift_version=$("$_swiftc" -version 2>&1) || _swift_version=
  _swift_numbers=$(printf '%s\n' "$_swift_version" | /usr/bin/sed -n 's/.*Swift version \([0-9][0-9]*\)\.\([0-9][0-9]*\).*/\1 \2/p' | /usr/bin/head -n 1)
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
  for _f in "$SRC/Info.plist"; do
    [ -f "$_f" ] || die "missing $_f; is the plugin complete?"
  done
  require_coco_assets "$COCO"
  preflight
  NEW="$STAGE/$NAME.app"
  /bin/mkdir -p "$NEW/Contents/MacOS" "$NEW/Contents/Resources"
  /usr/bin/sed "s/@VERSION@/$VERSION/g" "$SRC/Info.plist" >"$NEW/Contents/Info.plist"
  /bin/cp "$PLUGIN/assets/frame-manifest.json" "$PLUGIN/assets/companion-tuning.json" "$PLUGIN/assets/neighbours.json" "$NEW/Contents/Resources/"
  if [ -d "$PLUGIN/assets/shed" ]; then
    /bin/mkdir -p "$NEW/Contents/Resources/shed"
    /bin/cp "$PLUGIN/assets/shed"/*.png "$PLUGIN/assets/shed"/shed.json "$NEW/Contents/Resources/shed/"
  fi
  if [ -d "$PLUGIN/assets/visitors" ]; then
    /bin/mkdir -p "$NEW/Contents/Resources/visitors"
    /bin/cp "$PLUGIN/assets/visitors"/*.png "$PLUGIN/assets/visitors"/visitors.json "$NEW/Contents/Resources/visitors/"
  fi
  /bin/mkdir -p "$NEW/Contents/Resources/coco"
  /bin/cp "$COCO"/*.json "$COCO"/*.bin "$NEW/Contents/Resources/coco/"
  if [ -f "$QUOTA_WORDS/quota.json" ] && [ -f "$QUOTA_WORDS/languages.json" ]; then
    /bin/mkdir -p "$NEW/Contents/Resources/words"
    /bin/cp "$QUOTA_WORDS/quota.json" "$QUOTA_WORDS/languages.json" "$NEW/Contents/Resources/words/"
  fi
  for _form in dake maid; do
    if [ -d "$CLAUDIE/$_form" ]; then
      /bin/mkdir -p "$NEW/Contents/Resources/claudie/$_form"
      /bin/cp "$CLAUDIE/$_form"/*.png "$NEW/Contents/Resources/claudie/$_form/"
    fi
  done
  printf '%s\n' "$1" >"$NEW/Contents/Resources/build.txt"
  # Coco Pet's icon (shown where macOS asks about Accessibility); skipped if it cannot be made.
  if [ -f "$ICON" ] && [ -x /usr/bin/sips ]; then
    _set="$STAGE/AppIcon.iconset"
    /bin/mkdir "$_set"
    for _px in 16 32 128 256 512; do
      /usr/bin/sips -z "$_px" "$_px" "$ICON" --out "$_set/icon_${_px}x${_px}.png" >/dev/null 2>&1 || true
      _px2=$((_px * 2))
      /usr/bin/sips -z "$_px2" "$_px2" "$ICON" --out "$_set/icon_${_px}x${_px}@2x.png" >/dev/null 2>&1 || true
    done
    /bin/cp "$PLUGIN/assets/icon/coco-16.png" "$_set/icon_16x16.png"
    /bin/cp "$PLUGIN/assets/icon/coco-32.png" "$_set/icon_16x16@2x.png"
    /bin/cp "$PLUGIN/assets/icon/coco-32.png" "$_set/icon_32x32.png"
    /bin/sh "$PLUGIN/assets/icon/build-icns.sh" "$_set" "$NEW/Contents/Resources/AppIcon.icns" || return 1
  fi
  /usr/bin/xcrun --sdk macosx swiftc -O -swift-version 5 -module-cache-path "$STAGE/cache" \
    -o "$NEW/Contents/MacOS/$EXE" "$SRC"/Sources/*.swift >&2 ||
    die "the build failed (messages above); nothing was installed"
  /usr/bin/codesign --force --sign - --identifier "$LABEL" "$NEW" >/dev/null 2>&1 ||
    die "codesign could not sign the developer app; nothing was installed"
}

# Home paths are text in XML, and can contain ampersands or other markup characters.
xml_text() { printf '%s' "$1" | /usr/bin/sed -e 's/\&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g' -e "s/'/\&apos;/g"; }

# Kept byte-for-byte in sync with LoginAgent.plist in the companion.
agent_text() {
  _agent_bin=$(xml_text "$BIN")
  /bin/cat <<EOF
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
  agent_text | "$CONTROL" write-agent "$HOME/Library/LaunchAgents" "$LABEL.plist"
}

start_it() {
  _pid=$(running_pid)
  [ -x "$BIN" ] || die "not installed; run: $PROG install"
  /usr/bin/open -g "$APP" || die "macOS could not open $APP"
  if [ -n "$_pid" ]; then
    say "Brought it back (pid $_pid)."
    return 0
  fi
  _i=0
  while [ $_i -lt 30 ] && [ -z "$(running_pid)" ]; do
    /bin/sleep 0.1
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
    /bin/sleep 0.1
    _i=$((_i + 1))
  done
}

stop_it() {
  _list=$(pids)
  if [ -z "$_list" ]; then
    [ "${1:-}" = quiet ] || say "Not running."
    return 0
  fi
  "$CONTROL" stop "$BIN" "$OLD_BIN" || return 1
  _i=0
  while [ $_i -lt 30 ] && [ -n "$(pids)" ]; do
    /bin/sleep 0.1
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
    _v=$(/usr/bin/plutil -extract CFBundleShortVersionString raw -o - "$APP/Contents/Info.plist" 2>/dev/null || say "?")
    say "Installed:      yes, version $_v, build $(installed_build)"
    say "                $APP"
    if [ -f "$PACKAGED/Contents/Resources/build.txt" ] && [ "$(installed_build)" != "$(/bin/cat "$PACKAGED/Contents/Resources/build.txt")" ]; then
      say "                (a different bundled build is available: run install to update)"
    fi
  else
    say "Installed:      no (run: install)"
    say "                $APP"
    [ ! -e "$OLD_APP" ] || say "                (an app is at the old location: run install to move or rebuild it)"
  fi
  _pid=$(running_pid)
  if [ -n "$_pid" ]; then
    _rss=$(/bin/ps -o rss= -p "$_pid" 2>/dev/null | /usr/bin/tr -d ' ')
    _fp=$(/usr/bin/footprint -p "$_pid" 2>/dev/null | /usr/bin/sed -n 's/.*phys_footprint: *\([0-9.]* [KMG]B\).*/\1/p' | /usr/bin/head -n 1)
    say "Running:        yes, pid $_pid, ${_rss:-?} KB resident${_fp:+, footprint $_fp}"
    case $(state_value accessibility) in
      true) say "Accessibility:  allowed: it follows the Claude window." ;;
      false)
        say "Accessibility:  not allowed: it cannot follow the window, so it waits in the lower right corner"
        say "                (or where you drag it) while Claude is in front. Use its card, or Let Coco follow"
        say "                the window in the bag's Settings. If those cannot help, open System Settings >"
        say "                Privacy & Security > Accessibility > switch on \"$NAME\". If it"
        say "                is on already, that entry belongs to an earlier build (each build needs its"
        say "                own): select it, remove it with the minus button, add the app again with the"
        say "                plus button from $APPS, and switch it on."
        say "                It notices as soon as you come back to any app; no restart needed."
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
    _age=$(($(/bin/date +%s) - $(/usr/bin/stat -f %m "$FEED")))
    say "Feed:           the mod last wrote ${_age}s ago"
  else
    say "Feed:           nothing yet (the mod writes it while a session with this plugin runs)"
  fi
}

do_install() {
  [ ! -L "$APP" ] || die "the installed app path is a symbolic link; nothing was changed"
  if [ "$DEVELOPER_BUILD" -eq 1 ]; then
    _hash=$(source_hash)
    _same=0
    [ -x "$BIN" ] && [ "$(installed_build)" = "$_hash" ] && _same=1
  else
    validate_package "$PACKAGED"
    _hash=$(bundle_hash "$PACKAGED") || die "cannot read the bundled app; nothing was changed"
    _same=0
    if [ -x "$BIN" ] && [ "$(bundle_hash "$APP")" = "$_hash" ]; then _same=1; fi
  fi
  "$CONTROL" ensure-dir "$APPS"
  "$CONTROL" private-dir "$DIR"
  if [ "$_same" -eq 1 ]; then
    say "The installed app matches this package; keeping it and its permissions."
  else
    STAGE=$(/usr/bin/mktemp -d "$APPS/.coco-companion.XXXXXX") || die "cannot create the installation staging folder"
    NEW="$STAGE/$NAME.app"
    if [ "$DEVELOPER_BUILD" -eq 1 ]; then
      say "Building a developer copy of $NAME $VERSION with swiftc..."
      build "$_hash"
    else
      /usr/bin/ditto "$PACKAGED" "$NEW" || die "cannot stage the bundled app; the installed app is unchanged"
      validate_package "$NEW"
      [ "$(bundle_hash "$NEW")" = "$_hash" ] || die "the staged app differs from the package; the installed app is unchanged"
    fi
    stop_it quiet || die "could not stop the running companion; nothing was replaced"
    if [ -e "$APP" ]; then
      BACKUP="$STAGE/previous.app"
      /bin/mv "$APP" "$BACKUP" || die "cannot stage the previous app; nothing was replaced"
    fi
    /bin/mv "$NEW" "$APP" || die "cannot install the staged app; restoring the previous app"
    if [ -n "$BACKUP" ]; then
      to_trash "$BACKUP" || die "the new app is installed; the previous app is kept at $BACKUP"
      BACKUP=
    fi
    say "Installed $APP (build $(installed_build))."
  fi
  if [ -e "$OLD_APP" ]; then
    stop_it quiet || die "could not stop the running companion; the app at the old location was not retired"
    to_trash "$OLD_APP" || die "could not move the app at the old location to the Trash"
    say "The app at the old location went to the Trash."
  fi
  "$CONTROL" private-dir "$DIR"
  if [ "$LOGIN" -eq 1 ] || [ -f "$AGENT" ]; then
    if [ "$_same" -eq 0 ] || [ ! -f "$AGENT" ] || ! agent_loaded; then
      agent_loaded && /bin/launchctl bootout "gui/$UIDN/$LABEL" >/dev/null 2>&1 || true
      write_agent
      stop_it quiet || true
      /bin/launchctl bootstrap "gui/$UIDN" "$AGENT" || die "launchctl could not load $AGENT"
      say "Starts at login: $AGENT"
      _i=0
      while [ $_i -lt 30 ] && [ -z "$(running_pid)" ]; do
        /bin/sleep 0.1
        _i=$((_i + 1))
      done
      wait_state "$(running_pid)"
    elif [ -z "$(running_pid)" ]; then
      start_it
    fi
  else
    start_it
  fi
  do_status
}

do_uninstall() {
  stop_it || true
  # The trim worker deletes only its indexed, identity-checked private files.
  # Presence claims and all unrelated files stay under the transport's ownership.
  _logs="$HOME/Library/Application Support/Coco-presence/logs"
  if [ -f "$_logs/.owner" ]; then
    _trim_runtime=''
    if command -v node >/dev/null 2>&1; then _trim_runtime=node
    elif command -v bun >/dev/null 2>&1; then _trim_runtime=bun
    fi
    [ -n "$_trim_runtime" ] || return 1
    _trim_reply=$("$_trim_runtime" "$PLUGIN/hooks/d1-trim-worker.mjs" --purge-root "$HOME/Library/Application Support/Coco-presence") || return 1
    [ "$_trim_reply" = '{"ok":true}' ] || return 1
  fi
  if [ -f "$AGENT" ]; then
    /bin/launchctl bootout "gui/$UIDN/$LABEL" >/dev/null 2>&1 || true
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
  if /usr/bin/security delete-identity -c "$SIGN_NAME" >/dev/null 2>&1; then
    say "Deleted its signing identity \"$SIGN_NAME\" from your login keychain."
  fi
  if /usr/bin/tccutil reset Accessibility "$LABEL"; then
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
