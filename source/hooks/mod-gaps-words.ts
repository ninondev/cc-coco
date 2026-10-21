// Generated from the approved gaps.* author file. Data is read on first use.
let WORDS: Record<string, Record<string, string | string[]>> = {}
let loaded = false
let generation = 0
let pending: Promise<boolean> | undefined
export function installGapWords(value: unknown): boolean {
 if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length === 0) return false
 for (const row of Object.values(value)) {
  if (!row || typeof row !== 'object' || Array.isArray(row) || !('en' in row) || Object.values(row).some(text => typeof text !== 'string' && !(Array.isArray(text) && text.every(part => typeof part === 'string')))) return false
 }
 WORDS = value as Record<string, Record<string, string | string[]>>
 loaded = true
 return true
}
export function loadGapWords(read: () => Promise<string>): Promise<boolean> {
 if (loaded) return Promise.resolve(true)
 if (pending) return pending
 const ticket = generation
 pending = read().then(raw => ticket === generation && installGapWords(JSON.parse(raw))).catch(() => false).then(ok => { if (ticket === generation) pending = undefined; return ok })
 return pending
}
export function resetGapWords(): void { WORDS = {}; loaded = false; generation++; pending = undefined }
export function gapCharacterName(lang: string): string {return (lang==='zh'||lang==='zh-Hant')?'小克':lang==='ja'?'Coco':lang==='ko'?'코코':lang==='hi'?'कोको':'Coco'}
function gapName(lang: string, text: string): string { const name=gapCharacterName(lang);return text.replace(/(^|[^A-Za-z0-9_-])Coco(?=$|[^A-Za-z0-9_-])/gi,(_whole,before:string)=>before+name) }
export function gapPool(lang: string, key: string): readonly string[] { const value=WORDS[key]?.[lang]??WORDS[key]?.en,pool=Array.isArray(value)?value:typeof value==='string'?[value]:[];return pool.map(text=>gapName(lang,text)) }
export function gapWord(lang: string, key: string): string { return gapPool(lang,key)[0]??'' }
export function gapFill(lang: string,key: string,values:Record<string,string|number>):string { return gapWord(lang,key).replace(/\{(\w+)\}/g,(hole,name:string)=>values[name]===undefined?hole:String(values[name])) }
export function missingGapKeys(lang: string): string[] { return Object.keys(WORDS).filter(key=>WORDS[key]?.[lang]===undefined).map(key=>'gaps.'+key) }
