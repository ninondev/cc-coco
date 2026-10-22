#!/usr/bin/env python3
"""Stage the source runner's public test profile: the tools/ inventory, and the kit inputs written from private files."""
import argparse
import json
import re
from pathlib import Path
import sys

# What the public tree carries from tools/: the 1.0 assembly's TOOLS_FILES.
PUBLIC_TOOL_FILES = (
    'run-tests.py', 'd1_event_counter_fixture.py', 'd1_event_counter_stage.py',
    'd1_owned_pane_fixture.py', 'd1_shared_register_fixture.py', 'gate_stages.py',
    'hook_cpu.py', 'hooks_entry.py', 'kit_file_budgets.py', 'languages.py', 'process_cpu.py',
    'promises_runtime_inputs.py', 'scratch.py', 'serial_tests.py', 'cpu_stage.py',
    'native_hook_cpu.py', 'swift_cpu_fixtures.py', 'hooks_source.py',
    'engine_preflight_contract.py', 'fixture_cpu.py', 'startup_batches.py', 'native_budget.py',
    'build-d1-runtime.py', 'd1-runtime-canonical.json', 'd1-runtime-entry.ts', 'cost-units-entry.ts',
    'build-hooks-graph.py',
)
# Folders copied whole (the assembly's TOOLS_DIRS), with the kinds of file each holds.
PUBLIC_TOOL_DIRS = {
    'motion-tests': {'.ts'},
    'hooks-bundle': {'.ts', '.json', '.toml', '.lock', '.py', '.rs'},
    # the daily other makers' price list the prices workflow writes (owner 10-21)
    'prices': {'.ts'},
}
# tools/tests: its own files and these folders. The native harness folders (companion-*, presence-before) stay private.
PUBLIC_TEST_DIRS = ('algo', 'cc-cost', 'cc-prices', 'cc-warm', 'cost-native', 'fixtures', 'native-clear-protocol')
TEST_SUFFIXES = {'.ts', '.tsx', '.py', '.json', '.txt', '.md', '.swift', '.c', '.sh'}
TEST_DATA = {'tests/algo/fixtures/binary-junk.bin'}
EXCLUDED_TESTS = ('book-files.ts', 'claude-ai-skin*')
# A test that reads private sources stays private (the assembly's PRIVATE_SOURCE_MARKERS).
PRIVATE_SOURCE_MARKERS = (b'handoffs/', b'art/ref', b'tools/evidence', b"'persona/", b"'persona'", b'research/')
# Written by this script from private inputs, in the smallest form the kit needs; never copied.
GENERATED_TOOL_FILES = (
    'promises.json', 'promises-network-allowlist.json', 'public-tree.json',
    'tests/fixtures/icon-author-words.json', 'tests/fixtures/builtin-tools.json',
)
# The promise rows the kit itself checks.
KIT_PROMISES = ('A4', 'C6')
# Checks the runner's stages name outside tools/tests that this tree leaves out (they read private sources).
LEFT_OUT_TOOLS = ('tools/check-claude-ai-skin.py', 'tools/generate-voice-sizes.py',
                  'tools/release/tests/rename-kit.test.py', 'tools/build-preview.py')


def needs_missing(path, local, staged):
    # A Python check that runs a tools/ script or imports a tools/ module the staged tree does not carry.
    text = path.read_text(encoding='utf-8', errors='replace')
    named = set(re.findall(r'tools/([A-Za-z0-9_-]+)\.py', text))
    named |= set(re.findall(r'^\s*(?:from|import)\s+([A-Za-z0-9_]+)', text, re.M)) & local
    return any(n in local and not (staged / (n + '.py')).exists() for n in named)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source_tools', type=Path)
    parser.add_argument('staged_tools', type=Path)
    parser.add_argument('--word-inputs', required=True, type=Path)
    args = parser.parse_args()
    source = args.source_tools.resolve(strict=True)
    staged = args.staged_tools.resolve(strict=True)
    if source == staged or source in staged.parents:
        raise ValueError('source and staged tools must be separate trees')
    # Remove checks that need what is not staged, until nothing they need is missing.
    local = {q.stem for q in source.glob('*.py')}
    while True:
        gone = [q for q in (staged / 'tests').glob('*.py') if needs_missing(q, local, staged)]
        if not gone:
            break
        for q in gone:
            q.unlink()
    left = sorted('tools/tests/' + p.name for p in (source / 'tests').glob('*.py') if not (staged / 'tests' / p.name).exists())
    left += [f for f in LEFT_OUT_TOOLS if not (staged.parent / f).exists()]
    registry = json.loads((source / 'promises.json').read_text(encoding='utf-8'))
    (staged / 'promises.json').write_text(json.dumps([r for r in registry if r.get('id') in KIT_PROMISES],
                                                     indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    allow = json.loads((source / 'promises-network-allowlist.json').read_text(encoding='utf-8'))
    (staged / 'promises-network-allowlist.json').write_text(
        json.dumps({'kitSanctioned': allow.get('kitSanctioned', {})}, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    fixtures = staged / 'tests/fixtures'
    fixtures.mkdir(parents=True, exist_ok=True)
    words = json.loads(args.word_inputs.read_text(encoding='utf-8'))
    (fixtures / 'icon-author-words.json').write_text(json.dumps(
        {k: v for k, v in words.items() if k.startswith('icon.')}, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')
    tool_types = (source / 'typecheck/types/shared/claude-code-tools/index.d.ts').read_text(encoding='utf-8')
    (fixtures / 'builtin-tools.json').write_text(json.dumps(
        re.findall(r'^    (\w+):', tool_types.split('interface BuiltinToolResults')[0], re.M)) + '\n', encoding='utf-8')
    (staged / 'public-tree.json').write_text(json.dumps({
        'about': 'The public tree: generators and checks that read private sources are not here.',
        'leftOut': left}, indent=1) + '\n', encoding='utf-8')
    print('Public test profile: %d checks left out; kit inputs written.' % len(left))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, ValueError) as error:
        print('public-tests.py: ' + str(error), file=sys.stderr)
        raise SystemExit(2)
