import { installM1Words } from './m1-more-data-fixture'
import { expect, test } from 'claude-code/testing'
import type {On} from 'claude-code'
import {world,RECENT,MORNING,band,desktopPicture,settleLegacyStart,themeConfig} from './world'
import {moreFill,moreWord} from '../hooks/more-words'
import {durationText} from '../hooks/numbers'
import {commandDigest} from '../hooks/m1-always'
import {c3Durations} from '../hooks/c3-words'
import {C3_WORDS_RAW} from './c3-words-fixture'
import {C3_HEAD_MANIFEST} from './c3-head-assets'


installM1Words()

const START={cwd:'/tmp/m1-own-checks',surface:'terminal' as const,isInteractive:true}
const OK={exitCode:0,stdout:'',stderr:'',isStdoutTruncated:false,isStderrTruncated:false}
function fixture(on:On,options:{durations?:number[];bookmark?:boolean;settings?:Record<string,unknown>;config?:ReturnType<typeof themeConfig>;surface?:'terminal'|'desktop';hold?:(id:string)=>Promise<void>}={}){
 const props:{tool_use_id:string;kind:string;hint:string}[]=[],stored=new Map<string,any>(),toolIds:string[]=[],optional:string[]=[]
 on('ui.*',($,e,next)=>{if(next.is('ui.render',e)&&e.component==='ToolProgress')props.push({...e.props});return next(e)})
 on('store.*',async($,e,next)=>{const result=await next(e);if(next.is('store.set',e)&&!('deny' in result))stored.set(e.key,structuredClone(e.value));return result})
 on('tool.call',{tool:'Bash'},async($,e,next)=>{toolIds.push(e.tool_use_id);await options.hold?.(e.tool_use_id);return next(e)})
 for(const event of ['model.complete','model.classify','agent.register','agent.spawn','tool.register','http.fetch'])on(event,()=>{optional.push(event);throw Error('Unexpected optional dispatch')})
 for(const event of ['classic.PostToolUse','classic.PermissionRequest','classic.ConfigChange','classic.TaskCreated','classic.TaskCompleted'] as const)on(event,()=>({}))
 on('agent.list',()=>({value:[]}));on('session.repo',()=>({value:null}));on('session.model',()=>({value:'fixture-model'}));on('session.turns',()=>({value:1}));on('session.messages',()=>({value:[]}));on('fs.write',()=>({value:undefined}))
 on('process.run',($,e)=>{
  if(e.argv[1]?.endsWith('algo-worker.mjs')){
   const request=JSON.parse(e.init?.stdin??'{}');let result:any=null
   if(request.op==='recognize')result={kind:'test',tool:'npm',key:'npm test'}
   if(request.op==='finish')result={parsed:{outcome:'pass'},slowness:{slow:false},history:{[request.key]:[{ms:request.ms,outcome:'pass'}]}}
   return{value:{...OK,stdout:JSON.stringify({ok:true,result})}}
  }
  return{value:{...OK,stdout:'{}'}}
 })
 const w=world(on,{sessionTurns:false,engineRows:true,sessionRoot:START.cwd,surfaces:[options.surface??'terminal'],settings:options.settings??{prefersReducedMotion:true},config:options.config,store:{...RECENT,firstMet:MORNING,voiceChosen:true,runDurations:{[START.cwd]:{'npm test':options.durations??[]}},bandSettings:{voice:'off',voiceChosen:true,notes:true,bookmark:options.bookmark===true,guard:false,more:{}}},readText:path=>path.endsWith('c3-text.json')?C3_WORDS_RAW:path.endsWith('frame-manifest.json')?JSON.stringify(C3_HEAD_MANIFEST):undefined})
 return{w,props,stored,toolIds,optional}
}
async function begin($:any,f:ReturnType<typeof fixture>,surface:'terminal'|'desktop'='terminal'){await $.session.start({...START,surface});await settleLegacyStart($,f.w);await $.turn.start({turnId:'own-checks',text:'Run the local check'})}
async function pill($:any,id:string,hint:string,requestId:string){const ui=await $.ui.mount({plugin:'coco',surface:'terminal',component:'ToolProgress',requestId,props:{tool_use_id:id,kind:'background_hint',hint},viewport:{columns:100,rows:50}});await ui.drawn();await ui.unmount()}
const usual=(ms:number)=>moreFill(moreWord('pill.usually','en'),{duration:durationText(ms/1000,'en',c3Durations('en'))})

for(const n of [0,2])test(`M1 A6 actual ToolProgress remains exactly engine-owned below three runs (${n})`,{options:{band:'off'}},async($,on)=>{
 const f=fixture(on,{durations:Array(n).fill(1000)});await begin($,f);await $.tool.call({tool:'Bash',command:'npm test'})
 const id=f.toolIds.at(-1)!;expect(id).toBeDefined();const hint='(ctrl+b to run in background)'
 await pill($,id,hint,'below-three-'+n);expect(f.props.at(-1)).toEqual({tool_use_id:id,kind:'background_hint',hint});expect(f.optional).toEqual([])
})

test('M1 A6 actual ToolProgress suffix preserves every engine prefix and readonly field', {options:{band:'off'}},async($,on)=>{
 const f=fixture(on,{durations:[1000,1000,1000]});await begin($,f);await $.tool.call({tool:'Bash',command:'npm test'});const id=f.toolIds.at(-1)!;expect(id).toBeDefined();expect(usual(1000).length>0).toBe(true)
 for(let i=0;i<40;i++){
  const hint=['','(ctrl+b to run in background)','Engine binding Ctrl+Alt+B','日本語 栞 · engine-owned','engine \n owns every byte'][i%5]+' '+String(i)+'x'.repeat(i)
  await pill($,id,hint,'prefix-'+i);const props=f.props.at(-1)!;expect(props.tool_use_id).toBe(id);expect(props.kind).toBe('background_hint');expect(props.hint.startsWith(hint)).toBe(true);expect(props.hint).toBe(hint+', '+usual(1000))
 }
 expect(f.optional).toEqual([])
})

test('M1 A6 actual thirty-second permission waits leave execution-only median unchanged', {options:{band:'off'}},async($,on)=>{
 let enter=(id:string)=>{},release=()=>{};const f=fixture(on,{hold:async id=>{enter(id);await new Promise<void>(resolve=>{release=resolve})}});await begin($,f)
 let last=''
 for(let i=0;i<3;i++){
  const ready=new Promise<string>(resolve=>{enter=resolve}),pending=$.tool.call({tool:'Bash',command:'npm test'});last=await ready
  try{
   await $.classic.PermissionRequest({tool_name:'Bash',tool_input:{command:'npm test'}});await f.w.clock.advance(30000)
   await $.classic.PostToolUse({tool_name:'Bash',tool_input:{command:'npm test'},tool_response:{stdout:'',exit_code:0},tool_use_id:last,duration_ms:1000})
  }finally{release();await pending}
  expect(f.stored.get('runDurations')[START.cwd][commandDigest('npm test')]).toEqual(Array(i+1).fill(1000))
 }
 await pill($,last,'Engine background hint','permission-median');expect(f.props.at(-1)!.hint).toBe('Engine background hint, '+usual(1000));expect(f.optional).toEqual([])
})

test('M1 A10 actual ConfigChange makes the next desktop band still without restart',async($,on)=>{
 const settings={prefersReducedMotion:false},config=themeConfig('light');let starts=0,reads=0,themeReads=0
 on('session.*',($,e,next)=>{if(next.is('session.start',e))starts++;return next(e)})
 on('settings.*',($,e,next)=>{if(next.is('settings.read',e))reads++;return next(e)})
 on('config.*',($,e,next)=>{if(next.is('config.list',e))themeReads++;return next(e)})
 const f=fixture(on,{settings,config,surface:'desktop'})
 await begin($,f,'desktop');const ui=await $.ui.mount({surface:'desktop',...band(100)});await settleLegacyStart($,f.w);await ui.redraw()
 const before=String((await desktopPicture(ui))?.props.source);expect(before).toMatch(/animation:[^;\"]*infinite|repeatCount=[\"']indefinite[\"']/)
 expect(f.w.view().theme).toBe('light');expect(f.w.view().cue).toBe('#9E4123')
 const oldReads=reads,oldThemeReads=themeReads;settings.prefersReducedMotion=true;config[0]!.value='dark';await $.classic.ConfigChange({source:'user_settings',file_path:'/tmp/m1-settings-fixture.json'});await ui.redraw()
 expect(themeReads>oldThemeReads).toBe(true);expect(f.w.view().theme).toBe('dark');expect(f.w.view().cue).toBe('claude')
 const source=String((await desktopPicture(ui))?.props.source);expect(source).toContain('<svg');expect(source).not.toMatch(/animation:[^;\"]*infinite|repeatCount=[\"']indefinite[\"']/);expect(reads>oldReads).toBe(true);expect(starts).toBe(1);expect(f.optional).toEqual([])
 const darkThemeReads=themeReads;config[0]!.value='light';await $.classic.ConfigChange({source:'user_settings',file_path:'/tmp/m1-settings-fixture.json'});await ui.redraw()
 expect(themeReads>darkThemeReads).toBe(true);expect(f.w.view().theme).toBe('light');expect(f.w.view().cue).toBe('#9E4123');expect(starts).toBe(1);expect(f.optional).toEqual([]);await ui.unmount()
})

test('M1 A27 actual TaskCreated then TaskCompleted advances and clears the bookmark', {options:{band:'off'}},async($,on)=>{
 const f=fixture(on,{bookmark:true});await begin($,f)
 await $.classic.TaskCreated({task_id:'one',task_subject:'First current item'});expect(f.stored.get('bookmarks')[START.cwd].where).toBe('First current item');expect(f.stored.get('bookmarks')[START.cwd].kind).toBe('todo')
 await $.classic.TaskCreated({task_id:'two',task_subject:'Second current item'});expect(f.stored.get('bookmarks')[START.cwd].where).toBe('First current item')
 await $.classic.TaskCompleted({task_id:'one',task_subject:'First current item'});expect(f.stored.get('bookmarks')[START.cwd].where).toBe('Second current item');expect(f.stored.get('bookmarks')[START.cwd].kind).toBe('todo')
 await $.classic.TaskCompleted({task_id:'two',task_subject:'Second current item'});expect(f.stored.get('bookmarks')[START.cwd]).toBeUndefined();expect(f.optional).toEqual([])
})
