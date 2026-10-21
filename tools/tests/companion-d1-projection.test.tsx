import {test,expect} from 'claude-code/testing'
import {companionRecord,companionSession} from '../hooks/companion'
import {initialView} from '../hooks/mood'
import {normalizeDesktopView} from '../hooks/desktop-safe'
import {loadD1Words,d1Word} from '../hooks/d1-words'
import {COMPANION_D1_WORDS_TEXT} from './companion-d1-words-fixture'
import type {CocoView as View} from '../types'

test('D1 companion suppresses the band-only second-window line and retains underlying spoken text',async()=>{
 await loadD1Words(async()=>COMPANION_D1_WORDS_TEXT);companionSession('/fixture/projection')
 const view=initialView();const before=companionRecord(view)
 view.line={id:'two',key:'two.first',text:d1Word(view.lang,'two.first'),class:0,expiresAt:14000}
 const during=companionRecord(view)
 expect(during.said===before.said).toBe(true)
 expect(during.said).toBe(before.said);expect(during.frame).toBe(before.frame);expect(during.pose).toEqual(before.pose)
})
test('D1 pure companion projection preserves helper pose clocks through a band-only glance without a native restart',()=>{
 const view=initialView();const pose={name:'helper',frame:'helper-a',aside:view.cue,at:13,longAt:12013}
 view.pose=pose;const before=companionRecord(view)
 const projected=view as View & {companionPose?:View['pose']|null;companionLine?:View['line']|null}
 projected.companionPose=pose;view.pose={name:'ribbon-glance',frame:pose.frame,aside:pose.aside,at:100}
 const during=companionRecord(view);expect(JSON.stringify(during.pose)===JSON.stringify(before.pose)).toBe(true);expect(during.pose).toEqual(before.pose)
 const follower=normalizeDesktopView(view,initialView(),['idle-reading'])
 expect(follower.pose).toEqual(view.pose);expect(Object.prototype.hasOwnProperty.call(follower,'companionPose')).toBe(false);expect(Object.prototype.hasOwnProperty.call(follower,'companionLine')).toBe(false)
 expect(during.pose?.at).toBe(13);expect(during.pose?.longAt).toBe(12013)
 view.pose=pose;delete projected.companionPose
 const restored=companionRecord(view);expect(restored.pose).toEqual(during.pose)
 expect(restored.pose?.name!==during.pose?.name || restored.pose?.at!==during.pose?.at).toBe(false)
 console.log('D1_COMPANION_PROJECTION_CODEC '+JSON.stringify({before,during,restored}))
})
test('D1 companion projects the prior non-second-window line and permits genuine replacement',async()=>{
 await loadD1Words(async()=>COMPANION_D1_WORDS_TEXT)
 const view=initialView(),prior={id:'prior',key:'ambient',text:d1Word(view.lang,'long.done',{time:'13:00',duration:'2m'}),class:0 as const,expiresAt:1000}
 const projected=view as View & {companionLine?:View['line']|null};view.line=prior;const before=companionRecord(view)
 projected.companionLine=prior;view.line={id:'two',key:'two.first',text:d1Word(view.lang,'two.first'),class:0,expiresAt:14000}
 expect(companionRecord(view).said===before.said).toBe(true)
 expect(companionRecord(view).said).toBe(before.said)
 const follower=normalizeDesktopView(view,initialView(),['idle-reading'])
 expect(follower.line).toEqual(view.line);expect(Object.prototype.hasOwnProperty.call(follower,'companionPose')).toBe(false);expect(Object.prototype.hasOwnProperty.call(follower,'companionLine')).toBe(false)
 const genuine={...prior,id:'genuine',key:'shed.first',text:d1Word(view.lang,'shed.first'),class:1 as const};view.line=genuine
 expect(companionRecord(view).said).toBe(genuine.text)
 projected.companionLine=null;view.line={id:'two-again',key:'two.first',text:d1Word(view.lang,'two.first'),class:0,expiresAt:14000}
 expect(companionRecord(view).said).toBe(view.slip?.text??view.said)
})
