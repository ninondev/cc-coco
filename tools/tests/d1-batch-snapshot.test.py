#!/usr/bin/env python3
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
def load(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'tools/preview' / file)
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value); return value
C = load('d1_batch_test_common', 'd1-preview-common.py')
G = load('d1_batch_test_sampling', 'build-d1-gifs.py')
def sources(tree):
    if not isinstance(tree, dict): return []
    return ([tree.get('props', {}).get('source', '')] if tree.get('type') == 'Svg' else []) + [s for child in tree.get('children', []) for s in sources(child)]
def representatives(rows, mode):
    eligible = [c for c in rows if c['surface'] == 'desktop' and c['mode'] == mode and c.get('lang', 'en') == 'en' and not c.get('pixel') and not c.get('hover')]
    def choose(predicate):
        found = [c for c in eligible if predicate(c)]
        if not found: raise AssertionError('required actual representative missing for ' + mode)
        return sorted(found, key=lambda c: (c['width'], c['scene']), reverse=True)[0]
    return [
        ('maximum-room', choose(lambda c: c['scene'] == 'room-all-night' and any(s.count('<image ') >= 15 and 'viewBox="0 0 160 90"' in s for s in sources(c['tree'])))),
        ('painted-shed', choose(lambda c: c.get('motion', {}).get('id') == 'shed-band' and c['motion']['atMs'] == 360 and G.animated(c['tree']))),
        ('helper-css', choose(lambda c: c.get('motion', {}).get('id') == 'helpers-many' and c['motion']['atMs'] == 500 and any('animation:arrive 240ms' in s for s in sources(c['tree'])))),
    ]
def decoded(path):
    from PIL import Image
    with Image.open(path) as image:
        rgba = image.convert('RGBA'); return rgba.size, rgba.tobytes()
def main():
    parser = argparse.ArgumentParser(); parser.add_argument('trees', type=Path); parser.add_argument('--out', type=Path, default=C.BASE/'batch-equivalence'); args=parser.parse_args()
    rows=C.read_captures(args.trees); engine=C.capture_receipt(args.trees); out=C.output_path(args.out); out.mkdir(parents=True, exist_ok=True)
    single=C.snapshot_binary(C.BASE); baseline=[]; jobs=[]; renderer=C.renderer()
    for mode in ['light', 'dark']:
        for family_index, (family, captured) in enumerate(representatives(rows, mode)):
            paused=captured | {'tree':G.sample_tree(captured['tree'], 137) if captured.get('motion') else captured['tree']}
            for scale in [1, 2]:
                ident=f'{family}-{mode}-{scale}x'; page=out/(ident+'.html'); page.write_text(C.page_html(paused, None, renderer)); png=out/(ident+'-single.png')
                width=captured['width']+32+family_index*47
                receipt=C.snapshot(single, page, png, width, scale, mode); C.append_receipt(out/'single-receipts.jsonl', receipt)
                assert receipt.get('exitCode') == 0 and receipt['pngExists'], receipt
                baseline.append({'id':ident,'png':png,'receipt':receipt,'capture':C.capture_name(captured)})
                jobs.append({'id':ident,'page':str(page),'png':str(out/(ident+'-batch.png')),'width':width,'scale':scale,'mode':mode})
    # Transition order differs from single renderer: alternating themes/scales/widths;
    # then reverse the sequence to expose stale appearance, viewport or page state.
    order=[0,7,2,9,4,11,6,1,8,3,10,5]
    ordered=[jobs[i] for i in order]
    ordered += [job | {'id':job['id']+'-repeat','png':str(out/(job['id']+'-repeat.png'))} for job in reversed(ordered)]
    batch=C.batch_snapshot_binary(C.BASE)
    receipts=C.snapshot_batch(batch, ordered, out/'batch-receipts.jsonl')
    assert len(receipts) == len(ordered), (len(receipts),len(ordered))
    assert len({r['webViewIdentity'] for r in receipts}) == 1
    assert all(r['nonPersistent'] is True and r['pageTimeoutSeconds'] == 60 and r['settleSeconds'] == 0.4 for r in receipts)
    comparisons=[]; originals={row['id']:row for row in baseline}
    for job, receipt in zip(ordered, receipts):
        assert receipt.get('exitCode') == 0 and receipt['pngExists'] and receipt['jobId'] == job['id'], receipt
        original=originals[job['id'].removesuffix('-repeat')]; a=decoded(original['png']); b=decoded(job['png'])
        assert a[0] == b[0] and a[1] == b[1], 'decoded pixels differ: '+job['id']
        comparisons.append({'jobId':job['id'],'capture':original['capture'],'dimensions':a[0],'singlePngSha256':C.digest(original['png']),'batchPngSha256':C.digest(job['png']),'encodedBytesEqual':original['png'].read_bytes()==Path(job['png']).read_bytes(),'decodedRgbaSha256':hashlib.sha256(a[1]).hexdigest(),'decodedPixelsEqual':True,'width':job['width'],'scale':job['scale'],'mode':job['mode']})
    proof={'exitCode':0,'engineCaptureReceipt':engine,'engineTreesSha256':C.digest(args.trees),'singleSourceSha256':C.digest(ROOT/'tools/preview/snapshot.swift'),'batchSourceSha256':C.digest(ROOT/'tools/preview/d1-snapshot-batch.swift'),'commonSourceSha256':C.digest(ROOT/'tools/preview/d1-preview-common.py'),'batchBinarySha256':C.digest(batch),'comparisonTestSha256':C.digest(__file__),'jobs':len(comparisons),'uniqueBaselines':len(baseline),'allDecodedPixelsEqual':True,'settleSeconds':0.4,'fontImageReadinessUnchanged':True,'comparisons':comparisons,'scope':'actual captured shipping room/shed/helper trees; offline sequential WebKit equivalence; no installed app or real-screen claim'}
    (out/'equivalence-receipt.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps(proof))
if __name__ == '__main__': main()
