import Foundation

// How he reacts when you touch him, as a small pure state machine (tested on its own; Pet.swift shows
// the result). Only frames he already has, and one short line in his voice from the feed.
//
//   one click            a head pat: he blushes (happy)
//   three quick clicks   flustered ("...i'm not a button.")
//   Option-click         Shiori peeks out (snake)
//   picking him up       startled (error), until you put him down
//   putting him down     he smooths his robe (eyes closed a moment)
//   a long press         he hugs his book (refuse: the book held up close)
//
// Lines never repeat twice in a row and never follow a line that ends the same way (each ends with a
// kaomoji or an emoji, the owner's style for these lines), and the same reaction repeated quickly
// keeps the line it has, so a burst of clicks does not flicker text. A state the band shows for a reason (waiting for you, the
// wild soul, an error) comes back fast: the reaction's face lasts under a second there.

struct Reactor {
    enum Event: Equatable {
        case click(option: Bool)
        case dragStart, drop, longPress
    }

    struct Reaction: Equatable {
        var key: String // pat, flustered, shiori, drag, drop, hold
        var frame: String
        var hold: Double // seconds the frame shows (a drag's lasts until the drop)
        var line: String? // nil: the line showing now stays
        var lineHold: Double
    }

    static let clickWindow = 1.5 // seconds in which clicks count together
    static let flusterAt = 3 // this many clicks inside the window fluster him
    static let lineGap = 1.2 // the same reaction again within this keeps its line
    static let urgent: Set<String> = ["waiting", "question", "wild", "error"]

    private(set) var clicks: [Double] = []
    private(set) var lastKey: String?
    private(set) var lastLine: String?
    private(set) var lastLineAt = -Double.infinity
    private var lastByKey: [String: String] = [:]

    /// `random` is a number in 0..<1 (passed in so tests are exact).
    mutating func react(_ event: Event, at now: Double, mood: String, lines: [String: [String]], random: Double) -> Reaction {
        var key: String
        var frame: String
        var hold: Double
        switch event {
        case .click(option: true):
            (key, frame, hold) = ("shiori", "snake", 2.2)
        case .click(option: false):
            clicks = clicks.filter { now - $0 < Self.clickWindow } + [now]
            (key, frame, hold) = clicks.count >= Self.flusterAt ? ("flustered", "flustered", 1.8) : ("pat", "happy", 1.4)
        case .dragStart:
            (key, frame, hold) = ("drag", "error", 600)
        case .drop:
            (key, frame, hold) = ("drop", "idle-blink", 1.0)
        case .longPress:
            (key, frame, hold) = ("hold", "refuse", 1.6)
        }
        var lineHold = 2.6
        if Self.urgent.contains(mood) {
            if key != "drag" { hold = min(hold, 0.9) }
            lineHold = 2.0
        }
        var line: String?
        if !(key == lastKey && now - lastLineAt < Self.lineGap) {
            let options = lines[key] ?? []
            let lastEnding = lastLine.map(Self.ending)
            let fresh = options.filter { $0 != lastByKey[key] && $0 != lastLine && Self.ending($0) != lastEnding }
            let pool = fresh.isEmpty ? options.filter { $0 != lastLine } : fresh
            if !pool.isEmpty {
                let pick = pool[min(pool.count - 1, max(0, Int(random * Double(pool.count))))]
                line = pick
                lastByKey[key] = pick
                lastLine = pick
                lastLineAt = now
            }
        }
        lastKey = key
        return Reaction(key: key, frame: frame, hold: hold, line: line, lineHold: lineHold)
    }

    /// How a line ends, for telling endings apart: its closing kaomoji or emoji, compared without
    /// brackets or spaces, so (>_<) and >_< count as the same face.
    static func ending(_ line: String) -> String {
        let tail: Substring
        if let last = line.last, last == ")" || last == "）", let open = line.lastIndex(where: { $0 == "(" || $0 == "（" }) {
            tail = line[open...]
        } else if let cut = line.lastIndex(where: { $0 == "\n" || $0 == " " || isCJK($0) }) {
            tail = line[line.index(after: cut)...] // after the last line break, space (English) or CJK character
        } else {
            tail = line[...]
        }
        let face = tail.filter { !"()（） ".contains($0) }
        return face.isEmpty ? String(line.suffix(1)) : face
    }

    // Han, kana, Hangul and full-width forms; not the half-width ones kaomoji use (｡ ･ ﾟ).
    private static func isCJK(_ character: Character) -> Bool {
        character.unicodeScalars.contains { scalar in
            switch scalar.value {
            case 0x2E80...0x9FFF, 0xAC00...0xD7AF, 0xF900...0xFAFF, 0xFF01...0xFF60: true
            default: false
            }
        }
    }
}
