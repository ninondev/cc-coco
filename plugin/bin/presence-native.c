/* One event-driven follower or one short transaction. No subprocesses or polling. */
#define _DARWIN_C_SOURCE
#include <sys/event.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <libproc.h>
#include <fcntl.h>
#include <unistd.h>
#include <signal.h>
#include <time.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <limits.h>
#include <pthread.h>
#include <stdint.h>
#include <poll.h>
#define LIMIT 262144
static int queue, lockfd = -1, snapshot_stage_fd = -1, journal_stage_fd = -1, fifo_fd = -1, work_fd = -1;
#ifdef PRESENCE_SECURITY_FIXTURE
static ino_t fixture_foreign_inode;
static const char *fixture_stage_link;
#endif
static pid_t host;
static char work[PATH_MAX], fifo[PATH_MAX], marker[PATH_MAX], registration[PATH_MAX];
static int secure_unlink(const char *name, int directory);
static int secure_open(const char *name, int flags, int create);
static int secure_directory(const char *folder, int create);
static int secure_rename(const char *from, const char *to, int source_fd);
static int secure_unlink_owned(const char *name, int source_fd, int directory);
static void write_all(int fd, const char *text, size_t bytes);
static void cleanup(void) {
    if (lockfd >= 0) { flock(lockfd, LOCK_UN); futimens(lockfd, NULL); close(lockfd); lockfd = -1; }
    if (*registration) secure_unlink(registration, 0);
    if (*fifo && fifo_fd >= 0) secure_unlink_owned(fifo, fifo_fd, 0);
    if (*work) { char name[PATH_MAX]; snprintf(name, sizeof(name), "%s/snapshot", work); if (snapshot_stage_fd >= 0) secure_unlink_owned(name, snapshot_stage_fd, 0); snprintf(name, sizeof(name), "%s/journal", work); if (journal_stage_fd >= 0) secure_unlink_owned(name, journal_stage_fd, 0); if (work_fd >= 0) secure_unlink_owned(work, work_fd, 1); }
    if (snapshot_stage_fd >= 0) close(snapshot_stage_fd); snapshot_stage_fd = -1;
    if (journal_stage_fd >= 0) close(journal_stage_fd); journal_stage_fd = -1;
    if (fifo_fd >= 0) close(fifo_fd); fifo_fd = -1;
    if (work_fd >= 0) close(work_fd); work_fd = -1;
}
static void interrupted(int sig) { (void)sig; cleanup(); _exit(0); }
static void die(const char *what) { perror(what); exit(69); }
static void path(char *out, const char *folder, const char *name) {
    size_t first = strlen(folder), second = strlen(name);
    if (first + second + 2 > PATH_MAX) { errno = ENAMETOOLONG; die("presence path"); }
    memcpy(out, folder, first); out[first] = '/'; memcpy(out + first + 1, name, second + 1);
}
static void event(uintptr_t ident, short filter, unsigned int flags) {
    struct kevent change; EV_SET(&change, ident, filter, EV_ADD | EV_ENABLE | EV_CLEAR, flags, 0, NULL);
    if (kevent(queue, &change, 1, NULL, 0, NULL) < 0) die("presence event");
}
static void parent_alive(void) { if (getppid() != host || kill(host, 0) < 0) exit(0); }
static void wait_events(int descriptor) {
    struct kevent observed[16]; int count;
    do { count = kevent(descriptor, NULL, 0, observed, 16, NULL); } while (count < 0 && errno == EINTR);
    if (count < 0) die("presence wait");
    for (int n = 0; n < count; n++) {
        if (observed[n].filter == EVFILT_PROC && observed[n].ident == (uintptr_t)host) exit(0);
        if (observed[n].flags & EV_ERROR && observed[n].data && observed[n].data != ESRCH) { errno = (int)observed[n].data; die("presence event delivery"); }
    }
    parent_alive();
}
static void wait_event(void) { wait_events(queue); }
/* Each component is opened without following links. Only the final directory
   and directories we create must be ours; system-owned ancestors are allowed. */
static int secure_directory(const char *folder, int create) {
    if (!folder || folder[0] != '/' || strlen(folder) >= PATH_MAX) { errno = EINVAL; return -1; }
    char copy[PATH_MAX]; strcpy(copy, folder);
    int fd = open("/", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (fd < 0) return -1;
    char *save = NULL, *part = strtok_r(copy, "/", &save);
    while (part) {
        if (!strcmp(part, ".") || !strcmp(part, "..")) { close(fd); errno = EINVAL; return -1; }
        char *next = strtok_r(NULL, "/", &save); int made = 0;
        int child = openat(fd, part, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
        if (child < 0 && errno == ENOENT && create) {
            if (mkdirat(fd, part, 0700) != 0) { close(fd); return -1; }
            made = 1; child = openat(fd, part, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
        }
        struct stat info;
        if (child < 0 || fstat(child, &info) != 0 || !S_ISDIR(info.st_mode)
            || (info.st_uid != getuid() && (made || !next || info.st_uid != 0))) {
            if (child >= 0) close(child); close(fd); errno = EPERM; return -1;
        }
        close(fd); fd = child; part = next;
    }
    return fd;
}
static int secure_parent(const char *name, char leaf[PATH_MAX]) {
    char folder[PATH_MAX]; if (!name || name[0] != '/' || strlen(name) >= PATH_MAX) { errno = EINVAL; return -1; }
    strcpy(folder, name); char *slash = strrchr(folder, '/');
    if (!slash || !slash[1]) { errno = EINVAL; return -1; }
    strcpy(leaf, slash + 1); if (!strcmp(leaf, ".") || !strcmp(leaf, "..")) { errno = EINVAL; return -1; }
    if (slash == folder) slash[1] = 0; else *slash = 0;
    return secure_directory(folder, 0);
}
static int owned_file(const struct stat *info) {
#ifdef PRESENCE_SECURITY_FIXTURE
    if (fixture_foreign_inode && info->st_ino == fixture_foreign_inode) { errno = EPERM; return 0; }
#endif
    if (!S_ISREG(info->st_mode) || info->st_uid != getuid() || info->st_nlink != 1) { errno = EPERM; return 0; }
    return 1;
}
static int owned_fifo(const struct stat *info) {
#ifdef PRESENCE_SECURITY_FIXTURE
    if (fixture_foreign_inode && info->st_ino == fixture_foreign_inode) return 0;
#endif
    return S_ISFIFO(info->st_mode) && info->st_uid == getuid() && info->st_nlink == 1;
}
static int secure_open(const char *name, int flags, int create) {
    char leaf[PATH_MAX]; int parent = secure_parent(name, leaf); if (parent < 0) return -1;
    int fd = openat(parent, leaf, flags | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC, 0600);
    if (fd < 0 && errno == ENOENT && create) fd = openat(parent, leaf, flags | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC | O_CREAT | O_EXCL, 0600);
    struct stat info;
    if (fd >= 0 && (fstat(fd, &info) != 0 || !owned_file(&info))) { close(fd); fd = -1; errno = EPERM; }
    close(parent); return fd;
}
static int secure_existing(int parent, const char *leaf) {
    struct stat info;
    if (fstatat(parent, leaf, &info, AT_SYMLINK_NOFOLLOW) < 0) return errno == ENOENT;
    return owned_file(&info);
}
static int secure_rename(const char *from, const char *to, int source_fd) {
    char src[PATH_MAX], dst[PATH_MAX]; int a = secure_parent(from, src), b = secure_parent(to, dst), result = -1;
    struct stat original, current;
    if (a >= 0 && b >= 0 && source_fd >= 0 && fsync(source_fd) == 0 && fstat(source_fd, &original) == 0 && owned_file(&original)
        && fstatat(a, src, &current, AT_SYMLINK_NOFOLLOW) == 0 && owned_file(&current)
        && current.st_dev == original.st_dev && current.st_ino == original.st_ino && secure_existing(b, dst)) result = renameat(a, src, b, dst);
    if (a >= 0) close(a); if (b >= 0) close(b); return result;
}
static int secure_unlink_owned(const char *name, int source_fd, int directory) {
    char leaf[PATH_MAX]; int parent = secure_parent(name, leaf); if (parent < 0 || source_fd < 0) { if (parent >= 0) close(parent); return -1; }
    struct stat original, current; int result = -1;
    if (fstat(source_fd, &original) == 0 && original.st_uid == getuid()
        && fstatat(parent, leaf, &current, AT_SYMLINK_NOFOLLOW) == 0 && current.st_uid == getuid()
        && current.st_dev == original.st_dev && current.st_ino == original.st_ino
        && (directory ? S_ISDIR(current.st_mode) && S_ISDIR(original.st_mode)
            : current.st_nlink == 1 && original.st_nlink == 1 && ((S_ISREG(current.st_mode) && S_ISREG(original.st_mode)) || (S_ISFIFO(current.st_mode) && S_ISFIFO(original.st_mode)))))
        result = unlinkat(parent, leaf, directory ? AT_REMOVEDIR : 0);
    close(parent); return result;
}
static int secure_unlink(const char *name, int directory) {
    char leaf[PATH_MAX]; int parent = secure_parent(name, leaf); if (parent < 0) return -1;
    struct stat info; int result = -1;
    if (fstatat(parent, leaf, &info, AT_SYMLINK_NOFOLLOW) == 0 && info.st_uid == getuid()
        && (directory ? S_ISDIR(info.st_mode) : ((S_ISREG(info.st_mode) || S_ISFIFO(info.st_mode)) && info.st_nlink == 1)))
        result = unlinkat(parent, leaf, directory ? AT_REMOVEDIR : 0);
    close(parent); return result;
}
static void create_folder(const char *folder) { int fd = secure_directory(folder, 1); if (fd < 0) die("presence folder"); close(fd); }
static int create_file(const char *name) { int fd = secure_open(name, O_RDWR, 1); if (fd < 0) die("presence file"); return fd; }
static int identity(pid_t pid, struct proc_bsdinfo *info) {
    return pid > 0 && proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, info, sizeof(*info)) == sizeof(*info) && info->pbi_status != 5;
}
static void birth(const struct proc_bsdinfo *info, char *out) {
    snprintf(out, 128, "darwin:%llu:%llu", info->pbi_start_tvsec, info->pbi_start_tvusec);
}
static int metadata(pid_t pid, struct proc_bsdinfo *info, char executable[PROC_PIDPATHINFO_MAXSIZE], char stamp[128]) {
    if (!identity(pid, info) || info->pbi_uid != getuid() || proc_pidpath(pid, executable, PROC_PIDPATHINFO_MAXSIZE) <= 0) return 0;
    if (strpbrk(executable, "\t\r\n")) return 0;
    struct proc_bsdinfo again;
    if (!identity(pid, &again) || again.pbi_uid != info->pbi_uid || again.pbi_ppid != info->pbi_ppid || again.pbi_start_tvsec != info->pbi_start_tvsec || again.pbi_start_tvusec != info->pbi_start_tvusec) return 0;
    birth(info, stamp); return 1;
}
static int registered(const char *folder, const char *token, pid_t pid, const struct proc_bsdinfo *info, const char *stamp, const char *executable) {
    char leaf[192], name[PATH_MAX], expected[8192], present[8192];
    snprintf(leaf, sizeof(leaf), ".presence-registration-%s", token); path(name, folder, leaf);
    int fd = secure_open(name, O_RDONLY, 0); if (fd < 0) return 0;
    struct stat file; ssize_t count = -1;
    if (fstat(fd, &file) == 0 && file.st_size > 0 && file.st_size < (off_t)sizeof(present)) count = read(fd, present, sizeof(present));
    close(fd); int bytes = snprintf(expected, sizeof(expected), "%d\t%u\t%s\t%u\t%s\t%s\n", pid, info->pbi_ppid, stamp, info->pbi_uid, executable, token);
    return count == bytes && bytes > 0 && bytes < (int)sizeof(expected) && !memcmp(expected, present, (size_t)bytes);
}
static void inventory(const char *folder, const char *pids) {
    const char *position = pids; int total = 0;
    while (*position) {
        if (++total > 2048) exit(64);
        char *end; long requested = strtol(position, &end, 10);
        if (end == position || requested < 1 || requested > INT_MAX) exit(64);
        char token[65] = "";
        if (*end == ':') {
            const char *start = ++end; size_t length = 0;
            while (*end && *end != ',') { if (length >= 64 || !((*end >= 'a' && *end <= 'z') || (*end >= 'A' && *end <= 'Z') || (*end >= '0' && *end <= '9') || *end == '_' || *end == '-')) exit(64); token[length++] = *end++; }
            if (end == start) exit(64); token[length] = 0;
        }
        if (*end && *end != ',') exit(64);
        struct proc_bsdinfo info; char executable[PROC_PIDPATHINFO_MAXSIZE], stamp[128];
        if (metadata((pid_t)requested, &info, executable, stamp)) {
            int bound = *token && registered(folder, token, (pid_t)requested, &info, stamp, executable);
            printf("PID\t%ld\t%u\t%s\t%u\t%s\t%s\n", requested, info.pbi_ppid, stamp, info.pbi_uid, executable, bound ? token : "");
        }
        position = *end ? end + 1 : end;
    }
}
static void boundary(const char *stage) {
#ifdef PRESENCE_TEST_BOUNDARIES
    const char *stop = getenv("COCO_TEST_BOUNDARY");
    if (stop && !strcmp(stop, stage)) { printf("BOUNDARY\t%s\t%d\n", stage, getpid()); raise(SIGSTOP); }
#else
    (void)stage;
#endif
}
static void *parent_watch(void *unused) {
    (void)unused;
    int fd = kqueue(); if (fd < 0) _exit(69);
    struct kevent change, observed;
    EV_SET(&change, host, EVFILT_PROC, EV_ADD | EV_ENABLE | EV_ONESHOT, NOTE_EXIT, 0, NULL);
    if (kevent(fd, &change, 1, NULL, 0, NULL) < 0 || getppid() != host) _exit(0);
    int count; do { count = kevent(fd, NULL, 0, &observed, 1, NULL); } while (count < 0 && errno == EINTR);
    _exit(count < 0 ? 69 : 0); // Every descriptor, including flock, is released by the kernel.
}
static void acquire(const char *folder, const char *token) {
    char name[PATH_MAX]; path(name, folder, ".presence-flock"); lockfd = create_file(name);
    pthread_t parent_thread; if (pthread_create(&parent_thread, NULL, parent_watch, NULL) != 0) die("presence parent watch");
    pthread_detach(parent_thread); parent_alive(); boundary("before-lock");
    int code;
#ifdef PRESENCE_TEST_BOUNDARIES
    code = flock(lockfd, LOCK_EX | LOCK_NB);
    if (code < 0) { printf("CONTENDING\t%d\n", getpid()); do { code = flock(lockfd, LOCK_EX); } while (code < 0 && errno == EINTR); }
#else
    do { code = flock(lockfd, LOCK_EX); } while (code < 0 && errno == EINTR);
#endif
    if (code < 0) die("presence lock"); parent_alive(); boundary("lock-acquired");
    char owner[160]; int length = snprintf(owner, sizeof(owner), "%d\n%s\n", getpid(), token);
    char record[PATH_MAX], temporary[PATH_MAX], leaf[128]; path(record, folder, ".presence-flock-owner");
    snprintf(leaf, sizeof(leaf), ".presence-owner-stage-%d", getpid()); path(temporary, folder, leaf);
    int ownerfd = secure_open(temporary, O_WRONLY | O_CREAT | O_EXCL, 0); if (ownerfd < 0) die("presence lock record");
    write_all(ownerfd, owner, (size_t)length);
    int result = secure_rename(temporary, record, ownerfd); secure_unlink_owned(temporary, ownerfd, 0); close(ownerfd);
    if (result != 0) die("presence lock record"); boundary("owner-written");
}
static char *read_line(int fd) {
    static char bytes[8192]; static size_t offset, available;
    size_t capacity = 4096; char *result = malloc(capacity); if (!result) die("presence allocation"); size_t used = 0;
    for (;;) {
        if (offset == available) {
            ssize_t count = read(fd, bytes, sizeof(bytes));
            if (count < 0 && (errno == EAGAIN || errno == EWOULDBLOCK || errno == EINTR)) { wait_event(); continue; }
            if (count <= 0) { free(result); die("presence FIFO"); }
            offset = 0; available = (size_t)count;
        }
        char byte = bytes[offset++];
        if (byte == '\n') { result[used] = 0; return result; }
        if (used >= LIMIT - 1) { free(result); exit(69); }
        if (used + 1 >= capacity) {
            size_t next = capacity * 2; if (next > LIMIT) next = LIMIT;
            char *larger = realloc(result, next); if (!larger) { free(result); die("presence allocation"); }
            result = larger; capacity = next;
        }
        result[used++] = byte;
    }
}
static void copy_output(const char *name, const char *prefix) {
    int fd = secure_open(name, O_RDONLY, 0); if (fd < 0) return; struct stat info;
    if (fstat(fd, &info) != 0 || info.st_size < 0 || info.st_size > LIMIT) { close(fd); return; }
    size_t budget = (size_t)info.st_size, used = 0; char *bytes = malloc(budget + 1); if (!bytes) { close(fd); die("presence copy allocation"); }
    while (used < budget) { ssize_t count = read(fd, bytes + used, budget - used); if (count < 0 && errno == EINTR) continue; if (count <= 0) break; used += (size_t)count; }
    close(fd);
    for (size_t at = 0; at < used;) {
        size_t end = at; while (end < used && bytes[end] != '\n') end++;
        printf("%s", prefix); fwrite(bytes + at, 1, end - at, stdout); putchar('\n'); at = end + 1;
    }
    free(bytes);
}
static void write_all(int fd, const char *text, size_t bytes) {
    int output_queue = -1;
    while (bytes) {
        ssize_t count = write(fd, text, bytes);
        if (count < 0 && errno == EINTR) continue;
        if (count < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
            if (output_queue < 0) {
                output_queue = kqueue(); if (output_queue < 0) die("presence output queue");
                struct kevent changes[2];
                EV_SET(&changes[0], fd, EVFILT_WRITE, EV_ADD | EV_ENABLE | EV_CLEAR, 0, 0, NULL);
                EV_SET(&changes[1], host, EVFILT_PROC, EV_ADD | EV_ENABLE | EV_ONESHOT, NOTE_EXIT, 0, NULL);
                if (kevent(output_queue, changes, 2, NULL, 0, NULL) < 0) die("presence output watch"); parent_alive();
            }
            // Vnode changes remain pending on the normal queue while output stalls.
            wait_events(output_queue); continue;
        }
        if (count <= 0) die("presence write"); text += count; bytes -= count;
    }
    if (output_queue >= 0) close(output_queue);
}
static int store_file(const char *name, const char *line) { int fd = secure_open(name, O_WRONLY | O_EXCL | O_CREAT, 0); if (fd < 0) die("presence temporary"); write_all(fd, line, strlen(line)); write_all(fd, "\n", 1); return fd; }
static void publish_file(const char *target, const char *data, size_t bytes, int exclusive) {
    char leaf[PATH_MAX], temporary[128]; int parent = secure_parent(target, leaf); if (parent < 0) die("presence publish parent");
    struct stat previous, staged, current, destination;
    int existed = fstatat(parent, leaf, &previous, AT_SYMLINK_NOFOLLOW) == 0;
    if ((existed && !owned_file(&previous)) || (!existed && errno != ENOENT)) { close(parent); die("presence publish destination"); }
    static unsigned counter; snprintf(temporary, sizeof(temporary), ".presence-stage-%d-%u", getpid(), ++counter);
    int fd = openat(parent, temporary, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
    if (fd < 0) { close(parent); die("presence publish stage"); }
    if (fstat(fd, &staged) != 0 || !owned_file(&staged)) die("presence publish stage");
    write_all(fd, data, bytes); if (fsync(fd) != 0) die("presence publish sync");
#ifdef PRESENCE_SECURITY_FIXTURE
    if (fixture_stage_link) { unlinkat(parent, temporary, 0); if (symlinkat(fixture_stage_link, parent, temporary) != 0) die("fixture stage link"); }
#endif
    int stage_ok = fstat(fd, &current) == 0 && owned_file(&current) && current.st_dev == staged.st_dev && current.st_ino == staged.st_ino
        && fstatat(parent, temporary, &current, AT_SYMLINK_NOFOLLOW) == 0 && owned_file(&current) && current.st_dev == staged.st_dev && current.st_ino == staged.st_ino;
    int now = fstatat(parent, leaf, &destination, AT_SYMLINK_NOFOLLOW) == 0, missing = !now && errno == ENOENT;
    int destination_ok = now == existed && (now ? owned_file(&destination) && destination.st_dev == previous.st_dev && destination.st_ino == previous.st_ino : missing);
    int result = -1;
    if (stage_ok && destination_ok) result = exclusive ? renameatx_np(parent, temporary, parent, leaf, RENAME_EXCL) : renameat(parent, temporary, parent, leaf);
    if (result != 0 && fstatat(parent, temporary, &current, AT_SYMLINK_NOFOLLOW) == 0 && owned_file(&current)
        && current.st_dev == staged.st_dev && current.st_ino == staged.st_ino) unlinkat(parent, temporary, 0);
    close(fd); close(parent); if (result != 0) die("presence publish rename");
}
/* The fallback runs before the lock's parent-watch thread exists. Both cwd
   changes use open descriptors; no path component can redirect FIFO creation. */
static int fifo_at(int directory, const char *leaf) {
    if (__builtin_available(macOS 13.0, *)) return mkfifoat(directory, leaf, 0600);
    int original = open(".", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC); if (original < 0) return -1;
    if (fchdir(directory) != 0) { close(original); return -1; }
    int result = mkfifo(leaf, 0600), error = errno;
    if (fchdir(original) != 0) { close(original); die("presence restore directory"); }
    close(original); errno = error; return result;
}
static void transaction(const char *folder, const char *token, const char *remove) {
    char name[PATH_MAX]; snprintf(name, sizeof(name), ".presence-%s", token); path(work, folder, name);
    char workleaf[PATH_MAX]; int parent = secure_parent(work, workleaf); if (parent < 0 || mkdirat(parent, workleaf, 0700) != 0) die("presence work"); close(parent);
    int workfd = secure_directory(work, 0); work_fd = workfd; if (workfd < 0) die("presence work"); path(fifo, work, "commit"); if (fifo_at(workfd, "commit") != 0) die("presence FIFO");
    int input = openat(workfd, "commit", O_RDWR | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC); fifo_fd = input; struct stat input_info; if (input < 0 || fstat(input, &input_info) != 0 || !owned_fifo(&input_info)) die("presence FIFO"); event(input, EVFILT_READ, 0); acquire(folder, token);
    char journal[PATH_MAX], snapshot[PATH_MAX], temporary[PATH_MAX], compact[PATH_MAX];
    path(journal, folder, "presence.jsonl"); path(snapshot, folder, "snapshot.json"); path(temporary, work, "snapshot"); path(compact, work, "journal"); close(create_file(journal));
    printf("PRESENCE\t%d\t%s\t%llu\t%llu\n", host, fifo, (unsigned long long)input_info.st_dev, (unsigned long long)input_info.st_ino); copy_output(snapshot, "STATE\t"); copy_output(journal, "LOG\t"); printf("INSPECT\n"); boundary("inspect-wait");
    char *pids = read_line(input); inventory(folder, pids); free(pids); printf("READY\n"); boundary("commit-wait");
    char *commit = read_line(input); parent_alive();
    if (strcmp(commit, "-")) {
        snapshot_stage_fd = store_file(temporary, commit); boundary("temporary-written"); parent_alive();
        if (secure_rename(temporary, snapshot, snapshot_stage_fd) != 0) die("presence snapshot"); boundary("snapshot-renamed"); parent_alive();
        int previous = secure_open(journal, O_RDONLY, 0); struct stat info;
        if (previous < 0 || fstat(previous, &info) != 0) die("presence journal");
        size_t incoming = strlen(commit) + 1; int rotated = info.st_size < 0 || info.st_size + (off_t)incoming > LIMIT;
        int next = secure_open(compact, O_WRONLY | O_CREAT | O_EXCL, 0); journal_stage_fd = next; if (next < 0) die("presence journal stage");
        if (!rotated) {
            char bytes[8192]; off_t remaining = info.st_size;
            while (remaining > 0) { ssize_t count = read(previous, bytes, remaining > (off_t)sizeof(bytes) ? sizeof(bytes) : (size_t)remaining); if (count < 0 && errno == EINTR) continue; if (count <= 0) die("presence journal read"); write_all(next, bytes, (size_t)count); remaining -= count; }
        }
        close(previous); write_all(next, commit, incoming - 1); write_all(next, "\n", 1); parent_alive();
        if (secure_rename(compact, journal, next) != 0) die("presence journal commit"); boundary(rotated ? "journal-rotated" : "journal-appended");
    }
    free(commit); if (*remove) { snprintf(name, sizeof(name), ".presence-follow-%s.jsonl", remove); path(marker, folder, name); secure_unlink(marker, 0); snprintf(name, sizeof(name), ".presence-deadline-%s.jsonl", remove); path(marker, folder, name); secure_unlink(marker, 0); snprintf(name, sizeof(name), ".presence-registration-%s", remove); path(marker, folder, name); secure_unlink(marker, 0); }
    boundary("before-unlock"); cleanup(); boundary("after-unlock"); printf("COMMITTED\n");
}
typedef struct { const char *name; int fd; off_t offset; dev_t device; ino_t inode; } Watched;
typedef struct { Watched file; uint64_t generation, at; int seen, valid, fired; } Deadline;
static int deadline_integer(const char **position, uint64_t *value) {
    const char *p = *position; uint64_t n = 0;
    if (*p < '0' || *p > '9') return 0;
    do { unsigned digit = (unsigned)(*p++ - '0'); if (n > (INT64_MAX - digit) / 10) return 0; n = n * 10 + digit; } while (*p >= '0' && *p <= '9');
    *position = p; *value = n; return 1;
}
static void deadline_read(Deadline *deadline) {
    if (!*deadline->file.name) return;
    deadline->valid = 0;
    struct stat current;
    if (lstat(deadline->file.name, &current) != 0 || !owned_file(&current)) return;
    Watched *file = &deadline->file;
    if (file->fd < 0 || current.st_dev != file->device || current.st_ino != file->inode) {
        if (file->fd >= 0) close(file->fd);
        file->fd = secure_open(file->name, O_RDONLY | O_NONBLOCK, 0); if (file->fd < 0) return;
        event(file->fd, EVFILT_VNODE, NOTE_WRITE | NOTE_EXTEND | NOTE_DELETE | NOTE_RENAME | NOTE_REVOKE);
        if (fstat(file->fd, &current) != 0) die("presence deadline identity");
        file->device = current.st_dev; file->inode = current.st_ino;
    }
    char line[64]; ssize_t count = pread(file->fd, line, sizeof(line) - 1, 0);
    if (count <= 0 || count >= (ssize_t)sizeof(line) - 1) return;
    line[count] = 0; const char *p = line; uint64_t generation, at;
    if (!deadline_integer(&p, &generation) || *p++ != '\t' || !deadline_integer(&p, &at) || *p++ != '\n' || p != line + count) return;
    if (deadline->seen && generation < deadline->generation) return;
    if (!deadline->seen || generation != deadline->generation) {
        deadline->generation = generation; deadline->at = at; deadline->fired = 0; deadline->seen = 1;
    } else if (at != deadline->at) return; // One generation identifies one immutable command.
    deadline->valid = 1;
}
static uint64_t epoch_ms(void) {
    struct timespec now; if (clock_gettime(CLOCK_REALTIME, &now) != 0) die("presence deadline clock");
    return (uint64_t)now.tv_sec * 1000 + (uint64_t)now.tv_nsec / 1000000;
}
static int deadline_remaining(Deadline *deadline, struct timespec *timeout) {
    if (!deadline->valid || deadline->fired || !deadline->at) return 0;
    uint64_t now = epoch_ms(), left = deadline->at > now ? deadline->at - now : 0;
    timeout->tv_sec = (time_t)(left / 1000); timeout->tv_nsec = (long)(left % 1000) * 1000000; return 1;
}
static void deadline_wait(Deadline *deadline) {
    struct kevent observed[16]; struct timespec timeout; int count;
    do { count = kevent(queue, NULL, 0, observed, 16, deadline_remaining(deadline, &timeout) ? &timeout : NULL); } while (count < 0 && errno == EINTR);
    if (count < 0) die("presence deadline wait");
    for (int n = 0; n < count; n++) {
        if (observed[n].filter == EVFILT_PROC && observed[n].ident == (uintptr_t)host) exit(0);
        if (observed[n].flags & EV_ERROR && observed[n].data && observed[n].data != ESRCH) { errno = (int)observed[n].data; die("presence event delivery"); }
    }
    parent_alive();
}
static void deadline_emit(Deadline *deadline) {
    if (!deadline->valid || deadline->fired || !deadline->at || deadline->at > epoch_ms()) return;
    uint64_t generation = deadline->generation, at = deadline->at;
    write_all(STDOUT_FILENO, "\n==> ", 5); write_all(STDOUT_FILENO, deadline->file.name, strlen(deadline->file.name)); write_all(STDOUT_FILENO, " <==\n", 5);
    // Header output can stall. Revalidate the command before emitting its record.
    deadline_read(deadline);
    if (!deadline->valid || deadline->fired || deadline->generation != generation || deadline->at != at || at > epoch_ms()) return;
    char line[80]; int size = snprintf(line, sizeof(line), "DEADLINE\t%llu\t%llu\n", (unsigned long long)generation, (unsigned long long)at);
    int output_queue = -1;
    for (;;) {
        deadline_read(deadline);
        if (!deadline->valid || deadline->fired || deadline->generation != generation || deadline->at != at || at > epoch_ms()) break;
        ssize_t count = write(STDOUT_FILENO, line, (size_t)size);
        if (count < 0 && errno == EINTR) continue;
        if (count < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
            if (output_queue < 0) {
                output_queue = kqueue(); if (output_queue < 0) die("presence deadline output queue");
                struct kevent changes[2];
                EV_SET(&changes[0], STDOUT_FILENO, EVFILT_WRITE, EV_ADD | EV_ENABLE | EV_CLEAR, 0, 0, NULL);
                EV_SET(&changes[1], host, EVFILT_PROC, EV_ADD | EV_ENABLE | EV_ONESHOT, NOTE_EXIT, 0, NULL);
                if (kevent(output_queue, changes, 2, NULL, 0, NULL) < 0) die("presence deadline output watch"); parent_alive();
            }
            wait_events(output_queue); continue;
        }
        if (count <= 0) die("presence deadline output");
        deadline->fired = 1;
        // Pipe records fit PIPE_BUF. Other stdout types may permit a short write.
        if (count < size) write_all(STDOUT_FILENO, line + count, (size_t)(size - count));
        break;
    }
    if (output_queue >= 0) close(output_queue);
}
static void follow_read(Watched *file, int initial) {
    struct stat current; if (lstat(file->name, &current) != 0 || !owned_file(&current)) return;
    if (file->fd < 0 || current.st_dev != file->device || current.st_ino != file->inode) {
        if (file->fd >= 0) close(file->fd); file->fd = secure_open(file->name, O_RDONLY | O_NONBLOCK, 0); if (file->fd < 0) return;
        file->offset = 0;
        if (strstr(file->name, "/requests.jsonl")) boundary("request-opened-before-watch");
        event(file->fd, EVFILT_VNODE, NOTE_WRITE | NOTE_EXTEND | NOTE_DELETE | NOTE_RENAME | NOTE_REVOKE);
        // A write between path stat and watch registration produces no event.
        // Refresh after watching, before deciding that the file is still empty.
        if (fstat(file->fd, &current) != 0) die("presence watched identity");
        file->device = current.st_dev; file->inode = current.st_ino;
        if (strstr(file->name, "/requests.jsonl")) { char generation[128]; int bytes = snprintf(generation, sizeof(generation), "\nREQUEST-GENERATION\t%llu\t%llu\n", (unsigned long long)current.st_dev, (unsigned long long)current.st_ino); write_all(STDOUT_FILENO, generation, (size_t)bytes); }
        if (initial && current.st_size > 0) {
            // Locate the final record with a bounded stack scan. Using malloc here
            // loaded the allocator in otherwise idle followers.
            char tail[2048]; off_t lower = current.st_size > LIMIT ? current.st_size - LIMIT : 0;
            off_t position = current.st_size; int found = 0, last = 1;
            file->offset = lower;
            while (position > lower && !found) {
                off_t start = position - lower > (off_t)sizeof(tail) ? position - (off_t)sizeof(tail) : lower;
                ssize_t count = pread(file->fd, tail, (size_t)(position - start), start);
                if (count <= 0) die("presence initial record");
                for (ssize_t n = count - 1; n >= 0; n--) {
                    if (last && tail[n] == '\n') { last = 0; continue; }
                    last = 0;
                    if (tail[n] == '\n') { file->offset = start + n + 1; found = 1; break; }
                }
                position = start;
            }
        }
    }
    if (current.st_size < file->offset) file->offset = 0; if (current.st_size == file->offset) return;
    off_t end = current.st_size; if (end - file->offset > LIMIT) file->offset = end - LIMIT;
    char *bytes = malloc(LIMIT); if (!bytes) die("presence follow allocation");
    size_t used = 0; off_t at = file->offset;
    while (at < end && used < LIMIT) {
        size_t want = (size_t)(end - at); if (want > LIMIT - used) want = LIMIT - used;
        ssize_t count = pread(file->fd, bytes + used, want, at);
        if (count < 0 && errno == EINTR) continue;
        if (count <= 0) break; used += (size_t)count; at += count;
    }
    size_t complete = used; while (complete && bytes[complete - 1] != '\n') complete--;
    if (complete) {
        write_all(STDOUT_FILENO, "\n==> ", 5); write_all(STDOUT_FILENO, file->name, strlen(file->name)); write_all(STDOUT_FILENO, " <==\n", 5);
        write_all(STDOUT_FILENO, bytes, complete); file->offset += (off_t)complete;
    } else if (used == LIMIT) file->offset = end;
    free(bytes);
}
static int watch_directory(const char *name, int old) {
    char directory[PATH_MAX]; if (strlen(name) >= sizeof(directory)) exit(64); memcpy(directory, name, strlen(name) + 1); char *slash = strrchr(directory, '/'); if (slash) *slash = 0; int fd;
    while ((fd = secure_directory(*directory ? directory : "/", 0)) < 0) { slash = strrchr(directory, '/'); if (!slash) return old; *slash = 0; }
    event(fd, EVFILT_VNODE, NOTE_WRITE | NOTE_DELETE | NOTE_RENAME); if (old >= 0) close(old); return fd;
}
static void emit_pid(pid_t pid) {
    char digits[24]; size_t offset = sizeof(digits); digits[--offset] = '\n';
    do { digits[--offset] = (char)('0' + pid % 10); pid /= 10; } while (pid);
    write_all(STDOUT_FILENO, digits + offset, sizeof(digits) - offset);
}
static void follow(const char *folder, const char *token, const char *requests, const char *marker_arg, const char *deadline_arg) {
    // A stalled reader must not prevent consuming the parent's exit event.
    int flags = fcntl(STDOUT_FILENO, F_GETFL); if (flags < 0 || fcntl(STDOUT_FILENO, F_SETFL, flags | O_NONBLOCK) < 0) die("presence output flags");
    // Allocate only the actual path lengths, retaining full PATH_MAX support.
    char journal[strlen(folder) + sizeof("/presence.jsonl")], snapshot[strlen(folder) + sizeof("/snapshot.json")];
    path(journal, folder, "presence.jsonl"); path(snapshot, folder, "snapshot.json"); close(create_file(journal)); close(create_file(snapshot));
    if (strlen(requests) >= PATH_MAX) exit(64);
    Watched files[3] = {{.name = journal, .fd = -1}, {.name = snapshot, .fd = -1}, {.name = requests, .fd = -1}};
    char deadline_name[160], deadline_path[strlen(folder) + 161];
    snprintf(deadline_name, sizeof(deadline_name), ".presence-deadline-%s.jsonl", token); path(deadline_path, folder, deadline_name);
    if (*deadline_arg && strcmp(deadline_path, deadline_arg)) exit(64);
    Deadline deadline = {.file = {.name = *deadline_arg ? deadline_path : "", .fd = -1}};
    char name[160] = ".presence-follow-"; size_t prefix = strlen(name), length = strlen(token);
    memcpy(name + prefix, token, length); memcpy(name + prefix + length, ".jsonl", 7); path(marker, folder, name);
    if (*marker_arg && strcmp(marker, marker_arg)) exit(64);
    char ready[160] = "READY\t"; memcpy(ready + 6, token, length); ready[6 + length] = '\n'; ready[7 + length] = 0;
    char regleaf[192]; snprintf(regleaf, sizeof(regleaf), ".presence-registration-%s", token); path(registration, folder, regleaf);
    struct proc_bsdinfo self; char executable[PROC_PIDPATHINFO_MAXSIZE], stamp[128], receipt[8192];
    if (!metadata(getpid(), &self, executable, stamp)) die("presence registration metadata");
    int bytes = snprintf(receipt, sizeof(receipt), "%d\t%u\t%s\t%u\t%s\t%s\n", getpid(), self.pbi_ppid, stamp, self.pbi_uid, executable, token);
    if (bytes <= 0 || bytes >= (int)sizeof(receipt)) exit(69);
    publish_file(registration, receipt, (size_t)bytes, 1);
    publish_file(marker, ready, 7 + length, 1);
    int own_directory = secure_directory(folder, 0); if (own_directory < 0) die("presence folder"); event(own_directory, EVFILT_VNODE, NOTE_WRITE | NOTE_DELETE | NOTE_RENAME);
    int request_directory = *requests ? watch_directory(requests, -1) : -1;
    write_all(STDOUT_FILENO, "FOLLOW\t", 7);
    if (*deadline_arg) { char identity[64]; int count = snprintf(identity, sizeof(identity), "%d\tDEADLINE1\n", getpid()); write_all(STDOUT_FILENO, identity, (size_t)count); }
    else emit_pid(getpid());
    for (int n = 0; n < 3; n++) if (*files[n].name) follow_read(&files[n], 1);
    write_all(STDOUT_FILENO, "\n==> ", 5); write_all(STDOUT_FILENO, marker, strlen(marker)); write_all(STDOUT_FILENO, " <==\n", 5); write_all(STDOUT_FILENO, ready, 7 + length);
    for (;;) {
        deadline_read(&deadline); deadline_emit(&deadline); deadline_wait(&deadline);
        if (*requests) request_directory = watch_directory(requests, request_directory);
        for (int n = 0; n < 3; n++) if (*files[n].name) follow_read(&files[n], 0);
    }
}
static int fifo_send(const char *folder, const char *name, const char *device, const char *inode, const char *text) {
    const char *position = device; uint64_t expected_device, expected_inode;
    if (strlen(device) > 20 || !deadline_integer(&position, &expected_device) || *position) return 64;
    position = inode;
    if (strlen(inode) > 20 || !deadline_integer(&position, &expected_inode) || *position) return 64;
    size_t prefix = strlen(folder), count = strlen(text);
    if (count > 65536 || strncmp(name, folder, prefix) || name[prefix] != '/' || strncmp(name + prefix + 1, ".presence-", 10)) return 64;
    const char *token = name + prefix + 11, *end = token;
    while (*end && *end != '/') { if (!((*end >= 'a' && *end <= 'z') || (*end >= 'A' && *end <= 'Z') || (*end >= '0' && *end <= '9') || *end == '_' || *end == '-')) return 64; end++; }
    if (end == token || end - token > 128 || strcmp(end, "/commit")) return 64;
    char leaf[PATH_MAX]; int parent = secure_parent(name, leaf); if (parent < 0) return 69;
    int fd = openat(parent, leaf, O_WRONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC); close(parent);
    if (fd < 0) return 69;
    struct stat info; if (fstat(fd, &info) != 0 || !owned_fifo(&info) || (uint64_t)info.st_dev != expected_device || (uint64_t)info.st_ino != expected_inode) { close(fd); return 69; }
    struct timespec beginning; if (clock_gettime(CLOCK_MONOTONIC, &beginning) != 0) { close(fd); return 69; }
    size_t sent = 0;
    while (sent < count) {
        ssize_t n = write(fd, text + sent, count - sent);
        if (n > 0) { sent += (size_t)n; continue; }
        if (n < 0 && errno == EINTR) continue;
        if (n < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
            struct timespec now; if (clock_gettime(CLOCK_MONOTONIC, &now) != 0 || now.tv_sec - beginning.tv_sec >= 5) { close(fd); return 69; }
            struct pollfd wait = { .fd = fd, .events = POLLOUT }; int ready = poll(&wait, 1, 100);
            if (ready < 0 && errno != EINTR) { close(fd); return 69; }
            if (ready > 0 && (wait.revents & (POLLERR | POLLHUP | POLLNVAL))) { close(fd); return 69; }
            continue;
        }
        close(fd); return 69;
    }
    close(fd); return 0;
}
static int deadline_write(const char *folder, const char *token, const char *line) {
    if (!*token || strlen(token) > 64 || strlen(line) >= 64) return 64;
    for (const char *p = token; *p; p++) if (!((*p >= 'a' && *p <= 'z') || (*p >= 'A' && *p <= 'Z') || (*p >= '0' && *p <= '9') || *p == '_' || *p == '-')) return 64;
    const char *p = line; uint64_t generation, at;
    if (!deadline_integer(&p, &generation) || *p++ != '\t' || !deadline_integer(&p, &at) || *p++ != '\n' || *p) return 64;
    char leaf[192], target[PATH_MAX], staged[PATH_MAX];
    snprintf(leaf, sizeof(leaf), ".presence-deadline-%s.jsonl", token); path(target, folder, leaf);
    snprintf(leaf, sizeof(leaf), ".presence-deadline-stage-%d", getpid()); path(staged, folder, leaf);
    int fd = secure_open(staged, O_WRONLY | O_CREAT | O_EXCL, 0); if (fd < 0) return 69;
    write_all(fd, line, strlen(line)); int result = secure_rename(staged, target, fd); secure_unlink_owned(staged, fd, 0); close(fd); return result == 0 ? 0 : 69;
}
static int stats(const char *pids, int tree) {
    pid_t wanted[4096]; int total = 0; const char *position = pids;
    while (*position) {
        char *end; long pid = strtol(position, &end, 10);
        if (end == position || pid < 1 || pid > INT_MAX || (*end && *end != ',')) return 64;
        int duplicate = 0; for (int n = 0; n < total; n++) if (wanted[n] == pid) duplicate = 1;
        if (!duplicate) { if (total >= 4096) return 69; wanted[total++] = (pid_t)pid; }
        position = *end ? end + 1 : end;
    }
    printf("["); int comma = 0;
    for (int index = 0; index < total; index++) {
        pid_t pid = wanted[index]; struct proc_bsdinfo info; struct rusage_info_v2 usage;
        if (identity(pid, &info) && proc_pid_rusage(pid, RUSAGE_INFO_V2, (rusage_info_t *)&usage) == 0) {
            pid_t children[4096]; int count = proc_listchildpids(pid, children, sizeof(children));
            if (count < 0 || count >= 4096) die("presence child inventory");
            printf("%s{\"pid\":%d,\"parent\":%u,\"rssBytes\":%llu,\"cpuNs\":%llu,\"children\":%d,\"birth\":\"%llu:%llu\"}", comma++ ? "," : "", pid, info.pbi_ppid, usage.ri_resident_size, usage.ri_user_time + usage.ri_system_time, count, info.pbi_start_tvsec, info.pbi_start_tvusec);
            if (tree) for (int child = 0; child < count; child++) {
                struct proc_bsdinfo child_info;
                if (!identity(children[child], &child_info) || child_info.pbi_ppid != (unsigned int)pid) continue;
                int duplicate = 0; for (int n = 0; n < total; n++) if (wanted[n] == children[child]) duplicate = 1;
                if (!duplicate) { if (total >= 4096) return 69; wanted[total++] = children[child]; }
            }
        }
    }
    printf("]\n"); return 0;
}
#ifndef PRESENCE_FOLLOW_ONLY
/* The optional companion owner is watched by kernel exit events, never a clock. */
static int watch_companion(const char *pid_text, const char *expected) {
    char *end; long requested = strtol(pid_text, &end, 10);
    if (*end || requested < 1 || requested > INT_MAX || strncmp(expected, "darwin:", 7) || strlen(expected) >= 128) return 64;
    for (const char *p = expected + 7; *p; p++) if ((*p < '0' || *p > '9') && *p != ':') return 64;
    host = getppid(); if (host <= 1) return 69;
    queue = kqueue(); if (queue < 0) die("companion watch queue");
    event(host, EVFILT_PROC, NOTE_EXIT); parent_alive();
    struct proc_bsdinfo info; char stamp[128];
    if (!identity((pid_t)requested, &info)) goto ended;
    birth(&info, stamp); if (strcmp(stamp, expected)) goto ended;
    struct kevent change;
    EV_SET(&change, (uintptr_t)requested, EVFILT_PROC, EV_ADD | EV_ENABLE | EV_ONESHOT, NOTE_EXIT, 0, NULL);
    if (kevent(queue, &change, 1, NULL, 0, NULL) < 0) { if (errno == ESRCH) goto ended; die("companion process watch"); }
    if (!identity((pid_t)requested, &info)) goto ended;
    birth(&info, stamp); if (strcmp(stamp, expected)) goto ended;
    printf("LIVE\t%ld\t%s\n", requested, expected); fflush(stdout);
    for (;;) {
        struct kevent observed[2]; int count;
        do { count = kevent(queue, NULL, 0, observed, 2, NULL); } while (count < 0 && errno == EINTR);
        if (count < 0) die("companion exit wait");
        parent_alive();
        for (int n = 0; n < count; n++) {
            if (observed[n].filter == EVFILT_PROC && observed[n].ident == (uintptr_t)host) return 0;
            if (observed[n].filter == EVFILT_PROC && observed[n].ident == (uintptr_t)requested) goto ended;
        }
    }
ended:
    printf("EXIT\t%ld\t%s\n", requested, expected); fflush(stdout); return 0;
}
#endif
int main(int argc, char **argv) {
#ifdef PRESENCE_SECURITY_FIXTURE
    if (argc >= 6 && !strcmp(argv[1], "security-foreign")) { fixture_foreign_inode = (ino_t)strtoull(argv[2], NULL, 10); argc -= 2; argv += 2; }
    if (argc == 5 && !strcmp(argv[1], "security-rename-swap")) {
        char target[PATH_MAX], temporary[PATH_MAX]; path(target, argv[2], argv[3]); path(temporary, argv[2], ".security-swap-stage");
        int original = secure_open(temporary, O_WRONLY | O_CREAT | O_EXCL, 0); if (original < 0) return 69;
        write_all(original, "original\n", 9); secure_unlink(temporary, 0);
        int replacement = secure_open(temporary, O_WRONLY | O_CREAT | O_EXCL, 0); if (replacement < 0) return 69;
        write_all(replacement, "replacement\n", 12); close(replacement);
        int result = !strcmp(argv[4], "cleanup") ? secure_unlink_owned(temporary, original, 0) : secure_rename(temporary, target, original);
        close(original); return result == 0 ? 0 : 69;
    }
    if (argc == 4 && !strcmp(argv[1], "security-unlink")) { char target[PATH_MAX]; path(target, argv[2], argv[3]); return secure_unlink(target, 0) == 0 ? 0 : 69; }
    if (argc == 5 && !strcmp(argv[1], "security-stage-swap")) { fixture_stage_link = argv[4]; char target[PATH_MAX]; path(target, argv[2], argv[3]); publish_file(target, "owned\n", 6, 0); return 0; }
    if (argc == 4 && !strcmp(argv[1], "security-registration")) {
        struct proc_bsdinfo info; memset(&info, 0, sizeof(info)); info.pbi_ppid = 22; info.pbi_uid = getuid();
        return registered(argv[2], argv[3], 44, &info, "darwin:1:2", "/fixture/helper") ? 0 : 69;
    }
    if (argc == 4 && !strcmp(argv[1], "security-write")) {
        create_folder(argv[2]); char target[PATH_MAX], temporary[PATH_MAX]; path(target, argv[2], argv[3]); path(temporary, argv[2], ".security-stage");
        int fd = store_file(temporary, "owned"); int result = secure_rename(temporary, target, fd); secure_unlink_owned(temporary, fd, 0); close(fd); return result == 0 ? 0 : 69;
    }
    if (argc == 4 && !strcmp(argv[1], "security-read")) {
        char target[PATH_MAX]; path(target, argv[2], argv[3]); int fd = secure_open(target, O_RDONLY, 0); if (fd < 0) return 69; close(fd); return 0;
    }
    if (argc == 4 && !strcmp(argv[1], "security-open")) {
        char target[PATH_MAX]; path(target, argv[2], argv[3]); int fd = create_file(target); close(fd); return 0;
    }
#endif
#ifndef PRESENCE_FOLLOW_ONLY
    if (argc == 7 && !strcmp(argv[2], "fifo-send")) return fifo_send(argv[1], argv[3], argv[4], argv[5], argv[6]);
    if (argc == 5 && !strcmp(argv[2], "deadline-write")) return deadline_write(argv[1], argv[3], argv[4]);
    if (argc == 5 && !strcmp(argv[2], "watch-companion")) return watch_companion(argv[3], argv[4]);
    if (argc == 3 && !strcmp(argv[1], "stats")) return stats(argv[2], 0);
    if (argc == 3 && !strcmp(argv[1], "stats-tree")) return stats(argv[2], 1);
#endif
    if (argc < 4 || (strcmp(argv[2], "follow") && strcmp(argv[2], "transaction"))) return 64;
    for (const char *p = argv[3]; *p; p++) if (!((*p >= 'a' && *p <= 'z') || (*p >= 'A' && *p <= 'Z') || (*p >= '0' && *p <= '9') || *p == '_' || *p == '-')) return 64;
    if (!*argv[3] || strlen(argv[3]) > 128) return 64;
    const char *requests = argc > 4 ? argv[4] : "", *remove = argc > 5 ? argv[5] : "", *marker_arg = argc > 6 ? argv[6] : "";
    if (*remove && (strncmp(argv[3], remove, strlen(remove)) || argv[3][strlen(remove)] != '-')) return 64;
    umask(077);
#ifndef PRESENCE_FOLLOW_ONLY
    setvbuf(stdout, NULL, _IOLBF, 8192);
    signal(SIGPIPE, interrupted); signal(SIGTERM, interrupted); signal(SIGINT, interrupted); signal(SIGHUP, interrupted); atexit(cleanup);
#endif
    host = getppid(); if (host <= 1) return 69; queue = kqueue(); if (queue < 0) die("presence queue"); event(host, EVFILT_PROC, NOTE_EXIT); parent_alive();
    create_folder(argv[1]);
    if (!strcmp(argv[2], "follow")) follow(argv[1], argv[3], requests, marker_arg, argc > 7 ? argv[7] : "");
#ifndef PRESENCE_FOLLOW_ONLY
    else transaction(argv[1], argv[3], remove);
#endif
    return 0;
}
