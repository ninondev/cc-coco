import {expect,test} from 'claude-code/testing'
import {executeC3Algo} from '../hooks/algo-core.mjs'
import {createC3Runtime} from '../hooks/c3-runtime'
import {redactBookmark,redactSecrets,scanStagedSecrets} from '../hooks/c3-secrets'

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
// 1.1.4514.4: more provider prefixes, names that end a longer one, URL passwords and Basic sign-in.
const mixed=(n:number)=>Array.from({length:n},(_,i)=>'aB3dE7gH9kLmN2pQ5rStUvWx'[i%24]).join('')
test('more key shapes are masked and caught by the staged scan',()=>{
 const more=[
  'npm_'+'a'.repeat(36),'pypi-AgEIcHlwaS5vcmc'+'a'.repeat(48),'xapp-1-'+'A'.repeat(24),'xoxe-1-'+'a'.repeat(24),'xoxe.xoxp-1-'+'a'.repeat(24),
  'ya29.'+'a'.repeat(40),'dop_v1_'+'a1'.repeat(32),'xai-'+'a'.repeat(48),'gsk_'+'a'.repeat(48),'sk_test_'+'a'.repeat(24),'whsec_'+'a'.repeat(32),
  '123456789:AA'+'a'.repeat(33),'Basic '+btoa('synthetic:'+mixed(20)),
 ]
 for(const shape of more){
  const hidden=redactBookmark('prefix '+shape+' suffix')
  expect(hidden).toBe('prefix … suffix')
  expect(redactSecrets('prefix '+shape+' suffix')).toBe('prefix «…» suffix')
  expect(scanStagedSecrets('+++ b/synthetic.ts\n@@ -0,0 +1,1 @@\n+'+shape)?.file).toBe('synthetic.ts')
 }
 // The token inside a Telegram API path, where no word break stands before the digits.
 expect(redactSecrets('/bot123456789:AA'+'a'.repeat(33)+'/getMe')).toBe('/bot«…»/getMe')
})
test('a credential name that ends a longer name is masked with its name kept',()=>{
 const value=mixed(24)
 for(const name of ['DB_PASSWORD','MY_API_KEY','aws_secret_access_key','AccountKey','client-secret','GITHUB_AUTH_TOKEN','x-api-key']){
  expect(redactSecrets(name+'='+value)).toBe(name+'=«…»')
  expect(redactBookmark(name+': '+value)).toBe(name+': …')
  expect(scanStagedSecrets('+++ b/.env.example\n@@ -0,0 +1,1 @@\n+'+name+'='+value)).toEqual({file:'.env.example',line:1})
 }
 // A letter or digit right before the name still rules it out, as before.
 for(const text of ['keypassword='+value,'nextToken = parseExpressionStatement(input)','token = lexer.next()'])expect(redactSecrets(text)).toBe(text)
})
test('only the password of a URL is masked, and placeholders are left as written',()=>{
 const value=mixed(16)
 for(const [url,hidden] of [
  ['postgres://admin:'+value+'@db.example.com:5432/app','postgres://admin:«…»@db.example.com:5432/app'],
  ['mongodb+srv://app:p%40ss'+value+'@cluster0.example.net/db','mongodb+srv://app:«…»@cluster0.example.net/db'],
  ['https://ci:'+value+'@github.com/a/b.git','https://ci:«…»@github.com/a/b.git'],
  ['redis://:'+value+'@[::1]:6379','redis://:«…»@[::1]:6379'],
 ] as const){
  expect(redactSecrets(url)).toBe(hidden)
  expect(redactBookmark(url)).toBe(hidden.replace('«…»','…'))
  expect(scanStagedSecrets('+++ b/compose.yml\n@@ -0,0 +7,1 @@\n+'+url)).toEqual({file:'compose.yml',line:7})
 }
 for(const text of [
  'postgres://user:password@localhost:5432/app','postgres://app:${DB_PASSWORD}@db/app','mysql://root:$MYSQL_PWD@db','https://user:<password>@example.com',
  'redis://:%s@cache:6379','http://localhost:3000/@scope/pkg','git@github.com:ninondev/cc-coco.git','ssh://git@github.com:22/x.git','see https://example.com/a:b@c',
  'Basic internationalization of the app','Basic usage: run the installer','write to a@b.com at 10:30','1234567890:AAshort',
 ]){
  expect(redactSecrets(text)).toBe(text)
  expect(redactBookmark(text)).toBe(text)
  expect(scanStagedSecrets('+++ b/README.md\n@@ -0,0 +1,1 @@\n+'+text)).toBeUndefined()
 }
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

test('the worker bundle that scans staged diffs agrees with the source on every shape',()=>{
 const diffs=[
  '+++ b/.npmrc\n@@ -0,0 +3,1 @@\n+//registry.npmjs.org/:_authToken=npm_'+'a1B2'.repeat(9),
  '+++ b/.env\n@@ -0,0 +2,1 @@\n+DB_PASSWORD='+'aB3dE5gH7jK9mN1pQ3sT',
  '+++ b/compose.yml\n@@ -0,0 +7,1 @@\n+postgres://app:'+'s3cr3t'+'Pa55@db.internal:5432/app',
  '+++ b/README.md\n@@ -0,0 +1,1 @@\n+postgres://app:${DB_PASSWORD}@db.internal:5432/app',
  '+++ b/synthetic.ts\n@@ -0,0 +1,1 @@\n+'+jwt,
 ]
 for(const diff of diffs)expect(executeC3Algo({op:'secrets',diff})).toEqual(scanStagedSecrets(diff))
 expect(executeC3Algo({op:'secrets',diff:diffs[0]})).toEqual({file:'.npmrc',line:3})
 expect(executeC3Algo({op:'secrets',diff:diffs[3]})).toBeUndefined()
})
