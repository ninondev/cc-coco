import {desktopPicture,PERSON,P} from './world'
type Stop={at:number;opacity:number;visibility:string}
function pixelFrames(source:string,name:string):Stop[]{
 const start=source.indexOf('@keyframes '+name+'{');if(start<0)throw new Error('Missing emitted pixel keyframes: '+name)
 let at=source.indexOf('{',start)+1,depth=1,end=at
 for(;end<source.length&&depth;end++){if(source[end]==='{')depth++;else if(source[end]==='}')depth--}
 if(depth)throw new Error('Unclosed emitted pixel keyframes: '+name)
 const frames=[...source.slice(at,end-1).matchAll(/([\d.]+)%\{([^}]*)\}/g)].map(m=>({at:Number(m[1]),opacity:Number(/\bopacity:([\d.]+)/.exec(m[2]!)?.[1]),visibility:/\bvisibility:([a-z]+)/.exec(m[2]!)?.[1]??''}))
 if(!frames.length||frames[0]!.at!==0||frames.at(-1)!.at!==100||frames.some((frame,i)=>!Number.isFinite(frame.opacity)||!['visible','hidden'].includes(frame.visibility)||i>0&&frame.at<=frames[i-1]!.at))throw new Error('Invalid emitted pixel keyframes: '+name)
 return frames
}
// Evaluate the emitted finite steps(1,end) track, including its negative delay
// and both fill. This is an SVG/CSS source observer, not a host paint probe.
export function sampleD1PixelSource(source:string,elapsedSinceReturn=0):{source:string;layers:number[];tracks:{layer:number;duration:number;delay:number;frames:Stop[]}[]}{
 if(!source.includes('data-d1-pixel-timeline="1600"'))return {source,layers:[],tracks:[]}
 const hidden:{start:number;end:number}[]=[],layers:number[]=[],tracks:{layer:number;duration:number;delay:number;frames:Stop[]}[]=[],visible:string[]=[]
 for(const match of source.matchAll(/<g data-d1-pixel-layer="(\d+)" style="([^"]*)">/g)){
  const layer=Number(match[1]),animation=/animation:(d1pixel\d+) ([\d.]+)ms steps\(1,end\) (-?[\d.]+)ms both/.exec(match[2]!)
  if(!animation)throw new Error('Unsupported emitted pixel animation')
  const duration=Number(animation[2]),delay=Number(animation[3]);if(!(duration>0))throw new Error('Invalid pixel duration')
  const frames=pixelFrames(source,animation[1]!),progress=Math.min(100,Math.max(0,(elapsedSinceReturn-delay)/duration*100))
  const held=frames.filter(frame=>frame.at<=progress).at(-1)!
  tracks.push({layer,duration,delay,frames})
  let at=match.index!+match[0].length,depth=1,end=at
  for(const tag of source.slice(at).matchAll(/<\/?g\b[^>]*>/g)){if(tag[0].startsWith('</'))depth--;else if(!tag[0].endsWith('/>'))depth++;if(!depth){end=at+tag.index!;break}}
  if(depth)throw new Error('Unclosed pixel layer')
  if(held.visibility==='visible'&&held.opacity>0){layers.push(layer);visible.push(source.slice(at,end))}else hidden.push({start:match.index!,end:end+4})
 }
 let effective=source;for(const range of hidden.sort((a,b)=>b.start-a.start))effective=effective.slice(0,range.start)+effective.slice(range.end)
 return {source:effective,layers,tracks}
}
export function effectiveD1DesktopPixel(_on:any,now:()=>number){
 let engine:any
 async function receipt(){
  if(!engine)throw new Error('Owned return timing fixture was not enabled before mounting')
  const rows=JSON.parse((await engine.command.run({command:'d1-fixture-owned-render-receipt',args:JSON.stringify(['AbovePrompt',null,'desktop']),origin:PERSON,presentation:P})).text)
  if(!Array.isArray(rows)||rows.length!==1||rows[0].count<=0||rows[0].at===null||!Number.isFinite(rows[0].at))throw new Error('Actual owned AbovePrompt return clock is absent or ambiguous')
  return rows[0]
 }
 async function sample(ui:any){
  const source=String((await desktopPicture(ui))?.props.source),owned=await receipt()
  return sampleD1PixelSource(source,now()-owned.at)
 }
 return {enable:async($:any)=>{engine=$;const timing=JSON.parse((await $.command.run({command:'d1-fixture-owned-render-clock',args:'enable',origin:PERSON,presentation:P})).text);if(timing.enabled!==true)throw new Error('Actual owned return timing did not enable')},sample,source:async(ui:any)=>(await sample(ui)).source}
}
