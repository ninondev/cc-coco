export const RIBBON_PALETTE = [
  ['#2E5C8A','#86AEDB',25,110],['#8C6100','#E3B04B',94,179],['#5F5E66','#ABAAB3',59,248],['#3F7A2E','#8CC474',28,114],['#0F6F78','#5CC2C7',23,73],['#A8366F','#EE93C1',125,175],['#6A4FA0','#B9A2E6',61,183],
] as const
export const EMPTY_12x1='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 1" width="12" height="1" style="forced-color-adjust:none"></svg>'
export function validRibbon(value:unknown):value is number{return typeof value==='number' && Number.isInteger(value) && value>=1 && value<=14}
export function selectRibbon(remembered:unknown,taken:readonly number[]):number {
  const used=new Set(taken)
  if(validRibbon(remembered) && !used.has(remembered))return remembered
  for(let n=1;n<=14;n++)if(!used.has(n))return n
  // Beyond fourteen sessions the palette repeats, in allocation order.
  return (taken.length%14)+1
}
export function rememberRibbon(map:Record<string,number>,folder:string,index:number):Record<string,number>{
  const entries=Object.entries(map).filter(([,n])=>validRibbon(n))
  if(entries.some(([key])=>key===folder))return Object.fromEntries(entries.slice(-64))
  return Object.fromEntries([...entries,[folder,index]].slice(-64))
}
export type RibbonClaim={id:string;at:number;ribbon?:number}
export function reconcileRibbon(own:RibbonClaim,live:readonly RibbonClaim[]):number {
  const claims=[...live.filter(c=>c.id!==own.id&&validRibbon(c.ribbon)),own].sort((a,b)=>a.at-b.at||(a.id<b.id?-1:a.id>b.id?1:0))
  const assigned:number[]=[]
  for(const [i,claim]of claims.entries()){
    const current=claim.ribbon
    const chosen=validRibbon(current)&&!assigned.includes(current)?current:selectRibbon(undefined,[...assigned,...claims.slice(i+1).map(c=>c.ribbon).filter(validRibbon)])
    if(claim.id===own.id)return chosen
    assigned.push(chosen)
  }
  return selectRibbon(undefined,live.map(c=>c.ribbon).filter(validRibbon))
}
export function ribbonFolder(cwd:string,home?:string):string {if(cwd===home)return '~';const path=cwd.replace(/[\\/]+$/,'');return path.split(/[\\/]/).pop()||path}
export function ribbonTerminal(index:number,dark:boolean):{color:number;rows:readonly string[]} {const p=RIBBON_PALETTE[(index-1)%7]!;return {color:p[dark?3:2],rows:['●','▐','▐','▐','▐','▐','▝']}}
