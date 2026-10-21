#!/usr/bin/env python3
"""Full-suite CPU receipts retain per-registration coverage and missing clocks."""
import copy
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from hook_cpu import aggregate, envelope_receipt, target_inventory


def row(index, component, calls=0, cpu=None):
    return {'registration': index, 'pattern': 'ui.render', 'matcher': {'component': component},
            'calls': calls, 'settled': calls, 'pending': 0,
            'measured': calls if cpu is not None else 0, 'missingClock': calls if cpu is None else 0,
            'maxCpuMs': cpu, 'totalCpuMs': (cpu or 0) * calls,
            'components': [component] if calls else [], 'events': ['ui.render'] if calls else []}


def receipt(name, *rows):
    return {'marker': 'p1-kit-hook-cpu', 'version': 1, 'scope': 'hook-worker-process-inclusive',
            'test': name, 'hooks': list(rows), 'limitations': ['inclusive worker CPU']}


class HookCpuReceipts(unittest.TestCase):
    def test_union_covers_individual_filters_across_tests(self):
        output = aggregate([receipt('pane', row(0, 'Pane', 1, 2), row(1, 'AbovePrompt')),
                            receipt('band', row(0, 'Pane'), row(1, 'AbovePrompt', 1, 3))], {'defaultMaxCpuMs': 4})
        self.assertEqual(output['gaps'], [])
        self.assertEqual([r['tests'] for r in output['hooks']], [['pane'], ['band']])
        self.assertEqual([r['matcher'] for r in output['hooks']], [{'component': 'Pane'}, {'component': 'AbovePrompt'}])

    def test_missing_clock_is_not_erased_by_other_measured_calls(self):
        output = aggregate([receipt('unknown', row(0, 'Pane', 1)), receipt('known', row(0, 'Pane', 1, 2))], {'defaultMaxCpuMs': 4})
        self.assertEqual(output['gaps'], ['registration 0 ui.render: CPU primitive unavailable'])

    def test_inventory_drift_uncovered_filter_and_component_budget_fail(self):
        first = receipt('pane', row(0, 'Pane', 1, 3), row(1, 'AbovePrompt'))
        second = copy.deepcopy(first)
        second['hooks'][1]['matcher']['surface'] = 'desktop'
        output = aggregate([first, second], {'defaultMaxCpuMs': 4, 'byComponent': {'Pane': 2}})
        self.assertIn('registered hook inventory differs between full-suite tests', output['gaps'])
        self.assertIn('registration 0 ui.render: 3 CPU ms exceeds 2', output['gaps'])
        self.assertEqual(output['gaps'].count('registration 1 ui.render: no dispatched calls'), 2)

    def test_empty_receipt_collection_fails(self):
        self.assertEqual(aggregate([], {'defaultMaxCpuMs': 4})['gaps'], ['no full-suite hook CPU receipts'])

    def test_invalid_counters_and_nan_cpu_cannot_pass(self):
        invalid = row(0, 'Pane', 1, 2)
        invalid['settled'] = -1
        output = aggregate([receipt('invalid', invalid)], {'defaultMaxCpuMs': 4})
        self.assertIn('malformed hook CPU registration counters or coverage', output['gaps'])
        invalid = row(0, 'Pane', 1, float('nan'))
        output = aggregate([receipt('invalid', invalid)], {'defaultMaxCpuMs': 4})
        self.assertIn('malformed hook CPU measurement', output['gaps'])

    def test_envelope_uses_actual_command_cpu_and_named_target_budget(self):
        target = {'event': 'ui.render', 'component': 'Pane', 'surface': 'desktop'}
        emitted = {'event': 'ui.render', 'component': 'Pane', 'scope': 'isolated-cli-command-inclusive-cpu', 'dispatched': True, 'hostGap': None}
        outcome = {'stdout': 'P1_HOOK_EVENT_ENVELOPE ' + json.dumps(emitted), 'stderr': '', 'cpuSeconds': 3.5, 'deadlineInterrupted': False}
        result = envelope_receipt(target, outcome, 3)
        self.assertEqual(result['target'], 'ui.render:Pane')
        self.assertEqual(result['gaps'], ['3.5 CPU s exceeds 3'])
        self.assertEqual(envelope_receipt(target, outcome, 3, measure=True)['gaps'], [])
        self.assertFalse(envelope_receipt(target, outcome, 3, measure=True)['budgetEnforced'])

    def test_envelope_rejects_missing_cpu_wrong_target_and_host_gap(self):
        emitted = {'event': 'session.append', 'component': None, 'scope': 'isolated-cli-command-inclusive-cpu', 'dispatched': True, 'hostGap': 'unsupported append host'}
        outcome = {'stdout': 'P1_HOOK_EVENT_ENVELOPE ' + json.dumps(emitted), 'stderr': '', 'cpuSeconds': None, 'deadlineInterrupted': False}
        result = envelope_receipt({'event': 'session.append'}, outcome, 3)
        self.assertEqual(result['gaps'], ['actual command CPU measurement unavailable'])
        self.assertEqual(result['platformGaps'], ['unsupported append host'])
        self.assertEqual(result['measuredCallbackScope'], 'prompt and response pre-next callback paths')
        self.assertIn('target dispatch receipt identity mismatch', envelope_receipt({'event': 'session.start'}, outcome, 3)['gaps'])

    def test_source_inventory_expands_all_render_components_and_keeps_filters(self):
        root = Path(__file__).resolve().parents[2]
        declarations, targets = target_inventory(root / 'plugin')
        components = {row['component'] for row in declarations if row['pattern'] == 'ui.render'}
        self.assertEqual({row['component'] for row in targets if row['event'] == 'ui.render'}, components)
        self.assertIn('AbovePrompt', components)
        self.assertTrue(any(row['matcherSource'] and 'BOOK_PANE' in row['matcherSource'] for row in declarations))
        self.assertEqual(len({(row['event'], row.get('component')) for row in targets}), len(targets))

    def test_non_object_dispatch_receipt_fails_without_aborting_inventory(self):
        for value in (None, [], 'text', 2):
            with self.subTest(value=value):
                result = envelope_receipt({'event': 'session.start'}, {
                    'stdout': 'P1_HOOK_EVENT_ENVELOPE ' + json.dumps(value),
                    'cpuSeconds': 1, 'deadlineInterrupted': False}, 3)
                self.assertFalse(result['targetDispatched'])
                self.assertIn('target dispatch receipt must be an object', result['gaps'])

    def test_committed_target_budgets_cover_inventory_and_actual_three_run_samples(self):
        root = Path(__file__).resolve().parents[2]
        registry = json.loads((root / 'tools/promises.json').read_text())
        budgets = next(row for row in registry if row['id'] == 'C6')['hookCpuBudgets']
        _, targets = target_inventory(root / 'plugin')
        self.assertEqual(set(budgets['byTarget']), {row['event'] + (':' + row['component'] if row.get('component') else '') for row in targets})
        for target, samples in budgets['samples'].items():
            self.assertEqual(len(samples), 3, target)
            self.assertGreaterEqual(budgets['byTarget'][target], max(samples), target)


if __name__ == '__main__':
    unittest.main()
