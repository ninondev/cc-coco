import type { CommandInfo, PromptComposeSection, EngineInterface } from 'claude-code'
export function composedVoiceSize(sections:readonly PromptComposeSection[]):number{return sections.filter(section=>section.id==='coco:voice').reduce((sum,section)=>sum+section.text.length,0)}
// A19: one figure, in tokens, for Settings and the first-meeting card. The voice section is
// English, about four characters a token.
export function voiceTokens(characters:number):number{return characters>0?Math.max(1,Math.round(characters/4)):0}
export function commandClashes(commands:readonly CommandInfo[]):'coco'[]{
 return (['coco'] as const).filter(name=>{const first=commands.find(command=>command.name===name);return first?.plugin!==undefined&&first.plugin!=='coco'})
}
type After=(ms:number,callback:()=>void)=>{cancel:()=>void}
export async function boundedHealth<T>(sleep:(ms:number)=>Promise<unknown>,read:()=>Promise<T>,matches:(health:T)=>boolean,after?:After):Promise<T|undefined>{
 let expired=false,timer:{cancel:()=>void}|undefined
 const deadline=after?new Promise<undefined>(resolve=>{timer=after(3000,()=>{expired=true;resolve(undefined)})}):undefined
 const poll=async()=>{for(let wait=0;wait<3000;wait+=250){await sleep(250);if(expired)return;const health=await read();if(expired)return;if(matches(health))return health}}
 try{return deadline?await Promise.race([poll(),deadline]):await poll()}finally{expired=true;timer?.cancel()}
}
// A24's Fix press waits at most three seconds on the host clock; only a press starts it.
export function fixHealthDeadline($:EngineInterface):After {return (ms,callback)=>$.clock.after(ms,callback)}
