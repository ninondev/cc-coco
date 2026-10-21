//! A local stand-in for api.anthropic.com, for the Mac and Windows checks in MAC-QUEUE.md.
//! Writes a throwaway CA to <dir>/ca.pem, prints the endpoint, and answers the models check
//! and every send with a fixed reply until stopped. Use it with a `--features test-hooks`
//! debug build of talk-key; a release build cannot be pointed at it.
//!
//!   cargo run --example stand_in -- <dir>

#[path = "../tests/common/mod.rs"]
mod common;

fn main() {
    let dir = std::path::PathBuf::from(std::env::args().nth(1).expect("usage: stand_in <dir>"));
    std::fs::create_dir_all(&dir).unwrap();
    let ca = common::ca();
    let pem = dir.join("ca.pem");
    std::fs::write(&pem, &ca.pem).unwrap();
    let server = common::serve(ca.server.clone(), common::reply("Hello from the stand-in."), false);
    println!("TALK_KEY_TEST_ENDPOINT={}", server.endpoint());
    println!("TALK_KEY_TEST_CA={}", pem.display());
    let mut shown = 0;
    loop {
        std::thread::sleep(std::time::Duration::from_millis(200));
        let seen = server.seen();
        for s in &seen[shown..] {
            // The key itself is never printed: only whether one arrived, and its last four.
            let key = s.header("x-api-key").unwrap_or("");
            println!("{} {} key ending {}", s.method, s.path, &key[key.len().saturating_sub(4)..]);
        }
        shown = seen.len();
    }
}
