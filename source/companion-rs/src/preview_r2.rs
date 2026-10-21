//! Additional approved-state previews; all session content is synthetic and stays in TMP.
use crate::{
    engine::Engine,
    feed::Record,
    render::{Canvas, Size},
    ui::{self, Control, MenuAction, MenuContext, Rect, UiPlatform, UiState},
    Error, Options,
};
use std::path::Path;
fn localized(u: &UiState, lang: &str) -> UiState {
    let mut u = u.clone();
    let words: serde_json::Value =
        serde_json::from_str(include_str!("../assets/words/feed.json")).unwrap();
    let map = words[lang].as_object().unwrap();
    let apply = |r: &mut Record| {
        r.lang = lang.into();
        r.name = ui::word(lang, "tray.tip", 0);
        for (k, v) in map {
            r.words.insert(k.clone(), v.as_str().unwrap().into());
            if matches!(k.as_str(), "back" | "opens") {
                r.words
                    .insert(format!("{k}Template"), v.as_str().unwrap().into());
            }
        }
        if let Some(quota) = &mut r.quota {
            for window in &mut quota.windows {
                if window.pace.is_some() {
                    window.pace =
                        Some(ui::word(lang, "quota.pace.wide", 0).replace("{t}", "1h 5m"));
                }
            }
        }
    };
    apply(&mut u.chosen);
    for r in &mut u.rows {
        let state_key = [
            "waitingOK",
            "waitingAnswer",
            "finished",
            "ready",
            "thinking",
        ]
        .into_iter()
        .find(|key| r.state == r.record.word(key));
        apply(&mut r.record);
        if let Some(key) = state_key {
            r.state = r.record.word(key).into();
        }
    }
    for r in &mut u.sessions {
        apply(r);
    }
    u
}
fn sprite(
    options: &Options,
    out: &Path,
    u: UiState,
    now: u64,
    scale: f64,
    id: &str,
) -> Result<Canvas, Error> {
    let mut o = options.clone();
    o.folder = out.join("scratch").join(id);
    o.presence_folder = None;
    let mut e = Engine::new(o, now, 0xC1A0DE)?;
    let mut r = u.chosen.clone();
    r.at = now as f64;
    r.task = None;
    r.said = None;
    r.rest = true;
    r.quota = None;
    r.done = if u.unseen > 0 { now as f64 } else { 0. };
    e.preview_record(r.clone(), now);
    for i in 1..u.unseen {
        r.session = format!("synthetic-badge-{id}-{i}");
        e.preview_add_record(r.clone(), now);
    }
    e.ui = u;
    Ok(e.render_companion(now, scale))
}
pub fn extra(
    options: &Options,
    out: &Path,
    base: &UiState,
    now: u64,
    manifest: &mut Vec<serde_json::Value>,
) -> Result<(), Error> {
    for dark in [false, true] {
        for scale in [1., 2.] {
            let theme = if dark { "dark" } else { "light" };
            let suffix = if scale == 1. { "1x" } else { "2x" };
            let emit = |name: &str, frames: Vec<Canvas>, m: &mut Vec<_>| {
                crate::preview::write_e2(out, &format!("{name}-{theme}@{suffix}"), frames, m)
            };
            for lang in crate::languages::codes() {
                let mut u = localized(base, lang);
                u.dark = dark;
                emit(&format!("activity-{lang}"), vec![u.render(scale)], manifest)?;

                let mut menu = u.clone();
                menu.open_menu(
                    MenuContext {
                        platform: UiPlatform::X11,
                        back_available: true,
                        following: true,
                        ..Default::default()
                    },
                    now,
                );
                emit(&format!("menu-{lang}"), vec![menu.render(scale)], manifest)?;
                let size_row = menu
                    .menu
                    .iter()
                    .position(|r| r.action == Some(MenuAction::SizeMenu))
                    .unwrap();
                menu.activate(Control::Menu(size_row), now);
                emit(
                    &format!("menu-size-submenu-{lang}"),
                    vec![menu.render(scale)],
                    manifest,
                )?;
                for i in 0..5 {
                    let mut hover = u.clone();
                    hover.close();
                    hover.hover_visible = true;
                    hover.context.back_available = true;
                    hover.hover_index = Some(i);
                    emit(
                        &format!("hover-{lang}-{i}"),
                        vec![sprite(
                            options,
                            out,
                            hover,
                            now,
                            scale,
                            &format!("{lang}-{i}-{theme}-{suffix}"),
                        )?],
                        manifest,
                    )?;
                }
            }
            for state in [
                "empty",
                "single",
                "sending",
                "unconfirmed",
                "expired",
                "no-channel",
                "other-day",
                "two-lines",
                "long-project",
                "unfocused",
                "row-focus",
                "send-focus",
                "close-focus",
                "high-contrast",
                "no-quota",
                "hot-week",
                "thread-reached",
            ] {
                let mut u = base.clone();
                u.dark = dark;
                match state{
   "empty"=>{u.rows.clear();u.chosen.channel=false;},"single"=>u.sessions.truncate(1),"sending"|"unconfirmed"|"expired"=>{u.text("test draft");u.activate(Control::Send,now);u.tick(now+match state{"sending"=>1,"unconfirmed"=>5001,_=>60001});},"no-channel"=>u.chosen.channel=false,"other-day"=>u.rows[0].record.at=now as f64-86400000.,"two-lines"=>u.rows[0].excerpt=Some("A synthetic excerpt with enough words to fill two measured lines of this narrow Activity paper.".into()),"long-project"=>{u.rows[0].record.project="a-long-project-name-that-keeps-the-clock-visible".into();u.chosen.project=u.rows[0].record.project.clone();},"unfocused"=>u.focus=Some(Control::Close),"row-focus"=>u.focus=Some(Control::Row(u.rows[0].record.session.clone())),"send-focus"=>{u.text("test draft");u.focus=Some(Control::Send);},"high-contrast"=>u.high_contrast=true,"no-quota"=>u.chosen.quota=None,"hot-week"=>{let q=u.chosen.quota.as_mut().unwrap();q.windows[0].hot=false;q.windows[1].hot=true;q.windows[1].used=Some(92.);},"thread-reached"=>{let q=u.chosen.quota.as_mut().unwrap();q.windows[1].used=Some(81.);},_=>{}}
                if state == "close-focus" {
                    u.focus = Some(Control::Close);
                }
                emit(
                    &format!("activity-{state}"),
                    vec![u.render(scale)],
                    manifest,
                )?;
            }
            for state in [
                "windows-claude-model",
                "windows-code-model",
                "x11-following",
                "wayland",
                "lines-hidden",
                "no-reading",
                "size-submenu",
                "keyboard",
            ] {
                let mut u = base.clone();
                u.dark = dark;
                let mut ctx = MenuContext {
                    platform: UiPlatform::X11,
                    back_available: true,
                    following: true,
                    ..Default::default()
                };
                match state {
                    "windows-claude-model" => {
                        ctx.platform = UiPlatform::Windows;
                        ctx.back_app = "Claude".into();
                    }
                    "windows-code-model" => {
                        ctx.platform = UiPlatform::Windows;
                        ctx.back_app = "Visual Studio Code".into();
                        u.chosen.words.insert("back".into(), "Back to {app}".into());
                    }
                    "wayland" => ctx.platform = UiPlatform::Wayland,
                    "lines-hidden" => ctx.lines_hidden = true,
                    "no-reading" => u.chosen.quota = None,
                    _ => {}
                }
                u.open_menu(ctx, now);
                if state == "size-submenu" {
                    let i = u
                        .menu
                        .iter()
                        .position(|r| r.action == Some(MenuAction::SizeMenu))
                        .unwrap();
                    u.activate(Control::Menu(i), now);
                }
                if state == "keyboard" {
                    u.key(ui::Key::Tab { shift: false }, now);
                }
                emit(&format!("menu-{state}"), vec![u.render(scale)], manifest)?;
            }
            for state in [
                "no-back",
                "lines-hidden",
                "keyboard",
                "badge-nine",
                "badge-nine-plus",
                "label-below",
                "label-edge",
            ] {
                let mut u = base.clone();
                u.close();
                u.dark = dark;
                u.hover_visible = true;
                u.context.back_available = state != "no-back";
                u.hover_index = Some(2);
                u.context.lines_hidden = state == "lines-hidden";
                u.unseen = if state == "badge-nine-plus" {
                    10
                } else if state == "badge-nine" {
                    9
                } else {
                    2
                };
                if state == "keyboard" {
                    u.hover_index = None;
                    u.focus = Some(Control::Hover(4));
                }
                if state.starts_with("label-") {
                    let mut c = Canvas::blank((320. * scale) as u32, (288. * scale) as u32);
                    u.companion_frame = Rect {
                        x: 100.,
                        y: if state == "label-below" { 25. } else { 148. },
                        width: 104.,
                        height: 96.,
                    };
                    u.visible_rect = if state == "label-edge" {
                        Rect {
                            x: 145.,
                            y: 0.,
                            width: 175.,
                            height: 288.,
                        }
                    } else {
                        Rect {
                            x: 0.,
                            y: 0.,
                            width: 320.,
                            height: 288.,
                        }
                    };
                    u.hover_index = Some(0);
                    u.paint_hover(&mut c, scale);
                    emit(&format!("hover-{state}"), vec![c], manifest)?;
                } else {
                    emit(
                        &format!("hover-{state}"),
                        vec![sprite(
                            options,
                            out,
                            u,
                            now,
                            scale,
                            &format!("{state}-{theme}-{suffix}"),
                        )?],
                        manifest,
                    )?;
                }
            }
            for size in Size::ALL {
                for state in [
                    "helpers-one",
                    "helpers-two",
                    "helpers-three",
                    "helpers-four-left",
                    "helpers-five-ledge",
                    "helpers-arriving",
                    "helpers-done",
                    "helpers-failed",
                    "helpers-reduced",
                    "helpers-reduced-done",
                    "helpers-reduced-failed",
                    "neighbours-one",
                    "neighbours-three",
                    "neighbours-done",
                    "neighbours-done-line",
                    "neighbours-reduced",
                    "neighbours-reduced-done",
                ] {
                    let mut opts = options.clone();
                    opts.size = size;
                    opts.reduce_motion = state.contains("reduced");
                    opts.folder = out
                        .join("scratch")
                        .join(format!("{state}-{size:?}-{theme}-{suffix}"));
                    opts.presence_folder = None;
                    let mut e = Engine::new(opts, now, 0xC1A0DE)?;
                    e.ui.dark = dark;
                    let mut r = Record::resting();
                    r.session = "synthetic-r2-decor".into();
                    r.at = now as f64;
                    let helper = state.starts_with("helpers");
                    if helper {
                        let count = if state == "helpers-one" {
                            1
                        } else if state == "helpers-two" {
                            2
                        } else if state == "helpers-three" {
                            3
                        } else if state == "helpers-four-left" {
                            4
                        } else {
                            5
                        };
                        r.helpers = (0..count)
                            .map(|i| crate::decor::Helper {
                                id: i.to_string(),
                                at: if state == "helpers-arriving" {
                                    now
                                } else {
                                    now - 2000
                                },
                                ended_at: if state.ends_with("done") || state.ends_with("failed") {
                                    Some(now)
                                } else {
                                    None
                                },
                                outcome: if state.ends_with("done") {
                                    crate::decor::HelperOutcome::Done
                                } else if state.ends_with("failed") {
                                    crate::decor::HelperOutcome::Failed
                                } else {
                                    crate::decor::HelperOutcome::Working
                                },
                                ..Default::default()
                            })
                            .collect();
                    } else {
                        r.neighbours_enabled = true;
                        r.neighbours =
                            (0..if state == "neighbours-one" || state == "neighbours-done-line" {
                                1
                            } else {
                                3
                            })
                                .map(|i| crate::decor::NeighbourLight {
                                    id: i.to_string(),
                                    label: if i == 0 {
                                        "Codex".into()
                                    } else {
                                        "Gemini".into()
                                    },
                                    busy: true,
                                    at: now - 60000,
                                    ended_at: state.contains("done").then_some(now),
                                    ..Default::default()
                                })
                                .collect();
                    }
                    e.preview_record(r, now);
                    if state.ends_with("ledge") {
                        e.set_native_shed_context(true, 300., true);
                    }
                    if state.ends_with("left") {
                        e.set_speech_side(crate::motion::LineSide::Right);
                    }
                    let moving = state.ends_with("arriving")
                        || state.contains("done")
                        || state.ends_with("failed");
                    let frames = if moving {
                        (0..=80)
                            .map(|i| e.render_companion(now + i * 20, scale))
                            .collect()
                    } else {
                        vec![e.render_companion(now + 2000, scale)]
                    };
                    emit(
                        &format!("{state}-{size:?}").to_lowercase(),
                        frames,
                        manifest,
                    )?;
                }
            }
            for state in ["speech", "speech-long", "task-ribbon", "task-long"] {
                let mut opts = options.clone();
                opts.folder = out
                    .join("scratch")
                    .join(format!("{state}-{theme}-{suffix}"));
                opts.presence_folder = None;
                let mut e = Engine::new(opts, now, 0xC1A0DE)?;
                e.ui.dark = dark;
                let mut r = Record::resting();
                r.session = format!("synthetic-{state}");
                r.at = now as f64;
                r.project = "atlas/plugin".into();
                if state.starts_with("task-") {
                    r.task = Some(if state == "task-long" {
                        "A very long task name that reaches the measured end of this small paper"
                            .into()
                    } else {
                        "working".into()
                    });
                    r.rest = false;
                    r.live_count = 2;
                    r.ribbon = Some(2);
                } else {
                    r.said = Some(if state == "speech-long" {
                        "This synthetic preview has a longer line so the system renderer can wrap it over several lines on his paper, with the same font measurement used for ordinary speech. It contains no user content.".into()
                    } else {
                        "A short synthetic preview line.".into()
                    });
                }
                e.preview_record(r, now);
                emit(state, vec![e.render_companion(now + 100, scale)], manifest)?;
            }
            for size in [Size::Medium, Size::Large] {
                for state in [
                    "shed-reduced-art-only",
                    "shed-room-rule-art-only",
                    "shed-away-edge-art-only",
                ] {
                    let spec: serde_json::Value =
                        serde_json::from_str(include_str!("../assets/shed/shed.json"))?;
                    let grid = &spec["companion"][if size == Size::Large {
                        "large"
                    } else {
                        "medium"
                    }][suffix]["frame_image"];
                    let sw = grid[0].as_u64().unwrap() as u32;
                    let sh = grid[1].as_u64().unwrap() as u32;
                    let decor = crate::decor::DecorAssets::load(
                        &std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("assets"),
                    )?;
                    let mut t = crate::decor::ShedTimeline::default();
                    t.receive(crate::decor::ShedEvent {
                        generation: 1,
                        phase: crate::decor::CompactPhase::End,
                        at: now,
                    });
                    let frames = (0..=80)
                        .map(|i| {
                            let mut c = Canvas::blank(
                                (320. * scale) as u32,
                                ((160. + size.height() * 1.32) * scale).round() as u32,
                            );
                            c.sprite_bounds = (
                                ((320. * scale - sw as f64) / 2.) as i32,
                                (160. * scale) as i32,
                                sw,
                                sh,
                            );
                            decor.shed(
                                &mut c,
                                &t.sample(now + i * 20, size, state.contains("reduced")),
                                size,
                                scale,
                                !state.contains("away"),
                                if state.contains("room-rule") {
                                    26.
                                } else {
                                    f64::INFINITY
                                },
                                true,
                            );
                            c
                        })
                        .collect();
                    emit(
                        &format!("{state}-{size:?}").to_lowercase(),
                        frames,
                        manifest,
                    )?;
                }
            }
            let text = ui::word("en", "pick.help", 0);
            let (width, height) = crate::linux_model::pick_tooltip_metrics(&text, "en", scale);
            let c = crate::linux_model::pick_tooltip(&text, "en", width, height, scale);
            emit("x11-pick-tooltip-current", vec![c], manifest)?;
        }
    }
    Ok(())
}

include!("preview_r6_fixture_tests.rs");
