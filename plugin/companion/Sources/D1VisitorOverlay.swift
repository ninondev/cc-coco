import AppKit
import QuartzCore
import ImageIO

/// A visitor on him while he dozes (design VISITORS.md 3 and 5): a layer on his own picture, so it sways and
/// dips with him. The painted sizes show it arriving and taking off; the pixel sizes only cut. Its sprites and
/// anchors are the app's Resources/visitors (made by tools/build-visitor-art.py, the same files the Rust
/// companion reads); a kind that cannot be read is simply never drawn. Nothing here runs while he is idle:
/// a move is one Core Animation each way, and a sitting visitor is a still layer.
@MainActor
final class D1VisitorOverlay {
    private struct Glow {
        let band: (radius: Double, image: CGImage)
        let pixel: (radius: Double, image: CGImage)
        let centre: (x: Double, y: Double)
    }
    private struct Art {
        let light: CGImage, dark: CGImage
        let width: Double, height: Double
        let pixel: (x: Double, y: Double)
        let band: (x: Double, y: Double, k: Double)
        let glow: Glow?
    }
    enum Phase: Equatable {
        case arriving(elapsed: Double), sitting, leaving(elapsed: Double)
    }

    /// Milliseconds. The pixel sizes cut, so they have no move at all.
    static func arriveMs(pixel: Bool, reduced: Bool) -> Double { pixel ? 0 : reduced ? 200 : 360 }
    static func leaveMs(pixel: Bool, reduced: Bool) -> Double { pixel ? 0 : reduced ? 200 : 450 }
    /// Where the visit is at `now`; nil when nothing is drawn. A visitor that has not left only shows while he sleeps.
    static func phase(_ visitor: D1Visitor, asleep: Bool, pixel: Bool, reduced: Bool, now: Double) -> Phase? {
        guard now >= visitor.at, visitor.leftAt != nil || asleep else { return nil }
        if let left = visitor.leftAt, now >= left {
            let elapsed = now - left
            return pixel || elapsed >= leaveMs(pixel: pixel, reduced: reduced) ? nil : .leaving(elapsed: elapsed)
        }
        let elapsed = now - visitor.at
        return elapsed < arriveMs(pixel: pixel, reduced: reduced) ? .arriving(elapsed: elapsed) : .sitting
    }

    var folder: URL?
    private let container = CALayer()
    private var manifest: [String: Any]?
    private var arts: [String: Art] = [:]
    private var tried: Set<String> = []
    private var cache: [String: CGImage] = [:]
    private var key = ""
    private var retry: (() -> Void)?
    private lazy var wake = OneShot { [weak self] in self?.retry?() }
    private lazy var end = OneShot { [weak self] in self?.clear() }

    private func image(_ filename: String) -> CGImage? {
        guard !filename.contains("/"), !filename.contains(".."), let folder else { return nil }
        if let image = cache[filename] { return image }
        let path = folder.appendingPathComponent(filename)
        guard path.resolvingSymlinksInPath().path.hasPrefix(folder.resolvingSymlinksInPath().path + "/"),
              let source = CGImageSourceCreateWithURL(path as CFURL, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
              image.width > 0, image.height > 0, image.width < 512, image.height < 512 else { return nil }
        cache[filename] = image
        return image
    }
    /// One read attempt per kind: a missing or broken file leaves that kind undrawn.
    private func artFor(_ kind: String) -> Art? {
        if let art = arts[kind] { return art }
        guard !tried.contains(kind), let folder else { return nil }
        tried.insert(kind)
        if manifest == nil, let data = DataFileWatch.read(folder.appendingPathComponent("visitors.json"), limit: 65536),
           let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { manifest = value }
        guard let kinds = manifest?["kinds"] as? [String: Any], let entry = kinds[kind] as? [String: Any],
              let width = (entry["w"] as? NSNumber)?.doubleValue, let height = (entry["h"] as? NSNumber)?.doubleValue,
              let pixel = entry["pixel"] as? [Double], pixel.count == 2,
              let band = entry["band"] as? [Double], band.count == 3, band[2] > 0,
              let light = image("\(kind)-light.png"), let dark = image("\(kind)-dark.png") else { return nil }
        var glow: Glow?
        if let raw = entry["glow"] as? [String: Any], let centre = raw["centre"] as? [Double], centre.count == 2,
           let bandSpec = raw["band"] as? [String: Any], let pixelSpec = raw["pixel"] as? [String: Any],
           let bandRadius = (bandSpec["r"] as? NSNumber)?.doubleValue, let bandFile = bandSpec["file"] as? String, let bandImage = image(bandFile),
           let pixelRadius = (pixelSpec["r"] as? NSNumber)?.doubleValue, let pixelFile = pixelSpec["file"] as? String, let pixelImage = image(pixelFile) {
            glow = Glow(band: (bandRadius, bandImage), pixel: (pixelRadius, pixelImage), centre: (centre[0], centre[1]))
        }
        let made = Art(light: light, dark: dark, width: width, height: height, pixel: (pixel[0], pixel[1]),
                       band: (band[0], band[1], band[2]), glow: glow)
        arts[kind] = made
        return made
    }

    /// `picture` is his own layer: the painted frame is 151 x 128 and the pixel frame 35 x 32, so a spot in either
    /// is a fraction of the layer. An art pixel is as many frame pixels as the band uses, so the visitor is as big
    /// next to him as it is in the band. Over Coco (`coco`, their 234 x 241 canvas) the painted spots move onto
    /// their figure the way the band moves them, at every size.
    func show(_ visitor: D1Visitor?, asleep: Bool, picture: CALayer, size: Size, scale: CGFloat, dark: Bool,
              now: Double, reduced: Bool, present: Bool, coco: Bool = false) {
        let pixel = size.pixelArt && !coco
        guard present, let visitor, let art = artFor(visitor.kind) else { clear(); return }
        guard let phase = Self.phase(visitor, asleep: asleep, pixel: pixel, reduced: reduced, now: now) else {
            clear()
            if now < visitor.at {
                let clock = CACurrentMediaTime()
                retry = { [weak self, weak picture] in
                    guard let self, let picture else { return }
                    self.show(visitor, asleep: asleep, picture: picture, size: size, scale: scale, dark: dark,
                              now: now + max(0, CACurrentMediaTime() - clock) * 1000, reduced: reduced, present: present,
                              coco: coco)
                }
                wake.fire(after: (visitor.at - now) / 1000)
            }
            return
        }
        let phaseName: String
        switch phase {
        case .arriving: phaseName = "arrive"
        case .sitting: phaseName = "sit"
        case .leaving: phaseName = "leave"
        }
        let bounds = picture.bounds
        let next = [visitor.id, phaseName, "\(size)", "\(scale)", dark ? "dark" : "light", reduced ? "reduced" : "moving",
                    "\(Int(bounds.width))x\(Int(bounds.height))", coco ? "coco" : "frames"].joined(separator: ":")
        if next == key, container.superlayer === picture { return }
        clear()
        key = next
        // over Coco the old figure box (10,4)-(146,127) sits on theirs (42,26)-(217,228), the note on the mug's right
        // wall (register.tsx COCO_VISIT_PLACE, COCO_NOTE_PLACE)
        let onto = coco ? (left: visitor.kind == "note" ? 166.4 : 16.4, top: 32.0, scale: 1.45) : (left: 0.0, top: 0.0, scale: 1.0)
        let gridWidth = coco ? 234.0 : pixel ? 35.0 : 151.0, gridHeight = coco ? 241.0 : pixel ? 32.0 : 128.0
        let x = pixel ? art.pixel.x : art.band.x, y = pixel ? art.pixel.y : art.band.y, k = pixel ? 1.0 : art.band.k
        let unitX = Double(bounds.width) / gridWidth, unitY = Double(bounds.height) / gridHeight
        let flipped = picture.isGeometryFlipped
        func place(left: Double, top: Double, width: Double, height: Double) -> CGRect {
            let l = onto.left + left * onto.scale, t = onto.top + top * onto.scale
            let w = width * onto.scale, h = height * onto.scale
            return CGRect(x: l * unitX, y: flipped ? t * unitY : Double(bounds.height) - (t + h) * unitY,
                          width: w * unitX, height: h * unitY)
        }
        CATransaction.begin(); CATransaction.setDisableActions(true)
        picture.addSublayer(container); container.frame = bounds
        if dark, let glow = art.glow {
            let (radius, light) = pixel ? glow.pixel : glow.band
            let layer = CALayer()
            layer.contents = light; layer.contentsScale = scale; layer.contentsGravity = .resize
            layer.minificationFilter = .linear; layer.magnificationFilter = .linear
            layer.frame = place(left: x + glow.centre.x * k - radius, top: y + glow.centre.y * k - radius,
                                width: 2 * radius + 1, height: 2 * radius + 1)
            container.addSublayer(layer)
        }
        let sprite = CALayer()
        sprite.contents = dark ? art.dark : art.light; sprite.contentsScale = scale; sprite.contentsGravity = .resize
        sprite.minificationFilter = .nearest; sprite.magnificationFilter = .nearest
        sprite.frame = place(left: x, top: y, width: art.width * k, height: art.height * k)
        container.addSublayer(sprite)
        let up: Double = flipped ? -1 : 1
        func move(_ keyPath: String, from: Double, to: Double, seconds: Double, elapsed: Double, curve: CAMediaTimingFunctionName,
                  name: String, holds: Bool) {
            let animation = CABasicAnimation(keyPath: keyPath)
            animation.fromValue = from; animation.toValue = to; animation.duration = seconds
            animation.beginTime = CACurrentMediaTime() - elapsed / 1000
            animation.timingFunction = CAMediaTimingFunction(name: curve)
            animation.fillMode = holds ? .both : .backwards
            animation.isRemovedOnCompletion = !holds
            container.add(animation, forKey: name)
        }
        switch phase {
        case .sitting:
            break
        case .arriving(let elapsed):
            let seconds = Self.arriveMs(pixel: pixel, reduced: reduced) / 1000
            move("opacity", from: 0, to: 1, seconds: seconds, elapsed: elapsed, curve: reduced ? .linear : .easeOut, name: "visit-in", holds: false)
            if !reduced {
                move("transform.translation.y", from: 12 * up, to: 0, seconds: seconds, elapsed: elapsed, curve: .easeOut, name: "visit-drop", holds: false)
            }
        case .leaving(let elapsed):
            let seconds = Self.leaveMs(pixel: pixel, reduced: reduced) / 1000
            container.opacity = 0
            move("opacity", from: 1, to: 0, seconds: seconds, elapsed: elapsed, curve: .linear, name: "visit-out", holds: true)
            if !reduced {
                move("transform.translation.y", from: 0, to: 16 * up, seconds: seconds, elapsed: elapsed, curve: .easeIn, name: "visit-up", holds: true)
            }
            end.fire(after: max(0, seconds - elapsed / 1000))
        }
        CATransaction.commit()
    }

    func clear() {
        wake.cancel(); end.cancel(); retry = nil; key = ""
        CATransaction.begin(); CATransaction.setDisableActions(true)
        container.removeAllAnimations()
        container.sublayers?.forEach { $0.removeFromSuperlayer() }
        container.removeFromSuperlayer()
        container.opacity = 1
        CATransaction.commit()
    }
}
