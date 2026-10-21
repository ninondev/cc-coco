#!/usr/bin/env python3
"""Compile/run the companion's scratch checks without launching the app or touching HOME."""
import argparse
import ast
import json
import os
from pathlib import Path
import re
import shutil
import shlex
import subprocess
import tempfile
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from hooks_source import hook_source
from scratch import TemporaryDirectory
from languages import LANGUAGE_CODES

ROOT = Path(__file__).resolve().parents[2]


def read_words(words_source):
    def table(name):
        start = words_source.index('const ' + name + ':')
        start = words_source.index(' = ', start) + 3
        block = words_source[start:words_source.index('\n}\n', start) + 2]
        if not re.search(r'^  get ', block, re.M):
            return json.JSONDecoder().raw_decode(block)[0]
        # Load pass: getters defer each locale. Decode only their literal JSON values;
        # never execute source and never substitute fixture-authored words.
        values = {}
        getter = re.compile(r'^  get "([^"]+)"\(\) \{ return ' + name + r'_CACHE\["([^"]+)"\] \?\?= ', re.M)
        for match in getter.finditer(block):
            lang, cache_key = match.groups()
            if lang != cache_key or lang in values:
                raise ValueError('invalid or duplicate locale getter in ' + name)
            values[lang] = json.JSONDecoder().raw_decode(block[match.end():])[0]
        expected = set(LANGUAGE_CODES)
        if set(values) != expected:
            raise ValueError('incomplete locale getters in ' + name)
        return values
    card_words = table('COMPANION_CARD_WORDS')
    activity_words = table('COMPANION_ACTIVITY_WORDS')
    # Feed words are spread from the actual tables; read only the two plain fields
    # that the row additionally needs, without evaluating TypeScript or changing it.
    companion_words = words_source[words_source.index('const COMPANION_WORDS:'):]
    hover_words = {}
    for lang in LANGUAGE_CODES:
        if lang not in ('en', 'ja') and not lang.startswith('zh'):
            continue
        opening = r'^  (?:' + lang + r': \{|get "' + lang + r'"\(\) \{ return COMPANION_WORDS_CACHE\["' + lang + r'"\] \?\?= \{)'
        match = re.search(opening + r'(.*?)^  \}', companion_words, re.M | re.S)
        if match is None:
            raise ValueError('missing hover locale ' + lang)
        block = match.group(1)
        plain = {}
        for key in ('hide', 'size'):
            literal = re.search(r"\b" + key + r':\s*("(?:\\.|[^"\\])*"|\x27(?:\\.|[^\x27\\])*\x27)', block).group(1)
            plain[key] = ast.literal_eval(literal)
        hover_words[lang] = {**card_words[lang], **activity_words[lang], **plain}
    return {'card': card_words, 'activity': activity_words, 'hover': hover_words}


def run(scratch, options):
    words = read_words(hook_source(ROOT / 'plugin/hooks/companion.ts').read_text())
    words_file = scratch / 'words.json'
    words_file.write_text(json.dumps(words, ensure_ascii=False))
    script = (ROOT / 'plugin/bin/companion-macos.sh').read_text()
    xml = re.search(r'^xml_text\(\) \{[^\n]+\}', script, re.M).group()
    agent = re.search(r'^agent_text\(\) \{.*?^\}', script, re.M | re.S).group()
    executable = str(scratch / 'Test & < > " x')
    env = dict(os.environ, HOME=str(scratch), CLAUDE_CONFIG_DIR=str(scratch / 'config'), BIN=executable,
               LABEL='io.github.ninondev.coco-companion')
    # Only these pure text helpers are evaluated, never the management script.
    expected = subprocess.run(['/bin/sh', '-c', xml + '\n' + agent + '\nagent_text'],
                              env=env, capture_output=True, check=True).stdout
    plist = scratch / 'expected.plist'
    plist.write_bytes(expected)
    sources = sorted(p for p in (ROOT / 'plugin/companion/Sources').glob('*.swift') if p.name != 'main.swift')
    # Compile an immutable receipt of current sources, so concurrent edits cannot change
    # the input midway through swiftc's compile/link stages.
    snapshot = scratch / 'Sources'
    snapshot.mkdir()
    for source in sources:
        shutil.copy2(source, snapshot / source.name)
    sources = sorted(snapshot.glob('*.swift'))
    test_main = scratch / 'main.swift'
    shutil.copy2(ROOT / 'tools/tests/companion-native/main.swift', test_main)
    print('Source snapshot:', snapshot, flush=True)
    compiler = shutil.which('swiftc')
    if not compiler:
        raise SystemExit('swiftc is needed for the native scratch checks')
    subprocess.run([compiler, '-version'], check=True, env=env)
    # Test the owner's probe guards as pure console code, using the actual frozen helper
    # section. Do not compile or execute the observer's GUI entry point for these fixtures.
    probe_folder = scratch / 'ProbeHelpers'
    probe_folder.mkdir()
    probe_snapshot = probe_folder / 'companion-drag-screen.swift'
    shutil.copy2(ROOT / 'tools/tests/companion-drag-screen/main.swift', probe_snapshot)
    probe_source = probe_snapshot.read_text()
    begin, end = '// BEGIN PURE DRAG PROBE HELPERS', '// END PURE DRAG PROBE HELPERS'
    if probe_source.count(begin) != 1 or probe_source.count(end) != 1 or probe_source.index(begin) >= probe_source.index(end):
        raise SystemExit('probe helper markers must appear exactly once in order')
    helpers = probe_source.split(begin, 1)[1].split(end, 1)[0]
    probe_checks = probe_folder / 'checks.swift'
    shutil.copy2(ROOT / 'tools/tests/companion-drag-probe/main.swift', probe_checks)
    probe_main = probe_folder / 'main.swift'
    probe_main.write_text('import AppKit\nimport ApplicationServices\nimport Darwin\n' + helpers + probe_checks.read_text())
    probe_binary = probe_folder / 'check'
    probe_command = [compiler, '-O', '-swift-version', '5', '-module-cache-path', str(scratch / 'cache'),
                     str(probe_main), '-o', str(probe_binary)]
    print('Probe helper compile:', shlex.join(probe_command), flush=True)
    probe_compiled = subprocess.run(probe_command, env=env, cwd=scratch)
    print('Probe helper compile exit code:', probe_compiled.returncode, flush=True)
    probe_compiled.check_returncode()
    probe_result = subprocess.run([str(probe_binary)], env=env, cwd=scratch)
    print('Probe helper check exit code:', probe_result.returncode, flush=True)
    probe_result.check_returncode()
    binary = scratch / 'check'
    compile_command = [compiler, '-O', '-swift-version', '5', '-module-cache-path', str(scratch / 'cache'),
                       *map(str, sources), str(test_main),
                       '-o', str(binary)]
    print('Compile:', shlex.join(compile_command), flush=True)
    compiled = subprocess.run(compile_command, env=env)
    print('Compile exit code:', compiled.returncode, flush=True)
    compiled.check_returncode()
    appearances = ('light', 'dark') if options.appearance == 'both' else (options.appearance,)
    exit_code = 0
    for appearance in appearances:
        appearance_scratch = scratch / appearance
        appearance_scratch.mkdir()
        appearance_words = appearance_scratch / words_file.name
        shutil.copy2(words_file, appearance_words)
        appearance_env = dict(env, TMPDIR=str(appearance_scratch))
        result = subprocess.run([str(binary), str(ROOT / 'plugin/assets'), str(plist), executable,
                                 str(appearance_words), '--appearance', appearance],
                                env=appearance_env, cwd=appearance_scratch)
        print(f'Native {appearance} check exit code:', result.returncode, flush=True)
        if result.returncode != 0:
            exit_code = result.returncode if result.returncode > 0 else 1
        if options.artifacts:
            destination = options.artifacts / appearance
            shutil.copytree(appearance_scratch, destination, dirs_exist_ok=True)
    return exit_code


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--appearance', choices=('light', 'dark', 'both'), default='both')
    parser.add_argument('--artifacts', type=Path, help='copy offscreen fixture evidence before scratch cleanup')
    options = parser.parse_args()
    with TemporaryDirectory(prefix='coco-native-') as folder:
        # SecureDirectory walks the real path: on macOS TMPDIR sits under /var, a link to /private/var.
        return run(Path(folder).resolve(), options)


if __name__ == '__main__':
    raise SystemExit(main())
