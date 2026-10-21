// Event-owned C3 state. Heavy immutable algorithms execute in an asynchronous local worker.
import {bookmarkText,sha256} from './c3-secrets'
import {durationText, numberText, numberLocale} from './numbers'
import {c3Durations, c3Word, loadC3Words} from './c3-words'
import type {LineValue} from './line-slot'
import {displaySlot} from './c3-secrets'
import {untrustedDisplaySlot,capDisplaySlot} from './display-slots'
export type C3Settings={guard:boolean;bookmark:boolean;notes:boolean;budget:'off'|50|80|90;neighbours:boolean}
export type C3LineRequest={id?:string;key:string;text:string;class:0|1|2|3;slots?:LineValue[];once?:boolean;ttl?:number;untilPrompt?:boolean;untilTurn?:boolean;callId?:string;waitForId?:string;valid?:()=>boolean;onShown?:()=>void;button?:{key:string,label:string}}
export type C3Reaction={kind:'error'|'green'|'green_after_reds'|'bookmark'|'thanks'|'neighbour';reds?:number}
export type C3Capabilities={
 get:(key:string)=>Promise<unknown>;set:(key:string,value:unknown)=>Promise<void>;remove:(key:string)=>Promise<void>
 process:(argv:string[],options?:{cwd?:string;stdin?:string;timeoutMs?:number})=>Promise<{exitCode:number;stdout:string;stderr:string;isStdoutTruncated?:boolean}>
 now:()=>number;lang:()=>string;settings:()=>C3Settings;localDay:(at:number)=>string;windowName:(kind:string)=>string
 emit:(line:C3LineRequest)=>'shown'|'queued'|'dropped';reaction:(value:C3Reaction)=>void;notice?:(id:string,text?:string)=>void
 readWords?:()=>Promise<string>;workerPath?:string;executeAlgo?:(request:Record<string,unknown>)=>Promise<any>
 diagnostic?:(code:string)=>void;changed?:()=>void
}
type Bookmark={where:string;kind:'todo'|'file';at:number;i?:number;n?:number}
type Occasions={warned:Record<string,true>;shedFirst?:true;twoFirst?:true}
type Window={kind:string;percentUsed:number;resetsAt?:number}
type Reading=Window&{at:number}
type PaceHistory={fresh:number;lastAt?:number;lastSwitch?:number;currentReset?:number}
type PaceState={hot:Record<string,true>;history?:Record<string,PaceHistory>}
type Run={kind:'test'|'build';tool:string;key:string}
type Sample={ms:number;outcome:'pass'|'fail'|'unknown'}
type GuardHit={kind:string;reason:string;target?:string;branch?:string}
type ToolState={id:string;name:string;at:number;executionMs?:number;main:boolean;bookmarkEpoch:number;run?:Run;guard?:GuardHit;secret?:{file:string;line:number};commit:boolean;asking:boolean;resolved:boolean;file?:string;todo?:string|null}
export type C3Neighbour={id:string;label:string;busy:boolean;partial:boolean;startedAt?:number}
export type C3Neighbours={v:1;running:boolean;agents:C3Neighbour[]}
const fill=(template:string,slots:Record<string,string>)=>template.replace(/\{(\w+)\}/g,(hole,key:string)=>slots[key]??hole)
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)
function bookmarksFrom(value:unknown):Record<string,Bookmark>{
 const result:Record<string,Bookmark>=Object.create(null)
 for(const [cwd,raw]of Object.entries(object(value))){const b=object(raw);if(typeof b.where==='string'&&(b.kind==='todo'||b.kind==='file')&&finite(b.at))result[cwd]={where:bookmarkText(b.where),kind:b.kind,at:b.at,...(b.kind==='todo'&&Number.isInteger(b.i)&&Number.isInteger(b.n)&&(b.n as number)>=2&&(b.n as number)<=999&&(b.i as number)>=1&&(b.i as number)<=(b.n as number)?{i:b.i as number,n:b.n as number}:{})}}
 const keys=Object.keys(result).sort((a,b)=>result[b]!.at-result[a]!.at);for(const key of keys.slice(64))delete result[key]
 return result
}
function occasionsFrom(value:unknown):Occasions{
 const v=object(value),warned:Record<string,true>=Object.create(null)
 for(const [key,yes]of Object.entries(object(v.warned)))if(yes===true)warned[key]=true
 return {warned,...(v.shedFirst===true?{shedFirst:true}:{}),...(v.twoFirst===true?{twoFirst:true}:{})}
}
function historyFrom(value:unknown):Record<string,Sample[]>{
 const result:Record<string,Sample[]>=Object.create(null)
 for(const [key,list]of Object.entries(object(value))){if(!Array.isArray(list))continue;const digest=/^[a-f0-9]{64}$/i.test(key)?key.toLowerCase():sha256(key),samples=list.filter((s:any)=>s&&finite(s.ms)&&s.ms>=1000&&['pass','fail','unknown'].includes(s.outcome)).map((s:any)=>({ms:s.ms,outcome:s.outcome}));result[digest]=[...(result[digest]??[]),...samples].slice(-9)}
 for(const key of Object.keys(result).slice(0,-60))delete result[key]
 return result
}
function paceStateFrom(value:unknown):PaceState{
 const input=object(value),hot:Record<string,true>=Object.create(null)
 for(const [key,yes]of Object.entries(object(input.hot)))if(yes===true)hot[key]=true
 if(input.history===undefined)return {hot}
 const history:Record<string,PaceHistory>=Object.create(null)
 for(const [kind,raw]of Object.entries(object(input.history))){
  const old=object(raw),record:PaceHistory={fresh:finite(old.fresh)&&old.fresh>=0?Math.floor(old.fresh):0}
  if(finite(old.lastAt))record.lastAt=old.lastAt
  if(finite(old.lastSwitch)&&old.lastSwitch>=0&&old.lastSwitch<=record.fresh)record.lastSwitch=old.lastSwitch
  if(finite(old.currentReset))record.currentReset=old.currentReset
  history[kind]=record
 }
 return {hot,history}
}
function relativeFile(path:string,cwd:string):string|undefined{
 const windows=/^[A-Za-z]:[\\/]|^[\\/]{2}/.test(cwd),separator=windows?'\\':'/'
 const normal=(value:string)=>windows?value.replace(/\\/g,'/'):value
 const target=normal(path),base=normal(cwd)
 const root=(value:string)=>windows?/^(?:[A-Za-z]:|\/\/[^/]+\/[^/]+)(?=\/|$)/.exec(value)?.[0]:value.startsWith('/')?'/':undefined
 const targetRoot=root(target),baseRoot=root(base)
 const parts=(value:string,absolute:boolean)=>{
  const result:string[]=[]
  for(const part of value.split('/'))if(part&&part!=='.'){if(part==='..'&&result.length&&result[result.length-1]!=='..')result.pop();else if(part!=='..'||!absolute)result.push(part)}
  return result
 }
 if(targetRoot===undefined){
  if(windows&&/^[A-Za-z]:|^\//.test(target))return undefined
  return parts(target,false).join(separator)||'.'
 }
 if(baseRoot===undefined||(windows?targetRoot.toLowerCase()!==baseRoot.toLowerCase():targetRoot!==baseRoot))return undefined
 const from=parts(base.slice(baseRoot.length),true),to=parts(target.slice(targetRoot.length),true)
 let common=0
 while(common<from.length&&common<to.length&&(windows?from[common]!.toLowerCase()===to[common]!.toLowerCase():from[common]===to[common]))common++
 return [...from.slice(common).map(()=>'..'),...to.slice(common)].join(separator)||'.'
}
function guardKey(hit:GuardHit):string{
 if(hit.reason==='shred')return 'guard.shred'
 if(hit.reason==='push-delete')return 'guard.pushDelete'
 if(hit.reason==='mirror-push')return 'guard.mirror'
 if(hit.reason==='truncate'||hit.reason==='delete-all-rows')return hit.target?'guard.dropRows':'guard.dropRowsAny'
 if(hit.reason==='flush-store')return 'guard.flush'
 if(hit.reason==='reflog-expire')return 'guard.reflog'
 if(hit.reason==='terraform-destroy'||hit.reason==='pulumi-destroy')return 'guard.destroy'
 if(hit.reason==='kubectl-delete')return 'guard.kubectl'
 if(hit.reason==='docker-volumes')return 'guard.volumes'
 if(hit.reason==='bucket-delete')return 'guard.bucket'
 return 'guard.'+hit.kind
}
export { scanStagedSecrets } from './c3-secrets'
export function isThanks(text:string):boolean{
 const short=text.trim();if(short.length>80||[...short].length>40)return false
 return /\b(?:thanks|thank you|thx|danke|gracias|merci|grazie|obrigad[oa]|makasih|terima kasih|good job|great job|well done|nice work|bravo|gut gemacht|ben fatto|buen trabajo|bien hecho|bom trabalho|kerja bagus)\b|谢谢|謝謝|辛苦了|ありがとう|有難う|고마워|감사합니다|감사해|धन्यवाद|शुक्रिया|बहुत बढ़िया|真棒|太棒了|すごい|さすが|잘했어|잘했네/i.test(short)
}

export function createC3Runtime(cap:C3Capabilities){
 let cwd='',home='',tmpdir:string|undefined,branch:string|undefined,firstStart=true,promptOrdinal=0,sessionEpoch=0
 let notesEpoch=0,bookmarkEpoch=0,guardEpoch=0,budgetEpoch=0
 let bookmarks:Record<string,Bookmark>=Object.create(null),occasions:Occasions={warned:{}},history:Record<string,Sample[]>|undefined
 let ready:Promise<void>|undefined,serial:Promise<void>=Promise.resolve(),historySerial:Promise<void>=Promise.resolve(),measureSerial:Promise<void>=Promise.resolve(),worker:string|undefined
 let lastRunOutcome:'pass'|'fail'|'unknown'='unknown',recoveredReds=0
 let failedTests=0,fixedTests=0,ranTests=0,lastTest:'pass'|'fail'|undefined // this session's test runs that failed, the runs that went green after them, every test run with a verdict and the last one's (the itabag's vibe check)
 // the vibe check page's rows (step 2): the session's first failing test by name, the times three runs in a row went
 // red, and the last build that did not fail with its usual time where the notes keep a history
 let firstFail:string|undefined,storms=0,lastBuild:{ms:number;usualMs?:number;slow:boolean}|undefined
 let todo:string|null=null,todoAt:{i:number;n:number}|null=null,file:string|undefined,reds=0,lastRunGreen=false,commitGreen=false,chapterSaid=false,chapterOffered=false
 let currentWindows:Window[]=[],readings:Reading[]=[],hotState:PaceState={hot:{}},pace:{kind:string;exhaustionAt:number}[]=[],rates:Record<string,number>={},previous:Record<string,{percent:number;reset?:number}>=Object.create(null)
 const verdicts=new Map<string,{outcome:'pass'|'fail'|'unknown';kind:'test'|'build';failed?:number}>()
 const commits=new Set<string>()
 const tools=new Map<string,ToolState>(),pendingOnce=new Set<string>(),busySince=new Map<string,number>(),doneAt=new Map<string,number>()
 function write(key:string,value:unknown,privacyMigration=false):void{const own=sessionEpoch;serial=serial.catch(()=>{}).then(async()=>{if(own===sessionEpoch&&!(key==='bookmarks'&&!cap.settings().bookmark)&&!((key==='runs'||key==='paceState')&&!cap.settings().notes&&!privacyMigration))await cap.set(key,value)}).catch(()=>{cap.diagnostic?.('c3.store.write')})}
 function remove(key:string):Promise<void>{const clearing=serial.catch(()=>{}).then(()=>cap.remove(key));serial=clearing.catch(()=>{cap.diagnostic?.('c3.store.remove')});return clearing}
 function rememberOccasion(key:string):void{if(occasions.warned[key])return;occasions={...occasions,warned:{...occasions.warned,[key]:true}};write('occasions',occasions)}
 async function words():Promise<void>{if(cap.readWords)await loadC3Words(cap.readWords)}
 async function ensure():Promise<void>{
  if(!ready)ready=Promise.all([cap.get('bookmarks'),cap.get('occasions'),cap.get('paceState'),cap.get('runs')]).then(async([b,o,p,r])=>{bookmarks=bookmarksFrom(b);occasions=occasionsFrom(o);hotState=paceStateFrom(p);history=historyFrom(r);if(r!==undefined&&JSON.stringify(r)!==JSON.stringify(history))write('runs',history,true);if(b!==undefined&&JSON.stringify(b)!==JSON.stringify(bookmarks)&&cap.settings().bookmark)write('bookmarks',bookmarks);await flush()})
  await ready
 }
 async function algorithm(request:Record<string,unknown>):Promise<any>{
  if(cap.executeAlgo)return cap.executeAlgo(request)
  if(!cap.workerPath){cap.diagnostic?.('c3.algorithm.unavailable');return undefined}
  // Stdin carries data. Argv and diagnostics carry no command or prompt bytes.
  const stdin=JSON.stringify(request),interpreters=worker?[worker]:['node','bun']
  for(const interpreter of interpreters){try{
   const answer=await cap.process([interpreter,cap.workerPath],{stdin,timeoutMs:30000})
   if(answer.exitCode!==0||answer.isStdoutTruncated)continue
   const envelope=JSON.parse(answer.stdout);if(envelope?.ok!==true)continue
   worker=interpreter;return envelope.result
  }catch{}}
  cap.diagnostic?.('c3.algorithm.unavailable');return undefined
 }
 function line(key:string,level:0|1|2|3,slots:Record<string,string>={},options:Partial<C3LineRequest>={},variant=0):C3LineRequest{
  // The approved budget words contain the unit. Replace that unit with Intl's
  // complete percentage so the digits, separator and sign share one bold slot.
  slots=Object.fromEntries(Object.entries(slots).map(([key,value])=>[key,displaySlot(value)]))
  const template=c3Word(cap.lang(),key,variant),text=key==='budget'?template.replace(/\{p\}\s*%/g,'{p}'):template
  slots=Object.fromEntries(Object.entries(slots).map(([name,value])=>[name,['target','file','name','where','branch'].includes(name)?untrustedDisplaySlot(value):capDisplaySlot(value)]))
  const result:C3LineRequest={key,text:fill(text,slots),class:level,slots:Object.entries(slots).map(([name,value])=>({value,kind:name==='window'||name==='agent'?'label':name==='target'||name==='file'||name==='branch'?'path':name==='name'?'test':name==='where'?(bookmarks[cwd]?.kind==='todo'?'todo':'path'):'value'})),...options}
  cap.emit(result);return result
 }
 function once(key:string,reason:string,level:0|1|2,slots:Record<string,string>,valid:()=>boolean,options:Partial<C3LineRequest>={}):void{
  if(occasions.warned[reason])return
  line(key,level,slots,{id:reason,once:true,valid:()=>{const alive=valid();if(!alive)pendingOnce.delete(reason);return alive},onShown:()=>{pendingOnce.delete(reason);if(valid())rememberOccasion(reason)},...options})
 }
 async function settingsChanged():Promise<void>{
  await ensure();const settings=cap.settings()
  const clearing:Promise<void>[]=[]
  if(!settings.bookmark){bookmarkEpoch++;bookmarks=Object.create(null);todo=null;todoAt=null;file=undefined;clearing.push(remove('bookmarks'))}
  if(!settings.notes){notesEpoch++;history=undefined;reds=0;chapterOffered=false;lastRunGreen=false;commitGreen=false;pace=[];readings=[];hotState={hot:{}};clearing.push(remove('runs'),remove('paceState'))}
  if(!settings.guard){guardEpoch++;for(const tool of tools.values()){tool.guard=undefined;tool.secret=undefined;cap.notice?.(tool.id,undefined)}}
  if(settings.budget==='off'){budgetEpoch++;previous=Object.create(null)}
  if(!settings.neighbours){busySince.clear();doneAt.clear()}
  const warned={...occasions.warned};let changed=false
  for(const key of Object.keys(warned))if((!settings.notes&&key.endsWith(':pace'))||(settings.budget==='off'&&key.includes(':budget:'))){delete warned[key];pendingOnce.delete(key);changed=true}
  if(changed){occasions={...occasions,warned};write('occasions',occasions)}
  cap.changed?.();await Promise.all(clearing);await flush()
 }
 async function start(input:{cwd:string;turns:number;home?:string;tmpdir?:string;branch?:string}):Promise<void>{
  cwd=input.cwd;home=input.home??'';tmpdir=input.tmpdir;branch=input.branch;await ensure();await words()
  const settings=cap.settings(),initial=firstStart;firstStart=false
  if(!settings.bookmark||!settings.notes)await settingsChanged()
  const bookmark=bookmarks[cwd]
  if(initial&&input.turns===0&&settings.bookmark&&bookmark){
   const ordinal=promptOrdinal,task=bookmark.kind==='todo'&&bookmark.i!==undefined&&bookmark.n!==undefined;line(task?'bookmark.task':'bookmark',0,{where:bookmark.where,...(task?{i:String(bookmark.i),n:String(bookmark.n)}:{})},{once:true,ttl:300000,untilPrompt:true,valid:()=>cap.settings().bookmark&&promptOrdinal===ordinal,onShown:()=>cap.reaction({kind:'bookmark'})})
  }
 }
 async function prompt(input:{text:string}):Promise<void>{
  promptOrdinal++;lastRunGreen=false;commitGreen=false;chapterOffered=false;lastRunOutcome='unknown';recoveredReds=0;cap.changed?.()
  if(isThanks(input.text))cap.reaction({kind:'thanks'})
 }
 function chapterPressed():void{chapterOffered=false;cap.changed?.()}
 async function toolStart(input:{id:string;name:string;input:Record<string,unknown>;main?:boolean;cwd?:string;branch?:string;at?:number}):Promise<void>{
  if(input.main===false)return
  const state:ToolState={id:input.id,name:input.name,at:input.at??cap.now(),main:true,bookmarkEpoch,commit:false,asking:false,resolved:false};tools.set(input.id,state)
  const settings=cap.settings(),values=input.input,guardOwn=guardEpoch,own=sessionEpoch
  if(settings.bookmark){
   if(input.name==='TodoWrite'){const list=Array.isArray(values.todos)?values.todos:[];const next=list.find((item:any)=>item?.status==='in_progress'&&typeof item.content==='string') as any;state.todo=next?.content??null;todo=state.todo??null;const done=list.filter((item:any)=>item?.status==='completed').length;todoAt=todo&&list.length>=2?{i:Math.min(done+1,list.length),n:list.length}:null}
   if(['Edit','Write','MultiEdit','NotebookEdit'].includes(input.name)){const path=typeof values.file_path==='string'?values.file_path:typeof values.notebook_path==='string'?values.notebook_path:undefined;if(path)state.file=relativeFile(path,cwd)}
  }
  if(input.name!=='Bash'||typeof values.command!=='string')return
  const command=values.command
  const [guardResult,run]=await Promise.all([
   algorithm({op:'guard',command,context:{cwd:input.cwd??cwd,home,tmpdir,branch:input.branch??branch}}),
   algorithm({op:'recognize',command}),
  ])
  if(own!==sessionEpoch||tools.get(input.id)!==state||state.resolved)return
  state.run=run??undefined;state.guard=settings.guard&&cap.settings().guard&&guardOwn===guardEpoch?guardResult?.hit:undefined;state.commit=typeof guardResult?.commitCwd==='string'
  if(settings.guard&&cap.settings().guard&&guardOwn===guardEpoch&&state.commit){
   try{const staged=await cap.process(['/usr/bin/git','--no-pager','--no-lazy-fetch','-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null','-c','core.pager=cat','-c','diff.external=','diff','--cached','--no-ext-diff','--no-textconv','--ignore-submodules=all','--unified=0'],{cwd:guardResult.commitCwd,timeoutMs:10000});if(own===sessionEpoch&&guardOwn===guardEpoch&&staged.exitCode===0&&!staged.isStdoutTruncated&&cap.settings().guard){const secret=await algorithm({op:'secrets',diff:staged.stdout});if(own===sessionEpoch&&guardOwn===guardEpoch&&cap.settings().guard)state.secret=secret}}catch{cap.diagnostic?.('c3.secret.scan')}
  }
 }
 async function permission(id:string,verdict:'ask'|'resolved',notice=false):Promise<void>{
  const state=tools.get(id);if(!state)return
  state.asking=verdict==='ask';if(verdict==='resolved'){cap.notice?.(id,undefined);return}
  if(!cap.settings().guard||(!state.guard&&!state.secret))return
  const own=sessionEpoch,guardOwn=guardEpoch;await words();if(own!==sessionEpoch||guardOwn!==guardEpoch||!cap.settings().guard||!state.asking||state.resolved)return;const key=state.guard?guardKey(state.guard):'guard.secret'
  const slots:Record<string,string>=state.guard?{...(state.guard.target?{target:state.guard.target}:{}),...(state.guard.branch?{branch:state.guard.branch}:{})}:state.secret?{file:state.secret.file,line:numberText(state.secret.line,cap.lang(),false,true)}:{}
  for(const name of ['target','branch','file'])if(slots[name]!==undefined)slots[name]=untrustedDisplaySlot(slots[name]!)
  const text=fill(c3Word(cap.lang(),key),slots)
  if(notice)cap.notice?.(id,text)
  line(key,3,slots,{callId:id,ttl:0,untilTurn:true,valid:()=>cap.settings().guard&&state.asking&&!state.resolved})
 }
 async function toolResult(input:{id:string;output:string;exitCode:number|null;denied?:boolean;interrupted?:boolean;at?:number}):Promise<void>{
  const state=tools.get(input.id);if(!state)return
  const own=sessionEpoch,notesOwn=notesEpoch,guardOwn=guardEpoch
  state.resolved=true;cap.notice?.(input.id,undefined);const now=input.at??cap.now(),passed=input.exitCode===0&&!input.denied
  if(passed&&cap.settings().bookmark&&state.bookmarkEpoch===bookmarkEpoch&&state.file)file=state.file
  if(state.commit&&passed&&!input.interrupted){commitGreen=true;commits.add(input.id);while(commits.size>256)commits.delete(commits.values().next().value!)}
  if(state.secret&&passed&&!state.asking&&cap.settings().guard){const secret=state.secret;await words();if(own!==sessionEpoch)return;if(guardOwn===guardEpoch&&cap.settings().guard){const ordinal=promptOrdinal;line('guard.secretAfter',3,{file:secret.file,line:numberText(secret.line,cap.lang(),false,true)},{ttl:0,untilPrompt:true,valid:()=>guardOwn===guardEpoch&&cap.settings().guard&&promptOrdinal===ordinal});cap.reaction({kind:'error'})}}
  tools.delete(input.id)
  if(!state.run||input.denied||input.interrupted)return
  const operation=historySerial.catch(()=>{}).then(async()=>{
   if(own!==sessionEpoch)return
   const settings=cap.settings(),ms=state.executionMs??Math.max(0,now-state.at)
   if(settings.notes&&!history){const stored=await cap.get('runs');if(own!==sessionEpoch)return;if(notesOwn===notesEpoch&&cap.settings().notes)history=historyFrom(stored)}
   const result=await algorithm({op:'finish',tool:state.run!.tool,key:sha256(state.run!.key),output:input.output,exitCode:input.exitCode,ms,history:settings.notes?history??{}:{}})
   if(own!==sessionEpoch||!result?.parsed)return
   const parsed=result.parsed,oldReds=reds;lastRunOutcome=parsed.outcome;if(state.run!.kind==='test'&&parsed.outcome!=='unknown'){ranTests++;lastTest=parsed.outcome}verdicts.set(input.id,{outcome:parsed.outcome,kind:state.run!.kind,...(Number.isInteger(parsed.failed)?{failed:parsed.failed}:{})});while(verdicts.size>256)verdicts.delete(verdicts.keys().next().value!)
   if(parsed.outcome==='fail'){reds++;if(reds===3)storms++;if(state.run!.kind==='test'){failedTests++;if(firstFail===undefined&&parsed.firstFailing)firstFail=parsed.firstFailing}lastRunGreen=false;if(settings.notes&&notesOwn===notesEpoch&&cap.settings().notes&&parsed.firstFailing){await words();if(own!==sessionEpoch)return;if(notesOwn===notesEpoch&&cap.settings().notes){line('first_down',1,{name:parsed.firstFailing},{valid:()=>notesOwn===notesEpoch&&cap.settings().notes});cap.reaction({kind:'error'})}}}
   if(parsed.outcome==='pass'){
    lastRunGreen=state.run!.kind==='test';reds=0
    if(oldReds>0){if(state.run!.kind==='test')fixedTests++;recoveredReds=oldReds;const big=oldReds>=3;cap.reaction({kind:big?'green_after_reds':'green',reds:oldReds});if(settings.notes&&notesOwn===notesEpoch&&cap.settings().notes){await words();if(own!==sessionEpoch)return;if(notesOwn===notesEpoch&&cap.settings().notes)line(big?'green_after_reds':'green',1,big?{n:numberText(oldReds,cap.lang(),false,true)}:{},{valid:()=>notesOwn===notesEpoch&&cap.settings().notes},oldReds% (big?2:3))}}
   }
   if(state.run!.kind==='build'&&parsed.outcome!=='fail'){const usual=result.slowness?.usualMs;lastBuild={ms,...(finite(usual)?{usualMs:usual}:{}),slow:!!result.slowness?.slow&&finite(usual)}}
   if(settings.notes&&notesOwn===notesEpoch&&cap.settings().notes&&ms>=1000){
    history=historyFrom(result.history);write('runs',history)
    if(state.run!.kind==='build'&&parsed.outcome!=='fail'&&!(parsed.outcome==='pass'&&oldReds>0)&&result.slowness?.slow&&finite(result.slowness.usualMs)){await words();if(own!==sessionEpoch)return;if(notesOwn===notesEpoch&&cap.settings().notes)line('slow_build',1,{now:durationText(ms/1000,cap.lang(),c3Durations(cap.lang())),usual:durationText(result.slowness.usualMs/1000,cap.lang(),c3Durations(cap.lang()))},{valid:()=>notesOwn===notesEpoch&&cap.settings().notes})}
   }
  });historySerial=operation;await operation
 }
 async function turnComplete(input:{main:boolean;reason:string;contextPercent:number|null}):Promise<void>{
  if(!input.main)return
  const own=sessionEpoch,bookmarkOwn=bookmarkEpoch,notesOwn=notesEpoch
  await historySerial;await ensure();if(own!==sessionEpoch)return
  for(const state of tools.values())state.asking=false
  if(bookmarkOwn===bookmarkEpoch&&cap.settings().bookmark&&(todo||file)){
   const next={where:bookmarkText(todo??file!),kind:todo?'todo' as const:'file' as const,at:cap.now(),...(todo&&todoAt?todoAt:{})};bookmarks=bookmarksFrom({...bookmarks,[cwd]:next});write('bookmarks',bookmarks)
  }
  if(notesOwn===notesEpoch&&cap.settings().notes&&input.reason==='answer'&&finite(input.contextPercent)&&input.contextPercent>=75&&(lastRunGreen||commitGreen)&&!chapterSaid&&!chapterOffered){
   const ordinal=promptOrdinal;chapterOffered=true;await words();if(own!==sessionEpoch||notesOwn!==notesEpoch||!cap.settings().notes)return;line('chapter',2,{}, {once:true,ttl:60000,untilPrompt:true,valid:()=>notesOwn===notesEpoch&&cap.settings().notes&&chapterOffered&&promptOrdinal===ordinal,onShown:()=>{chapterSaid=true},button:{key:'coco:chapter:compact',label:c3Word(cap.lang(),'chapter.button')}})
  }
  cap.changed?.();await flush()
 }
 function measure(windows:readonly Window[],at=cap.now()):Promise<void>{
  const snapshot=windows.map(window=>({...window})),own=sessionEpoch,notesOwn=notesEpoch,budgetOwn=budgetEpoch
  const operation=measureSerial.catch(()=>{}).then(async()=>{if(own===sessionEpoch)await measureNow(snapshot,at,own,notesOwn,budgetOwn)})
  measureSerial=operation;return operation
 }
 async function measureNow(windows:readonly Window[],at:number,own:number,notesOwn:number,budgetOwn:number):Promise<void>{
  await ensure();if(own!==sessionEpoch)return;currentWindows=windows.filter(w=>finite(w.percentUsed)).map(w=>({...w}));const settings=cap.settings()
  if(settings.notes&&notesOwn===notesEpoch){
   readings.push(...currentWindows.map(w=>({...w,at})));readings=readings.filter(r=>r.at>=at-5_400_000)
   const result=await algorithm({op:'pace',readings,now:at,previous:hotState})
   if(own!==sessionEpoch)return
   if(cap.settings().notes&&notesOwn===notesEpoch){
    if(Array.isArray(result?.projections))rates=Object.fromEntries(result.projections.filter((p:any)=>typeof p?.kind==='string'&&finite(p.ratePerHour)&&p.ratePerHour>0).slice(0,4).map((p:any)=>[p.kind,p.ratePerHour]))
    if(result?.hot){hotState=paceStateFrom(result.hot.state);write('paceState',hotState);pace=result.projections.filter((p:any)=>result.hot.hot.includes(p.kind)&&finite(p.runsOutAt)&&finite(p.resetsAt)).map((p:any)=>({kind:p.kind,exhaustionAt:p.runsOutAt}))}
    for(const p of pace){const w=currentWindows.find(w=>w.kind===p.kind);if(!w||!finite(w.resetsAt))continue;const period=p.kind+':'+w.resetsAt;await words();if(own!==sessionEpoch||notesOwn!==notesEpoch)return;once('pace',period+':pace',1,{window:cap.windowName(p.kind),t:durationText(Math.max(1,(p.exhaustionAt-at)/1000),cap.lang(),c3Durations(cap.lang()),true)},()=>own===sessionEpoch&&notesOwn===notesEpoch&&cap.settings().notes&&pace.some(x=>x.kind===p.kind)&&currentWindows.some(x=>x.kind===p.kind&&x.resetsAt===w.resetsAt))}
   }
  }else{pace=[];rates={};readings=[];hotState={hot:{}}}
  const budget=cap.settings().budget
  if(budget!=='off'&&budgetOwn===budgetEpoch){
   let firstCrossed:string|undefined
   for(const w of currentWindows.slice().sort((a,b)=>a.kind==='five_hour'?-1:b.kind==='five_hour'?1:0)){
    const prev=previous[w.kind],same=prev?.reset===w.resetsAt,key=w.kind+':'+w.resetsAt+':budget:'+budget
    if(same&&prev&&prev.percent<budget&&w.percentUsed>=budget){await words();if(own!==sessionEpoch||budgetOwn!==budgetEpoch||cap.settings().budget!==budget)return;once('budget',key,1,{window:cap.windowName(w.kind),p:new Intl.NumberFormat(numberLocale(cap.lang()),{style:'percent',maximumFractionDigits:0}).format(w.percentUsed/100)},()=>own===sessionEpoch&&budgetOwn===budgetEpoch&&cap.settings().budget===budget&&currentWindows.some(x=>x.kind===w.kind&&x.resetsAt===w.resetsAt&&x.percentUsed>=budget),{waitForId:firstCrossed});firstCrossed??=key}
    previous[w.kind]={percent:w.percentUsed,reset:w.resetsAt}
   }
  }
  // Keep only the live window periods; historical occasions are not a log.
  const periods=currentWindows.map(w=>w.kind+':'+w.resetsAt+':'),warned:Record<string,true>={};for(const [key,value]of Object.entries(occasions.warned))if(periods.some(prefix=>key.startsWith(prefix)))warned[key]=value
  if(Object.keys(warned).length!==Object.keys(occasions.warned).length){occasions={...occasions,warned};write('occasions',occasions)}
  cap.changed?.()
 }
 async function neighbours(payload:C3Neighbours|undefined,companionRunning:boolean):Promise<void>{
  if(!cap.settings().neighbours||!companionRunning||!payload?.running){busySince.clear();return}
  const now=cap.now(),live=new Set<string>()
  for(const agent of payload.agents){
   live.add(agent.id);const busy=agent.busy&&!agent.partial,old=busySince.get(agent.id)
   if(busy){if(old===undefined)busySince.set(agent.id,finite(agent.startedAt)?agent.startedAt:now)}
   else if(old!==undefined){busySince.delete(agent.id);if(now-old>=30000&&now-(doneAt.get(agent.id)??-Infinity)>=120000){const made=now;await words();line('neighbour.done',0,{agent:untrustedDisplaySlot(agent.label)},{once:true,valid:()=>cap.settings().neighbours&&now<=made+60000&&cap.now()<=made+60000&&!busySince.has(agent.id),onShown:()=>{doneAt.set(agent.id,cap.now());cap.reaction({kind:'neighbour'})}})}}
  }
  for(const id of busySince.keys())if(!live.has(id))busySince.delete(id)
 }

 async function task(subject?:string):Promise<void>{todo=subject??null;if(!cap.settings().bookmark)return;await ensure();if(todo)bookmarks[cwd]={where:todo,kind:'todo',at:cap.now()};else if(bookmarks[cwd]?.kind==='todo'){if(file)bookmarks[cwd]={where:file,kind:'file',at:cap.now()};else delete bookmarks[cwd]}bookmarks=bookmarksFrom(bookmarks);write('bookmarks',bookmarks);await flush();cap.changed?.()}
 function executionDuration(id:string,ms:number):void{const state=tools.get(id);if(state&&Number.isFinite(ms)&&ms>=0)state.executionMs=ms}
 function isRecognized(id:string):boolean{return tools.get(id)?.run!==undefined}
 function runVerdict(id:string):'pass'|'fail'|'unknown'|undefined{return verdicts.get(id)?.outcome}
 function runKind(id:string):'test'|'build'|undefined{return verdicts.get(id)?.kind}
 /** How many tests failed in that run, when the runner said. */
 function runFailed(id:string):number|undefined{return verdicts.get(id)?.failed}
 function committed(id:string):boolean{return commits.has(id)}
 function turnStart():void{lastRunOutcome='unknown';recoveredReds=0;lastRunGreen=false;commitGreen=false}
 function view(){return {lastRunOutcome,recoveredReds,pace:cap.settings().notes?pace.slice():[],rates:cap.settings().notes?{...rates}:{},bookmark:cap.settings().bookmark?bookmarks[cwd]:undefined,tests:{failed:failedTests,fixed:fixedTests,ran:ranTests,storms,...(firstFail?{firstFail}:{}),...(lastBuild?{build:{...lastBuild}}:{}),...(lastTest?{last:lastTest}:{})}}}
 async function flush():Promise<void>{await serial}
 function reset():void{sessionEpoch++;promptOrdinal++;failedTests=0;fixedTests=0;ranTests=0;lastTest=undefined;firstFail=undefined;storms=0;lastBuild=undefined;todo=null;todoAt=null;file=undefined;reds=0;lastRunGreen=false;commitGreen=false;chapterSaid=false;chapterOffered=false;tools.clear();verdicts.clear();commits.clear();pendingOnce.clear();busySince.clear();doneAt.clear();readings=[];pace=[];hotState={hot:{}};previous=Object.create(null)}
 function onceSaid(key:'shedFirst'|'twoFirst'):boolean{return occasions[key]===true}
 function markOnce(key:'shedFirst'|'twoFirst'):void{if(occasions[key])return;occasions={...occasions,[key]:true};write('occasions',occasions)}
 function recognized(id:string):Run|undefined{return tools.get(id)?.run}
  return {executionDuration,isRecognized,task,runKind,runFailed,runVerdict,committed,start,prompt,turnStart,toolStart,permission,toolResult,turnComplete,measure,settingsChanged,chapterPressed,neighbours,view,bookSnapshot:view,flush,reset,onceSaid,markOnce,recognized}
}
export type C3Runtime=ReturnType<typeof createC3Runtime>
