//! Colour roles for his chrome when the system asks for more contrast.
//!
//! Three looks share one set of questions ("what fills the panel?", "how thick is its edge?"):
//! the normal look, his paper strengthened (macOS Increase Contrast, the XDG portal's
//! `contrast = 1`), and the system's own colours (a Windows contrast theme). The normal look
//! answers with the colours the painters already used, so nothing changes until a signal arrives.
//! Pictures (his frames, the lanterns, the ribbons, the shed) never come through here.

pub type Color = [u8; 4];

const INK: Color = [35, 27, 25, 255];
const CREAM: Color = [250, 238, 233, 255];
const DARK_PAPER: Color = [43, 34, 32, 255];
/// Seal buttons on his paper under high contrast: rest and pressed.
const SEAL_REST: Color = [118, 48, 26, 255];
const SEAL_PRESSED: Color = [92, 36, 18, 255];
const PLACEHOLDER: Color = [90, 80, 76, 255];

/// The seven colours of `GetSysColor` the Windows look reads. Hotlight has no use here: nothing he
/// draws is a link.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SystemPalette {
    pub window: Color,
    pub window_text: Color,
    pub highlight: Color,
    pub highlight_text: Color,
    pub button_face: Color,
    pub button_text: Color,
    pub gray_text: Color,
}
impl SystemPalette {
    /// A Win32 COLORREF is 0x00BBGGRR.
    pub fn from_colorref(value: u32) -> Color {
        [value as u8, (value >> 8) as u8, (value >> 16) as u8, 255]
    }
    pub fn from_colorrefs(refs: [u32; 7]) -> Self {
        let [window, window_text, highlight, highlight_text, button_face, button_text, gray_text] =
            refs.map(Self::from_colorref);
        Self {
            window,
            window_text,
            highlight,
            highlight_text,
            button_face,
            button_text,
            gray_text,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Look {
    #[default]
    Normal,
    /// His paper, strengthened: solid ink edges, inversions for hover, nothing partly transparent.
    Paper,
    /// A Windows contrast theme: the system's colours only.
    System(SystemPalette),
}

/// What a button draws at one moment.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ButtonLook {
    pub fill: Option<Color>,
    pub text: Color,
    pub edge: Option<(f64, Color)>,
}

impl Look {
    pub fn new(high_contrast: bool, system: Option<SystemPalette>) -> Self {
        match (high_contrast, system) {
            (_, Some(palette)) => Self::System(palette),
            (true, None) => Self::Paper,
            (false, None) => Self::Normal,
        }
    }
    pub fn is_normal(self) -> bool {
        self == Self::Normal
    }
    pub fn is_system(self) -> bool {
        matches!(self, Self::System(_))
    }
    pub fn palette(self) -> Option<SystemPalette> {
        match self {
            Self::System(palette) => Some(palette),
            _ => None,
        }
    }
    /// The panel under his line, the pill, the hover label, Activity and the card.
    pub fn panel_fill(self, dark: bool) -> Color {
        match self {
            Self::System(p) => p.window,
            _ if dark => DARK_PAPER,
            _ => CREAM,
        }
    }
    /// Text and ink on the panel.
    pub fn ink(self, dark: bool) -> Color {
        match self {
            Self::System(p) => p.window_text,
            _ if dark => CREAM,
            _ => INK,
        }
    }
    /// The edge round a panel, in points. The normal edge is a faint 0.5 pt blend.
    pub fn panel_edge(self, dark: bool) -> (f64, Color) {
        match self {
            Self::Normal => (0.5, [35, 27, 25, 41]),
            Self::Paper => (1., self.ink(dark)),
            Self::System(p) => (2., p.window_text),
        }
    }
    /// A system look draws no shadow: a shadow is a tint of a colour that is not the system's.
    pub fn shadow(self) -> bool {
        !self.is_system()
    }
    /// A hairline between rows and above the quota foot.
    pub fn divider(self, dark: bool) -> (f64, Color) {
        match self {
            Self::Normal => (0.5, [35, 27, 25, 46]),
            Self::Paper => (0.5, self.ink(dark)),
            Self::System(p) => (1., p.window_text),
        }
    }
    /// The quota foot's ground.
    pub fn foot_fill(self) -> Color {
        match self {
            Self::System(p) => p.window,
            _ => [245, 228, 220, 255],
        }
    }
    /// The field's placeholder text.
    pub fn placeholder(self) -> Color {
        match self {
            Self::Normal => [107, 96, 92, 255],
            Self::Paper => PLACEHOLDER,
            Self::System(p) => p.gray_text,
        }
    }
    /// A keyboard focus ring: its width in points, its colour, and the gap of the panel's colour
    /// kept between the control and the ring (a system look only).
    pub fn focus(self, dark: bool) -> (f64, Color, f64) {
        match self {
            Self::Normal => (1.5, [199, 87, 48, 255], 0.),
            Self::Paper => (2., self.ink(dark), 0.),
            Self::System(p) => (2., p.window_text, 1.),
        }
    }
    /// The field and the target button: a 1 pt border.
    pub fn control_edge(self, dark: bool) -> Color {
        match self {
            Self::Normal => [142, 132, 129, 255],
            Self::Paper => self.ink(dark),
            Self::System(p) => p.button_text,
        }
    }
    /// An icon button in the hover row. `None` keeps the normal look's own wash and glyph.
    pub fn icon_button(self, dark: bool, hovered: bool) -> Option<ButtonLook> {
        match self {
            Self::Normal => None,
            // Hover is an inversion: an ink disc with a cream glyph, a cream disc with a paper
            // glyph on dark paper. At rest the glyph keeps its own colour on the bare paper.
            Self::Paper => hovered.then(|| ButtonLook {
                fill: Some(self.ink(dark)),
                text: self.panel_fill(dark),
                edge: None,
            }),
            Self::System(p) => Some(if hovered {
                ButtonLook {
                    fill: Some(p.highlight),
                    text: p.highlight_text,
                    edge: None,
                }
            } else {
                ButtonLook {
                    fill: Some(p.button_face),
                    text: p.button_text,
                    edge: None,
                }
            }),
        }
    }
    /// The seal buttons: Send, Cancel. `None` keeps the normal seal.
    pub fn seal(self, hovered: bool, pressed: bool, enabled: bool) -> Option<ButtonLook> {
        match self {
            Self::Normal => None,
            // Hover keeps the rest colour: the inner ring the carved seal once drew is not drawn.
            Self::Paper => Some(ButtonLook {
                fill: Some(if pressed { SEAL_PRESSED } else { SEAL_REST }),
                text: CREAM,
                edge: None,
            }),
            Self::System(p) => Some(if !enabled {
                ButtonLook {
                    fill: Some(p.button_face),
                    text: p.gray_text,
                    edge: Some((1., p.gray_text)),
                }
            } else if hovered || pressed {
                ButtonLook {
                    fill: Some(p.highlight_text),
                    text: p.highlight,
                    edge: Some((2., p.highlight)),
                }
            } else {
                ButtonLook {
                    fill: Some(p.highlight),
                    text: p.highlight_text,
                    edge: None,
                }
            }),
        }
    }
    /// The quiet buttons: Clear, New chat. `None` keeps the normal look.
    pub fn quiet_button(self, dark: bool, hovered: bool, border: bool) -> Option<ButtonLook> {
        match self {
            Self::Normal => None,
            Self::Paper => Some(if hovered {
                ButtonLook {
                    fill: Some(self.ink(dark)),
                    text: self.panel_fill(dark),
                    edge: Some((1., self.ink(dark))),
                }
            } else {
                ButtonLook {
                    fill: None,
                    text: self.ink(dark),
                    edge: border.then(|| (1., self.ink(dark))),
                }
            }),
            Self::System(p) => Some(if hovered {
                ButtonLook {
                    fill: Some(p.highlight),
                    text: p.highlight_text,
                    edge: None,
                }
            } else {
                ButtonLook {
                    fill: Some(p.button_face),
                    text: p.button_text,
                    edge: Some((1., p.button_text)),
                }
            }),
        }
    }
    /// The count on him: a seal with a ring.
    pub fn badge(self) -> Option<ButtonLook> {
        match self {
            Self::Normal => None,
            Self::Paper => Some(ButtonLook {
                fill: Some(SEAL_REST),
                text: CREAM,
                edge: Some((1.5, CREAM)),
            }),
            Self::System(p) => Some(ButtonLook {
                fill: Some(p.button_face),
                text: p.button_text,
                edge: Some((1.5, p.button_text)),
            }),
        }
    }
    /// The unseen dot: filled. The seen dot: a hollow ring.
    pub fn row_dot(self, dark: bool, unseen: bool) -> Color {
        match self {
            Self::Normal if unseen => [158, 65, 35, 255],
            Self::Normal => [142, 132, 129, 255],
            Self::Paper if unseen => [158, 65, 35, 255],
            Self::Paper => self.ink(dark),
            Self::System(p) => p.window_text,
        }
    }
    /// The vermilion band along Activity's top and his spark. A system look draws them as ink.
    pub fn accent(self) -> Color {
        match self {
            Self::System(p) => p.window_text,
            _ => [199, 87, 48, 255],
        }
    }
    /// The unseen dot on the bell: it keeps a ring of the ground so it holds on an inverted disc.
    pub fn bell_dot(self) -> Option<(Color, Color)> {
        match self {
            Self::Normal => None,
            Self::Paper => Some(([158, 65, 35, 255], CREAM)),
            Self::System(p) => Some((p.window_text, p.window)),
        }
    }
    /// The quota pictures under a system contrast theme: `(ink, paper)`, the battery and the power bank drawn in
    /// the system's two colours (section 3.2, system colours only). `None` keeps their own colours.
    pub fn quota_picture(self) -> Option<(Color, Color)> {
        match self {
            Self::System(p) => Some((p.window_text, p.window)),
            _ => None,
        }
    }
    /// The drawn right-click menu. `(ground, text, edge, highlighted ground, highlighted text)`.
    /// `None` keeps the normal menu.
    pub fn menu(self, dark: bool) -> Option<(Color, Color, Color, Color, Color)> {
        let black = [0, 0, 0, 255];
        let white = [255, 255, 255, 255];
        match self {
            Self::Normal => None,
            Self::Paper if dark => Some((black, white, white, white, black)),
            Self::Paper => Some((white, black, black, black, white)),
            Self::System(p) => Some((
                p.window,
                p.window_text,
                p.window_text,
                p.highlight,
                p.highlight_text,
            )),
        }
    }
    /// The speech line's pointer fade: all or nothing once the system asks for it.
    pub fn solid_fade(self) -> bool {
        !self.is_normal()
    }
}

/// The two-tone frame round a window picked on X11: a 2 px black line inside a 2 px white line, so
/// one of them holds against any window.
pub const PICK_OUTER: Color = [255, 255, 255, 255];
pub const PICK_INNER: Color = [0, 0, 0, 255];

/// WCAG 2 contrast of two opaque colours.
pub fn contrast_ratio(a: Color, b: Color) -> f64 {
    fn channel(v: u8) -> f64 {
        let v = v as f64 / 255.;
        if v <= 0.04045 {
            v / 12.92
        } else {
            ((v + 0.055) / 1.055).powf(2.4)
        }
    }
    let lum = |c: Color| 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);
    let (x, y) = (lum(a), lum(b));
    (x.max(y) + 0.05) / (x.min(y) + 0.05)
}
