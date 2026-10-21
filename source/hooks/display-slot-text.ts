export const DISPLAY_SLOT_LIMIT = 512
// Joiners are semantic in Arabic/Persian shaping and emoji sequences.
const unsafe = /[\u0000-\u001f\u007f-\u009f]|\p{Cf}/u
export function untrustedDisplaySlot(value: string): string {
  let result = '', consumed = 0, sourceAt = 0, emojiTagEnd = 0
  const source=value.slice(0, DISPLAY_SLOT_LIMIT + 1)
  // Never segment or copy the complete untrusted input before applying its cap.
  for (const char of source) {
    const code = char.codePointAt(0)!
    if(code===0x1f3f4){
      const flag=/^\u{1F3F4}[\u{E0030}-\u{E0039}\u{E0061}-\u{E007A}]{1,32}\u{E007F}/u.exec(source.slice(sourceAt))
      if(flag)emojiTagEnd=sourceAt+flag[0].length
    }
    const emojiTag=sourceAt<emojiTagEnd&&code>=0xe0020&&code<=0xe007f
    const piece = !emojiTag && code !== 0x200c && code !== 0x200d && unsafe.test(char)
      ? `⟨U+${code.toString(16).toUpperCase().padStart(4, '0')}⟩` : char
    if (result.length + piece.length > DISPLAY_SLOT_LIMIT - 1) break
    result += piece; consumed += char.length; sourceAt += char.length
  }
  return consumed < value.length ? result + '…' : result
}
export function capDisplaySlot(value:string):string {
  if(value.length<=DISPLAY_SLOT_LIMIT)return value
  let end=DISPLAY_SLOT_LIMIT-1
  if(/[\uD800-\uDBFF]/.test(value[end-1]!))end--
  return value.slice(0,end)+'…'
}
