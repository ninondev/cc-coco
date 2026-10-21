import {test,expect} from 'claude-code/testing'
import {world,RECENT,settleLegacyStart} from './world'
import {C3_WORDS_RAW} from './c3-words-fixture'
import {D1_TRANSCRIPT_WORDS_RAW} from './d1-transcript-words-fixture'
const readText=(path:string)=>path.endsWith('d1-words.json')?D1_TRANSCRIPT_WORDS_RAW:path.endsWith('c3-text.json')?C3_WORDS_RAW:undefined
const START={cwd:'/tmp/d1-spawn-optional-type',surface:'vscode' as const,isInteractive:true}
for(const explicit of [false,true])test(`D1 direct native agent.spawn ${explicit?'explicit valid':'documented omitted'} type records helper without losing actual input identities`,async($,on)=>{
 let seen:{toolUseId:unknown;parentAgentId:unknown;description:unknown;subagentType:unknown;rawSubagentType:unknown;keys:string[]}|undefined
 on('ui.invalidate',()=>({value:undefined}));on('ui.notice',()=>({value:undefined}))
 on('agent.spawn',($,e)=>{seen={toolUseId:e.tool_use_id,parentAgentId:e.parentAgentId,description:e.description,subagentType:e.subagentType,rawSubagentType:(e as unknown as {subagent_type?:unknown}).subagent_type,keys:Object.keys(e).sort()};return {agentId:'direct-optional-type-helper',model:'fixture'}})
 const w=world(on,{store:RECENT,surfaces:['vscode'],readText});await $.session.start(START);await settleLegacyStart($,w);await $.turn.start({turnId:'direct-optional-type-main',text:'fixture work'})
 const answer=await $.agent.spawn({prompt:'fixture',description:'fixture helper',...(explicit?{subagentType:'general-purpose'}:{})})
 expect(answer?.agentId,'D1_OPTIONAL_SPAWN_FIELDS '+JSON.stringify(seen)).toBe('direct-optional-type-helper')
 expect(w.view().helpersCount).toBe(1);expect(seen?.description).toBe('fixture helper');expect(seen?.parentAgentId).toBeUndefined()
 if(explicit)expect(seen?.subagentType).toBe('general-purpose')
 // A missing engine-owned tool identity is retained as missing, never repaired
 // with a caller id. The separate inline2 contract still requires real ids.
})
