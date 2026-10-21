// cs-pace: projects when each usage window of a coding assistant
// subscription runs out at the current pace, and derives the "burning hot"
// sign (with hysteresis) and once-per-window reminders.
//
// Pure ES2023, no platform APIs, no clock reads, no thrown exceptions:
// every entry point returns a sane value for any input.

export type WindowKind = string

export interface Reading {
  kind: WindowKind
  percentUsed: number
  resetsAt?: number
  at: number
}

export interface Projection {
  kind: WindowKind
  resetsAt?: number
  ratePerHour?: number
  runsOutAt?: number
  runsOutAtLate?: number
  early: boolean
}

export interface HotState {
  hot: Record<string, true>
  history?: Record<string, HotHistory>
}

export interface HotHistory {
  fresh: number
  lastAt?: number
  lastSwitch?: number
  currentReset?: number
}

export interface ReminderState {
  warned: Record<string, true>
}

// ---------- tuning constants (times are epoch milliseconds) ----------

const SKEW_MS = 60_000 // tolerate readings at most this far in the future
const PAIR_MIN_GAP_MS = 180_000 // pairwise slopes need 3 minutes of separation
const RECENT_MS = 5_400_000 // the rate uses the last 90 minutes of the window
const IDLE_GAP_MS = 1_200_000 // a gap over 20 minutes with no rise is idle time
const MIN_READINGS = 3
const MIN_SPAN_MS = 600_000 // a projection needs 10 minutes of readings
const MIN_RISE = 2 // ...and 2 percentage points of rise
const NEW_WINDOW_DROP = 5 // a drop of 5+ points means the window reset
const EARLY_MS = 1_800_000 // early = runs out 30+ minutes before the reset
const HOT_ON_MS = 1_860_000 // warning: conservative runout at least 31 minutes early
const HOT_OFF_MS = 600_000 // cool only when median runout is 10 minutes past reset
const HOT_MIN_READINGS = 3
const HOT_MIN_SPAN_MS = 600_000
const HOT_DWELL_READINGS = 3
const HOUR_MS = 3_600_000

// ---------- small helpers ----------

function isNum(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x)
}

function clampPercent(p: number): number {
  if (p < 0) return 0
  if (p > 100) return 100
  return p
}

function guard<T>(fallback: T, fn: () => T): T {
  try {
    return fn()
  } catch {
    return fallback
  }
}

function kindRank(kind: string): number {
  if (kind === "five_hour") return 0
  if (kind === "seven_day") return 1
  return 2
}

function compareKinds(a: string, b: string): number {
  const ra = kindRank(a)
  const rb = kindRank(b)
  if (ra !== rb) return ra - rb
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

function finiteOrUndefined(x: number): number | undefined {
  return Number.isFinite(x) ? Math.round(x) : undefined
}

// A large collinear tie must be counted as a group. This certificate works
// with the actual binary inputs: common-grid spans of at most 53 bits prove
// every subtraction exact, and integer cross-products prove collinearity.
// A failed certificate says nothing about the data; uncertain pairs still
// use the original floating-point division below.
function dyadicNumber(value: number, view: DataView): [bigint, number] {
  if (value === 0) return [0n, 0]
  view.setFloat64(0, value)
  const hi = view.getUint32(0), lo = view.getUint32(4)
  const exponent = (hi >>> 20) & 2047
  const top = (hi & 0xfffff) | (exponent ? 0x100000 : 0)
  const trailing = lo ? 31 - Math.clz32(lo & -lo) : 32 + 31 - Math.clz32(top & -top)
  let bits = ((BigInt(top) << 32n) | BigInt(lo)) >> BigInt(trailing)
  if (hi >>> 31) bits = -bits
  return [bits, (exponent ? exponent - 1075 : -1074) + trailing]
}

function constantSlope(order: Int32Array, start: number, end: number, p: Float64Array, t: Float64Array): number | undefined {
  let minP = Infinity, maxP = -Infinity
  for (let k = start; k < end; k++) {
    minP = Math.min(minP, p[order[k]]); maxP = Math.max(maxP, p[order[k]])
  }
  // This also certifies underflow ties: a nonzero percentage difference can
  // still round to zero after division by an eligible time separation.
  if ((maxP - minP) / PAIR_MIN_GAP_MS === 0) return 0
  // On finite subtraction results, a successful certificate below proves exact
  // differences and identical ratios. Reject incompatible finite anchor slopes
  // before allocating the complete dyadic integer representation.
  const first = order[start], second = order[start + 1]
  const firstDeltaP = p[second] - p[first], firstDeltaT = t[second] - t[first]
  const candidate = firstDeltaP / firstDeltaT
  if (Number.isFinite(firstDeltaP) && Number.isFinite(firstDeltaT) && Number.isFinite(candidate)) for (let k = start + 2; k < end; k++) {
    const i = order[k], deltaP = p[i] - p[first], deltaT = t[i] - t[first]
    // The integer certificate can accept a span whose floating subtraction
    // overflows. Such a point supplies no safe numeric rejection evidence.
    if (!Number.isFinite(deltaP) || !Number.isFinite(deltaT)) continue
    if (deltaP === 0 && deltaT === 0) continue
    if (deltaP / deltaT !== candidate) return undefined
  }
  const view = new DataView(new ArrayBuffer(8))
  const ps: Array<[bigint, number]> = [], ts: Array<[bigint, number]> = []
  let pe = Infinity, te = Infinity
  for (let k = start; k < end; k++) {
    const i = order[k], a = dyadicNumber(p[i], view), b = dyadicNumber(t[i], view)
    ps.push(a); ts.push(b)
    if (a[0] !== 0n) pe = Math.min(pe, a[1])
    if (b[0] !== 0n) te = Math.min(te, b[1])
  }
  if (!Number.isFinite(pe)) pe = 0
  if (!Number.isFinite(te)) te = 0
  const integer = (v: [bigint, number], e: number) => v[0] === 0n ? 0n : v[0] << BigInt(v[1] - e)
  const p0 = integer(ps[0], pe), t0 = integer(ts[0], te)
  const dp = integer(ps[1], pe) - p0, dt = integer(ts[1], te) - t0
  let pmin = 0n, pmax = 0n, tmin = 0n, tmax = 0n
  for (let k = 1; k < ps.length; k++) {
    const a = integer(ps[k], pe) - p0, b = integer(ts[k], te) - t0
    if (a * dt !== b * dp) return undefined
    if (a < pmin) pmin = a
    if (a > pmax) pmax = a
    if (b < tmin) tmin = b
    if (b > tmax) tmax = b
  }
  if (pmax - pmin > 9007199254740992n || tmax - tmin > 9007199254740992n) return undefined
  const i = order[start], j = order[start + 1]
  return (p[j] - p[i]) / (t[j] - t[i])
}

interface SlopeGrid {
  p: bigint[]
  t: bigint[]
  time: Float64Array
  pe: number
  te: number
  cells: Int32Array
}

function slopeGrid(p: Float64Array, t: Float64Array): SlopeGrid | undefined {
  const view = new DataView(new ArrayBuffer(8))
  function grid(values: Float64Array): { values: bigint[]; exponent: number } {
    const integers: bigint[] = new Array(values.length)
    const exponents = new Int16Array(values.length)
    let exponent = Infinity
    for (let i = 0; i < values.length; i++) {
      const [value, e] = dyadicNumber(values[i], view)
      integers[i] = value; exponents[i] = e
      if (value !== 0n && e < exponent) exponent = e
    }
    if (!Number.isFinite(exponent)) exponent = 0
    const origin = integers[0] === 0n ? 0n : integers[0] << BigInt(exponents[0] - exponent)
    let bits = 0n
    for (let i = 0; i < integers.length; i++) {
      const value = integers[i]
      integers[i] = (value === 0n ? 0n : value << BigInt(exponents[i] - exponent)) - origin
      bits |= integers[i]
    }
    let shift = 0
    if (bits !== 0n) while ((bits & 1n) === 0n) { bits >>= 1n; shift++ }
    const binaryShift = BigInt(shift)
    for (let i = 0; i < integers.length; i++) integers[i] >>= binaryShift
    return { values: integers, exponent: exponent + shift }
  }
  function integerTimeGrid(): { values: bigint[]; exponent: number } | undefined {
    const deltas = new Float64Array(t.length)
    let bits = 0
    for (let i = 0; i < t.length; i++) {
      if (!Number.isSafeInteger(t[i])) return undefined
      const delta = t[i] - t[0]
      if (delta < 0 || delta > 0xffffffff) return undefined
      deltas[i] = delta
      bits = (bits | delta) >>> 0
    }
    // Preserve the generic representation of a zero-span grid.
    if (bits === 0) return undefined
    const shift = 31 - Math.clz32(bits & -bits), scale = 2 ** shift
    return { values: Array.from(deltas, value => BigInt(value / scale)), exponent: shift }
  }
  const pg = grid(p), tg = integerTimeGrid() ?? grid(t)
  // This certificate makes every original timestamp subtraction exact.
  // The bounded 90-minute horizon normally leaves ample room on this grid.
  if (tg.values[tg.values.length - 1] > 9007199254740992n) return undefined
  return { p: pg.values, t: tg.values, time: Float64Array.from(tg.values, Number), pe: pg.exponent, te: tg.exponent, cells: new Int32Array(0) }
}

// Keep the certified integer fast path in its own numeric-only function.
// Generic dyadic inputs must not give these hot comparison loops BigInt
// feedback. One work buffer is reused across time bands and rank queries.
function sortedUniqueNumbers(values: Float64Array): Float64Array {
  const sorted = values.slice().sort()
  let kept = 0, previous = NaN
  for (let i = 0; i < sorted.length; i++) {
    const value = sorted[i]
    if (kept === 0 || (value !== previous && !(value !== value && previous !== previous))) {
      previous = value === 0 ? 0 : value
      sorted[kept++] = previous
    }
  }
  return sorted.subarray(0, kept)
}

function numericMidpointBand(grid: SlopeGrid, zs: Float64Array, fractions: Int32Array, parity: Int8Array, half: number, width: number, begin: Int32Array, end: Int32Array, inclusive: boolean, counts: Float64Array): boolean {
  const n = zs.length, sorted = sortedUniqueNumbers(zs), height = sorted.length + 1
  const plane = width * height
  if (plane > 2_000_000) return false
  const required = plane * 3
  if (grid.cells.length < required) grid.cells = new Int32Array(required)
  else grid.cells.fill(0, 0, required)
  const cells = grid.cells
  const zRank = new Int32Array(n), plus = new Int32Array(sorted.length), minus = new Int32Array(sorted.length)
  const plusTie = new Int32Array(sorted.length), minusTie = new Int32Array(sorted.length)
  const totals = new Int32Array(height), evenTotal = new Int32Array(height), oddTotal = new Int32Array(height)
  const ranks = new Map<number, number>()
  let highEnd = 0, lowEnd = 0
  for (let z = 0; z < sorted.length; z++) {
    const high = sorted[z] + half, low = sorted[z] - half
    while (highEnd < sorted.length && sorted[highEnd] <= high) highEnd++
    while (lowEnd < sorted.length && sorted[lowEnd] <= low) lowEnd++
    plus[z] = highEnd; minus[z] = lowEnd
    plusTie[z] = highEnd > 0 && sorted[highEnd - 1] === high ? highEnd - 1 : -1
    minusTie[z] = lowEnd > 0 && sorted[lowEnd - 1] === low ? lowEnd - 1 : -1
    ranks.set(sorted[z], z)
  }
  for (let i = 0; i < n; i++) zRank[i] = ranks.get(zs[i])!
  function update(i: number, change: number): void {
    const f = fractions[i] + 1, zr = zRank[i]
    for (let z = zr + 1; z < height; z += z & -z) {
      totals[z] += change
      const offset = z * width
      for (let k = f; k < width; k += k & -k) cells[offset + k] += change
    }
    const offset = (parity[i] ? plane * 2 : plane) + zr * width
    for (let k = f; k < width; k += k & -k) cells[offset + k] += change
    if (parity[i]) oddTotal[zr] += change
    else evenTotal[zr] += change
  }
  function dominance(z: number, f: number): number {
    let sum = 0
    for (; z > 0; z -= z & -z) {
      const offset = z * width
      for (let k = f; k > 0; k -= k & -k) sum += cells[offset + k]
    }
    return sum
  }
  function tiePrefix(z: number, f: number, odd: number): number {
    if (z < 0) return 0
    const offset = (odd ? plane * 2 : plane) + z * width
    let sum = 0
    for (let k = f; k > 0; k -= k & -k) sum += cells[offset + k]
    return sum
  }
  let lo = 0, hi = 0
  for (let i = 0; i < n; i++) {
    while (lo < begin[i] && lo < hi) update(lo++, -1)
    if (hi < begin[i]) lo = hi = begin[i]
    while (hi < end[i]) update(hi++, 1)
    if (begin[i] === end[i]) continue
    const split = fractions[i] + (inclusive ? 0 : 1), wrongPlus = 1 - parity[i]
    const zr = zRank[i], high = plus[zr], low = minus[zr], highTie = plusTie[zr], lowTie = minusTie[zr]
    let all = 0
    for (let k = high; k > 0; k -= k & -k) all += totals[k]
    let value = all - dominance(high, split) + dominance(low, split)
    if (highTie >= 0) value -= (wrongPlus ? oddTotal[highTie] : evenTotal[highTie]) - tiePrefix(highTie, split, wrongPlus)
    value -= tiePrefix(lowTie, split, parity[i])
    counts[i] += value
  }
  return true
}

function numericResidualBand(grid: SlopeGrid, residual: Float64Array, begin: Int32Array, end: Int32Array, inclusive: boolean, counts: Float64Array): void {
  const n = residual.length, sorted = sortedUniqueNumbers(residual), m = sorted.length
  const ranks = new Map<number, number>()
  for (let k = 0; k < m; k++) ranks.set(sorted[k], k)
  const position = new Int32Array(n)
  for (let i = 0; i < n; i++) position[i] = ranks.get(residual[i])!
  if (grid.cells.length < m + 1) grid.cells = new Int32Array(m + 1)
  else grid.cells.fill(0, 0, m + 1)
  const tree = grid.cells
  function update(i: number, change: number): void {
    for (let k = position[i] + 1; k <= m; k += k & -k) tree[k] += change
  }
  let lo = 0, hi = 0
  for (let i = 0; i < n; i++) {
    while (lo < begin[i] && lo < hi) update(lo++, -1)
    if (hi < begin[i]) lo = hi = begin[i]
    while (hi < end[i]) update(hi++, 1)
    let sum = 0
    for (let k = position[i] + (inclusive ? 1 : 0); k > 0; k -= k & -k) sum += tree[k]
    counts[i] += sum
  }
}

// Exact rank at a positive normal IEEE division midpoint. For one numerator
// binade, u is its rounding grid. Write B*t_i/u = F_i + f_i and
// Z_i = p_i - F_i*u. A pair rounds below the midpoint iff
//   Z_j - Z_i <= u/2             when f_j >= f_i,
//   Z_j - Z_i <= -u/2            when f_j < f_i.
// Equality uses the parity of F_j-F_i (ties to even); an open division
// midpoint moves f_j=f_i into the second case. Time bands choose u, so each
// band needs dynamic 2D dominance counts, not candidate pair enumeration.
function midpointCounts(grid: SlopeGrid, pivot: number, upperMidpoint: boolean, firstEnds: Int32Array, blockEnds: Int32Array, sign: number): Float64Array {
  const n = grid.p.length, view = new DataView(new ArrayBuffer(8))
  view.setFloat64(0, pivot)
  const raw = view.getBigUint64(0), even = (raw & 1n) === 0n
  view.setBigUint64(0, upperMidpoint ? raw + 1n : raw - 1n)
  const neighbor = view.getFloat64(0)
  const a = dyadicNumber(pivot, view), b = dyadicNumber(neighbor, view)
  const exponent = Math.min(a[1], b[1]) - 1
  const coefficient = (a[0] << BigInt(a[1] - exponent - 1)) + (b[0] << BigInt(b[1] - exponent - 1))
  const inclusive = upperMidpoint ? even : !even
  const counts = new Float64Array(n), time = grid.time
  const points = sign > 0 ? grid.p : grid.p.map(value => -value)
  const residualCommon = Math.min(grid.pe, exponent + grid.te)
  const residualShiftP = BigInt(grid.pe - residualCommon), residualShiftT = BigInt(exponent + grid.te - residualCommon)
  const residualInteger = points.map((value, i) => (value << residualShiftP) - ((coefficient * grid.t[i]) << residualShiftT))
  const residualNumber = residualInteger.every(value => value >= -9007199254740991n && value <= 9007199254740991n)
    ? Float64Array.from(residualInteger, Number) : undefined
  let residualMagnitude = 0
  if (residualNumber) for (const value of residualNumber) residualMagnitude = Math.max(residualMagnitude, Math.abs(value))
  const midpointLog = Math.log2(Number(coefficient)) + exponent
  const startBand = Math.floor(midpointLog + Math.log2(PAIR_MIN_GAP_MS)) - 1
  const endBand = Math.floor(midpointLog + Math.log2(RECENT_MS)) + 1
  const ceilingTime = (power: number): number => {
    const shift = power - exponent - grid.te
    if (shift < 0) return 1
    const numerator = 1n << BigInt(shift)
    const result = (numerator + coefficient - 1n) / coefficient
    return result > grid.t[n - 1] ? Infinity : Number(result)
  }
  const lowerBound = (values: readonly number[], target: number): number => {
    let lo = 0, hi = values.length
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (values[mid] < target) lo = mid + 1; else hi = mid }
    return lo
  }
  const begin = new Int32Array(n), end = new Int32Array(n), parity = new Int8Array(n)
  let numericFractions: Int32Array | undefined, numericZs: Float64Array | undefined
  for (let band = startBand; band <= endBand; band++) {
    const lastBand = band <= grid.pe + 52 ? Math.min(endBand, grid.pe + 52) : band
    const minTime = ceilingTime(band), maxTime = ceilingTime(lastBand + 1)
    if (minTime > time[n - 1] || maxTime <= 0 || minTime === maxTime) continue
    let any = false, blockStart = 0
    while (blockStart < n) {
      const blockEnd = blockEnds[blockStart]
      let lo = blockStart, hi = blockStart
      for (let i = blockStart; i < blockEnd; i++) {
        if (lo < firstEnds[i]) lo = firstEnds[i]
        while (lo < blockEnd && time[lo] - time[i] < minTime) lo++
        if (hi < lo) hi = lo
        while (hi < blockEnd && time[hi] - time[i] < maxTime) hi++
        begin[i] = lo; end[i] = hi
        if (lo < hi) any = true
      }
      blockStart = blockEnd
    }
    if (!any) continue
    const unitExponent = Math.max(-1074, band - 52)
    if (unitExponent <= grid.pe) {
      // Here the input difference grid is at least as coarse as u. Near
      // this threshold subtraction is exact, leaving a 1D rank query.
      if (residualNumber) {
        numericResidualBand(grid, residualNumber, begin, end, inclusive, counts)
        band = lastBand
        continue
      }
      const residual = residualInteger
      const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => residual[i] < residual[j] ? -1 : residual[i] > residual[j] ? 1 : 0)
      const position = new Int32Array(n), limit = new Int32Array(n), tree = new Int32Array(n + 1)
      for (let k = 0; k < n; k++) position[order[k]] = k
      for (let k = 0; k < n;) {
        let e = k + 1
        while (e < n && residual[order[e]] === residual[order[k]]) e++
        for (let j = k; j < e; j++) limit[order[j]] = inclusive ? e : k
        k = e
      }
      const update = (i: number, change: number) => { for (let k = position[i] + 1; k <= n; k += k & -k) tree[k] += change }
      let lo = 0, hi = 0
      for (let i = 0; i < n; i++) {
        while (lo < begin[i] && lo < hi) update(lo++, -1)
        if (hi < begin[i]) lo = hi = begin[i]
        while (hi < end[i]) update(hi++, 1)
        let sum = 0
        for (let k = limit[i]; k > 0; k -= k & -k) sum += tree[k]
        counts[i] += sum
      }
      band = lastBand
      continue
    }
    const common = Math.min(grid.pe, unitExponent - 1)
    const shiftP = BigInt(grid.pe - common), unit = 1n << BigInt(unitExponent - common), half = unit >> 1n
    const fractionBits = unitExponent - exponent - grid.te
    const mask = fractionBits > 0 ? (1n << BigInt(fractionBits)) - 1n : 0n
    const fractions: Array<bigint | number> = [], zs: Array<bigint | number> = []
    const modulus = 2 ** (fractionBits + 1)
    const coefficientLow = fractionBits >= 0 && fractionBits < 52 ? Number(coefficient % BigInt(modulus)) : Infinity
    const numeric = residualNumber !== undefined && fractionBits >= 0 && fractionBits < 52
      && coefficientLow * time[n - 1] <= Number.MAX_SAFE_INTEGER && unitExponent - residualCommon < 52
      && residualMagnitude + 2 ** (unitExponent - residualCommon + 1) <= Number.MAX_SAFE_INTEGER
    if (numeric && fractionBits <= 16) {
      numericFractions ??= new Int32Array(n); numericZs ??= new Float64Array(n)
      const denominator = modulus / 2, factor = 2 ** (exponent + grid.te - residualCommon)
      for (let i = 0; i < n; i++) {
        const product = coefficientLow * time[i] % modulus, fraction = product % denominator
        numericFractions[i] = fraction; numericZs[i] = residualNumber![i] + fraction * factor
        parity[i] = product >= denominator ? 1 : 0
      }
      if (numericMidpointBand(grid, numericZs, numericFractions, parity, 2 ** (unitExponent - residualCommon - 1), denominator + 1, begin, end, inclusive, counts)) continue
    }
    if (numeric) {
      const denominator = modulus / 2, factor = 2 ** (exponent + grid.te - residualCommon)
      for (let i = 0; i < n; i++) {
        const product = coefficientLow * time[i] % modulus, fraction = product % denominator
        fractions.push(fraction); zs.push(residualNumber![i] + fraction * factor)
        parity[i] = product >= denominator ? 1 : 0
      }
    } else {
      for (let i = 0; i < n; i++) {
        const product = coefficient * grid.t[i]
        const whole = fractionBits > 0 ? product >> BigInt(fractionBits) : product << BigInt(-fractionBits)
        fractions.push(product & mask)
        zs.push((points[i] << shiftP) - whole * unit)
        parity[i] = Number(whole & 1n)
      }
    }
    const directFractions = numeric && fractionBits <= 16
    const sortedF = directFractions ? [] : [...new Set(fractions)].sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
    const sortedZ = [...new Set(zs)].sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
    const fMap = new Map(sortedF.map((value, i) => [value, i])), zMap = new Map(sortedZ.map((value, i) => [value, i]))
    const fRank = Int32Array.from(fractions, value => directFractions ? Number(value) : fMap.get(value)!), zRank = Int32Array.from(zs, value => zMap.get(value)!)
    const zLimit = (target: bigint | number): number => {
      let lo = 0, hi = sortedZ.length
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (sortedZ[mid] <= target) lo = mid + 1; else hi = mid }
      return lo
    }
    const plus = new Int32Array(n), minus = new Int32Array(n), plusTie = new Int32Array(n), minusTie = new Int32Array(n)
    const numericHalf = 2 ** (unitExponent - residualCommon - 1)
    for (let i = 0; i < n; i++) {
      const plusValue = numeric ? (zs[i] as number) + numericHalf : (zs[i] as bigint) + half
      const minusValue = numeric ? (zs[i] as number) - numericHalf : (zs[i] as bigint) - half
      plus[i] = zLimit(plusValue); minus[i] = zLimit(minusValue)
      plusTie[i] = zMap.get(plusValue) ?? -1; minusTie[i] = zMap.get(minusValue) ?? -1
    }
    const width = (directFractions ? 2 ** fractionBits : sortedF.length) + 1, height = sortedZ.length + 1
    const dense = width * height <= 2_000_000 ? new Int32Array(width * height) : undefined
    const columns: number[][] = Array.from({ length: height }, () => [])
    const trees: Int32Array[] = []
    if (!dense) {
      for (let i = 0; i < n; i++) for (let z = zRank[i] + 1; z < height; z += z & -z) columns[z].push(fRank[i])
      for (let z = 1; z < height; z++) { columns[z] = [...new Set(columns[z])].sort((a, b) => a - b); trees[z] = new Int32Array(columns[z].length + 1) }
    }
    const bucketF: number[][] = Array.from({ length: height - 1 }, () => [])
    const denseTies = directFractions && dense !== undefined
    if (!denseTies) for (let i = 0; i < n; i++) bucketF[zRank[i]].push(fRank[i])
    const tieEven: Int32Array[] = [], tieOdd: Int32Array[] = []
    const evenTotal = new Int32Array(height), oddTotal = new Int32Array(height), totals = new Int32Array(height)
    for (let z = 0; z < height - 1; z++) {
      if (!denseTies) bucketF[z] = [...new Set(bucketF[z])].sort((a, b) => a - b)
      const length = denseTies ? width : bucketF[z].length + 1
      tieEven[z] = new Int32Array(length); tieOdd[z] = new Int32Array(length)
    }
    const tiePosition = Int32Array.from(fRank, (f, i) => denseTies ? f + 1 : lowerBound(bucketF[zRank[i]], f) + 1)
    function update(i: number, change: number): void {
      const f = fRank[i], zr = zRank[i]
      for (let z = zr + 1; z < height; z += z & -z) {
        totals[z] += change
        if (dense) {
          const offset = z * width
          for (let k = f + 1; k < width; k += k & -k) dense[offset + k] += change
        } else {
          const tree = trees[z]
          for (let k = lowerBound(columns[z], f) + 1; k < tree.length; k += k & -k) tree[k] += change
        }
      }
      const ties = parity[i] ? tieOdd[zr] : tieEven[zr]
      for (let k = tiePosition[i]; k < ties.length; k += k & -k) ties[k] += change
      if (parity[i]) oddTotal[zr] += change
      else evenTotal[zr] += change
    }
    function dominance(z: number, f: number): number {
      let sum = 0
      for (; z > 0; z -= z & -z) {
        if (dense) {
          const offset = z * width
          for (let k = f; k > 0; k -= k & -k) sum += dense[offset + k]
        } else {
          const tree = trees[z]
          for (let k = lowerBound(columns[z], f); k > 0; k -= k & -k) sum += tree[k]
        }
      }
      return sum
    }
    function tiePrefix(z: number, f: number, odd: number): number {
      if (z < 0) return 0
      const tree = odd ? tieOdd[z] : tieEven[z]
      let sum = 0
      for (let k = denseTies ? f : lowerBound(bucketF[z], f); k > 0; k -= k & -k) sum += tree[k]
      return sum
    }
    let lo = 0, hi = 0
    for (let i = 0; i < n; i++) {
      while (lo < begin[i] && lo < hi) update(lo++, -1)
      if (hi < begin[i]) lo = hi = begin[i]
      while (hi < end[i]) update(hi++, 1)
      if (begin[i] === end[i]) continue
      const split = fRank[i] + (inclusive ? 0 : 1), wrongPlus = 1 - parity[i]
      let all = 0
      for (let k = plus[i]; k > 0; k -= k & -k) all += totals[k]
      let value = all - dominance(plus[i], split) + dominance(minus[i], split)
      if (plusTie[i] >= 0) value -= (wrongPlus ? oddTotal[plusTie[i]] : evenTotal[plusTie[i]]) - tiePrefix(plusTie[i], split, wrongPlus)
      value -= tiePrefix(minusTie[i], split, parity[i])
      counts[i] += value
    }
  }
  return counts
}

// Randomized slope selection, with a deterministic local random stream.
// Rank queries sort the dual coordinates p - slope*t and count eligible
// inversions using a Fenwick tree. Sampling a remaining pair needs only its
// row's rank weight and one row scan, never a quadratic slope buffer.
// Bounded pivot rounds and the midpoint oracle give O(n log² n) on certified
// timestamp grids. Ordinary queries need only O(n log n). Small numerical
// boundary clusters use the exact original division; large clusters use
// dyadic midpoint counts or a constant-slope certificate. If the timestamp
// grid cannot certify exact subtractions, boundary correction remains exact
// but its worst-case work can be quadratic.
function slopeQuantiles(p: Float64Array, t: Float64Array, firstEnds: Int32Array, blockEnds: Int32Array, count: number): [number, number] {
  const n = p.length
  const quarter = (count - 1) * .25, middle = (count - 1) * .5
  const endpoints = [Math.floor(quarter), Math.ceil(quarter), Math.floor(middle), Math.ceil(middle)]
  const ranks = [...endpoints].sort((a, b) => a - b)
  const result = new Float64Array(4)
  const order = new Int32Array(n), position = new Int32Array(n), tree = new Int32Array(n + 1)
  const residual = new Float64Array(n), lower = new Int32Array(n), upper = new Int32Array(n)
  const groupStart = new Int32Array(n), groupEnd = new Int32Array(n), groupSlope = new Float64Array(n)
  let exactGrid: SlopeGrid | null | undefined
  let fullSlopeKnown = false
  let fullSlope: number | undefined
  const positiveCounts = new Map<number, Float64Array>(), negativeCounts = new Map<number, Float64Array>()
  let randomState = ((n ^ count ^ 0x6d2b79f5) | 0) || 1
  const random = () => {
    randomState ^= randomState << 13; randomState ^= randomState >>> 17; randomState ^= randomState << 5
    return (randomState >>> 0) / 4294967296
  }
  function prefix(end: number): number {
    let sum = 0
    for (let k = end; k > 0; k -= k & -k) sum += tree[k]
    return sum
  }
  function exactRank(pivot: number, less: Float64Array, le: Float64Array): { less: Float64Array; le: Float64Array; totalLess: number; totalLE: number } {
    const positive = Math.abs(pivot), sign = pivot > 0 ? 1 : -1
    if (pivot === 0) {
      let forward = positiveCounts.get(0), backward = negativeCounts.get(0)
      if (!forward) { forward = midpointCounts(exactGrid!, 0, true, firstEnds, blockEnds, 1); positiveCounts.set(0, forward) }
      if (!backward) { backward = midpointCounts(exactGrid!, 0, true, firstEnds, blockEnds, -1); negativeCounts.set(0, backward) }
      let totalLess = 0, totalLE = 0
      for (let i = 0; i < n; i++) {
        less[i] = blockEnds[i] - firstEnds[i] - backward[i]; le[i] = forward[i]
        totalLess += less[i]; totalLE += le[i]
      }
      return { less, le, totalLess, totalLE }
    }
    const exactCounts = sign > 0 ? positiveCounts : negativeCounts
    const bits = new DataView(new ArrayBuffer(8))
    bits.setFloat64(0, positive); bits.setBigUint64(0, bits.getBigUint64(0) - 1n)
    const previousKey = bits.getFloat64(0)
    let strict = exactCounts.get(previousKey), inclusive = exactCounts.get(positive)
    if (!strict) {
      strict = midpointCounts(exactGrid!, positive, false, firstEnds, blockEnds, sign)
      exactCounts.set(previousKey, strict)
    }
    if (!inclusive) {
      inclusive = midpointCounts(exactGrid!, positive, true, firstEnds, blockEnds, sign)
      exactCounts.set(positive, inclusive)
    }
    let totalLess = 0, totalLE = 0
    for (let i = 0; i < n; i++) {
      less[i] = sign > 0 ? strict[i] : blockEnds[i] - firstEnds[i] - inclusive[i]
      le[i] = sign > 0 ? inclusive[i] : blockEnds[i] - firstEnds[i] - strict[i]
      totalLess += less[i]; totalLE += le[i]
    }
    return { less, le, totalLess, totalLE }
  }
  function rank(pivot: number): { less: Float64Array; le: Float64Array; totalLess: number; totalLE: number } {
    const less = new Float64Array(n), le = new Float64Array(n)
    if (pivot > 100 / PAIR_MIN_GAP_MS || pivot < -100 / PAIR_MIN_GAP_MS) {
      if (pivot > 0) for (let i = 0; i < n; i++) less[i] = le[i] = blockEnds[i] - firstEnds[i]
      return { less, le, totalLess: pivot > 0 ? count : 0, totalLE: pivot > 0 ? count : 0 }
    }
    // The certified midpoint oracle counts all eligible pairs, independently
    // of residual groups. Reuse it before repeating the numerical sort.
    if (exactGrid) return exactRank(pivot, less, le)
    const error = pivot === 0 ? Number.MIN_VALUE * RECENT_MS : (100 + Math.abs(pivot) * RECENT_MS) * Number.EPSILON * 16
    for (let i = 0; i < n; i++) {
      order[i] = i
      residual[i] = p[i] - pivot * (t[i] - t[0])
    }
    order.sort((a, b) => residual[a] - residual[b])
    for (let k = 0; k < n; k++) position[order[k]] = k
    let left = 0, right = 0
    for (let k = 0; k < n; k++) {
      const i = order[k], value = residual[i]
      while (left < n && residual[order[left]] < value - error) left++
      while (right < n && residual[order[right]] <= value + error) right++
      lower[i] = left; upper[i] = right
    }
    groupSlope.fill(Number.NaN)
    for (let start = 0; start < n;) {
      let end = start + 1
      while (end < n && residual[order[end]] - residual[order[end - 1]] <= error * 2) end++
      if (end - start >= 32) {
        let slope: number | undefined
        if (end - start === n) {
          if (!fullSlopeKnown) {
            fullSlope = constantSlope(order, start, end, p, t)
            fullSlopeKnown = true
          }
          slope = fullSlope
        } else slope = constantSlope(order, start, end, p, t)
        if (slope !== undefined) {
          for (let k = start; k < end; k++) {
            const i = order[k]
            groupStart[i] = start; groupEnd[i] = end; groupSlope[i] = slope
          }
        } else if (end - start >= 64) {
          if (exactGrid === undefined) exactGrid = slopeGrid(p, t) ?? null
          if (exactGrid) {
            return exactRank(pivot, less, le)
          }
        }
      }
      start = end
    }
    let totalLess = 0, totalLE = 0, block = -1, added = n
    for (let i = n - 1; i >= 0; i--) {
      if (blockEnds[i] !== block) {
        tree.fill(0); block = blockEnds[i]; added = block
      }
      while (added > firstEnds[i]) {
        added--
        for (let k = position[added] + 1; k <= n; k += k & -k) tree[k]++
      }
      let a: number, b: number
      if (!Number.isNaN(groupSlope[i])) {
        const before = prefix(groupStart[i]), within = prefix(groupEnd[i]) - before
        a = before + (groupSlope[i] < pivot ? within : 0)
        b = before + (groupSlope[i] <= pivot ? within : 0)
      } else {
        a = b = prefix(lower[i])
        for (let k = lower[i]; k < upper[i]; k++) {
          const j = order[k]
          if (j < firstEnds[i] || j >= block) continue
          const slope = (p[j] - p[i]) / (t[j] - t[i])
          if (slope < pivot) a++
          if (slope <= pivot) b++
        }
      }
      less[i] = a; le[i] = b; totalLess += a; totalLE += b
    }
    return { less, le, totalLess, totalLE }
  }
  function select(first: number, last: number, low: number, high: number, lowRows: Float64Array, highRows: Float64Array, lowCount: number, highCount: number, depth: number): void {
    let pivot: number
    if (depth >= 32) {
      // IEEE64 has a fixed ordered key space. After a bounded number of
      // sampled pivots, bitwise bisection finishes in at most 64 steps.
      // This prevents an additional asymptotic factor from pivot rounds.
      const view = new DataView(new ArrayBuffer(8)), sign = 1n << 63n, mask = (1n << 64n) - 1n
      const key = (value: number) => {
        view.setFloat64(0, value)
        const bits = view.getBigUint64(0)
        return bits & sign ? mask ^ bits : bits | sign
      }
      const middle = (key(low) + key(high)) >> 1n
      view.setBigUint64(0, middle & sign ? middle & (sign - 1n) : mask ^ middle)
      pivot = view.getFloat64(0)
    } else {
      const cumulative = new Float64Array(n)
      let total = 0
      for (let i = 0; i < n; i++) { total += highRows[i] - lowRows[i]; cumulative[i] = total }
      const samples: number[] = []
      const unrestricted = low === -Infinity && high === Infinity
      for (let k = 0; k < (unrestricted ? Math.min(2048, n * 2) : 17); k++) {
        const pick = Math.floor(random() * total)
        let lo = 0, hi = n - 1
        while (lo < hi) {
          const mid = (lo + hi) >>> 1
          if (cumulative[mid] <= pick) lo = mid + 1
          else hi = mid
        }
        const i = lo
        let offset = pick - (i ? cumulative[i - 1] : 0)
        if (unrestricted) {
          const j = firstEnds[i] + offset
          samples.push((p[j] - p[i]) / (t[j] - t[i]))
          continue
        }
        for (let j = firstEnds[i]; j < blockEnds[i]; j++) {
          const slope = (p[j] - p[i]) / (t[j] - t[i])
          if (slope <= low || slope >= high) continue
          if (offset-- === 0) { samples.push(slope); break }
        }
      }
      samples.sort((a, b) => a - b)
      const target = ranks[(first + last + 1) >>> 1]
      const sampleRank = Math.min(samples.length - 1, Math.floor((target - lowCount + .5) / (highCount - lowCount) * samples.length))
      pivot = samples[sampleRank]
    }
    const counted = rank(pivot)
    let left = first
    while (left <= last && ranks[left] < counted.totalLess) left++
    let right = left
    while (right <= last && ranks[right] < counted.totalLE) result[right++] = pivot
    if (left > first) select(first, left - 1, low, pivot, lowRows, counted.less, lowCount, counted.totalLess, depth + 1)
    if (right <= last) select(right, last, pivot, high, counted.le, highRows, counted.totalLE, highCount, depth + 1)
  }
  const allRows = new Float64Array(n)
  for (let i = 0; i < n; i++) allRows[i] = blockEnds[i] - firstEnds[i]
  select(0, 3, -Infinity, Infinity, new Float64Array(n), allRows, 0, count, 0)
  const values = endpoints.map(rank => result[ranks.indexOf(rank)])
  const slow = values[0] + (values[1] - values[0]) * (quarter - endpoints[0])
  const median = values[2] + (values[3] - values[2]) * (middle - endpoints[2])
  return [median, slow]
}

// ---------- cleaning ----------

interface Clean {
  kind: WindowKind
  p: number
  resetsAt: number | undefined
  at: number
}

// Per kind: drop unusable and skewed readings, sort by time and collapse
// duplicated timestamps (keeping the last of them).
function clean(readings: unknown, now: number): Map<WindowKind, Clean[]> {
  const byKind = new Map<WindowKind, Clean[]>()
  if (!Array.isArray(readings)) return byKind
  for (let i = 0; i < readings.length; i++) {
    const raw = readings[i]
    if (raw === null || typeof raw !== "object") continue
    const r = raw as Record<string, unknown>
    const at = r.at
    const p = r.percentUsed
    if (!isNum(at) || !isNum(p)) continue
    if (at > now + SKEW_MS) continue
    let kind: WindowKind | undefined
    if (typeof r.kind === "string") kind = r.kind
    else if (isNum(r.kind)) kind = String(r.kind)
    else continue
    const item: Clean = {
      kind,
      p: clampPercent(p),
      resetsAt: isNum(r.resetsAt) ? r.resetsAt : undefined,
      at,
    }
    const list = byKind.get(kind)
    if (list) list.push(item)
    else byKind.set(kind, [item])
  }
  for (const [kind, list] of byKind) {
    if (list.length < 2) continue
    // Sorting is stable in ES2023. Already ordered streams need no sort;
    // collapse duplicates in one pass, keeping the latest input copy.
    let ordered = true
    for (let i = 1; i < list.length; i++) {
      if (list[i].at < list[i - 1].at) { ordered = false; break }
    }
    if (!ordered) list.sort((a, b) => a.at - b.at)
    let kept = 0
    for (let i = 0; i < list.length; i++) {
      if (kept > 0 && list[kept - 1].at === list[i].at) list[kept - 1] = list[i]
      else list[kept++] = list[i]
    }
    list.length = kept
  }
  return byKind
}

// ---------- window segmentation ----------

interface Segment {
  readings: Clean[]
  resetsAt: number | undefined
  maxP: number
}

// Split one kind timeline into windows. A new window starts when the reported
// reset time changes, or when a reading sits 5+ points below the running
// maximum (a reset the reading did not report). Missing reset reports still
// expose drops and idle boundaries, although they cannot enter a known-reset
// window's slope pairs.
function segment(readings: readonly Clean[]): Segment[] {
  const segs: Segment[] = []
  let cur: Segment | null = null
  for (const r of readings) {
    if (cur === null) {
      cur = { readings: [r], resetsAt: r.resetsAt, maxP: r.p }
      segs.push(cur)
      continue
    }
    const continues = r.resetsAt === undefined || r.resetsAt === cur.resetsAt
    if (!continues || cur.maxP - r.p >= NEW_WINDOW_DROP) {
      cur = { readings: [r], resetsAt: r.resetsAt, maxP: r.p }
      segs.push(cur)
      continue
    }
    cur.readings.push(r)
    if (r.resetsAt !== undefined) cur.resetsAt = r.resetsAt
    if (r.p > cur.maxP) cur.maxP = r.p
  }
  return segs
}

// ---------- rate estimation ----------

interface Rate {
  ratePerHour?: number
  runsOutAt?: number
  runsOutAtLate?: number
}

// Theil-Sen slope of the current window: the median of the pairwise slopes of
// readings at least 3 minutes apart, taken from the last 90 minutes of the
// window (the whole window when it is younger). Pairs that straddle idle time
// (a gap over 20 minutes with no rise) are left out so that reading a long
// article does not dilute the pace.
function estimateRate(readings: readonly Clean[]): Rate {
  const newest = readings[readings.length - 1]
  const recent = newest.at - readings[0].at <= RECENT_MS
    ? readings : readings.filter(r => newest.at - r.at <= RECENT_MS)
  const slice: Clean[] = []
  const idleCounts: number[] = []
  let idleCount = 0
  for (let i = 0; i < recent.length; i++) {
    if (i > 0 && recent[i].at - recent[i - 1].at > IDLE_GAP_MS && recent[i].p <= recent[i - 1].p) idleCount++
    if (recent[i].resetsAt === newest.resetsAt) {
      slice.push(recent[i])
      idleCounts.push(idleCount)
    }
  }
  // A projection needs three readings, ten minutes of span and two points of
  // rise; whole-percent steps are too noisy below that.
  if (slice.length < MIN_READINGS) return {}
  if (newest.at - slice[0].at < MIN_SPAN_MS) return {}
  if (newest.p - slice[0].p < MIN_RISE) return {}

  // Keep every reading and identify each row's eligible endpoints without
  // enumerating its pairs. Idle blocks never contribute cross-block pairs.
  const n = slice.length
  const firstEnds = new Int32Array(n)
  const blockEnds = new Int32Array(n)
  let count = 0
  let start = 0
  for (let end = 1; end <= n; end++) {
    if (end < n && idleCounts[end] === idleCounts[end - 1]) continue
    let j = start + 1
    for (let i = start; i < end; i++) {
      if (j <= i) j = i + 1
      while (j < end && slice[j].at - slice[i].at < PAIR_MIN_GAP_MS) j++
      firstEnds[i] = j
      blockEnds[i] = end
      count += end - j
    }
    start = end
  }
  if (count === 0) return {}
  const percents = new Float64Array(n), times = new Float64Array(n)
  for (let i = 0; i < n; i++) { percents[i] = slice[i].p; times[i] = slice[i].at }
  const [median, slow] = slopeQuantiles(percents, times, firstEnds, blockEnds, count)
  const ratePerHour = Math.round(median * HOUR_MS * 100) / 100
  if (!(ratePerHour > 0)) return {}

  const remaining = 100 - newest.p
  const runsOutAt = finiteOrUndefined(newest.at + remaining / median)
  const runsOutAtLate = slow > 0 ? finiteOrUndefined(newest.at + remaining / slow) : undefined
  return { ratePerHour, runsOutAt, runsOutAtLate }
}

// ---------- project ----------

interface ReadingEvidence {
  at: number
  count: number
  spanMs: number
}

// Provenance stays private; serialized forecasts retain their original API.
const projectionEvidence = new WeakMap<Projection, ReadingEvidence>()
const projectionObservations = new WeakMap<readonly Projection[], ReadonlyMap<string, ReadingEvidence>>()

export function project(readings: readonly Reading[], now: number): Projection[] {
  return guard([], () => {
    if (!Array.isArray(readings)) return []
    if (!isNum(now)) return []
    const out: Projection[] = []
    const observations = new Map<string, ReadingEvidence>()
    for (const list of clean(readings, now).values()) {
      if (list.length === 0) continue
      observations.set(list[0].kind, { at: list[list.length - 1].at, count: 0, spanMs: 0 })
      // Known-reset windows may have missing reports between known ones;
      // missing values cannot contribute slopes. A newest unknown reset uses
      // only the uninterrupted unknown run after the last known report.
      let windowReadings: Clean[]
      if (list[list.length - 1].resetsAt === undefined) {
        let start = list.length - 1
        while (start > 0 && list[start - 1].resetsAt === undefined) start--
        windowReadings = list.slice(start)
      } else {
        windowReadings = list
      }
      const segs = segment(windowReadings)
      const cur = segs[segs.length - 1]
      if (cur.resetsAt !== undefined && cur.resetsAt <= now) continue // already reset
      const newest = cur.readings[cur.readings.length - 1]
      let count = 0
      let firstAt = newest.at
      for (const reading of cur.readings) {
        if (newest.at - reading.at <= RECENT_MS && reading.resetsAt === newest.resetsAt) {
          if (count === 0) firstAt = reading.at
          count++
        }
      }
      const evidence = { at: newest.at, count, spanMs: newest.at - firstAt }
      observations.set(newest.kind, evidence)
      const rate = estimateRate(cur.readings)
      let runsOutAt = rate.runsOutAt
      let runsOutAtLate = rate.runsOutAtLate
      let early = false
      if (newest.p >= 100) {
        // Already burnt: it runs out now, and it counts as early when that is
        // half an hour or more before the reset.
        runsOutAt = newest.at
        runsOutAtLate = newest.at
        early = cur.resetsAt !== undefined && newest.at <= cur.resetsAt - EARLY_MS
      } else if (runsOutAtLate !== undefined && cur.resetsAt !== undefined) {
        early = runsOutAtLate <= cur.resetsAt - EARLY_MS
      }
      const projection: Projection = {
        kind: list[0].kind,
        resetsAt: cur.resetsAt,
        ratePerHour: rate.ratePerHour,
        runsOutAt,
        runsOutAtLate,
        early,
      }
      projectionEvidence.set(projection, evidence)
      out.push(projection)
    }
    out.sort((a, b) => compareKinds(a.kind, b.kind))
    projectionObservations.set(out, observations)
    return out
  })
}

// ---------- hotness ----------

function hotKindsOf(hot: Record<string, true>): WindowKind[] {
  const kinds: WindowKind[] = []
  for (const key of Object.keys(hot)) {
    const cut = key.lastIndexOf(":")
    const kind = cut >= 0 ? key.slice(0, cut) : key
    if (!kinds.includes(kind)) kinds.push(kind)
  }
  kinds.sort(compareKinds)
  return kinds
}

export function hotness(
  prev: HotState,
  projections: readonly Projection[],
): { state: HotState; hot: WindowKind[]; changed: boolean } {
  return guard({ state: { hot: {} }, hot: [], changed: false }, () => {
    const prevHot =
      prev !== null && typeof prev === "object" && prev.hot !== null && typeof prev.hot === "object"
        ? prev.hot
        : {}
    const list = Array.isArray(projections) ? projections : []
    const supplied = new Map<string, Projection>()
    for (const p of list) {
      if (p === null || typeof p !== "object") continue
      const kind = typeof p.kind === "string" ? p.kind : String(p.kind)
      supplied.set(kind, p)
    }
    const previousKeys = new Map<string, string>()
    for (const key of Object.keys(prevHot)) {
      if (prevHot[key] !== true) continue
      const cut = key.lastIndexOf(":")
      previousKeys.set(cut >= 0 ? key.slice(0, cut) : key, key)
    }
    const previousHistory = prev !== null && typeof prev === "object" &&
      prev.history !== null && typeof prev.history === "object" && !Array.isArray(prev.history)
      ? prev.history : undefined
    const observations = projectionObservations.get(list)
    const allKinds = new Set([
      ...previousKeys.keys(), ...supplied.keys(),
      ...Object.keys(previousHistory ?? {}), ...(observations?.keys() ?? []),
    ])
    const history: Record<string, HotHistory> = {}
    const next: Record<string, true> = {}
    const kinds: WindowKind[] = []
    for (const kind of allKinds) {
      const p = supplied.get(kind)
      const previousKey = previousKeys.get(kind)
      const wasHot = previousKey !== undefined
      const resetText = previousKey?.slice(previousKey.lastIndexOf(":") + 1)
      const previousReset = resetText !== undefined && isNum(Number(resetText)) ? Number(resetText) : undefined
      const old = previousHistory && Object.hasOwn(previousHistory, kind) ? previousHistory[kind] : undefined
      const record: HotHistory = { fresh: 0 }
      if (old !== null && typeof old === "object") {
        if (isNum(old.fresh) && old.fresh >= 0) record.fresh = Math.floor(old.fresh)
        if (isNum(old.lastAt)) record.lastAt = old.lastAt
        if (isNum(old.lastSwitch) && old.lastSwitch >= 0 && old.lastSwitch <= record.fresh)
          record.lastSwitch = old.lastSwitch
        if (isNum(old.currentReset)) record.currentReset = old.currentReset
      } else if (previousReset !== undefined) record.currentReset = previousReset
      const evidence = p ? projectionEvidence.get(p) ?? observations?.get(kind) : observations?.get(kind)
      // A caller-supplied forecast has no sample provenance. Treat that
      // forecast as supplied evidence and each call as one new observation.
      if (!evidence || record.lastAt === undefined || evidence.at > record.lastAt) {
        record.fresh++
        if (evidence) record.lastAt = evidence.at
      }
      const resetsAt = p && isNum(p.resetsAt) ? p.resetsAt : undefined
      const currentKey = resetsAt === undefined ? undefined : kind + ":" + String(resetsAt)
      const enough = !evidence || evidence.count >= HOT_MIN_READINGS && evidence.spanMs >= HOT_MIN_SPAN_MS
      const canHeat = p?.early === true && resetsAt !== undefined && enough &&
        isNum(p.runsOutAtLate) && p.runsOutAtLate <= resetsAt - HOT_ON_MS
      let wanted = wasHot
      // Dwell may retain an older visible window after the latest input reset
      // changes. Keep requesting retirement until that visible key clears.
      if (!p || resetsAt === undefined || resetsAt !== record.currentReset ||
        wasHot && currentKey !== previousKey) wanted = canHeat
      else if (!wasHot) wanted = canHeat
      else if (isNum(p.runsOutAt) && p.runsOutAt >= resetsAt + HOT_OFF_MS) wanted = false

      let hot = wasHot
      if (wanted !== wasHot && (record.lastSwitch === undefined ||
        record.fresh - record.lastSwitch >= HOT_DWELL_READINGS)) {
        hot = wanted
        record.lastSwitch = record.fresh
      }
      if (resetsAt === undefined) delete record.currentReset
      else record.currentReset = resetsAt
      // Define an own property even for kinds such as "__proto__". All
      // history fields are finite JSON values; absent switch means none yet.
      Object.defineProperty(history, kind, { value: record, enumerable: true, writable: true, configurable: true })
      if (hot) {
        // When dwell holds a retiring window, retain its existing key.
        const key = wanted && currentKey !== undefined ? currentKey : previousKey
        if (key !== undefined) {
          next[key] = true
          kinds.push(kind)
        }
      }
    }
    kinds.sort(compareKinds)
    const before = hotKindsOf(prevHot)
    const changed = before.length !== kinds.length || kinds.some((k) => !before.includes(k))
    const state: HotState = { hot: next, history }
    return { state, hot: kinds, changed }
  })
}

// ---------- thresholds ----------

export function crossed(
  previous: number | undefined,
  current: number,
  thresholds: readonly number[],
): number[] {
  return guard([], () => {
    if (previous === undefined) return []
    if (!Array.isArray(thresholds)) return []
    if (!isNum(previous) || !isNum(current)) return []
    const out: number[] = []
    for (const t of thresholds) {
      if (!isNum(t)) continue
      if (current >= t && previous < t) out.push(t)
    }
    out.sort((a, b) => a - b)
    const dedup: number[] = []
    for (const v of out) if (dedup.length === 0 || dedup[dedup.length - 1] !== v) dedup.push(v)
    return dedup
  })
}

// ---------- reminders ----------

export function shouldWarn(
  state: ReminderState,
  kind: WindowKind,
  resetsAt: number | undefined,
  reason: string,
): { warn: boolean; state: ReminderState } {
  return guard({ warn: false, state: { warned: {} } }, () => {
    const warned =
      state !== null && typeof state === "object" && state.warned !== null && typeof state.warned === "object"
        ? state.warned
        : {}
    const key = String(kind) + ":" + (resetsAt === undefined || resetsAt === null ? "none" : String(resetsAt)) + ":" + String(reason)
    if (warned[key] === true) return { warn: false, state }
    const nextWarned: Record<string, true> = { ...warned }
    nextWarned[key] = true
    return { warn: true, state: { warned: nextWarned } }
  })
}
