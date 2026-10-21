import { expect, test } from 'claude-code/testing'
import { cells, terminalBand } from '../hooks/band'
import { initialView } from '../hooks/mood'
import { LANGS, WORDS } from '../hooks/words'
import { C3_WORDS_RAW } from './c3-words-fixture'
import { world } from './world'

const corpus=JSON.parse(C3_WORDS_RAW)
const flatten=(n:any):string=>typeof n==='string'?n:Array.isArray(n)?n.map(flatten).join(''):flatten(n?.children??[])
const nodes=(n:any):any[]=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(nodes):[n,...(n.children??[]).flatMap(nodes)]
function minimum(n:any,locked=false):number{
 if(typeof n==='string')return locked?cells(n):0
 if(!n||typeof n!=='object')return 0
 const p=n.props??{},fixed=locked||p.flexShrink===0
 if(n.type==='Button')return cells(p.label)+(p.plain?0:4)
 if(n.type==='Text')return fixed?cells(flatten(n)):0
 const widths=(n.children??[]).map((c:any)=>minimum(c,fixed))
 const column=String(p.flexDirection??'row').startsWith('column')
 return Number(p.marginLeft??0)+Number(p.marginRight??0)+(column?Math.max(0,...widths):widths.reduce((a:number,b:number)=>a+b,0)+Math.max(0,widths.length-1)*Number(p.columnGap??0))
}
for(const {code:lang} of LANGS)for(const key of ['guard.rm','first_down','bookmark'])test(`W4 part3 terminal 24 ${lang}/${key} has whole buttons and useful speech`,async($,on)=>{
 const value='~/Claude/Projects/atlas/plugin/assets/build'
 const source=corpus[key][lang],spoken=source.replace('{target}',value).replace('{name}',value).replace('{where}',value)
 const slots=[{value,kind:key==='first_down'?'test' as const:'path' as const}]
 const view={...initialView(),lang,context:56,line:{id:key,key,text:spoken,class:key==='guard.rm'?3 as const:1 as const,slots,expiresAt:14000,button:{key:'test:open',label:WORDS[lang].marks.book}}}
 on('ui.render',{component:'Pane',requestId:'w4-terminal24'},($,e)=>terminalBand($.ui.resolve(e) as any,view,{columns:24,maxRows:30,screenRows:48,isWorking:true}))
 world(on)
 const ui=await $.ui.mount({surface:'terminal',plugin:'coco',component:'Pane',requestId:'w4-terminal24',props:{title:'W4 terminal',isFocused:true,bodyColumns:24,placement:'dock',scroll:{offset:0,bodyRows:30},view:{}}})
 const tree=await ui.drawn()
 expect(minimum(tree)).toBeLessThanOrEqual(24)
 for(const n of nodes(tree).filter(n=>n.type==='Text'))expect(flatten(n).trim()==='…').toBe(false)
 await ui.unmount()
})
