import { d1Art } from './d1-art-data'
// SPEC 3.5: exact emblems.py shed_emblem grid and kit colours, drawn as pixels.
let source:string|undefined
export function shedRowSvg():string{
 if(source)return source
 const {snake,skin,palette}=d1Art('shed')
 let body='';for(const [rows,dx,dy]of [[snake,0,0],[skin,17,10]] as const)for(let y=0;y<rows.length;y++)for(let x=0;x<rows[y]!.length;x++){const fill=palette[rows[y]![x]!];if(fill)body+=`<rect x="${x+dx}" y="${y+dy}" width="1" height="1" fill="${fill}"/>`}
 return source=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 26 15" width="26" height="15" style="image-rendering:pixelated;forced-color-adjust:none" shape-rendering="crispEdges">${body}</svg>`
}
