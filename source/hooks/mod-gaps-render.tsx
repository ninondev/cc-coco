import type { Elements, RenderElement } from 'claude-code'
import type { VisibleLine } from './line-slot'
import { lineParts } from './line-slot'
import { BLANK_35, RUN_MARK, modIncenseSvg } from './mod-gaps-art'
import { gapWord } from './mod-gaps-words'
import { screenReaderLine, type GapLimit } from './mod-gaps'
import { planPx } from './typeset'

const NO_PRESS=()=>{}
type Common = Pick<Elements['terminal'],'Box'|'Text'|'Button'>
type Remote = Common & Pick<Elements['desktop'],'Svg'>
type Run = Common & Partial<Pick<Elements['desktop'],'Svg'>>
export function renderClose(elements:Remote,block:RenderElement,id:string,line:string,face:boolean):RenderElement {
 const {Box,Text,Svg}=elements
 return <Box flexDirection="column">{block}<Box key={'coco:close:'+id} flexDirection="row" marginTop={1}>
  <Svg source={BLANK_35} alt="" width={face?35:Math.round(planPx('✻ ',true))} height={1}/>
  <Box flexShrink={1} minWidth={0} {...(face?{marginLeft:1}:{})}><Text color="inactive" wrap="wrap">{line}</Text></Box>
 </Box></Box>
}
export function renderRunMark(elements:Run,block:RenderElement,id:string,outcome:'pass'|'fail',surface:string,lang:string,sr:boolean,cue:string):RenderElement {
 const {Box,Text,Svg}=elements
 const pass=outcome==='pass'
 return <Box flexDirection="column">{block}<Box key={'coco:run:'+id} flexDirection="row" columnGap={1} alignItems="center" {...(surface==='terminal'?{paddingLeft:5}:{})}>
  {sr?null:surface==='terminal'?<Text color={pass?cue:'inactive'}>{pass?'✿':'❀'}</Text>:Svg?<Svg source={RUN_MARK[outcome]} alt="" width={14} height={14}/>:null}
  <Text color="inactive">{gapWord(lang,pass?'run.passed':'run.failed')}</Text>
 </Box></Box>
}
export function renderTextBand(elements:Common,name:string,lang:string,line:VisibleLine|undefined):RenderElement {
 const {Box,Text,Button}=elements
 if(!screenReaderLine(line))return <Box/>
 return <Box flexDirection="row" flexWrap="wrap" columnGap={1}><Text wrap="wrap">{name}{lang==='zh'||lang==='zh-Hant'||lang==='ja'?'：':': '}{line!.text}</Text>
  {(line!.buttons??(line!.button?[line!.button]:[])).map(b=><Button key={b.key} label={b.label} onPress={NO_PRESS}/>)}
 </Box>
}
// The head's note keeps its words and slots; the engine's error row is untouched.
export function renderLimitNote(elements:Remote,limit:GapLimit,sr=false):RenderElement {
 const {Box,Text,Svg}=elements,{request}=limit
 const parts=lineParts(request.text,(request.slots??[]).map(slot=>slot.value))
 return <Box key="coco:limit:note" flexDirection="row" columnGap={1} alignItems="center" marginLeft={6}>
  {limit.out&&!sr?<Svg source={modIncenseSvg([{kind:limit.out,percentUsed:100}],false)} alt="" width={16} height={22}/>:null}
  <Text color="inactive" wrap="wrap">{parts.map((part,i)=>part.slot?<Text key={'limit-slot:'+i} bold>{part.text}</Text>:part.text)}</Text>
 </Box>
}
