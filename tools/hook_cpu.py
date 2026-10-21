"""Install CPU hook receipts only in runner-owned scratch plugin copies."""
from pathlib import Path
from hooks_source import hook_directory
import json
import math
import shutil
import re
from concurrent.futures import ThreadPoolExecutor, as_completed


def target_inventory(copy):
    """Source declaration inventory; matcher text is retained, not executed."""
    copy = Path(copy)
    declarations, targets = [], {}
    hooks = hook_directory(copy)
    for file in sorted(hooks.rglob('*.ts*')):
        text = file.read_text()
        for match in re.finditer(r"\bon\(\s*['\"]([^'\"]+)['\"]", text):
            event = match[1]
            cursor = match.end()
            while cursor < len(text) and text[cursor] in ' \t\r\n,':
                cursor += 1
            matcher = None
            if cursor < len(text) and text[cursor] == '{':
                # Shipping matchers are flat object literals on one source line.
                end = text.find('}', cursor)
                if end < 0 or '\n' in text[cursor:end]:
                    raise RuntimeError('matcher inventory requires reviewed parser for %s:%d' % (file, text.count('\n', 0, cursor) + 1))
                matcher = text[cursor:end + 1]
            component_match = re.search(r"\bcomponent\s*:\s*['\"]([^'\"]+)['\"]", matcher or '')
            component = component_match[1] if component_match else None
            if event == 'ui.render' and component is None:
                raise RuntimeError('render declaration requires an explicit component fixture')
            declarations.append({'registration': len(declarations), 'pattern': event, 'matcherSource': matcher,
                                 'component': component, 'source': 'hooks/' + file.relative_to(hooks).as_posix(), 'line': text.count('\n', 0, match.start()) + 1})
            key = event + (':' + component if component else '')
            targets[key] = {'event': event, **({'component': component, 'surface': 'desktop'} if component else {})}
    return declarations, [targets[key] for key in sorted(targets)]


def prepare(copy, root):
    copy, root = Path(copy).resolve(), Path(root).resolve()
    if copy == root / 'plugin' or root in copy.parents:
        raise RuntimeError('hook CPU instrumentation requires an isolated scratch plugin')
    shutil.copyfile(root / 'tools/native_hook_cpu.py', copy / 'tests/native-hook-cpu.py')
    native = {'helper': str(copy / 'tests/native-hook-cpu.py'), 'pidFile': str(copy.parent / 'hook-event-engine.pid'), 'python': '/usr/bin/python3'}
    (copy / 'tests/native-hook-config.ts').write_text('export const NATIVE_HOOK_CPU = ' + json.dumps(native) + ' as const\n')
    entry = hook_directory(copy) / 'register.tsx'
    source = entry.read_text()
    seam = 'export const register: Register = (on, options) => {'
    if source.count(seam) != 1:
        raise RuntimeError('hook CPU register seam changed; review the scratch instrumenter')
    registrations, targets = target_inventory(copy)
    (copy / 'tests/hook-event-declarations.ts').write_text('export const HOOK_EVENT_DECLARATIONS = ' + json.dumps(registrations) + ' as const\n')
    (copy / 'tests/hook-event-inventory.ts').write_text('export const HOOK_EVENT_TARGETS = ' + json.dumps(targets) + ' as const\n')
    (copy / 'tests/hook-event-target.ts').write_text('export const HOOK_EVENT_TARGET = {event: "session.start"} as const\n')
    static = {'marker': 'p1-kit-hook-cpu', 'version': 1, 'scope': 'static-registration-declarations',
              'registrations': registrations,
              'limitations': ['This source inventory retains matcher text but does not measure dynamic callback calls, filter coverage or CPU.']}
    injection = """
  // Static declarations only: no rebinding/instrumentation of SDK on/$/next.
  on('command.run', { command: 'p1-kit-hook-cpu-receipt' }, () => ({
    text: %s,
  }))
  // These plugin-only nouns are absent from public TestEngine.EventCalls.
  // A measured public command dispatch includes the entire actual nested event
  // and bridge CPU. Values stay equivalent to current scratch fixture state.
  on('command.run', { command: /^p1-kit-hook-event-cpu:(session\\.usage|store\\.set|state\\.set|ui\\.close|model\\.fork|model\\.complete)$/ }, async ($, e) => {
    const event = e.command.slice('p1-kit-hook-event-cpu:'.length)
    if (event === 'session.usage') await $.session.usage({ breakdown: 'summary' })
    else if (event === 'store.set') await $.store.set('band', view.band)
    else if (event === 'state.set') await $.state.set(VIEW, { ...view })
    else if (event === 'ui.close') await $.ui.close({ id: 'coco-book' })
    else if (event === 'model.fork') await $.model.fork({ prompt: 'p1 cpu envelope fork' })
    else if (event === 'model.complete') await $.model.complete({ model: 'haiku', prompt: 'p1 cpu envelope completion' })
    return { text: JSON.stringify({ marker: 'p1-kit-hook-event-cpu-bridge', event }) }
  })
""" % json.dumps(json.dumps(static, separators=(',', ':')))
    source = source.replace(seam, seam + injection)
    entry.write_text(source)


def mutate_busy_hook(copy, iterations, event='session.start'):
    """Root-scheduled negative control: CPU busy loop in a real scratch hook."""
    copy = Path(copy).resolve()
    if type(iterations) is not int or iterations <= 0:
        raise ValueError('busy-loop fixed compute iterations must be a positive integer')
    entry = hook_directory(copy) / 'register.tsx'
    source = entry.read_text()
    seam = "on('" + event + "', async ($, e, next) => {"
    if source.count(seam) != 1 or 'p1-kit-hook-cpu-receipt' not in source:
        raise RuntimeError('busy hook mutation requires one instrumented scratch callback')
    loop = """
    let __p1BusyChecksum = 0
    for (let __p1BusyIndex = 0; __p1BusyIndex < %d; __p1BusyIndex++) {
      __p1BusyChecksum = (__p1BusyChecksum + Math.imul(__p1BusyIndex ^ __p1BusyChecksum, 31)) | 0
    }
    await $.store.set('p1-hook-cpu-busy-checksum', __p1BusyChecksum)
""" % iterations
    entry.write_text(source.replace(seam, seam + loop))


def aggregate(receipts, budgets):
    """Union full-suite calls by individual registration, preserving all gaps.

    CPU is the inclusive worker-process envelope documented by each receipt.
    This is deliberately not an exclusive callback CPU attribution claim.
    """
    rows = {}
    problems = []
    if not receipts:
        return {'scope': 'hook-worker-process-inclusive', 'hooks': [], 'gaps': ['no full-suite hook CPU receipts']}
    inventories = []
    for receipt in receipts:
        if receipt.get('marker') != 'p1-kit-hook-cpu' or receipt.get('version') != 1 or receipt.get('scope') != 'hook-worker-process-inclusive':
            problems.append('malformed full-suite hook CPU receipt')
            continue
        inventory = []
        for source in receipt.get('hooks', []):
            counters = ('registration', 'calls', 'settled', 'pending', 'measured', 'missingClock')
            if (any(type(source.get(field)) is not int or source[field] < 0 for field in counters)
                    or source['calls'] != source['settled'] + source['pending']
                    or source['settled'] != source['measured'] + source['missingClock']
                    or not isinstance(source.get('pattern'), str)
                    or any(not isinstance(source.get(field), list) or any(not isinstance(value, str) for value in source[field]) for field in ('components', 'events'))):
                problems.append('malformed hook CPU registration counters or coverage')
                continue
            maximum = source.get('maxCpuMs')
            total = source.get('totalCpuMs')
            if (type(total) not in (int, float) or not math.isfinite(total) or total < 0
                    or maximum is not None and (type(maximum) not in (int, float) or not math.isfinite(maximum) or maximum < 0)
                    or source['measured'] > 0 and maximum is None):
                problems.append('malformed hook CPU measurement')
                continue
            key = json.dumps([source['registration'], source['pattern'], source.get('matcher')], sort_keys=True, separators=(',', ':'))
            inventory.append(key)
            row = rows.setdefault(key, {**source, 'calls': 0, 'settled': 0, 'pending': 0, 'measured': 0, 'missingClock': 0,
                                       'maxCpuMs': None, 'totalCpuMs': 0, 'components': set(), 'events': set(), 'tests': set()})
            for field in ('calls', 'settled', 'pending', 'measured', 'missingClock', 'totalCpuMs'):
                row[field] += source.get(field, 0)
            if maximum is not None:
                row['maxCpuMs'] = max(row['maxCpuMs'] or 0, maximum)
            row['components'].update(source.get('components', []))
            row['events'].update(source.get('events', []))
            if source.get('calls'):
                row['tests'].add(receipt.get('test', '<unnamed>'))
        inventories.append(inventory)
    if inventories and any(inventory != inventories[0] for inventory in inventories[1:]):
        problems.append('registered hook inventory differs between full-suite tests')
    result = []
    for row in rows.values():
        for field in ('components', 'events', 'tests'):
            row[field] = sorted(row[field])
        label = 'registration %d %s' % (row['registration'], row['pattern'])
        if not row['calls']:
            problems.append(label + ': no dispatched calls')
        else:
            if row['pending']:
                problems.append(label + ': %d callbacks not settled' % row['pending'])
            if row['missingClock'] or not row['measured'] or row['maxCpuMs'] is None:
                problems.append(label + ': CPU primitive unavailable')
            if row['maxCpuMs'] is not None:
                limits = [budgets.get('byEvent', {}).get(row['pattern'], budgets['defaultMaxCpuMs'])]
                limits.extend(budgets['byComponent'][component] for component in row['components'] if component in budgets.get('byComponent', {}))
                limit = min(limits)
                if type(limit) not in (int, float) or not math.isfinite(limit) or limit < 0:
                    raise ValueError('invalid hook CPU budget ' + label)
                if row['maxCpuMs'] > limit:
                    problems.append(label + ': %s CPU ms exceeds %s' % (row['maxCpuMs'], limit))
        result.append(row)
    if not result:
        problems.append('no registered plugin hooks')
    return {'scope': 'hook-worker-process-inclusive', 'hooks': result, 'gaps': problems,
            'limitations': receipts[0].get('limitations', [])}


def aggregate_events(receipts, coverage_receipts, budgets):
    """Calibrated SDK process CPU event budgets plus runtime callback coverage."""
    events = {}
    gaps = []
    if not receipts:
        gaps.append('no SDK event CPU receipts')
    for receipt in receipts:
        if receipt.get('version') != 1 or receipt.get('scope') != 'sdk-test-realm-process-inclusive-event-dispatch':
            gaps.append('malformed SDK event CPU receipt')
            continue
        for source in receipt.get('events', []):
            counters = ('calls', 'settled', 'pending', 'measured', 'missingClock')
            if (any(type(source.get(field)) is not int or source[field] < 0 for field in counters)
                    or source['calls'] != source['settled'] + source['pending']
                    or source['settled'] != source['measured'] + source['missingClock']
                    or not isinstance(source.get('event'), str)
                    or source.get('component') is not None and not isinstance(source['component'], str)):
                gaps.append('malformed SDK event CPU counters or identity')
                continue
            maximum, total = source.get('maxCpuMs'), source.get('totalCpuMs')
            if (type(total) not in (int, float) or not math.isfinite(total) or total < 0
                    or maximum is not None and (type(maximum) not in (int, float) or not math.isfinite(maximum) or maximum < 0)
                    or source['measured'] and maximum is None):
                gaps.append('malformed SDK event CPU measurement')
                continue
            key = (source['event'], source.get('component'))
            row = events.setdefault(key, {**source, 'calls': 0, 'settled': 0, 'pending': 0, 'measured': 0, 'missingClock': 0,
                                          'maxCpuMs': None, 'totalCpuMs': 0, 'transports': set(), 'tests': set()})
            for field in ('calls', 'settled', 'pending', 'measured', 'missingClock', 'totalCpuMs'):
                row[field] += source[field]
            if maximum is not None:
                row['maxCpuMs'] = max(row['maxCpuMs'] or 0, maximum)
            row['transports'].update(source.get('transports', []))
            if source['calls']:
                row['tests'].add(receipt.get('test', '<unnamed>'))
    # Worker CPU is unavailable on the pinned SDK; use it solely as a runtime
    # registration/coverage inventory and retain pending and undriven callbacks.
    coverage = aggregate(coverage_receipts, {'defaultMaxCpuMs': 1e300})
    gaps.extend(gap for gap in coverage['gaps'] if not gap.endswith(': CPU primitive unavailable'))
    for row in events.values():
        for field in ('tests', 'transports'):
            row[field] = sorted(row[field])
        label = row['event'] + (' component ' + row['component'] if row.get('component') else '')
        if row['pending']:
            gaps.append(label + ': %d SDK calls not settled' % row['pending'])
        if row['missingClock'] or not row['measured'] or row['maxCpuMs'] is None:
            gaps.append(label + ': CPU primitive unavailable')
            continue
        limit = budgets.get('byEvent', {}).get(row['event'], budgets['defaultMaxCpuMs'])
        if row.get('component') in budgets.get('byComponent', {}):
            limit = min(limit, budgets['byComponent'][row['component']])
        if type(limit) not in (int, float) or not math.isfinite(limit) or limit < 0:
            raise ValueError('invalid SDK event CPU budget ' + label)
        if row['maxCpuMs'] > limit:
            gaps.append(label + ': %s CPU ms exceeds %s' % (row['maxCpuMs'], limit))
    missing = set()
    for hook in coverage['hooks']:
        component = hook.get('matcher', {}).get('component') if isinstance(hook.get('matcher'), dict) and hook['pattern'] == 'ui.render' else None
        required = component if isinstance(component, list) else [component]
        for item in required:
            if item is not None and not isinstance(item, str):
                missing.add(hook['pattern'] + ': component matcher requires explicit coverage review')
                continue
            matches = [row for (event, observed_component), row in events.items() if event == hook['pattern'] and (item is None or observed_component == item) and row['measured']]
            if not matches:
                missing.add(hook['pattern'] + (' component ' + item if item else '') + ': no SDK event CPU measurement')
    gaps.extend(sorted(missing))
    return {'scope': 'sdk-test-realm-process-inclusive-event-dispatch', 'events': sorted(events.values(), key=lambda row: (row['event'], row.get('component') or '')),
            'hooks': coverage['hooks'], 'gaps': gaps, 'workerCpuAvailable': False,
            'limitations': receipts[0].get('limitations', []) if receipts else []}


def target_key(target):
    return target['event'] + (':' + target['component'] if target.get('component') else '')


def envelope_receipt(target, outcome, budget, measure=False):
    """Validate one real CLI target receipt and its host-measured CPU envelope."""
    plain = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', (outcome.get('stdout') or '') + '\n' + (outcome.get('stderr') or ''))
    values = re.findall(r'(?m)^P1_HOOK_EVENT_ENVELOPE (.*)$', plain)
    gaps = []
    emitted = None
    dispatched = False
    try:
        if len(values) != 1:
            raise ValueError('expected exactly one actual target dispatch receipt')
        emitted = json.loads(values[0])
        if not isinstance(emitted, dict):
            emitted = None
            raise ValueError('target dispatch receipt must be an object')
        if emitted.get('event') != target['event'] or emitted.get('component') != target.get('component') or emitted.get('dispatched') is not True or emitted.get('scope') != 'isolated-cli-command-inclusive-cpu':
            raise ValueError('target dispatch receipt identity mismatch')
        dispatched = True
    except (ValueError, TypeError) as error:
        gaps.append(str(error))
    cpu = outcome.get('cpuSeconds')
    valid_cpu = type(cpu) in (int, float) and math.isfinite(cpu) and cpu > 0
    if not valid_cpu:
        gaps.append('actual command CPU measurement unavailable')
    if type(budget) not in (int, float) or not math.isfinite(budget) or budget <= 0:
        raise ValueError('invalid command CPU envelope budget')
    if not measure and valid_cpu and cpu > budget:
        gaps.append('%s CPU s exceeds %s' % (cpu, budget))
    if outcome.get('deadlineInterrupted'):
        gaps.append('command CPU deadline interrupted')
    return {'target': target_key(target), **target, 'scope': 'isolated-cli-command-inclusive-cpu',
            'cpuSeconds': cpu, 'budgetSeconds': budget, 'budgetEnforced': not measure,
            'targetDispatched': dispatched, 'gaps': gaps,
            'platformGaps': [emitted['hostGap']] if emitted and emitted.get('hostGap') else [],
            'measuredCallbackScope': 'prompt and response pre-next callback paths' if emitted and emitted.get('hostGap') else 'fixture target dispatch',
            'limitations': emitted.get('limitations', []) if emitted else []}


def run_envelopes(claude, plugin, scratch, env, budgets, *, workers=1, measure=False, keep=False, only=None):
    """One isolated actual CLI command per registered event/render component.

    Call only in the root-owned heavy lane after regular file assertions. CPU
    is wait4's inclusive command accounting, never inferred from wall clocks.
    """
    from serial_tests import _run_file, _parse_file
    if type(workers) is not int or not 1 <= workers <= 4:
        raise ValueError('hook envelope workers must be an integer from 1 to 4')
    declarations, targets = target_inventory(plugin)
    # Prepared source also contains private diagnostic bridge registrations.
    # The runner generated the original source inventory before inserting them.
    inventory = Path(plugin) / 'tests/hook-event-inventory.ts'
    if inventory.is_file():
        text = inventory.read_text()
        targets = json.loads(text.split(' = ', 1)[1].removesuffix(' as const\n'))
    source_inventory = Path(plugin) / 'tests/hook-event-declarations.ts'
    if source_inventory.is_file():
        declarations = json.loads(source_inventory.read_text().split(' = ', 1)[1].removesuffix(' as const\n'))
    if only is not None:
        selected = set(only)
        known = {target_key(target) for target in targets}
        if selected - known:
            raise ValueError('unknown registered hook CPU targets: ' + ', '.join(sorted(selected - known)))
        targets = [target for target in targets if target_key(target) in selected]
    by_target = budgets.get('byTarget', {})
    if not measure and any(target_key(target) not in by_target for target in targets):
        raise ValueError('registered hook CPU target lacks measured budget metadata')
    relative = Path('hook-event-envelope.test.tsx')
    results = {}
    status = 0
    # Most rows come from one Mac; a slower host scales them by COCO_CPU_SCALE, as kit_file_budgets scales the kit files
    from kit_file_budgets import cpu_scale
    scale = cpu_scale()
    def execute(index, target):
        budget = budgets.get('calibrationCeilingSeconds', 90) if measure else math.ceil(round(by_target[target_key(target)] * scale, 6))
        outcome = _run_file(claude, plugin, scratch, env, relative, 10000 + index, budget, None, keep, hook_target=target)
        return target, budget, outcome
    def record(result):
        nonlocal status
        target, budget, outcome = result
        file_status, file_row = _parse_file(relative, outcome, budget, measure)
        row = envelope_receipt(target, outcome, budget, measure)
        row['assertions'] = file_row
        status = status or file_status or int(bool(row['gaps']))
        results[target_key(target)] = row
        print('P1_HOOK_EVENT_CPU_COMMAND ' + json.dumps(row, separators=(',', ':')), flush=True)
    if workers == 1:
        for index, target in enumerate(targets, 1):
            record(execute(index, target))
    else:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            pending = [pool.submit(execute, index, target) for index, target in enumerate(targets, 1)]
            for future in as_completed(pending):
                record(future.result())
    return status, {'scope': 'isolated-cli-command-inclusive-cpu', 'workers': workers,
                    'sourceDeclarations': len(declarations), 'targetsTotal': len(targets), 'targetsAttempted': len(results),
                    'calibration': measure, 'targets': [results[target_key(target)] for target in targets if target_key(target) in results],
                    'declarations': declarations,
                    'callbackCoverageGaps': [{'registration': row['registration'], 'pattern': row['pattern'], 'matcherSource': row['matcherSource'],
                                             'reason': 'SDK permits no On rebinding; dynamic callback call counts and matcher coverage are not measured'} for row in declarations],
                    'limitations': ['Each CPU envelope includes engine startup, fixture setup and mocks as well as one named target dispatch.',
                                    'Static matcher inventory does not prove every filter branch or callback invocation; platform gaps are retained with narrowed callback scope.']}
