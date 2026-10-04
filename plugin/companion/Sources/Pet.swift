import AppKit
import QuartzCore
import CoreText

// Him, by Claude's window, and the line he says. Where he goes is Place.swift; how he reacts when
// you touch him is Reactions.swift; this file shows both.
//
// He is 96 points tall by default. In his right-click menu, Extra small and Small are the pixel
// heads at whole device pixels per art pixel, at most 48 and 72 points (48 and 64 points on a
// Retina screen with the current sheet). Medium 96 and Large 128 points use the painted frames.
// On his own he stays clear of Claude's window (it has no spot inside that stays empty at that
// size: a 48 point title bar, the account and project rows at the bottom of the sidebar, buttons
// and the composer in the corners). You can carry him anywhere, in every situation: put him down
// near the window and he follows it; farther away and he stays where you left him; while the window
// fills the screen he keeps a spot of his own there. "Put him back" in his menu returns him to the
// automatic places.
//
// Touching him: a click is a head pat, quick clicks fluster him, an Option-click brings out Shiori,
// picking him up startles him, putting him down he smooths his robe, a long press and he hugs his
// book; each with a short line in his voice (from the feed, in the session's language). A press or a
// drag on him goes only to him, never through to Claude: his click target is his own pixels, and the
// panel that takes the press keeps the whole drag.
//
// Three borderless, non-activating panels that never become key, so Claude keeps the focus:
//   hit     his current frame drawn at alpha 1/255, invisible. The window server tests clicks against
//           the alpha of drawn content, so only his own pixels catch a click and the clear ones
//           around him let it through. His picture and his line are its child windows: they move
//           and stack with it, so a drag moves one window and a click cannot split them.
//   look    his picture, with the loop, the pat, the sway; ignores the mouse.
//   speech  his line; ignores the mouse.
// On the ledge he is ordered just behind Claude's window (its edge hides the bottom of his frame);
// beside it, below it or in the corner, just above it; where you put him, floating while Claude is
// in front (so Claude raising its own window cannot bury him), otherwise just above it.
//
// Motion: two-frame turn loops and an occasional idle blink run in the window server, only while
// he is on screen and not covered, with Reduce Motion off. The idle blink adds no timer to this
// process: a three-minute randomized contents sequence. Reactions replace it.
// The pat squash, the flustered shake and the sway also stop with Reduce Motion. Timers are reusable
// one-shots for live lines and reactions; the blink never arms one.

final class Panel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }

    init(clickable: Bool, shadow: Bool) {
        super.init(
            contentRect: NSRect(x: 0, y: 0, width: 10, height: 10), styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered, defer: true
        )
        isOpaque = false
        backgroundColor = .clear
        hasShadow = shadow
        level = .normal
        hidesOnDeactivate = false
        isReleasedWhenClosed = false
        isRestorable = false
        animationBehavior = .none
        // Only ever set to true: setting false explicitly makes the whole rectangle catch clicks,
        // while left alone the window server lets clicks on clear pixels through.
        if !clickable { ignoresMouseEvents = true }
        isExcludedFromWindowsMenu = true
        collectionBehavior = [.moveToActiveSpace, .fullScreenAuxiliary, .ignoresCycle]
    }

    // Borderless panels may sit partly below the bottom of the screen (he peeks up from there).
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }
}

/// His size, chosen in his menu and kept in his settings. Extra small and Small are the pixel
/// heads at whole device pixels per art pixel, at most 48 and 72 points (48 and 64 points on a
/// Retina screen with the current sheet), so every art pixel stays square and sharp. Medium 96
/// and Large 128 points use the painted frames.
enum Size: String, CaseIterable {
    case tiny, small, medium, large

    var pixelArt: Bool { self == .tiny || self == .small }

    var height: CGFloat {
        switch self {
        case .tiny: 48
        case .small: 72
        case .medium: 96
        case .large: 128
        }
    }

    var fontSize: CGFloat {
        switch self {
        case .tiny: 12
        case .small: 13
        case .medium: 15
        case .large: 17
        }
    }
}

/// The idle animation's whole schedule and eligibility, independent of windows and clocks.
enum IdleBlink {
    static func wanted(mood: String, frame: String, hasLoop: Bool, reacting: Bool,
                       visible: Bool, unoccluded: Bool, reduceMotion: Bool) -> Bool {
        mood == "idle" && frame == "idle-reading" && !hasLoop && !reacting
            && visible && unoccluded && !reduceMotion
    }

    static func animation(open: CGImage, shut: CGImage) -> CAKeyframeAnimation {
        MotionModel.standard.idle(open: open, shut: shut, gaze: false)
    }
}

/// Reconcile the cache with the actual layer, even when an input already invalidated the cache.
enum FrameLoop {
    static func prepare(on picture: CALayer, wanted: String?, cached: inout String?) -> Bool {
        guard let wanted else {
            picture.removeAnimation(forKey: "loop")
            cached = nil
            return false
        }
        if wanted == cached, picture.animation(forKey: "loop") != nil { return false }
        picture.removeAnimation(forKey: "loop")
        cached = nil
        return true
    }
}

@MainActor
final class Pet: NSObject {
    /// Test switch (--motion): animate even with Reduce Motion on, to measure what a loop costs.
    static var ignoreReduceMotion = false
    /// Test switch (--offscreen): everything placed as usual, then moved far off every screen, and the
    /// loop run as if he were seen, to measure the drawing path without showing anything.
    static var offscreen = false

    private let frames: Frames
    private let store: Store
    private let trace: Trace
    private let look = Panel(clickable: false, shadow: false)
    private let lookView = LookView()
    private let hit = Panel(clickable: true, shadow: false)
    private let hitView = HitView()
    private let speech = Panel(clickable: false, shadow: true)
    private let speechView = SpeechView()
    private let bubble = Panel(clickable: false, shadow: true)
    private let bubbleView = BubbleView()
    private var badge: Panel?
    private var badgeView: BadgeView?
    private var hoverPanel: Panel?
    private var hoverView: HoverView?
    private let hoverLabel = ButtonLabel()
    private var hover = HoverState()
    private var unseen = 0
    private var activityPresented = false
    private var retainedTarget: Place.Target?
    var requestActivity: () -> Void = {}
    private var card: Card?
    private var cardWaiting = false
    private var cardWanted = false
    private var cardAnnounce = false
    var requestFollow: () -> Void = {}
    var openSettings: () -> Void = {}
    var trustReady = false

    private var record = Record.resting
    private var sighting = Claude.Sighting.none
    private var mode: Place.Mode?
    private var orderedTo: CGWindowID?
    private var scale: CGFloat = 2
    private var loopKey: String?
    private var gazeBlink = true
    private var recheckAt: Double?
    private var lastShown: NSRect?
    private var reactor = Reactor()
    private var reaction: (frame: String, until: Double)?
    private var reactionLine: (text: String, until: Double)?
    private var press: (start: NSPoint, origin: NSPoint, option: Bool, moved: Bool, held: Bool)?
    private var dragOrigin: CGPoint?
    private lazy var recheck: OneShot = OneShot { [unowned self] in
        recheckAt = nil
        draw()
    }
    private lazy var reactionEnd: OneShot = OneShot { [unowned self] in
        if record.mood == "idle" { gazeBlink = true; loopKey = nil }
        draw()
        place(reorder: false)
        armReactionEnd()
    }
    private lazy var longPress: OneShot = OneShot { [unowned self] in
        guard var current = press, !current.moved else { return }
        current.held = true
        press = current
        react(.longPress)
    }
    private lazy var snoozeEnd: OneShot = OneShot { [unowned self] in place(reorder: true) }

    init(frames: Frames, store: Store, trace: Trace) {
        self.frames = frames
        self.store = store
        self.trace = trace
        super.init()
        look.contentView = lookView
        hit.contentView = hitView
        speech.contentView = speechView
        bubble.contentView = bubbleView
        hitView.pet = self
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(occlusionMoved), name: NSWindow.didChangeOcclusionStateNotification, object: look)
        center.addObserver(self, selector: #selector(scaleMoved), name: NSWindow.didChangeBackingPropertiesNotification, object: look)
        NSWorkspace.shared.notificationCenter.addObserver(
            self, selector: #selector(displayOptionsMoved), name: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, object: nil
        )
        if snoozed { snoozeEnd.fire(after: store.hiddenUntil - Date().timeIntervalSince1970) }
    }

    private var reduceMotion: Bool { !Self.ignoreReduceMotion && NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }
    private var snoozed: Bool { store.hiddenUntil > Date().timeIntervalSince1970 }
    private var now: Double { Date().timeIntervalSince1970 * 1000 }
    private var height: CGFloat { store.size.height }

    // ------------------------------------------------------------ inputs

    func show(_ record: Record) {
        if record.motion != self.record.motion || record.mood == "idle" && (self.record.mood != "idle" || record.said != self.record.said) { loopKey = nil; gazeBlink = true }
        self.record = record
        updateActions()
        draw()
        place(reorder: false)
    }

    /// His hello changes only the frame: no new line, and the hour's hide is cleared on disk too.
    func comeBack() {
        store.hiddenUntil = 0
        snoozeEnd.cancel()
        reaction = ("wave", now + 1_500)
        lookView.picture.removeAnimation(forKey: "loop")
        loopKey = nil
        draw()
        place(reorder: true)
        armReactionEnd()
        store.save()
    }

    func follow(_ sighting: Claude.Sighting, reorder: Bool) {
        self.sighting = sighting
        place(reorder: reorder)
    }

    /// Claude's window was dragged: he sways a little where he stands, then settles.
    func sway(dx: CGFloat) {
        guard hit.isVisible, !reduceMotion, dx != 0, press == nil else { return }
        let angle = max(-0.1, min(0.1, -dx * 0.01)) // radians: about 6 degrees at most
        let spring = CASpringAnimation(keyPath: "transform.rotation.z")
        spring.fromValue = angle
        spring.toValue = 0
        spring.mass = 0.6
        spring.stiffness = 170
        spring.damping = 7
        spring.duration = spring.settlingDuration
        lookView.picture.add(spring, forKey: "sway")
    }

    // ------------------------------------------------------------ where

    private func target() -> Place.Target? {
        if snoozed { return nil }
        if activityPresented, case .none = sighting, var kept = retainedTarget {
            kept.active = true
            return kept
        }
        switch sighting {
        case .none: break
        case let .corner(_, screen, _, _), let .window(_, _, _, _, screen, _):
            let size = frames.size(store.size, scale: scaleOf(screen))
            let places = Place.Places(manual: store.manual, full: store.full, last: lastShown, wasLedge: mode == .ledge, drag: dragOrigin)
            if let target = Place.spot(for: sighting, size: size, places: places) { return target }
        }
        // An explicit call shows his hello even when Claude has no usable placement right now.
        guard reaction?.frame == "wave", let until = reaction?.until, until > now,
              let screen = NSScreen.main ?? NSScreen.screens.first else { return nil }
        let size = frames.size(store.size, scale: scaleOf(screen.frame))
        let places = Place.Places(manual: nil, full: nil, last: lastShown, wasLedge: false, drag: dragOrigin)
        let frame = Place.freeFrame(size: size, places: places, visible: screen.visibleFrame, screen: screen.frame)
        return Place.Target(mode: .free, frame: frame, number: 0, window: .zero, visible: screen.visibleFrame, screen: screen.frame)
    }

    private func place(reorder: Bool) {
        guard var target = target() else {
            hide()
            return
        }
        let newScale = scaleOf(target.screen)
        if newScale != scale {
            scale = newScale
            loopKey = nil
            draw()
        }
        target.frame = aligned(target.frame)
        retainedTarget = target
        lastShown = target.frame
        let layoutTarget = target
        if Self.offscreen { target.frame.origin.x += 30_000 }
        if mode != target.mode { trace.say("pet: \(target.mode.rawValue) at \(Int(target.frame.minX)),\(Int(target.frame.minY)) \(Int(target.frame.width))x\(Int(target.frame.height))") }
        let previous = mode
        mode = target.mode
        lookView.fit(target.frame.size)
        hit.setFrame(target.frame, display: false) // first: its child windows move with it
        look.setFrame(target.frame, display: false)
        let wasVisible = hit.isVisible
        let level: NSWindow.Level = target.chosen && target.active ? .floating : .normal
        let relevel = hit.level != level
        if !wasVisible || reorder || relevel || orderedTo != target.number || mode != previous {
            for panel in [hit, look, speech] where panel.level != level { panel.level = level }
            if level == .floating {
                hit.orderFrontRegardless()
            } else {
                hit.order(target.mode == .ledge ? .below : .above, relativeTo: Int(target.number))
            }
            if look.parent == nil { hit.addChildWindow(look, ordered: .below) }
            look.order(.below, relativeTo: hit.windowNumber)
            orderedTo = target.number
        }
        placeCard(layoutTarget)
        placeAround(layoutTarget)
        placeSpeech(speechTarget(layoutTarget), reorder: reorder || !wasVisible)
        if !wasVisible { updateLoop() }
    }

    /// While you carry him: only his click target moves (his picture and line are its child windows),
    /// so nothing is laid out again until you put him down.
    private func carry() {
        guard var target = target() else { return }
        target.frame = aligned(target.frame)
        lastShown = target.frame
        if Self.offscreen { target.frame.origin.x += 30_000 }
        hit.setFrame(target.frame, display: false)
    }

    private func hide() {
        if hit.isVisible { trace.say("pet: hidden") }
        hit.orderOut(nil)
        look.orderOut(nil)
        speech.orderOut(nil)
        card?.panel.orderOut(nil)
        bubble.orderOut(nil); badge?.orderOut(nil); hideHoverRow()
        hover.blocked(carried: true, card: false)
        orderedTo = nil
        mode = nil
        updateLoop()
    }

    /// Whether Claude's window fills the screen now (his drop then sets the full-screen spot).
    private var windowFillsScreen: Bool {
        switch sighting {
        case let .window(window, _, fullScreen, visible, _, _): fullScreen || Place.fills(window, visible)
        case let .corner(visible, _, _, window): Place.fills(window, visible)
        case .none: false
        }
    }

    // ------------------------------------------------------------ his line

    private var bandLine: String? {
        guard let said = record.said else { return nil }
        // The mod clears a line after 14 s (a slip after 45 s); this only guards a session that died.
        return now - record.at < 60_000 ? said : nil
    }

    private var lineToSay: String? {
        guard !store.linesHidden else { return nil }
        if let reactionLine, reactionLine.until > now { return reactionLine.text }
        return bandLine
    }

    private func placeSpeech(_ target: Place.Target, reorder: Bool) {
        guard card?.panel.isVisible != true, !activityPresented, let line = lineToSay else {
            if speech.parent != nil { hit.removeChildWindow(speech) }
            speech.orderOut(nil)
            return
        }
        speechView.contrast = NSWorkspace.shared.accessibilityDisplayShouldIncreaseContrast
        speechView.slip = record.slip && line == bandLine
        speechView.fontSize = store.size.fontSize
        let limits = Place.lineLimits(for: target)
        let size = speechView.fit(line, maxWidth: limits.width, maxHeight: limits.height)
        var frame = aligned(Place.lineFrame(for: target, size: size))
        if Self.offscreen { frame.origin.x += 30_000 }
        speech.setFrame(frame, display: true)
        if !speech.isVisible || reorder || speech.parent == nil {
            if speech.parent == nil { hit.addChildWindow(speech, ordered: .above) }
            speech.order(.above, relativeTo: hit.windowNumber)
        }
        if line == bandLine { scheduleRecheck(at: record.at + 60_000) } // a line left by a session that went away
    }

    // ------------------------------------------------------------ what he looks like

    private func draw() {
        // Whatever still needs a later look (a live line, a running loop) arms it again below.
        recheck.cancel()
        recheckAt = nil
        let reacting = reaction.map { $0.until > now } ?? false
        let name = reacting ? reaction!.frame : record.frame
        guard let still = frames.image(name, size: store.size, scale: scale) ?? frames.image("idle-reading", size: store.size, scale: scale)
        else { return }
        lookView.show(still, scale: scale)
        hitView.silhouette = still
        updateLoop()
        hitView.setAccessibilityLabel(spokenLabel)
        if let target = target(), hit.isVisible, press?.moved != true { placeSpeech(speechTarget(target), reorder: false) }
    }

    /// For VoiceOver: "Claude-sama (reading), let me read., 35% context".
    var spokenLabel: String {
        var parts = [[record.name, record.aside].filter { !$0.isEmpty }.joined(separator: " ")]
        if let line = lineToSay { parts.append(line) }
        if let context = record.context { parts.append("\(record.estimate ? "~" : "")\(context)% \(record.words.context)") }
        return parts.joined(separator: ", ")
    }

    var patHint: String { record.words.pat }

    private func updateLoop() {
        var want: String?
        let reacting = reaction.map { $0.until > now } ?? false
        let blink = IdleBlink.wanted(mood: record.mood, frame: record.frame, hasLoop: record.loop != nil,
                                    reacting: reacting, visible: hit.isVisible && !Self.offscreen,
                                    unoccluded: look.occlusionState.contains(.visible), reduceMotion: reduceMotion)
        if let loop = record.loop, let every = record.every, now - record.at < 10 * 60_000, !reacting, !reduceMotion,
           hit.isVisible, look.occlusionState.contains(.visible) || Self.offscreen {
            want = "\(loop[0])|\(loop[1])|\(every)|\(height)|\(scale)"
            // A turn that stopped writing for ten minutes keeps its face but stops moving.
            scheduleRecheck(at: record.at + 10 * 60_000)
        } else if blink {
            want = "idle-blink|\(store.size.rawValue)|\(height)|\(scale)"
        }
        let picture = lookView.picture
        guard FrameLoop.prepare(on: picture, wanted: want, cached: &loopKey), let want else { return }
        let animation: CAKeyframeAnimation
        if blink {
            guard let open = frames.image("idle-reading", size: store.size, scale: scale),
                  let shut = frames.image("idle-blink", size: store.size, scale: scale) else { return }
            animation = record.motion.idle(open: open, shut: shut, gaze: gazeBlink)
            gazeBlink = false
        } else {
            guard let loop = record.loop,
                  let first = frames.image(loop[0], size: store.size, scale: scale),
                  let second = frames.image(loop[1], size: store.size, scale: scale) else { return }
            animation = record.motion.loop(first: first, second: second, kind: record.mood)
        }
        picture.add(animation, forKey: "loop")
        loopKey = want
        trace.say("pet: loop \(want)")
    }

    // One pending look-again, at the earliest moment something shown goes stale: a line left by a
    // session that went away (60 s), a loop whose turn stopped writing (10 min).
    private func scheduleRecheck(at ms: Double) {
        let delay = (ms - now) / 1000
        guard delay > 0 else { return }
        if let pending = recheckAt, pending <= ms, pending > now { return } // an earlier one is due
        recheckAt = ms
        recheck.fire(after: delay)
    }

    @objc private func occlusionMoved() { updateLoop() }

    @objc private func scaleMoved() {
        let current = look.backingScaleFactor
        guard current != scale else { return }
        scale = current
        loopKey = nil
        draw()
        place(reorder: false)
    }

    @objc private func displayOptionsMoved() {
        loopKey = nil
        draw()
        place(reorder: false)
    }

    // ------------------------------------------------------------ his one question

    @objc private func askToFollow() { requestFollow() }

    func showFollowCard(waiting: Bool, asked: Bool) {
        guard !store.trusted else { return }
        cardWanted = true
        cardWaiting = waiting
        cardAnnounce = cardAnnounce || asked
        place(reorder: true)
    }

    func trustChanged() {
        if store.trusted, cardWanted {
            closeCard()
            reaction = ("happy", now + 1_500)
            reactionLine = (record.words.thanks, now + 4_000)
            loopKey = nil
            draw()
            armReactionEnd()
        }
        place(reorder: true)
    }

    private func closeCard() {
        cardWanted = false
        cardAnnounce = false
        card?.close()
        card = nil
        if let target = target() { placeSpeech(target, reorder: true) }
    }

    private func placeCard(_ target: Place.Target) {
        let visible = hit.isVisible && target.active && press?.moved != true && !activityPresented && !Self.offscreen
        var persistOffer = false
        defer { if persistOffer { store.save() } }
        if trustReady, !cardWanted, CardOffer.shouldOffer(trusted: store.trusted, offered: store.offered,
                                                       build: Store.build, visible: visible) {
            cardWanted = true
            cardWaiting = false
            store.offered = Store.build
            persistOffer = true
        }
        guard cardWanted, visible, !store.trusted else { card?.panel.orderOut(nil); return }
        if store.offered != Store.build { store.offered = Store.build; persistOffer = true }
        if card == nil {
            let made = Card()
            made.view.primary.pressed = { [weak self] in
                guard let self else { return }
                if self.cardWaiting { self.openSettings() } else { self.requestFollow() }
            }
            made.view.secondary.pressed = { [weak self] in self?.closeCard() }
            card = made
        }
        guard let card else { return }
        card.view.contrast = NSWorkspace.shared.accessibilityDisplayShouldIncreaseContrast
        let size = card.view.fit(words: record.words, lang: record.lang, waiting: cardWaiting, width: target.visible.width - 16)
        card.panel.setFrame(aligned(Place.lineFrame(for: target, size: size)), display: true)
        card.panel.level = hit.level
        if card.panel.parent == nil { hit.addChildWindow(card.panel, ordered: .above) }
        if !card.panel.isVisible { card.panel.order(.above, relativeTo: hit.windowNumber) }
        if cardAnnounce {
            NSAccessibility.post(element: card.view, notification: .layoutChanged)
            cardAnnounce = false
        }
    }

    // ------------------------------------------------------------ around him

    var activityTarget: Place.Target? {
        guard let target = target() ?? retainedTarget else { return nil }
        return speechTarget(target)
    }
    func setActivityPresented(_ value: Bool) {
        activityPresented = value
        place(reorder: true)
    }
    func setUnseen(_ count: Int) {
        unseen = count
        // Release at zero even while he is hidden and placement returns before placeAround.
        if count == 0, let badge {
            badge.parent?.removeChildWindow(badge); badge.orderOut(nil); badge.close()
            self.badge = nil; badgeView = nil
        }
        place(reorder: false)
    }
    @objc func openActivity() { requestActivity() }
    @objc func backToClaude() { Activity.backToClaude() }
    @objc func toggleLines() {
        store.linesHidden.toggle(); updateActions(); draw(); place(reorder: false); store.save()
    }
    func pointer(_ surface: HoverState.Surface, inside: Bool) {
        guard press?.moved != true, card?.panel.isVisible != true, !activityPresented else { return }
        // Exit can arrive before the sibling panel's enter. Read geometry in the same event;
        // crossing between the two does not need a grace timer.
        let point = NSEvent.mouseLocation
        let onSprite = surface == .sprite ? inside : hit.isVisible && hit.frame.contains(point)
        let onPill = surface == .pill ? inside : hoverPanel?.isVisible == true && hoverPanel!.frame.contains(point)
        hover.pointer(.sprite, inside: onSprite, at: now / 1000)
        hover.pointer(.pill, inside: onPill, at: now / 1000)
        place(reorder: false)
    }
    private func attach(_ panel: Panel, at frame: NSRect) {
        var frame = aligned(frame)
        if Self.offscreen { frame.origin.x += 30_000 }
        panel.level = hit.level; panel.setFrame(frame, display: true)
        if panel.parent == nil { hit.addChildWindow(panel, ordered: .above) }
        if !panel.isVisible { panel.order(.above, relativeTo: hit.windowNumber) }
    }
    private func speechTarget(_ target: Place.Target) -> Place.Target {
        let overlay: NSRect?
        if hover.visible && hoverPanel?.isVisible == true {
            overlay = Place.hoverOverlay(for: target, labelWidths: HoverView.labelWidths(words: record.words, lang: record.lang,
                                                                                       visibleWidth: target.visible.intersection(target.screen).width))
        } else if bubble.isVisible {
            overlay = Place.bubbleFrame(for: target, size: bubble.frame.size)
        } else { overlay = nil }
        return Place.aroundTarget(for: target, overlay: overlay)
    }
    private func placeAround(_ target: Place.Target) {
        let blocked = press?.moved == true || card?.panel.isVisible == true
        hover.blocked(carried: press?.moved == true, card: card?.panel.isVisible == true || activityPresented)
        if hover.visible && !blocked && !activityPresented {
            if hoverPanel == nil {
                let panel = Panel(clickable: true, shadow: true), view = HoverView()
                panel.contentView = view
                view.pointer = { [weak self] inside in self?.pointer(.pill, inside: inside) }
                view.labelChanged = { [weak self] in self?.placeHoverLabel() }
                view.buttons[0].pressed = { [weak self] in self?.openActivity() }
                view.buttons[1].pressed = { [weak self] in self?.backToClaude() }
                view.buttons[2].pressed = { [weak self] in self?.toggleLines() }
                view.buttons[3].pressed = { [weak self] in self?.hideForAnHour() }
                view.buttons[4].pressed = { [weak self, weak view] in if let view { self?.sizeMenu(in: view.buttons[4]) } }
                hoverPanel = panel; hoverView = view
            }
            hoverView?.contrast = NSWorkspace.shared.accessibilityDisplayShouldIncreaseContrast
            hoverView?.configure(words: record.words, hidden: store.linesHidden, unseen: unseen)
            attach(hoverPanel!, at: Place.bubbleFrame(for: target, size: NSSize(width: 144, height: 32)))
            placeHoverLabel()
        } else { hideHoverRow() }
        if !blocked, !hover.visible, !record.rest, let task = record.task {
            bubbleView.contrast = NSWorkspace.shared.accessibilityDisplayShouldIncreaseContrast
            let size = bubbleView.fit(project: record.project, task: task, lang: record.lang, maxWidth: min(260, target.visible.width - 8))
            attach(bubble, at: Place.bubbleFrame(for: target, size: size))
        } else { bubble.orderOut(nil) }
        if unseen > 0 && press?.moved != true {
            if badge == nil {
                let panel = Panel(clickable: true, shadow: false), view = BadgeView()
                view.pressed = { [weak self] in self?.openActivity() }; panel.contentView = view
                badge = panel; badgeView = view
            }
            let size = badgeView!.fit(count: unseen, words: record.words, lang: record.lang)
            attach(badge!, at: Place.badgeFrame(for: target, size: size))
        } else if let badge {
            badge.parent?.removeChildWindow(badge); badge.orderOut(nil); badge.close()
            self.badge = nil; badgeView = nil
        }
        updateActions()
    }
    private func placeHoverLabel() {
        guard hover.visible, hoverPanel?.isVisible == true, let view = hoverView,
              let button = view.hoveredButton, let text = button.accessibilityLabel(),
              let target = target() else { hoverLabel.hide(); return }
        let buttonFrame = hoverPanel!.convertToScreen(button.convert(button.bounds, to: nil))
        var visible = target.visible.intersection(target.screen)
        if Self.offscreen { visible.origin.x += 30_000 }
        hoverLabel.show(text: text, lang: record.lang, button: buttonFrame, row: hoverPanel!.frame,
                        visible: visible, parent: hit, contrast: view.contrast)
    }
    private func hideHoverRow() {
        hoverPanel?.orderOut(nil); hoverView?.clearLabel(); hoverLabel.hide()
    }
    private func updateActions() {
        let selectors = [#selector(accessActivity), #selector(accessBack), #selector(accessLines), #selector(accessHide), #selector(accessSize)]
        hitView.setAccessibilityCustomActions(zip(HoverView.names(words: record.words, hidden: store.linesHidden), selectors).map {
            NSAccessibilityCustomAction(name: $0.0, target: self, selector: $0.1)
        })
    }
    var customActionNames: [String] { hitView.accessibilityCustomActions()?.map { $0.name } ?? [] }
    @objc private func accessActivity() -> Bool { openActivity(); return true }
    @objc private func accessBack() -> Bool { backToClaude(); return true }
    @objc private func accessLines() -> Bool { toggleLines(); return true }
    @objc private func accessHide() -> Bool { hideForAnHour(); return true }
    @objc private func accessSize() -> Bool { sizeMenu(in: hitView); return true }
    private func sizeMenu(in view: NSView) {
        let words = record.words, menu = NSMenu()
        menu.autoenablesItems = false
        for (size, title) in zip(Size.allCases, [words.tiny, words.small, words.medium, words.large]) {
            let entry = item(title, #selector(pickSize(_:))); entry.representedObject = size.rawValue
            entry.state = store.size == size ? .on : .off; menu.addItem(entry)
        }
        menu.popUp(positioning: nil, at: NSPoint(x: 0, y: view.bounds.height), in: view)
    }

    // ------------------------------------------------------------ touch

    func pressed(option: Bool) {
        press = (NSEvent.mouseLocation, hit.frame.origin, option, false, false)
        longPress.fire(after: 0.55)
    }

    func dragged() {
        guard var current = press else { return }
        let point = NSEvent.mouseLocation
        let dx = point.x - current.start.x
        let dy = point.y - current.start.y
        if !current.moved {
            guard hypot(dx, dy) >= 3 else { return }
            current.moved = true
            press = current
            longPress.cancel()
            card?.panel.orderOut(nil)
            bubble.orderOut(nil); hideHoverRow(); badge?.orderOut(nil)
            hover.blocked(carried: true, card: false)
            // Picked up: above everything while carried.
            for panel in [hit, look, speech] where panel.level != .floating { panel.level = .floating }
            hit.orderFrontRegardless()
            dragOrigin = CGPoint(x: current.origin.x + dx, y: current.origin.y + dy)
            react(.dragStart)
            return
        }
        dragOrigin = CGPoint(x: current.origin.x + dx, y: current.origin.y + dy)
        carry()
    }

    func released() {
        longPress.cancel()
        guard let current = press else { return }
        press = nil
        if current.moved {
            // Put down: what the drop means is kept, then he is placed by it.
            if let target = target() {
                if windowFillsScreen {
                    store.full = Place.fractions(target.frame, visible: target.visible, screen: target.screen)
                } else {
                    let window: CGRect? = if case let .window(frame, _, _, _, _, _) = sighting { frame } else { nil }
                    store.manual = Place.manual(forDrop: target.frame, window: window, visible: target.visible, screen: target.screen)
                }
                trace.say("pet: dropped, \(windowFillsScreen ? "full-screen spot" : String(describing: store.manual!))")
            }
            dragOrigin = nil
            react(.drop)
            place(reorder: true)
            store.save()
            return
        }
        if current.held { return } // the long press already had its reaction
        react(.click(option: current.option))
    }

    /// VoiceOver's press: a pat.
    func pat() {
        react(.click(option: false))
    }

    private func react(_ event: Reactor.Event) {
        let reaction = reactor.react(event, at: now / 1000, mood: record.mood, lines: record.reactions, random: Double.random(in: 0..<1))
        self.reaction = (reaction.frame, now + reaction.hold * 1000)
        if let line = reaction.line { reactionLine = (line, now + reaction.lineHold * 1000) }
        trace.say("pet: \(reaction.key) \(reaction.frame) \(reaction.line ?? "(same line)")")
        loopKey = nil
        draw()
        if !reduceMotion { animate(reaction.key) }
        armReactionEnd()
    }

    // The next moment a reaction's face or line runs out.
    private func armReactionEnd() {
        let ends = [reaction?.until, reactionLine?.until].compactMap { $0 }.filter { $0 > now }
        guard let next = ends.min() else {
            reactionEnd.cancel()
            return
        }
        reactionEnd.fire(after: (next - now) / 1000)
    }

    private func animate(_ key: String) {
        let picture = lookView.picture
        switch key {
        case "pat", "drop":
            let squash = CASpringAnimation(keyPath: "transform.scale.y")
            squash.fromValue = key == "pat" ? 0.88 : 0.93
            squash.toValue = 1
            let widen = CASpringAnimation(keyPath: "transform.scale.x")
            widen.fromValue = key == "pat" ? 1.06 : 1.03
            widen.toValue = 1
            for spring in [squash, widen] {
                spring.mass = 0.5
                spring.stiffness = 260
                spring.damping = 9
                spring.duration = spring.settlingDuration
            }
            picture.add(squash, forKey: "pat-y")
            picture.add(widen, forKey: "pat-x")
        case "flustered":
            let shake = CAKeyframeAnimation(keyPath: "transform.rotation.z")
            shake.values = [0, -0.07, 0.07, -0.045, 0.045, 0]
            shake.duration = 0.36
            picture.add(shake, forKey: "shake")
        default:
            break
        }
    }

    func contextMenu() -> NSMenu {
        let words = record.words
        let menu = NSMenu()
        menu.autoenablesItems = false
        let sizes = NSMenu()
        for size in Size.allCases {
            let title = switch size {
            case .tiny: words.tiny
            case .small: words.small
            case .medium: words.medium
            case .large: words.large
            }
            let item = item(title, #selector(pickSize(_:)))
            item.representedObject = size.rawValue
            item.state = store.size == size ? .on : .off
            sizes.addItem(item)
        }
        let sizeItem = NSMenuItem(title: words.size, action: nil, keyEquivalent: "")
        sizeItem.submenu = sizes
        menu.addItem(sizeItem)
        let names = HoverView.names(words: words, hidden: store.linesHidden)
        menu.addItem(item(names[0], #selector(openActivity)))
        menu.addItem(item(names[1], #selector(backToClaude)))
        menu.addItem(item(names[2], #selector(toggleLines)))
        if !store.trusted { menu.addItem(item(words.followMenu, #selector(askToFollow))) }
        menu.addItem(item(words.hide, #selector(hideForAnHour)))
        menu.addItem(item(words.home, #selector(putBack)))
        menu.addItem(.separator())
        menu.addItem(item(words.quit, #selector(quit)))
        return menu
    }
    func menu(for event: NSEvent?, in view: NSView) {
        let menu = contextMenu()
        if let event {
            NSMenu.popUpContextMenu(menu, with: event, for: view)
        } else {
            menu.popUp(positioning: nil, at: NSPoint(x: 0, y: view.bounds.height), in: view)
        }
    }

    private func item(_ title: String, _ action: Selector) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
        item.target = self
        return item
    }

    @objc private func pickSize(_ sender: NSMenuItem) {
        guard let raw = sender.representedObject as? String, let size = Size(rawValue: raw) else { return }
        setSize(size, at: now)
    }

    func setSize(_ size: Size, at: Double) {
        store.sizeAt = at
        store.size = size
        frames.keep(size, scale: scale) // the other sizes' pictures are not needed now
        loopKey = nil
        draw()
        place(reorder: true)
        store.save()
        trace.say("pet: size \(size.rawValue)")
    }

    @objc private func hideForAnHour() {
        store.hiddenUntil = Date().timeIntervalSince1970 + 3600
        place(reorder: true)
        snoozeEnd.fire(after: 3600)
        store.save()
    }

    /// Back to the automatic places (or, while a window fills the screen, forget the spot there).
    @objc private func putBack() {
        if mode == .free { store.full = nil } else { store.manual = nil }
        lastShown = nil
        place(reorder: true)
        store.save()
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }

    // ------------------------------------------------------------ helpers

    private func scaleOf(_ screen: CGRect) -> CGFloat {
        NSScreen.screens.first { $0.frame == screen }?.backingScaleFactor
            ?? NSScreen.screens.first { $0.frame.intersects(screen) }?.backingScaleFactor
            ?? NSScreen.main?.backingScaleFactor ?? 2
    }

    /// On whole device pixels, so his picture lands 1:1.
    private func aligned(_ rect: NSRect) -> NSRect {
        NSRect(
            x: (rect.minX * scale).rounded() / scale, y: (rect.minY * scale).rounded() / scale,
            width: (rect.width * scale).rounded() / scale, height: (rect.height * scale).rounded() / scale
        )
    }
}

final class LookView: NSView {
    let picture = CALayer()

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.masksToBounds = false
        picture.anchorPoint = CGPoint(x: 0.5, y: 0)
        picture.contentsGravity = .resize
        picture.magnificationFilter = .nearest
        picture.minificationFilter = .nearest
        layer?.addSublayer(picture)
        setAccessibilityElement(false)
    }

    convenience init() { self.init(frame: .zero) }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    func show(_ still: CGImage, scale: CGFloat) {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        picture.contentsScale = scale
        picture.contents = still
        CATransaction.commit()
    }

    func fit(_ size: NSSize) {
        guard picture.bounds.size != size else { return }
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        picture.bounds = CGRect(origin: .zero, size: size)
        picture.position = CGPoint(x: size.width / 2, y: 0)
        CATransaction.commit()
    }
}

// The click target: his current frame drawn at alpha 1/255 into the window (no layer of its own),
// so the window server lets clicks on the clear pixels around him fall through. It is also what
// VoiceOver finds: a button named after him whose press is a pat.
final class HitView: NSView {
    weak var pet: Pet?
    private var tracking: NSTrackingArea?
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking { removeTrackingArea(tracking) }
        let next = NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self)
        addTrackingArea(next); tracking = next
    }
    override func mouseEntered(with event: NSEvent) { pet?.pointer(.sprite, inside: true) }
    override func mouseExited(with event: NSEvent) { pet?.pointer(.sprite, inside: false) }
    var silhouette: CGImage? { didSet { if silhouette !== oldValue { needsDisplay = true } } }

    override init(frame: NSRect) {
        super.init(frame: frame)
        setAccessibilityElement(true)
        setAccessibilityRole(.button)
    }

    convenience init() { self.init(frame: .zero) }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    override var isOpaque: Bool { false }

    override func draw(_ dirtyRect: NSRect) {
        guard let silhouette, let context = NSGraphicsContext.current?.cgContext else { return }
        context.clear(bounds)
        context.setAlpha(1 / 255)
        context.interpolationQuality = .none
        context.draw(silhouette, in: bounds)
    }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func mouseDown(with event: NSEvent) {
        if event.modifierFlags.contains(.control) {
            pet?.menu(for: event, in: self)
            return
        }
        pet?.pressed(option: event.modifierFlags.contains(.option))
    }

    override func mouseDragged(with event: NSEvent) {
        pet?.dragged()
    }

    override func mouseUp(with event: NSEvent) {
        if event.modifierFlags.contains(.control) { return }
        pet?.released()
    }

    override func rightMouseDown(with event: NSEvent) {
        pet?.menu(for: event, in: self)
    }

    override func accessibilityHelp() -> String? {
        pet?.patHint
    }

    override func accessibilityPerformPress() -> Bool {
        pet?.pat()
        return true
    }

    override func accessibilityPerformShowMenu() -> Bool {
        if let pet { pet.menu(for: nil, in: self) }
        return true
    }
}

// His line: a small paper label, never a box of characters. Colours from his palette, measured with
// the WCAG formula: warm black #231B19 on cream #FAEEE9 is 14.9:1, cream on #2B2220 is 13.7:1. An
// omen slip keeps cream paper in dark mode too, with a vermilion band at the top like the band's
// slip. Increase Contrast adds a solid border in the ink colour. Set in the system serif, a little
// larger as he gets larger.
final class SpeechView: NSView {
    private let text = NSTextField(wrappingLabelWithString: "")
    private let band = CALayer()
    var contrast = false { didSet { if contrast != oldValue { needsDisplay = true } } }
    var slip = false { didSet { if slip != oldValue { needsDisplay = true } } }
    var fontSize: CGFloat = 13 {
        didSet { if fontSize != oldValue { text.font = Self.font(fontSize) } }
    }

    static func font(_ size: CGFloat) -> NSFont {
        let base = NSFont.systemFont(ofSize: size)
        if let serif = base.fontDescriptor.withDesign(.serif), let font = NSFont(descriptor: serif, size: size) { return font }
        return base
    }

    // Songti SC is the system serif's CJK fallback here, but has no half-width punctuation
    // alternates. Keep it for the words; Hiragino Mincho supplies matching serif punctuation.
    // `halt` leaves its full-width question mark unchanged, so use `hwid` only on punctuation.
    // A separate attributed run also prevents Core Text from folding a mark into the adjacent
    // Songti run. Zero kerning on those marks keeps CJK auto-spacing from adding the width back.
    private static func isCompactPunctuation(_ scalar: Unicode.Scalar) -> Bool {
        CharacterSet.punctuationCharacters.contains(scalar)
            && ((0x3000...0x303F).contains(scalar.value) || (0xFE10...0xFE1F).contains(scalar.value)
                || (0xFE30...0xFE4F).contains(scalar.value) || (0xFF01...0xFF60).contains(scalar.value))
    }

    static func attributedLine(_ line: String, fontSize: CGFloat) -> NSAttributedString {
        let base = font(fontSize)
        let value = NSMutableAttributedString(string: line, attributes: [.font: base])
        guard line.unicodeScalars.contains(where: isCompactPunctuation),
              let mincho = NSFont(name: "Hiragino Mincho ProN", size: fontSize) else { return value }
        let features: [[NSFontDescriptor.FeatureKey: Int]] = [
            [.typeIdentifier: kTextSpacingType, .selectorIdentifier: kHalfWidthTextSelector]
        ]
        let fallback = mincho.fontDescriptor.addingAttributes([.featureSettings: features])
        // Set the feature on the explicit CJK cascade entry as well as the primary descriptor:
        // otherwise the Latin font's own unsupported feature never reaches the fallback glyphs.
        let descriptor = base.fontDescriptor.addingAttributes([
            .cascadeList: [fallback], .featureSettings: features
        ])
        guard let compact = NSFont(descriptor: descriptor, size: fontSize) else { return value }
        var offset = 0
        for scalar in line.unicodeScalars {
            let length = scalar.utf16.count
            if isCompactPunctuation(scalar) {
                value.addAttributes([.font: compact, .kern: 0], range: NSRange(location: offset, length: length))
            }
            offset += length
        }
        return value
    }

    private static let padX: CGFloat = 8
    private static let padY: CGFloat = 4

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layerContentsRedrawPolicy = .onSetNeedsDisplay
        text.font = Self.font(fontSize)
        text.isSelectable = false
        text.drawsBackground = false
        text.isBezeled = false
        text.lineBreakMode = .byWordWrapping
        text.maximumNumberOfLines = 5
        text.cell?.truncatesLastVisibleLine = true
        addSubview(text)
        band.isHidden = true
        layer?.addSublayer(band)
        setAccessibilityElement(false)
    }

    convenience init() { self.init(frame: .zero) }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    override var wantsUpdateLayer: Bool { true }
    override var isFlipped: Bool { true }
    override func accessibilityChildren() -> [Any]? { [] } // VoiceOver hears the line on his sprite

    override func updateLayer() {
        let dark = !slip && effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        let cream = NSColor(srgbRed: 0xFA / 255, green: 0xEE / 255, blue: 0xE9 / 255, alpha: 1)
        let paper = dark ? NSColor(srgbRed: 0x2B / 255, green: 0x22 / 255, blue: 0x20 / 255, alpha: 1) : cream
        let ink = dark ? cream : NSColor(srgbRed: 0x23 / 255, green: 0x1B / 255, blue: 0x19 / 255, alpha: 1)
        layer?.backgroundColor = paper.cgColor
        layer?.cornerRadius = 7
        layer?.masksToBounds = true
        layer?.borderWidth = contrast ? 1 : 0.5
        layer?.borderColor = (contrast ? ink : ink.withAlphaComponent(0.16)).cgColor
        text.textColor = ink
        band.isHidden = !slip
        band.backgroundColor = NSColor(srgbRed: 0xC7 / 255, green: 0x57 / 255, blue: 0x30 / 255, alpha: 1).cgColor
        band.frame = CGRect(x: 0, y: 0, width: bounds.width, height: 3)
    }

    /// Sets the line and returns the label's size: one line when it fits, wrapped up to five lines
    /// within `maxWidth`, cut with an ellipsis where `maxHeight` allows fewer.
    func fit(_ line: String, maxWidth: CGFloat, maxHeight: CGFloat) -> NSSize {
        text.attributedStringValue = Self.attributedLine(line, fontSize: fontSize)
        let font = text.font ?? Self.font(fontSize)
        let lineHeight = ceil(font.ascender - font.descender + font.leading)
        let top = slip ? Self.padY + 2 : Self.padY
        let lines = max(1, min(5, Int((maxHeight - top - Self.padY) / lineHeight)))
        text.maximumNumberOfLines = lines
        let inner = max(20, maxWidth - 2 * Self.padX)
        var size = text.cell?.cellSize(forBounds: NSRect(x: 0, y: 0, width: inner, height: CGFloat(lines) * lineHeight + 2)) ?? .zero
        size.width = min(ceil(size.width), inner)
        size.height = min(ceil(size.height), CGFloat(lines) * lineHeight + 2)
        text.frame = NSRect(x: Self.padX, y: top, width: size.width, height: size.height)
        needsDisplay = true
        return NSSize(width: size.width + 2 * Self.padX, height: size.height + top + Self.padY)
    }
}
