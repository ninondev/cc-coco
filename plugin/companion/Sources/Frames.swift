import AppKit
import ImageIO

// His pictures: the mod's own frames, copied into the app at install, never drawn in code. Extra
// small and Small are the pixel heads (assets/pixel/NN-name.png) at whole device pixels per art
// pixel, at most 48 and 72 points tall (48 and 64 points on a Retina screen with the current
// sheet). Medium 96 and Large 128 points use the painted frames (assets/desktop/NN-name.png,
// the generated manifest's desktop_size palette PNGs).
//
// Each frame is made once for each size and screen scale it is shown at, at that exact number of
// device pixels, and then shown 1:1, so nothing resamples it on screen and nothing shimmers. The
// resampling is an area average with exact coverage on one uniform grid: every screen pixel is the
// average of the source area it covers. Going up (96 pt is 192 pixels from 128 on a Retina screen)
// most pixels keep a source colour exactly and only the seams between two source pixels blend, so
// edges stay crisp without the uneven doubled pixels of nearest neighbour; going down it is the
// plain box average of the area. The pixel heads are always made at a whole number of device pixels
// per art pixel, where the same average is an exact copy of each art pixel. Alpha is premultiplied
// throughout, so edges do not darken.

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
    var assetRoot: URL { folder.deletingLastPathComponent() }
    private let folder: URL
    private let pixelFolder: URL
    private let watch: DataFileWatch
    private let preparationQueue: DispatchQueue
    private var made: [String: CGImage] = [:]
    private nonisolated static let motionFaces = ["squeeze","smile","blink","glance","glance-right"]
    private struct Preparation: Equatable {
        var aliases: [String:[String]], timeline: [CompanionTuning.Step], curve: [Double], rate: Double
    }
    private var preparation: Preparation?
    private var preparationEpoch = 0
    private var touchPreparing: String?
    private var touchReady: String?
    private var touchCompletions: [() -> Void] = []
    private var originals: [String: CGImage] = [:]
    private var pixelCanvas: (width: Int, height: Int)?
    private(set) var manifest: Manifest?
    private(set) var generation = 0
    private(set) var loads = 0
    private(set) var decodes = 0
    private(set) var lastError: String?
    var changed: () -> Void = {}
    var statusChanged: () -> Void = {}
    var names: [String] {
        manifest?.runtimeFrames.filter { $0.tool != true && (originals["desktop/" + $0.name] != nil || originals["pixel/" + $0.name] != nil) }.map(\.name) ?? []
    }
    func names(size: Size) -> [String] {
        manifest?.runtimeFrames.filter { $0.tool != true && originals[Self.kind(size) + $0.name] != nil }.map(\.name) ?? []
    }
    /// Missing variants follow their declared parent, then the named rest pose. No art index
    /// can accidentally select another pose when a frame is retired or only one family ships.
    func resolveName(_ requested: String, size: Size) -> String? {
        let kind = Self.kind(size), metadata = manifest?.runtimeFrames ?? []
        var next: String? = requested, seen = Set<String>()
        while let name = next, seen.insert(name).inserted {
            if originals[kind + name] != nil { return name }
            next = metadata.first { $0.name == name }?.base
        }
        if size.pixelArt,["shed-a","shed-b","shed-c"].contains(requested),originals[kind+"snake"] != nil {return "snake"}
        return originals[kind + "idle-reading"] == nil ? nil : "idle-reading"
    }
    func hasFace(_ face: String, on base: String, size: Size) -> Bool {
        let kind = Self.kind(size)
        guard let original = originals[kind + base],
              let patch = Self.patch(face,on: base,patches: manifest?.patches ?? [],metadata: manifest?.runtimeFrames ?? [],aliases: [:],usable: { patch in
                  guard let region = size.pixelArt ? patch.pixel : patch.desktop,
                        self.originals[kind + "patch:" + patch.name] != nil else { return false }
                  return region.x + region.width <= original.width && region.y + region.height <= original.height
              }),
              let region = size.pixelArt ? patch.pixel : patch.desktop,
              originals[kind + "patch:" + patch.name] != nil else { return false }
        return region.x + region.width <= original.width && region.y + region.height <= original.height
    }
    var decodedBytes: Int { originals.values.reduce(0) { $0 + $1.bytesPerRow * $1.height } }
    var artPixelHeight: Int? { pixelCanvas?.height }
    var preparedBytes: Int {
        var seen = Set<ObjectIdentifier>()
        return made.values.reduce(0) { total,image in seen.insert(ObjectIdentifier(image)).inserted ? total + image.bytesPerRow * image.height : total }
    }

    init(folder: URL, pixelFolder: URL, manifestURL: URL? = nil, preparationQueue: DispatchQueue = .global(qos: .userInitiated)) {
        self.folder = folder; self.pixelFolder = pixelFolder
        self.preparationQueue = preparationQueue
        watch = DataFileWatch(manifestURL ?? folder.deletingLastPathComponent().appendingPathComponent("frame-manifest.json"))
        _ = reload(); watch.changed = { [weak self] in if self?.reload() == true { self?.changed() }; self?.statusChanged() }
    }
    func start() { watch.start() }
    func stop() { watch.stop(); invalidateTouchPreparation() }
    @discardableResult func reload() -> Bool {
        guard let data = DataFileWatch.read(watch.url,limit: 2097152), let m = Manifest.load(data) else {
            lastError = "invalid frame-manifest.json"; return false
        }
        var next: [String: CGImage] = [:], remainingBytes = 64 * 1024 * 1024
        func decode(_ path: URL) -> CGImage? {
            loads += 1
            // Manifest paths may not escape the shipped asset root through a symlink.
            let root = watch.url.deletingLastPathComponent().resolvingSymlinksInPath().path + "/"
            guard path.resolvingSymlinksInPath().path.hasPrefix(root),
                  let source = CGImageSourceCreateWithURL(path as CFURL, nil),
                  let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
                  let width = props[kCGImagePropertyPixelWidth] as? Int, let height = props[kCGImagePropertyPixelHeight] as? Int,
                  width > 0, height > 0, width <= 4096, height <= 4096,
                  width * height * 4 <= remainingBytes,
                  let picture = CGImageSourceCreateImageAtIndex(source, 0, [kCGImageSourceShouldCacheImmediately: true] as CFDictionary) else { return nil }
            let bytes = picture.bytesPerRow * picture.height
            guard bytes <= remainingBytes else { return nil }
            remainingBytes -= bytes
            decodes += 1; return picture
        }
        let pixelOnly = Set((m.pixel_only_frames ?? []).map(\.name))
        for frame in m.runtimeFrames where frame.tool != true {
            for (kind, base) in [("desktop/",folder),("pixel/",pixelFolder)] {
                if kind == "desktop/" && (frame.pixel_only == true || pixelOnly.contains(frame.name)) { continue }
                if let picture = decode(base.appendingPathComponent(frame.filename)) { next[kind + frame.name] = picture }
            }
        }
        for patch in m.patches ?? [] {
            for (kind, region) in [("desktop/",patch.desktop),("pixel/",patch.pixel)] {
                if let region, let picture = decode(watch.url.deletingLastPathComponent().appendingPathComponent(region.filename)) { next[kind + "patch:" + patch.name] = picture }
            }
        }
        guard m.frames.contains(where: { next["desktop/" + $0.name] != nil || next["pixel/" + $0.name] != nil }) else { lastError = "manifest has no readable frames"; return false }
        manifest = m; originals = next; made.removeAll(); generation += 1; lastError = nil
        invalidateTouchPreparation()
        pixelCanvas = next["pixel/idle-reading"].map { ($0.width,$0.height) }
        return true
    }

    /// Eager preparation is used by cache tests; production keeps only its rest set ready.
    func prepare(_ names: [String], size: Size, scale: CGFloat, aliases: [String:[String]], timeline: [CompanionTuning.Step] = CompanionTuning.standard.touch.patFaces, curve: [Double] = CompanionTuning.standard.touch.leanCurve, rate: Double = CompanionTuning.standard.touch.faceSwapHz) {
        let next = Preparation(aliases: aliases,timeline: timeline,curve: curve,rate: rate)
        if preparation != next { made = made.filter { !$0.key.contains("/face:") }; preparation = next; invalidateTouchPreparation() }
        let allowed = Set(names)
        made = made.filter { key,_ in
            Self.pose(in: key).map { allowed.contains($0) } ?? false
        }
        for name in allowed {
            _ = image(name, size: size, scale: scale)
            for face in Set(aliases.keys).union(timeline.map(\.frame)).union(["half-lid","blink","smile","squeeze"]) {
                _ = faceImage(face,on: name,size: size,scale: scale,aliases: aliases)
            }
            guard let pixels = deviceHeight(size,scale: scale) else { continue }
            var previous = "open"
            for step in timeline {
                defer { previous = step.frame }
                guard step.swapMs > 0,
                      let from = cachedFace(previous,on: name,size: size,scale: scale),
                      let to = cachedFace(step.frame,on: name,size: size,scale: scale) else { continue }
                let count = max(1,Int(ceil(step.swapMs * rate / 1000)))
                for i in 0...count {
                    let key = "\(Self.kind(size))face:\(name):blend:\(previous):\(step.frame):\(i):\(count)@\(pixels)"
                    guard made[key] == nil else { continue }
                    if i == 0 { made[key] = from; continue }
                    if i == count { made[key] = to; continue }
                    if from === to { made[key] = from; continue }
                    let fraction = Self.curve(Double(i) / Double(count),points: curve)
                    if let image = Self.blend(from,to,fraction: fraction) { made[key] = image }
                }
            }
        }
    }
    /// Only the displayed pose/loop and the first likely touch face stay prepared at rest.
    func prepareRest(_ names: [String], size: Size, scale: CGFloat, firstFace: String,
                     aliases: [String:[String]], timeline: [CompanionTuning.Step], curve: [Double], rate: Double) {
        let next = Preparation(aliases: aliases,timeline: timeline,curve: curve,rate: rate)
        if preparation != next { made.removeAll(); preparation = next }
        invalidateTouchPreparation()
        guard let pixels = deviceHeight(size,scale: scale) else { made.removeAll(); return }
        let kind = Self.kind(size), allowed = Set(names)
        let keys = Set(allowed.flatMap { name in
            ["\(kind)\(name)@\(pixels)","\(kind)face:\(name):\(firstFace)@\(pixels)"]
                + Self.motionFaces.map { "\(kind)motion:\(name):\($0)@\(pixels)" }
        })
        made = made.filter { keys.contains($0.key) }
        for name in allowed {
            _ = image(name,size: size,scale: scale)
            _ = faceImage(firstFace,on: name,size: size,scale: scale,aliases: aliases)
        }
    }
    /// Semantic motion faces stay independent of the touch alias cache. This runs only when
    /// the rest preparation changes, never from a geometry or pointer callback.
    func prepareMotionFaces(_ names: [String], size: Size, scale: CGFloat) {
        guard let pixels = deviceHeight(size,scale: scale) else { return }
        let kind = Self.kind(size)
        for name in Set(names) {
            for face in Self.motionFaces {
                let key = "\(kind)motion:\(name):\(face)@\(pixels)"
                guard made[key] == nil, hasFace(face,on: name,size: size) else { continue }
                made[key] = Self.composed(face,on: name,kind: kind,pixels: pixels,originals: originals,
                                          patches: manifest?.patches ?? [],metadata: manifest?.runtimeFrames ?? [],aliases: [:])
            }
        }
    }
    func cachedMotionFace(_ face: String, on name: String, size: Size, scale: CGFloat) -> CGImage? {
        guard let pixels = deviceHeight(size,scale: scale) else { return nil }
        return made["\(Self.kind(size))motion:\(name):\(face)@\(pixels)"]
    }
    private func invalidateTouchPreparation() {
        preparationEpoch += 1; touchPreparing = nil; touchReady = nil; touchCompletions.removeAll()
    }
    /// Resampling and face blending use an immutable image snapshot on a worker queue. There is
    /// no file access or decoding, and the input path only enqueues this work after painting.
    func prepareTouch(_ names: [String], on bases: [String], size: Size, scale: CGFloat,
                      aliases: [String:[String]], timeline: [CompanionTuning.Step], curve: [Double], rate: Double,
                      completion: @escaping () -> Void) {
        guard let pixels = deviceHeight(size,scale: scale) else { completion(); return }
        let next = Preparation(aliases: aliases,timeline: timeline,curve: curve,rate: rate)
        if preparation != next {
            made = made.filter { !$0.key.contains("/face:") }; preparation = next; invalidateTouchPreparation()
        }
        let kind = Self.kind(size), epoch = preparationEpoch
        let key = "\(epoch)|\(kind)|\(pixels)|\(Set(names).sorted())|\(Set(bases).sorted())"
        if touchReady == key { completion(); return }
        if touchPreparing == key { touchCompletions.append(completion); return }
        touchPreparing = key; touchCompletions = [completion]
        let originals = self.originals, patches = manifest?.patches ?? [], metadata = manifest?.runtimeFrames ?? [], previous = made
        let faces = Set(aliases.keys).union(timeline.map(\.frame)).union(["half-lid","blink","smile","squeeze"])
        preparationQueue.async { [weak self] in
            let images = Frames.prepared(names: Set(names),bases: Set(bases),faces: faces,kind: kind,pixels: pixels,
                                       originals: originals,patches: patches,metadata: metadata,aliases: aliases,timeline: timeline,curve: curve,rate: rate,previous: previous)
            DispatchQueue.main.async { [weak self] in
                guard let self, self.preparationEpoch == epoch, self.touchPreparing == key else { return }
                self.made.merge(images) { _, prepared in prepared }; self.touchReady = key; self.touchPreparing = nil
                let callbacks = self.touchCompletions; self.touchCompletions.removeAll()
                for callback in callbacks { callback() }
            }
        }
    }
    private nonisolated static func prepared(names: Set<String>, bases: Set<String>, faces: Set<String>, kind: String, pixels: Int,
                                            originals: [String:CGImage], patches: [Manifest.Patch], metadata: [Manifest.Frame], aliases: [String:[String]],
                                            timeline: [CompanionTuning.Step], curve: [Double], rate: Double, previous: [String:CGImage]) -> [String:CGImage] {
        var result = previous
        func image(_ name: String) -> CGImage? {
            let key = "\(kind)\(name)@\(pixels)"
            if let existing = result[key] { return existing }
            guard let original = originals[kind + name], let made = resample(original,height: pixels) else { return nil }
            result[key] = made; return made
        }
        func face(_ face: String, on base: String) -> CGImage? {
            if face == "open" { return image(base) }
            let key = "\(kind)face:\(base):\(face)@\(pixels)"
            if let existing = result[key] { return existing }
            let made = composed(face,on: base,kind: kind,pixels: pixels,originals: originals,patches: patches,metadata: metadata,aliases: aliases) ?? image(base)
            result[key] = made; return made
        }
        for name in names { _ = image(name) }
        for base in bases {
            for kind in faces { _ = face(kind,on: base) }
            var previous = "open"
            for step in timeline {
                defer { previous = step.frame }
                guard step.swapMs > 0, let from = face(previous,on: base), let to = face(step.frame,on: base) else { continue }
                let count = max(1,Int(ceil(step.swapMs * rate / 1000)))
                for i in 0...count {
                    let key = "\(kind)face:\(base):blend:\(previous):\(step.frame):\(i):\(count)@\(pixels)"
                    if result[key] != nil { continue }
                    if i == 0 || from === to { result[key] = from }
                    else if i == count { result[key] = to }
                    else { result[key] = blend(from,to,fraction: Self.curve(Double(i) / Double(count),points: curve)) }
                }
            }
        }
        return result
    }
    var frameOverlayOffsetX: Int { manifest?.registration?.frame_overlay_offset_x ?? 0 }

    /// Approved tool-pose regions, synthesized on first use while production patches are absent.
    func toolMotion(_ name: String, size: Size, scale: CGFloat) -> CGImage? {
        let pairs: [String:(String,[Int])] = ["search-a":("search-b",[24,80,104,128]),"scroll-a":("scroll-b",[26,78,112,128]),"spyglass-a":("spyglass-b",[12,70,100,128]),"plan-a":("plan-b",[18,64,104,128]),"tea-a":("tea-b",[34,70,118,128])]
        guard let (donor, area) = pairs[name], let base = image(name,size:size,scale:scale), let next = image(donor,size:size,scale:scale) else { return nil }
        if size.pixelArt { return next }
        let key = "tool-motion:\(name)@\(base.height)"
        if let cached = made[key] { return cached }
        let width = base.width, height = base.height, factor = Double(height)/128
        let x0 = Double(area[0] + frameOverlayOffsetX), x1 = Double(area[2] + frameOverlayOffsetX)
        var mask = [UInt8](repeating:255,count:width*height)
        for y in 0..<height { for x in 0..<width {
            let ax = Double(x)/factor, ay = 128-Double(y)/factor
            if ax >= x0 && ax < x1 && ay >= Double(area[1]) && ay <= Double(area[3]) {
                let alpha = min(1,min((ax-x0)/2,min((x1-ax)/2,(ay-Double(area[1]))/2)))
                mask[y*width+x] = 255-UInt8(max(0,min(255,alpha*255)))
            }
        }}
        guard let provider = CGDataProvider(data:Data(mask) as CFData),
              let alpha = CGImage(maskWidth:width,height:height,bitsPerComponent:8,bitsPerPixel:8,bytesPerRow:width,provider:provider,decode:nil,shouldInterpolate:false),
              let space = CGColorSpace(name:CGColorSpace.sRGB),
              let context = CGContext(data:nil,width:width,height:height,bitsPerComponent:8,bytesPerRow:width*4,space:space,bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        let rect = CGRect(x:0,y:0,width:width,height:height)
        context.draw(base,in:rect); context.clip(to:rect,mask:alpha); context.draw(next,in:rect)
        guard let composite = context.makeImage() else { return nil }
        made[key] = composite; return composite
    }
    func toolBlend(_ from: CGImage, _ to: CGImage, fraction: Double) -> CGImage? { Self.blend(from,to,fraction:fraction) }

    func cached(_ name: String, size: Size, scale: CGFloat) -> CGImage? {
        guard let pixels = deviceHeight(size, scale: scale) else { return nil }
        return made["\(Self.kind(size))\(name)@\(pixels)"]
    }
    func baseName(of image: CGImage) -> String? {
        guard let key = made.first(where: { $0.value === image })?.key else { return nil }
        return Self.pose(in: key)
    }
    private nonisolated static func pose(in key: String) -> String? {
        guard let value = key.dropFirst(key.hasPrefix("desktop/") ? 8 : 6).split(separator: "@").first else { return nil }
        if !value.hasPrefix("face:") && !value.hasPrefix("motion:") { return String(value) }
        let parts = value.split(separator: ":")
        return parts.count > 1 ? String(parts[1]) : nil
    }
    func cachedFace(_ face: String, on name: String, size: Size, scale: CGFloat) -> CGImage? {
        if face == "open" { return cached(name,size: size,scale: scale) }
        return cached("face:\(name):\(face)",size: size,scale: scale) ?? cached(name,size: size,scale: scale)
    }
    func faceImage(_ face: String, on name: String, size: Size, scale: CGFloat, aliases: [String:[String]]) -> CGImage? {
        guard let pixels = deviceHeight(size,scale: scale) else { return nil }
        let key = "\(Self.kind(size))face:\(name):\(face)@\(pixels)"
        if let found = made[key] { return found }
        guard let out = Self.composed(face,on: name,kind: Self.kind(size),pixels: pixels,originals: originals,
                                      patches: manifest?.patches ?? [],metadata: manifest?.runtimeFrames ?? [],aliases: aliases) else { return image(name,size: size,scale: scale) }
        made[key] = out; return out
    }
    private nonisolated static func composed(_ face: String, on name: String, kind: String, pixels: Int,
                                             originals: [String:CGImage], patches: [Manifest.Patch], metadata: [Manifest.Frame], aliases: [String:[String]]) -> CGImage? {
        guard let original = originals[kind + name] else { return nil }
        guard let patch = patch(face,on: name,patches: patches,metadata: metadata,aliases: aliases,usable: { patch in
                  guard let region = kind == "pixel/" ? patch.pixel : patch.desktop,
                        originals[kind + "patch:" + patch.name] != nil else { return false }
                  return region.x + region.width <= original.width && region.y + region.height <= original.height
              }),
              let region = kind == "pixel/" ? patch.pixel : patch.desktop,
              let art = originals[kind + "patch:" + patch.name],
              region.x + region.width <= original.width, region.y + region.height <= original.height,
              let space = CGColorSpace(name: CGColorSpace.sRGB),
              let context = CGContext(data: nil,width: original.width,height: original.height,bitsPerComponent: 8,bytesPerRow: original.width * 4,space: space,bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        context.interpolationQuality = .none
        context.draw(original,in: CGRect(x: 0,y: 0,width: original.width,height: original.height))
        context.draw(art,in: CGRect(x: region.x,y: original.height - region.y - region.height,width: region.width,height: region.height))
        guard let composite = context.makeImage() else { return nil }
        return resample(composite,height: pixels)
    }
    private nonisolated static func patch(_ face: String, on name: String, patches: [Manifest.Patch],
                                          metadata: [Manifest.Frame], aliases: [String:[String]], usable: @escaping (Manifest.Patch) -> Bool) -> Manifest.Patch? {
        let semantic = face == "half-lid" ? "half" : face
        if metadata.first(where: {$0.name == name}).map({$0.tool == true || $0.kind == "tool"}) == true {
            return patches.first { patch in patch.base == name && (patch.face == semantic || patch.face == face || patch.name == "\(name)-\(face)") && usable(patch) }
        }
        var ancestry: [String] = [], seen = Set<String>(), next: String? = name
        while let base = next, seen.insert(base).inserted {
            ancestry.append(base); next = metadata.first { $0.name == base }?.base
        }
        return ancestry.lazy.compactMap { base -> Manifest.Patch? in
            let candidates = patches.filter { $0.base == base && usable($0) }
            // The approved optional right glance is addressed by this exact manifest name.
            if face == "glance-right" { return candidates.first { $0.name == "glance-right" } }
            let override = aliases[face]?.lazy.compactMap { alias in candidates.first { $0.name == alias } }.first
            return override ?? candidates.first { $0.face == semantic }
        }.first
    }

    private static func kind(_ size: Size) -> String { size.pixelArt ? "pixel/" : "desktop/" }

    private func deviceHeight(_ size: Size, scale: CGFloat) -> Int? {
        guard scale.isFinite, scale > 0, scale <= 8 else { return nil }
        return Int((size.height * scale).rounded())
    }

    /// The frame at this size on a screen of this scale, in device pixels; nil for an unknown or
    /// unreadable frame.
    func image(_ name: String, size: Size, scale: CGFloat) -> CGImage? {
        guard let pixels = deviceHeight(size, scale: scale) else { return nil }
        let key = "\(Self.kind(size))\(name)@\(pixels)"
        if let hit = made[key] { return hit }
        guard let picture = originals[Self.kind(size) + name],
              let out = Self.resample(picture, height: pixels) else { return nil }
        made[key] = out
        return out
    }

    /// His size in points, using the same device-pixel dimensions as his picture.
    func size(_ size: Size, scale: CGFloat) -> NSSize {
        guard let picture = image("idle-reading", size: size, scale: scale) else {
            if size.pixelArt, let canvas = pixelCanvas, let pixels = deviceHeight(size, scale: scale) {
                let factor = pixels / canvas.height
                return NSSize(width: CGFloat(canvas.width * factor) / scale, height: CGFloat(pixels) / scale)
            }
            let dimensions = size.pixelArt ? manifest?.pixel_size : manifest?.desktop_size
            let aspect = dimensions.map { CGFloat($0[0]) / CGFloat($0[1]) } ?? 1
            return NSSize(width: (size.height * aspect).rounded(), height: size.height)
        }
        return NSSize(width: CGFloat(picture.width) / scale, height: CGFloat(picture.height) / scale)
    }

    /// Forgets pictures made for other sizes (after the size changes).
    func keep(_ size: Size, scale: CGFloat) {
        invalidateTouchPreparation()
        guard let pixels = deviceHeight(size, scale: scale) else {
            made.removeAll()
            return
        }
        let kind = Self.kind(size)
        let suffix = "@\(pixels)"
        made = made.filter { $0.key.hasPrefix(kind) && $0.key.hasSuffix(suffix) }
    }

    nonisolated static func curve(_ fraction: Double, points: [Double]) -> Double {
        if fraction <= 0 { return 0 }; if fraction >= 1 { return 1 }
        guard points.count == 4 else { return fraction }
        func cubic(_ t: Double,_ a: Double,_ b: Double) -> Double { 3 * (1-t) * (1-t) * t * a + 3 * (1-t) * t * t * b + t*t*t }
        var low = 0.0, high = 1.0
        for _ in 0..<24 { let mid = (low+high)/2; if cubic(mid,points[0],points[2]) < fraction { low = mid } else { high = mid } }
        return cubic((low+high)/2,points[1],points[3])
    }
    private nonisolated static func blend(_ from: CGImage,_ to: CGImage,fraction: Double) -> CGImage? {
        guard from.width == to.width, from.height == to.height,
              let space = CGColorSpace(name: CGColorSpace.sRGB),
              let context = CGContext(data: nil,width: from.width,height: from.height,bitsPerComponent: 8,bytesPerRow: from.width * 4,space: space,bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        let rect = CGRect(x: 0,y: 0,width: from.width,height: from.height)
        context.setBlendMode(.copy); context.setAlpha(1-fraction); context.draw(from,in: rect)
        context.setBlendMode(.plusLighter); context.setAlpha(fraction); context.draw(to,in: rect)
        return context.makeImage()
    }

    // Area-average resampling to `height` pixels on the source's own uniform grid: the output is
    // ceil(width / step) wide, its last column reaching into clear padding, so both axes keep the
    // same step and the pixel grid stays exact.
    private nonisolated static func resample(_ picture: CGImage, height outHeight: Int) -> CGImage? {
        let inWidth = picture.width
        let inHeight = picture.height
        guard outHeight > 0, outHeight <= 4096, inHeight > 0 else { return nil }
        let step = Double(inHeight) / Double(outHeight) // source pixels per output pixel
        let outWidth = Int((Double(inWidth) / step - 1e-9).rounded(.up))
        // A valid but extremely wide, one-row image must not multiply into a huge bitmap.
        guard outWidth > 0, outWidth <= 4096 else { return nil }
        guard let space = CGColorSpace(name: CGColorSpace.sRGB) else { return nil }
        let info = CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue

        var source = [UInt8](repeating: 0, count: inWidth * inHeight * 4)
        let drawn: Bool = source.withUnsafeMutableBytes { bytes in
            guard let context = CGContext(
                data: bytes.baseAddress, width: inWidth, height: inHeight, bitsPerComponent: 8,
                bytesPerRow: inWidth * 4, space: space, bitmapInfo: info
            ) else { return false }
            context.interpolationQuality = .none
            context.draw(picture, in: CGRect(x: 0, y: 0, width: inWidth, height: inHeight))
            return true
        }
        guard drawn else { return nil }

        // Which source pixels each output pixel covers, and by how much (weights sum to 1).
        func spans(_ count: Int, _ limit: Int) -> [[(index: Int, weight: Float)]] {
            (0..<count).map { o in
                let start = Double(o) * step
                let end = start + step
                var parts: [(Int, Float)] = []
                var i = Int(start.rounded(.down))
                while Double(i) < end - 1e-9 {
                    let overlap = min(end, Double(i + 1)) - max(start, Double(i))
                    if overlap > 1e-9, i < limit { parts.append((i, Float(overlap / step))) }
                    i += 1
                }
                return parts
            }
        }
        let columns = spans(outWidth, inWidth)
        let rows = spans(outHeight, inHeight)

        // Rows first (each output row from the source rows it covers), then columns.
        var tall = [Float](repeating: 0, count: inWidth * outHeight * 4)
        for (o, parts) in rows.enumerated() {
            for (row, weight) in parts {
                let from = row * inWidth * 4
                let to = o * inWidth * 4
                for k in 0..<(inWidth * 4) { tall[to + k] += Float(source[from + k]) * weight }
            }
        }
        var out = [UInt8](repeating: 0, count: outWidth * outHeight * 4)
        for y in 0..<outHeight {
            for (x, parts) in columns.enumerated() {
                var sum: (Float, Float, Float, Float) = (0, 0, 0, 0)
                for (column, weight) in parts {
                    let at = (y * inWidth + column) * 4
                    sum.0 += tall[at] * weight
                    sum.1 += tall[at + 1] * weight
                    sum.2 += tall[at + 2] * weight
                    sum.3 += tall[at + 3] * weight
                }
                let o = (y * outWidth + x) * 4
                out[o] = UInt8(max(0, min(255, sum.0.rounded())))
                out[o + 1] = UInt8(max(0, min(255, sum.1.rounded())))
                out[o + 2] = UInt8(max(0, min(255, sum.2.rounded())))
                out[o + 3] = UInt8(max(0, min(255, sum.3.rounded())))
            }
        }
        guard let provider = CGDataProvider(data: Data(out) as CFData) else { return nil }
        return CGImage(
            width: outWidth, height: outHeight, bitsPerComponent: 8, bitsPerPixel: 32,
            bytesPerRow: outWidth * 4, space: space, bitmapInfo: CGBitmapInfo(rawValue: info),
            provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent
        )
    }
}
