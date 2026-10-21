import { test, expect } from 'claude-code/testing'
import { companionSession, companionRecord, companionRequestText, companionTask, companionDock } from '../hooks/companion'
import { quotaBandItems } from '../hooks/quota'
import { taskForTool } from '../hooks/tasks'
import { initialView } from '../hooks/mood'
import { forgetD1Words, loadD1Words, d1Word } from '../hooks/d1-words'
import { COMPANION_D1_WORDS_TEXT } from './companion-d1-words-fixture'

test('D1 companion feed preserves finite visual events and source localized labels', async () => {
  forgetD1Words(); await loadD1Words(async () => COMPANION_D1_WORDS_TEXT)
  companionSession('/fixture/project')
  const view = { ...initialView(), lang: 'ja' as const,
    ribbon: { index: 8, folder: 'project', visible: true },
    helpers: [{ id: 'helper', state: 'running' as const, at: 1, arrivalAt: 2 }], helpersCount: 1,
    shed: { id: 'shed', phase: 'end' as const, at: 3 }, stageDirection: '*fixture*',
    longTask: { id: 'task', startedAt: 0, completedAt: 120000, durationMs: 120000, mode: 'notify' as const, quiet: true, title: 'fixture', body: 'fixture', thread: 'fixture' } }
  const feed = companionRecord(view)
  expect(feed.ribbon).toEqual(view.ribbon); expect(feed.helpers).toEqual(view.helpers)
  expect(feed.shed).toEqual(view.shed); expect(feed.longTask?.completedAt).toBe(120000)
  expect(feed.name).toBe('Coco'); expect(feed.longTask?.title).toBe('Coco')
  expect(feed.aside).toBe('fixture')
  expect(feed.words.shedAside).toBe(d1Word('ja','aside.shed').replace(/\*/g,''))
  expect(feed.words.helpersAlt).toBe(d1Word('ja','helpers.alt',{n:1},1))
  expect(feed.words.ribbonAlt).toBe(d1Word('ja','ribbon.alt',{folder:'project'}))
})
// E1-13: while a task list runs, the pet's task pill ends with where it is, in the band's own words.
test('E1-13 the record carries the task list place only beside a task', () => {
  const place = { i: 3, n: 7, subject: 'fixture', dip: 0, short: 'task 3/7' }
  companionTask(null)
  expect(companionRecord({ ...initialView(), place }).place).toBeUndefined()
  companionTask(taskForTool({ tool: 'Edit', file_path: '/fixture/project/a.ts' }))
  try {
    expect(companionRecord({ ...initialView(), place }).place).toBe('task 3/7')
    expect(companionRecord(initialView()).place).toBeUndefined()
  } finally { companionTask(null) }
})
// E1-5 and E1-9: the windows go to the pet for its Activity foot; the Dock tile's menu lines only while it is on.
test('E1-5 the record carries the quota windows, and the Dock lines only with the tile on', () => {
  const quota = { rateLimits: [{ kind: 'five_hour', percentUsed: 41.6, resetsAt: '2026-10-17T14:00:00Z' }, { kind: 'seven_day', percentUsed: 12 }, { kind: 'other', percentUsed: 5 }], at: 1 }
  const pace = { kind: 'five_hour', wide: 'fixture wide pace', narrow: 'fixture', t: '1h' }
  const view = { ...initialView(), lang: 'en' as const, quota, hotWindows: ['five_hour'], paceDetails: [pace] }
  expect(companionRecord(initialView()).quota).toBeUndefined()
  expect(companionRecord(view).quota).toEqual({ rateLimits: [
    { kind: 'five_hour', percentUsed: 42, resetsAt: '2026-10-17T14:00:00Z', pace: 'fixture wide pace', hot: true },
    { kind: 'seven_day', percentUsed: 12 }] })
  expect(companionRecord(view).dock).toBeUndefined()
  companionDock(true)
  try {
    const lines = quotaBandItems('en', quota.rateLimits).map(item => item.alt)
    expect(lines.length).toBe(2)
    expect(companionRecord(view).dock).toEqual({ quota: lines })
  } finally { companionDock(false) }
})
test('D1 native authorization and settings requests survive ordinary records and reset at session start', () => {
  companionSession('/fixture/project')
  const view=initialView()
  const request=JSON.parse(companionRequestText(view,'fixture',true,1,{longTaskAuthorizationRequest:1,longTaskSettingsRequest:2}))
  expect(request.longTaskAuthorizationRequest).toBe(1); expect(request.longTaskSettingsRequest).toBe(2)
  const next=JSON.parse(companionRequestText(view,'fixture',true,3,{}))
  expect(next.longTaskAuthorizationRequest).toBe(1); expect(next.longTaskSettingsRequest).toBe(2)
  companionSession('/fixture/other')
  expect(companionRecord(view).longTaskAuthorizationRequest).toBeUndefined()
  expect(companionRecord(view).longTaskSettingsRequest).toBeUndefined()
})
