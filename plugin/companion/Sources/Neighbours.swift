import Foundation
import CoreServices
import Darwin

/// Main-queue confined, opt-in reader. No historical scan, network, polling or idle timer.
/// Prefixes are parsed only for schema keys; content fields are never materialized.
struct NeighbourConfiguration: Codable, Equatable {
    struct Folder: Codable, Equatable {
        let `default`: String
        let environment: String?
        let suffix: String?
        func url(home: URL, environment values: [String: String]) -> URL {
            if let environment, let override = values[environment], !override.isEmpty {
                let base = URL(fileURLWithPath: override, isDirectory: true)
                return suffix.map { base.appendingPathComponent($0, isDirectory: true) } ?? base
            }
            let path = `default`.hasPrefix("~/") ? home.path + String(`default`.dropFirst()) : `default`
            return URL(fileURLWithPath: path, isDirectory: true)
        }
    }
    struct Agent: Codable, Equatable {
        let id: String
        let label: String
        let folder: Folder
        let filePattern: String
        let mode: String
        let typePaths: [[String]]
        let busy: [String]
        let done: [String]
        let waiting: [String]
        let quotaLimitID: String?
        func matches(_ filename: String) -> Bool {
            let pieces = filePattern.components(separatedBy: "*")
            if pieces.count == 1 { return filename == filePattern }
            return pieces.count == 2 && filename.hasPrefix(pieces[0]) && filename.hasSuffix(pieces[1])
                && filename.count >= pieces[0].count + pieces[1].count
        }
    }
    let version: Int
    let prefixBytes: Int
    let eventLatencySeconds: Double
    let agents: [Agent]

    static func load(_ url: URL) -> NeighbourConfiguration? {
        guard let directory = try? SecureDirectory(url.deletingLastPathComponent()),
              let data = try? directory.read(url.lastPathComponent, maxBytes: 65_536),
              let config = try? JSONDecoder().decode(Self.self, from: data),
              config.version == 1, (32...160).contains(config.prefixBytes),
              config.eventLatencySeconds.isFinite, (0...2).contains(config.eventLatencySeconds),
              config.agents.count <= 32, Set(config.agents.map(\.id)).count == config.agents.count,
              config.agents.allSatisfy({ agent in
                  !agent.id.isEmpty && agent.id.utf8.count <= 64 && agent.label.utf8.count <= 128
                      && ["typed", "activity"].contains(agent.mode)
                      && !agent.filePattern.contains("/") && !agent.filePattern.isEmpty
                      && agent.filePattern.components(separatedBy: "*").count <= 2
                      && agent.typePaths.count <= 4 && agent.typePaths.allSatisfy { !$0.isEmpty && $0.count <= 4 }
                      && (agent.busy + agent.done + agent.waiting).count <= 64
              }) else { return nil }
        return config
    }
}

struct NeighbourQuota: Codable, Equatable {
    struct Window: Codable, Equatable {
        var usedPercent: Double?
        var windowMinutes: Double?
        var resetsAt: Double?
    }
    var primary: Window?
    var secondary: Window?
}

struct NeighbourLight: Codable, Equatable {
    let id: String
    let label: String
    var busy = false
    var done = false
    var waiting = false
    /// The available metadata/prefixes do not prove a complete turn history.
    var partial = false
    var quota: NeighbourQuota?
    var startedAt: Double?
}

struct NeighbourSnapshot: Codable, Equatable {
    let version = 1
    var agents: [NeighbourLight]
    enum CodingKeys: String, CodingKey { case version, agents }
    init(agents: [NeighbourLight]) { self.agents = agents }
    func presenceValue(running: Bool) -> [String: Any] {
        let rows: [[String: Any]] = agents.map { light in
            var row: [String: Any] = ["id":light.id,"label":light.label,"busy":light.busy,"partial":light.partial]
            if let at = light.startedAt { row["startedAt"] = at }
            if let quota = light.quota, let encoded = try? JSONEncoder().encode(quota),
               let object = try? JSONSerialization.jsonObject(with: encoded) { row["quota"] = object }
            return row
        }
        return ["v":1,"running":running,"agents":rows]
    }
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        guard try values.decode(Int.self, forKey: .version) == 1 else {
            throw DecodingError.dataCorruptedError(forKey: .version, in: values, debugDescription: "Unknown generation")
        }
        agents = try values.decode([NeighbourLight].self, forKey: .agents)
    }
}

/// Tiny tolerant JSON-prefix walker. It retains only explicitly requested paths.
/// String values outside that allowlist are skipped, never decoded or retained.
private struct NeighbourPrefix {
    private let bytes: [UInt8]
    private var index = 0
    private let allowed: Set<String>
    private(set) var fields: [String: String] = [:]
    init(data: Data, paths: [[String]]) {
        bytes = Array(data); allowed = Set(paths.map { $0.joined(separator: ".") })
        object([])
    }
    private mutating func whitespace() {
        while index < bytes.count && [9, 10, 13, 32].contains(bytes[index]) { index += 1 }
    }
    private mutating func string(retain: Bool) -> String? {
        guard index < bytes.count, bytes[index] == 34 else { return nil }
        index += 1; let start = index
        while index < bytes.count {
            if bytes[index] == 92 { index += 2; continue }
            if bytes[index] == 34 {
                let end = index; index += 1
                guard retain else { return "" }
                // Schema keys and markers are plain ASCII; reject escaped markers.
                let slice = bytes[start..<end]
                guard !slice.contains(92), slice.allSatisfy({ $0 >= 32 && $0 < 127 }) else { return nil }
                return String(bytes: slice, encoding: .utf8)
            }
            index += 1
        }
        return nil
    }
    private mutating func object(_ path: [String]) {
        whitespace(); guard index < bytes.count, bytes[index] == 123 else { return }
        index += 1
        while index < bytes.count {
            whitespace(); guard index < bytes.count else { return }
            if bytes[index] == 125 { index += 1; return }
            guard let key = string(retain: true) else { return }
            whitespace(); guard index < bytes.count, bytes[index] == 58 else { return }; index += 1
            value(path + [key]); whitespace()
            guard index < bytes.count else { return }
            if bytes[index] == 44 { index += 1 } else if bytes[index] == 125 { index += 1; return } else { return }
        }
    }
    private mutating func value(_ path: [String]) {
        whitespace(); guard index < bytes.count else { return }
        let name = path.joined(separator: ".")
        if bytes[index] == 123 { object(path); return }
        if bytes[index] == 34 {
            if let result = string(retain: allowed.contains(name)), allowed.contains(name) { fields[name] = result }
            return
        }
        if bytes[index] == 91 {
            // Arrays can carry arbitrary content; abandon this prefix instead of traversing them.
            index = bytes.count; return
        }
        let start = index
        while index < bytes.count && ![44, 125, 9, 10, 13, 32].contains(bytes[index]) { index += 1 }
        // A number ending at the prefix boundary could be truncated: never publish it.
        if index < bytes.count && allowed.contains(name) {
            fields[name] = String(bytes: bytes[start..<index], encoding: .utf8)
        }
    }
}

final class Neighbours {
    private struct FileIdentity: Hashable {
        let device: UInt64
        let inode: UInt64
        let birthSeconds: Int64
        let birthNanoseconds: Int64
    }
    private struct Cursor {
        let identity: FileIdentity
        var device: UInt64 { identity.device }
        var inode: UInt64 { identity.inode }
        var offset: Int64 = 0
        var boundary = true
        var pendingPrefix = Data()
        var state = "unknown"
        var partial = false
        var quota: NeighbourQuota?
        var quotaTime: TimeInterval = 0
    }
    let configURL: URL
    let outputURL: URL
    private let home: URL
    private let directoryVariable: (String) -> String?
    private var configuration: NeighbourConfiguration?
    private var roots: [String: URL] = [:]
    private var rootSpellings: [String: URL] = [:]
    private var cursors: [String: Cursor] = [:]
    private var cursorPaths: [FileIdentity: String] = [:]
    // Metadata only, retained for this observation generation after a path disappears.
    // A returning inode cannot turn already consumed bytes into a newly born file.
    private var observedIdentities: Set<FileIdentity> = []
    private var fileAgents: [String: String] = [:]
    private var stream: FSEventStreamRef?
    private var streamError: String?
    private var observationStartedAt: TimeInterval?
    private var configFolderWatch: DispatchSourceFileSystemObject?
    private var configFileWatch: DispatchSourceFileSystemObject?
    private var lastWritten: NeighbourSnapshot?
    private var ownsOutput = false
    private(set) var enabled = false
    /// Main-queue callback, used by the companion health receipt. No timer or polling.
    var statusChanged: (() -> Void)?
    var changed: ((NeighbourSnapshot, Bool) -> Void)?
    private(set) var lastError: String? {
        didSet { if lastError != oldValue { statusChanged?() } }
    }
    private(set) var bytesRead: UInt64 = 0
    private(set) var writes = 0
    private(set) var truncatedBatches = 0
    /// Counts callbacks delivered by the operating system, never the explicit fixture seam.
    private(set) var deliveredFileEvents = 0
    private(set) var deliveredDirectoryEvents = 0
#if NEIGHBOURS_FIXTURE
    /// Synthetic-fixture observability only. No record contents or prefix bytes escape.
    var fixtureEventObserved: ((String, UInt32, UInt64, String) -> Void)?
    private var fixtureFileMetadata: [String: [String: Any]] = [:]
    func fixtureDiagnostics() -> [String: Any] {
        let cursorMetadata: [String: [String: Any]] = Dictionary(uniqueKeysWithValues: cursors.map { path, cursor in
            (path, ["path": path, "device": cursor.device, "inode": cursor.inode,
                    "birthSeconds": cursor.identity.birthSeconds,
                    "birthNanoseconds": cursor.identity.birthNanoseconds,
                    "offset": cursor.offset, "boundary": cursor.boundary,
                    "pendingPrefixBytes": cursor.pendingPrefix.count, "state": cursor.state,
                    "partial": cursor.partial, "agentID": fileAgents[path] ?? ""])
        })
        return ["roots": roots.mapValues { $0.path },
                "rootSpellings": rootSpellings.mapValues { $0.path },
                "cursors": cursorMetadata,
                "observedIdentityCount": observedIdentities.count,
                "observationStartedAt": observationStartedAt as Any? ?? NSNull(),
                "fileMetadata": fixtureFileMetadata]
    }
#endif
    var snapshot: NeighbourSnapshot { lastWritten ?? NeighbourSnapshot(agents: []) }
    var watcherCount: Int { (stream == nil ? 0 : 1) + (configFolderWatch == nil ? 0 : 1) + (configFileWatch == nil ? 0 : 1) }
    // Observable proof: the implementation never allocates a timer.
    var idleTimerCount: Int { 0 }

    init(configURL: URL, outputURL: URL,
         home: URL = FileManager.default.homeDirectoryForCurrentUser,
         environment: [String: String]? = nil,
         directoryVariable: @escaping (String) -> String? = { key in getenv(key).map { String(cString: $0) } }) {
        self.configURL = configURL; self.outputURL = outputURL
        self.home = home
        // Fixture dictionaries are filtered immediately; production fetches a single
        // approved directory variable only after observation is enabled.
        if let environment {
            let allowed = environment.filter { Self.allowedDirectoryVariables.contains($0.key) }
            self.directoryVariable = { allowed[$0] }
        } else { self.directoryVariable = directoryVariable }
    }
    private static let allowedDirectoryVariables: Set<String> = ["CODEX_HOME", "INTERPRETER_HOME", "COPILOT_HOME", "PI_CODING_AGENT_SESSION_DIR"]
    private func directoryValues(for folder: NeighbourConfiguration.Folder) -> [String: String] {
        guard enabled, let key = folder.environment, Self.allowedDirectoryVariables.contains(key), let value = directoryVariable(key) else { return [:] }
        return [key: value]
    }
    deinit { stop() }

    func setEnabled(_ value: Bool) {
        guard value != enabled else { return }
        if !value { stop(); return }
        enabled = true; reloadConfiguration()
        configFolderWatch = watch(configURL.deletingLastPathComponent()) { [weak self] in
            self?.reloadConfiguration(); self?.watchConfigurationFile()
        }
        watchConfigurationFile()
        statusChanged?()
    }
    func stop() {
        enabled = false; stopStream(); observationStartedAt = nil
#if NEIGHBOURS_FIXTURE
        fixtureFileMetadata.removeAll()
#endif
        configFolderWatch?.cancel(); configFolderWatch = nil
        configFileWatch?.cancel(); configFileWatch = nil
        cursors.removeAll(); cursorPaths.removeAll(); observedIdentities.removeAll()
        fileAgents.removeAll(); roots.removeAll(); rootSpellings.removeAll(); configuration = nil
        lastWritten = nil
        changed?(NeighbourSnapshot(agents: []), false)
        // Only remove a receipt that this instance created and that is still our exact receipt.
        // A different writer's file is never deleted.
        if ownsOutput, let expected = ownedBytes, let identity = ownedIdentity, let directory = try? SecureDirectory(outputURL.deletingLastPathComponent()),
           let present = try? directory.read(outputURL.lastPathComponent, maxBytes: 65_536), present == expected {
            // Relative unlink never follows the leaf; replacement identity is checked again.
            if let fd = try? directory.openFile(outputURL.lastPathComponent) {
                let before = try? directory.verify(fd); close(fd)
                var current = stat()
                if fstatat(directory.fd, outputURL.lastPathComponent, &current, AT_SYMLINK_NOFOLLOW) == 0,
                   before?.st_ino == identity.inode, before?.st_dev == identity.device,
                   current.st_ino == identity.inode, current.st_dev == identity.device,
                   current.st_uid == getuid(), current.st_nlink == 1, current.st_mode & S_IFMT == S_IFREG {
                    _ = unlinkat(directory.fd, outputURL.lastPathComponent, 0)
                }
            }
        }
        ownsOutput = false; ownedBytes = nil; ownedIdentity = nil
        statusChanged?()
    }
    private var ownedBytes: Data?
    private var ownedIdentity: (device: dev_t, inode: ino_t)?
    private func watch(_ url: URL, action: @escaping () -> Void) -> DispatchSourceFileSystemObject? {
        let fd = open(url.path, O_EVTONLY | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { return nil }
        let source = DispatchSource.makeFileSystemObjectSource(fileDescriptor: fd,
            eventMask: [.write, .rename, .delete, .extend, .attrib], queue: .main)
        source.setEventHandler(handler: action); source.setCancelHandler { close(fd) }; source.resume()
        return source
    }
    private func watchConfigurationFile() {
        configFileWatch?.cancel(); configFileWatch = nil
        guard enabled else { return }
        configFileWatch = watch(configURL) { [weak self] in self?.reloadConfiguration() }
    }
    /// Explicit seam for fixture checks; production calls it only from a vnode file event.
    func reloadConfiguration() {
        guard enabled else { return }
        guard let next = NeighbourConfiguration.load(configURL) else {
            lastError = "neighbours-config-invalid"; return // Retain the last valid schema and active watches.
        }
        guard next != configuration else {
            if lastError == "neighbours-config-invalid" { lastError = streamError }
            return
        }
        stopStream(); configuration = next; cursors.removeAll(); cursorPaths.removeAll()
        observedIdentities.removeAll(); fileAgents.removeAll()
        roots = Dictionary(uniqueKeysWithValues: next.agents.compactMap { agent in
            let root = canonicalRoot(agent.folder.url(home: home, environment: directoryValues(for: agent.folder)))
            // A config cannot redirect this feature into Claude's configuration or application bundles.
            guard !root.pathComponents.contains(".claude"), !root.pathComponents.contains("Applications"),
                  !root.path.contains("/Application Support/Claude") else { return nil }
            return (agent.id, root)
        })
        rootSpellings = Dictionary(uniqueKeysWithValues: next.agents.compactMap { agent in
            guard roots[agent.id] != nil else { return nil }
            return (agent.id, URL(fileURLWithPath: lexicalPath(agent.folder.url(home: home, environment: directoryValues(for: agent.folder)))))
        })
        // A changed configuration begins a new observation generation. A file
        // born earlier is historical even if a delayed event says Created/Renamed.
        observationStartedAt = Date().timeIntervalSince1970
        streamError = nil; lastError = nil; startStream(); publish()
    }
    private func startStream() {
        guard enabled, let configuration, !roots.isEmpty else { return }
        // A missing store is watched at its closest existing parent. Callback filtering still
        // permits reads only beneath the declared agent root and matching basename.
        let paths = Set(roots.values.map { root -> String in
            var parent = root
            var directory: ObjCBool = false
            while !FileManager.default.fileExists(atPath: parent.path, isDirectory: &directory) || !directory.boolValue {
                let next = parent.deletingLastPathComponent(); if next == parent { break }; parent = next
            }
            return parent.path
        }).sorted()
        var context = FSEventStreamContext(version: 0, info: Unmanaged.passUnretained(self).toOpaque(),
                                          retain: nil, release: nil, copyDescription: nil)
        let callback: FSEventStreamCallback = { _, context, count, paths, flags, eventIDs in
            guard let context else { return }
            let watcher = Unmanaged<Neighbours>.fromOpaque(context).takeUnretainedValue()
            let array = unsafeBitCast(paths, to: NSArray.self)
            for index in 0..<count {
                let flag = flags[index]
#if NEIGHBOURS_FIXTURE
                let dropped = flag & UInt32(kFSEventStreamEventFlagMustScanSubDirs | kFSEventStreamEventFlagUserDropped | kFSEventStreamEventFlagKernelDropped) != 0
                let kind = dropped ? "dropped" : flag & UInt32(kFSEventStreamEventFlagItemIsDir) != 0 ? "directory" : "file"
                watcher.fixtureEventObserved?(array[index] as? String ?? "", flag, UInt64(eventIDs[index]), kind)
#endif
                guard let path = array[index] as? String else { continue }
                if flag & UInt32(kFSEventStreamEventFlagMustScanSubDirs | kFSEventStreamEventFlagUserDropped | kFSEventStreamEventFlagKernelDropped) != 0 {
                    watcher.handleEvent(URL(fileURLWithPath: path), flags: flag); continue
                }
                if flag & UInt32(kFSEventStreamEventFlagItemIsDir) != 0 { watcher.deliveredDirectoryEvents += 1 }
                else { watcher.deliveredFileEvents += 1 }
                watcher.handleEvent(URL(fileURLWithPath: path), flags: flag)
            }
        }
        stream = FSEventStreamCreate(nil, callback, &context, paths as CFArray, FSEventStreamEventId(kFSEventStreamEventIdSinceNow),
            configuration.eventLatencySeconds, FSEventStreamCreateFlags(kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagUseCFTypes | kFSEventStreamCreateFlagNoDefer))
        guard let stream else { streamError = "neighbours-watch-create"; lastError = streamError; return }
        FSEventStreamSetDispatchQueue(stream, .main)
        if !FSEventStreamStart(stream) { stopStream(); streamError = "neighbours-watch-start"; lastError = streamError }
    }
    /// Routes actual FSEvents flags. Captured fixture replay uses the same path;
    /// only the OS callback increments delivered-event counters.
    func handleEvent(_ url: URL, flags: UInt32) {
        guard enabled else { return }
        if flags & UInt32(kFSEventStreamEventFlagMustScanSubDirs | kFSEventStreamEventFlagUserDropped | kFSEventStreamEventFlagKernelDropped) != 0 {
            // Privacy boundary forbids an unbounded historical rescan.
            streamError = "neighbours-events-dropped"
            lastError = streamError; return
        }
        if flags & UInt32(kFSEventStreamEventFlagItemIsDir) != 0 {
            directoryEvent(url); return
        }
        fileEvent(url, observedEvent: true)
    }
    private func stopStream() {
        if let stream { FSEventStreamStop(stream); FSEventStreamInvalidate(stream); FSEventStreamRelease(stream) }
        stream = nil
    }
    private func canonicalRoot(_ url: URL) -> URL {
        var path = lexicalPath(url)
        var missingComponents: [String] = []
        while true {
            if let resolved = realpath(path, nil) {
                defer { free(resolved) }
                let suffix = missingComponents.reversed().joined(separator: "/")
                let root = String(cString: resolved)
                return URL(fileURLWithPath: suffix.isEmpty ? root : root + "/" + suffix, isDirectory: true)
            }
            let parent = URL(fileURLWithPath: path).deletingLastPathComponent()
            guard parent.path != path else { return URL(fileURLWithPath: lexicalPath(url), isDirectory: true) }
            missingComponents.append(URL(fileURLWithPath: path).lastPathComponent)
            path = parent.path
        }
    }
    private func lexicalPath(_ url: URL) -> String {
        // standardizedFileURL can change /private/tmp to /tmp only while the leaf
        // exists. A delete event must use the same cursor key as its create event.
        // Normalize dot components without consulting the file system or symlinks.
        var components: [Substring] = []
        for component in url.path.split(separator: "/") {
            if component == "." { continue }
            if component == ".." { if !components.isEmpty { components.removeLast() }; continue }
            components.append(component)
        }
        return "/" + components.joined(separator: "/")
    }
    private func recordParentsExist(_ path: String, root: URL) -> Bool {
        var parentPath = root.path
        let descendants = path.dropFirst(root.path.count + 1).split(separator: "/").dropLast()
        // Check from the approved root outward, so no lstat traverses an unchecked symlink.
        for component in [Substring("")] + Array(descendants) {
            if !component.isEmpty { parentPath += "/" + component }
            var info = stat()
            guard lstat(parentPath, &info) == 0, info.st_mode & S_IFMT == S_IFDIR else { return false }
        }
        return true
    }
    private func rememberCursor(_ cursor: Cursor, at path: String, agentID: String) {
        if let old = cursors[path], old.identity != cursor.identity, cursorPaths[old.identity] == path {
            cursorPaths.removeValue(forKey: old.identity)
        }
        if let oldPath = cursorPaths[cursor.identity], oldPath != path {
            cursors.removeValue(forKey: oldPath); fileAgents.removeValue(forKey: oldPath)
        }
        cursors[path] = cursor; fileAgents[path] = agentID
        cursorPaths[cursor.identity] = path; observedIdentities.insert(cursor.identity)
    }
    @discardableResult private func forgetCursor(at path: String) -> Bool {
        guard let cursor = cursors.removeValue(forKey: path) else { return false }
        if cursorPaths[cursor.identity] == path { cursorPaths.removeValue(forKey: cursor.identity) }
        fileAgents.removeValue(forKey: path)
        return true
    }
    /// Directory events reconcile only already tracked paths; they never enumerate or read records.
    func directoryEvent(_ url: URL) {
        guard enabled else { return }
        let incoming = lexicalPath(url)
        var changed = false
        for (id, root) in roots {
            let spelling = rootSpellings[id]?.path ?? root.path
            let path: String
            if incoming == root.path || incoming.hasPrefix(root.path + "/") { path = incoming }
            else if incoming == spelling || incoming.hasPrefix(spelling + "/") {
                path = root.path + String(incoming.dropFirst(spelling.count))
            } else { continue }
            for record in cursors.keys.filter({ $0.hasPrefix(path + "/") }) {
                guard recordParentsExist(record, root: root) else {
                    forgetCursor(at: record); changed = true; continue
                }
                var info = stat()
                let result = lstat(record, &info)
                if (result != 0 && (errno == ENOENT || errno == ENOTDIR))
                    || (result == 0 && info.st_mode & S_IFMT != S_IFREG) {
                    forgetCursor(at: record); changed = true
                }
            }
        }
        if changed { publish() }
    }
    /// Only metadata and the approved prefix of newly appended lines; safe to call with fixtures.
    func fileEvent(_ url: URL, isNew: Bool = false, observedEvent: Bool = false) {
        guard enabled, let configuration else { return }
        let incomingPath = lexicalPath(url)
        guard let agent = configuration.agents.first(where: { agent in
            guard let root = roots[agent.id] else { return false }
            let spelling = rootSpellings[agent.id]?.path ?? root.path
            return (incomingPath.hasPrefix(root.path + "/") || incomingPath.hasPrefix(spelling + "/"))
                && agent.matches(url.lastPathComponent)
        }) else { return }
        guard let root = roots[agent.id] else { return }
        // FSEvents may use a resolved root while callers/configuration use a symlink
        // spelling (for example /var and /private/var). Map only that declared root,
        // never resolve record descendants: their symlinks must still be rejected.
        let spelling = rootSpellings[agent.id]?.path ?? root.path
        let path = incomingPath.hasPrefix(root.path + "/") ? incomingPath
            : root.path + String(incomingPath.dropFirst(spelling.count))
        // Reject missing and symlink parents before opening a leaf; deletion clears only
        // an already known cursor. Parent checks never traverse an unchecked symlink.
        guard recordParentsExist(path, root: root) else {
            if forgetCursor(at: path) { publish() }
            return
        }
        let fd = open(path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else {
            if forgetCursor(at: path) { publish() }
            return
        }
        defer { close(fd) }
        var info = stat()
        guard fstat(fd, &info) == 0, info.st_mode & S_IFMT == S_IFREG else { return }
        let size = Int64(info.st_size)
        let previouslySeen = cursors[path] != nil
        let birth = info.st_birthtimespec
        let identity = FileIdentity(device: UInt64(info.st_dev), inode: UInt64(info.st_ino),
            birthSeconds: Int64(birth.tv_sec), birthNanoseconds: Int64(birth.tv_nsec))
        let knownCursor = cursorPaths[identity].flatMap { cursors[$0] }
        let sameIdentity = knownCursor != nil
        let wasObserved = observedIdentities.contains(identity)
        let bornAt = TimeInterval(birth.tv_sec) + Double(birth.tv_nsec) / 1e9
        let bornDuringObservation = observationStartedAt.map { start in
            birth.tv_sec > 0 && (0..<1_000_000_000).contains(birth.tv_nsec)
                && bornAt > start && bornAt <= Date().timeIntervalSince1970
        } ?? false
#if NEIGHBOURS_FIXTURE
        fixtureFileMetadata[path] = ["birthSeconds": birth.tv_sec, "birthNanoseconds": birth.tv_nsec,
            "size": size, "sameIdentity": sameIdentity, "wasObserved": wasObserved, "observedEvent": observedEvent,
            "bornDuringObservation": bornDuringObservation]
#endif
        var cursor = knownCursor ?? cursors[path] ?? Cursor(identity: identity)
        // Atomic writes can deliver only Rename+Modify for the final basename;
        // Modified can also arrive before Created. For every unseen live inode,
        // use its birth time instead of flag order to prove it was born while watched.
        // A historical or previously consumed returning inode anchors EOF. Active
        // matching names share the same cursor, including rename and hardlink aliases.
        let initializeAtEOF = observedEvent ? !sameIdentity && (!bornDuringObservation || wasObserved)
            : !sameIdentity && !previouslySeen && !isNew
        if initializeAtEOF && agent.mode != "activity" {
            cursor = Cursor(identity: identity)
            cursor.offset = size; cursor.boundary = false; cursor.partial = true
            rememberCursor(cursor, at: path, agentID: agent.id); publish(); return
        }
        if cursor.identity != identity || size < cursor.offset {
            cursor = Cursor(identity: identity)
        }
        guard size > cursor.offset else { rememberCursor(cursor, at: path, agentID: agent.id); publish(); return }
        if agent.mode == "activity" {
            // Pi's stopReason is after content: stat-only activity, never a fabricated done.
            cursor.state = "busy"; cursor.offset = size; cursor.partial = true
        } else if cursor.boundary {
            while cursor.offset < size {
                var prefix = cursor.pendingPrefix; var newline = false
                while cursor.offset < size && prefix.count < configuration.prefixBytes {
                    var byte: UInt8 = 0
                    guard pread(fd, &byte, 1, off_t(cursor.offset)) == 1 else { break }
                    bytesRead += 1; cursor.offset += 1
                    if byte == 10 { newline = true; break }
                    prefix.append(byte)
                }
                if !newline && cursor.offset == size && prefix.count < configuration.prefixBytes {
                    // Retain at most the approved prefix and consume each byte once.
                    // Repeated callbacks or fragmented writes must not reread the line.
                    cursor.pendingPrefix = prefix; break
                }
                cursor.pendingPrefix = Data()
                apply(prefix, agent: agent, cursor: &cursor, modified: TimeInterval(info.st_mtimespec.tv_sec) + Double(info.st_mtimespec.tv_nsec) / 1e9)
                if !newline {
                    // No suffix byte is read, even to search for a delimiter. Metadata does
                    // not prove the next line boundary. Later appends are therefore skipped
                    // until replacement/truncation resets the cursor. This is intentionally
                    // partial detection: a type seen in this prefix is the only reliable fact.
                    cursor.boundary = false; cursor.partial = true
                    cursor.offset = size; truncatedBatches += 1; break
                }
            }
        } else {
            // The previous boundary is unproven. Even an append-start or EOF probe could
            // read content, so use metadata only and wait for replacement/truncation.
            cursor.offset = size
        }
        rememberCursor(cursor, at: path, agentID: agent.id); publish()
    }
    private func apply(_ prefix: Data, agent: NeighbourConfiguration.Agent, cursor: inout Cursor, modified: TimeInterval) {
        let quotaRoots = ["payload", "rate_limits"]
        var allowed = agent.typePaths
        allowed.append(quotaRoots + ["limit_id"])
        for window in ["primary", "secondary"] {
            for field in ["used_percent", "window_minutes", "resets_at"] { allowed.append(quotaRoots + [window, field]) }
        }
        let fields = NeighbourPrefix(data: prefix, paths: allowed).fields
        let kind = agent.typePaths.reversed().compactMap { fields[$0.joined(separator: ".")] }.first
        if let kind {
            if agent.done.contains(kind) { cursor.state = "done" }
            else if agent.waiting.contains(kind) { cursor.state = "waiting" }
            else if agent.busy.contains(kind) { cursor.state = "busy" }
        }
        guard kind == "token_count", let limit = agent.quotaLimitID,
              fields["payload.rate_limits.limit_id"] == limit else { return }
        func window(_ name: String) -> NeighbourQuota.Window? {
            func number(_ field: String) -> Double? {
                guard let raw = fields["payload.rate_limits." + name + "." + field], let value = Double(raw), value.isFinite else { return nil }
                if field == "used_percent" { return (0...100).contains(value) ? value : nil }
                return value >= 0 ? value : nil
            }
            let value = NeighbourQuota.Window(usedPercent: number("used_percent"), windowMinutes: number("window_minutes"), resetsAt: number("resets_at"))
            return value.usedPercent != nil || value.windowMinutes != nil || value.resetsAt != nil ? value : nil
        }
        let value = NeighbourQuota(primary: window("primary"), secondary: window("secondary"))
        if value.primary != nil || value.secondary != nil { cursor.quota = value; cursor.quotaTime = modified }
    }
    private func publish() {
        guard enabled, let configuration else { return }
        let lights = configuration.agents.map { agent -> NeighbourLight in
            let records = cursors.filter { fileAgents[$0.key] == agent.id }.map(\.value)
            var light = NeighbourLight(id: agent.id, label: agent.label)
            light.busy = records.contains { $0.state == "busy" }
            light.waiting = records.contains { $0.state == "waiting" }
            light.done = !light.busy && !light.waiting && records.contains { $0.state == "done" }
            light.partial = agent.mode == "activity" || records.contains { $0.partial }
            if light.busy && !light.partial {
                let old = lastWritten?.agents.first { $0.id == agent.id }
                light.startedAt = old?.busy == true && old?.partial == false ? old?.startedAt : Date().timeIntervalSince1970 * 1000
            }
            light.quota = records.filter { $0.quota != nil }.max { $0.quotaTime < $1.quotaTime }?.quota
            return light
        }
        let next = NeighbourSnapshot(agents: lights)
        guard next != lastWritten else { return }
        do {
            let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
            let data = try encoder.encode(next)
            let directory = try SecureDirectory(outputURL.deletingLastPathComponent(), create: true)
            let published = try directory.replace(outputURL.lastPathComponent, with: data)
            ownedIdentity = (published.st_dev, published.st_ino)
            changed?(next, true)
            lastWritten = next; ownedBytes = data; ownsOutput = true; writes += 1
            statusChanged?()
        } catch { lastError = "neighbours-output-write" }
    }
}
