// One timing model in milliseconds, also carried by the companion's v1 feed.
export const MOTION = {
  "version": 1,
  "sequenceMs": 180000,
  "blink": {
    "interval": { "median": 5000, "sigma": 0.54, "min": 1200, "max": 20000 },
    "shut": { "median": 130, "sigma": 0.12, "min": 100, "max": 160 },
    "doubleChance": 0.08333333333333333,
    "doubleGap": { "median": 210, "sigma": 0.22, "min": 150, "max": 300 },
    "gazeChance": 0.5,
    "gazeDelay": { "median": 245, "sigma": 0.3, "min": 150, "max": 400 }
  },
  "think": { "median": 1400, "sigma": 0.36, "min": 800, "max": 2600 },
  "work": { "median": 330, "sigma": 0.25, "min": 220, "max": 500 },
  "wild": { "median": 200, "sigma": 0.30, "min": 120, "max": 320 },
  "workBurst": { "min": 3, "max": 8, "pause": { "median": 1265, "sigma": 0.28, "min": 800, "max": 2000 } }
} as const

export type Random = () => number
// The test runner seeds only its scratch copy; production uses local randomness without I/O.
export const runtimeRandom: Random = Math.random
export type Hold = { median: number; sigma: number; min: number; max: number }
export type MotionKind = 'think' | 'work' | 'wild'
export function seededRandom(seed: number): Random {
  let value = seed >>> 0 || 1
  return () => { value ^= value << 13; value ^= value >>> 17; value ^= value << 5; return (value >>> 0) / 4294967296 }
}
export function sampleHold(spec: Hold, random: Random = runtimeRandom): number {
  const normal = Math.sqrt(-2 * Math.log(Math.max(Number.MIN_VALUE, random()))) * Math.cos(2 * Math.PI * random())
  return Math.max(spec.min, Math.min(spec.max, spec.median * Math.exp(spec.sigma * normal)))
}
export const blinkInterval = (random: Random = runtimeRandom): number => sampleHold(MOTION.blink.interval, random)
export const blinkShut = (random: Random = runtimeRandom): number => sampleHold(MOTION.blink.shut, random)
export const blinkGap = (random: Random = runtimeRandom): number => sampleHold(MOTION.blink.doubleGap, random)
export const blinkDouble = (random: Random = runtimeRandom): boolean => random() < MOTION.blink.doubleChance
export const gazeBlinkDelay = (random: Random = runtimeRandom): number | undefined => random() < MOTION.blink.gazeChance ? sampleHold(MOTION.blink.gazeDelay, random) : undefined
// A work pause holds the current drawing, after 3 to 8 changes; it is a hold, not a response delay.
export function motionCycle(kind: MotionKind, random: Random = runtimeRandom): () => number {
  let changes = 0
  let burst = () => MOTION.workBurst.min + Math.floor(random() * (MOTION.workBurst.max - MOTION.workBurst.min + 1))
  let left = kind === 'work' ? burst() : 0
  return () => {
    if (kind === 'work' && changes++ >= left) { changes = 0; left = burst(); return sampleHold(MOTION.workBurst.pause, random) }
    return sampleHold(MOTION[kind], random)
  }
}
