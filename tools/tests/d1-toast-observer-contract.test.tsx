import {test,expect} from 'claude-code/testing'
import {world,PERSON,P} from './world'
for(const place of ['before','after'] as const)test(`D1 actual toast namespace observer ${place} world preserves the expected handler precedence`,async($,on)=>{
 const events:{text:string;timeoutMs?:number}[]=[]
 const observe=()=>on('ui.*',($,e,next)=>{if(next.is('ui.toast',e))events.push({text:e.text,timeoutMs:e.timeoutMs});return next(e)})
 if(place==='before')observe()
 const w=world(on)
 if(place==='after')observe()
 await $.command.run({command:'d1-fixture-toast-precedence',args:'',origin:PERSON,presentation:P})
 expect(w.toasts).toEqual(['fixture actual toast'])
 expect(events).toEqual(place==='before'?[{text:'fixture actual toast',timeoutMs:12000}]:[])
})
