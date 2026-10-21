import Foundation
import CoreGraphics

/// Data values are passed in by the reloadable companion tuning store, never read on input paths.
struct WindowTuning: Codable, Equatable {
    var targets = ["claude": ["com.anthropic.claudefordesktop"], "vscode": ["com.microsoft.VSCode", "com.microsoft.VSCodeInsiders"]]
    var titleBarHeight = ["com.anthropic.claudefordesktop": 52.0, "com.microsoft.VSCode": 35.0, "com.microsoft.VSCodeInsiders": 35.0]
    var excludedDragRoles = ["AXTextField", "AXTextArea", "AXStaticText", "AXWebArea", "AXScrollArea", "AXImage", "AXLink", "AXButton", "AXSlider", "AXSplitGroup", "AXSplitter"]
    var unchangedDragEvents = 1
    var resizeBorder = 6.0
    var cling = Cling()
    var squeeze = Squeeze()
    var manners = Manners()
    var valid: Bool {
        let numbers = [resizeBorder, cling.stiffness, cling.damping, cling.maxAngle, cling.maxVelocity, cling.impulse, cling.duration,
                       squeeze.minScale, squeeze.impulse, squeeze.release, manners.fadeDistance, manners.fadeOpacity,
                       manners.edgeMargin, manners.bubbleGap] + Array(titleBarHeight.values)
        return numbers.allSatisfy { $0.isFinite && $0 >= 0 }
            && resizeBorder <= 64 && unchangedDragEvents >= 1 && unchangedDragEvents <= 20
            && cling.stiffness > 0 && cling.damping > 0 && cling.maxAngle <= 45 && cling.maxVelocity <= 720 && cling.duration > 0 && cling.duration <= 5
            && squeeze.minScale > 0 && squeeze.minScale <= 1 && squeeze.release > 0 && squeeze.release <= 5
            && manners.fadeDistance <= 512 && manners.fadeOpacity <= 1 && manners.edgeMargin <= 64 && manners.bubbleGap <= 64
            && titleBarHeight.values.allSatisfy { $0 <= 200 }
            && ["claude", "vscode"].allSatisfy { key in
                guard let ids = targets[key], !ids.isEmpty, ids.count <= 8 else { return false }
                return ids.allSatisfy { !$0.isEmpty && $0.utf8.count <= 160 && $0.unicodeScalars.allSatisfy { CharacterSet.alphanumerics.contains($0) || ".-".unicodeScalars.contains($0) } }
            }
            && !excludedDragRoles.isEmpty && excludedDragRoles.count <= 64
            && excludedDragRoles.allSatisfy { $0.hasPrefix("AX") && $0.utf8.count <= 80 }
    }
    struct Cling: Codable, Equatable {
        var stiffness = 190.0
        var damping = 19.0
        var maxAngle = 9.0
        var maxVelocity = 60.0
        var impulse = 0.09
        var duration = 0.65
    }
    struct Squeeze: Codable, Equatable {
        var minScale = 0.82
        var impulse = 0.0025
        var release = 0.45
    }
    struct Manners: Codable, Equatable {
        var fadeDistance = 64.0
        var fadeOpacity = 0.28
        var edgeMargin = 4.0
        var bubbleGap = 6.0
    }
}

struct TargetSession: Equatable {
    var surfaces: [String]
    var updated: Double
    var active: Bool
}

enum CompanionTarget: String { case claude, vscode }
enum TargetSelection {
    /// Terminal-only newest activity deliberately holds the previous target.
    static func select(mode: String, sessions: [TargetSession], current: CompanionTarget) -> CompanionTarget {
        if let fixed = CompanionTarget(rawValue: mode) { return fixed }
        guard let newest = sessions.filter({ $0.active && $0.updated.isFinite }).max(by: { $0.updated < $1.updated }) else { return current }
        if newest.surfaces.contains("desktop") { return .claude }
        if newest.surfaces.contains("vscode") { return .vscode }
        return current
    }
}

enum DragArming {
    /// Geometry is in WindowServer coordinates (top-left). Query roles only at mouse down.
    static func allows(point: CGPoint, frame: CGRect, roles: [String], titleHeight: Double, tuning: WindowTuning) -> Bool {
        guard frame.contains(point), point.x.isFinite, point.y.isFinite else { return false }
        // The same selected-window gesture drives live squeeze during an edge resize.
        let edge = max(0, tuning.resizeBorder)
        if point.x < frame.minX + edge || point.x > frame.maxX - edge || point.y < frame.minY + edge || point.y > frame.maxY - edge { return true }
        if point.y <= frame.minY + max(0, titleHeight) { return true }
        // Unknown hit test is conservative. It is not proof that content is draggable.
        guard !roles.isEmpty else { return false }
        return !roles.contains(where: tuning.excludedDragRoles.contains)
    }
}

enum WindowManners {
    static func opacity(pointer: CGPoint, frame: CGRect, tuning: WindowTuning.Manners, interactive: Bool = false) -> Double {
        guard !interactive, tuning.fadeDistance > 0 else { return 1 }
        let dx = max(frame.minX - pointer.x, 0, pointer.x - frame.maxX)
        let dy = max(frame.minY - pointer.y, 0, pointer.y - frame.maxY)
        let proximity = min(1, hypot(dx, dy) / tuning.fadeDistance)
        return max(0, min(1, tuning.fadeOpacity + (1 - tuning.fadeOpacity) * proximity))
    }

    /// The target's own full-screen Space keeps his free spot. Other full-screen Spaces have
    /// no selected target window and are excluded by the caller's sighting/collection policy.
    static func hidden(fullScreen: Bool) -> Bool { false }

    static func bubble(sprite: CGRect, size: CGSize, visible: CGRect, tuning: WindowTuning.Manners) -> CGRect {
        let margin = max(0, tuning.edgeMargin), gap = max(0, tuning.bubbleGap)
        let width = min(size.width, max(1, visible.width - 2 * margin))
        let height = min(size.height, max(1, visible.height - 2 * margin))
        var y = sprite.maxY + gap
        if y + height > visible.maxY - margin { y = sprite.minY - gap - height }
        let x = min(max(sprite.midX - width / 2, visible.minX + margin), visible.maxX - margin - width)
        y = min(max(y, visible.minY + margin), visible.maxY - margin - height)
        return CGRect(x: x, y: y, width: width, height: height)
    }
}

/// A closed-form damped spring sampled only by active animation frames; no clock owned here.
struct WindowMotion {
    private(set) var angle = 0.0
    private(set) var velocity = 0.0
    private(set) var at = 0.0

    mutating func cling(dx: Double, at now: Double, tuning: WindowTuning.Cling) -> Double {
        settle(at: now, tuning: tuning)
        velocity = min(max(velocity - dx * tuning.impulse * tuning.stiffness.squareRoot(), -tuning.maxVelocity), tuning.maxVelocity)
        angle = min(max(angle - dx * tuning.impulse, -tuning.maxAngle), tuning.maxAngle)
        return angle
    }

    mutating func settle(at now: Double, tuning: WindowTuning.Cling) {
        let elapsed = max(0, now - at)
        at = now
        guard elapsed > 0 else { return }
        let stiffness = max(1, tuning.stiffness), damping = max(0.01, tuning.damping)
        let decay = damping / 2
        let discriminant = stiffness - decay * decay
        let x = angle, v = velocity
        if discriminant > 0 {
            let frequency = discriminant.squareRoot(), e = exp(-decay * elapsed)
            let a = x, b = (v + decay * x) / frequency
            let c = cos(frequency * elapsed), s = sin(frequency * elapsed)
            angle = e * (a * c + b * s)
            velocity = e * ((b * frequency - decay * a) * c - (a * frequency + decay * b) * s)
        } else if discriminant < -0.000001 {
            let frequency = (-discriminant).squareRoot()
            let slow = -decay + frequency, fast = -decay - frequency
            let a = (v - fast * x) / (slow - fast), b = x - a
            let slowPart = a * exp(slow * elapsed), fastPart = b * exp(fast * elapsed)
            angle = slowPart + fastPart
            velocity = slow * slowPart + fast * fastPart
        } else {
            let b = v + decay * x, e = exp(-decay * elapsed)
            angle = (x + b * elapsed) * e
            velocity = (b - decay * (x + b * elapsed)) * e
        }
        velocity = min(max(velocity, -tuning.maxVelocity), tuning.maxVelocity)
        angle = min(max(angle, -tuning.maxAngle), tuning.maxAngle)
        if abs(angle) < 0.001 && abs(velocity) < 0.001 { angle = 0; velocity = 0 }
    }

    static func squeeze(before: CGRect, after: CGRect, sprite: CGRect, tuning: WindowTuning.Squeeze) -> Double {
        let shrink = max(0, before.width - after.width) + max(0, before.height - after.height)
        guard shrink > 0, sprite.intersects(before.insetBy(dx: -sprite.width, dy: -sprite.height)) else { return 1 }
        return max(tuning.minScale, 1 - shrink * tuning.impulse)
    }
}
