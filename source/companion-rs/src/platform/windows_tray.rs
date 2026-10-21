//! Icon identity is independent from the full count used by its tooltip.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct IconKey {
    pub image: &'static str,
    pub size: u32,
}
pub fn icon_key(asleep: bool, unseen: usize, dpi: u32) -> IconKey {
    IconKey {
        image: match (asleep, unseen > 0) {
            (false, false) => "awake",
            (true, false) => "asleep",
            (false, true) => "unseen",
            (true, true) => "asleep-unseen",
        },
        size: ((16u64 * dpi.max(96) as u64 + 48) / 96).clamp(1, i32::MAX as u64) as u32,
    }
}
