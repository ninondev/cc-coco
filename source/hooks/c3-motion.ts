// C3 timelines use only the approved manifest names. They say which frame a pose is on and when the next cut
// comes; the band draws Coco, so the old figure's painted C3 pictures left with his go of 10-16 (DECISIONS 947).
import { generateMotion } from './d1-state.js'
import type { CocoView as View } from '../types'
type Pose = NonNullable<View['pose']>
type Event = { at:number; end:number }
const PERIOD=60000
// The poses whose tool swaps between an a and a b frame on its own loop.
const LOOPED=new Set(['search','scroll','spyglass','plan','tea'])
const loops=new Map<string,Event[]>()
// His openings (FIRST-MEETING 2.4): the frame cuts, the ones reduced motion uses, and how long the pose, with
// its stage direction, stays.
type Step={at:number;frame:string}
const OPEN:Record<string,{life:number;steps:Step[];reduced:Step[]}>={
 'open-startup':{life:2700,steps:[{at:0,frame:'wave~6'},{at:60,frame:'wave~3'},{at:120,frame:'wave'},{at:2600,frame:'idle-reading'}],reduced:[{at:0,frame:'wave'},{at:2600,frame:'idle-reading'}]},
 'open-resume':{life:1700,steps:[{at:0,frame:'snake'},{at:900,frame:'idle-reading'},{at:1450,frame:'idle-blink'},{at:1570,frame:'idle-reading'}],reduced:[{at:0,frame:'snake'},{at:900,frame:'idle-reading'}]},
 'open-clear':{life:1200,steps:[{at:0,frame:'idle-blink'},{at:300,frame:'idle-reading'}],reduced:[{at:0,frame:'idle-reading'}]},
 'open-fork':{life:1350,steps:[{at:0,frame:'scroll-a'},{at:140,frame:'fork'},{at:1100,frame:'idle-reading'}],reduced:[{at:0,frame:'fork'},{at:1100,frame:'idle-reading'}]},
 'open-week':{life:1500,steps:[{at:0,frame:'scroll-a'},{at:1400,frame:'idle-reading'}],reduced:[{at:0,frame:'scroll-a'},{at:1400,frame:'idle-reading'}]},
}
export const openingLife=(name:string):number|undefined=>OPEN[name]?.life
export const openingStart=(name:string):string=>(OPEN[name]?.steps[0]?.frame??'idle-reading').split('~')[0]!
export const openingFrames=(name:string):string[]=>[...new Set((OPEN[name]?.steps??[]).map(s=>s.frame.split('~')[0]!).map(f=>f==='fork'?'scroll-a':f))]
const openingStep=(name:string,elapsed:number,reduced:boolean):string=>{const steps=reduced?OPEN[name]!.reduced:OPEN[name]!.steps;let frame=steps[0]!.frame;for(const step of steps)if(step.at<=elapsed)frame=step.frame;return frame}
function events(name:string):Event[]{
 const old=loops.get(name);if(old)return old
 let seed=2166136261;for(const c of name)seed=Math.imul(seed^c.charCodeAt(0),16777619)>>>0
 const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return(seed+.5)/4294967296}
 const log=(median:number,sigma:number,min:number,max:number)=>Math.max(min,Math.min(max,median*Math.exp(sigma*Math.sqrt(-2*Math.log(random()))*Math.cos(2*Math.PI*random()))))
 const interval=name==='search'?[1300,.28,900,2200]:name==='plan'?[1700,.25,1200,2600]:name==='scroll'?[2400,.35,1400,4500]:name==='spyglass'?[2200,.3,1600,3200]:[3500,.3,2200,6000]
 const hold=name==='search'?[380,.25,260,560]:name==='plan'?[420,.22,300,600]:name==='scroll'?[1100,.3,700,1800]:name==='spyglass'?[1100,.3,800,1800]:[1200,.25,800,1800]
 const sample=(p:number[])=>log(p[0]!,p[1]!,p[2]!,p[3]!)
 const out:Event[]=[];let cursor=0
 while(cursor<PERIOD){
  cursor+=sample(interval)
  const count=name==='search'?2+Math.floor(random()*3):name==='plan'?2+Math.floor(random()*2):1
  for(let i=0;i<count;i++){
   const end=cursor+sample(hold),fade=name==='tea'?200:60
   if(end+fade>=PERIOD)break
   out.push({at:cursor,end});cursor=end+fade
  }
 }
 loops.set(name,out);return out
}
function cheerCuts(pose:Pose):number[]{return Array.from({length:(pose.celebration??1)>=3?5:3},(_,i)=>(i+1)*480+25)}
function longStart(pose:Pose):number|undefined{return pose.name!=='tea'&&pose.name!=='cheer'&&pose.longAt!==undefined?Math.max(0,pose.longAt-pose.at):undefined}
function teaPose(pose:Pose):Pose{return {...pose,name:'tea',frame:'tea-a',at:pose.longAt!,longAt:undefined}}
export function c3MotionFrame(pose:Pose,elapsed:number,reduced=false):string{
 if(OPEN[pose.name])return openingStep(pose.name,elapsed,reduced)
 if(reduced)return pose.frame
 const long=longStart(pose);if(long!==undefined&&elapsed>=long)return c3MotionFrame(teaPose(pose),elapsed-long)
 if(pose.name==='cheer'){
  const big=(pose.celebration??1)>=3,hold=big?2900:1900
  if(elapsed<hold)return cheerCuts(pose).filter(at=>at<=elapsed).length%2?'cheer-b':'cheer-a'
  return big&&elapsed<3020?'happy-rise':'happy'
 }
 if(pose.name==='run')return elapsed>=420?'run-b':'run-a'
 if(pose.name==='helper')return elapsed>=900?'helper-b':'helper-a'
 if(LOOPED.has(pose.name))return events(pose.name).some(e=>elapsed%PERIOD>=e.at&&elapsed%PERIOD<e.end)?pose.name+'-b':pose.name+'-a'
 if(pose.name==='work')return generateMotion('work',0).frameAt(Math.max(0,elapsed))
 return pose.frame
}
export function c3NextMotion(pose:Pose,elapsed:number,reduced=false):number|undefined{
 if(OPEN[pose.name]){const at=(reduced?OPEN[pose.name]!.reduced:OPEN[pose.name]!.steps).map(s=>s.at).find(at=>at>elapsed);return at===undefined?undefined:at-elapsed}
 const long=longStart(pose)
 if(long!==undefined&&elapsed>=long)return c3NextMotion(teaPose(pose),elapsed-long)
 let next:number|undefined
 if(pose.name==='cheer'){
  const points=[...cheerCuts(pose),...((pose.celebration??1)>=3?[2900,3020,5500]:[1900,3300])]
  const at=points.find(at=>at>elapsed);next=at===undefined?undefined:at-elapsed
 }else if(pose.name==='ribbon-glance'){
  const at=[120,720].find(at=>at>elapsed);next=at===undefined?undefined:at-elapsed
 }else if(pose.name==='run'||pose.name==='helper'){
  const at=pose.name==='run'?420:900;next=elapsed<at?at-elapsed:undefined
 }else if(LOOPED.has(pose.name)){
  const points=events(pose.name).flatMap(e=>[e.at,e.end]),clock=elapsed%PERIOD
  const at=points.find(at=>at>clock);next=at===undefined?PERIOD-clock+points[0]!:at-clock
 }else if(pose.name==='work'){
  const m=generateMotion('work',0),clock=elapsed%m.duration
  const points=[...new Set(m.layers.filter(l=>!l.name.startsWith('face:')).flatMap(l=>l.points.map(p=>p.at)))].sort((a,b)=>a-b)
  const at=points.find(at=>at>clock+.001);next=at===undefined?m.duration-clock:at-clock
 }
 return long!==undefined&&long>elapsed?Math.min(next??Infinity,long-elapsed):next
}
