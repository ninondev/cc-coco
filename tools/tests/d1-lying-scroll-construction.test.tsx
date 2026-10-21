import {test,expect} from 'claude-code/testing'
import {world,RECENT,settleLegacyStart,PERSON,P} from './world'
import {closeOwnedPane} from './d1-owner-test-fixture'
import {D1_WORDS_TEXT} from './d1-room-fixture'
import {C3_WORDS_RAW} from './c3-words-fixture'
import {WINDOWS_ROOTS} from './test-system'
const pane={surface:'desktop' as const,plugin:'coco',component:'Pane' as const,requestId:'coco-book',props:{title:'fixture',isFocused:true,bodyColumns:100,placement:'dock' as const,scroll:{offset:0,bodyRows:40},view:{}}}
async function flush($:any){for(let i=0;i<80;i++)await $.command.run({command:'d1-lying-construction-boundary',args:'',origin:PERSON,presentation:P})}
// Instrumented acquired source only: the fixture command reads the constructor
// counter from the SAME hook-module instance as actual shipping desktopBook.
test('D1 actual Offerings repeated stopped-picture input constructs its lying scroll once',{options:{band:'off'}},async($,on)=>{
 let id=0;on('agent.spawn',()=>({agentId:'lying-'+(++id),model:'fixture'}))
 const w=world(on,{store:{...RECENT,band:'off'},surfaces:['desktop'],readText:path=>path.endsWith('d1-words.json')?D1_WORDS_TEXT:path.endsWith('c3-text.json')?C3_WORDS_RAW:undefined})
 await $.session.start({cwd:WINDOWS_ROOTS?'C:\\Users\\windows\\d1-lying-construction':'/tmp/d1-lying-construction',surface:'desktop',isInteractive:true});await settleLegacyStart($,w)
 for(let n=1;n<=2;n++){
  await $.agent.spawn({prompt:'fixture work',description:'fixture stopped helper'+n,subagentType:'general-purpose'})
  await $.turn.complete({turnId:'lying-turn-'+n,agentId:'lying-'+n,answer:'',reason:'aborted',durationMs:1000,isAborted:true})
 }
 const count=async()=>Number((await $.command.run({command:'d1-fixture-lying-construction-count',args:'',origin:PERSON,presentation:P})).text)
 expect(await count()).toBe(0)
 await $.command.run({command:'coco',args:'usage',origin:PERSON,presentation:P});const ui=await $.ui.mount(pane);await flush($)
 const pictures=(await ui.findAll({type:'Svg'})).map((n:any)=>String(n.props.source)).filter((source:string)=>source.includes('viewBox="0 0 18 9"'))
 expect(pictures.length).toBe(2);expect(new Set(pictures).size).toBe(1)
 expect(await count()).toBe(1)
 await closeOwnedPane($);await ui.unmount()
})
