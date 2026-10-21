import type {Register} from 'claude-code'
import {register as productionRegister} from './register'
import {companionRequestText} from './companion'
export const register:Register=(on,options)=>{
 on('command.run',{command:'d1-fixture-companion-request'},($,e)=>{
  const args=JSON.parse(e.args) as Parameters<typeof companionRequestText>
  return {text:companionRequestText(...args)}
 })
 let invalidations:string[]=[]
 on('command.run',{command:'d1-fixture-invalidate'},async($,e)=>{
  if(e.args==='read')return {text:JSON.stringify(invalidations)}
  invalidations=[]
  $.ui.invalidate('ui.render')
  $.ui.invalidate('config.describe')
  return {}
 })
 on('command.run',{command:'d1-fixture-read-actual-store'},async($,e)=>{
  const value=await $.store.get(e.args)
  return {text:JSON.stringify({version:1,key:e.args,value})}
 })
 on('command.run',{command:'d1-fixture-toast-precedence'},async $=>{
  await $.ui.toast('fixture actual toast',{timeoutMs:12000})
  return {}
 })
 let panes=0
 on('command.run',{command:'d1-fixture-close-owned-pane'},async $=>{
  await $.ui.close({id:'coco-book'})
  return {}
 })
 on('ui.*',async($,e,next)=>{
  if(next.is('ui.invalidate',e)){
   invalidations.push(e.event)
   try{return await next(e)}catch(error){
    if(error instanceof Error&&error.name==='HooksError'&&error.message==='no implementation for ui.invalidate')return {value:undefined}
    throw error
   }
  }
  if(!next.is('ui.render',e)||e.component!=='Pane'||e.requestId!=='coco-book')return next(e)
  const tree=await next(e)
  await $.command.run({command:'d1-fixture-report-pane-render',args:String(++panes)})
  return tree
 })
 return productionRegister(on,options)
}
