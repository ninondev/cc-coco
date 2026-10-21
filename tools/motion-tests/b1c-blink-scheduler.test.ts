import { expect, test } from 'bun:test'
import { placeBlink, type BlinkRequest } from '../../plugin/hooks/blink-scheduler'
const request = (extra: Partial<BlinkRequest>): BlinkRequest => ({previous:0,candidate:9000,min:1200,max:10000,span:243,obstacles:[],...extra})

test('b: postpone to obstacle end plus 300 ms while actual gap cap permits',()=>{
  expect(placeBlink(request({obstacles:[{name:'deep-thought:0',start:8800,end:9400}]}))).toEqual({at:9700,kind:'blink'})
})
test('b: postponement considers the entire slow blink span',()=>{
  expect(placeBlink(request({candidate:8000,span:900,obstacles:[{name:'deep-thought:0',start:8700,end:9000}]}))).toEqual({at:9300,kind:'blink'})
})
test('c: cap forces latest full blink before obstacle with 300 ms clearance',()=>{
  expect(placeBlink(request({obstacles:[{name:'deep-thought:0',start:8800,end:10200}]}))).toEqual({at:8257,kind:'blink'})
})
test('c: backward search crosses an entire chain of stroke exclusions',()=>{
  expect(placeBlink(request({obstacles:[{name:'stroke:0',start:9400,end:9400},{name:'stroke:1',start:9900,end:9900}]}))).toEqual({at:8857,kind:'blink'})
})
test('c: respects the previous blink minimum instead of moving too close',()=>{
  expect(placeBlink(request({min:9000,obstacles:[{name:'stroke:0',start:9200,end:9200},{name:'stroke:1',start:9700,end:9700},{name:'stroke:2',start:10200,end:10200}]}))).toBeUndefined()
})
for(const face of ['blink','happy-arcs','squeeze']as const)test(`d: an existing ${face} closure counts when neither side fits`,()=>{
  const closure={name:`existing:${face}`,face,start:6000,end:6200}
  expect(placeBlink(request({obstacles:[{name:'held-expression:0',start:500,end:14000}],closures:[closure]}))).toEqual({at:6000,kind:'existing',closure})
})
test('d: a named obstacle grants only its own exact duration',()=>{
  const obstacle={name:'long-deep-thought:0',start:500,end:14000}
  expect(placeBlink(request({obstacles:[obstacle]}))).toEqual({at:14300,kind:'blink',exception:{obstacle,from:0,to:14300,excess:4300,allowance:13500}})
})
test('d: adjacent short obstacles cannot fabricate a long exception',()=>{
  const obstacles=Array.from({length:29},(_,i)=>({name:`stroke:${i}`,start:500+i*500,end:500+i*500}))
  expect(placeBlink(request({obstacles}))).toBeUndefined()
})
test('d: closure outside the blocking obstacle cannot be counted',()=>{
  expect(placeBlink(request({obstacles:[{name:'stroke',start:10000,end:10000}],min:9900,closures:[{name:'unrelated',face:'blink',start:9950,end:9990}]}))).toBeUndefined()
})
test('e: the following loop obstacle moves a seam blink before its boundary',()=>{
  expect(placeBlink(request({previous:95000,candidate:104600,max:10000,latest:105000,obstacles:[{name:'next-loop:stroke',start:105100,end:105100}]}))).toEqual({at:104557,kind:'blink'})
})
test('e: seam deadline also preserves the first blink minimum interval',()=>{
  expect(placeBlink(request({previous:95000,candidate:104500,max:10000,latest:103800,obstacles:[]}))).toEqual({at:103800,kind:'blink'})
})
