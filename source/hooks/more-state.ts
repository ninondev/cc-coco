import { moreWord, moreFill } from './more-words'
import { numberText } from './numbers'
import type { KeyStore } from './talk-key'
export const MORE_IDS = ['cap','paste','lively','talk','explain','look','plain','lines'] as const
export type MoreId = typeof MORE_IDS[number]
export type MoreValues = Partial<Record<MoreId, boolean | number>>
// cut: Talk replies that reached their 400-token cap today, kept so we can see how often (lead, 10-10).
export type MoreCount = { n: number; tokens: number; cacheRead: number; lastTokens?:number; cut?:number }
export type MoreToday = { date: string; rows: Partial<Record<MoreId, MoreCount>> }
// TALK-KEY 3: who pays for Talk and Explain, and what the key program last said. The key itself is never here.
export type MorePayerChoice = 'session' | 'key'
export type MoreKey = { last4: string; state: 'works' | 'refused' | 'unchecked'; store?: KeyStore; host?: string; model?: string }
export type MoreKeyToday = { date: string; n: number; tokens: number; usd: number; day: number }
export type MoreKeyView = { payer: MorePayerChoice; key?: MoreKey; today?: MoreKeyToday; noRun: boolean; notice?: string; busy: boolean; base?: string; model?: string }
// What Talk (Explain with it) and the second look may run on (more-models.ts) and the pick for each; `own` when the session reaches
// a service other than Anthropic's, where nothing is picked for them (owner 10-17).
export type MoreModelChoice = { value: string; label: string }
export type MoreModelRow = 'talk' | 'look' | 'lines'
export type MoreModels = { choices: MoreModelChoice[]; own: boolean; picks?: Partial<Record<MoreModelRow, string>> }
// The line library (owner 10-17): the character worn, the language picked for written lines, Coco's mix, whether the
// written set for them is there, being written or failed, where the files the person opened are, and which one the
// editor could not open.
export type MoreLines = { character: 'coco' | 'dake' | 'maid'; lang: string; mix: 'only' | 'both'; state: 'none' | 'busy' | 'ready' | 'failed'; paths?: { shipped?: string; generated?: string }; editFailed?: 'shipped' | 'generated' }
// The DM thread's choices (dm.ts): where her first messages come from (the model only once lane B's instruction is
// there), whether a new message notifies, and how many the person has not seen.
export type MoreDm = { first: 'lines' | 'model'; notify: boolean; model: boolean; unread: number }
export type MoreSnapshot = { values: MoreValues; agreed: MoreId[]; today: MoreToday; asking?: MoreId; focused?: MoreId; entryFocused?:boolean; reading: number; open: boolean; lang: string; screenReader: boolean; key?: MoreKeyView; models?: MoreModels; lines?: MoreLines; dm?: MoreDm }
// Regrouped 10-09 by what a row costs (EVERY-CAPABILITY 7.2): the heading is the cost kind itself.
export const MORE_GROUPS = [
  { id:'free', rows:['cap','paste','lively'] },
  { id:'plan', rows:['talk','explain','plain','look','lines'] },
] as const
// Who pays for the plan rows (TALK-KEY 3): a bearer session with plan windows is «Uses your plan», anything else
// (an API key, a gateway token, a cloud provider) «Uses this session's account».
export type MorePayer = 'plan' | 'account'
export function morePayer(kind: string | undefined, rateWindows: boolean): MorePayer { return kind === 'bearer' && rateWindows ? 'plan' : 'account' }
export const MORE_ASK = new Set<MoreId>(['talk','explain','look','plain','lines'])
export const MORE_SERVICE_ROWS = new Set<MoreId>(['talk','explain','look','plain','lines'])
export const MORE_SERVICE_SLOT = 'modelService.disclosure'
export const MORE_TALK_PERSONA = 'model.talk.persona'
export const MORE_LOOK_PROMPT = 'model.look.prompt'
export const MORE_LINE_PROMPTS = ['model.lines.coco', 'model.lines.dake', 'model.lines.maid'] as const
// A row that calls a model can turn on only with its authored words: the model-service disclosure (DECISIONS 04:2x)
// and, for Talk and the second look, the model instruction, which waits for the owner's sign-off.
export function moreRowAuthored(id: MoreId, lang: string): boolean {
  return (!MORE_SERVICE_ROWS.has(id) || !!moreWord(MORE_SERVICE_SLOT, lang)) && (id !== 'talk' || !!moreWord(MORE_TALK_PERSONA, 'en'))
    && (id !== 'look' || !!moreWord(MORE_LOOK_PROMPT, 'en')) && (id !== 'lines' || MORE_LINE_PROMPTS.every(slot => !!moreWord(slot, 'en')))
}
export function moreValues(value: unknown): MoreValues {
  if (!value || typeof value !== 'object') return {}
  const data = value as Record<string,unknown>, result: MoreValues = {}
  for (const id of MORE_IDS) {
    if (id === 'cap') { if ([0,1,5,20,50].includes(Number(data[id]))) result[id] = Number(data[id]) }
    else if (data[id] === true) result[id] = true
  }
  return result
}
export function moreDay(at: number): string {
  const d = new Date(at)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
// Every row can work since the second look's reader is held to the changed files (U3, 10-17: its agent's every tool call
// is checked, more-runtime.ts lookDeny). A row that cannot run here is drawn with one line saying why (U6, owner 10-17:
// 「画出来，写一句为什么」).
export function moreRowSupported(_id: MoreId): boolean { return true }
export function moreRows(_surface: string): MoreId[] { return MORE_IDS.filter(moreRowSupported) }
export function moreOn(values: MoreValues, id: MoreId): boolean { return id === 'cap' ? typeof values.cap === 'number' && values.cap > 0 : values[id] === true }
// O7 is the API-key dollar line only: 1, 5 or 20 USD for this session.
export const CAP_DOLLARS = [1,5,20] as const
export function capChoices(lang: string) {
  const w = (key: string) => moreWord(key,lang)
  return [{value:'0',label:w('cap.off')},...CAP_DOLLARS.map((n,i)=>({value:String(n),label:w(`cap.choices.${i}`)||moreFill(w('cap.dollar'),{n})}))]
}
export function moreCountText(s: MoreSnapshot,id: MoreId): string {
  const row = s.today.rows[id]
  if (!row) return ''
  // numbers grouped as the rest of the book writes them (112,000, BOOK F10)
  const n = (value: number): string => numberText(value, s.lang)
  if (id === 'look') return row.lastTokens===undefined?'':moreFill(moreWord('look.last',s.lang),{k:n(row.lastTokens)})
  const text = moreFill(moreWord('today',s.lang),{n:n(row.n),tokens:n(row.tokens)})
  return id === 'explain' ? `${text}\n${moreFill(moreWord('today.cache',s.lang),{c:n(row.cacheRead)})}` : text
}
