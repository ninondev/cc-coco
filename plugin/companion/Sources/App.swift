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
        .appendingPathComponent("Library/Application Support/Claude-sama", isDirectory: true)
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
    /// The build's source hash, written into the app by the install script.
    static let build: String = Bundle.main.url(forResource: "build", withExtension: "txt")
        .flatMap { try? String(contentsOf: $0, encoding: .utf8) }?
        .trimmingCharacters(in: .whitespacesAndNewlines) ?? "dev"
    let url: URL
    var size = Size.medium
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
    var linesHidden = false
    var seenAt: Double = 0

    init(url: URL) {
        self.url = url
        guard let data = try? Data(contentsOf: url),
              let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return }
        if let value = object["size"] as? String, let size = Size(rawValue: value) { self.size = size }
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
        linesHidden = object["linesHidden"] as? Bool ?? false
        seenAt = object["seenAt"] as? Double ?? 0
    }

    func save() {
        var object: [String: Any] = [
            "pid": Int(getpid()),
            "version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev",
            "accessibility": trusted,
            "size": size.rawValue,
            "hiddenUntil": hiddenUntil,
            "askedFor": askedFor,
            "build": Store.build,
            "running": running, "answered": answered, "offered": offered,
            "sizeAt": sizeAt, "loginAt": loginAt, "followAt": followAt, "login": login,
            "linesHidden": linesHidden, "seenAt": seenAt,
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
        guard (try? data.write(to: url, options: .atomic)) != nil else { return }
        // Broadcast only safe settings metadata to live mod channels. Opening an existing file
        // cannot recreate an uninstalled folder, and O_APPEND keeps the complete line together.
        let keys = ["running", "accessibility", "hiddenUntil", "answered", "size", "sizeAt", "loginAt", "followAt", "login", "version"]
        let info = object.filter { keys.contains($0.key) }
        let event: [String: Any] = ["v": 1, "kind": "companion-state", "at": Date().timeIntervalSince1970 * 1000, "info": info]
        guard var line = try? JSONSerialization.data(withJSONObject: event, options: [.sortedKeys]), line.count < 2048 else { return }
        line.append(10)
        let channel = url.deletingLastPathComponent().appendingPathComponent("requests.jsonl")
        let fd = open(channel.path, O_WRONLY | O_APPEND | O_NOFOLLOW)
        guard fd >= 0 else { return }
        defer { close(fd) }
        _ = line.withUnsafeBytes { Darwin.write(fd, $0.baseAddress!, $0.count) }
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
        try? FileManager.default.createDirectory(at: options.folder, withIntermediateDirectories: true)
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
        let frameFolder = options.frames ?? Bundle.main.resourceURL?.appendingPathComponent("frames", isDirectory: true)
            ?? options.folder.appendingPathComponent("frames", isDirectory: true)
        let pixelFolder = frameFolder.deletingLastPathComponent().appendingPathComponent("pixel", isDirectory: true)
        pet = Pet(frames: Frames(folder: frameFolder, pixelFolder: pixelFolder), store: store, trace: trace)
        feed = Feed(file: options.folder.appendingPathComponent("view.json"), trace: trace)
        feed.seenAt = store.seenAt
        feed.setClaudeFrontmost(NSWorkspace.shared.frontmostApplication?.bundleIdentifier == Claude.bundleID)
        claude = Claude(trace: trace, allowAX: options.accessibility)

        feed.changed = { [unowned self] record in pet.show(record) }
        claude.changed = { [unowned self] reorder in
            store.trusted = claude.trusted
            pet.follow(claude.sighting, reorder: reorder)
        }
        pet.requestFollow = { [unowned self] in follow(at: Date().timeIntervalSince1970 * 1000) }
        pet.openSettings = { [unowned self] in claude.openAccessibilitySettings() }
        pet.requestActivity = { [unowned self] in openActivity() }
        feed.activityChanged = { [unowned self] in
            pet.setUnseen(feed.unseenCount)
            activity?.update(rows: feed.rows, sessions: feed.liveSessions)
        }
        feed.received = { [unowned self] record in
            activity?.receive(record)
            if let ack = record.ack {
                do { try channel?.acknowledge(ack) }
                catch { trace.say("requests: cannot remove acknowledged text: \(error.localizedDescription)") }
            }
            scheduleRequestExpiry()
        }
        for name in [NSWorkspace.didActivateApplicationNotification, NSWorkspace.didDeactivateApplicationNotification] {
            NSWorkspace.shared.notificationCenter.addObserver(self, selector: #selector(frontmostMoved), name: name, object: nil)
        }
        claude.dragged = { [unowned self] dx, _ in pet.sway(dx: dx) }
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
        store.save()
        trace.say("companion: accessibility \(claude.trusted ? "allowed: following the window" : "not allowed: corner while Claude is in front")")
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if pet != nil { comeBack(.reopen, summon: feed.latestSummon) }
        return false
    }

    func applicationWillTerminate(_ notification: Notification) {
        requestExpiry.cancel()
        guard ownsInstance, let store else { return }
        store.running = false
        store.save()
    }

    @objc private func frontmostMoved() {
        feed?.setClaudeFrontmost(NSWorkspace.shared.frontmostApplication?.bundleIdentifier == Claude.bundleID)
    }

    private func openActivity() {
        guard activity == nil, let target = pet.activityTarget else { return }
        let rows = feed.rows, sessions = feed.liveSessions, shown = feed.shown
        let chosen = sessions.first(where: { $0.session == shown.session }) ?? sessions.first ?? .resting
        let made = Activity(rows: rows, sessions: sessions, chosen: chosen, target: target, channel: channel)
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
        made.open()
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
