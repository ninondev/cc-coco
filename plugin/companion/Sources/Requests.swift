import Foundation

/// Each request keeps its own clock; an unrelated session never replaces a newer choice.
struct Requests: Equatable {
    struct SizePick: Equatable { var to: Size; var at: Double }
    struct LoginPick: Equatable { var on: Bool; var at: Double }
    var follow: Double = 0
    var settings: Double = 0
    var size: SizePick?
    var login: LoginPick?

    init() {}
    init(_ object: [String: Any]) {
        func stamp(_ value: Any?) -> Double {
            guard let n = value as? Double, n.isFinite, n > 0 else { return 0 }
            return n
        }
        follow = stamp(object["follow"])
        settings = stamp(object["settings"])
        if let value = object["size"] as? [String: Any], let raw = value["to"] as? String,
           let to = Size(rawValue: raw), stamp(value["at"]) > 0 {
            size = SizePick(to: to, at: stamp(value["at"]))
        }
        if let value = object["login"] as? [String: Any], let on = value["on"] as? Bool, stamp(value["at"]) > 0 {
            login = LoginPick(on: on, at: stamp(value["at"]))
        }
    }

    mutating func merge(_ other: Requests) {
        follow = max(follow, other.follow)
        settings = max(settings, other.settings)
        if let pick = other.size, pick.at > (size?.at ?? 0) { size = pick }
        if let pick = other.login, pick.at > (login?.at ?? 0) { login = pick }
    }

    static func wants(_ at: Double, after answered: Double, launch: Bool, now: Double) -> Bool {
        at.isFinite && at > 0 && at > answered && (!launch || (0...15_000).contains(now - at))
    }
}

/// The script and the app deliberately write the same bytes. No registration or launchctl needed.
enum LoginAgent {
    static let label = "io.github.ninondev.claudesama-companion"
    /// Scratch binaries must never repair or remove the owner's installed login agent.
    static func installedBundle(bundleIdentifier: String?, executable: String?) -> Bool {
        guard bundleIdentifier == label, let executable else { return false }
        let components = URL(fileURLWithPath: executable).standardizedFileURL.pathComponents
        return components.dropLast().contains { $0.hasSuffix(".app") }
    }
    static var isInstalledBundle: Bool {
        installedBundle(bundleIdentifier: Bundle.main.bundleIdentifier,
                        executable: Bundle.main.executableURL?.path)
    }
    static func plist(executable: String) -> String {
        let escaped = executable.replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;").replacingOccurrences(of: "'", with: "&apos;")
        return """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
        	<key>Label</key>
        	<string>io.github.ninondev.claudesama-companion</string>
        	<key>ProgramArguments</key>
        	<array>
        		<string>\(escaped)</string>
        		<string>--login</string>
        	</array>
        	<key>RunAtLoad</key>
        	<true/>
        	<key>KeepAlive</key>
        	<false/>
        	<key>ProcessType</key>
        	<string>Interactive</string>
        	<key>LimitLoadToSessionType</key>
        	<string>Aqua</string>
        	<key>AssociatedBundleIdentifiers</key>
        	<array>
        		<string>io.github.ninondev.claudesama-companion</string>
        	</array>
        </dict>
        </plist>

        """
    }

    static func url(home: URL) -> URL {
        home.appendingPathComponent("Library/LaunchAgents/\(label).plist")
    }
    static func set(_ on: Bool, home: URL, executable: String) throws {
        guard isInstalledBundle else { return }
        let file = url(home: home)
        let fm = FileManager.default
        if on {
            try fm.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            try plist(executable: executable).write(to: file, atomically: true, encoding: .utf8)
        } else if fm.fileExists(atPath: file.path) {
            try fm.trashItem(at: file, resultingItemURL: nil)
        }
    }
    static func repair(home: URL, executable: String) throws {
        guard isInstalledBundle else { return }
        let file = url(home: home)
        guard FileManager.default.fileExists(atPath: file.path),
              let data = try? Data(contentsOf: file),
              let object = (try? PropertyListSerialization.propertyList(from: data, format: nil)) as? [String: Any],
              let args = object["ProgramArguments"] as? [String], args.first != executable else { return }
        try set(true, home: home, executable: executable)
    }
}
