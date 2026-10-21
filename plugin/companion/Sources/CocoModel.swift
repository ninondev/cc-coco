import Foundation

// Coco on the Mac companion: their clips (assets/coco/band-A.json and band-B.json, pictures 256 px tall) played
// the way the Windows and Linux companion plays them (plugin/companion-rs/src/coco.rs, which follows
// plugin/hooks-source/coco-motion.ts). This file holds everything but the drawing: which action to play, the data,
// how an action is joined to the drawing before it, the tracks, the blinks, and each element's place on the
// canvas. CocoRender.swift draws a CocoFrame with Core Graphics. Foundation only, so it also builds on Linux,
// where tools/companion-swift/coco-check.sh compares its frames with the Rust player's pixels.

enum CocoOutfit: Int {
    case a = 0, b = 1
    var other: CocoOutfit { self == .a ? .b : .a }
    var letter: String { self == .a ? "A" : "B" }
    static func parse(_ text: String?) -> CocoOutfit? {
        switch text {
        case "A": return .a
        case "B": return .b
        default: return nil
        }
    }
}

// ---------------------------------------------------------------- which action

enum CocoTouch { case poke, pat, burst, wink }
enum CocoShed { case begin, end }

struct CocoInput {
    var mood: String
    var pose: String? = nil
    var touch: CocoTouch? = nil
    var shed: CocoShed? = nil
    var act: String? = nil
    var night = false
    var working = false
}

enum CocoChoice {
    static let actions: [String] = [
        "idle", "wait", "think", "watch", "petted", "hood", "hello", "peek", "doze", "night", "pack",
        "serious", "shell", "work", "done", "search", "read", "lookup", "plan", "run", "coffee",
        "helper", "praised", "pass", "firsttry", "out", "error", "wild", "fixed", "teapot", "breath",
        "nap", "catch",
    ]
    /// The companion's frame rate while an action or a loop moves.
    static let frameMs: UInt64 = 33

    static func poseAction(_ pose: String) -> String? {
        switch pose {
        case "search": return "search"
        case "scroll": return "read"
        case "spyglass": return "lookup"
        case "plan": return "plan"
        case "run": return "run"
        case "helper": return "helper"
        case "tea": return "coffee"
        case "cheer": return "fixed"
        case "waiting": return "wait"
        case "look-up": return "watch"
        default: return nil
        }
    }
    static func moodAction(_ mood: String) -> String? {
        switch mood {
        case "idle": return "idle"
        case "think": return "think"
        case "work": return "work"
        case "happy": return "done"
        case "waiting", "question": return "wait"
        case "error": return "error"
        case "wild": return "wild"
        case "refuse": return "teapot"
        case "flustered": return "praised"
        case "wave": return "hello"
        case "snake", "peek": return "peek"
        case "omen": return "run"
        default: return nil
        }
    }
    /// A touch first, then an explicit moment, the shell change, a tool pose, then the mood.
    static func action(_ input: CocoInput) -> String {
        if input.touch == .burst { return "hood" }
        if input.touch != nil { return "petted" }
        if let act = input.act { return act }
        switch input.shed {
        case .begin?: return "pack"
        case .end?: return "shell"
        case nil: break
        }
        if let pose = input.pose, let action = poseAction(pose) { return action }
        if input.mood == "sleep" { return input.night ? "night" : "nap" }
        return moodAction(input.mood) ?? (input.working ? "think" : "idle")
    }
    /// What Coco settles into after an action played once.
    static func base(_ input: CocoInput) -> String {
        if input.mood == "sleep" { return input.night ? "night" : "nap" }
        if input.mood == "waiting" || input.mood == "question" { return "wait" }
        if input.working { return input.mood == "work" ? "work" : "think" }
        return "idle"
    }
    /// Late evening and the small hours, while Coco is not working: the lamp is on.
    static func isNight(hour: Int?, mood: String, working: Bool) -> Bool {
        guard let hour = hour else { return false }
        return !(5..<23).contains(hour) && !working && (mood == "idle" || mood == "sleep")
    }
    static func localHour(_ date: Date = Date()) -> Int {
        Calendar.current.component(.hour, from: date)
    }
}

/// What the state wants Coco to play: the outfit whose data holds the action (the shell change plays in the outfit
/// they are leaving), the action, what it settles into, and the clock of a one-off moment.
struct CocoWanted: Equatable {
    var outfit: CocoOutfit
    var action: String
    var base: String
    var act: UInt64?
    /// `outfit` is the one Coco wears now; `actAt` is when the moment in `input.act` happened.
    init(_ input: CocoInput, outfit: CocoOutfit, actAt: UInt64? = nil) {
        let action = CocoChoice.action(input)
        self.outfit = action == "shell" ? outfit.other : outfit
        self.action = action
        self.base = CocoChoice.base(input)
        self.act = input.act == action ? actAt : nil
    }
}

// ---------------------------------------------------------------- data

enum CocoError: Error, CustomStringConvertible {
    case data(String)
    var description: String {
        switch self {
        case .data(let text): return text
        }
    }
}

/// A JSON number as Double, whichever way Foundation hands it over.
private func number(_ value: Any?) -> Double? {
    if let v = value as? Double { return v }
    if let v = value as? Int { return Double(v) }
    if let v = value as? NSNumber { return v.doubleValue }
    return nil
}
private func numbers(_ value: Any?, count: Int? = nil) -> [Double]? {
    guard let list = value as? [Any] else { return nil }
    var out: [Double] = []
    for item in list {
        guard let v = number(item), v.isFinite else { return nil }
        out.append(v)
    }
    if let count = count, out.count != count { return nil }
    return out
}

/// [[t s, value...], ...], linear in between; a single key is constant.
struct CocoTrack {
    var keys: [(Double, Double, Double)]
    var width: Int

    init?(json: Any?) {
        guard let rows = json as? [Any], let first = rows.first as? [Any] else { return nil }
        let width = first.count - 1
        guard (1...2).contains(width) else { return nil }
        var keys: [(Double, Double, Double)] = []
        keys.reserveCapacity(rows.count)
        for row in rows {
            guard let values = numbers(row, count: width + 1) else { return nil }
            keys.append((values[0], values[1], width == 2 ? values[2] : 0))
        }
        for i in keys.indices.dropFirst() where keys[i].0 < keys[i - 1].0 { return nil }
        self.keys = keys
        self.width = width
    }
    init(keys: [(Double, Double, Double)], width: Int) {
        self.keys = keys
        self.width = width
    }
    static func still(_ values: [Double]) -> CocoTrack {
        CocoTrack(keys: [(0, values[0], values.count > 1 ? values[1] : 0)], width: values.count)
    }
    var first: (Double, Double) { (keys[0].1, keys[0].2) }
    /// The value at t seconds: held before the first key and after the last.
    func sample(_ t: Double) -> (Double, Double) {
        if keys.count == 1 || t <= keys[0].0 { return first }
        for i in 1..<keys.count {
            let b = keys[i]
            if t <= b.0 {
                let a = keys[i - 1]
                let u = (t - a.0) / max(b.0 - a.0, 1e-9)
                return (a.1 + u * (b.1 - a.1), a.2 + u * (b.2 - a.2))
            }
        }
        let last = keys[keys.count - 1]
        return (last.1, last.2)
    }
}

struct CocoElement {
    var src: String
    var origin: (Double, Double)
    var clipLocal: [Double]?
    var clipFinal: [Double]?
    var a: CocoTrack
    var t: CocoTrack
    var r: CocoTrack
    var s: CocoTrack

    init?(json: Any?) {
        guard let object = json as? [String: Any], let src = object["src"] as? String,
              let origin = numbers(object["origin"], count: 2),
              let a = CocoTrack(json: object["a"]), let t = CocoTrack(json: object["t"]),
              let r = CocoTrack(json: object["r"]), let s = CocoTrack(json: object["s"]) else { return nil }
        var clips: [[Double]?] = []
        for key in ["clip_local", "clip_final"] {
            let raw = object[key]
            if raw == nil || raw is NSNull {
                clips.append(nil)
            } else {
                guard let rect = numbers(raw, count: 4) else { return nil }
                clips.append(rect)
            }
        }
        self.init(src: src, origin: (origin[0], origin[1]), clipLocal: clips[0], clipFinal: clips[1], a: a, t: t, r: r, s: s)
    }
    init(src: String, origin: (Double, Double), clipLocal: [Double]?, clipFinal: [Double]?, a: CocoTrack, t: CocoTrack, r: CocoTrack, s: CocoTrack) {
        self.src = src
        self.origin = origin
        self.clipLocal = clipLocal
        self.clipFinal = clipFinal
        self.a = a
        self.t = t
        self.r = r
        self.s = s
    }
}

final class CocoPart {
    let seconds: Double
    let elements: [CocoElement]
    init(seconds: Double, elements: [CocoElement]) {
        self.seconds = seconds
        self.elements = elements
    }
    convenience init?(json: Any?) {
        guard let object = json as? [String: Any], let seconds = number(object["seconds"]),
              let list = object["elements"] as? [Any] else { return nil }
        var elements: [CocoElement] = []
        for item in list {
            guard let element = CocoElement(json: item) else { return nil }
            elements.append(element)
        }
        self.init(seconds: seconds, elements: elements)
    }
}

enum CocoEntryKind: String { case sink, hop, cut }
struct CocoEntry {
    var kind: CocoEntryKind
    var depth: Double
    var h: Double
    static let sinkCut = CocoEntry(kind: .sink, depth: 0.045, h: 8)
}
struct CocoAction {
    var entry: CocoEntry
    var body: CocoPart
    var looped: CocoPart?
}
struct CocoBand {
    var canvas: (Double, Double)
    var sink: Double
    var hop: (Double, Double)
    var actions: [String: CocoAction]
}

/// The pictures as PNG bytes: `<src>`, its lids `<src>#half` and `<src>#closed`, and the worn pair `<src>#socks`,
/// with the boxes the lids and the socks sit in.
final class CocoBank {
    var pictures: [String: Data] = [:]
    var eyes: [String: [Double]] = [:]
    var socks: [String: [Double]] = [:]
    /// Bumped when a picture changes (another pair of socks), so a drawing cache knows.
    var revision = 0
}

private let maxDataBytes = 16 * 1024 * 1024

private func readJSON(_ url: URL) throws -> [String: Any] {
    let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.intValue ?? 0
    if size > maxDataBytes { throw CocoError.data("coco data exceeds 16 MiB") }
    let data = try Data(contentsOf: url)
    guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        throw CocoError.data("coco data is not an object")
    }
    return object
}
private func checkPart(_ part: CocoPart, _ images: [String: Any]) throws {
    if !(part.seconds.isFinite && part.seconds > 0) { throw CocoError.data("coco part without a length") }
    for e in part.elements {
        if images[e.src] == nil { throw CocoError.data("coco data lacks \(e.src)") }
        if [e.a.width, e.r.width, e.t.width, e.s.width] != [1, 1, 2, 2] {
            throw CocoError.data("coco track of the wrong width")
        }
    }
}
/// The PNG bytes behind a picture's text: `@offset:length` into the file's sidecar (X.bin beside X.json, written by
/// tools/art/coco-band-build.py: a quarter smaller than base64), or base64 in data written before it (coco.rs picture).
private func picture(_ value: Any?, _ sidecar: Data) -> Data? {
    guard let text = value as? String else { return nil }
    guard text.hasPrefix("@") else { return Data(base64Encoded: text, options: .ignoreUnknownCharacters) }
    let parts = text.dropFirst().split(separator: ":", omittingEmptySubsequences: false)
    guard parts.count == 2, let offset = Int(parts[0]), let length = Int(parts[1]), offset >= 0, length >= 0,
          offset <= sidecar.count - length else { return nil }
    let start = sidecar.startIndex + offset
    return sidecar.subdata(in: start..<start + length)
}
/// The sidecar of a band or sock file, empty when there is none.
private func sidecar(_ json: URL) throws -> Data {
    let url = json.deletingPathExtension().appendingPathExtension("bin")
    guard FileManager.default.fileExists(atPath: url.path) else { return Data() }
    let size = (try FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.intValue ?? 0
    if size > 16 * 1024 * 1024 { throw CocoError.data("coco pictures exceed 16 MiB") }
    return try Data(contentsOf: url)
}
private func readBand(_ url: URL, outfit: CocoOutfit, bank: CocoBank) throws -> CocoBand {
    let raw = try readJSON(url)
    if CocoOutfit.parse(raw["outfit"] as? String) != outfit { throw CocoError.data("coco data is for the other outfit") }
    let pictures = try sidecar(url)
    guard let canvas = numbers(raw["canvas"], count: 2), canvas.allSatisfy({ $0 > 0 }),
          let sink = number(raw["sink"]), sink.isFinite, let hop = numbers(raw["hop"], count: 2) else {
        throw CocoError.data("invalid coco canvas")
    }
    let rawActions = raw["actions"] as? [String: Any] ?? [:]
    let images = raw["images"] as? [String: Any] ?? [:]
    var actions: [String: CocoAction] = [:]
    for (key, value) in rawActions {
        guard let object = value as? [String: Any], let entryObject = object["entry"] as? [String: Any],
              let kindText = entryObject["kind"] as? String, let kind = CocoEntryKind(rawValue: kindText),
              let depth = number(entryObject["depth"]), let h = number(entryObject["h"]),
              let body = CocoPart(json: object["body"]) else {
            throw CocoError.data("coco action \(key) is malformed")
        }
        var looped: CocoPart? = nil
        if let rawLoop = object["loop"], !(rawLoop is NSNull) {
            guard let part = CocoPart(json: rawLoop) else { throw CocoError.data("coco loop \(key) is malformed") }
            looped = part
        }
        actions[key] = CocoAction(entry: CocoEntry(kind: kind, depth: depth, h: h), body: body, looped: looped)
    }
    for key in CocoChoice.actions {
        guard let action = actions[key] else { throw CocoError.data("coco data lacks \(key)") }
        try checkPart(action.body, images)
        if let part = action.looped { try checkPart(part, images) }
    }
    for (src, text) in images where bank.pictures[src] == nil {
        guard let png = picture(text, pictures) else { throw CocoError.data("coco picture is unreadable") }
        bank.pictures[src] = png
    }
    for (src, value) in raw["eyes"] as? [String: Any] ?? [:] {
        guard let eyes = value as? [String: Any], let area = numbers(eyes["box"], count: 4),
              let half = picture(eyes["half"], pictures), let closed = picture(eyes["closed"], pictures) else { continue }
        if bank.pictures[src + "#half"] == nil { bank.pictures[src + "#half"] = half }
        if bank.pictures[src + "#closed"] == nil { bank.pictures[src + "#closed"] = closed }
        if bank.eyes[src] == nil { bank.eyes[src] = area }
    }
    return CocoBand(canvas: (canvas[0], canvas[1]), sink: sink, hop: (hop[0], hop[1]), actions: actions)
}

// ---------------------------------------------------------------- geometry

/// A 2-D affine map, x' = a x + c y + e, y' = b x + d y + f (Core Graphics' order too).
struct CocoAffine: Equatable {
    var a, b, c, d, e, f: Double
    static let identity = CocoAffine.scale(1, 1)
    static func scale(_ x: Double, _ y: Double) -> CocoAffine { CocoAffine(a: x, b: 0, c: 0, d: y, e: 0, f: 0) }
    static func translate(_ x: Double, _ y: Double) -> CocoAffine { CocoAffine(a: 1, b: 0, c: 0, d: 1, e: x, f: y) }
    static func rotate(_ degrees: Double) -> CocoAffine {
        let r = degrees * .pi / 180
        return CocoAffine(a: cos(r), b: sin(r), c: -sin(r), d: cos(r), e: 0, f: 0)
    }
    /// This, with `inner` applied to a point first.
    func then(_ inner: CocoAffine) -> CocoAffine {
        CocoAffine(a: a * inner.a + c * inner.b, b: b * inner.a + d * inner.b,
                   c: a * inner.c + c * inner.d, d: b * inner.c + d * inner.d,
                   e: a * inner.e + c * inner.f + e, f: b * inner.e + d * inner.f + f)
    }
    /// The same transform, taken about the point (x, y).
    func about(_ x: Double, _ y: Double) -> CocoAffine {
        CocoAffine.translate(x, y).then(self).then(.translate(-x, -y))
    }
    func apply(_ x: Double, _ y: Double) -> (Double, Double) { (a * x + c * y + e, b * x + d * y + f) }
    var inverted: CocoAffine? {
        let det = a * d - b * c
        guard abs(det) > 1e-12 else { return nil }
        return CocoAffine(a: d / det, b: -b / det, c: -c / det, d: a / det,
                          e: (c * f - d * e) / det, f: (b * e - a * f) / det)
    }
}

/// Open clip edges are written as +-1e4; a smaller number does the same on any canvas.
let cocoOpenEdge = 2000.0
private func isOpen(_ v: Double) -> Bool { abs(v) >= 9999 }
/// A clip of four open edges clips nothing.
func cocoClipIsOpen(_ rect: [Double]?) -> Bool { rect.map { $0.allSatisfy(isOpen) } ?? true }
/// A local clip that splits their picture at one height (the two halves breathe apart) reaches one device pixel past
/// the line, so the two halves' anti-aliased edges overlap instead of leaving a see-through row between them.
func cocoOverlapSplit(_ rect: [Double], space: CocoAffine) -> [Double] {
    if !(isOpen(rect[0]) && isOpen(rect[2])) || isOpen(rect[1]) == isOpen(rect[3]) { return rect }
    let pixel = 1 / max((space.c * space.c + space.d * space.d).squareRoot(), 1e-6)
    var out = rect
    if isOpen(out[1]) { out[3] += pixel } else { out[1] -= pixel }
    return out
}

// ---------------------------------------------------------------- playing

struct CocoSegment {
    var part: CocoPart
    var looping: Bool
}

/// One picture on the companion: an action, the clock it started at, and the drawing it left (joined with a dip).
/// once: played through and then into the base even if the action has a loop of its own (a moment, not a state).
struct CocoPlay {
    var outfit: CocoOutfit
    var action: String
    var base: String
    var at: UInt64
    var once: Bool
    var from: [CocoElement]
    var segments: [CocoSegment]
    /// How long before the last (looping) segment begins.
    var finiteSeconds: Double {
        var total = 0.0
        for (i, seg) in segments.enumerated() where !(seg.looping && i + 1 == segments.count) { total += seg.part.seconds }
        return total
    }
}

/// The segment playing t seconds in, and how far into it.
func cocoLocate(_ list: [CocoSegment], _ t: Double) -> (Int, Double)? {
    var start = 0.0
    for (i, seg) in list.enumerated() {
        let last = i + 1 == list.count
        if t < start + seg.part.seconds || last {
            var u = t - start
            if seg.looping && last {
                u = u - seg.part.seconds * (u / seg.part.seconds).rounded(.down)
            }
            return (i, min(max(u, 0), seg.part.seconds))
        }
        start += seg.part.seconds
    }
    return nil
}
/// The elements drawn at t seconds into a list of segments, frozen at their values then.
func cocoDrawnAt(_ list: [CocoSegment], _ t: Double) -> [CocoElement] {
    guard let (i, u) = cocoLocate(list, t) else { return [] }
    return list[i].part.elements.compactMap { e in
        let a = e.a.sample(u).0
        guard a >= 0.01 else { return nil }
        let t = e.t.sample(u), s = e.s.sample(u)
        return CocoElement(src: e.src, origin: e.origin, clipLocal: e.clipLocal, clipFinal: e.clipFinal,
                           a: .still([a]), t: .still([t.0, t.1]), r: .still([e.r.sample(u).0]), s: .still([s.0, s.1]))
    }
}
private func ease(_ u: Double) -> Double {
    let x = min(max(u, 0), 1)
    return x * x * (3 - 2 * x)
}
/// The dip (or the crouch and rise) on the drawing they leave, before the swap.
func cocoJoin(_ from: [CocoElement], entry: CocoEntry, band: CocoBand) -> CocoPart {
    let hop = entry.kind == .hop
    let seconds = hop ? band.hop.0 + band.hop.1 : band.sink
    let steps = 8
    let elements: [CocoElement] = from.map { e in
        let a = e.a.first.0
        let (tx, ty) = e.t.first
        let (sx, sy) = e.s.first
        let top = e.clipLocal.map { $0[3] < 1e4 } ?? false
        let bottom = e.clipLocal.map { $0[1] > -1e4 } ?? false
        var t: [(Double, Double, Double)] = [], s: [(Double, Double, Double)] = []
        for k in 0...steps {
            let at = seconds * Double(k) / Double(steps)
            var px: Double, py: Double, dy = 0.0
            if hop {
                let (crouch, rise) = band.hop
                if at <= crouch {
                    py = 1 - 0.05 * ease(at / crouch)
                    px = 1 + 0.5 * (1 - py)
                } else {
                    let u = ease((at - crouch) / rise)
                    py = 1 + 0.04 * u
                    px = 1 - 0.02 * u
                    dy = -entry.h * u
                }
            } else {
                py = 1 - entry.depth * ease(at / seconds)
                px = 1 + 0.5 * (1 - py)
            }
            if bottom {
                px = 1
                py = 1
            } else if top {
                px = 1
            }
            t.append((at, tx, ty + dy))
            s.append((at, sx * px, sy * py))
        }
        return CocoElement(src: e.src, origin: e.origin, clipLocal: e.clipLocal, clipFinal: e.clipFinal,
                           a: CocoTrack(keys: [(0, a, 0), (seconds, a, 0)], width: 1),
                           t: CocoTrack(keys: t, width: 2), r: e.r, s: CocoTrack(keys: s, width: 2))
    }
    return CocoPart(seconds: seconds, elements: elements)
}

/// A blink cycle is one minute; the same for every drawing, so a blink shows only on the frame that is drawn.
let cocoBlinkCycle = 61.0
/// Blinks while Coco holds still, timed like a person's (a median of 5 s, most between 2 and 12, now and then a
/// double blink). Half shut 33 ms, shut 130 ms, half open 50 ms.
func cocoBlinkTimes() -> [Double] {
    var seed: UInt32 = 7
    func random() -> Double {
        seed ^= seed << 13
        seed ^= seed >> 17
        seed ^= seed << 5
        return Double(seed) / 4294967296
    }
    var t = 2.2, out: [Double] = []
    while t < cocoBlinkCycle - 1 {
        out.append(t)
        if random() < 1.0 / 12 && t + 0.6 < cocoBlinkCycle - 1 {
            out.append(t + 0.26 + 0.04 * random())
        }
        let radius = (-2 * log(max(random(), 1e-9))).squareRoot()
        let normal = radius * cos(2 * Double.pi * random())
        t += min(max(5 * exp(0.54 * normal), 2), 12)
    }
    return out
}
enum CocoLids { case open, half, closed }
func cocoLidsAt(_ blinks: [Double], _ cycleSeconds: Double) -> CocoLids {
    let t = cycleSeconds - cocoBlinkCycle * (cycleSeconds / cocoBlinkCycle).rounded(.down)
    guard let b = blinks.last(where: { $0 <= t }) else { return .open }
    let since = t - b
    if since < 0.033 || (since >= 0.163 && since < 0.213) { return .half }
    if since >= 0.033 && since < 0.163 { return .closed }
    return .open
}

// ---------------------------------------------------------------- a frame to draw

/// One element as Core Graphics draws it, in the output's pixels (y down): the final clip in `canvas` space, then
/// opacity and translate (`moved`), the local clip in `moved` space, rotate and scale about the origin (`placed`),
/// and the picture stretched over the whole canvas. The lids and the worn socks go at their boxes in `placed`.
struct CocoDraw {
    var src: String
    var opacity: Double
    var canvas: CocoAffine
    var moved: CocoAffine
    var placed: CocoAffine
    var clipFinal: [Double]?
    var clipLocal: [Double]?
    /// "<src>#half" or "<src>#closed", and the eye box it fills
    var lids: (key: String, box: [Double])?
    /// "<src>#socks", and the box it fills
    var socks: (key: String, box: [Double])?
}
struct CocoFrame {
    var width: Int
    var height: Int
    /// the data canvas (width, height); a picture is stretched over all of it
    var canvas: (Double, Double)
    var draws: [CocoDraw]
}

final class CocoPlayer {
    private let bands: [CocoBand]
    let bank: CocoBank
    private let folder: URL
    private(set) var worn: String?
    private let blinks = cocoBlinkTimes()
    private var play: CocoPlay?
    /// Whether the last picture was drawn moving: what a new action leaves is that picture.
    private var runs = true

    /// `folder` holds band-A.json and band-B.json (and the sock files).
    init(folder: URL) throws {
        let bank = CocoBank()
        let a = try readBand(folder.appendingPathComponent("band-A.json"), outfit: .a, bank: bank)
        let b = try readBand(folder.appendingPathComponent("band-B.json"), outfit: .b, bank: bank)
        self.bands = [a, b]
        self.bank = bank
        self.folder = folder
    }

    /// The pair of socks Coco wears: nil is their own (drawn in the pictures), else both outfits' patches are read
    /// from socks-A-<pair>.json and socks-B-<pair>.json. A pair that fails to read leaves their own on.
    func wear(_ pair: String?) throws {
        if worn == pair { return }
        for key in bank.pictures.keys where key.hasSuffix("#socks") { bank.pictures[key] = nil }
        bank.socks = [:]
        bank.revision += 1
        worn = nil
        guard let pair = pair else { return }
        guard (2...24).contains(pair.utf8.count), pair.utf8.allSatisfy({ $0 >= 97 && $0 <= 122 }) else {
            throw CocoError.data("invalid sock pair")
        }
        var patches: [(String, [Double], Data)] = []
        for outfit in [CocoOutfit.a, .b] {
            let url = folder.appendingPathComponent("socks-\(outfit.letter)-\(pair).json")
            let raw = try readJSON(url)
            if CocoOutfit.parse(raw["outfit"] as? String) != outfit || raw["pair"] as? String != pair {
                throw CocoError.data("sock data is for another outfit or pair")
            }
            let pictures = try sidecar(url)
            for (src, value) in raw["socks"] as? [String: Any] ?? [:] {
                guard let patch = value as? [String: Any], let area = numbers(patch["box"], count: 4) else {
                    throw CocoError.data("invalid sock patch")
                }
                guard let png = picture(patch["img"], pictures) else { throw CocoError.data("sock patch is unreadable") }
                patches.append((src, area, png))
            }
        }
        for (src, area, png) in patches {
            if bank.socks[src] == nil { bank.socks[src] = area }
            if bank.pictures[src + "#socks"] == nil { bank.pictures[src + "#socks"] = png }
        }
        worn = pair
    }

    var current: (outfit: CocoOutfit, action: String, base: String)? { play.map { ($0.outfit, $0.action, $0.base) } }
    /// How long an action plays before it holds or hands over to its base.
    func bodySeconds(_ outfit: CocoOutfit, _ action: String) -> Double {
        bands[outfit.rawValue].actions[action]?.body.seconds ?? 0
    }
    /// The canvas the pictures are drawn on, in the data's own units (width, height).
    var canvas: (Double, Double) { bands[0].canvas }
    /// The size of the picture drawn `height` pixels tall.
    func dimensions(_ height: Int) -> (Int, Int) {
        let (w, h) = canvas
        let height = max(height, 1)
        return (max(Int((Double(height) * w / h - 1e-9).rounded(.up)), 1), height)
    }

    private func segments(_ outfit: CocoOutfit, _ action: String, _ base: String, once: Bool, from: [CocoElement]) -> [CocoSegment] {
        let data = bands[outfit.rawValue]
        guard let act = data.actions[action] else { return [] }
        var out: [CocoSegment] = []
        if !from.isEmpty && act.entry.kind != .cut {
            out.append(CocoSegment(part: cocoJoin(from, entry: act.entry, band: data), looping: false))
        }
        out.append(CocoSegment(part: act.body, looping: false))
        if let part = act.looped, !once {
            out.append(CocoSegment(part: part, looping: true))
        } else {
            // played once, then into the base; the shell change ends in the other hoodie, so its base is that one's
            let next = action == "shell" ? bands[outfit.other.rawValue] : data
            guard let to = next.actions[base] ?? next.actions["idle"] else { return out }
            let end = cocoDrawnAt([CocoSegment(part: act.body, looping: false)], act.body.seconds - 1e-3)
            if !end.isEmpty {
                let entry = to.entry.kind == .cut ? CocoEntry.sinkCut : to.entry
                out.append(CocoSegment(part: cocoJoin(end, entry: entry, band: next), looping: false))
            }
            out.append(CocoSegment(part: to.looped ?? to.body, looping: true))
        }
        return out
    }
    private static func elapsed(_ play: CocoPlay, _ now: UInt64) -> Double {
        Double(now > play.at ? now - play.at : 0) / 1000
    }
    /// The time into the play that is on screen. When nothing moves Coco stands in the pose the play settles into:
    /// the start of its last loop.
    private static func shownSeconds(_ play: CocoPlay, _ now: UInt64, _ runs: Bool) -> Double {
        runs ? elapsed(play, now) : play.finiteSeconds
    }

    /// A new play. The same action keeps its clock. An action played once goes on into its base by itself, so the
    /// base it was going to coming back keeps that picture (played through, then held); any other state, or a new
    /// moment, starts now from whatever was drawn.
    private func next(_ previous: CocoPlay?, _ want: CocoWanted, _ now: UInt64, _ runs: Bool) -> CocoPlay {
        let once = want.act != nil
        if let prev = previous {
            let same = once ? (prev.once && prev.at == want.act) : !prev.once
            if prev.outfit == want.outfit && prev.action == want.action && same {
                if prev.base == want.base { return prev }
                var rebased = prev
                rebased.base = want.base
                rebased.segments = segments(rebased.outfit, rebased.action, rebased.base, once: rebased.once, from: rebased.from)
                return rebased
            }
            if let was = bands[prev.outfit.rawValue].actions[prev.action], prev.once || was.looped == nil,
               !once, want.action == prev.base {
                let into = prev.action == "shell" ? prev.outfit.other : prev.outfit
                if want.outfit == into { return prev }
            }
        }
        let from = previous.map { cocoDrawnAt($0.segments, CocoPlayer.shownSeconds($0, now, runs)) } ?? []
        let at = want.act.map { min(now, $0) } ?? now
        return CocoPlay(outfit: want.outfit, action: want.action, base: want.base, at: at, once: once, from: from,
                        segments: segments(want.outfit, want.action, want.base, once: once, from: from))
    }
    /// What Coco plays from `now` on. `runs`: whether they move; when they do not (asleep, carried) they stand in
    /// the pose their action settles into.
    func update(_ want: CocoWanted, now: UInt64, runs: Bool) {
        // what they leave is what was on screen, which the flag of the picture before this one decided
        play = next(play, want, now, self.runs)
        self.runs = runs
    }

    /// The pose Coco is drawn in when nothing moves: the loop's first, or the body's last.
    func still(_ outfit: CocoOutfit, _ action: String) -> [CocoElement] {
        guard let act = bands[outfit.rawValue].actions[action] else { return [] }
        let part = act.looped ?? act.body
        let at = act.looped != nil ? 0 : part.seconds - 1e-3
        return cocoDrawnAt([CocoSegment(part: part, looping: false)], at)
    }

    /// The frame for `now`, `height` pixels tall. Reduced motion: only the pose, drawn still.
    func frame(now: UInt64, height: Int, reduced: Bool, runs: Bool) -> CocoFrame? {
        guard let play = play else { return nil }
        let band = bands[play.outfit.rawValue]
        if reduced {
            return paint(band, still(play.outfit, play.action), at: 0, height: height, lids: .open)
        }
        guard let (index, u) = cocoLocate(play.segments, CocoPlayer.shownSeconds(play, now, runs)) else { return nil }
        let segment = play.segments[index]
        let blinking = segment.looping && index + 1 == play.segments.count && runs
        let lids = blinking ? cocoLidsAt(blinks, CocoPlayer.elapsed(play, now)) : .open
        return paint(band, segment.part.elements, at: u, height: height, lids: lids)
    }
    /// Coco's idle pose in their first outfit (what the painted idle frame stood for: hit area, placement).
    func idleFrame(height: Int) -> CocoFrame {
        paint(bands[0], still(.a, "idle"), at: 0, height: height, lids: .open)
    }

    private func paint(_ band: CocoBand, _ elements: [CocoElement], at u: Double, height: Int, lids: CocoLids) -> CocoFrame {
        let (cw, ch) = band.canvas
        let height = max(height, 1)
        let width = max(Int((Double(height) * cw / ch - 1e-9).rounded(.up)), 1)
        let k = Double(height) / ch
        var draws: [CocoDraw] = []
        for e in elements {
            let a = e.a.sample(u).0
            guard a > 0.001 else { continue }
            let t = e.t.sample(u), r = e.r.sample(u).0, s = e.s.sample(u)
            // their lids, on a frame they hold in a loop, inside the part of the frame that holds their eyes
            var lid: (key: String, box: [Double])? = nil
            if lids != .open, let box = bank.eyes[e.src],
               !(e.clipLocal.map { $0[1] > box[1] || $0[3] < box[1] + box[3] } ?? false) {
                lid = (e.src + (lids == .half ? "#half" : "#closed"), box)
            }
            // the worn pair of socks, over the drawn ones, moved with the picture
            let socks = bank.socks[e.src].map { (key: e.src + "#socks", box: $0) }
            let canvasMap = CocoAffine.scale(k, k)
            let moved = canvasMap.then(.translate(t.0, t.1))
            let (ox, oy) = e.origin
            let placed = moved.then(CocoAffine.rotate(r).about(ox, oy)).then(CocoAffine.scale(s.0, s.1).about(ox, oy))
            draws.append(CocoDraw(src: e.src, opacity: min(a, 1), canvas: canvasMap, moved: moved, placed: placed,
                                  clipFinal: e.clipFinal, clipLocal: e.clipLocal, lids: lid, socks: socks))
        }
        return CocoFrame(width: width, height: height, canvas: band.canvas, draws: draws)
    }
}

// ---------------------------------------------------------------- Claudie

/// Claudie's and maid Claudie's sixteen chibi cells (assets/claudie/<form>/NN.png), drawn in Coco's place when the
/// plugin says Claude's form is one of them (companion-rs/src/claudie.rs; the table mirrors CLAUDIE_CELLS in
/// plugin/hooks-source/claudie.ts).
enum CocoClaudie {
    static let forms = ["dake", "maid"]
    /// The cell (1 to 16) standing for one of Coco's actions in a form.
    static func cell(form: String, action: String) -> Int {
        switch action {
        case "wait", "hello": return 1
        case "firsttry", "fixed": return 2
        case "think", "search", "lookup": return 3
        case "plan", "run", "helper": return 4
        case "peek", "catch": return 5
        case "petted", "praised": return 6
        case "hood", "teapot": return 7
        case "wild": return 8
        case "doze", "nap": return 9
        case "error": return 10
        case "watch": return 11
        case "done", "pass": return 12
        case "out": return 13
        case "shell": return 16
        case "pack": return 15
        default:
            switch (form, action) {
            case ("maid", "read"), ("maid", "work"), ("maid", "serious"): return 15
            case ("maid", "night"): return 9
            case ("dake", "coffee"): return 11
            case ("dake", "night"): return 16
            default: return 14
            }
        }
    }
}
