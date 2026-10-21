import {test,expect,type Plugin} from 'claude-code/testing'
const PROBE: Plugin = {
 name:'d1-world-contract-probe',
 register(on){
  on('command.run',{command:'d1-fixture-read-c3-text'},async $=>({text:JSON.stringify(await $.fs.read('/fixture/hooks/c3-text.json'))}))
  on('command.run',{command:'d1-fixture-read-presence-c3-text'},async $=>({text:JSON.stringify(await $.fs.read('/fixture/hooks/c3-text.json'))}))
  on('command.run',{command:'d1-fixture-read-turns'},async $=>({text:JSON.stringify(await $.session.turns())}))
  on('command.run',{command:'d1-fixture-read-presence-turns'},async $=>({text:JSON.stringify(await $.session.turns())}))
  on('command.run',{command:'d1-fixture-read-owned-session'},async $=>({text:JSON.stringify([await $.session.turns(),await $.session.surfaces()])}))
 }
}

import {presenceWorld,snapshot} from './presence-world'
import {PERSON,P} from './world'
import {C3_WORDS_RAW} from './c3-words-fixture'
import {D1_WORDS_TEXT} from './d1-room-fixture'
import {WINDOWS_ROOTS} from './test-system'

test('D1 presence world returns exact C3 JSON through its actual fs read',{plugins:[PROBE]},async($,on)=>{
 let actual:unknown
 presenceWorld(on,snapshot(),{readText:path=>path.endsWith('d1-words.json')?D1_WORDS_TEXT:undefined})
 actual=JSON.parse((await $.command.run({command:'d1-fixture-read-presence-c3-text',args:'',origin:PERSON,presentation:P})).text!)
 expect(typeof actual).toBe('string')
 expect(actual).toBe(C3_WORDS_RAW)
})
test('D1 presence world completes actual C3 startup before deriving its ribbon folder',async($,on)=>{
 const f=presenceWorld(on,snapshot(),{readText:path=>path.endsWith('d1-words.json')?D1_WORDS_TEXT:undefined})
 await $.session.start({cwd:'/tmp/presence-project',surface:'desktop',isInteractive:true})
 for(let pass=0;pass<3;pass++){
  await f.clock.advance(0)
  for(let i=0;i<80;i++)await $.command.run({command:'d1-fixture-presence-startup-boundary',args:'',origin:PERSON,presentation:P})
 }
 try{expect(f.view().ribbon?.folder).toBe(WINDOWS_ROOTS?'project':'presence-project')}
 finally{await $.session.end({reason:'clear',sessionId:'local-session',resume:{id:'local-session'}})}
})
for(const place of ['before','after'] as const)test(`D1 presence world preserves an explicit turns provider registered ${place} world`,{plugins:[PROBE]},async($,on)=>{
 let turns:unknown
 if(place==='before')on('session.turns',()=>({value:37}))
 presenceWorld(on)
 if(place==='after')on('session.turns',()=>({value:37}))
 turns=JSON.parse((await $.command.run({command:'d1-fixture-read-presence-turns',args:'',origin:PERSON,presentation:P})).text!)
 expect(turns).toBe(37)
})
