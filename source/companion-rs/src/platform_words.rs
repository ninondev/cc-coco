use crate::feed::Record;

pub const OS_DISCOVERY_NAME: &str = "Coco Pet";

pub fn initial_tray_tooltip(record: &Record) -> String {
    crate::ui::word(&record.lang, "tray.tip", 0)
}

pub fn activity_title(record: &Record) -> String {
    let title = if record.has_default_words() {
        crate::feed::bundled_word(&record.lang, "activity").unwrap_or(record.word("activity"))
    } else {
        record.word("activity")
    };
    format!("{} {}", record.name, title)
}
