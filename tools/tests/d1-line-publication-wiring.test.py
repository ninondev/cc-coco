import argparse,ast,json
from pathlib import Path
CHECK='d1-line-publication-wiring.test.py'
def inspect(root):
 source=(root/'tools/run-tests.py').read_text();tree=ast.parse(source);main=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='main');boundaries=[n for n in main.body if isinstance(n,ast.If) and "stage in selected" in ast.unparse(n.test)];statements=boundaries[0].body+main.body if len(boundaries)==1 else main.body
 quiet=[(i,n) for i,n in enumerate(statements) if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='line_publication' for t in n.targets)]
 engine=[i for i,n in enumerate(statements) if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='claude' for t in n.targets)]
 def match():
  if len(quiet)!=1 or len(engine)!=1:return False
  i,n=quiet[0];call=n.value
  if not isinstance(call,ast.Call) or ast.unparse(call.func)!='d1_bun_preflight':return False
  if [ast.literal_eval(x) for x in call.args]!=['d1-line-publication.test.ts', 'd1-line-publication-quiet.test.ts'] or call.keywords:return False
  helper=next((n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='d1_bun_preflight'),None)
  if helper is None or 'env=isolated_env(folder)' not in ast.unparse(helper) or 'cpu_limit=30' not in ast.unparse(helper) or "'--no-env-file'" not in ast.unparse(helper):return False
  expected=ast.parse('if line_publication.returncode != 0:\n return line_publication.returncode').body[0]
  quiet_anchor=[j for j,node in enumerate(statements) if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='quiet_runtime'for t in node.targets)]
  return len(quiet_anchor)==1 and i==quiet_anchor[0]+2 and i+1<len(statements) and ast.dump(statements[i+1],include_attributes=False)==ast.dump(expected,include_attributes=False) and i<engine[0] and all((root/('tools/tests/algo/'+name)).is_file() for name in ('d1-line-publication.test.ts','d1-line-publication-quiet.test.ts'))
 hooks=[n for n in ast.walk(main) if isinstance(n,ast.For) and isinstance(n.target,ast.Name) and n.target.id=='check' and isinstance(n.iter,ast.Tuple)]
 mandatory=any(CHECK in [x.value for x in n.iter.elts if isinstance(x,ast.Constant)] and any(isinstance(x,ast.Call) and ast.unparse(x.func)=='d1_python_preflight' for x in ast.walk(n)) and any(isinstance(x,ast.Return) for x in ast.walk(n)) for n in hooks)
 flags={'line_publication_bun_case_is_mandatory_before_engine':match(),'line_publication_wiring_guard_is_mandatory':mandatory};return {'pass':sum(flags.values()),'fail':sum(not v for v in flags.values()),'checks':flags}
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[2]);a=p.parse_args();r=inspect(a.root);print(json.dumps(r));raise SystemExit(bool(r['fail']))
