import Foundation

/// The DM thread while Talk is on (the plugin's dm.ts; the owner's cards of 10-17 late: one thread in the plugin and
/// on the pet, read or reply on either; unread marks; the system's notification, never while the screen is locked).
/// The record's `dm` as the Rust pet reads it (companion-rs/src/feed.rs Dm): her messages not read yet, the newest
/// that reached the closed thread, the newest twenty messages, lane B's words, the person's notification switch.
/// Foundation only, so tools/tests/companion-dm.py checks it on Linux too.
struct DmThread: Equatable {
    struct Line: Equatable {
        /// The person's own message; hers otherwise.
        var mine: Bool
        var text: String
    }
    struct Notice: Equatable {
        var id: String
        var at: Double
        var title: String
        var body: String
    }
    var unread = 0
    var notice: Notice?
    var thread: [Line] = []
    /// The thread's name (more.talk.label: «DMs», «小窗») and the field's placeholder (more.talk.placeholder).
    var label = ""
    var placeholder = ""
    var notify = true
    static let lines = 20

    init() {}
    init?(_ value: Any?) {
        guard let object = value as? [String: Any] else { return nil }
        func text(_ object: [String: Any]?, _ key: String, _ limit: Int) -> String? {
            guard let value = object?[key] as? String, value.count <= limit, !value.contains("\0") else { return nil }
            return value
        }
        if let n = object["unread"] as? Int, n >= 0 { unread = min(999, n) }
        if let raw = object["notice"] as? [String: Any], let id = text(raw, "id", 64), !id.isEmpty,
           let at = raw["at"] as? Double, at.isFinite, at > 0,
           let body = text(raw, "body", 400), !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            notice = Notice(id: id, at: at, title: text(raw, "title", 64) ?? "", body: body)
        }
        let lines = (object["thread"] as? [Any]) ?? []
        thread = lines.suffix(Self.lines).compactMap { item in
            guard let line = item as? [String: Any], let side = line["side"] as? String, side == "person" || side == "him",
                  let value = text(line, "text", 1000), !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
            return Line(mine: side == "person", text: value)
        }
        let words = object["words"] as? [String: Any]
        label = text(words, "label", 64) ?? ""
        placeholder = text(words, "placeholder", 128) ?? ""
        notify = object["notify"] as? Bool ?? true
    }
}

/// Her notices for the system: each once, while fresh (two minutes), and not while the thread is on screen; the app
/// also holds them while the screen is locked (the Rust pet's engine.rs take_dm_notice).
struct DmNotices {
    private(set) var last = ""
    static let fresh = 120_000.0
    mutating func take(_ dm: DmThread?, now: Double, threadVisible: Bool) -> DmThread.Notice? {
        guard let notice = dm?.notice, notice.id != last, (0...Self.fresh).contains(now - notice.at) else { return nil }
        last = notice.id
        return threadVisible ? nil : notice
    }
}

/// The thread's bubbles in the Activity window, oldest first, as the Rust pet lays them out (ui.rs dm_bubbles): hers
/// on the left, the person's on the right, at most `width` wide, one side's run close together, the thread at most
/// `maxHeight` tall with older messages giving way. `measure` gives a text's size wrapped at a width.
enum DmLayout {
    static let textSize = 12.5, bubbleWidth = 216.0, maxHeight = 300.0, padX = 10.0, padY = 6.0, gapSame = 3.0, gap = 9.0
    struct Bubble: Equatable {
        var index: Int
        var x: Double, y: Double, width: Double, height: Double
        var bottom: Double { y + height }
    }
    static func bubbles(_ thread: [DmThread.Line], left: Double, right: Double, top: Double,
                        measure: (String, Double) -> (width: Double, height: Double)) -> [Bubble] {
        let spacing = { (a: Bool, b: Bool) in a == b ? gapSame : gap }
        var sized: [(index: Int, width: Double, height: Double, mine: Bool)] = []
        var total = 0.0
        for (index, line) in thread.enumerated().reversed() {
            let size = measure(line.text, bubbleWidth - 2 * padX)
            let width = min(bubbleWidth, max(28, size.width.rounded(.up) + 2 * padX))
            let height = min(maxHeight, max(17, size.height.rounded(.up)) + 2 * padY)
            let gapBelow = sized.last.map { spacing($0.mine, line.mine) } ?? 0
            if !sized.isEmpty && total + gapBelow + height > maxHeight { break }
            total += gapBelow + height
            sized.append((index, width, height, line.mine))
        }
        var y = top
        var above: Bool?
        return sized.reversed().map { item in
            if let above { y += spacing(above, item.mine) }
            let bubble = Bubble(index: item.index, x: item.mine ? right - item.width : left, y: y, width: item.width, height: item.height)
            y += item.height
            above = item.mine
            return bubble
        }
    }
}
