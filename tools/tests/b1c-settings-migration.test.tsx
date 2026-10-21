import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { LEGACY_SETTING_KEYS, legacyMigrationNeeded, normalizeLegacySettings } from '../hooks/settings-migration'
import { world, settleLegacyStart, RECENT, P, PERSON } from './world'

// world() normally supplies a synthesized record; this seam exposes the actual
// historical store shape, while retaining its real state/render subscriptions.
function migrationStore(on: On, legacy: Record<string,unknown>, initialRecord?: unknown,
  beforeRead?: (key:string)=>Promise<void>, beforeRecordWrite?:()=>Promise<void>) {
 let record=initialRecord
 const reads:string[]=[], writes:{key:string;value:unknown}[]=[], deletes:string[]=[]
 const original=JSON.stringify(legacy)
 on('store.*',async($,e,next)=>{
  if(next.is('store.get',e)) {
   reads.push(e.key)
   if(e.key==='bandSettings') return {value:record} as never
   if((LEGACY_SETTING_KEYS as readonly string[]).includes(e.key)) {
    await beforeRead?.(e.key)
    return {value:legacy[e.key]} as never
   }
  }
  if(next.is('store.set',e)) {
   writes.push({key:e.key,value:e.value})
   if(e.key==='bandSettings'){await beforeRecordWrite?.();record=e.value}
  }
  if(next.is('store.delete',e))deletes.push(e.key)
  return next(e)
 })
 return {
  reads,writes,deletes,record:()=>record as Record<string,unknown>,
  assertOldKeysIntact:()=>{
   expect(JSON.stringify(legacy)).toBe(original)
   expect(writes.filter(entry=>(LEGACY_SETTING_KEYS as readonly string[]).includes(entry.key))).toEqual([])
   expect(deletes).toEqual([])
  },
 }
}
const START={cwd:'/tmp/b1c-settings-migration',surface:'desktop' as const,isInteractive:true}

test('B1c legacy normalization preserves all ten explicitly stored preferences',()=>{
 const stored={lang:'zh',heard:'ja',band:'off',bandBeforeOff:'compact',workSize:'smaller',voice:'off',affection:'clingy',marks:'off',companionTarget:'vscode',neighbours:true}
 const before=JSON.stringify(stored)
 expect(LEGACY_SETTING_KEYS.slice().sort()).toEqual(Object.keys(stored).sort())
 expect(normalizeLegacySettings(stored)).toEqual(stored)
 expect(JSON.stringify(stored)).toBe(before)
})
test('B1c no present record is eligible for legacy merging, including malformed records',()=>{
 expect(legacyMigrationNeeded(undefined)).toBe(true)
 for(const record of [{}, {band:'compact',language:'de'},null,'bad',[],false,0]) expect(legacyMigrationNeeded(record)).toBe(false)
})
test('B1c missing or invalid legacy fields never manufacture a preference',()=>{
 expect(normalizeLegacySettings({})).toEqual({})
 expect(normalizeLegacySettings({lang:'unavailable',heard:3,band:'hidden',bandBeforeOff:'off',voice:'silent',affection:'cold',workSize:'tiny',marks:true,companionTarget:'anything',neighbours:'true',unexpected:'value'})).toEqual({})
})
test('B1c all historical literal options normalize and language auto stays distinct from resolved/heard language',()=>{
 for(const band of ['on','compact','off']) expect(normalizeLegacySettings({band})).toEqual({band})
 for(const bandBeforeOff of ['on','compact']) expect(normalizeLegacySettings({bandBeforeOff})).toEqual({bandBeforeOff})
 for(const workSize of ['same','smaller']) expect(normalizeLegacySettings({workSize})).toEqual({workSize})
 for(const voice of ['off','light','full']) expect(normalizeLegacySettings({voice})).toEqual({voice})
 for(const affection of ['warm','clingy']) expect(normalizeLegacySettings({affection})).toEqual({affection})
 for(const marks of ['on','replies','off']) expect(normalizeLegacySettings({marks})).toEqual({marks})
 for(const companionTarget of ['auto','claude','vscode']) expect(normalizeLegacySettings({companionTarget})).toEqual({companionTarget})
 for(const neighbours of [true,false]) expect(normalizeLegacySettings({neighbours})).toEqual({neighbours})
 expect(normalizeLegacySettings({lang:'auto',heard:'ko',language:'de'})).toEqual({lang:'auto',heard:'ko'})
 expect(normalizeLegacySettings({lang:'zh_CN.UTF-8',heard:'ja-JP'})).toEqual({lang:'zh',heard:'ja'})
})

test('B1c engine upgrades the earliest historical preferences including marks without touching old keys',async($,on)=>{
 const old={lang:'ja',heard:'zh',band:'off',bandBeforeOff:'compact',workSize:'smaller',voice:'full',affection:'clingy',marks:'on'}
 const store=migrationStore(on,old)
 const mirrors:{key:string;value:unknown}[]=[]
 on('config.*',($,e,next)=>{if(next.is('config.set',e))mirrors.push({key:e.key,value:e.value});return next(e)})
 const w=world(on,{store:{...RECENT,...old}})
 await $.session.start(START);await settleLegacyStart($,w)
 for(const key of Object.keys(old))expect(store.record()[key]).toBe(old[key as keyof typeof old])
 expect(w.view().lang).toBe('ja');expect(w.view().band).toBe('off')
 // the stored record keeps 'smaller' (checked above); the desktop band never shrinks (owner 10-19), so it draws 'same'
 expect(w.view().voice).toBe('full');expect(w.view().affection).toBe('clingy');expect(w.view().workSize).toBe('same')
 expect(mirrors).toContainEqual({key:'coco.language',value:'ja'})
 expect(mirrors).toContainEqual({key:'coco.band',value:'off'})
 expect(store.reads.filter(key=>(LEGACY_SETTING_KEYS as readonly string[]).includes(key)).slice().sort()).toEqual(LEGACY_SETTING_KEYS.slice().sort())
 store.assertOldKeysIntact()
})

test('B1c engine retains later legacy target and neighbour preferences and reads each key once across attachments',async($,on)=>{
 const old={lang:'auto',heard:'ko',band:'compact',workSize:'smaller',voice:'off',affection:'clingy',bandBeforeOff:'compact',marks:'off',companionTarget:'vscode',neighbours:true}
 const store=migrationStore(on,old),w=world(on,{store:{...RECENT,...old}})
 await $.session.start(START);await settleLegacyStart($,w)
 await $.session.attach({clientId:'b1c-migration-one',surface:'desktop'});await settleLegacyStart($,w)
 await $.session.attach({clientId:'b1c-migration-two',surface:'desktop'});await settleLegacyStart($,w)
 for(const key of LEGACY_SETTING_KEYS)expect(store.reads.filter(read=>read===key).length).toBe(1)
 expect(store.reads.filter(key=>key==='bandSettings').length).toBe(1)
 expect(store.record().lang).toBe('auto');expect(store.record().marks).toBe('off')
 expect(w.view().companionTarget).toBe('vscode');expect(w.view().neighbours).toBe(true)
 // a stored pixel band draws as the painted one on the desktop (owner 10-19)
 expect(w.view().band).toBe('on');expect(w.view().voice).toBe('off')
 store.assertOldKeysIntact()
})

test('B1c engine keeps an existing batched record authoritative and makes zero legacy reads',{options:{band:'compact',language:'fr'}},async($,on)=>{
 const old={lang:'ja',band:'off',voice:'off',workSize:'smaller',affection:'clingy',marks:'off',companionTarget:'vscode',neighbours:true}
 const newer={band:'compact',lang:'fr',voice:'full',voiceChosen:true,workSize:'same',affection:'warm',marks:'on',companionTarget:'claude',neighbours:false,futurePreference:{keep:true}}
 const store=migrationStore(on,old,newer),w=world(on,{store:{...RECENT,...old}})
 await $.session.start(START);await settleLegacyStart($,w)
 expect(store.reads.filter(key=>(LEGACY_SETTING_KEYS as readonly string[]).includes(key))).toEqual([])
 expect(w.view().band).toBe('on');expect(w.view().lang).toBe('fr') // the desktop band is always painted (owner 10-19)
 expect(w.view().voice).toBe('full');expect(w.view().workSize).toBe('same');expect(w.view().affection).toBe('warm')
 expect(w.view().companionTarget).toBe('claude');expect(w.view().neighbours).toBe(false)
 expect(store.record().marks).toBe('on');expect(store.record().futurePreference).toEqual({keep:true})
 store.assertOldKeysIntact()
})

test('B1c engine retries a timed-out legacy read on the next attachment and reuses successful key reads',{timeoutMs:15000},async($,on)=>{
 let first=true,release!:()=>void
 const ready=new Promise<void>(resolve=>{release=resolve})
 const old={lang:'ja',band:'compact',voice:'full',marks:'off'}
 const store=migrationStore(on,old,undefined,async key=>{if(key==='voice'&&first){first=false;await ready}})
 const w=world(on,{store:{...RECENT,...old}})
 await $.session.start(START);await settleLegacyStart($,w)
 expect(store.reads.filter(key=>key==='voice').length).toBe(1)
 expect(store.record()).toBeUndefined()
 await w.clock.advance(5001);await settleLegacyStart($,w)
 await $.session.attach({clientId:'b1c-migration-retry',surface:'desktop'});await settleLegacyStart($,w)
 expect(store.reads.filter(key=>key==='voice').length).toBe(2)
 for(const key of LEGACY_SETTING_KEYS.filter(key=>key!=='voice'))expect(store.reads.filter(read=>read===key).length).toBe(1)
 expect(w.view().voice).toBe('full');expect(w.view().band).toBe('on');expect(store.record().marks).toBe('off')
 release();await settleLegacyStart($,w)
 expect(w.view().voice).toBe('full');expect(store.record().marks).toBe('off')
 store.assertOldKeysIntact()
})

test('B1c engine preserves a user choice made while the legacy record is still being read',async($,on)=>{
 let release!:()=>void
 const ready=new Promise<void>(resolve=>{release=resolve})
 const old={lang:'ja',band:'off',voice:'off',marks:'off'}
 const store=migrationStore(on,old,undefined,async key=>{if(key==='voice')await ready})
 const w=world(on,{store:{...RECENT,...old}})
 await $.session.start(START)
 for(let i=0;i<12;i++)await $.command.run({command:'b1c-host-boundary',args:'',origin:PERSON,presentation:P})
 expect(store.reads).toContain('voice')
 await $.command.run({command:'coco',args:'voice full',origin:PERSON,presentation:P})
 release();await settleLegacyStart($,w)
 expect(w.view().voice).toBe('full');expect(store.record().voice).toBe('full')
 expect(w.view().band).toBe('off');expect(w.view().lang).toBe('ja');expect(store.record().marks).toBe('off')
 store.assertOldKeysIntact()
})

test('B1c engine commits the migrated record before option mirrors can reload the plugin',async($,on)=>{
 let release!:()=>void
 const ready=new Promise<void>(resolve=>{release=resolve})
 const old={lang:'ja',band:'off',voice:'full',marks:'off'}
 const store=migrationStore(on,old,undefined,undefined,()=>ready)
 const mirrors:{key:string;value:unknown;durable:boolean}[]=[]
 on('config.*',($,e,next)=>{
  if(next.is('config.set',e)&&['coco.band','coco.language'].includes(e.key))
   mirrors.push({key:e.key,value:e.value,durable:store.record()!==undefined})
  return next(e)
 })
 const w=world(on,{store:{...RECENT,...old}})
 await $.session.start(START);await settleLegacyStart($,w)
 expect(store.writes.some(entry=>entry.key==='bandSettings')).toBe(true)
 expect(store.record()).toBeUndefined();expect(mirrors).toEqual([])
 release();await settleLegacyStart($,w)
 expect(store.record().voice).toBe('full');expect(store.record().marks).toBe('off')
 expect(mirrors).toContainEqual({key:'coco.band',value:'off',durable:true})
 expect(mirrors).toContainEqual({key:'coco.language',value:'ja',durable:true})
 store.assertOldKeysIntact()
})

const WRITE_RETRY_LEGACY={lang:'ja',band:'off',voice:'full',marks:'off'}
test('B1c a failed migration write retries option mirrors after the next durable attachment',async($,on)=>{
 let record:Record<string,unknown>|undefined,attempts=0
 const mirrors:{key:string;value:unknown;durable:boolean}[]=[]
 const persistedOptions:Record<string,unknown>={band:'on',language:'auto'}
 // Replace the bottom endpoint: a failing wrapper would fall through to mock.store.
 const fixtureOn=((event:string,...args:unknown[])=>{
  if(event==='store.get')return (on as any)(event,($:unknown,e:{key:string})=>({value:e.key==='bandSettings'?record:e.key in WRITE_RETRY_LEGACY?WRITE_RETRY_LEGACY[e.key as keyof typeof WRITE_RETRY_LEGACY]:e.key==='lastActive'?RECENT.lastActive:undefined}))
  if(event==='store.set')return (on as any)(event,($:unknown,e:{key:string;value:unknown})=>{
   if(e.key==='bandSettings'){
    attempts++
    if(attempts===1)throw new Error('injected initial migration durable write failure')
    record=e.value as Record<string,unknown>
   }
   return {value:undefined}
  })
  return (on as any)(event,...args)
 }) as On
 on('config.*',($,e,next)=>{
  if(next.is('config.set',e)&&['coco.band','coco.language'].includes(e.key)){
   mirrors.push({key:e.key,value:e.value,durable:record!==undefined})
   persistedOptions[e.key.slice('coco.'.length)]=e.value
  }
  return next(e)
 })
 const w=world(fixtureOn,{store:{...RECENT,...WRITE_RETRY_LEGACY}})
 await $.session.start(START);await settleLegacyStart($,w)
 expect(attempts).toBe(1);expect(record).toBeUndefined();expect(mirrors).toEqual([])
 await $.session.attach({clientId:'b1c-migration-write-retry',surface:'desktop'});await settleLegacyStart($,w)
 expect(attempts).toBe(2)
 expect(record).toMatchObject(WRITE_RETRY_LEGACY)
 expect(w.view().band).toBe('off');expect(w.view().lang).toBe('ja')
 expect(mirrors).toContainEqual({key:'coco.band',value:'off',durable:true})
 expect(mirrors).toContainEqual({key:'coco.language',value:'ja',durable:true})
 expect(persistedOptions).toEqual({band:'off',language:'ja'})
})

// A fresh engine activation models loading the persisted options over manifest defaults.
// The engine kit's config.set fixture does not perform the desktop host's hot reload.
test('B1c a fresh activation keeps the migrated durable choices with the mirrored options',{options:{band:'off',language:'ja'}},async($,on)=>{
 const store=migrationStore(on,{},{...WRITE_RETRY_LEGACY,voiceChosen:true}),w=world(on,{store:RECENT})
 await $.session.start(START);await settleLegacyStart($,w)
 expect(w.view().band).toBe('off');expect(w.view().lang).toBe('ja');expect(w.view().voice).toBe('full')
 expect(store.record()).toMatchObject(WRITE_RETRY_LEGACY)
 expect(store.reads.filter(key=>(LEGACY_SETTING_KEYS as readonly string[]).includes(key))).toEqual([])
 store.assertOldKeysIntact()
})
