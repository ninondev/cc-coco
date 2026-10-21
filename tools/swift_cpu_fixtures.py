"""Scratch-only CPU clocks for Swift test budgets; runtime clock inputs stay intact."""
import re
import tempfile
from pathlib import Path

HELPER = Path(__file__).resolve().parent/'tests/process-cpu.swift'


def transform(text):
    text = text.replace('DispatchTime.now().uptimeNanoseconds', 'p1CpuNanoseconds()')
    names = set()
    def deadline(match):
        names.add(match[1])
        return 'let ' + match[1] + ' = p1CpuSeconds() + (' + match[2] + ')'
    text = re.sub(r'let\s+(end|deadline|limit)\s*=\s*Date\(\)\.addingTimeInterval\(([^\n;{}]+?)\)(?=\s*(?:\n|;))', deadline, text)
    for name in names:
        text = re.sub(r'Date\(\)\s*<\s*' + name + r'\b', 'p1CpuSeconds() < ' + name, text)
        text = re.sub(r'min\(\s*' + name + r'\s*,\s*(Date\(\)\.addingTimeInterval\([^)]*\))\s*\)', r'\1', text)
        # Condition waiting uses short OS waits while the failure budget remains CPU time.
        text = text.replace('if !condition.wait(until: ' + name + ') { return output.contains(text) }',
                            'if p1CpuSeconds() >= ' + name + ' { return output.contains(text) }; _ = condition.wait(until: Date().addingTimeInterval(0.01))')
    for name in re.findall(r'let\s+(begun|began|started)\s*=\s*Date\(\)', text):
        if 'Date().timeIntervalSince(' + name + ')' in text:
            text = re.sub(r'let\s+' + name + r'\s*=\s*Date\(\)', 'let ' + name + ' = p1CpuSeconds()', text)
            text = text.replace('Date().timeIntervalSince(' + name + ')', '(p1CpuSeconds() - ' + name + ')')
    # Finite fixture failure callback, not the production timers under test.
    text = text.replace('DispatchQueue.main.asyncAfter(deadline: .now() + 5, execute: timeout)',
                        'p1ScheduleCpuBudget(5, work: timeout)')
    return text


def prepare_command(argv):
    if isinstance(argv, (str, bytes)):
        return argv
    command = list(argv)
    if not command or Path(command[0]).name != 'swiftc':
        return command
    if '-j' not in command and not any(str(arg).startswith('-j') and str(arg)[2:].isdigit() for arg in command):
        command[1:1] = ['-j', '4']
    mains = [Path(arg) for arg in command[1:] if str(arg).endswith('/main.swift')]
    if not mains:
        return command
    for main in mains:
        resolved = main.resolve()
        roots = (Path(tempfile.gettempdir()).resolve(), Path('/tmp').resolve())
        if resolved.is_relative_to(HELPER.parents[2]) or not any(resolved.is_relative_to(root) for root in roots):
            raise RuntimeError('CPU clock adapter requires a temporary main.swift: ' + str(main))
        main.write_text(transform(main.read_text()))
    if str(HELPER) not in command:
        command.insert(1, str(HELPER))
    return command
