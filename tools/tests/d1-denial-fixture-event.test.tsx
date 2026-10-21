import {test,expect} from 'claude-code/testing'
import {parsePresence} from '../hooks/presence'
import {D1_DENIAL_INITIAL} from './d1-denial-initial-source-fixture'

test('D1 denial fixture exact shipping initial record passes the presence parser',()=>{
 expect(D1_DENIAL_INITIAL.v).toBe(1);expect(D1_DENIAL_INITIAL.seq).toBe(0);expect(D1_DENIAL_INITIAL.event.kind).toBe('initial')
 expect(D1_DENIAL_INITIAL.event.at).toBe(D1_DENIAL_INITIAL.quietAt)
 const parsed=parsePresence(JSON.stringify(D1_DENIAL_INITIAL))
 expect(parsed).toBeDefined()
 expect(parsed!.seq).toBe(0);expect(parsed!.event.kind).toBe('initial');expect(parsed!.event.at).toBe(D1_DENIAL_INITIAL.event.at)
})

test('D1 denial fixture malformed legacy initial ID is rejected independently of the source version',()=>{
 const valid={...D1_DENIAL_INITIAL,event:{...D1_DENIAL_INITIAL.event,id:`initial:0:${D1_DENIAL_INITIAL.event.at}`}}
 expect(parsePresence(JSON.stringify(valid))).toBeDefined()
 expect(parsePresence(JSON.stringify({...valid,event:{...valid.event,id:'denial-fixture'}}))).toBeUndefined()
})
