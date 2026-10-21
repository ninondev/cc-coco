import {STILL_SIZES,FRAME_OVERLAY_OFFSET_X} from './motion-stills'
import {joinPath} from './paths'
import {sampleSpring} from './motion'
type IO={root:string;read:(path:string,options:{as:'bytes'})=>Promise<{base64:string}>;run:(argv:string[],options:{stdin:string})=>Promise<{exitCode:number;stdout:string}>}
let skin=''
const pixel=new Map<string,{png:string;cells:string;cells256:string}>()
let loading:Promise<void>|undefined
export function loadD1Shed(api:IO):Promise<void>{
 if(loading)return loading
 loading=(async()=>{
  skin=(await api.read(joinPath(api.root,'assets/shed/band-skin.png'),{as:'bytes'})).base64
  const paths:Record<string,string>={}
  for(const [i,name]of ['shed-a','shed-b','shed-c'].entries()){const path=joinPath(api.root,`assets/pixel/${42+i}-${name}.png`);const image=await api.read(path,{as:'bytes'});pixel.set(name,{png:image.base64,cells:'',cells256:''});paths[name]=path}
  // The cells came from hooks/pose-pixels.mjs, which left with the old pictures (DECISIONS 947); the shed itself
  // goes with assets/shed in the later batch.
 })().catch(()=>{loading=undefined})
 return loading
}
export function d1PixelFrame(elapsed:number,reduced=false):string{return reduced?'snake':elapsed<160?'shed-a':elapsed<360?'shed-b':elapsed<960?'shed-c':'snake'}
export function d1Pixel(name:string,colors:'truecolor'|'256'='truecolor'): {png:string;cells:string}|undefined{const p=pixel.get(name);return p?{png:p.png,cells:colors==='256'?p.cells256:p.cells}:undefined}
// Section 3.9's values are already in 151 pixels. Express the old-frame origin
// once; only B2f's generated offset can translate the overlays to a shipped size.
export function frameOverlayX(x137:number,offset:number=FRAME_OVERLAY_OFFSET_X):number{return x137+offset}
const f=(n:number)=>String(Number(n.toFixed(5)))
// Motion pictures carry separate normal and reduced branches. Put an overlay
// inside the frame's transform chain, never inside a hidden fallback by accident.
function paintBranches(source:string,normal:string,reduced:string):string{
 type Group={name:string;parent?:Group;end?:number}
 const groups:Group[]=[],stack:Group[]=[]
 for(const match of source.matchAll(/<\/?g\b[^>]*>/g)){
  const tag=match[0]
  if(tag.startsWith('</g')){const group=stack.pop();if(group)group.end=match.index}
  else if(!tag.endsWith('/>')){const group:Group={name:/class="([^"]+)"/.exec(tag)?.[1]??'',parent:stack.at(-1)};groups.push(group);stack.push(group)}
 }
 const active=groups.find(g=>g.name==='moroot'||g.name==='c3animated'),still=groups.find(g=>g.name==='mostill'||g.name==='c3still')
 if(!active)return source.replace(/<\/svg>$/,normal+'</svg>')
 const inActive=(group:Group)=>{for(let held:Group|undefined=group;held;held=held.parent)if(held===active)return true;return false}
 const target=groups.filter(g=>['mosway','mobreath','moshift','mogesture'].includes(g.name)&&inActive(g)).at(-1)??active
 const inserts=[{at:target.end,value:normal},{at:still?.end,value:reduced}].filter((x):x is {at:number;value:string}=>x.at!==undefined).sort((a,b)=>b.at-a.at)
 for(const insert of inserts)source=source.slice(0,insert.at)+insert.value+source.slice(insert.at)
 return source
}
// Cached frame bytes stay stable. Each mounted picture resumes only D1's
// finite overlays from the event clock, leaving the frame's own motion alone.
export function shedTransition(source:string,previous:string,elapsed:number,reduced=false):string{
 if(reduced||elapsed>=755)return source
 const body=(svg:string)=>svg.replace(/^<svg\b[^>]*>/,'').replace(/<\/svg>$/,'')
 const root=source.match(/^<svg\b[^>]*>/)?.[0];if(!root)return source
 const values=[{at:0,y:1},{at:55,y:.975}]
 for(let t=1000/60;t<700;t+=1000/60)values.push({at:55+t,y:sampleSpring(.975,t,{mass:.5,stiffness:220,damping:12.6})})
 values.push({at:755,y:1})
 const frames=values.map(({at,y})=>`${f(at/755*100)}%{transform:scale(${f(1-(y-1)*.3)},${f(y)})${at===0?';animation-timing-function:cubic-bezier(0,0,.2,1)':''}}`).join('')
 const cut=f(55/755*100),css=`@keyframes d1dip{${frames}}@keyframes d1old{0%{opacity:1}${cut}%,100%{opacity:0}}@keyframes d1new{0%{opacity:0}${cut}%,100%{opacity:1}}`
 return root+`<style>${css}</style><g style="transform-origin:${frameOverlayX(68.5)}px 128px;animation:d1dip 755ms linear ${-elapsed}ms both"><g style="animation:d1old 755ms steps(1,end) ${-elapsed}ms both">${body(previous)}</g><g style="animation:d1new 755ms steps(1,end) ${-elapsed}ms both">${body(source)}</g></g></svg>`
}
export function isD1PixelTimeline(source:string):boolean{return source.includes('data-d1-pixel-timeline="1600"')&&[0,1,2,3].every(i=>source.includes(`data-d1-pixel-layer="${i}"`)&&source.includes(`@keyframes d1pixel${i}{`))}
function pixelShedPicture(source:string,elapsed:number):string|undefined{
 const root=source.match(/^<svg\b[^>]*>/)?.[0],frames=['shed-a','shed-b','shed-c'].map(name=>d1Pixel(name))
 if(!root||frames.some(frame=>!frame))return undefined
 const cuts=[0,10,22.5,60,100]
 const css=[0,1,2,3].map(i=>`@keyframes d1pixel${i}{`+cuts.map((cut,j)=>`${cut}%{opacity:${Math.min(j,3)===i?1:0};visibility:${Math.min(j,3)===i?'visible':'hidden'}}`).join('')+'}').join('')
 const body=source.slice(root.length).replace(/<\/svg>$/,'')
 const layers=[...frames.map(frame=>`<image href="data:image/png;base64,${frame!.png}" width="35" height="32" style="image-rendering:pixelated"/>`),body]
 return root+`<style>${css}</style><g data-d1-pixel-timeline="1600">`+layers.map((layer,i)=>`<g data-d1-pixel-layer="${i}" style="animation:d1pixel${i} 1600ms steps(1,end) ${-Math.max(0,elapsed)}ms both">${layer}</g>`).join('')+'</g></svg>'
}
export function shedPicture(source:string,elapsed:number,reduced=false,pixelBand=false,finitePixelCSS=true):string{
 if(pixelBand&&!reduced&&finitePixelCSS&&elapsed<1600){const timeline=pixelShedPicture(source,elapsed);if(timeline)return timeline}
 if(pixelBand){const name=d1PixelFrame(elapsed,reduced),p=d1Pixel(name);if(!p)return source;const root=source.match(/^<svg\b[^>]*>/)?.[0];return root?root+`<image href="data:image/png;base64,${p.png}" width="35" height="32" style="image-rendering:pixelated"/></svg>`:source}
 if(!skin)return source
 const x=frameOverlayX(119),centres=[[127,120],[132.5,118],[138,117.5]],dots=[[92,78,1.3],[98,75.5,.9]],delay=-Math.max(0,elapsed)
 let css='svg{forced-color-adjust:none}@keyframes d1shedReveal{from{transform:scaleX(0)}to{transform:scaleX(1)}}@keyframes d1shedFade{from{opacity:1}to{opacity:0}}'
 const calm=`<image href="data:image/png;base64,${skin}" x="${x}" y="111" width="24" height="15" style="animation:d1shedFade 200ms linear ${600+delay}ms both"/>`
 let overlay=`<defs><clipPath id="d1-shed-clip"><rect x="${x}" y="111" width="25" height="15" style="transform-origin:${x}px 111px;animation:d1shedReveal 250ms cubic-bezier(0,0,.2,1) ${delay}ms both"/></clipPath></defs><g clip-path="url(#d1-shed-clip)" style="animation:d1shedFade 350ms linear ${520+delay}ms both"><image href="data:image/png;base64,${skin}" x="${x}" y="111" width="24" height="15"/></g>`
 if(reduced)overlay=calm
 else {
  css+='@keyframes d1shedGleam{'+Array.from({length:101},(_,i)=>`${i}%{opacity:${f(Math.floor(255*Math.sin(Math.PI*i/100))/255)}}`).join('')+'}'
  overlay+=dots.map(([a,b,r])=>`<circle cx="${frameOverlayX(a!)}" cy="${b}" r="${r}" fill="#fff" style="transform-origin:${frameOverlayX(a!)}px ${b}px;animation:d1shedGleam 500ms linear ${250+delay}ms both"/>`).join('')
  for(const [i,[cx,cy]]of centres.entries()){
   const start=[520,620,740][i]!,duration=[900,960,860][i]!,drift=[-1,.6,1.4][i]!,name='d1page'+i
   let frames='';for(let step=0;step<=30;step++){const u=step/30,t=duration*u,op=t<80?t/80:u<.6?1:(1-u)/.4;frames+=`${f(u*100)}%{transform:translate(${f(drift*5*(Math.sin(1.4*Math.PI*u)+.8*u))}px,${f(42*Math.pow(u,1.6))}px) rotate(${f(Math.sign(drift)*(12+30*u))}deg);opacity:${f(op)}}`}
   css+=`@keyframes ${name}{${frames}}`
   overlay+=`<g transform="translate(${frameOverlayX(cx!)},${cy})"><g style="animation:${name} ${duration}ms linear ${start+delay}ms both"><rect x="-5" y="-6" width="10" height="12" fill="#F9EDD9" stroke="#3C251D"/><path d="M-3 -2.5h6M-3 .5h5M-3 3.5h3" stroke="#D2C3B3"/></g></g>`
  }
 }
 const bounds=`<defs><clipPath id="d1-frame-clip"><rect width="${STILL_SIZES.desktop_size[0]}" height="128"/></clipPath></defs>`
 const painted=`<g clip-path="url(#d1-frame-clip)">${overlay}</g>`
 source=source.replace('<svg ',`<svg `).replace(/(<svg\b[^>]*>)/,`$1<style>${css}</style>`)
 return paintBranches(source.replace(/(<svg\b[^>]*>)/,`$1${bounds}`),painted,`<g clip-path="url(#d1-frame-clip)">${calm}</g>`)
}
