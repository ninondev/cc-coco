#!/usr/bin/env python3
"""Run isolated offline promise checks in named stages.

Default: kit, bun, python, swift, rust, install, webkit and the optional pinned
2.1.299 engine. Every stage prints PASS, FAIL or SKIPPED with its reason; skips
are repeated in the final summary and exit 3 unless --allow-skip names them.
Dispatch explicitly exempts an absent 2.1.299 binary. --windows-roots retains
the representative engine-root matrix. --stage release alone runs paired wall
measurements and needs --release-baseline plus a quiet machine.

Run it through a heavy-job lane if you keep one. Serial engine files
are the default; every child CPU budget excludes scheduling wait. HOME and
CLAUDE_CONFIG_DIR are throwaway directories; no owner store is read or written.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[0]))
from scratch import TemporaryDirectory, register_scratch
from hooks_entry import hooks_entry
from hooks_source import hook_directory, hook_source
from serial_tests import run_serial as _run_serial, file_workers
from process_cpu import run as run_cpu, cpu_seconds
import re

STAGE_COUNTS = []

def merge_status(current, incoming):
    # Missing prerequisites may not erase a failed assertion in another check.
    if current not in (0, 3) or incoming not in (0, 3):
        return 1
    return 3 if 3 in (current, incoming) else 0

def observed_run(argv, **kwargs):
    result = run_cpu(argv, capture_output=True, text=True, **kwargs)
    output = (result.stdout or "") + (result.stderr or "")
    sys.stdout.write(output); sys.stdout.flush()
    plain = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", output)
    records = {"command": [str(word) for word in argv], "exitCode": result.returncode, "budgetClock": "processCPU"}
    counts = re.findall(r"Ran (\d+) tests?", plain)
    assertions = re.findall(r"(\d+) (?:[\w/-]+ ){0,5}checks, (\d+) failures", plain)
    assertions += re.findall(r"checks (\d+) failures (\d+)", plain)
    assertions += re.findall(r"(?m)^window checks: (\d+), failures: (\d+)$", plain)
    assertions += [(str(int(a)+int(b)),b) for a,b in re.findall(r"(?m)^golden \S+ passed (\d+) failed (\d+)$", plain)]
    assertions += re.findall(r"(?m)^(?:PASSED|FAILED): (\d+) [\w-]+ checks; failures (\d+); bytes read \d+$", plain)
    unavailable_setup = re.findall(r"(?m)^BLOCKED: (\d+) [\w-]+ checks; failures (\d+); bytes read \d+$", plain)
    if unavailable_setup:
        records['unavailableFixtureSetupAssertions'] = sum(int(a) for a,b in unavailable_setup)
    cargo = re.findall(r"test result: .*? (\d+) passed; (\d+) failed; (\d+) ignored", plain)
    if counts: records["tests"] = sum(map(int, counts))
    if assertions: records["assertions"] = sum(int(a) for a,b in assertions); records["assertionFailures"] = sum(int(b) for a,b in assertions)
    if cargo: records["tests"] = sum(int(a)+int(b) for a,b,c in cargo); records["failed"] = sum(int(b) for a,b,c in cargo); records["ignored"] = sum(int(c) for a,b,c in cargo)
    skips = re.findall(r"skipped=(\d+)", plain)
    skips += re.findall(r"(?m)^\s*(\d+) skip\s*$", plain)
    if skips: records["skippedTests"] = sum(map(int, skips))
    skip_reasons = re.findall(r"(?m)^(?:SKIPPED|BLOCKED):? (.+)$", plain)
    if skip_reasons: records['skipReasons'] = skip_reasons
    passed = re.findall(r"(?m)^\s*(\d+) pass\s*$", plain)
    failed = re.findall(r"(?m)^\s*(\d+) fail\s*$", plain)
    if passed: records['passed'] = int(passed[-1])
    if failed: records['failed'] = int(failed[-1])
    captured = re.findall(r"fit preparation: (\d+) layouts captured", plain)
    checked = re.findall(r"fit check: (\d+) layouts fit", plain)
    problems = re.findall(r"fit check: (\d+) problems in (\d+) layouts", plain)
    if captured: records['layoutsCaptured'] = int(captured[-1])
    if checked: records['layoutsChecked'] = int(checked[-1]); records['layoutProblems'] = 0
    if problems: records['layoutProblems'] = int(problems[-1][0]); records['layoutsChecked'] = int(problems[-1][1])
    records["outputTail"] = plain[-2500:]
    STAGE_COUNTS.append(records)
    return result

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREFIX = 'coco-tests-'


def public_tree():
    """The public repository's tree carries no generator and none of the checks that read private sources; the
    assembly lists what it left out in tools/public-tree.json, so those are reported as skipped, not missing."""
    path = Path(ROOT)/'tools/public-tree.json'
    return json.loads(path.read_text(encoding='utf-8')) if path.is_file() else None


def left_out(rel):
    public = public_tree()
    if public is not None and rel in public.get('leftOut', []):
        print('SKIPPED in the public tree (it reads private sources): ' + rel)
        return True
    return False
TIMEOUT = 900


def d1_fixture_access(copy, counters=False):
    manifest = Path(copy)/'hooks/hooks.json'
    template = Path(copy)/'tests/d1-owner-test-access.ts'
    if not manifest.is_file() and not template.is_file():
        return
    config = json.loads(manifest.read_text())
    modules = config.get('modules')
    if modules not in (['./register.tsx'], ['./hooks-bundle.js']):
        raise RuntimeError('D1 fixture access requires one production hooks entry')
    raw = template.read_text()
    from d1_shared_register_fixture import prepare_shared_register, owner_template, state, source_sha
    prepared = state(copy)
    if modules == ['./register.tsx']:
        prepare_shared_register(copy, counters=counters)
        prepared = state(copy)
    if not prepared or not prepared['companionShared'] or (counters and not prepared['counters']) or prepared['sourceSHA256'] != source_sha(copy):
        raise RuntimeError('Shared fixture commands must be injected into canonical source before bundling')
    raw = owner_template(raw)
    anchor = "import {register as productionRegister} from './register'"
    if raw.count(anchor) != 1:
        raise RuntimeError('D1 fixture access requires the reviewed production import')
    if modules == ['./hooks-bundle.js']:
        raw = raw.replace(anchor, "import {register as productionRegister} from './hooks-bundle.js'")
    (Path(copy)/'hooks/d1-owner-test-access.ts').write_text(raw)
    config['modules'] = ['./d1-owner-test-access.ts']
    manifest.write_text(json.dumps(config) + '\n')


def cached_typescript():
    # isolated_env() passes COCO_TYPESCRIPT (what tools/cloud/setup.sh exports) into children whose HOME is a throwaway.
    explicit = os.environ.get('COCO_TYPESCRIPT') or os.environ.get('COCO_TYPESCRIPT')
    if explicit:
        path = Path(explicit)
        if not path.is_file():raise RuntimeError('Explicit cached TypeScript compiler is missing')
        return path
    compilers = sorted(Path.home().glob('.bun/install/cache/typescript@5.*/lib/typescript.js'))
    if not compilers:
        raise RuntimeError('Bundle fixture needs the existing cached TypeScript compiler')
    return compilers[-1]


def bundle_hooks(copy, *, check=False, target=None):
    env = dict(os.environ, CARGO_BUILD_JOBS='4', CARGO_TARGET_DIR=str(target or Path(copy).parent/'hooks-bundle-target'))
    argv = ['cargo', 'run', '--offline', '-j', '4', '--manifest-path', str(Path(ROOT)/'tools/hooks-bundle/Cargo.toml'),
            '--', '--plugin', str(copy), '--typescript', str(cached_typescript())]
    if check:argv.append('--check')
    done = subprocess.run(argv, cwd=ROOT, env=env, timeout=90)
    if done.returncode:raise RuntimeError('Shipping hooks bundle is stale or controlled generation failed')


def verify_shipping_bundle(plugin):
    plugin = Path(plugin)
    if not (plugin/'hooks').exists():return
    if hooks_entry(plugin).name != 'hooks-bundle.js':return
    with TemporaryDirectory(prefix='coco-bundle-check-', dir=os.getenv('TMPDIR')) as folder:
        bundle_hooks(plugin, check=True, target=Path(folder)/'target')


def prepare_hooks(copy, entry=None, counters=False):
    """Instrument the canonical source, then compile the same fixture runtime entry."""
    from d1_owned_pane_fixture import instrument_owned_source
    from d1_shared_register_fixture import prepare_shared_register
    manifest = Path(copy)/'hooks/hooks.json'
    if not manifest.is_file():
        if entry is not None:raise RuntimeError('Hooks entry override requires hooks/hooks.json')
        return
    config = json.loads(manifest.read_text())
    if entry is not None:
        if entry not in ('register.tsx','hooks-bundle.js'):raise RuntimeError('Unsupported hooks entry override')
        config['modules'] = ['./' + entry]
        manifest.write_text(json.dumps(config) + '\n')
    if config.get('modules') not in (['./register.tsx'], ['./hooks-bundle.js']):
        raise RuntimeError('Fixture preparation requires one production hooks entry')
    instrument_owned_source(copy)
    prepare_shared_register(copy, counters=counters)
    if (hook_directory(copy)/'d1-state.js').is_file():
        subprocess.run([sys.executable, str(Path(ROOT)/'tools/build-d1-runtime.py'), '--plugin', str(copy)], cwd=ROOT, check=True, timeout=90)
    if (Path(copy)/'hooks-source').is_dir():
        hooks_graph(copy)
    if config['modules'] == ['./hooks-bundle.js']:
        bundle_hooks(copy)


def hooks_graph(copy):
    """Regenerate the scratch copy's static hook graph from its instrumented canonical source."""
    argv = [sys.executable, str(Path(ROOT)/'tools/build-hooks-graph.py'), '--source', str(Path(copy)/'hooks-source'),
            '--output', str(copy), '--typescript', str(cached_typescript())]
    for name in ('d1-owned-source-test-counter.ts', 'd1-event-test-counter.ts'):
        if (Path(copy)/'hooks-source'/name).is_file():
            argv += ['--fixture-module', name]
    done = subprocess.run(argv, cwd=ROOT, timeout=180)
    if done.returncode:
        raise RuntimeError('controlled hooks graph generation failed')


def denial_initial_source(copy):
    """Copy the denial fixture's exact initializer into its parser guard module."""
    tests = Path(copy) / 'tests'
    if not (tests / 'd1-denial-fixture-event.test.tsx').is_file():
        return
    source = tests / 'd1-notify-denial.test.tsx'
    if not source.is_file():
        raise RuntimeError('denial parser guard requires its source test fixture')
    raw = source.read_text(encoding='utf-8')
    initializers = re.findall(r'^\s*const transport=transportFixture\((\{[^\n]+\})\)\s*$', raw, re.MULTILINE)
    if len(initializers) != 1:
        raise RuntimeError('denial parser guard requires one exact initializer')
    (tests / 'd1-denial-initial-source-fixture.ts').write_text(
        "import {MORNING} from './world'\nexport const D1_DENIAL_INITIAL=" + initializers[0] + '\n',
        encoding='utf-8')




def run_serial(claude, copy, scratch, env, deadline=None, **options):
    if deadline is not None and deadline != TIMEOUT:
        raise ValueError('D1 shared deadline must remain unchanged')
    return _run_serial(claude, copy, scratch, env, **options)


def desktop_fit_phase(claude, scratch):
    """The default native suite ends with the real desktop 24-column WebKit gate."""
    import importlib.util
    spec = importlib.util.spec_from_file_location('suite_desktop_fit', os.path.join(ROOT, 'tools', 'build-preview.py'))
    preview = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(preview)
    folder = os.path.join(scratch, 'desktop-fit')
    print('desktop WebKit fit stage: capture all13 languages and check24 columns', flush=True)
    try:
        _, fits = preview.prepare_fit(folder, claude=claude)
        narrow = [fit for fit in fits if fit.get('surface') == 'desktop' and fit.get('kind') == 'band' and fit.get('cols') == 24]
        preview.check_fit_inventory(narrow)
        # prepare_fit saves a fully populated general page. Rebuild this phase's
        # placeholder page so its scope is exactly the required104 narrow bands.
        page = Path(preview.TEMPLATE).read_text().replace('/*THEMES*/{}', json.dumps({'dark': {}, 'light': {}, 'mine': {}}))
        # Only the narrow bands go to WebKit here; the complete kit compares every capture
        # with the layout golden afterwards (build-preview.py --check-layout).
        status = 0 if preview.fit_check(page, narrow, layout=False) else 1
    except SystemExit as error:
        status = error.code if isinstance(error.code, int) and error.code else 1
        sys.stderr.write('desktop WebKit fit stage capture failed: %s\n' % error)
    except (OSError, RuntimeError, ValueError, subprocess.SubprocessError) as error:
        status = 1
        sys.stderr.write('desktop WebKit fit stage failed: %s\n' % error)
    print('desktop WebKit fit stage exit: %d' % status, flush=True)
    return status


def find_claude(given):
    for candidate in (given, os.environ.get('CLAUDE_BIN'), os.path.expanduser('~/.local/bin/claude')):
        if candidate and os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    return shutil.which('claude')


def book_files(copy):
    """The kit cannot read files: hand the tests his book's words (plugin/book/*.json) as a module."""
    folder = os.path.join(copy, 'book')
    files = {}
    if os.path.isdir(folder):
        for name in sorted(os.listdir(folder)):
            if name.endswith('.json'):
                with open(os.path.join(folder, name), encoding='utf-8') as f:
                    files[name] = f.read()
    with open(os.path.join(copy, 'tests', 'book-files.ts'), 'w', encoding='utf-8') as out:
        out.write('// Written by the test runner from plugin/book/*.json.\n')
        out.write('export const BOOK_FILES: Record<string, string> = ' + json.dumps(files, ensure_ascii=False) + '\n')
    # Keep the icon exception independent of shipping copy, including English fallback.
    words = os.path.join(ROOT, 'handoffs/program/words-1.0.i18n.json')
    if not os.path.isfile(words) and public_tree() is not None:
        # the public tree carries only these slots (tools/tests/fixtures/icon-author-words.json, from the assembly)
        words = os.path.join(ROOT, 'tools/tests/fixtures/icon-author-words.json')
    with open(words, encoding='utf-8') as source:
        approved = {key[5:]: value for key, value in json.load(source).items() if key.startswith('icon.')}
    if len(approved) != 42 or not {'failed', 'fallback'} <= approved.keys():
        raise RuntimeError('I1 icon words require all 42 approved slots')
    with open(os.path.join(copy, 'tests', 'icon-words-fixture.ts'), 'w', encoding='utf-8') as out:
        out.write('// Written from approved words-1.0 icon slots, never from shipping books.\n')
        out.write('export const ICON_AUTHOR_WORDS: Record<string, Record<string, string>> = ' + json.dumps(approved, ensure_ascii=False) + '\n')


def companion_target_files(copy):
    """Give capability tests the actual fixture bytes, including malformed records."""
    folder = os.path.join(copy, 'tests', 'fixtures', 'companion-targets')
    files = {}
    for name in sorted(os.listdir(folder)):
        if name.endswith('.json'):
            with open(os.path.join(folder, name), encoding='utf-8') as source:
                files[name] = source.read()
    with open(os.path.join(copy, 'tests', 'companion-target-files.ts'), 'w', encoding='utf-8') as out:
        out.write('// Written by the test runner from fixtures/companion-targets/*.json.\n')
        out.write('export const COMPANION_TARGET_FILES: Record<string, string> = ' + json.dumps(files, ensure_ascii=False) + '\n')


def companion_source(copy):
    """Expose the current status writer to the engine's capability contract tests."""
    path = os.path.join(copy, 'companion', 'Sources', 'App.swift')
    with open(path, encoding='utf-8') as source:
        text = source.read()
    with open(os.path.join(copy, 'tests', 'companion-source.ts'), 'w', encoding='utf-8') as out:
        out.write('// Written by the test runner from companion/Sources/App.swift.\n')
        out.write('export const COMPANION_APP_SOURCE = ' + json.dumps(text, ensure_ascii=False) + '\n')



def source_files(copy):
    """The kit cannot read source files; inventory the unmodified shipping hooks."""
    files = {}
    # Shape assertions read the strict canonical source; behaviour imports the runtime hooks.
    source_root = str(hook_directory(copy))
    for folder, _, names in os.walk(source_root):
        for name in sorted(names):
            if name.endswith(('.ts', '.tsx')):
                path = os.path.join(folder, name)
                with open(path, encoding='utf-8') as source:
                    files['hooks/' + os.path.relpath(path, source_root).replace(os.sep, '/')] = source.read()
    # The merged art inventory exceeds the engine's 1 MiB per-module read limit.
    # Keep every source byte, partitioning only the scratch transport modules.
    serialized = json.dumps(files, ensure_ascii=False)
    chunks = [serialized[i:i + 128000] for i in range(0, len(serialized), 128000)]
    for index, chunk in enumerate(chunks):
        path = os.path.join(copy, 'tests', 'plugin-source-part-%d.ts' % index)
        with open(path, 'w', encoding='utf-8') as out:
            out.write('export const SOURCE_PART = ' + json.dumps(chunk, ensure_ascii=False) + '\n')
    with open(os.path.join(copy, 'tests', 'plugin-sources.ts'), 'w', encoding='utf-8') as out:
        out.write('// Written from all shipping hooks before scratch-only root injection.\n')
        for index in range(len(chunks)):
            out.write("import { SOURCE_PART as part%d } from './plugin-source-part-%d'\n" % (index, index))
        out.write('export const PLUGIN_SOURCES: Record<string, string> = JSON.parse(' + ' + '.join('part%d' % i for i in range(len(chunks))) + ')\n')
        with open(os.path.join(copy, '.claude-plugin', 'plugin.json'), encoding='utf-8') as manifest:
            out.write('export const PLUGIN_MANIFEST = ' + json.dumps(json.load(manifest), ensure_ascii=False) + '\n')
    denial_initial_source(copy)


BLANK_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='


def coco_band_data(copy):
    """Serve Coco's band data (plugin/assets/coco) through test FS mocks, never preinstall runtime data."""
    coco = {}
    for outfit in ('A', 'B'):                  # her pictures as one blank pixel each
        band = os.path.join(copy, 'assets', 'coco', 'band-%s.json' % outfit)   # (the engine reads no test
        if os.path.isfile(band):                # module over 1 MB)
            data = json.load(open(band, encoding='utf-8'))
            data['images'] = {key: BLANK_PNG for key in data['images']}
            data['eyes'] = {key: dict(value, half=BLANK_PNG, closed=BLANK_PNG) for key, value in data.get('eyes', {}).items()}
            coco[outfit] = json.dumps(data, separators=(',', ':'))
    with open(os.path.join(copy, 'tests', 'coco-band-data.ts'), 'w', encoding='utf-8') as out:
        out.write('// Coco band payload; lifecycle tests return this at the FS seam.\n')
        out.write('export const COCO_BAND_TEXT: Record<string, string> = ' + json.dumps(coco, ensure_ascii=False) + '\n')


def card_metrics_data(copy):
    """Serve the exact first-save payload through a targeted test FS seam."""
    path = os.path.join(copy, 'hooks', 'card-metrics.json')
    text = open(path, encoding='utf-8').read() if os.path.isfile(path) else '{}'
    with open(os.path.join(copy, 'tests', 'card-metrics-data.ts'), 'w', encoding='utf-8') as out:
        out.write('// Exact shipping first-save payload; never preinstalled in runtime.\n')
        out.write('export const CARD_METRICS_TEXT = ' + json.dumps(text, ensure_ascii=False) + '\n')


def review_texts(copy, readme_source=None):
    """Make the shipping Chinese README available to the sandboxed localization guard."""
    path = readme_source or os.path.join(ROOT, 'README.zh.md')
    if not readme_source and not os.path.isfile(path):
        # the private tree keeps the shipping README's source here (the old coco/ link held a 0.1 checkout)
        path = os.path.join(ROOT, 'handoffs', 'program', 'words', '1.0', 'readme', 'README.zh.md')
    with open(path, encoding='utf-8') as source:
        text = source.read()
    with open(os.path.join(copy, 'tests', 'review-texts.ts'), 'w', encoding='utf-8') as out:
        out.write('// Written by the test runner; the shipping README is read only.\n')
        out.write('export const CHINESE_README = ' + json.dumps(text, ensure_ascii=False) + '\n')


def seed_runtime_motion(copy):
    """Seed the scratch runtime after inventorying the unchanged shipping source."""
    path = str(hook_directory(copy)/'motion.ts')
    canonical = str(hook_directory(copy)/'motion.source.ts')
    if os.path.isfile(canonical): path = canonical
    if not os.path.isfile(path):
        return  # original-source regression receipts predate the shared model
    with open(path, encoding='utf-8') as source:
        text = source.read()
    declaration = 'export const runtimeRandom: Random = Math.random'
    if text.count(declaration) != 1:
        raise RuntimeError('motion runtime RNG declaration must occur exactly once')
    with open(path, 'w', encoding='utf-8') as source:
        source.write(text.replace(declaration, 'export const runtimeRandom: Random = seededRandom(0x4c415544)'))


def windows_roots(copy, enabled):
    """Only the throwaway copy substitutes a root: the kit has no plugin-root mock.
    On Windows the copy already sits on a Windows root: the tests are told so and nothing is substituted."""
    native = os.name == 'nt'
    tests = os.path.join(copy, 'tests')
    with open(os.path.join(tests, 'test-system.ts'), 'w', encoding='utf-8') as out:
        out.write('export const WINDOWS_ROOTS = ' + ('true' if enabled or native else 'false') + '\n')
        out.write('export const TEST_PLUGIN_ROOT = ' + json.dumps(r'C:\Users\windows\Coco' if enabled and not native else copy) + '\n')
    # Its bytes are pinned as independently reviewed, so it cannot carry a Windows branch: where presence is declined it is left out.
    second_window = os.path.join(tests, 'd1-companion-second-window.test.tsx')
    if (enabled or native) and os.path.isfile(second_window):
        for case in ('D1 actual second-window band gesture and line preserve the companion underlying frame and speech',
                     'D1 actual prompt clears retained ambient speech while a band-only second-window line remains',
                     'D1 actual held helper second-window event retains accepted native pose clocks and suppresses band-only speech'):
            print('D1_PLATFORM_SKIP ' + json.dumps({'name': case, 'reason': 'shipping ensurePresence rejects Windows plugin roots'}))
        os.unlink(second_window)
    if not enabled:
        return
    selected = {'k1-runtime.test.tsx', 'k1-prices.test.tsx', 'k1-price-http.test.tsx', 'k1-surfaces.test.tsx', 'd1-notify-choice.test.tsx', 'd1-transcript.test.tsx', 'd1-runtime.test.tsx', 'd1-spawn-optional-type.test.tsx', 'c2-book.test.tsx', 'c3-lifecycle.test.tsx', 'd1-compaction-timeline-counter.test.tsx', 'lines-lazy-c3.test.tsx', 'turn-head.test.tsx', 'b1-startup.test.tsx', 'b1-redraw-race.test.tsx', 'b1c-band-subscription.test.tsx', 'windows-roots.test.tsx', 'd1-helper-event-counter.test.tsx', 'b1b-line-inventory.test.tsx', 'd1-approved-promises.test.tsx', 'c3-slot.test.tsx', 'b1-band.test.tsx', 'd1-empty-ribbon-contract.test.tsx', 'd1-companion-request-owner-contract.test.tsx', 'presence-band.test.tsx', 'motion-stills-b1b.test.tsx', 'b1b-timing.test.tsx', 'd1-desktop-tree-contract.test.tsx', 'd1-lifecycle.test.tsx', 'd1-lying-scroll-construction.test.tsx', 'paths.test.tsx', 'd1-compaction-blit-denial-counter.test.tsx', 'book.test.tsx', 'presence.test.tsx', 'd1-presence-c3-contract.test.tsx', 'shared-files.test.tsx', 'presence-words.test.tsx', 'channel-startup.test.tsx', 'd1-companion-bookmark-lifecycle.test.tsx', 'b1c-motion-events.test.tsx', 'd1-trim.test.tsx', 'book-review.test.tsx', 'book-state.test.tsx', 'd1-presence-fixture-events.test.tsx', 'd1-transcript-native-order.test.tsx', 'd1-helper-leave-silence.test.tsx', 'd1-denial-fixture-event.test.tsx', 'd1-owner-close-contract.test.tsx', 'd1-band.test.tsx', 'c2-runtime.test.tsx', 'quota-round-b1.test.tsx', 'band.test.tsx', 'd1-toast-observer-contract.test.tsx', 'c3-pure.test.tsx', 'localization.test.tsx', 'card-lazy-c3.test.tsx', 'c3-heads.test.tsx', 'startup.test.tsx', 'b1c-settings-migration.test.tsx', 'd1-shed-cache.test.tsx', 'd1-invalidate-provider-contract.test.tsx', 'd1-transcript-integration.test.tsx', 'b1b-book-settings-cache.test.tsx', 'b1b-chain-api.test.tsx', 'c2-events.test.tsx', 'c3-guardian-motion.test.tsx', 'c3-events.test.tsx', 'd1-session-namespace-optout.test.tsx', 'presence-touch.test.tsx', 'b1c-config.test.tsx', 'd1-store-read-contract.test.tsx', 'head-width.test.tsx', 'b4b-transcript.test.tsx', 'b1b-first-answer.test.tsx', 'd1-sdk-native-compaction-boundary.test.tsx', 'companion-d1-projection.test.tsx', 'luck.test.tsx', 'd1-room.test.tsx', 'motion-b1.test.tsx', 'c3-runtime.test.tsx', 'd1-owned-render-receipt.test.tsx', 'd1-open-book-idle.test.tsx', 'c3-neighbours.test.tsx', 'presence-deadline.test.tsx', 'companion-d1-feed.test.tsx', 'c3-motion.test.tsx', 'd1-events.test.tsx', 'companion-feed-b3.test.tsx', 'c2-card-check.test.tsx', 'b4-surface.test.tsx', 'd1-book-lifecycle.test.tsx', 'poke.test.tsx', 'd1-helper-clear-retry.test.tsx', 'c3-glance-cells.test.tsx', 'reaction.test.tsx', 'd1-trim-integration.test.tsx', 'd1-spawn-optional-description.test.tsx', 'd1-compaction-raster-counter.test.tsx', 'd1-presence-lifecycle.test.tsx', 'b1c-layout.test.tsx', 'desktop-sprite.test.tsx', 'd1-world-c3-contract.test.tsx', 'desktop-safe.test.tsx',
                'm1-a6-a10-a27.test.tsx', 'm1-always-wiring.test.tsx', 'm1-always.test.tsx', 'm1-band-more.test.tsx', 'm1-book-controls.test.tsx', 'm1-first-hello.test.tsx', 'm1-integration.test.tsx', 'm1-lazy-words.test.tsx', 'm1-sleep.test.tsx', 'more-boundaries.test.tsx', 'more.test.tsx', 'mod-gaps.test.tsx', 'channel-watch-m1.test.tsx', 'o10-lively.test.tsx', 'pet-feed.test.tsx'}
    for name in os.listdir(tests):
        if name.endswith('.test.tsx') and name not in selected:
            os.unlink(os.path.join(tests, name))
    if native:
        return
    root = json.dumps(r'C:\Users\windows\Coco')
    for hook_folder in ('hooks', 'hooks-source'):
        for folder, _, names in os.walk(os.path.join(copy, hook_folder)):
            for name in names:
                if name.endswith(('.ts', '.tsx')):
                    path = os.path.join(folder, name)
                    with open(path, encoding='utf-8') as source:
                        text = source.read()
                    # Expression substitution preserves engine calls, drawing and FS mocks.
                    with open(path, 'w', encoding='utf-8') as out:
                        out.write(text.replace('$.plugin.root', root))


def skip_engine_files(plugin):
    """copytree filter: leave out the files Claude Code writes into a plugin it loads from a folder
    (.claude-plugin/types/ and tsconfig.json; it writes them again in the scratch copy), plus
    editor and Python leftovers."""
    engine = {os.path.normpath(os.path.join(plugin, 'tsconfig.json')),
              os.path.normpath(os.path.join(plugin, '.claude-plugin', 'types'))}

    def ignore(folder, names):
        return [n for n in names if n in ('.DS_Store', '__pycache__') or os.path.normpath(os.path.join(folder, n)) in engine]
    return ignore


def skip_test_files(tests):
    """Pure algorithm suites run with Bun separately, never in the engine sandbox."""
    root = os.path.normpath(os.path.abspath(tests))
    def ignore(folder, names):
        return [name for name in names if name in ('.DS_Store', '__pycache__', 'book-files.ts') or (os.path.normpath(os.path.abspath(folder)) == root and name in ('algo', 'cc-cost', 'cc-warm', 'cc-prices', 'cost-native'))]
    return ignore


def remove_scratch(scratch):
    """Delete only this runner's generated scratch folder, never owner data or a symlink."""
    if not (os.path.basename(scratch).startswith(PREFIX) and os.path.isdir(scratch) and not os.path.islink(scratch)):
        return
    shutil.rmtree(scratch)

def isolated_env(home):
    home = Path(home)
    for folder in (home, home/'AppData/Roaming', home/'AppData/Local', home/'config'):
        folder.mkdir(parents=True, exist_ok=True)
    # Only explicitly needed development settings are inherited. Do not load
    # credentials into this local, offline command's environment at all.
    allowed = ('PATH', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'TERM',
               'CLAUDE_BIN', 'CARGO_HOME', 'RUSTUP_HOME',
               'UV_THREADPOOL_SIZE', 'GOMAXPROCS',
               'BUN_FEATURE_FLAG_DISABLE_IO_POOL',
               'COCO_TEST_SERIAL_FILES', 'COCO_TEST_FILE_WORKERS',
               'COCO_TYPESCRIPT', 'PLAYWRIGHT_BROWSERS_PATH',
               # Windows' own system settings: Bun refuses to start without SystemRoot, and programs
               # find the shell and executables through these. None of them holds a credential.
               'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'SYSTEMDRIVE', 'PROGRAMFILES', 'PROGRAMDATA')
    env = {key: os.environ[key] for key in allowed if key in os.environ}
    env.update(HOME=str(home), USERPROFILE=str(home),
               APPDATA=str(home/'AppData/Roaming'), LOCALAPPDATA=str(home/'AppData/Local'),
               CLAUDE_CONFIG_DIR=str(home/'config'), DISABLE_AUTOUPDATER='1',
               CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC='1', DISABLE_TELEMETRY='1',
               DISABLE_ERROR_REPORTING='1', CARGO_BUILD_JOBS='4',
               # Python checks read the sources as UTF-8 everywhere; Windows' own default (cp1252) cannot.
               PYTHONUTF8='1')
    return env


def sanctioned_network():
    """The one owner-approved network use that kit tests may exercise: Prices page opening (K1).

    The guard still stops every other request. A request to one of the listed public URLs goes on to the test's own
    mock instead of being refused and is counted apart; it can never reach a real network, because beneath every
    plugin the kit's bottom hook throws. After the body the guard fails any test whose name does not start with a
    listed prefix and that made such a request. Listed in tools/promises-network-allowlist.json.
    """
    rows = json.loads((Path(ROOT)/'tools/promises-network-allowlist.json').read_text()).get('kitSanctioned', {})
    return {'urls': list(rows.get('urls', [])), 'testNamePrefixes': list(rows.get('testNamePrefixes', []))}


def engine_cpu_tests(copy, test_names=None):
    """Scratch-only per-test network guard and CPU deadline wrapper; bodies retain their APIs."""
    tests = Path(copy)/'tests'
    wrapper = tests/'cpu-testing.ts'
    wrapper.write_text('''import { test as engineTest, expect as engineExpect } from 'claude-code/testing'
import type { Plugin, TestBody, TestOptions } from 'claude-code/testing'
export * from 'claude-code/testing'
const selectedTestNames = new Set<string>(''' + json.dumps(test_names or []) + ''')
const sanctionedTestPrefixes: string[] = ''' + json.dumps(sanctioned_network()['testNamePrefixes']) + '''
export const test: typeof engineTest = (name, ...rest) => {
  if (selectedTestNames.size && !selectedTestNames.has(name)) return
  const options: TestOptions = rest.length === 2 ? rest[0] : {}
  const body = (rest.length === 2 ? rest[1] : rest[0]) as TestBody
  const guard: Plugin = { name: 'p1-kit-network-guard', register(on) {
    // Inline plugins are serialized: all hook state belongs inside register.
    const sanctionedUrls: string[] = ''' + json.dumps(sanctioned_network()['urls']) + ''' // owner-approved price pages
    let networkCalls = 0
    let sanctionedCalls = 0
    // Stop before every lower hook and host bottom, including body mocks, except the sanctioned fetches above:
    // those reach only the test's own mock and are counted apart.
    on('http.*', ($, e, next) => {
      if (next.is('http.fetch', e) && sanctionedUrls.includes(e.url)) {
        sanctionedCalls++
        return next(e)
      }
      networkCalls++
      return { value: { ok: false, status: 0, headers: {}, text: '' } }
    })
    // A hook-owned command response crosses the plugin realm without host IO.
    on('command.run', { command: 'p1-kit-network-guard-count' }, () => ({
      text: JSON.stringify({ guard: 'p1-kit-network-guard', calls: networkCalls, sanctioned: sanctionedCalls }),
    }))
  } }
  engineTest(name, { ...options, plugins: [guard, ...(options.plugins ?? [])], timeoutMs: 2147483647 }, async ($, on) => {
    let engineTouched = false
    // Any use of either test API retains the original hook-owned inspection.
    // Namespace values remain original objects; accessor receivers remain targets.
    const observed = <T extends object>(value: T): T => new Proxy(value, {
      get(target, key) { engineTouched = true; return Reflect.get(target, key, target) },
      set(target, key, value) { engineTouched = true; return Reflect.set(target, key, value, target) },
      has(target, key) { engineTouched = true; return Reflect.has(target, key) },
      ownKeys(target) { engineTouched = true; return Reflect.ownKeys(target) },
      getOwnPropertyDescriptor(target, key) { engineTouched = true; return Reflect.getOwnPropertyDescriptor(target, key) },
      defineProperty(target, key, descriptor) { engineTouched = true; return Reflect.defineProperty(target, key, descriptor) },
      deleteProperty(target, key) { engineTouched = true; return Reflect.deleteProperty(target, key) },
      getPrototypeOf(target) { engineTouched = true; return Reflect.getPrototypeOf(target) },
      setPrototypeOf(target, prototype) { engineTouched = true; return Reflect.setPrototypeOf(target, prototype) },
      isExtensible(target) { engineTouched = true; return Reflect.isExtensible(target) },
      preventExtensions(target) { engineTouched = true; return Reflect.preventExtensions(target) },
      apply(target, receiver, args) { engineTouched = true; return Reflect.apply(target as unknown as typeof on, receiver, args) },
      construct(target, args, newTarget) { engineTouched = true; return Reflect.construct(target as unknown as ObjectConstructor, args, newTarget) },
    })
    try { return await body(observed($), observed(on)) }
    finally {
      // The SDK loads plugins at the first engine call. A body that has never
      // interacted with either API cannot have dispatched an SDK HTTP event.
      let networkCalls = 0
      let sanctionedCalls = 0
      if (engineTouched) {
        const response = await $.command.run({ command: 'p1-kit-network-guard-count', args: '' })
        const snapshot = JSON.parse(response.text ?? 'null')
        engineExpect(snapshot?.guard, 'P1 full-suite network guard response').toBe('p1-kit-network-guard')
        engineExpect(Number.isSafeInteger(snapshot?.calls) && snapshot.calls >= 0, 'P1 full-suite network counter shape').toBe(true)
        networkCalls = snapshot.calls
        sanctionedCalls = Number.isSafeInteger(snapshot.sanctioned) && snapshot.sanctioned >= 0 ? snapshot.sanctioned : 0
      }
      console.log('P1_FULL_SUITE_NETWORK ' + JSON.stringify({ test: name, calls: networkCalls, sanctioned: sanctionedCalls }))
      engineExpect(networkCalls, 'P1 full-suite network calls').toBe(0)
      if (!sanctionedTestPrefixes.some((prefix: string) => name.startsWith(prefix))) engineExpect(sanctionedCalls, 'P1 full-suite sanctioned price page calls outside the price tests').toBe(0)
    }
  })
}
''')
    for path in tests.rglob('*'):
        if path.name != wrapper.name and path.suffix in ('.ts', '.tsx'):
            text = path.read_text()
            relative = os.path.relpath(wrapper, path.parent).replace(os.sep, '/').removesuffix('.ts')
            if not relative.startswith('.'):
                relative = './' + relative
            path.write_text(re.sub(r'''(\bfrom\s*)(['"])claude-code/testing\2''',
                                   lambda match: match[1] + match[2] + relative + match[2], text))

def check_generators():
    from gate_stages import GENERATORS
    if public_tree() is not None:
        print('generators: not in the public tree; their --check runs where their private sources are')
        return 0
    # Derive Traditional Chinese before any downstream generator inspects it.
    for generator in GENERATORS:
        status = python_check('tools/' + generator, '--check')
        if status:
            return status
    return 0


def run_kit(args, claude, *, workers_override=None, measure_file_cpu=False,
            envelope_budgets=None, measure_hook_cpu=False, only_hook_envelopes=False,
            hook_targets=None):
    generated = check_generators()
    if generated:
        return generated
    plugin = os.path.abspath(args.plugin_source) if args.plugin_source else os.path.join(ROOT, 'plugin')
    tests = os.path.abspath(args.tests_source) if args.tests_source else os.path.join(ROOT, 'tools', 'tests')
    for folder in (plugin, tests):
        if not os.path.isdir(folder):
            raise RuntimeError('missing folder ' + folder)
    scratch = tempfile.mkdtemp(prefix=PREFIX, dir=os.environ.get('TMPDIR'))
    owned_scratch = register_scratch(scratch, keep=args.keep, defer_signals=True)
    try:
        copy = os.path.join(scratch, 'plugin')
        shutil.copytree(plugin, copy, ignore=skip_engine_files(plugin))
        # The public tree keeps the hooks' source in source/hooks; the run works on the private layout.
        public_source = Path(plugin).parent/'source/hooks'
        if public_tree() is not None and not (Path(plugin)/'hooks-source').is_dir() and public_source.is_dir():
            shutil.copytree(public_source, os.path.join(copy, 'hooks-source'))
        shutil.copytree(tests, os.path.join(copy, 'tests'), ignore=skip_test_files(tests))
        for helper in (book_files, companion_target_files, companion_source,
                       coco_band_data, card_metrics_data):
            helper(copy)
        if getattr(args,'source_preparer',None): args.source_preparer(copy)
        else: source_files(copy)
        review_texts(copy, getattr(args, 'readme_source', None))
        seed_runtime_motion(copy)
        from promises_runtime_inputs import prepare
        prepare(Path(copy), Path(ROOT))
        if (hook_directory(copy)/'register.tsx').is_file():
            from hook_cpu import prepare as prepare_hook_cpu
            prepare_hook_cpu(Path(copy), Path(ROOT))
        if getattr(args,'root_preparer',None): args.root_preparer(copy)
        else: windows_roots(copy, args.windows_roots)
        if args.test_file:
            selected = set(args.test_file)
            available = set(os.listdir(os.path.join(copy, 'tests')))
            missing = selected - available
            if missing:
                raise RuntimeError('missing test files: ' + ', '.join(sorted(missing)))
            for name in available:
                if name.endswith(('.test.tsx', '.test.ts')) and name not in selected:
                    os.unlink(os.path.join(copy, 'tests', name))
        engine_cpu_tests(copy, getattr(args, 'test_name', None))
        if getattr(args,'fixture_preparer',None):
            args.fixture_preparer(copy)
        else:
            denial_initial_source(copy)
            prepare_hooks(copy, args.hooks_entry)
            if (Path(copy)/'tests/d1-owner-test-access.ts').is_file(): d1_fixture_access(copy)
        env = isolated_env(Path(scratch)/'home')
        version = run_cpu([claude, '--version'], capture_output=True, text=True, env=env, cwd=scratch, cpu_limit=30)
        print('claude CLI: ' + (version.stdout.strip() or 'unknown'), flush=True)
        def hook_envelopes():
            from hook_cpu import run_envelopes
            folder = Path(scratch)/'hook-envelopes'
            folder.mkdir()
            result, receipt = run_envelopes(claude, copy, folder, env,
                                          envelope_budgets, measure=measure_hook_cpu,
                                          keep=args.keep, only=hook_targets)
            STAGE_COUNTS.append({'command': [claude, 'plugin', 'test', '{hook target scratch}'], **receipt})
            return result
        if only_hook_envelopes:
            if envelope_budgets is None:
                raise ValueError('explicit hook envelope budgets are required')
            return hook_envelopes()
        # Serial is the default and cannot exceed the machine's worker cap.
        workers = workers_override if workers_override is not None else file_workers(os.environ)
        status = run_serial(claude, copy, scratch, env, workers=workers,
                            measure=measure_file_cpu, keep=args.keep)
        import serial_tests
        STAGE_COUNTS.append({'command': [claude, 'plugin', 'test', '{serial scratch}'], **serial_tests.last_receipt})
        if envelope_budgets is not None:
            status = merge_status(status, hook_envelopes())
        # The WebKit fit gate reads build-preview.py, which the public tree leaves out (it says so and skips).
        if status == 0 and not (args.test_file or args.windows_roots or args.plugin_source or args.tests_source) \
                and not left_out('tools/build-preview.py'):
            return desktop_fit_phase(claude, scratch)
        return 0 if status == 0 else 1

    finally:
        owned_scratch.cleanup()


class StageSkipped(Exception):
    pass


def required_program(program):
    path = shutil.which(program)
    if not path:
        raise StageSkipped(program + ' is unavailable')
    return path


def python_check(path, *arguments):
    with TemporaryDirectory(prefix='p1-python-home-') as folder:
        return observed_run([sys.executable, str(Path(ROOT)/'tools/cpu_stage.py'), str(Path(ROOT)/path), *arguments],
                       env=dict(isolated_env(folder), CARGO_HOME=os.environ.get('CARGO_HOME', str(Path.home()/'.cargo')), RUSTUP_HOME=os.environ.get('RUSTUP_HOME', str(Path.home()/'.rustup'))), cwd=ROOT, cpu_limit=TIMEOUT).returncode


def d1_python_preflight(check):
    if left_out('tools/tests/' + check):
        return 0
    with TemporaryDirectory(prefix='g1-d1-preflight-') as folder:
        return observed_run([sys.executable, str(Path(ROOT)/'tools/cpu_stage.py'),
                             str(Path(ROOT)/'tools/tests'/check)],
                            env=isolated_env(folder), cwd=ROOT, cpu_limit=30).returncode


def d1_bun_preflight(*files):
    with TemporaryDirectory(prefix='g1-d1-algorithm-') as folder:
        return observed_run([required_program('bun'), '--no-env-file', 'test',
                             *(str(Path(ROOT)/'tools/tests/algo'/file) for file in files)],
                            env=isolated_env(folder), cwd=ROOT, cpu_limit=30)


def uninstall_source_preflight():
    uninstall_source = observed_run(
        [required_program('bun'), '--no-env-file', 'test',
         os.path.join(ROOT, 'tools', 'tests', 'algo', 'd1-trim-uninstall-source.test.ts')],
        cwd=ROOT, cpu_limit=TIMEOUT)
    if uninstall_source.returncode != 0:
        return uninstall_source.returncode
    return 0


def secondary_claude(args):
    if not args.claude:
        return None
    claude = find_claude(args.claude)
    return claude


def run_stage(stage, args, claude):
    from gate_stages import PYTHON, SWIFT, ICON
    if stage in ('kit', 'kit-2.1.299'):
        binary = claude if stage == 'kit' else secondary_claude(args)
        if not binary:
            raise StageSkipped('not run: no 2.1.299 binary' if stage == 'kit-2.1.299' else 'claude CLI is unavailable')
        if stage == 'kit-2.1.299':
            with TemporaryDirectory(prefix='p1-engine-version-') as folder:
                version = run_cpu([binary, '--version'], env=isolated_env(folder), cwd=folder,
                                  capture_output=True, text=True, cpu_limit=30)
            if not version.stdout.startswith('2.1.299 '):
                raise RuntimeError('--claude requires the pinned 2.1.299 binary; got ' + version.stdout.strip())
        budgets = None
        if not args.test_file and not args.windows_roots and not args.plugin_source and not args.tests_source:
            registry = json.loads((Path(ROOT)/'tools/promises.json').read_text())
            budgets = next(row.get('hookCpuBudgets') for row in registry if row['id'] == 'C6')
            if not budgets:
                raise RuntimeError('missing per-hook CPU budget inventory in promises C6')
        status = run_kit(args, binary, envelope_budgets=budgets)
        # A targeted file invocation remains a unit check; the complete gate, on either
        # engine, also checks the preview tree independently of WebKit availability.
        if (not args.test_file and not args.windows_roots
                and not args.plugin_source and not args.tests_source and not left_out('tools/build-preview.py')):
            with TemporaryDirectory(prefix='p1-layout-home-') as home:
                status = merge_status(status, observed_run(
                    [sys.executable, str(Path(ROOT)/'tools/build-preview.py'), '--check-layout'],
                    env=dict(isolated_env(home), CLAUDE_BIN=binary), cwd=ROOT,
                    cpu_limit=TIMEOUT).returncode)
        return status
    if stage == 'bun':
        bun = required_program('bun')
        with TemporaryDirectory(prefix='p1-bun-') as folder:
            work = Path(folder)
            # Preserve relative imports and fixture files; modify only timing clocks in tests.
            shutil.copytree(Path(ROOT)/'plugin', work/'plugin', ignore=skip_engine_files(str(Path(ROOT)/'plugin')))
            for name in ('motion-tests', 'tests/algo', 'security-tests'):
                shutil.copytree(Path(ROOT)/'tools'/name, work/'tools'/name)
            shutil.copyfile(Path(ROOT)/'tools/run-tests.py', work/'tools/run-tests.py')
            for name in ('c3-algo-core.ts', 'c3-algo-worker.ts', 'notice-core.ts', 'notice-worker.ts', 'build-notice-worker.py', 'scratch.py'):
                shutil.copy2(Path(ROOT)/'tools'/name, work/'tools'/name)
            shutil.copytree(Path(ROOT)/'tools/notice', work/'tools/notice')
            for name in ('hook-cpu-meter.ts', 'hook-event-cpu-meter.ts', 'process-cpu.ts', 'c3-words-fixture.ts'):
                shutil.copy2(Path(ROOT)/'tools/tests'/name, work/'tools/tests'/name)
            files = (sorted((work/'tools/motion-tests').glob('*.test.ts'))
                     + sorted((work/'tools/tests/algo').glob('*.test.ts'))
                     + sorted((work/'tools/security-tests').glob('*.test.ts')))
            if not files:
                raise RuntimeError('Bun test inventory is empty')
            for path in files:
                text = path.read_text()
                if 'performance.now()' in text:
                    path.write_text('const processCpuMs = () => { const c = process.cpuUsage(); return (c.user + c.system) / 1000 }\n' + text.replace('performance.now()', 'processCpuMs()'))
            status = 0
            for cwd, group in ((work, [p for p in files if 'motion-tests' in p.parts]),
                               (work/'tools/tests/algo', [p for p in files if 'algo' in p.parts]),
                               (work, [p for p in files if 'security-tests' in p.parts])):
                status = merge_status(status, observed_run([bun, '--no-env-file', 'test', '--max-concurrency', '1', '--timeout', '2147483647', *map(str, group)],
                                      cwd=cwd, env=isolated_env(work/'home'), cpu_limit=TIMEOUT).returncode)
            status = merge_status(status, python_check('tools/build-preview.py', '--check-transport'))
        return status
    if stage == 'icon':
        generated = check_generators()
        if generated:
            return generated
        status = 0
        for name in ICON:
            status = merge_status(status, python_check('tools/tests/' + name))
        if not claude:
            raise StageSkipped('claude CLI is unavailable for icon engine checks')
        icon_args = argparse.Namespace(**vars(args))
        if not icon_args.test_file:
            icon_args.test_file = ['icon-book.test.tsx', 'icon-press-only.test.tsx',
                                   'icon-exec-security.test.tsx']
        return merge_status(status, run_kit(icon_args, claude))
    if stage == 'python':
        generated = check_generators()
        if generated:
            return generated
        status = 0 if left_out('tools/check-claude-ai-skin.py') else python_check('tools/check-claude-ai-skin.py', '--check')
        for name in PYTHON:
            path = Path(ROOT)/'tools/tests'/name
            if left_out('tools/tests/' + name):
                continue
            if not path.is_file():
                print('missing required Python check: ' + str(path))
                status = 1
                continue
            status = merge_status(status, python_check('tools/tests/' + name))
        if not left_out('tools/release/tests/rename-kit.test.py'):
            status = merge_status(status, python_check('tools/release/tests/rename-kit.test.py'))
        if not left_out('tools/generate-voice-sizes.py'):
            status = merge_status(status, python_check('tools/generate-voice-sizes.py', '--check'))
        if getattr(args,'d1_python_checks',None): status=merge_status(status,args.d1_python_checks())
        return status
    if stage == 'swift':
        if sys.platform != 'darwin':
            raise StageSkipped('macOS is required')
        required_program('swiftc')
        status = 0
        for name in (*SWIFT, 'promises-native.py'):
            arguments = ('--functional-only',) if name == 'companion-pointer-cost.py' else ()
            status = merge_status(status, python_check('tools/tests/' + name, *arguments))
        return status
    if stage == 'rust':
        cargo = required_program('cargo')
        with TemporaryDirectory(prefix='p1-cargo-') as folder:
            cargo_home = os.environ.get('CARGO_HOME', str(Path.home()/'.cargo'))
            if os.environ.get('COMPANION_CARGO_SOURCE_REGISTRY') or os.environ.get('COMPANION_CARGO_REGISTRY_NAME'):
                import importlib.util
                module = Path(ROOT)/'plugin/companion-rs/ci/offline_registry.py'
                spec = importlib.util.spec_from_file_location('g1_offline_registry', module)
                cache = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(cache)
                cargo_home = str(Path(folder)/'cargo-home')
                Path(cargo_home).mkdir()
                context = cache.prepare_registry(cargo_home)
                STAGE_COUNTS.append({'command': ['offline registry copy'], 'exitCode': 0, **context})
            env = dict(isolated_env(Path(folder)/'home'), CARGO_TARGET_DIR=str(Path(folder)/'target'), CARGO_BUILD_JOBS='4',
                       CARGO_HOME=cargo_home, RUSTUP_HOME=os.environ.get('RUSTUP_HOME', str(Path.home()/'.rustup')))
            budget_path = Path(ROOT)/'tools/budgets/companion-rss.json'
            platform_key = 'rust-' + ('macos' if sys.platform == 'darwin' else sys.platform) + '-' + ('aarch64' if __import__('platform').machine() == 'arm64' else __import__('platform').machine())
            budgets = json.loads(budget_path.read_text()).get('measurements', {}) if budget_path.is_file() else {}
            missing_rss = sys.platform in ('darwin', 'linux') and platform_key not in budgets
            extra = ['--', '--test-threads=1', '--skip', 'p1_headless_renderer_rss_stays_in_recorded_budget'] if missing_rss else ['--', '--test-threads=1']
            result = observed_run([cargo, 'test', '--offline', '--locked', '-j', '4', '--manifest-path',
                            str(Path(ROOT)/'plugin/companion-rs/Cargo.toml'), *extra], env=env, cwd=ROOT, cpu_limit=TIMEOUT)
            if result.returncode and ('no matching package named' in result.stderr or 'failed to download' in result.stderr):
                raise StageSkipped('offline Cargo dependency unavailable: ' + result.stderr.splitlines()[0])
            if result.returncode == 0 and sys.platform not in ('darwin', 'linux'):
                raise StageSkipped('RSS not measured: headless RSS fixture is unsupported on ' + sys.platform + '; other Rust tests dispatched')
            if result.returncode == 0 and missing_rss:
                raise StageSkipped('RSS not measured: no recorded baseline for ' + platform_key + '; other Rust tests dispatched')
            return result.returncode
    if stage == 'install':
        if not claude:
            raise StageSkipped('claude CLI is unavailable')
        shell = required_program('sh')
        with TemporaryDirectory(prefix='p1-install-source-') as folder:
            work = Path(folder)
            shutil.copytree(Path(ROOT)/'plugin', work/'plugin', ignore=skip_engine_files(str(Path(ROOT)/'plugin')))
            (work/'.claude-plugin').mkdir()
            manifest = {'name': 'coco', 'owner': {'name': 'ninondev'},
                        'plugins': [{'name': 'coco', 'source': './plugin'}]}
            (work/'.claude-plugin/marketplace.json').write_text(json.dumps(manifest))
            env = isolated_env(work/'home')
            status = observed_run([shell, str(Path(ROOT)/'tools/release/install-test.sh'), '--from', str(work), '--claude', claude],
                             env=env, cwd=work, cpu_limit=TIMEOUT).returncode
            for name in ('companion-script.test.py', 'icon-script.test.py'):
                status = merge_status(status, python_check('tools/tests/' + name))
            return status
    if stage == 'webkit':
        if sys.platform != 'darwin':
            raise StageSkipped('macOS WebKit is required')
        required_program('swiftc')
        if not claude:
            raise StageSkipped('claude CLI is unavailable for fit captures')
        with TemporaryDirectory(prefix='p1-fit-') as folder:
            env = isolated_env(Path(folder)/'home')
            env.update(CLAUDE_BIN=claude, FIT_CAPTURE_LOG=os.environ.get('FIT_CAPTURE_LOG', str(Path(ROOT)/'tools/evidence/p1/webkit-capture.log')))
            first = observed_run([sys.executable, str(Path(ROOT)/'tools/cpu_stage.py'), str(Path(ROOT)/'tools/build-preview.py'),
                             '--prepare-fit', folder], env=env, cwd=ROOT, cpu_limit=TIMEOUT)
            if first.returncode:
                return 1
            checked = observed_run([sys.executable, str(Path(ROOT)/'tools/cpu_stage.py'), str(Path(ROOT)/'tools/build-preview.py'),
                            '--check-fit', folder], env=env, cwd=ROOT, cpu_limit=TIMEOUT).returncode
            return checked if checked in (0, 3) else 1
    if stage == 'release':
        load = os.getloadavg()[0] if hasattr(os, 'getloadavg') else None
        threshold = (os.cpu_count() or 1) / 2
        print('release load start: %s; threshold: %s' % (load, threshold), flush=True)
        if load is None or load > threshold:
            raise StageSkipped('not measured: 1-minute load average exceeds half the cores or is unavailable')
        if not args.release_baseline:
            raise StageSkipped('not measured: last accepted baseline source was not provided')
        try:
            return python_check('tools/release/promises-timing.py', '--baseline', args.release_baseline)
        finally:
            print('release load end: ' + str(os.getloadavg()[0]), flush=True)
    if stage == 'skin':
        for path in ('tools/check-claude-ai-skin.py', 'tools/tests/claude-ai-skin.test.py'):
            if not (Path(ROOT)/path).is_file():
                raise RuntimeError('required skin stage file missing: ' + path)
        arguments = ['--check'] + (['--site-css', args.site_css] if args.site_css else [])
        first = python_check('tools/check-claude-ai-skin.py', *arguments)
        return first if first else python_check('tools/tests/claude-ai-skin.test.py')
    raise RuntimeError('unknown stage ' + stage)


def main():
    from gate_stages import STAGES, DEFAULT
    parser = argparse.ArgumentParser(description='Run named isolated offline gates; skipped prerequisites exit 3 unless allowed.')
    parser.add_argument('--stage', action='append', choices=('all', *STAGES, 'd1-native', 'd1-load', 'd1-event-counters', 'd1-capture-metrics'), help='repeat to select stages; default runs every non-release stage')
    parser.add_argument('--allow-skip', action='append', choices=STAGES, default=[])
    parser.add_argument('--d1-load-before')
    parser.add_argument('--d1-load-out')
    parser.add_argument('--d1-captures')
    parser.add_argument('--d1-metrics-out')
    parser.add_argument('--site-css')
    parser.add_argument('--windows-roots', action='store_true')
    parser.add_argument('--plugin-source', help=argparse.SUPPRESS)
    parser.add_argument('--tests-source', help=argparse.SUPPRESS)
    parser.add_argument('--readme-source', help=argparse.SUPPRESS)
    parser.add_argument('--test-file', action='append')
    parser.add_argument('--test-name', action='append', help=argparse.SUPPRESS)
    parser.add_argument('--hooks-entry', choices=('register.tsx', 'hooks-bundle.js'))
    parser.add_argument('--keep', action='store_true')
    parser.add_argument('--claude', help='second engine: pinned 2.1.299 CLI')
    parser.add_argument('--release-baseline', help='frozen last accepted plugin source for the 21-run release timing pair')
    parser.add_argument('--report-json', help='save structured stage receipts')
    args = parser.parse_args()
    counter_tests = {'d1-compaction-blit-denial-counter.test.tsx', 'd1-compaction-raster-counter.test.tsx', 'd1-compaction-timeline-counter.test.tsx', 'd1-lying-scroll-construction.test.tsx', 'd1-helper-event-counter.test.tsx'}
    def prepare_d1_source(copy):
        source_files(copy)
    args.source_preparer = prepare_d1_source
    def prepare_d1_root(copy):
        windows_roots(copy, args.windows_roots)
    args.root_preparer = prepare_d1_root
    def prepare_d1_fixture(copy):
        prepare_hooks(copy, args.hooks_entry)
        if (Path(copy)/'tests/d1-owner-test-access.ts').is_file(): d1_fixture_access(copy)
        for name in counter_tests:
            if not args.test_file or name not in args.test_file:
                (Path(copy)/'tests'/name).unlink(missing_ok=True)
    args.fixture_preparer = prepare_d1_fixture
    def d1_python_checks():
        status=0
        for check in ('d1-counter-stage-wiring.test.py', 'd1-load-stage.test.py', 'd1-capture-metrics-stage.test.py', 'd1-api-fixture-wiring.test.py', 'hooks-entry.test.py', 'd1-companion-projection-wiring.test.py', 'd1-desktop-startup-wiring.test.py', 'd1-optional-spawn-wiring.test.py', 'd1-presence-fixture-wiring.test.py', 'd1-runtime-quiet-wiring.test.py', 'd1-line-publication-wiring.test.py', 'd1-preview-tools.test.py', 'd1-room-assets.test.py'):
            status=merge_status(status,python_check('tools/tests/'+check))
        return status
    args.d1_python_checks = d1_python_checks
    if args.stage == ['d1-native']:
        if sys.platform != 'darwin': return 3
        return subprocess.run([sys.executable, os.path.join(ROOT, 'tools', 'tests', 'companion-d1.py')], cwd=ROOT, timeout=180).returncode
    if args.stage == ['d1-load']:
        if not args.d1_load_before or not args.d1_load_out: parser.error('d1-load requires --d1-load-before and --d1-load-out')
        return subprocess.run([sys.executable, os.path.join(ROOT, 'tools', 'measure-hooks-load.py'), '--before', args.d1_load_before, '--runs', '21', '--out', args.d1_load_out], cwd=ROOT).returncode
    if args.stage == ['d1-event-counters']:
        from d1_event_counter_stage import run_d1_event_counters
        return run_d1_event_counters(argparse.Namespace(**globals()), args)
    if args.stage == ['d1-capture-metrics']:
        if not args.d1_captures or not args.d1_metrics_out: parser.error('d1-capture-metrics requires --d1-captures and --d1-metrics-out')
        return subprocess.run([sys.executable, os.path.join(ROOT, 'tools', 'd1_capture_metrics_stage.py'), '--root', ROOT, '--trees', args.d1_captures, '--out', args.d1_metrics_out], cwd=ROOT).returncode
    selected = list(dict.fromkeys(DEFAULT if not args.stage or 'all' in args.stage else args.stage))
    # Keep the historic Windows-root invocation a representative engine-only pass.
    if args.windows_roots and not args.stage:
        selected = ['kit', 'kit-2.1.299']
    if any(stage in selected for stage in ('kit', 'kit-2.1.299', 'install', 'webkit')):
        if uninstall_source_preflight() != 0:
            return 1
        for check in ('d1-api-fixture-wiring.test.py', 'd1-desktop-startup-wiring.test.py', 'd1-runtime-quiet-wiring.test.py', 'd1-line-publication-wiring.test.py', 'd1-optional-spawn-wiring.test.py', 'd1-companion-projection-wiring.test.py'):
            checked = d1_python_preflight(check)
            if checked != 0:
                return checked
        quiet_runtime = d1_bun_preflight('d1-runtime-quiet.test.ts')
        if quiet_runtime.returncode != 0:
            return quiet_runtime.returncode
        line_publication = d1_bun_preflight('d1-line-publication.test.ts', 'd1-line-publication-quiet.test.ts')
        if line_publication.returncode != 0:
            return line_publication.returncode
    claude = find_claude(None)
    receipts = []
    for stage in selected:
        print('\nSTAGE ' + stage, flush=True)
        before = cpu_seconds()
        STAGE_COUNTS.clear()
        load_start = list(os.getloadavg()) if hasattr(os, 'getloadavg') else None
        print('load start: ' + str(load_start), flush=True)
        try:
            status = run_stage(stage, args, claude)
            row = {'stage': stage, 'status': 'SKIPPED' if status == 3 else 'PASS' if status == 0 else 'FAIL',
                   'reason': 'check reported unavailable; see check output' if status == 3 else 'all dispatched checks passed' if status == 0 else 'check exit code ' + str(status), 'exitCode': status}
            skipped_checks = [check for check in STAGE_COUNTS if check.get('skippedTests') or check.get('skipReasons')]
            if status in (0, 3) and skipped_checks:
                row['status'] = 'SKIPPED'
                row['reason'] = '; '.join((str(check.get('skippedTests', 0)) + ' tests skipped in ' + ' '.join(check['command'])) if check.get('skippedTests') else '; '.join(check['skipReasons']) for check in skipped_checks)
        except StageSkipped as error:
            row = {'stage': stage, 'status': 'SKIPPED', 'reason': str(error)}
        except (OSError, RuntimeError, ValueError, subprocess.TimeoutExpired) as error:
            row = {'stage': stage, 'status': 'FAIL', 'reason': str(error), 'exitCode': 1}
        row['cpuSeconds'] = cpu_seconds() - before
        row['loadStart'] = load_start
        row['loadEnd'] = list(os.getloadavg()) if hasattr(os, 'getloadavg') else None
        row['checks'] = list(STAGE_COUNTS)
        print('load end: ' + str(row['loadEnd']), flush=True)
        receipts.append(row)
        print('{stage}: {status}: {reason}; CPU {cpuSeconds:.6f} s'.format(**row), flush=True)
    print('\nFINAL SUMMARY', flush=True)
    for row in receipts:
        print('{stage}: {status}: {reason}'.format(**row))
    # Dispatch explicitly exempts absent 2.1.299 from failing this machine's gate.
    unallowed = [r for r in receipts if r['status'] == 'SKIPPED' and r['stage'] not in args.allow_skip
                 and not (r['stage'] == 'kit-2.1.299' and r['reason'] == 'not run: no 2.1.299 binary')]
    result = 1 if any(r['status'] == 'FAIL' for r in receipts) else 3 if unallowed else 0
    if args.report_json:
        output = Path(args.report_json)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps({'exitCode': result, 'stages': receipts}, indent=2) + '\n')
    return result


if __name__ == '__main__':
    sys.exit(main())
