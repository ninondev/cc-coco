import {test,expect} from 'claude-code/testing'
import {world,RECENT,settleLegacyStart} from './world'
import {WINDOWS_ROOTS} from './test-system'
const START={cwd:WINDOWS_ROOTS?'C:\\Users\\windows\\native-order':'/tmp/native-order',surface:'vscode' as const,isInteractive:true}
const nodes=(n:any):any[]=>Array.isArray(n)?n.flatMap(nodes):n&&typeof n==='object'?[n,...nodes(n.children)]:[]
const hasScroll=(tree:any)=>nodes(tree).some(n=>n.type==='Svg'&&n.props.width===9&&n.props.height===18&&n.props.alt==='')
const row=(id:string,output:Record<string,unknown>)=>({plugin:'coco',component:'ToolUse' as const,requestId:'row-'+id,props:{tool_use_id:'call-'+id,tool:'Agent',input:{},output,isRunning:false,isErrored:false,isInterrupted:false},viewport:{columns:120,rows:40}})
function gate(){let enter!:()=>void,release!:()=>void;return {entered:new Promise<void>(r=>enter=r),held:new Promise<void>(r=>release=r),enter:()=>enter(),release:()=>release()}}
async function notification($:any,id:string,status:string,sequence:string){
 const ui=await $.ui.mount({surface:'vscode',plugin:'coco',component:'UserMessage',requestId:'notice-'+sequence,props:{text:'native task notification fixture',origin:{kind:'task-notification'},task:{id,status}},viewport:{columns:120,rows:40}})
 await ui.drawn();await ui.unmount()
}
const changes=[{stale:'running',current:'completed',expected:true},{stale:'completed',current:'failed',expected:false},{stale:'completed',current:'killed',expected:false}]
for(const change of changes)test('D1 native task '+change.current+' notification wins over pending stale '+change.stale+' agent list',async($,on)=>{
 const wait=gate();let queried=false
 on('agent.list',async()=>{queried=true;wait.enter();await wait.held;return {value:[{id:'list-task',description:'fixture',type:'general-purpose',status:change.stale}]}})
 const w=world(on,{engineRows:true,store:RECENT,surfaces:['vscode']});await $.session.start(START);await settleLegacyStart($,w)
 const pending=$.ui.mount({surface:'vscode',...row('list-task',{status:'async_launched',agentId:'list-task'})}).then(async ui=>({ui,tree:await ui.drawn()}))
 await Promise.race([wait.entered,pending])
 try{expect(queried,'native-order actual agent.list entered').toBe(true);await notification($,'list-task',change.current,'list-'+change.current)}finally{wait.release()}
 const actual=await pending;expect(hasScroll(actual.tree),'native-order newer notification overrides stale list result').toBe(change.expected);if(!change.expected)expect(actual.tree,'native-order bare host is preserved after list race').toMatchObject({type:'engine',ref:0});await actual.ui.unmount()
})
for(const local of [true,false])for(const change of changes)test('D1 native '+(local?'async':'remote')+' '+change.current+' notification wins while the host row is pending',async($,on)=>{
 const wait=gate();let entered=false
 on('agent.list',()=>({value:[{id:'host-task',description:'fixture',type:'general-purpose',status:change.stale}]}))
 on('ui.render',{component:'ToolUse'},async()=>{entered=true;wait.enter();await wait.held;return {type:'engine',ref:0} as never})
 const w=world(on,{engineRows:true,store:RECENT,surfaces:['vscode']});await $.session.start(START);await settleLegacyStart($,w)
 if(change.stale==='completed')await notification($,'host-task','completed','host-seed')
 const output=local?{status:'async_launched',agentId:'host-task'}:{status:'remote_launched',taskId:'host-task'}
 const pending=$.ui.mount({surface:'vscode',...row('host-task',output)}).then(async ui=>({ui,tree:await ui.drawn()}))
 await Promise.race([wait.entered,pending])
 try{expect(entered,'native-order actual host row entered').toBe(true);await notification($,'host-task',change.current,'host-'+change.current)}finally{wait.release()}
 const actual=await pending;expect(nodes(actual.tree).filter(n=>n.type==='engine').length).toBe(1);expect(hasScroll(actual.tree),'native-order latest task status after host return').toBe(change.expected);if(!change.expected)expect(actual.tree,'native-order bare host is preserved after host race').toMatchObject({type:'engine',ref:0});await actual.ui.unmount()
})
test('D1 native completed helper row stays authoritative across a newer failed task notification',async($,on)=>{
 const wait=gate();let entered=false
 on('ui.render',{component:'ToolUse'},async()=>{entered=true;wait.enter();await wait.held;return {type:'engine',ref:0} as never})
 const w=world(on,{engineRows:true,store:RECENT,surfaces:['vscode']});await $.session.start(START);await settleLegacyStart($,w)
 const pending=$.ui.mount({surface:'vscode',...row('native-completed',{status:'completed'})}).then(async ui=>({ui,tree:await ui.drawn()}))
 await Promise.race([wait.entered,pending])
 try{expect(entered).toBe(true);await notification($,'native-completed','failed','native-authority')}finally{wait.release()}
 const actual=await pending;expect(hasScroll(actual.tree)).toBe(true);await actual.ui.unmount()
})
test('D1 native helper notification cache retains64 statuses and evicts the oldest65th without a completed list record',async($,on)=>{
 let queries=0;on('agent.list',()=>{queries++;return {value:[]}})
 const w=world(on,{engineRows:true,store:RECENT,surfaces:['vscode']});await $.session.start(START);await settleLegacyStart($,w)
 for(let i=0;i<65;i++)await notification($,'bounded-task-'+i,'completed','bounded-'+i)
 const oldest=await $.ui.mount({surface:'vscode',...row('bounded-oldest',{status:'async_launched',agentId:'bounded-task-0'})});const oldestTree=await oldest.drawn();expect(hasScroll(oldestTree)).toBe(false);expect(oldestTree,'native-order evicted unadorned host is bare').toMatchObject({type:'engine',ref:0});await oldest.unmount()
 const newest=await $.ui.mount({surface:'vscode',...row('bounded-newest',{status:'async_launched',agentId:'bounded-task-64'})});expect(hasScroll(await newest.drawn())).toBe(true);await newest.unmount();expect(queries).toBe(1)
 console.log('D1_NATIVE_NOTIFICATION_CACHE_METRIC '+JSON.stringify({notifications:65,retainedLimit:64,oldestAbsent:true,newestPresent:true,queries,scope:'actual source hooks; mocked documented native task notification and agent.list seams; no real AgentTool/model/provider identity claim'}))
})
