import type { EngineInterface } from 'claude-code'
import { joinPath } from './paths'
import { d1Text } from './d1-words'
import type { D1Words } from './d1-words'
// Their room on the book's page (owner 10-16: the room lane A drew, tools/art/coco-room.py, plugin/assets/coco-room).
// One thing grows: a sock on the drying line for each pair in their drawer. The thermos stands on the desk while the
// cache is kept warm, the desk lamp is lit at night, and they stand, type on the floor while Claude works, or sleep.
// With the bag's form set to Claudie (maid Claudie too) or 克劳鱼, she stands in Coco's place whatever Claude is doing:
// they only have a standing figure, and the laptop stays on the desk (owner 10-19, DECISIONS 1049, 1052).
export type RoomForm = 'claudie'|'fish'
export type RoomState = { hour: 'day'|'eve'|'night'; pose: 'reading'|'writing'|'asleep'; socks: readonly string[]; warm: boolean; visitor?: string; form?: RoomForm }
type Layer = { x:number; y:number; width:number; height:number; filtered:boolean; png:Record<string,string> }
type Layers = Record<string,Layer>
type SockLine = { x:number; y:number; step:number }
const FOLDER = 'coco-room'
const VISIT = { x: 94, floor: 82 }   // a visitor waits on the floor beside them, as on the band
let manifest: Layers | undefined
let line: SockLine = { x: 13, y: 9, step: 3 }
let loading: Promise<void> | undefined
let generation = 0
const png = new Map<string,string>()
const cache = new Map<string,string>()
export function roomState(now:number,timeZone:string|undefined,asleep:boolean,running:boolean,things:{socks?:readonly string[];warm?:boolean;visitor?:string;form?:unknown}={}):RoomState {
  const form:RoomForm|undefined=things.form==='dake'||things.form==='maid'?'claudie':things.form==='fish'?'fish':undefined
  let hour:number
  try { hour=Number(new Intl.DateTimeFormat('en-US',{hour:'numeric',hourCycle:'h23',timeZone}).formatToParts(new Date(now)).find(p=>p.type==='hour')?.value)%24 } catch { hour=new Date(now).getHours() }
  return { hour:hour>=6 && hour<17?'day':hour>=17 && hour<19?'eve':'night',pose:asleep?'asleep':running?'writing':'reading',socks:[...(things.socks??[])].slice(0,12),warm:things.warm===true,...(things.visitor?{visitor:things.visitor}:{}),...(form?{form}:{}) }
}
export function roomLayerNames(state:RoomState):string[] {
  const night=state.hour==='night'
  const out=[`sky-${state.hour}`,`room-${state.hour}`,'line',...state.socks.map((pair,i)=>`sock-${pair}#${i}`),'ac','notes',night?'lamp-night':'lamp-day','mug']
  if(state.warm)out.push('thermos')
  if(state.pose!=='writing'||state.form)out.push('laptop')          // typing, Coco has it with her on the floor
  out.push('duck','teapot','flowers','mirror','box','cup')
  if(night)out.push('lamp-light')
  out.push(state.form?`${state.form}-stand`:`her-${state.pose==='writing'?'type':state.pose==='asleep'?'sleep':'stand'}`)
  if(state.visitor)out.push(`visitor-${state.visitor}`)
  if(state.visitor==='usb' && state.hour!=='day')out.push('visitor-usb-lit')
  return out
}
export function loadRoomLayers($:Pick<EngineInterface,'fs'|'plugin'>):Promise<void> {
  if(manifest)return Promise.resolve()
  if(loading)return loading
  const own=generation
  loading=(async()=>{
    const value=JSON.parse(await $.fs.read(joinPath($.plugin.root,'assets',FOLDER,'layers.json'))) as {layers:Layers;socks?:SockLine}
    const images=new Map<string,string>()
    // Loads only once while His page is open; no host reads in roomSvg.
    for(const layer of Object.values(value.layers))for(const file of Object.values(layer.png))images.set(file,(await $.fs.read(joinPath($.plugin.root,'assets',FOLDER,file),{as:'bytes'})).base64)
    // Today's visitors sit in the room as ordinary layers; a missing or damaged file leaves the room as it was.
    try {
      const art=JSON.parse(await $.fs.read(joinPath($.plugin.root,'hooks','visitor-art.json'))) as {kinds?:Record<string,{w:number;h:number;room:{x:number;y:number;1:string;2:string};lit?:{x:number;y:number;w:number;h:number;1:string;2:string}}>}
      const add=(name:string,x:number,y:number,width:number,height:number,filtered:boolean,one:string,two:string)=>{value.layers[name]={x,y,width,height,filtered,png:{'1':`${name}@1.png`,'2':`${name}@2.png`}};images.set(`${name}@1.png`,one);images.set(`${name}@2.png`,two)}
      for(const [kind,k] of Object.entries(art.kinds??{})){
        const x=VISIT.x,y=VISIT.floor-k.h
        add(`visitor-${kind}`,x,y,k.w,k.h,true,k.room[1],k.room[2])
        if(k.lit)add(`visitor-${kind}-lit`,x+k.lit.x-k.room.x,y+k.lit.y-k.room.y,k.lit.w,k.lit.h,false,k.lit[1],k.lit[2])
      }
    } catch { /* no visitors drawn */ }
    if(own!==generation)return
    manifest=value.layers;if(value.socks)line=value.socks;for(const [file,source] of images)png.set(file,source)
  })().finally(()=>{if(own===generation)loading=undefined})
  return loading
}
export function roomSvg(state:RoomState,s:1|2):string {
  const names=roomLayerNames(state),key=`${s}:${names.join(',')}`
  const held=cache.get(key);if(held)return held
  if(!manifest)return ''
  const night=state.hour==='night'
  const out=[`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90" width="${160*s}" height="${90*s}" style="forced-color-adjust:none">`]
  if(night)out.push('<defs><filter id="n" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0.70 0 0 0 0 0 0.72 0 0 0 0 0 0.84 0 0 0 0 0 1 0"/></filter></defs>')
  let group=false
  // few socks hang wide apart, a full line close together
  const step=state.socks.length<=6?2*line.step:line.step
  for(const name of names){
    const [base,slot]=name.split('#'),layer=manifest[base!];if(!layer)continue
    const x=slot===undefined?layer.x:line.x+Number(slot)*step
    if(night && layer.filtered && !group){out.push('<g filter="url(#n)">');group=true}
    if(night && !layer.filtered && group){out.push('</g>');group=false}
    out.push(`<image x="${x}" y="${layer.y}" width="${layer.width}" height="${layer.height}" href="data:image/png;base64,${png.get(layer.png[String(s)]!)??''}"/>`)
  }
  if(group)out.push('</g>');out.push('</svg>')
  const source=out.join('');cache.set(key,source);return source
}
// Lane B's words for the room (d546c04a): the hour and her pose, then the things that change: the socks on the line,
// the thermos while keep-warm is on, the desk lamp lit at night.
export function roomAlt(state:RoomState,words:D1Words):string {
  const values={hour:d1Text(words,`room.alt.hour.${state.hour==='eve'?'dusk':state.hour}`),pose:d1Text(words,`room.alt.pose.${state.form?'reading':state.pose}`),who:d1Text(words,`room.alt.who.${state.form??'coco'}`)}
  const things=[
    ...(state.socks.length?[d1Text(words,'room.alt.socks',{n:state.socks.length})]:[]),
    ...(state.warm?[d1Text(words,'room.alt.thermos')]:[]),
    ...(state.hour==='night'?[d1Text(words,'room.alt.lampLit')]:[]),
  ]
  return things.length?d1Text(words,'room.alt.withThings',{...values,things:things.join(d1Text(words,'room.alt.sep'))}):d1Text(words,'room.alt.base',values)
}
export function roomScale(bodyWidth:number):1|2 {return bodyWidth>=340?2:1}
export function forgetRoom():void {generation++;manifest=undefined;loading=undefined;png.clear();cache.clear()}
export function roomCacheSize():number {return cache.size}
