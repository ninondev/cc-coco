import Foundation
import Darwin

struct CompanionPointerTuning: Codable, Equatable {
    enum Form: String, Codable { case reduced, full }
    var near: Form = .reduced
    var meter = false
    init() {}
    private enum CodingKeys: String, CodingKey { case near, meter }
    init(from decoder: Decoder) throws {
        let box = try decoder.container(keyedBy: CodingKeys.self)
        near = try box.decodeIfPresent(Form.self, forKey: .near) ?? .reduced
        meter = try box.decodeIfPresent(Bool.self, forKey: .meter) ?? false
    }
}

struct CompanionPointerPeriod: Codable, Equatable {
    var form: CompanionPointerTuning.Form
    var armedSeconds: Double
    var events: Int
    var handlerCpuMs: Double
    var processCpuMs: Double
}

/// Only armed, enabled periods sample CPU. No clocks, timers or file writes per event when off.
struct CompanionPointerMeter {
    struct Clocks {
        var wall: () -> Double = { ProcessInfo.processInfo.systemUptime }
        var threadCPU: () -> Double = {
            var value = timespec()
            guard clock_gettime(CLOCK_THREAD_CPUTIME_ID, &value) == 0 else { return .nan }
            return Double(value.tv_sec) + Double(value.tv_nsec) / 1_000_000_000
        }
        var processCPU: () -> Double = {
            var value = rusage()
            guard getrusage(RUSAGE_SELF, &value) == 0 else { return .nan }
            return Double(value.ru_utime.tv_sec + value.ru_stime.tv_sec)
                + Double(value.ru_utime.tv_usec + value.ru_stime.tv_usec) / 1_000_000
        }
    }
    private struct Active {
        var form: CompanionPointerTuning.Form
        var began: Double
        var processCPU: Double
        var events = 0
        var handlerCPU = 0.0
    }
    var clocks = Clocks()
    private var active: Active?
    var isArmed: Bool { active != nil }
    mutating func arm(form: CompanionPointerTuning.Form, enabled: Bool) {
        guard enabled, active == nil else { return }
        let wall = clocks.wall(), cpu = clocks.processCPU()
        guard wall.isFinite, cpu.isFinite else { return }
        active = Active(form: form, began: wall, processCPU: cpu)
    }
    func beginEvent() -> Double? {
        guard active != nil else { return nil }
        return clocks.threadCPU()
    }
    mutating func endEvent(_ began: Double?) {
        guard let began, active != nil else { return }
        let ended = clocks.threadCPU()
        active?.events += 1
        // An unavailable CPU clock invalidates the period instead of reporting a false zero.
        active?.handlerCPU += began.isFinite && ended.isFinite ? max(0, ended - began) : .nan
    }
    mutating func disarm() -> CompanionPointerPeriod? {
        guard let period = active else { return nil }
        active = nil
        let wall = clocks.wall(), cpu = clocks.processCPU()
        guard wall.isFinite, cpu.isFinite, period.handlerCPU.isFinite else { return nil }
        return CompanionPointerPeriod(form: period.form, armedSeconds: max(0, wall - period.began),
                                      events: period.events, handlerCpuMs: period.handlerCPU * 1000,
                                      processCpuMs: max(0, cpu - period.processCPU) * 1000)
    }
}
