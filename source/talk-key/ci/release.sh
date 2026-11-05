#!/bin/sh
# Release build of talk-key for this machine: built, signed on macOS, checked, copied to
# plugin/libexec/ (or TALK_KEY_OUT). On macOS, TALK_KEY_SIGN_ID names the signing identity;
# without it the signature is ad hoc. This is how the macOS build ships; the Windows and Linux
# builds that ship come from tools/build-talk-key-bins.py, and on Linux this one serves the tests.
set -eu
crate=$(cd "$(dirname "$0")/.." && pwd)
if [ "${1:-}" = --mac-universal ]; then
  [ "$#" -eq 3 ] && [ "$2" = --output ] || { echo 'usage: release.sh --mac-universal --output NEW_SCRATCH_DIRECTORY' >&2; exit 2; }
  [ "$(uname -s)" = Darwin ] || { echo 'the universal build requires macOS' >&2; exit 2; }
  exec python3 -B - "$crate" "$3" <<'PY'
import hashlib, json, os, pathlib, subprocess, sys

crate = pathlib.Path(sys.argv[1]).resolve()
repo = crate.parents[1]
out = pathlib.Path(sys.argv[2])
if not out.is_absolute() or out.exists() or out.is_symlink():
    sys.exit('output must be an absolute NEW scratch directory; nothing replaced')
out.mkdir(mode=0o700)
out = out.resolve()
target = out / 'build/cargo'
target.mkdir(parents=True)
digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
sources = [crate / 'Cargo.toml', crate / 'Cargo.lock', crate / 'ci/release.sh', *sorted((crate / 'src').rglob('*.rs'))]
if any(p.is_symlink() or not p.is_file() for p in sources):
    sys.exit('build inputs must be regular source files')
inputs = {p.relative_to(repo).as_posix(): digest(p) for p in sources}
def run(*args, capture=False):
    result = subprocess.run(args, cwd=crate, env=env, check=True, text=True,
                            stdout=subprocess.PIPE if capture else None)
    return result.stdout.strip() if capture else None
env = dict(os.environ, CARGO_TARGET_DIR=str(target), MACOSX_DEPLOYMENT_TARGET='13.0', TMPDIR=str(out / 'build'))
env.pop('RUSTFLAGS', None)
cargo_home = pathlib.Path(env.get('CARGO_HOME', str(pathlib.Path.home() / '.cargo')))
remaps = [(str(pathlib.Path.home()), '~'), (str(cargo_home), '/cargo')]
mirrors = sorted((cargo_home / 'registry/src').glob('*'))
remaps.extend((str(p), '/cargo/registry/src/crates') for p in mirrors)
remaps.extend([(str(repo), '/coco'), (str(out), '/coco-build')])
env['CARGO_ENCODED_RUSTFLAGS'] = '\x1f'.join('--remap-path-prefix='+a+'='+b for a,b in remaps)
env['SDKROOT'] = run('xcrun', '--sdk', 'macosx', '--show-sdk-path', capture=True)
compiler = run('rustc', '--version', capture=True)
sdk = run('xcrun', '--sdk', 'macosx', '--show-sdk-version', capture=True)
slices = []
for arch in ('aarch64', 'x86_64'):
    triple = arch + '-apple-darwin'
    run('cargo', 'build', '--release', '--locked', '--offline', '-j4', '--target', triple)
    slices.append(str(target / triple / 'release/talk-key'))
binary = out / 'talk-key'
run('lipo', '-create', *slices, '-output', str(binary))
if set(run('lipo', '-archs', str(binary), capture=True).split()) != {'arm64', 'x86_64'}:
    sys.exit('expected both arm64 and x86_64')
payload = binary.read_bytes()
for marker in ('TALK_KEY_TEST', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN',
               'ALL_PROXY', 'all_proxy', 'HTTP_PROXY', 'http_proxy', 'SSLKEYLOGFILE', '/Users/',
               str(repo), str(out), *[p.name for p in mirrors]):
    if marker.encode() in payload:
        sys.exit('release binary contains a forbidden test, environment or machine marker')
if any(digest(repo / name) != sha for name,sha in inputs.items()):
    sys.exit('source changed during compilation; rebuild in a new directory')
# This build command never uses an identity or the Keychain. Final signing is a separate release step.
run('codesign', '--force', '--options', 'runtime', '--timestamp=none', '--sign', '-', str(binary))
run('codesign', '--verify', '--strict', str(binary))
receipt = {'schema': 1, 'architectures': ['arm64', 'x86_64'], 'minimumMacOS': '13.0',
           'compiler': compiler, 'sdk': sdk, 'inputs': dict(sorted(inputs.items())),
           'signing': 'adhoc', 'binarySha256': digest(binary), 'bytes': binary.stat().st_size}
(out / 'build-receipt.json').write_text(json.dumps(receipt, sort_keys=True, indent=2)+'\n')
print('built universal talk-key: ' + str(binary))
PY
fi
[ "$#" -eq 0 ] || { echo 'usage: release.sh [--mac-universal --output NEW_SCRATCH_DIRECTORY]' >&2; exit 2; }
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
RUSTFLAGS="${RUSTFLAGS:+$RUSTFLAGS }$flags" cargo build --release --locked -j4

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
for name in TALK_KEY_TEST SSL_CERT_FILE SSL_CERT_DIR ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ALL_PROXY all_proxy HTTP_PROXY http_proxy SSLKEYLOGFILE; do
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
