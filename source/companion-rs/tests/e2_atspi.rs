use coco_companion::linux_a11y_model::{
    hit_test, offset_at_point, text_boundary, text_granularity, text_range, text_rect,
    valid_selection, TEXT_METHODS,
};
#[cfg(feature = "a11y")]
#[test]
fn hidden_companion_tree_keeps_only_its_unshown_noninteractive_window() {
    use coco_companion::{accessibility::NativeNode, linux_a11y_model::hidden_window_nodes};
    let root = NativeNode {
        id: 1,
        parent: None,
        children: vec![2],
        name: "Coco".into(),
        description: "asleep".into(),
        role: 69,
        states: vec![8, 12, 23, 24, 29],
        rect: (0., 0., 320., 288.),
        text: String::new(),
        actions: vec![("focus".into(), accesskit::Action::Focus)],
    };
    let mut child = root.clone();
    child.id = 2;
    child.parent = Some(1);
    child.children.clear();
    let nodes = hidden_window_nodes(vec![root, child]);
    assert_eq!(nodes.len(), 1);
    assert_eq!(nodes[0].id, 1);
    assert_eq!(nodes[0].name, "Coco");
    assert_eq!(nodes[0].description, "asleep");
    assert!(nodes[0].children.is_empty());
    assert!(nodes[0].actions.is_empty());
    assert_eq!(nodes[0].states, vec![8, 23]);
}
#[test]
fn linux_session_language_selects_the_cjk_serif_face() {
    use coco_companion::linux_model::serif_family;
    assert!(serif_family("ja-JP").contains("CJK JP"));
    assert!(!serif_family("ja").contains("CJK SC"));
    assert!(serif_family("ko-KR").contains("CJK KR"));
    assert!(serif_family("zh-CN").contains("CJK SC"));
}
#[test]
fn linux_dbusmenu_enabled_reading_invokes_activity_and_preserves_checked_size() {
    use coco_companion::linux_menu::{MenuNode, MenuTree};
    let mut tree = MenuTree::default();
    let mut root = MenuNode::root();
    root.children
        .push(MenuNode::item(1, "5-hour 25%", true, Some("activity")));
    let mut sizes = MenuNode::item(80, "Size", true, None);
    sizes
        .children
        .push(MenuNode::radio(83, "Medium", true, "medium"));
    root.children.push(sizes);
    tree.update(root);
    assert_eq!(tree.activate(1, "clicked"), Some("activity"));
    assert_eq!(tree.node(83).unwrap().checked, Some(true));
    assert_eq!(tree.activate(80, "clicked"), None);
    assert_eq!(tree.activate(83, "hovered"), None);
    assert_eq!(tree.activate(999, "clicked"), None);
}

#[test]
fn atspi_string_word_ends_before_space_and_paragraph_ignores_visual_wrapping() {
    let attrs = [1 << 5, 0, (1 << 6) | (1 << 0), 1 << 5, 0, 1 << 6];
    assert_eq!(
        text_granularity("猫咪 xz", 1, 1, Some(&attrs)),
        ("猫咪".into(), 0, 2)
    );
    assert_eq!(
        text_granularity("猫咪 xz", 4, 4, Some(&attrs)),
        ("猫咪 xz".into(), 0, 5)
    );
}

#[test]
fn atspi_ranges_use_unicode_scalar_offsets() {
    assert_eq!(text_range("a猫🦋z", 1, 3), "猫🦋");
    assert_eq!(text_range("a猫🦋z", 2, -1), "🦋z");
    assert_eq!(text_range("a猫", 9, 2), "");
}
#[test]
fn atspi_boundaries_follow_native_pango_word_attributes() {
    // Two CJK words need native boundaries even though all four scalars are letters.
    let attrs = [1 << 5, 0, (1 << 5) | (1 << 6), 0, 1 << 6];
    assert_eq!(
        text_boundary("中文世界", 1, 1, 0, Some(&attrs)),
        ("中文".into(), 0, 2)
    );
    assert_eq!(
        text_boundary("中文世界", 1, 1, 1, Some(&attrs)),
        ("世界".into(), 2, 4)
    );
    assert_eq!(
        text_boundary("中文世界", 3, 1, -1, Some(&attrs)),
        ("中文".into(), 0, 2)
    );
}
#[test]
fn atspi_empty_and_end_offsets_do_not_replay_previous_character() {
    assert_eq!(text_boundary("", 0, 0, 0, None), (String::new(), 0, 0));
    assert_eq!(text_boundary("a猫", 2, 0, 0, None), (String::new(), 2, 2));
    assert_eq!(text_boundary("a猫", 2, 0, -1, None), ("猫".into(), 1, 2));
}
#[test]
fn atspi_glyph_extents_use_measured_variable_width_and_origin() {
    let rects = vec![(6., 5., 4., 18.), (10., 5., 19., 18.), (29., 5., 0., 18.)];
    assert_eq!(
        text_rect(&rects, 1, 2, (100, 200), true),
        Some((110, 205, 19, 18))
    );
    assert_eq!(offset_at_point(&rects, 120, 210, (100, 200), true), 1);
    assert_eq!(offset_at_point(&rects, 999, 210, (100, 200), true), -1);
}
#[test]
fn atspi_component_hit_test_returns_deepest_owned_child() {
    let nodes = vec![
        (1, None, (0., 0., 300., 200.)),
        (2, Some(1), (10., 10., 60., 30.)),
        (3, Some(2), (15., 12., 20., 12.)),
    ];
    assert_eq!(hit_test(&nodes, 1, 118, 214, (100, 200), true), Some(3));
    assert_eq!(hit_test(&nodes, 1, 999, 999, (100, 200), true), None);
    assert_eq!(hit_test(&nodes, 2, 100, 100, (0, 0), false), None);
}
#[test]
fn atspi_caret_and_selection_reject_invalid_scalar_offsets() {
    assert!(valid_selection("a猫🦋", 0, 3));
    assert!(valid_selection("a猫🦋", 2, 2));
    assert!(!valid_selection("a猫🦋", 0, 4));
    assert!(!valid_selection("a猫🦋", -1, 2));
}
#[test]
fn atspi_text_methods_include_navigation_selection_and_geometry() {
    for name in [
        "GetTextAtOffset",
        "GetTextBeforeOffset",
        "GetTextAfterOffset",
        "GetStringAtOffset",
        "SetCaretOffset",
        "GetSelection",
        "SetSelection",
        "AddSelection",
        "RemoveSelection",
        "GetCharacterExtents",
        "GetRangeExtents",
        "GetOffsetAtPoint",
    ] {
        assert!(TEXT_METHODS.contains(&name), "missing {name}");
    }
}
