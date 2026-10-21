import { lineParts } from './line-slot'
import type { LineValue } from './line-slot'

import { capDisplaySlot, untrustedDisplaySlot } from './display-slot-text'
export { DISPLAY_SLOT_LIMIT, capDisplaySlot, untrustedDisplaySlot } from './display-slot-text'
export const DISPLAY_SLOT_COUNT = 12
const untrusted = (slot: LineValue) => slot.kind === 'path' || slot.kind === 'test' || slot.kind === 'todo'
// Surrounding approved words are copied exactly; only identified values change.
export function displaySlots(text: string, slots: readonly LineValue[] = []): {text: string; slots: LineValue[]} {
  const source = slots.slice(0, DISPLAY_SLOT_COUNT)
  const safe = source.map(slot => ({...slot, value: untrusted(slot) ? untrustedDisplaySlot(slot.value) : capDisplaySlot(slot.value)}))
  const replacements = new Map(source.map((slot, i) => [slot.value, safe[i]!.value]))
  const values = source.filter((slot,i)=>slot.value!==safe[i]!.value).map(slot => slot.value)
  return {text: lineParts(text, values).map(part => part.slot ? replacements.get(part.text)! : part.text).join(''), slots: safe}
}
