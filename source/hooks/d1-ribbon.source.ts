import { d1Art } from './d1-art-data'
import { RIBBON_PALETTE, EMPTY_12x1, validRibbon, ribbonTerminal } from './d1-ribbon-core'
const cache=new Map<string,string>()
function shade(hex:string,f:number):string{return '#'+[1,3,5].map(i=>{const c=parseInt(hex.slice(i,i+2),16);return Math.round(f<0?c*(1+f):c+(255-c)*f).toString(16).padStart(2,'0').toUpperCase()}).join('')}
export function ribbonSvg(index:number,height:number,tie=false,width=12,elapsed=0):string {
  if(!validRibbon(index))return EMPTY_12x1
  elapsed=Math.max(0,Math.floor(elapsed))
  const key=`${index}:${height}:${tie}:${width}:${elapsed}`;const held=cache.get(key);if(held)return held
  const [light,dark]=RIBBON_PALETTE[(index-1)%7]!,w=width===12?10:width,cx=w/2,y0=4.6,n=Math.min(4.4,height*.12),t=2.7
  const tones=(c:string,d:boolean)=>`.c{fill:${c}}.e{stroke:${shade(c,d?-.22:-.28)}}.s{stroke:${shade(c,d?.42:.38)}}.k{fill:${shade(c,d?-.12:-.15)}}.p{fill:${shade(c,d?-.38:.62)}}`
  let css=tones(light,false)+'@media (prefers-color-scheme:dark){'+tones(dark,true)+'}'
  if(tie)css+=d1Art('ribbon').tie+`.b{transform-origin:${cx}px 3.3px;animation:knot 200ms cubic-bezier(0,0,.2,1) ${-elapsed}ms both}.t{transform-origin:${cx}px 4.6px;animation:drop 300ms cubic-bezier(0,0,.2,1) ${110-elapsed}ms both,sway 520ms cubic-bezier(.37,0,.63,1) ${390-elapsed}ms both}@media (prefers-reduced-motion:reduce){.b,.t{animation:none}}`
  const f=(v:number)=>v.toFixed(2)
  const stripe=index>=8?`<path class="p" d="M${f(cx-.6)} ${f(y0+1)}H${f(cx+.6)}V${f(height-n-1)}H${f(cx-.6)}Z"/>`:''
  const source=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="forced-color-adjust:none"><style>${css}</style><g class="t"><path class="c" d="M${f(cx-t)} ${y0}H${f(cx+t)}V${height}L${cx} ${f(height-n)}L${f(cx-t)} ${height}Z"/>${stripe}<path class="s" d="M${f(cx-t+1.5)} ${y0+.6}V${f(height-n-.8)}" stroke-width="0.6" opacity=".5"/><path class="e" d="M${f(cx-t+.25)} ${y0}V${f(height-.6)}M${f(cx+t-.25)} ${y0}V${f(height-.6)}" stroke-width="0.5" fill="none"/></g><g class="b"><path class="c e" d="M${f(cx-1.4)} 3.6L${f(cx-3.9)} 6.9L${f(cx-2.4)} 7.4L${f(cx-.6)} 4.8Z" stroke-width="0.5"/><circle class="k e" cx="${cx}" cy="3.3" r="2.3" stroke-width="0.55"/><path class="s" d="M${f(cx-1)} 2.6Q${cx} 1.6 ${f(cx+1.1)} 2.7" stroke-width="0.6" fill="none" opacity=".7"/></g></svg>`
  if(cache.size>=64)cache.delete(cache.keys().next().value!);cache.set(key,source);return source
}
const terminalCells = new Map<string,string>()
export function ribbonTerminalCells(index:number,dark:boolean,rows=9):string {
  const key=`${index}:${dark}:${rows}`,held=terminalCells.get(key);if(held)return held
  const ribbon=ribbonTerminal(index,dark),n=ribbon.color
  const levels=[0,95,135,175,215,255]
  let rgb:number
  if(n>=232){const c=8+(n-232)*10;rgb=(c<<16)|(c<<8)|c}
  else {const c=n-16;rgb=(levels[Math.floor(c/36)]!<<16)|(levels[Math.floor(c/6)%6]!<<8)|levels[c%6]!}
  const bytes=new Uint8Array(rows*12),view=new DataView(bytes.buffer)
  for(let y=0;y<rows;y++){const glyph=rows===1?'▐':ribbon.rows[y]??' ';view.setUint32(y*12,glyph.charCodeAt(0),true);view.setUint32(y*12+4,glyph===' '?0x01000000:rgb,true);view.setUint32(y*12+8,0x01000000,true)}
  const encoded=btoa(String.fromCharCode(...bytes));terminalCells.set(key,encoded);return encoded
}
