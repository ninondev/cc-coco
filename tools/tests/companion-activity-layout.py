#!/usr/bin/env python3
"""Exercise actual Activity views offscreen, with the production language tables."""
from pathlib import Path
import json
import importlib.util
import os
import re
import shutil
import subprocess
import tempfile
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from hooks_source import hook_source
from scratch import TemporaryDirectory
from languages import LANGUAGE_CODES

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('companion_native_words', ROOT / 'tools/tests/companion-native.py')
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)
words = native.read_words(hook_source(ROOT / 'plugin/hooks/companion.ts').read_text())['activity']
languages = LANGUAGE_CODES
assert set(languages) == set(words), 'Actual supported language coverage changed'
# The declared Lang type derives from the shipped table independently of native translations.
words_source = hook_source(ROOT / 'plugin/hooks/words.ts').read_text()
assert re.search(r"(?m)^export type Lang = typeof LANGS\[number\]\['code'\]$", words_source), 'Declared Lang type must derive from the shipping LANGS table'
lang_table = re.search(r'export const LANGS = \[(.*?)\] as const', words_source, re.S)
assert lang_table is not None, 'Shipping LANGS table is missing'
declared_languages = re.findall(r"\bcode:\s*'([^']+)'", lang_table[1])
assert len(declared_languages) == len(languages) and set(declared_languages) == set(languages), 'Shipping LANGS differs from the shared language inventory'
with TemporaryDirectory(prefix='companion-activity-layout-', dir=os.environ.get('TMPDIR', '/private/tmp')) as name:
    scratch = Path(name)
    snapshot = scratch / 'Sources'
    snapshot.mkdir()
    for source in (ROOT / 'plugin/companion/Sources').glob('*.swift'):
        if source.name != 'main.swift':
            shutil.copy2(source, snapshot / source.name)
    shutil.copy2(ROOT / 'tools/tests/companion-activity-layout/main.swift', scratch / 'main.swift')
    fixtures = scratch / 'languages.json'
    fixtures.write_text(json.dumps([{'lang': lang, 'words': words[lang]} for lang in languages], ensure_ascii=False))
    binary = scratch / 'check'
    subprocess.run(['swiftc', '-j', '4', '-O', '-swift-version', '5', '-module-cache-path', str(scratch / 'cache'),
                    *map(str, sorted(snapshot.glob('*.swift'))), str(scratch / 'main.swift'), '-o', str(binary)],
                   cwd=scratch, check=True)
    subprocess.run([str(binary), str(fixtures)], cwd=scratch, check=True)
