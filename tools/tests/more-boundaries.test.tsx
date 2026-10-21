import {test,expect} from 'claude-code/testing'
import type {EngineInterface} from 'claude-code'
import {MoreRuntime,LOOK_DENY} from '../hooks/more-runtime'
import {installModelServiceFixture} from './m1-model-service-fixture'
installModelServiceFixture()
const AT=Date.UTC(2026,9,6,12)
function engine(agents:{id:string;type:string}[]=[]){
 const calls:string[]=[]
 const call=(name:string)=>calls.push(name)
 const $={
  clock:{now:async()=>{call('clock.now');return AT}},
  store:{get:async()=>{call('store.get')},set:async()=>{call('store.set')}},
  session:{repo:async()=>{call('session.repo');return null}},
  process:{run:async()=>{call('process.run');return{stdout:''}}},
  agent:{register:async()=>{call('agent.register')},spawn:async()=>{call('agent.spawn');return{agentId:'fixture-reader'}},list:async()=>{call('agent.list');return agents}},
  tool:{register:async()=>{call('tool.register')}},
  ui:{log:()=>call('ui.log'),invalidate:()=>call('ui.invalidate')},
 } as unknown as EngineInterface
 return{$,calls}
}
test('M1 O3 the reader stays off without its instruction: no registration, no spawn, nothing kept',async()=>{
 const f=engine(),r=new MoreRuntime()
 r.restore({look:true},['look'],undefined,AT)
 expect(r.isOn('look')).toBe(false)
 expect(r.registerLook(f.$)).toBe(undefined)
 r.edit('/fixture/project/file.ts','synthetic edit')
 expect(r.secondLook(f.$)).toBe(undefined)
 // A stale in-memory registration flag cannot stand in for the instruction.
 ;(r as unknown as {registeredLook:boolean}).registeredLook=true
 expect(r.isOn('look')).toBe(false);expect(r.secondLook(f.$)).toBe(undefined)
 expect(await r.press(f.$,'coco:more:look:on')).toBe(false)
 expect(f.calls).toEqual([])
})
// U3 (10-17): the second look's reader opens only the files Claude changed, and only by their own paths.
test('M1 O3 the reader is held to the changed files; other agents pass untouched',async()=>{
 const f=engine([{id:'helper',type:'general-purpose'},{id:'fixture-reader',type:'coco:second-look'}]),r=new MoreRuntime({'more.model.look.prompt':'synthetic fixture reader instructions'})
 r.restore({look:true},['look'],undefined,AT)
 expect(r.isOn('look')).toBe(true)
 await r.registerLook(f.$)
 r.edit('/fixture/project/a.ts','synthetic edit')
 await r.secondLook(f.$)
 expect(r.lookAgentId).toBe('fixture-reader')
 // the main thread and another agent are never checked
 expect(await r.lookDeny(f.$,undefined,'Read',{file_path:'/fixture/secret.env'})).toBe(undefined)
 expect(await r.lookDeny(f.$,'helper','Read',{file_path:'/fixture/secret.env'})).toBe(undefined)
 expect(await r.lookDeny(f.$,'helper','Bash',{command:'cat /fixture/secret.env'})).toBe(undefined)
 // the reader: the changed file by its path, and nothing else
 expect(await r.lookDeny(f.$,'fixture-reader','Read',{file_path:'/fixture/project/a.ts'})).toBe(undefined)
 expect(await r.lookDeny(f.$,'fixture-reader','Grep',{pattern:'x',path:'/fixture/project/a.ts'})).toBe(undefined)
 for(const [tool,input] of [['Read',{file_path:'/fixture/secret.env'}],['Read',{file_path:'/fixture/project/../secret.env'}],['Grep',{pattern:'x'}],['Grep',{pattern:'x',path:'/fixture/project'}],['Glob',{pattern:'**/*'}],['Bash',{command:'cat /fixture/project/a.ts'}],['WebFetch',{url:'https://example.invalid'}]] as const)
  expect(await r.lookDeny(f.$,'fixture-reader',tool,input as Record<string,unknown>)).toBe(LOOK_DENY)
 // a later prompt's changes do not widen what this reader may open
 r.newPrompt(f.$);r.edit('/fixture/project/b.ts','synthetic edit')
 expect(await r.lookDeny(f.$,'fixture-reader','Read',{file_path:'/fixture/project/b.ts'})).toBe(LOOK_DENY)
 // a reader the session lists before its spawn answers is held the same way
 const g=engine([{id:'early-reader',type:'coco:second-look'}]),s=new MoreRuntime({'more.model.look.prompt':'synthetic fixture reader instructions'})
 s.restore({look:true},['look'],undefined,AT);await s.registerLook(g.$)
 expect(await s.lookDeny(g.$,'early-reader','Read',{file_path:'/fixture/secret.env'})).toBe(LOOK_DENY)
})
