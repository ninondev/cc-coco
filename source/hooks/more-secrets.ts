export type SecretKind='anthropic'|'openai'|'aws'|'github'|'slack'|'google'|'stripe'|'pem'
export type SecretHit={kind:SecretKind;start:number;end:number;text:string}
// Shapes, not credentials: the list is closed to the providers in EVERY-CAPABILITY O8.
const SHAPES: readonly [SecretKind,RegExp][]=[
 ['anthropic',/\bsk-ant-[A-Za-z0-9][A-Za-z0-9_-]{23,}\b/g],
 ['openai',/\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{20,}\b/g],
 ['aws',/\bAKIA[A-Z0-9]{16}\b/g],
 ['github',/\b(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,})\b/g],
 ['slack',/\bxox[abposr]-[A-Za-z0-9-]{20,}\b/g],
 ['google',/\bAIza[A-Za-z0-9_-]{35}\b/g],
 ['stripe',/\b[rs]k_live_[A-Za-z0-9]{20,}\b/g],
 ['pem',/-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )?PRIVATE KEY-----|$)/g],
]
export function secretHits(text:string):SecretHit[] {
 const hits:SecretHit[]=[]
 for(const [kind,pattern] of SHAPES){pattern.lastIndex=0;let match:RegExpExecArray|null;while((match=pattern.exec(text))!==null)hits.push({kind,start:match.index,end:match.index+match[0].length,text:match[0]})}
 return hits.sort((a,b)=>a.start-b.start||b.end-a.end).filter((hit,index,all)=>!all.slice(0,index).some(prior=>prior.start<=hit.start&&prior.end>=hit.end))
}
export function hideSecrets(text:string,hidden:string):string {
 let result=text
 for(const hit of secretHits(text).reverse())result=result.slice(0,hit.start)+hit.text.slice(0,6)+hidden+result.slice(hit.end)
 return result
}
export async function secretHash(text:string):Promise<string>{
 const bytes=new Uint8Array(Array.from(text,character=>character.charCodeAt(0)))
 const digest=await crypto.subtle.digest('SHA-256',bytes)
 return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('')
}
