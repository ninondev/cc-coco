// Main-agent text arming, persisted snapshots, family writes and redraw scope.
import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { OLDER_HEAD_DIRECTION } from '../hooks/transcript'
import { WORDS } from '../hooks/words'
import { desktopRenderReceipts } from './desktop-render-receipts'
import { WINDOWS_ROOTS } from './test-system'
import { HEAD_CAP, TurnLedger, headAddress, headKey } from '../hooks/turn-ledger'
import { MORNING, RECENT, band, desktopPicture, world, settleLegacyStart } from './world'

const ENGINE = { type: 'engine', ref: 0 }

// Exact visible tree/props; handler identities can change on host re-entry.
function visibleContent(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(visibleContent)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key !== 'handle')
    .map(([key, item]) => [key, visibleContent(item)]))
}
const START = { cwd: '/tmp/b4-heads', surface: 'vscode' as const, isInteractive: true }
const STEP = { turnId: 't1', index: 0, model: 'claude', messageCount: 1 }
function reply(requestId: string, isFirstOfReply = true) {
  return { plugin: 'coco', component: 'AssistantMessage' as const, requestId,
    props: { text: `native words ${requestId}`, isFirstOfReply }, viewport: { columns: 100, rows: 48 } }
}
// The legacy world groups state only by key; these tests model the family's id.
function family(on: On) {
  const cells = new Map<string, { value: any; version: number }>()
  const reads: string[] = [], writes: string[] = []
  on('state.get', { key: 'head' }, async ($, e, next) => {
    await next(e)
    reads.push(e.id!); const c = cells.get(e.id!)
    return { value: { value: c?.value, version: c?.version ?? 0 } } as never
  })
  on('state.set', { key: 'head' }, async ($, e, next) => {
    const result = await next(e)
    writes.push(e.id!); const version = result.value?.version ?? (cells.get(e.id!)?.version ?? 0) + 1
    cells.set(e.id!, { value: e.value, version })
    return result
  })
  return { cells, reads, writes }
}
async function step($: any, turnId = 't1', agentId?: string) {
  for await (const _ of $.turn.step({ ...STEP, turnId, ...(agentId ? { agentId } : {}) })) {}
}
function complete(turnId: string, reason: 'answer' | 'error' | 'aborted' | 'refusal' = 'answer', answer = 'Done.') {
  return { turnId, reason, answer, durationMs: 1200, isAborted: reason === 'aborted',
    ...(reason === 'refusal' ? { refusal: { category: null, explanation: null } } : {}) }
}

describe('B1c native band-only subscription',()=>{
 test('cold desktop answer precedes every asynchronous host read',async($,on)=>{
  const calls:string[]=[]
  const watch=((event:string,...args:any[])=>{if(!/^(state\.|settings\.|store\.|env\.|session\.)/.test(event))return(on as any)(event,...args);const handler=args.pop();return (on as any)(event,...args,(...params:any[])=>{calls.push(event);return handler(...params)})})as On
  const w=world(watch,{store:RECENT,engineRows:true})
  const ui=await $.ui.mount({surface:'desktop',...band(100)})
  expect(await desktopPicture(ui)).toBeDefined();expect(w.stateReads).toBe(0);expect(calls).toEqual([])
 })
  // The host invalidates all render callbacks. B1b's own synchronous desktop
  // branch omits downstream dispatch; own redraws and frozen rows are measured separately.
  for(const heldView of [false,true]) for (const transcriptSurface of ['desktop', 'vscode', 'mobile'] as const) for(const delayedData of heldView&&transcriptSurface==='mobile'&&!WINDOWS_ROOTS?[false,true]:[false]) test(`${transcriptSurface}, held VIEW ${heldView}, delayed data ${delayedData}: 50 reply and 50 tool rows retain their exact content across five band publications`, { timeoutMs: heldView?5000:60000 }, async ($, on) => {
    let holding=false,heldWrites=0,releaseView!:()=>void;const frozen=new Promise<void>(resolve=>releaseView=resolve)
    let releaseData!:()=>void,dataReadStarted=false;const dataGate=new Promise<void>(resolve=>releaseData=resolve)
    if(delayedData)on('fs.read',{path:/[\\/]assets[\\/]coco[\\/]band-A\.json$/},async($,e,next)=>{dataReadStarted=true;await dataGate;return next(e)})
    on('state.set',{key:'view'},async($,e,next)=>{if(holding){heldWrites++;await frozen}return next(e)})
    const receipts=desktopRenderReceipts(on)
    let counting=false, globalInvalidations=0
    on('ui.invalidate',($,e,next)=>{if(counting)globalInvalidations++;return next(e)})
    const counts = { replies: 0, tools: 0, band: 0 }
    const heads = Array.from({ length: 50 }, (_, i) => [`unchanged-${i}`, 'error', MORNING - 1000 + i, 1200])
    heads.push(['sentinel-newest', 'happy', MORNING, 1200])
    const w=world(on, { stepText: 'first words', store: { ...RECENT, heads }, engineRows: true, settings: { prefersReducedMotion: true }, onRender: c => {
      if (c === 'AssistantMessage') counts.replies++
      if (c === 'ToolUse') counts.tools++
      if (c === 'AbovePrompt') counts.band++
    } }); family(on)
    try {
    await $.session.start(START); await settleLegacyStart($,w)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    const rows: { ui: Awaited<ReturnType<typeof $.ui.mount>>; content: unknown }[] = []
    for (let i = 0; i < 50; i++) {
      const head = await $.ui.mount({ surface: transcriptSurface, ...reply(`unchanged-${i}`) })
      expect(await head.find({ type: 'Text', text: /Coco/ })).toBeDefined()
      if (transcriptSurface === 'vscode') expect(await head.find({ type: 'Svg' })).toBeDefined()
      expect(await head.find({ key: 'coco:book:open' })).toBeUndefined()
      rows.push({ ui: head, content: visibleContent(await head.drawn()) })
      const tool = await $.ui.mount({ surface: transcriptSurface, plugin: 'coco', component: 'ToolUse', requestId: `tool-${i}`,
        props: { tool_use_id: `tool-${i}`, tool: 'Read', input: {}, isRunning: false, isErrored: false, isInterrupted: false } })
      expect(await tool.drawn()).toEqual(ENGINE)
      rows.push({ ui: tool, content: visibleContent(await tool.drawn()) })
    }
    await w.clock.advance(0);await receipts.flush($)
    console.log('B1C_BOOTSTRAP_COUNTS '+JSON.stringify({surface:transcriptSurface,counts:{...counts},ownDesktopRenders:receipts.current(),scope:'Observed setup counts; priming is measured separately by subscription-probe'}))
    const before = { ...counts }, ownBefore=receipts.current()
    counting=true;holding=heldView
    const invalidationPhases:number[]=[]
    const publish=async(start:()=>Promise<unknown>)=>{const result=start();if(heldView){void result.catch(()=>{});await receipts.flush($)}else await result}
    const assertFrozen = async (mood: 'think'|'work'|'happy'|'error') => {
      await ui.drawn()
      if(!heldView)expect(w.view().mood).toBe(mood)
      const picture=await desktopPicture(ui);expect(picture).toBeDefined()
      // the action Coco plays for the mood (coco-motion.ts): happy is the turn just done
      const expected=({think:'think',work:'work',happy:'done',error:'error'}as const)[mood]
      expect(/data-coco="([^"]*)"/.exec(String(picture?.props.source))?.[1]).toBe(`A ${expected}`)
      for (const row of rows) expect(visibleContent(await row.ui.drawn())).toEqual(row.content)
      invalidationPhases.push(globalInvalidations)
    }
    await publish(()=>$.turn.start({ turnId: 'm1', text: 'go' })); await assertFrozen('think')
    if(delayedData){expect(dataReadStarted).toBe(true);const beforeReady=String((await desktopPicture(ui))?.props.source),countBeforeReady=receipts.current();releaseData();await receipts.flush($);expect(String((await desktopPicture(ui))?.props.source)).toBe(beforeReady);expect(receipts.current()).toBe(countBeforeReady)}
    await publish(()=>$.tool.call({ tool: 'Read', file_path: '/tmp/b4-source' })); await assertFrozen('work')
    await publish(()=>$.turn.complete(complete('m1'))); await assertFrozen('happy')
    await publish(()=>$.turn.start({ turnId: 'm2', text: 'go' })); await assertFrozen('think')
    await publish(()=>$.turn.complete(complete('m2', 'error'))); await assertFrozen('error')
    await receipts.flush($)
    counting=false
    const measured = { replies: counts.replies - before.replies, tools: counts.tools - before.tools, band: counts.band - before.band }
    expect(receipts.available).toBe(!WINDOWS_ROOTS)
    console.log('B4_RENDER_COUNTS ' + JSON.stringify({ surface: transcriptSurface, replies: 50, tools: 50, pushes: 5, ...(receipts.available?{ownDesktopRenders:receipts.current()-ownBefore}:{ownDiagnosticUnavailable:'native Windows diagnostics disabled'}), globalInvalidations, measured }))
    if(receipts.available)expect(receipts.current()-ownBefore).toBe(5)
    expect(invalidationPhases).toEqual([0,0,0,0,0])
    expect(globalInvalidations).toBe(0)
    if(heldView)expect(heldWrites).toBeGreaterThan(0)
    expect(measured).toEqual({ replies: 0, tools: 0, band: 0 })
    } finally {counting=false;holding=false;releaseView();releaseData();await receipts.flush($)}
  })
})

if(!WINDOWS_ROOTS)test('delayed picture readiness redraws a reduced-motion touch face that differs from its bundled fallback',async($,on)=>{
 // Coco's whole data file comes after her bundled resting states; once it is read, the touch she is
 // feeling is drawn (still, under reduced motion) with one own redraw and no global invalidation
 let releaseData!:()=>void,readStarted=false;const gate=new Promise<void>(resolve=>releaseData=resolve)
 on('fs.read',{path:/[\\/]assets[\\/]coco[\\/]band-[AB]\.json$/},async($,e,next)=>{readStarted=true;await gate;return next(e)})
 const receipts=desktopRenderReceipts(on);let counting=false,globalInvalidations=0
 on('ui.invalidate',($,e,next)=>{if(counting)globalInvalidations++;return next(e)})
 const w=world(on,{store:RECENT,settings:{prefersReducedMotion:true}})
 try{
  await $.session.start(START);await settleLegacyStart($,w);const ui=await $.ui.mount({surface:'desktop',...band(100)});await w.clock.advance(0);await receipts.flush($)
  expect(readStarted).toBe(true);counting=true;await ui.press({key:'coco:band:pat'});await receipts.flush($)
  const before=String((await desktopPicture(ui))?.props.source),ownBefore=receipts.current();expect(before).toContain('data-coco="A idle"')
  releaseData();await receipts.flush($);const after=String((await desktopPicture(ui))?.props.source)
  expect(after).toContain('data-coco="A petted"');expect(after===before).toBe(false)
  expect(receipts.current()-ownBefore).toBe(1);expect(globalInvalidations).toBe(0)
 }finally{counting=false;releaseData();await receipts.flush($)}
})
