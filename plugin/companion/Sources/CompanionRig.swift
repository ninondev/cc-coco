import AppKit
import QuartzCore

/// Completions belong to finite WindowServer animations, never a frame clock in this process.
@MainActor
final class CompanionAnimationEnd: NSObject, CAAnimationDelegate {
    private let done: () -> Void
    init(_ done: @escaping () -> Void) { self.done = done }
    nonisolated func animationDidStop(_ anim: CAAnimation, finished flag: Bool) {
        if flag { MainActor.assumeIsolated { done() } }
    }
}

@MainActor
enum CompanionAnimation {
    static func timing(_ points: [Double]) -> CAMediaTimingFunction {
        guard points.count == 4 else { return CAMediaTimingFunction(name: .linear) }
        return CAMediaTimingFunction(controlPoints: Float(points[0]), Float(points[1]), Float(points[2]), Float(points[3]))
    }
    static func transform(_ sample: CompanionClingSample) -> CATransform3D {
        var value = CATransform3DIdentity
        value.m11 = sample.scaleX
        value.m21 = tan(sample.lean * .pi / 180) * sample.scaleY
        value.m22 = sample.scaleY
        return value
    }
    static func transforms(on layer: CALayer, key: String, values: [CATransform3D], times: [Double],
                           at eventTime: Double? = nil, curve: [Double]? = nil, discrete: Bool = false, done: (() -> Void)? = nil) {
        guard values.count == times.count, let last = values.last, let duration = times.last, duration > 0 else {
            layer.removeAnimation(forKey: key)
            CATransaction.begin(); CATransaction.setDisableActions(true)
            layer.transform = values.last ?? CATransform3DIdentity; CATransaction.commit()
            done?(); return
        }
        let animation = CAKeyframeAnimation(keyPath: "transform")
        animation.values = values.map { NSValue(caTransform3D: $0) }
        animation.keyTimes = times.map { NSNumber(value: $0 / duration) }
        animation.calculationMode = discrete ? .discrete : .linear; animation.duration = duration
        if let curve { animation.timingFunctions = Array(repeating: timing(curve), count: max(0, values.count - 1)) }
        animation.beginTime = layer.convertTime(eventTime ?? CACurrentMediaTime(), from: nil)
        if let done { animation.delegate = CompanionAnimationEnd(done) }
        CATransaction.begin(); CATransaction.setDisableActions(true)
        layer.transform = last; layer.add(animation, forKey: key); CATransaction.commit()
    }
    static func opacity(on layer: CALayer, to alpha: Double, ms: Double, curve: [Double], key: String,
                        done: (() -> Void)? = nil) {
        let animation = CABasicAnimation(keyPath: "opacity")
        animation.fromValue = layer.presentation()?.opacity ?? layer.opacity; animation.toValue = alpha
        animation.duration = ms / 1000; animation.timingFunction = timing(curve)
        if let done { animation.delegate = CompanionAnimationEnd(done) }
        CATransaction.begin(); CATransaction.setDisableActions(true)
        layer.opacity = Float(alpha); layer.add(animation, forKey: key); CATransaction.commit()
    }
}

/// A speech/card/Activity panel has one placement transition and one pointer-fade target.
@MainActor
final class CompanionPanelMotion {
    private(set) var side: Place.LineSide?
    private var serial = 0
    private var flipping = false
    private var alpha = 1.0
    private var pending: Place.LinePlacement?

    func reset(on panel: NSPanel) {
        serial += 1; flipping = false; pending = nil; side = nil; alpha = 1
        panel.contentView?.layer?.removeAnimation(forKey: "line-flip")
        panel.contentView?.layer?.removeAnimation(forKey: "pointer-fade")
        panel.contentView?.layer?.removeAnimation(forKey: "line-slide")
        panel.contentView?.layer?.opacity = 1
        panel.contentView?.layer?.transform = CATransform3DIdentity
    }

    func place(_ panel: NSPanel, placement: Place.LinePlacement, reduceMotion: Bool,
               tuning: CompanionMotionTuning, forceIn: Bool = false) {
        guard let view = panel.contentView else { return }
        view.wantsLayer = true
        guard let layer = view.layer else { return }
        if flipping { pending = placement; return }
        let old = side; side = placement.side
        guard old != nil, old != placement.side, panel.isVisible, !forceIn else {
            panel.setFrame(placement.frame, display: true)
            if forceIn { enter(layer, side: placement.side, reduceMotion: reduceMotion, tuning: tuning) }
            return
        }
        serial += 1; let token = serial; flipping = true; pending = placement
        CompanionAnimation.opacity(on: layer, to: 0, ms: tuning.number("flip.outMs"),
                                   curve: tuning.curve("flip.outCurve"), key: "line-flip") { [weak self, weak panel] in
            guard let self, let panel, self.serial == token, let wanted = self.pending else { return }
            self.pending = nil; self.flipping = false; self.side = wanted.side
            panel.setFrame(wanted.frame, display: true)
            self.enter(layer, side: wanted.side, reduceMotion: reduceMotion, tuning: tuning)
        }
    }
    private func enter(_ layer: CALayer, side: Place.LineSide, reduceMotion: Bool, tuning: CompanionMotionTuning) {
        layer.opacity = 0
        CompanionAnimation.opacity(on: layer, to: alpha, ms: tuning.number("flip.inMs"),
                                   curve: tuning.curve("flip.inCurve"), key: "line-flip")
        if !reduceMotion {
            let slide = tuning.number("flip.slidePt")
            var start = CATransform3DIdentity
            switch side {
            case .left: start.m41 = slide
            case .right: start.m41 = -slide
            case .above: start.m42 = -slide
            case .below: start.m42 = slide
            }
            CompanionAnimation.transforms(on: layer, key: "line-slide", values: [start, CATransform3DIdentity],
                                          times: [0, tuning.number("flip.inMs") / 1000], curve: tuning.curve("flip.inCurve"))
        }
    }
    func fade(_ panel: NSPanel, to value: Double, restoring: Bool, tuning: CompanionMotionTuning) {
        alpha = value
        guard !flipping, let view = panel.contentView else { return }
        view.wantsLayer = true
        guard let layer = view.layer else { return }
        CompanionAnimation.opacity(on: layer, to: value, ms: tuning.number(restoring ? "near.upMs" : "near.downMs"),
                                   curve: tuning.curve(restoring ? "near.upCurve" : "near.downCurve"), key: "pointer-fade")
    }
}

/// Two rectangle distances and finite deadlines; no pointer sampling outside delivered events.
struct CompanionPointerFade {
    enum Band: Int { case far, near, over }
    private(set) var band = Band.far
    private(set) var restoreAt: Double?
    private var wanted = Band.far
    static func distance(_ pointer: CGPoint, to rect: CGRect) -> Double {
        hypot(max(rect.minX - pointer.x, 0, pointer.x - rect.maxX), max(rect.minY - pointer.y, 0, pointer.y - rect.maxY))
    }
    func alpha(_ tuning: CompanionMotionTuning, reduceTransparency: Bool = false) -> Double {
        if reduceTransparency { return band == .over ? 0 : 1 }
        switch band { case .far: return 1; case .near: return tuning.number("near.alphaNear"); case .over: return tuning.number("near.alphaOver") }
    }
    mutating func update(distance: Double, at seconds: Double, deliberate: Bool, tuning: CompanionMotionTuning) -> Bool {
        var next: Band
        if distance <= tuning.number("near.overInPt") || band == .over && distance <= tuning.number("near.overOutPt") { next = .over }
        else if distance <= tuning.number("near.nearInPt") || band != .far && distance <= tuning.number("near.nearOutPt") { next = .near }
        else { next = .far }
        let quick = deliberate && next == .near
        if quick { next = .far }
        wanted = next
        if next.rawValue > band.rawValue {
            band = next; restoreAt = nil; return true
        }
        if next.rawValue < band.rawValue {
            if quick { band = next; restoreAt = nil; return true }
            if restoreAt == nil { restoreAt = seconds + tuning.number("near.upDwellMs") / 1000 }
            return advance(at: seconds)
        }
        restoreAt = nil; return false
    }
    mutating func advance(at seconds: Double) -> Bool {
        guard let restoreAt, seconds >= restoreAt else { return false }
        band = wanted; self.restoreAt = nil; return true
    }
}
