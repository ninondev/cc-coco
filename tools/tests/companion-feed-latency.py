#!/usr/bin/env python3
"""Scratch filesystem-event harness. Links shipping Feed; never launches the companion app."""
import argparse
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scratch import TemporaryDirectory
ROOT = Path(__file__).resolve().parents[2]
p = argparse.ArgumentParser(); p.add_argument('--source', type=Path, default=ROOT / 'plugin/companion/Sources'); args = p.parse_args()
# Kept alive for the driver lifetime; finalizer also handles SystemExit and errors.
_scratch = TemporaryDirectory(prefix='coco-feed-latency-')
scratch = Path(_scratch.name).resolve()
source = args.source
app = (source / 'App.swift').read_text()
pet = (source / 'Pet.swift').read_text()
# Unchanged production values needed by Feed/Requests; remove the unrelated app delegate and UI.
trace = app[app.index('struct Trace {'):app.index('/// A reusable one-shot')]
one_shot = app[app.index('@MainActor\nfinal class OneShot'):app.index('\nstruct Options')]
size = pet[pet.index('enum Size:'):pet.index('/// The idle animation')]
# Feed's D1 payloads use the exact shipping models, without the UI/services.
d1 = (source / 'D1.swift').read_text()
d1_models = d1[:d1.index('enum D1Away {')]
(scratch / 'Dependencies.swift').write_text('import AppKit\n' + trace + one_shot + size + '\n' + d1_models)
files = []
for name in ['Feed.swift', 'Requests.swift', 'Motion.swift', 'PresenceObserver.swift', 'SecureFiles.swift',
             'DmThread.swift', 'NewChat.swift', 'QuotaPixels.swift', 'PlayShake.swift']:
    if (source / name).exists():
        shutil.copy2(source / name, scratch / name); files.append(scratch / name)
main = r'''
import Foundation
import Darwin
@MainActor func run() -> Int32 {
    let file = URL(fileURLWithPath: CommandLine.arguments[1])
    let feed = Feed(file: file, trace: Trace(on: false))
    var begin: UInt64 = 0, elapsed = [Double](), received = 0
    var completedChecks = 0
    var order: [String] = []
    feed.changed = { record in
        order.append("changed")
        if begin != 0 { elapsed.append(Double(DispatchTime.now().uptimeNanoseconds - begin) / 1_000_000) }
        received += 1
    }
    feed.received = { _ in order.append("received") }
    feed.start()
    received = 0 // The shared initial presence is drawn before the measured session records.
    for i in 1...50 {
        let now = Date().timeIntervalSince1970 * 1000
        let data = try! JSONSerialization.data(withJSONObject: ["session": "scratch", "at": now, "context": i, "mood": "idle"])
        order.removeAll()
        begin = DispatchTime.now().uptimeNanoseconds
        try! data.write(to: file, options: .atomic)
        let deadline = Date().addingTimeInterval(1)
        while received < i && Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.0001)) }
        if received < i { print("FAIL missing atomic rename event", i); print("\(completedChecks + 1) feed-latency checks, 1 failures"); return 1 }
        completedChecks += 1
        if order != ["changed", "received"] { print("FAIL visible change must precede acknowledgement cleanup", order); print("\(completedChecks + 1) feed-latency checks, 1 failures"); return 1 }
        completedChecks += 1
    }
    elapsed.sort()
    print("feed atomic write begin to changed callback ms: n=\(elapsed.count) min=\(elapsed.first!) median=\(elapsed[elapsed.count/2]) p95=\(elapsed[Int(Double(elapsed.count)*0.95)]) max=\(elapsed.last!)")
    print("This measures local filesystem delivery/read/parse/publication; actual Pet draw and AX drag delivery are not measured.")
    print("\(completedChecks) feed-latency checks, 0 failures")
    return 0
}
exit(MainActor.assumeIsolated { run() })
'''
(scratch / 'main.swift').write_text(main)
binary = scratch / 'harness'
env = dict(os.environ, HOME=str(scratch), CLAUDE_CONFIG_DIR=str(scratch / 'config'))
cmd = ['swiftc', '-j', '4', '-swift-version', '5', '-module-cache-path', str(scratch / 'cache'), str(scratch / 'Dependencies.swift'), *map(str, files), str(scratch / 'main.swift'), '-o', str(binary)]
result = subprocess.run(cmd, env=env)
if result.returncode: raise SystemExit(result.returncode)
print('Source:', source, flush=True)
print('Scratch:', scratch, flush=True)
raise SystemExit(subprocess.run([str(binary), str(scratch / 'Coco' / 'view.json')], env=env).returncode)
