#!/bin/sh
# icon-macos.sh - give the Claude desktop app the Coco icon (macOS only).
#
# Usage: icon-macos.sh apply | clear | status [--app PATH] [--choice NAME] [--icon FILE] [--dry-run]
#
# What it does
#   apply   Builds an .icns from the chosen assets/icon/claude-tile-NAME-1024.png in a temp folder (sips and
#           the bundled byte-preserving ICNS packer), sets it as the custom icon of the app, then deletes the
#           temp folder. The icon is set with the same macOS call Finder uses for "Get Info > paste
#           icon" (NSWorkspace setIcon:forFile:options:, reached through osascript / JXA).
#           Nothing is compiled, downloaded or sent anywhere.
#   clear   Removes the custom icon, so the app shows its stock icon again.
#   status  Reads the custom-icon markers and compares the current image (never writes).
#
# Options
#   --app PATH       App bundle to change. Default: /Applications/Claude.app
#   --choice NAME    Which of the four pictures: coco (the default), dake, keycap or ornament.
#                    Status counts any of the four as own, and the badge of earlier builds as legacy.
#   --icon FILE      Picture for apply: a PNG (turned into an .icns on the fly) or a ready .icns.
#                    Default: ../assets/icon/claude-tile-NAME-1024.png for the --choice
#   --dry-run        Print what would happen and change nothing
#   --report         Emit exactly icon: own|legacy|stock|custom|unknown; diagnostics go to stderr
#
# Known limit: macOS "App Management" may stop Terminal (or any app that is not the app's own
# developer) from modifying Claude.app. Running this from inside a Claude desktop Code session
# works, because that process belongs to the same developer. Otherwise open System Settings >
# Privacy & Security > App Management and switch on your terminal app, then run it again.
#
# Claude updates replace the app bundle and drop the custom icon; run `apply` again afterwards.
# License: MIT. Part of Coco, an unofficial fan skin. Claude is a trademark of Anthropic.

set -eu
# System tools never inherit the invoking session's search path.
PATH=/usr/bin:/bin:/usr/sbin:/sbin
export PATH

PROG=icon-macos.sh
DEFAULT_APP=/Applications/Claude.app
REPORT=0
RESTORE_KEY=0
REPORTED=0
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

usage() {
  printf '%s\n' "$ICON_S19"
  printf '%s\n' "$PROG apply|clear|status [--app PATH] [--icon FILE] [--dry-run] [--report]"
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
. "$HERE/../assets/icon/words.sh"
CR=$(printf '\r')

# ---- arguments ---------------------------------------------------------------------------

CMD=
APP=$DEFAULT_APP
ICON_ASSETS=$(cd "$HERE/.." 2>/dev/null && pwd -P)/assets/icon
CHOICE=coco
OWN_ICON=
OWN_APP_ICON=$ICON_ASSETS/coco-1024.png
ICON=
EXPLICIT_ICON=0
DRY=0
REVOKE_CONSENT=0
EXIT_CODE=0
MEASURED_APPLY_STATE=

while [ $# -gt 0 ]; do
  case $1 in
    apply | clear | status)
      [ -z "$CMD" ] || die unknown
      CMD=$1
      ;;
    --app)
      [ $# -ge 2 ] || die unknown
      APP=$2
      shift
      ;;
    --app=*) APP=${1#--app=} ;;
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
    --refresh-dock) die "$ICON_S19" ;;
    --dry-run) DRY=1 ;;
    --revoke-consent) REVOKE_CONSENT=1 ;;
    --report) REPORT=1 ;;
    --restore-key) RESTORE_KEY=1 ;;
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
OWN_ICON=$ICON_ASSETS/claude-tile-$CHOICE-1024.png
[ "$EXPLICIT_ICON" -eq 1 ] || ICON=$OWN_ICON

if [ -z "$CMD" ]; then
  usage >&2
  exit 2
fi
if [ "$REPORT" -eq 1 ]; then exec 1>&2; fi

if [ "$RESTORE_KEY" -eq 1 ] && { [ "$CMD" != status ] || [ "$REPORT" -ne 1 ]; }; then
  die unknown
fi

# Consent records a choice, never the measured image state. Dry-run remains read-only.
CONSENT_FILE="${COCO_ICON_CONSENT_FILE:-$HOME/Library/Application Support/Coco-presence/app-icon-consent}"
if [ "$REVOKE_CONSENT" -eq 1 ]; then
  [ "$CMD" = clear ] || die "$ICON_S19"
  [ "$DRY" -eq 1 ] || /bin/rm -f "$CONSENT_FILE"
fi
if [ "$CMD" = apply ] && [ "$DRY" -eq 0 ]; then
  [ -r "$CONSENT_FILE" ] && [ "$(/bin/cat "$CONSENT_FILE")" = on ] || die "$ICON_S9"
fi
# An explicit permitted action releases the conservative automatic-attempt block.
AUTO_BLOCK_FILE="${CONSENT_FILE%/*}/app-icon-auto-block"
if [ "$DRY" -eq 0 ] && { [ "$CMD" = apply ] || [ "$CMD" = clear ]; }; then
  /bin/rm -f "$AUTO_BLOCK_FILE"
fi

# ---- preconditions -----------------------------------------------------------------------

[ "$(/usr/bin/uname -s)" = Darwin ] || die unknown
[ -x /usr/bin/osascript ] || die unknown

# Tidy a trailing slash so messages and the Icon file path are clean.
case $APP in
  /) die unknown ;;
  */) APP=${APP%/} ;;
esac

case $APP in
  *.app) ;;
  *) die unknown ;;
esac
[ -d "$APP" ] || die unknown
[ -f "$APP/Contents/Info.plist" ] || die unknown

if [ "$CMD" = apply ]; then
  [ -f "$ICON" ] || die unknown
fi

# ---- helpers (read only) -----------------------------------------------------------------

# Prints yes/no/unknown. A denied read is not evidence that the stock icon is active.
finder_flag() {
  _attrs=$(/usr/bin/xattr "$APP" 2>/dev/null) || { say unknown; return; }
  if ! printf '%s\n' "$_attrs" | /usr/bin/grep -qx com.apple.FinderInfo; then
    say no
    return
  fi
  _hex=$(/usr/bin/xattr -px com.apple.FinderInfo "$APP" 2>/dev/null) || { say unknown; return; }
  _hex=$(printf '%s' "$_hex" | /usr/bin/tr -d ' \n')
  _byte=$(printf '%s' "$_hex" | /usr/bin/cut -c17-18)
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

# Prints own/legacy/stock/custom/unknown from the bundle custom-icon flag and actual resource.
# No flag and no IconCR is stock. Active custom icns resources never consult NSWorkspace.
# Valid older maps without icns alone use a conservative Workspace fallback; no receipt is trusted.
# Return an opaque read-only snapshot. Device/inode identify replacement even at the same version.
# File metadata is checked around the content read; bundle-root dates change on icon presses.
restore_snapshot() (
  _restore_file=$1
  [ -r "$_restore_file" ] || exit 1
  _restore_identity=$(/usr/bin/stat -c '%d:%i:%Y:%s' "$_restore_file" 2>/dev/null) ||
    _restore_identity=$(/usr/bin/stat -f '%d:%i:%m:%z' "$_restore_file" 2>/dev/null) || exit 1
  _restore_content=$(/usr/bin/cksum <"$_restore_file") || exit 1
  _restore_after=$(/usr/bin/stat -c '%d:%i:%Y:%s' "$_restore_file" 2>/dev/null) ||
    _restore_after=$(/usr/bin/stat -f '%d:%i:%m:%z' "$_restore_file" 2>/dev/null) || exit 1
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
  printf 'restore-key: macos:%s\n' "$_restore_last"
}

icon_state() {
  _restore_before=
  if [ "$RESTORE_KEY" -eq 1 ]; then _restore_before=$(restore_snapshot "$APP/Contents/Info.plist") || _restore_before=; fi
  _flag=$(finder_flag)
  _file=$(icon_file)
  case $_flag:$_file in
    no:no) stock_report "$APP/Contents/Info.plist" "$_restore_before"; return ;;
    yes:yes) ;;
    *) say unknown; return ;;
  esac
  [ -f "$OWN_ICON" ] || { say unknown; return; }
  _result=$(/usr/bin/osascript -l JavaScript -e "$JXA_COMPARE" "$APP" "$OWN_ICON" "$HERE/../assets/icon/recognise-0.1-64.png" 2>/dev/null) || {
    say unknown
    return
  }
  # Another of the four pictures is ours too; the badge earlier builds put on is an earlier version's.
  if [ "$_result" = custom ]; then
    for _other in coco dake keycap ornament badge; do
      [ "$_other" != "$CHOICE" ] || continue
      _other_icon=$ICON_ASSETS/claude-tile-$_other-1024.png
      [ "$_other" != badge ] || _other_icon=$ICON_ASSETS/claude-tile-1024.png
      [ -f "$_other_icon" ] || continue
      _other_result=$(/usr/bin/osascript -l JavaScript -e "$JXA_COMPARE" "$APP" "$_other_icon" "$HERE/../assets/icon/recognise-0.1-64.png" 2>/dev/null) || {
        say unknown
        return
      }
      [ "$_other_result" = own ] || continue
      if [ "$_other" = badge ]; then _result=legacy; else _result=own; fi
      break
    done
  fi
  case $_result in
    own | legacy | custom) say "$_result" ;;
    *) say unknown ;;
  esac
}

# Parse the actual IconCR named fork, then decode its custom icns resource with AppKit.
# Exact current pixels identify own; matched shape and colour gates identify legacy per image chunk.
# Read, bounds, map and decoder failures return unknown instead of trusting cached Workspace art.
# shellcheck disable=SC2016
JXA_COMPARE='
ObjC.import("AppKit");
function normalized(image) {
  if (!image || image.isNil() || !image.isValid) { throw new Error("unreadable image"); }
  var bitmap = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(
    null, 64, 64, 8, 4, true, false, $.NSCalibratedRGBColorSpace, 0, 0);
  if (bitmap.isNil()) { throw new Error("cannot create bitmap"); }
  $.NSGraphicsContext.saveGraphicsState;
  try {
    $.NSGraphicsContext.setCurrentContext($.NSGraphicsContext.graphicsContextWithBitmapImageRep(bitmap));
    $.NSColor.clearColor.set;
    $.NSRectFillUsingOperation($.NSMakeRect(0, 0, 64, 64), $.NSCompositingOperationCopy);
    image.drawInRectFromRectOperationFractionRespectFlippedHints(
      $.NSMakeRect(0, 0, 64, 64), $.NSZeroRect, $.NSCompositingOperationCopy, 1, false, $());
  } finally { $.NSGraphicsContext.restoreGraphicsState; }
  var out = [], visible = 0;
  for (var y = 0; y < 64; y++) for (var x = 0; x < 64; x++) {
    var color = bitmap.colorAtXY(x, y);
    if (color.alphaComponent > 0) visible++;
    out.push(Math.round(color.redComponent * 255), Math.round(color.greenComponent * 255),
      Math.round(color.blueComponent * 255), Math.round(color.alphaComponent * 255));
  }
  if (!visible) { throw new Error("empty rendered image"); }
  return out;
}
var limit = 16777216;
function check(position, length, end) {
  if (position < 0 || length < 0 || position % 1 || length % 1 || position + length > end) throw new Error("invalid bounds");
}
function bytes(data) {
  if (!data || data.isNil() || Number(data.length) > limit) throw new Error("invalid data");
  var encoded = ObjC.unwrap(data.base64EncodedStringWithOptions(0));
  var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", table = {};
  for (var i = 0; i < alphabet.length; i++) table[alphabet[i]] = i;
  var output = new Uint8Array(Number(data.length)), position = 0;
  for (var j = 0; j < encoded.length; j += 4) {
    var a = table[encoded[j]], b = table[encoded[j + 1]], c = table[encoded[j + 2]] || 0, d = table[encoded[j + 3]] || 0;
    if (position < output.length) output[position++] = (a << 2) | (b >> 4);
    if (position < output.length) output[position++] = (b << 4) | (c >> 2);
    if (position < output.length) output[position++] = (c << 6) | d;
  }
  return output;
}
function dataOf(input) {
  var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", encoded = "";
  for (var i = 0; i < input.length; i += 3) {
    var a = input[i], b = input[i + 1] || 0, c = input[i + 2] || 0;
    encoded += alphabet[a >> 2] + alphabet[((a & 3) << 4) | (b >> 4)] +
      (i + 1 < input.length ? alphabet[((b & 15) << 2) | (c >> 6)] : "=") +
      (i + 2 < input.length ? alphabet[c & 63] : "=");
  }
  return $.NSData.alloc.initWithBase64EncodedStringOptions($(encoded), 0);
}
function readBounded(path) {
  var handle = $.NSFileHandle.fileHandleForReadingAtPath($(path));
  if (handle.isNil()) throw new Error("unreadable data");
  try {
    var length = Number(handle.seekToEndOfFile);
    if (length < 0 || length > limit) throw new Error("oversized data");
    handle.seekToFileOffset(0);
    var data = handle.readDataOfLength(length);
    if (Number(data.length) !== length) throw new Error("short read");
    return data;
  } finally { handle.closeFile; }
}
function big(input, position, count) {
  check(position, count, input.length);
  var value = 0;
  for (var i = 0; i < count; i++) value = value * 256 + input[position + i];
  return value;
}
function resource(input) {
  check(0, 16, input.length);
  var dataStart = big(input, 0, 4), mapStart = big(input, 4, 4), dataLength = big(input, 8, 4), mapLength = big(input, 12, 4);
  check(dataStart, dataLength, input.length); check(mapStart, mapLength, input.length);
  if (dataStart < 16 || mapStart < 16 || mapLength < 28 ||
      (dataStart < mapStart + mapLength && mapStart < dataStart + dataLength)) throw new Error("overlapping resource regions");
  for (var i = 0; i < 16; i++) if (input[mapStart + i] !== input[i]) throw new Error("invalid map header");
  var types = mapStart + big(input, mapStart + 24, 2), names = mapStart + big(input, mapStart + 26, 2), mapEnd = mapStart + mapLength;
  if (types < mapStart + 28 || names < types + 2 || names > mapEnd) throw new Error("invalid map lists");
  check(types, 2, names);
  var count = big(input, types, 2) + 1;
  if (count === 65536) count = 0;
  if (count > 256) throw new Error("oversized type list");
  check(types + 2, count * 8, names);
  var found = null, sawIconType = false, typeNames = {}, referenceRanges = [], dataRanges = [], totalReferences = 0;
  for (var t = 0; t < count; t++) {
    var entry = types + 2 + t * 8, type = big(input, entry, 4), references = big(input, entry + 4, 2) + 1;
    totalReferences += references;
    if (typeNames[type] || references > 4096 || totalReferences > 4096) throw new Error("invalid resource type");
    typeNames[type] = true;
    var start = types + big(input, entry + 6, 2), end = start + references * 12;
    if (start < types + 2 + count * 8) throw new Error("overlapping reference list");
    check(start, references * 12, names);
    for (var r = 0; r < referenceRanges.length; r++) if (start < referenceRanges[r][1] && referenceRanges[r][0] < end) throw new Error("overlapping references");
    referenceRanges.push([start, end]);
    var ids = {};
    for (var n = 0; n < references; n++) {
      var ref = start + n * 12, id = big(input, ref, 2), name = big(input, ref + 2, 2);
      if (ids[id]) throw new Error("duplicate resource ID");
      ids[id] = true;
      if (name !== 65535) {
        var nameStart = names + name; check(nameStart, 1, mapEnd);
        check(nameStart + 1, input[nameStart], mapEnd);
      }
      var payloadStart = dataStart + big(input, ref + 5, 3);
      check(payloadStart, 4, dataStart + dataLength);
      var length = big(input, payloadStart, 4), payloadEnd = payloadStart + 4 + length;
      check(payloadStart + 4, length, dataStart + dataLength);
      for (var q = 0; q < dataRanges.length; q++) if (payloadStart < dataRanges[q][1] && dataRanges[q][0] < payloadEnd) throw new Error("overlapping resource data");
      dataRanges.push([payloadStart, payloadEnd]);
      if (type === 1768124019) { // icns; custom Finder resource ID -16455.
        sawIconType = true;
        if (id === 49081) {
          if (found) throw new Error("ambiguous custom resource");
          found = input.subarray(payloadStart + 4, payloadEnd);
        }
      }
    }
  }
  if (sawIconType && !found) throw new Error("missing custom icon ID");
  return found;
}
function encodedDimensions(input, start, length) {
  var end = start + length;
  if (length >= 24 && big(input, start, 4) === 2303741511) {
    return [big(input, start + 16, 4), big(input, start + 20, 4)];
  }
  // JPEG2000 codestream SIZ, or JP2 header boxes; never decode unbounded dimensions.
  if (length >= 24 && big(input, start, 4) === 4283432785) {
    return [big(input, start + 8, 4) - big(input, start + 16, 4), big(input, start + 12, 4) - big(input, start + 20, 4)];
  }
  function boxes(position, stop, depth) {
    var count = 0;
    while (position < stop) {
      check(position, 8, stop);
      var size = big(input, position, 4), type = big(input, position + 4, 4), header = 8;
      if (size === 1) { check(position, 16, stop); if (big(input, position + 8, 4)) throw new Error("oversized JP2 box"); size = big(input, position + 12, 4); header = 16; }
      if (!size) size = stop - position;
      if (size < header || ++count > 64) throw new Error("invalid JP2 box");
      check(position, size, stop);
      if (type === 1768449138) { check(position + header, 8, position + size); return [big(input, position + header + 4, 4), big(input, position + header, 4)]; } // ihdr
      if (type === 1785737832 && depth < 2) { var result = boxes(position + header, position + size, depth + 1); if (result) return result; } // jp2h
      position += size;
    }
    return null;
  }
  return boxes(start, end, 0);
}
function validateICNS(input) {
  if (big(input, 0, 4) !== 1768124019 || big(input, 4, 4) !== input.length) throw new Error("invalid icns header");
  var position = 8, count = 0;
  while (position < input.length) {
    check(position, 8, input.length);
    var length = big(input, position + 4, 4);
    if (length < 8 || ++count > 128) throw new Error("invalid icns chunks");
    check(position, length, input.length);
    var type = String.fromCharCode(input[position], input[position + 1], input[position + 2], input[position + 3]);
    if (["icp4","icp5","icp6","ic07","ic08","ic09","ic10","ic11","ic12","ic13","ic14"].indexOf(type) >= 0) {
      var dimensions = encodedDimensions(input, position + 8, length - 8);
      if (!dimensions || dimensions[0] <= 0 || dimensions[1] <= 0 || dimensions[0] > 1024 || dimensions[1] > 1024) throw new Error("invalid encoded icon dimensions");
    }
    position += length;
  }
  if (position !== input.length || !count) throw new Error("empty icns");
}
function rgba(bitmap) {
  var width = Number(bitmap.pixelsWide), height = Number(bitmap.pixelsHigh);
  if (!width || !height || width > 1024 || height > 1024) throw new Error("invalid bitmap dimensions");
  // Public TIFF encoding avoids unsafe JXA C-pointer access and millions of ObjC pixel calls.
  var input = bytes(bitmap.TIFFRepresentationUsingCompressionFactor($.NSTIFFCompressionNone, 1));
  var little = input[0] === 73 && input[1] === 73;
  if (!little && !(input[0] === 77 && input[1] === 77)) throw new Error("invalid TIFF byte order");
  function number(position, count) {
    check(position, count, input.length); var result = 0;
    for (var i = 0; i < count; i++) result = result * 256 + input[position + (little ? count - i - 1 : i)];
    return result;
  }
  if (number(2, 2) !== 42) throw new Error("invalid TIFF");
  var directory = number(4, 4), count = number(directory, 2), tags = {};
  if (count > 128) throw new Error("oversized TIFF directory");
  check(directory + 2, count * 12 + 4, input.length);
  for (var t = 0; t < count; t++) {
    var entry = directory + 2 + t * 12, tag = number(entry, 2), type = number(entry + 2, 2), values = number(entry + 4, 4);
    if (tags[tag]) throw new Error("duplicate TIFF tag");
    if ([256,257,258,259,262,273,274,277,278,279,284,320,338,339].indexOf(tag) < 0) continue;
    var size = type === 1 ? 1 : type === 3 ? 2 : type === 4 ? 4 : 0;
    if (!size || values > 4096) throw new Error("invalid TIFF values");
    var start = values * size <= 4 ? entry + 8 : number(entry + 8, 4);
    check(start, values * size, input.length); tags[tag] = [];
    for (var j = 0; j < values; j++) tags[tag].push(number(start + j * size, size));
  }
  function value(tag, fallback) { return tags[tag] ? tags[tag][0] : fallback; }
  var samples = value(277, 1), photo = value(262, 2), rows = value(278, height), orientation = value(274, 1), associated = value(338, 2) === 1;
  if (value(256, 0) !== width || value(257, 0) !== height || value(259, 1) !== 1 || value(284, 1) !== 1 ||
      [1,4].indexOf(orientation) < 0 || !rows || !tags[258] || tags[258].some(function(v) { return v !== 8; }) ||
      (tags[339] && tags[339].some(function(v) { return v !== 1; }))) throw new Error("unsupported TIFF pixels");
  if ((photo === 2 && [3,4].indexOf(samples) < 0) || (photo === 1 && [1,2].indexOf(samples) < 0) ||
      (photo === 3 && (samples !== 1 || !tags[320] || tags[320].length !== 768)) || [1,2,3].indexOf(photo) < 0) throw new Error("unsupported TIFF colour");
  if (!tags[273] || !tags[279] || tags[273].length !== tags[279].length || tags[273].length !== Math.ceil(height / rows)) throw new Error("invalid TIFF strips");
  var output = new Uint8Array(width * height * 4), row = 0;
  for (var strip = 0; strip < tags[273].length; strip++) {
    var length = Math.min(rows, height - row) * width * samples, start = tags[273][strip];
    if (tags[279][strip] < length) throw new Error("short TIFF strip");
    check(start, tags[279][strip], input.length);
    for (var p = 0; p < length; p += samples) {
      var linear = row * width + p / samples, y = Math.floor(linear / width), x = linear % width;
      var at = ((orientation === 4 ? height - y - 1 : y) * width + x) * 4, alpha = 255, red, green, blue;
      if (photo === 2) { red = input[start + p]; green = input[start + p + 1]; blue = input[start + p + 2]; if (samples === 4) alpha = input[start + p + 3]; }
      else if (photo === 1) { red = green = blue = input[start + p]; if (samples === 2) alpha = input[start + p + 1]; }
      else { var index = input[start + p]; red = Math.round(tags[320][index] / 257); green = Math.round(tags[320][index + 256] / 257); blue = Math.round(tags[320][index + 512] / 257); }
      if (associated) { red = alpha ? Math.min(255, Math.round(red * 255 / alpha)) : 0; green = alpha ? Math.min(255, Math.round(green * 255 / alpha)) : 0; blue = alpha ? Math.min(255, Math.round(blue * 255 / alpha)) : 0; }
      output[at] = red; output[at + 1] = green; output[at + 2] = blue; output[at + 3] = alpha;
    }
    row += Math.min(rows, height - row);
  }
  return {width:width, height:height, pixels:output};
}
function decode(data) {
  var representations = $.NSBitmapImageRep.imageRepsWithData(data), best = null, area = 0;
  if (representations.isNil() || Number(representations.count) > 64) throw new Error("undecodable image");
  for (var i = 0; i < Number(representations.count); i++) {
    var candidate = representations.objectAtIndex(i), width = Number(candidate.pixelsWide), height = Number(candidate.pixelsHigh);
    if (!width || !height || width > 1024 || height > 1024) throw new Error("invalid representation");
    if (width * height > area) { best = candidate; area = width * height; }
  }
  if (!best) throw new Error("no bitmap representation");
  return rgba(best);
}
function samePixels(a, b) {
  if (a.width !== b.width || a.height !== b.height || a.pixels.length !== b.pixels.length) return false;
  for (var i = 0; i < a.pixels.length; i++) if (a.pixels[i] !== b.pixels[i]) return false;
  return true;
}
function sampled(image) {
  var out = new Uint8Array(16384), width = image.width, height = image.height, pixels = image.pixels;
  for (var y = 0; y < 64; y++) for (var x = 0; x < 64; x++) {
    var left = Math.floor(x * width / 64), right = Math.max(left + 1, Math.floor((x + 1) * width / 64));
    var top = Math.floor(y * height / 64), bottom = Math.max(top + 1, Math.floor((y + 1) * height / 64)), sum = [0,0,0,0], count = 0;
    for (var yy = top; yy < bottom; yy++) for (var xx = left; xx < right; xx++) {
      var at = (yy * width + xx) * 4, alpha = pixels[at + 3]; count++;
      for (var c = 0; c < 3; c++) sum[c] += pixels[at + c] * alpha / 255;
      sum[3] += alpha;
    }
    var output = (y * 64 + x) * 4;
    for (var channel = 0; channel < 4; channel++) out[output + channel] = Math.round(sum[channel] / count);
  }
  return out;
}
function difference(a, b) {
  if (a.length !== b.length || !a.length) throw new Error("invalid bitmap");
  var sum = 0;
  for (var i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}
// Resolution-specific references follow the historical sips representations, without alignment.
function matchedLegacy(actual, argv, cache) {
  if (actual.width !== actual.height || [16,32,64,128,256,512,1024].indexOf(actual.width) < 0) return null;
  if (cache && cache[actual.width]) return cache[actual.width];
  var source = argv[5] || argv[2].replace(/[^/]+$/, actual.width === 1024 ?
    "recognise-0.1-source-1024.png" : "recognise-0.1-rep-" + actual.width + ".png");
  var reference = decode(readBounded(source));
  if (reference.width !== actual.width || reference.height !== actual.height) throw new Error("mismatched legacy reference");
  var result = sampled(reference);
  if (cache) cache[actual.width] = result;
  return result;
}
function legacyFeatures(actual, reference) {
  if (!reference) return null;
  var intersection = 0, union = 0, opaqueDistance = 0, gradientDistance = 0, edges = 0;
  function opaqueRGB(image, at, channel) { return image[at + channel] * 255 / image[at + 3]; }
  for (var y = 0; y < 64; y++) for (var x = 0; x < 64; x++) {
    var at = (y * 64 + x) * 4, a = actual[at + 3] >= 128, b = reference[at + 3] >= 128;
    if (a || b) union++;
    if (!a || !b) continue;
    intersection++;
    for (var c = 0; c < 3; c++) opaqueDistance += Math.abs(opaqueRGB(actual, at, c) - opaqueRGB(reference, at, c));
    var neighbours = [];
    if (x < 63) neighbours.push(at + 4);
    if (y < 63) neighbours.push(at + 256);
    for (var n = 0; n < neighbours.length; n++) {
      var next = neighbours[n];
      if (actual[next + 3] < 128 || reference[next + 3] < 128) continue;
      edges++;
      for (var channel = 0; channel < 3; channel++) {
        var actualGradient = opaqueRGB(actual, next, channel) - opaqueRGB(actual, at, channel);
        var referenceGradient = opaqueRGB(reference, next, channel) - opaqueRGB(reference, at, channel);
        gradientDistance += Math.abs(actualGradient - referenceGradient);
      }
    }
  }
  // Empty, nearly invisible or isolated-pixel pictures have insufficient evidence for legacy.
  if (intersection < 16 || union < 16 || edges < 16) return null;
  return {alphaIoU:intersection / union, maskError:1 - intersection / union,
    gradient:gradientDistance / (edges * 3), color:difference(actual, reference),
    opaqueColor:opaqueDistance / (intersection * 3), opaquePixels:intersection, comparedEdges:edges};
}
// Measured classic RGB/mask icons use exactly three RLE planes, with no ignored tail.
function legacyClassicRLE(input, start, end, pixels, prefix) {
  if (prefix) {
    if (end - start < 4) return false;
    for (var p = 0; p < 4; p++) if (input[start + p] !== 0) return false;
    start += 4;
  }
  for (var channel = 0; channel < 3; channel++) {
    var produced = 0;
    while (produced < pixels) {
      if (start >= end) return false;
      var control = input[start++], count;
      if (control < 128) {
        count = control + 1;
        if (start + count > end) return false;
        start += count;
      } else {
        count = control - 125;
        if (start >= end) return false;
        start++;
      }
      if (produced + count > pixels) return false;
      produced += count;
    }
  }
  return start === end;
}
// Metadata is never decoded as an image or unarchived as executable objects.
// The info dictionary matches locally generated iconutil archives. TOC entries
// describe chunk headers (a subset is allowed); they do not supply byte offsets.
function legacyMetadataValid(type, payload, chunkLengths) {
  try {
    if (type === "info") {
      if (!payload.length) return false;
      var plist = $.NSPropertyListSerialization.propertyListWithDataOptionsFormatError(dataOf(payload), 0, Ref(), Ref());
      return !plist.isNil() && Boolean(plist.isKindOfClass($.NSDictionary));
    }
    if (type === "name") {
      if (!payload.length) return false;
      return !$.NSString.alloc.initWithDataEncoding(dataOf(payload), $.NSUTF8StringEncoding).isNil();
    }
    if (type === "icnV") {
      if (payload.length !== 4) return false;
      var version = big(payload, 0, 4);
      return (version >>> 31) === 0 && ((version >>> 23) & 255) !== 255;
    }
    if (type === "TOC ") {
      if (!payload.length || payload.length % 8 !== 0) return false;
      var entries = {};
      for (var offset = 0; offset < payload.length; offset += 8) {
        var chunk = String.fromCharCode(payload[offset], payload[offset + 1], payload[offset + 2], payload[offset + 3]);
        var length = big(payload, offset + 4, 4);
        if (length < 8 || entries[chunk] || chunkLengths[chunk] !== length) return false;
        entries[chunk] = true;
      }
      return true;
    }
  } catch (error) { return false; }
  return false;
}
// Legacy recognition accepts only measured historical image codecs, complete masks
// and the four known non-image metadata chunks after validating their contents.
// This extra structure gate follows exact own recognition; it never narrows own.
function legacyEligibility(input, representations) {
  var imageTypes = ["icp4","icp5","icp6","ic07","ic08","ic09","ic10","ic11","ic12","ic13","ic14",
    "ic04","ic05","is32","il32","it32"];
  var maskOwners = {s8mk:"is32", l8mk:"il32", t8mk:"it32"}, maskSizes = {s8mk:256, l8mk:1024, t8mk:16384};
  var metadataTypes = ["info","name","TOC ","icnV"], metadata = [], chunkLengths = {}, seen = {}, images = 0, position = 8;
  var classicPixels = {is32:256, il32:1024, it32:16384};
  while (position < input.length) {
    check(position, 8, input.length);
    var type = String.fromCharCode(input[position], input[position + 1], input[position + 2], input[position + 3]);
    var length = big(input, position + 4, 4);
    if (length < 8) throw new Error("invalid legacy chunk");
    check(position, length, input.length);
    if (seen[type]) return {eligible:false, reason:"duplicate-chunk", chunk:type};
    seen[type] = true;
    chunkLengths[type] = length;
    if (metadataTypes.indexOf(type) >= 0) {
      metadata.push({type:type, payload:input.subarray(position + 8, position + length)});
      position += length;
      continue;
    }
    if (imageTypes.indexOf(type) < 0 && !maskOwners[type]) return {eligible:false, reason:"unknown-chunk", chunk:type};
    if (classicPixels[type] && !legacyClassicRLE(input, position + 8, position + length, classicPixels[type], type === "it32")) {
      return {eligible:false, reason:"invalid-classic-rle", chunk:type};
    }
    if (maskOwners[type]) {
      if (length - 8 !== maskSizes[type]) return {eligible:false, reason:"invalid-mask-size", chunk:type};
    } else if (++images > 16) return {eligible:false, reason:"too-many-image-chunks"};
    position += length;
  }
  for (var mask in maskOwners) {
    if (!!seen[mask] !== !!seen[maskOwners[mask]]) return {eligible:false, reason:"orphan-classic-mask", chunk:mask};
  }
  for (var m = 0; m < metadata.length; m++) {
    if (!legacyMetadataValid(metadata[m].type, metadata[m].payload, chunkLengths)) {
      return {eligible:false, reason:"invalid-metadata", chunk:metadata[m].type};
    }
  }
  if (!images) return {eligible:false, reason:"no-image-chunks"};
  if (representations) for (var r = 0; r < representations.length; r++) {
    if (representations[r].error) return {eligible:false, reason:"image-chunk-decode-failed", chunk:representations[r].chunk};
  }
  return {eligible:true, reason:"measured-image-codecs", imageChunks:images};
}
// Decode every image chunk independently: the whole-container decoder may ignore a small chunk.
function legacyRepresentations(data, actual, argv, referenceCache) {
  var input = bytes(data), eligibility = legacyEligibility(input), rows = [], cache = referenceCache || {}, chunks = [], masks = {}, position = 8;
  if (!eligibility.eligible) return [{index:null, width:null, height:null, features:null, error:eligibility.reason}];
  var expected = {icp4:16, icp5:32, icp6:64, ic07:128, ic08:256, ic09:512, ic10:1024,
    ic11:32, ic12:64, ic13:256, ic14:512, ic04:16, ic05:32, is32:16, il32:32, it32:128};
  var maskTypes = {is32:"s8mk", il32:"l8mk", it32:"t8mk"};
  while (position < input.length) {
    check(position, 8, input.length);
    var type = String.fromCharCode(input[position], input[position + 1], input[position + 2], input[position + 3]);
    var length = big(input, position + 4, 4); check(position, length, input.length);
    var chunk = {type:type, bytes:input.subarray(position, position + length)};
    if (expected[type]) chunks.push(chunk);
    else if (["s8mk","l8mk","t8mk"].indexOf(type) >= 0) masks[type] = chunk.bytes;
    position += length;
  }
  for (var i = 0; i < chunks.length; i++) {
    var current = chunks[i], mask = masks[maskTypes[current.type]], image, bitmapCount = 0;
    try {
      var isolatedData = data;
      if (chunks.length !== 1) {
        var size = 8 + current.bytes.length + (mask ? mask.length : 0), isolated = new Uint8Array(size);
        isolated.set([105,99,110,115,(size >>> 24) & 255,(size >>> 16) & 255,(size >>> 8) & 255,size & 255]);
        isolated.set(current.bytes, 8);
        if (mask) isolated.set(mask, 8 + current.bytes.length);
        isolatedData = dataOf(isolated);
      }
      var representations = $.NSBitmapImageRep.imageRepsWithData(isolatedData);
      bitmapCount = representations.isNil() ? 0 : Number(representations.count);
      if (bitmapCount !== 1) throw new Error("unsupported image chunk bitmap count");
      // Exactly one bitmap in a single-image container makes the old largest decode unambiguous.
      image = chunks.length === 1 ? actual : rgba(representations.objectAtIndex(0));
      if (image.width !== expected[current.type] || image.height !== expected[current.type]) throw new Error("image chunk size mismatch");
      rows.push({index:i, chunk:current.type, width:image.width, height:image.height, bitmapCount:bitmapCount,
        features:legacyFeatures(sampled(image), matchedLegacy(image, argv, cache))});
    } catch (error) {
      rows.push({index:i, chunk:current.type, width:null, height:null, bitmapCount:bitmapCount, features:null, error:String(error)});
    }
  }
  return rows;
}
// Calibrated across historical codecs, colour shifts and actual AppKit-written resources.
// The mask bound is below one 64 px binary-mask pixel (1 / 4096).
var legacyBounds = {maskError:0.00005, gradient:0.6, color:1.25, opaqueColor:2.5};
function legacyAccepted(features, width) {
  if (typeof width !== "number" || [16,32,64,128,256,512,1024].indexOf(width) < 0 || !features) return false;
  var keys = ["maskError", "gradient", "color", "opaqueColor"];
  for (var i = 0; i < keys.length; i++) {
    var value = features[keys[i]];
    if (typeof value !== "number" || !isFinite(value) || value < 0 || value > legacyBounds[keys[i]]) return false;
  }
  return true;
}
function legacyAllAccepted(rows, eligibility) {
  if (!eligibility || eligibility.eligible !== true || !rows || !rows.length || rows.length > 16 ||
      rows.length !== eligibility.imageChunks) return false;
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (!row || row.error || row.bitmapCount !== 1 || row.height !== row.width || !legacyAccepted(row.features, row.width)) return false;
  }
  return true;
}
function run(argv) {
  var measure = argv[3] === "measure", backend = "resource";
  try {
    var own = decode(readBounded(argv[1])), legacy = measure ? decode(readBounded(argv[2])) : null;
    if (measure && argv[4]) {
      var stock = decode(readBounded(argv[4])), stock64 = sampled(stock);
      return JSON.stringify({backend:"stock-source", source:"explicit-calibration-image", state:"stock", exactCurrent:samePixels(stock, own),
        own:difference(stock64, sampled(own)), legacy:difference(stock64, sampled(legacy)), width:stock.width, height:stock.height,
        legacyFeatures:legacyFeatures(stock64, matchedLegacy(stock, argv)), legacyBounds:legacyBounds});
    }
    var input = bytes(readBounded(argv[0] + "/Icon\r/..namedfork/rsrc")), icon = resource(input);
    if (!icon) {
      backend = "workspace";
      // Only valid maps lacking icns can reach this conservative older-format fallback.
      var image = $.NSWorkspace.sharedWorkspace.iconForFile($(argv[0]));
      var actualFallback = normalized(image);
      if (!measure) return "custom";
      for (var f = 0; f < actualFallback.length; f += 4) {
        for (var channel = 0; channel < 3; channel++) actualFallback[f + channel] = Math.round(actualFallback[f + channel] * actualFallback[f + 3] / 255);
      }
      return JSON.stringify({backend:backend, source:"valid-resource-map-without-icns", state:"custom", exactCurrent:false,
        own:difference(actualFallback, sampled(own)), legacy:difference(actualFallback, sampled(legacy)), legacyBounds:legacyBounds});
    }
    validateICNS(icon);
    var iconData = dataOf(icon), actual = decode(iconData), exactCurrent = samePixels(actual, own);
    // The exact largest-pixel rule for own is unchanged and avoids all legacy work.
    if (exactCurrent && !measure) return "own";
    var eligibility = legacyEligibility(icon), representations = [], features = null, referenceCache = {}, actual64 = null;
    if (measure || eligibility.eligible) {
      actual64 = sampled(actual);
      features = legacyFeatures(actual64, matchedLegacy(actual, argv, referenceCache));
    }
    // A failed largest-image gate cannot be repaired by any remaining representation.
    if (measure || (eligibility.eligible && legacyAccepted(features, actual.width))) {
      representations = legacyRepresentations(iconData, actual, argv, referenceCache);
      eligibility = legacyEligibility(icon, representations);
    }
    var state = "custom";
    if (exactCurrent) state = "own";
    else if (legacyAccepted(features, actual.width) && legacyAllAccepted(representations, eligibility)) state = "legacy";
    if (!measure) return state;
    var alpha = 0, visible = 0;
    for (var i = 3; i < actual64.length; i += 4) { alpha += actual64[i]; if (actual64[i]) visible++; }
    return JSON.stringify({backend:backend, source:"custom-icns-resource", state:state, exactCurrent:exactCurrent,
      own:difference(actual64, sampled(own)), legacy:difference(actual64, sampled(legacy)), width:actual.width, height:actual.height,
      alphaMean:alpha / 4096, visible:visible, legacyFeatures:features, legacyRepresentations:representations,
      legacyEligibility:eligibility, legacyBounds:legacyBounds});
  } catch (error) {
    return measure ? JSON.stringify({backend:backend, state:"unknown", exactCurrent:false, own:null, legacy:null,
      legacyBounds:legacyBounds, error:String(error)}) : "unknown";
  }
}
'


print_limit_note() { :; }

# Temp folder for the icon build; removed on every exit path.
WORK=
cleanup() {
  if [ -n "$WORK" ] && [ -d "$WORK" ]; then
    /bin/rm -rf "$WORK"
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
  [ -x /usr/bin/sips ] || die unknown
  WORK=$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/coco-icon.XXXXXX") || die unknown
  _set=$WORK/coco.iconset
  /bin/mkdir "$_set"
  # Resize once per distinct pixel size, then copy to the iconset names (the @2x names reuse sizes).
  for _px in 16 32 64 128 256 512 1024; do
    /usr/bin/sips -z "$_px" "$_px" "$ICON" --out "$WORK/s$_px.png" >/dev/null 2>&1 ||
      die unknown
  done
  # Use tuned small representations only for reviewed bundled pictures.
  case $ICON in
    "$ICON_ASSETS"/claude-tile-coco-1024.png | "$ICON_ASSETS"/claude-tile-dake-1024.png | \
    "$ICON_ASSETS"/claude-tile-keycap-1024.png | "$ICON_ASSETS"/claude-tile-ornament-1024.png)
      /bin/cp "${ICON%-1024.png}-16.png" "$WORK/s16.png"
      /bin/cp "${ICON%-1024.png}-32.png" "$WORK/s32.png"
      ;;
    "$OWN_APP_ICON")
      /bin/cp "$HERE/../assets/icon/coco-16.png" "$WORK/s16.png"
      /bin/cp "$HERE/../assets/icon/coco-32.png" "$WORK/s32.png"
      ;;
  esac
  /bin/cp "$WORK/s16.png" "$_set/icon_16x16.png"
  /bin/cp "$WORK/s32.png" "$_set/icon_16x16@2x.png"
  /bin/cp "$WORK/s32.png" "$_set/icon_32x32.png"
  /bin/cp "$WORK/s64.png" "$_set/icon_32x32@2x.png"
  /bin/cp "$WORK/s128.png" "$_set/icon_128x128.png"
  /bin/cp "$WORK/s256.png" "$_set/icon_128x128@2x.png"
  /bin/cp "$WORK/s256.png" "$_set/icon_256x256.png"
  /bin/cp "$WORK/s512.png" "$_set/icon_256x256@2x.png"
  /bin/cp "$WORK/s512.png" "$_set/icon_512x512.png"
  /bin/cp "$WORK/s1024.png" "$_set/icon_512x512@2x.png"
  /bin/sh "$HERE/../assets/icon/build-icns.sh" "$_set" "$WORK/coco.icns" ||
    die unknown
  ICNS_FILE=$WORK/coco.icns
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
  if (ok) { ws.noteFileSystemChanged($(target)); }
  return ok ? "OK" : "FAIL:macOS refused to change the icon";
}
'

LAST_FAIL=
run_jxa() {
  # run_jxa MODE [ICON]; returns 0 on OK. Sets LAST_FAIL=icon when the icon file itself is the problem.
  _out=$(/usr/bin/osascript -l JavaScript -e "$JXA" "$1" "$APP" "${2:-}" 2>&1) || {
    warn unknown
    return 1
  }
  case $_out in
    OK) return 0 ;;
    BADICON:*)
      warn unknown
      LAST_FAIL=icon
      return 1
      ;;
    FAIL:*)
      warn unknown
      return 1
      ;;
    *)
      warn unknown
      return 1
      ;;
  esac
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
  printf '%s\n' "$ICON_S10"
  [ "$DRY" -eq 0 ] || return 0
  build_icns
  if ! run_jxa apply "$ICNS_FILE"; then print_limit_note; exit 1; fi
  [ "$(finder_flag)" = yes ] && [ "$(icon_file)" = yes ] || { warn unknown; exit 1; }
  MEASURED_APPLY_STATE=$(icon_state)
  if [ "$EXPLICIT_ICON" -eq 0 ] && [ "$MEASURED_APPLY_STATE" != own ]; then EXIT_CODE=1; fi
}

do_clear() {
  [ "$DRY" -eq 0 ] || return 0
  if [ "$(icon_state)" = stock ] && [ "$(icon_file)" = no ]; then return 0; fi
  if ! run_jxa clear; then print_limit_note; exit 1; fi
  [ "$(icon_state)" = stock ] && [ "$(icon_file)" = no ] || { warn unknown; exit 1; }
}

case $CMD in
  status) [ "$REPORT" -eq 1 ] || do_status ;;
  apply) do_apply ;;
  clear) do_clear ;;
esac

if [ "$REPORT" -eq 1 ]; then
  if [ -n "$MEASURED_APPLY_STATE" ]; then _reported_state=$MEASURED_APPLY_STATE; else _reported_state=$(icon_state); fi
  printf 'icon: %s\n' "$_reported_state" >&3
  REPORTED=1
  [ "$_reported_state" != unknown ] || exit 1
fi
exit "$EXIT_CODE"
