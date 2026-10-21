import argparse,ast,hashlib,importlib.util,json,shutil,sys,tempfile,unittest
from pathlib import Path
sys.dont_write_bytecode=True
P=argparse.ArgumentParser();P.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[2]);ARGS,REST=P.parse_known_args();ROOT=ARGS.root
sys.path.insert(0,str(ROOT/'tools'))
from engine_preflight_contract import guarded_checks,relocate_after_claude,omit_guard
from hooks_source import hook_source
# M1 merge (10-09): d1-presence-lifecycle opts into Lively, since m1 starts shared presence only with a More row on.
# 10-15: d1-book-lifecycle's quiet minute starts with her sesame socks (lane C's first-compaction pair) already earned.
# 10-16: d1-book-lifecycle opens the quota page with /coco usage (one command; /coco offerings is gone).
# 10-19: d1-approved-promises loses its compaction stamp test (the achievements are gone, DECISIONS 1035).
PINS={'d1-store-read-fixture.ts': {'afterSHA256': '0857335ff8c62fb8bb8308f0c71351e037e59b7bb3030ddf44fe7cb1dda8e724', 'beforeSHA256': None}, 'd1-store-read-contract.test.tsx': {'afterSHA256': 'd7eb3e3d39c8ea28657097247e7331372e66ae303ae3a519e2ed8f5631cc27d6', 'beforeSHA256': None}, 'd1-owner-test-fixture.ts': {'afterSHA256': '26d2c72216ecefdb0d231578485da5c7b61539252a4a3beb20b4bbd57c5f87c5', 'beforeSHA256': None}, 'd1-owner-close-contract.test.tsx': {'afterSHA256': 'f7d9c2c155f5818a7bbeccc1d3f637bb80d9861d0b6f566fa444db48e60bed09', 'beforeSHA256': None}, 'd1-toast-observer-contract.test.tsx': {'afterSHA256': '9fcadc2f879a8b02ac63fdcf48c630957e932e8425fe145b85e25338ccb950be', 'beforeSHA256': None}, 'd1-owner-test-access.ts': {'afterSHA256': '9d238b2a61363ea2c1f5a5a0747e3420e0fed628820ee4c7fbf783ad45a162f0', 'beforeSHA256': None}, 'd1-approved-promises.test.tsx': {'afterSHA256': '9448969d9ffe7be7619262e5edae83b848b2bd6280ddef73151b0be205d32918', 'beforeSHA256': '77c81739e89a4cdc40357d66311d9eb5f065d084edaa5dffa159066da1bbdf9b'}, 'd1-notify-choice.test.tsx': {'afterSHA256': '620bb8cd2d8fe48796675420085296ac11690a02e4c7333a20292585fdcdc3bf', 'beforeSHA256': '009e0491210aaa03b6c2b5971c7a18a9588f896ce3cd2cd001fb0d23ed403a31'}, 'd1-book-lifecycle.test.tsx': {'afterSHA256': '34b4f0dfbccb91794eb676a947fc1dff12367b72eee257e2360f71306473b044', 'beforeSHA256': '98ef1314b5579fd1ccbb2f645e2ec01e0263e3ec9e73b49bf0d8f38796391042'}, 'd1-presence-lifecycle.test.tsx': {'afterSHA256': '3f897ff2975038b43d5c3ee3ff83113d19c6b6b7ddaa54caef2b7dc5db6ba984', 'beforeSHA256': '583e4335a4dea9b5c6f7398effd5abc1191ed0507c17ea185f385d627416b3ed'}, 'd1-invalidate-provider-contract.test.tsx': {'afterSHA256': 'f5fb44d4cf8747d85dbd91404e5b0be794b3dcd32f4e9e33e663976026bbf1cf', 'beforeSHA256': None}, 'd1-companion-request-owner-contract.test.tsx': {'afterSHA256': '04dc55ebd579724d0578d32d77ef3839142625983cafe04d5ecddf18c3b908a9', 'beforeSHA256': None}}
CONTRACTS=['d1-companion-request-owner-contract.test.tsx', 'd1-invalidate-provider-contract.test.tsx', 'd1-store-read-contract.test.tsx', 'd1-toast-observer-contract.test.tsx', 'd1-owner-close-contract.test.tsx']

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def runner():
 spec=importlib.util.spec_from_file_location('api_fixture_guarded_runner',ROOT/'tools/run-tests.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
class Wiring(unittest.TestCase):
 def test_fixture_bytes(self):
  for name,row in PINS.items():
   p=ROOT/'tools/tests'/name;self.assertTrue(p.is_file(),name);self.assertEqual(sha(p),row['afterSHA256'],name)
  owner=(ROOT/'tools/tests/d1-owner-test-access.ts').read_text();self.assertEqual(owner.count("on('ui.*',"),1);self.assertEqual(owner.count("on('ui.invalidate',"),0)
 def test_mandatory_call_after_preparation(self):
  raw=(ROOT/'tools/run-tests.py').read_text();tree=ast.parse(raw);main=next(x for x in tree.body if isinstance(x,ast.FunctionDef) and x.name=='main')
  calls=[x for x in ast.walk(main) if isinstance(x,ast.Call) and isinstance(x.func,ast.Name)];names=[x.func.id for x in calls];self.assertEqual(names.count('d1_fixture_access'),1)
  positions={x.func.id:x.lineno for x in calls};self.assertGreater(positions['d1_fixture_access'],positions['prepare_hooks']);self.assertGreater(positions['prepare_hooks'],positions['source_files'])
  self.assertIn('d1-api-fixture-wiring.test.py',guarded_checks(raw))
 def test_engine_boundary_omission_relocation_and_failure_mutants_are_rejected(self):
  source=(ROOT/'tools/run-tests.py').read_text()
  name='d1-api-fixture-wiring.test.py'
  omitted=omit_guard(source,name)
  self.assertNotEqual(source,omitted);self.assertNotIn(name,guarded_checks(omitted))
  for mutant in [relocate_after_claude(source),source.replace('checked = d1_python_preflight(check)','checked = 0',1),source.replace('if checked != 0:\n                return checked','if checked != 0:\n                return 0',1),source.replace('cpu_limit=30).returncode','cpu_limit=31).returncode',1)]:
   self.assertNotEqual(source,mutant)
   with self.assertRaises(ValueError):guarded_checks(mutant)
 def test_reviewed_lifecycle_pin_rejects_literal_stars_and_unrelated_contract_mutants(self):
  name='d1-book-lifecycle.test.tsx';source=(ROOT/'tools/tests'/name).read_text()
  for before,after in [("expect(source).not.toContain('*')","expect(source).toContain('*')"),("text:'*'+source+'*'","text:source"),("expect(after).toEqual(before)","expect(after).toEqual(after)")]:
   self.assertEqual(source.count(before),1)
   mutant=source.replace(before,after,1)
   self.assertNotEqual(hashlib.sha256(mutant.encode()).hexdigest(),PINS[name]['afterSHA256'])
 def test_windows_inventory(self):
  tree=ast.parse((ROOT/'tools/run-tests.py').read_text());f=next(x for x in tree.body if isinstance(x,ast.FunctionDef) and x.name=='windows_roots');sets=[ast.literal_eval(x.value) for x in ast.walk(f) if isinstance(x,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='selected' for t in x.targets)];self.assertEqual(len(sets),1)
  for n in CONTRACTS:self.assertIn(n,sets[0])
 def setup_copy(self,folder,modules):
  p=Path(folder);(p/'hooks').mkdir();(p/'tests').mkdir();(p/'hooks/hooks.json').write_text(json.dumps({'modules':modules,'guardSentinel':True}));shutil.copy2(ROOT/'tools/tests/d1-owner-test-access.ts',p/'tests/d1-owner-test-access.ts');shutil.copy2(hook_source(ROOT/'plugin/hooks/register.tsx'),p/'hooks/register.tsx');return p
 def test_source_and_bundle_wrapper(self):
  r=runner();self.assertTrue(callable(getattr(r,'d1_fixture_access',None)))
  for entry in ['register.tsx','hooks-bundle.js']:
   with tempfile.TemporaryDirectory() as folder:
    p=self.setup_copy(folder,['./'+entry]);raw=(p/'tests/d1-owner-test-access.ts').read_text()
    from d1_shared_register_fixture import prepare_shared_register,COMPANION_COMMAND,COMPANION_IMPORT
    prepare_shared_register(p);r.d1_fixture_access(p);self.assertEqual(json.loads((p/'hooks/hooks.json').read_text()),{'modules':['./d1-owner-test-access.ts'],'guardSentinel':True});expected=raw.replace(COMPANION_IMPORT,'',1).replace(COMPANION_COMMAND,'',1)
    self.assertEqual((p/'hooks/register.tsx').read_text().count(COMPANION_COMMAND),1);self.assertEqual(raw.count(COMPANION_COMMAND),1)
    self.assertNotIn('companionRequestText',expected)
    if entry=='hooks-bundle.js':expected=expected.replace("from './register'","from './hooks-bundle.js'")
    self.assertEqual((p/'hooks/d1-owner-test-access.ts').read_text(),expected);self.assertEqual(expected.count('return productionRegister(on,options)'),1)
 def test_bundle_without_shared_source_preparation_is_rejected(self):
  r=runner()
  with tempfile.TemporaryDirectory() as folder:
   p=self.setup_copy(folder,['./hooks-bundle.js']);before=(p/'hooks/hooks.json').read_bytes()
   with self.assertRaises(RuntimeError):r.d1_fixture_access(p)
   self.assertEqual((p/'hooks/hooks.json').read_bytes(),before);self.assertFalse((p/'hooks/d1-owner-test-access.ts').exists())
 def test_missing_template_rejected(self):
  r=runner();self.assertTrue(callable(getattr(r,'d1_fixture_access',None)))
  with tempfile.TemporaryDirectory() as folder:
   p=self.setup_copy(folder,['./register.tsx']);(p/'tests/d1-owner-test-access.ts').unlink()
   with self.assertRaises(FileNotFoundError):r.d1_fixture_access(p)
 def test_second_entry_rejected(self):
  r=runner();self.assertTrue(callable(getattr(r,'d1_fixture_access',None)))
  with tempfile.TemporaryDirectory() as folder:
   p=self.setup_copy(folder,['./register.tsx','./extra.ts']);before=(p/'hooks/hooks.json').read_bytes()
   with self.assertRaises(RuntimeError):r.d1_fixture_access(p)
   self.assertEqual((p/'hooks/hooks.json').read_bytes(),before);self.assertFalse((p/'hooks/d1-owner-test-access.ts').exists())
if __name__=='__main__':unittest.main(argv=[sys.argv[0],*REST])
