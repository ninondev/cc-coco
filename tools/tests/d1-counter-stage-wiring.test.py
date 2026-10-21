import argparse,ast,contextlib,importlib.util,io,json,sys,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
sys.dont_write_bytecode=True
parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[2]);parser.add_argument('--runner',type=Path);parser.add_argument('--counter-stage',type=Path);args,rest=parser.parse_known_args();ROOT=args.root;RUNNER=args.runner or ROOT/'tools/run-tests.py';STAGE=args.counter_stage or ROOT/'tools/d1_event_counter_stage.py'
sys.path.insert(0,str(ROOT/'tools'))
NATIVE={'d1-transcript-native-order.test.tsx','d1-helper-clear-retry.test.tsx','d1-owned-render-receipt.test.tsx'}
COUNTERS={'d1-compaction-timeline-counter.test.tsx','d1-compaction-blit-denial-counter.test.tsx','d1-compaction-raster-counter.test.tsx','d1-helper-event-counter.test.tsx','d1-lying-scroll-construction.test.tsx'}
def load(path,name):
 spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
class CounterStageWiring(unittest.TestCase):
 def test_windows_keeps_native_identity_clear_retry_and_owned_return_contracts(self):
  r=load(RUNNER,'owned_counter_windows_runner');r.ROOT=str(ROOT)
  with tempfile.TemporaryDirectory() as folder:
   copy=Path(folder);(copy/'tests').mkdir();(copy/'hooks').mkdir()
   for name in NATIVE|COUNTERS|{'unselected.test.tsx'}:(copy/'tests'/name).write_text('fixture-placeholder\n')
   with contextlib.redirect_stdout(io.StringIO()):r.windows_roots(str(copy),True)
   kept={p.name for p in (copy/'tests').glob('*.test.tsx')}
   self.assertTrue(NATIVE|COUNTERS<=kept,'Windows selector removes required native/helper/owned-return or terminal-cost fixtures: '+str(sorted((NATIVE|COUNTERS)-kept)))
   self.assertNotIn('unselected.test.tsx',kept)
 def test_actual_counter_dispatch_keeps_five_files_and_default_all_excludes_them(self):
  r=load(RUNNER,'owned_counter_dispatch_runner');stage=load(STAGE,'owned_counter_dispatch_stage');tree=ast.parse(RUNNER.read_text());main=next(node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='main')
  exclusions=[ast.literal_eval(node.value) for node in ast.walk(main) if isinstance(node,ast.Assign) and any(isinstance(target,ast.Name) and target.id=='counter_tests' for target in node.targets)]
  self.assertEqual(len(exclusions),1);self.assertEqual(exclusions[0],COUNTERS,'default all must exclude every source-instrumented counter fixture')
  for entry in ['register.tsx','hooks-bundle.js']:
   with self.subTest(entry=entry):self.assert_dispatch(r,stage,entry)
 def assert_dispatch(self,r,stage,entry):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);plugin=root/'input-plugin';tests=root/'input-tests';plugin.mkdir();tests.mkdir();(plugin/'hooks').mkdir();(plugin/'hooks/hooks.json').write_text(json.dumps({'modules':['./'+entry]}));(plugin/'hooks'/entry).write_text('fixture-placeholder\n')
   for name in COUNTERS|{'unselected.test.tsx'}:(tests/name).write_text('fixture-placeholder\n')
   observed={};calls=[]
   @contextlib.contextmanager
   def scratch(path,**options):yield path
   def serial(cli,copy,out,env,deadline):
    observed.update(files={p.name for p in (Path(copy)/'tests').glob('*.test.tsx')},deadline=deadline,cli=cli);return 17
   def prepare(copy,override,**options):
    calls.append(('entry',override));calls.append(('prepare',options));self.assertEqual(options,{'counters':True});self.assertEqual(calls[0],('freshness',plugin))
   def resolve(copy):
    self.assertIn(('prepare',{'counters':True}),calls);calls.append(('resolve',entry));return Path(copy)/'hooks'/entry
   def access(copy,**options):
    self.assertIn(('resolve',entry),calls);calls.append(('access',options))
   fake=SimpleNamespace(ROOT=str(ROOT),TIMEOUT=r.TIMEOUT,find_claude=lambda given:sys.executable,tempfile=SimpleNamespace(mkdtemp=lambda **options:str(root/'scratch')),register_scratch=scratch,skip_engine_files=lambda source:None,skip_test_files=lambda source:None,windows_roots=lambda *parameters:None,verify_shipping_bundle=lambda source:calls.append(('freshness',source)),prepare_hooks=prepare,hooks_entry=resolve,d1_fixture_access=access,run_serial=serial)
   for name in ['book_files','companion_target_files','companion_source','source_files','coco_band_data','card_metrics_data','review_texts','seed_runtime_motion']:setattr(fake,name,lambda copy:None)
   fake.engine_cpu_tests=lambda copy,names: calls.append(('cpu-guards',names))
   selected=SimpleNamespace(claude=sys.executable,plugin_source=str(plugin),tests_source=str(tests),windows_roots=False,hooks_entry=None)
   with contextlib.redirect_stdout(io.StringIO()):code=stage.run_d1_event_counters(fake,selected)
   self.assertIn(('cpu-guards',None),calls);self.assertEqual(code,17,'counter dispatch must propagate actual engine exit code');self.assertEqual(observed['files'],COUNTERS,'isolated stage must dispatch all five counter files');self.assertEqual(observed['deadline'],900);self.assertIn(('entry',None),calls);self.assertIn(('prepare',{'counters':True}),calls);self.assertEqual(calls[0],('freshness',plugin));self.assertIn(('access',{'counters':True}),calls)
if __name__=='__main__':unittest.main(argv=[sys.argv[0],*rest])
