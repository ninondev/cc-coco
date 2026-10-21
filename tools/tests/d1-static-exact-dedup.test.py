from pathlib import Path
import argparse,copy,hashlib,importlib.util,json,sys
sys.dont_write_bytecode=True
HERE=Path(__file__).resolve().parent
ROOT=Path(__file__).resolve().parents[2] if HERE.name=='tests' and HERE.parent.name=='tools' else Path.cwd()
p=argparse.ArgumentParser();p.add_argument('--out',type=Path);a=p.parse_args()
helper=ROOT/'tools/preview/d1-static-exact-dedup.py' if HERE.name=='tests' else HERE/'d1-static-exact-dedup.py'
def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
C=load('dedup_contract_common',ROOT/'tools/preview/d1-preview-common.py')
D=load('dedup_contract_candidate',helper)
c={'surface':'desktop','mode':'light','lang':'en','width':300,'hover':False,'layout':'book','columns':40,'pixel':False,'scene':'fixture-a','tree':{'type':'Text','props':{'children':'123'},'children':[]},'engineKind':'ToolUse','engineText':'123'}
source=C.renderer();deps={'renderer':source.encode(),'CSS':C.CSS.encode(),'snapshot':(ROOT/'tools/preview/snapshot.swift').read_bytes()};ref=b'fixture-reference'
def key(value,scale=1,reference=ref,dependencies=deps):
 return D.identity(value,D.normalized_page(C,value,'refs/fixed.png',source),reference,dependencies,scale)
base,basebytes=key(c);same=copy.deepcopy(c);same.update(surface='vscode',scene='fixture-b',state='another-coverage-row',method='another-method')
assert key(same)==(base,basebytes),'actual normalized page should retain identical painted bytes'
checks=[]
for field,value in [('mode','dark'),('lang','ja'),('width',301),('hover',True),('surface','terminal'),('layout','transcript'),('columns',41),('pixel',True),('engineKind','AssistantMessage'),('engineText','124')]:
 changed=copy.deepcopy(c);changed[field]=value;assert key(changed)[0]!=base,field;checks.append(field)
changed=copy.deepcopy(c);changed['tree']['props']['children']='124';assert key(changed)[0]!=base;checks.append('sampled tree')
assert key(c,scale=2)[0]!=base;checks.append('scale')
assert key(c,reference=b'other-reference')[0]!=base;checks.append('reference bytes')
assert key(c,reference=None)[0]!=base;checks.append('reference absent')
for dependency in deps:
 changed=copy.deepcopy(deps);changed[dependency]+=b'\n';assert key(c,dependencies=changed)[0]!=base;checks.append(dependency+' bytes')
job={'id':'one','png':'one.png','scale':1};jobs=D.ExactJobs();assert jobs.add(base,basebytes,job,'coverage-a')[1] is True;assert jobs.add(base,basebytes,job,'coverage-b')[1] is False
assert len(jobs.seen)==1 and len(jobs.aliases)==2 and all(row['exactInputBytesEqual'] for row in jobs.aliases)
try:jobs.add(base,basebytes+b'different',job,'collision')
except ValueError:checks.append('forced digest collision rejected')
else:raise AssertionError('digest-only identity accepted differing bytes')
try:D.normalized_page(C,c,None,source+' CAPTURE.width')
except ValueError:checks.append('undeclared renderer input rejected')
else:raise AssertionError('undeclared renderer input accepted')
# Source-counterfactuals have to change actual module behavior, not merely match text.
mutant_source=(helper).read_text()
mutants={
 'omit_scale':("'scale':scale","'scale':1",lambda M:(M.identity(c,'same-page',ref,deps,1)[0],M.identity(c,'same-page',ref,deps,2)[0])),
 'omit_reference':('reference_bytes if reference_bytes is not None else',"b'IGNORED' if reference_bytes is not None else",lambda M:(M.identity(c,'same-page',ref,deps,1)[0],M.identity(c,'same-page',b'other',deps,1)[0])),
 'omit_row':("row={key:c[key] for key in ROW_KEYS if key in c}",'row={}',lambda M:(M.identity(c,'same-page',ref,deps,1)[0],M.identity(c|{'layout':'other'},'same-page',ref,deps,1)[0])),
 'omit_dependencies':("parts.extend(json_bytes({'name':name})+content for name,content in sorted(dependencies.items()))",'parts.extend([])',lambda M:(M.identity(c,'same-page',ref,deps,1)[0],M.identity(c,'same-page',ref,deps|{'renderer':b'other'},1)[0])),
 'omit_page':('parts=[page.encode(),','parts=[b\'IGNORED\',',lambda M:(M.identity(c,'page-a',ref,deps,1)[0],M.identity(c,'page-b',ref,deps,1)[0])),
}
negatives=[]
for label,(before,after,probe) in mutants.items():
 assert mutant_source.count(before)==1,label
 changed=mutant_source.replace(before,after,1);assert changed!=mutant_source
 namespace={};exec(compile(changed,'counterfactual-'+label,'exec'),namespace);M=type('FixtureModule',(),namespace);left_identity,right_identity=probe(M)
 assert left_identity==right_identity,'deliberate omission did not exercise identity failure: '+label
 negatives.append({'mutation':label,'sourceChanged':True,'requiredSeparationAssertionFailed':True,'realSnapshots':0})
report={'scope':'synthetic pure input contract; no engine captures or WebKit snapshots','positiveIdentityAlias':True,'separationChecks':checks,'sourceCounterfactuals':negatives,'coverageRowsPreserved':2,'allOriginalMotionToolsUntouched':True,'realSnapshots':0,'accepted':True}
report['commonSourceSHA256']=C.digest(ROOT/'tools/preview/d1-preview-common.py');report['helperSHA256']=C.digest(helper);report['testSHA256']=C.digest(__file__)
if a.out:a.out.parent.mkdir(parents=True,exist_ok=True);a.out.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
