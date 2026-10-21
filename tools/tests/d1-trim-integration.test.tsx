import {test,expect} from 'claude-code/testing'
import type {On} from 'claude-code'
import {replaceD1TrimmedResult} from '../hooks/d1-trim'
import {RECENT,MORNING,world,settleLegacyStart} from './world'
import {C3_WORDS_RAW} from './c3-words-fixture'
import {TRIM_WORDS_RAW} from './d1-trim-words-fixture'
import {WINDOWS_ROOTS} from './test-system'
const START={cwd:WINDOWS_ROOTS?'C:\\Users\\windows\\project':'/tmp/d1-trim-integration',surface:'vscode' as const,isInteractive:true}
const FULL=Array.from({length:300},(_,i)=>'PASS suite-'+i).join('\n')+'\n',STDERR='FAIL diagnostic remains'
const OK={exitCode:0,stdout:'',stderr:'',isStdoutTruncated:false,isStderrTruncated:false}
function fixture(on:On,answer:Record<string,unknown>){
 const persisted:string[]=[]
 on('tool.call',{tool:'Bash'},()=>answer as never)
 on('ui.notice',()=>({value:undefined}))
 on('process.run',($,e)=>{
  if(e.argv[1]?.endsWith('d1-trim-worker.mjs')){const request=JSON.parse(e.init?.stdin??'{}');if(request.op==='write')persisted.push(request.text);return {value:{...OK,stdout:JSON.stringify({ok:true,path:request.root+'/logs/abcd/1234-bun.log'})}}}
  if(e.argv[1]?.endsWith('algo-worker.mjs')){const request=JSON.parse(e.init?.stdin??'{}');let result:unknown=null
   if(request.op==='recognize')result={kind:'test',tool:'bun',key:'bun test'}
   if(request.op==='finish')result={parsed:{outcome:'fail'},slowness:{slow:false},history:{}}
   return {value:{...OK,stdout:JSON.stringify({ok:true,result})}}
  }
  return {value:OK}
 })
 on('fs.exists',{path:'/System/Library/CoreServices/SystemVersion.plist'},()=>({value:false}))
 const w=world(on,{store:{...RECENT,firstMet:MORNING,stamps:{met:MORNING},bandSettings:{trim:true}},sessionRoot:START.cwd,surfaces:['vscode'],env:{HOME:'/tmp/d1-trim-home',LANG:'en_US.UTF-8',TERM:'xterm-256color'},readText:path=>path.endsWith('c3-text.json')?C3_WORDS_RAW:path.endsWith('d1-words.json')?TRIM_WORDS_RAW:undefined})
 return {w,persisted}
}
test('D1 registered trim omits original core message ref while replacing validated result and model-facing text consistently',async($,on)=>{
 const original={ref:173,result:{stdout:FULL,stderr:STDERR,interrupted:false},text:FULL+STDERR,isReadOnly:true,context:['kept reminder']},f=fixture(on,original)
 await $.session.start(START);await settleLegacyStart($,f.w);await $.turn.start({text:'run tests',turnId:'trim-model-facing'})
 const answer=await $.tool.call({tool:'Bash',command:'bun test'})
 expect(f.persisted).toEqual([FULL+STDERR]);expect(answer.ref).toBeUndefined();expect(answer.context).toEqual(['kept reminder']);expect(answer.isReadOnly).toBeUndefined()
 const result=answer.result as {stdout:string;stderr:string;interrupted:boolean}
 const adapterAnswer=replaceD1TrimmedResult(original,original.result,{output:result.stdout,stderr:result.stderr});expect(adapterAnswer.isReadOnly).toBe(true);expect(adapterAnswer.ref).toBeUndefined();expect(adapterAnswer.result).toEqual(result);expect(adapterAnswer.text).toBe(answer.text);expect(adapterAnswer.context).toEqual(['kept reminder']);expect(original.ref).toBe(173);expect(original.result.stdout).toBe(FULL)
 expect(result.stdout).not.toBe(FULL);expect(result.stderr).toBe(STDERR);expect(result.interrupted).toBe(false)
 expect(answer.text).toBe(result.stdout+(result.stdout.endsWith('\n')?'':'\n')+STDERR);expect(answer.text).not.toBe(original.text)
 // The pinned engine exposes the model-facing text here. This checks its real tool.call seam,
 // while no actual model request or undocumented core message/ref lookup is simulated.
})
test('D1 registered trim leaves unsupported errored Bash string records and their ref intact',async($,on)=>{
 const original={ref:174,isError:true,result:FULL+STDERR,text:FULL+STDERR},f=fixture(on,original)
 await $.session.start(START);await settleLegacyStart($,f.w);await $.turn.start({text:'run tests',turnId:'trim-error-shape'})
 const answer=await $.tool.call({tool:'Bash',command:'bun test'})
 expect(answer).toEqual(original);expect(f.persisted).toEqual([])
})
test('D1 registered trim never calls an incomplete persisted Bash body a full private log',async($,on)=>{
 const original={ref:175,result:{stdout:FULL,stderr:STDERR,interrupted:false,persistedOutputPath:'/blocked/tool-results/full.txt',persistedOutputSize:999999},text:FULL+STDERR},f=fixture(on,original)
 await $.session.start(START);await settleLegacyStart($,f.w);await $.turn.start({text:'run tests',turnId:'trim-persisted-shape'})
 const answer=await $.tool.call({tool:'Bash',command:'bun test'})
 expect(answer).toEqual(original);expect(f.persisted).toEqual([]);expect(f.w.fileReads.includes('/blocked/tool-results/full.txt')).toBe(false)
})
