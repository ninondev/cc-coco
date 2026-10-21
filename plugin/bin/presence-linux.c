/* Linux presence transport. Freestanding, single process, direct kernel events.
 * Cross-built ELF files need neither libc nor a compiler on the user's machine. */
typedef unsigned long usize;
typedef long isize;
typedef unsigned long long u64;
typedef long long i64;
typedef unsigned int u32;
typedef unsigned short u16;
typedef unsigned char u8;
#define PATH_MAX 4096
#define LIMIT 262144
#define AT_FDCWD -100
#define O_RDONLY 0
#define O_WRONLY 1
#define O_RDWR 2
#define O_CREAT 64
#define O_EXCL 128
#define O_NOFOLLOW 131072
#define O_APPEND 1024
#define O_NONBLOCK 2048
#define O_CLOEXEC 524288
#define O_DIRECTORY 65536
#define EINTR 4
#define EAGAIN 11
#define ENOENT 2
#define EEXIST 17
#define LOCK_EX 2
#define LOCK_NB 4
#define LOCK_UN 8
#define SIGKILL 9
#define SIGSTOP 19
#define WATCH_EVENTS (0x2 | 0x4 | 0x40 | 0x80 | 0x100 | 0x200 | 0x400 | 0x800 | 0x01000000)

#if defined(__x86_64__)
enum { NR_read=0, NR_write=1, NR_close=3, NR_fstat=5, NR_lseek=8, NR_pread=17, NR_pwrite=18,
    NR_getuid=102, NR_readlinkat=267, NR_getpid=39, NR_kill=62, NR_fcntl=72, NR_flock=73, NR_ftruncate=77, NR_umask=95,
    NR_getppid=110, NR_prctl=157, NR_clock_gettime=228, NR_getdents=217, NR_exit=231,
    NR_inotify_add=254, NR_inotify_remove=255, NR_openat=257, NR_mkdirat=258,
    NR_mknodat=259, NR_unlinkat=263, NR_renameat=264, NR_ppoll=271,
    NR_symlinkat=266, NR_fsync=74, NR_renameat2=316, NR_inotify_init=294, NR_statx=332 };
static isize syscall6(isize nr, isize a, isize b, isize c, isize d, isize e, isize f) {
    register isize r10 __asm__("r10")=d, r8 __asm__("r8")=e, r9 __asm__("r9")=f;
    isize result;
    __asm__ volatile("syscall" : "=a"(result) : "a"(nr), "D"(a), "S"(b), "d"(c), "r"(r10), "r"(r8), "r"(r9) : "rcx", "r11", "memory");
    return result;
}
__asm__(".global _start\n_start:\nmov %rsp,%rdi\nandq $-16,%rsp\ncall entry\nud2\n");
#elif defined(__aarch64__)
enum { NR_fcntl=25, NR_inotify_init=26, NR_inotify_add=27, NR_inotify_remove=28, NR_flock=32,
    NR_mknodat=33, NR_mkdirat=34, NR_unlinkat=35, NR_renameat=38,
    NR_ftruncate=46, NR_openat=56, NR_close=57, NR_getdents=61, NR_lseek=62,
    NR_read=63, NR_write=64, NR_pread=67, NR_pwrite=68, NR_ppoll=73, NR_fstat=80,
    NR_getuid=174, NR_readlinkat=78, NR_exit=94, NR_kill=129, NR_umask=166, NR_prctl=167, NR_clock_gettime=113, NR_getpid=172,
    NR_symlinkat=36, NR_fsync=82, NR_renameat2=276, NR_getppid=173, NR_statx=291 };
static isize syscall6(isize nr, isize a, isize b, isize c, isize d, isize e, isize f) {
    register isize x8 __asm__("x8")=nr, x0 __asm__("x0")=a, x1 __asm__("x1")=b,
        x2 __asm__("x2")=c, x3 __asm__("x3")=d, x4 __asm__("x4")=e, x5 __asm__("x5")=f;
    __asm__ volatile("svc 0" : "+r"(x0) : "r"(x8), "r"(x1), "r"(x2), "r"(x3), "r"(x4), "r"(x5) : "memory");
    return x0;
}
__asm__(".global _start\n_start:\nmov x0,sp\nbl entry\nbrk 0\n");
#else
#error Supported Linux architectures are x86_64 and aarch64
#endif
static isize call(isize n, isize a, isize b, isize c) { return syscall6(n,a,b,c,0,0,0); }
void *memcpy(void *dest, const void *src, usize n) { u8 *d=dest; const u8 *s=src; while(n--) *d++=*s++; return dest; }
void *memset(void *dest, int value, usize n) { u8 *d=dest; while(n--) *d++=(u8)value; return dest; }
static usize length(const char *s) { usize n=0; while(s[n]) n++; return n; }
static int equal(const char *a, const char *b) { while(*a && *a==*b) { a++; b++; } return *a==*b; }
static int prefix(const char *s, const char *p) { while(*p) if(*p++!=*s++) return 0; return 1; }
__attribute__((noreturn)) static void quit(int status) { call(NR_exit,status,0,0); __builtin_unreachable(); }
static void output(int fd, const char *s, usize n) { while(n) { isize k=call(NR_write,fd,(isize)s,n); if(k==-EINTR) continue; if(k<=0) quit(69); s+=k; n-=k; } }
static void emit(const char *s) { output(1,s,length(s)); }
static void fail(const char *s) { output(2,s,length(s)); output(2,"\n",1); quit(69); }
static char *number(char *out, u64 value) { char digits[24]; int n=0; do { digits[n++]=(char)('0'+value%10); value/=10; } while(value); while(n) *out++=digits[--n]; *out=0; return out; }
static void emit_number(u64 value) { char out[24]; number(out,value); emit(out); }
static char *append(char *out, const char *s, char *end) { while(*s) { if(out+1>=end) fail("presence path too long"); *out++=*s++; } *out=0; return out; }
static void path(char *out, const char *folder, const char *name) { char *p=append(out,folder,out+PATH_MAX); if(p==out || p[-1]!='/') p=append(p,"/",out+PATH_MAX); append(p,name,out+PATH_MAX); }
static int open_file(const char *name, int flags, int mode) { return (int)syscall6(NR_openat,AT_FDCWD,(isize)name,flags,mode,0,0); }
static void close_fd(int fd) { if(fd>=0) call(NR_close,fd,0,0); }
static int secure_open(const char *name, int flags, int create);
static int secure_directory(const char *folder, int create, int final_owned);
static int secure_rename(const char *from, const char *to, int exclusive, int source_fd);
static int secure_unlink_owned(const char *name, int source_fd, int directory);
static int secure_unlink(const char *name, int directory);
static void publish_file(const char *target, const char *data, usize bytes, int exclusive);
static int create_file(const char *name) { int fd=secure_open(name,O_RDWR,1); if(fd<0) fail("presence file"); return fd; }
static void unlink_file(const char *name) { (void)secure_unlink(name,0); }
static void create_folder(const char *folder) { int fd=secure_directory(folder,1,1); if(fd<0) fail("presence folder"); close_fd(fd); }
static isize read_file(const char *name, char *out, usize cap) {
    int fd=open_file(name,O_RDONLY|O_CLOEXEC,0); if(fd<0) return fd;
    usize used=0;
    while(used+1<cap) { isize r=call(NR_read,fd,(isize)(out+used),cap-1-used); if(r==-EINTR) continue; if(r<0) { close_fd(fd); return r; } if(!r) break; used+=r; }
    out[used]=0; close_fd(fd); return (isize)used;
}
struct StatTime { i64 sec; u32 nsec, unused; };
struct Stat { u32 mask, blksize; u64 attributes; u32 links, uid, gid; u16 mode, spare; u64 inode, size, blocks, attribute_mask;
    struct StatTime atime,btime,ctime,mtime; u32 rdev_major,rdev_minor,dev_major,dev_minor; u64 spare64[14]; };
_Static_assert(sizeof(struct Stat)==256,"Linux statx ABI");
#if defined(__x86_64__)
struct OldStat { u64 device,inode,links; u32 mode,uid,gid,padding; u64 rdev; i64 size,blksize,blocks; i64 times[6],unused[3]; };
_Static_assert(sizeof(struct OldStat)==144,"Linux x86_64 fstat ABI");
#else
struct OldStat { u64 device,inode; u32 mode,links,uid,gid; u64 rdev,padding; i64 size; u32 blksize,padding2; i64 blocks,times[6]; u32 unused[2]; };
_Static_assert(sizeof(struct OldStat)==128,"Linux aarch64 fstat ABI");
#endif

#ifdef PRESENCE_SECURITY_FIXTURE
static u64 fixture_foreign_inode;
static const char *fixture_stage_link;
#endif
static int owned_stat(const struct OldStat *st, u32 kind) {
#ifdef PRESENCE_SECURITY_FIXTURE
    if(fixture_foreign_inode && st->inode==fixture_foreign_inode) return 0;
#endif
    return st->uid==(u32)call(NR_getuid,0,0,0) && st->links==1 && (st->mode & 0170000)==kind;
}
static int secure_directory(const char *folder, int create, int final_owned) {
    if(!folder || folder[0]!='/' || length(folder)>=PATH_MAX) return -1;
    int fd=open_file("/",O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC,0); if(fd<0) return -1;
    const char *p=folder; u32 uid=(u32)call(NR_getuid,0,0,0);
    while(*p) {
        while(*p=='/') p++; if(!*p) break; char part[256]; usize n=0;
        while(*p && *p!='/') { if(n>=255) { close_fd(fd); return -1; } part[n++]=*p++; } part[n]=0;
        if(equal(part,".") || equal(part,"..")) { close_fd(fd); return -1; }
        const char *remaining=p; while(*remaining=='/') remaining++;
        int made=0, child=(int)syscall6(NR_openat,fd,(isize)part,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC,0,0,0);
        if(child==-ENOENT && create) { if(call(NR_mkdirat,fd,(isize)part,0700)<0) { close_fd(fd); return -1; } made=1; child=(int)syscall6(NR_openat,fd,(isize)part,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC,0,0,0); }
        struct OldStat st;
        if(child<0 || call(NR_fstat,child,(isize)&st,0)<0 || (st.mode & 0170000)!=0040000 || (st.uid!=uid && (made || (final_owned && !*remaining) || st.uid!=0))) { close_fd(child); close_fd(fd); return -1; }
        close_fd(fd); fd=child;
    }
    if(final_owned) { struct OldStat st; if(call(NR_fstat,fd,(isize)&st,0)<0 || st.uid!=uid) { close_fd(fd); return -1; } }
    return fd;
}
static int secure_parent(const char *name, char leaf[PATH_MAX]) {
    if(!name || name[0]!='/' || length(name)>=PATH_MAX) return -1; char folder[PATH_MAX]; append(folder,name,folder+sizeof(folder)); char *slash=0;
    for(char *p=folder;*p;p++) if(*p=='/') slash=p;
    if(!slash || !slash[1]) return -1; append(leaf,slash+1,leaf+PATH_MAX); if(equal(leaf,".") || equal(leaf,"..")) return -1;
    if(slash==folder) slash[1]=0; else *slash=0; return secure_directory(folder,0,1);
}
static int secure_open(const char *name, int flags, int create) {
    char leaf[PATH_MAX]; int parent=secure_parent(name,leaf); if(parent<0) return -1;
    int fd=(int)syscall6(NR_openat,parent,(isize)leaf,flags|O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC,0600,0,0);
    if(fd==-ENOENT && create) fd=(int)syscall6(NR_openat,parent,(isize)leaf,flags|O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC|O_CREAT|O_EXCL,0600,0,0);
    /* Losing the create race to another process means the file now exists: open it. */
    if(fd==-EEXIST && create) fd=(int)syscall6(NR_openat,parent,(isize)leaf,flags|O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC,0600,0,0);
    struct OldStat st; if(fd>=0 && (call(NR_fstat,fd,(isize)&st,0)<0 || !owned_stat(&st,0100000))) { close_fd(fd); fd=-1; }
    close_fd(parent); return fd;
}
static int secure_existing(int parent, const char *leaf, struct OldStat *st) {
    int fd=(int)syscall6(NR_openat,parent,(isize)leaf,2097152|O_NOFOLLOW|O_CLOEXEC,0,0,0);
    if(fd==-ENOENT) return 0; if(fd<0) return -1;
    int valid=call(NR_fstat,fd,(isize)st,0)==0 && owned_stat(st,0100000); close_fd(fd); return valid?1:-1;
}
static int secure_rename(const char *from, const char *to, int exclusive, int source_fd) {
    char src[PATH_MAX],dst[PATH_MAX]; int a=secure_parent(from,src),b=secure_parent(to,dst),result=-1; struct OldStat original,source,destination;
    if(a>=0 && b>=0 && source_fd>=0 && call(NR_fsync,source_fd,0,0)==0 && call(NR_fstat,source_fd,(isize)&original,0)==0 && owned_stat(&original,0100000)
        && secure_existing(a,src,&source)==1 && source.device==original.device && source.inode==original.inode && secure_existing(b,dst,&destination)>=0)
        result=exclusive?(int)syscall6(NR_renameat2,a,(isize)src,b,(isize)dst,1,0):(int)syscall6(NR_renameat,a,(isize)src,b,(isize)dst,0,0);
    close_fd(a); close_fd(b); return result;
}
static int secure_unlink_owned(const char *name, int source_fd, int directory) {
    char leaf[PATH_MAX]; int parent=secure_parent(name,leaf); if(parent<0 || source_fd<0) { close_fd(parent); return -1; }
    int fd=(int)syscall6(NR_openat,parent,(isize)leaf,2097152|O_NOFOLLOW|O_CLOEXEC,0,0,0); struct OldStat original,current; int result=-1;
    if(fd>=0 && call(NR_fstat,source_fd,(isize)&original,0)==0 && call(NR_fstat,fd,(isize)&current,0)==0
        && original.uid==(u32)call(NR_getuid,0,0,0) && current.uid==original.uid && current.device==original.device && current.inode==original.inode
        && (directory ? (current.mode & 0170000)==0040000 && (original.mode & 0170000)==0040000
            : current.links==1 && original.links==1 && ((current.mode & 0170000)==0100000 || (current.mode & 0170000)==0010000) && (current.mode & 0170000)==(original.mode & 0170000)))
        result=(int)call(NR_unlinkat,parent,(isize)leaf,directory?0x200:0);
    close_fd(fd); close_fd(parent); return result;
}
static int secure_unlink(const char *name, int directory) {
    char leaf[PATH_MAX]; int parent=secure_parent(name,leaf); if(parent<0) return -1;
    int fd=(int)syscall6(NR_openat,parent,(isize)leaf,2097152|O_NOFOLLOW|O_CLOEXEC,0,0,0); struct OldStat st; int result=-1;
    if(fd>=0 && call(NR_fstat,fd,(isize)&st,0)==0 && st.uid==(u32)call(NR_getuid,0,0,0)
        && (directory ? (st.mode & 0170000)==0040000 : (st.links==1 && ((st.mode & 0170000)==0100000 || (st.mode & 0170000)==0010000))))
        result=(int)call(NR_unlinkat,parent,(isize)leaf,directory?0x200:0);
    close_fd(fd); close_fd(parent); return result;
}
static void publish_file(const char *target, const char *data, usize bytes, int exclusive) {
    char leaf[PATH_MAX]; int parent=secure_parent(target,leaf); struct OldStat prior,latest;
    int existed=parent>=0?secure_existing(parent,leaf,&prior):-1; if(existed<0) fail("presence publish destination");
    char temporary[128]; static u32 counter; char *p=append(temporary,".presence-stage-",temporary+sizeof(temporary)); p=number(p,(u64)call(NR_getpid,0,0,0)); p=append(p,"-",temporary+sizeof(temporary)); number(p,++counter);
    int fd=(int)syscall6(NR_openat,parent,(isize)temporary,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600,0,0); if(fd<0) fail("presence publish stage");
    struct OldStat st; if(call(NR_fstat,fd,(isize)&st,0)<0 || !owned_stat(&st,0100000)) fail("presence publish stage"); output(fd,data,bytes); if(call(NR_fsync,fd,0,0)<0) fail("presence publish sync");
#ifdef PRESENCE_SECURITY_FIXTURE
    if(fixture_stage_link) { call(NR_unlinkat,parent,(isize)temporary,0); if(syscall6(NR_symlinkat,(isize)fixture_stage_link,parent,(isize)temporary,0,0,0)<0) fail("fixture stage link"); }
#endif
    struct OldStat staged,current; int stage_ok=call(NR_fstat,fd,(isize)&current,0)==0 && owned_stat(&current,0100000) && current.device==st.device && current.inode==st.inode && secure_existing(parent,temporary,&staged)==1 && staged.device==st.device && staged.inode==st.inode;
    int now=secure_existing(parent,leaf,&latest), result=-1;
    if(stage_ok && now==existed && (now==0 || (prior.device==latest.device && prior.inode==latest.inode)))
        result=exclusive?(int)syscall6(NR_renameat2,parent,(isize)temporary,parent,(isize)leaf,1,0):(int)syscall6(NR_renameat,parent,(isize)temporary,parent,(isize)leaf,0,0);
    if(result<0 && secure_existing(parent,temporary,&current)==1 && current.device==st.device && current.inode==st.inode) call(NR_unlinkat,parent,(isize)temporary,0);
    close_fd(fd); close_fd(parent); if(result<0) fail("presence publish rename");
}
static int statx_supported=1;
static int stat_file(const char *name, struct Stat *out) {
    memset(out,0,sizeof(*out));
    if(statx_supported) { int code=(int)syscall6(NR_statx,AT_FDCWD,(isize)name,256,0x7ff,(isize)out,0); if(code!=-38) return code; statx_supported=0; }
    int fd=open_file(name,2097152|O_CLOEXEC|O_NOFOLLOW,0); if(fd<0) return fd; struct OldStat info; int code=(int)call(NR_fstat,fd,(isize)&info,0); close_fd(fd); if(code<0) return code;
    out->inode=info.inode; out->size=(u64)info.size; out->mode=(u16)info.mode; out->uid=info.uid; out->links=(u32)info.links;
    out->dev_major=(u32)(((info.device & 0xfff00)>>8) | ((info.device & 0xfffff00000000000ULL)>>32));
    out->dev_minor=(u32)((info.device & 0xff) | ((info.device & 0xffffff00000ULL)>>12)); return 0;
}

static int host, lockfd=-1, notifications=-1, snapshot_stage_fd=-1, journal_stage_fd=-1, fifo_fd=-1, work_fd=-1;
static char work[PATH_MAX], fifo[PATH_MAX], marker[PATH_MAX], boot[128];
#ifdef PRESENCE_TEST_BOUNDARIES
static const char *test_boundary = "";
#endif
static u64 ticks=100, page_size=4096;
#ifdef PRESENCE_TEST_BOUNDARIES

#endif
static void parent_alive(void) { if(call(NR_getppid,0,0,0)!=host) quit(0); }
static void cleanup(void) {
    if(lockfd>=0) { call(NR_flock,lockfd,LOCK_UN,0); close_fd(lockfd); lockfd=-1; }
    if(*fifo && fifo_fd>=0) secure_unlink_owned(fifo,fifo_fd,0);
    if(*work) { char name[PATH_MAX]; path(name,work,"snapshot"); if(snapshot_stage_fd>=0) secure_unlink_owned(name,snapshot_stage_fd,0); path(name,work,"journal"); if(journal_stage_fd>=0) secure_unlink_owned(name,journal_stage_fd,0); if(work_fd>=0) secure_unlink_owned(work,work_fd,1); }
    close_fd(snapshot_stage_fd); snapshot_stage_fd=-1; close_fd(journal_stage_fd); journal_stage_fd=-1; close_fd(fifo_fd); fifo_fd=-1; close_fd(work_fd); work_fd=-1;
}
static void boundary(const char *stage) {
#ifdef PRESENCE_TEST_BOUNDARIES
    if(equal(test_boundary,stage)) { emit("BOUNDARY\t"); emit(stage); emit("\t"); emit_number(call(NR_getpid,0,0,0)); emit("\n"); call(NR_kill,call(NR_getpid,0,0,0),SIGSTOP,0); }
#else
    (void)stage;
#endif
}
struct Poll { int fd; short events, revents; };
static void wait_fd(int fd, short events) {
    struct Poll p={fd,events,0}; isize r;
    do { r=syscall6(NR_ppoll,(isize)&p,1,0,0,0,0); } while(r==-EINTR);
    if(r<0 || (p.revents & (8|16|32))) fail("presence event wait"); parent_alive();
}
static void acquire(const char *folder, const char *token) {
    char name[PATH_MAX]; path(name,folder,".presence-flock"); lockfd=create_file(name); parent_alive(); boundary("before-lock"); isize r;
#ifdef PRESENCE_TEST_BOUNDARIES
    r=call(NR_flock,lockfd,LOCK_EX|LOCK_NB,0);
    if(r<0) { emit("CONTENDING\t"); emit_number(call(NR_getpid,0,0,0)); emit("\n"); do { r=call(NR_flock,lockfd,LOCK_EX,0); } while(r==-EINTR); }
#else
    do { r=call(NR_flock,lockfd,LOCK_EX,0); } while(r==-EINTR);
#endif
    if(r<0) fail("presence lock"); parent_alive(); boundary("lock-acquired");
    char owner[180], *p=number(owner,call(NR_getpid,0,0,0)); p=append(p,"\n",owner+sizeof(owner)); p=append(p,token,owner+sizeof(owner)); append(p,"\n",owner+sizeof(owner));
    char target[PATH_MAX]; path(target,folder,".presence-flock-owner"); publish_file(target,owner,length(owner),0); boundary("owner-written");
}

static char proc_data[8192];
struct Identity { u64 pid,parent,start,cpu,rss; char state; };
static u64 integer(const char **p) { u64 n=0; if(**p<'0' || **p>'9') quit(64); do { n=n*10+(u64)(*(*p)++-'0'); } while(**p>='0' && **p<='9'); return n; }
static void proc_path(char *out, u64 pid, const char *part) { char suffix[40]; number(suffix,pid); path(out,"/proc",suffix); char base[PATH_MAX]; append(base,out,base+sizeof(base)); path(out,base,part); }
static int identity(u64 pid, struct Identity *info) {
    char name[PATH_MAX]; proc_path(name,pid,"stat"); isize n=read_file(name,proc_data,sizeof(proc_data)); if(n==-ENOENT) return 0; if(n<0) fail("presence process stat");
    char *position=proc_data, *end=0; for(char *p=proc_data;*p;p++) if(*p==')') end=p;
    if(!end || end[1]!=' ' || !end[2]) fail("presence process identity");
    const char *first=position; u64 actual=integer(&first); if(actual!=pid) return 0;
    info->pid=pid; info->state=end[2]; if(info->state=='Z' || info->state=='X' || info->state=='x') return 0;
    const char *p=end+4; memset(info,0,sizeof(*info)); info->pid=pid;
    for(int field=4;field<=24;field++) { while(*p==' ') p++; int negative=*p=='-'; if(negative) p++; u64 value=integer(&p);
        if(field==4) info->parent=value; if(field==14 || field==15) info->cpu+=value; if(field==22) info->start=value; if(field==24) info->rss=negative?0:value;
    }
    return 1;
}
static void emit_birth(const struct Identity *info) { emit("linux:"); emit(boot); emit(":"); emit_number(info->start); }
static u64 next_pid(const char **position) { u64 pid=integer(position); if(!pid || pid>2147483647 || (**position && **position!=',')) quit(64); if(**position) (*position)++; return pid; }
static int process_metadata(u64 pid, struct Identity *info, char executable[PATH_MAX], u32 *uid) {
    char name[PATH_MAX]; struct Stat owner;
    proc_path(name,pid,"");
    if(stat_file(name,&owner)<0 || owner.uid!=(u32)call(NR_getuid,0,0,0) || !identity(pid,info)) return 0;
    *uid=owner.uid; proc_path(name,pid,"exe");
    isize count=syscall6(NR_readlinkat,AT_FDCWD,(isize)name,(isize)executable,PATH_MAX-1,0,0);
    if(count<=0 || count>=PATH_MAX-1) return 0; executable[count]=0;
    for(isize i=0;i<count;i++) if(executable[i]=='\t' || executable[i]=='\r' || executable[i]=='\n') return 0;
    struct Identity verify; return identity(pid,&verify) && verify.start==info->start && verify.parent==info->parent;
}
static void receipt(char out[8192], const struct Identity *info, u32 uid, const char *executable, const char *token) {
    char *end=out+8192, *p=number(out,info->pid); p=append(p,"\t",end); p=number(p,info->parent);
    p=append(p,"\tlinux:",end); p=append(p,boot,end); p=append(p,":",end); p=number(p,info->start);
    p=append(p,"\t",end); p=number(p,uid); p=append(p,"\t",end); p=append(p,executable,end); p=append(p,"\t",end); p=append(p,token,end); append(p,"\n",end);
}
static int registered(const char *folder, const char *token, const char *expected) {
    char leaf[192], name[PATH_MAX], present[8192]; char *p=append(leaf,".presence-registration-",leaf+sizeof(leaf)); append(p,token,leaf+sizeof(leaf)); path(name,folder,leaf);
    int fd=secure_open(name,O_RDONLY,0); if(fd<0) return 0;
    struct OldStat info; int valid=call(NR_fstat,fd,(isize)&info,0)==0 && info.uid==(u32)call(NR_getuid,0,0,0) && info.links==1 && (info.mode & 0170000)==0100000;
    isize count=valid?call(NR_read,fd,(isize)present,sizeof(present)-1):-1; close_fd(fd);
    if(count<=0 || count>=(isize)sizeof(present)-1) return 0; present[count]=0; return equal(present,expected);
}
static void inventory(const char *folder, const char *pids) {
    int total=0;
    while(*pids) {
        if(++total>2048) quit(64); u64 pid=integer(&pids); if(!pid || pid>2147483647) quit(64);
        char token[65]=""; usize used=0;
        if(*pids==':') { pids++; while(*pids && *pids!=',') { char c=*pids++; if(used>=64 || !((c>='a' && c<='z') || (c>='A' && c<='Z') || (c>='0' && c<='9') || c=='_' || c=='-')) quit(64); token[used++]=c; } if(!used) quit(64); token[used]=0; }
        if(*pids && *pids!=',') quit(64); if(*pids) pids++;
        struct Identity info; u32 uid; char executable[PATH_MAX], record[8192]; if(!process_metadata(pid,&info,executable,&uid)) continue;
        receipt(record,&info,uid,executable,token); int bound=*token && registered(folder,token,record);
        receipt(record,&info,uid,executable,bound?token:""); emit("PID\t"); emit(record);
    }
}

static char line_data[LIMIT+1], copy_data[LIMIT+1];
static char *read_line(int fd) {
    usize used=0; for(;;) { char byte; isize r=call(NR_read,fd,(isize)&byte,1);
        if(r==1) { if(byte=='\n') { line_data[used]=0; return line_data; } if(used>=LIMIT-1) fail("presence line too long"); line_data[used++]=byte; }
        else if(r==-EINTR) continue; else if(r==-EAGAIN) wait_fd(fd,1); else fail("presence FIFO");
    }
}
static void copy_output(const char *name, const char *tag) {
    int fd=secure_open(name,O_RDONLY,0); if(fd<0) return; struct OldStat st;
    if(call(NR_fstat,fd,(isize)&st,0)<0 || st.size<0 || st.size>LIMIT) { close_fd(fd); return; }
    usize budget=(usize)st.size,used=0;
    while(used<budget) { isize n=call(NR_read,fd,(isize)(copy_data+used),budget-used); if(n==-EINTR) continue; if(n<=0) break; used+=(usize)n; }
    close_fd(fd); for(usize at=0;at<used;) { usize end=at; while(end<used && copy_data[end]!='\n') end++; emit(tag); output(1,copy_data+at,end-at); emit("\n"); at=end+1; }
}
static int store_file(const char *name, const char *line) { int fd=secure_open(name,O_WRONLY|O_CREAT|O_EXCL,0); if(fd<0) fail("presence temporary"); output(fd,line,length(line)); output(fd,"\n",1); return fd; }
static void transaction(const char *folder, const char *token, const char *remove) {
    char suffix[180]; append(append(suffix,".presence-",suffix+sizeof(suffix)),token,suffix+sizeof(suffix)); path(work,folder,suffix);
    char workleaf[PATH_MAX]; int parent=secure_parent(work,workleaf); if(parent<0 || call(NR_mkdirat,parent,(isize)workleaf,0700)<0) fail("presence work"); close_fd(parent); path(fifo,work,"commit");
    int workfd=secure_directory(work,0,1); work_fd=workfd; if(workfd<0 || syscall6(NR_mknodat,workfd,(isize)"commit",0010000|0600,0,0,0)<0) fail("presence FIFO");
    int input=(int)syscall6(NR_openat,workfd,(isize)"commit",O_RDWR|O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC,0,0,0); fifo_fd=input; struct OldStat input_stat;
    if(input<0 || call(NR_fstat,input,(isize)&input_stat,0)<0 || !owned_stat(&input_stat,0010000)) fail("presence FIFO"); acquire(folder,token);
    char journal[PATH_MAX],snapshot[PATH_MAX],temporary[PATH_MAX],compact[PATH_MAX]; path(journal,folder,"presence.jsonl"); path(snapshot,folder,"snapshot.json"); path(temporary,work,"snapshot"); path(compact,work,"journal"); close_fd(create_file(journal));
    emit("PRESENCE\t"); emit_number(host); emit("\t"); emit(fifo); emit("\t"); emit_number(input_stat.device); emit("\t"); emit_number(input_stat.inode); emit("\n"); copy_output(snapshot,"STATE\t"); copy_output(journal,"LOG\t"); emit("INSPECT\n"); boundary("inspect-wait");
    inventory(folder,read_line(input)); emit("READY\n"); boundary("commit-wait"); const char *commit=read_line(input); parent_alive();
    if(!equal(commit,"-")) {
        snapshot_stage_fd=store_file(temporary,commit); boundary("temporary-written"); parent_alive();
        if(secure_rename(temporary,snapshot,0,snapshot_stage_fd)<0) fail("presence snapshot"); boundary("snapshot-renamed"); parent_alive();
        int previous=secure_open(journal,O_RDONLY,0); struct OldStat info; if(previous<0 || call(NR_fstat,previous,(isize)&info,0)<0) fail("presence journal");
        usize incoming=length(commit)+1; int rotated=info.size<0 || (u64)info.size+incoming>LIMIT;
        int next=secure_open(compact,O_WRONLY|O_CREAT|O_EXCL,0); journal_stage_fd=next; if(next<0) fail("presence journal stage");
        if(!rotated) { i64 remaining=info.size; while(remaining>0) { usize want=remaining>(i64)sizeof(proc_data)?sizeof(proc_data):(usize)remaining; isize n=call(NR_read,previous,(isize)proc_data,want); if(n==-EINTR) continue; if(n<=0) fail("presence journal read"); output(next,proc_data,(usize)n); remaining-=n; } }
        close_fd(previous); output(next,commit,incoming-1); output(next,"\n",1); parent_alive();
        if(secure_rename(compact,journal,0,next)<0) fail("presence journal commit"); boundary(rotated?"journal-rotated":"journal-appended");
    }
    if(*remove) { append(append(append(suffix,".presence-follow-",suffix+sizeof(suffix)),remove,suffix+sizeof(suffix)),".jsonl",suffix+sizeof(suffix)); path(marker,folder,suffix); unlink_file(marker); append(append(append(suffix,".presence-deadline-",suffix+sizeof(suffix)),remove,suffix+sizeof(suffix)),".jsonl",suffix+sizeof(suffix)); path(marker,folder,suffix); unlink_file(marker); append(append(suffix,".presence-registration-",suffix+sizeof(suffix)),remove,suffix+sizeof(suffix)); path(marker,folder,suffix); unlink_file(marker); }
    boundary("before-unlock"); cleanup(); boundary("after-unlock"); emit("COMMITTED\n");
}

struct Watched { char name[PATH_MAX]; int fd; u64 offset,inode,device; };
struct Deadline { char name[PATH_MAX]; u64 generation,at; int seen,valid,fired; };
static int deadline_integer(const char **position, u64 *value) {
    const char *p=*position; u64 n=0; if(*p<'0' || *p>'9') return 0;
    do { unsigned digit=(unsigned)(*p++-'0'); if(n>(9223372036854775807ULL-digit)/10) return 0; n=n*10+digit; } while(*p>='0' && *p<='9');
    *position=p; *value=n; return 1;
}
static void deadline_read(struct Deadline *deadline) {
    if(!*deadline->name) return; deadline->valid=0;
    struct Stat st; if(stat_file(deadline->name,&st)<0 || (st.mode & 0170000)!=0100000 || st.size>=63) return;
    char line[64]; int fd=secure_open(deadline->name,O_RDONLY,0); if(fd<0) return; isize count=call(NR_read,fd,(isize)line,sizeof(line)-1); close_fd(fd); if(count<=0 || count>=63) return; line[count]=0;
    const char *p=line; u64 generation,at;
    if(!deadline_integer(&p,&generation) || *p++!='\t' || !deadline_integer(&p,&at) || *p++!='\n' || p!=line+count) return;
    if(deadline->seen && generation<deadline->generation) return;
    if(!deadline->seen || generation!=deadline->generation) { deadline->generation=generation; deadline->at=at; deadline->fired=0; deadline->seen=1; }
    else if(at!=deadline->at) return;
    deadline->valid=1;
}
struct Time { i64 sec,nsec; };
static u64 epoch_ms(void) { struct Time now; if(call(NR_clock_gettime,0,(isize)&now,0)<0) fail("presence deadline clock"); return (u64)now.sec*1000+(u64)now.nsec/1000000; }
static int deadline_remaining(struct Deadline *deadline, struct Time *timeout) {
    if(!deadline->valid || deadline->fired || !deadline->at) return 0;
    u64 now=epoch_ms(),left=deadline->at>now?deadline->at-now:0; timeout->sec=(i64)(left/1000); timeout->nsec=(i64)(left%1000)*1000000; return 1;
}
static void deadline_wait(struct Deadline *deadline) {
    struct Poll p={notifications,1,0}; struct Time timeout; isize r;
    do { r=syscall6(NR_ppoll,(isize)&p,1,deadline_remaining(deadline,&timeout)?(isize)&timeout:0,0,0,0); } while(r==-EINTR);
    if(r<0 || (p.revents & (8|16|32))) fail("presence deadline wait"); parent_alive();
}
static void deadline_emit(struct Deadline *deadline) {
    if(!deadline->valid || deadline->fired || !deadline->at || deadline->at>epoch_ms()) return;
    u64 generation=deadline->generation,at=deadline->at;
    emit("\n==> "); emit(deadline->name); emit(" <==\n");
    /* Output can stall; reload the complete command before emitting its record. */
    deadline_read(deadline); if(!deadline->valid || deadline->fired || deadline->generation!=generation || deadline->at!=at || at>epoch_ms()) return;
    char line[80],*p=append(line,"DEADLINE\t",line+sizeof(line)); p=number(p,generation); p=append(p,"\t",line+sizeof(line)); p=number(p,at); append(p,"\n",line+sizeof(line));
    /* Only the deadline body needs nonblocking retries with command validation.
     * Ordinary transport output keeps its existing blocking/pdeath behavior. */
    isize flags=call(NR_fcntl,1,3,0); if(flags<0 || call(NR_fcntl,1,4,flags|O_NONBLOCK)<0) fail("presence deadline output flags");
    usize size=length(line);
    for(;;) {
        deadline_read(deadline); if(!deadline->valid || deadline->fired || deadline->generation!=generation || deadline->at!=at || at>epoch_ms()) break;
        isize count=call(NR_write,1,(isize)line,size);
        if(count==-EINTR) continue;
        if(count==-EAGAIN) { wait_fd(1,4); continue; }
        if(count<=0) fail("presence deadline output"); deadline->fired=1;
        if((usize)count<size) { if(call(NR_fcntl,1,4,flags)<0) fail("presence deadline output flags"); output(1,line+count,size-(usize)count); return; }
        break;
    }
    if(call(NR_fcntl,1,4,flags)<0) fail("presence deadline output flags");
}
static struct Watched followed[3];
static void follow_read(struct Watched *file, int initial) {
    struct Stat st; if(stat_file(file->name,&st)<0) return;
    int probe=secure_open(file->name,O_RDONLY,0); if(probe<0) return; struct OldStat probe_stat; int valid=call(NR_fstat,probe,(isize)&probe_stat,0)==0 && owned_stat(&probe_stat,0100000); close_fd(probe); if(!valid) return;
    u64 device=probe_stat.device; st.inode=probe_stat.inode; st.size=(u64)probe_stat.size;
    if(file->fd<0 || st.inode!=file->inode || device!=file->device) { close_fd(file->fd); file->fd=secure_open(file->name,O_RDONLY|O_NONBLOCK,0); if(file->fd<0) return;
        struct OldStat opened; if(call(NR_fstat,file->fd,(isize)&opened,0)<0 || !owned_stat(&opened,0100000)) fail("presence watched identity");
        st.inode=opened.inode; st.size=(u64)opened.size; device=opened.device; file->inode=st.inode; file->device=device; file->offset=0;
        if(file==&followed[2]) { emit("\nREQUEST-GENERATION\t"); emit_number(device); emit("\t"); emit_number(st.inode); emit("\n"); }
        usize name_size=length(file->name); if(name_size>=15 && equal(file->name+name_size-15,"/requests.jsonl")) boundary("request-opened-before-watch");
        if(initial && st.size) { u64 start=st.size>LIMIT?st.size-LIMIT:0; isize n=syscall6(NR_pread,file->fd,(isize)copy_data,st.size-start,start,0,0); if(n<0) fail("presence follow initial");
            isize end=n>0 && copy_data[n-1]=='\n'?n-1:n; while(end>0 && copy_data[end-1]!='\n') end--; file->offset=start+(u64)end; }
    }
    if(st.size<file->offset) file->offset=0;
    if(st.size-file->offset>LIMIT) file->offset=st.size-LIMIT;
    u64 want=st.size-file->offset; if(!want) return;
    isize n=syscall6(NR_pread,file->fd,(isize)copy_data,want,file->offset,0,0); if(n<0) fail("presence follow read"); if(!n) return;
    usize complete=(usize)n; while(complete && copy_data[complete-1]!='\n') complete--;
    if(complete) { emit("\n==> "); emit(file->name); emit(" <==\n"); output(1,copy_data,complete); file->offset+=complete; }
    else if((usize)n==LIMIT) file->offset=st.size;
}
struct Directory { int wd; char name[PATH_MAX]; };
static void watch_parent(const char *name, struct Directory *old, const struct Directory *other) {
    char directory[PATH_MAX]; append(directory,name,directory+sizeof(directory)); char *slash=0; for(char *p=directory;*p;p++) if(*p=='/') slash=p;
    if(!slash) return; *slash=0; if(!*directory) append(directory,"/",directory+sizeof(directory));
    int directoryfd;
    for(;;) { directoryfd=secure_directory(directory,0,0); if(directoryfd>=0) break; slash=0; for(char *p=directory;*p;p++) if(*p=='/') slash=p; if(!slash || slash==directory) { append(directory,"/",directory+sizeof(directory)); directoryfd=secure_directory(directory,0,0); break; } *slash=0; }
    if(directoryfd<0) fail("presence directory watch");
    if(old->wd>=0 && equal(directory,old->name)) { close_fd(directoryfd); return; }
    char descriptor_path[64]; char *part=append(descriptor_path,"/proc/self/fd/",descriptor_path+sizeof(descriptor_path)); number(part,(u64)directoryfd);
    int wd=(int)call(NR_inotify_add,notifications,(isize)descriptor_path,WATCH_EVENTS); close_fd(directoryfd); if(wd<0) fail("presence directory watch");
    if(old->wd>=0 && old->wd!=wd && old->wd!=other->wd) call(NR_inotify_remove,notifications,old->wd,0); old->wd=wd; append(old->name,directory,old->name+sizeof(old->name));
}
static void follow(const char *folder, const char *token, const char *requests, const char *marker_arg, const char *deadline_arg) {
    for(int n=0;n<3;n++) followed[n].fd=-1;
    path(followed[0].name,folder,"presence.jsonl"); path(followed[1].name,folder,"snapshot.json"); close_fd(create_file(followed[0].name)); close_fd(create_file(followed[1].name));
    if(*requests) append(followed[2].name,requests,followed[2].name+PATH_MAX);
    char suffix[180]; append(append(append(suffix,".presence-follow-",suffix+sizeof(suffix)),token,suffix+sizeof(suffix)),".jsonl",suffix+sizeof(suffix)); path(marker,folder,suffix); if(*marker_arg && !equal(marker,marker_arg)) quit(64);
    struct Deadline deadline={0};
    if(*deadline_arg) { append(append(append(suffix,".presence-deadline-",suffix+sizeof(suffix)),token,suffix+sizeof(suffix)),".jsonl",suffix+sizeof(suffix)); path(deadline.name,folder,suffix); if(!equal(deadline.name,deadline_arg)) quit(64); }
    char regleaf[192], regname[PATH_MAX], record[8192], executable[PATH_MAX]; struct Identity self; u32 uid;
    if(!process_metadata((u64)call(NR_getpid,0,0,0),&self,executable,&uid)) fail("presence registration metadata");
    receipt(record,&self,uid,executable,token); char *regend=append(regleaf,".presence-registration-",regleaf+sizeof(regleaf)); append(regend,token,regleaf+sizeof(regleaf)); path(regname,folder,regleaf);
    publish_file(regname,record,length(record),1);
    char ready[180]; append(append(append(ready,"READY\t",ready+sizeof(ready)),token,ready+sizeof(ready)),"\n",ready+sizeof(ready)); publish_file(marker,ready,length(ready),1);
    notifications=(int)call(NR_inotify_init,O_NONBLOCK|O_CLOEXEC,0,0); if(notifications<0) fail("presence events");
    struct Directory own={.wd=-1}, request={.wd=-1}; watch_parent(followed[0].name,&own,&request); if(*requests) watch_parent(requests,&request,&own);
    emit("FOLLOW\t"); emit_number(call(NR_getpid,0,0,0)); if(*deadline_arg) emit("\tDEADLINE1"); emit("\n"); for(int n=0;n<3;n++) if(*followed[n].name) follow_read(&followed[n],1); emit("\n==> "); emit(marker); emit(" <==\n"); emit(ready);
    for(;;) { deadline_read(&deadline); deadline_emit(&deadline); deadline_wait(&deadline); isize n;
        while((n=call(NR_read,notifications,(isize)copy_data,sizeof(copy_data)))>0 || n==-EINTR) {
            if(n<0) continue;
            for(isize p=0;p+16<=n;) { int wd; u32 mask,size; memcpy(&wd,copy_data+p,4); memcpy(&mask,copy_data+p+4,4); memcpy(&size,copy_data+p+12,4); if(p+16+size>n) fail("presence event packet");
                if(mask & (0x400|0x800|0x8000)) { if(wd==own.wd) own.wd=-1; if(wd==request.wd) request.wd=-1; } p+=16+size;
            }
        }
        if(n!=-EAGAIN) fail("presence event read");
        /* Directory invalidation requires a new watch even at the same path. */
        struct Stat info; if(stat_file(own.name,&info)<0) own.wd=-1; if(*requests && stat_file(request.name,&info)<0) request.wd=-1;
        watch_parent(followed[0].name,&own,&request); if(*requests) watch_parent(requests,&request,&own); for(int k=0;k<3;k++) if(*followed[k].name) follow_read(&followed[k],0);
    }
}
static u64 child_count(u64 pid, u64 *pids, usize capacity) {
    char name[PATH_MAX]; proc_path(name,pid,"task"); int fd=open_file(name,O_RDONLY|O_DIRECTORY|O_CLOEXEC,0); if(fd<0) return 0;
    char entries[8192], children[8192]; u64 total=0; isize n;
    while((n=call(NR_getdents,fd,(isize)entries,sizeof(entries)))>0) for(isize pos=0;pos<n;) { u16 size; memcpy(&size,entries+pos+16,2); if(size<20 || pos+size>n) fail("presence task inventory"); const char *tid=entries+pos+19;
        if(*tid>='0' && *tid<='9') { char thread[PATH_MAX], base[PATH_MAX]; path(base,name,tid); path(thread,base,"children"); isize bytes=read_file(thread,children,sizeof(children)); if(bytes==(isize)sizeof(children)-1) fail("presence child inventory capacity"); if(bytes>0) { const char *position=children; while(*position) { while(*position==' ' || *position=='\n' || *position=='\t') position++; if(!*position) break; u64 child=integer(&position); if(pids) { if(total>=capacity) fail("presence child inventory capacity"); pids[total]=child; } total++; } } }
        pos+=size;
    }
    close_fd(fd); return total;
}
static u64 tree_pids[4096], tree_parents[4096], children_pids[4096];
static int stats(const char *pids, int tree) {
    usize count=0; while(*pids) { if(count>=4096) fail("presence stats capacity"); tree_pids[count]=next_pid(&pids); tree_parents[count++]=0; }
    emit("["); int comma=0; for(usize index=0;index<count;index++) { u64 pid=tree_pids[index]; int repeated=0; for(usize previous=0;previous<index;previous++) if(tree_pids[previous]==pid) repeated=1; if(repeated) continue;
        struct Identity info; if(!identity(pid,&info) || (tree_parents[index] && tree_parents[index]!=info.parent)) continue;
        u64 children=child_count(pid,tree?children_pids:0,4096);
        if(comma++) emit(","); emit("{\"pid\":"); emit_number(pid); emit(",\"parent\":"); emit_number(info.parent); emit(",\"rssBytes\":"); emit_number(info.rss*page_size); emit(",\"cpuNs\":"); emit_number(info.cpu*(1000000000/ticks)); emit(",\"children\":"); emit_number(children); emit(",\"birth\":\""); emit_birth(&info); emit("\"}");
        if(tree) for(u64 n=0;n<children;n++) { int found=0; for(usize k=0;k<count;k++) if(tree_pids[k]==children_pids[n]) found=1; if(!found) { if(count>=4096) fail("presence stats tree capacity"); tree_pids[count]=children_pids[n]; tree_parents[count++]=pid; } }
    }
    emit("]\n"); return 0;
}
static int fifo_send(const char *folder, const char *name, const char *device, const char *inode, const char *text) {
    const char *position=device; u64 expected_device,expected_inode; if(length(device)>20 || !deadline_integer(&position,&expected_device) || *position) return 64;
    position=inode; if(length(inode)>20 || !deadline_integer(&position,&expected_inode) || *position) return 64;
    usize size=length(text), begin=length(folder); if(size>65536 || !prefix(name,folder) || name[begin]!='/' || !prefix(name+begin+1,".presence-")) return 64;
    const char *token=name+begin+11,*end=token; while(*end && *end!='/') { if(!((*end>='a' && *end<='z') || (*end>='A' && *end<='Z') || (*end>='0' && *end<='9') || *end=='_' || *end=='-')) return 64; end++; }
    if(end==token || end-token>128 || !equal(end,"/commit")) return 64;
    char leaf[PATH_MAX]; int parent=secure_parent(name,leaf); if(parent<0) return 69;
    int fd=(int)syscall6(NR_openat,parent,(isize)leaf,O_WRONLY|O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC,0,0,0); close_fd(parent); struct OldStat st;
    if(fd<0 || call(NR_fstat,fd,(isize)&st,0)<0 || !owned_stat(&st,0010000) || st.device!=expected_device || st.inode!=expected_inode) { close_fd(fd); return 69; }
    struct Time beginning; if(call(NR_clock_gettime,1,(isize)&beginning,0)<0) { close_fd(fd); return 69; }
    usize sent=0;
    while(sent<size) {
        isize n=call(NR_write,fd,(isize)(text+sent),size-sent); if(n>0) { sent+=(usize)n; continue; } if(n==-EINTR) continue;
        if(n==-EAGAIN) {
            struct Time now; if(call(NR_clock_gettime,1,(isize)&now,0)<0 || now.sec-beginning.sec>=5) { close_fd(fd); return 69; }
            struct Poll wait={fd,4,0}; struct Time timeout={0,100000000}; isize ready=syscall6(NR_ppoll,(isize)&wait,1,(isize)&timeout,0,0,0);
            if((ready<0 && ready!=-EINTR) || (ready>0 && (wait.revents & (8|16|32)))) { close_fd(fd); return 69; } continue;
        }
        close_fd(fd); return 69;
    }
    close_fd(fd); return 0;
}
static int deadline_write(const char *folder, const char *token, const char *line) {
    if(!*token || length(token)>64 || length(line)>=64) return 64;
    for(const char *p=token;*p;p++) if(!((*p>='a' && *p<='z') || (*p>='A' && *p<='Z') || (*p>='0' && *p<='9') || *p=='_' || *p=='-')) return 64;
    const char *position=line; u64 generation=integer(&position); (void)generation; if(*position++!='\t') return 64; u64 at=integer(&position); (void)at; if(*position++!='\n' || *position) return 64;
    char leaf[192], target[PATH_MAX]; char *p=append(leaf,".presence-deadline-",leaf+sizeof(leaf)); p=append(p,token,leaf+sizeof(leaf)); append(p,".jsonl",leaf+sizeof(leaf)); path(target,folder,leaf);
    publish_file(target,line,length(line),0); return 0;
}


/* Shared host output uses the same verified presence file primitives. */
static char shared_data[1048576];
static int shared_input(char *data, usize cap) {
    usize used=0;
    while(used<cap) { isize n=call(NR_read,0,(isize)(data+used),cap-used); if(n==-EINTR) continue; if(n<0) return -1; if(!n) return (int)used; used+=(usize)n; }
    char extra; isize n; do { n=call(NR_read,0,(isize)&extra,1); } while(n==-EINTR); return n==0?(int)used:-1;
}
static int shared_lock(const char *folder, const char *leaf) {
    char name[PATH_MAX]; path(name,folder,leaf); int fd=secure_open(name,O_RDWR,1); if(fd<0) return -1;
    for(unsigned i=0;i<100;i++) { isize n=call(NR_flock,fd,LOCK_EX|LOCK_NB,0); if(n==0) return fd; if(n!=-EAGAIN && n!=-EINTR) break;
        struct Time timeout={0,10000000}; syscall6(NR_ppoll,0,0,(isize)&timeout,0,0,0); }
    close_fd(fd); return -1;
}
static int shared_write(const char *folder, const char *leaf) {
    if(!equal(leaf,"view.json")) return 64;
    int directory=secure_directory(folder,0,1); if(directory<0) return 69; close_fd(directory);
    /* Read the view before locking, as diagnostic_append does: a writer still sending must not hold the lock (U9). */
    int n=shared_input(shared_data,sizeof(shared_data)); if(n<0) return 69;
    int lock=shared_lock(folder,".shared-view-lock"); if(lock<0) return 69;
    char name[PATH_MAX]; path(name,folder,leaf); publish_file(name,shared_data,(usize)n,0); close_fd(lock); return 0;
}
static int diagnostic_append(const char *folder) {
    int directory=secure_directory(folder,0,1); if(directory<0) return 0;
    struct OldStat st; int enabled=secure_existing(directory,"diagnostics",&st); if(enabled!=1) { close_fd(directory); return enabled==0?0:69; }
    /* Read and check the record before locking: a writer still sending must not hold the lock. */
    char record[4096]; int n=shared_input(record,sizeof(record));
    if(n<=0 || record[n-1]!='\n') { close_fd(directory); return 0; }
    for(int i=0;i<n;i++) if(record[i]==0 || (record[i]=='\n' && i!=n-1)) { close_fd(directory); return 0; }
    int lock=shared_lock(folder,".shared-diagnostics-lock"); if(lock<0) { close_fd(directory); return 69; }
    if(secure_existing(directory,"diagnostics",&st)!=1) { close_fd(lock); close_fd(directory); return 69; }
    char name[PATH_MAX]; path(name,folder,"diagnostics.log"); usize used=0;
    int existing=secure_existing(directory,"diagnostics.log",&st);
    if(existing<0 || (existing==1 && (st.size<0 || st.size>204800))) { close_fd(lock); close_fd(directory); return 69; }
    if(existing==1) {
        int fd=secure_open(name,O_RDONLY,0); struct OldStat current;
        if(fd<0 || call(NR_fstat,fd,(isize)&current,0)<0 || current.device!=st.device || current.inode!=st.inode) { close_fd(fd); close_fd(lock); close_fd(directory); return 69; }
        usize budget=(usize)st.size;
        while(used<budget) { isize r=call(NR_read,fd,(isize)(copy_data+used),budget-used); if(r==-EINTR) continue; if(r<=0) { close_fd(fd); close_fd(lock); close_fd(directory); return 69; } used+=(usize)r; }
        close_fd(fd);
    }
    if(used+(usize)n>204800) { char rotated[PATH_MAX]; path(rotated,folder,"diagnostics.log.1"); publish_file(rotated,copy_data,used,0); used=0; }
    memcpy(copy_data+used,record,(usize)n);
    if(secure_existing(directory,"diagnostics",&st)!=1) { close_fd(lock); close_fd(directory); return 69; }
    publish_file(name,copy_data,used+(usize)n,0); close_fd(lock); close_fd(directory); return 0;
}

/* Bounded branch metadata only. Repository pointers cannot escape to arbitrary files. */
static int branch_directory(const char *name) { return secure_directory(name,0,0); }
static int branch_owned_directory(int fd) { struct OldStat st; return fd>=0 && call(NR_fstat,fd,(isize)&st,0)==0 && (st.mode & 0170000)==0040000 && st.uid==(u32)call(NR_getuid,0,0,0); }
static int branch_read(int directory, const char *name, char out[4096]) {
    int fd=(int)syscall6(NR_openat,directory,(isize)name,O_RDONLY|O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC,0,0,0); if(fd<0) return -1;
    struct OldStat st; if(call(NR_fstat,fd,(isize)&st,0)<0 || st.uid!=(u32)call(NR_getuid,0,0,0) || st.links!=1 || (st.mode & 0170000)!=0100000 || st.size<0 || st.size>=4096) { close_fd(fd); return -1; }
    usize total=0;
    while(total<4095) { isize n=call(NR_read,fd,(isize)(out+total),4095-total); if(n==-EINTR) continue; if(n<0) { close_fd(fd); return -1; } if(!n) break; for(isize i=0;i<n;i++) if(out[total+i]==0) { close_fd(fd); return -1; } total+=(usize)n; }
    char extra; isize n=call(NR_read,fd,(isize)&extra,1); close_fd(fd); if(n!=0) return -1; out[total]=0; return (int)total;
}
static int branch_canonical(const char *base, const char *target, char out[PATH_MAX]) {
    char combined[PATH_MAX]; if(target[0]=='/') append(combined,target,combined+sizeof(combined)); else path(combined,base,target);
    char *parts[PATH_MAX/2]; int count=0; char *p=combined;
    while(*p) { while(*p=='/') p++; if(!*p) break; char *start=p; while(*p && *p!='/') p++; if(*p) *p++=0;
        if(equal(start,".")) continue; if(equal(start,"..")) { if(!count) return 0; count--; } else parts[count++]=start;
    }
    out[0]=0; char *end=out; for(int i=0;i<count;i++) { end=append(end,"/",out+PATH_MAX); end=append(end,parts[i],out+PATH_MAX); } return count>0;
}
static void branch_strip(char *text) { usize n=length(text); if(n && text[n-1]=='\n') text[--n]=0; if(n && text[n-1]=='\r') text[--n]=0; }
static int branch(const char *cwd) {
    char folder[PATH_MAX]; if(!branch_canonical("/",cwd,folder)) return 1;
    for(int depth=0;depth<8;depth++) {
        int repo=branch_directory(folder); if(repo<0) return 1;
        int git=(int)syscall6(NR_openat,repo,(isize)".git",O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC,0,0,0);
        if(git<0) {
            int absent=git==-ENOENT; char pointer[4096], location[PATH_MAX]; int bytes=branch_read(repo,".git",pointer);
            if(bytes>=0) {
                branch_strip(pointer); if(!prefix(pointer,"gitdir: ") || !branch_canonical(folder,pointer+8,location)) { close_fd(repo); return 1; }
                usize len=length(folder); if(prefix(location,folder) && location[len]=='/') git=branch_directory(location);
                else {
                    char *worktree=0; for(char *p=location;*p;p++) if(prefix(p,"/.git/worktrees/")) { worktree=p; break; }
                    if(!worktree || !worktree[16]) { close_fd(repo); return 1; }
                    for(char *p=worktree+16;*p;p++) if(*p=='/') { close_fd(repo); return 1; }
                    git=branch_directory(location); char backlink[4096], common[4096], actual[PATH_MAX], expected[PATH_MAX]; path(expected,folder,".git");
                    if(!branch_owned_directory(git) || branch_read(git,"gitdir",backlink)<0 || branch_read(git,"commondir",common)<0) { close_fd(git); close_fd(repo); return 1; }
                    branch_strip(backlink); branch_strip(common); if(!equal(backlink,expected) || !branch_canonical(location,common,actual)) { close_fd(git); close_fd(repo); return 1; }
                    *worktree=0; path(expected,location,".git"); if(!equal(actual,expected)) { close_fd(git); close_fd(repo); return 1; }
                    int base=branch_directory(actual); int owned=branch_owned_directory(base); close_fd(base); if(!owned) { close_fd(git); close_fd(repo); return 1; }
                }
            } else if(!absent) { close_fd(repo); return 1; }
        }
        close_fd(repo);
        if(git>=0) {
            char head[4096]; int bytes=branch_owned_directory(git)?branch_read(git,"HEAD",head):-1; close_fd(git);
            if(bytes<0 || !prefix(head,"ref: refs/heads/")) return 1; branch_strip(head); const char *name=head+16; if(!*name || length(name)>512) return 1;
            for(const char *p=name;*p;p++) if((u8)*p<=32 || (u8)*p==127 || *p=='\\' || (*p=='.' && p[1]=='.')) return 1;
            emit(name); emit("\n"); return 0;
        }
        char *slash=0; for(char *p=folder;*p;p++) if(*p=='/') slash=p; if(!slash || slash==folder) break; *slash=0;
    }
    return 1;
}
static int main(int argc, char **argv) {
#ifdef PRESENCE_SECURITY_FIXTURE
    if(argc>=6 && equal(argv[1],"security-foreign")) { const char *p=argv[2]; fixture_foreign_inode=integer(&p); if(*p) return 64; argc-=2; argv+=2; }
    if(argc==5 && equal(argv[1],"security-rename-swap")) {
        char target[PATH_MAX],temporary[PATH_MAX]; path(target,argv[2],argv[3]); path(temporary,argv[2],".security-swap-stage");
        int original=secure_open(temporary,O_WRONLY|O_CREAT|O_EXCL,0); if(original<0) return 69;
        output(original,"original\n",9); secure_unlink(temporary,0);
        int replacement=secure_open(temporary,O_WRONLY|O_CREAT|O_EXCL,0); if(replacement<0) return 69;
        output(replacement,"replacement\n",12); close_fd(replacement);
        int result=equal(argv[4],"cleanup")?secure_unlink_owned(temporary,original,0):secure_rename(temporary,target,0,original);
        close_fd(original); return result==0?0:69;
    }
    if(argc==4 && equal(argv[1],"security-unlink")) { char target[PATH_MAX]; path(target,argv[2],argv[3]); return secure_unlink(target,0)==0?0:69; }
    if(argc==5 && equal(argv[1],"security-stage-swap")) { fixture_stage_link=argv[4]; char target[PATH_MAX]; path(target,argv[2],argv[3]); publish_file(target,"owned\n",6,0); return 0; }
    if(argc==4 && equal(argv[1],"security-write")) { create_folder(argv[2]); char target[PATH_MAX], temporary[PATH_MAX]; path(target,argv[2],argv[3]); path(temporary,argv[2],".security-stage"); int fd=store_file(temporary,"owned"); int result=secure_rename(temporary,target,0,fd); secure_unlink_owned(temporary,fd,0); close_fd(fd); return result==0?0:69; }
    if(argc==4 && equal(argv[1],"security-read")) { char target[PATH_MAX]; path(target,argv[2],argv[3]); int fd=secure_open(target,O_RDONLY,0); if(fd<0) return 69; close_fd(fd); return 0; }
    if(argc==4 && equal(argv[1],"security-open")) { char target[PATH_MAX]; path(target,argv[2],argv[3]); int fd=create_file(target); close_fd(fd); return 0; }
    if(argc==4 && equal(argv[1],"security-registration")) { char expected[8192], digits[32]; char *p=append(expected,"44\t22\tdarwin:1:2\t",expected+sizeof(expected)); number(digits,(u64)call(NR_getuid,0,0,0)); p=append(p,digits,expected+sizeof(expected)); p=append(p,"\t/fixture/helper\t",expected+sizeof(expected)); p=append(p,argv[3],expected+sizeof(expected)); append(p,"\n",expected+sizeof(expected)); return registered(argv[2],argv[3],expected)?0:69; }
#endif
    if(argc==7 && equal(argv[2],"fifo-send")) return fifo_send(argv[1],argv[3],argv[4],argv[5],argv[6]);
    if(argc==5 && equal(argv[2],"deadline-write")) return deadline_write(argv[1],argv[3],argv[4]);
    if(argc==4 && equal(argv[1],"write-shared")) return shared_write(argv[2],argv[3]);
    if(argc==3 && equal(argv[1],"diagnostic-append")) return diagnostic_append(argv[2]);
    if(argc==3 && equal(argv[1],"branch")) return branch(argv[2]);
    int observing=!(argc==3 && (equal(argv[1],"stats") || equal(argv[1],"stats-tree")));
    if(observing) {
        /* Arm host death before reading files, validating arguments, or waiting.
         * PID1 is rejected so a child orphaned before its first instruction
         * cannot accidentally subscribe to init and wait forever. */
        host=(int)call(NR_getppid,0,0,0); if(host<=1) return 69;
        if(syscall6(NR_prctl,1,SIGKILL,0,0,0,0)<0) fail("presence parent death event"); parent_alive();
    }
    if(read_file("/proc/sys/kernel/random/boot_id",boot,sizeof(boot))<0) fail("presence boot identity"); usize end=length(boot); while(end && (boot[end-1]=='\n' || boot[end-1]=='\r')) boot[--end]=0;
    if(argc==3 && (equal(argv[1],"stats") || equal(argv[1],"stats-tree"))) return stats(argv[2],equal(argv[1],"stats-tree"));
    if(argc<4 || (!equal(argv[2],"follow") && !equal(argv[2],"transaction"))) return 64;
    const char *token=argv[3]; if(!*token || length(token)>128) return 64; for(const char *p=token;*p;p++) if(!((*p>='a' && *p<='z') || (*p>='A' && *p<='Z') || (*p>='0' && *p<='9') || *p=='_' || *p=='-')) return 64;
    const char *requests=argc>4?argv[4]:"", *remove=argc>5?argv[5]:"", *marker_arg=argc>6?argv[6]:"";
    if(*remove && (!prefix(token,remove) || token[length(remove)]!='-')) return 64;
    call(NR_umask,077,0,0); parent_alive(); create_folder(argv[1]);
    if(equal(argv[2],"follow")) follow(argv[1],token,requests,marker_arg,argc>7?argv[7]:""); else transaction(argv[1],token,remove); return 0;
}
__attribute__((used,noreturn)) void entry(usize *stack) {
    int argc=(int)*stack++; char **argv=(char **)stack; char **p=argv+argc+1;
#ifdef PRESENCE_TEST_BOUNDARIES
    for(char **own=p;*own;own++) if(prefix(*own,"COCO_TEST_BOUNDARY=")) test_boundary=*own+length("COCO_TEST_BOUNDARY=");
#endif
     while(*p) p++; usize *aux=(usize *)(p+1);
    for(;aux[0];aux+=2) { if(aux[0]==6) page_size=aux[1]; if(aux[0]==17) ticks=aux[1]; }
    quit(main(argc,argv));
}
