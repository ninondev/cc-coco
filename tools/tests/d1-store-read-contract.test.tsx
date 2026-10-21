import {test,expect} from 'claude-code/testing'
import {fixtureStoreReader} from './d1-store-read-fixture'
import {world,RECENT,PERSON,P,settleLegacyStart} from './world'
import {drainFeed} from './feed-drain'

test('D1 actual store reader sees initial records and shipping settings writes',async($,on)=>{
 const readStored=fixtureStoreReader(on),reads:string[]=[],writes:unknown[]=[]
 on('store.*',async($,e,next)=>{
  const result=await next(e)
  if(next.is('store.get',e))reads.push(e.key)
  if(next.is('store.set',e)&&e.key==='bandSettings'&&!('deny' in result))writes.push(e.value)
  return result
 })
 const w=world(on,{store:{...RECENT,fixtureRecord:{sentinel:'actual-store'}},surfaces:['desktop']})
 await $.session.start({cwd:'/tmp/d1-store-read-contract',surface:'desktop',isInteractive:true});await settleLegacyStart($,w)
 const before=reads.filter(key=>key==='fixtureRecord').length
 expect(await readStored($,'fixtureRecord')).toEqual({sentinel:'actual-store'})
 expect(reads.filter(key=>key==='fixtureRecord').length).toBe(before+1)
 await $.command.run({command:'coco',args:'lang ja',origin:PERSON,presentation:P});await drainFeed($)
 expect(w.view().lang).toBe('ja')
 expect(writes.length).toBeGreaterThan(0)
 const stored=await readStored($,'bandSettings') as {lang?:string;language?:string}
 expect(stored).toEqual(writes[writes.length-1])
 expect(stored.lang).toBe('ja');expect(stored.language).toBe('ja')
 expect(await readStored($,'fixtureMissing')).toBeUndefined()
})
