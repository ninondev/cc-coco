import Foundation

var checks = 0, failures = 0
func check(_ value: Bool, _ name: String) {
    checks += 1
    if !value { failures += 1; print("FAIL: \(name)") }
}
let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let now = 1_000.0
check(RequestKind(rawValue: "clear") == nil, "clear kind is rejected")
check(RequestKind(rawValue: "submit") == .submit && RequestKind(rawValue: "seen") == .seen,
      "submit and seen remain available")
let legacy = root.appendingPathComponent("legacy", isDirectory: true)
try FileManager.default.createDirectory(at: legacy, withIntermediateDirectories: true)
let file = legacy.appendingPathComponent("requests.jsonl")
var original = try JSONSerialization.data(withJSONObject: ["v": 1, "id": "0123456789abcdef", "session": "synthetic", "at": now, "kind": "clear"], options: [.sortedKeys])
original.append(0x0a)
try original.write(to: file)
let inode = try FileManager.default.attributesOfItem(atPath: file.path)[.systemFileNumber] as! NSNumber
let channel = try RequestChannel(folder: legacy, now: now)
let scrubbed = try Data(contentsOf: file)
check(scrubbed.count == original.count && scrubbed.allSatisfy { $0 == 0x20 || $0 == 0x0a },
      "legacy clear bytes are scrubbed without shifting offsets")
// The scrub is published as a new atomic generation, as an ack is (RequestChannel.redactExisting; companion-native M1).
check(try FileManager.default.attributesOfItem(atPath: file.path)[.systemFileNumber] as? NSNumber != inode,
      "legacy cleanup publishes a new generation")
check(channel.nextExpiry == nil, "legacy clear is not outstanding")
check(try channel.outstandingRequest(session: "synthetic", kind: .submit, text: nil, now: now) == nil,
      "legacy clear cannot become a retriable submit")
let submit = try channel.append(session: "synthetic", kind: .submit, text: "  synthetic note  ", at: now)
check(submit.text == "synthetic note" && submit.kind == .submit, "explicit submit is preserved")
let retry = try channel.retry(submit, now: now + 1)
check(retry.id == submit.id && retry.at == submit.at, "retry retains identity and time")
check(try channel.acknowledge(submit.id), "submit acknowledgement succeeds")
let seen = try channel.append(session: "synthetic", kind: .seen, upto: now, at: now + 2)
check(seen.kind == .seen && seen.upto == now, "seen is preserved")
check(try channel.acknowledge(seen.id) && channel.nextExpiry == nil, "seen acknowledgement clears outstanding identity")
let final = try Data(contentsOf: file)
check(final.allSatisfy { $0 == 0x20 || $0 == 0x0a }, "acknowledged notes leave only padding")
print("native-clear-protocol: \(checks) checks; \(failures) failures")
exit(failures == 0 ? 0 : 1)
