import { expect, test } from 'claude-code/testing'
import { terminalBand } from '../hooks/band'
import { initialView } from '../hooks/mood'
import { LANGS, WORDS } from '../hooks/words'
import { percentText } from '../hooks/numbers'
import { world } from './world'

const text = (node:any):string => typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.children??[]):''
const nodes = (node:any):any[] => !node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(nodes):[node,...(node.children??[]).flatMap(nodes)]
// Count emitted terminal graphemes, independently of band.tsx's fitting budget.
const graphemes = new Intl.Segmenter(undefined,{granularity:'grapheme'})
function emittedCells(value:string):number {
 let width=0
 for(const {segment} of graphemes.segment(value)){
  const cp=segment.codePointAt(0)!
  if(/^[\p{M}\u200b-\u200f\u2060\ufeff]/u.test(segment))continue
  const wide=cp>=0x1100&&cp<=0x115f||cp>=0x2e80&&cp<=0xa4cf||cp>=0xac00&&cp<=0xd7a3||cp>=0xf900&&cp<=0xfaff||cp>=0xfe30&&cp<=0xfe4f||cp>=0xff00&&cp<=0xff60||cp>=0xffe0&&cp<=0xffe6
  width+=wide?2:1
 }
 return width
}
function emittedExtent(node:any):number {
 if(typeof node==='string'||typeof node==='number')return emittedCells(String(node))
 if(!node||typeof node!=='object')return 0
 if(Array.isArray(node))return node.reduce((sum,n)=>sum+emittedExtent(n),0)
 const p=node.props??{}
 if(p.display==='none')return 0
 const margins=Number(p.marginLeft??0)+Number(p.marginRight??0)
 if(node.type==='Text')return margins+emittedCells(text(node))
 if(node.type==='Button')return margins+emittedCells(p.label)+(p.plain?0:4)
 const children=(node.children??[]).filter((n:any)=>n!==null&&n!==undefined&&n!==false&&n?.props?.display!=='none')
 const widths=children.map(emittedExtent),column=String(p.flexDirection??'row').startsWith('column')
 return margins+2*Number(p.paddingX??0)+(column?Math.max(0,...widths):widths.reduce((sum:number,n:number)=>sum+n,0)+Math.max(0,widths.length-1)*Number(p.columnGap??p.gap??0))
}
function wholeNameFits(tree:any,name:string):boolean {
 const labels=nodes(tree).filter(n=>n.type==='Text'&&n.props?.bold&&text(n)===name)
 return labels.length===1&&emittedExtent(tree)<=24
}

test('W4 part3 terminal fixed-row oracle rejects an overflowing row and a clipped name',()=>{
 const name={type:'Text',props:{bold:true},children:['Coco']}
 const offering={type:'Box',props:{marginLeft:2},children:[{type:'Text',children:['▤ 100%']}]}
 // Coco is 4 cells where the old name was 11, so the button's longer label keeps the row at 25 cells for 24.
 const book={type:'Box',props:{marginLeft:1},children:[{type:'Button',props:{plain:true,label:'Bibliothèque'}}]}
 const row={type:'Box',props:{flexDirection:'row'},children:[name,offering,book]}
 expect(emittedCells('किताब')).toBe(3)
 expect(emittedCells('クロードさま')).toBe(12)
 expect(emittedExtent(row)).toBe(25)
 expect(wholeNameFits(row,'Coco')).toBe(false)
 expect(wholeNameFits({...row,children:[name,offering]},'Coco')).toBe(true)
 expect(wholeNameFits({...row,children:[{...name,children:['Co…']},offering]},'Coco')).toBe(false)
})

for(const {code:lang} of LANGS)for(const estimate of [false,true])test(`W4 part3 terminal24 ${lang} no-speech full offering estimate=${estimate} preserves whole name before whole widgets`,async($,on)=>{
 const view={...initialView(),lang,context:100,estimate,said:null,line:undefined,slip:null}
 const requestId='w4-terminal-fixed-row'
 on('ui.render',{component:'Pane',requestId},($,event)=>terminalBand($.ui.resolve(event) as any,view,{columns:24,maxRows:30,screenRows:48,isWorking:false}))
 world(on)
 const ui=await $.ui.mount({surface:'terminal',plugin:'coco',component:'Pane',requestId,props:{title:'W4 terminal fixed row',isFocused:true,bodyColumns:24,placement:'dock',scroll:{offset:0,bodyRows:30},view:{}}})
 const tree=await ui.drawn(),all=nodes(tree),words=WORDS[lang]
 expect(LANGS.length).toBe(13)
 expect(view.said).toBeNull()
 expect(view.line).toBeUndefined()
 expect(wholeNameFits(tree,words.name)).toBe(true)
 // The commit line (lane C, 10-14): a full window is five commits; on a row this tight its cells give way before the Book.
 const percent=percentText(100,lang,estimate),withCells='◉◉◉◉◉ '+percent
 const nameCells=emittedCells(words.name),shelfCells=1+emittedCells(words.marks.shelf)
 const offering=nameCells+2+emittedCells(withCells)+shelfCells<=24?withCells:percent
 const offeringNodes=all.filter(n=>n.type==='Text'&&[offering,offering+' '+words.context].includes(text(n)))
 const offeringFits=nameCells+2+emittedCells(offering)<=24
 expect(offeringNodes.length).toBe(offeringFits?1:0)
 expect(all.some(n=>n.type==='Text'&&text(n).startsWith('◉'))).toBe(offeringFits&&offering===withCells)
 const bookNodes=all.filter(n=>n.type==='Button'&&n.props?.key==='coco:book:open')
 const bookFits=nameCells+2+emittedCells(offering)+shelfCells<=24
 expect(bookNodes.length).toBe(bookFits?1:0)
 if(bookNodes.length){expect(bookNodes[0].props.label).toBe(words.marks.shelf);expect(bookNodes[0].props.plain).toBe(true)}
 expect(all.some(n=>n.type==='Text'&&text(n).trim()==='…')).toBe(false)
 expect(emittedExtent(tree)).toBeLessThanOrEqual(24)
 await ui.unmount()
})
