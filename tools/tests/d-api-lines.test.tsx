import { expect, test } from 'claude-code/testing'
import { COMPANION_MIN_VERSION } from '../hooks/checkup'
import { world, settleLegacyStart } from './world'
import { M1_GAPS_TEXT } from './m1-more-data-fixture'
import { installGapWords } from '../hooks/mod-gaps-words'
// The direct-call tests below bypass the plugin's own on-demand load.
installGapWords(JSON.parse(M1_GAPS_TEXT))
import { baseHost, otherProvider, apiFailureKind } from '../hooks/api-lines'
import { keyShapeVerdict, doctorLines, MIN_ENGINE_VERSION, uninstallSteps, type UninstallPort } from '../hooks/coco-commands'
import { PLUGIN_VERSION } from '../hooks/plugin-version'

test('D the base URL is heard as its host only', () => {
  expect(baseHost('https://api.deepseek.com/anthropic')).toBe('api.deepseek.com')
  expect(baseHost('http://127.0.0.1:8080/x')).toBe('127.0.0.1')
  expect(baseHost('https://User@Example.com:8443/p?q=1')).toBe('example.com')
  expect(baseHost('not a url')).toBeUndefined()
  expect(baseHost('')).toBeUndefined()
  expect(otherProvider('https://api.deepseek.com/anthropic')).toBe(true)
  expect(otherProvider('https://api.anthropic.com')).toBe(false)
  expect(otherProvider(undefined)).toBe(false)
})

test('D api failure kinds match the measured shapes', () => {
  // 401: StopFailure's error word, or the status text (api-error-pty.sh, deepseek-wrong-key-1027.md).
  expect(apiFailureKind({ error: 'authentication_failed' })).toBe('api401')
  expect(apiFailureKind({ error: 'unknown', lastAssistantMessage: 'Please run /login · API Error: 401 Authentication Fails' })).toBe('api401')
  // 402: the status text or billing_error, never the 401 wording; real DeepSeek 402 is unverified.
  expect(apiFailureKind({ error: 'unknown', lastAssistantMessage: 'API Error: 402 Insufficient Balance' })).toBe('api402')
  expect(apiFailureKind({ error: 'billing_error' })).toBe('api402')
  expect(apiFailureKind({ error: 'rate_limit' })).toBeUndefined()
  expect(apiFailureKind({ error: 'overloaded' })).toBeUndefined()
})

test('D the key shape verdict names a shape, never a value', () => {
  expect(keyShapeVerdict(undefined)).toBe('missing')
  expect(keyShapeVerdict('')).toBe('missing')
  expect(keyShapeVerdict('sk-abcdefgh')).toBe('ok')
  expect(keyShapeVerdict('not-sk-but-long-enough')).toBe('ok')
  expect(keyShapeVerdict('sk-abc defgh')).toBe('shape')
  expect(keyShapeVerdict('sk-ab"cdefgh')).toBe('shape')
  expect(keyShapeVerdict("sk-ab'cdefgh")).toBe('shape')
  expect(keyShapeVerdict('short')).toBe('length')
  expect(keyShapeVerdict('x'.repeat(513))).toBe('length')
})


type FakeDoctor$ = Parameters<typeof doctorLines>[0]
type FakeCommand$ = Parameters<typeof uninstallSteps>[0]
function fakeDoctor$(input: { env?: Record<string, string>; settingsEnv?: Record<string, unknown>; files?: Record<string, string> } = {}): FakeDoctor$ {
  const files = input.files ?? {}
  const stat = async (path: string) => {
    if (files[path] === undefined) throw new Error('no file')
    return { kind: 'file', isLink: false, size: files[path]!.length }
  }
  return {
    env: { get: (name: string) => Promise.resolve((input.env ?? {})[name]) },
    fs: { exists: async () => false, list: async () => [], read: async (path: string) => { if (files[path] === undefined) throw new Error('no file'); return files[path]! }, stat },
    settings: { read: async () => input.settingsEnv ?? {} },
    session: { version: async () => ({ version: '2.1.304' }) },
    clock: { now: async () => 0 },
  } as unknown as FakeDoctor$
}
function fakeCommand$(input: { env?: Record<string, string> } = {}): FakeCommand$ {
  return {
    env: { get: (name: string) => Promise.resolve((input.env ?? {})[name]) },
    fs: { exists: async () => false, list: async () => [], read: async () => { throw new Error('no file') }, stat: async () => { throw new Error('no file') } },
    process: { run: async () => { throw new Error('no process') } },
  } as unknown as FakeCommand$
}

const START = { cwd: '/tmp/d-api-lines', isInteractive: true, surface: 'desktop' as const }

for (const [name, settings] of [
  ['present key', { env: { ANTHROPIC_AUTH_TOKEN: 'sk-fakefakefakefake' } }],
  ['missing key', {}],
  ['key with a space', { env: { ANTHROPIC_AUTH_TOKEN: 'sk-fake fake fake' } }],
] as const) test(`D doctor reports the key shape in memory only: ${name}`,async()=>{
  const lines=await doctorLines(fakeDoctor$({settingsEnv:settings as Record<string,unknown>,env:{HOME:'/tmp/d-api-home-not-there',ANTHROPIC_BASE_URL:'https://api.deepseek.com/anthropic'}}),{pluginVersion:PLUGIN_VERSION,engineVersion:'2.1.304',lang:'en',companionInstalled:false})
  expect(lines.some(line=>line.includes('Claude Code 2.1.304'))).toBe(true)
  expect(lines.some(line=>line.includes('api.deepseek.com'))).toBe(true)
  const keyLine=lines.find(line=>line.startsWith('key:'))
  expect(keyLine).toBeDefined()
  expect(String(keyLine)).not.toContain('sk-fake')
  if(name==='present key')expect(keyLine).toBe('key: present, shape looks right.')
  if(name==='missing key')expect(keyLine).toBe('key: not set in this Claude Code.')
  expect(lines.some(line=>line.includes('sk-fake'))).toBe(false)
  if(name==='key with a space')expect(keyLine).toBe('key: check it for spaces or quotes.')
})

test('D doctor says the update step for an old engine and names the provider host only',async()=>{
  const lines=await doctorLines(fakeDoctor$({env:{HOME:'/tmp/d-api-home-not-there',ANTHROPIC_BASE_URL:'https://api.deepseek.com/anthropic'}}),{pluginVersion:PLUGIN_VERSION,engineVersion:'2.1.100',lang:'en',companionInstalled:false})
  expect(lines.some(line=>line.includes('2.1.100')&&line.includes('2.1.299'))).toBe(true)
  expect(MIN_ENGINE_VERSION).toBe('2.1.299')
  const provider=lines.find(line=>line.includes('requests go to'))
  expect(provider).toBe('requests go to api.deepseek.com.')
  expect(lines.some(line=>line.includes('/anthropic'))).toBe(false)
})

test('D doctor skips the key line on Anthropic login without a token',async()=>{
  const lines=await doctorLines(fakeDoctor$({env:{HOME:'/tmp/d-api-home-not-there'}}),{pluginVersion:PLUGIN_VERSION,engineVersion:'2.1.304',lang:'en',companionInstalled:false})
  expect(lines.some(line=>line.startsWith('key:'))).toBe(false)
  expect(lines.some(line=>line.includes('api.anthropic.com'))).toBe(true)
})
test('D doctor names a DeepSeek key that does not start with sk-',async()=>{
  const lines=await doctorLines(fakeDoctor$({settingsEnv:{env:{ANTHROPIC_AUTH_TOKEN:'tok-without-prefix-long-enough'}},env:{HOME:'/tmp/d-api-home-not-there',ANTHROPIC_BASE_URL:'https://api.deepseek.com/anthropic'}}),{pluginVersion:PLUGIN_VERSION,engineVersion:'2.1.304',lang:'en',companionInstalled:false})
  expect(lines.find(line=>line.startsWith('key:'))).toBe('key: it does not start with sk-; DeepSeek keys do.')
})
test('D doctor keeps an unchanged pet current after a plugin-only update',async()=>{
  const lines=await doctorLines(fakeDoctor$({
    env:{HOME:'/tmp/d-api-home-not-there'},
    files:{'/tmp/d-api-home-not-there/Library/Application Support/Coco/companion.json':JSON.stringify({running:true,version:COMPANION_MIN_VERSION})},
  }),{pluginVersion:'9.0.0',engineVersion:'2.1.304',lang:'en',companionInstalled:true})
  expect(lines.some(line=>line.includes('/coco companion install'))).toBe(false)
})
test('D doctor says the engine update step and an old pet update step',async()=>{
  const lines=await doctorLines(fakeDoctor$({
    env:{HOME:'/tmp/d-api-home-not-there'},
    files:{'/tmp/d-api-home-not-there/Library/Application Support/Coco/companion.json':'{"running":true,"version":"0.9.0"}'},
  }),{pluginVersion:PLUGIN_VERSION,engineVersion:'2.1.100',lang:'en',companionInstalled:true})
  expect(lines.some(line=>line.includes('2.1.100')&&line.includes('claude update'))).toBe(true)
  expect(lines.some(line=>line.startsWith('pet 0.9.0, running.'))).toBe(true)
  expect(lines.some(line=>line.includes('0.9.0')&&line.includes('/coco companion install'))).toBe(true)
})
test('D the 401 StopFailure line corrects /login on another provider only',{timeoutMs:20000},async($,on)=>{
  on('classic.StopFailure',()=>({}))
  const w=world(on,{env:{LANG:'en_US.UTF-8',TERM:'xterm-256color',ANTHROPIC_BASE_URL:'https://api.deepseek.com/anthropic'}})
  await $.session.start(START);await settleLegacyStart($,w)
  await $.classic.StopFailure({error:'authentication_failed',last_assistant_message:'Please run /login · API Error: 401 Authentication Fails',cwd:START.cwd,session_id:'d-api'})
  await settleLegacyStart($,w)
  expect(w.view().line?.key).toBe('api401')
  expect(w.view().line?.text).toContain('/login')
})

for (const [name, env] of [
  ['anthropic endpoint', { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' }],
  ['no endpoint', {}],
] as const) test(`D no api line on Anthropic's own or an unset endpoint: ${name}`,{timeoutMs:20000},async($,on)=>{
  on('classic.StopFailure',()=>({}))
  const w=world(on,{env:{LANG:'en_US.UTF-8',TERM:'xterm-256color',...env}})
  await $.session.start(START);await settleLegacyStart($,w)
  await $.classic.StopFailure({error:'authentication_failed',last_assistant_message:'Please run /login · API Error: 401',cwd:START.cwd,session_id:'d-api'})
  await settleLegacyStart($,w)
  expect(w.view().line?.key?.startsWith('api40')).not.toBe(true)
})

test('D the 402 StopFailure line rides on the status text',{timeoutMs:20000},async($,on)=>{
  on('classic.StopFailure',()=>({}))
  const w=world(on,{env:{LANG:'en_US.UTF-8',TERM:'xterm-256color',ANTHROPIC_BASE_URL:'https://api.deepseek.com/anthropic'}})
  await $.session.start(START);await settleLegacyStart($,w)
  await $.classic.StopFailure({error:'unknown',last_assistant_message:'API Error: 402 Insufficient Balance',cwd:START.cwd,session_id:'d-api'})
  await settleLegacyStart($,w)
  expect(w.view().line?.key).toBe('api402')
  expect(w.view().line?.text).toContain('402')
})

test('D a subagent StopFailure draws no api line',{timeoutMs:20000},async($,on)=>{
  on('classic.StopFailure',()=>({}))
  const w=world(on,{env:{LANG:'en_US.UTF-8',TERM:'xterm-256color',ANTHROPIC_BASE_URL:'https://api.deepseek.com/anthropic'}})
  await $.session.start(START);await settleLegacyStart($,w)
  await $.classic.StopFailure({error:'authentication_failed',agent_id:'child',cwd:START.cwd,session_id:'d-api'})
  await settleLegacyStart($,w)
  expect(w.view().line?.key?.startsWith('api40')).not.toBe(true)
})

test('D uninstall maps each step to words and never touches the installer\'s files',async()=>{
  // review D-9: a file-level uninstall test. The fake fs records every access; the record
  // and .coco-bak backups under the throwaway home must stay untouched byte for byte, and
  // the argv list is exactly the pet, the icon and the talk-key steps.
  const files=new Map<string,string>([
    ['/home/.claude/coco-install.json','{"scopes":{"claude":{"added":[]}}}'],
    ['/home/.claude/settings.json.coco-bak-20260101T000000Z','{}'],
  ])
  const reads:string[]=[]
  const argvs:readonly string[][]=[]
  const $={
    env:{ get:(name:string)=>Promise.resolve(name==='HOME'?'/home':name==='CLAUDE_CONFIG_DIR'?undefined:undefined) },
    fs:{
      exists:async(path:string)=>{reads.push('exists:'+path);return false},
      list:async(path:string)=>{reads.push('list:'+path);return []},
      read:async(path:string)=>{reads.push('read:'+path);throw new Error('no file')},
      stat:async(path:string)=>{reads.push('stat:'+path);throw new Error('no file')},
    },
    process:{ run:async(argv:string[])=>{argvs.push(argv);throw new Error('no process')} },
  } as unknown as Parameters<typeof uninstallSteps>[0]
  const port:UninstallPort={root:'/plugin',pet:undefined,petInstalled:true,iconPlatform:'macos',run:async argv=>{
    argvs.push(argv)
    if(argv.includes('uninstall'))return{stdout:'Moved to the Trash: Coco Pet.app\nok',stderr:'',exitCode:0}
    if(argv.includes('clear'))return{stdout:'icon: stock',stderr:'',exitCode:0}
    return undefined
  }}
  const said=await uninstallSteps($,port,'en')
  expect(said.some(line=>line.startsWith('pet: put away'))).toBe(true)
  expect(said.some(line=>line.startsWith('app icon: back to stock'))).toBe(true)
  expect(said.some(line=>line.startsWith('saved chat key:'))).toBe(true)
  expect(said.at(-2)).toBe("the settings and backups the installer wrote stay where they are; the Mac installer app's Uninstall button takes them back.")
  // lead fix: install.sh and install.ps1 have no uninstall, so no line may send anyone there
  expect(said.some(line=>line.includes('install.sh'))).toBe(false)
  expect(said.at(-1)).toBe('last step, by hand: remove the plugin with /plugin.')
  // no plugin code path reads or writes the installer's files (D-1)
  expect(reads.filter(path=>path.includes('.claude')).length).toBe(0)
  // argv: the pet uninstall and the icon clear; talk-key's binary is absent from the fake
  // fs, so its step answers its none-word without spawning anything
  expect(argvs.length).toBe(2)
  expect(argvs[0]!.join(' ').includes('companion-macos.sh')).toBe(true)
  expect(argvs[0]!.includes('uninstall')).toBe(true)
  expect(argvs[1]!.join(' ').includes('icon-macos.sh')).toBe(true)
  expect(argvs[1]!.includes('clear')).toBe(true)
  expect(argvs.some(argv=>argv.some(part=>String(part).includes('coco-install.json')||String(part).includes('coco-bak')))).toBe(false)
  expect(files.get('/home/.claude/coco-install.json')).toBe('{"scopes":{"claude":{"added":[]}}}')
})
test('D uninstall skips the pet step when none is installed',async()=>{
  const argvs:readonly string[][]=[]
  const $={
    env:{ get:(_name:string)=>Promise.resolve(undefined) },
    fs:{ exists:async()=>false, list:async()=>[], read:async()=>{throw new Error('no file')}, stat:async()=>{throw new Error('no file')} },
    process:{ run:async(argv:string[])=>{argvs.push(argv);throw new Error('no process')} },
  } as unknown as Parameters<typeof uninstallSteps>[0]
  const port:UninstallPort={root:'/plugin',pet:undefined,petInstalled:false,iconPlatform:'macos',run:async argv=>{argvs.push(argv);return{stdout:'icon: stock',stderr:'',exitCode:0}}}
  const said=await uninstallSteps($,port,'en')
  expect(said.some(line=>line.startsWith('pet:'))).toBe(false)
  expect(argvs.some(argv=>argv.includes('uninstall'))).toBe(false)
})

test('D the Rust pet\'s own uninstall words map to the pet lines (lead fix: it says removed or kept, never ok)',async()=>{
  const $={
    env:{ get:(_name:string)=>Promise.resolve(undefined) },
    fs:{ exists:async()=>false, list:async()=>[], read:async()=>{throw new Error('no file')}, stat:async()=>{throw new Error('no file')} },
    process:{ run:async()=>{throw new Error('no process')} },
  } as unknown as Parameters<typeof uninstallSteps>[0]
  for(const [word,start] of [['removed','pet: put away'],['kept','pet: its uninstaller failed']] as const){
    const argvs:string[][]=[]
    const port:UninstallPort={root:'/plugin',pet:{program:'/pet/bin/coco-companion'},petInstalled:true,iconPlatform:undefined,run:async argv=>{argvs.push([...argv]);return{stdout:word+'\n',stderr:'',exitCode:0}}}
    const said=await uninstallSteps($,port,'en')
    expect(argvs[0]).toEqual(['/pet/bin/coco-companion','uninstall'])
    expect(said.some(line=>line.startsWith(start))).toBe(true)
  }
})
