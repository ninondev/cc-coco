import Foundation

struct CompanionHealth: Codable, Equatable {
    var version: String
    var protocolGeneration: String
    var accessibility: Bool
    var targetFound: Bool
    var target: String
    var lastError: String?
    var longTaskAuthorization: String? = nil
    var pointerMonitor: [CompanionPointerPeriod]? = nil
    var away: CompanionAway? = nil
}

/// The screen lock as the pet last saw it change (E1-9 `away`, read by the plugin's keep-warm lock check):
/// «locked», or null once unlocked; `since` is that change in wall-clock milliseconds.
struct CompanionAway: Codable, Equatable {
    var state: String?
    var since: Double
    // Unlocked is written as null, which the lock check reads as unlocked; a missing key would read as unknown.
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(state, forKey: .state)
        try container.encode(since, forKey: .since)
    }
}

/// Small status receipt for the book. Same status never rewrites a file or schedules work.
final class HealthWriter {
    private let file: URL
    private(set) var last: CompanionHealth?
    private(set) var writes = 0
    private var pointerPeriods: [CompanionPointerPeriod] = []
    var onError: (Error) -> Void = { _ in }
    init(folder: URL) { file = folder.appendingPathComponent("health.json") }
    func recordPointerMonitor(_ period: CompanionPointerPeriod) {
        if pointerPeriods.count == 128 { pointerPeriods.removeFirst() }
        pointerPeriods.append(period)
        if let health = last { _ = update(health) }
    }
    @discardableResult
    func update(_ health: CompanionHealth) -> Bool {
        var health = health
        if !pointerPeriods.isEmpty { health.pointerMonitor = pointerPeriods }
        guard health != last else { return false }
        do {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys]
            let data = try encoder.encode(health)
            guard data.count <= 65_536 else { throw SecureFileError.tooLarge }
            let directory = try SecureDirectory(file.deletingLastPathComponent())
            try directory.replace(file.lastPathComponent, with: data)
            last = health
            writes += 1
            return true
        } catch {
            onError(error)
            return false
        }
    }
}
