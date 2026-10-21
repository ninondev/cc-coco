import AppKit
import ApplicationServices

/// Input events, never a polling clock. The cheap down bootstrap lives only while AX is attached;
/// the drag/up monitor and WindowServer reads live only between a target press and its release.
@MainActor
final class WindowDragEvents {
    enum Phase: Equatable { case began, changed, ended, cancelled }
    struct Effects {
        var add: (NSEvent.EventTypeMask, @escaping (NSEvent) -> Void) -> Any?
        var remove: (Any) -> Void
        var begin: (CGPoint) -> (CGWindowID, CGRect)?
        var frame: (CGWindowID) -> CGRect?
        var changed: (CGRect) -> Void
        var gesture: (Phase, CGRect, TimeInterval) -> Void = { _, _, _ in }
    }

    private let effects: Effects
    private var downMonitor: Any?
    private var dragMonitor: Any?
    private var selected: (number: CGWindowID, frame: CGRect)?
    private var generation: UInt64 = 0
    private var bootstrapGeneration: UInt64 = 0
    var unchangedDragLimit = 1
    private var unchangedDrags = 0
    private var gestureBegan = false
    private var pressAt: TimeInterval = 0
    private(set) var geometryReads = 0
    private(set) var lastInputAt: TimeInterval?
    private(set) var lastInputWasDrag = false
    var tracking: Bool { dragMonitor != nil && selected != nil }

    init(effects: Effects) { self.effects = effects }

    func start() {
        guard downMonitor == nil else { return }
        bootstrapGeneration &+= 1
        let listening = bootstrapGeneration
        downMonitor = effects.add(.leftMouseDown) { [weak self] event in
            MainActor.assumeIsolated {
                guard let self, self.bootstrapGeneration == listening else { return }
                self.pressed(event)
            }
        }
    }

    func stop() {
        bootstrapGeneration &+= 1
        cancelDrag()
        if let downMonitor { effects.remove(downMonitor) }
        downMonitor = nil
    }

    func cancelDrag(at: TimeInterval? = nil, cancelled: Bool = true) {
        let terminal = gestureBegan ? selected?.frame : nil
        generation &+= 1
        selected = nil
        unchangedDrags = 0
        gestureBegan = false
        if let dragMonitor { effects.remove(dragMonitor) }
        dragMonitor = nil
        if let terminal { effects.gesture(cancelled ? .cancelled : .ended,terminal,at ?? ProcessInfo.processInfo.systemUptime) }
    }

    private func pressed(_ event: NSEvent) {
        guard downMonitor != nil else { return }
        cancelDrag() // a missed mouse-up cannot leave the old gesture armed
        guard let cg = event.cgEvent, let (number, frame) = effects.begin(cg.location),
              number != 0, Self.valid(frame) else { return }
        selected = (number, frame)
        pressAt = event.timestamp
        lastInputAt = event.timestamp
        lastInputWasDrag = false
        let armed = generation
        dragMonitor = effects.add([.leftMouseDragged, .leftMouseUp]) { [weak self] event in
            MainActor.assumeIsolated {
                guard let self, self.generation == armed else { return }
                self.lastInputAt = event.timestamp
                self.lastInputWasDrag = event.type == .leftMouseDragged
                self.refresh(disarmUnchanged: event.type == .leftMouseDragged,at: event.timestamp)
                if event.type == .leftMouseUp { self.cancelDrag(at: event.timestamp,cancelled: false) }
            }
        }
        if dragMonitor == nil { selected = nil }
    }

    func refresh(disarmUnchanged: Bool = false, at: TimeInterval? = nil) {
        guard tracking, let selected else { return }
        let timestamp = at ?? ProcessInfo.processInfo.systemUptime
        guard timestamp.isFinite, timestamp >= 0 else { cancelDrag(); return }
        geometryReads += 1
        guard let frame = effects.frame(selected.number), Self.valid(frame) else {
            cancelDrag() // window closed, moved Space, or permissions were revoked
            return
        }
        guard frame != selected.frame else {
            if disarmUnchanged {
                unchangedDrags += 1
                if unchangedDragLimit > 0, unchangedDrags >= unchangedDragLimit { cancelDrag() }
            }
            return
        }
        unchangedDrags = 0
        if !gestureBegan {
            gestureBegan = true
            effects.gesture(.began,selected.frame,pressAt)
        }
        self.selected = (selected.number, frame)
        effects.changed(frame)
        // The rigid base and current sighting are committed before this event drives the rig.
        effects.gesture(.changed,frame,timestamp)
    }

    static func valid(_ frame: CGRect) -> Bool {
        frame.origin.x.isFinite && frame.origin.y.isFinite && frame.width.isFinite
            && frame.height.isFinite && frame.width > 0 && frame.height > 0
    }
}

// Where the Claude desktop app's window is, learned from events only.
//
// NSWorkspace reports the app launching, quitting, hiding, coming to the front and Space changes;
// no permission is needed for those. With Accessibility allowed, an AXObserver on the app reports
// its window moving, resizing, minimizing, closing and the main window changing. Nothing is
// polled. A mouse-down listener arms a drag listener only for a press on the selected window;
// actual WindowServer bounds then follow each drag event even if AX reports only the final move.
// Only geometry and window state are read (position, size, minimized, full screen,
// subrole): never a title, never the page inside. Window bounds without titles come from
// CGWindowList, which needs no Screen Recording permission.
//
// Without Accessibility the window cannot be followed, so he waits in the lower right corner of
// the screen, only while Claude is the frontmost app and only where its window does not reach.

@MainActor
final class Claude {
    static let bundleID = "com.anthropic.claudefordesktop"
    private var tuning = WindowTuning()
    private(set) var target = CompanionTarget.claude
    var targetName: String { target == .claude ? "Claude" : "VS Code" }
    var targetBundleID: String { running?.bundleIdentifier ?? tuning.targets[target.rawValue]?.first ?? Self.bundleID }
    var found: Bool { running != nil && running?.isTerminated == false }
    func configure(_ tuning: WindowTuning) {
        let bundles = self.tuning.targets[target.rawValue]
        self.tuning = tuning
        pointerFollow.unchangedDragLimit = max(1, tuning.unchangedDragEvents)
        pointerFollow.cancelDrag()
        if bundles != tuning.targets[target.rawValue] { attach(find()) }
    }
    func setTarget(_ name: String) {
        guard let next = CompanionTarget(rawValue: name), next != target else { return }
        target = next
        attach(find()) // detach cancels the old observer, window and drag gesture before re-registering
    }

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
    private(set) var lastError: String?
    /// The sighting changed, or Claude came to the front (`reorder`: put him back next to its window).
    var changed: (_ reorder: Bool) -> Void = { _ in }
    /// Geometry and actual input timestamps for one live move/resize gesture, in Cocoa points.
    var windowGesture: (WindowDragEvents.Phase, CGRect, TimeInterval) -> Void = { _, _, _ in }
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
    private(set) var fullScreen = false
    private var exitWatch: DispatchSourceProcess? // the app's exit, by kqueue: no polling
    private lazy var pointerFollow = WindowDragEvents(effects: .init(
        add: { mask, handler in NSEvent.addGlobalMonitorForEvents(matching: mask, handler: handler) },
        remove: { NSEvent.removeMonitor($0) },
        begin: { [weak self] point in self?.windowAtPress(point) },
        frame: { Self.windowBounds($0) },
        changed: { [weak self] frame in self?.look(full: false, reorder: false, liveFrame: frame) },
        gesture: { [weak self] phase, frame, at in self?.windowGesture(phase,Self.cocoa(frame),at) }
    ))
    /// Only the live screen check reads this count; no diagnostics or timers are needed.
    var dragGeometryReads: Int { pointerFollow.geometryReads }
    var dragMonitorActive: Bool { pointerFollow.tracking }
    var dragInputAt: TimeInterval? { pointerFollow.lastInputAt }
    var dragInputIsMovement: Bool { pointerFollow.lastInputWasDrag }

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
        attach(find())
    }

    func stop() {
        detach()
        NSWorkspace.shared.notificationCenter.removeObserver(self)
        NotificationCenter.default.removeObserver(self)
        DistributedNotificationCenter.default().removeObserver(self)
    }

    // ------------------------------------------------------------ the app

    private func attach(_ app: NSRunningApplication?) {
        detach()
        guard let app, !app.isTerminated else {
            look(full: true, reorder: true)
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
        fullScreen = false
        pointerFollow.stop()
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
        running = nil
    }

    @objc private func workspaceEvent(_ note: Notification) {
        let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
        switch note.name {
        case NSWorkspace.activeSpaceDidChangeNotification:
            pointerFollow.cancelDrag()
            windowNumber = nil
            look(full: true, reorder: true)
        case NSWorkspace.didLaunchApplicationNotification:
            if isTarget(app), running == nil || running?.isTerminated == true { attach(app) }
        case NSWorkspace.didTerminateApplicationNotification:
            guard let app, app.processIdentifier == running?.processIdentifier else { return }
            detach()
            look(full: true, reorder: false)
            quit()
        default: // activate, deactivate, hide, unhide
            // macOS does not always announce a permission switched on in System Settings: look again
            // whenever an app comes to the front while it is missing (you come back from Settings).
            if !trusted, allowAX, note.name == NSWorkspace.didActivateApplicationNotification { recheckTrust() }
            guard let app, isTarget(app) else { return }
            if running == nil || running?.processIdentifier != app.processIdentifier { attach(app); return }
            if note.name == NSWorkspace.didActivateApplicationNotification || note.name == NSWorkspace.didUnhideApplicationNotification {
                if !pointerFollow.tracking { windowNumber = nil }
            }
            if note.name == NSWorkspace.didHideApplicationNotification { pointerFollow.cancelDrag() }
            trace.say("claude: \(note.name.rawValue.replacingOccurrences(of: "NSWorkspace", with: ""))")
            look(full: true, reorder: true)
        }
    }

    @objc private func screensMoved() {
        pointerFollow.cancelDrag()
        windowNumber = nil
        look(full: true, reorder: true)
    }

    @objc private func permissionsMoved() { recheckTrust() }

    private func recheckTrust() {
        let now = allowAX && Self.isTrusted(prompt: false)
        guard now != trusted else { return }
        trusted = now
        trace.say("claude: accessibility \(now ? "allowed" : "not allowed")")
        attach(running ?? find())
        trustMoved()
    }

    private func find() -> NSRunningApplication? {
        if let pid = Self.testPID { return NSRunningApplication(processIdentifier: pid) }
        let apps = (tuning.targets[target.rawValue] ?? []).flatMap {
            NSRunningApplication.runningApplications(withBundleIdentifier: $0)
        }
        return apps.first(where: { $0.isActive }) ?? apps.first
    }

    private func isTarget(_ app: NSRunningApplication?) -> Bool {
        guard let app else { return false }
        if let pid = Self.testPID { return app.processIdentifier == pid }
        return tuning.targets[target.rawValue]?.contains(app.bundleIdentifier ?? "") == true
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
            lastError = "accessibility-observer-unavailable"
            trace.say("claude: no AX observer")
            return
        }
        lastError = nil
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
        pointerFollow.start()
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
            // Fullscreen changes arrive as geometry/Space events; re-read the public state
            // on resize rather than keeping the previous cached fullscreen value.
            if pointerFollow.tracking { pointerFollow.refresh() }
            else { look(full: name == kAXResizedNotification, reorder: false) }
        case kAXUIElementDestroyedNotification:
            guard let window, CFEqual(element, window) else { return }
            pointerFollow.cancelDrag()
            unwatch(window)
            self.window = nil
            pickWindow()
        case kAXWindowMiniaturizedNotification, kAXWindowDeminiaturizedNotification:
            pointerFollow.cancelDrag()
            windowNumber = nil
            look(full: true, reorder: true)
        case kAXApplicationHiddenNotification, kAXApplicationShownNotification:
            pointerFollow.cancelDrag()
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
        if target == .vscode, let focused = element(appElement, kAXFocusedWindowAttribute), isRegular(focused) {
            chosen = focused
        } else if let main = element(appElement, kAXMainWindowAttribute), isRegular(main) {
            chosen = main
        } else if let windows = elements(appElement, kAXWindowsAttribute) {
            chosen = windows.filter { isRegular($0) && !isMinimized($0) }.max { area($0) < area($1) }
        }
        if chosen == nil, let window, frame(of: window) != nil {
            chosen = window // keep the last one while the app reports none
        }
        let same = (chosen == nil && window == nil) || (chosen != nil && window != nil && CFEqual(chosen!, window!))
        if !same {
            pointerFollow.cancelDrag()
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
    private func look(full: Bool, reorder: Bool, liveFrame: CGRect? = nil) {
        let next = sight(full: full, liveFrame: liveFrame)
        guard next != sighting || reorder else { return }
        sighting = next
        changed(reorder)
    }

    private func sight(full: Bool, liveFrame: CGRect?) -> Sighting {
        guard let app = running, !app.isTerminated, !app.isHidden else { return .none }
        guard trusted else {
            // No Accessibility: a screen corner while Claude is in front, behind its front window.
            guard app.isActive, let front = Self.windows(of: app.processIdentifier).first,
                  let screen = Self.screen(containing: front.bounds) ?? NSScreen.main ?? NSScreen.screens.first else { return .none }
            return .corner(visible: screen.visibleFrame, screen: screen.frame, front: front.number, window: Self.cocoa(front.bounds))
        }
        guard let window else { return .none }
        if liveFrame == nil {
            // Input-driven moves already have live geometry and cached window state. Calling
            // into the other app's AX server here could block behind its window-drag loop.
            guard let axFrame = frame(of: window), !isMinimized(window) else { return .none }
            if full || windowNumber == nil {
                if !pointerFollow.tracking {
                    windowNumber = Self.windows(of: app.processIdentifier).first { $0.bounds.isClose(to: axFrame) }?.number
                }
                fullScreen = bool(window, "AXFullScreen") ?? false
            }
        }
        guard let number = windowNumber else { return .none } // minimized, or on another Space
        // AX can cache its position until mouse-up. WindowServer is authoritative for geometry;
        // a drag callback already has that frame, so it never pays for a second bounds read.
        guard let topLeft = liveFrame ?? Self.windowBounds(number) else { return .none }
        let frame = Self.cocoa(topLeft)
        guard let screen = Self.screen(containing: topLeft) ?? NSScreen.screens.first else { return .none }
        return .window(frame: frame, number: number, fullScreen: fullScreen, visible: screen.visibleFrame, screen: screen.frame, active: app.isActive)
    }

    // ------------------------------------------------------------ helpers

    private func windowAtPress(_ point: CGPoint) -> (CGWindowID, CGRect)? {
        guard trusted, let app = running, !app.isTerminated, !app.isHidden,
              case let .window(frame, number, isFull, _, _, _) = sighting, !isFull,
              frame.contains(Self.cocoa(CGRect(origin: point, size: .zero)).origin),
              let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
                as? [[String: Any]] else { return nil }
        // The first window under the press must be this exact selected window, even when another
        // app or one of the target's small panels overlaps it. Only a movable title band or
        // non-content role can arm; the first unchanged drag then removes the monitor.
        for info in list {
            guard let dict = info[kCGWindowBounds as String] as? NSDictionary,
                  let frame = CGRect(dictionaryRepresentation: dict), frame.contains(point) else { continue }
            guard info[kCGWindowNumber as String] as? CGWindowID == number,
                  info[kCGWindowOwnerPID as String] as? pid_t == app.processIdentifier else { return nil }
            let titleHeight = tuning.titleBarHeight[app.bundleIdentifier ?? ""] ?? 0
            // One AX hit test, and one role attribute only: never a title, value or contents.
            // Title-band decisions need no AX lookup at all.
            let inTitle = point.y <= frame.minY + titleHeight
            let edge = max(0,tuning.resizeBorder)
            let inBorder = point.x < frame.minX + edge || point.x > frame.maxX - edge
                || point.y < frame.minY + edge || point.y > frame.maxY - edge
            var roles: [String] = []
            if !inTitle && !inBorder {
                var hit: AXUIElement?
                if AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(), Float(point.x), Float(point.y), &hit) == .success,
                   let hit, let role = string(hit, kAXRoleAttribute) { roles = [role] }
            }
            guard DragArming.allows(point: point, frame: frame, roles: roles, titleHeight: titleHeight, tuning: tuning) else { return nil }
            return (number, frame)
        }
        return nil
    }

    static func windowBounds(_ number: CGWindowID) -> CGRect? {
        guard let list = CGWindowListCopyWindowInfo([.optionIncludingWindow, .excludeDesktopElements], number)
                as? [[String: Any]],
              let info = list.first(where: { $0[kCGWindowNumber as String] as? CGWindowID == number }),
              let dict = info[kCGWindowBounds as String] as? NSDictionary,
              let frame = CGRect(dictionaryRepresentation: dict), WindowDragEvents.valid(frame) else { return nil }
        return frame
    }

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
            self.busy = false
            self.openSettings()
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
