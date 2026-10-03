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
        /// Placed by you (or free over a full window): above Claude's window, floating while it is in front.
        var chosen: Bool { mode == .dragging || mode == .free || mode == .manual }
    }

    static let ledgeOffset: CGFloat = 64 // his right side this far in from the window's right edge
    static let belowOffset: CGFloat = 24
    /// Dropped within this many points of Claude's window, he follows the window.
    static let near: CGFloat = 48

    static func spot(for sighting: Claude.Sighting, size: NSSize, places: Places) -> Target? {
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
    static func bubbleFrame(for target: Target, size: NSSize) -> NSRect {
        let area = target.visible.intersection(target.screen)
        let size = NSSize(width: min(size.width, max(1, area.width - 8)), height: min(size.height, max(1, area.height - 4)))
        let origin = target.mode == .below
            ? CGPoint(x: target.frame.minX - 6 - size.width, y: target.frame.maxY - size.height - 4)
            : CGPoint(x: target.frame.midX - size.width / 2, y: target.frame.maxY - 4)
        return NSRect(x: clamp(origin.x, area.minX + 4, area.maxX - 4 - size.width),
                      y: clamp(origin.y, area.minY + 2, area.maxY - 2 - size.height), width: size.width, height: size.height)
    }

    static func badgeFrame(for target: Target, size: NSSize) -> NSRect {
        NSRect(x: clamp(target.frame.minX - 4, target.visible.minX + 2, target.visible.maxX - size.width - 2),
               y: clamp(target.frame.maxY - size.height + 2, target.visible.minY + 2, target.visible.maxY - size.height - 2),
               width: size.width, height: size.height)
    }

    static func aroundTarget(for target: Target, overlay: NSRect?) -> Target {
        var result = target
        if let overlay { result.frame = target.frame.union(overlay) }
        return result
    }

    /// Reserve the whole label lane before any button is hovered, so his line stays still.
    static func hoverOverlay(for target: Target, labelWidths: [CGFloat] = []) -> NSRect {
        let row = bubbleFrame(for: target, size: NSSize(width: 144, height: 32))
        let visible = target.visible.intersection(target.screen)
        var left = row.minX, right = row.maxX
        for (index, width) in labelWidths.prefix(5).enumerated() {
            let button = NSRect(x: row.minX + 4 + CGFloat(index) * 28, y: row.minY + 4, width: 24, height: 24)
            let label = ButtonLabelPlacement.frame(button: button, row: row, size: NSSize(width: width, height: 20), visible: visible)
            left = min(left, label.minX); right = max(right, label.maxX)
        }
        var overlay = row.union(NSRect(x: left, y: row.maxY, width: right - left, height: 24))
        if row.maxY + 26 > visible.maxY {
            overlay = overlay.union(NSRect(x: left, y: row.minY - 24, width: right - left, height: 24))
        }
        return overlay
    }

    /// How wide and tall his line may be where he stands.
    static func lineLimits(for target: Target) -> NSSize {
        let me = target.frame, window = target.window, visible = target.visible
        switch target.mode {
        case .ledge:
            return NSSize(width: 280, height: max(visible.maxY - 2 - (window.maxY + 2), 20))
        case .besideRight, .besideLeft, .corner:
            let lane = lane(for: target)
            return NSSize(width: min(280, max(lane.upperBound - lane.lowerBound, me.width + 12)), height: 160)
        case .below:
            return NSSize(width: 280, height: max(window.minY - target.screen.minY - 8, 20))
        case .free, .manual, .dragging:
            return NSSize(width: 280, height: 160)
        }
    }

    /// Where his line goes for a measured size: beside him on the top edge (ledge), above him in his
    /// column (beside, corner), beside him in the strip (below), over or under him wherever you put
    /// him; always inside the screen and never over him.
    static func lineFrame(for target: Target, size: NSSize) -> NSRect {
        let me = target.frame, window = target.window, visible = target.visible, screen = target.screen
        var frame: NSRect
        switch target.mode {
        case .ledge:
            let bottom = window.maxY + 2
            var x = me.minX - 6 - size.width
            if x < visible.minX + 4 { x = me.maxX + 6 }
            frame = NSRect(x: x, y: bottom + max(0, (me.maxY - bottom - size.height) / 2), width: size.width, height: size.height)
        case .besideRight, .besideLeft, .corner:
            let lane = lane(for: target)
            let x = clamp(me.midX - size.width / 2, lane.lowerBound, lane.upperBound - size.width)
            var y = me.maxY + 6
            if y + size.height > visible.maxY - 2 { y = me.minY - 6 - size.height }
            frame = NSRect(x: x, y: y, width: size.width, height: size.height)
        case .below:
            var x = me.minX - 6 - size.width
            if x < screen.minX + 4 { x = me.maxX + 6 }
            frame = NSRect(x: x, y: window.minY - 4 - size.height, width: size.width, height: size.height)
        case .free, .manual, .dragging:
            let area = freeArea(visible: visible, screen: screen)
            let x = clamp(me.midX - size.width / 2, area.minX + 4, area.maxX - 4 - size.width)
            var y = me.maxY + 6
            if y + size.height > area.maxY - 2 { y = me.minY - 6 - size.height }
            frame = NSRect(x: x, y: y, width: size.width, height: size.height)
        }
        frame.origin.x = clamp(frame.minX, screen.minX + 4, screen.maxX - 4 - frame.width)
        frame.origin.y = clamp(frame.minY, screen.minY + 2, screen.maxY - 2 - frame.height)
        return frame
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
