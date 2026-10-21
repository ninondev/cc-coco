import { expect, test } from 'claude-code/testing'
import { desktopBand, planDesktop, terminalBand } from '../hooks/band'
import { initialView } from '../hooks/mood'
import { WORDS, LANGS } from '../hooks/words'
import { world } from './world'
import { C3_WORDS_RAW } from './c3-words-fixture'
import { COLUMN_PX, planPx } from '../hooks/typeset'
import { LINES } from '../hooks/lines'
const size=(columns:number,working=true)=>({columns,isWorking:working,maxRows:30,screenRows:48})
const line=(text:string,values:string[]=[])=>({id:'w4',key:'test',text,class:1 as const,slots:values.map(value=>({kind:'value' as const,value})),expiresAt:14000})
const nodes=(tree:any):any[]=>!tree||typeof tree!=='object'?[]:Array.isArray(tree)?tree.flatMap(nodes):[tree,...(tree.children??[]).flatMap(nodes)]
const text=(tree:any):string=>typeof tree==='string'?tree:Array.isArray(tree)?tree.map(text).join(''):tree&&typeof tree==='object'?text(tree.children??[]):''
for(const lang of ['fr','de','hi','id','it','ko'] as const)test(`W4 N3 ${lang} a cut after an authored pause still ends in one omission`,()=>{
 const source=(lang==='hi'?LINES[lang].greeting.night[1]:LINES[lang].greeting.morning[0])!,original=source.replace(/\*([^*\n]+)\*/g,'$1')
 let cuts=0
 for(const compact of [false,true])for(const context of [34,91]){
  const view={...initialView(),lang,context,band:compact?'compact' as const:'on' as const,said:source}
  const fitted=planDesktop(view,size(38,false)).speech!
  if(fitted===original)continue
  cuts++;expect(fitted.endsWith('…')).toBe(true);expect(original.startsWith(fitted.slice(0,-1))).toBe(true);expect(fitted.split('…').length-1).toBe(1)
 }
 expect(cuts).toBeGreaterThan(0)
})
test('W4 N3 a kept line number retains line and has one omission',()=>{
 const view={...initialView(),lang:'en' as const,band:'compact' as const,line:line('The commit you just made changed line 17.',['17'])}
 for(const cols of [38,54]){const speech=planDesktop(view,size(cols)).speech!;expect(speech.includes('line 17')).toBe(true);expect(speech.split('…').length-1).toBeLessThanOrEqual(1)}
})
test('W4 N3 a retained usual duration keeps its label',()=>{
 const view={...initialView(),lang:'en' as const,band:'compact' as const,line:line('The build finishes usually 58s.',['58s'])}
 for(const cols of [38,54]){const speech=planDesktop(view,size(cols)).speech!;expect(speech.includes('usually 58s')).toBe(true);expect(speech.split('…').length-1).toBeLessThanOrEqual(1)}
})
test('W4 N3 Japanese keeps the first numeric clause and drops a second clause whole',()=>{
 const view={...initialView(),lang:'ja' as const,band:'compact' as const,line:line('今回は2分10秒かかった。いつもは58秒',['2分10秒','58秒'])}
 const speech=planDesktop(view,size(38)).speech!
 expect(speech.includes('今回は2分10秒')).toBe(true)
 expect(speech.includes('58秒')).toBe(false)
 expect(speech.split('…').length-1).toBeLessThanOrEqual(1)
})
test('W4 N3 a complete fitting Japanese clause wins over two shortened clauses',()=>{
 const view={...initialView(),lang:'ja' as const,band:'compact' as const,line:line('今回は2分10秒かかった。いつもは58秒',['2分10秒','58秒'])}
 const p=planDesktop(view,size(54))
 expect(p.name).toBe(WORDS.ja.name)
 expect(p.speech).toBe('今回は2分10秒かかった。')
 expect(p.speech?.includes('58秒')).toBe(false)
})
for(const surface of ['desktop','terminal'] as const)test(`W4 N5 ${surface} Korean numeric suffix remains inside the unbroken run`,async($,on)=>{
 const view={...initialView(),lang:'ko' as const,line:line('보통 58초인데. 17행.',['58초','17'])}
 on('ui.render',{component:'Pane',requestId:'w4-ko'},($,e)=>surface==='desktop'?desktopBand($.ui.resolve(e) as any,view,size(100,false),'<svg width="76" height="64"></svg>'):terminalBand($.ui.resolve(e) as any,view,size(100)))
 world(on)
 const ui=await $.ui.mount({surface,plugin:'coco',component:'Pane',requestId:'w4-ko',props:{title:'W4',isFocused:true,bodyColumns:100,placement:'dock',scroll:{offset:0,bodyRows:30},view:{}}})
 const all=nodes(await ui.drawn())
 for(const word of ['58초인데.','17행.'])expect(all.some(n=>n.type==='Text'&&n.props?.wrap==='truncate-end'&&text(n)===word)).toBe(true)
 await ui.unmount()
})
test('W4 N6 an incomplete first aside word pair is dropped',()=>{
 const view={...initialView(),lang:'en' as const,band:'compact' as const,pose:{aside:'(hands resting on the book)'} as any}
 for(let cols=30;cols<65;cols++){const p=planDesktop(view,size(cols));if(p.text)expect(p.text.startsWith('(hands resting')).toBe(true)}
})
test('W4 N7 restores the Japanese speaker after fitting a compact line',()=>{
 const view={...initialView(),lang:'ja' as const,context:56,band:'compact' as const,line:{...line('それ、さっき聞いてたよ'),key:'w4.action',button:{key:'w4-back',label:'そこへ戻る'}}}
 const p=planDesktop(view,size(54))
 expect(p.name).toBe(WORDS.ja.name)
 expect(p.speech?.length).toBeGreaterThan(1)
})
for(const columns of [50,51,52,53,54])test(`W4 N7 exact Japanese capture with a button keeps every fitting character at ${columns} columns`,()=>{
 const spoken='それ、さっき聞いてたよ',button={key:'w4-action',label:'そこへ戻る'}
 const view={...initialView(),lang:'ja' as const,context:56,band:'on' as const,workSize:'smaller' as const,quota:{rateLimits:[{kind:'five_hour',percentUsed:72},{kind:'seven_day',percentUsed:41}],costUSD:1.84,at:Date.UTC(2026,9,2,9)},line:{...line(spoken),key:'w4.action',class:2 as const,button}}
 const p=planDesktop(view,size(columns)),actionWidth=planPx(button.label)+22+COLUMN_PX,nameWidth=planPx(WORDS.ja.name,true)+planPx(' ')
 expect(p.row).toBe(true);expect(p.name).toBe(WORDS.ja.name);expect(p.showRight).toBe(false)
 // D1 design/0.3/SPEC.md:272-273 retains its fixed 12px slot at these unchanged
 // host widths. Independently enumerate every source prefix using the calibrated
 // 12px omission atom; the longest fitting prefix must win.
 const speechWidth=(value:string)=>planPx(value)+(value.match(/…/gu)?.length??0)*(12-planPx('…'))
 const fits=(value:string)=>nameWidth+speechWidth(value)+actionWidth<=p.textWidth!
 const candidates=Array.from({length:spoken.length-1},(_,i)=>spoken.slice(0,i+1)+'…').filter(fits)
 const expected=fits(spoken)?spoken:candidates.at(-1)
 expect(expected).toBeDefined();expect(p.speech).toBe(expected)
 expect(nameWidth+speechWidth(p.speech!)+actionWidth).toBeLessThanOrEqual(p.textWidth!)
 if(p.speech!==spoken){expect(fits(spoken)).toBe(false);expect(fits(spoken.slice(0,p.speech!.length)+'…')).toBe(false)}
 expect(p.buttonWidth).toBe(actionWidth)
})
// BAND 3.2 (10-09): the name is on the cue line and takes nothing from the line; with the action beside it the line has one of
// the column's two rows, so the first sentence stands whole and the second is dropped whole, never cut inside a word.
test('W4 N7 the French chapter keeps its first sentence whole beside the action and cuts no word',()=>{
 const view={...initialView(),lang:'fr' as const,context:56,line:{...line('presque plus de place. /compact pour la suite.'),key:'chapter',class:2 as const,button:{key:'w4-chapter',label:'Tourner la page'}}}
 const p=planDesktop(view,size(38,false))
 expect(p.name).toBe(planDesktop({...view,line:undefined},size(38,false)).name)
 // her line hangs after her name (10-18): the first sentence stands whole, its stop or the cut mark after it
 expect(['presque plus de place.','presque plus de place…']).toContain(p.speech)
 expect(p.lineRows).toBe(1)
 expect(p.speech?.includes('presq…')).toBe(false)
})
const corpus=JSON.parse(C3_WORDS_RAW)
// The bold name's rounded CoreText advances (band.tsx speakerWidth); planPx(name, true) is the looser planning estimate.
const NAME_BOUNDS:Readonly<Record<string,number>>={'クロードさま':76,'클로디':35,'小克':27}
const nameBound=(name:string)=>NAME_BOUNDS[name]??planPx(name,true)
for(const [lang,now,usual,first,second] of [
 ['zh','2分10秒','58秒','这次build花了2分10秒','平时58秒'],
 ['zh-Hant','2分10秒','58秒','這次build花了2分10秒','平時58秒'],
 ['ja','2分10秒','58秒','今回は2分10秒','いつもは58秒'],
 ['ko','2분10초','58초','빌드에 2분10초 걸렸어','보통 58초인데.'],
 ['en','2m10s','58s','2m10s this time','usually 58s'],
 ['fr','2m10s','58s',"d'habitude 58s",'là, 2m10s'],
 ['hi','२मि१०से','५८से','में २मि१०से लगा','आम तौर पर ५८से'],
 ['id','2m10s','58s','build-nya 2m10s','biasanya 58s'],
 ['it','2m10s','58s','di solito 58s','stavolta, 2m10s'],
 ['de','2 Min. 10 Sek.','58 Sek.','Sonst 58 Sek.','Diesmal 2 Min. 10 Sek.'],
 ['es-419','2 min 10 s','58 s','2 min 10 s esta vez','lo normal es 58 s'],
 ['es-ES','2 min 10 s','58 s','2 min 10 s esta vez','lo normal es 58 s'],
 ['pt-BR','2min10s','58s','2min10s dessa vez','o normal é 58s'],
] as const)test(`W4 N3 actual slow_build/${lang} retains complete numeric labels`,()=>{
 const spoken=corpus.slow_build[lang].replace('{now}',now).replace('{usual}',usual)
 const view={...initialView(),lang,context:56,band:'compact' as const,line:line(spoken,[now,usual])}
 for(const cols of [38,54,103]){
  const p=planDesktop(view,size(cols)),fitted=p.speech!
  expect(fitted.includes(first.includes(now)?now:usual)).toBe(true)
  for(const [value,label] of [[first.includes(now)?now:usual,first],[second.includes(now)?now:usual,second]])if(fitted.includes(value))expect(fitted.includes(label)).toBe(true)
  const secondValue=second.includes(now)?now:usual
  if(!fitted.includes(secondValue))expect(fitted.includes(second.split(secondValue)[0]!.trim().replace(/[,，]$/u,''))).toBe(false)
  expect(fitted.split('…').length-1).toBeLessThanOrEqual(1)
  expect(planPx(fitted)+(p.name?nameBound(p.name)+planPx(' '):0)).toBeLessThanOrEqual(p.textWidth??0)
 }
})
for(const lang of ['zh','zh-Hant'] as const)for(const theme of ['light','dark'] as const)test(`W4 N3 ${lang}/${theme} quota preview retains slow-build labels`,()=>{
 const now='2分10秒',usual='58秒',spoken=corpus.slow_build[lang].replace('{now}',now).replace('{usual}',usual)
 const first=lang==='zh'?'这次build花了2分10秒':'這次build花了2分10秒',second=lang==='zh'?'平时58秒':'平時58秒'
 const view={...initialView(),lang,theme,context:56,band:'on' as const,workSize:'smaller' as const,quota:{rateLimits:[{kind:'five_hour',percentUsed:72},{kind:'seven_day',percentUsed:41}],costUSD:1.84,at:Date.UTC(2026,9,2,9)},line:{...line(spoken,[now,usual]),id:'slow_build',key:'slow_build'}}
 for(const cols of [38,54,103])for(const working of [false,true]){
  const p=planDesktop(view,size(cols,working)),fitted=p.speech!
  expect(p.row).toBe(working)
  expect(fitted.includes(first)).toBe(true)
  if(fitted.includes(usual))expect(fitted.includes(second)).toBe(true)
  else expect(fitted.includes(second.slice(0,-usual.length))).toBe(false)
  expect(fitted.split('…').length-1).toBeLessThanOrEqual(1)
  if(cols===38&&working){
   // W4 part3 report:6 keeps the main time before the speaker. At the original
   // width both complete clauses fit after fixed siblings yield; keep both.
   expect(fitted).toBe(spoken);expect(p.name).toBeUndefined();expect(p.showRight).toBe(false)
   const physical=p.parts!.reduce((sum,part)=>sum+planPx(part.text,!!part.slot),0)
   expect(physical).toBeLessThanOrEqual(p.textWidth!)
   expect(physical+27+planPx(' ')).toBeGreaterThan(p.textWidth!)
  }
 }
})
test('W4 N3 a digit in a protected filename cannot make line 17 a disposable clause',()=>{
 const value='plugin/hooks/config2.ts',spoken=corpus['guard.secretAfter'].en.replace('{file}',value).replace('{line}','17')
 const view={...initialView(),lang:'en' as const,context:56,band:'compact' as const,line:{...line(spoken,['17']),class:3 as const,slots:[{value,kind:'path' as const},{value:'17',kind:'value' as const}]}}
 for(const cols of [38,54]){const fitted=planDesktop(view,size(cols)).speech!;expect(fitted.includes('config2.ts')).toBe(true);expect(fitted.includes('line 17')).toBe(true)}
})
test('W4 N3 a matching number inside a filename cannot impersonate the line-number slot',()=>{
 const value='plugin/hooks/config17.ts',spoken=corpus['guard.secretAfter'].en.replace('{file}',value).replace('{line}','17')
 const view={...initialView(),lang:'en' as const,context:56,band:'compact' as const,line:{...line(spoken,['17']),class:3 as const,slots:[{value,kind:'path' as const},{value:'17',kind:'value' as const}]}}
 for(const cols of [38,54,80,103]){const p=planDesktop(view,size(cols)),fitted=p.speech!;expect(fitted.includes('config17.ts')).toBe(true);expect(fitted.includes('line 17')).toBe(true);expect(p.parts?.filter(part=>part.slot&&part.text==='17').length).toBe(1)}
})
test('W4 N3 identical path and numeric values retain both occurrences and the numeric label',()=>{
 const spoken=corpus['guard.secretAfter'].en.replace('{file}','17').replace('{line}','17')
 const view={...initialView(),lang:'en' as const,context:56,band:'compact' as const,line:{...line(spoken,['17']),class:3 as const,slots:[{value:'17',kind:'path' as const},{value:'17',kind:'value' as const}]}}
 for(const cols of [38,54,80,103]){const fitted=planDesktop(view,size(cols)).speech!;expect(fitted.split('17').length-1).toBe(2);expect(fitted.includes('line 17')).toBe(true)}
})
for(const [lang,spoken,values,required] of [
 ['en','The commit you just made changed line 17.',['17'],'line 17'],
 ['en','The build finishes usually 58s.',['58s'],'usually 58s'],
] as const)test(`W4 N3/N4 terminal sixty columns retains ${required}`,async($,on)=>{
 const view={...initialView(),lang,context:56,band:'compact' as const,line:{...line(spoken,[...values]),key:'test'}}
 on('ui.render',{component:'Pane',requestId:'w4-terminal-fit'},($,e)=>terminalBand($.ui.resolve(e) as any,view,size(60)))
 world(on)
 const ui=await $.ui.mount({surface:'terminal',plugin:'coco',component:'Pane',requestId:'w4-terminal-fit',props:{title:'W4',isFocused:true,bodyColumns:60,placement:'dock',scroll:{offset:0,bodyRows:30},view:{}}})
 expect(text(await ui.drawn()).replace(/\u00a0/g,' ').includes(required)).toBe(true)
 await ui.unmount()
})
for(const {code:lang} of LANGS)for(const surface of ['desktop','terminal'] as const)test(`W4 N6 ${surface}/${lang} a partial pose keeps at least two complete words`,async($,on)=>{
 const view={...initialView(),lang,band:'compact' as const},aside=WORDS[lang].aside.idle
 let cols=30
 on('ui.render',{component:'Pane',requestId:'w4-aside'},($,e)=>terminalBand($.ui.resolve(e) as any,view,size(cols)))
 world(on)
 for(cols of [30,34,38,42,46,50,54]){
  let shown:string|undefined
  if(surface==='desktop')shown=planDesktop(view,size(cols)).text
  else{
   const ui=await $.ui.mount({surface:'terminal',plugin:'coco',component:'Pane',requestId:'w4-aside',props:{title:'W4',isFocused:true,bodyColumns:cols,placement:'dock',scroll:{offset:0,bodyRows:30},view:{}}})
   shown=nodes(await ui.drawn()).filter(n=>n.type==='Text'&&n.props?.color==='inactive').map(text).find(t=>t.includes('…'))?.trim();await ui.unmount()
  }
  if(!shown||!shown.includes('…'))continue
  const body=shown.replace(/^[(*（]/u,'').replace(/…[)*）]?$/u,'').trim(),original=aside.replace(/^[(*（]/u,'')
  expect(['zh','zh-Hant','ja'].includes(lang)).toBe(false)
  expect(body.split(/\s+/u).length).toBeGreaterThanOrEqual(2)
  expect(original.startsWith(body+' ')).toBe(true)
 }
})
