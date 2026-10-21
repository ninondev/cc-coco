#!/usr/bin/env python3
"""Exercise the actual register branch entry against owned metadata fixtures."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--plugin', type=Path, default=ROOT / 'plugin')
options = parser.parse_args()
source = (options.plugin / 'hooks/register.tsx').read_text()
start = source.index('function repositoryBranch(')
end = source.index('\nfunction syncNeighbours(', start)
entry = source[start:end]

with tempfile.TemporaryDirectory(prefix='s2-branch-security-', dir=os.environ['TMPDIR']) as folder:
    work = Path(folder).resolve()
    binary = work / 'companion-control'
    subprocess.run(['/usr/bin/xcrun', '--sdk', 'macosx', 'clang', '-std=c11', '-Wall', '-Wextra',
                    '-Werror', str(ROOT / 'plugin/bin/companion-control.c'), '-o', str(binary)], check=True)
    helper = work / 'helpers/bin'
    helper.mkdir(parents=True)
    (helper / 'companion-control').symlink_to(binary)
    script = work / 'branch.test.ts'
    script.write_text('''import {existsSync,readFileSync,mkdirSync,writeFileSync,symlinkSync} from 'node:fs'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {joinPath} from ''' + json.dumps(str(ROOT / 'plugin/hooks/paths.ts')) + '''
import {readRepositoryBranch} from ''' + json.dumps(str(ROOT / 'plugin/hooks/repository-branch.ts')) + '''
type Engine=any
const c3Branches=new Map<string,Promise<string|undefined>>()
''' + entry + '''
const base=''' + json.dumps(str(work)) + '''
const engine={plugin:{root:join(base,'helpers')},env:{get:async()=>undefined},fs:{
 exists:async(path:string)=>path.startsWith(base+'/')&&existsSync(path),
 read:async(path:string)=>{if(!path.startsWith(base+'/'))throw Error('outside fixture');return readFileSync(path,'utf8')}
},process:{run:async(argv:string[])=>{const r=spawnSync(argv[0],argv.slice(1),{encoding:'utf8'});return{exitCode:r.status,stdout:r.stdout??''}}}}
let checks=0,failed=0
async function check(name:string,cwd:string,want:string|undefined){checks++;const got=await repositoryBranch(engine,cwd);if(got!==want){failed++;console.error('FAIL '+name+' returned '+(got===undefined?'undefined':'a branch of '+got.length+' characters'))}else console.log('PASS '+name)}
function repo(name:string){const p=join(base,name);mkdirSync(join(p,'.git'),{recursive:true});return p}
let p=repo('ordinary');writeFileSync(join(p,'.git/HEAD'),'ref: refs/heads/feature/安全\\n');await check('ordinary refs/heads',p,'feature/安全')
p=repo('detached');writeFileSync(join(p,'.git/HEAD'),'detached fixture\\n');await check('detached HEAD refused',p,undefined)
const outside=join(base,'outside');mkdirSync(outside);writeFileSync(join(outside,'HEAD'),'ref: refs/heads/outside\\n')
p=repo('linked-head');symlinkSync(join(outside,'HEAD'),join(p,'.git/HEAD'));await check('linked HEAD refused',p,undefined)
p=repo('oversized');writeFileSync(join(p,'.git/HEAD'),'ref: refs/heads/'+'n'.repeat(100000));await check('oversized HEAD refused',p,undefined)
p=join(base,'external-pointer');mkdirSync(p);writeFileSync(join(p,'.git'),'gitdir: '+outside+'\\n');await check('unregistered external gitdir refused',p,undefined)
p=join(base,'registered');mkdirSync(p);const metadata=join(base,'main/.git/worktrees/s2');mkdirSync(metadata,{recursive:true});writeFileSync(join(metadata,'HEAD'),'ref: refs/heads/s2\\n');writeFileSync(join(metadata,'commondir'),'../..\\n');writeFileSync(join(metadata,'gitdir'),join(p,'.git')+'\\n');writeFileSync(join(p,'.git'),'gitdir: '+metadata+'\\n');await check('registered worktree backlink',p,'s2')
writeFileSync(join(metadata,'gitdir'),join(base,'different/.git')+'\\n');await check('different worktree backlink refused',p,undefined)
console.log('repository branch: '+checks+' checks, '+failed+' failed');process.exitCode=failed?1:0
''')
    raise SystemExit(subprocess.run(['bun', '--no-env-file', str(script)], cwd=work).returncode)
