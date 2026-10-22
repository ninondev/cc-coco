// Every native call and path is synthetic; these tests cannot reach a real app or HOME.
import { describe, expect, test } from 'claude-code/testing'
import type { EngineInterface, Elements, ElementChildren } from 'claude-code'
import { IconBook, iconReport, iconSection } from '../hooks/icon-book'
import { iconAutomatic, iconCommand, iconFirstDraw, iconSettingsHydrated, openIconSettings, resetIconSession, runIcon, setIconSettingsWriter } from '../hooks/pages'
import { latest } from '../hooks/latest'
import { normalizeLegacySettings } from '../hooks/settings-migration'
import { BOOK_FILES } from './book-files'
import { MOCK_WINDOWS_ROOT, samePath, slashPath } from './file-paths'
import { band, P, PERSON, RECENT, settleLegacyStart, world } from './world'
import { presenceWorld, snapshot } from './presence-world'
import { TEST_PLUGIN_ROOT, WINDOWS_ROOTS } from './test-system'
import { LANGS } from '../hooks/words'

const notice = JSON.parse(BOOK_FILES['en.json']).settings.icon.S20
const drain = async () => { for (let i=0;i<90;i++) await Promise.resolve() }

function fixture(os: 'macos' | 'linux') {
  const calls: string[][]=[], reads:string[]=[], writes:string[]=[], toasts:string[]=[], records:Record<string,unknown>[]=[]
  const events:string[]=[], metadata:string[]=[], markers:{path:string;text:string}[]=[]
  let state='stock', version='101:50', exitCode=0
  const engine={
    plugin:{root:'/tmp/press-only-plugin'},env:{get:async(key:string)=>key==='HOME'?'/tmp/press-only-home':undefined},
    fs:{exists:async(path:string)=>{metadata.push(path);return path==='/System/Library/CoreServices/SystemVersion.plist'?os==='macos':path==='/proc/sys/kernel/ostype'&&os==='linux'},read:async(path:string)=>{reads.push(path);return BOOK_FILES[slashPath(path).split('/').pop()!]??''},write:async(path:string,text:string)=>{writes.push(path);markers.push({path,text});events.push(`write:${text}`)}},
    store:{set:async(_key:string,value:Record<string,unknown>)=>{records.push({...value});events.push(`settings:${value.appIcon}`)}},
    ui:{toast:(text:string)=>toasts.push(text),invalidate:()=>{}},clock:{after:()=>{throw new Error('icon timer forbidden')}},
    process:{run:async(argv:string[])=>{calls.push(argv);events.push(`native:${argv[2]}`);if(argv[2]==='apply'&&exitCode===0)state='own';return{exitCode,stdout:`icon: ${state}\n${state==='stock'?`restore-key: ${os}:${version}\n`:''}`,stderr:''}}},
  } as unknown as EngineInterface
  latest.settings={};latest.view=undefined;setIconSettingsWriter(undefined);resetIconSession()
  return{engine,calls,reads,writes,toasts,records,events,metadata,markers,set state(value:string){state=value},set version(value:string){version=value},set exit(value:number){exitCode=value}}
}

describe('I1 press-only icon regression',()=>{
  test('restore reports accept one stock identity and reject duplicates, malformed keys and identities on other states',()=>{
    expect(iconReport('icon: stock\nrestore-key: macos:101:50\n')).toBe('stock')
    expect(iconReport('icon: stock\nrestore-key: linux:202:50\n')).toBe('stock')
    for(const report of [
      'icon: stock\nrestore-key: macos:101:50\nrestore-key: macos:101:50\n',
      'icon: stock\nrestore-key: macos:101:50\nicon: stock\n',
      'icon: stock\nrestore-key: macos:not-a-number:50\n',
      'icon: stock\nrestore-key: macos:101:-50\n',
      'icon: stock\nrestore-key: windows:101:50\n',
      'icon: stock\nrestore-key: macos:101:50 unexpected\n',
      ...['own','custom','legacy','unknown'].map(state=>`icon: ${state}\nrestore-key: macos:101:50\n`),
    ])expect(iconReport(report)).toBe('unknown')
  })
  test('restore notice migration retains a valid token or cleared value and rejects malformed or oversized input',()=>{
    for(const token of ['', 'macos:101:50','linux:202:50'])expect(normalizeLegacySettings({appIcon:'on',appIconRestoreNotice:token})).toEqual({appIcon:'on',appIconRestoreNotice:token})
    for(const token of [null,1,{},'macos:101','macos:101:50\n','windows:101:50',`macos:${'1'.repeat(1024)}:50`])expect(normalizeLegacySettings({appIcon:'on',appIconRestoreNotice:token})).toEqual({appIcon:'on'})
  })
  for(const os of ['macos','linux'] as const) {
    test(`${os}: start, first draw, stock status and update in next session never write`,async()=>{
      const f=fixture(os);latest.settings={appIcon:'on'}
      await iconAutomatic(f.engine);iconSettingsHydrated(f.engine);expect(f.calls).toEqual([])
      iconFirstDraw(f.engine);expect(f.calls).toEqual([]);await drain()
      expect(f.calls.map(a=>a[2])).toEqual(['status']);expect(f.writes).toEqual([])
      await iconAutomatic(f.engine);iconFirstDraw(f.engine);iconSettingsHydrated(f.engine);await drain();expect(f.calls.length).toBe(1)
      resetIconSession();f.version='202:50';iconFirstDraw(f.engine);await drain()
      expect(f.calls.map(a=>a[2])).toEqual(['status','status']);expect(f.writes).toEqual([])
      expect(f.calls.flat()).not.toContain('--refresh-dock')
    })
    for(const choice of ['off','absent'] as const)test(`${os}: ${choice} means zero script and icon metadata reads at every entry`,async()=>{
      const f=fixture(os);latest.settings=choice==='off'?{appIcon:'off'}:{}
      await iconAutomatic(f.engine);iconFirstDraw(f.engine);iconSettingsHydrated(f.engine);await drain()
      const c=new IconBook();await openIconSettings(f.engine,c,()=>{});c.forget();await openIconSettings(f.engine,c,()=>{})
      await runIcon(f.engine,c,'status',()=>{})
      expect(f.calls).toEqual([]);expect(f.reads.filter(p=>!slashPath(p).includes('/book/'))).toEqual([]);expect(f.writes).toEqual([])
    })
  }
  for(const choice of ['off','absent'] as const)test(`Linux fresh ${choice}: visible row discovers once per press, failed discovery cannot confirm or write`,async()=>{
    const f=fixture('linux'),c=new IconBook();latest.settings=choice==='off'?{appIcon:'off'}:{}
    f.state='unknown';f.exit=2
    await iconAutomatic(f.engine);iconFirstDraw(f.engine);iconSettingsHydrated(f.engine);await drain()
    await openIconSettings(f.engine,c,()=>{})
    expect(c.visible).toBe(true);expect(latest.settings.iconLauncherFound).toBeUndefined()
    expect(f.calls).toEqual([]);expect(f.reads).toEqual([]);expect(f.writes).toEqual([]);expect(f.records).toEqual([])
    expect(f.metadata).toEqual(['/System/Library/CoreServices/SystemVersion.plist','/proc/sys/kernel/ostype'])
    for(let press=1;press<=3;press++){
      await runIcon(f.engine,c,'choose',()=>{})
      expect(f.calls.length).toBe(press);expect(f.calls[press-1]).toEqual(['/bin/sh',WINDOWS_ROOTS&&TEST_PLUGIN_ROOT===MOCK_WINDOWS_ROOT?MOCK_WINDOWS_ROOT+'\\bin\\icon-linux.sh':'/tmp/press-only-plugin/bin/icon-linux.sh','status','--report','--restore-key'])
      expect(c.failed).toBe(true);expect(c.confirming).toBe(false);expect(c.visible).toBe(true)
      await runIcon(f.engine,c,'confirm',()=>{});await runIcon(f.engine,c,'status',()=>{})
      await iconAutomatic(f.engine);iconSettingsHydrated(f.engine);await drain()
      expect(f.calls.length).toBe(press);expect(f.writes).toEqual([]);expect(f.records).toEqual([])
      expect(latest.settings.appIcon).toBe(choice==='off'?'off':undefined)
    }
  })
  test('Linux found launcher only applies after confirmation, with consent record and marker persisted first',async()=>{
    const f=fixture('linux'),c=new IconBook();await openIconSettings(f.engine,c,()=>{})
    await runIcon(f.engine,c,'choose',()=>{})
    expect(c.confirming).toBe(true);expect(c.state).toBe('stock');expect(f.calls.map(a=>a[2])).toEqual(['status'])
    expect(latest.settings.appIcon).toBeUndefined();expect(f.records).toEqual([]);expect(f.writes).toEqual([])
    await runIcon(f.engine,c,'cancel',()=>{});expect(c.confirming).toBe(false)
    await runIcon(f.engine,c,'choose',()=>{});expect(f.calls.map(a=>a[2])).toEqual(['status','status'])
    await runIcon(f.engine,c,'confirm',()=>{})
    expect(f.calls.map(a=>a[2])).toEqual(['status','status','apply']);expect(c.state).toBe('own');expect(latest.settings.appIcon).toBe('on')
    expect(f.markers).toEqual([{path:'/tmp/press-only-home/.local/state/coco/app-icon-consent',text:'on\n'}])
    expect(f.events.indexOf('settings:on')).toBeLessThan(f.events.indexOf('write:on\n'))
    expect(f.events.indexOf('write:on\n')).toBeLessThan(f.events.indexOf('native:apply'))
    expect(f.calls.flat()).not.toContain('--refresh-dock')
  })
  test('Linux held discovery coalesces overlapping presses and cancel prevents late confirmation',async()=>{
    const f=fixture('linux'),c=new IconBook();await openIconSettings(f.engine,c,()=>{})
    let finish!: (result:unknown)=>void
    f.engine.process.run=(async(argv:string[])=>{f.calls.push(argv);return new Promise(resolve=>{finish=resolve})}) as never
    const choosing=runIcon(f.engine,c,'choose',()=>{});await drain()
    await runIcon(f.engine,c,'choose',()=>{});expect(f.calls.map(a=>a[2])).toEqual(['status'])
    await runIcon(f.engine,c,'cancel',()=>{})
    finish({exitCode:0,stdout:'icon: stock\n',stderr:''});await choosing
    expect(c.confirming).toBe(false);expect(f.calls.map(a=>a[2])).toEqual(['status']);expect(f.writes).toEqual([]);expect(f.records).toEqual([])
  })
  test('Linux overlapping choose before busy is set discovers once with both cached and held platform promises',async()=>{
    for(const cached of [true,false]){
      const f=fixture('linux'),c=new IconBook();let release!:()=>void
      c.platform=cached?Promise.resolve('linux'):new Promise(resolve=>{release=()=>resolve('linux')})
      const first=runIcon(f.engine,c,'choose',()=>{}),second=runIcon(f.engine,c,'choose',()=>{})
      expect(c.busy).toBeUndefined();expect(f.calls).toEqual([])
      if(!cached)release()
      await Promise.all([first,second])
      expect(f.calls.map(a=>a[2])).toEqual(['status']);expect(c.confirming).toBe(true)
      expect(f.writes).toEqual([]);expect(f.records).toEqual([])
    }
  })
  test('Linux cancel during discovery redraw prevents native status after its cached platform await',async()=>{
    const f=fixture('linux'),c=new IconBook();await openIconSettings(f.engine,c,()=>{})
    let canceled:Promise<void>|undefined
    await runIcon(f.engine,c,'choose',()=>{
      if(c.busy==='status'&&!canceled)canceled=runIcon(f.engine,c,'cancel',()=>{})
    })
    await canceled
    expect(canceled).toBeDefined();expect(c.busy).toBeUndefined();expect(c.confirming).toBe(false)
    expect(f.calls).toEqual([]);expect(f.reads).toEqual([]);expect(f.writes).toEqual([]);expect(f.records).toEqual([])
    expect(latest.settings.appIcon).toBeUndefined()
  })
  for(const {code} of LANGS)test(`${code}: pure failure renderer keeps both approved lines and an off row`,()=>{
    type Node={type?:string;key?:unknown;children?:unknown[]}
    const element=(type:string)=>({children,...props}:Record<string,unknown>&ElementChildren)=>
      ({type,key:props.key,props,children:children===undefined?[]:Array.isArray(children)?children:[children]}) as never
    const ui={Box:element('Box'),Text:element('Text'),Button:element('Button')} as unknown as Elements['desktop']|Elements['terminal']
    const nodes=(node:unknown):Node[]=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(nodes):[node as Node,...((node as Node).children??[]).flatMap(nodes)]
    const text=(node:unknown):string=>typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):((node as Node)?.children??[]).map(text).join('')
    const words=JSON.parse(BOOK_FILES[`${code}.json`]).settings.icon
    for(const failed of [true,false]){
      const tree=iconSection(ui,words,{state:'unknown',unavailable:!failed,failed,consent:false},()=>{throw new Error('pure failure renderer cannot press')},false,42)
      const drawn=nodes(tree),lines=drawn.filter(n=>n.type==='Text').map(text)
      expect(typeof words.failed).toBe('string');expect(words.failed.length).toBeGreaterThan(0)
      expect(typeof words.fallback).toBe('string');expect(words.fallback.length).toBeGreaterThan(0)
      expect(lines.filter(line=>line===words.failed)).toEqual([words.failed]);expect(lines.filter(line=>line===words.fallback)).toEqual([words.fallback])
      expect(drawn.some(n=>n.key==='coco:icon:choose')).toBe(true);expect(drawn.some(n=>n.key==='coco:icon:clear')).toBe(true)
      expect(drawn.some(n=>n.key==='coco:icon:confirm')).toBe(false)
    }
  })
  test('S20 is persisted once per restore across several sessions, and a later restore can say it again',async()=>{
    const f=fixture('macos');latest.settings={appIcon:'on'}
    for(let i=0;i<3;i++){resetIconSession();iconFirstDraw(f.engine);await drain()}
    expect(f.toasts).toEqual([notice]);expect(f.calls.map(a=>a[2])).toEqual(['status','status','status'])
    const saved=f.records[f.records.length-1];expect(saved).toBeDefined();expect(saved!.appIconRestoreNotice).toBe('macos:101:50')
    latest.settings={...saved};resetIconSession();iconFirstDraw(f.engine);await drain();expect(f.toasts).toEqual([notice])
    f.version='202:50';resetIconSession();iconFirstDraw(f.engine);await drain();expect(f.toasts).toEqual([notice,notice])
    await runIcon(f.engine,new IconBook(),'apply',()=>{});f.state='stock'
    resetIconSession();iconFirstDraw(f.engine);await drain();expect(f.toasts).toEqual([notice,notice,notice])
    expect(f.calls.filter(a=>a[2]==='apply').length).toBe(1)
  })
  test('a read failure cannot block; only a failed person press blocks and only another press retries',async()=>{
    const f=fixture('macos');latest.settings={appIcon:'on'};f.exit=1
    iconFirstDraw(f.engine);await drain();expect(latest.settings.appIconBlocked).not.toBe(true);expect(f.writes).toEqual([]);expect(f.toasts).toEqual([])
    const c=new IconBook();await runIcon(f.engine,c,'apply',()=>{});expect(latest.settings.appIconBlocked).toBe(true)
    resetIconSession();iconFirstDraw(f.engine);await drain();expect(f.calls.filter(a=>a[2]==='apply').length).toBe(1)
    f.exit=0;await runIcon(f.engine,c,'apply',()=>{});expect(latest.settings.appIconBlocked).toBe(false);expect(f.calls.filter(a=>a[2]==='apply').length).toBe(2)
  })
  test('Settings before first band draw never reads; after draw it awaits the cached in-flight session status',async()=>{
    const f=fixture('macos');latest.settings={appIcon:'on'};const c=new IconBook()
    await openIconSettings(f.engine,c,()=>{});expect(f.calls).toEqual([])
    let finish:((result:unknown)=>void)|undefined
    f.engine.process.run=(async(argv:string[])=>{f.calls.push(argv);return new Promise(resolve=>{finish=resolve})}) as never
    iconFirstDraw(f.engine);await drain();expect(finish).toBeDefined();expect(f.calls.map(a=>a[2])).toEqual(['status'])
    c.forget();const opening=openIconSettings(f.engine,c,()=>{});await drain();expect(f.calls.length).toBe(1)
    finish?.({exitCode:0,stdout:'icon: stock\nrestore-key: macos:101:50\n',stderr:''});await opening;await drain()
    expect(c.state).toBe('stock');expect(f.calls.map(a=>a[2])).toEqual(['status']);expect(f.writes).toEqual([])
  })
  test('failed restore notice persistence cannot say S20 or write a fallback file',async()=>{
    const f=fixture('macos');latest.settings={appIcon:'on'}
    setIconSettingsWriter(async()=>{throw new Error('fixture refuses the restore notice')})
    try{
      iconFirstDraw(f.engine);await drain()
      expect(f.calls.map(a=>a[2])).toEqual(['status']);expect(f.toasts).toEqual([]);expect(f.writes).toEqual([]);expect(latest.settings.appIconBlocked).not.toBe(true)
      await iconAutomatic(f.engine);iconSettingsHydrated(f.engine);await drain();expect(f.calls.length).toBe(1);expect(f.toasts).toEqual([]);expect(f.writes).toEqual([])
    }finally{setIconSettingsWriter(undefined)}
  })
  for(const lateState of ['stock','unknown'] as const)test(`manual apply replaces a held session ${lateState} reading; reopened Settings keeps own`,async()=>{
    const f=fixture('macos');latest.settings={appIcon:'on'}
    let finish:((result:unknown)=>void)|undefined
    f.engine.process.run=(async(argv:string[])=>{f.calls.push(argv);if(argv[2]==='status')return new Promise(resolve=>{finish=resolve});return{exitCode:0,stdout:'icon: own\n',stderr:''}}) as never
    iconFirstDraw(f.engine);await drain();expect(finish).toBeDefined()
    const c=new IconBook();await runIcon(f.engine,c,'apply',()=>{});expect(c.state).toBe('own')
    finish?.({exitCode:lateState==='unknown'?1:0,stdout:`icon: ${lateState}\n${lateState==='stock'?'restore-key: macos:101:50\n':''}`,stderr:''});await drain()
    c.forget();await openIconSettings(f.engine,c,()=>{})
    expect(c.state).toBe('own');expect(c.data(latest.settings).blocked).toBe(false);expect(f.toasts).toEqual([]);expect(f.calls.map(a=>a[2])).toEqual(['status','apply'])
  })
  test('a newer confirmation supersedes clear held in consent-marker preflight; no stale native clear can follow apply',async()=>{
    const f=fixture('macos');latest.settings={appIcon:'on'};const c=new IconBook()
    let release:(()=>void)|undefined,held=false,marker='on\n'
    f.engine.fs.write=(async(path:string,text:string)=>{f.writes.push(path);if(path.endsWith('/app-icon-consent')){if(text===''&&!held){held=true;await new Promise<void>(resolve=>{release=resolve})}marker=text}}) as never
    const clearing=runIcon(f.engine,c,'clear',()=>{});await drain();expect(release).toBeDefined()
    const confirming=runIcon(f.engine,c,'confirm',()=>{});await drain()
    release?.();await clearing;await confirming;await drain()
    expect(latest.settings.appIcon).toBe('on');expect(marker).toBe('on\n');expect(c.state).toBe('own');expect(f.calls.map(a=>a[2])).toEqual(['apply'])
  })
  test('an acknowledged notice save across session reset still says S20 once and the next session deduplicates it',async()=>{
    const f=fixture('macos');latest.settings={appIcon:'on'}
    let release:(()=>void)|undefined,held=false
    setIconSettingsWriter(async(_engine,values)=>{if(values.appIconRestoreNotice&&!held){held=true;await new Promise<void>(resolve=>{release=resolve})}latest.settings={...latest.settings,...values}})
    try{
      iconFirstDraw(f.engine);await drain();expect(release).toBeDefined();expect(f.toasts).toEqual([])
      resetIconSession();release?.();await drain()
      expect(latest.settings.appIconRestoreNotice).toBe('macos:101:50');expect(f.toasts).toEqual([notice])
      iconFirstDraw(f.engine);await drain();expect(f.calls.map(a=>a[2])).toEqual(['status','status']);expect(f.toasts).toEqual([notice]);expect(f.writes).toEqual([])
    }finally{setIconSettingsWriter(undefined)}
  })
  test('command clear held in durable off save cannot clear or save off again after a newer confirmation',async()=>{
    const f=fixture('macos');latest.settings={appIcon:'on'}
    let release:(()=>void)|undefined,held=false,marker='on\n'
    const changes:Record<string,string|boolean>[]=[]
    setIconSettingsWriter(async(_engine,values)=>{
      latest.settings={...latest.settings,...values};changes.push({...values})
      if(values.appIcon==='off'&&!held){held=true;await new Promise<void>(resolve=>{release=resolve})}
    })
    f.engine.fs.write=(async(path:string,text:string)=>{f.writes.push(path);if(path.endsWith('/app-icon-consent'))marker=text}) as never
    const clearing=iconCommand(f.engine,'clear',()=>{})
    try{
      await drain();expect(release).toBeDefined();expect(latest.settings.appIcon).toBe('off')
      await runIcon(f.engine,new IconBook(),'confirm',()=>{});expect(latest.settings.appIcon).toBe('on');expect(marker).toBe('on\n')
      release?.();await clearing;await drain()
      expect(latest.settings.appIcon).toBe('on');expect(marker).toBe('on\n');expect(f.calls.map(a=>a[2])).toEqual(['apply']);expect(changes.filter(value=>value.appIcon==='off').length).toBe(1)
    }finally{release?.();await clearing;setIconSettingsWriter(undefined)}
  })
  test('S20 awaiting uncached words cannot toast after a newer successful apply',async()=>{
    const f=fixture('macos');latest.settings={appIcon:'on'};latest.view={lang:'zh'} as never
    let release:(()=>void)|undefined
    f.engine.fs.read=(async(path:string)=>{f.reads.push(path);if(slashPath(path).endsWith('/book/zh.json'))await new Promise<void>(resolve=>{release=resolve});return BOOK_FILES[slashPath(path).split('/').pop()!]??''}) as never
    try{
      iconFirstDraw(f.engine);await drain();expect(release).toBeDefined();expect(latest.settings.appIconRestoreNotice).toBe('macos:101:50');expect(f.toasts).toEqual([])
      await runIcon(f.engine,new IconBook(),'apply',()=>{});expect(latest.settings.appIconRestoreNotice).toBe('')
      release?.();await drain();expect(f.toasts).toEqual([]);expect(f.calls.map(a=>a[2])).toEqual(['status','apply'])
    }finally{release?.();await drain();latest.view=undefined}
  })
  if(!WINDOWS_ROOTS)for(const action of ['clear','apply'] as const)test(`real presence publication cannot replay a held notice over a newer ${action}`,{timeoutMs:30_000},async($,on)=>{
    let release!:()=>void,held=false,state='stock',marker='on\n',record:Record<string,unknown>={appIcon:'on',dockTile:'off',appIconRestoreNotice:''}
    const waiting=new Promise<void>(resolve=>{release=resolve})
    const calls:string[][]=[],toasts:string[]=[]
    on('store.*',async($,e,next)=>{
      if(next.is('store.get',e)&&e.key==='bandSettings')return{value:{...record}}
      if(next.is('store.set',e)&&e.key==='bandSettings'&&e.value&&typeof e.value==='object'&&!Array.isArray(e.value)&&e.value.appIconRestoreNotice==='macos:101:50'&&!held){held=true;await waiting}
      const result=await next(e)
      if(next.is('store.set',e)&&e.key==='bandSettings'&&e.value&&typeof e.value==='object'&&!Array.isArray(e.value))record={...e.value}
      return result
    })
    // Let the shared-presence fixture handle its own process and filesystem traffic.
    on('process.*',($,e,next)=>{
      if(next.is('process.run',e)&&e.argv[1]?.includes('icon-')){
        calls.push([...e.argv]);if(e.argv[2]==='apply')state='own';if(e.argv[2]==='clear')state='stock'
        return{value:{exitCode:0,stdout:`icon: ${state}\n${state==='stock'?'restore-key: macos:101:50\n':''}`,stderr:'',isStdoutTruncated:false,isStderrTruncated:false}}
      }
      return next(e)
    })
    on('fs.*',($,e,next)=>{if(next.is('fs.write',e)&&e.path.endsWith('/app-icon-consent')){marker=e.text;return{value:undefined}}return next(e)})
    on('ui.*',($,e,next)=>{if(next.is('ui.toast',e))toasts.push(e.text);return next(e)})
    const initial={...snapshot(),settings:{appIcon:'on',dockTile:'off',appIconRestoreNotice:''}}
    // M1 starts shared presence only with a More row on; this world turns Lively on to publish through it.
    const f=presenceWorld(on,initial,{withNativePresence:true})
    const flush=async()=>{for(let i=0;i<50;i++)await $.command.run({command:'i1-presence-icon-boundary',args:'',origin:PERSON,presentation:P})}
    await $.session.start({cwd:'/tmp/i1-presence-icon-project',surface:'desktop',isInteractive:true})
    await f.clock.advance(0);await flush();await f.clock.advance(0);await flush();expect(calls).toEqual([])
    const first=await $.ui.mount({surface:'desktop',...band(100)})
    let mutation:Promise<unknown>|undefined
    let book:Awaited<ReturnType<typeof $.ui.mount>>|undefined
    try{
      await f.clock.advance(0);for(let i=0;i<3&&!held;i++)await flush();expect(held).toBe(true)
      expect(calls.map(a=>a[2])).toEqual(['status']);expect(toasts.filter(t=>t===notice)).toEqual([])
      await $.command.run({command:'coco',args:'settings',origin:PERSON,presentation:P})
      book=await $.ui.mount({surface:'terminal',plugin:'coco',component:'Pane',requestId:'coco-book',props:{title:'Coco',isFocused:true,bodyColumns:42,placement:'dock',scroll:{offset:0,bodyRows:40},view:{}}})
      mutation=$.command.run({command:'coco',args:`icon ${action}`,origin:PERSON,presentation:P})
      await flush();await book.redraw()
      expect((await book.find({key:`coco:icon:${action==='clear'?'clear':'choose'}`}))?.props.variant).toBe('primary')
    }finally{release()}
    await mutation;await flush();await f.clock.advance(0);await flush();await book!.redraw()
    const expected=action==='clear'?'off':'on',shared=(f.current as typeof initial).settings
    expect((await book!.find({key:`coco:icon:${action==='clear'?'clear':'choose'}`}))?.props.variant).toBe('primary');expect(record.appIcon).toBe(expected);expect(shared.appIcon).toBe(expected)
    expect(marker).toBe(action==='clear'?'':'on\n');expect(toasts.filter(t=>t===notice)).toEqual([]);expect(calls.map(a=>a[2])).toEqual(['status',action])
    if(action==='apply'){
      expect(record.appIconRestoreNotice).toBe('');expect(shared.appIconRestoreNotice).toBe('')
      expect(await book!.find({type:'Text',text:JSON.parse(BOOK_FILES['en.json']).settings.icon.S4})).toBeDefined();expect(await book!.find({key:'coco:icon:apply'})).toBeUndefined()
      expect(await book!.find({type:'Text',text:JSON.parse(BOOK_FILES['en.json']).settings.icon.dockRedraw})).toBeDefined()
    }else expect(await book!.find({type:'Text',text:JSON.parse(BOOK_FILES['en.json']).settings.icon.dockRedraw})).toBeUndefined()
    await book!.unmount();await first.unmount()
  })
  test('real Settings S5a press applies once with no second confirmation, each restore waits for that press',async($,on)=>{
    const calls:string[][]=[],writes:string[]=[];let state='stock',version='101:50'
    on('fs.exists',($,e)=>({value:samePath(e.path,'/System/Library/CoreServices/SystemVersion.plist')}))
    on('fs.write',($,e)=>{writes.push(e.path);return{value:undefined}})
    on('process.run',($,e)=>{if(e.argv[1]?.includes('icon-')){calls.push([...e.argv]);if(e.argv[2]==='apply')state='own'}return{value:{exitCode:0,stdout:`icon: ${state}\n${state==='stock'?`restore-key: macos:${version}\n`:''}`,stderr:'',isStdoutTruncated:false,isStderrTruncated:false}}})
    const w=world(on,{env:{HOME:'/tmp/i1-press-only-home'},store:{...RECENT,bandSettings:{appIcon:'on',dockTile:'off'}},settings:{prefersReducedMotion:true}})
    await $.session.start({cwd:'/tmp/project',surface:'desktop',isInteractive:true});await settleLegacyStart($,w);expect(calls).toEqual([])
    const first=await $.ui.mount({surface:'desktop',...band(100)})
    for(let i=0;i<50;i++)await $.command.run({command:'i1-press-only-boundary',args:'',origin:PERSON,presentation:P})
    expect(calls.map(a=>a[2])).toEqual(['status']);expect(writes.filter(p=>p.includes('app-icon'))).toEqual([])
    await $.command.run({command:'coco',args:'settings',origin:PERSON,presentation:P})
    const book=await $.ui.mount({surface:'terminal',plugin:'coco',component:'Pane',requestId:'coco-book',props:{title:'Coco',isFocused:true,bodyColumns:42,placement:'dock',scroll:{offset:0,bodyRows:40},view:{}}})
    const words=JSON.parse(BOOK_FILES['en.json']).settings.icon
    expect(await book.find({type:'Text',text:words.S5})).toBeDefined();expect((await book.find({key:'coco:icon:apply'}))?.props.label).toBe(words.S5a)
    expect(calls.filter(a=>a[2]==='apply')).toEqual([]);expect(calls.filter(a=>a[2]==='status').length).toBe(1)
    await book.press({key:'coco:icon:apply'});await w.clock.advance(0);await book.redraw()
    expect(calls.filter(a=>a[2]==='apply').length).toBe(1);expect(await book.find({type:'Text',text:words['S3.body']})).toBeUndefined();expect(await book.find({type:'Text',text:words.S4})).toBeDefined();expect(await book.find({type:'Text',text:words.dockRedraw})).toBeDefined()
    await book.unmount();await first.unmount();state='stock';version='202:50';w.resetHostState()
    await $.session.start({cwd:'/tmp/updated-project',surface:'desktop',isInteractive:true});await settleLegacyStart($,w)
    const second=await $.ui.mount({surface:'desktop',...band(100)})
    for(let i=0;i<50;i++)await $.command.run({command:'i1-press-only-boundary',args:'',origin:PERSON,presentation:P})
    expect(calls.filter(a=>a[2]==='apply').length).toBe(1)
    await $.command.run({command:'coco',args:'settings',origin:PERSON,presentation:P})
    const again=await $.ui.mount({surface:'terminal',plugin:'coco',component:'Pane',requestId:'coco-book',props:{title:'Coco',isFocused:true,bodyColumns:42,placement:'dock',scroll:{offset:0,bodyRows:40},view:{}}})
    expect(await again.find({type:'Text',text:words.S5})).toBeDefined();await again.press({key:'coco:icon:apply'});await w.clock.advance(0)
    expect(calls.filter(a=>a[2]==='apply').length).toBe(2);expect(w.toasts.filter(t=>t===notice)).toEqual([notice,notice])
    await again.unmount();await second.unmount()
  })
  for(const found of [false,true])test(`fresh Linux Settings S1b ${found?'discovers before S3a consent and apply':'shows approved fallback and stays off without a launcher'}`,async($,on)=>{
    const calls:string[][]=[],iconReads:string[]=[],writes:{path:string;text:string}[]=[],events:string[]=[]
    const initial={appIcon:'off',dockTile:'off'};let record:Record<string,unknown>={...initial},state=found?'stock':'unknown'
    latest.settings={};latest.view=undefined;resetIconSession()
    on('store.*',async($,e,next)=>{
      const result=await next(e)
      if(next.is('store.set',e)&&e.key==='bandSettings'&&!('deny' in result)){
        record={...(e.value as Record<string,unknown>)};events.push(`settings:${record.appIcon}`)
      }
      return result
    })
    on('fs.exists',($,e)=>{
      if(/app-icon|\.desktop$|\/assets\/icon\//.test(slashPath(e.path)))iconReads.push(e.path)
      return{value:samePath(e.path,'/proc/sys/kernel/ostype')}
    })
    on('fs.read',{path:/app-icon|\.desktop$|[/\\]assets[/\\]icon[/\\]/},($,e,next)=>{iconReads.push(e.path);return next(e)})
    on('fs.write',($,e)=>{writes.push({path:e.path,text:e.text});events.push(`write:${e.text}`);return{value:undefined}})
    on('process.run',($,e)=>{
      if(e.argv[1]?.includes('icon-')){calls.push([...e.argv]);events.push(`native:${e.argv[2]}`);if(e.argv[2]==='apply')state='own'}
      return{value:{exitCode:found?0:2,stdout:`icon: ${state}\n`,stderr:'',isStdoutTruncated:false,isStderrTruncated:false}}
    })
    const w=world(on,{env:{HOME:'/tmp/i1-linux-first-enable-home',XDG_STATE_HOME:'/tmp/i1-linux-first-enable-state',LANG:'en_US.UTF-8',TERM:'xterm-256color'},store:{...RECENT,bandSettings:{...initial}},settings:{prefersReducedMotion:true}})
    await $.session.start({cwd:'/tmp/i1-linux-first-enable-project',surface:'terminal',isInteractive:true});await settleLegacyStart($,w)
    await $.command.run({command:'coco',args:'settings',origin:PERSON,presentation:P})
    const book=await $.ui.mount({surface:'terminal',plugin:'coco',component:'Pane',requestId:'coco-book',props:{title:'Coco',isFocused:true,bodyColumns:42,placement:'dock',scroll:{offset:0,bodyRows:40},view:{}}})
    await w.clock.advance(0);await book.redraw()
    const words=JSON.parse(BOOK_FILES['en.json']).settings.icon
    expect(await book.find({key:'coco:icon:choose'})).toBeDefined();expect(record.iconLauncherFound).toBeUndefined()
    expect(calls).toEqual([]);expect(iconReads).toEqual([]);expect(writes.filter(w=>w.path.includes('app-icon'))).toEqual([])
    const beforeOffPress=[...events]
    await book.press({key:'coco:icon:clear'});await w.clock.advance(0);await book.redraw()
    expect(calls).toEqual([]);expect(iconReads).toEqual([]);expect(writes.filter(w=>w.path.includes('app-icon'))).toEqual([])
    expect(events).toEqual(beforeOffPress);expect(record.appIcon).toBe('off');expect(record.iconLauncherFound).toBeUndefined()
    await book.press({key:'coco:icon:choose'});await w.clock.advance(0);await book.redraw()
    expect(calls.map(a=>a[2])).toEqual(['status']);expect(calls[0]?.[1]).toContain('icon-linux.sh')
    expect(record.appIcon).toBe('off');expect(writes.filter(w=>w.path.includes('app-icon'))).toEqual([])
    if(found){
      expect(await book.find({type:'Text',text:words['S3.body']})).toBeDefined();expect(await book.find({key:'coco:icon:confirm'})).toBeDefined()
      await book.press({key:'coco:icon:confirm'});await w.clock.advance(0);await book.redraw()
      expect(calls.map(a=>a[2])).toEqual(['status','apply']);expect(record.appIcon).toBe('on')
      expect(writes.filter(w=>w.path.endsWith('/app-icon-consent'))).toEqual([{path:'/tmp/i1-linux-first-enable-state/coco/app-icon-consent',text:'on\n'}])
      expect(events.indexOf('settings:on')).toBeLessThan(events.indexOf('write:on\n'));expect(events.indexOf('write:on\n')).toBeLessThan(events.indexOf('native:apply'))
      expect(await book.find({type:'Text',text:words.S4})).toBeDefined();expect(await book.find({type:'Text',text:words.dockRedraw})).toBeUndefined()
    }else{
      expect(await book.find({type:'Text',text:words.failed})).toBeDefined();expect(await book.find({type:'Text',text:words.fallback})).toBeDefined()
      expect(await book.find({key:'coco:icon:confirm'})).toBeUndefined()
      expect(await book.find({key:'coco:icon:choose'})).toBeDefined()
      await book.press({key:'coco:icon:choose'});await w.clock.advance(0);await book.redraw()
      expect(calls.map(a=>a[2])).toEqual(['status','status']);expect(record.appIcon).toBe('off')
      expect(writes.filter(w=>w.path.includes('app-icon'))).toEqual([])
    }
    expect(calls.flat()).not.toContain('--refresh-dock');await book.unmount()
  })
})


describe('I1 registered icon command provenance',()=>{
  const origins=[
    {origin:PERSON,human:true},
    {origin:{kind:'bridge' as const},human:true},
    {origin:{kind:'plugin' as const,name:'i1-automated-origin',asUser:true as const},human:false},
    {origin:{kind:'sdk' as const},human:false},
    {origin:{kind:'scheduled-trigger' as const},human:false},
  ]
  for(const {origin,human} of origins)for(const action of ['apply','clear'] as const)
    test(`${origin.kind}: registered icon ${action} ${human?'accepts a human command':'has zero native and consent mutations'}`,async($,on)=>{
      const initial={appIcon:'on',appIconBlocked:true,appIconRestoreNotice:'macos:101:50',dockTile:'off'}
      let record:Record<string,unknown>={...initial},state='stock'
      const records:Record<string,unknown>[]=[],calls:string[][]=[],writes:{path:string;text:string}[]=[]
      latest.settings={};latest.view=undefined;resetIconSession()
      on('store.*',async($,e,next)=>{
        if(next.is('store.get',e)&&e.key==='bandSettings')return{value:{...record}}
        const result=await next(e)
        if(next.is('store.set',e)&&e.key==='bandSettings'&&!('deny' in result)){
          record={...(e.value as Record<string,unknown>)};records.push({...record})
        }
        return result
      })
      on('fs.exists',($,e)=>({value:samePath(e.path,'/System/Library/CoreServices/SystemVersion.plist')}))
      on('fs.write',($,e)=>{writes.push({path:e.path,text:e.text});return{value:undefined}})
      on('process.run',($,e)=>{
        if(e.argv[1]?.includes('icon-')){
          calls.push([...e.argv]);if(e.argv[2]==='apply')state='own';if(e.argv[2]==='clear')state='stock'
        }
        return{value:{exitCode:0,stdout:`icon: ${state}\n`,stderr:'',isStdoutTruncated:false,isStderrTruncated:false}}
      })
      const w=world(on,{
        env:{HOME:'/tmp/i1-origin-only-home',LANG:'en_US.UTF-8',TERM:'xterm-256color'},
        store:{...RECENT,bandSettings:{...initial}},settings:{prefersReducedMotion:true},
      })
      await $.session.start({cwd:'/tmp/i1-origin-only-project',surface:'terminal',isInteractive:true})
      await settleLegacyStart($,w)
      expect(calls).toEqual([]);expect(writes.filter(w=>w.path.endsWith('/app-icon-consent'))).toEqual([])
      expect(record).toMatchObject(initial)
      await $.command.run({command:'coco',args:'settings',origin:PERSON,presentation:P})
      const book=await $.ui.mount({surface:'terminal',plugin:'coco',component:'Pane',requestId:'coco-book',props:{title:'Coco',isFocused:true,bodyColumns:42,placement:'dock',scroll:{offset:0,bodyRows:40},view:{}}})
      expect((await book.find({key:'coco:icon:choose'}))?.props.variant).toBe('primary')
      const beforeRecord={...record}
      records.length=0;writes.length=0
      await $.command.run({command:'coco',args:`icon ${action}`,origin,presentation:P})
      await w.clock.advance(0);await drain()
      if(!human){
        expect(calls).toEqual([]);expect(writes).toEqual([]);expect(records).toEqual([])
        expect(record).toEqual(beforeRecord)
        await book.redraw();expect((await book.find({key:'coco:icon:choose'}))?.props.variant).toBe('primary')
      }else{
        expect(calls.map(argv=>argv[2])).toEqual([action])
        expect(records.length).toBeGreaterThan(0)
        const expected=action==='apply'
          ?{appIcon:'on',appIconBlocked:false,appIconRestoreNotice:''}
          :{appIcon:'off',appIconBlocked:false,appIconRestoreNotice:'macos:101:50'}
        expect(record).toMatchObject(expected)
        await book.redraw();expect((await book.find({key:`coco:icon:${action==='apply'?'choose':'clear'}`}))?.props.variant).toBe('primary')
        if(action==='apply')expect(await book.find({type:'Text',text:JSON.parse(BOOK_FILES['en.json']).settings.icon.S4})).toBeDefined()
        expect(w.toasts.includes(JSON.parse(BOOK_FILES['en.json']).settings.icon.dockRedraw)).toBe(action==='apply')
        const consent=writes.filter(w=>w.path.endsWith('/app-icon-consent'))
        expect(consent.map(w=>w.text)).toEqual(action==='apply'?['on\n']:['',''])
        expect(calls.flat()).not.toContain('--refresh-dock')
      }
      await book.unmount()
    })
})
