import {test,expect} from 'claude-code/testing'
import {readFileSync} from 'node:fs'
import {SHIPPING_MORE_IDS,idleRowState} from '../m1-idle-state'
test('M1 meter forced nonoff request with strict all-off runtime admits no transport',()=>{
 for(const row of SHIPPING_MORE_IDS){
  const state=idleRowState({isOn:()=>false},row)
  expect(state.effectiveAnyMoreOn).toBe(false);expect(state.effectiveOnIds).toEqual([])
  expect(state.requestedEffectiveOn).toBe(false);expect(state.supportState).toBe('requested-on-but-effectively-off')
 }
})
test('M1 meter effective row admission preserves every supported canonical transport choice',()=>{
 for(const row of SHIPPING_MORE_IDS.filter(id=>id!=='look')){
  const state=idleRowState({isOn:id=>id===row},row)
  expect(state.effectiveAnyMoreOn).toBe(true);expect(state.effectiveOnIds).toEqual([row]);expect(state.requestedEffectiveOn).toBe(true)
 }
 expect(idleRowState({isOn:()=>false},'off').supportState).toBe('all-off-request')
})
test('M1 meter native setup and follower gates use effective runtime state rather than requested row',()=>{
 const source=readFileSync('tools/m1-idle-meter.ts','utf8')
 expect(source.includes('if(effectiveState.effectiveAnyMoreOn){')).toBe(true)
 expect(source.includes('canFollow:()=>idleRowState(runtime!,row).effectiveAnyMoreOn')).toBe(true)
 expect(source.includes("transport:effectiveState.effectiveAnyMoreOn?")).toBe(true)
 expect(source.includes("if(row!=='off'){")).toBe(false)
})
