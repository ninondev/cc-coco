import {test,expect,mock} from 'bun:test'
mock.module('react/jsx-dev-runtime',()=>({Fragment:Symbol('fragment'),jsxDEV:()=>{throw new Error('No tree rendering in picture fixture')}}))
mock.module('react/jsx-runtime',()=>({Fragment:Symbol('fragment'),jsx:()=>{throw new Error('No tree rendering in picture fixture')},jsxs:()=>{throw new Error('No tree rendering in picture fixture')}}))
import {offeringSvg} from '../../plugin/hooks/pictures-lazy'
import {quotaPictures} from '../../plugin/hooks/quota'
import {cueFor} from '../../plugin/hooks/mood'
import {pictureColors} from '../../plugin/hooks/high-contrast'
import {companionSizeSvg} from '../../plugin/hooks/companion-art'
import {installCocoData,cocoStill,cocoWidth} from '../../plugin/hooks/coco-motion'
import {readFileSync} from 'node:fs'
// The size preview draws her own still (pages.tsx), so the check reads the shipped band data.
installCocoData(JSON.parse(readFileSync(new URL('../../plugin/assets/coco/band-A.json',import.meta.url),'utf8')))
const {headPicture} = await import('../../plugin/hooks/transcript')
const {LANTERN,HAIRLINE} = await import('../../plugin/hooks/band')
const light=['#F0EEE6','#FFFFFF','#FFFAEF'],dark=['#2B2A27','#000000','#202020','#2D3236']
function ratio(a:string,b:string):number{
 const lum=(h:string)=>{const channels=h.slice(1).match(/../g)!.map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return channels[0]!*.2126+channels[1]!*.7152+channels[2]!*.0722}
 const x=lum(a),y=lum(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05)
}
function rule(svg:string,selector:string,property:string,mode:'normal-light'|'normal-dark'|'hc-light'|'hc-dark'):string{
 const styles=[...svg.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m=>m[1]!).join('')
 let css='',cursor=0
 while(cursor<styles.length){if(styles.startsWith('@media',cursor)){const open=styles.indexOf('{',cursor);let depth=1,end=open+1;while(depth&&end<styles.length){if(styles[end]==='{')depth++;if(styles[end]==='}')depth--;end++}const query=styles.slice(cursor,open),body=styles.slice(open+1,end-1);const hc=query.includes('contrast')||query.includes('forced-colors'),isDark=query.includes('color-scheme:dark');if((!hc||mode.startsWith('hc'))&&(!isDark||mode.endsWith('dark')))css+=body;cursor=end}else{const next=styles.indexOf('@media',cursor);css+=styles.slice(cursor,next<0?styles.length:next);cursor=next<0?styles.length:next}}
 let value='';for(const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)){if(!m[1]!.split(',').map(v=>v.trim()).includes(selector))continue;for(const declaration of m[2]!.split(';')){const [p,v]=declaration.split(':');if(p===property)value=v!}}
 expect(value).toMatch(/^#[0-9A-F]{6}$/i);return value
}
test('P1 code-drawn pictures answer both high contrast signals',()=>{
 for(const svg of [headPicture('idle-reading','idle-reading'),companionSizeSvg('medium',height=>({source:cocoStill('A','idle',height),width:cocoWidth(height)})).source])expect(svg.slice(0,svg.indexOf('>'))).toContain('forced-color-adjust:none')
 const images=[LANTERN,HAIRLINE]
 for(let p=0;p<=100;p++)for(const fixed of [false,true]){const svg=offeringSvg(p,fixed);expect(svg).not.toContain('#C75730');images.push(svg)}
 // The quota pictures since 10-14: the battery and the power bank, full, low and spent.
 for(const used of [37,80,100])for(const spent of [[],['five_hour','seven_day']]){const shown=quotaPictures([{kind:'five_hour',percentUsed:used},{kind:'seven_day',percentUsed:used}],spent);images.push(shown.five!,shown.week!)}
 for(const svg of images){expect(svg.slice(0,svg.indexOf('>'))).toContain('forced-color-adjust:none');expect(svg).toContain('@media(prefers-contrast:more),(forced-colors:active)');expect(svg).toContain('(forced-colors:active) and (prefers-color-scheme:dark)')}
})
test('P1 band picture roots preserve painted colours without duplicate attributes',()=>{
 const raw='<svg xmlns="http://www.w3.org/2000/svg"><image href="fixture.png"/></svg>'
 const expected='<svg style="forced-color-adjust:none" xmlns="http://www.w3.org/2000/svg"><image href="fixture.png"/></svg>'
 expect(pictureColors(raw)).toBe(expected)
 expect(pictureColors(expected)).toBe(expected)
 expect(pictureColors('<svg style="image-rendering:pixelated"><image/></svg>')).toBe('<svg style="image-rendering:pixelated;forced-color-adjust:none"><image/></svg>')
 expect(pictureColors('<svg style="forced-color-adjust:none;"><image/></svg>')).toBe('<svg style="forced-color-adjust:none;"><image/></svg>')
})
test('P1 shipped picture colour pairs meet the promised WCAG targets',()=>{
 // The battery's and the power bank's outer edge against every ground, light and dark, with and without more contrast.
 const {five,week}=quotaPictures([{kind:'five_hour',percentUsed:37},{kind:'seven_day',percentUsed:90}])
 for(const mode of ['normal-light','normal-dark','hc-light','hc-dark'] as const){const grounds=mode.endsWith('dark')?dark:light
  for(const svg of [five!,week!])for(const ground of grounds)expect(ratio(rule(svg,'.e','fill',mode),ground)).toBeGreaterThanOrEqual(3)
 }
 for(const mode of ['hc-light','hc-dark'] as const){for(const ground of mode==='hc-light'?light:dark){expect(ratio(rule(HAIRLINE,'path','stroke',mode),ground)).toBeGreaterThanOrEqual(3)}}
 const box=offeringSvg(95);const body=/<rect[^>]*fill="(#[\da-f]{6})"[^>]*stroke-width="1"/i.exec(box)![1]!,paper=[...box.matchAll(/<rect[^>]*fill="(#[\da-f]{6})"/ig)].at(-1)![1]!
 expect(Number(ratio(paper,body).toFixed(2))).toBeGreaterThanOrEqual(4.2)
 for(const theme of ['light','light-daltonized'])expect(ratio(cueFor(theme),'#FFFFFF')).toBeGreaterThanOrEqual(4.5)
})
