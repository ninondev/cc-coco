use coco_companion::{
    decor::{Helper, HelperOutcome, NeighbourLight},
    engine::Engine,
    feed::Record,
    render::Size,
    Options,
};
fn engine(size: Size) -> Engine {
    Engine::new(
        Options {
            folder: std::env::temp_dir()
                .join(format!("r3-selection-absent-{}", std::process::id())),
            presence_folder: None,
            assets: std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../assets"),
            size,
            reduce_motion: true,
            follow_class: None,
            trace: false,
            login: false,
        },
        1000,
        42,
    )
    .unwrap()
}
fn record(at: u64) -> Record {
    let mut r = Record::resting();
    r.session = "selection-fixture".into();
    r.at = at as f64;
    r
}
fn helper(id: &str, at: u64) -> Helper {
    Helper {
        id: id.into(),
        at,
        ..Default::default()
    }
}
#[test]
fn expired_helper_does_not_change_the_rendered_arrival_index() {
    for size in Size::ALL {
        let mut e = engine(size);
        let mut r = record(1000);
        let active = helper("new", 1000);
        r.helpers = vec![
            Helper {
                ended_at: Some(500),
                outcome: HelperOutcome::Done,
                ..helper("expired", 100)
            },
            active.clone(),
        ];
        e.preview_record(r, 1000);
        let actual = e.render_companion(1000, 1.);
        let mut reference = engine(size);
        let mut alone = record(1000);
        alone.helpers = vec![active];
        reference.preview_record(alone, 1000);
        assert!(
            actual.pixels == reference.render_companion(1000, 1.).pixels,
            "expired helper is not painted"
        );
        assert_eq!(
            e.next_deadline_ms(1000),
            if size.pixel() { None } else { Some(1016) },
            "scheduler must use the painter's delay0"
        );
    }
}
#[test]
fn hidden_extra_lanterns_do_not_schedule_their_departure_frames() {
    for size in Size::ALL {
        let mut e = engine(size);
        let mut r = record(64000);
        r.neighbours_enabled = true;
        r.neighbours = (1..=3)
            .map(|i| NeighbourLight {
                id: format!("busy{i}"),
                label: format!("Synthetic{i}"),
                busy: true,
                at: i,
                ..Default::default()
            })
            .collect();
        r.neighbours.push(NeighbourLight {
            id: "omitted".into(),
            label: "SyntheticOld".into(),
            busy: false,
            at: 0,
            ended_at: Some(64000),
            ..Default::default()
        });
        e.preview_record(r, 64000);
        assert_eq!(
            e.next_deadline_ms(64000),
            Some(64450),
            "only the existing reaction glance needs a callback"
        );
        e.render_companion(64450, 1.);
        assert_eq!(
            e.next_deadline_ms(64450),
            Some(78000),
            "caption expiry remains, hidden lantern animation does not"
        );
    }
}
#[test]
fn bundled_omitted_helpers_schedule_only_a_visible_membership_change() {
    for (count, expected) in [(5, Some(1260)), (6, None)] {
        let mut e = engine(Size::Medium);
        let mut r = record(1000);
        r.helpers = (0..count)
            .map(|i| helper(&format!("synthetic{i}"), 100))
            .collect();
        r.helpers[4].ended_at = Some(1000);
        r.helpers[4].outcome = HelperOutcome::Done;
        e.preview_record(r, 1000);
        assert_eq!(
            e.next_deadline_ms(1000),
            expected,
            "{count}: omitted scrolls have no animated pixels"
        );
        if let Some(next) = expected {
            e.render_companion(next, 1.);
            assert_eq!(e.next_deadline_ms(next), None);
        }
    }
}
#[test]
fn six_helpers_do_not_wake_for_the_five_helper_intermediate_boundary() {
    let mut e = engine(Size::Medium);
    let mut r = record(1000);
    r.helpers = (0..6)
        .map(|i| helper(&format!("synthetic{i}"), 100))
        .collect();
    r.helpers[4].ended_at = Some(1000);
    r.helpers[4].outcome = HelperOutcome::Done;
    r.helpers[5].ended_at = Some(1100);
    r.helpers[5].outcome = HelperOutcome::Done;
    e.preview_record(r, 1000);
    assert_eq!(e.next_deadline_ms(1000), Some(1360));
    assert_eq!(e.next_deadline_ms(1260), Some(1360));
    e.render_companion(1360, 1.);
    assert_eq!(e.next_deadline_ms(1360), None);
}
