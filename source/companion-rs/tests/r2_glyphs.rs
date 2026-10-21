use coco_companion::{feed::{Record, Sessions}, ui::{UiState, vector_image}};

#[test]
fn activity_title_has_the_approved_four_arm_spark_at_17_21() {
    let mut record = Record::resting();
    record.session = "spark".into();
    record.at = 1000.;
    let mut sessions = Sessions::default();
    sessions.receive(record, 1001.);
    let mut ui = UiState::default();
    ui.open_activity(&sessions, 1001.);
    let canvas = ui.render(1.);
    let pixel = |x: usize, y: usize| &canvas.pixels[(y * canvas.width as usize + x) * 4..][..4];
    assert_eq!(pixel(47, 51), &[199, 87, 48, 255]);
    for (x, y) in [(47, 48), (47, 54), (44, 51), (50, 51), (45, 49), (49, 53), (49, 49), (45, 53)] {
        let p = pixel(x, y);
        assert!(p[0] < 240 && p[1] < 180, "missing arm at {x},{y}: {p:?}");
    }
    assert_eq!(pixel(53, 57), &[250, 238, 233, 255]);
}

#[test]
fn activity_glyph_pixels_match_the_three_literal_review_drawings() {
    let drawings: [(&[u8], &str, &str, f64); 3] = [
        (include_bytes!("../assets/icons/send-arrow.svg"), "#FAEEE9", "M12 18.2V6.6 M7.6 11 12 6.6l4.4 4.4", 16.),
        (include_bytes!("../assets/icons/new-chat.svg"), "#5C2A1E", "M11.4 4.6H7A2.4 2.4 0 0 0 4.6 7v10A2.4 2.4 0 0 0 7 19.4h10a2.4 2.4 0 0 0 2.4-2.4v-4.4 M10.2 13.8l.5-2.6 7.2-7.2a1.4 1.4 0 0 1 2 2l-7.2 7.2z", 14.),
        (include_bytes!("../assets/icons/target-chevron.svg"), "#5C2A1E", "M8.5 10.2l3.5 3.6 3.5-3.6", 12.),
    ];
    for (actual, ink, path, points) in drawings {
        let expected = format!(r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="{ink}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="{path}"/></svg>"##);
        let tree = resvg::usvg::Tree::from_str(&expected, &Default::default()).unwrap();
        for scale in [1., 2.] {
            let side = (points * scale) as u32;
            let mut reference = resvg::tiny_skia::Pixmap::new(side, side).unwrap();
            resvg::render(&tree, resvg::tiny_skia::Transform::from_scale(side as f32 / 24., side as f32 / 24.), &mut reference.as_mut());
            let rendered = vector_image(actual, points, points, scale).unwrap();
            assert_eq!((rendered.width, rendered.height), (side as usize, side as usize));
            assert_eq!(rendered.pixels, reference.data(), "{path} at {scale}x");
        }
    }
}
