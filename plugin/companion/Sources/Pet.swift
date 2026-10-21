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

/// Whether screenshots, recordings and shared screens show him: on by default; off keeps every window of his out
/// (the public WindowServer exclusion; modern capture clients may override it). Owner 10-20: a switch, on by default.
@MainActor enum Capture {
    static var shown = true {
        didSet { for window in NSApp.windows where window is Panel || window is ActivityPanel { window.sharingType = sharing } }
    }
    static var sharing: NSWindow.SharingType { shown ? .readOnly : .none }
}

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
        sharingType = Capture.sharing
        isExcludedFromWindowsMenu = true
        collectionBehavior = [.moveToActiveSpace, .fullScreenNone, .ignoresCycle]
    }

    // Borderless panels may sit partly below the bottom of the screen (he peeks up from there).
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }
}

/// Coco's size, chosen in the pet's menu and kept in its settings: Medium 128, Large 186 (the
/// default) and Larger 256 points, all painted (owner 10-18: every size up, Large much bigger and
/// the default; after seeing them, Small and the two pixel-head sizes gone and Large at 186). The
/// pictures are 361 px tall, so at 2x both Large and Larger draw them scaled up.
enum Size: String, CaseIterable {
    case medium, large, larger

    /// Settings and requests from before 10-18 may still name «tiny» or «small»; Medium is the smallest size now.
    init?(name: String) { self.init(rawValue: name == "tiny" || name == "small" ? "medium" : name) }

    /// No size draws the pixel heads any more; their paths leave with the old frames.
    var pixelArt: Bool { false }

    var height: CGFloat {
        switch self {
        case .medium: 128
        case .large: 186
        case .larger: 256
        }
    }

    var fontSize: CGFloat {
        switch self {
        case .medium: 17
        case .large: 19
        case .larger: 21
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
            picture.removeAnimation(forKey: "tool-patch-loop")
            cached = nil
            return false
        }
        if wanted == cached, picture.animation(forKey: "loop") != nil { return false }
        picture.removeAnimation(forKey: "loop")
        picture.removeAnimation(forKey: "tool-patch-loop")
        cached = nil
        return true
    }
}

struct CompanionScreenGeometry {
    var frame: CGRect
    var visibleFrame: CGRect
    var backingScaleFactor: CGFloat
}

/// Screen values at an event boundary; fixtures supply geometry without a display connection.
struct CompanionScreens {
    var main: CompanionScreenGeometry?
    var screens: [CompanionScreenGeometry]
    @MainActor static func current() -> CompanionScreens {
        func geometry(_ screen: NSScreen) -> CompanionScreenGeometry {
            .init(frame: screen.frame, visibleFrame: screen.visibleFrame, backingScaleFactor: screen.backingScaleFactor)
        }
        return .init(main: NSScreen.main.map(geometry), screens: NSScreen.screens.map(geometry))
    }
    func scale(of frame: CGRect) -> CGFloat {
        screens.first { $0.frame == frame }?.backingScaleFactor
            ?? screens.first { $0.frame.intersects(frame) }?.backingScaleFactor
            ?? main?.backingScaleFactor ?? 2
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
    private let lanterns = Lanterns()
    private let d1Helpers = D1Helpers()
    private let d1Silhouette = D1Silhouette()
    private let d1RibbonPanel = Panel(clickable:false,shadow:false)
    private let d1RibbonView = D1RibbonView()
    private let d1Shed = D1ShedOverlay()
    private let d1Visitor = D1VisitorOverlay()
    private lazy var d1FrameEnd = OneShot { [weak self] in
        guard let self else {return}
        if let shed=self.record.shed,shed.phase == "end",self.now-shed.at >= 1600,!self.reduceMotion,!self.store.size.pixelArt {self.poseDip(y:0.975,x:1.0075,delayMs:0,key:"d1-shed-back")}
        self.draw();self.place(reorder:false)
    }
    private let bubble = Panel(clickable: false, shadow: true)
    private let bubbleView = BubbleView()
    private var badge: Panel?
    private var badgeView: BadgeView?
    private var hoverPanel: Panel?
    private var hoverView: HoverView?
    private let hoverLabel = ButtonLabel()
    private var hover = HoverState()
    private var unseen = 0
    /// Her messages are among the unread: the badge opens the thread.
    private var badgeOpensDm = false
    private var activityPresented = false
    private var retainedTarget: Place.Target?
    var requestActivity: () -> Void = {}
    /// The Activity window on her DM thread (DmThread.swift).
    var requestDm: () -> Void = {}
    var placementChanged: (_ target: Place.Target?, _ relocating: Bool) -> Void = { _, _ in }
    var targetBundleID = Claude.bundleID
    var presentationSuppressed = false
    private var card: Card?
    private var cardWaiting = false
    private var cardWanted = false
    private var cardAnnounce = false
    var requestFollow: () -> Void = {}
    /// Registers or removes the login item (the app does the work, as for the book's switch).
    var setLogin: (Bool) -> Void = { _ in }
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
    // Play: the shake and its spin, the lid's nap, his stick. `fed` is the record as the feed sent it.
    private var fed = Record.resting
    private var shake = ShakeDetector()
    private var lastSpinAt = -Double.infinity
    private var nap: Nap?
    private let stickLayer = CALayer()
    private var tuning = CompanionTuning.standard
    private var preparedKey = ""
    private let allowsWindowPresentation: Bool
    private let screens: @MainActor () -> CompanionScreens
    private let nowMilliseconds: @MainActor () -> Double
    private var touchPreparationID = 0
    private var activeTouch: (sequence: TouchSequence, base: String, began: Double, timeline: [CompanionTuning.Step], rate: Double)?
    private var localTouchAt = 0.0
    private var gestureAt = 0.0
    private var patStartedAt: Double?
    private var wakeUntil = 0.0
    private var wakeEventAt = 0.0
    private var heldWakePress = false
    private var wakeLineAt = 0.0
    private var wakeLine: String?
    private var queuedReaction: Reactor.Reaction?
    private var cling = CompanionCling()
    private var squeeze = CompanionSqueeze()
    private var windowGestureLive = false
    private var geometryAt: Double?
    private var logicalVisible = false
    private var relocating = false
    private var pendingPlacement: Place.Target?
    private var placementSerial = 0
    private var clingSerial = 0
    private var faceSerial = 0
    private var squeezeAxis = Place.Contact.Axis.none
    private var squeezeFace = false
    private var squeezeSerial = 0
    private lazy var squeezeFaceEnd = OneShot { [weak self] in
        guard let self else { return }
        self.squeezeFace = false
        self.lookView.picture.removeAnimation(forKey: "window-face"); self.preparedKey = ""; self.prepareFrames(); self.draw()
        if let geometryAt = self.geometryAt { self.applyCling(at: max(geometryAt, CACurrentMediaTime()), released: !self.windowGestureLive) }
    }
    private var squeezePush = 0.0
    private var clingFaceOnAt: Double?
    private var clingFaceOpenAt: Double?
    private var clingFaceStopAt: Double?
    private var clingFacePredictedStopAt: Double?
    private var explicitSummonFallback = false
    private var rides = 0
    private var lastRide = -Double.infinity
    private var ridePeak = 0.0
    private var ridePeakAt = 0.0
    private var pixelShift = 0
    private var deliberatePointer = false
    private var pointerSample: (point: CGPoint, at: Double)?
    private var pointerSpeed = 0.0
    private var glanceFace: String?
    private var speechFade = CompanionPointerFade()
    private var bubbleFade = CompanionPointerFade()
    private let speechMotion = CompanionPanelMotion()
    private let cardMotion = CompanionPanelMotion()
    private let bubbleMotion = CompanionPanelMotion()
    private lazy var speechRestore = OneShot { [weak self] in self?.restorePointerLine() }
    private lazy var bubbleRestore = OneShot { [weak self] in self?.restorePointerPill() }
    private lazy var hoverDeadline = OneShot { [weak self] in self?.advanceHover() }
    private lazy var relaxPointer = OneShot { [weak self] in self?.relaxPerk() }
    private lazy var entryLine = OneShot { [weak self] in self?.restoreEntryLine() }
    private lazy var entryBlink = OneShot { [weak self] in self?.blinkAfterEntry() }
    private lazy var rideLineTimer = OneShot { [weak self] in self?.showRideLine() }
    private var pendingRideLine: Reactor.RideLine?
    private var pendingRideReactor: Reactor?
    private var entryLineHidden = false
    private var hourLeaving = false
    private lazy var hourWaveEnd = OneShot { [weak self] in self?.finishHourWave() }
    private var returnGreeting = false
    private lazy var greetingAfterPop = OneShot { [weak self] in
        guard let self, self.returnGreeting, self.logicalVisible else { return }
        self.returnGreeting = false
        self.showReaction(Reactor.Reaction(key: "wave", frame: "wave", hold: self.tuning.touch.greetingMs / 1000, line: nil, lineHold: self.tuning.touch.lineHoldMs / 1000))
    }
    var pointerPosition: () -> NSPoint = { NSEvent.mouseLocation }
    private(set) var touchVisualUpdates = 0
    private(set) var touchPlan: TouchSequence?
    var shownMood: String { record.mood }
    var shownReactionKey: String? { reactor.lastKey }
    var touchFrame: String? { reaction?.frame }
    var pressAnimationDuration: Double? { lookView.picture.animation(forKey: "press")?.duration }
    var wakeDeadline: Double { wakeUntil }
    var hasPlacement: Bool { target() != nil }
    var summonFallbackActive: Bool {
        // A queued greeting has not begun its own lifetime. A placement event at the outgoing
        // wake deadline must keep its place until the wake callback starts the wave.
        explicitSummonFallback && !snoozed && !presentationSuppressed
            && (queuedReaction?.key == "wave" || (reaction?.frame == "wave" && (reaction?.until ?? 0) > now))
    }
    var motionPreference: () -> Bool = { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion } {
        didSet { cachedReduceMotion = motionPreference() }
    }
    private var cachedReduceMotion: Bool?
    var contrastPreference: () -> Bool = { NSWorkspace.shared.accessibilityDisplayShouldIncreaseContrast }
    var transparencyPreference: () -> Bool = { NSWorkspace.shared.accessibilityDisplayShouldReduceTransparency }
    private var cachedReduceTransparency = false
    var touchActive: Bool { reaction.map { $0.until > now } ?? false }
    private var pointerMonitor: Any?
    private var pointerMeter = CompanionPointerMeter()
    var pointerMonitorMeasured: (CompanionPointerPeriod) -> Void = { _ in }
    var touched: (_ kind: String, _ at: Double) -> Void = { _,_ in }
    private lazy var wakeLineTimer = OneShot { [unowned self] in
        if let wakeLine { reactionLine = (wakeLine, now + tuning.touch.lineHoldMs); place(reorder: false); armReactionEnd() }
    }
    private lazy var wakeEnd = OneShot { [unowned self] in
        wakeUntil = 0
        if let queuedReaction { self.queuedReaction = nil; showReaction(queuedReaction,afterWake: true) }
        else { reaction = nil; activeTouch = nil; preparedKey = ""; prepareFrames(); draw(); place(reorder: false) }
    }
    private var reaction: (frame: String, until: Double)?
    /// What the reaction above answers (pat, hold, flustered, drag, drop, spin, wake, wave), for Coco's player.
    private var touchKey: String? { didSet { cocoEvent() } }
    // Coco's player (CocoModel.swift, CocoRender.swift). When their clips load from assets/coco they are drawn on their
    // own layer, a frame every 33 ms while they move, as companion-rs draws them; the painted frames stay under it,
    // hidden, until the second batch of the old figure's removal.
    private var coco: CocoPlayer?
    private let cocoPaint = CocoPaint()
    private var cocoFlips = 0
    private var cocoShedSeen: String?
    private var cocoSocksTried: String?? = .none
    private var cocoEventAt = 0.0
    private var claudieCells: CocoClaudieCells?
    private var claudieFailed: [String: Double] = [:] // form -> when it could not be read (ms)
    private lazy var cocoTick: OneShot = OneShot { [unowned self] in _ = drawCoco() }
    private var reactionLine: (text: String, until: Double)?
    private var press: (start: NSPoint, origin: NSPoint, option: Bool, moved: Bool, held: Bool)?
    private var dragOrigin: CGPoint?
    private var carriedInFullScreen = false
    private lazy var recheck: OneShot = OneShot { [unowned self] in
        recheckAt = nil
        draw()
    }
    private lazy var reactionEnd: OneShot = OneShot { [unowned self] in
        if record.mood == "idle" { gazeBlink = true; loopKey = nil }
        if !touchActive { activeTouch = nil; preparedKey = ""; prepareFrames() }
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
    private lazy var snoozeEnd: OneShot = OneShot { [unowned self] in comeBack() }
    private lazy var spinLine: OneShot = OneShot { [unowned self] in saySpinLine() }
    private lazy var spinEnd: OneShot = OneShot { [unowned self] in spinFinished() }
    private lazy var napWake: OneShot = OneShot { [unowned self] in napFinished() }
    private lazy var stickTick: OneShot = OneShot { [unowned self] in stickChanged() }

    init(frames: Frames, store: Store, trace: Trace, allowsWindowPresentation: Bool = true,
         screens: @escaping @MainActor () -> CompanionScreens = { .current() },
         nowMilliseconds: @escaping @MainActor () -> Double = { Date().timeIntervalSince1970 * 1000 }) {
        self.frames = frames
        self.store = store
        self.trace = trace
        self.allowsWindowPresentation = allowsWindowPresentation
        self.screens = screens
        self.nowMilliseconds = nowMilliseconds
        super.init()
        cachedReduceMotion = motionPreference()
        cachedReduceTransparency = transparencyPreference()
        look.contentView = lookView
        hit.contentView = hitView
        speech.contentView = speechView
        bubble.contentView = bubbleView
        d1RibbonPanel.contentView=d1RibbonView
        hitView.pet = self
        d1Shed.folder = frames.assetRoot.appendingPathComponent("shed")
        d1Visitor.folder = frames.assetRoot.appendingPathComponent("visitors")
        coco = try? CocoPlayer(folder: frames.assetRoot.appendingPathComponent("coco", isDirectory: true))
        if coco != nil { trace.say("pet: coco's clips loaded") }

        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(occlusionMoved), name: NSWindow.didChangeOcclusionStateNotification, object: look)
        center.addObserver(self, selector: #selector(scaleMoved), name: NSWindow.didChangeBackingPropertiesNotification, object: look)
        NSWorkspace.shared.notificationCenter.addObserver(
            self, selector: #selector(displayOptionsMoved), name: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, object: nil
        )
        if snoozed, store.hiddenUntil < Self.hiddenForever { snoozeEnd.fire(after: store.hiddenUntil - Date().timeIntervalSince1970) }
    }

    private var reduceMotion: Bool { !Self.ignoreReduceMotion && (cachedReduceMotion ?? motionPreference()) }
    private var snoozed: Bool { store.hiddenUntil > Date().timeIntervalSince1970 }
    private var now: Double { nowMilliseconds() }
    private var height: CGFloat { store.size.height }
    /// The painted pixel frames move in whole art pixels; Coco is drawn smooth at every size (companion-rs smooth_art).
    private var pixelSteps: Bool { store.size.pixelArt && coco == nil }

    // ------------------------------------------------------------ inputs

    func neighbours(_ snapshot: NeighbourSnapshot, enabled: Bool) {
        lanterns.update(snapshot, enabled:enabled)
        if let target = target() { placeLanterns(target) }
    }
    private func placeLanterns(_ target: Place.Target) {
        let sprite=store.size.pixelArt ? d1Silhouette.frame(hitView.silhouette,sprite:target.frame):target.frame
        lanterns.place(sprite:sprite,speech:speech.isVisible ? speech.frame : nil,parent:hit,
            reduceMotion:reduceMotion,present:allowsWindowPresentation && hit.isVisible,pixel:store.size.pixelArt,artPoint:CGFloat(artPixelPoints),
            busyWord:{ [record] agent in record.neighbourBusy.replacingOccurrences(of:"{agent}",with:agent) })
    }

    private func placeD1(_ target:Place.Target) {
        let present=allowsWindowPresentation && hit.isVisible && !Self.offscreen
        if present,bubble.isVisible,let ribbon=record.ribbon {
            d1RibbonView.index=ribbon;d1RibbonView.appearance=bubble.effectiveAppearance
            d1RibbonView.setAccessibilityLabel(record.ribbonAlt)
            attach(d1RibbonPanel,at:CGRect(x:bubble.frame.minX+12,y:bubble.frame.maxY-16,width:8,height:22))
            d1RibbonPanel.order(.above,relativeTo:bubble.windowNumber)
        } else {d1RibbonPanel.orderOut(nil)}
        var helperSprite=d1Silhouette.frame(hitView.silhouette,sprite:target.frame)
        if target.mode == .ledge {helperSprite.origin.y=target.window.maxY}
        d1Helpers.show(record.ended ? []:record.helpers,sprite:helperSprite,speech:speech.isVisible ? speech.frame:nil,parent:hit,
            size:store.size,artPoint:CGFloat(artPixelPoints),reduced:reduceMotion,present:present,label:record.helpersAlt,now:now)
        let activeShed=record.ended ? nil:record.shed
        d1Shed.show(coco == nil ? activeShed:nil,picture:lookView.picture,target:target,size:store.size,scale:scale,now:now,
            reduced:reduceMotion,present:present,parent:hit)
        d1Visitor.show(record.ended ? nil:record.visitor,asleep:record.mood == "sleep",picture:artLayer,size:store.size,scale:scale,
            dark:hit.effectiveAppearance.bestMatch(from:[.aqua,.darkAqua]) == .darkAqua,now:now,reduced:reduceMotion,present:present,coco:coco != nil)
        updateStick()
        d1FrameEnd.cancel()
        if present,let shed=activeShed,shed.phase == "end",now >= shed.at,now-shed.at < 1600 {
            let steps=store.size.pixelArt && !reduceMotion ? [160.0,360,960,1600]:[1600]
            if let next=steps.first(where: {shed.at+$0 > now}) {d1FrameEnd.fire(after:(shed.at+next-now)/1000)}
        }
    }

    func show(_ record: Record) {
        cocoEventAt = now
        let shedChanged=record.shed != self.record.shed
        let poseChanged = record.pose?.at != self.record.pose?.at || record.pose?.name != self.record.pose?.name
        if record.motion != self.record.motion || record.mood == "idle" && (self.record.mood != "idle" || record.said != self.record.said) { loopKey = nil; gazeBlink = true }
        self.fed = record
        self.record = playing(TouchAwake.applying(record, after: localTouchAt))
        if record.mood == "sleep" || Reactor.urgent.contains(record.mood) { clearWindowFace(); clearPerk() }
        prepareFrames()
        updateActions()
        draw()
        place(reorder: false)
        if shedChanged,let shed=record.shed,["begin","skip"].contains(shed.phase),!reduceMotion,!store.size.pixelArt {
            poseDip(y:0.975,x:1.0075,delayMs:0,key:"d1-shed-entry")
        }
        if poseChanged && record.pose != nil && record.pose?.name != "cheer" && !reduceMotion {
            poseDip(y:0.975,x:1.0075,delayMs:0,key:"c3-entry")
            if let pose=record.pose, pose.name == "run" || pose.name == "helper" {poseDip(y:0.975,x:1.0075,delayMs:pose.name == "run" ? 420:900,key:"c3-handoff")}
        }
    }

    /// His hello changes only the frame: no new line, and the hour's hide is cleared on disk too.
    func comeBack() {
        hourLeaving = false; hourWaveEnd.cancel()
        let wasVisible = logicalVisible
        let sleeping = record.mood == "sleep"
        awakenLocally(); gestureAt = localTouchAt; touched("pat", localTouchAt)
        store.hiddenUntil = 0
        snoozeEnd.cancel()
        explicitSummonFallback = false
        explicitSummonFallback = target() == nil
        if !wasVisible, target() != nil {
            returnGreeting = true; preparedKey = ""; prepareFrames(); draw(); place(reorder: true); store.save(); return
        }
        if sleeping {
            queuedReaction = Reactor.Reaction(key: "wave",frame: "wave",hold: tuning.touch.greetingMs / 1000,line: nil,lineHold: tuning.touch.lineHoldMs / 1000)
            startWake(held: false)
        } else {
            showReaction(Reactor.Reaction(key: "wave",frame: "wave",hold: tuning.touch.greetingMs / 1000,line: nil,lineHold: tuning.touch.lineHoldMs / 1000))
        }
        lookView.picture.removeAnimation(forKey: "loop")
        loopKey = nil
        draw()
        place(reorder: true)
        armReactionEnd()
        store.save()
    }

    func follow(_ sighting: Claude.Sighting, reorder: Bool) {
        self.sighting = sighting
        if case .window = sighting { explicitSummonFallback = false }
        if case .corner = sighting { explicitSummonFallback = false }
        place(reorder: reorder)
    }

    func configure(_ value: CompanionTuning) {
        let pointerChanged = tuning.pointer != value.pointer
        let reducedPointer = tuning.pointer.near == .full && value.pointer.near == .reduced
        if pointerChanged { stopPointerMonitor() }
        let presentationTime = CACurrentMediaTime()
        if geometryAt != nil { cling.rebase(at: presentationTime, released: !windowGestureLive) }
        if let target = retainedTarget, squeezeAxis != .none {
            _ = squeeze.update(at: presentationTime, roomOverSize: Place.contact(for: target, motion: tuning.motion).rawScale)
        }
        tuning = value; reactor.tuning = value.touch; cling.tuning = value.motion; squeeze.tuning = value.motion
        preparedKey = ""; prepareFrames()
        draw(); place(reorder: false)
        if let target = retainedTarget, logicalVisible, !relocating { applySqueeze(target, at: presentationTime) }
        if geometryAt != nil { applyCling(at: presentationTime, released: !windowGestureLive) }
        if pointerChanged {
            if reducedPointer && pointerSample == nil { leaveReducedPointerPill(at: presentationTime) }
            installPointerMonitor()
        }
    }
    func assetsChanged() {
        faceSerial += 1; lookView.picture.removeAnimation(forKey: "window-face")
        preparedKey = ""; prepareFrames(); draw(); place(reorder: false)
        if geometryAt != nil { applyCling(at: CACurrentMediaTime(), released: !windowGestureLive) }
    }
    private func prepareFrames() {
        let current = lookView.picture.presentation()?.contents.map { $0 as! CGImage } ?? lookView.picture.contents.map { $0 as! CGImage }
        let displayed = touchActive ? current.flatMap { frames.baseName(of: $0) } : nil
        let requested = [record.frame] + (record.shed != nil ? ["snake","shed-a","shed-b","shed-c"]:[]) + (record.pose != nil ? ToolPoseTimeline.frames : []) + (record.loop ?? []) + (displayed.map { [$0] } ?? [])
            + (touchActive ? activeTouch.map { [$0.base] } ?? [] : [])
            + (touchActive ? reaction.map { [$0.frame] } ?? [] : []) + (record.mood == "sleep" ? ["idle-reading"] : [])
            + (record.mood == "idle" && record.frame == "idle-reading" && record.loop == nil && !reduceMotion ? ["idle-blink"] : [])
        let names = Array(Set(requested.compactMap { frames.resolveName($0,size: store.size) })).sorted()
        let firstFace = reduceMotion ? "blink" : tuning.touch.patFaces.first?.frame ?? "open"
        let key = "\(frames.generation)|\(names)|\(store.size)|\(scale)|\(firstFace)"
        guard key != preparedKey else { return }
        frames.prepareRest(names,size: store.size,scale: scale,firstFace: firstFace,aliases: tuning.touch.faceAliases,
                           timeline: tuning.touch.patFaces,curve: tuning.touch.leanCurve,rate: tuning.touch.faceSwapHz)
        frames.prepareMotionFaces(names,size: store.size,scale: scale)
        preparedKey = key
        if touchActive, activeTouch != nil { requestTouchPreparation() }
    }
    /// The selected window's input timestamp uses the same monotonic time base as Core Animation.
    func windowGestureBegan(at seconds: Double) {
        guard press == nil, let target = target() else { return }
        cocoEvent()
        windowGestureLive = true; geometryAt = seconds
        cancelEntry(); lookView.place.removeAnimation(forKey: "place-motion"); lookView.place.removeAnimation(forKey: "place-opacity")
        lookView.place.transform = CATransform3DIdentity; lookView.place.opacity = 1
        cling.begin(at: seconds, anchor: CGPoint(x: target.frame.midX, y: target.frame.minY))
        rides = seconds - lastRide <= tuning.motion.number("cling.ridesWindowS") ? rides + 1 : 1
        lastRide = seconds; ridePeak = 0; ridePeakAt = seconds
        rideLineTimer.cancel(); pendingRideLine = nil
        placementSerial += 1; relocating = false; pendingPlacement = nil
    }
    func windowGeometryChanged(at seconds: Double) {
        guard windowGestureLive, press == nil, let target = retainedTarget ?? target() else { return }
        geometryAt = seconds
        cling.event(at: seconds, anchor: CGPoint(x: target.frame.midX, y: target.frame.minY))
        applySqueeze(target, at: seconds)
        applyCling(at: seconds, released: false)
    }
    func windowGestureEnded(at seconds: Double, cancelled: Bool = false) {
        guard windowGestureLive else { return }
        windowGestureLive = false; geometryAt = seconds
        if cancelled {
            clearWindowMotion(); place(reorder: false); return
        }
        cling.release(at: seconds); applyCling(at: seconds, released: true)
        place(reorder: false)
    }
    private func applyCling(at seconds: Double, released: Bool) {
        let bake = cling.bake(at: seconds, released: released)
        guard !bake.isEmpty else { return }
        let sample = cling.shown(at: seconds, released: released)
        if sample.speed > ridePeak { ridePeak = sample.speed; ridePeakAt = seconds }
        clingSerial += 1; let serial = clingSerial
        if reduceMotion {
            lookView.cling.removeAnimation(forKey: "cling"); lookView.cling.transform = CATransform3DIdentity
        } else {
            var shift = pixelShift
            let values = bake.map { key -> CATransform3D in
                if !pixelSteps { return CompanionAnimation.transform(key.sample) }
                let step = tuning.motion.number("cling.pixelStepDeg"), hysteresis = tuning.motion.number("cling.pixelHysteresisDeg")
                let limit = Int(tuning.motion.number("cling.pixelMaxArtPx"))
                while shift < limit && key.sample.lean > (Double(shift) + 0.5) * step + hysteresis { shift += 1 }
                while shift > -limit && key.sample.lean < (Double(shift) - 0.5) * step - hysteresis { shift -= 1 }
                var value = CATransform3DIdentity; value.m41 = Double(shift) * artPixelPoints
                return value
            }
            if pixelSteps, let first = values.first { pixelShift = Int((first.m41 / artPixelPoints).rounded()) }
            lookView.setFiltering(pixel: store.size.pixelArt, transformed: true, motion: tuning.motion)
            CompanionAnimation.transforms(on: lookView.cling, key: "cling", values: values,
                                          times: bake.map(\.time), at: seconds, discrete: pixelSteps) { [weak self] in
                guard let self, self.clingSerial == serial else { return }
                self.pixelShift = 0; self.refreshRigFiltering()
            }
        }
        applyClingFace(at: seconds, bake: bake)
        scheduleRideLine(at: seconds, bake: bake)
    }
    private var artPixelPoints: Double {
        let canvas = frames.artPixelHeight ?? 1
        return Double(spriteSize(scale: scale).height) / Double(max(1, canvas))
    }
    private func applySqueeze(_ target: Place.Target, at seconds: Double) {
        squeezeSerial += 1; let token = squeezeSerial
        squeezeFaceEnd.cancel()
        let contact = Place.contact(for: target, motion: tuning.motion)
        let wasSqueezed = squeezeFace
        squeezeAxis = contact.axis
        guard contact.axis != .none else {
            squeezeFace = false; squeeze.reset(); lookView.place.removeAnimation(forKey: "squeeze")
            lookView.place.transform = CATransform3DIdentity
            if wasSqueezed { lookView.picture.removeAnimation(forKey: "window-face"); draw() }
            return
        }
        let sample = squeeze.update(at: seconds, roomOverSize: contact.rawScale)
        squeezePush = sample.push
        if sample.scale < tuning.motion.number("squeeze.faceOn") { squeezeFace = true }
        if sample.scale >= tuning.motion.number("squeeze.faceOff") { squeezeFace = false }
        let reduced = reduceMotion || pixelSteps
        let bake = squeeze.bake(roomOverSize: contact.rawScale)
        let values = bake.map { key -> CATransform3D in
            let s = reduced ? 1 : key.sample.scale, other = reduced ? 1 : key.sample.otherAxis
            var value = CATransform3DIdentity
            if contact.axis == .vertical {
                value.m11 = other; value.m22 = s
                value.m42 = -max(0, (reduced ? 1 : tuning.motion.number("squeeze.min")) - contact.rawScale) * target.frame.height
            } else {
                value.m11 = s; value.m22 = other
                // Keep the outside edge attached to the obstacle while width changes.
                value.m41 = contact.pushSign * ((1 - s) * target.frame.width / 2 + max(0, (reduced ? 1 : tuning.motion.number("squeeze.min")) - contact.rawScale) * target.frame.width)
            }
            return value
        }
        lookView.setFiltering(pixel: store.size.pixelArt, transformed: true, motion: tuning.motion)
        CompanionAnimation.transforms(on: lookView.place, key: "squeeze", values: values, times: bake.map(\.time), at: seconds) { [weak self] in
            guard let self, self.squeezeSerial == token else { return }; self.refreshRigFiltering()
        }
        if squeezeFace {
            applyStaticWindowFace("squeeze")
            if let off = bake.first(where: { $0.sample.scale >= tuning.motion.number("squeeze.faceOff") }) {
                squeezeFaceEnd.fire(after: off.time)
            }
        } else if wasSqueezed { lookView.picture.removeAnimation(forKey: "window-face"); draw() }
    }
    private func refreshRigFiltering() {
        lookView.setFiltering(pixel: store.size.pixelArt,
                              transformed: lookView.cling.animation(forKey: "cling") != nil || lookView.place.animation(forKey: "place-motion") != nil
                                || lookView.place.animation(forKey: "squeeze") != nil || !CATransform3DIsIdentity(lookView.place.transform), motion: tuning.motion)
    }
    private func clearWindowFace() {
        faceSerial += 1; clingFaceOnAt = nil; clingFaceOpenAt = nil
        clingFaceStopAt = nil; clingFacePredictedStopAt = nil
        lookView.picture.removeAnimation(forKey: "window-face")
    }
    private func clearWindowMotion() {
        squeezeSerial += 1; squeezeFaceEnd.cancel()
        clingSerial += 1; cling.reset(); squeeze.reset(); geometryAt = nil; pixelShift = 0
        squeezeFace = false; squeezePush = 0; clearWindowFace()
        lookView.cling.removeAllAnimations(); lookView.place.removeAllAnimations()
        lookView.cling.transform = CATransform3DIdentity; lookView.place.transform = CATransform3DIdentity
        refreshRigFiltering(); rideLineTimer.cancel(); pendingRideLine = nil
    }
    private var windowFaceAllowed: Bool { record.mood != "sleep" && !Reactor.urgent.contains(record.mood) && !touchActive }
    private var displayedBase: String {
        let image = lookView.picture.presentation()?.contents.map { $0 as! CGImage } ?? lookView.picture.contents.map { $0 as! CGImage }
        return image.flatMap { frames.baseName(of: $0) } ?? record.frame
    }
    private func applyStaticWindowFace(_ face: String?) {
        guard windowFaceAllowed else { return }
        let base = displayedBase
        guard let face, frames.hasFace(face, on: base, size: store.size),
              let image = frames.cachedMotionFace(face, on: base, size: store.size, scale: scale) else { return }
        lookView.picture.removeAnimation(forKey: "loop"); lookView.picture.removeAnimation(forKey: "tool-patch-loop"); loopKey = nil
        lookView.show(image, scale: scale)
    }
    private func applyClingFace(at seconds: Double, bake: [CompanionClingKeyframe]) {
        guard windowFaceAllowed else { clearWindowFace(); return }
        if let opened = clingFaceOpenAt, seconds >= opened {
            clingFaceOnAt = nil; clingFaceOpenAt = nil; clingFaceStopAt = nil; clingFacePredictedStopAt = nil
        }
        if clingFaceOnAt == nil, let start = bake.first(where: { $0.sample.speed >= tuning.motion.number("cling.faceOnPtPerS") }) {
            clingFaceOnAt = seconds + start.time
        }
        guard let on = clingFaceOnAt else { return }
        let base = displayedBase
        let face = squeezeFace ? "squeeze" : rides >= Int(tuning.motion.number("cling.ridesSmileFrom")) ? "smile" : "squeeze"
        guard frames.hasFace(face, on: base, size: store.size),
              let held = frames.cachedMotionFace(face, on: base, size: store.size, scale: scale),
              let open = frames.cached(base, size: store.size, scale: scale) else { return }
        let threshold = tuning.motion.number("cling.faceStopPtPerS")
        if let current = bake.first, current.sample.speed < threshold {
            if clingFaceStopAt == nil { clingFaceStopAt = min(seconds, clingFacePredictedStopAt ?? seconds) }
        } else { clingFaceStopAt = nil }
        let stop = bake.first { $0.sample.speed < threshold }.map { seconds + $0.time }
        clingFacePredictedStopAt = clingFaceStopAt ?? stop
        let opening = (clingFaceStopAt ?? stop).map { max($0 + tuning.motion.number("cling.faceOpenAfterStopMs") / 1000,
                                     on + tuning.motion.number("cling.faceMinOnMs") / 1000) }
        clingFaceOpenAt = opening
        var values = [open, held], times = [0.0, max(0, on - seconds)]
        var end = bake.last?.time ?? 1.6
        if let opening {
            let offset = max(0, opening - seconds)
            values.append(open); times.append(offset)
            if !squeezeFace, frames.hasFace("blink", on: base, size: store.size),
               let blink = frames.cachedMotionFace("blink", on: base, size: store.size, scale: scale) {
                let blinkAt = offset + tuning.motion.number("cling.faceBlinkAfterMs") / 1000
                values += [blink, open]; times += [blinkAt, blinkAt + tuning.motion.number("cling.faceBlinkMs") / 1000]
            }
            end = max(end, times.last ?? offset)
        }
        if squeezeFace { values = [held, held]; times = [0, end] }
        if (times.last ?? 0) < end { values.append(values.last ?? open); times.append(end) }
        guard end > 0 else { return }
        faceSerial += 1; let token = faceSerial
        let animation = CAKeyframeAnimation(keyPath: "contents")
        animation.values = values; animation.keyTimes = times.map { NSNumber(value: $0 / end) }
        animation.calculationMode = .discrete; animation.duration = end
        animation.beginTime = lookView.picture.convertTime(seconds, from: nil)
        animation.delegate = CompanionAnimationEnd { [weak self] in
            guard let self, self.faceSerial == token else { return }
            self.clingFaceOnAt = nil; self.clingFaceOpenAt = nil
            self.clingFaceStopAt = nil; self.clingFacePredictedStopAt = nil
            self.preparedKey = ""; self.prepareFrames(); self.draw()
        }
        lookView.picture.removeAnimation(forKey: "loop"); lookView.picture.removeAnimation(forKey: "tool-patch-loop"); loopKey = nil
        lookView.show(values.last ?? open, scale: scale); lookView.picture.add(animation, forKey: "window-face")
    }
    private func scheduleRideLine(at seconds: Double, bake: [CompanionClingKeyframe]) {
        rideLineTimer.cancel(); pendingRideLine = nil; pendingRideReactor = nil
        guard let stop = bake.first(where: { $0.sample.speed < ridePeak * tuning.motion.number("cling.lineStopFraction") }) else { return }
        let stopAt = seconds + stop.time
        var candidate = reactor
        guard let chosen = candidate.ride(at: Date().timeIntervalSince1970 + stop.time, peakSpeed: ridePeak,
                                        stopSpeed: stop.sample.speed, stopElapsedMs: (stopAt - ridePeakAt) * 1000,
                                        mood: record.mood, linesHidden: store.linesHidden, lines: record.reactions,
                                        chanceRandom: Double.random(in: 0..<1), pickRandom: Double.random(in: 0..<1), tuning: tuning.motion.number) else { return }
        pendingRideLine = chosen
        pendingRideReactor = candidate
        rideLineTimer.fire(after: stop.time + chosen.delayMs / 1000)
    }
    private func showRideLine() {
        guard logicalVisible, windowFaceAllowed, !store.linesHidden, let chosen = pendingRideLine else { pendingRideLine = nil; return }
        if let candidate = pendingRideReactor { reactor = candidate }
        pendingRideLine = nil; pendingRideReactor = nil; reactionLine = (chosen.line, now + chosen.holdMs)
        place(reorder: false); armReactionEnd()
    }
    private func installPointerMonitor() {
        guard Self.pointerMonitorNeeded(form: tuning.pointer.near, lineVisible: speech.isVisible, pillVisible: bubble.isVisible)
            else { stopPointerMonitor(); return }
        guard pointerMonitor == nil else { return }
        pointerMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.mouseMoved]) { [weak self] event in
            self?.monitoredPointerEvent(at: event.timestamp)
        }
        if pointerMonitor != nil { pointerMeter.arm(form: tuning.pointer.near, enabled: tuning.pointer.meter) }
    }
    static func pointerMonitorNeeded(form: CompanionPointerTuning.Form, lineVisible: Bool, pillVisible: Bool) -> Bool {
        lineVisible || (form == .full && pillVisible)
    }
    private func monitoredPointerEvent(at seconds: Double, position: CGPoint? = nil, speechFrame: CGRect? = nil, pillFrame: CGRect? = nil) {
        let cpu = pointerMeter.beginEvent()
        fadeForPointer(position: position ?? pointerPosition(), at: seconds, speechFrame: speechFrame, pillFrame: pillFrame)
        pointerMeter.endEvent(cpu)
    }
    private func fadeForPointer(at seconds: Double = CACurrentMediaTime()) {
        fadeForPointer(position: pointerPosition(), at: seconds)
    }
    func pointerFadeEvent(position: CGPoint, at seconds: Double, speechFrame: CGRect? = nil, pillFrame: CGRect? = nil) {
        monitoredPointerEvent(at: seconds, position: position, speechFrame: speechFrame, pillFrame: pillFrame)
    }
    private func fadeForPointer(position point: CGPoint, at seconds: Double, speechFrame: CGRect? = nil, pillFrame: CGRect? = nil, tracking: Bool = false) {
        let t = tuning.motion
        if let frame = speechFrame ?? (speech.isVisible ? speech.frame : nil) {
            let old = speechFade.band
            let previousDeadline = speechFade.restoreAt
            if speechFade.update(distance: CompanionPointerFade.distance(point, to: frame), at: seconds, deliberate: deliberatePointer, tuning: t) {
                speechMotion.fade(speech, to: speechFade.alpha(t, reduceTransparency: cachedReduceTransparency), restoring: speechFade.band.rawValue < old.rawValue, tuning: t)
            }
            if speechFade.restoreAt != previousDeadline {
                if let deadline = speechFade.restoreAt { speechRestore.fire(after: max(0, deadline - seconds)) } else { speechRestore.cancel() }
            }
        }
        if tuning.pointer.near == .full || tracking, let frame = pillFrame ?? (bubble.isVisible ? bubble.frame : nil) {
            let old = bubbleFade.band
            let previousDeadline = bubbleFade.restoreAt
            if bubbleFade.update(distance: CompanionPointerFade.distance(point, to: frame), at: seconds, deliberate: deliberatePointer, tuning: t) {
                bubbleMotion.fade(bubble, to: bubbleFade.alpha(t, reduceTransparency: cachedReduceTransparency), restoring: bubbleFade.band.rawValue < old.rawValue, tuning: t)
            }
            if bubbleFade.restoreAt != previousDeadline {
                if let deadline = bubbleFade.restoreAt { bubbleRestore.fire(after: max(0, deadline - seconds)) } else { bubbleRestore.cancel() }
            }
        }
    }
    private func restorePointerLine() {
        if speechFade.advance(at: CACurrentMediaTime()) { speechMotion.fade(speech, to: speechFade.alpha(tuning.motion, reduceTransparency: cachedReduceTransparency), restoring: true, tuning: tuning.motion) }
    }
    private func restorePointerPill() {
        if bubbleFade.advance(at: CACurrentMediaTime()) { bubbleMotion.fade(bubble, to: bubbleFade.alpha(tuning.motion, reduceTransparency: cachedReduceTransparency), restoring: true, tuning: tuning.motion) }
    }
    private func leaveReducedPointerPill(at seconds: Double) {
        let previousDeadline = bubbleFade.restoreAt
        _ = bubbleFade.update(distance: .infinity, at: seconds, deliberate: false, tuning: tuning.motion)
        if bubbleFade.restoreAt != previousDeadline, let deadline = bubbleFade.restoreAt {
            bubbleRestore.fire(after: max(0, deadline - seconds))
        }
    }
    private func resetPointerPill() {
        bubbleRestore.cancel(); bubbleFade = CompanionPointerFade(); bubbleMotion.reset(on: bubble)
    }
    private func stopPointerMonitor() {
        if let pointerMonitor { NSEvent.removeMonitor(pointerMonitor); self.pointerMonitor = nil }
        if let period = pointerMeter.disarm() { pointerMonitorMeasured(period) }
    }
    func stop() {
        lanterns.stop();d1Helpers.stop();d1Shed.clear();d1Visitor.clear();d1FrameEnd.cancel();d1RibbonPanel.orderOut(nil)
        touchPreparationID += 1; activeTouch = nil
        stopPointerMonitor(); recheck.cancel(); reactionEnd.cancel(); longPress.cancel(); snoozeEnd.cancel(); wakeEnd.cancel(); wakeLineTimer.cancel(); hourWaveEnd.cancel(); spinLine.cancel(); spinEnd.cancel(); napWake.cancel(); stickTick.cancel()
        clearWindowMotion(); cancelEntry(); hoverDeadline.cancel(); relaxPointer.cancel(); speechRestore.cancel(); bubbleRestore.cancel(); greetingAfterPop.cancel()
    }

    // ------------------------------------------------------------ where

    private func target() -> Place.Target? {
        if snoozed && !hourLeaving || presentationSuppressed { return nil }
        switch sighting {
        case .none: break
        case let .corner(_, screen, _, _), let .window(_, _, _, _, screen, _):
            let size = spriteSize(scale: scaleOf(screen))
            let places = Place.Places(manual: store.manual, full: store.full, last: lastShown, wasLedge: mode == .ledge, drag: dragOrigin)
            if let target = Place.spot(for: sighting, size: size, places: places, previous: retainedTarget,
                                       liveGesture: windowGestureLive, motion: tuning.motion) { return target }
        }
        // An explicit call shows his hello even when Claude has no usable placement right now.
        guard summonFallbackActive else { return nil }
        let available = screens()
        guard let screen = available.main ?? available.screens.first else { return nil }
        let size = spriteSize(scale: available.scale(of: screen.frame))
        let places = Place.Places(manual: nil, full: nil, last: lastShown, wasLedge: false, drag: dragOrigin)
        let frame = Place.freeFrame(size: size, places: places, visible: screen.visibleFrame, screen: screen.frame)
        return Place.Target(mode: .free, frame: frame, number: 0, window: .zero, visible: screen.visibleFrame, screen: screen.frame)
    }

    private func place(reorder: Bool) {
        guard let target = target() else {
            hide()
            return
        }
        if relocating { pendingPlacement = target; return }
        if logicalVisible, !windowGestureLive, dragOrigin == nil, let old = retainedTarget,
           old.mode != target.mode || hypot(old.frame.minX - target.frame.minX, old.frame.minY - target.frame.minY) > tuning.motion.number("relocate.minJumpPt") {
            relocate(to: target); return
        }
        commitPlacement(target, reorder: reorder)
    }
    func presentationTarget() -> Place.Target? { logicalVisible && !relocating ? target() : nil }
    var motionTuning: CompanionMotionTuning { tuning.motion }
    var motionReduced: Bool { reduceMotion }

    private func commitPlacement(_ destination: Place.Target, reorder: Bool) {
        refreshDisplayStyle()
        var target = destination
        let newScale = scaleOf(target.screen)
        if newScale != scale {
            scale = newScale
            prepareFrames()
            loopKey = nil
            draw()
        }
        target.frame = aligned(target.frame)
        retainedTarget = target
        lastShown = target.frame
        var layoutTarget = target
        if Self.offscreen { target.frame.origin.x += 30_000 }
        if mode != target.mode { trace.say("pet: \(target.mode.rawValue) at \(Int(target.frame.minX)),\(Int(target.frame.minY)) \(Int(target.frame.width))x\(Int(target.frame.height))") }
        let previous = mode
        mode = target.mode
        let shedRight: CGFloat = !store.size.pixelArt && record.shed?.phase == "end" && record.shed?.frame(at:now,pixel:false,reduced:reduceMotion) != nil ? 48:0
        lookView.fit(target.frame.size, motion: tuning.motion, additionalRight:shedRight)
        hit.setFrame(target.frame, display: false) // first: its child windows move with it
        if !Self.offscreen { target.frame = hit.frame; retainedTarget = target; lastShown = target.frame; layoutTarget = target }
        look.setFrame(lookView.panelFrame(for: target.frame, motion: tuning.motion, additionalRight:shedRight), display: false)
        lookView.register(sprite: hit.frame, panel: look.frame)
        let wasVisible = logicalVisible
        logicalVisible = true
        placementChanged(layoutTarget, false)
        let level: NSWindow.Level = target.chosen && target.active ? .floating : .normal
        let relevel = hit.level != level
        let fullScreen: Bool = if case let .window(_, _, value, _, _, _) = sighting { value } else { false }
        let collection: NSWindow.CollectionBehavior = fullScreen ? [.moveToActiveSpace, .fullScreenAuxiliary, .ignoresCycle] : [.moveToActiveSpace, .fullScreenNone, .ignoresCycle]
        for panel in [hit, look, speech, bubble] { panel.collectionBehavior = collection }
        card?.panel.collectionBehavior = collection; hoverPanel?.collectionBehavior = collection; badge?.collectionBehavior = collection
        if allowsWindowPresentation && (!wasVisible || reorder || relevel || orderedTo != target.number || mode != previous) {
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
        placeLanterns(layoutTarget)
        placeD1(layoutTarget)
        installPointerMonitor(); fadeForPointer()
        if !wasVisible { pop(at: target) }
        if !wasVisible { updateLoop() }
    }

    private func relocate(to destination: Place.Target) {
        guard let old = retainedTarget else { commitPlacement(destination, reorder: true); return }
        placementSerial += 1; let token = placementSerial
        relocating = true; pendingPlacement = destination
        placementChanged(nil, true)
        hideExtras(); clearWindowFace()
        let hidden = old.mode == .ledge ? max(0, 1 - max(0, old.frame.maxY - old.window.maxY - squeezePush * old.frame.height) / old.frame.height) : squeezePush
        if hidden >= tuning.motion.number("relocate.skipDuckHiddenFraction") {
            finishRelocation(token: token); return
        }
        animatePlace(entering: false, target: old) { [weak self] in self?.finishRelocation(token: token) }
    }
    private func finishRelocation(token: Int) {
        guard relocating, placementSerial == token, let target = pendingPlacement else { return }
        relocating = false; pendingPlacement = nil; logicalVisible = false
        clearWindowMotion(); commitPlacement(target, reorder: true)
    }
    private func animatePlace(entering: Bool, target: Place.Target, done: (() -> Void)? = nil) {
        let ledge = target.mode == .ledge, t = tuning.motion, reduced = reduceMotion
        let total = entering ? (reduced ? t.number("leave.reduceFadeInMs") : CompanionPhysics.popTotalMs(ledge: ledge, tuning: t))
                             : t.number(reduced ? "leave.reduceFadeOutMs" : ledge ? "duck.ledgeMs" : "duck.openMs")
        let count = max(1, Int(ceil(total * t.number("rig.bakeFps") / 1000)))
        var values: [CATransform3D] = [], opacity: [NSNumber] = [], times: [Double] = []
        let initial = lookView.place.presentation()?.transform ?? lookView.place.transform
        for i in 0...count {
            let ms = total * Double(i) / Double(count)
            let sample = entering ? CompanionPhysics.pop(ms: ms, height: Double(target.frame.height), ledge: ledge, tuning: t, reduceMotion: reduced)
                                  : CompanionPhysics.duck(ms: ms, height: Double(target.frame.height), ledge: ledge, tuning: t, reduceMotion: reduced)
            var value = entering ? CATransform3DIdentity : initial
            value.m11 *= 1 + t.number("rig.widthPerHeightSquash") * (1 - sample.scaleY)
            value.m22 *= sample.scaleY
            value.m42 += pixelSteps ? (sample.dy / artPixelPoints).rounded() * artPixelPoints : sample.dy
            values.append(value); opacity.append(NSNumber(value: sample.alpha)); times.append(ms / 1000)
        }
        if entering { values[values.count - 1] = CATransform3DIdentity; opacity[opacity.count - 1] = 1 }
        lookView.setFiltering(pixel: store.size.pixelArt, transformed: !reduced, motion: tuning.motion)
        let alpha = CAKeyframeAnimation(keyPath: "opacity"); alpha.values = opacity
        alpha.keyTimes = times.map { NSNumber(value: $0 / (total / 1000)) }; alpha.duration = total / 1000; alpha.calculationMode = .linear
        lookView.place.opacity = entering ? 1 : 0; lookView.place.add(alpha, forKey: "place-opacity")
        CompanionAnimation.transforms(on: lookView.place, key: "place-motion", values: values, times: times, discrete: pixelSteps) { [weak self] in
            self?.refreshRigFiltering(); done?()
        }
    }
    private func pop(at target: Place.Target) {
        cancelEntry(); entryLineHidden = true; speech.orderOut(nil); stopPointerMonitor()
        animatePlace(entering: true, target: target)
        entryLine.fire(after: tuning.motion.number("pop.lineAfterMs") / 1000)
        entryBlink.fire(after: tuning.motion.number("pop.blinkAfterMs") / 1000)
        if returnGreeting {
            let duration = reduceMotion ? tuning.motion.number("leave.reduceFadeInMs") : CompanionPhysics.popTotalMs(ledge: target.mode == .ledge, tuning: tuning.motion)
            greetingAfterPop.fire(after: duration / 1000)
        }
    }
    private func cancelEntry() {
        entryLine.cancel(); entryBlink.cancel(); entryLineHidden = false
    }
    private func restoreEntryLine() {
        entryLineHidden = false
        guard logicalVisible, let target = target() else { return }
        placeSpeech(speechTarget(target), reorder: true, forceIn: true); installPointerMonitor()
    }
    private func blinkAfterEntry() {
        guard logicalVisible, windowFaceAllowed else { return }
        let base = displayedBase
        guard frames.hasFace("blink", on: base, size: store.size),
              let blink = frames.cachedMotionFace("blink", on: base, size: store.size, scale: scale),
              let open = frames.cached(base, size: store.size, scale: scale) else { return }
        let animation = CAKeyframeAnimation(keyPath: "contents")
        animation.values = [blink, open]; animation.keyTimes = [0, 1]; animation.calculationMode = .discrete
        animation.duration = tuning.motion.number("cling.faceBlinkMs") / 1000
        lookView.picture.add(animation, forKey: "entry-blink")
    }
    private func hideExtras() {
        lanterns.hide();d1Helpers.hide();d1Shed.clear();d1Visitor.clear();d1FrameEnd.cancel();d1RibbonPanel.orderOut(nil)
        speech.orderOut(nil); bubble.orderOut(nil); badge?.orderOut(nil); card?.panel.orderOut(nil); hideHoverRow()
        stopPointerMonitor(); speechRestore.cancel(); resetPointerPill()
    }

    /// While you carry him: only his click target moves (his picture and line are its child windows),
    /// so nothing is laid out again until you put him down.
    private func carry() {
        guard var target = target() else { return }
        target.frame = aligned(target.frame)
        lastShown = target.frame
        retainedTarget = target
        let logicalTarget = target
        if Self.offscreen { target.frame.origin.x += 30_000 }
        hit.setFrame(target.frame, display: false)
        if !Self.offscreen { target.frame = hit.frame; lastShown = target.frame; retainedTarget = target }
        placementChanged(Self.offscreen ? logicalTarget : target, false)
    }

    private func hide() {
        let wasVisible = logicalVisible
        if logicalVisible {
            if press?.moved == true, let frame = lastShown, let target = retainedTarget {
                if carriedInFullScreen { store.full = Place.fractions(frame, visible: target.visible, screen: target.screen) }
                else { store.manual = Place.manual(forDrop: frame, window: target.window.isEmpty ? nil : target.window, visible: target.visible, screen: target.screen) }
                store.save()
            }
            hourLeaving = false; hourWaveEnd.cancel()
            returnGreeting = false; greetingAfterPop.cancel()
            explicitSummonFallback = false
            placementSerial += 1; relocating = false; pendingPlacement = nil; windowGestureLive = false
            clearWindowMotion(); cancelEntry(); clearPerk()
            if touchActive || activeTouch != nil {
                touchPreparationID += 1; activeTouch = nil; reaction = nil; reactionLine = nil; queuedReaction = nil
                wakeEnd.cancel(); wakeLineTimer.cancel(); wakeUntil = 0
                reactionEnd.cancel()
                lookView.picture.removeAnimation(forKey: "touch")
            }
            if press != nil { press = nil; dragOrigin = nil; longPress.cancel() }
            lookView.picture.removeAllAnimations(); loopKey = nil
            CATransaction.begin(); CATransaction.setDisableActions(true)
            lookView.picture.transform = CATransform3DIdentity; CATransaction.commit()
        }
        logicalVisible = false
        placementChanged(nil, false)
        stopPointerMonitor()
        if hit.isVisible { trace.say("pet: hidden") }
        lanterns.hide()
        hit.orderOut(nil)
        look.orderOut(nil)
        speech.orderOut(nil)
        card?.panel.orderOut(nil)
        bubble.orderOut(nil); resetPointerPill(); badge?.orderOut(nil); hideHoverRow()
        hover.blocked(carried: true, card: false)
        orderedTo = nil
        mode = nil
        updateLoop()
        if wasVisible { preparedKey = ""; prepareFrames(); draw() }
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
        if let until = record.sharedLineUntil { return now < until ? said : nil }
        // The mod clears a line after 14 s (a slip after 45 s); this only guards a session that died.
        return now - record.at < 60_000 ? said : nil
    }

    private var lineToSay: String? {
        guard !store.linesHidden else { return nil }
        // Its own lines are Coco's: Claudie and maid Claudie leave them unsaid (owner 10-17); the band's are theirs or none.
        if record.claudie == nil, let reactionLine, reactionLine.until > now { return reactionLine.text }
        return bandLine
    }

    private func placeSpeech(_ target: Place.Target, reorder: Bool, forceIn: Bool = false) {
        guard !entryLineHidden, card?.panel.isVisible != true, !activityPresented, let line = lineToSay else {
            if speech.parent != nil { hit.removeChildWindow(speech) }
            speech.orderOut(nil)
            speechMotion.reset(on: speech); speechRestore.cancel(); speechFade = CompanionPointerFade(); installPointerMonitor()
            return
        }
        speechView.contrast = contrastPreference()
        speechView.slip = record.slip && line == bandLine
        speechView.fontSize = store.size.fontSize
        let limits = Place.lineLimits(for: target, motion: tuning.motion)
        var size = speechView.fit(line, maxWidth: limits.width, maxHeight: limits.height)
        var placement = Place.linePlacement(for: target, size: size, current: speechMotion.side, motion: tuning.motion, allowFallback: false)
        if placement == nil {
            size = speechView.fit(line, maxWidth: Place.lineWidthLimit(for: target, size: size, motion: tuning.motion), maxHeight: limits.height)
            placement = Place.linePlacement(for: target, size: size, current: speechMotion.side, motion: tuning.motion)
        }
        guard var placement else { speech.orderOut(nil); installPointerMonitor(); return }
        placement.frame = aligned(placement.frame)
        if Self.offscreen { placement.frame.origin.x += 30_000 }
        speechMotion.place(speech, placement: placement, reduceMotion: reduceMotion, tuning: tuning.motion, forceIn: forceIn)
        if allowsWindowPresentation && (!speech.isVisible || reorder || speech.parent == nil) {
            if speech.parent == nil { hit.addChildWindow(speech, ordered: .above) }
            speech.order(.above, relativeTo: hit.windowNumber)
        }
        installPointerMonitor()
        if line == bandLine { scheduleRecheck(at: record.sharedLineUntil ?? record.at + 60_000) }
    }

    // ------------------------------------------------------------ what he looks like

    private func draw() {
        // Whatever still needs a later look (a live line, a running loop) arms it again below.
        recheck.cancel()
        recheckAt = nil
        if drawCoco() {
            hitView.setAccessibilityLabel(spokenLabel)
            if let target = target(), hit.isVisible, press?.moved != true { placeSpeech(speechTarget(target), reorder: false) }
            return
        }
        let reacting = reaction.map { $0.until > now } ?? false
        let requested = reacting ? reaction!.frame : record.shed?.frame(at:now,pixel:store.size.pixelArt,reduced:reduceMotion) ?? record.frame
        guard let name = frames.resolveName(requested,size: store.size),
              let still = frames.cached(name, size: store.size, scale: scale) else {
            lookView.picture.removeAnimation(forKey: "loop"); lookView.picture.removeAnimation(forKey: "touch")
            clearWindowFace(); lookView.picture.removeAnimation(forKey: "entry-blink")
            CATransaction.begin(); CATransaction.setDisableActions(true); lookView.picture.contents = nil; CATransaction.commit()
            hitView.silhouette = nil; loopKey = nil
            return
        }
        if name != requested { lookView.picture.removeAnimation(forKey: "touch") }
        if lookView.picture.animation(forKey: "touch") == nil || !reacting { lookView.picture.removeAnimation(forKey: "touch"); lookView.show(still, scale: scale) }
        hitView.silhouette = still
        updateLoop()
        hitView.setAccessibilityLabel(spokenLabel)
        if let target = target(), hit.isVisible, press?.moved != true { placeSpeech(speechTarget(target), reorder: false) }
        if windowFaceAllowed {
            if squeezeFace { applyStaticWindowFace("squeeze") }
            else if let glanceFace { applyStaticWindowFace(glanceFace) }
        }
    }

    // ------------------------------------------------------------ Coco's player

    /// His size in points: Coco's canvas at this size when their player is there, else the painted frames'.
    private func spriteSize(scale: CGFloat) -> NSSize {
        guard let coco else { return frames.size(store.size, scale: scale) }
        let (width, height) = coco.dimensions(Int((store.size.height * scale).rounded()))
        return NSSize(width: CGFloat(width) / scale, height: CGFloat(height) / scale)
    }
    /// The layer his visitors and stick sit on: Coco's when they are drawn, else the painted picture.
    private var artLayer: CALayer { coco != nil ? lookView.coco : lookView.picture }
    /// Something happened: Coco moves for the next minute (companion-rs SettleRule).
    private func cocoEvent() {
        cocoEventAt = max(cocoEventAt, now)
        if coco != nil { _ = drawCoco() }
    }
    /// Whether they are drawn moving (companion-rs coco_runs): never in reduced motion, carried, asleep or out of
    /// sight, and for a minute after something happened unless something holds them (a touch, a press, a turn at
    /// work, a compaction). Otherwise they stand in the pose their action settles into.
    private var cocoRuns: Bool {
        let at = now
        let carried = touchActive && touchKey == "drag"
        let visible = hit.isVisible && (look.occlusionState.contains(.visible) || Self.offscreen)
        let packing = record.shed.map { $0.phase == "begin" && at >= $0.at && at - $0.at < 600_000 } ?? false
        let held = touchActive || press != nil || !record.rest || packing
        return !reduceMotion && !carried && visible && record.mood != "sleep"
            && (held || at + Double(CocoChoice.frameMs) < cocoEventAt + 60_000)
    }
    /// What Coco plays now (companion-rs coco_wanted): their touch, the plugin's mood and pose, the compaction, the
    /// outfit (the plugin's word, else A with a change for every compaction seen) and the hour.
    private func cocoWanted(_ coco: CocoPlayer, at: Double) -> CocoWanted {
        let key = touchActive ? touchKey : nil
        let touch: CocoTouch?
        switch key {
        case "pat", "hold": touch = .pat
        case "flustered", "spin", "hold-tight": touch = .burst
        default: touch = nil
        }
        let mood = key == "wave" ? "wave" : record.mood
        let working = record.mood == "think" || record.mood == "work"
        let outfit = CocoOutfit.parse(record.outfit) ?? (cocoFlips % 2 == 1 ? .b : .a)
        // he packs while a compaction runs; the shell change plays through once when it ends
        let shellMs = coco.bodySeconds(outfit.other, "shell") * 1000
        var shed: CocoShed?
        if let event = record.shed, at >= event.at {
            if event.phase == "begin" && at - event.at < 600_000 { shed = .begin }
            if event.phase == "end" && at - event.at < shellMs { shed = .end }
        }
        let input = CocoInput(mood: mood, pose: record.poseName, touch: touch, shed: shed, act: nil,
                              night: CocoChoice.isNight(hour: CocoChoice.localHour(), mood: mood, working: working),
                              working: working)
        return CocoWanted(input, outfit: outfit)
    }
    /// Coco's current frame on their layer and as the click shape, and while they move the next one a frame later;
    /// false when their player is not there.
    private func drawCoco() -> Bool {
        guard let coco else { return false }
        let at = now
        if let shed = record.shed, shed.phase == "end", shed.id != cocoShedSeen {
            // a compaction already over when he starts says nothing of the outfit
            if cocoShedSeen != nil || at - shed.at < 3000 { cocoFlips += 1 }
            cocoShedSeen = shed.id
        }
        if cocoSocksTried != .some(record.socks) {
            // the pair from their sock drawer: one that cannot be read leaves their own pair on
            cocoSocksTried = .some(record.socks)
            do { try coco.wear(record.socks) } catch { _ = try? coco.wear(nil) }
        }
        wearForm()
        let runs = cocoRuns
        let ms = UInt64(max(0, at))
        coco.update(cocoWanted(coco, at: at), now: ms, runs: runs)
        let pixels = Int((store.size.height * scale).rounded())
        var image = coco.frame(now: ms, height: pixels, reduced: reduceMotion, runs: runs).flatMap { cocoPaint.image($0, bank: coco.bank) }
        // Claude's form set to Claudie: her still cell for the action Coco is playing, in Coco's canvas
        if let cells = claudieCells, let action = coco.current?.action {
            let (width, height) = coco.dimensions(pixels)
            image = cocoPaint.image(claudie: cells.cell(for: action), width: width, height: height) ?? image
        }
        if let image {
            lookView.showCoco(image, scale: scale)
            hitView.silhouette = image
        }
        if runs { cocoTick.fire(after: Double(CocoChoice.frameMs) / 1000) } else { cocoTick.cancel() }
        return true
    }
    /// Claudie's cells for the form the plugin names, read once; a form that cannot be read leaves Coco drawn and is
    /// tried again ten seconds on (a failed read used to keep Coco on until the pet restarted).
    private func wearForm() {
        let wanted = record.claudie
        if claudieCells?.form == wanted { return }
        if wanted == nil { trace.say("pet: form coco") }
        claudieCells = nil
        guard let form = wanted else { return }
        if let failed = claudieFailed[form], now - failed < 10_000 { return }
        if let cells = CocoClaudieCells(folder: frames.assetRoot.appendingPathComponent("claudie", isDirectory: true), form: form) {
            claudieCells = cells; claudieFailed[form] = nil
            trace.say("pet: form \(form)")
        } else { claudieFailed[form] = now; trace.say("pet: form \(form) unreadable, Coco until it reads") }
    }

    /// For VoiceOver: "Coco (reading), let me read., 35% context".
    var spokenLabel: String {
        var parts = [[record.name, record.aside].filter { !$0.isEmpty }.joined(separator: " ")]
        if let visitor = record.visitor, visitor.leftAt == nil, record.mood == "sleep", !visitor.label.isEmpty { parts.append(visitor.label) }
        if let line = lineToSay { parts.append(line) }
        if let context = record.context { parts.append("\(record.estimate ? "~" : "")\(context)% \(record.words.context)") }
        return parts.joined(separator: ", ")
    }

    var patHint: String { record.words.pat }

    private func updateLoop() {
        // Coco's frames have their own clock; a change of sight or placement only wakes it
        if coco != nil { _ = drawCoco(); return }
        if record.shed?.frame(at:now,pixel:store.size.pixelArt,reduced:reduceMotion) != nil {
            lookView.picture.removeAnimation(forKey:"loop");lookView.picture.removeAnimation(forKey:"tool-patch-loop");loopKey=nil;return
        }
        if windowFaceAllowed && (squeezeFace || glanceFace != nil || lookView.picture.animation(forKey: "window-face") != nil) {
            lookView.picture.removeAnimation(forKey: "loop"); lookView.picture.removeAnimation(forKey: "tool-patch-loop"); loopKey = nil
            return
        }
        var want: String?
        if let pose=record.pose, pose.name != "work", !touchActive, !reduceMotion, hit.isVisible,
           !Reactor.urgent.contains(record.mood), record.mood != "sleep" {
            let key="c3:\(pose.name):\(pose.at):\(store.size):\(scale)"
            if FrameLoop.prepare(on:lookView.picture,wanted:key,cached:&loopKey),let animation=ToolPoseTimeline.animation(pose,frames:frames,size:store.size,scale:scale,now:now,current:lookView.picture.presentation()?.contents.map {$0 as! CGImage} ?? lookView.picture.contents.map {$0 as! CGImage}) {
                lookView.picture.add(animation,forKey:"loop");loopKey=key
                if let tail=ToolPoseTimeline.repeatingTail(animation,pose:pose,now:now) {lookView.picture.add(tail,forKey:"tool-patch-loop")}
                if pose.name == "cheer" {
                    lookView.picture.add(ToolPoseTimeline.celebration(pose,now:now),forKey:"c3-cheer")
                    ToolPoseTimeline.burst(on:lookView.picture,pose:pose,now:now)
                    poseDip(y:0.975,x:1.0075,delayMs:(pose.celebration ?? 0)>=3 ? 2900:1900,key:"c3-smile")
                }
            }
            return
        }
        lookView.picture.removeAnimation(forKey:"c3-cheer")
        lookView.picture.sublayers?.filter {$0.name == "c3-burst"}.forEach {$0.removeFromSuperlayer()}
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
        prepareFrames()
        loopKey = nil
        draw()
        place(reorder: false)
        if let target = retainedTarget, logicalVisible, !relocating { applySqueeze(target, at: CACurrentMediaTime()) }
    }

    private func refreshDisplayStyle() {
        let contrast = contrastPreference()
        speechView.contrast = contrast; bubbleView.contrast = contrast
        hoverView?.contrast = contrast; hoverLabel.view?.contrast = contrast
        card?.view.contrast = contrast; badgeView?.contrast = contrast
        let transparency = transparencyPreference()
        if transparency != cachedReduceTransparency {
            let oldSpeech = speechFade.alpha(tuning.motion, reduceTransparency: cachedReduceTransparency)
            let oldBubble = bubbleFade.alpha(tuning.motion, reduceTransparency: cachedReduceTransparency)
            cachedReduceTransparency = transparency
            let speechAlpha = speechFade.alpha(tuning.motion, reduceTransparency: transparency)
            let bubbleAlpha = bubbleFade.alpha(tuning.motion, reduceTransparency: transparency)
            speechMotion.fade(speech, to: speechAlpha, restoring: speechAlpha > oldSpeech, tuning: tuning.motion)
            bubbleMotion.fade(bubble, to: bubbleAlpha, restoring: bubbleAlpha > oldBubble, tuning: tuning.motion)
        }
    }

    @objc private func displayOptionsMoved() {
        let changedMotion = cachedReduceMotion != motionPreference()
        cachedReduceMotion = motionPreference()
        refreshDisplayStyle()
        guard changedMotion else { return }
        if reduceMotion { clearWindowMotion(); clearPerk() }
        preparedKey = ""; prepareFrames()
        loopKey = nil
        draw()
        place(reorder: false)
        if let target = retainedTarget, logicalVisible, !relocating { applySqueeze(target, at: CACurrentMediaTime()) }
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
            let sleeping = record.mood == "sleep"
            awakenLocally(); gestureAt = localTouchAt; touched("pat", localTouchAt)
            closeCard()
            if sleeping {
                queuedReaction = Reactor.Reaction(key: "thanks",frame: "happy",hold: tuning.touch.greetingMs / 1000,line: record.words.thanks,lineHold: tuning.touch.thanksLineMs / 1000)
                startWake(held: false)
            } else {
                showReaction(Reactor.Reaction(key: "thanks",frame: "happy",hold: tuning.touch.greetingMs / 1000,line: record.words.thanks,lineHold: tuning.touch.thanksLineMs / 1000))
            }
            if !sleeping { reactionLine = (record.words.thanks,now + tuning.touch.thanksLineMs) }
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
        let visible = logicalVisible && target.active && press?.moved != true && !activityPresented && !Self.offscreen
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
        card.view.contrast = contrastPreference()
        var size = card.view.fit(words: record.words, lang: record.lang, waiting: cardWaiting, width: target.visible.width - 16)
        var selected = Place.linePlacement(for: target, size: size, current: cardMotion.side, motion: tuning.motion, allowFallback: false)
        if selected == nil {
            size = card.view.fit(words: record.words, lang: record.lang, waiting: cardWaiting,
                                 width: Place.lineWidthLimit(for: target, size: size, motion: tuning.motion))
            selected = Place.linePlacement(for: target, size: size, current: cardMotion.side, motion: tuning.motion)
        }
        guard var placement = selected else {
            card.panel.orderOut(nil); return
        }
        placement.frame = aligned(placement.frame)
        cardMotion.place(card.panel, placement: placement, reduceMotion: reduceMotion, tuning: tuning.motion)
        card.panel.level = hit.level
        card.panel.collectionBehavior = hit.collectionBehavior
        if allowsWindowPresentation {
            if card.panel.parent == nil { hit.addChildWindow(card.panel, ordered: .above) }
            if !card.panel.isVisible { card.panel.order(.above, relativeTo: hit.windowNumber) }
        }
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
    func setUnseen(_ count: Int, opensDm: Bool = false) {
        unseen = count; badgeOpensDm = opensDm
        // Release at zero even while he is hidden and placement returns before placeAround.
        if count == 0, let badge {
            badge.parent?.removeChildWindow(badge); badge.orderOut(nil); badge.close()
            self.badge = nil; badgeView = nil
        }
        place(reorder: false)
    }
    @objc func openActivity() { requestActivity() }
    @objc func openDm() { requestDm() }
    private func pressBadge() { if badgeOpensDm { requestDm() } else { requestActivity() } }
    @objc func backToClaude() { NSRunningApplication.runningApplications(withBundleIdentifier: targetBundleID).first?.activate(options: []) }
    @objc func toggleLines() {
        store.linesHidden.toggle(); updateActions(); draw(); place(reorder: false); store.save()
    }
    func pointer(_ surface: HoverState.Surface, inside: Bool) {
        if surface == .sprite && !inside {
            deliberatePointer = false; pointerSample = nil
            if tuning.pointer.near == .reduced { leaveReducedPointerPill(at: CACurrentMediaTime()) }
        }
        guard press?.moved != true, card?.panel.isVisible != true, !activityPresented else { return }
        // Exit can arrive before the sibling panel's enter. Read geometry in the same event;
        // crossing between the two does not need a grace timer.
        let point = NSEvent.mouseLocation
        let onSprite = surface == .sprite ? inside : hit.isVisible && hit.frame.contains(point)
        let onPill = surface == .pill ? inside : hoverPanel?.isVisible == true && hoverPanel!.frame.contains(point)
        if surface == .sprite && !inside {
            relaxPointer.fire(after: tuning.motion.number("near.perkGraceMs") / 1000)
        }
        hover.pointer(.sprite, inside: onSprite, at: now / 1000, deliberate: deliberatePointer, tuning: tuning.motion)
        hover.pointer(.pill, inside: onPill, at: now / 1000, tuning: tuning.motion)
        armHoverDeadline()
        place(reorder: false)
    }
    func pointerEntered(at seconds: Double, position: CGPoint) {
        pointerSample = (position, seconds); pointerSpeed = 0; deliberatePointer = false
        relaxPointer.cancel(); pointer(.sprite, inside: true)
        fadeForPointer(position: position, at: seconds, tracking: true)
        cocoEvent()
    }
    /// Only a mouseMoved inside his own tracking area counts as approaching him.
    func pointerMotionEvent(position: CGPoint, at seconds: Double) {
        pointerMotionEvent(position: position, at: seconds, speechFrame: nil, pillFrame: nil)
    }
    func pointerMotionEvent(position: CGPoint, at seconds: Double, speechFrame: CGRect?, pillFrame: CGRect?) {
        guard record.mood != "sleep", press == nil, !activityPresented, card?.panel.isVisible != true,
              let old = pointerSample, seconds > old.at else {
            pointerSample = (position, seconds)
            fadeForPointer(position: position, at: seconds, speechFrame: speechFrame, pillFrame: pillFrame, tracking: true); return
        }
        let dt = seconds - old.at
        let speed = hypot(position.x - old.point.x, position.y - old.point.y) / dt
        let tau = tuning.motion.number("near.speedTauMs") / 1000
        pointerSpeed += (speed - pointerSpeed) * (1 - exp(-dt / tau))
        pointerSample = (position, seconds)
        if pointerSpeed > tuning.motion.number("near.passSpeedPtPerS") { deliberatePointer = false }
        else if pointerSpeed < tuning.motion.number("near.withSpeedPtPerS") { deliberatePointer = true }
        fadeForPointer(position: position, at: seconds, speechFrame: speechFrame, pillFrame: pillFrame, tracking: true)
        if deliberatePointer {
            relaxPointer.cancel()
            hover.pointer(.sprite, inside: true, at: now / 1000, deliberate: true, tuning: tuning.motion)
            armHoverDeadline(); perkPointer(position: position)
        } else {
            hover.pointer(.sprite, inside: true, at: now / 1000, deliberate: false, tuning: tuning.motion)
            armHoverDeadline()
        }
    }
    private func armHoverDeadline() {
        let deadline = [hover.showAt, hover.hideAt].compactMap { $0 }.min()
        if let deadline { hoverDeadline.fire(after: max(0, deadline - now / 1000)) } else { hoverDeadline.cancel() }
    }
    private func advanceHover() {
        hover.advance(at: now / 1000, carried: press?.moved == true, card: card?.panel.isVisible == true || activityPresented)
        place(reorder: false); armHoverDeadline()
    }
    private func perkPointer(position: CGPoint) {
        guard let target = target(), windowFaceAllowed else { return }
        let fraction = (position.x - target.frame.midX) / target.frame.width
        let requested: String? = fraction < -tuning.motion.number("near.glanceSideFraction") ? "glance" : fraction > tuning.motion.number("near.glanceSideFraction") ? "glance-right" : nil
        let wanted = requested.flatMap { frames.hasFace($0, on: displayedBase, size: store.size) ? $0 : nil }
        if wanted != glanceFace { glanceFace = wanted; if let wanted { applyStaticWindowFace(wanted) } else { draw() } }
        guard !reduceMotion, lookView.picture.animation(forKey: "perk") == nil,
              lookView.picture.transform.m22 == 1 else { return }
        let perk = tuning.motion.number("near.perk")
        let value = CATransform3DMakeScale(1 - perk / 4, 1 + perk, 1)
        let animation = CABasicAnimation(keyPath: "transform")
        animation.fromValue = lookView.picture.presentation()?.transform ?? lookView.picture.transform
        animation.toValue = value; animation.duration = tuning.motion.number("near.perkMs") / 1000
        animation.timingFunction = CompanionAnimation.timing(tuning.motion.curve("near.perkCurve"))
        lookView.picture.transform = value; lookView.picture.add(animation, forKey: "perk")
    }
    private func relaxPerk() {
        glanceFace = nil
        guard !touchActive else { return }
        let layer = lookView.picture, from = layer.presentation()?.transform ?? layer.transform
        layer.removeAnimation(forKey: "perk"); layer.transform = CATransform3DIdentity
        if !reduceMotion {
            let spring = CASpringAnimation(keyPath: "transform")
            spring.fromValue = from; spring.toValue = CATransform3DIdentity
            spring.mass = tuning.motion.number("near.relaxMass"); spring.stiffness = tuning.motion.number("near.relaxStiffness"); spring.damping = tuning.motion.number("near.relaxDamping")
            spring.duration = spring.settlingDuration; layer.add(spring, forKey: "pointer-relax")
        }
        draw()
    }
    private func clearPerk() {
        deliberatePointer = false; glanceFace = nil; pointerSample = nil; pointerSpeed = 0
        relaxPointer.cancel(); hoverDeadline.cancel()
        lookView.picture.removeAnimation(forKey: "perk"); lookView.picture.removeAnimation(forKey: "pointer-relax")
        if !touchActive { lookView.picture.transform = CATransform3DIdentity }
    }
    private func attach(_ panel: Panel, at frame: NSRect) {
        var frame = aligned(frame)
        if Self.offscreen { frame.origin.x += 30_000 }
        panel.level = hit.level; panel.setFrame(frame, display: allowsWindowPresentation)
        panel.collectionBehavior = hit.collectionBehavior
        guard allowsWindowPresentation else { return }
        if panel.parent == nil { hit.addChildWindow(panel, ordered: .above) }
        if !panel.isVisible { panel.order(.above, relativeTo: hit.windowNumber) }
    }
    private func speechTarget(_ target: Place.Target) -> Place.Target {
        var target = target
        // Coco's canvas keeps room above their head for hops and feelers; the line and the pill come down by it, to
        // sit as close above them as above his painted frame (companion-rs COCO_HEAD_DROP)
        if coco != nil { target.frame.size.height -= (target.frame.height * (26.0 / 241 - 4.0 / 128)).rounded() }
        let overlay: NSRect?
        if hover.visible && hoverPanel?.isVisible == true {
            overlay = Place.hoverOverlay(for: target, labelWidths: HoverView.labelWidths(words: record.words, lang: record.lang,
                                                                                       visibleWidth: target.visible.intersection(target.screen).width), motion: tuning.motion)
        } else if bubble.isVisible {
            overlay = Place.bubbleFrame(for: target, size: bubble.frame.size, motion: tuning.motion)
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
            hoverView?.contrast = contrastPreference()
            hoverView?.configure(words: record.words, hidden: store.linesHidden, unseen: unseen)
            attach(hoverPanel!, at: Place.bubbleFrame(for: target, size: NSSize(width: 144, height: 32), motion: tuning.motion))
            placeHoverLabel()
        } else { hideHoverRow() }
        if !blocked, !hover.visible, let shownTask=D1Pill.task(record,now:now,pixel:store.size.pixelArt,reduced:reduceMotion) {
            bubbleView.contrast = contrastPreference()
            bubbleView.ribbon=record.ribbon
            let size = bubbleView.fit(project: record.project, task: shownTask, lang: record.lang, maxWidth: min(260, target.visible.width - 8))
            attach(bubble, at: Place.bubbleFrame(for: target, size: size, motion: tuning.motion))
        } else { bubble.orderOut(nil); bubbleRestore.cancel(); bubbleFade = CompanionPointerFade(); bubbleMotion.reset(on: bubble) }
        if unseen > 0 && press?.moved != true {
            if badge == nil {
                let panel = Panel(clickable: true, shadow: false), view = BadgeView()
                view.pressed = { [weak self] in self?.pressBadge() }; panel.contentView = view
                badge = panel; badgeView = view
            }
            badgeView!.contrast = contrastPreference()
            let size = badgeView!.fit(count: unseen, words: record.words, lang: record.lang,
                                      name: badgeOpensDm ? record.dm.map { "\($0.label), \(unseen)" } : nil)
            attach(badge!, at: Place.badgeFrame(for: target, size: size, motion: tuning.motion))
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
                        visible: visible, parent: hit, contrast: view.contrast, faceKeepOut: Place.faceKeepOut(for: target, motion: tuning.motion))
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
        for (size, title) in zip(Size.allCases, [words.medium, words.large, words.larger]) {
            let entry = item(title, #selector(pickSize(_:))); entry.representedObject = size.rawValue
            entry.state = store.size == size ? .on : .off; menu.addItem(entry)
        }
        menu.popUp(positioning: nil, at: NSPoint(x: 0, y: view.bounds.height), in: view)
    }

    // ------------------------------------------------------------ touch

    func pressed(option: Bool) {
        clearWindowFace(); rideLineTimer.cancel(); pendingRideLine = nil; pendingRideReactor = nil
        // pressIn reads the presented perk transform before taking ownership of the picture layer.
        relaxPointer.cancel(); lookView.picture.removeAnimation(forKey: "pointer-relax")
        gestureAt = now.rounded(.down)
        let sleeping = record.mood == "sleep"
        awakenLocally()
        heldWakePress = sleeping && !reduceMotion
        if wakeUntil > now { repeatTouchImpulse() }
        else {
            patStartedAt = sleeping ? nil : gestureAt
            reaction = (frames.resolveName(record.frame,size: store.size) ?? record.frame,now + tuning.touch.patMs); touchKey = "pat"
            pressIn(durationMs: sleeping ? tuning.touch.heldWakeMs : nil)
        }
        if sleeping { startWake(held: true) }
        touched("pat", gestureAt)
        press = (pointerPosition(), hit.frame.origin, option, false, false)
        carriedInFullScreen = windowFillsScreen
        longPress.fire(after: tuning.touch.hugMs / 1000)
    }

    func dragged() {
        guard var current = press else { return }
        let point = pointerPosition()
        let dx = point.x - current.start.x
        let dy = point.y - current.start.y
        if !current.moved {
            guard hypot(dx, dy) >= tuning.touch.dragDistance else { return }
            current.moved = true
            press = current
            longPress.cancel()
            card?.panel.orderOut(nil)
            bubble.orderOut(nil); resetPointerPill(); hideHoverRow(); badge?.orderOut(nil)
            installPointerMonitor()
            hover.blocked(carried: true, card: false)
            // Picked up: above everything while carried.
            for panel in [hit, look, speech] where panel.level != .floating { panel.level = .floating }
            if allowsWindowPresentation { hit.orderFrontRegardless() }
            dragOrigin = CGPoint(x: current.origin.x + dx, y: current.origin.y + dy)
            react(.dragStart)
            return
        }
        dragOrigin = CGPoint(x: current.origin.x + dx, y: current.origin.y + dy)
        carry()
        if shake.feed(x: Double(point.x), y: Double(point.y), at: now) { shaken() }
    }

    func released() {
        longPress.cancel()
        guard let current = press else { return }
        press = nil
        let opensHeldWake = heldWakePress; heldWakePress = false
        if opensHeldWake, wakeUntil > now, now < wakeLineAt, !current.moved, !reduceMotion {
            let t = tuning.touch
            wakeUntil = now + 2 * t.heldOpenMs
            play(TouchSequence(entries: [.init(ms: 0,pose: "idle-reading",face: "half-lid"),.init(ms: t.heldOpenMs,pose: "idle-reading",face: "open")],durationMs: 2 * t.heldOpenMs,lineMs: nil),base: "idle-reading")
            reaction?.until = wakeUntil; wakeLineAt = now; wakeLineTimer.fire(after: 0); wakeEnd.fire(after: 2 * t.heldOpenMs / 1000)
        }
        if wakeUntil <= now || opensHeldWake { releasePress() }
        shake.reset()
        if current.moved {
            cancelSpin()
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
        gestureAt = now.rounded(.down)
        react(.click(option: false))
    }

    private func awakenLocally() {
        localTouchAt = max(localTouchAt, now.rounded(.down))
        record = TouchAwake.applying(record,after: localTouchAt)
    }
    func woke(_ presence: Presence) {
        if presence.at == wakeEventAt, let said = presence.said, wakeUntil > 0 {
            wakeLine = said
            if now >= wakeLineAt { reactionLine = (said,now + tuning.touch.lineHoldMs); place(reorder: false) }
            return
        }
        guard presence.at > localTouchAt, now - presence.at < tuning.touch.wakeMs else { return }
        localTouchAt = presence.at; record = TouchAwake.applying(record,after: localTouchAt)
        guard logicalVisible else { preparedKey = ""; prepareFrames(); draw(); return }
        startWake(held: false); wakeLine = presence.said ?? record.wakeLines.first
    }
    private func startWake(held: Bool) {
        let t = tuning.touch
        wakeEventAt = gestureAt > 0 && held ? gestureAt : localTouchAt
        wakeUntil = now + (held && !reduceMotion ? t.hugMs + 2 * t.heldOpenMs : t.wakeMs)
        wakeLine = record.wakeLines.first
        let base = frames.resolveName("idle-reading",size: store.size) ?? "idle-reading"
        reaction = (base,wakeUntil); touchKey = "wake"
        if !held || reduceMotion {
            play(TouchSequence.make("wake",base: base,tuning: t,available: Set(frames.names(size: store.size)),reduceMotion: reduceMotion),base: base)
        } else {
            play(TouchSequence(entries: [.init(ms: 0,pose: "sleep",face: nil),.init(ms: t.hugMs,pose: base,face: "half-lid"),.init(ms: t.hugMs + t.heldOpenMs,pose: base,face: "open")],durationMs: t.hugMs + 2 * t.heldOpenMs,lineMs: t.wakeLineMs),base: base)
        }
        if !reduceMotion && !held {
            let jolt = CABasicAnimation(keyPath: "transform.scale.y")
            jolt.fromValue = lookView.picture.presentation()?.value(forKeyPath: "transform.scale.y") ?? 1
            jolt.toValue = t.pressY; jolt.duration = t.wakeJoltMs / 1000
            jolt.timingFunction = CAMediaTimingFunction(controlPoints: Float(t.pressCurve[0]),Float(t.pressCurve[1]),Float(t.pressCurve[2]),Float(t.pressCurve[3]))
            let rise = CASpringAnimation(keyPath: "transform.scale.y"); rise.fromValue = t.pressY; rise.toValue = 1
            rise.mass = t.wake.mass; rise.stiffness = t.wake.stiffness; rise.damping = t.wake.damping
            rise.beginTime = t.wakeJoltMs / 1000; rise.duration = max(0,(t.wakeMs-t.wakeJoltMs) / 1000)
            let group = CAAnimationGroup(); group.animations = [jolt,rise]; group.duration = t.wakeMs / 1000
            let widen = CABasicAnimation(keyPath: "transform.scale.x"); widen.fromValue = lookView.picture.presentation()?.value(forKeyPath: "transform.scale.x") ?? 1
            widen.toValue = t.pressX; widen.duration = jolt.duration; widen.timingFunction = jolt.timingFunction
            let settleX = CASpringAnimation(keyPath: "transform.scale.x"); settleX.fromValue = t.pressX; settleX.toValue = 1
            settleX.mass = t.wake.mass; settleX.stiffness = t.wake.stiffness; settleX.damping = t.wake.damping
            settleX.beginTime = rise.beginTime; settleX.duration = rise.duration
            group.animations = [jolt,rise,widen,settleX]
            lookView.picture.add(group,forKey: "wake")
        }
        wakeLineAt = now + (held && !reduceMotion ? t.hugMs : t.wakeLineMs)
        wakeLineTimer.fire(after: max(0,(wakeLineAt-now)/1000))
        wakeEnd.fire(after: max(0,(wakeUntil - now) / 1000))
    }
    private func react(_ event: Reactor.Event, publish: Bool = true) {
        let napped = nap != nil
        let sleeping = napped || record.mood == "sleep"
        if napped { nap = nil; napWake.cancel() }
        awakenLocally()
        if napped { record = playing(TouchAwake.applying(fed, after: localTouchAt)) }
        let chosen = reactor.react(event,at: (event == .click(option: false) || event == .click(option: true) ? gestureAt : now) / 1000,mood: record.mood,lines: record.reactions,random: Double.random(in: 0..<1))
        let kind = chosen.key == "flustered" ? "burst" : chosen.key == "hold" ? "hug" : chosen.key == "drag" ? "drag" : "pat"
        if publish { touched(kind,gestureAt > 0 ? gestureAt : localTouchAt) }
        if event != .dragStart, event != .drop, (sleeping || wakeUntil > now) {
            if sleeping { startWake(held: false) }
            queuedReaction = chosen
            return
        }
        if event == .dragStart { wakeEnd.cancel(); wakeLineTimer.cancel(); wakeUntil = 0; queuedReaction = nil }
        showReaction(chosen)
    }
    private func showReaction(_ chosen: Reactor.Reaction, afterWake: Bool = false) {
        let current = lookView.picture.presentation()?.contents.map { $0 as! CGImage } ?? lookView.picture.contents.map { $0 as! CGImage }
        let requested = current.flatMap { frames.baseName(of: $0) } ?? record.frame
        guard let base = frames.resolveName(requested,size: store.size) else { return }
        let continuingPat = !afterWake && patStartedAt == gestureAt
        let reactionAt = continuingPat ? gestureAt : now
        let available = record.pose != nil ? Set([base]) : Set(frames.names(size: store.size))
        reaction = (chosen.key == "wave" && available.contains("wave") ? "wave" : base,chosen.key == "drag" ? Double.infinity : chosen.key == "pat" ? reactionAt + tuning.touch.patMs : now + chosen.hold * 1000)
        touchKey = chosen.key
        if let line = chosen.line { reactionLine = (line,now + chosen.lineHold * 1000) }
        loopKey = nil; lookView.picture.removeAnimation(forKey: "loop")
        var sequence = TouchSequence.make(chosen.key,base: base,tuning: tuning.touch,available: available,reduceMotion: reduceMotion)
        if chosen.key == "pat" {
            let elapsed = continuingPat ? max(0,now - gestureAt) : 0
            sequence.entries = sequence.entries.filter { !continuingPat || $0.ms > elapsed }.map { .init(ms: $0.ms - elapsed,pose: $0.pose,face: $0.face) }
            sequence.durationMs = max(Double.leastNonzeroMagnitude,sequence.durationMs - elapsed)
        }
        play(sequence,base: base)
        patStartedAt = nil
        if !reduceMotion { animate(chosen.key,startedAt: reactionAt) }
        armReactionEnd(); place(reorder: false)
    }
    private func play(_ sequence: TouchSequence, base: String) {
        guard let base = frames.resolveName(base,size: store.size) else { return }
        var sequence = sequence
        sequence.entries = sequence.entries.map { entry in
            var entry = entry
            if let pose = entry.pose { entry.pose = frames.resolveName(pose,size: store.size) ?? base }
            return entry
        }
        touchPreparationID += 1
        activeTouch = (sequence,base,now,tuning.touch.patFaces,tuning.touch.faceSwapHz)
        touchVisualUpdates += 1; touchPlan = sequence
        paint(sequence,base: base,elapsed: 0)
        requestTouchPreparation()
    }
    private func requestTouchPreparation() {
        guard let activeTouch else { return }
        let sequence = activeTouch.sequence, base = activeTouch.base, began = activeTouch.began, id = touchPreparationID
        let poses = sequence.entries.compactMap(\.pose).compactMap { frames.resolveName($0,size: store.size) }
        let bases = Set(([base] + sequence.entries.filter { $0.face != nil }.compactMap(\.pose)).compactMap { frames.resolveName($0,size: store.size) })
        let names = (tuning.touch.preload + [base] + poses).compactMap { frames.resolveName($0,size: store.size) }
        frames.prepareTouch(names,on: Array(bases),size: store.size,scale: scale,
                            aliases: tuning.touch.faceAliases,timeline: activeTouch.timeline,curve: tuning.touch.leanCurve,rate: activeTouch.rate) { [weak self] in
            guard let self, self.touchPreparationID == id else { return }
            self.paint(sequence,base: base,elapsed: max(0,self.now - began))
        }
    }
    private func paint(_ sequence: TouchSequence, base: String, elapsed: Double) {
        let picture = lookView.picture
        func resolved(_ entry: TouchSequence.Entry) -> CGImage? {
            guard let pose = frames.resolveName(entry.pose ?? base,size: store.size) else { return nil }
            return entry.face.flatMap { frames.cachedFace($0,on: pose,size: store.size,scale: scale) } ?? frames.cached(pose,size: store.size,scale: scale)
        }
        let caughtUp = elapsed > 0 ? sequence.entries.last(where: { $0.ms <= elapsed && ($0.pose != nil || $0.face != nil) }).flatMap(resolved) : nil
        let initial = caughtUp ?? (picture.presentation()?.contents.map { $0 as! CGImage }) ?? (picture.contents.map { $0 as! CGImage }) ?? frames.cached(base,size: store.size,scale: scale)
        guard let initial else { return }
        picture.removeAnimation(forKey: "loop"); picture.removeAnimation(forKey: "touch")
        if elapsed >= sequence.durationMs { lookView.show(initial,scale: scale); return }
        var values: [CGImage] = [initial], times = [0.0]
        let remaining = max(Double.leastNonzeroMagnitude,sequence.durationMs - elapsed)
        for entry in sequence.entries where entry.ms >= elapsed {
            if entry.pose == nil && entry.face == nil { continue }
            let image = resolved(entry)
            guard let image else { continue }
            values.append(image); times.append(min(1,(entry.ms - elapsed) / remaining))
        }
        if times.last! < 1 { values.append(values.last!); times.append(1) }
        let animation = CAKeyframeAnimation(keyPath: "contents")
        animation.values = values; animation.keyTimes = times.map(NSNumber.init(value:)); animation.calculationMode = .discrete
        animation.duration = remaining / 1000; animation.isRemovedOnCompletion = false; animation.fillMode = .forwards
        lookView.show(values.last!,scale: scale); picture.add(animation,forKey: "touch")
    }
    private func spring(_ path: String, from: Double, spec: CompanionTuning.Spring, key: String, duration: Double? = nil) {
        let spring = CASpringAnimation(keyPath: path); spring.fromValue = from; spring.toValue = 1
        spring.mass = spec.mass; spring.stiffness = spec.stiffness; spring.damping = spec.damping
        spring.duration = duration ?? spring.settlingDuration; lookView.picture.add(spring,forKey: key)
    }
    private func pressIn(durationMs: Double? = nil) {
        func currentBase() -> String {
            let current = lookView.picture.presentation()?.contents.map { $0 as! CGImage } ?? lookView.picture.contents.map { $0 as! CGImage }
            let requested = current.flatMap { frames.baseName(of: $0) } ?? record.frame
            return frames.resolveName(requested,size: store.size) ?? record.frame
        }
        if reduceMotion {
            let base = currentBase()
            play(TouchSequence.make("pat",base: base,tuning: tuning.touch,available: Set(frames.names(size: store.size)),reduceMotion: true),base: base)
            return
        }
        let picture = lookView.picture, t = tuning.touch
        let from = picture.presentation()?.transform ?? picture.transform
        for key in ["press","release","pat-y","pat-x","stroke","shake","hug","startle","land-y","land-x","perk"] { picture.removeAnimation(forKey: key) }
        var first = from; first = CATransform3DScale(first,1,t.pressFirstY,1)
        if lookView.picture.animation(forKey: "touch") != nil { first.m22 += CGFloat(t.repeatImpulseY) }
        CATransaction.begin(); CATransaction.setDisableActions(true); picture.transform = first; CATransaction.commit()
        var to = CATransform3DScale(CATransform3DIdentity,t.pressX,t.pressY,1); to.m21 = tan(t.leanRadians)
        let pressMs = durationMs ?? t.pressMs, duration = max(pressMs,t.leanMs)
        let count = max(1,Int(ceil(duration * t.faceSwapHz / 1000)))
        var values: [NSValue] = [], times: [NSNumber] = []
        let components: [WritableKeyPath<CATransform3D,CGFloat>] = [\.m11,\.m12,\.m13,\.m14,\.m21,\.m22,\.m23,\.m24,\.m31,\.m32,\.m33,\.m34,\.m41,\.m42,\.m43,\.m44]
        for i in 0...count {
            let ms = duration * Double(i) / Double(count)
            let press = CGFloat(Frames.curve(min(1,ms / pressMs),points: t.pressCurve))
            let lean = CGFloat(Frames.curve(min(1,ms / t.leanMs),points: t.leanCurve))
            var value = first
            for component in components {
                let progress = component == \.m21 ? lean : press
                value[keyPath: component] = first[keyPath: component] + (to[keyPath: component] - first[keyPath: component]) * progress
            }
            values.append(NSValue(caTransform3D: value)); times.append(NSNumber(value: Double(i) / Double(count)))
        }
        let animation = CAKeyframeAnimation(keyPath: "transform"); animation.values = values; animation.keyTimes = times
        animation.calculationMode = .linear; animation.duration = duration / 1000
        picture.transform = to; picture.add(animation,forKey: "press")
        let base = currentBase()
        play(TouchSequence.make("pat",base: base,tuning: t,available: Set(frames.names(size: store.size)),reduceMotion: false),base: base)
    }
    private func releasePress() {
        let picture = lookView.picture
        let transform = picture.presentation()?.transform ?? picture.transform
        picture.removeAnimation(forKey: "press"); picture.transform = CATransform3DIdentity
        guard !reduceMotion else { return }
        let animation = CASpringAnimation(keyPath: "transform"); animation.fromValue = transform; animation.toValue = CATransform3DIdentity
        animation.mass = tuning.touch.release.mass; animation.stiffness = tuning.touch.release.stiffness; animation.damping = tuning.touch.release.damping
        animation.duration = animation.settlingDuration; picture.add(animation,forKey: "release")
    }
    private func repeatTouchImpulse() {
        guard !reduceMotion else { return }
        let picture = lookView.picture, t = tuning.touch
        let current = picture.presentation()?.value(forKeyPath: "transform.scale.y") as? Double ?? 1
        let impulse = CASpringAnimation(keyPath: "transform.scale.y")
        impulse.fromValue = current + t.repeatImpulseY; impulse.toValue = current
        impulse.mass = t.poke.mass; impulse.stiffness = t.poke.stiffness; impulse.damping = t.poke.damping
        impulse.duration = impulse.settlingDuration; picture.add(impulse,forKey: "repeat-touch")
    }

    // The next moment a reaction's face or line runs out.
    // ------------------------------------------------------------ play

    /// What play changes in the record he draws from: the lid's nap forces sleep, and while his stick
    /// burns the lines nobody asked for (a visitor's, a shared one) are not shown.
    private func playing(_ source: Record) -> Record {
        var shown = source
        if nap != nil {
            shown.mood = "sleep"; shown.frame = "sleep"; shown.pose = nil
            shown.loop = nil; shown.every = nil; shown.rest = true; shown.slip = false; shown.said = nil
        }
        if let stick = source.stick, stick.burning(at: now), source.presence != nil { shown.said = nil }
        return shown
    }
    private func reapplyPlay() {
        let before = record
        record = playing(TouchAwake.applying(fed, after: localTouchAt))
        guard record != before else { return }
        loopKey = nil; gazeBlink = true
        if record.mood == "sleep" || Reactor.urgent.contains(record.mood) { clearWindowFace(); clearPerk() }
        preparedKey = ""; prepareFrames(); draw(); place(reorder: false)
    }

    /// The shake. The first: he spins (four half-turns, his face front and back), then he is dizzy and says a
    /// line from the `shaken` pool. A second inside eight seconds only holds his book tight.
    private func shaken() {
        guard press?.moved == true, nap == nil, logicalVisible else { return }
        let t = tuning.touch
        if now - lastSpinAt < Spin.againMs {
            showReaction(Reactor.Reaction(key: "hold", frame: "refuse", hold: 600, line: nil, lineHold: t.lineHoldMs / 1000))
            return
        }
        lastSpinAt = now
        let current = lookView.picture.presentation()?.contents.map { $0 as! CGImage } ?? lookView.picture.contents.map { $0 as! CGImage }
        let requested = current.flatMap { frames.baseName(of: $0) } ?? record.frame
        guard let base = frames.resolveName(requested,size: store.size) else { return }
        // Until the back and the dizzy face are drawn he turns on his flustered face.
        let names = Set(frames.names(size: store.size))
        let front = names.contains("flustered") ? "flustered" : base
        let back = names.contains("spin-back") ? "spin-back" : front
        let dizzy = names.contains("dizzy") ? "dizzy" : front
        let total = Spin.totalMs(reduceMotion: reduceMotion)
        var entries: [TouchSequence.Entry] = [.init(ms: 0,pose: front,face: nil)]
        if reduceMotion {
            entries.append(.init(ms: Spin.stillMs,pose: base,face: nil))
        } else {
            for (index, edge) in Spin.edges.enumerated() { entries.append(.init(ms: edge,pose: index % 2 == 0 ? back : front,face: nil)) }
            entries.append(.init(ms: Spin.spinMs,pose: dizzy,face: nil))
            entries.append(.init(ms: total,pose: base,face: nil))
        }
        reaction = (front,now + total); touchKey = "spin"
        reactionLine = nil
        loopKey = nil; lookView.picture.removeAnimation(forKey: "loop")
        play(TouchSequence(entries: entries,durationMs: total,lineMs: nil),base: base)
        if !reduceMotion { animateSpin() }
        spinLine.fire(after: (reduceMotion ? 0 : Spin.spinMs) / 1000)
        spinEnd.fire(after: total / 1000)
        armReactionEnd(); place(reorder: false)
    }
    private func animateSpin() {
        let picture = lookView.picture
        let starts = Spin.starts, total = Spin.spinMs
        var values: [Double] = [1], times: [NSNumber] = [0], timings: [CAMediaTimingFunction] = []
        for (index, edge) in Spin.edges.enumerated() {
            values.append(Spin.narrowest); times.append(NSNumber(value: edge / total)); timings.append(CAMediaTimingFunction(name: .easeIn))
            values.append(1); times.append(NSNumber(value: starts[index + 1] / total)); timings.append(CAMediaTimingFunction(name: .easeOut))
        }
        let turn = CAKeyframeAnimation(keyPath: "transform.scale.x")
        turn.values = values; turn.keyTimes = times; turn.timingFunctions = timings; turn.duration = total / 1000
        picture.add(turn,forKey: "spin")
        let sway = CAKeyframeAnimation(keyPath: "transform")
        sway.values = Spin.swaySamples.map { value -> NSValue in var m = CATransform3DIdentity; m.m21 = CGFloat(value); return NSValue(caTransform3D: m) }
        sway.duration = Spin.dizzyMs / 1000; sway.beginTime = CACurrentMediaTime() + Spin.spinMs / 1000
        sway.isAdditive = true
        picture.add(sway,forKey: "sway")
    }
    private func saySpinLine() {
        guard let line = reactor.pick("shaken",at: now / 1000,lines: record.reactions,random: Double.random(in: 0..<1)) else { return }
        reactionLine = (line,now + tuning.touch.lineHoldMs)
        place(reorder: false); armReactionEnd()
    }
    private func spinFinished() {
        lookView.picture.removeAnimation(forKey: "spin"); lookView.picture.removeAnimation(forKey: "sway")
        // Still held: back to the carry's own face.
        guard press?.moved == true else { return }
        showReaction(Reactor.Reaction(key: "drag",frame: "error",hold: 600,line: nil,lineHold: 0))
    }
    private func cancelSpin() {
        spinLine.cancel(); spinEnd.cancel()
        lookView.picture.removeAnimation(forKey: "spin"); lookView.picture.removeAnimation(forKey: "sway")
    }

    /// The lid: the system is going to sleep, so he naps at once; nothing of his is scheduled meanwhile.
    func systemSlept() {
        guard logicalVisible, nap == nil else { return }
        nap = Nap()
        cancelSpin(); reactionEnd.cancel(); wakeEnd.cancel(); wakeLineTimer.cancel()
        reaction = nil; reactionLine = nil; activeTouch = nil; wakeUntil = 0; queuedReaction = nil
        reapplyPlay()
    }
    /// The system woke. `locked`: the screen is locked, so he waits for the unlock.
    func systemWoke(locked: Bool) {
        guard var current = nap else { return }
        current.systemWoke(at: now,locked: locked)
        nap = current
        armNap()
    }
    func screenUnlocked() {
        guard var current = nap else { return }
        current.unlocked(at: now)
        nap = current
        armNap()
    }
    private func armNap() {
        guard let at = nap?.wakeAt else { napWake.cancel(); return }
        napWake.fire(after: max(0,(at - now) / 1000))
    }
    private func napFinished() {
        guard nap != nil else { return }
        nap = nil; napWake.cancel()
        guard fed.mood != "sleep", logicalVisible else { reapplyPlay(); return }
        // He was awake before the lid: he wakes with his usual first moment, in his true state.
        awakenLocally()
        record = playing(TouchAwake.applying(fed,after: localTouchAt))
        startWake(held: false)
        lookView.picture.removeAnimation(forKey: "loop")
        loopKey = nil; preparedKey = ""; prepareFrames()
        draw(); place(reorder: false); armReactionEnd()
    }

    /// His stick, small, at the bottom right of his picture. Changes on its own steps (about every 36 seconds
    /// for 25 minutes), and nothing runs when none is lit.
    private func updateStick() {
        stickTick.cancel()
        guard !record.ended, nap == nil, let stick = record.stick, stick.visible(at: now) else {
            if stickLayer.superlayer != nil { stickLayer.removeFromSuperlayer() }
            return
        }
        let dark = hit.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        let ended: Double? = stick.burning(at: now) ? nil : now - stick.endsAt
        guard let image = StickArt.image(steps: stick.burned(at: now),ended: ended,dark: dark,
                                         highContrast: NSWorkspace.shared.accessibilityDisplayShouldIncreaseContrast) else { return }
        let box = artLayer.bounds
        let pixel = max(1 / scale,0.3 * box.height / CGFloat(StickArt.height))
        CATransaction.begin(); CATransaction.setDisableActions(true)
        stickLayer.contentsScale = scale
        stickLayer.magnificationFilter = .nearest; stickLayer.minificationFilter = .nearest
        stickLayer.contents = image
        stickLayer.frame = CGRect(x: box.width - CGFloat(StickArt.width) * pixel * 1.4,y: 0,
                                  width: CGFloat(StickArt.width) * pixel,height: CGFloat(StickArt.height) * pixel)
        if stickLayer.superlayer !== artLayer { artLayer.addSublayer(stickLayer) }
        CATransaction.commit()
        if let next = stick.nextChange(after: now,reduceMotion: reduceMotion) { stickTick.fire(after: max(0.05,(next - now) / 1000)) }
    }
    private func stickChanged() {
        reapplyPlay()
        updateStick()
    }

    private func armReactionEnd() {
        let ends = [reaction?.until, reactionLine?.until].compactMap { $0 }.filter { $0.isFinite && $0 > now }
        guard let next = ends.min() else {
            reactionEnd.cancel()
            return
        }
        reactionEnd.fire(after: (next - now) / 1000)
    }

    private func animate(_ key: String, startedAt: Double) {
        let t = tuning.touch
        switch key {
        case "drop": spring("transform.scale.y",from: t.landY,spec: t.poke,key: "land-y"); spring("transform.scale.x",from: t.landX,spec: t.poke,key: "land-x")
        case "drag": spring("transform.scale.y",from: t.pressY,spec: t.poke,key: "startle")
        case "hold": poseDip(y: t.dipY,x: t.dipX,delayMs: 0,key: "hug")
        case "pat":
            if press == nil && lookView.picture.animation(forKey: "release") == nil { spring("transform.scale.y",from: t.pressY,spec: t.release,key: "pat-y") }
            let stroke = CAKeyframeAnimation(keyPath: "transform.scale.y"); stroke.values = [1,t.strokeY / t.pressY,1]; stroke.duration = t.strokeMs / 1000
            stroke.beginTime = CACurrentMediaTime() + max(0,t.strokeStartMs - (now - startedAt)) / 1000; stroke.isAdditive = false; lookView.picture.add(stroke,forKey: "stroke")
        case "flustered":
            poseDip(y: t.burstY,x: t.burstX,delayMs: 0,key: "burst")
            let shake = CAKeyframeAnimation(keyPath: "transform"); shake.values = t.shake.map { value in var m = CATransform3DIdentity; m.m21 = CGFloat(tan(value)); return NSValue(caTransform3D: m) }
            shake.duration = t.shakeMs / 1000; shake.isAdditive = true; lookView.picture.add(shake,forKey: "shake")
            for delay in [t.shioriInMs - t.poseCutMs,t.shioriOutMs - t.poseCutMs] {
                poseDip(y: t.dipY,x: t.dipX,delayMs: delay,key: "shiori-dip-\(delay)")
            }
        default: break
        }
    }
    private func poseDip(y: Double, x: Double, delayMs: Double, key: String) {
        let t = tuning.touch, picture = lookView.picture
        var tracks: [CAAnimation] = [], duration = 0.0
        for (path,to) in [("transform.scale.y",y),("transform.scale.x",x)] {
            let down = CABasicAnimation(keyPath: path); down.fromValue = delayMs == 0 ? picture.presentation()?.value(forKeyPath: path) ?? 1 : 1
            down.toValue = to; down.duration = t.dipMs / 1000
            down.timingFunction = CAMediaTimingFunction(controlPoints: Float(t.pressCurve[0]),Float(t.pressCurve[1]),Float(t.pressCurve[2]),Float(t.pressCurve[3]))
            let rise = CASpringAnimation(keyPath: path); rise.fromValue = to; rise.toValue = 1
            rise.mass = t.dip.mass; rise.stiffness = t.dip.stiffness; rise.damping = t.dip.damping
            rise.beginTime = down.duration; rise.duration = rise.settlingDuration
            tracks += [down,rise]; duration = max(duration,down.duration + rise.duration)
        }
        let group = CAAnimationGroup(); group.animations = tracks; group.duration = duration
        group.beginTime = CACurrentMediaTime() + delayMs / 1000; picture.add(group,forKey: key)
    }

    /// Five groups, the same order as the Windows and Linux pets: what Claude is doing, playing with it, how it looks,
    /// where it lives, quit.
    func contextMenu() -> NSMenu {
        let words = record.words
        let menu = NSMenu()
        menu.autoenablesItems = false
        let names = HoverView.names(words: words, hidden: store.linesHidden)
        if let quota = record.quota.flatMap({ QuotaWindow.narrowLine($0, lang: record.lang) }) {
            menu.addItem(item(quota, #selector(openActivity)))
        }
        menu.addItem(item(names[0], #selector(openActivity)))
        if let dm = record.dm, !dm.label.isEmpty { menu.addItem(item(dm.label, #selector(openDm))) }
        if let chat = newChatItem(words) { menu.addItem(chat) }
        menu.addItem(item(names[1], #selector(backToClaude)))
        menu.addItem(.separator())

        menu.addItem(item(words.patMenu, #selector(patFromMenu)))
        let actions = NSMenu()
        actions.autoenablesItems = false
        actions.addItem(item(words.actWave, #selector(waveFromMenu)))
        actions.addItem(item(words.actHug, #selector(hugFromMenu)))
        actions.addItem(item(words.actFlustered, #selector(flusterFromMenu)))
        let actionsItem = NSMenuItem(title: words.actions, action: nil, keyEquivalent: "")
        actionsItem.submenu = actions
        menu.addItem(actionsItem)
        menu.addItem(.separator())

        let sizes = NSMenu()
        for size in Size.allCases {
            let title = switch size {
            case .medium: words.medium
            case .large: words.large
            case .larger: words.larger
            }
            let item = item(title, #selector(pickSize(_:)))
            item.representedObject = size.rawValue
            item.state = store.size == size ? .on : .off
            sizes.addItem(item)
        }
        let sizeItem = NSMenuItem(title: words.size, action: nil, keyEquivalent: "")
        sizeItem.submenu = sizes
        menu.addItem(sizeItem)
        menu.addItem(item(names[2], #selector(toggleLines)))
        if !store.trusted { menu.addItem(item(words.followMenu, #selector(askToFollow))) }
        menu.addItem(.separator())

        let hides = NSMenu()
        hides.autoenablesItems = false
        hides.addItem(item(words.hideHour, #selector(hideForAnHour)))
        hides.addItem(item(words.hideUntil, #selector(hideUntilCalled)))
        let hideItem = NSMenuItem(title: words.hideMenu, action: nil, keyEquivalent: "")
        hideItem.submenu = hides
        menu.addItem(hideItem)
        menu.addItem(item(words.home, #selector(putBack)))
        if LoginAgent.isInstalledBundle {
            let login = item(words.login, #selector(toggleLogin))
            login.state = store.login ? .on : .off
            menu.addItem(login)
        }
        menu.addItem(.separator())
        menu.addItem(item(words.quit, #selector(quit)))
        return menu
    }
    /// New chat, as the Activity window offers it (NewChat.swift): one face on this Mac opens at once, more than one ask which.
    private func newChatItem(_ words: Record.Words) -> NSMenuItem? {
        let faces = NewChat.available()
        guard !faces.isEmpty else { return nil }
        if faces.count == 1 {
            let entry = item(words.newChat, #selector(newChatPicked(_:)))
            entry.representedObject = faces[0].rawValue
            return entry
        }
        let submenu = NSMenu()
        submenu.autoenablesItems = false
        for face in faces {
            let entry = item(face.word(words), #selector(newChatPicked(_:)))
            entry.representedObject = face.rawValue
            submenu.addItem(entry)
        }
        let parent = NSMenuItem(title: words.newChat, action: nil, keyEquivalent: "")
        parent.submenu = submenu
        return parent
    }
    @objc private func newChatPicked(_ sender: NSMenuItem) {
        guard let raw = sender.representedObject as? String, let face = NewChat(rawValue: raw),
              let link = face.link(folder: record.cwd) else { return }
        NSWorkspace.shared.open(link)
    }
    @objc private func patFromMenu() { pat() }
    @objc private func hugFromMenu() {
        gestureAt = now.rounded(.down)
        react(.longPress)
    }
    @objc private func flusterFromMenu() {
        gestureAt = now.rounded(.down)
        react(.burst)
    }
    /// A wave is a greeting and does not tell the band it was touched.
    @objc private func waveFromMenu() {
        awakenLocally()
        let base = displayedBase
        let wave = TouchSequence.make("wave", base: base, tuning: tuning.touch, available: Set(frames.names(size: store.size)), reduceMotion: reduceMotion)
        reaction = (base, now + wave.durationMs); touchKey = "wave"
        loopKey = nil; lookView.picture.removeAnimation(forKey: "loop")
        play(wave, base: base)
        armReactionEnd(); place(reorder: false)
    }
    @objc private func toggleLogin() { setLogin(!store.login) }
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
        preparedKey = ""; prepareFrames()
        loopKey = nil
        draw()
        place(reorder: true)
        store.save()
        trace.say("pet: size \(size.rawValue)")
    }

    @objc private func hideForAnHour() { hideAway(until: Date().timeIntervalSince1970 + 3600) }
    /// Hidden until the person calls it back (the Dock icon, opening the app, the book): no timer is set.
    @objc private func hideUntilCalled() { hideAway(until: Self.hiddenForever) }
    static let hiddenForever = 4_102_444_800.0 // 2100-01-01

    private func hideAway(until: Double) {
        store.hiddenUntil = until
        if until < Self.hiddenForever { snoozeEnd.fire(after: until - Date().timeIntervalSince1970) } else { snoozeEnd.cancel() }
        store.save()
        guard logicalVisible else { hide(); return }
        hourLeaving = true; clearWindowMotion(); cancelEntry(); clearPerk(); hideExtras()
        placementChanged(nil, true)
        let base = displayedBase
        var wave = TouchSequence.make("wave", base: base, tuning: tuning.touch, available: Set(frames.names(size: store.size)), reduceMotion: reduceMotion)
        wave.durationMs = (wave.entries.first?.ms ?? 0) + tuning.motion.number("hideHour.waveMs")
        reaction = (base, now + wave.durationMs); touchKey = "wave"
        play(wave, base: base)
        if !reduceMotion { poseDip(y: tuning.touch.dipY, x: tuning.touch.dipX, delayMs: 0, key: "hour-wave-dip") }
        hourWaveEnd.fire(after: wave.durationMs / 1000)
    }
    private func finishHourWave() {
        guard hourLeaving, let target = retainedTarget else { hourLeaving = false; hide(); return }
        animatePlace(entering: false, target: target) { [weak self] in
            guard let self, self.hourLeaving else { return }; self.hourLeaving = false; self.hide()
        }
    }

    /// Back to the automatic places (or, while a window fills the screen, forget the spot there).
    @objc private func putBack() {
        if mode == .free { store.full = nil } else { store.manual = nil }
        lastShown = nil
        retainedTarget = nil
        place(reorder: true)
        store.save()
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }

    // ------------------------------------------------------------ helpers

    private func scaleOf(_ screen: CGRect) -> CGFloat {
        screens().scale(of: screen)
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
    let place = CALayer()
    let cling = CALayer()
    let picture = CALayer()
    /// Coco's frames (Pet.drawCoco), over the painted picture, which is hidden once they are shown.
    let coco = CALayer()

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.masksToBounds = false
        for item in [place, cling, picture, coco] {
            item.anchorPoint = CGPoint(x: 0.5, y: 0)
            item.masksToBounds = false
        }
        picture.contentsGravity = .resize
        picture.magnificationFilter = .nearest
        picture.minificationFilter = .nearest
        coco.contentsGravity = .resize
        coco.magnificationFilter = .linear
        coco.minificationFilter = .linear
        coco.isHidden = true
        layer?.addSublayer(place); place.addSublayer(cling); cling.addSublayer(picture); cling.addSublayer(coco)
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

    func showCoco(_ image: CGImage, scale: CGFloat) {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        coco.contentsScale = scale
        coco.contents = image
        coco.isHidden = false
        picture.isHidden = true
        CATransaction.commit()
    }

    func fit(_ size: NSSize, motion: CompanionMotionTuning = .standard, additionalRight:CGFloat=0) {
        let margin = CGFloat(motion.number("rig.overscanSidePt"))
        let bottom = size.height * CGFloat(motion.number("rig.overscanBottomFraction"))
        let wanted = NSSize(width: size.width + 2 * margin + additionalRight, height: size.height + bottom + CGFloat(motion.number("rig.overscanTopPt")))
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        frame.size = wanted
        for item in [place, cling, picture, coco] { item.bounds = CGRect(origin: .zero, size: size) }
        place.position = CGPoint(x: margin + size.width / 2, y: bottom)
        cling.position = CGPoint(x: size.width / 2, y: 0)
        picture.position = CGPoint(x: size.width / 2, y: 0)
        coco.position = CGPoint(x: size.width / 2, y: 0)
        CATransaction.commit()
    }
    func panelFrame(for frame: CGRect, motion: CompanionMotionTuning = .standard, additionalRight:CGFloat=0) -> CGRect {
        let margin = CGFloat(motion.number("rig.overscanSidePt"))
        let bottom = frame.height * CGFloat(motion.number("rig.overscanBottomFraction"))
        let minX = floor(frame.minX - margin), minY = floor(frame.minY - bottom)
        let maxX = ceil(frame.maxX + margin + additionalRight), maxY = ceil(frame.maxY + CGFloat(motion.number("rig.overscanTopPt")))
        return CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
    }
    func register(sprite: CGRect, panel: CGRect) {
        CATransaction.begin(); CATransaction.setDisableActions(true)
        place.position = CGPoint(x: sprite.minX - panel.minX + picture.bounds.width / 2, y: sprite.minY - panel.minY)
        CATransaction.commit()
    }
    func setFiltering(pixel: Bool, transformed: Bool, motion: CompanionMotionTuning = .standard) {
        let named = motion.text(transformed ? "rig.filterTransformed" : "rig.filterAtRest")
        let filter: CALayerContentsFilter = pixel || named == "nearest" ? .nearest : .linear
        CATransaction.begin(); CATransaction.setDisableActions(true)
        picture.magnificationFilter = filter; picture.minificationFilter = filter
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
        let next = NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .mouseMoved, .activeAlways, .inVisibleRect], owner: self)
        addTrackingArea(next); tracking = next
    }
    override func mouseEntered(with event: NSEvent) { pet?.pointerEntered(at: event.timestamp, position: NSEvent.mouseLocation) }
    override func mouseMoved(with event: NSEvent) { pet?.pointerMotionEvent(position: NSEvent.mouseLocation, at: event.timestamp) }
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
