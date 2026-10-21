import type {On} from 'claude-code'
import type {Engine} from 'claude-code/testing'
import {PERSON,P} from './world'

export function fixtureStoreReader(_on:On){
 return async($:Engine,key:string):Promise<unknown>=>{
  const result=await $.command.run({command:'d1-fixture-read-actual-store',args:key,origin:PERSON,presentation:P})
  const envelope=JSON.parse(result.text!) as {version?:number;key?:string;value?:unknown}
  if(envelope.version!==1||envelope.key!==key)throw new Error('actual same-owner store read command returned an invalid envelope')
  return envelope.value
 }
}
