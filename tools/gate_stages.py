"""Executable gate inventory shared by the runner and promises wiring checks."""
from pathlib import Path

GENERATORS = ('build-zh-hant.py', 'build-core-words.py', 'build-lines.py', 'build-icon-words.py', 'build-book-bundle.py', 'build-d1-runtime.py',
              'build-visitor-art.py', 'build-first-meeting-words.py',
              'build-cost-words.py', 'build-prices.py', 'build-cost-units.py', 'build-cost-runtime.py',
              'build-companion-words.py', 'build-diacritics-words.py',
              'build-more-words.py', 'build-mod-gaps-words.py', 'build-say-it-plain.py',
              'build-motion.py', 'build-card-lazy.py',
              'build-algo-worker.py', 'build-hooks-graph.py')

ICON = ('icon-words-generator.test.py', 'i1-icon-source.test.py',
        'icon-security-linux.test.py', 'icon-exec-security.test.py',
        'icon-script.test.py', 'icon-png.test.py', 'icon-native.test.py')

PYTHON = (
    'zh-hant.test.py', 'chinese-language.test.py',
    'desktop-sprite.test.py', 'motion-sync.test.py', 'shared-files.test.py',
    'scratch-cleanup.test.py', 'serial-runner.test.py', 'words-round-b1.test.py', 'companion-words-generator.test.py',
    'webkit-prerequisite.test.py', 'approved-names-w2.test.py', 'voice-names-w2.test.py', 'preview-renderer.test.py',
    'presence-transport.test.py', 'c3-book-canonical.test.py',
    'companion-script.test.py', 'icon-script.test.py', 'head-art.test.py', 'talk-key.test.py',
    'promises-decisions.test.py', 'layout-golden.test.py', 'hook-cpu-receipts.test.py',
    'b1c-config-manifest.test.py', 'b4-art-words-capture.test.py',
    'companion-pointer-report.test.py', 'load-path-c3.test.py',
    'claude-ai-skin.test.py', 'promises-registry.test.py', 'staged-gate.test.py',
    'promises-static.test.py', 'demo-page.test.py', 'promises-silhouette.test.py', 'promises-install.test.py', 'cpu-clocks.test.py', 'diacritics.test.py',
    *(name for name in ICON if name != 'icon-script.test.py'),
)
SWIFT = (
    'companion-native.py', 'companion-b3.py', 'companion-b3c.py',
    'companion-window-check.py', 'companion-window-gesture.py', 'companion-activity-layout.py',
    'companion-neighbours.py', 'companion-lanterns.py', 'companion-motion-runtime.py',
    'companion-feed-latency.py', 'companion-manifest.py', 'companion-golden.py',
    'companion-presence-b3.py', 'companion-touch-latency.py',
    'companion-awake-screen-safe.py', 'companion-pointer-cost.py', 'companion-resources.py',
)
STAGES = ('kit', 'bun', 'python', 'swift', 'rust', 'install', 'webkit', 'kit-2.1.299', 'release', 'skin', 'icon')
DEFAULT = STAGES[:8]


def files_for(stage, root):
    root = Path(root)
    if stage in ('kit', 'kit-2.1.299'):
        return {p.relative_to(root).as_posix() for p in (root/'tools/tests').glob('*.test.ts*')} | {'tools/run-tests.py', 'tools/build-preview.py'} | {'tools/' + name for name in GENERATORS}
    if stage == 'bun':
        return {p.relative_to(root).as_posix() for folder in ('tools/motion-tests', 'tools/tests/algo', 'tools/security-tests')
                for p in (root/folder).glob('*.test.ts')} | {'tools/build-preview.py'}
    if stage == 'python':
        return {'tools/tests/' + name for name in PYTHON} | {'tools/' + name for name in GENERATORS} | {
            'tools/release/tests/rename-kit.test.py', 'tools/check-claude-ai-skin.py',
            'tools/generate-voice-sizes.py'}
    if stage == 'swift':
        return {'tools/tests/' + name for name in SWIFT} | {
            'tools/tests/promises-native.py'}
    if stage == 'rust':
        return {p.relative_to(root).as_posix() for p in (root/'plugin/companion-rs').rglob('*.rs')}
    if stage == 'install':
        return {'tools/release/install-test.sh', 'tools/tests/companion-script.test.py', 'tools/tests/icon-script.test.py'}
    if stage == 'webkit':
        return {'tools/build-preview.py', 'tools/preview/fit-dump.test.tsx', 'tools/preview/fitcheck.swift'}
    if stage == 'release':
        return {'tools/release/promises-timing.py'}
    if stage == 'skin':
        return {'tools/check-claude-ai-skin.py', 'tools/tests/claude-ai-skin.test.py'}
    if stage == 'icon':
        return {'tools/tests/' + name for name in ICON} | {
            'tools/tests/icon-book.test.tsx', 'tools/tests/icon-press-only.test.tsx',
            'tools/tests/icon-exec-security.test.tsx', 'tools/build-icon-words.py'}
    return set()
