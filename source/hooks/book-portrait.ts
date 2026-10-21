// Coco's pictures in her itabag (the book): each page's portrait is one of her hand-drawn band poses, held still, in
// the outfit she wears now. Shared by the plugin's pages and the web demo's book.
import { cocoStill, cocoWidth } from './coco-motion'
import type { CocoActionKey, CocoOutfit } from './coco-motion'
import type { Page } from './book-word-types'

export const PORTRAIT_POSES: Record<Page, CocoActionKey> = { him: 'praised', offerings: 'work', omen: 'lookup', socks: 'pass', log: 'read', library: 'peek', settings: 'think' }

// The page's portrait, `height` px tall, and how wide it is drawn.
export function bookPortrait(page: Page, height: number, outfit: CocoOutfit): { source: string; width: number } {
  return { source: cocoStill(outfit, PORTRAIT_POSES[page], height), width: cocoWidth(height) }
}
