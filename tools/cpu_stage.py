#!/usr/bin/env python3
"""Run a Python check with CPU budgets for its subprocess.run calls."""
import runpy
import subprocess
import sys
from pathlib import Path
from process_cpu import run
from swift_cpu_fixtures import prepare_command

def cpu_run(argv, **kwargs):
    return run(prepare_command(argv), **kwargs)

if __name__ == '__main__':
    script, *arguments = sys.argv[1:]
    subprocess.run = cpu_run
    sys.argv = [script, *arguments]
    sys.path.insert(0, str(Path(script).resolve().parent))
    runpy.run_path(script, run_name='__main__')
