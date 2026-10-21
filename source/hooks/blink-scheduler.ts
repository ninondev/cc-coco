// The scheduler handles full visible blink episodes. Obstacles retain their own
// identities: a chain of short obstacles never acquires a combined exception.
export type BlinkObstacle = { name: string; start: number; end: number }
export type ExistingClosure = { name: string; start: number; end: number; face: 'blink' | 'happy-arcs' | 'squeeze' }
export type BlinkException = { obstacle: BlinkObstacle; from: number; to: number; excess: number; allowance: number }
export type BlinkPlacement = { at: number; kind: 'blink' | 'existing'; closure?: ExistingClosure; exception?: BlinkException }
export type BlinkRequest = {
  candidate: number; previous: number; min: number; max: number; span: number;
  obstacles: readonly BlinkObstacle[]; closures?: readonly ExistingClosure[];
  // A periodic seam can impose an earlier deadline than the ordinary gap cap.
  latest?: number;
  // Bound for the renderer's separate time quantizations, not an audit tolerance.
  precisionGuard?: number;
}
export const BLINK_CLEARANCE_MS = 300
const EPSILON = 1e-7

export function placeBlink(request: BlinkRequest): BlinkPlacement | undefined {
  const { previous, min, max, span, obstacles } = request
  const guard = request.precisionGuard ?? 0
  const clearance = BLINK_CLEARANCE_MS + guard
  const earliest = previous + min + guard, deadline = Math.min(previous + max - guard, request.latest ?? Infinity)
  if (earliest > deadline + EPSILON) return undefined
  const collision = (at: number, obstacle: BlinkObstacle) => at + span > obstacle.start - clearance + EPSILON && at < obstacle.end + clearance - EPSILON
  const forward = (from: number) => {
    let at = from
    // Every collision advances past at least one obstacle, independent of order.
    for (let i = 0; i <= obstacles.length; i++) {
      const hit = obstacles.find(obstacle => collision(at, obstacle))
      if (!hit) return at
      at = hit.end + clearance
    }
    return Infinity
  }
  const backward = (from: number) => {
    let at = from
    for (let i = 0; i <= obstacles.length; i++) {
      const hit = obstacles.find(obstacle => collision(at, obstacle))
      if (!hit) return at
      at = hit.start - clearance - span
    }
    return -Infinity
  }
  const candidate = Math.max(earliest, Math.min(request.candidate, deadline))
  const after = forward(candidate)
  if (after <= deadline + EPSILON) return { at: after, kind: 'blink' }
  // Search backward through every blocking interval, not only the first hit.
  const before = backward(deadline)
  if (before >= earliest - EPSILON) return { at: before, kind: 'blink' }
  // Count only an explicitly supplied, already-rendered closed-eyed frame.
  // Half lids and newly invented closure events cannot satisfy this branch.
  const closure = request.closures?.filter(c => ['blink','happy-arcs','squeeze'].includes(c.face) && c.end > c.start && c.start >= earliest - EPSILON && c.start <= deadline + EPSILON &&
    obstacles.some(o => c.start >= o.start && c.start < o.end)).sort((a,b)=>a.start-b.start)[0]
  if (closure) return { at: closure.start, kind: 'existing', closure }
  // An exception must be bounded by ONE actual obstacle's own duration.
  // Never grant the length of a union of unrelated cuts or the whole mood.
  const obstacle = obstacles.find(o => o.end > o.start && collision(deadline, o) &&
    after - previous - max <= o.end - o.start + EPSILON && after <= (request.latest ?? Infinity) + EPSILON)
  if (obstacle && Number.isFinite(after)) return { at: after, kind: 'blink', exception: {
    obstacle: { ...obstacle }, from: previous, to: after,
    excess: after - previous - max, allowance: obstacle.end - obstacle.start,
  } }
  return undefined
}
