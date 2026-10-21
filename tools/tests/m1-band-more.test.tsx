import { expect, test } from 'claude-code/testing'
import { desktopBand, terminalBand } from '../hooks/band'
import { initialView } from '../hooks/mood'
import { WORDS } from '../hooks/words'
import { planPx, COLUMN_PX } from '../hooks/typeset'
import { moreWord, MORE_SLOTS } from '../hooks/more-words'
import { MorePage } from '../hooks/more-book'
import { installM1Words } from './m1-more-data-fixture'
import { world } from './world'

const nodes = (tree:any):any[] => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...(tree.children??[]).flatMap(nodes)]
const size = (columns:number) => ({columns,isWorking:false,maxRows:30,screenRows:48})

// U6 (owner 10-17: 「画出来，写一句为什么」): the second look without its reader instruction is drawn Off, with no switch.
test('M1 the reader that cannot run is drawn Off with its label and cost line and no switch on any surface', async ($,on) => {
  installM1Words()
  // lane B wrote the reader instruction on 10-17, so this test takes it out to see the row that cannot run
  const instruction=MORE_SLOTS['more.model.look.prompt'];delete MORE_SLOTS['more.model.look.prompt']
  try{
  on('ui.render',{component:'Pane',requestId:'m1-unavailable'},($,e)=>MorePage($.ui.resolve(e) as any,{surface:e.surface,snapshot:{values:{},agreed:[],today:{date:'',rows:{}},reading:0,open:true,lang:'en',screenReader:false}}))
  world(on,{surfaces:['terminal','desktop','vscode','mobile']})
  for(const surface of ['terminal','desktop','vscode','mobile'] as const){
    const ui=await $.ui.mount({surface,plugin:'coco',component:'Pane',requestId:'m1-unavailable',props:{title:WORDS.en.name,isFocused:true,bodyColumns:100,placement:'dock',scroll:{offset:0,bodyRows:100},view:{}}})
    const tree=nodes(await ui.drawn())
    for(const id of ['look']){
      expect(await ui.find({type:'Button',key:`coco:more:${id}:on`})).toBeUndefined()
      expect(tree.find(node=>node.props?.key===`coco:more:row:${id}`)).toBeDefined()
      for(const text of [moreWord(`${id}.cost`,'en'),moreWord('cap.off','en')])expect(await ui.find({type:'Text',text})).toBeDefined()
    }
    expect(await ui.find({type:'Button',key:'coco:more:lively:on'})).toBeDefined()
    await ui.unmount()
  }
  }finally{if(instruction)MORE_SLOTS['more.model.look.prompt']=instruction}
})

test('M1 enabled More actions preserve W3 Book and Close within narrow desktop hover bounds', async ($,on) => {
  installM1Words()
  const view = {...initialView(),moreActions:[
    {key:'coco:more:toHim',label:moreWord('talk.toHim','en')},
    {key:'coco:more:explain',label:moreWord('explain.button','en')},
  ]}
  let columns = 24
  on('ui.render',{component:'Pane',requestId:'m1-more-width'},($,e) => desktopBand($.ui.resolve(e) as any,view,size(columns),'<svg width="76" height="64"></svg>'))
  world(on)
  for(columns of [24,38,54,103]) { // 24 columns is the band's narrowest (W4 P2)
    const ui = await $.ui.mount({surface:'desktop',plugin:'coco',component:'Pane',requestId:'m1-more-width',props:{title:WORDS.en.name,isFocused:true,bodyColumns:columns,placement:'dock',scroll:{offset:0,bodyRows:30},view:{}}})
    const controls = nodes(await ui.drawn()).find(n=>n.type==='Box'&&n.props?.position==='absolute'&&n.props?.display==='none')
    const buttons = nodes(controls).filter(n=>n.type==='Button')
    // the strip stands in her picture block, after the 12 px ribbon slot, and keeps the two-column right inset
    const width = buttons.reduce((sum,b)=>sum+planPx(b.props.label)+22,0)+(buttons.length-1)*6+2*COLUMN_PX
    expect(12+Number(controls.props.left??0)*COLUMN_PX+width).toBeLessThanOrEqual(columns*COLUMN_PX)
    expect(buttons.at(-1)?.props.key).toBe('coco:band:close')
    // the bag stands on the floor at rest (10-18), so it is found anywhere in the band
    expect(nodes(await ui.drawn()).some(n=>n.type==='Button'&&n.props?.key==='coco:book:open')).toBe(true)
    if(columns===103)for(const action of view.moreActions)expect(buttons.some(b=>b.props.key===action.key)).toBe(true)
    await ui.unmount()
  }
})

test('M1 narrow critical terminal line drops the whole optional right block including More actions', async ($,on) => {
  installM1Words()
  const text = WORDS.en.aside.idle
  const view = {...initialView(),band:'compact' as const,line:{id:'m1-width',key:'guard',text,class:3 as const,expiresAt:Infinity},moreActions:[{key:'coco:more:explain',label:moreWord('explain.button','en')}]}
  on('ui.render',{component:'Pane',requestId:'m1-more-terminal'},($,e)=>terminalBand($.ui.resolve(e) as any,view,size(20)))
  world(on)
  const ui = await $.ui.mount({surface:'terminal',plugin:'coco',component:'Pane',requestId:'m1-more-terminal',props:{title:WORDS.en.name,isFocused:true,bodyColumns:20,placement:'dock',scroll:{offset:0,bodyRows:30},view:{}}})
  expect(await ui.find({type:'Button',key:'coco:more:explain'})).toBeUndefined()
  await ui.unmount()
})

test('M1 narrow idle terminal drops More actions while preserving the book; wide idle keeps them', async ($,on) => {
  installM1Words()
  const action={key:'coco:more:explain',label:moreWord('explain.button','en')}
  const view={...initialView(),band:'compact' as const,context:56,moreActions:[action]}
  let columns=38
  on('ui.render',{component:'Pane',requestId:'m1-more-idle'},($,e)=>terminalBand($.ui.resolve(e) as any,view,size(columns)))
  world(on)
  for(columns of [38,103]) {
    const ui=await $.ui.mount({surface:'terminal',plugin:'coco',component:'Pane',requestId:'m1-more-idle',props:{title:WORDS.en.name,isFocused:true,bodyColumns:columns,placement:'dock',scroll:{offset:0,bodyRows:30},view:{}}})
    expect(await ui.find({type:'Button',key:'coco:book:open'})).toBeDefined()
    const more=await ui.find({type:'Button',key:action.key})
    if(columns===38)expect(more).toBeUndefined()
    else expect(more).toBeDefined()
    await ui.unmount()
  }
})
