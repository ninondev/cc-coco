import AppKit
import QuartzCore
import UserNotifications
import CoreGraphics

struct D1Helper: Equatable {
    let id: String, state: String
    let at: Double
    let parent: String?
    let arrivalAt: Double?
    init?(_ raw: [String: Any]) {
        guard let id = raw["id"] as? String, !id.isEmpty, id.utf8.count <= 256,
              let state = raw["state"] as? String, ["running","done","failed","stopped"].contains(state),
              let at = raw["at"] as? Double, at.isFinite, at >= 0 else { return nil }
        self.id = id; self.state = state; self.at = at; parent = raw["parent"] as? String
        arrivalAt=(raw["arrivalAt"] as? Double).flatMap {$0.isFinite && $0 >= 0 ? $0:nil}
    }
}
struct D1Shed: Equatable {
    let id: String, phase: String
    let at: Double
    init?(_ raw: [String: Any]) {
        guard let id = raw["id"] as? String, !id.isEmpty, id.utf8.count <= 256,
              let phase = raw["phase"] as? String, ["begin","end","skip"].contains(phase),
              let at = raw["at"] as? Double, at.isFinite, at >= 0 else { return nil }
        self.id = id; self.phase = phase; self.at = at
    }
    func frame(at now: Double, pixel: Bool, reduced: Bool) -> String? {
        guard phase != "skip", now >= at else { return nil }
        if phase == "begin" { return "snake" }
        let elapsed = now - at
        guard elapsed < 1600 else { return nil }
        if !pixel || reduced { return "snake" }
        return elapsed < 160 ? "shed-a" : elapsed < 360 ? "shed-b" : elapsed < 960 ? "shed-c" : "snake"
    }
}
/// A visitor on him while he dozes, or just leaving (design VISITORS.md 3). `label` is its VoiceOver phrase.
struct D1Visitor: Equatable {
    let id: String, kind: String, label: String
    let at: Double
    let leftAt: Double?
    init?(_ raw: [String: Any]) {
        guard let id = raw["id"] as? String, !id.isEmpty, id.utf8.count <= 256,
              let kind = raw["kind"] as? String, !kind.isEmpty, kind.utf8.count <= 32,
              kind.unicodeScalars.allSatisfy({ $0.value >= 97 && $0.value <= 122 }),
              let at = raw["at"] as? Double, at.isFinite, at >= 0 else { return nil }
        self.id = id; self.kind = kind; self.at = at
        leftAt = (raw["leftAt"] as? Double).flatMap { $0.isFinite && $0 >= 0 ? $0 : nil }
        label = (raw["label"] as? String).flatMap { $0.utf8.count <= 512 ? $0 : nil } ?? ""
    }
}
struct D1LongTask: Equatable {
    let id: String, mode: String, title: String, body: String, thread: String
    let startedAt: Double, completedAt: Double
    let quiet: Bool
    let targetBundleID: String?
    init?(_ raw: [String: Any]) {
        guard let id = raw["id"] as? String, !id.isEmpty, id.utf8.count <= 256,
              let startedAt = raw["startedAt"] as? Double, startedAt.isFinite, startedAt >= 0,
              let completedAt = raw["completedAt"] as? Double, completedAt.isFinite, completedAt >= startedAt,
              let mode = raw["mode"] as? String, ["off","band","notify"].contains(mode),
              let quiet = raw["quiet"] as? Bool,
              let title = raw["title"] as? String, title.utf8.count <= 512,
              let body = raw["body"] as? String, body.utf8.count <= 8192,
              let thread = raw["thread"] as? String, thread.utf8.count <= 1024 else { return nil }
        self.id=id; self.startedAt=startedAt; self.completedAt=completedAt; self.mode=mode
        self.quiet=quiet; self.title=title; self.body=body; self.thread=thread
        targetBundleID = (raw["targetBundleID"] as? String).flatMap { !$0.isEmpty && $0.utf8.count <= 256 ? $0 : nil }
    }
}
enum D1Away {
    struct Inputs: Equatable {
        var locked: Bool, displayAsleep: Bool
        var inputAge: Double
        var frontmostBundleID: String?
    }
    static func away(_ input: Inputs, target: String?) -> Bool {
        input.locked || input.displayAsleep || (input.inputAge.isFinite && input.inputAge >= 60)
            || (target.flatMap { target in input.frontmostBundleID.map { $0 != target } } ?? false)
    }
}
struct D1NotificationGate {
    private var handled = Set<String>()
    private var lastBySession: [String: Double] = [:]
    mutating func accept(_ task: D1LongTask, session: String, mood: String, authorized: Bool,
                         input: D1Away.Inputs, now: Double) -> Bool {
        let key = session + ":" + task.id
        guard !handled.contains(key), task.completedAt <= now else { return false }
        handled.insert(key)
        guard task.mode == "notify", task.quiet, task.completedAt-task.startedAt >= 120_000,
              !["waiting","question"].contains(mood), authorized,
              D1Away.away(input, target: task.targetBundleID), !task.body.isEmpty, !task.title.isEmpty,
              now - (lastBySession[session] ?? -Double.infinity) >= 600_000 else { return false }
        lastBySession[session] = now
        return true
    }
}

@MainActor
final class D1Notifications: NSObject, UNUserNotificationCenterDelegate {
    private var gate = D1NotificationGate()
    private var targets: [String:String] = [:]
    private var locked = false, displayAsleep = false
    private var observers: [NSObjectProtocol] = []
    private(set) var authorization = "notDetermined"
    private var requestedAt = 0.0
    private var settingsAt = 0.0
    private var listeningSince = 0.0
    private var authorizationPending = false
    private var inputReadTasks = Set<String>()
    var changed: () -> Void = {}
    var requestAuthorization: (@escaping (Bool) -> Void) -> Void = { completion in
        guard LoginAgent.isInstalledBundle else { completion(false); return }
        UNUserNotificationCenter.current().requestAuthorization(options:[.alert]) { granted,_ in
            DispatchQueue.main.async { completion(granted) }
        }
    }
    var refreshAuthorization: (@escaping (String)->Void)->Void = { completion in
        guard LoginAgent.isInstalledBundle else {completion("denied");return}
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            let value=settings.authorizationStatus == .authorized ? "authorized":settings.authorizationStatus == .denied ? "denied":"notDetermined"
            DispatchQueue.main.async {completion(value)}
        }
    }
    var submit: (UNNotificationRequest) -> Void = { request in
        guard LoginAgent.isInstalledBundle else { return }
        UNUserNotificationCenter.current().add(request)
    }
    var readInputs: (() -> D1Away.Inputs)?
    var openSystemSettings: ()->Void = {
        guard LoginAgent.isInstalledBundle,let url=URL(string:"x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=io.github.ninondev.coco-companion") else {return}
        NSWorkspace.shared.open(url)
    }
    var activate: (String) -> Void = { bundle in
        NSRunningApplication.runningApplications(withBundleIdentifier: bundle).first?.activate(options:[.activateIgnoringOtherApps])
    }
    /// A click on her DM's notification opens the thread.
    var openDm: () -> Void = {}
    private var dmNotices = DmNotices()
    func start() {
        guard LoginAgent.isInstalledBundle else { return }
        listeningSince=Date().timeIntervalSince1970*1000
        let center = UNUserNotificationCenter.current(); center.delegate = self
        center.getNotificationSettings { [weak self] settings in
            DispatchQueue.main.async { [weak self] in
                self?.authorization = settings.authorizationStatus == .authorized ? "authorized" : settings.authorizationStatus == .denied ? "denied" : "notDetermined"
                self?.changed()
            }
        }
        let distributed = DistributedNotificationCenter.default()
        for (name,value) in [("com.apple.screenIsLocked",true),("com.apple.screenIsUnlocked",false)] {
            observers.append(distributed.addObserver(forName:Notification.Name(name),object:nil,queue:.main) { [weak self] _ in MainActor.assumeIsolated { self?.locked=value } })
        }
        let workspace = NSWorkspace.shared.notificationCenter
        for (name,value) in [(NSWorkspace.screensDidSleepNotification,true),(NSWorkspace.screensDidWakeNotification,false)] {
            observers.append(workspace.addObserver(forName:name,object:nil,queue:.main) { [weak self] _ in MainActor.assumeIsolated { self?.displayAsleep=value } })
        }
    }
    func receive(_ record: Record, now: Double) {
        if record.longTaskSettingsRequest > settingsAt {settingsAt=record.longTaskSettingsRequest;openSystemSettings()}

        if record.longTaskAuthorizationRequest > requestedAt {
            requestedAt = record.longTaskAuthorizationRequest
            if authorization == "notDetermined",!authorizationPending {
                authorizationPending=true
                requestAuthorization { [weak self] granted in self?.authorizationPending=false;self?.authorization=granted ? "authorized":"denied";self?.changed() }
            } else if !authorizationPending {
                refreshAuthorization { [weak self] value in self?.authorization=value;self?.changed() }
            }
        }
        guard let task=record.longTask else { return }
        let event=record.session+":"+task.id
        guard !inputReadTasks.contains(event), task.completedAt <= now,task.completedAt >= listeningSince else { return }
        inputReadTasks.insert(event)
        guard task.mode == "notify", task.quiet, task.completedAt-task.startedAt >= 120_000,
              !["waiting","question"].contains(record.mood), authorization == "authorized" else { return }
        // Only bundle identity, idle age and two system-state booleans enter the decision.
        let input = readInputs?() ?? D1Away.Inputs(locked:locked || ((CGSessionCopyCurrentDictionary() as? [String:Any])?["CGSSessionScreenIsLocked"] as? Bool == true), displayAsleep:displayAsleep || CGDisplayIsAsleep(CGMainDisplayID()) != 0,
            inputAge:CGEventSource.secondsSinceLastEventType(.combinedSessionState,eventType:CGEventType(rawValue:UInt32.max)!),
            frontmostBundleID:NSWorkspace.shared.frontmostApplication?.bundleIdentifier)
        guard gate.accept(task,session:record.session,mood:record.mood,authorized:authorization == "authorized",input:input,now:now) else { return }
        let content=UNMutableNotificationContent(); content.title=task.title; content.body=task.body
        content.threadIdentifier=task.thread; content.sound=nil
        let id=record.session+":"+task.id
        if let target=task.targetBundleID { targets[id]=target;content.userInfo=["targetBundleID":target] }
        if targets.count > 256 { targets=task.targetBundleID.map { [id:$0] } ?? [:] }
        submit(UNNotificationRequest(identifier:id,content:content,trigger:nil))
    }
    /// Her DM that reached the closed thread (the plugin's dm.ts): posted once while fresh, never while the screen is
    /// locked or asleep, nor with the thread on screen (DmNotices); the first one asks macOS for permission when nobody
    /// has yet, as the long task's switch does.
    func receiveDm(_ record: Record, now: Double, threadVisible: Bool) {
        guard let dm = record.dm, dm.notify, let notice = dmNotices.take(dm, now: now, threadVisible: threadVisible),
              !locked, !displayAsleep, LoginAgent.isInstalledBundle else { return }
        let post = { [weak self] in
            guard let self, self.authorization == "authorized" else { return }
            let content = UNMutableNotificationContent(); content.title = notice.title; content.body = notice.body
            content.threadIdentifier = "dm"; content.sound = nil; content.userInfo = ["dm": true]
            self.submit(UNNotificationRequest(identifier: "dm:" + notice.id, content: content, trigger: nil))
        }
        if authorization == "notDetermined", !authorizationPending {
            authorizationPending = true
            requestAuthorization { [weak self] granted in
                self?.authorizationPending = false; self?.authorization = granted ? "authorized" : "denied"; self?.changed(); post()
            }
        } else { post() }
    }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let id=response.notification.request.identifier
        let supplied=response.notification.request.content.userInfo["targetBundleID"] as? String
        let dm=response.notification.request.content.userInfo["dm"] as? Bool == true
        Task { @MainActor [weak self] in
            if dm { self?.openDm(); completionHandler(); return }
            D1Notifications.respond(self,identifier:id,suppliedBundleID:supplied,completion:completionHandler)
        }
    }
    static func respond(_ recipient:D1Notifications?,identifier:String,suppliedBundleID:String?,completion:()->Void) {
        defer {completion()}
        if let recipient,let bundle=recipient.targets[identifier] ?? suppliedBundleID,bundle.utf8.count <= 256 {recipient.activate(bundle)}
    }
}

enum D1Ribbon {
    static let light = [0x2E5C8A,0x8C6100,0x5F5E66,0x3F7A2E,0x0F6F78,0xA8366F,0x6A4FA0]
    static let dark = [0x86AEDB,0xE3B04B,0xABAAB3,0x8CC474,0x5CC2C7,0xEE93C1,0xB9A2E6]
    @MainActor static func draw(_ index: Int, in rect: CGRect, dark: Bool) {
        guard (1...14).contains(index), let context=NSGraphicsContext.current?.cgContext else { return }
        context.saveGState(); context.translateBy(x:rect.minX,y:rect.minY); context.scaleBy(x:1,y:rect.height/22)
        let color=CardView.color((dark ? Self.dark:light)[(index-1)%7]),cx=rect.width/2
        let edge=color.blended(withFraction:dark ? 0.22:0.28,of:.black) ?? color
        let sheen=color.blended(withFraction:dark ? 0.42:0.38,of:.white) ?? color
        color.setFill()
        let path=NSBezierPath();path.move(to:.init(x:cx-2.7,y:4.6));path.line(to:.init(x:cx+2.7,y:4.6));path.line(to:.init(x:cx+2.7,y:22));path.line(to:.init(x:cx,y:19.36));path.line(to:.init(x:cx-2.7,y:22));path.close();path.fill()
        if index > 7 {color.blended(withFraction:dark ? 0.38:0.62,of:dark ? .black:.white)?.setFill();NSRect(x:cx-0.6,y:5.6,width:1.2,height:12.76).fill()}
        edge.setStroke();let borders=NSBezierPath();for x in [cx-2.45,cx+2.45] {borders.move(to:.init(x:x,y:4.6));borders.line(to:.init(x:x,y:21.4))};borders.lineWidth=0.5;borders.stroke()
        sheen.withAlphaComponent(0.5).setStroke();let tailSheen=NSBezierPath();tailSheen.move(to:.init(x:cx-1.2,y:5.2));tailSheen.line(to:.init(x:cx-1.2,y:18.56));tailSheen.lineWidth=0.6;tailSheen.stroke()
        color.setFill();let knotTail=NSBezierPath();knotTail.move(to:.init(x:cx-1.4,y:3.6));knotTail.line(to:.init(x:cx-3.9,y:6.9));knotTail.line(to:.init(x:cx-2.4,y:7.4));knotTail.line(to:.init(x:cx-0.6,y:4.8));knotTail.close();knotTail.fill();edge.setStroke();knotTail.lineWidth=0.5;knotTail.stroke()
        let knot=NSBezierPath(ovalIn:.init(x:cx-2.3,y:1,width:4.6,height:4.6));color.blended(withFraction:dark ? 0.12:0.15,of:.black)?.setFill();knot.fill();edge.setStroke();knot.lineWidth=0.55;knot.stroke()
        sheen.withAlphaComponent(0.7).setStroke();let knotSheen=NSBezierPath();knotSheen.move(to:.init(x:cx-1,y:2.6));knotSheen.curve(to:.init(x:cx+1.1,y:2.7),controlPoint1:.init(x:cx-0.33,y:1.93),controlPoint2:.init(x:cx+0.37,y:1.97));knotSheen.lineWidth=0.6;knotSheen.stroke()
        context.restoreGState()
    }
}

@MainActor
final class D1Helpers {
    private struct Item {
        let panel: Panel; let view: D1ScrollView; let host: D1ScrollHostView; var state: String
        var drawnFrame: CGRect {CGRect(x:panel.frame.minX+view.frame.minX,y:panel.frame.minY+view.frame.minY,width:view.frame.width,height:view.frame.height)}
    }
    private var items: [String:Item] = [:]
    private var leaving: [Panel] = []
    private struct Reservation { let offset: CGFloat, width: CGFloat, until: Double }
    private var reservations: [String:Reservation] = [:]
    private var refresh: (() -> Void)?
    private lazy var reflow = OneShot { [weak self] in self?.refresh?() }
    static func widths(count: Int, pixel: Bool, artPoint: CGFloat) -> [CGFloat] {
        let bundle=count >= 5,shown=min(4,max(0,count)); return (0..<shown).map { index in pixel ? (bundle && index == 3 ? 11:5)*artPoint : bundle && index == 3 ? 17:10 }
    }
    private static func hostFrame(for drawing:CGRect,pixel:Bool,reduced:Bool)->CGRect {
        guard !pixel && !reduced else {return drawing.integral}
        let width=drawing.width,height=drawing.height,pivot=width/2
        let angle=CGFloat(70*Double.pi/180)
        let leftPeak=min(angle,atan2(height,pivot))
        let topPeak=min(angle,atan2(pivot,height))
        let left=min(CGFloat(0),pivot-pivot*cos(leftPeak)-height*sin(leftPeak))
        let bottom = -pivot*sin(angle)
        let beta=CGFloat(9)/(2*0.5),omega=sqrt(CGFloat(260)/0.5-beta*beta)
        let springPeak=1+(1-0.92)*exp(-beta*CGFloat.pi/omega)
        let top=max(height+6,max(height*springPeak,pivot*sin(topPeak)+height*cos(topPeak)))
        return CGRect(x:drawing.minX+left,y:drawing.minY+bottom,width:width-left,height:top-bottom).integral
    }
    func show(_ helpers:[D1Helper], sprite:CGRect, speech:CGRect?, parent:NSWindow, size:Size, artPoint:CGFloat,
              reduced:Bool, present:Bool, label:String, now:Double) {
        if helpers.isEmpty {stop();return}
        guard present else { hide(); return }
        reservations = reservations.filter { $0.value.until > now }
        let running=helpers.filter { $0.parent == nil && $0.state == "running" }.sorted { $0.at < $1.at }
        let displayed=running.count >= 5 ? Array(running.prefix(3))+[running[3]] : running
        let keep=Set(displayed.map(\.id)); let pixel=size.pixelArt; let right=speech.map {$0.midX < sprite.midX} ?? true
        for (id,item) in items where !keep.contains(id) {
            items.removeValue(forKey:id)
            item.view.setAccessibilityElement(false);item.view.setAccessibilityLabel("")
            let state=helpers.first {$0.id == id}?.state ?? "stopped"
            if pixel && !reduced { item.panel.orderOut(nil); item.panel.parent?.removeChildWindow(item.panel); continue }
            let failed=state == "failed" || state == "stopped"
            let layer=item.view.layer!
            let offset = right ? item.drawnFrame.minX-sprite.maxX:sprite.minX-item.drawnFrame.maxX
            reservations[id] = Reservation(offset:offset,width:item.drawnFrame.width,until:now+(reduced ? 300:failed ? 500:300))
            leaving.append(item.panel)
            if failed && !reduced {
                CATransaction.begin(); CATransaction.setDisableActions(true)
                let previousAnchor=layer.anchorPoint
                layer.anchorPoint=CGPoint(x:0.5,y:0); layer.position.x += (0.5-previousAnchor.x)*layer.bounds.width; layer.position.y -= previousAnchor.y*layer.bounds.height
                CATransaction.commit()
            }
            let fade=CABasicAnimation(keyPath:"opacity"); fade.fromValue=1; fade.toValue=0; fade.duration=reduced ? 0.26:failed ? 0.2:0.26; fade.beginTime=failed && !reduced ? 0.3:0; fade.fillMode = .backwards
            fade.timingFunction=failed ? CAMediaTimingFunction(name:.linear):CAMediaTimingFunction(controlPoints:0.4,0,1,1)
            var animations:[CAAnimation]=[fade]
            if !reduced {
                let move=CABasicAnimation(keyPath:failed ? "transform.rotation.z":"transform.translation.y"); move.fromValue=0; move.toValue=failed ? 70*Double.pi/180:6; move.duration=failed ? 0.3:0.26; move.timingFunction=CAMediaTimingFunction(controlPoints:0.4,0,1,1); animations.append(move)
            }
            let group=CAAnimationGroup(); group.animations=animations; group.duration=failed && !reduced ? 0.5:0.26
            CATransaction.begin(); CATransaction.setCompletionBlock { [weak self] in item.panel.orderOut(nil); item.panel.parent?.removeChildWindow(item.panel); self?.leaving.removeAll {$0 === item.panel} }
            layer.opacity=0; layer.add(group,forKey:"leave"); CATransaction.commit()
        }
        var offset:CGFloat=pixel ? 3*artPoint:6
        for (index,helper) in displayed.enumerated() {
            let bundle=running.count >= 5 && index == 3
            let w:CGFloat=pixel ? CGFloat(bundle ? 11:5)*artPoint : (bundle ? 17:10)*sprite.height/96
            let h:CGFloat=pixel ? CGFloat(bundle ? 10:9)*artPoint:20*sprite.height/96
            let gap:CGFloat=pixel ? 2*artPoint:4
            while let reserved = reservations.values.filter({offset < $0.offset+$0.width+gap && offset+w+gap > $0.offset}).min(by:{$0.offset < $1.offset}) {
                offset=reserved.offset+reserved.width+gap
            }
            let frame=CGRect(x:right ? sprite.maxX+offset:sprite.minX-offset-w,y:sprite.minY,width:w,height:h)
            offset += w+(pixel ? 2*artPoint:4)
            let fresh=items[helper.id] == nil
            let item:Item
            if let current=items[helper.id] {item=current}
            else {let view=D1ScrollView();item=Item(panel:Panel(clickable:false,shadow:false),view:view,host:D1ScrollHostView(view),state:helper.state)}
            item.view.pixel=pixel; item.view.bundle=bundle; item.view.appearance=parent.effectiveAppearance
            item.view.setAccessibilityElement(index == 0); item.view.setAccessibilityLabel(index == 0 ? label:""); item.view.needsDisplay=true; item.panel.contentView=item.host
            item.panel.level=parent.level; item.panel.collectionBehavior=parent.collectionBehavior
            if item.panel.parent !== parent { item.panel.parent?.removeChildWindow(item.panel); parent.addChildWindow(item.panel,ordered:.above) }
            item.panel.setFrame(Self.hostFrame(for:frame,pixel:pixel,reduced:reduced),display:true)
            item.view.frame=CGRect(x:frame.minX-item.panel.frame.minX,y:frame.minY-item.panel.frame.minY,width:frame.width,height:frame.height)
            item.panel.order(.above,relativeTo:parent.windowNumber); items[helper.id]=item
            if fresh {
                let delay=helper.arrivalAt.map {max(0,($0-now)/1000)} ?? Double(index)*0.26
                if pixel && !reduced {
                    if delay > 0 {
                        let cut=CAKeyframeAnimation(keyPath:"opacity");cut.values=[0.0,1.0];cut.keyTimes=[0,1]
                        cut.calculationMode = .discrete;cut.duration=delay;cut.beginTime=CACurrentMediaTime();cut.fillMode = .backwards
                        item.view.layer?.add(cut,forKey:"arrive-cut")
                    }
                } else {
                    let fade=CABasicAnimation(keyPath:"opacity"); fade.fromValue=0; fade.toValue=1; fade.duration=0.2
                    fade.beginTime=CACurrentMediaTime()+delay; fade.fillMode = .backwards;fade.timingFunction=CAMediaTimingFunction(controlPoints:0,0,0.2,1)
                    item.view.layer?.add(fade,forKey:"arrive-fade")
                    if !reduced {
                        let drop=CABasicAnimation(keyPath:"transform.translation.y"); drop.fromValue=6; drop.toValue=0; drop.duration=0.2; drop.beginTime=fade.beginTime; drop.fillMode = .backwards; drop.timingFunction=CAMediaTimingFunction(controlPoints:0,0,0.2,1); item.view.layer?.add(drop,forKey:"arrive")
                        let spring=CASpringAnimation(keyPath:"transform.scale.y"); spring.fromValue=0.92; spring.toValue=1; spring.mass=0.5; spring.stiffness=260; spring.damping=9; spring.duration=spring.settlingDuration; spring.beginTime=fade.beginTime+0.2; item.view.layer?.add(spring,forKey:"settle")
                    }
                }
            }
        }
        if let deadline=reservations.values.map(\.until).min() {
            let clock=CACurrentMediaTime()
            refresh = { [weak self, weak parent] in
                guard let self,let parent else {return}
                self.show(helpers,sprite:sprite,speech:speech,parent:parent,size:size,artPoint:artPoint,reduced:reduced,present:present,label:label,now:now+max(0,CACurrentMediaTime()-clock)*1000)
            }
            reflow.fire(after:(deadline-now)/1000)
        } else {reflow.cancel();refresh=nil}
    }
    func hide() { reflow.cancel();refresh=nil;items.values.forEach {$0.panel.orderOut(nil)}; leaving.forEach {$0.orderOut(nil)} }
    func stop() {
        hide()
        for panel in items.values.map(\.panel)+leaving { (panel.contentView as? D1ScrollHostView)?.scroll.layer?.removeAllAnimations();panel.contentView?.layer?.removeAllAnimations(); panel.parent?.removeChildWindow(panel) }
        items.removeAll(); leaving.removeAll();reservations.removeAll()
    }
}
final class D1ScrollView: NSView {
    var pixel=false, bundle=false
    override init(frame:NSRect) { super.init(frame:frame); wantsLayer=true; layer?.anchorPoint=CGPoint(x:0.5,y:0); setAccessibilityElement(true); setAccessibilityRole(.image) }
    convenience init() { self.init(frame:.zero) }
    @available(*,unavailable) required init?(coder:NSCoder) { fatalError("not used") }
    override var isFlipped:Bool { true }
    override func hitTest(_ point:NSPoint)->NSView? { nil }
    override func draw(_ dirtyRect:NSRect) {
        guard let c=NSGraphicsContext.current?.cgContext else {return}
        if pixel {
            let rows=bundle ? ["...00000...","0000ddd0000","0dd0PPP0dd0",".0P0PPP0P0.",".0P0PPP0P0.",".vvvvvvvvv.",".0P0PvP0P0.",".0P0PPP0P0.","0dd0ddd0dd0","00000000000"] : ["00000","0ddd0",".0P0.",".0P0.",".0v0.",".0P0.",".0P0.","0ddd0","00000"]
            let colors:[Character:Int]=["0":0x5C2A1E,"d":0x6B3A2C,"P":0xFBF3E6,"v":0xC75730]
            c.setShouldAntialias(false)
            for (y,row) in rows.enumerated() {for (x,char) in row.enumerated() {if let color=colors[char] {CardView.color(color).setFill(); CGRect(x:CGFloat(x)*bounds.width/CGFloat(row.count),y:CGFloat(y)*bounds.height/CGFloat(rows.count),width:bounds.width/CGFloat(row.count),height:bounds.height/CGFloat(rows.count)).fill()}}}; return
        }
        let dark=effectiveAppearance.bestMatch(from:[.aqua,.darkAqua]) == .darkAqua
        c.scaleBy(x:bounds.width/(bundle ? 15:9),y:bounds.height/18)
        func one(_ x:CGFloat,_ y:CGFloat,_ h:CGFloat,_ width:CGFloat) {
            CardView.paper.setFill(); let paper=NSBezierPath(rect:.init(x:x+0.8,y:y+1.4,width:width-1.6,height:h-2.8)); paper.fill(); CardView.color(dark ? 0xC9A99B:0x9E4123).setStroke(); paper.lineWidth=0.7; paper.stroke()
            CardView.color(dark ? 0xB98B6F:0x5C2A1E).setFill()
            for yy in [y,y+h-1.5] {NSBezierPath(roundedRect:.init(x:x,y:yy,width:width,height:1.5),xRadius:0.5,yRadius:0.5).fill()}
        }
        if bundle {
            one(0.2,2.4,15.2,6);one(8.8,2.4,15.2,6);one(4.5,0.6,17,6)
            CardView.vermilion.setStroke();let cord=NSBezierPath();cord.move(to:.init(x:0.6,y:9.2));cord.curve(to:.init(x:14.4,y:9.2),controlPoint1:.init(x:5.2,y:10.67),controlPoint2:.init(x:9.8,y:10.67));cord.lineWidth=1.3;cord.stroke()
            CardView.vermilion.setFill();NSBezierPath(ovalIn:.init(x:6.5,y:9.3,width:2,height:2)).fill()
        } else {
            CardView.paper.setFill();let paper=NSBezierPath(rect:.init(x:1.4,y:2.6,width:6.2,height:12.8));paper.fill();CardView.color(dark ? 0xC9A99B:0x9E4123).setStroke();paper.lineWidth=0.7;paper.stroke()
            CardView.color(0xE9D2C6).setStroke();let sheen=NSBezierPath();sheen.move(to:.init(x:2.4,y:2.9));sheen.line(to:.init(x:2.4,y:15.1));sheen.lineWidth=0.9;sheen.stroke()
            CardView.vermilion.setFill();NSRect(x:1.4,y:8.2,width:6.2,height:1.25).fill()
            CardView.vermilion.setStroke();let cord=NSBezierPath();cord.move(to:.init(x:4.5,y:9.45));cord.line(to:.init(x:3.5,y:11.35));cord.move(to:.init(x:4.5,y:9.45));cord.line(to:.init(x:5.6,y:11.25));cord.lineWidth=0.8;cord.lineCapStyle = .round;cord.stroke()
            CardView.color(dark ? 0xB98B6F:0x5C2A1E).setFill()
            for y in [1.2,15.1] {NSBezierPath(roundedRect:.init(x:0.6,y:y,width:7.8,height:1.7),xRadius:0.6,yRadius:0.6).fill()}
            CardView.color(dark ? 0xE1C3AC:0x3A1A12).setFill()
            for x in [0.0,7.9] {for y in [1.35,15.25] {NSBezierPath(roundedRect:.init(x:x,y:y,width:1.1,height:1.4),xRadius:0.5,yRadius:0.5).fill()}}
        }
    }
}

final class D1ScrollHostView:NSView {
    let scroll:D1ScrollView
    init(_ scroll:D1ScrollView) {
        self.scroll=scroll;super.init(frame:.zero);setAccessibilityElement(false);addSubview(scroll)
    }
    @available(*,unavailable) required init?(coder:NSCoder) {fatalError("not used")}
    override func hitTest(_ point:NSPoint)->NSView? {nil}
}

final class D1RibbonView:NSView {
    override init(frame:NSRect) {super.init(frame:frame);setAccessibilityElement(true);setAccessibilityRole(.image)}
    convenience init() {self.init(frame:.zero)}
    @available(*,unavailable) required init?(coder:NSCoder) {fatalError("not used")}
    var index=1 {didSet {needsDisplay=true}}
    override var isFlipped:Bool {true}
    override func hitTest(_ point:NSPoint)->NSView? {nil}
    override func draw(_ dirtyRect:NSRect) {D1Ribbon.draw(index,in:bounds,dark:effectiveAppearance.bestMatch(from:[.aqua,.darkAqua]) == .darkAqua)}
}

@MainActor
final class D1Silhouette {
    private var last:CGImage?
    private var horizontal:ClosedRange<CGFloat>?
    func frame(_ image:CGImage?,sprite:CGRect)->CGRect {
        guard let image else {return sprite}
        if last !== image {
            last=image;horizontal=nil
            let w=image.width,h=image.height
            var bytes=[UInt8](repeating:0,count:w*h*4)
            let result=bytes.withUnsafeMutableBytes { raw -> ClosedRange<CGFloat>? in
                guard let context=CGContext(data:raw.baseAddress,width:w,height:h,bitsPerComponent:8,bytesPerRow:w*4,space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue) else {return nil}
                context.draw(image,in:CGRect(x:0,y:0,width:w,height:h))
                var left=w,right = -1
                for y in 0..<h {for x in 0..<w where raw[y*w*4+x*4+3] > 0 {left=min(left,x);right=max(right,x)}}
                return right >= left ? (CGFloat(left)/CGFloat(w))...(CGFloat(right+1)/CGFloat(w)):nil
            }
            horizontal=result
        }
        guard let horizontal else {return sprite}
        return CGRect(x:sprite.minX+sprite.width*horizontal.lowerBound,y:sprite.minY,width:sprite.width*(horizontal.upperBound-horizontal.lowerBound),height:sprite.height)
    }
}
