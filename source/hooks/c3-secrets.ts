import {secretHits} from './more-secrets'

// The guard and bookmark store share credential shapes. O8 keeps its approved
// closed provider list and kind labels; persistence also covers contextual tokens.
type SecretRange={start:number;end:number}
const EXTRA_SHAPES:readonly RegExp[]=[
 /\b(?:ASIA[A-Z0-9]{16}|sk-(?:ant-api\d+-)?[A-Za-z0-9_-]{20,}|(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AIza[A-Za-z0-9_-]{30,}|(?:glpat-|hf_)[A-Za-z0-9_-]{20,}|SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,})(?![A-Za-z0-9_-])/g,
 /\bBearer[ \t]+[A-Za-z0-9._~+\/-]+={0,}/gi,
 /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*(?![A-Za-z0-9_-])/g,
]
function credentialRanges(text:string):SecretRange[]{
 const ranges:SecretRange[]=secretHits(text).map(hit=>({start:hit.start,end:hit.end}))
 for(const pattern of EXTRA_SHAPES){pattern.lastIndex=0;let match:RegExpExecArray|null;while((match=pattern.exec(text))!==null)ranges.push({start:match.index,end:match.index+match[0].length})}
 return ranges
}

const secretPattern=()=>/(?:AKIA|ASIA)[A-Z0-9]{16}|-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----|\bsk-(?:ant-api\d+-)?[A-Za-z0-9_-]{20,}|\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}|\bxox[baprs]-[A-Za-z0-9-]{20,}|\bAIza[A-Za-z0-9_-]{30,}|\b(?:glpat-|hf_)[A-Za-z0-9_-]{20,}|\b(?:SG\.)[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/
const assignmentPattern=()=>/\b(?:password|passwd|pwd|api[_-]?key|access[_-]?token|secret)\s*[:=]\s*["']?([A-Za-z0-9_+\/-]{20,})/gi
const randomSecret=(value:string)=>/[a-z]/.test(value)&&/[A-Z0-9]/.test(value)&&new Set(value).size>=10
export function redactSecrets(text:string):string{
 // The shared guard shapes (bearer tokens, JWTs, provider keys) are masked first.
 const ranges=credentialRanges(text).sort((x,y)=>x.start-y.start)
 let shaped='',at=0
 for(const range of ranges){if(range.end<=at)continue;shaped+=text.slice(at,Math.max(at,range.start))+'«…»';at=range.end}
 text=shaped+text.slice(at)
 const recognized=secretPattern(),safe=text.replace(/-----BEGIN ((?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY)-----[\s\S]*?(?:-----END \1-----|$)/g,'«…»')
 return safe.replace(new RegExp(recognized.source,'g'),'«…»').replace(assignmentPattern(),(match,value:string)=>randomSecret(value)?match.slice(0,match.length-value.length)+'«…»':match)
}
// Keep an entire redaction marker when it crosses the bookmark's code-point cap.
export function bookmarkText(text:string):string{
 const points=[...redactSecrets(text)],end=200
 let count=0;const kept:string[]=[]
 for(let i=0;i<points.length&&count<end;i++){
  const marker=points[i]==='«'&&points[i+1]==='…'&&points[i+2]==='»',token=marker?'«…»':points[i]!,size=marker?3:1
  if(count+size>end){while(count+size>end){const old=kept.pop()!;count-=old==='«…»'?3:1}kept.push(token);break}
  kept.push(token);count+=size;if(marker)i+=2
 }
 return kept.join('')
}
// Only the added lines are scanned. The returned value never contains a matched token.
export function scanStagedSecrets(diff:string):{file:string;line:number}|undefined{
 let file:string|undefined,line=0,added=false
 for(const raw of diff.split('\n')){
  if(raw.startsWith('+++ ')){const path=raw.slice(4).replace(/^b\//,'');file=path!=='/dev/null'&&!path.startsWith('/')&&!path.startsWith('../')?path:undefined;added=false;continue}
  const hunk=/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);if(hunk){line=Number(hunk[1]);added=true;continue}
  if(!file||!added||raw.startsWith('\\'))continue
  if(raw.startsWith('-'))continue
  if(raw.startsWith('+')){
   const text=raw.slice(1),assignment=assignmentPattern().exec(text)
   const value=assignment?.[1];const random=value&&randomSecret(value)
   if(credentialRanges(text).length||secretPattern().test(text)||random)return {file,line}
  }
  line++
 }
 return undefined
}

// Match the entire source before applying limits. Explicit credential fields
// are masked even when their value is short or has spaces; ordinary unlabelled
// words cannot reliably be identified as passwords by a shape matcher.
export function redactBookmark(text:string):string {
 const ranges=credentialRanges(text)
 const assignment=/(?:["']?\b(?:password|passwd|pwd|api[_-]?key|api[_-]?secret|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret[_-]?key|secret)["']?\s*[:=]\s*)(?:"((?:\\.|[^"\\\r\n])*)"|'((?:\\.|[^'\\\r\n])*)'|([^\s,;}\]]+))/gi
 let match:RegExpExecArray|null
 while((match=assignment.exec(text))!==null){
  const value=match[1]??match[2]??match[3];if(!value)continue
  const start=match.index+match[0].lastIndexOf(value)
  ranges.push({start,end:start+value.length})
 }
 ranges.sort((a,b)=>a.start-b.start||b.end-a.end)
 const merged:SecretRange[]=[]
 for(const range of ranges){const previous=merged.at(-1);if(previous&&range.start<=previous.end)previous.end=Math.max(previous.end,range.end);else merged.push({...range})}
 let result='',at=0
 for(const range of merged){result+=text.slice(at,range.start)+'…';at=range.end}
 return result+text.slice(at)
}

// Direction controls and terminal controls are visible data at untrusted display
// boundaries. Joining marks U+200C/U+200D and ordinary multilingual text survive.
export function displaySlot(text:string,multiline=false):string {
 return text.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,
  character=>multiline&&(character==='\n'||character==='\r')?character:'\\u'+character.charCodeAt(0).toString(16).padStart(4,'0'))
}

// SHA-256 over UTF-8, used only for local timing-history keys; no platform APIs.
const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]
const rotr=(x:number,n:number)=>(x>>>n)|(x<<(32-n))
export function sha256(text:string):string{
 const bytes:number[]=[]
 for(const char of text){let c=char.codePointAt(0)!;if(c>=0xd800&&c<=0xdfff)c=0xfffd;if(c<128)bytes.push(c);else if(c<2048)bytes.push(0xc0|(c>>>6),0x80|(c&63));else if(c<65536)bytes.push(0xe0|(c>>>12),0x80|((c>>>6)&63),0x80|(c&63));else bytes.push(0xf0|(c>>>18),0x80|((c>>>12)&63),0x80|((c>>>6)&63),0x80|(c&63))}
 const bits=bytes.length*8;bytes.push(128);while(bytes.length%64!==56)bytes.push(0)
 const high=Math.floor(bits/0x100000000),low=bits>>>0
 for(const word of [high,low])bytes.push(word>>>24,(word>>>16)&255,(word>>>8)&255,word&255)
 const h=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19],w=new Array<number>(64)
 for(let offset=0;offset<bytes.length;offset+=64){
  for(let i=0;i<16;i++)w[i]=(bytes[offset+i*4]!<<24)|(bytes[offset+i*4+1]!<<16)|(bytes[offset+i*4+2]!<<8)|bytes[offset+i*4+3]!
  for(let i=16;i<64;i++){const x=w[i-15]!,y=w[i-2]!;w[i]=(w[i-16]!+(rotr(x,7)^rotr(x,18)^(x>>>3))+w[i-7]!+(rotr(y,17)^rotr(y,19)^(y>>>10)))|0}
  let [a,b,c,d,e,f,g,q]=h as [number,number,number,number,number,number,number,number]
  for(let i=0;i<64;i++){const t1=(q+(rotr(e,6)^rotr(e,11)^rotr(e,25))+((e&f)^(~e&g))+K[i]!+w[i]!)|0,t2=((rotr(a,2)^rotr(a,13)^rotr(a,22))+((a&b)^(a&c)^(b&c)))|0;q=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0}
  for(const [i,value]of [a,b,c,d,e,f,g,q].entries())h[i]=(h[i]!+value)|0
 }
 return h.map(word=>(word>>>0).toString(16).padStart(8,'0')).join('')
}
