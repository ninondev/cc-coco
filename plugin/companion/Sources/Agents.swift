import Foundation
import CoreServices
import Darwin

// He used to learn everything from the Claude Code mod. These three keep him going without it: his voice comes from
// a saved copy, his lines from the book, and what he does from the files Codex and ZCode write as they work.
// Only the start of each new line is looked at, for the event's name; no text is kept. Nothing leaves this Mac.

/// His line book, if this Mac has one: the copy in ~/.config/coco, else one beside the frames. `[name]` starts a section;
/// `[zone]` names the time zone its greetings go by.
struct Lines {
    private var sections: [String: [String]] = [:]

    init(root: URL, home: URL) {
        let book = "coco-shipped-zh.txt"
        for url in [home.appendingPathComponent(".config/coco/lines/\(book)"), root.appendingPathComponent("lines/\(book)")] {
            guard let text = try? String(contentsOf: url, encoding: .utf8) else { continue }
            var section: String?
            for raw in text.split(separator: "\n") {
                let line = raw.trimmingCharacters(in: .whitespaces)
                if line.isEmpty || line.hasPrefix("#") { continue }
                if line.hasPrefix("["), line.hasSuffix("]") { section = String(line.dropFirst().dropLast()); continue }
                if let section, !line.contains("{") { sections[section, default: []].append(line) }
            }
            if !sections.isEmpty { break }
        }
    }

    /// A line for this moment, with the clingy set mixed in when he has one for it.
    func pick(_ name: String) -> String? {
        ((sections[name] ?? []) + (sections["clingy." + name] ?? [])).randomElement()
    }
}

/// Whether Codex or ZCode is working, from FSEvents on their own files. No timer runs while nothing is happening.
@MainActor
final class AgentWatch {
    enum State: Equatable {
        case idle
        case busy(String)
        case done(String, stopped: Bool)
    }

    private struct Source {
        let label: String
        let root: URL
        let filePrefix: String
        /// The app whose quitting ends its turns.
        let app: String
        /// One log for every session, full of lines about other things: only its marks say a turn is alive,
        /// and each line names its turn.
        var shared = false
        var busy: [Data]
        var done: [Data]
        var stopped: [Data]
    }

    private struct Turn {
        let label: String
        var heard: TimeInterval
        /// Met in the tail of a file seen for the first time. One that also ends there is old news.
        var fromTail = false
    }

    var changed: (State) -> Void = { _ in }
    private let sources: [Source]
    private var stream: FSEventStreamRef?
    private var cursors: [String: Int64] = [:]
    private var working: [String: Turn] = [:]
    /// Turns given up on. One that speaks again was only quiet: a long command, an approval.
    private var dropped: Set<String> = []
    private var finished: State?
    private var state = State.idle
    private lazy var stale = OneShot { [weak self] in self?.giveUp() }

    /// First sight of a file: its tail only, enough to find where the turn stands.
    private static let tail: Int64 = 262_144
    private static let most: Int64 = 4_194_304
    /// ZCode names the turn around byte 330.
    private static let prefixBytes = 512
    private static let turnMark = Data("\"turnId\":\"".utf8)
    /// COCO_AGENT_STALE is for test/fixture.sh.
    static let staleSeconds = getenv("COCO_AGENT_STALE").flatMap { Double(String(cString: $0)) } ?? 900
    /// Stops while the Mac sleeps, as the timer does: a lid closed mid-turn takes nothing from the turn.
    private static func clock() -> TimeInterval { ProcessInfo.processInfo.systemUptime }

    init(home: URL) {
        func marks(_ key: String, _ names: [String]) -> [Data] { names.map { Data("\"\(key)\":\"\($0)\"".utf8) } }
        // FSEvents reports real paths; resolvingSymlinksInPath would strip /private and never match them.
        func real(_ url: URL) -> URL {
            guard let path = realpath(url.path, nil) else { return url }
            defer { free(path) }
            return URL(fileURLWithPath: String(cString: path))
        }
        let codex = getenv("CODEX_HOME").map { URL(fileURLWithPath: String(cString: $0)) } ?? home.appendingPathComponent(".codex")
        sources = [
            Source(label: "Codex", root: real(codex.appendingPathComponent("sessions")), filePrefix: "rollout-",
                   app: getenv("COCO_CODEX_APP").map { String(cString: $0) } ?? "com.openai.codex", // the variable is for test/fixture.sh
                   busy: marks("type", ["task_started", "turn_started"]),
                   done: marks("type", ["task_complete", "turn_complete"]),
                   stopped: marks("type", ["turn_aborted"])),
            Source(label: "ZCode", root: real(home.appendingPathComponent(".zcode/cli/log")), filePrefix: "zcode-", app: "dev.zcode.app", shared: true,
                   busy: marks("event", ["turn.started", "model.request.started", "tool.call.started"]),
                   done: marks("event", ["turn.completed"]),
                   stopped: marks("event", ["turn.failed"])),
        ]
    }

    func start() {
        let roots = sources.map(\.root.path).filter { FileManager.default.fileExists(atPath: $0) }
        guard stream == nil, !roots.isEmpty else { return }
        var context = FSEventStreamContext(version: 0, info: Unmanaged.passUnretained(self).toOpaque(), retain: nil, release: nil, copyDescription: nil)
        let callback: FSEventStreamCallback = { _, context, count, paths, _, _ in
            guard let context else { return }
            let watch = Unmanaged<AgentWatch>.fromOpaque(context).takeUnretainedValue()
            let array = unsafeBitCast(paths, to: NSArray.self)
            let list = (0..<count).compactMap { array[$0] as? String }
            MainActor.assumeIsolated { watch.touched(list) }
        }
        let flags = FSEventStreamCreateFlags(kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagUseCFTypes | kFSEventStreamCreateFlagNoDefer)
        guard let made = FSEventStreamCreate(nil, callback, &context, roots as CFArray, FSEventStreamEventId(kFSEventStreamEventIdSinceNow), 0.25, flags) else { return }
        FSEventStreamSetDispatchQueue(made, .main)
        if FSEventStreamStart(made) { stream = made } else { FSEventStreamInvalidate(made); FSEventStreamRelease(made) }
    }

    func stop() {
        if let stream { FSEventStreamStop(stream); FSEventStreamInvalidate(stream); FSEventStreamRelease(stream) }
        stream = nil
        stale.cancel()
    }

    /// Follows the same opt-in as the neighbours file. Off forgets everything read, so turning it on starts clean.
    func setEnabled(_ on: Bool) {
        if on { start(); return }
        guard stream != nil else { return }
        stop()
        working.removeAll(); dropped.removeAll(); cursors.removeAll(); finished = nil
        publish()
    }

    /// The app quit, so its turns went with it. A run from the command line will speak again and be picked up.
    func ended(app: String) {
        guard let label = sources.first(where: { $0.app == app })?.label else { return }
        for (key, turn) in working where turn.label == label { working[key] = nil; dropped.insert(key) }
        expire()
        publish()
    }

    private func touched(_ paths: [String]) {
        var seen = false
        for path in Set(paths) {
            let name = (path as NSString).lastPathComponent
            guard name.hasSuffix(".jsonl"),
                  let source = sources.first(where: { path.hasPrefix($0.root.path + "/") && name.hasPrefix($0.filePrefix) }) else { continue }
            read(path, source)
            seen = true
        }
        guard seen else { return }
        expire()
        publish()
    }

    private func read(_ path: String, _ source: Source) {
        let fd = open(path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { return }
        defer { close(fd) }
        var info = stat()
        guard fstat(fd, &info) == 0, info.st_mode & S_IFMT == S_IFREG else { return }
        let size = Int64(info.st_size)
        let known = cursors[path].flatMap { $0 <= size ? $0 : nil }
        var from = known ?? max(0, size - Self.tail)
        var aligned = known != nil || from == 0
        if size - from > Self.most { from = size - Self.most; aligned = false }
        guard size > from else { return }
        var bytes = Data(count: Int(size - from))
        let got = bytes.withUnsafeMutableBytes { pread(fd, $0.baseAddress, $0.count, off_t(from)) }
        guard got == bytes.count else { return }
        if dropped.remove(path) != nil { working[path] = Turn(label: source.label, heard: Self.clock()) }
        var start = 0
        if !aligned {
            guard let newline = bytes.firstIndex(of: 10) else { return }
            start = newline + 1
        }
        var marked = false
        while let newline = bytes[start...].firstIndex(of: 10) {
            let line = bytes[start..<min(newline, start + Self.prefixBytes)]
            if look(at: line, path, source, tail: known == nil) { marked = true }
            start = newline + 1
        }
        cursors[path] = from + Int64(start)
        working[path]?.heard = Self.clock()
        for key in working.keys { working[key]?.fromTail = false }
        // A file seen for the first time, written to, with no event in its tail: a long turn is under way.
        if known == nil, !marked, !source.shared { working[path] = Turn(label: source.label, heard: Self.clock()) }
    }

    private func look(at line: Data, _ path: String, _ source: Source, tail: Bool) -> Bool {
        func has(_ marks: [Data]) -> Bool { marks.contains { line.range(of: $0) != nil } }
        func key() -> String {
            guard source.shared else { return path }
            guard let mark = line.range(of: Self.turnMark), let end = line[mark.upperBound...].firstIndex(of: 34) else { return source.label }
            return String(decoding: line[mark.upperBound..<end], as: UTF8.self)
        }
        if has(source.busy) {
            let key = key()
            dropped.remove(key)
            working[key] = Turn(label: source.label, heard: Self.clock(), fromTail: tail && working[key]?.fromTail != false)
            if !tail { finished = nil }
            return true
        }
        let stopped = has(source.stopped)
        if stopped || has(source.done) {
            let key = key()
            let turn = working.removeValue(forKey: key)
            if dropped.remove(key) != nil || turn?.fromTail == false { finished = .done(source.label, stopped: stopped) }
            return true
        }
        return false
    }

    /// A turn gone silent was killed or crashed: it must not hold him at work or take the next turn's cheer.
    private func expire() {
        let now = Self.clock()
        for (key, turn) in working where now - turn.heard >= Self.staleSeconds { working[key] = nil; dropped.insert(key) }
        if let oldest = working.values.map(\.heard).min() {
            stale.fire(after: Self.staleSeconds - (now - oldest))
        } else {
            stale.cancel()
        }
    }

    private func giveUp() {
        expire()
        if working.isEmpty { finished = nil }
        publish()
    }

    private func publish() {
        if let label = working.values.map(\.label).sorted().first { send(.busy(label)) }
        else if let finished { self.finished = nil; send(finished) }
        else if case .busy = state { send(.idle) }
    }

    private func send(_ next: State) {
        guard next != state else { return }
        state = next
        changed(next)
        // OwnFeed comes to rest by itself, and the next short turn must be able to cheer again.
        if case .done = next { state = .idle }
    }
}

/// Turns what AgentWatch sees into records for the feed, shaped like the ones the mod writes.
@MainActor
final class OwnFeed {
    var publish: ([String: Any]) -> Void = { _ in }
    private let lines: Lines
    private var busySince: Double?
    private var busyLabel: String?
    private var sleeping = false
    private var at: Double = 0
    private lazy var settle = OneShot { [weak self] in self?.idle() }
    private lazy var doze = OneShot { [weak self] in self?.nap() }
    private lazy var beat = OneShot { [weak self] in self?.pulse() }
    private static let happySeconds = 4.0
    /// The pet stops the work loop on a record ten minutes old, so a long turn keeps its record fresh, as the mod's tool calls do.
    private static let beatSeconds = AgentWatch.staleSeconds / 15
    private static let dozeSeconds = 1800.0
    private static let longTurnMs = 180_000.0

    init(lines: Lines) { self.lines = lines }

    func start() { idle(said: lines.pick(Self.greeting(in: lines.pick("zone").flatMap(TimeZone.init(identifier:)) ?? .current))) }
    func stop() { settle.cancel(); doze.cancel(); beat.cancel() }

    static func greeting(at date: Date = Date(), in zone: TimeZone) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        switch calendar.component(.hour, from: date) {
        case 5..<11: return "greeting.morning"
        case 11..<14: return "greeting.noon"
        case 14..<18: return "greeting.afternoon"
        case 18..<23: return "greeting.evening"
        default: return "greeting.night"
        }
    }

    func set(_ state: AgentWatch.State) {
        switch state {
        case let .busy(label):
            settle.cancel(); doze.cancel()
            let woke = sleeping
            sleeping = false
            let line = woke ? lines.pick("wake") : busySince == nil && Int.random(in: 0..<4) == 0 ? lines.pick("start") : nil
            if busySince == nil { busySince = Self.now() }
            busyLabel = label
            work(label, said: line)
        case let .done(_, stopped):
            let long = Self.now() - (busySince ?? Self.now()) > Self.longTurnMs
            busySince = nil
            busyLabel = nil
            beat.cancel()
            doze.cancel()
            if stopped { send(["mood": "flustered", "frame": "flustered", "rest": true], said: lines.pick("aborted")) }
            else { send(["mood": "happy", "frame": "happy", "rest": true], said: Bool.random() ? lines.pick(long ? "done_long" : "done") : nil) }
            settle.fire(after: Self.happySeconds)
        case .idle:
            idle()
        }
    }

    private func work(_ label: String, said: String?) {
        send(["mood": "work", "frame": "work-a", "loop": ["work-a", "work-b"], "every": 330.0, "rest": false, "task": label], said: said)
        beat.fire(after: Self.beatSeconds)
    }

    private func pulse() {
        if let busyLabel { work(busyLabel, said: nil) }
    }

    private func idle(said: String? = nil) {
        busySince = nil
        busyLabel = nil
        beat.cancel()
        send(["mood": "idle", "frame": "idle-reading", "rest": true], said: said)
        doze.fire(after: Self.dozeSeconds)
    }

    private func nap() {
        sleeping = true
        send(["mood": "sleep", "frame": "sleep", "rest": true], said: nil)
    }

    private static func now() -> Double { Date().timeIntervalSince1970 * 1000 }

    private func send(_ fields: [String: Any], said: String?) {
        at = max(at + 1, Self.now())
        var object = Voice.object ?? [:]
        object.merge(fields) { $1 }
        object["session"] = ActivitySessions.own
        object["at"] = at
        object["surfaces"] = ["desktop"]
        if let said { object["said"] = said }
        publish(object)
    }
}
