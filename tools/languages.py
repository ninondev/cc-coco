"""Read the shipped language inventory for tooling and Python coverage."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LANGUAGE_CODES = tuple(json.loads((ROOT / 'plugin/core-words.json').read_text()))
AUTHORED_LANGUAGE_CODES = tuple(code for code in LANGUAGE_CODES if code != 'zh-Hant')
