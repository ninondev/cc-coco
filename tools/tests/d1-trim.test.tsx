import type {ElementTable,RenderElement,RenderSurface} from 'claude-code'
import {world} from './world'
import {test,expect} from 'claude-code/testing'
import {trimD1Output,trimD1Path} from '../hooks/d1-trim-core'
import {createD1TrimRuntime,renderD1TrimRow,d1TrimOutputParts} from '../hooks/d1-trim'
import {renderD1TrimOutput} from '../hooks/d1-trim-row'
import {loadD1Words,d1Word,forgetD1Words} from '../hooks/d1-words'
import {TRIM_WORDS_RAW} from './d1-trim-words-fixture'
import {loadD1Art} from '../hooks/d1-art-data'
import {D1_ART_FILES} from './d1-art-fixture'
const marker=(n:number)=>`MARKER ${n}`
const progress=(n=300)=>Array.from({length:n},(_,i)=>`PASS suite-${i}`).join('\n')
const root='/tmp/coco-data'
const pane=(surface:RenderSurface)=>({surface,plugin:'coco',component:'Pane' as const,requestId:'d1-trim-source',props:{title:'fixture',isFocused:true,bodyColumns:100,placement:'dock' as const,scroll:{offset:0,bodyRows:30},view:{}}})
function harness(options:{enabled?:boolean;fail?:boolean;hold?:Promise<void>;root?:string;entered?:()=>void;readWords?:()=>Promise<string>;holdCheck?:Promise<void>;enteredCheck?:()=>void}={}){
 let on=options.enabled??true,at=1700000000000
 const calls:any[]=[],copies:string[]=[]
 const runtime=createD1TrimRuntime({dataRoot:options.root??root,workerPath:'/plugin/hooks/d1-trim-worker.mjs',readWords:options.readWords??(()=>Promise.resolve(TRIM_WORDS_RAW)),lang:()=> 'en',enabled:()=>on,now:()=>at,home:'/tmp/home',platform:'darwin',copy:async(path:string)=>{copies.push(path);return true},process:async(argv:string[],init:any)=>{const request=init?.stdin?JSON.parse(init.stdin):{op:'launch'};calls.push({argv,init,request});options.entered?.();await options.hold;if(request.op==='check'){options.enteredCheck?.();await options.holdCheck}if(options.fail)return {exitCode:1,stdout:'',stderr:''};return {exitCode:0,stdout:JSON.stringify({ok:true,...(request.op==='write'?{path:root+'/logs/abcd/2213-bun.log'}:{})}),stderr:''}}})
 runtime.start('test-session');return {runtime,calls,copies,on:(v:boolean)=>{on=v},clock:(v:number)=>{at=v}}
}
const run={kind:'test' as const,tool:'bun'}

test('D1 trim leaves output under either strict threshold unchanged',()=>{
 const text=progress(200);expect(trimD1Output(text,marker).total).toBe(200);expect(trimD1Output(text,marker).text).toBe(text)
 expect(trimD1Output('PASS '+ 'x'.repeat(19995),marker).text).toBe('PASS '+ 'x'.repeat(19995))
})
test('D1 trim records truthful kept counts and one marker per omitted region',()=>{
 const plan=trimD1Output(progress(),marker)
 expect(plan.omitted).toBeGreaterThan(0);expect(plan.kept+plan.omitted).toBe(plan.total);expect(plan.total).toBe(300)
 expect(plan.text).toContain('PASS suite-0');expect(plan.text).toContain('PASS suite-299');expect(plan.text.split('\n').length).toBe(plan.kept+plan.markers.length)
 expect(plan.markers[0]).toBe(marker(plan.omitted))
})
test('D1 trim preserves complete failures, stack lines, diagnostics, summary and trailing newline',()=>{
 const lines=progress().split('\n');lines.splice(150,0,'FAIL preserves comments','AssertionError: expected true','  at parser.ts:42:7','  expected: true','  actual: false','','warning: deprecated parser','17 fail','2 skipped')
 const output=lines.join('\n')+'\n',plan=trimD1Output(output,marker)
 for(const line of lines.slice(150,159))expect(plan.text).toContain(line)
 expect(plan.text.endsWith('\n')).toBe(true);expect(plan.omitted).toBeGreaterThan(0)
})
test('D1 trim keeps unknown output and never treats shell text as successful progress',()=>{
 const text=Array.from({length:300},(_,i)=>`unrecognized diagnostic ${i}`).join('\n')
 expect(trimD1Output(text,marker).text).toBe(text);expect(trimD1Output(text,marker).total).toBe(300)
})
test('D1 trim supports ANSI progress and keeps ANSI failure bytes',()=>{
 const text=progress().replaceAll('PASS','\u001b[32mPASS\u001b[0m')+'\n\u001b[31mFAIL\u001b[0m keep it'
 const plan=trimD1Output(text,marker);expect(plan.omitted).toBeGreaterThan(0);expect(plan.text).toContain('\u001b[31mFAIL\u001b[0m keep it')
})
test('D1 trim activates the byte threshold with multibyte UTF-8 without losing an end',()=>{
 const text=Array.from({length:100},(_,i)=>'PASS '+i+' 通过'.repeat(90)).join('\n'),plan=trimD1Output(text,marker)
 expect(plan.omitted).toBeGreaterThan(0);expect(plan.total).toBe(100);expect(plan.text).toContain('PASS 99')
})
test('D1 trim shortens only a boundary home match and keeps first and last path segments',()=>{
 expect(trimD1Path('/tmp/home/logs/abcd/1215-bun.log','/tmp/home',20)).toBe('~/logs/…/1215-bun.log')
 expect(trimD1Path('/tmp/home-other/file.log','/tmp/home',100)).toBe('/tmp/home-other/file.log')
 expect(trimD1Path('C:\\Users\\Me\\logs\\abcd\\1215-bun.log','C:\\Users\\Me',20)).toBe('~\\logs\\…\\1215-bun.log')
})
test('D1 trim defaults and unrecognized commands incur no worker or storage calls',async()=>{
 const off=harness({enabled:false});expect((await off.runtime.capture({id:'a',output:progress(),run})).output).toBe(progress());expect(off.calls.length).toBe(0)
 const h=harness();await h.runtime.capture({id:'b',output:progress()});expect(h.calls.length).toBe(0);expect((await h.runtime.capture({id:'c',output:progress(),run})).row).toBeDefined()
})
test('D1 trim writes exact full streams before replacing either stream',async()=>{
 const h=harness(),stderr='FAIL diagnostics\n  stack preserved';const result=await h.runtime.capture({id:'a',output:progress(),stderr,run})
 expect(h.calls.length).toBe(1);expect(h.calls[0].request.text).toBe(progress()+'\n'+stderr)
 expect(result.output).not.toBe(progress());expect(result.stderr).toBe(stderr);expect(result.row).toBeDefined();expect(h.runtime.row('a')).toEqual(result.row)
})
test('D1 trim denied or unavailable worker leaves original streams and no row',async()=>{
 const h=harness({fail:true}),output=progress(),stderr='FAIL unchanged';const result=await h.runtime.capture({id:'a',output,stderr,run})
 expect(result.output).toBe(output);expect(result.stderr).toBe(stderr);expect(result.row).toBeUndefined();expect(h.runtime.row('a')).toBeUndefined();expect(h.calls.length).toBeGreaterThan(0)
})
test('D1 trim turning Off cancels in-flight visibility and purges own logs after pending writes',async()=>{
 let release!:()=>void,entered!:()=>void;const began=new Promise<void>(resolve=>{entered=resolve}),held=new Promise<void>(resolve=>{release=resolve}),h=harness({hold:held,entered}),pending=h.runtime.capture({id:'a',output:progress(),run})
 await Promise.race([began,pending]);h.on(false);const off=h.runtime.settingsChanged();release();await pending;await off
 expect(h.runtime.row('a')).toBeUndefined();expect(h.calls[h.calls.length-1].request.op).toBe('purge');expect(h.calls.filter(x=>x.request.op==='write').length).toBe(1)
})
test('D1 trim refuses invalid root paths before passing raw log content to a process',async()=>{
 for(const path of ['/tmp/data/../other','relative','//server/share','C:relative','/tmp/data\u0000bad']){const h=harness({root:path});const result=await h.runtime.capture({id:'a',output:progress(),run});expect(result.row).toBeUndefined();expect(h.calls.length).toBe(0)};expect((await harness().runtime.capture({id:'a',output:progress(),run})).row).toBeDefined()
})
test('D1 trim rows use only authoritative words and correct full-log affordance per surface',async($,on)=>{
 await loadD1Art('trim',path=>Promise.resolve(D1_ART_FILES[path]!))
 await loadD1Words(()=>Promise.resolve(TRIM_WORDS_RAW))
 const h=harness(),result=await h.runtime.capture({id:'a',output:progress(),run})
 expect(result.row).toBeDefined();const row=result.row!
 on('ui.render',{component:'Pane',requestId:'d1-trim-source'},($,e)=>renderD1TrimRow($.ui.resolve(e),row,e.surface,'en'));world(on)
 const draw=async(surface:RenderSurface)=>{const ui=await $.ui.mount(pane(surface)),tree=await ui.drawn();await ui.unmount();return tree}
 for(const surface of ['desktop','vscode'] as const){const tree=await draw(surface);expect(JSON.stringify(tree)).toContain('coco:trim:open:a');expect(JSON.stringify(tree)).toContain('Full log')}
 const mobile=JSON.stringify(await draw('mobile'));expect(mobile).toContain(d1Word('en','trim.onComputer',{path:row.path}));expect(mobile).not.toContain('Button')
 const terminal=JSON.stringify(await draw('terminal'));expect(terminal).toContain('coco:trim:copy:a');expect(terminal).toContain('Copy path')
 expect(JSON.stringify(await draw('desktop'))).not.toContain('dimColor');expect(JSON.stringify(await draw('desktop'))).toContain('10');expect(d1Word('en','trim.open')).toBe('Full log')
})
test('D1 trim action keys cannot open arbitrary paths and copy uses own retained row',async()=>{
 const h=harness();await h.runtime.capture({id:'a',output:progress(),run});expect(await h.runtime.press('coco:trim:open:/etc/passwd')).toBe(false);expect(await h.runtime.press('coco:trim:copy:a')).toBe(true);expect(h.copies).toEqual([root+'/logs/abcd/2213-bun.log'])
 h.on(false);expect(await h.runtime.press('coco:trim:copy:a')).toBe(false)
})
test('D1 trim marks only inserted marker lines as inactive without touching source failures',()=>{
 const parts=d1TrimOutputParts('FAIL first\nMARKER 23\nFAIL last',['MARKER 23'])
 expect(parts).toEqual([{text:'FAIL first\n',marker:false},{text:'MARKER 23\n',marker:true},{text:'FAIL last',marker:false}])
})
test('D1 trim Off purges own logs retained from a previous activation without a new capture',async()=>{
 const h=harness({enabled:false});await h.runtime.settingsChanged();expect(h.calls.length).toBe(1);expect(h.calls[0].request.op).toBe('purge');expect(h.runtime.row('old')).toBeUndefined()
})

const renderedText=(value:any):string=>typeof value==='string'?value:Array.isArray(value)?value.map(renderedText).join(''):value&&typeof value==='object'?renderedText(value.children):''
const inactiveNodes=(value:any):any[]=>!value||typeof value!=='object'?[]:[...(value.type==='Text'&&value.props?.color==='inactive'?[value]:[]),...(value.children??[]).flatMap(inactiveNodes)]
function collisionOutput(){const lines=progress().split('\n');lines[112]='MARKER 100';lines[180]='FAIL diagnostic preserved';lines[181]='AssertionError: preserved';lines[182]='';return lines.join('\n')}
test('D1 trim exact marker indices leave identical original source lines and failure bytes unstyled',async($,on)=>{
 const plan=trimD1Output(collisionOutput(),marker),indices=(plan as any).markerLines
 expect(indices).toBeDefined();expect(plan.text.split('\n').filter(line=>line==='MARKER 100').length).toBe(2)
 on('ui.render',{component:'Pane',requestId:'d1-trim-source'},($,e)=>renderD1TrimOutput(plan.text,{id:'collision',path:root+'/logs/abcd/1234-bun.log',total:plan.total,kept:plan.kept,markers:plan.markers,markerLines:indices},$.ui.resolve(e)));world(on)
 const ui=await $.ui.mount(pane('vscode')),tree=await ui.drawn();await ui.unmount()
 expect(inactiveNodes(tree).filter(node=>renderedText(node)==='MARKER 100\n').length).toBe(1)
 expect(renderedText(tree)).toBe(plan.text);expect(renderedText(tree)).toContain('FAIL diagnostic preserved');expect(inactiveNodes(tree).some(node=>renderedText(node).includes('FAIL'))).toBe(false)
})
test('D1 trim exact composed indices account for stdout trailing newline and preserve stderr collisions',async($,on)=>{
 let render!:(ui:ElementTable)=>RenderElement
 on('ui.render',{component:'Pane',requestId:'d1-trim-source'},($,e)=>render($.ui.resolve(e)));world(on)
 await loadD1Words(()=>Promise.resolve(TRIM_WORDS_RAW))
 const firstPlan=trimD1Output(collisionOutput(),n=>d1Word('en','trim.marker',{n,what:'successful test and build progress'},n)),collision=firstPlan.markers[0]!
 const lines=progress().split('\n');lines[112]=collision;lines[180]='FAIL preserved in stderr';lines[181]='';const stderr=lines.join('\n')
 for(const trailing of ['', '\n']){
  const h=harness(),result=await h.runtime.capture({id:'precise',output:progress()+trailing,stderr,run}),row=result.row!
  expect(row).toBeDefined();expect((row as any).markerLines).toBeDefined()
  const combined=result.output+(result.stderr?(result.output&&!result.output.endsWith('\n')?'\n':'')+result.stderr:'')
  render=ui=>renderD1TrimOutput(combined,row,ui);const ui=await $.ui.mount(pane('vscode')),tree=await ui.drawn();await ui.unmount()
  expect(combined.split('\n').filter(line=>line===collision).length).toBe(2)
  expect(inactiveNodes(tree).filter(node=>renderedText(node)===collision+'\n').length).toBe(1)
  expect(renderedText(tree)).toBe(combined);expect(renderedText(tree)).toContain('FAIL preserved in stderr')
 }
})

async function captureAcrossFirstWordsTransition(mode:'start'|'off-on'){
 forgetD1Words();let releaseWords!:(raw:string)=>void,enteredWords!:()=>void,reads=0
 const entered=new Promise<void>(resolve=>{enteredWords=resolve}),held=new Promise<string>(resolve=>{releaseWords=resolve}),h=harness({readWords:()=>{reads++;enteredWords();return held}})
 const output=progress(),stderr='FAIL exact original stderr\n  at first-load.ts:7',pending=h.runtime.capture({id:'before-words-'+mode,output,stderr,run})
 await Promise.race([entered,pending]);expect(reads).toBe(1)
 if(mode==='start')h.runtime.start('new-session')
 else{h.on(false);await h.runtime.settingsChanged();h.on(true)}
 releaseWords(TRIM_WORDS_RAW);const result=await pending
 expect(result.output).toBe(output);expect(result.stderr).toBe(stderr);expect(result.row).toBeUndefined();expect(h.runtime.row('before-words-'+mode)).toBeUndefined();expect(h.calls.filter(call=>call.request.op==='write').length).toBe(0)
 if(mode==='start')expect(h.calls.length).toBe(0);else expect(h.calls.map(call=>call.request.op)).toEqual(['purge'])
}
test('D1 trim first words load cannot adopt a later session epoch or write its old streams',async()=>{await captureAcrossFirstWordsTransition('start')})
test('D1 trim first words load cannot adopt Off then On or restore its old row',async()=>{await captureAcrossFirstWordsTransition('off-on')})

async function pressAcrossLifecycle(mode:'start'|'off-on'){
 for(const action of ['open','copy'] as const){
  let releaseCheck!:()=>void,enteredCheck!:()=>void
  const entered=new Promise<void>(resolve=>{enteredCheck=resolve}),held=new Promise<void>(resolve=>{releaseCheck=resolve}),h=harness({holdCheck:held,enteredCheck})
  const old=await h.runtime.capture({id:'old-press',output:progress(),run});expect(old.row).toBeDefined()
  const pending=h.runtime.press(`coco:trim:${action}:old-press`);await Promise.race([entered,pending]);expect(h.calls.some(call=>call.request.op==='check')).toBe(true)
  let off:Promise<void>|undefined
  if(mode==='start')h.runtime.start('new-press-session');else{h.on(false);off=h.runtime.settingsChanged();h.on(true)}
  releaseCheck();expect(await pending).toBe(false);await off
  expect(h.copies.length).toBe(0);expect(h.calls.some(call=>call.request.op==='launch')).toBe(false)
  const current=await h.runtime.capture({id:'current-press',output:progress(),run});expect(current.row).toBeDefined();expect(await h.runtime.press(`coco:trim:${action}:current-press`)).toBe(true)
  if(action==='copy')expect(h.copies).toEqual([current.row!.path]);else expect(h.calls.find(call=>call.request.op==='launch')?.argv).toEqual(['open',current.row!.path])
 }
}
test('D1 trim retained-row check cannot activate a stale open or copy after a new session',async()=>{await pressAcrossLifecycle('start')})
test('D1 trim retained-row check cannot activate a stale open or copy after Off then On',async()=>{await pressAcrossLifecycle('off-on')})
