import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scratch import TemporaryDirectory


class NeighboursRunnerInputs(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('neighbours_fixture_runner',
                                                     Path(__file__).with_name('companion-neighbours.py'))
        self.runner = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.runner)
        self.temporary = TemporaryDirectory(prefix='s2-neighbours-runner-')
        self.addCleanup(self.temporary.cleanup)
        self.scratch = Path(self.temporary.name).resolve()
        self.compiler_commands = []
        self.configurations = []
        report = {'sourceHashes': {}, 'errors': [], 'requestedFixtures': ['default'], 'fixtures': []}
        with patch.object(self.runner, 'process', self.compile_receipt), \
             patch.object(self.runner, 'run_fixture', self.fixture_receipt):
            self.runner.run(self.scratch, report)

    def compile_receipt(self, command, env, scratch):
        self.compiler_commands.append(command)
        return {'exitCode': 0}

    def fixture_receipt(self, binary, scratch, config, fixture, env):
        self.configurations.append(config)
        return {}

    def test_compiler_receives_all_swift_sources_without_json_assets(self):
        inputs = [Path(argument).name for argument in self.compiler_commands[0]
                  if str(argument).startswith(str(self.scratch / 'sources'))]
        self.assertCountEqual(inputs, ['Neighbours.swift', 'SecureFiles.swift',
                                      'captured-events.swift', 'main.swift'])

    def test_fixture_receives_the_frozen_json_asset(self):
        self.assertEqual(self.configurations[0].name, 'neighbours.json')
        self.assertEqual(self.configurations[0].read_bytes(),
                         (self.runner.ROOT / 'plugin/assets/neighbours.json').read_bytes())


if __name__ == '__main__':
    unittest.main()
