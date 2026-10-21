#!/usr/bin/env python3
"""Run the common wake assertions without showing windows or injecting system input."""
from pathlib import Path
import runpy
import sys

sys.argv.append('--screen-safe')
runpy.run_path(str(Path(__file__).with_name('companion-awake-common.py')), run_name='__main__')
