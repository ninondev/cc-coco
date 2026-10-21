import {test,expect} from 'bun:test'
import {readFileSync,lstatSync} from 'node:fs'
import {resolve} from 'node:path'
import {guardTrimUninstallSource,OWN_TRIM_ROOT,SHIPPED_TRIM_WORKER} from './d1-trim-uninstall-source'
const root=resolve(import.meta.dir,'../../..'),caller=readFileSync(resolve(root,'plugin/bin/companion-macos.sh'),'utf8'),runner=readFileSync(resolve(root,'tools/run-tests.py'),'utf8'),workerPath=resolve(root,'plugin',SHIPPED_TRIM_WORKER),worker=readFileSync(workerPath,'utf8')
test('D1 uninstall caller source wires only its owned private logs to the shipped worker before cleanup',()=>{
 expect(lstatSync(workerPath).isFile()).toBe(true);expect(lstatSync(workerPath).isSymbolicLink()).toBe(false)
 expect(guardTrimUninstallSource(caller,runner,worker)).toEqual({root:OWN_TRIM_ROOT,logs:OWN_TRIM_ROOT+'/logs',worker:SHIPPED_TRIM_WORKER})
})
test('D1 uninstall caller source guard is mandatory in the test preflight before engine startup',()=>{
 expect(runner).toContain("os.path.join(ROOT, 'tools', 'tests', 'algo', 'd1-trim-uninstall-source.test.ts')")
 expect(runner).toContain('if uninstall_source.returncode != 0:')
 expect(runner.indexOf("'d1-trim-uninstall-source.test.ts'")).toBeLessThan(runner.indexOf('claude = find_claude(args.claude)'))
})
const edits:[string,string,string,'caller'|'runner'|'worker'][]=[
 ['deleted purge branch',caller.slice(caller.indexOf('  _logs='),caller.indexOf('  if [ -f "$AGENT" ]; then',caller.indexOf('do_uninstall() {'))),'','caller'],
 ['foreign logs root',OWN_TRIM_ROOT+'/logs','$HOME/Library/Application Support/Another-app/logs','caller'],
 ['foreign purge root','--purge-root "'+OWN_TRIM_ROOT+'"','--purge-root "$HOME/.claude"','caller'],
 ['foreign worker path','$PLUGIN/'+SHIPPED_TRIM_WORKER,'$HOME/.claude/d1-trim-worker.mjs','caller'],
 ['missing owned marker','if [ -f "$_logs/.owner" ]; then','if [ -d "$_logs" ]; then','caller'],
 ['missing node discovery','if command -v node >/dev/null 2>&1; then _trim_runtime=node','if true; then _trim_runtime=node','caller'],
 ['missing Bun fallback','elif command -v bun >/dev/null 2>&1; then _trim_runtime=bun','elif false; then _trim_runtime=bun','caller'],
 ['ignored missing interpreter','[ -n "$_trim_runtime" ] || return 1','[ -n "$_trim_runtime" ] || true','caller'],
 ['ignored failed worker','--purge-root "'+OWN_TRIM_ROOT+'") || return 1','--purge-root "'+OWN_TRIM_ROOT+'") || true','caller'],
 ['ignored refused purge',"[ \"$_trim_reply\" = '{\"ok\":true}' ] || return 1","[ \"$_trim_reply\" = '{\"ok\":true}' ] || true",'caller'],
 ['foreign plugin root','PLUGIN=$(cd "$HERE/.." && pwd -P)','PLUGIN="$HOME/.claude"','caller'],
 ['unwired uninstall dispatch','uninstall) do_uninstall ;;','uninstall) do_status ;;','caller'],
 ['uncopied plugin hooks','shutil.copytree(plugin, copy, ignore=skip_engine_files(plugin))','shutil.copytree(plugin, copy, ignore=lambda folder,names: ["hooks"])','runner'],
 ['excluded shipped worker',"n in ('.DS_Store', '__pycache__')","n in ('.DS_Store', '__pycache__', 'd1-trim-worker.mjs')",'runner'],
 ['missing worker purge CLI',"args[0]!=='--purge-root'","args[0]!=='--unsupported'",'worker'],
 ['missing worker failure exit','if(args.length&&!result.ok)process.exitCode=1','if(args.length&&!result.ok)process.exitCode=0','worker'],
]
for(const [name,old,replacement,target] of edits)test('D1 uninstall source mutation control rejects '+name,()=>{
 const input={caller,runner,worker};expect(old.length).toBeGreaterThan(0);expect(input[target]).toContain(old);input[target]=input[target].replace(old,replacement)
 expect(()=>guardTrimUninstallSource(input.caller,input.runner,input.worker)).toThrow()
})
