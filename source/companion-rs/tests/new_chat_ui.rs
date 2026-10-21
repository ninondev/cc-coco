//! New chat in the Activity window (lane C, 10-16; his rule): no face of Claude Code, no button; one, it opens; more
//! than one, a menu asks which. It never clears a conversation (DECISIONS 04:2x, S1 2).
use coco_companion::{
    feed::{Record, Sessions},
    new_chat::Client,
    ui::*,
};
use serde_json::json;

fn activity(faces: &[Client]) -> UiState {
    let mut s = Sessions::default();
    let r = Record::from_value(&json!({
        "session": "n1", "at": 1000, "done": 1000, "project": "shop", "channel": true, "lang": "en",
        "cwd": "/home/pat/shop",
    }))
    .unwrap();
    s.receive(r, 1001.);
    let mut u = UiState::default();
    u.open_activity(&s, 1001.);
    u.new_chat = faces.to_vec();
    u
}
fn button(u: &UiState, control: Control) -> Option<Element> {
    u.elements().into_iter().find(|e| e.control == control)
}

#[test]
fn without_a_face_of_claude_code_there_is_no_button() {
    let u = activity(&[]);
    assert!(button(&u, Control::NewChat).is_none());
    assert!(!u.tab_order().contains(&Control::NewChat));
}

#[test]
fn the_only_face_opens_at_once_in_the_sessions_folder() {
    let mut u = activity(&[Client::Terminal]);
    let new_chat = button(&u, Control::NewChat).expect("a New chat button");
    let close = button(&u, Control::Close).unwrap();
    assert_eq!(new_chat.label, "New chat");
    // In the title row, just left of Close.
    assert_eq!(new_chat.bounds.y, close.bounds.y);
    assert!(new_chat.bounds.x + new_chat.bounds.width <= close.bounds.x);
    let order = u.tab_order();
    assert_eq!(&order[order.len() - 2..], &[Control::NewChat, Control::Close]);
    match u.activate(Control::NewChat, 2000) {
        Some(UiAction::NewChat(Client::Terminal, Some(folder))) => assert_eq!(folder, "/home/pat/shop"),
        other => panic!("{other:?}"),
    }
    assert_eq!(u.surface(), Surface::Companion);
}

#[test]
fn more_than_one_face_asks_which_and_escape_or_a_click_outside_comes_back() {
    let faces = [Client::Terminal, Client::Desktop, Client::VsCode];
    let mut u = activity(&faces);
    let (width, height) = u.dimensions();
    assert!(u.activate(Control::NewChat, 2000).is_none());
    assert_eq!(u.surface(), Surface::Menu);
    assert!(u.is_panel_menu() && !u.is_target_menu());
    let rows: Vec<Element> = u.elements().into_iter().filter(|e| matches!(e.control, Control::Menu(_))).collect();
    assert_eq!(rows.iter().map(|e| e.label.as_str()).collect::<Vec<_>>(), ["Terminal", "Claude app", "VS Code"]);
    assert_eq!(u.focus, Some(Control::Menu(0)));
    // The menu hangs under the button, inside the window, which grows only if it must.
    let anchor = button(&u, Control::NewChat).unwrap().bounds;
    let (w, h) = u.dimensions();
    assert_eq!(w, width);
    assert!(h >= height);
    for row in &rows {
        assert!(row.bounds.y >= anchor.y + anchor.height && row.bounds.x >= 12. && row.bounds.x + row.bounds.width <= w);
    }
    // The panel behind stays visible but cannot be pressed.
    assert!(u.elements().iter().filter(|e| !matches!(e.control, Control::Menu(_))).all(|e| !e.enabled));
    assert!(u.key(Key::Escape, 2001).is_none());
    assert_eq!(u.surface(), Surface::Activity);
    assert_eq!(u.focus, Some(Control::NewChat));
    // A click outside the menu closes it too.
    assert!(u.activate(Control::NewChat, 2002).is_none());
    assert!(u.click(1., 1., 2003).is_none());
    assert_eq!((u.surface(), u.focus.clone()), (Surface::Activity, Some(Control::NewChat)));
    // Picking one opens it and closes the window.
    u.activate(Control::NewChat, 2004);
    match u.activate(Control::Menu(2), 2005) {
        Some(UiAction::NewChat(Client::VsCode, _)) => {}
        other => panic!("{other:?}"),
    }
    assert_eq!(u.surface(), Surface::Companion);
}

#[test]
fn the_menu_and_the_button_are_drawn_and_read_aloud() {
    let mut u = activity(&[Client::Terminal, Client::Desktop]);
    let canvas = u.render(2.);
    assert!(canvas.width > 0 && canvas.height > 0);
    let tree = coco_companion::accessibility::tree(&u, &u.chosen.clone());
    let labels: Vec<String> = tree.nodes.iter().filter_map(|(_, node)| node.label().map(str::to_owned)).collect();
    assert!(labels.iter().any(|label| label == "New chat"), "{labels:?}");
    u.activate(Control::NewChat, 2000);
    let canvas = u.render(2.);
    assert!(canvas.width > 0 && canvas.height > 0);
    let tree = coco_companion::accessibility::tree(&u, &u.chosen.clone());
    let labels: Vec<String> = tree.nodes.iter().filter_map(|(_, node)| node.label().map(str::to_owned)).collect();
    for label in ["Activity", "Terminal", "Claude app"] {
        assert!(labels.iter().any(|seen| seen == label), "{label}: {labels:?}");
    }
}

#[test]
fn the_record_keeps_only_a_plain_local_folder() {
    for (cwd, kept) in [
        ("/home/pat/shop", true),
        (r"C:\Users\pat\shop", true),
        (r"\\server\share\shop", false),
        ("shop", false),
        ("/home/pat/../root", false),
    ] {
        let r = Record::from_value(&json!({"session": "n2", "at": 1, "cwd": cwd})).unwrap();
        assert_eq!(r.cwd.is_some(), kept, "{cwd}");
    }
    assert_eq!(Record::from_value(&json!({"session": "n3", "at": 1})).unwrap().cwd, None);
}
