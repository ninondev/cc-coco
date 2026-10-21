//! UTF-16 range bookkeeping shared by native UIA and portable acceptance tests.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Unit {
    Character,
    Word,
    Document,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Span {
    pub start: u32,
    pub end: u32,
}
pub fn visible_extent(edges: &[(i32, i32)], left: i32, right: i32) -> Option<(i32, i32)> {
    let lo = edges.iter().map(|(a, b)| (*a).min(*b)).min()?.max(left);
    let hi = edges.iter().map(|(a, b)| (*a).max(*b)).max()?.min(right);
    (hi > lo).then_some((lo, hi))
}
pub fn visible_spans(glyphs: &[(u32, u32, i32, i32)], left: i32, right: i32) -> Vec<Span> {
    let mut spans: Vec<Span> = Vec::new();
    for &(start, end, a, b) in glyphs {
        if a.min(b) < right && a.max(b) > left {
            if let Some(last) = spans.last_mut().filter(|s| s.end == start) {
                last.end = end;
            } else {
                spans.push(Span { start, end });
            }
        }
    }
    spans
}
fn boundaries(text: &str, unit: Unit) -> Vec<u32> {
    let mut out = vec![0];
    let mut offset = 0;
    let mut previous_space = true;
    for c in text.chars() {
        if unit == Unit::Word && !c.is_whitespace() && previous_space && offset > 0 {
            out.push(offset);
        }
        offset += c.len_utf16() as u32;
        if unit == Unit::Character {
            out.push(offset);
        }
        previous_space = c.is_whitespace();
    }
    if out.last() != Some(&offset) {
        out.push(offset);
    }
    out
}
fn floor(text: &str, offset: u32) -> u32 {
    boundaries(text, Unit::Character)
        .into_iter()
        .take_while(|p| *p <= offset)
        .last()
        .unwrap_or(0)
}
pub fn scalar_to_utf16(text: &str, offset: usize) -> u32 {
    text.chars()
        .take(offset)
        .map(|c| c.len_utf16() as u32)
        .sum()
}
pub fn utf16_to_scalar(text: &str, offset: u32) -> usize {
    let mut used = 0;
    let mut count = 0;
    for c in text.chars() {
        used += c.len_utf16() as u32;
        if used > offset {
            break;
        }
        count += 1;
    }
    count
}
impl Span {
    pub fn visible(text: &str, first: u32, last: u32) -> Self {
        let first = floor(text, first);
        let last = floor(text, last);
        let mut tail = Self::new(text, first.max(last), first.max(last));
        tail.move_endpoint(text, false, Unit::Character, 1);
        Self::new(text, first.min(last), tail.end)
    }
    pub fn new(text: &str, start: u32, end: u32) -> Self {
        let start = floor(text, start);
        let end = floor(text, end);
        Self {
            start: start.min(end),
            end: start.max(end),
        }
    }
    pub fn text(self, text: &str, max: i32) -> String {
        let units = text.encode_utf16().collect::<Vec<_>>();
        let span = Self::new(text, self.start, self.end);
        let end = if max < 0 {
            span.end
        } else {
            floor(text, span.start.saturating_add(max as u32).min(span.end))
        };
        String::from_utf16(&units[span.start as usize..end as usize]).unwrap()
    }
    pub fn expand(&mut self, text: &str, unit: Unit) {
        let points = boundaries(text, unit);
        if points.len() < 2 {
            *self = Self { start: 0, end: 0 };
            return;
        }
        let i = points
            .partition_point(|p| *p <= self.start)
            .saturating_sub(1)
            .min(points.len() - 2);
        self.start = points[i];
        self.end = points[i + 1];
        if unit == Unit::Document {
            self.start = 0;
            self.end = *points.last().unwrap();
        }
    }
    pub fn move_endpoint(&mut self, text: &str, start: bool, unit: Unit, count: i32) -> i32 {
        let points = boundaries(text, unit);
        let point = if start { self.start } else { self.end };
        let index = if count < 0 {
            points.partition_point(|p| *p < point).min(points.len() - 1)
        } else {
            points.partition_point(|p| *p <= point).saturating_sub(1)
        };
        let next = (index as i64 + count as i64).clamp(0, points.len() as i64 - 1) as usize;
        if start {
            self.start = points[next];
            self.end = self.end.max(self.start);
        } else {
            self.end = points[next];
            self.start = self.start.min(self.end);
        }
        next as i32 - index as i32
    }
    pub fn move_by(&mut self, text: &str, unit: Unit, count: i32) -> i32 {
        if self.start == self.end {
            let moved = self.move_endpoint(text, true, unit, count);
            self.end = self.start;
            return moved;
        }
        self.expand(text, unit);
        let points = boundaries(text, unit);
        if points.len() < 2 {
            return 0;
        }
        let index = points
            .partition_point(|p| *p <= self.start)
            .saturating_sub(1)
            .min(points.len() - 2);
        let next = (index as i64 + count as i64).clamp(0, points.len() as i64 - 2) as usize;
        self.start = points[next];
        self.end = points[next + 1];
        next as i32 - index as i32
    }
    pub fn find(self, text: &str, needle: &str, backward: bool, ignore_case: bool) -> Option<Self> {
        let span = Self::new(text, self.start, self.end);
        if needle.is_empty() {
            return Some(Self {
                start: span.start,
                end: span.start,
            });
        }
        let selected = span.text(text, -1);
        let mut haystack = String::new();
        let mut positions = Vec::new();
        let mut utf16 = span.start;
        for c in selected.chars() {
            let piece = if ignore_case {
                c.to_lowercase().collect::<String>()
            } else {
                c.to_string()
            };
            let from = haystack.len();
            haystack.push_str(&piece);
            for _ in from..haystack.len() {
                positions.push((utf16, utf16 + c.len_utf16() as u32));
            }
            utf16 += c.len_utf16() as u32;
        }
        let needle = if ignore_case {
            needle.to_lowercase()
        } else {
            needle.to_owned()
        };
        let at = if backward {
            haystack.rfind(&needle)
        } else {
            haystack.find(&needle)
        }?;
        Some(Self {
            start: positions[at].0,
            end: positions[at + needle.len() - 1].1,
        })
    }
}
