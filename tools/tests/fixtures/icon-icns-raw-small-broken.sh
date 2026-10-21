#!/bin/sh
# Pack reviewed PNG representations directly, preserving their bytes in modern ICNS chunks.
# Arguments: existing iconset directory, output file in the caller's temporary build directory.
set -eu
# Binary header bytes must not be expanded as UTF-8 code points.
LC_ALL=C
export LC_ALL
ICONSET=$1
OUTPUT=$2
be32() { awk -v n="$1" 'BEGIN { printf "%c%c%c%c", int(n/16777216)%256,int(n/65536)%256,int(n/256)%256,n%256 }'; }
representations() {
  printf '%s\n' 'icp4 icon_16x16.png' 'ic11 icon_16x16@2x.png' 'icp5 icon_32x32.png' 'ic12 icon_32x32@2x.png' 'ic07 icon_128x128.png' 'ic13 icon_128x128@2x.png' 'ic08 icon_256x256.png' 'ic14 icon_256x256@2x.png' 'ic09 icon_512x512.png' 'ic10 icon_512x512@2x.png'
}
TOTAL=8
for NAME in icon_16x16.png icon_16x16@2x.png icon_32x32.png icon_32x32@2x.png icon_128x128.png icon_128x128@2x.png icon_256x256.png icon_256x256@2x.png icon_512x512.png icon_512x512@2x.png; do
  [ -r "$ICONSET/$NAME" ] || exit 2
  SIZE=$(wc -c < "$ICONSET/$NAME" | tr -d ' ')
  [ "$SIZE" -le 16777216 ] || exit 2
  TOTAL=$((TOTAL+SIZE+8))
done
{
  printf icns
  be32 "$TOTAL"
  representations | while read -r TYPE NAME; do
    SIZE=$(wc -c < "$ICONSET/$NAME" | tr -d ' ')
    printf '%s' "$TYPE"
    be32 "$((SIZE+8))"
    cat "$ICONSET/$NAME"
  done
} > "$OUTPUT"
