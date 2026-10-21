//! Claudie's and maid Claudie's sixteen chibi cells (plugin/assets/claudie, tools/art/claudie-cells.py), drawn in
//! Coco's place when the plugin says Claude's form is one of them (DECISIONS 927, 943). Each of Coco's actions shows
//! one still cell; the cell table mirrors CLAUDIE_CELLS in plugin/hooks-source/claudie.ts.
use crate::{render::Image, Error};
use std::path::Path;
use tiny_skia::{FilterQuality, IntSize, Pixmap, PixmapPaint, Transform};

/// The forms that are not Coco.
pub const FORMS: [&str; 2] = ["dake", "maid"];

/// The cell (1 to 16) standing for one of Coco's actions in a form.
pub fn cell(form: &str, action: &str) -> usize {
    match action {
        "wait" | "hello" => 1,
        "firsttry" | "fixed" => 2,
        "think" | "search" | "lookup" => 3,
        "plan" | "run" | "helper" => 4,
        "peek" | "catch" => 5,
        "petted" | "praised" => 6,
        "hood" | "teapot" => 7,
        "wild" => 8,
        "doze" | "nap" => 9,
        "error" => 10,
        "watch" => 11,
        "done" | "pass" => 12,
        "out" => 13,
        "shell" => 16,
        "pack" => 15,
        _ => match (form, action) {
            ("maid", "read" | "work" | "serious") => 15,
            ("maid", "night") => 9,
            ("dake", "coffee") => 11,
            ("dake", "night") => 16,
            _ => 14,
        },
    }
}

/// One form's sixteen cells, on the canvas they share.
pub struct Stills {
    form: &'static str,
    cells: Vec<Pixmap>,
}
impl Stills {
    pub fn load(folder: &Path, form: &str) -> Result<Self, Error> {
        let form = FORMS
            .into_iter()
            .find(|known| *known == form)
            .ok_or("unknown Claude form")?;
        let mut cells = Vec::with_capacity(16);
        for n in 1..=16 {
            let image = Image::load(&folder.join(form).join(format!("{n:02}.png")))?;
            let size = IntSize::from_wh(image.width as u32, image.height as u32)
                .ok_or("empty Claude cell")?;
            cells.push(Pixmap::from_vec(image.pixels, size).ok_or("unreadable Claude cell")?);
        }
        Ok(Self { form, cells })
    }
    pub fn form(&self) -> &'static str {
        self.form
    }
    /// Her cell for an action in a canvas of Coco's size, fitted to it and standing on its bottom edge.
    pub fn render(&self, action: &str, width: usize, height: usize) -> Option<Image> {
        let source = &self.cells[cell(self.form, action) - 1];
        let mut out = Pixmap::new(width.max(1) as u32, height.max(1) as u32)?;
        let scale = (height as f32 / source.height() as f32).min(width as f32 / source.width() as f32);
        let (w, h) = (source.width() as f32 * scale, source.height() as f32 * scale);
        let paint = PixmapPaint {
            quality: FilterQuality::Bicubic,
            ..PixmapPaint::default()
        };
        out.draw_pixmap(
            0,
            0,
            source.as_ref(),
            &paint,
            Transform::from_row(scale, 0., 0., scale, (width as f32 - w) / 2., height as f32 - h),
            None,
        );
        Some(Image {
            width: out.width() as usize,
            height: out.height() as usize,
            pixels: out.take(),
        })
    }
}
