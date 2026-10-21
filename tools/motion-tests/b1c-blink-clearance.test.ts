import { expect, test } from 'bun:test'
import { generateMotion, type MotionVariant } from '../../plugin/hooks/motion'

// Derive complete half/closed/half episodes from the actual rendered tracks.
export function blinkEpisodes(model: ReturnType<typeof generateMotion>) {
  const tracks=model.layers.filter(l=>l.loop&&['face:half','face:blink'].includes(l.name))
  const intervals=tracks.flatMap(l=>l.points.flatMap((p,i)=>p.value===1&&l.points[i+1]!.at>p.at?[{start:p.at,end:l.points[i+1]!.at}]:[]))
  return model.blinks.map(start=>{
    let end=start
    for(let i=0;i<intervals.length;i++)for(const span of intervals)if(span.start<=end+1e-7&&span.end>end&&span.start>=start-1e-7)end=span.end
    return{start,end}
  })
}
for(const mood of ['think','work']as const)for(const variant of [0,1,2]as MotionVariant[])test(`${mood}/${variant} actual full blink clears every obstacle by 300 ms on both sides`,()=>{
  const model=generateMotion(mood,variant)
  const half=model.layers.find(l=>l.loop&&l.name==='face:half')!
  const workTrack=model.layers.find(l=>l.name==='work-b')
  const returnCut=workTrack?.points.some((p,i)=>p.at===model.duration-30&&p.value===1&&workTrack.points[i+1]?.value===0)
  const obstacles=mood==='work'?[...model.swaps.map(at=>({name:'stroke',start:at+30,end:at+30})),...(returnCut?[{name:'return',start:model.duration-30,end:model.duration-30}]:[])]:[
    ...model.shift.map(at=>({name:'turn',start:at+55-400,end:at+55+300})),
    ...model.deepThoughts.map(at=>({name:'deep-thought',start:at,end:half.points.find(p=>p.at>at&&p.value===0)!.at})),
  ]
  for(const episode of blinkEpisodes(model))for(const cycle of [-1,0,1])for(const obstacle of obstacles){
    const start=obstacle.start+cycle*model.duration,end=obstacle.end+cycle*model.duration
    expect({mood,variant,episode,obstacle,cycle,clear:episode.end<=start-300+1e-7||episode.start>=end+300-1e-7}).toEqual({mood,variant,episode,obstacle,cycle,clear:true})
  }
})
