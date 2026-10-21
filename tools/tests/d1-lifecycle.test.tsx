import {test,expect} from 'claude-code/testing'
import {world,RECENT,settleLegacyStart,PERSON,P,band,SUMMARY} from './world'
import {D1_WORDS_TEXT} from './d1-room-fixture'
import {d1Word,loadD1Words} from '../hooks/d1-words'
import {WINDOWS_ROOTS} from './test-system'
import {desktopRenderReceipts} from './desktop-render-receipts'
import {companionRecord} from '../hooks/companion'
import {normalizeDesktopView} from '../hooks/desktop-safe'
import {initialView} from '../hooks/mood'
const start={cwd:WINDOWS_ROOTS?'C:\\Users\\windows\\d1-lifecycle':'/tmp/d1-lifecycle',surface:'vscode' as const,isInteractive:true}
const spawn={prompt:'fixture work',description:'fixture helper',subagentType:'general-purpose'}
const usage={input_tokens:100,output_tokens:0,cache_read_input_tokens:0,cache_creation_input_tokens:0,model:'fixture'}
const text=(node:any):string=>typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.children):''
function gate(){let enter!:()=>void,release!:()=>void;return {entered:new Promise<void>(r=>enter=r),held:new Promise<void>(r=>release=r),enter:()=>enter(),release:()=>release()}}
const pane={surface:'vscode' as const,plugin:'coco',component:'Pane' as const,requestId:'coco-book',props:{title:'fixture',isFocused:true,bodyColumns:100,placement:'dock' as const,scroll:{offset:0,bodyRows:40},view:{}}}

test('D1 a spawn completing after clear cannot resurrect an old helper or helper pose',async($,on)=>{
 const blocked=gate()
 on('agent.spawn',async($,e)=>{if(e.description==='already running')return {agentId:'initial-helper',model:'fixture'};blocked.enter();await blocked.held;return {agentId:'old-helper',model:'fixture'}})
 const w=world(on,{store:RECENT,surfaces:['vscode'],readText:path=>path.endsWith('d1-words.json')?D1_WORDS_TEXT:undefined})
 await $.session.start(start);await settleLegacyStart($,w);await $.turn.start({turnId:'old',text:'old fixture turn'})
 await $.agent.spawn({...spawn,description:'already running'});expect(w.view().helpersCount).toBe(1)
 const pending=$.agent.spawn(spawn);await blocked.entered
 try{await $.command.run({command:'clear',args:'',origin:PERSON,presentation:P})}finally{blocked.release()}
 await pending
 expect(w.view().helpersCount??0).toBe(0);expect(w.view().helpers??[]).toEqual([]);expect(w.view().pose?.name==='helper').toBe(false)
 await $.command.run({command:'coco',args:'usage',origin:PERSON,presentation:P});const ui=await $.ui.mount(pane)
 const drawn=text(await ui.drawn());expect(drawn).not.toContain('fixture helper');expect(drawn).not.toContain('already running');await ui.unmount()
})

test('D1 a step completing after clear cannot add old main usage to the next helper board',async($,on)=>{
 await loadD1Words(()=>Promise.resolve(D1_WORDS_TEXT))
 const blocked=gate()
 on('turn.step',{turnId:/^(old|new-helper-turn)$/},async function*($,e){if(e.turnId==='old'){blocked.enter();await blocked.held}return {turnId:e.turnId,index:e.index,answer:'',toolUses:[],stopReason:'end_turn' as const,usage:e.turnId==='old'?{...usage,input_tokens:200}:usage}})
 on('agent.spawn',()=>({agentId:'new-helper',model:'fixture'}))
 const w=world(on,{store:RECENT,surfaces:['vscode'],readText:path=>path.endsWith('d1-words.json')?D1_WORDS_TEXT:undefined})
 await $.session.start(start);await settleLegacyStart($,w);await $.turn.start({turnId:'old',text:'old fixture turn'})
 const pending=(async()=>{for await(const _ of $.turn.step({turnId:'old',index:0,model:'fixture',messageCount:1})) {}})();await blocked.entered
 try{await $.command.run({command:'clear',args:'',origin:PERSON,presentation:P})}finally{blocked.release()}
 await pending
 await $.agent.spawn(spawn)
 for await(const _ of $.turn.step({turnId:'new-helper-turn',agentId:'new-helper',index:0,model:'fixture',messageCount:1})) {}
 await $.command.run({command:'coco',args:'usage',origin:PERSON,presentation:P});const ui=await $.ui.mount(pane),drawn=text(await ui.drawn())
 expect(drawn).toContain(d1Word('en','helpers.summary',{n:1,p:100},1));expect(drawn).not.toContain(d1Word('en','helpers.summary',{n:1,p:33},1));await ui.unmount()
})

for(const reason of ['refusal','hundredth'] as const)test(`D1 eligible ${reason} long turn produces the held completion before legacy speech`,{options:{band:'on'}},async($,on)=>{
 const w=world(on,{store:{...RECENT,turns:reason==='hundredth'?99:2,firstMet:RECENT.lastActive,stamps:{met:RECENT.lastActive,hundred:RECENT.lastActive}},surfaces:['desktop'],readText:path=>path.endsWith('d1-words.json')?D1_WORDS_TEXT:undefined})
 await $.session.start({...start,surface:'desktop'});await settleLegacyStart($,w);await $.turn.start({turnId:reason,text:'fixture long task'})
 await w.clock.advance(120000)
 await $.turn.complete({turnId:reason,answer:'fixture completed',durationMs:120000,isAborted:false,...(reason==='refusal'?{reason:'refusal' as const,refusal:{category:null,explanation:null}}:{reason:'answer' as const})})
 expect(w.view().longTask?.id).toBe(reason);expect(w.view().longTask?.durationMs).toBe(120000);expect(w.view().line?.key).toBe('long.done');expect(w.view().line?.class).toBe(1)
})

for(const branch of ['refusal','hundredth'] as const)test(`D1 main ${branch} completion returns to idle-reading while its actual helper remains running`,{options:{band:'on'}},async($,on)=>{
 on('agent.spawn',()=>({agentId:'background-helper',model:'fixture'}))
 const w=world(on,{store:{...RECENT,turns:branch==='hundredth'?99:2,firstMet:RECENT.lastActive,stamps:{met:RECENT.lastActive,hundred:RECENT.lastActive}},surfaces:['desktop'],readText:path=>path.endsWith('d1-words.json')?D1_WORDS_TEXT:undefined})
 await $.session.start({...start,surface:'desktop'});await settleLegacyStart($,w)
 await $.turn.start({turnId:branch,text:'fixture work'});await $.agent.spawn(spawn)
 expect(w.view().helpersCount).toBe(1);expect(w.view().helpers?.map(h=>h.id)).toEqual(['background-helper']);expect(w.view().pose?.name).toBe('helper')
 await $.turn.complete({turnId:branch,answer:'fixture completed',durationMs:1000,isAborted:false,...(branch==='refusal'?{reason:'refusal' as const,refusal:{category:null,explanation:null}}:{reason:'answer' as const})})
 expect(w.view().helpersCount).toBe(1);expect(w.view().helpers?.map(h=>h.id)).toEqual(['background-helper'])
 expect(w.view().stageDirection).toBe(JSON.parse(D1_WORDS_TEXT)['aside.helpers'].en.replace(/\*/g,''))
 expect(w.view().mood).toBe('idle');expect(w.view().frame).toBe('idle-reading');expect(w.view().pose).toBeUndefined()
})

test('D1 nested-only running helper keeps the completed main turn reading and awake without a main helper scroll',{options:{band:'on'}},async($,on)=>{
 on('agent.spawn',()=>({agentId:'nested-only-helper',model:'fixture'}))
 const w=world(on,{store:RECENT,surfaces:['desktop'],readText:path=>path.endsWith('d1-words.json')?D1_WORDS_TEXT:undefined})
 await $.session.start({...start,surface:'desktop'});await settleLegacyStart($,w)
 await $.turn.start({turnId:'nested-main',text:'fixture work'});await $.agent.spawn({...spawn,parentAgentId:'parent-fixture'})
 expect(w.view().helpersCount??0).toBe(0);expect(w.view().helpers??[]).toEqual([])
 await $.turn.complete({turnId:'nested-main',answer:'fixture completed',reason:'answer',durationMs:1000,isAborted:false})
 expect(w.view().stageDirection).toBe(JSON.parse(D1_WORDS_TEXT)['aside.helpers'].en.replace(/\*/g,''))
 expect(w.view().mood).toBe('idle');expect(w.view().frame).toBe('idle-reading');expect(w.view().pose).toBeUndefined()
 await w.clock.advance(240001)
 expect(w.view().mood).toBe('idle');expect(w.view().frame).toBe('idle-reading');expect(w.view().helpersCount??0).toBe(0);expect(w.view().helpers??[]).toEqual([])
 await $.command.run({command:'coco',args:'usage',origin:PERSON,presentation:P});const ui=await $.ui.mount({...pane,surface:'desktop'})
 expect(text(await ui.drawn())).toContain('fixture helper');expect(text(await ui.drawn())).toContain(JSON.parse(D1_WORDS_TEXT)['helpers.working'].en);await ui.unmount()
})

test('D1 mounted overlapping helper exits remove each scroll at its own 240ms deadline',{options:{band:'on'}},async($,on)=>{
 let id=0
 on('agent.spawn',()=>({agentId:`helper-${++id}`,model:'fixture'}))
 const w=world(on,{store:RECENT,surfaces:['desktop'],readText:path=>path.endsWith('d1-words.json')?D1_WORDS_TEXT:undefined})
 await $.session.start({...start,surface:'desktop'});await settleLegacyStart($,w)
 const ui=await $.ui.mount({surface:'desktop',...band(100)})
 await $.turn.start({turnId:'main',text:'fixture work'});await $.agent.spawn(spawn);await $.agent.spawn(spawn)
 const shown=async()=>{await ui.redraw();const tree:any=await ui.drawn();const keys:string[]=[];const visit=(n:any)=>{if(Array.isArray(n)){for(const c of n)visit(c)}else if(n&&typeof n==='object'){if(n.props?.key?.startsWith('coco:helper:'))keys.push(n.props.key);visit(n.children)}};visit(tree);return keys}
 expect(await shown()).toEqual(['coco:helper:helper-1','coco:helper:helper-2'])
 const end=(agentId:string)=>$.turn.complete({turnId:`turn-${agentId}`,agentId,answer:'',reason:'aborted',durationMs:1000,isAborted:true})
 await end('helper-1');await w.clock.advance(100);await end('helper-2')
 await w.clock.advance(139);expect(await shown()).toEqual(['coco:helper:helper-1','coco:helper:helper-2'])
 await w.clock.advance(1);expect(await shown()).toEqual(['coco:helper:helper-2'])
 await w.clock.advance(100);expect(await shown()).toEqual([])
 await ui.unmount()
})

for(const exit of ['error','aborted'] as const)test(`D1 mounted shipping desktop measures actual helper ${exit} event redraws without forcing a redraw`,{options:{band:'on'}},async($,on)=>{
 const renders=desktopRenderReceipts(on),invalidations:number[]=[],waits:number[]=[]
 on('ui.invalidate',($,e,next)=>{invalidations.push(renders.current());return next(e)})
 on('clock.*',($,e,next)=>{if(next.is('clock.after',e))waits.push(e.ms);return next(e)})
 on('agent.spawn',()=>({agentId:'measured-helper',model:'fixture'}))
 const w=world(on,{store:RECENT,surfaces:['desktop'],readText:path=>path.endsWith('d1-words.json')?D1_WORDS_TEXT:undefined})
 await $.session.start({...start,surface:'desktop'});await settleLegacyStart($,w)
 const ui=await $.ui.mount({surface:'desktop',...band(100)});await $.turn.start({turnId:'measured-main',text:'fixture work'});await renders.flush($)
 const sample=()=>({renders:renders.available?renders.current():null,invalidations:invalidations.length,scheduledTimers:waits.length,reads:w.fileReads.length})
 const scrolls=async()=>{const tree:any=await ui.drawn(),keys:string[]=[];const visit=(n:any)=>{if(Array.isArray(n)){for(const c of n)visit(c)}else if(n&&typeof n==='object'){if(n.props?.key?.startsWith('coco:helper:'))keys.push(n.props.key);visit(n.children)}};visit(tree);return keys}
 const beforeSpawn=sample();if(renders.available)expect(beforeSpawn.renders!).toBeGreaterThan(0)
 await $.agent.spawn(spawn);await renders.flush($);const afterSpawn=sample();expect(await scrolls()).toEqual(['coco:helper:measured-helper'])
 await $.turn.complete({turnId:'measured-helper-turn',agentId:'measured-helper',answer:'',reason:exit,durationMs:1000,isAborted:exit==='aborted'});await renders.flush($)
 const afterFinish=sample();expect(await scrolls()).toEqual(['coco:helper:measured-helper'])
 await w.clock.advance(239);await renders.flush($);const after239=sample();expect(await scrolls()).toEqual(['coco:helper:measured-helper'])
 await w.clock.advance(1);await renders.flush($);const after240=sample();expect(await scrolls()).toEqual([])
 const delta=(a:ReturnType<typeof sample>,b:ReturnType<typeof sample>)=>({renders:a.renders===null||b.renders===null?null:b.renders-a.renders,invalidations:b.invalidations-a.invalidations,scheduledTimers:b.scheduledTimers-a.scheduledTimers,reads:b.reads-a.reads})
 console.log('D1_HELPER_EVENT_REDRAW_METRIC '+JSON.stringify({exit,actualRenderCounterAvailable:renders.available,beforeSpawn,afterSpawn,afterFinish,after239,after240,deltas:{spawn:delta(beforeSpawn,afterSpawn),finish:delta(afterSpawn,afterFinish),finishTo239:delta(afterFinish,after239),cleanup239To240:delta(after239,after240)},forcedRedraws:0,scope:'actual shipping mounted AbovePrompt agent.spawn and failed/stopped helper turn.complete; literal virtual clock239/240; total work without baseline subtraction; native diagnostic returned-tree counter unavailable on simulated Windows'}))
 await ui.unmount()
})

test('D1 held long completion arms its four-hour cap only after the band is actually drawn',{options:{band:'on'}},async($,on)=>{
 const waits:number[]=[]
 on('clock.*',($,e,next)=>{if(next.is('clock.after',e))waits.push(e.ms);return next(e)})
 const w=world(on,{store:{...RECENT,firstMet:RECENT.lastActive,stamps:{met:RECENT.lastActive}},surfaces:['desktop'],readText:path=>path.endsWith('d1-words.json')?D1_WORDS_TEXT:undefined})
 await $.session.start({...start,surface:'desktop'});await settleLegacyStart($,w)
 await $.turn.start({turnId:'long-unmounted',text:'fixture work'});await w.clock.advance(120000)
 await $.turn.complete({turnId:'long-unmounted',answer:'fixture done',reason:'answer',durationMs:120000,isAborted:false})
 expect(w.view().line?.key).toBe('long.done');expect(waits.filter(ms=>ms===14400000)).toEqual([])
 const ui=await $.ui.mount({surface:'desktop',...band(100)})
 await w.clock.advance(0)
 for(let i=0;i<80;i++)await $.command.run({command:'d1-cap-fixture-boundary',args:'',origin:PERSON,presentation:P})
 expect(waits.filter(ms=>ms===14400000).length).toBeGreaterThan(0)
 await ui.unmount()
})

test('D1 changing long reminder mode updates a held completion and Off clears it',{options:{band:'on'}},async($,on)=>{
 const w=world(on,{store:{...RECENT,longTask:'notify'},surfaces:['desktop'],readText:path=>path.endsWith('d1-words.json')?D1_WORDS_TEXT:undefined})
 await $.session.start({...start,surface:'desktop'});await settleLegacyStart($,w)
 await $.turn.start({turnId:'held-mode',text:'fixture work'});await w.clock.advance(120000)
 await $.turn.complete({turnId:'held-mode',answer:'fixture done',reason:'answer',durationMs:120000,isAborted:false})
 expect(w.view().longTask?.mode).toBe('notify')
 await $.command.run({command:'coco',args:'settings',origin:PERSON,presentation:P})
 const ui=await $.ui.mount({...pane,surface:'desktop'})
 await ui.press({key:'coco:set:longtask:band'})
 expect(w.view().longTask?.mode).toBe('band');expect(w.view().longTask?.id).toBe('held-mode')
 await ui.press({key:'coco:set:longtask:off'})
 expect(w.view().longTask).toBeUndefined();expect(w.view().line?.key==='long.done').toBe(false)
 await ui.unmount()
})

test('D1 compaction completing a gated clock read after clear does not load old shed cuts or affect the new helper',async($,on)=>{
 const blocked=gate();let armClock=false
 on('session.compact',{trigger:'manual'},()=>{armClock=true;return {messages:[SUMMARY],tokensBefore:1000,tokensAfter:100}})
 on('clock.*',async($,e,next)=>{if(next.is('clock.now',e)&&armClock){armClock=false;blocked.enter();await blocked.held}return next(e)})
 on('agent.spawn',()=>({agentId:'after-clear-helper',model:'fixture'}))
 on('process.run',()=>({value:{exitCode:1,stdout:'',stderr:'fixture decoder unavailable',isStdoutTruncated:false,isStderrTruncated:false}}))
 const w=world(on,{store:RECENT,surfaces:['vscode'],readText:path=>path.endsWith('d1-words.json')?D1_WORDS_TEXT:undefined})
 await $.session.start(start);await settleLegacyStart($,w)
 const pending=$.session.compact({trigger:'manual',messages:[SUMMARY]});await blocked.entered
 const cuts=()=>w.fileReads.filter(path=>/[\\/]assets[\\/](?:shed[\\/]band-skin|pixel[\\/]4[234]-shed-[abc])\.png$/.test(path))
 let before:string[]=[]
 try{
  await $.command.run({command:'clear',args:'',origin:PERSON,presentation:P});await $.turn.start({turnId:'after-clear-main',text:'fixture replacement work'});await $.agent.spawn(spawn)
  expect(w.view().helpersCount).toBe(1);expect(w.view().pose?.name).toBe('helper');expect(w.view().shed).toBeUndefined()
  before=[...cuts()]
  expect(before).toEqual([])
 }finally{blocked.release()}
 await pending
 expect(cuts()).toEqual(before);expect(w.view().helpersCount).toBe(1);expect(w.view().helpers?.map(h=>h.id)).toEqual(['after-clear-helper']);expect(w.view().pose?.name).toBe('helper');expect(w.view().shed).toBeUndefined();expect(w.view().line?.key==='shed.first').toBe(false)
 console.log('D1_COMPACT_CANCEL_METRIC '+JSON.stringify({clockGate:'first clock.now after successful session.compact next result',beforeReleaseShedAssetReads:before,afterStaleCompletionShedAssetReads:cuts(),scope:'actual session.compact/clear/agent.spawn shipping hooks; no old shed asset work or derived state after clear'}))
})

test('D1 a completed background notification redrawn after two minutes cannot turn a short task into a long completion',{options:{band:'on'}},async($,on)=>{
 on('agent.spawn',()=>({agentId:'short-background',model:'fixture'}))
 const w=world(on,{store:RECENT,surfaces:['desktop'],readText:path=>path.endsWith('d1-words.json')?D1_WORDS_TEXT:undefined})
 const flush=async()=>{await w.clock.advance(0);for(let i=0;i<20;i++)await $.command.run({command:'d1-short-quiet-boundary',args:'',origin:PERSON,presentation:P})}
 await $.session.start({...start,surface:'desktop'});await settleLegacyStart($,w)
 await $.turn.start({turnId:'short-background-main',text:'fixture short work'});await $.agent.spawn(spawn)
 expect(w.view().helpersCount).toBe(1)
 await w.clock.advance(1000)
 const notice=await $.ui.mount({surface:'desktop',plugin:'coco',component:'UserMessage',requestId:'short-background-completion',props:{text:'fixture completed task',origin:{kind:'task-notification'},task:{id:'short-background',status:'completed',durationMs:1000}},viewport:{columns:120,rows:40}})
 await notice.drawn();await flush();expect(w.view().helpersCount).toBe(0)
 await w.clock.advance(59000)
 await $.turn.complete({turnId:'short-background-main',answer:'fixture completed',reason:'answer',durationMs:60000,isAborted:false})
 expect(w.view().longTask).toBeUndefined();expect(w.view().line?.key==='long.done').toBe(false)
 await w.clock.advance(120000);await notice.redraw();await notice.drawn();await flush()
 expect(w.view().longTask).toBeUndefined();expect(w.view().line?.key==='long.done').toBe(false)
 await notice.unmount()
})

test('D1 answering a question restores eligibility when resumed work finishes as a long task',{options:{band:'on'}},async($,on)=>{
 let questionSeen=false
 const w=world(on,{store:{...RECENT,firstMet:RECENT.lastActive,stamps:{met:RECENT.lastActive}},surfaces:['desktop'],readText:path=>path.endsWith('d1-words.json')?D1_WORDS_TEXT:undefined,onTool:tool=>{if(tool==='AskUserQuestion'){questionSeen=true;expect(w.view().mood).toBe('question')}}})
 await $.session.start({...start,surface:'desktop'});await settleLegacyStart($,w)
 await $.turn.start({turnId:'answered-question-main',text:'fixture work'})
 const answer=await $.tool.call({tool:'AskUserQuestion',questions:[]})
 expect(questionSeen).toBe(true);expect(answer.isError).not.toBe(true);expect(answer.deny).toBeUndefined();expect(w.view().mood).toBe('work')
 await $.tool.call({tool:'Read',file_path:start.cwd+'/fixture.txt'})
 await w.clock.advance(120000)
 await $.turn.complete({turnId:'answered-question-main',answer:'fixture completed after answer',reason:'answer',durationMs:120000,isAborted:false})
 expect(w.view().longTask?.id).toBe('answered-question-main');expect(w.view().longTask?.durationMs).toBe(120000);expect(w.view().line?.key).toBe('long.done')
})

test('D1 a main turn ending while its question is still outstanding does not emit a long completion',{options:{band:'on'}},async($,on)=>{
 const blocked=gate()
 const w=world(on,{store:RECENT,surfaces:['desktop'],readText:path=>path.endsWith('d1-words.json')?D1_WORDS_TEXT:undefined,hold:async tool=>{if(tool==='AskUserQuestion'){blocked.enter();await blocked.held}}})
 await $.session.start({...start,surface:'desktop'});await settleLegacyStart($,w)
 await $.turn.start({turnId:'outstanding-question-main',text:'fixture work'})
 const pending=$.tool.call({tool:'AskUserQuestion',questions:[]});await blocked.entered
 try{
  expect(w.view().mood).toBe('question');await w.clock.advance(120000)
  await $.turn.complete({turnId:'outstanding-question-main',answer:'fixture waiting for answer',reason:'answer',durationMs:120000,isAborted:false})
  expect(w.view().longTask).toBeUndefined();expect(w.view().line?.key==='long.done').toBe(false)
 }finally{blocked.release()}
 await pending
 expect(w.view().longTask).toBeUndefined();expect(w.view().line?.key==='long.done').toBe(false)
})

test('D1 a helper tool crossing clear during its clock read forwards the tool without charging the new helper',async($,on)=>{
 await loadD1Words(()=>Promise.resolve(D1_WORDS_TEXT))
 const blocked=gate();let armClock=false,forwarded=0
 on('clock.*',async($,e,next)=>{if(next.is('clock.now',e)&&armClock){armClock=false;blocked.enter();await blocked.held}return next(e)})
 on('agent.spawn',()=>({agentId:'reused-helper',model:'fixture'}))
 const w=world(on,{store:RECENT,surfaces:['vscode'],readText:path=>path.endsWith('d1-words.json')?D1_WORDS_TEXT:undefined,onTool:tool=>{if(tool==='Read')forwarded++}})
 await $.session.start(start);await settleLegacyStart($,w)
 await $.turn.start({turnId:'old-tool-main',text:'fixture work'});await $.agent.spawn(spawn)
 armClock=true
 const pending=$.tool.call({tool:'Read',file_path:start.cwd+'/fixture.txt',agentId:'reused-helper'});await blocked.entered
 try{
  await $.command.run({command:'clear',args:'',origin:PERSON,presentation:P})
  await $.turn.start({turnId:'new-tool-main',text:'fixture new work'});await $.agent.spawn({...spawn,description:'new helper after clear'})
  expect(w.view().helpersCount).toBe(1);expect(forwarded).toBe(0)
 }finally{blocked.release()}
 await pending;expect(forwarded).toBe(1)
 await $.turn.complete({turnId:'new-tool-main',answer:'fixture main done',reason:'answer',durationMs:1000,isAborted:false})
 expect(w.view().helpersCount).toBe(1)
 // A running row no longer carries its tool count (dot sweep), so the helper stops before the count is read.
 await $.turn.complete({turnId:'new-helper-turn',agentId:'reused-helper',answer:'',reason:'aborted',durationMs:1000,isAborted:true})
 await $.command.run({command:'coco',args:'usage',origin:PERSON,presentation:P});const ui=await $.ui.mount(pane),drawn=text(await ui.drawn())
 expect(drawn).toContain('new helper after clear');expect(drawn).toContain(d1Word('en','helpers.toolUses',{n:'0'},0));expect(drawn).not.toContain(d1Word('en','helpers.toolUses',{n:'1'},1));await ui.unmount()
})

test('D1 an old Agent result cannot finish a new helper when clear reuses the call identity',async($,on)=>{
 const blocked=gate();let spawnIndex=0,seenOldId=''
 on('agent.spawn',()=>({agentId:++spawnIndex===1?'old-agent':'new-agent',model:'fixture'}))
 on('tool.call',{tool:'Agent'},async($,e)=>{seenOldId=e.tool_use_id;blocked.enter();await blocked.held;return {result:{status:'completed',agentId:'old-agent',totalTokens:937,totalDurationMs:4500,totalToolUseCount:7}}})
 const w=world(on,{store:RECENT,surfaces:['vscode'],readText:path=>path.endsWith('d1-words.json')?D1_WORDS_TEXT:undefined})
 await $.session.start(start);await settleLegacyStart($,w)
 await $.turn.start({turnId:'old-agent-main',text:'fixture old work'})
 await $.agent.spawn({...spawn,tool_use_id:'reused-agent-call'})
 const pending=$.tool.call({tool:'Agent',prompt:'fixture work',description:'fixture old helper',subagent_type:'general-purpose',tool_use_id:'reused-agent-call'});await blocked.entered
 try{
  expect(seenOldId).toBe('reused-agent-call')
  await $.command.run({command:'clear',args:'',origin:PERSON,presentation:P})
  await $.turn.start({turnId:'new-agent-main',text:'fixture new work'});await $.agent.spawn({...spawn,description:'new agent after clear',tool_use_id:seenOldId})
  expect(w.view().helpersCount).toBe(1);expect(w.view().helpers?.map(h=>h.id)).toEqual(['new-agent'])
 }finally{blocked.release()}
 const result=await pending;expect((result.result as {totalTokens?:number})?.totalTokens).toBe(937)
 expect(w.view().helpersCount).toBe(1);expect(w.view().helpers?.map(h=>h.id)).toEqual(['new-agent']);expect(w.view().helpers?.[0]?.state).toBe('running')
 await $.command.run({command:'coco',args:'usage',origin:PERSON,presentation:P});const ui=await $.ui.mount(pane),drawn=text(await ui.drawn())
 expect(drawn).toContain('new agent after clear');expect(drawn).toContain(d1Word('en','helpers.working'));expect(drawn).not.toContain('937');await ui.unmount()
})

test('D1 a delayed CwdChanged from an ended session cannot overwrite the replacement session folder',async($,on)=>{
 let fixtureCwd=start.cwd
 on('session.*',($,e,next)=>{if(next.is('session.turns',e))return {value:0};if(next.is('session.root',e))return {value:fixtureCwd};if(next.is('session.start',e))fixtureCwd=e.cwd;return next(e)})
 const blocked=gate(),oldDestination=WINDOWS_ROOTS?'C:\\Users\\windows\\old-delayed-folder':'/tmp/old-delayed-folder',replacementCwd=WINDOWS_ROOTS?'C:\\Users\\windows\\replacement-folder':'/tmp/replacement-folder'
 on('classic.CwdChanged',async()=>{blocked.enter();await blocked.held;return {}})
 on('session.end',($,e)=>({sessionId:e.sessionId}))
 const w=world(on,{sessionTurns:false,store:RECENT,surfaces:['vscode'],readText:path=>path.endsWith('d1-words.json')?D1_WORDS_TEXT:undefined})
 await $.session.start(start);await settleLegacyStart($,w)
 expect(w.view().ribbon?.folder).toBe('d1-lifecycle')
 const pending=$.classic.CwdChanged({old_cwd:start.cwd,new_cwd:oldDestination});await blocked.entered
 try{
  await $.session.end({reason:'clear',sessionId:'old-cwd-session',resume:{id:'old-cwd-session'}})
  await $.session.start({...start,cwd:replacementCwd});await settleLegacyStart($,w)
  expect(w.view().ribbon?.folder).toBe('replacement-folder')
 }finally{blocked.release()}
 await pending
 expect(w.view().ribbon?.folder).toBe('replacement-folder');expect(w.view().ribbon?.folder).not.toBe('old-delayed-folder')
})

test('D1 a main completion crossing clear during its clock read cannot finalize the replacement turn',{options:{band:'on'}},async($,on)=>{
 const blocked=gate();let armClock=false
 on('turn.*',($,e,next)=>{if(next.is('turn.complete',e)&&e.turnId==='old-clock-completion')armClock=true;return next(e)})
 on('clock.*',async($,e,next)=>{if(next.is('clock.now',e)&&armClock){armClock=false;blocked.enter();await blocked.held}return next(e)})
 const w=world(on,{store:{...RECENT,firstMet:RECENT.lastActive,stamps:{met:RECENT.lastActive}},surfaces:['desktop'],readText:path=>path.endsWith('d1-words.json')?D1_WORDS_TEXT:undefined})
 await $.session.start({...start,surface:'desktop'});await settleLegacyStart($,w)
 await $.turn.start({turnId:'old-clock-completion',text:'fixture old work'});await w.clock.advance(1000)
 const pending=$.turn.complete({turnId:'old-clock-completion',answer:'fixture old answer',reason:'answer',durationMs:1000,isAborted:false});await blocked.entered
 let replacementAt=0
 try{
  await $.command.run({command:'clear',args:'',origin:PERSON,presentation:P})
  await $.turn.start({turnId:'replacement-clock-turn',text:'fixture replacement work'});replacementAt=w.clock.now()
  expect(w.view().mood).toBe('think');expect(w.view().longTask).toBeUndefined()
 }finally{blocked.release()}
 await pending
 expect(w.view().mood).toBe('think');expect(w.view().longTask).toBeUndefined();expect(w.view().line?.key==='long.done').toBe(false)
 await $.tool.call({tool:'Read',file_path:start.cwd+'/fixture.txt'});expect(w.view().mood).toBe('work')
 await w.clock.advance(120000)
 await $.turn.complete({turnId:'replacement-clock-turn',answer:'fixture replacement answer',reason:'answer',durationMs:120000,isAborted:false})
 expect(w.view().longTask?.id).toBe('replacement-clock-turn');expect(w.view().longTask?.startedAt).toBe(replacementAt);expect(w.view().longTask?.completedAt).toBe(replacementAt+120000);expect(w.view().longTask?.durationMs).toBe(120000);expect(w.view().line?.key).toBe('long.done')
})

test('D1 a turn start crossing clear during its clock read preserves the replacement tool and long task',{options:{band:'on'}},async($,on)=>{
 const blocked=gate(),toolGate=gate();let armClock=false
 on('turn.*',($,e,next)=>{if(next.is('turn.start',e)&&e.turnId==='old-clock-start')armClock=true;return next(e)})
 on('clock.*',async($,e,next)=>{if(next.is('clock.now',e)&&armClock){armClock=false;blocked.enter();await blocked.held}return next(e)})
 const w=world(on,{store:{...RECENT,firstMet:RECENT.lastActive,stamps:{met:RECENT.lastActive}},surfaces:['desktop'],readText:path=>path.endsWith('d1-words.json')?D1_WORDS_TEXT:undefined,hold:async tool=>{if(tool==='Grep'){toolGate.enter();await toolGate.held}}})
 await $.session.start({...start,surface:'desktop'});await settleLegacyStart($,w)
 const pending=$.turn.start({turnId:'old-clock-start',text:'fixture old start'});await blocked.entered
 let replacementAt=0,activeTool:Promise<unknown>|undefined
 try{
  await $.command.run({command:'clear',args:'',origin:PERSON,presentation:P});await w.clock.advance(1000)
  await $.turn.start({turnId:'replacement-after-start',text:'fixture replacement work'});replacementAt=w.clock.now()
  await w.clock.advance(1200)
  activeTool=$.tool.call({tool:'Grep',pattern:'fixture',path:start.cwd});await toolGate.entered
  const before=w.view().pose;expect(before?.name).toBe('search');expect(w.view().longTask).toBeUndefined()
  blocked.release();await pending
  expect(w.view().pose?.name).toBe(before?.name);expect(w.view().pose?.frame).toBe(before?.frame);expect(w.view().pose?.at).toBe(before?.at);expect(w.view().longTask).toBeUndefined()
 }finally{blocked.release();toolGate.release()}
 await activeTool
 await w.clock.advance(replacementAt+120000-w.clock.now())
 await $.turn.complete({turnId:'replacement-after-start',answer:'fixture replacement completed',reason:'answer',durationMs:120000,isAborted:false})
 expect(w.view().longTask?.id).toBe('replacement-after-start');expect(w.view().longTask?.startedAt).toBe(replacementAt);expect(w.view().longTask?.completedAt).toBe(replacementAt+120000);expect(w.view().longTask?.durationMs).toBe(120000);expect(w.view().line?.key).toBe('long.done')
})

test('D1 the oldest of65 helpers keeps its shipping scroll and companion projection after the other64 leave',{options:{band:'on'}},async($,on)=>{
 let serial=0
 on('agent.spawn',()=>({agentId:'overflow-helper-'+ ++serial,model:'fixture'}))
 const w=world(on,{store:{...RECENT,firstMet:RECENT.lastActive,stamps:{met:RECENT.lastActive,shiori:RECENT.lastActive},occasions:{shedFirst:true,twoFirst:true,warned:{}}},surfaces:['desktop'],readText:path=>path.endsWith('d1-words.json')?D1_WORDS_TEXT:undefined})
 const flush=async()=>{await w.clock.advance(0);for(let i=0;i<20;i++)await $.command.run({command:'d1-overflow-boundary',args:'',origin:PERSON,presentation:P})}
 await $.session.start({...start,surface:'desktop'});await settleLegacyStart($,w)
 const ui=await $.ui.mount({surface:'desktop',...band(100)})
 const scrolls=async()=>{await ui.redraw();const keys:string[]=[];const visit=(n:any)=>{if(Array.isArray(n)){for(const child of n)visit(child)}else if(n&&typeof n==='object'){if(n.props?.key?.startsWith('coco:helper:'))keys.push(n.props.key);visit(n.children)}};visit(await ui.drawn());return keys}
 await $.turn.start({turnId:'overflow-main',text:'fixture work'})
 for(let i=0;i<65;i++)await $.agent.spawn({...spawn,description:'fixture helper '+i})
 expect(w.view().helpersCount).toBe(65)
 const firstThree=['overflow-helper-1','overflow-helper-2','overflow-helper-3']
 expect(w.view().helpers?.length).toBe(64);expect(w.view().helpers?.slice(0,3).map(h=>h.id)).toEqual(firstThree)
 const restored=normalizeDesktopView(w.view(),initialView(),[w.view().frame])
 expect(restored.helpers?.length).toBe(64);expect(restored.helpers?.slice(0,3).map(h=>h.id)).toEqual(firstThree)
 expect(companionRecord(w.view()).helpers?.length).toBe(64);expect(companionRecord(w.view()).helpers?.slice(0,3).map(h=>h.id)).toEqual(firstThree)
 expect((await scrolls()).slice(0,3)).toEqual(firstThree.map(id=>'coco:helper:'+id))
 await w.clock.advance(20000);await $.turn.complete({turnId:'overflow-main',answer:'fixture main done',reason:'answer',durationMs:20000,isAborted:false})
 for(let i=2;i<=65;i++)await $.turn.complete({turnId:'helper-turn-'+i,agentId:'overflow-helper-'+i,answer:'',reason:'aborted',durationMs:20000,isAborted:true})
 await w.clock.advance(240)
 expect(w.view().helpersCount).toBe(1);expect(w.view().mood).toBe('idle');expect(w.view().frame).toBe('idle-reading');expect(w.view().helpers?.map(h=>[h.id,h.state])).toEqual([['overflow-helper-1','running']])
 expect(await scrolls()).toEqual(['coco:helper:overflow-helper-1']);expect(companionRecord(w.view()).helpers?.map(h=>[h.id,h.state])).toEqual([['overflow-helper-1','running']])
 await w.clock.advance(240001)
 expect(w.view().mood).toBe('idle');expect(w.view().frame).toBe('idle-reading');expect(w.view().helpersCount).toBe(1);expect(await scrolls()).toEqual(['coco:helper:overflow-helper-1'])
 const notice=await $.ui.mount({surface:'desktop',plugin:'coco',component:'UserMessage',requestId:'oldest-overflow-completion',props:{text:'fixture oldest helper done',origin:{kind:'task-notification'},task:{id:'overflow-helper-1',status:'completed',durationMs:260241}},viewport:{columns:120,rows:40}})
 await notice.drawn();await flush()
 expect(w.view().helpersCount).toBe(0);expect(w.view().helpers?.[0]?.state).toBe('done');expect(await scrolls()).toEqual(['coco:helper:overflow-helper-1']);expect(companionRecord(w.view()).helpers?.[0]?.state).toBe('done')
 await w.clock.advance(239);expect(await scrolls()).toEqual(['coco:helper:overflow-helper-1'])
 await w.clock.advance(1);expect(await scrolls()).toEqual([]);expect(w.view().helpers??[]).toEqual([]);expect(companionRecord(w.view()).helpers??[]).toEqual([])
 await notice.unmount();await ui.unmount()
})


test('D1 the youngest of65 helpers remains represented while the older64 leave the bounded shipping projection',{options:{band:'on'}},async($,on)=>{
 let serial=0
 on('agent.spawn',()=>({agentId:'youngest-helper-'+ ++serial,model:'fixture'}))
 const w=world(on,{store:RECENT,surfaces:['desktop'],readText:path=>path.endsWith('d1-words.json')?D1_WORDS_TEXT:undefined})
 await $.session.start({...start,surface:'desktop'});await settleLegacyStart($,w)
 const ui=await $.ui.mount({surface:'desktop',...band(100)})
 const drawn=async()=>{await ui.redraw();const nodes:any[]=[];const visit=(n:any)=>{if(Array.isArray(n)){for(const child of n)visit(child)}else if(n&&typeof n==='object'){nodes.push(n);visit(n.children)}};visit(await ui.drawn());return nodes}
 await $.turn.start({turnId:'youngest-main',text:'fixture work'})
 for(let i=0;i<65;i++)await $.agent.spawn({...spawn,description:'fixture helper '+i})
 expect(w.view().helpersCount).toBe(65)
 await w.clock.advance(20000);await $.turn.complete({turnId:'youngest-main',answer:'fixture main done',reason:'answer',durationMs:20000,isAborted:false})
 for(let i=1;i<=64;i++)await $.turn.complete({turnId:'youngest-turn-'+i,agentId:'youngest-helper-'+i,answer:'',reason:'aborted',durationMs:20000,isAborted:true})
 const retained=async()=>{
  expect(w.view().helpersCount).toBe(1);expect(w.view().helpers?.length).toBe(64)
  expect(w.view().helpers?.slice(0,3).map(h=>h.id)).toEqual(['youngest-helper-1','youngest-helper-2','youngest-helper-3'])
  expect(w.view().helpers?.filter(h=>h.state==='running').map(h=>h.id)).toEqual(['youngest-helper-65'])
  const restored=normalizeDesktopView(w.view(),initialView(),[w.view().frame]),record=companionRecord(w.view())
  expect(restored.helpers?.length).toBe(64);expect(restored.helpers?.filter(h=>h.state==='running').map(h=>h.id)).toEqual(['youngest-helper-65'])
  expect(record.helpers?.length).toBe(64);expect(record.helpers?.filter(h=>h.state==='running').map(h=>h.id)).toEqual(['youngest-helper-65'])
  const bundleBox=(await drawn()).find(n=>n.props?.key==='coco:helper:bundle')
  const bundle=(Array.isArray(bundleBox?.children)?bundleBox.children:[bundleBox?.children]).find((n:any)=>n?.type==='Svg')
  // the helpers are paper planes (lane C, 10-14): thrown in (pa), not yet flown back (pd) or dropped (pf)
  expect(bundle).toBeDefined();expect(bundle.props.source).not.toMatch(/@keyframes p[df]\{/);expect(bundle.props.source).toContain('@keyframes pa')
 }
 await retained();await w.clock.advance(220);await retained();await w.clock.advance(19);await retained()
 await w.clock.advance(1)
 expect(w.view().helpersCount).toBe(1);expect(w.view().helpers?.map(h=>[h.id,h.state])).toEqual([['youngest-helper-65','running']])
 expect(normalizeDesktopView(w.view(),initialView(),[w.view().frame]).helpers?.map(h=>h.id)).toEqual(['youngest-helper-65'])
 expect(companionRecord(w.view()).helpers?.map(h=>h.id)).toEqual(['youngest-helper-65'])
 expect((await drawn()).filter(n=>n.props?.key?.startsWith('coco:helper:')).map(n=>n.props.key)).toEqual(['coco:helper:youngest-helper-65'])
 await ui.unmount()
})
