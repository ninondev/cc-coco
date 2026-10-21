use crate::{
    render::{Canvas, Image},
    Error,
};
use std::{cell::RefCell, collections::BTreeMap, sync::Arc};
pub fn source_hash(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf29ce484222325u64, |h, b| {
        (h ^ *b as u64).wrapping_mul(0x100000001b3)
    })
}
#[cfg(not(feature = "runtime-svg"))]
include!(concat!(env!("OUT_DIR"), "/vector_catalog.rs"));
thread_local! {static CACHE:RefCell<BTreeMap<(u64,u32,u32),Arc<Image>>>=const{RefCell::new(BTreeMap::new())};}
pub fn vector_image(bytes: &[u8], w: f64, h: f64, scale: f64) -> Result<Arc<Image>, Error> {
    let (dw, dh) = (
        (w * scale).round().max(1.) as u32,
        (h * scale).round().max(1.) as u32,
    );
    let key = (source_hash(bytes), dw, dh);
    CACHE.with(|cache| {
        if let Some(i) = cache.borrow().get(&key) {
            return Ok(i.clone());
        }
        #[cfg(feature = "runtime-svg")]
        let image = {
            let tree = resvg::usvg::Tree::from_data(bytes, &resvg::usvg::Options::default())?;
            let mut pix = resvg::tiny_skia::Pixmap::new(dw, dh).ok_or("vector dimensions")?;
            resvg::render(
                &tree,
                resvg::tiny_skia::Transform::from_scale(
                    dw as f32 / tree.size().width(),
                    dh as f32 / tree.size().height(),
                ),
                &mut pix.as_mut(),
            );
            Image {
                width: dw as usize,
                height: dh as usize,
                pixels: pix.data().to_vec(),
            }
        };
        #[cfg(not(feature = "runtime-svg"))]
        let image = {
            let candidates = BAKED
                .iter()
                .filter(|(hash, _, _, _)| *hash == key.0)
                .collect::<Vec<_>>();
            let (_, bw, bh, png) = candidates
                .iter()
                .min_by_key(|(_, bw, bh, _)| bw.abs_diff(dw) + bh.abs_diff(dh))
                .ok_or("vector was not baked from approved source")?;
            let pix = tiny_skia::Pixmap::decode_png(png)?;
            let image = Image {
                width: *bw as usize,
                height: *bh as usize,
                pixels: pix.data().to_vec(),
            };
            if *bw == dw && *bh == dh {
                image
            } else {
                let mut pm = tiny_skia::Pixmap::new(dw, dh).ok_or("vector size")?;
                pm.draw_pixmap(
                    0,
                    0,
                    pix.as_ref(),
                    &tiny_skia::PixmapPaint {
                        quality: tiny_skia::FilterQuality::Bilinear,
                        ..Default::default()
                    },
                    tiny_skia::Transform::from_scale(
                        dw as f32 / *bw as f32,
                        dh as f32 / *bh as f32,
                    ),
                    None,
                );
                Image {
                    width: dw as usize,
                    height: dh as usize,
                    pixels: pm.data().to_vec(),
                }
            }
        };
        let image = Arc::new(image);
        let mut c = cache.borrow_mut();
        if c.len() >= 128 {
            c.clear();
        }
        c.insert(key, image.clone());
        Ok(image)
    })
}
pub fn draw_svg(c: &mut Canvas, bytes: &[u8], x: f64, y: f64, w: f64, h: f64, scale: f64) {
    if let Ok(i) = vector_image(bytes, w, h, scale) {
        crate::ui::blit(
            c,
            &i.pixels,
            i.width as u32,
            i.height as u32,
            (x * scale).round() as i32,
            (y * scale).round() as i32,
        );
    }
}
