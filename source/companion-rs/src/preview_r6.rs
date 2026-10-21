//! Part-six observers share the same synthetic inputs with the retained renderer.
use crate::{
    feed::{ActivityRow, Record, Sessions},
    render::{Canvas, Size},
    ui::{self, Rect, UiState},
    Error, Options,
};
use std::path::Path;
fn swatch(text: &str, lang: &str, scale: f64) -> Canvas {
    let (w, h) = ui::text_metrics(
        text,
        lang,
        13. * scale,
        false,
        false,
        10000. * scale,
        10000. * scale,
    );
    crate::linux_model::pick_tooltip(text, lang, w / scale, h / scale, scale)
}
pub fn extra(
    options: &Options,
    out: &Path,
    now: u64,
    manifest: &mut Vec<serde_json::Value>,
) -> Result<(), Error> {
    let words: serde_json::Value = serde_json::from_str(include_str!("../assets/words/feed.json"))?;
    let mut titles = Vec::new();
    for lang in crate::languages::codes() {
        let mut record = Record::from_value(
            &serde_json::json!({"session":format!("F1-F2-{lang}"),"project":"atlas/plugin","lang":lang,"at":now.saturating_sub(60_000),"words":words[lang]}),
        )?;
        let mut quota = ui::Quota::example();
        quota.windows[0].pace = Some(ui::word(lang, "quota.pace.wide", 0).replace("{t}", "1h 5m"));
        quota.windows[0].reset = Some(now as f64 + 3_900_000.);
        quota.windows[1].reset = Some(now as f64 + 7. * 86_400_000.);
        record.quota = Some(quota);
        let fallback =
            Record::from_value(&serde_json::json!({"session":"F8","lang":lang,"at":now}))?;
        let title = crate::platform_words::activity_title(&fallback);
        titles.push(serde_json::json!({"lang":lang,"title":title}));
        for dark in [false, true] {
            let theme = if dark { "dark" } else { "light" };
            for quarter in 2..=16 {
                let scale = quarter as f64 / 4.;
                let mut u = UiState::default();
                u.open_activity(&Sessions::default(), now as f64);
                u.dark = dark;
                u.chosen = record.clone();
                u.rows.push(ActivityRow {
                    record: record.clone(),
                    state: record.word("finished").into(),
                    unseen: true,
                    excerpt: Some("The comment nodes now survive both runs.".into()),
                });
                crate::preview::write_e2(
                    out,
                    &format!("F1-F2-foot-{lang}-{theme}@{}pct", quarter * 25),
                    vec![u.render(scale)],
                    manifest,
                )?;
                if quarter == 4 || quarter == 8 {
                    let suffix = quarter / 4;
                    let text = ui::word(lang, "pick.help", 0);
                    // Same observer width as the original bug; production decides box fit.
                    let (w, h) = ui::text_metrics(
                        &text,
                        lang,
                        13. * scale,
                        false,
                        false,
                        288. * scale,
                        80. * scale,
                    );
                    crate::preview::write_e2(
                        out,
                        &format!("F7-pick-{lang}-{theme}@{suffix}x"),
                        vec![crate::linux_model::pick_tooltip(
                            &text,
                            lang,
                            w / scale,
                            h / scale,
                            scale,
                        )],
                        manifest,
                    )?;
                    crate::preview::write_e2(
                        out,
                        &format!("F8-title-{lang}-{theme}@{suffix}x"),
                        vec![swatch(&title, lang, scale)],
                        manifest,
                    )?;
                    #[cfg(feature = "a11y")]
                    if !dark && quarter == 4 {
                        let tree = crate::accessibility::tree(&u, &u.chosen);
                        let nodes=tree.nodes.iter().map(|(id,n)|serde_json::json!({"id":id.0,"name":n.label(),"state":n.state_description()})).collect::<Vec<_>>();
                        std::fs::write(
                            out.join(format!("F6-{lang}-tree.json")),
                            serde_json::to_vec_pretty(&nodes)?,
                        )?;
                    }
                }
            }
        }
    }
    std::fs::write(
        out.join("F8-titles.json"),
        serde_json::to_vec_pretty(&titles)?,
    )?;
    for size in Size::ALL {
        for dark in [false, true] {
            for scale in [1., 2.] {
                let theme = if dark { "dark" } else { "light" };
                let size_name = format!("{size:?}").to_lowercase();
                let mut o = options.clone();
                o.size = size;
                o.folder = out
                    .join("scratch")
                    .join(format!("F3-{size_name}-{theme}-{scale}"));
                o.presence_folder = None;
                let mut e = crate::engine::Engine::new(o, now, 0xC1A0DE)?;
                let mut r = Record::resting();
                r.session = "F3".into();
                r.project = "atlas/plugin".into();
                r.at = now as f64;
                r.done = now as f64;
                e.preview_record(r.clone(), now);
                r.session = "F3-unseen".into();
                e.preview_add_record(r, now);
                e.ui.dark = dark;
                e.ui.hover_visible = true;
                e.ui.hover_index = Some(0);
                // The viewport edge forces the approved below-pill label placement.
                let initial = e.render_companion(now, scale);
                let pill = e.ui.hover_bounds();
                e.set_ui_viewport(Some(Rect {
                    x: 0.,
                    y: pill.y,
                    width: initial.width as f64 / scale,
                    height: initial.height as f64 / scale - pill.y,
                }));
                let canvas = e.render_companion(now, scale);
                crate::preview::write_e2(
                    out,
                    &format!("F3-label-{size_name}-{theme}@{}x", scale as u8),
                    vec![canvas],
                    manifest,
                )?;
            }
        }
    }
    Ok(())
}
