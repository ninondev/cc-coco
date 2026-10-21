export const OWN_TRIM_ROOT='$HOME/Library/Application Support/Coco-presence'
export const SHIPPED_TRIM_WORKER='hooks/d1-trim-worker.mjs'
const commands=(source:string)=>source.split('\n').map(line=>line.trim()).filter(line=>line&&!line.startsWith('#'))
function need(condition:boolean,code:string):void{if(!condition)throw Error(code)}
export function guardTrimUninstallSource(caller:string,runner:string,worker:string):{root:string;logs:string;worker:string}{
 const entry='do_uninstall() {',start=caller.indexOf(entry)
 need(start>=0&&caller.indexOf(entry,start+entry.length)<0,'uninstall-function')
 const end=caller.indexOf('\n}',start+entry.length);need(end>=0,'uninstall-function-end')
 const body=commands(caller.slice(start+entry.length,end))
 const branch=[`_logs="${OWN_TRIM_ROOT}/logs"`,'if [ -f "$_logs/.owner" ]; then',"_trim_runtime=''",'if command -v node >/dev/null 2>&1; then _trim_runtime=node','elif command -v bun >/dev/null 2>&1; then _trim_runtime=bun','fi','[ -n "$_trim_runtime" ] || return 1',`_trim_reply=$("$_trim_runtime" "$PLUGIN/${SHIPPED_TRIM_WORKER}" --purge-root "${OWN_TRIM_ROOT}") || return 1`,"[ \"$_trim_reply\" = '{\"ok\":true}' ] || return 1",'fi']
 need(body[0]==='stop_it || true','stop-before-private-purge')
 need(branch.every((line,index)=>body[index+1]===line),'owned-purge-branch')
 need(body[branch.length+1]==='if [ -f "$AGENT" ]; then','purge-before-uninstall-cleanup')
 const setup=commands(caller)
 need(setup.includes('HERE=$(self_dir "$0")')&&setup.includes('PLUGIN=$(cd "$HERE/.." && pwd -P)'),'shipped-plugin-root')
 need(setup.includes('uninstall) do_uninstall ;;'),'uninstall-dispatch')
 need(worker.includes("if(args.length!==2||args[0]!=='--purge-root')throw Error('arguments');request={op:'purge',root:args[1]}"),'worker-purge-cli')
 need(worker.includes('if(args.length&&!result.ok)process.exitCode=1'),'worker-refusal-exit')
 need(runner.includes("copy = os.path.join(scratch, 'plugin')")&&runner.includes('shutil.copytree(plugin, copy, ignore=skip_engine_files(plugin))'),'copied-plugin-tree')
 const filter=runner.match(/def skip_engine_files\(plugin\):([\s\S]*?)\ndef skip_test_files/)
 need(!!filter,'copied-plugin-filter')
 // The exact existing exclusions cannot drop the hook directory or shipped worker.
 need(filter![1]!.includes("engine = {os.path.normpath(os.path.join(plugin, 'tsconfig.json')),\n              os.path.normpath(os.path.join(plugin, '.claude-plugin', 'types'))}")&&filter![1]!.includes("return [n for n in names if n in ('.DS_Store', '__pycache__') or os.path.normpath(os.path.join(folder, n)) in engine]"),'copied-worker-retained')
 return {root:OWN_TRIM_ROOT,logs:OWN_TRIM_ROOT+'/logs',worker:SHIPPED_TRIM_WORKER}
}
