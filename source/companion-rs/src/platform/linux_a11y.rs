//! AT-SPI2 adapter for the one AccessKit tree. Every action routes back into that
//! tree's action handler; no separate native accessibility UI model is maintained.
#[cfg(feature = "a11y")]
pub fn hidden_window_nodes(
    mut nodes: Vec<crate::accessibility::NativeNode>,
) -> Vec<crate::accessibility::NativeNode> {
    nodes.retain(|node| node.id == crate::accessibility::ROOT.0);
    for node in &mut nodes {
        node.children.clear();
        node.actions.clear();
        node.states.retain(|state| ![12, 24, 29].contains(state));
    }
    nodes
}
#[cfg(target_os = "linux")]
mod native {
    use super::super::{value, Api, Conn, Iter};
    use super::{
        hit_test, offset_at_point, text_boundary, text_granularity, text_rect, valid_selection,
    };
    use crate::{accessibility::NativeNode, platform::linux::Event};
    use accesskit::{
        Action, ActionData, ActionRequest, NodeId, TextPosition, TextSelection, TreeId,
    };
    use std::{ffi::CString, ptr};
    #[derive(Default)]
    pub(crate) struct Bridge {
        conn: Conn,
        name: String,
        nodes: Vec<NativeNode>,
        focus: u64,
        cursor: usize,
        parent: (String, String),
        origin: (i32, i32),
        origin_known: bool,
        selection: Option<(usize, usize)>,
        geometry: Vec<(u64, Vec<(f64, f64, f64, f64)>, Vec<u32>)>,
    }
    impl Bridge {
        pub fn request(&self, api: &Api, session: Conn) {
            api.call(
                session,
                "org.a11y.Bus",
                "/org/a11y/bus",
                "org.a11y.Bus",
                "GetAddress",
                |_| {},
            );
        }
        pub fn connect(&mut self, api: &Api, address: &str) {
            if !self.conn.is_null() {
                return;
            }
            let address = CString::new(address).unwrap();
            unsafe {
                self.conn = (api.open_connection)(address.as_ptr(), ptr::null_mut());
                if self.conn.is_null() {
                    return;
                }
                (api.exit)(self.conn, 0);
                if (api.register)(self.conn, ptr::null_mut()) == 0 {
                    (api.close_connection)(self.conn);
                    (api.unref_conn)(self.conn);
                    self.conn = ptr::null_mut();
                    return;
                }
                self.name = value((api.unique)(self.conn));
            }
            api.call(
                self.conn,
                "org.a11y.atspi.Registry",
                "/org/a11y/atspi/accessible/root",
                "org.a11y.atspi.Socket",
                "Embed",
                |i| self.reference(api, i, 0),
            );
        }
        pub fn fd(&self, api: &Api) -> Option<i32> {
            if self.conn.is_null() {
                return None;
            }
            let mut fd = -1;
            unsafe {
                if (api.unix_fd)(self.conn, &mut fd) != 0 {
                    Some(fd)
                } else {
                    None
                }
            }
        }
        pub fn update(
            &mut self,
            api: &Api,
            mut nodes: Vec<NativeNode>,
            focus: u64,
            cursor: usize,
            origin: (i32, i32),
            origin_known: bool,
            geometry: Vec<(u64, Vec<(f64, f64, f64, f64)>, Vec<u32>)>,
            selection: Option<(usize, usize)>,
            hidden: bool,
        ) {
            let focus = if hidden { 0 } else { focus };
            let geometry = if hidden { vec![] } else { geometry };
            let selection = if hidden { None } else { selection };
            if hidden {
                nodes = super::hidden_window_nodes(nodes);
            }
            // AT-SPI's application root wraps the AccessKit window, as native adapters do;
            // all actionable descendants remain precisely the AccessKit nodes.
            if let Some(window) = nodes.first_mut() {
                window.parent = Some(0);
                let name = crate::platform_words::OS_DISCOVERY_NAME.to_owned();
                nodes.push(NativeNode {
                    id: 0,
                    parent: None,
                    children: vec![1],
                    name,
                    description: String::new(),
                    role: 75,
                    states: vec![8, 23, 24, 29],
                    rect: (0., 0., 0., 0.),
                    text: String::new(),
                    actions: vec![],
                });
            }
            for node in &nodes {
                if let Some(old) = self.nodes.iter().find(|n| n.id == node.id) {
                    for (index, id) in old
                        .children
                        .iter()
                        .enumerate()
                        .filter(|(_, id)| !node.children.contains(id))
                    {
                        self.children_event(api, node.id, "remove", index as i32, *id);
                    }
                    for (index, id) in node
                        .children
                        .iter()
                        .enumerate()
                        .filter(|(_, id)| !old.children.contains(id))
                    {
                        self.children_event(api, node.id, "add", index as i32, *id);
                    }
                    if old.name != node.name {
                        self.object_event(
                            api,
                            node.id,
                            "PropertyChange",
                            "accessible-name",
                            0,
                            0,
                            &node.name,
                        );
                    }
                    for state in [4, 7, 8, 11, 15, 21, 22, 23, 24, 25, 29, 40] {
                        let before = old.states.contains(&state);
                        let after = node.states.contains(&state);
                        if before != after {
                            let name = match state {
                                4 => "checked",
                                21 => "selectable",
                                22 => "selected",
                                40 => "checkable",
                                7 => "editable",
                                8 => "enabled",
                                11 => "focusable",
                                15 => "modal",
                                23 => "sensitive",
                                24 => "showing",
                                25 => "single-line",
                                _ => "visible",
                            };
                            self.object_event(
                                api,
                                node.id,
                                "StateChanged",
                                name,
                                if after { 1 } else { 0 },
                                0,
                                "",
                            );
                        }
                    }
                    if old.description != node.description {
                        self.object_event(
                            api,
                            node.id,
                            "PropertyChange",
                            "accessible-description",
                            0,
                            0,
                            &node.description,
                        );
                    }
                    if old.text != node.text {
                        self.object_event(
                            api,
                            node.id,
                            "TextChanged",
                            "delete",
                            0,
                            old.text.chars().count() as i32,
                            &old.text,
                        );
                        self.object_event(
                            api,
                            node.id,
                            "TextChanged",
                            "insert",
                            0,
                            node.text.chars().count() as i32,
                            &node.text,
                        );
                    }
                }
            }
            if focus != self.focus {
                if self.focus != 0 {
                    self.object_event(api, self.focus, "StateChanged", "focused", 0, 0, "");
                }
                if focus != 0 {
                    self.object_event(api, focus, "StateChanged", "focused", 1, 0, "");
                }
            }
            if cursor != self.cursor {
                if let Some(field) = nodes.iter().find(|n| n.role == 79) {
                    self.object_event(api, field.id, "TextCaretMoved", "", cursor as i32, 0, "");
                }
            }
            if selection != self.selection {
                if let Some(field) = nodes.iter().find(|n| n.role == 79) {
                    self.object_event(api, field.id, "TextSelectionChanged", "", 0, 0, "");
                }
            }
            self.nodes = nodes;
            self.focus = focus;
            self.cursor = cursor;
            self.origin = origin;
            self.origin_known = origin_known;
            self.selection = selection;
            self.geometry = geometry;
        }
        fn children_event(&self, api: &Api, id: u64, detail: &str, index: i32, child: u64) {
            if self.conn.is_null() {
                return;
            }
            let p = CString::new(path(id)).unwrap();
            unsafe {
                let msg = (api.signal)(
                    p.as_ptr(),
                    c"org.a11y.atspi.Event.Object".as_ptr(),
                    c"ChildrenChanged".as_ptr(),
                );
                let mut i = Iter::default();
                (api.append_init)(msg, &mut i);
                api.string(&mut i, detail, b's');
                api.number(&mut i, index, b'i');
                api.number(&mut i, 0i32, b'i');
                api.container(&mut i, b'v', Some("(so)"), |v| {
                    self.reference(api, v, child)
                });
                api.container(&mut i, b'a', Some("{sv}"), |_| {});
                api.send(self.conn, msg);
            }
        }
        fn object_event(
            &self,
            api: &Api,
            id: u64,
            signal: &str,
            detail: &str,
            a: i32,
            b: i32,
            text: &str,
        ) {
            if self.conn.is_null() {
                return;
            }
            let (path, name) = (
                CString::new(path(id)).unwrap(),
                CString::new(signal).unwrap(),
            );
            unsafe {
                let msg = (api.signal)(
                    path.as_ptr(),
                    c"org.a11y.atspi.Event.Object".as_ptr(),
                    name.as_ptr(),
                );
                let mut i = Iter::default();
                (api.append_init)(msg, &mut i);
                api.string(&mut i, detail, b's');
                api.number(&mut i, a, b'i');
                api.number(&mut i, b, b'i');
                api.container(&mut i, b'v', Some("s"), |v| api.string(v, text, b's'));
                api.container(&mut i, b'a', Some("{sv}"), |_| {});
                api.send(self.conn, msg);
            }
        }
        fn reference(&self, api: &Api, i: &mut Iter, id: u64) {
            api.container(i, b'r', None, |r| {
                api.string(r, &self.name, b's');
                api.string(r, &path(id), b'o');
            });
        }
        fn interfaces(n: &NativeNode) -> Vec<&'static str> {
            let mut v = vec!["org.a11y.atspi.Accessible", "org.a11y.atspi.Component"];
            if n.id == 0 {
                v.push("org.a11y.atspi.Application");
            }
            if !n.actions.is_empty() {
                v.push("org.a11y.atspi.Action");
            }
            if n.role == 79 {
                v.extend(["org.a11y.atspi.Text", "org.a11y.atspi.EditableText"]);
            }
            v
        }
        fn states(n: &NativeNode) -> [u32; 2] {
            let mut bits = [0u32; 2];
            for s in &n.states {
                if *s < 64 {
                    bits[*s as usize / 32] |= 1 << (*s % 32);
                }
            }
            bits
        }
        fn property(&self, api: &Api, n: &NativeNode, name: &str, i: &mut Iter) -> bool {
            match name {
                "Name" | "Description" | "Locale" | "AccessibleId" => {
                    let text = match name {
                        "Name" => n.name.clone(),
                        "Description" => n.description.clone(),
                        "Locale" => String::new(),
                        _ => n.id.to_string(),
                    };
                    api.container(i, b'v', Some("s"), |v| api.string(v, &text, b's'));
                }
                "Parent" => api.container(i, b'v', Some("(so)"), |v| {
                    if let Some(id) = n.parent {
                        self.reference(api, v, id)
                    } else {
                        api.container(v, b'r', None, |r| {
                            api.string(r, &self.parent.0, b's');
                            api.string(
                                r,
                                if self.parent.1.is_empty() {
                                    "/org/a11y/atspi/null"
                                } else {
                                    &self.parent.1
                                },
                                b'o',
                            );
                        });
                    }
                }),
                "ChildCount" => api.container(i, b'v', Some("i"), |v| {
                    api.number(v, n.children.len() as i32, b'i')
                }),
                "CharacterCount" => api.container(i, b'v', Some("i"), |v| {
                    api.number(v, n.text.chars().count() as i32, b'i')
                }),
                "CaretOffset" => api.container(i, b'v', Some("i"), |v| {
                    api.number(v, self.cursor as i32, b'i')
                }),
                "N Actions" | "NActions" => api.container(i, b'v', Some("i"), |v| {
                    api.number(v, n.actions.len() as i32, b'i')
                }),
                "ToolkitName" => {
                    api.container(i, b'v', Some("s"), |v| api.string(v, "AccessKit", b's'))
                }
                "Version" => api.container(i, b'v', Some("s"), |v| {
                    api.string(v, env!("CARGO_PKG_VERSION"), b's')
                }),
                "Id" => api.container(i, b'v', Some("i"), |v| {
                    api.number(v, std::process::id() as i32, b'i')
                }),
                _ => return false,
            }
            true
        }
        fn cache(&self, api: &Api, i: &mut Iter) {
            api.container(i, b'a', Some("((so)(so)(so)iiassusau)"), |a| {
                for n in &self.nodes {
                    api.container(a, b'r', None, |item| {
                        self.reference(api, item, n.id);
                        self.reference(api, item, 0);
                        if let Some(p) = n.parent {
                            self.reference(api, item, p);
                        } else {
                            api.container(item, b'r', None, |r| {
                                api.string(r, &self.parent.0, b's');
                                api.string(
                                    r,
                                    if self.parent.1.is_empty() {
                                        "/org/a11y/atspi/null"
                                    } else {
                                        &self.parent.1
                                    },
                                    b'o',
                                );
                            });
                        }
                        api.number(
                            item,
                            if n.parent.is_some() {
                                self.nodes
                                    .iter()
                                    .find(|p| Some(p.id) == n.parent)
                                    .and_then(|r| r.children.iter().position(|id| *id == n.id))
                                    .unwrap_or(0) as i32
                            } else {
                                -1
                            },
                            b'i',
                        );
                        api.number(item, n.children.len() as i32, b'i');
                        api.container(item, b'a', Some("s"), |v| {
                            for interface in Self::interfaces(n) {
                                api.string(v, interface, b's');
                            }
                        });
                        api.string(item, &n.name, b's');
                        api.number(item, n.role, b'u');
                        api.string(item, &n.description, b's');
                        api.container(item, b'a', Some("u"), |v| {
                            for bits in Self::states(n) {
                                api.number(v, bits, b'u');
                            }
                        });
                    });
                }
            });
        }
        fn action(id: u64, action: Action, text: Option<String>) -> Event {
            Event::Accessibility(ActionRequest {
                action,
                target_tree: TreeId::ROOT,
                target_node: NodeId(id),
                data: text.map(|s| ActionData::Value(s.into())),
            })
        }
        fn select(id: u64, start: usize, end: usize) -> Event {
            Event::Accessibility(ActionRequest {
                action: Action::SetTextSelection,
                target_tree: TreeId::ROOT,
                target_node: NodeId(id),
                data: Some(ActionData::SetTextSelection(TextSelection {
                    anchor: TextPosition {
                        node: crate::accessibility::FIELD_TEXT,
                        character_index: start,
                    },
                    focus: TextPosition {
                        node: crate::accessibility::FIELD_TEXT,
                        character_index: end,
                    },
                })),
            })
        }
        fn null_reference(api: &Api, i: &mut Iter) {
            api.container(i, b'r', None, |r| {
                api.string(r, "", b's');
                api.string(r, "/org/a11y/atspi/null", b'o');
            });
        }
        fn coordinate_origin(&self, n: &NativeNode, coord: i32) -> (i32, i32) {
            match coord {
                0 => self.origin,
                2 => self
                    .nodes
                    .iter()
                    .find(|parent| Some(parent.id) == n.parent)
                    .map_or((0, 0), |parent| {
                        (-(parent.rect.0 as i32), -(parent.rect.1 as i32))
                    }),
                _ => (0, 0),
            }
        }
        pub fn events(&mut self, api: &Api) -> Vec<Event> {
            let mut out = vec![];
            if self.conn.is_null() {
                return out;
            }
            unsafe {
                (api.read)(self.conn, 0);
                loop {
                    let msg = (api.pop)(self.conn);
                    if msg.is_null() {
                        break;
                    }
                    let kind = (api.kind)(msg);
                    if kind == 2 {
                        let s = api.strings_deep(msg);
                        if s.len() >= 2 && s[1].starts_with('/') {
                            self.parent = (s[0].clone(), s[1].clone());
                        }
                    }
                    if kind == 1 {
                        let p = value((api.path)(msg));
                        let interface = value((api.interface)(msg));
                        let method = value((api.member)(msg));
                        let node_id = if p.ends_with("/app") {
                            Some(0)
                        } else if p.ends_with("/root") {
                            Some(1)
                        } else {
                            p.rsplit('/')
                                .next()
                                .and_then(|p| p.strip_prefix('n'))
                                .and_then(|p| p.parse().ok())
                        };
                        let node = node_id.and_then(|id| self.nodes.iter().find(|n| n.id == id));
                        let reply = (api.reply)(msg);
                        let mut i = Iter::default();
                        (api.append_init)(reply, &mut i);
                        let args = api.strings(msg);
                        let ints = api.integers(msg);
                        let mut handled = true;
                        let screen_unavailable = !self.origin_known
                            && match (interface.as_str(), method.as_str()) {
                                ("org.a11y.atspi.Component", "GetExtents" | "GetPosition") => {
                                    ints.first().copied().unwrap_or(0) == 0
                                }
                                (
                                    "org.a11y.atspi.Component",
                                    "Contains" | "GetAccessibleAtPoint",
                                ) => ints.get(2).copied().unwrap_or(0) == 0,
                                ("org.a11y.atspi.Text", "GetCharacterExtents") => {
                                    ints.get(1).copied().unwrap_or(0) == 0
                                }
                                ("org.a11y.atspi.Text", "GetRangeExtents" | "GetOffsetAtPoint") => {
                                    ints.get(2).copied().unwrap_or(0) == 0
                                }
                                _ => false,
                            };
                        if screen_unavailable {
                            handled = false;
                        } else if interface == "org.a11y.atspi.Cache" && method == "GetItems" {
                            self.cache(api, &mut i);
                        } else if interface == "org.freedesktop.DBus.Peer" && method == "Ping" {
                        } else if interface == "org.freedesktop.DBus.Introspectable"
                            && method == "Introspect"
                        {
                            api.string(&mut i, INTROSPECTION, b's');
                        } else if let Some(n) = node {
                            match (interface.as_str(), method.as_str()) {
                                (
                                    "org.a11y.atspi.Component",
                                    "Contains" | "GetAccessibleAtPoint",
                                ) => {
                                    let rows = self
                                        .nodes
                                        .iter()
                                        .map(|n| (n.id, n.parent, n.rect))
                                        .collect::<Vec<_>>();
                                    let hit = hit_test(
                                        &rows,
                                        n.id,
                                        ints.first().copied().unwrap_or(0),
                                        ints.get(1).copied().unwrap_or(0),
                                        self.coordinate_origin(
                                            n,
                                            ints.get(2).copied().unwrap_or(0),
                                        ),
                                        true,
                                    );
                                    if method == "Contains" {
                                        api.number(
                                            &mut i,
                                            if hit.is_some() { 1u32 } else { 0 },
                                            b'b',
                                        );
                                    } else if let Some(id) = hit {
                                        self.reference(api, &mut i, id)
                                    } else {
                                        Self::null_reference(api, &mut i)
                                    }
                                }
                                ("org.freedesktop.DBus.Properties", "Get") => {
                                    handled = args
                                        .get(1)
                                        .is_some_and(|p| self.property(api, n, p, &mut i))
                                }
                                ("org.freedesktop.DBus.Properties", "GetAll") => {
                                    api.container(&mut i, b'a', Some("{sv}"), |a| {
                                        for name in [
                                            "Name",
                                            "Description",
                                            "Parent",
                                            "ChildCount",
                                            "Locale",
                                            "AccessibleId",
                                            "CharacterCount",
                                            "CaretOffset",
                                            "NActions",
                                            "ToolkitName",
                                            "Version",
                                            "Id",
                                        ] {
                                            api.container(a, b'e', None, |e| {
                                                api.string(e, name, b's');
                                                self.property(api, n, name, e);
                                            });
                                        }
                                    })
                                }
                                ("org.a11y.atspi.Accessible", "GetChildren") => {
                                    api.container(&mut i, b'a', Some("(so)"), |a| {
                                        for id in &n.children {
                                            self.reference(api, a, *id);
                                        }
                                    })
                                }
                                ("org.a11y.atspi.Accessible", "GetChildAtIndex") => {
                                    if let Some(id) = ints
                                        .first()
                                        .and_then(|index| n.children.get(*index as usize))
                                    {
                                        self.reference(api, &mut i, *id);
                                    } else {
                                        handled = false;
                                    }
                                }
                                ("org.a11y.atspi.Accessible", "GetIndexInParent") => api.number(
                                    &mut i,
                                    self.nodes
                                        .iter()
                                        .find(|parent| Some(parent.id) == n.parent)
                                        .and_then(|r| r.children.iter().position(|id| *id == n.id))
                                        .map(|n| n as i32)
                                        .unwrap_or(-1),
                                    b'i',
                                ),
                                ("org.a11y.atspi.Accessible", "GetRole") => {
                                    api.number(&mut i, n.role, b'u')
                                }
                                (
                                    "org.a11y.atspi.Accessible",
                                    "GetRoleName" | "GetLocalizedRoleName",
                                ) => api.string(
                                    &mut i,
                                    match n.role {
                                        16 => "dialog",
                                        33 => "menu",
                                        35 => "menu item",
                                        79 => "entry",
                                        11 => "combo box",
                                        43 => "push button",
                                        29 => "label",
                                        75 => "application",
                                        _ => "window",
                                    },
                                    b's',
                                ),
                                ("org.a11y.atspi.Accessible", "GetState") => {
                                    api.container(&mut i, b'a', Some("u"), |a| {
                                        for bits in Self::states(n) {
                                            api.number(a, bits, b'u');
                                        }
                                    })
                                }
                                ("org.a11y.atspi.Accessible", "GetInterfaces") => {
                                    api.container(&mut i, b'a', Some("s"), |a| {
                                        for interface in Self::interfaces(n) {
                                            api.string(a, interface, b's');
                                        }
                                    })
                                }
                                ("org.a11y.atspi.Accessible", "GetApplication") => {
                                    self.reference(api, &mut i, 0)
                                }
                                ("org.a11y.atspi.Accessible", "GetAttributes") => {
                                    api.container(&mut i, b'a', Some("{ss}"), |_| {})
                                }
                                ("org.a11y.atspi.Accessible", "GetRelationSet") => {
                                    api.container(&mut i, b'a', Some("(ua(so))"), |_| {})
                                }
                                ("org.a11y.atspi.Component", "GetExtents") => {
                                    api.container(&mut i, b'r', None, |r| {
                                        let origin = self.coordinate_origin(
                                            n,
                                            ints.first().copied().unwrap_or(0),
                                        );
                                        let (x, y, w, h) = n.rect;
                                        for v in [
                                            x as i32 + origin.0,
                                            y as i32 + origin.1,
                                            w as i32,
                                            h as i32,
                                        ] {
                                            api.number(r, v, b'i');
                                        }
                                    })
                                }
                                ("org.a11y.atspi.Component", "GetPosition") => {
                                    let (x, y, _, _) = n.rect;
                                    let origin = self
                                        .coordinate_origin(n, ints.first().copied().unwrap_or(0));
                                    api.number(&mut i, x as i32 + origin.0, b'i');
                                    api.number(&mut i, y as i32 + origin.1, b'i');
                                }
                                ("org.a11y.atspi.Component", "GetSize") => {
                                    api.number(&mut i, n.rect.2 as i32, b'i');
                                    api.number(&mut i, n.rect.3 as i32, b'i');
                                }
                                ("org.a11y.atspi.Component", "GetLayer") => {
                                    api.number(&mut i, 3u32, b'u')
                                }
                                ("org.a11y.atspi.Component", "GetMDIZOrder") => {
                                    api.number(&mut i, 0i16, b'n')
                                }
                                ("org.a11y.atspi.Component", "GetAlpha") => {
                                    api.number(&mut i, 1f64, b'd')
                                }
                                ("org.a11y.atspi.Component", "GrabFocus") => {
                                    let can = n.actions.iter().any(|(_, a)| *a == Action::Focus);
                                    if can {
                                        out.push(Self::action(n.id, Action::Focus, None));
                                    }
                                    api.number(&mut i, if can { 1u32 } else { 0 }, b'b');
                                }
                                ("org.a11y.atspi.Action", "GetActions") => {
                                    api.container(&mut i, b'a', Some("(sss)"), |a| {
                                        for (name, _) in &n.actions {
                                            api.container(a, b'r', None, |s| {
                                                api.string(s, name, b's');
                                                api.string(s, name, b's');
                                                api.string(s, "", b's');
                                            });
                                        }
                                    })
                                }
                                (
                                    "org.a11y.atspi.Action",
                                    "GetName" | "GetDescription" | "GetLocalizedName"
                                    | "GetKeyBinding",
                                ) => {
                                    if let Some((name, _)) = ints
                                        .first()
                                        .and_then(|index| n.actions.get(*index as usize))
                                    {
                                        api.string(
                                            &mut i,
                                            if method == "GetKeyBinding" { "" } else { name },
                                            b's',
                                        );
                                    } else {
                                        handled = false;
                                    }
                                }
                                ("org.a11y.atspi.Action", "DoAction") => {
                                    let action = ints
                                        .first()
                                        .and_then(|index| n.actions.get(*index as usize));
                                    if let Some((_, action)) = action {
                                        out.push(Self::action(n.id, *action, None));
                                    }
                                    api.number(
                                        &mut i,
                                        if action.is_some() { 1u32 } else { 0 },
                                        b'b',
                                    );
                                }
                                ("org.a11y.atspi.Text", "GetText") => {
                                    let len = n.text.chars().count() as i32;
                                    let start = ints.first().copied().unwrap_or(0).clamp(0, len);
                                    let end = ints
                                        .get(1)
                                        .copied()
                                        .filter(|n| *n >= 0)
                                        .unwrap_or(len)
                                        .clamp(start, len);
                                    api.string(
                                        &mut i,
                                        &n.text
                                            .chars()
                                            .skip(start as usize)
                                            .take((end - start) as usize)
                                            .collect::<String>(),
                                        b's',
                                    );
                                }
                                (
                                    "org.a11y.atspi.Text",
                                    "GetTextAtOffset"
                                    | "GetTextBeforeOffset"
                                    | "GetTextAfterOffset"
                                    | "GetStringAtOffset",
                                ) => {
                                    let raw = ints.get(1).copied().unwrap_or(0).max(0) as u32;
                                    let attrs = self
                                        .geometry
                                        .iter()
                                        .find(|g| g.0 == n.id)
                                        .map(|g| g.2.as_slice());
                                    let direction = match method.as_str() {
                                        "GetTextBeforeOffset" => -1,
                                        "GetTextAfterOffset" => 1,
                                        _ => 0,
                                    };
                                    let offset = ints.first().copied().unwrap_or(0);
                                    let (text, start, end) = if method == "GetStringAtOffset" {
                                        text_granularity(&n.text, offset, raw, attrs)
                                    } else {
                                        text_boundary(&n.text, offset, raw, direction, attrs)
                                    };
                                    api.string(&mut i, &text, b's');
                                    api.number(&mut i, start, b'i');
                                    api.number(&mut i, end, b'i');
                                }
                                (
                                    "org.a11y.atspi.Text",
                                    "SetCaretOffset" | "SetSelection" | "AddSelection"
                                    | "RemoveSelection",
                                ) => {
                                    let (start, end) = match method.as_str() {
                                        "SetCaretOffset" => {
                                            let at = ints.first().copied().unwrap_or(-1);
                                            (at, at)
                                        }
                                        "AddSelection" => (
                                            ints.first().copied().unwrap_or(-1),
                                            ints.get(1).copied().unwrap_or(-1),
                                        ),
                                        "SetSelection" => (
                                            ints.get(1).copied().unwrap_or(-1),
                                            ints.get(2).copied().unwrap_or(-1),
                                        ),
                                        _ => (self.cursor as i32, self.cursor as i32),
                                    };
                                    let existing =
                                        self.selection.is_some_and(|(start, end)| start != end);
                                    let index_ok = match method.as_str() {
                                        "SetSelection" | "RemoveSelection" => {
                                            ints.first() == Some(&0) && existing
                                        }
                                        "AddSelection" => !existing,
                                        _ => true,
                                    };
                                    let can = n
                                        .actions
                                        .iter()
                                        .any(|(_, action)| *action == Action::SetTextSelection)
                                        && index_ok
                                        && valid_selection(&n.text, start, end);
                                    if can {
                                        out.push(Self::select(n.id, start as usize, end as usize));
                                    }
                                    api.number(&mut i, if can { 1u32 } else { 0 }, b'b');
                                }
                                ("org.a11y.atspi.Text", "GetSelection") => {
                                    if ints.first() == Some(&0) {
                                        if let Some((start, end)) =
                                            self.selection.filter(|(start, end)| start != end)
                                        {
                                            api.number(&mut i, start.min(end) as i32, b'i');
                                            api.number(&mut i, start.max(end) as i32, b'i');
                                        } else {
                                            api.number(&mut i, -1i32, b'i');
                                            api.number(&mut i, -1i32, b'i');
                                        }
                                    } else {
                                        api.number(&mut i, -1i32, b'i');
                                        api.number(&mut i, -1i32, b'i');
                                    }
                                }
                                (
                                    "org.a11y.atspi.Text",
                                    "GetCharacterExtents" | "GetRangeExtents" | "GetOffsetAtPoint",
                                ) => {
                                    let geometry = self.geometry.iter().find(|g| g.0 == n.id);
                                    if method == "GetOffsetAtPoint" {
                                        api.number(
                                            &mut i,
                                            geometry.map_or(-1, |g| {
                                                offset_at_point(
                                                    &g.1,
                                                    ints.first().copied().unwrap_or(0),
                                                    ints.get(1).copied().unwrap_or(0),
                                                    self.coordinate_origin(
                                                        n,
                                                        ints.get(2).copied().unwrap_or(0),
                                                    ),
                                                    true,
                                                )
                                            }),
                                            b'i',
                                        );
                                    } else {
                                        let start = ints.first().copied().unwrap_or(-1);
                                        let end = if method == "GetCharacterExtents" {
                                            start.saturating_add(1)
                                        } else {
                                            ints.get(1).copied().unwrap_or(-1)
                                        };
                                        let coord = if method == "GetCharacterExtents" {
                                            ints.get(1)
                                        } else {
                                            ints.get(2)
                                        };
                                        let rect = geometry
                                            .and_then(|g| {
                                                (start >= 0 && end >= start)
                                                    .then(|| {
                                                        text_rect(
                                                            &g.1,
                                                            start as usize,
                                                            end as usize,
                                                            self.coordinate_origin(
                                                                n,
                                                                coord.copied().unwrap_or(0),
                                                            ),
                                                            true,
                                                        )
                                                    })
                                                    .flatten()
                                            })
                                            .unwrap_or((-1, -1, 0, 0));
                                        let write = |r: &mut Iter| {
                                            for value in [rect.0, rect.1, rect.2, rect.3] {
                                                api.number(r, value, b'i')
                                            }
                                        };
                                        if method == "GetRangeExtents" {
                                            api.container(&mut i, b'r', None, write)
                                        } else {
                                            write(&mut i)
                                        }
                                    }
                                }
                                ("org.a11y.atspi.Text", "GetCharacterAtOffset") => api.number(
                                    &mut i,
                                    n.text
                                        .chars()
                                        .nth(ints.first().copied().unwrap_or(0).max(0) as usize)
                                        .map(|c| c as u32)
                                        .unwrap_or(0),
                                    b'u',
                                ),
                                (
                                    "org.a11y.atspi.Text",
                                    "GetDefaultAttributes" | "GetDefaultAttributeSet",
                                ) => api.container(&mut i, b'a', Some("{ss}"), |_| {}),
                                ("org.a11y.atspi.Text", "GetCaretOffset") => {
                                    api.number(&mut i, self.cursor as i32, b'i')
                                }
                                ("org.a11y.atspi.Text", "GetCharacterCount") => {
                                    api.number(&mut i, n.text.chars().count() as i32, b'i')
                                }
                                ("org.a11y.atspi.Text", "GetAttributes" | "GetAttributeRun") => {
                                    api.container(&mut i, b'a', Some("{ss}"), |_| {});
                                    api.number(&mut i, 0i32, b'i');
                                    api.number(&mut i, n.text.chars().count() as i32, b'i');
                                }
                                ("org.a11y.atspi.Text", "GetAttributeValue") => {
                                    api.string(&mut i, "", b's');
                                }
                                ("org.a11y.atspi.Text", "GetNSelections") => api.number(
                                    &mut i,
                                    if self.selection.is_some_and(|(start, end)| start != end) {
                                        1i32
                                    } else {
                                        0
                                    },
                                    b'i',
                                ),
                                ("org.a11y.atspi.EditableText", "SetTextContents") => {
                                    if !n
                                        .actions
                                        .iter()
                                        .any(|(_, action)| *action == Action::SetValue)
                                    {
                                        api.number(&mut i, 0u32, b'b');
                                    } else if let Some(text) = args.first() {
                                        out.push(Self::action(
                                            n.id,
                                            Action::SetValue,
                                            Some(text.clone()),
                                        ));
                                        api.number(&mut i, 1u32, b'b');
                                    } else {
                                        handled = false;
                                    }
                                }
                                ("org.a11y.atspi.EditableText", "InsertText") => {
                                    if !n
                                        .actions
                                        .iter()
                                        .any(|(_, action)| *action == Action::SetValue)
                                    {
                                        api.number(&mut i, 0u32, b'b');
                                    } else if let Some(text) = args.first() {
                                        let position =
                                            ints.first().copied().unwrap_or(0).max(0) as usize;
                                        let length = ints.get(1).copied().unwrap_or(-1);
                                        let mut chars = n.text.chars().collect::<Vec<_>>();
                                        let at = position.min(chars.len());
                                        let insert = text.chars().take(if length < 0 {
                                            usize::MAX
                                        } else {
                                            length as usize
                                        });
                                        chars.splice(at..at, insert);
                                        out.push(Self::action(
                                            n.id,
                                            Action::SetValue,
                                            Some(chars.into_iter().collect()),
                                        ));
                                        api.number(&mut i, 1u32, b'b');
                                    } else {
                                        handled = false;
                                    }
                                }
                                ("org.a11y.atspi.EditableText", "DeleteText") => {
                                    let mut chars = n.text.chars().collect::<Vec<_>>();
                                    let start = ints.first().copied().unwrap_or(0).max(0) as usize;
                                    let end = ints.get(1).copied().unwrap_or(0).max(0) as usize;
                                    if n.actions
                                        .iter()
                                        .any(|(_, action)| *action == Action::SetValue)
                                        && start <= end
                                        && end <= chars.len()
                                    {
                                        chars.drain(start..end);
                                        out.push(Self::action(
                                            n.id,
                                            Action::SetValue,
                                            Some(chars.into_iter().collect()),
                                        ));
                                        api.number(&mut i, 1u32, b'b');
                                    } else {
                                        api.number(&mut i, 0u32, b'b');
                                    }
                                }
                                _ => handled = false,
                            }
                        } else {
                            handled = false;
                        }
                        if handled {
                            api.send(self.conn, reply);
                        } else {
                            (api.unref)(reply);
                            api.send(
                                self.conn,
                                (api.error)(
                                    msg,
                                    if screen_unavailable {c"org.freedesktop.DBus.Error.NotSupported".as_ptr()} else {c"org.freedesktop.DBus.Error.UnknownMethod".as_ptr()},
                                    if screen_unavailable {c"The compositor does not expose this window's screen origin; window-relative coordinates remain available".as_ptr()} else {c"Unsupported accessibility method or node".as_ptr()},
                                ),
                            );
                        }
                    }
                    (api.unref)(msg);
                }
            }
            if unsafe { (api.connected)(self.conn) } == 0 {
                self.close(api);
            }
            out
        }
        pub fn close(&mut self, api: &Api) {
            if !self.conn.is_null() {
                unsafe {
                    (api.close_connection)(self.conn);
                    (api.unref_conn)(self.conn);
                }
                self.conn = ptr::null_mut();
            }
        }
    }
    fn path(id: u64) -> String {
        if id == 0 {
            "/org/a11y/atspi/accessible/app".into()
        } else if id == 1 {
            "/org/a11y/atspi/accessible/root".into()
        } else {
            format!("/org/a11y/atspi/accessible/n{id}")
        }
    }
    const INTROSPECTION: &str = r#"<node>
<interface name="org.a11y.atspi.Accessible"><property name="Name" type="s" access="read"/><property name="Description" type="s" access="read"/><property name="Parent" type="(so)" access="read"/><property name="ChildCount" type="i" access="read"/><method name="GetChildren"><arg type="a(so)" direction="out"/></method><method name="GetChildAtIndex"><arg type="i" direction="in"/><arg type="(so)" direction="out"/></method><method name="GetIndexInParent"><arg type="i" direction="out"/></method><method name="GetRole"><arg type="u" direction="out"/></method><method name="GetState"><arg type="au" direction="out"/></method><method name="GetInterfaces"><arg type="as" direction="out"/></method><method name="GetApplication"><arg type="(so)" direction="out"/></method></interface>
<interface name="org.a11y.atspi.Component"><method name="GetExtents"><arg type="u" direction="in"/><arg type="(iiii)" direction="out"/></method><method name="GetPosition"><arg type="u" direction="in"/><arg type="i" direction="out"/><arg type="i" direction="out"/></method><method name="GetSize"><arg type="i" direction="out"/><arg type="i" direction="out"/></method><method name="GrabFocus"><arg type="b" direction="out"/></method><method name="Contains"><arg type="i" direction="in"/><arg type="i" direction="in"/><arg type="u" direction="in"/><arg type="b" direction="out"/></method><method name="GetAccessibleAtPoint"><arg type="i" direction="in"/><arg type="i" direction="in"/><arg type="u" direction="in"/><arg type="(so)" direction="out"/></method></interface>
<interface name="org.a11y.atspi.Action"><property name="NActions" type="i" access="read"/><method name="DoAction"><arg type="i" direction="in"/><arg type="b" direction="out"/></method></interface>
<interface name="org.a11y.atspi.Text">
<property name="CharacterCount" type="i" access="read"/><property name="CaretOffset" type="i" access="read"/>
<method name="GetText"><arg type="i" direction="in"/><arg type="i" direction="in"/><arg type="s" direction="out"/></method>
<method name="GetTextAtOffset"><arg type="i" direction="in"/><arg type="u" direction="in"/><arg type="s" direction="out"/><arg type="i" direction="out"/><arg type="i" direction="out"/></method>
<method name="GetTextBeforeOffset"><arg type="i" direction="in"/><arg type="u" direction="in"/><arg type="s" direction="out"/><arg type="i" direction="out"/><arg type="i" direction="out"/></method>
<method name="GetTextAfterOffset"><arg type="i" direction="in"/><arg type="u" direction="in"/><arg type="s" direction="out"/><arg type="i" direction="out"/><arg type="i" direction="out"/></method>
<method name="GetStringAtOffset"><arg type="i" direction="in"/><arg type="u" direction="in"/><arg type="s" direction="out"/><arg type="i" direction="out"/><arg type="i" direction="out"/></method>
<method name="GetCharacterAtOffset"><arg type="i" direction="in"/><arg type="u" direction="out"/></method>
<method name="GetNSelections"><arg type="i" direction="out"/></method>
<method name="GetSelection"><arg type="i" direction="in"/><arg type="i" direction="out"/><arg type="i" direction="out"/></method>
<method name="SetSelection"><arg type="i" direction="in"/><arg type="i" direction="in"/><arg type="i" direction="in"/><arg type="b" direction="out"/></method>
<method name="AddSelection"><arg type="i" direction="in"/><arg type="i" direction="in"/><arg type="b" direction="out"/></method>
<method name="RemoveSelection"><arg type="i" direction="in"/><arg type="b" direction="out"/></method>
<method name="SetCaretOffset"><arg type="i" direction="in"/><arg type="b" direction="out"/></method>
<method name="GetCharacterExtents"><arg type="i" direction="in"/><arg type="u" direction="in"/><arg type="i" direction="out"/><arg type="i" direction="out"/><arg type="i" direction="out"/><arg type="i" direction="out"/></method>
<method name="GetRangeExtents"><arg type="i" direction="in"/><arg type="i" direction="in"/><arg type="u" direction="in"/><arg type="(iiii)" direction="out"/></method>
<method name="GetOffsetAtPoint"><arg type="i" direction="in"/><arg type="i" direction="in"/><arg type="u" direction="in"/><arg type="i" direction="out"/></method>
<method name="GetDefaultAttributeSet"><arg type="a{ss}" direction="out"/></method>
<method name="GetAttributeRun"><arg type="i" direction="in"/><arg type="b" direction="in"/><arg type="a{ss}" direction="out"/><arg type="i" direction="out"/><arg type="i" direction="out"/></method>
</interface>
<interface name="org.a11y.atspi.EditableText"><method name="SetTextContents"><arg type="s" direction="in"/><arg type="b" direction="out"/></method></interface>
<interface name="org.a11y.atspi.Application"><property name="ToolkitName" type="s" access="read"/><property name="Version" type="s" access="read"/><property name="Id" type="i" access="read"/></interface>
<interface name="org.a11y.atspi.Cache"><method name="GetItems"><arg type="a((so)(so)(so)iiassusau)" direction="out"/></method></interface>
</node>"#;
}
#[cfg(target_os = "linux")]
pub(crate) use native::Bridge;

pub const TEXT_METHODS: &[&str] = &[
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
];

pub fn text_range(text: &str, start: i32, end: i32) -> String {
    let len = text.chars().count() as i32;
    let start = start.clamp(0, len);
    let end = if end < 0 { len } else { end.clamp(start, len) };
    text.chars()
        .skip(start as usize)
        .take((end - start) as usize)
        .collect()
}
pub fn valid_selection(text: &str, start: i32, end: i32) -> bool {
    start >= 0
        && end >= 0
        && start as usize <= text.chars().count()
        && end as usize <= text.chars().count()
}
pub fn text_granularity(
    text: &str,
    offset: i32,
    granularity: u32,
    attrs: Option<&[u32]>,
) -> (String, i32, i32) {
    let len = text.chars().count() as i32;
    if offset < 0 || offset >= len || granularity > 4 {
        let at = offset.clamp(0, len);
        return (String::new(), at, at);
    }
    if granularity == 4 {
        return (text.to_owned(), 0, len);
    }
    if granularity == 1 || granularity == 2 {
        let start_bit = if granularity == 1 { 5 } else { 8 };
        let end_bit = if granularity == 1 { 6 } else { 9 };
        if let Some(attrs) = attrs.filter(|attrs| attrs.len() == len as usize + 1) {
            let at = offset as usize;
            let start = (0..=at)
                .rev()
                .find(|index| attrs[*index] & (1 << start_bit) != 0);
            let end = (at + 1..attrs.len()).find(|index| attrs[*index] & (1 << end_bit) != 0);
            if let (Some(start), Some(end)) = (start, end) {
                // A start after the preceding word's end is required; white space
                // between words is returned as its own range, never as part of a word.
                let latest_end = (start..=at)
                    .rev()
                    .find(|index| attrs[*index] & (1 << end_bit) != 0);
                let start = latest_end.unwrap_or(start);
                let earliest_start =
                    (at + 1..=end).find(|index| attrs[*index] & (1 << start_bit) != 0);
                let end = earliest_start.unwrap_or(end);
                return (
                    text_range(text, start as i32, end as i32),
                    start as i32,
                    end as i32,
                );
            }
        }
    }
    text_boundary(
        text,
        offset,
        match granularity {
            0 => 0,
            1 => 1,
            2 => 3,
            3 => 5,
            _ => 31,
        },
        0,
        attrs,
    )
}
/// AT-SPI boundary values use Pango's Unicode scalar log attributes. `direction`
/// is -1/0/1 for before/at/after; the single-line field has one visual line.
pub fn text_boundary(
    text: &str,
    offset: i32,
    boundary: u32,
    direction: i32,
    attrs: Option<&[u32]>,
) -> (String, i32, i32) {
    let chars = text.chars().collect::<Vec<_>>();
    let len = chars.len();
    if boundary > 6 || offset < 0 {
        return (String::new(), 0, 0);
    }
    let at = offset.max(0) as usize;
    let mut cuts = vec![0, len];
    if boundary == 0 {
        cuts.extend(0..=len);
    } else if let Some(attrs) = attrs.filter(|attrs| attrs.len() == len + 1) {
        let bit = match boundary {
            1 => 5,
            2 => 6,
            3 => 8,
            4 => 9,
            5 => 0,
            6 => 0,
            _ => 31,
        };
        cuts.extend(
            attrs
                .iter()
                .enumerate()
                .filter_map(|(index, flags)| (flags & (1 << bit) != 0).then_some(index)),
        );
    } else if boundary == 1 || boundary == 2 {
        // Portable fallback; production always supplies Pango's shaped attributes.
        for index in 0..=len {
            let before =
                index > 0 && (chars[index - 1].is_alphanumeric() || chars[index - 1] == '_');
            let after = index < len && (chars[index].is_alphanumeric() || chars[index] == '_');
            if boundary == 1 && after && !before || boundary == 2 && before && !after {
                cuts.push(index)
            }
        }
    } else if boundary == 3 || boundary == 4 {
        for (index, c) in chars.iter().enumerate() {
            if matches!(c, '.' | '!' | '?' | '。' | '！' | '？') {
                cuts.push(index + 1);
            }
        }
    }
    cuts.sort_unstable();
    cuts.dedup();
    let current = cuts
        .windows(2)
        .position(|pair| pair[0] <= at && at < pair[1]);
    let index = match (current, direction) {
        (Some(index), -1) => index.checked_sub(1),
        (Some(index), 1) => (index + 2 < cuts.len()).then_some(index + 1),
        (Some(index), _) => Some(index),
        (None, -1) if at >= len && cuts.len() > 1 => Some(cuts.len() - 2),
        _ => None,
    };
    if let Some(index) = index {
        let (start, end) = (cuts[index] as i32, cuts[index + 1] as i32);
        (text_range(text, start, end), start, end)
    } else {
        let at = at.min(len) as i32;
        (String::new(), at, at)
    }
}
pub fn text_rect(
    rects: &[(f64, f64, f64, f64)],
    start: usize,
    end: usize,
    origin: (i32, i32),
    screen: bool,
) -> Option<(i32, i32, i32, i32)> {
    if start >= rects.len() || end < start || end > rects.len() {
        return None;
    }
    let selected = if start == end {
        &rects[start..start + 1]
    } else {
        &rects[start..end]
    };
    let x = selected
        .iter()
        .map(|r| r.0.min(r.0 + r.2))
        .fold(f64::INFINITY, f64::min);
    let y = selected.iter().map(|r| r.1).fold(f64::INFINITY, f64::min);
    let right = selected
        .iter()
        .map(|r| r.0.max(r.0 + r.2))
        .fold(f64::NEG_INFINITY, f64::max);
    let bottom = selected
        .iter()
        .map(|r| r.1 + r.3)
        .fold(f64::NEG_INFINITY, f64::max);
    let dx = if screen { origin.0 } else { 0 };
    let dy = if screen { origin.1 } else { 0 };
    Some((
        x.floor() as i32 + dx,
        y.floor() as i32 + dy,
        (right.ceil() - x.floor()) as i32,
        (bottom.ceil() - y.floor()) as i32,
    ))
}
pub fn offset_at_point(
    rects: &[(f64, f64, f64, f64)],
    x: i32,
    y: i32,
    origin: (i32, i32),
    screen: bool,
) -> i32 {
    let x = x as f64 - if screen { origin.0 as f64 } else { 0. };
    let y = y as f64 - if screen { origin.1 as f64 } else { 0. };
    rects
        .iter()
        .enumerate()
        .find(|(_, r)| {
            x >= r.0.min(r.0 + r.2) && x < r.0.max(r.0 + r.2) && y >= r.1 && y < r.1 + r.3
        })
        .map_or(-1, |(index, _)| index as i32)
}
pub fn hit_test(
    nodes: &[(u64, Option<u64>, (f64, f64, f64, f64))],
    root: u64,
    x: i32,
    y: i32,
    origin: (i32, i32),
    screen: bool,
) -> Option<u64> {
    let x = x as f64 - if screen { origin.0 as f64 } else { 0. };
    let y = y as f64 - if screen { origin.1 as f64 } else { 0. };
    fn pick(
        nodes: &[(u64, Option<u64>, (f64, f64, f64, f64))],
        id: u64,
        x: f64,
        y: f64,
    ) -> Option<u64> {
        let (_, _, r) = nodes.iter().find(|n| n.0 == id)?;
        if x < r.0 || y < r.1 || x >= r.0 + r.2 || y >= r.1 + r.3 {
            return None;
        }
        nodes
            .iter()
            .rev()
            .filter(|n| n.1 == Some(id))
            .find_map(|n| pick(nodes, n.0, x, y))
            .or(Some(id))
    }
    pick(nodes, root, x, y)
}
