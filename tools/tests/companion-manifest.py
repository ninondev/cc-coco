#!/usr/bin/env python3
"""Run semantic manifest, loader safety and Coco asset regressions without Pet interaction."""
from pathlib import Path
import subprocess
import sys

raise SystemExit(subprocess.run([
    sys.executable, str(Path(__file__).with_name('companion-b3.py')),
    '--cache-only', '--appearance', 'both',
]).returncode)
