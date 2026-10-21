#!/usr/bin/env python3
"""Keep whole-constructor and startup regressions in both Engine inventories."""
import argparse,ast,sys,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools'))
from engine_preflight_contract import guarded_checks,relocate_after_claude,omit_guard
FILES={'d1-desktop-tree-contract.test.tsx','d1-world-c3-contract.test.tsx','d1-presence-c3-contract.test.tsx','d1-session-namespace-optout.test.tsx'}
def retained_names(source):
 function=next(n for n in ast.parse(source).body if isinstance(n,ast.FunctionDef) and n.name=='windows_roots')
 values=[ast.literal_eval(n.value) for n in ast.walk(function) if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='selected' for t in n.targets)]
 if len(values)!=1:raise ValueError('expected one Windows inventory')
 return values[0]
class Wiring(unittest.TestCase):
 def test_normal_contract_files_exist(self):
  for name in FILES:self.assertTrue((ROOT/'tools/tests'/name).is_file(),name)
 def test_windows_retains_every_contract_and_omission_is_detected(self):
  source=(ROOT/'tools/run-tests.py').read_text();selected=retained_names(source);self.assertTrue(FILES<=selected)
  for name in FILES:
   altered=source.replace(repr(name)+', ','',1)
   self.assertNotEqual(altered,source,name);self.assertFalse(FILES<=retained_names(altered),name)
 def test_mandatory_preflight_is_wired_before_engine(self):
  tree=ast.parse((ROOT/'tools/run-tests.py').read_text());main=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='main')
  source=(ROOT/'tools/run-tests.py').read_text()
  self.assertIn(Path(__file__).name,guarded_checks(source))
 def test_preflight_omission_and_relocation_are_detected(self):
  source=(ROOT/'tools/run-tests.py').read_text();name=Path(__file__).name
  omitted=omit_guard(source,name)
  self.assertNotEqual(source,omitted);self.assertNotIn(name,guarded_checks(omitted))
  with self.assertRaises(ValueError):guarded_checks(relocate_after_claude(source))
if __name__=='__main__':
 parser=argparse.ArgumentParser(add_help=False);parser.add_argument('--root',type=Path);options,remaining=parser.parse_known_args()
 if options.root:ROOT=options.root.resolve()
 unittest.main(argv=[sys.argv[0],*remaining])
