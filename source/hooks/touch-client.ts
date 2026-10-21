import type { ClientModule, ClientPointerEvent, UiMessageArgument, UiMessageResult } from 'claude-code'
// One pointer client since main's play (10-09): pat and poke are read in play-client.ts, which this re-exports.
import { TouchPath } from './play-client'
export { TouchPath }
export async function dispatchTouchMessage(e:UiMessageArgument,failed:boolean,touch:(kind:'poke'|'pat',requestId:string)=>Promise<void>,next:(e:UiMessageArgument)=>Promise<UiMessageResult>):Promise<UiMessageResult>{
 if(e.surface!=='terminal'||e.module!=='hooks/touch-client.ts'||failed)return next(e)
 const kind=e.data&&typeof e.data==='object'?(e.data as {t?:unknown}).t:undefined
 if(kind==='pat'||kind==='poke'){await touch(kind,e.requestId);return {}}
 return next(e)
}
type State={installed:boolean}
const client:ClientModule<{enabled:boolean},State>=(_props,surface)=>{const {Box}=surface.elements;if(!_props.enabled)return Box({});if(surface.state?.installed!==true){const path=new TouchPath();surface.onPointer(e=>{const kind=path.pointer(e,Date.now());if(kind)surface.post({t:kind})});surface.setState({installed:true})}return Box({width:surface.columns,height:surface.rows})}
export default client
