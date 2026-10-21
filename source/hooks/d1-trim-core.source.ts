export type TrimPlan={text:string;total:number;kept:number;omitted:number;markers:string[];markerLines:number[]}
const ansi=/\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g
const diagnostic=/\b(?:fail(?:ed|ure|ures)?|error|exception|panic(?:ked)?|warning|warn|assertion|traceback|fatal|expected|actual|skipp?ed|todo|cancel(?:led)?|timeout)\b|错误|失败|警告/i
const progress=/^\s*(?:(?:\[[^\]\n]+\]\s*)?(?:PASS\b|ok\b|✓|✔|\(pass\)|test .+ \.\.\. ok\s*$|(?:Compiling|Checking|Building|Downloading|Downloaded|Copying)\s)|\.{1,}\s*$)/
export function utf8Bytes(text:string):number{
 let bytes=0
 for(let i=0;i<text.length;i++){const code=text.charCodeAt(i);if(code<0x80)bytes++;else if(code<0x800)bytes+=2;else if(code>=0xd800&&code<=0xdbff&&i+1<text.length&&text.charCodeAt(i+1)>=0xdc00&&text.charCodeAt(i+1)<=0xdfff){bytes+=4;i++}else bytes+=3}
 return bytes
}
/** Conservative: only recognised success/progress lines may leave. Every other byte stays. */
export function trimD1Output(text:string,marker:(n:number)=>string,forceThreshold=false):TrimPlan{
 const trailing=text.endsWith('\n'),lines=text?text.split('\n'):[];if(trailing)lines.pop()
 const total=lines.length,unchanged={text,total,kept:total,omitted:0,markers:[],markerLines:[]}
 if(!forceThreshold&&total<=200&&utf8Bytes(text)<=20000)return unchanged
 const keep=lines.map((line,index)=>index<12||index>=total-40||!progress.test(line.replace(ansi,''))||diagnostic.test(line.replace(ansi,'')))
 // A diagnostic owns its neighbouring context and its entire nonblank block.
 for(let i=0;i<total;i++)if(diagnostic.test(lines[i]!.replace(ansi,''))){
  for(let j=Math.max(0,i-3);j<i;j++)keep[j]=true
  let j=i;while(j<total&&lines[j]!.trim()!==''){keep[j]=true;j++}i=Math.max(i,j-1)
 }
 const output:string[]=[],markers:string[]=[],markerLines:number[]=[];let omitted=0
 for(let i=0;i<total;){if(keep[i]){output.push(lines[i]!);i++;continue}const start=i;while(i<total&&!keep[i])i++;const n=i-start,word=marker(n);if(!word)return unchanged;const formatted=word+(lines[start]!.endsWith('\r')?'\r':'');markerLines.push(output.length);output.push(formatted);markers.push(formatted);omitted+=n}
 const shortened=output.join('\n')+(trailing?'\n':'')
 if(!omitted||utf8Bytes(shortened)>=utf8Bytes(text))return unchanged
 return {text:shortened,total,kept:total-omitted,omitted,markers,markerLines}
}
export {trimD1Path} from './d1-trim-path'
export function safeD1DataRoot(path:string):boolean{
 return !!path&&!/[\u0000-\u001f\u007f]/.test(path)&&!/^[/\\]{2}/.test(path)&&(/^(?:\/[\s\S]*|[A-Za-z]:[\\/][\s\S]*)$/.test(path))&&!path.split(/[\\/]/).some(part=>part==='.'||part==='..')&&!/(?:^|[\\/])\.claude(?:[\\/]|$)/i.test(path)
}
