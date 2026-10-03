import AppKit
import ImageIO

// His pictures: the mod's own frames, copied into the app at install, never drawn in code. Extra
// small and Small are the pixel heads (assets/pixel/NN-name.png) at whole device pixels per art
// pixel, at most 48 and 72 points tall (48 and 64 points on a Retina screen with the current
// sheet). Medium 96 and Large 128 points use the painted frames (assets/desktop/NN-name.png,
// 137 x 128 palette PNGs).
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
    static let names = [
        "idle-reading", "idle-blink", "think-a", "think-b", "work-a", "work-b", "happy", "waiting",
        "error", "wild-a", "wild-b", "sleep", "refuse", "flustered", "wave", "snake",
    ]

    private let folder: URL
    private let pixelFolder: URL
    private var made: [String: CGImage] = [:]

    // Every pixel frame shares one canvas, whose dimensions come from the first PNG.
    private lazy var pixelCanvas: (width: Int, height: Int)? = {
        let url = pixelFolder.appendingPathComponent("01-idle-reading.png")
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [String: Any],
              let width = properties[kCGImagePropertyPixelWidth as String] as? Int,
              let height = properties[kCGImagePropertyPixelHeight as String] as? Int,
              width > 0, height > 0 else { return nil }
        return (width, height)
    }()

    init(folder: URL, pixelFolder: URL) {
        self.folder = folder
        self.pixelFolder = pixelFolder
    }

    private static func kind(_ size: Size) -> String { size.pixelArt ? "pixel/" : "desktop/" }

    // Round pixel factors down, separating equal sizes while keeping Small below Medium.
    private func deviceHeight(_ size: Size, scale: CGFloat) -> Int? {
        guard size.pixelArt else { return Int((size.height * scale).rounded()) }
        guard let canvas = pixelCanvas else { return nil }
        var tiny = max(1, Int((Size.tiny.height * scale / CGFloat(canvas.height)).rounded(.down)))
        var small = max(1, Int((Size.small.height * scale / CGFloat(canvas.height)).rounded(.down)))
        if tiny == small {
            if tiny > 1 {
                tiny -= 1
            } else if canvas.height * 2 < Int((Size.medium.height * scale).rounded()) {
                small = 2
            }
        }
        let factor = size == .tiny ? tiny : small
        return canvas.height * factor
    }

    /// The frame at this size on a screen of this scale, in device pixels; nil for an unknown or
    /// unreadable frame.
    func image(_ name: String, size: Size, scale: CGFloat) -> CGImage? {
        guard let pixels = deviceHeight(size, scale: scale) else { return nil }
        let key = "\(Self.kind(size))\(name)@\(pixels)"
        if let hit = made[key] { return hit }
        guard let index = Self.names.firstIndex(of: name) else { return nil }
        let url = (size.pixelArt ? pixelFolder : folder).appendingPathComponent(String(format: "%02d-%@.png", index + 1, name))
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let picture = CGImageSourceCreateImageAtIndex(source, 0, nil),
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
            let aspect: CGFloat = size.pixelArt ? 1 : 137.0 / 128.0
            return NSSize(width: (size.height * aspect).rounded(), height: size.height)
        }
        return NSSize(width: CGFloat(picture.width) / scale, height: CGFloat(picture.height) / scale)
    }

    /// Forgets pictures made for other sizes (after the size changes).
    func keep(_ size: Size, scale: CGFloat) {
        guard let pixels = deviceHeight(size, scale: scale) else {
            made.removeAll()
            return
        }
        let kind = Self.kind(size)
        let suffix = "@\(pixels)"
        made = made.filter { $0.key.hasPrefix(kind) && $0.key.hasSuffix(suffix) }
    }

    // Area-average resampling to `height` pixels on the source's own uniform grid: the output is
    // ceil(width / step) wide, its last column reaching into clear padding, so both axes keep the
    // same step and the pixel grid stays exact.
    private static func resample(_ picture: CGImage, height outHeight: Int) -> CGImage? {
        let inWidth = picture.width
        let inHeight = picture.height
        guard outHeight > 0, inHeight > 0 else { return nil }
        let step = Double(inHeight) / Double(outHeight) // source pixels per output pixel
        let outWidth = Int((Double(inWidth) / step - 1e-9).rounded(.up))
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
