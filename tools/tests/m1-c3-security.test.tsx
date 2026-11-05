import {expect,test} from 'claude-code/testing'
import {createC3Runtime} from '../hooks/c3-runtime'
import {redactBookmark,displaySlot} from '../hooks/c3-secrets'
import type {C3LineRequest,C3Settings} from '../hooks/c3-runtime'

// Synthetic fixture strings only; no commands, filesystem, credentials or host APIs.
const key='sk-proj-'+ 'aB3dE5fG7hI9jK1lM3nP5qR7sT9uV1wX'
const pem='-----BEGIN PRIVATE KEY-----\nsynthetic-private-material\n-----END PRIVATE KEY-----'
function fixture(seed:Record<string,unknown>={}){
 const store={...seed},calls:string[][]=[],lines:C3LineRequest[]=[],notices:string[]=[],toasts:string[]=[]
 let now=1000
 const settings:C3Settings={guard:true,bookmark:true,notes:true,budget:'off',neighbours:false}
 const runtime=createC3Runtime({get:async k=>store[k],set:async(k,v)=>{store[k]=v},remove:async k=>{delete store[k]},
  process:async argv=>{calls.push(argv);return {exitCode:0,stdout:'',stderr:''}},
  executeAlgo:async request=>request.op==='guard'?{commitCwd:'/fixture',hit:{kind:'rm',reason:'recursive-delete',target:'bad\u202efile\u001b[31m'}}:null,
  now:()=>now,lang:()=> 'en',settings:()=>settings,localDay:()=> '2026-10-07',windowName:k=>k,
  emit:line=>{lines.push(line);return 'shown'},reaction:()=>{},notice:(_id,text)=>{if(text)notices.push(text)},toast:text=>{toasts.push(text)},
 })
 return {runtime,store,calls,lines,notices,toasts,clock:(at:number)=>{now=at}}
}
// later-18 / later-13: a push whose outgoing commits hold a key, and the same for a commit's
// staged diff. Synthetic strings only; the scan answers through the fixture, never real Git.
function secretFixture(diff:string){
 const made=fixture()
 const runtime=createC3Runtime({get:async k=>made.store[k],set:async(k,v)=>{made.store[k]=v},remove:async k=>{delete made.store[k]},
  process:async argv=>{made.calls.push(argv);return {exitCode:0,stdout:argv.includes('diff')?diff:'',stderr:''}},
  executeAlgo:async request=>request.op==='guard'?{commitCwd:argv0Commit(request)}:request.op==='secrets'?{file:'config.toml',line:3}:null,
  now:()=>1000,lang:()=> 'en',settings:()=>({guard:true,bookmark:false,notes:false,budget:'off',neighbours:false}),localDay:()=> '2026-10-07',windowName:k=>k,
  emit:line=>{made.lines.push(line);return 'shown'},reaction:()=>{},notice:(_id,text)=>{if(text)made.notices.push(text)},toast:text=>{made.toasts.push(text)},visible:()=>true,
 })
 return {...made,runtime}
}
function argv0Commit(request:Record<string,unknown>):string|undefined{
 const command=typeof request.command==='string'?request.command:''
 return /\bgit\b[^&|;]*\bcommit\b/.test(command)?'/fixture':undefined
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

test('M1 S1 a push reminder rides the commit scan finding, and no git call runs at push time',async()=>{
 const f=secretFixture('@@ -1,2 +1,3 @@\n+api_key = "'+'sk-proj-'+'aB3dE5fG7hI9jK1lM3nP5qR7sT9uV1wX"')
 await f.runtime.start({cwd:'/fixture',turns:1})
 // A commit first: its staged scan finds the secret.
 await f.runtime.toolStart({id:'c1',name:'Bash',input:{command:'git commit -m one'}})
 const gitCallsBeforePush=f.calls.length
 await f.runtime.toolResult({id:'c1',output:'',exitCode:0})
 expect(f.lines.some(line=>line.key==='guard.secretAfter')).toBe(true)
 // Then the push: the pre-approval notice speaks from the remembered finding...
 await f.runtime.toolStart({id:'push',name:'Bash',input:{command:'git push'}})
 expect(f.calls.length).toBe(gitCallsBeforePush)  // no git call at push time
 await f.runtime.permission('push','ask',true)
 expect(f.notices.some(text=>text.includes('config.toml'))).toBe(true)
 await f.runtime.permission('push','resolved')
 await f.runtime.toolResult({id:'push',output:'',exitCode:0})
 expect(f.lines.some(line=>line.key==='guard.secretPush'&&line.text.includes('config.toml')&&Array.isArray(line.slots)&&line.slots.some((slot:{value:string;kind:string})=>slot.kind==='path'&&slot.value==='config.toml'))).toBe(true)
 expect(f.lines.some(line=>line.key==='guard.secretPush'&&JSON.stringify(line).includes('sk-proj-'))).toBe(false)
 // A second push with no commit in between says nothing: the finding went out with the first.
 await f.runtime.toolStart({id:'push2',name:'Bash',input:{command:'git push'}})
 await f.runtime.toolResult({id:'push2',output:'',exitCode:0})
 const said=f.lines.filter(line=>line.key==='guard.secretPush'&&!line.callId).length
 expect(said).toBe(1)
})

test('M1 S1 a commit that passed with a staged secret says its line and now raises the toast too',async()=>{
 const f=secretFixture('@@ -1,2 +1,3 @@\n+token = "'+'sk-proj-'+'aB3dE5fG7hI9jK1lM3nP5qR7sT9uV1wX"')
 await f.runtime.start({cwd:'/fixture',turns:1})
 await f.runtime.toolStart({id:'commit',name:'Bash',input:{command:'git commit -m x'}})
 expect(f.calls.some(argv=>argv.includes('--cached'))).toBe(true)
 await f.runtime.toolResult({id:'commit',output:'',exitCode:0})
 expect(f.lines.some(line=>line.key==='guard.secretAfter')).toBe(true)
 // The band is up in this fixture, so the toast speaks with the line's own cleaned text.
 expect(f.toasts.some(text=>text.includes('config.toml')&&text.includes('3'))).toBe(true)
 expect(f.toasts.some(text=>text===f.lines.find(line=>line.key==='guard.secretAfter')!.text)).toBe(true)
})

test('later-19 the TODO pile counts only markers Claude edits add, once past the threshold',async()=>{
 const f=secretFixture('')
 await f.runtime.start({cwd:'/fixture',turns:1})
 // The row's choices are off, 5, 10 and 20.
 f.runtime.setTodoPileThreshold(5)
 // An edit that adds two markers and drops one: net one on the pile.
 await f.runtime.toolStart({id:'e1',name:'Edit',input:{file_path:'/fixture/a.ts',old_string:'// TODO fix me',new_string:'// TODO one\n// FIXME two\nconst x = 1'}})
 await f.runtime.toolResult({id:'e1',output:'',exitCode:0})
 // A write of a fresh file with two more: three on the pile, still quiet.
 await f.runtime.toolStart({id:'e2',name:'Write',input:{file_path:'/fixture/b.ts',content:'// TODO three\n// FIXME four\n'}})
 await f.runtime.toolResult({id:'e2',output:'',exitCode:0})
 expect(f.lines.some(line=>line.key==='todoPile.line')).toBe(false)
 // Two more cross the threshold; the line says its count.
 await f.runtime.toolStart({id:'e3',name:'Edit',input:{file_path:'/fixture/a.ts',old_string:'',new_string:'// TODO five\n// FIXME six'}})
 await f.runtime.toolResult({id:'e3',output:'',exitCode:0})
 expect(f.lines.some(line=>line.key==='todoPile.line'&&line.text.includes('5'))).toBe(true)
 const said=f.lines.filter(line=>line.key==='todoPile.line').length
 expect(said).toBe(1)
 // More edits never say it twice.
 await f.runtime.toolStart({id:'e4',name:'Edit',input:{file_path:'/fixture/a.ts',old_string:'',new_string:'// TODO seven'}})
 await f.runtime.toolResult({id:'e4',output:'',exitCode:0})
 expect(f.lines.filter(line=>line.key==='todoPile.line').length).toBe(said)
 // Nothing scanned the disk: no process call ever ran for the pile.
 expect(f.calls.length).toBe(0)
 // Turning the threshold off re-arms it, and turning it back on says it again at the next marker.
 f.runtime.setTodoPileThreshold(0)
 await f.runtime.toolStart({id:'e5',name:'Edit',input:{file_path:'/fixture/a.ts',old_string:'',new_string:'// TODO eight'}})
 await f.runtime.toolResult({id:'e5',output:'',exitCode:0})
 expect(f.lines.filter(line=>line.key==='todoPile.line').length).toBe(said)
 f.runtime.setTodoPileThreshold(5)
 await f.runtime.toolStart({id:'e6',name:'Edit',input:{file_path:'/fixture/a.ts',old_string:'',new_string:'// TODO nine'}})
 await f.runtime.toolResult({id:'e6',output:'',exitCode:0})
 expect(f.lines.filter(line=>line.key==='todoPile.line').length).toBe(said+1)
})

test('later-21 a one or two letter in-word fix pleases her; bigger edits stay quiet',async()=>{
 const lines:any[]=[]
 const runtime=createC3Runtime({get:async()=>undefined,set:async()=>{},remove:async()=>{},
  process:async()=>({exitCode:0,stdout:'',stderr:''}),executeAlgo:async()=>null,
  now:()=>1000,lang:()=>'en',settings:()=>({guard:true,bookmark:false,notes:true,budget:'off',neighbours:false}),localDay:()=>'2026-10-07',windowName:k=>k,
  emit:line=>{lines.push(line);return 'shown'},reaction:()=>{},notice:()=>{},toast:()=>{}})
 await runtime.start({cwd:'/fixture',turns:1})
 await runtime.toolStart({id:'t1',name:'Edit',input:{file_path:'/fixture/a.ts',old_string:'const recieved = 1',new_string:'const received = 1'}})
 await runtime.toolResult({id:'t1',output:'',exitCode:0})
 expect(lines.some(line=>line.key==='typo.fixed')).toBe(true)
 // Two letters inside one word still count.
 lines.length=0
 await runtime.toolStart({id:'t2',name:'Edit',input:{file_path:'/fixture/a.ts',old_string:'recieve it',new_string:'receive it'}})
 await runtime.toolResult({id:'t2',output:'',exitCode:0})
 expect(lines.some(line=>line.key==='typo.fixed')).toBe(true)
 // Three letters, a whole-word swap, a length change and a pure append are not typo fixes.
 for(const [oldText,newText] of [['recievedd it','receivved it'],['the value','a value'],['fix','fix this'],['word','word!']] as [string,string][])
  {lines.length=0;await runtime.toolStart({id:'t'+oldText.length,name:'Edit',input:{file_path:'/fixture/a.ts',old_string:oldText,new_string:newText}});await runtime.toolResult({id:'t'+oldText.length,output:'',exitCode:0});expect(lines.some(line=>line.key==='typo.fixed')).toBe(false)}
 // A letter at a word's edge is not "inside a word"; digits and colour hex are code, not typos.
 for(const [oldText,newText] of [['cat','car'],['if (i<n)','if (i>n)'],['12345','12045'],['width: 100px','width: 120px'],['#ff0000','#ff00f0']] as [string,string][])
  {lines.length=0;await runtime.toolStart({id:'e'+oldText.length,name:'Edit',input:{file_path:'/fixture/a.ts',old_string:oldText,new_string:newText}});await runtime.toolResult({id:'e'+oldText.length,output:'',exitCode:0});expect(lines.some(line=>line.key==='typo.fixed')).toBe(false)}
 // A denied edit pleases nobody and grows nothing.
 lines.length=0
 await runtime.toolStart({id:'t10',name:'Edit',input:{file_path:'/fixture/a.ts',old_string:'recieved',new_string:'received'}})
 await runtime.toolResult({id:'t10',output:'',exitCode:1,denied:true})
 expect(lines.some(line=>line.key==='typo.fixed')).toBe(false)
})

test('M1 S1 a TodoWrite input with foreign fields never breaks the todo bookmark',async()=>{
 const f=fixture()
 await f.runtime.start({cwd:'/fixture',turns:1})
 // `rows` here is a real engine field on other tools; TodoWrite must ignore anything but todos.
 await f.runtime.toolStart({id:'tw1',name:'TodoWrite',input:{todos:[{status:'in_progress',content:'write the line'}],rows:'not-a-list' as never}})
 await f.runtime.turnComplete({main:true,reason:'answer',contextPercent:0})
 const stored=f.store.bookmarks as Record<string,any>
 expect(stored['/fixture'].where).toBe('write the line')
})
