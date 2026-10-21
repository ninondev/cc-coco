import { TIMING } from '../hooks/mood'
// W1 order Do 3: exact v3 words replace old text pins; all other properties stay.
import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { spriteCells } from '../hooks/pictures-lazy'
import { PLUGIN_SOURCES } from './plugin-sources'
import { LINES } from '../hooks/lines'
import { desktopRenderReceipts } from './desktop-render-receipts'
import { WINDOWS_ROOTS } from './test-system'
import { settleLegacyStart, band, desktopPicture, P, PERSON, RECENT, world } from './world'

const START = { cwd: '/tmp/b1-band', surface: 'desktop' as const, isInteractive: true }
const command = (args: string) => ({ command: 'coco', args, origin: PERSON, presentation: P })
const source = async (ui: Parameters<typeof desktopPicture>[0]) => String((await desktopPicture(ui))?.props.source)

// A bandWake publication requests the site's native redraw before event timers.
// Visible-pose assertions below also verify that the request reaches the band.
function publicationOrder(on: On, recording: () => boolean) {
  const operations: string[] = []
  on('clock.*', ($, e, next) => { if (recording() && next.is('clock.after', e)) operations.push('timer'); return next(e) })
  on('state.set', { key: 'bandWake' }, ($, e, next) => {
    if (recording()) operations.push('redraw')
    return next(e)
  })
  on('ui.*', ($, e, next) => { if (recording() && next.is('ui.invalidate', e)) operations.push('redraw'); return next(e) })
  return operations
}


describe('B1 band contracts', () => {
  test('default picture is a borderless Svg and the hover reveals stay inside their keyed blocks', async ($, on) => {
    const setupWorld=world(on, { store: RECENT })
    await $.session.start(START); await settleLegacyStart($,setupWorld);
    const ui = await $.ui.mount({ surface:'desktop', ...band(100) })
    expect(await ui.find({type:'Markdown',key:'coco:band:poke'})).toBeUndefined()
    expect(await ui.find({type:'Svg'})).toBeDefined()
    for (const key of ['poke','pat','close']) expect(await ui.find({type:'Button',key:`coco:band:${key}`})).toBeDefined()
    // The kit omits hover props in drawn trees. Check the shipping registration,
    // while the public UI above verifies that each actual control renders.
    const shipping=PLUGIN_SOURCES['hooks/band.tsx']!
    expect(shipping).toContain("export const HOVER: 'scoped' | 'band' = 'scoped'")
    // A shared hover scope never revealed anything on his desktop (10-18): each reveal is a hidden child of the keyed Box
    // the pointer is on, her picture for Poke, Pat and Close, each thing on the floor for its card.
    expect(shipping).not.toContain('scope:')
    // the keys carry a hover epoch: a leave draws the block again under a new key, which drops a hover the surface kept
    expect(shipping).toContain("<Box key={'coco:picture' + epoch('picture')} flexShrink={0} position=\"relative\">")
    expect(shipping).toContain('height={1} display="none" hover={{ display: \'flex\' }}')
    expect(shipping).toContain("<Box key={'coco:thing:' + thing.kind + epoch(thing.kind)} position=\"relative\"")

  })

  test('desktop motion makes zero plugin animation redraws during a working minute', async ($, on) => {
    const receipts=desktopRenderReceipts(on)
    let counting = false, redraws = 0, globalRedraws = 0, bandPulses = 0
    // Breathing (on by default) redraws once when the plume starts at 20 s; this test is about motion, so it is off here.
    const w = world(on, {store:{...RECENT,breathe:'off'}, onRender: component => { if (counting && component === 'AbovePrompt') redraws++ }})
    const textPublications: (string | null)[] = []
    on('state.set', {key:'bandWake'}, ($,e,next)=>{if(counting)bandPulses++;return next(e)})
    on('state.set', { key: 'view' }, async ($, e, next) => { const result = await next(e); if (counting && result.value?.isSet) textPublications.push((e.value as { said: string | null }).said); return result })
    on('ui.invalidate', ($, e, next) => { if(counting) globalRedraws++; return next(e) })
    await $.session.start(START); await settleLegacyStart($,w);
    await $.turn.start({text:'go',turnId:'b1-work'})
    const ui = await $.ui.mount({surface:'desktop',...band(100,true)})
    await $.tool.call({tool:'Read',file_path:'/tmp/example'})
    await w.clock.advance(15000) // start-line expiry is a text event, outside measurement
    const before = await source(ui)
    await receipts.flush($)
    const ownBefore = receipts.current()
    counting = true
    await w.clock.advance(60000)
    counting = false
    await receipts.flush($)
    expect(receipts.available).toBe(!WINDOWS_ROOTS)
    const observedRedraws = receipts.available ? receipts.current() - ownBefore : bandPulses
    expect(observedRedraws).toBe(2)
    expect(redraws).toBe(0) // the 45s long-turn line and its expiry, no animation frames
    expect(globalRedraws).toBe(0)
    expect(bandPulses).toBe(2)
    expect(textPublications.length).toBe(2)
    expect(LINES.en.thinking_long).toContain(textPublications[0])
    expect(textPublications[1]).toBe(null)
    expect(await source(ui)).toBe(before)
    console.log(`B1 working minute ${receipts.available?'own diagnostic':'Windows bandWake publication'} redraws: ${observedRedraws}; downstream: ${redraws}; global: ${globalRedraws}; text events: 2; animation: ${observedRedraws - 2}`)
  })

  test('an idle desktop minute issues no plugin redraws',async($,on)=>{
    const receipts=desktopRenderReceipts(on)
    let count=false,redraws=0,globalRedraws=0
    const w=world(on,{store:RECENT,onRender:component=>{if(count && component==='AbovePrompt')redraws++}})
    on('ui.invalidate',($,e,next)=>{if(count)globalRedraws++;return next(e)})
    await $.session.start(START); await settleLegacyStart($,w);
    await $.ui.mount({surface:'desktop',...band(100)})
    await w.clock.advance(15000)
    await receipts.flush($)
    const ownBefore=receipts.current()
    count=true
    await w.clock.advance(60000)
    count=false
    await receipts.flush($)
    expect(receipts.available).toBe(!WINDOWS_ROOTS)
    expect(receipts.available?receipts.current()-ownBefore:globalRedraws).toBe(0)
    expect(redraws).toBe(0)
    expect(globalRedraws).toBe(0)
    console.log('B1 idle desktop minute redraws: '+redraws+'; scope: engine test kit')
  })

  test('quota and text redraw reuse the identical animated picture string', async ($, on) => {
    const w=world(on,{store:RECENT})
    await $.session.start(START); await settleLegacyStart($,w);
    const ui=await $.ui.mount({surface:'desktop',...band(100)})
    const before=await source(ui)
    expect(before).toContain('@keyframes')
    await $.session.measure({context:{window:200000,tokens:66000,percent:33},rateLimits:[],changed:['context']})
    expect(await source(ui)).toBe(before)
  })

  test('Poke and Pat wake a sleeping band before their face reaction', async ($, on) => {
    const w=world(on,{withNativePresence:true,store:RECENT,settings:{prefersReducedMotion:true}})
    await $.session.start(START); await settleLegacyStart($,w);
    const ui=await $.ui.mount({surface:'desktop',...band(100)})
    await w.clock.advance(TIMING.sleepAfter(w.clock.now()))
    expect(w.view().mood).toBe('sleep')
    await ui.press({key:'coco:band:poke'})
    expect(w.view().mood).toBe('idle')
    expect(await source(ui)).toContain('data-coco="A idle"')
    await w.clock.advance(TIMING.sleepAfter(w.clock.now()))
    expect(w.view().mood).toBe('sleep')
    await ui.press({key:'coco:band:pat'})
    expect(w.view().mood).toBe('idle')
  })

  test('changing voice and warmth displays the new setting line immediately', async ($, on) => {
    const w=world(on,{store:RECENT,settings:{prefersReducedMotion:true}})
    await $.session.start(START); await settleLegacyStart($,w);
    const ui=await $.ui.mount({surface:'desktop',...band(100)})
    for(const [args,line] of [
      ['voice full',LINES.en.set_voice_full[0]],
      ['voice light',LINES.en.set_voice_light[0]],
      ['voice off',LINES.en.set_voice_off[0]],
      ['warmth clingy',LINES.en.set_clingy[0]],
      ['warmth warm',LINES.en.set_warm[0]],
    ]){
      await $.command.run(command(args!))
      expect(await ui.find({type:'Text',text:line!})).toBeDefined()
    }
    expect(w.view().affection).toBe('warm')
  })

  test('without native presence every voice and warmth change wakes the sleeping band',async($,on)=>{
    const w=world(on,{withNativePresence:true,store:RECENT,settings:{prefersReducedMotion:true}})
    await $.session.start(START); await settleLegacyStart($,w);
    const ui=await $.ui.mount({surface:'desktop',...band(100)})
    for(const args of ['voice full','voice light','voice off','warmth clingy','warmth warm']){
      await w.clock.advance(TIMING.sleepAfter(w.clock.now()))
      expect(w.view().mood).toBe('sleep')
      await $.command.run(command(args))
      expect(w.view().mood).toBe('idle')
      expect(await source(ui)).toContain('data-coco="A idle"')
    }
  })

  // 10-19 (owner): the desktop band is always the painted one, so a pixel choice stored earlier wakes as the painted band
  test('Close leaves the same visible Off door and wakes the painted band on the desktop', {options:{band:'compact'}}, async ($, on) => {
    const w=world(on,{store:{...RECENT,band:'compact'},settings:{prefersReducedMotion:true}})
    await $.session.start(START); await settleLegacyStart($,w);
    const ui=await $.ui.mount({surface:'desktop',...band(100)})
    await ui.press({key:'coco:band:close'})
    expect(w.view().band).toBe('off')
    expect(await ui.find({type:'Button',key:'coco:band:wake'})).toBeDefined()
    await ui.press({key:'coco:band:wake'})
    expect(w.view().band).toBe('on')
  })

  test('an unidentifiable permission check cannot change the main turn to waiting', async ($,on)=>{
    const w=world(on,{store:RECENT,ask:true,settings:{prefersReducedMotion:true}})
    await $.session.start(START); await settleLegacyStart($,w);
    await $.turn.start({text:'go',turnId:'main'})
    await $.tool.check({tool:'Read',input:{file_path:'/tmp/child'},tool_use_id:'unknown-child'})
    expect(w.view().mood).toBe('think')
  })

  test('only streamed main-loop permission IDs can enter waiting', async($,on)=>{
    const w=world(on,{store:RECENT,ask:true,stepTools:[{id:'checked',name:'Bash'}],settings:{prefersReducedMotion:true}})
    await $.session.start(START); await settleLegacyStart($,w);
    await $.turn.start({text:'go',turnId:'main'})
    await $.tool.check({tool:'Bash',input:{command:'echo ok'}})
    expect(w.view().mood).toBe('think')
    for await(const chunk of $.turn.step({turnId:'main',index:0,model:'test',messageCount:1,agentId:'child'})) {}
    await $.tool.check({tool:'Bash',input:{command:'echo ok'},tool_use_id:'checked'})
    expect(w.view().mood).toBe('think')
    for await(const chunk of $.turn.step({turnId:'main',index:1,model:'test',messageCount:1})) {}
    await $.tool.check({tool:'Bash',input:{command:'echo ok'},tool_use_id:'checked'})
    expect(w.view().mood).toBe('waiting')
  })

  test('same-mood task events and settings text retain the exact picture source',async($,on)=>{
    const setupWorld=world(on,{store:RECENT})
    await $.session.start(START); await settleLegacyStart($,setupWorld);
    const ui=await $.ui.mount({surface:'desktop',...band(100)})
    const before=await source(ui)
    await $.command.run(command('voice full'))
    expect(await source(ui)).toBe(before)
    await $.turn.start({text:'go',turnId:'main'})
    // Coco acts the read pose once it is taken (coco-motion.ts); more reads keep that very picture
    await $.tool.call({tool:'Read',file_path:'/tmp/a'})
    await $.tool.call({tool:'Read',file_path:'/tmp/b'})
    const work=await source(ui)
    expect(work).toContain('data-coco="A read"')
    await $.tool.call({tool:'Read',file_path:'/tmp/c'})
    expect(await source(ui)).toBe(work)
  })

  test('a desktop burst never sends its reaction face to an untouched terminal viewport',async($,on)=>{
    const frames:string[]=[]
    let record=false
    on('ui.*',($,e,next)=>{if(record && next.is('ui.blit',e))frames.push(String(e.cells));return next(e)})
    const w=world(on,{store:RECENT})
    await $.session.start(START); await settleLegacyStart($,w);
    await $.ui.mount({surface:'terminal',requestId:'untouched-terminal',...band(100)})
    const ui=await $.ui.mount({surface:'desktop',requestId:'touched-desktop',...band(100)})
    record=true
    for(let n=0;n<18;n++){
      await ui.press({key:'coco:band:poke'})
      await w.clock.advance(300)
    }
    console.log('B1 terminal routing probe '+JSON.stringify({frames:frames.length,blits:w.blits.length,mood:w.view().mood,keys:w.blits.slice(0,3)}))
    expect(frames.length).toBeGreaterThan(0)
    const allowed=['idle-reading','idle-blink'].map(frame=>spriteCells(frame as 'idle-reading'|'idle-blink',w.view().colors))
    for(const frame of frames)expect(allowed).toContain(frame)
    expect(frames).toContain(spriteCells('idle-blink',w.view().colors))
  })

  test('a completed turn redraws its new pose before arming a return or text timer',async($,on)=>{
    let recording=false
    const operations = publicationOrder(on, () => recording)
    const w=world(on,{store:RECENT})
    await $.session.start(START); await settleLegacyStart($,w);
    const ui=await $.ui.mount({surface:'desktop',...band(100)})
    await $.turn.start({text:'go',turnId:'main'})
    recording=true
    await $.turn.complete({answer:'done',durationMs:1000,isAborted:false,turnId:'main',reason:'answer'})
    recording=false
    const first=operations.indexOf('redraw')
    expect(first).toBeGreaterThanOrEqual(0)
    expect(operations.slice(0,first)).toEqual([])
    expect(operations).toContain('timer')
    expect(w.view().mood).toBe('happy')
    expect(await source(ui)).toContain('data-coco="A done"')
  })

  for(const action of ['turn','voice full','warmth clingy'] as const) test(`${action} redraws before arming its timers`,async($,on)=>{
    let recording=false
    const operations = publicationOrder(on, () => recording)
    const w=world(on,{store:RECENT})
    await $.session.start(START); await settleLegacyStart($,w);
    const ui=await $.ui.mount({surface:'desktop',...band(100)})
    recording=true
    if(action==='turn') await $.turn.start({text:'go',turnId:'main'})
    else await $.command.run(command(action))
    recording=false
    const first=operations.indexOf('redraw')
    expect(first).toBeGreaterThanOrEqual(0)
    expect(operations.slice(0,first)).toEqual([])
    if (action === 'turn') {
      expect(w.view().mood).toBe('think')
      expect(await source(ui)).toContain('data-coco="A think"')
    } else if (action === 'voice full') {
      expect(w.view().voice).toBe('full')
      expect(await ui.find({ type: 'Text', text: LINES.en.set_voice_full[0] })).toBeDefined()
    } else {
      expect(w.view().affection).toBe('clingy')
      expect(await ui.find({ type: 'Text', text: LINES.en.set_clingy[0] })).toBeDefined()
    }
  })

  test('enabling terminal motion publishes the new mode before arming its frame timer',async($,on)=>{
    let recording=false
    const operations = publicationOrder(on, () => recording)
    const settings={prefersReducedMotion:true}
    const w=world(on,{store:RECENT,settings})
    await $.session.start({...START,surface:'terminal'}); await settleLegacyStart($,w);
    const ui=await $.ui.mount({surface:'terminal',...band(100)})
    settings.prefersReducedMotion=false
    recording=true
    await $.config.set({key:'prefersReducedMotion',value:false})
    recording=false
    const first=operations.indexOf('redraw')
    expect(first).toBeGreaterThanOrEqual(0)
    expect(operations.slice(0,first)).toEqual([])
    expect(operations).toContain('timer')
    expect(w.view().mood).toBe('idle')
    expect(await ui.find({type:'Raster',key:'sprite'})).toBeDefined()
  })

  test('a missed VIEW publication explicitly redraws its fallback pose before arming event timers',async($,on)=>{
    let recording=false, refuse=false, missed=0
    const operations=publicationOrder(on,()=>recording)
    on('state.set',{key:'view'},($,e,next)=>{
      if(refuse){missed++;return {value:{isSet:false,version:1}}}
      return next(e)
    })
    const w=world(on,{store:RECENT})
    await $.session.start(START); await settleLegacyStart($,w);
    const ui=await $.ui.mount({surface:'desktop',...band(100)})
    await $.turn.start({text:'go',turnId:'missed-view'})
    recording=refuse=true
    await $.turn.complete({answer:'done',durationMs:1000,isAborted:false,turnId:'missed-view',reason:'answer'})
    recording=refuse=false
    expect(missed).toBeGreaterThan(0)
    const first=operations.indexOf('redraw')
    expect(first).toBeGreaterThanOrEqual(0)
    expect(operations.slice(0,first)).toEqual([])
    expect(operations).toContain('timer')
    expect(await source(ui)).toContain('data-coco="A done"')
  })

  test('a failed downstream band hook still returns a valid tree on other surfaces',async($,on)=>{
    world(on,{store:RECENT})
    on('ui.render', {component:'AbovePrompt'}, ()=>{throw new Error('downstream unavailable')})
    const ui=await $.ui.mount({surface:'vscode',...band(100)})
    expect(await ui.drawn()).toBeDefined()
  })
})
