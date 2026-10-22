import {expect,test} from 'claude-code/testing'
import {world,settleLegacyStart,RECENT,PERSON,P} from './world'
const START = { cwd: '/tmp/project', surface: 'terminal' as const, isInteractive: true }
const PANE = {
  plugin: 'coco',
  component: 'Pane' as const,
  requestId: 'coco-book',
  props: { title: 'Coco', isFocused: false, bodyColumns: 64, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}
async function open($: Parameters<Parameters<typeof test>[1]>[0], args = '') {
  await $.command.run({ command: 'coco', args, origin: PERSON, presentation: P })
}

  test('the reading log counts pages, the wild soul and the first page', async ($, on) => {
    const events:unknown[]=[]
    on('store.*',async($,e,next)=>{const out=await next(e);if(next.is('store.get',e)||next.is('store.set',e))events.push({key:e.key,kind:next.is('store.get',e)?'get':'set',out,...(next.is('store.set',e)?{input:e.value}:{})});return out})
    const w = world(on, { store: { ...RECENT, turns: 41 } })
    w.fails = true
    await $.session.start(START); await settleLegacyStart($,w);
    await $.turn.start({ text: 'run the tests', turnId: 't1' })
    for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'pytest -q' })
    await $.turn.complete({ answer: 'Fixed.', durationMs: 3000, isAborted: false, turnId: 't1', reason: 'answer' })
    await open($, 'log')
    const ui = await $.ui.mount({ surface: 'desktop', ...PANE })
    console.log('B1B_READING_LOG_FIXTURE '+JSON.stringify({events:events.filter((e:any)=>['turns','wilds','firstMet'].includes(e.key)),text:(await ui.findAll({type:'Text'}))}))
    // BOOK 10-09: a pair stands as a label column and a value column, so each label and its value are two Texts in a row.
    const page = (await ui.findAll({ type: 'Text' })).map((node: any) => node.text ?? '').join(' ')
    expect(page).toMatch(/Pages read together\s+42/)
    expect(page).toMatch(/Bristled\s+once/)
    expect(page).toMatch(/First page\s+Oct 2, 2026/)
  })

