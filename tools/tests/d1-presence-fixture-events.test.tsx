import {test,expect} from 'claude-code/testing'
import {parsePresence} from '../hooks/presence'
import {transportFixture} from './presence-transport-fixture'
const NOW=1770000000000
const initial={v:1 as const,seq:1,quietAt:NOW,asleep:false,clingy:false,busy:false,event:{kind:'activity' as const,id:`activity:1:${NOW}`,at:NOW}}
const metadata={cwd:'/tmp/other-window',ribbon:2,ribbonAt:NOW}
const follow=(f:ReturnType<typeof transportFixture>)=>f.spawn('local-session',['/bin/sh','/fixture/bin/presence.sh','/fixture/presence','follow','local-owner'])
const lastLine=(chunk:any)=>String(chunk.value.text).trim().split('\n').pop()!

test('D1 fixture preexisting foreign claim is parseable before any follower exists',()=>{
 const f=transportFixture(initial)
 expect(f.insertSession('other-window',metadata,NOW+1)).toBe(false)
 const raw=f.state
 expect(raw.seq).toBe(2);expect(raw.event.kind).toBe('activity');expect(raw.event.at).toBe(NOW+1)
 expect(raw.claims['other-window'].cwd).toBe(metadata.cwd);expect(raw.claims['other-window'].ribbon).toBe(2);expect(raw.claims['other-window'].ribbonAt).toBe(NOW)
 const parsed=parsePresence(JSON.stringify(raw))
 expect(parsed).toBeDefined()
 expect(parsed!.sessions).toEqual([{session:'other-window',...metadata}])
})

test('D1 fixture actual foreign insert broadcast retains a parseable claim',async()=>{
 const f=transportFixture(initial),stream=follow(f)
 try{
  await stream.next();await stream.next()
  expect(f.insertSession('other-window',metadata,NOW+2)).toBe(true)
  const raw=f.state,packet=await stream.next()
  expect(raw.seq).toBe(2);expect(raw.event.at).toBe(NOW+2)
  expect(JSON.parse(lastLine(packet))).toEqual(raw)
  const parsed=parsePresence(lastLine(packet))
  expect(parsed).toBeDefined()
  expect(parsed!.sessions).toEqual([{session:'other-window',...metadata}])
 }finally{await stream.return({code:0,signal:null})}
})

test('D1 fixture actual foreign removal broadcast retains a parseable empty claim list',async()=>{
 const f=transportFixture(initial),stream=follow(f)
 try{
  await stream.next();await stream.next();f.insertSession('other-window',metadata,NOW+2);await stream.next()
  expect(f.removeSession('other-window',NOW+3)).toBe(true)
  const raw=f.state,packet=await stream.next()
  expect(raw.seq).toBe(3);expect(raw.event.at).toBe(NOW+3);expect(raw.claims['other-window']).toBeUndefined()
  expect(JSON.parse(lastLine(packet))).toEqual(raw)
  const parsed=parsePresence(lastLine(packet))
  expect(parsed).toBeDefined()
  expect(parsed!.sessions).toEqual([])
 }finally{await stream.return({code:0,signal:null})}
})

for(const id of ['fixture-add:other-window:2','fixture-remove:other-window:2'])test(`D1 parser rejects malformed fixture event ID ${id} without accepting its claims`,()=>{
 const valid={...initial,claims:{'other-window':{session:'other-window',...metadata}}}
 expect(parsePresence(JSON.stringify(valid))?.sessions).toEqual([{session:'other-window',...metadata}])
 expect(parsePresence(JSON.stringify({...valid,event:{...valid.event,id}}))).toBeUndefined()
})
