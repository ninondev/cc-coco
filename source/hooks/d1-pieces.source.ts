import { d1Art } from './d1-art-data'
// Exact pieces.py geometry. New motion lives in each picture, never a polling loop.
type Options={arrivalDelay?:number;leave?:'done'|'failed';elapsed?:number;reduced?:boolean}
const cache=new Map<string,string>()
function motion(o:Options):string{
 if(o.reduced)return ''
 const elapsed=Math.max(0,o.elapsed??0),a=d1Art('helpers')
 if(o.leave)return a[o.leave]+(-elapsed)+'ms both}'
 return o.arrivalDelay===undefined?'':a.arrive+(o.arrivalDelay-elapsed)+'ms both}'
}
function remember(key:string,value:()=>string):string{let v=cache.get(key);if(v!==undefined)return v;v=value();if(cache.size>=64)cache.delete(cache.keys().next().value!);cache.set(key,v);return v}
function wrap(width:number,body:string,css=''):string{return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 18" width="${width}" height="18"><style>svg{forced-color-adjust:none}${d1Art('helpers').palette}${css}@media(prefers-reduced-motion:reduce){.g{animation:none}}</style><g class="g">${body}</g></svg>`}
export function scrollSvg(o:Options={}):string{return remember('scroll'+JSON.stringify(o),()=>wrap(12,d1Art('helpers').paper,motion(o)))}
export function lyingScrollSvg(failed=false):string{return remember('lying'+failed,()=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 9" width="18" height="9"><style>svg{forced-color-adjust:none}${d1Art('helpers').palette}</style><g transform="translate(18 0) rotate(90)" opacity="${failed?.55:1}">${d1Art('helpers').paper}</g></svg>`)}
export function bundleSvg(o:Options={}):string{return remember('bundle'+JSON.stringify(o),()=>{const one=(x:number,y:number,h:number)=>`<rect x="${x+.8}" y="${y+1.4}" width="4.4" height="${h-2.8}" fill="#FAEEE9" class="e" stroke-width=".6"/><rect class="o" x="${x}" y="${y}" width="6" height="1.5" rx=".5"/><rect class="o" x="${x}" y="${y+h-1.5}" width="6" height="1.5" rx=".5"/>`;return wrap(18,one(.2,2.4,15.2)+one(8.8,2.4,15.2)+one(4.5,.6,17)+'<path d="M.6 9.2Q7.5 11.4 14.4 9.2" stroke="#C75730" stroke-width="1.3" fill="none"/><circle cx="7.5" cy="10.3" r="1" fill="#C75730"/>',motion(o))})}
export const EMPTY_RIBBON='<svg xmlns="http://www.w3.org/2000/svg" width="12" height="1"></svg>'
