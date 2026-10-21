import {test,expect} from 'bun:test'
import {D1Runtime} from '../../../plugin/hooks/d1-runtime'

test('a short quiet task stays short when an already completed helper is reported again later',()=>{
 const runtime=new D1Runtime()
 runtime.startTurn('short-main',0)
 runtime.spawn('background','fixture helper','general-purpose',100)
 runtime.finish('background',1000,'done')
 expect(runtime.complete(60000,'answer')).toBeUndefined()
 runtime.finish('background',180000,'done',{tokens:37,durationMs:900,toolUses:2})
 expect(runtime.snapshot().longTask).toBeUndefined()
 expect(runtime.snapshot().helpers[0]?.endedAt).toBe(1000)
 expect(runtime.snapshot().helpers[0]?.engineTotals).toEqual({tokens:37,durationMs:900,toolUses:2})
 runtime.finish('background',240000,'done')
 expect(runtime.snapshot().longTask).toBeUndefined()
})
