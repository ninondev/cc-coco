#!/usr/bin/env python3
"""Check the shared native model and event paths; no compiler or app is needed."""
import json
from pathlib import Path
import re
import unittest
ROOT = Path(__file__).resolve().parents[2]

class MotionSourceChecks(unittest.TestCase):
    def test_native_startup_model_is_byte_exact_shared_json(self):
        model = json.loads(re.search(r'export const MOTION = (\{.*?\}) as const', (ROOT / 'plugin/hooks/motion.ts').read_text(), re.S)[1])
        native = re.search(r'static let defaultJSON = #"(.*?)"#', (ROOT / 'plugin/companion/Sources/Motion.swift').read_text())[1]
        self.assertEqual(native, json.dumps(model, separators=(',', ':')))

    def test_native_reaction_paths_have_no_latency_timers_or_image_reads(self):
        source = ROOT / 'plugin/companion/Sources'
        claude = (source / 'Claude.swift').read_text()
        self.assertNotIn('asyncAfter', claude)
        self.assertNotIn('fire(after:', claude)
        feed = (source / 'Feed.swift').read_text()
        self.assertNotIn('OneShot', feed)
        self.assertNotIn('fire(after:', feed)
        read = feed[feed.index('    private func read()'):feed.index('    private func choose()')]
        self.assertLess(read.index('        choose()'), read.index('received(accepted)'))
        app = (source / 'App.swift').read_text()
        callback = app[app.index('        feed.received ='):app.index('        for name in [NSWorkspace.didActivate')]
        self.assertLess(callback.index('activity?.receive(record)'), callback.index('channel?.acknowledge(ack)'))
        frames = (source / 'Frames.swift').read_text()
        image = frames[frames.index('    func image('):frames.index('    /// His size in points')]
        self.assertNotIn('CreateWithURL', image)
        self.assertNotIn('contentsOf:', image)
        pet = (source / 'Pet.swift').read_text()
        follow = pet[pet.index('    func follow('):pet.index('    /// Claude\'s window was dragged')]
        self.assertNotIn('OneShot', follow)
        self.assertNotIn('fire(after:', follow)
        self.assertIn('place(reorder: reorder)', follow)
        motion = (source / 'Motion.swift').read_text()
        self.assertNotIn('Timer', motion)
        self.assertNotIn('OneShot', motion)
        self.assertIn('result.calculationMode = .discrete', motion)

if __name__ == '__main__': unittest.main(verbosity=2)
