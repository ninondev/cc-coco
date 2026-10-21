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

import {world,PERSON,P} from './world'
import {presenceWorld,snapshot} from './presence-world'
for(const fixture of ['world','presenceWorld'] as const)test(`D1 ${fixture} keeps one explicit session namespace owner with dynamic surfaces`,{plugins:[PROBE]},async($,on)=>{
 let values:unknown[]=[];let surfaces:['desktop']|['vscode']=['desktop']
 on('session.*',($,e,next)=>{if(next.is('session.turns',e))return {value:0};if(next.is('session.surfaces',e))return {value:surfaces};return next(e)})
 if(fixture==='world')world(on,{sessionTurns:false})
 else presenceWorld(on,snapshot(),{sessionTurns:false})
 values=JSON.parse((await $.command.run({command:'d1-fixture-read-owned-session',args:'',origin:PERSON,presentation:P})).text!);expect(values).toEqual([0,['desktop']])
 surfaces=['vscode']
 values=JSON.parse((await $.command.run({command:'d1-fixture-read-owned-session',args:'',origin:PERSON,presentation:P})).text!);expect(values).toEqual([0,['vscode']])
})
