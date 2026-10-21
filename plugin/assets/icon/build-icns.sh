#!/bin/sh
# Encode tuned small pixels as native classic RGB/masks; preserve retina and larger PNG chunks.
# Arguments: existing iconset directory, output file in the caller's temporary build directory.
set -eu
# System tools never inherit the invoking session's search path.
PATH=/usr/bin:/bin:/usr/sbin:/sbin
export PATH
# Binary header bytes must not be expanded as UTF-8 code points.
LC_ALL=C
export LC_ALL
ICONSET=$1
OUTPUT=$2
be32() { /usr/bin/awk -v n="$1" 'BEGIN { printf "%c%c%c%c", int(n/16777216)%256,int(n/65536)%256,int(n/256)%256,n%256 }'; }
# AppKit decodes the supplied PNGs without a drawing/context colour conversion.
# NSData base64 avoids bridging raw C bitmap pointers through JXA.
JXA_SMALL='
ObjC.import("AppKit");
function rle(channel) {
  var out = [], pos = 0;
  while (pos < channel.length) {
    var run = 1;
    while (pos + run < channel.length && channel[pos + run] === channel[pos] && run < 130) run++;
    if (run >= 3) { out.push(run + 125, channel[pos]); pos += run; continue; }
    var start = pos; pos += run;
    while (pos < channel.length && pos - start < 128) {
      run = 1;
      while (pos + run < channel.length && channel[pos + run] === channel[pos] && run < 3) run++;
      if (run >= 3) break;
      pos += Math.min(run, 128 - (pos - start));
    }
    out.push(pos - start - 1);
    for (var i = start; i < pos; i++) out.push(channel[i]);
  }
  return out;
}
function write(bytes, path) {
  var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", encoded = "";
  for (var i = 0; i < bytes.length; i += 3) {
    var a = bytes[i], b = bytes[i + 1] || 0, c = bytes[i + 2] || 0;
    encoded += alphabet[a >> 2] + alphabet[((a & 3) << 4) | (b >> 4)] +
      (i + 1 < bytes.length ? alphabet[((b & 15) << 2) | (c >> 6)] : "=") +
      (i + 2 < bytes.length ? alphabet[c & 63] : "=");
  }
  var data = $.NSData.alloc.initWithBase64EncodedStringOptions($(encoded), 0);
  if (data.isNil() || !data.writeToFileAtomically($(path), true)) throw new Error("encode failed");
}
function run(argv) {
  var directory = argv[0], sizes = [16, 32], types = ["is32", "il32"], masks = ["s8mk", "l8mk"];
  for (var n = 0; n < sizes.length; n++) {
    var size = sizes[n], bitmap = $.NSBitmapImageRep.imageRepWithContentsOfFile($(directory + "/icon_" + size + "x" + size + ".png"));
    if (bitmap.isNil() || Number(bitmap.pixelsWide) !== size || Number(bitmap.pixelsHigh) !== size) throw new Error("invalid small bitmap");
    var red = [], green = [], blue = [], alpha = [];
    for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) {
      var colour = bitmap.colorAtXY(x, y);
      red.push(Math.round(colour.redComponent * 255)); green.push(Math.round(colour.greenComponent * 255));
      blue.push(Math.round(colour.blueComponent * 255)); alpha.push(Math.round(colour.alphaComponent * 255));
    }
    write(rle(red).concat(rle(green), rle(blue)), directory + "/" + types[n] + ".bin");
    write(alpha, directory + "/" + masks[n] + ".bin");
  }
  return "OK";
}
'
/usr/bin/osascript -l JavaScript -e "$JXA_SMALL" "$ICONSET" >/dev/null 2>&1
representations() {
  printf '%s\n' 'is32 is32.bin' 's8mk s8mk.bin' 'il32 il32.bin' 'l8mk l8mk.bin' 'ic11 icon_16x16@2x.png' 'ic12 icon_32x32@2x.png' 'ic07 icon_128x128.png' 'ic13 icon_128x128@2x.png' 'ic08 icon_256x256.png' 'ic14 icon_256x256@2x.png' 'ic09 icon_512x512.png' 'ic10 icon_512x512@2x.png'
}
TOTAL=8
for NAME in is32.bin s8mk.bin il32.bin l8mk.bin icon_16x16@2x.png icon_32x32@2x.png icon_128x128.png icon_128x128@2x.png icon_256x256.png icon_256x256@2x.png icon_512x512.png icon_512x512@2x.png; do
  [ -r "$ICONSET/$NAME" ] || exit 2
  SIZE=$(/usr/bin/wc -c < "$ICONSET/$NAME" | /usr/bin/tr -d ' ')
  [ "$SIZE" -le 16777216 ] || exit 2
  TOTAL=$((TOTAL+SIZE+8))
done
{
  printf icns
  be32 "$TOTAL"
  representations | while read -r TYPE NAME; do
    SIZE=$(/usr/bin/wc -c < "$ICONSET/$NAME" | /usr/bin/tr -d ' ')
    printf '%s' "$TYPE"
    be32 "$((SIZE+8))"
    /bin/cat "$ICONSET/$NAME"
  done
} > "$OUTPUT"
