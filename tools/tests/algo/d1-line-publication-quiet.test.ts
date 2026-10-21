import {test,expect} from 'bun:test'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {existsSync} from 'node:fs'
import {LineSlot} from '../../../plugin/hooks/line-slot'

// Actual production ACK, push and publish functions. State writes are genuine
// Promise boundaries in both SDKs; ui.toast's void contract is not involved.
const source=readFileSync(process.env.D1_PUBLICATION_REGISTER_SOURCE??(existsSync(resolve(import.meta.dir,'../../../plugin/hooks-source/register.tsx'))?resolve(import.meta.dir,'../../../plugin/hooks-source/register.tsx'):resolve(import.meta.dir,'../../../plugin/hooks/register.tsx')),'utf8')
function section(first:string,next:string):string {
 const start=source.indexOf(first),end=source.indexOf(next,start+first.length)
 if(start<0||end<0||source.indexOf(first,start+first.length)>=0)throw new Error('Production quiet publication function boundary changed')
 return source.slice(start,end)
}
const functions=[section('function projectLine(', 'function offerLine('),section('function acknowledgeC3(', 'function c3FrameDeadline('),section('async function publish(', 'async function pushCompanion(')].join('\n')
const javascript=new Bun.Transpiler({loader:'ts'}).transformSync(functions)
function fixture() {
 const slot=new LineSlot();slot.offer({id:'displayed-line',key:'ambient',text:'fixture text',class:0},0)
 const local:any={band:'on',line:{...slot.visible(0)!}}
 const side={redraw:0,pictures:0,diagnostics:0,stateCalls:0,companions:[] as string[]}
 const animation=new Set(['retained-animation']),latest:any={view:undefined}
 let stored:any,barrier:Promise<void>=Promise.resolve(),release:()=>void=()=>{},deferred:(()=>Promise<void>)|undefined,deadline=14000
 const api={state:{set:async(_ref:unknown,value:any)=>{side.stateCalls++;const capture=JSON.parse(JSON.stringify(value));await barrier;stored=capture;return {isSet:true,version:side.stateCalls}}}}
 const factory=new Function('lineSlot','view','after','expireLines','latest','animationRedraws','redraw','queueDesktopPictures','diagnose','caught','d1Sync','taskNow','present','presenceRecord','companionKey','checkDiagnostics','pushCompanion','background',`
 const syncM1Actions=()=>undefined,scheduleAfter=after,c3Surface='terminal',gapLimits={visible(){},current(){return undefined},out(){return []},burned(){return []}};
 let clockSnapshot=10000,lifecycleGeneration=1,c3={view:()=>({})},timers={},c3ShownPending,timeZone='UTC';
 let publicationGeneration=0,publishPending=0,statePublishFailed=false,publishedVersion=0,lastBand='on',d1DesktopShedTimelines=new Map(),companionLive=true;
 const VIEW={},c3Visible=()=>view.band!=='off',localDay=()=> '2026-10-07';
 ${javascript}
 return {ack:($,tree)=>acknowledgeC3($,view,tree),push:($)=>push($),invalidate:()=>lifecycleGeneration++,now:at=>clockSnapshot=at};
 `)
 const owner=factory(slot,local,(_$:unknown,delay:number,callback:()=>Promise<void>)=>{expect(delay).toBe(0);deferred=callback;return {}},(_$:unknown,at:number)=>{deadline=slot.deadline(at)!},latest,animation,()=>side.redraw++,()=>side.pictures++,()=>side.diagnostics++,()=>{},()=>{},()=>{},(value:any)=>({...value}),()=>({fixture:true}),(value:any)=>JSON.stringify(value),async()=>{},async(_$:unknown,captured:string)=>{side.companions.push(captured)},(_$:unknown,_name:string,pending:Promise<unknown>)=>pending)
 return {slot,local,owner,api,side,animation,latest,stored:()=>stored,deadline:()=>deadline,
  ack:()=>owner.ack(api,{}),
  run:async()=>{expect(deferred).toBeDefined();const run=deferred!;deferred=undefined;await run()},
  block:()=>{barrier=new Promise<void>(resolve=>release=resolve)},release:()=>release()}
}

test('D1 ACK publishes its renewed deadline without redraw, picture queue or animation reset',async()=>{
 const f=fixture();f.ack();await f.run()
 expect(f.stored().line.expiresAt).toBe(24000);expect(f.deadline()).toBe(24000);expect(f.side.stateCalls).toBe(1)
 expect(f.side.redraw).toBe(0);expect(f.side.pictures).toBe(0);expect([...f.animation]).toEqual(['retained-animation']);expect(f.side.diagnostics).toBe(0)
})

test('D1 quiet ACK still awaits the actual host write and preserves its pre-await companion record',async()=>{
 const f=fixture();f.block();f.ack();let finished=false
 const pending=f.run().then(()=>{finished=true})
 try{await Bun.sleep(0);expect(finished).toBe(false);expect(f.side.stateCalls).toBe(1);expect(f.stored()).toBeUndefined();expect(f.side.redraw).toBe(0);f.local.line.text='later independent projection'}finally{f.release();await pending}
 expect(f.stored().line.text).toBe('fixture text');expect(f.stored().line.expiresAt).toBe(24000)
 expect(f.side.companions.length).toBe(1);expect(JSON.parse(f.side.companions[0]!).line.text).toBe('fixture text')
})

test('D1 ordinary push retains its existing redraw, picture and animation-reset defaults',async()=>{
 const quiet=fixture();quiet.ack();await quiet.run();expect(quiet.side.redraw).toBe(0)
 const f=fixture();await f.owner.push(f.api)
 expect(f.side.stateCalls).toBe(1);expect(f.side.redraw).toBe(1);expect(f.side.pictures).toBe(1);expect([...f.animation]).toEqual([]);expect(f.side.diagnostics).toBe(1)
})
