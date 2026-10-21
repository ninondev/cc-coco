import {test,expect} from 'claude-code/testing'
import {world,SUMMARY} from './world'
for(const implemented of [false,true])test(`D1 SDK native compaction bottom boundary implementation ${implemented}`,async($,on)=>{
 world(on,{...(implemented?{}:{sessionCompact:false as const})})
 const result=await $.session.compact({trigger:'precompute',messages:[SUMMARY]}).then(value=>({value,error:undefined as unknown}),error=>({value:undefined,error}))
 if(implemented){expect(result.error).toBeUndefined();expect(result.value?.messages).toEqual([SUMMARY])}
 else{expect((result.error as Error)?.name).toBe('HooksError');expect((result.error as Error)?.message).toBe('no implementation for session.compact')}
})
