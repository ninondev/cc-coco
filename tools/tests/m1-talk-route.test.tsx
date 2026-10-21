import {expect,test} from 'claude-code/testing'
import {world,settleLegacyStart,RECENT,MORNING,PERSON} from './world'
import {modelServiceFixtureText} from './m1-model-service-fixture'
import {C3_WORDS_RAW} from './c3-words-fixture'
import {C3_HEAD_MANIFEST} from './c3-head-assets'

// O1 probe (10-09): a prompt that starts «sama,» or «小克,» goes to Talk from prompt.submit and
// never enters the session. The drop reason is the shipped talk.routed (groups-h-1010, 10-10).
const START={cwd:'/tmp/m1-talk-route-fixture',surface:'terminal' as const,isInteractive:true}
function fixture(on:Parameters<typeof world>[0],options:{talk:boolean;lang?:string}){
 const reached:string[]=[],models:string[]=[]
 // Beneath the plugin: whatever reaches here would have gone to Claude.
 on('prompt.*',($,e,next)=>{if(next.is('prompt.submit',e))reached.push(e.text);return next(e)})
 on('model.complete',()=>{models.push('model.complete');return{value:{isAnswered:true,text:'fixture reply',usage:{input_tokens:1,output_tokens:1,cache_read_input_tokens:0,cache_creation_input_tokens:0}}}})
 on('model.classify',()=>{models.push('model.classify');return{value:'chat'}})
 on('http.fetch',()=>{models.push('http.fetch');return{deny:'unexpected fixture network request'}})
 on('agent.list',()=>({value:[]}));on('session.messages',()=>({value:[]}));on('session.model',()=>({value:'fixture model'}));on('session.repo',()=>({value:null}));on('session.turns',()=>({value:1}))
 on('fs.write',()=>({value:undefined}));on('process.run',()=>({value:{exitCode:0,stdout:'{"ok":true,"result":{},"ensured":true,"claimed":true}',stderr:'',isStdoutTruncated:false,isStderrTruncated:false}}))
 const data=JSON.parse(modelServiceFixtureText()) as Record<string,Record<string,string>>
 data['more.model.talk.persona']={en:'fixture talk persona'}
 const more=options.talk?{talk:true}:{}
 const w=world(on,{surfaces:['terminal'],...(options.lang?{settings:{language:options.lang}}:{}),env:{HOME:'/tmp/m1-talk-route-fixture-home',LANG:'en_US.UTF-8',TERM:'xterm-256color'},moreText:JSON.stringify(data),store:{...RECENT,firstMet:MORNING,more,'more.agreed':options.talk?['talk']:[],bandSettings:{voice:'off',voiceChosen:true,band:'off',guard:false,bookmark:false,notes:false,more}},readText:path=>path.endsWith('c3-text.json')?C3_WORDS_RAW:path.endsWith('frame-manifest.json')?JSON.stringify(C3_HEAD_MANIFEST):undefined})
 return {w,reached,models}
}

const ROUTED={en:'Sent to Coco',zh:'已发给她'} as const
for(const lang of ['en','zh'] as const)test(`M1 O1 actual «sama,» and «小克,» prompts go to Talk with Talk on, never reaching the session, and say so: ${lang}`,{options:{language:lang,resolvedLanguage:lang}},async($,on)=>{
 const f=fixture(on,{talk:true,lang});await $.session.start(START);await settleLegacyStart($,f.w)
 for(const text of ['sama, how was the morning','小克，今天怎么样']){
  const result=await $.prompt.submit({text,wait:false,origin:PERSON}) as {drop?:string}
  await settleLegacyStart($,f.w)
  expect(result.drop).toBe(ROUTED[lang])
 }
 expect(f.reached).toEqual([]);expect(f.models.filter(name=>name==='model.complete')).toEqual(['model.complete','model.complete'])
 for(const text of ['please fix sama, the bug','samantha, hi']){
  const result=await $.prompt.submit({text,wait:false,origin:PERSON}) as {text?:string}
  expect(result.text).toBe(text)
 }
 const peer=await $.prompt.submit({text:'sama, from another window',wait:false,origin:{kind:'peer'}} as never) as {text?:string}
 expect(peer.text).toBe('sama, from another window')
 expect(f.reached).toEqual(['please fix sama, the bug','samantha, hi','sama, from another window'])
})

test('M1 O1 actual «sama,» goes to Claude with Talk off and calls no model',async($,on)=>{
 const f=fixture(on,{talk:false});await $.session.start(START);await settleLegacyStart($,f.w)
 const result=await $.prompt.submit({text:'sama, hello',wait:false,origin:PERSON}) as {text?:string}
 expect(result.text).toBe('sama, hello');expect(f.reached).toEqual(['sama, hello']);expect(f.models).toEqual([])
})
