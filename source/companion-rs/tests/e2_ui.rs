use coco_companion::{
    feed::{Record, Sessions},
    render::Size,
    ui::*,
};

#[test]
fn target_picker_selects_a_session_without_losing_the_unsent_field() {
    let mut ui = activity();
    let mut other = ui.chosen.clone();
    other.session = "b".into();
    other.project = "api-client".into();
    ui.sessions.push(other);
    ui.text("draft");
    ui.activate(Control::Target, 1100);
    assert_eq!(ui.surface(), Surface::Menu);
    assert_eq!(ui.chosen.session, "a");
    assert_eq!(
        ui.menu.iter().map(|r| r.label.as_str()).collect::<Vec<_>>(),
        vec!["atlas", "api-client"]
    );
    ui.activate(Control::Menu(1), 1101);
    assert_eq!(ui.surface(), Surface::Activity);
    assert_eq!(ui.chosen.session, "b");
    assert_eq!(ui.field, "draft");
    let Some(UiAction::Request(request)) = ui.activate(Control::Send, 1102) else {
        panic!()
    };
    assert_eq!(request.session, "b");
    assert_eq!(request.text.as_deref(), Some("draft"));
}

#[test]
fn target_picker_escape_returns_to_activity_with_original_target() {
    let mut ui = activity();
    ui.activate(Control::Target, 1100);
    assert_eq!(ui.surface(), Surface::Menu);
    assert!(ui.key(Key::Escape, 1101).is_none());
    assert_eq!(ui.surface(), Surface::Activity);
    assert_eq!(ui.chosen.session, "a");
    assert_eq!(ui.focus, Some(Control::Field));
}

#[test]
fn target_picker_keeps_a_disappeared_session_identity_and_valid_focus() {
    let mut all = sessions();
    let mut other = all.records["a"].clone();
    other.session = "b".into();
    other.project = "api-client".into();
    all.receive(other, 1001.);
    let mut ui = UiState::default();
    ui.open_activity(&all, 1001.);
    ui.chosen = all.records["a"].clone();
    ui.focus = Some(Control::Field);
    ui.text("draft");
    ui.activate(Control::Target, 1100);
    all.records.remove("a");
    ui.sync(&all, 1101.);
    assert_eq!(ui.chosen.session, "a");
    assert!(!ui.enabled(&Control::Send));
    ui.key(Key::Escape, 1102);
    assert_eq!(ui.chosen.session, "a");
    assert_eq!(ui.field, "draft");
    assert_eq!(ui.focus, Some(Control::Close));
    let tree = coco_companion::accessibility::tree(&ui, &ui.chosen);
    assert!(tree.nodes.iter().any(|(id, _)| *id == tree.focus));
}
fn sessions() -> Sessions {
    let mut s = Sessions::default();
    let mut r = Record::resting();
    r.session = "a".into();
    r.project = "atlas".into();
    r.channel = true;
    r.at = 1000.;
    r.done = 1000.;
    s.receive(r, 1001.);
    s
}
fn activity() -> UiState {
    let mut ui = UiState::default();
    ui.open_activity(&sessions(), 1001.);
    ui
}
#[test]
fn activity_feed_removal_never_leaves_accesskit_focus_on_a_missing_row() {
    let mut ui = activity();
    ui.focus = Some(Control::Row("a".into()));
    ui.sync(&Sessions::default(), 1200.);
    assert_eq!(ui.focus, Some(Control::Close));
    let tree = coco_companion::accessibility::tree(&ui, &ui.chosen);
    assert!(tree.nodes.iter().any(|(id, _)| *id == tree.focus));
}

#[test]
fn field_selection_replaces_unicode_scalars_and_deletes_selected_text() {
    let mut ui = activity();
    ui.text("a界🙂z");
    assert!(ui.set_text_selection(1, 3));
    ui.text("é");
    assert_eq!(ui.field, "aéz");
    assert_eq!(ui.cursor, 2);
    assert!(ui.set_text_selection(2, 1));
    ui.key(Key::Backspace, 1200);
    assert_eq!(ui.field, "az");
    assert_eq!(ui.cursor, 1);
    assert!(!ui.set_text_selection(0, 3));
}

#[test]
fn accesskit_selection_uses_a_real_text_run_and_shared_actions() {
    use accesskit::{Action, ActionData, ActionRequest, Role, TextPosition, TextSelection, TreeId};
    use coco_companion::accessibility::{self, FIELD_TEXT};
    let mut ui = activity();
    ui.text("a界🙂z");
    accessibility::action(
        &mut ui,
        ActionRequest {
            action: Action::SetTextSelection,
            target_tree: TreeId::ROOT,
            target_node: accessibility::id(&Control::Field),
            data: Some(ActionData::SetTextSelection(TextSelection {
                anchor: TextPosition {
                    node: FIELD_TEXT,
                    character_index: 1,
                },
                focus: TextPosition {
                    node: FIELD_TEXT,
                    character_index: 3,
                },
            })),
        },
        1200,
    );
    assert_eq!(ui.selection, Some((1, 3)));
    let tree = accessibility::tree(&ui, &ui.chosen);
    let run = &tree
        .nodes
        .iter()
        .find(|(id, _)| *id == FIELD_TEXT)
        .unwrap()
        .1;
    assert_eq!(run.role(), Role::TextRun);
    assert_eq!(run.character_lengths(), &[1, 3, 4, 1]);
    let field = &tree
        .nodes
        .iter()
        .find(|(id, _)| *id == accessibility::id(&Control::Field))
        .unwrap()
        .1;
    assert_eq!(field.text_selection().unwrap().focus.character_index, 3);
}

#[test]
fn ime_accessibility_offsets_stay_committed_and_composition_is_read_only() {
    use coco_companion::accessibility::{self, FIELD_TEXT};
    let mut ui = activity();
    ui.text("a界b");
    ui.cursor = 1;
    ui.preedit = "汉字".into();
    let tree = accessibility::tree(&ui, &ui.chosen);
    let field = &tree
        .nodes
        .iter()
        .find(|(id, _)| *id == accessibility::id(&Control::Field))
        .unwrap()
        .1;
    let text = &tree
        .nodes
        .iter()
        .find(|(id, _)| *id == FIELD_TEXT)
        .unwrap()
        .1;
    assert_eq!(field.value(), Some("a界b"));
    assert_eq!(text.value(), Some("a界b"));
    let composition = &tree.nodes.iter().find(|(id, _)| id.0 == 21).unwrap().1;
    assert_eq!(composition.label(), Some("汉字"));
    assert!(composition.is_read_only());
    assert!(ui.set_text_selection(1, 2));
    assert!(ui.preedit.is_empty());
    ui.text("🙂");
    assert_eq!(ui.field, "a🙂b");
}

#[test]
fn ime_preedit_uses_field_style_without_changing_send_payload() {
    let mut ui = activity();
    ui.focus = Some(Control::Field);
    ui.field = "ab".into();
    ui.cursor = 1;
    ui.preedit = "汉字".into();
    assert_eq!(ui.display_field(), "a汉字b");
    assert_eq!(ui.field, "ab");
    if let Some(UiAction::Request(request)) = ui.activate(Control::Send, 1002) {
        assert_eq!(request.text.as_deref(), Some("ab"));
    } else {
        panic!("committed field is sendable");
    }
    ui.close();
    assert!(ui.preedit.is_empty());
}
#[test]
fn menu_order_and_disabled_reading() {
    let mut r = Record::resting();
    r.quota = Some(Quota::example());
    let rows = menu_rows(
        &r,
        &MenuContext {
            platform: UiPlatform::X11,
            back_available: true,
            following: true,
            back_app: "Claude".into(),
            lines_hidden: false,
            size: Size::Medium, ..MenuContext::default() },
    );
    assert!(rows[0].enabled);
    assert_eq!(rows[0].action, Some(MenuAction::Activity));
    assert_eq!(
        rows.iter()
            .filter_map(|r| r.action.clone())
            .collect::<Vec<_>>(),
        vec![
            MenuAction::Activity,
            MenuAction::Activity,
            MenuAction::Back,
            MenuAction::Pat,
            MenuAction::Wave,
            MenuAction::Hug,
            MenuAction::Fluster,
            MenuAction::SizeMenu,
            MenuAction::ToggleLines,
            MenuAction::BeginFollow,
            MenuAction::StopFollow,
            MenuAction::Hide,
            MenuAction::HideUntilCalled,
            MenuAction::Home,
            MenuAction::Quit
        ]
    );
}
#[test]
fn menu_has_five_groups_new_chat_faces_and_a_login_switch() {
    use coco_companion::new_chat::Client;
    let r = Record::resting();
    let rows = |new_chat: Vec<Client>, login: Option<bool>| {
        menu_rows(
            &r,
            &MenuContext {
                new_chat,
                login,
                ..MenuContext::default()
            },
        )
    };
    let plain = rows(vec![], None);
    assert_eq!(plain.iter().filter(|row| row.separator).count(), 4);
    assert!(!plain
        .iter()
        .any(|row| matches!(row.action, Some(MenuAction::NewChat(_) | MenuAction::ToggleLogin))));
    assert_eq!(plain.last().unwrap().action, Some(MenuAction::Quit));
    // One face opens at once and keeps the plain word; more than one are named.
    let one = rows(vec![Client::Desktop], None);
    let chat = one
        .iter()
        .find(|row| row.action == Some(MenuAction::NewChat(Client::Desktop)))
        .unwrap();
    assert_eq!(chat.label, "New chat");
    let two = rows(vec![Client::Terminal, Client::VsCode], None);
    let labels: Vec<_> = two
        .iter()
        .filter(|row| matches!(row.action, Some(MenuAction::NewChat(_))))
        .map(|row| row.label.as_str())
        .collect();
    assert_eq!(labels, ["New chat: Terminal", "New chat: VS Code"]);
    for on in [true, false] {
        let switch = rows(vec![], Some(on));
        let login = switch
            .iter()
            .find(|row| row.action == Some(MenuAction::ToggleLogin))
            .unwrap();
        assert_eq!(login.checked, Some(on));
        assert_eq!(login.label, "Open at login");
    }
}
#[test]
fn wayland_menu_has_no_follow_or_back() {
    let rows = menu_rows(
        &Record::resting(),
        &MenuContext {
            platform: UiPlatform::Wayland,
            back_available: true,
            ..MenuContext::default()
        },
    );
    assert!(!rows.iter().any(|r| matches!(
        r.action,
        Some(MenuAction::Back | MenuAction::BeginFollow | MenuAction::StopFollow)
    )));
}
#[test]
fn blank_field_never_sends() {
    let mut ui = activity();
    ui.text("  ");
    assert!(ui.activate(Control::Send, 1100).is_none());
}
#[test]
fn field_sends_trimmed_to_chosen_session() {
    let mut ui = activity();
    ui.text(" hello ");
    let Some(UiAction::Request(r)) = ui.activate(Control::Send, 1100) else {
        panic!()
    };
    assert_eq!(r.session, "a");
    assert_eq!(r.text.as_deref(), Some("hello"));
    assert!(!ui.enabled(&Control::Send));
}
#[test]
fn failed_ack_keeps_field_and_retries_same_id() {
    let mut ui = activity();
    ui.text("hello");
    let Some(UiAction::Request(a)) = ui.activate(Control::Send, 1100) else {
        panic!()
    };
    ui.tick(6100);
    assert_eq!(ui.field, "hello");
    let Some(UiAction::Request(b)) = ui.activate(Control::Send, 6200) else {
        panic!()
    };
    assert_eq!(a, b);
}
#[test]
fn ack_closes_and_clears() {
    let mut ui = activity();
    ui.text("hello");
    let Some(UiAction::Request(r)) = ui.activate(Control::Send, 1100) else {
        panic!()
    };
    let mut s = sessions();
    s.records.get_mut("a").unwrap().ack = Some(r.id);
    ui.sync(&s, 1200.);
    assert_eq!(ui.surface(), Surface::Companion);
    assert!(ui.field.is_empty());
}
// DECISIONS 04:2x (S1 2): a companion request cannot clear another session, so there is no New chat and
// Send is the only request the Activity window makes, and only as Submit.
#[test]
fn activity_offers_no_new_chat_and_send_only_submits() {
    let mut ui = activity();
    let labels = [ui.chosen.word("newChat").to_owned(), ui.chosen.word("clear").to_owned()];
    assert!(!ui.elements().iter().any(|e| labels.contains(&e.label)));
    ui.text("hello");
    let Some(UiAction::Request(r)) = ui.activate(Control::Send, 1100) else {
        panic!()
    };
    assert_eq!(r.kind, coco_companion::protocol::RequestKind::Submit);
    assert_eq!(r.text.as_deref(), Some("hello"));
}
#[test]
fn tab_order_excludes_mic() {
    let ui = activity();
    assert_eq!(
        ui.tab_order(),
        vec![
            Control::Row("a".into()),
            Control::Field,
            Control::Send,
            Control::Close
        ]
    );
}
#[test]
fn escape_closes() {
    let mut ui = activity();
    assert!(matches!(ui.key(Key::Escape, 1100), Some(UiAction::Close)));
    assert_eq!(ui.surface(), Surface::Companion);
}
#[test]
fn hover_has_only_two_event_timers() {
    let mut ui = UiState::default();
    ui.pointer(true, 1000);
    assert_eq!(ui.next_deadline(1000), Some(1350));
    ui.tick(1350);
    assert!(ui.hover_visible);
    assert_eq!(ui.next_deadline(1350), None);
    ui.pointer(false, 1500);
    assert_eq!(ui.next_deadline(1500), Some(1800));
    ui.tick(1800);
    assert!(!ui.hover_visible);
    assert_eq!(ui.next_deadline(1800), None);
}
#[test]
fn tray_count_overrides_sleep_and_tooltip_names_count() {
    let s = sessions();
    let t = tray_state(&s, 1001.);
    assert_eq!(t.state, TrayHead::Unseen);
    assert_eq!(t.unseen, 1);
    assert_eq!(t.tooltip, "Coco, 1 unseen");
    let mut s = s;
    s.open_activity(1001.);
    assert_eq!(tray_state(&s, 1001.).state, TrayHead::Awake);
}
#[test]
fn quota_keeps_one_reading_per_designed_window() {
    let quota = Quota::parse(&serde_json::json!({"rateLimits": [
        {"kind":"five_hour", "percentUsed": 20},
        {"kind":"five_hour", "percentUsed": 99},
        {"kind":"unknown", "percentUsed": 50},
        {"kind":"seven_day", "percentUsed": 30}
    ]}))
    .unwrap();
    assert_eq!(quota.windows.len(), 2);
    assert_eq!(quota.windows[0].used, Some(20.));
    assert_eq!(quota.windows[1].kind, "seven_day");
}

#[test]
fn quota_missing_is_absent_and_zero_is_known() {
    assert!(Record::resting().quota.is_none());
    let q =
        Quota::parse(&serde_json::json!({"rateLimits":[{"kind":"five_hour","usedPercentage":0}]}))
            .unwrap();
    assert_eq!(q.windows[0].used, Some(0.));
    assert!(q.narrow("en").contains("0%"));
}
#[test]
fn quota_uses_approved_book_words() {
    let q = Quota::example();
    assert!(q.windows[0]
        .announcement("zh")
        .starts_with("5小时额度 耗62%"));
    assert!(q.windows[0]
        .announcement("fr")
        .contains("62\u{a0}% utilisés"));
    assert!(q.windows[1].announcement("en").contains("resets"));
}
