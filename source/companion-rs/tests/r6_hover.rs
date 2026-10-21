use coco_companion::{
    render::{Canvas, Size},
    ui::{Control, Rect, UiState},
};

fn scene(size: Size, dark: bool, below: bool) -> UiState {
    let mut ui = UiState::default();
    ui.dark = dark;
    ui.hover_visible = true;
    ui.unseen = 2;
    ui.visible_rect = Rect { x: 0., y: 0., width: 400., height: 400. };
    let top = if below { 40. } else { 180. };
    ui.companion_frame = Rect { x: 140., y: top, width: size.height(), height: size.height() };
    let bell = ui.hover_button(0);
    ui.set_idle_geometry(top, (bell.x + 12., top + 12.));
    ui
}

fn paint(ui: &UiState, scale: f64) -> Canvas {
    let mut c = Canvas::blank((400. * scale) as u32, (400. * scale) as u32);
    ui.paint_hover(&mut c, scale);
    c
}

fn pixels(c: &Canvas, r: Rect, scale: f64) -> Vec<u8> {
    let mut out = Vec::new();
    for y in (r.y * scale).ceil() as u32..((r.y + r.height) * scale).floor() as u32 {
        for x in (r.x * scale).ceil() as u32..((r.x + r.width) * scale).floor() as u32 {
            let i = ((y * c.width + x) * 4) as usize;
            out.extend_from_slice(&c.pixels[i..i + 4]);
        }
    }
    out
}

#[test]
fn selected_hover_labels_hide_badge_preserve_bell_dot_and_paint_last() {
    for size in Size::ALL {
        for dark in [false, true] {
            for below in [false, true] {
                for scale in [1., 1.25, 2.] {
                    for keyboard in [false, true] {
                        let mut ui = scene(size, dark, below);
                        for index in ui.hover_indices() {
                            ui.hover_index = (!keyboard).then_some(index);
                            ui.focus = keyboard.then_some(Control::Hover(index));
                            let label = ui.hover_label_bounds(index).unwrap();
                            let pill = ui.hover_bounds();
                            assert_eq!(label.y >= pill.y + pill.height, below);
                            let painted = paint(&ui, scale);
                            let element = ui.elements().into_iter()
                                .find(|e| e.control == Control::Hover(index)).unwrap();
                            assert_eq!(painted.texts.last().unwrap().text, element.label,
                                "{size:?} dark={dark} below={below} scale={scale} index={index}: label must be last");
                            assert_eq!(ui.badge_bounds().width, 0., "badge must be hidden while label is visible");
                            assert!(!ui.elements().iter().any(|e| e.control == Control::Badge));
                            assert!(!ui.tab_order().contains(&Control::Badge));
                            let mut seen = ui.clone();
                            seen.unseen = 0;
                            let without_dot = paint(&seen, scale);
                            assert_eq!(pixels(&painted, label, scale), pixels(&without_dot, label, scale),
                                "badge must not cover label background or text");
                            assert_ne!(pixels(&painted, ui.hover_button(0), scale),
                                pixels(&without_dot, ui.hover_button(0), scale), "bell dot must remain");
                        }
                        ui.hover_index = None;
                        ui.focus = None;
                        assert!(ui.badge_bounds().width > 0.);
                        assert!(ui.elements().iter().any(|e| e.control == Control::Badge));
                        assert!(ui.tab_order().contains(&Control::Badge));
                        assert_eq!(paint(&ui, scale).texts.last().unwrap().text, "2");
                    }
                }
            }
        }
    }
}

#[test]
fn badge_visibility_follows_visible_valid_label_selection() {
    let mut ui = scene(Size::Medium, false, true);
    for unseen in [1, 9, 10] {
        ui.unseen = unseen;
        ui.hover_visible = true;
        ui.hover_index = Some(0);
        assert_eq!(ui.badge_bounds().width, 0.);
        ui.hover_visible = false;
        assert!(ui.badge_bounds().width > 0., "hidden pill cannot hide badge");
        ui.hover_visible = true;
        ui.hover_index = Some(1); // Back is absent in the default context.
        assert!(!ui.hover_indices().contains(&1));
        assert!(ui.badge_bounds().width > 0., "absent button has no visible label");
        ui.hover_index = None;
        ui.focus = Some(Control::Badge);
        assert!(ui.badge_bounds().width > 0.);
    }
}
