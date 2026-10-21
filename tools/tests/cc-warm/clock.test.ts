// Direct checks of the fake clock and flush helper (test tools).

import { expect, test } from 'bun:test'
import { FakeClock, flush } from './helpers'

test('fake clock now starts at the given time', () => {
  expect(new FakeClock(123).now()).toBe(123)
  expect(new FakeClock().now()).toBe(0)
})

test('after returns a cancel function that prevents the callback', () => {
  const clock = new FakeClock()
  let ran = 0
  const cancel = clock.after(100, () => {
    ran += 1
  })
  expect(clock.pending()).toBe(1)
  cancel()
  expect(clock.pending()).toBe(0)
  clock.advance(200)
  expect(ran).toBe(0)
})

test('advance runs due callbacks in time order', () => {
  const clock = new FakeClock()
  const order: string[] = []
  clock.after(300, () => order.push('c'))
  clock.after(100, () => order.push('a'))
  clock.after(200, () => order.push('b'))
  clock.advance(1000)
  expect(order).toEqual(['a', 'b', 'c'])
  expect(clock.now()).toBe(1000)
  expect(clock.pending()).toBe(0)
})

test('advance runs each callback at its own due time', () => {
  const clock = new FakeClock()
  const times: number[] = []
  clock.after(100, () => times.push(clock.now()))
  clock.after(200, () => times.push(clock.now()))
  clock.advance(5000)
  expect(times).toEqual([100, 200])
})

test('advance picks up timers scheduled from within a callback', () => {
  const clock = new FakeClock()
  let runs = 0
  clock.after(100, () => {
    runs += 1
    clock.after(50, () => {
      runs += 1
    })
  })
  clock.advance(200)
  expect(runs).toBe(2)
})

test('sleep runs overdue callbacks at the wake time', () => {
  const clock = new FakeClock()
  const times: number[] = []
  clock.after(100, () => times.push(clock.now()))
  clock.sleep(500)
  expect(times).toEqual([500])
  expect(clock.pending()).toBe(0)
})

test('flush lets a resolved promise settle', async () => {
  let done = false
  Promise.resolve(1).then(() => {
    done = true
  })
  expect(done).toBe(false)
  await flush()
  expect(done).toBe(true)
})
