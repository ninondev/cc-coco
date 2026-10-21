import type {On} from 'claude-code'
import type {Engine} from 'claude-code/testing'
import {PERSON,P} from './world'
export const closeOwnedPane=($:Engine)=>$.command.run({command:'d1-fixture-close-owned-pane',args:'',origin:PERSON,presentation:P})
export function observeOwnedPaneRenders(on:On,record:(count:number)=>void){
 let previous=0
 on('command.run',{command:'d1-fixture-report-pane-render'},($,e,next)=>{
  const count=Number(e.args)
  if(next.origin.plugin!=='coco'||!Number.isSafeInteger(count)||count!==previous+1)throw new Error('owned Pane render receipt has invalid origin or sequence')
  previous=count;record(count)
  return {}
 })
}
