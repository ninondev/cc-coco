#!/bin/sh
# A single native event follower; dispatch uses shell builtins only.
set -eu
if [ -r /proc/sys/kernel/ostype ]; then
  architecture=
  while IFS=: read -r field value; do
    case "$field" in
      *vendor_id*) architecture=x86_64; break ;;
      *'CPU architecture'*) architecture=aarch64; break ;;
    esac
  done < /proc/cpuinfo
  case "$architecture" in
    x86_64|aarch64) exec "${0%/*}/presence-linux-$architecture" "$@" ;;
    *) exit 69 ;;
  esac
fi
case "${2-}" in
  follow) exec "${0%/*}/presence-follow" "$@" ;;
esac
exec "${0%/*}/presence-native" "$@"
