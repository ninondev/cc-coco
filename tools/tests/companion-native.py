#!/usr/bin/env python3
"""Compile/run the companion's scratch checks without launching the app or touching HOME."""
import ast
import json
import os
from pathlib import Path
import re
import shutil
import shlex
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]


def main():
    scratch = Path(tempfile.mkdtemp(prefix='claudesama-native-'))
    words_source = (ROOT / 'plugin/hooks/companion.ts').read_text()
    def table(name):
        start = words_source.index('const ' + name + ':')
        start = words_source.index(' = ', start) + 3
        return json.JSONDecoder().raw_decode(words_source[start:])[0]
    card_words = table('COMPANION_CARD_WORDS')
    activity_words = table('COMPANION_ACTIVITY_WORDS')
    # Feed words are spread from the actual tables; read only the two plain fields
    # that the row additionally needs, without evaluating TypeScript or changing it.
    companion_words = words_source[words_source.index('const COMPANION_WORDS:'):]
    hover_words = {}
    for lang in ('en', 'zh', 'ja'):
        block = re.search(r'^  ' + lang + r': \{(.*?)^  \},', companion_words, re.M | re.S).group(1)
        plain = {}
        for key in ('hide', 'size'):
            literal = re.search(r"\b" + key + r":\s*('(?:\\.|[^'\\])*')", block).group(1)
            plain[key] = ast.literal_eval(literal)
        hover_words[lang] = {**card_words[lang], **activity_words[lang], **plain}
    words_file = scratch / 'words.json'
    words_file.write_text(json.dumps({'card': card_words, 'activity': activity_words,
                                     'hover': hover_words}, ensure_ascii=False))
    script = (ROOT / 'plugin/bin/companion-macos.sh').read_text()
    xml = re.search(r'^xml_text\(\) \{[^\n]+\}', script, re.M).group()
    agent = re.search(r'^agent_text\(\) \{.*?^\}', script, re.M | re.S).group()
    executable = str(scratch / 'Test & < > " x')
    env = dict(os.environ, HOME=str(scratch), BIN=executable,
               LABEL='io.github.ninondev.claudesama-companion')
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
    binary = scratch / 'check'
    compile_command = [compiler, '-O', '-swift-version', '5', '-module-cache-path', str(scratch / 'cache'),
                       *map(str, sources), str(test_main),
                       '-o', str(binary)]
    print('Compile:', shlex.join(compile_command), flush=True)
    compiled = subprocess.run(compile_command, env=env)
    print('Compile exit code:', compiled.returncode, flush=True)
    compiled.check_returncode()
    result = subprocess.run([str(binary), str(ROOT / 'plugin/assets'), str(plist), executable, str(words_file)], env=env, cwd=scratch)
    print('Native check exit code:', result.returncode, flush=True)
    print('Scratch checks retained:', scratch, flush=True)
    return result.returncode


if __name__ == '__main__':
    raise SystemExit(main())
