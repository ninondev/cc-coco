import AppKit

// Play on the Mac companion: the shake and its spin, the lid's nap, and his stick. The numbers are
// pure and sit here so they can be read off; Pet.swift only draws them. The Rust companion
// (plugin/companion-rs/src/shake.rs and stick.rs) carries the same numbers for Windows and Linux.

/// Shake: three reversals of at least 20 points inside 800 ms, read from the positions the carry
/// already reports. No timer, nothing to poll. True once per carry.
struct ShakeDetector {
    static let swing = 20.0
    static let windowMs = 800.0
    static let reversals = 3

    private struct Axis {
        var extreme = 0.0
        var direction = 0
        var seen = false
    }
    private var axes = [Axis(), Axis()]
    private var times: [[Double]] = [[], []]
    private(set) var fired = false

    mutating func reset() { self = ShakeDetector() }

    /// One pointer position of the carry, in points, with the time in milliseconds.
    mutating func feed(x: Double, y: Double, at now: Double) -> Bool {
        guard !fired, x.isFinite, y.isFinite, now.isFinite else { return false }
        for index in 0..<2 {
            let value = index == 0 ? x : y
            if !axes[index].seen {
                axes[index] = Axis(extreme: value, direction: 0, seen: true)
                continue
            }
            let moved = value - axes[index].extreme
            if axes[index].direction == 0 {
                if abs(moved) >= Self.swing {
                    axes[index].direction = moved > 0 ? 1 : -1
                    axes[index].extreme = value
                }
                continue
            }
            if moved * Double(axes[index].direction) > 0 {
                axes[index].extreme = value
            } else if abs(moved) >= Self.swing {
                axes[index].direction = -axes[index].direction
                axes[index].extreme = value
                times[index].append(now)
                times[index].removeAll { now - $0 > Self.windowMs }
                if times[index].count >= Self.reversals {
                    fired = true
                    return true
                }
            }
        }
        return false
    }
}

/// The spin: four half-turns of 200, 220, 260 and 320 ms, each narrowing to an edge and widening
/// again as his back (his flustered face until the back is drawn), then a dizzy sway of 3.5, 2 and
/// 1 degrees over 1300 ms. A second shake within eight seconds only makes him hold his book tight.
enum Spin {
    static let halfTurns: [Double] = [200, 220, 260, 320]
    static let spinMs = 1000.0
    static let dizzyMs = 1300.0
    static let againMs = 8000.0
    /// With Reduce Motion: a cut to the flustered face for this long, and the line.
    static let stillMs = 1200.0
    static let narrowest = 0.06

    static func totalMs(reduceMotion: Bool) -> Double { reduceMotion ? stillMs : spinMs + dizzyMs }

    /// The times at which each half-turn is edge-on, where the picture flips between front and back.
    static var edges: [Double] {
        var result: [Double] = []
        var start = 0.0
        for length in halfTurns {
            result.append(start + length / 2)
            start += length
        }
        return result
    }

    /// Where each half-turn starts, plus the end of the last: the key times of the scale.
    static var starts: [Double] {
        var result: [Double] = [0]
        var start = 0.0
        for length in halfTurns {
            start += length
            result.append(start)
        }
        return result
    }

    /// The face role at `t` ms: front, back or dizzy.
    static func role(at t: Double) -> String {
        if t >= spinMs { return "dizzy" }
        var flips = 0
        for edge in edges where t >= edge { flips += 1 }
        // Front until the first edge, back until the second, front, back, then front again.
        return flips % 2 == 1 ? "back" : "front"
    }

    /// Tan of the sway angle `d` ms into the dizzy beat: the picture's skew stands for a tilt.
    static func skew(after d: Double) -> Double {
        let third = dizzyMs / 3
        var amplitude = 1.0
        var local = d - 2 * third
        if d < third {
            amplitude = 3.5
            local = d
        } else if d < 2 * third {
            amplitude = 2.0
            local = d - third
        }
        let angle = amplitude * sin(local / third * 2 * Double.pi)
        return tan(angle * Double.pi / 180)
    }

    /// The dizzy sway sampled every 100 ms, for one additive keyframe animation.
    static var swaySamples: [Double] {
        stride(from: 0.0, through: dizzyMs, by: 100).map { skew(after: $0) }
    }
}

/// The lid: asleep from the system's sleep notice until he is back (the unlock, or two seconds
/// after the system woke when the screen was never locked), then 1.2 s more asleep, then the wake.
struct Nap: Equatable {
    static let settleMs = 2_000.0
    static let holdMs = 1_200.0

    var wokeAt: Double?
    var locked = false
    var wakeAt: Double?

    mutating func systemWoke(at now: Double, locked: Bool) {
        wokeAt = now
        self.locked = locked
        wakeAt = locked ? nil : now + Self.settleMs + Self.holdMs
    }

    mutating func unlocked(at now: Double) {
        guard wokeAt != nil, locked else { return }
        locked = false
        wakeAt = now + Self.holdMs
    }
}

/// `/coco focus`: one stick, lit for a time. The feed carries the two times; nothing else.
struct Stick: Equatable {
    static let steps = 42
    static let maxMs = 90.0 * 60_000
    /// How long after the end the picture lingers: the ember out, the last wisp.
    static let endMs = 2_000.0

    var startedAt: Double
    var endsAt: Double

    init?(_ raw: Any?) {
        guard let object = raw as? [String: Any],
              let start = object["startedAt"] as? Double, let end = object["endsAt"] as? Double,
              start.isFinite, end.isFinite, end > start, end - start <= Self.maxMs else { return nil }
        startedAt = start
        endsAt = end
    }

    func burning(at now: Double) -> Bool { now >= startedAt && now < endsAt }

    /// Whether anything of it is still drawn: burning, or in the two seconds after the end.
    func visible(at now: Double) -> Bool { now >= startedAt && now - endsAt < Self.endMs }

    /// Steps burned, 0 at the lighting to 42 at the end.
    func burned(at now: Double) -> Int {
        let share = min(1, max(0, (now - startedAt) / (endsAt - startedAt)))
        return min(Self.steps, Int(floor(share * Double(Self.steps))))
    }

    /// When the picture next changes, in the same milliseconds as `now`; nil when nothing more will.
    func nextChange(after now: Double, reduceMotion: Bool) -> Double? {
        if now < startedAt { return nil }
        if now < endsAt {
            let next = startedAt + Double(burned(at: now) + 1) / Double(Self.steps) * (endsAt - startedAt)
            return min(next, endsAt)
        }
        let after = now - endsAt
        if after >= Self.endMs { return nil }
        if reduceMotion { return endsAt + 800 }
        return endsAt + (floor(after / 200) + 1) * 200
    }
}

/// His stick, small, at the bottom right of his picture: a dish, a stick that burns down in
/// one-pixel steps, an ember in his vermilion and a thin wisp. Drawn in code, no file.
enum StickArt {
    static let width = 7
    static let height = 52

    static func image(steps: Int, ended: Double?, dark: Bool, highContrast: Bool) -> CGImage? {
        let wood: [Double] = dark ? [0xC0, 0xA9, 0x8E] : [0x84, 0x6D, 0x57]
        let ember: [Double] = dark ? [0xE5, 0x56, 0x2E] : [0xC7, 0x57, 0x30]
        let smoke: [Double] = dark ? [0xC5, 0xBE, 0xB1] : [0x6B, 0x66, 0x5F]
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        func put(_ x: Int, _ y: Int, _ rgb: [Double], _ alpha: Double) {
            guard x >= 0, x < width, y >= 0, y < height, alpha > 0 else { return }
            let at = (y * width + x) * 4
            for i in 0..<3 { pixels[at + i] = UInt8(max(0, min(255, (rgb[i] * alpha).rounded()))) }
            pixels[at + 3] = UInt8(max(0, min(255, (255 * alpha).rounded())))
        }
        for x in 1..<6 { put(x, height - 1, wood, 1) }
        for x in 2..<5 { put(x, height - 2, wood, 1) }
        let base = height - 3
        let burned = max(0, min(Stick.steps, steps))
        let left = Stick.steps - burned
        let wisp = highContrast ? 1.0 : 0.7
        if let ago = ended {
            // The ember goes out in 800 ms; a last wisp rises and thins for the next 1.2 s.
            if ago < 800 {
                put(3, base, ember, 1 - ago / 800)
            } else if ago < Stick.endMs {
                let rise = Int(floor((ago - 800) / 1200 * 6))
                put(3, max(0, base - rise), smoke, wisp * (1 - (ago - 800) / 1200))
            }
        } else {
            for row in 0..<left { put(3, base - row, wood, 1) }
            if left > 0 {
                let top = base - (left - 1)
                put(3, max(0, top - 1), ember, 1)
                put(4, max(0, top - 3), smoke, wisp)
            }
        }
        let data = Data(pixels) as CFData
        guard let provider = CGDataProvider(data: data) else { return nil }
        return CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: width * 4,
                       space: CGColorSpaceCreateDeviceRGB(),
                       bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
                       provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)
    }
}
