#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MenuNode<A> {
    pub id: i32,
    pub label: String,
    pub enabled: bool,
    pub separator: bool,
    pub checked: Option<bool>,
    pub action: Option<A>,
    pub children: Vec<Self>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MenuProperty {
    Text(String),
    Bool(bool),
    Int(i32),
}
impl<A> MenuNode<A> {
    pub fn root() -> Self {
        Self::item(0, "", true, None)
    }
    pub fn item(id: i32, label: &str, enabled: bool, action: Option<A>) -> Self {
        Self {
            id,
            label: label.into(),
            enabled,
            separator: false,
            checked: None,
            action,
            children: vec![],
        }
    }
    pub fn separator(id: i32) -> Self {
        let mut node = Self::item(id, "", false, None);
        node.separator = true;
        node
    }
    pub fn radio(id: i32, label: &str, checked: bool, action: A) -> Self {
        let mut node = Self::item(id, label, true, Some(action));
        node.checked = Some(checked);
        node
    }
    pub fn find(&self, id: i32) -> Option<&Self> {
        if self.id == id {
            Some(self)
        } else {
            self.children.iter().find_map(|node| node.find(id))
        }
    }
    pub fn properties(&self, names: &[String]) -> Vec<(&'static str, MenuProperty)> {
        let mut properties = vec![
            ("label", MenuProperty::Text(self.label.clone())),
            ("enabled", MenuProperty::Bool(self.enabled)),
            ("visible", MenuProperty::Bool(true)),
            (
                "type",
                MenuProperty::Text(
                    if self.separator {
                        "separator"
                    } else {
                        "standard"
                    }
                    .into(),
                ),
            ),
        ];
        if !self.children.is_empty() {
            properties.push(("children-display", MenuProperty::Text("submenu".into())));
        }
        if let Some(checked) = self.checked {
            properties.push(("toggle-type", MenuProperty::Text("radio".into())));
            properties.push(("toggle-state", MenuProperty::Int(i32::from(checked))));
        }
        properties.retain(|(name, _)| {
            names.is_empty() || names.iter().any(|requested| requested == name)
        });
        properties
    }
}
pub struct MenuTree<A> {
    pub revision: u32,
    pub root: MenuNode<A>,
}
impl<A> Default for MenuTree<A> {
    fn default() -> Self {
        Self {
            revision: 0,
            root: MenuNode::root(),
        }
    }
}
impl<A: Clone + PartialEq> MenuTree<A> {
    pub fn update(&mut self, root: MenuNode<A>) -> bool {
        if self.root == root {
            return false;
        }
        self.root = root;
        self.revision = self.revision.wrapping_add(1).max(1);
        true
    }
    pub fn node(&self, id: i32) -> Option<&MenuNode<A>> {
        self.root.find(id)
    }
    pub fn layout(&self, id: i32, depth: i32) -> Option<MenuNode<A>> {
        fn trim<A>(node: &mut MenuNode<A>, depth: i32) {
            if depth == 0 {
                node.children.clear();
            } else if depth > 0 {
                for child in &mut node.children {
                    trim(child, depth - 1);
                }
            }
        }
        let mut node = self.node(id)?.clone();
        trim(&mut node, depth);
        Some(node)
    }
    pub fn activate(&self, id: i32, event: &str) -> Option<A> {
        let node = self.node(id)?;
        (event == "clicked" && node.enabled && !node.separator && node.children.is_empty())
            .then(|| node.action.clone())
            .flatten()
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn quota_is_an_enabled_activity_item_and_size_is_a_checked_submenu() {
        let mut tree = MenuTree::default();
        let mut root = MenuNode::root();
        root.children
            .push(MenuNode::item(1, "5-hour 25%", true, Some("activity")));
        let mut sizes = MenuNode::item(80, "Size", true, None);
        sizes
            .children
            .push(MenuNode::radio(81, "Tiny", false, "tiny"));
        sizes
            .children
            .push(MenuNode::radio(83, "Medium", true, "medium"));
        root.children.push(sizes);
        assert!(tree.update(root.clone()));
        assert_eq!(tree.activate(1, "clicked"), Some("activity"));
        assert_eq!(tree.node(83).unwrap().checked, Some(true));
        assert_eq!(tree.activate(80, "clicked"), None);
        assert_eq!(tree.activate(81, "clicked"), Some("tiny"));
        assert!(!tree.update(root));
        assert_eq!(tree.revision, 1);
    }
    #[test]
    fn disabled_unknown_separator_and_nonclick_events_cannot_invoke() {
        let mut tree = MenuTree::default();
        let mut root = MenuNode::root();
        root.children
            .push(MenuNode::item(20, "Back", false, Some("back")));
        root.children.push(MenuNode::separator(100));
        tree.update(root);
        for id in [20, 100, 999, -1] {
            assert_eq!(tree.activate(id, "clicked"), None);
        }
        assert_eq!(tree.activate(20, "hovered"), None);
    }
    #[test]
    fn refreshed_rows_keep_action_identity_and_increment_only_changed_layout() {
        let mut tree = MenuTree::default();
        let mut root = MenuNode::root();
        root.children
            .push(MenuNode::item(90, "Quit", true, Some("quit")));
        tree.update(root.clone());
        root.children
            .insert(0, MenuNode::item(1, "Quota", true, Some("activity")));
        tree.update(root);
        assert_eq!(tree.revision, 2);
        assert_eq!(tree.activate(90, "clicked"), Some("quit"));
    }
    #[test]
    fn layout_depth_and_requested_properties_match_dbusmenu_queries() {
        let mut tree = MenuTree::default();
        let mut root = MenuNode::root();
        let mut sizes = MenuNode::item(80, "Size", true, None);
        sizes
            .children
            .push(MenuNode::radio(83, "Medium", true, "medium"));
        root.children.push(sizes);
        tree.update(root);
        assert!(tree.layout(0, 0).unwrap().children.is_empty());
        assert!(tree.layout(0, 1).unwrap().children[0].children.is_empty());
        assert_eq!(tree.layout(0, -1).unwrap().children[0].children[0].id, 83);
        assert!(tree.layout(999, -1).is_none());
        assert_eq!(
            tree.node(83).unwrap().properties(&["toggle-state".into()]),
            vec![("toggle-state", MenuProperty::Int(1))]
        );
        assert_eq!(
            tree.node(80)
                .unwrap()
                .properties(&["children-display".into()]),
            vec![("children-display", MenuProperty::Text("submenu".into()))]
        );
    }
}
