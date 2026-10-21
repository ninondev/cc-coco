#![cfg(target_os = "macos")]
use coco_companion::{
    preview_r3::patch_picture,
    render::{Frames, Image, Size},
};
use std::path::Path;
#[test]
fn every_patch_preview_paints_its_parent_and_opaque_changed_donor_pixel() {
    let assets = Path::new(env!("CARGO_MANIFEST_DIR")).join("../assets");
    let manifest: serde_json::Value =
        serde_json::from_slice(&std::fs::read(assets.join("frame-manifest.json")).unwrap())
            .unwrap();
    let mut frames = Frames::load(&assets).unwrap();
    for (family, size) in [("desktop", Size::Medium)] {
        for patch in manifest["patches"].as_array().unwrap() {
            let Some(meta) = patch[family].as_object() else {
                continue;
            };
            let parent = patch["base"].as_str().unwrap();
            let frame = manifest["frames"]
                .as_array()
                .unwrap()
                .iter()
                .find(|f| f["name"] == parent)
                .unwrap();
            let base = Image::load(
                &assets
                    .join(family)
                    .join(frame["filename"].as_str().unwrap()),
            )
            .unwrap();
            let donor = Image::load(&assets.join(meta["filename"].as_str().unwrap())).unwrap();
            let x = meta["x"].as_u64().unwrap() as usize;
            let y = meta["y"].as_u64().unwrap() as usize;
            let (point, color) = donor
                .pixels
                .chunks_exact(4)
                .enumerate()
                .find(|(i, p)| {
                    let at = 4 * ((y + i / donor.width) * base.width + x + i % donor.width);
                    p[3] == 255 && *p != &base.pixels[at..at + 4]
                })
                .map(|(i, p)| ((x + i % donor.width, y + i / donor.width), p.to_vec()))
                .expect("changed opaque patch pixel");
            let canvas = patch_picture(&mut frames, patch, size, 1.);
            assert_eq!(
                canvas.frame_placement.as_ref().unwrap().name,
                parent,
                "parent {}",
                patch["name"]
            );
            let bounds = canvas.sprite_bounds;
            let at = 4
                * ((bounds.1 as usize + point.1) * canvas.width as usize
                    + bounds.0 as usize
                    + point.0);
            assert_eq!(
                &canvas.pixels[at..at + 4],
                color.as_slice(),
                "{family}/{} at {point:?}",
                patch["name"]
            );
        }
    }
}
