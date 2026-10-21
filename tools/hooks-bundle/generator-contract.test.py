"""Filesystem contract tests; compiler output is an explicitly synthetic seam."""
from contextlib import redirect_stderr, redirect_stdout
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("hooks_graph_generator", Path(__file__).parents[1] / "build-hooks-graph.py")
DRIVER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DRIVER)


class GeneratorContract(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="hooks-generator-contract-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source, self.plugin = self.root / "source", self.root / "plugin"
        self.source.mkdir()
        (self.plugin / "hooks").mkdir(parents=True)
        self.groups = self.root / "groups.json"
        names = {"motion_stills": "alpha", "pages": "beta", "companion": "gamma", "presence": "delta"}
        self.groups.write_text(json.dumps({group: ["hooks/" + name + ".ts"] for group, name in names.items()}))
        for name in names.values():
            (self.source / (name + ".ts")).write_text("export const value=1\n")
        (self.source / "register.tsx").write_text("export const register=()=>{}\n")
        (self.source / "touch-client.ts").write_text("export default ()=>{}\n")
        (self.plugin / "hooks/register.tsx").write_text("original runtime\n")
        self.compiler = self.root / "typescript.js"
        self.compiler.write_text("// deliberately unused compiler fixture\n")
        self.patches = [patch.object(DRIVER, "GROUPS", self.groups),
                        patch.object(DRIVER.subprocess, "run", self.compiler_seam)]
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)
        self.calls = 0
        self.fail = False
        self.mutate_source = False

    def compiler_seam(self, argv, **_kwargs):
        self.calls += 1
        work = Path(argv[argv.index("--work") + 1])
        plugin = work / "plugin"
        if self.fail:
            return SimpleNamespace(returncode=7)
        owned = ["hooks/register.tsx", "hooks/alpha.ts", "hooks/touch-client.ts",
                 "hooks/m1-compiled/group.js", "hooks/m1-compiled/manifest.json"]
        compiled = plugin / "hooks/m1-compiled"
        compiled.mkdir(parents=True)
        (compiled / "group.js").write_text("export let value=1\n")
        (plugin / "hooks/register.tsx").write_text("export const register=()=>{}\n")
        (plugin / "hooks/alpha.ts").write_text("export {value} from './m1-compiled/group.js'\n")
        (compiled / "manifest.json").write_text(json.dumps({"ownedPaths": owned}, sort_keys=True) + "\n")
        if self.mutate_source:
            (self.source / "alpha.ts").write_text("export const value=2\n")
        return SimpleNamespace(returncode=0)

    def invoke(self, check=False):
        stdout, stderr = io.StringIO(), io.StringIO()
        argv = ["build-hooks-graph.py", "--source", str(self.source), "--output", str(self.plugin),
                "--typescript", str(self.compiler), "--bun", "synthetic-compiler-seam"]
        if check:
            argv.append("--check")
        with patch.object(sys, "argv", argv), redirect_stdout(stdout), redirect_stderr(stderr):
            code = DRIVER.main()
        return code, stdout.getvalue(), stderr.getvalue()

    def prepare(self):
        self.assertEqual(self.invoke()[0], 0)

    def test_write_then_check_rebuilds_and_accepts_exact_bytes(self):
        self.prepare()
        self.assertEqual(self.invoke(True)[0], 0)
        self.assertEqual(self.calls, 2)
        self.assertEqual((self.plugin / "hooks-source/alpha.ts").read_bytes(), (self.source / "alpha.ts").read_bytes())

    def test_check_changed_public_facade_fails_without_repair(self):
        self.prepare()
        path = self.plugin / "hooks/alpha.ts"
        path.write_text("export const value=0\n")
        code, _, stderr = self.invoke(True)
        self.assertEqual(code, 1)
        self.assertIn("changed: hooks/alpha.ts", stderr)
        self.assertEqual(path.read_text(), "export const value=0\n")

    def test_check_changed_compiled_behavior_fails_without_repair(self):
        self.prepare()
        path = self.plugin / "hooks/m1-compiled/group.js"
        path.write_text("export let value=2\n")
        code, _, stderr = self.invoke(True)
        self.assertEqual(code, 1)
        self.assertIn("changed: hooks/m1-compiled/group.js", stderr)
        self.assertEqual(path.read_text(), "export let value=2\n")

    def test_check_missing_output_fails_without_creation(self):
        self.prepare()
        path = self.plugin / "hooks/m1-compiled/group.js"
        path.unlink()
        code, _, stderr = self.invoke(True)
        self.assertEqual(code, 1)
        self.assertIn("missing: hooks/m1-compiled/group.js", stderr)
        self.assertFalse(path.exists())

    def test_check_unowned_stale_file_fails_and_preserves_file(self):
        self.prepare()
        path = self.plugin / "hooks/m1-compiled/unowned.js"
        path.write_text("unowned\n")
        code, _, stderr = self.invoke(True)
        self.assertEqual(code, 1)
        self.assertIn("stale: hooks/m1-compiled/unowned.js", stderr)
        self.assertEqual(path.read_text(), "unowned\n")

    def test_write_rejects_unowned_stale_file_before_publication(self):
        self.prepare()
        path = self.plugin / "hooks/m1-compiled/unowned.js"
        path.write_text("unowned\n")
        facade = self.plugin / "hooks/alpha.ts"
        facade.write_text("preserve before failure\n")
        with self.assertRaisesRegex(ValueError, "Unowned stale compiled files"):
            self.invoke()
        self.assertEqual(path.read_text(), "unowned\n")
        self.assertEqual(facade.read_text(), "preserve before failure\n")

    def test_write_removes_only_previous_manifest_owned_stale_output(self):
        self.prepare()
        name = "hooks/m1-compiled/old.js"
        path = self.plugin / name
        path.write_text("old generated output\n")
        manifest = self.plugin / "hooks/m1-compiled/manifest.json"
        value = json.loads(manifest.read_text())
        value["ownedPaths"].append(name)
        manifest.write_text(json.dumps(value))
        self.assertEqual(self.invoke()[0], 0)
        self.assertFalse(path.exists())
        self.assertTrue((self.plugin / "hooks/m1-compiled/group.js").is_file())

    def test_compiler_failure_publishes_nothing(self):
        self.fail = True
        self.assertEqual(self.invoke()[0], 7)
        self.assertEqual((self.plugin / "hooks/register.tsx").read_text(), "original runtime\n")
        self.assertFalse((self.plugin / "hooks-source").exists())
        self.assertFalse((self.plugin / "hooks/m1-compiled").exists())

    def test_source_change_during_compile_publishes_nothing(self):
        self.mutate_source = True
        with self.assertRaisesRegex(ValueError, "Canonical source changed while building"):
            self.invoke()
        self.assertEqual((self.plugin / "hooks/register.tsx").read_text(), "original runtime\n")
        self.assertFalse((self.plugin / "hooks-source").exists())
        self.assertFalse((self.plugin / "hooks/m1-compiled").exists())

    def test_external_source_mismatch_with_retained_copy_rejects_before_compile(self):
        self.prepare()
        (self.plugin / "hooks-source/alpha.ts").write_text("export const value=3\n")
        calls = self.calls
        with self.assertRaises(SystemExit) as raised:
            self.invoke(True)
        self.assertEqual(raised.exception.code, 2)
        self.assertEqual(self.calls, calls)


if __name__ == "__main__":
    unittest.main()
