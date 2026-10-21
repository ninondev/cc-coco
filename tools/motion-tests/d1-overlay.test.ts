import {sampleD1PixelSource} from './d1-visible-pixel-fixture'
import {test,expect} from 'bun:test'
import {frameOverlayX,d1PixelFrame,loadD1Shed,shedPicture,resumeD1Picture} from '../../plugin/hooks/d1-pictures'
import {c3NextMotion} from '../../plugin/hooks/c3-motion'
import {LineSlot} from '../../plugin/hooks/line-slot'
test('D1 old137 and shipped151 positions use the generated translation arithmetic',()=>{
 for(const [old,wide]of [[119,126],[92,99],[98,105],[127,134],[132.5,139.5],[138,145]]){expect(frameOverlayX(old!,0)).toBe(old!);expect(frameOverlayX(old!,7)).toBe(wide!)}
})
test('D1 terminal shed cuts obey the exact end timeline and reduced still',()=>{
 expect([0,159,160,359,360,959,960].map(t=>d1PixelFrame(t))).toEqual(['shed-a','shed-a','shed-b','shed-b','shed-c','shed-c','snake']);expect(d1PixelFrame(100,true)).toBe('snake')
})
test('D1 glance gets only its two cut boundaries on timer-driven surfaces',()=>{
 const pose={name:'ribbon-glance',frame:'idle-reading',aside:'',at:0};expect(c3NextMotion(pose,0)).toBe(120);expect(c3NextMotion(pose,120)).toBe(600);expect(c3NextMotion(pose,720)).toBeUndefined()
})
test('D1 cached overlays resume their current age without restarting unrelated frame motion',()=>{
 const source='<svg><g style="animation:d1shedReveal 250ms cubic-bezier(0,0,.2,1) 0ms both;animation:d1shedFade 350ms linear 520ms both;animation:d1page1 960ms linear 620ms both;animation:d1glance 720ms steps(1,end) 0ms both;animation:idle 3000ms linear 0ms infinite both"/></svg>'
 const resumed=resumeD1Picture(source,{shedElapsed:700,glanceElapsed:400})
 expect(resumed).toContain('cubic-bezier(0,0,.2,1) -700ms both');expect(resumed).toContain('d1shedFade 350ms linear -180ms both');expect(resumed).toContain('d1page1 960ms linear -80ms both');expect(resumed).toContain('d1glance 720ms steps(1,end) -400ms both');expect(resumed).toContain('idle 3000ms linear 0ms infinite both')
 expect(resumeD1Picture('<g style="animation:d1dip 755ms linear 0ms both"/>',{transitionElapsed:200})).toContain('linear -200ms both')
})
test('D1 pixel cuts replace the visible picture even when the source starts with image definitions',async()=>{
 await loadD1Shed({root:'/fixture',read:async path=>({base64:path.endsWith('42-shed-a.png')?'CUT_A':path.endsWith('43-shed-b.png')?'CUT_B':path.endsWith('44-shed-c.png')?'CUT_C':'SKIN'}),run:async()=>({exitCode:0,stdout:'{}'})})
 const source='<svg viewBox="0 0 35 32" width="28" height="26"><defs><image id="unused" href="data:image/png;base64,OLD"/></defs><use href="#unused"/></svg>'
 const raw=shedPicture(source,0,false,true),cut=sampleD1PixelSource(raw).source
 expect(cut).toContain('base64,CUT');expect(cut).not.toContain('OLD');expect(cut).not.toContain('<use');expect(cut).toContain('width="35" height="32"')
})
test('D1 painted shed stays in the visible motion branch and inherits every frame transform',async()=>{
 await loadD1Shed({root:'/fixture',read:async()=>({base64:'SKIN'}),run:async()=>({exitCode:0,stdout:'{}'})})
 const source='<svg><style>.mostill{display:none}</style><g class="moroot"><g class="mosway"><g class="mobreath"><g class="moshift"><g class="mogesture"><g class="mol0"><image data-name="snake"/></g></g></g></g></g></g><g class="mostill"><image data-name="still"/></g></svg>'
 const painted=shedPicture(source,300)
 const ancestors:string[][]=[];const stack:string[]=[]
 for(const match of painted.matchAll(/<\/?(?:g|image)\b[^>]*>/g)){
  const tag=match[0];if(tag.startsWith('</g'))stack.pop()
  else if(tag.startsWith('<g')&&!tag.endsWith('/>'))stack.push(/class="([^"]+)"/.exec(tag)?.[1]??'')
  else if(tag.startsWith('<image')&&tag.includes('base64,SKIN'))ancestors.push([...stack])
 }
 expect(ancestors).toHaveLength(2)
 expect(ancestors[0]).toEqual(['moroot','mosway','mobreath','moshift','mogesture','',''])
 expect(ancestors[1]).toEqual(['mostill',''])
 const stillBranch=painted.slice(painted.indexOf('<g class="mostill">'))
 expect(stillBranch).toContain('d1shedFade 200ms linear 300ms both')
 expect(stillBranch).not.toContain('d1page0');expect(stillBranch).not.toContain('<circle')
})
test('D1 painted gleam follows the approved sine opacity with constant dot radii',async()=>{
 await loadD1Shed({root:'/fixture',read:async()=>({base64:'SKIN'}),run:async()=>({exitCode:0,stdout:'{}'})})
 const painted=shedPicture('<svg><image data-name="snake"/></svg>',0)
 const gleam=painted.match(/@keyframes d1shedGleam\{(.*?)\}\}/)?.[1]??''
 expect(gleam).toContain(`25%{opacity:${Number((Math.floor(255*Math.sin(Math.PI/4))/255).toFixed(5))}`)
 expect(gleam).not.toContain('transform:');expect(painted).toContain('cx="99" cy="78" r="1.3"');expect(painted).toContain('cx="105" cy="75.5" r="0.9"')
})
test('D1 a band press dismisses its held long completion without discarding a waiting stamp',()=>{
 const slot=new LineSlot();slot.offer({id:'long:t',key:'long.done',text:'fixture completion',class:1,once:true,untilPrompt:true,ttl:14400000},0)
 slot.offer({id:'stamp:s',key:'stamp.earned',text:'fixture stamp',class:1,once:true,waitForId:'long:t'},1)
 expect(slot.visible(14399999)?.key).toBe('long.done');slot.dismiss('long.done',14399999);expect(slot.visible(14399999)?.key).toBe('stamp.earned')
 const expiry=new LineSlot();expiry.offer({key:'long.done',text:'fixture',class:1,once:true,ttl:14400000},0);expect(expiry.visible(14400000)).toBeUndefined()
})

test('D1 emitted pixel CSS keeps exactly one visible cut at every edge and cached resume',async()=>{
 await loadD1Shed({root:'/finite-pixel-fixture',read:async path=>({base64:path.endsWith('42-shed-a.png')?'CUT_A':path.endsWith('43-shed-b.png')?'CUT_B':path.endsWith('44-shed-c.png')?'CUT_C':'SKIN'}),run:async()=>({exitCode:0,stdout:'{}'})})
 const original='<svg viewBox="0 0 35 32" width="28" height="26"><defs><image id="unused" href="data:image/png;base64,OLD"/></defs><use href="#unused"/></svg>',built=shedPicture(original,0,false,true)
 const edges:[number,number,string][]= [[0,0,'CUT_A'],[159,0,'CUT_A'],[160,1,'CUT_B'],[359,1,'CUT_B'],[360,2,'CUT_C'],[959,2,'CUT_C'],[960,3,'OLD'],[1599,3,'OLD'],[1600,3,'OLD']]
 for(const [at,layer,png] of edges)for(const raw of [shedPicture(original,at,false,true),resumeD1Picture(built,{shedElapsed:at})]){
  const seen=sampleD1PixelSource(raw)
  if(at===1600&&!raw.includes('data-d1-pixel-timeline')){expect(raw).toBe(original);expect(seen.layers).toEqual([]);expect(seen.tracks).toEqual([]);continue}
  expect(seen.layers).toEqual([layer]);expect(seen.source).toContain('base64,'+png)
  for(const other of ['CUT_A','CUT_B','CUT_C','OLD'].filter(value=>value!==png))expect(seen.source).not.toContain('base64,'+other)
  expect(seen.tracks).toHaveLength(4);expect(seen.tracks.every(track=>track.duration===1600)).toBe(true)
 }
 const swaps=shedPicture(original,0,false,true,false)
 expect(swaps).toContain('base64,CUT_A');expect(swaps).not.toContain('OLD');expect(swaps).not.toContain('<use');expect(swaps).not.toContain('data-d1-pixel-timeline')
})
