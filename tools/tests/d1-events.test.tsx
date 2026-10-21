import {test,expect} from 'claude-code/testing'
import {world,RECENT,MORNING,settleLegacyStart,SUMMARY} from './world'
import {D1_WORDS_TEXT} from './d1-room-fixture'
import {WINDOWS_ROOTS} from './test-system'
const cwd=WINDOWS_ROOTS?'C:\\Users\\windows\\old-folder':'/tmp/old-folder'
const nextCwd=WINDOWS_ROOTS?'C:\\Users\\windows\\new-folder':'/tmp/new-folder'
const start={cwd,surface:'vscode' as const,isInteractive:true}
const done={turnId:'t',answer:'done',reason:'answer' as const,durationMs:120000,isAborted:false}
test('D1 actual CwdChanged keeps the ribbon folder correct after cd without a new session',async($,on)=>{
 on('fs.read',{path:/d1-words\.json$/},()=>({value:D1_WORDS_TEXT}));on('classic.CwdChanged',()=>({}))
 const w=world(on,{sessionRoot:cwd,store:{...RECENT},surfaces:['vscode']});await $.session.start(start);await settleLegacyStart($,w)
 expect((w.view() as any).ribbon.folder).toBe('old-folder')
 await $.classic.CwdChanged({old_cwd:cwd,new_cwd:nextCwd});expect((w.view() as any).ribbon.folder).toBe('new-folder')
})
test('D1 actual helpers remain after the main answer and clear removes session usage',async($,on)=>{
 on('fs.read',{path:/d1-words\.json$/},()=>({value:D1_WORDS_TEXT}));on('agent.spawn',()=>({agentId:'helper1',model:'fixture'}))
 const w=world(on,{store:{...RECENT},surfaces:['vscode']});await $.session.start(start);await settleLegacyStart($,w)
 await $.turn.start({turnId:'t',text:'work'});await $.agent.spawn({prompt:'work',description:'one',subagentType:'general-purpose'})
 expect((w.view() as any).helpersCount).toBe(1);expect((w.view() as any).pose.name).toBe('helper');expect((w.view() as any).pose.at).toBe((w.view() as any).helpers[0].at);await $.turn.complete({...done,durationMs:1000});expect((w.view() as any).stageDirection).toBe(JSON.parse(D1_WORDS_TEXT)['aside.helpers'].en)
 await $.command.run({command:'clear',args:''});expect((w.view() as any).helpersCount??0).toBe(0)
})
test('D1 long-task Off creates neither a held line nor companion completion state',async($,on)=>{
 on('fs.read',{path:/d1-words\.json$/},()=>({value:D1_WORDS_TEXT}))
 const w=world(on,{store:{...RECENT,longTask:'off'},surfaces:['vscode']});await $.session.start(start);await settleLegacyStart($,w)
 await $.turn.start({turnId:'t',text:'work'});await w.clock.advance(120000);await $.turn.complete(done)
 expect((w.view() as any).longTask).toBeUndefined();expect((w.view() as any).line?.key==='long.done').toBe(false)
})
test('D1 a leaving helper keeps its original row position and arrival clock',async($,on)=>{
 on('agent.spawn',()=>({agentId:'leaving-helper',model:'fixture'}))
 const w=world(on,{store:{...RECENT},surfaces:['vscode']});await $.session.start(start);await settleLegacyStart($,w)
 await $.turn.start({turnId:'t',text:'work'});await $.agent.spawn({prompt:'work',description:'one',subagentType:'general-purpose'})
 const before=(w.view() as any).helpers[0];await w.clock.advance(1000)
 await $.turn.complete({...done,agentId:'leaving-helper',reason:'aborted',durationMs:1000,isAborted:true})
 const after=(w.view() as any).helpers[0];expect(after.at).toBe(before.at);expect(after.arrivalAt).toBe(before.arrivalAt);expect(after.leavingAt).toBeGreaterThan(before.at)
})
test('D1 auto compaction says its first line once and keeps the shed direction next to it',async($,on)=>{
 on('session.compact',{trigger:'auto'},()=>({messages:[SUMMARY],tokensAfter:100}));on('process.run',()=>({value:{exitCode:1,stdout:'',stderr:'fixture unavailable',isStdoutTruncated:false,isStderrTruncated:false}}))
 const w=world(on,{store:{...RECENT},surfaces:['vscode']});await $.session.start(start);await settleLegacyStart($,w)
 await $.session.compact({trigger:'auto',messages:[SUMMARY]});await w.clock.advance(0)
 const first=JSON.parse(D1_WORDS_TEXT)['shed.first'].en;expect(w.toasts.filter(t=>t===first).length).toBe(1)
 await $.session.compact({trigger:'auto',messages:[SUMMARY]});await w.clock.advance(0);expect(w.toasts.filter(t=>t===first).length).toBe(1)
})
