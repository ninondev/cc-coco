//! Part-4 fixtures use only approved words and production UI/frame rendering.
use crate::{
    engine::Engine,
    feed::{ActivityRow, Record, Sessions},
    render::Size,
    ui::{self, Quota, UiState},
    Error, Options,
};
use std::path::Path;
pub fn extra(
    options: &Options,
    out: &Path,
    now: u64,
    manifest: &mut Vec<serde_json::Value>,
) -> Result<(), Error> {
    let feed: serde_json::Value = serde_json::from_str(include_str!("../assets/words/feed.json"))?;
    for dark in [false, true] {
        for scale in [1., 2.] {
            let theme = if dark { "dark" } else { "light" };
            let suffix = if scale == 1. { "1x" } else { "2x" };
            for lang in crate::languages::codes() {
                for scenario in ["pace", "empty"] {
                    let mut u = UiState::default();
                    u.open_activity(&Sessions::default(), now as f64);
                    u.dark = dark;
                    u.chosen.lang = lang.into();
                    u.chosen.session = format!("activity-{lang}");
                    u.chosen.project = "atlas/plugin".into();
                    u.chosen.at = now.saturating_sub(60_000) as f64;
                    u.chosen.name = ui::word(lang, "tray.tip", 0);
                    for (k, v) in feed[lang].as_object().unwrap() {
                        u.chosen.words.insert(k.clone(), v.as_str().unwrap().into());
                        if matches!(k.as_str(), "back" | "opens") {
                            u.chosen
                                .words
                                .insert(format!("{k}Template"), v.as_str().unwrap().into());
                        }
                    }
                    u.chosen.quota = Some(Quota::example());
                    for (i, window) in u
                        .chosen
                        .quota
                        .as_mut()
                        .unwrap()
                        .windows
                        .iter_mut()
                        .enumerate()
                    {
                        window.reset = Some(now as f64 + (i as f64 + 1.) * 86_400_000.);
                    }
                    u.chosen.quota.as_mut().unwrap().windows[0].pace =
                        Some(ui::word(lang, "quota.pace.wide", 0).replace("{t}", "1h 5m"));
                    if scenario == "pace" {
                        u.rows.push(ActivityRow {
                            record: u.chosen.clone(),
                            state: u.chosen.word("finished").into(),
                            unseen: true,
                            excerpt: Some("The comment nodes now survive both runs.".into()),
                        });
                    }
                    #[cfg(feature = "a11y")]
                    if scenario == "pace" && !dark && scale == 1. {
                        let tree = crate::accessibility::tree(&u, &u.chosen);
                        let nodes=tree.nodes.iter().map(|(id,n)|serde_json::json!({"id":id.0,"role":format!("{:?}",n.role()),"name":n.label(),"state":n.state_description(),"value":n.value()})).collect::<Vec<_>>();
                        std::fs::write(
                            out.join(format!("N6-{lang}-tree.json")),
                            serde_json::to_vec_pretty(&nodes)?,
                        )?;
                    }
                    crate::preview::write_e2(
                        out,
                        &format!("N1-N2-N6-N12-{scenario}-{lang}-{theme}@{suffix}"),
                        vec![u.render(scale)],
                        manifest,
                    )?;
                }
            }
            for size in Size::ALL {
                for hover in [false, true] {
                    let size_name = format!("{size:?}").to_lowercase();
                    let mut o = options.clone();
                    o.size = size;
                    o.folder = out
                        .join("scratch")
                        .join(format!("N3-N10-{size_name}-{theme}-{suffix}-{hover}"));
                    o.presence_folder = None;
                    let mut e = Engine::new(o, now, 0xC1A0DE)?;
                    let mut r = Record::resting();
                    r.at = now as f64;
                    r.session = "N3-N10".into();
                    r.done = now as f64;
                    e.preview_record(r.clone(), now);
                    // render_companion refreshes the count from real synthetic sessions.
                    for i in 1..10 {
                        r.session = format!("N3-N10-unseen-{i}");
                        e.preview_add_record(r.clone(), now);
                    }
                    e.ui.dark = dark;
                    e.ui.hover_visible = hover;
                    let c = e.render_companion(now, scale);
                    assert_eq!(e.ui.unseen, 10, "synthetic badge uses the session count");
                    assert!(
                        c.texts.iter().any(|run| run.text == "9+"),
                        "badge fixture must draw its count"
                    );
                    crate::preview::write_e2(
                        out,
                        &format!("N3-N10-{size_name}-hover-{hover}-{theme}@{suffix}"),
                        vec![c],
                        manifest,
                    )?;
                }
            }
        }
    }
    Ok(())
}
