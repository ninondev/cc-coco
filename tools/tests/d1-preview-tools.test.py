import importlib.util
import hashlib
import json
from pathlib import Path
import unittest
import sys
import tempfile
from unittest.mock import patch
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[2]
def load(name,file):
 spec=importlib.util.spec_from_file_location(name,ROOT/'tools/preview'/file);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
C=load('d1_preview_common','d1-preview-common.py')
G=load('d1_gifs','build-d1-gifs.py')
class PreviewTools(unittest.TestCase):
 def test_actual_measurement_parser_counts_utf16_svg_and_preserves_missing_metrics(self):
  M=load('d1_measurements','measure-d1-captures.py')
  room='<svg viewBox="0 0 160 90">😀</svg>';large='x'*131072
  rows=[dict(surface='desktop',mode='dark',scene='room-all-night',width=800,tree={'type':'Box','children':[{'type':'Svg','props':{'key':'room','source':room}}]}),dict(surface='desktop',mode='light',scene='helpers-5',width=800,tree={'type':'Svg','props':{'source':large}})]
  result=M.measure_svg(rows)
  self.assertEqual(result['builtSvgOccurrences'],2);self.assertEqual(result['records'][0]['charactersUTF16'],len(room)+1)
  self.assertEqual(result['largestRoom']['charactersUTF16'],len(room)+1);self.assertEqual(result['largestRoom']['scene'],'room-all-night')
  self.assertFalse(result['allBelow131072']);self.assertEqual(len(result['violations']),1)
  with self.assertRaises(ValueError):M.measure_svg([rows[0]|{'tree':{'type':'Svg','props':{}}}])
  metric={'idleWindowMs':60000,'actualRenderCounterAvailable':False,'renderDelta':None,'before':{'renders':0,'invalidations':4},'after':{'renders':0,'invalidations':4},'positiveD1Control':{'shedFirstLineShown':True,'shedFirstSaved':True}}
  line='D1_IDLE_MINUTE_METRIC '+json.dumps(metric)
  records=M.parse_metrics(line)
  self.assertEqual(records[0]['testResult'],'not_observed');self.assertIsNone(records[0]['measurement']['renderDelta'])
  name='D1 mounted shipping desktop remains idle for a measured full minute'
  passed=M.parse_metrics(line+'\n(pass) '+name+' [4ms]\n')[0]
  self.assertEqual(passed['testResult'],'passed');self.assertIsNone(passed['measurement']['renderDelta']);self.assertEqual(passed['computedDeltas']['invalidations'],0);self.assertIsNone(passed['computedDeltas']['renders'])
  failed=M.parse_metrics(line+'\n(fail) '+name+' [4ms]\n')[0];self.assertEqual(failed['testResult'],'failed')
  self.assertEqual(M.parse_metrics('D1_SHED_CACHE_METRIC {"idleWindowMs":10000}\n')[0]['tag'],'D1_SHED_CACHE_METRIC')
  self.assertEqual(M.parse_metrics(''),[])
  self.assertEqual(M.validate_group_plan(['actual-a','actual-b'],['actual-b','actual-a']),{'matches':True,'missing':[],'unexpected':[]})
  self.assertEqual(M.validate_group_plan(['actual-a'],['actual-a','actual-b']),{'matches':False,'missing':['actual-b'],'unexpected':[]})
  with self.assertRaises(ValueError):M.validate_group_plan(['actual-a'],['actual-a','actual-a'])
 def test_exact_motion_group_selection_preserves_all_phases_scales_and_rejects_unknown(self):
  keys=[('helpers-arrive','desktop','light','rest','en',800,False,False),('helpers-arrive','desktop','dark','row','en',800,True,False)]
  groups={key:[{'at':0},{'at':500}] for key in keys};names=[G.motion_group_name(key) for key in keys]
  self.assertNotEqual(*names);self.assertIs(G.select_named_motion_groups(groups,None),groups)
  selected=G.select_named_motion_groups(groups,[names[1]])
  self.assertEqual(list(selected),[keys[1]]);self.assertIs(selected[keys[1]],groups[keys[1]])
  with self.assertRaises(ValueError):G.select_named_motion_groups(groups,[names[0],'unknown'])
 def test_frame_scratch_cleanup_is_opt_in_verified_and_excludes_other_artifacts(self):
  with tempfile.TemporaryDirectory(dir=__import__('os').environ['TMPDIR']) as temporary:
   root=Path(temporary);folder=root/'owned-frames';folder.mkdir();page=folder/'0000.html';png=folder/'0000.png';page.write_text('generated frame');png.write_bytes(b'generated png');target=root/'verified.gif';target.write_bytes(b'unit fixture GIF');static=root/'static.png';static.write_bytes(b'preserve static')
   receipt={'path':str(target),'sha256':C.digest(target),'encodedDurationMs':2000,'sampledDurationMs':2000,'encodedFrames':2,'distinctRgbaFrames':2,'distinctEncodedRgbaFrames':2}
   plan={'folder':folder,'pages':[page],'pngs':[png]};record=root/'gif-receipts.json';receipts=[receipt]
   G.write_gif_receipt(receipts,record,plan,False)
   self.assertTrue(folder.exists());self.assertEqual(json.loads(record.read_text())[0]['frameScratch']['status'],'retained')
   receipt['encodedDurationMs']=1990
   with self.assertRaises(ValueError):G.write_gif_receipt(receipts,record,plan,True)
   self.assertTrue(page.exists());self.assertTrue(png.exists());receipt['encodedDurationMs']=2000
   receipt['distinctEncodedRgbaFrames']=1
   with self.assertRaises(ValueError):G.write_gif_receipt(receipts,record,plan,True)
   self.assertTrue(folder.exists());receipt['distinctEncodedRgbaFrames']=2
   unrelated=folder/'unowned.txt';unrelated.write_text('retain')
   with self.assertRaises(ValueError):G.write_gif_receipt(receipts,record,plan,True)
   self.assertTrue(unrelated.exists());self.assertTrue(page.exists());unrelated.unlink()
   original_unlink=Path.unlink
   def observed_unlink(path,*args,**kwargs):
    saved=json.loads(record.read_text())[0]
    self.assertEqual(saved['sha256'],C.digest(target));self.assertEqual(saved['frameScratch']['status'],'pending_discard');self.assertEqual(len(saved['frameScratch']['files']),2)
    return original_unlink(path,*args,**kwargs)
   with patch.object(Path,'unlink',observed_unlink):G.write_gif_receipt(receipts,record,plan,True)
   self.assertFalse(folder.exists());self.assertTrue(target.exists());self.assertTrue(static.exists())
   saved=json.loads(record.read_text())[0]['frameScratch'];self.assertEqual(saved['status'],'discarded');self.assertEqual(len(saved['files']),2)
   self.assertEqual({entry['sha256'] for entry in saved['files']},{hashlib.sha256(b'generated frame').hexdigest(),hashlib.sha256(b'generated png').hexdigest()})
 def test_baseline_receipt_requires_each_named_failure_to_have_its_own_assertion(self):
  R=load('d1_baseline_replay_receipts','replay-d1-baselines.py')
  names=['expected first','expected second']
  actual='Expected: 0\nReceived: 1\n(fail) expected first [1ms]\nTest timed out\n(fail) expected second [5000ms]\n'
  found=R.failed_assertions(actual,names)
  self.assertTrue(found['expected first']);self.assertFalse(found['expected second'])
  actual='Expected: 0\nReceived: 1\n(fail) expected first [1ms]\n(pass) unrelated [2ms]\nExpected: 4\nReceived: 5\n(fail) expected second [3ms]\n'
  self.assertEqual(R.failed_assertions(actual,names),dict.fromkeys(names,True))
  self.assertEqual(R.failed_assertions('Validation error: expected first\n',names),dict.fromkeys(names,False))
 def test_motion_id_filter_selects_complete_families_and_rejects_unknown_ids(self):
  keys=[('ribbon-with-glance','desktop','light','rest','en',800,False,False),('ribbon-with-glance','terminal','dark','rest','en',800,True,False),('helpers-arrive','desktop','dark','row','en',800,True,False)]
  groups={key:[{'motion':{'id':key[0],'atMs':0,'endMs':3400}},{'motion':{'id':key[0],'atMs':120,'endMs':3400}}] for key in keys}
  self.assertIs(G.select_motion_groups(groups,None),groups)
  selected=G.select_motion_groups(groups,['ribbon-with-glance'])
  self.assertEqual(list(selected),keys[:2])
  for key in selected:self.assertIs(selected[key],groups[key]);self.assertEqual(len(selected[key]),2)
  self.assertEqual(list(G.select_motion_groups(groups,['helpers-arrive','ribbon-with-glance','helpers-arrive'])),keys)
  with self.assertRaises(ValueError):G.select_motion_groups(groups,['unknown'])
  with self.assertRaises(ValueError):G.select_motion_groups(groups,['ribbon-with-glance','unknown'])
 def test_snapshot_dispatch_keeps_single_fallback_and_rejects_partial_batch_receipts(self):
  jobs=[dict(id='one',page='/private/tmp/moe-d1-previews/a.html',png='/private/tmp/moe-d1-previews/a.png',width=832,scale=1,mode='light'),dict(id='two',page='/private/tmp/moe-d1-previews/b.html',png='/private/tmp/moe-d1-previews/b.png',width=947,scale=2,mode='dark')]
  with patch.object(C,'snapshot',side_effect=[{'exitCode':0,'pngExists':True,'pngSha256':'fixture'} for _ in jobs]) as single,patch.object(C,'append_receipt'):
   rows=C.run_snapshots(jobs,'unused',single='existing-single')
   self.assertEqual([row['jobId'] for row in rows],['one','two']);self.assertEqual(single.call_count,2)
   self.assertEqual(single.call_args_list[0].args,('existing-single',jobs[0]['page'],jobs[0]['png'],832,1,'light'))
  with patch.object(C,'require_batch_equivalence'),patch.object(C,'snapshot_batch',return_value=[{'jobId':'one','exitCode':0,'pngExists':True}]),patch.object(C,'snapshot') as single:
   with self.assertRaises(RuntimeError):C.run_snapshots(jobs,'unused',batch='batch',equivalence='proof')
   single.assert_not_called()
  with self.assertRaises(ValueError):C.run_snapshots(jobs,'unused',batch='batch')
 def test_output_guard_rejects_worktree_and_arbitrary_temp_paths(self):
  for target in [ROOT/'renders',Path('/private/tmp/other')]:
   with self.assertRaises(ValueError):C.output_path(target)
  self.assertEqual(C.output_path('/private/tmp/moe-d1-previews/static'),Path('/private/tmp/moe-d1-previews/static'))
 def test_capture_names_disambiguate_locale_hover_width_and_theme(self):
  capture=dict(surface='desktop',mode='light',scene='ribbon-1',layout='rest',lang='en',width=800,columns=100,tree={'type':'Box'})
  self.assertNotEqual(C.capture_name(capture),C.capture_name(capture|{'lang':'zh'}))
  self.assertNotEqual(C.capture_name(capture),C.capture_name(capture|{'hover':True}))
  self.assertNotEqual(C.capture_name(capture),C.capture_name(capture|{'pixel':True}))
  self.assertNotEqual(C.capture_name(capture),C.capture_name(capture|{'state':'reduced'}))
  self.assertNotEqual(C.capture_name(capture|{'state':'reduced'}),C.capture_name(capture|{'state':'motion'}))
  with self.assertRaises(ValueError):C.validate_captures([capture,capture])
  with self.assertRaises(ValueError):C.validate_captures([capture|{'mode':'sepia'}])
 def test_css_sampling_preserves_multi_animation_offsets_and_negative_delay(self):
  svg='<svg><style>.b{animation:knot 200ms cubic-bezier(0,0,.2,1) -120ms both}.t{animation:drop 300ms cubic-bezier(0,0,.2,1) 110ms both,sway 520ms cubic-bezier(.37,0,.63,1) 390ms both}</style><g/></svg>'
  sampled=G.sample_svg(svg,200)
  self.assertIn('.b{animation-delay:-320ms;animation-play-state:paused}',sampled)
  self.assertIn('.t{animation-delay:-90ms,190ms;animation-play-state:paused}',sampled)
  self.assertIn('knot 200ms',sampled)
  inline=G.sample_svg('<svg><image style="animation:d1glance 720ms steps(1,end) -120ms both"/></svg>',200)
  self.assertIn('animation-delay:-320ms;animation-play-state:paused',inline)
 def test_css_sampler_handles_seconds_and_infinite_and_clamps_no_keyframes(self):
  self.assertIn('animation-delay:-750ms',G.sample_svg('<svg><style>.x{animation:pulse .8s linear .25s infinite}</style></svg>',1000))
  self.assertEqual(G.sample_svg('<svg><rect/></svg>',200),'<svg><rect/></svg>')
 def test_css_sampler_preserves_important_none_and_rejects_missing_duration(self):
  for none in ['none!important','none ! important','NONE !IMPORTANT']:
   svg='<svg><style>.reduced{animation:'+none+'}</style><g style="animation:'+none+'"/></svg>'
   self.assertEqual(G.sample_svg(svg,137),svg)
   self.assertFalse(G.animated({'type':'Svg','props':{'source':svg}}))
  with self.assertRaises(ValueError):G.sample_svg('<svg><style>.broken{animation:missing-clock}</style></svg>',137)
  active='<svg><style>.active{animation:drop 300ms linear 110ms both}.reduced{animation:none!important}</style></svg>'
  self.assertIn('.active{animation-delay:-27ms;animation-play-state:paused}',G.sample_svg(active,137))
  self.assertTrue(G.animated({'type':'Svg','props':{'source':active}}))
 def test_timeline_rejects_missing_zero_phase_duplicate_phases_and_reduced_only_motion(self):
  base=dict(surface='desktop',mode='light',layout='rest',lang='en',width=800,columns=100,scene='ribbon-with-glance',tree={'type':'Svg','props':{'source':'<svg><style>.x{animation:pulse 200ms linear}</style></svg>'}},motion={'id':'ribbon-with-glance','atMs':0,'endMs':1000})
  groups=G.motion_groups([base]);self.assertEqual(len(groups),1)
  for rows in [[base|{'motion':base['motion']|{'atMs':200}}],[base,base],[base|{'tree':{'type':'Svg','props':{'source':'<svg/>'}}}]]:
   with self.assertRaises(ValueError):G.motion_groups(rows)
  frames=G.frame_times(1000,30)
  self.assertEqual(sum(delay for _,delay in frames),1000)
  self.assertEqual(frames[0][0],0)
 def test_html_payload_cannot_close_script_and_reference_mapping_matches_approved_names(self):
  capture=dict(surface='desktop',mode='light',scene='room-all-day',layout='book',lang='en',width=800,columns=100,tree={'type':'Text','children':['</script><script>fetch("https://bad")</script>']})
  page=C.page_html(capture,None,'const render=()=>null;const DESKTOPS={light:{theme:{}}};')
  self.assertNotIn('</script><script>fetch',page)
  self.assertIn("connect-src 'none'",page)
  self.assertEqual(C.reference_name(capture),'01-room-book-desktop-light.png')
  self.assertEqual(C.reference_name(capture|{'scene':'helpers-5','layout':'rest'}),'04-helpers-surfaces-light.png')
 def test_actual_frame_scratch_constructor_obeys_supplied_TMPDIR(self):
  requested=[]
  class ObservedConstructor(Exception):pass
  def observe(*args,**kwargs):
   requested.append(kwargs.get('dir'));raise ObservedConstructor()
  selected=__import__('os').environ['TMPDIR']
  with patch.object(tempfile,'TemporaryDirectory',observe):
   with self.assertRaises(ObservedConstructor):self.test_frame_scratch_cleanup_is_opt_in_verified_and_excludes_other_artifacts()
  self.assertEqual(requested,[selected])
if __name__=='__main__':unittest.main()
