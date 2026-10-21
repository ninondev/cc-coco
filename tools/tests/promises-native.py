#!/usr/bin/env python3
import argparse,hashlib,json,math,os,platform,re,shutil,struct,subprocess,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from scratch import TemporaryDirectory
from native_budget import check_rss
ROOT=Path(__file__).resolve().parents[2]
BUDGET=ROOT/'tools/budgets/companion-rss.json'
p=argparse.ArgumentParser();p.add_argument('--record-baseline',action='store_true');p.add_argument('--prove',action='store_true');p.add_argument('--hc-only',action='store_true');p.add_argument('--source',type=Path,default=ROOT/'plugin/companion/Sources');p.add_argument('--budget',type=Path,default=BUDGET);p.add_argument('--evidence',type=Path);args=p.parse_args()
if sys.platform!='darwin' or not shutil.which('swiftc'):
 print('SKIPPED Swift native promises: macOS and swiftc required');sys.exit(3)
hc_catalog = [
 {'fixture':'2.4.1 PaperPill, SpeechView, BubbleView, HoverView, ButtonLabelView, CardView, ActivityView edge bitmaps','status':'PENDING'},
 *[{'fixture':'2.4.'+str(number),'status':'PENDING'} for number in range(2,8)],
]
receipt={'scope':'47 checks; seven concrete offscreen Swift views (PaperPill, SpeechView, BubbleView, HoverView, ButtonLabelView, CardView, ActivityView), including font and field infrastructure; no production entry point or window presentation; maximum of sampled idle/work/views RSS','host':platform.platform(),'checks':{}}
if args.hc_only:receipt['scope']='HC2.4.2-7 only; original47check/RSS process not run; no budget sample or acceptance claim'

def run(scratch,broken=False):
 sources=scratch/'Sources';sources.mkdir()
 for f in args.source.glob('*.swift'):
  if f.name!='main.swift':shutil.copy2(f,sources/f.name)
 if broken:
  edge_edits={
   'Around.swift':[('(contrast ? ink : ink.withAlphaComponent(0.16))','ink.withAlphaComponent(0.16)')],
   'Card.swift':[('(contrast ? Self.ink : Self.ink.withAlphaComponent(0.16))','Self.ink.withAlphaComponent(0.16)')],
   'Activity.swift':[('(contrast ? CardView.ink : CardView.ink.withAlphaComponent(0.16))','CardView.ink.withAlphaComponent(0.16)')],
   'Pet.swift':[('(contrast ? ink : ink.withAlphaComponent(0.16)).cgColor','ink.withAlphaComponent(0.16).cgColor')],
  }
  normal_edits={name:[(a,a.replace('withAlphaComponent(0.16)','withAlphaComponent(0.60)')) for a,_ in pairs] for name,pairs in edge_edits.items()}
  independent_edits={
   'Around.swift':[
    ('var paper: NSColor { dark ? CardView.color(0x2B2220) : CardView.paper }','var paper: NSColor { dark ? CardView.color(0xAAAAAA) : CardView.paper }'),
    ('@objc private func pressButton() { pressed() }\n    override func accessibilityPerformPress() -> Bool { pressed(); return true }','@objc private func pressButton() { pressed() }\n    override func accessibilityPerformPress() -> Bool { return true }'),
    ('setAccessibilityLabel(words.badge.replacingOccurrences(of: "{n}", with: String(count)))','setAccessibilityLabel("")'),
   ],
   'Feed.swift':[('guard record.at.isFinite, record.at >= (newest[record.session] ?? -.infinity) else { return false }','guard record.at.isFinite else { return false }')],
  }
  edits=edge_edits if broken == 'edges' else normal_edits if broken == 'normal-edges' else independent_edits if broken == 'independent' else {'Pet.swift':[('&& visible && unoccluded && !reduceMotion','&& true'),('mood == "idle" && frame == "idle-reading"','frame == "idle-reading"'),('picture.removeAnimation(forKey: "loop")','picture.removeAnimation(forKey: "broken-loop")'),('picture.removeAnimation(forKey: "tool-patch-loop")','picture.removeAnimation(forKey: "broken-tool-patch-loop")')],
  'Card.swift':[('ink = color(0x231B19)', 'ink = color(0xAAAAAA)')],
  'Feed.swift':[('if record.ended || now - record.at >= Self.lifetime {','if now - record.at >= Self.lifetime {')],
  'RequestChannel.swift':[('try redactOffsets(for: id)','// broken redaction')],
  'Around.swift':[('setAccessibilityLabel(text); labelChanged()','setAccessibilityLabel(""); labelChanged()'),('(contrast ? ink : ink.withAlphaComponent(0.16))','ink.withAlphaComponent(0.16)')]}
  for name,pairs in edits.items():
   f=sources/name;text=f.read_text()
   for a,b in pairs:
    if a not in text:raise RuntimeError('Mutation anchor absent: '+name+': '+a)
    text=text.replace(a,b)
   f.write_text(text)
 shutil.copy2(ROOT/'tools/tests/companion-p1/main.swift',scratch/'main.swift')
 env=dict(os.environ,HOME=str(scratch),CLAUDE_CONFIG_DIR=str(scratch/'config'),TMPDIR=str(scratch))
 command=['swiftc','-j','4','-O','-swift-version','5','-module-cache-path',str(scratch/'cache'),*map(str,sorted(sources.glob('*.swift'))),str(scratch/'main.swift'),'-o',str(scratch/'fixture')]
 result=subprocess.run(command,env=env,capture_output=True,text=True)
 print(result.stdout+result.stderr,end='');result.check_returncode()
 receipt.setdefault('builds',[]).append({'scope':'original47-RSS','mutation':broken,'argv':list(result.args),'executableSha256':hashlib.sha256((scratch/'fixture').read_bytes()).hexdigest(),'executableBytes':(scratch/'fixture').stat().st_size,'mainSha256':hashlib.sha256((scratch/'main.swift').read_bytes()).hexdigest(),'sourceFingerprint':hashlib.sha256('\n'.join(str(f.name)+':'+hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted(sources.glob('*.swift'))).encode()).hexdigest()})
 result=subprocess.run([str(scratch/'fixture'),str(ROOT/'plugin/assets'),str(scratch)],env=env,cwd=scratch,capture_output=True,text=True)
 print(result.stdout+result.stderr,end='')
 return result
def run_hc(scratch, mutation=None):
 sources=scratch/'Sources';sources.mkdir()
 for f in args.source.glob('*.swift'):
  if f.name!='main.swift':shutil.copy2(f,sources/f.name)
 mutants={
  'hover':('Around.swift','if contrast { ground = ink; ink.setFill(); path.fill() }','if false { ground = ink; ink.setFill(); path.fill() }'),
  'dark-hover':('Around.swift','dark ? CardView.color(0xE07A55) : CardView.vermilion','dark ? CardView.vermilion : CardView.vermilion'),
  'seal':('Around.swift','contrast ? (isHighlighted ? 0x5C2412 : 0x76301A)','contrast ? (isHighlighted ? 0x76301A : 0x9E4123)'),
  'focus':('Around.swift','(contrast ? ink : CardView.vermilion).setStroke(); path.lineWidth = 2','CardView.vermilion.setStroke(); path.lineWidth = 2'),
  'activity':('Activity.swift','contrast ? 0x5A504C : 0x6B605C','contrast ? 0x6B605C : 0x6B605C'),
  'fade':('CompanionRig.swift','if reduceTransparency { return band == .over ? 0 : 1 }','if false { return band == .over ? 0 : 1 }'),
  'notification':('Pet.swift','        refreshDisplayStyle()\n        guard changedMotion else','        guard changedMotion else'),
  'notification-timer':('Pet.swift','        refreshDisplayStyle()\n        guard changedMotion else','        refreshDisplayStyle()\n        recheck.fire(after: 60)\n        guard changedMotion else'),
 }
 if mutation:
  name,old,new=mutants[mutation];path=sources/name;value=path.read_text()
  if old not in value:raise RuntimeError('Mutation anchor absent: '+mutation)
  path.write_text(value.replace(old,new) if mutation=='activity' else value.replace(old,new,1))
 app=sources/'App.swift';value=app.read_text()
 old='final class OneShot {'
 if old not in value or '    func fire(after seconds: Double) {\n' not in value:raise RuntimeError('OneShot instrumentation anchor absent')
 value=value.replace(old,old+'\n    static var hcFixtureArms = 0',1).replace('    func fire(after seconds: Double) {\n','    func fire(after seconds: Double) {\n        Self.hcFixtureArms += 1\n',1);app.write_text(value)
 around=sources/'Around.swift';around.write_text(around.read_text()+\
"""
extension ButtonLabel {
 func hcFixturePrepare() { view = ButtonLabelView() }
}
""")
 pet=sources/'Pet.swift';pet.write_text(pet.read_text()+\
"""
extension Pet {
 func hcFixturePrepare() {
  hoverView = HoverView(); card = Card(); badgeView = BadgeView(); hoverLabel.hcFixturePrepare()
  bubbleView.wantsLayer = true
  _ = speechFade.update(distance: 0, at: 0, deliberate: false, tuning: tuning.motion)
  _ = bubbleFade.update(distance: 0, at: 0, deliberate: false, tuning: tuning.motion)
 }
 var hcFixtureContrasts: [Bool] {
  [speechView.contrast, bubbleView.contrast, hoverView!.contrast, hoverLabel.view!.contrast,
   card!.view.contrast, card!.view.primary.contrast, card!.view.secondary.contrast, badgeView!.contrast]
   + hoverView!.buttons.map { $0.contrast }
 }
 var hcFixtureTransparency: Bool { cachedReduceTransparency }
 var hcFixtureAlphas: [Float] { [speechView.layer!.opacity, bubbleView.layer!.opacity] }
}
""")
 shutil.copy2(ROOT/'tools/tests/companion-hc/main.swift',scratch/'main.swift')
 env=dict(os.environ,HOME=str(scratch),CLAUDE_CONFIG_DIR=str(scratch/'config'),TMPDIR=str(scratch))
 command=['swiftc','-j','4','-O','-swift-version','5','-module-cache-path',str(scratch/'cache'),*map(str,sorted(sources.glob('*.swift'))),str(scratch/'main.swift'),'-o',str(scratch/'fixture')]
 result=subprocess.run(command,env=env,capture_output=True,text=True)
 print(result.stdout+result.stderr,end='');result.check_returncode()
 receipt.setdefault('builds',[]).append({'scope':'HC-only separate process','mutation':mutation,'argv':list(result.args),'executableSha256':hashlib.sha256((scratch/'fixture').read_bytes()).hexdigest(),'executableBytes':(scratch/'fixture').stat().st_size,'mainSha256':hashlib.sha256((scratch/'main.swift').read_bytes()).hexdigest(),'sourceFingerprint':hashlib.sha256('\n'.join(str(f.name)+':'+hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted(sources.glob('*.swift'))).encode()).hexdigest()})
 bitmaps=scratch/'bitmaps'
 result=subprocess.run([str(scratch/'fixture'),str(ROOT/'plugin/assets'),str(scratch),str(bitmaps)],env=env,cwd=scratch,capture_output=True,text=True)
 print(result.stdout+result.stderr,end='')
 if args.evidence and mutation is None and bitmaps.is_dir():
  destination=args.evidence.parent/(args.evidence.stem+'-bitmaps')
  destination.mkdir(exist_ok=False)
  for image in bitmaps.glob('*.png'):shutil.copy2(image,destination/image.name)
  receipt['highContrastBitmaps']=str(destination)
  receipt['highContrastBitmapPins']=[{'file':str(image),'sha256':hashlib.sha256(image.read_bytes()).hexdigest(),'dimensions':list(struct.unpack('>II',image.read_bytes()[16:24]))} for image in sorted(destination.glob('*.png'))]
 return result

with TemporaryDirectory(prefix='p1-native-') as folder:
 scratch=Path(folder).resolve()
 if not args.hc_only:
  if args.prove:
   red=scratch/'red';red.mkdir();result=run(red,True)
   required=['C3/D6 ineligible','C3/D6 removes','B5 ended','B5 acknowledgement scrubs','D4 every hover','D5 companion ink','HC 2.4 paper edge']
   if result.returncode!=1 or not all('FAIL '+name in result.stdout for name in required):raise SystemExit('FAIL native mutation did not expose every check')
   required=[f'FAIL {family}: {condition}' for family in ['C3/D6 ineligible idle has no animation','C3/D6 removes both compositor loops'] for condition in ['hidden','covered','reduceMotion','asleep']]
   if not all(name in result.stdout.splitlines() for name in required):raise SystemExit('FAIL native mutation did not expose all eight ineligible/removal assertions')
   receipt['checks']['nativeRed']={'exit':result.returncode,'output':result.stdout}
   edge_red=scratch/'edge-red';edge_red.mkdir();result=run(edge_red,'edges')
   views=['PaperPill','SpeechView','BubbleView','HoverView','ButtonLabelView','CardView','ActivityView']
   required=[f'FAIL HC 2.4 paper edge is full ink at one point: {view} {appearance}' for view in views for appearance in ['light','dark']]
   if result.returncode!=1 or not all(name in result.stdout for name in required):raise SystemExit('FAIL concrete paper edge mutations did not expose every view in both appearances')
   receipt['checks']['paperEdgesRed']={'exit':result.returncode,'output':result.stdout,'mutatedImplementations':['Around.swift PaperPill','Card.swift CardView','Activity.swift ActivityView','Pet.swift SpeechView']}
   normal_red=scratch/'normal-edge-red';normal_red.mkdir();result=run(normal_red,'normal-edges')
   required=[f'FAIL HC 2.4 normal edge is the 16 percent blend: {view} {appearance}' for view in views for appearance in ['light','dark']]
   if result.returncode!=1 or not all(name in result.stdout for name in required):raise SystemExit('FAIL wrong normal opacity did not expose every view in both appearances')
   receipt['checks']['normalPaperEdgesRed']={'exit':result.returncode,'output':result.stdout,'brokenOpacity':0.60,'expectedOpacity':0.16,'mutatedImplementations':['Around.swift PaperPill','Card.swift CardView','Activity.swift ActivityView','Pet.swift SpeechView']}
   independent_red=scratch/'independent-red';independent_red.mkdir();result=run(independent_red,'independent')
   required=['D5 companion cream on dark paper exceeds 7 to one','D4 VoiceOver invokes the action','D4 badge has VoiceOver count words','B5 buffered older record cannot revive excerpt']
   if result.returncode!=1 or not all('FAIL '+name in result.stdout.splitlines() for name in required):raise SystemExit('FAIL independent mutations did not expose all four behavioural assertions')
   receipt['checks']['independentRed']={'exit':result.returncode,'output':result.stdout,'requiredFailures':required}
   receipt['behaviouralRedScope']={'assertionInstances':44,'totalFixtureAssertions':47,'excludedFixturePreconditions':['B5 accepts reply record','B5 fixture first has an excerpt','B5 request acknowledgement accepted']}
  green=scratch/'green';green.mkdir();result=run(green);result.check_returncode()
  values=json.loads(next(line[7:] for line in result.stdout.splitlines() if line.startswith('P1_RSS ')))
  if not values or min(values.values())<=0:raise SystemExit('RSS unavailable')
  measured=max(values.values());key='swift-'+platform.system().lower()+'-'+platform.machine()
  receipt['rssBytes']=values;receipt['checks']['nativeGreen']={'exit':0,'output':result.stdout}
  if args.record_baseline:
   budget=json.loads(args.budget.read_text()) if args.budget.exists() else {'version':1,'marginPercent':20,'measurements':{}}
   budget['measurements'][key]={'baselineBytes':measured,'limitBytes':math.ceil(measured*1.2),'scope':receipt['scope'],'samplesBytes':values}
   args.budget.parent.mkdir(parents=True,exist_ok=True);args.budget.write_text(json.dumps(budget,indent=2)+'\n')
  budget=json.loads(args.budget.read_text());entry=budget['measurements'].get(key)
  if not entry:print('SKIPPED RSS: no recorded budget for '+key);sys.exit(3)
  limit=entry['limitBytes']
  if args.prove:
   broken=json.loads(args.budget.read_text());broken['measurements'][key]['limitBytes']=1
   broken_path=scratch/'broken-budget.json';broken_path.write_text(json.dumps(broken))
   try:check_rss(measured,key,broken_path)
   except AssertionError as error:receipt['checks']['rssRed']={'brokenLimitBytes':1,'actualBytes':measured,'exit':1,'error':str(error)};print('EXPECTED RED',error)
   else:raise SystemExit('FAIL broken RSS budget passed')
  try:limit=check_rss(measured,key,args.budget)
  except AssertionError as error:
   print('FAIL Swift RSS',error)
   receipt['checks']['rssBudget']={'limitBytes':limit,'actualBytes':measured,'exit':1,'error':str(error)}
  else:
   print(f'PASS Swift RSS {measured} bytes <= {limit}; scope: '+receipt['scope'])
   receipt['checks']['rssGreen']={'limitBytes':limit,'actualBytes':measured,'exit':0}
 hc_green=scratch/'hc-green';hc_green.mkdir();hc_result=run_hc(hc_green)
 named_checks=[{'status':match[1],'name':match[2]} for match in re.finditer(r'^HC_CHECK\t(PASS|FAIL)\t(.+)$',hc_result.stdout,re.M)]
 receipt['checks']['highContrastGreen']={'exit':hc_result.returncode,'output':hc_result.stdout,'namedChecks':named_checks,'pass':sum(row['status']=='PASS' for row in named_checks),'fail':sum(row['status']=='FAIL' for row in named_checks)}
 hc_catalog[0]['status']='NOT RUN' if args.hc_only else 'PASS'
 for number,fixture in enumerate(hc_catalog[1:],start=2):
  checks=[row for row in named_checks if row['name'].startswith('HC2.4.'+str(number))]
  if number==2:checks += [row for row in named_checks if row['name'].startswith(('HC N1','HC2.2 bell','HC2.2 mic'))]
  if number==4:checks += [row for row in named_checks if row['name'].startswith('HC focus')]
  if number==5:checks += [row for row in named_checks if row['name'].startswith('HC2.2 quiet')]
  if number==7:checks += [row for row in named_checks if row['name'].startswith('HC2.1')]
  fixture['checks']=checks
  fixture['status']='PASS' if checks and all(row['status']=='PASS' for row in checks) else 'FAIL' if checks else 'NOT RUN'
 if args.prove:
  required={'hover':'HC2.4.2 disc','dark-hover':'HC2.4.2 normal dark hover','seal':'HC2.4.3 seal rest symbol','focus':'HC2.4.4 icon focus','activity':'HC2.4.5 placeholder','fade':'HC2.4.6 near transparency','notification':'HC2.4.7 Pet contrast propagation','notification-timer':'HC2.4.7 notification no OneShot arms'}
  for mutation,failure in required.items():
   folder=scratch/('hc-red-'+mutation);folder.mkdir();result=run_hc(folder,mutation)
   receipt['checks']['highContrastRed-'+mutation]={'exit':result.returncode,'output':result.stdout,'requiredFailure':failure}
   if result.returncode != 1 or 'FAIL '+failure not in result.stdout:raise SystemExit('FAIL HC mutation did not expose '+mutation)
receipt['highContrastFixtures'] = hc_catalog
receipt['status'] = 'FAIL' if 'rssBudget' in receipt['checks'] or receipt['checks']['highContrastGreen']['exit'] else 'PASS'
if args.evidence:
 args.evidence.parent.mkdir(parents=True,exist_ok=True);args.evidence.write_text(json.dumps(receipt,indent=2)+'\n')
for fixture in hc_catalog:
 print(fixture['status'] + ': HIGH-CONTRAST ' + fixture['fixture'])
sys.exit(1 if receipt['status'] == 'FAIL' else 0)
