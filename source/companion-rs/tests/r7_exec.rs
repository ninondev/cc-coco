use coco_companion::os_metadata::{autostart_entry, checked_autostart_entry};

// Decode the key-file layer independently before examining Exec token quoting.
fn key_file_decode(value: &str) -> String {
    let mut chars = value.chars();
    let mut decoded = String::new();
    while let Some(c) = chars.next() {
        if c != '\\' {
            decoded.push(c);
            continue;
        }
        decoded.push(match chars.next().expect("complete key-file escape") {
            '\\' => '\\',
            's' => ' ',
            'n' => '\n',
            'r' => '\r',
            't' => '\t',
            c => panic!("invalid key-file escape: {c}"),
        });
    }
    decoded
}

#[test]
fn executable_controls_are_rejected_without_a_desktop_entry() {
    for control in ['\r', '\n', '\t', '\0', '\u{7f}', '\u{85}'] {
        let executable = format!("/tmp/companion{control} entry");
        assert!(autostart_entry(&executable).is_empty(), "{control:?}");
        assert_eq!(
            checked_autostart_entry(&executable).unwrap_err().kind(),
            std::io::ErrorKind::InvalidInput
        );
    }
}

#[test]
fn executable_round_trips_both_desktop_entry_layers() {
    let executable = "/tmp/space dir/quote\"back\\tick`dollar$percent% companion";
    let desktop = autostart_entry(executable);
    assert_eq!(checked_autostart_entry(executable).unwrap(), desktop);
    let exec = desktop
        .lines()
        .find_map(|line| line.strip_prefix("Exec="))
        .unwrap();
    let decoded = key_file_decode(exec);
    assert!(decoded.starts_with('"'));
    let mut chars = decoded[1..].chars();
    let mut argument = String::new();
    loop {
        match chars.next().expect("closing Exec quote") {
            '"' => break,
            '\\' => {
                let escaped = chars.next().expect("complete Exec escape");
                assert!(['\\', '"', '`', '$'].contains(&escaped));
                argument.push(escaped);
            }
            '%' => {
                assert_eq!(chars.next(), Some('%'));
                argument.push('%');
            }
            c => argument.push(c),
        }
    }
    assert_eq!(argument, executable);
    assert_eq!(chars.collect::<String>(), " --login");
    let words: serde_json::Value =
        serde_json::from_str(include_str!("../assets/words/1.0.json")).unwrap();
    let descriptions = words["companion.os.description"].as_object().unwrap();
    let languages = coco_companion::languages::all();
    assert_eq!(descriptions.len(), languages.len());
    for language in languages {
        assert!(descriptions.contains_key(&language.code));
    }
    for (lang, value) in descriptions {
        let prefix = format!("Comment[{}]=", lang.replace('-', "_"));
        let actual = desktop
            .lines()
            .find_map(|line| line.strip_prefix(&prefix))
            .unwrap();
        assert_eq!(key_file_decode(actual), value.as_str().unwrap());
    }
}
