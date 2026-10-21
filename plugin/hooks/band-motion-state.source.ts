// The desktop worker and event replay use this same plain-data projection.
import type { MotionSnapshot, MotionVariant, TouchKind } from './motion'
import { MOTION, MOTION2 } from './motion'
import type { MotionPictureOptions } from './motion-svg'

export type BandTouch = {
  kind: TouchKind; at: number; until: number; wakeAt?: number;
  continuation?: MotionSnapshot;
}
export type BandMotionState = {
  mood: string; now: number; epoch: number; variant: MotionVariant;
  from?: string; wakingAt?: number; touch?: BandTouch;
  pixel: boolean; height: number; reducedMotion: boolean;
  mode: MotionPictureOptions['mode']; page?: boolean;
}

export function bandMotionOptions(state: BandMotionState): MotionPictureOptions {
  const { now, epoch, touch } = state
  const afterBlink = state.reducedMotion || state.mode === 'swaps' ? 0
    : MOTION2.afterTouchBlink.max + MOTION2.halfClose + MOTION.blink.shut.max + MOTION2.halfOpen
  const activeTouch = touch && now < touch.until + afterBlink ? touch : undefined
  const waking = state.wakingAt !== undefined && now < state.wakingAt + 450
  const wakeAt = activeTouch?.wakeAt ?? (waking ? state.wakingAt : undefined)
  const reactionAt = activeTouch ? Math.max(activeTouch.at, (activeTouch.wakeAt ?? -Infinity) + 450) : undefined
  const entryMs = state.mood === 'idle' && state.from?.startsWith('wild-') ? 1790 : 620
  return {
    mood: state.mood, variant: state.variant, mode: state.mode, pixel: state.pixel,
    height: state.height, reducedMotion: state.reducedMotion, page: state.page,
    elapsedMs: Math.max(0, now - epoch),
    entryFrom: !touch && now - epoch < entryMs ? state.from : undefined,
    touch: activeTouch?.kind,
    reactionDurationMs: activeTouch ? Math.max(0, activeTouch.until - reactionAt!) : undefined,
    waking: waking || activeTouch?.wakeAt !== undefined,
    reactionElapsedMs: Math.max(0, now - (activeTouch?.at ?? epoch)),
    wakeElapsedMs: wakeAt === undefined ? undefined : Math.max(0, now - wakeAt),
    continuation: activeTouch?.continuation,
    reactionStartMs: activeTouch ? reactionAt! - (activeTouch.wakeAt ?? activeTouch.at) : undefined,
  }
}
