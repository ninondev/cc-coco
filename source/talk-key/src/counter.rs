//! The limits, counted in our own file under a lock: 6 sends a minute and 300 a local day, and
//! for `add` and `status` one key check a second and 30 an hour. They brake a loop or another
//! program; anyone who can write the file can reset them.

use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};

use crate::hooks;
use crate::out::{Fail, Kind};
use crate::paths;

pub const PER_MINUTE: usize = 6;
pub const PER_DAY: u32 = 300;
pub const CHECKS_PER_HOUR: usize = 30;
const FILE: &str = "talk-key-sends";
/// Stamps further ahead than this came from a clock that was wrong and are dropped.
const AHEAD: i64 = 60;

pub struct Counts {
    pub minute: usize,
    pub day: u32,
}

pub fn now() -> i64 {
    hooks::now().unwrap_or_else(|| {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0)
    })
}

/// File format, one item per line: `day YYYY-MM-DD N`, `t <unix seconds>` for each send inside
/// the last minute, `c <unix seconds>` for each key check inside the last hour.
struct State {
    day: String,
    count: u32,
    recent: Vec<i64>,
    checks: Vec<i64>,
}

fn parse(text: &str) -> State {
    let mut s = State { day: String::new(), count: 0, recent: Vec::new(), checks: Vec::new() };
    for line in text.lines() {
        let mut parts = line.split_whitespace();
        match (parts.next(), parts.next(), parts.next()) {
            (Some("day"), Some(d), Some(n)) => {
                s.day = d.to_string();
                s.count = n.parse().unwrap_or(PER_DAY);
            }
            (Some("t"), Some(t), None) => {
                if let Ok(t) = t.parse() {
                    s.recent.push(t);
                }
            }
            (Some("c"), Some(t), None) => {
                if let Ok(t) = t.parse() {
                    s.checks.push(t);
                }
            }
            _ => {}
        }
    }
    s
}

fn render(s: &State) -> String {
    let mut out = format!("day {} {}\n", s.day, s.count);
    for t in &s.recent {
        out.push_str(&format!("t {t}\n"));
    }
    for t in &s.checks {
        out.push_str(&format!("c {t}\n"));
    }
    out
}

fn open_locked() -> Result<(File, State), Fail> {
    let path = paths::our_dir()?.join(FILE);
    let mut opts = OpenOptions::new();
    opts.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    let mut file = opts.open(&path).map_err(|_| Fail::new(Kind::Computer, "count-open"))?;
    file.lock().map_err(|_| Fail::new(Kind::Computer, "count-lock"))?;
    let mut text = String::new();
    let _ = file.read_to_string(&mut text);
    Ok((file, parse(&text)))
}

fn store(file: &mut File, state: &State) -> Result<(), Fail> {
    let body = render(state);
    file.seek(SeekFrom::Start(0))
        .and_then(|_| file.set_len(0))
        .and_then(|_| file.write_all(body.as_bytes()))
        .and_then(|_| file.sync_data())
        .map_err(|_| Fail::new(Kind::Computer, "count-write"))
}

/// The day moves only forward, so a TZ that flips the local date back and forth buys nothing.
/// A stored day more than one day past the UTC date can only come from a clock that was ahead
/// (no zone is a whole day from UTC), so that one is dropped.
fn roll_day(state: &mut State, now: i64) {
    let today = local_date(now);
    if today > state.day || state.day > utc_date(now + 86_400) {
        state.day = today;
        state.count = 0;
    }
}

fn retry(oldest: i64, now: i64, window: i64) -> u64 {
    (window - (now - oldest)).clamp(1, window) as u64
}

/// Checks both send limits and, if they allow it, counts this send.
pub fn take() -> Result<Counts, Fail> {
    let (mut file, mut state) = open_locked()?;
    let now = now();
    roll_day(&mut state, now);
    state.recent.retain(|t| *t > now - 60 && *t <= now + AHEAD);
    state.checks.retain(|t| *t > now - 3600 && *t <= now + AHEAD);

    if state.count >= PER_DAY {
        return Err(Fail::new(Kind::Daily, "local-day-limit"));
    }
    if state.recent.len() >= PER_MINUTE {
        let oldest = state.recent.iter().copied().min().unwrap_or(now);
        let mut f = Fail::new(Kind::Rate, "local-minute-limit");
        f.retry_after = Some(retry(oldest, now, 60));
        return Err(f);
    }
    state.count += 1;
    state.recent.push(now);
    store(&mut file, &state)?;
    Ok(Counts { minute: state.recent.len(), day: state.count })
}

/// The brake for `add` and `status`, which spend no tokens but authenticate with the key and,
/// on macOS, can raise a Keychain prompt.
pub fn take_check() -> Result<(), Fail> {
    let (mut file, mut state) = open_locked()?;
    let now = now();
    state.recent.retain(|t| *t > now - 60 && *t <= now + AHEAD);
    state.checks.retain(|t| *t > now - 3600 && *t <= now + AHEAD);
    if state.checks.iter().any(|t| *t >= now) {
        let mut f = Fail::new(Kind::Rate, "local-check-second");
        f.retry_after = Some(1);
        return Err(f);
    }
    if state.checks.len() >= CHECKS_PER_HOUR {
        let oldest = state.checks.iter().copied().min().unwrap_or(now);
        let mut f = Fail::new(Kind::Rate, "local-check-hour");
        f.retry_after = Some(retry(oldest, now, 3600));
        return Err(f);
    }
    state.checks.push(now);
    store(&mut file, &state)
}

#[cfg(unix)]
fn local_date(t: i64) -> String {
    let tt = t as libc::time_t;
    let mut tm: libc::tm = unsafe { std::mem::zeroed() };
    if unsafe { libc::localtime_r(&tt, &mut tm) }.is_null() {
        return utc_date(t);
    }
    format!("{:04}-{:02}-{:02}", tm.tm_year + 1900, tm.tm_mon + 1, tm.tm_mday)
}

#[cfg(windows)]
fn local_date(t: i64) -> String {
    use windows_sys::Win32::Foundation::{FILETIME, SYSTEMTIME};
    use windows_sys::Win32::System::Time::{FileTimeToSystemTime, SystemTimeToTzSpecificLocalTime};
    let ticks = (t as u64 + 11_644_473_600) * 10_000_000;
    let ft = FILETIME { dwLowDateTime: ticks as u32, dwHighDateTime: (ticks >> 32) as u32 };
    let mut utc: SYSTEMTIME = unsafe { std::mem::zeroed() };
    let mut local: SYSTEMTIME = unsafe { std::mem::zeroed() };
    let ok = unsafe { FileTimeToSystemTime(&ft, &mut utc) } != 0
        && unsafe { SystemTimeToTzSpecificLocalTime(std::ptr::null(), &utc, &mut local) } != 0;
    if !ok {
        return utc_date(t);
    }
    format!("{:04}-{:02}-{:02}", local.wYear, local.wMonth, local.wDay)
}

/// Civil date from days since 1970 (Howard Hinnant's algorithm).
fn utc_date(t: i64) -> String {
    let z = t.div_euclid(86_400) + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utc_dates() {
        assert_eq!(utc_date(0), "1970-01-01");
        assert_eq!(utc_date(1_791_590_400), "2026-10-10");
        assert_eq!(utc_date(951_782_400), "2000-02-29");
    }

    #[test]
    fn the_day_only_moves_forward() {
        let noon = 1_791_633_600; // 2026-10-10 12:00 UTC
        let mut s = parse("day 2026-10-11 120\n");
        // A zone where it is already the 11th wrote this; back in UTC it is still the 10th.
        roll_day(&mut s, noon);
        assert_eq!((s.day.as_str(), s.count), ("2026-10-11", 120));
        // A clock a year ahead wrote this: more than a day past UTC, so it is dropped.
        let mut s = parse("day 2027-10-10 300\n");
        roll_day(&mut s, noon);
        assert_eq!(s.count, 0);
        let mut s = parse("day 2026-10-09 300\n");
        roll_day(&mut s, noon);
        assert_eq!(s.count, 0);
    }

    #[test]
    fn round_trips_and_tolerates_junk() {
        let s = parse("day 2026-10-10 17\nt 5\nt x\ngarbage\nt 9\n");
        assert_eq!((s.day.as_str(), s.count, s.recent.clone()), ("2026-10-10", 17, vec![5, 9]));
        assert_eq!(render(&s), "day 2026-10-10 17\nt 5\nt 9\n");
        let s = parse("day 2026-10-10 1\nc 7\nt 8\n");
        assert_eq!((s.recent.clone(), s.checks.clone()), (vec![8], vec![7]));
        assert_eq!(render(&s), "day 2026-10-10 1\nt 8\nc 7\n");
        // An unreadable count is taken as the limit, not as zero.
        assert_eq!(parse("day 2026-10-10 lots\n").count, PER_DAY);
    }
}
