#!/usr/bin/env python3
"""B4b fixes 3, 11 and 13: pure SVG runtime and shipped source checks; no engine."""
import json
import ast
import importlib.util
import base64
import sys
from pathlib import Path
import re
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools'))
from languages import LANGUAGE_CODES
sys.dont_write_bytecode = True
NS = '{http://www.w3.org/2000/svg}'


def node(code):
    done = subprocess.run(['node', '--input-type=module', '-e', code], cwd=ROOT,
                          text=True, capture_output=True, timeout=30, check=True)
    return json.loads(done.stdout)


class BookIncense(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Resolve extensionless TS imports to their actual source. No source substitutions.
        cls.drawings = node('''
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
registerHooks({resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('./') && /\.(?:ts|js)$/.test(context.parentURL ?? '')) {
    const file = new URL(specifier + '.ts', context.parentURL);
    if (existsSync(fileURLToPath(file))) return nextResolve(file.href, context);
  }
  return nextResolve(specifier, context);
}});
const { bookIncenseSvg, forgetBookArt } = await import('./plugin/hooks/book-art.ts');
forgetBookArt();
const values = [0, 50, 84.9, 85, 99.9, 100, -10, 110, NaN, Infinity];
console.log(JSON.stringify(values.map(value => bookIncenseSvg(value))));
''')

    def test_own_frame_fixed_track_bowl_and_no_theme_or_smoke(self):
        for index, source in enumerate(self.drawings):
            with self.subTest(index=index):
                svg = ET.fromstring(source)
                self.assertEqual(svg.attrib, {'style': 'forced-color-adjust:none',
                                             'viewBox': '0 0 12 26', 'width': '12',
                                             'height': '26'})
                self.assertNotIn('<style', source)
                self.assertNotIn('@media', source)
                self.assertNotIn('smoke', source)
                track = svg.find(NS + 'path')
                self.assertEqual(track.attrib, {'d': 'M6 21.4V2.6', 'stroke': '#9A7458',
                                               'stroke-width': '2', 'stroke-linecap': 'round',
                                               'opacity': '.25'})
                bowl = svg.find(NS + 'rect')
                self.assertEqual(bowl.attrib, {'x': '1.5', 'y': '21', 'width': '9',
                                              'height': '3.6', 'rx': '1.6', 'fill': '#AA5E47'})

    def test_stick_and_ember_geometry_and_heat_threshold(self):
        for used, source in zip([0, 50, 84.9, 85, 99.9], self.drawings[:5]):
            with self.subTest(used=used):
                svg = ET.fromstring(source)
                paths = svg.findall(NS + 'path')
                self.assertEqual(len(paths), 2)
                stick = paths[1]
                self.assertEqual(stick.attrib['stroke'], '#9A7458')
                self.assertEqual(stick.attrib['stroke-width'], '2')
                self.assertEqual(stick.attrib['stroke-linecap'], 'round')
                tip = float(re.fullmatch(r'M6 21\.4V(.+)', stick.attrib['d'])[1])
                self.assertAlmostEqual(tip, 21.4 - 18.8 * (1 - used / 100))
                glow, ember = svg.findall(NS + 'circle')
                for circle in [glow, ember]:
                    self.assertEqual(float(circle.attrib['cx']), 6)
                    self.assertAlmostEqual(float(circle.attrib['cy']), tip)
                    self.assertEqual(circle.attrib['fill'], '#C7361C' if used >= 85 else '#E8643A')
                self.assertEqual(glow.attrib['r'], '2.8')
                self.assertEqual(glow.attrib['opacity'], '.24')
                self.assertEqual(ember.attrib['r'], '1.45')

    def test_empty_ash_and_clamped_nonfinite_inputs(self):
        svg = ET.fromstring(self.drawings[5])
        self.assertEqual(svg.findall(NS + 'circle'), [])
        self.assertEqual(svg.findall(NS + 'path')[1].attrib,
                         {'d': 'M6 21.4v-1', 'stroke': '#9A7458', 'stroke-width': '1.8',
                          'stroke-linecap': 'round', 'opacity': '.6'})
        self.assertEqual(self.drawings[6], self.drawings[0])
        self.assertEqual(self.drawings[7], self.drawings[5])
        self.assertEqual(self.drawings[8], self.drawings[0])
        self.assertEqual(self.drawings[9], self.drawings[0])


class BookWordsAndCapture(unittest.TestCase):
    def test_all_choose_labels_use_the_single_ellipsis(self):
        books = list((ROOT / 'plugin/book').glob('*.json'))
        self.assertEqual({path.stem for path in books}, set(LANGUAGE_CODES))
        for path in books:
            with self.subTest(language=path.stem):
                label = json.loads(path.read_text())['settings']['language']['choose']
                self.assertTrue(label.endswith('…'))
                self.assertNotIn('...', label)

    def test_capture_uses_the_plans_cell_width(self):
        source = (ROOT / 'tools/preview/b4-dump.test.tsx').read_text()
        expression = re.search(r'const columns = ([^\n]+)', source)[1]
        actual = node('const widths = [300, 600, 390]; console.log(JSON.stringify(' +
                      'widths.map(width => { const c = {width}; return ' + expression + '; })));')
        self.assertEqual(actual, [41, 83, 54])


class C3CaptureRenderer(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location('c3_preview', ROOT/'tools/preview/build-c3-preview.py')
        cls.preview = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.preview)

    def test_actual_renderer_fills_themes_and_honours_layout_properties(self):
        # Execute the emitted browser renderer with a minimal DOM. This verifies styles,
        # not a browser's layout or rendered text pixels.
        actual = node('''
const document={createElement(tag){return {tag,style:{},children:[],appendChild(child){this.children.push(child)}}},createTextNode(text){return {text}}};
''' + self.preview.renderer_source() + '''
const ctx={term:false,theme:DESKTOPS.light.theme,cellW:7.8,cellH:16};
const box={type:'Box',props:{display:'none',height:3,overflow:'hidden',position:'absolute',right:0,columnGap:1,rowGap:1,alignSelf:'flex-start'},hover:{display:'flex'},children:[]};
const rest=render(box,ctx),hover=render(box,{...ctx,hover:true}),terminal=render(box,{...ctx,term:true});
console.log(JSON.stringify({rest:rest.style,hover:hover.style,terminal:terminal.style,dark:TERMINALS.dark.theme.warning,light:TERMINALS.light.theme.error}));
''')
        self.assertEqual(actual['rest']['display'], 'none')
        self.assertEqual(actual['hover']['display'], 'flex')
        self.assertEqual(actual['rest']['height'], '60px')
        self.assertEqual(actual['terminal']['height'], '48px')
        self.assertEqual(actual['rest']['overflow'], 'hidden')
        self.assertEqual(actual['rest']['right'], '0px')
        self.assertEqual(actual['rest']['columnGap'], '7.8px')
        self.assertEqual(actual['rest']['rowGap'], '20px')
        self.assertEqual(actual['rest']['alignSelf'], 'flex-start')
        self.assertEqual(actual['dark'], '#E2B341')
        self.assertEqual(actual['light'], '#B02A3E')

    def test_original_four_hundred_and_unique_expanded_files(self):
        rows=[{'surface':surface,'mode':mode,'layout':layout,'scene':str(scene),'width':800,'original':True}
              for surface in ('desktop','terminal') for mode in ('light','dark') for layout in ('rest','row') for scene in range(50)]
        requested=[{'surface':surface,'mode':mode,'requestedTheme':mode,'layout':layout,
                    'scene':('pixel-' if pixel else '')+scene,'width':width,'columns':columns,
                    'original':False,'lang':'en','pixel':pixel}
                   for surface in ('desktop','terminal') for mode in ('light','dark','light-daltonized')
                   for layout in ('rest','row')
                   for columns,width in ([(100,800)] if surface=='desktop' else [(100,800),(80,624),(60,468)])
                   for scene in ('think-to-search','cheer-to-happy','burst','burst-to-think')
                   for pixel in (False,True)]
        self.assertEqual(len(rows),400)
        self.assertEqual(len(requested),192)
        complete=rows+requested
        self.preview.check_inventory(complete)
        extra=rows[0]|{'original':False,'lang':'fr','width':300}
        self.preview.check_inventory(complete+[extra])
        self.assertTrue(self.preview.capture_name(extra).endswith('-fr-300px'))
        with self.assertRaises(ValueError):
            self.preview.check_inventory(complete+[extra,extra])
        with self.assertRaises(ValueError):
            self.preview.check_inventory(rows[:-1]+requested)
        with self.assertRaisesRegex(ValueError,'requested preview matrix incomplete'):
            self.preview.check_inventory(rows+requested[:-1])

    def test_export_only_and_small_button_band_contract(self):
        source=(ROOT/'tools/preview/build-c3-preview.py').read_text()
        self.assertNotIn('builtin_themes(',source.replace('builtin_themes() is never called',''))
        self.assertNotIn('subprocess.run',source)
        self.assertIn("'#2B2A27' if dark else '#F0EEE6'",source)
        self.assertIn('height:20px;padding:0 8px',source)
        dump=(ROOT/'tools/preview/c3-dump.test.tsx').read_text()
        self.assertIn("numberLocale(lang),{style:'percent'",dump)
        self.assertIn("['en','zh','zh-Hant','ja','ko','hi','fr']",dump)
        self.assertIn('surface===\'desktop\'?[800,420,300]:[800,624,468]',dump)
        columns=re.search(r"columns:(surface==='terminal'.+?),original:false",dump)[1]
        geometry=node("const surface='terminal'; const widths=[800,624,468]; " +
                      "console.log(JSON.stringify(widths.map(width=>{const columns="+columns+
                      "; return [columns,columns*7.8,width];})));" )
        self.assertEqual(geometry,[[100,780,800],[80,624,624],[60,468,468]])
        self.assertIn('Pixel band keeps 35 x 32 frame',dump)
        self.assertIn('Painted frame uses the shipping padded SVG width',dump)
        self.assertIn('slot.visible(MORNING+time)',dump)

    def test_gif_evaluator_composites_real_pngs_inside_each_opacity_group(self):
        spec=importlib.util.spec_from_file_location('c3_gifs',ROOT/'tools/preview/build-c3-gifs.py')
        gifs=importlib.util.module_from_spec(spec);spec.loader.exec_module(gifs)
        manifest=json.loads((ROOT/'plugin/assets/frame-manifest.json').read_text())
        item=next(row for row in manifest['frames']if row['name']=='cheer-a')
        png=base64.b64encode((ROOT/'plugin/assets/desktop'/item['filename']).read_bytes()).decode()
        from PIL import ImageFilter
        decoded=gifs.affine.decode(png)
        width,height=decoded.size
        self.assertEqual([width,height],manifest['desktop_size'])
        self.assertEqual([width,height],[151,128])
        core=decoded.getchannel('A').filter(ImageFilter.MinFilter(9))
        x,y=next((x,y)for y in range(core.height)for x in range(core.width)if core.getpixel((x,y))==255)
        image=f'<image href="data:image/png;base64,{png}" width="{width}" height="{height}"/>'
        svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}"><g opacity=".5">{image}{image}</g></svg>'
        painted=gifs.picture(svg,0)
        self.assertEqual(painted.getpixel((2*x+1,2*y+1))[3],128)
        # An opaque prior drawing beneath that completed group has full coverage.
        svg=svg.replace('<g opacity=".5">',image+'<g opacity=".5">')
        self.assertEqual(gifs.picture(svg,0).getpixel((2*x+1,2*y+1))[3],255)

    def test_gif_direction_changes_preserve_the_captured_leading_space(self):
        # Execute the real existing emitter function, including its nested placement.
        # This NBSP is the English shipping band tree's stage-direction prefix.
        source=ast.parse((ROOT/'tools/preview/build-c3-gifs.py').read_text())
        function=next(n for n in ast.walk(source)if isinstance(n,ast.FunctionDef)and n.name=='direction')
        env={'re':re}
        exec(compile(ast.Module(body=[function],type_ignores=[]),'actual-gif-direction','exec'),env)
        row={'type':'Text','props':{'color':'inactive','wrap':'truncate-end'},'children':['\u00a0(cheering, both hands up)']}
        self.assertEqual(env['direction'](row,'(smiling at the page)')['children'],['\u00a0(smiling at the page)'])
        row['children']=['(被戳了一下)']
        self.assertEqual(env['direction'](row,'(对着书页笑了)')['children'],['(对着书页笑了)'])

    def test_reusing_picture_gifs_requires_identical_serialized_picture_sources(self):
        spec=importlib.util.spec_from_file_location('c3_gifs',ROOT/'tools/preview/build-c3-gifs.py')
        gifs=importlib.util.module_from_spec(spec);spec.loader.exec_module(gifs)
        source=ast.parse((ROOT/'tools/preview/build-c3-gifs.py').read_text())
        main=next(n for n in source.body if isinstance(n,ast.FunctionDef)and n.name=='main')
        block=next(n for n in main.body if isinstance(n,ast.If)and ast.unparse(n.test)=='args.refresh_bands')
        from PIL import Image
        with tempfile.TemporaryDirectory(prefix='moe-c3-gif-reuse-',dir='/private/tmp')as scratch:
            out=Path(scratch);target=out/'green.gif'
            Image.new('RGB',(2,2),'black').save(target,save_all=True,append_images=[Image.new('RGB',(2,2),'white')],duration=[100,100])
            row={'name':'green','duration':200,'phases':[{'at':0,'scene':'green','aside':'old','svg':'<svg/>'}]}
            receipt={'path':str(target),'sourceStable':True,'encodedFrames':2,'encodedDurationMs':200,'inputSourceHashes':{'plugin/hooks/hooks-bundle.js':'old','plugin/hooks/c3-motion.ts':'same'}}
            (out/'gifs.json').write_text(json.dumps([receipt]));(out/'export-receipt.json').write_text('{"wallSeconds":1}')
            env=dict(gifs.__dict__,args=SimpleNamespace(refresh_bands=True),out=out,inputHashes={'plugin/hooks/hooks-bundle.js':'new','plugin/hooks/c3-motion.ts':'same'},receipts=[],oldRows=[row],rows=[row|{'phases':[row['phases'][0]|{'aside':'new'}]}])
            actual=compile(ast.Module(body=[block],type_ignores=[]),'actual-gif-reuse','exec')
            exec(actual,env)
            self.assertEqual(len(env['receipts']),1)
            self.assertEqual(env['receipts'][0]['inputSourceHashes']['plugin/hooks/hooks-bundle.js'],'old')
            self.assertEqual(env['receipts'][0]['verifiedAgainstCurrentSvgInputHashes']['plugin/hooks/hooks-bundle.js'],'new')
            env['receipts']=[];env['rows']=[row|{'phases':[row['phases'][0]|{'svg':'<svg><g/></svg>'}]}]
            with self.assertRaisesRegex(ValueError,'serialized picture'):
                exec(actual,env)


if __name__ == '__main__':
    unittest.main(verbosity=2)
