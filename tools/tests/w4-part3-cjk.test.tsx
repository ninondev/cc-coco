import { expect, test } from 'claude-code/testing'
import { desktopBand } from '../hooks/band'
import { initialView } from '../hooks/mood'
import { C3_WORDS_RAW } from './c3-words-fixture'
import { world } from './world'
const corpus=JSON.parse(C3_WORDS_RAW)
const text=(n:any):string=>typeof n==='string'?n:Array.isArray(n)?n.map(text).join(''):text(n?.children??[])
const nodes=(n:any):any[]=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(nodes):[n,...(n.children??[]).flatMap(nodes)]
for(const lang of ['zh','zh-Hant','ja'] as const)for(const key of ['first_down','slow_build'] as const)test(`W4 part3 ${lang}/${key} binds its final substantive CJK pair`,async($,on)=>{
 const values=key==='first_down'?[{value:'parser',kind:'test' as const}]:[{value:'2分10秒',kind:'value' as const},{value:'58秒',kind:'value' as const}]
 const spoken=corpus[key][lang].replace('{name}','parser').replace('{now}','2分10秒').replace('{usual}','58秒')
 const view={...initialView(),lang,line:{id:key,key,text:spoken,class:1 as const,slots:values,expiresAt:14000}}
 on('ui.render',{component:'Pane',requestId:'w4-cjk-tail'},($,e)=>desktopBand($.ui.resolve(e) as any,view,{columns:103,maxRows:30,screenRows:48,isWorking:false},'<svg width="79.5" height="64"></svg>'))
 world(on)
 const ui=await $.ui.mount({surface:'desktop',plugin:'coco',component:'Pane',requestId:'w4-cjk-tail',props:{title:'W4 CJK',isFocused:true,bodyColumns:103,placement:'dock',scroll:{offset:0,bodyRows:30},view:{}}})
 const all=nodes(await ui.drawn()),speech=all.find(n=>n.type==='Text'&&text(n).replace(/\u00a0/g,' ')===spoken)
 expect(speech).toBeDefined()
 const substantive=[...spoken].filter(c=>/[\p{L}\p{N}]/u.test(c)),last=substantive.slice(-2).join('')
 expect(last.length).toBe(2)
 const tail=nodes(speech).filter(n=>n.type==='Text'&&n.props?.wrap==='truncate-end').map(n=>text(n).replace(/[^\p{L}\p{N}]/gu,''))
 expect(tail.some(run=>run.endsWith(last))).toBe(true)
 await ui.unmount()
})
