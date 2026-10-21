import {test,expect} from 'claude-code/testing'
import {generateMotion,MOTION} from '../hooks/motion'
const closedSpans=(variant:0|1|2)=>{
 const motion=generateMotion('waiting',variant),closed=motion.layers.find(layer=>layer.name==='face:blink'&&layer.loop)!,spans:number[]=[]
 for(let i=0;i<closed.points.length-1;i++){const a=closed.points[i]!,b=closed.points[i+1]!;if(a.value===1&&b.value===1)spans.push(b.at-a.at)}
 return spans
}
test('C3 guardian line shows the plain waiting figure: it leans and breathes, and its slow blink stays allowed',()=>{
 const motion=generateMotion('waiting',0)
 expect(motion.sway.some(p=>p.value!==0)).toBe(true)
 expect(motion.breath.some(p=>p.value!==1)).toBe(true)
 const spans=([0,1,2] as const).flatMap(closedSpans)
 expect(spans.length).toBeGreaterThan(0)
 expect(spans.some(span=>span>MOTION.blink.shut.max)).toBe(true)
})
