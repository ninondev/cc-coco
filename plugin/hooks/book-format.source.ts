// Transcript formatting must not load the unopened book's rendering modules.
import { momentText } from './numbers'
export const NO_ITALIC: ReadonlySet<string> = new Set(['zh', 'zh-Hant', 'ja', 'ko', 'hi'])
export function moment(iso: string, now: number, lang: string, timeZone: string | undefined): string { return momentText(iso, now, lang, timeZone) }
