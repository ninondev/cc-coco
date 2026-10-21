#!/usr/bin/env python3
"""Meter receipts: weighted one-core shares, legacy health and malformed inputs."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scratch import TemporaryDirectory

script = Path(__file__).resolve().parents[1] / 'companion-pointer-report.py'
spec = importlib.util.spec_from_file_location('pointer_report', script)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
checks = 0


def expect(value, message):
    global checks
    checks += 1
    if not value:
        raise AssertionError(message)


periods = [dict(form='full', armedSeconds=2, events=240, handlerCpuMs=1, processCpuMs=2),
           dict(form='full', armedSeconds=8, events=960, handlerCpuMs=3, processCpuMs=18),
           dict(form='reduced', armedSeconds=5, events=600, handlerCpuMs=2, processCpuMs=15)]
rows = module.totals(dict(pointerMonitor=periods))
expect(rows['full'] == dict(periods=2, armedSeconds=10, events=1200, handlerCpuMs=4, processCpuMs=20), 'aggregate full periods without averaging their percentages')
expect(rows['reduced']['events'] == 600, 'forms remain separate')
with TemporaryDirectory(prefix='b3f-pointer-report-', dir=os.environ.get('TMPDIR')) as work:
    file = Path(work) / 'health.json'
    def run(health):
        file.write_text(json.dumps(health))
        return subprocess.run(['python3', str(script), str(file)], capture_output=True, text=True)
    result = run(dict(pointerMonitor=periods))
    expect(result.returncode == 0, 'valid health CLI exits0')
    expect('full: periods=2 armedSeconds=10 events=1200 handlerCpuMs=4 processCpuMs=20' in result.stdout, 'actual raw totals printed')
    expect('handlerOneCorePercent=0.040000000000000001 processOneCorePercent=0.20000000000000001' in result.stdout, 'thread and process weighted CPU fractions use milliseconds/seconds')
    expect('full process share: below 0.3%' in result.stdout, 'nonzero full events and process share below gate')
    expect('reduced: periods=1 armedSeconds=5 events=600' in result.stdout, 'reduced printed independently')
    expect('processOneCorePercent=0.29999999999999999' in result.stdout, 'exact 0.3 threshold fixture preserved without upward rounding')
    result = run(dict(pointerMonitor=[dict(form='full', armedSeconds=10, events=1200, handlerCpuMs=4, processCpuMs=30)]))
    expect('at or above 0.3%' in result.stdout, 'threshold is strictly below0.3, equality fails')
    result = run(dict(pointerMonitor=[dict(form='full', armedSeconds=10, events=0, handlerCpuMs=0, processCpuMs=0)]))
    expect('cost gate unverified' in result.stdout and 'below 0.3%' not in result.stdout, 'empty delivery cannot pass cost gate')
    result = run(dict(version='legacy'))
    expect(result.returncode == 0 and 'no completed armed time' in result.stdout, 'old health without meter retained')
    for value in [None, {}, 'bad']:
        expect(run(dict(pointerMonitor=value)).returncode == 2, 'bad array rejected')
    for key, value in [('form','bad'), ('armedSeconds',float('nan')), ('handlerCpuMs',-1), ('processCpuMs',float('inf')), ('events',True), ('events',1.5), ('armedSeconds',True)]:
        malformed = periods[0] | {key:value}
        expect(run(dict(pointerMonitor=[malformed])).returncode == 2, 'invalid period '+key)
print(f'pointer report: {checks} checks, 0 failures')
