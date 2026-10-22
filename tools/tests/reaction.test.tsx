// Surface-independent events, tested with actual mounted engine-kit bands. No redraw() or
// mock-clock advance may stand in for the plugin requesting the redraw from an event.
import { contextTokensText } from '../hooks/play-commits'
import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { settleLegacyStart, MORNING, P, PERSON, RECENT, SUMMARY, band, world } from './world'
import { BAG_TEXT_RAW } from './bag-text-fixture'
import { transportFixture } from './presence-transport-fixture'
import { drainFeed } from './feed-drain'
import { WINDOWS_ROOTS } from './test-system'
import { samePath } from './file-paths'

const START = { cwd: '/tmp/reaction-project', surface: 'desktop' as const, isInteractive: true }
const STEP = { turnId: 'response', index: 0, model: 'claude', messageCount: 3 }
const PANE = {
  plugin: 'coco', component: 'Pane' as const, requestId: 'coco-book',
  props: { title: 'Coco', isFocused: false, bodyColumns: 64, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}
function command(args: string) { return { command: 'coco', args, origin: PERSON, presentation: P } }
// her desktop companion stands on her page once lane B has named its group there (bag step 2), else on the switches page
const COMPANION_PAGE = JSON.parse(BAG_TEXT_RAW).en.himGroups ? 'him' : 'settings'
function guard(on: On, fileReads: string[]) {
  let beganReads = 0
  let readsAtRedraw: number | undefined
  const calls: string[] = []
  let recording = false
  const record = (operation: string) => { if (recording) calls.push(operation) }
  on('fs.exists', () => { record('fs.exists'); return { value: false } })
  on('fs.write', () => { record('fs.write'); return { value: undefined } })
  on('process.run', () => { record('process.run'); return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } })
  on('process.spawn', async function* () { record('process.spawn') })
  on('ui.invalidate', ($, e, next) => { if(recording && readsAtRedraw === undefined) readsAtRedraw = fileReads.length; record('redraw'); return next(e) })
  // A successful view publication redraws its subscribers without global invalidation.
  on('state.set', { key: 'view' }, async ($, e, next) => {
    const result = await next(e)
    if (result.value?.isSet) {
      if (recording && readsAtRedraw === undefined) readsAtRedraw = fileReads.length
      record('published')
    }
    return result
  })
  return {
    begin() { calls.length = 0; beganReads = fileReads.length; readsAtRedraw = undefined; recording = true },
    check() {
      recording = false
      const first = calls.findIndex(call => call === 'redraw' || call === 'published')
      expect(first, `event must publish to subscribers or request a fallback redraw; observed ${calls.join(', ')}`).toBeGreaterThanOrEqual(0)
      expect(readsAtRedraw).toBe(beganReads)
      expect(calls.slice(0, first).filter(call => call.startsWith('fs.') || call.startsWith('process.'))).toEqual([])
    },
  }
}
// The band shows the conversation in k tokens (lane C, 10-14); every reading here is of a 200k window, so value% is value × 2k.
async function figure(ui: { find: (query: { type?: string; text?: RegExp }) => Promise<unknown>; findAll: (query: { type?: string }) => Promise<unknown[]> }, value: number, estimate = false) {
  expect(await ui.find({ type: 'Text', text: new RegExp(contextTokensText(value * 2000, 'en', estimate)) }), JSON.stringify(await ui.findAll({ type: 'Text' }))).toBeDefined()
}

describe('first redraw follows the event on both surfaces', () => {
  for (const surface of ['desktop', 'terminal'] as const) {
    for (const trigger of ['manual', 'auto'] as const) {
      test(`${surface}: idle ${trigger} compaction redraws and holds the estimate until a response`, async ($, on) => {
        const w = world(on, { store: RECENT, percent: 69, estimate: 24000, settings: { prefersReducedMotion: true } })
        const g = guard(on, w.fileReads)
        await $.session.start({ ...START, surface }); await settleLegacyStart($,w);
        const ui = await $.ui.mount({ surface, ...band(100) })
        await settleLegacyStart($,w)
        await figure(ui, 69)
        g.begin()
        await $.session.compact({ trigger, messages: [SUMMARY] })
        g.check()
        await figure(ui, 12, true)
        expect(w.view().estimate).toBe(true)
        // Measurement can contain a different stale response, so comparing token equality
        // with the pre-compaction response is insufficient to identify the new window.
        await $.session.measure({ context: { window: 200000, tokens: 130000, percent: 65 }, rateLimits: [], changed: ['context'] })
        expect(w.view().context).toBe(12)
        await figure(ui, 12, true)
        await $.prompt.submit({ text: 'continue', wait: false, origin: PERSON })
        await $.turn.start({ text: 'continue', turnId: 'response' })
        expect(w.view().context).toBe(12)
        // A real new response can coincidentally have the same token total as before.
        w.percent = 69
        g.begin()
        for await (const _ of $.turn.step(STEP)) {}
        g.check()
        expect(w.view().estimate).toBe(false)
        await figure(ui, 69)
      })
    }
    test(`${surface}: every main response lands without spinner, tool, timer or other trigger`, async ($, on) => {
      const w = world(on, { store: RECENT, percent: 20, settings: { prefersReducedMotion: true } })
      const g = guard(on, w.fileReads)
      await $.session.start({ ...START, surface }); await settleLegacyStart($,w);
      await $.turn.start({ text: 'continue', turnId: 'response' })
      const ui = await $.ui.mount({ surface, ...band(100, true) })
      await settleLegacyStart($,w)
      for (const [index, percent] of [31, 44, 52].entries()) {
        await drainFeed($) // isolate the response from the preceding turn/start or response's background writes
        w.percent = percent
        g.begin()
        for await (const _ of $.turn.step({ ...STEP, index })) {}
        g.check()
        await figure(ui, percent)
      }
      w.percent = 91
      for await (const _ of $.turn.step({ ...STEP, agentId: 'other-agent', index: 3 })) {}
      expect(w.view().context).toBe(52)
    })
    test(`${surface}: pushed measurement redraws without another event or file work`, async ($, on) => {
      const w = world(on, { store: RECENT, percent: 20, settings: { prefersReducedMotion: true } })
      const g = guard(on, w.fileReads)
      await $.session.start({ ...START, surface }); await settleLegacyStart($,w);
      const ui = await $.ui.mount({ surface, ...band(100) })
        await settleLegacyStart($,w)
      g.begin()
      await $.session.measure({ context: { window: 200000, tokens: 90000, percent: 45 }, rateLimits: [], changed: ['context'] })
      g.check()
      await figure(ui, 45)
    })
    test(`${surface}: command language, voice and band choices request their own redraw`, async ($, on) => {
      const w = world(on, { store: RECENT, settings: { prefersReducedMotion: true } })
      const g = guard(on, w.fileReads)
      await $.session.start({ ...START, surface }); await settleLegacyStart($,w);
      const ui = await $.ui.mount({ surface, ...band(100) })
        await settleLegacyStart($,w)
      for (const args of ['lang ja', 'voice off', 'voice full', 'band compact', 'band on']) {
        g.begin()
        await $.command.run(command(args))
        g.check()
      }
      expect(w.view().lang).toBe('ja')
      expect(await ui.find({ text: /Coco/ })).toBeDefined()
    })
    test(`${surface}: book choices redraw without a second press or manual redraw`, async ($, on) => {
      const w = world(on, { store: RECENT, settings: { prefersReducedMotion: true } })
      const g = guard(on, w.fileReads)
      await $.session.start({ ...START, surface }); await settleLegacyStart($,w);
      await $.command.run(command('settings'))
      const book = await $.ui.mount({ surface, ...PANE })
      const ui = await $.ui.mount({ surface, ...band(100) })
        await settleLegacyStart($,w)
      for (const [key, field, value] of [
        ['coco:set:lang:ja', 'lang', 'ja'],
        ['coco:set:voice:off', 'voice', 'off'],
        ['coco:set:voice:full', 'voice', 'full'],
        // the band row is the terminal's alone since 10-19 (owner): the desktop band is always the painted one
        ...(surface === 'terminal' ? [['coco:set:band:compact', 'band', 'compact'], ['coco:set:band:on', 'band', 'on']] : []),
      ]) {
        g.begin()
        await book.press({ key })
        g.check()
        expect((w.view() as unknown as Record<string, unknown>)[field!]).toBe(value)
      }
      expect(await ui.find({ text: /Coco/ })).toBeDefined()
      // the book is her bag now: its first page carries the bag's Japanese name
      const first = (await book.findAll({ type: 'Button' })).find(b => b.key === 'coco:book:tab:him')
      expect(String(first?.props.label)).toContain((JSON.parse(BAG_TEXT_RAW) as Record<string, { pages: string[] }>).ja!.pages[0]!)
    })
  }
})


describe('off switches retain a visible way back', () => {
  for (const surface of ['desktop', 'terminal'] as const) {
    test(`${surface}: voice Off leaves Light and Full visible and pressable in the book`, async ($, on) => {
      const w = world(on, { store: RECENT, settings: { prefersReducedMotion: true } })
      await $.session.start({ ...START, surface }); await settleLegacyStart($,w);
      await $.command.run(command('settings'))
      const book = await $.ui.mount({ surface, ...PANE })
      await book.press({ key: 'coco:set:voice:off' })
      expect(w.view().voice).toBe('off')
      for(const value of ['light', 'full']) {
        expect(await book.find({ type: 'Button', key: `coco:set:voice:${value}` })).toBeDefined()
        await book.press({ key: `coco:set:voice:${value}` })
        expect(w.view().voice).toBe(value)
      }
    })
  }
  test('desktop: marks Off leaves Replies and On visible and pressable in the book', async ($, on) => {
    const setupWorld=world(on, { store: RECENT, settings: { prefersReducedMotion: true } })
    await $.session.start(START); await settleLegacyStart($,setupWorld);
    await $.command.run(command('settings'))
    const book = await $.ui.mount({ surface: 'desktop', ...PANE })
    await book.press({ key: 'coco:set:marks:off' })
    for(const value of ['replies', 'on']) {
      expect(await book.find({ type: 'Button', key: `coco:set:marks:${value}` })).toBeDefined()
      await book.press({ key: `coco:set:marks:${value}` })
      expect((await book.find({ type: 'Button', key: `coco:set:marks:${value}` }))?.props.variant).toBe('primary')
    }
  })
})


describe('the response carries its own live input-token total', () => {
  for(const surface of ['desktop','terminal'] as const) {
    test(`${surface}: response usage redraws the box even when session.usage is still stale`,async($,on)=>{
      const w=world(on,{ store:RECENT, percent:69, estimate:24000, settings:{prefersReducedMotion:true},
        stepUsage:{ model:'claude',input_tokens:12000,cache_creation_input_tokens:8000,cache_read_input_tokens:30000,output_tokens:9000 } })
      const g=guard(on,w.fileReads)
      await $.session.start({...START,surface}); await settleLegacyStart($,w);
      const ui=await $.ui.mount({surface,...band(100)})
      await settleLegacyStart($,w)
      await $.session.compact({trigger:'manual',messages:[SUMMARY]})
      await $.turn.start({text:'continue',turnId:'response'})
      g.begin()
      for await(const _ of $.turn.step(STEP)) {}
      g.check()
      // Only the three input counts make the offering box; output tokens do not.
      expect(w.view().context).toBe(25)
      expect(w.view().estimate).toBe(false)
      await figure(ui,25)
    })
  }
})

describe('the screen provides the recovery route after waking', () => {
  for(const surface of ['desktop','terminal'] as const) {
    test(`${surface}: wake restores a visible book button that can reopen companion settings`,{options:{band:'compact'}},async($,on)=>{
      const w=world(on,{store:{...RECENT,band:'compact'},settings:{prefersReducedMotion:true}})
      await $.session.start({...START,surface}); await settleLegacyStart($,w);
      const ui=await $.ui.mount({surface,...band(100)})
      await settleLegacyStart($,w)
      await $.command.run(command('band off'))
      expect(await ui.find({key:'coco:band:wake'})).toBeDefined()
      await ui.press({key:'coco:band:wake'})
      // a stored pixel choice wakes as the painted band on the desktop (owner 10-19)
      expect(w.view().band).toBe(surface==='desktop'?'on':'compact')
      expect(await ui.find({type:'Button',key:'coco:book:open'})).toBeDefined()
      await ui.press({key:'coco:book:open'})
      expect(w.opens.some(open=>open.id==='coco-book')).toBe(true)
    })
  }
})

describe('retained development helper: shared native follower acknowledgements redraw the open settings', () => {
  for(const surface of ['desktop','terminal'] as const) {
    test(`${surface}: ${WINDOWS_ROOTS ? 'Windows fallback ignores native state without a child, read, probe or redraw' : 'a companion-state record redraws status and size with no file read or probe'}`,async($,on)=>{
      const home='/tmp/reaction-companion'
      const folder=`${home}/Library/Application Support/Coco`
      let recording=false
      const probes:string[]=[],warmProbes:string[]=[]
      let recordReads=0
      let redraws=0
      let spawned=false
      const transportCalls:string[]=[]
      const transport=transportFixture({v:1,seq:0,quietAt:MORNING,asleep:false,clingy:false,busy:false,event:{kind:'initial',id:'reaction-initial',at:MORNING}})
      const w=world(on,{withNativePresence:true,store:RECENT,env:{HOME:home,LANG:'en_US.UTF-8',TERM:'xterm-256color'},settings:{prefersReducedMotion:true},readText:path=>{
        if(/[\\/]snapshot\.json$/.test(path))return JSON.stringify(transport.state)
        if(/[\\/]companion\.json$/.test(path)){recordReads++;return JSON.stringify({running:false,accessibility:true,size:'medium'})}
        return undefined
      }})
      on('session.id',()=>({value:'companion-reaction'}))
      on('session.surfaces',()=>({value:['desktop']}))
      on('fs.exists',($,e)=>{
        warmProbes.push(e.path)
        if(recording)probes.push(e.path)
        return {value:(!WINDOWS_ROOTS&&/[\\/]bin[\\/]coco-state(?:-macos-(?:x86_64|aarch64)|-linux-(?:x86_64|aarch64)|-windows-(?:x86_64|aarch64)\.exe)?$/.test(e.path))||samePath(e.path,'/System/Library/CoreServices/SystemVersion.plist')||samePath(e.path,'/bin/sh')||samePath(e.path,folder)||samePath(e.path,`${folder}/requests.jsonl`)||samePath(e.path,`${home}/Applications/Coco Pet.app/Contents/MacOS/coco-companion`)}
      })
      on('process.run',async($,e)=>{
        if(e.argv[3]==='write'){
          if(e.argv[0]!=='/bin/sh'||!String(e.argv[1]).endsWith('/presence.sh')||typeof e.argv[5]!=='string'||typeof e.init?.stdin!=='string')throw new Error('invalid secure presence write fixture')
          transportCalls.push(`write:${e.argv[5]}`)
          await transport.write(e.argv[5],e.init.stdin)
        }
        let stdout=String(e.argv[1]).includes('icon-')?'icon: stock\n':''
        if(/[\\/]bin[\\/]coco-state(?:-macos-(?:x86_64|aarch64)|-linux-(?:x86_64|aarch64)|-windows-(?:x86_64|aarch64)\.exe)?$/.test(e.argv[0]??'')){
          expect(WINDOWS_ROOTS).toBe(false)
          // Explicit synthetic helper. This fixture models shared follower
          // packets, so its guarded baseline reader refuses classic watch mode.
          expect(['--ensure-requests','--read-requests']).toContain(e.argv[1])
          stdout=JSON.stringify(e.argv[1]==='--ensure-requests'?{ensured:true}:{read:false})
        }
        return{value:{exitCode:0,stdout,stderr:'',isStdoutTruncated:false,isStderrTruncated:false}}
      })
      on('fs.write',async($,e)=>{transportCalls.push(`write:${e.path}`);if(e.path.endsWith('/commit')||e.path.includes('/.presence-deadline-'))throw new Error('unsafe SDK presence write');return{value:undefined}})
      on('ui.invalidate',($,e,next)=>{if(recording)redraws++;return next(e)})
      on('process.spawn',async function*($,e){
        transportCalls.push(`spawn:${e.argv[3]}`)
        if(e.argv[3]==='follow')spawned=true
        const child=transport.spawn('companion-reaction',[...e.argv])
        try{for(;;){const packet=await child.next();if(packet.done)return{value:packet.value};yield packet.value}}
        finally{await child.return({code:0,signal:null})}
      })
      await $.session.start({...START,surface}); await settleLegacyStart($,w);
      // Let already-started host messages drain; this command has no plugin mutation.
      for(let i=0;i<24;i++)await $.command.run({command:'feed-barrier',args:'',origin:PERSON,presentation:P})
      expect(spawned).toBe(!WINDOWS_ROOTS)
      if (!WINDOWS_ROOTS) expect(Object.keys((transport.state as any).claims).length,JSON.stringify(transportCalls)).toBeGreaterThan(0)
      await $.command.run(command(COMPANION_PAGE))
      const book=await $.ui.mount({surface,...PANE})
      await settleLegacyStart($,w)
      console.log('M1_COMPANION_ACK_PUBLIC_DIAGNOSTIC '+JSON.stringify({phase:'before-initial-stopped',surface,spawned,ownClaims:Object.keys((transport.state as any).claims??{}),recordReads,warmProbes,publicReadPaths:w.fileReads.filter(path=>path.endsWith('/companion.json')||path.includes('/book/')),transportCalls,stoppedVisible:Boolean(await book.find({type:'Text',text:'Not running'})),followingVisible:Boolean(await book.find({type:'Text',text:'Beside your window'}))}))
      expect(await book.find({type:'Text',text:'Not running'})).toBeDefined()
      const originalReads=w.fileReads.length+recordReads
      recording=true
      transport.request(`${folder}/requests.jsonl`,JSON.stringify({v:1,kind:'companion-state',at:w.clock.now(),info:{running:true,accessibility:true,size:'large',login:false}})+'\n')
      await drainFeed($)
      if (WINDOWS_ROOTS) {
        expect(transportCalls).toEqual([])
        expect(await book.find({type:'Text',text:'Not running'})).toBeDefined()
        expect((await book.find({type:'Button',key:'coco:companion:large'}))?.props.variant).not.toBe('primary')
        expect(redraws).toBe(0)
      } else {
        console.log('M1_COMPANION_ACK_PUBLIC_DIAGNOSTIC '+JSON.stringify({phase:'before-ack-following',surface,spawned,recordReads,warmProbes,publicReadPaths:w.fileReads.filter(path=>path.endsWith('/companion.json')||path.includes('/book/')),transportCalls,redraws,probes,stoppedVisible:Boolean(await book.find({type:'Text',text:'Not running'})),followingVisible:Boolean(await book.find({type:'Text',text:'Beside your window'})),largeVariant:(await book.find({type:'Button',key:'coco:companion:large'}))?.props.variant??null}))
        expect(await book.find({type:'Text',text:'Beside your window'})).toBeDefined()
        expect((await book.find({type:'Button',key:'coco:companion:large'}))?.props.variant).toBe('primary')
        expect(redraws).toBeGreaterThan(0)
      }
      expect(w.fileReads.length+recordReads).toBe(originalReads)
      expect(probes).toEqual([])
    })
  }
})
