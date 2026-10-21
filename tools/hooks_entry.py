"""Resolve the one shipping hook entry without guessing from a source filename."""
import json
from pathlib import Path

ALLOWED_ENTRIES = ('register.tsx', 'hooks-bundle.js')

def hooks_entry(plugin):
    hooks = Path(plugin).resolve() / 'hooks'
    config = json.loads((hooks / 'hooks.json').read_text())
    modules = config.get('modules')
    if not isinstance(modules, list) or len(modules) != 1 or modules[0] not in ['./' + name for name in ALLOWED_ENTRIES]:
        raise RuntimeError('Expected exactly one supported shipping hooks entry')
    entry = (hooks / modules[0]).resolve()
    if entry.parent != hooks.resolve() or not entry.is_file():
        raise RuntimeError('Shipping hooks entry is missing or leaves its hooks directory')
    return entry
