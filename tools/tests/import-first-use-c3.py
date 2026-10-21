#!/usr/bin/env python3
"""The import path must leave ICU grapheme segmentation until real truncation."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scratch import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plugin', type=Path, default=ROOT / 'plugin')
    args = parser.parse_args()
    plugin = args.plugin.resolve()
    source = '''
const NativeSegmenter = Intl.Segmenter;
let constructions = 0;
Intl.Segmenter = class extends NativeSegmenter {
  constructor(...args) { super(...args); constructions++; }
};
await import(REGISTER);
const beforeFirstEvent = constructions;
const { TASK_WORDS } = await import(__COMPANION_MODULE__);
const { PRESENCE_LINES } = await import(__MOOD_MODULE__);
const { LANGS } = await import(__WORDS_MODULE__);
const { BAND_BOOK_WORDS } = await import(__BAND_BOOK_MODULE__);
const lazyLocales = LANGS.every(({code}) => typeof Object.getOwnPropertyDescriptor(TASK_WORDS, code)?.get === 'function' && typeof Object.getOwnPropertyDescriptor(PRESENCE_LINES, code)?.get === 'function' && typeof Object.getOwnPropertyDescriptor(BAND_BOOK_WORDS, code)?.get === 'function');
const stableLocales = LANGS.every(({code}) => TASK_WORDS[code] === TASK_WORDS[code] && PRESENCE_LINES[code] === PRESENCE_LINES[code] && BAND_BOOK_WORDS[code] === BAND_BOOK_WORDS[code]);
const { cutToPx, planPx } = await import(TYPESET);
const fitting = 'short';
if (cutToPx(fitting, planPx(fitting)) !== fitting) throw new Error('fitting text changed');
const afterFittingText = constructions;
// SPEC 0.2 fitting order preserves graphemes and author text until a cut is needed.
const samples = ['(reading a very long sentence)', '(áááááá)', '(👩‍💻👩‍💻👩‍💻👩‍💻👩‍💻)', '（書類を長く読んでいる）'];
const results = samples.map(text => ({ text, cut: cutToPx(text, planPx(text) * .8, false, 1) }));
for (const {text,cut} of results) {
  if (!cut || !cut.endsWith(text.endsWith('）') ? '…）' : '…)')) throw new Error('cut tail missing');
  const body = cut.slice(0, -2);
  const segments = Array.from(new NativeSegmenter().segment(text), x => x.segment);
  let prefix = '';
  if (!segments.some(x => (prefix += x) === body)) throw new Error('grapheme split');
}
const afterCuts = constructions;
const { cells } = await import(__BAND_MODULE__);
const cellSamples = [['hello', 5], ['中日', 4], ['á', 1], ['👩‍💻', 2]];
for (const [text, width] of cellSamples) if (cells(text) !== width || cells(text) !== width) throw new Error('cell width changed');
const afterCells = constructions;
const passed = beforeFirstEvent === 0 && afterFittingText === 0 && afterCuts === 1 && afterCells === 2 && lazyLocales && stableLocales;
console.log(JSON.stringify({beforeFirstEvent,afterFittingText,afterCuts,afterCells,lazyLocales,stableLocales,passed,results,cellSamples}));
if (!passed) process.exitCode = 1;
'''.replace('REGISTER', json.dumps(str(plugin / 'hooks/register.tsx'))).replace('TYPESET', json.dumps(str(plugin / 'hooks/typeset.ts'))).replace('__BAND_MODULE__', json.dumps(str(plugin / 'hooks/band.tsx'))).replace('__COMPANION_MODULE__', json.dumps(str(plugin / 'hooks/companion.ts'))).replace('__MOOD_MODULE__', json.dumps(str(plugin / 'hooks/mood.ts'))).replace('__WORDS_MODULE__', json.dumps(str(plugin / 'hooks/words.ts'))).replace('__BAND_BOOK_MODULE__', json.dumps(str(plugin / 'hooks/book-band-words.ts')))
    with TemporaryDirectory(prefix='moe-c3-import-first-use-') as folder:
        driver = Path(folder) / 'driver.ts'
        driver.write_text(source)
        result = subprocess.run([shutil.which('bun') or 'bun', '--no-env-file', '--jsx-runtime', 'classic', '--jsx-factory', 'h', '--jsx-fragment', 'Fragment', str(driver)], text=True, capture_output=True)
        print(result.stdout, end='')
        if result.stderr:
            print(result.stderr, end='')
        raise SystemExit(result.returncode)


if __name__ == '__main__':
    main()
