import {test,expect} from 'claude-code/testing'
import {world,RECENT,MORNING,stubPng,settleLegacyStart} from './world'
import {C3_WORDS_RAW} from './c3-words-fixture'
import {C3_HEAD_MANIFEST} from './c3-head-assets'
import {EXTRA_HEAD_SVG} from '../hooks/head-art'
import {WORDS} from '../hooks/words'
const START={cwd:'/tmp/c3-heads',surface:'vscode' as const,isInteractive:true}
const OK={exitCode:0,stdout:'',stderr:'',isStdoutTruncated:false,isStderrTruncated:false}
const reply=(id:string)=>({plugin:'coco',component:'AssistantMessage' as const,requestId:id,props:{text:'A complete reply.',isFirstOfReply:true},viewport:{columns:100,rows:48}})
const complete=()=>({turnId:'head-turn',answer:'A complete reply.',reason:'answer' as const,durationMs:900,isAborted:false})
function setup(on:any,surface:'vscode'|'mobile'|'desktop'){
 let outcome='pass'
 on('session.append',($:any,e:any,next:any)=>next(e))
 on('process.run',($:any,e:any)=>{
  if(!e.argv[1]?.endsWith('algo-worker.mjs'))return {value:{...OK,stdout:'{}'}}
  const r=JSON.parse(e.init?.stdin??'{}');let result:any=null
  if(r.op==='guard')result={}
  if(r.op==='recognize')result={kind:'test',tool:'jest',key:'npm test'}
  if(r.op==='finish')result={parsed:{outcome,...(outcome==='fail'?{firstFailing:'the parser'}:{})},slowness:{slow:false},history:{[r.key]:[{ms:r.ms,outcome}]}}
  return {value:{...OK,stdout:JSON.stringify({ok:true,result})}}
 })
 const w=world(on,{stepText:'A complete reply.',engineRows:true,surfaces:[surface],store:{...RECENT,firstMet:MORNING,stamps:{met:MORNING},...(surface==='desktop'?{band:'off'}:{})},readText:path=>path.endsWith('c3-text.json')?C3_WORDS_RAW:path.endsWith('frame-manifest.json')?JSON.stringify(C3_HEAD_MANIFEST):undefined})
 return {w,outcome:(value:string)=>{outcome=value;w.fails=value==='fail'}}
}
async function begin($:any,w:any,surface:string,prompt='work'){
 await $.session.start({...START,surface});await settleLegacyStart($,w)
 await $.turn.start({turnId:'head-turn',text:prompt})
 for await(const _ of $.turn.step({turnId:'head-turn',index:0,model:'test',messageCount:1})){}
 // The kit delivers this protected event to plugin hooks but has no native
 // append implementation. Its persistence is outside this hook-state test.
 await $.session.append({door:'response',origin:{kind:'model',model:'test'},uuid:'head-uuid',message:{type:'assistant',role:'assistant',content:[{type:'text',text:'A complete reply.'}]}}).catch((error:unknown)=>{if(!String(error).includes('no implementation for session.append'))throw error})
}
for(const surface of ['vscode','mobile','desktop'] as const){
 test(`C3 ${surface} first head after completion keeps the thank-you opening`,{options:{band:'off'}},async($,on)=>{
  const f=setup(on,surface);await begin($,f.w,surface,'thanks');await $.turn.complete(complete())
  const ui=await $.ui.mount({surface,...reply('head-uuid')})
  expect(await ui.find({type:'Svg'})).toBeDefined();expect(await ui.find({text:WORDS.en.aside.flustered})).toBeDefined();await ui.unmount()
 })
 for(const outcome of ['error','cheer'] as const)test(`C3 ${surface} first head after completion keeps settled ${outcome}`,{options:{band:'off'}},async($,on)=>{
  const f=setup(on,surface);await begin($,f.w,surface)
  f.outcome('fail');await $.tool.call({tool:'Bash',command:'npm test'})
  if(outcome==='cheer'){f.outcome('pass');await $.tool.call({tool:'Bash',command:'npm test'})}
  await $.turn.complete(complete());const ui=await $.ui.mount({surface,...reply('head-uuid')})
  expect(await ui.find({type:'Svg'})).toBeDefined();expect(await ui.find({text:outcome==='error'?WORDS.en.aside.error:JSON.parse(C3_WORDS_RAW)['aside.cheer'].en})).toBeDefined();await ui.unmount()
 })
 test(`C3 ${surface} newest tool head is her own search head on the first paint`,{options:{band:'off'}},async($,on)=>{
  const f=setup(on,surface);await begin($,f.w,surface);await $.tool.call({tool:'Grep',pattern:'parser'})
  const ui=await $.ui.mount({surface,...reply('head-uuid')}),svg=await ui.find({type:'Svg'})
  const png=(source:string)=>/href="data:image\/png;base64,([^"]+)"/.exec(source)?.[1]
  expect(png(String(svg?.props.source))).toBe(png(EXTRA_HEAD_SVG['search-a']!));await ui.unmount()
 })
}
