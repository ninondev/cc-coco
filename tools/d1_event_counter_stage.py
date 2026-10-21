import json,os,shutil,sys
from pathlib import Path

def run_d1_event_counters(r,args):
 selected={'d1-compaction-blit-denial-counter.test.tsx','d1-compaction-raster-counter.test.tsx','d1-compaction-timeline-counter.test.tsx','d1-lying-scroll-construction.test.tsx','d1-helper-event-counter.test.tsx'}
 cli=r.find_claude(args.claude)
 if not cli:sys.stderr.write('D1 event-counter stage: existing Claude CLI missing\n');return 2
 plugin=Path(args.plugin_source or Path(r.ROOT)/'plugin');source_tests=Path(args.tests_source or Path(r.ROOT)/'tools/tests')
 for path in [plugin,source_tests]:
  if not path.is_dir():sys.stderr.write('D1 event-counter stage: required folder missing: '+str(path)+'\n');return 2
 r.verify_shipping_bundle(plugin)
 with r.register_scratch(r.tempfile.mkdtemp(prefix='moe-d1-event-counters-',dir=os.getenv('TMPDIR')),defer_signals=True) as scratch:
  copy=Path(scratch)/'plugin';tests=copy/'tests'
  shutil.copytree(plugin,copy,ignore=r.skip_engine_files(str(plugin)))
  shutil.copytree(source_tests,tests,ignore=r.skip_test_files(str(source_tests)))
  for prepare in [r.book_files,r.companion_target_files,r.companion_source,r.source_files,r.coco_band_data,r.card_metrics_data,r.review_texts,r.seed_runtime_motion]:prepare(str(copy))
  r.windows_roots(str(copy),args.windows_roots);r.prepare_hooks(str(copy),args.hooks_entry,counters=True);runtime_entry=r.hooks_entry(copy);r.d1_fixture_access(str(copy),counters=True)
  if any(not(tests/name).is_file() for name in selected):raise RuntimeError('D1 event-counter stage requires both selected fixtures')
  for test in tests.rglob('*'):
   if test.is_file() and test.name.endswith(('.test.ts','.test.tsx')) and test.relative_to(tests).as_posix() not in selected:test.unlink()
  r.engine_cpu_tests(str(copy),getattr(args,'test_name',None))
  home=Path(scratch)/'home';home.mkdir();roaming=home/'AppData/Roaming';local=home/'AppData/Local';roaming.mkdir(parents=True);local.mkdir(parents=True)
  env=dict(os.environ,HOME=str(home),USERPROFILE=str(home),APPDATA=str(roaming),LOCALAPPDATA=str(local),CLAUDE_CONFIG_DIR=str(home/'.claude'),DISABLE_AUTOUPDATER='1',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC='1');env.pop('CLAUDE_CODE_PLUGIN_DIRS',None)
  print('D1_EVENT_COUNTER_SCOPE '+json.dumps({'testFiles':sorted(selected),'sourceHooksOnly':runtime_entry.name=='register.tsx','runtimeEntry':runtime_entry.name,'runtimeEntrySHA256':__import__('hashlib').sha256(runtime_entry.read_bytes()).hexdigest(),'windowsRoots':args.windows_roots,'sharedEngineDeadlineSeconds':r.TIMEOUT,'nativePreflight':False,'otherPreflights':False,'actualFullAcceptance':False}))
  return r.run_serial(cli,str(copy),scratch,env,r.TIMEOUT)
