import type { Elements, RenderElement } from 'claude-code'
import { moreWord } from './more-words'
import { redactBookmark } from './c3-secrets'

export const RECEIVED_MARKER_SLOT = 'received.marker'
// The note's own disclosure: it goes to Claude when passed. Not the More rows' model-service disclosure.
export const RECEIVED_DISCLOSURE_SLOT = 'received.disclosure'
export type ReceivedNote = Readonly<{ id: string; text: string }>
// Same-user files and sender labels carry no user authority. This inbox is
// session memory only, with no timer, model call or stored consent.
export class ReceivedNotes {
  private notes = new Map<string, ReceivedNote>()
  private identities = new Set<string>()
  enqueue(id: string, text: string): boolean {
    if (!id || id.length > 300 || this.identities.has(id) || this.identities.size >= 4096
      || this.notes.size >= 32 || !text.trim() || text.includes('\0')) return false
    const escaped = [...redactBookmark(text)].slice(0, 4000).join('').replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,
      c => c === '\n' || c === '\t' ? c : '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
    const safe = [...escaped].slice(0, 4000).join('')
    this.identities.add(id); this.notes.set(id, { id, text: safe })
    return true
  }
  snapshot(): ReceivedNote[] { return [...this.notes.values()] }
  pass(id: string, marker: string, submit: (text: string) => Promise<unknown>): Promise<void> | undefined {
    const note = this.notes.get(id)
    if (!note || !marker.trim()) return
    // Consume before calling the host. Repeated/concurrent presses and an
    // uncertain throwing submission never repeat the action.
    this.notes.delete(id)
    return Promise.resolve().then(() => submit(marker + '\n\n' + note.text)).then(() => {})
  }
}
let receivedNotes: ReceivedNotes | undefined
export function receivedInbox(): ReceivedNotes { return receivedNotes ??= new ReceivedNotes() }
export function resetReceivedInbox(): void { receivedNotes = undefined }
export function receivedNoteKey(id: string): string { return 'coco:received:pass:' + encodeURIComponent(id) }
export function receivedNoteId(key: string): string | undefined {
  const prefix = 'coco:received:pass:'
  if (!key.startsWith(prefix)) return
  try { return decodeURIComponent(key.slice(prefix.length)) } catch { return }
}
export function ReceivedNotesBook(E: Elements[keyof Elements], lang: string, allowPass = false): RenderElement | undefined {
  const rows = receivedNotes?.snapshot()
  if (!rows?.length) return
  const { Box, Text, Button } = E
  return <Box flexDirection="column" rowGap={1}><Text bold wrap="wrap">{moreWord('received.title', lang)}</Text>{rows.map(note =>
    <Box key={'coco:received:' + encodeURIComponent(note.id)} flexDirection="column">
      <Text wrap="wrap">{note.text}</Text>
      {allowPass && moreWord(RECEIVED_MARKER_SLOT, lang) ? <Text wrap="wrap">{moreWord(RECEIVED_DISCLOSURE_SLOT, lang)}</Text> : null}
      {allowPass && moreWord(RECEIVED_MARKER_SLOT, lang) ? <Button key={receivedNoteKey(note.id)} label={moreWord('talk.askClaude', lang)} onPress={() => {}} /> : null}
    </Box>)}</Box>
}
