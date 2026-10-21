import Foundation

/// What joins two clauses on one line: the language's own comma (companion-rs ui.rs part_separator).
enum Clauses {
    /// Between the project and its task on the task pill: lane B's companion.projectTask (companion-rs words/1.0.json).
    static func projectTask(_ lang: String) -> String {
        switch lang {
        case "zh", "zh-Hant": return ":"
        case "fr": return " : "
        default: return ": "
        }
    }
    static func separator(_ lang: String) -> String {
        switch lang {
        case "zh", "zh-Hant": return ","
        case "ja": return "\u{3001}"
        default: return ", "
        }
    }
}

enum FeedLimits {
    static let maxBytes = 1_048_576
    static let maxSessions = 128

    /// Bound work before text measurement. Keep shaping joiners and variation selectors.
    static func display(_ text: String, limit: Int = 512) -> String {
        let cap = max(0, min(limit, 512))
        let scalars = Array(text.unicodeScalars.prefix(cap + 34))
        var result = "", units = 0, index = 0
        while index < scalars.count {
            let scalar = scalars[index], code = scalar.value
            if code == 0x1f3f4 {
                var end = index + 1
                while end < scalars.count, end - index <= 32,
                      (0xe0061...0xe007a).contains(scalars[end].value) || (0xe0030...0xe0039).contains(scalars[end].value) {
                    end += 1
                }
                if end > index + 1, end < scalars.count, scalars[end].value == 0xe007f {
                    let piece = scalars[index...end].map(String.init).joined()
                    let count = piece.utf16.count
                    if units + count > cap { break }
                    result += piece; units += count; index = end + 1; continue
                }
            }
            let visible = code <= 0x1f || (0x7f...0x9f).contains(code)
                || scalar.properties.generalCategory == .format && code != 0x200c && code != 0x200d
            let piece = visible ? String(format: "⟨U+%04X⟩", code) : String(scalar)
            let count = piece.utf16.count
            if units + count > cap { break }
            result += piece; units += count; index += 1
        }
        return result
    }

    private static func valid(_ value: Any, depth: Int = 0) -> Bool {
        guard depth <= 8 else { return false }
        if let text = value as? String { return text.utf8.count <= 8192 }
        if let array = value as? [Any] {
            return array.count <= 128 && array.allSatisfy { valid($0, depth: depth + 1) }
        }
        if let object = value as? [String: Any] {
            return object.count <= 256 && object.allSatisfy { $0.key.utf8.count <= 64 && valid($0.value, depth: depth + 1) }
        }
        return true
    }

    static func object(_ raw: [String: Any]) -> [String: Any]? {
        var object = raw
        for key in ["project", "task", "place"] {
            if let text = object[key] as? String { object[key] = display(text) }
        }
        for key in ["reply", "notice"] {
            if var nested = object[key] as? [String: Any], let text = nested["text"] as? String {
                nested["text"] = display(text); object[key] = nested
            }
        }
        return valid(object) ? object : nil
    }
}

// What he is doing: the mod's feed file, ~/Library/Application Support/Coco/view.json,
// written by plugin/hooks/companion.ts from register.tsx's push().
//
// Watched with DispatchSource vnode sources, never polled: one on the folder (the file appears,
// goes or is replaced) and one on the file (written in place). The mod atomically replaces its
// feed. A partial legacy write retains the last valid record until the completing write event.
// No retry timer sits between a file event and its first read/draw.
//
// Several sessions write the same file. The newest record of each session is kept; the one shown
// is the newest among desktop sessions when there are any (he sits on the desktop app), preferring
// a session doing something over an idle or sleeping one.

/// The feed carries the same global event every band observes. Session activity remains local.
struct Presence: Equatable {
    let seq: Double
    let asleep: Bool
    let kind: String
    let eventID: String
    let at: Double
    let said: String?
    struct Touch: Equatable {
        let id: String
        let at: Double
        let by: String
        let touch: String
        let session: String?
        let lang: String
        init?(_ value: [String: Any]) {
            guard value["kind"] as? String == "touch",
                  let id = value["id"] as? String, id.utf8.count <= 256,
                  let at = value["at"] as? Double, at.isFinite, at >= 0, at <= 8.64e15,
                  let by = value["by"] as? String, ["band", "companion"].contains(by),
                  id == "touch:\(by):\(Int64(at))",
                  let touch = value["touch"] as? String, ["poke", "pat", "burst", "hug", "drag"].contains(touch),
                  let lang = value["lang"] as? String, !lang.isEmpty, lang.utf8.count <= 16 else { return nil }
            let session = value["session"] as? String
            if let session, session.utf8.count > 256 { return nil }
            self.id = id; self.at = at; self.by = by; self.touch = touch; self.session = session; self.lang = lang
        }
    }
    let touch: Touch?

    init?(_ object: [String: Any]) {
        guard let seq = object["seq"] as? Double, seq.isFinite, seq >= 0,
              seq <= 9_007_199_254_740_991, seq.rounded(.towardZero) == seq,
              let asleep = object["asleep"] as? Bool,
              let event = object["event"] as? [String: Any],
              let kind = event["kind"] as? String, !kind.isEmpty, kind.utf8.count <= 64,
              let eventID = event["id"] as? String, !eventID.isEmpty, eventID.utf8.count <= 256,
              let at = event["at"] as? Double, at.isFinite, at >= 0, at <= 8.64e15 else { return nil }
        let said = object["said"] as? String
        if let said, said.utf8.count > 8192 { return nil }
        self.seq = seq
        self.asleep = asleep
        self.kind = kind
        self.eventID = eventID
        self.at = at
        self.said = said.map(Record.dialogueCopy)
        touch = (object["touchEvent"] as? [String: Any]).flatMap(Touch.init)
    }

    func applying(to record: Record, now: Double) -> Record {
        var shown = record
        shown.presence = self
        if asleep {
            shown.mood = "sleep"
            shown.frame = "sleep"
            shown.loop = nil
            shown.every = nil
            shown.rest = true
            shown.slip = false
            shown.said = nil
        } else if shown.mood == "sleep" {
            shown.mood = "idle"
            shown.frame = "idle-reading"
            shown.loop = nil
            shown.every = nil
            shown.rest = true
            shown.slip = false
            shown.said = nil
        }
        if kind == "sleep" || kind == "wake" || kind == "clingy" && said != nil {
            if now >= at && now - at < 14_000 {
                shown.said = said
                // Pet's stale-line guard follows the shared event's age, even
                // when its chosen task came from an older cached session record.
                shown.at = max(shown.at, at)
                shown.slip = false
            } else if record.at <= at + 14_000 {
                // A cached record cannot replay this event after its shared display window.
                // A later session line remains that session's own speech.
                shown.said = nil
                shown.slip = false
            }
        }
        return shown
    }
}

struct Record: Equatable {
    static func stageCopy(_ text: String) -> String { text.replacingOccurrences(of: "*", with: "") }
    static func dialogueCopy(_ text: String) -> String {
        let face="*´ω`*"
        return text.components(separatedBy:face).map {$0.replacingOccurrences(of:"*",with:"")}.joined(separator:face)
    }
    struct Words: Equatable {
        var pat = "pat coco's head"
        var hide = "Hide for an hour"
        var home = "Put Coco back"
        var quit = "Quit Coco Pet"
        var context = "context"
        var size = "Size"
        var medium = "Medium"
        var large = "Large"
        var larger = "Larger"
        var followMenu = "Let Coco follow the window…"
        var offerTitle = "May I follow your window?"
        var offerBody = "Then I can stand right beside it wherever you move it. macOS asks for your OK first. I only see where the window is, never what's in it."
        var yes = "Yes, follow it"
        var later = "Not now"
        var waitTitle = "Switch me on in System Settings"
        var waitBody = "Privacy & Security › Accessibility › Coco Pet. If macOS asks first, choose to open System Settings."
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
        var placeholder = "Tell Claude…"
        var send = "Send"
        var sending = "Sending…"
        var unconfirmed = "Not sure it arrived"
        var retry = "Retry"
        var expired = "Timed out"
        var dictate = "Dictate"
        var newChat = "New chat"
        var newChatTerminal = "Terminal"
        var newChatDesktop = "Claude app"
        var newChatVSCode = "VS Code"
        var confirmClear = "Clear this conversation in {project}?"
        var clear = "Clear"
        var cancel = "Cancel"
        var badge = "{n} new. Opens Activity."
        var opens = "Opens Claude."
        var back = "Back to Claude"
        var hideLines = "Hide its lines"
        var showLines = "Show its lines"
        var patMenu = "Pat Coco's head"
        var actions = "Actions"
        var actWave = "Wave"
        var actHug = "Hug"
        var actFlustered = "Fluster"
        var login = "Open at login"
        var hideMenu = "Hide"
        var hideHour = "For an hour"
        var hideUntil = "Until I call Coco back"
    }

    var ribbon: Int?
    var helpers: [D1Helper] = []
    var shed: D1Shed?
    var visitor: D1Visitor?
    /// `/coco focus`: the stick he keeps beside him while it burns (two times, nothing else).
    var stick: Stick?
    var longTask: D1LongTask?
    /// The DM thread while Talk is on (DmThread.swift).
    var dm: DmThread?
    var longTaskAuthorizationRequest = 0.0
    var longTaskSettingsRequest = 0.0
    var shedAside = "", helpersAlt = "", ribbonAlt = ""
    var session = ""
    var presence: Presence?
    var sharedLineUntil: Double? {
        guard let presence, said != nil, said == presence.said,
              ["sleep", "wake", "clingy"].contains(presence.kind) else { return nil }
        return presence.at + 14_000
    }
    struct Reply: Equatable { var text: String; var at: Double }
    struct Notice: Equatable { var kind: String; var text: String; var at: Double }
    var project = ""
    /// The session's folder, where New chat starts the terminal version (NewChat.swift); a plain local path or none.
    var cwd: String?
    var task: String?
    /// Where the task list is while it runs, in the plugin's words («task 3/7»); none otherwise.
    var place: String?
    /// The Dock tile is on (S21): the quota lines its menu lists, in the band's own words; nil while it is off.
    var dock: [String]?
    /// The 5-hour and weekly windows for Activity's foot (QuotaPixels.swift); nil before the first reading.
    var quota: [QuotaWindow]?
    var done: Double = 0
    var waitAt: Double = 0
    var reply: Reply?
    var notice: Notice?
    var ack: String?
    var channel = false
    var ended = false
    var desktop = true
    var surfaces: [String] = ["desktop"]
    var companionTarget = "auto"
    var neighbours = false
    var affection = "warm"
    var wakeLines: [String] = []
    var at: Double = 0 // ms since 1970, when the mod wrote it
    var summon: Double = 0 // ms since 1970, when the person called him back
    var requests = Requests()
    var mood = "idle"
    var frame = "idle-reading"
    var loop: [String]?
    var every: Double?
    var motion = MotionModel.standard
    struct Pose: Equatable {
        let name: String, frame: String, aside: String
        let at: Double
        let longAt: Double?
        let celebration: Double?
        init?(_ value: Any?) {
            guard let value = value as? [String:Any], let name = value["name"] as? String,
                ["search","scroll","spyglass","plan","run","helper","tea","work","lookup","cheer"].contains(name),
                let frame = value["frame"] as? String, frame.utf8.count < 128,
                let at = value["at"] as? Double, at.isFinite, at >= 0 else { return nil }
            self.name = name; self.frame = frame; self.at = at; aside = Record.stageCopy(value["aside"] as? String ?? "")
            longAt = (value["longAt"] as? Double).flatMap { $0.isFinite ? $0 : nil }
            celebration = (value["celebration"] as? Double).flatMap { $0.isFinite ? $0 : nil }
        }
    }
    var pose: Pose?
    /// For Coco's player (CocoModel.swift), as companion-rs's feed.rs reads them: the tool pose's name as the plugin
    /// wrote it, their outfit (A or B), the pair from their sock drawer, and Claude's form when it is not Coco.
    var poseName: String?
    var outfit: String?
    var socks: String?
    var claudie: String?
    var rest = true
    var said: String?
    var slip = false
    var context: Int?
    var estimate = false
    var lang = "en"
    var name = "Coco"
    var aside = ""
    var words = Words()
    private var opensTemplate = "Opens {app}."
    private var backTemplate = "Back to {app}"
    /// His reactions to the mouse, by key (pat, flustered, drag, drop, hold); English until a
    /// session sends its own language.
    var neighbourBusy = "{agent} next door is busy."
    var neighbourDone = "{agent} next door is done."
    var reactions: [String: [String]] = Record.englishReactions.mapValues { $0.map(Record.dialogueCopy) }

    static let englishReactions: [String: [String]] = [
        "ride": ["whoa, so fast 💨", "where is this window going @_@", "holding on, holding on >_<", "my keycap clip nearly flew off ⌨️", "(dizzy) ...once more ✨", "the hood caught the wind o.o"],
        "pat": ["more pats. that's an order ✨", "antennae up (*´ω`*)", "the keycap clip's crooked now >_<", "(hides in the hood) ˘ᵕ˘", "purrr 🐱"],
        "flustered": ["too fast >_<", "stop poking (//ω//)", "i'm not a button (>д<)", "combo broken 💦", "my antennae are tangled @_@", "spam detected 🚫"],
        "drag": ["we're flying ✈️", "where to o.o", "mind the hoodie (⊙_⊙)", "liftoff ✨", "don't drop me >~<"],
        "drop": ["safe landing 🛬", "(zips the hoodie back up) u_u", "that was fun ^_^", "nice spot 🌿", "plop ☁️"],
        "hold": ["squish >_<", "i'm tiny, you know (´･ω･`)", "let me go (T_T)", "the laptop's getting squished 💻"],
    ]

    /// Before any session has written: reading, quietly.
    static let resting = Record()

    init() {}

    init?(_ raw: [String: Any]) {
        guard let object = FeedLimits.object(raw),
              let session = object["session"] as? String, !session.isEmpty, session.utf8.count <= 256,
              let at = object["at"] as? Double, at.isFinite else { return nil }
        self.session = session
        self.at = at
        if let raw = object["ribbon"] as? [String:Any], raw["visible"] as? Bool == true,
           let index = raw["index"] as? Int, (1...14).contains(index) { ribbon=index }
        if let raw = object["helpers"] as? [[String:Any]], raw.count <= 64 { helpers=raw.compactMap(D1Helper.init) }
        shed = (object["shed"] as? [String:Any]).flatMap(D1Shed.init)
        visitor = (object["visitor"] as? [String:Any]).flatMap(D1Visitor.init)
        stick = Stick(object["stick"])
        longTask = (object["longTask"] as? [String:Any]).flatMap(D1LongTask.init)
        dm = DmThread(object["dm"])
        if let at=object["longTaskAuthorizationRequest"] as? Double, at.isFinite, at > 0 { longTaskAuthorizationRequest=at }
        if let at=object["longTaskSettingsRequest"] as? Double, at.isFinite, at > 0 {longTaskSettingsRequest=at}
        if let words=object["words"] as? [String:Any] {
            shedAside=Self.stageCopy(words["shedAside"] as? String ?? "")
            helpersAlt=words["helpersAlt"] as? String ?? ""
            ribbonAlt=words["ribbonAlt"] as? String ?? ""
        }
        if let presence = object["presence"] as? [String: Any] { self.presence = Presence(presence) }
        project = object["project"] as? String ?? ""
        if let cwd = object["cwd"] as? String, NewChat.localFolder(cwd) { self.cwd = cwd }
        if let task = object["task"] as? String, !task.isEmpty { self.task = task }
        if let place = object["place"] as? String, !place.isEmpty, place.count <= 40 { self.place = place }
        quota = QuotaWindow.parse(object["quota"])
        if let dock = object["dock"] as? [String: Any] {
            self.dock = ((dock["quota"] as? [Any]) ?? []).compactMap { $0 as? String }.filter { !$0.isEmpty }.prefix(2).map { FeedLimits.display($0, limit: 160) }
        }
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
        if let raw = object["surfaces"] as? [String], raw.count <= 32 {
            surfaces = Array(Set(raw.filter { ["desktop", "vscode", "terminal", "remote"].contains($0) })).sorted()
            desktop = surfaces.contains("desktop")
        } else { surfaces = desktop ? ["desktop"] : ["terminal"] }
        if let target = object["companionTarget"] as? String, ["auto", "claude", "vscode"].contains(target) { companionTarget = target }
        neighbours = object["neighbours"] as? Bool == true
        if object["affection"] as? String == "clingy" { affection = "clingy" }
        if let lines = object["wakeLines"] as? [String], lines.count <= 128, lines.allSatisfy({ $0.utf8.count <= 8192 }) { wakeLines = lines.map(Self.dialogueCopy) }
        mood = object["mood"] as? String ?? mood
        frame = object["frame"] as? String ?? frame
        if let loop = object["loop"] as? [String], loop.count == 2, let every = object["every"] as? Double, every >= 100 {
            self.loop = loop
            self.every = every
        }
        if let model = MotionModel(object["motion"]) { motion = model }
        rest = object["rest"] as? Bool ?? (mood == "idle" || mood == "sleep")
        if let said = object["said"] as? String, !said.isEmpty { self.said = Self.dialogueCopy(said) }
        slip = object["slip"] as? Bool ?? false
        context = object["context"] as? Int
        estimate = object["estimate"] as? Bool ?? false
        lang = object["lang"] as? String ?? lang
        if let words = object["neighbourWords"] as? [String: String] {
            neighbourBusy = words["busy"] ?? neighbourBusy; neighbourDone = words["done"] ?? neighbourDone
        }
        name = object["name"] as? String ?? name
        aside = Self.stageCopy(object["aside"] as? String ?? "")
        poseName = ((object["pose"] as? [String: Any])?["name"] as? String).flatMap { !$0.isEmpty && $0.utf8.count <= 64 ? $0 : nil }
        outfit = (object["outfit"] as? String).flatMap { ["A", "B"].contains($0) ? $0 : nil }
        socks = (object["socks"] as? String).flatMap { (2...24).contains($0.utf8.count) && $0.utf8.allSatisfy({ (97...122).contains($0) }) ? $0 : nil }
        claudie = (object["claudie"] as? String).flatMap { ["dake", "maid"].contains($0) ? $0 : nil }
        pose = Pose(object["pose"])
        if let pose, !["waiting","question","wild","error","sleep"].contains(mood) { frame = pose.frame; aside = pose.aside; loop = nil; every = nil } else { pose = nil }
        if let reactions = object["reactions"] as? [String: Any] {
            for (key, value) in reactions {
                if let lines = value as? [String], !lines.isEmpty { self.reactions[key] = lines.map(Self.dialogueCopy) }
            }
        }
        if let words = object["words"] as? [String: Any] {
            if let text = words["pat"] as? String { self.words.pat = text }
            if let text = words["hide"] as? String { self.words.hide = text }
            if let text = words["home"] as? String { self.words.home = text }
            if let text = words["quit"] as? String { self.words.quit = text }
            if let text = words["context"] as? String { self.words.context = text }
            if let text = words["size"] as? String { self.words.size = text }
            if let text = words["medium"] as? String { self.words.medium = text }
            if let text = words["large"] as? String { self.words.large = text }
            if let text = words["larger"] as? String { self.words.larger = text }
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
            if let text = words["newChatTerminal"] as? String { self.words.newChatTerminal = text }
            if let text = words["newChatDesktop"] as? String { self.words.newChatDesktop = text }
            if let text = words["newChatVSCode"] as? String { self.words.newChatVSCode = text }
            if let text = words["confirmClear"] as? String { self.words.confirmClear = text }
            if let text = words["clear"] as? String { self.words.clear = text }
            if let text = words["cancel"] as? String { self.words.cancel = text }
            if let text = words["badge"] as? String { self.words.badge = text }
            if let text = words["opens"] as? String { self.words.opens = text; opensTemplate = text }
            if let text = words["back"] as? String { self.words.back = text; backTemplate = text }
            if let text = words["hideLines"] as? String { self.words.hideLines = text }
            if let text = words["showLines"] as? String { self.words.showLines = text }
            if let text = words["patMenu"] as? String { self.words.patMenu = text }
            if let text = words["actions"] as? String { self.words.actions = text }
            if let text = words["actWave"] as? String { self.words.actWave = text }
            if let text = words["actHug"] as? String { self.words.actHug = text }
            if let text = words["actFlustered"] as? String { self.words.actFlustered = text }
            if let text = words["login"] as? String { self.words.login = text }
            if let text = words["hideMenu"] as? String { self.words.hideMenu = text }
            if let text = words["hideHour"] as? String { self.words.hideHour = text }
            if let text = words["hideUntil"] as? String { self.words.hideUntil = text }
        }
        // Direct records are immediately usable by Activity and VoiceOver; retain the original
        // slots independently so a later target change can resolve them again.
        words.opens = opensTemplate.replacingOccurrences(of: "{app}", with: "Claude")
        words.back = backTemplate.replacingOccurrences(of: "{app}", with: "Claude")
    }
    func namingApp(_ app: String) -> Record {
        var copy = self
        copy.words.opens = opensTemplate.replacingOccurrences(of: "{app}", with: app)
        copy.words.back = backTemplate.replacingOccurrences(of: "{app}", with: app)
        return copy
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
    private var presence: Presence?

    init(seenAt: Double = 0, claudeFrontmost: Bool = false) {
        self.seenAt = seenAt.isFinite ? max(0, seenAt) : 0
        self.claudeFrontmost = claudeFrontmost
    }

    @discardableResult
    mutating func receive(_ record: Record, now: Double) -> Bool {
        prune(now: now)
        guard record.at.isFinite, record.at >= (newest[record.session] ?? -.infinity) else { return false }
        if newest[record.session] == nil, newest.count >= FeedLimits.maxSessions,
           let oldest = newest.min(by: { $0.value < $1.value })?.key {
            newest[oldest] = nil; records[oldest] = nil
            finishedSeen[oldest] = nil; rowSeenAt[oldest] = nil
        }
        newest[record.session] = record.at
        if let incoming = record.presence { receivePresence(incoming) }
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

    mutating func receivePresence(_ incoming: Presence) {
            if let held = presence {
                let sameEvent = incoming.eventID == held.eventID && incoming.kind == held.kind
                    && incoming.asleep == held.asleep
                let immediateWake = held.asleep && !incoming.asleep && incoming.kind == "wake"
                    && incoming.at >= held.at
                if incoming.seq > held.seq || incoming.seq == held.seq && (sameEvent || immediateWake) {
                    presence = incoming
                }
            } else { presence = incoming }
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
        presence = nil
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

    /// A newest terminal-only active session deliberately preserves the current app.
    func target(now: Double, previous: String) -> String {
        let current = live(now: now)
        if let preference = current.first?.companionTarget, preference != "auto" { return preference }
        let active = current.first { !$0.rest && now - $0.at < 30 * 60_000 }
        guard let newest = active ?? current.first else { return previous }
        if newest.surfaces.contains("desktop") { return "claude" }
        if newest.surfaces.contains("vscode") { return "vscode" }
        return previous
    }

    func shown(now: Double, target: String? = nil) -> Record {
        let current = live(now: now)
        let surface = target == "vscode" ? "vscode" : "desktop"
        let pool = current.contains(where: { $0.surfaces.contains(surface) }) ? current.filter { $0.surfaces.contains(surface) } : current
        let awake = pool.filter { !$0.rest && now - $0.at < 30 * 60_000 }
        let selected = (awake.isEmpty ? pool : awake).first ?? .resting
        return presence?.applying(to: selected, now: now) ?? selected
    }
}

@MainActor
final class Feed {
    let file: URL
    /// Called with the record to show whenever it changes.
    var changed: (Record) -> Void = { _ in }
    var woke: (Presence) -> Void = { _ in }
    var targetChanged: (String) -> Void = { _ in }
    private(set) var targetApp = "claude"
    private var lastWake: Presence?

    /// The caller draws its first response before calling this; all disk/locking work is deferred.
    func neighbours(_ value: [String: Any]) { presenceObserver?.neighbours(value) }

    func touch(_ kind: String, lang: String, at: Double? = nil) {
        DispatchQueue.main.async { [weak self] in MainActor.assumeIsolated {
            self?.presenceObserver?.touch(kind, lang: lang, at: at)
        } }
    }
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
    var rows: [ActivityRow] {
        activity.rows(now: now).map { row in
            var copy = row
            copy.record = row.record.namingApp(targetApp == "vscode" ? "VS Code" : "Claude")
            return copy
        }
    }
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
    private var starting = false
    private var presenceObserver: PresenceObserver?

    init(file: URL, trace: Trace) {
        self.file = file
        self.trace = trace
        let folder = file.deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Coco-presence", isDirectory: true)
        presenceObserver = PresenceObserver(folder: folder, trace: trace)
        presenceObserver?.changed = { [weak self] presence in
            guard let self else { return }
            self.activity.receivePresence(presence)
            if !presence.asleep && presence.kind == "wake" && (presence.eventID != self.lastWake?.eventID || presence.said != self.lastWake?.said) {
                self.lastWake = presence
                self.woke(presence)
            }
            self.choose()
        }
    }

    func start() {
        starting = true
        guard (try? SecureDirectory(file.deletingLastPathComponent(), create: true)) != nil else {
            starting = false; return
        }
        watchFolder()
        watchFile()
        read()
        presenceObserver?.start()
        starting = false
        choose()
    }

    func stop() {
        presenceObserver?.stop()
        folderSource?.cancel(); folderSource = nil
        fileSource?.cancel(); fileSource = nil
    }

    /// Claude quit: its sessions went with it.
    func forget() {
        activity.forget()
        if let presence = presenceObserver?.current { activity.receivePresence(presence) }
        lastData = nil
        choose()
    }

    private func watchFolder() {
        guard let directory = try? SecureDirectory(file.deletingLastPathComponent()) else { return }
        let fd = dup(directory.fd)
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
        guard let directory = try? SecureDirectory(file.deletingLastPathComponent()),
              let fd = try? directory.openFile(file.lastPathComponent, flags: O_EVTONLY) else { return }
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
        guard let directory = try? SecureDirectory(file.deletingLastPathComponent()),
              let data = try? directory.read(file.lastPathComponent, maxBytes: FeedLimits.maxBytes),
              !data.isEmpty, data != lastData else { return }
        guard let raw = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let object = FeedLimits.object(raw), object["session"] is String else {
            // Keep the last complete record; the completing write/rename raises another event.
            return
        }
        lastData = data
        if let presence = object["presence"] as? [String: Any] { presenceObserver?.recipes(presence) }
        var summon: Double = 0
        var accepted: Record?
        var requests = latestRequests
        if let record = Record(object), activity.receive(record, now: now) {
            if !record.wakeLines.isEmpty {
                presenceObserver?.recipes(["affection": record.affection, "wakeLines": [record.lang: record.wakeLines]])
            }
            accepted = record
            summon = record.summon
            requests.merge(record.requests)
            trace.say("feed: \(record.mood) \(record.frame) has-line=\(record.said != nil) lag=\(Int(Date().timeIntervalSince1970 * 1000 - record.at)) ms")
        }
        // Show first: acknowledgement/file cleanup listeners cannot hold up this draw.
        choose()
        if let accepted { received(accepted) }
        if requests != latestRequests {
            latestRequests = requests
            requested(requests)
        }
        if summon > latestSummon {
            latestSummon = summon
            summoned(summon)
        }
    }

    private func choose() {
        guard !starting else { return }
        let target = activity.target(now: now, previous: targetApp)
        if target != targetApp { targetApp = target; targetChanged(target) }
        let pick = activity.shown(now: now, target: targetApp).namingApp(targetApp == "vscode" ? "VS Code" : "Claude")
        if pick != shown {
            shown = pick
            trace.say("feed: showing \(pick.session.isEmpty ? "nobody" : pick.session) (\(pick.mood)) of \(liveSessions.count) session(s)")
            changed(pick)
        }
        activityChanged()
    }
}
