// Python's random.Random (MT19937) ported exactly: CPython seeding of a
// non-negative int, genrand_uint32, random(), normalvariate and
// K1a adds type-only assertions inside the fixed-size generator bounds.
// lognormvariate. 32-bit arithmetic via Math.imul and >>> 0.

const N = 624
const M = 397
const MATRIX_A = 0x9908b0df
const UPPER_MASK = 0x80000000
const LOWER_MASK = 0x7fffffff
const NV_MAGICCONST = 4 * Math.exp(-0.5) / Math.sqrt(2)

export class PyRandom {
  private mt: Uint32Array = new Uint32Array(N)
  private mti: number = N

  constructor(seed: number) {
    // CPython seeds with the absolute value's 32-bit words, least significant first.
    const abs = Math.abs(Math.trunc(seed))
    const key: number[] = []
    let v = abs
    if (v === 0) key.push(0)
    while (v > 0) {
      key.push(v % 4294967296)
      v = Math.floor(v / 4294967296)
    }

    // init_genrand(19650218)
    this.mt[0] = 19650218
    for (let i = 1; i < N; i++) {
      this.mt[i] = (Math.imul(1812433253, this.mt[i - 1]! ^ (this.mt[i - 1]! >>> 30)) + i) >>> 0
    }

    // init_by_array(key)
    let i = 1
    let j = 0
    let k = Math.max(N, key.length)
    for (; k !== 0; k--) {
      this.mt[i] = ((this.mt[i]! ^ Math.imul(this.mt[i - 1]! ^ (this.mt[i - 1]! >>> 30), 1664525)) + key[j]! + j) >>> 0
      i += 1
      j += 1
      if (i >= N) {
        this.mt[0] = this.mt[N - 1]!
        i = 1
      }
      if (j >= key.length) j = 0
    }
    for (k = N - 1; k !== 0; k--) {
      this.mt[i] = ((this.mt[i]! ^ Math.imul(this.mt[i - 1]! ^ (this.mt[i - 1]! >>> 30), 1566083941)) - i) >>> 0
      i += 1
      if (i >= N) {
        this.mt[0] = this.mt[N - 1]!
        i = 1
      }
    }
    this.mt[0] = 0x80000000
    this.mti = N
  }

  nextUint32(): number {
    if (this.mti >= N) {
      let y: number
      let kk: number
      for (kk = 0; kk < N - M; kk++) {
        y = (this.mt[kk]! & UPPER_MASK) | (this.mt[kk + 1]! & LOWER_MASK)
        this.mt[kk] = (this.mt[kk + M]! ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0)) >>> 0
      }
      for (; kk < N - 1; kk++) {
        y = (this.mt[kk]! & UPPER_MASK) | (this.mt[kk + 1]! & LOWER_MASK)
        this.mt[kk] = (this.mt[kk + (M - N)]! ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0)) >>> 0
      }
      y = (this.mt[N - 1]! & UPPER_MASK) | (this.mt[0]! & LOWER_MASK)
      this.mt[N - 1] = (this.mt[M - 1]! ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0)) >>> 0
      this.mti = 0
    }
    let y = this.mt[this.mti]!
    this.mti += 1
    y = (y ^ (y >>> 11)) >>> 0
    y = (y ^ ((y << 7) & 0x9d2c5680)) >>> 0
    y = (y ^ ((y << 15) & 0xefc60000)) >>> 0
    y = (y ^ (y >>> 18)) >>> 0
    return y
  }

  random(): number {
    const a = this.nextUint32() >>> 5
    const b = this.nextUint32() >>> 6
    return (a * 67108864 + b) / 9007199254740992
  }

  normalvariate(mu: number, sigma: number): number {
    for (;;) {
      const u1 = this.random()
      const u2 = 1 - this.random()
      const z = NV_MAGICCONST * (u1 - 0.5) / u2
      if ((z * z) / 4 <= -Math.log(u2)) return mu + z * sigma
    }
  }

  lognormvariate(mu: number, sigma: number): number {
    return Math.exp(this.normalvariate(mu, sigma))
  }
}
