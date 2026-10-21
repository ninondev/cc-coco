import {test,expect} from 'bun:test'
import {reconcileRibbon,selectRibbon} from '../../../plugin/hooks/d1-ribbon'

test('full simultaneous snapshots allocate distinct ribbons on the first correction and never cascade',()=>{
 for(const n of [3,7,14]){
  const claims=Array.from({length:n},(_,i)=>({id:`session-${String(i).padStart(2,'0')}`,at:100,ribbon:1}))
  const canonical=claims.map(own=>({...own,ribbon:reconcileRibbon(own,[...claims].reverse())}))
  expect(canonical.map(c=>c.ribbon)).toEqual(Array.from({length:n},(_,i)=>i+1))
  expect(canonical.map(own=>reconcileRibbon(own,canonical))).toEqual(canonical.map(c=>c.ribbon))
  const mixed=claims.map(c=>({...c})),changes=new Map(claims.map(c=>[c.id,0]))
  for(const own of [...mixed].reverse()){
   const next=reconcileRibbon(own,mixed);if(next!==own.ribbon)changes.set(own.id,changes.get(own.id)!+1);own.ribbon=next
  }
  for(const own of mixed){const next=reconcileRibbon(own,mixed);if(next!==own.ribbon)changes.set(own.id,changes.get(own.id)!+1);own.ribbon=next}
  expect(mixed.map(c=>c.ribbon)).toEqual(canonical.map(c=>c.ribbon));expect([...changes.values()].every(n=>n<=1)).toBe(true)
 }
})
test('collision correction reserves already distinct younger ribbons and ignores legacy claims with no valid ribbon',()=>{
 const claims=[{id:'a',at:1,ribbon:1},{id:'b',at:1,ribbon:1},{id:'c',at:1,ribbon:1},{id:'d',at:1,ribbon:2}]
 expect(claims.map(own=>reconcileRibbon(own,claims))).toEqual([1,3,4,2])
 const legacy=[{id:'00-legacy',at:0},{id:'01-invalid',at:0,ribbon:99},...claims]
 expect(claims.map(own=>reconcileRibbon(own,legacy))).toEqual([1,3,4,2])
})
test('projected correction keeps birth order before id and preserves the existing beyond-fourteen repeat policy',()=>{
 const claims=Array.from({length:15},(_,i)=>({id:`${15-i}`,at:i,ribbon:1}))
 expect(claims.map(own=>reconcileRibbon(own,claims))).toEqual([...Array.from({length:14},(_,i)=>i+1),1])
 expect(selectRibbon(undefined,Array.from({length:14},(_,i)=>i+1))).toBe(1)
 expect(selectRibbon(undefined,Array.from({length:15},(_,i)=>i%14+1))).toBe(2)
 const unique=[{id:'z',at:1,ribbon:5},{id:'a',at:2,ribbon:3}]
 expect(unique.map(own=>reconcileRibbon(own,unique))).toEqual([5,3])
 const ids=[{id:'Z',at:1,ribbon:1},{id:'a',at:1,ribbon:1}]
 expect(ids.map(own=>reconcileRibbon(own,ids))).toEqual([1,2])
})
