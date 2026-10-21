import { d1Art } from './d1-art-data'
import type {ElementTable} from 'claude-code'
import {d1Word} from './d1-words'
import {trimD1Path} from './d1-trim-path'
export type D1TrimRow={id:string;path:string;total:number;kept:number;markers:string[];markerLines?:number[];home?:string}
function countText(n:number,lang:string):string{try{return new Intl.NumberFormat(lang).format(n)}catch{return String(n)}}
export function renderD1TrimRow(ui:ElementTable,row:D1TrimRow,surface:string,lang:string,width=80){
 const {Box,Text,Button}=ui,Svg='Svg' in ui?ui.Svg:undefined
 const kept=d1Word(lang,'trim.kept',{kept:countText(row.kept,lang),total:countText(row.total,lang)})
 return <Box key={`coco:trim:row:${row.id}`} flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={1}>
  {surface==='terminal'||!Svg?null:<Svg source={d1Art('trim').fold} alt="" width={10} height={12}/>}
  <Text color="inactive" wrap="wrap">{kept}</Text>
  {surface==='mobile'||surface==='phone'?<Text color="inactive" wrap="wrap">{d1Word(lang,'trim.onComputer',{path:row.path})}</Text>:surface==='terminal'?<><Text color="inactive" wrap="wrap">{trimD1Path(row.path,row.home??'',width)}</Text><Button key={`coco:trim:copy:${row.id}`} label={d1Word(lang,'trim.copy')} onPress={()=>{}}/></>:<Button key={`coco:trim:open:${row.id}`} label={d1Word(lang,'trim.open')} onPress={()=>{}}/>}
 </Box>
}

export function renderD1TrimOutput(text:string,row:D1TrimRow,ui:Pick<ElementTable,'Text'>){
 const {Text}=ui
 const markers=new Set(row.markers),precise=row.markerLines?new Set(row.markerLines):undefined,lines=text.split('\n')
 return <Text wrap="wrap">{lines.map((line,i)=>{const content=line+(i<lines.length-1?'\n':'');return markers.has(line)&&(!precise||precise.has(i))?<Text color="inactive">{content}</Text>:content})}</Text>
}
