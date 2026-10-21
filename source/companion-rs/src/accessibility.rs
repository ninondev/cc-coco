//! One AccessKit tree. Platform bridges consume this tree and route its actions to UiState.
use crate::{
    feed::Record,
    ui::{Control, Surface, UiAction, UiState},
};
use accesskit::{
    Action, ActionData, ActionRequest, Node, NodeId, Rect, Role, TextPosition, TextSelection,
    Toggled, Tree, TreeId, TreeUpdate,
};
pub const ROOT: NodeId = NodeId(1);
pub const FIELD_TEXT: NodeId = NodeId(20);
pub fn id(control: &Control) -> NodeId {
    let s = format!("{control:?}");
    let mut hash = 0xcbf29ce484222325u64;
    for b in s.bytes() {
        hash = (hash ^ b as u64).wrapping_mul(0x100000001b3)
    }
    NodeId(hash.max(100))
}
pub fn tree(ui: &UiState, record: &Record) -> TreeUpdate {
    let mut root = Node::new(match ui.surface() {
        Surface::Activity => Role::Dialog,
        Surface::Menu if ui.is_panel_menu() => Role::Dialog,
        Surface::Menu => Role::Menu,
        Surface::Companion => Role::Window,
    });
    // The DM thread is named for her, as its window's title is.
    root.set_label(
        if ui.dm_visible() {
            record.name.clone()
        } else if ui.surface() == Surface::Activity || ui.is_panel_menu() {
            record.word("activity").to_owned()
        } else {
            record.name.clone()
        },
    );
    root.set_state_description(if record.mood == "sleep" {
        crate::ui::word(&record.lang, "room.alt.pose.asleep", 0)
    } else if record.task.is_some() {
        record.task.clone().unwrap()
    } else {
        record.aside.clone()
    });
    let (w, h) = ui.dimensions();
    root.set_bounds(Rect::new(0., 0., w, h));
    let mut nodes = Vec::new();
    let mut children = vec![];
    for e in ui.elements() {
        let nid = id(&e.control);
        children.push(nid);
        let role = match e.control {
            Control::Field => Role::TextInput,
            Control::Target => Role::Button,
            Control::DmLine(_) => Role::Label,
            Control::Menu(_) | Control::Submenu(_) => Role::MenuItem,
            _ => Role::Button,
        };
        let mut n = Node::new(role);
        n.set_label(e.label);
        if let Control::Submenu(i) = e.control {
            n.set_toggled(
                if crate::render::Size::ALL[i] == ui.context.size
                {
                    Toggled::True
                } else {
                    Toggled::False
                },
            );
        }
        if let Control::Menu(i) = e.control {
            if let Some(on) = ui.menu.get(i).and_then(|row| row.checked) {
                n.set_label(ui.menu[i].label.clone());
                n.set_toggled(if on { Toggled::True } else { Toggled::False });
            }
            if ui.is_target_menu() {
                n.set_selected(
                    ui.sessions
                        .get(i)
                        .is_some_and(|r| r.session == ui.chosen.session),
                );
            }
        }
        if let Control::Row(ref session) = e.control {
            if ui
                .rows
                .iter()
                .any(|row| &row.record.session == session && row.unseen)
            {
                let state = crate::ui::word(&ui.chosen.lang, "companion.a11y.unseen", 0);
                if state != "companion.a11y.unseen" {
                    n.set_state_description(state);
                }
            }
        }
        n.set_bounds(Rect::new(
            e.bounds.x,
            e.bounds.y,
            e.bounds.x + e.bounds.width,
            e.bounds.y + e.bounds.height,
        ));
        if matches!(e.control, Control::DmLine(_)) {
            // A message is read, never pressed.
            n.set_read_only();
        } else if !e.enabled {
            n.set_disabled()
        } else {
            n.add_action(Action::Focus);
            if e.control != Control::Field {
                n.add_action(Action::Click)
            }
        }
        if e.control == Control::Field {
            let value = ui.field.clone();
            n.set_value(value.clone());
            let mut text_children = vec![FIELD_TEXT];
            if !ui.preedit.is_empty() && ui.focus == Some(Control::Field) {
                let composition_id = NodeId(21);
                text_children.push(composition_id);
                let mut composition = Node::new(Role::Label);
                composition.set_label(ui.preedit.clone());
                composition.set_read_only();
                nodes.push((composition_id, composition));
            }
            n.set_children(text_children);
            let mut run = Node::new(Role::TextRun);
            run.set_value(value.clone());
            run.set_character_lengths(
                value
                    .chars()
                    .map(|c| c.len_utf8() as u8)
                    .collect::<Vec<_>>(),
            );
            run.set_bounds(Rect::new(
                e.bounds.x,
                e.bounds.y,
                e.bounds.x + e.bounds.width,
                e.bounds.y + e.bounds.height,
            ));
            nodes.push((FIELD_TEXT, run));
            let len = ui.field.chars().count();
            let (anchor, focus) = ui.selection.unwrap_or((ui.cursor, ui.cursor));
            n.set_text_selection(TextSelection {
                anchor: TextPosition {
                    node: FIELD_TEXT,
                    character_index: anchor.min(len),
                },
                focus: TextPosition {
                    node: FIELD_TEXT,
                    character_index: focus.min(len),
                },
            });
            if e.enabled {
                n.add_action(Action::SetValue);
                n.add_action(Action::ReplaceSelectedText);
                n.add_action(Action::SetTextSelection);
            }
        }
        nodes.push((nid, n));
    }
    // Quota readings are part of the same tree and explicitly read-only (the DM thread does not show them).
    if (ui.surface() == Surface::Activity && !ui.dm_open) || ui.is_panel_menu() {
        if let Some(q) = &ui.chosen.quota {
            for (i, w) in q.windows.iter().enumerate() {
                let nid = NodeId(10 + i as u64);
                children.push(nid);
                let mut n = Node::new(Role::Label);
                n.set_label(w.announcement(&ui.chosen.lang));
                n.set_read_only();
                nodes.push((nid, n));
            }
        }
        let mut labels = Vec::new();
        if ui.rows.is_empty() {
            labels.push(ui.chosen.word("empty").to_owned());
        }
        if let Some(status) = ui.request_status() {
            labels.push(status.to_owned());
        }
        for (i, label) in labels.into_iter().enumerate() {
            let nid = NodeId(30 + i as u64);
            children.push(nid);
            let mut node = Node::new(Role::Label);
            node.set_label(label);
            node.set_read_only();
            nodes.push((nid, node));
        }
    }
    if ui.surface() == Surface::Companion {
        if let Some(line) = &ui.companion_line {
            let nid = NodeId(51);
            children.push(nid);
            let mut node = Node::new(Role::Label);
            node.set_label(line.clone());
            node.set_read_only();
            nodes.push((nid, node));
        }
        let count = record
            .helpers
            .iter()
            .filter(|helper| helper.parent.is_none() && helper.ended_at.is_none())
            .count();
        // A visitor sitting on him while he dozes: its phrase, only once the art for it is drawn.
        if let Some(label) = record
            .visitor
            .as_ref()
            .filter(|v| v.left_at.is_none() && record.mood == "sleep")
            .and_then(|v| v.label.as_ref())
            .filter(|label| !label.is_empty())
        {
            let nid = NodeId(52);
            children.push(nid);
            let mut node = Node::new(Role::Label);
            node.set_label(label.clone());
            node.set_read_only();
            nodes.push((nid, node));
        }
        if count > 0 {
            let nid = NodeId(50);
            children.push(nid);
            let mut node = Node::new(Role::Label);
            node.set_label(crate::ui::word(&record.lang, "helpers.alt", count));
            node.set_read_only();
            nodes.push((nid, node));
        }
        if record.neighbours_enabled {
            let mut lights = record
                .neighbours
                .iter()
                .filter(|light| !light.partial && light.busy && light.ended_at.is_none())
                .collect::<Vec<_>>();
            lights.sort_by(|a, b| b.at.cmp(&a.at).then_with(|| a.id.cmp(&b.id)));
            for (i, light) in lights.into_iter().take(3).enumerate() {
                let nid = NodeId(60 + i as u64);
                children.push(nid);
                let mut node = Node::new(Role::Label);
                node.set_label(
                    crate::ui::word(&record.lang, "neighbour.busy", 0)
                        .replace("{agent}", &light.label),
                );
                node.set_read_only();
                nodes.push((nid, node));
            }
        }
    }
    root.set_children(children);
    nodes.insert(0, (ROOT, root));
    let focus = ui
        .focus
        .as_ref()
        .map(id)
        .filter(|focus| nodes.iter().any(|(nid, _)| nid == focus))
        .unwrap_or(ROOT);
    TreeUpdate {
        nodes,
        tree: Some(Tree::new(ROOT)),
        tree_id: TreeId::ROOT,
        focus,
    }
}
pub fn action(ui: &mut UiState, request: ActionRequest, now: u64) -> Option<UiAction> {
    if request.target_tree != TreeId::ROOT {
        return None;
    }
    let e = ui
        .elements()
        .into_iter()
        .find(|e| id(&e.control) == request.target_node)?;
    if !e.enabled {
        return None;
    }
    match request.action {
        Action::Focus => {
            ui.focus = Some(e.control);
            None
        }
        Action::Click => ui.activate(e.control, now),
        Action::SetValue if e.control == Control::Field => {
            if let Some(ActionData::Value(value)) = request.data {
                ui.field.clear();
                ui.cursor = 0;
                ui.selection = None;
                ui.focus = Some(Control::Field);
                ui.text(&value)
            }
            None
        }
        Action::ReplaceSelectedText if e.control == Control::Field => {
            if let Some(ActionData::Value(value)) = request.data {
                ui.focus = Some(Control::Field);
                ui.text(&value)
            }
            None
        }
        Action::SetTextSelection if e.control == Control::Field => {
            if let Some(ActionData::SetTextSelection(selection)) = request.data {
                if selection.anchor.node == FIELD_TEXT && selection.focus.node == FIELD_TEXT {
                    ui.set_text_selection(
                        selection.anchor.character_index,
                        selection.focus.character_index,
                    );
                }
            }
            None
        }
        _ => None,
    }
}
#[derive(Clone, Debug)]
pub struct NativeNode {
    pub id: u64,
    pub parent: Option<u64>,
    pub children: Vec<u64>,
    pub name: String,
    pub description: String,
    pub role: u32,
    pub states: Vec<u32>,
    pub rect: (f64, f64, f64, f64),
    pub text: String,
    pub actions: Vec<(String, Action)>,
}
/// AT-SPI2 role/state constants are mapped here, so Linux never constructs a second UI model.
pub fn native_nodes(ui: &UiState, record: &Record) -> Vec<NativeNode> {
    let update = tree(ui, record);
    let parents = update
        .nodes
        .iter()
        .flat_map(|(id, node)| node.children().iter().map(move |child| (*child, id.0)))
        .collect::<std::collections::BTreeMap<_, _>>();
    update
        .nodes
        .iter()
        .map(|(id, n)| {
            let focus = update.focus == *id;
            let mut states = vec![24, 29];
            if !n.is_disabled() {
                states.extend([8, 23]);
            }
            if n.supports_action(Action::Focus) {
                states.push(11)
            }
            if focus {
                states.push(12)
            }
            if let Some(toggled) = n.toggled() {
                states.push(40);
                if toggled == Toggled::True {
                    states.push(4);
                }
            }
            if let Some(selected) = n.is_selected() {
                states.push(21);
                if selected {
                    states.push(22);
                }
            }
            if n.role() == Role::TextInput {
                states.push(25);
                if !n.is_disabled() {
                    states.push(7)
                }
            }
            if n.role() == Role::Dialog {
                states.push(15)
            }
            let b = n.bounds().unwrap_or(Rect::new(0., 0., 0., 0.));
            NativeNode {
                id: id.0,
                parent: parents.get(id).copied(),
                children: n.children().iter().map(|id| id.0).collect(),
                name: n.label().unwrap_or("").into(),
                description: n
                    .state_description()
                    .or_else(|| n.description())
                    .unwrap_or("")
                    .into(),
                role: match n.role() {
                    Role::Dialog => 16,
                    Role::Menu => 33,
                    Role::MenuItem if n.toggled().is_some() => 8,
                    Role::MenuItem => 35,
                    Role::TextInput => 79,
                    Role::ComboBox => 11,
                    Role::Button => 43,
                    Role::Label | Role::TextRun => 29,
                    _ => 69,
                },
                states,
                rect: (b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0),
                text: n.value().unwrap_or("").into(),
                actions: [
                    (Action::Click, "click"),
                    (Action::Focus, "focus"),
                    (Action::SetValue, "set-value"),
                    (Action::SetTextSelection, "set-text-selection"),
                ]
                .into_iter()
                .filter(|(a, _)| n.supports_action(*a))
                .map(|(a, n)| (n.into(), a))
                .collect(),
            }
        })
        .collect()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn field_and_buttons_have_names_values_focus_and_actions() {
        let mut s = crate::feed::Sessions::default();
        let mut r = Record::resting();
        r.session = "s".into();
        r.at = 1.;
        r.channel = true;
        r.project = "atlas".into();
        s.receive(r.clone(), 2.);
        let mut ui = UiState::default();
        ui.open_activity(&s, 2.);
        ui.text("hello");
        let t = tree(&ui, &r);
        let field = t
            .nodes
            .iter()
            .find(|(_, n)| n.role() == Role::TextInput)
            .unwrap();
        assert_eq!(field.1.value(), Some("hello"));
        assert_eq!(field.1.label(), Some("Tell Claude…"));
        assert_eq!(field.0, t.focus);
        assert!(field.1.supports_action(Action::SetValue));
        assert!(t.nodes.iter().any(|(_, n)| n.label() == Some("Close")));
        assert!(native_nodes(&ui, &r)
            .iter()
            .any(|n| n.role == 79 && n.states.contains(&12)));
    }
}
