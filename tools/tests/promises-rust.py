#!/usr/bin/env python3
import argparse,json,math,os,platform,shutil,subprocess,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from scratch import TemporaryDirectory
ROOT=Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser();p.add_argument('--record-baseline',action='store_true');p.add_argument('--prove',action='store_true');p.add_argument('--evidence',type=Path);args=p.parse_args()
if not shutil.which('cargo') or sys.platform not in ('darwin','linux'):print('SKIPPED Rust RSS: requires cargo and macOS/Linux RSS API');sys.exit(3)
budget_path=ROOT/'tools/budgets/companion-rss.json';key='rust-'+('macos' if sys.platform=='darwin' else 'linux')+'-'+('aarch64' if platform.machine()=='arm64' else platform.machine())
receipt={'scope':'headless common Rust renderer; excludes Windows/Linux native shell and text stacks','host':platform.platform(),'checks':{}}
with TemporaryDirectory(prefix='p1-rust-') as folder:
 scratch=Path(folder); crate=scratch/'crate';shutil.copytree(ROOT/'plugin/companion-rs',crate,ignore=shutil.ignore_patterns('target','.DS_Store'))
 # Tests resolve ../assets; keep their exact production folder without copying or changing art.
 (scratch/'assets').symlink_to(ROOT/'plugin/assets',target_is_directory=True)
 # build.rs reads the version from ../.claude-plugin/plugin.json.
 (scratch/'.claude-plugin').symlink_to(ROOT/'plugin/.claude-plugin',target_is_directory=True)
 env=dict(os.environ,HOME=str(scratch),CLAUDE_CONFIG_DIR=str(scratch/'config'),TMPDIR=str(scratch),CARGO_HOME=os.environ.get('CARGO_HOME',str(Path.home()/'.cargo')),RUSTUP_HOME=os.environ.get('RUSTUP_HOME',str(Path.home()/'.rustup')),CARGO_TARGET_DIR=str(scratch/'target'))
 def run(extra=None):
  result=subprocess.run(['cargo','test','--offline','-j4','--manifest-path',str(crate/'Cargo.toml'),'--test','p1_promises','--','--nocapture','--test-threads=1'],env=dict(env,**(extra or {})),capture_output=True,text=True)
  print(result.stdout+result.stderr,end='')
  if result.returncode and ('no matching package named' in result.stderr or 'attempting to make an HTTP request' in result.stderr):
   receipt['status']='SKIPPED';receipt['reason']='offline dependency cache unavailable';receipt['dependencyFailure']={'exit':result.returncode,'stdout':result.stdout,'stderr':result.stderr}
   if args.evidence:args.evidence.parent.mkdir(parents=True,exist_ok=True);args.evidence.write_text(json.dumps(receipt,indent=2)+'\n')
   print('SKIPPED Rust native promises: offline dependency cache unavailable');raise SystemExit(3)
  return result
 if args.prove:
  source=crate/'src/engine.rs';original=source.read_text();source.write_text(original.replace('if !self.visible {','if false {'))
  red=run({'P1_RSS_RECORD_ONLY':'1'});source.write_text(original)
  if red.returncode==0 or 'hidden has no animation callback' not in red.stderr:raise SystemExit('FAIL Rust visibility mutation escaped assertion')
  receipt['checks']['visibilityRed']={'exit':red.returncode,'stdout':red.stdout,'stderr':red.stderr}
 result=run({'P1_RSS_RECORD_ONLY':'1'} if args.record_baseline else {'P1_RSS_BUDGET':str(budget_path)})
 result.check_returncode();values=json.loads(next(line[7:] for line in result.stdout.splitlines() if 'P1_RSS ' in line).split('P1_RSS ',1)[-1])
 measured=max(values.values());receipt['rssBytes']=values
 if args.record_baseline:
  budget=json.loads(budget_path.read_text()) if budget_path.exists() else {'version':1,'marginPercent':20,'measurements':{}}
  budget['measurements'][key]={'baselineBytes':measured,'limitBytes':math.ceil(measured*1.2),'samplesBytes':values,'scope':receipt['scope']};budget_path.parent.mkdir(exist_ok=True,parents=True);budget_path.write_text(json.dumps(budget,indent=2)+'\n')
 if args.prove:
  budget=json.loads(budget_path.read_text());budget['measurements'][key]['limitBytes']=1;broken=scratch/'broken-budget.json';broken.write_text(json.dumps(budget));red=run({'P1_RSS_BUDGET':str(broken)})
  if red.returncode==0 or 'byte budget' not in red.stderr:raise SystemExit('FAIL Rust RSS mutation escaped assertion')
  receipt['checks']['rssRed']={'exit':red.returncode,'stdout':red.stdout,'stderr':red.stderr}
  result=run({'P1_RSS_BUDGET':str(budget_path)});result.check_returncode()
 receipt['checks']['green']={'exit':result.returncode,'stdout':result.stdout,'stderr':result.stderr}
if args.evidence:args.evidence.parent.mkdir(parents=True,exist_ok=True);args.evidence.write_text(json.dumps(receipt,indent=2)+'\n')
