import AppKit
import Foundation
import CryptoKit

@MainActor func run() throws {
    setbuf(stdout, nil)
    let root = URL(fileURLWithPath: CommandLine.arguments[1])
    Voice.folder = root
    let lines = Lines(root: root, home: root)
    var checks = 0
    func expect(_ ok: Bool, _ what: String) {
        if !ok { fputs("FAIL \(what)\n", stderr); exit(1) }
        checks += 1; print("PASS", what)
    }
    for character in ["coco", "dake", "fish"] {
        Voice.keep(["lang": "zh", "character": character, "lineLibrary": ["start": [character + " start"], "working": [character + " work"], "idle": [character + " idle"]]])
        expect(lines.pick("start") == character + " start", "\(character) reads its own start line after a live switch")
        expect(lines.pick("working") == character + " work", "\(character) reads its own working line")
        expect(lines.pick("idle") == character + " idle", "\(character) reads its own idle line")
        expect(lines.pick("done") == nil, "missing \(character) group stays silent")
        let own = OwnFeed(lines: lines)
        var record: [String: Any] = [:]
        own.publish = { record = $0 }
        own.start()
        expect(record["character"] as? String == character, "own feed preserves selected character")
        expect(record["said"] as? String == character + " idle", "own feed uses selected idle line")
        own.stop()
    }
    Voice.keep(["lang": "zh", "character": "fish", "lineLibrary": ["start": [String]()]])
    expect(lines.pick("start") == nil, "disabled fish library stays silent")
    let quiet = OwnFeed(lines: lines)
    var quietRecord: [String: Any] = [:]
    quiet.publish = { quietRecord = $0 }
    quiet.start()
    expect(quietRecord["said"] == nil, "disabled library produces no idle chatter")
    quiet.stop()
    Voice.keep(["lang": "zh", "character": "dake"])
    expect(lines.pick("start") == nil, "legacy non-Coco voice never falls back to Coco")

    func object(_ name: String) throws -> [String: Any] {
        try JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent(name))) as! [String: Any]
    }
    let fixtures = try JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent("fixtures.json"))) as! [[String: Any]]
    for fixture in fixtures {
        let name = fixture["name"] as! String, count = fixture["count"] as! Int
        let raw = try object(name + ".raw.json"), feed = try object(name + ".feed.json")
        let expected = raw["lineLibrary"] as! [String: [String]]
        if fixture["oversized"] as? Bool == true {
            expect(FeedLimits.object(raw) == nil, "\(name) reproduces the old whole-record rejection")
        } else {
            expect(raw["character"] == nil && raw["claudie"] == nil, "default Coco keeps the legacy record free of role fields")
            let book = try object(name + ".book.json")
            expect(feed["character"] as? String == "coco" && book["character"] as? String == "coco", "default Coco is bound consistently at the separate-book boundary")
        }
        expect(FeedLimits.object(feed) != nil && Record(feed) != nil, "\(name) compact feed keeps the existing state limits")
        expect(try Data(contentsOf: root.appendingPathComponent(name + ".feed.json")).count <= FeedLimits.maxBytes, "\(name) state remains below 1 MiB")
        expect(Voice.keep(feed), "\(name) verifies its separate native-written book")
        let voice = Voice.object!, library = Voice.library(voice)!
        expect(voice["character"] as? String == fixture["character"] as? String, "\(name) native reader preserves its bound character")
        expect(library["start"] == expected["start"] && library["wake"] == raw["wakeLines"] as? [String], "\(name) preserves every start and wake line exactly")
        expect(library["start"]?.count == count, "\(name) keeps all \(count) lines")
        expect(voice["lineLibrary"] == nil && FeedLimits.object(voice) != nil, "\(name) persisted voice stays compact")
        let own = OwnFeed(lines: lines)
        var ownRecord: [String: Any] = [:]
        own.publish = { ownRecord = $0 }
        own.start(); own.stop()
        expect(Record(ownRecord) != nil, "\(name) own state stays receivable")
        var projection = PresenceProjection()
        expect(projection.receive(["v": 1, "seq": 1.0, "asleep": false, "quietAt": 0.0, "busy": false, "clingy": false,
            "event": ["kind": "wake", "id": "wake-fixture", "at": 1000.0, "lang": "zh"]]), "\(name) accepts wake event")
        expect(projection.presence(now: 1001)?.said.map { spoken in library["wake"]!.contains { $0.hasPrefix(spoken) } } == true, "\(name) wake uses the full verified library within display limits")

        for key in ["session", "character", "lang"] {
            var crossed = feed
            crossed[key] = "other"
            expect(!Voice.keep(crossed), "\(name) rejects a book borrowed across \(key)")
            expect(Voice.library(Voice.object!)?.isEmpty == true, "\(name) rejected reference cannot reappear through persisted voice")
        }
        var malformed = feed, ref = feed["lineLibraryRef"] as! [String: Any]
        for digest in ["../outside", String(repeating: "A", count: 64), String(repeating: "0", count: 64)] {
            ref["sha256"] = digest; malformed["lineLibraryRef"] = ref
            expect(!Voice.keep(malformed), "\(name) rejects malformed or missing digest reference")
        }
        ref = feed["lineLibraryRef"] as! [String: Any]
        ref["bytes"] = (ref["bytes"] as! Int) - 1; malformed["lineLibraryRef"] = ref
        expect(!Voice.keep(malformed), "\(name) rejects a mismatched byte count even after caching")
        expect(Voice.keep(feed), "\(name) accepts the valid book again after bad references")
        Voice.keep(["lang": "zh", "character": "fish", "lineLibrary": ["wake": [String]()]])
        expect(projection.presence(now: 1001)?.said == nil, "\(name) disabling wake removes the previous book immediately")
        Voice.keep(["lang": "zh", "character": "dake", "lineLibrary": ["wake": ["dake wake"]]])
        expect(projection.presence(now: 1001)?.said == "dake wake", "\(name) wake changes character immediately")
    }

    let feed = try object("129-lines.feed.json")
    let ref = feed["lineLibraryRef"] as! [String: Any]
    let name = "lines-\(ref["sha256"] as! String).json"
    for kind in ["symlink", "hardlink", "tampered"] {
        let folder = root.appendingPathComponent(kind)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false)
        let target = folder.appendingPathComponent(name), original = root.appendingPathComponent(name)
        if kind == "symlink" { try FileManager.default.createSymbolicLink(at: target, withDestinationURL: original) }
        else if kind == "hardlink" { try FileManager.default.linkItem(at: original, to: target) }
        else {
            var bytes = try Data(contentsOf: original)
            bytes[bytes.count - 2] ^= 1
            try bytes.write(to: target)
        }
        Voice.folder = folder
        expect(!Voice.keep(feed), "reader rejects \(kind) library")
        expect(Voice.library(Voice.object!)?.isEmpty == true, "reader does not fall back to another character after \(kind)")
        try FileManager.default.removeItem(at: target)
    }
    Voice.folder = root
    expect(Voice.keep(["session": "old", "lang": "zh", "character": "dake"]), "new pet accepts a legacy plugin voice")
    expect(Record(["session": "old", "at": 1.0, "lang": "zh"]) != nil, "legacy plugin basic state remains accepted")

    let sessions = root.appendingPathComponent("sessions")
    let directory = try SecureDirectory(sessions, create: true)
    Voice.folder = sessions
    let feedReader = Feed(file: sessions.appendingPathComponent("view.json"), trace: Trace(on: false))
    let now = Date().timeIntervalSince1970 * 1000
    func publish(_ session: String, character: String, rest: Bool, at: Double) throws {
        let book = try JSONSerialization.data(withJSONObject: ["v": 1, "session": session, "character": character, "lang": "zh",
            "lines": ["wake": [session + " wake"]], "wakeLines": [session + " wake"]], options: .sortedKeys)
        let digest = SHA256.hash(data: book).map { String(format: "%02x", $0) }.joined()
        try directory.replace("lines-\(digest).json", with: book)
        let state: [String: Any] = ["session": session, "at": at, "character": character, "lang": "zh", "rest": rest,
            "mood": rest ? "idle" : "work", "frame": rest ? "idle-reading" : "work-a", "surfaces": ["desktop"],
            "lineLibraryRef": ["sha256": digest, "bytes": book.count, "session": session]]
        try directory.replace("view.json", with: JSONSerialization.data(withJSONObject: state))
        feedReader.start(); feedReader.stop()
    }
    try publish("busy-A", character: "fish", rest: false, at: now)
    try publish("idle-B", character: "dake", rest: true, at: now + 1)
    expect(feedReader.shown.session == "busy-A", "real Feed keeps the busy fish after a later idle dake record")
    expect(Voice.presenceLibrary?["wake"] == ["busy-A wake"], "presence book follows the shown session instead of the latest writer")
    expect(Voice.object?["character"] as? String == "dake", "saved standalone voice still follows the latest writer")
    var projection = PresenceProjection()
    _ = projection.receive(["v": 1, "seq": 1.0, "asleep": false, "quietAt": 0.0, "busy": false, "clingy": false,
        "event": ["kind": "wake", "id": "multi-session-wake", "at": now, "lang": "zh"]])
    expect(projection.presence(now: now + 2)?.said == "busy-A wake", "actual selected fish speaks on wake while idle dake remains saved")
    feedReader.forget()
    expect(Voice.presenceLibrary?["wake"] == ["idle-B wake"], "without plugin sessions presence returns to the saved standalone voice")
    Voice.select(nil)
    print("PASS checks", checks)
}

try MainActor.assumeIsolated { try run() }
