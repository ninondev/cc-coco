/* Test fixture: stop a child before exec, so host SIGKILL precedes helper main(). */
#include <sys/types.h>
#include <sys/wait.h>
#include <errno.h>
#include <unistd.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
int main(int argc, char **argv) {
    if (argc < 6) return 64;
    pid_t child = fork();
    if (child < 0) return 69;
    if (child == 0) { raise(SIGSTOP); execv(argv[1], argv + 1); _exit(69); }
    int status = 0;
    pid_t waited;
    do { waited = waitpid(child, &status, WUNTRACED); } while (waited < 0 && errno == EINTR);
    if (waited != child) {
        int saved = errno;
        /* ECHILD means no owned child remains; never signal a possibly reused PID. */
        if (saved != ECHILD) {
            kill(child, SIGKILL);
            while (waitpid(child, &status, 0) < 0 && errno == EINTR) {}
        }
        errno = saved;
        perror("startup child wait");
        return 69;
    }
    /* An exit was already reaped by waitpid; do not signal that PID again. */
    if (!WIFSTOPPED(status) || WSTOPSIG(status) != SIGSTOP) return 69;
    printf("BEFORE_EXEC\t%d\n", child); fflush(stdout);
    for (;;) pause();
}
