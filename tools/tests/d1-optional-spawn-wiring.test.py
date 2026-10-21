#!/usr/bin/env python3
import ast,copy,hashlib,json,os,unittest
from pathlib import Path
ROOT=Path(os.environ.get('D1_OPTIONAL_SPAWN_ROOT',str(Path(__file__).resolve().parents[2])))
PINS={'d1-spawn-optional-type.test.tsx':'7039d77d55140b0cba8f446671686c66ea65f1c16a912dd548c5b98741f51423','d1-spawn-optional-description.test.tsx':'3b18fe2b04f586a6fad6930c7223d533a195ecf513d65fc9b7915473691e6fa0'}
GUARD='d1-optional-spawn-wiring.test.py'
def function(tree,name):return next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name==name)
def windows_selection(text):
 fn=function(ast.parse(text),'windows_roots')
 return ast.literal_eval(next(n.value for n in fn.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='selected' for t in n.targets)))
def mandatory_guard(text):
 main=function(ast.parse(text),'main')
 for n in ast.walk(main):
  if isinstance(n,ast.For) and isinstance(n.target,ast.Name) and n.target.id=='check' and isinstance(n.iter,(ast.Tuple,ast.List)) and GUARD in ast.literal_eval(n.iter):
   for call in ast.walk(n):
    if isinstance(call,ast.Call) and ast.unparse(call)=='d1_python_preflight(check)' and 'return checked' in ast.unparse(n):
     helper=function(ast.parse(text),'d1_python_preflight')
     return 'cpu_limit=30' in ast.unparse(helper) and 'env=isolated_env(folder)' in ast.unparse(helper)
 return False
def wiring_nodes(tree):
 windows=function(tree,'windows_roots');assigns=[n for n in windows.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='selected' for t in n.targets)]
 loops=[n for n in ast.walk(function(tree,'main')) if isinstance(n,ast.For) and isinstance(n.target,ast.Name) and n.target.id=='check' and isinstance(n.iter,ast.Tuple) and all(isinstance(e,ast.Constant) and isinstance(e.value,str) for e in n.iter.elts) and 'd1-presence-fixture-wiring.test.py' in ast.literal_eval(n.iter)]
 if len(assigns)!=1 or not isinstance(assigns[0].value,ast.Set) or len(loops)!=1:raise ValueError('Unique literal selected set and existing mandatory loop required')
 selected=assigns[0].value
 if not all(isinstance(e,ast.Constant) and isinstance(e.value,str) for e in selected.elts):raise ValueError('Literal Windows names required')
 return selected,loops[0].iter
def additive_rebase(text,add_tests=True,add_guard=True):
 tree=ast.parse(text);selected,mandatory=wiring_nodes(tree);old_names=[n.value for n in selected.elts];old_checks=[n.value for n in mandatory.elts]
 if len(set(old_names))!=len(old_names) or len(set(old_checks))!=len(old_checks):raise ValueError('Duplicate existing wiring names rejected')
 names=[n for n in PINS if n not in old_names] if add_tests else [];checks=[GUARD] if add_guard and GUARD not in old_checks else [];raw=text.encode();lines=raw.splitlines(keepends=True);edits=[]
 for node,values,opening in [(selected,names,b'{'),(mandatory,checks,b'(')]:
  if not values:continue
  start=sum(len(line) for line in lines[:node.lineno-1])+node.col_offset
  if raw[start:start+1]!=opening:raise ValueError('Literal delimiter byte location changed')
  edits.append((start+1,(', '.join(repr(v) for v in values)+', ').encode()))
 for at,payload in sorted(edits,reverse=True):raw=raw[:at]+payload+raw[at:]
 result=raw.decode();expected=copy.deepcopy(tree);expected_selected,expected_mandatory=wiring_nodes(expected);expected_selected.elts=[ast.Constant(value=n) for n in names]+expected_selected.elts;expected_mandatory.elts=[ast.Constant(value=n) for n in checks]+expected_mandatory.elts
 if ast.dump(ast.parse(result))!=ast.dump(expected):raise ValueError('Rebase changed AST beyond additive names')
 return result,{'addedWindowsNames':names,'addedMandatoryNames':checks,'existingWindowsNames':old_names,'existingMandatoryNames':old_checks,'preservedASTExceptAdditions':True,'edits':[{'byteOffset':at,'insert':payload.decode()} for at,payload in edits]}
def normal_copy_wired(text):
 main=function(ast.parse(text),'run_kit')
 return any(isinstance(n,ast.Call) and ast.unparse(n)=="shutil.copytree(tests, os.path.join(copy, 'tests'), ignore=skip_test_files(tests))" for n in ast.walk(main))
def normal_inventory(root,text):
 if not normal_copy_wired(text):return set()
 fn=function(ast.parse(text),'skip_test_files');namespace={'os':os};exec(compile(ast.Module(body=[fn],type_ignores=[]),'<existing skip_test_files>','exec'),namespace)
 tests=root/'tools/tests';ignore=namespace['skip_test_files'](str(tests));names=[p.name for p in tests.iterdir() if p.is_file() and p.name.endswith(('.test.ts','.test.tsx'))];ignored=set(ignore(str(tests),names))
 return set(names)-ignored
class Wiring(unittest.TestCase):
 def setUp(self):self.text=(ROOT/'tools/run-tests.py').read_text()
 def exact_fixture(self,name):
  p=ROOT/'tools/tests'/name;self.assertTrue(p.is_file(),name+' missing from permanent inventory');self.assertEqual(hashlib.sha256(p.read_bytes()).hexdigest(),PINS[name],name+' approved comparisons changed')
 def test_type_fixture_bytes(self):self.exact_fixture('d1-spawn-optional-type.test.tsx')
 def test_description_fixture_bytes(self):self.exact_fixture('d1-spawn-optional-description.test.tsx')
 def test_normal_inventory(self):self.assertTrue(set(PINS)<=normal_inventory(ROOT,self.text),'normal copy filter/inventory omits a qualified direct fixture')
 def test_windows_inventory(self):self.assertTrue(set(PINS)<=windows_selection(self.text),'representative Windows inventory omits a qualified direct fixture')
 def test_mandatory_preflight(self):self.assertTrue(mandatory_guard(self.text),'mandatory guarded preflight caller missing')
 def test_source_mutation_controls(self):
  selected=windows_selection(self.text);selected.update(PINS)
  tree=ast.parse(self.text);fn=function(tree,'windows_roots');node=next(n for n in fn.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='selected' for t in n.targets));node.value=ast.parse(repr(selected),mode='eval').body;candidate=ast.unparse(tree)
  self.assertTrue(set(PINS)<=windows_selection(candidate))
  for name in PINS:self.assertFalse(set(PINS)<=windows_selection(candidate.replace(repr(name)+',','').replace(', '+repr(name),'').replace('{'+repr(name)+'}','set()')))
  wired,_=additive_rebase(self.text,add_tests=False)
  self.assertTrue(mandatory_guard(wired));self.assertFalse(mandatory_guard(wired.replace("'d1-optional-spawn-wiring.test.py', ",'')))
  self.assertTrue(normal_copy_wired(self.text));self.assertFalse(normal_copy_wired(self.text.replace("shutil.copytree(tests, os.path.join(copy, 'tests'), ignore=skip_test_files(tests))","None")))
if __name__=='__main__':unittest.main(verbosity=2)
