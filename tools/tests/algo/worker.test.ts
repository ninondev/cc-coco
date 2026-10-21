import {test,expect} from 'bun:test'
import {spawn} from 'node:child_process'
import {executeC3Algo} from '../../c3-algo-core'
const root=new URL('../../../plugin/hooks/algo-worker.mjs',import.meta.url).pathname
function worker(interpreter:string,request:unknown):Promise<any>{
 return new Promise((resolve,reject)=>{
  const child=spawn(interpreter,[root],{stdio:['pipe','pipe','pipe']}),stdout:string[]=[]
  child.stdout.setEncoding('utf8');child.stdout.on('data',part=>stdout.push(part));child.on('error',reject)
  child.on('close',code=>{if(code!==0)return reject(new Error('worker exit '+code));resolve(JSON.parse(stdout.join('')))})
  child.stdin.end(JSON.stringify(request))
 })
}
test('worker guard follows design priority across quoted simple-command boundaries',()=>{
 const result:any=executeC3Algo({op:'guard',command:'echo "mkfs /dev/disk9"; git reset --hard; rm -rf /; dd if=/tmp/a of=/dev/disk2',context:{cwd:'/work/project',home:'/home/owner'}})
 expect(result.hit.kind).toBe('disk');expect(result.hit.target).toBe('/dev/disk2')
 expect((executeC3Algo({op:'guard',command:'echo "git commit"',context:{cwd:'/work/project',home:'/home/owner'}}) as any).commitCwd).toBeUndefined()
})
test('worker resolves git -C and a shell cd before a staged commit scan',()=>{
 const result:any=executeC3Algo({op:'guard',command:'cd ../another && git -C nested commit -m "done"',context:{cwd:'/work/project',home:'/home/owner'}})
 expect(result.commitCwd).toBe('/work/another/nested')
})
test('worker preserves actual classifier API results on full long commands',async()=>{
 const command='echo '+ 'safe content '.repeat(5000)+'; rm -rf /',request={op:'guard',command,context:{cwd:'/work/project',home:'/home/owner'}}
 for(const interpreter of ['node','bun']){const result=await worker(interpreter,request);expect(result.ok).toBe(true);expect(result.result.hit.kind).toBe('rm')}
})
test('worker secret result never contains raw token bytes',async()=>{
 const secret='sk-ant-api03-'+'x'.repeat(90),diff='+++ b/src/config.ts\n@@ -4,0 +5,1 @@\n+api_key="'+secret+'"\n'
 const result=await worker('node',{op:'secrets',diff});expect(result.result).toEqual({file:'src/config.ts',line:5});expect(JSON.stringify(result).includes(secret)).toBe(false)
})
