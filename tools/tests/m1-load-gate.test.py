"""The timing gate rejects a regression; fixtures do not stand in for timings."""
import importlib.util
from pathlib import Path
import unittest

source = Path(__file__).resolve().parents[1] / 'measure-hooks-load.py'
spec = importlib.util.spec_from_file_location('hooks_load_gate', source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class LoadGateChecks(unittest.TestCase):
    def test_boundary_and_regression(self):
        self.assertTrue(module.within_load_limit(100, 109.9))
        self.assertTrue(module.within_load_limit(100, 110))
        self.assertFalse(module.within_load_limit(100, 110.1))
        self.assertFalse(module.within_load_limit(100, 160))

    def test_invalid_baseline_is_not_a_pass(self):
        for before, after in [(0, 0), (-1, 4), (4, -1)]:
            with self.assertRaises(ValueError):
                module.within_load_limit(before, after)


if __name__ == '__main__':
    unittest.main()
