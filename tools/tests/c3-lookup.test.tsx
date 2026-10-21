import {test,expect} from 'claude-code/testing'
import {world,RECENT,settleLegacyStart} from './world'
import {C3_WORDS_RAW} from './c3-words-fixture'
import {C3_HEAD_MANIFEST} from './c3-head-assets'
import {WORDS} from '../hooks/words'
const START={cwd:'/tmp/c3-lookup',surface:'desktop' as const,isInteractive:true}
const readText=(path:string)=>path.endsWith('c3-text.json')?C3_WORDS_RAW:path.endsWith('frame-manifest.json')?JSON.stringify(C3_HEAD_MANIFEST):undefined
const step=async($:any,turnId:string,index:number)=>{for await(const _ of $.turn.step({turnId,index,model:'test',messageCount:1})){}}

test('C3 he looks up while Claude writes the reply, and the tools keep their own poses',async($,on)=>{
  const w=world(on,{store:RECENT,surfaces:['desktop'],engineRows:true,stepText:'The reply.',readText})
  await $.session.start(START);await settleLegacyStart($,w)
  await $.turn.start({turnId:'look-turn',text:'write'})
  await w.clock.advance(1300)
  await step($,'look-turn',0)
  const up=w.view().pose
  expect(up?.name).toBe('lookup')
  expect(up?.frame).toBe('look-up')
  // no words of his own for this pose: the stage direction is the one he already has for writing
  expect(up?.aside).toBe(WORDS.en.aside.work)
  await w.clock.advance(1300)
  await $.tool.call({tool:'Grep',pattern:'x'})
  expect(w.view().pose?.name).toBe('search')
  expect(w.view().pose?.frame).toBe('search-a')
  await w.clock.advance(1300)
  await $.tool.call({tool:'Edit',file_path:'/tmp/c3-lookup/a.ts'})
  expect(w.view().pose?.name).toBe('work')
  expect(w.view().pose?.frame).toBe('work-a')
})
