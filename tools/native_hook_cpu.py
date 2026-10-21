#!/usr/bin/env python3
"""CPU counters of the scratch engine owning this helper; no args/env reads."""
import argparse
import ctypes
import json
import os
from pathlib import Path
import sys


class RusageInfoV2(ctypes.Structure):
    _fields_ = [('uuid', ctypes.c_uint8 * 16)] + [(name, ctypes.c_uint64) for name in (
        'user_time', 'system_time', 'pkg_idle_wkups', 'interrupt_wkups', 'pageins',
        'wired_size', 'resident_size', 'phys_footprint', 'proc_start_abstime', 'proc_exit_abstime',
        'child_user_time', 'child_system_time', 'child_pkg_idle_wkups', 'child_interrupt_wkups',
        'child_pageins', 'child_elapsed_abstime', 'diskio_bytesread', 'diskio_byteswritten')]


def snapshot(pid_file):
    if sys.platform != 'darwin':
        raise RuntimeError('native hook CPU primitive requires Darwin libproc')
    path = Path(pid_file).resolve()
    record = json.loads(path.read_text())
    if record.get('marker') != 'p1-owned-engine-pid' or type(record.get('pid')) is not int or record['pid'] <= 1:
        raise RuntimeError('native hook CPU PID ownership receipt invalid')
    root = record['pid']
    lib = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
    lib.proc_listchildpids.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_int]
    lib.proc_listchildpids.restype = ctypes.c_int
    lib.proc_pid_rusage.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
    lib.proc_pid_rusage.restype = ctypes.c_int
    pending, tree = [root], []
    while pending:
        pid = pending.pop()
        if pid in tree:
            raise RuntimeError('owned engine descendant PID cycle')
        tree.append(pid)
        if len(tree) > 256:
            raise RuntimeError('owned engine descendant inventory exceeds 256')
        buffer = (ctypes.c_int * 256)()
        count = lib.proc_listchildpids(pid, buffer, ctypes.sizeof(buffer))
        if count < 0 or count >= ctypes.sizeof(buffer) or count % ctypes.sizeof(ctypes.c_int):
            raise RuntimeError('owned engine descendant PID enumeration incomplete')
        pending.extend(child for child in buffer[:count // ctypes.sizeof(ctypes.c_int)] if child > 0)
    if os.getpid() not in tree:
        raise RuntimeError('native CPU helper is not a descendant of the owned engine PID')
    rows = []
    for pid in tree:
        usage = RusageInfoV2()
        if lib.proc_pid_rusage(pid, 2, ctypes.byref(usage)) != 0:
            raise RuntimeError('owned engine CPU counter unavailable for PID %d (errno %d)' % (pid, ctypes.get_errno()))
        rows.append({'pid': pid, 'startAbstime': usage.proc_start_abstime,
                     'cpuMs': (usage.user_time + usage.system_time) / 1e6,
                     'reapedChildCpuMs': (usage.child_user_time + usage.child_system_time) / 1e6})
    root_row = next(row for row in rows if row['pid'] == root)
    return {'marker': 'p1-native-hook-cpu', 'primitive': 'Darwin.proc_pid_rusage.RUSAGE_INFO_V2',
            'scope': 'owned-engine-tree-inclusive', 'enginePid': root, 'engineStartAbstime': root_row['startAbstime'],
            'rootCpuMs': root_row['cpuMs'], 'cpuMs': sum(row['cpuMs'] + row['reapedChildCpuMs'] for row in rows),
            'processes': rows, 'limitations': [
                'CPU includes the owning CLI, live owned descendants, reaped child CPU, observer helpers and concurrent work in this command tree.',
                'Descendant enumeration and counter reads are sequential snapshots; process exit or incomplete counters fail the measurement.',
                'This is an inclusive process-tree CPU envelope, not exclusive callback attribution or elapsed time.',
            ]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pid-file', required=True)
    options = parser.parse_args()
    print(json.dumps(snapshot(options.pid_file), separators=(',', ':')))


if __name__ == '__main__':
    main()
