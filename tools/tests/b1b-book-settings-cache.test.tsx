import { expect, test } from 'claude-code/testing'
import { world, settleLegacyStart, RECENT, P, PERSON } from './world'
const PANE={plugin:'coco',component:'Pane' as const,requestId:'coco-book',surface:'desktop' as const,props:{title:'Coco',isFocused:false,bodyColumns:64,placement:'dock' as const,scroll:{offset:0,bodyRows:40},view:{}}}
test('repeated book settings drawings use the activation record without store rereads',async($,on)=>{
  const reads:string[]=[]
  on('store.*',($,e,next)=>{if(next.is('store.get',e))reads.push(e.key);return next(e)})
  const w=world(on,{store:{...RECENT,bandSettings:{voice:'light',voiceChosen:true}}})
  await $.session.start({cwd:'/tmp/b1b-settings-page',surface:'desktop',isInteractive:true});await settleLegacyStart($,w)
  await $.command.run({command:'coco',args:'settings',origin:PERSON,presentation:P})
  for(let i=0;i<3;i++){const ui=await $.ui.mount(PANE);expect(await ui.find({type:'Text',text:"Coco's voice in replies"})).toBeDefined();await ui.unmount()}
  expect(reads.filter(key=>key==='bandSettings').length).toBe(1)
  expect(reads.filter(key=>['band','bandBeforeOff','voice','affection','workSize','lang','heard','marks','companionTarget','neighbours'].includes(key))).toEqual([])
})

test('auto language mirrors its resolved option once across later attachments',{options:{language:'auto',resolvedLanguage:'en'}},async($,on)=>{
  const mirrors:unknown[]=[]
  on('config.*',($,e,next)=>{if(next.is('config.set',e)&&e.key==='coco.resolvedLanguage')mirrors.push(e.value);return next(e)})
  const w=world(on,{store:RECENT,settings:{language:'Japanese'}})
  await $.session.start({cwd:'/tmp/b1b-auto-language',surface:'desktop',isInteractive:true});await settleLegacyStart($,w)
  expect(mirrors).toEqual(['ja'])
  await $.session.attach({clientId:'one',surface:'desktop'});await settleLegacyStart($,w)
  await $.session.attach({clientId:'two',surface:'desktop'});await settleLegacyStart($,w)
  expect(mirrors).toEqual(['ja'])
})

test('missing batched record preserves explicitly chosen legacy voice and restored local preferences',async($,on)=>{
  on('store.*',($,e,next)=>next.is('store.get',e)&&e.key==='bandSettings'?{value:undefined}:next(e))
  let release!:()=>void;const ready=new Promise<void>(resolve=>{release=resolve})
  on('settings.*',async($,e,next)=>{if(next.is('settings.read',e))await ready;return next(e)})
  on('state.*',($,e,next)=>next.is('state.get',e)&&e.key==='view'?({value:{value:{lang:'en',mood:'idle',frame:'idle-reading',band:'on',voice:'full',affection:'clingy',workSize:'smaller'},version:1}} as never):next(e))
  const w=world(on,{store:{...RECENT,voice:'full'}})
  await $.session.start({cwd:'/tmp/b1b-restored-preferences',surface:'desktop',isInteractive:true})
  for(let i=0;i<5;i++)await $.command.run({command:'b1b-host-boundary',args:'',origin:PERSON,presentation:P})
  release();await settleLegacyStart($,w)
  // the desktop band never shrinks while Claude works (owner 10-19), so the restored 'smaller' draws as 'same' there
  expect(w.view().voice).toBe('full');expect(w.view().affection).toBe('clingy');expect(w.view().workSize).toBe('same')
})
