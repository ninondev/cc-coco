import Foundation
import Darwin

/// A note to a session (submit), its replies seen, and the DM thread's message and its read mark (the plugin's
/// channel.ts takes `dm` into Talk, `dmSeen` clears her unread).
enum RequestKind: String {
    case submit, seen, dm, dmSeen
    /// The kinds that carry the person's text.
    var written: Bool { self == .submit || self == .dm }
}

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

/// One UI-thread writer. Atomic replacements delimit reader generations.
final class RequestChannel {
    let file: URL
    static let lifetime: Double = 60_000
    static let maxBytes = 1_048_576
    static let maxLive = 128
    static let maxLines = 256
    private let directory: SecureDirectory
    private var journal = Data()
    private var generation: (dev_t, ino_t)?
    private var outstanding: [String: ChannelRequest] = [:]
    private var offsets: [String: [Range<UInt64>]] = [:]
    private var indexed = false
    var nextExpiry: Double? { outstanding.values.map { $0.at + Self.lifetime + 1 }.min() }

    init(folder: URL, now: Double = Date().timeIntervalSince1970 * 1_000) throws {
        directory = try SecureDirectory(folder, create: true)
        file = folder.appendingPathComponent("requests.jsonl")
        let descriptor = try directory.openFile("requests.jsonl", flags: O_RDWR, create: true)
        defer { close(descriptor) }
        guard fchmod(descriptor, 0o600) == 0 else { throw RequestChannelError.createFailed }
        let info = try directory.verify(descriptor)
        generation = (info.st_dev, info.st_ino)
        do { journal = try directory.read("requests.jsonl", maxBytes: Self.maxBytes) }
        catch SecureFileError.tooLarge { try publish(Data()) }
        try cleanup(now: now)
    }

    private func publish(_ next: Data) throws {
        let info = try directory.replace("requests.jsonl", with: next)
        generation = (info.st_dev, info.st_ino)
    }

    private func refresh() throws {
        let descriptor = try directory.openFile("requests.jsonl", flags: O_WRONLY)
        defer { close(descriptor) }
        let info = try directory.verify(descriptor)
        if let generation, generation.0 == info.st_dev, generation.1 == info.st_ino { return }
        do { journal = try directory.read("requests.jsonl", maxBytes: Self.maxBytes) }
        catch SecureFileError.tooLarge {
            try publish(Data()); journal = Data(); indexed = false; return
        }
        generation = (info.st_dev, info.st_ino)
        indexed = false
    }

    static func randomID() -> String {
        var random = SystemRandomNumberGenerator()
        return (0..<16).map { _ in String(format: "%02x", UInt8.random(in: .min ... .max, using: &random)) }.joined()
    }

    @discardableResult
    func append(session: String, kind: RequestKind, text: String? = nil,
                upto: Double? = nil, at: Double) throws -> ChannelRequest {
        guard !session.isEmpty, session.utf8.count <= 256, at.isFinite, at > 0 else { throw RequestChannelError.invalidRequest }
        var content: String?
        if kind.written {
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
        guard outstanding[request.id] != nil || outstanding.count < Self.maxLive else {
            throw RequestChannelError.invalidRequest
        }
        if journal.count > Self.maxBytes - line.count || offsets.values.reduce(0, { $0 + $1.count }) >= Self.maxLines {
            try compact()
        }
        let start = UInt64(journal.count)
        var next = journal
        next.append(line)
        guard next.count <= Self.maxBytes else { throw RequestChannelError.invalidRequest }
        try publish(next)
        journal = next
        outstanding[request.id] = request
        offsets[request.id, default: []].append(start..<(start + UInt64(line.count - 1)))
    }

    private func compact() throws {
        var next = Data(), ranges: [String: [Range<UInt64>]] = [:]
        for request in outstanding.values.sorted(by: { $0.at == $1.at ? $0.id < $1.id : $0.at < $1.at }) {
            var line = try JSONSerialization.data(withJSONObject: request.object, options: [.sortedKeys])
            let start = UInt64(next.count)
            ranges[request.id] = [start..<(start + UInt64(line.count))]
            line.append(0x0a); next.append(line)
        }
        guard next.count <= Self.maxBytes else { throw RequestChannelError.invalidRequest }
        try publish(next)
        journal = next; offsets = ranges
    }

    /// Find the original live operation after reopening Activity or restarting the companion.
    func outstandingRequest(session: String, kind: RequestKind, text: String? = nil,
                            now: Double) throws -> ChannelRequest? {
        try cleanup(now: now)
        let trimmed = text?.trimmingCharacters(in: .whitespacesAndNewlines)
        return outstanding.values.filter {
            $0.session == session && $0.kind == kind && (!kind.written || $0.text == trimmed)
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
        guard let original = outstanding[id] else { return false }
        try cleanup(now: original.at)
        guard outstanding[id] != nil else { return false }
        try redactOffsets(for: id)
        outstanding.removeValue(forKey: id)
        offsets.removeValue(forKey: id)
        return true
    }

    /// Publish expired/invalid text removal and restore every remaining live ID.
    /// Exactly 60 seconds remains valid, matching the TypeScript reader.
    @discardableResult
    func cleanup(now: Double) throws -> Int {
        guard now.isFinite else { throw RequestChannelError.invalidRequest }
        try refresh()
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
                guard live[request.id] != nil || live.count < Self.maxLive,
                      ranges.values.reduce(0, { $0 + $1.count }) < Self.maxLines else { return true }
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
        var next = journal
        for range in offsets[id] ?? [] {
            guard range.upperBound <= UInt64(next.count) else { throw RequestChannelError.createFailed }
            next.replaceSubrange(Int(range.lowerBound)..<Int(range.upperBound), with: repeatElement(UInt8(0x20), count: Int(range.count)))
        }
        try publish(next)
        journal = next
    }

    /// Startup work is capped by maxBytes, maxLive and maxLines; malformed
    /// and expired bytes are removed before a new atomic generation is published.
    private func redactExisting(where remove: (ChannelRequest?, Range<UInt64>) -> Bool) throws {
        var next = journal
        var start = 0, scanned = 0
        while start < journal.count {
            if scanned >= 4096 {
                next.replaceSubrange(start..<next.count, with: repeatElement(UInt8(0x20), count: next.count - start))
                break
            }
            scanned += 1
            let end = journal[start...].firstIndex(of: 0x0a) ?? journal.count
            let line = journal.subdata(in: start..<end)
            let request = end < journal.count ? Self.decode(line) : nil
            let state = end < journal.count && Self.isState(line)
            if !state && remove(request, UInt64(start)..<UInt64(end)) {
                next.replaceSubrange(start..<end, with: repeatElement(UInt8(0x20), count: end - start))
            }
            start = end + 1
        }
        if let last = next.last, last != 0x0a {
            if next.count == Self.maxBytes { next[next.count - 1] = 0x0a } else { next.append(0x0a) }
        }
        if next != journal {
            try publish(next)
            journal = next
        }
    }

    private static func isState(_ line: Data) -> Bool {
        let keys = Set(["running", "accessibility", "hiddenUntil", "answered", "size", "sizeAt", "loginAt", "followAt", "login", "capture", "captureAt", "version"])
        guard line.count <= 2048,
              let object = (try? JSONSerialization.jsonObject(with: line)) as? [String: Any],
              Set(object.keys).isSubset(of: ["v", "kind", "at", "info"]), object["v"] as? Int == 1,
              object["kind"] as? String == "companion-state",
              let at = object["at"] as? Double, at.isFinite,
              let info = object["info"] as? [String: Any], Set(info.keys).isSubset(of: keys) else { return false }
        return info.values.allSatisfy { value in
            if let text = value as? String { return text.utf8.count <= 256 }
            if let number = value as? NSNumber { return number.doubleValue.isFinite }
            return false
        }
    }

    private static func decode(_ line: Data) -> ChannelRequest? {
        guard line.count <= 8_192,
              let object = (try? JSONSerialization.jsonObject(with: line)) as? [String: Any],
              object["v"] as? Int == 1,
              let id = object["id"] as? String, (16...32).contains(id.count),
              id.allSatisfy({ "0123456789abcdefABCDEF".contains($0) }),
              let session = object["session"] as? String, !session.isEmpty, session.utf8.count <= 256,
              let at = object["at"] as? Double, at.isFinite, at > 0,
              let name = object["kind"] as? String, let kind = RequestKind(rawValue: name) else { return nil }
        let text = object["text"] as? String
        let upto = object["upto"] as? Double
        if kind.written {
            guard let text, (1...4_000).contains(text.trimmingCharacters(in: .whitespacesAndNewlines).count),
                  !text.contains("\0") else { return nil }
        }
        if kind == .seen {
            guard let upto, upto.isFinite, upto >= 0 else { return nil }
        }
        return ChannelRequest(id: id, session: session, at: at, kind: kind, text: text, upto: upto)
    }
}
