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

import {world,RECENT,PERSON,P,settleLegacyStart} from './world'
import {C3_WORDS_RAW} from './c3-words-fixture'
import {D1_WORDS_TEXT} from './d1-room-fixture'

test('D1 legacy world returns exact C3 JSON through its actual fs read',{plugins:[PROBE]},async($,on)=>{
 let actual:unknown
 world(on,{store:RECENT,surfaces:['vscode'],readText:path=>path.endsWith('d1-words.json')?D1_WORDS_TEXT:undefined})
 actual=JSON.parse((await $.command.run({command:'d1-fixture-read-c3-text',args:'',origin:PERSON,presentation:P})).text!)
 expect(typeof actual).toBe('string')
 expect(actual).toBe(C3_WORDS_RAW)
})
test('D1 legacy world completes actual C3 startup before deriving its ribbon folder',async($,on)=>{
 const cwd='/tmp/d1-world-c3-contract'
 const w=world(on,{store:RECENT,surfaces:['vscode'],sessionRoot:cwd,readText:path=>path.endsWith('d1-words.json')?D1_WORDS_TEXT:undefined})
 await $.session.start({cwd,surface:'vscode',isInteractive:true});await settleLegacyStart($,w)
 expect(w.view().ribbon?.folder).toBe('d1-world-c3-contract')
})
for(const place of ['before','after'] as const)test(`D1 legacy world preserves an explicit turns provider registered ${place} world`,{plugins:[PROBE]},async($,on)=>{
 let turns:unknown
 if(place==='before')on('session.turns',()=>({value:37}))
 world(on)
 if(place==='after')on('session.turns',()=>({value:37}))
 turns=JSON.parse((await $.command.run({command:'d1-fixture-read-turns',args:'',origin:PERSON,presentation:P})).text!)
 expect(turns).toBe(37)
})
