"""Deterministic development-only corpus for the legacy custom-icon classifier.

The historical recipe is sips -z N N on the original palette PNG, then iconutil.
No installed application or user icon is read. Call under a heavy-job lane if you keep one.
"""
import hashlib
import base64
import json
import math
import plistlib
import shutil
import struct
from pathlib import Path

SIZES = (16, 32, 64, 128, 256, 512, 1024)
PNG_TYPES = {16: b'icp4', 32: b'icp5', 64: b'icp6', 128: b'ic07',
             256: b'ic08', 512: b'ic09', 1024: b'ic10'}

# The owner's locally generated iconutil info chunk, from the supplied part-3
# dummy corpus. Preserve exact bytes independently of plistlib serialization.
ACTUAL_ICONUTIL_INFO = base64.b64decode(
    'YnBsaXN0MDDUAQIDBAUGBwpYJHZlcnNpb25ZJGFyY2hpdmVyVCR0b3BYJG9iamVjdHMSAAGGoF8QD05TS2V5'
    'ZWRBcmNoaXZlctEICVRyb290gAGnCwwXGBkaHlUkbnVsbNMNDg8QExZXTlMua2V5c1pOUy5vYmplY3RzViRj'
    'bGFzc6IREoACgAOiFBWABIAFgAZUbmFtZV8QFmFzc2V0Y2F0YWxvZy1yZWZlcmVuY2VUaWNvbtMNDg8bHBag'
    'oIAG0h8gISJaJGNsYXNzbmFtZVgkY2xhc3Nlc1xOU0RpY3Rpb25hcnmiISNYTlNPYmplY3QIERokKTI3SUxR'
    'U1thaHB7goWHiYyOkJKXsLW8vb7AxdDZ5ukAAAAAAAABAQAAAAAAAAAkAAAAAAAAAAAAAAAAAAAA8g==')


def iconutil_info_payload():
    """Local reconstruction of the owner's iconutil-generated metadata archive.

    The observed info chunk is a binary NSKeyedArchiver plist naming the icon and
    an empty assetcatalog-reference. It contains no image representation.
    """
    uid = plistlib.UID
    archive = {'$version': 100000, '$archiver': 'NSKeyedArchiver',
               '$top': {'root': uid(1)}, '$objects': ['$null',
               {'NS.keys': [uid(2), uid(3)], 'NS.objects': [uid(4), uid(5)], '$class': uid(6)},
               'name', 'assetcatalog-reference', 'icon',
               {'NS.keys': [], 'NS.objects': [], '$class': uid(6)},
               {'$classname': 'NSDictionary', '$classes': ['NSDictionary', 'NSObject']}]}
    return plistlib.dumps(archive, fmt=plistlib.FMT_BINARY, sort_keys=False)


def metadata_chunks(image_chunks):
    """Deterministic non-image metadata fixtures; TOC entries describe images."""
    toc = b''.join(kind + struct.pack('>I', len(data) + 8) for kind, data in image_chunks)
    return [(b'info', iconutil_info_payload()), (b'name', b'icon'),
            (b'TOC ', toc), (b'icnV', struct.pack('>f', 1.0))]


def _icns(path, chunks):
    body = b''.join(kind + struct.pack('>I', len(data) + 8) + data for kind, data in chunks)
    path.write_bytes(b'icns' + struct.pack('>I', len(body) + 8) + body)
    return path


def _rle(channel):
    # Literal runs are an intentionally simple, lossless valid ICNS RLE encoding.
    raw = bytes(channel)
    return b''.join(bytes([len(raw[i:i+128])-1]) + raw[i:i+128]
                    for i in range(0, len(raw), 128))


def build_references(root, directory, call):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    source = Path(root) / 'plugin/assets/icon/recognise-0.1-source-1024.png'
    refs = {}
    for size in SIZES:
        path = directory / ('recognise-0.1-rep-%d.png' % size)
        call('/usr/bin/sips', '-z', str(size), str(size), str(source), '--out', str(path))
        refs[size] = path
    manifest = {'source': str(source), 'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
                'recipe': 'sips -z N N ORIGINAL_PALETTE_PNG --out OUTPUT',
                'references': {str(n): {'path': str(p), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}
                               for n, p in refs.items()}}
    (directory / 'reference-manifest.json').write_text(json.dumps(manifest, indent=2))
    return refs


def generate_corpus(root, tmp, call):
    from PIL import Image, ImageDraw, ImageOps
    root, tmp = Path(root), Path(tmp)
    tmp.mkdir(parents=True, exist_ok=True)
    refs = build_references(root, tmp / 'references', call)
    records = []

    def add(label, positive, path, group, size=None, **metadata):
        records.append(dict(label=label, positive=positive, path=str(path), group=group,
                            size=size, sha256=hashlib.sha256(path.read_bytes()).hexdigest(), **metadata))

    def save(label, image, positive=False, group='negative-transform'):
        path = tmp / (label + '.png')
        image.save(path)
        add(label, positive, path, group, image.width, container='PNG')
        return path

    # Exact historical iconset names, generated directly from the original source.
    iconset = tmp / 'Legacy.iconset'
    iconset.mkdir(exist_ok=True)
    for base in (16, 32, 128, 256, 512):
        for scale in (1, 2):
            shutil.copyfile(refs[base*scale], iconset / ('icon_%dx%d%s.png' %
                            (base, base, '@2x' if scale == 2 else '')))
    native = tmp / 'historical-iconutil.icns'
    try:
        call('/usr/bin/iconutil', '-c', 'icns', str(iconset), '-o', str(native))
        encoder = {'historical_iconutil_encode': 'passed'}
    except (AssertionError, __import__('subprocess').SubprocessError) as error:
        # Sandbox iconutil encoding is separately observable; never call this a pass.
        encoder = {'historical_iconutil_encode': 'failed', 'encoder_error': str(error),
                   'stderr': getattr(error, 'stderr', None), 'exit': getattr(error, 'returncode', None),
                   'fallback': 'explicit lossless PNG and native ARGB ICNS chunks'}
        packed=[]
        for size,code in ((16,b'ic04'),(32,b'ic05')):
            with Image.open(refs[size]) as image:
                image=image.convert('RGBA')
                packed.append((code,b'ARGB'+b''.join(_rle(image.getchannel(c).tobytes()) for c in 'ARGB')))
        packed.extend((PNG_TYPES[n],refs[n].read_bytes()) for n in (64,128,256,512,1024))
        _icns(native,packed)
    (tmp/'historical-encoder.json').write_text(json.dumps(encoder,indent=2))
    add('historical-iconutil-multi', True, native, 'historical', 1024, container='ICNS', **encoder)
    extracted = tmp / 'Extracted.iconset'
    call('/usr/bin/iconutil', '-c', 'iconset', str(native), '-o', str(extracted))
    # Preserve each original chunk. Small RGB chunks need their corresponding mask.
    raw = native.read_bytes()
    chunks, offset = {}, 8
    while offset < len(raw):
        kind, length = raw[offset:offset+4], struct.unpack_from('>I', raw, offset+4)[0]
        if length < 8 or offset+length > len(raw):
            raise AssertionError('invalid historical iconutil ICNS')
        chunks[kind] = raw[offset+8:offset+length]
        offset += length
    for size in SIZES:
        reference = refs[size]
        png = tmp / ('legacy-png-chunk-%d.icns' % size)
        _icns(png, [(PNG_TYPES[size], reference.read_bytes())])
        add('legacy-png-chunk-%d' % size, True, png, 'PNG-chunk', size, container='ICNS')
        # PNG codec roundtrip, including every specifically requested low resolution.
        if size <= 128:
            with Image.open(reference) as image:
                save('legacy-png-reencoded-%d' % size, image.convert('RGBA'), True, 'PNG-reencoded')
        # Actual iconutil-produced native ARGB/PNG/classic data, retaining masks.
        choices = {16: (b'ic04', b'is32', b'icp4'), 32: (b'ic05', b'il32', b'ic11', b'icp5'),
                   64: (b'ic12', b'ic06', b'icp6'), 128: (b'ic07', b'it32'),
                   256: (b'ic08', b'ic13'), 512: (b'ic09', b'ic14'), 1024: (b'ic10',)}[size]
        code = next((c for c in choices if c in chunks), None)
        if code is None:
            raise AssertionError('historical representation absent: %d %r' % (size, list(chunks)))
        selected = [(code, chunks[code])]
        mask = {b'is32': b's8mk', b'il32': b'l8mk', b'it32': b't8mk'}.get(code)
        if mask:
            selected.append((mask, chunks[mask]))
        native_one = tmp / ('legacy-iconutil-rep-%d.icns' % size)
        _icns(native_one, selected)
        add('legacy-iconutil-rep-%d' % size, True, native_one, 'historical-representation', size,
            container='ICNS', chunk=code.decode(), payload_prefix=chunks[code][:4].hex())
    # Real iconutil's info archive was observed outside the sandbox in part 3.
    # Reconstruct it locally so this positive also exists when iconutil cannot encode.
    info = iconutil_info_payload()
    for label, positive, payload in (
            ('legacy-iconutil-info-plist', True, info),
            ('legacy-iconutil-actual-info-plist', True, ACTUAL_ICONUTIL_INFO),
            ('legacy-malformed-info-plist', False, info[:-1])):
        path = tmp / (label + '.icns')
        _icns(path, [(b'icp6', refs[64].read_bytes()), (b'info', payload)])
        add(label, positive, path, 'metadata' if positive else 'negative-ineligible-container',
            64, container='ICNS', **({} if positive else {'eligibility_expected': False}))
    for code,size in ((b'ic11',32),(b'ic12',64),(b'ic13',256),(b'ic14',512)):
        path=tmp/('legacy-retina-'+code.decode()+'.icns')
        _icns(path,[(code,refs[size].read_bytes())])
        add('legacy-retina-'+code.decode(),True,path,'retina-PNG-alias',size,container='ICNS',chunk=code.decode())
    # Explicit classic RGB/mask encodings provide independent lossless small codecs.
    for size, code, mask in ((16, b'is32', b's8mk'), (32, b'il32', b'l8mk'), (128, b'it32', b't8mk')):
        with Image.open(refs[size]) as image:
            image = image.convert('RGBA')
            color = b''.join(_rle(image.getchannel(c).tobytes()) for c in 'RGB')
            if size == 128:
                color = bytes(4) + color
            classic = tmp / ('legacy-classic-%d.icns' % size)
            _icns(classic, [(code, color), (mask, image.getchannel('A').tobytes())])
            add('legacy-classic-%d' % size, True, classic, 'classic-RGB-mask', size, container='ICNS')
    for size in SIZES:
        with Image.open(refs[size]) as image:
            image = image.convert('RGBA')
            for delta in (-2, 2):
                shifted = image.copy()
                shifted.putdata([(max(0, min(255, r+delta)), max(0, min(255, g+delta)),
                                  max(0, min(255, b+delta)), a) if a else (r,g,b,a)
                                 for r,g,b,a in image.getdata()])
                save('legacy-colour-%d-%+d' % (size, delta), shifted, True, 'small-colour-shift')
    with Image.open(root/'plugin/assets/icon/recognise-0.1-source-1024.png') as image:
        image=image.convert('RGBA');pixels=list(image.getdata())
        opaque=[index for index,pixel in enumerate(pixels) if pixel[3]==255]
        for index in opaque[::4]:
            pixel=pixels[index]
            pixels[index]=tuple(min(255,c+1) for c in pixel[:3])+(pixel[3],)
        image.putdata(pixels)
        save('legacy-quarter-colour-plus-one',image,True,'small-colour-shift')
    # Original input and freshly written RGBA source are both legitimate old installs.
    add('legacy-original-source', True, root/'plugin/assets/icon/recognise-0.1-source-1024.png',
        'original-source', 1024, container='PNG')
    for name, filename in (('flower', 'coco-1024.png'), ('badge', 'claude-tile-1024.png')):
        add(name, False, root/'plugin/assets/icon'/filename, 'negative-known', 1024, container='PNG')
    save('stock', Image.new('RGBA', (64,64), (128,128,128,255)), group='negative-known')
    save('stranger', Image.new('RGBA', (64,64), (255,0,0,255)), group='negative-known')
    with Image.open(refs[64]) as image:
        image = image.convert('RGBA')
        hole=image.copy()
        opaque=[(x,y) for y in range(4,56) for x in range(4,56)
                if all(image.getpixel((x+dx,y+dy))[3]>=240 for dy in range(4) for dx in range(4))]
        if not opaque:raise AssertionError('legacy has no opaque 4x4 calibration patch')
        hx,hy=min(opaque,key=lambda p:(p[0]-32)**2+(p[1]-32)**2)
        for dy in range(4):
            for dx in range(4):
                r,g,b,a=hole.getpixel((hx+dx,hy+dy));hole.putpixel((hx+dx,hy+dy),(r,g,b,0))
        save('legacy-alpha-only-hole',hole)
        small_hole=image.copy()
        for dy in range(2):
            for dx in range(2):
                r,g,b,a=small_hole.getpixel((hx+dx,hy+dy));small_hole.putpixel((hx+dx,hy+dy),(r,g,b,0))
        save('legacy-alpha-only-hole-2',small_hole)
        pixel_hole=image.copy()
        r,g,b,a=pixel_hole.getpixel((hx,hy));pixel_hole.putpixel((hx,hy),(r,g,b,0))
        save('legacy-alpha-only-hole-1',pixel_hole)
        palette=image.copy()
        positions=[(x,y) for y in range(20,44) for x in range(20,44) if image.getpixel((x,y))[3]>=240]
        if len(positions)<64:raise AssertionError('insufficient opaque palette-scramble patch')
        colors=[image.getpixel(p)[:3] for p in positions]
        for point,rgb in zip(positions,reversed(colors)):
            palette.putpixel(point,rgb+(image.getpixel(point)[3],))
        save('legacy-palette-preserving-scramble',palette)
        save('legacy-flip-horizontal', ImageOps.mirror(image))
        save('legacy-flip-vertical', ImageOps.flip(image))
        for amount in (2, 4):
            crop = image.crop((amount, amount, 64-amount, 64-amount)).resize((64,64), Image.Resampling.LANCZOS)
            save('legacy-crop-%d' % amount, crop)
            for direction in (-1, 1):
                moved = Image.new('RGBA', (64,64))
                moved.paste(image, (amount*direction, 0))
                save('legacy-shift-x-%+d' % (amount*direction), moved)
        for channel in range(3):
            recolor = image.copy()
            recolor.putdata([tuple(max(0,min(255,v+(24 if c==channel else 0))) if c<3 else v
                                   for c,v in enumerate(pixel)) for pixel in image.getdata()])
            save('legacy-recolour-channel-%d' % channel, recolor)
    # Twenty-four deterministic, similarly coloured icon-like opaque shapes.
    for index in range(24):
        scale = 4
        image = Image.new('RGBA', (64*scale, 64*scale))
        draw = ImageDraw.Draw(image)
        color = ((215, 87, 56), (226, 104, 66), (198, 72, 48), (229, 118, 81))[index%4] + (255,)
        shape = index % 6
        inset = 5 + index//6
        box = tuple(v*scale for v in (inset,inset,64-inset,64-inset))
        if shape == 0:
            draw.ellipse(box, fill=color)
        elif shape == 1:
            draw.rounded_rectangle(box, radius=(9+index//6)*scale, fill=color)
        elif shape == 2:
            points = [(32*scale + math.cos(i*math.pi/5)*(26 if i%2==0 else 13)*scale,
                       32*scale + math.sin(i*math.pi/5)*(26 if i%2==0 else 13)*scale) for i in range(10)]
            draw.polygon(points, fill=color)
        elif shape == 3:
            draw.ellipse(box, fill=color)
            draw.ellipse(tuple(v*scale for v in (19,19,45,45)), fill=(0,0,0,0))
        elif shape == 4:
            for angle in (0, math.pi/3, 2*math.pi/3):
                draw.line((32*scale-math.cos(angle)*25*scale,32*scale-math.sin(angle)*25*scale,
                           32*scale+math.cos(angle)*25*scale,32*scale+math.sin(angle)*25*scale), fill=color, width=(8+index//6)*scale)
        else:
            draw.polygon([(32*scale,5*scale),(59*scale,54*scale),(5*scale,54*scale)], fill=color)
        # Small central cutouts make each variation structurally distinct.
        if index >= 12 and shape != 3:
            draw.rectangle((28*scale,27*scale,(31+index//6)*scale,36*scale), fill=(0,0,0,0))
        save('synthetic-%02d' % index, image.resize((64,64),Image.Resampling.LANCZOS), group='negative-synthetic')
    # Resolution families also get hard wrong-picture controls, including blurry 16 px.
    with Image.open(root/'plugin/assets/icon/coco-1024.png') as flower:
        for size in (16,32,64,128,256,512):
            save('flower-size-%d' % size, flower.convert('RGBA').resize((size,size),Image.Resampling.LANCZOS), group='negative-resolution')
    with Image.open(refs[16]) as small:
        small=small.convert('RGBA')
        save('legacy-flip-horizontal-16', ImageOps.mirror(small), group='negative-resolution')
        save('legacy-crop-16', small.crop((1,1,15,15)).resize((16,16),Image.Resampling.LANCZOS), group='negative-resolution')
        moved=Image.new('RGBA',(16,16));moved.paste(small,(1,0))
        save('legacy-shift-16', moved, group='negative-resolution')
    for size in (32,128):
        with Image.open(refs[size]) as small:
            small=small.convert('RGBA')
            moved=Image.new('RGBA',(size,size));moved.paste(small,(max(1,size//32),0))
            save('legacy-shift-%d' % size,moved,group='negative-resolution')
            recolor=small.copy()
            recolor.putdata([(min(255,r+24),g,b,a) for r,g,b,a in small.getdata()])
            save('legacy-recolour-%d' % size,recolor,group='negative-resolution')
    mixed=tmp/'mixed-legacy-large-foreign-small.icns'
    _icns(mixed,[(b'ic10',refs[1024].read_bytes()),(b'icp4',(tmp/'flower-size-16.png').read_bytes())])
    add('mixed-legacy-large-foreign-small',False,mixed,'negative-mixed-representation',1024,container='ICNS')
    for label,chunks in (
        ('legacy-plus-unknown-foreign',[(b'ic10',refs[1024].read_bytes()),(b'ZZZZ',(root/'plugin/assets/icon/coco-1024.png').read_bytes())]),
        ('legacy-duplicate-large-legacy-first',[(b'ic10',refs[1024].read_bytes()),(b'ic10',(root/'plugin/assets/icon/coco-1024.png').read_bytes())]),
        ('legacy-duplicate-large-foreign-first',[(b'ic10',(root/'plugin/assets/icon/coco-1024.png').read_bytes()),(b'ic10',refs[1024].read_bytes())])):
        path=tmp/(label+'.icns');_icns(path,chunks)
        add(label,False,path,'negative-ineligible-container',1024,container='ICNS',eligibility_expected=False)
    for code,extra in ((b'ic04',[]),(b'ic05',[]),(b'is32',[(b's8mk',bytes([255])*256)])):
        label='legacy-plus-malformed-'+code.decode();path=tmp/(label+'.icns')
        _icns(path,[(b'ic10',refs[1024].read_bytes()),(code,b'not-an-image')]+extra)
        add(label,False,path,'negative-ineligible-container',1024,container='ICNS',eligibility_expected=False)
    # Final fixtures are explicit ICNS containers so low-resolution samples stay low.
    for record in records:
        if record['container'] == 'PNG':
            source = Path(record['path'])
            path = tmp / (record['label'] + '-single.icns')
            _icns(path, [(PNG_TYPES[record['size']], source.read_bytes())])
            record.update(source_png=str(source), path=str(path), container='ICNS',
                          sha256=hashlib.sha256(path.read_bytes()).hexdigest())
    (tmp/'corpus-manifest.json').write_text(json.dumps(records, indent=2))
    return records



def measure_decoded_corpus(root, folder, records):
    """Probe shipping AppKit decoder/features directly; public dummy tests remain separate."""
    import os, re, resource, subprocess, time
    root,folder=Path(root),Path(folder)
    source=(root/'plugin/bin/icon-macos.sh').read_text()
    jxa=re.search(r"JXA_COMPARE='([\s\S]*?)\n'",source)[1]
    jxa=jxa[:jxa.rindex('function run(argv)')]+r'''
function run(argv) {
 var list=JSON.parse(ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError($(argv[0]),$.NSUTF8StringEncoding,null)));
 var own=decode(readBounded(argv[1])),old=sampled(decode(readBounded(argv[2]))),output=[];
 for(var i=0;i<list.length;i++) {
  var row=list[i];
  try {
   var d=readBounded(row.path);validateICNS(bytes(d));var a=decode(d),s=sampled(a);
   var referencePath=a.width===1024?argv[4]:argv[3]+"/recognise-0.1-rep-"+a.width+".png";
   var ref=decode(readBounded(referencePath));
   row.metrics={width:a.width,height:a.height,exactCurrent:samePixels(a,own),oldLegacy:difference(s,old),legacyFeatures:legacyFeatures(s,sampled(ref)),legacyEligibility:legacyEligibility(bytes(d)),legacyRepresentations:[]};
   row.metrics.legacyRepresentations=legacyRepresentations(d,a,["",argv[1],argv[2]]);
   row.metrics.legacyEligibility=legacyEligibility(bytes(d),row.metrics.legacyRepresentations);
  }catch(e){row.error=String(e);}
  output.push(row);
 }
 return JSON.stringify(output);
}
'''
    output=[]
    start=time.perf_counter();cpu=resource.getrusage(resource.RUSAGE_CHILDREN);load=os.getloadavg()
    for offset in range(0,len(records),12):
        part=folder/'probe-input.json';part.write_text(json.dumps(records[offset:offset+12]))
        result=subprocess.run(['osascript','-l','JavaScript','-e',jxa,str(part),
            str(root/'plugin/assets/icon/claude-tile-1024.png'),str(root/'plugin/assets/icon/recognise-0.1-64.png'),
            str(folder/'references'),str(root/'plugin/assets/icon/recognise-0.1-source-1024.png')],
            text=True,capture_output=True,check=True,timeout=120)
        output.extend(json.loads(result.stdout))
        print('measured',len(output),'/',len(records),flush=True)
    (folder/'decoded-feature-measurements.json').write_text(json.dumps(output,indent=2))
    end=resource.getrusage(resource.RUSAGE_CHILDREN)
    receipt=dict(wall=time.perf_counter()-start,cpu=end.ru_utime+end.ru_stime-cpu.ru_utime-cpu.ru_stime,
                 load_start=load,load_end=os.getloadavg(),source_sha256=hashlib.sha256(source.encode()).hexdigest(),
                 jxa_sha256=hashlib.sha256(jxa.encode()).hexdigest(),cases=len(records))
    (folder/'decoded-feature-timing.json').write_text(json.dumps(receipt,indent=2))
    return output


def summarize_features(records, bounds):
    """Describe fixed AND bounds over every representation, without fitting negatives."""
    import statistics
    fields=tuple(bounds)
    def representations(row):
        metrics=row.get('metrics',row)
        reps=metrics.get('legacyRepresentations')
        if reps is not None:
            return [(r.get('width'),r.get('legacyFeatures',r.get('features'))) for r in reps]
        return [(metrics.get('width'),metrics.get('legacyFeatures'))]
    positive=[(row,width,f) for row in records if row['positive'] for width,f in representations(row)]
    negative=[(row,width,f) for row in records if not row['positive'] and row.get('eligibility_expected') is not False for width,f in representations(row)]
    if not positive or any(not f for row,width,f in positive):
        raise AssertionError('a positive representation has no usable features')
    worst={field:max(f[field] for row,width,f in positive) for field in fields}
    if any(bounds[field]<=worst[field] for field in fields):
        raise AssertionError('fixed bound must leave positive calibration margin')
    def distribution(rows,field):
        values=sorted(f[field] for row,width,f in rows if f)
        return dict(count=len(values),minimum=min(values),median=statistics.median(values),maximum=max(values))
    summary={'bounds':bounds,'positive_worst':worst,
             'features':{field:{'positive':distribution(positive,field),'negative':distribution(negative,field),
                                'positive_inside_margin':bounds[field]-worst[field]} for field in fields},
             'negative_exclusions':[]}
    for row in records:
        if row['positive']:continue
        if row.get('eligibility_expected') is False:
            summary['negative_exclusions'].append(dict(label=row['label'],reason='ineligible-container'))
            continue
        reps=representations(row)
        if any(f is None for width,f in reps):
            summary['negative_exclusions'].append(dict(label=row['label'],reason='insufficient-evidence'))
            continue
        candidates=[( (values[field]-bounds[field])/(bounds[field]-worst[field]),field,width)
                    for width,values in reps for field in fields]
        ratio,field,width=max(candidates)
        summary['negative_exclusions'].append(dict(label=row['label'],feature=field,width=width,ratio=ratio,
                                                   rejected=ratio>0))
    summary['minimum_exclusion_ratio']=min(row['ratio'] for row in summary['negative_exclusions'] if 'ratio' in row)
    return summary


if __name__ == '__main__':
    import argparse, os, subprocess, time
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True,exist_ok=True)
    for key,name in (('HOME','home'),('CLAUDE_CONFIG_DIR','config'),('TMPDIR','tmp')):
        path=args.out/name;path.mkdir(exist_ok=True);os.environ[key]=str(path)
    start = time.perf_counter()
    load_start = os.getloadavg()
    def call(*arguments):
        subprocess.run(arguments, check=True, capture_output=True, text=True, timeout=90)
    rows = generate_corpus(Path(__file__).resolve().parents[2], args.out, call)
    print('generated',len(rows),'fixtures',flush=True)
    measured = measure_decoded_corpus(Path(__file__).resolve().parents[2], args.out, rows)
    print(json.dumps({'total': len(rows), 'positive': sum(r['positive'] for r in rows),
                      'negative': sum(not r['positive'] for r in rows), 'wall': time.perf_counter()-start,
                      'load_start': load_start, 'load_end': os.getloadavg()}))
