import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
const root = join(import.meta.dir, '../../..')
function check(today: string) { return spawnSync('python3', ['tools/build-prices.py', '--check', '--release', '--today', today], { cwd: root, encoding: 'utf8' }) }
test('W9 saved page, both shipped snapshots and release age agree', () => {
  const fresh = check('2026-10-20')
  expect(fresh.status).toBe(0)
  const stale = check('2026-10-21')
  expect(stale.status).toBe(1)
  expect(stale.stdout).toContain('older than 14 days')
})
