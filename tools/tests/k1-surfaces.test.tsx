import { expect, test } from 'claude-code/testing'
import { desktopBand, planDesktop, terminalBand } from '../hooks/band'
import { desktopBook, terminalBook } from '../hooks/book'
import { normalizeDesktopView, validateDesktopTree } from '../hooks/desktop-safe'
import { installCostWords } from '../hooks/cost/words'
import { initialView } from '../hooks/mood'
import { WORDS, LANGS } from '../hooks/words'
import type { CostSurfaceSnapshot } from '../types'
import { BOOK_FILES } from './book-files'
import { COST_WORDS_RAW } from './cost-words-fixture'
import { world } from './world'

const now=Date.UTC(2026,9,7,14,30)
const cost=(state:CostSurfaceSnapshot['cache']['state']='warm'):CostSurfaceSnapshot=>({billing:{kind:'plan'},cache:{observed:true,state,sentAt:now-1000,warmUntil:now+299000,ttlMs:300000,prefix:128400,warmUSD:.03,coldUSD:.64,deltaUSD:.61,kept:{since:now-600000,pings:3,usd:.06,stopAt:now+3600000}},sessionUSD:3.84,lastTurn:{usd:.42,window:{kind:'5h',from:41,to:43}},ownCalls:{count:3,usd:.04},misses:{count:1,usd:.6},ledger:{day:14,week:61,month:230},warmEnabled:false})
const nodes=(tree:any):any[]=>!tree||typeof tree!=='object'?[]:Array.isArray(tree)?tree.flatMap(nodes):[tree,...(tree.children??[]).flatMap(nodes)]
const text=(tree:any):string=>typeof tree==='string'?tree:!tree?'':(tree.children??[]).map(text).join('')
const pane={plugin:'coco',component:'Pane' as const,requestId:'k1-surfaces',props:{title:'K1',isFocused:true,bodyColumns:100,placement:'dock' as const,scroll:{offset:0,bodyRows:30},view:{}}}

test('W5 mounted plan Offerings never expose a bare dollar in any language or cache state', {timeoutMs:60000},async($,on)=>{
  installCostWords(JSON.parse(COST_WORDS_RAW))
  let lang:typeof LANGS[number]['code']='en',state:CostSurfaceSnapshot['cache']['state']='warm'
  on('ui.render',{component:'Pane',requestId:'k1-surfaces'},($,e)=>{
    const s=cost(state),view={...initialView(),lang,cost:s,context:64}
    const d:any={view,cost:s,usage:{rateLimits:[],cost:{usd:3.84}},store:{},now,timeZone:'UTC',reducedMotion:true,marks:'replies',voiceSizes:{light:0,full:0},reading:0,own:WORDS[lang]}
    const w=JSON.parse(BOOK_FILES[lang+'.json']!),press={go(){},turn(){},marks(){}}
    return e.surface==='terminal'?terminalBook($.ui.resolve(e) as any,w,{page:'offerings',reading:0,rev:0},d,press,100):desktopBook($.ui.resolve(e) as any,w,{page:'offerings',reading:0,rev:0},d,{source:'<svg></svg>',height:64},press,100)
  })
  world(on)
  for(const language of LANGS){lang=language.code;for(state of ['warm','cooling','cold','kept']){
    const ui=await $.ui.mount({surface:'desktop',...pane}),tree=await ui.drawn()
    validateDesktopTree(tree)
    for(const node of nodes(tree)){
      const value=node.type==='Text'?text(node):node.type==='Svg'?node.props.alt:''
      if(String(value).includes('$'))expect(String(value)).toContain('API')
    }
    expect(await ui.find({type:'Button',key:'coco:prices:open'})).toBeDefined()
    await ui.unmount()
  }}
})

test('W10 actual normalized desktop cups pass the host tree contract and yield after neighbours',async($,on)=>{
  installCostWords(JSON.parse(COST_WORDS_RAW))
  let columns=140,state:CostSurfaceSnapshot['cache']['state']='warm'
  on('ui.render',{component:'Pane',requestId:'k1-surfaces'},($,e)=>{
    const view=normalizeDesktopView({...initialView(),context:64,cost:cost(state),neighbours:true,neighbourLights:{v:1,running:true,agents:[{id:'next',label:'Next',busy:true,partial:false}]}},initialView(),['idle-reading'])
    return desktopBand($.ui.resolve(e) as any,view,{columns,maxRows:30,screenRows:48,isWorking:false},'<svg width="76" height="64"></svg>')
  })
  world(on)
  for(state of ['warm','cooling','cold','kept'])for(columns of [38,54,80,103,140]){
    const ui=await $.ui.mount({surface:'desktop',...pane}),tree=await ui.drawn()
    validateDesktopTree(tree)
    const cups=(await ui.findAll({type:'Svg'})).filter(node=>String(node.props.source).includes('M3 10.8L4.2 19.3'))
    if(columns===140)expect(cups.length).toBe(1)
    // On the floor the neighbours' lamps give way before the cup (DECISIONS 1017): a band without the cup has no lamps.
    if(!cups.length)expect(await ui.find({key:'coco:neighbours'})).toBeUndefined()
    if(cups.length)expect(String(cups[0]!.props.source)).toContain('forced-color-adjust:none')
    await ui.unmount()
  }
})

test('Cache, How and Prices are present when the book opens before the first response',async($,on)=>{
  installCostWords(JSON.parse(COST_WORDS_RAW))
  on('ui.render',{component:'Pane',requestId:'k1-surfaces'},($,e)=>{
    const d:any={view:initialView(),usage:undefined,store:{},now,timeZone:'UTC',reducedMotion:true,marks:'replies',voiceSizes:{light:0,full:0},reading:0,own:WORDS.en}
    return desktopBook($.ui.resolve(e) as any,JSON.parse(BOOK_FILES['en.json']!),{page:'offerings',reading:0,rev:0},d,{source:'<svg></svg>',height:64},{go(){},turn(){},marks(){}},100)
  })
  world(on)
  const ui=await $.ui.mount({surface:'desktop',...pane})
  expect(await ui.find({type:'Text',text:'Cache'})).toBeDefined()
  expect(await ui.find({type:'Text',text:/No cache reported/})).toBeDefined()
  expect(await ui.find({type:'Button',key:'coco:cache:how'})).toBeDefined()
  expect(await ui.find({type:'Button',key:'coco:prices:open'})).toBeDefined()
})
