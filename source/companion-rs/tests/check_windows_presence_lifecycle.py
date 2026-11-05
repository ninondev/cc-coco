#!/usr/bin/env python3
"""Run the Windows helper's portable lifecycle functions on this host, not Win32 calls.

Usage: python3 tests/check_windows_presence_lifecycle.py --work /absolute/scratch/folder
Extracts the marked production block verbatim, compiles it with the real protocol module
and the same Rust tests used by Windows cargo test, then runs that test executable.
No Cargo dependencies, release binaries, network or installed files are changed.
"""
import argparse
import json
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--work", type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
work = args.work.resolve()
work.mkdir(parents=True, exist_ok=True)
source = (root / "src/platform/windows_presence_helper.rs").read_text()
begin = "// BEGIN portable session lifecycle"
end = "// END portable session lifecycle."
assert source.count(begin) == source.count(end) == 1
block = source.split(begin, 1)[1].split("\n", 1)[1].split(end, 1)[0]
harness = work / "lifecycle.rs"
harness.write_text(
    '#![allow(dead_code)]\n'
    f'#[path = {json.dumps(str(root / "src/presence_helper.rs"))}] mod protocol;\n'
    + block
    + f'\n#[path = {json.dumps(str(root / "tests/support/windows_presence_lifecycle.rs"))}] mod lifecycle_tests;\n'
)
binary = work / "lifecycle-tests"
subprocess.run(["rustc", "--edition=2021", "--test", str(harness), "-o", str(binary)], check=True)
subprocess.run([str(binary), "--test-threads=1"], check=True)
