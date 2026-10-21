import {test,expect} from 'bun:test'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {existsSync} from 'node:fs'
import {LineSlot} from '../../../plugin/hooks/line-slot'

// Execute the actual production functions. Host publication is an injected
// boundary here; the unchanged engine second-window cases cover that boundary.
const source=readFileSync(process.env.D1_PUBLICATION_REGISTER_SOURCE??(existsSync(resolve(import.meta.dir,'../../../plugin/hooks-source/register.tsx'))?resolve(import.meta.dir,'../../../plugin/hooks-source/register.tsx'):resolve(import.meta.dir,'../../../plugin/hooks/register.tsx')),'utf8')
function section(first:string,next:string):string {
 const start=source.indexOf(first),end=source.indexOf(next,start+first.length)
 if(start<0||end<0||source.indexOf(first,start+first.length)>=0)throw new Error('Production publication function boundary changed')
 return source.slice(start,end)
}
const functions=[section('function projectLine(', 'function offerLine('),section('function acknowledgeC3(', 'function c3FrameDeadline(')].join('\n')
const javascript=new Bun.Transpiler({loader:'ts'}).transformSync(functions)
function fixture({ttl,once=false,onShown}: {ttl?:number;once?:boolean;onShown?:()=>void}={}) {
 const slot=new LineSlot()
 slot.offer({id:'displayed-line',key:'ambient',text:'fixture text',class:0,ttl,once,onShown},0)
 const initial=slot.visible(0)!
 const local:any={band:'on',line:{...initial}}
 let stored:any={...local,line:{...initial}},publicationCalls=0,deadline=initial.expiresAt,deferred:(()=>Promise<void>)|undefined
 let complete:()=>void=()=>{},barrier:Promise<void>=Promise.resolve()
 const factory=new Function('lineSlot','view','after','expireLines','push',`
 const scheduleAfter=after,c3Surface='terminal',gapLimits={visible(){},current(){return undefined},out(){return []},burned(){return []}};
 let clockSnapshot=10000,lifecycleGeneration=1,c3={},timers={},c3ShownPending,timeZone='UTC';
 const c3Visible=()=>view.band!=='off',localDay=()=> '2026-10-07';
 ${javascript}
 return {project:()=>projectLine({}),ack:()=>acknowledgeC3({},view,{}),invalidate:()=>lifecycleGeneration++,now:at=>clockSnapshot=at};
 `)
 const owner=factory(slot,local,(_$:unknown,delay:number,callback:()=>Promise<void>)=>{expect(delay).toBe(0);deferred=callback;return {}},(_$:unknown,at:number)=>{deadline=slot.deadline(at)!},async()=>{publicationCalls++;await barrier;stored={...local,line:local.line?{...local.line}:undefined}})
 return {slot,local,owner,stored:()=>stored,calls:()=>publicationCalls,deadline:()=>deadline,
  run:async()=>{expect(deferred).toBeDefined();const run=deferred!;deferred=undefined;await run()},
  block:()=>{barrier=new Promise<void>(r=>complete=r)},release:()=>complete()}
}

test('D1 first display at10s publishes the same14s line deadline to host state',async()=>{
 const f=fixture();f.owner.ack()
 expect(f.stored().line.expiresAt).toBe(14000)
 await f.run()
 expect(f.slot.visible(10000)?.expiresAt).toBe(24000)
 expect(f.local.line.expiresAt).toBe(24000)
 expect(f.deadline()).toBe(24000)
 expect(f.stored().line.expiresAt).toBe(24000)
 expect(f.calls()).toBe(1)
 expect(f.stored().line.id).toBe('displayed-line')
 expect(f.stored().line.text).toBe('fixture text')
 expect(f.slot.visible(23999)?.id).toBe('displayed-line')
 expect(f.slot.visible(24000)).toBeUndefined()
})

test('D1 display acknowledgment awaits host publication before completing',async()=>{
 const f=fixture();f.block();f.owner.ack();let finished=false
 const pending=f.run().then(()=>{finished=true})
 try {
  // Drain the full async callback chain while the injected host write remains
  // blocked. Two microtasks can still precede an unawaited callback completion.
  await Bun.sleep(0)
  expect(f.calls()).toBe(1);expect(finished).toBe(false)
  expect(f.stored().line.expiresAt).toBe(14000)
 } finally { f.release();await pending }
 expect(finished).toBe(true);expect(f.stored().line.expiresAt).toBe(24000)
})

test('D1 duplicate display acknowledgment does not refresh its published deadline',async()=>{
 const f=fixture();f.owner.ack();await f.run();f.owner.now(11000);f.owner.ack()
 expect(f.calls()).toBe(1);expect(f.stored().line.expiresAt).toBe(24000)
 expect(f.slot.visible(11000)?.expiresAt).toBe(24000)
})

test('D1 explicit14s lifetime remains14s when first display is delayed',async()=>{
 const accepted=fixture();accepted.owner.ack();await accepted.run()
 expect(accepted.stored().line.expiresAt).toBe(24000);expect(accepted.calls()).toBe(1)
 const f=fixture({ttl:14000});f.owner.ack();await f.run()
 expect(f.stored().line.expiresAt).toBe(14000)
 expect(f.slot.visible(13999)?.id).toBe('displayed-line')
 expect(f.slot.visible(14000)).toBeUndefined()
})

test('D1 acknowledgment keeps once-ever callbacks deferred and deduplicated',async()=>{
 let said=0;const f=fixture({once:true,onShown:()=>said++});f.owner.ack();f.owner.ack()
 expect(said).toBe(0);await f.run();expect(said).toBe(1)
 f.owner.ack();expect(said).toBe(1);expect(f.calls()).toBe(1)
})

test('D1 stale lifecycle display acknowledgment cannot publish a replacement owner',async()=>{
 const accepted=fixture();accepted.owner.ack();await accepted.run()
 expect(accepted.stored().line.expiresAt).toBe(24000);expect(accepted.calls()).toBe(1)
 const f=fixture();f.owner.ack();f.owner.invalidate();await f.run()
 expect(f.calls()).toBe(0);expect(f.stored().line.expiresAt).toBe(14000)
 expect(f.slot.needsShown('displayed-line')).toBe(true)
})

test('D1 hidden band display acknowledgment does not consume or publish the line',async()=>{
 const accepted=fixture();accepted.owner.ack();await accepted.run()
 expect(accepted.stored().line.expiresAt).toBe(24000);expect(accepted.calls()).toBe(1)
 const f=fixture();f.owner.ack();f.local.band='off';await f.run()
 expect(f.calls()).toBe(0);expect(f.stored().line.expiresAt).toBe(14000)
 expect(f.slot.needsShown('displayed-line')).toBe(true)
})


test('D1 same-clock first display acknowledges the line without republishing unchanged metadata',async()=>{
 const f=fixture();f.owner.now(0);f.owner.project();expect(f.slot.needsShown('displayed-line')).toBe(true)
 f.owner.ack();await f.run()
 expect(f.slot.needsShown('displayed-line')).toBe(false);expect(f.calls()).toBe(0)
 expect(f.stored().line.expiresAt).toBe(14000);expect(f.deadline()).toBe(14000)
})

test('D1 fixed-lifetime display runs and deduplicates its once callback without an unchanged host write',async()=>{
 let shown=0;const f=fixture({ttl:14000,once:true,onShown:()=>shown++});f.owner.project()
 f.owner.ack();expect(shown).toBe(0);await f.run();expect(shown).toBe(1)
 expect(f.calls()).toBe(0);expect(f.stored().line.expiresAt).toBe(14000)
 f.owner.ack();expect(shown).toBe(1);expect(f.calls()).toBe(0)
})
