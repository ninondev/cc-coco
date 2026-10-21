// Event-owned zero-token helpers for MOD-GAPS 1-11. No clock, network, model, or prompt IO.
import type { LineRequest, VisibleLine } from './line-slot'
import { gapFill, gapPool, gapWord } from './mod-gaps-words'
import { durationText, momentText } from './numbers'

export type GapStore = {get:(key:string)=>Promise<unknown>;set:(key:string,value:unknown)=>Promise<unknown>}
export type GapClosing = {line:string;lang:string;key:string}
export type CloseChoice = {voice:string;marks:string;band:string;surface:string;affection:string}
export type CloseCounter = {at:number;day:string;n:number}
const boundedSet=<T>(map:Map<string,T>,id:string,value:T,cap:number)=>{map.set(id,value);while(map.size>cap)map.delete(map.keys().next().value!)}
const record=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)
export function closeCounter(value:unknown):CloseCounter|undefined {const r=record(value);return finite(r.at)&&typeof r.day==='string'&&finite(r.n)&&r.n>=0?{at:r.at,day:r.day,n:r.n}:undefined}
export function closeAllowed(value:unknown,at:number,day:string):boolean {const old=closeCounter(value);return !old||at-old.at>=1200000&&(old.day!==day||old.n<6)}
export function nextCloseCounter(value:unknown,at:number,day:string):CloseCounter {const old=closeCounter(value);return {at,day,n:old?.day===day?old.n+1:1}}
export function voiceDecision(recordValue:unknown,legacy:unknown):{voice:'off'|'light'|'full';voiceChosen:boolean;askAgain:boolean} {
 const r=record(recordValue),voice=r.voice
 if(r.voiceChosen===true&&(voice==='off'||voice==='light'||voice==='full'))return {voice,voiceChosen:true,askAgain:false}
 if(legacy==='off'||legacy==='light'||legacy==='full')return {voice:legacy,voiceChosen:true,askAgain:false}
 return {voice:'off',voiceChosen:false,askAgain:voice==='light'}
}
export function detectScreenReader(env:unknown,settings:{axScreenReader?:unknown}):boolean {return env==='1'||env!=='0'&&settings.axScreenReader===true}
export function textBandMode(surface:string,band:string,sr:boolean):boolean {return surface==='terminal'&&(sr||band==='text')}
export function screenReaderLine(line:Pick<VisibleLine,'key'|'class'>|undefined):boolean {return !!line&&(line.class>=1||line.key==='bookmark'||line.key==='first.hello'||line.key.startsWith('close.'))}

export class ModGapsRuntime {
 readonly closings=new Map<string,GapClosing>()
 readonly runVerdicts=new Map<string,'pass'|'fail'>()
 private started=0
 private ran=false
 private changed=false
 private recognized=false
 private commit=false
 private spoken=false
 private main=false
 private last?:{uuid:string;kind:'text'|'tool'|'other';text:string}
 private suggested=false
 private red=new Set<string>()
 epoch=0
 startTurn(at:number,agentId?:string):void {if(agentId!==undefined)return;this.epoch++;this.started=at;this.ran=false;this.changed=false;this.recognized=false;this.commit=false;this.spoken=false;this.last=undefined;this.main=true}
 append(uuid:string,message:{type:string;content?:readonly {type:string;text?:string}[]},agentId?:string):void {
  if(agentId!==undefined||!this.main)return
  const content=message.content??[],text=content.filter(b=>b.type==='text').map(b=>b.text??'').join('').trim()
  this.last={uuid,kind:message.type==='assistant'&&content.some(b=>b.type==='tool_use')?'tool':message.type==='assistant'&&text?'text':'other',text}
 }
 toolRan(input:{id:string;name:string;command?:string;key?:string;committed?:boolean;denied?:boolean;interrupted?:boolean;exitCode?:number;recognized?:boolean;outcome?:'pass'|'fail'|'unknown';agentId?:string}):void {
  if(input.agentId!==undefined||input.denied||input.interrupted)return
  this.ran=true
  if(['Edit','MultiEdit','Write','NotebookEdit'].includes(input.name))this.changed=true
  if(input.recognized)this.recognized=true
  if(input.name==='Bash'&&input.exitCode===0&&input.committed===true)this.commit=true
  // MOD-GAPS: the flower marks only the run that turns red to green.
  const run=input.key??input.command??input.id
  if(input.recognized&&input.outcome==='fail'){this.red.delete(run);this.red.add(run);if(this.red.size>64)this.red.delete(this.red.values().next().value!)}
  else if(input.recognized&&input.outcome==='pass'&&this.red.delete(run))boundedSet(this.runVerdicts,input.id,'pass',256)
 }
 lineShown(level:number):void {if(this.main&&level>=1)this.spoken=true}
 closeCandidate(reason:string,at:number,choice:CloseChoice):boolean {return this.main&&reason==='answer'&&this.ran&&(at-this.started>=30000||this.changed||this.recognized||this.commit)&&this.last?.kind==='text'&&!/[?？]$/.test(this.last.text)&&!this.spoken&&choice.voice==='off'&&(choice.surface==='terminal'?choice.band!=='off':choice.marks!=='off')}
 async close(input:{reason:string;at:number;day:string;hour:number;lang:string;choice:CloseChoice;store:GapStore;pick:(key:string,list:readonly string[])=>string|undefined;claim?:()=>Promise<boolean>;mirror?:(id:string,value:GapClosing)=>Promise<unknown>}):Promise<{id:string;closing:GapClosing;request:LineRequest}|undefined> {
  if(!this.closeCandidate(input.reason,input.at,input.choice))return
  const epoch=this.epoch,last=this.last!,previous=await input.store.get('close')
  if(epoch!==this.epoch||!closeAllowed(previous,input.at,input.day))return
  // Two pools: late night (23:00 to 05:00) and ordinary.
  const pool=input.hour>=23||input.hour<5?'late':'work'
  const key='close.'+pool,line=input.pick(input.lang+':'+key,gapPool(input.lang,key))
  if(!line)return
  const closing={line,lang:input.lang,key}
  if(input.claim){let claimed=false;try{claimed=await input.claim()}catch{return}if(!claimed||epoch!==this.epoch)return}
  await input.store.set('close',nextCloseCounter(previous,input.at,input.day))
  if(epoch!==this.epoch)return
  const saved=new Map(this.closings)
  boundedSet(saved,last.uuid,closing,64)
  await input.store.set('closings',[...saved].map(([id,value])=>[id,{...value}]))
  if(epoch!==this.epoch)return
  boundedSet(this.closings,last.uuid,closing,64)
  if(input.mirror)await input.mirror(last.uuid,closing)
  if(epoch!==this.epoch)return
  return {id:last.uuid,closing,request:{key,text:line,class:0,ttl:14000}}
 }
 snapshotClosings():[string,GapClosing][] {return [...this.closings].map(([id,value])=>[id,{...value}])}
 restoreClosings(value:unknown):void {
  this.closings.clear()
  if(!Array.isArray(value))return
  for(const entry of value.slice(-64))if(Array.isArray(entry)&&entry.length===2&&typeof entry[0]==='string'&&entry[0].length>0)this.restoreClosing(entry[0],entry[1])
 }
 restoreClosing(id:string,value:unknown):GapClosing|undefined {const r=record(value);if(typeof r.line==='string'&&typeof r.lang==='string'&&typeof r.key==='string'&&r.key.startsWith('close.')){const closing={line:r.line,lang:r.lang,key:r.key};boundedSet(this.closings,id,closing,64);return closing}return this.closings.get(id)}
 bookmarkSuggestion(input:{initial:boolean;turns:number;on:boolean;promptSuggestionEnabled?:boolean;bookmark?:{at:number;where:string;kind:'todo'|'file'};now:number;lang:string}):string|undefined {
  if(this.suggested||!input.initial||input.turns!==0||!input.on||input.promptSuggestionEnabled===false||!input.bookmark||input.now-input.bookmark.at>604800000||input.bookmark.at>input.now)return
  this.suggested=true
  return gapFill(input.lang,'bookmark.suggest.'+input.bookmark.kind,{where:input.bookmark.where})
 }
 reset():void {this.epoch++;this.main=false;this.last=undefined;this.suggested=false;this.closings.clear();this.runVerdicts.clear();this.red.clear()}
}

export type GapWindow={kind:string;percentUsed:number;resetsAt?:number}
export type GapLimit={request:LineRequest;frame:'tea-a'|'waiting';out?:string;resetsAt?:number;at:number;epoch:number}
export class GapLimits {
 epoch=0
 private stop?:GapLimit
 private ashes=new Map<string,{below:boolean;line:boolean;resetsAt:number}>()
 startTurn():void {this.epoch++;if(this.stop?.out){const ash=this.ashes.get(this.stop.out);if(ash)ash.line=false}this.trim();this.stop=undefined}
 private trim():void {for(const [kind,value]of this.ashes)if(value.below&&!value.line)this.ashes.delete(kind)}
 read(windows:readonly GapWindow[]):void {for(const [kind,value]of this.ashes){const w=windows.find(w=>w.kind===kind);if(w&&w.percentUsed<100)value.below=true}this.trim()}
 visible(lineKey:string|undefined):void {for(const [kind,value] of this.ashes)value.line=lineKey==='limit.out'&&kind===this.stop?.out;this.trim()}
 out():readonly string[] {return [...this.ashes.keys()]}
 burned():readonly {kind:string;resetsAt:number}[] {return [...this.ashes].map(([kind,value])=>({kind,resetsAt:value.resetsAt}))}
 failure(error:string,agentId:string|undefined,windows:readonly GapWindow[],at:number,lang:string,windowName:(kind:string)=>string,timeZone?:string):GapLimit|undefined {
  if(agentId!==undefined||error!=='rate_limit'&&error!=='overloaded')return
  if(this.stop?.out){const old=this.ashes.get(this.stop.out);if(old)old.line=false}
  const window=error==='rate_limit'?windows.find(w=>w.percentUsed>=100&&finite(w.resetsAt)):undefined
  const epoch=this.epoch,key=error==='overloaded'?'limit.crowded':window?'limit.out':'limit.wait',time=window?momentText(window.resetsAt,at,lang,timeZone):'',name=window?windowName(window.kind):''
  const request:LineRequest={key,class:1,text:gapFill(lang,key,{time,window:name}),ttl:key==='limit.out'?Math.min(window!.resetsAt!-at,18000000):key==='limit.wait'?3600000:120000,untilPrompt:true,valid:()=>this.epoch===epoch,...(window?{slots:[{value:time,kind:'value' as const},{value:name,kind:'label' as const}]}:{})}
  this.stop={request,frame:error==='overloaded'?'waiting':'tea-a',...(window?{out:window.kind,resetsAt:window.resetsAt}:{}),at,epoch}
  if(window)this.ashes.set(window.kind,{below:false,line:true,resetsAt:window.resetsAt!});this.trim()
  return this.stop
 }
 current(at:number):GapLimit|undefined {return this.stop&&this.stop.epoch===this.epoch&&at<this.stop.at+(this.stop.request.ttl??0)?this.stop:undefined}
 display(at:number,lang:string,windowName:(kind:string)=>string,timeZone?:string):GapLimit|undefined {
  const held=this.current(at);if(!held)return
  const time=held.out?momentText(held.resetsAt,at,lang,timeZone):'',name=held.out?windowName(held.out):''
  const text=held.out?gapFill(lang,'limit.out',{time,window:name}):gapWord(lang,held.request.key)
  return {...held,request:{...held.request,text,...(held.out?{slots:[{value:time,kind:'value' as const},{value:name,kind:'label' as const}]}:{})}}
 }
 recent(at:number):GapLimit|undefined {return this.stop&&at-this.stop.at>=0&&at-this.stop.at<=5000&&this.stop.epoch===this.epoch?this.stop:undefined}
}

export type WaitSoundConfig={on:boolean;macOS:boolean;screenReader:boolean;preferredNotifChannel?:unknown}
export type WaitSoundPort=GapStore&{surfaces:()=>Promise<readonly string[]>;play:()=>Promise<unknown>;claim?:()=>Promise<boolean>}
const waitingNotice=new Set(['permission_prompt','elicitation_dialog','elicitation_url_dialog','agent_needs_input'])
export class WaitSound {
 private waits=new Set<string>()
 private rang=false
 private generation=0
 private pending?:Promise<boolean>
 ask(id:string):void {if(this.waits.size===0){this.rang=false;this.generation++;this.pending=undefined}this.waits.add(id)}
 settled(id:string):void {this.waits.delete(id);if(this.waits.size===0){this.rang=false;this.generation++;this.pending=undefined}}
 end():void {this.waits.clear();this.rang=false;this.generation++;this.pending=undefined}
 notify(config:WaitSoundConfig,notice:string,at:number,port:WaitSoundPort):Promise<boolean> {
  // Off has no settings/store/surfaces/audio work. No timer exists in this class.
  if(!config.on)return Promise.resolve(false)
  if(notice==='elicitation_complete'||notice==='elicitation_response'){this.end();return Promise.resolve(false)}
  if(!waitingNotice.has(notice)||!config.macOS||config.screenReader||config.preferredNotifChannel==='terminal_bell'||config.preferredNotifChannel==='iterm2_with_bell'||this.rang)return Promise.resolve(false)
  if(this.waits.size===0){if(notice==='permission_prompt')return Promise.resolve(false);this.ask('notice')}
  if(this.pending)return this.pending
  const generation=this.generation
  const task=(async()=>{const surfaces=await port.surfaces();if(generation!==this.generation||!surfaces.some(s=>s==='terminal'||s==='desktop'||s==='vscode'))return false;const previous=await port.get('waitSoundAt');if(generation!==this.generation||finite(previous)&&at-previous<30000)return false;if(port.claim){try{if(!await port.claim())return false}catch{return false}}if(generation!==this.generation)return false;this.rang=true;await port.set('waitSoundAt',at);if(generation!==this.generation)return false;await port.play();return true})()
  this.pending=task
  void task.finally(()=>{if(this.pending===task)this.pending=undefined}).catch(()=>{})
  return task
 }
}

export function hintTail(input:{surface:string;band:string;sessions:number;keysUsed:boolean;isDraft:boolean;isWorking:boolean;lang:string}):string|undefined {return input.surface==='terminal'&&input.band!=='off'&&input.sessions>=1&&input.sessions<=3&&!input.keysUsed&&!input.isDraft&&!input.isWorking?', '+gapFill(input.lang,'hint.tail',{}):undefined}
export function personBandFocus(e:{component:string;plugin?:string;element?:string;origin:{kind:string}},result:{deny?:string},used:boolean):boolean {return !used&&e.component==='AbovePrompt'&&e.plugin==='coco'&&e.element!==undefined&&e.origin.kind==='person'&&result.deny===undefined}
export async function focusBook(isPlaced:boolean,page:string,focus:(key:string)=>Promise<unknown>):Promise<void> {if(isPlaced)try{await focus('coco:book:tab:'+page)}catch{}}
export async function compactChapter(compact:()=>Promise<unknown>,fill:(text:string)=>Promise<unknown>):Promise<void> {try{await compact()}catch{try{await fill('/compact')}catch{}}}
