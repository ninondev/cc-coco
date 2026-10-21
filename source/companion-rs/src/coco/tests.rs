use super::*;

fn track(keys: &[&[f64]]) -> Track {
    Track::try_from(keys.iter().map(|k| k.to_vec()).collect::<Vec<_>>()).unwrap()
}
fn element(src: &str) -> Element {
    Element {
        src: src.into(),
        origin: [0., 0.],
        clip_local: None,
        clip_final: None,
        a: Track::still(&[1.]),
        t: Track::still(&[0., 0.]),
        r: Track::still(&[0.]),
        s: Track::still(&[1., 1.]),
    }
}
fn part(seconds: f64, elements: Vec<Element>) -> Arc<Part> {
    Arc::new(Part { seconds, elements })
}
const LOOPLESS: [&str; 6] = ["hello", "shell", "done", "helper", "pass", "firsttry"];
/// Every action is a one second body and, for most, a two second loop; each element is named for its part.
fn band(name: &str) -> Band {
    let mut actions = HashMap::new();
    for key in ACTIONS {
        let src = format!("{name}-{key}");
        let kind = match key {
            "hello" => EntryKind::Cut,
            "pack" => EntryKind::Hop,
            _ => EntryKind::Sink,
        };
        actions.insert(
            key.to_string(),
            Action {
                entry: Entry {
                    kind,
                    depth: 0.1,
                    h: 4.,
                },
                body: part(1., vec![element(&format!("{src}-body"))]),
                looped: (!LOOPLESS.contains(&key))
                    .then(|| part(2., vec![element(&format!("{src}-loop"))])),
            },
        );
    }
    Band {
        canvas: [234., 241.],
        sink: 0.12,
        hop: [0.1, 0.16],
        actions,
    }
}
fn player() -> Player {
    Player::with(band("A"), band("B"), Bank::default())
}
fn want(outfit: Outfit, action: Key, base: Key) -> Wanted {
    Wanted {
        outfit,
        action,
        base,
        act: None,
    }
}
/// (seconds, looping, first element's name) of each segment.
fn shape(play: &Play) -> Vec<(f64, bool, String)> {
    play.segments
        .iter()
        .map(|s| (s.part.seconds, s.looping, s.part.elements[0].src.clone()))
        .collect()
}
fn names(play: &Play) -> Vec<String> {
    shape(play).into_iter().map(|s| s.2).collect()
}

// ------------------------------------------------------------ sampling

#[test]
fn tracks_are_linear_between_keys_and_held_outside_them() {
    let ramp = track(&[&[1., 10., 0.], &[3., 20., 4.]]);
    assert_eq!(ramp.sample(0.), [10., 0.]);
    assert_eq!(ramp.sample(1.), [10., 0.]);
    assert_eq!(ramp.sample(2.), [15., 2.]);
    assert_eq!(ramp.sample(3.), [20., 4.]);
    assert_eq!(ramp.sample(9.), [20., 4.]);
    let one = track(&[&[0.5, 7.]]);
    assert_eq!(one.sample(-3.), [7., 0.]);
    assert_eq!(one.sample(100.), [7., 0.]);
    let steps = track(&[&[0., 0.], &[1., 1.], &[1., 5.], &[2., 6.]]);
    assert_eq!(steps.sample(1.), [1., 0.]);
    assert!((steps.sample(1.5)[0] - 5.5).abs() < 1e-12);
}
#[test]
fn track_data_needs_a_time_values_and_order() {
    let rows = |r: &[&[f64]]| r.iter().map(|k| k.to_vec()).collect::<Vec<_>>();
    assert!(Track::try_from(Vec::<Vec<f64>>::new()).is_err());
    assert!(Track::try_from(rows(&[&[0.]])).is_err());
    assert!(Track::try_from(rows(&[&[0., 1.], &[1., 2., 3.]])).is_err());
    assert!(Track::try_from(rows(&[&[1., 1.], &[0., 2.]])).is_err());
    assert_eq!(Track::try_from(rows(&[&[0., 1., 2.]])).unwrap().width, 2);
}
#[test]
fn the_segment_at_a_time_and_how_far_into_it() {
    let list = vec![
        Segment::once(Part {
            seconds: 0.5,
            elements: vec![],
        }),
        Segment::once(Part {
            seconds: 1.,
            elements: vec![],
        }),
        Segment {
            part: part(2., vec![]),
            looping: true,
        },
    ];
    assert_eq!(locate(&list, 0.25), Some((0, 0.25)));
    assert_eq!(locate(&list, 0.5), Some((1, 0.)));
    assert_eq!(locate(&list, -1.), Some((0, 0.)));
    let (i, u) = locate(&list, 1.2).unwrap();
    assert_eq!(i, 1);
    assert!((u - 0.7).abs() < 1e-12);
    assert_eq!(locate(&list, 1.5), Some((2, 0.)));
    let (i, u) = locate(&list, 1.9).unwrap();
    assert_eq!(i, 2);
    assert!((u - 0.4).abs() < 1e-12);
    let (i, u) = locate(&list, 3.5).unwrap();
    assert_eq!(i, 2);
    assert!((u - 0.).abs() < 1e-12, "3.5 s is one whole loop in");
    let (_, wrapped) = locate(&list, 3.5 + 2. + 0.75).unwrap();
    assert!((wrapped - 0.75).abs() < 1e-12);
    assert_eq!(locate(&[], 1.), None);
}
#[test]
fn a_drawing_is_frozen_at_its_values_and_faded_elements_are_dropped() {
    let mut fading = element("fading");
    fading.a = track(&[&[0., 0.], &[1., 1.]]);
    fading.s = track(&[&[0., 1., 1.], &[1., 2., 3.]]);
    let list = vec![Segment {
        part: part(1., vec![fading, element("steady")]),
        looping: false,
    }];
    assert_eq!(drawn_at(&list, 0.005).len(), 1);
    let frozen = drawn_at(&list, 0.5);
    assert_eq!(frozen.len(), 2);
    assert_eq!(frozen[0].a.keys.len(), 1);
    assert!((frozen[0].a.first()[0] - 0.5).abs() < 1e-12);
    assert_eq!(frozen[0].s.first(), [1.5, 2.]);
    assert_eq!(frozen[1].src, "steady");
}

// ------------------------------------------------------------ joins and segments

#[test]
fn a_swap_dips_the_drawing_she_leaves() {
    let data = band("A");
    let mut standing = element("x");
    standing.t = Track::still(&[3., 4.]);
    let sink = Entry {
        kind: EntryKind::Sink,
        depth: 0.1,
        h: 4.,
    };
    let part = join(std::slice::from_ref(&standing), &sink, &data);
    assert_eq!(part.seconds, 0.12);
    let e = &part.elements[0];
    assert_eq!(e.s.keys.len(), 9);
    let last = e.s.keys[8];
    assert!((last[0] - 0.12).abs() < 1e-12);
    assert!((last[2] - 0.9).abs() < 1e-12 && (last[1] - 1.05).abs() < 1e-12);
    assert_eq!(e.s.keys[0], [0., 1., 1.]);
    assert_eq!(e.t.keys[8], [0.12, 3., 4.]);
    // a drawing clipped below (their feet) keeps its shape; one clipped above keeps its width
    standing.clip_local = Some([-1e4, 0., 1e4, 1e4]);
    let part = join(std::slice::from_ref(&standing), &sink, &data);
    assert_eq!(part.elements[0].s.keys[8], [0.12, 1., 1.]);
    standing.clip_local = Some([-1e4, -1e4, 1e4, 100.]);
    let part = join(std::slice::from_ref(&standing), &sink, &data);
    let last = part.elements[0].s.keys[8];
    assert!((last[1] - 1.).abs() < 1e-12 && (last[2] - 0.9).abs() < 1e-12);
}
#[test]
fn a_hop_crouches_then_rises() {
    let data = band("A");
    let hop = Entry {
        kind: EntryKind::Hop,
        depth: 0.045,
        h: 10.,
    };
    let part = join(&[element("x")], &hop, &data);
    assert!((part.seconds - 0.26).abs() < 1e-12);
    let e = &part.elements[0];
    assert!((e.t.keys[8][2] + 10.).abs() < 1e-12);
    let (px, py) = (e.s.keys[8][1], e.s.keys[8][2]);
    assert!((py - 1.04).abs() < 1e-12 && (px - 0.98).abs() < 1e-12);
    // by the end of the crouch (0.1 s) the drawing is lower and has not risen
    let crouched = e.s.keys.iter().zip(&e.t.keys).find(|(s, _)| s[0] > 0.09);
    let (s, t) = crouched.unwrap();
    assert!(s[2] < 1.0 && t[2] > -2.);
}
#[test]
fn an_action_is_a_join_then_its_body_then_its_loop() {
    let p = player();
    let idle = p.next(None, &want(Outfit::A, "idle", "idle"), 0, true);
    assert_eq!(
        shape(&idle),
        [
            (1., false, "A-idle-body".into()),
            (2., true, "A-idle-loop".into())
        ]
    );
    let think = p.next(Some(idle), &want(Outfit::A, "think", "think"), 1500, true);
    assert_eq!(think.at, 1500);
    assert_eq!(
        shape(&think),
        [
            (0.12, false, "A-idle-loop".into()),
            (1., false, "A-think-body".into()),
            (2., true, "A-think-loop".into()),
        ]
    );
    assert_eq!(think.finite_seconds(), 1.12);
    let pack = p.next(Some(think), &want(Outfit::A, "pack", "think"), 4000, true);
    assert!((pack.segments[0].part.seconds - 0.26).abs() < 1e-12);
}
#[test]
fn a_cut_has_no_join() {
    let p = player();
    let idle = p.next(None, &want(Outfit::A, "idle", "idle"), 0, true);
    let hello = p.next(Some(idle), &want(Outfit::A, "hello", "idle"), 500, true);
    assert_eq!(hello.segments[0].part.elements[0].src, "A-hello-body");
}
#[test]
fn a_body_without_a_loop_goes_on_into_its_base() {
    let p = player();
    let idle = p.next(None, &want(Outfit::A, "idle", "idle"), 0, true);
    let done = p.next(Some(idle), &want(Outfit::A, "done", "think"), 100, true);
    assert_eq!(
        shape(&done),
        [
            (0.12, false, "A-idle-body".into()),
            (1., false, "A-done-body".into()),
            (0.12, false, "A-done-body".into()),
            (2., true, "A-think-loop".into()),
        ]
    );
    // the base can change while it plays: the ending follows
    let busier = p.next(
        Some(done.clone()),
        &want(Outfit::A, "done", "work"),
        600,
        true,
    );
    assert_eq!(busier.at, 100);
    assert_eq!(
        busier.segments.last().unwrap().part.elements[0].src,
        "A-work-loop"
    );
    let same = p.next(
        Some(done.clone()),
        &want(Outfit::A, "done", "think"),
        600,
        true,
    );
    assert_eq!(shape(&same), shape(&done));
}
#[test]
fn a_moment_is_played_once_into_the_base_even_with_a_loop_of_its_own() {
    let p = player();
    let idle = p.next(None, &want(Outfit::A, "idle", "idle"), 0, true);
    let moment = Wanted {
        act: Some(1900),
        ..want(Outfit::A, "fixed", "idle")
    };
    let fixed = p.next(Some(idle), &moment, 2000, true);
    assert!(fixed.once);
    assert_eq!(fixed.at, 1900);
    assert_eq!(
        names(&fixed),
        ["A-idle-loop", "A-fixed-body", "A-fixed-body", "A-idle-loop"]
    );
    // the same moment again keeps its play; a state of the same action does not
    let again = p.next(Some(fixed.clone()), &moment, 2500, true);
    assert_eq!((again.at, again.once), (1900, true));
    let state = p.next(Some(fixed), &want(Outfit::A, "fixed", "idle"), 2600, true);
    assert!(!state.once && state.at == 2600);
}
#[test]
fn the_shell_change_ends_in_the_other_outfits_base() {
    let p = player();
    let idle = p.next(None, &want(Outfit::A, "idle", "idle"), 0, true);
    let shell = p.next(Some(idle), &want(Outfit::A, "shell", "work"), 500, true);
    assert_eq!(
        names(&shell),
        ["A-idle-body", "A-shell-body", "A-shell-body", "B-work-loop"]
    );
    // once it has played, wanting that base in the outfit they changed into keeps the play...
    let after = p.next(
        Some(shell.clone()),
        &want(Outfit::B, "work", "work"),
        5000,
        true,
    );
    assert_eq!(
        (after.action, after.at, after.outfit),
        ("shell", 500, Outfit::A)
    );
    // ...and wanting it in the one they left starts a new one
    let wrong = p.next(Some(shell), &want(Outfit::A, "work", "work"), 5000, true);
    assert_eq!((wrong.action, wrong.at), ("work", 5000));
}
#[test]
fn a_body_played_through_keeps_its_picture_when_its_base_comes_back() {
    let p = player();
    let idle = p.next(None, &want(Outfit::A, "idle", "idle"), 0, true);
    let done = p.next(Some(idle), &want(Outfit::A, "done", "idle"), 100, true);
    let back = p.next(Some(done), &want(Outfit::A, "idle", "idle"), 700, true);
    assert_eq!((back.action, back.at), ("done", 100));
    // an action with a loop is not held: it hands over to the new state with a join
    let think = p.next(Some(back), &want(Outfit::A, "think", "think"), 900, true);
    let calm = p.next(Some(think), &want(Outfit::A, "idle", "idle"), 1000, true);
    assert_eq!((calm.action, calm.at), ("idle", 1000));
}
#[test]
fn the_drawing_she_leaves_is_what_was_on_screen() {
    let p = player();
    let mut idle = p.next(None, &want(Outfit::A, "idle", "idle"), 0, true);
    // grow the loop so the breath can be told apart
    let mut growing = element("A-idle-loop");
    growing.s = track(&[&[0., 1., 1.], &[2., 1., 2.]]);
    idle.segments[1].part = part(2., vec![growing]);
    let moving = p.next(
        Some(idle.clone()),
        &want(Outfit::A, "think", "think"),
        2000,
        true,
    );
    assert!((moving.from[0].s.first()[1] - 1.5).abs() < 1e-9);
    // the loop was standing at its start, so that is what they leave
    let held = p.next(Some(idle), &want(Outfit::A, "think", "think"), 2000, false);
    assert_eq!(held.from[0].s.first()[1], 1.);
}
#[test]
fn a_new_action_leaves_the_picture_that_was_on_screen() {
    let growing = || {
        let mut e = element("A-idle-loop");
        e.s = track(&[&[0., 1., 1.], &[2., 1., 2.]]);
        part(2., vec![e])
    };
    // they stood in their settled pose while the last picture was drawn: that pose is what they leave
    let mut p = player();
    assert_eq!(p.current(), None);
    p.update(&want(Outfit::A, "idle", "idle"), 0, false);
    assert_eq!(p.current(), Some((Outfit::A, "idle", "idle")));
    p.play.as_mut().unwrap().segments[1].part = growing();
    p.update(&want(Outfit::A, "think", "think"), 1500, true);
    assert_eq!(p.play.as_ref().unwrap().from[0].s.first()[1], 1.);
    // they were moving: it is the pose at that moment of the loop
    let mut p = player();
    p.update(&want(Outfit::A, "idle", "idle"), 0, true);
    p.play.as_mut().unwrap().segments[1].part = growing();
    p.update(&want(Outfit::A, "think", "think"), 1500, true);
    assert!((p.play.as_ref().unwrap().from[0].s.first()[1] - 1.25).abs() < 1e-9);
    assert_eq!(p.body_seconds(Outfit::B, "shell"), 1.);
}
#[test]
fn she_stands_in_her_settled_pose_when_nothing_moves() {
    let mut p = real();
    p.update(&want(Outfit::A, "think", "think"), 1000, false);
    let at_once = p.render(1000, 96, false, false).unwrap();
    let much_later = p.render(90_000, 96, false, false).unwrap();
    assert_eq!(at_once.pixels, much_later.pixels);
    // it is the pose the action settles into, which the moving picture reaches when its loop begins
    p.update(&want(Outfit::A, "think", "think"), 1000, true);
    let loop_start = p.render(1000 + 1400, 96, false, true).unwrap();
    assert_eq!(at_once.pixels, loop_start.pixels);
}

// ------------------------------------------------------------ the choice

fn still(mood: &str) -> Input<'_> {
    Input {
        mood,
        ..Input::default()
    }
}
fn working(mood: &str) -> Input<'_> {
    Input {
        mood,
        working: true,
        ..Input::default()
    }
}
#[test]
fn the_action_for_a_state_is_the_bands() {
    let table: Vec<(Input, Key, Key)> = vec![
        (still("idle"), "idle", "idle"),
        (working("think"), "think", "think"),
        (working("work"), "work", "work"),
        (still("happy"), "done", "idle"),
        (still("waiting"), "wait", "wait"),
        (working("question"), "wait", "wait"),
        (still("error"), "error", "idle"),
        (still("wild"), "wild", "idle"),
        (still("refuse"), "teapot", "idle"),
        (still("flustered"), "praised", "idle"),
        (still("wave"), "hello", "idle"),
        (still("snake"), "peek", "idle"),
        (still("peek"), "peek", "idle"),
        (still("omen"), "run", "idle"),
        (still("clingy"), "idle", "idle"),
        (working("calm"), "think", "think"),
        (still("sleep"), "nap", "nap"),
        (
            Input {
                night: true,
                ..still("sleep")
            },
            "night",
            "night",
        ),
        (
            Input {
                pose: Some("search"),
                ..still("idle")
            },
            "search",
            "idle",
        ),
        (
            Input {
                pose: Some("scroll"),
                ..working("work")
            },
            "read",
            "work",
        ),
        (
            Input {
                pose: Some("spyglass"),
                ..still("idle")
            },
            "lookup",
            "idle",
        ),
        (
            Input {
                pose: Some("tea"),
                ..still("idle")
            },
            "coffee",
            "idle",
        ),
        (
            Input {
                pose: Some("cheer"),
                ..still("idle")
            },
            "fixed",
            "idle",
        ),
        (
            Input {
                pose: Some("look-up"),
                ..still("idle")
            },
            "watch",
            "idle",
        ),
        (
            Input {
                pose: Some("glance"),
                ..still("idle")
            },
            "idle",
            "idle",
        ),
        (
            Input {
                pose: Some("plan"),
                ..still("sleep")
            },
            "plan",
            "nap",
        ),
        (
            Input {
                touch: Some(Touch::Pat),
                ..still("idle")
            },
            "petted",
            "idle",
        ),
        (
            Input {
                touch: Some(Touch::Burst),
                ..still("idle")
            },
            "hood",
            "idle",
        ),
        (
            Input {
                touch: Some(Touch::Poke),
                ..still("sleep")
            },
            "petted",
            "nap",
        ),
        (
            Input {
                shed: Some(CompactPhase::Begin),
                ..working("think")
            },
            "pack",
            "think",
        ),
        (
            Input {
                shed: Some(CompactPhase::End),
                ..working("think")
            },
            "shell",
            "think",
        ),
        (
            Input {
                shed: Some(CompactPhase::Skip),
                ..working("think")
            },
            "think",
            "think",
        ),
        (
            Input {
                act: Some("fixed"),
                ..still("idle")
            },
            "fixed",
            "idle",
        ),
        (
            Input {
                touch: Some(Touch::Wink),
                act: Some("out"),
                ..still("idle")
            },
            "petted",
            "idle",
        ),
    ];
    for (input, action_key, base_key) in table {
        assert_eq!(action(&input), action_key, "{input:?}");
        assert_eq!(base(&input), base_key, "{input:?}");
        assert!(ACTIONS.contains(&action_key));
    }
}
#[test]
fn the_shell_change_plays_in_the_outfit_she_is_leaving() {
    let end = Input {
        shed: Some(CompactPhase::End),
        ..working("think")
    };
    let w = wanted(&end, Outfit::B, None);
    assert_eq!((w.outfit, w.action, w.base), (Outfit::A, "shell", "think"));
    assert_eq!(wanted(&still("idle"), Outfit::B, None).outfit, Outfit::B);
    let moment = Input {
        act: Some("out"),
        ..still("idle")
    };
    assert_eq!(wanted(&moment, Outfit::A, Some(9)).act, Some(9));
    assert_eq!(wanted(&still("idle"), Outfit::A, Some(9)).act, None);
}
#[test]
fn night_is_late_evening_and_the_small_hours_while_she_is_not_working() {
    for (hour, night) in [
        (23, true),
        (0, true),
        (4, true),
        (5, false),
        (12, false),
        (22, false),
    ] {
        assert_eq!(is_night(Some(hour), "idle", false), night, "{hour}");
    }
    assert!(is_night(Some(2), "sleep", false));
    assert!(!is_night(Some(2), "idle", true));
    assert!(!is_night(Some(2), "think", false));
    assert!(!is_night(None, "sleep", false));
    assert!(local_hour(1_700_000_000_000).is_some_and(|h| h < 24));
}
#[test]
fn pictures_come_out_of_base64() {
    assert_eq!(base64("TWFu").unwrap(), b"Man");
    assert_eq!(base64("TWE=").unwrap(), b"Ma");
    assert_eq!(base64("TQ==").unwrap(), b"M");
    assert_eq!(base64("TW\nFu").unwrap(), b"Man");
    assert_eq!(base64("+/+/").unwrap(), [0xfb, 0xff, 0xbf]);
    assert!(base64("TW!u").is_none());
    assert_eq!(base64("").unwrap(), b"");
}

// ------------------------------------------------------------ blinks

#[test]
fn blinks_are_one_cycle_and_the_same_every_time() {
    let times = blink_times();
    assert_eq!(times, blink_times());
    // the band's own schedule (cocoBlinkTimes in coco-motion.ts)
    let band = [
        2.2,
        2.4643808413203807,
        6.940619799107659,
        16.05662269634216,
        25.8150041098955,
        27.8150041098955,
        34.68062287002039,
        38.60412081234246,
        40.60412081234246,
        47.57982297011707,
        50.25860781211365,
        56.338667384865644,
    ];
    assert_eq!(times.len(), band.len());
    for (a, b) in times.iter().zip(band) {
        assert!((a - b).abs() < 1e-9, "{a} against {b}");
    }
    assert!(times.windows(2).all(|w| w[1] - w[0] > 0.2));
    assert!(times.iter().all(|t| *t < BLINK_CYCLE - 1.));
}
#[test]
fn a_blink_is_half_shut_then_shut_then_half_open() {
    let blinks = [2.2, 10.];
    for (t, lids) in [
        (2.0, Lids::Open),
        (2.2, Lids::Half),
        (2.232, Lids::Half),
        (2.234, Lids::Closed),
        (2.36, Lids::Closed),
        (2.365, Lids::Half),
        (2.41, Lids::Half),
        (2.42, Lids::Open),
        (5., Lids::Open),
        (10.1, Lids::Closed),
        (BLINK_CYCLE + 2.25, Lids::Closed),
        (3. * BLINK_CYCLE + 10.1, Lids::Closed),
    ] {
        assert_eq!(lids_at(&blinks, t), lids, "{t}");
    }
}

// ------------------------------------------------------------ composition

fn png_of(width: u32, height: u32, rgba: impl Fn(u32, u32) -> [u8; 4]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut encoder = png::Encoder::new(&mut out, width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header().unwrap();
    let mut pixels = Vec::new();
    for y in 0..height {
        for x in 0..width {
            pixels.extend_from_slice(&rgba(x, y));
        }
    }
    writer.write_image_data(&pixels).unwrap();
    writer.finish().unwrap();
    out
}
fn plate() -> Band {
    Band {
        canvas: [10., 10.],
        sink: 0.12,
        hop: [0.1, 0.16],
        actions: HashMap::new(),
    }
}
fn bank() -> Bank {
    let mut bank = Bank::default();
    let red = png_of(10, 10, |_, _| [255, 0, 0, 255]);
    let left = png_of(10, 10, |x, _| if x < 5 { [255, 0, 0, 255] } else { [0; 4] });
    bank.slots.insert("red".into(), Slot::new(red));
    bank.slots.insert("left".into(), Slot::new(left));
    bank.slots.insert(
        "red#half".into(),
        Slot::new(png_of(4, 4, |_, _| [0, 255, 0, 255])),
    );
    bank.slots.insert(
        "red#closed".into(),
        Slot::new(png_of(4, 4, |_, _| [0, 0, 255, 255])),
    );
    bank.eyes.insert("red".into(), [2., 2., 4., 4.]);
    bank
}
fn paint(e: &Element, t: [f64; 2], a: f64, r: f64, s: [f64; 2], lids: Lids) -> Pixmap {
    let pose = Pose { e, a, t, r, s };
    Player::paint(&mut bank(), &plate(), &[pose], 10, lids).unwrap()
}
fn at(p: &Pixmap, x: u32, y: u32) -> [u8; 4] {
    let c = p.pixels()[(y * p.width() + x) as usize];
    [c.red(), c.green(), c.blue(), c.alpha()]
}
fn row(p: &Pixmap, y: u32) -> Vec<bool> {
    (0..p.width()).map(|x| at(p, x, y)[3] == 255).collect()
}

#[test]
fn a_picture_is_drawn_over_the_whole_canvas() {
    let p = paint(&element("red"), [0., 0.], 1., 0., [1., 1.], Lids::Open);
    assert_eq!((p.width(), p.height()), (10, 10));
    assert_eq!(at(&p, 0, 0), [255, 0, 0, 255]);
    assert_eq!(at(&p, 9, 9), [255, 0, 0, 255]);
    let p = paint(&element("red"), [3., 2.], 1., 0., [1., 1.], Lids::Open);
    assert_eq!(at(&p, 2, 5)[3], 0);
    assert_eq!(at(&p, 3, 2), [255, 0, 0, 255]);
    assert_eq!(at(&p, 3, 1)[3], 0);
}
#[test]
fn the_local_clip_moves_with_the_element_and_the_final_clip_does_not() {
    let mut local = element("red");
    local.clip_local = Some([0., -1e4, 5., 1e4]);
    let p = paint(&local, [2., 0.], 1., 0., [1., 1.], Lids::Open);
    assert_eq!(
        row(&p, 5),
        [false, false, true, true, true, true, true, false, false, false]
    );
    let mut fixed = element("red");
    fixed.clip_final = Some([0., -1e4, 5., 1e4]);
    let p = paint(&fixed, [2., 0.], 1., 0., [1., 1.], Lids::Open);
    assert_eq!(
        row(&p, 5),
        [false, false, true, true, true, false, false, false, false, false]
    );
    let mut both = element("red");
    both.clip_final = Some([0., -1e4, 5., 1e4]);
    both.clip_local = Some([0., -1e4, 4., 1e4]);
    let p = paint(&both, [2., 0.], 1., 0., [1., 1.], Lids::Open);
    assert_eq!(
        row(&p, 5),
        [false, false, true, true, true, false, false, false, false, false]
    );
}
#[test]
fn scale_and_rotation_turn_about_the_elements_origin() {
    let mut corner = element("red");
    corner.origin = [10., 10.];
    let p = paint(&corner, [0., 0.], 1., 0., [0.5, 0.5], Lids::Open);
    assert_eq!(at(&p, 7, 7), [255, 0, 0, 255]);
    assert_eq!(at(&p, 2, 2)[3], 0);
    // a turn of 90 degrees is clockwise: the left half of the picture goes to the top
    let mut half = element("left");
    half.origin = [5., 5.];
    let p = paint(&half, [0., 0.], 1., 90., [1., 1.], Lids::Open);
    assert_eq!(at(&p, 5, 2)[3], 255);
    assert_eq!(at(&p, 5, 7)[3], 0);
    // about the corner of the canvas it leaves the canvas
    let p = paint(&element("red"), [0., 0.], 1., 90., [1., 1.], Lids::Open);
    assert_eq!(at(&p, 5, 5)[3], 0);
}
#[test]
fn opacity_applies_to_the_element() {
    let p = paint(&element("red"), [0., 0.], 0.5, 0., [1., 1.], Lids::Open);
    assert!(at(&p, 5, 5)[3].abs_diff(128) <= 2);
    assert!(at(&p, 5, 5)[0].abs_diff(128) <= 2);
}
#[test]
fn her_lids_cover_the_eyes_only_while_shut_and_only_where_the_frame_holds_them() {
    let open = paint(&element("red"), [0., 0.], 1., 0., [1., 1.], Lids::Open);
    let half = paint(&element("red"), [0., 0.], 1., 0., [1., 1.], Lids::Half);
    let shut = paint(&element("red"), [0., 0.], 1., 0., [1., 1.], Lids::Closed);
    assert_eq!(at(&open, 3, 3), [255, 0, 0, 255]);
    assert_eq!(at(&half, 3, 3), [0, 255, 0, 255]);
    assert_eq!(at(&shut, 3, 3), [0, 0, 255, 255]);
    assert_eq!(at(&shut, 8, 8), [255, 0, 0, 255]);
    let mut cut = element("red");
    cut.clip_local = Some([-1e4, -1e4, 1e4, 4.]);
    let p = paint(&cut, [0., 0.], 1., 0., [1., 1.], Lids::Closed);
    assert_eq!(at(&p, 3, 3), [255, 0, 0, 255]);
    // opacity is the group's: the lids are not seen through the face under them
    let faint = paint(&element("red"), [0., 0.], 0.5, 0., [1., 1.], Lids::Half);
    let [r, g, _, a] = at(&faint, 3, 3);
    assert!(
        a.abs_diff(128) <= 2 && g.abs_diff(128) <= 2 && r <= 2,
        "{r} {g} {a}"
    );
}
#[test]
fn a_picture_is_trimmed_to_its_ink_with_a_margin() {
    let mut pixels = vec![0u8; 20 * 20 * 4];
    for y in 7..10 {
        for x in 6..9 {
            pixels[(y * 20 + x) * 4..(y * 20 + x) * 4 + 4].copy_from_slice(&[9, 0, 0, 255]);
        }
    }
    let image = Image {
        width: 20,
        height: 20,
        pixels,
    };
    let t = Trimmed::of(&image).unwrap();
    assert_eq!((t.x, t.y), (4, 5));
    assert_eq!((t.pixmap.width(), t.pixmap.height()), (7, 7));
    assert_eq!((t.width, t.height), (20, 20));
    // ink at a corner: the margin stops at the picture's edge
    let mut corner = vec![0u8; 20 * 20 * 4];
    corner[3] = 255;
    let t = Trimmed::of(&Image {
        width: 20,
        height: 20,
        pixels: corner,
    })
    .unwrap();
    assert_eq!(
        (t.x, t.y, t.pixmap.width(), t.pixmap.height()),
        (0, 0, 3, 3)
    );
    // no ink: one clear pixel
    let t = Trimmed::of(&Image {
        width: 20,
        height: 20,
        pixels: vec![0; 20 * 20 * 4],
    })
    .unwrap();
    assert_eq!((t.pixmap.width(), t.pixmap.height(), t.width), (1, 1, 20));
}
#[test]
fn a_trimmed_picture_is_drawn_where_the_whole_one_would_be() {
    let mut bank = Bank::default();
    let dot = png_of(10, 10, |x, y| {
        if (6..8).contains(&x) && (3..5).contains(&y) {
            [255, 0, 0, 255]
        } else {
            [0; 4]
        }
    });
    bank.slots.insert("dot".into(), Slot::new(dot));
    let e = element("dot");
    let pose = Pose {
        e: &e,
        a: 1.,
        t: [1., 2.],
        r: 0.,
        s: [1., 1.],
    };
    let p = Player::paint(&mut bank, &plate(), &[pose], 10, Lids::Open).unwrap();
    let red: Vec<(u32, u32)> = (0..10)
        .flat_map(|y| (0..10).map(move |x| (x, y)))
        .filter(|(x, y)| at(&p, *x, *y)[3] == 255)
        .collect();
    assert_eq!(red, [(7, 5), (8, 5), (7, 6), (8, 6)]);
}
#[test]
fn pictures_drawn_smaller_are_made_for_that_size() {
    let mut bank = bank();
    let e = element("red");
    let pose = |e| Pose {
        e,
        a: 1.,
        t: [0., 0.],
        r: 0.,
        s: [1., 1.],
    };
    let small = Player::paint(&mut bank, &plate(), &[pose(&e)], 5, Lids::Open).unwrap();
    assert_eq!((small.width(), small.height()), (5, 5));
    assert_eq!(at(&small, 2, 2), [255, 0, 0, 255]);
    assert_eq!(bank.slots["red"].scaled.as_ref().map(|s| s.0), Some(5));
    // back at the full size they are dropped again
    let full = Player::paint(&mut bank, &plate(), &[pose(&e)], 10, Lids::Open).unwrap();
    assert_eq!(full.width(), 10);
    assert!(bank.slots["red"].scaled.is_none());
}

// ------------------------------------------------------------ their own files

fn real() -> Player {
    let folder = Path::new(env!("CARGO_MANIFEST_DIR")).join("assets/coco");
    Player::load(&folder).expect("assets/coco loads")
}
fn ink(image: &Image) -> u64 {
    image.pixels.chunks_exact(4).map(|p| p[3] as u64).sum()
}
fn well_formed(image: &Image) -> bool {
    image
        .pixels
        .chunks_exact(4)
        .all(|p| p[0] <= p[3] && p[1] <= p[3] && p[2] <= p[3])
}
#[test]
fn her_files_load_with_every_action_for_both_outfits() {
    let p = real();
    assert_eq!(p.canvas(), (234., 241.));
    for outfit in [Outfit::A, Outfit::B] {
        for key in ACTIONS {
            assert!(p.body_seconds(outfit, key) > 0., "{key}");
        }
    }
    assert_eq!(p.body_seconds(Outfit::A, "shell"), 3.);
    assert_eq!(p.dimensions(96), (94, 96));
    assert_eq!(p.dimensions(256), (249, 256));
}
#[test]
fn every_action_draws_at_two_sizes() {
    let mut p = real();
    for outfit in [Outfit::A, Outfit::B] {
        for key in ACTIONS {
            p.update(&want(outfit, key, "idle"), 1000, true);
            for height in [96, 192] {
                // in the join, in the body, in the loop and a long time on
                for ms in [1000, 1050, 1500, 3000, 6000, 9000, 90_000] {
                    let image = p.render(ms, height, false, true).unwrap();
                    let (w, h) = p.dimensions(height);
                    assert_eq!((image.width, image.height), (w, h), "{key} {height}");
                    assert!(ink(&image) > 0, "{outfit:?} {key} {height} at {ms}");
                    assert!(well_formed(&image), "{key} {height} at {ms}");
                }
            }
        }
    }
}
#[test]
fn reduced_motion_draws_one_still() {
    let mut p = real();
    p.update(&want(Outfit::A, "think", "think"), 0, false);
    let a = p.render(0, 96, true, false).unwrap();
    let b = p.render(70_000, 96, true, true).unwrap();
    assert_eq!(a.pixels, b.pixels);
    assert!(ink(&a) > 0);
    p.update(&want(Outfit::A, "done", "idle"), 100, false);
    let done = p.render(100, 96, true, false).unwrap();
    assert_ne!(done.pixels, a.pixels);
}
#[test]
fn a_loop_that_does_not_run_stands_at_its_start() {
    let mut p = real();
    p.update(&want(Outfit::A, "idle", "idle"), 0, true);
    let start = p.render(3600, 96, false, true).unwrap();
    let held = p.render(5300, 96, false, false).unwrap();
    let held_later = p.render(40_000, 96, false, false).unwrap();
    let running = p.render(5300, 96, false, true).unwrap();
    assert_eq!(start.pixels, held.pixels);
    assert_eq!(held.pixels, held_later.pixels);
    assert_ne!(start.pixels, running.pixels);
}
#[test]
fn she_blinks_on_a_frame_she_holds_and_only_while_the_loop_runs() {
    let mut p = real();
    p.update(&want(Outfit::A, "idle", "idle"), 0, true);
    // 7.05 s is inside the blink at 6.94 s; one loop (3.6 s) later is the same pose with open eyes
    let blinking = p.render(7050, 96, false, true).unwrap();
    let open = p.render(10_650, 96, false, true).unwrap();
    assert_ne!(blinking.pixels, open.pixels);
    let held = p.render(7050, 96, false, false).unwrap();
    let held_open = p.render(10_650, 96, false, false).unwrap();
    assert_eq!(held.pixels, held_open.pixels);
}
#[test]
fn her_idle_pose_is_measured_for_the_badge() {
    let mut p = real();
    let geometry = p.idle_geometry(192, 2.).unwrap();
    assert!(geometry.top > 0. && geometry.top < 192.);
    assert!(geometry.hair.1 >= geometry.top && geometry.hair.0 > 0.);
    assert_eq!(p.idle_geometry(192, 2.).unwrap().top, geometry.top);
}

// ------------------------------------------------------------ the sock drawer

#[test]
fn a_pair_from_her_sock_drawer_is_drawn_over_her_pictures_and_taken_off_again() {
    let folder = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("assets/coco");
    let mut player = Player::load(&folder).unwrap();
    player.update(&want(Outfit::A, "idle", "idle"), 0, false);
    let own = player.render(0, 256, true, false).unwrap();
    assert_eq!(player.worn(), None);
    player.wear(Some("goodgirl")).unwrap();
    assert_eq!(player.worn(), Some("goodgirl"));
    let worn = player.render(0, 256, true, false).unwrap();
    assert_eq!((worn.width, worn.height), (own.width, own.height));
    let changed: Vec<usize> = own
        .pixels
        .chunks(4)
        .zip(worn.pixels.chunks(4))
        .enumerate()
        .filter(|(_, (a, b))| a != b)
        .map(|(i, _)| i / own.width)
        .collect();
    assert!(changed.len() > 300, "{} pixels changed", changed.len());
    // only their legs (sitting on the mug's rim in idle: below the middle of the picture), never their face
    let top = *changed.iter().min().unwrap();
    assert!(top * 2 >= own.height, "a change at row {top} of {}", own.height);
    player.wear(None).unwrap();
    assert_eq!(player.render(0, 256, true, false).unwrap().pixels, own.pixels);
    assert!(player.wear(Some("../band")).is_err());
    assert!(player.wear(Some("nosuchpair")).is_err());
    assert_eq!(player.worn(), None);
}

#[test]
fn a_picture_comes_from_its_sidecar_or_from_base64_and_never_from_outside_the_sidecar() {
    let sidecar = b"\x89PNGabcdefgh".to_vec();
    assert_eq!(picture("@0:4", &sidecar).as_deref(), Some(&b"\x89PNG"[..]));
    assert_eq!(picture("@4:8", &sidecar).as_deref(), Some(&b"abcdefgh"[..]));
    assert_eq!(picture("@12:0", &sidecar).as_deref(), Some(&b""[..]));
    for bad in ["@4:9", "@13:0", "@x:1", "@1", "@-1:2", "@18446744073709551615:2"] {
        assert_eq!(picture(bad, &sidecar), None, "{bad}");
    }
    assert_eq!(picture("@0:1", &[]), None, "no sidecar");
    // Data written before the sidecar: base64.
    assert_eq!(picture("iVBORw==", &[]).as_deref(), Some(&b"\x89PNG"[..]));
}
