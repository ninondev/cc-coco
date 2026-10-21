import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { initialView } from '../hooks/mood'
import { transportFixture } from './presence-transport-fixture'
const HOME='/tmp/b1b-presence-home'
const NOW=Date.UTC(2026,9,4,10,0)
const REQUEST={plugin:'coco',component:'AbovePrompt' as const,surface:'desktop' as const,props:{hasSurvey:false,isWorking:false,maxRows:30,bodyColumns:100,scroll:{offset:0,bodyRows:30},view:{}},viewport:{columns:100,rows:48}}
function fixture(on:On,mode:string){
 const frozen=new Promise<void>(()=>{})
 mock.clock(on,{now:NOW})
 mock.env(on,{HOME,LANG:'en_US.UTF-8',TERM:'xterm-256color'})
 const t=transportFixture({v:1,seq:1,quietAt:NOW,asleep:false,clingy:false,busy:false,event:{kind:'activity',id:'1',at:NOW}})
 if(mode==='write')t.holdWrites()
 on('state.get',()=>({value:{value:initialView(),version:1}} as never))
 on('state.set',()=>({value:{isSet:true,version:2}}))
 on('store.get',()=>({value:undefined}))
 on('store.set',()=>({value:undefined}))
 on('settings.read',()=>({value:{timeZone:'UTC',prefersReducedMotion:true}}))
 on('session.id',async()=>{if(mode==='id')await frozen;return{value:'local-session'}})
 on('session.root',()=>({value:'/tmp/b1b-presence-project'}))
 on('session.surfaces',()=>({value:['desktop']}))
 on('fs.exists',()=>({value:true}))
 on('fs.read',async($,e)=>{if(mode==='snapshot')await frozen;if(mode==='reject-read')throw new Error('presence read rejected');return{value:JSON.stringify(t.state)} as never})
 on('fs.write',async($,e)=>{if(mode==='write')await frozen;await t.write(e.path,e.text);return{value:undefined}})
 on('process.spawn',async function*($,e){
  const follow=e.argv[3]==='follow'
  if(mode==='reject-spawn')throw new Error('presence spawn rejected')
  if((mode==='follow'&&follow)||(mode==='transaction'&&!follow))await frozen
  const c=t.spawn('local-session',[...e.argv])
  try{while(true){const chunk=await c.next();if(chunk.done)return{value:chunk.value};yield chunk.value}}finally{await c.return({code:0,signal:null})}
 })
 on('ui.render',()=> <></>)
}
for(const mode of ['healthy','reject-spawn','reject-read','id','follow','transaction','write','snapshot']){
 test(`B1b presence ${mode}: first render is visible without presence`,{timeoutMs:10000},async($,on)=>{fixture(on,mode);const ui=await $.ui.mount(REQUEST);expect(await ui.find({type:'Text',text:'Coco'})).toBeDefined()})
}

for(const mode of ['id','follow','transaction','write','snapshot'])test(`B1b background presence ${mode} cannot hold session.start`,{timeoutMs:10000},async($,on)=>{
 fixture(on,mode);on('session.start',($,e)=>({cwd:e.cwd}))
 const at=Date.now();await $.session.start({cwd:'/tmp/b1b-presence-project',surface:'desktop',isInteractive:true})
 console.log('B1b pending presence metric '+JSON.stringify({mode,startMs:Date.now()-at,scope:'engine-kit lifecycle call; pending presence has not resolved'}))
 const ui=await $.ui.mount(REQUEST);expect(await ui.find({type:'Text',text:'Coco'})).toBeDefined()
})
