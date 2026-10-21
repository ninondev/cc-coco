import type { EngineInterface, Elements, RenderElement, RenderNode } from 'claude-code'
import { moreWord } from './more-words'
import { companionCommand } from './script-command'
export type ScriptPreview={key:string;argv:readonly string[];command:string;decision:'allow'|'ask'|'deny';source:string}
export {scriptArgv} from './script-argv'
import {scriptArgv} from './script-argv'
export function scriptButtons(tree:RenderNode):string[]{
 if(typeof tree==='string')return[]
 const own=tree.type==='Button'?[tree.props.key]:[]
 return[...own,...(('children' in tree?tree.children:undefined)??[]).flatMap(scriptButtons)]
}
export async function inspectScripts($:EngineInterface,tree:RenderElement,home:string|undefined,iconPlatform?:'macos'|'linux'):Promise<Map<string,ScriptPreview>>{
 const map=new Map<string,ScriptPreview>()
 for(const key of scriptButtons(tree)){
  const argv=scriptArgv(key,$.plugin.root,iconPlatform);if(!argv)continue
  const command=companionCommand(argv),verdict=await $.tool.check({tool:'Bash',input:{command}})
  const source=home?command.split(home).join('~'):command
  map.set(key,{key,argv,command,decision:verdict.decision,source})
 }
 return map
}
export function foldScripts(E:Elements[keyof Elements],tree:RenderElement,previews:ReadonlyMap<string,ScriptPreview>,expanded:ReadonlySet<string>,lang:string):RenderElement{
 const {Box,Text,Button,Code}=E,w=(key:string)=>moreWord(key,lang)
 const visit=(node:RenderNode):RenderNode=>{
  if(typeof node==='string')return node
  if(node.type==='Button'){
   const preview=previews.get(node.props.key)
   if(preview)return <Box flexDirection="column"><Box flexDirection="row" flexWrap="wrap" columnGap={1}>{preview.decision==='deny'?<Text>{String(node.props.label??'')}</Text>:node}<Button key={`coco:script:${node.props.key}`} label={w('script.what')} onPress={()=>{}}/></Box>{expanded.has(preview.key)?<Code source={preview.source} language="sh"/>:null}<Text color="inactive" wrap="wrap">{w(preview.decision==='deny'?'script.blocked':preview.decision==='ask'?'script.asks':'script.allowed')}</Text></Box>
  }
  if('children' in node&&node.children)return {...node,children:node.children.map(visit)} as RenderElement
  return node
 }
 return visit(tree) as RenderElement
}
