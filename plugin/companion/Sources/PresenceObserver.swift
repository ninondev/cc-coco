import Foundation
import Darwin

func presenceSleepAfter(_ quietAt: Int64) -> Int64 {
    let stamp = UInt64(quietAt)
    var hash = UInt32(truncatingIfNeeded: stamp) ^ UInt32(truncatingIfNeeded: stamp >> 32)
    hash = (hash ^ (hash >> 16)) &* 0x85ebca6b
    hash = (hash ^ (hash >> 13)) &* 0xc2b2ae35
    hash ^= hash >> 16
    return 240_000 + Int64(UInt64(hash) * 120_000 / 0x1_0000_0000)
}

/// The shared snapshot supplies transitions. This model selects existing words and deadlines.
struct PresenceProjection {
    private(set) var snapshot: [String: Any]?
    private var lines: [String: [String: [String]]] = [:]
    private var affection = "warm"
    private var wakeLines: [String: [String]] = [:]
    private var clingyWake: [String: [String]] = [:]
    var sleepAt: Double? {
        guard let snapshot, snapshot["busy"] as? Bool == false, snapshot["asleep"] as? Bool == false,
              let quiet = snapshot["quietAt"] as? Double else { return nil }
        return quiet + Double(presenceSleepAfter(Int64(quiet)))
    }
    var clingyAt: Double? {
        guard let snapshot, snapshot["busy"] as? Bool == false, snapshot["asleep"] as? Bool == false,
              snapshot["clingy"] as? Bool == false, let quiet = snapshot["quietAt"] as? Double else { return nil }
        return quiet + 150_000
    }

    mutating func recipes(_ object: [String: Any]) {
        if let affection = object["affection"] as? String, ["warm", "clingy"].contains(affection) {
            self.affection = affection
        }
        func recipes(_ key: String) -> [String: [String]]? {
            guard let table = object[key] as? [String: [String]], table.count <= 16,
                  table.allSatisfy({ $0.key.utf8.count <= 16 && !$0.value.isEmpty && $0.value.count <= 128 && $0.value.allSatisfy { $0.utf8.count <= 8192 } }) else { return nil }
            return table
        }
        if let table = recipes("wakeLines") { wakeLines.merge(table) { _, newest in newest } }
        if let table = recipes("clingyWake") { clingyWake.merge(table) { _, newest in newest } }
        guard let languages = object["lines"] as? [String: [String: [String]]], languages.count <= 16 else { return }
        for (language, keys) in languages where language.utf8.count <= 16 {
            guard keys.count <= 3, keys.values.allSatisfy({ !$0.isEmpty && $0.count <= 128 && $0.allSatisfy { $0.utf8.count <= 8192 } }) else { continue }
            lines[language] = keys
        }
    }

    @discardableResult
    mutating func receive(_ object: [String: Any]) -> Bool {
        guard object["v"] as? Int == 1, let incoming = Presence(object),
              let quiet = object["quietAt"] as? Double, quiet.isFinite, quiet >= 0, quiet <= 8.64e15,
              object["busy"] is Bool, object["clingy"] is Bool else { return false }
        if let old = snapshot?["seq"] as? Double, incoming.seq < old { return false }
        snapshot = object
        return true
    }

    func presence(now: Double) -> Presence? {
        guard var object = snapshot, let event = object["event"] as? [String: Any] else { return nil }
        var wake = object["wakeEvent"] as? [String: Any] ?? (event["kind"] as? String == "wake" ? event : nil)
        // The contract keeps touch beside sleep/wake, so later activity cannot erase it.
        // An initial reader may receive the touch before its cached sleep has been projected.
        if let touch = (object["touchEvent"] as? [String: Any]).flatMap(Presence.Touch.init),
           let sleep = object["sleepEvent"] as? [String: Any], let slept = sleep["at"] as? Double, touch.at > slept {
            if wake == nil || (wake?["at"] as? Double ?? 0) <= slept {
                wake = ["kind": "wake", "id": touch.id, "at": touch.at, "lang": touch.lang]
            }
            object["asleep"] = false
        }
        let speech: [String: Any]
        if object["asleep"] as? Bool == true { speech = object["sleepEvent"] as? [String: Any] ?? event }
        else if let wake, let at = wake["at"] as? Double, now < at + 14_000 { speech = wake }
        else if object["clingy"] as? Bool == true { speech = object["clingyEvent"] as? [String: Any] ?? event }
        else { speech = event }
        object["event"] = speech
        object["said"] = NSNull()
        let kind = speech["kind"] as? String ?? ""
        let key = kind == "sleep" || kind == "wake" ? kind : kind == "clingy" && affection == "clingy" ? "idle" : ""
        let language = speech["lang"] as? String ?? object["lang"] as? String ?? "en"
        if let at = speech["at"] as? Double, now >= at, now < at + 14_000,
           let id = speech["id"] as? String,
           let choices = key == "wake"
                ? (wakeLines[language] ?? (affection == "clingy" ? clingyWake[language] ?? clingyWake["en"] : nil) ?? lines[language]?[key] ?? lines["en"]?[key])
                : (lines[language]?[key] ?? lines["en"]?[key]), !choices.isEmpty {
            var hash: UInt32 = 2_166_136_261
            for unit in id.utf16 { hash = (hash ^ UInt32(unit)) &* 16_777_619 }
            object["said"] = choices[Int(hash) % choices.count]
        }
        return Presence(object)
    }
}

/// The companion has no session claim and no child process. Vnode and process-exit sources
/// observe the same snapshot; only quiet deadlines or a host exit ask for a shared decision.
@MainActor
final class PresenceObserver {
    static let limit = 256 * 1024
    let folder: URL
    private let trace: Trace
    private let now: () -> Double
    private var model = PresenceProjection()
    private var folderSource: DispatchSourceFileSystemObject?
    private var snapshotSource: DispatchSourceFileSystemObject?
    private var hosts: [pid_t: (String, DispatchSourceProcess)] = [:]
    private var lastData: Data?
    private var stopped = false
    private var deciding = false
    private var pendingDecision = false
    private var pendingLine: Data?
    private var pendingNeighbours: [String: Any]?
    private var neighboursGeneration = 0
    private var pendingTouches: [[String: Any]] = []
    private var lockWaitPending = false
    private var lockWaitGeneration = 0
    private lazy var sleep = OneShot { [weak self] in self?.deadlineReached() }
    private lazy var clingy = OneShot { [weak self] in self?.deadlineReached() }
    var changed: (Presence) -> Void = { _ in }
    // Tests exercise the same deadline and transaction boundaries without starting an app.
    var arm: ((Double?, Double?) -> Void)?
    var decide: (() -> Void)?
    var commitBoundary: ((String) -> Void)?
    var current: Presence? { model.presence(now: now()) }
    var sleepAt: Double? { model.sleepAt }
    var clingyAt: Double? { model.clingyAt }

    init(folder: URL, trace: Trace, now: @escaping () -> Double = { Date().timeIntervalSince1970 * 1000 }) {
        self.folder = folder.appendingPathComponent("native-v2"); self.trace = trace; self.now = now
    }

    func recipes(_ object: [String: Any]) {
        model.recipes(object)
        if let current { changed(current) }
    }

    func start() {
        stopped = false
        lastData = nil
        guard (try? SecureDirectory(folder, create: true)) != nil else { stopped = true; return }
        watchFolder()
        watchSnapshot()
        loadInitial() // Watch first, then read, so a rename cannot hide in the first-frame gap.
        requestDecision()
    }

    func loadInitial() {
        guard !stopped, let object = readState(),
              let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]), data != lastData else { return }
        lastData = data
        receive(data)
        watchClaims(object)
    }

    func stop() {
        stopped = true
        sleep.cancel(); clingy.cancel()
        arm?(nil, nil)
        folderSource?.cancel(); folderSource = nil
        snapshotSource?.cancel(); snapshotSource = nil
        for (_, source) in hosts.values { source.cancel() }
        hosts.removeAll()
        pendingDecision = false
        pendingLine = nil
        pendingTouches.removeAll()
        pendingNeighbours = nil
        lockWaitGeneration += 1; lockWaitPending = false
    }

    func receive(_ data: Data) {
        guard !stopped, data.count <= Self.limit,
              let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], model.receive(object) else { return }
        trace.say("presence: seq=\(object["seq"] ?? 0) asleep=\(object["asleep"] ?? false) busy=\(object["busy"] ?? false)")
        if let current { changed(current) }
        schedule()
    }

    private func schedule() {
        if let arm { arm(model.sleepAt, model.clingyAt); return }
        if let deadline = model.sleepAt { sleep.fire(after: (deadline - now()) / 1000) } else { sleep.cancel() }
        if let deadline = model.clingyAt { clingy.fire(after: (deadline - now()) / 1000) } else { clingy.cancel() }
    }

    /// Exact native-v2 event; uses the same flock, snapshot and journal transaction as deadlines.
    func touch(_ kind: String, lang: String, at supplied: Double? = nil) {
        guard !stopped, ["poke", "pat", "burst", "hug", "drag"].contains(kind),
              !lang.isEmpty, lang.utf8.count <= 16 else { return }
        let moment = now()
        let requested = supplied ?? moment
        guard requested.isFinite, requested >= 0, requested <= moment, requested <= 8.64e15 else { return }
        let at = Int64(requested)
        pendingTouches.append(["kind": "touch", "id": "touch:companion:\(at)", "at": at,
                               "by": "companion", "touch": kind, "lang": lang])
        requestDecision()
    }

    /// Content-free neighbour projection, committed under the existing native-v2 lock.
    func neighbours(_ value: [String: Any]) {
        guard !stopped, value["v"] as? Int == 1, value["running"] as? Bool != nil,
              let agents = value["agents"] as? [[String: Any]], agents.count <= 32,
              JSONSerialization.isValidJSONObject(value) else { return }
        pendingNeighbours = value; neighboursGeneration += 1
        requestDecision()
    }

    func deadlineReached() {
        guard !stopped else { return }
        if let decide { decide() } else { requestDecision() }
    }

    private func watchFolder() {
        guard folderSource == nil else { return }
        guard let directory = try? SecureDirectory(folder) else { return }
        let fd = dup(directory.fd)
        guard fd >= 0 else { return }
        let source = DispatchSource.makeFileSystemObjectSource(fileDescriptor: fd,
            eventMask: [.write, .delete, .rename], queue: .main)
        source.setEventHandler { [weak self] in MainActor.assumeIsolated {
            guard let self, !self.stopped else { return }
            if self.snapshotSource == nil { self.watchSnapshot() }
            self.loadInitial()
            if self.pendingDecision {
                self.requestDecision()
            }
        } }
        source.setCancelHandler { close(fd) }
        source.resume()
        folderSource = source
    }

    private func watchSnapshot() {
        guard snapshotSource == nil else { return }
        guard let directory = try? SecureDirectory(folder), let fd = try? directory.openFile("snapshot.json", flags: O_EVTONLY) else { return }
        let source = DispatchSource.makeFileSystemObjectSource(fileDescriptor: fd,
            eventMask: [.write, .extend, .delete, .rename, .revoke], queue: .main)
        source.setEventHandler { [weak self, weak source] in MainActor.assumeIsolated {
            guard let self, let source, !self.stopped else { return }
            if !source.data.isDisjoint(with: [.delete, .rename, .revoke]) {
                source.cancel(); self.snapshotSource = nil; self.watchSnapshot()
            }
            self.loadInitial()
        } }
        source.setCancelHandler { close(fd) }
        source.resume()
        snapshotSource = source
    }

    private func watchClaims(_ object: [String: Any]) {
        let claims = object["claims"] as? [String: [String: Any]] ?? [:]
        var wanted: [pid_t: String] = [:]
        var expired = false
        for claim in claims.values {
            // Parent/nonce can change while an already watched PID stays alive.
            // Validate the complete claim on each incoming state, before reusing a watch.
            guard claimIsAlive(claim) else { expired = true; continue }
            if let pid = claim["pid"] as? Int32, let birth = claim["birth"] as? String { wanted[pid] = birth }
            if let pid = claim["hostPid"] as? Int32, let birth = claim["hostBirth"] as? String { wanted[pid] = birth }
        }
        for (pid, held) in hosts where wanted[pid] != held.0 { held.1.cancel(); hosts[pid] = nil }
        for (pid, birth) in wanted where hosts[pid] == nil {
            guard let claim = claims.values.first(where: { $0["pid"] as? Int32 == pid || $0["hostPid"] as? Int32 == pid }),
                  claimIsAlive(claim) else { expired = true; continue }
            let source = DispatchSource.makeProcessSource(identifier: pid, eventMask: .exit, queue: .main)
            source.setEventHandler { [weak self] in MainActor.assumeIsolated {
                guard let self, !self.stopped else { return }
                self.hosts[pid]?.1.cancel(); self.hosts[pid] = nil
                self.requestDecision()
            } }
            source.resume()
            hosts[pid] = (birth, source)
            // Verify after registration as well: an exit/reused PID in this gap cannot pin busy.
            if !claimIsAlive(claim) { expired = true }
        }
        if expired { requestDecision() }
    }

    private func readState() -> [String: Any]? {
        func decode(_ data: Data) -> [String: Any]? {
            guard data.count <= Self.limit, let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return nil }
            var projection = PresenceProjection()
            guard projection.receive(object), let claims = object["claims"] as? [String: [String: Any]], claims.count <= 1024,
                  claims.allSatisfy({ key, claim in
                      key.utf8.count <= 256 && (claim["pid"] as? Int32 ?? 0) > 0 && claim["busy"] is Bool
                      && (claim["birth"] as? String).map({ $0.utf8.count <= 128 }) == true
                      && (claim["session"] as? String).map({ $0.utf8.count <= 256 }) == true
                      && (claim["cwd"] == nil || (claim["cwd"] as? String).map({ $0.utf8.count <= 4096 }) == true)
                      && (claim["version"] == nil || (claim["version"] as? String).map({ $0.utf8.count <= 64 }) == true)
                  }) else { return nil }
            return object
        }
        func read(_ name: String) -> Data? {
            guard let directory = try? SecureDirectory(folder) else { return nil }
            return try? directory.read(name, maxBytes: Self.limit)
        }
        if let data = read("snapshot.json"), let object = decode(data) { return object }
        if let journal = read("presence.jsonl") {
            for line in journal.split(separator: 10).reversed() { if let object = decode(Data(line)) { return object } }
        }
        return nil
    }

    private func requestDecision() {
        guard !stopped, !deciding else { return }
        deciding = true
        defer { deciding = false }
        guard let lock = PresenceLock(folder: folder) else { pendingDecision = true; watchLockOwner(); return }
        defer { lock.release() }
        guard lock.isOwned else { pendingDecision = true; return }
        pendingDecision = false
        let neighbourGeneration = neighboursGeneration
        let stamp = Int64(now())
        var state = readState() ?? ["v": 1, "seq": 0, "quietAt": stamp, "asleep": false, "clingy": false,
            "busy": false, "lang": "en", "claims": [String: Any](),
            "event": ["kind": "initial", "id": "initial:0:\(stamp)", "at": stamp, "lang": "en"]]
        if let held = pendingLine {
            var stored = (try? JSONSerialization.data(withJSONObject: state, options: [.sortedKeys])) ?? Data()
            stored.append(10)
            if held == stored {
                // A gate may appear between the snapshot rename and journal append. Repair
                // the confirmed snapshot's broadcast, unless another writer superseded it.
                switch commit(held, lock: lock) {
                case .committed:
                    pendingLine = nil
                    if let id = (state["touchEvent"] as? [String: Any])?["id"] as? String,
                       let first = pendingTouches.first, first["id"] as? String == id { pendingTouches.removeFirst() }
                case .blocked: pendingDecision = true; watchLockOwner(); return
                case .failed: pendingLine = nil; return
                }
            } else { pendingLine = nil }
        }
        guard let previous = try? JSONSerialization.data(withJSONObject: state, options: [.sortedKeys]),
              var claims = state["claims"] as? [String: [String: Any]] else { return }
        let wasBusy = claims.values.contains { $0["busy"] as? Bool == true }
        claims = claims.filter { _, claim in
            claimIsAlive(claim)
        }
        state["claims"] = claims
        let busy = claims.values.contains { $0["busy"] as? Bool == true }
        let seq = state["seq"] as? Int64 ?? 0
        func event(_ kind: String, _ at: Int64) {
            let value: [String: Any] = ["kind": kind, "id": "\(kind):\(seq + 1):\(at)", "at": at, "lang": state["lang"] as? String ?? "en"]
            state["event"] = value
            if ["sleep", "wake", "clingy"].contains(kind) { state[kind + "Event"] = value }
        }
        if wasBusy && !busy { state["quietAt"] = stamp; state["clingy"] = false; event("expired", stamp) }
        state["busy"] = busy
        let touch = pendingTouches.first
        if let touch, let at = touch["at"] as? Int64 {
            if state["asleep"] as? Bool == true { event("wake", at) }
            state["asleep"] = false
            state["clingy"] = false
            state["quietAt"] = max(stamp, at)
            state["lang"] = touch["lang"]
            // The wake's words follow the language of the touched surface.
            if var wake = state["wakeEvent"] as? [String: Any], wake["at"] as? Int64 == at {
                wake["lang"] = touch["lang"]; state["wakeEvent"] = wake
            }
            state["event"] = touch
            state["touchEvent"] = touch
        }
        if let neighbours = pendingNeighbours { state["neighbours"] = neighbours }
        let quietAt = state["quietAt"] as? Int64 ?? stamp
        if !busy {
            if state["clingy"] as? Bool == false && stamp - quietAt >= 150_000 {
                state["clingy"] = true; event("clingy", quietAt + 150_000)
            }
            let delay = presenceSleepAfter(quietAt)
            if state["asleep"] as? Bool == false && stamp - quietAt >= delay {
                state["asleep"] = true; event("sleep", quietAt + delay)
            }
        }
        guard let next = try? JSONSerialization.data(withJSONObject: state, options: [.sortedKeys]) else { return }
        if previous != next || seq == 0 {
            state["seq"] = seq + 1
            guard let encoded = try? JSONSerialization.data(withJSONObject: state, options: [.sortedKeys]),
                  encoded.count + 1 <= Self.limit else { return }
            var line = encoded; line.append(10)
            switch commit(line, lock: lock) {
            case .committed:
                pendingLine = nil
                if touch != nil { pendingTouches.removeFirst() }
                if neighbourGeneration == neighboursGeneration { pendingNeighbours = nil }
            case .blocked: pendingLine = line; pendingDecision = true; watchLockOwner(); return
            case .failed: return
            }
        }
        if neighbourGeneration == neighboursGeneration { pendingNeighbours = nil }
        loadInitial()
        if !pendingTouches.isEmpty || pendingNeighbours != nil { requestDecisionAfterCurrent() }
    }

    private func requestDecisionAfterCurrent() {
        DispatchQueue.main.async { [weak self] in MainActor.assumeIsolated { self?.requestDecision() } }
    }

    private func claimIsAlive(_ claim: [String: Any]) -> Bool {
        guard let pid = claim["pid"] as? Int32, let birth = claim["birth"] as? String,
              let owner = claim["owner"] as? String, !owner.isEmpty, owner.utf8.count <= 64,
              owner.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" || $0 == ".") }),
              PresenceProcessIdentity.birth(pid) == birth else { return false }
        if let host = claim["hostPid"] as? Int32 {
            guard let hostBirth = claim["hostBirth"] as? String, let hostMetadata = PresenceProcessIdentity.metadata(host),
                  hostMetadata.birth == hostBirth, hostMetadata.uid == getuid(), PresenceProcessIdentity.parent(pid) == host else { return false }
        }
        guard let directory = try? SecureDirectory(folder),
              let receipt = try? directory.read(".presence-registration-\(owner)", maxBytes: 8192),
              let text = String(data: receipt, encoding: .utf8),
              let metadata = PresenceProcessIdentity.metadata(pid),
              let claimedUID = claim["uid"] as? UInt32, let claimedExecutable = claim["executable"] as? String,
              metadata.birth == birth, metadata.uid == getuid(), claimedUID == metadata.uid, claimedExecutable == metadata.executable else { return false }
        return text == "\(pid)\t\(metadata.parent)\t\(metadata.birth)\t\(metadata.uid)\t\(metadata.executable)\t\(owner)\n"
    }

    private func watchLockOwner() {
        // The holder may die before publishing its PID. Wait on kernel ownership
        // directly; this thread exists only while a real contended lock is held.
        guard !lockWaitPending else { return }
        lockWaitPending = true
        let folder = self.folder
        let generation = lockWaitGeneration
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let directory = try? SecureDirectory(folder)
            let fd = (try? directory?.openFile(".presence-flock", flags: O_RDWR, create: true)) ?? -1
            var acquired = false
            if fd >= 0 {
                var code: Int32
                repeat { code = flock(fd, LOCK_EX) } while code < 0 && errno == EINTR
                acquired = code == 0
                if acquired { _ = flock(fd, LOCK_UN); _ = futimens(fd, nil) }
                close(fd)
            }
            let ready = acquired
            DispatchQueue.main.async { [weak self] in MainActor.assumeIsolated {
                guard let self, generation == self.lockWaitGeneration else { return }
                self.lockWaitPending = false
                if ready && !self.stopped && self.pendingDecision { self.requestDecision() }
            } }
        }
    }

    /// Same lock ordering as the TS transport: atomic snapshot, then one append or capped rotation.
    private enum CommitResult { case committed, blocked, failed }

    private func commit(_ line: Data, lock: PresenceLock) -> CommitResult {
        do {
            let directory = try SecureDirectory(folder)
            commitBoundary?("snapshot")
            guard lock.isOwned else { return .blocked }
            try directory.replace("snapshot.json", with: line)
            commitBoundary?("journal")
            guard lock.isOwned else { return .blocked }
            try directory.append("presence.jsonl", data: line, maxBytes: Self.limit)
            return .committed
        } catch { return .failed }
    }
}

/// Exact epoch birth identity from libproc, independent of a session's time zone.
/// The birth is checked at decisions; an exit source follows the currently watched generation.
enum PresenceProcessIdentity {
    static func exactBirth(_ pid: pid_t) -> String? {
        var info = proc_bsdinfo()
        let size = withUnsafeMutablePointer(to: &info) {
            proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, $0, Int32(MemoryLayout<proc_bsdinfo>.size))
        }
        return size == MemoryLayout<proc_bsdinfo>.size && info.pbi_status != 5
            ? "\(info.pbi_start_tvsec):\(info.pbi_start_tvusec)" : nil
    }
    static func parent(_ pid: pid_t) -> pid_t? {
        var info = proc_bsdinfo()
        let size = withUnsafeMutablePointer(to: &info) {
            proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, $0, Int32(MemoryLayout<proc_bsdinfo>.size))
        }
        return size == MemoryLayout<proc_bsdinfo>.size ? pid_t(info.pbi_ppid) : nil
    }
    static func birth(_ pid: pid_t) -> String? {
        exactBirth(pid).map { "darwin:" + $0 }
    }

    struct Metadata { let birth: String; let parent: pid_t; let uid: uid_t; let executable: String }
    static func metadata(_ pid: pid_t) -> Metadata? {
        var info = proc_bsdinfo()
        let size = withUnsafeMutablePointer(to: &info) {
            proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, $0, Int32(MemoryLayout<proc_bsdinfo>.size))
        }
        guard size == MemoryLayout<proc_bsdinfo>.size, info.pbi_status != 5 else { return nil }
        var path = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN))
        guard proc_pidpath(pid, &path, UInt32(path.count)) > 0 else { return nil }
        var confirmed = proc_bsdinfo()
        let confirmation = withUnsafeMutablePointer(to: &confirmed) {
            proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, $0, Int32(MemoryLayout<proc_bsdinfo>.size))
        }
        guard confirmation == MemoryLayout<proc_bsdinfo>.size, confirmed.pbi_status != 5,
              confirmed.pbi_start_tvsec == info.pbi_start_tvsec, confirmed.pbi_start_tvusec == info.pbi_start_tvusec,
              confirmed.pbi_uid == info.pbi_uid, confirmed.pbi_ppid == info.pbi_ppid else { return nil }
        let executable = String(cString: path)
        guard !executable.contains("\t"), !executable.contains("\r"), !executable.contains("\n") else { return nil }
        return Metadata(birth: "darwin:\(info.pbi_start_tvsec):\(info.pbi_start_tvusec)",
                        parent: pid_t(info.pbi_ppid), uid: info.pbi_uid, executable: executable)
    }
}

/// The permanent inode is never removed: the kernel releases ownership on every exit.
final class PresenceLock {
    private var fd: Int32
    init?(folder: URL) {
        guard let directory = try? SecureDirectory(folder), let descriptor = try? directory.openFile(".presence-flock", flags: O_RDWR, create: true) else { return nil }
        fd = descriptor
        guard flock(fd, LOCK_EX | LOCK_NB) == 0 else { close(fd); return nil }
        let text = "\(getpid())\nnative\n"
        let data = Data(text.utf8)
        do { try directory.replace(".presence-flock-owner", with: data) }
        catch { flock(fd, LOCK_UN); close(fd); return nil }
    }
    var isOwned: Bool { fd >= 0 }
    func release() {
        guard fd >= 0 else { return }
        _ = flock(fd, LOCK_UN)
        // Wake waiters after unlocking, without touching a successor's owner record.
        _ = futimens(fd, nil)
        close(fd); fd = -1
    }
    deinit { release() }
}
