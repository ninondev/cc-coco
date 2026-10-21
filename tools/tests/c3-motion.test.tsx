// The C3 poses' timing: which frame shows and when the next cut comes. Their painted pictures left the plugin with
// his go of 10-16 (DECISIONS 947), and their tests with them.
import { describe, expect, test } from 'claude-code/testing'
import { c3MotionFrame, c3NextMotion } from '../hooks/c3-motion'
const pose=(name:string,extra:Record<string,unknown>={})=>({name,frame:name+'-a',aside:'aside.'+name,at:1000,...extra}) as never
describe('C3 approved motion timing',()=>{
 test('cheer cuts halfway down each bounce, not at its start',()=>{
  for(const reds of [1,3])for(let i=1;i<=(reds===3?5:3);i++){
   const p=pose('cheer',{celebration:reds})
   expect(c3MotionFrame(p,i*480+24)).toBe(i%2?'cheer-a':'cheer-b')
   expect(c3MotionFrame(p,i*480+25)).toBe(i%2?'cheer-b':'cheer-a')
  }
 })
 test('cheer next-frame delays do not wrap after its finite end',()=>{
  expect(c3NextMotion(pose('cheer'),480)).toBe(25)
  expect(c3NextMotion(pose('cheer'),66000)).toBeUndefined()
  expect(c3MotionFrame(pose('cheer'),3300)).toBe('happy')
 })
 test('long-call deadline is a static scheduler boundary for every tool',()=>{
  for(const name of ['run','helper','search','scroll','spyglass','plan','work']){
   const p=pose(name,{longAt:13000})
   const next=c3NextMotion(p,11999)
   expect(next).toBe(1)
   expect(c3MotionFrame(p,12000)).toBe('tea-a')
   expect(c3NextMotion(p,12000)!>0).toBe(true)
  }
 })
})

describe('C3 look-up pose (owner 10-09: he looks up while Claude writes the reply)',()=>{
 const lookup=pose('lookup',{frame:'look-up'})
 test('it is one still figure and never asks for a redraw',()=>{
  expect(c3MotionFrame(lookup,0)).toBe('look-up')
  expect(c3MotionFrame(lookup,90000)).toBe('look-up')
  expect(c3NextMotion(lookup,0)).toBeUndefined()
  expect(c3NextMotion(lookup,90000)).toBeUndefined()
  expect(c3MotionFrame(lookup,5000,true)).toBe('look-up')
 })
})
