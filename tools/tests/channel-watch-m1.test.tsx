import { expect, test } from 'claude-code/testing'
import { CompanionChannel } from '../hooks/channel'
const F='/tmp/m1-watch',P=F+'/requests.jsonl',S='session',T=10000
const drain=async()=>{for(let i=0;i<80;i++)await Promise.resolve()}
function fixture(folder=F,initial=''){
 let text=initial,now=T,reads=0,spawns=0,listens=0,actions:string[]=[],authority:string[]=[],errors:unknown[]=[]
 const timers=new Map<number,{ms:number;fn:()=>void}>();let timerId=0
 const io={authorize:async()=>{authority.push('authorize');return true},exists:async(_path:string)=>true,read:async()=>{reads++;return text},ensureRequests:async()=>{},append:async(_p:string,value:string)=>{text+=value},after:(ms:number,fn:()=>void)=>{expect([0,1500]).toContain(ms);const id=++timerId;timers.set(id,{ms,fn});return()=>{timers.delete(id)}},now:async()=>now,spawn:()=>{spawns++;return {next:()=>new Promise(()=>{}),return:async()=>({done:true,value:{code:null,signal:null}})}as never},submit:async()=>{authority.push('submit')},clear:async()=>{authority.push('clear')},listen:undefined as any,canFollow:undefined as undefined|(()=>boolean)}
 const c=new CompanionChannel(io,S,folder,{note:note=>{actions.push(note.text)},running:()=>{},seen:()=>{},ack:async()=>{},changed:async()=>{},error:e=>errors.push(e)})
 return {c,io,errors,timers,actions,authority,reads:()=>reads,spawns:()=>spawns,listens:()=>listens,text:()=>text,set:(value:string)=>{text=value},append:(value:string)=>{text+=value},now:(value:number)=>{now=value},hello:async()=>{for(const [id,timer]of [...timers])if(timer.ms===0){timers.delete(id);timer.fn()}await drain()},fallback:()=>{for(const [id,timer]of [...timers])if(timer.ms===1500){timers.delete(id);timer.fn()}},shared:()=>{io.listen=()=>{listens++;return()=>{}}}}
}
const request=(id:string,text='external')=>JSON.stringify({v:1,id,session:S,at:T,kind:'submit',text})+'\n'
test('M1 A1 self hello proves watcher, cancels timeout, and starts zero tail/shared followers',async()=>{
 const f=fixture();f.shared();await f.c.classicStart();expect(f.c.requestWatch()).toBe(P);expect(f.spawns()).toBe(0);expect(f.listens()).toBe(0);expect(f.timers.size).toBe(1);expect(f.text()).toBe('');await f.hello();expect(JSON.parse(f.text()).kind).toBe('hello');await f.c.fileChanged();expect(f.timers.size).toBe(0);f.fallback();await drain();expect(f.spawns()).toBe(0);expect(f.listens()).toBe(0);f.c.stop();expect(f.errors).toEqual([])
})
test('M1 A1 FileChanged consumes new request once using UTF-8 byte offset and keeps existing requests',async()=>{
 const f=fixture(F,'older香🌸\n');await f.c.start();await f.hello();await f.c.fileChanged();f.append(request('0123456789abcdef','中文🌸'));await Promise.all([f.c.fileChanged(),f.c.fileChanged()]);expect(f.actions).toEqual(['中文🌸']);expect(f.authority).toEqual([]);expect(f.spawns()).toBe(0);expect(f.errors).toEqual([]);f.c.stop()
})
test('M1 A1 missing FileChanged starts legacy tail at exactly the one 1500ms fallback',async()=>{
 const f=fixture();await f.c.start();await f.hello();expect(f.spawns()).toBe(0);f.fallback();await drain();expect(f.spawns()).toBe(1);expect(f.timers.size).toBe(0);f.fallback();await drain();expect(f.spawns()).toBe(1);f.c.stop()
})
test('M1 A1 missing watcher reuses shared presence request listener before tail',async()=>{
 const f=fixture();f.shared();await f.c.start();await f.hello();f.fallback();await drain();expect(f.listens()).toBe(1);expect(f.spawns()).toBe(0);f.c.stop()
})
test('M1 A1 Windows gets watched requests and does not invent a Windows tail fallback',async()=>{
 const f=fixture('C:\\Users\\owner\\AppData\\Local\\Coco');await f.c.start();await f.hello();await f.c.fileChanged();f.append(request('0123456789abcdef'));await f.c.fileChanged();expect(f.actions).toEqual(['external']);expect(f.authority).toEqual([]);expect(f.spawns()).toBe(0);f.c.stop()
 const miss=fixture('C:\\Users\\owner\\AppData\\Local\\Coco');await miss.c.start();await miss.hello();miss.fallback();await drain();expect(miss.spawns()).toBe(0);expect(miss.c.isRunning).toBe(false)
})
test('M1 A1 request rotation/truncation resets offsets while invalid old fragments cannot execute',async()=>{
 const f=fixture();await f.c.start();await f.hello();await f.c.fileChanged();f.set(request('0123456789abcdef'));await f.c.fileChanged();expect(f.actions).toEqual(['external']);expect(f.authority).toEqual([]);f.now(T+3000);f.set(JSON.stringify({v:1,id:'1123456789abcdef',session:S,at:T+3000,kind:'submit',text:'rotated'})+'\n');await f.c.fileChanged();expect(f.actions).toEqual(['external','rotated']);expect(f.authority).toEqual([]);f.c.stop()
})
test('M1 A1 stopped watcher never reads, and proven watcher has no idle timer or process',async()=>{
 const f=fixture();await f.c.start();await f.hello();await f.c.fileChanged();const reads=f.reads();expect(f.timers.size).toBe(0);await drain();expect(f.reads()).toBe(reads);expect(f.spawns()).toBe(0);f.c.stop();f.append(request('0123456789abcdef'));await f.c.fileChanged();expect(f.reads()).toBe(reads);expect(f.actions).toEqual([])
})
test('M1 A1 baseline above 4 MiB is rejected and safely falls back without parsing it',async()=>{
 const f=fixture(F,'x'.repeat(4*1024*1024+1));await f.c.start();await f.hello();expect(f.errors.length).toBe(1);expect(f.spawns()).toBe(1);expect(f.actions).toEqual([]);expect(f.timers.size).toBe(0);f.c.stop()
})
test('M1 A1 cancellation before the post-return hello writes nothing and pending append has no early timeout',async()=>{
 const stopped=fixture();await stopped.c.classicStart();stopped.c.stop();await stopped.hello();expect(stopped.text()).toBe('');expect(stopped.timers.size).toBe(0);expect(stopped.spawns()).toBe(0)
 const f=fixture();let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve});const append=f.io.append
 f.io.append=async(path,value)=>{await pending;await append(path,value)}
 await f.c.start();await f.hello();expect(f.timers.size).toBe(0);f.fallback();await drain();expect(f.spawns()).toBe(0)
 release();await drain();expect(f.timers.size).toBe(1);await f.c.fileChanged();expect(f.timers.size).toBe(0);f.c.stop()
})
test('M1 A1 all More off denies fallback before filesystem probes, shared listeners, timers or children',async()=>{
 const f=fixture();f.shared();f.io.canFollow=()=>false;await f.c.start();await f.hello();const paths:string[]=[];f.io.exists=async path=>{paths.push(path);return true};const reads=f.reads();f.fallback();await drain()
 expect(paths).toEqual([]);expect(f.reads()).toBe(reads);expect(f.listens()).toBe(0);expect(f.spawns()).toBe(0);expect(f.timers.size).toBe(0);expect(f.c.isRunning).toBe(false);f.c.stop()
})
test('M1 A1 an all-off watcher timeout can retry its handshake when a More row is enabled later',async()=>{
 const f=fixture();let on=false;f.io.canFollow=()=>on;await f.c.start();f.c.stopFollowerOnly();await f.hello();f.fallback();await drain();expect(f.spawns()).toBe(0);expect(f.timers.size).toBe(0);expect(f.c.isRunning).toBe(false)
 on=true;await f.c.start();expect(f.timers.size).toBe(1);await f.hello();await f.c.fileChanged();expect(f.c.isRunning).toBe(true);expect(f.spawns()).toBe(0);f.c.stop()
})
test('M1 A1 all-off stop keeps pending and proven engine watch while stale follower cleanup cannot stop a restart',async()=>{
 const f=fixture();await f.c.start();f.c.stopFollowerOnly();expect(f.timers.size).toBe(1);await f.hello();await f.c.fileChanged();f.c.stopFollowerOnly();expect(f.c.isRunning).toBe(true);expect(f.timers.size).toBe(0);f.c.stop()
 const tail=fixture();await tail.c.start();await tail.hello();tail.fallback();await drain();expect(tail.spawns()).toBe(1);tail.c.stopFollowerOnly();expect(tail.c.isRunning).toBe(false);await tail.c.start();await drain();expect(tail.timers.size).toBe(1);await tail.hello();await tail.c.fileChanged();expect(tail.c.isRunning).toBe(true);expect(tail.timers.size).toBe(0);tail.c.stop()
})
test('M1 A1 turning the last More row off during an awaited fallback probe prevents later reads and spawn',async()=>{
 const f=fixture();let on=true,release!:()=>void,entered!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve}),began=new Promise<void>(resolve=>{entered=resolve}),paths:string[]=[]
 f.io.canFollow=()=>on;f.io.exists=async path=>{paths.push(path);if(path==='/usr/bin/tail'){entered();await pending}return true};await f.c.start();await f.hello();paths.length=0;f.fallback();await began;on=false;f.c.stopFollowerOnly();release();await drain();expect(paths).toEqual(['/usr/bin/tail']);expect(f.spawns()).toBe(0);expect(f.c.isRunning).toBe(false);expect(f.timers.size).toBe(0);f.c.stop()
})

const sharedReady=(f:ReturnType<typeof fixture>)=>{
 expect(typeof (f.c as unknown as {sharedReady?:unknown}).sharedReady).toBe('function')
 ;(f.c as unknown as {sharedReady:()=>void}).sharedReady()
}
const withoutTail=async(f:ReturnType<typeof fixture>)=>{
 const paths:string[]=[];f.io.exists=async path=>{paths.push(path);return path!=='/usr/bin/tail'}
 await f.c.start();await f.hello();f.fallback();await drain();expect(f.c.isRunning).toBe(false);expect(f.timers.size).toBe(0)
 return paths
}
test('M1 A1 late shared readiness attaches once without new probes reads timers or children',async()=>{
 const f=fixture();let readerActive=false,subscriptions=0,unsubscribes=0
 f.io.listen=()=>{if(!readerActive)return undefined;subscriptions++;return()=>{unsubscribes++}}
 const paths=await withoutTail(f),reads=f.reads(),probes=paths.length
 sharedReady(f);expect(subscriptions).toBe(0);expect(f.c.isRunning).toBe(false)
 readerActive=true;sharedReady(f);sharedReady(f);sharedReady(f)
 expect(subscriptions).toBe(1);expect(f.c.isRunning).toBe(true);expect(f.spawns()).toBe(0);expect(f.reads()).toBe(reads);expect(paths.length).toBe(probes);expect(f.timers.size).toBe(0);expect(f.errors).toEqual([]);f.c.stop();expect(unsubscribes).toBe(1)
})
test('M1 A1 stopped and ended channels cannot attach on later shared readiness',async()=>{
 for(const stop of ['stop','stopFollowerOnly'] as const){
  const f=fixture();await withoutTail(f);f.c[stop]();f.shared();const reads=f.reads();sharedReady(f)
  expect(f.listens()).toBe(0);expect(f.spawns()).toBe(0);expect(f.reads()).toBe(reads);expect(f.timers.size).toBe(0);expect(f.c.isRunning).toBe(false);expect(f.errors).toEqual([])
 }
 const ended=fixture();await withoutTail(ended);let subscriptions=0,unsubscribes=0,end!:()=>void
 ended.io.listen=(_receive:unknown,finished:()=>void)=>{subscriptions++;end=finished;return()=>{unsubscribes++}}
 sharedReady(ended);expect(subscriptions).toBe(1);end();await drain();sharedReady(ended)
 expect(subscriptions).toBe(1);expect(unsubscribes).toBe(1);expect(ended.c.isRunning).toBe(false);expect(ended.spawns()).toBe(0);expect(ended.timers.size).toBe(0);expect(ended.errors).toEqual([])
})
test('M1 A1 readiness during each held fallback filesystem await prevents another follower or filesystem step',async()=>{
 for(const phase of ['tail','ensure','folder'] as const){
  const f=fixture();let release!:()=>void,began!:()=>void,ensures=0,folders=0;const held=new Promise<void>(resolve=>{release=resolve}),entered=new Promise<void>(resolve=>{began=resolve}),paths:string[]=[]
  f.io.exists=async path=>{paths.push(path);if(path===F)folders++;if((phase==='tail'&&path==='/usr/bin/tail')||(phase==='folder'&&path===F&&folders===2)){began();await held}return true}
  f.io.ensureRequests=async()=>{ensures++;if(phase==='ensure'&&ensures===2){began();await held}}
  await f.c.start();await f.hello();f.fallback();await entered;f.shared();const reads=f.reads(),probes=paths.length,creations=ensures
  try{
   sharedReady(f);expect(f.listens()).toBe(1);expect(f.c.isRunning).toBe(true);expect(f.reads()).toBe(reads);expect(paths.length).toBe(probes);expect(ensures).toBe(creations);expect(f.spawns()).toBe(0);expect(f.timers.size).toBe(0)
   release();await drain();expect(f.spawns()).toBe(0);expect(f.listens()).toBe(1);expect(f.reads()).toBe(reads);expect(paths.length).toBe(probes);expect(ensures).toBe(creations);expect(f.timers.size).toBe(0);expect(f.errors).toEqual([])
  }finally{release();f.c.stop()}
 }
})
test('M1 A1 a real failed tail pull remains final when a shared reader becomes ready',async()=>{
 const f=fixture();let children=0,returned=0;const failure=new Error('held channel tail failure')
 f.io.spawn=()=>{children++;return {next:async()=>{throw failure},return:async()=>{returned++;return {done:true,value:{code:null,signal:null}}}}as never}
 await f.c.start();await f.hello();f.fallback();await drain();expect(children).toBe(1);expect(returned).toBe(1);expect(f.errors).toEqual([failure]);expect(f.c.isRunning).toBe(false)
 f.shared();sharedReady(f);await f.c.start();await drain();expect(f.listens()).toBe(0);expect(children).toBe(1);expect(returned).toBe(1);expect(f.timers.size).toBe(0);expect(f.errors).toEqual([failure]);f.c.stop()
})
test('M1 A1 last row off rejects late shared readiness without probes reads timers or children',async()=>{
 const f=fixture();let on=true;f.io.canFollow=()=>on;const paths=await withoutTail(f);f.shared();on=false;const reads=f.reads(),probes=paths.length
 sharedReady(f);expect(f.listens()).toBe(0);expect(f.c.isRunning).toBe(false);expect(f.spawns()).toBe(0);expect(f.reads()).toBe(reads);expect(paths.length).toBe(probes);expect(f.timers.size).toBe(0);expect(f.errors).toEqual([]);f.c.stop()
})


// S1 finding 2: journal receipt never grants authority to submit or clear.
test('M1 S1 forged valid journal queues only a local note and never authorizes submits or clears',async()=>{
 const f=fixture();await f.c.start();await f.hello();await f.c.fileChanged()
 const valid=request('0123456789abcdef','forged-window-note');f.append(valid)
 await f.c.fileChanged();expect(f.actions).toEqual(['forged-window-note']);expect(f.authority).toEqual([])
 await f.c.fileChanged();expect(f.actions).toEqual(['forged-window-note']);expect(f.authority).toEqual([])
 f.now(T+3000);f.append(JSON.stringify({v:1,id:'1123456789abcdef',session:S,at:T+3000,kind:'clear'})+'\n')
 await f.c.fileChanged();expect(f.actions).toEqual(['forged-window-note']);expect(f.authority).toEqual([])
 expect(f.spawns()).toBe(0);expect(f.timers.size).toBe(0);expect(f.errors).toEqual([]);f.c.stop()
})
