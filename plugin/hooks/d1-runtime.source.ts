// Session memory only. No reads, writes or clocks are hidden in this state machine.
export type Helper = {agentId:string;description:string;type:string;parentAgentId?:string;startedAt:number;endedAt?:number;toolUses:number;tokens:number;state:'running'|'done'|'failed'|'stopped';engineTotals?:{tokens?:number;durationMs?:number;toolUses?:number};arrivalAt?:number;leavingAt?:number}
export type OverflowHelper = Pick<Helper,'agentId'|'parentAgentId'|'startedAt'|'arrivalAt'|'state'|'endedAt'|'leavingAt'>
export type D1Snapshot = {helpers:Helper[];overflowHelpers?:OverflowHelper[];earlier:{count:number;tokens:number};totalTokens:number;mainHelpers:number;runningHelpers:number;shed?:{id:string;phase:'begin'|'end'|'skip';at:number};longTask?:{id:string;startedAt:number;completedAt:number;durationMs:number}}
const count=(n:unknown):number=>typeof n==='number'&&Number.isFinite(n)&&n>=0?n:0
export function usageTokens(value:unknown):number{
 if(!value||typeof value!=='object')return 0
 const u=value as Record<string,unknown>
 return count(u.input_tokens??u.inputTokens)+count(u.output_tokens??u.outputTokens)+count(u.cache_read_input_tokens??u.cacheReadInputTokens)+count(u.cache_creation_input_tokens??u.cacheCreationInputTokens)
}
export class D1Runtime {
 private helpers=new Map<string,Helper>()
 private overflow=new Map<string,OverflowHelper&{tokens:number;engineTokens?:number}>()
 private earlier={count:0,tokens:0}
 private mainTokens=0
 private steps=new Map<string,number>()
 private turn?:{id:string;at:number;complete:boolean;eligible:boolean;waiting:boolean;quietAt?:number}
 private shed?:D1Snapshot['shed']
 private longTask?:D1Snapshot['longTask']
 private batchAt=-Infinity
 private batchCount=0
 snapshot():D1Snapshot{
  const helpers=[...this.helpers.values()].map(h=>({...h,...(h.engineTotals?{engineTotals:{...h.engineTotals}}:{})}))
  const overflowHelpers=[...this.overflow.values()].map(({tokens:_tokens,engineTokens:_engineTokens,...h})=>({...h}))
  return {helpers,...(overflowHelpers.length?{overflowHelpers}:{}),earlier:{...this.earlier},totalTokens:this.mainTokens+helpers.reduce((n,h)=>n+(h.engineTotals?.tokens??h.tokens),this.earlier.tokens),mainHelpers:helpers.filter(h=>!h.parentAgentId&&h.state==='running').length+overflowHelpers.filter(h=>!h.parentAgentId&&h.state==='running').length,runningHelpers:helpers.filter(h=>h.state==='running').length+overflowHelpers.filter(h=>h.state==='running').length,...(this.shed?{shed:{...this.shed}}:{}),...(this.longTask?{longTask:{...this.longTask}}:{})}
 }
 startTurn(id:string,at:number):void{this.turn={id,at,complete:false,eligible:true,waiting:false};this.longTask=undefined}
 spawn(id:string,description:string,type:string,at:number,parent?:string):void{
  if(!id||this.helpers.has(id)||this.overflow.has(id))return
  if(at-this.batchAt>150){this.batchAt=at;this.batchCount=0}
  const arrivalAt=this.batchAt+900+260*(parent?0:this.batchCount++)
  this.helpers.set(id,{agentId:id,description:description.slice(0,2000),type:type.slice(0,128),...(parent?{parentAgentId:parent}:{}),startedAt:at,toolUses:0,tokens:0,state:'running',arrivalAt})
  this.cap()
 }
 private cap():void{
  while(this.helpers.size>64){const old=this.helpers.values().next().value;if(!old)break;this.helpers.delete(old.agentId);this.earlier.count++;this.earlier.tokens+=old.engineTotals?.tokens??old.tokens;if(old.state==='running'||old.leavingAt!==undefined)this.overflow.set(old.agentId,{agentId:old.agentId,parentAgentId:old.parentAgentId,startedAt:old.startedAt,arrivalAt:old.arrivalAt,state:old.state,endedAt:old.endedAt,leavingAt:old.leavingAt,tokens:old.tokens,...(old.engineTotals?.tokens===undefined?{}:{engineTokens:old.engineTotals.tokens})})}
 }
 tool(id:string):void{const h=this.helpers.get(id);if(h?.state==='running')h.toolUses++}
 isRunning(id:string):boolean{return this.helpers.get(id)?.state==='running'||this.overflow.get(id)?.state==='running'}
 usage(id:string|undefined,usage:unknown):void{const n=usageTokens(usage);if(id===undefined)this.mainTokens+=n;else {const h=this.helpers.get(id);if(h)h.tokens+=n;else {const old=this.overflow.get(id);if(old){old.tokens+=n;if(old.engineTokens===undefined)this.earlier.tokens+=n}}}}
 stepUsage(id:string|undefined,turnId:string,usage:unknown):void{this.usage(id,usage);const key=JSON.stringify([id??null,turnId]);this.steps.set(key,(this.steps.get(key)??0)+usageTokens(usage))}
 turnUsage(id:string|undefined,turnId:string,usage:unknown):void{const key=JSON.stringify([id??null,turnId]),steps=this.steps.get(key)??0;this.steps.delete(key);if(!usage||typeof usage!=='object')return;const delta=usageTokens(usage)-steps;if(id===undefined)this.mainTokens=Math.max(0,this.mainTokens+delta);else {const h=this.helpers.get(id);if(h)h.tokens=Math.max(0,h.tokens+delta);else {const old=this.overflow.get(id);if(old){const before=old.tokens;old.tokens=Math.max(0,old.tokens+delta);if(old.engineTokens===undefined)this.earlier.tokens=Math.max(0,this.earlier.tokens+old.tokens-before)}}}}
 finish(id:string,at:number,state:Helper['state']='done',totals?:Helper['engineTotals']):void{
  const h=this.helpers.get(id);if(!h){const old=this.overflow.get(id);if(old){if(totals?.tokens!==undefined){const previous=old.engineTokens??old.tokens;old.engineTokens=count(totals.tokens);this.earlier.tokens+=old.engineTokens-previous}if(old.state==='running'){old.state=state;old.endedAt=at;old.leavingAt=at}this.quiet(at)}return}
  if(totals){const safe:NonNullable<Helper['engineTotals']>={};for(const key of ['tokens','durationMs','toolUses'] as const)if(totals[key]!==undefined)safe[key]=count(totals[key]);h.engineTotals={...h.engineTotals,...safe}}
  if(h.state==='running'){h.state=state;h.endedAt=at;h.leavingAt=at}
  this.quiet(at)
 }
 private quiet(at:number):D1Snapshot['longTask']{
  const t=this.turn;if(!t?.complete||!t.eligible||t.waiting||t.quietAt!==undefined||[...this.overflow.values()].some(h=>h.state==='running')||[...this.helpers.values()].some(h=>h.state==='running')||this.longTask)return this.longTask
  t.quietAt=at
  if(at-t.at>=120000)this.longTask={id:t.id,startedAt:t.at,completedAt:at,durationMs:at-t.at}
  return this.longTask
 }
 complete(at:number,reason:string):D1Snapshot['longTask']{if(!this.turn)return;this.turn.complete=true;this.turn.eligible=reason==='answer'||reason==='refusal';return this.quiet(at)}
 waiting(value:boolean):void{if(this.turn)this.turn.waiting=value}
 compact(id:string,phase:'begin'|'end'|'skip',at:number):void{this.shed={id,phase,at}}
 removeLeaving(at:number):void{for(const h of this.helpers.values())if(h.leavingAt!==undefined&&at-h.leavingAt>=240)delete h.leavingAt;for(const [id,h]of this.overflow)if(h.state!=='running'&&h.leavingAt!==undefined&&at-h.leavingAt>=240)this.overflow.delete(id)}
 dismissLong():void{this.longTask=undefined;this.turn=undefined}
 clear():void{this.helpers.clear();this.overflow.clear();this.steps.clear();this.earlier={count:0,tokens:0};this.mainTokens=0;this.turn=undefined;this.shed=undefined;this.longTask=undefined;this.batchAt=-Infinity;this.batchCount=0}
}
