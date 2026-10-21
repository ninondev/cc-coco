//! The DM thread on the Windows and Linux pet (lane C, 10-17; the owner's cards of 10-17 late: one thread in the plugin
//! and on the pet, read or reply on either; unread marks; the system's notification, never while the screen is locked).
use coco_companion::{
    engine::Engine,
    feed::{Dm, DmLine, DmNotice, Record, Sessions},
    protocol::{ChannelRequest, RequestKind},
    render::Size,
    ui::{menu_rows, Control, MenuAction, MenuContext, Surface, UiAction, UiState},
    Options,
};
use std::path::PathBuf;

fn dm(unread: usize, lines: &[(bool, &str)]) -> Dm {
    Dm {
        unread,
        notice: None,
        thread: lines.iter().map(|(mine, text)| DmLine { mine: *mine, text: (*text).into() }).collect(),
        label: "DMs".into(),
        placeholder: "Message Coco...".into(),
        notify: true,
    }
}
fn record(at: f64, dm: Option<Dm>) -> Record {
    Record { session: "s1".into(), at, channel: true, dm, ..Record::resting() }
}
fn sessions(record: Record) -> Sessions {
    let mut s = Sessions::default();
    assert!(s.receive(record.clone(), record.at));
    s
}
fn lines(ui: &UiState) -> Vec<(usize, coco_companion::ui::Rect)> {
    ui.elements()
        .into_iter()
        .filter_map(|e| match e.control {
            Control::DmLine(i) => Some((i, e.bounds)),
            _ => None,
        })
        .collect()
}

#[test]
fn the_record_carries_the_thread_while_talk_is_on() {
    let r = Record::parse(
        br#"{"session":"a","at":1000,"dm":{"unread":2,"notice":{"id":"dm:5","at":5,"title":"Coco","body":"you back?"},
        "thread":[{"side":"him","text":"you back?"},{"side":"person","text":"yeah"},{"side":"robot","text":"x"},{"side":"him","text":"   "}],
        "words":{"label":"DMs","placeholder":"Message Coco..."},"notify":false}}"#,
    )
    .unwrap();
    let dm = r.dm.unwrap();
    assert_eq!(dm.unread, 2);
    assert_eq!(dm.notice, Some(DmNotice { id: "dm:5".into(), at: 5., title: "Coco".into(), body: "you back?".into() }));
    assert_eq!(
        dm.thread.iter().map(|l| (l.mine, l.text.as_str())).collect::<Vec<_>>(),
        vec![(false, "you back?"), (true, "yeah")]
    );
    assert_eq!((dm.label.as_str(), dm.placeholder.as_str(), dm.notify), ("DMs", "Message Coco...", false));
    // Talk off: no thread; a notice without a body or an id is none; notifications are on unless said otherwise.
    assert!(Record::parse(br#"{"session":"a","at":1000}"#).unwrap().dm.is_none());
    let r = Record::parse(br#"{"session":"a","at":1000,"dm":{"notice":{"id":"","at":5,"body":"x"}}}"#).unwrap();
    let dm = r.dm.unwrap();
    assert!(dm.notice.is_none() && dm.thread.is_empty() && dm.notify);
    // the newest twenty only
    let thread = (0..25).map(|i| format!(r#"{{"side":"him","text":"{i}"}}"#)).collect::<Vec<_>>().join(",");
    let r = Record::parse(format!(r#"{{"session":"a","at":1000,"dm":{{"thread":[{thread}]}}}}"#).as_bytes()).unwrap();
    let dm = r.dm.unwrap();
    assert_eq!(dm.thread.len(), 20);
    assert_eq!(dm.thread[0].text, "5");
}

#[test]
fn the_pet_writes_dm_and_dm_seen_lines_the_plugin_reads() {
    let message = ChannelRequest::new("0123456789abcdef".into(), "s1".into(), 1000., RequestKind::Dm, Some("  hi there "), None).unwrap();
    let line = String::from_utf8(message.line().unwrap()).unwrap();
    assert!(line.contains(r#""kind":"dm""#) && line.contains(r#""text":"hi there""#), "{line}");
    let seen = ChannelRequest::new("0123456789abcdee".into(), "s1".into(), 1000., RequestKind::DmSeen, Some("x"), Some(5.)).unwrap();
    let line = String::from_utf8(seen.line().unwrap()).unwrap();
    assert!(line.contains(r#""kind":"dmSeen""#) && !line.contains("text") && !line.contains("upto"), "{line}");
    assert_eq!(ChannelRequest::parse(line.trim_end().as_bytes()).unwrap().kind, RequestKind::DmSeen);
    assert!(ChannelRequest::new("0123456789abcdef".into(), "s1".into(), 1000., RequestKind::Dm, Some("   "), None).is_err());
}

#[test]
fn the_badge_counts_her_unread_and_opens_the_thread_and_the_menu_has_it() {
    let mut ui = UiState::default();
    ui.chosen = record(1000., Some(dm(2, &[(false, "you back?")])));
    ui.unseen = 1;
    assert_eq!(ui.badge_count(), 3);
    assert!(matches!(ui.activate(Control::Badge, 1000), Some(UiAction::Menu(MenuAction::Dm))));
    let mut read = UiState::default();
    read.chosen = record(1000., Some(dm(0, &[])));
    read.unseen = 1;
    assert!(matches!(read.activate(Control::Badge, 1000), Some(UiAction::Menu(MenuAction::Activity))));
    let rows = menu_rows(&ui.chosen, &MenuContext::default());
    let at = rows.iter().position(|r| r.action == Some(MenuAction::Activity)).unwrap();
    assert_eq!(rows[at + 1].action, Some(MenuAction::Dm));
    assert_eq!(rows[at + 1].label, "DMs");
    assert!(!menu_rows(&record(1000., None), &MenuContext::default()).iter().any(|r| r.action == Some(MenuAction::Dm)));
}

#[test]
fn the_activity_window_switches_to_the_thread_and_back() {
    let s = sessions(record(1000., Some(dm(1, &[(false, "you back?")]))));
    let mut ui = UiState::default();
    ui.open_activity(&s, 1000.);
    assert!(!ui.dm_visible());
    let toggle = ui.elements().into_iter().find(|e| e.control == Control::DmToggle).unwrap();
    assert_eq!(toggle.label, "DMs, 1");
    assert!(ui.tab_order().contains(&Control::DmToggle));
    assert!(matches!(ui.activate(Control::DmToggle, 1000), Some(UiAction::Menu(MenuAction::Dm))));
    ui.open_dm(&s, 1000.);
    assert!(ui.dm_visible());
    assert!(matches!(ui.activate(Control::DmToggle, 1000), Some(UiAction::Menu(MenuAction::Activity))));
    ui.open_activity(&s, 1000.);
    assert!(!ui.dm_visible());
    // Without Talk there is no switch.
    let mut off = UiState::default();
    off.open_activity(&sessions(record(1000., None)), 1000.);
    assert!(!off.elements().iter().any(|e| e.control == Control::DmToggle));
    off.open_dm(&sessions(record(1000., None)), 1000.);
    assert!(!off.dm_visible());
}

#[test]
fn the_thread_shows_hers_left_theirs_right_oldest_first_and_the_field_below() {
    let s = sessions(record(1000., Some(dm(1, &[(false, "you back?"), (true, "yeah, lunch"), (false, "nice")]))));
    let mut ui = UiState::default();
    ui.open_dm(&s, 1000.);
    assert_eq!(ui.focus, Some(Control::Field));
    assert_eq!(ui.tab_order(), vec![Control::Field, Control::Send, Control::DmToggle, Control::Close]);
    let inset = ui.surface_inset();
    let shown = lines(&ui);
    assert_eq!(shown.iter().map(|(i, _)| *i).collect::<Vec<_>>(), vec![0, 1, 2]);
    assert_eq!(shown[0].1.x - inset, 12.);
    assert!((shown[1].1.x + shown[1].1.width - inset - 288.).abs() < 0.01);
    assert!(shown[0].1.y < shown[1].1.y && shown[1].1.y < shown[2].1.y);
    let elements = ui.elements();
    let field = elements.iter().find(|e| e.control == Control::Field).unwrap();
    assert!(field.bounds.y > shown[2].1.y + shown[2].1.height);
    assert_eq!(field.label, "Message Coco...");
    assert!(elements.iter().any(|e| e.label == format!("{}: you back?", ui.chosen.name)));
    assert!(elements.iter().any(|e| e.label == "yeah, lunch"));
    // A message is read, never pressed: a click on it does nothing.
    let b = shown[0].1;
    assert!(ui.click(b.x + 4., b.y + 4., 1000).is_none());
    assert_eq!(ui.focus, Some(Control::Field));
    // It draws: her name on top, every message, no quota foot.
    let canvas = ui.render(1.);
    for text in [ui.chosen.name.as_str(), "you back?", "yeah, lunch", "nice"] {
        assert!(canvas.texts.iter().any(|run| run.text == text), "{text}");
    }
}

#[test]
fn a_long_thread_keeps_its_newest_messages_within_its_height() {
    let long = "a fairly long message that wraps onto a few lines in the bubble ".repeat(3);
    let thread: Vec<(bool, &str)> = (0..20).map(|i| (i % 2 == 1, long.as_str())).collect();
    let s = sessions(record(1000., Some(dm(0, &thread))));
    let mut ui = UiState::default();
    ui.open_dm(&s, 1000.);
    let shown = lines(&ui);
    assert!(!shown.is_empty() && shown.len() < 20, "{}", shown.len());
    assert_eq!(shown.last().unwrap().0, 19);
    let top = shown.first().unwrap().1.y;
    let bottom = shown.last().unwrap().1.y + shown.last().unwrap().1.height;
    assert!(bottom - top <= 300. + 0.01, "{}", bottom - top);
}

#[test]
fn with_her_dm_on_the_field_writes_to_her_and_her_thread_shows_her_reply() {
    let mut s = sessions(record(1000., Some(dm(0, &[(false, "you back?")]))));
    let mut ui = UiState::default();
    ui.open_dm(&s, 1000.);
    ui.text("yeah, just now");
    let Some(UiAction::Request(request)) = ui.activate(Control::Send, 2000) else {
        panic!("no request")
    };
    assert_eq!(request.kind, RequestKind::Dm);
    assert_eq!(request.text.as_deref(), Some("yeah, just now"));
    let mut acked = record(2001., Some(dm(0, &[(false, "you back?"), (true, "yeah, just now")])));
    acked.ack = Some(request.id.clone());
    assert!(s.receive(acked, 2001.));
    ui.sync(&s, 2001.);
    assert_eq!(ui.surface(), Surface::Activity);
    assert!(ui.dm_visible());
    assert!(ui.field.is_empty());
    // With her DM on, the field in the sessions' view writes to her too (his call 10-20), and her thread opens on receipt.
    ui.open_activity(&s, 2002.);
    assert!(!ui.dm_visible());
    ui.focus = Some(Control::Field);
    ui.text("hello");
    let Some(UiAction::Request(again)) = ui.activate(Control::Send, 3000) else {
        panic!("no request")
    };
    assert_eq!(again.kind, RequestKind::Dm);
    assert_eq!(again.text.as_deref(), Some("hello"));
    let mut acked = record(3001., Some(dm(0, &[(false, "you back?"), (true, "yeah, just now"), (true, "hello")])));
    acked.ack = Some(again.id.clone());
    assert!(s.receive(acked, 3001.));
    ui.sync(&s, 3001.);
    assert!(ui.dm_visible());
    // Without a DM it is a note to the session, as before.
    let s = sessions(record(4000., None));
    let mut ui = UiState::default();
    ui.open_activity(&s, 4000.);
    ui.focus = Some(Control::Field);
    ui.text("a note");
    let Some(UiAction::Request(note)) = ui.activate(Control::Send, 5000) else {
        panic!("no request")
    };
    assert_eq!(note.kind, RequestKind::Submit);
}

struct Scratch {
    root: PathBuf,
}
impl Scratch {
    fn new() -> Self {
        use std::sync::atomic::{AtomicU64, Ordering};
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let root = std::env::temp_dir().join(format!(
            "companion-dm-{}-{}-{}",
            std::process::id(),
            coco_companion::epoch_ms(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(root.join("companion")).unwrap();
        Self { root }
    }
    fn options(&self) -> Options {
        Options {
            folder: self.root.join("companion"),
            presence_folder: Some(self.root.join("presence")),
            assets: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../assets"),
            size: Size::Medium,
            reduce_motion: false,
            follow_class: None,
            trace: false,
            login: false,
        }
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

#[test]
fn opening_the_thread_reads_it_and_her_notice_is_posted_once_while_fresh() {
    let scratch = Scratch::new();
    let view = scratch.options().folder.join("view.json");
    let feed = |at: u64, unread: usize, notice_at: u64| {
        format!(
            r#"{{"session":"s1","at":{at},"channel":true,"dm":{{"unread":{unread},"notice":{{"id":"dm:{notice_at}","at":{notice_at},"title":"Coco","body":"you back?"}},"thread":[{{"side":"him","text":"you back?"}}],"words":{{"label":"DMs","placeholder":"Message Coco..."}},"notify":true}}}}"#
        )
    };
    std::fs::write(&view, feed(10_000, 1, 10_000)).unwrap();
    let mut engine = Engine::new(scratch.options(), 10_000, 42).unwrap();
    engine.reload(10_000).unwrap();
    // Her DMs want the system's notifications even with long tasks quiet.
    assert_eq!(engine.notice_preference(10_000), Some(true));
    // Once, while fresh, and never again for the same message.
    assert_eq!(engine.take_dm_notice(10_500).map(|n| n.body), Some("you back?".into()));
    assert!(engine.take_dm_notice(10_600).is_none());
    std::fs::write(&view, feed(10_700, 1, 10_700)).unwrap();
    engine.reload(10_700).unwrap();
    assert!(engine.take_dm_notice(10_700 + 120_001).is_none());
    // Opening the thread tells the plugin it was read: once, not again within five seconds.
    let requests = scratch.options().folder.join("requests.jsonl");
    engine.open_dm(200_000).unwrap();
    assert!(engine.ui.dm_visible());
    let count = || std::fs::read_to_string(&requests).unwrap_or_default().matches(r#""kind":"dmSeen""#).count();
    assert_eq!(count(), 1);
    engine.open_dm(201_000).unwrap();
    assert_eq!(count(), 1);
    engine.open_dm(206_000).unwrap();
    assert_eq!(count(), 2);
    // A new message while the thread is on screen is not notified: it is right there.
    std::fs::write(&view, feed(207_000, 1, 207_000)).unwrap();
    engine.reload(207_000).unwrap();
    assert!(engine.take_dm_notice(207_100).is_none());
}

/// With COCO_DM_PREVIEW set to a folder, the Activity window with its DM switch and the thread itself are drawn to PNGs
/// there, the text painted by the Linux pet's own text library, to look at before a release.
#[cfg(target_os = "linux")]
#[test]
fn preview_the_thread_when_asked() {
    let Some(folder) = std::env::var_os("COCO_DM_PREVIEW").map(PathBuf::from) else {
        return;
    };
    std::fs::create_dir_all(&folder).unwrap();
    let text = coco_companion::platform::linux::text::Text::new().unwrap();
    let thread = [
        (false, "you back?"),
        (false, "the bug ate you or what"),
        (true, "lol no, lunch ran long"),
        (false, "fair. tests went green while you were gone btw"),
        (true, "wait really??"),
        (false, "yep, all 12. don't touch anything"),
    ];
    for (lang, name) in [("en", "en"), ("zh", "zh")] {
        let mut record = record(1000., Some(dm(2, &thread)));
        record.lang = lang.into();
        let s = sessions(record);
        for (view, open) in [("activity", false), ("thread", true)] {
            let mut ui = UiState::default();
            if open {
                ui.open_dm(&s, 1000.);
            } else {
                ui.open_activity(&s, 1000.);
            }
            let mut canvas = ui.render(2.);
            for (index, run) in canvas.texts.clone().iter().enumerate() {
                let clip = canvas.save_text_clip(index);
                let (_, color) = canvas.text_styles.get(index).copied().unwrap_or((false, [35, 27, 25, 255]));
                let (width, height) = (canvas.width, canvas.height);
                text.paint_weight_with_line_height(
                    &mut canvas.pixels,
                    width,
                    height,
                    &run.text,
                    &run.lang,
                    run.x,
                    run.y,
                    run.font_size,
                    run.width,
                    run.height,
                    canvas.text_weights.get(index).copied().unwrap_or(400),
                    color,
                    canvas.text_prefixes.get(index).copied().unwrap_or(0),
                    canvas.text_sans.get(index).copied().unwrap_or(false),
                    canvas.text_middle.get(index).copied().unwrap_or(false),
                    run.line_height,
                )
                .unwrap();
                canvas.restore_text_clip(clip);
            }
            coco_companion::preview::png(&folder.join(format!("dm-{view}-{name}.png")), &canvas).unwrap();
        }
    }
}
