// PyRandom (rule 9): the CPython vectors, the person draw order, and the
// short-breaks sum.

import { expect, test } from 'bun:test'
import { PyRandom } from '../../../plugin/hooks/cost/warm/index'

test('nextUint32 matches CPython (seed 20261006)', () => {
  const rng = new PyRandom(20261006)
  expect(rng.nextUint32()).toBe(2125154140)
  expect(rng.nextUint32()).toBe(349270860)
  expect(rng.nextUint32()).toBe(2894928510)
  expect(rng.nextUint32()).toBe(1230876705)
  expect(rng.nextUint32()).toBe(3939206928)
})

test('random matches CPython (seed 20261006)', () => {
  const rng = new PyRandom(20261006)
  expect(rng.random()).toBe(0.4948010003665161)
  expect(rng.random()).toBe(0.6740280634655491)
  expect(rng.random()).toBe(0.9171680829576725)
  expect(rng.random()).toBe(0.5098246201659841)
  expect(rng.random()).toBe(0.7829610672521469)
})

test('normalvariate(0, 1) matches CPython on a fresh generator', () => {
  const rng = new PyRandom(20261006)
  expect(rng.normalvariate(0, 1)).toBe(-0.0273613377331649)
  expect(rng.normalvariate(0, 1)).toBe(1.4600150486568837)
  expect(rng.normalvariate(0, 1)).toBe(0.6330509172205203)
})

test('lognormvariate is exp of normalvariate with the same draw', () => {
  const a = new PyRandom(7)
  const b = new PyRandom(7)
  expect(a.lognormvariate(Math.log(480), 0.8)).toBe(Math.exp(b.normalvariate(Math.log(480), 0.8)))
})

test('same seed gives the same stream, different seeds differ', () => {
  const a = new PyRandom(20261006)
  const b = new PyRandom(20261006)
  const c = new PyRandom(20261007)
  expect(a.nextUint32()).toBe(b.nextUint32())
  expect(a.random()).toBe(b.random())
  expect(a.nextUint32()).not.toBe(c.nextUint32())
})

test('short breaks: first three pauses on a fresh generator', () => {
  const rng = new PyRandom(20261006)
  const m = (med: number, s: number) => rng.lognormvariate(Math.log(med), s)
  const draw = () => (rng.random() < 0.85 ? m(480, 0.8) : m(18000, 0.4))
  expect(draw()).toBe(510.7657278570302)
  expect(draw()).toBe(866.6359583505343)
  expect(draw()).toBe(21974.649522288593)
})

test('short breaks: sum of the 1000 pauses', () => {
  const rng = new PyRandom(20261006)
  const m = (med: number, s: number) => rng.lognormvariate(Math.log(med), s)
  const draw = () => (rng.random() < 0.85 ? m(480, 0.8) : m(18000, 0.4))
  let sum = 0
  for (let i = 0; i < 1000; i++) sum += draw()
  expect(sum).toBeCloseTo(3653301.8606218915, 6)
})

test('meetings: first three pauses after the 1000 short breaks', () => {
  const rng = new PyRandom(20261006)
  const m = (med: number, s: number) => rng.lognormvariate(Math.log(med), s)
  for (let i = 0; i < 1000; i++) (rng.random() < 0.85 ? m(480, 0.8) : m(18000, 0.4))
  const draw = () => (rng.random() < 0.7 ? m(3000, 0.5) : rng.random() < 0.67 ? m(300, 0.4) : m(14400, 0.3))
  expect(draw()).toBe(3087.256235509499)
  expect(draw()).toBe(2442.5635531013045)
  expect(draw()).toBe(258.33748827830834)
})

test('gone at night: first three pauses after 2000 earlier draws', () => {
  const rng = new PyRandom(20261006)
  const m = (med: number, s: number) => rng.lognormvariate(Math.log(med), s)
  for (let i = 0; i < 1000; i++) (rng.random() < 0.85 ? m(480, 0.8) : m(18000, 0.4))
  for (let i = 0; i < 1000; i++) (rng.random() < 0.7 ? m(3000, 0.5) : rng.random() < 0.67 ? m(300, 0.4) : m(14400, 0.3))
  const draw = () => (rng.random() < 0.7 ? m(39600, 0.3) : m(540, 0.5))
  expect(draw()).toBe(47694.72236912713)
  expect(draw()).toBe(37606.742180505484)
  expect(draw()).toBe(29134.09858906694)
})

test('normalvariate with mu and sigma shifts and scales', () => {
  const rng = new PyRandom(42)
  const a = rng.normalvariate(5, 2)
  const other = new PyRandom(42)
  const z = other.normalvariate(0, 1)
  expect(a).toBeCloseTo(5 + z * 2, 12)
})
