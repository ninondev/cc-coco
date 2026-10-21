#!/bin/sh
# Release build of talk-key for this machine: built, signed on macOS, checked, copied to
# plugin/libexec/ (or TALK_KEY_OUT). On macOS, TALK_KEY_SIGN_ID names the signing identity;
# without it the signature is ad hoc. This is how the macOS build ships; the Windows and Linux
# builds that ship come from tools/build-talk-key-bins.py, and on Linux this one serves the tests.
set -eu
crate=$(cd "$(dirname "$0")/.." && pwd)
out=${TALK_KEY_OUT:-$crate/../libexec}
target=${CARGO_TARGET_DIR:-$crate/target}
cd "$crate"
# Panic locations keep source paths: the home folder, the registry mirror's name and the checkout would ship in
# the program. rustc applies the last matching remap, so the narrower ones come after HOME's.
repo=$(cd "$crate/../.." && pwd)
cargo_home=${CARGO_HOME:-$HOME/.cargo}
flags="--remap-path-prefix=$HOME=~ --remap-path-prefix=$cargo_home=/cargo"
mirrors=
for dir in "$cargo_home"/registry/src/*/; do
  [ -d "$dir" ] || continue
  flags="$flags --remap-path-prefix=${dir%/}=/cargo/registry/src/crates"
  mirrors="$mirrors $(basename "$dir")"
done
flags="$flags --remap-path-prefix=$repo=/coco --remap-path-prefix=$target=/target"
RUSTFLAGS="${RUSTFLAGS:+$RUSTFLAGS }$flags" cargo build --release --locked

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) bin=$target/release/talk-key.exe ;;
  *) bin=$target/release/talk-key ;;
esac

if [ "$(uname -s)" = Darwin ]; then
  # Hardened runtime before the first add: without it dyld honours DYLD_INSERT_LIBRARIES, and
  # injected code would read the key with no Keychain prompt. The access list pins this signature.
  codesign --force --options runtime --timestamp=none --sign "${TALK_KEY_SIGN_ID:--}" "$bin"
  codesign --display --verbose=2 "$bin" 2>&1 | grep -q 'flags=.*runtime' || {
    echo "talk-key: the hardened runtime flag is missing" >&2; exit 1; }
fi

# No seam name, CA variable, other proxy variable or the engine's key variable in the binary.
for name in TALK_KEY_TEST SSL_CERT_FILE SSL_CERT_DIR ANTHROPIC_API_KEY ALL_PROXY all_proxy HTTP_PROXY http_proxy SSLKEYLOGFILE; do
  if LC_ALL=C grep -a -q "$name" "$bin"; then echo "talk-key: $name is in $bin" >&2; exit 1; fi
done
# Nor any of this machine's paths, which the remaps above should have taken out.
for path in "$HOME" "$cargo_home" "$repo" "$target" $mirrors; do
  if [ "$path" != / ] && LC_ALL=C grep -a -q -F "$path" "$bin"; then
    echo "talk-key: $bin holds a path of this machine" >&2; exit 1; fi
done

mkdir -p "$out"
cp "$bin" "$out/"
echo "$out/$(basename "$bin")"
