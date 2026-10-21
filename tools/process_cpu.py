"""Development subprocess limits use command-local CPU, excluding scheduling wait."""
import math
import json
import tempfile
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading

_windows_children_cpu = 0.0
_windows_cpu_lock = threading.Lock()


def cpu_seconds():
    if os.name == 'posix':
        import resource
        own = resource.getrusage(resource.RUSAGE_SELF)
        children = resource.getrusage(resource.RUSAGE_CHILDREN)
        return own.ru_utime + own.ru_stime + children.ru_utime + children.ru_stime
    with _windows_cpu_lock:
        return __import__('time').process_time() + _windows_children_cpu


class _MeasuredProcess(subprocess.Popen):
    cpu_seconds = 0.0

    def _try_wait(self, flags):
        # Popen holds its own waitpid lock before invoking this method.
        pid, status, usage = os.wait4(self.pid, flags)
        if pid == self.pid:
            self.cpu_seconds = usage.ru_utime + usage.ru_stime
        return pid, status

    def _internal_poll(self, _deadstate=None):
        if self.returncode is None and self._waitpid_lock.acquire(False):
            try:
                if self.returncode is None:
                    pid, status = self._try_wait(os.WNOHANG)
                    if pid == self.pid:
                        self._handle_exitstatus(status)
            except ChildProcessError:
                if _deadstate is not None:
                    self.returncode = _deadstate
                else:
                    raise OSError('wait4 failed; command CPU measurement is unavailable')
            finally:
                self._waitpid_lock.release()
        return self.returncode


def _windows_cpu(child):
    # Read before the process context closes its handle; never monkeypatch Popen.
    import ctypes
    import ctypes.wintypes as wt
    creation, ended, kernel, user = wt.FILETIME(), wt.FILETIME(), wt.FILETIME(), wt.FILETIME()
    times = ctypes.windll.kernel32.GetProcessTimes
    times.argtypes = [wt.HANDLE, ctypes.POINTER(wt.FILETIME), ctypes.POINTER(wt.FILETIME), ctypes.POINTER(wt.FILETIME), ctypes.POINTER(wt.FILETIME)]
    if not times(wt.HANDLE(int(child._handle)), ctypes.byref(creation), ctypes.byref(ended), ctypes.byref(kernel), ctypes.byref(user)):
        raise OSError('GetProcessTimes failed; child CPU budget is unavailable')
    convert = lambda value: ((value.dwHighDateTime << 32) | value.dwLowDateTime) / 10_000_000
    return convert(kernel) + convert(user)


def _stop(child, group):
    try:
        if group:
            # A CLI may have exited while an owned descendant still holds pipes.
            os.killpg(child.pid, signal.SIGKILL)
        elif child.poll() is None:
            child.kill()
    except ProcessLookupError:
        pass
    child.communicate()


def _owned_pid_path(path, cwd):
    if cwd is None:
        raise ValueError('owned PID marker requires an explicit scratch cwd')
    root = Path(cwd).resolve(strict=True)
    target = Path(path)
    if not target.is_absolute():
        target = root/target
    parent = target.parent.resolve(strict=True)
    if not parent.is_relative_to(root):
        raise ValueError('owned PID marker must be inside scratch cwd')
    target = parent/target.name
    if target.exists() or target.is_symlink():
        raise ValueError('owned PID marker already exists')
    return target


def _write_owned_pid(path, pid):
    target = Path(path)
    descriptor, temporary = tempfile.mkstemp(prefix='.owned-pid-', dir=target.parent)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as output:
            json.dump({'marker': 'p1-owned-engine-pid', 'pid': pid}, output)
            output.write('\n')
        # Publish a complete marker atomically without replacing any existing file.
        os.link(temporary, target)
    finally:
        os.unlink(temporary)


def _command_run(argv, *, cancel_event=None, owned_pid_file=None, wall_limit=None, **kwargs):
    supplied_input = kwargs.pop('input', None)
    capture_output = kwargs.pop('capture_output', False)
    if supplied_input is not None:
        if kwargs.get('stdin') is not None:
            raise ValueError('stdin and input arguments may not both be used')
        kwargs['stdin'] = subprocess.PIPE
    if capture_output:
        if kwargs.get('stdout') is not None or kwargs.get('stderr') is not None:
            raise ValueError('stdout and stderr arguments may not be used with capture_output')
        kwargs['stdout'] = kwargs['stderr'] = subprocess.PIPE
    # Each invocation owns this session, so interruption can reap its descendants.
    group = os.name == 'posix' and kwargs.setdefault('start_new_session', True)
    process_class = _MeasuredProcess if os.name == 'posix' else subprocess.Popen
    with process_class(argv, **kwargs) as child:
        try:
            if owned_pid_file is not None:
                _write_owned_pid(owned_pid_file, child.pid)
            if cancel_event is None:
                stdout, stderr = child.communicate(input=supplied_input, timeout=wall_limit)
            else:
                deadline = __import__('time').monotonic() + wall_limit if wall_limit is not None else None
                first = True
                while True:
                    if cancel_event.is_set():
                        raise InterruptedError('owned command cancelled')
                    try:
                        remaining = deadline - __import__('time').monotonic() if deadline is not None else None
                        if remaining is not None and remaining <= 0:
                            raise subprocess.TimeoutExpired(argv, wall_limit)
                        stdout, stderr = child.communicate(input=supplied_input if first else None,
                                                          timeout=min(.05, remaining) if remaining is not None else .05)
                        break
                    except subprocess.TimeoutExpired:
                        if deadline is not None and __import__('time').monotonic() >= deadline:
                            raise subprocess.TimeoutExpired(argv, wall_limit)
                        first = False
        except BaseException as error:
            _stop(child, group)
            if isinstance(error, subprocess.TimeoutExpired):
                error.cpu_seconds = child.cpu_seconds if os.name == 'posix' else _windows_cpu(child)
            raise
        consumed = child.cpu_seconds if os.name == 'posix' else _windows_cpu(child)
        if os.name == 'nt':
            global _windows_children_cpu
            with _windows_cpu_lock:
                _windows_children_cpu += consumed
        result = subprocess.CompletedProcess(argv, child.returncode, stdout, stderr)
        result.cpu_seconds = consumed
        return result


def run(argv, *, cpu_limit=None, cancel_event=None, owned_pid_file=None, wall_limit=None, **kwargs):
    if wall_limit is not None and (type(wall_limit) not in (int, float) or not math.isfinite(wall_limit) or wall_limit <= 0):
        raise ValueError('wall limit must be a positive finite number')
    budget = kwargs.pop('timeout', cpu_limit)
    check = kwargs.pop('check', False)
    original = argv
    if owned_pid_file is not None:
        owned_pid_file = _owned_pid_path(owned_pid_file, kwargs.get('cwd'))
    if (budget is not None or owned_pid_file is not None) and os.name == 'posix':
        # setrlimit runs before exec in a separate, single-threaded Python process.
        # preexec_fn inside scheduler threads can deadlock; none is needed here.
        if kwargs.get('preexec_fn') is not None and threading.current_thread() is not threading.main_thread():
            raise ValueError('preexec_fn is unsafe in a scheduler worker')
        if kwargs.get('shell'):
            shell = kwargs.pop('executable', None) or '/bin/sh'
            argv = [shell, '-c', argv] if isinstance(argv, str) else [shell, '-c', *argv]
            kwargs['shell'] = False
        elif isinstance(argv, (str, bytes, os.PathLike)):
            argv = [argv]
        arguments = [sys.executable, str(Path(__file__).resolve()), '--cpu-limit',
                     str(max(1, math.ceil(budget))) if budget is not None else 'none']
        if owned_pid_file is not None:
            arguments += ['--owned-pid-file', str(owned_pid_file)]
        argv = [*arguments, '--', *argv]
        owned_pid_file = None  # The POSIX shim writes immediately before exec.
    result = _command_run(argv, cancel_event=cancel_event, owned_pid_file=owned_pid_file, wall_limit=wall_limit, **kwargs)
    result.args = original
    consumed = result.cpu_seconds
    if budget is not None and (consumed > budget or result.returncode in (-24, -9)):
        error = subprocess.TimeoutExpired(original, budget, output=result.stdout, stderr=result.stderr)
        error.cpu_seconds = consumed
        raise error
    if check and result.returncode:
        raise subprocess.CalledProcessError(result.returncode, original, output=result.stdout, stderr=result.stderr)
    return result


if __name__ == '__main__':
    # Private execution shim; argv and inherited environment go straight to exec.
    arguments = sys.argv[1:]
    if len(arguments) < 4 or arguments[0] != '--cpu-limit':
        raise SystemExit('process_cpu.py requires --cpu-limit SECONDS -- COMMAND')
    budget = arguments[1]
    index = 2
    owned_pid_file = None
    if arguments[index] == '--owned-pid-file':
        owned_pid_file = _owned_pid_path(arguments[index+1], Path.cwd())
        index += 2
    if index >= len(arguments)-1 or arguments[index] != '--':
        raise SystemExit('process_cpu.py requires a command after --')
    if budget != 'none':
        import resource
        seconds = int(budget)
        inherited = resource.getrlimit(resource.RLIMIT_CPU)
        hard = seconds + 1 if inherited[1] == resource.RLIM_INFINITY else min(inherited[1], seconds + 1)
        resource.setrlimit(resource.RLIMIT_CPU, (min(seconds, hard), hard))
    if owned_pid_file is not None:
        _write_owned_pid(owned_pid_file, os.getpid())
    command = arguments[index+1:]
    os.execvpe(command[0], command, os.environ)
