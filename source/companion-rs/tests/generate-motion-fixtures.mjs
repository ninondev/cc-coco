import {readFileSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {MOTION,seededRandom,sampleHold,blinkInterval,blinkShut,blinkGap,blinkDouble,gazeBlinkDelay,motionCycle} from '../../hooks/motion.ts'
const seeds=[0,1,42,0xffffffff,0x80000000,0x12345678]
const samples=seeds.map(seed=>{
  let random=seededRandom(seed)
  const randoms=Array.from({length:32},()=>random())
  random=seededRandom(seed)
  const holds=Array.from({length:32},()=>sampleHold(MOTION.blink.interval,random))
  random=seededRandom(seed)
  const blinks=Array.from({length:32},()=>({interval:blinkInterval(random),shut:blinkShut(random),gap:blinkGap(random),double:blinkDouble(random),gaze:gazeBlinkDelay(random)??null}))
  const cycles=Object.fromEntries(['think','work','wild'].map(kind=>{random=seededRandom(seed);const next=motionCycle(kind,random);return[kind,Array.from({length:100},()=>next())]}))
  const timelines={}
  for(const kind of ['think','work','wild']){
    random=seededRandom(seed);const next=motionCycle(kind,random);let time=0,second=false;const changes=[[0,false]]
    while(true){time+=next();if(time>=MOTION.sequenceMs)break;second=!second;changes.push([time,second])}
    changes.push([time,second]);timelines[kind]={changes,duration_ms:time}
  }
  for(const gaze of [false,true]){
    random=seededRandom(seed);const changes=[[0,false]];let time=gaze&&random()<MOTION.blink.gazeChance?sampleHold(MOTION.blink.gazeDelay,random):blinkInterval(random)
    while(time<MOTION.sequenceMs){changes.push([time,true]);time+=blinkShut(random);changes.push([time,false]);if(blinkDouble(random)){time+=blinkGap(random);changes.push([time,true]);time+=blinkShut(random);changes.push([time,false])}time+=blinkInterval(random)}
    changes.push([time,false]);timelines[gaze?'gaze':'idle']={changes,duration_ms:time}
  }
  return{seed,randoms,randomWords:randoms.map(value=>value*4294967296),holds,blinks,cycles,timelines}
})
const hash=createHash('sha256').update(readFileSync(new URL('../../hooks/motion.ts',import.meta.url))).digest('hex')
writeFileSync(new URL('./fixtures/motion.json',import.meta.url),JSON.stringify({source:'plugin/hooks/motion.ts',sha256:hash,model:MOTION,samples},null,2)+'\n')
process.stdout.write(`Executed plugin/hooks/motion.ts in Node ${process.version}; ${seeds.length} seed fixtures; sha256 ${hash}\n`)
