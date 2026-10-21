//! The shared presence helper on Windows (lane C, 10-16; DECISIONS 941 「Windows 也启动共享的后台」). The plugin's
//! SharedPresence (hooks-source/presence.ts) keeps one follower per session and runs short transactions through
//! `bin/presence.sh` on macOS and Linux; on Windows it runs this program instead, `coco-companion presence <folder>
//! <verb> ...`, with the verbs, arguments and output of presence-linux.c: follow, transaction, fifo-send and
//! deadline-write. So every window and the pet share one presence on Windows too, and sleep and wake together.
//!
//! Windows has no FIFO in the folder: a transaction listens on a named pipe for the two lines the plugin sends back.
//! The PRESENCE header still names `<folder>\.presence-<token>\commit`, and its "device" and "inode" fields carry
//! the transaction's process id and the pipe name's random part; fifo-send connects only to a pipe served by that
//! process. This file is the part that is the same everywhere (arguments, names, receipts, the deadline file, the
//! journal rule), tested on any system; platform/windows_presence_helper.rs does the Windows calls.

/// One line, the snapshot and the whole journal: the plugin's MAX_LINE and presence-linux.c's LIMIT.
pub const LIMIT: usize = 256 * 1024;
/// A pid list: at most this many processes (presence-linux.c inventory).
pub const MAX_PIDS: usize = 2048;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Verb {
    Follow {
        folder: String,
        token: String,
        requests: String,
        deadline: bool,
    },
    Transaction {
        folder: String,
        token: String,
        remove: String,
    },
    FifoSend {
        token: String,
        server: u32,
        nonce: u64,
        text: String,
    },
    DeadlineWrite {
        folder: String,
        token: String,
        line: String,
    },
}

/// Usage errors exit 64 and everything that fails at run time 69, as presence-linux.c does.
pub const USAGE: u8 = 64;
pub const UNAVAILABLE: u8 = 69;

fn token_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_' || c == '-'
}
pub fn valid_token(token: &str, longest: usize) -> bool {
    !token.is_empty() && token.len() <= longest && token.chars().all(token_char)
}
fn digits(text: &str, longest: usize) -> Option<u64> {
    if text.is_empty() || text.len() > longest || !text.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    text.parse().ok()
}
/// A folder the plugin made with joinPath for a Windows root: a drive or a network path, nothing a header line
/// could not carry.
pub fn windows_folder(folder: &str) -> bool {
    let bytes = folder.as_bytes();
    let drive = bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/');
    let network = folder.starts_with("\\\\");
    (drive || network) && folder.len() < 4096 && !folder.chars().any(char::is_control)
}
/// The plugin's joinPath for a Windows root: one backslash between the folder and the leaf.
pub fn join(folder: &str, leaf: &str) -> String {
    if folder.ends_with('\\') || folder.ends_with('/') {
        format!("{folder}{leaf}")
    } else {
        format!("{folder}\\{leaf}")
    }
}
pub fn follow_marker(folder: &str, token: &str) -> String {
    join(folder, &format!(".presence-follow-{token}.jsonl"))
}
pub fn deadline_file(folder: &str, token: &str) -> String {
    join(folder, &format!(".presence-deadline-{token}.jsonl"))
}
pub fn registration_file(folder: &str, token: &str) -> String {
    join(folder, &format!(".presence-registration-{token}"))
}
pub fn work_folder(folder: &str, token: &str) -> String {
    join(folder, &format!(".presence-{token}"))
}
pub fn commit_path(folder: &str, token: &str) -> String {
    join(&work_folder(folder, token), "commit")
}
pub fn pipe_name(token: &str, nonce: u64) -> String {
    format!(r"\\.\pipe\coco-presence-{token}-{nonce}")
}

/// `presence <folder> <verb> ...` after the word `presence`: the same argument places as presence.sh's.
pub fn parse(args: &[String]) -> Result<Verb, u8> {
    let arg = |n: usize| args.get(n).map(String::as_str).unwrap_or("");
    let folder = arg(0);
    if !windows_folder(folder) {
        return Err(USAGE);
    }
    match (arg(1), args.len()) {
        ("fifo-send", 6) => {
            let (path, server, nonce, text) = (arg(2), arg(3), arg(4), arg(5));
            let server = digits(server, 20)
                .filter(|pid| (1..=u32::MAX as u64).contains(pid))
                .ok_or(USAGE)? as u32;
            let nonce = digits(nonce, 20).ok_or(USAGE)?;
            if text.len() > 65536 {
                return Err(USAGE);
            }
            // <folder>\.presence-<token>\commit, nothing else.
            let rest = path
                .strip_prefix(folder)
                .and_then(|rest| rest.strip_prefix("\\.presence-"))
                .and_then(|rest| rest.strip_suffix("\\commit"))
                .ok_or(USAGE)?;
            if !valid_token(rest, 128) {
                return Err(USAGE);
            }
            Ok(Verb::FifoSend {
                token: rest.into(),
                server,
                nonce,
                text: text.into(),
            })
        }
        ("deadline-write", 4) => {
            let (token, line) = (arg(2), arg(3));
            if !valid_token(token, 64) || line.len() >= 64 || parse_deadline(line).is_none() {
                return Err(USAGE);
            }
            Ok(Verb::DeadlineWrite {
                folder: folder.into(),
                token: token.into(),
                line: line.into(),
            })
        }
        (verb @ ("follow" | "transaction"), 3..=7) => {
            let token = arg(2);
            if !valid_token(token, 128) {
                return Err(USAGE);
            }
            let (requests, remove, marker, deadline) = (arg(3), arg(4), arg(5), arg(6));
            if !remove.is_empty()
                && !token
                    .strip_prefix(remove)
                    .is_some_and(|rest| rest.starts_with('-'))
            {
                return Err(USAGE);
            }
            if verb == "transaction" {
                return Ok(Verb::Transaction {
                    folder: folder.into(),
                    token: token.into(),
                    remove: remove.into(),
                });
            }
            if (!marker.is_empty() && marker != follow_marker(folder, token))
                || (!deadline.is_empty() && deadline != deadline_file(folder, token))
                || !(requests.is_empty() || windows_folder(requests))
            {
                return Err(USAGE);
            }
            Ok(Verb::Follow {
                folder: folder.into(),
                token: token.into(),
                requests: requests.into(),
                deadline: !deadline.is_empty(),
            })
        }
        _ => Err(USAGE),
    }
}

/// What a process says about itself in an inventory and in its registration file:
/// `pid parent birth uid executable token`, tab separated, one line. Windows has no uid; every process an inventory
/// lists runs as this user, so it is 0 there.
pub fn receipt(pid: u32, parent: u32, birth: &str, uid: u32, executable: &str, token: &str) -> String {
    format!("{pid}\t{parent}\t{birth}\t{uid}\t{executable}\t{token}\n")
}
/// The executable as an inventory may carry it: an absolute path without tabs or line breaks.
pub fn listed_executable(executable: &str) -> bool {
    !executable.is_empty()
        && executable.len() < 4096
        && !executable.contains(['\t', '\r', '\n'])
        && windows_folder(executable)
}

/// The plugin's pid list, `pid` or `pid:token`, comma separated (presence-linux.c inventory).
pub fn parse_pids(line: &str) -> Result<Vec<(u32, String)>, u8> {
    let mut out = Vec::new();
    if line.is_empty() {
        return Ok(out);
    }
    for entry in line.split(',') {
        if out.len() >= MAX_PIDS {
            return Err(USAGE);
        }
        let (pid, token) = entry.split_once(':').unwrap_or((entry, ""));
        let pid = digits(pid, 10)
            .filter(|pid| (1..=2147483647).contains(pid))
            .ok_or(USAGE)? as u32;
        if entry.contains(':') && !valid_token(token, 64) {
            return Err(USAGE);
        }
        out.push((pid, token.into()));
    }
    Ok(out)
}

/// `<generation>\t<at>\n`, both at most i64::MAX (presence-linux.c deadline_integer).
pub fn parse_deadline(line: &str) -> Option<(u64, u64)> {
    let body = line.strip_suffix('\n')?;
    let (generation, at) = body.split_once('\t')?;
    let number = |text: &str| digits(text, 19).filter(|n| *n <= i64::MAX as u64);
    Some((number(generation)?, number(at)?))
}

/// The follower's view of its deadline file: a newer generation replaces the wait, a repeated one keeps it, a
/// different time under the same generation is ignored, and a deadline fires once.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Deadline {
    generation: u64,
    at: u64,
    seen: bool,
    valid: bool,
    fired: bool,
}
impl Deadline {
    /// The file's contents, or nothing when it is missing, not a plain file or 63 bytes or more.
    pub fn read(&mut self, text: Option<&[u8]>) {
        self.valid = false;
        let Some((generation, at)) = text
            .filter(|bytes| bytes.len() < 63)
            .and_then(|bytes| std::str::from_utf8(bytes).ok())
            .and_then(parse_deadline)
        else {
            return;
        };
        if self.seen && generation < self.generation {
            return;
        }
        if !self.seen || generation != self.generation {
            *self = Self {
                generation,
                at,
                seen: true,
                valid: false,
                fired: false,
            };
        } else if at != self.at {
            return;
        }
        self.valid = true;
    }
    fn armed(&self) -> bool {
        self.valid && !self.fired && self.at > 0
    }
    /// How long until it is due, when one is armed.
    pub fn remaining(&self, now: u64) -> Option<u64> {
        self.armed().then(|| self.at.saturating_sub(now))
    }
    /// The packet to write when it is due: generation and time.
    pub fn due(&self, now: u64) -> Option<(u64, u64)> {
        (self.armed() && self.at <= now).then_some((self.generation, self.at))
    }
    pub fn fire(&mut self) {
        self.fired = true;
    }
}

/// The bytes up to and including the last line break: a follower forwards only whole lines.
pub fn whole_lines(bytes: &[u8]) -> usize {
    bytes.iter().rposition(|b| *b == b'\n').map_or(0, |n| n + 1)
}
/// Where a follower starts reading a file it opens for the first time: the start of its last whole line, so the
/// newest record is the first thing it forwards. `start` is where `bytes` begins in the file.
pub fn first_offset(bytes: &[u8], start: u64) -> u64 {
    let mut end = bytes.len();
    if end > 0 && bytes[end - 1] == b'\n' {
        end -= 1;
    }
    while end > 0 && bytes[end - 1] != b'\n' {
        end -= 1;
    }
    start + end as u64
}

/// STATE and LOG lines: every line of a file under one tag, an unfinished last line too (presence-linux.c
/// copy_output). A file over the limit is left out.
pub fn tagged(bytes: &[u8], tag: &str) -> Vec<u8> {
    let mut out = Vec::new();
    if bytes.len() > LIMIT {
        return out;
    }
    let mut at = 0;
    while at < bytes.len() {
        let end = bytes[at..]
            .iter()
            .position(|b| *b == b'\n')
            .map_or(bytes.len(), |n| at + n);
        out.extend_from_slice(tag.as_bytes());
        out.extend_from_slice(&bytes[at..end]);
        out.push(b'\n');
        at = end + 1;
    }
    out
}

/// How a committed record joins the journal: appended, or the journal starts again with it once the two together
/// would pass the limit. A journal whose last line was cut short gets a line break first, so the record stays whole.
#[derive(Debug, PartialEq, Eq)]
pub enum Journal {
    Append(Vec<u8>),
    Restart(Vec<u8>),
}
pub fn journal(previous_len: u64, ends_whole: bool, commit: &str) -> Journal {
    let mut line = Vec::with_capacity(commit.len() + 2);
    if previous_len > 0 && !ends_whole {
        line.push(b'\n');
    }
    line.extend_from_slice(commit.as_bytes());
    line.push(b'\n');
    if previous_len + line.len() as u64 > LIMIT as u64 {
        Journal::Restart(format!("{commit}\n").into_bytes())
    } else {
        Journal::Append(line)
    }
}

/// The verb's exit status: 0 done, 64 a malformed request, 69 not possible here.
pub fn main(args: &[String]) -> u8 {
    let verb = match parse(args) {
        Ok(verb) => verb,
        Err(code) => return code,
    };
    #[cfg(windows)]
    {
        crate::platform::windows::presence_helper::run(verb)
    }
    #[cfg(not(windows))]
    {
        // macOS and Linux run bin/presence.sh.
        let _ = verb;
        UNAVAILABLE
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }
    const F: &str = r"C:\Users\pat\.local\state\coco";

    #[test]
    fn the_verbs_take_presence_shs_arguments_and_nothing_else() {
        let marker = follow_marker(F, "abc");
        let deadline = deadline_file(F, "abc");
        assert_eq!(marker, r"C:\Users\pat\.local\state\coco\.presence-follow-abc.jsonl");
        assert_eq!(
            parse(&args(&[F, "follow", "abc", "", "", &marker, &deadline])),
            Ok(Verb::Follow {
                folder: F.into(),
                token: "abc".into(),
                requests: "".into(),
                deadline: true
            })
        );
        assert_eq!(
            parse(&args(&[F, "follow", "abc", "", "", &marker])),
            Ok(Verb::Follow {
                folder: F.into(),
                token: "abc".into(),
                requests: "".into(),
                deadline: false
            })
        );
        // Another owner's marker, a deadline file of someone else, a relative folder, a bad token.
        assert_eq!(
            parse(&args(&[F, "follow", "abc", "", "", &follow_marker(F, "abd")])),
            Err(USAGE)
        );
        assert_eq!(
            parse(&args(&[F, "follow", "abc", "", "", &marker, &deadline_file(F, "x")])),
            Err(USAGE)
        );
        assert_eq!(parse(&args(&["coco", "follow", "abc"])), Err(USAGE));
        assert_eq!(parse(&args(&["/home/pat", "follow", "abc"])), Err(USAGE));
        assert_eq!(parse(&args(&[F, "follow", "a b"])), Err(USAGE));
        assert_eq!(parse(&args(&[F, "follow", &"a".repeat(129)])), Err(USAGE));
        assert_eq!(
            parse(&args(&[F, "transaction", "owner-tx1", "", "owner"])),
            Ok(Verb::Transaction {
                folder: F.into(),
                token: "owner-tx1".into(),
                remove: "owner".into()
            })
        );
        // Only the transaction's own owner can be removed.
        assert_eq!(
            parse(&args(&[F, "transaction", "owner-tx1", "", "own"])),
            Err(USAGE)
        );
        assert_eq!(
            parse(&args(&[F, "deadline-write", "abc", "7\t1700000000000\n"])),
            Ok(Verb::DeadlineWrite {
                folder: F.into(),
                token: "abc".into(),
                line: "7\t1700000000000\n".into()
            })
        );
        assert_eq!(
            parse(&args(&[F, "deadline-write", "abc", "7\t1700000000000"])),
            Err(USAGE)
        );
        // watch-companion is the Mac pet's; stats and branch belong to other helpers.
        assert_eq!(parse(&args(&[F, "watch-companion", "4", "darwin:1:2"])), Err(USAGE));
        assert_eq!(parse(&args(&[F, "stats", "4"])), Err(USAGE));
    }

    #[test]
    fn fifo_send_reaches_only_a_commit_pipe_of_this_folder() {
        let path = commit_path(F, "own-tx2");
        assert_eq!(path, r"C:\Users\pat\.local\state\coco\.presence-own-tx2\commit");
        assert_eq!(
            parse(&args(&[F, "fifo-send", &path, "4242", "18446744073709551615", "1,2\n"])),
            Ok(Verb::FifoSend {
                token: "own-tx2".into(),
                server: 4242,
                nonce: u64::MAX,
                text: "1,2\n".into()
            })
        );
        assert_eq!(pipe_name("own-tx2", 9), r"\\.\pipe\coco-presence-own-tx2-9");
        for bad in [
            commit_path(r"C:\elsewhere", "own-tx2"),
            join(&work_folder(F, "own-tx2"), "other"),
            join(&work_folder(F, "own tx2"), "commit"),
            join(F, "commit"),
        ] {
            assert_eq!(
                parse(&args(&[F, "fifo-send", &bad, "4242", "1", "x"])),
                Err(USAGE),
                "{bad}"
            );
        }
        assert_eq!(parse(&args(&[F, "fifo-send", &path, "0", "1", "x"])), Err(USAGE));
        assert_eq!(parse(&args(&[F, "fifo-send", &path, "4294967296", "1", "x"])), Err(USAGE));
        assert_eq!(
            parse(&args(&[F, "fifo-send", &path, "1", "1", &"x".repeat(65537)])),
            Err(USAGE)
        );
    }

    #[test]
    fn pid_lists_and_receipts_match_the_linux_helper() {
        assert_eq!(
            parse_pids("12:own_1,7,12"),
            Ok(vec![(12, "own_1".into()), (7, "".into()), (12, "".into())])
        );
        assert_eq!(parse_pids(""), Ok(vec![]));
        for bad in ["0", "2147483648", "1:", "1:a b", "a", "1,,2", &format!("1:{}", "a".repeat(65))] {
            assert_eq!(parse_pids(bad), Err(USAGE), "{bad}");
        }
        assert_eq!(parse_pids(&vec!["1"; MAX_PIDS].join(",")).map(|v| v.len()), Ok(MAX_PIDS));
        assert_eq!(parse_pids(&vec!["1"; MAX_PIDS + 1].join(",")), Err(USAGE));
        assert_eq!(
            receipt(12, 7, "windows:133", 0, r"C:\Program Files\nodejs\node.exe", "own"),
            "12\t7\twindows:133\t0\tC:\\Program Files\\nodejs\\node.exe\town\n"
        );
        assert!(listed_executable(r"C:\Users\pat\AppData\Local\Coco Pet\bin\coco-companion.exe"));
        assert!(!listed_executable("coco-companion.exe"));
        assert!(!listed_executable("C:\\a\tb.exe"));
    }

    #[test]
    fn a_deadline_fires_once_per_generation_and_ignores_a_moved_time() {
        let mut d = Deadline::default();
        d.read(None);
        assert_eq!(d.remaining(0), None);
        d.read(Some(b"3\t1000\n"));
        assert_eq!(d.remaining(400), Some(600));
        assert_eq!(d.due(999), None);
        assert_eq!(d.due(1000), Some((3, 1000)));
        d.fire();
        assert_eq!(d.due(5000), None);
        // The same packet again is not a second deadline.
        d.read(Some(b"3\t1000\n"));
        assert_eq!(d.due(5000), None);
        // The same generation with another time is ignored until a newer generation.
        d.read(Some(b"3\t2000\n"));
        assert_eq!(d.remaining(0), None);
        d.read(Some(b"2\t50\n"));
        assert_eq!(d.remaining(0), None);
        d.read(Some(b"4\t2000\n"));
        assert_eq!(d.due(2000), Some((4, 2000)));
        // A zero time means nothing to wait for; a long or broken file means the same.
        d.read(Some(b"5\t0\n"));
        assert_eq!(d.remaining(0), None);
        d.read(Some(format!("6\t{}\n", "1".repeat(70)).as_bytes()));
        assert_eq!(d.remaining(0), None);
        d.read(Some(b"7\t9223372036854775808\n"));
        assert_eq!(d.remaining(0), None);
    }

    #[test]
    fn followers_forward_whole_lines_and_start_at_the_newest() {
        assert_eq!(whole_lines(b"a\nb\nc"), 4);
        assert_eq!(whole_lines(b"abc"), 0);
        assert_eq!(first_offset(b"one\ntwo\n", 0), 4);
        assert_eq!(first_offset(b"one\ntwo\nthr", 10), 18);
        assert_eq!(first_offset(b"only\n", 0), 0);
        assert_eq!(first_offset(b"", 0), 0);
        assert_eq!(tagged(b"{\"a\":1}\n{\"b\":2}\n", "LOG\t"), b"LOG\t{\"a\":1}\nLOG\t{\"b\":2}\n");
        assert_eq!(tagged(b"x\n\ny", "STATE\t"), b"STATE\tx\nSTATE\t\nSTATE\ty\n");
        assert_eq!(tagged(&vec![b'a'; LIMIT + 1], "LOG\t"), b"");
    }

    #[test]
    fn the_journal_appends_whole_records_and_starts_again_past_the_limit() {
        assert_eq!(journal(0, true, "{}"), Journal::Append(b"{}\n".to_vec()));
        assert_eq!(journal(10, true, "{}"), Journal::Append(b"{}\n".to_vec()));
        assert_eq!(journal(10, false, "{}"), Journal::Append(b"\n{}\n".to_vec()));
        assert_eq!(
            journal(LIMIT as u64 - 2, true, "{}"),
            Journal::Restart(b"{}\n".to_vec())
        );
        assert_eq!(journal(LIMIT as u64 - 3, true, "{}"), Journal::Append(b"{}\n".to_vec()));
    }
}
