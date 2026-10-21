import { describe, expect, mock, test } from 'claude-code/testing'
import type { Plugin } from 'claude-code'
const PANE={plugin:'b1b-chain',surface:'desktop' as const,component:'Pane' as const,requestId:'b1b-chain-probe',props:{title:'probe',isFocused:false,bodyColumns:80,placement:'dock' as const,scroll:{offset:0,bodyRows:20},view:{}}}
describe('B1b downstream API contract',()=>{
 test('plugin EngineInterface exposes no render dispatch or bounded downstream API',async($,on)=>{
  on('command.run',($,e,next)=>{
   console.log('B1b chain API surface '+JSON.stringify({uiKeys:Object.keys($.ui),nextKeys:Object.keys(next),render:typeof ($.ui as any).render}))
   expect(typeof ($.ui as any).render).toBe('undefined')
   expect(Object.keys(next).sort()).toEqual(['budget','event','is','origin','signal','to','trace'].sort())
   return{text:''}
  })
  await $.command.run({command:'b1b-api-probe',args:'',origin:{kind:'composer'},presentation:{isFullscreen:false,columns:80}})
 })
})
