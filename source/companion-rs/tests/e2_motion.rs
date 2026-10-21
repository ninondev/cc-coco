use coco_companion::{
    decor::{CompactPhase, ShedEvent, ShedTimeline},
    motion::SettleRule,
    render::Size,
};

fn canonical_shed_canvas(size: Size, scale: f64) -> coco_companion::render::Canvas {
    let spec: serde_json::Value =
        serde_json::from_str(include_str!("../assets/shed/shed.json")).unwrap();
    let name = if size == Size::Large {
        "large"
    } else {
        "medium"
    };
    let frame = &spec["companion"][name][if scale == 1. { "1x" } else { "2x" }]["frame_image"];
    let mut canvas = coco_companion::render::Canvas::blank(
        (320. * scale) as u32,
        ((160. + size.height() * 1.32) * scale).ceil() as u32,
    );
    canvas.sprite_bounds = (
        ((320. * scale - frame[0].as_u64().unwrap() as f64) * 0.5) as i32,
        (160. * scale) as i32,
        frame[0].as_u64().unwrap() as u32,
        frame[1].as_u64().unwrap() as u32,
    );
    canvas
}

#[test]
fn front_pages_layer_is_transient_input_transparent_and_contains_only_falling_pages() {
    use coco_companion::decor::DecorAssets;
    let decor =
        DecorAssets::load(&std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("assets"))
            .unwrap();
    let mut timeline = ShedTimeline::default();
    timeline.receive(ShedEvent {
        generation: 1,
        phase: CompactPhase::End,
        at: 1000,
    });
    for size in [Size::Medium, Size::Large] {
        for scale in [1., 2.] {
            for elapsed in [0, 400, 519, 520, 600, 800, 1200, 1500, 1600] {
                let mut canvas = canonical_shed_canvas(size, scale);
                let sample = timeline.sample(1000 + elapsed, size, false);
                decor.shed(&mut canvas, &sample, size, scale, true, f64::INFINITY, true);
                let visible = [600, 800, 1200, 1500].contains(&elapsed);
                assert_eq!(
                    canvas.front_pages.is_some(),
                    visible,
                    "{size:?} {scale}x at{elapsed}"
                );
                if let Some(pages) = canvas.front_pages.as_ref() {
                    assert_eq!((pages.width, pages.height), (canvas.width, canvas.height));
                    assert!(pages.front_pages.is_none());
                    assert!(
                        pages.bubble.is_none()
                            && pages.texts.is_empty()
                            && pages.text_styles.is_empty()
                            && pages.text_prefixes.is_empty()
                    );
                    assert_eq!(pages.sprite_bounds, (0, 0, 0, 0));
                    assert!(pages.pixels.chunks_exact(4).any(|pixel| pixel[3] > 0));
                    if elapsed == 600 {
                        assert_ne!(
                            pages.pixels, canvas.pixels,
                            "the skin/pages cell never enters the front layer"
                        );
                    } else if elapsed == 1200 {
                        assert_eq!(pages.pixels, canvas.pixels, "once the skin is gone, both pictures contain exactly the same falling pages");
                    }
                    for y in 0..pages.height {
                        for x in 0..pages.width {
                            assert!(!pages.hit_test(x as i32, y as i32));
                        }
                    }
                    // Every page pixel also remains in the unchanged parent picture.
                    for (page, parent) in pages
                        .pixels
                        .chunks_exact(4)
                        .zip(canvas.pixels.chunks_exact(4))
                    {
                        if page[3] > 0 {
                            assert!(parent[3] >= page[3]);
                        }
                    }
                }
            }
        }
    }
}

#[test]
fn reduced_pixel_and_hidden_shed_have_no_front_pages() {
    use coco_companion::decor::DecorAssets;
    let decor =
        DecorAssets::load(&std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("assets"))
            .unwrap();
    let mut timeline = ShedTimeline::default();
    timeline.receive(ShedEvent {
        generation: 1,
        phase: CompactPhase::End,
        at: 1000,
    });
    let mut visible = canonical_shed_canvas(Size::Medium, 1.);
    decor.shed(
        &mut visible,
        &timeline.sample(1800, Size::Medium, false),
        Size::Medium,
        1.,
        true,
        f64::INFINITY,
        true,
    );
    assert!(
        visible.front_pages.is_some(),
        "front pages exist before visibility gates are applied"
    );
    for (size, reduced, bottom_visible, room) in [
        (Size::Medium, true, true, f64::INFINITY),
        (Size::Medium, false, false, f64::INFINITY),
        (Size::Medium, false, true, 0.),
    ] {
        let mut canvas = canonical_shed_canvas(Size::Medium, 1.);
        decor.shed(
            &mut canvas,
            &timeline.sample(1800, size, reduced),
            size,
            1.,
            true,
            room,
            bottom_visible,
        );
        assert!(canvas.front_pages.is_none());
    }
    // Current painted source frames are 137×128; the approved shed requires151×128.
    // The existing Engine compatibility gate must reject both layers together.
    use coco_companion::{engine::Engine, feed::Record, Options};
    let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let mut engine = Engine::new(
        Options {
            folder: std::env::temp_dir().join("e2-front-pages-incompatible-feed"),
            presence_folder: None,
            assets: root.join("../assets"),
            size: Size::Medium,
            reduce_motion: false,
            follow_class: None,
            trace: false,
            login: false,
        },
        1000,
        42,
    )
    .unwrap();
    let mut record = Record::resting();
    record.session = "incompatible-shed".into();
    record.at = 1000.;
    record.mood = "snake".into();
    record.shed = Some(ShedEvent {
        generation: 1,
        phase: CompactPhase::End,
        at: 1000,
    });
    engine.preview_record(record, 1000);
    let picture = engine.render_companion(1800, 1.);
    assert!(picture.front_pages.is_none());
}

#[test]
fn native_pat_second_stroke_is_the_exact_swift_keyframe() {
    use coco_companion::motion::pat_stroke;
    let low = 0.962 / 0.970;
    for ms in [0., 519., 520., 880., 881., 1400.] {
        assert_eq!(pat_stroke(ms), 1.);
    }
    assert_eq!(pat_stroke(700.), low);
    assert_eq!(pat_stroke(610.), (1. + low) / 2.);
    assert_eq!(pat_stroke(790.), (1. + low) / 2.);
}

#[test]
fn helpers_at_rest_do_not_keep_idle_motion_running_after_sixty_seconds() {
    use coco_companion::{decor::Helper, engine::Engine, feed::Record, Options};
    let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let options = Options {
        folder: std::env::temp_dir().join("companion-e2-absent-helpers-feed"),
        presence_folder: None,
        assets: root.join("../assets"),
        size: Size::Medium,
        reduce_motion: false,
        follow_class: None,
        trace: false,
        login: false,
    };
    let mut engine = Engine::new(options, 1000, 42).unwrap();
    let mut record = Record::resting();
    record.session = "helper-settle".into();
    record.at = 1000.;
    record.helpers = vec![Helper {
        id: "one".into(),
        at: 1000,
        ..Default::default()
    }];
    engine.preview_record(record, 1000);
    engine.render(61000, 1.);
    assert_eq!(engine.next_deadline_ms(61000), None);
}

#[test]
fn a_line_stays_twenty_points_above_the_actual_overscanned_sprite() {
    use coco_companion::{engine::Engine, feed::Record, render::Size, Options};
    let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let folder = std::env::temp_dir().join(format!("e2-spoken-line-clearance-{}", std::process::id()));
    std::fs::create_dir_all(&folder).unwrap();
    let mut engine = Engine::new(
        Options {
            folder: folder.clone(),
            presence_folder: None,
            assets: root.join("../assets"),
            size: Size::Medium,
            reduce_motion: false,
            follow_class: None,
            trace: false,
            login: false,
        },
        1000,
        42,
    )
    .unwrap();
    let mut record = Record::resting();
    record.session = "line-clearance".into();
    record.at = 1000.;
    record.said = Some("A long enough activity line to span several rows in his paper".into());
    record.rest = false;
    engine.preview_record(record, 1000);
    for scale in [1., 2.] {
        let canvas = engine.render_companion(2000, scale);
        let run = canvas.bubble.as_ref().unwrap();
        // measured from where her head room ends: her picture has more room above her than his frame had
        assert!(
            canvas.head_drop > 0.,
            "scale {scale}: she is drawn, and her line comes down"
        );
        assert!(
            run.y + run.height
                <= canvas.sprite_bounds.1 as f64 + canvas.head_drop - 20. * scale + 0.01,
            "scale {scale}, paper y={}, height={}, sprite {:?}, head drop {}",
            run.y,
            run.height,
            canvas.sprite_bounds,
            canvas.head_drop
        );
    }
    std::fs::remove_dir_all(folder).unwrap();
}

#[test]
fn a_task_pill_bottom_sits_four_points_into_the_actual_overscanned_sprite() {
    use coco_companion::{engine::Engine, feed::Record, render::Size, Options};
    let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let folder = std::env::temp_dir().join(format!("e2-line-clearance-{}", std::process::id()));
    std::fs::create_dir_all(&folder).unwrap();
    let mut engine = Engine::new(
        Options {
            folder: folder.clone(),
            presence_folder: None,
            assets: root.join("../assets"),
            size: Size::Medium,
            reduce_motion: false,
            follow_class: None,
            trace: false,
            login: false,
        },
        1000,
        42,
    )
    .unwrap();
    let mut record = Record::resting();
    record.session = "line-clearance".into();
    record.at = 1000.;
    record.task = Some("A long enough activity line to span several rows in his paper".into());
    record.rest = false;
    engine.preview_record(record, 1000);
    for scale in [1., 2.] {
        let canvas = engine.render_companion(2000, scale);
        let run = canvas.bubble.as_ref().unwrap();
        assert!(
            canvas.bubble_is_task
                && (run.y - 3. * scale + 22. * scale
                    - (canvas.sprite_bounds.1 as f64 + canvas.head_drop + 4. * scale))
                    .abs()
                    < 0.01,
            "scale {scale}, paper y={}, height={}, sprite {:?}",
            run.y,
            run.height,
            canvas.sprite_bounds
        );
    }
    std::fs::remove_dir_all(folder).unwrap();
}

#[test]
fn native_hover_composition_keeps_task_suppression_without_mutating_ui_state() {
    use coco_companion::{engine::Engine, feed::Record, render::Size, Options};
    let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let folder = std::env::temp_dir().join(format!("e2-hover-composition-{}", std::process::id()));
    std::fs::create_dir_all(&folder).unwrap();
    let mut engine = Engine::new(
        Options {
            folder: folder.clone(),
            presence_folder: None,
            assets: root.join("../assets"),
            size: Size::Medium,
            reduce_motion: false,
            follow_class: None,
            trace: false,
            login: false,
        },
        1000,
        42,
    )
    .unwrap();
    let mut record = Record::resting();
    record.session = "hover-composition".into();
    record.at = 1000.;
    record.task = Some("working".into());
    record.rest = false;
    engine.preview_record(record, 1000);
    engine.ui.pointer(true, 1000);
    engine.ui.tick(2000);
    assert!(engine.ui.hover_visible);
    let canvas = engine.render_companion_without_hover(2000, 1.);
    assert!(engine.ui.hover_visible);
    assert!(canvas.bubble.is_none());
    let mut canvas = canvas;
    let b = engine.ui.hover_bounds();
    engine.ui.paint_hover(&mut canvas, 1.);
    assert!(canvas.hit_test((b.x + 12.) as i32, (b.y + 12.) as i32));
    engine.ui.hover_visible = false;
    let canvas = engine.render_companion_without_hover(2001, 1.);
    assert!(canvas.bubble_is_task);
    assert!(canvas.bubble.is_some());
    let run = canvas.bubble.as_ref().unwrap();
    assert!(
        (run.width + 32.
            - (coco_companion::ui::text_width("working", "en", 12., false, false) + 32.)
                .ceil())
        .abs()
            < 0.01
    );
    engine.set_ui_viewport(Some(coco_companion::ui::Rect {
        x: 80.,
        y: 0.,
        width: 70.,
        height: 288.,
    }));
    let canvas = engine.render_companion_without_hover(2002, 1.);
    if let Some(run) = canvas.bubble {
        assert!(run.width + 32. <= 62.);
    }
    engine.hide(2003);
    let canvas = engine.render_companion_without_hover(2003, 1.);
    assert!(canvas.pixels.iter().all(|p| *p == 0));
    std::fs::remove_dir_all(folder).unwrap();
}

#[test]
fn automatic_native_ledge_context_overrides_only_the_shed_placement_context() {
    use coco_companion::{engine::Engine, render::Size, Options};
    let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let mut engine = Engine::new(
        Options {
            folder: std::env::temp_dir().join("e2-ledge-context-no-feed"),
            presence_folder: None,
            assets: root.join("../assets"),
            size: Size::Medium,
            reduce_motion: false,
            follow_class: None,
            trace: false,
            login: false,
        },
        1000,
        42,
    )
    .unwrap();
    assert!(!engine.on_ledge());
    engine.set_native_shed_context(true, 64., true);
    assert!(engine.on_ledge());
    assert_eq!(engine.window_anchor(), None);
    engine.set_native_shed_context(false, 64., true);
    assert!(!engine.on_ledge());
    engine.clear_native_shed_context();
    assert!(!engine.on_ledge());
}

#[test]
fn helper_row_keeps_the_approved_gap_on_either_side() {
    use coco_companion::decor::helper_x;
    assert_eq!(helper_x(100., 114., 10., 0, 1., 1., false), 220.);
    assert_eq!(helper_x(100., 114., 10., 0, 1., 1., true), 84.);
    assert_eq!(helper_x(100., 114., 10., 2, 1., 1., false), 248.);
    assert_eq!(helper_x(100., 114., 10., 2, 1., 1., true), 56.);
}

#[test]
fn pixel_helper_arrival_and_departure_are_cuts_without_frame_timers() {
    use coco_companion::decor::{Helper, HelperOutcome};
    let mut helper = Helper {
        id: "pixel".into(),
        at: 1000,
        ..Default::default()
    };
    assert_eq!(helper.pixel_sample(1259, 260).opacity, 0.);
    assert_eq!(helper.pixel_next_deadline(1259, 260), Some(1260));
    let still = helper.pixel_sample(1260, 260);
    assert_eq!(
        (still.opacity, still.dy, still.sy, still.degrees),
        (1., 0., 1., 0.)
    );
    assert_eq!(helper.pixel_next_deadline(1260, 260), None);
    helper.ended_at = Some(2000);
    helper.outcome = HelperOutcome::Done;
    assert_eq!(helper.pixel_next_deadline(2000, 260), Some(2260));
    assert_eq!(helper.pixel_sample(2259, 260).opacity, 1.);
    assert_eq!(helper.pixel_sample(2260, 260).opacity, 0.);
    assert_eq!(helper.pixel_next_deadline(2260, 260), None);
}

#[test]
fn settle_has_no_animation_deadline_at_or_after_sixty_seconds() {
    let mut settle = SettleRule::new(1000);
    assert_eq!(settle.filter_deadline(59000, 60500, false), Some(60500));
    assert_eq!(settle.filter_deadline(59000, 61000, false), None);
    assert_eq!(settle.filter_deadline(61000, 62000, false), None);
    assert_eq!(settle.filter_deadline(61000, 62000, true), Some(62000));
    settle.event(62000);
    assert!(settle.moves(62000, false, true, false));
    assert!(!settle.moves(62000, false, true, true));
    assert!(!settle.moves(62000, false, false, false));
}

#[test]
fn shed_uses_the_painted_clock_and_finishes_exactly_at_1600() {
    let mut shed = ShedTimeline::default();
    shed.receive(ShedEvent {
        generation: 1,
        phase: CompactPhase::Begin,
        at: 1000,
    });
    assert!(shed.sample(99000, Size::Medium, false).held);
    shed.receive(ShedEvent {
        generation: 1,
        phase: CompactPhase::End,
        at: 100000,
    });
    let s = shed.sample(100520, Size::Medium, false);
    assert_eq!(s.lying_opacity, 0.);
    assert_eq!(s.pages_cell_opacity, 1.);
    assert_eq!(s.pages.len(), 1);
    assert_eq!(s.pages[0].opacity, 0.);
    assert_eq!(shed.sample(101599, Size::Medium, false).pages.len(), 1);
    assert!(!shed.sample(101600, Size::Medium, false).active);
    assert_eq!(shed.next_deadline(101600, false), None);
}

#[test]
fn a_second_compaction_cancels_falling_pages_and_skip_returns_without_skin() {
    let mut shed = ShedTimeline::default();
    shed.receive(ShedEvent {
        generation: 1,
        phase: CompactPhase::End,
        at: 1000,
    });
    assert!(!shed.sample(1800, Size::Medium, false).pages.is_empty());
    shed.receive(ShedEvent {
        generation: 2,
        phase: CompactPhase::Begin,
        at: 1800,
    });
    assert!(shed.sample(1800, Size::Medium, false).pages.is_empty());
    shed.receive(ShedEvent {
        generation: 2,
        phase: CompactPhase::Skip,
        at: 2000,
    });
    assert!(!shed.sample(2000, Size::Medium, false).active);
}

#[test]
fn reduced_shed_is_whole_for_600_then_only_fades_until_800() {
    let mut shed = ShedTimeline::default();
    shed.receive(ShedEvent {
        generation: 1,
        phase: CompactPhase::End,
        at: 1000,
    });
    for at in [1000, 1250, 1599, 1600] {
        let sample = shed.sample(at, Size::Medium, true);
        assert_eq!(sample.lying_opacity, 1.);
        assert_eq!(sample.reveal, 1.);
        assert!(sample.pages.is_empty());
        assert_eq!(sample.pages_cell_opacity, 0.);
    }
    assert_eq!(shed.sample(1700, Size::Medium, true).lying_opacity, 0.5);
    assert_eq!(shed.sample(1800, Size::Medium, true).lying_opacity, 0.);
}

#[test]
fn helper_end_motion_is_event_bounded_and_main_loop_only() {
    use coco_companion::decor::{Helper, HelperOutcome};
    let done = Helper {
        id: "a".into(),
        at: 1000,
        ended_at: Some(2000),
        outcome: HelperOutcome::Done,
        parent: None,
    };
    assert_eq!(done.sample(2000, 0, false).opacity, 1.);
    assert!(!done.visible(2260));
    assert_eq!(done.next_deadline(2260, 0, false), None);
    let failed = Helper {
        outcome: HelperOutcome::Failed,
        ..done.clone()
    };
    assert_eq!(failed.sample(2300, 0, false).degrees, 70.);
    assert_eq!(failed.sample(2400, 0, false).opacity, 0.5);
    assert!(!failed.visible(2500));
    assert_eq!(failed.next_deadline(2500, 0, false), None);
    let child = Helper {
        parent: Some("main-helper".into()),
        ..failed
    };
    assert!(!child.visible(2000));
}

#[test]
fn neighbours_are_dark_for_partial_state_and_still_after_arrival() {
    use coco_companion::decor::NeighbourLight;
    let mut light = NeighbourLight {
        id: "supplied".into(),
        label: "Supplied agent".into(),
        busy: true,
        partial: false,
        at: 1000,
        ended_at: None,
    };
    assert_eq!(light.sample(1240, false), (1., 0., 1.));
    assert_eq!(light.sample(50000, false), (1., 0., 1.));
    light.partial = true;
    assert_eq!(light.sample(50000, false), (0., 0., 0.));
    light.partial = false;
    light.ended_at = Some(50000);
    assert_eq!(light.sample(50400, false), (1., 0., 0.));
    assert_eq!(light.sample(50700, false), (0., 0., 0.));
}

#[test]
fn approved_companion_physics_golden_duck_pop_squeeze_and_cling() {
    use coco_companion::motion::{place_duck, place_pop, Cling, Squeeze};
    let golden: serde_json::Value =
        serde_json::from_str(include_str!("fixtures/companion-golden.json")).unwrap();
    for name in ["duck", "pop"] {
        for v in golden[name].as_array().unwrap() {
            let ms = v["ms"].as_f64().unwrap();
            let ledge = v["ledge"].as_bool().unwrap();
            let s = if name == "duck" {
                place_duck(ms, 96., ledge, false)
            } else {
                place_pop(ms, 96., ledge, false)
            };
            assert!((s.dy - v["dy"].as_f64().unwrap()).abs() < 0.05);
            assert!((s.sy - v["scaleY"].as_f64().unwrap()).abs() < 0.0005);
            assert!((s.alpha - v["alpha"].as_f64().unwrap()).abs() < 0.01);
        }
    }
    let mut squeeze = Squeeze::default();
    for v in golden["squeeze"].as_array().unwrap() {
        let (scale, push, other) = squeeze.update(
            v["t"].as_f64().unwrap(),
            v["room_over_size"].as_f64().unwrap(),
        );
        assert!((scale - v["scale"].as_f64().unwrap()).abs() < 0.0002);
        assert!((push - v["push"].as_f64().unwrap()).abs() < 0.0002);
        assert!((other - v["other_axis"].as_f64().unwrap()).abs() < 0.0002);
    }
    for (name, v) in golden["cling"].as_object().unwrap() {
        let down = &v["mouse_down"];
        let mut cling = Cling::default();
        cling.begin(
            down["t"].as_f64().unwrap(),
            [
                down["anchor"][0].as_f64().unwrap(),
                down["anchor"][1].as_f64().unwrap(),
            ],
        );
        let events = v["events"].as_array().unwrap();
        let mut i = 0;
        let up = v["mouse_up"].as_f64().unwrap();
        let mut released = false;
        for e in v["expect"].as_array().unwrap() {
            let t = e["t"].as_f64().unwrap();
            while i < events.len() && events[i]["t"].as_f64().unwrap() <= t {
                let event = &events[i];
                cling.event(
                    event["t"].as_f64().unwrap(),
                    [
                        event["anchor"][0].as_f64().unwrap(),
                        event["anchor"][1].as_f64().unwrap(),
                    ],
                );
                i += 1;
            }
            if !released && up <= t {
                cling.release(up);
                released = true
            }
            let s = cling.shown(t, false);
            assert!(
                (s.lean - e["lean"].as_f64().unwrap()).abs() < 0.01,
                "{name} {t} lean"
            );
            assert!(
                (s.sy - e["scaleY"].as_f64().unwrap()).abs() < 0.0002,
                "{name} {t} sy"
            );
            assert!(
                (s.sx - e["scaleX"].as_f64().unwrap()).abs() < 0.0002,
                "{name} {t} sx"
            );
        }
    }
}

#[test]
fn engine_cuts_to_open_still_on_the_last_redraw_before_settle() {
    use coco_companion::{engine::Engine, feed::Record, Options};
    let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let options = Options {
        folder: std::env::temp_dir().join("companion-e2-absent-feed"),
        presence_folder: None,
        assets: root.join("../assets"),
        size: Size::Medium,
        reduce_motion: false,
        follow_class: None,
        trace: false,
        login: false,
    };
    let mut engine = Engine::new(options.clone(), 1000, 42).unwrap();
    let mut record = Record::resting();
    record.session = "settle-test".into();
    record.at = 1000.;
    record.reactions.clear();
    engine.preview_record(record.clone(), 1000);
    let mut now = 1000;
    while let Some(next) = engine.next_deadline_ms(now) {
        assert!(next < 61000);
        now = next;
        engine.render(now, 1.);
    }
    let final_canvas = engine.render(now, 1.);
    let mut still = options;
    still.reduce_motion = true;
    let mut reference = Engine::new(still, 1000, 42).unwrap();
    reference.preview_record(record, 1000);
    assert!(
        final_canvas.pixels == reference.render(now, 1.).pixels,
        "the terminal redraw must be the open still"
    );
    assert_eq!(engine.next_deadline_ms(61000), None);
}

#[test]
fn line_placement_keeps_side_until_a_preferred_side_has_twelve_points() {
    use coco_companion::motion::{line_placement, LineFlip, LineSide, PlaceMode, ScreenRect};
    let screen = ScreenRect {
        x: 0.,
        y: 0.,
        width: 800.,
        height: 600.,
    };
    let sprite = ScreenRect {
        x: 350.,
        y: 200.,
        width: 113.25,
        height: 96.,
    };
    let p = line_placement(
        sprite,
        screen,
        [280., 70.],
        PlaceMode::Ledge,
        Some(LineSide::Right),
        None,
    )
    .unwrap();
    assert_eq!(p.side, LineSide::Left);
    let cramped = ScreenRect { x: 70., ..sprite };
    let p = line_placement(
        cramped,
        screen,
        [280., 70.],
        PlaceMode::Ledge,
        Some(LineSide::Right),
        None,
    )
    .unwrap();
    assert_eq!(p.side, LineSide::Right);
    let mut flip = LineFlip::default();
    flip.change(p, 1000);
    assert_eq!(flip.sample(1000, false).alpha, 1.);
    let q = line_placement(
        sprite,
        screen,
        [280., 70.],
        PlaceMode::Ledge,
        Some(LineSide::Right),
        None,
    )
    .unwrap();
    flip.change(q, 2000);
    assert_eq!(flip.sample(2070, false).alpha, 0.);
    assert_eq!(flip.sample(2190, false).alpha, 1.);
    assert_eq!(flip.next_deadline(2190), None);
}

#[test]
fn drag_face_and_pixel_shift_obey_the_approved_hysteresis_and_deadlines() {
    use coco_companion::motion::{DragFace, PixelLean};
    let mut faces = DragFace::default();
    faces.begin(1000);
    faces.speed(1300., 1010);
    assert_eq!(faces.face(1010), Some("squeeze"));
    faces.speed(200., 1100);
    assert_eq!(faces.face(1309), Some("squeeze"));
    assert_eq!(faces.face(1320), None);
    assert_eq!(faces.face(1670), Some("blink"));
    assert_eq!(faces.face(1800), None);
    faces.begin(2000);
    faces.begin(3000);
    faces.speed(1300., 3010);
    assert_eq!(faces.face(3010), Some("smile"));
    let mut shift = PixelLean::default();
    assert_eq!(shift.update(3.), 1);
    assert_eq!(shift.update(2.3), 1);
    assert_eq!(shift.update(0.8), 0);
    assert_eq!(shift.update(-7.), -2);
}

#[test]
fn relocation_changes_place_after_duck_then_finishes_the_approved_pop() {
    use coco_companion::motion::Relocation;
    let mut relocation = Relocation::default();
    relocation.start([10., 20.], [300., 40.], false, true, 0., 1000);
    assert_eq!(relocation.sample(1000, 96., false).anchor, [10., 20.]);
    assert_eq!(relocation.sample(1109, 96., false).anchor, [10., 20.]);
    assert_eq!(relocation.sample(1110, 96., false).anchor, [300., 40.]);
    assert_eq!(relocation.next_deadline(1656), None);
    let sample = relocation.sample(1656, 96., false);
    assert_eq!(sample.dy, 0.);
    assert_eq!(sample.sy, 1.);
    assert_eq!(sample.alpha, 1.);
    relocation.start([10., 20.], [300., 40.], true, false, 0.91, 2000);
    assert_eq!(relocation.sample(2000, 96., false).anchor, [300., 40.]);
}

#[test]
fn relocation_retargets_only_before_the_exact_duck_boundary() {
    use coco_companion::motion::Relocation;
    let mut r = Relocation::default();
    r.start([10., 20.], [300., 40.], true, true, 0., 1000);
    assert!(r.ducking(1129, false));
    assert!(r.retarget([400., 50.], false, 1129, false));
    assert_eq!(r.sample(1129, 96., false).anchor, [10., 20.]);
    assert!(!r.ducking(1130, false));
    assert_eq!(r.sample(1130, 96., false).anchor, [400., 50.]);
    assert!(!r.retarget([900., 50.], true, 1130, false));
    assert_eq!(r.sample(1622, 96., false).anchor, [400., 50.]);
    assert_eq!(r.next_deadline(1622), None);
    r.start([0., 0.], [1., 1.], false, false, 0., 2000);
    assert!(r.ducking(2099, true));
    assert!(!r.ducking(2100, true));
}

#[test]
fn relocation_tracks_a_moving_host_during_pop_without_restarting_it() {
    use coco_companion::motion::Relocation;
    let mut r = Relocation::default();
    r.start([10., 20.], [300., 40.], true, true, 0., 1000);
    assert!(!r.track_pop_anchor([400., 50.], 1129, false));
    let before = r.sample(1300, 96., false);
    assert!(r.track_pop_anchor([400., 50.], 1300, false));
    let after = r.sample(1300, 96., false);
    assert_eq!(after.anchor, [400., 50.]);
    assert_eq!(
        (after.dy, after.sy, after.alpha),
        (before.dy, before.sy, before.alpha)
    );
    assert_eq!(r.next_deadline(1676), None);
    assert!(!r.track_pop_anchor([500., 50.], 1676, false));
}

#[test]
fn pointer_bands_have_exact_hysteresis_dwell_and_no_idle_schedule() {
    use coco_companion::motion::{PointerBand, PointerFade};
    let mut p = PointerFade::default();
    p.update(40., false, 1000);
    assert_eq!(p.band(), PointerBand::Near);
    assert!((p.opacity(1090) - 0.45).abs() < 1e-12);
    p.update(52., false, 1100);
    assert_eq!(p.next_deadline(1100), None);
    p.update(53., false, 1200);
    assert_eq!(p.next_deadline(1200), Some(1450));
    p.advance(1450);
    assert_eq!(p.band(), PointerBand::Far);
    assert!((p.opacity(1690) - 1.).abs() < 1e-12);
    assert_eq!(p.next_deadline(1690), None);
    p.update(8., false, 1800);
    assert_eq!(p.band(), PointerBand::Over);
    assert!((p.opacity(1890) - 0.12).abs() < 1e-12);
    p.update(20., false, 1900);
    assert_eq!(p.band(), PointerBand::Over);
    p.update(21., false, 2000);
    p.advance(2250);
    assert_eq!(p.band(), PointerBand::Near);
    p.update(30., true, 2260);
    assert_eq!(p.band(), PointerBand::Far);
}

#[test]
fn press_continues_from_presentation_and_repeat_impulses_are_additive() {
    use coco_companion::motion::PressTransform;
    let from = PressTransform {
        sx: 1.02,
        sy: 0.98,
        skew: 0.02,
    };
    let first = PressTransform::sample(from, 0., false);
    assert_eq!(first.sx, from.sx);
    assert_eq!(first.sy, from.sy * 0.997);
    assert_eq!(first.skew, from.skew);
    let repeat = PressTransform::sample(from, 0., true);
    assert_eq!(repeat.sy, first.sy - 0.01);
    let final_press = PressTransform::sample(from, 320., false);
    assert!((final_press.sy - 0.970).abs() < 1e-12);
    assert!((final_press.sx - 1.009).abs() < 1e-12);
    let release = PressTransform::release(final_press, 0.);
    assert_eq!(release.sy, final_press.sy);
    let settled = PressTransform::release(final_press, 1600.);
    assert!((settled.sy - 1.).abs() < 1e-10);
    assert_eq!(PressTransform::impulse(0.), -0.01);
    assert!(
        (PressTransform::impulse(100.) + PressTransform::impulse(0.) + 0.01)
            - PressTransform::impulse(100.)
            < 1e-12
    );
}

#[test]
fn native_touch_sequence_has_swift_cuts_and_missing_pose_fallback() {
    use coco_companion::motion::touch_sequence;
    for (ms, frame, face) in [
        (0, "idle-reading", "open"),
        (54, "idle-reading", "open"),
        (55, "flustered", "open"),
        (379, "flustered", "open"),
        (380, "shiori-a", "open"),
        (480, "shiori-b", "open"),
        (1749, "shiori-b", "open"),
        (1750, "idle-reading", "squeeze"),
    ] {
        assert_eq!(
            touch_sequence("flustered", "idle-reading", ms, false, |_| true),
            (frame.into(), face.into())
        );
    }
    assert_eq!(
        touch_sequence("flustered", "idle-reading", 480, false, |name| name
            != "shiori-b"),
        ("shiori-a".into(), "open".into())
    );
    assert_eq!(
        touch_sequence("hold", "idle-reading", 55, false, |_| false),
        ("idle-reading".into(), "open".into())
    );
    for (ms, face) in [
        (0, "closed"),
        (259, "closed"),
        (260, "smile"),
        (1399, "smile"),
        (1400, "open"),
    ] {
        assert_eq!(
            touch_sequence("pat", "idle-reading", ms, true, |_| true).1,
            face
        );
    }
    for (ms, face) in [
        (0, "open"),
        (40, "half"),
        (120, "closed"),
        (260, "smile"),
        (1250, "half"),
        (1340, "open"),
    ] {
        assert_eq!(
            touch_sequence("pat", "idle-reading", ms, false, |_| true).1,
            face
        );
    }
    for (ms, name) in [(0, "idle-reading"), (33, "error"), (180, "refuse")] {
        assert_eq!(
            touch_sequence("drag", "idle-reading", ms, false, |_| true).0,
            name
        );
    }
}

#[test]
fn native_press_release_paths_keep_swift_faces_and_pose_cuts() {
    use coco_companion::{
        engine::Engine, feed::Record, reactions::TouchEvent, render::Face, Options,
    };
    let root = std::env::temp_dir().join(format!("e2-native-touch-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    let make = |reduced| {
        let options = Options {
            folder: root.clone(),
            presence_folder: None,
            assets: std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../assets"),
            size: Size::Medium,
            reduce_motion: reduced,
            follow_class: None,
            trace: false,
            login: false,
        };
        let mut e = Engine::new(options, 1000, 42).unwrap();
        let mut r = Record::resting();
        r.at = 1000.;
        r.session = "touch".into();
        e.preview_record(r, 1000);
        e
    };
    let mut reduced = make(true);
    reduced.touch(TouchEvent::Press, 1000);
    assert_eq!(reduced.visual(1000).1, Face::Closed);
    reduced.touch(TouchEvent::Click { alternate: false }, 1100);
    assert_eq!(reduced.visual(1259).1, Face::Closed);
    assert_eq!(reduced.visual(1260).1, Face::Smile);
    assert_eq!(reduced.visual(2400).1, Face::Open);
    let mut normal = make(false);
    // the third quick click is the burst (an Option-click is a plain click until after 1.0)
    normal.touch(TouchEvent::Click { alternate: false }, 400);
    normal.touch(TouchEvent::Click { alternate: false }, 700);
    normal.touch(TouchEvent::Press, 1000);
    normal.touch(TouchEvent::Click { alternate: false }, 1100);
    assert_eq!(normal.visual(1154).0, "idle-reading");
    assert_eq!(normal.visual(1155).0, "flustered");
    assert_eq!(normal.visual(1480).0, "shiori-a");
    assert_eq!(normal.visual(2850).1, Face::Squeeze);
    assert_eq!(normal.visual(2850).0, "idle-reading");
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn painted_neighbours_obey_opt_in_three_newest_and_event_bounded_schedule() {
    use coco_companion::{
        decor::{DecorAssets, NeighbourLight},
        render::Canvas,
    };
    let lights = (0..4)
        .map(|i| NeighbourLight {
            id: format!("n{i}"),
            label: format!("Agent{i}"),
            busy: true,
            partial: false,
            at: 1000 + i * 10,
            ended_at: None,
        })
        .collect::<Vec<_>>();
    let assets =
        DecorAssets::load(&std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("assets"))
            .unwrap();
    let blank = || {
        let mut c = Canvas::blank(320, 320);
        c.sprite_bounds = (109, 160, 113, 96);
        c
    };
    let mut off = blank();
    assets.neighbours(
        &mut off,
        &lights,
        1300,
        Size::Medium,
        1.,
        false,
        false,
        false,
        false,
    );
    assert!(off.pixels.iter().all(|v| *v == 0));
    let mut on = blank();
    assets.neighbours(
        &mut on,
        &lights,
        1300,
        Size::Medium,
        1.,
        false,
        false,
        false,
        true,
    );
    assert!(on.pixels.iter().any(|v| *v != 0));
    assert!(!on.hit_test(238, 204));
    let partial = NeighbourLight {
        partial: true,
        ..lights[0].clone()
    };
    assert_eq!(partial.next_deadline(1001), None);
    assert_eq!(lights[0].next_deadline(1240), None);
    assert!(lights[0].next_deadline(1000).is_some());
    let ended = NeighbourLight {
        ended_at: Some(2000),
        ..lights[0].clone()
    };
    assert_eq!(ended.sample(2400, false).2, 0.);
    assert_eq!(ended.next_deadline(2700), None);
    let mut left = blank();
    assets.neighbours(
        &mut left,
        &lights,
        1300,
        Size::Medium,
        1.,
        false,
        false,
        true,
        true,
    );
    assert!(left
        .pixels
        .chunks_exact(4)
        .enumerate()
        .filter(|(_, p)| p[3] > 0)
        .all(|(i, _)| i % 320 < 109));
}

#[test]
fn only_the_done_line_is_said_once_and_lantern_idle_has_no_deadline() {
    use coco_companion::{decor::NeighbourLight, engine::Engine, feed::Record, Options};
    let options = Options {
        folder: std::env::temp_dir().join("e2-neighbour-no-feed"),
        presence_folder: None,
        assets: std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../assets"),
        size: Size::Medium,
        reduce_motion: true,
        follow_class: None,
        trace: false,
        login: false,
    };
    let mut e = Engine::new(options, 1000, 42).unwrap();
    let mut r = Record::resting();
    r.session = "lantern".into();
    r.at = 1000.;
    r.neighbours_enabled = true;
    r.neighbours = vec![NeighbourLight {
        id: "codex".into(),
        label: "Codex".into(),
        busy: true,
        partial: false,
        at: 1000,
        ended_at: None,
    }];
    e.preview_record(r.clone(), 1000);
    assert_eq!(
        e.current_line(1000),
        None,
        "a busy neighbour is shown by its lantern alone"
    );
    e.render(15200, 1.);
    assert_eq!(e.current_line(15200), None);
    assert_eq!(e.next_deadline_ms(61000), None);
    r.at = 32000.;
    r.neighbours[0].busy = false;
    r.neighbours[0].ended_at = Some(32000);
    e.preview_record(r.clone(), 32000);
    assert_eq!(
        e.current_line(32000).as_deref(),
        Some("Codex next door is done.")
    );
    e.render(46000, 1.);
    assert_eq!(e.current_line(46000), None);
    r.at = 47000.;
    e.preview_record(r, 47000);
    assert_eq!(e.current_line(47000), None);
}

#[test]
fn the_task_pill_ends_with_where_the_task_list_is_while_it_runs() {
    use coco_companion::{engine::Engine, feed::Record, Options};
    let options = Options {
        folder: std::env::temp_dir().join("e2-task-place-no-feed"),
        presence_folder: None,
        assets: std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../assets"),
        size: Size::Medium,
        reduce_motion: true,
        follow_class: None,
        trace: false,
        login: false,
    };
    let mut e = Engine::new(options, 1000, 42).unwrap();
    let mut r = Record::resting();
    r.session = "place".into();
    r.at = 1000.;
    r.rest = false;
    r.task = Some("editing parser.ts".into());
    e.preview_record(r.clone(), 1000);
    let plain = e.current_line(1000).expect("the task line");
    assert!(!plain.contains("3/7"));
    r.place = Some("task 3/7".into());
    e.preview_record(r.clone(), 1000);
    assert_eq!(e.current_line(1000), Some(format!("{plain}, task 3/7")));
    r.lang = "zh".into();
    r.place = Some("任务3/7".into());
    e.preview_record(r, 1000);
    assert!(e.current_line(1000).unwrap().ends_with("editing parser.ts,任务3/7"));
}
