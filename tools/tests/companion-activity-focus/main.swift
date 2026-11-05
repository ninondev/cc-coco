import AppKit
import Darwin

final class FocusProbeApplication: NSApplication {
    var activationRequests = 0
    override func activate(ignoringOtherApps flag: Bool) { activationRequests += 1 }
}

var checks = 0
var failures = 0
func expect(_ value: Bool, _ label: String) {
    checks += 1
    if !value { failures += 1; print("FAIL: \(label)") }
}

MainActor.assumeIsolated {
    let app = FocusProbeApplication.shared as! FocusProbeApplication
    app.setActivationPolicy(.accessory)
    Pet.offscreen = true
    var record = Record.resting
    record.session = "close-regression"
    record.project = "fixture"
    record.channel = false
    let screen = CGRect(x: 0, y: 0, width: 1440, height: 900)
    let target = Place.Target(mode: .manual, frame: CGRect(x: 700, y: 300, width: 103, height: 96),
                              number: 0, window: CGRect(x: 300, y: 200, width: 800, height: 600),
                              visible: screen, screen: screen)
    let activity = Activity(rows: [], sessions: [record], chosen: record, target: target, channel: nil)
    activity.configure(.standard, reduceMotion: true)
    var closed = 0
    activity.closed = { closed += 1 }
    activity.open()
    expect(app.activationRequests == 0, "opening Activity must keep the host app active without Accessibility")
    expect(activity.panel.styleMask.contains(.nonactivatingPanel), "a mouse press must not activate Coco and hide its host-bound presentation")
    expect(activity.panel.canBecomeKey, "Activity still accepts keyboard input")
    expect(activity.presentationRequested && activity.hasPlacement, "opening still presents the Activity")
    activity.closed = {}
    activity.close(restorePrevious: false)

    let mouseActivity = Activity(rows: [], sessions: [record], chosen: record, target: target,
                                 channel: nil, allowsWindowPresentation: false)
    mouseActivity.configure(.standard, reduceMotion: true)
    mouseActivity.closed = { closed += 1 }
    mouseActivity.open()
    let button = mouseActivity.view.close
    button.performClick(nil)
    expect(closed == 1 && !mouseActivity.panel.isVisible, "AppKit button activation closes the Activity once")
    mouseActivity.follow(nil)
    mouseActivity.follow(target)
    expect(closed == 1 && !mouseActivity.presentationRequested && !mouseActivity.panel.isVisible,
           "returning to the host must not reopen a mouse-closed Activity")

    record.channel = true
    let input = Activity(rows: [], sessions: [record], chosen: record, target: target, channel: nil)
    input.configure(.standard, reduceMotion: true)
    input.open()
    expect(input.panel.firstResponder is NSTextView, "the native field editor receives keyboard focus")
    input.view.field.stringValue = "unsent draft"
    input.follow(nil)
    input.follow(target)
    expect(input.view.field.stringValue == "unsent draft", "a genuine host disappearance still preserves the draft")
    input.panel.cancelOperation(nil)
    expect(!input.presentationRequested && !input.panel.isVisible, "Escape dismisses the nonactivating Activity")
}
print("activity close: \(checks) checks, \(failures) failures")
exit(failures == 0 ? 0 : 1)
