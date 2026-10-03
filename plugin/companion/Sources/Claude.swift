import AppKit
import ApplicationServices

// Where the Claude desktop app's window is, learned from events only.
//
// NSWorkspace reports the app launching, quitting, hiding, coming to the front and Space changes;
// no permission is needed for those. With Accessibility allowed, an AXObserver on the app reports
// its window moving, resizing, minimizing, closing and the main window changing. Nothing is
// polled. Only geometry and window state are read (position, size, minimized, full screen,
// subrole): never a title, never the page inside. Window bounds without titles come from
// CGWindowList, which needs no Screen Recording permission.
//
// Without Accessibility the window cannot be followed, so he waits in the lower right corner of
// the screen, only while Claude is the frontmost app and only where its window does not reach.

@MainActor
final class Claude {
    static let bundleID = "com.anthropic.claudefordesktop"

    enum Sighting: Equatable {
        case none
        /// Cocoa coordinates. `visible` and `screen` are the visible and whole frames of the screen
        /// under the window's top edge; `active`: Claude is the frontmost app.
        case window(frame: CGRect, number: CGWindowID, fullScreen: Bool, visible: CGRect, screen: CGRect, active: Bool)
        /// No Accessibility: a screen corner while Claude is in front. `front` is Claude's front window
        /// and `window` its bounds when he last looked; he only shows where it does not reach.
        case corner(visible: CGRect, screen: CGRect, front: CGWindowID, window: CGRect)
    }

    private(set) var sighting = Sighting.none
    private(set) var trusted = false
    /// The sighting changed, or Claude came to the front (`reorder`: put him back next to its window).
    var changed: (_ reorder: Bool) -> Void = { _ in }
    /// Claude's window moved by this much (points, Cocoa), for his sway while you drag it.
    var dragged: (_ dx: CGFloat, _ dy: CGFloat) -> Void = { _, _ in }
    /// Claude quit.
    var quit: () -> Void = {}
    /// Accessibility was allowed or taken away while running.
    var trustMoved: () -> Void = {}

    private let trace: Trace
    private let allowAX: Bool
    private lazy var permission = FollowPermission(effects: .init(
        trusted: { [weak self] in self?.allowAX != true || Self.isTrusted(prompt: false) },
        run: FollowPermission.runReset,
        prompt: { _ = Self.isTrusted(prompt: true) },
        later: { seconds, action in DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { action() } },
        open: { NSWorkspace.shared.open($0) }
    ))

    func requestFollow() { permission.request(at: Date().timeIntervalSince1970 * 1000) }
    func openAccessibilitySettings() { permission.openSettings() }
    /// Test switch (--pid): follow this process's window instead of Claude's.
    static var testPID: pid_t?
    /// Test switch (--fake-window x,y,w,h, Cocoa): pretend Claude's window is here and never moves.
    static var testFrame: CGRect?
    private var running: NSRunningApplication?
    private var appElement: AXUIElement?
    private var observer: AXObserver?
    private var window: AXUIElement?
    private var windowNumber: CGWindowID?
    private var fullScreen = false
    private var lastFrame: CGRect?
    private var trustChecks = 0
    private lazy var settle: OneShot = OneShot { [unowned self] in look(full: false, reorder: true) }
    private lazy var trustCheck: OneShot = OneShot { [unowned self] in
        recheckTrust()
        trustChecks -= 1
        if trustChecks > 0 { trustCheck.fire(after: 1.2) } // TCC can take a moment longer
    }
    private var exitWatch: DispatchSourceProcess? // the app's exit, by kqueue: no polling

    init(trace: Trace, allowAX: Bool) {
        self.trace = trace
        self.allowAX = allowAX
    }

    func start(askForAccessibility: Bool) {
        if let fake = Self.testFrame, let screen = NSScreen.screens.first {
            sighting = .window(frame: fake, number: 0, fullScreen: false, visible: screen.visibleFrame, screen: screen.frame, active: true)
            changed(true)
            return
        }
        let center = NSWorkspace.shared.notificationCenter
        for name in [
            NSWorkspace.didLaunchApplicationNotification, NSWorkspace.didTerminateApplicationNotification,
            NSWorkspace.didActivateApplicationNotification, NSWorkspace.didDeactivateApplicationNotification,
            NSWorkspace.didHideApplicationNotification, NSWorkspace.didUnhideApplicationNotification,
            NSWorkspace.activeSpaceDidChangeNotification,
        ] {
            center.addObserver(self, selector: #selector(workspaceEvent(_:)), name: name, object: nil)
        }
        NotificationCenter.default.addObserver(
            self, selector: #selector(screensMoved), name: NSApplication.didChangeScreenParametersNotification, object: nil
        )
        // Posted when any app's Accessibility permission changes.
        DistributedNotificationCenter.default().addObserver(
            self, selector: #selector(permissionsMoved), name: NSNotification.Name("com.apple.accessibility.api"), object: nil
        )
        trusted = allowAX && Self.isTrusted(prompt: askForAccessibility)
        attach(Self.find())
    }

    // ------------------------------------------------------------ the app

    private func attach(_ app: NSRunningApplication?) {
        detach()
        guard let app, !app.isTerminated else {
            look(full: true, reorder: false)
            return
        }
        running = app
        let pid = app.processIdentifier
        let watch = DispatchSource.makeProcessSource(identifier: pid, eventMask: .exit, queue: .main)
        watch.setEventHandler { [weak self] in
            MainActor.assumeIsolated {
                guard let self, self.running?.processIdentifier == pid else { return }
                self.trace.say("claude: process \(pid) exited")
                self.detach()
                self.look(full: true, reorder: false)
                self.quit()
            }
        }
        watch.resume()
        exitWatch = watch
        if trusted { observe(app) }
        look(full: true, reorder: true)
    }

    private func detach() {
        exitWatch?.cancel()
        exitWatch = nil
        unwatch(window)
        if let observer {
            CFRunLoopRemoveSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .commonModes)
        }
        observer = nil
        appElement = nil
        window = nil
        windowNumber = nil
        lastFrame = nil
        running = nil
    }

    @objc private func workspaceEvent(_ note: Notification) {
        let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
        switch note.name {
        case NSWorkspace.activeSpaceDidChangeNotification:
            windowNumber = nil
            look(full: true, reorder: true)
        case NSWorkspace.didLaunchApplicationNotification:
            if Self.isClaude(app), running == nil || running?.isTerminated == true { attach(app) }
        case NSWorkspace.didTerminateApplicationNotification:
            guard let app, app.processIdentifier == running?.processIdentifier else { return }
            detach()
            look(full: true, reorder: false)
            quit()
        default: // activate, deactivate, hide, unhide
            // macOS does not always announce a permission switched on in System Settings: look again
            // whenever an app comes to the front while it is missing (you come back from Settings).
            if !trusted, allowAX, note.name == NSWorkspace.didActivateApplicationNotification { recheckTrust() }
            guard let app, Self.isClaude(app) else { return }
            if running == nil || running?.processIdentifier != app.processIdentifier { attach(app); return }
            if note.name == NSWorkspace.didActivateApplicationNotification || note.name == NSWorkspace.didUnhideApplicationNotification {
                windowNumber = nil
            }
            trace.say("claude: \(note.name.rawValue.replacingOccurrences(of: "NSWorkspace", with: ""))")
            look(full: true, reorder: true)
            // Claude raises its window a moment after it says it is active: put him back next to it
            // once more when that has happened.
            settle.fire(after: 0.25)
        }
    }

    @objc private func screensMoved() {
        windowNumber = nil
        look(full: true, reorder: true)
    }

    // TCC records the change a moment after this notice: look a beat later, and once more after that.
    @objc private func permissionsMoved() {
        trustChecks = 2
        trustCheck.fire(after: 0.3)
    }

    private func recheckTrust() {
        let now = allowAX && Self.isTrusted(prompt: false)
        guard now != trusted else { return }
        trusted = now
        trace.say("claude: accessibility \(now ? "allowed" : "not allowed")")
        attach(running ?? Self.find())
        trustMoved()
    }

    private static func find() -> NSRunningApplication? {
        if let pid = testPID { return NSRunningApplication(processIdentifier: pid) }
        return NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).first
    }

    private static func isClaude(_ app: NSRunningApplication?) -> Bool {
        guard let app else { return false }
        if let pid = testPID { return app.processIdentifier == pid }
        return app.bundleIdentifier == bundleID
    }

    static func isTrusted(prompt: Bool) -> Bool {
        let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        return AXIsProcessTrustedWithOptions([key: prompt] as CFDictionary)
    }

    // ------------------------------------------------------------ the window, by Accessibility

    private func observe(_ app: NSRunningApplication) {
        let element = AXUIElementCreateApplication(app.processIdentifier)
        AXUIElementSetMessagingTimeout(element, 1.0)
        var made: AXObserver?
        guard AXObserverCreate(app.processIdentifier, Self.callback, &made) == .success, let observer = made else {
            trace.say("claude: no AX observer")
            return
        }
        let me = Unmanaged.passUnretained(self).toOpaque()
        for name in [
            kAXMainWindowChangedNotification, kAXFocusedWindowChangedNotification, kAXWindowCreatedNotification,
            kAXApplicationHiddenNotification, kAXApplicationShownNotification,
        ] {
            AXObserverAddNotification(observer, element, name as CFString, me)
        }
        CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .commonModes)
        self.observer = observer
        appElement = element
        pickWindow()
    }

    private static let callback: AXObserverCallback = { _, element, notification, refcon in
        guard let refcon else { return }
        let claude = Unmanaged<Claude>.fromOpaque(refcon).takeUnretainedValue()
        MainActor.assumeIsolated { claude.axEvent(notification as String, element) }
    }

    private func axEvent(_ name: String, _ element: AXUIElement) {
        switch name {
        case kAXMovedNotification, kAXResizedNotification:
            guard let window, CFEqual(element, window) else { return }
            look(full: false, reorder: false)
        case kAXUIElementDestroyedNotification:
            guard let window, CFEqual(element, window) else { return }
            unwatch(window)
            self.window = nil
            pickWindow()
        case kAXWindowMiniaturizedNotification, kAXWindowDeminiaturizedNotification:
            windowNumber = nil
            look(full: true, reorder: true)
        case kAXApplicationHiddenNotification, kAXApplicationShownNotification:
            look(full: true, reorder: true)
        default: // main or focused window changed, a window was created
            pickWindow()
        }
    }

    // The window he sits on: the main window when it is a regular window of a real size, otherwise
    // the largest regular window that is not minimized. A small panel (the quick entry box) never
    // takes him.
    private func pickWindow() {
        guard let appElement else { return }
        var chosen: AXUIElement?
        if let main = element(appElement, kAXMainWindowAttribute), isRegular(main) {
            chosen = main
        } else if let windows = elements(appElement, kAXWindowsAttribute) {
            chosen = windows.filter { isRegular($0) && !isMinimized($0) }.max { area($0) < area($1) }
        }
        if chosen == nil, let window, frame(of: window) != nil {
            chosen = window // keep the last one while the app reports none
        }
        let same = (chosen == nil && window == nil) || (chosen != nil && window != nil && CFEqual(chosen!, window!))
        if !same {
            unwatch(window)
            window = chosen
            windowNumber = nil
            watch(chosen)
        }
        look(full: true, reorder: true)
    }

    private func watch(_ element: AXUIElement?) {
        guard let element, let observer else { return }
        let me = Unmanaged.passUnretained(self).toOpaque()
        for name in [
            kAXMovedNotification, kAXResizedNotification, kAXWindowMiniaturizedNotification,
            kAXWindowDeminiaturizedNotification, kAXUIElementDestroyedNotification,
        ] {
            AXObserverAddNotification(observer, element, name as CFString, me)
        }
    }

    private func unwatch(_ element: AXUIElement?) {
        guard let element, let observer else { return }
        for name in [
            kAXMovedNotification, kAXResizedNotification, kAXWindowMiniaturizedNotification,
            kAXWindowDeminiaturizedNotification, kAXUIElementDestroyedNotification,
        ] {
            AXObserverRemoveNotification(observer, element, name as CFString)
        }
    }

    // ------------------------------------------------------------ where it is now

    /// `full`: also re-read the window's number, Space and full screen state (after anything but a
    /// plain move or resize, which only changes its frame).
    private func look(full: Bool, reorder: Bool) {
        let next = sight(full: full)
        if case let .window(frame, _, _, _, _, _) = next, let before = lastFrame, !full {
            let dx = frame.midX - before.midX
            let dy = frame.maxY - before.maxY
            if frame.size == before.size, dx != 0 || dy != 0 { dragged(dx, dy) }
        }
        if case let .window(frame, _, _, _, _, _) = next { lastFrame = frame } else { lastFrame = nil }
        guard next != sighting || reorder else { return }
        sighting = next
        changed(reorder)
    }

    private func sight(full: Bool) -> Sighting {
        guard let app = running, !app.isTerminated, !app.isHidden else { return .none }
        guard trusted else {
            // No Accessibility: a screen corner while Claude is in front, behind its front window.
            guard app.isActive, let front = Self.windows(of: app.processIdentifier).first,
                  let screen = Self.screen(containing: front.bounds) ?? NSScreen.main ?? NSScreen.screens.first else { return .none }
            return .corner(visible: screen.visibleFrame, screen: screen.frame, front: front.number, window: Self.cocoa(front.bounds))
        }
        guard let window, let topLeft = frame(of: window), !isMinimized(window) else { return .none }
        if full || windowNumber == nil {
            windowNumber = Self.windows(of: app.processIdentifier).first { $0.bounds.isClose(to: topLeft) }?.number
            fullScreen = bool(window, "AXFullScreen") ?? false
        }
        guard let number = windowNumber else { return .none } // minimized, or on another Space
        let frame = Self.cocoa(topLeft)
        guard let screen = Self.screen(containing: topLeft) ?? NSScreen.screens.first else { return .none }
        return .window(frame: frame, number: number, fullScreen: fullScreen, visible: screen.visibleFrame, screen: screen.frame, active: app.isActive)
    }

    // ------------------------------------------------------------ helpers

    /// Claude's on-screen windows in the current Space, front to back: number and bounds (top-left
    /// coordinates). Bounds only, which CGWindowList gives without Screen Recording.
    private static func windows(of pid: pid_t) -> [(number: CGWindowID, bounds: CGRect)] {
        guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
            as? [[String: Any]] else { return [] }
        return list.compactMap { info in
            guard info[kCGWindowOwnerPID as String] as? pid_t == pid,
                  info[kCGWindowLayer as String] as? Int == 0,
                  let number = info[kCGWindowNumber as String] as? CGWindowID,
                  let dict = info[kCGWindowBounds as String] as? NSDictionary,
                  let bounds = CGRect(dictionaryRepresentation: dict),
                  bounds.width >= 200, bounds.height >= 150 else { return nil }
            return (number, bounds)
        }
    }

    /// Top-left global coordinates (Accessibility, CGWindowList) to Cocoa's bottom-left ones.
    static func cocoa(_ rect: CGRect) -> CGRect {
        let top = NSScreen.screens.first?.frame.maxY ?? 0
        return CGRect(x: rect.minX, y: top - rect.maxY, width: rect.width, height: rect.height)
    }

    /// The screen under a window's top edge, given top-left coordinates.
    private static func screen(containing rect: CGRect) -> NSScreen? {
        let edge = cocoa(rect)
        let point = CGPoint(x: edge.midX, y: edge.maxY - 1)
        return NSScreen.screens.first { $0.frame.contains(point) }
            ?? NSScreen.screens.max { $0.frame.intersection(edge).area < $1.frame.intersection(edge).area }
    }

    private func frame(of element: AXUIElement) -> CGRect? {
        var position: CFTypeRef?
        var size: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &position) == .success,
              AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &size) == .success,
              let position, let size,
              CFGetTypeID(position) == AXValueGetTypeID(), CFGetTypeID(size) == AXValueGetTypeID() else { return nil }
        var origin = CGPoint.zero
        var extent = CGSize.zero
        guard AXValueGetValue(position as! AXValue, .cgPoint, &origin),
              AXValueGetValue(size as! AXValue, .cgSize, &extent) else { return nil }
        return CGRect(origin: origin, size: extent)
    }

    private func area(_ element: AXUIElement) -> CGFloat {
        frame(of: element)?.area ?? 0
    }

    private func isRegular(_ element: AXUIElement) -> Bool {
        guard string(element, kAXSubroleAttribute) == (kAXStandardWindowSubrole as String),
              let frame = frame(of: element) else { return false }
        return frame.width >= 400 && frame.height >= 300
    }

    private func isMinimized(_ element: AXUIElement) -> Bool {
        bool(element, kAXMinimizedAttribute) ?? false
    }

    private func element(_ element: AXUIElement, _ attribute: String) -> AXUIElement? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success, let value,
              CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
        return (value as! AXUIElement)
    }

    private func elements(_ element: AXUIElement, _ attribute: String) -> [AXUIElement]? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else { return nil }
        return value as? [AXUIElement]
    }

    private func string(_ element: AXUIElement, _ attribute: String) -> String? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else { return nil }
        return value as? String
    }

    private func bool(_ element: AXUIElement, _ attribute: String) -> Bool? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else { return nil }
        return (value as? NSNumber)?.boolValue
    }
}

extension CGRect {
    var area: CGFloat { isNull ? 0 : width * height }

    func isClose(to other: CGRect) -> Bool {
        abs(minX - other.minX) < 2 && abs(minY - other.minY) < 2 && abs(width - other.width) < 2 && abs(height - other.height) < 2
    }
}

/// The only path that prompts. Effects are injected so checks never touch the owner's grant.
@MainActor
final class FollowPermission {
    static let settingsURL = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!
    static let appURL = URL(fileURLWithPath: "/System/Applications/System Settings.app")
    struct Effects {
        var trusted: () -> Bool
        var run: (_ executable: String, _ arguments: [String], _ timeout: Double, _ done: @escaping () -> Void) -> Void
        var prompt: () -> Void
        var later: (_ seconds: Double, _ action: @escaping () -> Void) -> Void
        var open: (URL) -> Bool
    }
    private let effects: Effects
    private(set) var lastReset: Double?
    private var busy = false

    init(effects: Effects) { self.effects = effects }

    func request(at now: Double) {
        guard !effects.trusted(), !busy else { return }
        if let lastReset, now - lastReset < 600_000 {
            openSettings()
            return
        }
        lastReset = now
        busy = true
        effects.run("/usr/bin/tccutil", ["reset", "Accessibility", LoginAgent.label], 5) { [weak self] in
            guard let self else { return }
            // Trust may have arrived while the reset process was finishing.
            if !self.effects.trusted() { self.effects.prompt() }
            self.effects.later(0.4) { [weak self] in
                guard let self else { return }
                self.busy = false
                self.openSettings()
            }
        }
    }

    func openSettings() {
        if !effects.open(Self.settingsURL) { _ = effects.open(Self.appURL) }
    }

    /// Runs only our short-lived reset child, never a shell and never the companion process.
    static func runReset(_ executable: String, _ arguments: [String], _ timeout: Double, _ done: @escaping () -> Void) {
        DispatchQueue.global(qos: .userInitiated).async {
            let child = Process()
            child.executableURL = URL(fileURLWithPath: executable)
            child.arguments = arguments
            child.standardOutput = FileHandle.nullDevice
            child.standardError = FileHandle.nullDevice
            let ended = DispatchSemaphore(value: 0)
            child.terminationHandler = { _ in ended.signal() }
            if (try? child.run()) != nil, ended.wait(timeout: .now() + timeout) == .timedOut, child.isRunning {
                // A late reset must never erase the entry after the prompt has re-added it.
                // SIGKILL targets only this child, then reap before returning to the main queue.
                Darwin.kill(child.processIdentifier, SIGKILL)
                child.waitUntilExit()
            }
            DispatchQueue.main.async { done() }
        }
    }
}
