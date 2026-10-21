"""Transfer shipping JSON and disclosure into the kit's isolated test module."""
import json
import hashlib
import re
from pathlib import Path
from hooks_source import hook_directory

from languages import LANGUAGE_CODES


def prepare(copy, root):
    copy, root = Path(copy), Path(root)
    # the README 1.0 ships (lane B's, handoffs/program/words/1.0/readme/); coco/ is a clone of the public repository as it
    # stands, 0.1.1 until the release, so it is only the fallback
    readme = root / 'handoffs/program/words/1.0/readme/README.md'
    if not readme.is_file():
        readme = root / 'coco/README.md'
    if not readme.is_file():
        readme = root / 'README.md'
    registry = json.loads((root / 'tools/promises.json').read_text())
    declarations = root / 'tools/typecheck/types/shared/claude-code-tools/index.d.ts'
    if declarations.is_file():
        tools = declarations.read_text()
        builtin_tools = re.findall(r'^    (\w+):', tools.split('interface BuiltinToolResults')[0], re.M)
    else:
        # the public tree carries the tool names only (tools/tests/fixtures/builtin-tools.json, from the assembly)
        builtin_tools = json.loads((root / 'tools/tests/fixtures/builtin-tools.json').read_text())
    value = {'pluginRoot': str(copy),
             'voiceSizes': json.loads((copy / 'hooks/voice-sizes.json').read_text()),
             'voiceSourceSha256': hashlib.sha256((hook_directory(copy) / 'voice.ts').read_bytes()).hexdigest(),
             'manifest': json.loads((copy / '.claude-plugin/plugin.json').read_text()),
             'tokenFeatures': next(row['tokenFeatures'] for row in registry if row['id'] == 'A4'),
             'builtinTools': builtin_tools,
             'readme': readme.read_text()}
    (copy / 'tests/language-inventory.ts').write_text(
        '// Shared inventory supplied by tools/languages.py.\n'
        'export const LANGUAGE_CODES = ' + json.dumps(LANGUAGE_CODES) + ' as const\n')
    (copy / 'tests/promises-runtime-input.ts').write_text(
        '// Exact copied input supplied to the isolated test module.\n'
        'export const RUNTIME_PROMISE_INPUT = ' + json.dumps(value, ensure_ascii=False) + '\n')
