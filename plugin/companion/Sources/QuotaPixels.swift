import Foundation

/// Activity's quota foot without AppKit (lane C, 10-17), so a Linux machine can check it too
/// (tools/tests/companion-quota.py). The pictures are the band's: the laptop's battery for the 5-hour window and
/// the power bank for the weekly one (DECISIONS 889; CANON: the pet's quota is the battery and the power bank).
/// Their rows are quota.ts's quotaBatteryRows and quotaBankRows, one character an art pixel, ported line for line
/// as the Rust pet's src/quota_pixels.rs is; both are checked against companion-rs/tests/fixtures/quota-pixels.json.
/// The words are the Rust pet's own approved table (companion-rs/assets/words/quota.json), copied into the app.
enum QuotaPixels {
    private static let bolt = ["...##", "..##.", ".##..", "#####", "..##.", ".##..", "##...", "#...."]

    private static func quarterFill(_ left: Double, _ k: Int) -> Double { min(1, max(0, (left - 25 * Double(k)) / 25)) }

    private static func boltOver(_ g: inout [[Character]], _ x0: Int, _ y0: Int) {
        for (j, row) in bolt.enumerated() {
            let cells = Array(row)
            for (i, ch) in cells.enumerated() where ch == "#" {
                g[y0 + j][x0 + i] = i + 1 < cells.count && cells[i + 1] == "#" ? "Y" : "y"
            }
        }
    }

    /// The 5-hour battery's rows: `left` is the percent remaining.
    static func battery(left: Double, waiting: Bool) -> [String] {
        let w = 26, h = 12
        var g = Array(repeating: Array(repeating: Character("."), count: w), count: h)
        for y in 0..<h {
            for x in 0..<24 {
                let dx = min(x, 23 - x), dy = min(y, h - 1 - y)
                if dx == 0 && dy == 0 { continue }
                g[y][x] = dx == 0 || dy == 0 ? "O" : (y == 1 || x == 1) ? "h" : (y == h - 2 || x == 22) ? "s" : "i"
            }
        }
        for y in 3..<9 { g[y][24] = "O" }
        for y in 4..<8 { g[y][25] = "O"; g[y][24] = y < 6 ? "M" : "N" }
        let low = left <= 25
        let (top, mid, bot): (Character, Character, Character) = low ? ("r", "R", "q") : ("b", "B", "c")
        for k in 0..<4 {
            let f = quarterFill(left, k), rows = f > 0 ? max(1, Int((6 * f).rounded())) : 0
            for y in 3..<9 {
                for x in (3 + 5 * k)..<(6 + 5 * k) {
                    g[y][x] = y >= 9 - rows ? (y == 9 - rows ? top : y == 8 ? bot : mid) : (y == 3 ? "e" : "E")
                }
            }
        }
        if waiting { boltOver(&g, 10, 2) }
        return g.map { String($0) }
    }

    /// The weekly power bank's rows: a light is lit when its quarter is two thirds there, half lit from a third, and
    /// the first light is never dark while anything is left.
    static func bank(left: Double, waiting: Bool) -> [String] {
        let w = 22, h = 12
        var g = Array(repeating: Array(repeating: Character("."), count: w), count: h)
        for y in 0..<h {
            for x in 0..<w {
                let dx = min(x, w - 1 - x), dy = min(y, h - 1 - y)
                if dx + dy < 2 { continue }
                g[y][x] = dx == 0 || dy == 0 || dx + dy == 2 ? "O" : dy == 1 ? (y < h / 2 ? "l" : "k") : "L"
            }
        }
        for y in 2..<(h - 2) where g[y][1] == "L" { g[y][1] = "l" }
        for y in 4..<8 { g[y][2] = "M" }
        g[5][2] = "Z"; g[6][2] = "Z"
        let low = left <= 25
        for k in 0..<4 {
            let f = quarterFill(left, k), x0 = 6 + 4 * k
            let shown = f >= 1.0 / 3 || (k == 0 && left > 0), full = f >= 2.0 / 3
            for y in 4..<7 {
                for x in x0..<(x0 + 3) {
                    g[y][x] = !shown ? "D" : full ? (low ? "R" : "G") : (low ? "q" : "B")
                }
            }
            if shown && full { let glint: Character = low ? "r" : "g"; g[5][x0 + 1] = glint; g[4][x0] = glint }
        }
        if waiting { boltOver(&g, 9, 2) }
        return g.map { String($0) }
    }

    /// The picture for a window, as the band draws it: what is left, and a spent window empty under the bolt.
    static func forWindow(kind: String, used: Double?) -> [String]? {
        guard let used else { return nil }
        let left = max(0, 100 - used)
        switch kind {
        case "five_hour": return battery(left: left, waiting: left <= 0)
        case "seven_day": return bank(left: left, waiting: left <= 0)
        default: return nil
        }
    }

    /// quota.ts QUOTA_INK, the same colours by the same letters.
    static let ink: [Character: Int] = [
        "O": 0x5C2A1E, "h": 0xFFFDF8, "i": 0xF4ECE4, "s": 0xE0D1C6, "M": 0xF2EEEA, "N": 0xC9C2BC, "Z": 0x2E2E35,
        "b": 0x79B6E6, "B": 0x3A86C8, "c": 0x2A6399, "r": 0xF2A587, "R": 0xD97757, "q": 0xAE5539, "e": 0xA99282, "E": 0xCBB8AA,
        "Y": 0xD97757, "y": 0xAE5539, "l": 0x6A6A74, "L": 0x45454D, "k": 0x2E2E35, "D": 0x222227, "g": 0xF4FBFF, "G": 0x79B6E6,
    ]
    /// quota.ts OUTLINE_ON_DARK: the outline where it meets the outside, on a dark ground.
    static let outlineOnDark = 0xA07B6A

    /// Each painted art pixel: where it is and its colour, the outline lightened on a dark ground.
    static func cells(_ rows: [String], darkGround: Bool) -> [(x: Int, y: Int, rgb: Int)] {
        let grid = rows.map { Array($0) }
        func at(_ x: Int, _ y: Int) -> Character {
            guard y >= 0, y < grid.count, x >= 0, x < grid[y].count else { return "." }
            return grid[y][x]
        }
        var out: [(x: Int, y: Int, rgb: Int)] = []
        for (y, row) in grid.enumerated() {
            for (x, ch) in row.enumerated() {
                guard var rgb = ink[ch] else { continue }
                if darkGround && ch == "O" && [(1, 0), (-1, 0), (0, 1), (0, -1)].contains(where: { at(x + $0.0, y + $0.1) == "." }) {
                    rgb = outlineOnDark
                }
                out.append((x, y, rgb))
            }
        }
        return out
    }
}

/// One window the plugin reported (companion.ts `quota.rateLimits`): whole percents, the reset as Claude Code gave
/// it, and the pace the band warned with while the window runs hot.
struct QuotaWindow: Equatable {
    var kind: String
    var used: Double?
    var reset: Double?
    var pace: String?
    var hot = false

    /// The 5-hour and weekly windows, once each, as the Rust pet reads them (ui.rs Quota::parse).
    static func parse(_ value: Any?) -> [QuotaWindow]? {
        guard let object = value as? [String: Any], let rates = (object["rateLimits"] ?? object["windows"]) as? [Any] else { return nil }
        var seen = Set<String>(), windows: [QuotaWindow] = []
        for item in rates.prefix(8) {
            guard let w = item as? [String: Any], let kind = w["kind"] as? String,
                  ["five_hour", "seven_day"].contains(kind), seen.insert(kind).inserted else { continue }
            let used = ((w["percentUsed"] ?? w["usedPercentage"]) as? Double).flatMap { $0.isFinite ? min(100, max(0, $0)) : nil }
            let pace = (w["pace"] as? String).flatMap { $0.isEmpty ? nil : String($0.prefix(160)) }
            windows.append(QuotaWindow(kind: kind, used: used, reset: resetMilliseconds(w["resetsAt"] ?? w["resetAt"]),
                                       pace: pace, hot: w["hot"] as? Bool ?? false))
        }
        return windows.isEmpty ? nil : windows
    }

    /// A number of milliseconds, or an ISO 8601 time with or without its fraction.
    static func resetMilliseconds(_ value: Any?) -> Double? {
        if let number = value as? Double { return number.isFinite && (0...8.64e15).contains(number) ? number : nil }
        guard let text = value as? String, text.count <= 64 else { return nil }
        for options: ISO8601DateFormatter.Options in [[.withInternetDateTime, .withFractionalSeconds], [.withInternetDateTime]] {
            let parser = ISO8601DateFormatter(); parser.formatOptions = options
            if let date = parser.date(from: text) { return date.timeIntervalSince1970 * 1000 }
        }
        return nil
    }
}

/// The foot's words for one language, from the Rust pet's table; English when a language is missing.
struct QuotaWords: Equatable {
    var kinds: [String: String] = ["five_hour": "5-hour window", "seven_day": "7-day window"]
    var used = "{percent}% used"
    var resets = "resets {time}"
    var locale = "en-US"

    init() {}
    init(lang: String, table: [String: Any], languages: [[String: Any]]) {
        let own = (table[lang] ?? table["en"]) as? [String: Any] ?? [:]
        if let kinds = own["kinds"] as? [String: String] { self.kinds = kinds }
        if let used = own["used"] as? String { self.used = used }
        if let resets = own["resets"] as? String { self.resets = resets }
        let entry = languages.first { $0["code"] as? String == lang } ?? languages.first { $0["code"] as? String == "en" }
        if let locale = entry?["locale"] as? String { self.locale = locale }
    }

    /// The table copied into the app (companion-macos.sh), read once.
    static let bundled: (table: [String: Any], languages: [[String: Any]]) = {
        func read(_ name: String) -> Any? {
            guard let url = Bundle.main.url(forResource: name, withExtension: "json", subdirectory: "words"),
                  let data = try? Data(contentsOf: url) else { return nil }
            return try? JSONSerialization.jsonObject(with: data)
        }
        return ((read("quota") as? [String: Any]) ?? [:], (read("languages") as? [[String: Any]]) ?? [])
    }()

    /// The time a window resets, as the book writes a moment: the time today, else the day and the time
    /// (the Rust pet's locale::moment, from the same ICU patterns).
    func moment(_ ms: Double, now: Double, lang: String, calendar: Calendar = .current) -> String {
        let date = Date(timeIntervalSince1970: ms / 1000), today = Date(timeIntervalSince1970: now / 1000)
        func format(_ template: String) -> String {
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: locale)
            formatter.calendar = calendar
            formatter.timeZone = calendar.timeZone
            formatter.setLocalizedDateFormatFromTemplate(template)
            return formatter.string(from: date)
        }
        let time = format("jmm")
        if calendar.isDate(date, inSameDayAs: today) { return time }
        let sameYear = calendar.component(.year, from: date) == calendar.component(.year, from: today)
        return format(sameYear ? "MMMd" : "yMMMd") + (["zh", "zh-Hant", "ja"].contains(lang) ? "" : " ") + time
    }

    /// A foot row's clauses in order, as the Rust pet's announcement_parts: the window and how much is used, the
    /// pace while it runs hot, the reset. The first clause starts with the window's name, drawn bold.
    func parts(_ window: QuotaWindow, now: Double, lang: String, calendar: Calendar = .current) -> (name: String, parts: [String]) {
        let name = kinds[window.kind] ?? (window.kind == "five_hour" ? "5-hour" : "7-day")
        let used = window.used.map { self.used.replacingOccurrences(of: "{percent}", with: String(format: "%.0f", $0)) } ?? "—"
        var parts = [name + " " + used]
        if window.hot, let pace = window.pace { parts.append(pace) }
        if let reset = window.reset {
            parts.append(resets.replacingOccurrences(of: "{time}", with: moment(reset, now: now, lang: lang, calendar: calendar)))
        }
        return (name, parts)
    }
}

extension QuotaWindow {
    /// The menu's one line, as the Rust pet's Quota::narrow writes it: each window's short name and how much is used
    /// ("5h 42%, 7d 18%"), a hot window's pace after it.
    static func narrowLine(_ windows: [QuotaWindow], lang: String) -> String? {
        let table = QuotaWords.bundled.table
        guard let own = (table[lang] ?? table["en"]) as? [String: Any] else { return nil }
        let names = own["narrow"] as? [String: String] ?? [:]
        let usedTemplate = own["narrowUsed"] as? String
        let separator = ["zh", "zh-Hant"].contains(lang) ? "," : lang == "ja" ? "、" : ", "
        let spaced = ["fr", "de", "es-ES"].contains(lang)
        let parts = windows.map { window -> String in
            let name = names[window.kind] ?? (window.kind == "five_hour" ? "5h" : "7d")
            let value = window.used.map { used -> String in
                let rounded = String(format: "%.0f", used.rounded())
                if ["zh", "zh-Hant"].contains(lang), let usedTemplate { return usedTemplate.replacingOccurrences(of: "{p}", with: rounded) }
                return rounded + (spaced ? "\u{a0}%" : "%")
            } ?? "—"
            return name + " " + value + (window.hot ? window.pace.map { ", " + $0 } ?? "" : "")
        }
        return parts.isEmpty ? nil : parts.joined(separator: separator)
    }
}
