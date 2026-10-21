import {test,expect} from 'claude-code/testing'
import {AlwaysState,RunDurations,commandDigest,commandKey,nextCron,ownedLogPrune} from '../hooks/m1-always'

test('A6 durations retain the last 8 runs of 16 commands in 64 folders',()=>{
 const runs=new RunDurations()
 for(let folder=0;folder<65;folder++)for(let cmd=0;cmd<17;cmd++)for(let n=0;n<9;n++)runs.add(`folder-${folder}`,`command-${cmd}`,n)
 const rows=runs.snapshot()
 expect(Object.keys(rows).length).toBe(64)
 expect(rows['folder-0']).toBe(undefined)
 for(const row of Object.values(rows)){
  expect(Object.keys(row).length).toBe(16)
  expect(row[commandDigest('command-0')]).toBe(undefined)
  for(const key of Object.keys(row))expect(/^[a-f0-9]{64}$/.test(key)).toBe(true)
  for(const values of Object.values(row))expect(values).toEqual([1,2,3,4,5,6,7,8])
 }
})

test('A6 median starts at three measured runs and normalizes command whitespace',()=>{
 const runs=new RunDurations()
 expect(commandKey(' npm   test ')).toBe('npm test')
 runs.add('folder',' npm   test ',10);runs.add('folder','npm test',30)
 expect(runs.median('folder','npm test')).toBe(undefined)
 runs.add('folder','npm test',20)
 expect(runs.median('folder',' npm test ')).toBe(20)
 runs.add('folder','npm test',40)
 expect(runs.median('folder','npm test')).toBe(25)
 expect(runs.median('different-folder','npm test')).toBe(undefined)
 runs.add('folder','npm test',Number.NaN);runs.add('folder','npm test',-1)
 expect(runs.median('folder','npm test')).toBe(25)
 const detached=runs.snapshot();detached.folder![commandDigest('npm test')]!.push(500)
 expect(runs.median('folder','npm test')).toBe(25)
})

test('A6 the history keeps a digest of each command, never its text, and hashes a history stored as text',()=>{
 const runs=new RunDurations()
 runs.add('folder','cat <<EOF > secret-notes.txt',5)
 expect(JSON.stringify(runs.snapshot()).includes('secret')).toBe(false)
 expect(Object.keys(runs.snapshot().folder!)).toEqual([commandDigest('cat <<EOF > secret-notes.txt')])
 const old=new RunDurations()
 expect(old.restore({folder:{'npm  test':[10,20,30]}})).toBe(true)
 expect(JSON.stringify(old.snapshot()).includes('npm')).toBe(false)
 expect(old.median('folder','npm test')).toBe(20)
 expect(old.restore(old.snapshot())).toBe(false)
})

test('A6 restored histories remain bounded and preserve prototype-shaped keys safely',()=>{
 const input:Record<string,Record<string,number[]>>=Object.create(null)
 for(let folder=0;folder<65;folder++){
  const row:Record<string,number[]>=Object.create(null)
  for(let cmd=0;cmd<17;cmd++)row[`command-${cmd}`]=[-1,Number.NaN,...Array.from({length:10},(_,n)=>n)]
  input[`folder-${folder}`]=row
 }
 const runs=new RunDurations();expect(runs.restore(input)).toBe(true)
 expect(Object.keys(runs.snapshot()).length).toBe(64)
 for(const row of Object.values(runs.snapshot())){
  expect(Object.keys(row).length).toBe(16)
  for(const values of Object.values(row))expect(values).toEqual([2,3,4,5,6,7,8,9])
 }
 const prior=(Object.prototype as Record<string,unknown>)['fixture-command']
 for(const folder of ['__proto__','constructor','toString'])for(const cmd of ['__proto__','constructor','toString']){
  runs.add(folder,cmd,1);runs.add(folder,cmd,3);runs.add(folder,cmd,2)
  expect(runs.median(folder,cmd)).toBe(2)
 }
 expect((Object.prototype as Record<string,unknown>)['fixture-command']).toBe(prior)
 runs.restore(JSON.parse('{"__proto__":{"constructor":[1,2,3]}}'))
 expect(runs.median('__proto__','constructor')).toBe(2)
})

test('A7 next wake-up uses local time, cron steps, and the earlier of two schedules',()=>{
 const now=new Date(2026,9,6,12,0,30,0).getTime()
 expect(nextCron('5 12 * * *',now)).toBe(new Date(2026,9,6,12,5,0,0).getTime())
 expect(nextCron('*/15 * * * *',now)).toBe(new Date(2026,9,6,12,15,0,0).getTime())
 expect(nextCron('* * * * *',now)).toBe(new Date(2026,9,6,12,1,0,0).getTime())
 const state=new AlwaysState()
 state.crons([{id:'later',schedule:'5 12 * * *',prompt:'later'},
  {id:'earlier',schedule:'2 12 * * *',prompt:'earlier'}],now)
 expect(state.wake).toEqual({at:new Date(2026,9,6,12,2,0,0).getTime(),what:'earlier'})
 state.crons([],now);expect(state.wake).toBe(undefined)
})

test('A7 cron Sunday supports both zero and seven, ranges and invalid values',()=>{
 const before=new Date(2026,9,3,23,59,0,0).getTime()
 const sunday=new Date(2026,9,4,0,0,0,0).getTime()
 expect(nextCron('0 0 * * 0',before)).toBe(sunday)
 expect(nextCron('0 0 * * 7',before)).toBe(sunday)
 const now=new Date(2026,9,6,12,0,30,0).getTime()
 expect(nextCron('1-5/2 12 * * *',now)).toBe(new Date(2026,9,6,12,1,0,0).getTime())
 for(const schedule of ['invalid','60 * * * *','*/0 * * * *','* 24 * * *'])expect(nextCron(schedule,now)).toBe(undefined)
 expect(nextCron('* * * * *',Number.NaN)).toBe(undefined)
})

test('A8 helpers rebuild, retain the first 80 characters, and include classic starts',()=>{
 const state=new AlwaysState()
 state.helperStart('forked','fixture description')
 expect(state.helpers.get('forked')!.status).toBe('running')
 const message='x'.repeat(100)+'\nignored second line'
 state.helperStop('forked',message)
 expect(state.helpers.get('forked')!.result).toBe('x'.repeat(80))
 state.rebuildHelpers([{id:'reload',description:'reloaded helper',status:'running'}])
 expect(state.helpers.has('forked')).toBe(false)
 expect([...state.helpers.values()]).toEqual([{id:'reload',description:'reloaded helper',status:'running'}])
})

test('A18 prune retains newest 40 logs within 20 MiB and excludes every foreign path',()=>{
 const folder='/tmp/fixture-owned/logs'
 const rows=Array.from({length:60},(_,n)=>({path:folder+`/log-${n}`,size:100,at:n}))
 const removed=ownedLogPrune([...rows,{path:'/tmp/foreign/log',size:99,at:0},
  {path:folder+'/../foreign',size:99,at:0},{path:folder+'/nested/log',size:99,at:0}],folder)
 expect(removed).toEqual(Array.from({length:20},(_,n)=>folder+`/log-${19-n}`))
 const huge=Array.from({length:3},(_,n)=>({path:folder+`/large-${n}`,size:10*1024*1024,at:n}))
 expect(ownedLogPrune(huge,folder)).toEqual([folder+'/large-0'])
})

test('A18 Windows log paths retain the same budget and reject traversal and invalid metadata',()=>{
 const folder='C:\\Users\\fixture\\own\\logs'
 const rows=Array.from({length:41},(_,n)=>({path:folder+`\\log-${n}`,size:100,at:n}))
 expect(ownedLogPrune(rows,folder)).toEqual([folder+'\\log-0'])
 const rejected=[{path:folder+'\\..\\foreign',size:99,at:0},
  {path:'C:\\Users\\fixture\\foreign\\log',size:99,at:0},
  {path:folder+'\\bad-size',size:NaN,at:0},{path:folder+'\\negative',size:-1,at:0}]
 expect(ownedLogPrune(rejected,folder)).toEqual([])
})
