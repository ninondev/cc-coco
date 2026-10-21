import Foundation

/// The approved flat keys are retained in the JSON motion object; comments are metadata.
struct CompanionMotionTuning: Codable, Equatable {
    enum Value: Codable, Equatable {
        case number(Double), array([Double]), text(String)
        init(from decoder: Decoder) throws {
            let box = try decoder.singleValueContainer()
            if let number = try? box.decode(Double.self) { self = .number(number) }
            else if let array = try? box.decode([Double].self) { self = .array(array) }
            else { self = .text(try box.decode(String.self)) }
        }
        func encode(to encoder: Encoder) throws {
            var box = encoder.singleValueContainer()
            switch self {
            case .number(let value): try box.encode(value)
            case .array(let value): try box.encode(value)
            case .text(let value): try box.encode(value)
            }
        }
    }
    private var values: [String: Value]
    init() { values = Self.defaults }
    init(from decoder: Decoder) throws {
        let box = try decoder.singleValueContainer()
        let supplied = try box.decode([String: Value].self)
        values = Self.defaults
        for (key, value) in supplied where Self.defaults[key] != nil { values[key] = value }
        guard valid else { throw DecodingError.dataCorruptedError(in: box, debugDescription: "invalid motion tuning") }
    }
    func encode(to encoder: Encoder) throws {
        var box = encoder.singleValueContainer(); try box.encode(values)
    }
    func number(_ key: String) -> Double {
        if case .number(let value) = values[key] { return value }
        if case .number(let value) = Self.defaults[key] { return value }
        return 0
    }
    func curve(_ key: String) -> [Double] {
        if case .array(let value) = values[key] { return value }
        if case .array(let value) = Self.defaults[key] { return value }
        return []
    }
    func array(_ key: String) -> [Double] { curve(key) }
    func text(_ key: String) -> String {
        if case .text(let value) = values[key] { return value }
        if case .text(let value) = Self.defaults[key] { return value }
        return ""
    }
    var valid: Bool {
        for (key, reference) in Self.defaults {
            switch (reference, values[key]) {
            case (.number, .number(let value)):
                guard value.isFinite, value >= 0, value <= 600000 else { return false }
            case (.array(let expected), .array(let value)):
                guard value.count == expected.count, value.allSatisfy({ $0.isFinite && $0 >= 0 && $0 <= 600000 }) else { return false }
                if key.hasSuffix("Curve"), !value.allSatisfy({ (0...1).contains($0) }) { return false }
            case (.text, .text(let value)):
                guard ["linear", "nearest"].contains(value) else { return false }
            default: return false
            }
        }
        let positive = ["rig.bakeFps", "rig.bakeTailFps", "rig.bakeMaxMs", "cling.velocitySmoothingMs",
                        "cling.leanMass", "cling.leanStiffness", "cling.leanDamping", "cling.windRefPtPerS", "cling.leanSoftLimitDeg",
                        "cling.squashMass", "cling.squashStiffness", "cling.squashDamping", "cling.holdMinMs", "cling.holdMaxMs",
                        "cling.pixelStepDeg", "squeeze.springMass", "squeeze.springStiffness", "squeeze.springDamping",
                        "duck.openMs", "duck.ledgeMs", "pop.openRiseMs", "pop.ledgeRiseMs", "pop.landMs",
                        "near.speedTauMs", "near.relaxMass", "near.relaxStiffness", "near.relaxDamping",
                        "leave.reduceFadeOutMs", "leave.reduceFadeInMs"]
        guard positive.allSatisfy({ number($0) > 0 }),
              number("rig.bakeFps") <= 120, number("rig.bakeTailFps") <= 120, number("rig.bakeMaxMs") <= 5000,
              number("rig.bakeTailAfterMs") <= number("rig.bakeMaxMs"),
              number("cling.holdMinMs") <= number("cling.holdMaxMs"), number("cling.holdMaxMs") <= 5000,
              number("cling.squashMin") > 0, number("cling.squashMin") <= number("cling.squashMax"), number("cling.squashMax") <= 2,
              (0...1).contains(number("squeeze.min")), number("squeeze.min") > 0,
              number("squeeze.faceOn") <= number("squeeze.faceOff"), number("squeeze.faceOff") <= 1,
              number("duck.openFadeFromMs") < number("duck.openMs"),
              number("near.overInPt") <= number("near.overOutPt"), number("near.nearInPt") <= number("near.nearOutPt"),
              number("near.withSpeedPtPerS") <= number("near.passSpeedPtPerS"),
              ["cling.lineChance", "cling.lineStopFraction", "near.alphaNear", "near.alphaOver"].allSatisfy({ (0...1).contains(number($0)) }) else { return false }
        // Accepted live values must remain finite under the fixed reference RK4 step. This is a
        // numerical safety bound on malformed data, not a replacement for the approved parameters.
        guard 0.002 / (number("cling.velocitySmoothingMs") / 1000) <= 1 else { return false }
        for prefix in ["cling.lean", "cling.squash", "squeeze.spring", "near.relax"] {
            let mass = number(prefix + "Mass"), stiffness = number(prefix + "Stiffness"), damping = number(prefix + "Damping")
            let frequencySquared = stiffness / mass, decay = damping / mass
            guard frequencySquared.isFinite, decay.isFinite, frequencySquared * 0.002 * 0.002 <= 1,
                  decay * 0.002 <= 1 else { return false }
        }
        let face = curve("flip.faceKeepOutFraction")
        return face.count == 4 && face.allSatisfy({ (0...1).contains($0) }) && face[0] <= face[2] && face[1] <= face[3]
    }
    static let standard = CompanionMotionTuning()
    private static let defaults: [String: Value] = [
        "rig.overscanSidePt": .number(16.0),
        "rig.overscanTopPt": .number(16.0),
        "rig.overscanBottomFraction": .number(0.32),
        "rig.filterTransformed": .text("linear"),
        "rig.filterAtRest": .text("nearest"),
        "rig.bakeFps": .number(60.0),
        "rig.bakeTailAfterMs": .number(500.0),
        "rig.bakeTailFps": .number(30.0),
        "rig.bakeMaxMs": .number(1600.0),
        "rig.widthPerHeightSquash": .number(0.3),
        "cling.velocitySmoothingMs": .number(35.0),
        "cling.leanMass": .number(0.5),
        "cling.leanStiffness": .number(110.0),
        "cling.leanDamping": .number(4.2),
        "cling.windMaxDeg": .number(5.0),
        "cling.windRefPtPerS": .number(2200.0),
        "cling.leanSoftLimitDeg": .number(7.0),
        "cling.squashMass": .number(0.5),
        "cling.squashStiffness": .number(260.0),
        "cling.squashDamping": .number(9.0),
        "cling.squashKick": .number(0.0015),
        "cling.squashMin": .number(0.955),
        "cling.squashMax": .number(1.03),
        "cling.holdIntervals": .number(1.5),
        "cling.holdMinMs": .number(12.0),
        "cling.holdMaxMs": .number(50.0),
        "cling.settleLeanDeg": .number(0.03),
        "cling.settleLeanRateDegPerS": .number(0.6),
        "cling.settleScale": .number(0.0006),
        "cling.settleScaleRate": .number(0.012),
        "cling.settleSpeedPtPerS": .number(4.0),
        "cling.faceOnPtPerS": .number(1200.0),
        "cling.faceStopPtPerS": .number(300.0),
        "cling.faceOpenAfterStopMs": .number(220.0),
        "cling.faceMinOnMs": .number(300.0),
        "cling.faceBlinkAfterMs": .number(350.0),
        "cling.faceBlinkMs": .number(130.0),
        "cling.ridesWindowS": .number(30.0),
        "cling.ridesSmileFrom": .number(3.0),
        "cling.lineMinPeakPtPerS": .number(2600.0),
        "cling.lineStopFraction": .number(0.2),
        "cling.lineStopWithinMs": .number(120.0),
        "cling.lineChance": .number(0.5),
        "cling.lineCooldownMin": .number(15.0),
        "cling.lineDelayMs": .number(250.0),
        "cling.lineHoldMs": .number(2600.0),
        "cling.pixelStepDeg": .number(2.5),
        "cling.pixelMaxArtPx": .number(2.0),
        "cling.pixelHysteresisDeg": .number(0.4),
        "cling.ledgeEdgeMarginPt": .number(18.0),
        "cling.ledgeScreenMarginPt": .number(4.0),
        "squeeze.min": .number(0.78),
        "squeeze.volume": .number(0.5),
        "squeeze.faceOn": .number(0.96),
        "squeeze.faceOff": .number(0.99),
        "squeeze.besideGapMinPt": .number(4.0),
        "squeeze.screenMarginPt": .number(2.0),
        "squeeze.menuBarMarginPt": .number(2.0),
        "squeeze.springMass": .number(0.5),
        "squeeze.springStiffness": .number(260.0),
        "squeeze.springDamping": .number(9.0),
        "squeeze.belowSinkFraction": .number(0.25),
        "relocate.minJumpPt": .number(24.0),
        "relocate.skipDuckHiddenFraction": .number(0.9),
        "duck.openMs": .number(110.0),
        "duck.openDepth": .number(0.3),
        "duck.openFadeFromMs": .number(50.0),
        "duck.curve": .array([0.4, 0.0, 1.0, 1.0]),
        "duck.ledgeMs": .number(130.0),
        "duck.ledgeDepth": .number(1.0),
        "pop.openRiseMs": .number(130.0),
        "pop.openDepth": .number(0.3),
        "pop.openStretch": .number(0.03),
        "pop.openFadeMs": .number(70.0),
        "pop.ledgeRiseMs": .number(170.0),
        "pop.ledgeDepth": .number(1.0),
        "pop.ledgeStretch": .number(0.04),
        "pop.riseCurve": .array([0.15, 0.85, 0.35, 1.0]),
        "pop.landMs": .number(40.0),
        "pop.openLandSquash": .number(0.975),
        "pop.ledgeLandSquash": .number(0.97),
        "pop.lineAfterMs": .number(300.0),
        "pop.blinkAfterMs": .number(450.0),
        "hideHour.waveMs": .number(450.0),
        "flip.gapPt": .number(6.0),
        "flip.marginPt": .number(4.0),
        "flip.hysteresisPt": .number(12.0),
        "flip.outMs": .number(70.0),
        "flip.outCurve": .array([0.4, 0.0, 1.0, 1.0]),
        "flip.inMs": .number(120.0),
        "flip.inCurve": .array([0.0, 0.0, 0.2, 1.0]),
        "flip.slidePt": .number(6.0),
        "flip.minWidthPt": .number(140.0),
        "flip.faceKeepOutPx": .array([36, 70, 102, 104]),
        "flip.faceKeepOutFraction": .array([0.263, 0.187, 0.745, 0.453]),
        "near.nearInPt": .number(40.0),
        "near.nearOutPt": .number(52.0),
        "near.overInPt": .number(8.0),
        "near.overOutPt": .number(20.0),
        "near.alphaNear": .number(0.45),
        "near.alphaOver": .number(0.12),
        "near.downMs": .number(90.0),
        "near.downCurve": .array([0.0, 0.0, 0.2, 1.0]),
        "near.upDwellMs": .number(250.0),
        "near.upMs": .number(240.0),
        "near.upCurve": .array([0.37, 0.0, 0.63, 1.0]),
        "near.speedTauMs": .number(30.0),
        "near.withSpeedPtPerS": .number(280.0),
        "near.passSpeedPtPerS": .number(450.0),
        "near.perk": .number(0.018),
        "near.perkMs": .number(160.0),
        "near.perkCurve": .array([0.0, 0.0, 0.2, 1.0]),
        "near.perkGraceMs": .number(120.0),
        "near.relaxMass": .number(0.5),
        "near.relaxStiffness": .number(180.0),
        "near.relaxDamping": .number(13.0),
        "near.glanceSideFraction": .number(0.15),
        "near.rowAfterMs": .number(350.0),
        "near.rowLeaveMs": .number(300.0),
        "leave.captureCalmMs": .number(1000.0),
        "leave.reduceFadeOutMs": .number(100.0),
        "leave.reduceFadeInMs": .number(160.0),
    ]
}

struct CompanionClingSample: Equatable {
    var lean: Double
    var scaleX: Double
    var scaleY: Double
    var velocityX: Double
    var velocityY: Double
    var speed: Double { hypot(velocityX, velocityY) }
    static let rest = Self(lean: 0, scaleX: 1, scaleY: 1, velocityX: 0, velocityY: 0)
}
struct CompanionClingKeyframe { var time: Double; var sample: CompanionClingSample }

/// No clock, observer, timer or layer is owned by the integrator. Each geometry event synchronously
/// advances its six ODE values. Core Animation receives the baked future from that event.
struct CompanionCling {
    var tuning: CompanionMotionTuning { didSet { parameters = Parameters(tuning) } }
    private var parameters: Parameters
    private var state = SIMD8<Double>(0, 0, 0, 0, 1, 0, 0, 0)
    private var anchor: CGPoint?
    private var geometryAt: Double?
    private var remainingHold: Double?
    private var input = SIMD2<Double>.zero
    private var meanInterval = 1.0 / 60
    private(set) var lastEventAt: Double?
    private(set) var peakSpeed = 0.0
    init(tuning: CompanionMotionTuning = .standard) { self.tuning = tuning; parameters = Parameters(tuning) }
    mutating func reset() {
        state = SIMD8<Double>(0, 0, 0, 0, 1, 0, 0, 0); anchor = nil; input = .zero
        lastEventAt = nil; geometryAt = nil; remainingHold = nil; peakSpeed = 0; meanInterval = 1.0 / 60
    }
    mutating func begin(at time: Double, anchor point: CGPoint) {
        guard time.isFinite, point.x.isFinite, point.y.isFinite else { return }
        if let last = lastEventAt {
            // The layer's continuation has ended at identity by this deadline.
            state = time - last >= parameters.cap ? SIMD8<Double>(0, 0, 0, 0, 1, 0, 0, 0)
                : integrate(state, input: .zero, seconds: max(0, time - last))
        }
        lastEventAt = time; geometryAt = time; remainingHold = nil; anchor = point; input = .zero; peakSpeed = 0
    }
    mutating func event(at time: Double, anchor point: CGPoint) {
        guard time.isFinite, point.x.isFinite, point.y.isFinite else { return }
        guard let last = lastEventAt, let previous = anchor else { begin(at: time, anchor: point); return }
        let dt = time - (geometryAt ?? last)
        guard dt >= 0, time >= last else { return }
        let denominator = max(dt, 1.0 / 480)
        let velocity = SIMD2<Double>(Double(point.x - previous.x) / denominator, Double(point.y - previous.y) / denominator)
        guard velocity[0].isFinite, velocity[1].isFinite else { return }
        state = integrate(state, input: velocity, seconds: time - last)
        lastEventAt = time; geometryAt = time; remainingHold = nil; anchor = point; input = velocity
        if dt < 0.1 { meanInterval += 0.2 * (dt - meanInterval) }
        peakSpeed = max(peakSpeed, hypot(state[0], state[1]))
    }
    mutating func release(at time: Double) {
        guard time.isFinite, let last = lastEventAt else { return }
        state = continuedState(seconds: max(0, time - last), released: false)
        lastEventAt = max(last, time); remainingHold = 0; input = .zero
    }
    func shown(at time: Double, released: Bool = false) -> CompanionClingSample {
        guard let last = lastEventAt, time.isFinite else { return .rest }
        return shown(continuedState(seconds: max(0, time - last), released: released))
    }
    /// Advance with the old tuning before assigning replacement parameters. Keep the unconsumed
    /// part of the continuation hold, rather than restarting its prediction at a reload event.
    mutating func rebase(at time: Double, released: Bool = false) {
        guard time.isFinite, let last = lastEventAt, time >= last else { return }
        let elapsed = time - last, hold = holdSeconds
        state = continuedState(seconds: elapsed, released: released)
        remainingHold = released ? 0 : max(0, hold - elapsed)
        lastEventAt = time
        if remainingHold == 0 { input = .zero }
    }
    func bake(at time: Double? = nil, released: Bool = false) -> [CompanionClingKeyframe] {
        if let time {
            var rebased = self
            rebased.rebase(at: time, released: released)
            return rebased.bake(released: released)
        }
        guard lastEventAt != nil else { return [CompanionClingKeyframe(time: 0, sample: .rest)] }
        if settled(state), input == .zero { return [CompanionClingKeyframe(time: 0, sample: .rest)] }
        let hold = released ? 0 : holdSeconds
        var current = state, previous = 0.0
        var frames: [CompanionClingKeyframe] = []
        let times = CompanionPhysics.bakeTimes(tuning: tuning)
        frames.reserveCapacity(times.count)
        for time in times {
            let held = max(0, min(time, hold) - min(previous, hold))
            current = integrate(current, input: input, seconds: held)
            current = integrate(current, input: .zero, seconds: max(0, time - previous - held))
            let rests = time >= hold && settled(current)
            frames.append(CompanionClingKeyframe(time: time, sample: rests || time == times.last ? .rest : shown(current)))
            if rests { break }
            previous = time
        }
        return frames
    }
    private var holdSeconds: Double { remainingHold ?? min(parameters.holdMax, max(parameters.holdMin, parameters.holdIntervals * meanInterval)) }
    private func continuedState(seconds: Double, released: Bool) -> SIMD8<Double> {
        let hold = released ? 0 : min(seconds, holdSeconds)
        let held = integrate(state, input: input, seconds: hold)
        return integrate(held, input: .zero, seconds: seconds - hold)
    }
    private func shown(_ y: SIMD8<Double>) -> CompanionClingSample {
        let p = parameters
        let lean = p.softLimit * tanh(y[2] / p.softLimit)
        let squash = min(p.squashMax, max(p.squashMin, y[4]))
        return CompanionClingSample(lean: lean, scaleX: 1 + p.widthRatio * (1 - squash), scaleY: squash, velocityX: y[0], velocityY: y[1])
    }
    private func settled(_ y: SIMD8<Double>) -> Bool {
        let p = parameters
        return abs(y[2]) < p.settleLean && abs(y[3]) < p.settleLeanRate && abs(y[4] - 1) < p.settleScale
            && abs(y[5]) < p.settleScaleRate && hypot(y[0], y[1]) < p.settleSpeed
    }
    private func derivative(_ y: SIMD8<Double>, input: SIMD2<Double>) -> SIMD8<Double> {
        let p = parameters
        let dvx = (input[0] - y[0]) / p.tau, dvy = (input[1] - y[1]) / p.tau
        let target = -p.windMax * tanh(y[0] / p.windRef)
        let leanAcceleration = p.leanK * (target - y[2]) - p.leanC * y[3]
        let squashAcceleration = p.squashK * (1 - y[4]) - p.squashC * y[5] - p.kick * dvy
        return SIMD8<Double>(dvx, dvy, y[3], leanAcceleration, y[5], squashAcceleration, 0, 0)
    }
    private func integrate(_ initial: SIMD8<Double>, input: SIMD2<Double>, seconds: Double) -> SIMD8<Double> {
        guard seconds > 0 else { return initial }
        // Long absent-event gaps cannot allocate work proportional to wall-clock absence. Ten seconds
        // is already far beyond the approved 1.6-second continuation and numerically at rest.
        let dt = min(seconds, 10), steps = max(1, Int(ceil(dt / 0.002))), h = dt / Double(steps)
        var y = initial
        for _ in 0..<steps {
            let k1 = derivative(y, input: input)
            let k2 = derivative(y + k1 * (h / 2), input: input)
            let k3 = derivative(y + k2 * (h / 2), input: input)
            let k4 = derivative(y + k3 * h, input: input)
            y += (k1 + k2 * 2 + k3 * 2 + k4) * (h / 6)
        }
        return y
    }
    private struct Parameters {
        let tau, leanK, leanC, squashK, squashC, windMax, windRef, softLimit, kick, squashMin, squashMax, widthRatio: Double
        let holdMin, holdMax, holdIntervals, settleLean, settleLeanRate, settleScale, settleScaleRate, settleSpeed, cap: Double
        init(_ t: CompanionMotionTuning) {
            tau = t.number("cling.velocitySmoothingMs") / 1000
            leanK = t.number("cling.leanStiffness") / t.number("cling.leanMass")
            leanC = t.number("cling.leanDamping") / t.number("cling.leanMass")
            squashK = t.number("cling.squashStiffness") / t.number("cling.squashMass")
            squashC = t.number("cling.squashDamping") / t.number("cling.squashMass")
            windMax = t.number("cling.windMaxDeg"); windRef = t.number("cling.windRefPtPerS"); softLimit = t.number("cling.leanSoftLimitDeg")
            kick = t.number("cling.squashKick"); squashMin = t.number("cling.squashMin"); squashMax = t.number("cling.squashMax")
            widthRatio = t.number("rig.widthPerHeightSquash")
            holdMin = t.number("cling.holdMinMs") / 1000; holdMax = t.number("cling.holdMaxMs") / 1000
            holdIntervals = t.number("cling.holdIntervals"); settleLean = t.number("cling.settleLeanDeg")
            settleLeanRate = t.number("cling.settleLeanRateDegPerS"); settleScale = t.number("cling.settleScale")
            settleScaleRate = t.number("cling.settleScaleRate"); settleSpeed = t.number("cling.settleSpeedPtPerS"); cap = t.number("rig.bakeMaxMs") / 1000
        }
    }
}

struct CompanionSqueezeSample: Equatable { var scale: Double; var push: Double; var otherAxis: Double }
struct CompanionSqueezeKeyframe { var time: Double; var sample: CompanionSqueezeSample }
struct CompanionSqueeze {
    var tuning: CompanionMotionTuning
    private(set) var scale = 1.0, velocity = 0.0
    private(set) var lastEventAt: Double?
    init(tuning: CompanionMotionTuning = .standard) { self.tuning = tuning }
    mutating func reset() { scale = 1; velocity = 0; lastEventAt = nil }
    mutating func update(at time: Double, roomOverSize room: Double) -> CompanionSqueezeSample {
        guard time.isFinite, room.isFinite else { return sample(room: 1) }
        if let last = lastEventAt, time > last, scale != 1 || velocity != 0 {
            let spring = CompanionPhysics.squeezeSpring(tuning)
            let advanced = CompanionPhysics.springState(spring: spring, displacement: scale - 1, velocity: velocity, seconds: time - last)
            scale = 1 + advanced.displacement; velocity = advanced.velocity
        }
        lastEventAt = time
        if room < scale { scale = max(room, tuning.number("squeeze.min")); velocity = 0 }
        return sample(room: room)
    }
    func bake(roomOverSize room: Double) -> [CompanionSqueezeKeyframe] {
        guard room.isFinite else { return [] }
        var model = self, frames: [CompanionSqueezeKeyframe] = []
        let times = CompanionPhysics.bakeTimes(tuning: tuning), origin = lastEventAt ?? 0
        for time in times {
            var value = model.update(at: origin + time, roomOverSize: room)
            let settled = abs(model.scale - 1) < tuning.number("cling.settleScale") && abs(model.velocity) < tuning.number("cling.settleScaleRate")
            if settled || time == times.last {
                if room >= 1 { value = CompanionSqueezeSample(scale: 1, push: 0, otherAxis: 1) }
            }
            frames.append(CompanionSqueezeKeyframe(time: time, sample: value))
            let contacted = room < 1 && abs(model.scale - max(room, tuning.number("squeeze.min"))) < tuning.number("cling.settleScale")
                && abs(model.velocity) < tuning.number("cling.settleScaleRate")
            if settled || contacted { break }
        }
        return frames
    }
    private func sample(room: Double) -> CompanionSqueezeSample {
        let floor = tuning.number("squeeze.min"), shown = max(scale, floor)
        return CompanionSqueezeSample(scale: shown, push: max(0, floor - room), otherAxis: 1 + tuning.number("squeeze.volume") * (1 - shown))
    }
}

struct CompanionPlaceSample: Equatable { var dy: Double; var scaleY: Double; var alpha: Double }
enum CompanionPhysics {
    static func bakeTimes(tuning: CompanionMotionTuning) -> [Double] {
        let cap = tuning.number("rig.bakeMaxMs") / 1000, split = tuning.number("rig.bakeTailAfterMs") / 1000
        let fps = tuning.number("rig.bakeFps"), tail = tuning.number("rig.bakeTailFps")
        var times = (0...Int(floor(min(cap, split) * fps))).map { Double($0) / fps }
        if split < cap {
            if times.last != split { times.append(split) }
            let count = Int(floor((cap - split) * tail + 0.000000001))
            if count > 0 { times += (1...count).map { min(cap, split + Double($0) / tail) } }
        }
        if times.last != cap { times.append(cap) }
        return times
    }
    static func bezier(_ curve: [Double], fraction x: Double) -> Double {
        guard curve.count == 4, x.isFinite else { return 0 }
        if x <= 0 { return 0 }; if x >= 1 { return 1 }
        func sample(_ t: Double, _ a: Double, _ b: Double) -> Double {
            3 * a * (1 - t) * (1 - t) * t + 3 * b * (1 - t) * t * t + t * t * t
        }
        var lo = 0.0, hi = 1.0
        for _ in 0..<40 {
            let mid = (lo + hi) / 2
            if sample(mid, curve[0], curve[2]) < x { lo = mid } else { hi = mid }
        }
        return sample((lo + hi) / 2, curve[1], curve[3])
    }
    static func springState(spring: CompanionTuning.Spring, displacement x0: Double, velocity v0: Double, seconds: Double) -> (displacement: Double, velocity: Double) {
        let t = max(0, seconds), w = sqrt(spring.stiffness / spring.mass), z = spring.damping / (2 * sqrt(spring.stiffness * spring.mass))
        if z < 1 {
            let wd = w * sqrt(1 - z * z), e = exp(-z * w * t), b = (v0 + z * w * x0) / wd
            let shape = x0 * cos(wd * t) + b * sin(wd * t)
            return (e * shape, e * (-z * w * shape - x0 * wd * sin(wd * t) + b * wd * cos(wd * t)))
        }
        // Matches the reference's critical response when damping is critical or greater.
        let e = exp(-w * t), b = v0 + w * x0
        return (e * (x0 + b * t), e * (b - w * (x0 + b * t)))
    }
    static func squeezeSpring(_ t: CompanionMotionTuning) -> CompanionTuning.Spring {
        .init(mass: t.number("squeeze.springMass"), stiffness: t.number("squeeze.springStiffness"), damping: t.number("squeeze.springDamping"))
    }
    static func duck(ms: Double, height: Double, ledge: Bool, tuning t: CompanionMotionTuning = .standard, reduceMotion: Bool = false) -> CompanionPlaceSample {
        if reduceMotion {
            return CompanionPlaceSample(dy: 0, scaleY: 1, alpha: 1 - bezier(t.curve("duck.curve"), fraction: ms / t.number("leave.reduceFadeOutMs")))
        }
        let duration = t.number(ledge ? "duck.ledgeMs" : "duck.openMs")
        let dy = -t.number(ledge ? "duck.ledgeDepth" : "duck.openDepth") * height * bezier(t.curve("duck.curve"), fraction: ms / duration)
        let fade = t.number("duck.openFadeFromMs")
        let alpha = ledge ? (ms < duration ? 1.0 : 0.0) : (ms <= fade ? 1 : max(0, 1 - (ms - fade) / (duration - fade)))
        return CompanionPlaceSample(dy: dy, scaleY: 1, alpha: alpha)
    }
    static func pop(ms: Double, height: Double, ledge: Bool, tuning t: CompanionMotionTuning = .standard, reduceMotion: Bool = false) -> CompanionPlaceSample {
        if reduceMotion {
            return CompanionPlaceSample(dy: 0, scaleY: 1, alpha: bezier(t.curve("flip.inCurve"), fraction: ms / t.number("leave.reduceFadeInMs")))
        }
        let rise = t.number(ledge ? "pop.ledgeRiseMs" : "pop.openRiseMs"), fade = t.number("pop.openFadeMs")
        let alpha = ledge || fade == 0 ? 1.0 : min(1, max(0, ms / fade))
        if ms < rise {
            let u = bezier(t.curve("pop.riseCurve"), fraction: ms / rise)
            return CompanionPlaceSample(dy: -t.number(ledge ? "pop.ledgeDepth" : "pop.openDepth") * height * (1 - u), scaleY: 1 + t.number(ledge ? "pop.ledgeStretch" : "pop.openStretch") * (1 - u), alpha: alpha)
        }
        let land = t.number("pop.landMs"), squash = t.number(ledge ? "pop.ledgeLandSquash" : "pop.openLandSquash")
        let elapsed = ms - rise
        if elapsed < land {
            return CompanionPlaceSample(dy: 0, scaleY: 1 - (1 - squash) * bezier(t.curve("flip.inCurve"), fraction: elapsed / land), alpha: alpha)
        }
        let spring = springState(spring: squeezeSpring(t), displacement: squash - 1, velocity: 0, seconds: (elapsed - land) / 1000)
        return CompanionPlaceSample(dy: 0, scaleY: 1 + spring.displacement, alpha: alpha)
    }
    static func popTotalMs(ledge: Bool, tuning: CompanionMotionTuning = .standard) -> Double {
        var last = 0
        for ms in 0..<2000 {
            let value = pop(ms: Double(ms), height: 96, ledge: ledge, tuning: tuning)
            if abs(value.dy) > 0.05 || abs(value.scaleY - 1) > 0.0015 || value.alpha < 0.999 { last = ms }
        }
        return Double(last + 1)
    }
}
