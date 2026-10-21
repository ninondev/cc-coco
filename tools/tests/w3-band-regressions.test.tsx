import { expect, test } from 'claude-code/testing'
import { desktopBand, planDesktop, terminalBand, cells } from '../hooks/band'
import { initialView } from '../hooks/mood'
import { WORDS, LANGS } from '../hooks/words'
import { planPx, COLUMN_PX } from '../hooks/typeset'
import { world } from './world'

const size=(columns=38,working=true)=>({columns,isWorking:working,maxRows:30,screenRows:48})
const nodes=(tree:any):any[]=>!tree||typeof tree!=='object'?[]:Array.isArray(tree)?tree.flatMap(nodes):[tree,...(tree.children??[]).flatMap(nodes)]
const text=(tree:any):string=>typeof tree==='string'?tree:Array.isArray(tree)?tree.map(text).join(''):tree&&typeof tree==='object'?text(tree.children??[]):''
const mount=($:any,surface:'desktop'|'terminal',id:string)=>$.ui.mount({surface,plugin:'coco',component:'Pane',requestId:id,props:{title:'W3 fixture',isFocused:true,bodyColumns:80,placement:'dock',scroll:{offset:0,bodyRows:30},view:{}}})
const line=(spoken:string,value:string,kind:'value'|'todo'='value')=>({id:'w3',key:'pace',text:spoken,class:1 as const,slots:[{value,kind}],expiresAt:14000})

for(const [lang,value,spoken] of [
 ['ja','~1時間 2分','このペースだと、香は残り~1時間 2分。'],
 ['fr','80 %','La fenêtre brûle vite. Il reste 80 %.'],
 ['en','~1h 2m','At this pace the incense burns out in ~1h 2m.'],
 ['hi','८०%','इस गति से अगरबत्ती जल्दी खत्म होती है, बाकी ८०%।'],
] as const)for(const surface of ['desktop','terminal'] as const)test(`W3 S2 ${surface}/${lang} a complete numeric slot survives by cutting its words`,async($,on)=>{
 const view={...initialView(),lang,context:56,band:'compact' as const,line:line(spoken,value)}
 if(surface==='desktop')for(const cols of [38,44,54]){
  const p=planDesktop(view,size(cols))
  expect(p.speech?.includes(value)).toBe(true)
  expect(/[.。।]\s*…/.test(p.speech??'')).toBe(false)
 }else{
  on('ui.render',{component:'Pane',requestId:'w3-number'},($,e)=>terminalBand($.ui.resolve(e) as any,view,size(55)))
  world(on);const ui=await mount($,'terminal','w3-number'),tree=nodes(await ui.drawn())
  const bold=tree.find(n=>n.type==='Text'&&n.props?.bold&&text(n).replace(/\u00a0/g,' ')===value)
  expect(bold).toBeDefined();expect(bold.props.wrap).toBe('truncate-end')
  const spokenNode=tree.find(n=>n.type==='Text'&&n.children?.some((c:any)=>c?.type==='Text'&&c.props?.bold))
  // BAND F2: the name goes before his words are cut, so the line has the room of the name when the name has gone
  const named=tree.some(n=>n.type==='Text'&&n.props?.bold&&text(n)===WORDS[lang].name)
  expect(cells(text(spokenNode).trimStart())).toBeLessThanOrEqual(55-(named?cells(WORDS[lang].name)+1:0)-cells('◉◉◉ 56%')-3-cells(WORDS[lang].marks.shelf))
  expect(/[.。।]\s*…/.test(text(spokenNode))).toBe(false)
  await ui.unmount()
 }
})

test('W3 S2/W4 N3 complete retained values fit while a second numeric clause may drop whole',()=>{
 const values=['80 %','~1h 2m'],spoken=`The window is at ${values[0]}, and the incense burns out in ${values[1]}.`
 const view={...initialView(),context:56,band:'compact' as const,line:{...line(spoken,values[0]!),slots:values.map(value=>({value,kind:'value' as const}))}}
 for(const cols of [38,46,54]){
  const p=planDesktop(view,size(cols)),fitted=p.speech??''
  expect(fitted.split(values[0]!).length-1).toBe(1)
  const second=fitted.split(values[1]!).length-1
  // BAND 3.2: the bag stands in the row, so at 38 columns the second clause goes whole; at 46 it stays whole (the bag's
  // native button of 10-18 is wider than the old plain mark, which moved this from 44).
  // 10-14: with the short name Coco, at 54 the name and the whole first clause fit, so the second clause goes whole (W4 N3)
  expect(second).toBe(cols===46?1:0)
  // BAND F2: the name goes before the words are cut, so at 46 columns both clauses stand without it
  if(cols===46){expect(p.name).toBeUndefined();expect(fitted.startsWith('at 80 %')).toBe(true)}
  if(second===0){expect(fitted.includes('and')).toBe(false);expect(fitted.includes('incense')).toBe(false);expect(fitted.includes('at '+values[0])).toBe(true);expect(/[,，]$/u.test(fitted)).toBe(false)}
  const occupied=planPx(fitted)+(p.name?planPx(p.name,true)+planPx(' '):0)
  expect(occupied).toBeLessThanOrEqual(p.textWidth??0)
  expect(/[.。।]\s*…/.test(fitted)).toBe(false)
 }
})

test('W3 S2 ordinary sentence cuts never append ellipsis to a full stop',()=>{
 const spoken='The sentence ends. Another sentence continues for several more words.'
 const view={...initialView(),band:'compact' as const,line:{...line(spoken,''),slots:[]}}
 for(let cols=30;cols<100;cols++)expect(/[.。।]\s*…/.test(planDesktop(view,size(cols)).speech??'')).toBe(false)
})

test('W3 T1 Korean speech cuts at spaces while Japanese may cut between characters',()=>{
 const spoken='이 명령은 작업을 삭제하며 되돌릴 수 없습니다',view={...initialView(),lang:'ko' as const,band:'compact' as const,line:{...line(spoken,''),slots:[]}}
 let cuts=0
 for(let cols=30;cols<65;cols++){
  const fitted=planDesktop(view,size(cols)).speech??''
  if(fitted.endsWith('…')&&fitted!=='…'){
   cuts++;const kept=fitted.slice(0,-1)
   expect(spoken.startsWith(kept)).toBe(true)
   expect(/^\s/.test(spoken.slice(kept.length))).toBe(true)
  }
 }
 expect(cuts).toBeGreaterThan(0)
 const ja={...view,lang:'ja' as const,line:{...view.line,text:'この操作は取り消せません'}}
 expect(Array.from({length:30},(_,i)=>planDesktop(ja,size(i+25)).speech).some(t=>t?.endsWith('…')&&t!=='…')).toBe(true)
})

for(const surface of ['desktop','terminal'] as const)test(`W3 T1 ${surface} Korean whole words are unbroken rendering runs`,async($,on)=>{
 const view={...initialView(),lang:'ko' as const,line:{...line('이 명령은 작업을 삭제하며 되돌릴 수 없습니다',''),slots:[]}}
 on('ui.render',{component:'Pane',requestId:'w3-ko-wrap'},($,e)=>surface==='desktop'?desktopBand($.ui.resolve(e) as any,view,size(100,false),'<svg width="76" height="64"></svg>'):terminalBand($.ui.resolve(e) as any,view,size(100,true)))
 world(on);const ui=await mount($,surface,'w3-ko-wrap'),all=nodes(await ui.drawn())
 for(const word of ['명령은','작업을','되돌릴','없습니다']){
  const run=all.find(n=>n.type==='Text'&&text(n)===word)
  expect(run).toBeDefined();expect(run.props.wrap).toBe('truncate-end');expect(run.props.bold).toBeUndefined()
 }
 await ui.unmount()
})

test('W3 T2 todo floor prefers a whole short word and retains single-word fallback',()=>{
 const value='Add tests for parser',view={...initialView(),context:56,band:'compact' as const,line:line(value,value,'todo')}
 const plans=Array.from({length:45},(_,i)=>planDesktop(view,size(i+25)))
 expect(plans.some(p=>p.parts?.some(part=>part.slot&&part.text==='Add tests…'))).toBe(true)
 expect(plans.some(p=>p.parts?.some(part=>part.slot&&part.text==='Add tests f…'))).toBe(false)
 const single='Supercalifragilisticexpialidocious'
 expect(Array.from({length:45},(_,i)=>planDesktop({...view,line:line(single,single,'todo')},size(i+25))).some(p=>p.parts?.some(part=>part.slot&&part.text.endsWith('…')&&single.startsWith(part.text.slice(0,-1))))).toBe(true)
})

test('W3 T1 Korean todo slots retain whole word boundaries at the floor',()=>{
 const value='되돌릴수없는변경을검토하십시오 테스트 추가',view={...initialView(),lang:'ko' as const,context:56,band:'compact' as const,line:line(value,value,'todo')}
 for(let cols=30;cols<70;cols++){
  const p=planDesktop(view,size(cols)),fitted=p.speech??''
  if(fitted.endsWith('…')&&fitted!=='…'){
   const kept=fitted.slice(0,-1)
   expect(value.startsWith(kept)).toBe(true)
   expect(/^\s/u.test(value.slice(kept.length))).toBe(true)
  }
 }
})

for(const {code:lang} of LANGS)for(const compact of [false,true])test(`W3 S1/S4 ${lang}/${compact?'one':'two'} row hover fits and Close stays inside`,async($,on)=>{
 const view={...initialView(),lang,context:56,band:compact?'compact' as const:'on' as const}
 let cols=38
 on('ui.render',{component:'Pane',requestId:'w3-hover'},($,e)=>desktopBand($.ui.resolve(e) as any,view,size(cols,false),`<svg width="${compact?36:76}" height="${compact?32:64}"></svg>`))
 world(on)
 for(cols of [38,54,103]){
  const ui=await mount($,'desktop','w3-hover'),tree=await ui.drawn(),all=nodes(tree)
  const controls=all.find(n=>n.type==='Box'&&n.props?.position==='absolute'&&n.props?.display==='none')
  expect(controls).toBeDefined()
  // DECISIONS 1018 (10-18): the strip opens beside her picture, on the floor row at rest and on the one row; it never covers her
  expect(controls.props.top).toBe(compact?0:2)
  const buttons=nodes(controls).filter(n=>n.type==='Button')
  const row=nodes(controls).find(n=>n.type==='Box'&&n.props?.backgroundColor)
  expect(row.props.backgroundColor).toBe('composerSidebarBackground')
  expect(all.find(n=>n.props?.key==='coco:band')?.props.backgroundColor).toBe(row.props.backgroundColor)
  const width=buttons.reduce((n,b)=>n+planPx(b.props.label)+22,0)+(buttons.length-1)*6
  expect(width).toBeLessThanOrEqual((cols-Number(controls.props.left??0))*COLUMN_PX)
  expect(buttons.at(-1)?.props.key).toBe('coco:band:close')
  // the bag stands on the floor or the row, once, and not in the strip
  expect(buttons.some(b=>b.props.key==='coco:book:open')).toBe(false)
  expect(all.filter(n=>n.type==='Button'&&n.props?.key==='coco:book:open').length).toBe(1)
  if(cols===103)expect(buttons.length).toBe(3)
  if(buttons.length===1)expect(buttons.map(b=>b.props.key)).toEqual(['coco:band:close'])
  await ui.unmount()
 }
})
