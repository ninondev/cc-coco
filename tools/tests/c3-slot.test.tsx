import { expect, test } from 'claude-code/testing'
import { initialView } from '../hooks/mood'
import { desktopBand, terminalBand, planDesktop, cells, rowsOf } from '../hooks/band'
import { world } from './world'
import { WORDS } from '../hooks/words'
import type { CocoView } from '../types'
import { LineSlot } from '../hooks/line-slot'

test('M1 dismissing a paste warning restores a queued stamp with its authored lifetime',()=>{
  const slot=new LineSlot()
  slot.offer({key:'more.paste',text:'secret fixture',class:3,ttl:12000},0)
  slot.offer({key:'stamp.month',text:'stamp fixture',class:1,ttl:5000,once:true},1)
  expect(slot.visible(1)?.key).toBe('more.paste')
  expect(slot.dismiss('more.paste',2)).toBe(true)
  expect(slot.visible(2)?.key).toBe('stamp.month')
  expect(slot.visible(2)?.text).toBe('stamp fixture')
  expect(slot.visible(2)?.expiresAt).toBe(5002)
  expect(slot.dismiss('more.paste',3)).toBe(false)
})

test('C3 action fitting reserves the complete native button before cutting speech', () => {
  const view = { ...initialView(), said: 'this chapter is nearly full. time for /compact?' }
  const size = { columns: 32, maxRows: 30, screenRows: 48, isWorking: false }
  const ordinary = planDesktop(view, size, undefined, { class: 2 })
  const action = planDesktop(view, size, undefined, { class: 2, button: { key: 'coco:chapter:compact', label: 'Turn the page' } } as never)
  expect(action.buttonWidth).toBeGreaterThan(0)
  expect(action.textWidth! - action.buttonWidth!).toBeLessThan(ordinary.textWidth!)
  expect(action.height).toBe(ordinary.height)
})

test('C3 fitting returns surviving bold slot values with the shortened line', () => {
  const text = 'first one down: parser › keeps comments between many very long test runs'
  const p = planDesktop({ ...initialView(), said: text }, { columns: 42, maxRows: 30, screenRows: 48, isWorking: false }, undefined,
    { class: 1, slots: [{ value: 'parser › keeps comments between many very long test runs', kind: 'test' }] })
  expect(p.parts?.some(part => part.slot && part.text.includes('…'))).toBe(true)
  expect(p.height).toBe(64)
})

// SPEC 0.2 rules 4–7; visual review rows 1, 3–7 and 12, G2–G3.
test('C3 notes keep the resting direction, ordinary labels and complete percent values', () => {
  const window = 'the seven-day window'
  const view = { ...initialView(), line: { id:'budget', key:'budget', text:window+' is at 80%.', class:1 as const, slots:[{value:window,kind:'label' as const},{value:'80%',kind:'value' as const}], expiresAt:14000 } }
  const p=planDesktop(view,{columns:100,maxRows:30,screenRows:48,isWorking:false})
  expect(p.aside).toBe('beside')
  expect(p.text).toBe(WORDS.en.aside.idle)
  expect(p.parts?.filter(part=>part.slot).map(part=>part.text)).toEqual(['80%'])
  expect(p.speech).toContain(window)
})

test('C3 terminal note uses the column below the name and a working line never wraps', async ($,on) => {
  const view={...initialView(),context:56,line:{id:'pace',key:'pace',text:'at this pace, the 5-hour window incense burns out in ~1h 2m.',class:1 as const,slots:[{value:'5-hour window',kind:'label' as const},{value:'~1h 2m',kind:'value' as const}],expiresAt:14000},quota:{rateLimits:[{kind:'five_hour',percentUsed:72},{kind:'seven_day',percentUsed:41}],at:0}}
  let working=false, columns=80
  on('ui.render',{component:'Pane',requestId:'c3-fit'},($,e)=>{if(e.surface!=='terminal')return null;return terminalBand($.ui.resolve(e),view,{columns,maxRows:30,screenRows:48,isWorking:working})})
  world(on)
  const mount=()=>$.ui.mount({surface:'terminal',plugin:'coco',component:'Pane',requestId:'c3-fit',props:{title:'C3 fit',isFocused:true,bodyColumns:80,placement:'dock',scroll:{offset:0,bodyRows:30},view:{}}})
  const rest=await mount()
  expect(await rest.find({type:'Text',text:/at this pace/})).toBeDefined()
  expect(await rest.find({type:'Text',text:WORDS.en.name})).toBeDefined()
  expect(await rest.find({type:'Text',text:/swinging legs/})).toBeDefined()
  expect(await rest.find({type:'Button',key:'coco:book:open'})).toBeDefined()
  // 10-14: with the short name and the gear the whole line fits beside the name at 80 columns, so the squeeze is tried lower;
  // the commit cells (lane C, ◉◉◉ 56%) take two cells more than the old box glyph, so at 72 rather than 70
  await rest.unmount();working=true;columns=72
  const row=await mount()
  const nodes=(node:any):any[]=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(nodes):[node,...(node.children??[]).flatMap(nodes)]
  const flatten=(node:any):string=>typeof node==='string'?node:Array.isArray(node)?node.map(flatten).join(''):node&&typeof node==='object'?flatten(node.children??[]):''
  const normal=(node:any)=>flatten(node).replace(/\u00a0/g,' ')
  const tree=await row.drawn(),all=nodes(tree)
  const spoken=all.filter(node=>node.type==='Text'&&node.children?.some((child:any)=>child?.type==='Text'&&child.props?.bold&&normal(child)==='~1h 2m'))
  expect(spoken.length).toBe(1)
  const line=spoken[0]!,fitted=normal(line).trimStart()
  expect(line.props.wrap).toBe('truncate-end')
  expect(fitted.includes('in ~1h 2m')).toBe(true)
  expect(fitted.includes('\n')).toBe(false)
  expect(all.some(node=>node.type==='Box'&&node.props?.flexWrap==='nowrap'&&nodes(node).includes(line))).toBe(true)
  expect(rowsOf(tree)).toBe(1)
  // BAND F2 (10-09): the name goes before his words are cut. At 72 columns the name would leave too few cells for the line's
  // 60, so the name steps aside and the whole line stays; the commit cells and the Book button stay.
  const wide=columns-cells('◉◉◉ 56%')-3-cells(WORDS.en.marks.shelf)
  expect(cells(fitted)).toBeGreaterThan(columns-cells(WORDS.en.name)-1-cells('◉◉◉ 56%')-3-cells(WORDS.en.marks.shelf))
  expect(cells(fitted)).toBeLessThanOrEqual(wide)
  expect(await row.find({type:'Text',text:WORDS.en.name})).toBeUndefined()
  expect(await row.find({type:'Text',text:'◉◉◉ 56%'})).toBeDefined()
  expect(await row.find({type:'Button',key:'coco:book:open'})).toBeDefined()
  await row.unmount()
  // where the name and the whole line fit together, the name stays
  columns=120
  const roomy=await mount()
  const roomyAll=nodes(await roomy.drawn())
  expect(roomyAll.some(node=>node.type==='Text'&&node.props?.bold&&normal(node)===WORDS.en.name)).toBe(true)
  expect(normal(roomyAll.find(node=>node.type==='Text'&&node.props?.wrap==='truncate-end'&&normal(node).includes('in ~1h 2m'))).trimStart()).toBe(fitted)
  await roomy.unmount()
})

test('C3 action row has a column gap and uncut button edges; resting line starts directly below the name', async($,on)=>{
  const view:CocoView={...initialView(),line:{id:'chapter',key:'chapter',text:'time for /compact?',class:2 as const,button:{key:'compact',label:'Turn the page'},expiresAt:14000}}
  let working=false
  on('ui.render',{component:'Pane',requestId:'c3-fit-desktop'},($,e)=>{if(e.surface!=='desktop')return null;return desktopBand($.ui.resolve(e),view,{columns:100,maxRows:30,screenRows:48,isWorking:working},'<svg width="73" height="64"></svg>')})
  world(on)
  const nodes=(tree:unknown):any[]=>{if(!tree||typeof tree!=='object')return [];if(Array.isArray(tree))return tree.flatMap(nodes);const node=tree as any;return [node,...(node.children??[]).flatMap(nodes)]}
  const mount=()=>$.ui.mount({surface:'desktop',plugin:'coco',component:'Pane',requestId:'c3-fit-desktop',props:{title:'C3 fit',isFocused:true,bodyColumns:100,placement:'dock',scroll:{offset:0,bodyRows:30},view:{}}})
  const rest=await mount(), tree=nodes(await rest.drawn())
  const spoken=tree.find(node=>node.type==='Box'&&node.children?.some((child:any)=>child?.type==='Box'&&child.children?.some((item:any)=>item?.type==='Button'&&item.props?.key==='compact')))
  expect(spoken?.props.height).toBeUndefined()
  expect(spoken?.props.overflow).toBeUndefined()
  // BAND 3.2 (line 261): the band Box aligns its children to the bottom, so the figure sits on the floor.
  expect(tree.find(node=>node.props?.key==='coco:band')?.props.alignItems).toBe('flex-end')
  await rest.unmount();working=true;view.workSize='smaller' as never
  const row=await mount(), rowTree=nodes(await row.drawn())
  expect(rowTree.some(node=>node.props?.columnGap===1&&node.children?.some((child:any)=>child?.type==='Box'&&child.children?.some((item:any)=>item?.type==='Button'&&item.props?.key==='compact')))).toBe(true)
  expect(rowTree.find(node=>node.props?.key==='coco:text-column')?.props.overflow).toBeUndefined()
})

// Visual review row 1: quota and context share only the resting name row, not the line's width.
test('C3 a long resting test name cannot remove quota that already fits the name row',async($,on)=>{
  const name='parser_'.repeat(12),limits=[{kind:'five_hour',percentUsed:10}]
  const view:CocoView={...initialView(),context:23,mood:'error',frame:'error',quota:{rateLimits:limits,at:0},line:{id:'first_down',key:'first_down',text:'first one down: '+name,class:1,slots:[{value:name,kind:'test'}],expiresAt:14000}}
  on('ui.render',{component:'Pane',requestId:'c3-quota-fit'},($,e)=>{if(e.surface!=='terminal')return null;return terminalBand($.ui.resolve(e),view,{columns:100,maxRows:30,screenRows:48,isWorking:false})})
  world(on)
  const ui=await $.ui.mount({surface:'terminal',plugin:'coco',component:'Pane',requestId:'c3-quota-fit',props:{title:'C3 quota fit',isFocused:true,bodyColumns:100,placement:'dock',scroll:{offset:0,bodyRows:30},view:{}}})
  // The terminal's plain row (lane C, 10-14): the short name, four cells, what is left.
  const walk=(node:any):any[]=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(walk):[node,...(node.children??[]).flatMap(walk)]
  const texts=walk(await ui.drawn()).filter(n=>n.type==='Text').map(n=>(n.children??[]).filter((c:unknown)=>typeof c==='string').join(''))
  expect(texts).toContain('5h ')
  expect(texts).toContain('▮▮▮▮')
  expect(texts).toContain(' 90%')
  expect(await ui.find({type:'Text',text:/◉ 23% context/})).toBeDefined()
})
