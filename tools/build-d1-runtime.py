#!/usr/bin/env python3
import argparse,hashlib,json,os,re,shutil,subprocess,tempfile
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
from hooks_source import hook_directory
ROOT=Path(__file__).resolve().parents[1]
# the exact TypeScript in Bun's cache under whoever runs it (X5: no one's home folder is written here)
TYPESCRIPT=Path(os.environ.get('COCO_TYPESCRIPT')or Path.home()/'.bun/install/cache/typescript@5.9.3@@@1/lib/typescript.js')
PLAN=json.loads((ROOT/'tools/d1-runtime-canonical.json').read_text())
H=hook_directory(ROOT/'plugin')
DYNAMIC=re.compile(r'\b(?:eval|require)\s*\(|\bimport\s*\(')
DRIVER=r'''import path from 'node:path';import fs from 'node:fs';
const [entry,out,compiler,inventory,redirects,expectedExports]=Bun.argv.slice(-6),allowed=new Set(JSON.parse(inventory)),redirect=JSON.parse(redirects),ts=await import(compiler).then(m=>m.default??m);
if(ts.version!=='5.9.3')throw Error('exact TypeScript5.9.3 required');
const loaded=new Set(),externals=new Set();
const result=await Bun.build({entrypoints:[entry],target:'browser',format:'esm',splitting:false,sourcemap:'none',minify:{whitespace:true,syntax:true,identifiers:true},plugins:[{name:'exact-canonical-d1',setup(build){
 build.onResolve({filter:/.*/},args=>{if(args.path===entry)return undefined;if(!args.path.startsWith('.'))throw Error('unexpected non-local runtime input '+args.path);if(args.path==='./paths'){externals.add('./d1-paths.js');return {path:'./d1-paths.js',external:true}}const resolved=path.resolve(path.dirname(args.importer),args.path),target=redirect[resolved];if(target){if(typeof target==='string')return {path:target};externals.add(target.path);return target}externals.add(args.path);return {path:args.path,external:true}});
 build.onLoad({filter:/.*/},args=>{if(!allowed.has(args.path))throw Error('unexpected canonical compiler input '+args.path);loaded.add(args.path);const text=fs.readFileSync(args.path,'utf8');const value=ts.transpileModule(text,{fileName:args.path,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.React,jsxFactory:'h',jsxFragmentFactory:'Fragment',importsNotUsedAsValues:ts.ImportsNotUsedAsValues.Remove}});if(value.diagnostics?.some(d=>d.category===ts.DiagnosticCategory.Error))throw Error('canonical transpile diagnostics');return {contents:value.outputText,loader:'js'}});
}}]});if(!result.success||result.outputs.length!==1)throw Error(result.logs.map(String).join('\n'));if(loaded.size!==allowed.size)throw Error('canonical input inventory was not fully loaded');
const raw=await result.outputs[0].text(),tree=ts.createSourceFile('runtime.js',raw,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);if(tree.parseDiagnostics.length)throw Error('invalid compiled syntax');
const actualImports=new Set(),exports=new Set();for(const statement of tree.statements){if(ts.isImportDeclaration(statement)){if(!ts.isStringLiteral(statement.moduleSpecifier))throw Error('non-static import');actualImports.add(statement.moduleSpecifier.text)}if(ts.isExportDeclaration(statement)&&statement.exportClause&&ts.isNamedExports(statement.exportClause))for(const element of statement.exportClause.elements)exports.add(element.name.text)}
if(JSON.stringify([...actualImports].sort())!==JSON.stringify([...externals].sort()))throw Error('compiled runtime changed actual external imports');
if(JSON.stringify([...exports].sort())!==JSON.stringify(JSON.parse(expectedExports).sort()))throw Error('compiled public value exports changed');
// Separate every real runtime import and statement so the unchanged source scanner sees each input.
const printer=ts.createPrinter({newLine:ts.NewLineKind.LineFeed});const body=tree.statements.map(statement=>ts.isImportDeclaration(statement)?printer.printNode(ts.EmitHint.Unspecified,statement,tree):statement.getText(tree)).join('\n')+'\n';
fs.writeFileSync(out,body);fs.writeFileSync(out+'.meta.json',JSON.stringify({typescriptVersion:ts.version,loaded:[...loaded].sort(),imports:[...actualImports].sort(),exports:[...exports].sort()}));'''

def build():
    bun=shutil.which('bun')
    if not bun or not TYPESCRIPT.is_file():raise RuntimeError('existing Bun and exact restored TypeScript required')
    originals={name:H/name for name in PLAN['values']}
    canon={name:path.with_name(path.stem+'.source'+path.suffix) for name,path in originals.items()}
    outputs={};metas={}
    def compile_unit(entry_path,inventory,redirect_table,names,label):
        for p in inventory:
            if DYNAMIC.search(p.read_text()):raise ValueError('dynamic code in '+str(p.name))
        digest=hashlib.sha256()
        for path in sorted(inventory):digest.update((('plugin/hooks/'+path.relative_to(H).as_posix())if path.is_relative_to(H)else path.relative_to(ROOT).as_posix()).encode()+b'\0'+path.read_bytes()+b'\0')
        digest.update(TYPESCRIPT.read_bytes());digest.update(Path(__file__).read_bytes())
        with tempfile.TemporaryDirectory(prefix='moe-d1-runtime-')as folder:
            out=Path(folder)/'runtime.js'
            done=subprocess.run([bun,'--no-env-file','-e',DRIVER,str(entry_path),str(out),str(TYPESCRIPT),json.dumps([str(p)for p in inventory]),json.dumps(redirect_table),json.dumps(names)],cwd=ROOT,capture_output=True,text=True,timeout=30)
            if done.returncode:raise RuntimeError(done.stdout+done.stderr)
            body=out.read_text();meta=json.loads(Path(str(out)+'.meta.json').read_text())
        if DYNAMIC.search(body):raise ValueError('dynamic code in generated output')
        metas[label]={**meta,'inputs':{(('plugin/hooks/'+p.relative_to(H).as_posix())if p.is_relative_to(H)else p.relative_to(ROOT).as_posix()):hashlib.sha256(p.read_bytes()).hexdigest()for p in inventory},'typescriptSHA256':hashlib.sha256(TYPESCRIPT.read_bytes()).hexdigest()}
        return '// Generated by tools/build-d1-runtime.py; input SHA256 '+digest.hexdigest()+'.\n'+body
    groups=PLAN['groups']
    grouped=[name for names in groups.values()for name in names]
    if len(grouped)!=len(set(grouped))or set(grouped)!=set(PLAN['values'])-{'paths.ts'}:raise ValueError('canonical group inventory changed')
    for label,names in groups.items():
        exports={}
        for name in names:
            for value in PLAN['values'][name]:
                if value not in exports or re.search(r'^export\s+(?:async\s+)?(?:function|class|const|let|enum)\s+'+re.escape(value)+r'\b',canon[name].read_text(),re.M):exports[value]=name
        entry=ROOT/'tools'/('d1-runtime-entry.ts'if label=='d1-state'else label+'-entry.ts')
        expected=''.join(f"export {{ {value} }} from '../plugin/hooks/{canon[name].stem}'\n"for value,name in sorted(exports.items()))
        if entry.read_text()!=expected:raise ValueError('canonical runtime entry changed: '+label)
        inventory=[entry,*[canon[name]for name in names]]
        redirects={}
        for name,path in originals.items():
            if name=='paths.ts':continue
            target=str(canon[name])if name in names else {'path':'./d1-state.js','external':True}
            for source in (path,path.with_suffix(''),canon[name].with_suffix(''),H/canon[name].stem,ROOT/'plugin/hooks'/canon[name].stem):redirects[str(source)]=target
        output=H/(label+'.js')
        outputs[output]=compile_unit(entry,inventory,redirects,list(exports),label)
        outputs[output.with_suffix('.d.ts')]=outputs[output].splitlines()[0]+'\n'+''.join(f"export {{ {value} }} from './{canon[name].stem}';\n"for value,name in sorted(exports.items()))
    for name in ('band','book','paths'):
        source=canon['paths.ts']if name=='paths'else H/(name+'.tsx');text=source.read_text()
        values=re.findall(r'^export\s+(?:async\s+)?(?:function|class|const|let|enum)\s+(\w+)',text,re.M)
        out=H/('d1-paths.js'if name=='paths'else name+'.js');outputs[out]=compile_unit(source,[source],{},values,name)
        outputs[out.with_suffix('.d.ts')]=outputs[out].splitlines()[0]+'\n'+f"export * from './{source.stem}';\n"
    art={f'hooks/d1-{kind}-art.json':(H/f'd1-{kind}-art.json').read_text()for kind in ('helpers','ribbon','shed','trim')}
    fixture=ROOT/'tools/tests/d1-art-fixture.ts'
    outputs[fixture]='// Generated by tools/build-d1-runtime.py from exact owned D1 art data.\nexport const D1_ART_FILES:Readonly<Record<string,string>>='+json.dumps(art,ensure_ascii=False,separators=(',',':'))+'\n'
    return outputs,metas

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');parser.add_argument('--receipt',type=Path);parser.add_argument('--plugin',type=Path);args=parser.parse_args()
    global H
    if args.plugin:H=hook_directory(args.plugin.resolve())
    try:
        outputs,metas=build()
        # With hooks-source canonical, the public runtime .js files are the hook graph's facades
        # (tools/build-hooks-graph.py), so every importer shares the one bundled instance.
        for path,text in outputs.items():
            if args.check:
                if not path.is_file()or path.read_text()!=text:raise ValueError(str(path.name)+' is stale')
            else:path.write_text(text)
        if args.receipt:args.receipt.write_text(json.dumps(metas,indent=2)+'\n')
    except (ValueError,RuntimeError,subprocess.SubprocessError)as e:print(str(e));return 1
    print(json.dumps({'canonicalModules':len(PLAN['values']),'outputBytes':{(('plugin/hooks/'+p.relative_to(H).as_posix())if p.is_relative_to(H)else p.relative_to(H.parent).as_posix()if p.is_relative_to(H.parent)else p.relative_to(ROOT).as_posix()):len(t.encode())for p,t in outputs.items()},'checked':args.check}));return 0
if __name__=='__main__':raise SystemExit(main())
