import {test,expect} from 'claude-code/testing'
import {world,RECENT,settleLegacyStart} from './world'
import {WINDOWS_ROOTS} from './test-system'
const START={cwd:WINDOWS_ROOTS?'C:\\Users\\windows\\helper-retry':'/tmp/helper-retry',surface:'vscode' as const,isInteractive:true}
const nodes=(tree:any):any[]=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.children)]:[]
const hasScroll=(tree:any)=>nodes(tree).some(node=>node.type==='Svg'&&node.props.width===9&&node.props.height===18&&node.props.alt==='')
const row=(requestId:string,toolUseId:string,agentId:string,output:Record<string,unknown>={status:'async_launched',agentId})=>({surface:'vscode' as const,plugin:'coco',component:'ToolUse' as const,requestId,props:{tool_use_id:toolUseId,tool:'Agent',input:{},output,isRunning:false,isErrored:false,isInterrupted:false},viewport:{columns:120,rows:40}})
async function notice($:any,id:string,status:string){const ui=await $.ui.mount({surface:'vscode',plugin:'coco',component:'UserMessage',requestId:'notification-'+id+'-'+status,props:{text:'fixture native task notification',origin:{kind:'task-notification'},task:{id,status}},viewport:{columns:120,rows:40}});await ui.drawn();await ui.unmount()}
for(const boundary of ['command-clear','session-clear','session-resume'] as const)test('D1 helper old row retries retain first epoch across '+boundary,async($,on)=>{
 let enter!:()=>void,release!:(value:any[])=>void,calls=0
 const entered=new Promise<void>(resolve=>enter=resolve),held=new Promise<any[]>(resolve=>release=resolve)
 const agent=(id:string)=>({id,description:'fixture',type:'general-purpose',status:'completed'})
 let hold=true
 on('agent.list',async()=>{calls++;enter();return {value:hold?await held:[agent('old-task'),agent('new-task')]}})
 on('session.end',($,e)=>({sessionId:e.sessionId}))
 const w=world(on,{engineRows:true,store:RECENT,surfaces:['vscode']});await $.session.start(START);await settleLegacyStart($,w)
 const pending=$.ui.mount(row('same-request','same-call','old-task')).then(async ui=>({ui,tree:await ui.drawn()}))
 await Promise.race([entered,pending]);expect(calls,'actual native list must enter before boundary').toBe(1)
 try{if(boundary==='command-clear')await $.command.run({command:'clear',args:''});else await $.session.end({reason:boundary==='session-clear'?'clear':'resume',sessionId:'session',resume:{id:'session'}})}finally{release([agent('old-task')])}
 const raced=await pending
 expect(hasScroll(raced.tree),'stale completion must not decorate the retried old row').toBe(false)
 expect(raced.tree,'unadorned host result remains bare').toMatchObject({type:'engine',ref:0})
 await raced.ui.redraw();expect(hasScroll(await raced.ui.drawn()),'explicit retry also keeps first epoch').toBe(false)
 expect(calls,'old row retry must not requery the stale list').toBe(1)
 await notice($,'old-task','completed');await raced.ui.redraw();expect(hasScroll(await raced.ui.drawn()),'current notification authorizes the same old identity').toBe(true)
 await notice($,'old-task','failed');await raced.ui.redraw();expect(hasScroll(await raced.ui.drawn()),'current failure vetoes decoration').toBe(false)
 await raced.ui.unmount();hold=false
 const changedTask=await $.ui.mount(row('same-request','same-call','new-task'));expect(hasScroll(await changedTask.drawn()),'new task identity may use current list fallback').toBe(true);await changedTask.unmount()
 const native=await $.ui.mount(row('same-request','same-call','old-task',{status:'completed'}));expect(hasScroll(await native.drawn()),'native completed output remains authoritative').toBe(true);await native.unmount()
})
test('D1 helper first-row identities retain at most64 records',async($,on)=>{
 let status='running',calls=0
 const agents=Array.from({length:65},(_,i)=>({id:'bounded-'+i,description:'fixture',type:'general-purpose',status}))
 on('agent.list',()=>{calls++;return {value:agents.map(agent=>({...agent,status}))}})
 const w=world(on,{engineRows:true,store:RECENT,surfaces:['vscode']});await $.session.start(START);await settleLegacyStart($,w)
 for(let i=0;i<65;i++){const ui=await $.ui.mount(row('bounded-row-'+i,'bounded-call-'+i,'bounded-'+i));expect(hasScroll(await ui.drawn())).toBe(false);await ui.unmount()}
 expect(calls).toBe(65);await $.command.run({command:'clear',args:''});status='completed'
 const oldest=await $.ui.mount(row('bounded-row-0','bounded-call-0','bounded-0'));expect(hasScroll(await oldest.drawn()),'oldest65th row identity was evicted').toBe(true);await oldest.unmount()
 const newest=await $.ui.mount(row('bounded-row-64','bounded-call-64','bounded-64'));const tree=await newest.drawn();expect(hasScroll(tree),'retained row identity still suppresses stale fallback').toBe(false);expect(tree).toMatchObject({type:'engine',ref:0});await newest.unmount();expect(calls).toBe(66)
})
