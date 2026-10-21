"""Owned temporary directories for private runners, including signal exits."""
import atexit
import os
import shutil
import signal
import tempfile
import threading

_active = set()
_installed = False
_signals_installed = False


def _keep():
    return os.environ.get('COCO_KEEP_SCRATCH') == '1'


def _cleanup_all(from_signal=False):
    for directory in tuple(_active):
        if from_signal and directory.defer_signals:
            continue
        directory.cleanup()


def _interrupted(signum, frame):
    # Clean before unwinding: subprocess context managers can wait for a child.
    _cleanup_all(from_signal=True)
    raise SystemExit(128 + signum)


def _install():
    global _installed, _signals_installed
    if not _installed:
        atexit.register(_cleanup_all)
        _installed = True
    if not _signals_installed and threading.current_thread() is threading.main_thread():
        for name in ('SIGHUP', 'SIGINT', 'SIGTERM'):
            value = getattr(signal, name, None)
            if value is not None:
                signal.signal(value, _interrupted)
        _signals_installed = True


class OwnedDirectory:
    def __init__(self, name, keep=False, defer_signals=False):
        self.name = str(name)
        self.keep = keep
        # subprocess.run kills/waits before propagating the signal exception;
        # its runner finally must clean after those last possible child writes.
        self.defer_signals = defer_signals
        self._identity = os.stat(self.name, follow_symlinks=False)
        _install()
        _active.add(self)

    def __enter__(self):
        return self.name

    def __exit__(self, *exc):
        self.cleanup()

    def cleanup(self):
        if self not in _active:
            return
        if self.keep or _keep():
            _active.remove(self)
            print('scratch folder kept: %s' % self.name)
            return
        try:
            current = os.stat(self.name, follow_symlinks=False)
        except FileNotFoundError:
            _active.remove(self)
            return
        if os.path.islink(self.name) or (current.st_dev, current.st_ino) != (self._identity.st_dev, self._identity.st_ino):
            _active.remove(self)
            return
        shutil.rmtree(self.name)
        # Failed/interruptible deletion stays registered for finally/atexit retry.
        _active.discard(self)


class TemporaryDirectory(OwnedDirectory):
    def __init__(self, suffix=None, prefix=None, dir=None):
        super().__init__(tempfile.mkdtemp(suffix=suffix, prefix=prefix, dir=dir if dir is not None else os.environ.get('TMPDIR')))


def register_scratch(path, keep=False, defer_signals=False):
    return OwnedDirectory(path, keep=keep, defer_signals=defer_signals)


def cleanup_scratch(path):
    for directory in tuple(_active):
        if directory.name == str(path):
            directory.cleanup()
