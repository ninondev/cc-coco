// Surface-independent events, tested with actual mounted engine-kit bands. No redraw() or
// mock-clock advance may stand in for the plugin requesting the redraw from an event.
import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { P, PERSON, RECENT, SUMMARY, band, world } from './world'

const START = { cwd: '/tmp/reaction-project', surface: 'desktop' as const, isInteractive: true }
const STEP = { turnId: 'response', index: 0, model: 'claude', messageCount: 3 }
const PANE = {
  plugin: 'claudesama', component: 'Pane' as const, requestId: 'claudesama-book',
  props: { title: 'Claude-sama', isFocused: false, bodyColumns: 64, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}
function command(args: string) { return { command: 'claudesama', args, origin: PERSON, presentation: P } }
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
  return {
    begin() { calls.length = 0; beganReads = fileReads.length; readsAtRedraw = undefined; recording = true },
    check() {
      recording = false
      const first = calls.indexOf('redraw')
      expect(first, `event must request a redraw; observed ${calls.join(', ')}`).toBeGreaterThanOrEqual(0)
      expect(readsAtRedraw).toBe(beganReads)
      expect(calls.slice(0, first).filter(call => call.startsWith('fs.') || call.startsWith('process.'))).toEqual([])
    },
  }
}
async function figure(ui: { find: (query: { type?: string; text?: RegExp }) => Promise<unknown>; findAll: (query: { type?: string }) => Promise<unknown[]> }, value: number, estimate = false) {
  expect(await ui.find({ type: 'Text', text: new RegExp(`${estimate ? '~' : ''}${value}%`) }), JSON.stringify(await ui.findAll({ type: 'Text' }))).toBeDefined()
}

describe('first redraw follows the event on both surfaces', () => {
  for (const surface of ['desktop', 'terminal'] as const) {
    for (const trigger of ['manual', 'auto'] as const) {
      test(`${surface}: idle ${trigger} compaction redraws and holds the estimate until a response`, async ($, on) => {
        const w = world(on, { store: RECENT, percent: 69, estimate: 24000, settings: { prefersReducedMotion: true } })
        const g = guard(on, w.fileReads)
        await $.session.start({ ...START, surface })
        const ui = await $.ui.mount({ surface, ...band(100) })
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
      await $.session.start({ ...START, surface })
      await $.turn.start({ text: 'continue', turnId: 'response' })
      const ui = await $.ui.mount({ surface, ...band(100, true) })
      for (const [index, percent] of [31, 44, 52].entries()) {
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
      await $.session.start({ ...START, surface })
      const ui = await $.ui.mount({ surface, ...band(100) })
      g.begin()
      await $.session.measure({ context: { window: 200000, tokens: 90000, percent: 45 }, rateLimits: [], changed: ['context'] })
      g.check()
      await figure(ui, 45)
    })
    test(`${surface}: command language, voice and band choices request their own redraw`, async ($, on) => {
      const w = world(on, { store: RECENT, settings: { prefersReducedMotion: true } })
      const g = guard(on, w.fileReads)
      await $.session.start({ ...START, surface })
      const ui = await $.ui.mount({ surface, ...band(100) })
      for (const args of ['lang ja', 'voice off', 'voice full', 'band compact', 'band on']) {
        g.begin()
        await $.command.run(command(args))
        g.check()
      }
      expect(w.view().lang).toBe('ja')
      expect(await ui.find({ text: /Claudeさま/ })).toBeDefined()
    })
    test(`${surface}: book choices redraw without a second press or manual redraw`, async ($, on) => {
      const w = world(on, { store: RECENT, settings: { prefersReducedMotion: true } })
      const g = guard(on, w.fileReads)
      await $.session.start({ ...START, surface })
      await $.command.run(command('settings'))
      const book = await $.ui.mount({ surface, ...PANE })
      const ui = await $.ui.mount({ surface, ...band(100) })
      for (const [key, field, value] of [
        ['claudesama:set:lang:ja', 'lang', 'ja'],
        ['claudesama:set:voice:off', 'voice', 'off'],
        ['claudesama:set:voice:full', 'voice', 'full'],
        ['claudesama:set:band:compact', 'band', 'compact'],
        ['claudesama:set:band:on', 'band', 'on'],
      ]) {
        g.begin()
        await book.press({ key })
        g.check()
        expect((w.view() as unknown as Record<string, unknown>)[field!]).toBe(value)
      }
      expect(await ui.find({ text: /Claudeさま/ })).toBeDefined()
      expect(await book.find({ type: 'Button', text: 'かれのこと' })).toBeDefined()
    })
  }
})


describe('off switches retain a visible way back', () => {
  for (const surface of ['desktop', 'terminal'] as const) {
    test(`${surface}: voice Off leaves Light and Full visible and pressable in the book`, async ($, on) => {
      const w = world(on, { store: RECENT, settings: { prefersReducedMotion: true } })
      await $.session.start({ ...START, surface })
      await $.command.run(command('settings'))
      const book = await $.ui.mount({ surface, ...PANE })
      await book.press({ key: 'claudesama:set:voice:off' })
      expect(w.view().voice).toBe('off')
      for(const value of ['light', 'full']) {
        expect(await book.find({ type: 'Button', key: `claudesama:set:voice:${value}` })).toBeDefined()
        await book.press({ key: `claudesama:set:voice:${value}` })
        expect(w.view().voice).toBe(value)
      }
    })
  }
  test('desktop: marks Off leaves Replies and On visible and pressable in the book', async ($, on) => {
    world(on, { store: RECENT, settings: { prefersReducedMotion: true } })
    await $.session.start(START)
    await $.command.run(command('settings'))
    const book = await $.ui.mount({ surface: 'desktop', ...PANE })
    await book.press({ key: 'claudesama:set:marks:off' })
    for(const value of ['replies', 'on']) {
      expect(await book.find({ type: 'Button', key: `claudesama:set:marks:${value}` })).toBeDefined()
      await book.press({ key: `claudesama:set:marks:${value}` })
      expect((await book.find({ type: 'Button', key: `claudesama:set:marks:${value}` }))?.props.variant).toBe('primary')
    }
  })
})


describe('the response carries its own live input-token total', () => {
  for(const surface of ['desktop','terminal'] as const) {
    test(`${surface}: response usage redraws the box even when session.usage is still stale`,async($,on)=>{
      const w=world(on,{ store:RECENT, percent:69, estimate:24000, settings:{prefersReducedMotion:true},
        stepUsage:{ model:'claude',input_tokens:12000,cache_creation_input_tokens:8000,cache_read_input_tokens:30000,output_tokens:9000 } })
      const g=guard(on,w.fileReads)
      await $.session.start({...START,surface})
      const ui=await $.ui.mount({surface,...band(100)})
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
    test(`${surface}: wake restores a visible book button that can reopen companion settings`,async($,on)=>{
      const w=world(on,{store:{...RECENT,band:'compact'},settings:{prefersReducedMotion:true}})
      await $.session.start({...START,surface})
      const ui=await $.ui.mount({surface,...band(100)})
      await $.command.run(command('band off'))
      expect(await ui.find({key:'claudesama:band:wake'})).toBeDefined()
      await ui.press({key:'claudesama:band:wake'})
      expect(w.view().band).toBe('compact')
      expect(await ui.find({type:'Button',key:'claudesama:book:open'})).toBeDefined()
      await ui.press({key:'claudesama:book:open'})
      expect(w.opens.some(open=>open.id==='claudesama-book')).toBe(true)
    })
  }
})

describe('native companion acknowledgements redraw the open settings from the event', () => {
  for(const surface of ['desktop','terminal'] as const) {
    test(`${surface}: a companion-state record redraws status and size with no file read or probe`,async($,on)=>{
      const home='/tmp/reaction-companion'
      const folder=`${home}/Library/Application Support/Claude-sama`
      let recording=false
      const probes:string[]=[]
      let recordReads=0
      let redraws=0
      let spawned=false
      let wake:(()=>void)|undefined
      let packet:string|undefined
      let accepted:(()=>void)|undefined
      const w=world(on,{store:RECENT,env:{HOME:home,LANG:'en_US.UTF-8',TERM:'xterm-256color'},settings:{prefersReducedMotion:true}})
      on('session.id',()=>({value:'companion-reaction'}))
      on('session.surfaces',()=>({value:['desktop']}))
      on('fs.exists',($,e)=>{
        if(recording)probes.push(e.path)
        return {value:e.path==='/System/Library/CoreServices/SystemVersion.plist'||e.path==='/usr/bin/tail'||e.path===folder||e.path===`${folder}/requests.jsonl`||e.path===`${home}/Applications/Claude-sama Companion.app/Contents/MacOS/claudesama-companion`}
      })
      on('fs.read',{path:/[\\/]companion\.json$/},()=>{
        recordReads++
        return {value:JSON.stringify({running:false,accessibility:true,size:'medium'})}
      })
      on('process.run',($,e)=>({value:{exitCode:0,stdout:String(e.argv[1]).includes('icon-')?'icon: stock\n':'',stderr:'',isStdoutTruncated:false,isStderrTruncated:false}}))
      on('ui.invalidate',($,e,next)=>{if(recording)redraws++;return next(e)})
      on('process.spawn',async function*(){
        spawned=true
        while(true){
          if(packet===undefined)await new Promise<void>(resolve=>{wake=resolve})
          const text=packet;packet=undefined
          if(text===undefined)continue
          yield {stream:'stdout' as const,text}
          accepted?.();accepted=undefined
        }
      })
      await $.session.start({...START,surface})
      // Let already-started host messages drain; this command has no plugin mutation.
      for(let i=0;i<24;i++)await $.command.run({command:'feed-barrier',args:'',origin:PERSON,presentation:P})
      expect(spawned).toBe(true)
      await $.command.run(command('settings'))
      const book=await $.ui.mount({surface,...PANE})
      expect(await book.find({type:'Text',text:'Not running'})).toBeDefined()
      const originalReads=w.fileReads.length+recordReads
      recording=true
      const receipt=new Promise<void>(resolve=>{accepted=resolve})
      packet=JSON.stringify({v:1,kind:'companion-state',at:w.clock.now(),info:{running:true,accessibility:true,size:'large',login:false}})+'\n'
      wake?.();wake=undefined
      await receipt
      expect(await book.find({type:'Text',text:'Beside your window'})).toBeDefined()
      expect((await book.find({type:'Button',key:'claudesama:companion:large'}))?.props.variant).toBe('primary')
      expect(redraws).toBeGreaterThan(0)
      expect(w.fileReads.length+recordReads).toBe(originalReads)
      expect(probes).toEqual([])
    })
  }
})
