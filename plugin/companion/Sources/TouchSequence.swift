import Foundation

/// A compositor schedule. Resolving its entries uses the prepared cache, never a decoder.
struct TouchSequence: Equatable {
    struct Entry: Equatable { var ms: Double; var pose: String?; var face: String? }
    var entries: [Entry]
    var durationMs: Double
    var lineMs: Double?
    static func make(_ key: String, base: String, tuning t: CompanionTuning.Touch, available: Set<String>, reduceMotion: Bool) -> Self {
        func pose(_ name: String) -> String { available.contains(name) ? name : base }
        switch key {
        case "wake":
            if reduceMotion { return Self(entries: [.init(ms: 0,pose: pose("idle-reading"),face: nil)], durationMs: t.wakeMs,lineMs: t.wakeLineMs) }
            return Self(entries: t.wakeFaces.map { .init(ms: $0.ms,pose: $0.frame == "half-lid" ? pose("idle-reading") : pose($0.frame),face: $0.frame == "half-lid" ? "half-lid" : nil) },durationMs: t.wakeMs,lineMs: t.wakeLineMs)
        case "pat":
            let steps = reduceMotion ? [CompanionTuning.Step(ms: 0,frame: "blink"), .init(ms: (t.patFaces.first(where: { $0.frame == "smile" })?.ms ?? 0),frame: "smile"),.init(ms: t.patMs,frame: "open")] : t.patFaces
            var entries: [Entry] = [], previous = "open"
            for step in steps {
                if step.swapMs > 0 && !reduceMotion {
                    let count = max(1,Int(ceil(step.swapMs * t.faceSwapHz / 1000)))
                    for i in 0...count { entries.append(.init(ms: step.ms + step.swapMs * Double(i) / Double(count),pose: nil,face: "blend:\(previous):\(step.frame):\(i):\(count)")) }
                } else { entries.append(.init(ms: step.ms,pose: nil,face: step.frame)) }
                previous = step.frame
            }
            return Self(entries: entries,durationMs: t.patMs,lineMs: nil)
        case "flustered":
            var entries = [Entry(ms: 0,pose: nil,face: nil), Entry(ms: t.poseCutMs,pose: pose("flustered"),face: nil),Entry(ms: t.shioriInMs,pose: pose("shiori-a"),face: nil)]
            if available.contains("shiori-b") { entries.append(Entry(ms: t.shioriInMs + t.shioriTurnMs,pose: "shiori-b",face: nil)) }
            entries.append(Entry(ms: t.shioriOutMs,pose: base,face: "squeeze"))
            return Self(entries: entries,durationMs: t.burstMs,lineMs: nil)
        case "drag":
            return Self(entries: [Entry(ms: t.startleCutMs,pose: pose("error"),face: nil), Entry(ms: t.carryMs,pose: pose("refuse"),face: nil)],durationMs: t.carryMs,lineMs: nil)
        case "hold":
            return Self(entries: [Entry(ms: t.poseCutMs,pose: pose("refuse"),face: nil)],durationMs: t.hugHoldMs,lineMs: nil)
        case "drop":
            return Self(entries: [Entry(ms: t.poseCutMs,pose: nil,face: "blink"),Entry(ms: t.dropMs,pose: base,face: "open")],durationMs: t.dropMs,lineMs: nil)
        case "wave", "thanks":
            return Self(entries: [Entry(ms: t.poseCutMs,pose: pose(key == "wave" ? "wave" : "happy"),face: nil)],durationMs: t.greetingMs,lineMs: nil)
        default: return Self(entries: [],durationMs: t.patMs,lineMs: nil)
        }
    }
}

enum TouchAwake {
    /// A buffered pre-touch sleep cannot undo a local first-frame wake.
    static func applying(_ record: Record, after touchAt: Double) -> Record {
        guard record.mood == "sleep", touchAt > 0, (record.presence?.at ?? record.at) <= touchAt else { return record }
        var result = record; result.mood = "idle"; result.frame = "idle-reading"; result.loop = nil; result.every = nil; result.said = nil
        return result
    }
}
