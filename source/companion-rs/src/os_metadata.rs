use serde_json::Value;

fn approved_words() -> &'static Value {
    static WORDS: std::sync::OnceLock<Value> = std::sync::OnceLock::new();
    WORDS.get_or_init(|| {
        serde_json::from_str(include_str!("../assets/words/1.0.json")).expect("approved OS words")
    })
}

pub(crate) fn approved_word(key: &str, lang: &str) -> &'static str {
    approved_words()[key][lang]
        .as_str()
        .or_else(|| approved_words()[key]["en"].as_str())
        .expect("approved OS description and name")
}

fn desktop_escape(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\t', "\\t")
}

pub fn autostart_entry(executable: &str) -> String {
    checked_autostart_entry(executable).unwrap_or_default()
}

pub fn checked_autostart_entry(executable: &str) -> std::io::Result<String> {
    if executable.chars().any(char::is_control) {
        return Err(std::io::ErrorKind::InvalidInput.into());
    }
    let quoted = executable
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('`', "\\`")
        .replace('$', "\\$")
        .replace('%', "%%");
    let quoted = desktop_escape(&quoted);
    let name = desktop_escape(approved_word("companion.os.name", "en"));
    let description = desktop_escape(approved_word("companion.os.description", "en"));
    let mut entry =
        format!("[Desktop Entry]\nType=Application\nName={name}\nComment={description}\n");
    let descriptions = approved_words()["companion.os.description"]
        .as_object()
        .expect("approved localized OS descriptions");
    for (lang, description) in descriptions {
        let locale = lang.replace('-', "_");
        entry.push_str(&format!(
            "Comment[{locale}]={}\n",
            desktop_escape(description.as_str().expect("localized OS description"))
        ));
    }
    // His flower, 256 px, ships beside the binary; the startup lists then show it instead of a generic gear.
    if let Some(folder) = std::path::Path::new(executable)
        .parent()
        .filter(|folder| folder.is_absolute())
    {
        let icon = folder.join("coco-256.png");
        entry.push_str(&format!(
            "Icon={}\n",
            desktop_escape(&icon.to_string_lossy())
        ));
    }
    entry.push_str(&format!(
        "Exec=\"{quoted}\" --login\nTerminal=false\nX-GNOME-Autostart-enabled=true\n"
    ));
    Ok(entry)
}

fn rc_escape(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
}

pub fn windows_version_resource(version: &str, tuple: [u16; 4], icon: &str) -> String {
    let numeric = tuple.map(|part| part.to_string()).join(",");
    let name = rc_escape(approved_word("companion.os.name", "en"));
    let description = rc_escape(approved_word("companion.os.description", "en"));
    let file_description = rc_escape(approved_word("companion.os.fileDescription", "en"));
    let icon = rc_escape(icon);
    format!(
        r#"#include <windows.h>
2 ICON "{icon}"
1 VERSIONINFO
 FILEVERSION {numeric}
 PRODUCTVERSION {numeric}
 FILEFLAGSMASK VS_FFI_FILEFLAGSMASK
 FILEFLAGS 0
 FILEOS VOS_NT_WINDOWS32
 FILETYPE VFT_APP
 FILESUBTYPE VFT2_UNKNOWN
BEGIN
 BLOCK "StringFileInfo"
 BEGIN
  BLOCK "040904B0"
  BEGIN
   VALUE "ProductName", "{name}\0"
   VALUE "FileDescription", "{file_description}\0"
   VALUE "LegalCopyright", "{description}\0"
   VALUE "CompanyName", "\0"
   VALUE "ProductVersion", "{version}\0"
   VALUE "FileVersion", "{version}\0"
   VALUE "OriginalFilename", "coco-companion.exe\0"
  END
 END
 BLOCK "VarFileInfo"
 BEGIN
  VALUE "Translation", 0x0409, 1200
 END
END
"#
    )
}
