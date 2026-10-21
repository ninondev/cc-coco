import {test,expect} from 'claude-code/testing'
import {fixtureStoreReader} from './d1-store-read-fixture'
import {closeOwnedPane} from './d1-owner-test-fixture'
import {world,RECENT,MORNING,settleLegacyStart,band,PERSON,P,SUMMARY} from './world'
import {D1_WORDS_TEXT} from './d1-room-fixture'
import {C3_WORDS_RAW} from './c3-words-fixture'
import {WINDOWS_ROOTS} from './test-system'
const cwd=WINDOWS_ROOTS?'C:\\Users\\windows\\d1-approved-promises':'/tmp/d1-approved-promises'
const words=JSON.parse(D1_WORDS_TEXT)
const readText=(path:string)=>path.endsWith('d1-words.json')?D1_WORDS_TEXT:path.endsWith('c3-text.json')?C3_WORDS_RAW:undefined
const quiet={...RECENT,firstMet:MORNING-86400000,stamps:{met:MORNING-86400000,shiori:MORNING-86400000},occasions:{omenOffered:'2026-10-02',warned:{}},omen:{day:'2026-10-02',rank:1,index:0}}
async function flush($:any){for(let i=0;i<80;i++)await $.command.run({command:'d1-approved-promise-boundary',args:'',origin:PERSON,presentation:P})}
const speech=(w:ReturnType<typeof world>)=>JSON.parse(JSON.stringify({line:w.view().line??null,said:w.view().said??null,toasts:w.toasts}))
const text=(n:any):string=>typeof n==='string'?n:Array.isArray(n)?n.map(text).join(''):n&&typeof n==='object'?text(n.children):''

for(const surface of ['desktop','vscode','mobile'] as const)test(`D1 actual auto compaction on ${surface} without a band requests one12000ms first toast`,{options:{band:'off'}},async($,on)=>{
 const readStored=fixtureStoreReader(on)
 const events:{text:string;timeoutMs?:number}[]=[]
 on('ui.*',($,e,next)=>{if(next.is('ui.toast',e))events.push({text:e.text,timeoutMs:e.timeoutMs});return next(e)})
 const w=world(on,{store:{...quiet,band:'off'},surfaces:[surface],readText})
 await $.session.start({cwd,surface,isInteractive:true});await settleLegacyStart($,w)
 const first=words['shed.first'].en
 expect(events.filter(e=>e.text===first)).toEqual([])
 await $.session.compact({trigger:'auto',messages:[SUMMARY]});await w.clock.advance(0);await flush($)
 expect(events.filter(e=>e.text===first)).toEqual([{text:first,timeoutMs:12000}])
 expect((await readStored($,'occasions') as any)?.shedFirst).toBe(true)
 await w.clock.advance(12001);await $.session.compact({trigger:'auto',messages:[SUMMARY]});await w.clock.advance(0);await flush($)
 expect(events.filter(e=>e.text===first)).toEqual([{text:first,timeoutMs:12000}])
})

test('D1 actual auto compaction keeps its first line and adjacent shed direction after the1600ms animation',{options:{band:'on'}},async($,on)=>{
 const readStored=fixtureStoreReader(on)
 const w=world(on,{store:{...quiet,band:'on'},surfaces:['desktop'],readText})
 await $.session.start({cwd,surface:'desktop',isInteractive:true});await settleLegacyStart($,w)
 const ui=await $.ui.mount({surface:'desktop',...band(100)});await w.clock.advance(1600);await flush($)
 await $.session.compact({trigger:'auto',messages:[SUMMARY]});await w.clock.advance(0);await flush($);await ui.redraw()
 const first=words['shed.first'].en,direction=words['aside.shed'].en.replace(/\*/g,'')
 expect(w.view().line?.key).toBe('shed.first');expect(text(await ui.drawn())).toContain(first)
 await w.clock.advance(1601);await flush($);await ui.redraw()
 expect(w.view().line?.key).toBe('shed.first');expect(w.view().stageDirection).toBe(direction)
 const column=await ui.find({type:'Box',key:'coco:text-column'})
 expect(column).toBeDefined();expect(text(column)).toContain(first);expect(text(column)).toContain(direction)
 expect(w.toasts.filter(t=>t===first)).toEqual([])
 await ui.unmount()
})

test('D1 actual helper arrival adds no speech line said or toast',{options:{band:'on'}},async($,on)=>{
 const readStored=fixtureStoreReader(on)
 on('agent.spawn',()=>({agentId:'silent-helper',model:'fixture'}))
 const w=world(on,{store:quiet,surfaces:['desktop'],readText})
 await $.session.start({cwd,surface:'desktop',isInteractive:true});await settleLegacyStart($,w)
 const ui=await $.ui.mount({surface:'desktop',...band(100)});await $.turn.start({turnId:'main',text:'fixture work'});await flush($)
 const before=speech(w)
 await $.agent.spawn({prompt:'fixture work',description:'fixture helper',subagentType:'general-purpose'});await flush($);await ui.redraw()
 expect(w.view().helpersCount).toBe(1);expect(speech(w)).toEqual(before)
 await ui.unmount()
})

test('D1 shipping His room entry and reentry add no speech line said or toast',{options:{band:'off'}},async($,on)=>{
 const readStored=fixtureStoreReader(on)
 const w=world(on,{store:{...quiet,band:'off'},surfaces:['desktop'],readText})
 await $.session.start({cwd,surface:'desktop',isInteractive:true});await settleLegacyStart($,w)
 const before=speech(w)
 await $.command.run({command:'coco',args:'him',origin:PERSON,presentation:P})
 const ui=await $.ui.mount({surface:'desktop',plugin:'coco',component:'Pane',requestId:'coco-book',props:{title:'fixture',isFocused:true,bodyColumns:100,placement:'dock',scroll:{offset:0,bodyRows:40},view:{}}});await flush($)
 const rooms=(await ui.findAll({type:'Svg'})).filter((n:any)=>String(n.props.source).includes('viewBox="0 0 160 90"'))
 expect(rooms.length).toBe(1);expect(speech(w)).toEqual(before)
 await ui.press({key:'coco:book:tab:offerings'});await flush($)
 await ui.press({key:'coco:book:tab:him'});await flush($);await ui.redraw()
 expect((await ui.findAll({type:'Svg'})).filter((n:any)=>String(n.props.source).includes('viewBox="0 0 160 90"')).length).toBe(1)
 expect(speech(w)).toEqual(before)
 await closeOwnedPane($);await ui.unmount()
})
