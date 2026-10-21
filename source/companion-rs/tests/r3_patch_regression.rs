use coco_companion::render::{Canvas, Face, Frames, Gesture, Image, Size};
#[test]
fn every_manifest_patch_keeps_its_exact_registered_pixel_region() {
    let assets = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../assets");
    let manifest: serde_json::Value =
        serde_json::from_slice(&std::fs::read(assets.join("frame-manifest.json")).unwrap())
            .unwrap();
    let mut frames = Frames::load(&assets).unwrap();
    let mut checked = 0;
    for entry in manifest["patches"].as_array().unwrap() {
        for (kind, size) in [("desktop", Size::Medium)] {
            let Some(region) = entry.get(kind).filter(|v| v.is_object()) else {
                continue;
            };
            let base = entry["base"].as_str().unwrap();
            let patch_name = entry["name"].as_str().unwrap();
            let image = Image::load(&assets.join(region["filename"].as_str().unwrap())).unwrap();
            assert_eq!(
                (image.width, image.height),
                (
                    region["width"].as_u64().unwrap() as usize,
                    region["height"].as_u64().unwrap() as usize
                )
            );
            let mut expected = Canvas::blank(320, 288);
            frames.draw(
                &mut expected,
                base,
                Face::Open,
                size,
                1.,
                Gesture::default(),
            );
            let (x, y, _, _) = expected.sprite_bounds;
            expected.overlay(
                &image,
                x as f64 + region["x"].as_f64().unwrap(),
                y as f64 + region["y"].as_f64().unwrap(),
                1.,
                1.,
                0.,
                None,
            );
            let mut actual = Canvas::blank(320, 288);
            frames.draw_layers(
                &mut actual,
                base,
                size,
                1.,
                Gesture::default(),
                &[(patch_name, 1.)],
            );
            assert!(
                actual.pixels == expected.pixels,
                "{kind} {patch_name}: pixels differ"
            );
            checked += 1;
        }
    }
    // The pixel patches leave with the pixel sizes (owner 10-19); every painted one is checked.
    assert_eq!(checked, 36, "all painted patches checked");
}
