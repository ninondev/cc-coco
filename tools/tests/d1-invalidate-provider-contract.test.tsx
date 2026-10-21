import {test,expect} from 'claude-code/testing'
import {world,PERSON,P} from './world'
test('D1 actual source invalidation reaches the single owner provider with exact render and config events',async($,on)=>{
 const w=world(on)
 await $.command.run({command:'d1-fixture-invalidate',args:'emit',origin:PERSON,presentation:P})
 await w.clock.advance(0)
 const result=await $.command.run({command:'d1-fixture-invalidate',args:'read',origin:PERSON,presentation:P})
 expect(JSON.parse(result.text??'null')).toEqual(['ui.render','config.describe'])
})
