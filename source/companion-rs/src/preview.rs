use crate::{engine::Engine, feed::Record, reactions::TouchEvent, render::Canvas, Error, Options};
use std::{
    fs::{self, File},
    io::{BufWriter, Write},
    path::Path,
    time::{Duration, Instant},
};

pub fn png(path: &Path, canvas: &Canvas) -> Result<(), Error> {
    let out = BufWriter::new(File::create(path)?);
    let mut encoder = png::Encoder::new(out, canvas.width, canvas.height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header()?;
    writer.write_image_data(&canvas.straight_rgba())?;
    Ok(())
}
#[cfg(target_os = "macos")]
pub fn run(options: Options, output: &Path) -> Result<(), Error> {
    fs::create_dir_all(output)?;
    let mut list = Vec::new();
    for scenario in ["idle", "pat", "burst", "wake"] {
        let folder = output.join(scenario);
        fs::create_dir_all(&folder)?;
        let mut options = options.clone();
        options.folder = output.join("scratch");
        options.presence_folder = None;
        let mut engine = Engine::new(options, 1_000_000, 0xC1A0DE)?;
        if scenario == "wake" {
            let mut record = Record::resting();
            record.session = "preview".into();
            record.at = 1_000_000.;
            record.mood = "sleep".into();
            record.frame = "sleep".into();
            engine.preview_record(record, 1_000_000);
        }
        let width = 320;
        let height = (160. + engine.options.size.height()) as u16;
        let file = BufWriter::new(File::create(output.join(format!("{scenario}.gif")))?);
        let mut gif = gif::Encoder::new(file, width, height, &[])?;
        gif.set_repeat(gif::Repeat::Infinite)?;
        for index in 0..300 {
            let elapsed = (index as u64 * 1000) / 30;
            let now = 1_000_000 + elapsed;
            if scenario == "pat" {
                if index == 30 {
                    engine.touch(TouchEvent::Press, now);
                }
                if index == 36 {
                    engine.touch(TouchEvent::Click { alternate: false }, now);
                }
            }
            if scenario == "burst" {
                for press in [30, 39, 48] {
                    if index == press {
                        engine.touch(TouchEvent::Press, now);
                    }
                    if index == press + 2 {
                        engine.touch(TouchEvent::Click { alternate: false }, now);
                    }
                }
            }
            if scenario == "wake" {
                if index == 30 {
                    engine.touch(TouchEvent::Press, now);
                }
                if index == 32 {
                    engine.touch(TouchEvent::Click { alternate: false }, now);
                }
            }
            let mut canvas = engine.render(now, 1.);
            crate::platform::macos_text::paint(&mut canvas)?;
            let path = folder.join(format!("{index:04}.png"));
            png(&path, &canvas)?;
            let mut rgba = canvas.straight_rgba();
            let mut frame = gif::Frame::from_rgba_speed(
                canvas.width as u16,
                canvas.height as u16,
                &mut rgba,
                10,
            );
            frame.delay = if index % 3 == 2 { 4 } else { 3 };
            frame.dispose = gif::DisposalMethod::Background;
            gif.write_frame(&frame)?;
        }
        list.push(format!(
            "{scenario}: 300 PNG frames, 30 fps, 10 seconds; {}",
            output.join(format!("{scenario}.gif")).display()
        ));
    }
    fs::write(output.join("previews.txt"), list.join("\n"))?;
    println!("{}", list.join("\n"));
    Ok(())
}

/// Actual scheduled renderer callbacks; no native window or file watcher on the Mac probe.
pub fn probe(mut options: Options, mode: &str, seconds: u64) -> Result<(), Error> {
    let scratch = std::env::temp_dir().join(format!("companion-probe-{}", std::process::id()));
    fs::create_dir_all(&scratch)?;
    options.folder = scratch;
    options.presence_folder = None;
    if mode == "quiet" {
        options.reduce_motion = true;
    }
    let start_epoch = crate::epoch_ms();
    let mut engine = Engine::new(options, start_epoch, 0xC1A0DE)?;
    if mode == "work" {
        let mut r = Record::resting();
        r.session = "probe".into();
        r.at = start_epoch as f64;
        r.mood = "work".into();
        r.frame = "work-a".into();
        r.loop_frames = Some(["work-a".into(), "work-b".into()]);
        r.every = Some(330.);
        r.rest = false;
        engine.preview_record(r, start_epoch);
    }
    if mode == "reaction" {
        engine.touch(TouchEvent::Click { alternate: false }, start_epoch);
    }
    let mut canvas = engine.render(start_epoch, 1.);
    let before = usage();
    let started = Instant::now();
    let mut callbacks = 0u64;
    println!("probe ready: pid={} mode={mode}", std::process::id());
    std::io::stdout().flush()?;
    let duration = Duration::from_secs(seconds);
    while started.elapsed() < duration {
        let now = crate::epoch_ms();
        let left = duration.saturating_sub(started.elapsed());
        let sleep = engine
            .next_deadline_ms(now)
            .map(|at| Duration::from_millis(at.saturating_sub(now)))
            .unwrap_or(left)
            .min(left);
        std::thread::sleep(sleep);
        if started.elapsed() >= duration {
            break;
        }
        canvas = engine.render(crate::epoch_ms(), 1.);
        callbacks += 1;
    }
    std::hint::black_box(&canvas);
    let after = usage();
    let elapsed = started.elapsed().as_secs_f64();
    let cpu = after.0 - before.0;
    println!(
        "{}",
        serde_json::json!({"mode":mode,"elapsed_seconds":elapsed,"scheduled_callbacks":callbacks,"scheduled_callbacks_per_minute":callbacks as f64*60./elapsed,"cpu_seconds":cpu,"cpu_percent":cpu/elapsed*100.,"resident_bytes":after.1,"peak_resident_bytes":after.2,"os_interrupt_wakeups":after.3.zip(before.3).map(|(a,b)|a.saturating_sub(b)),"scope":"headless common renderer only; excludes Windows/Linux shell and text stacks"})
    );
    Ok(())
}
#[cfg(target_os = "macos")]
fn usage() -> (f64, u64, u64, Option<u64>) {
    use std::ffi::c_void;
    #[repr(C)]
    struct Basic {
        virtual_size: u64,
        resident_size: u64,
        resident_size_max: u64,
        user_time: [i32; 2],
        system_time: [i32; 2],
        policy: i32,
        suspend_count: i32,
    }
    #[repr(C)]
    struct Power {
        total_user: u64,
        total_system: u64,
        interrupt_wakeups: u64,
        platform_idle_wakeups: u64,
        timer_wakeups_bin_1: u64,
        timer_wakeups_bin_2: u64,
    }
    extern "C" {
        static mach_task_self_: u32;
        fn task_info(task: u32, flavor: u32, info: *mut c_void, count: *mut u32) -> i32;
    }
    unsafe {
        let mut ru: libc::rusage = std::mem::zeroed();
        libc::getrusage(libc::RUSAGE_SELF, &mut ru);
        let cpu = ru.ru_utime.tv_sec as f64
            + ru.ru_utime.tv_usec as f64 / 1e6
            + ru.ru_stime.tv_sec as f64
            + ru.ru_stime.tv_usec as f64 / 1e6;
        let mut basic: Basic = std::mem::zeroed();
        let mut count = (std::mem::size_of::<Basic>() / 4) as u32;
        let b = task_info(
            mach_task_self_,
            20,
            (&mut basic as *mut Basic).cast(),
            &mut count,
        );
        let mut power: Power = std::mem::zeroed();
        let mut count = (std::mem::size_of::<Power>() / 4) as u32;
        let p = task_info(
            mach_task_self_,
            21,
            (&mut power as *mut Power).cast(),
            &mut count,
        );
        (
            cpu,
            if b == 0 { basic.resident_size } else { 0 },
            ru.ru_maxrss as u64,
            (p == 0).then_some(power.interrupt_wakeups),
        )
    }
}
#[cfg(not(target_os = "macos"))]
fn usage() -> (f64, u64, u64, Option<u64>) {
    (0., 0, 0, None)
}

#[cfg(target_os = "macos")]
fn review_sessions(now: u64) -> Result<crate::feed::Sessions, Error> {
    use crate::ui;
    let feed_words: serde_json::Value =
        serde_json::from_str(include_str!("../assets/words/feed.json"))?;
    let mut sessions = crate::feed::Sessions::default();
    for (i, (project, mood, task, excerpt)) in [
        (
            "~/Projects/site",
            "waiting",
            None,
            Some("Run npm run deploy?"),
        ),
        (
            "atlas/plugin",
            "idle",
            None,
            Some("The comment nodes now survive both runs."),
        ),
        ("api-client", "work", Some("thinking"), None),
    ]
    .into_iter()
    .enumerate()
    {
        let mut r = Record::from_value(&serde_json::json!({
            "session":format!("preview-{i}"), "at":now,
            "lang":"en", "words":feed_words["en"]
        }))?;
        r.session = format!("preview-{i}");
        r.project = project.into();
        r.mood = mood.into();
        r.at = (now - 1000 - i as u64 * 60_000) as f64;
        r.channel = true;
        r.ribbon = Some(i as u8);
        r.live_count = 3;
        r.task = task.map(|key| r.word(key).to_owned());
        r.rest = task.is_none();
        if mood == "waiting" {
            r.wait_at = r.at
        } else if i == 1 {
            r.done = r.at
        };
        r.reply = excerpt.map(|text| crate::feed::Reply {
            text: text.into(),
            at: r.at,
        });
        r.quota = Some(ui::Quota::example());
        for (index, window) in r.quota.as_mut().unwrap().windows.iter_mut().enumerate() {
            window.reset = Some(
                now as f64
                    + if index == 0 {
                        3_900_000.
                    } else {
                        7. * 86_400_000.
                    },
            );
        }
        r.quota.as_mut().unwrap().windows[0].pace =
            Some(ui::word("en", "quota.pace.wide", 0).replace("{t}", "1h 5m"));
        sessions.receive(r, now as f64);
    }
    Ok(sessions)
}

/// E2 review assets, entirely offscreen. Static GIFs intentionally contain no invented motion.
#[cfg(target_os = "macos")]
pub fn e2(options: Options, output: &Path) -> Result<(), Error> {
    use crate::ui::{self, MenuContext, Rect, UiPlatform, UiState};
    fs::create_dir_all(output)?;
    let mut manifest = Vec::<serde_json::Value>::new();
    let now = std::env::var("COCO_PREVIEW_EPOCH_MS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or_else(crate::epoch_ms);
    let sessions = review_sessions(now)?;
    let mut base = UiState::default();
    base.open_activity(&sessions, now as f64);
    base.context.back_available = true;
    for dark in [false, true] {
        let theme = if dark { "dark" } else { "light" };
        for scale in [1., 2.] {
            let suffix = if scale == 1. { "1x" } else { "2x" };
            let mut activity = base.clone();
            activity.dark = dark;
            write_e2(
                output,
                &format!("activity-{theme}@{suffix}"),
                vec![activity.render(scale)],
                &mut manifest,
            )?;
            let mut target = activity.clone();
            target.activate(ui::Control::Target, now);
            write_e2(
                output,
                &format!("activity-target-{theme}@{suffix}"),
                vec![target.render(scale)],
                &mut manifest,
            )?;
            let mut menu = base.clone();
            menu.dark = dark;
            menu.open_menu(
                MenuContext {
                    platform: UiPlatform::X11,
                    back_available: true,
                    following: false,
                    ..MenuContext::default()
                },
                now,
            );
            write_e2(
                output,
                &format!("menu-{theme}@{suffix}"),
                vec![menu.render(scale)],
                &mut manifest,
            )?;
            for (index, name) in ["activity", "back", "lines", "hide", "size"]
                .iter()
                .enumerate()
            {
                for hovered in [false, true] {
                    let mut state = base.clone();
                    state.close();
                    state.hover_visible = true;
                    state.hover_index = hovered.then_some(index);
                    state.unseen = 2;
                    state.dark = dark;
                    state.context.back_available = true;
                    let mut opts = options.clone();
                    opts.folder = output
                        .join("scratch")
                        .join(format!("hover-{name}-{hovered}-{theme}-{suffix}"));
                    opts.presence_folder = None;
                    let mut engine = Engine::new(opts, now, 0xC1A0DE)?;
                    let mut record = state.chosen.clone();
                    record.at = now as f64;
                    record.frame = "idle-reading".into();
                    record.rest = true;
                    record.said = None;
                    record.task = None;
                    record.quota = None;
                    engine.preview_record(record, now);
                    engine.ui = state;
                    let c = engine.render_companion(now, scale);
                    write_e2(
                        output,
                        &format!(
                            "hover-{name}-{}-{theme}@{suffix}",
                            if hovered { "hover" } else { "rest" }
                        ),
                        vec![c],
                        &mut manifest,
                    )?;
                }
            }
            for n in [16, 20, 22, 24, 28, 32, 36, 40, 44, 48, 64] {
                for state in ["awake", "asleep", "unseen", "asleep-unseen"] {
                    let image = crate::render::Image::load(
                        &Path::new(env!("CARGO_MANIFEST_DIR"))
                            .join(format!("assets/icons/tray-{n}-{state}.png")),
                    )?;
                    let mut c = Canvas::blank((n as f64 * scale) as u32, (n as f64 * scale) as u32);
                    ui::rounded(
                        &mut c,
                        Rect {
                            x: 0.,
                            y: 0.,
                            width: n as f64,
                            height: n as f64,
                        },
                        0.,
                        if dark {
                            [32, 32, 32, 255]
                        } else {
                            [243, 243, 243, 255]
                        },
                        scale,
                    );
                    c.overlay(&image, 0., 0., scale, 1., 0., None);
                    write_e2(
                        output,
                        &format!("tray-{n}-{state}-{theme}@{suffix}"),
                        vec![c],
                        &mut manifest,
                    )?;
                }
            }
            // These are the desktop panel's doubled art grids, not the Windows
            // heads with the same device dimensions. Keep their asset pixels 1:1.
            if scale == 2. {
                for n in [32, 44, 48] {
                    for state in ["awake", "asleep", "unseen", "asleep-unseen"] {
                        let image = crate::render::Image::load(
                            &Path::new(env!("CARGO_MANIFEST_DIR"))
                                .join(format!("assets/icons/tray-linux-{n}-{state}.png")),
                        )?;
                        let mut c = Canvas::blank(n, n);
                        ui::rounded(
                            &mut c,
                            Rect {
                                x: 0.,
                                y: 0.,
                                width: n as f64,
                                height: n as f64,
                            },
                            0.,
                            if dark {
                                [32, 32, 32, 255]
                            } else {
                                [243, 243, 243, 255]
                            },
                            1.,
                        );
                        c.overlay(&image, 0., 0., 1., 1., 0., None);
                        write_e2(
                            output,
                            &format!("tray-linux-{n}-{state}-{theme}-device-grid@{suffix}"),
                            vec![c],
                            &mut manifest,
                        )?;
                    }
                }
            }
            let mut outline = Canvas::blank((304. * scale) as u32, (204. * scale) as u32);
            let pixels = crate::linux_model::outline_pixels(304, 204);
            let image = crate::render::Image {
                width: 304,
                height: 204,
                pixels,
            };
            outline.overlay(&image, 0., 0., scale, 1., 0., None);
            write_e2(
                output,
                &format!("x11-pick-outline-{theme}@{suffix}"),
                vec![outline],
                &mut manifest,
            )?;
            let decor = crate::decor::DecorAssets::load(
                &Path::new(env!("CARGO_MANIFEST_DIR")).join("assets"),
            )?;
            for piece in ["helpers", "neighbours"] {
                let mut opts = options.clone();
                opts.folder = output
                    .join("scratch")
                    .join(format!("{piece}-{theme}-{suffix}"));
                opts.presence_folder = None;
                let mut engine = Engine::new(opts, now, 0xC1A0DE)?;
                engine.ui.dark = dark;
                let mut record = Record::resting();
                record.session = format!("preview-{piece}");
                record.at = now as f64;
                if piece == "helpers" {
                    record.helpers = (0..5)
                        .map(|i| crate::decor::Helper {
                            id: i.to_string(),
                            at: now.saturating_sub(2000),
                            ..Default::default()
                        })
                        .collect();
                } else {
                    record.neighbours_enabled = true;
                    record.neighbours = (0..3)
                        .map(|i| crate::decor::NeighbourLight {
                            id: i.to_string(),
                            label: if i == 0 {
                                "Codex".into()
                            } else if i == 1 {
                                "Gemini".into()
                            } else {
                                "Copilot".into()
                            },
                            busy: i != 1,
                            at: now.saturating_sub(2000 + i * 1000),
                            ..Default::default()
                        })
                        .collect();
                }
                engine.preview_record(record, now);
                write_e2(
                    output,
                    &format!("{piece}-{theme}@{suffix}"),
                    vec![engine.render_companion(now + 2000, scale)],
                    &mut manifest,
                )?;
            }
            let mut timeline = crate::decor::ShedTimeline::default();
            timeline.receive(crate::decor::ShedEvent {
                generation: 1,
                phase: crate::decor::CompactPhase::End,
                at: now,
            });
            let size = options.size;
            let sprite_height = size.height();
            let spec: serde_json::Value =
                serde_json::from_str(include_str!("../assets/shed/shed.json"))?;
            let size_key = "large";
            let grid =
                &spec["companion"][size_key][if scale == 1. { "1x" } else { "2x" }]["frame_image"];
            let sprite_width_px = grid[0].as_u64().ok_or("shed frame width")? as u32;
            let mut frames = vec![];
            for i in 0..81 {
                // The shed's shipped art has a fixed 151 × 128 coordinate system.
                // This remains an approved-art-only preview; matching canvas dimensions
                // do not establish that the skin fits the companion's contour.
                let mut c = Canvas::blank(
                    (320. * scale) as u32,
                    ((160. + sprite_height * 1.32) * scale).ceil() as u32,
                );
                c.sprite_bounds = (
                    (((320. * scale) - sprite_width_px as f64) * 0.5) as i32,
                    (160. * scale) as i32,
                    sprite_width_px,
                    grid[1].as_u64().ok_or("shed frame height")? as u32,
                );
                decor.shed(
                    &mut c,
                    &timeline.sample(now + i * 20, size, false),
                    size,
                    scale,
                    true,
                    f64::INFINITY,
                    true,
                );
                let bottom = c.sprite_bounds.1 as f64 + c.sprite_bounds.3 as f64 - 5. * scale;
                ui::rounded(
                    &mut c,
                    Rect {
                        x: 0.,
                        y: bottom / scale,
                        width: 320.,
                        height: 4.,
                    },
                    0.,
                    if dark {
                        [49, 54, 59, 255]
                    } else {
                        [222, 224, 226, 255]
                    },
                    scale,
                );
                frames.push(c)
            }
            write_e2(
                output,
                &format!("shed-edge-{theme}@{suffix}"),
                frames,
                &mut manifest,
            )?;
        }
    }
    crate::preview_r2::extra(&options, output, &base, now, &mut manifest)?;
    crate::preview_r3::extra(&options, output, now, &mut manifest)?;
    crate::preview_r4::extra(&options, output, now, &mut manifest)?;
    crate::preview_r5::extra(&options, output, now, &mut manifest)?;
    crate::preview_r6::extra(&options, output, now, &mut manifest)?;
    let mut menu = base.clone();
    menu.open_menu(
        MenuContext {
            platform: UiPlatform::X11,
            back_available: true,
            ..MenuContext::default()
        },
        now,
    );
    let mut hover = base.clone();
    hover.close();
    hover.hover_visible = true;
    let mut target = base.clone();
    target.activate(ui::Control::Target, now);
    #[cfg(feature="a11y")]
    let announcements = [("activity", &base), ("hover", &hover), ("menu", &menu), ("target", &target)]
        .into_iter().map(|(surface, ui)| {
            let tree = crate::accessibility::tree(ui, &ui.chosen);
            serde_json::json!({"surface":surface,"nodes":tree.nodes.iter().map(|(id,n)|serde_json::json!({"id":id.0,"role":format!("{:?}",n.role()),"name":n.label(),"state":n.state_description(),"value":n.value(),"disabled":n.is_disabled(),"focus":*id==tree.focus})).collect::<Vec<_>>()})
        }).collect::<Vec<_>>();
    #[cfg(feature = "a11y")]
    fs::write(
        output.join("accessibility-tree.json"),
        serde_json::to_vec_pretty(&announcements)?,
    )?;
    fs::write(
        output.join("manifest.json"),
        serde_json::to_vec_pretty(&manifest)?,
    )?;
    println!("{}", output.display());
    Ok(())
}
#[cfg(target_os = "macos")]
pub(crate) fn write_e2(
    output: &Path,
    name: &str,
    mut frames: Vec<Canvas>,
    manifest: &mut Vec<serde_json::Value>,
) -> Result<(), Error> {
    for c in &mut frames {
        crate::platform::macos_text::paint(c)?;
    }
    let png_path = output.join(format!("{name}.png"));
    png(
        &png_path,
        &frames[if name.starts_with("shed-edge-") || name.starts_with("shed-with-him-") {
            30
        } else {
            0
        }],
    )?;
    let gif_path = output.join(format!("{name}.gif"));
    let file = BufWriter::new(File::create(&gif_path)?);
    let mut gif = gif::Encoder::new(file, frames[0].width as u16, frames[0].height as u16, &[])?;
    gif.set_repeat(gif::Repeat::Infinite)?;
    let count = frames.len();
    let (width_px, height_px) = (frames[0].width, frames[0].height);
    for c in frames {
        let mut rgba = c.straight_rgba();
        let bg = if name.contains("dark") {
            [32u8, 32, 32]
        } else {
            [243u8, 243, 243]
        };
        for p in rgba.chunks_exact_mut(4) {
            let alpha = p[3] as u32;
            for k in 0..3 {
                p[k] = ((p[k] as u32 * alpha + bg[k] as u32 * (255 - alpha) + 127) / 255) as u8;
            }
            p[3] = 255;
        }
        let mut frame = gif::Frame::from_rgba_speed(c.width as u16, c.height as u16, &mut rgba, 10);
        frame.delay = if count == 1 { 100 } else { 2 };
        frame.dispose = gif::DisposalMethod::Background;
        gif.write_frame(&frame)?;
    }
    drop(gif);
    manifest.push(serde_json::json!({"name":name,"png":png_path,"gif":gif_path,"width_px":width_px,"height_px":height_px,"frames":count,"approved_art_only":name.starts_with("shed-edge-") || name.contains("-art-only-"),"png_at_ms":if name.starts_with("shed-edge-") || name.starts_with("shed-with-him-") { 600 } else { 0 },"png_bytes":fs::metadata(png_path)?.len(),"gif_bytes":fs::metadata(gif_path)?.len()}));
    Ok(())
}

#[cfg(all(test, target_os = "macos"))]
mod r6_base_fixture_tests {
    #[test]
    fn base_preview_inputs_are_valid_feed_records_with_words_project_and_recent_time() {
        let now = crate::epoch_ms();
        let sessions = super::review_sessions(now).expect("valid preview feed records");
        let mut ui = crate::ui::UiState::default();
        ui.open_activity(&sessions, now as f64);
        assert_eq!(ui.rows.len(), 3);
        let words: serde_json::Value =
            serde_json::from_str(include_str!("../assets/words/feed.json")).unwrap();
        for row in &ui.rows {
            let r = &row.record;
            assert!(!r.session.is_empty());
            assert!(!r.project.is_empty());
            assert!(now as f64 - r.at >= 0. && now as f64 - r.at < 180_000.);
            for (key, value) in words["en"].as_object().unwrap() {
                if matches!(key.as_str(), "back" | "opens") {
                    assert_eq!(r.app_word(key, "Claude"), value.as_str().unwrap().replace("{app}", "Claude"), "{key}");
                } else {
                    assert_eq!(r.word(key), value.as_str().unwrap(), "{key}");
                }
            }
        }
        let working = ui.rows.iter().find(|row| row.record.project == "api-client").unwrap();
        assert_eq!(working.record.task.as_deref(), words["en"]["thinking"].as_str());
        assert_eq!(working.state, words["en"]["thinking"].as_str().unwrap());
    }
}
