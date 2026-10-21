#!/bin/sh
# Real process tests only, with scratch files and an instrumented scratch binary.
set -eu
root=$(CDPATH= cd -- "${0%/*}/../.." && pwd)
scratch=$(mktemp -d "${TMPDIR:-/tmp}/coco-owner-presence.XXXXXX")
. "$root/tools/scratch.sh"
scratch_cleanup_install "$scratch"
mkdir "$scratch/home"
export HOME="$scratch/home" CLAUDE_CONFIG_DIR="$scratch/home/config"
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 CLAUDE_CODE_OFFLINE=1
if [ -r /proc/sys/kernel/ostype ]; then
  clang -std=c11 -Os -Wall -Wextra -Werror -ffreestanding -fno-builtin -fno-stack-protector -fno-pic -fno-pie -nostdinc -nostdlib -static -DPRESENCE_TEST_BOUNDARIES -Wl,-e,_start "$root/plugin/bin/presence-linux.c" -o "$scratch/presence-native"
else
  clang -std=c11 -Os -Wall -Wextra -Werror -DPRESENCE_TEST_BOUNDARIES "$root/plugin/bin/presence-native.c" -o "$scratch/presence-native"
fi
printf '#!/bin/sh\nexec "%s" "$@"\n' "$scratch/presence-native" > "$scratch/presence.sh"
chmod 700 "$scratch/presence.sh"
clang -std=c11 -Os -Wall -Wextra -Werror "$root/tools/tests/presence-startup-host.c" -o "$scratch/startup-host"
unset COCO_TEST_TRANSPORT COCO_TEST_STARTUP_HOST COCO_TEST_FILTER COCO_TEST_BOUNDARY
bun "$root/tools/tests/presence-real.ts" "$root/plugin" "$scratch/shipping-evidence"
export COCO_TEST_STARTUP_HOST="$scratch/startup-host"
export COCO_TEST_TRANSPORT="$scratch/presence.sh"
bun "$root/tools/tests/presence-real.ts" "$root/plugin" "$scratch/evidence"
if [ "${COCO_KEEP_SCRATCH:-0}" = 1 ]; then
  printf 'Evidence: %s\n' "$scratch"
fi
printf 'PASS owner-check (shipping and instrumented process counts above)\n'
