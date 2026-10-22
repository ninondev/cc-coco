// Scripts are stubbed: no app bundle, user HOME or native window can be reached.
import { describe, expect, test } from 'claude-code/testing'
import type { EngineInterface } from 'claude-code'
import { IconBook, IconSession, iconReport, iconSection } from '../hooks/icon-book'
import { runIcon, openIconSettings, iconAutomatic, iconFirstDraw, resetIconSession, setIconSettingsWriter, iconCommand } from '../hooks/pages'
import { latest } from '../hooks/latest'
import { reminderSettings } from '../hooks/reminder-settings'
import { normalizeLegacySettings } from '../hooks/settings-migration'
import { BOOK_FILES } from './book-files'
import { ICON_AUTHOR_WORDS } from './icon-words-fixture'
import { PLUGIN_SOURCES as PLUGIN_SOURCE } from './plugin-sources'
import { settleLegacyStart, P, PERSON, RECENT, world, band } from './world'
import { posixPath, samePath } from './file-paths'
import { LANGS } from '../hooks/words'

function fake(os: 'macos' | 'linux' | 'other' = 'macos') {
  const calls: string[][] = [], options:any[] = [], writes: {path:string;text:string}[] = [], toasts: string[] = [], events:string[]=[]
  let state = 'stock', exitCode = 0
  const engine = {
    plugin:{root:"/tmp/plugin's folder"}, env:{get:async(key:string)=>key==='HOME'?'/tmp/icon-home':undefined},
    fs:{exists:async(path:string)=>path==='/System/Library/CoreServices/SystemVersion.plist'?os==='macos':path==='/proc/sys/kernel/ostype'&&os==='linux',write:async(path:string,text:string)=>{writes.push({path,text});events.push(path.endsWith('/app-icon-auto-block')?'block-write':'write')},read:async(path:string)=>BOOK_FILES[path.split('/').pop()!]??''},
    store:{set:async()=>{}},ui:{toast:(text:string)=>toasts.push(text),invalidate:()=>{}},
    clock:{after:()=>({cancel:()=>{}})},
    process:{run:async(argv:string[],init:any)=>{calls.push(argv);options.push(init);events.push(argv[2]);if(argv[2]==='apply'&&exitCode===0)state='own';if(argv[2]==='clear'&&exitCode===0)state='stock';return{exitCode,stdout:`icon: ${state}\n`,stderr:''}}},
  } as unknown as EngineInterface
  latest.settings = {}; setIconSettingsWriter(undefined); resetIconSession()
  return {engine,calls,options,writes,toasts,events,redraw:()=>{},set state(s:string){state=s},set exit(n:number){exitCode=n}}
}

function texts(node:any):string[] { if(!node)return[];if(typeof node==='string')return[node];return [...(node.props?.label?[node.props.label]:[]), ...(node.children??[]).flatMap(texts)] }

describe('I1 consent and measured icon state',()=>{
  test('absent machine choices stay off and migration keeps consent distinct from state',()=>{
    expect(reminderSettings().appIcon).toBe('off');expect(reminderSettings().dockTile).toBe('off')
    expect(normalizeLegacySettings({appIcon:'on',dockTile:'off',appIconBlocked:true,appIconLegacyChecked:true})).toEqual({appIcon:'on',dockTile:'off',appIconBlocked:true,appIconLegacyChecked:true})
    expect(normalizeLegacySettings({appIcon:'own'})).toEqual({})
  })
  test('machine report recognises legacy without inferring own from ambiguous output',()=>{
    for(const state of ['own','stock','custom','legacy','unknown'])expect(iconReport(`icon: ${state}\n`)).toBe(state)
    for(const value of ['Done.','icon: own\nicon: stock','icon: other',''])expect(iconReport(value)).toBe('unknown')
  })
  for(const os of ['macos','linux'] as const)test(`${os}: off status and apply perform no IO; explicit clear remains authorised`,async()=>{
    const f=fake(os),c=new IconBook()
    await runIcon(f.engine,c,'apply',f.redraw);expect(f.calls).toEqual([]);expect(f.writes).toEqual([])
    await runIcon(f.engine,c,'status',f.redraw);await runIcon(f.engine,c,'clear',f.redraw)
    expect(f.calls.map(a=>a[2])).toEqual(['clear']);expect(f.calls[0]).toContain('--revoke-consent')
  })
  for(const {code} of LANGS)test(`selected ${code} book language is passed as a literal process environment value`,async()=>{
    const f=fake(),c=new IconBook();latest.settings={appIcon:'on'};latest.view={lang:code} as never
    await runIcon(f.engine,c,'apply',f.redraw)
    expect(f.options[0].env).toEqual({PATH:'/usr/bin:/bin:/usr/sbin:/sbin',COCO_LANGUAGE:code})
    latest.view=undefined
  })
  test('first press only confirms; cancel changes nothing; confirm persists consent before one apply',async()=>{
    const f=fake(),c=new IconBook()
    await runIcon(f.engine,c,'choose',f.redraw);expect(c.confirming).toBe(true);expect(f.calls).toEqual([]);expect(latest.settings.appIcon).toBeUndefined()
    await runIcon(f.engine,c,'cancel',f.redraw);expect(c.confirming).toBe(false);expect(f.writes).toEqual([])
    await runIcon(f.engine,c,'choose',f.redraw);await runIcon(f.engine,c,'confirm',f.redraw)
    expect(latest.settings.appIcon).toBe('on');expect(f.writes.find(w=>w.path.endsWith('/app-icon-consent'))?.text).toBe('on\n');expect(f.events).toEqual(['write','apply']);expect(c.state).toBe('own');expect(c.failed).toBe(false)
    await runIcon(f.engine,c,'clear',f.redraw);expect(latest.settings.appIcon).toBe('off');expect(c.state).toBe('stock')
  })
  test('dock tile has no confirmation and performs no icon IO',async()=>{
    const f=fake(),c=new IconBook();await runIcon(f.engine,c,'dock-on',f.redraw)
    expect(latest.settings.dockTile).toBe('on');expect(c.confirming).toBe(false);expect(f.calls).toEqual([]);expect(f.writes).toEqual([])
    await runIcon(f.engine,c,'dock-off',f.redraw);expect(latest.settings.dockTile).toBe('off')
  })
  test('absent choice cannot read even a legacy or custom icon when Settings opens',async()=>{
    for(const state of ['legacy','custom','stock']){
      const f=fake(),c=new IconBook();f.state=state;await openIconSettings(f.engine,c,f.redraw)
      expect(c.legacy).toBe(false);expect(f.calls).toEqual([]);expect(f.writes).toEqual([])
      c.forget();await openIconSettings(f.engine,c,f.redraw);expect(f.calls.length).toBe(0);expect(latest.settings.appIcon).toBeUndefined()
    }
  })
  test('explicit off does not read icon state on Settings opens',async()=>{
    const f=fake(),c=new IconBook();latest.settings={appIcon:'off',dockTile:'off'}
    await openIconSettings(f.engine,c,f.redraw);c.forget();await openIconSettings(f.engine,c,f.redraw);expect(f.calls).toEqual([])
  })
  test('Linux absent choice stays visible and never discovers a launcher before a press',async()=>{
    const f=fake('linux'),c=new IconBook();f.exit=1;await openIconSettings(f.engine,c,f.redraw);expect(c.visible).toBe(true)
    c.forget();await openIconSettings(f.engine,c,f.redraw);expect(f.calls.length).toBe(0)
  })
  test('session latch requires first draw and consent, checks even a failed-press block, then claims once',()=>{
    const s=new IconSession();expect(s.claim({appIcon:'on'})).toBe(false);s.drawn=true
    expect(s.claim({})).toBe(false);expect(s.claim({appIcon:'on',appIconBlocked:true})).toBe(true)
    expect(s.claim({appIcon:'on'})).toBe(false)
  })
  test('read-only status happens only after returned first draw, once; no write, Dock refresh or idle work',async()=>{
    const f=fake();latest.settings={appIcon:'on'}
    await iconAutomatic(f.engine);expect(f.calls).toEqual([])
    iconFirstDraw(f.engine);f.events.push('returned-tree');expect(f.calls).toEqual([])
    for(let i=0;i<50;i++)await Promise.resolve()
    expect(f.events.indexOf('status')).toBeGreaterThan(f.events.indexOf('returned-tree'))
    expect(f.calls.map(a=>a[2])).toEqual(['status']);expect(f.calls.flat()).not.toContain('--refresh-dock');expect(f.writes).toEqual([])
    await iconAutomatic(f.engine);iconFirstDraw(f.engine);for(let i=0;i<20;i++)await Promise.resolve()
    expect(f.calls.length).toBe(1)
  })
  test('stale draw microtask cannot run a freshly reset session',async()=>{
    const f=fake();latest.settings={appIcon:'on'};iconFirstDraw(f.engine);resetIconSession()
    for(let i=0;i<40;i++)await Promise.resolve();expect(f.calls).toEqual([])
  })
  test('session check gets its own read while a book status is held or forgotten',async()=>{
    const f=fake(),c=new IconBook();latest.settings={appIcon:'on'}
    let finish: ((r:unknown)=>void)|undefined, runs=0
    f.engine.process.run=(async(argv:string[])=>{f.calls.push(argv);runs++;if(runs===1)return new Promise(resolve=>{finish=resolve});return{exitCode:0,stdout:`icon: ${argv[2]==='apply'?'own':'stock'}\n`,stderr:''}}) as never
    const uiStatus=runIcon(f.engine,c,'status',f.redraw)
    for(let i=0;i<20&&!finish;i++)await Promise.resolve()
    expect(c.busy).toBe('status');c.forget();iconFirstDraw(f.engine)
    for(let i=0;i<70;i++)await Promise.resolve()
    expect(f.calls.map(a=>a[2])).toEqual(['status','status'])
    finish?.({exitCode:0,stdout:'icon: own\n',stderr:''});await uiStatus
    await iconAutomatic(f.engine);expect(f.calls.length).toBe(2)
  })
  test('new session gets its own status while an old session status remains held',async()=>{
    const f=fake();latest.settings={appIcon:'on'}
    let finish:((r:unknown)=>void)|undefined,runs=0
    f.engine.process.run=(async(argv:string[])=>{f.calls.push(argv);runs++;if(runs===1)return new Promise(resolve=>{finish=resolve});return{exitCode:0,stdout:`icon: ${argv[2]==='apply'?'own':'stock'}\n`,stderr:''}}) as never
    iconFirstDraw(f.engine);for(let i=0;i<40&&!finish;i++)await Promise.resolve()
    resetIconSession();iconFirstDraw(f.engine);for(let i=0;i<70;i++)await Promise.resolve()
    expect(f.calls.map(a=>a[2])).toEqual(['status','status'])
    finish?.({exitCode:1,stdout:'icon: unknown\n',stderr:''});for(let i=0;i<40;i++)await Promise.resolve()
    expect(latest.settings.appIconBlocked).not.toBe(true);expect(f.writes).toEqual([])
  })
  test('explicit successful apply invalidates a held old session read failure',async()=>{
    const f=fake();latest.settings={appIcon:'on'}
    let finish:((r:unknown)=>void)|undefined
    f.engine.process.run=(async(argv:string[])=>{f.calls.push(argv);if(argv[2]==='status')return new Promise(resolve=>{finish=resolve});return{exitCode:0,stdout:'icon: own\n',stderr:''}}) as never
    iconFirstDraw(f.engine);for(let i=0;i<40&&!finish;i++)await Promise.resolve()
    expect(finish).toBeDefined();await runIcon(f.engine,new IconBook(),'apply',f.redraw)
    finish?.({exitCode:1,stdout:'icon: unknown\n',stderr:''});for(let i=0;i<50;i++)await Promise.resolve()
    expect(latest.settings.appIconBlocked).toBe(false);expect(f.toasts).toEqual([]);expect(f.calls.map(a=>a[2])).toEqual(['status','apply'])
    await iconAutomatic(f.engine);expect(f.calls.length).toBe(2)
  })
  test('an explicit apply during a held book status queues one authorised apply',async()=>{
    const f=fake(),c=new IconBook();latest.settings={appIcon:'on'}
    let finish:((r:unknown)=>void)|undefined
    f.engine.process.run=(async(argv:string[])=>{f.calls.push(argv);if(argv[2]==='status')return new Promise(resolve=>{finish=resolve});return{exitCode:0,stdout:'icon: own\n',stderr:''}}) as never
    const first=runIcon(f.engine,c,'status',f.redraw);for(let i=0;i<40&&!finish;i++)await Promise.resolve()
    await runIcon(f.engine,c,'apply',f.redraw);finish?.({exitCode:0,stdout:'icon: stock\n',stderr:''});await first
    expect(f.calls.map(a=>a[2])).toEqual(['status','apply']);expect(c.failed).toBe(false);expect(c.state).toBe('own')
  })
  test('clear finishes after an in-flight person apply and leaves consent and the icon off',async()=>{
    const f=fake();latest.settings={appIcon:'on'}
    let finish:(()=>void)|undefined,native='stock'
    f.engine.process.run=(async(argv:string[])=>{f.calls.push(argv);if(argv[2]==='apply'){await new Promise<void>(resolve=>{finish=resolve});native='own'}if(argv[2]==='clear')native='stock';return{exitCode:0,stdout:`icon: ${native}\n`,stderr:''}}) as never
    const apply=runIcon(f.engine,new IconBook(),'apply',f.redraw);for(let i=0;i<60&&!finish;i++)await Promise.resolve()
    expect(finish).toBeDefined()
    const clear=runIcon(f.engine,new IconBook(),'clear',f.redraw)
    for(let i=0;i<40;i++)await Promise.resolve()
    const before={consent:latest.settings.appIcon,marker:f.writes[f.writes.length-1]?.text,calls:f.calls.map(a=>a[2])}
    finish?.();await apply;await clear;for(let i=0;i<40;i++)await Promise.resolve()
    expect(before).toEqual({consent:'off',marker:'',calls:['apply']})
    expect(f.calls.map(a=>a[2])).toEqual(['apply','clear']);expect(native).toBe('stock');expect(latest.settings.appIconBlocked).not.toBe(true);expect(f.toasts).toEqual([])
    expect(f.writes[f.writes.length-1]?.text).toBe('')
  })
  test('clear revokes consent immediately while the book status is held',async()=>{
    const f=fake(),c=new IconBook();latest.settings={appIcon:'on'}
    let finish:((r:unknown)=>void)|undefined
    f.engine.process.run=(async(argv:string[])=>{f.calls.push(argv);if(argv[2]==='status')return new Promise(resolve=>{finish=resolve});return{exitCode:0,stdout:'icon: stock\n',stderr:''}}) as never
    const status=runIcon(f.engine,c,'status',f.redraw);for(let i=0;i<40&&!finish;i++)await Promise.resolve()
    await runIcon(f.engine,c,'clear',f.redraw)
    const before={consent:latest.settings.appIcon,marker:f.writes[f.writes.length-1]?.text,calls:f.calls.map(a=>a[2])}
    finish?.({exitCode:0,stdout:'icon: own\n',stderr:''});await status
    expect(before).toEqual({consent:'off',marker:'',calls:['status']});expect(f.calls.map(a=>a[2])).toEqual(['status','clear']);expect(c.state).toBe('stock')
  })
  test('closing the book during clear preflight cannot cancel the authorised native clear',async()=>{
    const f=fake(),c=new IconBook();latest.settings={appIcon:'on'}
    let closed=false
    await runIcon(f.engine,c,'clear',()=>{if(c.busy==='clear'&&!closed){closed=true;c.forget()}})
    expect(closed).toBe(true);expect(f.calls.map(a=>a[2])).toEqual(['clear']);expect(latest.settings.appIcon).toBe('off');expect(f.writes[f.writes.length-1]?.text).toBe('')
    expect(c.changed).toBe(false);expect(c.state).toBe('unknown')
  })
  test('confirmation during an in-flight clear queues one apply and the last press wins',async()=>{
    const f=fake(),c=new IconBook();latest.settings={appIcon:'on'}
    let finish:(()=>void)|undefined,native='own'
    f.engine.process.run=(async(argv:string[])=>{f.calls.push(argv);if(argv[2]==='clear'){await new Promise<void>(resolve=>{finish=resolve});native='stock'}if(argv[2]==='apply')native='own';return{exitCode:0,stdout:`icon: ${native}\n`,stderr:''}}) as never
    const clear=runIcon(f.engine,c,'clear',f.redraw);for(let i=0;i<60&&!finish;i++)await Promise.resolve()
    expect(finish).toBeDefined();await runIcon(f.engine,c,'confirm',f.redraw);await runIcon(f.engine,c,'apply',f.redraw)
    const before={consent:latest.settings.appIcon,calls:f.calls.map(a=>a[2])}
    finish?.();await clear
    expect(before).toEqual({consent:'on',calls:['clear']});expect(f.calls.map(a=>a[2])).toEqual(['clear','apply']);expect(native).toBe('own');expect(c.state).toBe('own');expect(latest.settings.appIcon).toBe('on');expect(f.writes[f.writes.length-1]?.text).toBe('on\n')
  })
  test('confirmation supersedes a clear queued behind apply and restores consent without a stale clear',async()=>{
    const f=fake(),c=new IconBook();latest.settings={appIcon:'on'}
    let finish:(()=>void)|undefined,native='stock',held=false
    f.engine.process.run=(async(argv:string[])=>{f.calls.push(argv);if(argv[2]==='apply'){if(!held){held=true;await new Promise<void>(resolve=>{finish=resolve})}native='own'}if(argv[2]==='clear')native='stock';return{exitCode:0,stdout:`icon: ${native}\n`,stderr:''}}) as never
    const apply=runIcon(f.engine,c,'apply',f.redraw);for(let i=0;i<60&&!finish;i++)await Promise.resolve()
    expect(finish).toBeDefined();await runIcon(f.engine,c,'clear',f.redraw);await runIcon(f.engine,c,'confirm',f.redraw)
    const before={consent:latest.settings.appIcon,marker:f.writes[f.writes.length-1]?.text,calls:f.calls.map(a=>a[2])}
    finish?.();await apply
    expect(before).toEqual({consent:'on',marker:'',calls:['apply']});expect(f.calls.map(a=>a[2])).toEqual(['apply','apply']);expect(native).toBe('own');expect(c.state).toBe('own');expect(latest.settings.appIcon).toBe('on');expect(f.writes[f.writes.length-1]?.text).toBe('on\n')
  })
  test('failed session status does not block future sessions or write a marker',async()=>{
    const f=fake();latest.settings={appIcon:'on'};f.exit=1;iconFirstDraw(f.engine)
    for(let i=0;i<80;i++)await Promise.resolve()
    expect(latest.settings.appIconBlocked).not.toBe(true);expect(f.toasts).toEqual([]);expect(f.writes).toEqual([])
    resetIconSession();iconFirstDraw(f.engine);for(let i=0;i<60;i++)await Promise.resolve();expect(f.calls.map(a=>a[2])).toEqual(['status','status'])
    await runIcon(f.engine,new IconBook(),'apply',f.redraw);expect(latest.settings.appIconBlocked).toBe(true)
    f.exit=0;await runIcon(f.engine,new IconBook(),'apply',f.redraw);expect(latest.settings.appIconBlocked).toBe(false)
  })
  test('owned or stranger custom icon is not overwritten by a session status',async()=>{
    for(const state of ['own','custom','legacy']){const f=fake();latest.settings={appIcon:'on'};f.state=state;iconFirstDraw(f.engine);for(let i=0;i<60;i++)await Promise.resolve();expect(f.calls.map(a=>a[2])).toEqual(['status'])}
  })
  test('command off says S9 without a process, on says S10 before one apply',async()=>{
    const f=fake(),say=(s:string)=>{f.toasts.push(s);f.events.push('say')}
    await iconCommand(f.engine,'apply',say);expect(f.toasts).toEqual([JSON.parse(BOOK_FILES['en.json']).settings.icon.S9]);expect(f.calls).toEqual([])
    latest.settings={appIcon:'on',appIconBlocked:true};f.events.length=0;await iconCommand(f.engine,'apply',say)
    // After the apply on macOS he says the icon is his, then the Dock line (APP-ICON ic-no-dock-refresh, b1-main 5566730).
    const icon=JSON.parse(BOOK_FILES['en.json']).settings.icon
    expect(f.toasts.slice(1)).toEqual([icon.S10,icon.S4,icon.dockRedraw]);expect(f.events).toEqual(['say','write','apply','say','say']);expect(latest.settings.appIconBlocked).toBe(false)
  })
  test('command apply queued behind UI status says S10 without reporting the old own state as done',async()=>{
    const f=fake();latest.settings={appIcon:'on'};f.state='own'
    const say=(s:string)=>{f.toasts.push(s)}
    await iconCommand(f.engine,'status',say);f.toasts.length=0
    let finish:((r:unknown)=>void)|undefined
    f.engine.process.run=(async(argv:string[])=>{f.calls.push(argv);if(argv[2]==='status')return new Promise(resolve=>{finish=resolve});return{exitCode:0,stdout:'icon: own\n',stderr:''}}) as never
    const status=iconCommand(f.engine,'status',say);for(let i=0;i<40&&!finish;i++)await Promise.resolve()
    await iconCommand(f.engine,'apply',say);const before=[...f.toasts]
    finish?.({exitCode:0,stdout:'icon: own\n',stderr:''});await status
    expect(before).toEqual([JSON.parse(BOOK_FILES['en.json']).settings.icon.S10]);expect(f.calls.map(a=>a[2])).toEqual(['status','status','apply'])
  })
  test('icon lane contains no idle timers/read loops and render only schedules after returning',()=>{
    const code=PLUGIN_SOURCE['hooks/pages.tsx'],section=code.slice(code.indexOf('const iconSession'),code.indexOf('// Held only while'))
    expect(section).not.toMatch(/clock\.after|setTimeout|setInterval|while\s*\(/)
    const register=PLUGIN_SOURCE['hooks/register.tsx'];expect(register).toContain('iconFirstDraw(bookEngine($))\n      return candidate')
    expect(register).toContain('iconSettingsHydrated(bookEngine($))')
  })
  test('native engine first band returns while its read-only icon process is held indefinitely', async ($, on) => {
    let release: (()=>void) | undefined
    const held = new Promise<void>(resolve => { release=resolve }), calls:string[][]=[]
    on('fs.exists',($,e)=>({value:samePath(e.path,'/System/Library/CoreServices/SystemVersion.plist')}))
    on('process.run',async($,e)=>{if(e.argv[1]?.includes('icon-')){calls.push([...e.argv]);await held}return{value:{exitCode:0,stdout:'icon: own\n',stderr:'',isStdoutTruncated:false,isStderrTruncated:false}}})
    const w=world(on,{store:{...RECENT,bandSettings:{appIcon:'on',dockTile:'off'}},surfaces:['desktop']})
    await $.session.start({cwd:'/tmp/project',surface:'desktop',isInteractive:true});await settleLegacyStart($,w)
    expect(calls).toEqual([])
    const ui=await $.ui.mount({surface:'desktop',...band(100)})
    expect(await ui.find({type:'Svg'})).toBeDefined()
    for(let i=0;i<10;i++)await $.command.run({command:'i1-boundary',args:'',origin:PERSON,presentation:P})
    expect(calls.map(a=>a[2])).toEqual(['status'])
    release?.();await ui.unmount()
  })
  // The band is an activation option; voice and icon consent live in the machine record.
  test('whole plugin with band and voice off has zero new timers and file/store reads while idle', {options:{band:'off'}}, async ($, on) => {
    let timers=0,reads=0,pending=0
    const active = new Map<number, number>()
    const waiting = new Map<AbortSignal, number>()
    const add=(ms:number)=>active.set(ms,(active.get(ms)??0)+1)
    const drop=(ms:number)=>{const n=(active.get(ms)??1)-1;if(n)active.set(ms,n);else active.delete(ms)}
    on('clock.after',{ms:/.*/},async($,e,next)=>{timers++;pending++;add(e.ms);waiting.set(next.signal,e.ms);try{return await next(e)}finally{pending--;drop(e.ms);waiting.delete(next.signal)}})
    on('clock.every',{ms:/.*/},async($,e,next)=>{timers++;pending++;add(e.ms);waiting.set(next.signal,e.ms);try{return await next(e)}finally{pending--;drop(e.ms);waiting.delete(next.signal)}})
    on('fs.read',{path:/.*/},async($,e,next)=>{reads++;return next(e)})
    on('store.get',{key:/.*/},async($,e,next)=>{reads++;return next(e)})
    const w=world(on,{store:{...RECENT,bandSettings:{band:'off',voice:'off',appIcon:'off',dockTile:'off'}},settings:{prefersReducedMotion:true}})
    await $.session.start({cwd:'/tmp/project',surface:'terminal',isInteractive:true});await settleLegacyStart($,w)
    const ui=await $.ui.mount({surface:'desktop',...band(100)})
    await w.clock.advance(0)
    expect(w.view().band).toBe('off');expect(w.view().voice).toBe('off')
    expect({pending,active:[...active.entries()],waiting:[...waiting.entries()].map(([signal,ms])=>({ms,aborted:signal.aborted}))}).toEqual({pending:0,active:[],waiting:[]})
    const before={timers,reads};await w.clock.advance(60_000)
    expect(timers-before.timers).toBe(0);expect(reads-before.reads).toBe(0);expect(pending).toBe(0)
    await ui.unmount()
  })
  test('settled off plugin incurs zero icon timers, scripts and reads during idle redraws', async ($, on) => {
    const calls:string[][]=[],iconReads:string[]=[]
    on('process.run',($,e)=>{if(e.argv[1]?.includes('icon-'))calls.push([...e.argv]);return{value:{exitCode:0,stdout:'icon: stock\n',stderr:'',isStdoutTruncated:false,isStderrTruncated:false}}})
    const w=world(on,{store:{...RECENT,bandSettings:{appIcon:'off',dockTile:'off'}},settings:{prefersReducedMotion:true},readText:path=>{if(path.includes('/assets/icon/')||path.endsWith('/app-icon-consent'))iconReads.push(path);return undefined}})
    await $.session.start({cwd:'/tmp/project',surface:'terminal',isInteractive:true});await settleLegacyStart($,w)
    const ui=await $.ui.mount({surface:'desktop',...band(100)})
    await w.clock.advance(0);const reads=iconReads.length
    await w.clock.advance(60_000);await ui.redraw();await w.clock.advance(60_000)
    expect(calls).toEqual([]);expect(iconReads.length-reads).toBe(0)
    // The icon implementation registers no timer at all, including a deferred first-check timer.
    expect(PLUGIN_SOURCE['hooks/pages.tsx'].slice(PLUGIN_SOURCE['hooks/pages.tsx'].indexOf('const iconSession'),PLUGIN_SOURCE['hooks/pages.tsx'].indexOf('// Held only while'))).not.toContain('clock.after')
  })
  for (const surface of ['desktop','terminal'] as const) test(`${surface}: off choice, inline warning, confirmation and keyboard order`, async ($, on) => {
    const calls: string[][] = []
    let current = 'stock'
    on('fs.write',()=>({value:undefined}))
    on('fs.exists', ($,e) => ({value:samePath(e.path,'/System/Library/CoreServices/SystemVersion.plist')}))
    on('process.run', ($,e) => { calls.push([...e.argv]); if (e.argv[2]==='apply') current='own'; if (e.argv[2]==='clear') current='stock'; return {value:{exitCode:0,stdout:`icon: ${current}\n`,stderr:'',isStdoutTruncated:false,isStderrTruncated:false}} })
    const w=world(on,{env:{HOME:'/tmp/i1-book-home',LANG:'en_US.UTF-8',TERM:'xterm-256color'},store:{...RECENT,bandSettings:{appIcon:'off',dockTile:'off'}}})
    await $.session.start({cwd:'/tmp/project',surface:'terminal',isInteractive:true});await settleLegacyStart($,w)
    await $.command.run({command:'coco',args:'settings',origin:PERSON,presentation:P})
    const ui=await $.ui.mount({surface,plugin:'coco',component:'Pane',requestId:'coco-book',props:{title:'Coco',isFocused:true,bodyColumns:42,placement:'dock',scroll:{offset:0,bodyRows:40},view:{}}})
    const words=JSON.parse(BOOK_FILES['en.json']).settings.icon
    expect({label:!!(await ui.find({type:'Text',text:words.S1})),help:!!(await ui.find({type:'Text',text:words.S2}))}).toEqual({label:true,help:true})
    expect(calls.filter(a=>a[1]?.includes('icon-'))).toEqual([])
    await ui.press({key:'coco:icon:choose'});await w.clock.advance(0);await ui.redraw()
    expect({confirmation:!!(await ui.find({type:'Text',text:words['S3.body']}))}).toEqual({confirmation:true});expect(calls.filter(a=>a[1]?.includes('icon-'))).toEqual([])
    const actions=(await ui.findAll({type:'Button'})).filter(b=>b.key?.startsWith('coco:icon:'))
    expect(actions.map(b=>b.key)).toEqual(['coco:icon:clear','coco:icon:choose','coco:icon:pick-coco','coco:icon:pick-dake','coco:icon:pick-keycap','coco:icon:pick-ornament','coco:icon:confirm','coco:icon:cancel','coco:icon:dock-on'])
    expect(actions.every(b=>!b.props.hotkey)).toBe(true)
    await ui.press({key:'coco:icon:confirm'});await w.clock.advance(0);await ui.redraw()
    expect({applied:!!(await ui.find({type:'Text',text:words.S4})),calls:calls.filter(a=>a[1]?.includes('icon-')).map(a=>a[2])}).toEqual({applied:true,calls:['apply']})
    await ui.press({key:'coco:icon:clear'});await w.clock.advance(0);await ui.redraw()
    expect(calls.filter(a=>a[1]?.includes('icon-')).map(a=>a[2])).toEqual(['apply','clear'])
  })
  test('a picked picture is stored without a process while off, then goes on with its --choice',async($,on)=>{
    // DECISIONS 942: four pictures; the script hears --choice only for the three that are not the default.
    let current='stock';const calls:string[][]=[]
    on('fs.write',()=>({value:undefined}))
    on('fs.exists', ($,e) => ({value:samePath(e.path,'/System/Library/CoreServices/SystemVersion.plist')}))
    on('process.run', ($,e) => { calls.push([...e.argv]); if (e.argv[2]==='apply') current='own'; if (e.argv[2]==='clear') current='stock'; return {value:{exitCode:0,stdout:`icon: ${current}\n`,stderr:'',isStdoutTruncated:false,isStderrTruncated:false}} })
    const w=world(on,{env:{HOME:'/tmp/i1-book-home',LANG:'en_US.UTF-8',TERM:'xterm-256color'},store:{...RECENT,bandSettings:{appIcon:'off',dockTile:'off'}}})
    await $.session.start({cwd:'/tmp/project',surface:'terminal',isInteractive:true});await settleLegacyStart($,w)
    await $.command.run({command:'coco',args:'settings',origin:PERSON,presentation:P})
    const ui=await $.ui.mount({surface:'desktop',plugin:'coco',component:'Pane',requestId:'coco-book',props:{title:'Coco',isFocused:true,bodyColumns:42,placement:'dock',scroll:{offset:0,bodyRows:40},view:{}}})
    const words=JSON.parse(BOOK_FILES['en.json']).settings.icon
    const icon=()=>calls.filter(a=>a[1]?.includes('icon-'))
    expect(!!(await ui.find({type:'Text',text:words.pick}))).toBe(true)
    await ui.press({key:'coco:icon:pick-dake'});await w.clock.advance(0);await ui.redraw()
    expect(icon()).toEqual([])
    expect((await ui.find({key:'coco:icon:pick-dake'}))?.props.variant).toBe('primary')
    await ui.press({key:'coco:icon:choose'});await w.clock.advance(0);await ui.redraw()
    await ui.press({key:'coco:icon:confirm'});await w.clock.advance(0);await ui.redraw()
    expect(icon().map(a=>a.slice(2))).toEqual([['apply','--report','--choice','dake']])
    await ui.press({key:'coco:icon:pick-keycap'});await w.clock.advance(0);await ui.redraw()
    expect(icon().map(a=>a.slice(2)).at(-1)).toEqual(['apply','--report','--choice','keycap'])
    await ui.press({key:'coco:icon:pick-coco'});await w.clock.advance(0);await ui.redraw()
    expect(icon().map(a=>a.slice(2)).at(-1)).toEqual(['apply','--report'])
    await ui.press({key:'coco:icon:pick-coco'});await w.clock.advance(0);await ui.redraw()
    expect(icon().length).toBe(3)
    await ui.unmount()
  })
  test('refused consent record never authorises a native apply',async($,on)=>{
    const calls:string[][]=[],writes:string[]=[]
    on('store.set',{key:'bandSettings'},($,e,next)=>e.value && typeof e.value==='object' && (e.value as any).appIcon==='on' ? {deny:'fixture refused consent'} as never : next(e))
    on('fs.exists',($,e)=>({value:samePath(e.path,'/System/Library/CoreServices/SystemVersion.plist')}))
    on('fs.write',($,e)=>{writes.push(e.path);return{value:undefined}})
    on('process.run',($,e)=>{calls.push([...e.argv]);return{value:{exitCode:0,stdout:'icon: own\n',stderr:'',isStdoutTruncated:false,isStderrTruncated:false}}})
    const w=world(on,{env:{HOME:'/tmp/i1-denied-home'},store:{...RECENT,bandSettings:{appIcon:'off',dockTile:'off'}}})
    await $.session.start({cwd:'/tmp/project',surface:'terminal',isInteractive:true});await settleLegacyStart($,w)
    await $.command.run({command:'coco',args:'settings',origin:PERSON,presentation:P})
    const ui=await $.ui.mount({surface:'terminal',plugin:'coco',component:'Pane',requestId:'coco-book',props:{title:'Coco',isFocused:true,bodyColumns:42,placement:'dock',scroll:{offset:0,bodyRows:40},view:{}}})
    await ui.press({key:'coco:icon:choose'});await w.clock.advance(0);await ui.redraw()
    try { await ui.press({key:'coco:icon:confirm'}) } catch { /* native writes must remain absent regardless of UI error delivery */ }
    await w.clock.advance(0)
    expect(calls.filter(a=>a[1]?.includes('icon-'))).toEqual([]);expect(writes.filter(p=>p.endsWith('app-icon-consent'))).toEqual([])
  })
  test('a failed manual press offers one retry; later sessions never retry on their own',async($,on)=>{
    const calls:string[][]=[]
    on('fs.exists',($,e)=>({value:samePath(e.path,'/System/Library/CoreServices/SystemVersion.plist')}))
    on('fs.write',()=>({value:undefined}))
    on('process.run',($,e)=>{if(e.argv[1]?.includes('icon-'))calls.push([...e.argv]);return{value:{exitCode:e.argv[2]==='apply'?1:0,stdout:'icon: stock\n',stderr:'',isStdoutTruncated:false,isStderrTruncated:false}}})
    const w=world(on,{env:{HOME:'/tmp/i1-manual-failure-home'},store:{...RECENT,bandSettings:{appIcon:'off',dockTile:'off'}}})
    await $.session.start({cwd:'/tmp/project',surface:'terminal',isInteractive:true});await settleLegacyStart($,w)
    await $.command.run({command:'coco',args:'settings',origin:PERSON,presentation:P})
    const ui=await $.ui.mount({surface:'terminal',plugin:'coco',component:'Pane',requestId:'coco-book',props:{title:'Coco',isFocused:true,bodyColumns:42,placement:'dock',scroll:{offset:0,bodyRows:40},view:{}}})
    await ui.press({key:'coco:icon:choose'});await w.clock.advance(0);await ui.redraw()
    await ui.press({key:'coco:icon:confirm'});await w.clock.advance(0);await ui.redraw()
    expect(calls.filter(a=>a[2]==='apply').length).toBe(1);expect(await ui.find({key:'coco:icon:apply'})).toBeDefined()
    await ui.unmount();w.resetHostState();await $.session.start({cwd:'/tmp/i1-blocked-project',surface:'terminal',isInteractive:true});await settleLegacyStart($,w)
    const firstBand=await $.ui.mount({surface:'desktop',...band(100)})
    for(let i=0;i<50;i++)await $.command.run({command:'i1-block-boundary',args:'',origin:PERSON,presentation:P})
    expect(calls.filter(a=>a[2]==='apply').length).toBe(1)
    await firstBand.unmount()
  })
  test('XDG_STATE_HOME reaches both engine adapters',()=>{
    for(const file of ['hooks/pages.tsx','hooks/register.tsx'])expect(PLUGIN_SOURCE[file]).toContain("key === 'XDG_STATE_HOME' ? $.env.get('XDG_STATE_HOME')")
  })
  test('Linux book consent uses the custom state root through its real adapter',async($,on)=>{
    const writes:string[]=[]
    on('fs.exists',($,e)=>({value:samePath(e.path,'/proc/sys/kernel/ostype')}))
    on('fs.write',($,e)=>{writes.push(e.path);return{value:undefined}})
    on('process.run',($,e)=>({value:{exitCode:0,stdout:`icon: ${e.argv[2]==='apply'?'own':'stock'}\n`,stderr:'',isStdoutTruncated:false,isStderrTruncated:false}}))
    const w=world(on,{env:{HOME:'/tmp/custom-home',XDG_STATE_HOME:'/tmp/custom-state'},store:{...RECENT,bandSettings:{appIcon:'off',iconLauncherFound:true}}})
    await $.session.start({cwd:'/tmp/project',surface:'terminal',isInteractive:true});await settleLegacyStart($,w)
    await $.command.run({command:'coco',args:'settings',origin:PERSON,presentation:P})
    const ui=await $.ui.mount({surface:'terminal',plugin:'coco',component:'Pane',requestId:'coco-book',props:{title:'Coco',isFocused:true,bodyColumns:42,placement:'dock',scroll:{offset:0,bodyRows:40},view:{}}})
    await ui.press({key:'coco:icon:choose'});await w.clock.advance(0);await ui.redraw()
    await ui.press({key:'coco:icon:confirm'});await w.clock.advance(0)
    expect(writes.map(posixPath)).toContain('/tmp/custom-state/coco/app-icon-consent')
  })
  test('explicit Linux status while off keeps cached discovery and performs no launcher IO',async($,on)=>{
    const calls:string[][]=[],writes:string[]=[]
    on('fs.exists',($,e)=>({value:samePath(e.path,'/proc/sys/kernel/ostype')}))
    on('fs.write',($,e)=>{writes.push(e.path);return{value:undefined}})
    on('process.run',($,e)=>{if(e.argv[1]?.includes('icon-'))calls.push([...e.argv]);return{value:{exitCode:0,stdout:'icon: stock\n',stderr:'',isStdoutTruncated:false,isStderrTruncated:false}}})
    const w=world(on,{env:{HOME:'/tmp/i1-linux-status-home'},store:{...RECENT,bandSettings:{appIcon:'off',iconLauncherFound:false}}})
    await $.session.start({cwd:'/tmp/project',surface:'terminal',isInteractive:true});await settleLegacyStart($,w)
    await $.command.run({command:'coco',args:'icon status',origin:PERSON,presentation:P})
    await $.command.run({command:'coco',args:'settings',origin:PERSON,presentation:P})
    const ui=await $.ui.mount({surface:'terminal',plugin:'coco',component:'Pane',requestId:'coco-book',props:{title:'Coco',isFocused:true,bodyColumns:42,placement:'dock',scroll:{offset:0,bodyRows:40},view:{}}})
    expect(await ui.find({key:'coco:icon:choose'})).toBeDefined();expect(calls).toEqual([]);expect(writes.filter(p=>p.includes('app-icon'))).toEqual([])
    await ui.unmount()
  })
  test('all locale icon words exactly match reviewed translations with English fallback for absent slots',()=>{
    expect(LANGS.length).toBe(13)
    expect(Object.keys(ICON_AUTHOR_WORDS).length).toBe(42)
    for(const {code}of LANGS){
      const w=JSON.parse(BOOK_FILES[`${code}.json`]).settings.icon
      expect(Object.keys(w).sort()).toEqual(Object.keys(ICON_AUTHOR_WORDS).sort())
      for(const [slot,translations]of Object.entries(ICON_AUTHOR_WORDS))expect(w[slot]).toBe(translations[code]??translations.en)
      for(const slot of ['S1','S1a','S1b','S2','S3.title','S3.body','S3a','S3b','S3c','S4','S5','S5a','S8','S9','S10','S11','S11a','S11b','S20','S21','S22'])expect(w[slot].length).toBeGreaterThan(0)
    }
    expect(PLUGIN_SOURCE['hooks/icon-book.tsx']).not.toContain("w.label")
  })
})

test('restore notice persists in bandSettings without automatic block storage or a fallback file', async ($, on) => {
  const calls:string[][]=[],writes:string[]=[],records:Record<string,unknown>[]=[]
  let blockAttempts=0
  on('store.set',{key:'bandSettings'},($,e,next)=>{
    if(e.value&&typeof e.value==='object'&&!Array.isArray(e.value)){
      records.push({...e.value})
      if(e.value.appIconBlocked===true){blockAttempts++;return{deny:'fixture refuses automatic blocking'} as never}
    }
    return next(e)
  })
  on('fs.exists',($,e)=>({value:samePath(e.path,'/System/Library/CoreServices/SystemVersion.plist')}))
  on('fs.write',($,e)=>{writes.push(e.path);return{value:undefined}})
  on('process.run',($,e)=>{if(e.argv[1]?.includes('icon-'))calls.push([...e.argv]);return{value:{exitCode:0,stdout:'icon: stock\nrestore-key: macos:101:50\n',stderr:'',isStdoutTruncated:false,isStderrTruncated:false}}})
  const w=world(on,{env:{HOME:'/tmp/i1-settings-notice-home'},store:{...RECENT,bandSettings:{appIcon:'on',dockTile:'off'}},settings:{prefersReducedMotion:true}})
  await $.session.start({cwd:'/tmp/project',surface:'desktop',isInteractive:true});await settleLegacyStart($,w)
  const ui=await $.ui.mount({surface:'desktop',...band(100)})
  for(let i=0;i<50;i++)await $.command.run({command:'i1-notice-boundary',args:'',origin:PERSON,presentation:P})
  const notice=JSON.parse(BOOK_FILES['en.json']).settings.icon.S20
  expect(calls.map(a=>a[2])).toEqual(['status']);expect(blockAttempts).toBe(0);expect(writes.filter(p=>p.includes('app-icon'))).toEqual([])
  expect(records.some(r=>r.appIconRestoreNotice==='macos:101:50')).toBe(true);expect(w.toasts.filter(t=>t===notice)).toEqual([notice])
  await w.clock.advance(60_000);await ui.redraw();expect(calls.length).toBe(1);expect(w.toasts.filter(t=>t===notice)).toEqual([notice])
  await ui.unmount()
})

test('an obsolete automatic-block file is never read and cannot suppress the session status',async($,on)=>{
  const calls:string[][]=[],writes:string[]=[];let markerReads=0
  on('fs.exists',($,e)=>({value:samePath(e.path,'/System/Library/CoreServices/SystemVersion.plist')}))
  on('fs.read',{path:/app-icon-auto-block$/},()=>{markerReads++;return{value:'blocked\n'}})
  on('fs.write',($,e)=>{writes.push(e.path);return{value:undefined}})
  on('process.run',($,e)=>{if(e.argv[1]?.includes('icon-'))calls.push([...e.argv]);return{value:{exitCode:0,stdout:'icon: stock\nrestore-key: macos:202:50\n',stderr:'',isStdoutTruncated:false,isStderrTruncated:false}}})
  const w=world(on,{env:{HOME:'/tmp/i1-obsolete-marker-home'},store:{...RECENT,bandSettings:{appIcon:'on',dockTile:'off',appIconBlocked:true}},settings:{prefersReducedMotion:true}})
  await $.session.start({cwd:'/tmp/project',surface:'desktop',isInteractive:true});await settleLegacyStart($,w)
  const ui=await $.ui.mount({surface:'desktop',...band(100)})
  for(let i=0;i<50;i++)await $.command.run({command:'i1-obsolete-marker-boundary',args:'',origin:PERSON,presentation:P})
  expect(markerReads).toBe(0);expect(calls.map(a=>a[2])).toEqual(['status']);expect(writes.filter(p=>p.includes('app-icon'))).toEqual([])
  await w.clock.advance(60_000);await ui.redraw();expect(markerReads).toBe(0);expect(calls.length).toBe(1)
  await ui.unmount()
})
