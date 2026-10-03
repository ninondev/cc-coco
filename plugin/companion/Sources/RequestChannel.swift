import Foundation

enum RequestKind: String { case submit, clear, seen }

/// Request text stays in the live channel only; it is never copied into settings.
struct ChannelRequest: Equatable {
    let id: String
    let session: String
    let at: Double
    let kind: RequestKind
    let text: String?
    let upto: Double?

    var object: [String: Any] {
        var value: [String: Any] = ["v": 1, "id": id, "session": session,
                                    "at": at, "kind": kind.rawValue]
        if let text { value["text"] = text }
        if let upto { value["upto"] = upto }
        return value
    }
}

enum RequestDecision: Equatable { case sending, acknowledged, unconfirmed, expired }

/// The event that arms the UI's one-shot supplies the clock; no timer lives here.
struct PendingRequest: Equatable {
    let request: ChannelRequest
    let attemptedAt: Double

    init(request: ChannelRequest, attemptedAt: Double? = nil) {
        self.request = request
        self.attemptedAt = attemptedAt ?? request.at
    }

    var text: String { request.text ?? "" }
    static let timeout: Double = 5_000

    func decision(ack: String?, now: Double) -> RequestDecision {
        if ack == request.id { return .acknowledged }
        if abs(now - request.at) > RequestChannel.lifetime { return .expired }
        if now - attemptedAt >= Self.timeout { return .unconfirmed }
        return .sending
    }
}

enum RequestChannelError: Error, Equatable { case invalidRequest, createFailed, expiredRequest, notOutstanding }

/// One companion writer, called on its UI thread. Redaction keeps tail readers
/// on the same inode and byte offsets, even when they are behind another session.
final class RequestChannel {
    let file: URL
    static let lifetime: Double = 60_000
    private var outstanding: [String: ChannelRequest] = [:]
    private var offsets: [String: [Range<UInt64>]] = [:]
    private var indexed = false
    var nextExpiry: Double? { outstanding.values.map { $0.at + Self.lifetime + 1 }.min() }

    init(folder: URL, now: Double = Date().timeIntervalSince1970 * 1_000) throws {
        let fm = FileManager.default
        try fm.createDirectory(at: folder, withIntermediateDirectories: true,
                               attributes: [.posixPermissions: 0o700])
        try fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: folder.path)
        file = folder.appendingPathComponent("requests.jsonl")
        if !fm.fileExists(atPath: file.path) {
            guard fm.createFile(atPath: file.path, contents: Data(),
                                attributes: [.posixPermissions: 0o600]) else {
                throw RequestChannelError.createFailed
            }
        }
        try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
        try cleanup(now: now)
    }

    static func randomID() -> String {
        var random = SystemRandomNumberGenerator()
        return (0..<16).map { _ in String(format: "%02x", UInt8.random(in: .min ... .max, using: &random)) }.joined()
    }

    @discardableResult
    func append(session: String, kind: RequestKind, text: String? = nil,
                upto: Double? = nil, at: Double) throws -> ChannelRequest {
        guard !session.isEmpty, at.isFinite, at > 0 else { throw RequestChannelError.invalidRequest }
        var content: String?
        if kind == .submit {
            guard let text else { throw RequestChannelError.invalidRequest }
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard (1...4_000).contains(trimmed.count), !trimmed.contains("\0") else {
                throw RequestChannelError.invalidRequest
            }
            content = trimmed
        }
        if kind == .seen {
            guard let upto, upto.isFinite, upto >= 0 else { throw RequestChannelError.invalidRequest }
        }
        let request = ChannelRequest(id: Self.randomID(), session: session, at: at,
                                     kind: kind, text: content, upto: kind == .seen ? upto : nil)
        try cleanup(now: at)
        try write(request)
        return request
    }

    private func write(_ request: ChannelRequest) throws {
        var line = try JSONSerialization.data(withJSONObject: request.object, options: [.sortedKeys])
        line.append(0x0a)
        guard line.count <= 8_192 else { throw RequestChannelError.invalidRequest }
        let handle = try FileHandle(forWritingTo: file)
        defer { try? handle.close() }
        let start = try handle.seekToEnd()
        try handle.write(contentsOf: line)
        outstanding[request.id] = request
        offsets[request.id, default: []].append(start..<(start + UInt64(line.count - 1)))
    }

    /// Find the original live operation after reopening Activity or restarting the companion.
    func outstandingRequest(session: String, kind: RequestKind, text: String? = nil,
                            now: Double) throws -> ChannelRequest? {
        try cleanup(now: now)
        let trimmed = text?.trimmingCharacters(in: .whitespacesAndNewlines)
        return outstanding.values.filter {
            $0.session == session && $0.kind == kind && (kind != .submit || $0.text == trimmed)
        }.max { $0.at < $1.at }
    }

    /// Retry delivery, keeping the reader's deduplication key and original expiry deadline.
    @discardableResult
    func retry(_ request: ChannelRequest, now: Double) throws -> ChannelRequest {
        guard now.isFinite else { throw RequestChannelError.invalidRequest }
        try cleanup(now: now)
        guard abs(now - request.at) <= Self.lifetime else { throw RequestChannelError.expiredRequest }
        guard outstanding[request.id] == request else { throw RequestChannelError.notOutstanding }
        try write(request)
        return request
    }

    @discardableResult
    func acknowledge(_ id: String) throws -> Bool {
        guard outstanding[id] != nil else { return false }
        try redactOffsets(for: id)
        outstanding.removeValue(forKey: id)
        offsets.removeValue(forKey: id)
        return true
    }

    /// Purge expired/invalid text in place and restore every remaining live ID.
    /// Exactly 60 seconds remains valid, matching the TypeScript reader.
    @discardableResult
    func cleanup(now: Double) throws -> Int {
        guard now.isFinite else { throw RequestChannelError.invalidRequest }
        if !indexed {
            // Only startup scans retained padding. Normal operations use the live offset index.
            var live: [String: ChannelRequest] = [:]
            var ranges: [String: [Range<UInt64>]] = [:]
            var removed = Set<String>()
            try redactExisting { request, range in
                guard let request else { return true }
                if abs(now - request.at) > Self.lifetime {
                    removed.insert(request.id)
                    return true
                }
                live[request.id] = request
                ranges[request.id, default: []].append(range)
                return false
            }
            outstanding = live; offsets = ranges; indexed = true
            return removed.count
        }
        let expired = outstanding.values.filter { abs(now - $0.at) > Self.lifetime }.map(\.id)
        for id in expired {
            try redactOffsets(for: id)
            outstanding.removeValue(forKey: id)
            offsets.removeValue(forKey: id)
        }
        return expired.count
    }

    private func redactOffsets(for id: String) throws {
        let handle = try FileHandle(forWritingTo: file)
        defer { try? handle.close() }
        for range in offsets[id] ?? [] {
            try handle.seek(toOffset: range.lowerBound)
            try handle.write(contentsOf: Data(repeating: 0x20, count: Int(range.count)))
        }
    }

    /// Scrub line bytes with ASCII spaces, retaining newlines and total length.
    /// Shrinking even an empty queue could race tail's truncation detection when
    /// the next append happens quickly, so compaction requires all readers stopped.
    private func redactExisting(where remove: (ChannelRequest?, Range<UInt64>) -> Bool) throws {
        let bytes = [UInt8](try Data(contentsOf: file))
        let handle = try FileHandle(forWritingTo: file)
        defer { try? handle.close() }
        var start = 0
        while start < bytes.count {
            let end = bytes[start...].firstIndex(of: 0x0a) ?? bytes.count
            let line = Data(bytes[start..<end])
            let request = end < bytes.count ? Self.decode(line) : nil
            if remove(request, UInt64(start)..<UInt64(end)), bytes[start..<end].contains(where: { $0 != 0x20 && $0 != 0x0d }) {
                try handle.seek(toOffset: UInt64(start))
                try handle.write(contentsOf: Data(repeating: 0x20, count: end - start))
            }
            start = end + 1
        }
        // A crash can leave a partial line. Preserve its offset and delimit it
        // before future appends so the next request remains a complete JSON line.
        if let last = bytes.last, last != 0x0a {
            try handle.seekToEnd()
            try handle.write(contentsOf: Data([0x0a]))
        }
    }

    private static func decode(_ line: Data) -> ChannelRequest? {
        guard line.count <= 8_192,
              let object = (try? JSONSerialization.jsonObject(with: line)) as? [String: Any],
              object["v"] as? Int == 1,
              let id = object["id"] as? String, (16...32).contains(id.count),
              id.allSatisfy({ "0123456789abcdefABCDEF".contains($0) }),
              let session = object["session"] as? String, !session.isEmpty,
              let at = object["at"] as? Double, at.isFinite, at > 0,
              let name = object["kind"] as? String, let kind = RequestKind(rawValue: name) else { return nil }
        let text = object["text"] as? String
        let upto = object["upto"] as? Double
        if kind == .submit {
            guard let text, (1...4_000).contains(text.trimmingCharacters(in: .whitespacesAndNewlines).count),
                  !text.contains("\0") else { return nil }
        }
        if kind == .seen {
            guard let upto, upto.isFinite, upto >= 0 else { return nil }
        }
        return ChannelRequest(id: id, session: session, at: at, kind: kind, text: text, upto: upto)
    }
}
