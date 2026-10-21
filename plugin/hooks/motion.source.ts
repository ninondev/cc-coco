import { MOTION_PATCH_METADATA } from './motion-metadata'
import { placeBlink, type BlinkObstacle, type BlinkException } from './blink-scheduler'

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

// B1 additions are optional protocol fields: v1's native startup JSON stays byte-exact.
// Every duration and sampler used by SVG, terminal and native motion is defined here.
export const MOTION2 = {
  calm: { holdA: 380, holdB: 760 },
  swap: 66, swapAt: 22, dipMs: 55, dipY: .975, dipX: 1.0075,
  firstBlinkMax: 4500, halfClose: 33, halfOpen: 50, strokeBlinkClear: 80,
  blinkInterval: { ...MOTION.blink.interval, max: 10000 },
  workBlink: { median: 6000, sigma: .5, min: 1500, max: 12000 },
  deepThoughtEvery: { median: 8000, sigma: .4, min: 6000, max: 14000 },
  deepThoughtHold: { median: 1300, sigma: .3, min: 900, max: 2000 },
  sparkHold: { median: 700, sigma: .45, min: 300, max: 1600 },
  glanceEvery: { median: 7000, sigma: .6, min: 2500, max: 20000 },
  glanceHold: { median: 450, sigma: .45, min: 250, max: 1400 },
  pageEvery: { median: 65000, sigma: .3, min: 35000, max: 120000 },
  pageLift: 110, pageLand: 160, pageSettle: 90,
  breathLoopMs: 97000, wildLoopMs: 20000, breathStepPx: .12, swayStepDegrees: .05,
  spring: { mass: .5, stiffness: 260, damping: 9 },
  dipSpring: { mass: .5, stiffness: 220, damping: 12.6 },
  patSpring: { mass: .5, stiffness: 180, damping: 13 },
  wakeSpring: { mass: .5, stiffness: 200, damping: 10 },
  poke: { sy: .94, sx: 1.03, pressMs: 60, smileAt: 120, smileMs: 60, outAt: 1000, outMs: 90, end: 1100 },
  pat: { sy: .970, sx: 1.009, pressMs: 260, lean: -1, leanMs: 320, halfAt: 40, closedAt: 120, smileAt: 260, smileMs: 90, strokeAt: 520, strokeMs: 360, strokeY: .962, releaseAt: 1050, halfOutAt: 1250, openAt: 1340, end: 1400 },
  wake: { cutAt: 33, pressMs: 50, sy: .970, sx: 1.009, halfAt: 220, lineAt: 220, closedAt: 330, halfAgainAt: 400, end: 450 },
  burst: { shake: [0, -2.5, 2.3, -1.6, 1.1, -.5, 0], shakeMs: 420, shioriAt: 380, turnA: 700, turnB: 1050, turnAgain: 1400, outAt: 1750, end: 2200 },
  afterTouchBlink: { median: 450, sigma: .15, min: 300, max: 600 },
  breath: {
    idle: { A: .014, normal: .58, sigh: 1, chance: 1 / 14, ti: {median:1600,sigma:.12,min:1150,max:2200}, te:{median:2300,sigma:.12,min:1700,max:3200}, tp:{median:600,sigma:.3,min:250,max:1300} },
    think: { A: .012, normal: .55, sigh: 1, chance: 1 / 10, ti:{median:1800,sigma:.12,min:1300,max:2500}, te:{median:2600,sigma:.12,min:1900,max:3500}, tp:{median:900,sigma:.35,min:300,max:1800} },
    work: { A: .012, normal: .60, sigh: .95, chance: 1 / 16, ti:{median:1350,sigma:.12,min:1000,max:1800}, te:{median:1900,sigma:.12,min:1400,max:2600}, tp:{median:300,sigma:.3,min:120,max:700} },
    wild: { A: .015, normal: .85, sigh: 1, chance: 0, ti:{median:750,sigma:.12,min:550,max:1000}, te:{median:1150,sigma:.12,min:850,max:1500}, tp:{median:150,sigma:.3,min:60,max:300} },
    sleep: { A: .015, normal: .85, sigh: 1, chance: 1 / 12, ti:{median:2200,sigma:.1,min:1700,max:2900}, te:{median:3400,sigma:.1,min:2700,max:4400}, tp:{median:900,sigma:.25,min:500,max:1600} },
    waiting: { A: .014, normal: .58, sigh: 1, chance: 1 / 8, ti:{median:1600,sigma:.12,min:1150,max:2200}, te:{median:2300,sigma:.12,min:1700,max:3200}, tp:{median:600,sigma:.3,min:250,max:1300} },
    happy: { A: .014, normal: .62, sigh: 1, chance: 0, ti:{median:1300,sigma:.12,min:1000,max:1800}, te:{median:1800,sigma:.12,min:1300,max:2500}, tp:{median:400,sigma:.3,min:150,max:900} },
  },
  sway: {
    idle: { every:{median:24000,sigma:.35,min:14000,max:40000}, deg:[.45,.8], go:{median:2000,sigma:.15,min:1500,max:2600}, hold:{median:3500,sigma:.4,min:1800,max:7000}, back:{median:2200,sigma:.15,min:1600,max:2900} },
    think: { every:{median:12000,sigma:.35,min:7000,max:20000}, deg:[.5,.9], go:{median:1700,sigma:.15,min:1300,max:2300}, hold:{median:3000,sigma:.35,min:1800,max:5000}, back:{median:1900,sigma:.15,min:1400,max:2600} },
    work: { every:{median:30000,sigma:.35,min:18000,max:45000}, deg:[.3,.5], go:{median:1500,sigma:.15,min:1100,max:2000}, hold:{median:2500,sigma:.35,min:1500,max:4500}, back:{median:1600,sigma:.15,min:1200,max:2200} },
    sleep: { every:{median:40000,sigma:.3,min:25000,max:60000}, deg:[.3,.5], go:{median:3000,sigma:.12,min:2400,max:3800}, hold:{median:8000,sigma:.3,min:5000,max:12000}, back:{median:3200,sigma:.12,min:2600,max:4000} },
    waiting: { every:{median:10000,sigma:.35,min:6000,max:16000}, deg:[.6,1], go:{median:900,sigma:.15,min:700,max:1200}, hold:{median:2800,sigma:.3,min:1800,max:4500}, back:{median:1200,sigma:.15,min:900,max:1600} },
  },
} as const

export type MotionVariant = 0 | 1 | 2
export type TouchKind = 'poke' | 'pat' | 'wink' | 'burst'
export type FaceKind = 'open' | 'half' | 'closed' | 'squeeze' | 'smile' | 'wink'
export type MotionSnapshot = { frame: string; face: FaceKind; sx: number; sy: number; skew: number; faces?: Partial<Record<FaceKind, number>>; breathSx?: number; breathSy?: number; swaySkew?: number; shiftSx?: number; shiftSy?: number }
export type Point = { at: number; value: number; ease?: 'soft' | 'out' | 'swap' | 'step' }
export type LayerTrack = { name: string; points: Point[]; loop: boolean;  }
export type MotionOptions = { touch?: TouchKind; waking?: boolean; entryFrom?: string; continuation?: MotionSnapshot; reactionStartMs?: number; reactionDurationMs?: number; moodElapsedMs?: number; pixel?: boolean }
export type MotionTimeline = {
  mood: string; variant: MotionVariant; duration: number; breathDuration: number; layers: LayerTrack[];
  breath: Point[]; sway: Point[]; gesture: MotionSnapshot[]; gestureTimes: number[];
  blinkObstacles: BlinkObstacle[]; blinkExceptions: BlinkException[]; blinks: number[]; swaps: number[]; deepThoughts: number[]; shift: number[]; hide: [number, number][]; reactionAt: number;
  frameAt: (at: number) => string;
}
const timelineCache = new Map<string, MotionTimeline>()
const FRAMES: Record<string, string> = { idle:'idle-reading', think:'think-a', work:'work-a', wild:'wild-a', sleep:'sleep', happy:'happy', waiting:'waiting', error:'error', refuse:'refuse', flustered:'flustered', wave:'wave', snake:'snake', clingy:'waiting', calm:'idle-reading', question:'waiting', omen:'happy' }
export function motionFrame(mood: string): string { return FRAMES[mood] ?? 'idle-reading' }
export function pickMotionVariant(random: Random = runtimeRandom): MotionVariant { return Math.min(2, Math.floor(random() * 3)) as MotionVariant }
function seedOf(text: string): number { let seed = 2166136261; for (let i=0;i<text.length;i++) seed = Math.imul(seed ^ text.charCodeAt(i), 16777619); return seed >>> 0 }
const CURVES = {soft:[.37,0,.63,1], out:[0,0,.2,1], swap:[.45,0,.55,1]} as const
export function motionEase(kind: 'soft'|'out'|'swap'|'step', u: number): number {
  if (u<=0) return 0; if(u>=1) return 1; if(kind==='step') return 0
  const [x1,y1,x2,y2]=CURVES[kind]; let lo=0,hi=1
  for(let i=0;i<24;i++){const t=(lo+hi)/2, x=3*(1-t)**2*t*x1+3*(1-t)*t*t*x2+t**3; if(x<u)lo=t;else hi=t}
  const t=(lo+hi)/2; return 3*(1-t)**2*t*y1+3*(1-t)*t*t*y2+t**3
}
export function samplePoints(points: readonly Point[], at: number): number {
  let last=points[0]; if(!last)return 0
  for(let i=1;i<points.length;i++){const next=points[i]!;if(at<next.at){const u=next.at===last.at?1:(at-last.at)/(next.at-last.at);return last.value+(next.value-last.value)*(last.ease?motionEase(last.ease,u):u)}last=next}
  return last.value
}
export function sampleSpring(x0:number, at:number, spec:{mass:number;stiffness:number;damping:number}=MOTION2.spring, target=1):number {
  if(at<=0)return x0
  const a=spec.damping/(2*spec.mass), w=Math.sqrt(spec.stiffness/spec.mass-a*a), t=at/1000
  return target+(x0-target)*Math.exp(-a*t)*(Math.cos(w*t)+a/w*Math.sin(w*t))
}
function identity(frame='idle-reading'): MotionSnapshot {return {frame,face:'open',sx:1,sy:1,skew:0}}
export function sampleTouch(kind:TouchKind, at:number, continuation?:MotionSnapshot):MotionSnapshot {
  const s=identity(continuation?.frame), initialY=(continuation?.sy??1)/((continuation?.breathSy??1)*(continuation?.shiftSy??1)), initialX=(continuation?.sx??1)/((continuation?.breathSx??1)*(continuation?.shiftSx??1))
  const partial=!!continuation && at<300
  if(kind==='pat'){
    const p=MOTION2.pat
    if(at<p.releaseAt){const u=motionEase('out',Math.min(1,at/p.pressMs));s.sy=initialY+(p.sy-initialY)*u;s.sx=initialX+(p.sx-initialX)*u
      if(at>=p.strokeAt&&at<=p.strokeAt+p.strokeMs)s.sy-=(p.sy-p.strokeY)*Math.sin(Math.PI*(at-p.strokeAt)/p.strokeMs)
      s.skew=p.lean*motionEase('soft',Math.min(1,at/p.leanMs))
    }else {s.sy=sampleSpring(p.sy,at-p.releaseAt,MOTION2.patSpring);s.sx=1-(s.sy-1)*.3;s.skew=sampleSpring(p.lean,at-p.releaseAt,MOTION2.patSpring,0)}
    s.face=at<p.halfAt?(continuation?.face??'open'):at<p.closedAt?'half':at<p.smileAt?'closed':at<p.halfOutAt?'smile':at<p.openAt?'half':'open'
  }else{
    const p=MOTION2.poke, floor=partial?.97:p.sy, targetY=Math.min(initialY,floor), targetX=Math.max(initialX,partial?1.015:p.sx)
    if(at<p.pressMs){const u=motionEase('out',at/p.pressMs);s.sy=initialY+(targetY-initialY)*u;s.sx=initialX+(targetX-initialX)*u}else{s.sy=sampleSpring(targetY,at-p.pressMs);s.sx=1-(s.sy-1)*.5}
    s.face=kind==='wink'?(at<100?'squeeze':at<850?'wink':'open'):at<p.smileAt?(continuation?.face==='smile'?'smile':'squeeze'):at<p.outAt?'smile':at<1060?'half':'open'
    if(kind==='wink')s.skew=at<800?-1.2*motionEase('out',Math.min(1,at/160)):sampleSpring(-1.2,at-800,MOTION2.dipSpring,0)
    if(kind==='burst'){
      const b=MOTION2.burst;s.face='squeeze';if(at<=b.shakeMs){const u=at/b.shakeMs*(b.shake.length-1),i=Math.min(b.shake.length-2,Math.floor(u));s.skew=b.shake[i]!+(b.shake[i+1]!-b.shake[i]!)*motionEase('soft',u-i)}
      s.frame=at<b.shioriAt+55?'flustered':at<b.turnA?'shiori-a':at<b.turnB?'shiori-b':at<b.turnAgain?'shiori-a':at<b.outAt+55?'shiori-b':(continuation?.frame??'idle-reading')
    }
  }
  if(continuation && at===0){s.sx=initialX;s.sy=initialY;s.skew=continuation.skew-(continuation.swaySkew??0);s.face=continuation.face;s.faces=continuation.faces}
  return s
}
const kindOf = (mood: string) => mood === 'question' || mood === 'clingy' ? 'waiting' : mood
// The manifest owns pose capabilities; new patches require no mood allowlist.
export function motionHasFace(frame: string, face: string, pixel = false): boolean {
  const data = pixel ? MOTION_PATCH_METADATA.pixel : MOTION_PATCH_METADATA.painted
  return Object.values(data).some(p => p.base === frame && p.face === face)
}
const canBlink = (base: string, pixel = false) => motionHasFace(base, 'blink', pixel) && motionHasFace(base, 'half', pixel)
const THINK_SHIFT = { first: { median: 3500, sigma: .2, min: 2500, max: 5000 }, every: { median: 16000, sigma: .35, min: 9000, max: 30000 }, hold: { median: 4500, sigma: .3, min: 3000, max: 7000 }, firstDeep: { median: 7000, sigma: .15, min: 6000, max: 9000 } }
const CALM = { a: 55, b: 523, end: 1371 }

function push(points: Point[], at: number, value: number, ease: Point['ease'] = 'step') { points.push({ at, value, ease }) }
// every face change is a cut: on at `from`, off at `to`.
function span(layer: LayerTrack, from: number, to: number) { push(layer.points, from, 0); push(layer.points, from, 1); push(layer.points, to, 1); push(layer.points, to, 0) }
function sorted(points: Point[]) { points.sort((a, b) => a.at - b.at); return points }
function breathMood(kind: string): keyof typeof MOTION2.breath { return kind in MOTION2.breath ? kind as keyof typeof MOTION2.breath : kind === 'error' ? 'work' : kind === 'flustered' ? 'wild' : kind === 'wave' ? 'happy' : 'idle' }
function dipAt(t: number, floor: number = MOTION2.dipY): number { return t < 55 ? 1 + (floor - 1) * motionEase('out', t / 55) : sampleSpring(floor, t - 55, MOTION2.dipSpring) }

export function generateMotion(mood: string, variant: MotionVariant = 0, options: MotionOptions = {}): MotionTimeline {
  const key = JSON.stringify([mood, variant, options]); const found = timelineCache.get(key); if (found) return found
  const kind = kindOf(mood), base = motionFrame(mood)
  // A wink without matching art is a plain poke on the pose currently on screen.
  if (options.touch === 'wink' && !motionHasFace(options.continuation?.frame ?? base, 'wink', options.pixel)) options = {...options, touch:'poke'}
  const random = seededRandom(seedOf(`${mood}:${variant}`)), duration = kind === 'wild' ? MOTION2.wildLoopMs : MOTION.sequenceMs
  const layers: LayerTrack[] = [{ name: base, points: [{ at: 0, value: 1, ease: 'step' }], loop: true }]
  const layer = (name: string, loop = true): LayerTrack => { const f = layers.find(l => l.name === name && l.loop === loop); if (f) return f; const l: LayerTrack = { name, points: [{ at: 0, value: 0, ease: 'step' }], loop }; layers.push(l); return l }
  const blinks: number[] = [], swaps: number[] = [], shift: number[] = [], deepThoughts: number[] = [], deep: [number,number][] = []
  const blinkObstacles: BlinkObstacle[] = [], blinkExceptions: BlinkException[] = []
  if (kind === 'work' || kind === 'wild') {
    const alt = layer(kind === 'work' ? 'work-b' : 'wild-b'), cycle = motionCycle(kind === 'work' ? 'work' : 'wild', random)
    let t = kind === 'work' ? 600 : sampleHold(MOTION.wild, random), on = false
    // strokes and flicker are cuts (B1 times them at the start of its 60/33 ms fades; the cut sits at the fade's midpoint)
    const mid = kind === 'wild' ? 16 : 30
    while (t < duration - 700) { swaps.push(t); push(alt.points, t + mid, on ? 1 : 0); push(alt.points, t + mid, on ? 0 : 1); on = !on; t += cycle() }
    if (kind === 'work' && on) blinkObstacles.push({name:'work:return',start:duration-30,end:duration-30})
    push(alt.points, duration - 30, on ? 1 : 0); push(alt.points, duration - 30, 0); push(alt.points, duration, 0)
  }
  if (kind === 'think') {
    // deep thought is the half-lid held, on whatever think pose is up; the pose shifts to think-b now and then, on a dip, as a cut.
    const half = layer('face:half'); let t = sampleHold(THINK_SHIFT.firstDeep, random)

    while (t < duration - 3000) { const h = sampleHold(MOTION2.deepThoughtHold, random); deepThoughts.push(t); deep.push([t, t + h]); span(half, t, t + h); t += h + sampleHold(MOTION2.deepThoughtEvery, random) }
    const alt = layer('think-b'); t = sampleHold(THINK_SHIFT.first, random)
    // a shift that would land in a deep thought waits until 400 ms after it ends (never dropped)
    const clear = (x: number) => { for (const [a, b] of deep) if (x + 55 > a - 200 && x + 55 < b + 200) return b + 400; return x }
    while (t < duration - 9000) { t = clear(clear(t)); const h = sampleHold(THINK_SHIFT.hold, random); const back = clear(clear(t + h)); shift.push(t, back); span(alt, t + 55, back + 55); t = back + sampleHold(THINK_SHIFT.every, random) }
  }
  if (kind === 'work') blinkObstacles.push(...swaps.map((at,i)=>({name:`work:stroke:${i}`,start:at+30,end:at+30})))
  blinkObstacles.push(...deep.map(([start,end],i)=>({name:`think:deep:${i}`,start,end})),
    ...shift.map((at,i)=>({name:`think:turn:${i}`,start:at+55-400,end:at+55+300})))
  if (canBlink(base, options.pixel)) {
    const closed = layer('face:blink'), half = layer('face:half')
    let t = Math.min(MOTION2.firstBlinkMax, gazeBlinkDelay(random) ?? blinkInterval(random))
    // Band intervals are capped independently of the companion's v1 feed.
    const every = kind === 'work' ? MOTION2.workBlink : MOTION2.blinkInterval
    // CSS keyframe percentages are floored at 1e-5 percent. Two ticks
    // protect both independently serialized edges without relaxing any cap.
    const precisionGuard = 2 * duration / 10000000
    const periodicObstacles = [-1,0,1].flatMap(cycle=>blinkObstacles.map(o=>({...o,start:o.start+cycle*duration,end:o.end+cycle*duration})))
    const emit = (at:number,hc:number,held:number,ho:number) => {
      blinks.push(at)
      if(hc)span(half,at,at+hc)
      span(closed,at+hc,at+hc+held)
      if(ho)span(half,at+hc+held,at+hc+held+ho)
    }
    let previousEnd = 0
    while (t < duration) {
      const shut = blinkShut(random), slow = kind === 'waiting' && random() < .5
      const hc = slow ? 220 : MOTION2.halfClose, ho = slow ? 280 : MOTION2.halfOpen, held = slow ? 300 + 200 * random() : shut
      const length=hc+held+ho, previous=blinks.at(-1)??-every.min
      // Every episode fits wholly inside the loop. Previous/next-cycle obstacle
      // copies apply the same clearance to the seam as to internal gaps.
      const latest=Math.min(duration-length,blinks.length?duration+blinks[0]!-every.min-precisionGuard:MOTION2.firstBlinkMax-precisionGuard)
      const seamAlreadyFits=blinks.length>0&&duration+blinks[0]!-previous<=every.max-precisionGuard
      if(t>latest&&seamAlreadyFits)break
      const placed=placeBlink({candidate:Math.min(t,latest),previous,min:every.min,max:every.max,span:length,obstacles:periodicObstacles,latest,precisionGuard})
      if(!placed){
        if(seamAlreadyFits)break
        throw new Error(`No blink window: ${mood}/${variant} after ${previous} ms`)
      }
      t=placed.at
      if(placed.exception)blinkExceptions.push(placed.exception)
      emit(t,hc,held,ho);previousEnd=t+length
      if (blinkDouble(random) && kind !== 'work') {
        const desired=previousEnd+Math.min(blinkGap(random),MOTION.blink.doubleGap.max-precisionGuard), secondShut=blinkShut(random)
        const second=placeBlink({candidate:desired,previous:t,min:length+MOTION.blink.doubleGap.min,max:every.max,span:secondShut,obstacles:periodicObstacles,latest:Math.min(duration-secondShut,duration+blinks[0]!-every.min-precisionGuard),precisionGuard})
        // A paired blink stays a pair; moving it beyond its sampled maximum
        // double-gap would change it into a separate ordinary blink.
        if(second&&second.at<=previousEnd+MOTION.blink.doubleGap.max-precisionGuard+1e-7){emit(second.at,0,secondShut,0);previousEnd=second.at+secondShut}
      }
      t=Math.max(t+sampleHold(every,random),blinks.at(-1)!+every.min,previousEnd)
      if(t>=duration&&duration+blinks[0]!-blinks.at(-1)!>every.max-precisionGuard)t=Math.min(blinks.at(-1)!+every.max,duration-1)
    }
  }
  if (kind === 'idle') {
    const left = layer('face:glance'), right = motionHasFace(base, 'glance-right', options.pixel) ? layer('face:glance-right') : left; let t = sampleHold(MOTION2.glanceEvery, random)
    while (t < duration - 3000) { const g = random() < 2 / 3 ? right : left, h = sampleHold(MOTION2.glanceHold, random); push(g.points, t, 0, 'swap'); push(g.points, t + 45, 1); push(g.points, t + 45 + h, 1, 'swap'); push(g.points, t + 135 + h, 0); if (random() < .2) { const s = t + h + 135 + 300; push(g.points, s, 0, 'swap'); push(g.points, s + 45, 1); push(g.points, s + 295, 1, 'swap'); push(g.points, s + 385, 0) } t += sampleHold(MOTION2.glanceEvery, random) }
    const lift = layer('face:page-lift'), land = layer('face:page-land'); t = sampleHold(MOTION2.pageEvery, random) * .45
    while (t < duration - 3000) { span(lift, t, t + MOTION2.pageLift); push(land.points, t + MOTION2.pageLift, 0); push(land.points, t + MOTION2.pageLift, 1); push(land.points, t + MOTION2.pageLift + MOTION2.pageLand, 1, 'swap'); push(land.points, t + MOTION2.pageLift + MOTION2.pageLand + MOTION2.pageSettle, 0); t += sampleHold(MOTION2.pageEvery, random) }
  }
  // breath and sway exactly as B1 (keyed by the behaviour kind)
  const bm = breathMood(kind), b = MOTION2.breath[bm], breath: Point[] = [{ at: 0, value: 0, ease: 'soft' }]; let bt = 0
  const br = seededRandom(seedOf(`breath:${bm}:${variant}`))
  while (bt < MOTION2.breathLoopMs) { const sigh = br() < b.chance, depth = sigh ? b.sigh : b.normal * Math.exp(.12 * (br() * 2 - 1) * 1.7), ti = sampleHold(b.ti, br) * (sigh ? 1.5 : 1), te = sampleHold(b.te, br) * (sigh ? 1.6 : 1), tp = sampleHold(b.tp, br) * (sigh ? 1.5 : 1); push(breath, bt, 0, 'soft'); push(breath, bt + ti, depth, 'out'); push(breath, bt + ti + te, 0, 'step'); bt += ti + te + tp }
  push(breath, bt, 0)
  const sway: Point[] = [{ at: 0, value: 0, ease: 'step' }], sw = MOTION2.sway[kind as keyof typeof MOTION2.sway]
  if (sw) { let t = sampleHold(sw.every, random) * .5; while (t < duration - 18000) { const go = sampleHold(sw.go, random), hold = sampleHold(sw.hold, random), back = sampleHold(sw.back, random), deg = (sw.deg[0] + (sw.deg[1] - sw.deg[0]) * random()) * (random() < .5 ? 1 : -1); push(sway, t, 0, 'soft'); push(sway, t + go, deg, 'step'); push(sway, t + go + hold, deg, 'soft'); push(sway, t + go + hold + back, 0, 'step'); t += go + hold + back + sampleHold(sw.every, random) } }
  push(sway, duration, 0)
  for (const l of layers) { push(l.points, duration, l.points[0]!.value); sorted(l.points) }
  // alternate whole frames are exclusive: the base goes down while an alternate is up (no union of two drawings)
  const alts = layers.filter(l => l !== layers[0] && l.loop && !l.name.startsWith('face:'))
  if (alts.length) {
    const times = [...new Set(alts.flatMap(l => l.points.map(p => p.at)))].sort((a, b) => a - b)
    layers[0]!.points = times.map(at => ({ at, value: alts.some(l => samplePoints(l.points, at + .01) >= .5) ? 0 : 1, ease: 'step' as const }))
    if (layers[0]!.points[0]!.at !== 0) layers[0]!.points.unshift({ at: 0, value: 1, ease: 'step' })
    push(layers[0]!.points, duration, layers[0]!.points[0]!.value)
  }

  // one-shot parts: entry, calming, wake, touch
  let cutAt: number | undefined
  const hide: [number, number][] = []
  const calming = kind === 'idle' && !!options.entryFrom?.startsWith('wild-')
  if (options.waking) {
    // sleep cut at the jolt's bottom (33 ms) straight to the reading pose; the eyes are face patches on it.
    const sleep = layer('sleep', false); sleep.points = [{ at: 0, value: 1, ease: 'step' }, { at: 33, value: 0, ease: 'step' }]
    cutAt = 33
    const closed = layer('face:blink', false), half = layer('face:half', false)
    span(closed, 33, 220); span(half, 220, 330); span(closed, 330, 400); span(half, 400, 450)
  } else if (calming) {
    // calming steps are cuts at each dip's lowest point.
    const old = layer(options.entryFrom!, false); old.points = [{ at: 0, value: 1, ease: 'step' }, { at: CALM.a, value: 0, ease: 'step' }]
    const a = layer('calm-a', false); span(a, CALM.a, CALM.b)
    const c = layer('calm-b', false); span(c, CALM.b, CALM.end)
    cutAt = CALM.end
  } else if (options.entryFrom && options.entryFrom !== base) {
    // a pose change is a cut at the dip's lowest point (55 ms); the incoming pose is hidden until then.
    const entry = layer(options.entryFrom, false); entry.points = [{ at: 0, value: 1, ease: 'step' }, { at: 55, value: 0, ease: 'step' }]
    cutAt = 55
  }
  const reactionAt = options.waking ? Math.max(MOTION2.wake.end, options.reactionStartMs ?? 0) : options.reactionStartMs ?? 0
  if (options.touch) {
    const k = options.touch, at = reactionAt
    const squeeze = layer('face:squeeze', false), smile = layer('face:smile', false), closed = layer('face:blink', false), half = layer('face:half', false), wink = layer('face:wink', false)
    const c = options.continuation, keepSmile = !!c && !options.waking && (c.faces?.smile ?? (c.face === 'smile' ? 1 : 0)) > .5
    if (k === 'poke') { if (!keepSmile) span(squeeze, at, at + 120); span(smile, keepSmile ? at : at + 120, at + 1000); span(half, at + 1000, at + 1060) }
    else if (k === 'wink') { span(squeeze, at, at + 100); span(wink, at + 100, at + 850) }
    else if (k === 'pat') { span(half, at + 40, at + 120); span(closed, at + 120, at + 260); span(smile, at + 260, at + 1250); span(half, at + 1250, at + 1340) }
    else {
      // burst frames are cuts: flustered at the press, Shiori at the dip's bottom (435 ms), out at 1,805 ms.
      const fl = layer('flustered', false); span(fl, at, at + 435); hide.push([at, at + 1805])
      const a = layer('shiori-a', false), bb = layer('shiori-b', false)
      span(a, at + 435, at + 700); span(bb, at + 700, at + 1050); span(a, at + 1050, at + 1400); span(bb, at + 1400, at + 1805)
    }
    const loopFrames = layers.filter(l => l.loop && !l.name.startsWith('face:')).map(l => l.name)
    if (c && !options.waking && !loopFrames.includes(c.frame) && k !== 'burst') { const entry = layer(c.frame, false); entry.points = [{ at: 0, value: 1, ease: 'step' }, { at: 55, value: 0, ease: 'step' }]; hide.push([0, 55]) }
  }
  if (options.touch && options.reactionDurationMs !== undefined) {
    const end = reactionAt + Math.max(1, options.reactionDurationMs)
    for (const l of layers) if (!l.loop && !['sleep', options.entryFrom].includes(l.name)) { l.points = l.points.filter(p => p.at < end); push(l.points, end, 0) }
    for (const h of hide) h[1] = Math.min(h[1], end)
  }
  if(options.touch && canBlink(base, options.pixel)) {
    const end = options.touch==='pat'?1400:options.touch==='burst'?2200:1100
    const after=reactionAt+Math.min(end,options.reactionDurationMs??end)+sampleHold(MOTION2.afterTouchBlink,random), shut=blinkShut(random)
    const half=layer('face:half',false),closed=layer('face:blink',false)
    span(half,after,after+33);span(closed,after+33,after+33+shut);span(half,after+33+shut,after+83+shut)
  }
  for (const l of layers) if (!l.loop) sorted(l.points)
  // gestures as B1 (sampled at 60 fps), with the burst's two dips at the new cut times
  const reactionContinuation = options.waking ? (() => { const r = sampleSpring(MOTION2.wake.sy, MOTION2.wake.end - MOTION2.wake.pressMs, MOTION2.wakeSpring); return { ...identity(base), sy: r, sx: 1 - (r - 1) * .3 } })() : options.continuation
  const gesture: MotionSnapshot[] = [], gestureTimes: number[] = []
  if (options.touch || options.waking || options.entryFrom || ['happy', 'wild', 'error', 'wave', 'refuse'].includes(kind)) {
    const end = Math.max(calming ? CALM.end - 55 + 450 : 0, options.waking ? 450 : 0, options.touch ? reactionAt + (options.touch === 'pat' ? 1400 : options.touch === 'burst' ? 2200 : 1100) : kind==='wave'?1100:600)
    const gestureSamples=[...new Set([0,33,50,55,60,355,450,end,...Array.from({length:Math.floor(end*60/1000)+1},(_,i)=>i*1000/60),...(calming?[468,523,1316,1371]:[]),...(options.touch?[reactionAt,reactionAt+60,reactionAt+260,reactionAt+380,reactionAt+435,reactionAt+1750,reactionAt+1805,reactionAt+(options.reactionDurationMs??end)]:[])])].filter(t=>t<=end).sort((a,b)=>a-b)
    for (const t of gestureSamples) {
      let s = identity(base)
      if (options.waking && t < 450) { const p = MOTION2.wake, u = motionEase('out', Math.min(1, t / p.pressMs)); s.sy = t < p.pressMs ? 1 + (p.sy - 1) * u : sampleSpring(p.sy, t - p.pressMs, MOTION2.wakeSpring); s.sx = 1 - (s.sy - 1) * .3 }
      else if (options.touch && t >= reactionAt && (options.reactionDurationMs === undefined || t - reactionAt < options.reactionDurationMs)) s = sampleTouch(options.touch, t - reactionAt, reactionContinuation)
      else if (calming) { const start = [0, CALM.b - 55, CALM.end - 55].filter(x => x <= t).pop() ?? 0; s.sy = dipAt(t - start); s.sx = 1 - (s.sy - 1) * .3 }
      else if (options.entryFrom || ['happy', 'wild', 'error'].includes(kind)) { const floor = kind === 'happy' ? .95 : kind === 'wild' ? .965 : kind === 'error' ? .96 : MOTION2.dipY; s.sy = dipAt(t, floor); s.sx = 1 - (s.sy - 1) * .3 }
      if (kind === 'wave' && t>=55) s.skew += 1.5 * Math.sin(2 * Math.PI * (t-55) / 520) * Math.max(0, 1 - (t-55) / 1040)
      if (kind === 'refuse' && t>=55) s.skew += -.9 * motionEase('out', Math.min(1, (t-55) / 300))
      if (options.touch === 'burst' && t >= reactionAt && t-reactionAt<(options.reactionDurationMs??2200)) { const r = t - reactionAt; for (const start of [380, 1750]) if (r >= start && r < start + 450) { s.sy = dipAt(r - start); s.sx = 1 - (s.sy - 1) * .3 } }
      gesture.push(s); gestureTimes.push(t)
    }
    gesture.push({...identity(base),skew:kind==='refuse'?-.9:0}); gestureTimes.push(kind==='wave'?end:end + 1000 / 60)
  }
  if (cutAt !== undefined) hide.push([0, cutAt])
  const frameAt=(at:number):string=>{
    let frame=base
    for(const l of layers)if(!l.name.startsWith('face:')&&samplePoints(l.points,l.loop?at%duration:at)>=.5)frame=l.name
    return frame
  }
  const result: MotionTimeline = { mood, variant, duration, breathDuration: bt, layers, breath: sorted(breath), sway: sorted(sway), shift, gesture, gestureTimes, blinks, blinkObstacles, blinkExceptions, swaps, deepThoughts, hide, reactionAt, frameAt }
  if(timelineCache.size>=96)timelineCache.delete(timelineCache.keys().next().value!)
  timelineCache.set(key, result); return result
}

export function sampleMotion(mood:string, elapsedMs:number, variant:MotionVariant=0, options:MotionOptions={}):MotionSnapshot {
  const m=generateMotion(mood,variant,options),at=Math.max(0,elapsedMs),clock=options.moodElapsedMs??at
  let frame=motionFrame(mood)
  const hidden=m.hide.some(([a,b])=>at>=a&&at<b)
  for(const l of m.layers)if(!l.name.startsWith('face:')&&(!l.loop||!hidden)&&samplePoints(l.points,l.loop?clock%m.duration:at)>.5)frame=l.name
  const s=identity(frame),b=MOTION2.breath[breathMood(kindOf(mood))],depth=samplePoints(m.breath,clock%m.breathDuration)
  s.sy=1-b.A*(1-depth);s.sx=1-.3*b.A*(1-depth);s.skew=samplePoints(m.sway,clock%m.duration)
  s.breathSy=s.sy;s.breathSx=s.sx;s.swaySkew=s.skew
  for(const start of m.shift)if(clock%m.duration>=start&&clock%m.duration<start+451){const y=dipAt(clock%m.duration-start);s.shiftSy=y;s.shiftSx=1-(y-1)*.3;s.sy*=s.shiftSy;s.sx*=s.shiftSx}
  if(m.gesture.length){let i=0;while(i+1<m.gestureTimes.length&&m.gestureTimes[i+1]!<=at)i++
    const a=m.gesture[i]!,b=m.gesture[Math.min(i+1,m.gesture.length-1)]!,ta=m.gestureTimes[i]!,tb=m.gestureTimes[Math.min(i+1,m.gestureTimes.length-1)]!,u=tb===ta?0:Math.max(0,Math.min(1,(at-ta)/(tb-ta)))
    s.sy*=a.sy+(b.sy-a.sy)*u;s.sx*=a.sx+(b.sx-a.sx)*u;s.skew+=a.skew+(b.skew-a.skew)*u
  }
  const faces=m.layers.filter(l=>l.name.startsWith('face:')&&motionHasFace(frame,l.name.slice(5),options.pixel))
  const shot=faces.some(l=>!l.loop&&samplePoints(l.points,at)>.5)
  s.faces={}
  for(const l of faces){if(l.loop&&(hidden||shot))continue;const weight=samplePoints(l.points,l.loop?clock%m.duration:at);if(weight<=0)continue
    const name=l.name.slice(5),face=name==='blink'?'closed':(['half','squeeze','smile','wink'].includes(name)?name:undefined)
    if(face){s.face=face as FaceKind;s.faces={[face]:weight}}
  }
  return s
}
// The terminal uses its closed-eye drawing only during the complete blink.
export function nextMotionChange(mood:string,elapsedMs:number,variant:MotionVariant=0):{frame:string;afterMs:number} {
  const m=generateMotion(mood,variant),at=((elapsedMs%m.duration)+m.duration)%m.duration
  const frameAt=(time:number)=>{const s=sampleMotion(mood,time,variant);return s.frame==='idle-reading'&&s.face==='closed'?'idle-blink':s.frame}
  const current=frameAt(at),times=[...new Set(m.layers.flatMap(l=>l.points.map(p=>p.at)))].filter(t=>t>at+.001).sort((a,b)=>a-b)
  for(const t of times)if(frameAt(t+.001)!==current)return{frame:current,afterMs:Math.max(1,t-at+.01)}
  return{frame:current,afterMs:m.duration-at+.01}
}
