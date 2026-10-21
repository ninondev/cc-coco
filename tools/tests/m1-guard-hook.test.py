#!/usr/bin/env python3
"""A17 is deferred: no classic startup guard can dispatch on any platform."""
import copy
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
PLATFORMS = ('macos-arm64', 'macos-x86_64', 'linux-aarch64', 'linux-x86_64', 'windows-aarch64', 'windows-x86_64')


def guard_dispatches(config, platform):
    if not isinstance(config.get('modules'), list) or not config['modules']:
        raise AssertionError('mod modules must remain registered')
    # The real schema has one command on every platform, no platform selector.
    return [hook for group in config.get('hooks', {}).get('SessionStart', [])
            for hook in group.get('hooks', [])
            if hook.get('type') == 'command' and 'coco-guard' in str(hook.get('command', ''))]


class GuardHook(unittest.TestCase):
    def test_retained_source_stays_outside_shipping_plugin(self):
        for filename in ('coco-guard.rs', 'coco-guard-words.rs', 'owned_logs.rs', 'request_json.rs'):
            self.assertTrue((ROOT / 'tools/native' / filename).is_file())
            self.assertFalse((ROOT / 'plugin/bin' / filename).exists())
        self.assertFalse((ROOT / 'plugin/bin/coco-guard').exists())

    def test_reintroduced_hook_copy_is_red_on_every_platform(self):
        config = json.loads((ROOT / 'plugin/hooks/hooks.json').read_text())
        broken = copy.deepcopy(config)
        broken.setdefault('hooks', {}).setdefault('SessionStart', []).append({'hooks': [
            {'type': 'command', 'command': '${CLAUDE_PLUGIN_ROOT}/bin/coco-guard', 'args': ['--revision', '1.0']}
        ]})
        for platform in PLATFORMS:
            self.assertEqual(len(guard_dispatches(broken, platform)), 1)
            self.assertEqual(guard_dispatches(config, platform), [])

    def test_missing_module_registration_is_red(self):
        with self.assertRaises(AssertionError):
            guard_dispatches({'modules': []}, PLATFORMS[0])


def platform_case(platform):
    def check(self):
        config = json.loads((ROOT / 'plugin/hooks/hooks.json').read_text())
        self.assertEqual(guard_dispatches(config, platform), [])
    return check


for platform in PLATFORMS:
    setattr(GuardHook, 'test_session_start_skips_' + platform.replace('-', '_'), platform_case(platform))

if __name__ == '__main__':
    unittest.main()
