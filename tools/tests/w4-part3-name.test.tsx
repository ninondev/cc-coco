import { expect, test } from 'claude-code/testing'
import { desktopBand, planDesktop } from '../hooks/band'
import { initialView } from '../hooks/mood'
import { WORDS } from '../hooks/words'
import { C3_WORDS_RAW } from './c3-words-fixture'
import { world } from './world'
const corpus=JSON.parse(C3_WORDS_RAW)
// The cue line (BAND 3.2, 10-09) replaces the header column of DECISIONS 10-09 18:3x: his name stands on the cue line and takes
// no room from his line, which has rows 2 and 3 under it. So at 300 px the whole speech stands in two rows, and the name is
// the one the cue line alone decides: a line never gives it up and never takes it.
for(const lang of ['en','ja','hi','fr'] as const)for(const theme of ['light','dark','light-daltonized'] as const)for(const scene of ['ansi-said'])test(`W4 part3 ${lang}/300/rest/${theme}/${scene} keeps the whole speech in two rows, and his name is the cue line's`,()=>{
 const said=corpus['dragged'][lang][0]
 const view={...initialView(),lang,theme:theme==='dark'?'dark-ansi' as const:'light-ansi' as const,context:56,quota:{rateLimits:[{kind:'five_hour',percentUsed:72},{kind:'seven_day',percentUsed:41}],costUSD:1.84,at:Date.UTC(2026,9,2,9)},said}
 const p=planDesktop(view as any,{columns:38,maxRows:30,screenRows:48,isWorking:false})
 // the name is the cue line's: it stands or goes by the room the cue line has beside the page, never by his line
 expect([undefined,WORDS[lang].name]).toContain(p.name)
 expect(p.speech).toBe(said)
 expect(p.lineRows).toBe(2)
})

const nodes=(n:any):any[]=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(nodes):[n,...(n.children??[]).flatMap(nodes)]
for(const lang of ['en','hi','fr'] as const)test(`W4 part3 ${lang} her props stand on the floor, the bag last, two columns kept on the right edge`,async($,on)=>{
 const said=corpus['dragged'][lang][0]
 const view={...initialView(),lang,context:56,quota:{rateLimits:[{kind:'five_hour',percentUsed:72},{kind:'seven_day',percentUsed:41}],costUSD:1.84,at:Date.UTC(2026,9,2,9)},said}
 const size={columns:38,maxRows:30,screenRows:48,isWorking:false},p=planDesktop(view as any,size)
 on('ui.render',{component:'Pane',requestId:'w4-name-gap'},($,e)=>desktopBand($.ui.resolve(e) as any,view as any,size,'<svg width="79.5" height="64"></svg>',p))
 world(on)
 const ui=await $.ui.mount({surface:'desktop',plugin:'coco',component:'Pane',requestId:'w4-name-gap',props:{title:'W4 name',isFocused:true,bodyColumns:38,placement:'dock',scroll:{offset:0,bodyRows:30},view:{}}})
 const all=nodes(await ui.drawn()),column=all.find(n=>n.props?.key==='coco:text-column')
 // 10-18: her props stand on the floor, the bag last, and the right edge keeps its two columns
 const floor=nodes(column).find((n:any)=>n.props?.key==='coco:floor')
 expect(nodes(floor).some((n:any)=>n.type==='Svg'&&String(n.props?.source).includes('viewBox="0 0 26 12"'))).toBe(true)
 expect(nodes(floor.children.at(-1)).some((n:any)=>n.type==='Button'&&n.props?.key==='coco:book:open')).toBe(true)
 expect(column.props.marginRight).toBe(2)
 expect([undefined,WORDS[lang].name]).toContain(p.name)
 expect(p.speech).toBe(said)
 await ui.unmount()
})
