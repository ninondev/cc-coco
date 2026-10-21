// SPEC 6: the latest requested pose waits for one minimum hold. Activity owns
// the deadlines; this controller neither polls nor retains engine objects.
export type ToolPose = 'think' | 'work' | 'lookup' | 'search' | 'scroll' | 'spyglass' | 'plan' | 'run' | 'helper' | 'tea' | 'cheer'
const PRIORITY: ToolPose[] = ['helper','run','spyglass','search','scroll','plan','work']
export const POSE_HOLD = 1200
export function poseForTool(tool: string): ToolPose {
  if (['Grep','Glob','LS','ToolSearch'].includes(tool)) return 'search'
  if (['Read','NotebookRead'].includes(tool)) return 'scroll'
  if (['WebFetch','WebSearch'].includes(tool)) return 'spyglass'
  if (['Task','Agent'].includes(tool)) return 'helper'
  if (['BashOutput','Monitor'].includes(tool)) return 'tea'
  if (['Bash','PowerShell','KillShell','Shell','Terminal'].includes(tool)) return 'run'
  if (['TodoWrite','EnterPlanMode','ExitPlanMode'].includes(tool) || /^Task(?:Create|Update|Get|List|Stop|Output)$/.test(tool)) return 'plan'
  return 'work'
}
export class ToolPoses {
  pose: ToolPose = 'think'
  since = 0
  private pending?: ToolPose
  private calls = new Map<string,{pose:ToolPose;at:number}>()
  private batchAt = -Infinity
  private batch: ToolPose[] = []
  private quietAt?: number
  reset(now: number): void { this.pose='think';this.since=now;this.pending=undefined;this.calls.clear();this.quietAt=undefined;this.batchAt=-Infinity;this.batch=[] }
  request(pose: ToolPose, now: number, immediate = false): boolean {
    this.tick(now)
    if (pose===this.pose) { this.pending=undefined;return false }
    if (immediate || now>=this.since+POSE_HOLD) { this.pose=pose;this.since=now;this.pending=undefined;return true }
    this.pending=pose;return false
  }
  start(id: string, tool: string, now: number): boolean {
    const pose=poseForTool(tool)
    this.calls.set(id,{pose,at:now});this.quietAt=undefined
    const sameBatch=now-this.batchAt<=150
    if(!sameBatch){this.batchAt=now;this.batch=[]}
    this.batch.push(pose)
    const ranked=[...this.batch].sort((a,b)=>{const ai=PRIORITY.indexOf(a),bi=PRIORITY.indexOf(b);return (ai<0?99:ai)-(bi<0?99:bi)})[0]!
    return this.request(ranked,now,sameBatch&&ranked!==this.pose&&this.since>=this.batchAt)
  }
  end(id: string, now: number): boolean {
    this.calls.delete(id)
    if(!this.calls.size)this.quietAt=now+2500
    return this.tick(now)
  }
  // Claude is writing its reply and no call is in flight: he looks up (owner 10-09). Tool calls keep their own poses.
  text(now: number): boolean { if(this.calls.size)return this.tick(now);this.quietAt=now+2500;return this.request('lookup',now) }
  tick(now: number): boolean {
    let changed=false
    if(this.pending&&now>=this.since+POSE_HOLD){const take=this.since+POSE_HOLD;this.pose=this.pending;this.since=take;this.pending=undefined;changed=true}
    if([...this.calls.values()].some(call=>now>=call.at+12000)&&this.pose!=='tea'){this.pose='tea';this.since=now;this.pending=undefined;changed=true}
    if(!this.calls.size&&this.quietAt!==undefined&&now>=this.quietAt&&now>=this.since+POSE_HOLD){this.pose='think';this.since=now;this.pending=undefined;this.quietAt=undefined;changed=true}
    return changed
  }
  deadline(includeLong = true): number | undefined {
    const values=[this.pending?this.since+POSE_HOLD:Infinity,this.quietAt??Infinity,...(!includeLong||this.pose==='tea'?[]:[...this.calls.values()].map(call=>call.at+12000))]
    const at=Math.min(...values)
    return Number.isFinite(at)?at:undefined
  }
  longAt(): number | undefined { const at=Math.min(...[...this.calls.values()].map(call=>call.at+12000));return Number.isFinite(at)?at:undefined }
  interrupt(): void { this.pending=undefined;this.quietAt=undefined }
}
