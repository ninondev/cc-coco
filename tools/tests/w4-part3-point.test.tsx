import { expect, test } from 'claude-code/testing'
import { planDesktop, terminalBand } from '../hooks/band'
import { initialView } from '../hooks/mood'
import { LANGS } from '../hooks/words'
import { C3_WORDS_RAW } from './c3-words-fixture'
import { world } from './world'
const corpus=JSON.parse(C3_WORDS_RAW)
const size=(columns:number)=>({columns,maxRows:30,screenRows:48,isWorking:true})
const quota={rateLimits:[{kind:'five_hour',percentUsed:72},{kind:'seven_day',percentUsed:41}],costUSD:1.84,at:Date.UTC(2026,9,2,9)}
const base=(lang:typeof LANGS[number]['code'])=>({...initialView(),lang,context:56,band:'on' as const,workSize:'smaller' as const,quota})
const testName='parser › rejects empty input and keeps comments between runs'
for(const {code:lang} of LANGS)test(`W4 part3 ${lang} keeps the failed verdict before its name`,()=>{
 const source=corpus.first_down[lang],spoken=source.replace('{name}',testName)
 const verdict=source.split('{name}')[1].trim().replace(/^[,，、]\s*/u,'').replace(/[.!?。।]+$/u,'')
 expect(verdict.length).toBeGreaterThan(0)
 for(const columns of [38,54]){
  const p=planDesktop({...base(lang),line:{id:'first_down',key:'first_down',text:spoken,class:1 as const,slots:[{value:testName,kind:'test' as const}],expiresAt:14000}},size(columns))
  expect(p.speech!.includes(verdict)).toBe(true)
 }
})
const times={zh:['2分10秒','58秒'],'zh-Hant':['2分10秒','58秒'],ja:['2分10秒','58秒'],ko:['2분10초','58초'],en:['2m10s','58s'],fr:['2m10s','58s'],de:['2 Min. 10 Sek.','58 Sek.'],hi:['२मि१०से','५८से'],id:['2m10s','58s'],it:['2m10s','58s'],'pt-BR':['2min10s','58s'],'es-419':['2 min 10 s','58 s'],'es-ES':['2 min 10 s','58 s']} as const
for(const {code:lang} of LANGS)test(`W4 part3 ${lang} keeps this build's time before its name`,()=>{
 const [now,usual]=times[lang],spoken=corpus.slow_build[lang].replace('{now}',now).replace('{usual}',usual)
 const view={...base(lang),line:{id:'slow_build',key:'slow_build',text:spoken,class:1 as const,slots:[{value:now,kind:'value' as const},{value:usual,kind:'value' as const}],expiresAt:14000}}
 const labels={zh:'这次build花了'+now,'zh-Hant':'這次build花了'+now,ja:'今回は'+now,ko:now+' 걸렸어',en:now+' this time',fr:'là, '+now,de:'Diesmal '+now,hi:'में '+now+' लगा',id:'build-nya '+now,it:'stavolta, '+now,'pt-BR':now+' dessa vez','es-419':now+' esta vez','es-ES':now+' esta vez'}
 for(const columns of [38,54])expect(planDesktop(view,size(columns)).speech!.includes(labels[lang])).toBe(true)
})
const warningWords={en:['deletes','secret'],fr:['vide','secret'],de:['löscht','geheimen Schlüssel'],hi:['मिटा देगा','गोपनीय जानकारी'],id:['menghapus','rahasia'],it:['svuota','segreto'],ja:['消します','秘密の鍵'],ko:['삭제합니다','비밀 정보'],'pt-BR':['apaga','segredo'],'es-419':['elimina','secreto'],'es-ES':['elimina','secreto'],zh:['删掉','密钥'],'zh-Hant':['刪掉','金鑰']} as const
for(const {code:lang} of LANGS)for(const [key,index] of [['guard.rm',0],['guard.secretAfter',1]] as const)test(`W4 part3 ${lang}/${key} keeps its warning before path and name`,()=>{
 const path='~/Claude/Projects/atlas/plugin/assets/build',file='plugin/hooks/config.ts'
 const spoken=corpus[key][lang].replace('{target}',path).replace('{file}',file).replace('{line}','17')
 const slots=key==='guard.rm'?[{value:path,kind:'path' as const}]:[{value:file,kind:'path' as const},{value:'17',kind:'value' as const}]
 for(const columns of [38,54]){
  const p=planDesktop({...base(lang),line:{id:key,key,text:spoken,class:3 as const,slots,expiresAt:14000}},size(columns))
  expect(p.speech!.includes(warningWords[lang][index])).toBe(true)
  if(lang==='en'&&key==='guard.rm')expect(p.speech!.includes('This deletes everything in')).toBe(true)
  if(lang==='en'&&key==='guard.rm'&&p.speech!.includes('It cannot'))expect(p.speech!.includes('It cannot be undone')).toBe(true)
 }
})

for(const surface of ['desktop','terminal'] as const)test(`W4 part3 ${surface} bounds slot fitting work for a 100000-character name`,async($,on)=>{
 const value='x'.repeat(100000)
 let reads=0
 const slot={kind:'test' as const,get value(){if(++reads>128)throw new Error('slot fitting exceeded 128 input reads');return value}}
 const view={...base('en'),line:{id:'first_down',key:'first_down',text:value+' failed.',class:1 as const,slots:[slot],expiresAt:14000}}
 if(surface==='desktop')expect(planDesktop(view,size(54)).speech?.includes('failed')).toBe(true)
 else{
  on('ui.render',{component:'Pane',requestId:'w4-bounded'},($,e)=>terminalBand($.ui.resolve(e) as any,view,{...size(80),columns:80}))
  world(on)
  const ui=await $.ui.mount({surface:'terminal',plugin:'coco',component:'Pane',requestId:'w4-bounded',props:{title:'W4 bounded',isFocused:true,bodyColumns:80,placement:'dock',scroll:{offset:0,bodyRows:30},view:{}}})
  expect(JSON.stringify(await ui.drawn()).includes('failed')).toBe(true)
  await ui.unmount()
 }
 expect(reads).toBeLessThanOrEqual(128)
})
