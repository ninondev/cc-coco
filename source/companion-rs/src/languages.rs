use serde::Deserialize;
use std::sync::OnceLock;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct Language {
    pub code: String,
    pub locale: String,
    pub native: String,
    pub english: String,
}

static LANGUAGES: OnceLock<Vec<Language>> = OnceLock::new();

pub fn all() -> &'static [Language] {
    LANGUAGES.get_or_init(|| {
        serde_json::from_str(include_str!("../assets/words/languages.json"))
            .expect("generated language metadata must be valid")
    })
}

pub fn codes() -> impl Iterator<Item = &'static str> {
    all().iter().map(|language| language.code.as_str())
}

pub fn is_supported(code: &str) -> bool {
    all().iter().any(|language| language.code == code)
}

fn lookup(code: &str) -> &'static Language {
    all()
        .iter()
        .find(|language| language.code == code)
        .or_else(|| all().iter().find(|language| language.code == "en"))
        .expect("generated language metadata must contain English")
}

pub fn locale(code: &str) -> &'static str {
    &lookup(code).locale
}

pub fn native_name(code: &str) -> &'static str {
    &lookup(code).native
}

pub fn english_name(code: &str) -> &'static str {
    &lookup(code).english
}
