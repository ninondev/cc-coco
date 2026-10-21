#!/usr/bin/env python3
"""Portable legacy comparison against scratch launchers; no installed app is inspected."""
import json,os,resource,shutil,subprocess,tempfile,time,unittest,zlib
from pathlib import Path
from PIL import Image,PngImagePlugin
ROOT=Path(__file__).resolve().parents[2]
class LegacyPng(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='i1-png-',dir=os.environ.get('TMPDIR'))
        self.base=Path(self.temp.name).resolve();self.plugin=self.base/'plugin'
        (self.plugin/'bin').mkdir(parents=True);(self.plugin/'assets').mkdir()
        shutil.copytree(ROOT/'plugin/assets/icon',self.plugin/'assets/icon')
        source=(ROOT/'plugin/bin/icon-linux.sh').read_text()
        mutation=os.environ.get('COCO_ICON_MUTATION','')
        if mutation=='linux-tolerance': source=source.replace('sum/(4096*4)<=12','sum/(4096*4)<=0')
        source=source.replace('exit(sum/(4096*4)<=12?0:1)', 'printf "distance %.6f\\n",sum/(4096*4) > "/dev/stderr";exit(sum/(4096*4)<=12?0:1)')
        (self.plugin/'bin/icon-linux.sh').write_text(source)
        if mutation=='linux-raster':
            p=self.plugin/'assets/icon/png-compare.awk';p.write_text(p.read_text().replace('sr[i]/counts[i],sg[i]/counts[i],sb[i]/counts[i],sa[i]/counts[i]','0,0,0,0'))
        self.home=self.base/'home';self.data=self.home/'share';self.package=self.base/'packaged'
        (self.data/'applications').mkdir(parents=True);(self.package/'applications').mkdir(parents=True)
        launcher=self.package/'applications/claude.desktop'
        launcher.write_text('[Desktop Entry]\nType=Application\nName=Claude\nExec=claude\nIcon=claude\n')
        self.picture=self.data/'coco/icons/coco.png';self.picture.parent.mkdir(parents=True)
        (self.data/'applications/claude.desktop').write_text('# coco-icon-override:\n'+launcher.read_text().replace('Icon=claude','Icon='+str(self.picture)))
        self.env=dict(os.environ,HOME=str(self.home),XDG_DATA_HOME=str(self.data),XDG_DATA_DIRS=str(self.package),COCO_ALLOW_ANY_OS='1',TMPDIR=str(self.base))
    def tearDown(self):self.temp.cleanup()
    def status(self,state):
        start=time.perf_counter();cpu=resource.getrusage(resource.RUSAGE_CHILDREN);load=os.getloadavg()
        r=subprocess.run(['/bin/sh',str(self.plugin/'bin/icon-linux.sh'),'status','--report','--launcher','claude.desktop'],env=self.env,capture_output=True,text=True,timeout=90)
        end=resource.getrusage(resource.RUSAGE_CHILDREN)
        evidence=os.environ.get('COCO_ICON_EVIDENCE')
        if evidence:
            Path(evidence).mkdir(exist_ok=True,parents=True)
            with (Path(evidence)/'linux-png-measurements.jsonl').open('a') as f:f.write(json.dumps(dict(test=self.id(),wall=time.perf_counter()-start,cpu=end.ru_utime+end.ru_stime-cpu.ru_utime-cpu.ru_stime,load_start=load,load_end=os.getloadavg(),stdout=r.stdout,stderr=r.stderr,code=r.returncode,host='macOS script-path' if os.uname().sysname=='Darwin' else 'Linux'))+'\n')
        self.assertEqual(r.stdout,'icon: '+state+'\n',r.stderr)
        self.assertEqual(r.returncode,1 if state=='unknown' else 0,r.stderr)
        self.assertFalse(list(self.base.glob('coco-icon-png.*')))
    def old(self,size,mode):
        image=Image.open(ROOT/'plugin/assets/icon/recognise-0.1-source-1024.png').convert('RGBA')
        if size!=1024:image=image.resize((size,size),Image.Resampling.LANCZOS)
        if mode=='P':image=image.quantize(colors=128,method=Image.Quantize.FASTOCTREE)
        if mode=='RGB':image=image.convert('RGB')
        meta=PngImagePlugin.PngInfo();meta.add_text('fixture','reencoded legacy; not a byte identity')
        image.save(self.picture,pnginfo=meta,compress_level=7)
    def test_legacy_1024_rgba_reencoded(self):self.old(1024,'RGBA');self.status('legacy')
    def test_legacy_512_rgba_reencoded(self):self.old(512,'RGBA');self.status('legacy')
    def test_legacy_512_palette_alpha_reencoded(self):self.old(512,'P');self.status('legacy')
    def test_stranger_red_not_legacy(self):Image.new('RGBA',(512,512),(255,0,0,255)).save(self.picture);self.status('custom')
    def test_malformed_truncated_oversized_and_interlaced_unknown(self):
        self.old(512,'RGBA');data=self.picture.read_bytes()
        for value in (b'not png',data[:-10],data[:28]+bytes([1])+data[29:]):
            with self.subTest(value=len(value)):
                self.picture.write_bytes(value);self.status('unknown')
        Image.new('RGBA',(2049,64),(255,0,0,255)).save(self.picture);self.status('unknown')
    def chunks(self):
        data=self.picture.read_bytes();offset=8;chunks=[]
        while offset<len(data):
            length=int.from_bytes(data[offset:offset+4],'big');chunks.append((bytes(data[offset+4:offset+8]),bytes(data[offset+8:offset+8+length])));offset+=length+12
        return chunks
    def write_chunks(self,chunks):
        self.picture.write_bytes(b'\x89PNG\r\n\x1a\n'+b''.join(len(value).to_bytes(4,'big')+kind+value+zlib.crc32(kind+value).to_bytes(4,'big') for kind,value in chunks))
    def test_invalid_palette_transparency_order_and_length(self):
        self.old(512,'P');chunks=self.chunks()
        plte=next((k,v) for k,v in chunks if k==b'PLTE');alpha=next((k,v) for k,v in chunks if k==b'tRNS')
        rest=[(k,v) for k,v in chunks if k not in (b'PLTE',b'tRNS')]
        self.write_chunks([rest[0],alpha,plte,*rest[1:]]);self.status('unknown')
        self.write_chunks([(k,v.ljust(len(plte[1])//3+1,b'\xff') if k==b'tRNS' else v) for k,v in chunks]);self.status('unknown')
    def test_trailing_deflate_garbage_rejected(self):
        self.old(512,'RGBA');chunks=self.chunks();compressed=b''.join(v for k,v in chunks if k==b'IDAT')
        corrupted=compressed[:-4]+b'garbage!'+compressed[-4:]
        output=[];added=False
        for k,v in chunks:
            if k==b'IDAT':
                if not added:output.append((k,corrupted));added=True
            else:output.append((k,v))
        self.write_chunks(output);self.status('unknown')

    def test_bad_png_chunk_crc_rejected(self):
        self.old(512,'RGBA');data=bytearray(self.picture.read_bytes());offset=8
        while offset<len(data):
            length=int.from_bytes(data[offset:offset+4],'big')
            if data[offset+4:offset+8]==b'IDAT':
                data[offset+8+length+3]^=1;break
            offset+=length+12
        self.picture.write_bytes(data);self.status('unknown')

    def test_corrupt_zlib_adler_rejected(self):
        self.old(512,'RGBA');data=bytearray(self.picture.read_bytes());offset=8;last=None
        while offset<len(data):
            length=int.from_bytes(data[offset:offset+4],'big')
            if data[offset+4:offset+8]==b'IDAT':last=offset+8+length-1
            offset+=length+12
        self.assertIsNotNone(last);data[last]^=1
        offset=8
        while offset<len(data):
            length=int.from_bytes(data[offset:offset+4],'big')
            if data[offset+4:offset+8]==b'IDAT': data[offset+8+length:offset+12+length]=zlib.crc32(data[offset+4:offset+8+length]).to_bytes(4,'big')
            offset+=length+12
        self.picture.write_bytes(data);self.status('unknown')
if __name__=='__main__':unittest.main(verbosity=2)
