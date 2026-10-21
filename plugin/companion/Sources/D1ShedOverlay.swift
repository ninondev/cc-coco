import AppKit
import QuartzCore
import ImageIO

@MainActor
final class D1ShedOverlay {
    struct PageSample { let x:Double, y:Double, angle:Double, opacity:Double }
    static func roomFactor(left:Double,naturalWidth:Double,limit:Double,bottomVisible:Bool)->Double? {
        guard bottomVisible,naturalWidth > 0 else {return nil}
        let fraction=min(1,(limit-left)/naturalWidth);return fraction >= 0.6 ? fraction:nil
    }
    static func pageSample(elapsed:Double,start:Double,duration:Double,drift:Double,fall:Double,amplitude:Double)->PageSample {
        let u=min(1,max(0,(elapsed-start)/duration)), age=elapsed-start
        let opacity=age < 0 ? 0:min(1,max(0,min(age/80,(1-u)/0.4)))
        return .init(x:drift*amplitude*(sin(1.4*Double.pi*u)+0.8*u),y:-fall*pow(u,1.6),angle:(drift < 0 ? -1:1)*(12+30*u)*Double.pi/180,opacity:opacity)
    }
    private let container=CALayer()
    private let skins=CALayer()
    private let pagePanel=Panel(clickable:false,shadow:false)
    private let pageView=NSView()
    private var manifest:[String:Any] = [:]
    private var cache:[String:CGImage] = [:]
    private var key=""
    private var current:D1Shed?
    private var frontTarget:Int?
    private var present=false
    private lazy var startPages=OneShot { [weak self] in self?.orderPages() }
    private lazy var end=OneShot { [weak self] in self?.clear();self?.finished() }
    var finished:()->Void = {}
    var mayShowPages:()->Bool = {true}
    var folder:URL?
    private(set) var frontPages=false
    init() {pageView.wantsLayer=true;pagePanel.contentView=pageView;container.masksToBounds=false}
    private func image(_ filename:String)->CGImage? {
        guard !filename.contains("/"),!filename.contains(".."),let folder else {return nil}
        if let image=cache[filename] {return image}
        let path=folder.appendingPathComponent(filename)
        guard path.resolvingSymlinksInPath().path.hasPrefix(folder.resolvingSymlinksInPath().path+"/"),
              let source=CGImageSourceCreateWithURL(path as CFURL,nil),
              let properties=CGImageSourceCopyPropertiesAtIndex(source,0,nil) as? [CFString:Any],
              let width=properties[kCGImagePropertyPixelWidth] as? Int,let height=properties[kCGImagePropertyPixelHeight] as? Int,
              width > 0,height > 0,width < 512,height < 128,
              let image=CGImageSourceCreateImageAtIndex(source,0,nil) else {return nil}
        cache[filename]=image;return image
    }
    func show(_ shed:D1Shed?, picture:CALayer,target:Place.Target,size:Size,scale:CGFloat,now:Double,reduced:Bool,present:Bool,parent:NSWindow) {
        self.present=present
        guard present,let shed,shed.phase == "end",now >= shed.at,now-shed.at < 1600,!size.pixelArt else {clear();return}
        let next="\(shed.id):\(shed.at):\(size):\(scale):\(reduced):\(target.mode)"
        if manifest.isEmpty,let folder,let data=DataFileWatch.read(folder.appendingPathComponent("shed.json"),limit:65536),let value=try? JSONSerialization.jsonObject(with:data) as? [String:Any] {manifest=value}
        let name="large",resolution=scale >= 1.5 ? "2x":"1x"
        guard let companion=manifest["companion"] as? [String:Any],let spec=companion[name] as? [String:Any],let art=spec[resolution] as? [String:Any],let pt=spec["pt"] as? [String:Any],let lying=art["lying"] as? [String:Any],let pages=art["pages"] as? [String:Any],let page=art["page"] as? [String:Any],let starts=art["page_starts"] as? [[Double]],starts.count == 3 else {clear();return}
        let assetScale:CGFloat=resolution == "2x" ? 2:1
        func n(_ object:[String:Any],_ name:String)->CGFloat {(object[name] as? NSNumber)?.doubleValue ?? 0}
        let ledge=target.mode == .ledge
        let left=n(lying,"dx")/assetScale,natural=n(lying,"width")/assetScale
        let limit=ledge ? min(target.visible.maxX,target.window.maxX-16):target.visible.maxX
        guard let room=Self.roomFactor(left:Double(target.frame.minX+left),naturalWidth:Double(natural),limit:Double(limit),bottomVisible:target.frame.minY >= target.visible.minY) else {clear();return}
        // Geometry changes translate the already running finite timelines; no new event is created.
        pagePanel.level=parent.level;pagePanel.collectionBehavior=parent.collectionBehavior
        pagePanel.setFrame(CGRect(x:target.frame.minX,y:target.frame.minY-50,width:max(target.frame.width+64,1),height:target.frame.height+50),display:false)
        let wantedTarget=ledge ? Int(target.number):parent.windowNumber
        let targetChanged=frontTarget != wantedTarget;frontTarget=wantedTarget
        if targetChanged,frontPages {orderPages()}
        let geometryKey=next+":"+String(room)
        if geometryKey == key {return}
        clear();key=geometryKey;current=shed;self.present=present
        CATransaction.begin();CATransaction.setDisableActions(true)
        picture.addSublayer(container);container.frame=picture.bounds
        container.addSublayer(skins);skins.frame=container.bounds
        let elapsed=max(0,(now-shed.at)/1000),clock=CACurrentMediaTime()-elapsed
        func opacity(_ layer:CALayer,_ values:[Double],_ times:[Double]) {
            layer.opacity=0;let animation=CAKeyframeAnimation(keyPath:"opacity");animation.values=values;animation.keyTimes=times.map {NSNumber(value:$0/1600)};animation.duration=1.6;animation.beginTime=clock;animation.fillMode = .both;animation.isRemovedOnCompletion=false;layer.add(animation,forKey:"opacity")
        }
        func skin(_ object:[String:Any],_ values:[Double],_ times:[Double])->CALayer? {
            guard let file=object["file"] as? String,let image=image(file) else {return nil}
            let layer=CALayer();layer.contents=image;layer.contentsScale=scale;layer.contentsGravity = .resize;layer.minificationFilter = .linear
            let x=n(object,"dx")/assetScale,y=n(object,ledge ? "dy_on_ledge":"dy_elsewhere")/assetScale
            let width=n(object,"width")/assetScale,height=n(object,"height")/assetScale
            layer.frame=CGRect(x:left+(x-left)*room,y:target.frame.height-y-height,width:width*room,height:height*room)
            skins.addSublayer(layer);opacity(layer,values,times);return layer
        }
        _=skin(lying,reduced ? [1,1,0,0]:[1,1,0,0],reduced ? [0,600,800,1600]:[0,460,520,1600])
        if !reduced {
            _=skin(pages,[0,0,1,0,0],[0,400,520,870,1600])
            let mask=CALayer();mask.backgroundColor=NSColor.black.cgColor;mask.anchorPoint = .zero
            let revealX=left+(131*target.frame.height/128-left)*room
            mask.frame=CGRect(x:0,y:0,width:left+natural*room,height:target.frame.height)
            let reveal=CABasicAnimation(keyPath:"bounds.size.width");reveal.fromValue=revealX;reveal.toValue=mask.bounds.width;reveal.duration=0.25;reveal.beginTime=clock;reveal.timingFunction=CAMediaTimingFunction(controlPoints:0,0,0.2,1);reveal.fillMode = .backwards;mask.add(reveal,forKey:"reveal");skins.mask=mask
            pageView.layer?.sublayers?.forEach {$0.removeFromSuperlayer()}
            if let file=page["file"] as? String,let image=image(file) {
                let sourceHeight=n(page,"height")/assetScale,sourceWidth=n(page,"width")/assetScale
                let fall=Double(n(pt,"page_fall")),amplitude=Double(n(pt,"page_drift_amplitude"))
                let startTimes=[520.0,620,740],durations=[900.0,960,860],drifts=[-1.0,0.6,1.4]
                for index in 0..<3 {
                    let layer=CALayer();layer.contents=image;layer.contentsGravity = .resize;layer.bounds=CGRect(x:0,y:0,width:sourceWidth*room,height:sourceHeight*room);layer.opacity=0
                    let dy=n(lying,"dy_elsewhere")-n(lying,"dy_on_ledge")
                    let base=CGPoint(x:left+(starts[index][0]/assetScale-left)*room,y:target.frame.height-(starts[index][1]+(ledge ? 0:Double(dy)))/assetScale+50)
                    layer.position=base;pageView.layer?.addSublayer(layer)
                    var positions:[NSValue]=[],angles:[Double]=[],opacities:[Double]=[],times:[NSNumber]=[]
                    let stamps=Set((0...64).map {Double($0)*25}+[startTimes[index],startTimes[index]+80,startTimes[index]+durations[index]*0.6,startTimes[index]+durations[index]]).sorted()
                    for ms in stamps {
                        let sample=Self.pageSample(elapsed:ms,start:startTimes[index],duration:durations[index],drift:drifts[index],fall:fall,amplitude:amplitude*room)
                        positions.append(NSValue(point:.init(x:base.x+sample.x,y:base.y+sample.y)));angles.append(-sample.angle);opacities.append(sample.opacity);times.append(NSNumber(value:ms/1600))
                    }
                    for (path,values) in [("position",positions as [Any]),("transform.rotation.z",angles as [Any]),("opacity",opacities as [Any])] {let animation=CAKeyframeAnimation(keyPath:path);animation.values=values;animation.keyTimes=times;animation.duration=1.6;animation.beginTime=clock;animation.fillMode = .both;animation.isRemovedOnCompletion=false;layer.add(animation,forKey:path)}
                }
            }
            // The transient front panel is optional; the fallback draws into the pet's own panel.
            frontTarget=ledge ? Int(target.number):parent.windowNumber
            if mayShowPages() {startPages.fire(after:max(0,0.52-elapsed))}
            else {fallbackPages()}

        }
        CATransaction.commit();end.fire(after:max(0,1.6-elapsed))
    }
    private func fallbackPages() {
        for layer in pageView.layer?.sublayers ?? [] {
            if let animation=layer.animation(forKey:"position")?.copy() as? CAKeyframeAnimation {
                animation.values=(animation.values as? [NSValue])?.map {value in var point=value.pointValue;point.y -= 50;return NSValue(point:point)}
                layer.add(animation,forKey:"position")
            }
            layer.removeFromSuperlayer();layer.position.y -= 50;container.addSublayer(layer)
        }
        frontPages=false
    }
    private func orderPages() {
        guard present,current != nil,let frontTarget else {return}
        pagePanel.order(.above,relativeTo:frontTarget)
        frontPages=pagePanel.isVisible
        if !frontPages {fallbackPages()}
    }
    func clear() {startPages.cancel();end.cancel();container.removeFromSuperlayer();container.sublayers?.forEach {$0.removeFromSuperlayer()};skins.sublayers?.forEach {$0.removeFromSuperlayer()};skins.mask=nil;pagePanel.orderOut(nil);pageView.layer?.sublayers?.forEach {$0.removeFromSuperlayer()};key="";current=nil;frontPages=false}
}
