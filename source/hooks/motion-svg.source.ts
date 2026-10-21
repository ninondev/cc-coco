// The band's animation mode, the picture width per height, and the still a frame name falls back to. The old
// figure's painted motion pictures (motion-data.json and its SVG serializer) left the plugin with his go of 10-16
// (DECISIONS 947); the band draws Coco from her own data.
import { STILL_SIZES, STILL_FRAME_METADATA, STILL_FRAME_NAMES } from './motion-stills'
import type { FrameName } from './art'
import type { MotionOptions, MotionVariant } from './motion'

export type AnimationMode = 'image-css' | 'interactive-css' | 'smil' | 'swaps'
export const ANIMATION_MODE: AnimationMode = 'image-css'
export type MotionPictureOptions = MotionOptions & {
  mood: string; variant?: MotionVariant; mode?: AnimationMode; pixel?: boolean; height?: number;
  elapsedMs?: number; reactionElapsedMs?: number; wakeElapsedMs?: number;
  unavailableNames?: readonly string[]; reducedMotion?: boolean; page?: boolean;
}
export function getMotionWidth(height=64,pixel=false):number {const [w,h]=pixel?STILL_SIZES.pixel_size:STILL_SIZES.desktop_size;return pixel?Math.round(w*height/h):(w+8)*height/h}
export function terminalMotionFrame(frame:string):FrameName {
  const aliases:Record<string,FrameName>={'work-c':'work-a','work-d':'work-b','think-c':'think-a','think-d':'think-b','shiori-a':'flustered','shiori-b':'flustered'}
  if(aliases[frame])return aliases[frame]!
  if((STILL_FRAME_NAMES as readonly string[]).includes(frame))return frame as FrameName
  const meta=STILL_FRAME_METADATA.find(item=>item.name===frame);return meta&&(STILL_FRAME_NAMES as readonly string[]).includes(meta.base)?meta.base as FrameName:'idle-reading'
}
