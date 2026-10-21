import {expect,test} from 'claude-code/testing'
import {createC3Runtime} from '../hooks/c3-runtime'
import {redactBookmark,displaySlot} from '../hooks/c3-secrets'
import type {C3LineRequest,C3Settings} from '../hooks/c3-runtime'

// Synthetic fixture strings only; no commands, filesystem, credentials or host APIs.
const key='sk-proj-'+ 'aB3dE5fG7hI9jK1lM3nP5qR7sT9uV1wX'
const pem='-----BEGIN PRIVATE KEY-----\nsynthetic-private-material\n-----END PRIVATE KEY-----'
function fixture(seed:Record<string,unknown>={}){
 const store={...seed},calls:string[][]=[],lines:C3LineRequest[]=[],notices:string[]=[]
 let now=1000
 const settings:C3Settings={guard:true,bookmark:true,notes:true,budget:'off',neighbours:false}
 const runtime=createC3Runtime({get:async k=>store[k],set:async(k,v)=>{store[k]=v},remove:async k=>{delete store[k]},
  process:async argv=>{calls.push(argv);return {exitCode:0,stdout:'',stderr:''}},
  executeAlgo:async request=>request.op==='guard'?{commitCwd:'/fixture',hit:{kind:'rm',reason:'recursive-delete',target:'bad\u202efile\u001b[31m'}}:null,
  now:()=>now,lang:()=> 'en',settings:()=>settings,localDay:()=> '2026-10-07',windowName:k=>k,
  emit:line=>{lines.push(line);return 'shown'},reaction:()=>{},notice:(_id,text)=>{if(text)notices.push(text)},
 })
 return {runtime,store,calls,lines,notices,clock:(at:number)=>{now=at}}
}

test('M1 S1 staged scan disables external diff textconv and fsmonitor without executing Git',async()=>{
 const h=fixture();await h.runtime.start({cwd:'/fixture',turns:1})
 await h.runtime.toolStart({id:'commit',name:'Bash',input:{command:'synthetic commit trigger'}})
 // Main's hardened argv (merged 10-09) keeps every m1 flag and adds hooks, pager, external diff and submodule guards.
 expect(h.calls).toEqual([['/usr/bin/git','--no-pager','--no-lazy-fetch','-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null','-c','core.pager=cat','-c','diff.external=','diff','--cached','--no-ext-diff','--no-textconv','--ignore-submodules=all','--unified=0']])
})

test('M1 S1 bookmark migration redacts stored fields before caps and persists the bounded result',async()=>{
 const bookmarks:Record<string,unknown>={}
 for(let i=0;i<65;i++)bookmarks['/old/'+i]={where:'old',kind:'todo',at:i}
 bookmarks['/fixture']={where:'x'.repeat(184)+' '+key,kind:'todo',at:100,note:'n'.repeat(385)+pem}
 const h=fixture({bookmarks});await h.runtime.start({cwd:'/fixture',turns:0})
 const stored=h.store.bookmarks as Record<string,any>
 expect(Object.keys(stored).length).toBe(64)
 expect(stored['/fixture'].where).toBe('x'.repeat(184)+' «…»')
 expect(stored['/fixture'].note).toBeUndefined()
 expect(Object.hasOwn(stored,'/old/0')).toBe(false)
 expect(h.lines[0]!.text.includes('sk-proj-')).toBe(false)
})

for(const writer of ['task','todo','file'] as const)test(`M1 S1 ${writer} bookmark writer redacts full input before truncation`,async()=>{
 const h=fixture();await h.runtime.start({cwd:'/fixture',turns:1})
 if(writer==='task')await h.runtime.task('x'.repeat(184)+' '+key)
 if(writer==='todo'){await h.runtime.toolStart({id:'todo',name:'TodoWrite',input:{todos:[{status:'in_progress',content:'x'.repeat(184)+' '+key}]}});await h.runtime.turnComplete({main:true,reason:'answer',contextPercent:0})}
 if(writer==='file'){await h.runtime.toolStart({id:'file',name:'Edit',input:{file_path:'/fixture/'+ 'x'.repeat(184)+' '+key}});await h.runtime.toolResult({id:'file',output:'',exitCode:0});await h.runtime.turnComplete({main:true,reason:'answer',contextPercent:0})}
 const stored=(h.store.bookmarks as Record<string,any>)['/fixture']
 expect(stored.where).toBe('x'.repeat(184)+' «…»')
 expect(JSON.stringify(stored).includes('sk-proj-')).toBe(false)
})

for(const writer of ['task'] as const)test(`M1 S1 ${writer} writer enforces 64-workspace retention and complete Unicode characters`,async()=>{
 const h=fixture()
 for(let i=0;i<66;i++){h.clock(1000+i);await h.runtime.start({cwd:'/fixture/'+i,turns:1});await h.runtime.task('𠮷'.repeat(201))}
 const rows=h.store.bookmarks as Record<string,any>
 expect(Object.keys(rows).length).toBe(64)
 expect(Object.hasOwn(rows,'/fixture/0')).toBe(false)
 expect(rows['/fixture/65'].where).toBe('𠮷'.repeat(200))
})

test('M1 S1 C3 controls and direction overrides are visible while joining marks survive',async()=>{
 const legitimate='فارسی\u200cعربی\u200d日本語 हिन्दी'
 expect(displaySlot(legitimate)).toBe(legitimate)
 expect(displaySlot('a\u0000\u001b\u0085\u202e\u2066z')).toBe('a\\u0000\\u001b\\u0085\\u202e\\u2066z')
 const h=fixture();await h.runtime.start({cwd:'/fixture',turns:1})
 await h.runtime.toolStart({id:'danger',name:'Bash',input:{command:'synthetic'}});await h.runtime.permission('danger','ask',true)
 // Main's untrusted display slots name each control (merged 10-09).
 expect(h.lines.at(-1)!.slots![0]!.value).toBe('bad⟨U+202E⟩file⟨U+001B⟩[31m')
 expect(h.notices[0]!.includes('bad⟨U+202E⟩file⟨U+001B⟩[31m')).toBe(true)
})

test('M1 S1 persistence covers the approved provider shapes and the existing staged scanner extra shapes',()=>{
 for(const value of [key,pem,'ASIA'+'A'.repeat(16),'glpat-'+'a'.repeat(24),'hf_'+'a'.repeat(24),'SG.'+'a'.repeat(18)+'.'+'b'.repeat(18),'ghp_'+'a'.repeat(36)])expect(redactBookmark('prefix '+value+' suffix')).toBe('prefix … suffix')
 expect(redactBookmark('password=AbCdEfGhIjKlMnOpQrStUvWx0123')).toBe('password=…')
 expect(redactBookmark('ordinary text فارسی 日本語 हिन्दी')).toBe('ordinary text فارسی 日本語 हिन्दी')
})
