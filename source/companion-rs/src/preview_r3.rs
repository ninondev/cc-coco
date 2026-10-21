//! Acceptance scenes use the production frame/overlay mapping and approved assets only.
use crate::{
    decor::{CompactPhase, DecorAssets, Helper, ShedEvent, ShedTimeline},
    engine::Engine,
    feed::Record,
    render::{Canvas, Face, Frames, Gesture, Size},
    Error, Options,
};
use std::path::{Path, PathBuf};
pub fn patch_picture(
    frames: &mut Frames,
    entry: &serde_json::Value,
    size: Size,
    scale: f64,
) -> Canvas {
    let mut c = Canvas::blank(
        (320. * scale) as u32,
        ((160. + size.height() * 1.32) * scale).ceil() as u32,
    );
    frames.draw_layers(
        &mut c,
        entry["base"].as_str().unwrap(),
        size,
        scale,
        Gesture::default(),
        &[(entry["face"].as_str().unwrap(), 1.)],
    );
    c
}
pub fn extra(
    options: &Options,
    out: &Path,
    now: u64,
    manifest: &mut Vec<serde_json::Value>,
) -> Result<(), Error> {
    let own = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("assets");
    let source: serde_json::Value =
        serde_json::from_slice(&std::fs::read(options.assets.join("frame-manifest.json"))?)?;
    let mut frames = Frames::load_with_supplement(&options.assets, &own)?;
    let decor = DecorAssets::load(&own)?;
    for dark in [false, true] {
        for scale in [1., 2.] {
            let theme = if dark { "dark" } else { "light" };
            let suffix = if scale == 1. { "1x" } else { "2x" };
            for size in Size::ALL {
                let size_name = format!("{size:?}").to_lowercase();
                let emit = |name: &str, pictures: Vec<Canvas>, manifest: &mut Vec<_>| {
                    crate::preview::write_e2(
                        out,
                        &format!("{name}-{theme}@{suffix}"),
                        pictures,
                        manifest,
                    )
                };
                let blank = || {
                    Canvas::blank(
                        (320. * scale) as u32,
                        ((160. + size.height() * 1.32) * scale).ceil() as u32,
                    )
                };
                for entry in source["frames"].as_array().unwrap() {
                    let name = entry["name"].as_str().unwrap();
                    let mut c = blank();
                    frames.draw(&mut c, name, Face::Open, size, scale, Gesture::default());
                    emit(&format!("frame-{name}-{size_name}"), vec![c], manifest)?;
                }
                for entry in source["patches"].as_array().unwrap() {
                    let family = if size.pixel() { "pixel" } else { "desktop" };
                    if !entry[family].is_object() {
                        continue;
                    }
                    let name = entry["name"].as_str().unwrap();
                    let c = patch_picture(&mut frames, entry, size, scale);
                    emit(&format!("patch-{name}-{size_name}"), vec![c], manifest)?;
                }
                for scenario in ["hover-with-body", "helpers-five"] {
                    let mut o = options.clone();
                    o.size = size;
                    o.folder = out
                        .join("scratch")
                        .join(format!("r3-{scenario}-{size_name}-{theme}-{suffix}"));
                    o.presence_folder = None;
                    let mut e = Engine::new(o, now, 0xC1A0DE)?;
                    let mut r = Record::resting();
                    r.session = format!("r3-{scenario}");
                    r.at = now as f64;
                    if scenario == "helpers-five" {
                        r.helpers = (0..5)
                            .map(|i| Helper {
                                id: i.to_string(),
                                at: now - 2000,
                                ..Default::default()
                            })
                            .collect();
                    }
                    e.preview_record(r, now);
                    e.ui.dark = dark;
                    if scenario == "hover-with-body" {
                        e.ui.hover_visible = true;
                        e.ui.context.back_available = true;
                    }
                    let c = e.render_companion(now + 2000, scale);
                    if size == Size::Medium {
                        emit(scenario, vec![c.clone()], manifest)?;
                    }
                    emit(&format!("{scenario}-{size_name}"), vec![c], manifest)?;
                }
                if size.pixel() {
                    let mut o = options.clone();
                    o.size = size;
                    o.folder = out
                        .join("scratch")
                        .join(format!("r3-shed-{size_name}-{theme}-{suffix}"));
                    o.presence_folder = None;
                    let mut e = Engine::new(o, now, 0xC1A0DE)?;
                    let mut r = Record::resting();
                    r.session = "r3-shed".into();
                    r.at = now as f64;
                    r.frame = "snake".into();
                    r.mood = "snake".into();
                    r.shed = Some(ShedEvent {
                        generation: 1,
                        phase: CompactPhase::End,
                        at: now,
                    });
                    e.preview_record(r, now);
                    e.ui.dark = dark;
                    e.set_native_shed_context(true, 300., true);
                    emit(
                        &format!("shed-with-him-{size_name}"),
                        (0..=80)
                            .map(|i| e.render_companion(now + i * 20, scale))
                            .collect(),
                        manifest,
                    )?;
                } else {
                    let mut timeline = ShedTimeline::default();
                    timeline.receive(ShedEvent {
                        generation: 1,
                        phase: CompactPhase::End,
                        at: now,
                    });
                    let mut pictures = Vec::new();
                    let mut front = Vec::new();
                    for i in 0..=80 {
                        let mut c = blank();
                        frames.draw(&mut c, "snake", Face::Open, size, scale, Gesture::default());
                        decor.shed(
                            &mut c,
                            &timeline.sample(now + i * 20, size, false),
                            size,
                            scale,
                            true,
                            f64::INFINITY,
                            true,
                        );
                        front.push(
                            c.front_pages
                                .as_ref()
                                .map(|p| p.as_ref().clone())
                                .unwrap_or_else(|| Canvas::blank(c.width, c.height)),
                        );
                        pictures.push(c);
                    }
                    emit(
                        &format!("shed-with-him-art-only-{size_name}"),
                        pictures,
                        manifest,
                    )?;
                    emit(
                        &format!("pages-front-art-only-{size_name}"),
                        front,
                        manifest,
                    )?;
                }
            }
        }
    }
    Ok(())
}
