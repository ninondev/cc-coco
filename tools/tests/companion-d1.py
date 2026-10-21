#!/usr/bin/env python3
import hashlib, json, os, pathlib, re, shutil, subprocess, sys, time
ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=pathlib.Path(os.environ.get('MOE_D1_COMPANION_OUT', str(ROOT/'evidence/d1-native'))); OUT.mkdir(parents=True, exist_ok=True)
ENV=dict(os.environ,HOME=str(OUT/'home'),CLAUDE_CONFIG_DIR=str(OUT/'config'))
(OUT/'home').mkdir(exist_ok=True)
def receipt(name,value):
    (OUT/name).write_text(json.dumps(value,indent=2)); print(json.dumps(value),flush=True)
def symbols(folder):
    text='\n'.join(p.read_text() for p in folder.glob('*.swift'))
    checks=['struct D1Helper','struct D1Shed','struct D1LongTask','enum D1Away','struct D1NotificationGate','final class D1Helpers','final class D1ShedOverlay','enum D1Ribbon']
    failures=[x for x in checks if x not in text]
    return {'pass':len(checks)-len(failures),'fail':len(failures),'missing':failures,'scope':'source_component_presence'}
if '--source-only' in sys.argv:
    value=symbols(ROOT/'plugin/companion/Sources');receipt('source-gate.json',value);sys.exit(bool(value['fail']))
def privacy_source(source):
    compact=lambda value: re.sub(r'\s+','',value)
    failures=[]
    away=source.split('enum D1Away {',1)[1].split('struct D1NotificationGate',1)[0] if source.count('enum D1Away {')==1 else ''
    expected_away='''
    struct Inputs: Equatable {
        var locked: Bool, displayAsleep: Bool
        var inputAge: Double
        var frontmostBundleID: String?
    }
    static func away(_ input: Inputs, target: String?) -> Bool {
        input.locked || input.displayAsleep || (input.inputAge.isFinite && input.inputAge >= 60)
            || (target.flatMap { target in input.frontmostBundleID.map { $0 != target } } ?? false)
    }
}
'''
    if compact(away)!=compact(expected_away):failures.append('pure_away_inputs_only')
    reader=re.search(r'let input = (.*?)\n\s*guard gate\.accept',source,re.S)
    expected_reader='''readInputs?() ?? D1Away.Inputs(locked:locked || ((CGSessionCopyCurrentDictionary() as? [String:Any])?["CGSSessionScreenIsLocked"] as? Bool == true), displayAsleep:displayAsleep || CGDisplayIsAsleep(CGMainDisplayID()) != 0,
            inputAge:CGEventSource.secondsSinceLastEventType(.combinedSessionState,eventType:CGEventType(rawValue:UInt32.max)!),
            frontmostBundleID:NSWorkspace.shared.frontmostApplication?.bundleIdentifier)'''
    if reader is None or compact(reader.group(1))!=compact(expected_reader):failures.append('live_reader_api_allowlist')
    forbidden=[r'AXUIElement',r'kAX\w+',r'CGWindowList',r'localizedName',r'windowTitle',r'FileManager',r'Data\(contentsOf',r'String\(contentsOf',r'FileHandle',r'Process\(',r'URLSession',r'\bfopen\(',r'\bopen\(',r'\bread\(']
    # NSWorkspace.open is the explicit settings capability, excluded from POSIX-open check.
    protected=source.replace('NSWorkspace.shared.open(url)','SETTINGS_OPEN_CAPABILITY')
    if any(re.search(pattern,protected) for pattern in forbidden):failures.append('no_title_ax_foreign_file_acquisition')
    request='''var requestAuthorization: (@escaping (Bool) -> Void) -> Void = { completion in
        guard LoginAgent.isInstalledBundle else { completion(false); return }
        UNUserNotificationCenter.current().requestAuthorization(options:[.alert]) { granted,_ in
            DispatchQueue.main.async { completion(granted) }
        }
    }'''
    submit='''var submit: (UNNotificationRequest) -> Void = { request in
        guard LoginAgent.isInstalledBundle else { return }
        UNUserNotificationCenter.current().add(request)
    }'''
    notification_code=source.split('final class D1Notifications:',1)[1].split('enum D1Ribbon',1)[0] if source.count('final class D1Notifications:')==1 else ''
    live_notification_centers=compact(source).count('UNUserNotificationCenter.current()')
    if compact(request) not in compact(source) or compact(source).count('.requestAuthorization(options:')!=1:failures.append('authorization_only_guarded_capability')
    if compact(submit) not in compact(source) or compact(notification_code).count('.add(')!=1 or live_notification_centers!=4:failures.append('notification_only_guarded_capability')
    # receive ends at its closing brace: the DM notice (8f00cabc) follows it with its own content and submit.
    receive=source.split('    func receive(_ record: Record, now: Double) {',1)[1].split('\n    }\n',1)[0] if source.count('    func receive(_ record: Record, now: Double) {')==1 else ''
    expected_content='let content=UNMutableNotificationContent(); content.title=task.title; content.body=task.body\n        content.threadIdentifier=task.thread; content.sound=nil'
    content_fields=re.findall(r'content\.(title|body|threadIdentifier|sound)\s*=',receive)
    if compact(expected_content) not in compact(receive) or sorted(content_fields)!=['body','sound','threadIdentifier','title'] or source.count('content.sound=')!=1:failures.append('silent_named_threaded_content')
    expected_call='submit(UNNotificationRequest(identifier:id,content:content,trigger:nil))'
    if compact(expected_call) not in compact(receive) or receive.count('submit(')!=1 or receive.count('UNNotificationRequest(')!=1 or 'guard gate.accept(task,session:record.session' not in receive:failures.append('single_gated_injected_submission')
    return failures
source=(ROOT/'plugin/companion/Sources/D1.swift').read_text()
failures=privacy_source(source)
negative_controls={
    'window_title':source.replace('frontmostApplication?.bundleIdentifier','frontmostApplication?.localizedName'),
    'ax_contents':'import ApplicationServices\n'+source.replace('let input = readInputs?()', 'var forbiddenValue:CFTypeRef?; let _ = AXUIElementCopyAttributeValue(AXUIElementCreateSystemWide(),kAXValueAttribute as CFString,&forbiddenValue); let input = readInputs?()'),
    'foreign_file':source.replace('let input = readInputs?()', 'let _ = try? String(contentsOf:URL(fileURLWithPath:"/foreign")); let input = readInputs?()'),
    'notification_sound':source.replace('content.sound=nil','content.sound = .default'),
    'direct_real_notification':source.replace('enum D1Ribbon {','enum D1Ribbon {\n    static func forbiddenSubmit() {UNUserNotificationCenter.current().add(UNNotificationRequest(identifier:"forbidden",content:UNMutableNotificationContent(),trigger:nil))}'),
    'duplicate_submission':source.replace('submit(UNNotificationRequest(identifier:id,content:content,trigger:nil))','submit(UNNotificationRequest(identifier:id,content:content,trigger:nil)); submit(UNNotificationRequest(identifier:id,content:content,trigger:nil))'),
    'real_permission_outside_capability':source.replace('let content=UNMutableNotificationContent()','UNUserNotificationCenter.current().requestAuthorization(options:[.alert]) {_,_ in}; let content=UNMutableNotificationContent()'),
    'away_foreign_read':source.replace('input.locked || input.displayAsleep','FileManager.default.fileExists(atPath:"/foreign") || input.locked || input.displayAsleep')
}
red={name:privacy_source(value) for name,value in negative_controls.items()}
receipt('privacy-source-gate.json',{'scope':'exact_live_reader_pure_inputs_notification_capability_boundaries','sourceSHA256':hashlib.sha256(source.encode()).hexdigest(),'productionFailures':failures,'negativeControls':red,'negativeControlMisses':[name for name,value in red.items() if not value],'realAPICalls':0,'prechangeRed':'not_claimed','allowedLiveInputs':['screen_locked_boolean','display_asleep_boolean','combined_session_any_input_age','frontmost_bundle_id'],'acquisitionAPIs':['CGSessionCopyCurrentDictionary_lock_key_only','CGDisplayIsAsleep','CGMainDisplayID','CGEventSource.secondsSinceLastEventType_combined_session_any_event','NSWorkspace.shared.frontmostApplication.bundleIdentifier'],'checks':7})
if failures or any(not value for value in red.values()):sys.exit(1)

version=subprocess.run(['swiftc','-version'],capture_output=True,text=True,env=ENV)
(OUT/'toolchain.log').write_text(version.stdout+version.stderr)
# Fresh, invocation-owned compiler objects can be reused between exact frozen RED
# and primary GREEN snapshots. Every snapshot still invokes swiftc on all inputs.
compiler_workspace=OUT/'primary-incremental-compiler'
if compiler_workspace.exists():shutil.rmtree(compiler_workspace)
compiler_workspace.mkdir()
compiler_path=pathlib.Path(shutil.which('swiftc')).resolve()
compiler_identity={
    'path':str(compiler_path),
    'sha256':hashlib.sha256(compiler_path.read_bytes()).hexdigest(),
    'version':version.stdout+version.stderr,
}
compiler_iteration=0
compiler_previous_inputs={}
compiler_flags=['-j','2','-swift-version','5','-module-name','D1PrimaryFixture',
                '-module-cache-path',str(OUT/'cache'),'-incremental',
                '-driver-show-incremental','-emit-executable','-emit-module']
def artifact_state(path):
    return {'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
            'mtimeNS':path.stat().st_mtime_ns} if path.is_file() else None
def compile_exact_snapshot(snapshot,label):
    global compiler_iteration,compiler_previous_inputs
    original_inputs={path.name:hashlib.sha256(path.read_bytes()).hexdigest()
                     for path in sorted(snapshot.glob('*.swift'))}
    changed=[]
    removed=[]
    for old in sorted(compiler_workspace.glob('*.swift')):
        if old.name not in original_inputs:
            removed.append(old.name);old.unlink()
    for path in sorted(snapshot.glob('*.swift')):
        destination=compiler_workspace/path.name
        if not destination.is_file() or destination.read_bytes()!=path.read_bytes():
            destination.write_bytes(path.read_bytes());changed.append(path.name)
    assert {path.name:hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(compiler_workspace.glob('*.swift'))}==original_inputs
    objects=compiler_workspace/'objects';objects.mkdir(exist_ok=True)
    output_map={'':{'swift-dependencies':str(objects/'master.swiftdeps')}}
    for name in original_inputs:
        output_map[str(compiler_workspace/name)]={
            'object':str(objects/(name+'.o')),
            'swift-dependencies':str(objects/(name+'.swiftdeps')),
        }
    mapping=compiler_workspace/'output-file-map.json'
    mapping.write_text(json.dumps(output_map,sort_keys=True)+'\n')
    binary=compiler_workspace/'native-check'
    argv=['swiftc',*compiler_flags,'-output-file-map',str(mapping),
          '-emit-module-path',str(compiler_workspace/'D1PrimaryFixture.swiftmodule'),
          *[str(compiler_workspace/name) for name in original_inputs],'-o',str(binary)]
    before={name:artifact_state(objects/(name+'.o')) for name in original_inputs}
    executable_before=artifact_state(binary)
    start=time.monotonic();load_start=os.getloadavg()
    result=subprocess.run(argv,capture_output=True,text=True,env=ENV)
    wall=time.monotonic()-start
    (OUT/(label+'-compile.log')).write_text(result.stdout+result.stderr)
    after={name:artifact_state(objects/(name+'.o')) for name in original_inputs}
    executable_after=artifact_state(binary)
    assert {path.name:hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(snapshot.glob('*.swift'))}==original_inputs
    unchanged=[name for name,digest in original_inputs.items()
               if compiler_previous_inputs.get(name)==digest]
    reused=[name for name in unchanged
            if before[name] is not None and before[name]==after[name]]
    proof={
        'label':label,'iteration':compiler_iteration,'compiler':compiler_identity,
        'flags':compiler_flags,'argv':argv,'snapshot':str(snapshot),
        'snapshotInputsSHA256':original_inputs,
        'priorSnapshotInputsSHA256':compiler_previous_inputs,
        'changedSourceFiles':changed,'removedSourceFiles':removed,
        'unchangedSourceFiles':unchanged,'reusedUnchangedObjects':reused,
        'objectBefore':before,'objectAfter':after,
        'linkedExecutableBefore':executable_before,
        'linkedExecutableAfter':executable_after,
        'wallSeconds':wall,'loadAverageStart':load_start,
        'loadAverageEnd':os.getloadavg(),'compileExit':result.returncode,
        'compilerInvokedOnCompleteExactSnapshot':True,
        'workspaceFreshAtMandatoryInvocationStart':True,
        'previousInvocationObjectsReused':False,
    }
    proof_path=OUT/(label+'-compiler-reuse.json')
    proof_path.write_text(json.dumps(proof,indent=2)+'\n')
    if result.returncode==0:
        assert all(state is not None for state in after.values())
        assert executable_after is not None
        for name in changed:
            if before[name] is not None:
                assert after[name]['mtimeNS']!=before[name]['mtimeNS'],('changed input object not rebuilt',name)
        if executable_before is not None:
            assert executable_after['mtimeNS']!=executable_before['mtimeNS'],'snapshot executable not freshly linked'
        if 'main.swift' in changed and before.get('main.swift') is not None:
            assert after['main.swift']['sha256']!=before['main.swift']['sha256'],'different RED/GREEN main generated identical object'
        destination=OUT/label;shutil.copy2(binary,destination)
        copied=artifact_state(destination)
        assert copied['sha256']==executable_after['sha256'] and destination.read_bytes()==binary.read_bytes()
        proof.update(freshChangedInputObjectsVerified=True,freshLinkedExecutableVerified=True,
                     variantBinary={'path':str(destination),**copied,'byteEqualToFreshLinkedExecutable':True})
        proof_path.write_text(json.dumps(proof,indent=2)+'\n')
    compiler_iteration+=1;compiler_previous_inputs=original_inputs
    return result
def compile_run(snapshot,label):
    result=compile_exact_snapshot(snapshot,label)
    if result.returncode:
        receipt(label+'.json',{'compile':'failed','exit':result.returncode});print(result.stdout+result.stderr);return None
    result=subprocess.run([str(OUT/label),str(ROOT)],capture_output=True,text=True,env=ENV)
    (OUT/(label+'.log')).write_text(result.stdout+result.stderr)
    try: value=json.loads(result.stdout.splitlines()[-1])
    except (ValueError,IndexError): value={'output':result.stdout+result.stderr}
    value.update({'exit':result.returncode,'compile':'passed'})
    receipt(label+'.json',value);return result

# Replay frozen D1/overlay code from before the corrections, against current surrounding code/tests.
# The failed-fade assertion was authored after the fix; historical red execution is not claimed.
red=OUT/'controlled-behavior-baseline'
compatibility=OUT/'controlled-behavior-compatibility'
if compatibility.exists():red=compatibility
if red.exists():
    result=compile_run(red,'controlled-behavior-red')
    expected=['FAIL unknown frontmost bundle fails closed','FAIL failed helper remains visible during native300ms tilt before200ms fade','FAIL shed follows changed target window without restarting timeline','FAIL held task stays once and reads inputs once after256 other decisions','FAIL session cooldown survives256 other session decisions']
    if result is None or result.returncode == 0:sys.exit(1)
    actual_failures=[line for line in result.stdout.splitlines() if line.startswith('FAIL ')]
    if sorted(actual_failures)!=sorted(expected):sys.exit(1)
    value=json.loads((OUT/'controlled-behavior-red.json').read_text())
    if value.get('fail') != len(expected):sys.exit(1)
    receipt('red-scope.json',{'D1Capture':'before_privacy_and_fillMode_corrections','overlayCapture':'before_window_target_correction','overlayCopyCompatibility':str(OUT/'controlled-copy-compatibility.json') if red==compatibility else None,'otherSources':'frozen_surrounding_sources_and_fixture','windowTargetTestAuthorship':'before_fix','failedFadeTestAuthorship':'after_fix','execution':'after_fixes','prechange_execution':'not_claimed','expectedFailures':expected,'actualFailures':actual_failures})
absent=OUT/'absent-overlay-snapshot'
if absent.exists():
    value=symbols(absent);value['kind']='controlled_missing_component_snapshot';value['prechange_execution']='not_claimed'
    receipt('controlled-overlay-red.json',value)
    if value['missing'] != ['final class D1ShedOverlay']:sys.exit(1)
snapshot=OUT/'snapshot'
if snapshot.exists():shutil.rmtree(snapshot)
snapshot.mkdir()
for file in (ROOT/'plugin/companion/Sources').glob('*.swift'):
    if file.name!='main.swift':shutil.copy2(file,snapshot/file.name)
shutil.copy2(ROOT/'tools/tests/companion-d1/main.swift',snapshot/'main.swift')
binding=subprocess.run(['python3',str(ROOT/'tools/tests/companion-d1/binding-guard.py'),'--out',str(snapshot/'front-ordering-fixture.swift')],env=ENV)
if binding.returncode:sys.exit(binding.returncode)
receipt('snapshot.json',{'sha256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(snapshot.glob('*.swift'))}})
result=compile_run(snapshot,'green')
if result is None or result.returncode:sys.exit(1)
for native_guard in ['click-controls.py','helper-controls.py','idle-controls.py','present-gate-controls.py']:
    guarded=subprocess.run(['python3',str(ROOT/'tools/tests/companion-d1'/native_guard)],env=ENV)
    if guarded.returncode:sys.exit(guarded.returncode)
if '--render' in sys.argv:
    preview=OUT/'preview-snapshot'
    if preview.exists():shutil.rmtree(preview)
    shutil.copytree(snapshot,preview)
    shutil.copy2(ROOT/'tools/preview/d1-companion-main.swift',preview/'main.swift')
    command=['swiftc','-j','1','-swift-version','5','-module-cache-path',str(OUT/'cache'),'-o',str(OUT/'preview'),*map(str,sorted(preview.glob('*.swift')))]
    compiled=subprocess.run(command,capture_output=True,text=True,env=ENV)
    (OUT/'preview-compile.log').write_text(compiled.stdout+compiled.stderr)
    if compiled.returncode:print(compiled.stdout+compiled.stderr);sys.exit(compiled.returncode)
    renders=OUT/'renders';renders.mkdir(exist_ok=True)
    run=subprocess.run([str(OUT/'preview'),str(ROOT),str(renders)],capture_output=True,text=True,env=ENV)
    (OUT/'preview.log').write_text(run.stdout+run.stderr)
    if run.returncode:print(run.stdout+run.stderr);sys.exit(run.returncode)
    from PIL import Image
    groups={}
    for path in sorted([*renders.glob('shed-*.png'),*renders.glob('helper-motion-*.png')]):
        m=re.fullmatch(r'((?:shed|helper-motion)-.+)-(\d+)(-front-seam)?\.png',path.name)
        if m and not path.name.startswith('shed-continuous-'):groups.setdefault(m[1]+(m[3] or ''),[]).append((int(m[2]),path))
    for name,items in groups.items():
        items.sort(); images=[Image.open(p).convert('RGBA') for _,p in items]
        durations=[max(1,items[i+1][0]-ms) if i+1<len(items) else 400 for i,(ms,_) in enumerate(items)]
        images[0].save(renders/(name+'.gif'),save_all=True,append_images=images[1:],duration=durations,loop=0,disposal=2)
    sheets={}
    for kind in ['helpers','ribbon-placement','ribbons','shed']:
        sheet=Image.new('RGBA',(420*4,230*4),(250,238,233,255))
        for row,size in enumerate(['tiny','small','medium','large']):
            for col,(theme,scale) in enumerate([('light',1),('light',2),('dark',1),('dark',2)]):
                name=f'{kind}-{size}-{theme}-{scale}x'
                if kind=='helpers':name+='-5'
                if kind=='shed':name+='-motion-620'+('-front-seam' if size in ['medium','large'] else '')
                path=renders/(name+'.png')
                with Image.open(path) as picture:
                    picture=picture.convert('RGBA')
                    if scale==2:picture=picture.resize((picture.width//2,picture.height//2),Image.Resampling.BOX)
                    sheet.alpha_composite(picture,(col*420,row*230))
        filename=kind+'-sheet.png';sheet.save(renders/filename);sheets[kind]=filename
    (OUT/'sheets.json').write_text(json.dumps(sheets,indent=2))
    receipt('preview.json',{'png':len(list(renders.glob('*.png'))),'gif':len(list(renders.glob('*.gif'))),'nativeViews':'offscreen_components','nativeTimelines':'deterministic_layer_samples','nativeFrontWindowOrdering':'not_exercised','realNotifications':0,'realPermissionPrompts':0})
