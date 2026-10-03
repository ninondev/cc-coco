import AppKit
import CoreText
import QuartzCore

@MainActor func run() -> Int32 {
    let root = URL(fileURLWithPath: CommandLine.arguments[1])
    let frames = Frames(folder: root.appendingPathComponent("desktop"), pixelFolder: root.appendingPathComponent("pixel"))
    var failures = 0
    var checks = 0
    func expect(_ ok: Bool, _ what: String) { checks += 1; if !ok { failures += 1; print("FAIL", what) } else { print("ok  ", what) } }
    for (size, scale, w, h) in [(Size.tiny, 2.0, 105, 96), (.tiny, 1.0, 35, 32), (.small, 2.0, 140, 128), (.medium, 2.0, 206, 192), (.large, 2.0, 274, 256), (.large, 1.0, 137, 128)] {
        let image = frames.image("idle-reading", size: size, scale: CGFloat(scale))
        expect(image?.width == w && image?.height == h, "\(size) @\(Int(scale))x is \(w)x\(h) px (got \(image?.width ?? -1)x\(image?.height ?? -1))")
    }
    let pt = frames.size(.tiny, scale: 2)
    expect(pt == NSSize(width: 52.5, height: 48), "Extra small is 52.5 x 48 pt (got \(pt))")
    // Every art pixel becomes an exact 3x3 block of its own colour on a Retina screen.
    let source = NSImage(contentsOf: root.appendingPathComponent("pixel/01-idle-reading.png"))!.cgImage(forProposedRect: nil, context: nil, hints: nil)!
    func rgba(_ image: CGImage) -> [UInt8] {
        var data = [UInt8](repeating: 0, count: image.width * image.height * 4)
        let context = CGContext(data: &data, width: image.width, height: image.height, bitsPerComponent: 8, bytesPerRow: image.width * 4,
                                space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
        return data
    }
    let big = frames.image("idle-reading", size: .tiny, scale: 2)!
    let a = rgba(source), b = rgba(big)
    var off = 0
    for y in 0..<big.height { for x in 0..<big.width {
        let i = (y * big.width + x) * 4, j = ((y / 3) * source.width + (x / 3)) * 4
        if x / 3 < source.width { for c in 0..<4 where abs(Int(a[j + c]) - Int(b[i + c])) > 1 { off += 1 } }
        else if b[i + 3] != 0 { off += 1 }
    } }
    expect(off == 0, "3x blocks copy each art pixel exactly (\(off) channels off)")
    frames.keep(.tiny, scale: 2)
    expect(frames.image("idle-reading", size: .tiny, scale: 2) === big, "keep(.tiny) keeps the pixel pictures")
    let moment = 100_000.0
    expect(ComeBack.wanted(.reopen, summon: 0, answered: moment, now: moment), "explicit reopen always comes back")
    expect(ComeBack.wanted(.launch(login: false), summon: 0, answered: 0, now: moment), "explicit launch comes back")
    expect(!ComeBack.wanted(.launch(login: true), summon: moment - 15_001, answered: 0, now: moment), "login preserves hide for an old summon")
    expect(ComeBack.wanted(.launch(login: true), summon: moment - 15_000, answered: 0, now: moment), "login answers summon inside 15 seconds")
    expect(!ComeBack.wanted(.feed, summon: moment, answered: moment, now: moment), "answered summon is not repeated")
    expect(ComeBack.wanted(.feed, summon: moment + 1, answered: moment, now: moment + 1), "new summon answers")

    let first = Requests(["follow": 90_000.0, "settings": 90_000.0, "size": ["to": "tiny", "at": 10.0], "login": ["on": true, "at": 20.0]])
    var newest = first
    newest.merge(Requests(["follow": 80_000.0, "size": ["to": "large", "at": 9.0], "login": ["on": false, "at": 19.0]]))
    expect(newest == first, "older session requests cannot replace any newest request")
    newest.merge(Requests(["follow": 91_000.0, "settings": 92_000.0, "size": ["to": "small", "at": 11.0], "login": ["on": false, "at": 21.0]]))
    expect(newest.follow == 91_000 && newest.settings == 92_000 && newest.size?.to == .small && newest.login?.on == false, "each newest request wins across sessions")
    for key in ["size", "login"] {
        expect(!Requests.wants(20, after: 20, launch: false, now: moment), "equal \(key) request leaves current choice")
        expect(!Requests.wants(19, after: 20, launch: false, now: moment), "stale \(key) request leaves current choice")
        expect(Requests.wants(21, after: 20, launch: false, now: moment), "newer \(key) request applies")
    }
    expect(Requests.wants(85_000, after: 0, launch: true, now: moment), "follow at launch includes 15-second boundary")
    expect(!Requests.wants(84_999, after: 0, launch: true, now: moment), "follow at launch rejects older request")
    expect(!Requests.wants(100_001, after: 0, launch: true, now: moment), "follow at launch rejects future request")
    expect(!Requests.wants(90_000, after: 90_000, launch: false, now: moment), "answered follow is not repeated")
    expect(Requests.wants(10, after: 0, launch: false, now: moment), "live follow is not subject to launch age limit")
    expect(Requests(["size": ["to": "giant", "at": 1], "follow": Double.infinity]).size == nil, "malformed size and timestamps ignored")
    expect(CardOffer.shouldOffer(trusted: false, offered: "old", build: "new", visible: true), "visible not-allowed build gets offer")
    expect(!CardOffer.shouldOffer(trusted: true, offered: "old", build: "new", visible: true), "trusted never gets offer")
    expect(!CardOffer.shouldOffer(trusted: false, offered: "new", build: "new", visible: true), "same build never offers again")
    expect(!CardOffer.shouldOffer(trusted: false, offered: "old", build: "new", visible: false), "invisible pet never gets offer")

    var events: [String] = []
    var trusted = false
    var complete: (() -> Void)?
    var delayed: (() -> Void)?
    let permission = FollowPermission(effects: .init(trusted: { trusted }, run: { executable, arguments, timeout, done in
        expect(executable == "/usr/bin/tccutil" && arguments == ["reset", "Accessibility", LoginAgent.label] && timeout == 5, "reset targets only his own entry, with five-second limit")
        events.append("reset"); complete = done
    }, prompt: { events.append("prompt") }, later: { delay, action in
        expect(delay == 0.4, "settings opens 0.4 seconds after prompt")
        delayed = action
    }, open: { url in events.append(url == FollowPermission.settingsURL ? "url" : "app"); return true }))
    permission.request(at: moment)
    permission.request(at: moment + 1)
    expect(events == ["reset"], "in-flight duplicate does not reset or open early")
    complete?()
    expect(events == ["reset", "prompt"], "prompt follows reset completion")
    delayed?()
    expect(events == ["reset", "prompt", "url"], "order is reset then prompt then URL")
    permission.request(at: moment + 599_999)
    expect(events == ["reset", "prompt", "url", "url"], "second press inside ten minutes only reopens Settings")
    permission.request(at: moment + 600_000)
    expect(events.last == "reset" && events.filter { $0 == "reset" }.count == 2, "ten-minute boundary allows a new reset")
    complete?(); delayed?()
    trusted = true
    let before = events
    permission.request(at: moment + 1_200_000)
    expect(events == before, "trusted click never resets, prompts, or opens")
    let fallback = FollowPermission(effects: .init(trusted: { false }, run: { _, _, _, done in done() }, prompt: {}, later: { _, action in action() }, open: { url in
        events.append(url == FollowPermission.settingsURL ? "url" : "app"); return url != FollowPermission.settingsURL
    }))
    fallback.openSettings()
    expect(Array(events.suffix(2)) == ["url", "app"], "failed pane URL falls back to System Settings itself")
    let read = Record(["session": "check", "at": moment, "follow": 90_000.0, "size": ["to": "tiny", "at": 10.0], "words": ["thanks": "custom thanks", "offerTitle": "custom title"]])!
    expect(read.words.thanks == "custom thanks" && read.words.offerTitle == "custom title" && read.words.yes == "Yes, follow it", "new words parse with English defaults")
    expect(read.requests.follow == 90_000 && read.requests.size?.to == .tiny, "record parses requests")
    if CommandLine.arguments.count > 3 {
        let expected = try! String(contentsOfFile: CommandLine.arguments[2], encoding: .utf8)
        expect(LoginAgent.plist(executable: CommandLine.arguments[3]) == expected, "Swift plist is byte-for-byte identical to script output")
    }
    expect(!Requests.wants(90_000, after: 91_000, launch: true, now: moment), "persisted or direct-click follow rejects older retained request")
    expect(Requests.wants(92_000, after: 91_000, launch: true, now: moment), "new follow after persisted or direct-click request applies")
    let scratch = FileManager.default.temporaryDirectory.appendingPathComponent("companion-native-" + UUID().uuidString)
    try! FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: true)
    let savedURL = scratch.appendingPathComponent("companion.json")
    let saved = Store(url: savedURL)
    saved.running = true; saved.answered = 123; saved.offered = "test-build"
    saved.sizeAt = 234; saved.loginAt = 345; saved.followAt = 456; saved.login = true
    saved.linesHidden = true; saved.seenAt = 567
    saved.askedFor = "previous"; saved.full = CGPoint(x: 0.3, y: 0.4)
    saved.manual = .screen(x: 0.1, y: 0.2); saved.hiddenUntil = 789
    saved.save()
    let json = try! JSONSerialization.jsonObject(with: Data(contentsOf: savedURL)) as! [String: Any]
    let keys = ["pid", "version", "accessibility", "size", "hiddenUntil", "askedFor", "build", "freeX", "freeY", "manual", "running", "answered", "offered", "sizeAt", "loginAt", "followAt", "login", "linesHidden", "seenAt"]
    expect(keys.allSatisfy { json[$0] != nil }, "store keeps all old keys and writes every new field")
    let reread = Store(url: savedURL)
    expect(reread.answered == 123 && reread.offered == "test-build" && reread.sizeAt == 234 && reread.loginAt == 345 && reread.followAt == 456 && reread.login, "store restores request clocks and build offer")
    expect(reread.linesHidden && reread.seenAt == 567, "store restores linesHidden and Activity's seenAt clock")
    saved.running = false; saved.save()
    let stopped = try! JSONSerialization.jsonObject(with: Data(contentsOf: savedURL)) as! [String: Any]
    expect(stopped["running"] as? Bool == false, "termination status persists false")
    let scratchAgent = LoginAgent.url(home: scratch)
    try! FileManager.default.createDirectory(at: scratchAgent.deletingLastPathComponent(), withIntermediateDirectories: true)
    let sentinel = LoginAgent.plist(executable: "/old/path")
    try! sentinel.write(to: scratchAgent, atomically: true, encoding: .utf8)
    try! LoginAgent.set(true, home: scratch, executable: "/Pretend.app/Contents/MacOS/Companion")
    try! LoginAgent.repair(home: scratch, executable: "/new/path")
    try! LoginAgent.set(false, home: scratch, executable: "/new/path")
    expect((try? String(contentsOf: scratchAgent, encoding: .utf8)) == sentinel,
           "non-bundle executable never installs, repairs, or removes an existing scratch login agent")
    let missingAgentHome = scratch.appendingPathComponent("no-agent")
    try! LoginAgent.set(true, home: missingAgentHome, executable: "/Pretend.app/Contents/MacOS/Companion")
    expect(!FileManager.default.fileExists(atPath: LoginAgent.url(home: missingAgentHome).path),
           "non-bundle executable never creates a login agent in a scratch home")
    expect(!LoginAgent.isInstalledBundle, "native scratch executable fails the runtime installed-bundle guard")
    expect(LoginAgent.installedBundle(bundleIdentifier: LoginAgent.label, executable: "/Applications/Companion.app/Contents/MacOS/Companion"),
           "installed-bundle identity accepts matching id and app-contained executable")
    expect(!LoginAgent.installedBundle(bundleIdentifier: "another.app", executable: "/Applications/Companion.app/Contents/MacOS/Companion")
           && !LoginAgent.installedBundle(bundleIdentifier: LoginAgent.label, executable: "/tmp/check")
           && !LoginAgent.installedBundle(bundleIdentifier: LoginAgent.label, executable: "/tmp/Fake.appish/check"),
           "installed-bundle identity rejects wrong id, plain executable, and app-like path component")
    // The production timeout runner gets a scratch sleep child, never tccutil or the app.
    let stub = scratch.appendingPathComponent("reset-stub")
    let pidFile = scratch.appendingPathComponent("reset-child.pid")
    try! "#!/bin/sh\necho $$ > \"$1\"\nexec /bin/sleep 10\n".write(to: stub, atomically: true, encoding: .utf8)
    try! FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: stub.path)
    var finished = false
    var completedOnMain = false
    let begun = Date()
    FollowPermission.runReset("/bin/sh", [stub.path, pidFile.path], 0.25) {
        completedOnMain = Thread.isMainThread
        finished = true
    }
    let deadline = Date().addingTimeInterval(2)
    while !finished && Date() < deadline { _ = RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.02)) }
    expect(finished && completedOnMain && Date().timeIntervalSince(begun) < 2, "reset runner times out its scratch child and completes on main")
    if let text = try? String(contentsOf: pidFile, encoding: .utf8), let pid = Int32(text.trimmingCharacters(in: .whitespacesAndNewlines)) {
        var status: Int32 = 0
        expect(waitpid(pid, &status, WNOHANG) == -1 && errno == ECHILD, "timed-out reset child is already reaped before completion")
    } else { expect(false, "scratch reset child wrote its pid") }
    var activityTable: [String: [String: Any]] = [:]
    var hoverTable: [String: [String: Any]] = [:]
    if CommandLine.arguments.count > 4 {
        let data = try! Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[4]))
        let wordsJSON = try! JSONSerialization.jsonObject(with: data) as! [String: Any]
        let dictionaries = wordsJSON["card"] as! [String: [String: String]]
        activityTable = wordsJSON["activity"] as? [String: [String: Any]] ?? [:]
        hoverTable = wordsJSON["hover"] as? [String: [String: Any]] ?? [:]
        expect(activityTable.count == 12, "native Activity receives all twelve actual translation tables")
        for (lang, dictionary) in dictionaries.sorted(by: { $0.key < $1.key }) {
            let words = Record(["session": "test", "at": 1.0, "words": dictionary])!.words
            for width: CGFloat in [264, 240] {
                for waiting in [false, true] {
                    let body = NSTextField(wrappingLabelWithString: "")
                    body.attributedStringValue = CardView.text(waiting ? words.waitBody : words.offerBody, size: 12.5, lineHeight: 17, bold: false, lang: lang)
                    let measured = body.cell!.cellSize(forBounds: NSRect(x: 0, y: 0, width: width - 24, height: 1000))
                    let view = CardView()
                    let extent = view.fit(words: words, lang: lang, waiting: waiting, width: width)
                    expect(measured.height <= 102 && extent.width <= width, "\(lang) \(waiting ? "waiting" : "offer") fits six body lines at \(Int(width)) pt")
                    expect(view.primary.fittedWidth <= view.primary.frame.width && view.secondary.fittedWidth <= view.secondary.frame.width && view.primary.frame.maxX <= width - 12 && view.secondary.frame.maxX <= width - 12 && view.secondary.frame.maxY <= extent.height - 12, "\(lang) card buttons stay inside at \(Int(width)) pt")
                }
            }
        }
    }
    followupChecks(frames: frames, expect: expect)
    speechTypographyChecks(expect: expect)
    aroundViewChecks(scratch: scratch, activityTable: activityTable, expect: expect)
    hoverLabelChecks(scratch: scratch, hoverTable: hoverTable, expect: expect)
    activityCallerChecks(scratch: scratch, expect: expect)
    aroundHimChecks(scratch: scratch, expect: expect)
    print("native checks: \(checks) checks, \(failures) failures")
    return failures == 0 ? 0 : 1
}
@MainActor
func followupChecks(frames: Frames, expect: (Bool, String) -> Void) {
    for (line, ending) in [("so warm\n>_<", ">_<"), ("a different line\n>_<", ">_<"),
                           ("好暖\nT_T", "T_T"), ("ありがとう\n@_@", "@_@"),
                           ("hello\n(>_<)", ">_<"), ("hello\n（>_<）", ">_<"),
                           ("still on the line ✨", "✨")] {
        expect(Reactor.ending(line) == ending, "reaction ending reads \(ending) after a newline or space")
    }
    let tooFast = Reactor.ending("too fast\n>_<")
    let crookedBow = Reactor.ending("my bow's crooked now\n(*´ω`*)")
    let squish = Reactor.ending("squish\n>_<")
    expect(tooFast == ">_<", "too fast newline ending is exactly >_<")
    expect(crookedBow == "*´ω`*", "crooked bow ending drops brackets around *´ω`*")
    expect(squish == tooFast, "squish and too fast share the same newline face")
    expect(crookedBow != tooFast && crookedBow != squish, "crooked bow face differs from both >_< endings")
    var reactor = Reactor()
    let lines = ["pat": ["first\n>_<", "same face\n>_<", "other face\nT_T"]]
    let first = reactor.react(.click(option: false), at: 0, mood: "idle", lines: lines, random: 0)
    let second = reactor.react(.click(option: false), at: 2, mood: "idle", lines: lines, random: 0)
    expect(first.line == "first\n>_<" && second.line == "other face\nT_T", "reaction selection avoids the prior newline ending")

    let speech = SpeechView()
    let one = speech.fit("hello >_<", maxWidth: 280, maxHeight: 200)
    let two = speech.fit("hello\n>_<", maxWidth: 280, maxHeight: 200)
    let lineHeight = ceil(SpeechView.font(speech.fontSize).ascender - SpeechView.font(speech.fontSize).descender + SpeechView.font(speech.fontSize).leading)
    expect(two.height >= one.height + lineHeight - 1 && two.height <= one.height + lineHeight + 1,
           "SpeechView measures an explicit newline as two lines")
    let field = speech.subviews.compactMap { $0 as? NSTextField }.first
    expect(field?.stringValue == "hello\n>_<" && field?.lineBreakMode == .byWordWrapping && field?.maximumNumberOfLines == 5,
           "SpeechView keeps newline text, wraps, and allows at most five lines")
    let narrow = speech.fit("a longer sentence that wraps over several words\n>_<", maxWidth: 100, maxHeight: 200)
    expect(narrow.width <= 100 && narrow.height > two.height, "speech wraps the sentence without losing the ending's newline")
    let capped = speech.fit("one\ntwo\nthree\nfour\nfive\nsix", maxWidth: 280, maxHeight: 200)
    expect(capped.height <= 5 * lineHeight + 10 && field?.maximumNumberOfLines == 5, "speech retains its five-line height cap")

    func blink(mood: String = "idle", frame: String = "idle-reading", hasLoop: Bool = false,
               reacting: Bool = false, visible: Bool = true, unoccluded: Bool = true, reduceMotion: Bool = false) -> Bool {
        IdleBlink.wanted(mood: mood, frame: frame, hasLoop: hasLoop, reacting: reacting,
                         visible: visible, unoccluded: unoccluded, reduceMotion: reduceMotion)
    }
    expect(blink(), "visible unoccluded idle-reading gets the idle blink")
    for mood in ["sleep", "waiting", "question", "work", "think", "happy", "error"] {
        expect(!blink(mood: mood), "\(mood) never gets the idle blink")
    }
    expect(!blink(frame: "idle-blink"), "a supplied non-reading still never gets another blink")
    expect(!blink(frame: "sleep"), "sleep frame never blinks even when mood is idle")
    expect(!blink(hasLoop: true), "a supplied mood loop takes precedence over blinking")
    expect(!blink(reacting: true), "a live mouse or come-back reaction suspends blinking")
    expect(!blink(visible: false), "hidden pet has no idle animation")
    expect(!blink(unoccluded: false), "covered pet has no idle animation")
    expect(!blink(reduceMotion: true), "Reduce Motion removes the idle animation")
    expect(IdleBlink.duration == 16 && IdleBlink.shuts == [3.8, 8.9, 9.22, 13.6] && IdleBlink.shutFor == 0.14,
           "blink schedule is four specified 140ms blinks in sixteen seconds")
    expect(IdleBlink.times.count == IdleBlink.closed.count + 1 && IdleBlink.times.first == 0 && IdleBlink.times.last == 16,
           "discrete key times bracket all intervals and the full cycle")
    let closeIndices = IdleBlink.closed.indices.filter { IdleBlink.closed[$0] }
    expect(closeIndices.map { IdleBlink.times[$0] } == IdleBlink.shuts, "closed intervals start at each requested time")
    expect(closeIndices.allSatisfy { abs(IdleBlink.times[$0 + 1] - IdleBlink.times[$0] - 0.14) < 0.000_001 },
           "each closed interval lasts exactly 140ms")
    expect(zip(IdleBlink.times, IdleBlink.times.dropFirst()).allSatisfy { $0 < $1 }, "blink key times strictly increase")
    let layer = CALayer()
    let open = frames.image("idle-reading", size: .medium, scale: 2)!
    let shut = frames.image("idle-blink", size: .medium, scale: 2)!
    var cached: String?
    func updateLayerBlink(reacting: Bool = false, reduceMotion: Bool = false) {
        let wanted = blink(reacting: reacting, reduceMotion: reduceMotion) ? "idle-blink|medium|2" : nil
        if FrameLoop.prepare(on: layer, wanted: wanted, cached: &cached), let wanted {
            layer.add(IdleBlink.animation(open: open, shut: shut), forKey: "loop")
            cached = wanted
        }
    }
    updateLayerBlink()
    expect(layer.animation(forKey: "loop") != nil && cached != nil, "frame loop installs idle blink on the actual layer")
    cached = nil // react() invalidates before draw(), while the layer still has the animation.
    updateLayerBlink(reacting: true)
    expect(layer.animation(forKey: "loop") == nil && cached == nil, "reaction removes installed blink even after cache invalidation")
    updateLayerBlink()
    expect(layer.animation(forKey: "loop") != nil && cached != nil, "reaction ending restores the idle blink")
    cached = nil // displayOptionsMoved() also invalidates before drawing with Reduce Motion.
    updateLayerBlink(reduceMotion: true)
    expect(layer.animation(forKey: "loop") == nil && cached == nil, "Reduce Motion removes installed blink despite invalidated cache")
    updateLayerBlink()
    expect(layer.animation(forKey: "loop") != nil && cached != nil, "turning Reduce Motion off restores the idle blink")
    layer.removeAnimation(forKey: "loop")
    updateLayerBlink()
    expect(layer.animation(forKey: "loop") != nil, "missing layer animation is repaired even when the cached key matches")

    for size in Size.allCases {
        for scale: CGFloat in [1, 2] {
            let open = frames.image("idle-reading", size: size, scale: scale)!
            let shut = frames.image("idle-blink", size: size, scale: scale)!
            let animation = IdleBlink.animation(open: open, shut: shut)
            expect(animation.keyPath == "contents" && animation.calculationMode == .discrete && animation.duration == 16
                   && animation.repeatCount == .infinity && animation.values?.count == 9 && animation.keyTimes?.count == 10,
                   "\(size.rawValue) at \(Int(scale))x builds the repeating discrete contents animation")
            let images = animation.values as! [CGImage]
            expect(images.enumerated().allSatisfy { $0.element === (IdleBlink.closed[$0.offset] ? shut : open) },
                   "\(size.rawValue) at \(Int(scale))x uses the matching cached open and closed frames")
        }
    }
}

@MainActor
func speechTypographyChecks(expect: (Bool, String) -> Void) {
    func originalFont(_ size: CGFloat) -> NSFont {
        let base = NSFont.systemFont(ofSize: size)
        return base.fontDescriptor.withDesign(.serif).flatMap { NSFont(descriptor: $0, size: size) } ?? base
    }
    func shaped(_ value: String, font: NSFont, compact: Bool = false) -> (width: Double, faces: [String], missing: Bool, advances: [Double], halfWidth: Bool) {
        let attributed = compact ? SpeechView.attributedLine(value, fontSize: font.pointSize)
            : NSAttributedString(string: value, attributes: [.font: font])
        let line = CTLineCreateWithAttributedString(attributed)
        let runs = CTLineGetGlyphRuns(line) as! [CTRun]
        var missing = false
        var advances: [Double] = []
        var halfWidth = false
        let faces = runs.map { run -> String in
            var glyphs = [CGGlyph](repeating: 0, count: CTRunGetGlyphCount(run))
            CTRunGetGlyphs(run, CFRange(location: 0, length: 0), &glyphs)
            var widths = [CGSize](repeating: .zero, count: glyphs.count)
            CTRunGetAdvances(run, CFRange(location: 0, length: 0), &widths)
            advances += widths.map { Double($0.width) }
            missing = missing || glyphs.contains(0)
            let attributes = CTRunGetAttributes(run) as NSDictionary
            let actual = attributes[kCTFontAttributeName] as! CTFont
            let features = CTFontCopyFeatureSettings(actual) as? [[String: Any]] ?? []
            halfWidth = halfWidth || features.contains {
                ($0[kCTFontFeatureTypeIdentifierKey as String] as? Int) == kTextSpacingType
                    && ($0[kCTFontFeatureSelectorIdentifierKey as String] as? Int) == kHalfWidthTextSelector
            }
            return CTFontCopyPostScriptName(actual) as String
        }
        return (CTLineGetTypographicBounds(line, nil, nil, nil), faces, missing, advances, halfWidth)
    }
    var metrics: [[String: Any]] = []
    for size in Set(Size.allCases.map { $0.fontSize }).sorted() {
        let before = originalFont(size), after = SpeechView.font(size)
        for mark in ["，", "、", "？", "！", "。", "「", "」", "（", "）", "：", "；"] {
            let old = shaped(mark, font: before), new = shaped(mark, font: after, compact: true)
            print(String(format: "advance %.0f pt %@: %.6f -> %.6f pt; %@ -> %@", size, mark, old.width, new.width,
                         old.faces.joined(separator: ","), new.faces.joined(separator: ",")))
            expect(abs(new.width - Double(size) / 2) < 0.01 && new.width < old.width && !new.missing && new.halfWidth,
                   "\(mark) uses a real half-width glyph at \(Int(size)) pt")
            metrics.append(["size": size, "text": mark, "before": old.width, "after": new.width,
                            "beforeFaces": old.faces, "afterFaces": new.faces, "halfWidthFeature": new.halfWidth])
        }
        for value in ["漢字", "あいう", "hello bug 123", "(*´ω`*)", "(´･ω･`)"] {
            let old = shaped(value, font: before), new = shaped(value, font: after, compact: true)
            expect(abs(old.width - new.width) < 0.01 && !new.missing, "\(value) keeps its advance at \(Int(size)) pt")
            if value == "hello bug 123" { expect(old.faces == new.faces, "Latin keeps the original system serif") }
        }
        for (value, punctuation) in [("漢，漢", "，"), ("あ、あ", "、"), ("本？本", "？")] {
            let old = shaped(value, font: before), new = shaped(value, font: after, compact: true)
            // Baseline CJK auto-spacing can make the contextual mark wider than its isolated glyph.
            // Check the actual three advances, not an inferred delta from the isolated measurement.
            let expected = [Double(size), Double(size) / 2, Double(size)]
            expect(new.advances.count == 3 && zip(new.advances, expected).allSatisfy { abs($0 - $1) < 0.01 }
                   && old.advances.first == new.advances.first && old.advances.last == new.advances.last
                   && abs(new.width - Double(size) * 2.5) < 0.01 && !new.missing && new.halfWidth,
                   "contextual \(value) compacts only its punctuation at \(Int(size)) pt")
            print("context \(Int(size)) pt \(value): \(old.width) -> \(new.width) pt; advances \(old.advances) -> \(new.advances)")
            metrics.append(["size": size, "text": value, "mark": punctuation, "before": old.width, "after": new.width,
                            "beforeAdvances": old.advances, "afterAdvances": new.advances,
                            "beforeFaces": old.faces, "afterFaces": new.faces, "halfWidthFeature": new.halfWidth])
        }
    }
    // The actual view and NSTextField render into bitmaps; no window or app launch is needed.
    let folder = CommandLine.arguments.count > 4
        ? URL(fileURLWithPath: CommandLine.arguments[4]).deletingLastPathComponent().appendingPathComponent("typography")
        : FileManager.default.temporaryDirectory.appendingPathComponent("speech-typography-" + UUID().uuidString)
    do {
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try JSONSerialization.data(withJSONObject: metrics, options: [.prettyPrinted, .sortedKeys])
            .write(to: folder.appendingPathComponent("advances.json"))
        for (lang, value) in [("zh", "太阳当空照,bug也在闹？\n「抱紧我的书」！\n(*´ω`*)"),
                              ("ja", "僕、ちっちゃいんだから？\n「本をぎゅっ」！\n(´･ω･`)")] {
            for (name, appearance) in [("light", NSAppearance.Name.aqua), ("dark", .darkAqua)] {
                let view = SpeechView()
                view.fontSize = 15
                view.appearance = NSAppearance(named: appearance)
                let extent = view.fit(value, maxWidth: 180, maxHeight: 200)
                view.frame.size = extent
                view.updateLayer()
                view.displayIfNeeded()
                let field = view.subviews.compactMap { $0 as? NSTextField }.first!
                expect(field.stringValue == value && field.maximumNumberOfLines <= 5 && extent.width <= 180,
                       "\(lang) \(name) label keeps its text and fit limits")
                let drawn = CTLineCreateWithAttributedString(field.attributedStringValue)
                expect(abs(CTLineGetTypographicBounds(drawn, nil, nil, nil)
                           - shaped(value, font: SpeechView.font(15), compact: true).width) < 0.01,
                       "\(lang) \(name) appearance updates retain the compact font runs")
                let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds)!
                view.cacheDisplay(in: view.bounds, to: bitmap)
                let file = folder.appendingPathComponent("label-\(lang)-\(name).png")
                try bitmap.representation(using: .png, properties: [:])!.write(to: file)
                print("offscreen \(lang) \(name): \(extent.width) x \(extent.height) pt; \(file.path)")
            }
        }
    } catch { expect(false, "offscreen typography artifacts: \(error)") }
}

@MainActor
func aroundViewChecks(scratch: URL, activityTable: [String: [String: Any]], expect: (Bool, String) -> Void) {
    let folder = scratch.appendingPathComponent("around-renders")
    _ = NSApplication.shared // Scratch check host only; no panel is shown or app activated.
    let passivePanel = Panel(clickable: true, shadow: false)
    let activityPanel = ActivityPanel()
    expect(!passivePanel.canBecomeKey && !passivePanel.canBecomeMain && activityPanel.canBecomeKey && !activityPanel.canBecomeMain,
           "Activity is the only companion panel eligible to take the keyboard")
    var escapes = 0; activityPanel.escape = { escapes += 1 }; activityPanel.cancelOperation(nil)
    expect(escapes == 1, "Activity panel routes Esc to its close action")
    passivePanel.close(); activityPanel.close()
    let returnField = ActivityField()
    let editor = NSTextView(); editor.isFieldEditor = true; editor.string = "scratch instruction"
    var sends = 0; returnField.send = { sends += 1 }
    returnField.textDidEndEditing(Notification(name: NSText.didEndEditingNotification, object: editor,
                                              userInfo: ["NSTextMovement": NSReturnTextMovement]))
    expect(sends == 1, "Activity field Return routes once to Send")
    returnField.textDidEndEditing(Notification(name: NSText.didEndEditingNotification, object: editor,
                                              userInfo: ["NSTextMovement": NSTabTextMovement]))
    expect(sends == 1, "Activity field Tab never sends an instruction")
    do {
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        func render(_ view: NSView, name: String, appearance: NSAppearance.Name) throws {
            let host = NSView(frame: NSRect(origin: .zero, size: view.frame.size))
            host.appearance = NSAppearance(named: appearance)
            host.addSubview(view) // Exercise inherited light/dark while keeping deliberate control appearances.
            view.needsDisplay = true; view.displayIfNeeded()
            guard let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) else {
                expect(false, "\(name) creates a bitmap"); return
            }
            view.effectiveAppearance.performAsCurrentDrawingAppearance {
                view.cacheDisplay(in: view.bounds, to: bitmap)
            }
            if let card = view as? ActivityView, !card.field.isHidden {
                expect(card.field.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .aqua
                       && card.target.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .aqua,
                       "\(name) native field/menu stay legible on Activity's cream paper")
                let point = card.field.frame
                let pixel = bitmap.colorAt(x: Int(point.maxX - 7), y: Int(point.midY))?.usingColorSpace(.sRGB)
                expect((pixel?.redComponent ?? 0) > 0.8 && (pixel?.greenComponent ?? 0) > 0.8,
                       "\(name) field keeps light paper behind its dark ink")
            }
            let file = folder.appendingPathComponent(name + ".png")
            try bitmap.representation(using: .png, properties: [:])!.write(to: file)
            print("offscreen around: \(file.path)")
        }
        for (lang, project, task) in [("en", "atlas", "reading Pet.swift"), ("zh", "atlas", "在读Pet.swift"), ("ja", "atlas", "Pet.swiftを読んでいる")] {
            for (name, appearance) in [("light", NSAppearance.Name.aqua), ("dark", .darkAqua)] {
                let bubble = BubbleView()
                let size = bubble.fit(project: project, task: task, lang: lang)
                expect(size.height == 22 && size.width <= 260 && bubble.accessibilityLabel() == project + " · " + task,
                       "\(lang) \(name) bubble keeps 22pt height, width cap and full VoiceOver words")
                try render(bubble, name: "bubble-\(lang)-\(name)", appearance: appearance)
            }
        }
        let longBubble = BubbleView()
        expect(longBubble.fit(project: "a long project name", task: String(repeating: "reading ", count: 20), lang: "en").width == 260,
               "long task bubble truncates at 260pt width")
        for (name, appearance) in [("light", NSAppearance.Name.aqua), ("dark", .darkAqua)] {
            let hover = HoverView(); hover.configure(words: Record.Words(), hidden: true, unseen: 2)
            expect(hover.buttons.count == 5 && hover.buttons.allSatisfy { $0.frame.width == 24 && $0.frame.height == 24 }
                   && hover.buttons[0].dot && !hover.buttons[2].stroke && hover.buttons.allSatisfy { $0.toolTip == nil },
                   "\(name) hover has five 24pt buttons, unseen dot, plain hidden-lines glyph and no system tooltips")
            expect(zip(hover.buttons, ["Activity", "Back to Claude", "Show his lines", "Hide for an hour", "Size"]).allSatisfy { $0.accessibilityLabel() == $1 },
                   "\(name) hover buttons expose the same localized names to VoiceOver")
            try render(hover, name: "hover-\(name)", appearance: appearance)
        }
        let special: [(String, [String: String], String)] = [
            ("en", ["activity": "Activity", "waitingOK": "waiting for your OK", "finished": "finished"], "Done: all checks pass. The parser keeps comments attached to the next node."),
            ("zh", ["activity": "活动", "waitingOK": "等你同意", "finished": "做完了", "placeholder": "在{project}里跟Claude说...", "newChat": "新对话", "confirmClear": "清空{project}里的这段对话?", "cancel": "取消", "clear": "清空"], "好了:测试都通过,解析器现在会把注释留在下一个节点上"),
            ("ja", ["activity": "アクティビティ", "waitingOK": "許可待ち", "finished": "終わった", "placeholder": "{project}でClaudeに伝える...", "newChat": "新しいチャット", "confirmClear": "{project}の会話を消す?", "cancel": "やめる", "clear": "消す"], "できた:テストがすべて通った。パーサーはコメントを次のノードに残すようになった")
        ]
        for lang in activityTable.keys.sorted() {
            let sample = special.first { $0.0 == lang }
            var words: [String: Any] = sample?.1 ?? [:]
            words.merge(activityTable[lang] ?? [:]) { _, actual in actual }
            let excerpt = sample?.2 ?? "Done: the parser keeps comments attached to the next node."
            let chosen = Record(["session": "first", "project": "atlas", "at": Date().timeIntervalSince1970 * 1000,
                                 "lang": lang, "channel": true, "words": words])!
            let nativeWords = Dictionary(uniqueKeysWithValues: Mirror(reflecting: chosen.words).children.compactMap { item -> (String, String)? in
                guard let key = item.label, let value = item.value as? String else { return nil }; return (key, value)
            })
            expect((activityTable[lang] ?? [:]).allSatisfy { key, value in nativeWords[key] == value as? String },
                   "\(lang) Activity parses every actual translated word")
            var other = chosen; other.session = "second"; other.project = "site"
            let rows = [ActivityRow(record: chosen, state: chosen.words.waitingOK, unseen: true, excerpt: nil),
                        ActivityRow(record: other, state: chosen.words.finished, unseen: true, excerpt: excerpt),
                        ActivityRow(record: chosen, state: chosen.words.finished, unseen: false, excerpt: nil)]
            let keyboardRow = ActivityRowButton(row: rows[0]); var rowPresses = 0
            keyboardRow.pressed = { rowPresses += 1 }
            for (code, characters) in [(UInt16(36), "\r"), (UInt16(76), "\u{3}")] {
                let event = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [], timestamp: 0,
                                            windowNumber: 0, context: nil, characters: characters,
                                            charactersIgnoringModifiers: characters, isARepeat: false, keyCode: code)!
                keyboardRow.keyDown(with: event)
            }
            expect(rowPresses == 2, "\(lang) Activity row Return and keypad Enter activate its action")
            for (name, appearance) in [("light", NSAppearance.Name.aqua), ("dark", .darkAqua)] {
                let card = ActivityView()
                let size = card.fit(rows: rows, sessions: [chosen], chosen: chosen, confirming: false, status: nil, pending: false)
                expect(size.width == 300 && card.target.isHidden && !card.field.isHidden
                       && card.field.accessibilityLabel()?.contains("atlas") == true,
                       "\(lang) \(name) Activity is 300pt and labels its single-session field")
                expect(card.field.acceptsFirstResponder && card.mic.acceptsFirstResponder && card.send.acceptsFirstResponder
                       && card.newChat.acceptsFirstResponder && card.close.acceptsFirstResponder
                       && card.subviews.compactMap { $0 as? ActivityRowButton }.allSatisfy { $0.acceptsFirstResponder },
                       "\(lang) \(name) Activity field, rows and buttons are keyboard eligible")
                expect(card.field.nextKeyView === card.mic && card.mic.nextKeyView === card.send
                       && card.send.nextKeyView === card.newChat && card.newChat.nextKeyView === card.close,
                       "\(lang) \(name) Activity field and action buttons follow visible Tab order")
                let controls = card.subviews.filter { !$0.isHidden }
                expect(controls.allSatisfy { card.bounds.contains($0.frame) },
                       "\(lang) \(name) Activity visible controls stay inside its paper")
                try render(card, name: "activity-\(lang)-\(name)", appearance: appearance)
            }
            let confirm = ActivityView()
            _ = confirm.fit(rows: [], sessions: [chosen], chosen: chosen, confirming: true, status: nil, pending: false)
            expect(confirm.cancel.keyEquivalent == "\r" && confirm.clear.keyEquivalent.isEmpty
                   && confirm.field.isHidden && confirm.newChat.isHidden && !confirm.cancel.isHidden,
                   "\(lang) New chat replaces foot with one confirmation and Cancel as Return default")
            try render(confirm, name: "activity-confirm-\(lang)", appearance: .aqua)
            let multi = ActivityView(); multi.field.stringValue = "keep what I typed"
            _ = multi.fit(rows: rows, sessions: [chosen, other], chosen: chosen, confirming: false, status: chosen.words.sending, pending: true)
            expect(!multi.target.isHidden && multi.target.itemArray.count == 2 && !multi.field.isEnabled && !multi.send.isEnabled,
                   "\(lang) multiple sessions expose target menu and disable sending while pending")
            _ = multi.fit(rows: rows, sessions: [chosen, other], chosen: chosen, confirming: false, status: chosen.words.unconfirmed, pending: false)
            expect(multi.field.stringValue == "keep what I typed" && multi.field.isEnabled,
                   "\(lang) error foot restores editing while retaining the field text")
            try render(multi, name: "activity-error-multi-\(lang)", appearance: .aqua)
            _ = multi.fit(rows: rows, sessions: [chosen, other], chosen: chosen, confirming: false,
                          status: chosen.words.unconfirmed, pending: false, retryKind: .submit)
            expect(multi.send.isEnabled && multi.send.accessibilityLabel() == chosen.words.retry
                   && multi.field.stringValue == "keep what I typed" && multi.field.isEnabled,
                   "S2_\(lang)_unconfirmed_submit_exposes_retry_and_retains_editable_text")
            try render(multi, name: "activity-unconfirmed-retry-\(lang)", appearance: .aqua)
            _ = multi.fit(rows: rows, sessions: [chosen, other], chosen: chosen, confirming: false,
                          status: chosen.words.expired, pending: false, retryKind: .submit, expired: true)
            expect(!multi.send.isEnabled && multi.field.isEnabled && multi.field.stringValue == "keep what I typed",
                   "S2_\(lang)_expired_submit_disables_same_retry_but_keeps_text_editable")
            try render(multi, name: "activity-expired-retry-\(lang)", appearance: .aqua)
            _ = confirm.fit(rows: [], sessions: [chosen], chosen: chosen, confirming: true,
                            status: chosen.words.unconfirmed, pending: false, retryKind: .clear)
            expect(confirm.clear.isEnabled && confirm.clear.accessibilityLabel() == chosen.words.retry
                   && confirm.cancel.keyEquivalent == "\r" && confirm.clear.keyEquivalent.isEmpty,
                   "S2_\(lang)_unconfirmed_clear_retry_keeps_cancel_as_return_default")
            expect(confirm.clear.fittedWidth <= confirm.clear.frame.width
                   && confirm.cancel.fittedWidth <= confirm.cancel.frame.width
                   && confirm.subviews.filter { !$0.isHidden }.allSatisfy { confirm.bounds.contains($0.frame) },
                   "S2_\(lang)_translated_clear_retry_and_cancel_fit_native_controls")
            try render(confirm, name: "activity-unconfirmed-clear-retry-\(lang)", appearance: .aqua)
            _ = confirm.fit(rows: [], sessions: [chosen], chosen: chosen, confirming: true,
                            status: chosen.words.expired, pending: false, retryKind: .clear, expired: true)
            expect(!confirm.clear.isEnabled && confirm.cancel.isEnabled && confirm.cancel.keyEquivalent == "\r",
                   "S2_\(lang)_expired_clear_disables_retry_and_keeps_cancel_available")
            try render(confirm, name: "activity-expired-clear-retry-\(lang)", appearance: .aqua)

            var unavailable = chosen; unavailable.channel = false
            let oldCard = ActivityView()
            _ = oldCard.fit(rows: rows, sessions: [unavailable], chosen: unavailable, confirming: false, status: nil, pending: false)
            expect(oldCard.field.isHidden && oldCard.newChat.isHidden
                   && oldCard.subviews.compactMap { $0 as? ActivityRowButton }.count == 3,
                   "\(lang) missing channel keeps rows and omits field and New chat")
            try render(oldCard, name: "activity-rows-only-\(lang)", appearance: .aqua)
        }
        let heldRecord = Record(["session": "held", "project": "atlas", "at": 100.0,
                                 "notice": ["kind": "info", "text": "Needs your attention", "at": 100.0]])!
        let heldRow = ActivityRow(record: heldRecord, state: "Needs your attention", unseen: true, excerpt: nil)
        let placement = Place.Target(mode: .corner, frame: NSRect(x: 1200, y: 20, width: 103, height: 96), number: 0,
                                     window: CGRect(x: 100, y: 100, width: 900, height: 600),
                                     visible: CGRect(x: 0, y: 0, width: 1440, height: 876), screen: CGRect(x: 0, y: 0, width: 1440, height: 900))
        let controller = Activity(rows: [heldRow], sessions: [heldRecord], chosen: heldRecord, target: placement, channel: nil)
        var cleared = heldRecord; cleared.at = 101; cleared.notice = nil
        controller.update(rows: [ActivityRow(record: cleared, state: cleared.words.ready, unseen: false, excerpt: nil)], sessions: [cleared])
        expect(controller.view.subviews.compactMap { $0 as? ActivityRowButton }.first?.row.state == "Needs your attention",
               "open Activity retains notice long enough to read when seen acknowledgement drops it")
        let focusedRow = controller.view.subviews.compactMap { $0 as? ActivityRowButton }.first!
        expect(controller.panel.makeFirstResponder(focusedRow), "unshown Activity row can become its panel's first responder")
        controller.update(rows: [ActivityRow(record: cleared, state: cleared.words.ready, unseen: false, excerpt: nil)], sessions: [cleared])
        let rebuiltRow = controller.view.subviews.compactMap { $0 as? ActivityRowButton }.first!
        expect(rebuiltRow.row.state == "Needs your attention", "held notice survives repeated seen-drop feed updates")
        expect(controller.panel.firstResponder === rebuiltRow && rebuiltRow !== focusedRow,
               "Activity rebuild preserves keyboard focus on the corresponding replacement row")
        var busy = cleared; busy.at = 102; busy.mood = "work"; busy.rest = false; busy.task = "reading Pet.swift"
        controller.update(rows: [ActivityRow(record: busy, state: "reading Pet.swift", unseen: false, excerpt: nil)], sessions: [busy])
        expect(controller.view.subviews.compactMap { $0 as? ActivityRowButton }.first?.row.state == "reading Pet.swift",
               "open Activity refreshes row state for a new task")
        controller.update(rows: [], sessions: [])
        expect(controller.view.subviews.compactMap { $0 as? ActivityRowButton }.isEmpty && controller.view.field.isHidden,
               "open Activity removes ended sessions and their instruction field")
        controller.close() // Its panel was never shown and never activated the application.
        let empty = ActivityView()
        _ = empty.fit(rows: [], sessions: [], chosen: Record.resting, confirming: false, status: nil, pending: false)
        try render(empty, name: "activity-empty", appearance: .aqua)
        let badge = BadgeView(); badge.frame.size = badge.fit(count: 12, words: Record.Words(), lang: "en")
        expect(badge.frame.height == 20 && badge.accessibilityLabel() == "12 new. Opens Activity.",
               "badge keeps true unseen count in VoiceOver with 20pt seal")
        var badgePresses = 0; badge.pressed = { badgePresses += 1 }
        expect(badge.accessibilityPerformPress() && badgePresses == 1, "badge VoiceOver press invokes its Activity action")
        try render(badge, name: "badge-9plus", appearance: .aqua)
    } catch { expect(false, "around-view scratch render: \(error)") }
}

@MainActor
func aroundHimChecks(scratch: URL, expect: (Bool, String) -> Void) {
    let now = 1_000_000.0
    func record(_ session: String = "a", at: Double = 1_000_000, extra: [String: Any] = [:]) -> Record {
        var object: [String: Any] = ["session": session, "at": at, "project": "atlas"]
        object.merge(extra) { _, new in new }
        return Record(object)!
    }
    let old = Record(["session": "old", "at": now])!
    expect(old.project.isEmpty && old.task == nil && old.done == 0 && old.waitAt == 0
           && old.reply == nil && old.notice == nil && old.ack == nil && !old.channel,
           "older mod record survives without any C2 field")
    let fields = record(extra: ["task": "reading Pet.swift", "done": now - 20, "waitAt": now - 10,
                               "reply": ["text": "a reply", "at": now - 20],
                               "notice": ["kind": "info", "text": "a notice", "at": now - 5], "ack": "abc", "channel": true])
    expect(fields.project == "atlas" && fields.task == "reading Pet.swift" && fields.done == now - 20
           && fields.waitAt == now - 10 && fields.reply?.text == "a reply" && fields.notice?.text == "a notice"
           && fields.ack == "abc" && fields.channel, "all C2 feed fields parse by their contract names")
    let wordDefaults: [(String, String)] = [
        ("activity", "Activity"), ("activityMenu", "Activity…"), ("empty", "Nothing yet."),
        ("ready", "ready"), ("finished", "finished"), ("placeholder", "Tell Claude in {project}…"),
        ("send", "Send"), ("sending", "Sending…"), ("unconfirmed", "No confirmation yet"), ("retry", "Retry"), ("expired", "Confirmation window ended"),
        ("dictate", "Dictate"), ("newChat", "New chat"), ("confirmClear", "Clear this conversation in {project}?"),
        ("clear", "Clear"), ("cancel", "Cancel"), ("close", "Close"), ("badge", "{n} new. Opens Activity."),
        ("opens", "Opens Claude."), ("back", "Back to Claude"), ("hideLines", "Hide his lines"), ("showLines", "Show his lines"),
        ("thinking", "thinking"), ("reading", "reading {file}"), ("editing", "editing {file}"), ("running", "running {cmd}"),
        ("searching", "searching"), ("web", "searching the web"), ("helper", "a helper is working"),
        ("planning", "planning"), ("using", "using {tool}"), ("waitingOK", "waiting for your OK"), ("waitingAnswer", "waiting for your answer")]
    let defaultWords = Dictionary(uniqueKeysWithValues: Mirror(reflecting: old.words).children.compactMap { item -> (String, String)? in
        guard let key = item.label, let value = item.value as? String else { return nil }; return (key, value)
    })
    for (key, value) in wordDefaults {
        expect(defaultWords[key] == value, "English default for \(key) matches spec")
        let custom = record(extra: ["words": [key: "custom \(key)"]])
        let reflected = Mirror(reflecting: custom.words).children.first { $0.label == key }?.value as? String
        expect(reflected == "custom \(key)", "session word \(key) overrides its English default")
    }
    var waits = ActivitySessions(seenAt: now - 100, claudeFrontmost: false)
    waits.receive(record(extra: ["mood": "waiting", "rest": false, "waitAt": now - 50, "task": "a task"]), now: now)
    expect(waits.unseenCount(now: now) == 1 && waits.rows(now: now).first?.state == old.words.waitingOK,
           "permission wait after seenAt is unseen and outranks task")
    _ = waits.openActivity(at: now)
    expect(waits.unseenCount(now: now) == 0, "Activity opening marks a current wait seen")
    waits.receive(record(at: now + 1, extra: ["mood": "question", "rest": false, "waitAt": now + 1, "task": "a task"]), now: now + 1)
    expect(waits.unseenCount(now: now + 1) == 1 && waits.rows(now: now + 1).first?.state == old.words.waitingAnswer,
           "new question wait is unseen and outranks task")
    var oldWait = ActivitySessions(seenAt: now, claudeFrontmost: false)
    oldWait.receive(record(extra: ["mood": "waiting", "waitAt": now]), now: now)
    expect(oldWait.unseenCount(now: now) == 0, "wait begun at seenAt is already seen")
    var watching = ActivitySessions(seenAt: now - 100, claudeFrontmost: true)
    watching.receive(record(at: now - 10, extra: ["rest": false, "task": "thinking"]), now: now - 10)
    watching.receive(record(extra: ["done": now, "reply": ["text": "seen finish", "at": now]]), now: now)
    expect(watching.unseenCount(now: now) == 0 && watching.rows(now: now).first?.excerpt == nil,
           "turn finishing while Claude is frontmost is seen and has no excerpt")
    var away = ActivitySessions(seenAt: now - 100, claudeFrontmost: false)
    away.receive(record(at: now - 10, extra: ["rest": false, "task": "thinking"]), now: now - 10)
    away.receive(record(extra: ["done": now, "reply": ["text": "unseen finish", "at": now]]), now: now)
    expect(away.unseenCount(now: now) == 1 && away.rows(now: now).first?.excerpt == "unseen finish",
           "turn finishing away is unseen and exposes its reply excerpt")
    away.setClaudeFrontmost(true)
    expect(away.unseenCount(now: now) == 0 && away.rows(now: now).first?.excerpt == nil,
           "Claude activation marks finished turns seen and hides excerpts")
    away.setClaudeFrontmost(false)
    away.receive(record(at: now + 1, extra: ["done": now, "notice": ["kind": "info", "text": "Needs attention", "at": now + 1]]), now: now + 1)
    expect(away.unseenCount(now: now + 1) == 1 && away.rows(now: now + 1).first?.state == "Needs attention",
           "notice after seenAt is unseen and takes precedence over finished")
    let held = away.openActivity(at: now + 2)
    expect(held.count == 1 && held.first?.notice != nil && away.unseenCount(now: now + 2) == 0
           && away.rows(now: now + 2).first?.state == old.words.finished,
           "Activity opening returns held content for seen requests and marks everything seen")
    var precedence = ActivitySessions(seenAt: now - 100, claudeFrontmost: false)
    precedence.receive(record(extra: ["rest": false, "task": "reading a file", "done": now - 5,
                                      "notice": ["kind": "info", "text": "notice", "at": now]]), now: now)
    expect(precedence.rows(now: now).first?.state == "reading a file", "working task takes precedence over unseen notice and finish")
    precedence.receive(record(at: now + 1), now: now + 1)
    expect(precedence.rows(now: now + 1).first?.state == old.words.ready, "nothing yet reads ready")
    precedence.receive(record(at: now - 1, extra: ["task": "stale", "rest": false]), now: now + 1)
    expect(precedence.shown(now: now + 1).task == nil, "older record cannot replace newest session record")
    var ordered = ActivitySessions(seenAt: now - 100, claudeFrontmost: false)
    for n in 0..<8 { ordered.receive(record("s\(n)", at: now + Double(n)), now: now + 8) }
    ordered.receive(record("s0", at: now, extra: ["notice": ["kind": "info", "text": "old unseen", "at": now]]), now: now + 8)
    let rows = ordered.rows(now: now + 8)
    expect(rows.count == 6 && rows.first?.record.session == "s0"
           && rows.dropFirst().map { $0.record.session } == ["s7", "s6", "s5", "s4", "s3"],
           "Activity caps six rows with unseen first and remaining newest first")
    ordered.receive(record("s1", at: now + 9, extra: ["notice": ["kind": "info", "text": "another unseen", "at": now + 9]]), now: now + 9)
    ordered.markSeen(session: "s0", at: now + 9)
    expect(ordered.unseenCount(now: now + 9) == 1 && ordered.rows(now: now + 9).first?.session == "s1",
           "seeing one row leaves another session's unseen event intact")
    ordered.markSeen(session: "s1", at: now + 9)
    expect(ordered.unseenCount(now: now + 8) == 0, "row activation marks only its session seen")
    var manyUnseen = ActivitySessions(seenAt: now - 1, claudeFrontmost: false)
    for n in 0..<8 {
        manyUnseen.receive(record("u\(n)", at: now + Double(n), extra: ["notice": ["kind": "info", "text": "notice", "at": now + Double(n)]]), now: now + 8)
    }
    expect(manyUnseen.unseenCount(now: now + 8) == 8 && manyUnseen.rows(now: now + 8).count == 6,
           "badge counts every unseen session even when Activity shows at most six rows")
    var expiry = ActivitySessions()
    expiry.receive(record("expired", at: now - 12 * 3_600_000), now: now)
    expiry.receive(record("live", at: now - 12 * 3_600_000 + 1), now: now)
    expect(expiry.live(now: now).map { $0.session } == ["live"], "12-hour boundary expires sessions precisely")
    expiry.receive(record("live", at: now, extra: ["ended": true]), now: now)
    expect(expiry.live(now: now).isEmpty, "ended record removes a live session")
    expiry.receive(record(), now: now); expiry.forget()
    expect(expiry.rows(now: now).isEmpty && expiry.unseenCount(now: now) == 0, "Claude quitting clears sessions and unseen count")

    requestChannelChecks(scratch: scratch, expect: expect)

    let screen = CGRect(x: 0, y: 0, width: 1440, height: 900)
    let visible = CGRect(x: 0, y: 0, width: 1440, height: 876)
    let body = NSRect(x: 600, y: 500, width: 103, height: 96)
    let window = CGRect(x: 200, y: 100, width: 800, height: 404)
    let target = Place.Target(mode: .ledge, frame: body, number: 0, window: window, visible: visible, screen: screen)
    let bubbleSize = NSSize(width: 240, height: 22)
    let bubble = Place.bubbleFrame(for: target, size: bubbleSize)
    expect(bubble.midX == body.midX && bubble.minY == body.maxY - 4, "task bubble centers above head with four-point margin overlap")
    expect(screen.contains(bubble), "task bubble stays on screen")
    let around = Place.aroundTarget(for: target, overlay: bubble)
    expect(around.frame == body.union(bubble), "speech placement treats sprite and bubble union as his frame")
    let line = Place.lineFrame(for: around, size: NSSize(width: 200, height: 40))
    expect(!line.intersects(bubble) && !line.intersects(body), "ledge speech line intersects neither sprite nor bubble")
    var below = target; below.mode = .below; below.frame.origin.y = 0; below.window.origin.y = 80
    let lowBubble = Place.bubbleFrame(for: below, size: bubbleSize)
    expect(lowBubble.maxX <= below.frame.minX && screen.contains(lowBubble), "below-mode bubble stands to his left inside screen")
    let lowLine = Place.lineFrame(for: Place.aroundTarget(for: below, overlay: lowBubble), size: NSSize(width: 200, height: 30))
    expect(!lowLine.intersects(lowBubble), "below-mode speech line clears the bubble")
    var edge = target; edge.mode = .manual; edge.frame.origin = NSPoint(x: 0, y: 780)
    expect(screen.contains(Place.bubbleFrame(for: edge, size: bubbleSize)), "bubble clamps near screen top and left")
    let badge = Place.badgeFrame(for: target, size: NSSize(width: 20, height: 20))
    expect(abs(badge.midX - body.minX) <= 10 && abs(badge.midY - body.maxY) <= 10,
           "badge sits at sprite top-left away from bow")
    let pill = Place.bubbleFrame(for: target, size: NSSize(width: 148, height: 32))
    expect(pill.midX == body.midX && pill.minY == body.maxY - 4, "hover pill takes task bubble's place")
    var hover = HoverState()
    expect(!hover.visible && hover.showAt == nil && hover.hideAt == nil, "hover starts at rest with no timer decision")
    hover.pointer(.sprite, inside: true, at: 1)
    expect(hover.showAt == 1.35, "pointer entry arms one 0.35-second hover rest")
    hover.advance(at: 1.349)
    expect(!hover.visible, "hover does not appear before rest deadline")
    hover.advance(at: 1.35)
    expect(hover.visible && hover.showAt == nil, "hover appears at rest deadline and consumes show timer")
    hover.pointer(.pill, inside: true, at: 1.4)
    hover.pointer(.sprite, inside: false, at: 1.4)
    expect(hover.hideAt == nil, "moving from sprite into pill does not arm leave timer")
    hover.pointer(.pill, inside: false, at: 2)
    expect(hover.hideAt == 2.3, "leaving both surfaces arms one 0.3-second deadline")
    hover.advance(at: 2.299)
    expect(hover.visible, "hover survives until leave deadline")
    hover.advance(at: 2.3)
    expect(!hover.visible && hover.hideAt == nil, "hover hides at leave deadline and consumes timer")
    hover.pointer(.sprite, inside: true, at: 3); hover.advance(at: 3.35, carried: true)
    expect(!hover.visible, "carrying suppresses the hover pill")
    hover.pointer(.sprite, inside: false, at: 4); hover.pointer(.sprite, inside: true, at: 4.1); hover.advance(at: 4.45, card: true)
    expect(!hover.visible, "permission card suppresses the hover pill")
    hover.blocked(carried: false, card: true)
    expect(hover.showAt == nil && hover.hideAt == nil, "blocked hover leaves no armed timer decisions")
}

@MainActor
func activityCallerChecks(scratch: URL, expect: (Bool, String) -> Void) {
    var clock = 1_000_000.0
    let began = clock
    let chosen = Record(["session": "caller", "project": "scratch", "at": clock, "channel": true])!
    let placement = Place.Target(mode: .corner, frame: NSRect(x: 1200, y: 20, width: 103, height: 96), number: 0,
                                 window: CGRect(x: 100, y: 100, width: 900, height: 600),
                                 visible: CGRect(x: 0, y: 0, width: 1440, height: 876), screen: CGRect(x: 0, y: 0, width: 1440, height: 900))
    func records(_ channel: RequestChannel) throws -> [[String: Any]] {
        try String(contentsOf: channel.file, encoding: .utf8).split(separator: "\n").compactMap {
            (try? JSONSerialization.jsonObject(with: Data($0.utf8))) as? [String: Any]
        }
    }
    func make(_ channel: RequestChannel) -> Activity {
        Activity(rows: [], sessions: [chosen], chosen: chosen, target: placement, channel: channel, now: { clock })
    }
    do {
        let channel = try RequestChannel(folder: scratch.appendingPathComponent("activity-caller-submit"), now: clock)
        let controller = make(channel)
        controller.view.field.stringValue = "Actual button instruction"
        controller.view.send.pressed()
        let first = try records(channel).first!
        expect(first["kind"] as? String == "submit" && first["text"] as? String == "Actual button instruction"
               && !controller.view.send.isEnabled && !controller.panel.isVisible,
               "S2_actual_Activity_send_action_queues_submit_without_showing_panel")
        clock += 5_000; controller.checkTimeout()
        expect(controller.view.send.isEnabled && controller.view.send.accessibilityLabel() == chosen.words.retry
               && controller.view.field.stringValue == "Actual button instruction",
               "S2_actual_Activity_five_seconds_exposes_retry_without_claiming_failure")
        clock += 1; controller.view.send.pressed()
        let retried = try records(channel)
        expect(retried.count == 2 && retried.allSatisfy { $0["id"] as? String == first["id"] as? String && $0["at"] as? Double == began },
               "S2_actual_Activity_submit_retry_reuses_original_id_and_timestamp")
        controller.close()
        let reopened = make(channel); var reopenedClosed = 0; reopened.closed = { reopenedClosed += 1 }
        reopened.view.field.stringValue = "Actual button instruction"
        reopened.view.send.pressed()
        expect(try records(channel).count == 3 && records(channel).allSatisfy { $0["id"] as? String == first["id"] as? String },
               "S2_actual_reopened_Activity_reuses_existing_request_identity")
        clock += 5_000; reopened.checkTimeout()
        var ack = chosen; ack.ack = first["id"] as? String
        reopened.receive(ack)
        expect(reopenedClosed == 1, "S2_actual_Activity_late_ack_after_retry_closes_through_callback")

        let expiryChannel = try RequestChannel(folder: scratch.appendingPathComponent("activity-caller-expiry"), now: clock)
        let expiry = make(expiryChannel)
        expiry.view.field.stringValue = "Original expires"
        expiry.view.send.pressed()
        let expiredOriginal = try records(expiryChannel).first!
        clock += 60_001; expiry.checkTimeout()
        expect(!expiry.view.send.isEnabled && expiry.view.field.isEnabled && expiry.view.field.stringValue == "Original expires",
               "S2_actual_Activity_expiry_blocks_same_retry_and_preserves_text")
        expiry.view.send.pressed()
        expect(try records(expiryChannel).isEmpty, "S2_actual_Activity_expired_action_cannot_append_a_fresh_identity")
        expiry.view.field.stringValue = "Explicit new instruction"; expiry.view.field.changed()
        expect(expiry.view.send.isEnabled, "S2_actual_Activity_changed_text_reenables_new_send")
        expiry.view.send.pressed()
        let replacement = try records(expiryChannel)
        expect(replacement.count == 1 && replacement.first?["id"] as? String != expiredOriginal["id"] as? String
               && replacement.first?["at"] as? Double == clock,
               "S2_actual_Activity_changed_text_creates_one_explicit_new_request")
        expiry.close()

        let clearChannel = try RequestChannel(folder: scratch.appendingPathComponent("activity-caller-clear"), now: clock)
        let clear = make(clearChannel); var clearClosed = 0; clear.closed = { clearClosed += 1 }
        clear.view.newChat.pressed()
        expect(try records(clearChannel).isEmpty && clear.view.cancel.keyEquivalent == "\r"
               && clear.view.clear.keyEquivalent.isEmpty && !clear.view.cancel.isHidden,
               "S2_actual_Activity_new_chat_requires_confirmation_with_cancel_return_default")
        clear.view.clear.pressed()
        let firstClear = try records(clearChannel).first!
        expect(firstClear["kind"] as? String == "clear", "S2_actual_Activity_confirmed_clear_action_queues_clear")
        clock += 5_000; clear.checkTimeout(); clear.view.clear.pressed()
        let clears = try records(clearChannel)
        expect(clears.count == 2 && clears.allSatisfy { $0["id"] as? String == firstClear["id"] as? String
            && $0["at"] as? Double == firstClear["at"] as? Double },
               "S2_actual_Activity_clear_retry_reuses_original_id_and_timestamp")
        clock += 60_001; clear.checkTimeout()
        expect(!clear.view.clear.isEnabled && clear.view.cancel.isEnabled,
               "S2_actual_Activity_expired_clear_keeps_cancel_and_blocks_retry")
        ack.ack = firstClear["id"] as? String; clear.receive(ack)
        expect(clearClosed == 1, "S2_actual_Activity_clear_ack_after_expiry_still_closes")
    } catch { expect(false, "actual Activity caller scratch checks: \(error)") }
}

// Output comes from the real tail process; the condition also bounds every wait.
private final class TailOutput {
    private let condition = NSCondition()
    private var output = ""
    func receive(_ data: Data) {
        condition.lock(); defer { condition.unlock() }
        output += String(decoding: data, as: UTF8.self)
        condition.broadcast()
    }
    func contains(_ text: String, timeout: TimeInterval = 4) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        condition.lock(); defer { condition.unlock() }
        while !output.contains(text) {
            if !condition.wait(until: deadline) { return output.contains(text) }
        }
        return true
    }
}

@MainActor
func requestChannelChecks(scratch: URL, expect: (Bool, String) -> Void) {
    let now = 1_000_000.0
    func mode(_ url: URL) throws -> Int {
        (try FileManager.default.attributesOfItem(atPath: url.path)[.posixPermissions] as! NSNumber).intValue
    }
    func inode(_ url: URL) throws -> NSNumber {
        try FileManager.default.attributesOfItem(atPath: url.path)[.systemFileNumber] as! NSNumber
    }
    func requests(_ file: URL) throws -> [[String: Any]] {
        try String(contentsOf: file, encoding: .utf8).split(separator: "\n").compactMap {
            (try? JSONSerialization.jsonObject(with: Data($0.utf8))) as? [String: Any]
        }
    }
    do {
        let folder = scratch.appendingPathComponent("channel")
        let channel = try RequestChannel(folder: folder, now: now)
        let file = channel.file
        expect(try mode(folder) == 0o700 && mode(file) == 0o600, "request launch creates private 0700 folder and 0600 file")
        let request = try channel.append(session: "a", kind: .submit, text: "hello \"Claude\"\n你好", at: now)
        let raw = try String(contentsOf: file, encoding: .utf8)
        let json = try requests(file).first!
        expect(raw.hasSuffix("\n") && raw.components(separatedBy: "\n").count == 2
               && json["v"] as? Int == 1 && json["session"] as? String == "a" && json["at"] as? Double == now
               && json["kind"] as? String == "submit" && json["text"] as? String == "hello \"Claude\"\n你好",
               "submit appends exactly one valid JSON line with contract fields and escaped text")
        expect(request.id.count == 32 && request.id.allSatisfy { "0123456789abcdef".contains($0) }, "request id is 16 random bytes in lowercase hex")
        let pending = PendingRequest(request: request)
        expect(pending.decision(ack: nil, now: now + 4_999) == .sending, "request remains Sending before five seconds")
        expect(pending.decision(ack: "wrong", now: now + 5_000) == .unconfirmed && pending.text == request.text,
               "S2_five_seconds_is_unconfirmed_and_keeps_typed_text")
        expect(pending.decision(ack: nil, now: now + 60_000) == .unconfirmed
               && pending.decision(ack: nil, now: now + 60_001) == .expired,
               "S2_original_request_expiry_boundary_is_strictly_over_60000")
        expect(pending.decision(ack: request.id, now: now + 60_001) == .acknowledged,
               "S2_matching_ack_takes_precedence_even_after_expiry")
        let retryPending = PendingRequest(request: request, attemptedAt: now + 20_000)
        expect(retryPending.decision(ack: nil, now: now + 24_999) == .sending
               && retryPending.decision(ack: nil, now: now + 25_000) == .unconfirmed
               && retryPending.decision(ack: nil, now: now + 60_001) == .expired,
               "S2_retry_rearms_five_second_wait_without_extending_expiry")
        expect(try !channel.acknowledge("wrong") && requests(file).count == 1, "unmatched ack keeps request file")
        let before = try inode(file), length = try Data(contentsOf: file).count
        expect(try channel.acknowledge(request.id) && requests(file).isEmpty && !String(contentsOf: file, encoding: .utf8).contains("hello"),
               "S3_ack_removes_instruction_text_and_valid_request")
        expect(try before == inode(file) && length == Data(contentsOf: file).count && mode(file) == 0o600,
               "S1_ack_preserves_inode_and_all_byte_offsets")
        let clear = try channel.append(session: "a", kind: .clear, at: now + 1)
        let clearJSON = try requests(file).first!
        expect(clearJSON["kind"] as? String == "clear" && clearJSON["text"] == nil, "clear request follows same channel without text")
        _ = try channel.acknowledge(clear.id)
        let seen = try channel.append(session: "B", kind: .seen, upto: now, at: now + 2)
        let seenJSON = try requests(file).first!
        expect(seenJSON["kind"] as? String == "seen" && seenJSON["upto"] as? Double == now, "seen request carries excerpt/notice cutoff")
        let newer = try channel.append(session: "A", kind: .submit, text: "A only instruction", at: now + 3)
        let allBefore = try Data(contentsOf: file)
        expect(try channel.acknowledge(newer.id) && requests(file).map { $0["id"] as! String } == [seen.id],
               "S1_B_seen_survives_A_newest_ack")
        expect(try Data(contentsOf: file).count == allBefore.count && !String(contentsOf: file, encoding: .utf8).contains("A only instruction"),
               "S1_newest_ack_redacts_only_matching_record_without_shift")
        expect(try channel.acknowledge(seen.id) && requests(file).isEmpty, "S1_independent_sessions_ack_in_reverse_append_order")
        let b = try channel.append(session: "B", kind: .submit, text: "B survives", at: now + 4)
        let a = try channel.append(session: "A", kind: .seen, upto: now, at: now + 5)
        expect(try channel.acknowledge(a.id) && requests(file).first?["id"] as? String == b.id,
               "S1_B_submit_survives_A_newest_seen_ack")
        let reopened = try RequestChannel(folder: folder, now: now + 6)
        expect(try reopened.outstandingRequest(session: "B", kind: .submit, text: " B survives ", now: now + 6) == b,
               "S3_restart_restores_live_identity_and_trimmed_text_match")
        expect(try reopened.acknowledge(b.id) && requests(file).isEmpty, "S3_restart_restores_live_ack_tracking")
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: folder.path)
        try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: file.path)
        _ = try RequestChannel(folder: folder, now: now + 6)
        expect(try mode(folder) == 0o700 && mode(file) == 0o600, "launch repairs existing folder/file privacy modes")

        let restartFolder = scratch.appendingPathComponent("channel-restart")
        let abandoned = try RequestChannel(folder: restartFolder, now: now)
        _ = try abandoned.append(session: "stale", kind: .submit, text: "ABANDONED_INSTRUCTION", at: now)
        let live = try abandoned.append(session: "live", kind: .submit, text: "LIVE_INSTRUCTION", at: now + 2)
        let restartInode = try inode(abandoned.file), restartLength = try Data(contentsOf: abandoned.file).count
        let restored = try RequestChannel(folder: restartFolder, now: now + 60_001)
        expect(try !String(contentsOf: restored.file, encoding: .utf8).contains("ABANDONED_INSTRUCTION")
               && requests(restored.file).first?["id"] as? String == live.id,
               "S3_restart_removes_expired_instruction_and_preserves_live_request")
        expect(try inode(restored.file) == restartInode && Data(contentsOf: restored.file).count == restartLength,
               "S3_restart_cleanup_preserves_inode_and_live_offsets")
        expect(restored.nextExpiry == live.at + 60_001, "S3_next_expiry_uses_original_live_timestamp")
        expect(try restored.cleanup(now: live.at + 60_000) == 0 && requests(restored.file).count == 1,
               "S3_cleanup_keeps_exact_60000_ms_boundary")
        expect(try restored.cleanup(now: live.at + 60_001) == 1 && requests(restored.file).isEmpty
               && !String(contentsOf: restored.file, encoding: .utf8).contains("LIVE_INSTRUCTION") && restored.nextExpiry == nil,
               "S3_expiry_cleanup_purges_instruction_without_ack")
        expect(try restored.cleanup(now: live.at + 60_002) == 0, "S3_repeated_expiry_cleanup_is_idempotent")

        let retryChannel = try RequestChannel(folder: scratch.appendingPathComponent("channel-retry"), now: now)
        let original = try retryChannel.append(session: "retry", kind: .submit, text: "Retry me", at: now)
        let retried = try retryChannel.retry(original, now: now + 50_000)
        expect(try retried == original && retried.at == now && requests(retryChannel.file).count == 2,
               "S2_retry_reuses_identical_id_payload_and_original_timestamp")
        expect(retryChannel.nextExpiry == now + 60_001, "S2_retry_does_not_extend_cleanup_deadline")
        let retryRestored = try RequestChannel(folder: retryChannel.file.deletingLastPathComponent(), now: now + 50_001)
        expect(try retryRestored.outstandingRequest(session: "retry", kind: .submit, text: "Retry me", now: now + 50_001) == original,
               "S2_restart_finds_original_retry_identity")
        expect(try retryRestored.acknowledge(original.id) && requests(retryRestored.file).isEmpty,
               "S2_ack_redacts_every_duplicate_retry_record")
        do { _ = try retryRestored.retry(original, now: now + 50_002); expect(false, "S2_acknowledged_retry_is_rejected") }
        catch { expect(error as? RequestChannelError == .notOutstanding, "S2_acknowledged_retry_is_rejected") }
        let expires = try retryChannel.append(session: "expires", kind: .submit, text: "DO_NOT_RETAIN", at: now + 1)
        do { _ = try retryChannel.retry(expires, now: expires.at + 60_001); expect(false, "S2_expired_retry_is_rejected") }
        catch { expect(error as? RequestChannelError == .expiredRequest, "S2_expired_retry_is_rejected") }
        expect(try !String(contentsOf: retryChannel.file, encoding: .utf8).contains("DO_NOT_RETAIN"),
               "S3_rejected_expired_retry_still_cleans_up_private_text")

        let indexedChannel = try RequestChannel(folder: scratch.appendingPathComponent("channel-index"), now: now)
        let indexedA = try indexedChannel.append(session: "index-A", kind: .submit, text: "Index A", at: now)
        let indexedB = try indexedChannel.append(session: "index-B", kind: .submit, text: "Index B", at: now + 1)
        // Runtime only needs write access to live ranges; retained history need not be reread.
        try FileManager.default.setAttributes([.posixPermissions: 0o200], ofItemAtPath: indexedChannel.file.path)
        defer { try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: indexedChannel.file.path) }
        expect(try indexedChannel.acknowledge(indexedA.id), "S3_runtime_index_ack_needs_no_historical_read")
        expect(try indexedChannel.cleanup(now: indexedB.at + 60_001) == 1, "S3_runtime_index_expiry_needs_no_historical_read")
        let indexedC = try indexedChannel.append(session: "index-C", kind: .submit, text: "Index C", at: now + 60_002)
        expect(try indexedChannel.outstandingRequest(session: "index-C", kind: .submit, text: "Index C", now: now + 60_002) == indexedC,
               "S3_runtime_index_append_and_lookup_need_no_historical_read")
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: indexedChannel.file.path)
        expect(try requests(indexedChannel.file).map { $0["id"] as! String } == [indexedC.id],
               "S3_runtime_index_preserves_only_live_records_after_ack_and_expiry")

        let corruptFolder = scratch.appendingPathComponent("channel-corrupt")
        let corrupt = try RequestChannel(folder: corruptFolder, now: now)
        let partial = Data("{\"text\":\"ABANDONED_PARTIAL_SECRET".utf8)
        let h = try FileHandle(forWritingTo: corrupt.file)
        try h.write(contentsOf: partial); try h.close()
        let repaired = try RequestChannel(folder: corruptFolder, now: now)
        let repairedLive = try repaired.append(session: "live", kind: .submit, text: "Readable after partial", at: now)
        expect(try !String(contentsOf: repaired.file, encoding: .utf8).contains("ABANDONED_PARTIAL_SECRET")
               && requests(repaired.file).first?["id"] as? String == repairedLive.id,
               "S3_restart_scrubs_partial_abandoned_text_and_delimits_next_request")

        let tailChannel = try RequestChannel(folder: scratch.appendingPathComponent("channel-tail"), now: now)
        let ready = try tailChannel.append(session: "ready", kind: .seen, upto: now, at: now)
        let output = TailOutput(), pipe = Pipe(), tail = Process()
        tail.executableURL = URL(fileURLWithPath: "/usr/bin/tail")
        tail.arguments = ["-f", "-n", "+1", tailChannel.file.path]
        tail.standardOutput = pipe; tail.standardError = Pipe()
        pipe.fileHandleForReading.readabilityHandler = { handle in output.receive(handle.availableData) }
        try tail.run()
        defer {
            if tail.isRunning { tail.terminate(); tail.waitUntilExit() }
            pipe.fileHandleForReading.readabilityHandler = nil
            try? pipe.fileHandleForReading.close()
        }
        expect(output.contains(ready.id), "S1_actual_tail_reader_initialization_handshake")
        _ = try tailChannel.acknowledge(ready.id)
        expect(tail.suspend(), "S1_actual_tail_reader_can_be_paused_behind_writer")
        let pausedB = try tailChannel.append(session: "B", kind: .seen, upto: now, at: now + 1)
        let pausedA = try tailChannel.append(session: "A", kind: .submit, text: "SCRUB_A_BEFORE_TAIL_READ", at: now + 2)
        let tailInode = try inode(tailChannel.file), tailLength = try Data(contentsOf: tailChannel.file).count
        _ = try tailChannel.acknowledge(pausedA.id)
        expect(try inode(tailChannel.file) == tailInode && Data(contentsOf: tailChannel.file).count == tailLength,
               "S1_actual_tail_cleanup_keeps_inode_and_offset")
        expect(tail.resume(), "S1_actual_tail_reader_resumes")
        expect(output.contains(pausedB.id), "S1_actual_lagging_tail_consumes_B_after_newest_A_ack")
        _ = try tailChannel.acknowledge(pausedB.id)
        let afterEmpty = try tailChannel.append(session: "C", kind: .submit, text: "C after all acks", at: now + 3)
        expect(output.contains(afterEmpty.id), "S1_actual_tail_consumes_new_append_after_all_prior_acks")
    } catch { expect(false, "request-channel scratch checks: \(error)") }
}

exit(MainActor.assumeIsolated { run() })

@MainActor
func hoverLabelChecks(scratch: URL, hoverTable: [String: [String: Any]], expect: (Bool, String) -> Void) {
    let bell = SymbolButton(symbol: "bell"); bell.frame = NSRect(x: 0, y: 0, width: 24, height: 24)
    expect(bell.isFlipped && bell.bounds.contains(bell.dotRect) && bell.dotRect.maxY <= bell.bounds.midY
           && bell.dotRect.minX >= bell.bounds.midX && bell.dotRect == NSRect(x: 16, y: 3, width: 5, height: 5),
           "bell unread dot occupies the top right in flipped button coordinates")
    var state = ButtonLabelState()
    expect(state.selection == nil, "button label starts absent without a pointer or focus")
    state.pointer(0, inside: true)
    expect(state.selection == 0, "button label appears immediately on pointer entry")
    state.pointer(1, inside: true); state.pointer(0, inside: false)
    expect(state.selection == 1, "moving to next button survives old button exit")
    state.pointer(1, inside: false)
    expect(state.selection == nil, "leaving buttons immediately removes label")
    state.focus(2, inside: true)
    expect(state.selection == 2, "keyboard focus selects Activity button label")
    state.pointer(0, inside: true)
    expect(state.selection == 0, "pointer names its own button while another has focus")
    state.pointer(0, inside: false)
    expect(state.selection == 2, "pointer leaving restores focused label")
    state.focus(2, inside: false)
    expect(state.selection == nil, "focus departure removes label")
    state.pointer(4, inside: true); state.focus(1, inside: true); state.clear()
    expect(state.selection == nil && state.pointer == nil && state.focus == nil, "row hiding clears all label state")
    let visible = NSRect(x: 100, y: 50, width: 640, height: 430)
    let row = NSRect(x: 330, y: 240, width: 144, height: 32)
    let labelSize = NSSize(width: 110, height: 20)
    for index in 0..<5 {
        let button = NSRect(x: row.minX + 4 + CGFloat(index) * 28, y: row.minY + 4, width: 24, height: 24)
        let label = ButtonLabelPlacement.frame(button: button, row: row, size: labelSize, visible: visible)
        expect(label.midX == button.midX && label.minY == row.maxY + 4 && label.height == 20 && visible.contains(label),
               "button \(index) label centers four points above row inside visible frame")
    }
    for clearance: CGFloat in [0, 10, 25, 26, 40] {
        let top = NSRect(x: row.minX, y: visible.maxY - clearance - 32, width: 144, height: 32)
        let label = ButtonLabelPlacement.frame(button: top, row: top, size: labelSize, visible: visible)
        expect((clearance < 26 ? label.maxY == top.minY - 4 : label.minY == top.maxY + 4) && visible.contains(label),
               "label flips below row at \(Int(clearance))pt top clearance")
    }
    for x in [visible.minX, visible.maxX - 24] {
        let button = NSRect(x: x, y: row.minY + 4, width: 24, height: 24)
        let label = ButtonLabelPlacement.frame(button: button, row: row, size: labelSize, visible: visible)
        expect(visible.insetBy(dx: 2, dy: 2).contains(label)
               && (x == visible.minX ? label.minX == visible.minX + 2 : label.maxX == visible.maxX - 2),
               "label clamps at \(x == visible.minX ? "left" : "right") visible edge")
    }
    let oversized = ButtonLabelPlacement.frame(button: row, row: row, size: NSSize(width: 900, height: 20), visible: visible)
    expect(oversized.width == visible.width - 4 && visible.insetBy(dx: 2, dy: 2).contains(oversized), "label width caps to narrow visible frame")
    let unusedLabel = ButtonLabel(), invisibleParent = Panel(clickable: false, shadow: false)
    expect(unusedLabel.panel == nil && unusedLabel.view == nil, "label panel and drawing view are lazy before first use")
    unusedLabel.show(text: "Size", lang: "en", button: row, row: row, visible: visible, parent: invisibleParent, contrast: false)
    expect(unusedLabel.panel == nil, "an invisible row never creates or shows its label panel")
    unusedLabel.hide(); invisibleParent.close()
    let expected: [String: [String]] = [
        "en": ["Activity", "Back to Claude", "Hide his lines", "Show his lines", "Hide for an hour", "Size"],
        "zh": ["活动", "回到Claude", "不显示台词", "显示台词", "隐藏一小时", "大小"],
        "ja": ["アクティビティ", "Claudeに戻る", "セリフを隠す", "セリフを出す", "1時間隠す", "サイズ"],
    ]
    let event = NSEvent.mouseEvent(with: .mouseMoved, location: .zero, modifierFlags: [], timestamp: 0,
                                  windowNumber: 0, context: nil, eventNumber: 0, clickCount: 0, pressure: 0)!
    let folder = scratch.appendingPathComponent("hover-label-renders")
    do {
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        for lang in ["en", "zh", "ja"] {
            guard let dictionary = hoverTable[lang], let names = expected[lang] else { expect(false, "\(lang) hover feed fixture exists"); continue }
            expect(["activity", "back", "hideLines", "showLines", "hide", "size", "dictate", "send", "close"].allSatisfy { dictionary[$0] is String },
                   "\(lang) feed fixture contains every label word rather than relying on native defaults")
            let record = Record(["session": "hover-" + lang, "at": 1.0, "lang": lang, "words": dictionary])!
            expect([record.words.activity, record.words.back, record.words.hideLines, record.words.showLines, record.words.hide, record.words.size] == names,
                   "\(lang) feed record supplies all row words and both lines actions")
            let assets = URL(fileURLWithPath: CommandLine.arguments[1])
            let frames = Frames(folder: assets.appendingPathComponent("desktop"), pixelFolder: assets.appendingPathComponent("pixel"))
            let store = Store(url: scratch.appendingPathComponent("hover-" + lang + ".json"))
            let pet = Pet(frames: frames, store: store, trace: Trace(on: false))
            pet.show(record)
            for hidden in [false, true] {
                let actionNames = [names[0], names[1], names[hidden ? 3 : 2], names[4], names[5]]
                if hidden { pet.toggleLines() }
                let menuNames = pet.contextMenu().items.map { $0.title }
                expect(pet.customActionNames == actionNames && actionNames.allSatisfy { menuNames.contains($0) },
                       "\(lang) runtime sprite actions and context menu match all five row words with lines \(hidden ? "hidden" : "shown")")
            }
            let hover = HoverView(); var changes = 0; hover.labelChanged = { changes += 1 }
            for hidden in [false, true] {
                hover.configure(words: record.words, hidden: hidden, unseen: 1)
                let actionNames = [names[0], names[1], names[hidden ? 3 : 2], names[4], names[5]]
                expect(HoverView.names(words: record.words, hidden: hidden) == actionNames
                       && zip(hover.buttons, actionNames).allSatisfy { $0.accessibilityLabel() == $1 },
                       "\(lang) \(hidden ? "hidden" : "shown") lines row and shared VoiceOver words agree")
                expect(hover.buttons.map { $0.symbolName } == ["bell", "macwindow", "text.bubble", "moon.zzz", "square.resize"]
                       && hover.buttons[2].stroke == !hidden && hover.buttons[0].dot,
                       "\(lang) \(hidden ? "hidden" : "shown") lines glyph names and slash action are correct")
                expect(hover.buttons.allSatisfy { $0.toolTip == nil }, "\(lang) row has no system tooltip")
            }
            hover.buttons[2].mouseEntered(with: event)
            expect(hover.hoveredButton === hover.buttons[2] && hover.buttons[2].hovered, "\(lang) actual button entry immediately selects label")
            let before = changes; hover.configure(words: record.words, hidden: false, unseen: 0)
            expect(hover.hoveredButton?.accessibilityLabel() == names[2] && changes > before, "\(lang) hovered lines label updates immediately on action swap")
            hover.buttons[3].mouseEntered(with: event); hover.buttons[2].mouseExited(with: event)
            expect(hover.hoveredButton === hover.buttons[3], "\(lang) actual pointer move preserves next button label")
            hover.buttons[3].mouseExited(with: event)
            expect(hover.hoveredButton == nil, "\(lang) actual pointer leaving buttons clears label")
            hover.buttons[0].mouseEntered(with: event); hover.clearLabel()
            expect(hover.hoveredButton == nil, "\(lang) row hiding clears label selection")
            let card = ActivityView(); var chosen = record; chosen.channel = true
            _ = card.fit(rows: [], sessions: [chosen], chosen: chosen, confirming: false, status: nil, pending: false)
            expect(zip([card.mic, card.send, card.close], [record.words.dictate, record.words.send, record.words.close]).allSatisfy {
                $0.accessibilityLabel() == $1 && $0.toolTip == nil
            }, "\(lang) Activity icons use feed words without system tooltips")
            for index in 0..<3 {
                card.pointerLabel(index, inside: true)
                expect(card.labelButton === [card.mic, card.send, card.close][index], "\(lang) Activity pointer immediately names icon \(index)")
                card.pointerLabel(index, inside: false); card.focusLabel(index, inside: true)
                expect(card.labelButton === [card.mic, card.send, card.close][index], "\(lang) Activity focus immediately names icon \(index)")
                card.focusLabel(index, inside: false)
                expect(card.labelButton == nil, "\(lang) Activity icon \(index) focus departure removes label")
            }
            card.pointerLabel(0, inside: true)
            _ = card.fit(rows: [], sessions: [chosen], chosen: chosen, confirming: true, status: nil, pending: false)
            expect(card.labelButton == nil, "\(lang) Activity confirmation clears label of hidden dictation button")
            var focusChanges: [Bool] = []
            let button = SymbolButton(symbol: "mic"); button.keyboardFocusable = true; button.focusChanged = { focusChanges.append($0) }
            let host = ActivityPanel(); host.contentView = NSView(frame: NSRect(x: 0, y: 0, width: 100, height: 100)); host.contentView!.addSubview(button)
            _ = host.makeFirstResponder(button); _ = host.makeFirstResponder(nil)
            expect(focusChanges == [true, false], "\(lang) native responder changes notify focus entry and departure"); host.close()
            for appearance in [NSAppearance.Name.aqua, .darkAqua] {
                let label = ButtonLabelView(); label.appearance = NSAppearance(named: appearance)
                let size = label.fit(record.words.hideLines, lang: lang, maxWidth: 500)
                let text = NSAttributedString(string: record.words.hideLines, attributes: [.font: SpeechView.font(12)])
                expect(size.height == 20 && size.width == ceil(text.size().width) + 16, "\(lang) \(appearance.rawValue) label has 20pt height and eight-point text padding")
                let language = label.label.attribute(NSAttributedString.Key(kCTLanguageAttributeName as String), at: 0, effectiveRange: nil) as? String
                let font = label.label.attribute(.font, at: 0, effectiveRange: nil) as? NSFont
                expect(language == lang && font?.pointSize == 12 && font?.fontDescriptor == SpeechView.font(12).fontDescriptor,
                       "\(lang) label carries session language and 12pt system serif")
                label.displayIfNeeded()
                guard let bitmap = label.bitmapImageRepForCachingDisplay(in: label.bounds) else { expect(false, "\(lang) label creates bitmap"); continue }
                label.effectiveAppearance.performAsCurrentDrawingAppearance { label.cacheDisplay(in: label.bounds, to: bitmap) }
                let file = folder.appendingPathComponent("label-\(lang)-\(appearance.rawValue).png")
                try bitmap.representation(using: .png, properties: [:])!.write(to: file)
                print("offscreen hover label: \(file.path)")
                for hot in [false, true] {
                    let canvas = NSView(frame: NSRect(x: 0, y: 0, width: 280, height: 120))
                    canvas.appearance = NSAppearance(named: appearance)
                    let rowView = HoverView(); rowView.configure(words: record.words, hidden: false, unseen: 1)
                    rowView.frame.origin = NSPoint(x: 68, y: 20); canvas.addSubview(rowView)
                    let tag = ButtonLabelView(); tag.contrast = hot; rowView.contrast = hot
                    let extent = tag.fit(record.words.hideLines, lang: lang, maxWidth: 276)
                    tag.frame.origin = NSPoint(x: rowView.frame.minX + rowView.buttons[2].frame.midX - extent.width / 2, y: 56)
                    canvas.addSubview(tag)
                    if hot { rowView.buttons[2].mouseEntered(with: event) }
                    guard let combined = canvas.bitmapImageRepForCachingDisplay(in: canvas.bounds) else {
                        expect(false, "combined row and label creates bitmap"); continue
                    }
                    canvas.effectiveAppearance.performAsCurrentDrawingAppearance { canvas.cacheDisplay(in: canvas.bounds, to: combined) }
                    let combinedFile = folder.appendingPathComponent("row-label-\(lang)-\(appearance.rawValue)-\(hot ? "hover-contrast" : "rest").png")
                    try combined.representation(using: .png, properties: [:])!.write(to: combinedFile)
                    print("offscreen row and hover label: \(combinedFile.path)")
                }
            }
        }
    } catch { expect(false, "hover-label offscreen scratch checks: \(error)") }
    for dark in [false, true] {
        for hovered in [false, true] {
            let ink = dark ? CardView.paper : CardView.ink
            let paper = dark ? CardView.color(0x2B2220) : CardView.paper
            let ground = hovered ? paper.blended(withFraction: dark ? 0.12 : 0.08, of: ink)! : paper
            let color = hovered ? CardView.vermilion : ink
            let button = SymbolButton(symbol: "text.bubble"); button.stroke = true
            guard let glyph = button.glyph(color: color, ground: ground),
                  let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 72, pixelsHigh: 72, bitsPerSample: 8,
                                               samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                                               bytesPerRow: 0, bitsPerPixel: 0) else {
                expect(false, "slash creates raster image"); continue
            }
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
            let transform = NSAffineTransform(); transform.scale(by: 4); transform.concat()
            glyph.draw(in: NSRect(x: 0, y: 0, width: 18, height: 18))
            NSGraphicsContext.restoreGraphicsState()
            func matches(_ pixel: NSColor?, _ expected: NSColor) -> Bool {
                guard let pixel = pixel?.usingColorSpace(.sRGB), let expected = expected.usingColorSpace(.sRGB) else { return false }
                return abs(pixel.redComponent - expected.redComponent) < 0.035
                    && abs(pixel.greenComponent - expected.greenComponent) < 0.035
                    && abs(pixel.blueComponent - expected.blueComponent) < 0.035 && pixel.alphaComponent > 0.95
            }
            expect(glyph.size == NSSize(width: 18, height: 18)
                   && matches(bitmap.colorAt(x: 36, y: 35), color)
                   && matches(bitmap.colorAt(x: 32, y: 39), ground),
                   "\(dark ? "dark" : "light") \(hovered ? "hovered" : "resting") slash raster has glyph-colour stroke and current-background knockout")
        }
    }
    let screen = NSRect(x: 0, y: 0, width: 1440, height: 900), area = NSRect(x: 0, y: 24, width: 1440, height: 852)
    let assets = URL(fileURLWithPath: CommandLine.arguments[1])
    let frames = Frames(folder: assets.appendingPathComponent("desktop"), pixelFolder: assets.appendingPathComponent("pixel"))
    for lang in ["en", "zh", "ja"] {
        guard let dictionary = hoverTable[lang] else { continue }
        let record = Record(["session": "geometry-" + lang, "at": 1.0, "lang": lang, "words": dictionary])!
        let widths = HoverView.labelWidths(words: record.words, lang: lang, visibleWidth: area.width)
        for size in Size.allCases {
            let bodySize = frames.size(size, scale: 2)
            for mode in [Place.Mode.ledge, .besideLeft, .besideRight, .corner, .below, .manual, .free] {
                for point in [NSPoint(x: 650, y: 418), NSPoint(x: 4, y: area.maxY - bodySize.height - 10),
                              NSPoint(x: area.maxX - bodySize.width - 4, y: area.maxY - bodySize.height - 10)] {
                    let target = Place.Target(mode: mode, frame: NSRect(origin: point, size: bodySize), number: 0,
                                              window: NSRect(x: 250, y: 120, width: 850, height: 300), visible: area, screen: screen)
                    let row = Place.bubbleFrame(for: target, size: NSSize(width: 144, height: 32))
                    let lane = NSRect(x: row.minX, y: row.maxY, width: row.width, height: 24)
                    let overlay = Place.hoverOverlay(for: target, labelWidths: widths)
                    for speechSize in [NSSize(width: 180, height: 82), NSSize(width: 280, height: 100)] {
                        let line = Place.lineFrame(for: Place.aroundTarget(for: target, overlay: overlay), size: speechSize)
                        let labels = [false, true].flatMap { hidden in
                            HoverView.names(words: record.words, hidden: hidden).enumerated().map { index, text -> NSRect in
                                let label = ButtonLabelView(), button = NSRect(x: row.minX + 4 + CGFloat(index) * 28, y: row.minY + 4, width: 24, height: 24)
                                let extent = label.fit(text, lang: lang, maxWidth: area.width - 4)
                                return ButtonLabelPlacement.frame(button: button, row: row, size: extent, visible: area)
                            }
                        }
                        expect(!line.intersects(row) && !line.intersects(lane) && labels.allSatisfy { !line.intersects($0) },
                               "\(lang) \(size.rawValue) \(mode.rawValue) speech \(speechSize) clears row, lane and every actual label at \(point)")
                    }
                }
            }
        }
    }
}
