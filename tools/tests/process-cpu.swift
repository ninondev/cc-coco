// Development fixtures only. CPU budgets exclude time spent waiting for another process.
import Darwin
import Foundation
func p1CpuSeconds() -> Double {
    var usage = rusage(); getrusage(RUSAGE_SELF, &usage)
    return Double(usage.ru_utime.tv_sec + usage.ru_stime.tv_sec) + Double(usage.ru_utime.tv_usec + usage.ru_stime.tv_usec) / 1_000_000
}
func p1CpuNanoseconds() -> UInt64 { UInt64(p1CpuSeconds() * 1_000_000_000) }
func p1ScheduleCpuBudget(_ seconds: Double, work: DispatchWorkItem) {
    let end = p1CpuSeconds() + seconds
    func check() {
        guard !work.isCancelled else { return }
        if p1CpuSeconds() >= end { work.perform() }
        else { DispatchQueue.main.asyncAfter(deadline: .now() + 0.01) { check() } }
    }
    check()
}
