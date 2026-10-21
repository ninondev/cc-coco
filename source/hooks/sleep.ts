// The shared quiet timestamp is the seed; no persisted draw or session identity.
export function sleepAfter(quietAt: number): number {
  let hash = (quietAt >>> 0) ^ (Math.floor(quietAt / 0x100000000) >>> 0)
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b)
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35)
  hash = (hash ^ (hash >>> 16)) >>> 0
  return 240000 + Math.floor(120000 * (hash / 0x100000000))
}
