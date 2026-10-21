import CoreGraphics
import Foundation
import ImageIO

// Coco's frames (CocoModel.swift) drawn with Core Graphics, the way companion-rs's coco.rs draw_pose draws them:
// the final clip in canvas units and the local clip moved with the element, the picture stretched over the canvas,
// then the worn socks and the lids over it; an element that fades with patches on it fades as one group.
// tools/companion-swift/coco-check.sh checks the same draw list against the Rust pixels with a software rasteriser;
// this file needs a Mac.

extension CocoAffine {
    var cg: CGAffineTransform { CGAffineTransform(a: CGFloat(a), b: CGFloat(b), c: CGFloat(c), d: CGFloat(d), tx: CGFloat(e), ty: CGFloat(f)) }
}

final class CocoPaint {
    private var decoded: [String: CGImage] = [:]
    private var revision = 0
    private let space = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()

    /// One of the bank's pictures, decoded once; the sock patches again when another pair is worn.
    func picture(_ key: String, in bank: CocoBank) -> CGImage? {
        if bank.revision != revision {
            for name in decoded.keys where name.hasSuffix("#socks") { decoded[name] = nil }
            revision = bank.revision
        }
        if let hit = decoded[key] { return hit }
        guard let data = bank.pictures[key], let image = Self.decode(data) else { return nil }
        decoded[key] = image
        return image
    }

    static func decode(_ data: Data) -> CGImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        return CGImageSourceCreateImageAtIndex(source, 0, [kCGImageSourceShouldCacheImmediately: true] as CFDictionary)
    }

    /// A clear picture whose user space runs in device pixels from the top left, as the frame's maps do.
    private func context(_ width: Int, _ height: Int) -> CGContext? {
        guard let context = CGContext(data: nil, width: max(width, 1), height: max(height, 1), bitsPerComponent: 8,
                                      bytesPerRow: 0, space: space,
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        context.translateBy(x: 0, y: CGFloat(height))
        context.scaleBy(x: 1, y: -1)
        context.interpolationQuality = .high
        return context
    }

    /// The frame as one picture of frame.width x frame.height device pixels; nil when it cannot be drawn.
    func image(_ frame: CocoFrame, bank: CocoBank) -> CGImage? {
        guard let out = context(frame.width, frame.height) else { return nil }
        let (cw, ch) = frame.canvas
        for d in frame.draws {
            guard let sprite = picture(d.src, in: bank) else { continue }
            let image = d.placed.then(.scale(cw / Double(sprite.width), ch / Double(sprite.height)))
            var patches: [(CGImage, CocoAffine)] = []
            for patch in [d.socks, d.lids] {
                guard let (key, box) = patch, let p = picture(key, in: bank) else { continue }
                patches.append((p, d.placed.then(.translate(box[0], box[1])).then(.scale(box[2] / Double(p.width), box[3] / Double(p.height)))))
            }
            out.saveGState()
            if d.opacity < 0.999 && !patches.isEmpty {
                // the opacity belongs to the whole group, their socks and lids included
                if clip(out, d.clipFinal, space: d.canvas, local: false) {
                    out.setAlpha(CGFloat(d.opacity))
                    out.beginTransparencyLayer(auxiliaryInfo: nil)
                    if clip(out, d.clipLocal, space: d.moved, local: true) {
                        draw(out, sprite, at: image)
                        for (p, at) in patches { draw(out, p, at: at) }
                    }
                    out.endTransparencyLayer()
                }
            } else if clip(out, d.clipFinal, space: d.canvas, local: false), clip(out, d.clipLocal, space: d.moved, local: true) {
                out.setAlpha(CGFloat(d.opacity))
                draw(out, sprite, at: image)
                for (p, at) in patches { draw(out, p, at: at) }
            }
            out.restoreGState()
        }
        return out.makeImage()
    }

    /// Claudie's cell for the action Coco plays, fitted into Coco's canvas and standing on its bottom edge
    /// (companion-rs/src/claudie.rs render).
    func image(claudie cell: CGImage, width: Int, height: Int) -> CGImage? {
        guard let out = context(width, height) else { return nil }
        let scale = min(Double(height) / Double(cell.height), Double(width) / Double(cell.width))
        let (w, h) = (Double(cell.width) * scale, Double(cell.height) * scale)
        draw(out, cell, at: CocoAffine(a: scale, b: 0, c: 0, d: scale, e: (Double(width) - w) / 2, f: Double(height) - h))
        return out.makeImage()
    }

    /// Clips to a rect in `space`; false when the clip leaves nothing (an empty clip draws nothing).
    private func clip(_ context: CGContext, _ raw: [Double]?, space: CocoAffine, local: Bool) -> Bool {
        guard let raw = raw, !cocoClipIsOpen(raw) else { return true }
        let rect = local ? cocoOverlapSplit(raw, space: space) : raw
        let edge = { (v: Double) in min(max(v, -cocoOpenEdge), cocoOpenEdge) }
        let (l, t, r, b) = (edge(rect[0]), edge(rect[1]), edge(rect[2]), edge(rect[3]))
        guard r > l, b > t, space.inverted != nil else { return false }
        var transform = space.cg
        context.addPath(CGPath(rect: CGRect(x: l, y: t, width: r - l, height: b - t), transform: &transform))
        context.clip()
        return true
    }

    /// A picture placed by a map from its own pixels (rows from the top) to the frame's.
    private func draw(_ context: CGContext, _ image: CGImage, at map: CocoAffine) {
        context.saveGState()
        context.concatenate(map.cg)
        context.translateBy(x: 0, y: CGFloat(image.height))
        context.scaleBy(x: 1, y: -1)
        context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
        context.restoreGState()
    }
}

/// Claudie's sixteen cells for one form (assets/claudie/<form>/01.png to 16.png), read once; nil when one is missing.
struct CocoClaudieCells {
    let form: String
    let cells: [CGImage]
    init?(folder: URL, form: String) {
        guard CocoClaudie.forms.contains(form) else { return nil }
        var cells: [CGImage] = []
        for n in 1...16 {
            let url = folder.appendingPathComponent(form, isDirectory: true).appendingPathComponent(String(format: "%02d.png", n))
            guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
                  let image = CGImageSourceCreateImageAtIndex(source, 0, [kCGImageSourceShouldCacheImmediately: true] as CFDictionary)
            else { return nil }
            cells.append(image)
        }
        self.form = form
        self.cells = cells
    }
    func cell(for action: String) -> CGImage { cells[CocoClaudie.cell(form: form, action: action) - 1] }
}
