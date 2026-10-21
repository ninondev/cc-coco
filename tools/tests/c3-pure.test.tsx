import { expect, test } from 'claude-code/testing'
import { LineSlot, lineParts } from '../hooks/line-slot'
import { ToolPoses, poseForTool } from '../hooks/tool-poses'

test('C3 line classes replace equals, drop lower, and retain exactly one once-only line', () => {
  const slot=new LineSlot(), shown:string[]=[]
  slot.offer({key:'guard',text:'guard',class:3,ttl:100,callId:'call'},0)
  expect(slot.offer({key:'ambient',text:'ambient',class:0},1)).toBe('dropped')
  slot.offer({key:'pace',text:'pace',class:1,once:true,onShown:()=>shown.push('pace')},2)
  slot.offer({key:'stamp',text:'stamp',class:1,once:true,onShown:()=>shown.push('stamp')},3)
  expect(shown).toEqual([])
  slot.clear('turn',4,'call')
  expect(slot.visible(4)?.key).toBe('stamp')
  slot.markShown(slot.visible(4)!.id);slot.markShown(slot.visible(4)!.id)
  expect(shown).toEqual(['stamp'])
  expect(slot.queued()).toBeUndefined()
})
test('C3 queued occasions are revalidated, prompts discard bookmark, and no secret is retained', () => {
  const slot=new LineSlot();let valid=true
  slot.offer({key:'guard',text:'guard',class:3,ttl:100},0)
  slot.offer({key:'bookmark',text:'file',class:0,once:true,untilPrompt:true,valid:()=>valid},1)
  valid=false;slot.advance(100)
  expect(slot.visible(100)).toBeUndefined()
  expect(slot.queued()).toBeUndefined()
  slot.offer({key:'bookmark',text:'todo',class:0,untilPrompt:true},100)
  slot.clear('prompt',101)
  expect(slot.visible(101)).toBeUndefined()
})
test('C3 bold parts match values without introducing markup or bolding prose', () => {
  expect(lineParts('first one down: parser', ['parser'])).toEqual([{text:'first one down: '},{text:'parser',slot:true}])
})
test('C3 paired budget notes show five-hour first and queue seven-day with the same class', () => {
  const slot=new LineSlot()
  slot.offer({id:'five-budget',key:'budget',text:'five',class:1,once:true},0)
  slot.offer({id:'week-budget',key:'budget',text:'week',class:1,once:true,waitForId:'five-budget'},0)
  expect(slot.visible(0)?.id).toBe('five-budget')
  expect(slot.queued()).toBe('week-budget')
  slot.markShown('five-budget',0);slot.advance(14000)
  expect(slot.visible(14000)?.id).toBe('week-budget')
})
test('C3 approved fast-changes sequence gives exactly the five requested poses', () => {
  const p=new ToolPoses();p.reset(0)
  const sequence:[[number,string],...[number,string][]]=[[1500,'Grep'],[1800,'Glob'],[2100,'Read'],[2300,'Read'],[2500,'Grep'],[3000,'Read'],[3600,'Edit'],[5600,'Bash']]
  const changed:[number,string][]=[[0,'think']]
  for(const [at,tool] of sequence){if(p.tick(at))changed.push([p.since,p.pose]);if(p.start(String(at),tool,at))changed.push([p.since,p.pose])}
  expect(changed).toEqual([[0,'think'],[1500,'search'],[3000,'scroll'],[4200,'work'],[5600,'run']])
})
test('C3 parallel priority, a long call, and streaming after the minimum hold', () => {
  const p=new ToolPoses();p.reset(0)
  p.start('read','Read',1500);p.start('run','Bash',1550);p.start('helper','Agent',1600)
  expect(p.pose).toBe('helper')
  p.tick(13500);expect(p.pose).toBe('tea')
  p.end('read',13600);p.end('run',13600);p.end('helper',13600)
  p.text(13600);expect(p.pose).toBe('tea')
  p.tick(14700);expect(p.pose).toBe('lookup')
  p.tick(16100);expect(p.pose).toBe('think')
  expect(p.deadline()).toBeUndefined()
  expect(poseForTool('NotebookEdit')).toBe('work')
})
test('C3 writing the reply makes him look up; every tool keeps its own pose (owner 10-09)',()=>{
  const p=new ToolPoses();p.reset(0)
  // text with no call in flight: look up once the minimum hold has passed, and stay up while text keeps coming
  expect(p.text(1300)).toBe(true);expect(p.pose).toBe('lookup')
  expect(p.text(2600)).toBe(false);expect(p.pose).toBe('lookup')
  // a tool call takes the pose of its tool at once after the hold: search, read, run, a generic edit
  for(const [tool,pose] of [['Grep','search'],['Read','scroll'],['Bash','run'],['Edit','work']] as const){
    const at=p.since+1300;p.start(tool,tool,at);expect(p.pose).toBe(pose);p.end(tool,at+100)
    p.text(at+200);p.tick(at+1500);expect(p.pose).toBe('lookup')
  }
  // text during a call does not take the pose away from the call
  const q=new ToolPoses();q.reset(0);q.start('r','Read',1500);q.text(1600);expect(q.pose).toBe('scroll')
  // the reply ends: back to the waiting pose 2.5 s after the last text
  const r=new ToolPoses();r.reset(0);r.text(1300);r.tick(1300+2499);expect(r.pose).toBe('lookup')
  r.tick(1300+2500);expect(r.pose).toBe('think')
  expect(poseForTool('Edit')).toBe('work')
})
