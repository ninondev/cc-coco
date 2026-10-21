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
        /// From the menu's Actions: the same fluster three quick clicks bring.
        case burst
    }

    struct Reaction: Equatable {
        var key: String // pat, flustered, drag, drop, hold
        var frame: String
        var hold: Double // seconds the frame shows (a drag's lasts until the drop)
        var line: String? // nil: the line showing now stays
        var lineHold: Double
    }

    static let clickWindow = 1.5 // seconds in which clicks count together
    static let flusterAt = 3 // this many clicks inside the window fluster him
    static let lineGap = 1.2 // the same reaction again within this keeps its line
    static let urgent: Set<String> = ["waiting", "question", "wild", "error"]

    var tuning = CompanionTuning.Touch()

    private(set) var clicks: [Double] = []
    private(set) var lastKey: String?
    private(set) var lastLine: String?
    private(set) var lastLineAt = -Double.infinity
    private var lastByKey: [String: String] = [:]
    private(set) var lastRideAt = -Double.infinity

    struct RideLine: Equatable {
        var line: String
        var delayMs: Double
        var holdMs: Double
    }

    static func rideDefault(_ key: String) -> Double {
        switch key {
        case "cling.lineMinPeakPtPerS": return 2600
        case "cling.lineStopFraction": return 0.2
        case "cling.lineStopWithinMs": return 120
        case "cling.lineChance": return 0.5
        case "cling.lineCooldownMin": return 15
        case "cling.lineDelayMs": return 250
        case "cling.lineHoldMs": return 2600
        default: return 0
        }
    }

    /// Called once for the hard-stop event. Motion measures the smoothed peak and stop; this
    /// selector owns the coin, cooldown and text history, with no timer or pointer observation.
    mutating func ride(at now: Double, peakSpeed: Double, stopSpeed: Double, stopElapsedMs: Double,
                       mood: String, linesHidden: Bool, lines: [String: [String]],
                       chanceRandom: Double, pickRandom: Double, tuning: (String) -> Double = Self.rideDefault) -> RideLine? {
        guard now.isFinite, peakSpeed.isFinite, stopSpeed.isFinite, stopElapsedMs.isFinite,
              chanceRandom.isFinite, (0..<1).contains(chanceRandom), pickRandom.isFinite,
              !linesHidden, mood != "sleep", !Self.urgent.contains(mood),
              peakSpeed >= tuning("cling.lineMinPeakPtPerS"), stopSpeed >= 0,
              stopSpeed < peakSpeed * tuning("cling.lineStopFraction"),
              stopElapsedMs >= 0, stopElapsedMs <= tuning("cling.lineStopWithinMs"),
              now - lastRideAt >= tuning("cling.lineCooldownMin") * 60,
              chanceRandom < tuning("cling.lineChance"),
              let line = chooseLine(key: "ride", at: now, lines: lines, random: pickRandom) else { return nil }
        lastRideAt = now
        lastKey = "ride"
        return RideLine(line: line, delayMs: tuning("cling.lineDelayMs"), holdMs: tuning("cling.lineHoldMs"))
    }

    /// `random` is a number in 0..<1 (passed in so tests are exact).
    mutating func react(_ event: Event, at now: Double, mood: String, lines: [String: [String]], random: Double) -> Reaction {
        var key: String
        var frame: String
        var hold: Double
        switch event {
        // An Option-click is a click: its own reaction (Shiori peeking out) waits until after 1.0 (his 10-16 card).
        case .click:
            clicks = clicks.filter { now - $0 < tuning.burstWindowMs / 1000 } + [now]
            (key, frame, hold) = clicks.count >= tuning.burstCount ? ("flustered", "flustered", tuning.burstMs / 1000) : ("pat", "happy", tuning.patMs / 1000)
        case .dragStart:
            (key, frame, hold) = ("drag", "error", 600)
        case .drop:
            (key, frame, hold) = ("drop", "idle-blink", tuning.dropMs / 1000)
        case .longPress:
            (key, frame, hold) = ("hold", "refuse", tuning.hugHoldMs / 1000)
        case .burst:
            (key, frame, hold) = ("flustered", "flustered", tuning.burstMs / 1000)
        }
        var lineHold = tuning.lineHoldMs / 1000
        if Self.urgent.contains(mood) {
            if key != "drag" { hold = min(hold, tuning.urgentHoldMs / 1000) }
            lineHold = tuning.urgentLineMs / 1000
        }
        var line: String?
        if !(key == lastKey && now - lastLineAt < tuning.lineGapMs / 1000) {
            line = chooseLine(key: key, at: now, lines: lines, random: random)
        }
        lastKey = key
        return Reaction(key: key, frame: frame, hold: hold, line: line, lineHold: lineHold)
    }

    /// A line from one pool of his, with the same no-repeat rules as a touch's; nil when the pool is empty.
    mutating func pick(_ key: String, at now: Double, lines: [String: [String]], random: Double) -> String? {
        chooseLine(key: key, at: now, lines: lines, random: random)
    }

    private mutating func chooseLine(key: String, at now: Double, lines: [String: [String]], random: Double) -> String? {
        guard random.isFinite else { return nil }
        let options = lines[key] ?? []
        let lastEnding = lastLine.map(Self.ending)
        let fresh = options.filter { $0 != lastByKey[key] && $0 != lastLine && Self.ending($0) != lastEnding }
        let pool = fresh.isEmpty ? options.filter { $0 != lastLine } : fresh
        guard !pool.isEmpty else { return nil }
        let bounded = min(1, max(0, random))
        let pick = pool[min(pool.count - 1, Int(bounded * Double(pool.count)))]
        lastByKey[key] = pick
        lastLine = pick
        lastLineAt = now
        return pick
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
