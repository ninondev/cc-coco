// The world fixture's state cell, after the same-tick fix (later-58): its state.set hook once recorded
// e.value whatever the host said, so of two updates in one tick a refused one replaced the landed one
// and a later read showed a write the engine never accepted (lanes/cards.md, 10-17). These tests call
// the fixture's own registered handler with a controlled host answer, so the recording rule is shown
// directly: only writes the host accepted reach the fixture's cells and state.get answers.
import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { world } from './world'

type Setter = (e: { key: string; value: unknown }, next: () => Promise<unknown>) => Promise<unknown>

function capturedSetter() {
  const handlers: { event: string; handler: unknown }[] = []
  const capture = ((event: string, filter: unknown, handler: unknown) => {
    handlers.push({ event, handler: typeof filter === 'function' ? filter : handler })
  }) as unknown as On
  const w = world(capture, {})
  const registered = handlers.filter(row => row.event === 'state.set').map(row => row.handler)[0] as
    ($: unknown, e: { key: string; value: unknown }, next: () => Promise<unknown>) => Promise<unknown>
  if (typeof registered !== 'function') throw new Error('world registers a state.set handler')
  // The engine dispatches handler($, e, next); the fixture never uses $ here.
  const setter: Setter = (e, next) => registered(undefined, e, next)
  return { w, setter }
}

test('world state.set records a write the host accepted, with the host version', async () => {
  const { w, setter } = capturedSetter()
  await setter({ key: 'fx', value: 'first' }, async () => ({ value: { isSet: true, version: 7 } }))
  expect(w.cell('fx')).toEqual({ value: 'first', version: 7 })
})

test('world state.set leaves the cell alone when the host refuses the write (isSet false)', async () => {
  const { w, setter } = capturedSetter()
  await setter({ key: 'fx', value: 'first' }, async () => ({ value: { isSet: true, version: 7 } }))
  const result = await setter({ key: 'fx', value: 'second' }, async () => ({ value: { isSet: false, version: 7 } }))
  expect((result as { value: { isSet: boolean } }).value.isSet).toBe(false)
  expect(w.cell('fx')).toEqual({ value: 'first', version: 7 })
})

test('world state.set of two same-tick writes keeps the landed one and never the refused one', async () => {
  const { w, setter } = capturedSetter()
  const landed = setter({ key: 'fx', value: 'first' }, async () => ({ value: { isSet: true, version: 7 } }))
  const refused = setter({ key: 'fx', value: 'second' }, async () => ({ value: { isSet: false, version: 7 } }))
  const [firstResult, secondResult] = await Promise.all([landed, refused] as [Promise<unknown>, Promise<unknown>])
  expect((firstResult as { value: { isSet: boolean } }).value.isSet).toBe(true)
  expect((secondResult as { value: { isSet: boolean } }).value.isSet).toBe(false)
  expect(w.cell('fx')).toEqual({ value: 'first', version: 7 })
})

test('world state.set also leaves the cell alone for a denied answer', async () => {
  const { w, setter } = capturedSetter()
  await setter({ key: 'fx', value: 'first' }, async () => ({ value: { isSet: true, version: 7 } }))
  await setter({ key: 'fx', value: 'second' }, async () => ({ deny: 'fixture refusal' }))
  expect(w.cell('fx')).toEqual({ value: 'first', version: 7 })
})
