import {test,expect} from 'claude-code/testing'
import {world,RECENT,MORNING,P,PERSON,settleLegacyStart} from './world'
import {M1_MORE_TEXT,installM1Words} from './m1-more-data-fixture'
import {moreWord} from '../hooks/more-words'
installM1Words()
const START={cwd:'/tmp/line-import-project',surface:'terminal' as const,isInteractive:true}
const PANE={plugin:'coco',component:'Pane' as const,requestId:'coco-book',props:{title:'Coco',isFocused:true,bodyColumns:64,placement:'dock' as const,scroll:{offset:0,bodyRows:40},view:{}}}

for(const surface of ['desktop','terminal','vscode','mobile'] as const)test(`Line import: ${surface} reviews before applying without a model call`,async($,on)=>{
 const imported=['👍🏽'.repeat(24),'👨\u200d👩\u200d👧\u200d👦'.repeat(24),'क्\u200dषमा','क्\u200cषमा']
 const path='/tmp/coco-import-fixture.txt',source='[start]\n开工啦\n'+imported.join('\n')+'\n'+('很'.repeat(25))+'\n[done]\n搞定啦'
 let modelCalls=0
 on('model.complete',()=>{modelCalls++;return{deny:'file imports must not send requests'}})
 on('fs.stat',($,e,next)=>e.path===path?{value:{kind:'file',size:new TextEncoder().encode(source).byteLength,mtimeMs:MORNING,isLink:false}}:next(e))
 const w=world(on,{observeStore:true,moreText:M1_MORE_TEXT,store:{...RECENT},env:{HOME:'/tmp/line-import-home',LANG:'zh_CN.UTF-8',TERM:'xterm-256color'},readText:p=>p===path?source:undefined})
 await $.session.start(START);await settleLegacyStart($,w)
 await $.command.run({command:'coco',args:`lines import ${path}`,origin:PERSON,presentation:P})
 const ui=await $.ui.mount({surface,...PANE})
 expect(await ui.find({key:'coco:more:lines:import:apply'})).toBeDefined()
 expect(await ui.find({key:'coco:more:lines:import:off'})).toBeUndefined()
 const texts=(await ui.findAll({type:'Text'})).map(node=>node.text).join('\n')
 expect(texts).toContain('开工啦')
 for(const line of imported)expect(texts).toContain(line)
 expect(texts).toContain(moreWord('lines.import.wide','zh'))
 if(surface==='desktop')console.log('LINEIMPORTDUMP '+JSON.stringify({name:'导入预览',surface,tree:await ui.drawn()}))
 await ui.press({key:'coco:more:lines:import:apply'});await ui.redraw()
 const saved=(w.stored('more.lines') as {imported:Record<string,{text:string}>}).imported['coco:zh']?.text.split('\n')
 for(const line of imported)expect(saved).toContain(line)
 expect(await ui.find({key:'coco:more:lines:import:off'})).toBeDefined()
 expect(await ui.find({key:'coco:more:lines:import:apply'})).toBeUndefined()
 const labels=(await ui.findAll({type:'Select'})).flatMap(node=>(node.props.options as {label:string}[]??[]).map(option=>option.label))
 const buttons=(await ui.findAll({type:'Button'})).map(node=>node.props.label)
 expect([...labels,...buttons]).toContain(moreWord('lines.import.only','zh'))
 expect(await ui.find({key:surface==='mobile'?'coco:more:lines:lang:zh':'coco:more:lines:lang'})).toBeDefined()
 if(surface==='desktop')console.log('LINEIMPORTDUMP '+JSON.stringify({name:'导入已启用',surface,tree:await ui.drawn()}))
 await ui.press({key:'coco:more:lines:import:off'});await ui.redraw()
 expect(await ui.find({key:'coco:more:lines:import:on'})).toBeDefined()
 expect(modelCalls).toBe(0)
 await ui.unmount()
})
