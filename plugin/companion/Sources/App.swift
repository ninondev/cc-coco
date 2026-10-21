// The companion's parts that are not about him or Claude: debug lines, timers, options, his
// settings and the app delegate that wires Feed, Claude and Pet together. main.swift starts it.

import AppKit

/// Debug lines on stderr with --trace; silent otherwise.
struct Trace {
    let on: Bool

    func say(_ line: @autoclosure () -> String) {
        guard on else { return }
        let ms = Int((Date().timeIntervalSince1970 * 1000).truncatingRemainder(dividingBy: 100_000))
        FileHandle.standardError.write(Data("[\(ms)] \(line())\n".utf8))
    }
}

/// A reusable one-shot timer on the main queue: fire(after:) arms it, cancel() parks it. Re-arming
/// allocates nothing (a fresh asyncAfter per change would keep every cancelled block alive until its
/// deadline), and a parked timer never wakes the process.
@MainActor
final class OneShot {
    private let timer = DispatchSource.makeTimerSource(queue: .main)

    init(_ action: @escaping @MainActor () -> Void) {
        timer.setEventHandler {
            MainActor.assumeIsolated { action() }
        }
        timer.schedule(deadline: .distantFuture)
        timer.resume()
    }

    func fire(after seconds: Double) {
        timer.schedule(deadline: .now() + max(0, seconds), leeway: .nanoseconds(0))
    }

    func cancel() {
        timer.schedule(deadline: .distantFuture)
    }
}

struct Options {
    var folder = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/Coco", isDirectory: true)
    var frames: URL?
    var login = false
    var accessibility = true
    var trace = false
    var motion = false
    var offscreen = false
    var fakeWindow: CGRect?
    var testPID: pid_t?

    init(_ arguments: [String]) {
        var rest = arguments.dropFirst()
        while let argument = rest.popFirst() {
            switch argument {
            case "--folder": if let path = rest.popFirst() { folder = URL(fileURLWithPath: path, isDirectory: true) }
            case "--frames": if let path = rest.popFirst() { frames = URL(fileURLWithPath: path, isDirectory: true) }
            case "--no-prompt": break // accepted for compatibility; launch never prompts
            case "--login": login = true
            case "--no-accessibility": accessibility = false
            case "--trace": trace = true
            case "--motion": motion = true // test only: animate even with Reduce Motion on
            case "--offscreen": offscreen = true // test only: place him far off every screen
            case "--fake-window": // test only: x,y,w,h in Cocoa coordinates
                let parts = (rest.popFirst() ?? "").split(separator: ",").compactMap { Double($0) }
                if parts.count == 4 { fakeWindow = CGRect(x: parts[0], y: parts[1], width: parts[2], height: parts[3]) }
            case "--pid": testPID = rest.popFirst().flatMap { Int32($0) } // test only: follow this process's window
            default: break // macOS may pass its own (-psn_...)
            }
        }
    }
}

/// Explicit opens always mean come back. A login keeps his hide unless the book has just called
/// him; after launch, only a summon newer than the one he answered counts. Times are milliseconds.
enum ComeBack {
    enum Event { case reopen, launch(login: Bool), feed }

    static func wanted(_ event: Event, summon: Double, answered: Double, now: Double) -> Bool {
        let newer = summon.isFinite && summon > 0 && summon > answered
        switch event {
        case .reopen: return true
        case let .launch(login): return !login || (newer && (0...15_000).contains(now - summon))
        case .feed: return newer
        }
    }
}

/// companion.json in his folder: his size, where you put him (beside the window, and apart from that
/// while a window fills the screen), how long he hides, and what the install script reads back (the
/// process id and whether Accessibility is allowed). Written atomically.
@MainActor
final class Store {
    static let maxBytes = 65_536
    /// The build's source hash, written into the app by the install script.
    static let build: String = Bundle.main.url(forResource: "build", withExtension: "txt")
        .flatMap { try? String(contentsOf: $0, encoding: .utf8) }?
        .trimmingCharacters(in: .whitespacesAndNewlines) ?? "dev"
    let url: URL
    var size = Size.large
    /// Where you put him; nil: the automatic places.
    var manual: Place.Manual?
    /// Where you left him while a window filled the screen, as fractions of that screen.
    var full: CGPoint?
    var hiddenUntil: TimeInterval = 0
    var askedFor = "" // the build macOS last asked about Accessibility for
    var trusted = false
    var running = false
    var answered: Double = 0
    var offered = ""
    var sizeAt: Double = 0
    var loginAt: Double = 0
    var followAt: Double = 0
    var login = false
    /// Screenshots, recordings and shared screens show him unless this is off (owner 10-20).
    var capture = true
    var captureAt: Double = 0
    var linesHidden = false
    var seenAt: Double = 0
    var longTaskAuthorization = "notDetermined"

    init(url: URL) {
        self.url = url
        guard let directory = try? SecureDirectory(url.deletingLastPathComponent()),
              let data = try? directory.read(url.lastPathComponent, maxBytes: Self.maxBytes),
              let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return }
        if let value = object["size"] as? String, let size = Size(name: value) { self.size = size }
        if let x = object["freeX"] as? Double, let y = object["freeY"] as? Double, (0...1).contains(x), (0...1).contains(y) {
            full = CGPoint(x: x, y: y)
        }
        if let place = object["manual"] as? [String: Any] {
            if place["anchor"] as? String == "window", let raw = place["corner"] as? String, let corner = Place.Corner(rawValue: raw),
               let dx = place["dx"] as? Double, let dy = place["dy"] as? Double, abs(dx) < 4000, abs(dy) < 4000 {
                manual = .window(corner: corner, dx: dx, dy: dy)
            } else if place["anchor"] as? String == "screen", let x = place["x"] as? Double, let y = place["y"] as? Double,
                      (0...1).contains(x), (0...1).contains(y) {
                manual = .screen(x: x, y: y)
            }
        }
        hiddenUntil = object["hiddenUntil"] as? Double ?? 0
        askedFor = object["askedFor"] as? String ?? ""
        answered = object["answered"] as? Double ?? 0
        offered = object["offered"] as? String ?? ""
        sizeAt = object["sizeAt"] as? Double ?? 0
        loginAt = object["loginAt"] as? Double ?? 0
        followAt = object["followAt"] as? Double ?? 0
        login = object["login"] as? Bool ?? false
        capture = object["capture"] as? Bool ?? true
        captureAt = object["captureAt"] as? Double ?? 0
        linesHidden = object["linesHidden"] as? Bool ?? false
        seenAt = object["seenAt"] as? Double ?? 0
        if let authorization = object["longTaskAuthorization"] as? String, ["authorized", "denied", "notDetermined"].contains(authorization) { longTaskAuthorization = authorization }
    }

    /// The launch's final persistence step, after saved options and feed requests are restored.
    func started() {
        running = true
        save()
    }

    func save() {
        var object: [String: Any] = [
            "pid": Int(getpid()),
            "targets": ["claude", "vscode"],
            "version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev",
            "accessibility": trusted,
            "size": size.rawValue,
            "hiddenUntil": hiddenUntil,
            "askedFor": askedFor,
            "build": Store.build,
            "running": running, "answered": answered, "offered": offered,
            "sizeAt": sizeAt, "loginAt": loginAt, "followAt": followAt, "login": login, "capture": capture, "captureAt": captureAt,
            "linesHidden": linesHidden, "seenAt": seenAt, "longTaskAuthorization": longTaskAuthorization,
        ]
        if let full {
            object["freeX"] = Double(full.x)
            object["freeY"] = Double(full.y)
        }
        switch manual {
        case let .window(corner, dx, dy)?:
            object["manual"] = ["anchor": "window", "corner": corner.rawValue, "dx": Double(dx), "dy": Double(dy)]
        case let .screen(x, y)?:
            object["manual"] = ["anchor": "screen", "x": Double(x), "y": Double(y)]
        case nil:
            break
        }
        guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys]) else { return }
        guard let directory = try? SecureDirectory(url.deletingLastPathComponent()),
              (try? directory.replace(url.lastPathComponent, with: data)) != nil else { return }
        // Broadcast only safe settings metadata to live mod channels. Opening an existing file
        // cannot recreate an uninstalled folder, and O_APPEND keeps the complete line together.
        let keys = ["running", "accessibility", "hiddenUntil", "answered", "size", "sizeAt", "loginAt", "followAt", "login", "capture", "captureAt", "version", "longTaskAuthorization"]
        let info = object.filter { keys.contains($0.key) }
        let event: [String: Any] = ["v": 1, "kind": "companion-state", "at": Date().timeIntervalSince1970 * 1000, "info": info]
        guard var line = try? JSONSerialization.data(withJSONObject: event, options: [.sortedKeys]), line.count < 2048 else { return }
        line.append(10)
        guard let descriptor = try? directory.openFile("requests.jsonl") else { return }
        close(descriptor)
        _ = try? directory.append("requests.jsonl", data: line, maxBytes: RequestChannel.maxBytes)
    }
}

@MainActor
final class Companion: NSObject, NSApplicationDelegate {
    private let options: Options
    private var store: Store!
    private var feed: Feed!
    private var claude: Claude!
    private var pet: Pet!
    private var channel: RequestChannel?
    private var tuning: TuningStore?
    private var frames: Frames?
    private var neighbours: Neighbours?
    private var health: HealthWriter?
    private lazy var requestExpiry = OneShot { [weak self] in self?.expireRequests() }
    private var activity: Activity?
    private var terminate: DispatchSourceSignal?
    private var answeredSummon: Double = 0
    private var answeredFollow: Double = 0
    private var answeredSettings: Double = 0
    private var ownsInstance = false
    private let home = FileManager.default.homeDirectoryForCurrentUser
    private var executable: String { Bundle.main.executablePath ?? CommandLine.arguments[0] }

    init(options: Options) {
        self.options = options
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        if let id = Bundle.main.bundleIdentifier,
           NSRunningApplication.runningApplications(withBundleIdentifier: id).contains(where: { $0 != .current }) {
            NSApp.terminate(nil) // one is enough
            return
        }
        ownsInstance = true
        signal(SIGTERM, SIG_IGN)
        let source = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
        source.setEventHandler { NSApp.terminate(nil) }
        source.resume()
        terminate = source

        let trace = Trace(on: options.trace)
        Pet.ignoreReduceMotion = options.motion
        Pet.offscreen = options.offscreen
        Claude.testFrame = options.fakeWindow
        Claude.testPID = options.testPID
        _ = try? SecureDirectory(options.folder, create: true)
        do { channel = try RequestChannel(folder: options.folder) }
        catch { trace.say("requests: cannot prepare the channel: \(error.localizedDescription)") }
        scheduleRequestExpiry()
        _ = Store.build // preload the one optional resource read before any native drawing
        store = Store(url: options.folder.appendingPathComponent("companion.json"))
        store.running = true
        answeredSummon = store.answered
        answeredFollow = store.followAt
        try? LoginAgent.repair(home: home, executable: executable)
        store.login = FileManager.default.fileExists(atPath: LoginAgent.url(home: home).path)
        Capture.shown = store.capture
        let frameFolder = options.frames ?? Bundle.main.resourceURL?.appendingPathComponent("frames", isDirectory: true)
            ?? options.folder.appendingPathComponent("frames", isDirectory: true)
        let pixelFolder = frameFolder.deletingLastPathComponent().appendingPathComponent("pixel", isDirectory: true)
        let assetRoot = frameFolder.deletingLastPathComponent()
        let loadedFrames = Frames(folder: frameFolder,pixelFolder: pixelFolder)
        frames = loadedFrames
        tuning = TuningStore(assetRoot.appendingPathComponent("companion-tuning.json"))
        neighbours = Neighbours(configURL: assetRoot.appendingPathComponent("neighbours.json"),outputURL: options.folder.appendingPathComponent("neighbours.json"),home: home)
        health = HealthWriter(folder: options.folder)
        neighbours?.statusChanged = { [weak self] in self?.writeHealth() }
        pet = Pet(frames: loadedFrames,store: store,trace: trace)
        pet.pointerMonitorMeasured = { [weak self] period in self?.health?.recordPointerMonitor(period) }
        pet.configure(tuning!.value)
        loadedFrames.changed = { [weak self] in self?.pet.assetsChanged(); self?.writeHealth() }
        tuning?.changed = { [weak self] value in self?.pet.configure(value); self?.claude.configure(value.window); self?.activity?.configure(value, reduceMotion: self?.pet.motionReduced); self?.writeHealth() }
        loadedFrames.statusChanged = { [weak self] in self?.writeHealth() }
        tuning?.statusChanged = { [weak self] in self?.writeHealth() }
        loadedFrames.start(); tuning?.start()
        feed = Feed(file: options.folder.appendingPathComponent("view.json"), trace: trace)
        neighbours?.changed = { [weak self] snapshot, enabled in
            guard let self else { return }
            var value = snapshot.presenceValue(running:enabled)
            if enabled, let birth = PresenceProcessIdentity.birth(getpid()) { value["owner"] = ["pid":Int(getpid()),"birth":birth] }
            self.feed.neighbours(value)
            self.pet.neighbours(snapshot, enabled: enabled)
        }
        feed.seenAt = store.seenAt
        feed.setClaudeFrontmost(NSWorkspace.shared.frontmostApplication?.bundleIdentifier == Claude.bundleID)
        claude = Claude(trace: trace, allowAX: options.accessibility)
        claude.configure(tuning!.value.window)

        d1Notifications.changed = { [weak self] in
            guard let self else { return }
            self.store.longTaskAuthorization = self.d1Notifications.authorization
            self.store.save()
            self.writeHealth()
        }
        d1Notifications.start()
        feed.changed = { [unowned self] record in
            pet.show(record); neighbours?.setEnabled(record.neighbours); syncDock(record); writeHealth()
        }
        feed.woke = { [unowned self] presence in pet.woke(presence) }
        feed.targetChanged = { [unowned self] app in claude.setTarget(app); pet.targetBundleID = claude.targetBundleID; frontmostMoved(); writeHealth() }
        pet.touched = { [unowned self] kind, at in feed.touch(kind,lang: feed.shown.lang,at: at) }
        claude.changed = { [unowned self] reorder in
            store.trusted = claude.trusted
            pet.targetBundleID = claude.targetBundleID
            pet.follow(claude.sighting, reorder: reorder)
            writeHealth()
        }
        pet.placementChanged = { [weak self] target, relocating in
            guard let self else { return }
            self.followActivity(target, relocating: relocating)
        }
        pet.requestFollow = { [unowned self] in follow(at: Date().timeIntervalSince1970 * 1000) }
        pet.openSettings = { [unowned self] in claude.openAccessibilitySettings() }
        pet.requestActivity = { [unowned self] in openActivity() }
        pet.setLogin = { [unowned self] on in
            do {
                try LoginAgent.set(on, home: home, executable: executable)
                store.loginAt = Date().timeIntervalSince1970 * 1000
                store.login = FileManager.default.fileExists(atPath: LoginAgent.url(home: home).path)
                store.save()
            } catch { Trace(on: options.trace).say("companion: login item \(error.localizedDescription)") }
        }
        pet.requestDm = { [unowned self] in openActivity(dm: true) }
        d1Notifications.openDm = { [weak self] in self?.openActivity(dm: true) }
        feed.activityChanged = { [unowned self] in
            refreshUnread()
            activity?.update(rows: feed.rows, sessions: feed.liveSessions)
        }
        feed.received = { [unowned self] record in
            d1Notifications.receive(record, now: Date().timeIntervalSince1970 * 1000)
            // Her DM's notification comes from the shown session's thread, as the badge's count does.
            d1Notifications.receiveDm(feed.shown, now: Date().timeIntervalSince1970 * 1000, threadVisible: activity?.dmVisible == true)
            refreshUnread()
            activity?.receive(record)
            activity?.targetBundleID = claude.targetBundleID
            if let ack = record.ack {
                do { try channel?.acknowledge(ack) }
                catch { trace.say("requests: cannot remove acknowledged text: \(error.localizedDescription)") }
            }
            scheduleRequestExpiry()
        }
        for name in [NSWorkspace.didActivateApplicationNotification, NSWorkspace.didDeactivateApplicationNotification] {
            NSWorkspace.shared.notificationCenter.addObserver(self, selector: #selector(frontmostMoved), name: name, object: nil)
        }
        // The lid: he naps when the system sleeps and wakes a moment after it (or after the unlock).
        NSWorkspace.shared.notificationCenter.addObserver(self, selector: #selector(systemWillSleep), name: NSWorkspace.willSleepNotification, object: nil)
        NSWorkspace.shared.notificationCenter.addObserver(self, selector: #selector(systemDidWake), name: NSWorkspace.didWakeNotification, object: nil)
        DistributedNotificationCenter.default().addObserver(self, selector: #selector(screenWasLocked), name: NSNotification.Name("com.apple.screenIsLocked"), object: nil)
        DistributedNotificationCenter.default().addObserver(self, selector: #selector(screenWasUnlocked), name: NSNotification.Name("com.apple.screenIsUnlocked"), object: nil)
        claude.windowGesture = { [unowned self] phase, _, at in
            switch phase {
            case .began: pet.windowGestureBegan(at: at)
            case .changed: pet.windowGeometryChanged(at: at)
            case .ended: pet.windowGestureEnded(at: at)
            case .cancelled: pet.windowGestureEnded(at: at,cancelled: true)
            }
        }
        claude.quit = { [unowned self] in feed.forget() }
        claude.trustMoved = { [unowned self] in
            store.trusted = claude.trusted
            pet.trustChanged()
            store.save()
        }

        feed.start()
        pet.show(feed.shown)
        comeBack(.launch(login: options.login), summon: feed.latestSummon)
        feed.summoned = { [unowned self] summon in comeBack(.feed, summon: summon) }
        claude.start(askForAccessibility: false)
        store.trusted = claude.trusted
        pet.trustReady = true
        pet.trustChanged()
        apply(feed.latestRequests, launch: true)
        feed.requested = { [unowned self] requests in apply(requests, launch: false) }
        store.started(); writeHealth()
        trace.say("companion: accessibility \(claude.trusted ? "allowed: following the window" : "not allowed: corner while Claude is in front")")
    }

    // His own Dock tile (S21 on the switches page, off by default): on, the app sits in the Dock with their face
    // (the app icon), the unseen count in its corner, and the quota on a right click; a click on it brings her back
    // (applicationShouldHandleReopen). Off, the app stays an accessory with no Dock tile, as it has always been.
    private var dockQuota: [String]?
    private func syncDock(_ record: Record) {
        dockQuota = record.dock
        let policy: NSApplication.ActivationPolicy = record.dock == nil ? .accessory : .regular
        if NSApp.activationPolicy() != policy { NSApp.setActivationPolicy(policy) }
        dockBadge()
    }
    private func dockBadge() {
        let count = feed.unseenCount + (feed.shown.dm?.unread ?? 0)
        NSApp.dockTile.badgeLabel = dockQuota != nil && count > 0 ? String(count) : nil
    }
    /// The badge by her hair and the Dock count Claude's replies not seen and her DMs not read (DmThread.swift); with
    /// hers among them the badge opens the thread.
    private func refreshUnread() {
        let dm = feed.shown.dm?.unread ?? 0
        pet.setUnseen(feed.unseenCount + dm, opensDm: dm > 0)
        dockBadge()
    }
    func applicationDockMenu(_ sender: NSApplication) -> NSMenu? {
        guard let lines = dockQuota, !lines.isEmpty else { return nil }
        let menu = NSMenu()
        for line in lines {
            let item = NSMenuItem(title: line, action: nil, keyEquivalent: "")
            item.isEnabled = false
            menu.addItem(item)
        }
        return menu
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if pet != nil { comeBack(.reopen, summon: feed.latestSummon) }
        return false
    }

    func applicationWillTerminate(_ notification: Notification) {
        requestExpiry.cancel()
        pet?.stop(); frames?.stop(); tuning?.stop(); neighbours?.stop()
        claude?.stop()
        feed?.stop()
        guard ownsInstance, let store else { return }
        store.running = false
        store.save()
    }

    private var screenIsLocked = false
    @objc private func systemWillSleep() { pet?.systemSlept() }
    @objc private func systemDidWake() { pet?.systemWoke(locked: screenIsLocked) }
    @objc private func screenWasLocked() { screenIsLocked = true; noteAway("locked") }
    @objc private func screenWasUnlocked() { screenIsLocked = false; noteAway(nil); pet?.screenUnlocked() }
    // Only a change is written, stamped when it happened (companion-rs state.rs does the same on Windows).
    private var away: CompanionAway?
    private func noteAway(_ state: String?) {
        if let away, away.state == state { return }
        away = CompanionAway(state: state, since: (Date().timeIntervalSince1970 * 1000).rounded())
        writeHealth()
    }

    @objc private func frontmostMoved() {
        feed?.setClaudeFrontmost(NSWorkspace.shared.frontmostApplication?.bundleIdentifier == claude?.targetBundleID)
    }

    private let d1Notifications = D1Notifications()

    private func writeHealth() {
        guard let claude else { return }
        let error = frames?.lastError ?? tuning?.lastError ?? claude.lastError ?? neighbours?.lastError
        health?.update(CompanionHealth(version: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev",
                                      protocolGeneration: "native-v2",accessibility: claude.trusted,targetFound: claude.found,
                                      target: claude.targetBundleID,lastError: error,longTaskAuthorization: d1Notifications.authorization,
                                      away: away))
    }

    /// The Activity window, or with `dm` her DM thread in it (an open window turns to the thread).
    private func openActivity(dm: Bool = false) {
        if let activity { if dm { activity.showDm(true) }; return }
        guard let target = pet.activityTarget else { return }
        let rows = feed.rows, sessions = feed.liveSessions, shown = feed.shown
        let chosen = sessions.first(where: { $0.session == shown.session }) ?? sessions.first ?? .resting
        let made = Activity(rows: rows, sessions: sessions, chosen: chosen, target: target, channel: channel)
        made.targetBundleID = claude.targetBundleID
        made.configure(tuning!.value, reduceMotion: pet.motionReduced)
        if case let .window(_, _, fullScreen, _, _, _) = claude.sighting { made.follow(target, fullScreen: fullScreen) }
        guard made.hasPlacement else { return }
        made.closed = { [weak self] in
            guard let self else { return }
            self.activity = nil
            self.pet.setActivityPresented(false)
        }
        made.requestChanged = { [weak self] in self?.scheduleRequestExpiry() }
        made.rowSelected = { [weak self] session in
            guard let self else { return }
            let time = Date().timeIntervalSince1970 * 1000
            if let record = self.feed.markSeen(session: session, at: time), record.reply != nil || record.notice != nil {
                _ = try? self.channel?.append(session: session, kind: .seen, upto: time, at: time)
                self.scheduleRequestExpiry()
            }
        }
        activity = made
        pet.setActivityPresented(true)
        let time = Date().timeIntervalSince1970 * 1000
        for record in feed.openActivity(at: time) {
            _ = try? channel?.append(session: record.session, kind: .seen, upto: time, at: time)
        }
        scheduleRequestExpiry()
        store.seenAt = feed.seenAt; store.save()
        if dm { made.openDm() } else { made.open() }
    }

    private func followActivity(_ target: Place.Target?, relocating: Bool) {
        guard let activity else { return }
        activity.targetBundleID = claude.targetBundleID
        if target == nil, relocating { activity.suspendPresentation(); return }
        let fullScreen: Bool
        if case let .window(_, _, full, _, _, _) = claude.sighting { fullScreen = full } else { fullScreen = false }
        activity.follow(target, fullScreen: fullScreen)
    }

    private func scheduleRequestExpiry() {
        guard let next = channel?.nextExpiry else { requestExpiry.cancel(); return }
        requestExpiry.fire(after: max(0.001, (next - Date().timeIntervalSince1970 * 1000) / 1000))
    }

    private func expireRequests() {
        do {
            try channel?.cleanup(now: Date().timeIntervalSince1970 * 1000)
            scheduleRequestExpiry()
        } catch {
            Trace(on: options.trace).say("requests: cannot remove expired text: \(error.localizedDescription)")
            // A failed filesystem operation is retried by the next feed/request event,
            // rather than waking an idle process every second.
            requestExpiry.cancel()
        }
    }

    private func follow(at: Double) {
        guard !claude.trusted else { return }
        answeredFollow = max(answeredFollow, at)
        store.followAt = max(store.followAt, at)
        pet.showFollowCard(waiting: true, asked: true)
        store.save()
        claude.requestFollow()
    }

    private func apply(_ requests: Requests, launch: Bool) {
        let now = Date().timeIntervalSince1970 * 1000
        if let size = requests.size, Requests.wants(size.at, after: store.sizeAt, launch: false, now: now) {
            pet.setSize(size.to, at: size.at)
        }
        if let login = requests.login, Requests.wants(login.at, after: store.loginAt, launch: false, now: now) {
            do {
                try LoginAgent.set(login.on, home: home, executable: executable)
                store.loginAt = login.at
                store.login = FileManager.default.fileExists(atPath: LoginAgent.url(home: home).path)
                store.save()
            } catch { Trace(on: options.trace).say("companion: login item \(error.localizedDescription)") }
        }
        if let capture = requests.capture, Requests.wants(capture.at, after: store.captureAt, launch: false, now: now) {
            store.capture = capture.on
            store.captureAt = capture.at
            store.save()
            Capture.shown = capture.on
        }
        if Requests.wants(requests.follow, after: answeredFollow, launch: launch, now: now) {
            answeredFollow = requests.follow
            follow(at: requests.follow)
        }
        if Requests.wants(requests.settings, after: answeredSettings, launch: launch, now: now) {
            answeredSettings = requests.settings
            claude.openAccessibilitySettings()
        }
        if launch {
            answeredFollow = max(answeredFollow, requests.follow)
            answeredSettings = max(answeredSettings, requests.settings)
        }
    }

    private func comeBack(_ event: ComeBack.Event, summon: Double) {
        let now = Date().timeIntervalSince1970 * 1000
        guard ComeBack.wanted(event, summon: summon, answered: answeredSummon, now: now) else { return }
        answeredSummon = max(answeredSummon, summon, now)
        store.answered = answeredSummon
        pet.comeBack()
    }
}
