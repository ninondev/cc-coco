import {test,expect} from 'bun:test'
import {D1Runtime} from '../../../plugin/hooks/d1-runtime'
import type {D1Snapshot} from '../../../plugin/hooks/d1-runtime'

type FoldedHelper={agentId:string;parentAgentId?:string;startedAt:number;arrivalAt?:number;state:'running'|'done'|'failed'|'stopped';endedAt?:number;leavingAt?:number}
const folded=(snapshot:D1Snapshot):FoldedHelper[]=>(snapshot as D1Snapshot&{overflowHelpers?:FoldedHelper[]}).overflowHelpers??[]
const mainVisible=(snapshot:D1Snapshot)=>[...snapshot.helpers,...folded(snapshot)].filter(h=>!h.parentAgentId&&(h.state==='running'||h.leavingAt!==undefined))

for(const state of ['done','failed'] as const)test(`a folded running helper stays visible and retains its ${state} exit until 240ms without duplicating usage`,()=>{
 const runtime=new D1Runtime();runtime.startTurn('main',0);runtime.spawn('oldest','old description','general-purpose',10)
 runtime.usage('oldest',{input_tokens:12});const arrivalAt=runtime.snapshot().helpers[0]!.arrivalAt
 for(let i=0;i<64;i++)runtime.spawn('new-'+i,'new helper','general-purpose',20+i)
 for(let i=0;i<64;i++)runtime.finish('new-'+i,20000,'done')
 runtime.removeLeaving(20240);runtime.usage('oldest',{output_tokens:13})
 const before=runtime.snapshot()
 expect(before.helpers.length).toBe(64);expect(before.mainHelpers).toBe(1);expect(before.runningHelpers).toBe(1);expect(runtime.isRunning('oldest')).toBe(true)
 expect(mainVisible(before).map(h=>h.agentId)).toEqual(['oldest']);expect(folded(before)[0]?.startedAt).toBe(10);expect(folded(before)[0]?.arrivalAt).toBe(arrivalAt)
 expect(folded(before)[0]).not.toHaveProperty('description');expect(folded(before)[0]).not.toHaveProperty('type');expect(folded(before)[0]).not.toHaveProperty('toolUses')
 expect(before.earlier).toEqual({count:1,tokens:25});expect(before.totalTokens).toBe(25);expect(runtime.complete(120000,'answer')).toBeUndefined()
 runtime.finish('oldest',120000,state,{tokens:30,durationMs:119990,toolUses:7})
 const ended=runtime.snapshot()
 expect(ended.mainHelpers).toBe(0);expect(ended.runningHelpers).toBe(0);expect(runtime.isRunning('oldest')).toBe(false);expect(ended.longTask?.completedAt).toBe(120000)
 expect(mainVisible(ended).map(h=>[h.agentId,h.state,h.leavingAt])).toEqual([['oldest',state,120000]])
 expect(ended.earlier).toEqual({count:1,tokens:30});expect(ended.totalTokens).toBe(30)
 runtime.finish('oldest',120001,state,{tokens:30})
 expect(runtime.snapshot().earlier).toEqual({count:1,tokens:30});expect(runtime.snapshot().totalTokens).toBe(30)
 runtime.removeLeaving(120239);expect(mainVisible(runtime.snapshot()).map(h=>h.agentId)).toEqual(['oldest'])
 runtime.removeLeaving(120240);expect(mainVisible(runtime.snapshot())).toEqual([]);expect(folded(runtime.snapshot())).toEqual([])
 expect(runtime.snapshot().helpers.length).toBe(64);expect(runtime.snapshot().earlier).toEqual({count:1,tokens:30});expect(runtime.snapshot().totalTokens).toBe(30)
})

test('folded nested helpers stay out of main scrolls while blocking quiet and clear reclaims their projection',()=>{
 const runtime=new D1Runtime();runtime.startTurn('main',0);runtime.spawn('nested','nested description','general-purpose',10,'parent')
 for(let i=0;i<64;i++){runtime.spawn('new-'+i,'new helper','general-purpose',20+i);runtime.finish('new-'+i,20000,'done')}
 runtime.removeLeaving(20240)
 expect(folded(runtime.snapshot()).map(h=>[h.agentId,h.parentAgentId])).toEqual([['nested','parent']]);expect(mainVisible(runtime.snapshot())).toEqual([])
 expect(runtime.snapshot().mainHelpers).toBe(0);expect(runtime.snapshot().runningHelpers).toBe(1);expect(runtime.complete(120000,'answer')).toBeUndefined()
 runtime.finish('nested',120001,'done');expect(runtime.snapshot().runningHelpers).toBe(0);expect(runtime.snapshot().longTask?.completedAt).toBe(120001);expect(mainVisible(runtime.snapshot())).toEqual([])
 runtime.clear();expect(folded(runtime.snapshot())).toEqual([]);expect(runtime.snapshot().helpers).toEqual([]);expect(runtime.snapshot().earlier).toEqual({count:0,tokens:0});expect(runtime.snapshot().totalTokens).toBe(0)
})
