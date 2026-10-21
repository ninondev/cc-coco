//! Traditional Chinese evidence through the same production layout and text painters.
use crate::{
    feed::{ActivityRow, Record, Sessions},
    render::Canvas,
    ui::{self, Quota, UiState},
    Error, Options,
};
use std::path::Path;

fn record(now: u64) -> Result<Record, Error> {
    let words: serde_json::Value = serde_json::from_str(include_str!("../assets/words/feed.json"))?;
    Ok(Record::from_value(&serde_json::json!({
        "session":"r5-traditional", "project":"r5", "at":now,
        "lang":"zh-Hant", "words":words["zh-Hant"]
    }))?)
}

fn text_sample(text: &str, scale: f64) -> Canvas {
    let (w, h) = crate::linux_model::pick_tooltip_metrics(text, "zh-Hant", scale);
    crate::linux_model::pick_tooltip(text, "zh-Hant", w, h, scale)
}

pub fn extra(
    _options: &Options,
    out: &Path,
    now: u64,
    manifest: &mut Vec<serde_json::Value>,
) -> Result<(), Error> {
    let record = record(now)?;
    let mut evidence = Vec::new();
    for dark in [false, true] {
        let theme = if dark { "dark" } else { "light" };
        for quarter in 2..=16 {
            let scale = quarter as f64 / 4.;
            for scene in ["foot", "empty"] {
                let mut u = UiState::default();
                u.open_activity(&Sessions::default(), now as f64);
                u.dark = dark;
                u.chosen = record.clone();
                let mut quota = Quota::example();
                quota.windows[0].reset = Some(now as f64 + 2. * 86_400_000.);
                quota.windows[1].reset = Some(now as f64 + 7. * 86_400_000.);
                quota.windows[0].pace =
                    Some(ui::word("zh-Hant", "quota.pace.wide", 0).replace("{t}", "1h 5m"));
                u.chosen.quota = Some(quota);
                if scene == "foot" {
                    u.rows.push(ActivityRow {
                        record: record.clone(),
                        state: record.word("finished").into(),
                        unseen: true,
                        excerpt: Some(record.word("ready").into()),
                    });
                }
                crate::preview::write_e2(
                    out,
                    &format!("R5-{scene}-zh-Hant-{theme}@{}pct", quarter * 25),
                    vec![u.render(scale)],
                    manifest,
                )?;
            }
        }
        for scale in [1., 2.] {
            for (state, asleep, count) in [
                ("awake", false, 0),
                ("asleep", true, 0),
                ("unseen", false, 12),
                ("asleep-unseen", true, 12),
            ] {
                let mut sessions = Sessions::default();
                for index in 0..count.max(1) {
                    let mut r = record.clone();
                    r.session = format!("r5-tray-{index}");
                    r.done = if count > 0 { now as f64 } else { 0. };
                    r.mood = if asleep { "sleep" } else { "idle" }.into();
                    sessions.receive(r, now as f64);
                }
                let tray = ui::tray_state(&sessions, now as f64);
                assert_eq!(tray.unseen, count);
                if !dark && scale == 1. {
                    evidence.push(serde_json::json!({"state":state,"count":tray.unseen,"tooltip":tray.tooltip,"scope":"Production tray model text; swatch uses existing X11 tooltip geometry, not native OS tray styling"}));
                }
                crate::preview::write_e2(
                    out,
                    &format!("R5-tray-tooltip-{state}-zh-Hant-{theme}@{}x", scale as u8),
                    vec![text_sample(&tray.tooltip, scale)],
                    manifest,
                )?;
            }
            let names = format!(
                "{}{}{}",
                crate::languages::native_name("zh"),
                ui::part_separator("zh-Hant"),
                crate::languages::native_name("zh-Hant")
            );
            crate::preview::write_e2(
                out,
                &format!("R5-language-names-zh-Hant-{theme}@{}x", scale as u8),
                vec![text_sample(&names, scale)],
                manifest,
            )?;
            crate::preview::write_e2(
                out,
                &format!("R5-pick-tooltip-zh-Hant-{theme}@{}x", scale as u8),
                vec![text_sample(&ui::word("zh-Hant", "pick.help", 0), scale)],
                manifest,
            )?;
        }
    }
    std::fs::write(
        out.join("R5-tray-model.json"),
        serde_json::to_vec_pretty(&evidence)?,
    )?;
    let names = crate::languages::all().iter().map(|lang|serde_json::json!({"code":lang.code,"locale":crate::languages::locale(&lang.code),"native":crate::languages::native_name(&lang.code),"english":crate::languages::english_name(&lang.code)})).collect::<Vec<_>>();
    std::fs::write(
        out.join("R5-language-model.json"),
        serde_json::to_vec_pretty(&names)?,
    )?;
    Ok(())
}
