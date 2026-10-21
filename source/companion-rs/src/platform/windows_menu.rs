//! Native popup content. Windows supplies presentation, keyboard handling and accessibility.
use crate::{
    feed::Record,
    render::Size,
    ui::{menu_rows, MenuAction, MenuContext},
};
#[derive(Clone, Debug)]
pub struct Item {
    pub label: String,
    pub enabled: bool,
    pub separator: bool,
    pub checked: bool,
    pub command: u32,
    pub action: Option<MenuAction>,
    pub children: Vec<Item>,
}
pub fn app_from_image(image: &str) -> Option<&'static str> {
    let name = image.rsplit(['/', '\\']).next()?;
    if name.eq_ignore_ascii_case("Claude.exe") {
        Some("Claude")
    } else if name.eq_ignore_ascii_case("Code.exe") {
        Some("Visual Studio Code")
    } else {
        None
    }
}
pub fn sizes(record: &Record, current: Size) -> Vec<Item> {
    Size::ALL
        .into_iter()
        .enumerate()
        .map(|(i, size)| Item {
            label: record.word(size.key()).into(),
            enabled: true,
            separator: false,
            checked: size == current,
            command: 100 + i as u32,
            action: Some(MenuAction::Size(size)),
            children: Vec::new(),
        })
        .collect()
}
pub fn plan(record: &Record, context: &MenuContext) -> Vec<Item> {
    let mut out = Vec::new();
    for (index, row) in menu_rows(record, context).into_iter().enumerate() {
        let children = if row.action == Some(MenuAction::SizeMenu) {
            sizes(record, context.size)
        } else {
            Vec::new()
        };
        out.push(Item {
            label: row.label,
            enabled: row.enabled,
            separator: row.separator,
            checked: row.checked == Some(true),
            command: if row.separator || !children.is_empty() {
                0
            } else {
                index as u32 + 1
            },
            action: row.action,
            children,
        });
    }
    out
}
pub fn selection(rows: &[Item], command: u32) -> Option<MenuAction> {
    if command == 0 {
        return None;
    }
    for row in rows {
        if !row.enabled {
            continue;
        }
        if row.command == command {
            return row.action.clone();
        }
        if let Some(action) = selection(&row.children, command) {
            return Some(action);
        }
    }
    None
}
