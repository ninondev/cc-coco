import {test,expect} from 'claude-code/testing'
import type {Plugin} from 'claude-code/testing'
import {world,RECENT,PERSON,P,settleLegacyStart} from './world'
import {closeOwnedPane,observeOwnedPaneRenders} from './d1-owner-test-fixture'
const foreign:Plugin={name:'d1-foreign-close-fixture',register(on){on('command.run',{command:'d1-fixture-close-foreign-pane'},async $=>{await $.ui.close({id:'coco-book'});return {}})}}
const pane={surface:'desktop' as const,plugin:'coco',component:'Pane' as const,requestId:'coco-book',props:{title:'fixture',isFocused:true,bodyColumns:100,placement:'dock' as const,scroll:{offset:0,bodyRows:40},view:{}}}
const run=($:any,command:string,args='')=>$.command.run({command,args,origin:PERSON,presentation:P})
const roomReads=(reads:string[])=>reads.filter(path=>/[\\/]assets[\\/]coco-room[\\/]/.test(path)).length

test('D1 fixture owner close reaches shipping room cache and foreign close cannot release it',{plugins:[foreign]},async($,on)=>{
 const closes:{id:string;origin:string;caller:string}[]=[];let draws=0
 observeOwnedPaneRenders(on,count=>{draws=count})
 on('ui.*',($,e,next)=>{if(next.is('ui.close',e))closes.push({id:e.id,origin:e.origin.kind,caller:next.origin.plugin});return next(e)})
 const w=world(on,{store:RECENT,surfaces:['desktop']})
 await $.session.start({cwd:'/tmp/d1-owner-close-contract',surface:'desktop',isInteractive:true});await settleLegacyStart($,w)
 await run($,'coco','him');let ui=await $.ui.mount(pane)
 expect(draws).toBeGreaterThan(0);const shown=draws,first=roomReads(w.fileReads);expect(first).toBeGreaterThan(0)
 await ui.redraw();expect(draws).toBeGreaterThan(shown);expect(roomReads(w.fileReads)).toBe(first)
 await run($,'d1-fixture-close-foreign-pane');await ui.redraw()
 expect(closes).toEqual([{id:'coco-book',origin:'plugin',caller:'d1-foreign-close-fixture'}])
 expect(roomReads(w.fileReads)).toBe(first)
 await closeOwnedPane($);await ui.unmount()
 expect(closes).toEqual([{id:'coco-book',origin:'plugin',caller:'d1-foreign-close-fixture'},{id:'coco-book',origin:'plugin',caller:'coco'}])
 await run($,'coco','him');ui=await $.ui.mount(pane)
 expect(roomReads(w.fileReads)).toBe(first*2)
 await closeOwnedPane($);await ui.unmount()
})
