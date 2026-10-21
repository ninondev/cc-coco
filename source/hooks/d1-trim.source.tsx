import {d1Word,loadD1Words} from './d1-words'
import {joinPath} from './paths'
import {trimD1Output,safeD1DataRoot,utf8Bytes} from './d1-trim-core'
import type {D1TrimRow} from './d1-trim-row'
export type {D1TrimRow} from './d1-trim-row'
export type D1TrimInput={id:string;output:string;stderr?:string;run?:{kind:'test'|'build';tool:string}}
export type D1TrimResult={output:string;stderr?:string;row?:D1TrimRow}
export type D1TrimCapabilities={
 dataRoot:string;workerPath:string;home?:string;platform?:string;now?:()=>number;lang:()=>string;enabled:()=>boolean
 readWords?:()=>Promise<string>;copy?:(text:string)=>Promise<boolean>
 process:(argv:string[],init?:{stdin?:string;timeoutMs?:number})=>Promise<{exitCode:number;stdout:string;stderr:string;isStdoutTruncated?:boolean}>
}
const WHAT='successful test and build progress' // trim.marker.{what}: owner words pending.
function countText(n:number,lang:string):string{try{return new Intl.NumberFormat(lang).format(n)}catch{return String(n)}}
function sessionHex(text:string):string{let hash=2166136261;for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619)}return (hash>>>0).toString(16).padStart(8,'0').slice(-4)}
function logPath(root:string,path:unknown):path is string{
 if(typeof path!=='string'||!safeD1DataRoot(root))return false
 const prefix=joinPath(root,'logs'),normal=(s:string)=>/^[A-Za-z]:/.test(root)?s.replace(/\\/g,'/').toLowerCase():s
 const own=normal(path),base=normal(prefix)
 return own.startsWith(base+'/')&&/^[a-f0-9]{4}\/\d{4}-[a-z0-9_-]{1,32}(?:-\d+)?\.log$/.test(own.slice(base.length+1))
}
export function createD1TrimRuntime(cap:D1TrimCapabilities){
 let session='',epoch=0,serial:Promise<unknown>=Promise.resolve(),interpreter:string|undefined
 const rows=new Map<string,D1TrimRow>()
 async function worker(request:Record<string,unknown>):Promise<{ok?:boolean;path?:string}|undefined>{
  if(!safeD1DataRoot(cap.dataRoot))return undefined
  for(const binary of interpreter?[interpreter]:['node','bun'])try{
   const answer=await cap.process([binary,cap.workerPath],{stdin:JSON.stringify({...request,root:cap.dataRoot}),timeoutMs:30000})
   if(answer.exitCode!==0||answer.isStdoutTruncated)continue
   const result:unknown=JSON.parse(answer.stdout);if(!result||typeof result!=='object')continue
   const envelope=result as {ok?:boolean;path?:string};if(envelope.ok!==true)return undefined
   interpreter=binary;return envelope
  }catch{}
  return undefined
 }
 function queued<T>(callback:()=>Promise<T>):Promise<T>{const task=serial.catch(()=>{}).then(callback);serial=task.then(()=>{},()=>{});return task}
 function start(id:string):void{session=sessionHex(id);epoch++;rows.clear()}
 async function capture(input:D1TrimInput):Promise<D1TrimResult>{
  const unchanged:D1TrimResult={output:input.output,...(input.stderr!==undefined?{stderr:input.stderr}:{})}
  if(!cap.enabled()||!session||!input.run||!['test','build'].includes(input.run.kind)||!safeD1DataRoot(cap.dataRoot))return unchanged
  const own=epoch
  if(cap.readWords)await loadD1Words(cap.readWords)
  if(own!==epoch||!cap.enabled())return unchanged
  const lang=cap.lang(),mark=(n:number)=>d1Word(lang,'trim.marker',{n:countText(n,lang),what:WHAT},n)
  const combined=input.output+(input.stderr?(input.output&&!input.output.endsWith('\n')?'\n':'')+input.stderr:'')
  if(utf8Bytes(combined)>20000000)return unchanged
  const combinedLines=(input.output?input.output.split('\n').length-(input.output.endsWith('\n')?1:0):0)+(input.stderr?input.stderr.split('\n').length-(input.stderr.endsWith('\n')?1:0):0),overThreshold=combinedLines>200||utf8Bytes(combined)>20000
  const outPlan=trimD1Output(input.output,mark,overThreshold),errPlan=trimD1Output(input.stderr??'',mark,overThreshold)
  if(!outPlan.omitted&&!errPlan.omitted)return unchanged
  return queued(async()=>{
   if(!cap.enabled()||own!==epoch)return unchanged
   const result=await worker({op:'write',session,program:input.run!.tool.toLowerCase().replace(/[^a-z0-9_-]/g,'-').slice(0,32)||input.run!.kind,at:(cap.now??Date.now)(),text:combined})
   if(!result?.ok||!logPath(cap.dataRoot,result.path)||own!==epoch||!cap.enabled())return unchanged
   const row:D1TrimRow={id:input.id,path:result.path,total:outPlan.total+errPlan.total,kept:outPlan.kept+errPlan.kept,markers:[...outPlan.markers,...errPlan.markers],markerLines:[...outPlan.markerLines,...errPlan.markerLines.map(index=>index+outPlan.kept+outPlan.markers.length)],home:cap.home}
   rows.set(input.id,row);while(rows.size>40)rows.delete(rows.keys().next().value!)
   return {output:outPlan.text,...(input.stderr!==undefined?{stderr:errPlan.text}:{}),row}
  })
 }
 function row(id:string):D1TrimRow|undefined{return cap.enabled()?rows.get(id):undefined}
 async function settingsChanged():Promise<void>{
  if(cap.enabled())return
  epoch++;rows.clear()
  await queued(async()=>{await worker({op:'purge'})})
 }
 async function press(key:string):Promise<boolean>{
  const own=epoch,match=/^coco:trim:(open|copy):(.+)$/.exec(key),known=match?row(match[2]!):undefined
  if(!known||!logPath(cap.dataRoot,known.path))return false
  const checked=await queued(()=>worker({op:'check',path:known.path}));if(!checked?.ok||!cap.enabled()||own!==epoch||row(match![2]!)!==known)return false
  if(match![1]==='copy')return await cap.copy?.(known.path)??false
  // argv carries the path; Windows shell metacharacters are refused before cmd parsing.
  const windows=cap.platform==='win32'||cap.platform==='Windows_NT'||/^[A-Za-z]:/.test(known.path)
  if(windows&&/[&|<>^%!\r\n"]/g.test(known.path))return false
  const argv=windows?['cmd','/d','/c','start','""',known.path]:cap.platform==='darwin'||cap.platform==='macOS'?['open',known.path]:['xdg-open',known.path]
  try{return (await cap.process(argv,{timeoutMs:5000})).exitCode===0}catch{return false}
 }
 return {start,capture,row,settingsChanged,press}
}
export type D1TrimRuntime=ReturnType<typeof createD1TrimRuntime>
export function d1TrimOutputParts(text:string,markers:string[],markerLines?:number[]):{text:string;marker:boolean}[]{
 const own=new Set(markers),precise=markerLines?new Set(markerLines):undefined,lines=text.split('\n'),result:{text:string;marker:boolean}[]=[]
 for(let i=0;i<lines.length;i++){const content=lines[i]!+(i<lines.length-1?'\n':'');if(!content)continue;result.push({text:content,marker:own.has(lines[i]!)&&(!precise||precise.has(i))})}
 return result
}

export function replaceD1TrimmedResult<T extends {ref?:number;result?:unknown;text?:string}>(ran:T,result:Record<string,unknown>,trimmed:Pick<D1TrimResult,'output'|'stderr'>):T{
 const text=trimmed.output+(trimmed.stderr?(trimmed.output&&!trimmed.output.endsWith('\n')?'\n':'')+trimmed.stderr:'')
 const replacement={...ran};delete replacement.ref
 return {...replacement,text,result:{...result,stdout:trimmed.output,...(trimmed.stderr!==undefined?{stderr:trimmed.stderr}:{})}} as T
}
