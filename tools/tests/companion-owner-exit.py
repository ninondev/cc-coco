#!/usr/bin/env python3
"""Native owner identity/exit events against only this test's synthetic child process."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from scratch import TemporaryDirectory
ROOT=Path(__file__).resolve().parents[2]
with TemporaryDirectory(prefix='coco-owner-exit-',dir=os.environ['TMPDIR']) as scratch:
 scratch=Path(scratch);env=dict(os.environ,HOME=str(scratch),CLAUDE_CONFIG_DIR=str(scratch/'config'))
 binary=Path(os.environ.get('COCO_TEST_NATIVE',str(ROOT/'plugin/bin/presence-native')))
 child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(20)'],env=env)
 watcher=None
 try:
  info=json.loads(subprocess.check_output([str(binary),'stats',str(child.pid)],env=env,text=True))[0]
  birth='darwin:'+info['birth']
  started=time.monotonic()
  watcher=subprocess.Popen([str(binary),str(scratch),'watch-companion',str(child.pid),birth],env=env,stdout=subprocess.PIPE,text=True)
  live=watcher.stdout.readline().rstrip('\n')
  assert live==f'LIVE\t{child.pid}\t{birth}',live
  child.kill();child.wait(timeout=2)
  line=watcher.stdout.readline().rstrip('\n');watcher.wait(timeout=2)
  assert line==f'EXIT\t{child.pid}\t{birth}',line
  assert watcher.returncode==0
  absent=subprocess.check_output([str(binary),str(scratch),'watch-companion',str(child.pid),birth],env=env,text=True,timeout=2).strip()
  assert absent==f'EXIT\t{child.pid}\t{birth}',absent
  mismatch=subprocess.check_output([str(binary),str(scratch),'watch-companion',str(os.getpid()),'darwin:0:0'],env=env,text=True,timeout=2).strip()
  assert mismatch==f'EXIT\t{os.getpid()}\tdarwin:0:0',mismatch
  print(json.dumps({'checks':5,'failures':0,'elapsedSeconds':time.monotonic()-started,'watchMode':'kqueue NOTE_EXIT','polled':False}))
 finally:
  if child.poll() is None:child.kill();child.wait(timeout=2)
  if watcher and watcher.poll() is None:watcher.terminate();watcher.wait(timeout=2)
