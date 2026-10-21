import AppKit
import QuartzCore

/// One finite Core Animation timeline per pose entry; callbacks do not repaint at rest.
@MainActor
enum ToolPoseTimeline {
    private static var cachedKey = ""
    private static var cachedTimeline: CAKeyframeAnimation?
    static let frames = ["search-a","search-b","scroll-a","scroll-b","spyglass-a","spyglass-b","plan-a","plan-b","run-a","run-b","helper-a","helper-b","tea-a","tea-b","look-up","cheer-a","cheer-b","happy","happy-rise"]
    static func animation(_ pose: Record.Pose, frames: Frames, size: Size, scale: CGFloat, now: Double, current: CGImage? = nil) -> CAKeyframeAnimation? {
        let key="\(pose.name):\(pose.at):\(pose.celebration ?? 0):\(pose.longAt ?? 0):\(size):\(scale):\(frames.generation)"
        if key == cachedKey, let stored = cachedTimeline, let copy = stored.copy() as? CAKeyframeAnimation {
            copy.beginTime = CACurrentMediaTime()-max(0,(now-pose.at)/1000);return copy
        }
        let duration = pose.name == "cheer" ? ((pose.celebration ?? 0) >= 3 ? 5.5 : 3.3) : 180.0
        var times: [NSNumber] = [], pictures: [CGImage] = []
        func image(_ name:String) -> CGImage? { frames.image(name,size:size,scale:scale) }
        func add(_ at:Double,_ picture:CGImage?) { if let picture, at >= 0,at <= duration { times.append(NSNumber(value:at/duration));pictures.append(picture) } }
        func cut(_ at:Double,_ name:String) { add(at,image(name)) }
        func swap(_ at:Double,_ from:CGImage,_ to:CGImage,_ ms:Double,_ controls:[Double] = [0.45,0,0.55,1]) {
            add(at,from)
            func cubic(_ t:Double,_ a:Double,_ b:Double)->Double {3*(1-t)*(1-t)*t*a+3*(1-t)*t*t*b+t*t*t}
            for index in 1...4 {
                let x = Double(index)/4;var low=0.0,high=1.0
                for _ in 0..<20 {let mid=(low+high)/2;if cubic(mid,controls[0],controls[2])<x{low=mid}else{high=mid}}
                add(at+ms/1000*x,frames.toolBlend(from,to,fraction:cubic((low+high)/2,controls[1],controls[3])))
            }
        }
        if pose.name == "cheer" {
            let bigger = (pose.celebration ?? 0) >= 3
            if let current, let cheer=image("cheer-a") {add(0,current);swap(0.022,current,cheer,66)} else {cut(0,"cheer-a")}
            for index in 1...(bigger ? 5 : 3) { cut(Double(index)*0.48+0.025,index%2 == 1 ? "cheer-b":"cheer-a") }
            if bigger {cut(2.9,"happy-rise");cut(3.02,"happy")} else {cut(1.9,"happy")}
            cut(duration,"happy")
        } else {
            let baseName = ["search":"search-a","scroll":"scroll-a","spyglass":"spyglass-a","plan":"plan-a","run":"run-a","helper":"helper-a","tea":"tea-a","work":"work-a"][pose.name] ?? pose.frame
            guard let base=image(baseName) else {return nil}
            var cursor=0.0
            if let current, pose.name != "work" {add(0,current);swap(0.022,current,base,66)} else {add(0,base)}
            var activeName=baseName
            if pose.name == "run" || pose.name == "helper" {
                cursor=pose.name == "run" ? 0.42:0.9
                activeName=pose.name == "run" ? "run-b":"helper-b"
                if let old=image(baseName),let next=image(activeName) {swap(cursor+0.022,old,next,66)} else {cut(cursor,activeName)}
                if let longAt=pose.longAt { cursor=max(cursor,(longAt-pose.at)/1000);activeName="tea-a";cut(cursor,activeName) }
                else {add(duration,image(activeName));cursor=duration}
            }
            if cursor < duration,let open=image(activeName),let closed=frames.toolMotion(activeName,size:size,scale:scale) {
                let kind=activeName == "tea-a" ? "tea":pose.name
                let interval:MotionModel.Hold,hold:MotionModel.Hold
                switch kind {
                case "search":interval = .init(median:1300,sigma:0.28,min:900,max:2200);hold = .init(median:380,sigma:0.25,min:260,max:560)
                case "plan":interval = .init(median:1700,sigma:0.25,min:1200,max:2600);hold = .init(median:420,sigma:0.22,min:300,max:600)
                case "scroll":interval = .init(median:2400,sigma:0.35,min:1400,max:4500);hold = .init(median:1100,sigma:0.3,min:700,max:1800)
                case "spyglass":interval = .init(median:2200,sigma:0.3,min:1600,max:3200);hold = .init(median:1100,sigma:0.3,min:800,max:1800)
                default:interval = .init(median:3500,sigma:0.3,min:2200,max:6000);hold = .init(median:1200,sigma:0.25,min:800,max:1800)
                }
                while cursor < duration {
                    cursor += interval.sample {Double.random(in:0.000001...0.999999)}/1000
                    let count = kind == "search" ? Int.random(in:2...4):kind == "plan" ? Int.random(in:2...3):1
                    for _ in 0..<count where cursor < duration {
                        swap(cursor,open,closed,kind == "tea" ? 160:60,kind == "tea" ? [0.37,0,0.63,1]:[0.45,0,0.55,1])
                        cursor += hold.sample {Double.random(in:0.000001...0.999999)}/1000
                        swap(cursor,closed,open,kind == "tea" ? 200:60,kind == "tea" ? [0.37,0,0.63,1]:[0.45,0,0.55,1])
                        cursor += kind == "tea" ? 0.2:0.06
                    }
                }
            }
            add(duration,image(activeName))
        }
        guard !pictures.isEmpty else {return nil}
        let animation=CAKeyframeAnimation(keyPath:"contents");animation.values=pictures;animation.keyTimes=times;animation.calculationMode = .discrete
        animation.duration=duration;animation.beginTime=CACurrentMediaTime()-max(0,(now-pose.at)/1000)
        animation.fillMode = .forwards;animation.isRemovedOnCompletion=false
        cachedKey = key;cachedTimeline = animation.copy() as? CAKeyframeAnimation
        return animation
    }
    /// Keep patch cycles alive after the finite entry, without re-playing that entry.
    static func repeatingTail(_ source: CAKeyframeAnimation, pose: Record.Pose, now: Double) -> CAKeyframeAnimation? {
        guard pose.name != "cheer", pose.name != "work" else {return nil}
        let handover = pose.name == "run" || pose.name == "helper"
        if handover && pose.longAt == nil {return nil}
        let start = handover ? max(0.088, ((pose.longAt ?? pose.at)-pose.at)/1000) : 0.088
        guard start < source.duration,
              let times = source.keyTimes, let values = source.values, !values.isEmpty,
              times.count == values.count else {return nil}
        var initial=values[0],tailTimes:[NSNumber]=[0],tailValues:[Any]=[]
        for (index,time) in times.enumerated() where time.doubleValue*source.duration <= start {initial=values[index]}
        tailValues.append(initial)
        let period=source.duration-start
        for (index,time) in times.enumerated() {
            let at=time.doubleValue*source.duration
            if at > start {tailTimes.append(NSNumber(value:(at-start)/period));tailValues.append(values[index])}
        }
        guard tailValues.count > 1 else {return nil}
        let tail=CAKeyframeAnimation(keyPath:"contents");tail.values=tailValues;tail.keyTimes=tailTimes
        tail.calculationMode = .discrete;tail.duration=period;tail.repeatCount = .infinity
        tail.beginTime=CACurrentMediaTime()-max(0,(now-pose.at)/1000)+start
        tail.fillMode = .forwards;tail.isRemovedOnCompletion=false
        return tail
    }
    static func burst(on picture: CALayer, pose: Record.Pose, now: Double) {
        picture.sublayers?.filter {$0.name == "c3-burst"}.forEach {$0.removeFromSuperlayer()}
        guard (pose.celebration ?? 0) >= 3 else { return }
        let factor = picture.bounds.height / 128
        let angles = [-172.0,-150,-128,-106,-90,-74,-52,-30,-8]
        let offsets = [0.0,50,100,20,140,70,120,30,90]
        for (index,angle) in angles.enumerated() {
            let elapsed = now-pose.at, delay=60+offsets[index]
            if elapsed > delay+760 {continue}
            let layer=CAShapeLayer();layer.name="c3-burst"
            let path=CGMutablePath();let arm=4.2*factor
            for a in [0.0,Double.pi/4,Double.pi/2,Double.pi*3/4] {let x=cos(a)*arm,y=sin(a)*arm;path.move(to:CGPoint(x:-x,y:-y));path.addLine(to:CGPoint(x:x,y:y))}
            layer.path=path;layer.strokeColor=CardView.color([0xEE570F,0xF59A4C,0xFFC65C][index%3]).cgColor;layer.fillColor=nil;layer.lineWidth=1.3*factor;layer.lineCap = .round;layer.opacity=0
            let a=angle*Double.pi/180,travel=22+12*Double((index*37)%7)/6
            let centre=CGPoint(x:picture.bounds.midX,y:(128-46)*factor)
            let start=CGPoint(x:centre.x+cos(a)*8*factor,y:centre.y-sin(a)*8*factor)
            let end=CGPoint(x:centre.x+cos(a)*(8+travel)*factor,y:centre.y-sin(a)*(8+travel)*factor)
            let move=CABasicAnimation(keyPath:"position");move.fromValue=NSValue(point:start);move.toValue=NSValue(point:end);move.duration=0.76;move.timingFunction=CAMediaTimingFunction(controlPoints:0,0,0.2,1)
            let scale=CAKeyframeAnimation(keyPath:"transform.scale");scale.values=[0.6,1,0.4];scale.keyTimes=[0,0.35,1];scale.duration=0.76
            let fade=CAKeyframeAnimation(keyPath:"opacity");fade.values=[1,1,0];fade.keyTimes=[0,0.6,1];fade.duration=0.76
            let group=CAAnimationGroup();group.animations=[move,scale,fade];group.duration=0.76;group.beginTime=CACurrentMediaTime()+(delay-elapsed)/1000
            picture.addSublayer(layer);layer.add(group,forKey:"burst")
        }
    }
    static func celebration(_ pose:Record.Pose,now:Double)->CAAnimationGroup {
        let bigger=(pose.celebration ?? 0)>=3
        var tracks:[CAAnimation]=[]
        for index in 0...(bigger ? 5:3) {
            let at=Double(index)*0.48,press=index == 0 ? (bigger ? 0.94:0.95):0.965,hold=index == 0 ? 0.06:0.05
            let down=CABasicAnimation(keyPath:"transform.scale.y");down.fromValue=1;down.toValue=press;down.duration=hold;down.beginTime=at
            down.timingFunction=CAMediaTimingFunction(controlPoints:0,0,0.2,1)
            let spring=CASpringAnimation(keyPath:"transform.scale.y");spring.fromValue=press;spring.toValue=1;spring.mass=0.5;spring.stiffness=260;spring.damping=9;spring.beginTime=at+hold;spring.duration=min(0.42,spring.settlingDuration)
            tracks.append(down);tracks.append(spring)
        }
        let group=CAAnimationGroup();group.animations=tracks;group.duration=bigger ? 5.5:3.3;group.beginTime=CACurrentMediaTime()-max(0,(now-pose.at)/1000);return group
    }
}
