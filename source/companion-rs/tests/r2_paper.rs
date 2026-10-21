use coco_companion::{
    feed::{Record, Sessions},
    render::Canvas,
    ui::{Control, Rect, UiState},
};
fn activity() -> UiState {
    let mut r = Record::resting();
    r.session = "paper".into();
    r.project = "project".into();
    r.channel = true;
    r.at = 1000.;
    let mut sessions = Sessions::default();
    sessions.receive(r, 1001.);
    let mut ui = UiState::default();
    ui.open_activity(&sessions, 1001.);
    ui
}
fn pixel(c: &Canvas, x: f64, y: f64) -> [u8; 4] {
    let i = ((y.floor() as u32 * c.width + x.floor() as u32) * 4) as usize;
    c.pixels[i..i + 4].try_into().unwrap()
}
fn edge_and_shadow(name: &str, c: &Canvas, b: Rect, scale: f64) {
    let y = (b.y + b.height / 2.) * scale;
    let shadow = pixel(c, (b.x - 2.) * scale, y);
    assert!(
        shadow[3] > 0 && shadow[3] < 255,
        "{name}: paper needs its own translucent shadow outside its edge: {shadow:?}"
    );
    let edge = pixel(c, b.x * scale, y);
    assert_ne!(
        &edge[..3],
        &[250, 238, 233],
        "{name}: cream paper needs its ink edge"
    );
}
#[test]
fn four_paper_pieces_have_ink_edges_and_translucent_outer_shadows() {
    for scale in [1., 2.] {
        let ui = activity();
        let rendered = ui.render(scale);
        edge_and_shadow(
            "Activity",
            &rendered,
            Rect {
                x: 30.,
                y: 30.,
                width: 300.,
                height: ui.dimensions().1 - 60.,
            },
            scale,
        );
        let mut hover = ui.clone();
        hover.close();
        hover.hover_visible = true;
        hover.context.back_available = true;
        hover.hover_index = Some(0);
        let first = hover
            .elements()
            .into_iter()
            .find(|e| e.control == Control::Hover(0))
            .unwrap();
        let mut rendered = Canvas::blank((320. * scale) as u32, (400. * scale) as u32);
        hover.paint_hover(&mut rendered, scale);
        edge_and_shadow(
            "hover pill",
            &rendered,
            Rect {
                x: first.bounds.x - 4.,
                y: first.bounds.y - 4.,
                width: 144.,
                height: 32.,
            },
            scale,
        );
        let label = rendered
            .texts
            .iter()
            .find(|run| run.text == first.label)
            .unwrap();
        edge_and_shadow(
            "hover label",
            &rendered,
            Rect {
                x: label.x / scale - 8.,
                y: label.y / scale - 2.,
                width: label.width / scale + 16.,
                height: 20.,
            },
            scale,
        );
        let mut line = Canvas::blank((240. * scale) as u32, (160. * scale) as u32);
        let mut run = ui.render(scale).texts[0].clone();
        run.text.clear();
        run.x = 60. * scale;
        run.y = 60. * scale;
        run.width = 80. * scale;
        run.height = 20. * scale;
        line.paper(run, scale);
        edge_and_shadow(
            "speech label",
            &line,
            Rect {
                x: 52.,
                y: 56.,
                width: 96.,
                height: 28.,
            },
            scale,
        );
    }
}
