import { expect, test } from 'claude-code/testing'
import type { ConfigDescribeInput } from 'claude-code'
import { CONFIG_WORDS, describeCocoConfig } from '../hooks/config-words'
import { WORDS } from '../hooks/words'
import type { Lang } from '../hooks/words'
import { world, settleLegacyStart, RECENT } from './world'

const input = (key:string):ConfigDescribeInput => ({key,label:'Original',description:'Original help',isHidden:false,provider:{kind:'plugin',plugin:'coco',tier:'inline'} as any})
test('B1c only its own two config rows relabel, resolvedLanguage stays hidden in every locale',()=>{
 expect(Object.keys(CONFIG_WORDS).sort()).toEqual(Object.keys(WORDS).sort())
 for(const lang of Object.keys(WORDS) as Lang[]) {
  for(const field of ['band','language'] as const) {
   const e=input(`coco.${field}`),result=describeCocoConfig(lang,e)
   expect(result).toEqual({...CONFIG_WORDS[lang][field],isHidden:false})
   expect(e.label).toBe('Original')
   expect(result.description.includes(field==='band'?'compact':'auto')).toBe(true)
  }
  expect(describeCocoConfig(lang,input('coco.resolvedLanguage'))).toEqual({label:'Original',description:'Original help',isHidden:true})
  expect(describeCocoConfig(lang,input('other.band'))).toEqual({label:'Original',description:'Original help',isHidden:false})
 }
})
test('B1c approved Chinese and Japanese config copy is exact',()=>{
 expect(CONFIG_WORDS.zh).toEqual({band:{label:'输入框上方的小克',description:'on：带画的横条；compact：只留一行；off：收起来，留一扇小门叫她回来。'},language:{label:'小克的语言',description:'auto：跟着 Claude Code 的语言设置，没设就跟系统。'}})
 expect(CONFIG_WORDS.ja).toEqual({band:{label:'入力欄の上のCoco',description:'on：絵つきの帯。compact：一行だけ。off：しまって、呼び戻す小さな扉だけ残します。'},language:{label:'Cocoの言葉',description:'auto：Claude Code の言語設定に合わせ、なければシステムの言語に。'}})
})

for(const lang of Object.keys(WORDS) as Lang[])test(`B1c engine describes its own config rows in ${lang}`,{options:{language:lang}},async($,on)=>{
 on('config.describe',($,e)=>({label:e.label,description:e.description,isHidden:e.isHidden}))
 const w=world(on,{store:RECENT})
 await $.session.start({cwd:'/tmp/b1c-config',surface:'desktop',isInteractive:true});await settleLegacyStart($,w)
 for(const field of ['band','language'] as const)
  expect(await $.config.describe(input(`coco.${field}`))).toEqual({...CONFIG_WORDS[lang][field],isHidden:false})
 const resolved={...input('coco.resolvedLanguage'),label:"Coco's resolved language",description:"Kept by Coco for a fast start. To change Coco's language, use the language row above."}
 expect(await $.config.describe(resolved)).toEqual({label:resolved.label,description:resolved.description,isHidden:true})
})

test('B1c auto language hydration invalidates cached config labels and exposes the resolved labels',async($,on)=>{
 on('config.describe',($,e)=>({label:e.label,description:e.description,isHidden:e.isHidden}))
 const events:unknown[]=[]
 on('ui.invalidate',($,e,next)=>{events.push(e);return next(e)})
 const w=world(on,{store:RECENT,settings:{language:'Japanese'}})
 await $.session.start({cwd:'/tmp/b1c-config-auto',surface:'desktop',isInteractive:true});await settleLegacyStart($,w)
 expect(w.view().lang).toBe('ja')
 expect(JSON.stringify(events)).toContain('config.describe')
 expect(await $.config.describe(input('coco.language'))).toEqual({...CONFIG_WORDS.ja.language,isHidden:false})
})
