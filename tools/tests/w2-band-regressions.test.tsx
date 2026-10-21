import { expect, test } from 'claude-code/testing'
import { desktopBand, planDesktop, terminalBand, cells } from '../hooks/band'
import { initialView } from '../hooks/mood'
import { WORDS, LANGS } from '../hooks/words'
import { world, desktopPicture } from './world'

const size = (columns = 38, isWorking = true) => ({columns, isWorking, maxRows:30, screenRows:48})
const nodes = (tree:any):any[] => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...(tree.children??[]).flatMap(nodes)]
const text = (tree:any):string => typeof tree === 'string' ? tree : Array.isArray(tree) ? tree.map(text).join('') : tree && typeof tree === 'object' ? text(tree.children??[]) : ''
const line = (value:string, kind:'path'|'test'|'value', prefix='first one down: ') => ({id:'w2', key:'first_down', text:prefix+value, class:1 as const, slots:[{value,kind}], expiresAt:14000})
const mount = ($:any, surface:'desktop'|'terminal', id:string) => $.ui.mount({surface, plugin:'coco', component:'Pane', requestId:id, props:{title:'W2 fixture',isFocused:true,bodyColumns:80,placement:'dock',scroll:{offset:0,bodyRows:30},view:{}}})

for (const {code:lang} of LANGS) for (const theme of ['light','dark'] as const) for (const pixel of [false,true]) test(`W2 B1 ${lang}/${theme}/${pixel?'pixel':'working desktop'} row text shares the picture and right block centre`,async($,on)=>{
 const view={...initialView(),lang,theme,band:pixel?'compact' as const:'on' as const,workSize:'smaller' as const,line:line('parser','test')}
 const geometry=size(100)
 on('ui.render',{component:'Pane',requestId:'w2-centre'},($,e)=>desktopBand($.ui.resolve(e) as any,view,geometry,'<svg width="36" height="32"></svg>'))
 world(on)
 const ui=await mount($,'desktop','w2-centre'),tree=nodes(await ui.drawn())
 expect(tree.find(n=>n.props?.key==='coco:text-column')?.props.alignSelf).toBe('center')
 expect((await desktopPicture(ui))?.props.height).toBe(32)
 await ui.unmount()
})

test('W2 B2 three-segment path retains first and last segments when their form fits',()=>{
 const value='plugin/hooks/config.ts', view={...initialView(),context:56,band:'compact' as const,line:line(value,'path')}
 const plans=Array.from({length:45},(_,i)=>planDesktop(view,size(i+30)))
 expect(plans.some(p=>p.parts?.some(part=>part.slot&&part.text==='plugin/…/config.ts'))).toBe(true)
})

for(const value of ['long/prefix/path/config.ts','a/b/name.ts'])test(`W2 B2 filename survives a narrow slot: ${value}`,()=>{
 const view={...initialView(),context:56,band:'compact' as const,line:line(value,'path','')}
 const p=planDesktop(view,size(value.startsWith('long/')?32:24))
 const filename=value.split('/').pop()!
 expect({speech:p.speech,filenameSurvives:p.speech?.includes(filename)}).toEqual({speech:p.speech,filenameSurvives:true})
 expect(p.parts?.some(part=>part.slot&&part.text.includes(filename))).toBe(true)
})

test('W2 B3 desktop keeps between runs at the twelve-character floor',()=>{
 const value='parser › keeps comments between runs',view={...initialView(),context:56,band:'compact' as const,line:line(value,'test','')}
 const p=planDesktop(view,size(38))
 expect(p.parts?.filter(part=>part.slot).map(part=>part.text)).toContain('…between runs')
})

for(const [value,tail] of [['parser › keeps comments after run','…comments after run'],['keeps comments and whitespace','…and whitespace']])test(`W2 B3 floor retains a whole suffix: ${value}`,()=>{
 const view={...initialView(),context:56,band:'compact' as const,line:line(value!,'test','')}
 const p=planDesktop(view,size(38))
 expect(p.parts?.filter(part=>part.slot).map(part=>part.text)).toContain(tail)
})

test('W2 B4 terminal line end cuts at a word boundary',async($,on)=>{
 const view={...initialView(),context:56,line:{id:'w2',key:'pace',text:'at this pace, the 5-hour window incense burns out in ~1h 2m.',class:1 as const,expiresAt:14000}}
 on('ui.render',{component:'Pane',requestId:'w2-end'},($,e)=>terminalBand($.ui.resolve(e) as any,view,size(55)))
 world(on)
 const ui=await mount($,'terminal','w2-end'),tree=nodes(await ui.drawn()),spoken=tree.find(n=>n.type==='Text'&&text(n).includes('at this pace'))
 const fitted=text(spoken).trimStart(),kept=fitted.replace(/…$/,'')
 expect(fitted.endsWith('…')).toBe(true)
 expect(view.line.text.startsWith(kept)).toBe(true)
 expect({fitted,wordBoundary:/^\s/.test(view.line.text.slice(kept.length))}).toEqual({fitted,wordBoundary:true})
 // BAND F2 (10-09): the name goes before his words are cut; the box and the Book button stay
 expect(tree.some(n=>n.type==='Text'&&text(n)===WORDS.en.name)).toBe(false)
 expect(tree.some(n=>n.type==='Text'&&text(n).includes('◉◉◉ 56%'))).toBe(true)
 expect(tree.some(n=>n.type==='Button'&&n.props?.key==='coco:book:open')).toBe(true)
 expect(cells(fitted)).toBeLessThanOrEqual(55-cells('◉◉◉ 56%')-3-cells(WORDS.en.marks.shelf))
 await ui.unmount()
})

for(const lang of ['ja','fr'] as const) for(const surface of ['desktop','terminal'] as const) test(`W2 B5 ${surface}/${lang} complete bold numeric values have no internal wrap`,async($,on)=>{
 const value=lang==='ja'?'~1時間 2分':'80 %',view={...initialView(),lang,line:line(value,'value',lang==='ja'?'このペースだと、5時間枠の香はあと':'la fenêtre de 5 heures est à ')}
 on('ui.render',{component:'Pane',requestId:'w2-value'},($,e)=>surface==='desktop'?desktopBand($.ui.resolve(e) as any,view,size(100,false),'<svg width="73" height="64"></svg>'):terminalBand($.ui.resolve(e) as any,view,size(100,false)))
 world(on)
 const ui=await mount($,surface,'w2-value'),tree=nodes(await ui.drawn()),bold=tree.find(n=>n.type==='Text'&&n.props?.bold&&text(n).replace(/\u00a0/g,' ')===value)
 expect(bold).toBeDefined()
 expect(bold.props.wrap).toBe('truncate-end')
 expect(text(bold)).toBe(value.replace(/ /g,'\u00a0'))
 await ui.unmount()
})

test('W2 B5 terminal fitting counts each repeated Japanese value as one unbreakable unit',async($,on)=>{
 const value='~1時間 2分',prefix='x'.repeat(16),spoken=`${prefix} ${value} ${prefix} ${value}`
 const view={...initialView(),lang:'ja' as const,line:line(value,'value','')}
 view.line.text=spoken
 // 52 columns: the room the line had at 63 beside the old 35-cell figure, beside her 24-cell pixel version
 on('ui.render',{component:'Pane',requestId:'w2-atomic-value'},($,e)=>terminalBand($.ui.resolve(e) as any,view,size(52,false)))
 world(on)
 const ui=await mount($,'terminal','w2-atomic-value'),tree=nodes(await ui.drawn()),bold=tree.filter(n=>n.type==='Text'&&n.props?.bold&&text(n).replace(/\u00a0/g,' ')===value)
 expect(bold.length).toBe(2)
 expect(tree.some(n=>n.type==='Text'&&text(n).includes('…')&&text(n).replace(/\u00a0/g,' ').split(value).length-1===2)).toBe(true)
 await ui.unmount()
})

for(const value of ['Explore','general purpose','A careful planner'])for(const surface of ['desktop','terminal'] as const)test(`W2 B5 ${surface} nonnumeric bold values remain verbatim: ${value}`,async($,on)=>{
 const view={...initialView(),line:{...line(value,'value','next door: '),key:'neighbour.busy'}}
 on('ui.render',{component:'Pane',requestId:'w2-verbatim-value'},($,e)=>surface==='desktop'?desktopBand($.ui.resolve(e) as any,view,size(100,false),'<svg width="73" height="64"></svg>'):terminalBand($.ui.resolve(e) as any,view,size(100,false)))
 world(on)
 const ui=await mount($,surface,'w2-verbatim-value'),tree=nodes(await ui.drawn()),bold=tree.find(n=>n.type==='Text'&&n.props?.bold&&text(n).replace(/\u00a0/g,' ')===value)
 expect(bold).toBeDefined()
 expect(text(bold)).toBe(value)
 await ui.unmount()
})
