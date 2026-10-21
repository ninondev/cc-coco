import AppKit

/// New chat from the Activity window (lane C, 10-16; his rule): Claude Code opens a new conversation in whichever of
/// its three faces this Mac has. Only the terminal version: a terminal opens with Claude Code in the chosen session's
/// folder. Only the Claude app: its new session page. Only the VS Code extension: a new Claude Code tab. More than
/// one: the pet asks which. None: there is no button. The same rules as companion-rs/src/new_chat.rs.
enum NewChat: String, CaseIterable {
    case terminal, desktop, vscode

    func word(_ words: Record.Words) -> String {
        switch self {
        case .terminal: words.newChatTerminal
        case .desktop: words.newChatDesktop
        case .vscode: words.newChatVSCode
        }
    }
    /// The link each maker documents (code.claude.com/docs: deep-links, vs-code, desktop). The terminal one starts in
    /// `folder` when the CLI would accept it, in the home folder otherwise.
    func link(folder: String?) -> URL? {
        switch self {
        case .terminal:
            guard let folder, NewChat.localFolder(folder) else { return URL(string: "claude-cli://open") }
            return URL(string: "claude-cli://open?cwd=" + NewChat.encode(folder))
        case .desktop: return URL(string: "claude://code/new")
        case .vscode: return URL(string: "vscode://anthropic.claude-code/open")
        }
    }
    /// An absolute folder on this Mac: no network path, no `..` segment, no hidden or direction characters.
    static func localFolder(_ folder: String) -> Bool {
        folder.hasPrefix("/") && !folder.hasPrefix("//") && folder.utf8.count <= 4096
            && !folder.split(separator: "/", omittingEmptySubsequences: false).contains("..")
            && !folder.unicodeScalars.contains { scalar in
                scalar.properties.generalCategory == .control || scalar.properties.generalCategory == .format
            }
    }
    /// encodeURIComponent: everything but ASCII letters, digits and -_.!~*'() as UTF-8 percent escapes.
    static func encode(_ text: String) -> String {
        let kept = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()")
        return text.addingPercentEncoding(withAllowedCharacters: kept) ?? ""
    }
    /// The faces this Mac has, in a fixed order: macOS knows a program for the link, and VS Code has the extension.
    /// Reads only what Launch Services says and the extensions folder's names; nothing runs.
    static func available() -> [NewChat] {
        allCases.filter { face in
            guard let probe = face.link(folder: nil), NSWorkspace.shared.urlForApplication(toOpen: probe) != nil else { return false }
            return face != .vscode || extensionInstalled()
        }
    }
    static func extensionInstalled() -> Bool {
        let folder = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".vscode/extensions", isDirectory: true)
        guard let names = try? FileManager.default.contentsOfDirectory(atPath: folder.path) else { return false }
        return names.contains { name in
            var directory: ObjCBool = false
            return name.hasPrefix("anthropic.claude-code-")
                && FileManager.default.fileExists(atPath: folder.appendingPathComponent(name).path, isDirectory: &directory)
                && directory.boolValue
        }
    }
}
