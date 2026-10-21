import {test,expect} from 'claude-code/testing'
import {world,RECENT,settleLegacyStart} from './world'
import {C3_WORDS_RAW} from './c3-words-fixture'
import {D1_TRANSCRIPT_WORDS_RAW} from './d1-transcript-words-fixture'
const readText=(path:string)=>path.endsWith('d1-words.json')?D1_TRANSCRIPT_WORDS_RAW:path.endsWith('c3-text.json')?C3_WORDS_RAW:undefined
for(const explicit of [false,true])test(`D1 direct native agent.spawn ${explicit?'explicit valid':'documented omitted'} description with explicit type records helper without invented identities`,async($,on)=>{
 let fields:{description:unknown;descriptionKind:string;subagentType:unknown;toolUseId:unknown;parentAgentId:unknown}|undefined
 on('ui.invalidate',()=>({value:undefined}));on('ui.notice',()=>({value:undefined}));on('agent.spawn',($,e)=>{fields={description:e.description,descriptionKind:typeof e.description,subagentType:e.subagentType,toolUseId:e.tool_use_id,parentAgentId:e.parentAgentId};return {agentId:'direct-optional-description-helper',model:'fixture'}})
 const w=world(on,{store:RECENT,surfaces:['vscode'],readText});await $.session.start({cwd:'/tmp/d1-optional-description',surface:'vscode',isInteractive:true});await settleLegacyStart($,w);await $.turn.start({turnId:'optional-description-main',text:'fixture work'})
 const answer=await $.agent.spawn({prompt:'fixture',subagentType:'general-purpose',...(explicit?{description:'fixture helper'}:{})})
 expect(answer?.agentId,'D1_DESCRIPTION_INPUT '+JSON.stringify(fields)).toBe('direct-optional-description-helper')
 expect(w.view().helpersCount,'D1_DESCRIPTION_INPUT '+JSON.stringify(fields)).toBe(1);expect(fields?.subagentType).toBe('general-purpose');expect(fields?.parentAgentId).toBeUndefined()
 if(explicit)expect(fields?.description).toBe('fixture helper')
})
