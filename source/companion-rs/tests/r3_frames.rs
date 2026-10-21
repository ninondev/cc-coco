use coco_companion::render::{Canvas, Face, Frames, Gesture, Size};
use std::path::PathBuf;
fn assets() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../assets")
}
#[test]
fn every_manifest_frame_uses_the_new_registered_canvas() {
    let frames = Frames::load(&assets()).unwrap();
    let manifest: serde_json::Value =
        serde_json::from_slice(&std::fs::read(assets().join("frame-manifest.json")).unwrap())
            .unwrap();
    // Frame 42 is the look-up (art-1009, owner 10-09).
    assert_eq!(manifest["frames"].as_array().unwrap().len(), 42);
    for frame in manifest["frames"].as_array().unwrap() {
        let name = frame["name"].as_str().unwrap();
        for size in Size::ALL {
            let p = frames.placement(name, size).unwrap();
            assert!(frames.has_frame(name, size), "{name} {size:?}");
            assert_eq!(
                (p.width, p.height),
                if size.pixel() { (35, 32) } else { (151, 128) }
            );
            assert_eq!(p.overlay_offset_x, 7.);
            assert_eq!(p.parent.as_deref(), frame["base"].as_str());
        }
    }
}
#[test]
fn derived_faces_inherit_registered_parent_patch_without_replacing_pose() {
    let mut frames = Frames::load(&assets()).unwrap();
    for (pose, parent) in [
        ("think-c", "think-a"),
        ("work-c", "work-a"),
        ("happy-rise", "happy"),
    ] {
        for size in Size::ALL {
            let expected = if size.pixel() || pose == "happy-rise" {
                "idle-reading"
            } else {
                parent
            };
            assert_eq!(
                frames.patch_parent(pose, "blink", size).as_deref(),
                Some(expected)
            );
            let mut open = Canvas::blank(320, 288);
            frames.draw(&mut open, pose, Face::Open, size, 1., Gesture::default());
            let mut blink = Canvas::blank(320, 288);
            frames.draw(&mut blink, pose, Face::Closed, size, 1., Gesture::default());
            assert!(
                open.pixels != blink.pixels,
                "{pose} {size:?}: blink did not change the face"
            );
            let (x, y, w, h) = open.sprite_bounds;
            // The top silhouette remains this pose when only its face changes.
            for yy in 0..h / 2 {
                for xx in 0..w {
                    let i = (((y + yy as i32) as u32 * open.width + (x + xx as i32) as u32) * 4)
                        as usize;
                    assert_eq!(&open.pixels[i..i + 4], &blink.pixels[i..i + 4]);
                }
            }
        }
    }
    assert_eq!(
        frames.patch_parent("search-a", "blink", Size::Medium),
        None,
        "tool may not inherit an unrelated idle face"
    );
}
#[test]
fn overlays_share_manifest_source_grid_and_add_legacy_offset_once() {
    let mut frames = Frames::load(&assets()).unwrap();
    for size in Size::ALL {
        for scale in [1., 2.] {
            let mut c = Canvas::blank(640, 576);
            frames.draw(
                &mut c,
                "think-c",
                Face::Open,
                size,
                scale,
                Gesture::default(),
            );
            let (x, y, w, h) = c.sprite_bounds;
            let p = c.frame_placement.as_ref().unwrap();
            assert_eq!(c.frame_point(0., 0.), (x as f64, y as f64));
            assert_eq!(
                c.frame_point(p.width as f64, p.height as f64),
                (x as f64 + w as f64, y as f64 + h as f64)
            );
            if !size.pixel() {
                assert_eq!(c.legacy_painted_point(92., 78.), c.frame_point(99., 78.));
            }
        }
    }
}
