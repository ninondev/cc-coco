#!/usr/bin/env python3
"""Real AppKit icon checks. Only signed temporary dummy bundles are inspected."""
import hashlib, json, os, plistlib, re, shutil, subprocess, sys, tempfile, time, resource, unittest, uuid
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS = Path(os.environ.get('COCO_ICON_EVIDENCE', '/private/tmp/i1-icon-evidence'))
SKIP_WORKSPACE = os.environ.get('COCO_ICON_SKIP_WORKSPACE') == '1'
REAL_WORKSPACE_REASON = 'explicit sandbox opt-out: real NSWorkspace pixel/readback acceptance remains unverified'
class NativeIcons(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if sys.platform != 'darwin': raise unittest.SkipTest('macOS native utilities unavailable')
        cls.temp = tempfile.TemporaryDirectory(prefix='i1-native-', dir=os.environ.get('TMPDIR'))
        cls.base = Path(cls.temp.name).resolve()
        cls.consent=cls.base/'app-icon-consent'
        cls.env=dict(os.environ,HOME=str(cls.base/'home'),TMPDIR=str(cls.base),COCO_ICON_CONSENT_FILE=str(cls.consent))
        (cls.base/'home').mkdir()
        cls.probe = cls.base/'probe'
        cls.call('/usr/bin/clang','-x','c','-Os','-fno-modules','-o',str(cls.probe),'-',input='int main(void) { return 0; }\n')
        ARTIFACTS.mkdir(parents=True,exist_ok=True)
        cls.measurements=[]
        cls.script_path=cls.base/'icon-macos.sh'
        # Keep the script beside copied assets, so its normal relative lookup is exercised.
        (cls.base/'bin').mkdir()
        (cls.base/'assets').mkdir()
        shutil.copytree(ROOT/'plugin/assets/icon',cls.base/'assets/icon')
        cls.script_path=cls.base/'bin/icon-macos.sh'
        source=(ROOT/'plugin/bin/icon-macos.sh').read_text()
        mutation=os.environ.get('COCO_ICON_MUTATION','')
        mutations={
            'nil':('1, false, $())','1, false, null)'),
            'context':('$.NSGraphicsContext.setCurrentContext($.NSGraphicsContext.graphicsContextWithBitmapImageRep(bitmap));','$.NSGraphicsContext.currentContext = $.NSGraphicsContext.graphicsContextWithBitmapImageRep(bitmap);'),
            'gate':('if [ "$CMD" = apply ] && [ "$DRY" -eq 0 ]; then','if false; then'),
            'clear':('if ! run_jxa clear; then print_limit_note; exit 1; fi','if false; then print_limit_note; exit 1; fi'),
            'legacy':('state = "legacy";', 'state = "custom";'),
        }
        if mutation in mutations:
            before,after=mutations[mutation]
            if source.count(before)!=1:raise AssertionError('inactive native mutation target: '+mutation)
            source=source.replace(before,after)
        if mutation in ('exact','and-bound'):
            target='function legacyAccepted(features, width) {'
            if source.count(target)!=1:raise AssertionError('inactive native mutation target: '+mutation)
            injected=('legacyBounds = {maskError:0,gradient:0,color:0,opaqueColor:0};' if mutation=='exact'
                      else 'return true;')
            source=source.replace(target,target+'\n  '+injected)
        if os.environ.get('COCO_ICON_DEBUG'): source=source.replace('>/dev/null 2>&1','')
        source=source.replace('ICNS_FILE=$WORK/coco.icns', 'cp "$WORK/coco.icns" "'+str(ARTIFACTS/'badge-captured.icns')+'"\n  ICNS_FILE=$WORK/coco.icns')
        cls.script_path.write_text(source)
        cls.measurements.append(dict(source_sha256=hashlib.sha256(source.encode()).hexdigest(),
            mutation=mutation,mutation_scope='valid-no-icns Workspace fallback only' if mutation in ('nil','context') else 'resource classification or native action',
            packer_sha256=hashlib.sha256((ROOT/'plugin/assets/icon/build-icns.sh').read_bytes()).hexdigest(),
            tests_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()))
    @classmethod
    def tearDownClass(cls):
        (ARTIFACTS/'measurements.json').write_text(json.dumps(cls.measurements,indent=2))
        cls.temp.cleanup()
    def setUp(self):
        self.fresh_case(self._testMethodName)
    def fresh_case(self, label):
        """A signed bundle identity is never reused by another test/image case."""
        from PIL import Image
        token = uuid.uuid4().hex
        folder = self.base/(label+'-'+token)
        folder.mkdir()
        self.consent = folder/'app-icon-consent'
        self.env = dict(type(self).env, COCO_ICON_CONSENT_FILE=str(self.consent))
        self.app = folder/('Probe-'+token+'.app')
        (self.app/'Contents/MacOS').mkdir(parents=True)
        (self.app/'Contents/Resources').mkdir()
        shutil.copyfile(self.probe,self.app/'Contents/MacOS/probe')
        (self.app/'Contents/MacOS/probe').chmod(0o755)
        Image.new('RGBA',(512,512),(128,128,128,255)).save(self.app/'Contents/Resources/stock.png')
        with (self.app/'Contents/Info.plist').open('wb') as f:
            plistlib.dump(dict(CFBundleIdentifier='test.coco.i1.'+token,CFBundleName='Probe-'+token,
                CFBundleExecutable='probe',CFBundleVersion='1',CFBundlePackageType='APPL',
                CFBundleShortVersionString='1',CFBundleIconFile='stock.png'),f)
        self.call('codesign','--force','--sign','-',str(self.app))
        self.measurements.append(dict(test=self._testMethodName,picture=label,app=str(self.app),bundle_id='test.coco.i1.'+token))
        return self.app
    @classmethod
    def call(cls,*args,**kw):
        kw.setdefault('env',cls.env)
        r=subprocess.run(args,capture_output=True,text=True,timeout=90,**kw)
        if r.returncode: raise AssertionError((args,r.returncode,r.stdout,r.stderr))
        return r
    def script(self,*args,code=0):
        before=resource.getrusage(resource.RUSAGE_CHILDREN); start=time.perf_counter(); loads=os.getloadavg()
        r=subprocess.run(['/bin/sh',str(self.script_path),*args,'--app',str(self.app)],env=self.env,capture_output=True,text=True,timeout=90)
        after=resource.getrusage(resource.RUSAGE_CHILDREN)
        self.measurements.append(dict(args=args,app=str(self.app),wall=time.perf_counter()-start,cpu=after.ru_utime+after.ru_stime-before.ru_utime-before.ru_stime,load_start=loads,load_end=os.getloadavg(),code=r.returncode,stdout=r.stdout,stderr=r.stderr))
        if args and args[0]=='apply' and '--dry-run' not in args and (self.app/'Icon\r').exists():
            self.preserve_resource('script-apply')
        if code is not None:self.assertEqual(r.returncode,code,r.stdout+r.stderr)
        return r
    def preserve_resource(self,label,raw=None):
        if raw is None:raw=(self.app/'Icon\r/..namedfork/rsrc').read_bytes()
        folder=ARTIFACTS/'resource-forks';folder.mkdir(exist_ok=True)
        path=folder/(label+'-'+self.app.stem+'.rsrc');path.write_bytes(raw)
        self.measurements.append(dict(resource_evidence=label,app=str(self.app),resource_path=str(path),
            resource_bytes=len(raw),resource_sha256=hashlib.sha256(raw).hexdigest()))
        return path
    def reset(self):
        self.script('clear','--report')
        self.consent.unlink(missing_ok=True)
    def measure_diff(self,name):
        source=self.script_path.read_text(); jxa=re.search(r"JXA_COMPARE='([\s\S]*?)\n'",source)[1]
        stock=[] if (self.app/'Icon\r').exists() else [str(self.app/'Contents/Resources/stock.png')]
        r=self.call('osascript','-l','JavaScript','-e',jxa,str(self.app),str(ROOT/'plugin/assets/icon/claude-tile-dake-1024.png'),str(ROOT/'plugin/assets/icon/recognise-0.1-64.png'),'measure',*stock)
        text=r.stdout.strip()
        try: metrics=json.loads(text)
        except json.JSONDecodeError: metrics=None
        self.measurements.append(dict(picture=name,app=str(self.app),differences=text,comparison=metrics))
        return metrics
    def test_off_refuses_without_mutation_and_readonly_clear_still_work(self):
        self.reset(); self.script('apply','--report',code=2)
        self.assertFalse((self.app/'Icon\r').exists())
        self.assertNotIn('com.apple.FinderInfo',self.call('xattr',str(self.app)).stdout)
        self.assertEqual(self.script('status','--report').stdout,'icon: stock\n')
        self.script('apply','--dry-run','--report')
        self.script('clear','--report')
    def test_apply_status_clear_signature_and_legacy_custom(self):
        self.reset(); self.measure_diff('stock')
        self.fresh_case('badge')
        self.consent.write_text('on\n')
        result=self.script('apply','--report')
        self.measure_diff('badge')
        self.assertEqual(result.stdout,'icon: own\n')
        self.assertEqual(self.script('status','--report').stdout,'icon: own\n')
        from PIL import Image
        stranger=self.base/'stranger.png'
        Image.new('RGBA',(1024,1024),(255,0,0,255)).save(stranger)
        self.fresh_case('stranger'); self.consent.write_text('on\n')
        self.assertEqual(self.script('apply','--icon',str(stranger),'--report').stdout,'icon: custom\n')
        self.measure_diff('stranger red square')
        self.fresh_case('legacy'); self.consent.write_text('on\n')
        self.assertEqual(self.script('apply','--icon',str(ROOT/'plugin/assets/icon/recognise-0.1-source-1024.png'),'--report').stdout,'icon: legacy\n')
        self.measure_diff('legacy')
        self.assertEqual(self.script('clear','--revoke-consent','--report').stdout,'icon: stock\n')
        self.assertFalse(self.consent.exists())
        self.call('codesign','--verify','--strict',str(self.app))
    def render(self,label=None,source=None):
        jxa='''ObjC.import("AppKit"); function run(a) { var image=a.length>2?$.NSImage.alloc.initWithContentsOfFile($(a[2])):$.NSWorkspace.sharedWorkspace.iconForFile($(a[0])); var sizes=[16,32,64,512]; for(var i=0;i<sizes.length;i++){var n=sizes[i];var b=$.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(null,n,n,8,4,true,false,$.NSCalibratedRGBColorSpace,0,0);$.NSGraphicsContext.saveGraphicsState;$.NSGraphicsContext.setCurrentContext($.NSGraphicsContext.graphicsContextWithBitmapImageRep(b));image.drawInRectFromRectOperationFractionRespectFlippedHints($.NSMakeRect(0,0,n,n),$.NSZeroRect,$.NSCompositingOperationCopy,1,false,$());$.NSGraphicsContext.restoreGraphicsState;b.representationUsingTypeProperties($.NSBitmapImageFileTypePNG,$({})).writeToFileAtomically($(a[1]+"/finder-"+n+".png"),true);}return "ok";}'''
        out=ARTIFACTS/label if label else ARTIFACTS
        out.mkdir(parents=True,exist_ok=True)
        self.call('osascript','-l','JavaScript','-e',jxa,str(self.app),str(out),*([str(source)] if source else []))
        return out
    def test_calibration_all_states_before_classification_assertions(self):
        self.reset();self.measure_diff('calibration stock')
        from PIL import Image
        stranger=self.base/'calibration-stranger.png';Image.new('RGBA',(1024,1024),(255,0,0,255)).save(stranger)
        self.consent.write_text('on\n');results=[]
        for label,icon,state in [('badge',None,'own'),('flower',self.base/'assets/icon/coco-1024.png','custom'),('stranger',stranger,'custom'),('legacy',self.base/'assets/icon/recognise-0.1-source-1024.png','legacy')]:
            self.fresh_case('calibration-'+label); self.consent.write_text('on\n')
            args=['apply','--report']
            if icon:args.extend(['--icon',str(icon)])
            result=self.script(*args,code=None)
            self.measure_diff('calibration '+label)
            results.append((label,result.returncode,result.stdout,state))
        self.script('clear','--report')
        for label,code,stdout,state in results:
            with self.subTest(picture=label):self.assertEqual((code,stdout),(0,'icon: '+state+'\n'))

    def test_public_status_uses_fresh_resource_bytes_for_badge_flower_stranger_and_legacy(self):
        # No rendered NSWorkspace pixels are accepted as proof of this classification.
        from PIL import Image
        stranger=self.base/'resource-stranger.png'
        Image.new('RGBA',(1024,1024),(255,0,0,255)).save(stranger)
        results=[]
        for label,icon,state in [('badge',None,'own'),('flower',self.base/'assets/icon/coco-1024.png','custom'),
                                 ('stranger',stranger,'custom'),('legacy',self.base/'assets/icon/recognise-0.1-source-1024.png','legacy')]:
            self.fresh_case('resource-status-'+label);self.consent.write_text('on\n')
            args=['apply','--report']
            if icon:args.extend(['--icon',str(icon)])
            applied=self.script(*args,code=None)
            fork=(self.app/'Icon\r/..namedfork/rsrc').read_bytes()
            self.assertGreater(len(fork),16)
            self.measurements.append(dict(resource_status_case=label,app=str(self.app),resource_bytes=len(fork),
                resource_sha256=hashlib.sha256(fork).hexdigest(),apply_exit=applied.returncode,apply_stdout=applied.stdout))
            metrics=self.measure_diff('fresh resource '+label)
            measured=self.script('status','--report',code=None)
            results.append((label,state,measured.returncode,measured.stdout,metrics))
        for label,state,code,stdout,metrics in results:
            with self.subTest(picture=label):
                self.assertEqual((code,stdout),(0,'icon: '+state+'\n'))
                self.assertIsInstance(metrics,dict)
                self.assertEqual(metrics['backend'],'resource')

    def test_public_status_corrupt_custom_resources_fail_closed_on_fresh_bundles(self):
        import struct
        def locate(raw):
            data_offset,map_offset,data_length,map_length=struct.unpack_from('>IIII',raw,0)
            types=map_offset+struct.unpack_from('>H',raw,map_offset+24)[0]
            count=struct.unpack_from('>H',raw,types)[0]+1
            for index in range(count):
                entry=types+2+8*index
                if raw[entry:entry+4]!=b'icns':continue
                refs=types+struct.unpack_from('>H',raw,entry+6)[0]
                resources=struct.unpack_from('>H',raw,entry+4)[0]+1
                for number in range(resources):
                    ref=refs+12*number
                    if struct.unpack_from('>h',raw,ref)[0]==-16455:
                        pointer=int.from_bytes(raw[ref+5:ref+8],'big')
                        return data_offset,map_offset,map_length,types,entry,ref,data_offset+pointer
            raise AssertionError('actual installed resource fork has no custom icns ID -16455')
        cases=['truncated-header','truncated-map','overlapping-data-map','reference-out-of-bounds',
               'data-pointer-out-of-bounds','data-length-out-of-bounds','wrong-custom-id','duplicate-custom-icns']
        results=[]
        for label in cases:
            self.fresh_case('corrupt-'+label);self.consent.write_text('on\n')
            self.script('apply','--report',code=None)
            path=self.app/'Icon\r/..namedfork/rsrc'
            original=path.read_bytes();self.assertGreater(len(original),16)
            data,map_offset,map_length,types,entry,ref,payload=locate(original)
            raw=bytearray(original)
            if label=='truncated-header':raw=raw[:15]
            elif label=='truncated-map':raw=raw[:-1]
            elif label=='overlapping-data-map':struct.pack_into('>I',raw,4,data)
            elif label=='reference-out-of-bounds':struct.pack_into('>H',raw,entry+6,0xffff)
            elif label=='data-pointer-out-of-bounds':raw[ref+5:ref+8]=b'\xff\xff\xff'
            elif label=='data-length-out-of-bounds':struct.pack_into('>I',raw,payload,len(raw)+1)
            elif label=='wrong-custom-id':struct.pack_into('>h',raw,ref,1)
            elif label=='duplicate-custom-icns':
                duplicate_at=map_offset+struct.unpack_from('>H',raw,map_offset+26)[0]
                self.assertLessEqual(duplicate_at-types,0xffff)
                raw[duplicate_at:duplicate_at]=original[ref:ref+12]*2
                struct.pack_into('>H',raw,entry+4,1)
                struct.pack_into('>H',raw,entry+6,duplicate_at-types)
                struct.pack_into('>H',raw,map_offset+26,duplicate_at-map_offset+24)
                struct.pack_into('>I',raw,12,map_length+24)
                raw[map_offset:map_offset+16]=raw[:16]
            path.write_bytes(raw)
            self.preserve_resource('corrupt-'+label,raw)
            result=self.script('status','--report',code=None)
            self.measurements.append(dict(corrupt_resource=label,app=str(self.app),bytes=len(raw),
                before_sha256=hashlib.sha256(original).hexdigest(),after_sha256=hashlib.sha256(raw).hexdigest(),
                code=result.returncode,stdout=result.stdout))
            results.append((label,result.returncode,result.stdout))
        for label,code,stdout in results:
            with self.subTest(resource=label):self.assertEqual((code,stdout),(1,'icon: unknown\n'))

    @unittest.skipIf(SKIP_WORKSPACE, REAL_WORKSPACE_REASON)
    def test_real_workspace_calibration_readback_all_fresh_cases(self):
        from PIL import Image
        stranger=self.base/'workspace-calibration-stranger.png'
        Image.new('RGBA',(1024,1024),(255,0,0,255)).save(stranger)
        for label,icon in [('stock',None),('badge',None),('flower',self.base/'assets/icon/coco-1024.png'),
                           ('stranger',stranger),('legacy',self.base/'assets/icon/recognise-0.1-source-1024.png')]:
            self.fresh_case('workspace-calibration-'+label)
            if label!='stock':
                self.consent.write_text('on\n');args=['apply','--report']
                if icon:args.extend(['--icon',str(icon)])
                self.script(*args)
            self.render('calibration-'+label)

    def test_valid_resource_without_icns_fallback_cannot_claim_own_or_legacy(self):
        import struct
        self.consent.write_text('on\n');self.script('apply','--report',code=None)
        path=self.app/'Icon\r/..namedfork/rsrc';raw=bytearray(path.read_bytes())
        map_offset=struct.unpack_from('>I',raw,4)[0]
        types=map_offset+struct.unpack_from('>H',raw,map_offset+24)[0]
        count=struct.unpack_from('>H',raw,types)[0]+1;changed=0
        for index in range(count):
            at=types+2+8*index
            if raw[at:at+4]==b'icns':raw[at:at+4]=b'zzzz';changed+=1
        self.assertEqual(changed,1)
        path.write_bytes(raw)
        self.preserve_resource('valid-map-without-icns',raw)
        result=self.script('status','--report',code=None)
        self.assertIn((result.returncode,result.stdout),[(0,'icon: custom\n'),(1,'icon: unknown\n')])
        metrics=self.measure_diff('valid map without icns: conservative fallback')
        self.assertIsInstance(metrics,dict);self.assertEqual(metrics['backend'],'workspace')
        self.assertIn(metrics['state'],['custom','unknown'])

    def test_clear_restores_strict_signature_independent_of_recognition(self):
        self.reset();self.consent.write_text('on\n')
        self.script('apply','--report',code=None)
        self.assertTrue((self.app/'Icon\r').exists())
        plain=subprocess.run(['/usr/bin/codesign','--verify',str(self.app)],env=self.env,capture_output=True,text=True,timeout=30)
        strict=subprocess.run(['/usr/bin/codesign','--verify','--strict',str(self.app)],env=self.env,capture_output=True,text=True,timeout=30)
        self.measurements.append(dict(signature_while_custom=dict(plain_exit=plain.returncode,strict_exit=strict.returncode,
            plain_stderr=plain.stderr,strict_stderr=strict.stderr)))
        self.assertEqual(self.script('clear','--revoke-consent','--report').stdout,'icon: stock\n')
        self.assertFalse((self.app/'Icon\r').exists())
        self.assertNotIn('com.apple.FinderInfo',self.call('xattr',str(self.app)).stdout)
        self.call('codesign','--verify','--strict',str(self.app))
        self.assertEqual(plain.returncode,0,plain.stderr)
        self.assertNotEqual(strict.returncode,0,strict.stderr)

    @unittest.skipIf(SKIP_WORKSPACE, REAL_WORKSPACE_REASON)
    def test_direct_badge_png_workspace_readback(self):
        self.reset()
        jxa='''ObjC.import("AppKit");function run(a){var w=$.NSWorkspace.sharedWorkspace;var i=$.NSImage.alloc.initWithContentsOfFile($(a[1]));if(!i.isValid)throw new Error("invalid source");var ok=w.setIconForFileOptions(i,$(a[0]),0);w.noteFileSystemChanged($(a[0]));return ok?"ok":"fail";}'''
        self.call('osascript','-l','JavaScript','-e',jxa,str(self.app),str(ROOT/'plugin/assets/icon/claude-tile-dake-1024.png'))
        self.preserve_resource('direct-png-workspace')
        self.measure_diff('badge direct PNG; cache notified')
        out=self.render()
        from PIL import Image
        rgba=Image.open(out/'finder-64.png').convert('RGBA').tobytes()
        pixels=list(zip(rgba[0::4],rgba[1::4],rgba[2::4],rgba[3::4]))
        self.assertTrue(any(a>0 for r,g,b,a in pixels),'workspace badge has no visible pixels')
        self.assertTrue(any(a>0 and max(r,g,b)>0 for r,g,b,a in pixels),'workspace badge is black')
        self.assertTrue(any(a>0 and (r!=g or g!=b) for r,g,b,a in pixels),'workspace badge is greyscale')
        stranger=self.base/'workspace-badge-stranger.png';Image.new('RGBA',(1024,1024),(255,0,0,255)).save(stranger)
        differences={}
        workspace_app,workspace_env,workspace_consent=self.app,self.env,self.consent
        for label,source in [('badge',ROOT/'plugin/assets/icon/claude-tile-dake-1024.png'),
                             ('flower',ROOT/'plugin/assets/icon/coco-1024.png'),
                             ('legacy',ROOT/'plugin/assets/icon/recognise-0.1-source-1024.png'),('stranger',stranger)]:
            self.fresh_case('workspace-badge-reference-'+label)
            expected=self.render('direct-badge-reference-'+label,source)
            reference=Image.open(expected/'finder-64.png').convert('RGBA').tobytes()
            self.assertEqual(len(rgba),len(reference))
            differences[label]=sum(abs(a-b) for a,b in zip(rgba,reference))/len(rgba)
        self.app,self.env,self.consent=workspace_app,workspace_env,workspace_consent
        self.measurements.append(dict(workspace_badge_comparison=differences,app=str(self.app),
            visible_pixels=sum(a>0 for r,g,b,a in pixels),comparison_rule='badge strictly nearest among badge/flower/legacy/stranger; no shipping-threshold change'))
        for label in ['flower','legacy','stranger']:
            with self.subTest(workspace_reference=label):self.assertLess(differences['badge'],differences[label])
        self.assertEqual(self.script('status','--report').stdout,'icon: own\n')
        self.script('clear','--report')

    def test_direct_small_png_appkit_decode(self):
        from PIL import Image
        jxa='''ObjC.import("AppKit");function run(a){var b=$.NSBitmapImageRep.imageRepWithContentsOfFile($(a[0]));b.representationUsingTypeProperties($.NSBitmapImageFileTypePNG,$({})).writeToFileAtomically($(a[1]),true);return "ok";}'''
        for size in (16,32):
            self.fresh_case('small-appkit-decode-'+str(size))
            src=ROOT/f'plugin/assets/icon/coco-{size}.png';out=ARTIFACTS/f'native-source-{size}.png'
            self.call('osascript','-l','JavaScript','-e',jxa,str(src),str(out))
            self.assertEqual(Image.open(src).convert('RGBA').tobytes(),Image.open(out).convert('RGBA').tobytes())

    def test_direct_badge_png_resource_classification_without_workspace_readback(self):
        jxa='''ObjC.import("AppKit");function run(a){var w=$.NSWorkspace.sharedWorkspace;var image=$.NSImage.alloc.initWithContentsOfFile($(a[1]));if(!image.isValid)throw new Error("invalid source");if(!w.setIconForFileOptions(image,$(a[0]),0))throw new Error("set failed");w.noteFileSystemChanged($(a[0]));return "ok";}'''
        self.call('osascript','-l','JavaScript','-e',jxa,str(self.app),str(ROOT/'plugin/assets/icon/claude-tile-dake-1024.png'))
        fork=(self.app/'Icon\r/..namedfork/rsrc').read_bytes();self.assertGreater(len(fork),16)
        self.preserve_resource('direct-png-resource',fork)
        self.measurements.append(dict(direct_png_resource_bytes=len(fork),app=str(self.app),resource_sha256=hashlib.sha256(fork).hexdigest()))
        self.assertEqual(self.script('status','--report').stdout,'icon: own\n')
        metrics=self.measure_diff('direct badge PNG resource')
        self.assertIsInstance(metrics,dict);self.assertEqual(metrics['backend'],'resource')
        self.script('clear','--report')

    def test_one_visible_pixel_changed_badge_is_custom_despite_near_zero_small_distance(self):
        from PIL import Image
        image=Image.open(ROOT/'plugin/assets/icon/claude-tile-dake-1024.png').convert('RGBA')
        original=image.tobytes();pixels=image.load();changed=None
        for y in range(image.height):
            for x in range(image.width):
                r,g,b,a=pixels[x,y]
                if a==255:
                    pixels[x,y]=(r^128,g,b,a);changed=(x,y);break
            if changed is not None:break
        self.assertIsNotNone(changed)
        self.assertEqual(sum(a!=b for a,b in zip(original,image.tobytes())),1)
        picture=self.base/'one-visible-pixel-changed-badge.png';image.save(picture)
        jxa='''ObjC.import("AppKit");function run(a){var w=$.NSWorkspace.sharedWorkspace;var image=$.NSImage.alloc.initWithContentsOfFile($(a[1]));if(!image.isValid)throw new Error("invalid source");if(!w.setIconForFileOptions(image,$(a[0]),0))throw new Error("set failed");w.noteFileSystemChanged($(a[0]));return "ok";}'''
        self.call('osascript','-l','JavaScript','-e',jxa,str(self.app),str(picture))
        self.preserve_resource('one-visible-pixel-changed-badge')
        metrics=self.measure_diff('one visible pixel changed badge')
        self.assertIsInstance(metrics,dict);self.assertEqual(metrics['backend'],'resource')
        self.assertIs(metrics['exactCurrent'],False)
        self.assertLess(metrics['own'],1)
        self.assertEqual(self.script('status','--report').stdout,'icon: custom\n')
        self.measurements.append(dict(one_pixel_changed=list(changed),source_sha256=hashlib.sha256(original).hexdigest(),
            changed_source_sha256=hashlib.sha256(image.tobytes()).hexdigest(),app=str(self.app)))

    def test_legacy_quarter_opaque_rgb_plus_one_reencoding_is_recognised_with_positive_distance(self):
        from PIL import Image
        image=Image.open(ROOT/'plugin/assets/icon/recognise-0.1-source-1024.png').convert('RGBA')
        original=image.tobytes();pixels=image.load()
        opaque=[(x,y) for y in range(image.height) for x in range(image.width) if pixels[x,y][3]==255]
        selected=opaque[::4]
        for x,y in selected:
            r,g,b,a=pixels[x,y];pixels[x,y]=(min(255,r+1),min(255,g+1),min(255,b+1),a)
        changed=image.tobytes()
        self.assertGreater(sum(a!=b for a,b in zip(original,changed)),0)
        self.assertEqual(original[3::4],changed[3::4])
        picture=self.base/'legacy-quarter-opaque-plus-one.png';image.save(picture)
        self.measurements.append(dict(legacy_reencoding='one quarter opaque RGB plus one clamped',
            opaque_pixels=len(opaque),selected_pixels=len(selected),source_sha256=hashlib.sha256(original).hexdigest(),
            changed_source_sha256=hashlib.sha256(changed).hexdigest(),app=str(self.app)))
        self.consent.write_text('on\n')
        result=self.script('apply','--icon',str(picture),'--report',code=None)
        metrics=self.measure_diff('legacy quarter opaque RGB plus one reencoding')
        self.assertIsInstance(metrics,dict);self.assertEqual(metrics['backend'],'resource')
        self.assertGreater(metrics['legacy'],0)
        self.assertTrue(metrics['legacyEligibility']['eligible'])
        self.assertEqual(len(metrics['legacyRepresentations']),10)
        for representation in metrics['legacyRepresentations']:
            bounds=metrics['legacyBounds'].get(str(representation['width']),metrics['legacyBounds'])
            for field in ('maskError','gradient','color','opaqueColor'):
                self.assertLessEqual(representation['features'][field],bounds[field])
        self.assertEqual((result.returncode,result.stdout),(0,'icon: legacy\n'))
        self.assertEqual(self.script('status','--report').stdout,'icon: legacy\n')

    def install_exact_icns_resource(self, label, picture):
        """Preserve every corpus chunk in a valid Finder custom resource on our dummy."""
        import struct
        icns=Path(picture).read_bytes()
        self.assertEqual(icns[:4],b'icns')
        self.assertEqual(int.from_bytes(icns[4:8],'big'),len(icns))
        data=struct.pack('>I',len(icns))+icns
        header=struct.pack('>IIII',256,256+len(data),len(data),50)
        resource_map=(header+bytes(8)+struct.pack('>HH',28,50)+struct.pack('>H',0)
            +b'icns'+struct.pack('>HH',0,10)+struct.pack('>hH',-16455,65535)+bytes(8))
        self.assertEqual(len(resource_map),50)
        icon=self.app/'Icon\r';icon.touch()
        raw=header+bytes(240)+data+resource_map
        (icon/'..namedfork/rsrc').write_bytes(raw)
        self.assertEqual((icon/'..namedfork/rsrc').read_bytes(),raw)
        flag=bytearray(32);flag[8]=4
        self.call('/usr/bin/xattr','-wx','com.apple.FinderInfo',bytes(flag).hex(),str(self.app))
        self.preserve_resource('corpus-'+label)

    def test_legacy_acceptance_requires_each_finite_feature_and_supported_width(self):
        source=self.script_path.read_text()
        jxa=re.search(r"JXA_COMPARE='([\s\S]*?)\n'",source)[1]
        self.assertEqual(jxa.count('function run(argv)'),1)
        jxa=jxa.replace('function run(argv)','function resourceRun(argv)')
        jxa+=r"""
function run(argv) {
  var fields=["maskError","gradient","color","opaqueColor"], output=[];
  function base(width) {
    var bounds=legacyBounds[width] || legacyBounds, f={opaquePixels:2000,comparedEdges:3800};
    for(var i=0;i<fields.length;i++) f[fields[i]]=bounds[fields[i]]/2;
    return f;
  }
  function record(name, features, width, expected) {
    output.push({name:name,actual:legacyAccepted(features,width),expected:expected});
  }
  var widths=[16,32,64,128,256,512,1024];
  for(var w=0;w<widths.length;w++) {
    var width=widths[w],bounds=legacyBounds[width] || legacyBounds;
    record("all-inside-"+width,base(width),width,true);
    for(var k=0;k<fields.length;k++) {
      var f=base(width),name=fields[k];
      f[name]=bounds[name]+Math.max(1e-7,bounds[name]/10);
      record("only-"+name+"-above-"+width,f,width,false);
      f=base(width);delete f[name];record("missing-"+name+"-"+width,f,width,false);
    }
  }
  var invalid=[null,undefined,NaN,Infinity,-1,"0"];
  for(var j=0;j<invalid.length;j++) {
    var f=base(64);f.maskError=invalid[j];record("invalid-feature-"+j,f,64,false);
  }
  var unsupported=[0,15,48,1025,NaN,"64"];
  for(var j=0;j<unsupported.length;j++) record("unsupported-width-"+j,base(64),unsupported[j],false);
  record("null-features",null,64,false);record("empty-features",{},64,false);
  return JSON.stringify(output);
}
"""
        result=self.call('osascript','-l','JavaScript','-e',jxa)
        cases=json.loads(result.stdout)
        self.assertEqual(len(cases),77)
        (ARTIFACTS/'legacy-boundary-vectors.json').write_text(json.dumps(cases,indent=2))
        for case in cases:
            with self.subTest(case=case['name']):
                self.assertIs(case['actual'],case['expected'])

    def test_foreign_alpha_edit_is_custom_not_a_legacy_removal_offer(self):
        from PIL import Image
        from icon_legacy_corpus import _icns
        with Image.open(ROOT/'plugin/assets/icon/recognise-0.1-rep-64.png') as source:
            image=source.convert('RGBA')
        positions=[(x,y) for y in range(4,56) for x in range(4,56)
            if all(image.getpixel((x+dx,y+dy))[3]>=240 for dy in range(4) for dx in range(4))]
        self.assertTrue(positions)
        x,y=min(positions,key=lambda p:(p[0]-32)**2+(p[1]-32)**2)
        original=image.tobytes()
        for extent in (1,2,4):
            with self.subTest(extent=extent):
                self.fresh_case('foreign-alpha-edit-'+str(extent))
                edited=image.copy()
                for dy in range(extent):
                    for dx in range(extent):
                        r,g,b,a=edited.getpixel((x+dx,y+dy))
                        edited.putpixel((x+dx,y+dy),(r,g,b,0))
                self.assertEqual(original[0::4],edited.tobytes()[0::4])
                self.assertEqual(original[1::4],edited.tobytes()[1::4])
                self.assertEqual(original[2::4],edited.tobytes()[2::4])
                self.assertEqual(sum(a!=b for a,b in zip(original[3::4],edited.tobytes()[3::4])),extent*extent)
                png=self.base/('foreign-alpha-edit-'+str(extent)+'.png');edited.save(png)
                picture=_icns(self.base/('foreign-alpha-edit-'+str(extent)+'.icns'),[(b'icp6',png.read_bytes())])
                self.install_exact_icns_resource('foreign-alpha-edit-'+str(extent),picture)
                metrics=self.measure_diff('foreign-alpha-edit-'+str(extent))
                self.assertEqual(metrics['backend'],'resource')
                self.assertEqual(self.script('status','--report').stdout,'icon: custom\n')

    def test_mixed_legacy_large_and_foreign_small_are_custom_in_both_orders(self):
        from icon_legacy_corpus import _icns
        large=(ROOT/'plugin/assets/icon/recognise-0.1-source-1024.png').read_bytes()
        small=(ROOT/'plugin/assets/icon/coco-16.png').read_bytes()
        for label,chunks in [('small-first',[(b'icp4',small),(b'ic10',large)]),
                             ('large-first',[(b'ic10',large),(b'icp4',small)])]:
            self.fresh_case('mixed-'+label)
            picture=_icns(self.base/('mixed-'+label+'.icns'),chunks)
            self.install_exact_icns_resource('mixed-'+label,picture)
            metrics=self.measure_diff('mixed-'+label)
            self.assertEqual(metrics['backend'],'resource')
            self.assertEqual(metrics['width'],1024)
            self.assertIs(metrics['exactCurrent'],False)
            self.assertTrue({16,1024}.issubset({r['width'] for r in metrics['legacyRepresentations']}))
            self.assertEqual(self.script('status','--report').stdout,'icon: custom\n')

    def test_documented_icns_metadata_preserves_legacy_and_rejects_malformed(self):
        import struct
        from icon_legacy_corpus import _icns, metadata_chunks, ACTUAL_ICONUTIL_INFO
        image = [(b'icp6', (ROOT/'plugin/assets/icon/recognise-0.1-rep-64.png').read_bytes())]
        metadata = metadata_chunks(image)
        cases = [('valid-'+kind.decode().strip(), True, image+[(kind,payload)])
                 for kind,payload in metadata]
        cases.append(('valid-all-metadata', True, metadata[:2]+image+metadata[2:]))
        self.assertEqual(hashlib.sha256(ACTUAL_ICONUTIL_INFO).hexdigest(),
            '2e2d6939137875b0cf88bac255cc5697633279a39629ae8f18e4c57940423345')
        self.assertEqual(plistlib.loads(ACTUAL_ICONUTIL_INFO),plistlib.loads(metadata[0][1]))
        cases.append(('valid-actual-iconutil-info', True, image+[(b'info',ACTUAL_ICONUTIL_INFO)]))
        info = metadata[0][1]
        cases.extend([
            ('malformed-info-truncated', False, image+[(b'info',info[:-1])]),
            ('malformed-info-empty', False, image+[(b'info',b'')]),
            ('malformed-info-not-plist', False, image+[(b'info',b'not a plist')]),
            ('malformed-info-array-root', False, image+[(b'info',plistlib.dumps([],fmt=plistlib.FMT_BINARY))]),
            ('malformed-name-invalid-utf8', False, image+[(b'name',b'\xff\xfe')]),
            ('malformed-toc-length', False, image+[(b'TOC ',b'icp6\x00\x00\x00')]),
            ('malformed-toc-entry-length', False, image+[(b'TOC ',b'icp6'+struct.pack('>I',7))]),
            ('malformed-toc-mismatch', False, image+[(b'TOC ',b'icp6'+struct.pack('>I',len(image[0][1])+9))]),
            ('malformed-toc-unknown-type', False, image+[(b'TOC ',b'ZZZZ'+struct.pack('>I',len(image[0][1])+8))]),
            ('malformed-toc-duplicate-entry', False, image+[(b'TOC ',metadata[2][1]*2)]),
            ('malformed-version-length', False, image+[(b'icnV',b'\x3f\x80\x00')]),
            ('malformed-version-nonfinite', False, image+[(b'icnV',struct.pack('>f',float('nan')))]),
            ('malformed-version-negative', False, image+[(b'icnV',struct.pack('>f',-1))]),
            ('duplicate-info', False, image+[(b'info',info),(b'info',info)]),
            ('duplicate-name', False, image+[(b'name',b'icon'),(b'name',b'icon')]),
            ('duplicate-toc', False, image+[metadata[2],metadata[2]]),
            ('duplicate-version', False, image+[metadata[3],metadata[3]]),
            ('unknown-metadata', False, image+[(b'ZZZZ',info)]),
            ('duplicate-image-with-info', False, image+image+[(b'info',info)]),
        ])
        rows=[]
        for label,positive,chunks in cases:
            self.fresh_case('metadata-'+label)
            picture=_icns(self.base/('metadata-'+label+'.icns'),chunks)
            self.install_exact_icns_resource('metadata-'+label,picture)
            result=self.script('status','--report',code=None)
            metrics=self.measure_diff('metadata-'+label)
            rows.append(dict(label=label,positive=positive,app=str(self.app),
                public_exit=result.returncode,public_stdout=result.stdout,metrics=metrics))
        # A metadata chunk claiming bytes in the following image overlaps its header.
        self.fresh_case('metadata-overlapping-info-length')
        picture=_icns(self.base/'metadata-overlapping-info-length.icns',[(b'info',info)]+image)
        raw=bytearray(picture.read_bytes())
        struct.pack_into('>I',raw,12,len(info)+8+4)
        picture.write_bytes(raw)
        self.install_exact_icns_resource('metadata-overlapping-info-length',picture)
        result=self.script('status','--report',code=None)
        rows.append(dict(label='overlapping-info-length',positive=False,app=str(self.app),
            public_exit=result.returncode,public_stdout=result.stdout,
            metrics=self.measure_diff('metadata-overlapping-info-length')))
        (ARTIFACTS/'metadata-cases.json').write_text(json.dumps(rows,indent=2))
        self.assertEqual(len({row['app'] for row in rows}),len(rows))
        for row in rows:
            with self.subTest(case=row['label']):
                metrics=row['metrics']
                self.assertIsInstance(metrics,dict)
                self.assertEqual(metrics['backend'],'resource')
                if row['positive']:
                    self.assertEqual((row['public_exit'],row['public_stdout']),(0,'icon: legacy\n'))
                    self.assertTrue(metrics['legacyEligibility']['eligible'])
                    self.assertEqual(metrics['legacyEligibility']['imageChunks'],1)
                    self.assertEqual(len(metrics['legacyRepresentations']),1)
                    for field in ('maskError','gradient','color','opaqueColor'):
                        self.assertEqual(metrics['legacyRepresentations'][0]['features'][field],0)
                else:
                    self.assertIn(row['public_stdout'],('icon: custom\n','icon: unknown\n'))
                    self.assertIn(metrics['state'],('custom','unknown'))
                    if 'legacyEligibility' in metrics:
                        self.assertFalse(metrics['legacyEligibility']['eligible'])
                        self.assertTrue(metrics['legacyEligibility']['reason'])
                    else:
                        self.assertTrue(metrics['error'])

    def test_legacy_corpus_public_status_and_all_feature_margins(self):
        from icon_legacy_corpus import generate_corpus
        records=generate_corpus(ROOT,self.base/'legacy-corpus',self.call)
        shutil.copytree(self.base/'legacy-corpus',ARTIFACTS/'legacy-corpus-inputs',dirs_exist_ok=True)
        sizes={16,32,64,128,256,512,1024}
        positive=[r for r in records if r['positive']]
        self.assertEqual({r['size'] for r in positive},sizes)
        self.assertEqual({r['size'] for r in positive if r['group']=='PNG-chunk'},sizes)
        self.assertEqual({r['size'] for r in positive if r['group']=='historical-representation'},sizes)
        self.assertEqual({r['size'] for r in positive if r['group']=='PNG-reencoded'},{16,32,64,128})
        labels={r['label'] for r in records}
        for size in sizes:
            for delta in (-2,2):
                self.assertIn('legacy-colour-%d-%+d' % (size,delta),labels)
        self.assertTrue({'legacy-alpha-only-hole','legacy-alpha-only-hole-2',
                         'legacy-alpha-only-hole-1'} <= labels)
        self.assertTrue({'legacy-iconutil-info-plist','legacy-iconutil-actual-info-plist',
                         'legacy-malformed-info-plist'} <= labels)
        synthetic=[r for r in records if r['group']=='negative-synthetic']
        self.assertEqual(len(synthetic),24)
        self.assertEqual(len({r['sha256'] for r in synthetic}),24)
        rows=[]
        for record in records:
            self.fresh_case('corpus-'+record['label'])
            self.install_exact_icns_resource(record['label'],record['path'])
            public=self.script('status','--report',code=None)
            metrics=self.measure_diff('corpus-'+record['label'])
            rows.append(dict(record,app=str(self.app),public_exit=public.returncode,
                public_stdout=public.stdout,metrics=metrics))
        # Retain all independently labelled inputs/results before any classification assertion.
        (ARTIFACTS/'legacy-corpus-results.json').write_text(json.dumps(rows,indent=2))
        for row in rows:
            with self.subTest(label=row['label'],positive=row['positive']):
                metrics=row['metrics']
                self.assertIsInstance(metrics,dict)
                self.assertEqual(metrics['backend'],'resource')
                # The badge of earlier builds (claude-tile-1024) is not one of the four pictures any more: the script
                # names it legacy (792dffc6), while the pixel measure, which knows only the 0.1 icon, finds it custom.
                public='legacy' if row['positive'] or row['label']=='badge' else 'custom'
                self.assertEqual((row['public_exit'],row['public_stdout']),(0,'icon: '+public+'\n'))
                self.assertEqual(metrics['state'],'legacy' if row['positive'] else 'custom')
        fields=('maskError','gradient','color','opaqueColor')
        positives={}
        for row in rows:
            if not row['positive']:continue
            metrics=row['metrics']
            self.assertTrue(metrics['legacyEligibility']['eligible'])
            self.assertTrue(metrics['legacyRepresentations'])
            for rep in metrics['legacyRepresentations']:
                self.assertEqual(rep['bitmapCount'],1)
                self.assertEqual(rep['height'],rep['width'])
                width=rep['width'];features=rep['features']
                bounds=metrics['legacyBounds'].get(str(width),metrics['legacyBounds'])
                worst=positives.setdefault(width,{field:0 for field in fields})
                for field in fields:
                    value=features[field]
                    self.assertIsInstance(value,(int,float))
                    self.assertTrue(__import__('math').isfinite(value))
                    self.assertGreaterEqual(value,0)
                    self.assertLess(value,bounds[field])
                    worst[field]=max(worst[field],value)
        exclusions=[]
        for row in rows:
            if row['positive']:continue
            metrics=row['metrics']
            if row.get('eligibility_expected') is False:
                self.assertFalse(metrics['legacyEligibility']['eligible'])
                self.assertTrue(metrics['legacyEligibility']['reason'])
                exclusions.append(dict(label=row['label'],structural_rejection=metrics['legacyEligibility']))
                continue
            ratios=[]
            for rep in metrics['legacyRepresentations']:
                width=rep['width'];features=rep['features']
                self.assertIn(width,positives)
                self.assertIsInstance(features,dict)
                bounds=metrics['legacyBounds'].get(str(width),metrics['legacyBounds'])
                for field in fields:
                    inside=bounds[field]-positives[width][field]
                    self.assertGreater(inside,0)
                    outside=features[field]-bounds[field]
                    ratios.append(dict(width=width,feature=field,positive_inside=inside,
                        negative_outside=outside,ratio=outside/inside))
            strongest=max(ratios,key=lambda item:item['ratio'])
            self.assertGreaterEqual(strongest['ratio'],3,row['label'])
            self.assertGreater(strongest['negative_outside'],0,row['label'])
            exclusions.append(dict(label=row['label'],**strongest))
        (ARTIFACTS/'legacy-negative-margins.json').write_text(json.dumps(dict(
            positive_worst_by_size=positives,negative_exclusions=exclusions),indent=2))

    def test_public_status_red_green_resources_are_foreign_and_distinct(self):
        from PIL import Image
        forks=[]
        for label,rgba in [('red',(255,0,0,255)),('green',(0,255,0,255))]:
            self.fresh_case('resource-'+label)
            picture=self.base/('resource-'+label+'.png');Image.new('RGBA',(512,512),rgba).save(picture)
            jxa='''ObjC.import("AppKit");function run(a){var w=$.NSWorkspace.sharedWorkspace;var image=$.NSImage.alloc.initWithContentsOfFile($(a[1]));if(!image.isValid)throw new Error("invalid source");if(!w.setIconForFileOptions(image,$(a[0]),0))throw new Error("set failed");w.noteFileSystemChanged($(a[0]));return "ok";}'''
            self.call('osascript','-l','JavaScript','-e',jxa,str(self.app),str(picture))
            fork=(self.app/'Icon\r/..namedfork/rsrc').read_bytes();self.assertGreater(len(fork),16)
            self.preserve_resource('colour-'+label,fork)
            forks.append(hashlib.sha256(fork).hexdigest())
            self.assertEqual(self.script('status','--report').stdout,'icon: custom\n')
            self.measurements.append(dict(resource_colour=label,app=str(self.app),resource_bytes=len(fork),resource_sha256=forks[-1]))
        self.assertNotEqual(forks[0],forks[1])

    @unittest.skipIf(SKIP_WORKSPACE, REAL_WORKSPACE_REASON)
    def test_fresh_signed_bundle_source_and_workspace_red_green_content(self):
        # The caller selects /private/tmp for TMPDIR; only our temporary parent is made searchable.
        self.base.chmod(0o755)
        from PIL import Image,ImageStat
        records=[]
        for label,rgba in [('red',(255,0,0,255)),('green',(0,255,0,255))]:
            app=self.fresh_case('workspace-'+label)
            picture=self.base/(label+'-control.png');Image.new('RGBA',(512,512),rgba).save(picture)
            out=ARTIFACTS/('fresh-'+label);out.mkdir(exist_ok=True)
            jxa='''ObjC.import("AppKit");function save(image,path){var b=$.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(null,64,64,8,4,true,false,$.NSCalibratedRGBColorSpace,0,0);$.NSGraphicsContext.saveGraphicsState;$.NSGraphicsContext.setCurrentContext($.NSGraphicsContext.graphicsContextWithBitmapImageRep(b));image.drawInRectFromRectOperationFractionRespectFlippedHints($.NSMakeRect(0,0,64,64),$.NSZeroRect,$.NSCompositingOperationCopy,1,false,$());$.NSGraphicsContext.restoreGraphicsState;b.representationUsingTypeProperties($.NSBitmapImageFileTypePNG,$({})).writeToFileAtomically($(path),true);}function run(a){var ws=$.NSWorkspace.sharedWorkspace;var source=$.NSImage.alloc.initWithContentsOfFile($(a[1]));save(source,a[2]+"/source-draw.png");var decoded=$.NSBitmapImageRep.imageRepWithContentsOfFile($(a[1]));decoded.representationUsingTypeProperties($.NSBitmapImageFileTypePNG,$({})).writeToFileAtomically($(a[2]+"/source-decode.png"),true);if(!ws.setIconForFileOptions(source,$(a[0]),0))throw new Error("set failed");ws.noteFileSystemChanged($(a[0]));var image=ws.iconForFile($(a[0]));var tiff=image.TIFFRepresentation;var b=$.NSBitmapImageRep.imageRepWithData(tiff);b.representationUsingTypeProperties($.NSBitmapImageFileTypePNG,$({})).writeToFileAtomically($(a[2]+"/workspace-tiff.png"),true);save(image,a[2]+"/workspace-draw.png");return ObjC.unwrap(image.description);}'''
            result=self.call('osascript','-l','JavaScript','-e',jxa,str(app),str(picture),str(out))
            # xattr -p formats some binary forks as a newline; measure the actual named fork.
            fork=(app/'Icon\r/..namedfork/rsrc').read_bytes()
            self.preserve_resource('workspace-colour-'+label,fork)
            item=dict(colour=label,workspace_description=result.stdout.strip(),resource_fork_source='namedfork/rsrc',
                resource_fork_bytes=len(fork),resource_fork_sha256=hashlib.sha256(fork).hexdigest(),means={})
            for name in ['source-decode','source-draw','workspace-tiff','workspace-draw']:
                item['means'][name]=ImageStat.Stat(Image.open(out/(name+'.png')).convert('RGBA')).mean
            records.append((item,rgba));self.measurements.append(item)
        # Capture both distinct identities and all source controls before any content assertion.
        for item,rgba in records:
            means=item['means']['source-decode']
            with self.subTest(colour=item['colour'],representation='source-decode'):
                self.assertEqual(means,list(rgba))
            dominant=0 if item['colour']=='red' else 1
            for name in ['source-draw','workspace-tiff','workspace-draw']:
                means=item['means'][name]
                with self.subTest(colour=item['colour'],representation=name):
                    self.assertGreaterEqual(means[dominant],240)
                    self.assertGreaterEqual(means[3],250)
                    self.assertLessEqual(means[2],40)
                    self.assertLessEqual(means[1-dominant],50)
        self.assertNotEqual(records[0][0]['resource_fork_sha256'],records[1][0]['resource_fork_sha256'])

    def test_stock_restore_key_is_stable_read_only_and_tracks_unique_dummy_update_identity(self):
        self.fresh_case('restore-key-stock')
        plist = self.app / 'Contents/Info.plist'
        def snapshot():
            files = {str(path.relative_to(self.app)): (path.read_bytes(), path.stat().st_ino, path.stat().st_mtime_ns)
                     for path in self.app.rglob('*') if path.is_file()}
            names = self.call('/usr/bin/xattr', str(self.app)).stdout.splitlines()
            attrs = {name: bytes.fromhex(self.call('/usr/bin/xattr', '-px', name, str(self.app)).stdout) for name in names}
            return files, attrs
        def key():
            result = self.script('status', '--report', '--restore-key')
            self.assertRegex(result.stdout, r'^icon: stock\nrestore-key: macos:\d+:\d+\n$')
            return result.stdout.splitlines()[1]
        before = snapshot()
        keys = [key() for _ in range(3)]
        self.assertEqual(keys, [keys[0]] * 3)
        self.assertEqual(snapshot(), before)
        self.call('codesign', '--verify', '--strict', str(self.app))
        self.assertEqual(self.script('status', '--report').stdout, 'icon: stock\n')
        data = plistlib.loads(plist.read_bytes())
        data.update(CFBundleVersion='2', CFBundleShortVersionString='2.0')
        plist.write_bytes(plistlib.dumps(data))
        self.call('codesign', '--force', '--sign', '-', str(self.app))
        updated = key()
        self.assertNotEqual(updated, keys[0])
        replacement = plist.with_name('Info.replacement.plist')
        replacement.write_bytes(plist.read_bytes())
        replacement.replace(plist)
        replaced = key()
        self.assertNotEqual(replaced, updated)
        self.assertEqual(key(), replaced)
        self.call('codesign', '--verify', '--strict', str(self.app))

    def test_linux_stock_restore_key_uses_packaged_launcher_without_writes(self):
        data = self.base / ('restore-data-' + uuid.uuid4().hex)
        package = self.base / ('restore-package-' + uuid.uuid4().hex)
        (package / 'applications').mkdir(parents=True)
        launcher = package / 'applications/claude.desktop'
        launcher.write_text('[Desktop Entry]\nType=Application\nName=Claude\nExec=claude\nIcon=claude\n')
        env = dict(self.env, COCO_ALLOW_ANY_OS='1', XDG_DATA_HOME=str(data), XDG_DATA_DIRS=str(package))
        def key():
            result = subprocess.run(['/bin/sh', str(ROOT / 'plugin/bin/icon-linux.sh'), 'status', '--report', '--restore-key', '--launcher', str(launcher)],
                                    env=env, capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertRegex(result.stdout, r'^icon: stock\nrestore-key: linux:\d+:\d+\n$')
            return result.stdout.splitlines()[1]
        before = (launcher.read_bytes(), launcher.stat().st_ino, launcher.stat().st_mtime_ns)
        keys = [key() for _ in range(3)]
        self.assertEqual(keys, [keys[0]] * 3)
        self.assertEqual(before, (launcher.read_bytes(), launcher.stat().st_ino, launcher.stat().st_mtime_ns))
        self.assertFalse(data.exists())
        launcher.write_text(launcher.read_text().replace('Exec=claude', 'Exec=claude --updated'))
        updated = key()
        self.assertNotEqual(updated, keys[0])
        replacement = launcher.with_name('replacement.desktop')
        replacement.write_bytes(launcher.read_bytes())
        replacement.replace(launcher)
        self.assertNotEqual(key(), updated)
        self.assertFalse(data.exists())

    def test_linux_script_path_timing_on_macos_scratch_only(self):
        data=self.base/'linux-data';package=self.base/'linux-package'
        (data/'applications').mkdir(parents=True,exist_ok=True)
        (package/'applications').mkdir(parents=True,exist_ok=True)
        launcher=package/'applications/claude.desktop'
        launcher.write_text('[Desktop Entry]\nType=Application\nName=Claude\nExec=claude\nIcon=claude\n')
        self.consent.write_text('on\n')
        env=dict(self.env,COCO_ALLOW_ANY_OS='1',XDG_DATA_HOME=str(data),XDG_DATA_DIRS=str(package))
        for action,expected in [('status','stock'),('apply','own'),('status','own'),('clear','stock')]:
            cpu=resource.getrusage(resource.RUSAGE_CHILDREN);start=time.perf_counter();load=os.getloadavg()
            r=subprocess.run(['/bin/sh',str(ROOT/'plugin/bin/icon-linux.sh'),action,'--report','--launcher',str(launcher)],env=env,capture_output=True,text=True,timeout=30)
            end=resource.getrusage(resource.RUSAGE_CHILDREN)
            self.measurements.append(dict(system='Linux script path on macOS; Linux host unverified',args=[action],wall=time.perf_counter()-start,cpu=end.ru_utime+end.ru_stime-cpu.ru_utime-cpu.ru_stime,load_start=load,load_end=os.getloadavg(),code=r.returncode))
            self.assertEqual((r.returncode,r.stdout),(0,'icon: '+expected+'\n'),r.stderr)
            if action=='apply': self.assertEqual((data/'coco/icons/coco.png').read_bytes(),(ROOT/'plugin/assets/icon/claude-tile-coco-512.png').read_bytes())

    def test_tuned_companion_icns_exact_representations(self):
        # Execute only the companion's icon-build block in a temporary stage; no build/install.
        s=(ROOT/'plugin/bin/companion-macos.sh').read_text()
        if os.environ.get('COCO_ICON_DEBUG'): s=s.replace('>/dev/null 2>&1','')
        if os.environ.get('COCO_ICON_MUTATION')=='tuned':
            s=s.replace('cp "$PLUGIN/assets/icon/coco-16.png" "$_set/icon_16x16.png"', 'sips -z 16 16 "$ICON" --out "$_set/icon_16x16.png" >/dev/null')
        a=s.index('  if [ -f "$ICON" ]');b=s.index('\n  /usr/bin/xcrun --sdk',a)
        stage=self.base/'icon-stage';stage.mkdir(exist_ok=True)
        new=self.app
        shell='set -eu\nPLUGIN="$1"\nICON="$PLUGIN/assets/icon/coco-1024.png"\nSTAGE="$2"\nNEW="$3"\nwarn() { echo "$*" >&2; }\n'+s[a:b]
        plugin=ROOT/'plugin'
        if os.environ.get('COCO_ICON_MUTATION')=='icns-png-small':
            plugin=self.base
            shutil.copyfile(ROOT/'tools/tests/fixtures/icon-icns-raw-small-broken.sh',plugin/'assets/icon/build-icns.sh')
        self.measurements.append(dict(seam_packer_sha256=hashlib.sha256((plugin/'assets/icon/build-icns.sh').read_bytes()).hexdigest()))
        result=self.call('/bin/sh','-c',shell,'fixture',str(plugin),str(stage),str(new))
        if not (new/'Contents/Resources/AppIcon.icns').exists(): shutil.copytree(stage/'AppIcon.iconset',ARTIFACTS/'failed-iconset',dirs_exist_ok=True)
        self.assertTrue((new/'Contents/Resources/AppIcon.icns').exists(),result.stdout+result.stderr)
        icns=(new/'Contents/Resources/AppIcon.icns').read_bytes()
        self.assertEqual(icns[:4],b'icns');self.assertEqual(int.from_bytes(icns[4:8],'big'),len(icns))
        chunks={};offset=8
        while offset<len(icns):
            size=int.from_bytes(icns[offset+4:offset+8],'big');self.assertGreaterEqual(size,8)
            chunks[icns[offset:offset+4]]=icns[offset+8:offset+size];offset+=size
        self.assertEqual(offset,len(icns))
        self.assertEqual(chunks[b'ic11'],(ROOT/'plugin/assets/icon/coco-32.png').read_bytes())
        self.measurements.append(dict(chunk='ic11',exact_png_bytes=True))
        extract=stage/'Extract.iconset';self.call('iconutil','-c','iconset',str(new/'Contents/Resources/AppIcon.icns'),'-o',str(extract))
        for name,size in [('icon_16x16.png',16),('icon_16x16@2x.png',32),('icon_32x32.png',32)]:
            # iconutil sometimes re-encodes containers; compare decoded byte arrays, not PNG metadata.
            from PIL import Image
            self.assertEqual(Image.open(extract/name).convert('RGBA').tobytes(),Image.open(ROOT/f'plugin/assets/icon/coco-{size}.png').convert('RGBA').tobytes())
            self.measurements.append(dict(representation=name,exact_decoded_bytes=True,png_byte_identical=(extract/name).read_bytes()==(ROOT/f'plugin/assets/icon/coco-{size}.png').read_bytes()))
        for code in (b'is32',b's8mk',b'il32',b'l8mk'):self.assertIn(code,chunks)
        self.assertNotIn(b'icp4',chunks);self.assertNotIn(b'icp5',chunks)

    def test_native_iconutil_encoder_against_palette_control(self):
        from PIL import Image
        results=[]
        for label,source in [('approved-rgba',ROOT/'plugin/assets/icon/coco-1024.png'),
                             ('legacy-palette',ROOT/'plugin/assets/icon/recognise-0.1-source-1024.png')]:
            self.fresh_case('codec-'+label)
            stage=self.base/('codec-'+label);stage.mkdir()
            iconset=stage/'Control.iconset';iconset.mkdir()
            for size in (16,32,128,256,512):
                for scale in (1,2):
                    name=f'icon_{size}x{size}'+('@2x' if scale==2 else '')+'.png'
                    self.call('/usr/bin/sips','-z',str(size*scale),str(size*scale),str(source),'--out',str(iconset/name))
            if label=='approved-rgba':
                for name,size in [('icon_16x16.png',16),('icon_16x16@2x.png',32),('icon_32x32.png',32)]:
                    shutil.copyfile(ROOT/f'plugin/assets/icon/coco-{size}.png',iconset/name)
            native=stage/'Native.icns'
            result=subprocess.run(['/usr/bin/iconutil','-c','icns',str(iconset),'-o',str(native)],env=self.env,capture_output=True,text=True,timeout=90)
            item=dict(codec_control=label,source_mode=Image.open(source).mode,native_encode_exit=result.returncode,
                      native_encode_stdout=result.stdout,native_encode_stderr=result.stderr,native_chunks=[])
            if native.exists():
                data=native.read_bytes();offset=8
                while offset<len(data):
                    length=int.from_bytes(data[offset+4:offset+8],'big')
                    if length<8 or offset+length>len(data):raise AssertionError('invalid native ICNS container')
                    item['native_chunks'].append(dict(type=data[offset:offset+4].decode(),bytes=length-8,prefix=data[offset+8:offset+16].hex()))
                    offset+=length
            packed=stage/'Packed.icns';self.call('/bin/sh',str(ROOT/'plugin/assets/icon/build-icns.sh'),str(iconset),str(packed))
            extracted=stage/'Packed.iconset';self.call('/usr/bin/iconutil','-c','iconset',str(packed),'-o',str(extracted))
            item['packed_small_pixels']={}
            for name in ('icon_16x16.png','icon_16x16@2x.png','icon_32x32.png'):
                item['packed_small_pixels'][name]=Image.open(extracted/name).convert('RGBA').tobytes()==Image.open(iconset/name).convert('RGBA').tobytes()
            self.measurements.append(item);results.append(item)
        for item in results:
            # Native iconutil's failed encoder is diagnostic; shipping uses the verified packer.
            for name,exact in item['packed_small_pixels'].items():
                with self.subTest(source=item['codec_control'],representation=name):self.assertTrue(exact)

    def test_classic_small_representation_probe(self):
        from PIL import Image
        def rle(channel):
            encoded=bytearray();pos=0
            while pos<len(channel):
                run=1
                while pos+run<len(channel) and channel[pos+run]==channel[pos] and run<130:run+=1
                if run>=3:encoded.extend((run+125,channel[pos]));pos+=run;continue
                start=pos;pos+=run
                while pos<len(channel) and pos-start<128:
                    run=1
                    while pos+run<len(channel) and channel[pos+run]==channel[pos] and run<3:run+=1
                    if run>=3:break
                    pos+=min(run,128-(pos-start))
                encoded.append(pos-start-1);encoded.extend(channel[start:pos])
            return bytes(encoded)
        content=bytearray()
        for size,code,mask in [(16,b'is32',b's8mk'),(32,b'il32',b'l8mk')]:
            image=Image.open(ROOT/f'plugin/assets/icon/coco-{size}.png').convert('RGBA')
            data=b''.join(rle(list(image.getchannel(c).getdata())) for c in 'RGB')
            alpha=bytes(image.getchannel('A').getdata())
            for kind,payload in [(code,data),(mask,alpha)]:content.extend(kind+(len(payload)+8).to_bytes(4,'big')+payload)
        icon=self.base/'classic.icns';icon.write_bytes(b'icns'+(len(content)+8).to_bytes(4,'big')+content)
        extract=self.base/'classic.iconset';self.call('iconutil','-c','iconset',str(icon),'-o',str(extract))
        for size in (16,32):
            original=Image.open(ROOT/f'plugin/assets/icon/coco-{size}.png').convert('RGBA').tobytes()
            decoded=Image.open(extract/f'icon_{size}x{size}.png').convert('RGBA').tobytes()
            self.measurements.append(dict(classic_representation=size,exact_decoded_bytes=decoded==original))
            self.assertEqual(decoded,original)
        # Optional negative diagnostic; native pixel acceptance above is never relaxed.
        if os.environ.get("COCO_ICON_CODEC_NEGATIVE")!="modern-argb": return
        modern=bytearray()
        for code,size in [(b'icp4',16),(b'icp5',32),(b'ic11',32)]:
            image=Image.open(ROOT/f'plugin/assets/icon/coco-{size}.png').convert('RGBA')
            payload=b'ARGB'+b''.join(rle(list(image.getchannel(c).getdata())) for c in 'ARGB')
            modern.extend(code+(len(payload)+8).to_bytes(4,'big')+payload)
        icon=self.base/'modern-argb.icns';icon.write_bytes(b'icns'+(len(modern)+8).to_bytes(4,'big')+modern)
        extract=self.base/'modern-argb.iconset';self.call('iconutil','-c','iconset',str(icon),'-o',str(extract))
        for name,size in [('icon_16x16.png',16),('icon_32x32.png',32),('icon_16x16@2x.png',32)]:
            original=Image.open(ROOT/f'plugin/assets/icon/coco-{size}.png').convert('RGBA').tobytes()
            decoded=Image.open(extract/name).convert('RGBA').tobytes()
            self.measurements.append(dict(modern_argb_representation=name,exact_decoded_bytes=decoded==original))
            self.assertNotEqual(decoded,original,"modern ARGB negative control unexpectedly accepted")
if __name__=='__main__': unittest.main(verbosity=2)
