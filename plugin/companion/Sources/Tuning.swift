import Foundation
import Darwin

struct CompanionTuning: Codable, Equatable {
    struct Spring: Codable, Equatable { var mass: Double; var stiffness: Double; var damping: Double }
    struct Step: Codable, Equatable { var ms: Double; var frame: String; var swapMs = 0.0 }
    struct Touch: Codable, Equatable {
        var hugMs = 550.0, dragDistance = 3.0, burstWindowMs = 1500.0
        var burstCount = 3
        var lineGapMs = 1200.0, lineHoldMs = 2600.0, urgentHoldMs = 900.0, urgentLineMs = 2000.0
        var pressMs = 260.0, pressY = 0.970, pressX = 1.009, pressFirstY = 0.997
        var leanMs = 320.0, leanRadians = 0.017453292519943295
        var strokeStartMs = 520.0, strokeMs = 360.0, strokeY = 0.962
        var greetingMs = 1500.0, thanksLineMs = 4000.0
        var patMs = 1400.0, hugHoldMs = 1600.0, dropMs = 1000.0
        var burstMs = 2000.0, shioriInMs = 380.0, shioriOutMs = 1750.0, shioriTurnMs = 100.0
        var startleCutMs = 33.0, carryMs = 180.0
        var wakeMs = 450.0, wakeLineMs = 220.0, wakeJoltMs = 50.0, heldWakeMs = 200.0, heldOpenMs = 80.0
        var dipMs = 55.0, dipY = 0.975, dipX = 1.0075, poseCutMs = 55.0
        var landY = 0.93, landX = 1.03, burstY = 0.94, burstX = 1.03, repeatImpulseY = -0.01
        var shakeMs = 360.0
        var shake = [0.0, -0.07, 0.07, -0.045, 0.045, 0.0]
        var pressCurve = [0.0, 0.0, 0.2, 1.0], leanCurve = [0.37, 0.0, 0.63, 1.0]
        var release = Spring(mass: 0.5, stiffness: 180, damping: 13)
        var poke = Spring(mass: 0.5, stiffness: 260, damping: 9)
        var wake = Spring(mass: 0.5, stiffness: 200, damping: 10)
        var dip = Spring(mass: 0.5, stiffness: 220, damping: 12.6)
        var faceSwapHz = 60.0
        var patFaces = [Step(ms: 40, frame: "half-lid"), Step(ms: 120, frame: "blink"), Step(ms: 260, frame: "smile", swapMs: 90), Step(ms: 1250, frame: "half-lid", swapMs: 60), Step(ms: 1340, frame: "open")]
        var wakeFaces = [Step(ms: 0, frame: "sleep"), Step(ms: 33, frame: "idle-blink"), Step(ms: 220, frame: "half-lid"), Step(ms: 330, frame: "idle-blink"), Step(ms: 400, frame: "half-lid"), Step(ms: 450, frame: "idle-reading")]
        var preload = ["happy", "sleep", "idle-reading", "idle-blink", "error", "refuse", "flustered", "shiori-a", "shiori-b", "snake", "wave"]
        var faceAliases: [String: [String]] = ["half-lid": ["half-lid", "half-lid-reading", "half-lid-work", "half-lid-think"], "blink": ["blink", "blink-work", "blink-think", "slowblink"], "smile": ["smile-reading", "smile-work", "smile-think", "smile-waiting"], "squeeze": ["squeeze-reading", "squeeze-work", "squeeze-think", "squeeze-waiting"]]
    }
    var version = 1
    var touch = Touch()
    var window = WindowTuning()
    var motion = CompanionMotionTuning.standard
    var pointer = CompanionPointerTuning()
    init() {}
    private enum CodingKeys: String, CodingKey { case version, touch, window, motion, pointer }
    init(from decoder: Decoder) throws {
        let box = try decoder.container(keyedBy: CodingKeys.self)
        version = try box.decode(Int.self, forKey: .version)
        touch = try box.decode(Touch.self, forKey: .touch)
        window = try box.decode(WindowTuning.self, forKey: .window)
        motion = try box.decodeIfPresent(CompanionMotionTuning.self, forKey: .motion) ?? .standard
        pointer = try box.decodeIfPresent(CompanionPointerTuning.self, forKey: .pointer) ?? CompanionPointerTuning()
    }

    static let standard = CompanionTuning()
    static func load(_ data: Data) -> CompanionTuning? {
        guard data.count <= 262144,
              let value = try? JSONDecoder().decode(Self.self, from: data), value.version == 1,
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        func valid(_ object: Any, motion: Bool = false) -> Bool {
            if let number = object as? NSNumber { return number.doubleValue.isFinite && abs(number.doubleValue) <= 600000 }
            if let array = object as? [Any] { return array.count <= 128 && array.allSatisfy { valid($0, motion: motion) } }
            if let dict = object as? [String: Any] {
                guard dict.count <= (motion ? 512 : 128) else { return false }
                return dict.allSatisfy { key, value in
                    if motion && (key == "_about" || key.hasSuffix("#")) {
                        guard let string = value as? String else { return false }
                        return string.utf8.count <= 2048
                    }
                    return valid(value, motion: motion || key == "motion")
                }
            }
            if let string = object as? String { return string.utf8.count <= 256 }
            return false
        }
        let t = value.touch
        guard valid(object), (1...20).contains(t.burstCount), t.hugMs > 0, t.burstWindowMs > 0,
              t.wakeMs > 0, t.pressMs > 0, t.patMs > 0, t.dragDistance >= 0,
              (0.5...1).contains(t.pressY), (1...1.5).contains(t.pressX), (0.5...1).contains(t.pressFirstY),
              t.pressCurve.count == 4, t.leanCurve.count == 4,
              (t.pressCurve + t.leanCurve).allSatisfy({ (0...1).contains($0) }),
              [t.dipY,t.landY,t.burstY,t.strokeY].allSatisfy({ (0.5...1).contains($0) }),
              [t.dipX,t.landX,t.burstX].allSatisfy({ (1...1.5).contains($0) }),
              t.heldOpenMs > 0, t.greetingMs > 0, t.thanksLineMs > 0, t.lineHoldMs > 0, t.heldWakeMs > 0,
              t.lineGapMs >= 0, t.leanMs > 0, t.urgentHoldMs > 0, t.urgentLineMs > 0, t.wakeJoltMs > 0,
              t.strokeStartMs >= 0, t.strokeStartMs + t.strokeMs <= t.patMs,
              t.shioriInMs >= t.poseCutMs, t.shioriOutMs >= t.shioriInMs,
              !t.shake.isEmpty, !t.patFaces.isEmpty, !t.wakeFaces.isEmpty,
              t.patFaces.allSatisfy({ $0.ms + $0.swapMs <= t.patMs && $0.swapMs >= 0 }), t.wakeFaces.allSatisfy({ $0.ms + $0.swapMs <= t.wakeMs && $0.swapMs >= 0 }),
              t.shioriInMs + t.poseCutMs + t.shioriTurnMs <= t.burstMs, t.shioriOutMs + t.poseCutMs <= t.burstMs,
              t.startleCutMs >= 0, t.carryMs >= t.startleCutMs, t.hugHoldMs > 0, t.dropMs > 0,
              t.faceSwapHz >= 1, t.faceSwapHz <= 120, t.strokeMs > 0, t.shakeMs > 0, t.dipMs > 0, t.burstMs > 0, t.wakeLineMs >= 0, t.wakeLineMs <= t.wakeMs, t.wakeJoltMs <= t.wakeMs, (-0.1...0).contains(t.repeatImpulseY),
              [t.release,t.poke,t.wake,t.dip].allSatisfy({ $0.mass > 0 && $0.stiffness > 0 && $0.damping > 0 }),
              [t.patFaces,t.wakeFaces].allSatisfy({ steps in zip(steps,steps.dropFirst()).allSatisfy { $0.ms <= $1.ms } && steps.allSatisfy { $0.ms >= 0 } }),
              value.window.valid, value.motion.valid else { return nil }
        return value
    }
}

/// Directory + inode events cover in-place edits and atomic replacement. No debounce or retry timer.
@MainActor
final class DataFileWatch {
    let url: URL
    private var folderSource: DispatchSourceFileSystemObject?
    private var fileSource: DispatchSourceFileSystemObject?
    private var identity: UInt64?
    var changed: () -> Void = {}
    init(_ url: URL) { self.url = url }
    static func read(_ url: URL, limit: Int) -> Data? {
        let fd = open(url.path,O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { return nil }; defer { close(fd) }
        var info = stat()
        guard fstat(fd,&info) == 0, info.st_mode & S_IFMT == S_IFREG, info.st_size >= 0, info.st_size <= limit else { return nil }
        var data = Data(count: Int(info.st_size))
        let count = data.withUnsafeMutableBytes { bytes in Darwin.read(fd,bytes.baseAddress,bytes.count) }
        guard count == data.count else { return nil }; return data
    }
    func start() {
        guard folderSource == nil else { return }
        folderSource = watch(url.deletingLastPathComponent(), mask: [.write, .rename, .delete]) { [weak self] in self?.event() }
        attach()
    }
    func stop() { fileSource?.cancel(); fileSource = nil; folderSource?.cancel(); folderSource = nil; identity = nil }
    private func event() { attach(); changed() }
    private func attach() {
        var info = stat()
        let inode = lstat(url.path, &info) == 0 && (info.st_mode & S_IFMT) == S_IFREG ? UInt64(info.st_ino) : nil
        guard inode != identity else { return }
        fileSource?.cancel(); fileSource = nil; identity = inode
        if inode != nil { fileSource = watch(url, mask: [.write, .rename, .delete]) { [weak self] in self?.event() } }
    }
    private func watch(_ path: URL, mask: DispatchSource.FileSystemEvent, action: @escaping () -> Void) -> DispatchSourceFileSystemObject? {
        let fd = open(path.path, O_EVTONLY | O_NOFOLLOW)
        guard fd >= 0 else { return nil }
        let source = DispatchSource.makeFileSystemObjectSource(fileDescriptor: fd, eventMask: mask, queue: .main)
        source.setEventHandler(handler: action); source.setCancelHandler { close(fd) }; source.resume()
        return source
    }
}

@MainActor
final class TuningStore {
    private(set) var value = CompanionTuning.standard
    private(set) var lastError: String?
    var changed: (CompanionTuning) -> Void = { _ in }
    var statusChanged: () -> Void = {}
    private let watch: DataFileWatch
    init(_ url: URL) { watch = DataFileWatch(url); _ = reload(); watch.changed = { [weak self] in _ = self?.reload(); self?.statusChanged() } }
    @discardableResult func reload() -> Bool {
        guard let data = DataFileWatch.read(watch.url,limit: 262144), let next = CompanionTuning.load(data) else {
            lastError = "invalid companion-tuning.json"; return false
        }
        lastError = nil
        guard value != next else { return true }
        value = next; changed(next); return true
    }
    func start() { watch.start() }
    func stop() { watch.stop() }
}
