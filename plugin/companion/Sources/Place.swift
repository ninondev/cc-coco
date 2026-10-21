import AppKit

// Where he goes, as pure functions of Claude's window, the screen, his size and the places he has
// been given (tested on their own; Pet.swift applies the result).
//
// In order:
//   dragging  You are carrying him: he follows the pointer, kept on the screen.
//   free      Claude's window fills the screen (maximized, or full screen), so nothing beside it is
//             clear: he stays where he was, above it, or where you left him the last time this
//             happened (kept apart from everything else, as fractions of that screen).
//   manual    You put him somewhere. Dropped near Claude's window, he keeps his offset from the
//             window corner nearest to him and follows the window as it moves or resizes; dropped
//             farther away, he keeps that spot on the screen. Always kept on the screen.
//   ledge     Automatic: room above the window, he peeks over its top edge from behind it.
//   beside    Automatic: room beside it, he stands in that column, level with its bottom edge.
//   below     Automatic: the strip under it shows three quarters of him, he peeks up from the
//             bottom edge of the screen.
//   corner    Without Accessibility: the lower right corner of the screen while Claude is in front,
//             when Claude's front window does not reach it.
// "Put him back" in his menu forgets the manual place (or, while a window fills the screen, the
// free one) and he goes back to the automatic ones.

enum Place {
    enum Mode: String { case dragging, free, manual, ledge, besideRight, besideLeft, below, corner }

    /// A window corner, and its point in a frame.
    enum Corner: String, CaseIterable {
        case topLeft, topRight, bottomLeft, bottomRight

        func point(in rect: CGRect) -> CGPoint {
            switch self {
            case .topLeft: CGPoint(x: rect.minX, y: rect.maxY)
            case .topRight: CGPoint(x: rect.maxX, y: rect.maxY)
            case .bottomLeft: CGPoint(x: rect.minX, y: rect.minY)
            case .bottomRight: CGPoint(x: rect.maxX, y: rect.minY)
            }
        }
    }

    /// Where you put him.
    enum Manual: Equatable {
        /// His frame's origin as an offset from a corner of Claude's window: he follows the window.
        case window(corner: Corner, dx: CGFloat, dy: CGFloat)
        /// His frame's origin as fractions of the screen below the menu bar: he stays put.
        case screen(x: CGFloat, y: CGFloat)
    }

    /// What placing him needs besides the window.
    struct Places {
        /// Where you put him (outside a window that fills the screen).
        var manual: Manual?
        /// Where you left him while a window filled the screen, as fractions of that screen.
        var full: CGPoint?
        /// Where he was shown last.
        var last: NSRect?
        var wasLedge = false
        /// His frame's origin while you carry him.
        var drag: CGPoint?
    }

    struct Target: Equatable {
        var mode: Mode
        var frame: NSRect
        var number: CGWindowID
        var window: CGRect
        var visible: CGRect
        var screen: CGRect
        var active = true // Claude is the frontmost app
        var overlay: CGRect? = nil // Reserved interactive row/labels; never changes the sprite frame.
        var gestureStartWindow: CGRect? = nil
        /// Placed by you (or free over a full window): above Claude's window, floating while it is in front.
        var chosen: Bool { mode == .dragging || mode == .free || mode == .manual }
    }

    static let ledgeOffset: CGFloat = 64 // his right side this far in from the window's right edge
    static let belowOffset: CGFloat = 24
    /// Dropped within this many points of Claude's window, he follows the window.
    static let near: CGFloat = 48

    private static func automaticSpot(for sighting: Claude.Sighting, size: NSSize, places: Places) -> Target? {
        switch sighting {
        case .none:
            return nil
        case let .corner(visible, screen, front, window):
            func make(_ mode: Mode, _ frame: NSRect) -> Target {
                Target(mode: mode, frame: frame, number: front, window: window, visible: visible, screen: screen)
            }
            if let drag = places.drag { return make(.dragging, clamped(NSRect(origin: drag, size: size), visible, screen)) }
            if fills(window, visible) { return make(.free, freeFrame(size: size, places: places, visible: visible, screen: screen)) }
            if let manual = places.manual { return make(.manual, frame(for: manual, size: size, window: window, visible: visible, screen: screen)) }
            // Only where Claude's front window is not: a full-screen window cannot be stood behind
            // (macOS keeps helper panels above it), so the corner must be clear by geometry alone.
            let corner = NSRect(x: visible.maxX - size.width - 12, y: visible.minY, width: size.width, height: size.height)
            return corner.intersects(window.insetBy(dx: -4, dy: -4)) ? nil : make(.corner, corner)
        case let .window(window, number, fullScreen, visible, screen, active):
            func make(_ mode: Mode, _ frame: NSRect) -> Target {
                Target(mode: mode, frame: frame, number: number, window: window, visible: visible, screen: screen, active: active)
            }
            if let drag = places.drag { return make(.dragging, clamped(NSRect(origin: drag, size: size), visible, screen)) }
            let free = make(.free, freeFrame(size: size, places: places, visible: visible, screen: screen))
            if fullScreen || fills(window, visible) { return free }
            if let manual = places.manual { return make(.manual, frame(for: manual, size: size, window: window, visible: visible, screen: screen)) }
            let sink = (size.height * 0.05).rounded() // the flat bottom of his frame, hidden behind an edge

            // Over the top edge, from behind the window.
            let above = visible.maxY - window.maxY
            if above >= size.height - sink + 2 + (places.wasLedge ? 0 : 4) { // a little hysteresis
                let x = clamp(window.maxX - ledgeOffset - size.width, window.minX + 18, window.maxX - 18 - size.width)
                return make(.ledge, NSRect(x: x, y: window.maxY - sink, width: size.width, height: size.height))
            }
            // In the free column beside the window, level with its bottom edge (the right side when it fits).
            let right = visible.maxX - window.maxX
            let left = window.minX - visible.minX
            let column = size.width + 20
            if right >= column || left >= column {
                let onRight = right >= column
                let x = onRight ? window.maxX + 10 : window.minX - 10 - size.width
                let y = clamp(max(window.minY, visible.minY), visible.minY, min(window.maxY, visible.maxY) - size.height)
                return make(onRight ? .besideRight : .besideLeft, NSRect(x: x, y: y, width: size.width, height: size.height))
            }
            // Peeking up from the bottom of the screen under the window, when the strip below it shows
            // the top three quarters of him, down past his eyes and mouth.
            let strip = window.minY - screen.minY - 4
            if strip >= size.height * 0.75 {
                let x = clamp(window.maxX - belowOffset - size.width, max(window.minX, screen.minX) + 8, min(window.maxX, screen.maxX) - 8 - size.width)
                return make(.below, NSRect(x: x, y: window.minY - 4 - size.height, width: size.width, height: size.height))
            }
            // Nothing clear: the window all but fills the screen.
            return free
        }
    }

    /// While a gesture is live he follows the same placement rule, even when squeezed. After
    /// release the place survives while it fits; a preferred place never causes a gratuitous jump.
    static func spot(for sighting: Claude.Sighting, size: NSSize, places: Places,
                     previous: Target? = nil, liveGesture: Bool = false,
                     motion: CompanionMotionTuning = .standard) -> Target? {
        let automatic = automaticSpot(for: sighting, size: size, places: places)
        guard places.drag == nil, let previous,
              case let .window(window, number, fullScreen, visible, screen, active) = sighting else { return automatic }
        if !liveGesture && (fullScreen || fills(window, visible)) { return automatic }
        var out = previous
        out.window = window; out.number = number; out.visible = visible; out.screen = screen; out.active = active
        out.frame.size = size; out.overlay = nil
        out.gestureStartWindow = liveGesture ? previous.gestureStartWindow ?? previous.window : previous.gestureStartWindow
        switch previous.mode {
        case .ledge:
            let edge = CGFloat(motion.number("cling.ledgeEdgeMarginPt"))
            let margin = CGFloat(motion.number("cling.ledgeScreenMarginPt"))
            let low = window.minX + edge, high = window.maxX - edge - size.width
            let desired = clamp(window.maxX - ledgeOffset - size.width, low, high)
            // Scoot only while both the screen and the window end margins can be honoured.
            let screenLow = max(low, screen.minX + margin), screenHigh = min(high, screen.maxX - margin - size.width)
            out.frame.origin = CGPoint(x: screenLow <= screenHigh ? clamp(desired, screenLow, screenHigh) : desired,
                                       y: window.maxY - (size.height * 0.05).rounded())
        case .besideRight, .besideLeft:
            let right = previous.mode == .besideRight
            let margin = CGFloat(motion.number("squeeze.screenMarginPt"))
            let normalX = right ? window.maxX + 10 : window.minX - 10 - size.width
            out.frame.origin = CGPoint(x: right ? min(normalX, screen.maxX - margin - size.width) : max(normalX, screen.minX + margin),
                                       y: clamp(max(window.minY, visible.minY), visible.minY, min(window.maxY, visible.maxY) - size.height))
        case .below:
            out.frame.origin = CGPoint(x: clamp(window.maxX - belowOffset - size.width, max(window.minX, screen.minX) + 8,
                                                min(window.maxX, screen.maxX) - 8 - size.width),
                                       y: window.minY - 4 - size.height)
        case .manual:
            guard let manual = places.manual else { return automatic }
            out.frame = frame(for: manual, size: size, window: window, visible: visible, screen: screen)
        case .free:
            out.frame = freeFrame(size: size, places: places, visible: visible, screen: screen)
        case .corner, .dragging:
            return automatic
        }
        let contact = contact(for: out, motion: motion)
        if liveGesture { return out }
        let screenArea = freeArea(visible: visible, screen: screen)
        let fits: Bool
        switch out.mode {
        case .ledge:
            fits = contact.rawScale >= 1 && out.frame.minX >= screen.minX && out.frame.maxX <= screen.maxX
                && out.frame.width + 2 * CGFloat(motion.number("cling.ledgeEdgeMarginPt")) <= window.width
        case .besideLeft, .besideRight:
            fits = contact.rawScale >= 1 && screenArea.contains(out.frame)
        case .below:
            fits = !contact.pushedBelow && window.minY - screen.minY - 4 >= size.height * 0.75
                && out.frame.minX >= screen.minX && out.frame.maxX <= screen.maxX
        case .manual, .free:
            fits = screenArea.contains(out.frame)
        default: fits = false
        }
        guard fits else { return automatic }
        out.gestureStartWindow = nil
        return out
    }

    struct Contact: Equatable {
        enum Axis { case none, horizontal, vertical }
        var axis: Axis
        var roomPt: Double
        var rawScale: Double
        var pushDirection: CGPoint
        var belowSinkPt = 0.0
        var pushedBelow = false
        var pushSign: Double { axis == .horizontal ? Double(pushDirection.x) : Double(pushDirection.y) }
    }

    /// The picture's base follows this target in the same geometry event. The place layer then
    /// squeezes toward the obstacle and pushes along this direction; hit testing keeps its rest frame.
    static func contact(for target: Target, motion: CompanionMotionTuning = .standard) -> Contact {
        let height = max(1, Double(target.frame.height)), width = max(1, Double(target.frame.width))
        switch target.mode {
        case .ledge:
            let room = Double(target.visible.maxY - target.frame.minY) - motion.number("squeeze.menuBarMarginPt")
            return Contact(axis: .vertical, roomPt: room, rawScale: room / height, pushDirection: CGPoint(x: 0, y: -1))
        case .besideRight:
            let room = Double(target.screen.maxX - target.window.maxX) - motion.number("squeeze.screenMarginPt") - motion.number("squeeze.besideGapMinPt")
            let free = target.window.maxX + 10 <= target.screen.maxX - CGFloat(motion.number("squeeze.screenMarginPt")) - target.frame.width
            return Contact(axis: .horizontal, roomPt: room, rawScale: free ? 10 : room / width, pushDirection: CGPoint(x: 1, y: 0))
        case .besideLeft:
            let room = Double(target.window.minX - target.screen.minX) - motion.number("squeeze.screenMarginPt") - motion.number("squeeze.besideGapMinPt")
            let free = target.window.minX - 10 - target.frame.width >= target.screen.minX + CGFloat(motion.number("squeeze.screenMarginPt"))
            return Contact(axis: .horizontal, roomPt: room, rawScale: free ? 10 : room / width, pushDirection: CGPoint(x: -1, y: 0))
        case .below:
            let sink = max(0, Double((target.gestureStartWindow ?? target.window).minY - target.window.minY))
            return Contact(axis: .none, roomPt: height, rawScale: 1, pushDirection: CGPoint(x: 0, y: -1),
                           belowSinkPt: sink, pushedBelow: sink > motion.number("squeeze.belowSinkFraction") * height)
        default:
            return Contact(axis: .none, roomPt: height, rawScale: 1, pushDirection: .zero)
        }
    }

    /// Whether a window covers the screen's visible area (give or take 24 points on each side).
    static func fills(_ window: CGRect, _ visible: CGRect) -> Bool {
        window.minX <= visible.minX + 24 && window.maxX >= visible.maxX - 24
            && window.minY <= visible.minY + 24 && window.maxY >= visible.maxY - 24
    }

    /// The screen below the menu bar: where he may go when he is carried or put somewhere.
    static func freeArea(visible: CGRect, screen: CGRect) -> CGRect {
        CGRect(x: screen.minX, y: screen.minY, width: screen.width, height: min(screen.maxY, visible.maxY) - screen.minY)
    }

    static func clamped(_ frame: NSRect, _ visible: CGRect, _ screen: CGRect) -> NSRect {
        let area = freeArea(visible: visible, screen: screen)
        var out = frame
        out.origin.x = clamp(frame.minX, area.minX, area.maxX - frame.width)
        out.origin.y = clamp(frame.minY, area.minY, area.maxY - frame.height)
        return out
    }

    /// His spot while a window fills the screen: where you left him the last time this happened;
    /// else where he was; else the lower right corner.
    static func freeFrame(size: NSSize, places: Places, visible: CGRect, screen: CGRect) -> NSRect {
        let area = freeArea(visible: visible, screen: screen)
        let origin: CGPoint
        if let full = places.full {
            origin = CGPoint(x: area.minX + full.x * max(0, area.width - size.width), y: area.minY + full.y * max(0, area.height - size.height))
        } else if let last = places.last, area.intersects(last) {
            origin = last.origin
        } else {
            origin = CGPoint(x: visible.maxX - size.width - 12, y: visible.minY + 12)
        }
        return clamped(NSRect(origin: origin, size: size), visible, screen)
    }

    /// A spot as fractions of the screen below the menu bar, so it fits when it comes back.
    static func fractions(_ frame: NSRect, visible: CGRect, screen: CGRect) -> CGPoint {
        let area = freeArea(visible: visible, screen: screen)
        let x = area.width > frame.width ? (frame.minX - area.minX) / (area.width - frame.width) : 0
        let y = area.height > frame.height ? (frame.minY - area.minY) / (area.height - frame.height) : 0
        return CGPoint(x: min(max(x, 0), 1), y: min(max(y, 0), 1))
    }

    /// What a drop means: near Claude's window (when it can be followed), an offset from its nearest
    /// corner; otherwise a spot on the screen.
    static func manual(forDrop frame: NSRect, window: CGRect?, visible: CGRect, screen: CGRect) -> Manual {
        if let window, frame.intersects(window.insetBy(dx: -near, dy: -near)) {
            let centre = CGPoint(x: frame.midX, y: frame.midY)
            let corner = Corner.allCases.min {
                hypot($0.point(in: window).x - centre.x, $0.point(in: window).y - centre.y)
                    < hypot($1.point(in: window).x - centre.x, $1.point(in: window).y - centre.y)
            } ?? .bottomRight
            let point = corner.point(in: window)
            return .window(corner: corner, dx: frame.minX - point.x, dy: frame.minY - point.y)
        }
        let spot = fractions(frame, visible: visible, screen: screen)
        return .screen(x: spot.x, y: spot.y)
    }

    /// His frame for a place you gave him, kept on the screen.
    static func frame(for manual: Manual, size: NSSize, window: CGRect, visible: CGRect, screen: CGRect) -> NSRect {
        let area = freeArea(visible: visible, screen: screen)
        let origin: CGPoint
        switch manual {
        case let .window(corner, dx, dy):
            let point = corner.point(in: window)
            origin = CGPoint(x: point.x + dx, y: point.y + dy)
        case let .screen(x, y):
            origin = CGPoint(x: area.minX + x * max(0, area.width - size.width), y: area.minY + y * max(0, area.height - size.height))
        }
        return clamped(NSRect(origin: origin, size: size), visible, screen)
    }

    // ------------------------------------------------------------ his line

    /// The task and the hover row occupy the same spot, just into his transparent top margin.
    static func bubbleFrame(for target: Target, size: NSSize, motion: CompanionMotionTuning = .standard) -> NSRect {
        let area = target.visible.intersection(target.screen)
        let size = NSSize(width: min(size.width, max(1, area.width - 8)), height: min(size.height, max(1, area.height - 4)))
        let origin = target.mode == .below
            ? CGPoint(x: target.frame.minX - 6 - size.width, y: target.frame.maxY - size.height - 4)
            : CGPoint(x: target.frame.midX - size.width / 2, y: target.frame.maxY - 4)
        let frame = NSRect(x: clamp(origin.x, area.minX + 4, area.maxX - 4 - size.width),
                           y: clamp(origin.y, area.minY + 2, area.maxY - 2 - size.height), width: size.width, height: size.height)
        return avoidFace(frame: frame, visible: area, keepOut: faceKeepOut(for: target, motion: motion), margin: CGFloat(motion.number("flip.marginPt"))) ?? .zero
    }

    static func badgeFrame(for target: Target, size: NSSize, motion: CompanionMotionTuning = .standard) -> NSRect {
        let frame = NSRect(x: clamp(target.frame.minX - 4, target.visible.minX + 2, target.visible.maxX - size.width - 2),
                           y: clamp(target.frame.maxY - size.height + 2, target.visible.minY + 2, target.visible.maxY - size.height - 2),
                           width: size.width, height: size.height)
        return avoidFace(frame: frame, visible: target.visible.intersection(target.screen), keepOut: faceKeepOut(for: target, motion: motion), margin: CGFloat(motion.number("flip.marginPt"))) ?? .zero
    }

    static func aroundTarget(for target: Target, overlay: NSRect?) -> Target {
        var result = target
        result.overlay = overlay
        return result
    }

    /// Reserve the whole label lane before any button is hovered, so his line stays still.
    static func hoverOverlay(for target: Target, labelWidths: [CGFloat] = [], motion: CompanionMotionTuning = .standard) -> NSRect {
        let row = bubbleFrame(for: target, size: NSSize(width: 144, height: 32), motion: motion)
        let visible = target.visible.intersection(target.screen)
        var overlay = row
        for (index, width) in labelWidths.prefix(5).enumerated() {
            let button = NSRect(x: row.minX + 4 + CGFloat(index) * 28, y: row.minY + 4, width: 24, height: 24)
            let size = NSSize(width: width, height: 20)
            let original = ButtonLabelPlacement.frame(button: button, row: row, size: size, visible: visible)
            let label = ButtonLabelPlacement.frame(button: button, row: row, size: size, visible: visible,
                                                  faceKeepOut: faceKeepOut(for: target, motion: motion))
            overlay = overlay.union(original)
            if !label.isEmpty { overlay = overlay.union(label) }
        }
        // Reserve both the entire label lane and its edge-flipped counterpart before a button is
        // selected, so moving across siblings never changes where his speech stands.
        overlay = overlay.union(CGRect(x: overlay.minX, y: row.maxY, width: overlay.width, height: 24))
        if row.maxY + 26 > visible.maxY {
            overlay = overlay.union(CGRect(x: overlay.minX, y: row.minY - 24, width: overlay.width, height: 24))
        }
        return overlay
    }

    /// Text starts at its ordinary readable width; side selection and wrapping are independent of
    /// the current lane, so a narrow column can flip the line instead of squeezing its first layout.
    static func lineLimits(for target: Target, motion: CompanionMotionTuning = .standard) -> NSSize {
        let area = target.visible.intersection(target.screen), margin = CGFloat(motion.number("flip.marginPt"))
        return NSSize(width: min(280, max(1, area.width - 2 * margin)), height: min(160, max(1, area.height - 2 * margin)))
    }

    enum LineSide: String, CaseIterable { case above, below, left, right }
    struct LinePlacement: Equatable { var frame: CGRect; var side: LineSide }

    static func faceKeepOut(for target: Target, motion: CompanionMotionTuning = .standard) -> CGRect {
        let f = motion.curve("flip.faceKeepOutFraction"), me = target.frame
        return CGRect(x: me.minX + CGFloat(f[0]) * me.width, y: me.minY + CGFloat(f[1]) * me.height,
                      width: CGFloat(f[2] - f[0]) * me.width, height: CGFloat(f[3] - f[1]) * me.height)
    }

    /// Translate along the shortest axis that clears the face and stays inside the visible area.
    /// nil means the physical viewport cannot fit the supplied rectangle without covering his face.
    static func avoidFace(frame: CGRect, visible: CGRect, keepOut: CGRect, margin: CGFloat = 4) -> CGRect? {
        guard !visible.isNull, visible.width >= frame.width + 2 * margin, visible.height >= frame.height + 2 * margin else { return nil }
        let area = visible.insetBy(dx: margin, dy: margin)
        var base = frame
        base.origin.x = clamp(base.minX, area.minX, area.maxX - base.width)
        base.origin.y = clamp(base.minY, area.minY, area.maxY - base.height)
        if !base.intersects(keepOut) { return base }
        var candidates = [base, base, base, base]
        candidates[0].origin.x = keepOut.minX - base.width
        candidates[1].origin.x = keepOut.maxX
        candidates[2].origin.y = keepOut.minY - base.height
        candidates[3].origin.y = keepOut.maxY
        return candidates.filter { area.contains($0) && !$0.intersects(keepOut) }.min {
            hypot($0.minX - base.minX, $0.minY - base.minY) < hypot($1.minX - base.minX, $1.minY - base.minY)
        }
    }

    private static func lineSides(for target: Target) -> [LineSide] {
        switch target.mode {
        case .ledge: return [.left, .right, .above]
        case .besideRight, .corner: return [.above, .below, .right]
        case .besideLeft: return [.above, .below, .left]
        case .below: return [.left, .right]
        case .free, .manual, .dragging: return [.above, .below, .left, .right]
        }
    }

    private static func lineCandidate(for target: Target, size: NSSize, side: LineSide, gap: CGFloat) -> CGRect {
        let me = target.frame
        switch side {
        case .above: return CGRect(x: me.midX - size.width / 2, y: me.maxY + gap, width: size.width, height: size.height)
        case .below: return CGRect(x: me.midX - size.width / 2, y: me.minY - gap - size.height, width: size.width, height: size.height)
        case .left: return CGRect(x: me.minX - gap - size.width, y: me.midY - size.height / 2, width: size.width, height: size.height)
        case .right: return CGRect(x: me.maxX + gap, y: me.midY - size.height / 2, width: size.width, height: size.height)
        }
    }

    static func linePlacement(for target: Target, size: NSSize, current: LineSide? = nil,
                              motion: CompanionMotionTuning = .standard, allowFallback: Bool = true) -> LinePlacement? {
        let area = target.visible.intersection(target.screen), face = faceKeepOut(for: target, motion: motion)
        let sides = lineSides(for: target), gap = CGFloat(motion.number("flip.gapPt"))
        let margin = CGFloat(motion.number("flip.marginPt")), hysteresis = CGFloat(motion.number("flip.hysteresisPt"))
        func fits(_ side: LineSide, _ spare: CGFloat) -> Bool {
            let rect = lineCandidate(for: target, size: size, side: side, gap: gap)
            return area.insetBy(dx: spare, dy: spare).contains(rect) && !rect.intersects(face)
                && !(target.overlay.map { rect.intersects($0) } ?? false)
        }
        if let current, let rank = sides.firstIndex(of: current), fits(current, margin) {
            let selected = sides.prefix(rank).first { fits($0, hysteresis) } ?? current
            return LinePlacement(frame: lineCandidate(for: target, size: size, side: selected, gap: gap), side: selected)
        }
        if let selected = sides.first(where: { fits($0, margin) }) {
            return LinePlacement(frame: lineCandidate(for: target, size: size, side: selected, gap: gap), side: selected)
        }
        guard allowFallback else { return nil }
        // The caller remeasures at lineWidthLimit (down to 140 pt) before using this fallback.
        let room: (LineSide) -> CGFloat = { side in
            switch side {
            case .left: return target.frame.minX - area.minX
            case .right: return area.maxX - target.frame.maxX
            case .above: return area.maxY - target.frame.maxY
            case .below: return target.frame.minY - area.minY
            }
        }
        for side in sides.sorted(by: { room($0) > room($1) }) {
            guard let frame = avoidFace(frame: lineCandidate(for: target, size: size, side: side, gap: gap), visible: area,
                                        keepOut: face, margin: margin), !(target.overlay.map { frame.intersects($0) } ?? false) else { continue }
            return LinePlacement(frame: frame, side: side)
        }
        return nil
    }

    /// Wrapping requires the view's text measurement; no guessed height is introduced here.
    static func lineWidthLimit(for target: Target, size: NSSize, motion: CompanionMotionTuning = .standard) -> CGFloat {
        let area = target.visible.intersection(target.screen), gap = CGFloat(motion.number("flip.gapPt"))
        let inset = area.insetBy(dx: CGFloat(motion.number("flip.marginPt")), dy: CGFloat(motion.number("flip.marginPt")))
        let face = faceKeepOut(for: target, motion: motion)
        let fits = lineSides(for: target).contains { side in
            let rect = lineCandidate(for: target, size: size, side: side, gap: gap)
            return inset.contains(rect) && !rect.intersects(face) && !(target.overlay.map { rect.intersects($0) } ?? false)
        }
        return fits ? size.width : min(size.width, CGFloat(motion.number("flip.minWidthPt")), max(1, inset.width))
    }

    static func lineFrame(for target: Target, size: NSSize, motion: CompanionMotionTuning = .standard) -> NSRect {
        linePlacement(for: target, size: size, motion: motion)?.frame ?? .zero
    }

    /// The free column beside the window that he stands in (for the corner: beside Claude's window).
    private static func lane(for target: Target) -> ClosedRange<CGFloat> {
        let window = target.window, visible = target.visible
        let onRight = target.mode != .besideLeft
        let low = onRight ? max(window.maxX, visible.minX) + 6 : visible.minX + 4
        let high = onRight ? visible.maxX - 4 : min(window.minX, visible.maxX) - 6
        return low...max(low, high)
    }

    static func clamp(_ value: CGFloat, _ low: CGFloat, _ high: CGFloat) -> CGFloat {
        high < low ? low : min(max(value, low), high)
    }
}
