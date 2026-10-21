// Event data only. No timers, network, model calls, file access, or engine handles.
import { sha256 } from './c3-secrets'
export type HelperRow={id:string;description:string;status:string;result?:string}
export type CronRow={id:string;schedule:string;prompt:string}
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}
export function commandKey(command:string):string{return command.trim().replace(/\s+/g,' ')}
// The timing history keeps a digest of each command, never its text (DECISIONS 594).
export function commandDigest(command:string):string{return sha256(commandKey(command))}
const digestOf=(key:string):string=>/^[a-f0-9]{64}$/i.test(key)?key.toLowerCase():commandDigest(key)
export class RunDurations {
 private rows:Record<string,Record<string,number[]>>=Object.create(null)
 // True when a key an older version stored as text was hashed, so the caller stores the cleaned history.
 restore(value:unknown):boolean {let hashed=false;this.rows=Object.create(null);for(const [folder,commands]of Object.entries(object(value)).slice(-64)){const row:Record<string,number[]>=Object.create(null);for(const [key,raw]of Object.entries(object(commands)).slice(-16))if(Array.isArray(raw)){const digest=digestOf(key);if(digest!==key)hashed=true;row[digest]=[...(row[digest]??[]),...raw.filter((x):x is number=>typeof x==='number'&&Number.isFinite(x)&&x>=0)].slice(-8)}this.rows[folder]=row}return hashed}
 add(folder:string,command:string,duration:number):void {if(!Number.isFinite(duration)||duration<0)return;const row=this.rows[folder]??=Object.create(null);const key=commandDigest(command);row[key]=[...(row[key]??[]),duration].slice(-8);const keys=Object.keys(row);for(const old of keys.slice(0,Math.max(0,keys.length-16)))delete row[old];const folders=Object.keys(this.rows);for(const old of folders.slice(0,Math.max(0,folders.length-64)))delete this.rows[old]}
 median(folder:string,command:string):number|undefined {const values=this.rows[folder]?.[commandDigest(command)];if(!values||values.length<3)return;const sorted=[...values].sort((a,b)=>a-b),m=Math.floor(sorted.length/2);return sorted.length%2?sorted[m]:(sorted[m-1]!+sorted[m]!)/2}
 snapshot():Record<string,Record<string,number[]>> {return JSON.parse(JSON.stringify(this.rows))}
}
function cronField(field:string,value:number,min:number,max:number):boolean {return field.split(',').some(part=>{const [span,stepText]=part.split('/'),step=stepText===undefined?1:Number(stepText);if(!Number.isInteger(step)||step<=0)return false;const [loText,hiText]=span==='*'?[String(min),String(max)]:span!.split('-'),lo=Number(loText),hi=hiText===undefined?lo:Number(hiText);return lo>=min&&hi<=max&&value>=lo&&value<=hi&&(value-lo)%step===0})}
export function nextCron(schedule:string,now:number):number|undefined {
 const fields=schedule.trim().split(/\s+/);if(fields.length!==5||!Number.isFinite(now))return
 const mins=Array.from({length:60},(_,n)=>n).filter(n=>cronField(fields[0]!,n,0,59)),hours=Array.from({length:24},(_,n)=>n).filter(n=>cronField(fields[1]!,n,0,23))
 if(!mins.length||!hours.length)return
 const origin=new Date(now);origin.setHours(0,0,0,0)
 for(let i=0;i<=366;i++){
  const day=new Date(origin);day.setDate(origin.getDate()+i)
  const dom=cronField(fields[2]!,day.getDate(),1,31),dow=cronField(fields[4]!,day.getDay(),0,7)||(day.getDay()===0&&cronField(fields[4]!,7,0,7))
  if(!(fields[2]==='*'?dow:fields[4]==='*'?dom:dom||dow)||!cronField(fields[3]!,day.getMonth()+1,1,12))continue
  for(const hour of hours)for(const minute of mins){const at=new Date(day);at.setHours(hour,minute,0,0);if(at.getHours()===hour&&at.getMinutes()===minute&&at.getTime()>now)return at.getTime()}
 }
 return
}
export class AlwaysState {
 readonly helpers=new Map<string,HelperRow>()
 readonly tasks=new Map<string,string>()
 readonly worktrees=new Map<string,string>()
 readonly added=new Set<string>()
 model='';repo='';summary=0;wake?:{at:number;what:string};background=0
 rebuildHelpers(rows:readonly HelperRow[]):void {this.helpers.clear();for(const row of rows)this.helpers.set(row.id,{...row})}
 helperStart(id:string,description:string):void {this.helpers.set(id,{id,description,status:'running'})}
 helperStop(id:string,result?:string):void {const row=this.helpers.get(id)??{id,description:id,status:'completed'};row.status='completed';row.result=(result??'').split(/\r?\n/)[0]?.slice(0,80);this.helpers.set(id,row);while(this.helpers.size>64)this.helpers.delete(this.helpers.keys().next().value!)}
 task(id:string,subject?:string):string|undefined {if(subject===undefined)this.tasks.delete(id);else this.tasks.set(id,subject);return this.tasks.values().next().value}
 crons(rows:readonly CronRow[],now:number):void {this.wake=rows.map(r=>({at:nextCron(r.schedule,now),what:r.prompt.slice(0,80)})).filter((r):r is {at:number;what:string}=>r.at!==undefined).sort((a,b)=>a.at-b.at)[0]}
 clear():void {this.helpers.clear();this.tasks.clear();this.summary=0;this.wake=undefined;this.background=0}
}
export function ownedLogPrune(rows:readonly {path:string;size:number;at:number}[],folder:string):string[] {const clean=(p:string)=>p.replace(/\\/g,'/'),prefix=clean(folder).replace(/\/+$/,'')+'/',safe=rows.filter(r=>Number.isFinite(r.size)&&r.size>=0&&Number.isFinite(r.at)&&clean(r.path).startsWith(prefix)&&!clean(r.path).slice(prefix.length).includes('/')&&!clean(r.path).split('/').includes('..')).sort((a,b)=>b.at-a.at);let bytes=0;return safe.filter((row,i)=>{bytes+=row.size;return i>=40||bytes>20*1024*1024}).map(r=>r.path)}

// A25: only the size of a compaction summary is kept, never its text.
// A25: the summary's size only. Han, kana and Hangul count one each; other text counts by words.
const WIDE=/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/g
export function wordCount(text:unknown):number {return typeof text==='string'?(text.match(WIDE)?.length??0)+text.replace(WIDE,' ').trim().split(/\s+/).filter(Boolean).length:0}
