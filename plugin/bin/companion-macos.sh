#!/bin/sh
# companion-macos.sh - put Coco beside the Claude desktop app's window (macOS only).
#
# Usage: companion-macos.sh install [--login] | start | stop | status | uninstall [--report]
#
# What it does
#   install    Builds the companion from its Swift source (../companion) with swiftc from the Xcode
#              Command Line Tools (Swift 5.9 or newer, Xcode 15 or later) into ~/Applications/Coco Pet.app, copies the mod's
#              frames into it (16 desktop pictures, 16 pixel ones) with Coco's clips and Claudie's
#              cells, signs it for this Mac only (no Apple ID) and starts it. Nothing is downloaded. It rebuilds only when the
#              source changed, so a permission you gave the app stays valid. The signature is "Coco Pet Local Signing", a
#              self-signed identity made once in your login keychain, so a rebuilt app keeps the Accessibility permission
#              too; if it cannot be made, the signature is ad hoc and a rebuild asks again. --login also adds a
#              LaunchAgent so it starts when you log in (macOS shows a "background item added"
#              notice).
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

  install       Build from source (swiftc), install into ~/Applications/Coco Pet.app, start
  install --login   The same, and start it at every login (a LaunchAgent)
  start         Start it or bring it back, even while hidden
  stop          Stop it
  status        Show what is installed and running (read only)
  uninstall     Stop it, move everything it created to the Trash, reset its Accessibility entry

  --no-prompt   Accepted for compatibility; does nothing (launch never asks for permission)
  --report      Print result: ok | no-tools | old-tools | failed | not-mac as the last line

  Building needs Swift 5.9 or newer (Xcode 15 Command Line Tools or later).
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
SRC=$PLUGIN/companion
FRAMES=$PLUGIN/assets/desktop
PIXELS=$PLUGIN/assets/pixel
# Coco's clips (the pet's own set, the one companion-rs draws) and Claudie's cells; the app draws Coco from these
# when they are there and falls back to the painted frames above when they are not.
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
    for _f in "$SRC/Info.plist" "$SRC"/Sources/*.swift "$FRAMES"/*.png "$PIXELS"/*.png "$ICON" "$PLUGIN/assets/icon/coco-16.png" "$PLUGIN/assets/icon/coco-32.png" "$PLUGIN/assets/icon/build-icns.sh" "$HERE/$PROG"; do
      /usr/bin/shasum -a 256 "$_f" | /usr/bin/cut -d ' ' -f 1
    done
    for _f in "$PLUGIN/assets/shed"/*.png "$PLUGIN/assets/shed/shed.json" "$PLUGIN/assets/visitors"/*.png "$PLUGIN/assets/visitors/visitors.json" "$COCO"/*.json "$COCO"/*.bin "$CLAUDIE"/*/*.png "$QUOTA_WORDS/quota.json" "$QUOTA_WORDS/languages.json"; do
      if [ -f "$_f" ]; then /usr/bin/shasum -a 256 "$_f" | /usr/bin/cut -d ' ' -f 1; fi
    done
  } | /usr/bin/shasum -a 256 | /usr/bin/cut -c 1-16
}

# macOS ties an Accessibility permission to the app's signature, and an ad hoc one changes with every build (owner's
# card 10-21: a rebuild should not ask again). So the app is signed with a self-signed identity of this Mac's own, made
# once in the login keychain (ten years, code signing only, never trusted for anything else). Prints its name, or -
# (ad hoc) when it is not there and cannot be made.
sign_identity() {
  if /usr/bin/security find-identity -p codesigning 2>/dev/null | /usr/bin/grep -qF "\"$SIGN_NAME\""; then
    printf '%s' "$SIGN_NAME"
    return 0
  fi
  _keys="$STAGE/identity"
  /bin/mkdir -m 700 "$_keys" || { printf '%s' -; return 0; }
  /usr/bin/printf '[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=%s\n[ext]\nbasicConstraints=critical,CA:false\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=critical,codeSigning\n' "$SIGN_NAME" >"$_keys/cert.cnf"
  _pass=$(/usr/bin/openssl rand -hex 16 2>/dev/null) || _pass=
  if [ -n "$_pass" ] &&
    /usr/bin/openssl req -x509 -newkey rsa:2048 -nodes -keyout "$_keys/key.pem" -out "$_keys/cert.pem" -days 3650 -config "$_keys/cert.cnf" >/dev/null 2>&1 &&
    /usr/bin/openssl pkcs12 -export -inkey "$_keys/key.pem" -in "$_keys/cert.pem" -name "$SIGN_NAME" -out "$_keys/id.p12" -passout "pass:$_pass" >/dev/null 2>&1 &&
    /usr/bin/security import "$_keys/id.p12" -P "$_pass" -T /usr/bin/codesign >/dev/null 2>&1; then
    /bin/rm -rf "$_keys"
    say "Made the signing identity \"$SIGN_NAME\" in your login keychain; a rebuilt $NAME keeps its Accessibility permission." >&2
    printf '%s' "$SIGN_NAME"
    return 0
  fi
  /bin/rm -rf "$_keys"
  warn "could not make a signing identity; signing ad hoc, so a rebuild asks for Accessibility again"
  printf '%s' -
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
  for _f in "$SRC/Info.plist" "$FRAMES/01-idle-reading.png" "$PIXELS/01-idle-reading.png"; do
    [ -f "$_f" ] || die "missing $_f; is the plugin complete?"
  done
  preflight
  STAGE=$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/coco-companion.XXXXXX") || die "cannot create a temp folder"
  NEW="$STAGE/$NAME.app"
  /bin/mkdir -p "$NEW/Contents/MacOS" "$NEW/Contents/Resources/frames" "$NEW/Contents/Resources/pixel"
  /usr/bin/sed "s/@VERSION@/$VERSION/g" "$SRC/Info.plist" >"$NEW/Contents/Info.plist"
  /bin/cp "$FRAMES"/*.png "$NEW/Contents/Resources/frames/"
  /bin/cp "$PIXELS"/*.png "$NEW/Contents/Resources/pixel/"
  if [ -d "$PLUGIN/assets/shed" ]; then
    /bin/mkdir -p "$NEW/Contents/Resources/shed"
    /bin/cp "$PLUGIN/assets/shed"/*.png "$PLUGIN/assets/shed"/shed.json "$NEW/Contents/Resources/shed/"
  fi
  if [ -d "$PLUGIN/assets/visitors" ]; then
    /bin/mkdir -p "$NEW/Contents/Resources/visitors"
    /bin/cp "$PLUGIN/assets/visitors"/*.png "$PLUGIN/assets/visitors"/visitors.json "$NEW/Contents/Resources/visitors/"
  fi
  if [ -f "$COCO/band-A.json" ] && [ -f "$COCO/band-B.json" ]; then
    /bin/mkdir -p "$NEW/Contents/Resources/coco"
    /bin/cp "$COCO"/*.json "$COCO"/*.bin "$NEW/Contents/Resources/coco/"  # pictures: X.bin beside X.json
  fi
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
  _sign=$(sign_identity)
  /usr/bin/codesign --force --sign "$_sign" --identifier "$LABEL" "$NEW" >/dev/null 2>&1 ||
    { [ "$_sign" != - ] && /usr/bin/codesign --force --sign - --identifier "$LABEL" "$NEW" >/dev/null 2>&1; } ||
    die "codesign could not sign the app; nothing was installed"
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
    [ "$(installed_build)" = "$(source_hash)" ] || say "                (this plugin's source is newer: run install to rebuild)"
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
  _hash=$(source_hash)
  if [ -x "$OLD_APP/Contents/MacOS/$EXE" ] && [ "$(/bin/cat "$OLD_APP/Contents/Resources/build.txt" 2>/dev/null || true)" = "$_hash" ]; then
    stop_it quiet || die "could not stop the running companion; nothing was moved"
    "$CONTROL" ensure-dir "$APPS"
    "$CONTROL" private-dir "$DIR"
    if [ -e "$APP" ]; then
      to_trash "$APP" || die "could not move the previous build to the Trash; nothing was moved"
      say "The previous build went to the Trash."
    fi
    /bin/mv "$OLD_APP" "$APP"
    say "Moved $NAME from its old location to $APP (build $_hash); keeping the same binary and its Accessibility permission."
  fi
  if [ -x "$BIN" ] && [ "$(installed_build)" = "$_hash" ]; then
    say "Already built from this source (build $_hash); keeping it, so an Accessibility permission stays valid."
  else
    say "Building $NAME $VERSION from source with swiftc (takes a few seconds)..."
    build "$_hash"
    stop_it quiet || die "could not stop the running companion; nothing was replaced"
    "$CONTROL" ensure-dir "$APPS"
    "$CONTROL" private-dir "$DIR"
    if [ -e "$APP" ]; then
      to_trash "$APP" || die "could not move the previous build to the Trash; nothing was replaced"
      say "The previous build went to the Trash."
    fi
    /bin/mv "$NEW" "$APP"
    say "Installed $APP (build $_hash)."
  fi
  if [ -e "$OLD_APP" ]; then
    stop_it quiet || die "could not stop the running companion; the app at the old location was not retired"
    to_trash "$OLD_APP" || die "could not move the app at the old location to the Trash"
    say "The app at the old location went to the Trash."
  fi
  "$CONTROL" private-dir "$DIR"
  if [ "$LOGIN" -eq 1 ] || [ -f "$AGENT" ]; then
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
