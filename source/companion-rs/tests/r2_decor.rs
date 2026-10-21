use coco_companion::{
    decor::{DecorAssets, Helper, NeighbourLight},
    render::{Canvas, Size},
};
fn assets() -> DecorAssets {
    DecorAssets::load(&std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("assets")).unwrap()
}
fn scene() -> Canvas {
    let mut c = Canvas::blank(360, 320);
    c.sprite_bounds = (100, 100, 120, 96);
    c.input_rect(110, 100, 100, 96);
    c
}
fn bounds(c: &Canvas) -> Option<(usize, usize, usize, usize)> {
    let mut b = None;
    for (i, p) in c.pixels.chunks_exact(4).enumerate() {
        if p[3] > 0 {
            let x = i % c.width as usize;
            let y = i / c.width as usize;
            b = Some(b.map_or(
                (x, y, x + 1, y + 1),
                |(a, b, c, d): (usize, usize, usize, usize)| {
                    (a.min(x), b.min(y), c.max(x + 1), d.max(y + 1))
                },
            ));
        }
    }
    b
}
#[test]
fn helper_spacing_uses_silhouette_instead_of_transparent_frame_margin() {
    let d = assets();
    let mut c = scene();
    d.helpers(
        &mut c,
        &[Helper {
            id: "a".into(),
            at: 0,
            ..Default::default()
        }],
        2000,
        Size::Medium,
        1.,
        false,
        false,
        false,
    );
    let b = bounds(&c).unwrap();
    assert!(
        b.0 < 226,
        "helper box starts at opaque silhouette210 + 6, not frame220 + 6: {b:?}"
    );
}
#[test]
fn helper_vector_is_rasterised_at_actual_device_size() {
    let d = assets();
    for scale in [1_f64, 1.25, 1.75, 2., 2.5, 3.] {
        let mut c = Canvas::blank((360. * scale) as u32, (320. * scale) as u32);
        c.sprite_bounds = (
            (100. * scale) as i32,
            (100. * scale) as i32,
            (120. * scale) as u32,
            (96. * scale) as u32,
        );
        c.input_rect(
            (110. * scale) as i32,
            (100. * scale) as i32,
            (100. * scale) as u32,
            (96. * scale) as u32,
        );
        // The scroll is authored 10 by 20 at the old 96-point height and grows with the size.
        let h = Size::Medium.height() / 96.;
        let image = coco_companion::ui::vector_image(
            include_bytes!("../assets/decor/scroll-light.svg"),
            10. * h,
            20. * h,
            scale,
        )
        .unwrap();
        let mut expected = Canvas::blank(c.width, c.height);
        expected.overlay(
            &image,
            (210. * scale).floor() + 6. * scale,
            196. * scale - image.height as f64,
            1.,
            1.,
            0.,
            None,
        );
        d.helpers(
            &mut c,
            &[Helper {
                id: "a".into(),
                at: 0,
                ..Default::default()
            }],
            3000,
            Size::Medium,
            scale,
            false,
            true,
            false,
        );
        assert_eq!(
            c.pixels, expected.pixels,
            "{scale}x: authored SVG pixels are composited without nearest magnification"
        );
    }
}
#[test]
fn helper_ledge_bottom_is_above_the_host_occlusion() {
    let d = assets();
    let h = [Helper {
        id: "a".into(),
        at: 0,
        ..Default::default()
    }];
    let mut free = scene();
    d.helpers_on_ledge(
        &mut free,
        &h,
        3000,
        Size::Medium,
        1.,
        false,
        true,
        false,
        false,
    );
    let mut ledge = scene();
    d.helpers_on_ledge(
        &mut ledge,
        &h,
        3000,
        Size::Medium,
        1.,
        false,
        true,
        false,
        true,
    );
    let a = bounds(&free).unwrap();
    let b = bounds(&ledge).unwrap();
    assert!(
        b.3 <= 192,
        "96px frame's 4.8px sink never clips a scroll: {b:?}"
    );
    assert!(
        (a.3 as i32 - b.3 as i32 - 5).abs() <= 1,
        "ledge correction follows the actual5% sink"
    );
}
#[test]
fn pixel_neighbour_deadlines_are_only_unlit_and_remove_cuts() {
    let busy = NeighbourLight {
        id: "a".into(),
        busy: true,
        at: 1000,
        ..Default::default()
    };
    assert_eq!(busy.pixel_next_deadline(1000), None);
    let done = NeighbourLight {
        ended_at: Some(2000),
        ..busy
    };
    assert_eq!(done.pixel_next_deadline(2000), Some(2200));
    assert_eq!(done.pixel_next_deadline(2200), Some(2550));
    assert_eq!(done.pixel_next_deadline(2550), None);
}
