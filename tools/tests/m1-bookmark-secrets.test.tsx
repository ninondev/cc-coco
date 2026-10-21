import {expect,test} from 'claude-code/testing'
import {createC3Runtime} from '../hooks/c3-runtime'
import {redactBookmark,scanStagedSecrets} from '../hooks/c3-secrets'

// Synthetic shapes, never credentials or filesystem inputs.
const jwt='eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.c3ludGhldGljLXNpZ25hdHVyZQ'
const shapes=[
 'Bearer synthetic-token_123.abc+/==',jwt,'eyJhbGciOiJub25lIn0.eyJzdWIiOiJzeW50aGV0aWMifQ.',
 'ASIA'+'A'.repeat(16),'sk-ant-admin01-'+'a'.repeat(24),
 'sk-proj-'+'a'.repeat(24),'ghp_'+'a'.repeat(36),'github_pat_'+'a'.repeat(24),
 'xoxb-'+'a'.repeat(24),'AIza'+'a'.repeat(35),'sk_live_'+'a'.repeat(24),
 'glpat-'+'a'.repeat(24),'hf_'+'a'.repeat(24),'SG.'+'a'.repeat(18)+'.'+'b'.repeat(18),
 '-----BEGIN PRIVATE KEY-----\nsynthetic-material\n-----END PRIVATE KEY-----',
]
function fixture(seed:Record<string,unknown>={}){
 const store={...seed},writes:unknown[]=[],settings={guard:false,bookmark:true,notes:false,budget:'off' as const,neighbours:false}
 const runtime=createC3Runtime({get:async key=>store[key],set:async(key,value)=>{store[key]=value;writes.push(value)},remove:async key=>{delete store[key]},
  process:async()=>{throw Error('No process belongs to bookmark persistence')},now:()=>1000,lang:()=> 'en',settings:()=>settings,localDay:()=> '2026-10-08',windowName:key=>key,emit:()=> 'shown',reaction:()=>{}})
 return {runtime,store,writes,settings}
}
test('M1 S9 shared guard and bookmark patterns cover bearer JWT and reviewed common key shapes',()=>{
 for(const shape of shapes){
  const hidden=redactBookmark('prefix '+shape+' suffix')
  expect(hidden).not.toContain(shape)
  expect(hidden).toContain('…')
  expect(scanStagedSecrets('+++ b/synthetic.ts\n@@ -0,0 +1,1 @@\n+'+shape)?.file).toBe('synthetic.ts')
 }
 for(const text of ['password=short','"api_key": "synthetic key"','access_token = "tiny"','secret: \'tiny\'','pwd=abc'])expect(redactBookmark(text)).toContain('…')
 expect(redactBookmark('password="synthetic\\\"key"')).toBe('password="…"')
 expect(redactBookmark('ordinary text 日本語 فارسی हिन्दी')).toBe('ordinary text 日本語 فارسی हिन्दी')
})
for(const writer of ['task','todo','file'] as const)test('M1 S9 '+writer+' masks every reviewed shape before truncating or storing',async()=>{
 for(const shape of shapes){
  const h=fixture();await h.runtime.start({cwd:'/synthetic',turns:1})
  const text='x'.repeat(184)+' '+shape
  if(writer==='task')await h.runtime.task(text)
  if(writer==='todo'){await h.runtime.toolStart({id:'todo',name:'TodoWrite',input:{todos:[{status:'in_progress',content:text}]}});await h.runtime.turnComplete({main:true,reason:'answer',contextPercent:0})}
  if(writer==='file'){await h.runtime.toolStart({id:'file',name:'Edit',input:{file_path:'/synthetic/'+text}});await h.runtime.toolResult({id:'file',output:'',exitCode:0});await h.runtime.turnComplete({main:true,reason:'answer',contextPercent:0})}
  const bookmark=(h.store.bookmarks as Record<string,any>)['/synthetic']
  expect(bookmark.where).toContain('…')
  expect([...bookmark.where].length).toBeLessThanOrEqual(200)
  expect(JSON.stringify(h.writes)).not.toContain(shape)
 }
})
test('M1 S9 first load migrates every bookmark field before display, drops the old A15 note and persists once',async()=>{
 const seed:Record<string,unknown>={}
 for(let i=0;i<shapes.length;i++)seed['/synthetic/'+i]={where:'x'.repeat(184)+' '+shapes[i],note:'n'.repeat(385)+' '+shapes[i],kind:'todo',at:i}
 const h=fixture({bookmarks:seed});await h.runtime.start({cwd:'/synthetic/0',turns:0})
 expect(h.writes.length).toBe(1)
 for(const bookmark of Object.values(h.store.bookmarks as Record<string,any>)){expect(bookmark.where).toContain('…');expect(bookmark.note).toBeUndefined();expect([...bookmark.where].length).toBeLessThanOrEqual(200)}
 for(const shape of shapes)expect(JSON.stringify(h.writes)).not.toContain(shape)
 await h.runtime.start({cwd:'/synthetic/0',turns:0});expect(h.writes.length).toBe(1)
})
test('M1 S9 disabled bookmark rows clear old data and never store new subjects or excerpts',async()=>{
 const h=fixture({bookmarks:{'/synthetic':{where:jwt,note:'password=short',kind:'todo',at:1}}});h.settings.bookmark=false
 await h.runtime.start({cwd:'/synthetic',turns:0});await h.runtime.task(jwt);await h.runtime.turnComplete({main:true,reason:'answer',contextPercent:0})
 expect(h.store.bookmarks).toBeUndefined();expect(h.writes.length).toBe(0)
})
