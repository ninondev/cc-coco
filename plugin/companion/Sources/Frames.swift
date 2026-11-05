import AppKit

// The shared manifest names actions used by reaction timing. CocoPlayer owns all artwork.
@MainActor
final class Frames {
    struct Manifest: Decodable {
        struct Frame: Decodable { var name: String; var filename: String; var base: String?; var tool: Bool?; var kind: String?; var pixel_only: Bool? }
        struct Patch: Decodable {
            struct Region: Decodable { var filename: String; var x: Int; var y: Int; var width: Int; var height: Int }
            var name: String; var base: String; var face: String?; var desktop: Region?; var pixel: Region?
        }
        var version: Int; var frames: [Frame]; var patches: [Patch]?
        var pixel_only_frames: [Frame]?
        var runtimeFrames: [Frame] { frames + (pixel_only_frames ?? []) }
        struct Registration: Decodable { var frame_overlay_offset_x: Int? }
        var desktop_size: [Int]?; var pixel_size: [Int]?
        var registration: Registration?
        static func load(_ data: Data) -> Manifest? {
            guard data.count <= 2097152, let m = try? JSONDecoder().decode(Self.self, from: data), [1,2].contains(m.version),
                  !m.frames.isEmpty, m.runtimeFrames.count <= 256, (m.patches?.count ?? 0) <= 256 else { return nil }
            guard [m.desktop_size, m.pixel_size].compactMap({ $0 }).allSatisfy({
                $0.count == 2 && $0.allSatisfy { $0 > 0 && $0 <= 4096 }
            }) else { return nil }
            if let offset = m.registration?.frame_overlay_offset_x, !(0...4096).contains(offset) { return nil }
            // Identities are independent of art order and filenames. Cache delimiters and
            // control characters are reserved; semantic faces may otherwise grow with the art.
            func identity(_ name: String) -> Bool {
                !name.isEmpty && name.utf8.count < 128 && !name.contains(where: { ":/@\\".contains($0) })
                && !name.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) })
            }
            func safe(_ file: String) -> Bool { !file.isEmpty && !file.hasPrefix("/") && !file.split(separator: "/").contains("..") && !file.contains("\\") && !file.contains("\0") && file.utf8.count < 256 }
            guard Set(m.runtimeFrames.map(\.name)).count == m.runtimeFrames.count,
                  (m.pixel_only_frames ?? []).allSatisfy({ $0.pixel_only == true && $0.tool != true }),
                  m.runtimeFrames.allSatisfy({ identity($0.name) && safe($0.filename) && ($0.base.map(identity) ?? true) }),
                  Set((m.patches ?? []).map(\.name)).count == (m.patches?.count ?? 0),
                  (m.patches ?? []).allSatisfy({ p in
                      identity(p.name) && m.frames.contains { $0.name == p.base }
                      && (p.face.map(identity) ?? true)
                      && [p.desktop,p.pixel].compactMap { $0 }.allSatisfy { r in safe(r.filename) && r.x >= 0 && r.y >= 0 && r.width > 0 && r.height > 0 && r.x < 4096 && r.y < 4096 && r.width < 4096 && r.height < 4096 }
                  }) else { return nil }
            let bases = Dictionary(uniqueKeysWithValues: m.runtimeFrames.map { ($0.name,$0.base) })
            for frame in m.runtimeFrames {
                var visited = Set<String>(), name: String? = frame.name
                while let current = name {
                    if visited.contains(current) { if current != (bases[current] ?? nil) { return nil }; break }
                    visited.insert(current); name = bases[current] ?? nil
                }
            }
            return m
        }
    }
    let assetRoot: URL
    private let watch: DataFileWatch
    private(set) var manifest: Manifest?
    private(set) var lastError: String?
    var changed: () -> Void = {}
    var statusChanged: () -> Void = {}
    var names: [String] { manifest?.frames.filter { $0.tool != true }.map(\.name) ?? [] }
    func names(size: Size) -> [String] { names }
    func resolveName(_ requested: String, size: Size) -> String? {
        let actions = manifest?.frames ?? []
        if actions.contains(where: { $0.name == requested && $0.tool != true }) { return requested }
        return actions.contains(where: { $0.name == "idle-reading" }) ? "idle-reading" : nil
    }
    init(assetRoot: URL) {
        self.assetRoot = assetRoot
        watch = DataFileWatch(assetRoot.appendingPathComponent("frame-manifest.json"))
        _ = reload()
        watch.changed = { [weak self] in
            if self?.reload() == true { self?.changed() }
            self?.statusChanged()
        }
    }
    func start() { watch.start() }
    func stop() { watch.stop() }
    @discardableResult func reload() -> Bool {
        guard let data = DataFileWatch.read(watch.url, limit: 2097152), let value = Manifest.load(data) else {
            lastError = "invalid frame-manifest.json"; return false
        }
        manifest = value; lastError = nil
        return true
    }
    nonisolated static func curve(_ fraction: Double, points: [Double]) -> Double {
        if fraction <= 0 { return 0 }; if fraction >= 1 { return 1 }
        guard points.count == 4 else { return fraction }
        func cubic(_ t: Double,_ a: Double,_ b: Double) -> Double { 3 * (1-t) * (1-t) * t * a + 3 * (1-t) * t * t * b + t*t*t }
        var low = 0.0, high = 1.0
        for _ in 0..<24 { let mid = (low+high)/2; if cubic(mid,points[0],points[2]) < fraction { low = mid } else { high = mid } }
        return cubic((low+high)/2,points[1],points[3])
    }
}
