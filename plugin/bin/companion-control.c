#define _DARWIN_C_SOURCE
#define _POSIX_C_SOURCE 200809L
#include <sys/types.h>
#include <sys/stat.h>
#include <sys/file.h>
#include <dirent.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <signal.h>
#ifdef __APPLE__
#include <libproc.h>
#endif

#ifdef COMPANION_CONTROL_FIXTURE
static ino_t foreign_inode;
#endif
static int owned(const struct stat *st) {
#ifdef COMPANION_CONTROL_FIXTURE
    if (foreign_inode && st->st_ino == foreign_inode) return 0;
#endif
    return st->st_uid == getuid();
}

/* Descriptor-only user writes and process metadata. No argv/environment probes. */
static int owned_dir(int fd, int final) {
    struct stat st;
    return fstat(fd, &st) == 0 && S_ISDIR(st.st_mode) &&
        (owned(&st) || (!final && st.st_uid == 0));
}
static int directory(const char *path, int create) {
    if (!path || path[0] != '/' || strlen(path) >= PATH_MAX) return -1;
    char copy[PATH_MAX]; strcpy(copy, path);
    int fd = open("/", O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    if (fd < 0) return -1;
    char *save = NULL, *part = strtok_r(copy, "/", &save);
    while (part) {
        if (!strcmp(part, ".") || !strcmp(part, "..")) { close(fd); return -1; }
        int next = openat(fd, part, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
        if (next < 0 && errno == ENOENT && create && owned_dir(fd, 1)) {
            if (mkdirat(fd, part, 0700) == 0 || errno == EEXIST)
                next = openat(fd, part, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
        }
        close(fd); fd = next;
        if (fd < 0 || !owned_dir(fd, 0)) { if (fd >= 0) close(fd); return -1; }
        part = strtok_r(NULL, "/", &save);
    }
    if (create && !owned_dir(fd, 1)) { close(fd); return -1; }
    return fd;
}
static int regular(const struct stat *st) {
    return S_ISREG(st->st_mode) && owned(st) && st->st_nlink == 1;
}
static int leaf(int fd, const char *name, struct stat *st) {
    if (strchr(name, '/') || !strcmp(name, ".") || !strcmp(name, "..")) return -1;
    if (fstatat(fd, name, st, AT_SYMLINK_NOFOLLOW) == 0) return regular(st) ? 1 : -1;
    return errno == ENOENT ? 0 : -1;
}
static int bounded_read(int fd, const char *name, char *out, size_t cap) {
    int file = openat(fd, name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK);
    if (file < 0) return -1;
    struct stat st;
    if (fstat(file, &st) != 0 || !regular(&st) || st.st_size < 0 || (uint64_t)st.st_size >= cap) {
        close(file); return -1;
    }
    size_t size = 0;
    while (size < cap - 1) {
        ssize_t n = read(file, out + size, cap - 1 - size);
        if (n < 0 && errno == EINTR) continue;
        if (n < 0) { close(file); return -1; }
        if (!n) break;
        size += (size_t)n;
    }
    char extra; ssize_t n = read(file, &extra, 1); close(file);
    if (n != 0 || memchr(out, 0, size)) return -1;
    out[size] = 0; return (int)size;
}
/* A writer stopped between its temporary and the rename (the plugin's time limit, a session
   closing) leaves .companion-<pid>-<n> behind; a later write removes those whose writer is gone. */
static void sweep_temporaries(int fd) {
    int copy = dup(fd); if (copy < 0) return;
    DIR *dir = fdopendir(copy); if (!dir) { close(copy); return; }
    rewinddir(dir); /* the copy shares fd's position, which an earlier sweep left at the end */
    struct dirent *entry; struct stat st;
    while ((entry = readdir(dir))) {
        long pid; unsigned n; char expected[96];
        if (sscanf(entry->d_name, ".companion-%9ld-%3u", &pid, &n) != 2 || pid <= 0 || pid == (long)getpid()) continue;
        snprintf(expected, sizeof expected, ".companion-%ld-%u", pid, n);
        if (strcmp(expected, entry->d_name) || kill((pid_t)pid, 0) == 0 || errno != ESRCH) continue;
        if (leaf(fd, entry->d_name, &st) == 1) unlinkat(fd, entry->d_name, 0);
    }
    closedir(dir);
}
static int replace_bytes(int fd, const char *name, const char *data, size_t count) {
    struct stat previous, current;
    int exists = leaf(fd, name, &previous);
    if (exists < 0) return 1;
    sweep_temporaries(fd);
    char temporary[96]; int file = -1;
    for (unsigned i = 0; i < 128 && file < 0; i++) {
        snprintf(temporary, sizeof temporary, ".companion-%ld-%u", (long)getpid(), i);
        file = openat(fd, temporary, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
        if (file < 0 && errno != EEXIST) return 1;
    }
    if (file < 0) return 1;
    int result = 1;
    struct stat staged;
    if (fstat(file, &staged) != 0 || !regular(&staged)) { close(file); return 1; }
    size_t total = 0;
    while (total < count) {
        ssize_t n = write(file, data + total, count - total);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) goto done;
        total += (size_t)n;
    }
    if (fsync(file) != 0 || fstat(file, &current) != 0 || !regular(&current) ||
        leaf(fd, temporary, &current) != 1 || current.st_dev != staged.st_dev || current.st_ino != staged.st_ino) goto done;
    int now = leaf(fd, name, &current);
    if (now != exists || (now == 1 && (previous.st_dev != current.st_dev || previous.st_ino != current.st_ino))) goto done;
    if (renameat(fd, temporary, fd, name) != 0) goto done;
    result = 0;
done:
    if (leaf(fd, temporary, &current) == 1 && current.st_dev == staged.st_dev && current.st_ino == staged.st_ino) unlinkat(fd, temporary, 0);
    close(file); return result;
}

static int input(char *data, size_t cap) {
    size_t n = 0;
    while (n < cap) {
        ssize_t got = read(STDIN_FILENO, data + n, cap - n);
        if (got < 0 && errno == EINTR) continue;
        if (got < 0) return -1;
        if (!got) return (int)n;
        n += (size_t)got;
    }
    char extra;
    return read(STDIN_FILENO, &extra, 1) == 0 ? (int)n : -1;
}
static int atomic_write(int fd, const char *name, size_t cap) {
    char *data = malloc(cap); if (!data) return 1;
    int n = input(data, cap);
    int result = n < 0 ? 1 : replace_bytes(fd, name, data, (size_t)n);
    free(data); return result;
}
static int writer_lock(int fd, const char *name) {
    int lock = openat(fd, name, O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK, 0600);
    if (lock < 0 && errno == EEXIST) lock = openat(fd, name, O_RDWR | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK);
    struct stat st;
    if (lock < 0 || fstat(lock, &st) || !regular(&st)) { if (lock >= 0) close(lock); return -1; }
    for (unsigned i = 0; i < 100; i++) {
        if (flock(lock, LOCK_EX | LOCK_NB) == 0) return lock;
        if (errno != EWOULDBLOCK && errno != EINTR) break;
        usleep(10000);
    }
    close(lock); return -1;
}
static int diagnostic_append(int fd) {
    struct stat st;
    int enabled = leaf(fd, "diagnostics", &st);
    if (enabled == 0) return 0;
    if (enabled < 0) return 1;
    /* Read and check the record before locking: a writer still sending must not hold the lock. */
    char record[4096]; int n = input(record, sizeof record);
    if (n <= 0 || record[n-1] != '\n' || memchr(record, 0, (size_t)n) || memchr(record, '\n', (size_t)n-1)) return 0;
    int lock = writer_lock(fd, ".shared-diagnostics-lock"); if (lock < 0) return 1;
    int result = 1;
    if (leaf(fd, "diagnostics", &st) != 1) goto done;
    char *data = malloc(204801 + sizeof record); if (!data) goto done;
    int existing = leaf(fd, "diagnostics.log", &st), bytes = 0;
    if (existing < 0) { free(data); goto done; }
    if (existing == 1) bytes = bounded_read(fd, "diagnostics.log", data, 204801);
    if (bytes < 0) { free(data); goto done; }
    if (bytes + n > 204800) {
        if (replace_bytes(fd, "diagnostics.log.1", data, (size_t)bytes)) { free(data); goto done; }
        bytes = 0;
    }
    memcpy(data + bytes, record, (size_t)n);
    if (leaf(fd, "diagnostics", &st) == 1) result = replace_bytes(fd, "diagnostics.log", data, (size_t)(bytes + n));
    free(data);
done:
    close(lock); return result;
}

typedef struct { pid_t pid; uid_t uid; uint64_t seconds, micros; char executable[PATH_MAX]; } Identity;
static int identity(pid_t pid, Identity *out) {
#ifdef COMPANION_CONTROL_FIXTURE
    /* Test input is a file explicitly passed by the fixture, never process argv/env. */
    extern const char *fixture_path;
    FILE *f = fopen(fixture_path, "r"); if (!f) return 0;
    static unsigned calls[65];
    unsigned attempt = pid > 0 && pid < 65 ? ++calls[pid] : 1;
    Identity row; int found = 0;
    char line[PATH_MAX + 128];
    while (fgets(line, sizeof line, f)) {
        int offset = 0;
        if (sscanf(line, "%d %u %llu %llu %n", &row.pid, &row.uid,
            (unsigned long long *)&row.seconds, (unsigned long long *)&row.micros, &offset) != 4 ||
            offset <= 0 || strlen(line + offset) >= sizeof row.executable) continue;
        strcpy(row.executable, line + offset);
        row.executable[strcspn(row.executable, "\n")] = 0;
        if (row.pid == pid) { *out = row; found = 1; if (attempt == 1) break; }
    }
    fclose(f); return found;
#elif defined(__APPLE__)
    struct proc_bsdinfo info;
    if (proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, sizeof info) != sizeof info ||
        proc_pidpath(pid, out->executable, sizeof out->executable) <= 0) return 0;
    out->pid = pid; out->uid = info.pbi_uid;
    out->seconds = info.pbi_start_tvsec; out->micros = info.pbi_start_tvusec;
    return out->seconds != 0;
#else
    (void)pid; (void)out; return 0;
#endif
}
#ifdef COMPANION_CONTROL_FIXTURE
const char *fixture_path;
#endif
static int same_identity(const Identity *a, const Identity *b) {
    return a->pid == b->pid && a->uid == b->uid && a->seconds == b->seconds &&
        a->micros == b->micros && !strcmp(a->executable, b->executable);
}
static int process_command(int stop, const char *path, const char *old_path) {
    pid_t pids[8192]; int count = 0;
#ifdef COMPANION_CONTROL_FIXTURE
    for (pid_t p = 1; p <= 64; p++) pids[count++] = p;
#elif defined(__APPLE__)
    count = proc_listallpids(pids, sizeof pids);
    if (count < 0 || count >= (int)(sizeof pids / sizeof pids[0])) return 1;
#else
    return 1;
#endif
    for (int i = 0; i < count; i++) {
        Identity before, after;
        if (!identity(pids[i], &before) || before.uid != getuid() ||
            (strcmp(before.executable, path) && strcmp(before.executable, old_path))) continue;
        if (!stop) { printf("%d\n", before.pid); continue; }
        if (!identity(before.pid, &after) || !same_identity(&before, &after)) continue;
#ifdef COMPANION_CONTROL_FIXTURE
        printf("SIGNAL\t%d\n", before.pid);
#else
        if (kill(before.pid, SIGTERM) != 0 && errno != ESRCH) return 1;
#endif
    }
    return 0;
}
static int canonical(const char *base, const char *target, char *out) {
    char combined[PATH_MAX];
    if (target[0] == '/') { if (strlen(target) >= sizeof combined) return 0; strcpy(combined, target); }
    else if (snprintf(combined, sizeof combined, "%s/%s", base, target) >= (int)sizeof combined) return 0;
    char *parts[PATH_MAX / 2], *save = NULL; int count = 0;
    for (char *p = strtok_r(combined, "/", &save); p; p = strtok_r(NULL, "/", &save)) {
        if (!strcmp(p, ".")) continue;
        if (!strcmp(p, "..")) { if (!count) return 0; count--; } else parts[count++] = p;
    }
    out[0] = 0;
    for (int i = 0; i < count; i++) { strcat(out, "/"); strcat(out, parts[i]); }
    return count > 0;
}
static void strip_newline(char *text) { size_t n = strlen(text); if (n && text[n-1] == '\n') text[--n] = 0; if (n && text[n-1] == '\r') text[--n] = 0; }
static int branch(const char *cwd) {
    char folder[PATH_MAX]; if (!canonical("/", cwd, folder)) return 1;
    for (int depth = 0; depth < 8; depth++) {
        int repo = directory(folder, 0); if (repo < 0) return 1;
        struct stat marker;
        int found = fstatat(repo, ".git", &marker, AT_SYMLINK_NOFOLLOW);
        if (found == 0) {
            int git = -1; char location[PATH_MAX];
            if (S_ISDIR(marker.st_mode) && marker.st_uid == getuid())
                git = openat(repo, ".git", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
            else if (regular(&marker)) {
                char pointer[4096];
                if (bounded_read(repo, ".git", pointer, sizeof pointer) < 0) { close(repo); return 1; }
                strip_newline(pointer);
                if (strncmp(pointer, "gitdir: ", 8) || !canonical(folder, pointer + 8, location)) { close(repo); return 1; }
                size_t prefix = strlen(folder);
                if (!strncmp(location, folder, prefix) && location[prefix] == '/') git = directory(location, 0);
                else {
                    /* External pointers are accepted only with registered worktree backlinks. */
                    char *worktree = strstr(location, "/.git/worktrees/");
                    if (!worktree || !worktree[16] || strchr(worktree + 16, '/')) { close(repo); return 1; }
                    git = directory(location, 0);
                    char backlink[4096], common[4096], expected[PATH_MAX], actual[PATH_MAX];
                    snprintf(expected, sizeof expected, "%s/.git", folder);
                    if (git < 0 || !owned_dir(git, 1) || bounded_read(git, "gitdir", backlink, sizeof backlink) < 0 ||
                        bounded_read(git, "commondir", common, sizeof common) < 0) { if (git >= 0) close(git); close(repo); return 1; }
                    strip_newline(backlink); strip_newline(common);
                    if (strcmp(backlink, expected) || !canonical(location, common, actual)) { close(git); close(repo); return 1; }
                    *worktree = 0; char expected_common[PATH_MAX];
                    if (snprintf(expected_common, sizeof expected_common, "%s/.git", location) >= (int)sizeof expected_common || strcmp(actual, expected_common)) { close(git); close(repo); return 1; }
                    int base = directory(actual, 0); if (base < 0 || !owned_dir(base, 1)) { if (base >= 0) close(base); close(git); close(repo); return 1; } close(base);
                }
            }
            close(repo);
            if (git < 0 || !owned_dir(git, 1)) { if (git >= 0) close(git); return 1; }
            char head[4096]; int n = bounded_read(git, "HEAD", head, sizeof head); close(git);
            if (n < 0 || strncmp(head, "ref: refs/heads/", 16)) return 1;
            strip_newline(head); const char *name = head + 16;
            if (!*name || strlen(name) > 512 || strstr(name, "..") || strchr(name, '\\')) return 1;
            for (const unsigned char *p = (const unsigned char *)name; *p; p++) if (*p <= 32 || *p == 127) return 1;
            printf("%s\n", name); return 0;
        }
        int error = errno; close(repo); if (error != ENOENT) return 1;
        char *slash = strrchr(folder, '/'); if (!slash || slash == folder) break; *slash = 0;
    }
    return 1;
}
int main(int argc, char **argv) {
#ifdef COMPANION_CONTROL_FIXTURE
    if (argc > 2 && !strcmp(argv[1], "foreign")) { foreign_inode = (ino_t)strtoull(argv[2], NULL, 10); argc -= 2; argv += 2; }
    if (argc > 2 && !strcmp(argv[1], "fixture")) { fixture_path = argv[2]; argc -= 2; argv += 2; }
#endif
    if (argc == 3 && !strcmp(argv[1], "branch")) return branch(argv[2]);
    if (argc == 3 && (!strcmp(argv[1], "ensure-dir") || !strcmp(argv[1], "private-dir"))) {
        int fd = directory(argv[2], 1); if (fd < 0) return 1;
        int r = !strcmp(argv[1], "private-dir") ? fchmod(fd, 0700) : 0; close(fd); return r != 0;
    }
    if (argc == 4 && !strcmp(argv[1], "write-agent")) {
        if (strcmp(argv[3], "io.github.ninondev.coco-companion.plist")) return 1;
        int fd = directory(argv[2], 1); if (fd < 0) return 1;
        int r = atomic_write(fd, argv[3], 65536); close(fd); return r;
    }
    if (argc == 4 && !strcmp(argv[1], "write-shared")) {
        if (strcmp(argv[3], "view.json")) return 1;
        int fd = directory(argv[2], 0); if (fd < 0 || !owned_dir(fd, 1)) { if (fd >= 0) close(fd); return 1; }
        /* Read the view before locking, as diagnostic_append does: a writer still sending must not hold the lock (U9). */
        char *data = malloc(1048576); int n = data ? input(data, 1048576) : -1;
        int lock = n < 0 ? -1 : writer_lock(fd, ".shared-view-lock");
        int r = lock < 0 ? 1 : replace_bytes(fd, argv[3], data, (size_t)n);
        if (lock >= 0) close(lock); free(data); close(fd); return r;
    }
    if (argc == 3 && !strcmp(argv[1], "diagnostic-append")) {
        int fd = directory(argv[2], 0); if (fd < 0) return errno == ENOENT ? 0 : 1;
        int r = owned_dir(fd, 1) ? diagnostic_append(fd) : 1; close(fd); return r;
    }
    if (argc == 4 && (!strcmp(argv[1], "list") || !strcmp(argv[1], "stop"))) return process_command(!strcmp(argv[1], "stop"), argv[2], argv[3]);
    return 64;
}
