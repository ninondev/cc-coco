import {test,expect} from 'claude-code/testing'
import {D1Runtime} from '../hooks/d1-runtime'

test('D1 main and nested helpers are session-only, capped, engine totals win',()=>{
 const r=new D1Runtime();r.startTurn('t',0);r.spawn('a','check','general',10);r.spawn('b','nested','general',20,'a');r.tool('a');r.usage('a',{inputTokens:100,outputTokens:20,cacheReadInputTokens:30,cacheCreationInputTokens:40});r.usage(undefined,{inputTokens:100});
 expect(r.snapshot().mainHelpers).toBe(1);expect(r.snapshot().helpers[0]!.tokens).toBe(190);expect(r.snapshot().totalTokens).toBe(290)
 r.finish('a',100,'done',{tokens:220,durationMs:90,toolUses:5});expect(r.snapshot().helpers[0]!.engineTotals?.tokens).toBe(220)
 for(let i=0;i<70;i++){r.spawn('x'+i,'one','general',100+i);r.finish('x'+i,200+i)}
 expect(r.snapshot().helpers.length).toBe(64);expect(r.snapshot().earlier.count).toBe(8);r.clear();expect(r.snapshot().helpers.length).toBe(0);expect(r.snapshot().earlier.count).toBe(0)
})
test('D1 long task waits for all helpers, has exact 120s edge, and no permission or aborted notice',()=>{
 const r=new D1Runtime();r.startTurn('a',1000);r.spawn('child','work','type',2000);expect(r.complete(121000,'answer')).toBeUndefined();r.finish('child',130000);expect(r.snapshot().longTask?.durationMs).toBe(129000)
 r.startTurn('b',200000);expect(r.complete(319999,'answer')).toBeUndefined();r.startTurn('c',400000);expect(r.complete(520000,'answer')?.durationMs).toBe(120000)
 r.startTurn('d',600000);r.waiting(true);expect(r.complete(730000,'answer')).toBeUndefined();r.startTurn('e',800000);expect(r.complete(930000,'aborted')).toBeUndefined()
})
test('D1 helper turns do not finish successful background agents, leaving cleanup keeps board totals',()=>{
 const r=new D1Runtime();r.startTurn('t',0);r.spawn('a','one','general',100);r.finish('a',500,'failed');expect(r.snapshot().mainHelpers).toBe(0);expect(r.snapshot().helpers[0]!.leavingAt).toBe(500);r.removeLeaving(739);expect(r.snapshot().helpers[0]!.leavingAt).toBe(500);r.removeLeaving(740);expect(r.snapshot().helpers[0]!.leavingAt).toBeUndefined();expect(r.snapshot().helpers[0]!.state).toBe('failed')
})
test('D1 shed begin replaces old end and clear cancels every session-only state',()=>{
 const r=new D1Runtime();r.compact('one','begin',1);r.compact('one','end',2);r.compact('two','begin',3);expect(r.snapshot().shed).toEqual({id:'two',phase:'begin',at:3});r.compact('two','skip',4);expect(r.snapshot().shed?.phase).toBe('skip');r.clear();expect(r.snapshot().shed).toBeUndefined();expect(r.snapshot().longTask).toBeUndefined()
})
test('D1 overflow helpers still keep the session awake and block the long notice',()=>{
 const r=new D1Runtime();r.startTurn('overflow',0);for(let i=0;i<65;i++)r.spawn('a'+i,'one','type',i)
 expect(r.snapshot().helpers.length).toBe(64);expect(r.snapshot().mainHelpers).toBe(65)
 expect(r.isRunning('a0')).toBe(true)
 for(let i=1;i<65;i++)r.finish('a'+i,120000);expect(r.complete(120000,'answer')).toBeUndefined()
 r.usage('a0',{input_tokens:40});r.finish('a0',120001,'done',{tokens:50});expect(r.snapshot().totalTokens).toBe(50);expect(r.snapshot().longTask?.durationMs).toBe(120001)
 expect(r.isRunning('a0')).toBe(false)
})
test('D1 nested overflow remains awake after all visible helpers finish',()=>{
 const r=new D1Runtime();r.spawn('hidden','nested','type',0,'parent');for(let i=0;i<64;i++)r.spawn('a'+i,'one','type',i+1)
 for(let i=0;i<64;i++)r.finish('a'+i,100)
 expect(r.snapshot().mainHelpers).toBe(0);expect(r.snapshot().runningHelpers).toBe(1)
 r.finish('hidden',200);expect(r.snapshot().runningHelpers).toBe(0)
})
test('D1 completed-turn engine usage replaces its steps without counting them twice',()=>{
 const r=new D1Runtime();r.spawn('h','one','type',0)
 r.stepUsage('h','t1',{input_tokens:10});r.stepUsage('h','t1',{output_tokens:5});expect(r.snapshot().totalTokens).toBe(15)
 r.turnUsage('h','t1',{input_tokens:20,output_tokens:7});expect(r.snapshot().totalTokens).toBe(27)
 r.turnUsage('h','t2',{cache_read_input_tokens:30});expect(r.snapshot().totalTokens).toBe(57)
 r.stepUsage(undefined,'main',{inputTokens:8});r.turnUsage(undefined,'main',{inputTokens:10});expect(r.snapshot().totalTokens).toBe(67)
 r.stepUsage('h','aborted',{output_tokens:2});r.turnUsage('h','aborted',undefined);expect(r.snapshot().totalTokens).toBe(69)
 r.clear();r.turnUsage(undefined,'main',{inputTokens:1});expect(r.snapshot().totalTokens).toBe(1)
})
