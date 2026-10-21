//! The Windows presence helper for real (lane C, 10-16): real followers, transactions, the pet's lock and named
//! pipes, driven the way the plugin's SharedPresence drives them (hooks-source/presence.ts). Windows only; in the
//! cloud it runs under Wine:
//!   CARGO_TARGET_X86_64_PC_WINDOWS_GNU_RUNNER=wine64 cargo test --target x86_64-pc-windows-gnu --test presence_windows
#![cfg(windows)]
use coco_companion::{
    platform::windows::acquire_presence_lock, presence_helper as protocol, presence_store::PresenceStore,
};
use std::{
    io::{BufRead, BufReader},
    path::Path,
    process::{Child, Command, Stdio},
    sync::mpsc,
    time::{Duration, Instant},
};
use windows::Win32::{
    Foundation::{CloseHandle, WAIT_OBJECT_0},
    System::Threading::{OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE},
};

const EXE: &str = env!("CARGO_BIN_EXE_coco-companion");
const LINE: Duration = Duration::from_secs(20);

fn folder(name: &str) -> String {
    let path = std::env::temp_dir().join(format!("coco-presence-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&path);
    path.to_string_lossy().into_owned()
}
fn helper(args: &[&str]) -> Command {
    let mut command = Command::new(EXE);
    command.arg("presence").args(args).stdin(Stdio::null());
    command
}
fn run(args: &[&str]) -> i32 {
    helper(args).status().unwrap().code().unwrap()
}

struct Lines {
    rx: mpsc::Receiver<String>,
    child: Child,
}
impl Lines {
    fn start(mut command: Command) -> Self {
        let mut child = command.stdout(Stdio::piped()).spawn().unwrap();
        let out = child.stdout.take().unwrap();
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(out).lines().map_while(Result::ok) {
                if tx.send(line).is_err() {
                    break;
                }
            }
        });
        Self { rx, child }
    }
    fn next(&self) -> String {
        self.rx.recv_timeout(LINE).expect("a line from the helper")
    }
    /// The lines up to and including the first that matches.
    fn until(&self, done: impl Fn(&str) -> bool) -> Vec<String> {
        let mut lines = Vec::new();
        loop {
            let line = self.next();
            let last = done(&line);
            lines.push(line);
            if last {
                return lines;
            }
        }
    }
    fn silent_for(&self, wait: Duration) -> bool {
        self.rx.recv_timeout(wait).is_err()
    }
}

struct Follower {
    lines: Lines,
    pid: u32,
}
fn follower(folder: &str, owner: &str) -> Follower {
    let (marker, deadline) = (protocol::follow_marker(folder, owner), protocol::deadline_file(folder, owner));
    let lines = Lines::start(helper(&[folder, "follow", owner, "", "", &marker, &deadline]));
    let first = lines.next();
    let pid = first
        .strip_prefix("FOLLOW\t")
        .and_then(|rest| rest.strip_suffix("\tDEADLINE1"))
        .and_then(|pid| pid.parse().ok())
        .unwrap_or_else(|| panic!("FOLLOW line: {first}"));
    assert_eq!(pid, lines.child.id());
    lines.until(|line| line == format!("READY\t{owner}"));
    Follower { lines, pid }
}

#[derive(Debug, Clone, PartialEq)]
struct Listed {
    pid: u32,
    parent: u32,
    birth: String,
    executable: String,
    token: String,
}
struct Transaction {
    lines: Lines,
    folder: String,
    host: u32,
    path: String,
    server: String,
    nonce: String,
    before: Vec<String>,
}
impl Transaction {
    fn begin(folder: &str, token: &str, leaving: &str) -> Self {
        Self::read(Lines::start(helper(&[folder, "transaction", token, "", leaving])), folder)
    }
    fn read(lines: Lines, folder: &str) -> Self {
        let header = lines.next();
        let parts: Vec<&str> = header.split('\t').collect();
        assert_eq!((parts[0], parts.len()), ("PRESENCE", 5), "{header}");
        let before = lines.until(|line| line == "INSPECT");
        Self {
            folder: folder.into(),
            host: parts[1].parse().unwrap(),
            path: parts[2].into(),
            server: parts[3].into(),
            nonce: parts[4].into(),
            before,
            lines,
        }
    }
    /// The plugin's sendFIFO: pieces of at most 16384 characters, each by its own fifo-send.
    fn send(&self, text: &str) {
        for piece in text.as_bytes().chunks(16384) {
            let piece = std::str::from_utf8(piece).unwrap();
            assert_eq!(
                run(&[&self.folder, "fifo-send", &self.path, &self.server, &self.nonce, piece]),
                0
            );
        }
    }
    fn inventory(&self, pids: &str) -> Vec<Listed> {
        self.send(&format!("{pids}\n"));
        let lines = self.lines.until(|line| line == "READY");
        lines[..lines.len() - 1]
            .iter()
            .map(|line| {
                let p: Vec<&str> = line.split('\t').collect();
                assert_eq!((p[0], p.len(), p[4]), ("PID", 7, "0"), "{line}");
                Listed {
                    pid: p[1].parse().unwrap(),
                    parent: p[2].parse().unwrap(),
                    birth: p[3].into(),
                    executable: p[5].into(),
                    token: p[6].into(),
                }
            })
            .collect()
    }
    fn commit(mut self, text: &str) {
        self.send(&format!("{text}\n"));
        assert_eq!(self.lines.next(), "COMMITTED");
        assert_eq!(self.lines.child.wait().unwrap().code(), Some(0));
    }
}

fn record(seq: u64, claims: serde_json::Value) -> String {
    let now = coco_companion::epoch_ms();
    serde_json::json!({
        "v": 1, "seq": seq, "quietAt": now, "asleep": false, "clingy": false, "busy": false, "lang": "en",
        "event": {"kind": "initial", "id": format!("initial:0:{now}"), "at": now, "lang": "en"},
        "claims": claims,
    })
    .to_string()
}
fn ended(pid: u32, within: Duration) -> bool {
    unsafe {
        let Ok(handle) = OpenProcess(PROCESS_SYNCHRONIZE, false, pid) else {
            return true;
        };
        let done = WaitForSingleObject(handle, within.as_millis() as u32) == WAIT_OBJECT_0;
        let _ = CloseHandle(handle);
        done
    }
}

#[test]
fn a_commit_reaches_every_follower_and_the_pet_reads_the_same_claims() {
    let folder = folder("commit");
    let follower = follower(&folder, "ownerA");
    let me = std::process::id();
    let tx = Transaction::begin(&folder, "ownerA-t1", "");
    assert_eq!(tx.host, me, "the host is the program that started the helper");
    assert_eq!(tx.path, protocol::commit_path(&folder, "ownerA-t1"));
    assert_eq!(tx.server, tx.lines.child.id().to_string());
    let listed = tx.inventory(&format!("{}:ownerA,{me},{}:ownerB", follower.pid, follower.pid));
    // The follower is bound to its own token only; the host is listed without one.
    assert_eq!(listed.len(), 3, "{listed:?}");
    assert_eq!((listed[0].pid, listed[0].parent, listed[0].token.as_str()), (follower.pid, me, "ownerA"));
    assert!(listed[0].birth.starts_with("windows:") && listed[0].executable.ends_with("coco-companion.exe"));
    assert_eq!((listed[1].pid, listed[1].token.as_str()), (me, ""));
    assert_eq!((listed[2].pid, listed[2].token.as_str()), (follower.pid, ""));
    let host = &listed[1];
    let claims = serde_json::json!({
        format!("{}:ownerA", follower.pid): {
            "session": "s1", "owner": "ownerA", "pid": follower.pid, "birth": listed[0].birth, "busy": false,
            "hostPid": me, "hostBirth": host.birth, "uid": 0, "executable": listed[0].executable,
        }
    });
    let line = record(1, claims);
    tx.commit(&line);
    assert_eq!(std::fs::read_to_string(Path::new(&folder).join("snapshot.json")).unwrap(), format!("{line}\n"));
    assert!(std::fs::read_to_string(Path::new(&folder).join("presence.jsonl")).unwrap().ends_with(&format!("{line}\n")));
    follower.lines.until(|forwarded| forwarded == line);
    // The pet decides with its own process checks and keeps the live claim as it is.
    let mut pet = PresenceStore::new(folder.clone().into());
    let seen = pet.decide(coco_companion::epoch_ms()).unwrap().unwrap();
    assert_eq!((seen.seq, seen.claims.len()), (1, 1));
    // The follower ends: the pet drops its claim.
    let Follower { mut lines, .. } = follower;
    lines.child.kill().unwrap();
    lines.child.wait().unwrap();
    let seen = pet.decide(coco_companion::epoch_ms()).unwrap().unwrap();
    assert_eq!((seen.seq, seen.claims.len()), (2, 0));
}

#[test]
fn one_transaction_at_a_time_and_the_pet_waits_for_it() {
    let folder = folder("lock");
    let first = Transaction::begin(&folder, "o-t1", "");
    assert!(acquire_presence_lock(Path::new(&folder)).unwrap().is_none(), "the pet cannot take it meanwhile");
    let second = Lines::start(helper(&[&folder, "transaction", "o-t2", "", ""]));
    assert!(second.silent_for(Duration::from_millis(800)), "the second waits for the lock");
    first.inventory("");
    first.commit("-");
    let second = Transaction::read(second, &folder);
    second.inventory("");
    second.commit("-");
    // And the other way round: while the pet holds it, a transaction waits.
    let pet = acquire_presence_lock(Path::new(&folder)).unwrap().expect("free again");
    let third = Lines::start(helper(&[&folder, "transaction", "o-t3", "", ""]));
    assert!(third.silent_for(Duration::from_millis(800)), "the transaction waits for the pet");
    drop(pet);
    let third = Transaction::read(third, &folder);
    third.inventory("");
    third.commit("-");
}

#[test]
fn a_long_record_arrives_in_pieces_and_a_wrong_server_is_refused() {
    let folder = folder("pieces");
    let tx = Transaction::begin(&folder, "p-t1", "");
    assert_eq!(run(&[&folder, "fifo-send", &tx.path, "4", &tx.nonce, "1\n"]), 69);
    assert_eq!(run(&[&folder, "fifo-send", &tx.path, &tx.server, "12345", "1\n"]), 69);
    // The list itself in two pieces, the second one ending the line.
    let me = std::process::id().to_string();
    let (head, tail) = me.split_at(1);
    assert_eq!(run(&[&folder, "fifo-send", &tx.path, &tx.server, &tx.nonce, head]), 0);
    tx.send(&format!("{tail}\n"));
    let listed = tx.lines.until(|line| line == "READY");
    assert_eq!(listed.len(), 2, "{listed:?}");
    assert!(listed[0].starts_with(&format!("PID\t{me}\t")));
    let mut long = record(1, serde_json::json!({}));
    long.insert_str(1, &format!("\"pad\":\"{}\",", "x".repeat(40_000)));
    tx.commit(&long);
    assert_eq!(std::fs::read_to_string(Path::new(&folder).join("snapshot.json")).unwrap(), format!("{long}\n"));
    // A second transaction sees it as state and as the journal.
    let next = Transaction::begin(&folder, "p-t2", "");
    assert!(next.before.contains(&format!("STATE\t{long}")));
    assert!(next.before.contains(&format!("LOG\t{long}")));
    next.inventory("");
    next.commit("-");
}

#[test]
fn deadlines_arrive_on_time_and_leaving_takes_the_followers_files() {
    let folder = folder("deadline");
    let follower = follower(&folder, "leaver");
    let at = coco_companion::epoch_ms() + 600;
    let started = Instant::now();
    assert_eq!(run(&[&folder, "deadline-write", "leaver", &format!("1\t{at}\n")]), 0);
    follower.lines.until(|line| line == format!("DEADLINE\t1\t{at}"));
    assert!(coco_companion::epoch_ms() >= at, "not before its time");
    assert!(started.elapsed() < Duration::from_secs(10));
    let files = [
        protocol::follow_marker(&folder, "leaver"),
        protocol::deadline_file(&folder, "leaver"),
        protocol::registration_file(&folder, "leaver"),
    ];
    assert!(files.iter().all(|file| Path::new(file).is_file()));
    let tx = Transaction::begin(&folder, "leaver-t1", "leaver");
    tx.inventory("");
    tx.commit("-");
    assert!(files.iter().all(|file| !Path::new(file).exists()));
    // A transaction may only remove its own owner.
    assert_eq!(run(&[&folder, "transaction", "other-t1", "", "leaver"]), 64);
}

/// Not a test of its own: the stand-in for Claude Code in the next one, started with COCO_PRESENCE_HOST set.
#[test]
fn host_process() {
    let Ok(folder) = std::env::var("COCO_PRESENCE_HOST") else {
        return;
    };
    let follower = follower(&folder, "gone");
    let tx = Transaction::begin(&folder, "gone-t1", "");
    println!("FOLLOWER {}", follower.pid);
    println!("TX {}", tx.lines.child.id());
    std::process::exit(0);
}

#[test]
fn helpers_end_with_the_program_that_started_them_and_free_the_lock() {
    let folder = folder("host");
    let mut host = Command::new(std::env::current_exe().unwrap())
        .args(["host_process", "--exact", "--nocapture", "--test-threads=1"])
        .env("COCO_PRESENCE_HOST", &folder)
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let out = BufReader::new(host.stdout.take().unwrap());
    let mut pids = Vec::new();
    // The test harness may print its own words on the same line first.
    for line in out.lines().map_while(Result::ok) {
        for marker in ["FOLLOWER ", "TX "] {
            if let Some(at) = line.find(marker) {
                pids.push(line[at + marker.len()..].trim().parse::<u32>().unwrap());
            }
        }
    }
    host.wait().unwrap();
    assert_eq!(pids.len(), 2, "the host started a follower and a transaction");
    for pid in pids {
        assert!(ended(pid, Duration::from_secs(10)), "helper {pid} ended with its host");
    }
    assert!(acquire_presence_lock(Path::new(&folder)).unwrap().is_some());
}

#[test]
fn nothing_answers_without_its_pipe() {
    let folder = folder("nopipe");
    std::fs::create_dir_all(&folder).unwrap();
    let path = protocol::commit_path(&folder, "none-t1");
    let started = Instant::now();
    assert_eq!(run(&[&folder, "fifo-send", &path, "4", "1", "x\n"]), 69);
    assert!(started.elapsed() < Duration::from_secs(4));
    assert_eq!(run(&[&folder, "watch-companion", "4", "darwin:1:2"]), 64);
}
