#!/usr/bin/env python3
"""Pure receipt parser controls; retained SDK logs are explicit owned inputs."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys
import unittest

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
spec = importlib.util.spec_from_file_location('binding19_checker_contract', TOOLS / 'check-m1-binding19.py')
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)
names = json.loads((TOOLS / 'm1-binding19-names.json').read_text())
logs = {}

class ReceiptControls(unittest.TestCase):
    def test_actual_green_exact19(self):
        row = checker.sdk_receipt(logs['green'], names, 0)
        self.assertTrue(row['green_accepted'])
        self.assertTrue(row['complete_numeric_summary'])

    def test_actual_restored_green_exact19(self):
        self.assertTrue(checker.sdk_receipt(logs['restored-green'], names, 0)['green_accepted'])

    def test_actual_optional_model_sdk_case_timeout_rejected(self):
        row = checker.sdk_receipt(logs['optional-model'], names, 1)
        self.assertTrue(row['exact_inventory'])
        self.assertTrue(row['complete_numeric_summary'])
        self.assertEqual(len(row['sdk_case_timeouts']), 1)
        self.assertTrue(row['timed_out'])
        self.assertFalse(row['red_accepted'])

    def test_actual_stale_custom_json_assertion_is_ordinary(self):
        row = checker.sdk_receipt(logs['stale-row-epoch-and-abort'], names, 1)
        self.assertEqual(len(row['failed_names']), 1)
        self.assertTrue(all(row['ordinary_assertion_failures'].values()))
        self.assertTrue(row['red_accepted'])

    def test_actual_stale_nonzero_two_is_not_red(self):
        self.assertFalse(checker.sdk_receipt(logs['stale-row-epoch-and-abort'], names, 2)['red_accepted'])

    def test_missing_numeric_summary_rejected(self):
        changed, count = re.subn(r'(?m)^\s*0 fail\s*$', '', logs['green'])
        self.assertEqual(count, 1)
        row = checker.sdk_receipt(changed, names, 0)
        self.assertTrue(row['exact_inventory'])
        self.assertFalse(row['complete_numeric_summary'])
        self.assertFalse(row['green_accepted'])

    def test_truncated_actual_receipt_rejected(self):
        changed = re.split(r'(?m)^\s*19 pass\s*$', logs['green'])[0]
        self.assertFalse(checker.sdk_receipt(changed, names, 0)['green_accepted'])

    def test_missing_original_name_rejected(self):
        changed, count = re.subn(r'(?m)^\(pass\) [^\n]*\n', '', logs['green'], count=1)
        self.assertEqual(count, 1)
        self.assertFalse(checker.sdk_receipt(changed, names, 0)['exact_inventory'])

    def test_duplicate_original_name_rejected(self):
        rows = re.findall(r'^\(pass\) (.*?) \[', logs['green'], re.M)
        changed = logs['green'].replace('(pass) ' + rows[1] + ' [', '(pass) ' + rows[0] + ' [', 1)
        self.assertFalse(checker.sdk_receipt(changed, names, 0)['exact_inventory'])

    def test_scanner_error_cannot_hide_behind_exact19(self):
        row = checker.sdk_receipt('ScannerError: module registration rejected\n' + logs['green'], names, 0)
        self.assertTrue(row['scanner_rejected'])
        self.assertFalse(row['green_accepted'])

    def test_primary_hooks_error_cannot_be_feature_red(self):
        row = checker.sdk_receipt('HooksError: no implementation for ui.scroll\n' + logs['stale-row-epoch-and-abort'], names, 1)
        self.assertTrue(row['setup_failed'])
        self.assertFalse(row['red_accepted'])

    def test_primary_setup_exception_cannot_hide(self):
        row = checker.sdk_receipt('TypeError: missing input\n' + logs['green'], names, 0)
        self.assertTrue(row['setup_failed'])
        self.assertFalse(row['green_accepted'])

    def test_process_timeout_cannot_hide_behind_complete_names(self):
        self.assertFalse(checker.sdk_receipt(logs['green'], names, 0, True)['green_accepted'])

    def test_assertion_and_expect_must_be_in_same_failed_block(self):
        changed = logs['green'].replace('(pass) ', '(fail) ', 1)
        changed = re.sub(r'(?m)^(\(fail\) [^\n]*\n)', r'\1  AssertionError: diagnostic message\n', changed, count=1)
        changed = changed.replace('19 pass', '18 pass').replace('0 fail', '1 fail')
        changed += '\n  expect(received).toEqual()\n'
        row = checker.sdk_receipt(changed, names, 1)
        self.assertTrue(row['exact_inventory'])
        self.assertTrue(row['complete_numeric_summary'])
        self.assertFalse(row['red_accepted'])

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--receipts-root', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    pins = {}
    for stage in ['green', 'restored-green', 'optional-model', 'stale-row-epoch-and-abort']:
        path = args.receipts_root / (stage + '.log')
        data = path.read_bytes()
        logs[stage] = data.decode('utf-8')
        pins[str(path)] = hashlib.sha256(data).hexdigest()
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(ReceiptControls))
    args.out.write_text(json.dumps({'schema': 'm1-binding19-pure-parser-controls-v1',
        'parserControlsOnly': True, 'sdkExecuted': False, 'cases': result.testsRun,
        'failures': len(result.failures), 'errors': len(result.errors),
        'accepted': result.wasSuccessful(), 'actualRetainedInputSHA256': pins,
        'checkerSHA256': hashlib.sha256((TOOLS / 'check-m1-binding19.py').read_bytes()).hexdigest()}, indent=2) + '\n')
    raise SystemExit(0 if result.wasSuccessful() else 1)
