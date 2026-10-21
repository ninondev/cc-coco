export function resumeD1Picture(source:string,age:{shedElapsed?:number;transitionElapsed?:number;glanceElapsed?:number}):string{
 return source.replace(/animation:(d1shedReveal|d1shedFade|d1shedGleam|d1page[012]|d1dip|d1old|d1new|d1glance|d1pixel[0-3])( \d+(?:\.\d+)?ms (?:linear|steps\(1,end\)|cubic-bezier\([^)]*\)) )-?[\d.]+ms both/g,(whole,name:string,timing:string)=>{
  const elapsed=name==='d1glance'?age.glanceElapsed:['d1dip','d1old','d1new'].includes(name)?age.transitionElapsed:age.shedElapsed
  if(elapsed===undefined)return whole
  const start=name==='d1shedFade'?(timing.startsWith(' 200ms ')?600:520):name==='d1shedGleam'?250:name.startsWith('d1page')?[520,620,740][Number(name.at(-1))]!:0
  return `animation:${name}${timing}${String(Number((start-Math.max(0,elapsed)).toFixed(5)))}ms both`
 })
}
