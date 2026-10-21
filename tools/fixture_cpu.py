"""Explicit CPU failure budgets for development-fixture readiness and pipe draining."""
import subprocess
import time
from process_cpu import cpu_seconds


def wait_for(predicate, *, cpu_limit, clock=None, pause=None):
    clock = clock or cpu_seconds
    pause = pause or time.sleep
    started = clock()
    while not predicate():
        if clock() - started >= cpu_limit:
            return False
        pause(0.01)
    return True


def communicate(child, *, cpu_limit, clock=None):
    clock = clock or cpu_seconds
    started = clock()
    while True:
        try:
            output = child.communicate(timeout=0.05)
        except subprocess.TimeoutExpired:
            # This wall interval only wakes the observer; expiry alone is not a failure.
            if clock() - started >= cpu_limit:
                raise subprocess.TimeoutExpired(child.args, cpu_limit)
        else:
            if clock() - started > cpu_limit:
                raise subprocess.TimeoutExpired(child.args, cpu_limit, output=output[0], stderr=output[1])
            return output
