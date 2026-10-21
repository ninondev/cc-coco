#!/usr/bin/env python3
"""Pure C3 lantern layout/timing checks; no application launch or owner records."""
import os
from pathlib import Path
import subprocess
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from scratch import TemporaryDirectory
ROOT=Path(__file__).resolve().parents[2]
source=(ROOT/'plugin/companion/Sources/Lanterns.swift').read_text()
# Compile the actual pure layout and production timing constants, without initializing AppKit.
layout=source[source.index('enum LanternPlacement'):source.index('final class LanternView')]
constants=source[source.index('    nonisolated static let arriveSeconds'):source.index('    func update')].replace('nonisolated ','')
main='''import Foundation
import CoreGraphics
'''+layout+'enum Timing {\n'+constants+'}\n'+'''
var failures=0,checks=0
func check(_ value:Bool,_ label:String){checks += 1;if !value{failures += 1;print("FAIL",label)}}
let pixelSprite=CGRect(x:100,y:100,width:35,height:32)
for pixelSpeech in [CGRect(x:0,y:110,width:60,height:12),CGRect(x:200,y:110,width:60,height:12)] {
 let frames=LanternPlacement.frames(sprite:pixelSprite,speech:pixelSpeech,count:4,pixel:true,artPoint:1)
 check(frames.count==1 && frames[0].width==7 && frames[0].height==10,"one whole-pixel lantern")
 check(!frames[0].intersects(pixelSprite),"pixel lantern keeps off the silhouette")
}
for h in [48.0,64.0,96.0,128.0] {
 let sprite=CGRect(x:100,y:100,width:h,height:h)
 let leftSpeech=CGRect(x:0,y:150,width:90,height:20)
 let rightSpeech=CGRect(x:250,y:150,width:90,height:20)
 let right=LanternPlacement.frames(sprite:sprite,speech:leftSpeech,count:5)
 let left=LanternPlacement.frames(sprite:sprite,speech:rightSpeech,count:3)
 check(right.count==1 && left.count==1,"one lantern, however many are asked for")
 check(LanternPlacement.frames(sprite:sprite,speech:leftSpeech,count:0).isEmpty,"none when nobody is busy")
 check(right[0].minX==sprite.maxX+6,"six points outside silhouette")
 check(left[0].maxX==sprite.minX-6,"away from right-hand speech")
 check(right[0].width==(h*0.19).rounded() && right[0].height==(h*0.27).rounded(),"approved size")
 check(right[0].maxY==sprite.maxY-h*0.32,"eye level")
 check(right.allSatisfy{!$0.intersects(sprite)} && left.allSatisfy{!$0.intersects(sprite)},"face keep-out")
}
check(Timing.arriveSeconds==0.240 && Timing.extinguishSeconds==0.400 && Timing.leaveSeconds==0.300,"approved transition times")
print("lanterns: \\(checks) checks, \\(failures) failures")
exit(failures==0 ? 0:1)
'''
with TemporaryDirectory(prefix='coco-lanterns-',dir=os.environ['TMPDIR']) as scratch:
 scratch=Path(scratch);(scratch/'main.swift').write_text(main)
 env=dict(os.environ,HOME=str(scratch),CLAUDE_CONFIG_DIR=str(scratch/'config'))
 result=subprocess.run(['swiftc','-module-cache-path',str(scratch/'cache'),str(scratch/'main.swift'),'-o',str(scratch/'check')],env=env,capture_output=True,text=True)
 if result.returncode: print(result.stderr);sys.exit(result.returncode)
 result=subprocess.run([str(scratch/'check')],env=env,capture_output=True,text=True);print(result.stdout,end='');print(result.stderr,end='');sys.exit(result.returncode)
