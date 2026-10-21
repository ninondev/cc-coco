use accesskit::{Role, Toggled};
use coco_companion::{
    accessibility,
    feed::{Record, Sessions},
    render::Size,
    ui::*,
};
fn activity() -> UiState {
    let mut r = Record::resting();
    r.session = "a11y-r2".into();
    r.project = "project".into();
    r.channel = true;
    r.at = 1000.;
    r.done = 1000.;
    r.quota = Some(Quota::example());
    let mut s = Sessions::default();
    s.receive(r, 1001.);
    let mut u = UiState::default();
    u.open_activity(&s, 1001.);
    u
}
#[test]
fn target_popup_is_one_dialog_with_underlying_controls_disabled() {
    let mut u = activity();
    let mut r = u.chosen.clone();
    r.session = "two".into();
    u.sessions.push(r);
    u.activate(Control::Target, 0);
    let tree = accessibility::tree(&u, &u.chosen);
    assert_eq!(tree.nodes[0].1.role(), Role::Dialog);
    for e in u.elements() {
        let node = &tree
            .nodes
            .iter()
            .find(|(id, _)| *id == accessibility::id(&e.control))
            .unwrap()
            .1;
        if !matches!(e.control, Control::Menu(_)) {
            assert!(node.is_disabled());
        }
    }
    assert!(tree
        .nodes
        .iter()
        .any(|(_, n)| n.label().is_some_and(|s| s.contains("62"))));
}
#[test]
fn badge_tree_keeps_actual_count_and_exposes_click() {
    let mut u = activity();
    u.close();
    u.unseen = 10;
    let tree = accessibility::tree(&u, &u.chosen);
    let n = &tree
        .nodes
        .iter()
        .find(|(id, _)| *id == accessibility::id(&Control::Badge))
        .unwrap()
        .1;
    assert_eq!(n.role(), Role::Button);
    assert!(n.label().unwrap().contains("10"));
    assert!(n.supports_action(accesskit::Action::Click));
}
#[test]
fn size_current_value_is_announced_as_checked_and_window_bounds_match_each_size() {
    let mut u = activity();
    for size in Size::ALL {
        u.close();
        u.context.size = size;
        let t = accessibility::tree(&u, &u.chosen);
        assert_eq!(
            t.nodes[0].1.bounds().unwrap().height(),
            (160. + 1.32 * size.height()).round()
        );
        u.open_menu(
            MenuContext {
                size,
                ..Default::default()
            },
            0,
        );
        let i = u
            .menu
            .iter()
            .position(|r| r.action == Some(MenuAction::SizeMenu))
            .unwrap();
        u.activate(Control::Menu(i), 0);
        let t = accessibility::tree(&u, &u.chosen);
        for (i, s) in Size::ALL
            .iter()
            .enumerate()
        {
            let n = &t
                .nodes
                .iter()
                .find(|(id, _)| *id == accessibility::id(&Control::Submenu(i)))
                .unwrap()
                .1;
            assert_eq!(
                n.toggled(),
                Some(if *s == size {
                    Toggled::True
                } else {
                    Toggled::False
                })
            );
        }
    }
}
#[test]
fn pixel_neighbour_is_in_the_same_tree() {
    let mut u = activity();
    u.close();
    u.context.size = Size::Medium;
    u.chosen.neighbours_enabled = true;
    u.chosen.neighbours = vec![coco_companion::decor::NeighbourLight {
        id: "codex".into(),
        label: "Codex".into(),
        busy: true,
        ..Default::default()
    }];
    let t = accessibility::tree(&u, &u.chosen);
    assert!(t
        .nodes
        .iter()
        .any(|(_, n)| n.label().is_some_and(|s| s.contains("Codex"))));
}

