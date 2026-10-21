import {test,expect} from 'claude-code/testing'
import {fixtureStoreReader} from './d1-store-read-fixture'
import {closeOwnedPane,observeOwnedPaneRenders} from './d1-owner-test-fixture'
import {world,RECENT,MORNING,settleLegacyStart,band,PERSON,P,SUMMARY} from './world'
import {desktopRenderReceipts} from './desktop-render-receipts'
import {D1_WORDS_TEXT} from './d1-room-fixture'
import {C3_WORDS_RAW} from './c3-words-fixture'
import {D1_ROOM_ASSET_FILES} from './d1-room-assets-fixture'
import {WINDOWS_ROOTS} from './test-system'
import {WORDS} from '../hooks/words'

const start={cwd:WINDOWS_ROOTS?'C:\\Users\\windows\\d1-book-lifecycle':'/tmp/d1-book-lifecycle',surface:'desktop' as const,isInteractive:true}
const pane={surface:'desktop' as const,plugin:'coco',component:'Pane' as const,requestId:'coco-book',props:{title:'fixture',isFocused:true,bodyColumns:100,placement:'dock' as const,scroll:{offset:0,bodyRows:40},view:{}}}
const readText=(path:string)=>path.endsWith('d1-words.json')?D1_WORDS_TEXT:path.endsWith('c3-text.json')?C3_WORDS_RAW:undefined
async function flush($:any){for(let i=0;i<80;i++)await $.command.run({command:'d1-book-source-boundary',args:'',origin:PERSON,presentation:P})}
const roomReads=(reads:string[])=>reads.filter(path=>/[\\/]assets[\\/]coco-room[\\/]/.test(path))
const roomDrawn=async(ui:any)=>(await ui.findAll({type:'Svg'})).filter((n:any)=>String(n.props.source).includes('viewBox="0 0 160 90"'))
const open=($:any,page:string)=>$.command.run({command:'coco',args:page,origin:PERSON,presentation:P})

for(const lang of ['ja','ko'] as const)test(`D1 shipping His Pane renders approved ${lang} room direction without literal stars beside its room picture`,{options:{band:'off',language:lang}},async($,on)=>{
 const readStored=fixtureStoreReader(on)
 const source=JSON.parse(D1_WORDS_TEXT)['direction.room'][lang] as string
 // SPEC0.3:196 renders exact reviewed direction.room text with italic styling.
 expect(source).not.toContain('*')
 const w=world(on,{store:{...RECENT,band:'off',lang},surfaces:['desktop'],readText})
 await $.session.start(start);await settleLegacyStart($,w);expect(w.view().lang).toBe(lang)
 await open($,'him');const ui=await $.ui.mount(pane);await flush($)
 expect((await roomDrawn(ui)).length).toBe(1)
 expect(await ui.find({type:'Text',text:'✻ '+WORDS[lang].name})).toBeDefined()
 expect(await ui.find({type:'Text',text:source.replace(/\*/g,'')})).toBeDefined()
 expect(await ui.find({type:'Text',text:'*'+source+'*'})).toBeUndefined()
 expect(JSON.parse(D1_WORDS_TEXT)['direction.room'][lang]).toBe(source)
 await closeOwnedPane($);await ui.unmount()
})

test('D1 shipping His page alone loads room layers, keeps redraw cache, and reloads after tab and close',{options:{band:'off'}},async($,on)=>{
 const readStored=fixtureStoreReader(on)
 let draws=0;const waits:number[]=[],invalidations:number[]=[]
 observeOwnedPaneRenders(on,count=>{draws=count})
 on('clock.*',($,e,next)=>{if(next.is('clock.after',e))waits.push(e.ms);return next(e)})
 on('ui.invalidate',($,e,next)=>{invalidations.push(draws);return next(e)})
 const w=world(on,{store:{...RECENT,band:'off'},surfaces:['desktop'],readText})
 await $.session.start(start);await settleLegacyStart($,w);await open($,'usage')
 let ui=await $.ui.mount(pane);await flush($)
 expect(draws).toBeGreaterThan(0);expect(roomReads(w.fileReads)).toEqual([]);expect(await roomDrawn(ui)).toEqual([])
 await ui.press({key:'coco:book:tab:him'});await flush($);await ui.redraw()
 const expected=Object.keys(D1_ROOM_ASSET_FILES).sort()
 expect(roomReads(w.fileReads).map(path=>path.split(/[\\/]/).pop()!).sort()).toEqual(expected)
 expect((await roomDrawn(ui)).length).toBe(1)
 const first=roomReads(w.fileReads).length;await ui.redraw();await ui.redraw();expect(roomReads(w.fileReads).length).toBe(first)
 await ui.press({key:'coco:book:tab:offerings'});await flush($);await ui.redraw();expect(await roomDrawn(ui)).toEqual([])
 await ui.press({key:'coco:book:tab:him'});await flush($);await ui.redraw();expect(roomReads(w.fileReads).length).toBe(first*2)
 await closeOwnedPane($);await ui.unmount();await flush($)
 const before={reads:w.fileReads.length,roomReads:roomReads(w.fileReads).length,waits:waits.length,invalidations:invalidations.length,draws}
 await w.clock.advance(60000);await flush($)
 const after={reads:w.fileReads.length,roomReads:roomReads(w.fileReads).length,waits:waits.length,invalidations:invalidations.length,draws}
 expect(after).toEqual(before)
 await open($,'him');ui=await $.ui.mount(pane);await flush($)
 expect((await roomDrawn(ui)).length).toBe(1);expect(roomReads(w.fileReads).length).toBe(first*3)
 console.log('D1_BOOK_LIFECYCLE_METRIC '+JSON.stringify({idleWindowMs:60000,before,after,layerFilesPerOpen:first,roomCacheCounter:'not_observed_separate_test_module_instance',cacheReleaseEvidence:'all approved layer files reread after tab-away and close',scope:'shipping Pane; approved source layer PNG fixtures; closed interval band Off; actual invocation counts'}))
 await closeOwnedPane($);await ui.unmount()
})

test('D1 actual helper turn step does not redraw the open Offerings board, stopped helper completion does',{options:{band:'off'}},async($,on)=>{
 const readStored=fixtureStoreReader(on)
 let draws=0
 observeOwnedPaneRenders(on,count=>{draws=count})
 on('agent.spawn',()=>({agentId:'board-helper',model:'fixture'}))
 on('turn.step',{turnId:'board-helper-turn'},async function*($,e){return {turnId:e.turnId,index:e.index,answer:'',toolUses:[],stopReason:'end_turn' as const,usage:{input_tokens:100,output_tokens:0,cache_read_input_tokens:0,cache_creation_input_tokens:0,model:'fixture'}}})
 const w=world(on,{store:{...RECENT,band:'off'},surfaces:['desktop'],readText})
 await $.session.start(start);await settleLegacyStart($,w);await $.turn.start({turnId:'main',text:'fixture work'})
 await $.agent.spawn({prompt:'fixture',description:'fixture board helper',subagentType:'general-purpose'})
 await open($,'usage');const ui=await $.ui.mount(pane);await flush($)
 expect(draws).toBeGreaterThan(0);const before=draws
 for await(const _ of $.turn.step({turnId:'board-helper-turn',agentId:'board-helper',index:0,model:'fixture',messageCount:1})){}
 await flush($);await ui.drawn();const afterStep=draws;expect(afterStep).toBe(before)
 await $.turn.complete({turnId:'board-helper-turn',agentId:'board-helper',answer:'',reason:'aborted',durationMs:1000,isAborted:true});await flush($);await ui.drawn()
 expect(draws).toBeGreaterThan(before)
 console.log('D1_BOARD_REDRAW_METRIC '+JSON.stringify({beforeStep:before,afterStep,afterStoppedHelperCompletion:draws,scope:'actual helper turn.step and aborted turn.complete; shipping mounted Offerings Pane'}))
 await closeOwnedPane($);await ui.unmount()
})

test('D1 mounted shipping desktop remains idle for a measured full minute',{options:{band:'compact'}},async($,on)=>{
 const readStored=fixtureStoreReader(on)
 const renders=desktopRenderReceipts(on),waits:number[]=[],invalidations:number[]=[]
 on('clock.*',($,e,next)=>{if(next.is('clock.after',e))waits.push(e.ms);return next(e)})
 on('ui.invalidate',($,e,next)=>{invalidations.push(waits.length);return next(e)})
 on('process.run',()=>({value:{exitCode:1,stdout:'',stderr:'fixture decoder unavailable',isStdoutTruncated:false,isStderrTruncated:false}}))
 // the first compaction also earns her sesame socks and she says so after the first-shed line; she has them here,
 // so the quiet minute after that line is the compaction's own
 const w=world(on,{store:{...RECENT,band:'compact',stamps:{met:MORNING,shiori:MORNING},bandSettings:{socksEarned:['sesame']}},surfaces:['desktop'],settings:{prefersReducedMotion:false},readText})
 await $.session.start(start);await settleLegacyStart($,w)
 const ui=await $.ui.mount({surface:'desktop',...band(100)});await w.clock.advance(1600);await renders.flush($)
 await $.session.compact({trigger:'manual',messages:[SUMMARY]});await ui.redraw();await w.clock.advance(0);await renders.flush($)
 const firstLine=JSON.parse(D1_WORDS_TEXT)['shed.first'].en
 const firstLineShown=(await ui.find({type:'Text',text:firstLine}))!==undefined
 expect(w.view().line?.key).toBe('shed.first');expect(firstLineShown).toBe(true)
 const occasions=await readStored($,'occasions') as {shedFirst?:boolean}|undefined
 expect(occasions?.shedFirst).toBe(true)
 await w.clock.advance(14001);await renders.flush($)
 const before={waits:waits.length,invalidations:invalidations.length,reads:w.fileReads.length,renders:renders.current()}
 await w.clock.advance(60000);await renders.flush($)
 const after={waits:waits.length,invalidations:invalidations.length,reads:w.fileReads.length,renders:renders.current()}
 expect(after.waits).toBe(before.waits);expect(after.invalidations).toBe(before.invalidations);expect(after.reads).toBe(before.reads)
 if(renders.available){expect(before.renders).toBeGreaterThan(0);expect(after.renders).toBe(before.renders)}
 console.log('D1_IDLE_MINUTE_METRIC '+JSON.stringify({idleWindowMs:60000,positiveD1Control:{shedFirstLineShown:firstLineShown,shedFirstSaved:occasions?.shedFirst,settleAfterCompactionMs:14001},before,after,actualRenderCounterAvailable:renders.available,renderDelta:renders.available?after.renders-before.renders:null,scope:'actual shipping AbovePrompt; session.compact before settled minute; virtual clock; scheduler/read/invalidation/native returned-tree diagnostic seams; PNG fixture identity only'}))
 await ui.unmount()
})
