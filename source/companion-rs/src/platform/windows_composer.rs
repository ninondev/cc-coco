use crate::ui::{Control, Surface, UiState};

/// Native mouse coordinates are surface-local points; semantic indices survive omitted buttons.
pub fn pointer(ui: &mut UiState, x: f64, y: f64) -> Option<Control> {
    let control = ui
        .elements()
        .into_iter()
        .find(|element| element.enabled && element.bounds.contains(x, y))
        .map(|element| element.control);
    ui.hover_index = match &control {
        Some(Control::Hover(index)) => Some(*index),
        _ => None,
    };
    ui.hovered = control.clone();
    control
}

/// Synchronize only the owned, focused EDIT control into the shared input model.
pub fn reconcile(ui: &mut UiState, text: &str, cursor: usize, focused: bool) {
    reconcile_selection(ui, text, cursor, cursor, focused);
}
pub fn reconcile_selection(
    ui: &mut UiState,
    text: &str,
    anchor: usize,
    focus: usize,
    focused: bool,
) {
    if !focused
        || ui.surface() != Surface::Activity
        || !ui.enabled(&Control::Field)
    {
        return;
    }
    ui.focus = Some(Control::Field);
    if text != ui.field {
        ui.field.clear();
        ui.cursor = 0;
        ui.selection = None;
        ui.text(text);
    }
    let len = ui.field.chars().count();
    let anchor = anchor.min(len);
    let focus = focus.min(len);
    ui.cursor = focus;
    ui.selection = (anchor != focus).then_some((anchor, focus));
}
