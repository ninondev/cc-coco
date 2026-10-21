import AppKit
import QuartzCore

/// One lantern beside him, on the side away from his speech label. Event transitions alone animate; rest is still.
enum LanternPlacement {
    static func frames(sprite: CGRect, speech: CGRect?, count: Int, pixel: Bool = false, artPoint: CGFloat = 1) -> [CGRect] {
        guard count > 0 else { return [] }
        let right = speech.map { $0.midX < sprite.midX } ?? true
        if pixel {
            return [CGRect(x: right ? sprite.maxX + 3 * artPoint : sprite.minX - 10 * artPoint,
                           y: sprite.maxY - 25 * artPoint, width: 7 * artPoint, height: 10 * artPoint)]
        }
        let h = sprite.height, width = max(1, (h * 0.19).rounded()), height = max(1, (h * 0.27).rounded())
        return [CGRect(x: right ? sprite.maxX + 6 : sprite.minX - 6 - width,
                       y: sprite.maxY - 0.32 * h - height, width: width, height: height)]
    }
}

final class LanternView: NSView {
    let lit = NSImageView(), unlit = NSImageView()
    var pixel=false {didSet {refreshPictures()}}
    private func refreshPictures() {
        let dark=effectiveAppearance.bestMatch(from:[.darkAqua,.aqua]) == .darkAqua
        lit.image=pixel ? Self.pixelPicture(lit:true):Self.picture(lit:true,dark:dark)
        unlit.image=pixel ? Self.pixelPicture(lit:false):Self.picture(lit:false,dark:dark)
    }
    static func pixelPicture(lit:Bool)->NSImage {
        let rows=lit ? ["...m...","..000..",".SoooS.","SoowooS","SowwwoS","SowwwoS","SowwwoS","SoowooS",".SoooS.","..000.."]:["...m...","..000..",".m...m.","m.....m","m.....m","m.....m","m.....m","m.....m",".m...m.","..000.."]
        let colors:[Character:Int]=["m":0x9A6450,"0":0x5C2A1E,"S":0xA84A35,"o":0xF7A13B,"w":0xFCF8F6]
        return NSImage(size:.init(width:7,height:10),flipped:true) {_ in
            NSGraphicsContext.current?.cgContext.setShouldAntialias(false)
            NSGraphicsContext.current?.imageInterpolation = .none
            for (y,row) in rows.enumerated() {for (x,char) in row.enumerated() {if let color=colors[char] {CardView.color(color).setFill();NSRect(x:CGFloat(x),y:CGFloat(y),width:1,height:1).fill()}}};return true
        }
    }
    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        for (view, glowing) in [(unlit, false), (lit, true)] {
            view.image = Self.picture(lit: glowing)
            view.imageScaling = .scaleAxesIndependently
            addSubview(view)
        }
        setAccessibilityElement(true); setAccessibilityRole(.image)
    }
    @available(*, unavailable) required init?(coder: NSCoder) { fatalError("not used") }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
    override func layout() { super.layout(); lit.frame = bounds; unlit.frame = bounds }
    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        refreshPictures()
    }
    static func picture(lit: Bool, dark: Bool = false) -> NSImage {
        NSImage(size: NSSize(width: 10, height: 14), flipped: true) { _ in
            let string = NSBezierPath(); string.move(to: .init(x:5,y:0)); string.line(to:.init(x:5,y:2.2))
            CardView.color(0x8A7B70).setStroke(); string.lineWidth = 0.8; string.stroke()
            let body = NSBezierPath(ovalIn: .init(x:1,y:3.2,width:8,height:8.8))
            if lit { CardView.color(0xF3A64C).setFill(); body.fill() }
            CardView.color(lit ? 0xC46A1E : dark ? 0x9C948B : 0x8A7B70).setStroke(); body.lineWidth = lit ? 0.7 : 0.9; body.stroke()
            if lit {
                CardView.color(0xFFD98A).setFill(); NSBezierPath(ovalIn:.init(x:2.7,y:4.5,width:4.6,height:6.2)).fill()
                let ribs = NSBezierPath(); ribs.move(to:.init(x:1.4,y:6.2)); ribs.line(to:.init(x:8.6,y:6.2)); ribs.move(to:.init(x:1.2,y:8.9)); ribs.line(to:.init(x:8.8,y:8.9))
                CardView.color(0xD9853A).setStroke(); ribs.lineWidth = 0.6; ribs.stroke()
            }
            CardView.color(dark ? 0xB98B6F : 0x5B3A2A).setFill()
            for y in [2.3,11.6] { NSBezierPath(roundedRect:.init(x:2.6,y:y,width:4.8,height:1.4),xRadius:0.5,yRadius:0.5).fill() }
            return true
        }
    }
}

/// Lazy non-key panels, mouse transparent, with no repeating work or idle clock.
@MainActor
final class Lanterns {
    private struct Item { let panel: Panel; let view: LanternView }
    private var items: [String: Item] = [:]
    private var agents: [NeighbourLight] = []
    private var pixel=false
    nonisolated static let arriveSeconds = 0.240, extinguishSeconds = 0.400, leaveSeconds = 0.300
    func update(_ snapshot: NeighbourSnapshot, enabled: Bool) {
        if !enabled { stop(); return }
        agents = enabled ? Array(snapshot.agents.filter { $0.busy && !$0.partial }.sorted { ($0.startedAt ?? 0) > ($1.startedAt ?? 0) }.prefix(1)) : []
        let keep = Set(agents.map(\.id))
        for (id,item) in items where !keep.contains(id) {
            items.removeValue(forKey:id)
            if pixel {
                let cut=CAKeyframeAnimation(keyPath:"opacity");cut.values=[1,0,0];cut.keyTimes=[0,NSNumber(value:0.2/0.55),1];cut.duration=0.55;cut.calculationMode = .discrete
                item.view.lit.wantsLayer=true;item.view.unlit.wantsLayer=true
                CATransaction.begin();CATransaction.setCompletionBlock {item.panel.orderOut(nil);item.panel.parent?.removeChildWindow(item.panel)}
                item.view.lit.layer?.opacity=0;item.view.lit.layer?.add(cut,forKey:"pixel-done");CATransaction.commit();continue
            }
            NSAnimationContext.runAnimationGroup { context in
                context.duration = Self.extinguishSeconds
                item.view.lit.animator().alphaValue = 0
            } completionHandler: {
                NSAnimationContext.runAnimationGroup { context in
                    context.duration = Self.leaveSeconds; item.panel.animator().alphaValue = 0
                } completionHandler: { item.panel.orderOut(nil); item.panel.parent?.removeChildWindow(item.panel) }
            }
        }
    }
    func place(sprite: CGRect, speech: CGRect?, parent: NSWindow, reduceMotion: Bool, present: Bool, pixel: Bool = false, artPoint: CGFloat = 1, busyWord: (String)->String) {
        guard present else { hide(); return }
        self.pixel=pixel
        let frames = LanternPlacement.frames(sprite:sprite,speech:speech,count:agents.count,pixel:pixel,artPoint:artPoint)
        for (agent, frame) in zip(agents,frames) {
            let fresh = items[agent.id] == nil
            let item: Item
            if let held = items[agent.id] { item = held }
            else { let view = LanternView(frame:.zero), panel = Panel(clickable:false,shadow:false); panel.contentView = view; item = Item(panel:panel,view:view); items[agent.id] = item }
            item.view.pixel=pixel
            item.view.appearance = parent.effectiveAppearance
            item.view.setAccessibilityLabel(busyWord(agent.label))
            item.panel.level = parent.level; item.panel.collectionBehavior = parent.collectionBehavior
            if item.panel.parent !== parent { item.panel.parent?.removeChildWindow(item.panel); parent.addChildWindow(item.panel,ordered:.above) }
            if fresh && pixel {
                item.panel.alphaValue=1;item.panel.setFrame(frame,display:true);item.panel.order(.above,relativeTo:parent.windowNumber)
            } else if fresh {
                item.panel.alphaValue = 0
                var initial = frame; if !reduceMotion { initial.origin.y -= 4 }
                item.panel.setFrame(initial,display:true); item.panel.order(.above,relativeTo:parent.windowNumber)
                NSAnimationContext.runAnimationGroup { context in
                    context.duration = Self.arriveSeconds; context.timingFunction = CAMediaTimingFunction(controlPoints:0,0,0.2,1)
                    item.panel.animator().alphaValue = 1; item.panel.animator().setFrame(frame,display:true)
                }
            } else { item.panel.setFrame(frame,display:true); if !item.panel.isVisible { item.panel.order(.above,relativeTo:parent.windowNumber) } }
        }
    }
    func hide() { for item in items.values { item.panel.orderOut(nil) } }
    func stop() { agents = []; for item in items.values { item.panel.orderOut(nil); item.panel.parent?.removeChildWindow(item.panel) }; items.removeAll() }
}
