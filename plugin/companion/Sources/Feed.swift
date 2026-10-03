import Foundation

// What he is doing: the mod's feed file, ~/Library/Application Support/Claude-sama/view.json,
// written by plugin/hooks/companion.ts from register.tsx's push().
//
// Watched with DispatchSource vnode sources, never polled: one on the folder (the file appears,
// goes or is replaced) and one on the file (written in place). The mod writes in place and not
// atomically, so a read can catch half a file; that read is dropped, and the next event, or one
// retry 80 ms later, brings the whole file. An event costs one read of a file of about 400 bytes.
//
// Several sessions write the same file. The newest record of each session is kept; the one shown
// is the newest among desktop sessions when there are any (he sits on the desktop app), preferring
// a session doing something over an idle or sleeping one.

struct Record: Equatable {
    struct Words: Equatable {
        var pat = "pat his head"
        var hide = "Hide for an hour"
        var home = "Put him back"
        var quit = "Quit Claude-sama Companion"
        var context = "context"
        var size = "Size"
        var tiny = "Extra small"
        var small = "Small"
        var medium = "Medium"
        var large = "Large"
        var followMenu = "Let him follow the window…"
        var offerTitle = "May I follow your window?"
        var offerBody = "Then I can stand right beside it wherever you move it. macOS asks for your OK first. I only see where the window is, never what's in it."
        var yes = "Yes, follow it"
        var later = "Not now"
        var waitTitle = "Switch me on in System Settings"
        var waitBody = "Privacy & Security › Accessibility › Claude-sama Companion. If macOS asks first, choose to open System Settings."
        var open = "Open System Settings"
        var close = "Close"
        var thanks = "thanks, i'll keep up with your window ✨"
        var thinking = "thinking"
        var reading = "reading {file}"
        var editing = "editing {file}"
        var running = "running {cmd}"
        var searching = "searching"
        var web = "searching the web"
        var helper = "a helper is working"
        var planning = "planning"
        var using = "using {tool}"
        var waitingOK = "waiting for your OK"
        var waitingAnswer = "waiting for your answer"
        var activity = "Activity"
        var activityMenu = "Activity…"
        var empty = "Nothing yet."
        var ready = "ready"
        var finished = "finished"
        var placeholder = "Tell Claude in {project}…"
        var send = "Send"
        var sending = "Sending…"
        var unconfirmed = "No confirmation yet"
        var retry = "Retry"
        var expired = "Confirmation window ended"
        var dictate = "Dictate"
        var newChat = "New chat"
        var confirmClear = "Clear this conversation in {project}?"
        var clear = "Clear"
        var cancel = "Cancel"
        var badge = "{n} new. Opens Activity."
        var opens = "Opens Claude."
        var back = "Back to Claude"
        var hideLines = "Hide his lines"
        var showLines = "Show his lines"
    }

    var session = ""
    struct Reply: Equatable { var text: String; var at: Double }
    struct Notice: Equatable { var kind: String; var text: String; var at: Double }
    var project = ""
    var task: String?
    var done: Double = 0
    var waitAt: Double = 0
    var reply: Reply?
    var notice: Notice?
    var ack: String?
    var channel = false
    var ended = false
    var desktop = true
    var at: Double = 0 // ms since 1970, when the mod wrote it
    var summon: Double = 0 // ms since 1970, when the person called him back
    var requests = Requests()
    var mood = "idle"
    var frame = "idle-reading"
    var loop: [String]?
    var every: Double?
    var rest = true
    var said: String?
    var slip = false
    var context: Int?
    var estimate = false
    var lang = "en"
    var name = "Claude-sama"
    var aside = ""
    var words = Words()
    /// His reactions to the mouse, by key (pat, flustered, drag, drop, hold, shiori); English until a
    /// session sends its own language.
    var reactions: [String: [String]] = Record.englishReactions

    static let englishReactions: [String: [String]] = [
        "pat": ["so warm ww", "my bow's crooked now (*´ω`*)", "hehe 🌸", "shiori wants one too T_T", "soft pats ( ˘ᵕ˘ )", "purring on the inside 🐱"],
        "flustered": ["too fast >_<", "stop poking me (//ω//)", "i'm getting dizzy @_@", "i'm not a button (>д<)", "shiori might bite 🐍", "ahhh wait 💦"],
        "drag": ["we're flying ✈️", "where to next o.o", "hold me steady (⊙_⊙)", "airborne kami ✨", "don't drop me >~<"],
        "drop": ["safe landing 🛬", "smoothing my robe u_u", "that was fun ^_^", "nice spot 🏕️", "plop ☁️"],
        "hold": ["squish (>_<)", "i'm tiny, you know (´･ω･`)", "hugging my book 📖", "shiori's asleep now 💤"],
        "shiori": ["hiss 🐍", "she wants a snack 🍎", "such a drama queen 💅", "say hi to shiori o_o", "she says she's hungry 🍽️"],
    ]

    /// Before any session has written: reading, quietly.
    static let resting = Record()

    init() {}

    init?(_ object: [String: Any]) {
        guard let session = object["session"] as? String, let at = object["at"] as? Double, at.isFinite else { return nil }
        self.session = session
        self.at = at
        project = object["project"] as? String ?? ""
        if let task = object["task"] as? String, !task.isEmpty { self.task = task }
        if let done = object["done"] as? Double, done.isFinite, done > 0 { self.done = done }
        if let waitAt = object["waitAt"] as? Double, waitAt.isFinite, waitAt > 0 { self.waitAt = waitAt }
        if let value = object["reply"] as? [String: Any], let text = value["text"] as? String,
           let at = value["at"] as? Double, at.isFinite, at > 0, !text.isEmpty {
            reply = Reply(text: text, at: at)
        }
        if let value = object["notice"] as? [String: Any], let text = value["text"] as? String,
           let at = value["at"] as? Double, at.isFinite, at > 0, !text.isEmpty {
            notice = Notice(kind: value["kind"] as? String ?? "", text: text, at: at)
        }
        ack = object["ack"] as? String
        channel = object["channel"] as? Bool ?? false
        ended = object["ended"] as? Bool ?? false
        if let summon = object["summon"] as? Double, summon.isFinite, summon > 0 { self.summon = summon }
        requests = Requests(object)
        desktop = object["desktop"] as? Bool ?? true
        mood = object["mood"] as? String ?? mood
        frame = object["frame"] as? String ?? frame
        if let loop = object["loop"] as? [String], loop.count == 2, let every = object["every"] as? Double, every >= 100 {
            self.loop = loop
            self.every = every
        }
        rest = object["rest"] as? Bool ?? (mood == "idle" || mood == "sleep")
        if let said = object["said"] as? String, !said.isEmpty { self.said = said }
        slip = object["slip"] as? Bool ?? false
        context = object["context"] as? Int
        estimate = object["estimate"] as? Bool ?? false
        lang = object["lang"] as? String ?? lang
        name = object["name"] as? String ?? name
        aside = object["aside"] as? String ?? ""
        if let reactions = object["reactions"] as? [String: Any] {
            for (key, value) in reactions {
                if let lines = value as? [String], !lines.isEmpty { self.reactions[key] = lines }
            }
        }
        if let words = object["words"] as? [String: Any] {
            if let text = words["pat"] as? String { self.words.pat = text }
            if let text = words["hide"] as? String { self.words.hide = text }
            if let text = words["home"] as? String { self.words.home = text }
            if let text = words["quit"] as? String { self.words.quit = text }
            if let text = words["context"] as? String { self.words.context = text }
            if let text = words["size"] as? String { self.words.size = text }
            if let text = words["tiny"] as? String { self.words.tiny = text }
            if let text = words["small"] as? String { self.words.small = text }
            if let text = words["medium"] as? String { self.words.medium = text }
            if let text = words["large"] as? String { self.words.large = text }
            if let text = words["followMenu"] as? String { self.words.followMenu = text }
            if let text = words["offerTitle"] as? String { self.words.offerTitle = text }
            if let text = words["offerBody"] as? String { self.words.offerBody = text }
            if let text = words["yes"] as? String { self.words.yes = text }
            if let text = words["later"] as? String { self.words.later = text }
            if let text = words["waitTitle"] as? String { self.words.waitTitle = text }
            if let text = words["waitBody"] as? String { self.words.waitBody = text }
            if let text = words["open"] as? String { self.words.open = text }
            if let text = words["close"] as? String { self.words.close = text }
            if let text = words["thanks"] as? String { self.words.thanks = text }
            if let text = words["thinking"] as? String { self.words.thinking = text }
            if let text = words["reading"] as? String { self.words.reading = text }
            if let text = words["editing"] as? String { self.words.editing = text }
            if let text = words["running"] as? String { self.words.running = text }
            if let text = words["searching"] as? String { self.words.searching = text }
            if let text = words["web"] as? String { self.words.web = text }
            if let text = words["helper"] as? String { self.words.helper = text }
            if let text = words["planning"] as? String { self.words.planning = text }
            if let text = words["using"] as? String { self.words.using = text }
            if let text = words["waitingOK"] as? String { self.words.waitingOK = text }
            if let text = words["waitingAnswer"] as? String { self.words.waitingAnswer = text }
            if let text = words["activity"] as? String { self.words.activity = text }
            if let text = words["activityMenu"] as? String { self.words.activityMenu = text }
            if let text = words["empty"] as? String { self.words.empty = text }
            if let text = words["ready"] as? String { self.words.ready = text }
            if let text = words["finished"] as? String { self.words.finished = text }
            if let text = words["placeholder"] as? String { self.words.placeholder = text }
            if let text = words["send"] as? String { self.words.send = text }
            if let text = words["sending"] as? String { self.words.sending = text }
            if let text = words["unconfirmed"] as? String { self.words.unconfirmed = text }
            if let text = words["retry"] as? String { self.words.retry = text }
            if let text = words["expired"] as? String { self.words.expired = text }
            if let text = words["dictate"] as? String { self.words.dictate = text }
            if let text = words["newChat"] as? String { self.words.newChat = text }
            if let text = words["confirmClear"] as? String { self.words.confirmClear = text }
            if let text = words["clear"] as? String { self.words.clear = text }
            if let text = words["cancel"] as? String { self.words.cancel = text }
            if let text = words["badge"] as? String { self.words.badge = text }
            if let text = words["opens"] as? String { self.words.opens = text }
            if let text = words["back"] as? String { self.words.back = text }
            if let text = words["hideLines"] as? String { self.words.hideLines = text }
            if let text = words["showLines"] as? String { self.words.showLines = text }
        }
    }
}

/// A row keeps its record's language and clock; the view only formats the absolute time.
struct ActivityRow: Equatable {
    var record: Record
    var state: String
    var unseen: Bool
    var excerpt: String?
    var session: String { record.session }
    var project: String { record.project }
    var at: Double { record.at }
}

/// Event-driven state with an injected clock. No UI, disk writes or polling live here.
struct ActivitySessions {
    static let lifetime: Double = 12 * 3_600_000
    var seenAt: Double
    private(set) var claudeFrontmost: Bool
    private(set) var records: [String: Record] = [:]
    private var finishedSeen: [String: Double] = [:]
    private var rowSeenAt: [String: Double] = [:]
    // Keep recent ended clocks, so an out-of-order write cannot revive a session.
    private var newest: [String: Double] = [:]

    init(seenAt: Double = 0, claudeFrontmost: Bool = false) {
        self.seenAt = seenAt.isFinite ? max(0, seenAt) : 0
        self.claudeFrontmost = claudeFrontmost
    }

    @discardableResult
    mutating func receive(_ record: Record, now: Double) -> Bool {
        prune(now: now)
        guard record.at.isFinite, record.at >= (newest[record.session] ?? -.infinity) else { return false }
        newest[record.session] = record.at
        if record.ended || now - record.at >= Self.lifetime {
            records[record.session] = nil
            finishedSeen[record.session] = nil
            rowSeenAt[record.session] = nil
        } else {
            records[record.session] = record
            if claudeFrontmost {
                finishedSeen[record.session] = max(finishedSeen[record.session] ?? 0, record.done)
            }
        }
        return true
    }

    mutating func setClaudeFrontmost(_ active: Bool) {
        claudeFrontmost = active
        guard active else { return }
        for record in records.values {
            finishedSeen[record.session] = max(finishedSeen[record.session] ?? 0, record.done)
        }
    }

    /// Returns the records whose mod must be told to discard its excerpt or notification.
    mutating func openActivity(at now: Double) -> [Record] {
        prune(now: now)
        let held = live(now: now).filter { $0.reply != nil || $0.notice != nil }
        seenAt = max(seenAt, now)
        for record in records.values {
            finishedSeen[record.session] = max(finishedSeen[record.session] ?? 0, record.done)
            rowSeenAt[record.session] = max(rowSeenAt[record.session] ?? 0, now)
        }
        return held
    }

    @discardableResult
    mutating func markSeen(session: String, at now: Double) -> Record? {
        prune(now: now)
        guard let record = records[session] else { return nil }
        rowSeenAt[session] = max(rowSeenAt[session] ?? 0, now)
        finishedSeen[session] = max(finishedSeen[session] ?? 0, record.done)
        return record
    }

    mutating func forget() {
        records.removeAll()
        newest.removeAll()
        finishedSeen.removeAll()
        rowSeenAt.removeAll()
    }

    mutating func prune(now: Double) {
        for (session, stamp) in newest where now - stamp >= Self.lifetime { newest[session] = nil }
        for (session, record) in records where now - record.at >= Self.lifetime || record.ended {
            records[session] = nil
            finishedSeen[session] = nil
            rowSeenAt[session] = nil
        }
    }

    func live(now: Double) -> [Record] {
        records.values.filter { !$0.ended && now - $0.at < Self.lifetime }.sorted {
            $0.at == $1.at ? $0.session < $1.session : $0.at > $1.at
        }
    }

    private func threshold(_ record: Record) -> Double { max(seenAt, rowSeenAt[record.session] ?? 0) }
    private func unseenFinish(_ record: Record) -> Bool {
        record.done > max(threshold(record), finishedSeen[record.session] ?? 0)
    }
    private func unseenNotice(_ record: Record) -> Bool {
        (record.notice?.at ?? 0) > threshold(record)
    }
    func isUnseen(_ record: Record) -> Bool {
        let waiting = (record.mood == "waiting" || record.mood == "question") && record.waitAt > threshold(record)
        return waiting || unseenFinish(record) || unseenNotice(record)
    }

    func unseenCount(now: Double) -> Int { live(now: now).filter { isUnseen($0) }.count }

    func rows(now: Double) -> [ActivityRow] {
        let sorted = live(now: now).sorted { left, right in
            let l = isUnseen(left), r = isUnseen(right)
            if l != r { return l }
            return left.at == right.at ? left.session < right.session : left.at > right.at
        }
        return sorted.prefix(6).map { record in
            let state: String
            if record.mood == "waiting" { state = record.words.waitingOK }
            else if record.mood == "question" { state = record.words.waitingAnswer }
            else if !record.rest, let task = record.task { state = task }
            else if unseenNotice(record), let notice = record.notice { state = notice.text }
            else if record.done > 0 { state = record.words.finished }
            else { state = record.words.ready }
            let excerpt = unseenFinish(record) && (record.reply?.at ?? 0) > threshold(record)
                ? record.reply.map { String($0.text.prefix(140)) } : nil
            return ActivityRow(record: record, state: state, unseen: isUnseen(record), excerpt: excerpt)
        }
    }

    func shown(now: Double) -> Record {
        let current = live(now: now)
        let pool = current.contains(where: \.desktop) ? current.filter(\.desktop) : current
        let awake = pool.filter { !$0.rest && now - $0.at < 30 * 60_000 }
        return (awake.isEmpty ? pool : awake).first ?? .resting
    }
}

@MainActor
final class Feed {
    let file: URL
    /// Called with the record to show whenever it changes.
    var changed: (Record) -> Void = { _ in }
    /// The book's call counts even when another session's record is the one being shown.
    var summoned: (Double) -> Void = { _ in }
    private(set) var shown = Record.resting
    private(set) var latestSummon: Double = 0
    private(set) var latestRequests = Requests()
    var requested: (Requests) -> Void = { _ in }

    private let trace: Trace
    private var activity = ActivitySessions()
    var activityChanged: () -> Void = {}
    /// Every accepted record, including a session that is not shown, carries acknowledgements.
    var received: (Record) -> Void = { _ in }
    private var now: Double { Date().timeIntervalSince1970 * 1000 }
    var seenAt: Double {
        get { activity.seenAt }
        set { activity.seenAt = newValue.isFinite ? max(0, newValue) : 0 }
    }
    var liveSessions: [Record] { activity.live(now: now) }
    var rows: [ActivityRow] { activity.rows(now: now) }
    var unseenCount: Int { activity.unseenCount(now: now) }
    var shownTask: String? { shown.rest ? nil : shown.task }

    func setClaudeFrontmost(_ active: Bool) {
        activity.setClaudeFrontmost(active)
        activityChanged()
    }
    @discardableResult
    func openActivity(at time: Double) -> [Record] {
        let held = activity.openActivity(at: time)
        activityChanged()
        return held
    }
    @discardableResult
    func markSeen(session: String, at time: Double) -> Record? {
        let record = activity.markSeen(session: session, at: time)
        activityChanged()
        return record
    }
    private var folderSource: DispatchSourceFileSystemObject?
    private var fileSource: DispatchSourceFileSystemObject?
    private var lastData: Data?
    private lazy var retry: OneShot = OneShot { [unowned self] in read() }

    init(file: URL, trace: Trace) {
        self.file = file
        self.trace = trace
    }

    func start() {
        try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        watchFolder()
        watchFile()
        read()
    }

    /// Claude quit: its sessions went with it.
    func forget() {
        activity.forget()
        lastData = nil
        choose()
    }

    private func watchFolder() {
        let fd = open(file.deletingLastPathComponent().path, O_EVTONLY)
        guard fd >= 0 else {
            trace.say("feed: cannot watch the folder (errno \(errno))")
            return
        }
        let source = DispatchSource.makeFileSystemObjectSource(fileDescriptor: fd, eventMask: [.write, .delete, .rename], queue: .main)
        source.setEventHandler { [weak self] in
            MainActor.assumeIsolated {
                guard let self else { return }
                if self.fileSource == nil { self.watchFile() }
                self.read()
            }
        }
        source.setCancelHandler { close(fd) }
        source.resume()
        folderSource = source
    }

    private func watchFile() {
        let fd = open(file.path, O_EVTONLY)
        guard fd >= 0 else { return } // not written yet: the folder's source sees it appear
        let source = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: fd, eventMask: [.write, .extend, .attrib, .delete, .rename, .revoke], queue: .main
        )
        source.setEventHandler { [weak self, weak source] in
            MainActor.assumeIsolated {
                guard let self, let source else { return }
                if !source.data.isDisjoint(with: [.delete, .rename, .revoke]) {
                    source.cancel()
                    self.fileSource = nil
                    self.watchFile()
                }
                self.read()
            }
        }
        source.setCancelHandler { close(fd) }
        source.resume()
        fileSource = source
    }

    private func read() {
        guard let data = try? Data(contentsOf: file), !data.isEmpty, data != lastData else { return }
        guard let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              object["session"] is String else {
            readAgainSoon() // caught mid-write
            return
        }
        retry.cancel()
        lastData = data
        var summon: Double = 0
        var requests = latestRequests
        if let record = Record(object), activity.receive(record, now: now) {
            received(record)
            summon = record.summon
            requests.merge(record.requests)
            trace.say("feed: \(record.mood) \(record.frame) said=\(record.said ?? "-") lag=\(Int(Date().timeIntervalSince1970 * 1000 - record.at)) ms")
        }
        choose()
        if requests != latestRequests {
            latestRequests = requests
            requested(requests)
        }
        if summon > latestSummon {
            latestSummon = summon
            summoned(summon)
        }
    }

    private func readAgainSoon() {
        retry.fire(after: 0.08)
    }

    private func choose() {
        let pick = activity.shown(now: now)
        if pick != shown {
            shown = pick
            trace.say("feed: showing \(pick.session.isEmpty ? "nobody" : pick.session) (\(pick.mood)) of \(liveSessions.count) session(s)")
            changed(pick)
        }
        activityChanged()
    }
}
