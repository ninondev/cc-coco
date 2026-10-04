import { drainFeed } from './feed-drain'
import { samePath } from './file-paths'
// The companion feed: written only while the companion is installed, only when his record changes.

import { describe, expect, test } from 'claude-code/testing'
import { RECENT, band, world } from './world'
import { atomicFeed, PROCESS_OK } from './shared-world'

const START = { cwd: '/tmp/project', surface: 'terminal' as const, isInteractive: true }
const FEED = '/tmp/x/Library/Application Support/Claude-sama/view.json'

function companion(on: Parameters<typeof world>[0], installed: boolean): string[] {
  const writes: string[] = []
  on('fs.exists', ($, e) => ({ value: !/[\\/]diagnostics$/.test(e.path) && (samePath(e.path, '/System/Library/CoreServices/SystemVersion.plist') || samePath(e.path, '/usr/bin/tail') || installed) }))
  on('fs.write', ($, e) => {
    writes.push(e.path)
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    const feed = atomicFeed(e.argv, e.init?.stdin)
    if (feed) writes.push(feed.path)
    return { value: PROCESS_OK }
  })
  on('session.id', () => ({ value: 's1' }))
  on('session.surfaces', () => ({ value: ['desktop'] }))
  return writes
}

describe('the companion feed', () => {
  test('a new mood reaches the companion; blinks never do', async ($, on) => {
    const w = world(on, { store: RECENT, env: { LANG: 'en_US.UTF-8', TERM: 'xterm-256color', HOME: '/tmp/x' } })
    const writes = companion(on, true)
    await $.session.start(START)
    await drainFeed($)
    await $.ui.mount({ surface: 'terminal', ...band(100) })
    const before = writes.length
    await w.clock.advance(20_000) // four or five blinks, nothing else
    expect(writes.length).toBe(before)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await drainFeed($)
    expect(writes.length).toBeGreaterThan(before)
    expect(writes.every(path => samePath(path, FEED))).toBe(true)
  })

  test('an uninstall in the middle of a session stays done: the folder is never written again', async ($, on) => {
    const w = world(on, { store: RECENT, env: { LANG: 'en_US.UTF-8', TERM: 'xterm-256color', HOME: '/tmp/x' } })
    let installed = true
    const after: string[] = []
    on('fs.exists', ($, e) => ({ value: !/[\\/]diagnostics$/.test(e.path) && (samePath(e.path, '/System/Library/CoreServices/SystemVersion.plist') || samePath(e.path, '/usr/bin/tail') || installed) }))
    on('fs.write', ($, e) => {
      if (!installed) after.push(e.path)
      return { value: undefined }
    })
    on('process.run', ($, e) => {
      const feed = atomicFeed(e.argv, e.init?.stdin)
      if (feed && !installed) after.push(feed.path)
      return { value: PROCESS_OK }
    })
    on('session.id', () => ({ value: 's1' }))
    on('session.surfaces', () => ({ value: ['desktop'] }))
    await $.session.start(START)
    await drainFeed($)
    await $.ui.mount({ surface: 'terminal', ...band(100) })
    await w.clock.advance(30_000)
    await $.turn.start({ text: '/claudesama:companion uninstall', turnId: 't1' })
    await drainFeed($)
    await $.tool.call({ tool: 'Bash', command: 'sh /x/bin/companion-macos.sh uninstall' })
    await drainFeed($)
    installed = false // the script has just moved the folder to the Trash
    await w.clock.advance(3_000)
    await $.turn.complete({ answer: 'Moved to the Trash.', durationMs: 5_000, isAborted: false, turnId: 't1', reason: 'answer' })
    await drainFeed($)
    await $.turn.start({ text: 'next', turnId: 't2' })
    await drainFeed($)
    await w.clock.advance(60_000)
    expect(after.length).toBe(0)
  })

  test('without the companion nothing is written, ever', async ($, on) => {
    const w = world(on, { store: RECENT, env: { LANG: 'en_US.UTF-8', TERM: 'xterm-256color', HOME: '/tmp/x' } })
    const writes = companion(on, false)
    await $.session.start(START)
    await drainFeed($)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await drainFeed($)
    await $.turn.complete({ answer: 'Done.', durationMs: 60_000, isAborted: false, turnId: 't1', reason: 'answer' })
    await drainFeed($)
    await w.clock.advance(60_000)
    expect(writes.length).toBe(0)
  })
})
